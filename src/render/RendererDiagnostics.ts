import type { RHICacheCounters } from './rhi/core';
import type {
    RenderGraphTimelineSink,
    RenderGraphTimelineSnapshot
} from './graph/RenderGraphTimeline';

export type RendererNativeObjectKind =
    | 'buffer'
    | 'texture'
    | 'textureView'
    | 'sampler'
    | 'shaderModule'
    | 'program'
    | 'pipeline'
    | 'bindGroupLayout'
    | 'pipelineLayout'
    | 'bindGroup'
    | 'framebuffer'
    | 'renderbuffer'
    | 'vertexArray'
    | 'commandEncoder'
    | 'commandBuffer';

export type RendererCacheKind =
    | 'buffer'
    | 'texture'
    | 'sampler'
    | 'program'
    | 'pipeline'
    | 'bindGroupLayout'
    | 'pipelineLayout'
    | 'bindGroup'
    | 'framebuffer'
    | 'vertexArray';

export interface RendererNativeObjectCountersSnapshot {
    readonly created: number;
    readonly destroyed: number | null;
    readonly live: number | null;
    readonly highWater: number | null;
}

export interface RendererNativeObjectDiagnosticsSnapshot {
    readonly buffer: RendererNativeObjectCountersSnapshot;
    readonly texture: RendererNativeObjectCountersSnapshot;
    readonly textureView: RendererNativeObjectCountersSnapshot;
    readonly sampler: RendererNativeObjectCountersSnapshot;
    readonly shaderModule: RendererNativeObjectCountersSnapshot;
    readonly program: RendererNativeObjectCountersSnapshot;
    readonly pipeline: RendererNativeObjectCountersSnapshot;
    readonly bindGroupLayout: RendererNativeObjectCountersSnapshot;
    readonly pipelineLayout: RendererNativeObjectCountersSnapshot;
    readonly bindGroup: RendererNativeObjectCountersSnapshot;
    readonly framebuffer: RendererNativeObjectCountersSnapshot;
    readonly renderbuffer: RendererNativeObjectCountersSnapshot;
    readonly vertexArray: RendererNativeObjectCountersSnapshot;
    readonly commandEncoder: RendererNativeObjectCountersSnapshot;
    readonly commandBuffer: RendererNativeObjectCountersSnapshot;
}

export interface RendererCacheCountersSnapshot {
    readonly hits: number | null;
    readonly misses: number | null;
    readonly evictions: number | null;
    readonly size: number | null;
    readonly highWater: number | null;
}

export interface RendererCacheDiagnosticsSnapshot {
    readonly buffer: RendererCacheCountersSnapshot;
    readonly texture: RendererCacheCountersSnapshot;
    readonly sampler: RendererCacheCountersSnapshot;
    readonly program: RendererCacheCountersSnapshot;
    readonly pipeline: RendererCacheCountersSnapshot;
    readonly bindGroupLayout: RendererCacheCountersSnapshot;
    readonly pipelineLayout: RendererCacheCountersSnapshot;
    readonly bindGroup: RendererCacheCountersSnapshot;
    readonly framebuffer: RendererCacheCountersSnapshot;
    readonly vertexArray: RendererCacheCountersSnapshot;
}

export interface RendererFrameDiagnosticsSnapshot {
    readonly draws: number;
    /** Direct or indexed indirect draw commands emitted this frame. */
    readonly indirectDraws: number;
    /** Compute dispatch commands emitted this frame. */
    readonly dispatches: number;
    /** Exact workgroup product for direct dispatches; indirect counts are intentionally omitted. */
    readonly dispatchedWorkgroups: number;
    /** Buffer clear commands emitted this frame. */
    readonly bufferClears: number;
    readonly commands: number;
    readonly passes: number;
    readonly stateChanges: number;
    /** Compute pipeline changes recorded by command encoders. */
    readonly computePipelineSwitches: number;
    /** Compute bind-group changes recorded by command encoders. */
    readonly computeBindGroupSwitches: number;
    readonly uploads: number;
    readonly submissions: number;
    readonly arenaGrowths: number;
}

