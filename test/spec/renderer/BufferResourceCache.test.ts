import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import GeometryData from '../../../src/geometry/GeometryData';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import UniformBuffer from '../../../src/render/UniformBuffer';
import { RenderFrame } from '../../../src/render/frame/RenderFrame';
import { createRenderFrameContext } from '../../../src/render/frame/RenderFrameContext';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import { BufferResourceCache } from '../../../src/render/renderer/BufferResourceCache';
import {
    ResourceRegistry,
    type ResourceRegistryHandle
} from '../../../src/render/renderer/ResourceRegistry';
import { RHIBufferUsage, type RHIBuffer } from '../../../src/render/rhi/core';
import { createStd140Layout } from '../../../src/render/ubo/Std140Layout';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBuffer,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/v2/FakeRHIBackend';

function frameContext(device: FakeRHIDevice, frameIndex: number) {
    return createRenderFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

type FrameFailure = 'build' | 'prepare' | 'execute' | null;

function runCacheFrame(
    frame: RenderFrame,
    device: FakeRHIDevice,
    frameIndex: number,
    cache: BufferResourceCache,
    prepare: () => void,
    failure: FrameFailure = null
) {
    return frame.execute(frameContext(device, frameIndex), scope => {
        cache.beginFrame(frameIndex, scope.uploads);
        if (failure === 'build') throw new Error('buffer cache build failure');
        const template: RenderPassTemplate<undefined> = {
            name: 'buffer resource cache test',
            setup(pass) {
                pass.markSideEffect();
            },
            prepare() {
                prepare();
                if (failure === 'prepare') throw new Error('buffer cache prepare failure');
            },
            execute(context) {
                void context;
                if (failure === 'execute') throw new Error('buffer cache execute failure');
            }
        };
        scope.graph.addPass(template, undefined);
    });
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode === 'deferred') {
        const submission = backend.completeNextSubmission();
        await submission.done;
    }
}

function uint16Values(buffer: FakeRHIBuffer, count: number): number[] {
    const bytes = buffer.snapshotBytes();
    return [...new Uint16Array(bytes.buffer, bytes.byteOffset, count)];
}

function float32Value(buffer: FakeRHIBuffer, index: number): number | undefined {
    const bytes = buffer.snapshotBytes();
    return new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / Float32Array.BYTES_PER_ELEMENT
    )[index];
}

function interleavedAliases(): {
    readonly storage: Float32Array;
    readonly position: GeometryData;
    readonly uv: GeometryData;
} {
    const storage = new Float32Array(15);
    const bufferViewId = 'buffer-cache-interleaved';
    return {
        storage,
        position: new GeometryData(storage, 3, { bufferViewId, stride: 20, offset: 0 }),
        uv: new GeometryData(storage, 2, { bufferViewId, stride: 20, offset: 12 })
    };
}

