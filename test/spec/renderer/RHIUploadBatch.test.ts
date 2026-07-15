import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import { RHIBufferUsage, RHITextureUsage } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebGLRHIBackend } from '../rhi/v2/FakeRHIBackend';

describe('RHIUploadBatch', () => {
    it('snapshots and merges adjacent buffer updates before flushing', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const destination = device.createBuffer({
            size: 8,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.COPY_SRC
        });
        const arena = new FrameArena(8);
        const batch = new RHIUploadBatch(arena);
        const first = new Uint8Array([1, 2, 3, 4]);
        const second = new Uint8Array([5, 6, 7, 8]);
        batch.writeBuffer(destination, 0, first);
        batch.writeBuffer(destination, 4, second);
        first.fill(9);
        second.fill(9);
        expect(batch.pendingCount).toBe(1);

        const context = device.graphicsQueue.beginFrame();
        batch.flush(context);
        const submission = device.graphicsQueue.endFrame(context);
        await submission.done;
        expect([...destination.snapshotBytes()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(backend.executionLog.filter(item => item.startsWith('write-buffer:'))).toHaveLength(
            1
        );
        const freshContext = device.graphicsQueue.beginFrame();
        expect(() => {
            batch.flush(freshContext);
        }).toThrow(/already been flushed/u);
        device.graphicsQueue.abortFrame(freshContext);
        backend.destroy();
    });

    it('reuses texture record storage and snapshots source bytes across frames', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const texture = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST
        });
        const arena = new FrameArena(8);
        const reuseView = vi.spyOn(arena, 'reuseView');
        const batch = new RHIUploadBatch(arena);
        const source = new Uint8Array([10, 20, 30, 40]);
        batch.writeTexture({ texture }, source, {}, { width: 1, height: 1 });
        source.fill(0);
        const firstContext = device.graphicsQueue.beginFrame();
        batch.flush(firstContext);
        await device.graphicsQueue.endFrame(firstContext).done;
        expect([...texture.snapshotLastWriteBytes()]).toEqual([10, 20, 30, 40]);
        const firstUploadView: unknown = reuseView.mock.results.at(-1)?.value;

        arena.reset();
        batch.reset();
        const second = new Uint8Array([1, 3, 3, 7]);
        batch.writeTexture({ texture }, second, {}, { width: 1, height: 1 });
        const secondContext = device.graphicsQueue.beginFrame();
        batch.flush(secondContext);
        await device.graphicsQueue.endFrame(secondContext).done;
        expect([...texture.snapshotLastWriteBytes()]).toEqual([1, 3, 3, 7]);
        expect(reuseView.mock.results.at(-1)?.value).toBe(firstUploadView);
        backend.destroy();
    });

    it('prevalidates upload ownership, usage, ranges, and image layouts without a frame', () => {
        const firstBackend = new FakeWebGLRHIBackend();
        const secondBackend = new FakeWebGLRHIBackend();
        const firstDevice = firstBackend.createDevice();
        const secondDevice = secondBackend.createDevice();

        const foreignBatch = new RHIUploadBatch(new FrameArena(4));
        foreignBatch.writeBuffer(
            secondDevice.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST }),
            0,
            new Uint8Array(4)
        );
        expect(() => {
            foreignBatch.validate(firstDevice);
        }).toThrow(/belongs to device/u);
        expect(firstDevice.graphicsQueue.state).toBe('idle');

        const usageBatch = new RHIUploadBatch(new FrameArena(4));
        usageBatch.writeBuffer(
            firstDevice.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC }),
            0,
            new Uint8Array(4)
        );
        expect(() => {
            usageBatch.validate(firstDevice);
        }).toThrow(/lacks COPY_DST/u);

        const rangeBatch = new RHIUploadBatch(new FrameArena(8));
        rangeBatch.writeBuffer(
            firstDevice.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST }),
            4,
            new Uint8Array(4)
        );
        expect(() => {
            rangeBatch.validate(firstDevice);
        }).toThrow(/exceeds the buffer size/u);

        const textureBatch = new RHIUploadBatch(new FrameArena(4));
        textureBatch.writeTexture(
            {
                texture: firstDevice.createTexture({
                    size: { width: 2, height: 2 },
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.COPY_DST
                })
            },
            new Uint8Array(4),
            {},
            { width: 2, height: 2 }
        );
        expect(() => {
            textureBatch.validate(firstDevice);
        }).toThrow(/bytesPerRow/u);
        expect(firstDevice.graphicsQueue.state).toBe('idle');

        firstBackend.destroy();
        secondBackend.destroy();
    });

    it('flushes external images before encoded uploads and rejects dimension drift pre-frame', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const buffer = device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
        const byteTexture = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST
        });
        const externalTexture = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.RENDER_ATTACHMENT
        });
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const batch = new RHIUploadBatch(new FrameArena(16));
        batch.writeBuffer(buffer, 0, new Uint8Array([1, 2, 3, 4]));
        batch.writeTexture(
            { texture: byteTexture },
            new Uint8Array([5, 6, 7, 8]),
            {},
            { width: 1 }
        );
        batch.copyExternalImageToTexture(
            { source: canvas, flipY: true },
            { texture: externalTexture, premultipliedAlpha: true },
            { width: 1 }
        );
        expect(batch.pendingCount).toBe(3);
        expect(() => {
            batch.validate(device);
        }).not.toThrow();

        const context = device.graphicsQueue.beginFrame();
        batch.flush(context);
        await device.graphicsQueue.endFrame(context).done;
        const external = backend.executionLog.findIndex(command =>
            command.startsWith('copy-external-texture:')
        );
        const bufferWrite = backend.executionLog.findIndex(command =>
            command.startsWith('write-buffer:')
        );
        const textureWrite = backend.executionLog.findIndex(command =>
            command.startsWith('write-texture:')
        );
        expect(external).toBeGreaterThanOrEqual(0);
        expect(bufferWrite).toBeGreaterThan(external);
        expect(textureWrite).toBeGreaterThan(bufferWrite);

        batch.reset();
        batch.copyExternalImageToTexture(
            { source: canvas },
            { texture: externalTexture },
            { width: 1 }
        );
        canvas.width = 2;
        expect(() => {
            batch.validate(device);
        }).toThrow(/dimensions changed/u);
        expect(device.graphicsQueue.state).toBe('idle');
        backend.destroy();
    });

    it('prevalidates and flushes mipmap generation after level-zero uploads', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const texture = device.createTexture({
            size: { width: 2, height: 2 },
            mipLevelCount: 2,
            format: 'rgba8unorm',
            usage:
                RHITextureUsage.COPY_DST |
                RHITextureUsage.TEXTURE_BINDING |
                RHITextureUsage.RENDER_ATTACHMENT
        });
        const batch = new RHIUploadBatch(new FrameArena(16));
        batch.writeTexture(
            { texture },
            new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
            { bytesPerRow: 8 },
            { width: 2, height: 2 }
        );
        batch.generateMipmaps(texture);
        expect(batch.pendingCount).toBe(2);
        expect(() => {
            batch.validate(device);
        }).not.toThrow();
        expect(device.graphicsQueue.state).toBe('idle');

        const context = device.graphicsQueue.beginFrame();
        batch.flush(context);
        await device.graphicsQueue.endFrame(context).done;
        const upload = backend.executionLog.findIndex(command =>
            command.startsWith('write-texture:')
        );
        const generate = backend.executionLog.findIndex(command =>
            command.startsWith('generate-mipmaps:')
        );
        expect(upload).toBeGreaterThanOrEqual(0);
        expect(generate).toBeGreaterThan(upload);

        const invalid = new RHIUploadBatch(new FrameArena(4));
        const compressed = device.createTexture({
            size: { width: 4, height: 4 },
            mipLevelCount: 2,
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        invalid.generateMipmaps(compressed);
        expect(() => {
            invalid.validate(device);
        }).toThrow(/lacks RENDER_ATTACHMENT/u);
        expect(device.graphicsQueue.state).toBe('idle');
        backend.destroy();
    });
});
