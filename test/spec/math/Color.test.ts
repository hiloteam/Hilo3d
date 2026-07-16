import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Color = Hilo3d.Color;

describe('Color', () => {
    let colorA = new Color();
    beforeEach(() => {
        colorA = new Color(1, 2, 3, 4);
    });

    it('create', () => {
        expect(colorA.isColor).toBe(true);
        expect(colorA.className).toBe('Color');
        expect(colorA.r).toBe(1);
        expect(colorA.g).toBe(2);
        expect(colorA.b).toBe(3);
        expect(colorA.a).toBe(4);
    });

    it('toRGBArray', () => {
        const arr: number[] = [];
        colorA.toRGBArray(arr, 2);
        expect(arr[2]).toBe(1);
        expect(arr[3]).toBe(2);
        expect(arr[4]).toBe(3);
    });

    it('fromUintArray', () => {
        const arr = [0, 0, 255, 128, 255, 128];
        expect(colorA.fromUintArray(arr, 2).elements).toEqualishValues(1, 128 / 255, 1, 128 / 255);
    });

    it('fromHEX', () => {
        expect(new Color().fromHEX(16750950).elements).toEqualishValues(1, 0.6, 0.4, 1);
        expect(new Color().fromHEX(0xff9966).elements).toEqualishValues(1, 0.6, 0.4, 1);
        expect(new Color().fromHEX(0x0000ff).elements).toEqualishValues(0, 0, 1, 1);
        expect(new Color().fromHEX(0x006699).elements).toEqualishValues(0, 0.4, 0.6, 1);
        expect(new Color().fromHEX('#ff9966').elements).toEqualishValues(1, 0.6, 0.4, 1);
        expect(new Color().fromHEX('#f96').elements).toEqualishValues(1, 0.6, 0.4, 1);
        expect(new Color().fromHEX('ff9966').elements).toEqualishValues(1, 0.6, 0.4, 1);
        expect(new Color().fromHEX('f96').elements).toEqualishValues(1, 0.6, 0.4, 1);
    });

    it('toHEX', () => {
        expect(new Color(1, 0.6, 0.4, 1).toHEX()).toBe('ff9966');
    });
});
