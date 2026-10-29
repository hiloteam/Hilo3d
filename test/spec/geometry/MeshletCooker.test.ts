import { beforeAll, describe, expect, it } from 'vitest';
import nearFlatCone from '../../fixtures/meshlets/near-flat-cone.json';
import {
    cookMeshletAsset,
    type CookedMeshletAsset
} from '../../../scripts/geometry/meshlet-cooker';
import { createMeshletFixtureSource } from '../../fixtures/meshlets/source';
import {
    decodeMeshletGeometryPage,
    type MeshletGeometryPage
} from '../../../src/geometry/meshlet/MeshletAsset';

function coordinate(vertices: Float32Array, stride: number, index: number): string {
    return Array.from(vertices.subarray(index * stride, index * stride + 3)).join(',');
}

function triangles(vertices: Float32Array, stride: number, indices: Uint32Array): string[] {
    const result: string[] = [];
    for (let index = 0; index < indices.length; index += 3) {
        const points = Array.from(indices.subarray(index, index + 3), vertex =>
            coordinate(vertices, stride, vertex)
        );
        const rotations = points.map((_, rotation) =>
            [...points.slice(rotation), ...points.slice(0, rotation)].join(';')
        );
        result.push(rotations.sort()[0] ?? '');
    }
    return result;
}

function boundary(decoded: MeshletGeometryPage): string[] {
    const edges = new Map<string, number>();
    for (let triangle = 0; triangle < decoded.indices.length; triangle += 3) {
        for (let corner = 0; corner < 3; corner++) {
            const a = decoded.indices[triangle + corner],
                b = decoded.indices[triangle + ((corner + 1) % 3)];
            if (a === undefined || b === undefined) throw new Error('missing triangle corner');
            const key = [coordinate(decoded.vertices, 8, a), coordinate(decoded.vertices, 8, b)]
                .sort()
                .join(';');
            edges.set(key, (edges.get(key) ?? 0) + 1);
        }
    }
    return Array.from(edges)
        .filter(([, count]) => count === 1)
        .map(([edge]) => edge)
        .sort();
}

function page(asset: CookedMeshletAsset, id: number): MeshletGeometryPage {
    const descriptor = asset.manifest.pages.find(entry => entry.id === id);
    const bytes = asset.pages.get(id);
    if (!descriptor || !bytes) throw new Error('missing cooked page');
    return decodeMeshletGeometryPage(bytes, descriptor);
}

