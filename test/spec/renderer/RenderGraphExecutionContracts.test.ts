import { describe, expect, it, vi } from 'vitest';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import type { RGPrepareContext } from '../../../src/render/graph/RenderGraphExecutor';
import {
    RenderGraphTimelineRecorder,
    type RenderGraphTimelineSnapshot
} from '../../../src/render/graph/RenderGraphTimeline';
import { RHIBufferUsage, type RHIBuffer } from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

describe('Render Graph execution phase contracts', () => {
    it('destroys extracted resources from an already failed submission without aborting its closed scope', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const buffer = builder.createBuffer('extracted scratch', {
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        builder.extractBuffer(buffer);
        builder.addPass(
            {
                name: 'initialize extracted scratch',
                setup(pass) {
                    pass.writeBuffer(buffer, 'copy-destination');
                },
                execute(context) {
                    context.commandContext.clearBuffer(context.getBuffer(buffer));
                }
            },
            undefined
        );
        const compiled = graph.compile(builder, device.capabilities);
        const failure = new Error('submission rejected');
        const queue = device.graphicsQueue;
        const endFrame = queue.endFrame.bind(queue);
        vi.spyOn(queue, 'endFrame').mockImplementation(context => {
            const submission = endFrame(context);
            queue.pendingSubmission()?.fail(failure);
            return submission;
        });
        const abort = vi.spyOn(queue, 'abortFrame');
        const buffers = vi.spyOn(device, 'createBuffer');
        expect(() => graph.execute(compiled, device)).toThrow(failure);
        expect((buffers.mock.results[0]?.value as RHIBuffer | undefined)?.destroyed).toBe(true);
        expect(abort).not.toHaveBeenCalled();
        graph.destroy();
        backend.destroy();
    });

    it.each(['prepare', 'execute'] as const)(
        'cancels the active graph when a %s callback destroys its owner',
        phase => {
            const backend = new FakeWebGLRHIBackend();
            const device = backend.createDevice();
            const graph = new RenderGraph();
            const builder = graph.createBuilder();
            const buffer = builder.createBuffer('scratch', {
                size: 16,
                usage: RHIBufferUsage.COPY_DST
            });
            builder.addPass(
                {
                    name: `destroy during ${phase}`,
                    setup(pass) {
                        pass.writeBuffer(buffer, 'copy-destination');
                        pass.markSideEffect();
                    },
                    execute(context) {
                        void context;
                    },
                    [phase](): void {
                        graph.destroy();
                    }
                },
                undefined
            );
            const compiled = graph.compile(builder, device.capabilities);
            const begin = vi.spyOn(device.graphicsQueue, 'beginFrame');
            const end = vi.spyOn(device.graphicsQueue, 'endFrame');
            const abort = vi.spyOn(device.graphicsQueue, 'abortFrame');
            const buffers = vi.spyOn(device, 'createBuffer');
            expect(() => graph.execute(compiled, device)).toThrow('executor is destroyed');
            expect(begin).toHaveBeenCalledTimes(phase === 'execute' ? 1 : 0);
            expect(abort).toHaveBeenCalledTimes(phase === 'execute' ? 1 : 0);
            expect(end).not.toHaveBeenCalled();
            expect((buffers.mock.results[0]?.value as RHIBuffer | undefined)?.destroyed).toBe(true);
            backend.destroy();
        }
    );

    it.each(['prepare', 'execute'] as const)(
        'rejects asynchronous %s callbacks and expires the retained resource context',
        async phase => {
            const backend = new FakeWebGLRHIBackend();
            const device = backend.createDevice();
            const graph = new RenderGraph();
            const builder = graph.createBuilder();
            const buffer = builder.createBuffer('scratch', {
                size: 16,
                usage: RHIBufferUsage.COPY_DST
            });
            const scopes: RGPrepareContext[] = [];
            const template: RenderPassTemplate<undefined> = {
                name: `async ${phase}`,
                setup(pass) {
                    pass.writeBuffer(buffer, 'copy-destination');
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                },
                [phase](context: RGPrepareContext): Promise<never> {
                    scopes.push(context);
                    return Promise.reject(new Error('late callback rejection'));
                }
            };
            builder.addPass(template, undefined);
            const compiled = graph.compile(builder, device.capabilities);
            const begin = vi.spyOn(device.graphicsQueue, 'beginFrame');
            const end = vi.spyOn(device.graphicsQueue, 'endFrame');
            const abort = vi.spyOn(device.graphicsQueue, 'abortFrame');
            expect(() => graph.execute(compiled, device)).toThrow(
                `${phase} callbacks must be synchronous`
            );
            expect(begin).toHaveBeenCalledTimes(phase === 'execute' ? 1 : 0);
            expect(abort).toHaveBeenCalledTimes(phase === 'execute' ? 1 : 0);
            expect(end).not.toHaveBeenCalled();
            expect(() => scopes[0]?.getBuffer(buffer)).toThrow('undeclared');
            await Promise.resolve();
            graph.destroy();
            backend.destroy();
        }
    );

    it('prepares timestamp resources before beginFrame and reuses them when beginFrame fails', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        builder.addPass(
            {
                name: 'timestamped pass',
                timestampKind: () => 'compute',
                setup(pass) {
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        const compiled = graph.compile(builder, device.capabilities);
        const querySets = vi.spyOn(device, 'createQuerySet');
        const begin = vi.spyOn(device.graphicsQueue, 'beginFrame');
        for (let index = 0; index < 4; index++) {
            const timeline = new RenderGraphTimelineRecorder(index, {
                recordRenderGraphTimeline(snapshot) {
                    void snapshot;
                }
            });
            timeline.captureGraph(compiled);
            begin.mockImplementationOnce(() => {
                expect(querySets).toHaveBeenCalledOnce();
                throw new Error('begin failed');
            });
            expect(() => graph.execute(compiled, device, { timeline })).toThrow('begin failed');
        }
        expect(querySets).toHaveBeenCalledOnce();
        graph.destroy();
        backend.destroy();
    });

    it('reuses immutable resource metadata across pending and completed timeline snapshots', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        builder.addPass(
            {
                name: 'timed pass',
                timestampKind: () => 'render',
                setup(pass) {
                    pass.markSideEffect();
                },
                execute(context) {
                    void context;
                }
            },
            undefined
        );
        const snapshots: Readonly<RenderGraphTimelineSnapshot>[] = [];
        const timeline = new RenderGraphTimelineRecorder(1, {
            recordRenderGraphTimeline(snapshot) {
                snapshots.push(snapshot);
            }
        });
        timeline.captureGraph(graph.compile(builder, device.capabilities));
        timeline.markGPUPending();
        timeline.publish();
        timeline.completeGPU([0], new BigUint64Array([1n, 1_000_001n]));
        expect(timeline.timestampPassCount).toBe(1);
        expect(snapshots[0]?.resources).toBe(snapshots[1]?.resources);
        expect(Object.isFrozen(snapshots[0]?.resources)).toBe(true);
        expect(snapshots[0]?.passes[0]?.gpuDurationMs).toBe(null);
        expect(snapshots[1]?.passes[0]?.gpuDurationMs).toBe(1);
        graph.destroy();
        backend.destroy();
    });
});
