import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RHI_BENCHMARK_BACKENDS,
    RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES,
    RHI_BENCHMARK_CACHE_HIT_METRICS,
    RHI_BENCHMARK_METRICS,
    RHI_BENCHMARK_SCENARIO_IDS,
    rhiBenchmarkMetricSampleCount,
    type RHIBenchmarkBaselineResult,
    type RHIBenchmarkCaseResult,
    type RHIBenchmarkConfidenceInterval,
    type RHIBenchmarkDistribution,
    type RHIBenchmarkEnvironment,
    type RHIBenchmarkManifest,
    type RHIBenchmarkQuality,
    type RHIBenchmarkRawArtifact,
    type RHIBenchmarkRigManifest,
    type RHIBenchmarkRoundMetrics,
    type RHIBenchmarkRoundResult,
    type RHIBenchmarkSamplingManifest,
    type RHIBenchmarkScenarioId,
    type RHIBenchmarkScenarioManifest
} from '../../benchmarks/rhi/result-schema';
import { deriveRHIBenchmarkBootstrapSeed } from './rhi-benchmark-statistics';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
const REQUIRED_RUNNER_TAGS = ['self-hosted', 'linux', 'gpu', 'rhi-perf'] as const;
const QUALITY_KEYS = [
    'width',
    'height',
    'devicePixelRatio',
    'cameraId',
    'drawCount',
    'instanceCount',
    'shaderVariantCount',
    'textureCount',
    'lightCount',
    'shadowMapSize',
    'mrtColorAttachments',
    'msaaSampleCount',
    'postProcessPassCount',
    'dynamicUploadBytesPerFrame',
    'churnFrames'
] as const;

function failure(message: string): never {
    throw new Error(`Invalid RHI benchmark baseline: ${message}`);
}

function record(value: unknown, context: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        failure(`${context} must be an object`);
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
        failure(
            `${context} keys must be exactly ${required.join(', ')}; received ${actual.join(', ')}`
        );
    }
}

function stringValue(value: unknown, context: string): string {
    if (typeof value !== 'string' || value.length === 0) failure(`${context} must be non-empty`);
    return value;
}

function booleanValue(value: unknown, context: string): boolean {
    if (typeof value !== 'boolean') failure(`${context} must be boolean`);
    return value;
}

function finiteNumber(value: unknown, context: string, minimum = 0): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        failure(`${context} must be a finite number >= ${String(minimum)}`);
    }
    return value;
}

function safeInteger(value: unknown, context: string, minimum = 0): number {
    const number = finiteNumber(value, context, minimum);
    if (!Number.isSafeInteger(number)) failure(`${context} must be a safe integer`);
    return number;
}

function stringArray(value: unknown, context: string): readonly string[] {
    if (!Array.isArray(value)) failure(`${context} must be an array`);
    const entries = value.map((entry, index) => stringValue(entry, `${context}[${String(index)}]`));
    if (new Set(entries).size !== entries.length) failure(`${context} must not contain duplicates`);
    return entries;
}

function sha256Value(value: unknown, context: string): string {
    const hash = stringValue(value, context);
    if (!SHA256_PATTERN.test(hash)) failure(`${context} must be a lowercase SHA-256 digest`);
    return hash;
}

