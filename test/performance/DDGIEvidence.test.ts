import { describe, expect, it } from 'vitest';
import type { DDGIEvidenceFrame } from '../../benchmarks/ddgi/fixture-contract';
import {
    summarizeDDGISamples,
    validatedDDGIEvidenceURL,
    validateDDGIEvidenceFrame,
    validateDDGIEvidenceStability
} from '../../scripts/performance/collect-ddgi-evidence';

function frame(): DDGIEvidenceFrame {
    return {
        measurementIndex: 0,
        frameIndex: 1,
        cpuRecordMs: 2,
        fenceWaitMs: 3,
        timestampReadbackWaitMs: 1,
        diagnosticReadbackMs: 0.5,
        graphRecordMs: 0.7,
        graphCompileMs: 0.2,
        graphPrepareMs: 0.6,
        graphExecuteMs: 0.5,
        gpuPassTimeSumMs: 1.25,
        gpuPasses: [{ name: 'Scene', kind: 'render', cpuDurationMs: 0.5, gpuDurationMs: 1.25 }],
        commands: {
            draws: 1,
            indirectDraws: 0,
            dispatches: 1,
            uploads: 1,
            submissions: 1
        },
        dynamicGlobalIllumination: null
    };
}

describe('DDGI native evidence boundaries', () => {
    it('rejects nonrepeatable rounds instead of publishing a noisy baseline candidate', () => {
        const stable = (['enabled', 'disabled'] as const).flatMap(mode =>
            [1, 1.1, 1.05].map(time => ({
                mode,
                cpuRecordMs: summarizeDDGISamples([time, time]),
                gpuPassTimeSumMs: summarizeDDGISamples([time, time])
            }))
        );
        expect(() => {
            validateDDGIEvidenceStability(stable);
        }).not.toThrow();
        const first = stable[0];
        if (first === undefined) throw new Error('Missing stability fixture');
        expect(() => {
            validateDDGIEvidenceStability([
                { ...first, cpuRecordMs: summarizeDDGISamples([5, 5]) },
                ...stable.slice(1)
            ]);
        }).toThrow(/unstable/);
    });
    it('permits only the exact unparameterized loopback fixture', () => {
        expect(
            validatedDDGIEvidenceURL(
                'http://127.0.0.1:4173/examples/dynamic_global_illumination_atelier.html'
            ).port
        ).toBe('4173');
        for (const url of [
            'https://example.com/examples/dynamic_global_illumination_atelier.html',
            'http://localhost:4173/private.json',
            'http://user:password@localhost:4173/examples/dynamic_global_illumination_atelier.html',
            'http://localhost:4173/examples/dynamic_global_illumination_atelier.html?ddgi=0',
            'http://localhost:4173/examples/dynamic_global_illumination_atelier.html#unsafe'
        ])
            expect(() => validatedDDGIEvidenceURL(url)).toThrow();
    });

    it('retains observed quantiles and rejects unavailable timings', () => {
        expect(summarizeDDGISamples([4, 1, 2, 3])).toEqual({
            count: 4,
            minimum: 1,
            median: 2.5,
            p95: 4,
            maximum: 4,
            mean: 2.5
        });
        for (const values of [[], [Number.NaN], [Infinity], [-1]]) {
            expect(() => summarizeDDGISamples(values)).toThrow();
        }
    });

    it('requires submitted pixels work and true resolved GPU timing', () => {
        expect(() => {
            validateDDGIEvidenceFrame(frame(), 'disabled');
        }).not.toThrow();
        expect(() => {
            validateDDGIEvidenceFrame(
                { ...frame(), commands: { ...frame().commands, submissions: 0 } },
                'disabled'
            );
        }).toThrow(/submission/);
        expect(() => {
            validateDDGIEvidenceFrame({ ...frame(), gpuPassTimeSumMs: 3 }, 'disabled');
        }).toThrow(/sum/);
        expect(() => {
            validateDDGIEvidenceFrame(
                {
                    ...frame(),
                    gpuPasses: [
                        { name: 'Scene', kind: 'render', cpuDurationMs: 0, gpuDurationMs: null }
                    ]
                },
                'disabled'
            );
        }).toThrow(/timestamps/);
        expect(() => {
            validateDDGIEvidenceFrame(
                {
                    ...frame(),
                    gpuPasses: [
                        {
                            name: 'DDGI update',
                            kind: 'compute',
                            cpuDurationMs: 0,
                            gpuDurationMs: 1.25
                        }
                    ]
                },
                'disabled'
            );
        }).toThrow(/remove its runtime/);
        expect(() => {
            validateDDGIEvidenceFrame(frame(), 'enabled');
        }).toThrow(/contract/);
    });
});
