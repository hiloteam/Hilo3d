import { getRHITextureFormatBlockInfo } from '../../core/RHICopyValidation';
import type { RHIGraphicsShaderArtifactInput } from '../../core/RHIResources';
import { RHITextureUsage, type RHITextureFormat } from '../../core/RHITypes';
import { rhiTextureFormatHasDepth, rhiTextureFormatHasStencil } from '../../core/RHIValidation';
import type { WebGPUDevice } from './WebGPUDevice';
import type { WebGPUShader, WebGPUTexture } from './WebGPUResources';

interface WebGPUMipmapPassResources {
    readonly sourceView: GPUTextureView;
    readonly destinationView: GPUTextureView;
    readonly bindGroup: GPUBindGroup;
    readonly passDescriptor: GPURenderPassDescriptor;
}

interface WebGPUMipmapBindingPlan {
    readonly group: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
}

function canGenerateMipmaps(texture: WebGPUTexture): boolean {
    const requiredUsage = RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT;
    if ((texture.usage & requiredUsage) !== requiredUsage) return false;
    if (texture.sampleCount !== 1 || texture.mipLevelCount < 2 || texture.dimension !== '2d') {
        return false;
    }
    const viewDimension = texture.descriptor.viewDimension;
    if (viewDimension !== '2d' && viewDimension !== 'cube') return false;
    if (rhiTextureFormatHasDepth(texture.format) || rhiTextureFormatHasStencil(texture.format)) {
        return false;
    }
    if (texture.format.endsWith('uint') || texture.format.endsWith('sint')) return false;
    const block = getRHITextureFormatBlockInfo(texture.format);
    return block.blockWidth === 1 && block.blockHeight === 1;
}

function bindingPlan(
    owner: WebGPUDevice,
    artifacts: Readonly<RHIGraphicsShaderArtifactInput>
): WebGPUMipmapBindingPlan {
    if (
        artifacts.vertex.backend !== 'webgpu' ||
        artifacts.vertex.stage !== 'vertex' ||
        artifacts.fragment.backend !== 'webgpu' ||
        artifacts.fragment.stage !== 'fragment'
    ) {
        throw new TypeError(
            'WebGPU mipmap artifacts must contain WebGPU vertex and fragment stages'
        );
    }
    if (artifacts.vertex.reflection.bindings.length !== 0) {
        throw new TypeError('WebGPU mipmap vertex artifact must not declare resource bindings');
    }
    const bindings = artifacts.fragment.reflection.bindings;
    const textureBindings = bindings.filter(binding => binding.kind === 'sampled-texture');
    const samplerBindings = bindings.filter(binding => binding.kind === 'sampler');
    if (bindings.length !== 2 || textureBindings.length !== 1 || samplerBindings.length !== 1) {
        throw new TypeError(
            'WebGPU mipmap fragment artifact must declare exactly one texture/sampler pair'
        );
    }
    const texture = textureBindings[0];
    const sampler = samplerBindings[0];
    if (!texture || !sampler) {
        throw new Error('WebGPU mipmap artifact reflection is incomplete');
    }
    if (
        texture.group !== sampler.group ||
        texture.name !== sampler.name ||
        texture.arrayIndex !== sampler.arrayIndex
    ) {
        throw new TypeError('WebGPU mipmap texture and sampler reflection must identify one pair');
    }
    if (
        texture.sampleType !== 'float' ||
        texture.viewDimension !== '2d' ||
        texture.multisampled !== false
    ) {
        throw new TypeError(
            'WebGPU mipmap texture reflection must describe a single-sampled 2D float texture'
        );
    }
    if (texture.group >= owner.capabilities.limits.maxBindGroups) {
        throw new RangeError('WebGPU mipmap artifact binding group exceeds device limits');
    }
    return Object.freeze({
        group: texture.group,
        textureBinding: texture.binding,
        samplerBinding: sampler.binding
    });
}

/**
 * Backend-private fullscreen mip generator.
 *
 * Shader artifacts are prepared above the RHI. Native shader/layout state is created with the
 * device, while format pipelines and per-subresource views/bind groups are prepared when a
 * mipmap-capable texture is allocated. encode() only emits commands into the caller's frame.
 */
