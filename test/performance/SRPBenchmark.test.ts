import { describe, expect, it } from 'vitest';
import { SRP_PROTOCOL } from '../../benchmarks/srp/contract';
import { compareSRPCaptures } from '../../benchmarks/srp/comparison';
import {
    srpAllocationBytes,
    srpSpatialPixelRange,
    summarizeSRPSamples
} from '../../benchmarks/srp/statistics';

function candidate(commit: string): object {
    const sample = {
        cpuMs: 2,
        recordMs: 0.5,
        compileMs: 0.2,
        prepareMs: 0.8,
        executeMs: 0.4,
        fenceMs: 1,
        logicalBytes: 300,
        peakLiveBytes: 200,
        physicalBytes: 300,
        draws: 5,
        commands: 40,
        passes: 5,
        submissions: 1
    };
    return {
        schemaVersion: 1,
        protocol: SRP_PROTOCOL,
        commit: commit.repeat(40),
        protocolSha256: 'a'.repeat(64),
        sourceSha256: commit.repeat(64),
        dirty: false,
        evidence: 'unreviewed-candidate',
        backend: 'webgpu',
        workload: 'custom',
        environment: { rig: 'one' },
        rounds: Array.from({ length: SRP_PROTOCOL.rounds }, () => ({
            browser: 'one',
            gpuIdentity: { device: 'one' },
            samples: Array.from({ length: SRP_PROTOCOL.sampleFrames }, () => ({ ...sample })),
            allocations: [{ bytes: 100 }, { bytes: 120 }, { bytes: 110 }],
            pixels: { sha256: 'b'.repeat(64), range: 120 }
        }))
    };
}

describe('SRP evidence contract', () => {
    it('rejects solid colored output and alpha-only changes as nonuniform scene evidence', () => {
        expect(srpSpatialPixelRange(new Uint8Array([255, 0, 64, 255, 255, 0, 64, 0]))).toBe(0);
        expect(srpSpatialPixelRange(new Uint8Array([255, 0, 64, 255, 255, 128, 64, 255]))).toBe(
            128
        );
        expect(() => srpSpatialPixelRange(new Uint8Array())).toThrow();
        expect(() => srpSpatialPixelRange(new Uint8Array(3))).toThrow();
    });
    it('compares complete identical-workload captures and rejects dirty/same-commit evidence', () => {
        expect(compareSRPCaptures(candidate('a'), candidate('b')).compileMs).toEqual({
            before: 0.2,
            after: 0.2,
            changePercent: 0
        });
        expect(() => compareSRPCaptures(candidate('a'), candidate('a'))).toThrow(/not comparable/u);
        expect(() =>
            compareSRPCaptures({ ...candidate('a'), dirty: true }, candidate('b'))
        ).toThrow(/clean audited/u);
        expect(() =>
            compareSRPCaptures(
                { ...candidate('a'), protocolSha256: 'c'.repeat(64) },
                candidate('b'),
                true
            )
        ).toThrow(/not comparable/u);
        expect(() => compareSRPCaptures({ ...candidate('a'), rounds: [] }, candidate('b'))).toThrow(
            /Incomplete/u
        );
        expect(() =>
            compareSRPCaptures({ ...candidate('a'), environment: { rig: 'two' } }, candidate('b'))
        ).toThrow(/not comparable/u);
    });
    it('never replaces missing timings with zero', () => {
        expect(() => summarizeSRPSamples([])).toThrow();
        expect(() => summarizeSRPSamples([NaN])).toThrow();
        expect(summarizeSRPSamples([3, 1, 2])).toEqual({ median: 2, p95: 3, min: 1, max: 3 });
    });
    it('counts synchronous engine allocations and excludes observers after the frame boundary', () => {
        const node = (
            functionName: string,
            url: string,
            selfSize: number,
            children: readonly object[] = []
        ): object => ({ callFrame: { functionName, url }, selfSize, children });
        const profile = {
            profile: {
                head: node('root', '', 0, [
                    node(
                        'renderSRPAllocationFrame',
                        '/test/performance/fixtures/srp-production.ts',
                        8,
                        [
                            node('compile', '/src/render/graph/RenderGraph.ts', 40, [
                                node('native', '', 12)
                            ])
                        ]
                    ),
                    node('observer', '/src/render/graph/RenderGraph.ts', 100)
                ])
            }
        };
        expect(srpAllocationBytes(profile)).toBe(52);
        expect(() => srpAllocationBytes({ profile: { head: node('root', '', 0) } })).toThrow(
            /no synchronous/u
        );
    });
});
