import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const PlaneGeometry = Hilo3d.PlaneGeometry;

describe('PlaneGeometry', () => {
    it('create', () => {
        const geometry = new PlaneGeometry();
        expect(geometry.isPlaneGeometry).toBe(true);
        expect(geometry.className).toBe('PlaneGeometry');
    });
});
