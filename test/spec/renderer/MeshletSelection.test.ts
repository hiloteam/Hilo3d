import { describe, expect, it } from 'vitest';
import {
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
    type MeshletGeometryPage,
    type MeshletGeometryOptions,
    type ClusteredForwardPlusPipelineOptions
} from '../../../src/Hilo3d';
import { RGBA, TEXTURE_2D, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

const WIDTH = 96;
const HEIGHT = 64;
const FINE_PAGE = 11;
const COARSE_PAGE = 29;

interface SelectionAsset {
    readonly geometry: Geometry;
    readonly manifest: MeshletAssetManifest;
    readonly fine: MeshletGeometryPage;
    readonly coarse: MeshletGeometryPage;
}

/** Four raised triangles replace two planar triangles, with a conservative 0.2-unit error. */
function selectionAsset(height = 0.2): SelectionAsset {
    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 0, 0, height]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uv0 = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0, 0.5, 0.5]);
    const vertices = new Float32Array(40);
    for (let vertex = 0; vertex < 5; vertex++) {
        vertices.set(positions.subarray(vertex * 3, vertex * 3 + 3), vertex * 8);
        vertices.set(normals.subarray(vertex * 3, vertex * 3 + 3), vertex * 8 + 3);
        vertices.set(uv0.subarray(vertex * 2, vertex * 2 + 2), vertex * 8 + 6);
    }
    const clusters = (count: number) =>
        Array.from({ length: count }, (_unused, index) => ({
            firstIndex: index * 3,
            indexCount: 3,
            bounds: [0, 0, 0, 1.5] as const,
            coneApex: [0, 0, 0] as const,
            coneAxis: [0, 0, 1] as const,
            coneCutoff: height === 0 ? 0 : 1
        }));
    const fine: MeshletGeometryPage = {
        vertices,
        indices: new Uint32Array([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]),
        meshlets: clusters(4)
    };
    const coarse: MeshletGeometryPage = {
        vertices: vertices.slice(0, 32),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
        meshlets: clusters(2)
    };
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        groups: [
            {
                id: 73,
                bounds: [0, 0, 0, 1.5],
                lods: [
                    { pageId: FINE_PAGE, error: 0 },
                    { pageId: COARSE_PAGE, error: height }
                ]
            }
        ],
        pages: [fine, coarse].map((page, index) => {
            const bytes = encodeMeshletGeometryPage(page);
            return {
                id: index === 0 ? FINE_PAGE : COARSE_PAGE,
                byteLength: bytes.byteLength,
                vertexCount: page.vertices.length / 8,
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
            uvs: new GeometryData(uv0, 2),
            indices: new GeometryData(fine.indices, 1)
        }),
        manifest,
        fine,
        coarse
    };
}

function material(color: Color, cullMode: 'back' | 'none' = 'none'): PBRMaterial {
    return new PBRMaterial({ baseColor: color, metallic: 0, roughness: 0.8, cullMode });
}

