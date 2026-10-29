import Geometry from '../Geometry';
import GeometryData from '../GeometryData';
import type MeshletGeometry from './MeshletGeometry';
import type { MeshletGeometryPage } from './MeshletAsset';

/**
 * Build an independent ordinary Geometry from the available coarsest page of every group.
 *
 * Acquire those pages through the geometry page manager before creating the GPU Scene bucket.
 * This avoids loading full-resolution source geometry for the bucket's initial or missing-page
 * fallback. The returned geometry uses the same local coordinates and single-material UV0 layout.
 * Missing coarse pages reject before output buffers are allocated.
 */
export function createMeshletFallbackGeometry(meshlets: MeshletGeometry): Geometry {
    const pages: Readonly<MeshletGeometryPage>[] = [];
    let vertexCount = 0;
    let indexCount = 0;
    for (const group of meshlets.manifest.groups) {
        const coarse = group.lods.at(-1);
        const page = coarse ? meshlets.getPageData(coarse.pageId) : null;
        if (!page || !coarse) {
            throw new Error(
                `Coarsest meshlet page for group ${String(group.id)} must be loaded before creating fallback geometry`
            );
        }
        pages.push(page);
        vertexCount += page.vertices.length / 8;
        indexCount += page.indices.length;
    }
    if (
        !Number.isSafeInteger(vertexCount) ||
        !Number.isSafeInteger(indexCount) ||
        vertexCount > 0xffffffff ||
        indexCount > 0xffffffff
    ) {
        throw new RangeError(
            'Meshlet fallback geometry exceeds unsigned 32-bit vertex/index limits'
        );
    }
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(indexCount);
    let vertexOffset = 0;
    let indexOffset = 0;
    for (const page of pages) {
        for (let vertex = 0; vertex < page.vertices.length / 8; vertex++) {
            positions.set(
                page.vertices.subarray(vertex * 8, vertex * 8 + 3),
                (vertexOffset + vertex) * 3
            );
            normals.set(
                page.vertices.subarray(vertex * 8 + 3, vertex * 8 + 6),
                (vertexOffset + vertex) * 3
            );
            uvs.set(
                page.vertices.subarray(vertex * 8 + 6, vertex * 8 + 8),
                (vertexOffset + vertex) * 2
            );
        }
        for (const index of page.indices) indices[indexOffset++] = vertexOffset + index;
        vertexOffset += page.vertices.length / 8;
    }
    return new Geometry({
        vertices: new GeometryData(positions, 3),
        normals: new GeometryData(normals, 3),
        uvs: new GeometryData(uvs, 2),
        indices: new GeometryData(indices, 1)
    });
}