describe('BufferResourceCache resource shape', () => {
    it('separates vertex/index/uniform usage and pads allocations to four bytes', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3]), 1);
        const uniform = UniformBuffer.fromSchema(createStd140Layout({ value: 'vec4' }), {
            value: [1, 2, 3, 4]
        });
        let vertex: RHIBuffer | undefined;
        let index: RHIBuffer | undefined;
        let uniformResource: RHIBuffer | undefined;
        let uniformHandle: ResourceRegistryHandle<RHIBuffer> | undefined;

        expect(() => cache.getUniformBufferHandle(uniform)).toThrow(/must be prepared/u);

        runCacheFrame(frame, device, 1, cache, () => {
            vertex = cache.getVertexBuffer(geometry);
            index = cache.getIndexBuffer(geometry);
            uniformResource = cache.getUniformBuffer(uniform);
            uniformHandle = cache.getUniformBufferHandle(uniform);
            expect(registry.resolve(uniformHandle)).toBe(uniformResource);
        });

        expect(vertex?.usage).toBe(RHIBufferUsage.VERTEX | RHIBufferUsage.COPY_DST);
        expect(index?.usage).toBe(RHIBufferUsage.INDEX | RHIBufferUsage.COPY_DST);
        expect(uniformResource?.usage).toBe(RHIBufferUsage.UNIFORM | RHIBufferUsage.COPY_DST);
        expect(vertex?.id).not.toBe(index?.id);
        expect(vertex?.size).toBe(4);
        expect([...(vertex as FakeRHIBuffer).snapshotBytes()]).toEqual([1, 2, 3, 0]);
        expect(uniformResource?.size).toBe(16);
        expect(cache.diagnostics(geometry, 'vertex')).toMatchObject({
            committedRevision: geometry.revision,
            allocatedSize: 4
        });
        expect(cache.diagnostics(uniform, 'uniform')?.committedRevision).toBe(uniform.revision);
        expect(cache.getUniformBufferHandle(uniform)).toBe(uniformHandle);
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('uploads aligned partial GeometryData and UniformBuffer ranges', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3, 4, 5]), 1);
        const uniform = UniformBuffer.fromSchema(createStd140Layout({ value: 'vec4' }));
        let vertex: FakeRHIBuffer | undefined;
        let uniformResource: FakeRHIBuffer | undefined;
        runCacheFrame(frame, device, 1, cache, () => {
            vertex = cache.getVertexBuffer(geometry) as FakeRHIBuffer;
            uniformResource = cache.getUniformBuffer(uniform) as FakeRHIBuffer;
        });

        geometry.setSubData(1, new Uint8Array([9]));
        uniform.write(5, new Uint8Array([7]));
        backend.resetExecutionLog();
        runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.getVertexBuffer(geometry)).toBe(vertex);
            expect(cache.getUniformBuffer(uniform)).toBe(uniformResource);
        });

        const writes = backend.executionLog.filter(command => command.startsWith('write-buffer:'));
        expect(writes).toEqual([
            `write-buffer:${String(vertex?.id)}:0:4`,
            `write-buffer:${String(uniformResource?.id)}:4:4`
        ]);
        expect([...(vertex?.snapshotBytes() ?? [])]).toEqual([1, 9, 3, 4, 5, 0, 0, 0]);
        expect(uniformResource?.snapshotBytes()[5]).toBe(7);
        expect(cache.diagnostics(geometry, 'vertex')?.committedRevision).toBe(geometry.revision);
        expect(cache.diagnostics(uniform, 'uniform')?.committedRevision).toBe(uniform.revision);
        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('commits a resized replacement and retires the old logical allocation', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3, 4]), 1);
        let first: FakeRHIBuffer | undefined;
        runCacheFrame(frame, device, 1, cache, () => {
            first = cache.getVertexBuffer(geometry) as FakeRHIBuffer;
        });

        geometry.data = new Uint8Array([9, 8, 7, 6, 5, 4, 3]);
        let replacement: FakeRHIBuffer | undefined;
        runCacheFrame(frame, device, 2, cache, () => {
            replacement = cache.getVertexBuffer(geometry) as FakeRHIBuffer;
        });

        expect(replacement).not.toBe(first);
        expect(replacement?.size).toBe(8);
        expect([...(replacement?.snapshotBytes() ?? [])]).toEqual([9, 8, 7, 6, 5, 4, 3, 0]);
        expect(cache.resolveBuffer(geometry, 'vertex')).toBe(replacement);
        expect(first?.destroyed).toBe(false);
        expect(cache.collect(0)).toBe(0);
        expect(cache.collect(1)).toBe(1);
        expect(first?.destroyed).toBe(true);
        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });
});

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('BufferResourceCache portable Uint8 indices on %s RHI', (_name, createBackend) => {
    it('widens ordinary and strip-restart variants and patches both after a sub-data update', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const backing = new Uint8Array([99, 1, 2, 0xff, 88]);
        const indices = new GeometryData(backing.subarray(1, 4), 1);
        let plain: FakeRHIBuffer | undefined;
        let restart: FakeRHIBuffer | undefined;

        const first = runCacheFrame(frame, device, 1, cache, () => {
            plain = cache.prepareIndexBuffer(indices) as FakeRHIBuffer;
            restart = cache.prepareIndexBuffer(indices, {
                primitiveRestart: true
            }) as FakeRHIBuffer;
        });
        await complete(backend);
        await first.submission.done;
        const plainBuffer = plain;
        const restartBuffer = restart;
        if (!plainBuffer || !restartBuffer) {
            throw new Error('Uint8 index variants were not prepared');
        }

        expect(plainBuffer).not.toBe(restartBuffer);
        expect(plainBuffer.size).toBe(8);
        expect(restartBuffer.size).toBe(8);
        expect(uint16Values(plainBuffer, indices.count)).toEqual([1, 2, 0xff]);
        expect(uint16Values(restartBuffer, indices.count)).toEqual([1, 2, 0xffff]);

        indices.setSubData(1, new Uint8Array([9]));
        backend.resetExecutionLog();
        const second = runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepareIndexBuffer(indices)).toBe(plainBuffer);
            expect(cache.prepareIndexBuffer(indices, { primitiveRestart: true })).toBe(
                restartBuffer
            );
        });
        await complete(backend);
        await second.submission.done;

        expect(uint16Values(plainBuffer, indices.count)).toEqual([1, 9, 0xff]);
        expect(uint16Values(restartBuffer, indices.count)).toEqual([1, 9, 0xffff]);
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            [
                `write-buffer:${String(plainBuffer.id)}:0:4`,
                `write-buffer:${String(restartBuffer.id)}:0:4`
            ]
        );

        expect(cache.detach(indices, 'index')).toBe(2);
        expect(cache.collect(2)).toBe(2);
        expect(plainBuffer.destroyed).toBe(true);
        expect(restartBuffer.destroyed).toBe(true);
        cache.destroy();
        frame.destroy();
        backend.destroy();
    });
});

