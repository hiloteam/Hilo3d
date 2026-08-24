import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const SpotLight = Hilo3d.SpotLight;

describe('SpotLight', () => {
    it('create', () => {
        const light = new SpotLight({ cutoff: 30, outerCutoff: 45 });
        expect(light.isSpotLight).toBe(true);
        expect(light.className).toBe('SpotLight');
        expect(light.direction.isVector3).toBe(true);
        expect(light.outerCutoff).toBe(45);
        expect(light.cutoff).toBe(30);
    });

    it('accepts cone-angle boundary values', () => {
        const light = new SpotLight({ cutoff: 0, outerCutoff: 180 });
        expect(light.cutoff).toBe(0);
        expect(light.outerCutoff).toBe(180);
    });

    it('normalizes analytic cookie and IES profile parameters', () => {
        const light = new SpotLight({
            cookie: {
                scale: [0.75, 0.5],
                offset: [0.1, -0.2],
                intensity: 0.8,
                softness: 0.25
            },
            iesProfile: { intensity: 1.4, exponent: 3 }
        });
        expect(light.cookie).toEqual({
            scale: [0.75, 0.5],
            offset: [0.1, -0.2],
            intensity: 0.8,
            softness: 0.25
        });
        expect(light.iesProfile).toEqual({ intensity: 1.4, exponent: 3 });
        expect(Object.isFrozen(light.cookie)).toBe(true);
        expect(Object.isFrozen(light.iesProfile)).toBe(true);

        expect(() => new SpotLight({ cookie: { scale: [0, 1] } })).toThrow(RangeError);
        expect(() => new SpotLight({ cookie: { softness: 2 } })).toThrow(RangeError);
        expect(() => new SpotLight({ iesProfile: { exponent: -1 } })).toThrow(RangeError);
    });

    it.each([-1, 181, Number.POSITIVE_INFINITY, Number.NaN])(
        'rejects an invalid cone angle: %s',
        angle => {
            expect(() => new SpotLight({ cutoff: angle })).toThrow(RangeError);
            expect(() => new SpotLight({ outerCutoff: angle })).toThrow(RangeError);
        }
    );

    it('toInfoArray', () => {
        const light = new SpotLight({
            constantAttenuation: 0.1,
            linearAttenuation: 0.2,
            quadraticAttenuation: 0.3
        });
        const result: number[] = [];
        light.toInfoArray(result, 3);
        expect(result.slice(3, 6)).toEqual([0.1, 0.2, 0.3]);
    });

    it('gets normalized world and view directions', () => {
        const camera = new Hilo3d.Camera({ rotationX: 180 });
        camera.updateViewMatrix();
        const light = new SpotLight({ direction: new Hilo3d.Vector3(0, 0.5, 0) });
        expect(light.getWorldDirection().elements).toEqual(new Float32Array([0, 1, 0]));
        expect(light.getViewDirection(camera).equals(new Hilo3d.Vector3(0, -1, 0))).toBe(true);
    });
});
