import {
    RHICacheCounter,
    type RHIBindGroup,
    type RHIBuffer,
    type RHIDrawArgumentsRecord,
    type RHIGraphicsPipeline,
    type RHIIndexBufferBindingRecord,
    type RHIIndexFormat,
    type RHIRenderPassEncoder,
    type RHIUInt32View,
    type RHIViewport,
    type RHIVertexBufferBindingRecord,
    type RHIVertexInputBindings
} from '../rhi/core';

const MISSING_INDEX_BUFFER_ERROR = new Error('Prepared indexed draw lost its index buffer');
const MISSING_INDIRECT_BUFFER_ERROR = new Error('Prepared indirect draw lost its argument buffer');
const MISSING_INDEXED_INDIRECT_BUFFER_ERROR = new Error(
    'Prepared indexed indirect draw lost its argument buffer'
);
const MISSING_VIEWPORT_ERROR = new Error(
    'Prepared draw with a custom depth range requires a pass viewport'
);

export interface PreparedDrawRevision {
    readonly geometry: number;
    readonly materialVariant: number;
    readonly renderState: number;
    readonly resourceBindings: number;
    readonly target: number;
    readonly deviceGeneration: number;
}

export type PreparedDrawUpdate = (draw: PreparedDraw) => void;

export interface PreparedDrawViewportBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** @internal Mutable depth-range cache shared by a draw pass during command encoding. */
export interface PreparedDrawViewportState {
    minDepth: number;
    maxDepth: number;
}

export interface PreparedDrawDynamicState {
    readonly minDepth: number;
    readonly maxDepth: number;
    readonly stencilReference: number;
    readonly usesStencil: boolean;
}

interface MutableVertexInputBufferBinding {
    readonly slot: number;
    buffer: RHIBuffer | null;
    offset: number;
    size: number | undefined;
}

interface MutableVertexInputIndexBinding {
    buffer: RHIBuffer | null;
    format: RHIIndexFormat;
    offset: number;
    size: number | undefined;
}

interface MutableVertexInputBindings {
    readonly vertexBuffers: readonly MutableVertexInputBufferBinding[];
    indexBuffer: MutableVertexInputIndexBinding | null;
}

type PreparedDrawMode = 'draw' | 'draw-indexed' | 'draw-indirect' | 'draw-indexed-indirect';

type MutableDrawArgumentsRecord = {
    -readonly [Key in keyof RHIDrawArgumentsRecord]: RHIDrawArgumentsRecord[Key];
};

type MutableRHIViewport = {
    -readonly [Key in keyof RHIViewport]: RHIViewport[Key];
};

