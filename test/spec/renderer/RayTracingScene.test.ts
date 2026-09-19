import { describe, expect, it } from 'vitest';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import { requireNumber } from '../../../src/math/numberArray';
import Texture from '../../../src/texture/Texture';
import {
    RAY_BVH_LEAF_FLAG,
    RAY_BVH_NODE_FLOATS,
    RAY_TRIANGLE_FLOATS,
    RayTracingScene,
    traceRayTracingScene,
    type RayTracingSceneDirtyRange
} from '../../../src/render/gi/RayTracingScene';

function triangle(): Mesh {
    return new Mesh({
        geometry: new Geometry({
            vertices: new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3),
            normals: new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3)
        }),
        material: new PBRMaterial({
            baseColor: new Color(0.8, 0.4, 0.2),
            metallic: 0.25,
            emissionFactor: new Color(2, 1, 0.5)
        })
    });
}

function applyDelta(
    previous: Float32Array,
    current: Float32Array,
    ranges: readonly RayTracingSceneDirtyRange[]
): Uint8Array {
    const bytes = new Uint8Array(previous.buffer, previous.byteOffset, previous.byteLength).slice();
    let previousEnd = 0;
    for (const range of ranges) {
        expect(range.byteOffset % 4).toBe(0);
        expect(range.byteLength % 4).toBe(0);
        expect(range.byteOffset).toBeGreaterThanOrEqual(previousEnd);
        expect(range.byteLength).toBeGreaterThan(0);
        expect(range.byteOffset + range.byteLength).toBeLessThanOrEqual(current.byteLength);
        bytes.set(
            new Uint8Array(current.buffer, current.byteOffset + range.byteOffset, range.byteLength),
            range.byteOffset
        );
        previousEnd = range.byteOffset + range.byteLength;
    }
    return bytes;
}

