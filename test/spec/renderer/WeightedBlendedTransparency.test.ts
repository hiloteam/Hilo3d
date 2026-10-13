import { describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Texture from '../../../src/texture/Texture';
import { NEAREST } from '../../../src/constants/webgl';
import DirectionalLight from '../../../src/light/DirectionalLight';
import Vector3 from '../../../src/math/Vector3';
import { DecalProjector } from '../../../src/render/decals/DecalProjector';
import PointLight from '../../../src/light/PointLight';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import {
    ForwardRenderPipelineFactory,
    type ForwardRenderPipelineFeature
} from '../../../src/render/pipeline/ForwardRenderPipeline';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

function layer(color: Color, z = 0): Mesh {
    return new Mesh({
        geometry: new PlaneGeometry({ width: 2, height: 2 }),
        material: new BasicMaterial({
            lightType: 'NONE',
            diffuse: color,
            compositing: { mode: 'weighted-blended' },
            opacity: 0.5
        }),
        z
    });
}

async function center(target: RenderTarget): Promise<number[]> {
    const result = await target.readColorAttachment();
    const offset =
        (Math.floor(result.height / 2) * result.width + Math.floor(result.width / 2)) *
        result.bytesPerPixel;
    const view = new DataView(
        result.data.buffer,
        result.data.byteOffset + offset,
        result.bytesPerPixel
    );
    return Array.from({ length: 4 }, (_, index) =>
        result.format === 'rgba32float' ? view.getFloat32(index * 4, true) : view.getUint8(index)
    );
}

function close(actual: number[], expected: number[]): void {
    for (const [index, value] of expected.entries()) expect(actual[index]).toBeCloseTo(value, 2);
}

describe('weighted transparency policy', () => {
    it('classifies alpha, additive, transmission and weighted surfaces explicitly', () => {
        expect(new BasicMaterial().transparencyClass).toBe('opaque');
        expect(
            new BasicMaterial({ compositing: { mode: 'alpha-blend', premultiplied: false } })
                .transparencyClass
        ).toBe('sorted-alpha');
        expect(
            new BasicMaterial({ compositing: { mode: 'additive', premultiplied: false } })
                .transparencyClass
        ).toBe('additive');
        expect(new PBRMaterial({ transmissionFactor: 1 }).transparencyClass).toBe('transmission');
        expect(
            new PBRMaterial({ compositing: { mode: 'weighted-blended' } }).transparencyClass
        ).toBe('weighted-blended');
        expect(
            () =>
                new PBRMaterial({
                    transmissionFactor: 1,
                    compositing: { mode: 'weighted-blended' }
                })
        ).toThrow(/without transmission/u);
        expect(
            () =>
                new ForwardRenderPipelineFactory({
                    weightedBlendedTransparency: { maxPixelCount: 0 }
                })
        ).toThrow(/maxPixelCount/u);
        expect(
            () =>
                new ForwardRenderPipelineFactory({
                    weightedBlendedTransparency: true,
                    sceneColorFormat: 'rgba8unorm'
                })
        ).toThrow(/rgba16float/u);
        expect(
            new ForwardRenderPipelineFactory({ weightedBlendedTransparency: true }).requirements
                .requiredTextureFormats
        ).toContainEqual({ format: 'r16float', use: 'blendable-color-attachment' });
    });
});

describe.each(['webgl2', 'webgpu'] as const)('weighted transparency through %s', backend => {
    it.each(['standard', 'reversed'] as const)(
        'preserves HDR, alpha and opaque visibility independently of order with %s depth',
        async depthMode => {
            const canvas = document.createElement('canvas');
            registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend,
                width: 16,
                height: 16,
                antialias: false,
                domElement: canvas,
                renderPipeline: new ForwardRenderPipelineFactory({
                    weightedBlendedTransparency: true
                })
            });
            const target = renderer.createRenderTarget({
                width: 16,
                height: 16,
                colorAttachments: [
                    { format: 'rgba32float', clearValue: { r: 0, g: 0, b: 0, a: 0 } }
                ],
                depthStencilAttachment: { depthMode }
            });
            const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10, depthMode });
            const scene = new Node();
            const red = layer(new Color(4, 0, 0));
            const blue = layer(new Color(0, 0, 2), -0.25);
            red.addTo(scene);
            blue.addTo(scene);
            try {
                renderer.renderToTarget(target, scene, camera);
                close(await center(target), [1.5, 0, 0.75, 0.75]);
                scene.removeChild(red);
                scene.addChild(red);
                renderer.renderToTarget(target, scene, camera);
                close(await center(target), [1.5, 0, 0.75, 0.75]);
                const opaque = new Mesh({
                    geometry: new PlaneGeometry({ width: 2, height: 2 }),
                    material: new BasicMaterial({ lightType: 'NONE', diffuse: new Color(0, 2, 0) }),
                    z: 0.5
                });
                opaque.addTo(scene);
                renderer.renderToTarget(target, scene, camera);
                close(await center(target), [0, 2, 0, 1]);
                opaque.removeFromParent();
                const sorted = new Mesh({
                    geometry: new PlaneGeometry({ width: 2, height: 2 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        diffuse: new Color(0, 2, 0),
                        opacity: 0.5,
                        compositing: { mode: 'alpha-blend', premultiplied: false }
                    }),
                    z: 0.5
                });
                sorted.addTo(scene);
                renderer.renderToTarget(target, scene, camera);
                close(await center(target), [0.75, 1, 0.375, 0.875]);
                sorted.removeFromParent();
                if (red.material !== null) red.material.opacity = 0;
                if (blue.material !== null) blue.material.opacity = 0;
                renderer.renderToTarget(target, scene, camera);
                close(await center(target), [0, 0, 0, 0]);
            } finally {
                target.destroy();
                renderer.destroy();
            }
        }
    );

    it('rebuilds after release/resize, rolls back discarded work and omits empty queues', async () => {
        let fail = false;
        const failureFeature: ForwardRenderPipelineFeature = {
            name: 'test discard after weighted composition',
            injectionPoint: 'after-transparent',
            requirements: { sampledSceneColor: false, sampledDepth: false },
            create: () => ({
                record: () => {
                    if (fail) throw new Error('discard weighted frame');
                },
                destroy: () => {
                    /* No feature-owned resources. */
                }
            })
        };
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend,
            width: 16,
            height: 16,
            antialias: false,
            domElement: canvas,
            renderPipeline: new ForwardRenderPipelineFactory({
                weightedBlendedTransparency: { maxPixelCount: 256 },
                features: [failureFeature]
            })
        });
        let target = renderer.createRenderTarget({
            width: 16,
            height: 16,
            colorAttachments: [{ format: 'rgba32float', clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
        });
        const identity = target.getColorTexture();
        const scene = new Node();
        const mesh = layer(new Color(4, 0, 0));
        mesh.addTo(scene);
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.renderToTarget(target, scene, camera);
            close(await center(target), [2, 0, 0, 0.5]);
            fail = true;
            expect(() => {
                renderer.renderToTarget(target, scene, camera);
            }).toThrow(/failed at after-transparent/u);
            fail = false;
            renderer.renderToTarget(target, scene, camera);
            close(await center(target), [2, 0, 0, 0.5]);
            target.resize(8, 8);
            renderer.renderToTarget(target, scene, camera);
            close(await center(target), [2, 0, 0, 0.5]);
            expect(target.getColorTexture()).toBe(identity);
            renderer.releaseGPUResources();
            expect(target.isDestroyed).toBe(true);
            target = renderer.createRenderTarget({
                width: 8,
                height: 8,
                colorAttachments: [
                    { format: 'rgba32float', clearValue: { r: 0, g: 0, b: 0, a: 0 } }
                ]
            });
            renderer.renderToTarget(target, scene, camera);
            close(await center(target), [2, 0, 0, 0.5]);
            target.resize(17, 17);
            expect(() => {
                renderer.renderToTarget(target, scene, camera);
            }).toThrow(/maxPixelCount/u);
            target.resize(8, 8);
            mesh.visible = false;
            renderer.renderToTarget(target, scene, camera);
            close(await center(target), [0, 0, 0, 0]);
            expect(
                diagnostics
                    .snapshot()
                    .renderGraph?.passes.some(pass => pass.name.includes('Weighted transparency'))
            ).toBe(false);
        } finally {
            unregisterRendererDiagnostics(canvas);
            target.destroy();
            renderer.destroy();
        }
    });

    it('retains asymmetric texture rows in planner-instanced particle quads', async () => {
        const renderer = await Renderer.create({
            backend,
            width: 16,
            height: 16,
            antialias: false,
            useInstanced: true,
            domElement: document.createElement('canvas'),
            renderPipeline: new ForwardRenderPipelineFactory({
                weightedBlendedTransparency: true,
                opaqueTexture: true
            })
        });
        const target = renderer.createRenderTarget({
            width: 16,
            height: 16,
            colorAttachments: [{ format: 'rgba32float', clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
        });
        const image = new Texture({
            width: 1,
            height: 2,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
        });
        const material = new BasicMaterial({
            lightType: 'NONE',
            diffuse: image,
            opacity: 0.5,
            compositing: { mode: 'weighted-blended' }
        });
        const geometry = new PlaneGeometry({ width: 2, height: 2 });
        geometry.uvs = new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
        const scene = new Node();
        new Mesh({ geometry, material, useInstanced: true }).addTo(scene);
        new Mesh({ geometry, material, useInstanced: true, z: -0.1 }).addTo(scene);
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.renderToTarget(target, scene, camera);
            const result = await target.readColorAttachment();
            const values = new Float32Array(
                result.data.buffer,
                result.data.byteOffset,
                result.data.byteLength / 4
            );
            const top = (4 * result.width + 8) * 4;
            const bottom = (12 * result.width + 8) * 4;
            expect(values[top]).toBeCloseTo(0.75, 2);
            expect(values[top + 2]).toBeCloseTo(0, 2);
            expect(values[bottom]).toBeCloseTo(0, 2);
            expect(values[bottom + 2]).toBeCloseTo(0.75, 2);
            expect(values[top + 3]).toBeCloseTo(0.75, 2);
        } finally {
            target.destroy();
            renderer.destroy();
            image.destroy();
        }
    });

    it('rejects a weighted material without pipeline opt-in', async () => {
        const canvas = document.createElement('canvas');
        registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend,
            width: 8,
            height: 8,
            antialias: false,
            domElement: document.createElement('canvas')
        });
        const target = renderer.createRenderTarget({ width: 8, height: 8 });
        try {
            expect(() => {
                renderer.renderToTarget(
                    target,
                    new Node().addChild(layer(new Color(1, 0, 0))),
                    new OrthographicCamera({ z: 3, near: 0.1, far: 10 })
                );
            }).toThrow(/weighted-blended transparency pipeline/u);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    });
});

