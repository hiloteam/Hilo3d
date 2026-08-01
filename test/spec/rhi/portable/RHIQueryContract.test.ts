import { describe, expect, it } from 'vitest';
import { RHIBufferUsage, RHITextureUsage } from '../../../../src/render/rhi/core';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from './FakeRHIBackend';

describe('portable RHI query and debug contract', () => {
    it('resolves timestamp queries and retains their native lifetime through submission', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const querySet = device.createQuerySet({
            label: 'timestamps',
            type: 'timestamp',
            count: 2
        });
        const resolve = device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.QUERY_RESOLVE | RHIBufferUsage.COPY_SRC
        });
        const color = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const colorView = color.createView();
        const context = device.graphicsQueue.beginFrame();
        context.pushDebugGroup('frame');
        context.insertDebugMarker('before pass');
        const pass = context.beginRenderPass({
            label: 'timed pass',
            colorAttachments: [
                {
                    view: colorView,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ],
            timestampWrites: {
                querySet,
                beginningOfPassWriteIndex: 0,
                endOfPassWriteIndex: 1
            }
        });
        pass.pushDebugGroup('draws');
        pass.insertDebugMarker('empty pass');
        pass.popDebugGroup();
        pass.end();
        context.resolveQuerySet(querySet, 0, 2, resolve);
        context.popDebugGroup();
        const submission = device.graphicsQueue.endFrame(context);

        querySet.destroy();
        expect(querySet.nativeReleased).toBe(false);
        backend.completeNextSubmission();
        await submission.done;
        expect(querySet.nativeReleased).toBe(true);

        resolve.destroy();
        colorView.destroy();
        color.destroy();
        backend.destroy();
    });

    it('rejects invalid query ranges, resolve buffers, and unbalanced debug groups', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
        const invalidResolve = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        const context = device.graphicsQueue.beginFrame();

        expect(() =>
            context.beginRenderPass({
                colorAttachments: [],
                timestampWrites: {
                    querySet,
                    beginningOfPassWriteIndex: 2
                }
            })
        ).toThrow(/query index exceeds/u);
        expect(() => {
            context.resolveQuerySet(querySet, 0, 2, invalidResolve);
        }).toThrow(/QUERY_RESOLVE/u);
        expect(() => {
            context.popDebugGroup();
        }).toThrow(/stack is empty/u);
        context.pushDebugGroup('unclosed');
        expect(() => device.graphicsQueue.endFrame(context)).toThrow(/unclosed debug groups/u);
        device.graphicsQueue.abortFrame(context);

        querySet.destroy();
        invalidResolve.destroy();
        backend.destroy();
    });

    it('fails before native work on the WebGL2 backend', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();

        expect(() => device.createQuerySet({ type: 'timestamp', count: 2 })).toThrow(
            /timestamp-query feature/u
        );
        backend.destroy();
    });
});
