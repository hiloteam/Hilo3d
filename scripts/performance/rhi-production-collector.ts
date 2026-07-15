import {
    RHI_BENCHMARK_ALLOCATION_PROFILER_PROTOCOL,
    RHI_BENCHMARK_DIAGNOSTIC_METRICS,
    RHI_BENCHMARK_FIXTURE_PROTOCOL_VERSION,
    RHI_BENCHMARK_NATIVE_CREATE_METRICS,
    RHI_BENCHMARK_TIMING_METRICS,
    type RHIBenchmarkFixtureFrameSample,
    type RHIBenchmarkFixtureMetadata,
    type RHIBenchmarkFixtureRoundResult
} from '../../benchmarks/rhi/fixture-contract';
import {
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
    type RendererArchitecture,
    type RHIBenchmarkBackend,
    type RHIBenchmarkManifest,
    type RHIBenchmarkRawArchitectureResult,
    type RHIBenchmarkRawCaptureResult,
    type RHIBenchmarkRawMetricSamples,
    type RHIBenchmarkScenarioManifest
} from '../../benchmarks/rhi/result-schema';
import type { RHIPhase0PreflightResult } from './rhi-phase0-preflight';
import { rhiBenchmarkPairedOrder } from './rhi-benchmark-statistics';
import { verifyRHIRawBenchmarkCapture } from './summarize-rhi-benchmark';
import { canonicalRHIJson, manifestSha256 } from './verify-rhi-baseline';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

export interface RHIBenchmarkAllocationSample {
    readonly rendererBytes: number;
    readonly rhiHotPathBytes: number;
}

export interface RHIProductionCollectorSession {
    readonly metadata: RHIBenchmarkFixtureMetadata;
    warmup(frameCount: number): Promise<void>;
    sampleTimingFrames(frameCount: number): Promise<readonly RHIBenchmarkFixtureFrameSample[]>;
    sampleGpuFrames(frameCount: number): Promise<readonly number[]>;
    sampleAllocationFrames(frameCount: number): Promise<readonly RHIBenchmarkAllocationSample[]>;
    finishRound(): Promise<RHIBenchmarkFixtureRoundResult>;
    close(): Promise<void>;
}

export interface RHIProductionCollectorSessionRequest {
    readonly scenario: RHIBenchmarkScenarioManifest;
    readonly backend: RHIBenchmarkBackend;
    readonly architecture: RendererArchitecture;
    readonly round: number;
    readonly orderPosition: number;
}

export interface RHIProductionCollectorSessionFactory {
    open(request: RHIProductionCollectorSessionRequest): Promise<RHIProductionCollectorSession>;
    close(): Promise<void>;
}

export interface RHIProductionCaptureOptions {
    readonly preflight: RHIPhase0PreflightResult;
    readonly commitSha: string;
    readonly capturedAt?: string;
    readonly sessions: RHIProductionCollectorSessionFactory;
    /** Test seam only. Production callers always use the complete raw-capture verifier. */
    readonly verify?: (
        manifest: RHIBenchmarkManifest,
        raw: RHIBenchmarkRawCaptureResult
    ) => RHIBenchmarkRawCaptureResult;
}

function collectionFailure(message: string): never {
    throw new Error(`RHI production benchmark collection failed: ${message}`);
}

function finiteNonNegative(value: unknown, context: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        collectionFailure(`${context} must be finite and non-negative`);
    }
    return value;
}

function nonNegativeInteger(value: unknown, context: string): number {
    const parsed = finiteNonNegative(value, context);
    if (!Number.isSafeInteger(parsed)) collectionFailure(`${context} must be a safe integer`);
    return parsed;
}

function requireLength(value: readonly unknown[], expected: number, context: string): void {
    if (value.length !== expected) {
        collectionFailure(`${context} must contain exactly ${String(expected)} samples`);
    }
}

