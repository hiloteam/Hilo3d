import {
    NagaShaderTranslator,
    specializeWebGPUDepthSamplers,
    type GlslSamplerType,
    type GraphicsShaderStage,
    type TranslatedShaderPair,
    type WebGPUSamplerBinding
} from '../../../src/render/shader/GlslToWgsl';
import {
    RHIBufferUsage,
    RHIShaderStage,
    RHITextureUsage,
    type RHIBindGroupEntry,
    type RHIBindGroupLayoutEntry,
    type RHIDestroyable,
    type RHIDevice,
    type RHISampler,
    type RHISamplerBindingType,
    type RHIShaderBindingReflection,
    type RHIShaderReflection,
    type RHITextureSampleType,
    type RHITextureView,
    type RHITextureViewDimension
} from '../../../src/render/rhi/core';

export interface ExtendedTextureSamplingResult {
    readonly samplerTypes: readonly string[];
    readonly textureDimensions: readonly string[];
    readonly readback: readonly number[];
    readonly compilationErrors: readonly string[];
    readonly validationError: string | null;
    readonly submissionCompleted: boolean;
}

interface SampledFixtureResource {
    readonly view: RHITextureView;
    readonly sampler: RHISampler;
    readonly sampleType: RHITextureSampleType;
    readonly viewDimension: RHITextureViewDimension;
    readonly samplerType: RHISamplerBindingType;
}

const VERTEX_SOURCE = `#version 300 es
void main() {
    vec2 position = vec2(-1.0, -1.0);
    if (gl_VertexID == 1) position = vec2(3.0, -1.0);
    if (gl_VertexID == 2) position = vec2(-1.0, 3.0);
    gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
precision highp int;
uniform sampler3D volumeTexture;
uniform sampler2DArray arrayTexture;
uniform sampler2DArrayShadow arrayShadow;
uniform highp usampler2DArray integerTexture;
uniform sampler2D dynamicMaps[2];
uniform sampler2D numericDepth;
layout(std140) uniform MaterialBlock {
    int dynamicMapIndex;
};
layout(location = 0) out vec4 color;
void main() {
    vec4 volumeValue = texelFetch(volumeTexture, ivec3(0, 0, 1), 0);
    vec4 arrayValue = texelFetch(arrayTexture, ivec3(0, 0, 1), 0);
    float shadowValue = texture(arrayShadow, vec4(0.5, 0.5, 1.0, 0.5));
    uvec4 integerValue = texelFetch(integerTexture, ivec3(0, 0, 1), 0);
    vec4 dynamicValue = texture(dynamicMaps[dynamicMapIndex], vec2(0.5));
    vec4 dynamicLodValue = textureLod(dynamicMaps[dynamicMapIndex], vec2(0.5), 0.0);
    float numericDepthValue = texture(numericDepth, vec2(0.5)).r;
    color = vec4(
        (volumeValue.r + dynamicValue.r + dynamicLodValue.r) / 3.0,
        (arrayValue.g + numericDepthValue) * 0.5,
        float(integerValue.b) / 255.0,
        shadowValue
    );
}`;

function resourceKey(binding: Pick<WebGPUSamplerBinding, 'name' | 'arrayIndex'>): string {
    return `${binding.name}:${String(binding.arrayIndex)}`;
}

function samplerViewDimension(type: GlslSamplerType): RHITextureViewDimension {
    if (type.includes('2DArray')) return '2d-array';
    if (type.includes('Cube')) return 'cube';
    if (type.includes('3D')) return '3d';
    return '2d';
}

function samplerSampleType(binding: WebGPUSamplerBinding): RHITextureSampleType {
    if (binding.name === 'numericDepth' || binding.type.endsWith('Shadow')) return 'depth';
    if (binding.type.startsWith('isampler')) return 'sint';
    if (binding.type.startsWith('usampler')) return 'uint';
    return 'float';
}

function samplerLayoutType(binding: WebGPUSamplerBinding): RHISamplerBindingType {
    if (binding.type.endsWith('Shadow')) return 'comparison';
    const sampleType = samplerSampleType(binding);
    return sampleType === 'float' ? 'filtering' : 'non-filtering';
}