async function selectionView(
    asset: SelectionAsset,
    materials: readonly PBRMaterial[],
    options: Readonly<MeshletGeometryOptions>,
    effects: Readonly<
        Pick<
            ClusteredForwardPlusPipelineOptions,
            'temporalAA' | 'groundTruthAmbientOcclusion' | 'bloomStrength' | 'exposure'
        >
    > = {}
) {
    const meshlets = new MeshletGeometry(asset.manifest, {
        maxResidentBytes: 8192,
        maxUploadBytesPerFrame: 8192,
        maxVisibleMeshlets: 64,
        ...options
    });
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: materials.map(value => ({ geometry: asset.geometry, material: value, meshlets })),
        maxObjects: 8,
        maxLights: 4,
        maxLightIndices: 4096,
        maxLightsPerCluster: 4,
        maxViewportWidth: WIDTH,
        maxViewportHeight: HEIGHT,
        bloomStrength: 0,
        hiZ: false,
        ...effects
    });
    const canvas = document.createElement('canvas');
    const diagnostics = registerRendererDiagnostics(canvas);
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: canvas,
        width: WIDTH,
        height: HEIGHT,
        antialias: false,
        renderingProfile: 'high-end',
        renderPipeline: factory
    });
    renderer.clearColor = new Color(0, 0, 0);
    const target = renderer.createRenderTarget({
        width: WIDTH,
        height: HEIGHT,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
    });
    const scene = new Node();
    new PointLight({ amount: 5, range: 100, x: 1, y: 2, z: 5 }).addTo(scene);
    new PointLight({ amount: 3, range: 100, x: -4, y: 1, z: -5 }).addTo(scene);
    const camera = new PerspectiveCamera({
        aspect: WIDTH / HEIGHT,
        near: 0.1,
        far: 100,
        depthMode: 'reversed'
    });
    camera.setPosition(0, 0, 4).lookAt(new Vector3());
    const add = (materialIndex: number): Mesh => {
        const value = materials[materialIndex];
        if (value === undefined) throw new RangeError('Missing fixture material');
        return new Mesh({ geometry: asset.geometry, material: value }).addTo(scene);
    };
    const capture = async (frames = 1): Promise<Uint8Array> => {
        for (let frame = 0; frame < frames; frame++) {
            renderer.renderToTarget(target, scene, camera);
            await renderer.waitForIdle();
        }
        return (await target.readColorAttachment()).data;
    };
    const destroy = (): void => {
        target.destroy();
        scene.destroy(renderer);
        renderer.destroy();
        unregisterRendererDiagnostics(canvas);
    };
    return {
        renderer,
        target,
        factory,
        scene,
        camera,
        meshlets,
        diagnostics,
        add,
        capture,
        destroy
    };
}

function energy(pixels: Uint8Array): number {
    let total = 0;
    for (let offset = 0; offset < pixels.length; offset += 4)
        total += (pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0);
    return total;
}

function maximumDifference(left: Uint8Array, right: Uint8Array): number {
    expect(left.length).toBe(right.length);
    let maximum = 0;
    for (let index = 0; index < left.length; index++)
        maximum = Math.max(maximum, Math.abs((left[index] ?? 0) - (right[index] ?? 0)));
    return maximum;
}

function halfColor(pixels: Uint8Array, side: 'left' | 'right', channel: 0 | 1 | 2): number {
    let result = 0;
    const first = side === 'left' ? 0 : WIDTH / 2;
    const end = side === 'left' ? WIDTH / 2 : WIDTH;
    for (let y = 0; y < HEIGHT; y++)
        for (let x = first; x < end; x++) result += pixels[(y * WIDTH + x) * 4 + channel] ?? 0;
    return result;
}

