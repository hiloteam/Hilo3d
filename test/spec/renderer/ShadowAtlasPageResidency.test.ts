import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import Vector3 from '../../../src/math/Vector3';
import type {
    ShadowAtlasContentDecision,
    ShadowAtlasInvalidationReason
} from '../../../src/render/renderer/ShadowAtlasContentCache';
import { ShadowAtlasPageResidency } from '../../../src/render/renderer/ShadowAtlasPageResidency';
import { ShadowAtlasSceneAdapter } from '../../../src/render/renderer/ShadowAtlasSceneAdapter';
import { describe, expect, it } from 'vitest';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

function decision(
    reason: ShadowAtlasInvalidationReason,
    updateId: number
): Readonly<ShadowAtlasContentDecision> {
    return {
        dirtySlices: [true],
        reasons: [reason],
        updateIds: [updateId],
        sliceCount: 1,
        dirtySliceCount: 1,
        cachedSliceCount: 0
    };
}

describe('ShadowAtlasPageResidency', () => {
    it('commits mandatory pages and advances budgeted replacement pages across submissions', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const manager = new LightManager();
        manager.addLight(new DirectionalLight({ shadow: { width: 256, height: 256 } }));
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
        camera.setPosition(0, 1, 5).lookAt(new Vector3());
        camera.updateViewProjectionMatrix();
        const adapter = new ShadowAtlasSceneAdapter();
        const plan = adapter.prepare(manager, camera, device.capabilities, {
            width: 256,
            height: 256
        });
        const pages = new ShadowAtlasPageResidency({
            pageSize: 128,
            maxPageUpdatesPerFrame: 1
        });

        const firstBatch = new RHIUploadBatch(new FrameArena());
        const first = pages.stage(plan, decision('allocation', 1), [true], firstBatch);
        expect(first.updateRegions).toEqual([
            {
                slicePhysicalIndex: 0,
                pageX: 0,
                pageY: 0,
                x: 0,
                y: 0,
                width: 256,
                height: 256
            }
        ]);
        expect(first.completedSlices).toEqual([true]);
        expect(first).toMatchObject({
            requestedPageCount: 4,
            scheduledPageCount: 4,
            mandatoryPageCount: 4,
            budgetOverflowCount: 3
        });
        const firstCommands = device.graphicsQueue.beginFrame();
        firstBatch.flush(firstCommands);
        const firstSubmission = device.graphicsQueue.endFrame(firstCommands);
        firstBatch.commit(firstSubmission);
        await firstSubmission.done;

        const replacement = decision('caster-transform', 2);
        const failedBatch = new RHIUploadBatch(new FrameArena());
        const failed = pages.stage(plan, replacement, [true], failedBatch);
        expect(failed.updateRegions).toHaveLength(1);
        const failedRegion = { ...failed.updateRegions[0] };
        failedBatch.rollback();

        for (let update = 0; update < 4; update += 1) {
            const batch = new RHIUploadBatch(new FrameArena());
            const staged = pages.stage(plan, replacement, [true], batch);
            expect(staged.updateRegions).toHaveLength(1);
            if (update === 0) expect(staged.updateRegions[0]).toEqual(failedRegion);
            expect(staged.completedSlices).toEqual([update === 3]);
            const commands = device.graphicsQueue.beginFrame();
            batch.flush(commands);
            const submission = device.graphicsQueue.endFrame(commands);
            batch.commit(submission);
            await submission.done;
        }

        const stableBatch = new RHIUploadBatch(new FrameArena());
        const stable = pages.stage(plan, replacement, [true], stableBatch);
        expect(stable).toMatchObject({
            requestedPageCount: 0,
            scheduledPageCount: 0,
            deferredPageCount: 0,
            residentPageCount: 4
        });
        expect(stable.completedSlices).toEqual([true]);
        stableBatch.rollback();

        const groupedPages = new ShadowAtlasPageResidency({
            pageSize: 128,
            maxPageUpdatesPerFrame: 3
        });
        const groupedAllocationBatch = new RHIUploadBatch(new FrameArena());
        groupedPages.stage(plan, decision('allocation', 1), [true], groupedAllocationBatch);
        const groupedAllocationCommands = device.graphicsQueue.beginFrame();
        groupedAllocationBatch.flush(groupedAllocationCommands);
        const groupedAllocationSubmission =
            device.graphicsQueue.endFrame(groupedAllocationCommands);
        groupedAllocationBatch.commit(groupedAllocationSubmission);
        await groupedAllocationSubmission.done;
        const groupedReplacementBatch = new RHIUploadBatch(new FrameArena());
        const groupedReplacement = groupedPages.stage(
            plan,
            replacement,
            [true],
            groupedReplacementBatch
        );
        expect(groupedReplacement.scheduledPageCount).toBe(3);
        expect(groupedReplacement.updateRegions).toHaveLength(2);
        expect(groupedReplacement.updateRegions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ x: 0, y: 0, width: 256, height: 128 }),
                expect.objectContaining({ x: 0, y: 128, width: 128, height: 128 })
            ])
        );
        groupedReplacementBatch.rollback();
        groupedPages.destroy();

        pages.destroy();
        adapter.destroy();
        backend.destroy();
    });

    it('rotates budgeted pages when moving casters produce a new revision every frame', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const manager = new LightManager();
        manager.addLight(new DirectionalLight({ shadow: { width: 256, height: 256 } }));
        const camera = new PerspectiveCamera({ near: 0.1, far: 100, aspect: 1 });
        camera.setPosition(0, 1, 5).lookAt(new Vector3());
        camera.updateViewProjectionMatrix();
        const adapter = new ShadowAtlasSceneAdapter();
        const plan = adapter.prepare(manager, camera, device.capabilities, {
            width: 256,
            height: 256
        });
        const pages = new ShadowAtlasPageResidency({
            pageSize: 128,
            maxPageUpdatesPerFrame: 1
        });
        const submit = async (batch: RHIUploadBatch): Promise<void> => {
            const commands = device.graphicsQueue.beginFrame();
            batch.flush(commands);
            const submission = device.graphicsQueue.endFrame(commands);
            batch.commit(submission);
            await submission.done;
        };

        const allocationBatch = new RHIUploadBatch(new FrameArena());
        pages.stage(plan, decision('allocation', 1), [true], allocationBatch);
        await submit(allocationBatch);

        const visited = new Set<string>();
        for (let updateId = 2; updateId <= 5; updateId += 1) {
            const batch = new RHIUploadBatch(new FrameArena());
            const staged = pages.stage(plan, decision('caster-transform', updateId), [true], batch);
            expect(staged.updateRegions).toHaveLength(1);
            const region = staged.updateRegions[0];
            if (region === undefined) throw new Error('Expected one rotating shadow page');
            visited.add(`${String(region.pageX)}:${String(region.pageY)}`);
            await submit(batch);
        }

        expect(visited).toEqual(new Set(['0:0', '1:0', '0:1', '1:1']));
        pages.destroy();
        adapter.destroy();
        backend.destroy();
    });
});
