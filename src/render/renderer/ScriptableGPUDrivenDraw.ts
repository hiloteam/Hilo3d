import UniformBuffer, { type UniformBufferRange } from '../UniformBuffer';
import type { ShaderReadBinding } from '../compute/ComputeShader';
import ComputeSampler from '../compute/ComputeSampler';
import type { RGBufferHandle, RGTextureHandle } from '../graph/RenderGraphResource';
import type { RGPrepareContext } from '../graph/RenderGraphExecutor';
import type {
    GPUDrivenRenderPassParameters,
    GPUDrivenRenderPass
} from '../pipeline/passes/GPUDrivenRenderPass';
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
    type RHIGraphicsPipeline
} from '../rhi/core';
import type { BufferResourceCache } from './BufferResourceCache';
import type { ComputeSamplerResourceCache } from './ComputeSamplerResourceCache';
import type { FrameResourceUseTracker } from './FrameResourceUseTracker';
import type {
    GPUDrivenPipelineResourceCache,
    GPUDrivenPipelineResourceRecord
} from './GPUDrivenPipelineResourceCache';
import { PreparedDraw } from './PreparedDraw';
import {
    mapRHIMeshDrawDynamicState,
    type RHIMeshDrawTargetDescriptor
} from './RHIDescriptorMapping';

const MAX_U32 = 0xffff_ffff;
const EMPTY_READONLY_ARRAY: readonly never[] = Object.freeze([]);

function requireRuntimeArray(value: unknown, path: string): void {
    if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
}

/** @internal Public graph-handle resolver used by the GPU-driven prepared packet. */
export interface ScriptableGPUDrivenGraphResolver {
    resolveBuffer(handle: RenderGraphBufferHandle, use: RenderGraphBufferReadUse): RGBufferHandle;
    bufferByteLength(handle: RenderGraphBufferHandle): number;
    resolveTexture(handle: RenderGraphTextureHandle, access: 'sampled'): RGTextureHandle;
}

/** @internal Submission-fenced owner for graph-dependent frame bind groups. */
export interface ScriptableGPUDrivenFrameBindGroups {
    trackFrameBindGroup(bindGroup: RHIBindGroup): void;
    releaseFrameBindGroup(bindGroup: RHIBindGroup): void;
}

/** @internal Renderer-local services needed to prepare one storage-aware draw. */
export interface ScriptableGPUDrivenDrawServices {
    readonly pipelines: GPUDrivenPipelineResourceCache;
    readonly samplers: ComputeSamplerResourceCache;
    readonly uniformBuffers: BufferResourceCache;
    readonly resourceUses: FrameResourceUseTracker;
    readonly frameBindGroups: ScriptableGPUDrivenFrameBindGroups;
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

interface BindGroupScratch {
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
}

interface MutableBindingPlan {
    binding: ShaderReadBinding | null;
    uniformSource: UniformBuffer | null;
    graphBuffer: RGBufferHandle | null;
    graphTexture: RGTextureHandle | null;
    sampler: ComputeSampler | null;
    byteOffset: number;
    byteLength: number;
}

interface MutableGraphBufferPlan {
    handle: RGBufferHandle | null;
    byteOffset: number;
    byteLength: number;
}

interface NormalizedUniformBinding {
    readonly source: UniformBuffer;
    readonly byteOffset: number;
    readonly byteLength: number;
}

function isUniformBuffer(value: unknown): value is UniformBuffer {
    return value instanceof UniformBuffer;
}

function normalizeUniformBinding(value: unknown, name: string): NormalizedUniformBinding {
    if (isUniformBuffer(value)) {
        return { source: value, byteOffset: 0, byteLength: value.byteLength };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError(`GPU-driven uniform binding ${name} must be a UniformBuffer or range`);
    }
    const range = value as Partial<UniformBufferRange>;
    const source = range.uniformBuffer;
    if (!isUniformBuffer(source)) {
        throw new TypeError(`GPU-driven uniform binding ${name} range requires a UniformBuffer`);
    }
    const byteOffset = range.byteOffset;
    const byteLength = range.byteLength;
    if (
        typeof byteOffset !== 'number' ||
        typeof byteLength !== 'number' ||
        !Number.isSafeInteger(byteOffset) ||
        !Number.isSafeInteger(byteLength) ||
        byteOffset < 0 ||
        byteLength < 1 ||
        byteOffset + byteLength > source.byteLength
    ) {
        throw new RangeError(`GPU-driven uniform binding ${name} has an invalid byte range`);
    }
    if (byteOffset % 4 !== 0 || byteLength % 4 !== 0) {
        throw new RangeError(`GPU-driven uniform binding ${name} must be 4-byte aligned`);
    }
    return {
        source,
        byteOffset,
        byteLength
    };
}

function validateBufferBindingRange(
    binding: Extract<
        ShaderReadBinding,
        { readonly kind: 'uniform-buffer' | 'read-only-storage-buffer' }
    >,
    byteOffset: number,
    byteLength: number,
    resourceByteLength: number,
    uniform: boolean,
    services: ScriptableGPUDrivenDrawServices
): void {
    const path = `GPU-driven binding ${binding.name}`;
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
        throw new Error(`${path} requires unavailable buffer alignment limits`);
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
        throw new Error(`${path} requires unavailable buffer binding limits`);
    }
    if (byteLength > maximum) {
        throw new RangeError(`${path} byte length exceeds the device binding-size limit`);
    }
    if (binding.dynamicOffset === true && byteOffset > MAX_U32) {
        throw new RangeError(`${path} dynamic byte offset exceeds uint32 range`);
    }
}

