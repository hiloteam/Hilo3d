import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import {
    RendererStorageBuffer,
    type StorageBufferHost,
    type StorageBufferReadback
} from '../../../src/render/StorageBuffer';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { StorageBufferReadbackService } from '../../../src/render/renderer/StorageBufferReadback';
import { StorageBufferResourceCache } from '../../../src/render/renderer/StorageBufferResourceCache';
import { SubmissionResourceTracker } from '../../../src/render/renderer/SubmissionResourceTracker';
import { RHIBufferUsage } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeRHIBuffer,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

const HOST: StorageBufferHost = Object.freeze({
    backend: 'webgpu',
    assertStorageBufferMutationAllowed(operation: string): void {
        void operation;
    },
    storageBufferWritten(buffer: RendererStorageBuffer): void {
        void buffer;
    },
    readStorageBuffer(
        _buffer: RendererStorageBuffer,
        _byteOffset: number,
        _byteLength: number
    ): Promise<StorageBufferReadback> {
        return Promise.reject(new Error('StorageBufferReadback fixture uses the service directly'));
    },
    storageBufferDestroyed(buffer: RendererStorageBuffer): void {
        void buffer;
    }
});

function frameContext(device: FakeRHIDevice, frameIndex: number) {
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

function sourceBuffer(
    recovery: 'cpu-shadow' | 'reinitialize' = 'cpu-shadow'
): RendererStorageBuffer {
    return new RendererStorageBuffer(HOST, {
        label: 'readback source',
        byteLength: 16,
        usage: ['storage', 'copy-source', 'copy-destination'],
        initialData: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
        recovery
    });
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    await backend.completeNextSubmission().done;
}

describe('StorageBufferReadbackService', () => {
    it('copies the requested range, waits for submission, maps it, and rejects foreign contexts', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new StorageBufferResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const service = new StorageBufferReadbackService(resources, submissions);
        const source = sourceBuffer();
        const foreignDevice = backend.createDevice();

        await expect(service.read(frameContext(foreignDevice, 1), source, 4, 8)).rejects.toThrow(
            /another RHI generation/u
        );
        expect(foreignDevice.graphicsQueue.pendingSubmission()).toBeUndefined();

        const pending = service.read(frameContext(device, 1), source, 4, 8);
        expect(submissions.pendingSubmissionCount).toBe(1);
        await complete(backend);
        await expect(pending).resolves.toEqual({
            data: new Uint8Array([4, 5, 6, 7, 8, 9, 10, 11]),
            byteOffset: 4,
            byteLength: 8
        });
        expect(submissions.completedFrame).toBe(1);
        expect(backend.executionLog.some(command => /^copy-buffer:\d+:\d+:8$/u.test(command))).toBe(
            true
        );

        service.destroy();
        await expect(service.read(frameContext(device, 2), source, 0, 4)).rejects.toThrow(
            /service is destroyed/u
        );
        resources.destroy();
        registry.collect(1);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('destroys an unmapped staging buffer after map failure and remains reusable', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new StorageBufferResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const service = new StorageBufferReadbackService(resources, submissions);
        const source = sourceBuffer();
        const created: FakeRHIBuffer[] = [];
        const createBuffer = device.createBuffer.bind(device);
        const createSpy = vi.spyOn(device, 'createBuffer').mockImplementation(descriptor => {
            const buffer = createBuffer(descriptor);
            created.push(buffer);
            return buffer;
        });
        const mapSpy = vi
            .spyOn(FakeRHIBuffer.prototype, 'mapAsync')
            .mockRejectedValueOnce(new Error('mapping unavailable'));

        const failed = service.read(frameContext(device, 1), source, 0, 4);
        await complete(backend);
        await expect(failed).rejects.toThrow(/mapping unavailable/u);
        const failedStaging = created.find(
            buffer => (buffer.usage & RHIBufferUsage.MAP_READ) !== 0
        );
        expect(failedStaging).toBeDefined();
        expect(failedStaging?.mapState).toBe('unmapped');
        expect(failedStaging?.destroyed).toBe(true);

        mapSpy.mockRestore();
        createSpy.mockRestore();
        const retried = service.read(frameContext(device, 2), source, 8, 4);
        await complete(backend);
        await expect(retried).resolves.toEqual({
            data: new Uint8Array([8, 9, 10, 11]),
            byteOffset: 8,
            byteLength: 4
        });

        service.destroy();
        resources.destroy();
        registry.collect(2);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects concurrent requests while reusable pass parameters are retained', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new StorageBufferResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const service = new StorageBufferReadbackService(resources, submissions);
        const source = sourceBuffer();

        const pending = service.read(frameContext(device, 1), source, 0, 4);
        await expect(service.read(frameContext(device, 2), source, 4, 4)).rejects.toThrow(
            /pending request/u
        );
        expect(() => {
            service.destroy();
        }).toThrow(/active storage-buffer readback/u);
        await complete(backend);
        await expect(pending).resolves.toMatchObject({ data: new Uint8Array([0, 1, 2, 3]) });

        service.destroy();
        resources.destroy();
        registry.collect(1);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('refuses stale reinitialize contents after recovery before creating a submission', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const resources = new StorageBufferResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const service = new StorageBufferReadbackService(resources, submissions);
        const source = sourceBuffer('reinitialize');

        const initial = service.read(frameContext(firstDevice, 1), source, 0, 4);
        await complete(backend);
        await expect(initial).resolves.toMatchObject({
            data: new Uint8Array([0, 1, 2, 3])
        });

        const replacement = backend.createDevice();
        registry.recover(replacement);
        await expect(service.read(frameContext(replacement, 2), source, 0, 4)).rejects.toThrow(
            /complete write after device recovery/u
        );
        expect(replacement.graphicsQueue.pendingSubmission()).toBeUndefined();
        expect(resources.diagnostics(source)?.initialized).toBe(false);

        service.destroy();
        resources.destroy();
        registry.collect(1);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('requires the resource cache and submission tracker to share one registry', () => {
        const backend = new FakeWebGPURHIBackend();
        const firstRegistry = new ResourceRegistry(backend.createDevice());
        const secondRegistry = new ResourceRegistry(backend.createDevice());
        const resources = new StorageBufferResourceCache(firstRegistry);
        const submissions = new SubmissionResourceTracker(secondRegistry);

        expect(() => new StorageBufferReadbackService(resources, submissions)).toThrow(
            /share one ResourceRegistry/u
        );

        resources.destroy();
        firstRegistry.destroy();
        submissions.destroy();
        secondRegistry.destroy();
        backend.destroy();
    });
});
