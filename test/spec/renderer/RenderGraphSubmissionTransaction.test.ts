import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import GeometryData from '../../../src/geometry/GeometryData';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import {
    RenderPipelineHost,
    type RenderPipelineHostLifecycle
} from '../../../src/render/internal/RenderPipelineHost';
import { BufferResourceCache } from '../../../src/render/renderer/BufferResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { TextureResourceCache } from '../../../src/render/renderer/TextureResourceCache';
import type { RGBufferHandle } from '../../../src/render/graph/RenderGraphResource';
import { RHIBufferUsage } from '../../../src/render/rhi/core';
import DataTexture from '../../../src/texture/DataTexture';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

function frameContext(device: FakeRHIDevice, frameIndex = 1) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

describe('Render Graph submission transactions', () => {
    it('returns extracted ownership when a submission fails inside a timeline observer', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame();
        const participant = { prepareCommit: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
        let output: RGBufferHandle | undefined;
        const execution = frame.execute(
            frameContext(device),
            scope => {
                scope.uploads.enlist(participant);
                const buffer = scope.graph.createBuffer('extracted output', {
                    size: 4,
                    usage: RHIBufferUsage.COPY_DST
                });
                output = buffer;
                scope.graph.addPass(
                    {
                        name: 'initialize extracted output',
                        setup(pass) {
                            pass.writeBuffer(buffer, 'copy-destination');
                        },
                        execute(context) {
                            context.commandContext.clearBuffer(context.getBuffer(buffer));
                        }
                    },
                    undefined
                );
                scope.graph.extractBuffer(buffer);
            },
            undefined,
            {
                recordRenderGraphTimeline() {
                    device.destroy();
                }
            }
        );
        expect(execution.submission.status).toBe('failed');
        expect(participant.commit).not.toHaveBeenCalled();
        expect(participant.rollback).toHaveBeenCalledTimes(1);
        if (output === undefined) throw new Error('No extracted output was recorded');
        execution.getExtractedBuffer(output).destroy();
        expect(() => {
            execution.throwCompletionError();
        }).toThrow();
        await expect(execution.submission.done).rejects.toThrow();
        frame.destroy();
        backend.destroy();
    });

    it('rejects source mutation during execute before submission and retries the upload', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderGraphFrame();
        const source = new GeometryData(new Uint8Array([1, 2, 3, 4]), 1);
        const endFrame = vi.spyOn(device.graphicsQueue, 'endFrame');
        const prepareCommit = vi.spyOn(cache, 'prepareCommit');

        expect(() =>
            frame.execute(frameContext(device), scope => {
                cache.beginFrame(1, scope.uploads);
                scope.graph.addPass(
                    {
                        name: 'mutate after upload',
                        setup(pass) {
                            pass.markSideEffect();
                        },
                        prepare() {
                            cache.prepareVertexBuffer(source);
                        },
                        execute() {
                            source.setSubData(0, new Uint8Array([9]));
                        }
                    },
                    undefined
                );
            })
        ).toThrow(/changed after its first use/u);
        expect(endFrame).not.toHaveBeenCalled();
        expect(cache.active).toBe(false);
        expect(device.graphicsQueue.state).toBe('idle');
        expect(cache.diagnostics(source, 'vertex')?.committedRevision).toBe(-1);

        prepareCommit.mockClear();
        frame
            .execute(frameContext(device, 2), scope => {
                cache.beginFrame(2, scope.uploads);
                cache.prepareVertexBuffer(source);
            })
            .throwCompletionError();
        expect(prepareCommit).toHaveBeenCalledTimes(1);
        expect(cache.diagnostics(source, 'vertex')?.committedRevision).toBe(source.revision);
        frame.destroy();
        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('completes submitted host lifecycle and later participants after publication fails', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const fail = (): never => {
            throw new Error('unexpected lifecycle operation');
        };
        const completeFrame = vi.fn<RenderPipelineHostLifecycle['completeFrame']>();
        const endFrame = vi.fn<RenderPipelineHostLifecycle['endFrame']>();
        const host = new RenderPipelineHost({
            createPipelineRenderTarget: fail,
            createFrameContext: index => frameContext(device, index),
            beginFrame: vi.fn(),
            completeFrame,
            failFrame: vi.fn(),
            endFrame,
            createPipelineStorageBuffer: fail,
            warmupStorageGraphicsShaders: () => Promise.resolve(),
            createPipelineContext: fail,
            endPipelineInvocation: vi.fn()
        });
        const runtime = {
            name: 'transaction test',
            record: vi.fn(),
            destroy: vi.fn(),
            frameSubmitted: vi.fn(),
            frameDiscarded: vi.fn()
        };
        await host.initialize({ name: runtime.name, create: () => runtime }, device.capabilities);
        const failure = new Error('publication failure');
        const first = {
            prepareCommit: vi.fn(),
            commit: vi.fn(() => {
                throw failure;
            }),
            rollback: vi.fn()
        };
        const second = { prepareCommit: vi.fn(), commit: vi.fn(), rollback: vi.fn() };

        expect(() => {
            host.execute(() => {
                const scope = host.requireActiveScope();
                scope.uploads.enlist(first);
                scope.uploads.enlist(second);
            });
        }).toThrow(failure);
        expect(second.commit).toHaveBeenCalledTimes(1);
        expect(first.rollback).not.toHaveBeenCalled();
        expect(second.rollback).not.toHaveBeenCalled();
        expect(runtime.frameSubmitted).toHaveBeenCalledTimes(1);
        expect(runtime.frameDiscarded).not.toHaveBeenCalled();
        expect(completeFrame).toHaveBeenCalledTimes(1);
        expect(endFrame).toHaveBeenLastCalledWith(true);
        expect(() => {
            host.execute(() => undefined);
        }).not.toThrow();
        host.destroy();
        backend.destroy();
    });

    it('finishes a texture cache when releasing its submitted CPU source throws', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderGraphFrame();
        const texture = new DataTexture({ data: new Uint8Array([1, 2, 3, 4]) });
        const failure = new Error('CPU source release failed');
        vi.spyOn(texture, 'releaseImageIfAllowed').mockImplementationOnce(() => {
            throw failure;
        });
        const execution = frame.execute(frameContext(device), scope => {
            cache.beginFrame(1, scope.uploads);
            cache.prepare(texture);
        });
        expect(() => {
            execution.throwCompletionError();
        }).toThrow(failure);
        expect(cache.active).toBe(false);
        expect(() => {
            frame
                .execute(frameContext(device, 2), scope => {
                    cache.beginFrame(2, scope.uploads);
                    cache.prepare(texture);
                })
                .throwCompletionError();
        }).not.toThrow();
        frame.destroy();
        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects foreign and failed submissions after validating the pending batch', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const foreignBackend = new FakeWebGLRHIBackend();
        const foreign = foreignBackend.createDevice();
        const batch = new RHIUploadBatch(new FrameArena());
        const participant = { prepareCommit: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
        batch.enlist(participant);
        const context = device.graphicsQueue.beginFrame();
        batch.flush(context);
        batch.validateSubmission(device);
        const other = foreign.graphicsQueue.endFrame(foreign.graphicsQueue.beginFrame());
        expect(() => {
            batch.commit(other);
        }).toThrow(/another device/u);
        const submission = device.graphicsQueue.endFrame(context);
        const failure = new Error('submission failed');
        expect(() => {
            batch.commit({
                id: submission.id,
                deviceId: submission.deviceId,
                deviceGeneration: submission.deviceGeneration,
                frameId: submission.frameId,
                done: submission.done,
                status: 'failed',
                error: failure
            });
        }).toThrow(failure);
        expect(participant.commit).not.toHaveBeenCalled();
        expect(participant.rollback).toHaveBeenCalledTimes(1);
        backend.destroy();
        foreignBackend.destroy();
    });
});
