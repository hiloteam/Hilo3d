import { describe, expect, it } from 'vitest';
import { NEAREST } from '../../../src/constants/webgl';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import MeshletGeometry from '../../../src/geometry/meshlet/MeshletGeometry';
import {
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    type MeshletAssetManifest,
    type MeshletGeometryPage
} from '../../../src/geometry/meshlet/MeshletAsset';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Texture from '../../../src/texture/Texture';
import {
    RayTracingScene,
    traceRayTracingScene,
    type RayTracingGeometryResolver
} from '../../../src/render/gi/RayTracingScene';
import {
    MeshletRayGeometry,
    type MeshletRayPageSource
} from '../../../src/render/gi/scene/MeshletRayGeometry';

/** The source contract exposes the page table staged for this submission, independent of CPU availability. */
class PageSource implements MeshletRayPageSource {
    #committed = new Map<number, Readonly<MeshletGeometryPage>>();
    #pending: ReadonlyMap<number, Readonly<MeshletGeometryPage>> | null = null;

    constructor(readonly geometry: MeshletGeometry) {}

    getResidentPage(id: number): Readonly<MeshletGeometryPage> | null {
        return (this.#pending ?? this.#committed).get(id) ?? null;
    }
    stage(...ids: number[]): void {
        const pending = new Map<number, Readonly<MeshletGeometryPage>>();
        for (const id of ids) {
            const page = this.geometry.getPageData(id);
            if (!page) throw new Error('Missing fixture CPU page.');
            pending.set(id, page);
        }
        this.#pending = pending;
    }
    submit(): void {
        if (this.#pending !== null) this.#committed = new Map(this.#pending);
        this.#pending = null;
    }
    discard(): void {
        this.#pending = null;
    }
}

function fixture(): {
    source: PageSource;
    helper: MeshletRayGeometry;
    fallback: Geometry;
    resolver: RayTracingGeometryResolver;
} {
    const pages = [6, 3, 6, 3].map((indexCount, id): MeshletGeometryPage => {
        const x = id < 2 ? 0 : 5;
        const z = id % 2 === 0 ? 0 : -1;
        return {
            vertices: new Float32Array([
                x - 1,
                -1,
                z,
                0,
                0,
                1,
                0,
                0,
                x + 1,
                -1,
                z,
                0,
                0,
                1,
                1,
                0,
                x + 1,
                1,
                z,
                0,
                0,
                1,
                1,
                1,
                x - 1,
                1,
                z,
                0,
                0,
                1,
                0,
                1
            ]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3].slice(0, indexCount)),
            meshlets: [
                {
                    firstIndex: 0,
                    indexCount,
                    bounds: [x, 0, z, 2],
                    coneApex: [x, 0, z],
                    coneAxis: [0, 0, 1],
                    coneCutoff: 1
                }
            ]
        };
    });
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        groups: [0, 2].map(id => ({
            id,
            bounds: [id === 0 ? 0 : 5, 0, 0, 3],
            lods: [
                { pageId: id, error: 0 },
                { pageId: id + 1, error: 1 }
            ]
        })),
        pages: pages.map((page, id) => {
            const wire = encodeMeshletGeometryPage(page);
            return {
                id,
                byteLength: wire.byteLength,
                vertexCount: 4,
                indexCount: page.indices.length,
                meshletCount: 1,
                checksum: meshletPageChecksum(wire)
            };
        })
    };
    const geometry = new MeshletGeometry(manifest);
    pages.forEach((page, id) => {
        geometry.setPageData(id, page);
    });
    const source = new PageSource(geometry);
    const helper = new MeshletRayGeometry(source);
    const fallback = new Geometry({
        vertices: new GeometryData(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
        normals: new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
        uvs: new GeometryData(new Float32Array([0, 0, 1, 0, 0.5, 1]), 2)
    });
    const resolver: RayTracingGeometryResolver = (mesh, remaining) =>
        mesh.geometry === fallback ? helper.resolve(fallback, remaining) : null;
    return { source, helper, fallback, resolver };
}

describe('camera-independent resident meshlet ray geometry', () => {
    it('keeps a whole-object fallback until every group is resident, then retains stable finest-page identity', () => {
        const { source, helper, fallback } = fixture();
        // Fine CPU pages exist, but availability alone is not a submitted/staged GPU page table.
        expect(source.geometry.hasPage(0)).toBe(true);
        expect(helper.resolve(fallback, 4)).toBe(fallback);
        source.stage(0);
        expect(helper.resolve(fallback, 1)).toBe(fallback);
        source.stage(1, 3);
        const coarse = helper.resolve(fallback, 4);
        expect(coarse).not.toBe(fallback);
        expect(coarse.vertices?.data.byteLength).toBe(2 * 96);
        expect(helper.resolve(fallback, 4)).toBe(coarse);
        source.stage(0, 1, 3);
        const refined = helper.resolve(fallback, 4);
        expect(refined.vertices?.data.byteLength).toBe(3 * 96);
        expect(helper.resolve(fallback, 4)).toBe(refined);
        source.geometry.evictPage(2);
        expect(helper.resolve(fallback, 4)).toBe(refined);
        source.stage(1, 3);
        expect(helper.resolve(fallback, 4).vertices?.data.byteLength).toBe(2 * 96);
        expect(refined.vertices?.data.byteLength).toBe(3 * 96);
    });

    it('updates offscreen shared instances with their own world transforms and the canonical UV0 alpha mask', () => {
        const { source, fallback, resolver } = fixture();
        source.stage(0, 2);
        const texture = new Texture({
            image: new Uint8Array(8),
            width: 2,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const material = new PBRMaterial({
            baseColor: new Color(1, 1, 1),
            metallic: 0,
            baseColorMap: { texture, encoding: 'linear' },
            coverage: { mode: 'mask', cutoff: 0.5 },
            cullMode: 'none'
        });
        const root = new Node();
        const first = new Mesh({
            geometry: fallback,
            material,
            x: 10_000,
            scaleX: 2,
            layer: 0x80000001
        }).addTo(root);
        const second = new Mesh({ geometry: fallback, material, x: 20_000 }).addTo(root);
        root.updateMatrixWorld(true);
        const scene = new RayTracingScene({ maxTriangles: 8, unsupported: 'error' });
        try {
            const snapshot = scene.update(root, 0xffffffff, resolver);
            expect(snapshot.diagnostics).toMatchObject({
                triangleCount: 8,
                meshCount: 2,
                texturedMeshCount: 2
            });
            expect(first.geometry).toBe(fallback);
            expect(second.geometry).toBe(fallback);
            const atlas = new Float32Array([1, 0, 0, 1, 0, 1, 0, 0]);
            const hit = traceRayTracingScene(
                snapshot,
                { origin: [9999, -0.5, 2], direction: [0, 0, -1] },
                atlas
            );
            expect(hit?.distance).toBe(2);
            expect(hit?.normal).toEqual([0, 0, 1]);
            expect(
                traceRayTracingScene(
                    snapshot,
                    { origin: [10001, -0.5, 2], direction: [0, 0, -1] },
                    atlas
                )
            ).toBeNull();
            expect(
                traceRayTracingScene(
                    snapshot,
                    { origin: [19999.5, -0.5, 2], direction: [0, 0, -1] },
                    atlas
                )?.distance
            ).toBe(2);
            expect(scene.update(root, 0xffffffff, resolver)).toBe(snapshot);
            first.z = 1;
            root.updateMatrixWorld(true);
            const moved = scene.update(root, 0xffffffff, resolver);
            expect(moved.diagnostics.update).toBe('refit');
            expect(
                traceRayTracingScene(
                    moved,
                    { origin: [9999, -0.5, 2], direction: [0, 0, -1] },
                    atlas
                )?.distance
            ).toBe(1);
            expect(
                traceRayTracingScene(
                    snapshot,
                    { origin: [9999, -0.5, 2], direction: [0, 0, -1] },
                    atlas
                )?.distance
            ).toBe(2);
        } finally {
            scene.clear();
            texture.destroy();
        }
    });

    it('follows discarded residency candidates and retries refined rays without altering earlier snapshots', () => {
        const { source, helper, fallback, resolver } = fixture();
        const mesh = new Mesh({ geometry: fallback, material: new PBRMaterial() });
        mesh.updateMatrixWorld();
        const scene = new RayTracingScene({ maxTriangles: 4 });
        source.stage(1, 3);
        source.submit();
        const coarse = scene.update(mesh, 0xffffffff, resolver);
        source.stage(0, 1, 3);
        const candidate = scene.update(mesh, 0xffffffff, resolver);
        const ray = { origin: [-0.5, 0.5, 2] as const, direction: [0, 0, -1] as const };
        expect(traceRayTracingScene(coarse, ray)).toBeNull();
        expect(traceRayTracingScene(candidate, ray)?.distance).toBe(2);
        source.discard();
        const restored = scene.update(mesh, 0xffffffff, resolver);
        expect(restored.triangleCount).toBe(2);
        expect(traceRayTracingScene(restored, ray)).toBeNull();
        expect(traceRayTracingScene(candidate, ray)?.distance).toBe(2);
        source.stage(0, 1, 3);
        const retry = scene.update(mesh, 0xffffffff, resolver);
        expect(retry.revision).toBeGreaterThan(restored.revision);
        expect(retry.baseRevision).toBe(restored.revision);
        expect(traceRayTracingScene(retry, ray)?.distance).toBe(2);
        source.submit();
        expect(scene.update(mesh, 0xffffffff, resolver)).toBe(retry);
        helper.clear();
        scene.clear();
        expect(traceRayTracingScene(scene.update(mesh, 0xffffffff, resolver), ray)?.distance).toBe(
            2
        );
    });

    it('checks the remaining aggregate triangle budget before replacing a stable extraction snapshot', () => {
        const { source, helper, fallback, resolver } = fixture();
        source.stage(1, 3);
        const stable = helper.resolve(fallback, 4);
        source.stage(0, 2);
        expect(() => helper.resolve(fallback, 3)).toThrow(/scene triangle budget/);
        source.stage(1, 3);
        expect(helper.resolve(fallback, 4)).toBe(stable);
        const root = new Node();
        new Mesh({ geometry: fallback, material: new PBRMaterial() }).addTo(root);
        new Mesh({ geometry: fallback, material: new PBRMaterial(), x: 20 }).addTo(root);
        root.updateMatrixWorld(true);
        const scene = new RayTracingScene({ maxTriangles: 6 });
        const before = scene.update(root, 0xffffffff, resolver);
        const bytes = before.triangles.slice();
        source.stage(0, 2);
        expect(() => scene.update(root, 0xffffffff, resolver)).toThrow(/scene triangle budget/);
        expect(before.triangles).toEqual(bytes);
        source.discard();
        // No residency was committed in this case: the complete ordinary fallback remains valid.
        expect(scene.update(root, 0xffffffff, resolver).triangleCount).toBe(2);
    });

    it('honors mesh participation and layers before requesting replacement geometry', () => {
        const { source, fallback, resolver } = fixture();
        source.stage(0, 2);
        const mesh = new Mesh({ geometry: fallback, material: new PBRMaterial(), layer: 2 });
        mesh.updateMatrixWorld();
        let calls = 0;
        const resolve: RayTracingGeometryResolver = (object, remaining) => {
            calls++;
            return resolver(object, remaining);
        };
        const scene = new RayTracingScene({ maxTriangles: 4 });
        expect(scene.update(mesh, 1, resolve).triangleCount).toBe(0);
        mesh.contributeToGlobalIllumination = false;
        expect(scene.update(mesh, 2, resolve).diagnostics.exclusions.disabled).toBe(1);
        expect(calls).toBe(0);
        mesh.contributeToGlobalIllumination = true;
        expect(scene.update(mesh, 2, resolve).triangleCount).toBe(4);
        expect(calls).toBe(1);
    });
});
