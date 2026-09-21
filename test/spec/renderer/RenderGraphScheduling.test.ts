import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type {
    RenderGraphBuilder,
    RenderPassTemplate
} from '../../../src/render/graph/RenderGraphBuilder';
import { RenderGraphPassScheduler } from '../../../src/render/graph/RenderGraphPassScheduler';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

type Dependency = readonly [before: number, after: number];

const passTemplate: RenderPassTemplate<boolean> = {
    name: 'scheduled pass',
    setup(builder, sideEffect) {
        if (sideEffect) builder.markSideEffect();
    },
    execute(context) {
        void context;
    }
};

function buildDependencyGraph(
    graph: RenderGraph,
    passCount: number,
    dependencies: readonly Dependency[],
    sideEffects = true
): RenderGraphBuilder {
    const builder = graph.createBuilder();
    const passes = Array.from({ length: passCount }, () =>
        builder.addPass(passTemplate, sideEffects)
    );
    for (const [before, after] of dependencies) {
        const dependency = passes[before];
        const dependent = passes[after];
        if (dependency === undefined || dependent === undefined) {
            throw new Error('Invalid fixture dependency');
        }
        builder.addDependency(dependency, dependent);
    }
    return builder;
}

describe('RenderGraph stable scheduling', () => {
    let backend: FakeWebGLRHIBackend;
    let device: RHIDevice;
    let graph: RenderGraph;

    beforeEach(() => {
        backend = new FakeWebGLRHIBackend();
        device = backend.createDevice();
        graph = new RenderGraph();
    });

    afterEach(() => {
        graph.destroy();
        backend.destroy();
    });

    it('selects newly unblocked earlier passes before passes already in the ready queue', () => {
        const builder = buildDependencyGraph(graph, 6, [
            [2, 3],
            [3, 0],
            [0, 1],
            [0, 1]
        ]);

        const compiled = graph.compile(builder, device.capabilities);

        expect(compiled.passes.map(pass => pass.sourceIndex)).toEqual([2, 3, 0, 1, 4, 5]);
        expect(compiled.passes.map(pass => pass.order)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(device.graphicsQueue.state).toBe('idle');
        expect(backend.executeCount).toBe(0);
    });

    it('validates cycles even when all cycle members would otherwise be culled', () => {
        const builder = buildDependencyGraph(
            graph,
            3,
            [
                [0, 1],
                [1, 0]
            ],
            false
        );

        expect(() => graph.compile(builder, device.capabilities)).toThrow(
            expect.objectContaining({ code: 'cycle' })
        );
        const recovery = graph.compile(
            buildDependencyGraph(graph, 3, [[2, 0]]),
            device.capabilities
        );
        expect(recovery.passes.map(pass => pass.sourceIndex)).toEqual([1, 2, 0]);
        expect(backend.executeCount).toBe(0);
    });

    it('reuses high-water capacity across wide, small, empty, and reverse-chain graphs', () => {
        const wide = graph.compile(buildDependencyGraph(graph, 512, []), device.capabilities);
        const wideOrder = Array.from({ length: 512 }, (_, index) => index);
        expect(wide.passes.map(pass => pass.sourceIndex)).toEqual(wideOrder);
        const diagnostics = { ...graph.storageDiagnostics };

        const small = graph.compile(
            buildDependencyGraph(graph, 3, [
                [2, 1],
                [1, 0]
            ]),
            device.capabilities
        );
        expect(small.passes.map(pass => pass.sourceIndex)).toEqual([2, 1, 0]);
        expect(graph.compile(graph.createBuilder(), device.capabilities).passes).toEqual([]);

        const chain = graph.compile(
            buildDependencyGraph(
                graph,
                400,
                Array.from({ length: 399 }, (_, index): Dependency => [index + 1, index])
            ),
            device.capabilities
        );
        expect(chain.passes.map(pass => pass.sourceIndex)).toEqual(
            Array.from({ length: 400 }, (_, index) => 399 - index)
        );
        expect(graph.storageDiagnostics.compilerStorageGrowths).toBe(
            diagnostics.compilerStorageGrowths
        );
        expect(graph.storageDiagnostics.compilerPassCapacity).toBe(512);
        // Later schedules must never mutate a compiled graph retained by an in-flight frame.
        expect(wide.passes.map(pass => pass.sourceIndex)).toEqual(wideOrder);
        expect(small.passes.map(pass => pass.sourceIndex)).toEqual([2, 1, 0]);
    });
});

describe('RenderGraphPassScheduler', () => {
    it('matches the lowest-ready-index contract across deterministic dependency shapes', () => {
        const scheduler = new RenderGraphPassScheduler();
        const passCount = 64;
        let randomState = 0x7c9e_b5a1;
        const nextRandom = (): number => {
            randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
            return randomState;
        };

        for (let trial = 0; trial < 48; trial += 1) {
            const outgoing = Array.from({ length: passCount }, () => new Set<number>());
            const incoming = Array.from({ length: passCount }, () => new Set<number>());
            const stride = trial * 2 + 1;
            for (let before = 0; before < passCount; before += 1) {
                for (let after = before + 1; after < passCount; after += 1) {
                    if (nextRandom() % 11 >= trial % 10) continue;
                    const source = (before * stride + trial) % passCount;
                    const target = (after * stride + trial) % passCount;
                    outgoing[source]?.add(target);
                    incoming[target]?.add(source);
                }
            }

            const scheduled = new Set<number>();
            const expected: number[] = [];
            while (expected.length < passCount) {
                const selected = incoming.findIndex(
                    (dependencies, index) =>
                        !scheduled.has(index) &&
                        [...dependencies].every(dependency => scheduled.has(dependency))
                );
                if (selected < 0) throw new Error('Fixture must describe an acyclic graph');
                scheduled.add(selected);
                expected.push(selected);
            }

            const result = scheduler.schedule(outgoing, incoming, passCount);
            expect(Array.from(result).slice(0, passCount)).toEqual(expected);
        }
    });

    it('retains numeric scheduling storage below the historical peak', () => {
        const scheduler = new RenderGraphPassScheduler();
        const edges = Array.from({ length: 70 }, () => new Set<number>());
        const first = scheduler.schedule(edges, edges, 70);

        expect(scheduler.capacity).toBe(128);
        expect(scheduler.reserve(71)).toBe(false);
        expect(scheduler.schedule(edges, edges, 0)).toBe(first);
        expect(scheduler.schedule(edges, edges, 3)).toBe(first);
        expect(scheduler.reserve(129)).toBe(true);
        expect(scheduler.capacity).toBe(256);
    });
});
