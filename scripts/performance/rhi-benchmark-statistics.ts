import {
    rhiBenchmarkMetricScope,
    rhiBenchmarkRegressionDirection,
    type RHIBenchmarkConfidenceInterval,
    type RHIBenchmarkDistribution,
    type RHIBenchmarkGateStatistic,
    type RHIBenchmarkHardCap,
    type RHIBenchmarkMetric,
    type RHIBenchmarkRegressionDirection,
    type RendererArchitecture
} from '../../benchmarks/rhi/result-schema';

export interface RHIBenchmarkBootstrapOptions {
    readonly seed: number;
    readonly iterations: number;
    readonly confidenceLevel: number;
}

export interface RHIBenchmarkPairedGateInput extends RHIBenchmarkBootstrapOptions {
    readonly metric: RHIBenchmarkMetric;
    /** One matched per-round value for the selected statistic, in deterministic A/B pair order. */
    readonly baseline: readonly number[];
    readonly candidate: readonly number[];
    readonly statistic?: RHIBenchmarkGateStatistic;
    readonly maximumRegressionFraction?: number;
    readonly absoluteMaximum?: number;
}

export interface RHIBenchmarkPairedGateResult {
    readonly metric: RHIBenchmarkMetric;
    readonly direction: RHIBenchmarkRegressionDirection;
    readonly statistic: RHIBenchmarkGateStatistic;
    readonly pairCount: number;
    readonly baselineValue: number;
    readonly candidateValue: number;
    readonly regressionFraction: number;
    readonly pairedDifferenceConfidenceInterval: RHIBenchmarkConfidenceInterval;
    readonly significantRegression: boolean;
    readonly hardCapExceeded: boolean;
    readonly passed: boolean;
}

export interface RHIBenchmarkHardCapComparisonInput {
    readonly metric: RHIBenchmarkMetric;
    readonly statistic: RHIBenchmarkGateStatistic;
    readonly referenceValue: number;
    readonly comparisonValue: number;
    readonly maximumRegressionFraction?: number;
    readonly absoluteMaximum?: number;
}

export interface RHIBenchmarkHardCapComparisonResult {
    readonly metric: RHIBenchmarkMetric;
    readonly direction: RHIBenchmarkRegressionDirection;
    readonly statistic: RHIBenchmarkGateStatistic;
    readonly referenceValue: number;
    readonly comparisonValue: number;
    readonly regressionFraction: number;
    readonly hardCapExceeded: boolean;
    readonly passed: boolean;
}

function assertFiniteSamples(samples: readonly number[], context: string): void {
    if (samples.length === 0) throw new Error(`${context} must contain at least one sample`);
    for (let index = 0; index < samples.length; index += 1) {
        if (!Number.isFinite(samples[index])) {
            throw new Error(`${context}[${String(index)}] must be finite`);
        }
    }
}

function assertBootstrapOptions(options: RHIBenchmarkBootstrapOptions): void {
    if (!Number.isSafeInteger(options.seed) || options.seed <= 0) {
        throw new Error('bootstrap seed must be a positive safe integer');
    }
    if (!Number.isSafeInteger(options.iterations) || options.iterations <= 0) {
        throw new Error('bootstrap iterations must be a positive safe integer');
    }
    if (
        !Number.isFinite(options.confidenceLevel) ||
        options.confidenceLevel <= 0 ||
        options.confidenceLevel >= 1
    ) {
        throw new Error('bootstrap confidence level must be between zero and one');
    }
}

function sortedSamples(samples: readonly number[]): number[] {
    return [...samples].sort((first, second) => first - second);
}

/** Deterministic R-7 quantile, matching the common linear percentile definition. */
export function rhiBenchmarkQuantile(sorted: readonly number[], probability: number): number {
    assertFiniteSamples(sorted, 'sorted samples');
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error('quantile probability must be between zero and one');
    }
    const position = (sorted.length - 1) * probability;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lower = sorted[lowerIndex];
    const upper = sorted[upperIndex];
    if (lower === undefined || upper === undefined) throw new Error('quantile index is invalid');
    return lower + (upper - lower) * (position - lowerIndex);
}