function assertMetadata(
    metadata: RHIBenchmarkFixtureMetadata,
    request: RHIProductionCollectorSessionRequest,
    isolationIds: Set<string>
): void {
    if (metadata.protocolVersion !== RHI_BENCHMARK_FIXTURE_PROTOCOL_VERSION) {
        collectionFailure('fixture protocol version mismatch');
    }
    if (metadata.architecture !== request.architecture || metadata.backend !== request.backend) {
        collectionFailure('fixture architecture/backend differs from its isolated page request');
    }
    if (metadata.scenarioId !== request.scenario.id) {
        collectionFailure('fixture scenario differs from its isolated page request');
    }
    if (canonicalRHIJson(metadata.quality) !== canonicalRHIJson(request.scenario.quality)) {
        collectionFailure(`${request.scenario.id} fixture quality differs from the manifest`);
    }
    if (!metadata.isolationId || isolationIds.has(metadata.isolationId)) {
        collectionFailure('every architecture/round must use a fresh isolated fixture page');
    }
    isolationIds.add(metadata.isolationId);
    const capabilities = metadata.capabilities;
    if (capabilities.cpuSegments !== 'instrumented-production-method-boundaries-v1') {
        collectionFailure('CPU segment instrumentation is unavailable');
    }
    if (capabilities.highResolutionClock !== 'cross-origin-isolated-performance-now-v1') {
        collectionFailure('cross-origin-isolated high-resolution CPU timing is unavailable');
    }
    const expectedGpuTimer =
        request.backend === 'webgl2' ? 'ext-disjoint-timer-query-webgl2' : 'webgpu-timestamp-query';
    if (capabilities.gpuTimer !== expectedGpuTimer) {
        collectionFailure(`${request.backend} GPU timestamp queries are unavailable`);
    }
    if (capabilities.allocationProfiler !== RHI_BENCHMARK_ALLOCATION_PROFILER_PROTOCOL) {
        collectionFailure('one-byte allocation profiling is unavailable');
    }
    if (capabilities.preciseMemory !== 'chromium-precise-memory-v1') {
        collectionFailure('precise heap measurement is unavailable');
    }
    if (capabilities.nativeCounters !== 'renderer-diagnostics-v1') {
        collectionFailure('renderer native-object diagnostics are unavailable');
    }
}

function parseTimingFrames(
    frames: readonly RHIBenchmarkFixtureFrameSample[],
    expectedCount: number,
    expectedDrawCount: number,
    context: string
): {
    readonly timing: Record<(typeof RHI_BENCHMARK_TIMING_METRICS)[number], number[]>;
    readonly diagnostics: Record<(typeof RHI_BENCHMARK_DIAGNOSTIC_METRICS)[number], number[]>;
} {
    requireLength(frames, expectedCount, `${context}.timingFrames`);
    const timing = Object.fromEntries(
        RHI_BENCHMARK_TIMING_METRICS.map(metric => [metric, new Array<number>(expectedCount)])
    ) as Record<(typeof RHI_BENCHMARK_TIMING_METRICS)[number], number[]>;
    const diagnostics = Object.fromEntries(
        RHI_BENCHMARK_DIAGNOSTIC_METRICS.map(metric => [metric, new Array<number>(expectedCount)])
    ) as Record<(typeof RHI_BENCHMARK_DIAGNOSTIC_METRICS)[number], number[]>;
    for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const frame = frames[frameIndex];
        if (!frame) collectionFailure(`${context}.timingFrames lost frame ${String(frameIndex)}`);
        for (const metric of RHI_BENCHMARK_TIMING_METRICS) {
            timing[metric][frameIndex] = finiteNonNegative(
                frame.timing[metric],
                `${context}.timingFrames[${String(frameIndex)}].${metric}`
            );
        }
        const rhiTotal = frame.timing.rhiCommandCpuMs + frame.timing.rhiExecuteCpuMs;
        if (Math.abs(rhiTotal - frame.timing.rhiTotalCpuMs) > 1e-6) {
            collectionFailure(`${context} rhiTotalCpuMs is not command plus execute CPU time`);
        }
        for (const metric of RHI_BENCHMARK_DIAGNOSTIC_METRICS) {
            const value = frame.diagnostics[metric];
            if (value === null) collectionFailure(`${context}.${metric} is not measurable`);
            const parsed = finiteNonNegative(
                value,
                `${context}.timingFrames[${String(frameIndex)}].${metric}`
            );
            if (metric.endsWith('CacheHitRate')) {
                if (parsed > 1) collectionFailure(`${context}.${metric} exceeds one`);
            } else if (!Number.isSafeInteger(parsed)) {
                collectionFailure(`${context}.${metric} must be an exact counter`);
            }
            diagnostics[metric][frameIndex] = parsed;
        }
        if (frame.diagnostics.actualDrawCount !== expectedDrawCount) {
            collectionFailure(
                `${context} actual draw count ${String(frame.diagnostics.actualDrawCount)} differs from manifest ${String(expectedDrawCount)}`
            );
        }
        finiteNonNegative(
            frame.heapUsedBytes,
            `${context}.timingFrames[${String(frameIndex)}].heapUsedBytes`
        );
    }
    return { timing, diagnostics };
}