describe('BufferResourceCache widened index recovery', () => {
    it('rebuilds the restart variant from current Uint8 CPU values on a replacement device', async () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const indices = new GeometryData(new Uint8Array([0, 1, 0xff]), 1);
        let first: FakeRHIBuffer | undefined;

        const initial = runCacheFrame(frame, firstDevice, 1, cache, () => {
            first = cache.prepareIndexBuffer(indices, {
                primitiveRestart: true
            }) as FakeRHIBuffer;
        });
        await complete(backend);
        await initial.submission.done;

        indices.data = new Uint8Array([3, 0xff, 4, 5, 6]);
        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        const recovered = cache.resolveBuffer(indices, 'index', {
            primitiveRestart: true
        }) as FakeRHIBuffer;

        expect(recovered).not.toBe(first);
        expect(recovered.deviceId).toBe(secondDevice.id);
        expect(recovered.size).toBe(12);
        expect(uint16Values(recovered, indices.count)).toEqual([3, 0xffff, 4, 5, 6]);
        expect(cache.diagnostics(indices, 'index', { primitiveRestart: true })).toMatchObject({
            allocatedSize: 12,
            committedRevision: indices.revision,
            registryGeneration: 2
        });

        backend.resetExecutionLog();
        const steady = runCacheFrame(frame, secondDevice, 2, cache, () => {
            expect(cache.prepareIndexBuffer(indices, { primitiveRestart: true })).toBe(recovered);
        });
        await complete(backend);
        await steady.submission.done;
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            []
        );

        cache.destroy();
        registry.collect(2);
        frame.destroy();
        backend.destroy();
    });
});

