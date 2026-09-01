import { describe, expect, it } from 'vitest';
import { RHI_BENCHMARK_HARD_CAPS } from '../../benchmarks/rhi/result-schema';
import {
    bootstrapRHIMedianConfidenceInterval,
    deriveRHIBenchmarkBootstrapSeed,
    evaluateRHIBenchmarkPairedGate,
    rhiBenchmarkDistributionStatistic,
    rhiBenchmarkHardCapApplies,
    summarizeRHIBenchmarkDistribution
} from '../../scripts/performance/rhi-benchmark-statistics';

const BOOTSTRAP = {
    seed: 123_456,
    iterations: 2_000,
    confidenceLevel: 0.95
} as const;

describe('RHI benchmark deterministic statistics', () => {
    it('computes deterministic percentiles, MAD, CV, and seeded bootstrap intervals', () => {
        const samples = [1, 2, 3, 4];
        const first = summarizeRHIBenchmarkDistribution(samples, BOOTSTRAP);
        const second = summarizeRHIBenchmarkDistribution(samples, BOOTSTRAP);

        expect(first).toEqual(second);
        expect(first).toMatchObject({
            sampleCount: 4,
            minimum: 1,
            maximum: 4,
            median: 2.5,
            p50: 2.5,
            p95: 3.8499999999999996,
            p99: 3.9699999999999998,
            mad: 1
        });
        expect(first.coefficientOfVariation).toBeCloseTo(Math.sqrt(1.25) / 2.5);
        expect(first.confidenceInterval.low).toBeLessThanOrEqual(first.median);
        expect(first.confidenceInterval.high).toBeGreaterThanOrEqual(first.median);
        expect(first.confidenceInterval.bootstrapSeed).toBe(BOOTSTRAP.seed);
        expect(rhiBenchmarkDistributionStatistic(first, 'p95')).toBe(first.p95);
        expect(rhiBenchmarkDistributionStatistic(first, 'maximum')).toBe(first.maximum);
    });

    it('derives stable non-zero per-case bootstrap seeds', () => {
        const first = deriveRHIBenchmarkBootstrapSeed(9, 'case', 'webgl2', 1, 'rendererCpuMs');
        expect(first).toBe(
            deriveRHIBenchmarkBootstrapSeed(9, 'case', 'webgl2', 1, 'rendererCpuMs')
        );
        expect(first).toBeGreaterThan(0);
        expect(first).not.toBe(
            deriveRHIBenchmarkBootstrapSeed(9, 'case', 'webgpu', 1, 'rendererCpuMs')
        );
    });

    it('rejects a repeatable positive paired regression even below the hard cap', () => {
        const result = evaluateRHIBenchmarkPairedGate({
            metric: 'rendererCpuMs',
            baseline: Array<number>(7).fill(100),
            candidate: Array<number>(7).fill(101),
            maximumRegressionFraction: 0.02,
            ...BOOTSTRAP
        });

        expect(result.regressionFraction).toBeCloseTo(0.01);
        expect(result.significantRegression).toBe(true);
        expect(result.hardCapExceeded).toBe(false);
        expect(result.passed).toBe(false);
    });

    it('keeps a noisy paired difference whose bootstrap interval includes zero', () => {
        const interval = bootstrapRHIMedianConfidenceInterval([-1, 1, -1, 1, -1, 1, 0], BOOTSTRAP);
        expect(interval.low).toBeLessThanOrEqual(0);
        expect(interval.high).toBeGreaterThanOrEqual(0);

        const result = evaluateRHIBenchmarkPairedGate({
            metric: 'rendererCpuMs',
            baseline: Array<number>(7).fill(100),
            candidate: [99, 101, 99, 101, 99, 101, 100],
            maximumRegressionFraction: 0.02,
            ...BOOTSTRAP
        });
        expect(result.significantRegression).toBe(false);
        expect(result.hardCapExceeded).toBe(false);
        expect(result.passed).toBe(true);
    });

    it('applies hard caps even without statistical significance and handles zero allocation', () => {
        const result = evaluateRHIBenchmarkPairedGate({
            metric: 'allocationBytesPerFrame',
            baseline: [0, 0, 0, 0, 0, 0, 0],
            candidate: [0, 0, 0, 0, 0, 0, 4],
            statistic: 'maximum',
            maximumRegressionFraction: 0,
            ...BOOTSTRAP
        });
        expect(result.regressionFraction).toBe(Number.POSITIVE_INFINITY);
        expect(result.hardCapExceeded).toBe(true);
        expect(result.passed).toBe(false);
    });

    it('uses cross-round p95 for cold-entry metrics without diluting steady-frame p95 values', () => {
        const values = [100, 100, 100, 100, 100, 100, 200];
        const coldEntry = evaluateRHIBenchmarkPairedGate({
            metric: 'firstComplexFrameCpuMs',
            baseline: Array<number>(7).fill(100),
            candidate: values,
            statistic: 'p95',
            maximumRegressionFraction: 0.05,
            ...BOOTSTRAP
        });
        expect(coldEntry.candidateValue).toBeCloseTo(170);
        expect(coldEntry.hardCapExceeded).toBe(true);

        const steadyFrame = evaluateRHIBenchmarkPairedGate({
            metric: 'rendererCpuMs',
            baseline: Array<number>(7).fill(100),
            candidate: values,
            statistic: 'p95',
            ...BOOTSTRAP
        });
        expect(steadyFrame.candidateValue).toBe(100);
    });

    it('uses inverse cache-hit direction and exact draw-count invariants', () => {
        const cache = evaluateRHIBenchmarkPairedGate({
            metric: 'pipelineCacheHitRate',
            baseline: Array<number>(7).fill(0.9),
            candidate: Array<number>(7).fill(0.8),
            ...BOOTSTRAP
        });
        expect(cache.direction).toBe('lower-is-worse');
        expect(cache.significantRegression).toBe(true);

        const draws = evaluateRHIBenchmarkPairedGate({
            metric: 'actualDrawCount',
            baseline: Array<number>(7).fill(1000),
            candidate: [1000, 1000, 1000, 999, 1000, 1000, 1000],
            ...BOOTSTRAP
        });
        expect(draws.direction).toBe('invariant');
        expect(draws.significantRegression).toBe(true);
        expect(draws.passed).toBe(false);
    });

    it('requires three paired rounds and scopes hard-cap applicability', () => {
        expect(() =>
            evaluateRHIBenchmarkPairedGate({
                metric: 'gpuFrameMs',
                baseline: [1, 1],
                candidate: [1, 1],
                ...BOOTSTRAP
            })
        ).toThrow(/at least 3 rounds/u);

        const webglCap = RHI_BENCHMARK_HARD_CAPS.find(cap => cap.id === 'webgl2-10000-draw-cpu');
        if (!webglCap) throw new Error('missing WebGL hard-cap fixture');
        expect(rhiBenchmarkHardCapApplies(webglCap, 'shared-pipeline-10000-draw', 'webgl2')).toBe(
            true
        );
        expect(rhiBenchmarkHardCapApplies(webglCap, 'shared-pipeline-10000-draw', 'webgpu')).toBe(
            false
        );

        for (const allocationCapId of ['renderer-allocation', 'rhi-hot-path-allocation']) {
            const allocationCap = RHI_BENCHMARK_HARD_CAPS.find(cap => cap.id === allocationCapId);
            if (!allocationCap) throw new Error(`missing ${allocationCapId} hard-cap fixture`);
            expect(
                rhiBenchmarkHardCapApplies(allocationCap, 'static-unlit-single-draw', 'webgpu')
            ).toBe(true);
            expect(
                rhiBenchmarkHardCapApplies(allocationCap, 'shared-pipeline-10000-draw', 'webgpu')
            ).toBe(false);
        }
    });
});
