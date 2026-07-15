import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RHI_BENCHMARK_HARD_CAPS,
    RHI_BENCHMARK_METRICS,
    type RHIBenchmarkBaselineResult,
    type RHIBenchmarkCandidateCaseGate,
    type RHIBenchmarkCandidateGateComparison,
    type RHIBenchmarkCandidateEvidenceArtifact,
    type RHIBenchmarkCandidateFrozenHardCapGate,
    type RHIBenchmarkCandidateGateResult,
    type RHIBenchmarkCandidateMetricGate,
    type RHIBenchmarkCandidatePairedSignificanceGate,
    type RHIBenchmarkCandidateParityRound,
    type RHIBenchmarkDistribution,
    type RHIBenchmarkEnvironment,
    type RHIBenchmarkGateStatistic,
    type RHIBenchmarkHardCap,
    type RHIBenchmarkManifest,
    type RHIBenchmarkMetric,
    type RHIBenchmarkRawCaptureResult,
    type RHIBenchmarkRawRoundResult,
    type RHIBenchmarkRoundMetrics,
    type RendererArchitecture
} from '../../benchmarks/rhi-v2/result-schema';
import { auditedRHIBenchmarkCommit } from './collect-rhi-benchmark';
import {
    aggregateRHIBenchmarkRoundValues,
    deriveRHIBenchmarkBootstrapSeed,
    evaluateRHIBenchmarkHardCapComparison,
    evaluateRHIBenchmarkPairedGate,
    rhiBenchmarkDistributionStatistic,
    rhiBenchmarkHardCapApplies,
    summarizeRHIBenchmarkDistribution,
    type RHIBenchmarkHardCapComparisonResult,
    type RHIBenchmarkPairedGateResult
} from './rhi-benchmark-statistics';
import {
    assertRHIPhase0Preflight,
    readRHIPhase0EnvironmentFile,
    type RHIPhase0PreflightResult
} from './rhi-phase0-preflight';
import { renderRHICandidateGateReport } from './render-rhi-candidate-report';
import {
    decodeRHIRawBenchmarkArtifact,
    summarizeRHIRawBenchmarkCapture,
    verifyRHIRawBenchmarkCapture
} from './summarize-rhi-benchmark';
import { canonicalRHIJson, sha256, verifyRHIBaseline } from './verify-rhi-baseline';

interface SummarizedPairedRound {
    readonly raw: RHIBenchmarkRawRoundResult;
    readonly metrics: Readonly<Record<RendererArchitecture, RHIBenchmarkRoundMetrics>>;
}

export interface RHICandidateGateBuildOptions {
    readonly manifest: RHIBenchmarkManifest;
    readonly environment: RHIBenchmarkEnvironment;
    readonly frozenSummary: RHIBenchmarkBaselineResult;
    readonly pairedRaw: RHIBenchmarkRawCaptureResult;
    readonly frozenBaseline: RHIBenchmarkCandidateEvidenceArtifact & {
        readonly summarySha256: string;
    };
    readonly pairedCandidate: RHIBenchmarkCandidateEvidenceArtifact;
}

export interface RHICandidateEvidenceOptions {
    readonly preflight: RHIPhase0PreflightResult;
    readonly frozenSummaryValue: unknown;
    readonly frozenSummaryBytes: Uint8Array;
    readonly frozenRawBytes: Uint8Array;
    readonly pairedRawBytes: Uint8Array;
    readonly currentCommitSha: string;
}

export interface RHICandidateBaselinePaths {
    readonly summaryPath: string;
    readonly rawPath: string;
}

export interface RHICandidateOutputPaths {
    readonly jsonPath: string;
    readonly markdownPath: string;
}

export interface RHICandidateGateRunOptions {
    readonly repositoryRoot: string;
    readonly manifestValue: unknown;
    readonly environmentValue: unknown;
    readonly pairedRawPath: string;
    readonly frozenSummaryPath: string;
    readonly jsonOutputPath: string;
    readonly markdownOutputPath: string;
}

