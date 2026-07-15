import { gunzipSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RHI_BENCHMARK_BACKENDS,
    RHI_BENCHMARK_CACHE_HIT_METRICS,
    RHI_BENCHMARK_METRICS,
    rhiBenchmarkMetricSampleCount,
    type RendererArchitecture,
    type RHIBenchmarkBaselineResult,
    type RHIBenchmarkDistribution,
    type RHIBenchmarkMetric,
    type RHIBenchmarkRawArtifact,
    type RHIBenchmarkRawCaptureResult,
    type RHIBenchmarkRoundMetrics
} from '../../benchmarks/rhi-v2/result-schema';
import {
    deriveRHIBenchmarkBootstrapSeed,
    rhiBenchmarkPairedOrder,
    summarizeRHIBenchmarkDistribution
} from './rhi-benchmark-statistics';
import {
    RHI_PRODUCTION_FIXTURE_PATH,
    assertRHIPhase0Preflight,
    readRHIPhase0EnvironmentFile
} from './rhi-phase0-preflight';
import {
    canonicalRHIJson,
    manifestSha256,
    parseRHIBenchmarkEnvironment,
    parseRHIBenchmarkManifest,
    sha256,
    verifyRHIBenchmarkEnvironment
} from './verify-rhi-baseline';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;

function rawFailure(message: string): never {
    throw new Error(`Invalid raw RHI benchmark capture: ${message}`);
}

function record(value: unknown, context: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        rawFailure(`${context} must be an object`);
    }
    return value as Record<string, unknown>;
}

function exactKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
    context: string
): void {
    const actual = Object.keys(value).sort();
    const required = [...expected].sort();
    if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
        rawFailure(`${context} keys must be exactly ${required.join(', ')}`);
    }
}

function stringValue(value: unknown, context: string): string {
    if (typeof value !== 'string' || value.length === 0) rawFailure(`${context} must be non-empty`);
    return value;
}

function integerValue(value: unknown, context: string, minimum = 0): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
        rawFailure(`${context} must be a safe integer >= ${String(minimum)}`);
    }
    return value as number;
}

function sha256Value(value: unknown, context: string): string {
    const digest = stringValue(value, context);
    if (!SHA256_PATTERN.test(digest)) rawFailure(`${context} must be a SHA-256 digest`);
    return digest;
}

function validateMetricSamples(
    value: unknown,
    metric: RHIBenchmarkMetric,
    expectedSampleCount: number,
    context: string,
    observedDrawCount: number
): void {
    if (!Array.isArray(value) || value.length !== expectedSampleCount) {
        rawFailure(`${context} must contain exactly ${String(expectedSampleCount)} samples`);
    }
    for (let index = 0; index < value.length; index += 1) {
        const sample: unknown = value[index];
        if (typeof sample !== 'number' || !Number.isFinite(sample) || sample < 0) {
            rawFailure(`${context}[${String(index)}] must be finite and non-negative`);
        }
        if ((RHI_BENCHMARK_CACHE_HIT_METRICS as readonly string[]).includes(metric) && sample > 1) {
            rawFailure(`${context}[${String(index)}] cache hit rate must not exceed one`);
        }
        if (metric === 'actualDrawCount' && sample !== observedDrawCount) {
            rawFailure(`${context}[${String(index)}] must equal observedDrawCount`);
        }
    }
}

export interface RHIRawBenchmarkVerificationOptions {
    /** Preserve validly shaped draw/pixel parity failures so the candidate gate can report them. */
    readonly parityMode?: 'strict' | 'candidate-gate';
}

