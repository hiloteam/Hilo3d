import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Ray = Hilo3d.Ray;
const Vector3 = Hilo3d.Vector3;

function expectVector(result: Hilo3d.Vector3 | null, ...values: number[]): void {
    if (!result) throw new Error('Expected the ray operation to return an intersection point');
    expect(result.elements).toEqualishValues(...values);
}

describe('Ray', () => {
    let rayA = new Ray();
    let identity = new Ray();
    beforeEach(() => {
        rayA = new Ray({
            origin: new Vector3(1, 2, 3),
            direction: new Vector3(1, 0, 0)
        });

        identity = new Ray();
    });

    it('create', () => {
        expect(rayA.isRay).toBe(true);
        expect(rayA.className).toBe('Ray');
        expect(rayA.origin.elements).toEqualishValues(1, 2, 3);
        expect(rayA.direction.elements).toEqualishValues(1, 0, 0);
    });

    it('set', () => {
        identity.set(new Vector3(1, 2, 3), new Vector3(1, 0, 0));
        expect(identity.origin.elements).toEqualishValues(1, 2, 3);
        expect(identity.direction.elements).toEqualishValues(1, 0, 0);
    });

    it('copy', () => {
        identity.copy(rayA);
        expect(identity.origin.elements).toEqualishValues(1, 2, 3);
        expect(identity.direction.elements).toEqualishValues(1, 0, 0);
    });

    it('clone', () => {
        const ray = rayA.clone();
        expect(ray.origin.elements).toEqualishValues(1, 2, 3);
        expect(ray.direction.elements).toEqualishValues(1, 0, 0);
    });

    it('fromCamera', () => {
        const perspectiveCamera = new Hilo3d.PerspectiveCamera({
            z: 10,
            rotationX: 90,
            rotationY: 30
        })
            .lookAt(new Vector3(0, 1, 2))
            .updateViewProjectionMatrix();

        identity.fromCamera(perspectiveCamera, 1, 2, 3, 4);
        expect(identity.origin.elements).toEqualishValues(0, 0, 10);
        expect(identity.direction.elements).toEqualishValues(
            -0.15359194576740265,
            0.12256336212158203,
            -0.9805037975311279
        );

        const orthographicCamera = new Hilo3d.OrthographicCamera({
            z: 10,
            rotationX: 90
        })
            .lookAt(new Vector3(0, 1, 2))
            .updateViewProjectionMatrix();

        identity.fromCamera(orthographicCamera, 1, 2, 3, 4);
        expect(identity.origin.elements).toEqualishValues(
            -0.3333333432674408,
            -3.19604644971605e-8,
            10
        );
        expect(identity.direction.elements).toEqualishValues(
            0,
            0.12403473258018494,
            -0.9922778606414795
        );
    });

    it('transformMat4', () => {
        rayA.transformMat4(
            new Hilo3d.Matrix4().translate(new Vector3(1, 2, 3)).rotateY(Math.PI / 2)
        );
        expect(rayA.origin.elements).toEqualishValues(4, 4, 2);
        expect(rayA.direction.elements).toEqualishValues(0, 0, -1);
    });

    it('sortPoints', () => {
        const points = [new Vector3(0, 0, 0), new Vector3(3, 4, 6), new Vector3(1, 2, 3)];
        rayA.sortPoints(points);
        expect(points.map(point => Array.from(point.elements))).toEqual([
            [1, 2, 3],
            [0, 0, 0],
            [3, 4, 6]
        ]);

        const wrappedPoints = [
            { point: new Vector3(0, 0, 0) },
            { point: new Vector3(3, 4, 6) },
            { point: new Vector3(1, 2, 3) }
        ];
        rayA.sortPoints(wrappedPoints, 'point');
        expect(wrappedPoints.map(({ point }) => Array.from(point.elements))).toEqual([
            [1, 2, 3],
            [0, 0, 0],
            [3, 4, 6]
        ]);
    });

    it('squaredDistance', () => {
        expect(rayA.squaredDistance(new Vector3(1, 0, 0))).toBeEqualish(13);
    });

    it('distance', () => {
        expect(rayA.distance(new Vector3(1, 0, 0))).toBeEqualish(Math.sqrt(13));
    });

    it('intersectsSphere', () => {
        expectVector(identity.intersectsSphere([0, 0, 0], 5), 0, 0, 5);
        expect(identity.intersectsSphere([0, 0, 6], 5)).toBeNull();
    });

    it('intersectsPlane', () => {
        expectVector(identity.intersectsPlane([0, 0, 1], 5), 0, 0, -5);
        expect(identity.intersectsPlane([0, 0, 1], -5)).toBeNull();
    });

    it('intersectsTriangle', () => {
        expectVector(
            identity.intersectsTriangle([
                [-0.5, -0.289, 0],
                [0.5, -0.289, 0],
                [0, 0, 0.9]
            ]),
            0,
            0,
            0.9
        );
    });

    it('intersectsBox', () => {
        expectVector(
            identity.intersectsBox([
                [-1, -1, -1],
                [1, 1, 1]
            ]),
            0,
            0,
            1
        );
    });

    it('intersectsTriangleCell', () => {
        expectVector(
            identity.intersectsTriangleCell(
                [0, 1, 2],
                [
                    [-0.5, -0.289, 0],
                    [0.5, -0.289, 0],
                    [0, 0, 0.9]
                ]
            ),
            0,
            0,
            0.9
        );
    });
});