function visibility(stages: readonly GraphicsShaderStage[]): number {
    let result = 0;
    if (stages.includes('vertex')) result |= RHIShaderStage.VERTEX;
    if (stages.includes('fragment')) result |= RHIShaderStage.FRAGMENT;
    return result;
}

function bindingReflection(
    translated: TranslatedShaderPair,
    stage: GraphicsShaderStage
): readonly RHIShaderBindingReflection[] {
    const bindings: RHIShaderBindingReflection[] = [];
    for (const block of translated.uniformBlocks) {
        if (!block.stages.includes(stage)) continue;
        bindings.push({
            group: block.group,
            binding: block.binding,
            kind: 'uniform-buffer',
            name: block.name
        });
    }
    for (const sampler of translated.samplers) {
        if (!sampler.stages.includes(stage)) continue;
        bindings.push(
            {
                group: sampler.group,
                binding: sampler.textureBinding,
                kind: 'sampled-texture',
                name: sampler.name,
                sampleType: samplerSampleType(sampler),
                viewDimension: samplerViewDimension(sampler.type),
                multisampled: false
            },
            {
                group: sampler.group,
                binding: sampler.samplerBinding,
                kind: sampler.type.endsWith('Shadow') ? 'comparison-sampler' : 'sampler',
                name: sampler.name
            }
        );
    }
    bindings.sort((left, right) => left.group - right.group || left.binding - right.binding);
    return bindings;
}

function shaderReflection(
    translated: TranslatedShaderPair,
    stage: GraphicsShaderStage
): RHIShaderReflection {
    return {
        bindings: bindingReflection(translated, stage),
        ...(stage === 'vertex'
            ? {
                  vertexInputs: translated.vertexInputs.map(input => ({
                      location: input.location,
                      name: input.name
                  }))
              }
            : {
                  fragmentOutputs: translated.fragmentOutputs.map(output => ({
                      location: output.location,
                      name: output.name
                  }))
              })
    };
}

function addLayoutEntry(
    groups: RHIBindGroupLayoutEntry[][],
    group: number,
    entry: RHIBindGroupLayoutEntry
): void {
    const entries = groups[group];
    if (!entries) throw new Error(`Missing RHI bind-group layout ${String(group)}`);
    if (entries.some(candidate => candidate.binding === entry.binding)) {
        throw new Error(
            `Duplicate RHI binding @group(${String(group)}) @binding(${String(entry.binding)})`
        );
    }
    entries.push(entry);
}

/**
 * Runs the extended sampler corpus entirely through RHI resources, commands and readback.
 * Native validation errors are observed by the UI render-health probe installed before Engine
 * requests its device; this routine additionally fails on every synchronous RHI validation error
 * and submission/map failure.
 */