describe.each([
    ['immediate', () => new FakeWebGLRHIBackend()],
    ['deferred', () => new FakeWebGPURHIBackend()]
] as const)('BufferResourceCache transaction on %s RHI', (_name, createBackend) => {
    it('rolls back execute failure and retries the uncommitted revision', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3, 4]), 1);
        let resource: FakeRHIBuffer | undefined;
        const first = runCacheFrame(frame, device, 1, cache, () => {
            resource = cache.getVertexBuffer(geometry) as FakeRHIBuffer;
        });
        await complete(backend);
        await first.submission.done;
        const committed = geometry.revision;

        geometry.setSubData(0, new Uint8Array([7]));
        backend.resetExecutionLog();
        expect(() =>
            runCacheFrame(frame, device, 2, cache, () => cache.getVertexBuffer(geometry), 'execute')
        ).toThrow('buffer cache execute failure');
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(geometry, 'vertex')?.committedRevision).toBe(committed);
        expect(device.graphicsQueue.state).toBe('idle');

        const retry = runCacheFrame(frame, device, 3, cache, () => {
            expect(cache.getVertexBuffer(geometry)).toBe(resource);
        });
        await complete(backend);
        await retry.submission.done;
        const writes = backend.executionLog.filter(command => command.startsWith('write-buffer:'));
        expect(writes).toHaveLength(backend.executionMode === 'immediate' ? 2 : 1);
        expect(resource?.snapshotBytes()[0]).toBe(7);
        expect(cache.diagnostics(geometry, 'vertex')?.committedRevision).toBe(geometry.revision);
        cache.destroy();
        registry.collect(3);
        backend.destroy();
    });
});

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('BufferResourceCache canonical vertex aliases on %s RHI', (_name, createBackend) => {
    it('observes non-canonical revisions and uploads the full canonical byte range', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const { storage, position, uv } = interleavedAliases();
        let resource: FakeRHIBuffer | undefined;

        const initial = runCacheFrame(frame, device, 1, cache, () => {
            resource = cache.prepareVertexBuffer(position, [position, uv]) as FakeRHIBuffer;
            expect(cache.prepareVertexBuffer(uv, [position, uv])).toBe(resource);
        });
        await complete(backend);
        await initial.submission.done;

        uv.setSubData(3, new Float32Array([0.25]));
        backend.resetExecutionLog();
        const updated = runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepareVertexBuffer(position, [position, uv])).toBe(resource);
        });
        await complete(backend);
        await updated.submission.done;

        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            [`write-buffer:${String(resource?.id)}:0:${String(storage.byteLength)}`]
        );
        if (!resource) throw new Error('Canonical vertex resource was not prepared');
        expect(float32Value(resource, 3)).toBe(0.25);
        expect(cache.resolveBuffer(uv, 'vertex')).toBe(resource);
        expect(cache.diagnostics(position, 'vertex')?.committedRevision).toBe(position.revision);
        expect(cache.diagnostics(uv, 'vertex')?.committedRevision).toBe(uv.revision);

        expect(cache.detach(uv, 'vertex')).toBe(1);
        expect(cache.diagnostics(position, 'vertex')).toBeNull();
        expect(cache.diagnostics(uv, 'vertex')).toBeNull();
        cache.collect(2);
        cache.destroy();
        frame.destroy();
        backend.destroy();
    });

    it('rejects alias mutation after prepare, rolls back idle, and retries the full upload', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const { storage, position, uv } = interleavedAliases();
        let resource: FakeRHIBuffer | undefined;
        const initial = runCacheFrame(frame, device, 1, cache, () => {
            resource = cache.prepareVertexBuffer(position, [position, uv]) as FakeRHIBuffer;
        });
        await complete(backend);
        await initial.submission.done;
        const committedAliasRevision = uv.revision;

        const template: RenderPassTemplate<undefined> = {
            name: 'canonical alias stability failure',
            setup(pass) {
                pass.markSideEffect();
            },
            prepare() {
                cache.prepareVertexBuffer(position, [position, uv]);
            },
            execute() {
                uv.setSubData(3, new Float32Array([0.75]));
            }
        };
        expect(() =>
            frame.execute(frameContext(device, 2), scope => {
                cache.beginFrame(2, scope.uploads);
                scope.graph.addPass(template, undefined);
            })
        ).toThrow(/changed after its first use/u);
        await complete(backend);
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(uv, 'vertex')?.committedRevision).toBe(committedAliasRevision);

        backend.resetExecutionLog();
        const retry = runCacheFrame(frame, device, 3, cache, () => {
            expect(cache.prepareVertexBuffer(position, [position, uv])).toBe(resource);
        });
        await complete(backend);
        await retry.submission.done;
        if (!resource) throw new Error('Canonical vertex resource was not prepared');
        expect(float32Value(resource, 3)).toBe(0.75);
        expect(cache.diagnostics(uv, 'vertex')?.committedRevision).toBe(uv.revision);
        expect(
            backend.executionLog.filter(command => command.startsWith('write-buffer:')).at(-1)
        ).toBe(`write-buffer:${String(resource.id)}:0:${String(storage.byteLength)}`);

        cache.destroy();
        registry.collect(3);
        frame.destroy();
        backend.destroy();
    });
});