export interface RendererDiagnosticsSnapshot {
    readonly nativeObjects: RendererNativeObjectDiagnosticsSnapshot;
    readonly caches: RendererCacheDiagnosticsSnapshot;
    readonly frame: RendererFrameDiagnosticsSnapshot;
    /** Latest opt-in Render Graph CPU/GPU timeline, updated after asynchronous GPU readback. */
    readonly renderGraph: Readonly<RenderGraphTimelineSnapshot> | null;
}

const NATIVE_CREATED = 0;
const NATIVE_DESTROYED = 1;
const NATIVE_LIVE = 2;
const NATIVE_HIGH_WATER = 3;
const NATIVE_LIFETIME_UNKNOWN = 4;
const NATIVE_STRIDE = 5;

const NATIVE_BUFFER = 0;
const NATIVE_TEXTURE = NATIVE_BUFFER + NATIVE_STRIDE;
const NATIVE_TEXTURE_VIEW = NATIVE_TEXTURE + NATIVE_STRIDE;
const NATIVE_SAMPLER = NATIVE_TEXTURE_VIEW + NATIVE_STRIDE;
const NATIVE_SHADER_MODULE = NATIVE_SAMPLER + NATIVE_STRIDE;
const NATIVE_PROGRAM = NATIVE_SHADER_MODULE + NATIVE_STRIDE;
const NATIVE_PIPELINE = NATIVE_PROGRAM + NATIVE_STRIDE;
const NATIVE_BIND_GROUP_LAYOUT = NATIVE_PIPELINE + NATIVE_STRIDE;
const NATIVE_PIPELINE_LAYOUT = NATIVE_BIND_GROUP_LAYOUT + NATIVE_STRIDE;
const NATIVE_BIND_GROUP = NATIVE_PIPELINE_LAYOUT + NATIVE_STRIDE;
const NATIVE_FRAMEBUFFER = NATIVE_BIND_GROUP + NATIVE_STRIDE;
const NATIVE_RENDERBUFFER = NATIVE_FRAMEBUFFER + NATIVE_STRIDE;
const NATIVE_VERTEX_ARRAY = NATIVE_RENDERBUFFER + NATIVE_STRIDE;
const NATIVE_COMMAND_ENCODER = NATIVE_VERTEX_ARRAY + NATIVE_STRIDE;
const NATIVE_COMMAND_BUFFER = NATIVE_COMMAND_ENCODER + NATIVE_STRIDE;

const CACHE_START = NATIVE_COMMAND_BUFFER + NATIVE_STRIDE;
const CACHE_HITS = 0;
const CACHE_MISSES = 1;
const CACHE_EVICTIONS = 2;
const CACHE_SIZE = 3;
const CACHE_HIGH_WATER = 4;
const CACHE_UNAVAILABLE = 5;
const CACHE_STRIDE = 6;

const CACHE_HITS_UNAVAILABLE = 1 << CACHE_HITS;
const CACHE_MISSES_UNAVAILABLE = 1 << CACHE_MISSES;
const CACHE_EVICTIONS_UNAVAILABLE = 1 << CACHE_EVICTIONS;
const CACHE_SIZE_UNAVAILABLE = 1 << CACHE_SIZE;
const CACHE_HIGH_WATER_UNAVAILABLE = 1 << CACHE_HIGH_WATER;
const ALL_CACHE_METRICS_UNAVAILABLE =
    CACHE_HITS_UNAVAILABLE |
    CACHE_MISSES_UNAVAILABLE |
    CACHE_EVICTIONS_UNAVAILABLE |
    CACHE_SIZE_UNAVAILABLE |
    CACHE_HIGH_WATER_UNAVAILABLE;
const CACHE_OUTCOMES_ONLY_UNAVAILABLE =
    CACHE_MISSES_UNAVAILABLE |
    CACHE_EVICTIONS_UNAVAILABLE |
    CACHE_SIZE_UNAVAILABLE |
    CACHE_HIGH_WATER_UNAVAILABLE;

