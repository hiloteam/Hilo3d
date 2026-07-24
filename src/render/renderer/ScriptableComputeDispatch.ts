import UniformBuffer, { type UniformBufferRange } from '../UniformBuffer';
import type { ComputeShaderBinding } from '../compute/ComputeShader';
import ComputeSampler from '../compute/ComputeSampler';
import type { RGBufferHandle, RGTextureHandle } from '../graph/RenderGraphResource';
import type { RGPassContext, RGPrepareContext } from '../graph/RenderGraphExecutor';
import type {
    ComputeRenderPassParameters,
    ComputeUniformBufferBinding
} from '../pipeline/passes/ComputeRenderPass';
import type ComputeRenderPass from '../pipeline/passes/ComputeRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphBufferReadUse,
    RenderGraphTextureHandle
} from '../pipeline/ScriptableRenderGraph';
import {
    RHIBufferUsage,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupLayout,
    type RHIBindingResource,
    type RHIBuffer,
    type RHIComputePipeline,
    type RHISampler
} from '../rhi/core';
import type { BufferResourceCache } from './BufferResourceCache';
import type {
    ComputePipelineResourceCache,
    ComputePipelineResourceRecord
} from './ComputePipelineResourceCache';
import type { ComputeSamplerResourceCache } from './ComputeSamplerResourceCache';
import type { FrameResourceUseTracker } from './FrameResourceUseTracker';
import type { ResourceRegistryHandle } from './ResourceRegistry';
import type { ScriptableBindGroupResourceCache } from './ScriptableBindGroupResourceCache';

const MAX_U32 = 0xffff_ffff;
const EMPTY_COMPUTE_RESOURCES: readonly never[] = Object.freeze([]);

/** @internal Public-handle resolver kept narrower than the scriptable context implementation. */
export interface ScriptableComputeGraphResolver {
    resolveBuffer(handle: RenderGraphBufferHandle, use: RenderGraphBufferReadUse): RGBufferHandle;
    bufferByteLength(handle: RenderGraphBufferHandle): number;
    resolveTexture(
        handle: RenderGraphTextureHandle,
        access: 'sampled' | 'storage-write'
    ): RGTextureHandle;
}

/** @internal Submission-fenced owner for graph-dependent frame bind groups. */
export interface ScriptableComputeFrameBindGroups {
    trackFrameBindGroup(bindGroup: RHIBindGroup): void;
    releaseFrameBindGroup(bindGroup: RHIBindGroup): void;
}

/** @internal Renderer-local services used by one configured compute dispatch. */
export interface ScriptableComputeDispatchServices {
    readonly pipelines: ComputePipelineResourceCache;
    readonly samplers: ComputeSamplerResourceCache;
    readonly uniformBuffers: BufferResourceCache;
    readonly resourceUses: FrameResourceUseTracker;
    readonly frameBindGroups: ScriptableComputeFrameBindGroups;
    readonly bindGroups: ScriptableBindGroupResourceCache;
}

interface MutableFrameBindGroupEntry {
    binding: number;
    resource: RHIBindingResource | null;
}

interface MutableBufferBinding {
    buffer: RHIBuffer | null;
    offset?: number;
    size?: number;
}

interface ComputeBindGroupScratch {
    readonly entries: MutableFrameBindGroupEntry[];
    readonly entryPool: MutableFrameBindGroupEntry[];
    readonly bufferBindings: MutableBufferBinding[];
    readonly descriptor: {
        readonly label: string;
        readonly lifetime: 'frame';
        layout: RHIBindGroupLayout | null;
        readonly entries: MutableFrameBindGroupEntry[];
    };
    bufferBindingCursor: number;
    dynamicOffsetCursor: number;
    dynamicOffsets: Uint32Array | null;
    bindGroup: RHIBindGroup | null;
    frameOwned: boolean;
}

interface MutableComputeBindingPlan {
    binding: ComputeShaderBinding | null;
    uniformHandle: ResourceRegistryHandle<RHIBuffer> | null;
    graphBuffer: RGBufferHandle | null;
    graphTexture: RGTextureHandle | null;
    sampler: ComputeSampler | null;
    byteOffset: number;
    byteLength: number;
}

interface MutableNormalizedUniformBinding {
    source: UniformBuffer | null;
    byteOffset: number;
    byteLength: number;
}