export async function validateExtendedTextureSampling(
    device: RHIDevice
): Promise<ExtendedTextureSamplingResult> {
    if (device.backend !== 'webgpu') {
        throw new Error(`Extended WebGPU validation received ${device.backend} RHI device`);
    }
    const translator = new NagaShaderTranslator();
    await translator.initialize();
    let translated = translator.translate(VERTEX_SOURCE, FRAGMENT_SOURCE);
    const numericDepthBinding = translated.samplers.find(
        binding => binding.name === 'numericDepth'
    );
    if (!numericDepthBinding) {
        throw new Error('Naga translation omitted the numericDepth sampled binding');
    }
    translated = specializeWebGPUDepthSamplers(translated, [numericDepthBinding]);

    const owned: RHIDestroyable[] = [];
    const track = <T extends RHIDestroyable>(resource: T): T => {
        owned.push(resource);
        return resource;
    };
    let readbackMapped = false;
    let readbackBuffer: ReturnType<RHIDevice['createBuffer']> | null = null;
    try {
        const createSampledResource = (
            binding: WebGPUSamplerBinding,
            descriptor: Parameters<RHIDevice['createTexture']>[0]
        ): SampledFixtureResource => {
            const texture = track(device.createTexture(descriptor));
            const viewDimension = samplerViewDimension(binding.type);
            const view = track(texture.createView({ dimension: viewDimension }));
            const samplerType = samplerLayoutType(binding);
            const sampler = track(
                device.createSampler({
                    label: `${binding.name}[${String(binding.arrayIndex)}] RHI sampler`,
                    magFilter: 'nearest',
                    minFilter: 'nearest',
                    mipmapFilter: 'nearest',
                    ...(samplerType === 'comparison' ? { compare: 'less-equal' as const } : {})
                })
            );
            return {
                view,
                sampler,
                sampleType: samplerSampleType(binding),
                viewDimension,
                samplerType
            };
        };

        const translatedBinding = (name: string, arrayIndex = 0): WebGPUSamplerBinding => {
            const binding = translated.samplers.find(
                candidate => candidate.name === name && candidate.arrayIndex === arrayIndex
            );
            if (!binding) {
                throw new Error(
                    `Naga translation omitted sampled binding ${name}[${String(arrayIndex)}]`
                );
            }
            return binding;
        };

        const volumeBinding = translatedBinding('volumeTexture');
        const arrayBinding = translatedBinding('arrayTexture');
        const shadowBinding = translatedBinding('arrayShadow');
        const integerBinding = translatedBinding('integerTexture');
        const dynamicBinding0 = translatedBinding('dynamicMaps', 0);
        const dynamicBinding1 = translatedBinding('dynamicMaps', 1);
        const specializedNumericDepthBinding = translatedBinding('numericDepth');

        const sampledResources = new Map<string, SampledFixtureResource>();
        const volume = createSampledResource(volumeBinding, {
            label: 'WebGPU UI RHI 3D texture',
            size: { width: 1, height: 1, depthOrArrayLayers: 2 },
            dimension: '3d',
            viewDimension: '3d',
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        sampledResources.set(resourceKey(volumeBinding), volume);
        const array = createSampledResource(arrayBinding, {
            label: 'WebGPU UI RHI 2D-array texture',
            size: { width: 1, height: 1, depthOrArrayLayers: 2 },
            viewDimension: '2d-array',
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        sampledResources.set(resourceKey(arrayBinding), array);
        const integer = createSampledResource(integerBinding, {
            label: 'WebGPU UI RHI integer array texture',
            size: { width: 1, height: 1, depthOrArrayLayers: 2 },
            viewDimension: '2d-array',
            format: 'rgba8uint',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        sampledResources.set(resourceKey(integerBinding), integer);
        const dynamic0 = createSampledResource(dynamicBinding0, {
            label: 'WebGPU UI RHI dynamic sampler texture 0',
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        sampledResources.set(resourceKey(dynamicBinding0), dynamic0);
        const dynamic1 = createSampledResource(dynamicBinding1, {
            label: 'WebGPU UI RHI dynamic sampler texture 1',
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        sampledResources.set(resourceKey(dynamicBinding1), dynamic1);
        const shadow = createSampledResource(shadowBinding, {
            label: 'WebGPU UI RHI depth-array texture',
            size: { width: 1, height: 1, depthOrArrayLayers: 2 },
            viewDimension: '2d-array',
            format: 'depth32float',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
        });
        sampledResources.set(resourceKey(shadowBinding), shadow);
        const numericDepth = createSampledResource(specializedNumericDepthBinding, {
            label: 'WebGPU UI RHI numeric depth texture',
            size: { width: 1, height: 1 },
            format: 'depth32float',
            usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT
        });
        sampledResources.set(resourceKey(specializedNumericDepthBinding), numericDepth);

        const materialBuffer = track(
            device.createBuffer({
                label: 'WebGPU UI RHI dynamic sampler material block',
                size: 16,
                usage: RHIBufferUsage.UNIFORM,
                initialData: new Uint32Array([1, 0, 0, 0])
            })
        );
        const maximumGroup = Math.max(
            0,
            ...translated.uniformBlocks.map(block => block.group),
            ...translated.samplers.map(binding => binding.group)
        );
        const layoutEntryGroups = Array.from(
            { length: maximumGroup + 1 },
            () => [] as RHIBindGroupLayoutEntry[]
        );
        for (const block of translated.uniformBlocks) {
            addLayoutEntry(layoutEntryGroups, block.group, {
                binding: block.binding,
                visibility: visibility(block.stages),
                buffer: { type: 'uniform' }
            });
        }
        for (const binding of translated.samplers) {
            const resource = sampledResources.get(resourceKey(binding));
            if (!resource) {
                throw new Error(
                    `Missing RHI resource for ${binding.name}[${String(binding.arrayIndex)}]`
                );
            }
            const bindingVisibility = visibility(binding.stages);
            addLayoutEntry(layoutEntryGroups, binding.group, {
                binding: binding.textureBinding,
                visibility: bindingVisibility,
                texture: {
                    sampleType: resource.sampleType,
                    viewDimension: resource.viewDimension
                }
            });
            addLayoutEntry(layoutEntryGroups, binding.group, {
                binding: binding.samplerBinding,
                visibility: bindingVisibility,
                sampler: { type: resource.samplerType }
            });
        }
        for (const entries of layoutEntryGroups) {
            entries.sort((left, right) => left.binding - right.binding);
        }
        const bindGroupLayouts = layoutEntryGroups.map((entries, group) =>
            track(
                device.createBindGroupLayout({
                    label: `WebGPU UI RHI extended sampler group ${String(group)}`,
                    entries
                })
            )
        );
        const pipelineLayout = track(
            device.createPipelineLayout({
                label: 'WebGPU UI RHI extended sampler pipeline layout',
                bindGroupLayouts
            })
        );

        const vertexShader = track(
            device.createShader({
                label: 'WebGPU UI RHI extended sampler vertex shader',
                artifact: {
                    backend: 'webgpu',
                    stage: 'vertex',
                    code: translated.vertex.wgsl,
                    entryPoint: 'main',
                    reflection: shaderReflection(translated, 'vertex'),
                    cacheKey: 0x770001
                }
            })
        );
        const fragmentShader = track(
            device.createShader({
                label: 'WebGPU UI RHI extended sampler fragment shader',
                artifact: {
                    backend: 'webgpu',
                    stage: 'fragment',
                    code: translated.fragment.wgsl,
                    entryPoint: 'main',
                    reflection: shaderReflection(translated, 'fragment'),
                    cacheKey: 0x770002
                }
            })
        );
        const pipeline = track(
            device.createGraphicsPipeline({
                label: 'WebGPU UI RHI extended sampler pipeline',
                layout: pipelineLayout,
                vertex: { shader: vertexShader, buffers: [] },
                fragment: {
                    shader: fragmentShader,
                    targets: [{ format: 'rgba8unorm' }]
                },
                primitive: { topology: 'triangle-list' }
            })
        );

        const bindGroups = layoutEntryGroups.map((entries, group) => {
            if (entries.length === 0) return null;
            const layout = bindGroupLayouts[group];
            if (layout === undefined) {
                throw new Error(`Missing RHI bind-group layout ${String(group)}`);
            }
            const resourcesByBinding = new Map<number, RHIBindGroupEntry['resource']>();
            for (const block of translated.uniformBlocks) {
                if (block.group !== group) continue;
                if (block.name !== 'MaterialBlock') {
                    throw new Error(`Unexpected translated uniform block ${block.name}`);
                }
                resourcesByBinding.set(block.binding, {
                    buffer: materialBuffer,
                    offset: 0,
                    size: 16
                });
            }
            for (const binding of translated.samplers) {
                if (binding.group !== group) continue;
                const resource = sampledResources.get(resourceKey(binding));
                if (!resource) {
                    throw new Error(
                        `Missing RHI binding resource ${binding.name}[${String(binding.arrayIndex)}]`
                    );
                }
                resourcesByBinding.set(binding.textureBinding, resource.view);
                resourcesByBinding.set(binding.samplerBinding, resource.sampler);
            }
            const bindEntries = entries.map(entry => {
                const resource = resourcesByBinding.get(entry.binding);
                if (!resource) {
                    throw new Error(
                        `Missing RHI resource @group(${String(group)}) @binding(${String(entry.binding)})`
                    );
                }
                return { binding: entry.binding, resource };
            });
            return track(
                device.createBindGroup({
                    label: `WebGPU UI RHI extended sampler bind group ${String(group)}`,
                    layout,
                    entries: bindEntries
                })
            );
        });

        const outputTexture = track(
            device.createTexture({
                label: 'WebGPU UI RHI extended sampler readback target',
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
            })
        );
        const outputView = track(outputTexture.createView());
        readbackBuffer = track(
            device.createBuffer({
                label: 'WebGPU UI RHI extended sampler readback buffer',
                size: 256,
                usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
            })
        );

        const context = device.graphicsQueue.beginFrame({
            label: 'WebGPU UI RHI extended sampler frame'
        });
        context.writeTexture(
            { texture: volume.view.texture },
            new Uint8Array([16, 0, 0, 255, 64, 0, 0, 255]),
            { bytesPerRow: 4, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 2 }
        );
        context.writeTexture(
            { texture: array.view.texture },
            new Uint8Array([0, 32, 0, 255, 0, 128, 0, 255]),
            { bytesPerRow: 4, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 2 }
        );
        context.writeTexture(
            { texture: integer.view.texture },
            new Uint8Array([0, 0, 40, 1, 0, 0, 200, 1]),
            { bytesPerRow: 4, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 2 }
        );
        context.writeTexture(
            { texture: dynamic0.view.texture },
            new Uint8Array([16, 0, 0, 255]),
            { bytesPerRow: 4 },
            { width: 1, height: 1 }
        );
        context.writeTexture(
            { texture: dynamic1.view.texture },
            new Uint8Array([64, 0, 0, 255]),
            { bytesPerRow: 4 },
            { width: 1, height: 1 }
        );
        for (const [layer, depthClearValue] of [0.25, 0.75].entries()) {
            const layerView = track(
                shadow.view.texture.createView({
                    dimension: '2d',
                    baseArrayLayer: layer,
                    arrayLayerCount: 1
                })
            );
            const depthPass = context.beginRenderPass({
                label: `WebGPU UI RHI depth-array layer ${String(layer)}`,
                colorAttachments: [],
                depthStencilAttachment: {
                    view: layerView,
                    depthClearValue,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store'
                }
            });
            depthPass.end();
        }
        const numericDepthPass = context.beginRenderPass({
            label: 'WebGPU UI RHI numeric depth initialization',
            colorAttachments: [],
            depthStencilAttachment: {
                view: numericDepth.view,
                depthClearValue: 0.5,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            }
        });
        numericDepthPass.end();
        const pass = context.beginRenderPass({
            label: 'WebGPU UI RHI extended sampler pass',
            colorAttachments: [
                {
                    view: outputView,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        bindGroups.forEach((bindGroup, group) => {
            if (bindGroup !== null) pass.setBindGroup(group, bindGroup);
        });
        pass.draw(3);
        pass.end();
        context.copyTextureToBuffer(
            { texture: outputTexture },
            { buffer: readbackBuffer, bytesPerRow: 256, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 1 }
        );
        const submission = device.graphicsQueue.endFrame(context);
        await submission.done;
        await readbackBuffer.mapAsync('read', 0, 256);
        readbackMapped = true;
        const readback = Array.from(new Uint8Array(readbackBuffer.getMappedRange(0, 4)));
        readbackBuffer.unmap();
        readbackMapped = false;
        return {
            samplerTypes: translated.samplers.map(binding => binding.type),
            textureDimensions: translated.samplers.map(binding => {
                const resource = sampledResources.get(resourceKey(binding));
                if (!resource) {
                    throw new Error(
                        `Missing reported RHI texture ${binding.name}[${String(binding.arrayIndex)}]`
                    );
                }
                return resource.view.dimension;
            }),
            readback,
            compilationErrors: [],
            validationError: null,
            submissionCompleted: submission.status === 'succeeded'
        };
    } finally {
        if (readbackMapped && readbackBuffer !== null) readbackBuffer.unmap();
        for (let index = owned.length - 1; index >= 0; index -= 1) {
            owned[index]?.destroy();
        }
    }
}