export interface RHICandidateGateRunDependencies {
    readonly preflight?: typeof assertRHIPhase0Preflight;
    readonly auditedCommit?: typeof auditedRHIBenchmarkCommit;
}

function candidateFailure(message: string): never {
    throw new Error(`RHI candidate gate failed: ${message}`);
}

function metricDistribution(
    manifest: RHIBenchmarkManifest,
    scenarioId: string,
    backend: string,
    round: RHIBenchmarkRawRoundResult,
    architecture: RendererArchitecture,
    metric: RHIBenchmarkMetric
): RHIBenchmarkDistribution {
    const samples = (
        round.results[architecture].metrics as Partial<
            Record<RHIBenchmarkMetric, readonly number[]>
        >
    )[metric];
    if (samples === undefined) {
        candidateFailure(
            `${scenarioId}/${backend}/round ${String(round.round)}/${architecture} is missing ${metric}`
        );
    }
    return summarizeRHIBenchmarkDistribution(samples, {
        seed: deriveRHIBenchmarkBootstrapSeed(
            manifest.sampling.bootstrapSeed,
            scenarioId,
            backend,
            round.round,
            architecture,
            metric
        ),
        iterations: manifest.sampling.bootstrapIterations,
        confidenceLevel: manifest.sampling.confidenceLevel
    });
}

function summarizePairedRound(
    manifest: RHIBenchmarkManifest,
    scenarioId: string,
    backend: string,
    round: RHIBenchmarkRawRoundResult
): SummarizedPairedRound {
    const summarized: Partial<Record<RendererArchitecture, RHIBenchmarkRoundMetrics>> = {};
    for (const architecture of ['legacy', 'rhi-v2'] as const) {
        const metrics: Partial<Record<RHIBenchmarkMetric, RHIBenchmarkDistribution>> = {};
        for (const metric of RHI_BENCHMARK_METRICS) {
            metrics[metric] = metricDistribution(
                manifest,
                scenarioId,
                backend,
                round,
                architecture,
                metric
            );
        }
        summarized[architecture] = metrics as RHIBenchmarkRoundMetrics;
    }
    return {
        raw: round,
        metrics: summarized as Readonly<Record<RendererArchitecture, RHIBenchmarkRoundMetrics>>
    };
}

function jsonSafeRegressionFraction(value: number): {
    readonly regressionFraction: number | null;
    readonly regressionFractionUnbounded: boolean;
} {
    const regressionFractionUnbounded = !Number.isFinite(value);
    return {
        regressionFraction: regressionFractionUnbounded ? null : value,
        regressionFractionUnbounded
    };
}

function pairedSignificanceGate(
    id: string,
    result: RHIBenchmarkPairedGateResult
): RHIBenchmarkCandidatePairedSignificanceGate {
    return {
        id,
        kind: 'paired-significance',
        metric: result.metric,
        direction: result.direction,
        statistic: result.statistic,
        reference: 'paired-legacy',
        comparison: 'rhi-v2',
        pairCount: result.pairCount,
        referenceValue: result.baselineValue,
        comparisonValue: result.candidateValue,
        ...jsonSafeRegressionFraction(result.regressionFraction),
        pairedDifferenceConfidenceInterval: result.pairedDifferenceConfidenceInterval,
        significantRegression: result.significantRegression,
        passed: result.passed
    };
}