export function verifyRHIRawBenchmarkCapture(
    manifestValue: unknown,
    rawValue: unknown,
    options: RHIRawBenchmarkVerificationOptions = {}
): RHIBenchmarkRawCaptureResult {
    const manifest = parseRHIBenchmarkManifest(manifestValue);
    const strictParity = (options.parityMode ?? 'strict') === 'strict';
    const raw = record(rawValue, 'raw');
    exactKeys(
        raw,
        [
            'schemaVersion',
            'suite',
            'manifestSha256',
            'commitSha',
            'capturedAt',
            'environment',
            'productionFixture',
            'cases'
        ],
        'raw'
    );
    if (raw['schemaVersion'] !== 2 || raw['suite'] !== 'rhi-v2') {
        rawFailure('schemaVersion must be 2 and suite must be rhi-v2');
    }
    if (sha256Value(raw['manifestSha256'], 'raw.manifestSha256') !== manifestSha256(manifest)) {
        rawFailure('manifest checksum mismatch');
    }
    const commitSha = stringValue(raw['commitSha'], 'raw.commitSha');
    if (!COMMIT_SHA_PATTERN.test(commitSha)) rawFailure('commitSha must be a full Git SHA');
    const capturedAt = stringValue(raw['capturedAt'], 'raw.capturedAt');
    if (!Number.isFinite(Date.parse(capturedAt))) rawFailure('capturedAt must be ISO-8601');
    const environment = parseRHIBenchmarkEnvironment(raw['environment']);
    verifyRHIBenchmarkEnvironment(manifest.rig, environment);
    const fixture = record(raw['productionFixture'], 'raw.productionFixture');
    exactKeys(fixture, ['path', 'sha256'], 'raw.productionFixture');
    if (fixture['path'] !== RHI_PRODUCTION_FIXTURE_PATH) {
        rawFailure('production fixture path is not the fixed RHI-v2 fixture');
    }
    sha256Value(fixture['sha256'], 'raw.productionFixture.sha256');
    if (!Array.isArray(raw['cases'])) rawFailure('raw.cases must be an array');
    const expectedCaseCount = manifest.scenarios.length * manifest.backends.length;
    if (raw['cases'].length !== expectedCaseCount) {
        rawFailure(`raw.cases must contain exactly ${String(expectedCaseCount)} cases`);
    }
    const caseKeys = new Set<string>();
    for (let caseIndex = 0; caseIndex < raw['cases'].length; caseIndex += 1) {
        const context = `raw.cases[${String(caseIndex)}]`;
        const benchmarkCase = record(raw['cases'][caseIndex], context);
        exactKeys(benchmarkCase, ['scenarioId', 'backend', 'quality', 'rounds'], context);
        const scenarioId = stringValue(benchmarkCase['scenarioId'], `${context}.scenarioId`);
        const scenario = manifest.scenarios.find(candidate => candidate.id === scenarioId);
        if (!scenario) rawFailure(`${context}.scenarioId is unknown`);
        const backend = stringValue(benchmarkCase['backend'], `${context}.backend`);
        if (!(RHI_BENCHMARK_BACKENDS as readonly string[]).includes(backend)) {
            rawFailure(`${context}.backend is unknown`);
        }
        const caseKey = `${scenarioId}:${backend}`;
        if (caseKeys.has(caseKey)) rawFailure(`duplicate raw case ${caseKey}`);
        caseKeys.add(caseKey);
        if (canonicalRHIJson(benchmarkCase['quality']) !== canonicalRHIJson(scenario.quality)) {
            rawFailure(`${context}.quality differs from the manifest`);
        }
        if (!Array.isArray(benchmarkCase['rounds']))
            rawFailure(`${context}.rounds must be an array`);
        if (benchmarkCase['rounds'].length !== manifest.sampling.rounds) {
            rawFailure(`${context}.rounds must contain ${String(manifest.sampling.rounds)} rounds`);
        }
        const roundNumbers = new Set<number>();
        let expectedPixelHash: string | undefined;
        for (let roundIndex = 0; roundIndex < benchmarkCase['rounds'].length; roundIndex += 1) {
            const roundContext = `${context}.rounds[${String(roundIndex)}]`;
            const round = record(benchmarkCase['rounds'][roundIndex], roundContext);
            exactKeys(round, ['round', 'order', 'results'], roundContext);
            const roundNumber = integerValue(round['round'], `${roundContext}.round`, 1);
            if (roundNumbers.has(roundNumber) || roundNumber > manifest.sampling.rounds) {
                rawFailure(`${roundContext}.round is duplicate or out of range`);
            }
            roundNumbers.add(roundNumber);
            if (
                !Array.isArray(round['order']) ||
                round['order'].length !== 2 ||
                new Set(round['order']).size !== 2 ||
                !round['order'].includes('legacy') ||
                !round['order'].includes('rhi-v2')
            ) {
                rawFailure(`${roundContext}.order must contain legacy and rhi-v2 exactly once`);
            }
            if (
                canonicalRHIJson(round['order']) !==
                canonicalRHIJson(
                    rhiBenchmarkPairedOrder(
                        manifest.sampling.orderSeed,
                        scenarioId,
                        backend,
                        roundNumber
                    )
                )
            ) {
                rawFailure(`${roundContext}.order differs from the deterministic seeded order`);
            }
            const results = record(round['results'], `${roundContext}.results`);
            exactKeys(results, ['legacy', 'rhi-v2'], `${roundContext}.results`);
            for (const architecture of ['legacy', 'rhi-v2'] as const) {
                const resultContext = `${roundContext}.results.${architecture}`;
                const result = record(results[architecture], resultContext);
                exactKeys(
                    result,
                    ['observedDrawCount', 'pixelHashSha256', 'metrics'],
                    resultContext
                );
                const observedDrawCount = integerValue(
                    result['observedDrawCount'],
                    `${resultContext}.observedDrawCount`,
                    strictParity ? 1 : 0
                );
                if (strictParity && observedDrawCount !== scenario.quality.drawCount) {
                    rawFailure(`${resultContext}.observedDrawCount differs from the manifest`);
                }
                const pixelHash = sha256Value(
                    result['pixelHashSha256'],
                    `${resultContext}.pixelHashSha256`
                );
                if (strictParity) {
                    expectedPixelHash ??= pixelHash;
                    if (pixelHash !== expectedPixelHash) {
                        rawFailure(`${context} pixel hashes differ across architecture or round`);
                    }
                }
                const metrics = record(result['metrics'], `${resultContext}.metrics`);
                exactKeys(metrics, RHI_BENCHMARK_METRICS, `${resultContext}.metrics`);
                for (const metric of RHI_BENCHMARK_METRICS) {
                    validateMetricSamples(
                        metrics[metric],
                        metric,
                        rhiBenchmarkMetricSampleCount(metric, manifest.sampling),
                        `${resultContext}.metrics.${metric}`,
                        observedDrawCount
                    );
                }
            }
        }
    }
    for (const scenario of manifest.scenarios) {
        for (const backend of manifest.backends) {
            if (!caseKeys.has(`${scenario.id}:${backend}`)) {
                rawFailure(`raw capture is missing ${scenario.id}:${backend}`);
            }
        }
    }
    return rawValue as RHIBenchmarkRawCaptureResult;
}

