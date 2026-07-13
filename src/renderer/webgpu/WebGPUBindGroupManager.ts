import type Texture from '../../texture/Texture';
import { touchBoundedLruEntry } from '../common/BoundedLruCache';
import type { TranslatedShaderPair, WebGPUSamplerBinding } from './shader/GlslToWgsl';
import { WEBGPU_BIND_GROUP_COUNT } from './WebGPUBindingLayout';
import { WebGPUShaderStage } from './WebGPUConstants';
import {
    createWebGPUSamplerDescriptor,
    default as WebGPUTextureManager,
    getWebGPUTextureDefaultCompare,
    resolveWebGPUTextureFormat,
    type WebGPUTextureRequestOptions,
    type WebGPUTextureResource
} from './WebGPUTextureManager';
import type { WebGPUUniformBufferBinding } from './WebGPUUniformBufferManager';

const MAX_CACHED_BIND_GROUPS_PER_GROUP = 256;
const MAX_CACHED_BIND_GROUP_SETS = 256;
const MAX_CACHED_BIND_GROUP_LAYOUTS_PER_GROUP = 256;
const MAX_CACHED_PIPELINE_LAYOUTS = 256;

export interface ResolvedWebGPUSampler {
    readonly binding: WebGPUSamplerBinding;
    readonly texture: Texture<unknown>;
    readonly resource: WebGPUTextureResource;
}

export interface WebGPUPipelineBindingLayout {
    readonly signature: string;
    readonly bindGroupLayouts: readonly GPUBindGroupLayout[];
    readonly pipelineLayout: GPUPipelineLayout;
}

export interface WebGPUTextureResolver {
    get(texture: Texture<unknown>, options?: WebGPUTextureRequestOptions): WebGPUTextureResource;
    getDefaultCompare?(texture: Texture<unknown>): WebGPUTextureRequestOptions['compare'];
}

function stageVisibility(stages: readonly ('vertex' | 'fragment')[]): GPUShaderStageFlags {
    let visibility = 0;
    for (const stage of stages) {
        visibility |= stage === 'vertex' ? WebGPUShaderStage.VERTEX : WebGPUShaderStage.FRAGMENT;
    }
    return visibility;
}

function samplerViewDimension(type: WebGPUSamplerBinding['type']): GPUTextureViewDimension {
    if (type.includes('2DArray')) return '2d-array';
    if (type.includes('3D')) return '3d';
    if (type.includes('Cube')) return 'cube';
    return '2d';
}

function isIntegerSamplerType(type: WebGPUSamplerBinding['type']): boolean {
    return type.startsWith('isampler') || type.startsWith('usampler');
}

function validateIntegerSamplerDescriptor(
    binding: WebGPUSamplerBinding,
    texture: Texture<unknown>,
    mipLevelCount: number
): void {
    if (!isIntegerSamplerType(binding.type)) return;
    const descriptor = createWebGPUSamplerDescriptor(texture, mipLevelCount);
    if (
        descriptor.magFilter !== 'nearest' ||
        descriptor.minFilter !== 'nearest' ||
        descriptor.mipmapFilter !== 'nearest' ||
        (descriptor.maxAnisotropy ?? 1) !== 1
    ) {
        throw new TypeError(
            `Integer sampler ${binding.name} requires nearest minification, magnification and mipmap filters with anisotropy disabled`
        );
    }
}

