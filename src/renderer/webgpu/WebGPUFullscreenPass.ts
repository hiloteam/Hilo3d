import type { TranslatedShaderPair } from './shader/GlslToWgsl';
import { WebGPUShaderStage } from './WebGPUConstants';

export interface WebGPUFullscreenPassResources {
    readonly bindGroupIndex: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly pipelineLayout: GPUPipelineLayout;
    readonly sampler: GPUSampler;
}

/** Build the explicit pipeline ABI described by one translated GLSL sampler. */
export function createWebGPUFullscreenPassResources(
    device: GPUDevice,
    shader: TranslatedShaderPair,
    sampleType: GPUTextureSampleType,
    label: string
): WebGPUFullscreenPassResources {
    if (shader.uniformBlocks.length !== 0 || shader.samplers.length !== 1) {
        throw new Error(`${label} must translate to exactly one sampler and no uniform blocks`);
    }
    const binding = shader.samplers[0];
    if (
        binding?.type !== 'sampler2D' ||
        binding.stages.length !== 1 ||
        binding.stages[0] !== 'fragment'
    ) {
        throw new Error(`${label} must use one fragment-only sampler2D`);
    }
    const bindGroupLayout = device.createBindGroupLayout({
        label: `${label} resources`,
        entries: [
            {
                binding: binding.textureBinding,
                visibility: WebGPUShaderStage.FRAGMENT,
                texture: { sampleType, viewDimension: '2d', multisampled: false }
            },
            {
                binding: binding.samplerBinding,
                visibility: WebGPUShaderStage.FRAGMENT,
                sampler: { type: 'non-filtering' }
            }
        ]
    });
    const bindGroupLayouts = Array.from({ length: binding.group + 1 }, (_value, group) =>
        group === binding.group
            ? bindGroupLayout
            : device.createBindGroupLayout({
                  label: `${label} empty group ${String(group)}`,
                  entries: []
              })
    );
    return {
        bindGroupIndex: binding.group,
        textureBinding: binding.textureBinding,
        samplerBinding: binding.samplerBinding,
        bindGroupLayout,
        pipelineLayout: device.createPipelineLayout({ bindGroupLayouts }),
        sampler: device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest'
        })
    };
}

/** Bind the texture/sampler pair using the exact locations produced by Naga preprocessing. */
export function createWebGPUFullscreenPassBindGroup(
    device: GPUDevice,
    resources: WebGPUFullscreenPassResources,
    view: GPUTextureView,
    label?: string
): GPUBindGroup {
    return device.createBindGroup({
        ...(label === undefined ? {} : { label }),
        layout: resources.bindGroupLayout,
        entries: [
            { binding: resources.textureBinding, resource: view },
            { binding: resources.samplerBinding, resource: resources.sampler }
        ]
    });
}