export interface RHIBenchmarkSummarizeOptions {
    readonly rawArtifact: RHIBenchmarkRawArtifact;
    readonly architecture?: RendererArchitecture;
}

export function decodeRHIRawBenchmarkArtifact(rawBytes: Uint8Array): unknown {
    const decoded = rawBytes[0] === 0x1f && rawBytes[1] === 0x8b ? gunzipSync(rawBytes) : rawBytes;
    return JSON.parse(new TextDecoder().decode(decoded)) as unknown;
}

export function summarizeRHIRawBenchmarkCapture(
    manifestValue: unknown,
    rawValue: unknown,
    options: RHIBenchmarkSummarizeOptions
): RHIBenchmarkBaselineResult {
    const manifest = parseRHIBenchmarkManifest(manifestValue);
    const raw = verifyRHIRawBenchmarkCapture(manifest, rawValue);
    const architecture = options.architecture ?? 'legacy';
    if (architecture !== 'legacy') {
        throw new Error('baseline summarizer only freezes the legacy architecture');
    }
    return {
        schemaVersion: 2,
        suite: 'rhi-v2',
        architecture: 'legacy',
        manifestSha256: raw.manifestSha256,
        commitSha: raw.commitSha,
        capturedAt: raw.capturedAt,
        environment: raw.environment,
        rawArtifact: options.rawArtifact,
        cases: raw.cases.map(benchmarkCase => {
            const firstResult = benchmarkCase.rounds[0]?.results.legacy;
            if (!firstResult) throw new Error('raw case is missing its first legacy round');
            return {
                scenarioId: benchmarkCase.scenarioId,
                backend: benchmarkCase.backend,
                quality: benchmarkCase.quality,
                observedDrawCount: firstResult.observedDrawCount,
                pixelHashSha256: firstResult.pixelHashSha256,
                rounds: benchmarkCase.rounds.map(round => {
                    const result = round.results.legacy;
                    const metrics: Partial<Record<RHIBenchmarkMetric, RHIBenchmarkDistribution>> =
                        {};
                    for (const metric of RHI_BENCHMARK_METRICS) {
                        metrics[metric] = summarizeRHIBenchmarkDistribution(
                            result.metrics[metric],
                            {
                                seed: deriveRHIBenchmarkBootstrapSeed(
                                    manifest.sampling.bootstrapSeed,
                                    benchmarkCase.scenarioId,
                                    benchmarkCase.backend,
                                    round.round,
                                    architecture,
                                    metric
                                ),
                                iterations: manifest.sampling.bootstrapIterations,
                                confidenceLevel: manifest.sampling.confidenceLevel
                            }
                        );
                    }
                    return {
                        round: round.round,
                        sampleCount: manifest.sampling.sampleFrames,
                        orderPosition: round.order.indexOf(architecture),
                        metrics: metrics as RHIBenchmarkRoundMetrics
                    };
                })
            };
        })
    };
}