function frozenHardCapGate(
    id: string,
    kind: 'candidate-hard-cap' | 'legacy-drift-hard-cap',
    comparison: RHIBenchmarkCandidateGateComparison,
    hardCap: RHIBenchmarkHardCap,
    result: RHIBenchmarkHardCapComparisonResult
): RHIBenchmarkCandidateFrozenHardCapGate {
    return {
        id,
        kind,
        metric: result.metric,
        direction: result.direction,
        statistic: result.statistic,
        reference: 'frozen-legacy',
        comparison,
        referenceValue: result.referenceValue,
        comparisonValue: result.comparisonValue,
        ...jsonSafeRegressionFraction(result.regressionFraction),
        ...(hardCap.maximumRegressionFraction === undefined
            ? {}
            : { maximumRegressionFraction: hardCap.maximumRegressionFraction }),
        ...(hardCap.absoluteMaximum === undefined
            ? {}
            : { absoluteMaximum: hardCap.absoluteMaximum }),
        hardCapExceeded: result.hardCapExceeded,
        passed: result.passed
    };
}

function pairedValues(
    rounds: readonly SummarizedPairedRound[],
    architecture: RendererArchitecture,
    metric: RHIBenchmarkMetric,
    statistic: RHIBenchmarkGateStatistic
): number[] {
    return rounds.map(round =>
        rhiBenchmarkDistributionStatistic(round.metrics[architecture][metric], statistic)
    );
}

function evaluatePairedSignificance(
    manifest: RHIBenchmarkManifest,
    scenarioId: string,
    backend: string,
    rounds: readonly SummarizedPairedRound[],
    metric: RHIBenchmarkMetric,
    statistic: RHIBenchmarkGateStatistic
): RHIBenchmarkCandidatePairedSignificanceGate {
    const id = `paired-significance:${metric}`;
    const result = evaluateRHIBenchmarkPairedGate({
        metric,
        statistic,
        baseline: pairedValues(rounds, 'legacy', metric, statistic),
        candidate: pairedValues(rounds, 'rhi-v2', metric, statistic),
        seed: deriveRHIBenchmarkBootstrapSeed(
            manifest.sampling.bootstrapSeed,
            scenarioId,
            backend,
            'candidate-gate',
            id
        ),
        iterations: manifest.sampling.bootstrapIterations,
        confidenceLevel: manifest.sampling.confidenceLevel
    });
    return pairedSignificanceGate(id, result);
}

function aggregateMetric(
    values: readonly SummarizedPairedRound[],
    architecture: RendererArchitecture,
    hardCap: RHIBenchmarkHardCap
): number {
    return aggregateRHIBenchmarkRoundValues(
        pairedValues(values, architecture, hardCap.metric, hardCap.statistic),
        hardCap.statistic,
        hardCap.metric
    );
}

function frozenMetric(
    benchmarkCase: RHIBenchmarkBaselineResult['cases'][number],
    hardCap: RHIBenchmarkHardCap
): number {
    const values = [...benchmarkCase.rounds]
        .sort((left, right) => left.round - right.round)
        .map(round =>
            rhiBenchmarkDistributionStatistic(round.metrics[hardCap.metric], hardCap.statistic)
        );
    return aggregateRHIBenchmarkRoundValues(values, hardCap.statistic, hardCap.metric);
}

function evaluateFrozenHardCap(
    id: string,
    kind: 'candidate-hard-cap' | 'legacy-drift-hard-cap',
    comparison: 'rhi-v2' | 'current-legacy',
    hardCap: RHIBenchmarkHardCap,
    referenceValue: number,
    comparisonValue: number
): RHIBenchmarkCandidateFrozenHardCapGate {
    return frozenHardCapGate(
        id,
        kind,
        comparison,
        hardCap,
        evaluateRHIBenchmarkHardCapComparison({
            metric: hardCap.metric,
            statistic: hardCap.statistic,
            referenceValue,
            comparisonValue,
            ...(hardCap.maximumRegressionFraction === undefined
                ? {}
                : { maximumRegressionFraction: hardCap.maximumRegressionFraction }),
            ...(hardCap.absoluteMaximum === undefined
                ? {}
                : { absoluteMaximum: hardCap.absoluteMaximum })
        })
    );
}

