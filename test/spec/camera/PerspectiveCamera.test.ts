import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const PerspectiveCamera = Hilo3d.PerspectiveCamera;

describe('PerspectiveCamera', () => {
    it('create', () => {
        const camera = new PerspectiveCamera();
        expect(camera.isPerspectiveCamera).toBe(true);
        expect(camera.className).toBe('PerspectiveCamera');
    });
});
