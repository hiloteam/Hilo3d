import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Vector3 from '../../../src/math/Vector3';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ShadowAtlasContentCache } from '../../../src/render/renderer/ShadowAtlasContentCache';
import { ShadowAtlasResourceCache } from '../../../src/render/renderer/ShadowAtlasResourceCache';
import { ShadowAtlasSceneAdapter } from '../../../src/render/renderer/ShadowAtlasSceneAdapter';
import type { RHISubmission } from '../../../src/render/rhi/core';
import { describe, expect, it } from 'vitest';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

function submit(device: ReturnType<FakeWebGLRHIBackend['createDevice']>, batch: RHIUploadBatch) {
    const commands = device.graphicsQueue.beginFrame();
    batch.flush(commands);
    const submission = device.graphicsQueue.endFrame(commands);
    batch.commit(submission);
    return submission;
}

describe('ShadowAtlasContentCache', () => {
    it('commits exact slice state only after submission and retries rolled-back caster changes', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new ShadowAtlasResourceCache(registry);
        const adapter = new ShadowAtlasSceneAdapter();
        const content = new ShadowAtlasContentCache();
        const manager = new LightManager();
        const light = new DirectionalLight({ shadow: { width: 32, height: 32 } });
        light.setPosition(2, 4, 3).lookAt(new Vector3());
        manager.addLight(light);
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
        camera.setPosition(0, 1, 5).lookAt(new Vector3());
        camera.updateViewProjectionMatrix();
        const mesh = new Mesh({
            geometry: new BoxGeometry(),
            material: new BasicMaterial(),
            frustumTest: false
        });
        mesh.updateMatrixWorld();
        const plan = adapter.prepare(manager, camera, device.capabilities, {
            width: 32,
            height: 32
        });
        const atlasOwner = {};
        const atlas = resources.prepare(atlasOwner, plan.atlas);

        const firstBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], firstBatch)).toMatchObject({
            dirtySliceCount: 1,
            cachedSliceCount: 0,
            reasons: ['allocation']
        });
        const firstSubmission: RHISubmission = submit(device, firstBatch);
        await firstSubmission.done;
        expect(content.metrics).toMatchObject({ size: 1, misses: 1, hits: 0 });

        const stableBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], stableBatch)).toMatchObject({
            dirtySliceCount: 0,
            cachedSliceCount: 1,
            reasons: [null]
        });
        stableBatch.rollback();

        mesh.x = 1;
        mesh.updateMatrixWorld();
        const failedBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], failedBatch)).toMatchObject({
            dirtySliceCount: 1,
            reasons: ['caster-transform']
        });
        failedBatch.rollback();

        const retryBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], retryBatch)).toMatchObject({
            dirtySliceCount: 1,
            reasons: ['caster-transform']
        });
        const retrySubmission = submit(device, retryBatch);
        await retrySubmission.done;

        const committedBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], committedBatch)).toMatchObject({
            dirtySliceCount: 0,
            cachedSliceCount: 1
        });
        const committedSubmission = submit(device, committedBatch);
        await committedSubmission.done;
        expect(content.metrics).toMatchObject({ size: 1, highWater: 1 });

        mesh.x = 2;
        mesh.updateMatrixWorld();
        const deferredBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], deferredBatch)).toMatchObject({
            dirtySliceCount: 1,
            reasons: ['caster-transform']
        });
        content.deferUnscheduled([false]);
        const deferredSubmission = submit(device, deferredBatch);
        await deferredSubmission.done;

        const deferredRetryBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], deferredRetryBatch)).toMatchObject({
            dirtySliceCount: 1,
            reasons: ['caster-transform']
        });
        content.deferUnscheduled([true]);
        const deferredRetrySubmission = submit(device, deferredRetryBatch);
        await deferredRetrySubmission.done;

        mesh.x = 10_000;
        mesh.updateMatrixWorld();
        const distantBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], distantBatch)).toMatchObject({
            dirtySliceCount: 1,
            reasons: ['caster-transform']
        });
        const distantSubmission = submit(device, distantBatch);
        await distantSubmission.done;

        mesh.x = 10_001;
        mesh.updateMatrixWorld();
        const uncullableBatch = new RHIUploadBatch(new FrameArena());
        expect(content.stage(atlas, plan, [mesh], uncullableBatch)).toMatchObject({
            dirtySliceCount: 1,
            reasons: ['caster-transform']
        });
        const uncullableSubmission = submit(device, uncullableBatch);
        await uncullableSubmission.done;

        content.destroy();
        resources.destroy();
        registry.collect(1);
        adapter.destroy();
        registry.destroy();
        backend.destroy();
    });
});
