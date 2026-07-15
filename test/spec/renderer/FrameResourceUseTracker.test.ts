import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import { FrameResourceUseTracker } from '../../../src/render/renderer/FrameResourceUseTracker';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { RHIBufferUsage } from '../../../src/render/rhi/core';
import { describe, expect, it } from 'vitest';
import { FakeWebGLRHIBackend } from '../rhi/v2/FakeRHIBackend';

function submitEmptyFrame(
    batch: RHIUploadBatch,
    device: ReturnType<FakeWebGLRHIBackend['createDevice']>
) {
    const context = device.graphicsQueue.beginFrame();
    batch.flush(context);
    return device.graphicsQueue.endFrame(context);
}

describe('FrameResourceUseTracker', () => {
    it('retains build-time handles and publishes last-used-frame only on commit', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const handle = registry.registerBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_SRC
        });
        const resource = registry.resolve(handle);
        const batch = new RHIUploadBatch(new FrameArena());
        const uses = new FrameResourceUseTracker(registry);

        uses.beginFrame(5, batch);
        uses.use(handle);
        registry.release(handle);
        expect(uses.stagedUseCount).toBe(1);
        expect(registry.collect(5)).toBe(0);

        batch.commit(submitEmptyFrame(batch, device));
        expect(uses.active).toBe(false);
        expect(uses.stagedUseCount).toBe(0);
        expect(registry.collect(4)).toBe(0);
        expect(resource.destroyed).toBe(false);
        expect(registry.collect(5)).toBe(1);
        expect(resource.destroyed).toBe(true);

        uses.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rolls back duplicate retains without publishing the failed frame index', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const handle = registry.registerBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_SRC
        });
        const resource = registry.resolve(handle);
        const batch = new RHIUploadBatch(new FrameArena());
        const uses = new FrameResourceUseTracker(registry);

        uses.beginFrame(9, batch);
        uses.use(handle);
        uses.use(handle);
        registry.release(handle);
        batch.rollback();

        expect(uses.active).toBe(false);
        expect(registry.collect(0)).toBe(1);
        expect(resource.destroyed).toBe(true);
        expect(() => {
            uses.use(handle);
        }).toThrow(/requires beginFrame/u);
        uses.destroy();
        expect(() => {
            uses.beginFrame(10, batch);
        }).toThrow(/destroyed/u);
        registry.destroy();
        backend.destroy();
    });

    it('rejects a submission from another device before releasing staged ownership', () => {
        const firstBackend = new FakeWebGLRHIBackend();
        const secondBackend = new FakeWebGLRHIBackend();
        const firstDevice = firstBackend.createDevice();
        const secondDevice = secondBackend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const handle = registry.registerBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
        const uses = new FrameResourceUseTracker(registry);
        const batch = new RHIUploadBatch(new FrameArena());
        uses.beginFrame(1, batch);
        uses.use(handle);
        const foreignContext = secondDevice.graphicsQueue.beginFrame();
        const foreignSubmission = secondDevice.graphicsQueue.endFrame(foreignContext);

        expect(() => {
            uses.prepareCommit(foreignSubmission);
        }).toThrow(/another RHI device/u);
        expect(uses.stagedUseCount).toBe(1);
        batch.rollback();
        registry.release(handle);
        expect(registry.collect(0)).toBe(1);
        uses.destroy();
        registry.destroy();
        firstBackend.destroy();
        secondBackend.destroy();
    });
});
