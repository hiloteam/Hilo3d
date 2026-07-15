import { gzipSync } from 'node:zlib';
import {
    access,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    symlink,
    unlink,
    writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    RHI_BENCHMARK_CACHE_HIT_METRICS,
    RHI_BENCHMARK_HARD_CAPS,
    RHI_BENCHMARK_METRICS,
    RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES,
    rhiBenchmarkMetricScope,
    type RHIBenchmarkBaselineResult,
    type RHIBenchmarkDistribution,
    type RHIBenchmarkEnvironment,
    type RHIBenchmarkManifest,
    type RHIBenchmarkMetric,
    type RHIBenchmarkRawCaptureResult,
    type RHIBenchmarkRawMetricSamples,
    type RHIBenchmarkRoundMetrics,
    type RendererArchitecture
} from '../../benchmarks/rhi/result-schema';
import {
    buildRHICandidateGateResult,
    evaluateRHICandidateEvidence,
    resolveRHICandidateBaselinePaths,
    resolveRHICandidateOutputPaths,
    runRHICandidateGate,
    writeRHICandidateGateArtifacts
} from '../../scripts/performance/evaluate-rhi-candidate';
import { renderRHICandidateGateReport } from '../../scripts/performance/render-rhi-candidate-report';
import { rhiBenchmarkPairedOrder } from '../../scripts/performance/rhi-benchmark-statistics';
import type { RHIPhase0PreflightResult } from '../../scripts/performance/rhi-phase0-preflight';
import { summarizeRHIRawBenchmarkCapture } from '../../scripts/performance/summarize-rhi-benchmark';
import {
    manifestSha256,
    parseRHIBenchmarkManifest,
    rhiBenchmarkEnvironmentFingerprint,
    sha256
} from '../../scripts/performance/verify-rhi-baseline';

const repositoryManifestValue = JSON.parse(
    readFileSync(new URL('../../benchmarks/rhi/manifest.json', import.meta.url), 'utf8')
) as unknown;

function testManifest(): RHIBenchmarkManifest {
    const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);
    return {
        ...manifest,
        sampling: {
            ...manifest.sampling,
            bootstrapIterations: 128,
            confidenceLevel: 0.9
        }
    };
}

function environment(manifest: RHIBenchmarkManifest): RHIBenchmarkEnvironment {
    const identity: RHIBenchmarkEnvironment = {
        rigProfile: manifest.rig.profile,
        runnerTags: manifest.rig.requiredRunnerTags,
        fingerprintSha256: '',
        osPlatform: manifest.rig.osPlatform,
        osRelease: 'contract-os',
        cpuModel: 'Contract CPU',
        gpuFingerprint: 'Contract GPU',
        gpuDriver: 'contract-driver',
        browserName: manifest.rig.browserName,
        browserVersion: 'contract-browser',
        browserExecutableSha256: '2'.repeat(64),
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

function metricValue(metric: RHIBenchmarkMetric, drawCount: number): number {
    if (metric === 'actualDrawCount') return drawCount;
    if (metric === 'rhiHotPathAllocationBytesPerFrame') return 0;
    if ((RHI_BENCHMARK_CACHE_HIT_METRICS as readonly string[]).includes(metric)) return 0.9;
    return 100;
}

function rawMetrics(drawCount: number): RHIBenchmarkRawMetricSamples {
    return Object.fromEntries(
        RHI_BENCHMARK_METRICS.map(metric => [metric, [metricValue(metric, drawCount)]])
    ) as unknown as RHIBenchmarkRawMetricSamples;
}

function distribution(value: number, manifest: RHIBenchmarkManifest): RHIBenchmarkDistribution {
    return {
        sampleCount: 1,
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
            confidenceLevel: manifest.sampling.confidenceLevel,
            bootstrapIterations: manifest.sampling.bootstrapIterations,
            bootstrapSeed: 1
        }
    };
}

function frozenRoundMetrics(
    manifest: RHIBenchmarkManifest,
    drawCount: number
): RHIBenchmarkRoundMetrics {
    return Object.fromEntries(
        RHI_BENCHMARK_METRICS.map(metric => [
            metric,
            distribution(metricValue(metric, drawCount), manifest)
        ])
    ) as unknown as RHIBenchmarkRoundMetrics;
}

function frozenSummary(manifest: RHIBenchmarkManifest): RHIBenchmarkBaselineResult {
    return {
        schemaVersion: 2,
        suite: 'rhi',
        architecture: 'legacy',
        manifestSha256: '3'.repeat(64),
        commitSha: 'a'.repeat(40),
        capturedAt: '2026-07-14T12:00:00.000Z',
        environment: environment(manifest),
        rawArtifact: {
            path: 'legacy.raw.json.gz',
            byteLength: 11,
            sha256: '7'.repeat(64)
        },
        cases: manifest.scenarios.flatMap(scenario =>
            manifest.backends.map(backend => ({
                scenarioId: scenario.id,
                backend,
                quality: scenario.quality,
                observedDrawCount: scenario.quality.drawCount,
                pixelHashSha256: backend === 'webgl2' ? '5'.repeat(64) : '6'.repeat(64),
                rounds: Array.from({ length: manifest.sampling.rounds }, (_, index) => ({
                    round: index + 1,
                    sampleCount: manifest.sampling.sampleFrames,
                    orderPosition: 0,
                    metrics: frozenRoundMetrics(manifest, scenario.quality.drawCount)
                }))
            }))
        )
    };
}

function pairedRaw(manifest: RHIBenchmarkManifest): RHIBenchmarkRawCaptureResult {
    return {
        schemaVersion: 2,
        suite: 'rhi',
        manifestSha256: '3'.repeat(64),
        commitSha: 'b'.repeat(40),
        capturedAt: '2026-07-15T12:00:00.000Z',
        environment: environment(manifest),
        productionFixture: {
            path: 'test/performance/fixtures/rhi-production.html',
            sha256: '4'.repeat(64)
        },
        cases: manifest.scenarios.flatMap(scenario =>
            manifest.backends.map(backend => ({
                scenarioId: scenario.id,
                backend,
                quality: scenario.quality,
                rounds: Array.from({ length: manifest.sampling.rounds }, (_, index) => {
                    const round = index + 1;
                    const pixelHashSha256 = backend === 'webgl2' ? '5'.repeat(64) : '6'.repeat(64);
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
                                metrics: rawMetrics(scenario.quality.drawCount)
                            },
                            rhi: {
                                observedDrawCount: scenario.quality.drawCount,
                                pixelHashSha256,
                                metrics: rawMetrics(scenario.quality.drawCount)
                            }
                        }
                    };
                })
            }))
        )
    };
}

