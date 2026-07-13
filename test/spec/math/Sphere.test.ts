import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Sphere = Hilo3d.Sphere;

describe('Sphere', () => {
    let sphereA = new Sphere();
    let identity = new Sphere();
    beforeEach(() => {
        sphereA = new Sphere({
            center: new Hilo3d.Vector3(1, 2, 3),
            radius: 1
        });

        identity = new Sphere();
    });

    it('create', () => {
        expect(sphereA.isSphere).toBe(true);
        expect(sphereA.className).toBe('Sphere');
        expect(sphereA.center.elements).toEqualishValues(1, 2, 3);
        expect(sphereA.radius).toBe(1);
    });

    it('clone', () => {
        const sphere = sphereA.clone();
        expect(sphere.center.equals(sphereA.center)).toBe(true);
        expect(sphere.radius).toBe(sphereA.radius);
    });

    it('copy', () => {
        identity.copy(sphereA);
        expect(identity.center.equals(sphereA.center)).toBe(true);
        expect(identity.radius).toBe(sphereA.radius);
    });

    it('fromPoints', () => {
        sphereA.fromPoints([1, 2, 3, 1, 2, 6]);
        expect(sphereA.radius).toBe(3);

        sphereA.fromPoints([1, 5, -1, 1, 2, 6]);
        expect(sphereA.radius).toBe(5);
    });

    it('transformMat4', () => {
        sphereA.transformMat4(
            new Hilo3d.Matrix4()
                .scale(new Hilo3d.Vector3(2, 1, 1))
                .translate(new Hilo3d.Vector3(1, 2, 3))
        );
        expect(sphereA.radius).toBe(2);
        expect(sphereA.center.elements).toEqualishValues(4, 4, 6);
    });
});
