import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Plane = Hilo3d.Plane;

describe('Plane', () => {
    let planeA = new Plane();
    let identity = new Plane();
    beforeEach(() => {
        planeA = new Plane(new Hilo3d.Vector3(1, 2, 3), 4);
        identity = new Plane();
    });

    it('create', () => {
        expect(planeA.isPlane).toBe(true);
        expect(planeA.className).toBe('Plane');
        expect(planeA.normal.elements).toEqualishValues(1, 2, 3);
        expect(planeA.distance).toBe(4);
    });

    it('copy', () => {
        identity.copy(planeA);
        expect(identity.normal.equals(planeA.normal)).toBe(true);
        expect(identity.distance).toBe(planeA.distance);
    });

    it('clone', () => {
        const plane = planeA.clone();
        expect(plane.normal.equals(planeA.normal)).toBe(true);
        expect(plane.distance).toBe(planeA.distance);
    });

    it('set', () => {
        const plane = new Plane();
        plane.set(1, 2, 3, 4);
        expect(plane.normal.elements).toEqualishValues(1, 2, 3);
        expect(plane.distance).toBe(4);
    });

    it('normalize', () => {
        planeA.set(3, 4, 0, 2).normalize();
        expect(planeA.distance).toBeEqualish(0.4);
        expect(planeA.normal.length()).toBeEqualish(1);
    });

    it('distanceToPoint', () => {
        expect(planeA.distanceToPoint(new Hilo3d.Vector3(0, 0, 0))).toBe(4);
    });

    it('projectPoint', () => {
        expect(planeA.projectPoint(new Hilo3d.Vector3(0, 0, 0)).elements).toEqualishValues(
            -4,
            -8,
            -12
        );
    });
});
