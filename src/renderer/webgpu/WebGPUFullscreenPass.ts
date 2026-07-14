import type { TranslatedShaderPair } from '../shader/GlslToWgsl';
import { WebGPUDevice } from '../../rhi/webgpu/WebGPUDevice';
import { getWebGPUNativeDeviceCache } from '../../rhi/webgpu/WebGPUNativeCache';
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
    deviceOrOwner: GPUDevice | WebGPUDevice,
    shader: TranslatedShaderPair,
    sampleType: GPUTextureSampleType,
    label: string
): WebGPUFullscreenPassResources {
    const owner = deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner : null;
    const device =
        deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
    const nativeCache = owner?.nativeCache ?? getWebGPUNativeDeviceCache(device);
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
    const bindGroupLayout =
        owner?.createNativeBindGroupLayout({
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
        }) ??
        nativeCache.createBindGroupLayout({
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
    const bindGroupLayouts = Array.from({ length: binding.group + 1 }, (_value, group) => {
        if (group === binding.group) return bindGroupLayout;
        const descriptor = {
            label: `${label} empty group ${String(group)}`,
            entries: []
        } satisfies GPUBindGroupLayoutDescriptor;
        return (
            owner?.createNativeBindGroupLayout(descriptor) ??
            nativeCache.createBindGroupLayout(descriptor)
        );
    });
    const pipelineLayoutDescriptor = { bindGroupLayouts } satisfies GPUPipelineLayoutDescriptor;
    const samplerDescriptor = {
        magFilter: 'nearest',
        minFilter: 'nearest',
        mipmapFilter: 'nearest'
    } satisfies GPUSamplerDescriptor;
    return {
        bindGroupIndex: binding.group,
        textureBinding: binding.textureBinding,
        samplerBinding: binding.samplerBinding,
        bindGroupLayout,
        pipelineLayout:
            owner?.createNativePipelineLayout(pipelineLayoutDescriptor) ??
            nativeCache.createPipelineLayout(pipelineLayoutDescriptor),
        sampler:
            owner?.createNativeSampler(samplerDescriptor) ??
            nativeCache.createSampler(samplerDescriptor)
    };
}

/** Bind the texture/sampler pair using the exact locations produced by Naga preprocessing. */
export function createWebGPUFullscreenPassBindGroup(
    deviceOrOwner: GPUDevice | WebGPUDevice,
    resources: WebGPUFullscreenPassResources,
    view: GPUTextureView,
    label?: string
): GPUBindGroup {
    const descriptor: GPUBindGroupDescriptor = {
        ...(label === undefined ? {} : { label }),
        layout: resources.bindGroupLayout,
        entries: [
            { binding: resources.textureBinding, resource: view },
            { binding: resources.samplerBinding, resource: resources.sampler }
        ]
    };
    return deviceOrOwner instanceof WebGPUDevice
        ? deviceOrOwner.createNativeBindGroup(descriptor)
        : deviceOrOwner.createBindGroup(descriptor);
}
