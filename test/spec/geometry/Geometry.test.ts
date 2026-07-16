import { describe, expect, it } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Geometry = Hilo3d.Geometry;

describe('Geometry', () => {
    it('create', () => {
        const geometry = new Geometry();
        expect(geometry.isGeometry).toBe(true);
        expect(geometry.className).toBe('Geometry');
    });

    it('calculates normals and tangents for triangle strips', () => {
        const geometry = new Geometry({
            mode: Hilo3d.constants.TRIANGLE_STRIP,
            vertices: new Hilo3d.GeometryData(
                new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]),
                3
            ),
            uvs: new Hilo3d.GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2),
            indices: new Hilo3d.GeometryData(new Uint16Array([0, 1, 2, 3]), 1)
        });

        const normals = geometry.normals;
        const tangents = geometry.tangents;

        expect(normals?.count).toBe(4);
        expect(tangents?.count).toBe(4);
        expect(Array.from(normals?.data ?? []).every(Number.isFinite)).toBe(true);
        expect([2, 5, 8, 11].map(index => normals?.data[index])).toEqual([4, 4, 4, 4]);
        expect(Array.from(tangents?.data ?? []).every(Number.isFinite)).toBe(true);
    });
});