const CACHE_BUFFER = CACHE_START;
const CACHE_TEXTURE = CACHE_BUFFER + CACHE_STRIDE;
const CACHE_SAMPLER = CACHE_TEXTURE + CACHE_STRIDE;
const CACHE_PROGRAM = CACHE_SAMPLER + CACHE_STRIDE;
const CACHE_PIPELINE = CACHE_PROGRAM + CACHE_STRIDE;
const CACHE_BIND_GROUP_LAYOUT = CACHE_PIPELINE + CACHE_STRIDE;
const CACHE_PIPELINE_LAYOUT = CACHE_BIND_GROUP_LAYOUT + CACHE_STRIDE;
const CACHE_BIND_GROUP = CACHE_PIPELINE_LAYOUT + CACHE_STRIDE;
const CACHE_FRAMEBUFFER = CACHE_BIND_GROUP + CACHE_STRIDE;
const CACHE_VERTEX_ARRAY = CACHE_FRAMEBUFFER + CACHE_STRIDE;

const FRAME_START = CACHE_VERTEX_ARRAY + CACHE_STRIDE;
const FRAME_DRAWS = FRAME_START;
const FRAME_INDIRECT_DRAWS = FRAME_DRAWS + 1;
const FRAME_DISPATCHES = FRAME_INDIRECT_DRAWS + 1;
const FRAME_DISPATCHED_WORKGROUPS = FRAME_DISPATCHES + 1;
const FRAME_BUFFER_CLEARS = FRAME_DISPATCHED_WORKGROUPS + 1;
const FRAME_COMMANDS = FRAME_BUFFER_CLEARS + 1;
const FRAME_PASSES = FRAME_COMMANDS + 1;
const FRAME_STATE_CHANGES = FRAME_PASSES + 1;
const FRAME_COMPUTE_PIPELINE_SWITCHES = FRAME_STATE_CHANGES + 1;
const FRAME_COMPUTE_BIND_GROUP_SWITCHES = FRAME_COMPUTE_PIPELINE_SWITCHES + 1;
const FRAME_UPLOADS = FRAME_COMPUTE_BIND_GROUP_SWITCHES + 1;
const FRAME_SUBMISSIONS = FRAME_UPLOADS + 1;
const FRAME_ARENA_GROWTHS = FRAME_SUBMISSIONS + 1;
const COUNTER_COUNT = FRAME_ARENA_GROWTHS + 1;

function nativeObjectBase(kind: RendererNativeObjectKind): number {
    switch (kind) {
        case 'buffer':
            return NATIVE_BUFFER;
        case 'texture':
            return NATIVE_TEXTURE;
        case 'textureView':
            return NATIVE_TEXTURE_VIEW;
        case 'sampler':
            return NATIVE_SAMPLER;
        case 'shaderModule':
            return NATIVE_SHADER_MODULE;
        case 'program':
            return NATIVE_PROGRAM;
        case 'pipeline':
            return NATIVE_PIPELINE;
        case 'bindGroupLayout':
            return NATIVE_BIND_GROUP_LAYOUT;
        case 'pipelineLayout':
            return NATIVE_PIPELINE_LAYOUT;
        case 'bindGroup':
            return NATIVE_BIND_GROUP;
        case 'framebuffer':
            return NATIVE_FRAMEBUFFER;
        case 'renderbuffer':
            return NATIVE_RENDERBUFFER;
        case 'vertexArray':
            return NATIVE_VERTEX_ARRAY;
        case 'commandEncoder':
            return NATIVE_COMMAND_ENCODER;
        case 'commandBuffer':
            return NATIVE_COMMAND_BUFFER;
    }
}

