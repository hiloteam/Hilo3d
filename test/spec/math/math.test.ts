import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const math = Hilo3d.math;

describe('math', function () {
    it('generateUUID', () => {
        expect(math.generateUUID()).not.toBe(math.generateUUID());
        expect(math.generateUUID()).toBeTypeOf('string');
    });

    it('clamp', () => {
        expect(math.clamp(1, 1, 2)).toBeEqualish(1);
        expect(math.clamp(2, 1, 2)).toBeEqualish(2);
        expect(math.clamp(-1, 1, 2)).toBeEqualish(1);
        expect(math.clamp(3, 1, 2)).toBeEqualish(2);
        expect(math.clamp(1.5, 1, 2)).toBeEqualish(1.5);
    });

    it('degToRad', () => {
        expect(math.DEG2RAD).toBeEqualish(Math.PI / 180);
        expect(math.degToRad(90)).toBeEqualish(Math.PI / 2);
    });

    it('radToDeg', () => {
        expect(math.RAD2DEG).toBeEqualish(180 / Math.PI);
        expect(math.radToDeg(Math.PI / 3)).toBeEqualish(60);
    });

    it('isPowerOfTwo', () => {
        expect(math.isPowerOfTwo(2)).toBe(true);
        expect(math.isPowerOfTwo(256)).toBe(true);
        expect(math.isPowerOfTwo(238)).toBe(false);
    });

    it('nearestPowerOfTwo', () => {
        expect(math.nearestPowerOfTwo(2)).toBeEqualish(2);
        expect(math.nearestPowerOfTwo(9)).toBeEqualish(8);
        expect(math.nearestPowerOfTwo(15)).toBeEqualish(16);
    });

    it('nextPowerOfTwo', () => {
        expect(math.nextPowerOfTwo(9)).toBeEqualish(16);
        expect(math.nextPowerOfTwo(2)).toBeEqualish(2);
    });
});