function normalizeUniformBinding(
    value: ComputeUniformBufferBinding,
    name: string,
    result: MutableNormalizedUniformBinding
): void {
    if (value instanceof UniformBuffer) {
        result.source = value;
        result.byteOffset = 0;
        result.byteLength = value.byteLength;
        return;
    }
    const range: UniformBufferRange = value;
    if (!(range.uniformBuffer instanceof UniformBuffer)) {
        throw new TypeError(`Compute uniform binding ${name} range requires a UniformBuffer`);
    }
    if (
        !Number.isSafeInteger(range.byteOffset) ||
        !Number.isSafeInteger(range.byteLength) ||
        range.byteOffset < 0 ||
        range.byteLength < 1 ||
        range.byteOffset + range.byteLength > range.uniformBuffer.byteLength
    ) {
        throw new RangeError(`Compute uniform binding ${name} has an invalid byte range`);
    }
    if (range.byteOffset % 4 !== 0 || range.byteLength % 4 !== 0) {
        throw new RangeError(`Compute uniform binding ${name} must be 4-byte aligned`);
    }
    result.source = range.uniformBuffer;
    result.byteOffset = range.byteOffset;
    result.byteLength = range.byteLength;
}

function validateBufferBindingRange(
    binding: Extract<
        ComputeShaderBinding,
        { readonly kind: 'uniform-buffer' | 'read-only-storage-buffer' | 'storage-buffer' }
    >,
    byteOffset: number,
    byteLength: number,
    resourceByteLength: number,
    uniform: boolean,
    services: ScriptableComputeDispatchServices
): void {
    const path = `Compute binding ${binding.name}`;
    if (
        !Number.isSafeInteger(byteOffset) ||
        !Number.isSafeInteger(byteLength) ||
        byteOffset < 0 ||
        byteLength < 1 ||
        byteOffset + byteLength > resourceByteLength
    ) {
        throw new RangeError(`${path} has an invalid byte range`);
    }
    if (byteOffset % 4 !== 0 || byteLength % 4 !== 0) {
        throw new RangeError(`${path} byte offset and length must be 4-byte aligned`);
    }
    if (byteLength < (binding.minBindingSize ?? 0)) {
        throw new RangeError(`${path} is smaller than minBindingSize`);
    }
    const limits = services.pipelines.registry.deviceCapabilities.limits;
    const alignment = uniform
        ? limits.minUniformBufferOffsetAlignment
        : limits.minStorageBufferOffsetAlignment;
    if (alignment === undefined) {
        throw new Error(`${path} requires unavailable storage-buffer alignment limits`);
    }
    if (byteOffset % alignment !== 0) {
        throw new RangeError(
            `${path} byte offset does not meet device alignment ${String(alignment)}`
        );
    }
    const maximum = uniform
        ? limits.maxUniformBufferBindingSize
        : limits.maxStorageBufferBindingSize;
    if (maximum === undefined) {
        throw new Error(`${path} requires unavailable storage-buffer binding limits`);
    }
    if (byteLength > maximum) {
        throw new RangeError(`${path} byte length exceeds the device binding-size limit`);
    }
    if (binding.dynamicOffset === true && byteOffset > MAX_U32) {
        throw new RangeError(`${path} dynamic byte offset exceeds uint32 range`);
    }
}

function cleanupFailure(primary: unknown, cleanup: unknown, label: string): AggregateError {
    return new AggregateError([primary, cleanup], `${label} and cleanup failed`, {
        cause: primary
    });
}

function executionFailure(reason: unknown): Error {
    return reason instanceof Error
        ? reason
        : new Error(`Compute dispatch failed: ${String(reason)}`, { cause: reason });
}

/**
 * @internal Prepared command packet behind the public ComputeRenderPass.
 *
 * Configuration snapshots positional public parameters during graph setup. Native pipeline and
 * graph-dependent bind groups are created only during graph prepare, while execute emits only one
 * direct or indirect dispatch and deterministic cleanup.
 */