function parityRound(
    expectedDrawCount: number,
    expectedPixelHashSha256: string,
    round: RHIBenchmarkRawRoundResult
): RHIBenchmarkCandidateParityRound {
    const legacy = round.results.legacy;
    const candidate = round.results['rhi-v2'];
    const drawCountPassed =
        legacy.observedDrawCount === expectedDrawCount &&
        candidate.observedDrawCount === expectedDrawCount &&
        legacy.observedDrawCount === candidate.observedDrawCount;
    const pixelHashPassed =
        legacy.pixelHashSha256 === expectedPixelHashSha256 &&
        candidate.pixelHashSha256 === expectedPixelHashSha256;
    return {
        round: round.round,
        order: round.order,
        legacyObservedDrawCount: legacy.observedDrawCount,
        candidateObservedDrawCount: candidate.observedDrawCount,
        legacyPixelHashSha256: legacy.pixelHashSha256,
        candidatePixelHashSha256: candidate.pixelHashSha256,
        drawCountPassed,
        pixelHashPassed,
        passed: drawCountPassed && pixelHashPassed
    };
}

function evaluateCase(
    manifest: RHIBenchmarkManifest,
    frozenSummary: RHIBenchmarkBaselineResult,
    benchmarkCase: RHIBenchmarkRawCaptureResult['cases'][number]
): RHIBenchmarkCandidateCaseGate {
    const scenario = manifest.scenarios.find(
        candidate => candidate.id === benchmarkCase.scenarioId
    );
    if (scenario === undefined) {
        candidateFailure(`unknown scenario ${benchmarkCase.scenarioId}`);
    }
    const frozenCase = frozenSummary.cases.find(
        candidate =>
            candidate.scenarioId === benchmarkCase.scenarioId &&
            candidate.backend === benchmarkCase.backend
    );
    if (frozenCase === undefined) {
        candidateFailure(
            `frozen baseline is missing ${benchmarkCase.scenarioId}/${benchmarkCase.backend}`
        );
    }
    if (frozenCase.rounds.length !== manifest.sampling.rounds) {
        candidateFailure(
            `frozen baseline ${benchmarkCase.scenarioId}/${benchmarkCase.backend} has ${String(frozenCase.rounds.length)} rounds`
        );
    }
    const orderedRounds = [...benchmarkCase.rounds].sort((left, right) => left.round - right.round);
    if (orderedRounds.length !== manifest.sampling.rounds) {
        candidateFailure(
            `${benchmarkCase.scenarioId}/${benchmarkCase.backend} has ${String(orderedRounds.length)} paired rounds`
        );
    }
    for (let index = 0; index < orderedRounds.length; index += 1) {
        if (orderedRounds[index]?.round !== index + 1) {
            candidateFailure(
                `${benchmarkCase.scenarioId}/${benchmarkCase.backend} has a missing or duplicate round`
            );
        }
    }
    const summarizedRounds = orderedRounds.map(round =>
        summarizePairedRound(manifest, benchmarkCase.scenarioId, benchmarkCase.backend, round)
    );
    const parityRounds = orderedRounds.map(round =>
        parityRound(scenario.quality.drawCount, frozenCase.pixelHashSha256, round)
    );
    const gates: RHIBenchmarkCandidateMetricGate[] = [];
    for (const metric of RHI_BENCHMARK_METRICS) {
        gates.push(
            evaluatePairedSignificance(
                manifest,
                benchmarkCase.scenarioId,
                benchmarkCase.backend,
                summarizedRounds,
                metric,
                'median'
            )
        );
    }
    for (const hardCap of RHI_BENCHMARK_HARD_CAPS) {
        if (!rhiBenchmarkHardCapApplies(hardCap, benchmarkCase.scenarioId, benchmarkCase.backend)) {
            continue;
        }
        const referenceValue = frozenMetric(frozenCase, hardCap);
        gates.push(
            evaluateFrozenHardCap(
                hardCap.id,
                'candidate-hard-cap',
                'rhi-v2',
                hardCap,
                referenceValue,
                aggregateMetric(summarizedRounds, 'rhi-v2', hardCap)
            ),
            evaluateFrozenHardCap(
                `legacy-drift:${hardCap.id}`,
                'legacy-drift-hard-cap',
                'current-legacy',
                hardCap,
                referenceValue,
                aggregateMetric(summarizedRounds, 'legacy', hardCap)
            )
        );
    }
    return {
        scenarioId: benchmarkCase.scenarioId,
        backend: benchmarkCase.backend,
        expectedDrawCount: scenario.quality.drawCount,
        frozenPixelHashSha256: frozenCase.pixelHashSha256,
        parityRounds,
        gates,
        passed: parityRounds.every(round => round.passed) && gates.every(gate => gate.passed)
    };
}