export class WebGPUMipmapGenerator {
    readonly #pipelines = new Map<RHITextureFormat, GPURenderPipeline>();
    readonly #textureResources = new WeakMap<WebGPUTexture, readonly WebGPUMipmapPassResources[]>();
    readonly #bindingPlan: WebGPUMipmapBindingPlan | null;
    readonly #sampledBindGroupLayout: GPUBindGroupLayout | null;
    readonly #pipelineLayout: GPUPipelineLayout | null;
    readonly #sampler: GPUSampler | null;
    readonly #vertexShader: WebGPUShader | null;
    readonly #fragmentShader: WebGPUShader | null;

    constructor(
        readonly owner: WebGPUDevice,
        artifacts: Readonly<RHIGraphicsShaderArtifactInput> | null
    ) {
        if (artifacts === null) {
            this.#bindingPlan = null;
            this.#sampledBindGroupLayout = null;
            this.#pipelineLayout = null;
            this.#sampler = null;
            this.#vertexShader = null;
            this.#fragmentShader = null;
            return;
        }

        const plan = bindingPlan(owner, artifacts);
        const vertexShader = owner.createShader({
            label: 'RHI mipmap vertex shader',
            lifetime: 'persistent',
            artifact: artifacts.vertex
        });
        const fragmentShader = owner.createShader({
            label: 'RHI mipmap fragment shader',
            lifetime: 'persistent',
            artifact: artifacts.fragment
        });
        const layouts: GPUBindGroupLayout[] = [];
        for (let group = 0; group <= plan.group; group += 1) {
            const layout = owner.nativeHandle.createBindGroupLayout({
                label: `RHI mipmap bind group ${String(group)} layout`,
                entries:
                    group === plan.group
                        ? [
                              {
                                  binding: plan.textureBinding,
                                  visibility: 0x2,
                                  texture: {
                                      sampleType: 'unfilterable-float',
                                      viewDimension: '2d',
                                      multisampled: false
                                  }
                              },
                              {
                                  binding: plan.samplerBinding,
                                  visibility: 0x2,
                                  sampler: { type: 'non-filtering' }
                              }
                          ]
                        : []
            });
            owner.recordNativeObjectCreated('bindGroupLayout', 'creation-only');
            layouts.push(layout);
        }
        const sampledBindGroupLayout = layouts[plan.group];
        if (!sampledBindGroupLayout) {
            throw new Error('WebGPU mipmap sampled bind group layout is unavailable');
        }
        const sampler = owner.nativeHandle.createSampler({
            label: 'RHI mipmap texel-fetch sampler',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            lodMinClamp: 0,
            lodMaxClamp: 0,
            maxAnisotropy: 1
        });
        owner.recordNativeObjectCreated('sampler', 'creation-only');
        const pipelineLayout = owner.nativeHandle.createPipelineLayout({
            label: 'RHI mipmap pipeline layout',
            bindGroupLayouts: layouts
        });
        owner.recordNativeObjectCreated('pipelineLayout', 'creation-only');

        this.#bindingPlan = plan;
        this.#sampledBindGroupLayout = sampledBindGroupLayout;
        this.#pipelineLayout = pipelineLayout;
        this.#sampler = sampler;
        this.#vertexShader = vertexShader;
        this.#fragmentShader = fragmentShader;
    }

