import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Matrix3 = Hilo3d.Matrix3;

describe('Matrix3', () => {
    let mat = new Hilo3d.Matrix4();
    let matA = new Matrix3();
    let matB = new Matrix3();
    let matC = new Matrix3();
    let matD = new Matrix3();
    let identity = new Matrix3();
    beforeEach(() => {
        matA = new Matrix3();
        matB = new Matrix3();
        matC = new Matrix3();
        matD = new Matrix3();
        identity = new Matrix3();

        matA.set(1, 0, 0, 0, 1, 0, 1, 2, 1);
        matB.set(1, 0, 0, 0, 1, 0, 3, 4, 1);
        matC.set(0, 1, 2, 3, 4, 5, 6, 7, 8);
        matD.set(0, 2, 4, 6, 8, 10, 12, 14, 16);
    });

    it('create', () => {
        expect(identity.isMatrix3).toBe(true);
        expect(identity.className).toBe('Matrix3');
    });

    it('copy', () => {
        expect(new Matrix3().copy(matC).elements).toEqualishValues(0, 1, 2, 3, 4, 5, 6, 7, 8);
    });

    it('clone', () => {
        expect(matC.clone().elements).toEqualishValues(0, 1, 2, 3, 4, 5, 6, 7, 8);
    });

    it('toArray', () => {
        const arr: number[] = [];
        matC.toArray(arr, 3);
        expect(arr[3]).toBe(0);
        expect(arr[4]).toBe(1);
        expect(arr[5]).toBe(2);
    });

    it('fromArray', () => {
        expect(
            identity.fromArray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3).elements
        ).toEqualishValues(3, 4, 5, 6, 7, 8, 9, 10, 11);
    });

    it('set', () => {
        expect(identity.set(0, 1, 2, 3, 4, 5, 6, 7, 8).elements).toEqualishValues(
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8
        );
    });

    it('identity', () => {
        expect(matC.identity().elements).toEqualishValues(1, 0, 0, 0, 1, 0, 0, 0, 1);
    });

    it('transpose', () => {
        expect(matC.transpose().elements).toEqualishValues(0, 3, 6, 1, 4, 7, 2, 5, 8);
    });

    it('invert', () => {
        expect(identity.invert(matA).elements).toEqualishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
        expect(matA.invert().elements).toEqualishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
    });

    it('adjoint', () => {
        expect(identity.adjoint(matA).elements).toEqualishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
        expect(matA.adjoint().elements).toEqualishValues(1, 0, 0, 0, 1, 0, -1, -2, 1);
    });

    it('determinant', () => {
        expect(matA.determinant()).toBeEqualish(1);
    });

    it('multiply', () => {
        expect(identity.multiply(matA, matB).elements).toEqualishValues(1, 0, 0, 0, 1, 0, 4, 6, 1);
        expect(matA.multiply(matB).elements).toEqualishValues(1, 0, 0, 0, 1, 0, 4, 6, 1);
    });

    it('premultiply', () => {
        expect(matB.premultiply(matA).elements).toEqualishValues(1, 0, 0, 0, 1, 0, 4, 6, 1);
    });

    it('translate', () => {
        expect(matA.translate(new Hilo3d.Vector2(1, 1)).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            1,
            0,
            2,
            3,
            1
        );
    });

    it('rotate', () => {
        expect(matA.rotate(Math.PI * 0.5).elements).toEqualishValues(0, 1, 0, -1, 0, 0, 1, 2, 1);
    });

    it('scale', () => {
        expect(matA.scale(new Hilo3d.Vector2(0.5, 2)).elements).toEqualishValues(
            0.5,
            0,
            0,
            0,
            2,
            0,
            1,
            2,
            1
        );
    });

    it('fromTranslation', () => {
        expect(identity.fromTranslation(new Hilo3d.Vector2(1, 2)).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            1,
            0,
            1,
            2,
            1
        );
    });

    it('fromRotation', () => {
        expect(identity.fromRotation(Math.PI * 0.5).elements).toEqualishValues(
            0,
            1,
            0,
            -1,
            0,
            0,
            0,
            0,
            1
        );
    });

    it('fromScaling', () => {
        expect(matC.fromScaling(new Hilo3d.Vector2(2, 1)).elements).toEqualishValues(
            2,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            1
        );
    });

    it('fromQuat', () => {
        expect(
            matC.fromQuat(new Hilo3d.Quaternion(0, -0.7071067811865475, 0, 0.7071067811865475))
                .elements
        ).toEqualishValues(0, 0, 1, 0, 1, 0, -1, 0, 0);
    });

    it('normalFromMat4', () => {
        mat = new Hilo3d.Matrix4();
        mat.translate(new Hilo3d.Vector3(2, 4, 6));
        mat.rotateX(Math.PI / 2);
        expect(matA.normalFromMat4(mat).elements).toEqualishValues(1, 0, 0, 0, 0, 1, 0, -1, 0);
    });

    it('fromMat4', () => {
        mat = new Hilo3d.Matrix4();
        mat.translate(new Hilo3d.Vector3(2, 4, 6));
        mat.rotateX(Math.PI / 2);
        expect(matA.fromMat4(mat).elements).toEqualishValues(1, 0, 0, 0, 0, 1, 0, -1, 0);
    });

    it('frob', () => {
        expect(matA.frob()).toBeEqualish(
            Math.sqrt(
                Math.pow(1, 2) +
                    Math.pow(0, 2) +
                    Math.pow(0, 2) +
                    Math.pow(0, 2) +
                    Math.pow(1, 2) +
                    Math.pow(0, 2) +
                    Math.pow(1, 2) +
                    Math.pow(2, 2) +
                    Math.pow(1, 2)
            )
        );
    });

    it('add', () => {
        expect(identity.add(matC, matD).elements).toEqualishValues(0, 3, 6, 9, 12, 15, 18, 21, 24);
        expect(matD.add(matC).elements).toEqualishValues(0, 3, 6, 9, 12, 15, 18, 21, 24);
    });

    it('subtract', () => {
        expect(identity.subtract(matC, matD).elements).toEqualishValues(
            0,
            -1,
            -2,
            -3,
            -4,
            -5,
            -6,
            -7,
            -8
        );
        expect(matD.subtract(matC).elements).toEqualishValues(0, 1, 2, 3, 4, 5, 6, 7, 8);
    });

    it('exactEquals', () => {
        matD.set(0, 1, 2, 3, 4, 5, 6, 7, 8);
        expect(matC.exactEquals(matD)).toBe(true);
    });

    it('equals', () => {
        matD.set(0, 1, 2, 3, 4, 5, 6, 7, 8.000001);
        expect(matC.exactEquals(matD)).toBe(false);
        expect(matC.equals(matD)).toBe(true);
    });

    it('fromRotationTranslationScale', () => {
        expect(
            matB.fromRotationTranslationScale(Math.PI * 0.5, 2, 1, 0.1, 2).elements
        ).toEqualishValues(0, -2, 0, 0.1, 0, 0, 2, 1, 1);
    });
});
