import { describe, expect, it, vi } from 'vitest';
import {
    BoxGeometry,
    ClusteredForwardPlusPipelineFactory,
    Color,
    DirectionalLight,
    Matrix3,
    Mesh,
    MeshletGeometry,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    Renderer,
    Texture,
    Vector3,
    createMeshletFallbackGeometry,
    encodeMeshletGeometryPage,
    meshletPageChecksum,
    type Geometry,
    type MeshletAssetManifest,
    type MeshletGeometryPage
} from '../../../src/Hilo3d';
import { NEAREST } from '../../../src/constants/webgl';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import ComputeRenderPass from '../../../src/render/pipeline/passes/ComputeRenderPass';
import { MeshletRayGeometry } from '../../../src/render/gi/scene/MeshletRayGeometry';
import type { RHIDevice } from '../../../src/render/rhi/core';

interface StreamedPatch {
    readonly meshlets: MeshletGeometry;
    readonly fallback: Geometry;
    readonly pages: readonly MeshletGeometryPage[];
    install(...ids: readonly number[]): void;
}

/** Both LODs cover the same entire quad; fine uses a center fan instead of dropped triangles. */
function patchPage(centerY: number, fine: boolean): MeshletGeometryPage {
    const points = [
        [-1.5, centerY - 0.625],
        [1.5, centerY - 0.625],
        [1.5, centerY + 0.625],
        [-1.5, centerY + 0.625],
        ...(fine ? [[0, centerY]] : [])
    ];
    const vertices = new Float32Array(
        points.flatMap(([x, y]) => [x ?? 0, y ?? 0, 0, 0, 0, 1, 0.25, 0.25])
    );
    const indices = new Uint32Array(
        fine ? [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4] : [0, 1, 2, 0, 2, 3]
    );
    return {
        vertices,
        indices,
        meshlets: [
            {
                firstIndex: 0,
                indexCount: indices.length,
                bounds: [0, centerY, 0, 2],
                coneApex: [0, centerY, 0],
                coneAxis: [0, 0, 1],
                coneCutoff: 1
            }
        ]
    };
}

function streamedPatch(): StreamedPatch {
    const pages = [-0.625, 0.625].flatMap(center => [
        patchPage(center, true),
        patchPage(center, false)
    ]);
    const manifest: MeshletAssetManifest = {
        version: 1,
        vertexStride: 8,
        groups: [-0.625, 0.625].map((center, id) => ({
            id,
            bounds: [0, center, 0, 2],
            lods: [
                { pageId: id * 2, error: 0 },
                { pageId: id * 2 + 1, error: 0.05 }
            ]
        })),
        pages: pages.map((page, id) => {
            const bytes = encodeMeshletGeometryPage(page);
            return {
                id,
                byteLength: bytes.byteLength,
                vertexCount: page.vertices.length / 8,
                indexCount: page.indices.length,
                meshletCount: page.meshlets.length,
                checksum: meshletPageChecksum(bytes)
            };
        })
    };
    const meshlets = new MeshletGeometry(manifest, {
        maxResidentBytes: 4096,
        // 192-byte table + 288-byte fine page: exactly one fine page can enter each frame.
        maxUploadBytesPerFrame: 480,
        maxVisibleMeshlets: 16,
        maximumProjectedError: 0
    });
    const install = (...ids: readonly number[]): void => {
        for (const id of ids) {
            const page = pages[id];
            if (!page) throw new Error('Missing streamed GI fixture page');
            meshlets.setPageData(id, page);
        }
    };
    install(1, 3);
    return { meshlets, fallback: createMeshletFallbackGeometry(meshlets), pages, install };
}

function totals(bytes: Uint8Array): readonly [number, number, number] {
    const result: [number, number, number] = [0, 0, 0];
    for (let index = 0; index < bytes.length; index += 4) {
        result[0] += bytes[index] ?? 0;
        result[1] += bytes[index + 1] ?? 0;
        result[2] += bytes[index + 2] ?? 0;
    }
    return result;
}