    /** Prepare every native object that a later generateMipmaps() command will reference. */
    prepare(texture: WebGPUTexture): void {
        if (!canGenerateMipmaps(texture)) return;
        if (this.#bindingPlan === null) return;
        this.preparePipeline(texture.format);
        this.prepareTextureResources(texture);
    }

    release(texture: WebGPUTexture): void {
        this.#textureResources.delete(texture);
    }

    encode(encoder: GPUCommandEncoder, texture: WebGPUTexture): number {
        const plan = this.#bindingPlan;
        if (plan === null) {
            throw new Error(
                'WebGPU mipmap generation requires GLSL/Naga-prepared shader artifacts'
            );
        }
        const pipeline = this.#pipelines.get(texture.format);
        const resources = this.#textureResources.get(texture);
        if (pipeline === undefined || resources === undefined) {
            throw new Error('WebGPU mipmap resources were not prepared before frame execution');
        }
        let resourceIndex = 0;
        for (let layer = 0; layer < texture.depthOrArrayLayers; layer += 1) {
            for (let level = 1; level < texture.mipLevelCount; level += 1) {
                const resource = resources[resourceIndex++];
                if (resource === undefined) {
                    throw new Error('WebGPU mipmap resources are incomplete');
                }
                const pass = encoder.beginRenderPass(resource.passDescriptor);
                pass.setPipeline(pipeline);
                pass.setBindGroup(plan.group, resource.bindGroup);
                pass.draw(3);
                pass.end();
            }
        }
        return resources.length;
    }

    private prepareTextureResources(texture: WebGPUTexture): void {
        if (this.#textureResources.has(texture)) return;
        const plan = this.#bindingPlan;
        const bindGroupLayout = this.#sampledBindGroupLayout;
        const sampler = this.#sampler;
        if (plan === null || bindGroupLayout === null || sampler === null) {
            throw new Error('WebGPU mipmap binding infrastructure is unavailable');
        }
        const resources: WebGPUMipmapPassResources[] = [];
        for (let layer = 0; layer < texture.depthOrArrayLayers; layer += 1) {
            for (let level = 1; level < texture.mipLevelCount; level += 1) {
                const sourceView = texture.nativeHandle.createView({
                    label: `${texture.label} mip ${String(level - 1)} layer ${String(layer)}`,
                    dimension: '2d',
                    baseMipLevel: level - 1,
                    mipLevelCount: 1,
                    baseArrayLayer: layer,
                    arrayLayerCount: 1
                });
                const destinationView = texture.nativeHandle.createView({
                    label: `${texture.label} mip ${String(level)} layer ${String(layer)}`,
                    dimension: '2d',
                    baseMipLevel: level,
                    mipLevelCount: 1,
                    baseArrayLayer: layer,
                    arrayLayerCount: 1
                });
                this.owner.recordNativeObjectCreated('textureView', 'creation-only');
                this.owner.recordNativeObjectCreated('textureView', 'creation-only');
                const bindGroup = this.owner.nativeHandle.createBindGroup({
                    label: `${texture.label} mip ${String(level)} layer ${String(layer)}`,
                    layout: bindGroupLayout,
                    entries: [
                        { binding: plan.textureBinding, resource: sourceView },
                        { binding: plan.samplerBinding, resource: sampler }
                    ]
                });
                this.owner.recordNativeObjectCreated('bindGroup', 'creation-only');
                const colorAttachments: (GPURenderPassColorAttachment | null)[] = [
                    {
                        view: destinationView,
                        clearValue: { r: 0, g: 0, b: 0, a: 0 },
                        loadOp: 'clear',
                        storeOp: 'store'
                    }
                ];
                const passDescriptor: GPURenderPassDescriptor = {
                    label: `${texture.label} generate mip ${String(level)} layer ${String(layer)}`,
                    colorAttachments
                };
                Object.freeze(colorAttachments[0]);
                Object.freeze(colorAttachments);
                Object.freeze(passDescriptor);
                resources.push({ sourceView, destinationView, bindGroup, passDescriptor });
            }
        }
        this.#textureResources.set(texture, Object.freeze(resources));
    }

    private preparePipeline(format: RHITextureFormat): void {
        if (this.#pipelines.has(format)) return;
        const pipelineLayout = this.#pipelineLayout;
        const vertexShader = this.#vertexShader;
        const fragmentShader = this.#fragmentShader;
        if (pipelineLayout === null || vertexShader === null || fragmentShader === null) {
            throw new Error('WebGPU mipmap pipeline infrastructure is unavailable');
        }
        const pipeline = this.owner.nativeHandle.createRenderPipeline({
            label: `RHI ${format} mipmap pipeline`,
            layout: pipelineLayout,
            vertex: {
                module: vertexShader.nativeHandle,
                entryPoint: vertexShader.artifact.entryPoint
            },
            fragment: {
                module: fragmentShader.nativeHandle,
                entryPoint: fragmentShader.artifact.entryPoint,
                targets: [{ format }]
            },
            primitive: { topology: 'triangle-list' },
            multisample: { count: 1 }
        });
        this.owner.recordNativeObjectCreated('pipeline', 'creation-only');
        this.#pipelines.set(format, pipeline);
    }
}
