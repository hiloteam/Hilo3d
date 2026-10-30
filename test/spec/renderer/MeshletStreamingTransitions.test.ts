import { describe, expect, it } from 'vitest';
import {
    AmbientLight,
    ClusteredForwardPlusPipelineFactory,
    Color,
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
    type MeshletGeometryOptions,
    type MeshletGeometryPage
} from '../../../src/Hilo3d';
import { GeometryPageManager } from '@hilo/addon-assets';

function asset(options: MeshletGeometryOptions = {}) {
    const positions: number[] = [],
        normals: number[] = [],
        uvs: number[] = [],
        tangents: number[] = [],
        indices: number[] = [];
    const pages: MeshletGeometryPage[] = [];
    for (let group = 0; group < 2; group++) {
        const center = group === 0 ? -1.1 : 1.1;
        const vertices = new Float32Array([
            center - 0.8,
            -0.8,
            0,
            0,
            0,
            1,
            0,
            0,
            center + 0.8,
            -0.8,
            0,
            0,
            0,
            1,
            1,
            0,
            center + 0.8,
            0.8,
            0,
            0,
            0,
            1,
            1,
            1,
            center - 0.8,
            0.8,
            0,
            0,
            0,
            1,
            0,
            1
        ]);
        for (let vertex = 0; vertex < 4; vertex++) {
            positions.push(...vertices.subarray(vertex * 8, vertex * 8 + 3));
            normals.push(0, 0, 1);
            uvs.push(...vertices.subarray(vertex * 8 + 6, vertex * 8 + 8));
            tangents.push(1, 0, 0, 1);
        }
        const cluster = (firstIndex: number) => ({
            firstIndex,
            indexCount: 3,
            bounds: [center, 0, 0, 1.5] as const,
            coneApex: [center, 0, 0] as const,
            coneAxis: [0, 0, 1] as const,
            coneCutoff: 1
        });
        pages.push({
            vertices,
            indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
            meshlets: [cluster(0), cluster(3)]
        });
        pages.push({ vertices, indices: new Uint32Array([0, 1, 2]), meshlets: [cluster(0)] });
        indices.push(...[0, 1, 2, 0, 2, 3].map(index => index + group * 4));
    }
    const payloads = pages.map(encodeMeshletGeometryPage);
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        pages: pages.map((page, id) => {
            const bytes = payloads[id];
            if (!bytes) throw new Error('Missing page payload.');
            return {
                id,
                byteLength: bytes.byteLength,
                vertexCount: 4,
                indexCount: page.indices.length,
                meshletCount: page.meshlets.length,
                checksum: meshletPageChecksum(bytes)
            };
        }),
        groups: [0, 1].map(group => ({
            id: group,
            bounds: [group === 0 ? -1.1 : 1.1, 0, 0, 1.5],
            lods: [
                { pageId: group * 2, error: 0 },
                { pageId: group * 2 + 1, error: 0.1 }
            ]
        }))
    };
    const geometry = new Geometry({
        vertices: new GeometryData(new Float32Array(positions), 3),
        normals: new GeometryData(new Float32Array(normals), 3),
        uvs: new GeometryData(new Float32Array(uvs), 2),
        uvs1: new GeometryData(new Float32Array(uvs), 2),
        tangents: new GeometryData(new Float32Array(tangents), 4),
        indices: new GeometryData(new Uint32Array(indices), 1)
    });
    const meshlets = new MeshletGeometry(manifest, {
        maxResidentBytes: 4096,
        maxUploadBytesPerFrame: 4096,
        maxVisibleMeshlets: 8,
        maximumProjectedError: 0,
        ...options
    });
    return { geometry, meshlets, pages, payloads, manifest };
}

