import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Vector3 = Hilo3d.Vector3;

describe('Vector3', function () {
    it('create', () => {
        const vec = new Vector3(1, 2, 3);
        expect(vec.isVector3).toBe(true);
        expect(vec.className).toBe('Vector3');

        expect(vec.x).toBe(1);
        expect(vec.y).toBe(2);
        expect(vec.z).toBe(3);
    });

    it('copy', () => {
        const v = new Vector3(1, 2, 3);
        expect(new Vector3().copy(v).elements).toEqual(v.elements);
    });

    it('clone', () => {
        const v = new Vector3(1, 2, 3);
        expect(v.clone().elements).toEqual(v.elements);
    });

    it('toArray', () => {
        const res: number[] = [];
        new Vector3(1, 2, 3).toArray(res, 5);
        expect(res[5]).toBe(1);
        expect(res[6]).toBe(2);
        expect(res[7]).toBe(3);
    });

    it('fromArray', () => {
        const res = [0, 0, 0, 1, 2, 3];
        expect(new Vector3().fromArray(res, 2).elements).toEqualishValues(0, 1, 2);
    });

    it('set', () => {
        expect(new Vector3().set(1, 2, 3).elements).toEqualishValues(1, 2, 3);
    });

    it('add', () => {
        expect(new Vector3(1, 2, 3).add(new Vector3(3, 4, 5)).elements).toEqualishValues(4, 6, 8);
        expect(
            new Vector3(1, 2, 3).add(new Vector3(3, 4, 5), new Vector3(1, 0, 1)).elements
        ).toEqualishValues(4, 4, 6);
    });

    it('subtract', () => {
        expect(new Vector3(1, 2, 3).subtract(new Vector3(3, 4, 5)).elements).toEqualishValues(
            -2,
            -2,
            -2
        );
        expect(
            new Vector3(1, 2, 3).subtract(new Vector3(3, 4, 5), new Vector3(1, 0, 1)).elements
        ).toEqualishValues(2, 4, 4);
    });

    it('multiply', () => {
        expect(new Vector3(1, 2, 3).multiply(new Vector3(3, 4, 5)).elements).toEqualishValues(
            3,
            8,
            15
        );
        expect(
            new Vector3(1, 2, 3).multiply(new Vector3(3, 4, 5), new Vector3(1, 0, 1)).elements
        ).toEqualishValues(3, 0, 5);
    });

    it('divide', () => {
        expect(new Vector3(6, 2, 7).divide(new Vector3(3, 4, 7)).elements).toEqualishValues(
            2,
            0.5,
            1
        );
        expect(
            new Vector3(1, 2, 3).divide(new Vector3(3, 4, 7), new Vector3(1, 2, 1)).elements
        ).toEqualishValues(3, 2, 7);
    });

    it('ceil', () => {
        expect(new Vector3(1.1, 2.9, 1.2).ceil().elements).toEqualishValues(2, 3, 2);
    });

    it('floor', () => {
        expect(new Vector3(1.1, 2.9, 2.1).floor().elements).toEqualishValues(1, 2, 2);
    });

    it('min', () => {
        expect(new Vector3(6, 2, 1).min(new Vector3(3, 4, 2)).elements).toEqualishValues(3, 2, 1);
        expect(
            new Vector3(1, 2, 1).min(new Vector3(3, 4, 1), new Vector3(1, 2, 1)).elements
        ).toEqualishValues(1, 2, 1);
    });

    it('max', () => {
        expect(new Vector3(6, 2, 1).max(new Vector3(3, 4, 2)).elements).toEqualishValues(6, 4, 2);
        expect(
            new Vector3(1, 2, 1).max(new Vector3(3, 4, 1), new Vector3(1, 2, 1)).elements
        ).toEqualishValues(3, 4, 1);
    });

    it('round', () => {
        expect(new Vector3(1.2, 2.5, 3.1).round().elements).toEqualishValues(1, 3, 3);
    });

    it('scale', () => {
        expect(new Vector3(1.2, 2.5, 0.8).scale(2).elements).toEqualishValues(2.4, 5, 1.6);
    });

    it('scaleAndAdd', () => {
        expect(new Vector3(6, 2, 1).scaleAndAdd(2, new Vector3(3, 4, 0)).elements).toEqualishValues(
            12,
            10,
            1
        );
        expect(
            new Vector3(1, 2, 1).scaleAndAdd(2, new Vector3(3, 4, 1), new Vector3(1, 2, 1)).elements
        ).toEqualishValues(5, 8, 3);
    });

    it('distance', () => {
        expect(new Vector3(6, 2, 3).distance(new Vector3(3, 6, 3))).toBe(5);
        expect(new Vector3(1, 2, 3).distance(new Vector3(3, 4, 4), new Vector3(0, 0, 4))).toBe(5);
    });

    it('squaredDistance', () => {
        expect(new Vector3(6, 2, 1).squaredDistance(new Vector3(3, 6, 1))).toBe(25);
        expect(
            new Vector3(1, 2, 2).squaredDistance(new Vector3(3, 4, 2), new Vector3(0, 0, 2))
        ).toBe(25);
    });

    it('length', () => {
        expect(new Vector3(3, -4, 0).length()).toBe(5);
    });

    it('squaredLength', () => {
        expect(new Vector3(3, -4, 0).squaredLength()).toBe(25);
    });

    it('negate', () => {
        expect(new Vector3(0.5, -0.25, 1).negate().elements).toEqualishValues(-0.5, 0.25, -1);
    });

    it('inverse', () => {
        expect(new Vector3(0.5, -0.25, 1).inverse().elements).toEqualishValues(2, -4, 1);
        expect(
            new Vector3(0.5, -0.25, 1).inverse(new Vector3(0.5, -0.25, 0.5)).elements
        ).toEqualishValues(2, -4, 2);
    });

    it('normalize', () => {
        expect(new Vector3(3, -4, 0).normalize().elements).toEqualishValues(0.6, -0.8, 0);
    });

    it('dot', () => {
        expect(new Vector3(1, 2, 1).dot(new Vector3(3, 4, 2))).toBe(13);
    });

    it('cross', () => {
        expect(new Vector3(1, 2, 0).cross(new Vector3(3, 4, 0)).elements).toEqualishValues(
            0,
            0,
            -2
        );
        expect(
            new Vector3(2, 4, 0).cross(new Vector3(1, 2, 0), new Vector3(3, 4, 0)).elements
        ).toEqualishValues(0, 0, -2);
    });

    it('lerp', () => {
        expect(new Vector3(1, 2, 3).lerp(new Vector3(3, 4, 5), 0.5).elements).toEqualishValues(
            2,
            3,
            4
        );
    });

    it('hermite', () => {
        expect(
            new Vector3().hermite(
                new Vector3(0, 0, 0),
                new Vector3(0, 1, 0),
                new Vector3(1, 1, 0),
                new Vector3(2, 0, 0),
                0.6
            ).elements
        ).toEqualishValues(1.152, -0.048, 0);
    });

    it('bezier', () => {
        expect(
            new Vector3().bezier(
                new Vector3(0, 0, 0),
                new Vector3(0, 1, 0),
                new Vector3(1, 1, 0),
                new Vector3(2, 0, 0),
                0.6
            ).elements
        ).toEqualishValues(0.864, 0.72, 0);
    });

    it('random', () => {
        const len = new Vector3(1, 2).random(0.4).length();
        expect(len).toBeGreaterThanOrEqual(0);
        expect(len).toBeLessThanOrEqual(0.40001);
    });

    it('transformMat3', () => {
        const mat3 = new Hilo3d.Matrix3().fromMat4(
            new Hilo3d.Matrix4().scale(new Vector3(2, 0.5, 3))
        );
        expect(new Vector3(2, 1, 5).transformMat3(mat3).elements).toEqualishValues(4, 0.5, 15);
    });

    it('transformMat4', () => {
        const mat4 = new Hilo3d.Matrix4().scale(new Hilo3d.Vector3(2, 0.5, 3));
        expect(new Vector3(2, 1, 3).transformMat4(mat4).elements).toEqualishValues(4, 0.5, 9);
    });

    it('transformQuat', () => {
        expect(
            new Vector3(1, 0, 0).transformQuat(new Hilo3d.Quaternion(0, 0, 1, 0)).elements
        ).toEqualishValues(-1, 0, 0);
    });

    it('transformDirection', () => {
        const mat4 = new Hilo3d.Matrix4()
            .scale(new Hilo3d.Vector3(2, 0.5, 3))
            .translate(new Hilo3d.Vector3(1, -2, 0));
        expect(new Vector3(1, 0, 0).transformDirection(mat4).elements).toEqualishValues(2, 0, 0);
    });

    it('rotateX', () => {
        expect(
            new Vector3(2, 7, 0).rotateX(new Vector3(2, 5, 0), Math.PI).elements
        ).toEqualishValues(2, 3, 0);
    });

    it('rotateY', () => {
        expect(
            new Vector3(1, 0, 0).rotateY(new Vector3(0, 0, 0), Math.PI).elements
        ).toEqualishValues(-1, 0, 0);
    });

    it('rotateZ', () => {
        expect(
            new Vector3(0, 6, -5).rotateZ(new Vector3(0, 0, -5), Math.PI).elements
        ).toEqualishValues(0, -6, -5);
    });

    it('equals & exactEquals', () => {
        expect(new Vector3(1.001, 2.009, 2).exactEquals(new Vector3(1.001, 2.009, 2))).toBe(true);

        expect(new Vector3(1.001, 2.009, 2).exactEquals(new Vector3(1.001001, 2.009, 2))).toBe(
            false
        );
        expect(new Vector3(1.001, 2.009, 2).equals(new Vector3(1.001001, 2.009, 2))).toBe(true);
    });
});
