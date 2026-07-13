import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Quaternion = Hilo3d.Quaternion;

describe('Quaternion', () => {
    let quatA = new Quaternion();
    let quatB = new Quaternion();
    let identity = new Quaternion();
    const deg90 = Math.PI * 0.5;
    beforeEach(() => {
        quatA = new Quaternion(1, 2, 3, 4);
        quatB = new Quaternion(5, 6, 7, 8);
        identity = new Quaternion(0, 0, 0, 1);
    });

    it('create', () => {
        expect(quatA.isQuaternion).toBe(true);
        expect(quatA.className).toBe('Quaternion');
        expect(quatA.x).toBe(1);
        expect(quatA.y).toBe(2);
        expect(quatA.z).toBe(3);
        expect(quatA.w).toBe(4);
    });

    it('copy', () => {
        expect(identity.copy(quatA).elements).toEqualishValues(1, 2, 3, 4);
    });

    it('clone', () => {
        expect(quatA.clone().elements).toEqualishValues(1, 2, 3, 4);
    });

    it('toArray', () => {
        const result: number[] = [];
        quatA.toArray(result, 2);
        expect(result[2]).toBe(1);
        expect(result[3]).toBe(2);
        expect(result[4]).toBe(3);
        expect(result[5]).toBe(4);
    });

    it('fromArray', () => {
        expect(identity.fromArray([0, 0, 1, 2, 3, 4], 2).elements).toEqualishValues(1, 2, 3, 4);
    });

    it('set', () => {
        expect(identity.set(1, 2, 3, 4).elements).toEqualishValues(1, 2, 3, 4);
    });

    it('identity', () => {
        expect(quatA.identity().elements).toEqualishValues(0, 0, 0, 1);
    });

    it('rotationTo', () => {
        expect(
            identity.rotationTo(new Hilo3d.Vector3(0, 1, 0), new Hilo3d.Vector3(1, 0, 0)).elements
        ).toEqualishValues(0, 0, -Math.sqrt(0.5), Math.sqrt(0.5));
    });

    it('setAxes', () => {
        expect(
            identity.setAxes(
                new Hilo3d.Vector3(-1, 0, 0),
                new Hilo3d.Vector3(0, 0, -1),
                new Hilo3d.Vector3(0, 1, 0)
            ).elements
        ).toEqualishValues(0, -Math.sqrt(0.5), 0, Math.sqrt(0.5));
        expect(new Hilo3d.Vector3(0, 0, -1).transformQuat(identity).elements).toEqualishValues(
            1,
            0,
            0
        );
    });

    it('setAxisAngle', () => {
        expect(
            identity.setAxisAngle(new Hilo3d.Vector3(1, 0, 0), Math.PI * 0.5).elements
        ).toEqualishValues(Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
    });

    it('getAxisAngle', () => {
        identity.setAxisAngle(new Hilo3d.Vector3(1, 0, 0), 0.7778);
        const axis = new Hilo3d.Vector3();
        expect(identity.getAxisAngle(axis)).toBeEqualish(0.7778);
        expect(axis.elements).toEqualishValues(1, 0, 0);
    });

    it('add', () => {
        expect(quatA.add(quatB).elements).toEqualishValues(6, 8, 10, 12);
    });

    it('multiply', () => {
        expect(quatA.multiply(quatB).elements).toEqualishValues(24, 48, 48, -6);
    });

    it('premultiply', () => {
        expect(quatB.premultiply(quatA).elements).toEqualishValues(24, 48, 48, -6);
    });

    it('scale', () => {
        expect(quatA.scale(2).elements).toEqualishValues(2, 4, 6, 8);
    });

    it('rotateX', () => {
        identity.rotateX(deg90);
        expect(new Hilo3d.Vector3(0, 0, -1).transformQuat(identity).elements).toEqualishValues(
            0,
            1,
            0
        );
    });

    it('rotateY', () => {
        identity.rotateY(deg90);
        expect(new Hilo3d.Vector3(0, 0, -1).transformQuat(identity).elements).toEqualishValues(
            -1,
            0,
            0
        );
    });

    it('rotateZ', () => {
        identity.rotateZ(deg90);
        expect(new Hilo3d.Vector3(0, 1, 0).transformQuat(identity).elements).toEqualishValues(
            -1,
            0,
            0
        );
    });

    it('calculateW', () => {
        expect(quatA.calculateW().elements).toEqualishValues(
            1,
            2,
            3,
            Math.sqrt(Math.abs(1.0 - 1 - 4 - 9))
        );
    });

    it('dot', () => {
        expect(quatA.dot(quatB)).toBeEqualish(70);
    });

    it('lerp', () => {
        expect(quatA.lerp(quatB, 0.5).elements).toEqualishValues(3, 4, 5, 6);
    });

    it('slerp', () => {
        quatA.set(1, 0, 0, 0);
        quatA.rotateX(Math.PI);
        expect(new Quaternion(1, 0, 0, 0).slerp(quatA, 1).elements).toEqualishValues(0, 0, 0, -1);
        expect(
            new Quaternion(1, 0, 0, 0).slerp(new Quaternion(-1, 0, 0, 0), 0.5).elements
        ).toEqualishValues(1, 0, 0, 0);
        expect(identity.slerp(new Quaternion(0, 1, 0, 0), 0.5).elements).toEqualishValues(
            0,
            Math.sqrt(0.5),
            0,
            Math.sqrt(0.5)
        );
    });

    it('sqlerp', () => {
        expect(
            identity.sqlerp(
                quatA,
                quatB,
                new Quaternion(4, 5, 6, 7),
                new Quaternion(2, 4, 3, 4),
                0.5
            ).elements
        ).toEqualishValues(3, 4.25, 4.75, 5.75);
    });

    it('invert', () => {
        expect(quatA.invert().elements).toEqualishValues(
            -0.03333333,
            -0.066666670143,
            -0.1,
            0.13333333
        );
    });

    it('conjugate', () => {
        expect(quatA.conjugate().elements).toEqualishValues(-1, -2, -3, 4);
    });

    it('length', () => {
        expect(quatA.length()).toBeEqualish(Math.sqrt(30));
    });

    it('squaredLength', () => {
        expect(quatA.squaredLength()).toBeEqualish(30);
    });

    it('normalize', () => {
        expect(quatA.set(5, 0, 0, 0).normalize().elements).toEqualishValues(1, 0, 0, 0);
    });

    it('fromMat3', () => {
        const mat = new Hilo3d.Matrix3().set(1, 0, 0, 0, 0, -1, 0, 1, 0);
        expect(identity.fromMat3(mat).elements).toEqualishValues(
            -Math.sqrt(0.5),
            0,
            0,
            Math.sqrt(0.5)
        );
    });

    it('fromMat4', () => {
        const mat = new Hilo3d.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 1, 2, 3, 1);
        expect(identity.fromMat4(mat).elements).toEqualishValues(
            -Math.sqrt(0.5),
            0,
            0,
            Math.sqrt(0.5)
        );
    });

    it('exactEquals', () => {
        expect(quatA.clone().exactEquals(quatA)).toBe(true);
    });

    it('equals', () => {
        const quat = quatA.clone();
        quat.x += 0.0000001;
        expect(quat.exactEquals(quatA)).toBe(false);
        expect(quat.equals(quatA)).toBe(true);
    });

    it('fromEuler', () => {
        expect(identity.fromEuler(new Hilo3d.Euler(-deg90, 0, 0)).elements).toEqualishValues(
            -Math.sqrt(0.5),
            0,
            0,
            Math.sqrt(0.5)
        );
    });
});