async function createView(data: ReturnType<typeof asset>) {
    const material = new PBRMaterial({
        baseColor: new Color(0.4, 0.7, 0.9),
        roughness: 0.8,
        cullMode: 'none'
    });
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [{ geometry: data.geometry, material, meshlets: data.meshlets }],
        maxObjects: 4,
        maxLights: 1,
        maxLightsPerCluster: 1,
        maxLightIndices: 1024,
        maxViewportWidth: 64,
        maxViewportHeight: 48,
        bloomStrength: 0,
        hiZ: false
    });
    const renderer = await Renderer.create({
        backend: 'webgpu',
        width: 64,
        height: 48,
        domElement: document.createElement('canvas'),
        antialias: false,
        renderingProfile: 'high-end',
        renderPipeline: factory
    });
    const target = renderer.createRenderTarget({
        width: 64,
        height: 48,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
    });
    renderer.clearColor = new Color(0, 0, 0);
    const scene = new Node();
    const mesh = new Mesh({ geometry: data.geometry, material }).addTo(scene);
    new AmbientLight({ amount: 1 }).addTo(scene);
    new PointLight({ amount: 8, range: 20, z: 4, x: 1, y: 2 }).addTo(scene);
    const camera = new PerspectiveCamera({
        aspect: 64 / 48,
        near: 0.1,
        far: 30,
        depthMode: 'reversed'
    });
    camera.setPosition(0, 0, 5).lookAt(new Vector3());
    return {
        material,
        mesh,
        factory,
        async capture(frames = 2): Promise<Uint8Array> {
            for (let frame = 0; frame < frames; frame++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            return (await target.readColorAttachment()).data;
        },
        destroy(): void {
            target.destroy();
            scene.destroy(renderer);
            renderer.destroy();
        }
    };
}

function maximumDifference(left: Uint8Array, right: Uint8Array): number {
    let maximum = 0;
    for (let index = 0; index < left.length; index++)
        maximum = Math.max(maximum, Math.abs((left[index] ?? 0) - (right[index] ?? 0)));
    return maximum;
}