export class ScriptableComputeDispatch {
    readonly #bindingPlans: MutableComputeBindingPlan[] = [];
    readonly #groups: (ComputeBindGroupScratch | undefined)[] = [];
    readonly #activeGroups: number[] = [];
    readonly #cleanupFailures: unknown[] = [];
    readonly #computePassDescriptor = { label: '' };
    readonly #uniformBindingScratch: MutableNormalizedUniformBinding = {
        source: null,
        byteOffset: 0,
        byteLength: 0
    };
    #bindingCount = 0;
    #kernelPass: ComputeRenderPass | null = null;
    #services: ScriptableComputeDispatchServices | null = null;
    #pipeline: RHIComputePipeline | null = null;
    #directX = 0;
    #directY = 1;
    #directZ = 1;
    #indirectBuffer: RGBufferHandle | null = null;
    #indirectOffset = 0;
    #configured = false;
    #prepared = false;

    configure(
        pass: ComputeRenderPass,
        parameters: ComputeRenderPassParameters,
        resolver: ScriptableComputeGraphResolver,
        services: ScriptableComputeDispatchServices,
        frameIndex: number
    ): void {
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
            throw new RangeError('Compute dispatch frame index must be non-negative');
        }
        this.cleanup(services.frameBindGroups);
        this.resetBindingPlans();
        this.#kernelPass = pass;
        this.#services = services;
        this.#pipeline = null;
        this.#computePassDescriptor.label = pass.name;
        this.#configured = false;
        this.#prepared = false;

        const uniforms = parameters.uniformBuffers ?? EMPTY_COMPUTE_RESOURCES;
        const buffers = parameters.buffers;
        const textures = parameters.textures;
        const samplers = parameters.samplers ?? EMPTY_COMPUTE_RESOURCES;
        let uniformIndex = 0;
        let bufferIndex = 0;
        let textureIndex = 0;
        let samplerIndex = 0;

        for (const binding of pass.kernel.shader.bindings) {
            const plan = this.bindingPlanAt(this.#bindingCount++);
            plan.binding = binding;
            switch (binding.kind) {
                case 'uniform-buffer': {
                    const value = uniforms[uniformIndex++];
                    if (value === undefined) {
                        throw new TypeError(`Compute uniform binding ${binding.name} is missing`);
                    }
                    const range = this.#uniformBindingScratch;
                    normalizeUniformBinding(value, binding.name, range);
                    const source = range.source;
                    if (source === null) {
                        throw new Error(`Compute uniform binding ${binding.name} is incomplete`);
                    }
                    validateBufferBindingRange(
                        binding,
                        range.byteOffset,
                        range.byteLength,
                        source.byteLength,
                        true,
                        services
                    );
                    services.uniformBuffers.prepareUniformBuffer(source);
                    const handle = services.uniformBuffers.getUniformBufferHandle(source);
                    services.resourceUses.use(handle);
                    plan.uniformHandle = handle;
                    plan.byteOffset = range.byteOffset;
                    plan.byteLength = range.byteLength;
                    range.source = null;
                    break;
                }
                case 'read-only-storage-buffer':
                case 'storage-buffer': {
                    const value = buffers[bufferIndex++];
                    if (value === undefined) {
                        throw new TypeError(`Compute storage binding ${binding.name} is missing`);
                    }
                    const byteLength = resolver.bufferByteLength(value.buffer);
                    const byteOffset = value.byteOffset ?? 0;
                    const bindingByteLength = value.byteLength ?? byteLength - byteOffset;
                    validateBufferBindingRange(
                        binding,
                        byteOffset,
                        bindingByteLength,
                        byteLength,
                        false,
                        services
                    );
                    if (
                        binding.kind === 'storage-buffer' &&
                        binding.access === 'write-discard' &&
                        (byteOffset !== 0 || bindingByteLength !== byteLength)
                    ) {
                        throw new RangeError(
                            `Compute write-discard binding ${binding.name} must cover the complete buffer`
                        );
                    }
                    plan.graphBuffer = resolver.resolveBuffer(value.buffer, 'storage');
                    plan.byteOffset = byteOffset;
                    plan.byteLength = bindingByteLength;
                    break;
                }
                case 'sampled-texture':
                case 'storage-texture': {
                    const value = textures[textureIndex++];
                    if (value === undefined) {
                        throw new TypeError(`Compute texture binding ${binding.name} is missing`);
                    }
                    plan.graphTexture = resolver.resolveTexture(
                        value.texture,
                        binding.kind === 'sampled-texture' ? 'sampled' : 'storage-write'
                    );
                    break;
                }
                case 'sampler':
                case 'non-filtering-sampler':
                case 'comparison-sampler': {
                    const value = samplers[samplerIndex++];
                    if (!(value instanceof ComputeSampler)) {
                        throw new TypeError(`Compute sampler binding ${binding.name} is invalid`);
                    }
                    if ((binding.kind === 'comparison-sampler') !== (value.compare !== undefined)) {
                        throw new TypeError(
                            `Compute sampler binding ${binding.name} has an incompatible comparison mode`
                        );
                    }
                    if (
                        binding.kind === 'non-filtering-sampler' &&
                        (value.magFilter !== 'nearest' ||
                            value.minFilter !== 'nearest' ||
                            value.mipmapFilter !== 'nearest' ||
                            value.maxAnisotropy !== 1)
                    ) {
                        throw new TypeError(
                            `Compute sampler binding ${binding.name} requires nearest filters and maxAnisotropy 1`
                        );
                    }
                    plan.sampler = value;
                    break;
                }
            }
        }

        if (
            uniformIndex !== uniforms.length ||
            bufferIndex !== buffers.length ||
            textureIndex !== textures.length ||
            samplerIndex !== samplers.length
        ) {
            throw new RangeError('Compute binding arrays do not match the positional shader ABI');
        }
        this.validateWritableAliases();

        const dispatch = parameters.dispatch;
        if ('indirectBuffer' in dispatch) {
            this.#indirectBuffer = resolver.resolveBuffer(dispatch.indirectBuffer, 'indirect');
            this.#indirectOffset = dispatch.indirectOffset ?? 0;
            this.#directX = 0;
            this.#directY = 1;
            this.#directZ = 1;
        } else {
            this.#indirectBuffer = null;
            this.#indirectOffset = 0;
            this.#directX = dispatch.x;
            this.#directY = dispatch.y ?? 1;
            this.#directZ = dispatch.z ?? 1;
        }
        this.#configured = true;
    }

    prepare(context: RGPrepareContext): void {
        this.assertConfigured();
        const pass = this.requirePass();
        const services = this.requireServices();
        this.cleanup(services.frameBindGroups);
        try {
            const record = services.pipelines.prepare(pass.kernel);
            this.stagePipelineUses(record, services.resourceUses);
            this.#pipeline = services.pipelines.registry.resolve(record.pipeline);
            this.prepareDispatch(context, services);

            this.#activeGroups.length = 0;
            for (let bindingIndex = 0; bindingIndex < this.#bindingCount; bindingIndex += 1) {
                const plan = this.#bindingPlans[bindingIndex];
                if (plan === undefined) {
                    throw new Error('Compute binding plan is incomplete');
                }
                const binding = plan.binding;
                if (binding === null) {
                    throw new Error('Compute binding plan is incomplete');
                }
                const group = this.groupAt(binding.group);
                if (group.entries.length === 0) {
                    group.bufferBindingCursor = 0;
                    group.dynamicOffsetCursor = 0;
                    const layoutHandle = record.bindGroupLayouts[binding.group];
                    if (layoutHandle === undefined) {
                        throw new Error(
                            `Compute bind group ${String(binding.group)} has no pipeline layout`
                        );
                    }
                    const layout = services.pipelines.registry.resolve(layoutHandle);
                    group.descriptor.layout = layout;
                    let dynamicCount = 0;
                    for (const entry of layout.entries) {
                        if (entry.buffer?.hasDynamicOffset === true) dynamicCount += 1;
                    }
                    if (dynamicCount === 0) group.dynamicOffsets = null;
                    else if (group.dynamicOffsets?.length !== dynamicCount) {
                        group.dynamicOffsets = new Uint32Array(dynamicCount);
                    }
                    this.#activeGroups.push(binding.group);
                }
                this.prepareBinding(context, plan, group, services);
            }

            for (const groupIndex of this.#activeGroups) {
                const group = this.#groups[groupIndex];
                if (group === undefined) {
                    throw new Error(`Compute bind group ${String(groupIndex)} is incomplete`);
                }
                if (group.descriptor.layout === null) {
                    throw new Error(`Compute bind group ${String(groupIndex)} is incomplete`);
                }
                if ((group.dynamicOffsets?.length ?? 0) !== group.dynamicOffsetCursor) {
                    throw new Error(
                        `Compute bind group ${String(groupIndex)} dynamic offsets are incomplete`
                    );
                }
                const stableHandle = services.bindGroups.prepare(
                    this,
                    groupIndex,
                    group.descriptor as RHIBindGroupDescriptor
                );
                const bindGroup =
                    stableHandle === null
                        ? services.pipelines.registry.createFrameBindGroup(
                              group.descriptor as RHIBindGroupDescriptor
                          )
                        : services.pipelines.registry.resolve(stableHandle);
                group.bindGroup = bindGroup;
                group.frameOwned = stableHandle === null;
                if (stableHandle === null) {
                    services.frameBindGroups.trackFrameBindGroup(bindGroup);
                } else {
                    services.resourceUses.use(stableHandle);
                }
            }
            services.bindGroups.prune(this, this.#activeGroups);
            this.#prepared = true;
        } catch (error) {
            try {
                this.cleanup(services.frameBindGroups);
            } catch (cleanup) {
                throw cleanupFailure(error, cleanup, `${pass.name} preparation`);
            }
            throw error;
        }
    }

    execute(context: RGPassContext): void {
        if (!this.#prepared || this.#pipeline === null) {
            throw new Error('Compute dispatch must be prepared before execution');
        }
        const pass = this.requirePass();
        const services = this.requireServices();
        let primaryFailure: unknown = null;
        try {
            const encoder = context.commandContext.beginComputePass(this.#computePassDescriptor);
            encoder.setPipeline(this.#pipeline);
            for (const groupIndex of this.#activeGroups) {
                const group = this.#groups[groupIndex];
                const bindGroup = group?.bindGroup;
                if (group === undefined || bindGroup === null || bindGroup === undefined) {
                    throw new Error(`Compute bind group ${String(groupIndex)} was not prepared`);
                }
                const dynamicOffsets = group.dynamicOffsets;
                encoder.setBindGroup(groupIndex, bindGroup, dynamicOffsets ?? undefined);
            }
            if (this.#indirectBuffer === null) {
                encoder.dispatchWorkgroups(this.#directX, this.#directY, this.#directZ);
            } else {
                encoder.dispatchWorkgroupsIndirect(
                    context.getBuffer(this.#indirectBuffer),
                    this.#indirectOffset
                );
            }
            encoder.end();
        } catch (error) {
            primaryFailure = error;
        }
        try {
            this.cleanup(services.frameBindGroups);
        } catch (cleanup) {
            if (primaryFailure !== null) {
                throw cleanupFailure(primaryFailure, cleanup, `${pass.name} execution`);
            }
            throw cleanup;
        }
        if (primaryFailure !== null) throw executionFailure(primaryFailure);
    }

    releaseFrameReferences(): void {
        const services = this.#services;
        if (services !== null) this.cleanup(services.frameBindGroups);
        this.resetBindingPlans();
        this.#kernelPass = null;
        this.#services = null;
        this.#pipeline = null;
        this.#uniformBindingScratch.source = null;
        this.#configured = false;
        this.#prepared = false;
    }

    private prepareDispatch(
        context: RGPrepareContext,
        services: ScriptableComputeDispatchServices
    ): void {
        const capabilities = services.pipelines.registry.deviceCapabilities;
        if (this.#indirectBuffer !== null) {
            if (!capabilities.features.has('indirect-draw')) {
                throw new Error('Indirect compute dispatch is unsupported by this device');
            }
            const buffer = context.getBuffer(this.#indirectBuffer);
            if ((buffer.usage & RHIBufferUsage.INDIRECT) === 0) {
                throw new Error('Compute indirect buffer lacks INDIRECT usage');
            }
            if (buffer.mapState !== 'unmapped') {
                throw new Error('Compute indirect buffer must be unmapped');
            }
            if (this.#indirectOffset + 12 > buffer.size) {
                throw new RangeError('Compute indirect dispatch range exceeds its buffer');
            }
            return;
        }
        const maximum = capabilities.limits.maxComputeWorkgroupsPerDimension;
        if (maximum === undefined) {
            throw new Error('Compute workgroup dispatch limit is unavailable');
        }
        if (this.#directX > maximum || this.#directY > maximum || this.#directZ > maximum) {
            throw new RangeError('Compute dispatch dimensions exceed the device limit');
        }
    }

    private prepareBinding(
        context: RGPrepareContext,
        plan: MutableComputeBindingPlan,
        group: ComputeBindGroupScratch,
        services: ScriptableComputeDispatchServices
    ): void {
        const binding = plan.binding;
        if (binding === null) throw new Error('Compute binding plan has no ABI binding');
        switch (binding.kind) {
            case 'uniform-buffer': {
                const handle = plan.uniformHandle;
                if (handle === null) throw new Error(`Compute uniform ${binding.name} is missing`);
                this.addBufferEntry(
                    group,
                    binding,
                    services.uniformBuffers.registry.resolve(handle),
                    plan.byteOffset,
                    plan.byteLength
                );
                break;
            }
            case 'read-only-storage-buffer':
            case 'storage-buffer': {
                const handle = plan.graphBuffer;
                if (handle === null) throw new Error(`Compute storage ${binding.name} is missing`);
                this.addBufferEntry(
                    group,
                    binding,
                    context.getBuffer(handle),
                    plan.byteOffset,
                    plan.byteLength
                );
                break;
            }
            case 'sampled-texture':
            case 'storage-texture': {
                const handle = plan.graphTexture;
                if (handle === null) throw new Error(`Compute texture ${binding.name} is missing`);
                this.addEntry(group, binding.binding, context.getTextureView(handle));
                break;
            }
            case 'sampler':
            case 'non-filtering-sampler':
            case 'comparison-sampler': {
                const sampler = plan.sampler;
                if (sampler === null) throw new Error(`Compute sampler ${binding.name} is missing`);
                const handle = services.samplers.prepare(sampler);
                services.resourceUses.use(handle);
                const resource: RHISampler = services.samplers.resolve(sampler);
                this.addEntry(group, binding.binding, resource);
                break;
            }
        }
    }

    private addBufferEntry(
        group: ComputeBindGroupScratch,
        binding: Extract<
            ComputeShaderBinding,
            { readonly kind: 'uniform-buffer' | 'read-only-storage-buffer' | 'storage-buffer' }
        >,
        buffer: RHIBuffer,
        byteOffset: number,
        byteLength: number
    ): void {
        let resource = group.bufferBindings[group.bufferBindingCursor++];
        if (resource === undefined) {
            resource = { buffer: null };
            group.bufferBindings.push(resource);
        }
        resource.buffer = buffer;
        resource.offset = binding.dynamicOffset === true ? 0 : byteOffset;
        resource.size = byteLength;
        if (binding.dynamicOffset === true) {
            const offsets = group.dynamicOffsets;
            if (offsets === null || group.dynamicOffsetCursor >= offsets.length) {
                throw new Error(`Compute dynamic offset for ${binding.name} has no storage`);
            }
            offsets[group.dynamicOffsetCursor++] = byteOffset;
        }
        this.addEntry(
            group,
            binding.binding,
            resource as {
                readonly buffer: RHIBuffer;
                readonly offset: number;
                readonly size: number;
            }
        );
    }

    private stagePipelineUses(
        record: Readonly<ComputePipelineResourceRecord>,
        tracker: FrameResourceUseTracker
    ): void {
        tracker.use(record.shader);
        for (const layout of record.bindGroupLayouts) tracker.use(layout);
        tracker.use(record.pipelineLayout);
        tracker.use(record.pipeline);
    }

    private validateWritableAliases(): void {
        for (let leftIndex = 0; leftIndex < this.#bindingCount; leftIndex += 1) {
            const left = this.#bindingPlans[leftIndex];
            const leftBinding = left?.binding;
            if (left === undefined || leftBinding === null || leftBinding === undefined) continue;
            for (let rightIndex = leftIndex + 1; rightIndex < this.#bindingCount; rightIndex += 1) {
                const right = this.#bindingPlans[rightIndex];
                const rightBinding = right?.binding;
                if (right === undefined || rightBinding === null || rightBinding === undefined) {
                    continue;
                }
                const leftIsBuffer =
                    leftBinding.kind === 'read-only-storage-buffer' ||
                    leftBinding.kind === 'storage-buffer';
                const rightIsBuffer =
                    rightBinding.kind === 'read-only-storage-buffer' ||
                    rightBinding.kind === 'storage-buffer';
                if (
                    leftIsBuffer &&
                    rightIsBuffer &&
                    left.graphBuffer !== null &&
                    left.graphBuffer === right.graphBuffer &&
                    (leftBinding.kind === 'storage-buffer' ||
                        rightBinding.kind === 'storage-buffer') &&
                    left.byteOffset < right.byteOffset + right.byteLength &&
                    right.byteOffset < left.byteOffset + left.byteLength
                ) {
                    throw new TypeError(
                        `Compute bindings ${leftBinding.name} and ${rightBinding.name} alias an overlapping writable buffer range`
                    );
                }
                const leftIsTexture =
                    leftBinding.kind === 'sampled-texture' ||
                    leftBinding.kind === 'storage-texture';
                const rightIsTexture =
                    rightBinding.kind === 'sampled-texture' ||
                    rightBinding.kind === 'storage-texture';
                if (
                    leftIsTexture &&
                    rightIsTexture &&
                    left.graphTexture !== null &&
                    left.graphTexture === right.graphTexture &&
                    (leftBinding.kind === 'storage-texture' ||
                        rightBinding.kind === 'storage-texture')
                ) {
                    throw new TypeError(
                        `Compute bindings ${leftBinding.name} and ${rightBinding.name} alias a writable texture view`
                    );
                }
            }
        }
    }

    private groupAt(index: number): ComputeBindGroupScratch {
        let group = this.#groups[index];
        if (group === undefined) {
            const entries: MutableFrameBindGroupEntry[] = [];
            group = {
                entries,
                entryPool: [],
                bufferBindings: [],
                descriptor: {
                    label: `Scriptable compute group ${String(index)}`,
                    lifetime: 'frame',
                    layout: null,
                    entries
                },
                bufferBindingCursor: 0,
                dynamicOffsetCursor: 0,
                dynamicOffsets: null,
                bindGroup: null,
                frameOwned: false
            };
            this.#groups[index] = group;
        }
        return group;
    }

    private addEntry(
        group: ComputeBindGroupScratch,
        binding: number,
        resource: RHIBindingResource
    ): void {
        const index = group.entries.length;
        let entry = group.entryPool[index];
        if (entry === undefined) {
            entry = { binding, resource };
            group.entryPool.push(entry);
        } else {
            entry.binding = binding;
            entry.resource = resource;
        }
        group.entries.push(entry);
    }

    private bindingPlanAt(index: number): MutableComputeBindingPlan {
        let plan = this.#bindingPlans[index];
        if (plan === undefined) {
            plan = {
                binding: null,
                uniformHandle: null,
                graphBuffer: null,
                graphTexture: null,
                sampler: null,
                byteOffset: 0,
                byteLength: 0
            };
            this.#bindingPlans.push(plan);
        }
        return plan;
    }

    private cleanup(owner: ScriptableComputeFrameBindGroups): void {
        const failures = this.#cleanupFailures;
        failures.length = 0;
        for (const group of this.#groups) {
            if (group === undefined) continue;
            const bindGroup = group.bindGroup;
            const frameOwned = group.frameOwned;
            group.bindGroup = null;
            group.frameOwned = false;
            group.entries.length = 0;
            group.bufferBindingCursor = 0;
            group.dynamicOffsetCursor = 0;
            if (bindGroup === null || !frameOwned) continue;
            try {
                owner.releaseFrameBindGroup(bindGroup);
            } catch (error) {
                failures.push(error);
            }
        }
        this.#activeGroups.length = 0;
        this.#prepared = false;
        if (failures.length === 1) {
            const failure = failures[0];
            failures.length = 0;
            throw failure;
        }
        if (failures.length > 1) {
            const failure = new AggregateError(
                failures,
                'Compute frame bind groups failed during cleanup',
                {
                    cause: failures[0]
                }
            );
            failures.length = 0;
            throw failure;
        }
    }

    private resetBindingPlans(): void {
        for (let index = 0; index < this.#bindingCount; index += 1) {
            const plan = this.#bindingPlans[index];
            if (plan === undefined) continue;
            plan.binding = null;
            plan.uniformHandle = null;
            plan.graphBuffer = null;
            plan.graphTexture = null;
            plan.sampler = null;
            plan.byteOffset = 0;
            plan.byteLength = 0;
        }
        this.#bindingCount = 0;
        this.#indirectBuffer = null;
        this.#indirectOffset = 0;
    }

    private assertConfigured(): void {
        if (!this.#configured) throw new Error('Compute dispatch is not configured');
    }

    private requirePass(): ComputeRenderPass {
        const pass = this.#kernelPass;
        if (pass === null) throw new Error('Compute dispatch has no pass');
        return pass;
    }

    private requireServices(): ScriptableComputeDispatchServices {
        const services = this.#services;
        if (services === null) throw new Error('Compute dispatch has no renderer services');
        return services;
    }
}

export default ScriptableComputeDispatch;
