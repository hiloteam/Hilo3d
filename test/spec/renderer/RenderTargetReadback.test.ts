import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { RenderTargetReadback } from '../../../src/render/renderer/RenderTargetReadback';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { SubmissionResourceTracker } from '../../../src/render/renderer/SubmissionResourceTracker';
import { describe, expect, it } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

function frameContext(device: FakeRHIDevice, frameIndex: number) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 13, height: 7, minDepth: 0, maxDepth: 1 }
    });
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode === 'deferred') await backend.completeNextSubmission().done;
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('RenderTargetReadback on %s', (_name, createBackend) => {
    it('copies an arbitrary MRT region and strips the aligned staging-row padding', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const readback = new RenderTargetReadback(resources, submissions);
        const target = resources.prepare(
            {},
            {
                label: 'readback MRT',
                width: 13,
                height: 7,
                colorFormats: ['rgba8unorm', 'rgba16float']
            }
        );

        const pending = readback.read(frameContext(device, 4), target, {
            attachmentIndex: 1,
            x: 2,
            y: 1,
            width: 5,
            height: 3
        });
        await complete(backend);
        const result = await pending;

        expect(result).toMatchObject({
            format: 'rgba16float',
            width: 5,
            height: 3,
            bytesPerPixel: 8,
            bytesPerRow: 40
        });
        expect(result.data).toHaveLength(120);
        expect([...result.data]).toEqual(new Array<number>(120).fill(0));
        expect(
            backend.executionLog.some(command => command.startsWith('copy-texture-buffer:'))
        ).toBe(true);
        expect(submissions.completedFrame).toBe(4);

        readback.destroy();
        resources.destroy();
        expect(registry.collect(4)).toBe(4);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects invalid regions before submission and remains reusable', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const readback = new RenderTargetReadback(resources, submissions);
        const target = resources.prepare(
            {},
            {
                width: 4,
                height: 3,
                colorFormats: ['rgba8unorm']
            }
        );

        await expect(
            readback.read(frameContext(device, 1), target, {
                attachmentIndex: 1
            })
        ).rejects.toThrow(/does not exist/);
        expect(device.graphicsQueue.pendingSubmission()).toBeUndefined();

        const pending = readback.read(frameContext(device, 2), target, {
            x: 1,
            y: 1,
            width: 2,
            height: 1
        });
        await complete(backend);
        await expect(pending).resolves.toMatchObject({ width: 2, height: 1, bytesPerRow: 8 });

        readback.destroy();
        resources.destroy();
        expect(registry.collect(2)).toBe(2);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });
});
