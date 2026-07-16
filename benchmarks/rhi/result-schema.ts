export const RHI_BENCHMARK_BACKENDS = ['webgl2', 'webgpu'] as const;
/**
 * TODO(rhi-zero-allocation): remove this temporary allowance and restore a zero-byte hard cap
 * after Chromium/V8 sampler-tier metadata is stable across the complete workload matrix.
 */
export const RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES = 16 * 1024;
export const RHI_BENCHMARK_SCENARIO_IDS = [
    'static-unlit-single-draw',
    'shared-pipeline-1000-draw',
    'shared-pipeline-10000-draw',
    'state-switch-2000-draw',
    'large-instancing',
    'pbr-lights-shadows',
    'mrt-msaa-postprocess',
    'dynamic-geometry-texture-upload',
    'first-complex-frame',
    'scene-churn-10000-frame'
] as const;
export const RHI_BENCHMARK_FRAME_METRICS = [
    'frameBuildCpuMs',
    'graphCompileCpuMs',
    'rhiCommandCpuMs',
    'rhiExecuteCpuMs',
    'rhiTotalCpuMs',
    'rendererCpuMs',
    'gpuFrameMs',
    'allocationBytesPerFrame',
    'rhiHotPathAllocationBytesPerFrame',
    'rhiCommandCount',
    'actualDrawCount',
    'nativeStateCallCount',
    'pipelineCacheHitRate',
    'bindGroupCacheHitRate',
    'vaoCacheHitRate',
    'framebufferCacheHitRate'
] as const;
export const RHI_BENCHMARK_ROUND_METRICS = [
    'heapHighWaterBytes',
    'retainedHeapBytes',
    'nativeBufferCreateCount',
    'nativeTextureCreateCount',
    'nativePipelineCreateCount',
    'nativeBindGroupCreateCount',
    'nativeVaoCreateCount',
    'nativeProgramCreateCount',
    'firstComplexFrameCpuMs',
    'shaderFirstPrepareMs',
    'pipelineFirstPrepareMs'
] as const;
export const RHI_BENCHMARK_METRICS = [
    ...RHI_BENCHMARK_FRAME_METRICS,
    ...RHI_BENCHMARK_ROUND_METRICS
] as const;

export const RHI_BENCHMARK_CACHE_HIT_METRICS = [
    'pipelineCacheHitRate',
    'bindGroupCacheHitRate',
    'vaoCacheHitRate',
    'framebufferCacheHitRate'
] as const;

export const RHI_BENCHMARK_ALLOCATION_METRICS = [
    'allocationBytesPerFrame',
    'rhiHotPathAllocationBytesPerFrame'
] as const;

/** Fixed profiler-frame count shared by formal evidence collection and the non-evidence smoke. */
export const RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES = 21;

export type RHIBenchmarkBackend = (typeof RHI_BENCHMARK_BACKENDS)[number];
export type RHIBenchmarkScenarioId = (typeof RHI_BENCHMARK_SCENARIO_IDS)[number];
export type RHIBenchmarkMetric = (typeof RHI_BENCHMARK_METRICS)[number];
export type RHIBenchmarkFrameMetric = (typeof RHI_BENCHMARK_FRAME_METRICS)[number];
export type RHIBenchmarkRoundMetric = (typeof RHI_BENCHMARK_ROUND_METRICS)[number];
export type RHIBenchmarkMetricScope = 'frame' | 'round';
export type RHIBenchmarkRegressionDirection = 'higher-is-worse' | 'lower-is-worse' | 'invariant';
export type RendererArchitecture = 'rhi';

export function rhiBenchmarkMetricScope(metric: RHIBenchmarkMetric): RHIBenchmarkMetricScope {
    return (RHI_BENCHMARK_FRAME_METRICS as readonly string[]).includes(metric) ? 'frame' : 'round';
}

export function rhiBenchmarkMetricSampleCount(
    metric: RHIBenchmarkMetric,
    sampling: RHIBenchmarkSamplingManifest
): number {
    if (rhiBenchmarkMetricScope(metric) === 'round') return 1;
    return (RHI_BENCHMARK_ALLOCATION_METRICS as readonly string[]).includes(metric)
        ? sampling.allocationSampleFrames
        : sampling.sampleFrames;
}

export function rhiBenchmarkRegressionDirection(
    metric: RHIBenchmarkMetric
): RHIBenchmarkRegressionDirection {
    if ((RHI_BENCHMARK_CACHE_HIT_METRICS as readonly string[]).includes(metric)) {
        return 'lower-is-worse';
    }
    return metric === 'actualDrawCount' ? 'invariant' : 'higher-is-worse';
}

export type RHIBenchmarkGateStatistic = 'median' | 'p50' | 'p95' | 'p99' | 'maximum';

