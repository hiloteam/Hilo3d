import type { RHITextureFormat } from '../../core/RHITypes';
import type { WebGPUDevice } from './WebGPUDevice';
import type { WebGPUTexture } from './WebGPUResources';
import mipmapShader from './WebGPUMipmap.wgsl';

interface WebGPUMipmapPassResources {
    readonly sourceView: GPUTextureView;
    readonly destinationView: GPUTextureView;
    readonly bindGroup: GPUBindGroup;
}

/** Backend-private fullscreen mip generator. Every pass is encoded into the caller's frame. */
export class WebGPUMipmapGenerator {
    readonly #pipelines = new Map<RHITextureFormat, GPURenderPipeline>();
    readonly #textureResources = new WeakMap<WebGPUTexture, readonly WebGPUMipmapPassResources[]>();
    #bindGroupLayout: GPUBindGroupLayout | null = null;
    #pipelineLayout: GPUPipelineLayout | null = null;
    #shader: GPUShaderModule | null = null;

    constructor(readonly owner: WebGPUDevice) {}

    encode(encoder: GPUCommandEncoder, texture: WebGPUTexture): number {
        const pipeline = this.pipeline(texture.format);
        const resources = this.resources(texture);
        let resourceIndex = 0;
        for (let layer = 0; layer < texture.depthOrArrayLayers; layer += 1) {
            for (let level = 1; level < texture.mipLevelCount; level += 1) {
                const resource = resources[resourceIndex++];
                if (resource === undefined)
                    throw new Error('WebGPU mipmap resources are incomplete');
                const pass = encoder.beginRenderPass({
                    label: `${texture.label} generate mip ${String(level)} layer ${String(layer)}`,
                    colorAttachments: [
                        {
                            view: resource.destinationView,
                            clearValue: { r: 0, g: 0, b: 0, a: 0 },
                            loadOp: 'clear',
                            storeOp: 'store'
                        }
                    ]
                });
                pass.setPipeline(pipeline);
                pass.setBindGroup(0, resource.bindGroup);
                pass.draw(3);
                pass.end();
            }
        }
        return resources.length;
    }

    private resources(texture: WebGPUTexture): readonly WebGPUMipmapPassResources[] {
        const existing = this.#textureResources.get(texture);
        if (existing !== undefined) return existing;
        const bindGroupLayout = this.requireBindGroupLayout();
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
                    entries: [{ binding: 0, resource: sourceView }]
                });
                this.owner.recordNativeObjectCreated('bindGroup', 'creation-only');
                resources.push({ sourceView, destinationView, bindGroup });
            }
        }
        const result = Object.freeze(resources);
        this.#textureResources.set(texture, result);
        return result;
    }

    private pipeline(format: RHITextureFormat): GPURenderPipeline {
        const existing = this.#pipelines.get(format);
        if (existing !== undefined) return existing;
        const pipeline = this.owner.nativeHandle.createRenderPipeline({
            label: `RHI ${format} mipmap pipeline`,
            layout: this.requirePipelineLayout(),
            vertex: {
                module: this.requireShader(),
                entryPoint: 'vertexMain'
            },
            fragment: {
                module: this.requireShader(),
                entryPoint: 'fragmentMain',
                targets: [{ format }]
            },
            primitive: { topology: 'triangle-list' },
            multisample: { count: 1 }
        });
        this.owner.recordNativeObjectCreated('pipeline', 'creation-only');
        this.#pipelines.set(format, pipeline);
        return pipeline;
    }

    private requireBindGroupLayout(): GPUBindGroupLayout {
        if (this.#bindGroupLayout !== null) return this.#bindGroupLayout;
        this.#bindGroupLayout = this.owner.nativeHandle.createBindGroupLayout({
            label: 'RHI mipmap bind group layout',
            entries: [
                {
                    binding: 0,
                    visibility: 0x2,
                    texture: {
                        sampleType: 'unfilterable-float',
                        viewDimension: '2d',
                        multisampled: false
                    }
                }
            ]
        });
        this.owner.recordNativeObjectCreated('bindGroupLayout', 'creation-only');
        return this.#bindGroupLayout;
    }

    private requirePipelineLayout(): GPUPipelineLayout {
        if (this.#pipelineLayout !== null) return this.#pipelineLayout;
        this.#pipelineLayout = this.owner.nativeHandle.createPipelineLayout({
            label: 'RHI mipmap pipeline layout',
            bindGroupLayouts: [this.requireBindGroupLayout()]
        });
        this.owner.recordNativeObjectCreated('pipelineLayout', 'creation-only');
        return this.#pipelineLayout;
    }

    private requireShader(): GPUShaderModule {
        if (this.#shader !== null) return this.#shader;
        this.#shader = this.owner.nativeHandle.createShaderModule({
            label: 'RHI mipmap shader',
            code: mipmapShader
        });
        this.owner.recordNativeObjectCreated('shaderModule', 'creation-only');
        return this.#shader;
    }
}