/** Build the complete paired report from already verified evidence. */
export function buildRHICandidateGateResult(
    options: RHICandidateGateBuildOptions
): RHIBenchmarkCandidateGateResult {
    const cases = options.pairedRaw.cases.map(benchmarkCase =>
        evaluateCase(options.manifest, options.frozenSummary, benchmarkCase)
    );
    let parityRoundCount = 0;
    let failedParityRoundCount = 0;
    let gateCount = 0;
    let passedGateCount = 0;
    for (const benchmarkCase of cases) {
        parityRoundCount += benchmarkCase.parityRounds.length;
        failedParityRoundCount += benchmarkCase.parityRounds.filter(round => !round.passed).length;
        gateCount += benchmarkCase.gates.length;
        passedGateCount += benchmarkCase.gates.filter(gate => gate.passed).length;
    }
    const failedGateCount = gateCount - passedGateCount;
    const result: RHIBenchmarkCandidateGateResult = {
        schemaVersion: 2,
        suite: 'rhi-v2',
        kind: 'candidate-gate',
        scope: 'performance-and-pixel',
        recoveryGate: 'not-covered-requires-runtime-suite',
        baselineArchitecture: 'legacy',
        candidateArchitecture: 'rhi-v2',
        manifestSha256: options.pairedRaw.manifestSha256,
        environment: options.environment,
        frozenBaseline: options.frozenBaseline,
        pairedCandidate: options.pairedCandidate,
        cases,
        summary: {
            caseCount: cases.length,
            parityRoundCount,
            failedParityRoundCount,
            gateCount,
            passedGateCount,
            failedGateCount
        },
        passed: failedParityRoundCount === 0 && failedGateCount === 0
    };
    // Fail if an implementation accidentally reintroduces Infinity/NaN into the JSON contract.
    canonicalRHIJson(result);
    return result;
}

function exactEnvironment(
    actual: RHIBenchmarkEnvironment,
    expected: RHIBenchmarkEnvironment,
    context: string
): void {
    if (canonicalRHIJson(actual) !== canonicalRHIJson(expected)) {
        candidateFailure(`${context} differs from the audited environment`);
    }
}