async function fixture(combined: boolean) {
    const emitter = streamedPatch();
    const receiver = combined ? streamedPatch() : null;
    const floorGeometry =
        receiver?.fallback ?? new BoxGeometry({ width: 5, height: 0.2, depth: 5 });
    const floorMaterial = new PBRMaterial({
        baseColor: new Color(0.8, 0.8, 0.8),
        metallic: 0,
        roughness: 1,
        cullMode: 'none'
    });
    const emission = new Texture({
        image: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]),
        width: 2,
        height: 2,
        minFilter: NEAREST,
        magFilter: NEAREST
    });
    const transform = new Matrix3();
    const emitterMaterial = new PBRMaterial({
        baseColor: new Color(0, 0, 0),
        emissionFactor: new Color(3, 3, 3),
        emission: { texture: emission, uvSet: 0, transform },
        metallic: 0,
        roughness: 1,
        cullMode: 'none'
    });
    const casterGeometry = new BoxGeometry({ width: 0.5, height: 0.8, depth: 0.5 });
    const casterMaterial = new PBRMaterial({
        baseColor: new Color(0.45, 0.45, 0.45),
        metallic: 0,
        roughness: 1
    });
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [
            {
                geometry: floorGeometry,
                material: floorMaterial,
                ...(receiver ? { meshlets: receiver.meshlets } : {})
            },
            { geometry: emitter.fallback, material: emitterMaterial, meshlets: emitter.meshlets },
            ...(combined ? [{ geometry: casterGeometry, material: casterMaterial }] : [])
        ],
        maxObjects: 8,
        maxLights: 2,
        maxLightsPerCluster: 2,
        maxLightIndices: 128,
        maxViewportWidth: 32,
        maxViewportHeight: 32,
        bloomStrength: 0,
        hiZ: combined,
        ...(combined
            ? {
                  temporalAA: { sharpness: 0 },
                  groundTruthAmbientOcclusion: {
                      quality: 'low' as const,
                      radius: 0.3,
                      directionCount: 2 as const,
                      stepCount: 4 as const
                  },
                  screenSpaceGlobalIllumination: {
                      rayCount: 4 as const,
                      stepCount: 6 as const,
                      denoisePasses: 1 as const
                  },
                  virtualShadows: {
                      virtualResolution: 512,
                      pageSize: 64,
                      physicalPageCount: 8,
                      maxPageUpdatesPerFrame: 4,
                      directionalClipmapLevels: 2,
                      firstDirectionalClipmapExtent: 8
                  }
              }
            : {}),
        dynamicGlobalIllumination: {
            origin: new Vector3(-1.5, 0.25, -1.5),
            spacing: new Vector3(1, 0.75, 1),
            probeCounts: [4, 3, 4],
            maxProbesPerFrame: 48,
            raysPerProbe: 128,
            maxTriangles: 64,
            maxMeshes: 8,
            maxTextureTexels: 4,
            maxLights: 2,
            maxRayDistance: 12,
            hysteresis: 0,
            environment: new Color(0, 0, 0),
            bounceStrength: 0
        }
    });
    const scene = new Node();
    new Mesh({
        geometry: floorGeometry,
        material: floorMaterial,
        y: combined ? 0 : -0.1,
        rotationX: combined ? -90 : 0
    }).addTo(scene);
    const emitterMesh = new Mesh({
        geometry: emitter.fallback,
        material: emitterMaterial,
        x: -2.2,
        y: 1.3,
        rotationY: 90
    }).addTo(scene);
    if (combined) {
        new Mesh({ geometry: casterGeometry, material: casterMaterial, y: 0.4 }).addTo(scene);
        new DirectionalLight({
            amount: 2.5,
            direction: new Vector3(1, -2, 1),
            shadow: { width: 128, height: 128 }
        }).addTo(scene);
    }
    const canvas = document.createElement('canvas');
    const graphDiagnostics = registerRendererDiagnostics(canvas);
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: canvas,
        width: 32,
        height: 32,
        antialias: false,
        renderingProfile: 'high-end',
        renderPipeline: factory
    });
    renderer.clearColor = new Color(0, 0, 0);
    const target = renderer.createRenderTarget({
        width: 32,
        height: 32,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
    });
    const camera = new PerspectiveCamera({
        aspect: 1,
        near: 0.1,
        far: 12,
        fov: 24,
        depthMode: 'reversed'
    });
    camera.setPosition(0, 2.5, 2.5).lookAt(new Vector3());
    return {
        emitter,
        emitterMesh,
        receiver,
        factory,
        renderer,
        scene,
        camera,
        target,
        transform,
        graphDiagnostics,
        async render(frames = 1): Promise<readonly [number, number, number]> {
            for (let frame = 0; frame < frames; frame++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            return totals((await target.readColorAttachment()).data);
        },
        destroy(): void {
            unregisterRendererDiagnostics(canvas, graphDiagnostics);
            target.destroy();
            scene.destroy(renderer);
            emission.destroy();
            renderer.destroy();
        }
    };
}

