import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PointLight from '../../../src/light/PointLight';
import LightManager from '../../../src/light/LightManager';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Vector3 from '../../../src/math/Vector3';
import Texture from '../../../src/texture/Texture';
import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ShadowAtlasContentCache } from '../../../src/render/renderer/ShadowAtlasContentCache';
import { ShadowAtlasResourceCache } from '../../../src/render/renderer/ShadowAtlasResourceCache';
import { ShadowAtlasSceneAdapter } from '../../../src/render/renderer/ShadowAtlasSceneAdapter';
import { ShadowAtlasPageResidency } from '../../../src/render/renderer/ShadowAtlasPageResidency';
import { ShadowAtlasUpdateScheduler } from '../../../src/render/renderer/ShadowAtlasUpdateScheduler';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';
import {
    VirtualShadowMapController,
    snapshotVirtualShadowMapOptions,
    type VirtualShadowRecordInputs
} from '../../../src/render/pipeline/VirtualShadowMaps';
import {
    acquireRenderPassParameters,
    type RenderPassParameterPool
} from '../../../src/render/pipeline/RenderPassParameterPool';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';

function makeCacheFixture() {
    const backend = new FakeWebGLRHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const resources = new ShadowAtlasResourceCache(registry);
    const adapter = new ShadowAtlasSceneAdapter();
    const content = new ShadowAtlasContentCache();
    const manager = new LightManager();
    manager.addLight(new DirectionalLight({ shadow: { width: 32, height: 32 } }));
    const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
    camera.setPosition(0, 1, 5).lookAt(new Vector3()).updateViewProjectionMatrix();
    const geometry = new BoxGeometry();
    const original = geometry.vertices;
    if (!original) throw new Error('missing box vertices');
    const interleaved = new Float32Array(original.data.length * 2);
    for (let vertex = 0; vertex < original.count; vertex++) {
        for (let axis = 0; axis < 3; axis++) {
            const value = original.data[vertex * 3 + axis] ?? 0;
            interleaved[vertex * 6 + axis] = value;
            interleaved[vertex * 6 + 3 + axis] = value + (axis === 0 ? 2 : 0);
        }
    }
    geometry.vertices = new GeometryData(interleaved, 3, { stride: 24, offset: 0 });
    geometry.uvDecodeMat = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const texture = new Texture({
        image: new Uint8Array([255, 255, 255, 0, 255, 255, 255, 255]),
        width: 2,
        height: 1
    });
    const mesh = new Mesh({
        geometry,
        material: new BasicMaterial({
            lightType: 'NONE',
            coverage: { mode: 'mask', cutoff: 0.5 },
            diffuse: texture
        }),
        frustumTest: false
    });
    mesh.updateMatrixWorld();
    const plan = adapter.prepare(manager, camera, device.capabilities, { width: 32, height: 32 });
    const atlas = resources.prepare({}, plan.atlas);
    return { backend, device, registry, resources, adapter, content, mesh, plan, atlas };
}

async function assertCacheDetects(
    change: (mesh: Mesh) => void,
    setup?: (mesh: Mesh) => void
): Promise<void> {
    const fixture = makeCacheFixture();
    const { device, content, atlas, plan, mesh } = fixture;
    setup?.(mesh);
    const first = new RHIUploadBatch(new FrameArena());
    content.stage(atlas, plan, [mesh], first);
    const commands = device.graphicsQueue.beginFrame();
    first.flush(commands);
    first.validateSubmission(device);
    const submission = device.graphicsQueue.endFrame(commands);
    first.commit(submission);
    await submission.done;
    const next = new RHIUploadBatch(new FrameArena());
    try {
        change(mesh);
        expect(content.stage(atlas, plan, [mesh], next).dirtySliceCount).toBe(1);
        next.rollback();
        const retry = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], retry).dirtySliceCount).toBe(1);
        retry.rollback();
    } finally {
        next.rollback();
        fixture.content.destroy();
        fixture.resources.destroy();
        fixture.registry.collect(1);
        fixture.adapter.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    }
}