describe('Meshlet GPU selection and material bins', () => {
    it('combines textured meshlets with TAA, GTAO, standard CSM shadows and the showcase display settings', async () => {
        const texture = (data: Uint8Array): Texture<Uint8Array> =>
            new Texture({
                image: data,
                target: TEXTURE_2D,
                internalFormat: RGBA8,
                format: RGBA,
                type: UNSIGNED_BYTE,
                width: 2,
                height: 2
            });
        const pattern = texture(
            new Uint8Array([
                255, 40, 20, 255, 20, 240, 40, 255, 20, 40, 255, 255, 255, 190, 20, 255
            ])
        );
        const white = texture(new Uint8Array(16).fill(255));
        const coat = new PBRMaterial({
            baseColor: new Color(0.8, 0.8, 0.8),
            baseColorMap: pattern,
            metallic: 0.1,
            roughness: 0.65,
            cullMode: 'none'
        });
        const asset = selectionAsset();
        const view = await selectionView(
            asset,
            [coat],
            { maximumProjectedError: 0 },
            {
                temporalAA: { sharpness: 0.12 },
                groundTruthAmbientOcclusion: {
                    quality: 'low',
                    radius: 0.65,
                    intensity: 0.85,
                    directionCount: 2,
                    stepCount: 4
                },
                bloomStrength: 0.015,
                exposure: 1.05
            }
        );
        try {
            view.add(0);
            new Mesh({
                geometry: new BoxGeometry({ width: 3.6, height: 2.8, depth: 0.1 }),
                material: material(new Color(0.25, 0.27, 0.3)),
                z: -0.35,
                castShadows: false,
                receiveShadows: true
            }).addTo(view.scene);
            new DirectionalLight({
                amount: 2,
                direction: new Vector3(0.5, -0.7, -1),
                shadow: { width: 128, height: 128, cascadeCount: 2 }
            }).addTo(view.scene);
            view.meshlets.setPageData(FINE_PAGE, asset.fine);
            const patterned = await view.capture();
            const firstPasses =
                view.diagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
            expect(firstPasses.some(name => name.includes('Meshlet shadow'))).toBe(true);
            await view.capture(4);
            const passes =
                view.diagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
            expect(passes).toEqual(
                expect.arrayContaining([
                    'GPU Scene GTAO material attributes',
                    'GTAO rotated horizon search',
                    'GTAO production temporal resolve'
                ])
            );
            expect(passes.some(name => name.startsWith('TemporalAA'))).toBe(true);
            expect(energy(patterned)).toBeGreaterThan(30_000);
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 1,
                visibleMeshletCount: 4,
                overflowObjectCount: 0
            });
            coat.setTextureSlot('baseColor', { texture: white });
            const untextured = await view.capture(5);
            expect(maximumDifference(patterned, untextured)).toBeGreaterThan(20);
            expect(energy(untextured)).toBeGreaterThan(energy(patterned));
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 1,
                visibleMeshletCount: 4,
                lastUploadBytes: 0
            });
        } finally {
            view.destroy();
            pattern.destroy();
            white.destroy();
        }
    }, 30_000);

    it('selects genuine coarse and fine pages from projected error with both pages continuously resident', async () => {
        const asset = selectionAsset();
        const view = await selectionView(asset, [material(new Color(0.7, 0.45, 0.2))], {
            maximumProjectedError: 1
        });
        try {
            const mesh = view.add(0);
            view.meshlets.setPageData(FINE_PAGE, asset.fine);
            view.meshlets.setPageData(COARSE_PAGE, asset.coarse);
            const near = await view.capture(2);
            expect(energy(near)).toBeGreaterThan(10_000);
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 2,
                visibleMeshletCount: 4,
                overflowObjectCount: 0
            });
            view.camera.setPosition(0, 0, 24).lookAt(new Vector3());
            expect(energy(await view.capture())).toBeGreaterThan(500);
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 2,
                visibleMeshletCount: 2,
                lastUploadBytes: 0
            });
            mesh.setScale(2, 2, 2);
            await view.capture();
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 2,
                visibleMeshletCount: 4,
                lastUploadBytes: 0
            });
            mesh.setScale(1, 1, 1);
            view.camera.setPosition(0, 0, 4).lookAt(new Vector3());
            expect(maximumDifference(await view.capture(), near)).toBeLessThanOrEqual(1);
            expect(
                (await view.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(4);
        } finally {
            view.destroy();
        }
    }, 30_000);

    it('compacts several instances into distinct material buckets without increasing fixed draw count', async () => {
        const asset = selectionAsset();
        const red = material(new Color(0.95, 0.04, 0.02));
        const blue = material(new Color(0.02, 0.08, 0.95));
        const view = await selectionView(asset, [red, blue], { maximumProjectedError: 0 });
        try {
            view.camera.setPosition(0, 0, 6).lookAt(new Vector3());
            for (let side = 0; side < 2; side++) {
                for (const y of [-0.7, 0.7])
                    view.add(side)
                        .setPosition(side === 0 ? -1.1 : 1.1, y, 0)
                        .setScale(0.4, 0.4, 0.4);
            }
            const ordinary = await view.capture();
            view.meshlets.setPageData(FINE_PAGE, asset.fine);
            const clustered = await view.capture(2);
            expect(maximumDifference(clustered, ordinary)).toBeLessThanOrEqual(1);
            expect(halfColor(clustered, 'left', 0)).toBeGreaterThan(
                halfColor(clustered, 'left', 2) * 2
            );
            expect(halfColor(clustered, 'right', 2)).toBeGreaterThan(
                halfColor(clustered, 'right', 0) * 2
            );
            expect(await view.factory.readDiagnostics()).toMatchObject({
                objectCount: 4,
                fallbackObjectCount: 0,
                meshletGeometry: {
                    residentPageCount: 2,
                    visibleMeshletCount: 16,
                    overflowObjectCount: 0
                }
            });
            const drawCount = view.renderer.renderInfo.drawCount;
            expect(drawCount).toBeGreaterThan(0);
            blue.baseColor.set(0.03, 0.95, 0.04, 1);
            blue.invalidateData();
            const green = await view.capture();
            expect(halfColor(green, 'right', 1)).toBeGreaterThan(halfColor(green, 'right', 2) * 2);
            expect(halfColor(green, 'left', 0)).toBe(halfColor(clustered, 'left', 0));
            view.add(0).setScale(0.3, 0.3, 0.3);
            expect(energy(await view.capture(2))).toBeGreaterThan(energy(green));
            expect(view.renderer.renderInfo.drawCount).toBe(drawCount);
            expect(
                (await view.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(20);
        } finally {
            view.destroy();
        }
    }, 30_000);

    it('rejects backface cones while conservatively retaining mirrored and sheared visible surfaces', async () => {
        const asset = selectionAsset(0);
        // Emission keeps raster visibility measurable independently of BRDF normal facing.
        const coneMaterial = new PBRMaterial({
            baseColor: new Color(0.8, 0.6, 0.25),
            emission: new Color(0.15, 0.08, 0.025),
            metallic: 0,
            roughness: 0.8,
            cullMode: 'back'
        });
        const view = await selectionView(asset, [coneMaterial], { maximumProjectedError: 0 });
        try {
            const mesh = view.add(0);
            const frontReference = await view.capture();
            view.meshlets.setPageData(FINE_PAGE, asset.fine);
            // Both planar levels have zero source error; the debug setting still selects finest.
            view.meshlets.setPageData(COARSE_PAGE, asset.coarse);
            const front = await view.capture(2);
            expect(energy(front)).toBeGreaterThan(10_000);
            expect(maximumDifference(front, frontReference)).toBeLessThanOrEqual(1);
            expect(
                (await view.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(4);
            view.camera.setPosition(0, 0, -4).lookAt(new Vector3());
            expect(energy(await view.capture())).toBe(0);
            expect(
                (await view.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(0);

            mesh.scaleX = -1;
            view.meshlets.evictPage(FINE_PAGE);
            view.meshlets.evictPage(COARSE_PAGE);
            const mirroredReference = await view.capture();
            view.meshlets.setPageData(FINE_PAGE, asset.fine);
            const mirrored = await view.capture(2);
            expect(energy(mirrored)).toBeGreaterThan(10_000);
            expect(maximumDifference(mirrored, mirroredReference)).toBeLessThanOrEqual(1);
            expect(
                (await view.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(4);

            mesh.setScale(1, 1, 1).setRotation(0, 45, 0);
            const parent = new Node({ scaleX: 3, scaleY: 1, scaleZ: 0.3 }).addTo(view.scene);
            mesh.addTo(parent);
            // The geometric normal points mostly +Z. Transforming its cone axis as a direction
            // points mostly +X and would incorrectly reject this camera; shear must disable it.
            view.camera.setPosition(-4, 0, 5.2).lookAt(new Vector3());
            view.meshlets.evictPage(FINE_PAGE);
            const shearedReference = await view.capture();
            view.meshlets.setPageData(FINE_PAGE, asset.fine);
            const sheared = await view.capture(2);
            expect(energy(sheared)).toBeGreaterThan(10_000);
            expect(maximumDifference(sheared, shearedReference)).toBeLessThanOrEqual(1);
            expect(
                (await view.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(4);
        } finally {
            view.destroy();
        }
    }, 30_000);
});
