import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const AmbientLight = Hilo3d.AmbientLight;

describe('AmbientLight', () => {
    it('create', () => {
        const light = new AmbientLight();
        expect(light.isAmbientLight).toBe(true);
        expect(light.className).toBe('AmbientLight');
        expect(light.amount).toBeTypeOf('number');
    });
});