function declaredTextureSampleType(
    device: GPUDevice,
    sampler: ResolvedWebGPUSampler
): GPUTextureSampleType {
    const type = sampler.binding.type;
    const formatInfo = resolveWebGPUTextureFormat(sampler.texture);
    if (formatInfo.isDepth && !type.startsWith('isampler') && !type.startsWith('usampler')) {
        return 'depth';
    }
    const declaredType = type.startsWith('isampler')
        ? 'sint'
        : type.startsWith('usampler')
          ? 'uint'
          : type.endsWith('Shadow')
            ? 'depth'
            : 'float';
    if (declaredType !== 'float') {
        if (formatInfo.sampleType !== declaredType) {
            throw new TypeError(
                `Sampler ${sampler.binding.name} declares ${declaredType}, but texture ${sampler.texture.id} exposes ${formatInfo.sampleType}`
            );
        }
        if (declaredType === 'sint' || declaredType === 'uint') {
            validateIntegerSamplerDescriptor(
                sampler.binding,
                sampler.texture,
                sampler.resource.mipLevelCount
            );
        }
        return declaredType;
    }
    if (formatInfo.sampleType === 'float') return 'float';
    if (formatInfo.sampleType !== 'unfilterable-float') {
        throw new TypeError(
            `Sampler ${sampler.binding.name} requires a floating-point color texture, but ${sampler.texture.id} exposes ${formatInfo.sampleType}`
        );
    }
    if (device.features.has('float32-filterable')) return 'float';
    const descriptor = createWebGPUSamplerDescriptor(
        sampler.texture,
        sampler.resource.mipLevelCount
    );
    if (
        descriptor.magFilter === 'linear' ||
        descriptor.minFilter === 'linear' ||
        descriptor.mipmapFilter === 'linear'
    ) {
        throw new Error(
            `Texture ${sampler.texture.id} uses filtering with ${formatInfo.format}, but the adapter does not expose float32-filterable`
        );
    }
    return 'unfilterable-float';
}

function samplerBindingType(
    sampleType: GPUTextureSampleType,
    comparison: boolean
): GPUSamplerBindingType {
    if (comparison) return 'comparison';
    return sampleType === 'float' ? 'filtering' : 'non-filtering';
}

function compareUniformBlocks(
    left: TranslatedShaderPair['uniformBlocks'][number],
    right: TranslatedShaderPair['uniformBlocks'][number]
): number {
    return (
        left.group - right.group ||
        left.binding - right.binding ||
        left.name.localeCompare(right.name)
    );
}

function compareSamplers(left: ResolvedWebGPUSampler, right: ResolvedWebGPUSampler): number {
    return (
        left.binding.group - right.binding.group ||
        left.binding.textureBinding - right.binding.textureBinding ||
        left.binding.samplerBinding - right.binding.samplerBinding ||
        left.binding.name.localeCompare(right.binding.name)
    );
}

function validateSamplerDimension(sampler: ResolvedWebGPUSampler): GPUTextureViewDimension {
    const expected = samplerViewDimension(sampler.binding.type);
    if (expected !== sampler.resource.dimension) {
        throw new TypeError(
            `Sampler ${sampler.binding.name} requires a ${expected} texture view, but the resource is ${sampler.resource.dimension}`
        );
    }
    return expected;
}

function sortedUniqueEntries<T extends { readonly binding: number }>(
    entries: T[],
    group: number
): T[] {
    entries.sort((left, right) => left.binding - right.binding);
    for (let index = 1; index < entries.length; index++) {
        if (entries[index - 1]?.binding === entries[index]?.binding) {
            throw new Error(
                `WebGPU bind group ${String(group)} declares binding ${String(entries[index]?.binding)} more than once`
            );
        }
    }
    return entries;
}

function validateResourceLimits(
    shader: TranslatedShaderPair,
    samplers: readonly ResolvedWebGPUSampler[],
    limits: GPUSupportedLimits
): void {
    const groupCounts = Array.from({ length: WEBGPU_BIND_GROUP_COUNT }, () => 0);
    for (const block of shader.uniformBlocks) {
        const count = groupCounts[block.group];
        if (count === undefined) {
            throw new RangeError(
                `Uniform block ${block.name} uses bind group ${String(block.group)}`
            );
        }
        groupCounts[block.group] = count + 1;
    }
    for (const sampler of samplers) {
        const count = groupCounts[sampler.binding.group];
        if (count === undefined) {
            throw new RangeError(
                `Sampler ${sampler.binding.name} uses bind group ${String(sampler.binding.group)}`
            );
        }
        groupCounts[sampler.binding.group] = count + 2;
    }
    groupCounts.forEach((count, group) => {
        if (count > limits.maxBindingsPerBindGroup) {
            throw new RangeError(
                `WebGPU bind group ${String(group)} requires ${String(count)} bindings; the device supports ${String(limits.maxBindingsPerBindGroup)}`
            );
        }
    });

    for (const stage of ['vertex', 'fragment'] as const) {
        const uniformCount = shader.uniformBlocks.filter(block =>
            block.stages.includes(stage)
        ).length;
        const textureCount = samplers.filter(sampler =>
            sampler.binding.stages.includes(stage)
        ).length;
        if (uniformCount > limits.maxUniformBuffersPerShaderStage) {
            throw new RangeError(
                `The ${stage} shader requires ${String(uniformCount)} uniform buffers; the device supports ${String(limits.maxUniformBuffersPerShaderStage)}`
            );
        }
        if (textureCount > limits.maxSampledTexturesPerShaderStage) {
            throw new RangeError(
                `The ${stage} shader requires ${String(textureCount)} sampled textures; the device supports ${String(limits.maxSampledTexturesPerShaderStage)}`
            );
        }
        if (textureCount > limits.maxSamplersPerShaderStage) {
            throw new RangeError(
                `The ${stage} shader requires ${String(textureCount)} samplers; the device supports ${String(limits.maxSamplersPerShaderStage)}`
            );
        }
    }
}