/** Verify the frozen trust anchor and current paired capture before evaluating any metric. */
export function evaluateRHICandidateEvidence(
    options: RHICandidateEvidenceOptions
): RHIBenchmarkCandidateGateResult {
    const manifest = options.preflight.manifest;
    if (options.frozenRawBytes[0] !== 0x1f || options.frozenRawBytes[1] !== 0x8b) {
        candidateFailure('frozen legacy raw artifact must remain gzip-compressed');
    }
    const frozenSummary = verifyRHIBaseline(
        manifest,
        options.frozenSummaryValue,
        options.frozenRawBytes
    );
    if (frozenSummary.rawArtifact.path !== 'legacy.raw.json.gz') {
        candidateFailure('frozen summary must reference legacy.raw.json.gz');
    }
    const frozenRaw = verifyRHIRawBenchmarkCapture(
        manifest,
        decodeRHIRawBenchmarkArtifact(options.frozenRawBytes)
    );
    if (
        frozenRaw.commitSha !== frozenSummary.commitSha ||
        frozenRaw.manifestSha256 !== frozenSummary.manifestSha256
    ) {
        candidateFailure('frozen summary and its raw capture identity differ');
    }
    exactEnvironment(frozenRaw.environment, frozenSummary.environment, 'frozen raw capture');
    exactEnvironment(frozenSummary.environment, options.preflight.environment, 'frozen baseline');
    const recomputedSummary = summarizeRHIRawBenchmarkCapture(manifest, frozenRaw, {
        rawArtifact: frozenSummary.rawArtifact
    });
    if (canonicalRHIJson(recomputedSummary) !== canonicalRHIJson(frozenSummary)) {
        candidateFailure('frozen summary statistics do not match its checked raw capture');
    }

    const pairedRaw = verifyRHIRawBenchmarkCapture(
        manifest,
        decodeRHIRawBenchmarkArtifact(options.pairedRawBytes),
        { parityMode: 'candidate-gate' }
    );
    exactEnvironment(pairedRaw.environment, options.preflight.environment, 'paired raw capture');
    if (pairedRaw.productionFixture.sha256 !== options.preflight.productionFixtureSha256) {
        candidateFailure('paired raw capture used a different current production fixture');
    }
    if (pairedRaw.commitSha !== options.currentCommitSha) {
        candidateFailure('paired raw capture commit differs from the current clean source commit');
    }

    return buildRHICandidateGateResult({
        manifest,
        environment: options.preflight.environment,
        frozenSummary,
        pairedRaw,
        frozenBaseline: {
            byteLength: options.frozenRawBytes.byteLength,
            sha256: sha256(options.frozenRawBytes),
            summarySha256: sha256(options.frozenSummaryBytes),
            commitSha: frozenSummary.commitSha,
            capturedAt: frozenSummary.capturedAt,
            productionFixtureSha256: frozenRaw.productionFixture.sha256
        },
        pairedCandidate: {
            byteLength: options.pairedRawBytes.byteLength,
            sha256: sha256(options.pairedRawBytes),
            commitSha: pairedRaw.commitSha,
            capturedAt: pairedRaw.capturedAt,
            productionFixtureSha256: pairedRaw.productionFixture.sha256
        }
    });
}

