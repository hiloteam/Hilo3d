import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';
import { testEnv } from '../../setup';

const Light = Hilo3d.Light;

describe('Light', () => {
    it('create', () => {
        const light = new Light();
        expect(light.isLight).toBe(true);
        expect(light.className).toBe('Light');
        expect(light.color.isColor).toBe(true);
    });

    it('derives attenuation from a finite non-negative range', () => {
        const light = new Light({ range: 10 });
        expect(light.range).toBe(10);
        expect(light.constantAttenuation).toBe(1);
        expect(light.linearAttenuation).toBeCloseTo(0.45);
        expect(light.quadraticAttenuation).toBeCloseTo(0.75);

        light.range = 0;
        expect(light.linearAttenuation).toBe(0);
        expect(light.quadraticAttenuation).toBe(0);
    });

    it.each([-1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN])(
        'rejects an invalid range: %s',
        range => {
            expect(() => new Light({ range })).toThrow(RangeError);
        }
    );

    it('fails fast when the base light is asked to create a shadow map', () => {
        const light = new Light({ shadow: {} });
        expect(() => {
            light.createShadowMap(testEnv.renderer, testEnv.camera);
        }).toThrow('Light does not support shadow maps.');
    });
});
