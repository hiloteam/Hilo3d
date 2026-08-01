import type { CompiledRenderGraph } from './RenderGraphCompiler';

export type RGPassTimestampKind = 'render' | 'compute';

export type RenderGraphGPUTimelineStatus =
    'unavailable' | 'pending' | 'ready' | 'failed' | 'saturated';

export interface RenderGraphPassTimelineSnapshot {
    readonly name: string;
    readonly kind: RGPassTimestampKind | null;
    readonly cpuDurationMs: number;
    readonly gpuDurationMs: number | null;
}

export interface RenderGraphResourceLifetimeSnapshot {
    readonly name: string;
    readonly kind: 'texture' | 'texture-view' | 'buffer';
    readonly origin: 'imported' | 'transient' | 'view';
    readonly firstUse: number | null;
    readonly lastUse: number | null;
}

/** One immutable CPU/GPU view of a compiled and submitted Render Graph frame. */
export interface RenderGraphTimelineSnapshot {
    readonly frameIndex: number;
    readonly recordDurationMs: number;
    readonly compileDurationMs: number;
    readonly prepareDurationMs: number;
    readonly executeDurationMs: number;
    readonly gpuStatus: RenderGraphGPUTimelineStatus;
    readonly passes: readonly RenderGraphPassTimelineSnapshot[];
    readonly resources: readonly RenderGraphResourceLifetimeSnapshot[];
}

/** Optional diagnostics consumer; absence is the Render Graph profiling fast path. */
export interface RenderGraphTimelineSink {
    recordRenderGraphTimeline(snapshot: Readonly<RenderGraphTimelineSnapshot>): void;
}

interface MutablePassTimeline {
    name: string;
    kind: RGPassTimestampKind | null;
    cpuDurationMs: number;
    gpuDurationMs: number | null;
}

/** @internal Frame-scoped recorder retained until optional GPU readback settles. */
export class RenderGraphTimelineRecorder {
    readonly #passes: MutablePassTimeline[] = [];
    readonly #resources: RenderGraphResourceLifetimeSnapshot[] = [];
    #recordDurationMs = 0;
    #compileDurationMs = 0;
    #prepareDurationMs = 0;
    #executeDurationMs = 0;
    #gpuStatus: RenderGraphGPUTimelineStatus = 'unavailable';

    constructor(
        readonly frameIndex: number,
        readonly sink: RenderGraphTimelineSink
    ) {}

    get timestampPassCount(): number {
        let count = 0;
        for (const pass of this.#passes) {
            if (pass.kind !== null) count++;
        }
        return count;
    }

    setRecordDuration(durationMs: number): void {
        this.#recordDurationMs = durationMs;
    }

    setCompileDuration(durationMs: number): void {
        this.#compileDurationMs = durationMs;
    }

    setPrepareDuration(durationMs: number): void {
        this.#prepareDurationMs = durationMs;
    }

    setExecuteDuration(durationMs: number): void {
        this.#executeDurationMs = durationMs;
    }

    captureGraph(graph: CompiledRenderGraph): void {
        this.#passes.length = 0;
        for (const pass of graph.passes) {
            const kind = pass.template.timestampKind?.(pass.params) ?? null;
            this.#passes.push({ name: pass.name, kind, cpuDurationMs: 0, gpuDurationMs: null });
        }
        this.#resources.length = 0;
        for (const resource of graph.resources) {
            this.#resources.push(
                Object.freeze({
                    name: resource.name,
                    kind: resource.kind,
                    origin: resource.origin,
                    firstUse: resource.lifetime?.firstUse ?? null,
                    lastUse: resource.lifetime?.lastUse ?? null
                })
            );
        }
    }

    passKind(index: number): RGPassTimestampKind | null {
        return this.#passes[index]?.kind ?? null;
    }

    setPassCPUTime(index: number, durationMs: number): void {
        const pass = this.#passes[index];
        if (pass !== undefined) pass.cpuDurationMs = durationMs;
    }

    markGPUPending(): void {
        this.#gpuStatus = 'pending';
    }

    markGPUUnavailable(status: 'unavailable' | 'saturated'): void {
        this.#gpuStatus = status;
    }

    completeGPU(queryPassIndices: readonly number[], timestamps: BigUint64Array): void {
        for (let index = 0; index < queryPassIndices.length; index += 1) {
            const pass = this.#passes[queryPassIndices[index] ?? -1];
            const beginning = timestamps[index * 2];
            const end = timestamps[index * 2 + 1];
            if (pass === undefined || beginning === undefined || end === undefined) continue;
            pass.gpuDurationMs = end >= beginning ? Number(end - beginning) / 1_000_000 : null;
        }
        this.#gpuStatus = 'ready';
        this.publish();
    }

    failGPU(): void {
        this.#gpuStatus = 'failed';
        this.publish();
    }

    publish(): void {
        const passes = this.#passes.map(pass =>
            Object.freeze({
                name: pass.name,
                kind: pass.kind,
                cpuDurationMs: pass.cpuDurationMs,
                gpuDurationMs: pass.gpuDurationMs
            })
        );
        this.sink.recordRenderGraphTimeline(
            Object.freeze({
                frameIndex: this.frameIndex,
                recordDurationMs: this.#recordDurationMs,
                compileDurationMs: this.#compileDurationMs,
                prepareDurationMs: this.#prepareDurationMs,
                executeDurationMs: this.#executeDurationMs,
                gpuStatus: this.#gpuStatus,
                passes: Object.freeze(passes),
                resources: Object.freeze([...this.#resources])
            })
        );
    }
}