export interface RHIBenchmarkHardCap {
    readonly id: string;
    readonly metric: RHIBenchmarkMetric;
    readonly statistic: RHIBenchmarkGateStatistic;
    readonly maximumRegressionFraction?: number;
    readonly absoluteMaximum?: number;
    readonly backend?: RHIBenchmarkBackend;
    readonly scenarioId?: RHIBenchmarkScenarioId;
    readonly excludedScenarioIds?: readonly RHIBenchmarkScenarioId[];
}

/** Section 11.4 hard caps. Statistical positive-regression gates apply in addition to these. */
export const RHI_BENCHMARK_HARD_CAPS: readonly RHIBenchmarkHardCap[] = Object.freeze([
    {
        id: 'steady-renderer-cpu-p50',
        metric: 'rendererCpuMs',
        statistic: 'p50',
        maximumRegressionFraction: 0.02,
        excludedScenarioIds: ['first-complex-frame']
    },
    {
        id: 'steady-renderer-cpu-p95',
        metric: 'rendererCpuMs',
        statistic: 'p95',
        maximumRegressionFraction: 0.03,
        excludedScenarioIds: ['first-complex-frame']
    },
    {
        id: 'webgl2-10000-draw-cpu',
        metric: 'rendererCpuMs',
        statistic: 'p50',
        maximumRegressionFraction: 0.03,
        backend: 'webgl2',
        scenarioId: 'shared-pipeline-10000-draw'
    },
    {
        id: 'webgpu-encode-submit-cpu',
        metric: 'rhiTotalCpuMs',
        statistic: 'p50',
        maximumRegressionFraction: 0.02,
        backend: 'webgpu'
    },
    {
        id: 'gpu-frame-time',
        metric: 'gpuFrameMs',
        statistic: 'p50',
        maximumRegressionFraction: 0.02
    },
    {
        id: 'renderer-allocation',
        metric: 'allocationBytesPerFrame',
        statistic: 'p50',
        maximumRegressionFraction: 0
    },
    {
        id: 'rhi-hot-path-allocation',
        metric: 'rhiHotPathAllocationBytesPerFrame',
        statistic: 'maximum',
        absoluteMaximum: RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES
    },
    {
        id: 'retained-heap',
        metric: 'retainedHeapBytes',
        statistic: 'p50',
        maximumRegressionFraction: 0.05
    },
    {
        id: 'scene-churn-heap-high-water',
        metric: 'heapHighWaterBytes',
        statistic: 'maximum',
        maximumRegressionFraction: 0.05,
        scenarioId: 'scene-churn-10000-frame'
    },
    ...(
        [
            'nativeBufferCreateCount',
            'nativeTextureCreateCount',
            'nativePipelineCreateCount',
            'nativeBindGroupCreateCount',
            'nativeVaoCreateCount',
            'nativeProgramCreateCount'
        ] as const
    ).map(metric => ({
        id: `${metric}-steady`,
        metric,
        statistic: 'p50' as const,
        maximumRegressionFraction: 0
    })),
    ...(
        [
            'nativeBufferCreateCount',
            'nativeTextureCreateCount',
            'nativePipelineCreateCount',
            'nativeBindGroupCreateCount',
            'nativeVaoCreateCount',
            'nativeProgramCreateCount'
        ] as const
    ).map(metric => ({
        id: `${metric}-churn-peak`,
        metric,
        statistic: 'maximum' as const,
        maximumRegressionFraction: 0,
        scenarioId: 'scene-churn-10000-frame' as const
    })),
    {
        id: 'first-complex-frame-p95',
        metric: 'firstComplexFrameCpuMs',
        statistic: 'p95',
        maximumRegressionFraction: 0.05,
        scenarioId: 'first-complex-frame'
    }
]);

export interface RHIBenchmarkSamplingManifest {
    readonly warmupFrames: number;
    readonly sampleFrames: number;
    readonly allocationSampleFrames: number;
    readonly rounds: number;
    readonly bootstrapSeed: number;
    readonly bootstrapIterations: number;
    readonly confidenceLevel: number;
}

export interface RHIBenchmarkRigManifest {
    readonly profile: string;
    readonly requiredRunnerTags: readonly string[];
    readonly osPlatform: string;
    readonly browserName: string;
    readonly playwrightVersion: string;
    readonly nodeVersion: string;
    readonly powerProfile: string;
    readonly requireNonFallbackAdapter: boolean;
    readonly requireGpuTimer: boolean;
    readonly requireAllocationProfiler: boolean;
    readonly requirePreciseMemory: boolean;
    /** Empty until a physical performance rig has been audited and explicitly enrolled. */
    readonly acceptedFingerprintSha256: readonly string[];
}

export interface RHIBenchmarkQuality {
    readonly width: number;
    readonly height: number;
    readonly devicePixelRatio: number;
    readonly cameraId: string;
    readonly drawCount: number;
    readonly instanceCount: number;
    readonly shaderVariantCount: number;
    readonly textureCount: number;
    readonly lightCount: number;
    readonly shadowMapSize: number;
    readonly mrtColorAttachments: number;
    readonly msaaSampleCount: number;
    readonly postProcessPassCount: number;
    readonly dynamicUploadBytesPerFrame: number;
    readonly churnFrames: number;
}