function compareBindingEntries(
    left: MutableFrameBindGroupEntry,
    right: MutableFrameBindGroupEntry
): number {
    return left.binding - right.binding;
}

function cleanupFailure(primary: unknown, cleanup: unknown, label: string): AggregateError {
    return new AggregateError([primary, cleanup], `${label} and cleanup failed`, {
        cause: primary
    });
}

/**
 * @internal Prepared packet behind GPUDrivenRenderPass.
 *
 * It stores graph identities during setup, creates recovery-aware pipeline/binding resources in
 * prepare, and seals one ordinary PreparedDraw for the shared raster executor.
 */
export class ScriptableGPUDrivenDraw {
    readonly #bindingPlans: MutableBindingPlan[] = [];
    readonly #vertexPlans: MutableGraphBufferPlan[] = [];
    readonly #groups: (BindGroupScratch | undefined)[] = [];
    readonly #activeGroups: number[] = [];
    readonly #targetColorFormats: RHIMeshDrawTargetDescriptor['colorFormats'][number][] = [];
    readonly #target: RHIMeshDrawTargetDescriptor = {
        colorFormats: this.#targetColorFormats,
        depthStencilFormat: null,
        sampleCount: 1
    };
    #bindingCount = 0;
    #vertexCount = 0;
    #pass: GPUDrivenRenderPass | null = null;
    #parameters: GPUDrivenRenderPassParameters | null = null;
    #services: ScriptableGPUDrivenDrawServices | null = null;
    #pipeline: RHIGraphicsPipeline | null = null;
    #draw: PreparedDraw | null = null;
    readonly #indexPlan: MutableGraphBufferPlan = {
        handle: null,
        byteOffset: 0,
        byteLength: 0
    };
    #usesIndexPlan = false;
    #indirectHandle: RGBufferHandle | null = null;
    #indirectOffset = 0;
    #frameIndex = -1;
    #configured = false;

    get draw(): PreparedDraw {
        const draw = this.#draw;
        if (draw === null) throw new Error('GPU-driven draw is not configured');
        return draw;
    }

    configure(
        pass: GPUDrivenRenderPass,
        parameters: GPUDrivenRenderPassParameters,
        resolver: ScriptableGPUDrivenGraphResolver,
        services: ScriptableGPUDrivenDrawServices,
        target: RHIMeshDrawTargetDescriptor,
        frameIndex: number
    ): void {
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
            throw new RangeError('GPU-driven frame index must be non-negative');
        }
        this.cleanup(services.frameBindGroups);
        this.resetPlans();
        this.#pass = pass;
        this.#parameters = parameters;
        this.#services = services;
        this.#pipeline = null;
        this.#frameIndex = frameIndex;
        this.#configured = false;
        this.snapshotTarget(target);

        const uniforms = parameters.uniformBuffers ?? EMPTY_READONLY_ARRAY;
        requireRuntimeArray(uniforms, 'GPU-driven uniformBuffers');
        const buffers = parameters.buffers;
        requireRuntimeArray(buffers, 'GPU-driven buffers');
        const textures = parameters.textures ?? EMPTY_READONLY_ARRAY;
        requireRuntimeArray(textures, 'GPU-driven textures');
        const samplers = parameters.samplers ?? EMPTY_READONLY_ARRAY;
        requireRuntimeArray(samplers, 'GPU-driven samplers');
        let uniformIndex = 0;
        let bufferIndex = 0;
        let textureIndex = 0;
        let samplerIndex = 0;
        for (const binding of pass.shader.bindings) {
            const plan = this.bindingPlanAt(this.#bindingCount++);
            plan.binding = binding;
            switch (binding.kind) {
                case 'uniform-buffer': {
                    const value = uniforms[uniformIndex++];
                    if (value === undefined) {
                        throw new TypeError(
                            `GPU-driven uniform binding ${binding.name} is missing`
                        );
                    }
                    const range = normalizeUniformBinding(value, binding.name);
                    validateBufferBindingRange(
                        binding,
                        range.byteOffset,
                        range.byteLength,
                        range.source.byteLength,
                        true,
                        services
                    );
                    plan.uniformSource = range.source;
                    plan.byteOffset = range.byteOffset;
                    plan.byteLength = range.byteLength;
                    break;
                }
                case 'read-only-storage-buffer': {
                    const value = buffers[bufferIndex++];
                    if (value === undefined) {
                        throw new TypeError(
                            `GPU-driven storage binding ${binding.name} is missing`
                        );
                    }
                    const resourceByteLength = resolver.bufferByteLength(value.buffer);
                    const byteOffset = value.byteOffset ?? 0;
                    const byteLength = value.byteLength ?? resourceByteLength - byteOffset;
                    validateBufferBindingRange(
                        binding,
                        byteOffset,
                        byteLength,
                        resourceByteLength,
                        false,
                        services
                    );
                    plan.graphBuffer = resolver.resolveBuffer(value.buffer, 'storage');
                    plan.byteOffset = byteOffset;
                    plan.byteLength = byteLength;
                    break;
                }
                case 'sampled-texture': {
                    const value = textures[textureIndex++];
                    if (value === undefined) {
                        throw new TypeError(
                            `GPU-driven texture binding ${binding.name} is missing`
                        );
                    }
                    plan.graphTexture = resolver.resolveTexture(value.texture, 'sampled');
                    break;
                }
                case 'sampler':
                case 'comparison-sampler': {
                    const value = samplers[samplerIndex++];
                    if (!(value instanceof ComputeSampler)) {
                        throw new TypeError(
                            `GPU-driven sampler binding ${binding.name} is invalid`
                        );
                    }
                    if ((binding.kind === 'comparison-sampler') !== (value.compare !== undefined)) {
                        throw new TypeError(
                            `GPU-driven sampler binding ${binding.name} has an incompatible comparison mode`
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
            throw new RangeError(
                'GPU-driven binding arrays do not match the positional shader ABI'
            );
        }

        const vertexBuffers = parameters.vertexBuffers ?? EMPTY_READONLY_ARRAY;
        requireRuntimeArray(vertexBuffers, 'GPU-driven vertexBuffers');
        for (let index = 0; index < vertexBuffers.length; index++) {
            const value = vertexBuffers[index];
            if (value === undefined)
                throw new TypeError('GPU-driven vertex buffer array is sparse');
            const plan = this.vertexPlanAt(this.#vertexCount++);
            const resourceByteLength = resolver.bufferByteLength(value.buffer);
            plan.byteOffset = value.byteOffset ?? 0;
            plan.byteLength = value.byteLength ?? resourceByteLength - plan.byteOffset;
            validateGraphInputRange(
                plan,
                resourceByteLength,
                `GPU-driven vertex buffer ${String(index)}`
            );
            plan.handle = resolver.resolveBuffer(value.buffer, 'vertex');
        }

        const draw = parameters.draw;
        this.#usesIndexPlan = false;
        this.#indexPlan.handle = null;
        this.#indexPlan.byteOffset = 0;
        this.#indexPlan.byteLength = 0;
        if (draw.kind === 'draw-indexed-indirect') {
            const value = parameters.indexBuffer;
            if (value === undefined)
                throw new TypeError('GPU-driven indexed draw is missing its index buffer');
            const resourceByteLength = resolver.bufferByteLength(value.buffer);
            const indexPlan = this.#indexPlan;
            indexPlan.byteOffset = value.byteOffset ?? 0;
            indexPlan.byteLength = value.byteLength ?? resourceByteLength - indexPlan.byteOffset;
            validateGraphInputRange(indexPlan, resourceByteLength, 'GPU-driven index buffer');
            indexPlan.handle = resolver.resolveBuffer(value.buffer, 'index');
            this.#usesIndexPlan = true;
        }
        if (draw.kind === 'draw') {
            this.#indirectHandle = null;
            this.#indirectOffset = 0;
        } else {
            this.#indirectHandle = resolver.resolveBuffer(draw.buffer, 'indirect');
            this.#indirectOffset = draw.byteOffset ?? 0;
        }
        const limits = services.pipelines.registry.deviceCapabilities.limits;
        if (this.#draw === null) {
            this.#draw = new PreparedDraw(limits.maxBindGroups, limits.maxVertexBuffers);
        }
        this.#configured = true;
    }

    prepare(context: RGPrepareContext): void {
        this.assertConfigured();
        const pass = this.requirePass();
        const parameters = this.requireParameters();
        const services = this.requireServices();
        this.cleanup(services.frameBindGroups);
        try {
            const record = services.pipelines.prepare(
                pass.shader,
                pass.material,
                pass.vertexLayouts,
                this.#target
            );
            services.resourceUses.use(record.pipeline);
            this.#pipeline = services.pipelines.resolvePipeline(record);
            this.prepareBindGroups(context, record, services);
            this.prepareDrawPacket(context, pass, parameters, record, services);
        } catch (error) {
            try {
                this.cleanup(services.frameBindGroups);
            } catch (cleanup) {
                throw cleanupFailure(error, cleanup, `${pass.name} preparation`);
            }
            throw error;
        }
    }

    cleanup(frameBindGroups: ScriptableGPUDrivenFrameBindGroups): void {
        let firstFailure: unknown = null;
        for (const group of this.#groups) {
            if (group === undefined) continue;
            const bindGroup = group.bindGroup;
            group.bindGroup = null;
            group.entries.length = 0;
            group.bufferBindingCursor = 0;
            group.dynamicOffsetCursor = 0;
            if (bindGroup === null) continue;
            try {
                frameBindGroups.releaseFrameBindGroup(bindGroup);
            } catch (error) {
                firstFailure ??= error;
            }
        }
        this.#activeGroups.length = 0;
        if (firstFailure !== null) {
            throw firstFailure instanceof Error
                ? firstFailure
                : new Error('GPU-driven bind group cleanup failed');
        }
    }

    releaseFrameReferences(): void {
        const services = this.#services;
        if (services !== null) this.cleanup(services.frameBindGroups);
        this.resetPlans();
        this.#pass = null;
        this.#parameters = null;
        this.#services = null;
        this.#pipeline = null;
        this.#usesIndexPlan = false;
        this.#indexPlan.handle = null;
        this.#indexPlan.byteOffset = 0;
        this.#indexPlan.byteLength = 0;
        this.#indirectHandle = null;
        this.#frameIndex = -1;
        this.#configured = false;
    }

    private prepareBindGroups(
        context: RGPrepareContext,
        record: Readonly<GPUDrivenPipelineResourceRecord>,
        services: ScriptableGPUDrivenDrawServices
    ): void {
        this.#activeGroups.length = 0;
        for (let index = 0; index < this.#bindingCount; index++) {
            const plan = this.#bindingPlans[index];
            const binding = plan?.binding;
            if (plan === undefined || binding === null || binding === undefined) {
                throw new Error('GPU-driven binding plan is incomplete');
            }
            const group = this.groupAt(binding.group);
            if (group.entries.length === 0) {
                group.bufferBindingCursor = 0;
                group.dynamicOffsetCursor = 0;
                const layout = services.pipelines.resolveBindGroupLayout(record, binding.group);
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
            if (group?.descriptor.layout === null || group?.descriptor.layout === undefined) {
                throw new Error(`GPU-driven bind group ${String(groupIndex)} is incomplete`);
            }
            if ((group.dynamicOffsets?.length ?? 0) !== group.dynamicOffsetCursor) {
                throw new Error(
                    `GPU-driven bind group ${String(groupIndex)} dynamic offsets are incomplete`
                );
            }
            group.entries.sort(compareBindingEntries);
            const bindGroup = services.pipelines.registry.createFrameBindGroup(
                group.descriptor as RHIBindGroupDescriptor
            );
            group.bindGroup = bindGroup;
            services.frameBindGroups.trackFrameBindGroup(bindGroup);
        }
    }

    private prepareBinding(
        context: RGPrepareContext,
        plan: MutableBindingPlan,
        group: BindGroupScratch,
        services: ScriptableGPUDrivenDrawServices
    ): void {
        const binding = plan.binding;
        if (binding === null) throw new Error('GPU-driven binding plan lost its ABI binding');
        switch (binding.kind) {
            case 'uniform-buffer': {
                const source = plan.uniformSource;
                if (source === null)
                    throw new Error(`GPU-driven uniform ${binding.name} is missing`);
                services.uniformBuffers.prepareUniformBuffer(source);
                const handle = services.uniformBuffers.getUniformBufferHandle(source);
                services.resourceUses.use(handle);
                this.addBufferBinding(
                    group,
                    binding,
                    services.pipelines.registry.resolve(handle),
                    plan.byteOffset,
                    plan.byteLength
                );
                break;
            }
            case 'read-only-storage-buffer': {
                const handle = plan.graphBuffer;
                if (handle === null)
                    throw new Error(`GPU-driven storage ${binding.name} is missing`);
                this.addBufferBinding(
                    group,
                    binding,
                    context.getBuffer(handle),
                    plan.byteOffset,
                    plan.byteLength
                );
                break;
            }
            case 'sampled-texture': {
                const handle = plan.graphTexture;
                if (handle === null)
                    throw new Error(`GPU-driven texture ${binding.name} is missing`);
                this.addEntry(group, binding.binding, context.getTextureView(handle));
                break;
            }
            case 'sampler':
            case 'comparison-sampler': {
                const sampler = plan.sampler;
                if (sampler === null)
                    throw new Error(`GPU-driven sampler ${binding.name} is missing`);
                const handle = services.samplers.prepare(sampler);
                services.resourceUses.use(handle);
                this.addEntry(group, binding.binding, services.samplers.resolve(sampler));
                break;
            }
        }
    }

    private prepareDrawPacket(
        context: RGPrepareContext,
        pass: GPUDrivenRenderPass,
        parameters: GPUDrivenRenderPassParameters,
        record: Readonly<GPUDrivenPipelineResourceRecord>,
        services: ScriptableGPUDrivenDrawServices
    ): void {
        const pipeline = this.#pipeline;
        if (pipeline === null) throw new Error('GPU-driven graphics pipeline was not resolved');
        const draw = this.draw;
        draw.beginUpdate();
        draw.setPipeline(pipeline);
        for (const groupIndex of this.#activeGroups) {
            const group = this.#groups[groupIndex];
            const bindGroup = group?.bindGroup;
            if (group === undefined || bindGroup === null || bindGroup === undefined) {
                throw new Error(`GPU-driven bind group ${String(groupIndex)} was not prepared`);
            }
            draw.setBindGroup(groupIndex, bindGroup, group.dynamicOffsets ?? undefined);
        }
        for (let index = 0; index < this.#vertexCount; index++) {
            const plan = this.#vertexPlans[index];
            if (plan?.handle === null || plan?.handle === undefined) {
                throw new Error(`GPU-driven vertex buffer ${String(index)} is missing`);
            }
            const buffer = context.getBuffer(plan.handle);
            if ((buffer.usage & RHIBufferUsage.VERTEX) === 0) {
                throw new Error(`GPU-driven vertex buffer ${String(index)} lacks VERTEX usage`);
            }
            draw.setVertexBuffer(index, buffer, plan.byteOffset, plan.byteLength);
        }
        const indexPlan = this.#indexPlan;
        if (this.#usesIndexPlan) {
            if (indexPlan.handle === null || pass.indexFormat === undefined) {
                throw new Error('GPU-driven index input is incomplete');
            }
            const buffer = context.getBuffer(indexPlan.handle);
            if ((buffer.usage & RHIBufferUsage.INDEX) === 0) {
                throw new Error('GPU-driven index buffer lacks INDEX usage');
            }
            draw.setIndexBuffer(
                buffer,
                pass.indexFormat,
                indexPlan.byteOffset,
                indexPlan.byteLength
            );
        }
        const drawParameters = parameters.draw;
        if (drawParameters.kind === 'draw') {
            draw.setDraw(
                drawParameters.vertexCount,
                drawParameters.instanceCount ?? 1,
                drawParameters.firstVertex ?? 0,
                drawParameters.firstInstance ?? 0
            );
        } else {
            const handle = this.#indirectHandle;
            if (handle === null) throw new Error('GPU-driven indirect argument handle is missing');
            const buffer = context.getBuffer(handle);
            this.validateIndirectBuffer(buffer, drawParameters.kind);
            if (drawParameters.kind === 'draw-indirect') {
                draw.setDrawIndirect(buffer, this.#indirectOffset);
            } else draw.setDrawIndexedIndirect(buffer, this.#indirectOffset);
        }
        draw.setDynamicState(mapRHIMeshDrawDynamicState(pass.material));
        draw.setSortKey(0, 0);
        draw.finishUpdate({
            geometry: this.#frameIndex,
            materialVariant: record.shaderToken,
            renderState: pipeline.id,
            resourceBindings: this.#frameIndex,
            target: pipeline.id,
            deviceGeneration: services.pipelines.registry.generation
        });
    }

    private validateIndirectBuffer(
        buffer: RHIBuffer,
        kind: 'draw-indirect' | 'draw-indexed-indirect'
    ): void {
        if (
            !this.requireServices().pipelines.registry.deviceCapabilities.features.has(
                'indirect-draw'
            )
        ) {
            throw new Error('GPU-driven indirect draws are unsupported by this device');
        }
        if ((buffer.usage & RHIBufferUsage.INDIRECT) === 0) {
            throw new Error('GPU-driven indirect buffer lacks INDIRECT usage');
        }
        if (buffer.mapState !== 'unmapped') {
            throw new Error('GPU-driven indirect buffer must be unmapped');
        }
        const required = kind === 'draw-indexed-indirect' ? 20 : 16;
        if (this.#indirectOffset + required > buffer.size) {
            throw new RangeError('GPU-driven indirect argument range exceeds its buffer');
        }
    }

    private addBufferBinding(
        group: BindGroupScratch,
        binding: Extract<
            ShaderReadBinding,
            { readonly kind: 'uniform-buffer' | 'read-only-storage-buffer' }
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
        resource.size = byteLength;
        if (binding.dynamicOffset === true) {
            resource.offset = 0;
            const dynamicOffsets = group.dynamicOffsets;
            if (dynamicOffsets === null) {
                throw new Error(`GPU-driven binding ${binding.name} lost dynamic-offset storage`);
            }
            dynamicOffsets[group.dynamicOffsetCursor++] = byteOffset;
        } else {
            resource.offset = byteOffset;
        }
        this.addEntry(group, binding.binding, resource as { readonly buffer: RHIBuffer });
    }

    private addEntry(group: BindGroupScratch, binding: number, resource: RHIBindingResource): void {
        let entry = group.entryPool[group.entries.length];
        if (entry === undefined) {
            entry = { binding: 0, resource: null };
            group.entryPool.push(entry);
        }
        entry.binding = binding;
        entry.resource = resource;
        group.entries.push(entry);
    }

    private bindingPlanAt(index: number): MutableBindingPlan {
        let plan = this.#bindingPlans[index];
        if (plan === undefined) {
            plan = {
                binding: null,
                uniformSource: null,
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

    private vertexPlanAt(index: number): MutableGraphBufferPlan {
        let plan = this.#vertexPlans[index];
        if (plan === undefined) {
            plan = { handle: null, byteOffset: 0, byteLength: 0 };
            this.#vertexPlans.push(plan);
        }
        return plan;
    }

    private groupAt(index: number): BindGroupScratch {
        let group = this.#groups[index];
        if (group === undefined) {
            const entries: MutableFrameBindGroupEntry[] = [];
            group = {
                entries,
                entryPool: [],
                bufferBindings: [],
                descriptor: {
                    label: 'GPU-driven frame bind group',
                    lifetime: 'frame',
                    layout: null,
                    entries
                },
                bufferBindingCursor: 0,
                dynamicOffsetCursor: 0,
                dynamicOffsets: null,
                bindGroup: null
            };
            this.#groups[index] = group;
        }
        return group;
    }

    private snapshotTarget(source: RHIMeshDrawTargetDescriptor): void {
        this.#targetColorFormats.length = source.colorFormats.length;
        for (let index = 0; index < source.colorFormats.length; index++) {
            this.#targetColorFormats[index] = source.colorFormats[index] ?? null;
        }
        (
            this.#target as {
                depthStencilFormat: RHIMeshDrawTargetDescriptor['depthStencilFormat'];
            }
        ).depthStencilFormat = source.depthStencilFormat;
        (this.#target as { sampleCount: number }).sampleCount = source.sampleCount;
    }

    private resetPlans(): void {
        for (let index = 0; index < this.#bindingCount; index++) {
            const plan = this.#bindingPlans[index];
            if (plan === undefined) continue;
            plan.binding = null;
            plan.uniformSource = null;
            plan.graphBuffer = null;
            plan.graphTexture = null;
            plan.sampler = null;
            plan.byteOffset = 0;
            plan.byteLength = 0;
        }
        for (let index = 0; index < this.#vertexCount; index++) {
            const plan = this.#vertexPlans[index];
            if (plan === undefined) continue;
            plan.handle = null;
            plan.byteOffset = 0;
            plan.byteLength = 0;
        }
        this.#bindingCount = 0;
        this.#vertexCount = 0;
    }

    private assertConfigured(): void {
        if (!this.#configured) throw new Error('GPU-driven draw must be configured before prepare');
    }

    private requirePass(): GPUDrivenRenderPass {
        const pass = this.#pass;
        if (pass === null) throw new Error('GPU-driven pass is unavailable');
        return pass;
    }

    private requireParameters(): GPUDrivenRenderPassParameters {
        const parameters = this.#parameters;
        if (parameters === null) throw new Error('GPU-driven parameters are unavailable');
        return parameters;
    }

    private requireServices(): ScriptableGPUDrivenDrawServices {
        const services = this.#services;
        if (services === null) throw new Error('GPU-driven renderer services are unavailable');
        return services;
    }
}

function validateGraphInputRange(
    plan: Readonly<MutableGraphBufferPlan>,
    resourceByteLength: number,
    path: string
): void {
    if (
        !Number.isSafeInteger(plan.byteOffset) ||
        !Number.isSafeInteger(plan.byteLength) ||
        plan.byteOffset < 0 ||
        plan.byteLength < 1 ||
        plan.byteOffset + plan.byteLength > resourceByteLength
    ) {
        throw new RangeError(`${path} has an invalid byte range`);
    }
    if (plan.byteOffset % 4 !== 0 || plan.byteLength % 4 !== 0) {
        throw new RangeError(`${path} offset and length must be 4-byte aligned`);
    }
}