function cacheBase(kind: RendererCacheKind): number {
    switch (kind) {
        case 'buffer':
            return CACHE_BUFFER;
        case 'texture':
            return CACHE_TEXTURE;
        case 'sampler':
            return CACHE_SAMPLER;
        case 'program':
            return CACHE_PROGRAM;
        case 'pipeline':
            return CACHE_PIPELINE;
        case 'bindGroupLayout':
            return CACHE_BIND_GROUP_LAYOUT;
        case 'pipelineLayout':
            return CACHE_PIPELINE_LAYOUT;
        case 'bindGroup':
            return CACHE_BIND_GROUP;
        case 'framebuffer':
            return CACHE_FRAMEBUFFER;
        case 'vertexArray':
            return CACHE_VERTEX_ARRAY;
    }
}

function requirePositiveCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new RangeError('Diagnostic counter increments must be positive safe integers');
    }
}

function requireSize(size: number): void {
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new RangeError('Diagnostic cache sizes must be non-negative safe integers');
    }
}

/**
 * Backend-neutral renderer counters. A renderer owns one instance and reuses its fixed typed-array
 * storage across frames. Recording methods do not allocate; only an explicit snapshot does.
 */
export class RendererDiagnostics implements RenderGraphTimelineSink {
    readonly #counters = new Float64Array(COUNTER_COUNT);
    #renderGraphTimeline: Readonly<RenderGraphTimelineSnapshot> | null = null;

    recordRenderGraphTimeline(snapshot: Readonly<RenderGraphTimelineSnapshot>): void {
        if (
            this.#renderGraphTimeline === null ||
            snapshot.frameIndex >= this.#renderGraphTimeline.frameIndex
        ) {
            this.#renderGraphTimeline = snapshot;
        }
    }

    recordNativeObjectCreated(kind: RendererNativeObjectKind, count = 1): void {
        requirePositiveCount(count);
        const base = nativeObjectBase(kind);
        if (this.value(base + NATIVE_LIFETIME_UNKNOWN) !== 0) {
            throw new Error(
                `Cannot mix complete and creation-only native object diagnostics for ${kind}`
            );
        }
        const live = this.value(base + NATIVE_LIVE) + count;
        this.increment(base + NATIVE_CREATED, count);
        this.setValue(base + NATIVE_LIVE, live);
        if (live > this.value(base + NATIVE_HIGH_WATER)) {
            this.setValue(base + NATIVE_HIGH_WATER, live);
        }
    }

    recordNativeObjectDestroyed(kind: RendererNativeObjectKind, count = 1): void {
        requirePositiveCount(count);
        const base = nativeObjectBase(kind);
        if (this.value(base + NATIVE_LIFETIME_UNKNOWN) !== 0) {
            throw new Error(
                `Cannot mix complete and creation-only native object diagnostics for ${kind}`
            );
        }
        const live = this.value(base + NATIVE_LIVE);
        if (count > live) {
            throw new RangeError('Cannot destroy more native objects than are live');
        }
        this.increment(base + NATIVE_DESTROYED, count);
        this.setValue(base + NATIVE_LIVE, live - count);
    }

    /**
     * Record a creation counter exposed by a backend that cannot observe the object's lifetime.
     * The snapshot keeps `created` exact and reports destroyed/live/highWater as `null`.
     */
    recordNativeObjectCreatedOnly(kind: RendererNativeObjectKind, count = 1): void {
        requirePositiveCount(count);
        const base = nativeObjectBase(kind);
        const lifetimeUnknown = this.value(base + NATIVE_LIFETIME_UNKNOWN) !== 0;
        if (
            !lifetimeUnknown &&
            (this.value(base + NATIVE_CREATED) !== 0 ||
                this.value(base + NATIVE_DESTROYED) !== 0 ||
                this.value(base + NATIVE_LIVE) !== 0 ||
                this.value(base + NATIVE_HIGH_WATER) !== 0)
        ) {
            throw new Error(
                `Cannot mix complete and creation-only native object diagnostics for ${kind}`
            );
        }
        this.setValue(base + NATIVE_LIFETIME_UNKNOWN, 1);
        this.increment(base + NATIVE_CREATED, count);
    }

    /** Mark every cache metric unavailable when a backend exposes no cache diagnostics. */
    markCacheUnavailable(kind: RendererCacheKind): void {
        this.markCacheMetricsUnavailable(kind, ALL_CACHE_METRICS_UNAVAILABLE);
    }