async function pump(manager: GeometryPageManager, ready: Promise<void>): Promise<void> {
    const state: { done: boolean; error: Error | null } = { done: false, error: null };
    void ready.then(
        () => {
            state.done = true;
        },
        (error: unknown) => {
            state.error =
                error instanceof Error ? error : new Error('Page demand failed.', { cause: error });
            state.done = true;
        }
    );
    for (let count = 0; count < 100 && !state.done; count++) {
        manager.update();
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (state.error) throw state.error;
    if (!state.done) throw new Error('Page demand did not complete.');
}

describe('meshlet streaming and material transitions', () => {
    it('does not require unallocated temporal choice buffers in a non-temporal scene', () => {
        const data = asset();
        const descriptor = data.manifest.pages[1];
        if (!descriptor) throw new Error('Missing coarse descriptor.');
        const manifest: MeshletAssetManifest = {
            version: 1,
            vertexStride: 8,
            pages: Array.from({ length: 1000 }, (_, id) => ({ ...descriptor, id })),
            groups: Array.from({ length: 1000 }, (_, id) => ({
                id,
                bounds: [0, 0, 0, 3],
                lods: [{ pageId: id, error: 0 }]
            }))
        };
        const meshlets = new MeshletGeometry(manifest);
        const create = (temporal: boolean) =>
            new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry: data.geometry, material: new PBRMaterial(), meshlets }],
                maxObjects: 200_000,
                maxLights: 1,
                maxLightsPerCluster: 1,
                maxLightIndices: 1024,
                maxViewportWidth: 64,
                maxViewportHeight: 48,
                hiZ: false,
                ...(temporal ? { temporalAA: {} } : {})
            });
        expect(
            create(false).requirements.requiredLimits?.['maxStorageBufferBindingSize']
        ).toBeLessThan(128 * 1024 * 1024);
        expect(create(true).requirements.requiredLimits?.['maxStorageBufferBindingSize']).toBe(
            800_000_000
        );
    });

    it('moves fine-page residency from A to B by releasing A while coarse fallbacks stay pinned', async () => {
        // Table192 + two coarse pages220 each + one fine page296 =928bytes.
        const data = asset({ maxResidentBytes: 928 });
        const manager = new GeometryPageManager(
            data.meshlets,
            {
                id: 'two-regions',
                version: '1',
                pages: data.manifest.pages.map(page => ({
                    pageId: page.id,
                    url: `/page-${String(page.id)}.bin`
                }))
            },
            {
                autoUpdate: false,
                fetch: input => {
                    const id = Number(
                        /page-(\d+)/.exec(input instanceof Request ? input.url : String(input))?.[1]
                    );
                    const bytes = data.payloads[id];
                    if (!bytes) throw new Error('Missing fixture page.');
                    return Promise.resolve(new Response(bytes.slice()));
                }
            }
        );
        const view = await createView(data);
        try {
            const coarse = [manager.acquirePage(1), manager.acquirePage(3)];
            const first = manager.acquirePage(0);
            await pump(
                manager,
                Promise.all([...coarse.map(lease => lease.ready), first.ready]).then(() => {
                    /* Convert the combined readiness result to the manager pump's void contract. */
                })
            );
            await view.capture();
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 3,
                deferredPageCount: 0,
                visibleMeshletCount: 3
            });
            const second = manager.acquirePage(2, { priority: 20 });
            await pump(manager, second.ready);
            await view.capture();
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 3,
                deferredPageCount: 1
            });
            first.release();
            expect(data.meshlets.hasPage(0)).toBe(false);
            expect(data.meshlets.hasPage(1)).toBe(true);
            await view.capture();
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 3,
                deferredPageCount: 0,
                visibleMeshletCount: 3
            });
            second.release();
            await view.capture();
            expect((await view.factory.readDiagnostics()).meshletGeometry).toMatchObject({
                residentPageCount: 2,
                visibleMeshletCount: 2
            });
            expect(data.meshlets.hasPage(1) && data.meshlets.hasPage(3)).toBe(true);
        } finally {
            manager.destroy();
            view.destroy();
        }
    }, 30_000);

    it('routes runtime UV1 and normal-map material swaps to the shared fallback and returns to meshlets', async () => {
        const data = asset();
        const view = await createView(data);
        const normal = new Texture({
            image: new Uint8Array([128, 128, 255, 255]),
            width: 1,
            height: 1
        });
        const color = new Texture({
            image: new Uint8Array([128, 200, 255, 255]),
            width: 1,
            height: 1,
            uv: 1
        });
        try {
            const reference = await view.capture();
            for (const id of [0, 2]) {
                const page = data.pages[id];
                if (!page) throw new Error('Missing fine page.');
                data.meshlets.setPageData(id, page);
            }
            expect(maximumDifference(await view.capture(), reference)).toBeLessThanOrEqual(1);
            expect(
                (await view.factory.readDiagnostics()).meshletGeometry?.visibleMeshletCount
            ).toBe(4);
            expect(() => {
                view.material.setTextureSlot('normal', normal);
            }).toThrow(/does not declare/);
            for (const replacement of [
                new PBRMaterial({
                    baseColor: new Color(0.4, 0.7, 0.9),
                    roughness: 0.8,
                    cullMode: 'none',
                    normalMap: normal
                }),
                new PBRMaterial({
                    baseColor: new Color(0.4, 0.7, 0.9),
                    roughness: 0.8,
                    cullMode: 'none',
                    baseColorMap: color
                })
            ]) {
                view.mesh.material = replacement;
                const shaded = await view.capture();
                let energy = 0;
                for (let pixel = 0; pixel < shaded.length; pixel += 4)
                    energy +=
                        (shaded[pixel] ?? 0) + (shaded[pixel + 1] ?? 0) + (shaded[pixel + 2] ?? 0);
                expect(energy).toBeGreaterThan(1000);
                expect(await view.factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    clusteredDeformedObjectCount: 1,
                    fallbackObjectCount: 0,
                    meshletGeometry: { visibleMeshletCount: 0 }
                });
                view.mesh.material = view.material;
                expect(maximumDifference(await view.capture(), reference)).toBeLessThanOrEqual(1);
                expect(await view.factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    clusteredDeformedObjectCount: 0,
                    fallbackObjectCount: 0,
                    meshletGeometry: { visibleMeshletCount: 4 }
                });
            }
        } finally {
            view.destroy();
            normal.destroy();
            color.destroy();
        }
    }, 30_000);
});