function requireRevision(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} revision must be a non-negative safe integer`);
    }
}

function requireIndex(value: number, capacity: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value >= capacity) {
        throw new RangeError(`${name} is outside prepared draw capacity`);
    }
}

function requireDrawInteger(value: number, name: string, minimum = 0): void {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(`${name} must be a safe integer >= ${String(minimum)}`);
    }
}

/**
 * Allocation-stable backend-neutral draw packet. Binding storage is allocated once when the cache
 * record is created; execute performs only sequential reads and RHI pass calls.
 */
export class PreparedDraw {
    private pipelineValue: RHIGraphicsPipeline | null = null;
    private readonly bindGroups: (RHIBindGroup | null)[];
    private readonly dynamicOffsets: (RHIUInt32View | null)[];
    private bindGroupHighWater = 0;
    private readonly vertexBuffers: MutableVertexInputBufferBinding[];
    private vertexBufferHighWater = 0;
    private readonly indexBuffer: MutableVertexInputIndexBinding = {
        buffer: null,
        format: 'uint16',
        offset: 0,
        size: undefined
    };
    private readonly vertexInputBindings: MutableVertexInputBindings;
    private drawMode: PreparedDrawMode = 'draw';
    private indirectBuffer: RHIBuffer | null = null;
    private indirectOffset = 0;
    private readonly drawArguments: MutableDrawArgumentsRecord = {
        elementCount: 0,
        instanceCount: 1,
        firstElement: 0,
        baseVertex: 0,
        firstInstance: 0
    };
    private minDepth = 0;
    private maxDepth = 1;
    private readonly executionViewport: MutableRHIViewport = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        minDepth: 0,
        maxDepth: 1
    };
    private stencilReference = 0;
    private usesStencil = false;
    private sortHigh = 0;
    private sortLow = 0;
    private valid = false;
    private geometryRevision = -1;
    private materialVariantRevision = -1;
    private renderStateRevision = -1;
    private resourceBindingsRevision = -1;
    private targetRevision = -1;
    private generationRevision = -1;

    constructor(
        readonly bindGroupCapacity: number,
        readonly vertexBufferCapacity: number
    ) {
        requireDrawInteger(bindGroupCapacity, 'Bind group capacity', 1);
        requireDrawInteger(vertexBufferCapacity, 'Vertex buffer capacity', 1);
        this.bindGroups = new Array<RHIBindGroup | null>(bindGroupCapacity).fill(null);
        this.dynamicOffsets = new Array<RHIUInt32View | null>(bindGroupCapacity).fill(null);
        this.vertexBuffers = new Array<MutableVertexInputBufferBinding>(vertexBufferCapacity);
        for (let slot = 0; slot < vertexBufferCapacity; slot += 1) {
            this.vertexBuffers[slot] = { slot, buffer: null, offset: 0, size: undefined };
        }
        this.vertexInputBindings = {
            vertexBuffers: this.vertexBuffers,
            indexBuffer: null
        };
    }

    get pipeline(): RHIGraphicsPipeline {
        if (!this.pipelineValue || !this.valid) throw new Error('Prepared draw is not ready');
        return this.pipelineValue;
    }

    get sortKeyHigh(): number {
        return this.sortHigh;
    }

    get sortKeyLow(): number {
        return this.sortLow;
    }

    matches(revision: PreparedDrawRevision): boolean {
        return (
            this.valid &&
            this.geometryRevision === revision.geometry &&
            this.materialVariantRevision === revision.materialVariant &&
            this.renderStateRevision === revision.renderState &&
            this.resourceBindingsRevision === revision.resourceBindings &&
            this.targetRevision === revision.target &&
            this.generationRevision === revision.deviceGeneration
        );
    }

    /** @internal Called only by PreparedDrawCache on a cache miss or revision change. */
    beginUpdate(): void {
        this.valid = false;
        this.pipelineValue = null;
        for (let index = 0; index < this.bindGroupHighWater; index += 1) {
            this.bindGroups[index] = null;
            this.dynamicOffsets[index] = null;
        }
        for (let index = 0; index < this.vertexBufferHighWater; index += 1) {
            const binding = this.vertexBuffers[index];
            if (binding === undefined) continue;
            binding.buffer = null;
            binding.offset = 0;
            binding.size = undefined;
        }
        this.bindGroupHighWater = 0;
        this.vertexBufferHighWater = 0;
        this.indexBuffer.buffer = null;
        this.indexBuffer.format = 'uint16';
        this.indexBuffer.offset = 0;
        this.indexBuffer.size = undefined;
        this.vertexInputBindings.indexBuffer = null;
        this.drawMode = 'draw';
        this.indirectBuffer = null;
        this.indirectOffset = 0;
        const drawArguments = this.drawArguments;
        drawArguments.elementCount = 0;
        drawArguments.instanceCount = 1;
        drawArguments.firstElement = 0;
        drawArguments.baseVertex = 0;
        drawArguments.firstInstance = 0;
        this.minDepth = 0;
        this.maxDepth = 1;
        this.stencilReference = 0;
        this.usesStencil = false;
        this.sortHigh = 0;
        this.sortLow = 0;
    }

    setPipeline(pipeline: RHIGraphicsPipeline): void {
        this.assertUpdating();
        this.pipelineValue = pipeline;
    }

    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void {
        this.assertUpdating();
        requireIndex(index, this.bindGroupCapacity, 'Bind group index');
        this.bindGroups[index] = bindGroup;
        this.dynamicOffsets[index] = dynamicOffsets ?? null;
        if (index + 1 > this.bindGroupHighWater) this.bindGroupHighWater = index + 1;
    }

    /**
     * Overlay a graph-resolved pass-global group on a sealed pass-local snapshot.
     *
     * @internal This is valid only during Render Graph prepare, before vertex-input preparation.
     */
    setPreparedBindGroup(index: number, bindGroup: RHIBindGroup): void {
        if (!this.valid) throw new Error('Prepared draw is not ready for a pass-global bind group');
        requireIndex(index, this.bindGroupCapacity, 'Bind group index');
        this.bindGroups[index] = bindGroup;
        this.dynamicOffsets[index] = null;
        if (index + 1 > this.bindGroupHighWater) this.bindGroupHighWater = index + 1;
    }

    setVertexBuffer(slot: number, buffer: RHIBuffer, offset = 0, size?: number): void {
        this.assertUpdating();
        requireIndex(slot, this.vertexBufferCapacity, 'Vertex buffer slot');
        requireDrawInteger(offset, 'Vertex buffer offset');
        if (size !== undefined) requireDrawInteger(size, 'Vertex buffer size', 1);
        const binding = this.vertexBuffers[slot];
        if (binding === undefined) throw new Error('Prepared vertex-buffer storage is unavailable');
        binding.buffer = buffer;
        binding.offset = offset;
        binding.size = size;
        if (slot + 1 > this.vertexBufferHighWater) this.vertexBufferHighWater = slot + 1;
    }

    setIndexBuffer(buffer: RHIBuffer, format: RHIIndexFormat, offset = 0, size?: number): void {
        this.assertUpdating();
        requireDrawInteger(offset, 'Index buffer offset');
        if (size !== undefined) requireDrawInteger(size, 'Index buffer size', 1);
        this.indexBuffer.buffer = buffer;
        this.indexBuffer.format = format;
        this.indexBuffer.offset = offset;
        this.indexBuffer.size = size;
    }

    setDraw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
        this.assertUpdating();
        requireDrawInteger(vertexCount, 'Vertex count', 1);
        requireDrawInteger(instanceCount, 'Instance count', 1);
        requireDrawInteger(firstVertex, 'First vertex');
        requireDrawInteger(firstInstance, 'First instance');
        this.drawMode = 'draw';
        this.indirectBuffer = null;
        this.vertexInputBindings.indexBuffer = null;
        const drawArguments = this.drawArguments;
        drawArguments.elementCount = vertexCount;
        drawArguments.instanceCount = instanceCount;
        drawArguments.firstElement = firstVertex;
        drawArguments.baseVertex = 0;
        drawArguments.firstInstance = firstInstance;
    }

    setDrawIndexed(
        indexCount: number,
        instanceCount = 1,
        firstIndex = 0,
        baseVertex = 0,
        firstInstance = 0
    ): void {
        this.assertUpdating();
        requireDrawInteger(indexCount, 'Index count', 1);
        requireDrawInteger(instanceCount, 'Instance count', 1);
        requireDrawInteger(firstIndex, 'First index');
        if (!Number.isSafeInteger(baseVertex))
            throw new RangeError('Base vertex must be a safe integer');
        requireDrawInteger(firstInstance, 'First instance');
        this.drawMode = 'draw-indexed';
        this.indirectBuffer = null;
        this.vertexInputBindings.indexBuffer = this.indexBuffer;
        const drawArguments = this.drawArguments;
        drawArguments.elementCount = indexCount;
        drawArguments.instanceCount = instanceCount;
        drawArguments.firstElement = firstIndex;
        drawArguments.baseVertex = baseVertex;
        drawArguments.firstInstance = firstInstance;
    }

    /** Select one GPU-authored non-indexed draw packet without reading its contents on the CPU. */
    setDrawIndirect(buffer: RHIBuffer, offset = 0): void {
        this.assertUpdating();
        requireDrawInteger(offset, 'Indirect draw offset');
        if (offset % 4 !== 0) throw new RangeError('Indirect draw offset must be 4-byte aligned');
        this.drawMode = 'draw-indirect';
        this.indirectBuffer = buffer;
        this.indirectOffset = offset;
        this.vertexInputBindings.indexBuffer = null;
    }

    /** Select one GPU-authored indexed draw packet without reading its contents on the CPU. */
    setDrawIndexedIndirect(buffer: RHIBuffer, offset = 0): void {
        this.assertUpdating();
        requireDrawInteger(offset, 'Indexed indirect draw offset');
        if (offset % 4 !== 0) {
            throw new RangeError('Indexed indirect draw offset must be 4-byte aligned');
        }
        this.drawMode = 'draw-indexed-indirect';
        this.indirectBuffer = buffer;
        this.indirectOffset = offset;
        this.vertexInputBindings.indexBuffer = this.indexBuffer;
    }

    setSortKey(high: number, low: number): void {
        this.assertUpdating();
        requireDrawInteger(high, 'Sort key high');
        requireDrawInteger(low, 'Sort key low');
        this.sortHigh = high;
        this.sortLow = low;
    }

    setDynamicState(state: Readonly<PreparedDrawDynamicState>): void {
        this.assertUpdating();
        if (
            !Number.isFinite(state.minDepth) ||
            !Number.isFinite(state.maxDepth) ||
            state.minDepth < 0 ||
            state.maxDepth > 1 ||
            state.minDepth > state.maxDepth
        ) {
            throw new RangeError('Prepared draw depth range must be ordered within zero and one');
        }
        requireDrawInteger(state.stencilReference, 'Stencil reference');
        if (state.stencilReference > 0xffffffff) {
            throw new RangeError('Stencil reference must be an unsigned 32-bit integer');
        }
        this.minDepth = state.minDepth;
        this.maxDepth = state.maxDepth;
        this.stencilReference = state.stencilReference;
        this.usesStencil = state.usesStencil;
    }

    /**
     * Copy one sealed packet into reusable pass-local storage.
     *
     * Mesh caches deliberately update records in place. A graph containing multiple passes may
     * therefore prepare the same cache key more than once before execution; pass-local snapshots
     * preserve the packet selected by each pass without allocating in steady state.
     *
     * @internal
     */
    copyFrom(source: PreparedDraw): void {
        if (source === this) return;
        const pipeline = source.pipeline;
        if (
            this.bindGroupCapacity !== source.bindGroupCapacity ||
            this.vertexBufferCapacity !== source.vertexBufferCapacity
        ) {
            throw new Error('Prepared draw snapshot capacity does not match its source');
        }
        this.beginUpdate();
        this.pipelineValue = pipeline;
        this.bindGroupHighWater = source.bindGroupHighWater;
        for (let index = 0; index < source.bindGroupHighWater; index += 1) {
            this.bindGroups[index] = source.bindGroups[index] ?? null;
            this.dynamicOffsets[index] = source.dynamicOffsets[index] ?? null;
        }
        this.vertexBufferHighWater = source.vertexBufferHighWater;
        for (let index = 0; index < source.vertexBufferHighWater; index += 1) {
            const targetBinding = this.vertexBuffers[index];
            const sourceBinding = source.vertexBuffers[index];
            if (targetBinding === undefined || sourceBinding === undefined) continue;
            targetBinding.buffer = sourceBinding.buffer;
            targetBinding.offset = sourceBinding.offset;
            targetBinding.size = sourceBinding.size;
        }
        this.indexBuffer.buffer = source.indexBuffer.buffer;
        this.indexBuffer.format = source.indexBuffer.format;
        this.indexBuffer.offset = source.indexBuffer.offset;
        this.indexBuffer.size = source.indexBuffer.size;
        this.drawMode = source.drawMode;
        this.indirectBuffer = source.indirectBuffer;
        this.indirectOffset = source.indirectOffset;
        this.vertexInputBindings.indexBuffer =
            this.drawMode === 'draw-indexed' || this.drawMode === 'draw-indexed-indirect'
                ? this.indexBuffer
                : null;
        const targetDrawArguments = this.drawArguments;
        const sourceDrawArguments = source.drawArguments;
        targetDrawArguments.elementCount = sourceDrawArguments.elementCount;
        targetDrawArguments.instanceCount = sourceDrawArguments.instanceCount;
        targetDrawArguments.firstElement = sourceDrawArguments.firstElement;
        targetDrawArguments.baseVertex = sourceDrawArguments.baseVertex;
        targetDrawArguments.firstInstance = sourceDrawArguments.firstInstance;
        this.minDepth = source.minDepth;
        this.maxDepth = source.maxDepth;
        this.stencilReference = source.stencilReference;
        this.usesStencil = source.usesStencil;
        this.sortHigh = source.sortHigh;
        this.sortLow = source.sortLow;
        this.geometryRevision = source.geometryRevision;
        this.materialVariantRevision = source.materialVariantRevision;
        this.renderStateRevision = source.renderStateRevision;
        this.resourceBindingsRevision = source.resourceBindingsRevision;
        this.targetRevision = source.targetRevision;
        this.generationRevision = source.generationRevision;
        this.valid = true;
    }

    /** @internal */
    finishUpdate(revision: PreparedDrawRevision): void {
        if (!this.pipelineValue) throw new Error('Prepared draw update did not set a pipeline');
        if (
            (this.drawMode === 'draw' || this.drawMode === 'draw-indexed') &&
            this.drawArguments.elementCount === 0
        )
            throw new Error('Prepared draw update did not set draw arguments');
        if (
            (this.drawMode === 'draw-indexed' || this.drawMode === 'draw-indexed-indirect') &&
            !this.indexBuffer.buffer
        ) {
            throw new Error('Prepared indexed draw update did not set an index buffer');
        }
        if (
            (this.drawMode === 'draw-indirect' || this.drawMode === 'draw-indexed-indirect') &&
            this.indirectBuffer === null
        ) {
            throw new Error('Prepared indirect draw update did not set an argument buffer');
        }
        requireRevision(revision.geometry, 'Geometry');
        requireRevision(revision.materialVariant, 'Material variant');
        requireRevision(revision.renderState, 'Render state');
        requireRevision(revision.resourceBindings, 'Resource bindings');
        requireRevision(revision.target, 'Target');
        requireRevision(revision.deviceGeneration, 'Device generation');
        this.geometryRevision = revision.geometry;
        this.materialVariantRevision = revision.materialVariant;
        this.renderStateRevision = revision.renderState;
        this.resourceBindingsRevision = revision.resourceBindings;
        this.targetRevision = revision.target;
        this.generationRevision = revision.deviceGeneration;
        this.valid = true;
    }

    /** @internal Ensure backend vertex-input objects during graph preparation, never draw. */
    prepareVertexInput(): void {
        this.pipeline.prepareVertexInput(
            this.vertexInputBindings as Readonly<RHIVertexInputBindings>
        );
    }

    execute(
        pass: RHIRenderPassEncoder,
        viewport?: Readonly<PreparedDrawViewportBounds>,
        viewportState?: PreparedDrawViewportState,
        previousDraw?: PreparedDraw | null
    ): void {
        const pipeline = this.pipeline;
        pass.setPipeline(pipeline);
        if (viewport !== undefined) {
            if (
                viewportState?.minDepth !== this.minDepth ||
                viewportState.maxDepth !== this.maxDepth
            ) {
                const executionViewport = this.executionViewport;
                executionViewport.x = viewport.x;
                executionViewport.y = viewport.y;
                executionViewport.width = viewport.width;
                executionViewport.height = viewport.height;
                executionViewport.minDepth = this.minDepth;
                executionViewport.maxDepth = this.maxDepth;
                pass.setViewportRecord(executionViewport);
                if (viewportState !== undefined) {
                    viewportState.minDepth = this.minDepth;
                    viewportState.maxDepth = this.maxDepth;
                }
            }
        } else if (this.minDepth !== 0 || this.maxDepth !== 1) {
            throw MISSING_VIEWPORT_ERROR;
        }
        if (this.usesStencil) pass.setStencilReference(this.stencilReference);
        for (let index = 0; index < this.bindGroupHighWater; index += 1) {
            const bindGroup = this.bindGroups[index];
            if (bindGroup) {
                const offsets = this.dynamicOffsets[index];
                if (offsets) pass.setBindGroup(index, bindGroup, offsets);
                else pass.setBindGroup(index, bindGroup);
            }
        }
        const previousVertexBuffers = previousDraw?.vertexBuffers;
        for (let slot = 0; slot < this.vertexBufferHighWater; slot += 1) {
            const binding = this.vertexBuffers[slot];
            const buffer = binding?.buffer;
            if (binding !== undefined && buffer) {
                const previousBinding = previousVertexBuffers?.[slot];
                if (
                    previousBinding?.buffer !== buffer ||
                    previousBinding.offset !== binding.offset ||
                    previousBinding.size !== binding.size
                ) {
                    pass.setVertexBufferRecord(
                        binding as unknown as Readonly<RHIVertexBufferBindingRecord>
                    );
                }
            }
        }
        if (this.drawMode === 'draw-indexed' || this.drawMode === 'draw-indexed-indirect') {
            const buffer = this.indexBuffer.buffer;
            if (!buffer) throw MISSING_INDEX_BUFFER_ERROR;
            const previousIndexBuffer =
                previousDraw?.drawMode === 'draw-indexed' ||
                previousDraw?.drawMode === 'draw-indexed-indirect'
                    ? previousDraw.indexBuffer
                    : undefined;
            const indexBuffer = this.indexBuffer;
            if (
                previousIndexBuffer?.buffer !== buffer ||
                previousIndexBuffer.format !== indexBuffer.format ||
                previousIndexBuffer.offset !== indexBuffer.offset ||
                previousIndexBuffer.size !== indexBuffer.size
            ) {
                pass.setIndexBufferRecord(
                    indexBuffer as unknown as Readonly<RHIIndexBufferBindingRecord>
                );
            }
            if (this.drawMode === 'draw-indexed') pass.drawIndexedRecord(this.drawArguments);
            else {
                const indirectBuffer = this.indirectBuffer;
                if (indirectBuffer === null) {
                    throw MISSING_INDEXED_INDIRECT_BUFFER_ERROR;
                }
                pass.drawIndexedIndirect(indirectBuffer, this.indirectOffset);
            }
        } else if (this.drawMode === 'draw') {
            pass.drawRecord(this.drawArguments);
        } else {
            const indirectBuffer = this.indirectBuffer;
            if (indirectBuffer === null) {
                throw MISSING_INDIRECT_BUFFER_ERROR;
            }
            pass.drawIndirect(indirectBuffer, this.indirectOffset);
        }
    }

    private assertUpdating(): void {
        if (this.valid) throw new Error('Prepared draw is sealed; begin a cache update first');
    }
}

/** Revision-driven record cache; expensive preparation runs only when an explicit revision changes. */
export class PreparedDrawCache<K extends object> {
    /** Complete pipeline/bind-group/vertex-binding packet lookup outcomes. */
    readonly metrics = new RHICacheCounter();
    #records = new WeakMap<K, PreparedDraw>();

    constructor(
        readonly bindGroupCapacity: number,
        readonly vertexBufferCapacity: number
    ) {}

    prepare(key: K, revision: PreparedDrawRevision, update: PreparedDrawUpdate): PreparedDraw {
        let record = this.#records.get(key);
        const created = record === undefined;
        if (!record) {
            record = new PreparedDraw(this.bindGroupCapacity, this.vertexBufferCapacity);
            this.#records.set(key, record);
            this.metrics.recordInsertion();
        }
        if (record.matches(revision)) {
            this.metrics.recordHit();
            return record;
        }
        this.metrics.recordMiss();
        if (!created) this.metrics.recordReplacement();
        record.beginUpdate();
        update(record);
        record.finishUpdate(revision);
        return record;
    }

    delete(key: K): boolean {
        const deleted = this.#records.delete(key);
        if (deleted) this.metrics.recordRemoval();
        return deleted;
    }

    clear(): void {
        this.#records = new WeakMap();
        this.metrics.clear();
    }
}