export function rhiBenchmarkMedian(samples: readonly number[]): number {
    assertFiniteSamples(samples, 'samples');
    return rhiBenchmarkQuantile(sortedSamples(samples), 0.5);
}

function createSeededRandom(seed: number): () => number {
    let state = seed >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    return (): number => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    };
}

function sampleStandardNormal(random: () => number): number {
    let first = 0;
    while (first === 0) first = random();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
}

function sampleGamma(shape: number, random: () => number): number {
    if (!Number.isFinite(shape) || shape <= 0) throw new Error('gamma shape must be positive');
    if (shape < 1) {
        let uniform = 0;
        while (uniform === 0) uniform = random();
        return sampleGamma(shape + 1, random) * uniform ** (1 / shape);
    }
    const adjustedShape = shape - 1 / 3;
    const scale = 1 / Math.sqrt(9 * adjustedShape);
    for (;;) {
        const normal = sampleStandardNormal(random);
        const factor = 1 + scale * normal;
        if (factor <= 0) continue;
        const cube = factor ** 3;
        const uniform = random();
        if (
            uniform < 1 - 0.0331 * normal ** 4 ||
            Math.log(uniform) < normal ** 2 / 2 + adjustedShape * (1 - cube + Math.log(cube))
        ) {
            return adjustedShape * cube;
        }
    }
}

function sampleBeta(firstShape: number, secondShape: number, random: () => number): number {
    const first = sampleGamma(firstShape, random);
    const second = sampleGamma(secondShape, random);
    return first / (first + second);
}

function sortedSampleAtUnitPosition(sorted: readonly number[], position: number): number {
    const index = Math.min(sorted.length - 1, Math.floor(position * sorted.length));
    const sample = sorted[index];
    if (sample === undefined) throw new Error('bootstrap order-statistic index is invalid');
    return sample;
}

function deriveRHISeed(baseSeed: number, ...components: readonly (string | number)[]): number {
    if (!Number.isSafeInteger(baseSeed) || baseSeed <= 0) {
        throw new Error('base bootstrap seed must be a positive safe integer');
    }
    let hash = baseSeed >>> 0;
    const text = components.join('\u0000');
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619) >>> 0;
    }
    return hash === 0 ? 1 : hash;
}

export function deriveRHIBenchmarkBootstrapSeed(
    baseSeed: number,
    ...components: readonly (string | number)[]
): number {
    return deriveRHISeed(baseSeed, ...components);
}

export function rhiBenchmarkPairedOrder(
    orderSeed: number,
    scenarioId: string,
    backend: string,
    round: number
): readonly RendererArchitecture[] {
    const legacyFirst =
        deriveRHISeed(orderSeed, scenarioId, backend, round, 'paired-order') % 2 === 0;
    return legacyFirst ? ['legacy', 'rhi'] : ['rhi', 'legacy'];
}