export function assembleRHIArchitectureMetrics(
    timingFrames: readonly RHIBenchmarkFixtureFrameSample[],
    gpuSamples: readonly number[],
    allocationSamples: readonly RHIBenchmarkAllocationSample[],
    round: RHIBenchmarkFixtureRoundResult,
    expectedFrameSampleCount: number,
    expectedAllocationSampleCount: number,
    expectedDrawCount: number,
    context = 'architecture result'
): RHIBenchmarkRawMetricSamples {
    if (expectedAllocationSampleCount !== RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES) {
        collectionFailure(
            `allocation sample count must remain frozen at ${String(RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES)}`
        );
    }
    const parsed = parseTimingFrames(
        timingFrames,
        expectedFrameSampleCount,
        expectedDrawCount,
        context
    );
    requireLength(gpuSamples, expectedFrameSampleCount, `${context}.gpuSamples`);
    requireLength(allocationSamples, expectedAllocationSampleCount, `${context}.allocationSamples`);
    const gpuFrameMs = gpuSamples.map((value, index) =>
        finiteNonNegative(value, `${context}.gpuSamples[${String(index)}]`)
    );
    const allocationBytesPerFrame = new Array<number>(expectedAllocationSampleCount);
    const rhiHotPathAllocationBytesPerFrame = new Array<number>(expectedAllocationSampleCount);
    for (let index = 0; index < allocationSamples.length; index += 1) {
        const sample = allocationSamples[index];
        if (!sample) collectionFailure(`${context}.allocationSamples lost sample ${String(index)}`);
        allocationBytesPerFrame[index] = nonNegativeInteger(
            sample.rendererBytes,
            `${context}.allocationSamples[${String(index)}].rendererBytes`
        );
        rhiHotPathAllocationBytesPerFrame[index] = nonNegativeInteger(
            sample.rhiHotPathBytes,
            `${context}.allocationSamples[${String(index)}].rhiHotPathBytes`
        );
    }
    const native = round.nativeCreateCounts;
    for (const metric of RHI_BENCHMARK_NATIVE_CREATE_METRICS) {
        if (native[metric] === null) collectionFailure(`${context}.${metric} is not measurable`);
        nonNegativeInteger(native[metric], `${context}.${metric}`);
    }
    if (!SHA256_PATTERN.test(round.pixelHashSha256)) {
        collectionFailure(`${context}.pixelHashSha256 must be a lowercase SHA-256 digest`);
    }
    return {
        ...parsed.timing,
        gpuFrameMs,
        allocationBytesPerFrame,
        rhiHotPathAllocationBytesPerFrame,
        ...parsed.diagnostics,
        heapHighWaterBytes: [
            nonNegativeInteger(round.heapHighWaterBytes, `${context}.heapHighWaterBytes`)
        ],
        retainedHeapBytes: [
            nonNegativeInteger(round.retainedHeapBytes, `${context}.retainedHeapBytes`)
        ],
        nativeBufferCreateCount: [
            nonNegativeInteger(native.nativeBufferCreateCount, `${context}.nativeBufferCreateCount`)
        ],
        nativeTextureCreateCount: [
            nonNegativeInteger(
                native.nativeTextureCreateCount,
                `${context}.nativeTextureCreateCount`
            )
        ],
        nativePipelineCreateCount: [
            nonNegativeInteger(
                native.nativePipelineCreateCount,
                `${context}.nativePipelineCreateCount`
            )
        ],
        nativeBindGroupCreateCount: [
            nonNegativeInteger(
                native.nativeBindGroupCreateCount,
                `${context}.nativeBindGroupCreateCount`
            )
        ],
        nativeVaoCreateCount: [
            nonNegativeInteger(native.nativeVaoCreateCount, `${context}.nativeVaoCreateCount`)
        ],
        nativeProgramCreateCount: [
            nonNegativeInteger(
                native.nativeProgramCreateCount,
                `${context}.nativeProgramCreateCount`
            )
        ],
        firstComplexFrameCpuMs: [
            finiteNonNegative(round.firstComplexFrameCpuMs, `${context}.firstComplexFrameCpuMs`)
        ],
        shaderFirstPrepareMs: [
            finiteNonNegative(round.shaderFirstPrepareMs, `${context}.shaderFirstPrepareMs`)
        ],
        pipelineFirstPrepareMs: [
            finiteNonNegative(round.pipelineFirstPrepareMs, `${context}.pipelineFirstPrepareMs`)
        ]
    };
}