describe('Shadow atlas invalidation and fairness regressions', () => {
    it.each(['full', 'paged'] as const)(
        'eventually updates all continuously dirty point-light faces in %s mode',
        async updateMode => {
            const backend = new FakeWebGLRHIBackend();
            const device = backend.createDevice();
            const manager = new LightManager();
            manager.addLight(new PointLight({ shadow: { width: 32, height: 32 } }));
            const adapter = new ShadowAtlasSceneAdapter();
            const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
            const plan = adapter.prepare(manager, camera, device.capabilities, {
                width: 32,
                height: 32
            });
            const scheduler = new ShadowAtlasUpdateScheduler({ maxUpdatesPerFrame: 4 });
            const pages = new ShadowAtlasPageResidency({ maxPageUpdatesPerFrame: 1 });
            const selected = new Set<number>();
            for (let frame = 1; frame <= (updateMode === 'full' ? 2 : 6); frame++) {
                const uploads = new RHIUploadBatch(new FrameArena());
                const content = {
                    dirtySlices: Array<boolean>(6).fill(true),
                    reasons: Array<'caster-transform'>(6).fill('caster-transform'),
                    updateIds: Array<number>(6).fill(frame),
                    sliceCount: 6,
                    dirtySliceCount: 6,
                    cachedSliceCount: 0
                };
                const result = scheduler.schedule(plan, content, frame, uploads);
                const residency = pages.stage(
                    plan,
                    content,
                    result.scheduledSlices,
                    uploads,
                    updateMode
                );
                residency.completedSlices.forEach((value, index) => {
                    if (value) selected.add(index);
                });
                scheduler.complete(residency.completedSlices);
                const commands = device.graphicsQueue.beginFrame();
                uploads.flush(commands);
                uploads.validateSubmission(device);
                const submission = device.graphicsQueue.endFrame(commands);
                uploads.commit(submission);
                await submission.done;
            }
            adapter.destroy();
            backend.destroy();
            expect([...selected].sort()).toEqual([0, 1, 2, 3, 4, 5]);
            pages.destroy();
        }
    );

    it.each([false, true])(
        'invalidates changed UV decode values (geometry dirty: %s)',
        async markDirty => {
            await assertCacheDetects(mesh => {
                if (!mesh.geometry) throw new Error('missing geometry');
                if (!mesh.geometry.uvDecodeMat) throw new Error('missing decode matrix');
                mesh.geometry.uvDecodeMat[6] = 0.5;
                if (markDirty) mesh.geometry.isDirty = true;
            });
        }
    );

    it.each([false, true])(
        'invalidates changed vertex layout (geometry dirty: %s)',
        async markDirty => {
            await assertCacheDetects(mesh => {
                if (!mesh.geometry?.vertices) throw new Error('missing geometry');
                mesh.geometry.vertices.offset = 12;
                if (markDirty) mesh.geometry.isDirty = true;
            });
        }
    );

    it('invalidates equal-weight morph target remapping even when frustum culling is disabled', async () => {
        await assertCacheDetects(
            mesh => {
                if (!(mesh.geometry instanceof MorphGeometry))
                    throw new Error('missing morph geometry');
                mesh.geometry.update([1], [1]);
            },
            mesh => {
                const vertices = mesh.geometry?.vertices;
                if (!vertices) throw new Error('missing vertices');
                const shifted = new Float32Array(vertices.count * 3);
                for (let index = 0; index < vertices.count; index++) shifted[index * 3] = 1;
                mesh.geometry = new MorphGeometry({
                    vertices,
                    weights: [1],
                    targets: {
                        vertices: [
                            new GeometryData(new Float32Array(shifted.length), 3),
                            new GeometryData(shifted, 3)
                        ]
                    }
                });
            }
        );
    });

    it('changes virtual-page epoch when camera far changes the cached depth mapping', () => {
        const settings = snapshotVirtualShadowMapOptions({
            virtualResolution: 512,
            pageSize: 64,
            physicalPageCount: 4,
            maxPageUpdatesPerFrame: 2,
            directionalClipmapLevels: 2,
            firstDirectionalClipmapExtent: 16
        });
        const createContext = {
            createStorageBuffer: (descriptor: { byteLength: number }): StorageBuffer =>
                ({
                    byteLength: descriptor.byteLength,
                    destroy: vi.fn()
                }) as unknown as StorageBuffer
        } as unknown as RenderPipelineCreateContext;
        const controller = new VirtualShadowMapController(
            settings,
            createContext,
            [{ indexCount: 36 }],
            3,
            64
        );
        const light = new DirectionalLight({ direction: new Vector3(0, -1, 0) });
        const camera = new PerspectiveCamera({ near: 0.1, far: 30, aspect: 1 });
        camera.setPosition(4, 3, 6).lookAt(new Vector3()).updateViewProjectionMatrix();
        const shadows = {
            depthMode: 'standard' as 'standard' | 'reversed',
            directionalLights: [light],
            directionalShadowCount: 1
        };
        const owner = {};
        let uploaded = new Uint8Array();
        let nextHandle = 10;
        const record = (
            frameIndex: number,
            submit = true
        ): { epoch: number; matrix: number[]; valid: number } => {
            const context = {
                frameIndex,
                camera,
                viewport: [0, 0, 64, 64],
                graph: {
                    acquireHistoryTexture: () => ({
                        current: 1,
                        valid: frameIndex > 1,
                        history: () => 2
                    }),
                    acquirePersistentTarget: () => ({ depthStencil: 3 }),
                    importStorageBuffer: () => nextHandle++,
                    addPass: () => nextHandle++
                },
                writeStorageBuffer: (
                    _buffer: StorageBuffer,
                    _offset: number,
                    bytes: Uint8Array
                ): void => {
                    uploaded = bytes.slice();
                },
                acquirePassParameters: (pool: RenderPassParameterPool<object>): object =>
                    acquireRenderPassParameters(pool, owner, frameIndex)
            } as unknown as RenderPipelineContext;
            const inputs = {
                frameBuffer: 20,
                objects: 21,
                bucketData: 22,
                previousHiZ: 23,
                hiZHistoryValid: true,
                shadows,
                activeObjectHighWater: 0,
                previousViewMatrix: camera.viewMatrix.elements,
                cameraHistoryValid: true
            } as unknown as Readonly<VirtualShadowRecordInputs>;
            controller.record(context, inputs);
            if (submit) controller.frameSubmitted(frameIndex);
            else controller.frameDiscarded(frameIndex);
            const words = new Uint32Array(uploaded.buffer);
            const floats = new Float32Array(uploaded.buffer);
            return {
                epoch: words[(13 + 4) * 4 + 2] ?? 0,
                matrix: Array.from(floats.slice(13 * 4, 13 * 4 + 16)),
                valid: words[16] ?? 0
            };
        };
        try {
            const first = record(1);
            camera.far = 60;
            camera.updateViewProjectionMatrix();
            const second = record(2);
            expect(second.matrix).not.toEqual(first.matrix);
            expect(second.valid).toBe(1);
            expect(second.epoch).not.toBe(first.epoch);
            expect(record(3).epoch).toBe(second.epoch);
            camera.far = 90;
            camera.updateViewProjectionMatrix();
            const discarded = record(4, false);
            expect(discarded.epoch).toBe(second.epoch + 1);
            camera.far = 60;
            camera.updateViewProjectionMatrix();
            expect(record(5).epoch).toBe(second.epoch);
            shadows.depthMode = 'reversed';
            const reversed = record(6);
            expect(reversed.epoch).toBe(second.epoch + 1);
            expect(reversed.matrix).not.toEqual(second.matrix);
        } finally {
            controller.destroy();
        }
    });
});
