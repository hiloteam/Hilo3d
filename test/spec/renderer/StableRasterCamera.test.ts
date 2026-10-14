import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import { getTransformHistoryRevision } from '../../../src/core/TransformHistory';
import {
    hasTemporalResolved,
    markTemporalResolved,
    resolveRasterCamera,
    withStableRasterCamera
} from '../../../src/render/internal/StableRasterCamera';

describe('stable post-resolve camera scope', () => {
    it('preserves jittered source/history and reuses an independent physical camera after rollback', () => {
        const camera = new PerspectiveCamera({
            z: 4,
            near: 0.3,
            far: 50,
            aspect: 1.5,
            depthMode: 'reversed'
        });
        camera.setProjectionJitter(0.012, -0.017);
        camera.updateViewProjectionMatrix();
        const originalProjection = [...camera.jitteredProjectionMatrix.elements];
        const originalRevision = getTransformHistoryRevision(camera);
        const context = {
            get camera(): PerspectiveCamera | ReturnType<typeof resolveRasterCamera> {
                return resolveRasterCamera(camera);
            }
        };
        const first = withStableRasterCamera(context, () => {
            const raster = context.camera;
            expect(raster).not.toBe(camera);
            expect([...raster.jitteredProjectionMatrix.elements]).toEqual([
                ...camera.projectionMatrix.elements
            ]);
            expect([...raster.worldMatrix.elements]).toEqual([...camera.worldMatrix.elements]);
            expect(raster.depthMode).toBe('reversed');
            expect(raster.projectionJitterX).toBe(0);
            raster.updateViewProjectionMatrix();
            expect([...raster.viewMatrix.elements]).toEqual([...camera.viewMatrix.elements]);
            return raster;
        });
        expect(resolveRasterCamera(camera)).toBe(camera);
        expect(() =>
            withStableRasterCamera(context, () => {
                throw new Error('discard stable pass');
            })
        ).toThrow('discard stable pass');
        expect(resolveRasterCamera(camera)).toBe(camera);
        expect([...camera.jitteredProjectionMatrix.elements]).toEqual(originalProjection);
        expect(getTransformHistoryRevision(camera)).toBe(originalRevision);
        camera.x = 2;
        camera.aspect = 2;
        camera.invalidateTransformHistory();
        camera.updateViewProjectionMatrix();
        withStableRasterCamera(context, () => {
            expect(context.camera).toBe(first);
            expect([...first.worldMatrix.elements]).toEqual([...camera.worldMatrix.elements]);
            expect([...first.jitteredProjectionMatrix.elements]).toEqual([
                ...camera.projectionMatrix.elements
            ]);
        });
    });

    it('marks only the successful current invocation rather than another view or later frame', () => {
        const invocation = { frameIndex: 1 };
        const otherView = { frameIndex: 1 };
        expect(hasTemporalResolved(invocation)).toBe(false);
        markTemporalResolved(invocation);
        expect(hasTemporalResolved(invocation)).toBe(true);
        expect(hasTemporalResolved(otherView)).toBe(false);
        invocation.frameIndex = 2;
        expect(hasTemporalResolved(invocation)).toBe(false);
    });
});