describe('RayTracingScene', () => {
    it('packs aligned linear factors and smooth normals with an exact closest-hit oracle', () => {
        const mesh = triangle();
        mesh.updateMatrixWorld();
        const snapshot = new RayTracingScene().update(mesh);
        expect(snapshot.triangles.byteLength).toBe(128);
        expect(snapshot.nodes.byteLength).toBe(32);
        expect(snapshot.diagnostics).toMatchObject({
            meshCount: 1,
            triangleCount: 1,
            nodeCount: 1,
            bvhDepth: 1,
            update: 'rebuild'
        });
        expect(snapshot.triangles[24]).toBeCloseTo(0.6);
        expect(snapshot.triangles[25]).toBeCloseTo(0.3);
        expect(snapshot.triangles[26]).toBeCloseTo(0.15);
        expect(Array.from(snapshot.triangles.subarray(28, 31))).toEqual([2, 1, 0.5]);
        const metadata = new Uint32Array(snapshot.nodes.buffer);
        expect(metadata[3]).toBe(0);
        expect(metadata[7]).toBe((RAY_BVH_LEAF_FLAG | 1) >>> 0);
        const hit = traceRayTracingScene(snapshot, { origin: [0, 0, 2], direction: [0, 0, -1] });
        expect(hit).toEqual({
            distance: 2,
            triangleIndex: 0,
            meshIndex: 0,
            barycentric: [0.25, 0.25, 0.5],
            normal: [0, 0, 1],
            backface: false
        });
        expect(
            traceRayTracingScene(snapshot, { origin: [0, 0, -2], direction: [0, 0, 1] })?.backface
        ).toBe(true);
        expect(
            traceRayTracingScene(snapshot, { origin: [2, 0, 2], direction: [0, 0, -1] })
        ).toBeNull();
        expect(
            traceRayTracingScene(snapshot, {
                origin: [0, 0, 2],
                direction: [0, 0, -1],
                maxDistance: 1
            })
        ).toBeNull();
        expect(
            traceRayTracingScene(snapshot, { origin: [0, 0, 2], direction: [1, 0, 0] })
        ).toBeNull();
    });

    it('reuses an unchanged snapshot even when the frontend advances matrix versions', () => {
        const mesh = triangle();
        const scene = new RayTracingScene();
        mesh.updateMatrixWorld();
        const first = scene.update(mesh);
        mesh.updateMatrixWorld();
        expect(mesh.worldMatrixVersion).toBe(2);
        expect(scene.update(mesh)).toBe(first);
    });

    it('retains all 32 layer bits for offscreen per-light filtering and updates layer-only edits', () => {
        const mesh = triangle();
        mesh.layer = 0x80000001;
        mesh.updateMatrixWorld();
        const scene = new RayTracingScene();
        const first = scene.update(mesh);
        expect(new Uint32Array(first.triangles.buffer)[3]).toBe(0x80000001);
        mesh.layer = 0xffffffff;
        const edited = scene.update(mesh);
        expect(new Uint32Array(edited.triangles.buffer)[3]).toBe(0xffffffff);
        expect(new Uint32Array(first.triangles.buffer)[3]).toBe(0x80000001);
        expect(edited.nodes).toBe(first.nodes);
        expect(edited.diagnostics).toMatchObject({ update: 'material', changedMeshCount: 1 });
        expect(scene.update(mesh)).toBe(edited);
    });

    it('normalizes authored clockwise winding for mirrored meshes consistently with raster state', () => {
        const mesh = triangle();
        mesh.scaleX = -1;
        mesh.material = new PBRMaterial({ metallic: 0, state: { frontFace: 'cw' } });
        mesh.updateMatrixWorld();
        const snapshot = new RayTracingScene().update(mesh);
        const hit = traceRayTracingScene(snapshot, { origin: [0, 0, 2], direction: [0, 0, -1] });
        expect(hit?.backface).toBe(false);
        expect(hit?.normal[0]).toBeCloseTo(0);
        expect(hit?.normal[1]).toBeCloseTo(0);
        expect(hit?.normal[2]).toBeCloseTo(1);
        expect(
            traceRayTracingScene(snapshot, { origin: [0, 0, -2], direction: [0, 0, 1] })?.backface
        ).toBe(true);
    });

    it('refits moving objects without corrupting earlier snapshots or BVH leaf identities', () => {
        const root = new Node();
        const box = new Mesh({
            geometry: new BoxGeometry(),
            material: new PBRMaterial({ metallic: 0 })
        });
        root.addChild(box);
        root.updateMatrixWorld();
        const scene = new RayTracingScene();
        const first = scene.update(root);
        box.x = 4;
        root.updateMatrixWorld();
        const moved = scene.update(root);
        expect(moved.revision).toBe(first.revision + 1);
        expect(moved.diagnostics).toMatchObject({ update: 'refit', changedMeshCount: 1 });
        expect(moved.triangles).not.toBe(first.triangles);
        expect(moved.nodes).not.toBe(first.nodes);
        const firstMetadata = new Uint32Array(first.nodes.buffer),
            movedMetadata = new Uint32Array(moved.nodes.buffer);
        for (let index = 0; index < first.nodeCount; index++) {
            expect(movedMetadata[index * RAY_BVH_NODE_FLOATS + 3]).toBe(
                firstMetadata[index * RAY_BVH_NODE_FLOATS + 3]
            );
            expect(movedMetadata[index * RAY_BVH_NODE_FLOATS + 7]).toBe(
                firstMetadata[index * RAY_BVH_NODE_FLOATS + 7]
            );
        }
        expect(
            traceRayTracingScene(first, { origin: [0, 0, 2], direction: [0, 0, -1] })?.distance
        ).toBe(1.5);
        expect(
            traceRayTracingScene(moved, { origin: [0, 0, 2], direction: [0, 0, -1] })
        ).toBeNull();
        expect(
            traceRayTracingScene(moved, { origin: [4, 0, 2], direction: [0, 0, -1] })?.distance
        ).toBe(1.5);
    });

    it('tracks direct color edits, shared geometry writes and membership independently', () => {
        const root = new Node();
        const firstMesh = triangle();
        const secondMesh = new Mesh({
            geometry: firstMesh.geometry,
            material: firstMesh.material,
            x: 4
        });
        root.addChild(firstMesh).addChild(secondMesh);
        root.updateMatrixWorld();
        const scene = new RayTracingScene();
        const first = scene.update(root);
        const material = firstMesh.material;
        if (!(material instanceof PBRMaterial)) throw new Error('Expected PBR test material');
        material.baseColor.r = 0.2;
        const colored = scene.update(root);
        expect(colored.diagnostics).toMatchObject({ update: 'material', changedMeshCount: 2 });
        expect(colored.nodes).toBe(first.nodes);
        expect(colored.triangles[24]).toBeCloseTo(0.15);
        expect(first.triangles[24]).toBeCloseTo(0.6);
        firstMesh.geometry?.vertices?.setSubData(2, new Float32Array([1]));
        const deformed = scene.update(root);
        expect(deformed.diagnostics).toMatchObject({ update: 'refit', changedMeshCount: 2 });
        secondMesh.removeFromParent();
        const removed = scene.update(root);
        expect(removed.diagnostics).toMatchObject({
            update: 'rebuild',
            meshCount: 1,
            triangleCount: 1
        });
    });

    it('publishes byte-exact partial uploads for material, layer and local rigid edits', () => {
        const root = new Node();
        const meshes = Array.from({ length: 12 }, (_value, index) => {
            const mesh = triangle();
            mesh.x = index * 4;
            root.addChild(mesh);
            return mesh;
        });
        root.updateMatrixWorld();
        const scene = new RayTracingScene();
        const initial = scene.update(root);
        expect(initial.baseRevision).toBe(0);
        expect(initial.triangleDirtyRanges).toEqual([
            { byteOffset: 0, byteLength: initial.triangles.byteLength }
        ]);
        expect(initial.nodeDirtyRanges).toEqual([
            { byteOffset: 0, byteLength: initial.nodes.byteLength }
        ]);
        const door = meshes[3];
        if (!door || !(door.material instanceof PBRMaterial))
            throw new Error('Expected the door fixture');
        door.material.baseColor.g = 0.7;
        const colored = scene.update(root);
        expect(colored.baseRevision).toBe(initial.revision);
        expect(colored.triangleDirtyRanges.reduce((sum, range) => sum + range.byteLength, 0)).toBe(
            128
        );
        expect(colored.nodeDirtyRanges).toEqual([]);
        expect(
            applyDelta(initial.triangles, colored.triangles, colored.triangleDirtyRanges)
        ).toEqual(new Uint8Array(colored.triangles.buffer));
        door.x += 0.2;
        root.updateMatrixWorld();
        const moved = scene.update(root);
        expect(moved.baseRevision).toBe(colored.revision);
        expect(moved.triangleDirtyRanges.reduce((sum, range) => sum + range.byteLength, 0)).toBe(
            128
        );
        const nodeUploadBytes = moved.nodeDirtyRanges.reduce(
            (sum, range) => sum + range.byteLength,
            0
        );
        expect(nodeUploadBytes).toBeGreaterThan(0);
        expect(nodeUploadBytes).toBeLessThan(moved.nodes.byteLength);
        expect(applyDelta(colored.triangles, moved.triangles, moved.triangleDirtyRanges)).toEqual(
            new Uint8Array(moved.triangles.buffer)
        );
        expect(applyDelta(colored.nodes, moved.nodes, moved.nodeDirtyRanges)).toEqual(
            new Uint8Array(moved.nodes.buffer)
        );
        // This layer value is a NaN bit pattern as f32: upload deltas must preserve raw metadata bits.
        door.layer = 0xffffffff;
        const masked = scene.update(root);
        expect(masked.baseRevision).toBe(moved.revision);
        expect(masked.nodeDirtyRanges).toEqual([]);
        expect(applyDelta(moved.triangles, masked.triangles, masked.triangleDirtyRanges)).toEqual(
            new Uint8Array(masked.triangles.buffer)
        );
        expect(scene.update(root)).toBe(masked);
        const excluded = triangle();
        excluded.material = new BasicMaterial();
        root.addChild(excluded);
        const diagnosticsOnly = scene.update(root);
        expect(diagnosticsOnly.baseRevision).toBe(masked.revision);
        expect(diagnosticsOnly.triangleDirtyRanges).toEqual([]);
        expect(diagnosticsOnly.nodeDirtyRanges).toEqual([]);
        expect(diagnosticsOnly.triangles).toBe(masked.triangles);
        root.addChild(triangle());
        root.updateMatrixWorld();
        const rebuilt = scene.update(root);
        expect(rebuilt.baseRevision).toBe(diagnosticsOnly.revision);
        expect(rebuilt.diagnostics.update).toBe('rebuild');
        expect(rebuilt.triangleDirtyRanges).toEqual([
            { byteOffset: 0, byteLength: rebuilt.triangles.byteLength }
        ]);
        expect(rebuilt.nodeDirtyRanges).toEqual([
            { byteOffset: 0, byteLength: rebuilt.nodes.byteLength }
        ]);
    });

    it('extracts offscreen meshes but respects hierarchical visibility and per-mesh layers', () => {
        const root = new Node();
        const visible = triangle();
        visible.x = 10000;
        visible.layer = 2;
        const hiddenGroup = new Node({ visible: false });
        hiddenGroup.addChild(triangle());
        root.addChild(hiddenGroup).addChild(visible);
        root.updateMatrixWorld();
        const scene = new RayTracingScene();
        expect(scene.update(root, 1).triangleCount).toBe(0);
        const snapshot = scene.update(root, 2);
        expect(snapshot.triangleCount).toBe(1);
        expect(
            traceRayTracingScene(snapshot, { origin: [10000, 0, 2], direction: [0, 0, -1] })
                ?.distance
        ).toBe(2);
        visible.visible = false;
        expect(scene.update(root, 2).triangleCount).toBe(0);
    });

    it('decodes interleaved normalized positions before world transforms and normal inverse transpose', () => {
        const mesh = triangle();
        const geometry = mesh.geometry;
        if (!geometry) throw new Error('Expected test geometry');
        geometry.vertices = new GeometryData(
            new Int16Array([99, -32767, -32767, 0, 99, 32767, -32767, 0, 99, 0, 32767, 0]),
            3,
            { stride: 8, offset: 2, normalized: true }
        );
        geometry.positionDecodeMat = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 1, 1];
        geometry.normals = new GeometryData(new Float32Array([1, 0, 1, 1, 0, 1, 1, 0, 1]), 3);
        mesh.scaleX = 2;
        mesh.z = 3;
        mesh.updateMatrixWorld();
        const scene = new RayTracingScene();
        const first = scene.update(mesh);
        expect(Array.from(first.triangles.subarray(0, 3))).toEqual([-4, -2, 4]);
        const hit = traceRayTracingScene(first, { origin: [0, 0, 6], direction: [0, 0, -1] });
        expect(hit?.distance).toBe(2);
        expect(hit?.normal[0]).toBeCloseTo(1 / Math.sqrt(5));
        expect(hit?.normal[2]).toBeCloseTo(2 / Math.sqrt(5));
        geometry.positionDecodeMat[14] = 2;
        const decodedAgain = scene.update(mesh);
        expect(decodedAgain.diagnostics.update).toBe('refit');
        expect(decodedAgain.triangles[2]).toBe(5);
    });

    it('never publishes invalid geometry or partial writes and recovers after a failed update', () => {
        const root = new Node();
        const firstMesh = triangle(),
            secondMesh = triangle();
        secondMesh.x = 4;
        root.addChild(firstMesh).addChild(secondMesh);
        root.updateMatrixWorld();
        const scene = new RayTracingScene({ maxTriangles: 2 });
        const first = scene.update(root);
        firstMesh.x = 1;
        secondMesh.scaleY = 0;
        root.updateMatrixWorld();
        expect(() => scene.update(root)).toThrow(/singular/);
        expect(first.triangles[0]).toBe(-1);
        secondMesh.scaleY = 1;
        root.updateMatrixWorld();
        const recovered = scene.update(root);
        expect(recovered.revision).toBe(first.revision + 1);
        expect(recovered.diagnostics.changedMeshCount).toBe(1);
        const extra = triangle();
        root.addChild(extra);
        root.updateMatrixWorld();
        expect(() => scene.update(root)).toThrow(/budget/);
        extra.removeFromParent();
        expect(scene.update(root)).toBe(recovered);
        const geometry = firstMesh.geometry;
        if (!geometry) throw new Error('Expected test geometry');
        geometry.indices = new GeometryData(new Uint16Array([0, 1, 999]), 1);
        expect(() => scene.update(root)).toThrow(/outside/);
        geometry.indices = null;
        expect(scene.update(root)).toBe(recovered);
    });

    it('reports unsupported surfaces and requires an explicit policy for surface texture approximation', () => {
        const root = new Node();
        const unsupported = triangle();
        unsupported.material = new BasicMaterial();
        root.addChild(unsupported);
        const excluded = new RayTracingScene().update(root);
        expect(excluded.diagnostics).toMatchObject({
            excludedMeshCount: 1,
            exclusions: { material: 1 }
        });
        expect(() => new RayTracingScene({ unsupported: 'error' }).update(root)).toThrow(
            /unsupported: material/
        );
        const textured = triangle();
        textured.material = new PBRMaterial({ baseColorMap: new Texture(), metallic: 0 });
        textured.updateMatrixWorld();
        expect(() => new RayTracingScene().update(textured)).toThrow(/explicit texture policy/);
        expect(
            new RayTracingScene({ texturePolicy: 'exclude' }).update(textured).diagnostics
        ).toMatchObject({
            triangleCount: 0,
            texturedMeshCount: 1,
            exclusions: { 'surface-texture': 1 }
        });
        expect(
            new RayTracingScene({ texturePolicy: 'material-factor' }).update(textured).diagnostics
        ).toMatchObject({ triangleCount: 1, texturedMeshCount: 1 });
    });

    it('keeps coincident-centroid BVHs bounded, deterministic and containing every primitive once', () => {
        const root = new Node();
        const geometry = new BoxGeometry();
        const material = new PBRMaterial({ metallic: 0 });
        for (let index = 0; index < 128; index++) root.addChild(new Mesh({ geometry, material }));
        root.updateMatrixWorld();
        const first = new RayTracingScene().update(root),
            second = new RayTracingScene().update(root);
        expect(first.nodes).toEqual(second.nodes);
        expect(first.triangles).toEqual(second.triangles);
        expect(first.diagnostics.bvhDepth).toBeLessThanOrEqual(11);
        const metadata = new Uint32Array(first.nodes.buffer);
        const primitiveUse = new Uint8Array(first.triangleCount);
        for (let node = 0; node < first.nodeCount; node++) {
            const a = requireNumber(metadata, node * RAY_BVH_NODE_FLOATS + 3),
                b = requireNumber(metadata, node * RAY_BVH_NODE_FLOATS + 7);
            if ((b & RAY_BVH_LEAF_FLAG) === 0) continue;
            const count = b & 0x7fffffff;
            expect(count).toBeGreaterThan(0);
            expect(count).toBeLessThanOrEqual(4);
            for (let triangleIndex = a; triangleIndex < a + count; triangleIndex++)
                primitiveUse[triangleIndex] = requireNumber(primitiveUse, triangleIndex) + 1;
        }
        expect(primitiveUse.every(value => value === 1)).toBe(true);
        expect(first.triangles.length).toBe(first.triangleCount * RAY_TRIANGLE_FLOATS);
        expect(
            traceRayTracingScene(first, { origin: [0, 0, 2], direction: [0, 0, -1] })?.distance
        ).toBe(1.5);
    });

    it('releases scene state while retaining monotonic recovery revisions and validates budgets/rays', () => {
        const mesh = triangle();
        mesh.updateMatrixWorld();
        const scene = new RayTracingScene();
        const first = scene.update(mesh);
        scene.clear();
        const recovered = scene.update(mesh);
        expect(recovered.revision).toBe(first.revision + 1);
        expect(recovered.diagnostics.update).toBe('rebuild');
        expect(() => new RayTracingScene({ maxTriangles: 0 })).toThrow(/maxTriangles/);
        expect(() => new RayTracingScene({ maxMeshes: Infinity })).toThrow(/maxMeshes/);
        expect(() => scene.update(mesh, 1.5)).toThrow(/layerMask/);
        expect(() =>
            traceRayTracingScene(first, { origin: [0, 0, 1], direction: [0, 0, 2] })
        ).toThrow(/normalized/);
        expect(() =>
            traceRayTracingScene(first, {
                origin: [0, 0, 1],
                direction: [0, 0, -1],
                minDistance: -1
            })
        ).toThrow(/interval/);
    });
});