function build(
    raw = pairedRaw(testManifest()),
    manifest = testManifest(),
    baseline = frozenSummary(manifest)
) {
    return buildRHICandidateGateResult({
        manifest,
        environment: environment(manifest),
        frozenSummary: baseline,
        pairedRaw: raw,
        frozenBaseline: {
            byteLength: 11,
            sha256: '7'.repeat(64),
            summarySha256: '8'.repeat(64),
            commitSha: 'a'.repeat(40),
            capturedAt: '2026-07-14T12:00:00.000Z',
            productionFixtureSha256: '9'.repeat(64)
        },
        pairedCandidate: {
            byteLength: 12,
            sha256: 'c'.repeat(64),
            commitSha: raw.commitSha,
            capturedAt: raw.capturedAt,
            productionFixtureSha256: raw.productionFixture.sha256
        }
    });
}

function mutableCandidateMetrics(
    raw: RHIBenchmarkRawCaptureResult,
    roundIndex: number
): Partial<Record<RHIBenchmarkMetric, number[]>> {
    const round = raw.cases[0]?.rounds[roundIndex];
    if (!round) throw new Error('candidate test fixture round is missing');
    return round.results.rhi.metrics as unknown as Partial<Record<RHIBenchmarkMetric, number[]>>;
}

function mutableArchitectureMetrics(
    raw: RHIBenchmarkRawCaptureResult,
    architecture: RendererArchitecture,
    roundIndex: number
): Partial<Record<RHIBenchmarkMetric, number[]>> {
    const round = raw.cases[0]?.rounds[roundIndex];
    if (!round) throw new Error('candidate test fixture round is missing');
    return round.results[architecture].metrics as unknown as Partial<
        Record<RHIBenchmarkMetric, number[]>
    >;
}

function setCandidateMetric(
    raw: RHIBenchmarkRawCaptureResult,
    metric: RHIBenchmarkMetric,
    roundValues: readonly number[]
): void {
    for (let index = 0; index < roundValues.length; index += 1) {
        const value = roundValues[index];
        if (value === undefined) throw new Error('candidate test fixture value is missing');
        mutableArchitectureMetrics(raw, 'rhi', index)[metric] = [value];
    }
}

function setArchitectureMetric(
    raw: RHIBenchmarkRawCaptureResult,
    architecture: RendererArchitecture,
    metric: RHIBenchmarkMetric,
    roundValues: readonly number[]
): void {
    for (let index = 0; index < roundValues.length; index += 1) {
        const value = roundValues[index];
        if (value === undefined) throw new Error('candidate test fixture value is missing');
        mutableArchitectureMetrics(raw, architecture, index)[metric] = [value];
    }
}