describe('native clustered weighted transparency', () => {
    it('shades overlapping PBR layers with clustered lights and preserves submission-aware temporal composition', async () => {
        const geometry = new PlaneGeometry({ width: 2, height: 2 });
        const opaque = new PBRMaterial({ metallic: 0, roughness: 1 });
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material: opaque }],
            weightedBlendedTransparency: true,
            temporalAA: { renderScale: 0.5 },
            hiZ: false,
            maxObjects: 8,
            maxLights: 16,
            maxLightIndices: 128,
            maxLightsPerCluster: 16,
            maxViewportWidth: 16,
            maxViewportHeight: 16,
            bloomStrength: 0
        });
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend: 'webgpu',
            width: 16,
            height: 16,
            antialias: false,
            domElement: canvas,
            renderPipeline: factory
        });
        renderer.clearColor = new Color(0, 0, 0);
        const target = renderer.createRenderTarget({ width: 16, height: 16 });
        const scene = new Node();
        const mesh = new Mesh({
            geometry,
            material: new PBRMaterial({
                baseColor: new Color(1, 0.1, 0),
                metallic: 0,
                roughness: 1,
                opacity: 0.5,
                compositing: { mode: 'weighted-blended' }
            })
        });
        mesh.addTo(scene);
        const light = new PointLight({ z: 2, amount: 50, range: 10 });
        light.addTo(scene);
        const camera = new PerspectiveCamera({ z: 3, near: 0.1, far: 10, aspect: 1 });
        try {
            for (let index = 0; index < 2; index++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            const lit = await center(target);
            expect(lit[0]).toBeGreaterThan(80);
            const names = diagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
            expect(
                names.filter(name => name === 'Weighted transparency HDR accumulation')
            ).toHaveLength(2);
            expect(names).toContain('Weighted transparency HDR composition');
            light.amount = 0;
            for (let index = 0; index < 3; index++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            expect((await center(target))[0]).toBeLessThan((lit[0] ?? 0) * 0.75);
        } finally {
            unregisterRendererDiagnostics(canvas);
            target.destroy();
            renderer.destroy();
        }
    }, 30000);
});

