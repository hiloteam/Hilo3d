import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Vector2 = Hilo3d.Vector2;

describe('Vector2', function () {
    it('create', () => {
        const vec = new Vector2(1, 2);
        expect(vec.isVector2).toBe(true);
        expect(vec.className).toBe('Vector2');

        expect(vec.x).toBe(1);
        expect(vec.y).toBe(2);
    });

    it('copy', () => {
        const v = new Vector2(1, 2);
        expect(new Vector2().copy(v).elements).toEqual(v.elements);
    });

    it('clone', () => {
        const v = new Vector2(1, 2);
        expect(v.clone().elements).toEqual(v.elements);
    });

    it('toArray', () => {
        const res: number[] = [];
        new Vector2(1, 2).toArray(res, 5);
        expect(res[5]).toBe(1);
        expect(res[6]).toBe(2);
    });

    it('fromArray', () => {
        const res = [0, 0, 0, 1, 2, 3];
        expect(new Vector2().fromArray(res, 2).elements).toEqualishValues(0, 1);
    });

    it('set', () => {
        expect(new Vector2().set(1, 2).elements).toEqualishValues(1, 2);
    });

    it('add', () => {
        expect(new Vector2(1, 2).add(new Vector2(3, 4)).elements).toEqualishValues(4, 6);
        expect(
            new Vector2(1, 2).add(new Vector2(3, 4), new Vector2(1, 0)).elements
        ).toEqualishValues(4, 4);
    });

    it('subtract', () => {
        expect(new Vector2(1, 2).subtract(new Vector2(3, 4)).elements).toEqualishValues(-2, -2);
        expect(
            new Vector2(1, 2).subtract(new Vector2(3, 4), new Vector2(1, 0)).elements
        ).toEqualishValues(2, 4);
    });

    it('multiply', () => {
        expect(new Vector2(1, 2).multiply(new Vector2(3, 4)).elements).toEqualishValues(3, 8);
        expect(
            new Vector2(1, 2).multiply(new Vector2(3, 4), new Vector2(1, 0)).elements
        ).toEqualishValues(3, 0);
    });

    it('divide', () => {
        expect(new Vector2(6, 2).divide(new Vector2(3, 4)).elements).toEqualishValues(2, 0.5);
        expect(
            new Vector2(1, 2).divide(new Vector2(3, 4), new Vector2(1, 2)).elements
        ).toEqualishValues(3, 2);
    });

    it('ceil', () => {
        expect(new Vector2(1.1, 2.9).ceil().elements).toEqualishValues(2, 3);
    });

    it('floor', () => {
        expect(new Vector2(1.1, 2.9).floor().elements).toEqualishValues(1, 2);
    });

    it('min', () => {
        expect(new Vector2(6, 2).min(new Vector2(3, 4)).elements).toEqualishValues(3, 2);
        expect(
            new Vector2(1, 2).min(new Vector2(3, 4), new Vector2(1, 2)).elements
        ).toEqualishValues(1, 2);
    });

    it('max', () => {
        expect(new Vector2(6, 2).max(new Vector2(3, 4)).elements).toEqualishValues(6, 4);
        expect(
            new Vector2(1, 2).max(new Vector2(3, 4), new Vector2(1, 2)).elements
        ).toEqualishValues(3, 4);
    });

    it('round', () => {
        expect(new Vector2(1.2, 2.5).round().elements).toEqualishValues(1, 3);
    });

    it('scale', () => {
        expect(new Vector2(1.2, 2.5).scale(2).elements).toEqualishValues(2.4, 5);
    });

    it('scaleAndAdd', () => {
        expect(new Vector2(6, 2).scaleAndAdd(2, new Vector2(3, 4)).elements).toEqualishValues(
            12,
            10
        );
        expect(
            new Vector2(1, 2).scaleAndAdd(2, new Vector2(3, 4), new Vector2(1, 2)).elements
        ).toEqualishValues(5, 8);
    });

    it('distance', () => {
        expect(new Vector2(6, 2).distance(new Vector2(3, 6))).toBe(5);
        expect(new Vector2(1, 2).distance(new Vector2(3, 4), new Vector2(0, 0))).toBe(5);
    });

    it('squaredDistance', () => {
        expect(new Vector2(6, 2).squaredDistance(new Vector2(3, 6))).toBe(25);
        expect(new Vector2(1, 2).squaredDistance(new Vector2(3, 4), new Vector2(0, 0))).toBe(25);
    });

    it('length', () => {
        expect(new Vector2(3, -4).length()).toBe(5);
    });

    it('squaredLength', () => {
        expect(new Vector2(3, -4).squaredLength()).toBe(25);
    });

    it('negate', () => {
        expect(new Vector2(0.5, -0.25).negate().elements).toEqualishValues(-0.5, 0.25);
    });

    it('inverse', () => {
        expect(new Vector2(0.5, -0.25).inverse().elements).toEqualishValues(2, -4);
        expect(new Vector2(0.5, -0.25).inverse(new Vector2(0.5, -0.2)).elements).toEqualishValues(
            2,
            -5
        );
    });

    it('normalize', () => {
        expect(new Vector2(3, -4).normalize().elements).toEqualishValues(0.6, -0.8);
    });

    it('dot', () => {
        expect(new Vector2(1, 2).dot(new Vector2(3, 4))).toBe(11);
    });

    it('cross', () => {
        expect(new Vector2(1, 2).cross(new Vector2(3, 4)).elements).toEqualishValues(0, 0);
        expect(
            new Vector2(2, 4).cross(new Vector2(1, 2), new Vector2(3, 4)).elements
        ).toEqualishValues(0, 0);
    });

    it('lerp', () => {
        expect(new Vector2(1, 2).lerp(new Vector2(3, 4), 0.5).elements).toEqualishValues(2, 3);
    });

    it('random', () => {
        const len = new Vector2(1, 2).random(0.4).length();
        expect(len).toBeGreaterThanOrEqual(0);
        expect(len).toBeLessThanOrEqual(0.40001);
    });

    it('transformMat3', () => {
        const mat3 = new Hilo3d.Matrix3().scale(new Vector2(2, 0.5));
        expect(new Vector2(2, 1).transformMat3(mat3).elements).toEqualishValues(4, 0.5);
    });

    it('transformMat4', () => {
        const mat4 = new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 0.5, 1));
        expect(new Vector2(2, 1).transformMat4(mat4).elements).toEqualishValues(4, 0.5);
    });

    it('equals & exactEquals', () => {
        expect(new Vector2(1.001, 2.009).exactEquals(new Vector2(1.001, 2.009))).toBe(true);

        expect(new Vector2(1.001, 2.009).exactEquals(new Vector2(1.001001, 2.009))).toBe(false);
        expect(new Vector2(1.001, 2.009).equals(new Vector2(1.001001, 2.009))).toBe(true);
    });
});