function evidenceManifest(): RHIBenchmarkManifest {
    const manifest = parseRHIBenchmarkManifest(repositoryManifestValue);
    return {
        ...manifest,
        rig: {
            ...manifest.rig,
            acceptedFingerprintSha256: [environment(manifest).fingerprintSha256]
        }
    };
}

function fullRawMetrics(
    manifest: RHIBenchmarkManifest,
    drawCount: number,
    value: number
): RHIBenchmarkRawMetricSamples {
    const frameSamples = Array<number>(manifest.sampling.sampleFrames).fill(value);
    const allocationSamples = Array<number>(manifest.sampling.allocationSampleFrames).fill(value);
    const cacheSamples = Array<number>(manifest.sampling.sampleFrames).fill(0.9);
    const zeroAllocationSamples = Array<number>(manifest.sampling.allocationSampleFrames).fill(0);
    const drawSamples = Array<number>(manifest.sampling.sampleFrames).fill(drawCount);
    const metrics: Partial<Record<RHIBenchmarkMetric, readonly number[]>> = {};
    for (const metric of RHI_BENCHMARK_METRICS) {
        metrics[metric] =
            metric === 'actualDrawCount'
                ? drawSamples
                : metric === 'rhiHotPathAllocationBytesPerFrame'
                  ? zeroAllocationSamples
                  : metric === 'allocationBytesPerFrame'
                    ? allocationSamples
                    : (RHI_BENCHMARK_CACHE_HIT_METRICS as readonly string[]).includes(metric)
                      ? cacheSamples
                      : rhiBenchmarkMetricScope(metric) === 'frame'
                        ? frameSamples
                        : [value];
    }
    return metrics as RHIBenchmarkRawMetricSamples;
}

interface FullRawOptions {
    readonly commitSha: string;
    readonly fixtureSha256: string;
    readonly legacyValue?: number;
    readonly candidateValue?: number;
}

function fullRawCapture(
    manifest: RHIBenchmarkManifest,
    options: FullRawOptions
): RHIBenchmarkRawCaptureResult {
    const legacyValue = options.legacyValue ?? 100;
    const candidateValue = options.candidateValue ?? legacyValue;
    return {
        schemaVersion: 2,
        suite: 'rhi',
        manifestSha256: manifestSha256(manifest),
        commitSha: options.commitSha,
        capturedAt: '2026-07-15T12:00:00.000Z',
        environment: environment(manifest),
        productionFixture: {
            path: 'test/performance/fixtures/rhi-production.html',
            sha256: options.fixtureSha256
        },
        cases: manifest.scenarios.flatMap(scenario =>
            manifest.backends.map(backend => {
                const legacyMetrics = fullRawMetrics(
                    manifest,
                    scenario.quality.drawCount,
                    legacyValue
                );
                const candidateMetrics = fullRawMetrics(
                    manifest,
                    scenario.quality.drawCount,
                    candidateValue
                );
                const pixelHashSha256 = backend === 'webgl2' ? '5'.repeat(64) : '6'.repeat(64);
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
                                    metrics: legacyMetrics
                                },
                                rhi: {
                                    observedDrawCount: scenario.quality.drawCount,
                                    pixelHashSha256,
                                    metrics: candidateMetrics
                                }
                            }
                        };
                    })
                };
            })
        )
    };
}

function rawBytes(raw: RHIBenchmarkRawCaptureResult): Uint8Array {
    return new TextEncoder().encode(`${JSON.stringify(raw)}\n`);
}

function compressedRaw(raw: RHIBenchmarkRawCaptureResult): Uint8Array {
    return gzipSync(rawBytes(raw), { level: 9 });
}

interface EvidenceFixture {
    readonly manifest: RHIBenchmarkManifest;
    readonly preflight: RHIPhase0PreflightResult;
    readonly frozenRawBytes: Uint8Array;
    readonly frozenSummary: RHIBenchmarkBaselineResult;
    readonly frozenSummaryBytes: Uint8Array;
    readonly pairedRaw: RHIBenchmarkRawCaptureResult;
    readonly pairedRawBytes: Uint8Array;
    readonly currentCommitSha: string;
}

