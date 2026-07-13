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
    });
});
