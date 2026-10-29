import { describe, expect, it } from 'vitest';
import {
    decodeMeshletGeometryPage,
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    snapshotMeshletAssetManifest,
    validateMeshletGeometryPage,
    type MeshletGeometryPage,
    type MeshletPageDescriptor
} from '../../../src/geometry/meshlet/MeshletAsset';

function fixture(): MeshletGeometryPage {
    return {
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
}

function descriptor(bytes: Uint8Array): MeshletPageDescriptor {
    return {
        id: 7,
        byteLength: bytes.byteLength,
        vertexCount: 3,
        indexCount: 3,
        meshletCount: 1,
        checksum: meshletPageChecksum(bytes)
    };
}

function manifest(): {
    version: number;
    vertexStride: number;
    groups: { id: number; bounds: number[]; lods: { pageId: number; error: number }[] }[];
    pages: MeshletPageDescriptor[];
} {
    return {
        version: 1,
        vertexStride: 8,
        groups: [{ id: 9, bounds: [0, 0, 0, 2], lods: [{ pageId: 7, error: 0 }] }],
        pages: [descriptor(encodeMeshletGeometryPage(fixture()))]
    };
}

describe('Meshlet asset format', () => {
    it('uses the standard CRC-32 vector and exact little-endian header', () => {
        expect(meshletPageChecksum(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
        const bytes = encodeMeshletGeometryPage(fixture());
        expect(Array.from(bytes.slice(0, 12))).toEqual([72, 51, 77, 80, 1, 0, 0, 0, 8, 0, 0, 0]);
        expect(bytes.byteLength).toBe(32 + 64 + 3 * 32 + 3 * 4);
    });

    it('round-trips independent typed arrays and frozen culling metadata', () => {
        const source = fixture();
        const bytes = encodeMeshletGeometryPage(source);
        const decoded = decodeMeshletGeometryPage(bytes, descriptor(bytes));
        expect(decoded).toEqual(source);
        bytes.fill(0);
        source.vertices.fill(99);
        expect(decoded.vertices[0]).toBe(0);
        expect(Object.isFrozen(decoded.meshlets)).toBe(true);
        expect(Object.isFrozen(decoded.meshlets[0]?.bounds)).toBe(true);
    });

    it('supports unaligned transport byte views', () => {
        const bytes = encodeMeshletGeometryPage(fixture());
        const transport = new Uint8Array(bytes.length + 3);
        transport.set(bytes, 1);
        expect(
            decodeMeshletGeometryPage(transport.subarray(1, bytes.length + 1), descriptor(bytes))
        ).toEqual(fixture());
    });

    it('rejects truncation, trailing bytes and payload corruption before decoding', () => {
        const bytes = encodeMeshletGeometryPage(fixture());
        const expected = descriptor(bytes);
        expect(() => decodeMeshletGeometryPage(bytes.slice(0, -1), expected)).toThrow('byteLength');
        expect(() => decodeMeshletGeometryPage(new Uint8Array(bytes.length + 1), expected)).toThrow(
            'byteLength'
        );
        bytes[100] = 0xff;
        expect(() => decodeMeshletGeometryPage(bytes, expected)).toThrow('checksum');
    });

    it.each([
        [4, 2, 'header'],
        [24, 1, 'header'],
        [40, 1, 'reserved'],
        [32, 3, 'partition'],
        [192, 99, 'index is out of range']
    ] as const)(
        'rejects semantically invalid checksummed bytes at %s',
        (offset, value, message) => {
            const bytes = encodeMeshletGeometryPage(fixture());
            new DataView(bytes.buffer).setUint32(offset, value, true);
            expect(() => decodeMeshletGeometryPage(bytes, descriptor(bytes))).toThrow(message);
        }
    );

    it('rejects nonfinite attributes, undersized bounds and misleading culling cones', () => {
        const page = fixture();
        const meshlet = page.meshlets[0];
        if (!meshlet) throw new Error('missing fixture meshlet');
        expect(() =>
            encodeMeshletGeometryPage({
                ...page,
                meshlets: [{ ...meshlet, bounds: [0, 0, 0, 0.1] }]
            })
        ).toThrow('bounds');
        expect(() =>
            encodeMeshletGeometryPage({ ...page, meshlets: [{ ...meshlet, coneAxis: [0, 0, -1] }] })
        ).toThrow('conservative');
        expect(() =>
            encodeMeshletGeometryPage({ ...page, meshlets: [{ ...meshlet, coneApex: [0, 0, 1] }] })
        ).toThrow('conservative');
        page.vertices[0] = NaN;
        expect(() => encodeMeshletGeometryPage(page)).toThrow('finite');
    });

    it('rejects zero normals and sub-epsilon culling data that could hide real triangles', () => {
        const page = fixture();
        const meshlet = page.meshlets[0];
        if (!meshlet) throw new Error('missing meshlet');
        expect(() =>
            encodeMeshletGeometryPage({
                ...page,
                meshlets: [{ ...meshlet, bounds: [0, 0, 0, 0.999999] }]
            })
        ).toThrow('bounds');
        expect(() =>
            encodeMeshletGeometryPage({
                ...page,
                meshlets: [{ ...meshlet, coneApex: [0, 0, 0.0000001] }]
            })
        ).toThrow('conservative');
        page.vertices[5] = 0;
        expect(() => encodeMeshletGeometryPage(page)).toThrow('unit length');
    });

    it('checks content integrity on direct decoded-page submission as well as transport decode', () => {
        const page = fixture();
        const expected = descriptor(encodeMeshletGeometryPage(page));
        page.vertices[6] = 0.5;
        expect(() => {
            validateMeshletGeometryPage(page, expected);
        }).toThrow('checksum');
    });

    it('checks descriptor counts independently of the wire checksum', () => {
        const bytes = encodeMeshletGeometryPage(fixture());
        expect(() => {
            validateMeshletGeometryPage(fixture(), { ...descriptor(bytes), vertexCount: 4 });
        }).toThrow('byteLength');
    });

    it('snapshots metadata without retaining mutable input aliases', () => {
        const input = manifest();
        const snapshot = snapshotMeshletAssetManifest(input);
        input.groups[0]?.bounds.fill(99);
        input.pages.length = 0;
        expect(snapshot.groups[0]?.bounds).toEqual([0, 0, 0, 2]);
        expect(snapshot.pages.length).toBe(1);
        expect(Object.isFrozen(snapshot.groups[0]?.lods)).toBe(true);
    });

    it('rejects version drift, duplicate identities, missing references and unused pages', () => {
        const input = manifest();
        expect(() => snapshotMeshletAssetManifest({ ...input, version: 2 })).toThrow('version');
        expect(() =>
            snapshotMeshletAssetManifest({ ...input, pages: [...input.pages, ...input.pages] })
        ).toThrow('duplicate page');
        expect(() =>
            snapshotMeshletAssetManifest({ ...input, groups: [...input.groups, ...input.groups] })
        ).toThrow('duplicate group');
        expect(() =>
            snapshotMeshletAssetManifest({
                ...input,
                groups: [{ id: 0, bounds: [0, 0, 0, 2], lods: [{ pageId: 99, error: 0 }] }]
            })
        ).toThrow('missing page');
        const page = input.pages[0];
        if (!page) throw new Error('missing fixture page');
        expect(() =>
            snapshotMeshletAssetManifest({ ...input, pages: [page, { ...page, id: 8 }] })
        ).toThrow('unowned');
        expect(() =>
            snapshotMeshletAssetManifest({
                ...input,
                groups: [
                    {
                        id: 0,
                        bounds: [0, 0, 0, 2],
                        lods: [
                            { pageId: 7, error: 0 },
                            { pageId: 7, error: 1 }
                        ]
                    }
                ]
            })
        ).toThrow('exactly one');
    });

    it('rejects unrepresentable allocation sizes and nonmonotonic LOD error', () => {
        const input = manifest();
        const entry = input.pages[0];
        if (!entry) throw new Error('missing descriptor');
        expect(() =>
            snapshotMeshletAssetManifest({
                ...input,
                pages: [{ ...entry, vertexCount: 0xffffffff }]
            })
        ).toThrow('unsigned 32-bit');
        expect(() =>
            snapshotMeshletAssetManifest({
                ...input,
                pages: [{ ...entry, byteLength: Number.MAX_SAFE_INTEGER }]
            })
        ).toThrow('unsigned 32-bit');
        const pages = [9, 6, 3].map((indexCount, id) => ({
            ...entry,
            id,
            indexCount,
            byteLength: 32 + 64 + 3 * 32 + indexCount * 4
        }));
        expect(() =>
            snapshotMeshletAssetManifest({
                version: 1,
                vertexStride: 8,
                pages,
                groups: [
                    {
                        id: 0,
                        bounds: [0, 0, 0, 2],
                        lods: [
                            { pageId: 0, error: 0 },
                            { pageId: 1, error: 0.2 },
                            { pageId: 2, error: 0.1 }
                        ]
                    }
                ]
            })
        ).toThrow('monotonically');
    });
});