/** Owns the explicit four-group WebGPU ABI and immutable bind-group caches. */
export default class WebGPUBindGroupManager {
    private readonly device: GPUDevice;
    private readonly textureManager: WebGPUTextureResolver;
    private readonly layouts = new Map<string, WebGPUPipelineBindingLayout>();
    private readonly groupLayouts = Array.from(
        { length: WEBGPU_BIND_GROUP_COUNT },
        () => new Map<string, GPUBindGroupLayout>()
    );
    private readonly bindGroupsByGroup = Array.from(
        { length: WEBGPU_BIND_GROUP_COUNT },
        () => new Map<string, GPUBindGroup>()
    );
    private readonly bindGroupSets = new Map<string, readonly GPUBindGroup[]>();
    private readonly objectIds = new WeakMap<object, number>();
    private nextObjectId = 1;

    constructor(device: GPUDevice, textureManager: WebGPUTextureResolver) {
        this.device = device;
        this.textureManager = textureManager;
    }

    /** Bounded cache size exposed for deterministic lifecycle diagnostics. */
    get bindGroupCacheSize(): number {
        return this.bindGroupSets.size;
    }

    resolveSampler(
        binding: WebGPUSamplerBinding,
        texture: Texture<unknown>
    ): ResolvedWebGPUSampler {
        samplerViewDimension(binding.type);
        const comparison = binding.type.endsWith('Shadow');
        const formatInfo = resolveWebGPUTextureFormat(texture);
        if (formatInfo.isDepth && binding.type.includes('3D')) {
            throw new TypeError(
                `WebGPU depth texture ${texture.id} cannot use ${binding.type}; WGSL has no 3D depth texture type`
            );
        }
        if (formatInfo.isDepth && !comparison) {
            const descriptor = createWebGPUSamplerDescriptor(texture, 1);
            if (
                descriptor.magFilter !== 'nearest' ||
                descriptor.minFilter !== 'nearest' ||
                descriptor.mipmapFilter !== 'nearest' ||
                (descriptor.maxAnisotropy ?? 1) !== 1
            ) {
                throw new TypeError(
                    `WebGPU numeric depth sampler ${binding.name} requires nearest minification, magnification and mipmap filters with anisotropy disabled`
                );
            }
        }
        if (!formatInfo.isDepth && comparison) {
            throw new TypeError(
                `WebGPU Shadow sampler ${binding.name} requires a depth texture, but ${texture.id} is a color texture`
            );
        }
        if (isIntegerSamplerType(binding.type)) {
            const expectedSampleType = binding.type.startsWith('isampler') ? 'sint' : 'uint';
            if (formatInfo.sampleType !== expectedSampleType) {
                throw new TypeError(
                    `Sampler ${binding.name} declares ${expectedSampleType}, but texture ${texture.id} exposes ${formatInfo.sampleType}`
                );
            }
            validateIntegerSamplerDescriptor(binding, texture, 1);
        } else if (
            !comparison &&
            !formatInfo.isDepth &&
            formatInfo.sampleType !== 'float' &&
            formatInfo.sampleType !== 'unfilterable-float'
        ) {
            throw new TypeError(
                `Sampler ${binding.name} requires a floating-point color texture, but ${texture.id} exposes ${formatInfo.sampleType}`
            );
        }
        return {
            binding,
            texture,
            resource: this.textureManager.get(
                texture,
                comparison
                    ? {
                          compare:
                              (this.textureManager instanceof WebGPUTextureManager
                                  ? getWebGPUTextureDefaultCompare(this.textureManager, texture)
                                  : this.textureManager.getDefaultCompare?.(texture)) ??
                              'less-equal'
                      }
                    : {}
            )
        };
    }

