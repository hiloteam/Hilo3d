import { beforeAll, describe, expect, it } from 'vitest';
import {
    cookMeshletAsset,
    type CookedMeshletAsset
} from '../../../scripts/geometry/meshlet-cooker';
import { createMeshletFixtureSource } from '../../fixtures/meshlets/source';
import {
    decodeMeshletGeometryPage,
    type MeshletGeometryPage
} from '../../../src/geometry/meshlet/MeshletAsset';
import MeshletGeometry from '../../../src/geometry/meshlet/MeshletGeometry';
import { createMeshletFallbackGeometry } from '../../../src/geometry/meshlet/MeshletFallbackGeometry';

describe('Meshlet coarse fallback geometry', () => {
    let asset: CookedMeshletAsset;
    beforeAll(async () => {
        asset = await cookMeshletAsset(createMeshletFixtureSource(), { maxError: 0.15 });
    });

    function loadCoarse(meshlets: MeshletGeometry): readonly MeshletGeometryPage[] {
        return asset.manifest.groups.map(group => {
            const coarse = group.lods.at(-1);
            if (!coarse) throw new Error('missing coarse descriptor');
            const descriptor = asset.manifest.pages.find(entry => entry.id === coarse.pageId);
            const bytes = asset.pages.get(coarse.pageId);
            if (!descriptor || !bytes) throw new Error('missing coarse page');
            const page = decodeMeshletGeometryPage(bytes, descriptor);
            meshlets.setPageData(coarse.pageId, page);
            return page;
        });
    }

    it('builds only the coarse pages without loading any full-resolution geometry', () => {
        const meshlets = new MeshletGeometry(asset.manifest);
        const pages = loadCoarse(meshlets);
        const result = createMeshletFallbackGeometry(meshlets);
        const vertexCount = pages.reduce((sum, page) => sum + page.vertices.length / 8, 0);
        const indexCount = pages.reduce((sum, page) => sum + page.indices.length, 0);
        expect(result.vertices?.count).toBe(vertexCount);
        expect(result.normals?.count).toBe(vertexCount);
        expect(result.uvs?.count).toBe(vertexCount);
        expect(result.indices?.count).toBe(indexCount);
        expect(result.vertices?.data).toBeInstanceOf(Float32Array);
        expect(result.normals?.data).toBeInstanceOf(Float32Array);
        expect(result.uvs?.data).toBeInstanceOf(Float32Array);
        expect(result.indices?.data).toBeInstanceOf(Uint32Array);
        expect(indexCount).toBeLessThan(createMeshletFixtureSource().indices.length / 2);
        for (const group of asset.manifest.groups) {
            const fine = group.lods[0];
            if (!fine) throw new Error('missing fine LOD');
            expect(meshlets.hasPage(fine.pageId)).toBe(false);
        }
    });

    it('preserves each attribute and rebases indices without aliasing retained or caller data', () => {
        const meshlets = new MeshletGeometry(asset.manifest);
        const pages = loadCoarse(meshlets);
        const result = createMeshletFallbackGeometry(meshlets);
        let vertexOffset = 0;
        let indexOffset = 0;
        for (const page of pages) {
            for (let vertex = 0; vertex < page.vertices.length / 8; vertex++) {
                expect(
                    Array.from(
                        result.vertices?.data.subarray(
                            (vertexOffset + vertex) * 3,
                            (vertexOffset + vertex + 1) * 3
                        ) ?? []
                    )
                ).toEqual(Array.from(page.vertices.subarray(vertex * 8, vertex * 8 + 3)));
                expect(
                    Array.from(
                        result.normals?.data.subarray(
                            (vertexOffset + vertex) * 3,
                            (vertexOffset + vertex + 1) * 3
                        ) ?? []
                    )
                ).toEqual(Array.from(page.vertices.subarray(vertex * 8 + 3, vertex * 8 + 6)));
                expect(
                    Array.from(
                        result.uvs?.data.subarray(
                            (vertexOffset + vertex) * 2,
                            (vertexOffset + vertex + 1) * 2
                        ) ?? []
                    )
                ).toEqual(Array.from(page.vertices.subarray(vertex * 8 + 6, vertex * 8 + 8)));
            }
            expect(
                Array.from(
                    result.indices?.data.subarray(indexOffset, indexOffset + page.indices.length) ??
                        []
                )
            ).toEqual(Array.from(page.indices, index => index + vertexOffset));
            vertexOffset += page.vertices.length / 8;
            indexOffset += page.indices.length;
        }
        const first = pages[0];
        const sourceFirstPosition = result.vertices?.data[0];
        first?.vertices.fill(99);
        expect(result.vertices?.data[0]).toBe(sourceFirstPosition);
        result.vertices?.data.fill(77);
        const coarse = asset.manifest.groups[0]?.lods.at(-1);
        if (!coarse) throw new Error('missing coarse LOD');
        expect(meshlets.getPageData(coarse.pageId)?.vertices[0]).toBe(sourceFirstPosition);
    });

    it('requires every coarsest page even when other levels are available', () => {
        const meshlets = new MeshletGeometry(asset.manifest);
        expect(() => createMeshletFallbackGeometry(meshlets)).toThrow('Coarsest meshlet page');
        loadCoarse(meshlets);
        const group = asset.manifest.groups[1];
        const coarse = group?.lods.at(-1);
        if (!group || !coarse) throw new Error('missing coarse LOD');
        meshlets.evictPage(coarse.pageId);
        expect(() => createMeshletFallbackGeometry(meshlets)).toThrow(`group ${String(group.id)}`);
    });
});