export function bootstrapRHIMedianConfidenceInterval(
    samples: readonly number[],
    options: RHIBenchmarkBootstrapOptions
): RHIBenchmarkConfidenceInterval {
    assertFiniteSamples(samples, 'bootstrap samples');
    assertBootstrapOptions(options);
    const sorted = sortedSamples(samples);
    if (sorted.length === 1 || sorted[0] === sorted.at(-1)) {
        const sample = sorted[0];
        if (sample === undefined) throw new Error('bootstrap sample is missing');
        return {
            low: sample,
            high: sample,
            confidenceLevel: options.confidenceLevel,
            bootstrapIterations: options.iterations,
            bootstrapSeed: options.seed
        };
    }
    const random = createSeededRandom(options.seed);
    const medians = new Array<number>(options.iterations);
    const lowerMedianOrder = Math.ceil(sorted.length / 2);
    // Sampling the relevant uniform order statistics is distribution-equivalent to building and
    // sorting every n-element bootstrap resample, while keeping 2,000-frame cases tractable.
    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
        const lowerPosition = sampleBeta(
            lowerMedianOrder,
            sorted.length - lowerMedianOrder + 1,
            random
        );
        const lower = sortedSampleAtUnitPosition(sorted, lowerPosition);
        if (sorted.length % 2 === 1) {
            medians[iteration] = lower;
            continue;
        }
        const upperPosition =
            lowerPosition +
            (1 - lowerPosition) * sampleBeta(1, sorted.length - lowerMedianOrder, random);
        medians[iteration] = (lower + sortedSampleAtUnitPosition(sorted, upperPosition)) / 2;
    }
    medians.sort((first, second) => first - second);
    const tailProbability = (1 - options.confidenceLevel) / 2;
    return {
        low: rhiBenchmarkQuantile(medians, tailProbability),
        high: rhiBenchmarkQuantile(medians, 1 - tailProbability),
        confidenceLevel: options.confidenceLevel,
        bootstrapIterations: options.iterations,
        bootstrapSeed: options.seed
    };
}

export function summarizeRHIBenchmarkDistribution(
    samples: readonly number[],
    options: RHIBenchmarkBootstrapOptions
): RHIBenchmarkDistribution {
    assertFiniteSamples(samples, 'benchmark samples');
    if (samples.some(sample => sample < 0)) {
        throw new Error('benchmark samples must be non-negative');
    }
    const sorted = sortedSamples(samples);
    const median = rhiBenchmarkQuantile(sorted, 0.5);
    const deviations = sortedSamples(samples.map(sample => Math.abs(sample - median)));
    const mean = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    const variance =
        samples.reduce((sum, sample) => sum + (sample - mean) ** 2, 0) / samples.length;
    const standardDeviation = Math.sqrt(variance);
    return {
        sampleCount: samples.length,
        minimum: sorted[0] ?? 0,
        maximum: sorted.at(-1) ?? 0,
        median,
        p50: median,
        p95: rhiBenchmarkQuantile(sorted, 0.95),
        p99: rhiBenchmarkQuantile(sorted, 0.99),
        mad: rhiBenchmarkQuantile(deviations, 0.5),
        coefficientOfVariation: mean === 0 ? 0 : standardDeviation / mean,
        confidenceInterval: bootstrapRHIMedianConfidenceInterval(samples, options)
    };
}

export function rhiBenchmarkDistributionStatistic(
    distribution: RHIBenchmarkDistribution,
    statistic: RHIBenchmarkGateStatistic
): number {
    switch (statistic) {
        case 'median':
            return distribution.median;
        case 'p50':
            return distribution.p50;
        case 'p95':
            return distribution.p95;
        case 'p99':
            return distribution.p99;
        case 'maximum':
            return distribution.maximum;
    }
}

export function aggregateRHIBenchmarkRoundValues(
    samples: readonly number[],
    statistic: RHIBenchmarkGateStatistic,
    metric: RHIBenchmarkMetric
): number {
    const sorted = sortedSamples(samples);
    if (statistic === 'maximum') return sorted.at(-1) ?? 0;
    if (rhiBenchmarkMetricScope(metric) === 'frame') return rhiBenchmarkMedian(sorted);
    switch (statistic) {
        case 'median':
        case 'p50':
            return rhiBenchmarkQuantile(sorted, 0.5);
        case 'p95':
            return rhiBenchmarkQuantile(sorted, 0.95);
        case 'p99':
            return rhiBenchmarkQuantile(sorted, 0.99);
    }
}

function regressionDifference(
    baseline: number,
    candidate: number,
    direction: RHIBenchmarkRegressionDirection
): number {
    if (direction === 'higher-is-worse') return candidate - baseline;
    if (direction === 'lower-is-worse') return baseline - candidate;
    return Math.abs(candidate - baseline);
}

