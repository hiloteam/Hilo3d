import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Frustum = Hilo3d.Frustum;

function planeAt(frustum: Hilo3d.Frustum, index: number): Hilo3d.Plane {
    const plane = frustum.planes[index];
    if (!plane) throw new RangeError(`Expected frustum plane at index ${String(index)}`);
    return plane;
}

describe('Frustum', () => {
    let frustumA = new Frustum();
    let identity = new Frustum();
    beforeEach(() => {
        frustumA = new Frustum();
        identity = new Frustum();

        frustumA.fromMatrix(new Hilo3d.Matrix4().perspective(Math.PI / 2, 1, 0.01, 10));
    });

    it('create', () => {
        expect(frustumA.isFrustum).toBe(true);
        expect(frustumA.className).toBe('Frustum');
    });

    it('copy', () => {
        identity.copy(frustumA);
        identity.planes.forEach((plane, index) => {
            const sourcePlane = planeAt(frustumA, index);
            expect(plane.normal.equals(sourcePlane.normal)).toBe(true);
            expect(plane.distance).toBe(sourcePlane.distance);
        });
    });

    it('clone', () => {
        const frustum = frustumA.clone();
        frustum.planes.forEach((plane, index) => {
            const sourcePlane = planeAt(frustumA, index);
            expect(plane.normal.equals(sourcePlane.normal)).toBe(true);
            expect(plane.distance).toBe(sourcePlane.distance);
        });
    });

    it('fromMatrix', () => {
        identity.fromMatrix(new Hilo3d.Matrix4().frustum(-1, 1, -1, 1, -1, 1));
        const sqrt5 = Math.sqrt(0.5);
        const planes = identity.planes.map((_plane, index) => planeAt(identity, index));
        const expectedNormals = [
            [sqrt5, 0, -sqrt5],
            [-sqrt5, 0, -sqrt5],
            [0, -sqrt5, -sqrt5],
            [0, sqrt5, -sqrt5],
            [0, 0, -1],
            [0, 0, -1]
        ];
        planes.forEach((plane, index) => {
            const normal = expectedNormals[index];
            if (!normal) throw new RangeError('Missing expected frustum normal');
            expect(plane.normal.elements).toEqualishValues(...normal);
        });
        expect(planes.map(plane => plane.distance)).toEqual([0, 0, 0, 0, -1, 1]);
    });

    it('intersectsSphere', () => {
        identity.fromMatrix(new Hilo3d.Matrix4().frustum(-1, 1, -1, 1, -1, 1));

        expect(
            identity.intersectsSphere(
                new Hilo3d.Sphere({
                    center: new Hilo3d.Vector3(),
                    radius: 2
                })
            )
        ).toBe(true);

        expect(
            identity.intersectsSphere(
                new Hilo3d.Sphere({
                    center: new Hilo3d.Vector3(),
                    radius: 0.1
                })
            )
        ).toBe(false);
    });
});
