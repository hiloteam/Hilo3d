import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const PointLight = Hilo3d.PointLight;

describe('PointLight', () => {
    it('create', () => {
        const light = new PointLight();
        expect(light.isPointLight).toBe(true);
        expect(light.className).toBe('PointLight');
        expect(light.constantAttenuation).toBeTypeOf('number');
        expect(light.linearAttenuation).toBeTypeOf('number');
        expect(light.quadraticAttenuation).toBeTypeOf('number');
    });

    it('toInfoArray', () => {
        const light = new PointLight({
            constantAttenuation: 0.1,
            linearAttenuation: 0.2,
            quadraticAttenuation: 0.3
        });
        const result: number[] = [];
        light.toInfoArray(result, 3);
        expect(result.slice(3, 6)).toEqual([0.1, 0.2, 0.3]);
    });
});
