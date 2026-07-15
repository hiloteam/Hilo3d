import type {
    RendererArchitecture,
    RHIBenchmarkBackend,
    RHIBenchmarkQuality,
    RHIBenchmarkScenarioId
} from './result-schema';

export const RHI_BENCHMARK_FIXTURE_PROTOCOL_VERSION = 11 as const;
export const RHI_BENCHMARK_ALLOCATION_PROFILER_PROTOCOL =
    'chromium-cdp-windowed-sampling-heap-profiler-sync-render-v11' as const;
/** The fixed quiescence proof now ends immediately before measured samples; no duplicate discard. */
export const RHI_BENCHMARK_ALLOCATION_DISCARDED_PROFILES = 0 as const;

/** Ordinary frames rendered after timing wrappers are removed and before CDP sampling starts. */
export const RHI_BENCHMARK_ALLOCATION_POST_SUSPEND_WARMUP_FRAMES = 30 as const;

/** Exact non-retained production frames that tier draw-level and once-per-frame renderer paths. */
export const RHI_BENCHMARK_ALLOCATION_PROFILER_WARMUP_FRAMES = 288 as const;

/** Production-boundary frame that re-enters real renderer work after each retained restart. */
export const RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_RENDER_FRAMES = 1 as const;

/**
 * Separate foreground Runtime calls that give pending V8 work fixed opportunities to install
 * without retaining more full frames. These follow the real render retraining so pending tier
 * installs receive deterministic task boundaries before the marked fail-closed proof begins.
 */
export const RHI_BENCHMARK_ALLOCATION_PROFILER_RESTART_NOOP_TASKS = 32 as const;

/** Fixed measured-frame chunk that bounds each one-byte retained sampling profile. */
export const RHI_BENCHMARK_ALLOCATION_PROFILE_MEASURED_CHUNK_FRAMES = 7 as const;

/** Consecutive marked in-budget frames required immediately before the measured window. */
export const RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_STABLE_FRAMES = 5 as const;

/** One fixed marked probe verified from the final retained-object profile. */
export const RHI_BENCHMARK_ALLOCATION_PROFILER_QUIESCENCE_PROBE_FRAMES = 21 as const;

export function rhiBenchmarkAllocationProfilerWarmupFrames(drawCount: number): number {
    if (!Number.isSafeInteger(drawCount) || drawCount < 1) {
        throw new RangeError('RHI allocation profiler warm-up draw count must be positive');
    }
    return RHI_BENCHMARK_ALLOCATION_PROFILER_WARMUP_FRAMES;
}

export const RHI_BENCHMARK_TIMING_METRICS = [
    'frameBuildCpuMs',
    'graphCompileCpuMs',
    'rhiCommandCpuMs',
    'rhiExecuteCpuMs',
    'rhiTotalCpuMs',
    'rendererCpuMs'
] as const;

export const RHI_BENCHMARK_DIAGNOSTIC_METRICS = [
    'rhiCommandCount',
    'actualDrawCount',
    'nativeStateCallCount',
    'pipelineCacheHitRate',
    'bindGroupCacheHitRate',
    'vaoCacheHitRate',
    'framebufferCacheHitRate'
] as const;

export const RHI_BENCHMARK_NATIVE_CREATE_METRICS = [
    'nativeBufferCreateCount',
    'nativeTextureCreateCount',
    'nativePipelineCreateCount',
    'nativeBindGroupCreateCount',
    'nativeVaoCreateCount',
    'nativeProgramCreateCount'
] as const;

export type RHIBenchmarkTimingMetric = (typeof RHI_BENCHMARK_TIMING_METRICS)[number];
export type RHIBenchmarkDiagnosticMetric = (typeof RHI_BENCHMARK_DIAGNOSTIC_METRICS)[number];
export type RHIBenchmarkNativeCreateMetric = (typeof RHI_BENCHMARK_NATIVE_CREATE_METRICS)[number];

export interface RHIBenchmarkFixtureCapabilities {
    /** Actual method-boundary instrumentation; aggregate wall-clock substitution is forbidden. */
    readonly cpuSegments: string;
    readonly highResolutionClock: string;
    readonly gpuTimer: string;
    /** One-byte Chromium sampling with collected objects retained in the profile. */
    readonly allocationProfiler: string;
    readonly preciseMemory: string;
    readonly nativeCounters: string;
}

export interface RHIBenchmarkFixtureMetadata {
    readonly protocolVersion: number;
    readonly isolationId: string;
    readonly architecture: RendererArchitecture;
    readonly backend: RHIBenchmarkBackend;
    readonly scenarioId: RHIBenchmarkScenarioId;
    readonly quality: RHIBenchmarkQuality;
    readonly capabilities: RHIBenchmarkFixtureCapabilities;
}

export type RHIBenchmarkTimingSample = Readonly<Record<RHIBenchmarkTimingMetric, number>>;

/** `null` means the renderer cannot prove the metric; the production collector must reject it. */
export type RHIBenchmarkDiagnosticSample = Readonly<
    Record<RHIBenchmarkDiagnosticMetric, number | null>
>;

export interface RHIBenchmarkFixtureFrameSample {
    readonly timing: RHIBenchmarkTimingSample;
    readonly diagnostics: RHIBenchmarkDiagnosticSample;
    readonly heapUsedBytes: number;
}

export type RHIBenchmarkNativeCreateCounts = Readonly<
    Record<RHIBenchmarkNativeCreateMetric, number | null>
>;

export interface RHIBenchmarkFixtureRoundResult {
    readonly heapHighWaterBytes: number;
    readonly retainedHeapBytes: number;
    readonly nativeCreateCounts: RHIBenchmarkNativeCreateCounts;
    readonly firstComplexFrameCpuMs: number;
    readonly shaderFirstPrepareMs: number;
    readonly pipelineFirstPrepareMs: number;
    readonly pixelHashSha256: string;
}

/**
 * Browser-page protocol. Every architecture/round gets a fresh page and therefore a fresh
 * renderer, graphics context/device, scene, shader cache and diagnostics sink.
 */
export interface RHIBenchmarkProductionFixture {
    readonly metadata: RHIBenchmarkFixtureMetadata;
    warmup(frameCount: number): Promise<void>;
    sampleTimingFrames(frameCount: number): Promise<readonly RHIBenchmarkFixtureFrameSample[]>;
    sampleGpuFrames(frameCount: number): Promise<readonly number[]>;
    /** Suspend timing wrappers once before a contiguous CDP allocation-profile phase. */
    beginAllocationSampling(): void;
    /**
     * Render exactly one complete synchronous renderer frame while CDP allocation sampling is
     * active. GPU completion and asynchronous submission bookkeeping are deliberately excluded.
     */
    renderAllocationFrame(): void;
    /** Settle the frame after CDP sampling stopped, before the next allocation sample starts. */
    settleAllocationFrame(): Promise<void>;
    /** Restore timing instrumentation only after every allocation profile has stopped. */
    endAllocationSampling(): void;
    /** Complete scenario-specific work (notably the fixed 10,000-frame churn run). */
    completeRound(): Promise<void>;
    /** Capture parity pixels without inventing retained-heap input for the non-evidence smoke. */
    capturePixelHash(): Promise<string>;
    finishRound(retainedHeapBytes: number): Promise<RHIBenchmarkFixtureRoundResult>;
    destroy(): Promise<void>;
}

declare global {
    interface Window {
        __HILO3D_RHI_BENCHMARK__?: RHIBenchmarkProductionFixture;
        __HILO3D_RHI_BENCHMARK_ERROR__?: string;
    }
}
