import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const OrthographicCamera = Hilo3d.OrthographicCamera;

describe('OrthographicCamera', () => {
    it('create', () => {
        const camera = new OrthographicCamera();
        expect(camera.isOrthographicCamera).toBe(true);
        expect(camera.className).toBe('OrthographicCamera');
    });
});