    /**
     * Mark a cache as hit-only: hit counts remain exact while miss/eviction/size metrics are null.
     */
    markCacheHitOnly(kind: RendererCacheKind): void {
        this.markCacheMetricsUnavailable(kind, CACHE_OUTCOMES_ONLY_UNAVAILABLE);
    }

    recordCacheHit(kind: RendererCacheKind, count = 1): void {
        requirePositiveCount(count);
        const base = cacheBase(kind);
        this.assertCacheMetricAvailable(kind, base, CACHE_HITS_UNAVAILABLE, 'hits');
        this.increment(base + CACHE_HITS, count);
    }

    recordCacheMiss(kind: RendererCacheKind, count = 1): void {
        requirePositiveCount(count);
        const base = cacheBase(kind);
        this.assertCacheMetricAvailable(kind, base, CACHE_MISSES_UNAVAILABLE, 'misses');
        this.increment(base + CACHE_MISSES, count);
    }

    recordCacheEviction(kind: RendererCacheKind, count = 1): void {
        requirePositiveCount(count);
        const base = cacheBase(kind);
        this.assertCacheMetricAvailable(kind, base, CACHE_EVICTIONS_UNAVAILABLE, 'evictions');
        this.increment(base + CACHE_EVICTIONS, count);
    }

    setCacheSize(kind: RendererCacheKind, size: number): void {
        requireSize(size);
        const base = cacheBase(kind);
        this.assertCacheMetricAvailable(kind, base, CACHE_SIZE_UNAVAILABLE, 'size');
        this.assertCacheMetricAvailable(kind, base, CACHE_HIGH_WATER_UNAVAILABLE, 'highWater');
        this.setValue(base + CACHE_SIZE, size);
        if (size > this.value(base + CACHE_HIGH_WATER)) {
            this.setValue(base + CACHE_HIGH_WATER, size);
        }
    }

    /**
     * Copy one stable cache provider's cumulative values into the renderer-owned counter storage.
     * This performs no allocation and is intended for one call at the end of each logical frame.
     */
    synchronizeCache(kind: RendererCacheKind, counters: Readonly<RHICacheCounters>): void {
        requireSize(counters.hits);
        requireSize(counters.misses);
        requireSize(counters.evictions);
        requireSize(counters.size);
        requireSize(counters.highWater);
        if (counters.highWater < counters.size) {
            throw new RangeError('Diagnostic cache high-water size cannot be below current size');
        }
        const base = cacheBase(kind);
        this.assertCacheMetricAvailable(kind, base, CACHE_HITS_UNAVAILABLE, 'hits');
        this.assertCacheMetricAvailable(kind, base, CACHE_MISSES_UNAVAILABLE, 'misses');
        this.assertCacheMetricAvailable(kind, base, CACHE_EVICTIONS_UNAVAILABLE, 'evictions');
        this.assertCacheMetricAvailable(kind, base, CACHE_SIZE_UNAVAILABLE, 'size');
        this.assertCacheMetricAvailable(kind, base, CACHE_HIGH_WATER_UNAVAILABLE, 'highWater');
        if (
            counters.hits < this.value(base + CACHE_HITS) ||
            counters.misses < this.value(base + CACHE_MISSES) ||
            counters.evictions < this.value(base + CACHE_EVICTIONS) ||
            counters.highWater < this.value(base + CACHE_HIGH_WATER)
        ) {
            throw new RangeError('Cumulative diagnostic cache counters cannot move backwards');
        }
        this.setValue(base + CACHE_HITS, counters.hits);
        this.setValue(base + CACHE_MISSES, counters.misses);
        this.setValue(base + CACHE_EVICTIONS, counters.evictions);
        this.setValue(base + CACHE_SIZE, counters.size);
        this.setValue(base + CACHE_HIGH_WATER, counters.highWater);
    }

