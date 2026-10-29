import { describe, expect, it } from 'vitest';
import MeshletGeometry from '../../../src/geometry/meshlet/MeshletGeometry';
import {
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    type MeshletAssetManifest,
    type MeshletGeometryPage
} from '../../../src/geometry/meshlet/MeshletAsset';

function fixture(): { manifest: MeshletAssetManifest; page: MeshletGeometryPage } {
    const page: MeshletGeometryPage = {
        vertices: new Float32Array([
            0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1
        ]),
        indices: new Uint32Array([0, 1, 2]),
        meshlets: [
            {
                firstIndex: 0,
                indexCount: 3,
                bounds: [0, 0, 0, 2],
                coneApex: [0, 0, 0],
                coneAxis: [0, 0, 1],
                coneCutoff: 0
            }
        ]
    };
    const bytes = encodeMeshletGeometryPage(page);
    return {
        page,
        manifest: {
            version: 1,
            vertexStride: 8,
            groups: [{ id: 5, bounds: [0, 0, 0, 2], lods: [{ pageId: 17, error: 0 }] }],
            pages: [
                {
                    id: 17,
                    byteLength: bytes.byteLength,
                    vertexCount: 3,
                    indexCount: 3,
                    meshletCount: 1,
                    checksum: meshletPageChecksum(bytes)
                }
            ]
        }
    };
}

describe('MeshletGeometry CPU page ownership', () => {
    it('snapshots manifest/options and privately copies all retained data', () => {
        const { manifest, page } = fixture();
        const geometry = new MeshletGeometry(manifest);
        expect(geometry.manifest).not.toBe(manifest);
        expect(Object.isFrozen(geometry.manifest.groups[0]?.bounds)).toBe(true);
        expect(Object.isFrozen(geometry.options)).toBe(true);
        expect(geometry.hasPage(17)).toBe(false);
        geometry.setPageData(17, page);
        const retained = geometry.getPageData(17);
        expect(retained).toEqual(page);
        expect(retained?.vertices).not.toBe(page.vertices);
        expect(retained?.indices).not.toBe(page.indices);
        expect(retained?.meshlets[0]?.bounds).not.toBe(page.meshlets[0]?.bounds);
        page.vertices.fill(99);
        page.indices.fill(99);
        expect(retained?.vertices[0]).toBe(0);
        expect(retained?.indices[0]).toBe(0);
        expect(geometry.revision).toBe(1);
    });

    it('evicts by stable page identity and only changes revision for effective eviction', () => {
        const { manifest, page } = fixture();
        const geometry = new MeshletGeometry(manifest);
        geometry.evictPage(17);
        expect(geometry.revision).toBe(0);
        geometry.setPageData(17, page);
        geometry.evictPage(17);
        expect(geometry.hasPage(17)).toBe(false);
        expect(geometry.getPageData(17)).toBeNull();
        expect(geometry.revision).toBe(2);
        geometry.evictPage(17);
        expect(geometry.revision).toBe(2);
        expect(() => {
            geometry.evictPage(0);
        }).toThrow('Unknown');
        expect(() => {
            geometry.setPageData(0, page);
        }).toThrow('Unknown');
    });

    it('rejects checksum mismatch without changing an already retained page', () => {
        const { manifest, page } = fixture();
        const geometry = new MeshletGeometry(manifest);
        geometry.setPageData(17, page);
        const retained = geometry.getPageData(17);
        page.vertices[6] = 0.5;
        expect(() => {
            geometry.setPageData(17, page);
        }).toThrow('checksum');
        expect(geometry.getPageData(17)).toBe(retained);
        expect(geometry.revision).toBe(1);
    });

    it('rejects pages outside their owning group even when page checksum and meshlet bounds are valid', () => {
        const { manifest, page } = fixture();
        const geometry = new MeshletGeometry({
            ...manifest,
            groups: [{ id: 5, bounds: [0, 0, 0, 0.5], lods: [{ pageId: 17, error: 0 }] }]
        });
        expect(() => {
            geometry.setPageData(17, page);
        }).toThrow('group bounds');
        expect(geometry.revision).toBe(0);
        expect(geometry.hasPage(17)).toBe(false);
    });

    it.each([
        { maxResidentBytes: 0 },
        { maxResidentBytes: 15 },
        { maxUploadBytesPerFrame: -4 },
        { maxUploadBytesPerFrame: 2 },
        { maxVisibleMeshlets: 0x80000000 },
        { maxVisibleMeshlets: 1.5 },
        { maximumProjectedError: -1 },
        { maximumProjectedError: NaN }
    ])('rejects invalid residency or LOD options %o', options => {
        expect(() => new MeshletGeometry(fixture().manifest, options)).toThrow();
    });
});
