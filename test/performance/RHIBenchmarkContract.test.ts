import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
    RHI_BENCHMARK_CACHE_HIT_METRICS,
    RHI_BENCHMARK_METRICS,
    rhiBenchmarkMetricSampleCount,
    type RHIBenchmarkBackend,
    type RHIBenchmarkBaselineResult,
    type RHIBenchmarkDistribution,
    type RHIBenchmarkEnvironment,
    type RHIBenchmarkManifest,
    type RHIBenchmarkRoundMetrics
} from '../../benchmarks/rhi/result-schema';
import { deriveRHIBenchmarkBootstrapSeed } from '../../scripts/performance/rhi-benchmark-statistics';
import {
    manifestSha256,
    parseRHIBenchmarkManifest,
    rhiBenchmarkEnvironmentFingerprint,
    sha256,
    verifyRHIBaseline
} from '../../scripts/performance/verify-rhi-baseline';

const RAW_BYTES = new TextEncoder().encode('{"raw":"samples"}\n');
const repositoryManifestValue = JSON.parse(
    readFileSync(new URL('../../benchmarks/rhi/manifest.json', import.meta.url), 'utf8')
) as unknown;

function enrolledManifest(): RHIBenchmarkManifest {
    const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);
    return {
        ...manifest,
        rig: {
            ...manifest.rig,
            acceptedFingerprintSha256: [benchmarkEnvironment(manifest).fingerprintSha256]
        }
    };
}

