import { beforeEach, describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Euler = Hilo3d.Euler;

describe('Euler', () => {
    let eulerA = new Euler();
    let identity = new Euler();

    beforeEach(() => {
        eulerA = new Euler(1, 2, 3);
        eulerA.order = 'XYZ';

        identity = new Euler();
    });

    it('create', () => {
        expect(eulerA.isEuler).toBe(true);
        expect(eulerA.className).toBe('Euler');
        expect(eulerA.elements).toEqualishValues(1, 2, 3);
        expect(eulerA.x).toBe(1);
        expect(eulerA.y).toBe(2);
        expect(eulerA.z).toBe(3);
    });

    it('clone', () => {
        const euler = eulerA.clone();
        expect(euler.order).toBe(eulerA.order);
        expect(euler.x).toBe(eulerA.x);
        expect(euler.y).toBe(eulerA.y);
        expect(euler.z).toBe(eulerA.z);
    });

    it('copy', () => {
        identity.copy(eulerA);
        expect(identity.order).toBe(eulerA.order);
        expect(identity.x).toBe(eulerA.x);
        expect(identity.y).toBe(eulerA.y);
        expect(identity.z).toBe(eulerA.z);
    });

    it('set', () => {
        identity.set(1, 2, 3);
        expect(identity.elements).toEqualishValues(1, 2, 3);
    });

    it('fromArray', () => {
        identity.fromArray([0, 0, 1, 2, 3], 2);
        expect(identity.elements).toEqualishValues(1, 2, 3);
    });

    it('toArray', () => {
        const arr: number[] = [];
        eulerA.toArray(arr, 2);
        expect(arr[2]).toBe(1);
        expect(arr[3]).toBe(2);
        expect(arr[4]).toBe(3);
    });

    it('fromMat4', () => {
        identity.fromMat4(new Hilo3d.Matrix4().rotateX(Math.PI * 0.5));
        expect(identity.elements).toEqualishValues(Math.PI * 0.5, 0, 0);
    });

    it('fromQuat', () => {
        identity.fromQuat(
            new Hilo3d.Quaternion(Math.sin(Math.PI * 0.25), 0, 0, Math.cos(Math.PI * 0.25))
        );
        expect(identity.elements).toEqualishValues(Math.PI * 0.5, 0, 0);
    });
});