function regressionFraction(
    baseline: number,
    candidate: number,
    direction: RHIBenchmarkRegressionDirection
): number {
    const difference = regressionDifference(baseline, candidate, direction);
    if (difference <= 0) return 0;
    if (baseline === 0) return Number.POSITIVE_INFINITY;
    return difference / Math.abs(baseline);
}

/** Paired A/B regression gate. Pair order is preserved; at least seven independent rounds are required. */
export function evaluateRHIBenchmarkPairedGate(
    input: RHIBenchmarkPairedGateInput
): RHIBenchmarkPairedGateResult {
    assertFiniteSamples(input.baseline, 'baseline pairs');
    assertFiniteSamples(input.candidate, 'candidate pairs');
    assertBootstrapOptions(input);
    if (input.baseline.length !== input.candidate.length) {
        throw new Error('paired A/B samples must have equal lengths');
    }
    if (input.baseline.length < 7) {
        throw new Error('paired A/B gate requires at least 7 rounds');
    }
    const direction = rhiBenchmarkRegressionDirection(input.metric);
    const statistic = input.statistic ?? 'median';
    const baselineValue = aggregateRHIBenchmarkRoundValues(input.baseline, statistic, input.metric);
    const candidateValue = aggregateRHIBenchmarkRoundValues(
        input.candidate,
        statistic,
        input.metric
    );
    const differences = input.baseline.map((baseline, index) => {
        const candidate = input.candidate[index];
        if (candidate === undefined) throw new Error('candidate pair is missing');
        return regressionDifference(baseline, candidate, direction);
    });
    const pairedDifferenceConfidenceInterval = bootstrapRHIMedianConfidenceInterval(
        differences,
        input
    );
    const fraction = regressionFraction(baselineValue, candidateValue, direction);
    const significantRegression =
        direction === 'invariant'
            ? differences.some(difference => difference !== 0)
            : pairedDifferenceConfidenceInterval.low > 0;
    const hardCapExceeded =
        (input.absoluteMaximum !== undefined && candidateValue > input.absoluteMaximum) ||
        (input.maximumRegressionFraction !== undefined &&
            fraction > input.maximumRegressionFraction);
    return {
        metric: input.metric,
        direction,
        statistic,
        pairCount: input.baseline.length,
        baselineValue,
        candidateValue,
        regressionFraction: fraction,
        pairedDifferenceConfidenceInterval,
        significantRegression,
        hardCapExceeded,
        passed: !significantRegression && !hardCapExceeded
    };
}

/** Evaluate a frozen-reference hard cap without making a paired statistical claim. */
export function evaluateRHIBenchmarkHardCapComparison(
    input: RHIBenchmarkHardCapComparisonInput
): RHIBenchmarkHardCapComparisonResult {
    assertFiniteSamples([input.referenceValue], 'hard-cap reference');
    assertFiniteSamples([input.comparisonValue], 'hard-cap comparison');
    const direction = rhiBenchmarkRegressionDirection(input.metric);
    const fraction = regressionFraction(input.referenceValue, input.comparisonValue, direction);
    const hardCapExceeded =
        (input.absoluteMaximum !== undefined && input.comparisonValue > input.absoluteMaximum) ||
        (input.maximumRegressionFraction !== undefined &&
            fraction > input.maximumRegressionFraction);
    return {
        metric: input.metric,
        direction,
        statistic: input.statistic,
        referenceValue: input.referenceValue,
        comparisonValue: input.comparisonValue,
        regressionFraction: fraction,
        hardCapExceeded,
        passed: !hardCapExceeded
    };
}

export function rhiBenchmarkHardCapApplies(
    hardCap: RHIBenchmarkHardCap,
    scenarioId: string,
    backend: string
): boolean {
    return (
        (hardCap.scenarioId === undefined || hardCap.scenarioId === scenarioId) &&
        (hardCap.backend === undefined || hardCap.backend === backend) &&
        !(hardCap.excludedScenarioIds as readonly string[] | undefined)?.includes(scenarioId)
    );
}
