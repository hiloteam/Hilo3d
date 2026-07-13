import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Fog = Hilo3d.Fog;

describe('Fog', () => {
    it('create', () => {
        const fog = new Fog();
        expect(fog.isFog).toBe(true);
        expect(fog.className).toBe('Fog');
        expect(fog.color.isColor).toBe(true);
        expect(fog.start).toBe(5);
        expect(fog.end).toBe(10);
        expect(fog.mode).toBe('LINEAR');
    });

    it('getInfo', () => {
        const fog = new Fog({
            start: 2,
            end: 10,
            density: 0.5
        });

        expect(fog.getInfo()).toEqual(new Float32Array([fog.start, fog.end]));

        fog.mode = 'EXP';
        expect(fog.getInfo()).toEqual(fog.density);
    });
});