describe('weighted transparency context recovery', () => {
    it('rebuilds graph attachments after real WebGL context loss without changing public target identity', async () => {
        const canvas = document.createElement('canvas');
        const renderer = await Renderer.create({
            backend: 'webgl2',
            width: 8,
            height: 8,
            antialias: false,
            domElement: canvas,
            renderPipeline: new ForwardRenderPipelineFactory({ weightedBlendedTransparency: true })
        });
        const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
        if (extension === undefined || extension === null)
            throw new Error('Context-loss test extension unavailable');
        const target = renderer.createRenderTarget({ width: 8, height: 8 });
        const texture = target.getColorTexture();
        const scene = new Node().addChild(layer(new Color(1, 0, 0)));
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.renderToTarget(target, scene, camera);
            const before = (await target.readColorAttachment()).data.slice();
            const lost = new Promise<Event>(resolve => {
                canvas.addEventListener('webglcontextlost', resolve, { once: true });
            });
            extension.loseContext();
            const event = await lost;
            expect(event.defaultPrevented).toBe(true);
            await new Promise<void>(resolve => {
                globalThis.setTimeout(resolve, 0);
            });
            extension.restoreContext();
            await vi.waitFor(
                () => {
                    expect(renderer.isReady).toBe(true);
                },
                { timeout: 5000 }
            );
            renderer.renderToTarget(target, scene, camera);
            expect((await target.readColorAttachment()).data).toEqual(before);
            expect(target.getColorTexture()).toBe(texture);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    }, 15000);
});