function pathIsInside(root: string, path: string): boolean {
    const child = relative(root, path);
    return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function resolveRepositoryPath(repositoryRoot: string, path: string): string {
    return isAbsolute(path) ? resolve(path) : resolve(repositoryRoot, path);
}

async function requireCanonicalRegularFile(
    resolvedPath: string,
    expectedPath: string,
    context: string
): Promise<void> {
    if (resolvedPath !== expectedPath) {
        candidateFailure(`${context} must be exactly ${expectedPath}`);
    }
    const [status, canonicalPath] = await Promise.all([
        lstat(resolvedPath),
        realpath(resolvedPath)
    ]).catch((error: unknown) =>
        candidateFailure(
            `${context} cannot be read: ${error instanceof Error ? error.message : String(error)}`
        )
    );
    if (status.isSymbolicLink() || !status.isFile() || canonicalPath !== expectedPath) {
        candidateFailure(`${context} must be a canonical non-symlink regular file`);
    }
}

async function prospectiveCanonicalPath(path: string): Promise<string> {
    const suffix: string[] = [basename(path)];
    let cursor = dirname(path);
    for (;;) {
        try {
            const canonicalParent = await realpath(cursor);
            const status = await lstat(canonicalParent);
            if (!status.isDirectory()) {
                candidateFailure(`candidate output parent is not a directory: ${cursor}`);
            }
            return resolve(canonicalParent, ...suffix);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            const parent = dirname(cursor);
            if (parent === cursor) {
                candidateFailure(`candidate output parent cannot be resolved: ${cursor}`);
            }
            suffix.unshift(basename(cursor));
            cursor = parent;
        }
    }
}

/** Resolve output paths without writes and reject lexical or symlink traversal into baselines. */
export async function resolveRHICandidateOutputPaths(
    repositoryRoot: string,
    jsonPath: string,
    markdownPath: string
): Promise<RHICandidateOutputPaths> {
    const canonicalRepositoryRoot = await realpath(resolve(repositoryRoot));
    const baselineRoot = resolve(canonicalRepositoryRoot, 'benchmarks/rhi-v2/baselines');
    const resolvedJson = resolveRepositoryPath(canonicalRepositoryRoot, jsonPath);
    const resolvedMarkdown = resolveRepositoryPath(canonicalRepositoryRoot, markdownPath);
    const [canonicalJson, canonicalMarkdown] = await Promise.all([
        prospectiveCanonicalPath(resolvedJson),
        prospectiveCanonicalPath(resolvedMarkdown)
    ]);
    if (resolvedJson === resolvedMarkdown || canonicalJson === canonicalMarkdown) {
        candidateFailure('candidate gate JSON and Markdown outputs must be different files');
    }
    if (
        pathIsInside(baselineRoot, resolvedJson) ||
        pathIsInside(baselineRoot, resolvedMarkdown) ||
        pathIsInside(baselineRoot, canonicalJson) ||
        pathIsInside(baselineRoot, canonicalMarkdown)
    ) {
        candidateFailure('candidate gate outputs may not modify the immutable baseline directory');
    }
    return { jsonPath: canonicalJson, markdownPath: canonicalMarkdown };
}

/** Resolve only the immutable, canonical baseline enrolled for this manifest rig. */
export async function resolveRHICandidateBaselinePaths(
    repositoryRoot: string,
    rigProfile: string,
    frozenSummaryPath: string
): Promise<RHICandidateBaselinePaths> {
    const canonicalRepositoryRoot = await realpath(resolve(repositoryRoot));
    const baselineRoot = resolve(canonicalRepositoryRoot, 'benchmarks/rhi-v2/baselines');
    const baselineDirectory = resolve(baselineRoot, rigProfile);
    const child = relative(baselineRoot, baselineDirectory);
    if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
        candidateFailure('manifest rig profile escapes the immutable baseline directory');
    }
    const summaryPath = resolve(baselineDirectory, 'legacy.summary.json');
    const rawPath = resolve(baselineDirectory, 'legacy.raw.json.gz');
    await requireCanonicalRegularFile(
        resolveRepositoryPath(canonicalRepositoryRoot, frozenSummaryPath),
        summaryPath,
        'frozen legacy summary'
    );
    await requireCanonicalRegularFile(rawPath, rawPath, 'frozen legacy raw artifact');
    return { summaryPath, rawPath };
}

/** Atomically publish both reports without overwriting either destination. */
export async function writeRHICandidateGateArtifacts(
    result: RHIBenchmarkCandidateGateResult,
    jsonPath: string,
    markdownPath: string
): Promise<void> {
    const resolvedJson = resolve(jsonPath);
    const resolvedMarkdown = resolve(markdownPath);
    if (resolvedJson === resolvedMarkdown) {
        throw new Error('candidate gate JSON and Markdown outputs must be different files');
    }
    await Promise.all([
        mkdir(dirname(resolvedJson), { recursive: true }),
        mkdir(dirname(resolvedMarkdown), { recursive: true })
    ]);
    const token = `${String(process.pid)}-${randomUUID()}`;
    const temporaryJson = `${resolvedJson}.tmp-${token}`;
    const temporaryMarkdown = `${resolvedMarkdown}.tmp-${token}`;
    let jsonLinked = false;
    let markdownLinked = false;
    try {
        await writeFile(temporaryJson, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
        await writeFile(temporaryMarkdown, renderRHICandidateGateReport(result), { flag: 'wx' });
        await link(temporaryJson, resolvedJson);
        jsonLinked = true;
        await link(temporaryMarkdown, resolvedMarkdown);
        markdownLinked = true;
    } catch (error) {
        if (markdownLinked) await rm(resolvedMarkdown, { force: true });
        if (jsonLinked) await rm(resolvedJson, { force: true });
        throw error;
    } finally {
        await Promise.all([
            rm(temporaryJson, { force: true }),
            rm(temporaryMarkdown, { force: true })
        ]);
    }
}

function parseJson(bytes: Uint8Array, context: string): unknown {
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
        throw new Error(`${context} is not valid JSON`, { cause: error });
    }
}

