import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Vector4 = Hilo3d.Vector4;

describe('Vector4', function () {
    it('create', () => {
        const vec = new Vector4(1, 2, 3, 4);
        expect(vec.isVector4).toBe(true);
        expect(vec.className).toBe('Vector4');

        expect(vec.x).toBe(1);
        expect(vec.y).toBe(2);
        expect(vec.z).toBe(3);
        expect(vec.w).toBe(4);
    });

    it('copy', () => {
        const v = new Vector4(1, 2, 3, 4);
        expect(new Vector4().copy(v).elements).toEqual(v.elements);
    });

    it('clone', () => {
        const v = new Vector4(1, 2, 3, 4);
        expect(v.clone().elements).toEqual(v.elements);
    });

    it('toArray', () => {
        const res: number[] = [];
        new Vector4(1, 2, 3, 4).toArray(res, 5);
        expect(res[5]).toBe(1);
        expect(res[6]).toBe(2);
        expect(res[7]).toBe(3);
        expect(res[8]).toBe(4);
    });

    it('fromArray', () => {
        const res = [0, 0, 0, 1, 2, 3, 4];
        expect(new Vector4().fromArray(res, 2).elements).toEqualishValues(0, 1, 2, 3);
    });

    it('set', () => {
        expect(new Vector4().set(1, 2, 3, 4).elements).toEqualishValues(1, 2, 3, 4);
    });

    it('add', () => {
        expect(new Vector4(1, 2, 3, 4).add(new Vector4(3, 4, 5, 6)).elements).toEqualishValues(
            4,
            6,
            8,
            10
        );
        expect(
            new Vector4(1, 2, 3, 4).add(new Vector4(3, 4, 5, 6), new Vector4(1, 0, 1, 2)).elements
        ).toEqualishValues(4, 4, 6, 8);
    });

    it('subtract', () => {
        expect(new Vector4(1, 2, 3, 4).subtract(new Vector4(3, 4, 5, 7)).elements).toEqualishValues(
            -2,
            -2,
            -2,
            -3
        );
        expect(
            new Vector4(1, 2, 3, 4).subtract(new Vector4(3, 4, 5, 6), new Vector4(1, 0, 1, 3))
                .elements
        ).toEqualishValues(2, 4, 4, 3);
    });

    it('multiply', () => {
        expect(new Vector4(1, 2, 3, 4).multiply(new Vector4(3, 4, 5, 6)).elements).toEqualishValues(
            3,
            8,
            15,
            24
        );
        expect(
            new Vector4(1, 2, 3, 4).multiply(new Vector4(3, 4, 5, 6), new Vector4(1, 0, 1, 2))
                .elements
        ).toEqualishValues(3, 0, 5, 12);
    });

    it('divide', () => {
        expect(new Vector4(6, 2, 7, 1).divide(new Vector4(3, 4, 7, 1)).elements).toEqualishValues(
            2,
            0.5,
            1,
            1
        );
        expect(
            new Vector4(1, 2, 3, 10).divide(new Vector4(3, 4, 7, 8), new Vector4(1, 2, 1, 4))
                .elements
        ).toEqualishValues(3, 2, 7, 2);
    });

    it('ceil', () => {
        expect(new Vector4(1.1, 2.9, 1.2, 5).ceil().elements).toEqualishValues(2, 3, 2, 5);
    });

    it('floor', () => {
        expect(new Vector4(1.1, 2.9, 2.1, 2.8).floor().elements).toEqualishValues(1, 2, 2, 2);
    });

    it('min', () => {
        expect(new Vector4(6, 2, 1, 10).min(new Vector4(3, 4, 2, 1.2)).elements).toEqualishValues(
            3,
            2,
            1,
            1.2
        );
        expect(
            new Vector4(1, 2, 1, 0).min(new Vector4(3, 4, 1, 2.3), new Vector4(1, 2, 1, 2.2))
                .elements
        ).toEqualishValues(1, 2, 1, 2.2);
    });

    it('max', () => {
        expect(new Vector4(6, 2, 1, 1).max(new Vector4(3, 4, 2, 0)).elements).toEqualishValues(
            6,
            4,
            2,
            1
        );
        expect(
            new Vector4(1, 2, 1, 2).max(new Vector4(3, 4, 1, 2), new Vector4(1, 2, 1, 22)).elements
        ).toEqualishValues(3, 4, 1, 22);
    });

    it('round', () => {
        expect(new Vector4(1.2, 2.5, 3.1, 3.5).round().elements).toEqualishValues(1, 3, 3, 4);
    });

    it('scale', () => {
        expect(new Vector4(1.2, 2.5, 0.8, 1.1).scale(2).elements).toEqualishValues(
            2.4,
            5,
            1.6,
            2.2
        );
    });

    it('scaleAndAdd', () => {
        expect(
            new Vector4(6, 2, 1, 0).scaleAndAdd(2, new Vector4(3, 4, 0, 1)).elements
        ).toEqualishValues(12, 10, 1, 2);
        expect(
            new Vector4(1, 2, 1, 0).scaleAndAdd(2, new Vector4(3, 4, 1, 1), new Vector4(1, 2, 1, 3))
                .elements
        ).toEqualishValues(5, 8, 3, 7);
    });

    it('distance', () => {
        expect(new Vector4(6, 1, 2, 3).distance(new Vector4(3, 1, 6, 3))).toBe(5);
        expect(
            new Vector4(1, 1, 2, 3).distance(new Vector4(3, 1, 4, 4), new Vector4(0, 1, 0, 4))
        ).toBe(5);
    });

    it('squaredDistance', () => {
        expect(new Vector4(1, 6, 2, 1).squaredDistance(new Vector4(1, 3, 6, 1))).toBe(25);
        expect(
            new Vector4(1, 1, 2, 2).squaredDistance(
                new Vector4(1, 3, 4, 2),
                new Vector4(1, 0, 0, 2)
            )
        ).toBe(25);
    });

    it('length', () => {
        expect(new Vector4(3, 0, -4, 0).length()).toBe(5);
    });

    it('squaredLength', () => {
        expect(new Vector4(3, -4, 0, 1).squaredLength()).toBe(26);
    });

    it('negate', () => {
        expect(new Vector4(0.5, -0.25, 1, -1).negate().elements).toEqualishValues(
            -0.5,
            0.25,
            -1,
            1
        );
    });

    it('inverse', () => {
        expect(new Vector4(0.5, -0.25, 1, -1).inverse().elements).toEqualishValues(2, -4, 1, -1);
        expect(
            new Vector4(0.5, -0.25, 1, -1).inverse(new Vector4(0.5, -0.25, 1, -2)).elements
        ).toEqualishValues(2, -4, 1, -0.5);
    });

    it('normalize', () => {
        expect(new Vector4(3, 0, -4, 0).normalize().elements).toEqualishValues(0.6, 0, -0.8, 0);
    });

    it('dot', () => {
        expect(new Vector4(1, 2, 1, 3).dot(new Vector4(3, 4, 2, 5))).toBe(28);
    });

    it('lerp', () => {
        expect(
            new Vector4(1, 2, 3, 4).lerp(new Vector4(3, 4, 5, 6), 0.5).elements
        ).toEqualishValues(2, 3, 4, 5);
    });

    it('random', () => {
        expect(new Vector4(1, 2, 3, 5).random(0.4).length()).toBeEqualish(0.4);
    });

    it('transformMat4', () => {
        const mat4 = new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 0.5, 3));
        expect(new Vector4(2, 1, 3, 1).transformMat4(mat4).elements).toEqualishValues(4, 0.5, 9, 1);
    });

    it('transformQuat', () => {
        expect(
            new Vector4(1, 0, 0, 2).transformQuat(new Hilo3d.Quaternion(0, 0, 1, 0)).elements
        ).toEqualishValues(-1, 0, 0, 2);
    });

    it('equals & exactEquals', () => {
        expect(new Vector4(2, 1.001, 2.009, 2).exactEquals(new Vector4(2, 1.001, 2.009, 2))).toBe(
            true
        );

        expect(
            new Vector4(2, 1.001, 2.009, 2).exactEquals(new Vector4(2, 1.001001, 2.009, 2))
        ).toBe(false);
        expect(new Vector4(2, 1.001, 2.009, 2).equals(new Vector4(2, 1.001001, 2.009, 2))).toBe(
            true
        );
    });
});
