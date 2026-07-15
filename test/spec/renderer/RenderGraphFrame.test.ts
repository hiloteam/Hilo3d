import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import type { RGBufferHandle } from '../../../src/render/graph/RenderGraphResource';
import { RHIBufferUsage } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    type FakeRHIBuffer,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

function frameContext(device: FakeRHIDevice, frameIndex = 0) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 16, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

describe('RenderGraphFrameContext', () => {
    it('freezes frame identity and snapshots viewport values', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const viewport = { x: 1, y: 2, width: 16, height: 8, minDepth: 0, maxDepth: 1 };
        const context = createRenderGraphFrameContext({
            renderer: {} as RendererCore,
            rhi: device,
            frameIndex: 4,
            camera: new PerspectiveCamera(),
            lightManager: new LightManager(),
            fog: null,
            viewport
        });
        viewport.width = 1;

        expect(context.frameIndex).toBe(4);
        expect(context.viewport.width).toBe(16);
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.viewport)).toBe(true);
        expect(() => frameContext(device, -1)).toThrow(RangeError);
        backend.destroy();
    });
});

describe('RenderGraphFrame', () => {
    it('builds, compiles, executes, and returns extracted resources in one frame', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const sourceBuffer = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_SRC | RHIBufferUsage.COPY_DST
        });
        const uploadData = new Uint8Array([2, 7, 1, 8]);
        const frame = new RenderGraphFrame(4);
        let output: RGBufferHandle | undefined;
        const result = frame.execute(frameContext(device, 12), scope => {
            scope.uploads.writeBuffer(sourceBuffer, 0, uploadData);
            uploadData.fill(9);
            const source = scope.graph.importBuffer('source', sourceBuffer);
            const destination = scope.graph.createBuffer('output', {
                size: 4,
                usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.COPY_SRC
            });
            output = destination;
            const copy: RenderPassTemplate<undefined> = {
                name: 'frame copy',
                setup(pass) {
                    pass.readBuffer(source);
                    pass.writeBuffer(destination);
                },
                execute(context) {
                    context.commandContext.copyBufferToBuffer(
                        context.getBuffer(source),
                        0,
                        context.getBuffer(destination),
                        0,
                        4
                    );
                }
            };
            scope.graph.addPass(copy, undefined);
            scope.graph.extractBuffer(destination);
        });

        await result.submission.done;
        if (output === undefined) throw new Error('test frame did not create its output');
        const extracted = result.getExtractedBuffer(output) as FakeRHIBuffer;
        expect([...extracted.snapshotBytes()]).toEqual([2, 7, 1, 8]);
        expect(result.diagnostics.frameArenaGrowths).toBe(0);
        expect(result.diagnostics.commandCount).toBe(2);
        expect(frame.active).toBe(false);
        extracted.destroy();
        backend.destroy();
    });

    it('reuses arena capacity and one mutable diagnostics object across frames', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame(4);
        const first = frame.execute(frameContext(device, 1), scope => {
            scope.arena.allocate(8);
        });
        const diagnostics = first.diagnostics;
        expect(diagnostics.frameArenaGrowths).toBe(1);

        const second = frame.execute(frameContext(device, 2), scope => {
            scope.arena.allocate(8);
        });
        expect(second.diagnostics).toBe(diagnostics);
        expect(second.diagnostics.frameArenaGrowths).toBe(0);
        expect(frame.arena.capacity).toBe(8);
        backend.destroy();
    });

    it('rejects async/nested build and leaves the queue idle after build or execute failure', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame();
        const context = frameContext(device);

        expect(() => frame.execute(context, () => Promise.resolve())).toThrow(
            /must be synchronous/u
        );
        expect(device.graphicsQueue.state).toBe('idle');

        frame.execute(context, () => {
            expect(() => frame.execute(context, () => undefined)).toThrow(/Nested execution/u);
        });
        expect(frame.active).toBe(false);

        const failure = new Error('pass failed');
        expect(() =>
            frame.execute(context, scope => {
                const failPass: RenderPassTemplate<undefined> = {
                    name: 'fail',
                    setup(pass) {
                        pass.markSideEffect();
                    },
                    execute() {
                        throw failure;
                    }
                };
                scope.graph.addPass(failPass, undefined);
            })
        ).toThrow(failure);
        expect(device.graphicsQueue.state).toBe('idle');
        expect(frame.active).toBe(false);
        backend.destroy();
    });

    it('rejects invalid uploads after compile but before queue execution begins', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const frame = new RenderGraphFrame(4);
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const invalidDestination = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_SRC
        });

        expect(() =>
            frame.execute(frameContext(device), scope => {
                scope.uploads.writeBuffer(invalidDestination, 0, new Uint8Array([1, 2, 3, 4]));
            })
        ).toThrow(/lacks COPY_DST/u);
        expect(beginFrame).not.toHaveBeenCalled();
        expect(device.graphicsQueue.state).toBe('idle');
        expect(frame.active).toBe(false);
        backend.destroy();
    });
});