function evidenceFixture(
    currentValues: { readonly legacy?: number; readonly candidate?: number } = {}
): EvidenceFixture {
    const manifest = evidenceManifest();
    const frozenRaw = fullRawCapture(manifest, {
        commitSha: 'a'.repeat(40),
        fixtureSha256: '9'.repeat(64)
    });
    const frozenRawBytes = compressedRaw(frozenRaw);
    const verifiedFrozenSummary = summarizeRHIRawBenchmarkCapture(manifest, frozenRaw, {
        rawArtifact: {
            path: 'legacy.raw.json.gz',
            byteLength: frozenRawBytes.byteLength,
            sha256: sha256(frozenRawBytes)
        }
    });
    const frozenSummaryBytes = new TextEncoder().encode(
        `${JSON.stringify(verifiedFrozenSummary, null, 2)}\n`
    );
    const currentCommitSha = 'b'.repeat(40);
    const currentFixtureSha256 = 'd'.repeat(64);
    const currentPairedRaw = fullRawCapture(manifest, {
        commitSha: currentCommitSha,
        fixtureSha256: currentFixtureSha256,
        ...(currentValues.legacy === undefined ? {} : { legacyValue: currentValues.legacy }),
        ...(currentValues.candidate === undefined
            ? {}
            : { candidateValue: currentValues.candidate })
    });
    return {
        manifest,
        preflight: {
            manifest,
            environment: environment(manifest),
            productionFixturePath: '/fixture/rhi-production.html',
            productionFixtureRelativePath: 'test/performance/fixtures/rhi-production.html',
            productionFixtureModulePath: '/fixture/rhi-production.ts',
            productionFixtureSha256: currentFixtureSha256,
            browserExecutablePath: '/fixture/chromium'
        },
        frozenRawBytes,
        frozenSummary: verifiedFrozenSummary,
        frozenSummaryBytes,
        pairedRaw: currentPairedRaw,
        pairedRawBytes: compressedRaw(currentPairedRaw),
        currentCommitSha
    };
}

function evaluateFixture(fixture: EvidenceFixture) {
    return evaluateRHICandidateEvidence({
        preflight: fixture.preflight,
        frozenSummaryValue: fixture.frozenSummary,
        frozenSummaryBytes: fixture.frozenSummaryBytes,
        frozenRawBytes: fixture.frozenRawBytes,
        pairedRawBytes: fixture.pairedRawBytes,
        currentCommitSha: fixture.currentCommitSha
    });
}

