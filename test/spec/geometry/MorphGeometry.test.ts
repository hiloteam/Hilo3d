import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const MorphGeometry = Hilo3d.MorphGeometry;

describe('MorphGeometry', () => {
    it('create', () => {
        const geometry = new MorphGeometry();
        expect(geometry.isMorphGeometry).toBe(true);
        expect(geometry.className).toBe('MorphGeometry');
    });
});