describe('BufferResourceCache canonical alias recovery', () => {
    it('recreates current shared bytes and synchronizes every alias revision', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const { position, uv } = interleavedAliases();
        let first: FakeRHIBuffer | undefined;
        runCacheFrame(frame, firstDevice, 1, cache, () => {
            first = cache.prepareVertexBuffer(position, [position, uv]) as FakeRHIBuffer;
        });

        uv.setSubData(3, new Float32Array([0.5]));
        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        const recovered = cache.resolveBuffer(uv, 'vertex') as FakeRHIBuffer;

        expect(recovered).not.toBe(first);
        expect(float32Value(recovered, 3)).toBe(0.5);
        expect(cache.diagnostics(position, 'vertex')?.committedRevision).toBe(position.revision);
        expect(cache.diagnostics(uv, 'vertex')?.committedRevision).toBe(uv.revision);
        backend.resetExecutionLog();
        runCacheFrame(frame, secondDevice, 2, cache, () => {
            expect(cache.prepareVertexBuffer(position, [position, uv])).toBe(recovered);
        });
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            []
        );

        cache.destroy();
        registry.collect(2);
        frame.destroy();
        backend.destroy();
    });
});

describe('BufferResourceCache failure and recovery', () => {
    it('rolls back build/prepare failures and rejects a source revision change in one frame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3, 4]), 1);

        expect(() => runCacheFrame(frame, device, 1, cache, () => undefined, 'build')).toThrow(
            'buffer cache build failure'
        );
        expect(cache.active).toBe(false);

        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        expect(() =>
            runCacheFrame(frame, device, 2, cache, () => cache.getVertexBuffer(geometry), 'prepare')
        ).toThrow('buffer cache prepare failure');
        expect(beginFrame).not.toHaveBeenCalled();
        expect(cache.diagnostics(geometry, 'vertex')?.committedRevision).toBe(-1);

        expect(() =>
            runCacheFrame(frame, device, 3, cache, () => {
                cache.getVertexBuffer(geometry);
                geometry.setSubData(0, new Uint8Array([8]));
                cache.getVertexBuffer(geometry);
            })
        ).toThrow(/changed after its first use/u);
        expect(beginFrame).not.toHaveBeenCalled();
        expect(cache.active).toBe(false);

        runCacheFrame(frame, device, 4, cache, () => cache.getVertexBuffer(geometry));
        expect(cache.diagnostics(geometry, 'vertex')?.committedRevision).toBe(geometry.revision);
        cache.destroy();
        registry.collect(4);
        backend.destroy();
    });

    it('preserves the frame failure and returns idle when replacement cleanup also throws', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3, 4]), 1);
        let committed: FakeRHIBuffer | undefined;
        runCacheFrame(frame, device, 1, cache, () => {
            committed = cache.prepareVertexBuffer(geometry) as FakeRHIBuffer;
        });
        const committedRevision = geometry.revision;
        geometry.data = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
        const discardUnsubmitted = registry.discardUnsubmitted.bind(registry);
        const discard = vi.spyOn(registry, 'discardUnsubmitted').mockImplementationOnce(handle => {
            discardUnsubmitted(handle);
            throw new Error('injected buffer rollback cleanup failure');
        });

        expect(() =>
            runCacheFrame(
                frame,
                device,
                2,
                cache,
                () => cache.prepareVertexBuffer(geometry),
                'prepare'
            )
        ).toThrow('buffer cache prepare failure');
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(geometry, 'vertex')?.committedRevision).toBe(committedRevision);
        expect(cache.resolveBuffer(geometry, 'vertex')).toBe(committed);
        expect(registry.diagnostics().trackedResourceCount).toBe(1);

        discard.mockRestore();
        runCacheFrame(frame, device, 3, cache, () => cache.prepareVertexBuffer(geometry));
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(geometry, 'vertex')?.committedRevision).toBe(geometry.revision);

        cache.destroy();
        registry.collect(3);
        frame.destroy();
        backend.destroy();
    });

    it('rebuilds from current CPU bytes and synchronizes revision after registry recovery', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3]), 1);
        let first: FakeRHIBuffer | undefined;
        runCacheFrame(frame, firstDevice, 1, cache, () => {
            first = cache.getVertexBuffer(geometry) as FakeRHIBuffer;
        });

        geometry.data = new Uint8Array([9, 8, 7, 6, 5]);
        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        const recovered = cache.resolveBuffer(geometry, 'vertex') as FakeRHIBuffer;
        expect(recovered).not.toBe(first);
        expect(recovered.deviceId).toBe(secondDevice.id);
        expect(recovered.size).toBe(8);
        expect([...recovered.snapshotBytes()]).toEqual([9, 8, 7, 6, 5, 0, 0, 0]);
        expect(cache.diagnostics(geometry, 'vertex')).toMatchObject({
            committedRevision: geometry.revision,
            registryGeneration: 2
        });
        backend.resetExecutionLog();
        runCacheFrame(frame, secondDevice, 2, cache, () => {
            expect(cache.getVertexBuffer(geometry)).toBe(recovered);
        });
        expect(backend.executionLog.filter(command => command.startsWith('write-buffer:'))).toEqual(
            []
        );
        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('marks use, supports detach, and leaves deferred native release fenced in-flight', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new BufferResourceCache(registry);
        const frame = new RenderFrame();
        const geometry = new GeometryData(new Uint8Array([1, 2, 3, 4]), 1);
        let resource: FakeRHIBuffer | undefined;
        const initial = runCacheFrame(frame, device, 1, cache, () => {
            resource = cache.getVertexBuffer(geometry) as FakeRHIBuffer;
        });
        await complete(backend);
        await initial.submission.done;

        geometry.setSubData(0, new Uint8Array([6]));
        const inFlight = runCacheFrame(frame, device, 5, cache, () => {
            expect(cache.getVertexBuffer(geometry)).toBe(resource);
        });
        expect(inFlight.submission.status).toBe('pending');
        expect(cache.detach(geometry, 'vertex')).toBe(1);
        expect(cache.collect(4)).toBe(0);
        expect(resource?.destroyed).toBe(false);
        expect(cache.collect(5)).toBe(1);
        expect(resource?.destroyed).toBe(true);
        expect(resource?.nativeReleased).toBe(false);
        backend.completeNextSubmission();
        await inFlight.submission.done;
        expect(resource?.nativeReleased).toBe(true);
        expect(cache.diagnostics(geometry, 'vertex')).toBeNull();
        cache.destroy();
        backend.destroy();
    });
});
