import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Camera = Hilo3d.Camera;
const Matrix4 = Hilo3d.Matrix4;

describe('Camera', () => {
    it('create', () => {
        const camera = new Camera();
        expect(camera.isCamera).toBe(true);
        expect(camera.className).toBe('Camera');
        expect(camera.viewMatrix).toBeInstanceOf(Matrix4);
        expect(camera.projectionMatrix).toBeInstanceOf(Matrix4);
        expect(camera.viewProjectionMatrix).toBeInstanceOf(Matrix4);
        expect(camera.priority).toBe(0);
        expect(camera.clearColor).toBe(true);
        expect(camera.clearDepth).toBe(true);
        expect(camera.clearStencil).toBe(true);
        expect(camera.isLayerVisible(new Hilo3d.Node({ layer: 1 }))).toBe(true);
    });

    it('validates priority and tests 32-bit visibility masks', () => {
        const camera = new Camera({ visibility: 1 << 3, priority: 20, clearColor: false });

        expect(camera.priority).toBe(20);
        expect(camera.clearColor).toBe(false);
        expect(camera.isLayerVisible(new Hilo3d.Node({ layer: 1 << 3 }))).toBe(true);
        expect(camera.isLayerVisible(new Hilo3d.Node({ layer: 1 << 2 }))).toBe(false);
        expect(() => {
            camera.priority = Number.NaN;
        }).toThrow(/priority must be finite/u);
    });
});