function benchmarkEnvironment(manifest: RHIBenchmarkManifest): RHIBenchmarkEnvironment {
    const identity: RHIBenchmarkEnvironment = {
        rigProfile: manifest.rig.profile,
        runnerTags: manifest.rig.requiredRunnerTags,
        fingerprintSha256: '',
        osPlatform: manifest.rig.osPlatform,
        osRelease: '25.2.0-contract',
        cpuModel: 'Fixed benchmark CPU',
        gpuFingerprint: 'Fixed benchmark GPU',
        gpuDriver: '1.2.3',
        browserName: manifest.rig.browserName,
        browserVersion: '142.0.0.0',
        browserExecutableSha256: '5'.repeat(64),
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

function distribution(
    sampleCount: number,
    bootstrapSeed: number,
    value = 1.4
): RHIBenchmarkDistribution {
    return {
        sampleCount,
        minimum: value,
        maximum: value,
        median: value,
        p50: value,
        p95: value,
        p99: value,
        mad: 0,
        coefficientOfVariation: 0,
        confidenceInterval: {
            low: value,
            high: value,
            confidenceLevel: 0.95,
            bootstrapIterations: 10_000,
            bootstrapSeed
        }
    };
}

function metrics(
    manifest: RHIBenchmarkManifest,
    scenarioId: string,
    backend: RHIBenchmarkBackend,
    round: number,
    drawCount: number
): RHIBenchmarkRoundMetrics {
    return Object.fromEntries(
        RHI_BENCHMARK_METRICS.map(metric => {
            const value =
                metric === 'actualDrawCount'
                    ? drawCount
                    : (RHI_BENCHMARK_CACHE_HIT_METRICS as readonly string[]).includes(metric)
                      ? 0.8
                      : 1.4;
            return [
                metric,
                distribution(
                    rhiBenchmarkMetricSampleCount(metric, manifest.sampling),
                    deriveRHIBenchmarkBootstrapSeed(
                        manifest.sampling.bootstrapSeed,
                        scenarioId,
                        backend,
                        round,
                        'rhi',
                        metric
                    ),
                    value
                )
            ];
        })
    ) as RHIBenchmarkRoundMetrics;
}

function validBaseline(manifest: RHIBenchmarkManifest): RHIBenchmarkBaselineResult {
    return {
        schemaVersion: 4,
        suite: 'rhi',
        architecture: 'rhi',
        manifestSha256: manifestSha256(manifest),
        commitSha: 'a'.repeat(40),
        capturedAt: '2026-07-14T12:00:00.000Z',
        environment: benchmarkEnvironment(manifest),
        rawArtifact: {
            path: 'current.raw.json.gz',
            byteLength: RAW_BYTES.byteLength,
            sha256: sha256(RAW_BYTES)
        },
        cases: manifest.scenarios.flatMap(scenario =>
            manifest.backends.map(backend => ({
                scenarioId: scenario.id,
                backend,
                quality: scenario.quality,
                observedDrawCount: scenario.quality.drawCount,
                pixelHashSha256: backend === 'webgl2' ? '2'.repeat(64) : '3'.repeat(64),
                rounds: Array.from({ length: manifest.sampling.rounds }, (_, index) => {
                    const round = index + 1;
                    return {
                        round,
                        sampleCount: manifest.sampling.sampleFrames,
                        orderPosition: 0,
                        metrics: metrics(
                            manifest,
                            scenario.id,
                            backend,
                            round,
                            scenario.quality.drawCount
                        )
                    };
                })
            }))
        )
    };
}

function mutableRecord(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('Expected a mutable object fixture');
    }
    return value as Record<string, unknown>;
}

function mutableArray(value: unknown): unknown[] {
    if (!Array.isArray(value)) throw new TypeError('Expected a mutable array fixture');
    return value;
}

function clonedBaseline(manifest: RHIBenchmarkManifest): Record<string, unknown> {
    return mutableRecord(structuredClone(validBaseline(manifest)));
}

function firstCase(baseline: Record<string, unknown>): Record<string, unknown> {
    const value = mutableArray(baseline['cases'])[0];
    if (!value) throw new Error('The fixture must contain a benchmark case');
    return mutableRecord(value);
}

function firstRound(baseline: Record<string, unknown>): Record<string, unknown> {
    const value = mutableArray(firstCase(baseline)['rounds'])[0];
    if (!value) throw new Error('The fixture must contain a benchmark round');
    return mutableRecord(value);
}

describe('RHI benchmark baseline contract', () => {
    it('freezes ten scenarios, both backends, sampling, seeds, quality, and rig requirements', () => {
        const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);

        expect(manifest.scenarios).toHaveLength(10);
        expect(RHI_BENCHMARK_METRICS).toHaveLength(27);
        expect(manifest.backends).toEqual(['webgl2', 'webgpu']);
        expect(manifest.sampling).toMatchObject({
            warmupFrames: 300,
            sampleFrames: 2000,
            allocationSampleFrames: RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
            rounds: 7,
            bootstrapIterations: 10_000,
            confidenceLevel: 0.95
        });
        expect(manifest.sampling.bootstrapSeed).toBeGreaterThan(0);
        expect(manifest.rig.requiredRunnerTags).toEqual([
            'self-hosted',
            'macos',
            'gpu',
            'rhi-perf'
        ]);
        expect(manifest.rig.acceptedFingerprintSha256).toEqual([
            'aa4984f770c4e8a3ce4a22ffe65ad529308d5e5461ec8dae7aaf339b4c96d84d'
        ]);
        expect(manifest.scenarios.every(scenario => scenario.quality.devicePixelRatio === 1)).toBe(
            true
        );
        expect(
            manifest.scenarios.find(scenario => scenario.id === 'scene-churn-10000-frame')?.quality
                .churnFrames
        ).toBe(10_000);
    });

    it('accepts a complete, checksummed baseline from an enrolled physical rig', () => {
        const manifest = enrolledManifest();
        const baseline = validBaseline(manifest);

        expect(verifyRHIBaseline(manifest, baseline, RAW_BYTES)).toEqual(baseline);
    });

    it('rejects a manifest with fewer scenarios, fewer backends, or weakened sampling', () => {
        const missingScenario = mutableRecord(structuredClone(repositoryManifestValue));
        mutableArray(missingScenario['scenarios']).pop();
        expect(() => parseRHIBenchmarkManifest(missingScenario)).toThrow(
            /10 required scenarios exactly once/u
        );

        const missingBackend = mutableRecord(structuredClone(repositoryManifestValue));
        missingBackend['backends'] = ['webgl2'];
        expect(() => parseRHIBenchmarkManifest(missingBackend)).toThrow(/exactly webgl2, webgpu/u);

        const weakenedSampling = mutableRecord(structuredClone(repositoryManifestValue));
        mutableRecord(weakenedSampling['sampling'])['rounds'] = 6;
        expect(() => parseRHIBenchmarkManifest(weakenedSampling)).toThrow(
            /rounds must remain frozen at 7/u
        );

        const weakenedAllocationSampling = mutableRecord(structuredClone(repositoryManifestValue));
        mutableRecord(weakenedAllocationSampling['sampling'])['allocationSampleFrames'] = 20;
        expect(() => parseRHIBenchmarkManifest(weakenedAllocationSampling)).toThrow(
            /allocationSampleFrames must remain frozen at 21/u
        );

        const weakenedRig = mutableRecord(structuredClone(repositoryManifestValue));
        mutableRecord(weakenedRig['rig'])['requireGpuTimer'] = false;
        expect(() => parseRHIBenchmarkManifest(weakenedRig)).toThrow(
            /capability requirements must not be weakened/u
        );
    });

    it('rejects an unenrolled or mismatched physical rig fingerprint', () => {
        const repositoryManifest = parseRHIBenchmarkManifest(repositoryManifestValue);
        const unenrolledManifest = {
            ...repositoryManifest,
            rig: { ...repositoryManifest.rig, acceptedFingerprintSha256: [] }
        };
        expect(() =>
            verifyRHIBaseline(unenrolledManifest, validBaseline(unenrolledManifest), RAW_BYTES)
        ).toThrow(/no enrolled physical-rig fingerprint/u);

        const manifest = enrolledManifest();
        const baseline = clonedBaseline(manifest);
        mutableRecord(baseline['environment'])['fingerprintSha256'] = '4'.repeat(64);
        expect(() => verifyRHIBaseline(manifest, baseline, RAW_BYTES)).toThrow(
            /fingerprint is not enrolled/u
        );

        const forgedIdentity = clonedBaseline(manifest);
        mutableRecord(forgedIdentity['environment'])['gpuDriver'] = 'unreviewed-driver';
        expect(() => verifyRHIBaseline(manifest, forgedIdentity, RAW_BYTES)).toThrow(
            /fingerprint does not match/u
        );
    });

    it('rejects missing scenarios, backends, rounds, or samples', () => {
        const manifest = enrolledManifest();

        const missingCase = clonedBaseline(manifest);
        mutableArray(missingCase['cases']).pop();
        expect(() => verifyRHIBaseline(manifest, missingCase, RAW_BYTES)).toThrow(
            /exactly 20 scenario\/backend cases/u
        );

        const missingRound = clonedBaseline(manifest);
        mutableArray(firstCase(missingRound)['rounds']).pop();
        expect(() => verifyRHIBaseline(manifest, missingRound, RAW_BYTES)).toThrow(
            /exactly 7 rounds/u
        );

        const wrongSamples = clonedBaseline(manifest);
        firstRound(wrongSamples)['sampleCount'] = 1999;
        expect(() => verifyRHIBaseline(manifest, wrongSamples, RAW_BYTES)).toThrow(
            /sampleCount differs/u
        );

        const wrongAllocationSamples = clonedBaseline(manifest);
        const allocationDistribution = mutableRecord(
            mutableRecord(firstRound(wrongAllocationSamples)['metrics'])['allocationBytesPerFrame']
        );
        allocationDistribution['sampleCount'] = manifest.sampling.sampleFrames;
        expect(() => verifyRHIBaseline(manifest, wrongAllocationSamples, RAW_BYTES)).toThrow(
            /allocationBytesPerFrame must summarize exactly 21 samples/u
        );

        const wrongOrder = clonedBaseline(manifest);
        const round = firstRound(wrongOrder);
        round['orderPosition'] = round['orderPosition'] === 0 ? 1 : 0;
        expect(() => verifyRHIBaseline(manifest, wrongOrder, RAW_BYTES)).toThrow(
            /orderPosition must equal 0/u
        );
    });

    it('rejects every missing CPU, GPU, allocation, heap, native, command, cache, or prepare metric', () => {
        const manifest = enrolledManifest();
        for (const metric of RHI_BENCHMARK_METRICS) {
            const baseline = clonedBaseline(manifest);
            const roundMetrics = mutableRecord(firstRound(baseline)['metrics']);
            Reflect.deleteProperty(roundMetrics, metric);
            expect(
                () => verifyRHIBaseline(manifest, baseline, RAW_BYTES),
                `missing ${metric}`
            ).toThrow(/keys must be exactly/u);
        }
    });

    it('rejects unavailable GPU timing, allocation profiling, or precise memory collection', () => {
        const manifest = enrolledManifest();
        const capabilityErrors = [
            ['gpuTimerAvailable', /GPU timer metric is unavailable/u],
            ['allocationProfilerAvailable', /allocation profiler metric is unavailable/u],
            ['preciseMemoryAvailable', /retained-heap metric is unavailable/u]
        ] as const;
        for (const [capability, error] of capabilityErrors) {
            const baseline = clonedBaseline(manifest);
            mutableRecord(baseline['environment'])[capability] = false;
            expect(() => verifyRHIBaseline(manifest, baseline, RAW_BYTES)).toThrow(error);
        }
    });

    it('rejects backend quality or draw-count changes', () => {
        const manifest = enrolledManifest();

        const changedQuality = clonedBaseline(manifest);
        mutableRecord(firstCase(changedQuality)['quality'])['textureCount'] = 999;
        expect(() => verifyRHIBaseline(manifest, changedQuality, RAW_BYTES)).toThrow(
            /quality differs from the fixed manifest/u
        );

        const changedDrawCount = clonedBaseline(manifest);
        firstCase(changedDrawCount)['observedDrawCount'] = 999;
        expect(() => verifyRHIBaseline(manifest, changedDrawCount, RAW_BYTES)).toThrow(
            /observedDrawCount differs/u
        );
    });

    it('rejects missing variance, confidence interval, or inconsistent statistics', () => {
        const manifest = enrolledManifest();

        const missingVariance = clonedBaseline(manifest);
        const cpu = mutableRecord(
            mutableRecord(firstRound(missingVariance)['metrics'])['rendererCpuMs']
        );
        delete cpu['mad'];
        expect(() => verifyRHIBaseline(manifest, missingVariance, RAW_BYTES)).toThrow(
            /keys must be exactly/u
        );

        const missingInterval = clonedBaseline(manifest);
        delete mutableRecord(mutableRecord(firstRound(missingInterval)['metrics'])['gpuFrameMs'])[
            'confidenceInterval'
        ];
        expect(() => verifyRHIBaseline(manifest, missingInterval, RAW_BYTES)).toThrow(
            /keys must be exactly/u
        );

        const invalidPercentiles = clonedBaseline(manifest);
        mutableRecord(
            mutableRecord(firstRound(invalidPercentiles)['metrics'])['retainedHeapBytes']
        )['p95'] = 1;
        expect(() => verifyRHIBaseline(manifest, invalidPercentiles, RAW_BYTES)).toThrow(
            /percentiles are inconsistent/u
        );

        const invalidSeed = clonedBaseline(manifest);
        mutableRecord(
            mutableRecord(mutableRecord(firstRound(invalidSeed)['metrics'])['frameBuildCpuMs'])[
                'confidenceInterval'
            ]
        )['bootstrapSeed'] = 1;
        expect(() => verifyRHIBaseline(manifest, invalidSeed, RAW_BYTES)).toThrow(
            /bootstrap seed differs/u
        );
    });

    it('rejects raw artifact or manifest checksum mismatches', () => {
        const manifest = enrolledManifest();

        expect(() =>
            verifyRHIBaseline(
                manifest,
                validBaseline(manifest),
                new Uint8Array(RAW_BYTES.byteLength)
            )
        ).toThrow(/raw artifact checksum/u);

        const wrongManifest = clonedBaseline(manifest);
        wrongManifest['manifestSha256'] = '9'.repeat(64);
        expect(() => verifyRHIBaseline(manifest, wrongManifest, RAW_BYTES)).toThrow(
            /manifest checksum/u
        );
    });
});
