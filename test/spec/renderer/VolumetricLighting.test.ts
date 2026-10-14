import { describe, expect, it, vi } from 'vitest';
import type { CameraDepthMode } from '../../../src/camera/Camera';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Mesh from '../../../src/core/Mesh';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import Skeleton from '../../../src/core/Skeleton';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import Matrix4 from '../../../src/math/Matrix4';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import DirectionalLight from '../../../src/light/DirectionalLight';
import SpotLight from '../../../src/light/SpotLight';
import PointLight from '../../../src/light/PointLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import { ComputeRenderPass } from '../../../src/render/pipeline/passes';
import type { RHIDevice } from '../../../src/render/rhi/core';

type Kind = 'directional' | 'spot' | 'point';
interface Fixture {
    readonly renderer: Renderer;
    readonly target: RenderTarget;
    readonly factory: ClusteredForwardPlusPipelineFactory;
    readonly scene: Node;
    readonly camera: PerspectiveCamera;
    readonly caster: Mesh;
    readonly light: DirectionalLight | SpotLight | PointLight;
    readonly mediumCenter: Vector3;
    readonly joint: Node | null;
    readonly morph: MorphGeometry | null;
    render(): Promise<Uint8Array>;
}

async function withFixture(
    kind: Kind,
    depthMode: CameraDepthMode,
    run: (fixture: Fixture) => Promise<void>,
    deformed = false
): Promise<void> {
    const geometry = new BoxGeometry();
    const material = new PBRMaterial();
    const mediumCenter = new Vector3(0, 0, 0);
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [{ geometry, material }],
        maxObjects: 2,
        maxLights: 2,
        maxLightIndices: 512,
        maxLightsPerCluster: 2,
        maxViewportWidth: 32,
        maxViewportHeight: 32,
        tileSize: 8,
        zSlices: 16,
        hiZ: false,
        bloomStrength: 0,
        volumetricLighting: {
            resolutionScale: 1,
            shadowSteps: 0,
            density: 0.15,
            heightFalloff: 0,
            maxDistance: 8,
            ambientStrength: 0,
            anisotropy: 0,
            jitterStrength: 0,
            historyWeight: 0.9,
            debugView: 'radiance',
            albedo: new Color(1, 1, 1),
            localVolumes: [{ shape: 'sphere', center: mediumCenter, radius: 2, density: 0.05 }]
        }
    });
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: document.createElement('canvas'),
        width: 32,
        height: 32,
        antialias: false,
        renderingProfile: depthMode === 'standard' ? 'portable' : 'high-end',
        shadowUpdateMode: 'full',
        renderPipeline: factory
    });
    const target = renderer.createRenderTarget({
        width: 32,
        height: 32,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode }
    });
    try {
        const scene = new Node();
        // This long slab is entirely to the camera's right, casting into the upper half of the air.
        // The main depth texture remains empty, so a screen-space march cannot produce this shadow.
        let joint: Node | null = null;
        let morph: MorphGeometry | null = null;
        let caster: Mesh;
        if (deformed) {
            const vertices = geometry.vertices;
            if (vertices === null) throw new Error('Expected caster positions');
            const delta = new Float32Array(vertices.count * 3);
            const weights = new Float32Array(vertices.count * 4);
            for (let index = 0; index < vertices.count; index++) {
                delta[index * 3] = 16;
                delta[index * 3 + 1] = -1;
                weights[index * 4] = 1;
            }
            morph = new MorphGeometry({
                vertices,
                normals: geometry.normals,
                indices: geometry.indices,
                skinIndices: new GeometryData(new Uint8Array(vertices.count * 4), 4),
                skinWeights: new GeometryData(weights, 4),
                targets: { vertices: [new GeometryData(delta, 3)] },
                weights: [0]
            });
            joint = new Node({ x: 16 });
            caster = new SkinnedMesh({
                geometry: morph,
                material,
                skeleton: new Skeleton({
                    jointNodeList: [joint],
                    inverseBindMatrices: [new Matrix4()]
                }),
                y: 1,
                scaleX: 0.25,
                scaleY: 2,
                scaleZ: 12,
                castShadows: false
            }).addTo(scene);
            joint.addTo(caster);
        } else {
            caster = new Mesh({
                geometry,
                material,
                x: 4,
                y: 1,
                scaleX: 0.25,
                scaleY: 2,
                scaleZ: 12,
                castShadows: false
            }).addTo(scene);
        }
        const shadow = { width: 128, height: 128, minBias: 0.0001, maxBias: 0.0001 };
        const light =
            kind === 'directional'
                ? new DirectionalLight({
                      amount: 12,
                      direction: new Vector3(-1, 0, 0),
                      shadow: {
                          ...shadow,
                          cascadeCount: 4,
                          cascadeMaxDistance: 8,
                          cascadeBlend: 0.2
                      }
                  })
                : kind === 'spot'
                  ? new SpotLight({
                        amount: 12,
                        x: 8,
                        direction: new Vector3(-1, 0, 0),
                        range: 20,
                        constantAttenuation: 1,
                        linearAttenuation: 0,
                        quadraticAttenuation: 0,
                        cutoff: 65,
                        outerCutoff: 75,
                        shadow
                    })
                  : new PointLight({
                        amount: 12,
                        x: 8,
                        range: 20,
                        constantAttenuation: 1,
                        linearAttenuation: 0,
                        quadraticAttenuation: 0,
                        shadow
                    });
        light.addTo(scene);
        const camera = new PerspectiveCamera({ aspect: 1, fov: 40, near: 0.1, far: 8, depthMode });
        camera.setPosition(0, 0, 4).lookAt(new Vector3(0, 0, 0));
        await run({
            renderer,
            target,
            factory,
            scene,
            camera,
            caster,
            light,
            mediumCenter,
            joint,
            morph,
            async render(): Promise<Uint8Array> {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                return (await target.readColorAttachment()).data;
            }
        });
    } finally {
        target.destroy();
        renderer.destroy();
    }
}

