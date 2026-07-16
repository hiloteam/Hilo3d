import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Light = Hilo3d.Light;

describe('Light', () => {
    it('does not expose backend-internal framebuffer or shadow renderer classes', () => {
        expect(Reflect.has(Hilo3d, 'Framebuffer')).toBe(false);
        expect(Reflect.has(Hilo3d, 'LightShadow')).toBe(false);
        expect(Reflect.has(Hilo3d, 'CubeLightShadow')).toBe(false);
    });

    it('create', () => {
        const light = new Light();
        expect(light.isLight).toBe(true);
        expect(light.className).toBe('Light');
        expect(light.color.isColor).toBe(true);
        expect(Reflect.has(light, 'createShadowMap')).toBe(false);
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

    it('rejects unsupported shadow-producing light types before backend selection', () => {
        const shadowParameters = { shadow: {} };
        expect(() => {
            Reflect.construct(Hilo3d.AreaLight, [shadowParameters]);
        }).toThrow('AreaLight does not support shadow maps.');
        expect(() => {
            Reflect.construct(Hilo3d.AmbientLight, [shadowParameters]);
        }).toThrow('AmbientLight does not support shadow maps.');
        expect(() => {
            Reflect.construct(Light, [shadowParameters]);
        }).toThrow('Light does not support shadow maps.');

        const areaLight = new Hilo3d.AreaLight();
        expect(() => {
            areaLight.shadow = {};
        }).toThrow('AreaLight does not support shadow maps.');
    });
});
