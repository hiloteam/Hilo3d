import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import PointLight from '../../../src/light/PointLight';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import Vector3 from '../../../src/math/Vector3';
import type {
    ShadowAtlasContentDecision,
    ShadowAtlasInvalidationReason
} from '../../../src/render/renderer/ShadowAtlasContentCache';
import { ShadowAtlasSceneAdapter } from '../../../src/render/renderer/ShadowAtlasSceneAdapter';
import { ShadowAtlasPageResidency } from '../../../src/render/renderer/ShadowAtlasPageResidency';
import { ShadowAtlasUpdateScheduler } from '../../../src/render/renderer/ShadowAtlasUpdateScheduler';
import { describe, expect, it } from 'vitest';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

function decision(
    reasons: readonly (ShadowAtlasInvalidationReason | null)[]
): Readonly<ShadowAtlasContentDecision> {
    const dirtySlices = reasons.map(reason => reason !== null);
    const dirtySliceCount = dirtySlices.filter(Boolean).length;
    return {
        dirtySlices,
        reasons,
        updateIds: reasons.map((reason, index) => (reason === null ? 0 : index + 1)),
        sliceCount: reasons.length,
        dirtySliceCount,
        cachedSliceCount: reasons.length - dirtySliceCount
    };
}

describe('ShadowAtlasUpdateScheduler', () => {
    it('applies near-to-far CSM cadence and a deterministic soft update budget', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const manager = new LightManager();
        manager.addLight(
            new DirectionalLight({
                shadow: { width: 64, height: 64, cascadeCount: 4, cascadeMaxDistance: 40 }
            })
        );
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
        camera.setPosition(0, 1, 5).lookAt(new Vector3());
        camera.updateViewProjectionMatrix();
        const adapter = new ShadowAtlasSceneAdapter();
        const plan = adapter.prepare(manager, camera, device.capabilities, {
            width: 64,
            height: 64
        });
        const uploads = new RHIUploadBatch(new FrameArena());
        const scheduler = new ShadowAtlasUpdateScheduler({ maxUpdatesPerFrame: 2 });

        const first = scheduler.schedule(
            plan,
            decision([
                'caster-transform',
                'caster-transform',
                'caster-transform',
                'caster-transform'
            ]),
            1,
            uploads
        );
        expect(first).toMatchObject({
            requestedUpdateCount: 4,
            scheduledUpdateCount: 1,
            deferredUpdateCount: 3,
            cadenceDeferredCount: 3,
            budgetOverflowCount: 0
        });
        expect(first.scheduledSlices).toEqual([true, false, false, false]);

        const identity = first;
        const budgeted = scheduler.schedule(
            plan,
            decision([
                'caster-transform',
                'caster-transform',
                'caster-transform',
                'caster-transform'
            ]),
            8,
            uploads
        );
        expect(budgeted).toBe(identity);
        expect(budgeted.scheduledSlices).toEqual([true, true, false, false]);
        expect(budgeted).toMatchObject({
            scheduledUpdateCount: 2,
            deferredUpdateCount: 2,
            cadenceDeferredCount: 0
        });

        const mandatory = scheduler.schedule(
            plan,
            decision(['allocation', 'layout', 'light', 'allocation']),
            9,
            uploads
        );
        expect(mandatory.scheduledSlices).toEqual([true, true, true, true]);
        expect(mandatory).toMatchObject({
            scheduledUpdateCount: 4,
            mandatoryUpdateCount: 4,
            budgetOverflowCount: 2,
            deferredUpdateCount: 0
        });

        uploads.rollback();
        adapter.destroy();
        backend.destroy();
    });
    it('credits only completed pages and preserves priority after a discarded submission', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const manager = new LightManager();
        manager.addLight(new PointLight({ shadow: { width: 32, height: 32 } }));
        const adapter = new ShadowAtlasSceneAdapter();
        const plan = adapter.prepare(manager, new PerspectiveCamera(), device.capabilities, {
            width: 32,
            height: 32
        });
        const scheduler = new ShadowAtlasUpdateScheduler({ maxUpdatesPerFrame: 4 });
        const dirty = decision(Array<ShadowAtlasInvalidationReason>(6).fill('caster-transform'));
        const discarded = new RHIUploadBatch(new FrameArena());
        expect(scheduler.schedule(plan, dirty, 1, discarded).scheduledSlices).toEqual([
            true,
            true,
            true,
            true,
            false,
            false
        ]);
        scheduler.complete([true, true, true, true, false, false]);
        discarded.rollback();
        const submitted = new RHIUploadBatch(new FrameArena());
        expect(scheduler.schedule(plan, dirty, 2, submitted).scheduledSlices).toEqual([
            true,
            true,
            true,
            true,
            false,
            false
        ]);
        scheduler.complete([true, false, false, false, false, false]);
        const commands = device.graphicsQueue.beginFrame();
        submitted.flush(commands);
        submitted.validateSubmission(device);
        const submission = device.graphicsQueue.endFrame(commands);
        submitted.commit(submission);
        await submission.done;
        const next = new RHIUploadBatch(new FrameArena());
        expect(scheduler.schedule(plan, dirty, 3, next).scheduledSlices).toEqual([
            false,
            true,
            true,
            true,
            true,
            false
        ]);
        next.rollback();
        adapter.destroy();
        backend.destroy();
    });
    it('makes caster progress when mandatory CSM work exhausts both soft budgets every frame', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const manager = new LightManager();
        manager.addLight(new DirectionalLight({ shadow: { width: 128, height: 128 } }));
        manager.addLight(new PointLight({ shadow: { width: 128, height: 128 } }));
        const adapter = new ShadowAtlasSceneAdapter();
        const plan = adapter.prepare(manager, new PerspectiveCamera(), device.capabilities, {
            width: 128,
            height: 128
        });
        const scheduler = new ShadowAtlasUpdateScheduler({ maxUpdatesPerFrame: 1 });
        const pages = new ShadowAtlasPageResidency({ maxPageUpdatesPerFrame: 1 });
        const completedFaces = new Set<number>();
        for (let frame = 1; frame <= 14; frame++) {
            const uploads = new RHIUploadBatch(new FrameArena());
            const content = decision(
                frame === 1
                    ? Array<ShadowAtlasInvalidationReason>(7).fill('allocation')
                    : ['light', ...Array<ShadowAtlasInvalidationReason>(6).fill('caster-transform')]
            );
            const updates = scheduler.schedule(plan, content, frame, uploads);
            const residency = pages.stage(
                plan,
                { ...content, updateIds: Array<number>(7).fill(frame) },
                updates.scheduledSlices,
                uploads,
                'paged',
                updates.mandatorySlices
            );
            scheduler.complete(residency.completedSlices);
            if (frame > 1) {
                residency.completedSlices.forEach((complete, index) => {
                    if (complete && index > 0) completedFaces.add(index);
                });
                expect(residency.scheduledPageCount).toBeLessThanOrEqual(2);
            }
            const commands = device.graphicsQueue.beginFrame();
            uploads.flush(commands);
            uploads.validateSubmission(device);
            const submission = device.graphicsQueue.endFrame(commands);
            uploads.commit(submission);
            await submission.done;
        }
        expect([...completedFaces].sort()).toEqual([1, 2, 3, 4, 5, 6]);
        pages.destroy();
        adapter.destroy();
        backend.destroy();
    });
});