describe('Meshlet offline cooking', () => {
    const source = createMeshletFixtureSource();
    let cooked: CookedMeshletAsset;
    beforeAll(async () => {
        cooked = await cookMeshletAsset(source, { maxError: 0.15 });
    });

    it('preserves every fine triangle and its winding exactly across independent groups', () => {
        const fineTriangles: string[] = [];
        for (const group of cooked.manifest.groups) {
            const fine = group.lods[0];
            if (!fine) throw new Error('missing fine LOD');
            const decoded = page(cooked, fine.pageId);
            fineTriangles.push(...triangles(decoded.vertices, 8, decoded.indices));
        }
        expect(cooked.manifest.groups.length).toBeGreaterThan(1);
        expect(fineTriangles.sort()).toEqual(triangles(source.positions, 3, source.indices).sort());
    });

    it('creates real simplified replacement surfaces with unchanged shared boundaries', () => {
        let coarseCount = 0;
        for (const group of cooked.manifest.groups) {
            const fineLOD = group.lods[0];
            if (!fineLOD) throw new Error('missing fine LOD');
            const fineBoundary = boundary(page(cooked, fineLOD.pageId));
            let previousCount = Infinity;
            let previousError = -1;
            expect(group.lods.length).toBeGreaterThan(1);
            for (const lod of group.lods) {
                const decoded = page(cooked, lod.pageId);
                expect(decoded.indices.length).toBeLessThan(previousCount);
                expect(lod.error).toBeGreaterThanOrEqual(previousError);
                expect(lod.error).toBeLessThanOrEqual(0.150001);
                expect(boundary(decoded)).toEqual(fineBoundary);
                previousCount = decoded.indices.length;
                previousError = lod.error;
            }
            expect(previousError).toBeGreaterThan(0);
            coarseCount += previousCount;
        }
        expect(coarseCount).toBeLessThan(source.indices.length * 0.5);
    });

    it('retains original positions, shading attributes and conservative group bounds at every LOD', () => {
        const original = new Map<string, number[]>();
        for (let index = 0; index < source.positions.length / 3; index++) {
            original.set(coordinate(source.positions, 3, index), [
                ...source.normals.subarray(index * 3, index * 3 + 3),
                ...source.uv0.subarray(index * 2, index * 2 + 2)
            ]);
        }
        for (const group of cooked.manifest.groups) {
            for (const lod of group.lods) {
                const decoded = page(cooked, lod.pageId);
                for (let vertex = 0; vertex < decoded.vertices.length / 8; vertex++) {
                    expect(
                        Array.from(decoded.vertices.subarray(vertex * 8 + 3, vertex * 8 + 8))
                    ).toEqual(original.get(coordinate(decoded.vertices, 8, vertex)));
                    const x = decoded.vertices[vertex * 8] ?? Infinity;
                    const y = decoded.vertices[vertex * 8 + 1] ?? Infinity;
                    const z = decoded.vertices[vertex * 8 + 2] ?? Infinity;
                    expect(
                        Math.hypot(x - group.bounds[0], y - group.bounds[1], z - group.bounds[2])
                    ).toBeLessThanOrEqual(group.bounds[3]);
                }
                expect(decoded.meshlets.every(cluster => cluster.indexCount <= 64 * 3)).toBe(true);
            }
        }
    });

    it('produces byte-identical results without modifying input arrays', async () => {
        const before = source.positions.slice();
        const repeated = await cookMeshletAsset(source, { maxError: 0.15 });
        expect(repeated.manifest).toEqual(cooked.manifest);
        for (const [id, bytes] of cooked.pages) expect(repeated.pages.get(id)).toEqual(bytes);
        expect(source.positions).toEqual(before);
    });

    it('stops when boundary locks prevent reduction rather than dropping triangles', async () => {
        const input = {
            positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
            uv0: new Float32Array([0, 0, 1, 0, 0, 1]),
            indices: new Uint32Array([0, 1, 2])
        };
        const result = await cookMeshletAsset(input);
        expect(result.manifest.groups[0]?.lods.length).toBe(1);
        expect(result.manifest.pages[0]?.indexCount).toBe(3);
    });

    it('retains a valid cone for the near-flat Float32 STRATA boulder regression', async () => {
        // Four exact vertices/two triangles from the authored boulder. meshoptimizer 1.3.0
        // returns an axis of length 1.0000001233 here; its cutoff plus 1e-6 is still unsafe.
        const input = {
            positions: new Float32Array(nearFlatCone.positions),
            normals: new Float32Array(nearFlatCone.normals),
            uv0: new Float32Array(nearFlatCone.uv0),
            indices: new Uint32Array(nearFlatCone.indices)
        };
        const result = await cookMeshletAsset(input, { lodRatios: [] });
        const decoded = page(result, 0);
        expect(decoded.meshlets).toHaveLength(1);
        expect(decoded.meshlets[0]?.coneCutoff).toBeGreaterThan(0);
        expect(decoded.meshlets[0]?.coneCutoff).toBeLessThan(1);
        expect(triangles(decoded.vertices, 8, decoded.indices).sort()).toEqual(
            triangles(input.positions, 3, input.indices).sort()
        );
        // Decoding above runs the unmodified strict sphere/cone validator on serialized bytes.
        expect(decoded.indices.length).toBe(6);
        expect(decoded.vertices.length / 8).toBe(4);
    });

    it('rejects invalid topology, incomplete attributes and unordered LOD targets', async () => {
        await expect(
            cookMeshletAsset({ ...source, indices: new Uint32Array([0, 0, 1]) })
        ).rejects.toThrow('degenerate');
        await expect(
            cookMeshletAsset({ ...source, indices: new Uint32Array([0, 1, 999999]) })
        ).rejects.toThrow('out of range');
        await expect(cookMeshletAsset({ ...source, normals: new Float32Array(0) })).rejects.toThrow(
            'matching'
        );
        await expect(cookMeshletAsset(source, { lodRatios: [0.25, 0.5] })).rejects.toThrow(
            'decrease'
        );
        await expect(cookMeshletAsset(source, { maxError: -1 })).rejects.toThrow('maxError');
    });
});
