import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Matrix4 = Hilo3d.Matrix4;

describe('Matrix4', () => {
    let matA = new Matrix4();
    let matB = new Matrix4();
    let matC = new Matrix4();
    let matD = new Matrix4();
    let identity = new Matrix4();
    beforeEach(() => {
        matA = new Matrix4();
        matB = new Matrix4();
        matC = new Matrix4();
        matD = new Matrix4();
        identity = new Matrix4();

        matA.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1);
        matB.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1);
        matC.set(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
        matD.set(0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30);
    });

    it('create', () => {
        expect(identity.isMatrix4).toBe(true);
        expect(identity.className).toBe('Matrix4');
    });

    it('copy', () => {
        expect(new Matrix4().copy(matC).elements).toEqualishValues(
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15
        );
    });

    it('clone', () => {
        expect(matC.clone().elements).toEqualishValues(
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15
        );
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
            identity.fromArray(
                [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
                3
            ).elements
        ).toEqualishValues(3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18);
    });

    it('set', () => {
        expect(
            identity.set(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15).elements
        ).toEqualishValues(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15);
    });

    it('identity', () => {
        expect(matC.identity().elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1
        );
    });

    it('transpose', () => {
        expect(matC.transpose().elements).toEqualishValues(
            0,
            4,
            8,
            12,
            1,
            5,
            9,
            13,
            2,
            6,
            10,
            14,
            3,
            7,
            11,
            15
        );
    });

    it('invert', () => {
        expect(identity.invert(matA).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            -1,
            -2,
            -3,
            1
        );
        expect(matA.invert().elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            -1,
            -2,
            -3,
            1
        );
    });

    it('adjoint', () => {
        expect(identity.adjoint(matA).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            -1,
            -2,
            -3,
            1
        );
        expect(matA.adjoint().elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            -1,
            -2,
            -3,
            1
        );
    });

    it('determinant', () => {
        expect(matA.determinant()).toBeEqualish(1);
    });

    it('multiply', () => {
        expect(identity.multiply(matA, matB).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            5,
            7,
            9,
            1
        );
        expect(matA.multiply(matB).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            5,
            7,
            9,
            1
        );
    });

    it('premultiply', () => {
        expect(matB.premultiply(matA).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            5,
            7,
            9,
            1
        );
    });

    it('translate', () => {
        expect(matA.translate(new Hilo3d.Vector3(4, 5, 6)).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            5,
            7,
            9,
            1
        );
    });

    it('rotate', () => {
        const rad = Math.PI * 0.5;
        expect(matA.rotate(rad, new Hilo3d.Vector3(1, 0, 0)).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            Math.cos(rad),
            Math.sin(rad),
            0,
            0,
            -Math.sin(rad),
            Math.cos(rad),
            0,
            1,
            2,
            3,
            1
        );
    });

    it('rotateX', () => {
        const rad = Math.PI * 0.5;
        expect(matA.rotateX(rad).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            Math.cos(rad),
            Math.sin(rad),
            0,
            0,
            -Math.sin(rad),
            Math.cos(rad),
            0,
            1,
            2,
            3,
            1
        );
    });

    it('rotateY', () => {
        const rad = Math.PI * 0.5;
        expect(matA.rotateY(rad).elements).toEqualishValues(
            Math.cos(rad),
            0,
            -Math.sin(rad),
            0,
            0,
            1,
            0,
            0,
            Math.sin(rad),
            0,
            Math.cos(rad),
            0,
            1,
            2,
            3,
            1
        );
    });

    it('rotateZ', () => {
        const rad = Math.PI * 0.5;
        expect(matA.rotateZ(rad).elements).toEqualishValues(
            Math.cos(rad),
            Math.sin(rad),
            0,
            0,
            -Math.sin(rad),
            Math.cos(rad),
            0,
            0,
            0,
            0,
            1,
            0,
            1,
            2,
            3,
            1
        );
    });

    it('fromTranslation', () => {
        expect(identity.fromTranslation(new Hilo3d.Vector3(1, 2, 3)).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            1,
            2,
            3,
            1
        );
    });

    it('fromScaling', () => {
        expect(identity.fromScaling(new Hilo3d.Vector3(2, 1, 3)).elements).toEqualishValues(
            2,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            3,
            0,
            0,
            0,
            0,
            1
        );
    });

    it('fromRotation', () => {
        expect(
            identity.fromRotation(Math.PI * 0.5, new Hilo3d.Vector3(0, 1, 0)).elements
        ).toEqualishValues(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
    });

    it('fromXRotation', () => {
        expect(identity.fromXRotation(Math.PI * 0.5).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            -1,
            0,
            0,
            0,
            0,
            0,
            1
        );
    });

    it('fromYRotation', () => {
        expect(identity.fromYRotation(Math.PI * 0.5).elements).toEqualishValues(
            0,
            0,
            -1,
            0,
            0,
            1,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
            1
        );
    });

    it('fromZRotation', () => {
        expect(identity.fromZRotation(Math.PI * 0.5).elements).toEqualishValues(
            0,
            1,
            0,
            0,
            -1,
            0,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            1
        );
    });

    it('fromRotationTranslation', () => {
        expect(
            identity.fromRotationTranslation(
                new Hilo3d.Quaternion(0, 0.7071067811865476, 0, 0.7071067811865476),
                new Hilo3d.Vector3(1, 2, 3)
            ).elements
        ).toEqualishValues(3.422854177870249e-8, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 2, 3, 1);
    });

    it('getTranslation', () => {
        expect(matB.getTranslation().elements).toEqualishValues(4, 5, 6);
    });

    it('getScaling', () => {
        expect(
            identity.fromScaling(new Hilo3d.Vector3(1, 2, 3)).getScaling().elements
        ).toEqualishValues(1, 2, 3);
    });

    it('getRotation', () => {
        identity.rotateZ(Math.PI * 0.5);
        expect(identity.getRotation().elements).toEqualishValues(
            0,
            0,
            Math.sqrt(2) * 0.5,
            Math.sqrt(2) * 0.5
        );
    });

    it('fromRotationTranslationScale', () => {
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI * 0.5, new Hilo3d.Vector3(1, 0, 0));

        matA.fromRotationTranslationScale(
            new Hilo3d.Quaternion(Math.sqrt(2) * 0.5, 0, 0, Math.sqrt(2) * 0.5),
            new Hilo3d.Vector3(1, 2, 3),
            new Hilo3d.Vector3(0.1, 5, 2)
        );
        expect(matA.equals(identity)).toBe(true);
    });

    it('fromRotationTranslationScaleOrigin', () => {
        identity.translate(new Hilo3d.Vector3(5, 6, 7));
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI * 0.5, new Hilo3d.Vector3(1, 0, 0));
        identity.translate(new Hilo3d.Vector3(-5, -6, -7));

        matA.fromRotationTranslationScaleOrigin(
            new Hilo3d.Quaternion(Math.sqrt(2) * 0.5, 0, 0, Math.sqrt(2) * 0.5),
            new Hilo3d.Vector3(1, 2, 3),
            new Hilo3d.Vector3(0.1, 5, 2),
            new Hilo3d.Vector3(5, 6, 7)
        );
        expect(matA.equals(identity)).toBe(true);
    });

    it('fromQuat', () => {
        expect(
            identity.fromQuat(new Hilo3d.Quaternion(0, 0.7071067811865476, 0, 0.7071067811865476))
                .elements
        ).toEqualishValues(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
    });

    it('frustum', () => {
        expect(identity.frustum(-1, 1, -1, 1, -1, 1).elements).toEqualishValues(
            -1,
            0,
            0,
            0,
            0,
            -1,
            0,
            0,
            0,
            0,
            0,
            -1,
            0,
            0,
            1,
            0
        );
    });

    it('perspective', () => {
        const fovy = Math.PI * 0.5;
        expect(identity.perspective(fovy, 1, 0, 1).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            -1,
            -1,
            0,
            0,
            0,
            0
        );
    });

    it('perspectiveFromFieldOfView', () => {
        const fov = 45;
        expect(
            identity.perspectiveFromFieldOfView(
                {
                    upDegrees: fov,
                    downDegrees: fov,
                    leftDegrees: fov,
                    rightDegrees: fov
                },
                0,
                1
            ).elements
        ).toEqualishValues(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, 0, 0);
    });

    it('ortho', () => {
        expect(identity.ortho(-1, 1, -1, 1, -1, 1).elements).toEqualishValues(
            1,
            0,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            -1,
            0,
            0,
            0,
            0,
            1
        );
    });

    it('lookAt', () => {
        identity.lookAt(
            new Hilo3d.Vector3(0, 2, 0),
            new Hilo3d.Vector3(0, 0.6, 0),
            new Hilo3d.Vector3(0, 0, -1)
        );
        expect(new Hilo3d.Vector3(1, 2, 0).transformMat4(identity).elements).toEqualishValues(
            1,
            0,
            0
        );
    });

    it('targetTo', () => {
        matB.targetTo(
            new Hilo3d.Vector3(0, 2, 0),
            new Hilo3d.Vector3(0, 0.6, 0),
            new Hilo3d.Vector3(0, 0, -1)
        );
        expect(matB.getScaling().elements).toEqualishValues(1, 1, 1);
        expect(new Hilo3d.Vector3(1, 2, 0).transformMat4(matB).elements).toEqualishValues(1, 2, -2);
    });

    it('frob', () => {
        expect(matA.frob()).toBeEqualish(
            Math.sqrt(
                Math.pow(1, 2) +
                    Math.pow(1, 2) +
                    Math.pow(1, 2) +
                    Math.pow(1, 2) +
                    Math.pow(1, 2) +
                    Math.pow(2, 2) +
                    Math.pow(3, 2)
            )
        );
    });

    it('add', () => {
        expect(identity.add(matC, matD).elements).toEqualishValues(
            0,
            3,
            6,
            9,
            12,
            15,
            18,
            21,
            24,
            27,
            30,
            33,
            36,
            39,
            42,
            45
        );
        expect(matD.add(matC).elements).toEqualishValues(
            0,
            3,
            6,
            9,
            12,
            15,
            18,
            21,
            24,
            27,
            30,
            33,
            36,
            39,
            42,
            45
        );
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
            -8,
            -9,
            -10,
            -11,
            -12,
            -13,
            -14,
            -15
        );
        expect(matD.subtract(matC).elements).toEqualishValues(
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11,
            12,
            13,
            14,
            15
        );
    });

    it('exactEquals', () => {
        const mat = matA.clone();
        expect(mat.exactEquals(matA)).toBe(true);
    });

    it('equals', () => {
        const mat = matA.clone();
        mat.elements[0] = 1.000001;
        expect(mat.exactEquals(matA)).toBe(false);
        expect(mat.equals(matA)).toBe(true);
    });

    it('compose', () => {
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI * 0.5, new Hilo3d.Vector3(1, 0, 0));

        matA.compose(
            new Hilo3d.Quaternion(Math.sqrt(2) * 0.5, 0, 0, Math.sqrt(2) * 0.5),
            new Hilo3d.Vector3(1, 2, 3),
            new Hilo3d.Vector3(0.1, 5, 2)
        );
        expect(matA.equals(identity)).toBe(true);
    });

    it('decompose', () => {
        identity.translate(new Hilo3d.Vector3(1, 2, 3));
        identity.scale(new Hilo3d.Vector3(0.1, 2, 5));
        identity.rotate(Math.PI * 0.5, new Hilo3d.Vector3(1, 0, 0));

        const pos = new Hilo3d.Vector3();
        const scale = new Hilo3d.Vector3();
        const quat = new Hilo3d.Quaternion();
        identity.decompose(quat, pos, scale);

        expect(pos.elements).toEqualishValues(1, 2, 3);
        expect(scale.elements).toEqualishValues(0.1, 5, 2);
        expect(quat.elements).toEqualishValues(Math.sqrt(2) * 0.5, 0, 0, Math.sqrt(2) * 0.5);
    });
});