/** Guard, verify, evaluate, and publish one candidate report. No output opens before verification. */
export async function runRHICandidateGate(
    options: RHICandidateGateRunOptions,
    dependencies: RHICandidateGateRunDependencies = {}
): Promise<RHIBenchmarkCandidateGateResult> {
    const repositoryRoot = resolve(options.repositoryRoot);
    const outputPaths = await resolveRHICandidateOutputPaths(
        repositoryRoot,
        options.jsonOutputPath,
        options.markdownOutputPath
    );
    const preflight = await (dependencies.preflight ?? assertRHIPhase0Preflight)({
        repositoryRoot,
        manifestValue: options.manifestValue,
        environmentValue: options.environmentValue
    });
    const baselinePaths = await resolveRHICandidateBaselinePaths(
        repositoryRoot,
        preflight.manifest.rig.profile,
        options.frozenSummaryPath
    );
    const auditedCommit = dependencies.auditedCommit ?? auditedRHIBenchmarkCommit;
    const currentCommitSha = await auditedCommit(repositoryRoot);
    const [pairedRawBytes, frozenSummaryBytes, frozenRawBytes] = await Promise.all([
        readFile(resolveRepositoryPath(repositoryRoot, options.pairedRawPath)),
        readFile(baselinePaths.summaryPath),
        readFile(baselinePaths.rawPath)
    ]);
    const result = evaluateRHICandidateEvidence({
        preflight,
        frozenSummaryValue: parseJson(frozenSummaryBytes, 'frozen legacy summary'),
        frozenSummaryBytes,
        frozenRawBytes,
        pairedRawBytes,
        currentCommitSha
    });
    if ((await auditedCommit(repositoryRoot)) !== currentCommitSha) {
        candidateFailure(
            'source commit or clean-worktree state changed during candidate evaluation'
        );
    }
    await writeRHICandidateGateArtifacts(result, outputPaths.jsonPath, outputPaths.markdownPath);
    return result;
}

async function main(): Promise<void> {
    const pairedRawArgument = process.argv[2];
    const frozenSummaryArgument = process.argv[3];
    const jsonOutputArgument = process.argv[4];
    const markdownOutputArgument = process.argv[5];
    if (
        !pairedRawArgument ||
        !frozenSummaryArgument ||
        !jsonOutputArgument ||
        !markdownOutputArgument
    ) {
        throw new Error(
            'Usage: npm run benchmark:rhi:gate -- <paired.raw.json[.gz]> <frozen-legacy.summary.json> <gate.json> <report.md>'
        );
    }
    const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const manifestPath = resolve(repositoryRoot, 'benchmarks/rhi-v2/manifest.json');
    const [manifestSource, environmentValue] = await Promise.all([
        readFile(manifestPath, 'utf8'),
        readRHIPhase0EnvironmentFile()
    ]);
    const manifestValue = JSON.parse(manifestSource) as unknown;
    const result = await runRHICandidateGate({
        repositoryRoot,
        manifestValue,
        environmentValue,
        pairedRawPath: pairedRawArgument,
        frozenSummaryPath: frozenSummaryArgument,
        jsonOutputPath: jsonOutputArgument,
        markdownOutputPath: markdownOutputArgument
    });
    if (!result.passed) process.exitCode = 1;
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) await main();