export interface RHIBenchmarkScenarioManifest {
    readonly id: RHIBenchmarkScenarioId;
    readonly purpose: string;
    readonly quality: RHIBenchmarkQuality;
}

export interface RHIBenchmarkManifest {
    readonly schemaVersion: 3;
    readonly suite: 'rhi';
    readonly architecture: 'rhi';
    readonly backends: readonly RHIBenchmarkBackend[];
    readonly sampling: RHIBenchmarkSamplingManifest;
    readonly rig: RHIBenchmarkRigManifest;
    readonly scenarios: readonly RHIBenchmarkScenarioManifest[];
}

export interface RHIBenchmarkEnvironment {
    readonly rigProfile: string;
    readonly runnerTags: readonly string[];
    readonly fingerprintSha256: string;
    readonly osPlatform: string;
    readonly osRelease: string;
    readonly cpuModel: string;
    readonly gpuFingerprint: string;
    readonly gpuDriver: string;
    readonly browserName: string;
    readonly browserVersion: string;
    readonly browserExecutableSha256: string;
    readonly playwrightVersion: string;
    readonly nodeVersion: string;
    readonly powerProfile: string;
    readonly fallbackAdapter: boolean;
    readonly gpuTimerAvailable: boolean;
    readonly allocationProfilerAvailable: boolean;
    readonly preciseMemoryAvailable: boolean;
}

export interface RHIBenchmarkConfidenceInterval {
    readonly low: number;
    readonly high: number;
    readonly confidenceLevel: number;
    readonly bootstrapIterations: number;
    readonly bootstrapSeed: number;
}

export interface RHIBenchmarkDistribution {
    readonly sampleCount: number;
    readonly minimum: number;
    readonly maximum: number;
    readonly median: number;
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly mad: number;
    readonly coefficientOfVariation: number;
    readonly confidenceInterval: RHIBenchmarkConfidenceInterval;
}

export type RHIBenchmarkRoundMetrics = Readonly<
    Record<RHIBenchmarkMetric, RHIBenchmarkDistribution>
>;

export type RHIBenchmarkRawMetricSamples = Readonly<Record<RHIBenchmarkMetric, readonly number[]>>;

export interface RHIBenchmarkRawArchitectureResult {
    readonly observedDrawCount: number;
    readonly pixelHashSha256: string;
    readonly metrics: RHIBenchmarkRawMetricSamples;
}

export interface RHIBenchmarkRawRoundResult {
    readonly round: number;
    readonly order: readonly RendererArchitecture[];
    readonly results: Readonly<Record<RendererArchitecture, RHIBenchmarkRawArchitectureResult>>;
}

export interface RHIBenchmarkRawCaseResult {
    readonly scenarioId: RHIBenchmarkScenarioId;
    readonly backend: RHIBenchmarkBackend;
    readonly quality: RHIBenchmarkQuality;
    readonly rounds: readonly RHIBenchmarkRawRoundResult[];
}

export interface RHIBenchmarkProductionFixtureIdentity {
    readonly path: string;
    readonly sha256: string;
}

export interface RHIBenchmarkRawCaptureResult {
    readonly schemaVersion: 3;
    readonly suite: 'rhi';
    readonly manifestSha256: string;
    readonly commitSha: string;
    readonly capturedAt: string;
    readonly environment: RHIBenchmarkEnvironment;
    readonly productionFixture: RHIBenchmarkProductionFixtureIdentity;
    readonly cases: readonly RHIBenchmarkRawCaseResult[];
}

export interface RHIBenchmarkRoundResult {
    readonly round: number;
    readonly sampleCount: number;
    readonly orderPosition: number;
    readonly metrics: RHIBenchmarkRoundMetrics;
}

export interface RHIBenchmarkCaseResult {
    readonly scenarioId: RHIBenchmarkScenarioId;
    readonly backend: RHIBenchmarkBackend;
    readonly quality: RHIBenchmarkQuality;
    readonly observedDrawCount: number;
    readonly pixelHashSha256: string;
    readonly rounds: readonly RHIBenchmarkRoundResult[];
}

export interface RHIBenchmarkRawArtifact {
    /** Path relative to the summary JSON file. */
    readonly path: string;
    readonly byteLength: number;
    readonly sha256: string;
}

export interface RHIBenchmarkBaselineResult {
    readonly schemaVersion: 3;
    readonly suite: 'rhi';
    readonly architecture: 'rhi';
    readonly manifestSha256: string;
    readonly commitSha: string;
    readonly capturedAt: string;
    readonly environment: RHIBenchmarkEnvironment;
    readonly rawArtifact: RHIBenchmarkRawArtifact;
    readonly cases: readonly RHIBenchmarkCaseResult[];
}
