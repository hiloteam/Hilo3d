import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    RHI_BENCHMARK_ALLOCATION_METRICS,
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
    RHI_BENCHMARK_CACHE_HIT_METRICS,
    RHI_BENCHMARK_METRICS,
    rhiBenchmarkMetricScope,
    type RHIBenchmarkEnvironment,
    type RHIBenchmarkManifest,
    type RHIBenchmarkMetric,
    type RHIBenchmarkRawCaptureResult,
    type RHIBenchmarkRawMetricSamples
} from '../../benchmarks/rhi-v2/result-schema';
import { rhiBenchmarkPairedOrder } from '../../scripts/performance/rhi-benchmark-statistics';
import {
    summarizeRHIRawBenchmarkCapture,
    verifyRHIRawBenchmarkCapture
} from '../../scripts/performance/summarize-rhi-benchmark';
import {
    manifestSha256,
    parseRHIBenchmarkManifest,
    rhiBenchmarkEnvironmentFingerprint
} from '../../scripts/performance/verify-rhi-baseline';

const repositoryManifestValue = JSON.parse(
    readFileSync(new URL('../../benchmarks/rhi-v2/manifest.json', import.meta.url), 'utf8')
) as unknown;
const FRAME_SAMPLES = Array<number>(2000).fill(1);
const CACHE_SAMPLES = Array<number>(2000).fill(0.9);
const ALLOCATION_SAMPLES = Array<number>(RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES).fill(1);
const ROUND_SAMPLE = [1] as const;

function environment(manifest: RHIBenchmarkManifest): RHIBenchmarkEnvironment {
    const identity: RHIBenchmarkEnvironment = {
        rigProfile: manifest.rig.profile,
        runnerTags: manifest.rig.requiredRunnerTags,
        fingerprintSha256: '',
        osPlatform: manifest.rig.osPlatform,
        osRelease: '6.8.0-raw-contract',
        cpuModel: 'Raw contract CPU',
        gpuFingerprint: 'Raw contract GPU',
        gpuDriver: 'contract-driver',
        browserName: manifest.rig.browserName,
        browserVersion: '142.0.0.0',
        browserExecutableSha256: '7'.repeat(64),
        playwrightVersion: manifest.rig.playwrightVersion,
        nodeVersion: manifest.rig.nodeVersion,
        powerProfile: manifest.rig.powerProfile,
        fallbackAdapter: false,
        gpuTimerAvailable: true,
        allocationProfilerAvailable: true,
        preciseMemoryAvailable: true
    };
    return {
        ...identity,
        fingerprintSha256: rhiBenchmarkEnvironmentFingerprint(identity)
    };
}

function enrolledManifest(): RHIBenchmarkManifest {
    const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);
    return {
        ...manifest,
        rig: {
            ...manifest.rig,
            acceptedFingerprintSha256: [environment(manifest).fingerprintSha256]
        }
    };
}

function rawMetrics(drawCount: number): RHIBenchmarkRawMetricSamples {
    const drawSamples = Array<number>(2000).fill(drawCount);
    const metrics: Partial<Record<RHIBenchmarkMetric, readonly number[]>> = {};
    for (const metric of RHI_BENCHMARK_METRICS) {
        metrics[metric] =
            metric === 'actualDrawCount'
                ? drawSamples
                : (RHI_BENCHMARK_CACHE_HIT_METRICS as readonly string[]).includes(metric)
                  ? CACHE_SAMPLES
                  : (RHI_BENCHMARK_ALLOCATION_METRICS as readonly string[]).includes(metric)
                    ? ALLOCATION_SAMPLES
                    : rhiBenchmarkMetricScope(metric) === 'frame'
                      ? FRAME_SAMPLES
                      : ROUND_SAMPLE;
    }
    return metrics as RHIBenchmarkRawMetricSamples;
}

function rawCapture(manifest: RHIBenchmarkManifest): RHIBenchmarkRawCaptureResult {
    return {
        schemaVersion: 2,
        suite: 'rhi-v2',
        manifestSha256: manifestSha256(manifest),
        commitSha: 'a'.repeat(40),
        capturedAt: '2026-07-15T00:00:00.000Z',
        environment: environment(manifest),
        productionFixture: {
            path: 'test/performance/fixtures/rhi-v2-production.html',
            sha256: '8'.repeat(64)
        },
        cases: manifest.scenarios.flatMap(scenario =>
            manifest.backends.map(backend => {
                const metrics = rawMetrics(scenario.quality.drawCount);
                const pixelHashSha256 = backend === 'webgl2' ? '2'.repeat(64) : '3'.repeat(64);
                return {
                    scenarioId: scenario.id,
                    backend,
                    quality: scenario.quality,
                    rounds: Array.from({ length: manifest.sampling.rounds }, (_, index) => {
                        const round = index + 1;
                        return {
                            round,
                            order: rhiBenchmarkPairedOrder(
                                manifest.sampling.orderSeed,
                                scenario.id,
                                backend,
                                round
                            ),
                            results: {
                                legacy: {
                                    observedDrawCount: scenario.quality.drawCount,
                                    pixelHashSha256,
                                    metrics
                                },
                                'rhi-v2': {
                                    observedDrawCount: scenario.quality.drawCount,
                                    pixelHashSha256,
                                    metrics
                                }
                            }
                        };
                    })
                };
            })
        )
    };
}

function mutableRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('expected a mutable record');
    }
    return value as Record<string, unknown>;
}

function firstRawRound(raw: RHIBenchmarkRawCaptureResult): Record<string, unknown> {
    const firstCase = raw.cases[0];
    const firstRound = firstCase?.rounds[0];
    if (!firstRound) throw new Error('raw contract fixture is empty');
    return mutableRecord(firstRound);
}

describe('RHI raw paired-capture contract', () => {
    it('accepts every Section 11.3 metric for both architectures in all 20 cases and 7 rounds', () => {
        const manifest = enrolledManifest();
        const raw = rawCapture(manifest);
        expect(verifyRHIRawBenchmarkCapture(manifest, raw)).toBe(raw);
    });

    it('preserves separate main and allocation counts in the summarized result', () => {
        const manifest = enrolledManifest();
        const summary = summarizeRHIRawBenchmarkCapture(manifest, rawCapture(manifest), {
            rawArtifact: {
                path: 'legacy.raw.json.gz',
                byteLength: 1,
                sha256: 'f'.repeat(64)
            }
        });
        const metrics = summary.cases[0]?.rounds[0]?.metrics;
        expect(metrics?.gpuFrameMs.sampleCount).toBe(2000);
        expect(metrics?.rhiCommandCount.sampleCount).toBe(2000);
        expect(metrics?.allocationBytesPerFrame.sampleCount).toBe(21);
        expect(metrics?.rhiHotPathAllocationBytesPerFrame.sampleCount).toBe(21);
    });

    it('rejects a non-seeded A/B order before it can become baseline evidence', () => {
        const manifest = enrolledManifest();
        const raw = rawCapture(manifest);
        const firstRound = firstRawRound(raw);
        const order = firstRound['order'];
        if (!Array.isArray(order)) throw new Error('raw contract order is missing');
        const first: unknown = order[0];
        firstRound['order'] = first === 'legacy' ? ['rhi-v2', 'legacy'] : ['legacy', 'rhi-v2'];
        expect(() => verifyRHIRawBenchmarkCapture(manifest, raw)).toThrow(
            /deterministic seeded order/u
        );
    });

    it('rejects a round-scoped metric disguised as frame samples', () => {
        const manifest = enrolledManifest();
        const raw = rawCapture(manifest);
        const results = mutableRecord(firstRawRound(raw)['results']);
        const legacy = mutableRecord(results['legacy']);
        mutableRecord(legacy['metrics'])['retainedHeapBytes'] = [1, 1];
        expect(() => verifyRHIRawBenchmarkCapture(manifest, raw)).toThrow(
            /retainedHeapBytes must contain exactly 1 samples/u
        );
    });

    it('requires 21 allocation samples while retaining 2000 timing, GPU, and diagnostic samples', () => {
        const manifest = enrolledManifest();

        const wrongAllocation = rawCapture(manifest);
        const allocationResults = mutableRecord(firstRawRound(wrongAllocation)['results']);
        const allocationLegacy = mutableRecord(allocationResults['legacy']);
        mutableRecord(allocationLegacy['metrics'])['allocationBytesPerFrame'] =
            Array<number>(20).fill(1);
        expect(() => verifyRHIRawBenchmarkCapture(manifest, wrongAllocation)).toThrow(
            /allocationBytesPerFrame must contain exactly 21 samples/u
        );

        for (const metric of ['gpuFrameMs', 'rhiCommandCount'] as const) {
            const wrongMainSampling = rawCapture(manifest);
            const results = mutableRecord(firstRawRound(wrongMainSampling)['results']);
            const legacy = mutableRecord(results['legacy']);
            mutableRecord(legacy['metrics'])[metric] = Array<number>(21).fill(1);
            expect(() => verifyRHIRawBenchmarkCapture(manifest, wrongMainSampling), metric).toThrow(
                new RegExp(`${metric} must contain exactly 2000 samples`, 'u')
            );
        }
    });

    it('keeps strict parity by default but preserves shaped candidate failures for gate reports', () => {
        const manifest = enrolledManifest();
        const raw = rawCapture(manifest);
        const results = mutableRecord(firstRawRound(raw)['results']);
        const candidate = mutableRecord(results['rhi-v2']);
        const changedDrawCount = (candidate['observedDrawCount'] as number) + 1;
        candidate['observedDrawCount'] = changedDrawCount;
        candidate['pixelHashSha256'] = 'f'.repeat(64);
        candidate['metrics'] = {
            ...mutableRecord(candidate['metrics']),
            actualDrawCount: Array<number>(2000).fill(changedDrawCount)
        };

        expect(() => verifyRHIRawBenchmarkCapture(manifest, raw)).toThrow(
            /observedDrawCount differs from the manifest/u
        );
        expect(verifyRHIRawBenchmarkCapture(manifest, raw, { parityMode: 'candidate-gate' })).toBe(
            raw
        );

        candidate['pixelHashSha256'] = 'not-a-hash';
        expect(() =>
            verifyRHIRawBenchmarkCapture(manifest, raw, { parityMode: 'candidate-gate' })
        ).toThrow(/must be a SHA-256 digest/u);
    });
});
