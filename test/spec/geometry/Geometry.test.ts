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

    it.each([
        ['Uint8Array', Uint8Array],
        ['Uint16Array', Uint16Array],
        ['Uint32Array', Uint32Array]
    ] as const)('normalizes indexed LINE_LOOP while preserving %s storage', (_name, IndexArray) => {
        const geometry = new Geometry({
            mode: Hilo3d.constants.LINE_LOOP,
            vertices: new Hilo3d.GeometryData(new Float32Array(12), 3),
            indices: new Hilo3d.GeometryData(new IndexArray([0, 2, 3]), 1)
        });

        expect(geometry.normalizePrimitiveTopology()).toBe(true);
        expect(geometry.mode).toBe(Hilo3d.constants.LINES);
        expect(geometry.indices?.data).toBeInstanceOf(IndexArray);
        expect(Array.from(geometry.indices?.data ?? [])).toEqual([0, 2, 2, 3, 3, 0]);
        expect(geometry.indices?.count).toBe(6);
        expect(geometry.currentIndicesCount).toBe(6);

        const normalizedIndices = geometry.indices;
        expect(geometry.normalizePrimitiveTopology()).toBe(false);
        expect(geometry.indices).toBe(normalizedIndices);
    });

    it.each([
        ['Uint8Array', Uint8Array],
        ['Uint16Array', Uint16Array],
        ['Uint32Array', Uint32Array]
    ] as const)(
        'normalizes indexed TRIANGLE_FAN while preserving %s storage and degenerate triangles',
        (_name, IndexArray) => {
            const geometry = new Geometry({
                mode: Hilo3d.constants.TRIANGLE_FAN,
                vertices: new Hilo3d.GeometryData(new Float32Array(15), 3),
                indices: new Hilo3d.GeometryData(new IndexArray([4, 1, 1, 3]), 1)
            });

            expect(geometry.normalizePrimitiveTopology()).toBe(true);
            expect(geometry.mode).toBe(Hilo3d.constants.TRIANGLES);
            expect(geometry.indices?.data).toBeInstanceOf(IndexArray);
            expect(Array.from(geometry.indices?.data ?? [])).toEqual([4, 1, 1, 4, 1, 3]);
            expect(geometry.vertices?.count).toBe(5);
        }
    );

    it.each([
        [4, Uint8Array],
        [257, Uint16Array],
        [65_537, Uint32Array]
    ] as const)(
        'selects a safe index width for %s non-indexed vertices',
        (vertexCount, IndexArray) => {
            const geometry = new Geometry({
                mode: Hilo3d.constants.TRIANGLE_FAN,
                vertices: new Hilo3d.GeometryData(new Float32Array(vertexCount * 3), 3)
            });

            geometry.normalizePrimitiveTopology();

            expect(geometry.indices?.data).toBeInstanceOf(IndexArray);
            expect(geometry.indices?.count).toBe(Math.max(0, vertexCount - 2) * 3);
            expect(geometry.indices?.data.at(-1)).toBe(vertexCount - 1);
            expect(geometry.vertices?.count).toBe(vertexCount);
        }
    );

    it('normalizes short primitives to empty lists without changing vertex bounds', () => {
        const loop = new Geometry({
            mode: Hilo3d.constants.LINE_LOOP,
            vertices: new Hilo3d.GeometryData(new Float32Array([-2, -3, -4]), 3)
        });
        const beforeBounds = { ...loop.getLocalBounds() };
        const fan = new Geometry({
            mode: Hilo3d.constants.TRIANGLE_FAN,
            vertices: new Hilo3d.GeometryData(new Float32Array([0, 0, 0, 1, 1, 1]), 3),
            indices: new Hilo3d.GeometryData(new Uint16Array([0, 1]), 1)
        });

        loop.normalizePrimitiveTopology();
        fan.normalizePrimitiveTopology();

        expect(loop.mode).toBe(Hilo3d.constants.LINES);
        expect(loop.indices?.count).toBe(0);
        expect(loop.vertices?.count).toBe(1);
        expect(loop.getLocalBounds()).toEqual(beforeBounds);
        expect(fan.mode).toBe(Hilo3d.constants.TRIANGLES);
        expect(fan.indices?.data).toBeInstanceOf(Uint16Array);
        expect(fan.indices?.count).toBe(0);
    });

    it('preserves Uint32 indices when converting normalized triangles to wireframe lines', () => {
        const geometry = new Geometry({
            vertices: new Hilo3d.GeometryData(new Float32Array(12), 3),
            indices: new Hilo3d.GeometryData(new Uint32Array([0, 1, 2]), 1)
        });

        geometry.convertToLinesMode();

        expect(geometry.mode).toBe(Hilo3d.constants.LINES);
        expect(geometry.indices?.data).toBeInstanceOf(Uint32Array);
        expect(Array.from(geometry.indices?.data ?? [])).toEqual([0, 1, 1, 2, 2, 0]);
    });
});
