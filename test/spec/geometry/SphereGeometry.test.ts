import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const SphereGeometry = Hilo3d.SphereGeometry;

describe('SphereGeometry', () => {
    it('create', () => {
        const geometry = new SphereGeometry();
        expect(geometry.isSphereGeometry).toBe(true);
        expect(geometry.className).toBe('SphereGeometry');
    });
});
