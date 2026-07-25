import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

describe('Camera2D', () => {
    it('uses top-left pixel coordinates and overlay defaults', () => {
        const camera = new Hilo3d.Camera2D({ width: 320, height: 180 });

        expect(camera.left).toBe(0);
        expect(camera.right).toBe(320);
        expect(camera.top).toBe(0);
        expect(camera.bottom).toBe(180);
        expect(camera.visibility).toBe(Hilo3d.DEFAULT_2D_LAYER);
        expect(camera.priority).toBe(100);
        expect(camera.clearColor).toBe(false);
        expect(camera.clearDepth).toBe(true);
    });

    it('updates the projection dimensions without replacing the camera', () => {
        const camera = new Hilo3d.Camera2D();
        const result = camera.resize(800, 600);

        expect(result).toBe(camera);
        expect(camera.width).toBe(800);
        expect(camera.height).toBe(600);
        expect(camera.right).toBe(800);
        expect(camera.bottom).toBe(600);
        expect(() => camera.resize(0, 1)).toThrow(/positive finite/u);
    });
});
