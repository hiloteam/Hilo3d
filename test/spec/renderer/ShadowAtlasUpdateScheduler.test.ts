import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import DirectionalLight from '../../../src/light/DirectionalLight';
import LightManager from '../../../src/light/LightManager';
import Vector3 from '../../../src/math/Vector3';
import type {
    ShadowAtlasContentDecision,
    ShadowAtlasInvalidationReason
} from '../../../src/render/renderer/ShadowAtlasContentCache';
import { ShadowAtlasSceneAdapter } from '../../../src/render/renderer/ShadowAtlasSceneAdapter';
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
        const scheduler = new ShadowAtlasUpdateScheduler({ maxUpdatesPerFrame: 2 });

        const first = scheduler.schedule(
            plan,
            decision([
                'caster-transform',
                'caster-transform',
                'caster-transform',
                'caster-transform'
            ]),
            1
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
            8
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
            9
        );
        expect(mandatory.scheduledSlices).toEqual([true, true, true, true]);
        expect(mandatory).toMatchObject({
            scheduledUpdateCount: 4,
            mandatoryUpdateCount: 4,
            budgetOverflowCount: 2,
            deferredUpdateCount: 0
        });

        adapter.destroy();
        backend.destroy();
    });
});
