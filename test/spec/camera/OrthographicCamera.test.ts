import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const OrthographicCamera = Hilo3d.OrthographicCamera;

describe('OrthographicCamera', () => {
    it('create', () => {
        const camera = new OrthographicCamera();
        expect(camera.isOrthographicCamera).toBe(true);
        expect(camera.className).toBe('OrthographicCamera');
    });

    it('reverses near/far depth while retaining OpenGL clip coordinates', () => {
        const camera = new OrthographicCamera({ near: 1, far: 101, depthMode: 'reversed' });
        const elements = camera.projectionMatrix.elements;
        const depth = (distance: number): number => elements[10] * -distance + elements[14];
        expect(depth(1)).toBeCloseTo(1, 6);
        expect(depth(101)).toBeCloseTo(-1, 6);
    });
});