async function collectArchitecture(
    manifest: RHIBenchmarkManifest,
    sessions: RHIProductionCollectorSessionFactory,
    request: RHIProductionCollectorSessionRequest,
    isolationIds: Set<string>
): Promise<RHIBenchmarkRawArchitectureResult> {
    const session = await sessions.open(request);
    try {
        assertMetadata(session.metadata, request, isolationIds);
        await session.warmup(manifest.sampling.warmupFrames);
        // Profilers run in separate passes so GPU queries and heap sampling cannot perturb the
        // wall-clock timing distribution they are meant to accompany.
        const timingFrames = await session.sampleTimingFrames(manifest.sampling.sampleFrames);
        const gpuSamples = await session.sampleGpuFrames(manifest.sampling.sampleFrames);
        const allocationSamples = await session.sampleAllocationFrames(
            manifest.sampling.allocationSampleFrames
        );
        const round = await session.finishRound();
        return {
            observedDrawCount: request.scenario.quality.drawCount,
            pixelHashSha256: round.pixelHashSha256,
            metrics: assembleRHIArchitectureMetrics(
                timingFrames,
                gpuSamples,
                allocationSamples,
                round,
                manifest.sampling.sampleFrames,
                manifest.sampling.allocationSampleFrames,
                request.scenario.quality.drawCount,
                `${request.scenario.id}/${request.backend}/round-${String(request.round)}/${request.architecture}`
            )
        };
    } finally {
        await session.close();
    }
}

/** Collect the complete 10-scenario, two-backend, seven-round paired A/B matrix. */
export async function collectRHIProductionCapture(
    options: RHIProductionCaptureOptions
): Promise<RHIBenchmarkRawCaptureResult> {
    if (!COMMIT_SHA_PATTERN.test(options.commitSha)) {
        collectionFailure('commitSha must be a full lowercase Git commit SHA');
    }
    const capturedAt = options.capturedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(capturedAt))) collectionFailure('capturedAt must be ISO-8601');
    const manifest = options.preflight.manifest;
    const isolationIds = new Set<string>();
    const cases: RHIBenchmarkRawCaptureResult['cases'][number][] = [];
    try {
        for (const scenario of manifest.scenarios) {
            for (const backend of manifest.backends) {
                const rounds: RHIBenchmarkRawCaptureResult['cases'][number]['rounds'][number][] =
                    [];
                for (let round = 1; round <= manifest.sampling.rounds; round += 1) {
                    const order = rhiBenchmarkPairedOrder(
                        manifest.sampling.orderSeed,
                        scenario.id,
                        backend,
                        round
                    );
                    const results = {} as Record<
                        RendererArchitecture,
                        RHIBenchmarkRawArchitectureResult
                    >;
                    for (let orderPosition = 0; orderPosition < order.length; orderPosition += 1) {
                        const architecture = order[orderPosition];
                        if (!architecture) collectionFailure('seeded A/B order is incomplete');
                        results[architecture] = await collectArchitecture(
                            manifest,
                            options.sessions,
                            { scenario, backend, architecture, round, orderPosition },
                            isolationIds
                        );
                    }
                    if (results.legacy.pixelHashSha256 !== results['rhi'].pixelHashSha256) {
                        collectionFailure(
                            `${scenario.id}/${backend}/round-${String(round)} pixel hashes differ between architectures`
                        );
                    }
                    rounds.push({ round, order, results });
                }
                cases.push({ scenarioId: scenario.id, backend, quality: scenario.quality, rounds });
            }
        }
    } finally {
        await options.sessions.close();
    }
    const raw: RHIBenchmarkRawCaptureResult = {
        schemaVersion: 2,
        suite: 'rhi',
        manifestSha256: manifestSha256(manifest),
        commitSha: options.commitSha,
        capturedAt,
        environment: options.preflight.environment,
        productionFixture: {
            path: options.preflight.productionFixtureRelativePath,
            sha256: options.preflight.productionFixtureSha256
        },
        cases
    };
    return (options.verify ?? verifyRHIRawBenchmarkCapture)(manifest, raw);
}