function regionEnergy(data: Uint8Array, firstRow: number, lastRow: number): number {
    let total = 0;
    for (let y = firstRow; y < lastRow; y += 1) {
        for (let x = 4; x < 28; x += 1) {
            const offset = (y * 32 + x) * 4;
            total += (data[offset] ?? 0) + (data[offset + 1] ?? 0) + (data[offset + 2] ?? 0);
        }
    }
    return total / ((lastRow - firstRow) * 24 * 3);
}

describe('Volumetric shared-atlas shadows', () => {
    it.each(['standard', 'reversed'] as const)(
        'shadows offscreen asymmetric CSM casters with %s depth',
        async depthMode => {
            await withFixture('directional', depthMode, async fixture => {
                const unoccluded = await fixture.render();
                await fixture.render();
                expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(true);
                fixture.caster.castShadows = true;
                const shadowed = await fixture.render();
                const diagnostics = await fixture.factory.readDiagnostics();
                expect(fixture.caster.x - 0.125).toBeGreaterThan(
                    (fixture.camera.far ?? Infinity) * Math.tan(Math.PI / 9)
                );
                expect(diagnostics.volumetricHistoryUsed).toBe(false);
                const upperDelta = regionEnergy(unoccluded, 2, 12) - regionEnergy(shadowed, 2, 12);
                const lowerDelta =
                    regionEnergy(unoccluded, 20, 30) - regionEnergy(shadowed, 20, 30);
                expect(upperDelta).toBeGreaterThan(15);
                expect(Math.abs(lowerDelta)).toBeLessThan(upperDelta * 0.25);
                fixture.caster.y = -1;
                const moved = await fixture.render();
                expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(false);
                expect(regionEnergy(moved, 2, 12)).toBeGreaterThan(
                    regionEnergy(shadowed, 2, 12) + 15
                );
                expect(regionEnergy(moved, 20, 30)).toBeLessThan(
                    regionEnergy(shadowed, 20, 30) - 15
                );
            });
        },
        60_000
    );

    it.each(['spot', 'point'] as const)(
        'uses the correct %s atlas matrix and face for offscreen blockers',
        async kind => {
            await withFixture(kind, 'reversed', async fixture => {
                const unoccluded = await fixture.render();
                fixture.caster.castShadows = true;
                const shadowed = await fixture.render();
                expect(fixture.caster.x - 0.125).toBeGreaterThan(
                    (fixture.camera.far ?? Infinity) * Math.tan(Math.PI / 9)
                );
                expect(
                    regionEnergy(unoccluded, 2, 12) - regionEnergy(shadowed, 2, 12)
                ).toBeGreaterThan(15);
                expect(
                    Math.abs(regionEnergy(unoccluded, 20, 30) - regionEnergy(shadowed, 20, 30))
                ).toBeLessThan(5);
            });
        },
        60_000
    );

    it('extends offscreen caster coverage for combined morph and skin poses without bind-pose clipping', async () => {
        await withFixture(
            'directional',
            'reversed',
            async fixture => {
                const unoccluded = await fixture.render();
                fixture.caster.castShadows = true;
                const upper = await fixture.render();
                expect(
                    regionEnergy(unoccluded, 2, 12) - regionEnergy(upper, 2, 12)
                ).toBeGreaterThan(15);
                if (fixture.morph === null || fixture.joint === null)
                    throw new Error('Expected deformed fixture');
                fixture.morph.weights[0] = 1;
                const lower = await fixture.render();
                expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(false);
                expect(regionEnergy(lower, 2, 12)).toBeGreaterThan(regionEnergy(upper, 2, 12) + 15);
                expect(regionEnergy(lower, 20, 30)).toBeLessThan(regionEnergy(upper, 20, 30) - 15);
                fixture.joint.x = 24;
                fixture.joint.y = 1;
                const reskinned = await fixture.render();
                expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(false);
                expect(regionEnergy(reskinned, 2, 12)).toBeLessThan(
                    regionEnergy(lower, 2, 12) - 15
                );
                expect(regionEnergy(reskinned, 20, 30)).toBeGreaterThan(
                    regionEnergy(lower, 20, 30) + 15
                );
            },
            true
        );
    }, 60_000);

    it('commits light/medium history only on submission and reinitializes after actual device recovery', async () => {
        await withFixture('directional', 'reversed', async fixture => {
            await fixture.render();
            await fixture.render();
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(true);
            fixture.light.amount = 6;
            await fixture.render();
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(false);
            await fixture.render();
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(true);
            fixture.mediumCenter.x = 1;
            const execute = Object.getOwnPropertyDescriptor(ComputeRenderPass.prototype, 'execute')
                ?.value as (
                this: ComputeRenderPass,
                ...args: Parameters<ComputeRenderPass['execute']>
            ) => void;
            const failure = vi
                .spyOn(ComputeRenderPass.prototype, 'execute')
                .mockImplementation(function (
                    this: ComputeRenderPass,
                    ...args: Parameters<ComputeRenderPass['execute']>
                ): void {
                    if (this.name === 'Volumetric lighting initialize temporal history')
                        throw new Error('injected volumetric submission failure');
                    execute.apply(this, args);
                });
            try {
                expect(() => {
                    fixture.renderer.renderToTarget(fixture.target, fixture.scene, fixture.camera);
                }).toThrow('injected volumetric submission failure');
            } finally {
                failure.mockRestore();
            }
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(true);
            await fixture.render();
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(false);
            await fixture.render();
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(true);
            const extension = fixture.renderer.getExtension('rhi') as {
                readonly device: RHIDevice;
            } | null;
            if (extension === null) throw new Error('Expected RHI extension');
            const lost = new Promise<void>(resolve => {
                fixture.renderer.on(
                    'webgpuDeviceLost',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            const restored = new Promise<void>(resolve => {
                fixture.renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            extension.device.destroy();
            await lost;
            await Promise.all([fixture.renderer.waitForIdle(), restored]);
            const recovered = await fixture.render();
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(false);
            expect(regionEnergy(recovered, 2, 30)).toBeGreaterThan(20);
            await fixture.render();
            expect((await fixture.factory.readDiagnostics()).volumetricHistoryUsed).toBe(true);
        });
    }, 60_000);
});
