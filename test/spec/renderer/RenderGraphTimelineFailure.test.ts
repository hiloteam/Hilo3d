import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import {
    RenderGraphFrame,
    type RenderGraphFrameBuildScope
} from '../../../src/render/frame/RenderGraphFrame';
import {
    createRenderGraphFrameContext,
    type RenderGraphFrameContext
} from '../../../src/render/frame/RenderGraphFrameContext';
import type {
    RenderGraphGPUTimelineStatus,
    RenderGraphTimelineSnapshot
} from '../../../src/render/graph/RenderGraphTimeline';
import {
    RHITextureUsage,
    type RHITexture,
    type RHIBuffer,
    type RHIQuerySet
} from '../../../src/render/rhi/core';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

function frameContext(device: FakeRHIDevice): RenderGraphFrameContext {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex: 1,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 1, height: 1, minDepth: 0, maxDepth: 1 }
    });
}

function recordColor(scope: RenderGraphFrameBuildScope, timestamped = true): void {
    const color = scope.graph.createTexture('observer test color', {
        size: { width: 1, height: 1 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    });
    scope.graph.addPass(
        {
            name: 'observer test pass',
            timestampKind: () => (timestamped ? 'render' : null),
            setup(pass) {
                pass.useColorAttachment({
                    texture: color,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                });
                pass.markSideEffect();
            },
            execute(context) {
                const encoder = context.commandContext.beginRenderPass({
                    colorAttachments: [
                        {
                            view: context.getTextureView(color),
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: { r: 0, g: 0, b: 0, a: 1 }
                        }
                    ],
                    ...(context.timestampWrites === undefined
                        ? {}
                        : { timestampWrites: context.timestampWrites })
                });
                encoder.end();
            }
        },
        undefined
    );
}

describe('Render Graph timeline failure boundaries', () => {
    it('commits uploads and retains the submission when the initial observer throws without GPU queries', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame();
        const failure = new Error('CPU timeline observer failed');
        const participant = { prepareCommit: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
        const abort = vi.spyOn(device.graphicsQueue, 'abortFrame');
        const textures = vi.spyOn(device, 'createTexture');
        const result = frame.execute(
            frameContext(device),
            scope => {
                scope.uploads.enlist(participant);
                recordColor(scope, false);
            },
            undefined,
            {
                recordRenderGraphTimeline() {
                    throw failure;
                }
            }
        );
        expect(result.submission.status).toBe('succeeded');
        expect(participant.commit).toHaveBeenCalledWith(result.submission);
        expect(participant.rollback).not.toHaveBeenCalled();
        expect(abort).not.toHaveBeenCalled();
        expect(() => {
            result.throwTimelineError();
        }).toThrow(failure);
        frame.execute(frameContext(device), scope => {
            recordColor(scope, false);
        });
        expect(textures).toHaveBeenCalledTimes(1);
        frame.destroy();
        backend.destroy();
    });

    it('keeps resources alive until the GPU fence even when the pending observer throws', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame();
        const textures = vi.spyOn(device, 'createTexture');
        const queries = vi.spyOn(device, 'createQuerySet');
        const abort = vi.spyOn(device.graphicsQueue, 'abortFrame');
        const statuses: RenderGraphGPUTimelineStatus[] = [];
        const failure = new Error('pending timeline observer failed');
        const result = frame.execute(frameContext(device), recordColor, undefined, {
            recordRenderGraphTimeline(snapshot) {
                statuses.push(snapshot.gpuStatus);
                if (snapshot.gpuStatus === 'pending') throw failure;
            }
        });
        expect(() => {
            result.throwTimelineError();
        }).toThrow(failure);
        expect(result.submission.status).toBe('pending');
        expect(abort).not.toHaveBeenCalled();
        frame.destroy();
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(false);
        expect((queries.mock.results[0]?.value as RHIQuerySet | undefined)?.destroyed).toBe(false);
        backend.completeNextSubmission();
        await result.submission.done;
        await vi.waitFor(() => {
            expect(statuses).toEqual(['pending', 'ready']);
        });
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(true);
        expect((queries.mock.results[0]?.value as RHIQuerySet | undefined)?.destroyed).toBe(true);
        backend.destroy();
    });

    it('reports promise-returning observers independently on the no-query path', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame();
        const failure = new Error('async CPU observer failed');
        const report = vi.fn<(error: unknown) => void>();
        const sink = {
            recordRenderGraphTimeline(): Promise<never> {
                return Promise.reject(failure);
            }
        };
        const result = frame.execute(
            frameContext(device),
            scope => {
                recordColor(scope, false);
            },
            undefined,
            sink,
            report
        );
        expect(() => {
            result.throwTimelineError();
        }).not.toThrow();
        expect(result.submission.status).toBe('succeeded');
        await vi.waitFor(() => {
            expect(report).toHaveBeenCalledExactlyOnceWith(failure);
        });
        frame.destroy();
        backend.destroy();
    });

    it.each(['sync', 'async'] as const)(
        'reports a %s ready observer once and reuses its query slot',
        async mode => {
            const backend = new FakeWebGPURHIBackend();
            const device = backend.createDevice();
            const frame = new RenderGraphFrame();
            const queries = vi.spyOn(device, 'createQuerySet');
            const failure = new Error('ready timeline observer failed');
            const report = vi.fn<(error: unknown) => void>();
            const statuses: RenderGraphGPUTimelineStatus[] = [];
            const sink = {
                recordRenderGraphTimeline(
                    snapshot: Readonly<RenderGraphTimelineSnapshot>
                ): Promise<never> | undefined {
                    statuses.push(snapshot.gpuStatus);
                    if (snapshot.gpuStatus !== 'ready') return undefined;
                    if (mode === 'sync') throw failure;
                    return Promise.reject(failure);
                }
            };
            for (let index = 0; index < 4; index += 1) {
                const result = frame.execute(
                    frameContext(device),
                    recordColor,
                    undefined,
                    sink,
                    report
                );
                backend.completeNextSubmission();
                await result.submission.done;
                await vi.waitFor(() => {
                    expect(report).toHaveBeenCalledTimes(index + 1);
                });
                expect(result.submission.status).toBe('succeeded');
            }
            expect(statuses).toEqual([
                'pending',
                'ready',
                'pending',
                'ready',
                'pending',
                'ready',
                'pending',
                'ready'
            ]);
            expect(report).toHaveBeenLastCalledWith(failure);
            expect(queries).toHaveBeenCalledTimes(1);
            frame.destroy();
            backend.destroy();
        }
    );

    it('releases timestamp resources when readback fails and the failed observer also throws', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame();
        const buffers = vi.spyOn(device, 'createBuffer');
        const queries = vi.spyOn(device, 'createQuerySet');
        const statuses: RenderGraphGPUTimelineStatus[] = [];
        const failure = new Error('failed timeline observer failed');
        const report = vi.fn<(error: unknown) => void>();
        const result = frame.execute(
            frameContext(device),
            recordColor,
            undefined,
            {
                recordRenderGraphTimeline(snapshot) {
                    statuses.push(snapshot.gpuStatus);
                    if (snapshot.gpuStatus === 'failed') throw failure;
                }
            },
            report
        );
        const readback = buffers.mock.results
            .map(entry => entry.value as RHIBuffer)
            .find(buffer => buffer.label === 'Render Graph timestamp readback');
        if (readback === undefined) throw new Error('Timestamp readback buffer was not created');
        vi.spyOn(readback, 'mapAsync').mockRejectedValueOnce(new Error('readback mapping failed'));
        backend.completeNextSubmission();
        await result.submission.done;
        await vi.waitFor(() => {
            expect(report).toHaveBeenCalledExactlyOnceWith(failure);
        });
        expect(statuses).toEqual(['pending', 'failed']);
        expect(result.submission.status).toBe('succeeded');
        frame.destroy();
        expect(readback.destroyed).toBe(true);
        expect((queries.mock.results[0]?.value as RHIQuerySet | undefined)?.destroyed).toBe(true);
        backend.destroy();
    });

    it('aborts the active frame and releases transient allocations if timestamp setup fails', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame();
        const queries = vi.spyOn(device, 'createQuerySet').mockImplementationOnce(() => {
            throw new Error('query allocation failed');
        });
        const textures = vi.spyOn(device, 'createTexture');
        const abort = vi.spyOn(device.graphicsQueue, 'abortFrame');
        expect(() =>
            frame.execute(frameContext(device), recordColor, undefined, {
                recordRenderGraphTimeline(snapshot) {
                    void snapshot;
                }
            })
        ).toThrow('query allocation failed');
        expect(abort).toHaveBeenCalledOnce();
        expect((textures.mock.results[0]?.value as RHITexture | undefined)?.destroyed).toBe(true);
        expect(frame.active).toBe(false);
        expect(queries).toHaveBeenCalledOnce();
        frame.destroy();
        backend.destroy();
    });
});