export function canonicalRHIJson(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) failure('canonical JSON cannot contain a non-finite number');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(item => canonicalRHIJson(item)).join(',')}]`;
    const object = record(value, 'canonical JSON value');
    return `{${Object.keys(object)
        .sort()
        .map(key => `${JSON.stringify(key)}:${canonicalRHIJson(object[key])}`)
        .join(',')}}`;
}

export function sha256(bytes: string | Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/** Digest every stable runner/browser identity field; the supplied digest is never trusted. */
export function rhiBenchmarkEnvironmentFingerprint(environment: RHIBenchmarkEnvironment): string {
    return sha256(
        canonicalRHIJson({
            rigProfile: environment.rigProfile,
            runnerTags: [...environment.runnerTags].sort(),
            osPlatform: environment.osPlatform,
            osRelease: environment.osRelease,
            cpuModel: environment.cpuModel,
            gpuFingerprint: environment.gpuFingerprint,
            gpuDriver: environment.gpuDriver,
            browserName: environment.browserName,
            browserVersion: environment.browserVersion,
            browserExecutableSha256: environment.browserExecutableSha256,
            playwrightVersion: environment.playwrightVersion,
            nodeVersion: environment.nodeVersion,
            powerProfile: environment.powerProfile
        })
    );
}

export function manifestSha256(manifest: RHIBenchmarkManifest): string {
    return sha256(canonicalRHIJson(manifest));
}

function parseSampling(value: unknown): RHIBenchmarkSamplingManifest {
    const sampling = record(value, 'manifest.sampling');
    exactKeys(
        sampling,
        [
            'warmupFrames',
            'sampleFrames',
            'allocationSampleFrames',
            'rounds',
            'bootstrapSeed',
            'bootstrapIterations',
            'confidenceLevel'
        ],
        'manifest.sampling'
    );
    const parsed = {
        warmupFrames: safeInteger(sampling['warmupFrames'], 'manifest.sampling.warmupFrames', 1),
        sampleFrames: safeInteger(sampling['sampleFrames'], 'manifest.sampling.sampleFrames', 1),
        allocationSampleFrames: safeInteger(
            sampling['allocationSampleFrames'],
            'manifest.sampling.allocationSampleFrames',
            1
        ),
        rounds: safeInteger(sampling['rounds'], 'manifest.sampling.rounds', 1),
        bootstrapSeed: safeInteger(sampling['bootstrapSeed'], 'manifest.sampling.bootstrapSeed', 1),
        bootstrapIterations: safeInteger(
            sampling['bootstrapIterations'],
            'manifest.sampling.bootstrapIterations',
            1
        ),
        confidenceLevel: finiteNumber(
            sampling['confidenceLevel'],
            'manifest.sampling.confidenceLevel'
        )
    };
    if (parsed.warmupFrames !== 300) failure('warmupFrames must remain frozen at 300');
    if (parsed.sampleFrames !== 2000) failure('sampleFrames must remain frozen at 2000');
    if (parsed.allocationSampleFrames !== RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES) {
        failure(
            `allocationSampleFrames must remain frozen at ${String(RHI_BENCHMARK_ALLOCATION_SAMPLE_FRAMES)}`
        );
    }
    if (parsed.rounds !== 7) failure('rounds must remain frozen at 7');
    if (parsed.bootstrapIterations !== 10_000) {
        failure('bootstrapIterations must remain frozen at 10000');
    }
    if (parsed.confidenceLevel !== 0.95) {
        failure('confidenceLevel must remain frozen at 0.95');
    }
    return parsed;
}

function parseRig(value: unknown): RHIBenchmarkRigManifest {
    const rig = record(value, 'manifest.rig');
    exactKeys(
        rig,
        [
            'profile',
            'requiredRunnerTags',
            'osPlatform',
            'browserName',
            'playwrightVersion',
            'nodeVersion',
            'powerProfile',
            'requireNonFallbackAdapter',
            'requireGpuTimer',
            'requireAllocationProfiler',
            'requirePreciseMemory',
            'acceptedFingerprintSha256'
        ],
        'manifest.rig'
    );
    const requiredRunnerTags = stringArray(
        rig['requiredRunnerTags'],
        'manifest.rig.requiredRunnerTags'
    );
    for (const required of REQUIRED_RUNNER_TAGS) {
        if (!requiredRunnerTags.includes(required)) {
            failure(`manifest.rig.requiredRunnerTags must include ${required}`);
        }
    }
    if (!Array.isArray(rig['acceptedFingerprintSha256'])) {
        failure('manifest.rig.acceptedFingerprintSha256 must be an array');
    }
    const acceptedFingerprintSha256 = rig['acceptedFingerprintSha256'].map((entry, index) =>
        sha256Value(entry, `manifest.rig.acceptedFingerprintSha256[${String(index)}]`)
    );
    if (new Set(acceptedFingerprintSha256).size !== acceptedFingerprintSha256.length) {
        failure('manifest.rig.acceptedFingerprintSha256 must not contain duplicates');
    }
    const parsed = {
        profile: stringValue(rig['profile'], 'manifest.rig.profile'),
        requiredRunnerTags,
        osPlatform: stringValue(rig['osPlatform'], 'manifest.rig.osPlatform'),
        browserName: stringValue(rig['browserName'], 'manifest.rig.browserName'),
        playwrightVersion: stringValue(rig['playwrightVersion'], 'manifest.rig.playwrightVersion'),
        nodeVersion: stringValue(rig['nodeVersion'], 'manifest.rig.nodeVersion'),
        powerProfile: stringValue(rig['powerProfile'], 'manifest.rig.powerProfile'),
        requireNonFallbackAdapter: booleanValue(
            rig['requireNonFallbackAdapter'],
            'manifest.rig.requireNonFallbackAdapter'
        ),
        requireGpuTimer: booleanValue(rig['requireGpuTimer'], 'manifest.rig.requireGpuTimer'),
        requireAllocationProfiler: booleanValue(
            rig['requireAllocationProfiler'],
            'manifest.rig.requireAllocationProfiler'
        ),
        requirePreciseMemory: booleanValue(
            rig['requirePreciseMemory'],
            'manifest.rig.requirePreciseMemory'
        ),
        acceptedFingerprintSha256
    };
    if (parsed.osPlatform !== 'linux') failure('manifest.rig.osPlatform must remain linux');
    if (parsed.browserName !== 'chromium') {
        failure('manifest.rig.browserName must remain chromium');
    }
    if (parsed.powerProfile !== 'fixed-performance') {
        failure('manifest.rig.powerProfile must remain fixed-performance');
    }
    if (
        !parsed.requireNonFallbackAdapter ||
        !parsed.requireGpuTimer ||
        !parsed.requireAllocationProfiler ||
        !parsed.requirePreciseMemory
    ) {
        failure('manifest.rig performance capability requirements must not be weakened');
    }
    return parsed;
}

function parseQuality(value: unknown, context: string): RHIBenchmarkQuality {
    const quality = record(value, context);
    exactKeys(quality, QUALITY_KEYS, context);
    return {
        width: safeInteger(quality['width'], `${context}.width`, 1),
        height: safeInteger(quality['height'], `${context}.height`, 1),
        devicePixelRatio: finiteNumber(
            quality['devicePixelRatio'],
            `${context}.devicePixelRatio`,
            Number.EPSILON
        ),
        cameraId: stringValue(quality['cameraId'], `${context}.cameraId`),
        drawCount: safeInteger(quality['drawCount'], `${context}.drawCount`, 1),
        instanceCount: safeInteger(quality['instanceCount'], `${context}.instanceCount`, 1),
        shaderVariantCount: safeInteger(
            quality['shaderVariantCount'],
            `${context}.shaderVariantCount`,
            1
        ),
        textureCount: safeInteger(quality['textureCount'], `${context}.textureCount`),
        lightCount: safeInteger(quality['lightCount'], `${context}.lightCount`),
        shadowMapSize: safeInteger(quality['shadowMapSize'], `${context}.shadowMapSize`),
        mrtColorAttachments: safeInteger(
            quality['mrtColorAttachments'],
            `${context}.mrtColorAttachments`,
            1
        ),
        msaaSampleCount: safeInteger(quality['msaaSampleCount'], `${context}.msaaSampleCount`, 1),
        postProcessPassCount: safeInteger(
            quality['postProcessPassCount'],
            `${context}.postProcessPassCount`
        ),
        dynamicUploadBytesPerFrame: safeInteger(
            quality['dynamicUploadBytesPerFrame'],
            `${context}.dynamicUploadBytesPerFrame`
        ),
        churnFrames: safeInteger(quality['churnFrames'], `${context}.churnFrames`)
    };
}

function parseScenario(value: unknown, index: number): RHIBenchmarkScenarioManifest {
    const context = `manifest.scenarios[${String(index)}]`;
    const scenario = record(value, context);
    exactKeys(scenario, ['id', 'purpose', 'quality'], context);
    const id = stringValue(scenario['id'], `${context}.id`);
    if (!(RHI_BENCHMARK_SCENARIO_IDS as readonly string[]).includes(id)) {
        failure(`${context}.id is not a required RHI benchmark scenario`);
    }
    return {
        id: id as RHIBenchmarkScenarioId,
        purpose: stringValue(scenario['purpose'], `${context}.purpose`),
        quality: parseQuality(scenario['quality'], `${context}.quality`)
    };
}

export function parseRHIBenchmarkManifest(value: unknown): RHIBenchmarkManifest {
    const manifest = record(value, 'manifest');
    exactKeys(
        manifest,
        ['schemaVersion', 'suite', 'architecture', 'backends', 'sampling', 'rig', 'scenarios'],
        'manifest'
    );
    if (manifest['schemaVersion'] !== 3) failure('manifest.schemaVersion must equal 3');
    if (manifest['suite'] !== 'rhi') failure('manifest.suite must equal rhi');
    if (manifest['architecture'] !== 'rhi') failure('manifest.architecture must equal rhi');
    if (!Array.isArray(manifest['backends'])) failure('manifest.backends must be an array');
    if (
        manifest['backends'].length !== RHI_BENCHMARK_BACKENDS.length ||
        manifest['backends'].some((backend, index) => backend !== RHI_BENCHMARK_BACKENDS[index])
    ) {
        failure('manifest.backends must be exactly webgl2, webgpu');
    }
    if (!Array.isArray(manifest['scenarios'])) failure('manifest.scenarios must be an array');
    const scenarios = manifest['scenarios'].map(parseScenario);
    const scenarioIds = scenarios.map(scenario => scenario.id);
    if (
        scenarioIds.length !== RHI_BENCHMARK_SCENARIO_IDS.length ||
        new Set(scenarioIds).size !== scenarioIds.length ||
        RHI_BENCHMARK_SCENARIO_IDS.some(id => !scenarioIds.includes(id))
    ) {
        failure('manifest.scenarios must contain each of the 10 required scenarios exactly once');
    }
    return {
        schemaVersion: 3,
        suite: 'rhi',
        architecture: 'rhi',
        backends: RHI_BENCHMARK_BACKENDS,
        sampling: parseSampling(manifest['sampling']),
        rig: parseRig(manifest['rig']),
        scenarios
    };
}

export function parseRHIBenchmarkEnvironment(value: unknown): RHIBenchmarkEnvironment {
    const environment = record(value, 'baseline.environment');
    exactKeys(
        environment,
        [
            'rigProfile',
            'runnerTags',
            'fingerprintSha256',
            'osPlatform',
            'osRelease',
            'cpuModel',
            'gpuFingerprint',
            'gpuDriver',
            'browserName',
            'browserVersion',
            'browserExecutableSha256',
            'playwrightVersion',
            'nodeVersion',
            'powerProfile',
            'fallbackAdapter',
            'gpuTimerAvailable',
            'allocationProfilerAvailable',
            'preciseMemoryAvailable'
        ],
        'baseline.environment'
    );
    const browserExecutableSha256 = sha256Value(
        environment['browserExecutableSha256'],
        'baseline.environment.browserExecutableSha256'
    );
    if (/^0{64}$/u.test(browserExecutableSha256)) {
        failure('baseline.environment.browserExecutableSha256 must not be a placeholder');
    }
    return {
        rigProfile: stringValue(environment['rigProfile'], 'baseline.environment.rigProfile'),
        runnerTags: stringArray(environment['runnerTags'], 'baseline.environment.runnerTags'),
        fingerprintSha256: sha256Value(
            environment['fingerprintSha256'],
            'baseline.environment.fingerprintSha256'
        ),
        osPlatform: stringValue(environment['osPlatform'], 'baseline.environment.osPlatform'),
        osRelease: stringValue(environment['osRelease'], 'baseline.environment.osRelease'),
        cpuModel: stringValue(environment['cpuModel'], 'baseline.environment.cpuModel'),
        gpuFingerprint: stringValue(
            environment['gpuFingerprint'],
            'baseline.environment.gpuFingerprint'
        ),
        gpuDriver: stringValue(environment['gpuDriver'], 'baseline.environment.gpuDriver'),
        browserName: stringValue(environment['browserName'], 'baseline.environment.browserName'),
        browserVersion: stringValue(
            environment['browserVersion'],
            'baseline.environment.browserVersion'
        ),
        browserExecutableSha256,
        playwrightVersion: stringValue(
            environment['playwrightVersion'],
            'baseline.environment.playwrightVersion'
        ),
        nodeVersion: stringValue(environment['nodeVersion'], 'baseline.environment.nodeVersion'),
        powerProfile: stringValue(environment['powerProfile'], 'baseline.environment.powerProfile'),
        fallbackAdapter: booleanValue(
            environment['fallbackAdapter'],
            'baseline.environment.fallbackAdapter'
        ),
        gpuTimerAvailable: booleanValue(
            environment['gpuTimerAvailable'],
            'baseline.environment.gpuTimerAvailable'
        ),
        allocationProfilerAvailable: booleanValue(
            environment['allocationProfilerAvailable'],
            'baseline.environment.allocationProfilerAvailable'
        ),
        preciseMemoryAvailable: booleanValue(
            environment['preciseMemoryAvailable'],
            'baseline.environment.preciseMemoryAvailable'
        )
    };
}

export function verifyRHIBenchmarkEnvironment(
    expected: RHIBenchmarkRigManifest,
    actual: RHIBenchmarkEnvironment
): void {
    if (expected.acceptedFingerprintSha256.length === 0) {
        failure('manifest has no enrolled physical-rig fingerprint');
    }
    if (!expected.acceptedFingerprintSha256.includes(actual.fingerprintSha256)) {
        failure('environment fingerprint is not enrolled by the rig manifest');
    }
    if (actual.fingerprintSha256 !== rhiBenchmarkEnvironmentFingerprint(actual)) {
        failure('environment fingerprint does not match its runner and Chromium identity fields');
    }
    if (actual.rigProfile !== expected.profile) failure('environment rig profile mismatch');
    for (const tag of expected.requiredRunnerTags) {
        if (!actual.runnerTags.includes(tag)) failure(`environment is missing runner tag ${tag}`);
    }
    if (actual.osPlatform !== expected.osPlatform) failure('environment OS mismatch');
    if (actual.browserName !== expected.browserName) failure('environment browser mismatch');
    if (actual.playwrightVersion !== expected.playwrightVersion) {
        failure('environment Playwright version mismatch');
    }
    if (actual.nodeVersion !== expected.nodeVersion) failure('environment Node version mismatch');
    if (actual.powerProfile !== expected.powerProfile) {
        failure('environment power profile mismatch');
    }
    if (expected.requireNonFallbackAdapter && actual.fallbackAdapter) {
        failure('environment uses a fallback GPU adapter');
    }
    if (expected.requireGpuTimer && !actual.gpuTimerAvailable) {
        failure('GPU timer metric is unavailable');
    }
    if (expected.requireAllocationProfiler && !actual.allocationProfilerAvailable) {
        failure('allocation profiler metric is unavailable');
    }
    if (expected.requirePreciseMemory && !actual.preciseMemoryAvailable) {
        failure('precise retained-heap metric is unavailable');
    }
}

function parseConfidenceInterval(
    value: unknown,
    context: string,
    sampling: RHIBenchmarkSamplingManifest,
    expectedBootstrapSeed: number
): RHIBenchmarkConfidenceInterval {
    const interval = record(value, context);
    exactKeys(
        interval,
        ['low', 'high', 'confidenceLevel', 'bootstrapIterations', 'bootstrapSeed'],
        context
    );
    const parsed = {
        low: finiteNumber(interval['low'], `${context}.low`),
        high: finiteNumber(interval['high'], `${context}.high`),
        confidenceLevel: finiteNumber(interval['confidenceLevel'], `${context}.confidenceLevel`),
        bootstrapIterations: safeInteger(
            interval['bootstrapIterations'],
            `${context}.bootstrapIterations`,
            1
        ),
        bootstrapSeed: safeInteger(interval['bootstrapSeed'], `${context}.bootstrapSeed`, 1)
    };
    if (parsed.low > parsed.high) failure(`${context} low must not exceed high`);
    if (parsed.confidenceLevel !== sampling.confidenceLevel) {
        failure(`${context} confidence level differs from the manifest`);
    }
    if (parsed.bootstrapIterations !== sampling.bootstrapIterations) {
        failure(`${context} bootstrap iteration count differs from the manifest`);
    }
    if (parsed.bootstrapSeed !== expectedBootstrapSeed) {
        failure(`${context} bootstrap seed differs from the deterministic case seed`);
    }
    return parsed;
}

function parseDistribution(
    value: unknown,
    context: string,
    sampling: RHIBenchmarkSamplingManifest,
    expectedSampleCount: number,
    expectedBootstrapSeed: number
): RHIBenchmarkDistribution {
    const distribution = record(value, context);
    exactKeys(
        distribution,
        [
            'sampleCount',
            'minimum',
            'maximum',
            'median',
            'p50',
            'p95',
            'p99',
            'mad',
            'coefficientOfVariation',
            'confidenceInterval'
        ],
        context
    );
    const parsed = {
        sampleCount: safeInteger(distribution['sampleCount'], `${context}.sampleCount`, 1),
        minimum: finiteNumber(distribution['minimum'], `${context}.minimum`),
        maximum: finiteNumber(distribution['maximum'], `${context}.maximum`),
        median: finiteNumber(distribution['median'], `${context}.median`),
        p50: finiteNumber(distribution['p50'], `${context}.p50`),
        p95: finiteNumber(distribution['p95'], `${context}.p95`),
        p99: finiteNumber(distribution['p99'], `${context}.p99`),
        mad: finiteNumber(distribution['mad'], `${context}.mad`),
        coefficientOfVariation: finiteNumber(
            distribution['coefficientOfVariation'],
            `${context}.coefficientOfVariation`
        ),
        confidenceInterval: parseConfidenceInterval(
            distribution['confidenceInterval'],
            `${context}.confidenceInterval`,
            sampling,
            expectedBootstrapSeed
        )
    };
    if (parsed.sampleCount !== expectedSampleCount) {
        failure(`${context} must summarize exactly ${String(expectedSampleCount)} samples`);
    }
    if (
        parsed.minimum > parsed.p50 ||
        parsed.p50 !== parsed.median ||
        parsed.p50 > parsed.p95 ||
        parsed.p95 > parsed.p99 ||
        parsed.p99 > parsed.maximum
    ) {
        failure(`${context} percentiles are inconsistent`);
    }
    if (
        parsed.confidenceInterval.low > parsed.median ||
        parsed.confidenceInterval.high < parsed.median
    ) {
        failure(`${context} confidence interval must contain the median`);
    }
    return parsed;
}

function parseMetrics(
    value: unknown,
    context: string,
    sampling: RHIBenchmarkSamplingManifest,
    scenarioId: string,
    backend: string,
    roundNumber: number
): RHIBenchmarkRoundMetrics {
    const metrics = record(value, context);
    exactKeys(metrics, RHI_BENCHMARK_METRICS, context);
    const parsed: Partial<
        Record<(typeof RHI_BENCHMARK_METRICS)[number], RHIBenchmarkDistribution>
    > = {};
    for (const metric of RHI_BENCHMARK_METRICS) {
        const expectedSampleCount = rhiBenchmarkMetricSampleCount(metric, sampling);
        const distribution = parseDistribution(
            metrics[metric],
            `${context}.${metric}`,
            sampling,
            expectedSampleCount,
            deriveRHIBenchmarkBootstrapSeed(
                sampling.bootstrapSeed,
                scenarioId,
                backend,
                roundNumber,
                'rhi',
                metric
            )
        );
        if (
            (RHI_BENCHMARK_CACHE_HIT_METRICS as readonly string[]).includes(metric) &&
            distribution.maximum > 1
        ) {
            failure(`${context}.${metric} must stay between zero and one`);
        }
        parsed[metric] = distribution;
    }
    return parsed as RHIBenchmarkRoundMetrics;
}

function parseRound(
    value: unknown,
    context: string,
    sampling: RHIBenchmarkSamplingManifest,
    scenarioId: string,
    backend: string
): RHIBenchmarkRoundResult {
    const round = record(value, context);
    exactKeys(round, ['round', 'sampleCount', 'orderPosition', 'metrics'], context);
    const roundNumber = safeInteger(round['round'], `${context}.round`, 1);
    const parsed = {
        round: roundNumber,
        sampleCount: safeInteger(round['sampleCount'], `${context}.sampleCount`, 1),
        orderPosition: safeInteger(round['orderPosition'], `${context}.orderPosition`),
        metrics: parseMetrics(
            round['metrics'],
            `${context}.metrics`,
            sampling,
            scenarioId,
            backend,
            roundNumber
        )
    };
    if (parsed.sampleCount !== sampling.sampleFrames) {
        failure(`${context}.sampleCount differs from the manifest`);
    }
    if (parsed.orderPosition !== 0) failure(`${context}.orderPosition must equal 0`);
    return parsed;
}

function parseCase(
    value: unknown,
    index: number,
    manifest: RHIBenchmarkManifest
): RHIBenchmarkCaseResult {
    const context = `baseline.cases[${String(index)}]`;
    const benchmarkCase = record(value, context);
    exactKeys(
        benchmarkCase,
        ['scenarioId', 'backend', 'quality', 'observedDrawCount', 'pixelHashSha256', 'rounds'],
        context
    );
    const scenarioId = stringValue(benchmarkCase['scenarioId'], `${context}.scenarioId`);
    if (!(RHI_BENCHMARK_SCENARIO_IDS as readonly string[]).includes(scenarioId)) {
        failure(`${context}.scenarioId is unknown`);
    }
    const backend = stringValue(benchmarkCase['backend'], `${context}.backend`);
    if (!(RHI_BENCHMARK_BACKENDS as readonly string[]).includes(backend)) {
        failure(`${context}.backend is unknown`);
    }
    const quality = parseQuality(benchmarkCase['quality'], `${context}.quality`);
    const expectedScenario = manifest.scenarios.find(scenario => scenario.id === scenarioId);
    if (!expectedScenario) failure(`${context} has no matching manifest scenario`);
    if (canonicalRHIJson(quality) !== canonicalRHIJson(expectedScenario.quality)) {
        failure(`${context}.quality differs from the fixed manifest quality`);
    }
    const observedDrawCount = safeInteger(
        benchmarkCase['observedDrawCount'],
        `${context}.observedDrawCount`,
        1
    );
    if (observedDrawCount !== quality.drawCount) {
        failure(`${context}.observedDrawCount differs from the fixed draw count`);
    }
    if (!Array.isArray(benchmarkCase['rounds'])) failure(`${context}.rounds must be an array`);
    const rounds = benchmarkCase['rounds'].map((round, roundIndex) =>
        parseRound(
            round,
            `${context}.rounds[${String(roundIndex)}]`,
            manifest.sampling,
            scenarioId,
            backend
        )
    );
    if (rounds.length !== manifest.sampling.rounds) {
        failure(`${context} must contain exactly ${String(manifest.sampling.rounds)} rounds`);
    }
    for (const round of rounds) {
        const draws = round.metrics.actualDrawCount;
        if (draws.minimum !== observedDrawCount || draws.maximum !== observedDrawCount) {
            failure(`${context}.rounds actualDrawCount must equal observedDrawCount`);
        }
    }
    const roundNumbers = rounds.map(round => round.round);
    for (let expectedRound = 1; expectedRound <= manifest.sampling.rounds; expectedRound++) {
        if (roundNumbers.filter(round => round === expectedRound).length !== 1) {
            failure(`${context} must contain round ${String(expectedRound)} exactly once`);
        }
    }
    return {
        scenarioId: scenarioId as RHIBenchmarkScenarioId,
        backend: backend === 'webgl2' ? 'webgl2' : 'webgpu',
        quality,
        observedDrawCount,
        pixelHashSha256: sha256Value(
            benchmarkCase['pixelHashSha256'],
            `${context}.pixelHashSha256`
        ),
        rounds
    };
}

function parseRawArtifact(value: unknown): RHIBenchmarkRawArtifact {
    const artifact = record(value, 'baseline.rawArtifact');
    exactKeys(artifact, ['path', 'byteLength', 'sha256'], 'baseline.rawArtifact');
    const path = stringValue(artifact['path'], 'baseline.rawArtifact.path');
    const normalizedPath = normalize(path);
    if (
        isAbsolute(path) ||
        normalizedPath === '..' ||
        normalizedPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    ) {
        failure('baseline.rawArtifact.path must stay inside the summary directory');
    }
    return {
        path,
        byteLength: safeInteger(artifact['byteLength'], 'baseline.rawArtifact.byteLength', 1),
        sha256: sha256Value(artifact['sha256'], 'baseline.rawArtifact.sha256')
    };
}

function parseBaseline(value: unknown, manifest: RHIBenchmarkManifest): RHIBenchmarkBaselineResult {
    const baseline = record(value, 'baseline');
    exactKeys(
        baseline,
        [
            'schemaVersion',
            'suite',
            'architecture',
            'manifestSha256',
            'commitSha',
            'capturedAt',
            'environment',
            'rawArtifact',
            'cases'
        ],
        'baseline'
    );
    if (baseline['schemaVersion'] !== 3) failure('baseline.schemaVersion must equal 3');
    if (baseline['suite'] !== 'rhi') failure('baseline.suite must equal rhi');
    if (baseline['architecture'] !== manifest.architecture) {
        failure('baseline architecture must equal rhi');
    }
    const commitSha = stringValue(baseline['commitSha'], 'baseline.commitSha');
    if (!COMMIT_SHA_PATTERN.test(commitSha)) {
        failure('baseline.commitSha must be a full lowercase Git commit SHA');
    }
    const capturedAt = stringValue(baseline['capturedAt'], 'baseline.capturedAt');
    if (!Number.isFinite(Date.parse(capturedAt))) failure('baseline.capturedAt must be ISO-8601');
    if (!Array.isArray(baseline['cases'])) failure('baseline.cases must be an array');
    const cases = baseline['cases'].map((benchmarkCase, index) =>
        parseCase(benchmarkCase, index, manifest)
    );
    return {
        schemaVersion: 3,
        suite: 'rhi',
        architecture: 'rhi',
        manifestSha256: sha256Value(baseline['manifestSha256'], 'baseline.manifestSha256'),
        commitSha,
        capturedAt,
        environment: parseRHIBenchmarkEnvironment(baseline['environment']),
        rawArtifact: parseRawArtifact(baseline['rawArtifact']),
        cases
    };
}

function verifyCaseMatrix(
    manifest: RHIBenchmarkManifest,
    cases: readonly RHIBenchmarkCaseResult[]
): void {
    const expectedCount = manifest.scenarios.length * manifest.backends.length;
    if (cases.length !== expectedCount) {
        failure(`baseline must contain exactly ${String(expectedCount)} scenario/backend cases`);
    }
    const caseKeys = new Set<string>();
    for (const benchmarkCase of cases) {
        const key = `${benchmarkCase.scenarioId}:${benchmarkCase.backend}`;
        if (caseKeys.has(key)) failure(`baseline contains duplicate case ${key}`);
        caseKeys.add(key);
    }
    for (const scenario of manifest.scenarios) {
        const matching = cases.filter(benchmarkCase => benchmarkCase.scenarioId === scenario.id);
        for (const backend of manifest.backends) {
            if (!caseKeys.has(`${scenario.id}:${backend}`)) {
                failure(`baseline is missing ${scenario.id}:${backend}`);
            }
        }
        const qualityDigests = new Set(matching.map(item => canonicalRHIJson(item.quality)));
        const drawCounts = new Set(matching.map(item => item.observedDrawCount));
        if (qualityDigests.size !== 1) failure(`${scenario.id} backend quality differs`);
        if (drawCounts.size !== 1) failure(`${scenario.id} backend draw count differs`);
    }
}

export function verifyRHIBaseline(
    manifestValue: unknown,
    baselineValue: unknown,
    rawArtifactBytes: Uint8Array
): RHIBenchmarkBaselineResult {
    const manifest = parseRHIBenchmarkManifest(manifestValue);
    const baseline = parseBaseline(baselineValue, manifest);
    if (baseline.manifestSha256 !== manifestSha256(manifest)) {
        failure('baseline manifest checksum does not match the current manifest');
    }
    verifyRHIBenchmarkEnvironment(manifest.rig, baseline.environment);
    verifyCaseMatrix(manifest, baseline.cases);
    if (baseline.rawArtifact.byteLength !== rawArtifactBytes.byteLength) {
        failure('raw artifact byte length does not match the summary');
    }
    if (baseline.rawArtifact.sha256 !== sha256(rawArtifactBytes)) {
        failure('raw artifact checksum does not match the summary');
    }
    return baseline;
}

async function main(): Promise<void> {
    const summaryArgument = process.argv[2];
    if (!summaryArgument) {
        throw new Error(
            'Usage: npm run benchmark:rhi:verify -- <baseline-summary.json> [manifest.json]'
        );
    }
    const summaryPath = resolve(summaryArgument);
    const manifestPath = resolve(
        process.argv[3] ??
            fileURLToPath(new URL('../../benchmarks/rhi/manifest.json', import.meta.url))
    );
    const [manifestSource, summarySource] = await Promise.all([
        readFile(manifestPath, 'utf8'),
        readFile(summaryPath, 'utf8')
    ]);
    const manifest = JSON.parse(manifestSource) as unknown;
    const summary = JSON.parse(summarySource) as unknown;
    const parsedSummary = record(summary, 'baseline');
    const rawArtifact = record(parsedSummary['rawArtifact'], 'baseline.rawArtifact');
    const rawPath = stringValue(rawArtifact['path'], 'baseline.rawArtifact.path');
    const rawBytes = await readFile(resolve(dirname(summaryPath), rawPath));
    const verified = verifyRHIBaseline(manifest, summary, rawBytes);
    console.log(
        `Verified ${String(verified.cases.length)} RHI baseline cases from ${verified.commitSha}`
    );
}

const invokedDirectly = process.argv.some(argument => {
    try {
        return resolve(argument) === fileURLToPath(import.meta.url);
    } catch {
        return false;
    }
});

if (invokedDirectly) await main();