describe('Meshlet offscreen dynamic global illumination', () => {
    it('releases retired ray snapshots, preserves a remaining shared instance and rebuilds on reactivation', async () => {
        const view = await fixture(false);
        const material = view.emitterMesh.material;
        if (material === null) throw new Error('Missing emissive fixture material');
        const second = new Mesh({
            geometry: view.emitter.fallback,
            material,
            x: -2.2,
            y: 1.3,
            rotationY: 90
        }).addTo(view.scene);
        const original = Reflect.get(MeshletRayGeometry.prototype, 'resolve');
        const snapshots: Geometry[] = [];
        const resolution = vi
            .spyOn(MeshletRayGeometry.prototype, 'resolve')
            .mockImplementation(function (
                this: MeshletRayGeometry,
                fallback: Geometry,
                remaining: number
            ): Geometry {
                const geometry = original.call(this, fallback, remaining);
                if (this.source.geometry === view.emitter.meshlets) snapshots.push(geometry);
                return geometry;
            });
        const clearing = vi.spyOn(MeshletRayGeometry.prototype, 'clear');
        try {
            view.emitter.install(0, 2);
            await view.render(6);
            const before = await view.factory.readDiagnostics();
            expect(before.dynamicGlobalIllumination?.sceneTriangleCount).toBe(28);
            expect(before.meshletGeometry?.residentPageCount).toBe(4);
            const shared = snapshots.at(-1);
            expect(shared).toBeDefined();
            expect(shared).not.toBe(view.emitter.fallback);
            clearing.mockClear();

            view.emitterMesh.contributeToGlobalIllumination = false;
            await view.render();
            expect(
                (await view.factory.readDiagnostics()).dynamicGlobalIllumination?.sceneTriangleCount
            ).toBe(20);
            expect(snapshots.at(-1)).toBe(shared);
            expect(clearing).not.toHaveBeenCalled();

            // The remaining shared instance is filtered before the ray resolver. A live GPU
            // page table alone must not retain the independent CPU ray extraction indefinitely.
            view.camera.visibility = 1;
            second.layer = 2;
            await view.render();
            expect(
                (await view.factory.readDiagnostics()).dynamicGlobalIllumination?.sceneTriangleCount
            ).toBe(12);
            expect(clearing).toHaveBeenCalledTimes(1);

            view.emitterMesh.contributeToGlobalIllumination = true;
            await view.render(2);
            const reactivated = snapshots.at(-1);
            expect(reactivated).toBeDefined();
            expect(reactivated).not.toBe(shared);
            expect(reactivated).not.toBe(view.emitter.fallback);
            expect(
                (await view.factory.readDiagnostics()).dynamicGlobalIllumination?.sceneTriangleCount
            ).toBe(20);

            view.emitterMesh.removeFromParent();
            await view.render();
            expect(
                (await view.factory.readDiagnostics()).dynamicGlobalIllumination?.sceneTriangleCount
            ).toBe(12);
            expect(clearing).toHaveBeenCalledTimes(2);
            second.layer = 1;
            const recovered = await view.render(4);
            const after = await view.factory.readDiagnostics();
            expect(after.dynamicGlobalIllumination?.sceneTriangleCount).toBe(20);
            expect(after.meshletGeometry?.residentPageCount).toBe(4);
            expect(after.meshletGeometry?.uploadedBytes).toBe(
                before.meshletGeometry?.uploadedBytes
            );
            expect(snapshots.at(-1)).not.toBe(reactivated);
            expect(recovered[0]).toBeGreaterThan(500);
            expect(recovered[0]).toBeGreaterThan(recovered[2] * 1.4);
            expect(second.geometry).toBe(view.emitter.fallback);
        } finally {
            view.emitterMesh.addTo(view.scene);
            view.destroy();
            resolution.mockRestore();
            clearing.mockRestore();
        }
    }, 120_000);

    it('tracks submitted complete LODs in textured offscreen transport, rollback, eviction and recovery', async () => {
        const view = await fixture(false);
        try {
            view.factory.setDynamicGlobalIlluminationIntensity(0);
            const disabled = await view.render(3);
            // No direct lights and the textured emitter is outside the camera: visible energy
            // must come from the offscreen ray scene, not a screen-space hit or emissive pixel.
            expect(disabled[0] + disabled[1] + disabled[2]).toBeLessThan(50);
            view.factory.setDynamicGlobalIlluminationIntensity(1);
            const red = await view.render(6);
            expect(red[0]).toBeGreaterThan(500);
            expect(red[0]).toBeGreaterThan(red[2] * 1.4);
            const before = await view.factory.readDiagnostics();
            expect(before.dynamicGlobalIllumination?.sceneTriangleCount).toBe(16);
            expect(before.meshletGeometry?.residentPageCount).toBe(2);

            view.emitter.install(0, 2);
            expect(view.emitter.meshlets.hasPage(0) && view.emitter.meshlets.hasPage(2)).toBe(true);
            const original = Object.getOwnPropertyDescriptor(ComputeRenderPass.prototype, 'execute')
                ?.value as (
                this: ComputeRenderPass,
                ...args: Parameters<ComputeRenderPass['execute']>
            ) => void;
            let failed = false;
            const injection = vi
                .spyOn(ComputeRenderPass.prototype, 'execute')
                .mockImplementation(function (
                    this: ComputeRenderPass,
                    ...args: Parameters<ComputeRenderPass['execute']>
                ): void {
                    if (!failed && this.name === 'DDGI BVH ray queries and probe integration') {
                        failed = true;
                        throw new Error('injected meshlet DDGI frame failure');
                    }
                    original.apply(this, args);
                });
            try {
                expect(() => {
                    view.renderer.renderToTarget(view.target, view.scene, view.camera);
                }).toThrow(/injected meshlet DDGI frame failure/u);
            } finally {
                injection.mockRestore();
            }
            expect(failed).toBe(true);
            const discarded = await view.factory.readDiagnostics();
            expect(discarded.dynamicGlobalIllumination?.submittedFrameCount).toBe(
                before.dynamicGlobalIllumination?.submittedFrameCount
            );
            expect(discarded.dynamicGlobalIllumination?.sceneTriangleCount).toBe(16);
            expect(discarded.meshletGeometry?.residentPageCount).toBe(2);

            await view.render();
            const partial = await view.factory.readDiagnostics();
            expect(partial.meshletGeometry?.residentPageCount).toBe(3);
            expect(partial.meshletGeometry?.lastUploadBytes).toBeLessThanOrEqual(480);
            expect(partial.dynamicGlobalIllumination?.sceneTriangleCount).toBe(18);
            await view.render();
            const full = await view.factory.readDiagnostics();
            expect(full.meshletGeometry?.residentPageCount).toBe(4);
            expect(full.dynamicGlobalIllumination?.sceneTriangleCount).toBe(20);

            view.transform.elements[7] = 0.5;
            const blue = await view.render(6);
            expect(blue[2]).toBeGreaterThan(blue[0] * 1.4);
            expect(blue[2]).toBeGreaterThan(500);
            view.emitter.meshlets.evictPage(0);
            view.emitter.meshlets.evictPage(2);
            const coarse = await view.render(4);
            expect(
                (await view.factory.readDiagnostics()).dynamicGlobalIllumination?.sceneTriangleCount
            ).toBe(16);
            expect(coarse[2]).toBeGreaterThan(blue[2] * 0.65);
            view.emitter.meshlets.evictPage(1);
            const completeFallback = await view.render(4);
            expect(
                (await view.factory.readDiagnostics()).dynamicGlobalIllumination?.sceneTriangleCount
            ).toBe(16);
            expect(completeFallback[2]).toBeGreaterThan(blue[2] * 0.65);
            view.emitter.install(1, 0, 2);
            await view.render(6);

            const extension = view.renderer.getExtension('rhi') as {
                readonly device: RHIDevice;
            } | null;
            if (!extension) throw new Error('Expected the checked RHI recovery extension');
            const lost = new Promise<void>(resolve => {
                view.renderer.on(
                    'webgpuDeviceLost',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            const restored = new Promise<void>(resolve => {
                view.renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            extension.device.destroy();
            await lost;
            await Promise.all([view.renderer.waitForIdle(), restored]);
            const recovered = await view.render(8);
            const recoveredDiagnostics = await view.factory.readDiagnostics();
            expect(recoveredDiagnostics.dynamicGlobalIllumination?.sceneTriangleCount).toBe(20);
            expect(recoveredDiagnostics.meshletGeometry?.residentPageCount).toBe(4);
            expect(recovered[2]).toBeGreaterThan(recovered[0] * 1.4);
            expect(recovered[2]).toBeGreaterThan(blue[2] * 0.65);
        } finally {
            view.destroy();
        }
    }, 120_000);

    it('renders meshlet receivers through combined DDGI, virtual shadows, TAA, GTAO and SSGI hybrid surfaces', async () => {
        const view = await fixture(true);
        try {
            expect(
                view.factory.requirements.requiredLimits?.['maxStorageBuffersPerShaderStage']
            ).toBeGreaterThanOrEqual(10);
            view.emitter.install(0, 2);
            view.receiver?.install(0, 2);
            view.factory.setDynamicGlobalIlluminationIntensity(0);
            const off = await view.render(20);
            view.factory.setDynamicGlobalIlluminationIntensity(1);
            const on = await view.render(24);
            expect(on[0]).toBeGreaterThan(off[0] + 200);
            const diagnostics = await view.factory.readDiagnostics();
            expect(diagnostics.meshletGeometry?.visibleMeshletCount).toBeGreaterThan(0);
            expect(diagnostics.dynamicGlobalIllumination?.sceneTriangleCount).toBe(28);
            expect(diagnostics.dynamicGlobalIllumination?.tracedRayCount).toBeGreaterThan(0);
            expect(diagnostics.virtualShadows?.requestedPageCount).toBeGreaterThan(0);
            expect(diagnostics.virtualShadows?.residentPageCount).toBeGreaterThan(0);
            const passes =
                view.graphDiagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
            expect(passes).toContain('DDGI hybrid surface data');
            expect(passes).toContain('Virtual shadow receiver depth page requests');
            view.factory.setDynamicGlobalIlluminationIntensity(0);
            const offAgain = await view.render(24);
            expect(offAgain[0]).toBeLessThan(on[0] - 200);
        } finally {
            view.destroy();
        }
    }, 120_000);
});