    recordDraw(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_DRAWS, count);
    }

    recordIndirectDraw(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_INDIRECT_DRAWS, count);
    }

    recordDispatch(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_DISPATCHES, count);
    }

    recordDispatchedWorkgroup(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_DISPATCHED_WORKGROUPS, count);
    }

    recordBufferClear(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_BUFFER_CLEARS, count);
    }

    recordCommand(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_COMMANDS, count);
    }

    recordPass(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_PASSES, count);
    }

    recordStateChange(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_STATE_CHANGES, count);
    }

    recordComputePipelineSwitch(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_COMPUTE_PIPELINE_SWITCHES, count);
    }

    recordComputeBindGroupSwitch(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_COMPUTE_BIND_GROUP_SWITCHES, count);
    }

    recordUpload(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_UPLOADS, count);
    }

    recordSubmission(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_SUBMISSIONS, count);
    }

    recordArenaGrowth(count = 1): void {
        requirePositiveCount(count);
        this.increment(FRAME_ARENA_GROWTHS, count);
    }

    resetFrame(): void {
        this.#counters.fill(0, FRAME_START);
    }

    snapshot(): Readonly<RendererDiagnosticsSnapshot> {
        return Object.freeze({
            nativeObjects: Object.freeze({
                buffer: this.nativeObjectSnapshot(NATIVE_BUFFER),
                texture: this.nativeObjectSnapshot(NATIVE_TEXTURE),
                textureView: this.nativeObjectSnapshot(NATIVE_TEXTURE_VIEW),
                sampler: this.nativeObjectSnapshot(NATIVE_SAMPLER),
                shaderModule: this.nativeObjectSnapshot(NATIVE_SHADER_MODULE),
                program: this.nativeObjectSnapshot(NATIVE_PROGRAM),
                pipeline: this.nativeObjectSnapshot(NATIVE_PIPELINE),
                bindGroupLayout: this.nativeObjectSnapshot(NATIVE_BIND_GROUP_LAYOUT),
                pipelineLayout: this.nativeObjectSnapshot(NATIVE_PIPELINE_LAYOUT),
                bindGroup: this.nativeObjectSnapshot(NATIVE_BIND_GROUP),
                framebuffer: this.nativeObjectSnapshot(NATIVE_FRAMEBUFFER),
                renderbuffer: this.nativeObjectSnapshot(NATIVE_RENDERBUFFER),
                vertexArray: this.nativeObjectSnapshot(NATIVE_VERTEX_ARRAY),
                commandEncoder: this.nativeObjectSnapshot(NATIVE_COMMAND_ENCODER),
                commandBuffer: this.nativeObjectSnapshot(NATIVE_COMMAND_BUFFER)
            }),
            caches: Object.freeze({
                buffer: this.cacheSnapshot(CACHE_BUFFER),
                texture: this.cacheSnapshot(CACHE_TEXTURE),
                sampler: this.cacheSnapshot(CACHE_SAMPLER),
                program: this.cacheSnapshot(CACHE_PROGRAM),
                pipeline: this.cacheSnapshot(CACHE_PIPELINE),
                bindGroupLayout: this.cacheSnapshot(CACHE_BIND_GROUP_LAYOUT),
                pipelineLayout: this.cacheSnapshot(CACHE_PIPELINE_LAYOUT),
                bindGroup: this.cacheSnapshot(CACHE_BIND_GROUP),
                framebuffer: this.cacheSnapshot(CACHE_FRAMEBUFFER),
                vertexArray: this.cacheSnapshot(CACHE_VERTEX_ARRAY)
            }),
            frame: Object.freeze({
                draws: this.value(FRAME_DRAWS),
                indirectDraws: this.value(FRAME_INDIRECT_DRAWS),
                dispatches: this.value(FRAME_DISPATCHES),
                dispatchedWorkgroups: this.value(FRAME_DISPATCHED_WORKGROUPS),
                bufferClears: this.value(FRAME_BUFFER_CLEARS),
                commands: this.value(FRAME_COMMANDS),
                passes: this.value(FRAME_PASSES),
                stateChanges: this.value(FRAME_STATE_CHANGES),
                computePipelineSwitches: this.value(FRAME_COMPUTE_PIPELINE_SWITCHES),
                computeBindGroupSwitches: this.value(FRAME_COMPUTE_BIND_GROUP_SWITCHES),
                uploads: this.value(FRAME_UPLOADS),
                submissions: this.value(FRAME_SUBMISSIONS),
                arenaGrowths: this.value(FRAME_ARENA_GROWTHS)
            }),
            renderGraph: this.#renderGraphTimeline
        });
    }

    private increment(index: number, count: number): void {
        this.#counters[index] = this.value(index) + count;
    }

    private setValue(index: number, value: number): void {
        this.#counters[index] = value;
    }

    private value(index: number): number {
        return this.#counters[index] ?? 0;
    }

    private nativeObjectSnapshot(base: number): RendererNativeObjectCountersSnapshot {
        const lifetimeUnknown = this.value(base + NATIVE_LIFETIME_UNKNOWN) !== 0;
        return Object.freeze({
            created: this.value(base + NATIVE_CREATED),
            destroyed: lifetimeUnknown ? null : this.value(base + NATIVE_DESTROYED),
            live: lifetimeUnknown ? null : this.value(base + NATIVE_LIVE),
            highWater: lifetimeUnknown ? null : this.value(base + NATIVE_HIGH_WATER)
        });
    }

    private cacheSnapshot(base: number): RendererCacheCountersSnapshot {
        const unavailable = this.value(base + CACHE_UNAVAILABLE);
        return Object.freeze({
            hits: this.cacheMetric(base, unavailable, CACHE_HITS, CACHE_HITS_UNAVAILABLE),
            misses: this.cacheMetric(base, unavailable, CACHE_MISSES, CACHE_MISSES_UNAVAILABLE),
            evictions: this.cacheMetric(
                base,
                unavailable,
                CACHE_EVICTIONS,
                CACHE_EVICTIONS_UNAVAILABLE
            ),
            size: this.cacheMetric(base, unavailable, CACHE_SIZE, CACHE_SIZE_UNAVAILABLE),
            highWater: this.cacheMetric(
                base,
                unavailable,
                CACHE_HIGH_WATER,
                CACHE_HIGH_WATER_UNAVAILABLE
            )
        });
    }

    private markCacheMetricsUnavailable(kind: RendererCacheKind, mask: number): void {
        const base = cacheBase(kind);
        const unavailable = this.value(base + CACHE_UNAVAILABLE);
        const newlyUnavailable = mask & ~unavailable;
        if (
            ((newlyUnavailable & CACHE_HITS_UNAVAILABLE) !== 0 &&
                this.value(base + CACHE_HITS) !== 0) ||
            ((newlyUnavailable & CACHE_MISSES_UNAVAILABLE) !== 0 &&
                this.value(base + CACHE_MISSES) !== 0) ||
            ((newlyUnavailable & CACHE_EVICTIONS_UNAVAILABLE) !== 0 &&
                this.value(base + CACHE_EVICTIONS) !== 0) ||
            ((newlyUnavailable & CACHE_SIZE_UNAVAILABLE) !== 0 &&
                this.value(base + CACHE_SIZE) !== 0) ||
            ((newlyUnavailable & CACHE_HIGH_WATER_UNAVAILABLE) !== 0 &&
                this.value(base + CACHE_HIGH_WATER) !== 0)
        ) {
            throw new Error(`Cannot discard already-recorded cache diagnostics for ${kind}`);
        }
        this.setValue(base + CACHE_UNAVAILABLE, unavailable | mask);
    }

    private assertCacheMetricAvailable(
        kind: RendererCacheKind,
        base: number,
        mask: number,
        metric: string
    ): void {
        if ((this.value(base + CACHE_UNAVAILABLE) & mask) !== 0) {
            throw new Error(`Cache ${kind} ${metric} diagnostics are unavailable`);
        }
    }

    private cacheMetric(
        base: number,
        unavailable: number,
        offset: number,
        mask: number
    ): number | null {
        return (unavailable & mask) !== 0 ? null : this.value(base + offset);
    }
}