    getLayout(
        shader: TranslatedShaderPair,
        samplers: readonly ResolvedWebGPUSampler[]
    ): WebGPUPipelineBindingLayout {
        validateResourceLimits(shader, samplers, this.device.limits);
        const groupEntries = Array.from(
            { length: WEBGPU_BIND_GROUP_COUNT },
            () => [] as GPUBindGroupLayoutEntry[]
        );
        for (const block of [...shader.uniformBlocks].sort(compareUniformBlocks)) {
            const entries = groupEntries[block.group];
            if (!entries)
                throw new RangeError(
                    `Uniform block ${block.name} uses bind group ${String(block.group)}`
                );
            entries.push({
                binding: block.binding,
                visibility: stageVisibility(block.stages),
                buffer: { type: 'uniform' }
            });
        }
        for (const sampler of [...samplers].sort(compareSamplers)) {
            const entries = groupEntries[sampler.binding.group];
            if (!entries) {
                throw new RangeError(
                    `Sampler ${sampler.binding.name} uses bind group ${String(sampler.binding.group)}`
                );
            }
            const sampleType = declaredTextureSampleType(this.device, sampler);
            const comparison = sampler.binding.type.endsWith('Shadow');
            entries.push(
                {
                    binding: sampler.binding.textureBinding,
                    visibility: stageVisibility(sampler.binding.stages),
                    texture: {
                        sampleType,
                        viewDimension: validateSamplerDimension(sampler),
                        multisampled: false
                    }
                },
                {
                    binding: sampler.binding.samplerBinding,
                    visibility: stageVisibility(sampler.binding.stages),
                    sampler: { type: samplerBindingType(sampleType, comparison) }
                }
            );
        }
        const normalizedEntries = groupEntries.map((entries, group) =>
            sortedUniqueEntries(entries, group)
        );
        const groupSignatures = normalizedEntries.map(entries => JSON.stringify(entries));
        const signature = groupSignatures
            .map(groupSignature => `${String(groupSignature.length)}:${groupSignature}`)
            .join('|');
        const cached = this.layouts.get(signature);
        if (cached) {
            touchBoundedLruEntry(this.layouts, signature, cached, MAX_CACHED_PIPELINE_LAYOUTS);
            return cached;
        }
        const bindGroupLayouts = normalizedEntries.map((entries, group) => {
            const cache = this.groupLayouts[group];
            const groupSignature = groupSignatures[group];
            if (!cache || groupSignature === undefined) {
                throw new RangeError(`WebGPU bind group ${String(group)} is outside the ABI`);
            }
            const cachedGroup = cache.get(groupSignature);
            if (cachedGroup) {
                touchBoundedLruEntry(
                    cache,
                    groupSignature,
                    cachedGroup,
                    MAX_CACHED_BIND_GROUP_LAYOUTS_PER_GROUP
                );
                return cachedGroup;
            }
            const created = this.device.createBindGroupLayout({
                label: `Hilo3d bind group ${String(group)}`,
                entries
            });
            touchBoundedLruEntry(
                cache,
                groupSignature,
                created,
                MAX_CACHED_BIND_GROUP_LAYOUTS_PER_GROUP
            );
            return created;
        });
        const result: WebGPUPipelineBindingLayout = Object.freeze({
            signature,
            bindGroupLayouts: Object.freeze(bindGroupLayouts),
            pipelineLayout: this.device.createPipelineLayout({ bindGroupLayouts })
        });
        touchBoundedLruEntry(this.layouts, signature, result, MAX_CACHED_PIPELINE_LAYOUTS);
        return result;
    }

