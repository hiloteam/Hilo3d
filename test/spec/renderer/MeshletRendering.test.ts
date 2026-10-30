import { describe, expect, it } from 'vitest';
import {
    AmbientLight,
    BoxGeometry,
    ClusteredForwardPlusPipelineFactory,
    Color,
    DirectionalLight,
    Geometry,
    GeometryData,
    Mesh,
    MeshletGeometry,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    PointLight,
    Renderer,
    Texture,
    Vector3,
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    type MeshletAssetManifest,
    type MeshletGeometryPage
} from '../../../src/Hilo3d';
import { RGBA, TEXTURE_2D, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

function asset(): {
    geometry: Geometry;
    manifest: MeshletAssetManifest;
    fine: MeshletGeometryPage;
    coarse: MeshletGeometryPage;
} {
    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
    const vertices = new Float32Array(32);
    for (let index = 0; index < 4; index++) {
        vertices.set(positions.subarray(index * 3, index * 3 + 3), index * 8);
        vertices.set(normals.subarray(index * 3, index * 3 + 3), index * 8 + 3);
        vertices.set(uvs.subarray(index * 2, index * 2 + 2), index * 8 + 6);
    }
    const cluster = (firstIndex: number) => ({
        firstIndex,
        indexCount: 3,
        bounds: [0, 0, 0, 2] as const,
        coneApex: [0, 0, 0] as const,
        coneAxis: [0, 0, 1] as const,
        coneCutoff: 0
    });
    const fine: MeshletGeometryPage = {
        vertices,
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        meshlets: [cluster(0), cluster(3)]
    };
    const coarse: MeshletGeometryPage = {
        vertices,
        indices: new Uint32Array([0, 1, 2]),
        meshlets: [cluster(0)]
    };
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        groups: [
            {
                id: 3,
                bounds: [0, 0, 0, 2],
                lods: [
                    { pageId: 11, error: 0 },
                    { pageId: 29, error: 1 }
                ]
            }
        ],
        pages: [fine, coarse].map((page, index) => {
            const bytes = encodeMeshletGeometryPage(page);
            return {
                id: index === 0 ? 11 : 29,
                byteLength: bytes.byteLength,
                vertexCount: 4,
                indexCount: page.indices.length,
                meshletCount: page.meshlets.length,
                checksum: meshletPageChecksum(bytes)
            };
        })
    };
    return {
        geometry: new Geometry({
            vertices: new GeometryData(positions, 3),
            normals: new GeometryData(normals, 3),
            uvs: new GeometryData(uvs, 2),
            indices: new GeometryData(fine.indices, 1)
        }),
        manifest,
        fine,
        coarse
    };
}

async function view(
    maxVisibleMeshlets: number,
    temporal = false,
    masked = false,
    withRear = false
) {
    const data = asset();
    const meshlets = new MeshletGeometry(data.manifest, {
        maxResidentBytes: 4096,
        maxUploadBytesPerFrame: 4096,
        maxVisibleMeshlets,
        maximumProjectedError: 0
    });
    const texture = masked
        ? new Texture({
              image: new Uint8Array([
                  255, 40, 20, 255, 20, 255, 40, 0, 20, 40, 255, 255, 255, 200, 20, 255
              ]),
              target: TEXTURE_2D,
              internalFormat: RGBA8,
              format: RGBA,
              type: UNSIGNED_BYTE,
              width: 2,
              height: 2
          })
        : null;
    const material = new PBRMaterial({
        baseColor: new Color(0.8, 0.6, 0.3),
        roughness: 0.8,
        metallic: 0,
        cullMode: 'none',
        ...(texture === null
            ? {}
            : { baseColorMap: texture, coverage: { mode: 'mask' as const, cutoff: 0.5 } })
    });
    const rearGeometry = new BoxGeometry({ width: 0.1, height: 0.1, depth: 0.1 });
    const rearMaterial = new PBRMaterial({ baseColor: new Color(0.1, 0.9, 0.1), roughness: 1 });
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [
            { geometry: data.geometry, material, meshlets },
            ...(withRear ? [{ geometry: rearGeometry, material: rearMaterial }] : [])
        ],
        maxObjects: 4,
        maxLights: 4,
        maxLightIndices: 4096,
        maxLightsPerCluster: 4,
        maxViewportWidth: 48,
        maxViewportHeight: 48,
        bloomStrength: 0,
        hiZ: true,
        ...(temporal ? { temporalAA: {} } : {})
    });
    const canvas = document.createElement('canvas');
    const diagnostics = registerRendererDiagnostics(canvas);
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: canvas,
        width: 48,
        height: 48,
        antialias: false,
        renderingProfile: 'high-end',
        renderPipeline: factory
    });
    renderer.clearColor = new Color(0, 0, 0);
    const target = renderer.createRenderTarget({
        width: 48,
        height: 48,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
    });
    const scene = new Node();
    const mesh = new Mesh({
        geometry: data.geometry,
        material,
        castShadows: true,
        receiveShadows: true
    }).addTo(scene);
    if (withRear)
        new Mesh({
            geometry: rearGeometry,
            material: rearMaterial,
            x: -0.35,
            y: 0.35,
            z: -0.75
        }).addTo(scene);
    new AmbientLight({ amount: 0.8 }).addTo(scene);
    new PointLight({ amount: 4, range: 20, z: 4, x: 1, y: 1 }).addTo(scene);
    const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 20, depthMode: 'reversed' });
    camera.setPosition(0, 0, 4).lookAt(new Vector3());
    const capture = async (frames = 1): Promise<Uint8Array> => {
        for (let index = 0; index < frames; index++) {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
        }
        return (await target.readColorAttachment()).data;
    };
    const destroy = (): void => {
        target.destroy();
        scene.destroy(renderer);
        renderer.destroy();
        texture?.destroy();
        unregisterRendererDiagnostics(canvas);
    };
    return {
        ...data,
        meshlets,
        material,
        factory,
        renderer,
        target,
        scene,
        mesh,
        camera,
        diagnostics,
        capture,
        destroy
    };
}