describe('combined production surface effects', () => {
    it('renders decal-bearing direct PBR with DDGI, GTAO, cloud visibility, fog and weighted transparency', async () => {
        const geometry = new PlaneGeometry({ width: 2, height: 2 });
        const bucketMaterial = new PBRMaterial({ metallic: 0, roughness: 1 });
        const projector = new DecalProjector({ color: new Color(1, 0, 0), edgeFade: 0 });
        const receiver = new PBRMaterial({
            metallic: 0,
            roughness: 1,
            decals: {
                projectors: [projector],
                baseColorAtlas: new Texture({
                    width: 1,
                    height: 1,
                    image: new Uint8Array([255, 255, 255, 255]),
                    minFilter: NEAREST,
                    magFilter: NEAREST
                })
            }
        });
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material: bucketMaterial }],
            maxObjects: 8,
            maxLights: 4,
            maxLightIndices: 128,
            maxLightsPerCluster: 4,
            maxViewportWidth: 16,
            maxViewportHeight: 16,
            hiZ: false,
            bloomStrength: 0,
            weightedBlendedTransparency: true,
            temporalAA: {},
            groundTruthAmbientOcclusion: { quality: 'low' },
            screenSpaceGlobalIllumination: { rayCount: 4, stepCount: 6, denoisePasses: 1 },
            atmosphere: { quality: 'low' },
            volumetricLighting: { quality: 'low' },
            dynamicGlobalIllumination: {
                origin: new Vector3(-1, -1, -1),
                spacing: new Vector3(2, 2, 2),
                probeCounts: [2, 2, 2],
                maxProbesPerFrame: 8,
                raysPerProbe: 64,
                maxTriangles: 8,
                maxMeshes: 4,
                maxTextureTexels: 4,
                maxRayDistance: 5,
                hysteresis: 0
            }
        });
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend: 'webgpu',
            width: 16,
            height: 16,
            antialias: false,
            useInstanced: true,
            domElement: canvas,
            renderPipeline: factory
        });
        renderer.clearColor = new Color(0, 0, 0);
        const target = renderer.createRenderTarget({ width: 16, height: 16 });
        const scene = new Node();
        new Mesh({ geometry, material: receiver, z: -0.2, useInstanced: true }).addTo(scene);
        new Mesh({ geometry, material: receiver, z: -0.2, x: 1.5, useInstanced: true }).addTo(
            scene
        );
        new DirectionalLight({ direction: new Vector3(0, 0, -1), amount: 3 }).addTo(scene);
        const particle = layer(new Color(0, 1, 0), 0);
        particle.contributeToGlobalIllumination = false;
        particle.x = 1.5;
        particle.addTo(scene);
        const camera = new PerspectiveCamera({ z: 2, near: 0.1, far: 10, aspect: 1 });
        try {
            for (let index = 0; index < 2; index++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            const red = await center(target);
            expect((await factory.readDiagnostics()).dynamicGlobalIllumination).toMatchObject({
                excludedMeshCount: 1,
                sceneTriangleCount: 4,
                exclusions: { disabled: 1, material: 0 }
            });
            expect(red[0]).toBeGreaterThan((red[1] ?? 0) + 20);
            expect(
                diagnostics
                    .snapshot()
                    .renderGraph?.passes.some(
                        pass => pass.name === 'GPU Scene deformed and layered clustered PBR'
                    )
            ).toBe(true);
            projector.update({ enabled: false });
            for (let index = 0; index < 2; index++) {
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
            }
            expect((await center(target))[1]).toBeGreaterThan((red[1] ?? 0) + 20);
        } finally {
            unregisterRendererDiagnostics(canvas);
            target.destroy();
            renderer.destroy();
        }
    }, 60000);
});