    getBindGroups(
        layout: WebGPUPipelineBindingLayout,
        shader: TranslatedShaderPair,
        uniformBuffers: Readonly<Record<string, WebGPUUniformBufferBinding>>,
        samplers: readonly ResolvedWebGPUSampler[]
    ): readonly GPUBindGroup[] {
        if (layout.bindGroupLayouts.length !== WEBGPU_BIND_GROUP_COUNT) {
            throw new RangeError(
                `WebGPU pipeline layouts require exactly ${String(WEBGPU_BIND_GROUP_COUNT)} bind groups`
            );
        }
        const entries = Array.from(
            { length: WEBGPU_BIND_GROUP_COUNT },
            () => [] as GPUBindGroupEntry[]
        );
        const identities = layout.bindGroupLayouts.map(
            (groupLayout, group) => [group, this.objectId(groupLayout)] as number[]
        );
        for (const block of [...shader.uniformBlocks].sort(compareUniformBlocks)) {
            const resource = uniformBuffers[block.name];
            if (!resource) throw new Error(`No WebGPU uniform buffer resolved for ${block.name}`);
            const groupEntries = entries[block.group];
            if (!groupEntries) {
                throw new RangeError(
                    `Uniform block ${block.name} uses bind group ${String(block.group)}`
                );
            }
            groupEntries.push({
                binding: block.binding,
                resource: {
                    buffer: resource.buffer,
                    offset: resource.offset,
                    size: resource.size
                }
            });
            identities[block.group]?.push(
                block.binding,
                this.objectId(resource.buffer),
                resource.offset,
                resource.size
            );
        }
        for (const sampler of [...samplers].sort(compareSamplers)) {
            const groupEntries = entries[sampler.binding.group];
            if (!groupEntries) {
                throw new RangeError(
                    `Sampler ${sampler.binding.name} uses bind group ${String(sampler.binding.group)}`
                );
            }
            groupEntries.push(
                { binding: sampler.binding.textureBinding, resource: sampler.resource.view },
                { binding: sampler.binding.samplerBinding, resource: sampler.resource.sampler }
            );
            identities[sampler.binding.group]?.push(
                sampler.binding.textureBinding,
                this.objectId(sampler.resource.view),
                sampler.binding.samplerBinding,
                this.objectId(sampler.resource.sampler)
            );
        }
        const groupKeys = identities.map(identity => identity.join(':'));
        const setKey = groupKeys.join('|');
        const cachedSet = this.bindGroupSets.get(setKey);
        if (cachedSet) {
            touchBoundedLruEntry(this.bindGroupSets, setKey, cachedSet, MAX_CACHED_BIND_GROUP_SETS);
            cachedSet.forEach((bindGroup, group) => {
                const cache = this.bindGroupsByGroup[group];
                const key = groupKeys[group];
                if (cache && key !== undefined) {
                    touchBoundedLruEntry(cache, key, bindGroup, MAX_CACHED_BIND_GROUPS_PER_GROUP);
                }
            });
            return cachedSet;
        }
        const groups = layout.bindGroupLayouts.map((groupLayout, group) => {
            const cache = this.bindGroupsByGroup[group];
            const key = groupKeys[group];
            if (!cache || key === undefined) {
                throw new RangeError(`WebGPU bind group ${String(group)} is outside the ABI`);
            }
            const cached = cache.get(key);
            if (cached) {
                touchBoundedLruEntry(cache, key, cached, MAX_CACHED_BIND_GROUPS_PER_GROUP);
                return cached;
            }
            const created = this.device.createBindGroup({
                label: `Hilo3d bind group ${String(group)}`,
                layout: groupLayout,
                entries: sortedUniqueEntries(entries[group] ?? [], group)
            });
            touchBoundedLruEntry(cache, key, created, MAX_CACHED_BIND_GROUPS_PER_GROUP);
            return created;
        });
        const result = Object.freeze(groups);
        touchBoundedLruEntry(this.bindGroupSets, setKey, result, MAX_CACHED_BIND_GROUP_SETS);
        return result;
    }

    /** Drop resource-identity caches while preserving immutable pipeline-layout identities. */
    clearBindGroups(): void {
        this.bindGroupSets.clear();
        for (const cache of this.bindGroupsByGroup) cache.clear();
    }

    /** Drop every device-owned cache. Intended for renderer/device teardown only. */
    clear(): void {
        this.clearBindGroups();
        this.layouts.clear();
        for (const cache of this.groupLayouts) cache.clear();
    }

    private objectId(object: object): number {
        let id = this.objectIds.get(object);
        if (id === undefined) {
            id = this.nextObjectId++;
            this.objectIds.set(object, id);
        }
        return id;
    }
}