function energy(pixels: Uint8Array): number {
    let sum = 0;
    for (let index = 0; index < pixels.length; index += 4)
        sum += (pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0);
    return sum;
}
function maximumDifference(left: Uint8Array, right: Uint8Array): number {
    let result = 0;
    for (let index = 0; index < left.length; index++)
        result = Math.max(result, Math.abs((left[index] ?? 0) - (right[index] ?? 0)));
    return result;
}

describe('Meshlet shared rendering', () => {
    it('invalidates previous Hi-Z when streamed occluders reveal ordinary GPU Scene objects', async () => {
        const test = await view(8, false, false, true);
        try {
            test.meshlets.setPageData(11, test.fine);
            test.scene.updateMatrixWorld(true);
            test.scene.traverse(node => {
                node.autoUpdateWorldMatrix = false;
                return Node.TRAVERSE_STOP_NONE;
            });
            await test.capture(4);
            expect(await test.factory.readDiagnostics()).toMatchObject({
                objectCount: 2,
                hiZValid: true,
                visibleObjectCount: 1,
                occludedObjectCount: 1
            });
            test.meshlets.evictPage(11);
            test.meshlets.setPageData(29, test.coarse);
            const revealed = await test.capture();
            expect((await test.factory.readDiagnostics()).hiZValid).toBe(false);
            expect((await test.factory.readDiagnostics()).occludedObjectCount).toBe(0);
            expect(maximumDifference(revealed, await test.capture())).toBeLessThanOrEqual(1);
        } finally {
            test.destroy();
        }
    }, 30_000);

    it('keeps asymmetric UV0 alpha-mask pixels identical to ordinary geometry', async () => {
        const test = await view(8, false, true);
        try {
            const reference = await test.capture(2);
            test.meshlets.setPageData(11, test.fine);
            const resident = await test.capture(2);
            expect(energy(resident)).toBeGreaterThan(10_000);
            expect(maximumDifference(resident, reference)).toBeLessThanOrEqual(1);
            expect((await test.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 1,
                visibleMeshletCount: 2,
                overflowObjectCount: 0
            });
            test.meshlets.evictPage(11);
            expect(maximumDifference(await test.capture(2), reference)).toBeLessThanOrEqual(1);
        } finally {
            test.destroy();
        }
    }, 30_000);

    it('atomically retains the complete fallback when the cluster output budget overflows', async () => {
        const test = await view(1);
        try {
            const reference = await test.capture(2);
            test.meshlets.setPageData(11, test.fine);
            expect(maximumDifference(await test.capture(2), reference)).toBeLessThanOrEqual(1);
            expect((await test.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 1,
                visibleMeshletCount: 0,
                overflowObjectCount: 1
            });
            test.meshlets.evictPage(11);
            test.meshlets.setPageData(29, test.coarse);
            const coarse = await test.capture(2);
            expect(energy(coarse)).toBeLessThan(energy(reference) * 0.7);
            expect((await test.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                visibleMeshletCount: 1,
                overflowObjectCount: 0
            });
        } finally {
            test.destroy();
        }
    }, 30_000);

    it('shares masked temporal motion and invalidates standard shadow cache on page changes', async () => {
        const test = await view(8, true, true);
        try {
            const light = new DirectionalLight({
                amount: 1,
                direction: new Vector3(0.25, -0.5, -1),
                shadow: { width: 64, height: 64 }
            }).addTo(test.scene);
            await test.capture(3);
            expect(test.diagnostics.snapshot().frame.shadowUpdatedSlices).toBe(0);
            test.meshlets.setPageData(29, test.coarse);
            await test.capture();
            expect(test.diagnostics.snapshot().frame.shadowUpdatedSlices).toBeGreaterThan(0);
            expect(
                test.diagnostics
                    .snapshot()
                    .renderGraph?.passes.some(pass => pass.name.includes('Meshlet shadow'))
            ).toBe(true);
            test.meshlets.setPageData(11, test.fine);
            const fine = await test.capture();
            expect(test.diagnostics.snapshot().frame.shadowUpdatedSlices).toBeGreaterThan(0);
            expect(energy(fine)).toBeGreaterThan(10_000);
            await test.capture(3);
            expect(test.diagnostics.snapshot().frame.shadowUpdatedSlices).toBe(0);
            test.mesh.x = 0.15;
            await test.capture(2);
            test.meshlets.evictPage(11);
            await test.capture();
            expect(test.diagnostics.snapshot().frame.shadowUpdatedSlices).toBeGreaterThan(0);
            expect(
                (await test.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(1);
            light.shadow = null;
            await test.capture();
        } finally {
            test.destroy();
        }
    }, 30_000);
});
