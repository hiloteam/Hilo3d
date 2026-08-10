import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const PerspectiveCamera = Hilo3d.PerspectiveCamera;

describe('PerspectiveCamera', () => {
    it('create', () => {
        const camera = new PerspectiveCamera();
        expect(camera.isPerspectiveCamera).toBe(true);
        expect(camera.className).toBe('PerspectiveCamera');
    });

    it('maps finite and infinite reversed-Z depth without changing the shared clip convention', () => {
        const camera = new PerspectiveCamera({
            near: 0.25,
            far: 1_000_000,
            depthMode: 'reversed'
        });
        const projectDepth = (distance: number): number => {
            const elements = camera.projectionMatrix.elements;
            const z = -distance;
            return (elements[10] * z + elements[14]) / (elements[11] * z + elements[15]);
        };

        expect(projectDepth(camera.near)).toBeCloseTo(1, 6);
        expect(projectDepth(camera.far ?? 0)).toBeCloseTo(-1, 5);

        camera.far = null;
        camera.updateProjectionMatrix();
        expect(projectDepth(camera.near)).toBeCloseTo(1, 6);
        expect(projectDepth(1e12)).toBeCloseTo(-1, 6);
        expect(camera.far).toBeNull();
    });

    it('keeps standard depth as the compatibility default and validates projection bounds', () => {
        const camera = new PerspectiveCamera({ near: 0.5, far: 50 });
        const elements = camera.projectionMatrix.elements;
        const depth = (distance: number): number => {
            const z = -distance;
            return (elements[10] * z + elements[14]) / (elements[11] * z + elements[15]);
        };
        expect(camera.depthMode).toBe('standard');
        expect(depth(0.5)).toBeCloseTo(-1, 6);
        expect(depth(50)).toBeCloseTo(1, 6);
        expect(() => new PerspectiveCamera({ near: 0 })).toThrow(/near/);
        expect(() => new PerspectiveCamera({ near: 2, far: 1 })).toThrow(/far/);
    });

    it('separates raster jitter from the stable CPU projection', () => {
        const camera = new PerspectiveCamera({ aspect: 16 / 9 });
        camera.updateViewProjectionMatrix();
        const stableProjection = Array.from(camera.projectionMatrix.elements);
        const stableViewProjection = Array.from(camera.viewProjectionMatrix.elements);

        camera.setProjectionJitter(0.01, -0.02);

        expect(Array.from(camera.projectionMatrix.elements)).toEqual(stableProjection);
        expect(Array.from(camera.viewProjectionMatrix.elements)).toEqual(stableViewProjection);
        expect(camera.jitteredProjectionMatrix.elements).not.toEqual(
            camera.projectionMatrix.elements
        );
        expect(camera.jitteredViewProjectionMatrix.elements).not.toEqual(
            camera.viewProjectionMatrix.elements
        );
        expect(camera.projectionJitterX).toBe(0.01);
        expect(camera.projectionJitterY).toBe(-0.02);

        camera.clearProjectionJitter();
        expect(camera.jitteredProjectionMatrix.elements).toEqual(camera.projectionMatrix.elements);
        expect(camera.jitteredViewProjectionMatrix.elements).toEqual(
            camera.viewProjectionMatrix.elements
        );
    });
});