describe('RHI paired candidate gate', () => {
    it('evaluates all metrics and applicable hard caps while keeping frozen/current identities distinct', () => {
        const manifest = testManifest();
        const result = build(pairedRaw(manifest), manifest);

        expect(result.passed).toBe(true);
        expect(result.scope).toBe('performance-and-pixel');
        expect(result.recoveryGate).toBe('not-covered-requires-runtime-suite');
        expect(result.frozenBaseline.commitSha).not.toBe(result.pairedCandidate.commitSha);
        expect(result.frozenBaseline.productionFixtureSha256).not.toBe(
            result.pairedCandidate.productionFixtureSha256
        );
        for (const benchmarkCase of result.cases) {
            expect(
                benchmarkCase.gates.filter(gate => gate.kind === 'paired-significance')
            ).toHaveLength(RHI_BENCHMARK_METRICS.length);
            expect(benchmarkCase.parityRounds).toHaveLength(manifest.sampling.rounds);
        }
        expect(
            new Set(
                result.cases.flatMap(benchmarkCase =>
                    benchmarkCase.gates
                        .filter(gate => gate.kind === 'candidate-hard-cap')
                        .map(gate => gate.id)
                )
            )
        ).toEqual(new Set(RHI_BENCHMARK_HARD_CAPS.map(cap => cap.id)));
        expect(
            new Set(
                result.cases.flatMap(benchmarkCase =>
                    benchmarkCase.gates
                        .filter(gate => gate.kind === 'legacy-drift-hard-cap')
                        .map(gate => gate.id.replace(/^legacy-drift:/u, ''))
                )
            )
        ).toEqual(new Set(RHI_BENCHMARK_HARD_CAPS.map(cap => cap.id)));

        const report = renderRHICandidateGateReport(result);
        expect(report).toContain('Paired CI');
        expect(report).toContain('(90%)');
        expect(report).not.toContain('Paired 95% CI');
    });

    it('fails a statistically significant regression even when it remains below the hard cap', () => {
        const manifest = testManifest();
        const raw = pairedRaw(manifest);
        setCandidateMetric(raw, 'rendererCpuMs', Array<number>(7).fill(101));

        const result = build(raw, manifest);
        const gate = result.cases[0]?.gates.find(
            candidate =>
                candidate.kind === 'paired-significance' && candidate.metric === 'rendererCpuMs'
        );
        expect(gate).toMatchObject({
            significantRegression: true,
            passed: false
        });
        expect(gate?.regressionFraction).toBeCloseTo(0.01);
        expect(result.passed).toBe(false);
    });

    it('fails common legacy/RHI drift against frozen legacy without inventing paired significance', () => {
        const manifest = testManifest();
        const raw = pairedRaw(manifest);
        setArchitectureMetric(raw, 'legacy', 'rendererCpuMs', Array<number>(7).fill(200));
        setArchitectureMetric(raw, 'rhi', 'rendererCpuMs', Array<number>(7).fill(200));

        const result = build(raw, manifest);
        const pairedGate = result.cases[0]?.gates.find(
            candidate =>
                candidate.kind === 'paired-significance' && candidate.metric === 'rendererCpuMs'
        );
        expect(pairedGate).toMatchObject({
            reference: 'paired-legacy',
            referenceValue: 200,
            comparison: 'rhi',
            comparisonValue: 200,
            significantRegression: false,
            passed: true
        });

        const candidateCap = result.cases[0]?.gates.find(
            candidate =>
                candidate.kind === 'candidate-hard-cap' &&
                candidate.id === 'steady-renderer-cpu-p50'
        );
        const driftCap = result.cases[0]?.gates.find(
            candidate =>
                candidate.kind === 'legacy-drift-hard-cap' &&
                candidate.id === 'legacy-drift:steady-renderer-cpu-p50'
        );
        for (const gate of [candidateCap, driftCap]) {
            expect(gate).toMatchObject({
                reference: 'frozen-legacy',
                referenceValue: 100,
                comparisonValue: 200,
                hardCapExceeded: true,
                passed: false
            });
            expect(gate).not.toHaveProperty('pairedDifferenceConfidenceInterval');
            expect(gate).not.toHaveProperty('significantRegression');
        }
        expect(candidateCap).toMatchObject({ comparison: 'rhi' });
        expect(driftCap).toMatchObject({ comparison: 'current-legacy' });
        expect(result.passed).toBe(false);
    });

    it('fails a hard cap even when the paired interval includes zero', () => {
        const manifest = testManifest();
        const raw = pairedRaw(manifest);
        setCandidateMetric(raw, 'rendererCpuMs', [103, 103, 103, 103, 0, 0, 0]);

        const result = build(raw, manifest);
        const gate = result.cases[0]?.gates.find(
            candidate =>
                candidate.kind === 'candidate-hard-cap' &&
                candidate.id === 'steady-renderer-cpu-p50'
        );
        expect(gate).toMatchObject({
            reference: 'frozen-legacy',
            comparison: 'rhi',
            hardCapExceeded: true,
            passed: false
        });
        expect(gate).not.toHaveProperty('pairedDifferenceConfidenceInterval');
        const pairedGate = result.cases[0]?.gates.find(
            candidate =>
                candidate.kind === 'paired-significance' && candidate.metric === 'rendererCpuMs'
        );
        if (pairedGate?.kind !== 'paired-significance') {
            throw new Error('paired renderer gate is missing');
        }
        expect(pairedGate.pairedDifferenceConfidenceInterval.low).toBeLessThanOrEqual(0);
        expect(pairedGate).toMatchObject({ significantRegression: false, passed: true });
        expect(result.passed).toBe(false);
    });

    it('serializes an over-budget hot-path regression with a JSON-safe unbounded marker', () => {
        const manifest = testManifest();
        const raw = pairedRaw(manifest);
        setCandidateMetric(raw, 'rhiHotPathAllocationBytesPerFrame', [
            RHI_BENCHMARK_RHI_HOT_PATH_ALLOCATION_TODO_BUDGET_BYTES + 1,
            0,
            0,
            0,
            0,
            0,
            0
        ]);

        const result = build(raw, manifest);
        const gate = result.cases[0]?.gates.find(
            candidate =>
                candidate.kind === 'candidate-hard-cap' &&
                candidate.id === 'rhi-hot-path-allocation'
        );
        expect(gate).toMatchObject({
            regressionFraction: null,
            regressionFractionUnbounded: true,
            hardCapExceeded: true,
            passed: false
        });
        const encoded = JSON.stringify(result);
        expect(encoded).not.toContain('Infinity');
        expect(JSON.parse(encoded)).toMatchObject({ passed: false });
    });

    it('records pixel and draw parity per round and rejects incomplete metric evidence', () => {
        const manifest = testManifest();
        const parityRaw = pairedRaw(manifest);
        const firstCandidate = parityRaw.cases[0]?.rounds[0]?.results.rhi as
            { observedDrawCount: number; pixelHashSha256: string } | undefined;
        if (!firstCandidate) throw new Error('candidate parity fixture is missing');
        firstCandidate.observedDrawCount += 1;
        firstCandidate.pixelHashSha256 = 'f'.repeat(64);

        const parityResult = build(parityRaw, manifest);
        expect(parityResult.cases[0]?.parityRounds[0]).toMatchObject({
            drawCountPassed: false,
            pixelHashPassed: false,
            passed: false
        });
        expect(parityResult.passed).toBe(false);

        const incompleteRaw = pairedRaw(manifest);
        delete mutableCandidateMetrics(incompleteRaw, 0).rendererCpuMs;
        expect(() => build(incompleteRaw, manifest)).toThrow(/missing rendererCpuMs/u);
    });

    it('verifies the complete frozen/current evidence chain and catches common regression', () => {
        const valid = evidenceFixture();
        const validResult = evaluateFixture(valid);
        expect(validResult.passed).toBe(true);
        expect(validResult.frozenBaseline).toMatchObject({
            sha256: sha256(valid.frozenRawBytes),
            summarySha256: sha256(valid.frozenSummaryBytes),
            commitSha: 'a'.repeat(40)
        });
        expect(validResult.pairedCandidate).toMatchObject({
            sha256: sha256(valid.pairedRawBytes),
            commitSha: valid.currentCommitSha
        });

        const commonRegression = evidenceFixture({ legacy: 200, candidate: 200 });
        const failedResult = evaluateFixture(commonRegression);
        const gates = failedResult.cases[0]?.gates ?? [];
        expect(
            gates.find(
                gate => gate.kind === 'paired-significance' && gate.metric === 'rendererCpuMs'
            )
        ).toMatchObject({ significantRegression: false, passed: true });
        expect(
            gates.find(
                gate => gate.kind === 'candidate-hard-cap' && gate.id === 'steady-renderer-cpu-p50'
            )
        ).toMatchObject({
            reference: 'frozen-legacy',
            referenceValue: 100,
            comparison: 'rhi',
            comparisonValue: 200,
            hardCapExceeded: true,
            passed: false
        });
        expect(
            gates.find(
                gate =>
                    gate.kind === 'legacy-drift-hard-cap' &&
                    gate.id === 'legacy-drift:steady-renderer-cpu-p50'
            )
        ).toMatchObject({
            reference: 'frozen-legacy',
            referenceValue: 100,
            comparison: 'current-legacy',
            comparisonValue: 200,
            hardCapExceeded: true,
            passed: false
        });
        expect(failedResult.passed).toBe(false);
    }, 15_000);

    it('rejects invalid environment, fixture, manifest, current commit, and frozen raw evidence', () => {
        const fixture = evidenceFixture();
        const evaluate = (
            overrides: Partial<{
                frozenRawBytes: Uint8Array;
                pairedRawBytes: Uint8Array;
                currentCommitSha: string;
            }>
        ) =>
            evaluateRHICandidateEvidence({
                preflight: fixture.preflight,
                frozenSummaryValue: fixture.frozenSummary,
                frozenSummaryBytes: fixture.frozenSummaryBytes,
                frozenRawBytes: overrides.frozenRawBytes ?? fixture.frozenRawBytes,
                pairedRawBytes: overrides.pairedRawBytes ?? fixture.pairedRawBytes,
                currentCommitSha: overrides.currentCommitSha ?? fixture.currentCommitSha
            });

        const changedEnvironment = {
            ...fixture.pairedRaw,
            environment: {
                ...fixture.pairedRaw.environment,
                browserVersion: 'changed-browser'
            }
        };
        expect(() => evaluate({ pairedRawBytes: rawBytes(changedEnvironment) })).toThrow(
            /environment|fingerprint/u
        );

        const changedFixture = {
            ...fixture.pairedRaw,
            productionFixture: {
                ...fixture.pairedRaw.productionFixture,
                sha256: 'e'.repeat(64)
            }
        };
        expect(() => evaluate({ pairedRawBytes: rawBytes(changedFixture) })).toThrow(
            /different current production fixture/u
        );

        const changedManifest = {
            ...fixture.pairedRaw,
            manifestSha256: 'f'.repeat(64)
        };
        expect(() => evaluate({ pairedRawBytes: rawBytes(changedManifest) })).toThrow(
            /manifest checksum mismatch/u
        );
        expect(() => evaluate({ currentCommitSha: 'c'.repeat(40) })).toThrow(
            /current clean source commit/u
        );
        const corruptedFrozenRaw = fixture.frozenRawBytes.slice();
        const lastFrozenByte = corruptedFrozenRaw.at(-1);
        if (lastFrozenByte === undefined) throw new Error('frozen raw fixture is empty');
        corruptedFrozenRaw[corruptedFrozenRaw.length - 1] = lastFrozenByte ^ 0xff;
        expect(() => evaluate({ frozenRawBytes: corruptedFrozenRaw })).toThrow(
            /raw artifact checksum/u
        );
        expect(() =>
            evaluate({ frozenRawBytes: new TextEncoder().encode('{"not":"gzip"}') })
        ).toThrow(/must remain gzip-compressed/u);
    }, 15_000);

    it('requires canonical enrolled baseline files and blocks symlinked output traversal', async () => {
        const temporary = await mkdtemp(join(tmpdir(), 'hilo3d-rhi-candidate-paths-'));
        const root = await realpath(temporary);
        const profile = 'contract-rig';
        const baselineDirectory = join(root, 'benchmarks/rhi/baselines', profile);
        const summaryPath = join(baselineDirectory, 'legacy.summary.json');
        const rawPath = join(baselineDirectory, 'legacy.raw.json.gz');
        const externalSummary = join(root, 'external.summary.json');
        const externalRaw = join(root, 'external.raw.json.gz');
        try {
            await mkdir(baselineDirectory, { recursive: true });
            await Promise.all([
                writeFile(summaryPath, '{}\n'),
                writeFile(rawPath, 'raw'),
                writeFile(externalSummary, '{}\n'),
                writeFile(externalRaw, 'raw')
            ]);
            await expect(
                resolveRHICandidateBaselinePaths(
                    root,
                    profile,
                    `benchmarks/rhi/baselines/${profile}/legacy.summary.json`
                )
            ).resolves.toEqual({ summaryPath, rawPath });
            await expect(
                resolveRHICandidateBaselinePaths(root, profile, externalSummary)
            ).rejects.toThrow(/must be exactly/u);

            await unlink(summaryPath);
            await symlink(externalSummary, summaryPath);
            await expect(
                resolveRHICandidateBaselinePaths(root, profile, summaryPath)
            ).rejects.toThrow(/canonical non-symlink/u);
            await unlink(summaryPath);
            await writeFile(summaryPath, '{}\n');
            await unlink(rawPath);
            await symlink(externalRaw, rawPath);
            await expect(
                resolveRHICandidateBaselinePaths(root, profile, summaryPath)
            ).rejects.toThrow(/canonical non-symlink/u);

            await unlink(rawPath);
            await writeFile(rawPath, 'raw');
            await symlink(baselineDirectory, join(root, 'reports-link'));
            await expect(
                resolveRHICandidateOutputPaths(
                    root,
                    'reports-link/candidate.json',
                    'reports/candidate.md'
                )
            ).rejects.toThrow(/immutable baseline directory/u);
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('runs the guarded orchestration, emits parity FAIL artifacts, and opens no invalid output', async () => {
        const fixture = evidenceFixture();
        const temporary = await mkdtemp(join(tmpdir(), 'hilo3d-rhi-candidate-runner-'));
        const root = await realpath(temporary);
        const baselineDirectory = join(
            root,
            'benchmarks/rhi/baselines',
            fixture.manifest.rig.profile
        );
        const reportsDirectory = join(root, 'reports');
        const firstCase = fixture.pairedRaw.cases[0];
        const firstRound = firstCase?.rounds[0];
        if (!firstCase || !firstRound) throw new Error('full evidence fixture is empty');
        const changedDrawCount = 0;
        const changedCandidate = {
            ...firstRound.results.rhi,
            observedDrawCount: changedDrawCount,
            pixelHashSha256: 'f'.repeat(64),
            metrics: {
                ...firstRound.results.rhi.metrics,
                actualDrawCount: Array<number>(fixture.manifest.sampling.sampleFrames).fill(
                    changedDrawCount
                )
            }
        };
        const parityRaw: RHIBenchmarkRawCaptureResult = {
            ...fixture.pairedRaw,
            cases: [
                {
                    ...firstCase,
                    rounds: [
                        {
                            ...firstRound,
                            results: {
                                ...firstRound.results,
                                rhi: changedCandidate
                            }
                        },
                        ...firstCase.rounds.slice(1)
                    ]
                },
                ...fixture.pairedRaw.cases.slice(1)
            ]
        };
        const pairedPath = join(reportsDirectory, 'candidate.raw.json.gz');
        const jsonPath = join(reportsDirectory, 'candidate.gate.json');
        const markdownPath = join(reportsDirectory, 'candidate.gate.md');
        try {
            await Promise.all([
                mkdir(baselineDirectory, { recursive: true }),
                mkdir(reportsDirectory, { recursive: true })
            ]);
            await Promise.all([
                writeFile(
                    join(baselineDirectory, 'legacy.summary.json'),
                    fixture.frozenSummaryBytes
                ),
                writeFile(join(baselineDirectory, 'legacy.raw.json.gz'), fixture.frozenRawBytes),
                writeFile(pairedPath, compressedRaw(parityRaw))
            ]);
            let auditCalls = 0;
            const dependencies = {
                preflight: () => Promise.resolve(fixture.preflight),
                auditedCommit: () => {
                    auditCalls += 1;
                    return Promise.resolve(fixture.currentCommitSha);
                }
            };
            const options = {
                repositoryRoot: root,
                manifestValue: fixture.manifest,
                environmentValue: fixture.preflight.environment,
                pairedRawPath: 'reports/candidate.raw.json.gz',
                frozenSummaryPath: `benchmarks/rhi/baselines/${fixture.manifest.rig.profile}/legacy.summary.json`,
                jsonOutputPath: 'reports/candidate.gate.json',
                markdownOutputPath: 'reports/candidate.gate.md'
            };
            const result = await runRHICandidateGate(options, dependencies);
            expect(result.passed).toBe(false);
            expect(result.cases[0]?.parityRounds[0]).toMatchObject({
                drawCountPassed: false,
                pixelHashPassed: false,
                passed: false
            });
            expect(auditCalls).toBe(2);
            await expect(readFile(jsonPath, 'utf8')).resolves.toContain('"passed": false');
            await expect(readFile(markdownPath, 'utf8')).resolves.toContain('**FAIL**');

            const invalidRaw = {
                ...fixture.pairedRaw,
                manifestSha256: '0'.repeat(64)
            };
            await writeFile(
                join(reportsDirectory, 'invalid.raw.json.gz'),
                compressedRaw(invalidRaw)
            );
            const invalidJson = join(reportsDirectory, 'invalid.gate.json');
            const invalidMarkdown = join(reportsDirectory, 'invalid.gate.md');
            await expect(
                runRHICandidateGate(
                    {
                        ...options,
                        pairedRawPath: 'reports/invalid.raw.json.gz',
                        jsonOutputPath: 'reports/invalid.gate.json',
                        markdownOutputPath: 'reports/invalid.gate.md'
                    },
                    dependencies
                )
            ).rejects.toThrow(/manifest checksum mismatch/u);
            await expect(access(invalidJson)).rejects.toThrow();
            await expect(access(invalidMarkdown)).rejects.toThrow();

            const dirtyJson = join(reportsDirectory, 'dirty.gate.json');
            await expect(
                runRHICandidateGate(
                    {
                        ...options,
                        jsonOutputPath: 'reports/dirty.gate.json',
                        markdownOutputPath: 'reports/dirty.gate.md'
                    },
                    {
                        preflight: dependencies.preflight,
                        auditedCommit: () =>
                            Promise.reject(
                                new Error('RHI benchmark capture requires a clean Git worktree')
                            )
                    }
                )
            ).rejects.toThrow(/clean Git worktree/u);
            await expect(access(dirtyJson)).rejects.toThrow();
        } finally {
            await rm(root, { force: true, recursive: true });
        }
    });

    it('publishes both reports without overwrite and removes the first if the second fails', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'hilo3d-rhi-candidate-'));
        const jsonPath = join(directory, 'candidate.gate.json');
        const markdownPath = join(directory, 'candidate.gate.md');
        const result = build();
        try {
            await writeFile(markdownPath, 'existing report\n');
            await expect(
                writeRHICandidateGateArtifacts(result, jsonPath, markdownPath)
            ).rejects.toThrow();
            await expect(access(jsonPath)).rejects.toThrow();
            await expect(readFile(markdownPath, 'utf8')).resolves.toBe('existing report\n');

            await unlink(markdownPath);
            await writeRHICandidateGateArtifacts(result, jsonPath, markdownPath);
            const firstJson = await readFile(jsonPath, 'utf8');
            const firstMarkdown = await readFile(markdownPath, 'utf8');
            await expect(
                writeRHICandidateGateArtifacts(result, jsonPath, markdownPath)
            ).rejects.toThrow();
            await expect(readFile(jsonPath, 'utf8')).resolves.toBe(firstJson);
            await expect(readFile(markdownPath, 'utf8')).resolves.toBe(firstMarkdown);
        } finally {
            await rm(directory, { force: true, recursive: true });
        }
    });
});
