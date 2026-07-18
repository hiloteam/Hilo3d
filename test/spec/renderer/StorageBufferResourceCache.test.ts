import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import {
    RendererStorageBuffer,
    type StorageBufferHost,
    type StorageBufferReadback
} from '../../../src/render/StorageBuffer';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import type {
    RGPassBuilder,
    RenderPassTemplate
} from '../../../src/render/graph/RenderGraphBuilder';
import type { RGPassContext } from '../../../src/render/graph/RenderGraphExecutor';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { StorageBufferResourceCache } from '../../../src/render/renderer/StorageBufferResourceCache';
import { RHIBufferUsage, type RHIBuffer } from '../../../src/render/rhi/core';
import { describe, expect, it } from 'vitest';
import {
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIBuffer,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

const SIDE_EFFECT_PASS: RenderPassTemplate<undefined> = Object.freeze({
    name: 'StorageBufferResourceCache test',
    setup(builder: RGPassBuilder): void {
        builder.markSideEffect();
    },
    execute(context: RGPassContext): void {
        void context;
    }
});

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
        return Promise.reject(new Error('StorageBufferResourceCache fixture does not read'));
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

function runCacheFrame(
    frame: RenderGraphFrame,
    device: FakeRHIDevice,
    frameIndex: number,
    cache: StorageBufferResourceCache,
    build: () => void
) {
    return frame.execute(frameContext(device, frameIndex), scope => {
        cache.beginFrame(frameIndex, scope.uploads);
        build();
        scope.graph.addPass(SIDE_EFFECT_PASS, undefined);
    });
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    await backend.completeNextSubmission().done;
}

function storageBuffer(
    label: string,
    recovery: 'cpu-shadow' | 'reinitialize' = 'cpu-shadow',
    initialData: Uint8Array = new Uint8Array(16)
): RendererStorageBuffer {
    return new RendererStorageBuffer(HOST, {
        label,
        byteLength: 16,
        usage: ['storage', 'indirect', 'copy-source', 'copy-destination'],
        initialData,
        recovery
    });
}

describe('StorageBufferResourceCache', () => {
    it('reuses one allocation, maps public usages, and uploads only the aligned dirty span', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new StorageBufferResourceCache(registry);
        const frame = new RenderGraphFrame();
        const source = storageBuffer(
            'cluster indices',
            'cpu-shadow',
            new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
        );
        let first: FakeRHIBuffer | undefined;

        runCacheFrame(frame, device, 1, cache, () => {
            first = cache.prepare(source) as FakeRHIBuffer;
            expect(cache.getHandle(source)).toBe(cache.diagnostics(source)?.handle);
            expect(cache.isInitializedAtFrameStart(source)).toBe(true);
        });
        await complete(backend);
        if (first === undefined) throw new Error('Storage buffer was not prepared');
        expect(first.usage).toBe(
            RHIBufferUsage.STORAGE |
                RHIBufferUsage.INDIRECT |
                RHIBufferUsage.COPY_SRC |
                RHIBufferUsage.COPY_DST
        );
        expect([...first.snapshotBytes()]).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 0, 0, 0, 0
        ]);

        backend.resetExecutionLog();
        let reused: RHIBuffer | undefined;
        runCacheFrame(frame, device, 2, cache, () => {
            reused = cache.prepare(source);
        });
        await complete(backend);
        expect(reused).toBe(first);
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            []
        );

        source.write(4, new Uint8Array([9, 10, 11, 12]));
        backend.resetExecutionLog();
        runCacheFrame(frame, device, 3, cache, () => {
            expect(cache.prepare(source)).toBe(first);
        });
        await complete(backend);
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            [`write-buffer:${String(first.id)}:4:4`]
        );
        expect([...first.snapshotBytes()]).toEqual([
            1, 2, 3, 4, 9, 10, 11, 12, 0, 0, 0, 0, 0, 0, 0, 0
        ]);
        expect(cache.diagnostics(source)).toMatchObject({
            committedRevision: source.revision,
            sourceRevision: source.revision,
            initialized: true
        });

        cache.destroy();
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rolls metadata back when a source changes after capture and retries the full transaction', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new StorageBufferResourceCache(registry);
        const frame = new RenderGraphFrame();
        const source = storageBuffer('particles');
        let resource: FakeRHIBuffer | undefined;

        runCacheFrame(frame, device, 1, cache, () => {
            resource = cache.prepare(source) as FakeRHIBuffer;
        });
        await complete(backend);
        const committedBeforeFailure = cache.diagnostics(source)?.committedRevision;

        source.write(0, new Uint8Array([1, 2, 3, 4]));
        expect(() =>
            runCacheFrame(frame, device, 2, cache, () => {
                cache.prepare(source);
                source.write(4, new Uint8Array([5, 6, 7, 8]));
            })
        ).toThrow(/changed after its first use/u);
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(source)?.committedRevision).toBe(committedBeforeFailure);
        await complete(backend);

        backend.resetExecutionLog();
        runCacheFrame(frame, device, 3, cache, () => {
            expect(cache.prepare(source)).toBe(resource);
        });
        await complete(backend);
        expect(cache.diagnostics(source)?.committedRevision).toBe(source.revision);
        expect([...(resource?.snapshotBytes() ?? [])].slice(0, 8)).toEqual([
            1, 2, 3, 4, 5, 6, 7, 8
        ]);
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            [`write-buffer:${String(resource?.id)}:0:8`]
        );

        cache.destroy();
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('commits GPU divergence transactionally so same-shadow CPU writes still upload', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new StorageBufferResourceCache(registry);
        const frame = new RenderGraphFrame();
        const source = storageBuffer(
            'GPU-mutated particles',
            'cpu-shadow',
            new Uint8Array([1, 2, 3, 4])
        );

        expect(() =>
            runCacheFrame(frame, device, 1, cache, () => {
                cache.prepare(source);
                cache.stageGPUWrite(source);
                throw new Error('discard GPU mutation');
            })
        ).toThrow(/discard GPU mutation/u);
        const beforeNoop = source.revision;
        source.write(0, new Uint8Array([1, 2, 3, 4]));
        expect(source.revision).toBe(beforeNoop);

        runCacheFrame(frame, device, 2, cache, () => {
            cache.prepare(source);
            cache.stageGPUWrite(source);
        });
        await complete(backend);
        const beforeRewrite = source.revision;
        source.write(0, new Uint8Array([1, 2, 3, 4]));
        expect(source.revision).toBe(beforeRewrite + 1);

        cache.destroy();
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('coalesces many post-GPU CPU writes without restoring the whole CPU shadow', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new StorageBufferResourceCache(registry);
        const frame = new RenderGraphFrame();
        const source = new RendererStorageBuffer(HOST, {
            label: 'large GPU-authored particle state',
            byteLength: 512,
            usage: ['storage', 'copy-source', 'copy-destination']
        });
        let resource: FakeRHIBuffer | undefined;

        runCacheFrame(frame, device, 1, cache, () => {
            resource = cache.prepare(source) as FakeRHIBuffer;
            cache.stageGPUWrite(source);
        });
        await complete(backend);

        for (let value = 0; value < 80; value += 1) {
            source.write(0, new Uint32Array([value]));
        }
        backend.resetExecutionLog();
        runCacheFrame(frame, device, 2, cache, () => {
            cache.prepare(source);
        });
        await complete(backend);

        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            [`write-buffer:${String(resource?.id)}:0:4`]
        );

        cache.destroy();
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('restores CPU shadows but leaves reinitialize buffers empty and uninitialized', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new StorageBufferResourceCache(registry);
        const frame = new RenderGraphFrame();
        const cpuShadow = storageBuffer(
            'recoverable clusters',
            'cpu-shadow',
            new Uint8Array([1, 2, 3, 4])
        );
        const reinitialize = storageBuffer(
            'transient particles',
            'reinitialize',
            new Uint8Array([9, 9, 9, 9, 8, 8, 8, 8])
        );

        runCacheFrame(frame, firstDevice, 1, cache, () => {
            cache.prepare(cpuShadow);
            cache.prepare(reinitialize);
        });
        await complete(backend);
        cpuShadow.write(4, new Uint8Array([5, 6, 7, 8]));
        reinitialize.write(8, new Uint8Array([7, 7, 7, 7]));
        runCacheFrame(frame, firstDevice, 2, cache, () => {
            cache.prepare(cpuShadow);
            cache.prepare(reinitialize);
        });
        await complete(backend);

        const replacement = backend.createDevice();
        registry.recover(replacement);
        cache.synchronizeAfterRecovery();
        const reinitializeRecoveryRevision = reinitialize.revision;
        reinitialize.write(12, new Uint8Array([6, 6, 6, 6]));
        const cpuDiagnostics = cache.diagnostics(cpuShadow);
        const reinitializeDiagnostics = cache.diagnostics(reinitialize);
        if (cpuDiagnostics === null || reinitializeDiagnostics === null) {
            throw new Error('Recovery diagnostics are unavailable');
        }
        const recoveredCpu = registry.resolve(cpuDiagnostics.handle) as FakeRHIBuffer;
        const recoveredReinitialize = registry.resolve(
            reinitializeDiagnostics.handle
        ) as FakeRHIBuffer;

        expect([...recoveredCpu.snapshotBytes()].slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect([...recoveredReinitialize.snapshotBytes()]).toEqual(new Array<number>(16).fill(0));
        expect(cpuDiagnostics).toMatchObject({
            committedRevision: cpuShadow.revision,
            initialized: true
        });
        expect(reinitializeDiagnostics).toMatchObject({
            committedRevision: reinitializeRecoveryRevision,
            initialized: false
        });

        backend.resetExecutionLog();
        runCacheFrame(frame, replacement, 3, cache, () => {
            cache.prepare(cpuShadow);
            cache.prepare(reinitialize);
            expect(cache.isInitializedAtFrameStart(cpuShadow)).toBe(true);
            expect(cache.isInitializedAtFrameStart(reinitialize)).toBe(false);
        });
        await complete(backend);
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            [`write-buffer:${String(recoveredReinitialize.id)}:12:4`]
        );
        expect([...recoveredReinitialize.snapshotBytes()]).toEqual([
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 6, 6
        ]);

        expect(() =>
            runCacheFrame(frame, replacement, 4, cache, () => {
                cache.prepare(reinitialize);
                cache.stageCompleteGPUWrite(reinitialize);
                throw new Error('GPU initializer failed');
            })
        ).toThrow(/GPU initializer failed/u);
        expect(cache.diagnostics(reinitialize)?.initialized).toBe(false);

        runCacheFrame(frame, replacement, 5, cache, () => {
            cache.prepare(reinitialize);
            cache.stageCompleteGPUWrite(reinitialize);
        });
        await complete(backend);
        expect(cache.diagnostics(reinitialize)?.initialized).toBe(true);

        cache.destroy();
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('recovers a destroyed CPU-shadow recipe before its submission-aware retirement', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new StorageBufferResourceCache(registry);
        const frame = new RenderGraphFrame();
        const source = storageBuffer(
            'destroyed recoverable clusters',
            'cpu-shadow',
            new Uint8Array([1, 2, 3, 4])
        );

        runCacheFrame(frame, firstDevice, 1, cache, () => {
            cache.prepare(source);
        });
        await complete(backend);

        source.destroy();
        expect(() => {
            source.cpuData();
        }).toThrow(/destroyed/u);
        expect(cache.detach(source)).toBe(true);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 1,
            pendingReleaseCount: 1
        });

        const replacement = backend.createDevice();
        expect(() => {
            registry.recover(replacement);
        }).not.toThrow();
        expect(registry.diagnostics()).toMatchObject({
            state: 'active',
            trackedResourceCount: 1,
            pendingReleaseCount: 1
        });
        expect(registry.collect(1)).toBe(1);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 0,
            pendingReleaseCount: 0
        });

        cache.destroy();
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });
});