function outputIsBaselinePath(repositoryRoot: string, outputPath: string): boolean {
    const baselineRoot = resolve(repositoryRoot, 'benchmarks/rhi-v2/baselines');
    const child = relative(baselineRoot, resolve(outputPath));
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

async function main(): Promise<void> {
    const rawArgument = process.argv[2];
    const outputArgument = process.argv[3];
    if (!rawArgument || !outputArgument) {
        throw new Error('Usage: npm run benchmark:rhi:summarize -- <raw.json> <summary.json>');
    }
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    if (outputIsBaselinePath(repositoryRoot, outputArgument)) {
        throw new Error('summarizer may only write temporary reports, never baseline directories');
    }
    const manifestPath = resolve(repositoryRoot, 'benchmarks/rhi-v2/manifest.json');
    const [manifestSource, rawBytes, environmentValue] = await Promise.all([
        readFile(manifestPath, 'utf8'),
        readFile(resolve(rawArgument)),
        readRHIPhase0EnvironmentFile()
    ]);
    const manifestValue = JSON.parse(manifestSource) as unknown;
    const rawValue = decodeRHIRawBenchmarkArtifact(rawBytes);
    const preflight = await assertRHIPhase0Preflight({
        repositoryRoot,
        manifestValue,
        environmentValue
    });
    const raw = verifyRHIRawBenchmarkCapture(preflight.manifest, rawValue);
    if (canonicalRHIJson(raw.environment) !== canonicalRHIJson(preflight.environment)) {
        rawFailure('raw capture environment differs from the audited preflight environment');
    }
    if (raw.productionFixture.sha256 !== preflight.productionFixtureSha256) {
        rawFailure('raw capture production fixture checksum differs from the repository fixture');
    }
    const rawArtifactPath = relative(dirname(resolve(outputArgument)), resolve(rawArgument));
    if (
        rawArtifactPath === '' ||
        rawArtifactPath === '..' ||
        rawArtifactPath.startsWith(`..${sep}`) ||
        isAbsolute(rawArtifactPath)
    ) {
        throw new Error('raw artifact must be beside or below its temporary summary');
    }
    const summary = summarizeRHIRawBenchmarkCapture(preflight.manifest, raw, {
        rawArtifact: {
            path: rawArtifactPath,
            byteLength: rawBytes.byteLength,
            sha256: sha256(rawBytes)
        }
    });
    await writeFile(resolve(outputArgument), `${JSON.stringify(summary, null, 2)}\n`, {
        flag: 'wx'
    });
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) await main();
