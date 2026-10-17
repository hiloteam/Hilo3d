import { describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import Skeleton from '../../../src/core/Skeleton';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import Matrix4 from '../../../src/math/Matrix4';
import Node from '../../../src/core/Node';
import PlaneGeometry from '../../../src/geometry/PlaneGeometry';
import GeometryData from '../../../src/geometry/GeometryData';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PBRMaterial from '../../../src/material/PBRMaterial';
import BasicMaterial from '../../../src/material/BasicMaterial';
import {
    MaterialCompiler,
    type MaterialTargetSignature
} from '../../../src/material/MaterialCompiler';
import { SubsurfaceScatteringProfile } from '../../../src/material/SubsurfaceScatteringProfile';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Texture from '../../../src/texture/Texture';
import { NEAREST } from '../../../src/constants/webgl';
import Shader from '../../../src/shader/Shader';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import { FullscreenRenderPass } from '../../../src/render/pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import Renderer from '../../../src/render/Renderer';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { TemporalAA } from '../../../src/render/postprocessing/TemporalAA';
import {
    ForwardRenderPipelineFactory,
    type ForwardRenderPipelineFeature
} from '../../../src/render/pipeline/ForwardRenderPipeline';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import {
    SubsurfaceScattering,
    SubsurfaceScatteringController,
    snapshotSubsurfaceScatteringOptions,
    SUBSURFACE_SCATTERING_LAYOUT
} from '../../../src/render/postprocessing/SubsurfaceScattering';
import { getUniformBlockBinding } from '../../../src/render/ubo/UniformBlockBindings';
import { getWebGPUUniformBlockBinding } from '../../../src/render/shader/WebGPUBindingLayout';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';

async function pixels(target: RenderTarget): Promise<Float32Array> {
    const read = await target.readColorAttachment();
    return new Float32Array(
        read.data.buffer,
        read.data.byteOffset,
        read.data.byteLength / 4
    ).slice();
}
function at(data: Float32Array, x: number, y: number, channel = 0, width = 64): number {
    return data[(y * width + x) * 4 + channel] ?? 0;
}
function surface(): {
    scene: Node;
    material: PBRMaterial;
    mesh: Mesh;
    texture: Texture;
    geometry: PlaneGeometry;
} {
    const texture = new Texture({
        width: 2,
        height: 2,
        minFilter: NEAREST,
        magFilter: NEAREST,
        image: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 0, 0, 0, 255])
    });
    const material = new PBRMaterial({
        baseColorMap: texture,
        metallic: 0,
        roughness: 1,
        subsurfaceProfile: new SubsurfaceScatteringProfile({ radius: [0.12, 0.04, 0.015] })
    });
    const geometry = new PlaneGeometry({ width: 2, height: 2 });
    geometry.uvs = new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2);
    const scene = new Node();
    const mesh = new Mesh({ geometry, material });
    mesh.addTo(scene);
    new DirectionalLight({ amount: 2, direction: new Vector3(0, 0, -1) }).addTo(scene);
    return { scene, material, mesh, texture, geometry };
}

describe('subsurface contracts', () => {
    it('validates the three-HDR-target extraction ABI and HDR feature ordering before submission', () => {
        const material = new PBRMaterial({ subsurfaceProfile: new SubsurfaceScatteringProfile() });
        const compiler = new MaterialCompiler();
        const request = {
            instance: material,
            role: 'subsurface' as const,
            vertexLayoutClass: 'static-mesh',
            renderingProfile: 'portable' as const,
            backend: 'webgpu' as const
        };
        const target: MaterialTargetSignature = {
            colorFormats: ['rgba16float', 'rgba16float', 'rgba16float'],
            depthStencilFormat: 'depth24plus',
            sampleCount: 1
        };
        expect(compiler.compile({ ...request, target })?.fragmentOutput).toBe('subsurface');
        for (const invalid of [
            { ...target, sampleCount: 4 },
            { ...target, colorFormats: ['rgba16float'] },
            { ...target, colorFormats: ['rgba16float', 'rgba8unorm', 'rgba16float'] },
            { ...target, depthStencilFormat: null }
        ]) {
            expect(() => compiler.compile({ ...request, target: invalid })).toThrow(
                /three single-sample rgba16float/u
            );
        }
        expect(
            new ForwardRenderPipelineFactory({ features: [new SubsurfaceScattering()] })
                .sceneColorFormat
        ).toBe('rgba16float');
        expect(
            () =>
                new ForwardRenderPipelineFactory({
                    sceneColorFormat: 'rgba8unorm',
                    features: [new SubsurfaceScattering()]
                })
        ).toThrow(/rgba16float/u);
        const consumer: ForwardRenderPipelineFeature = {
            name: 'prior color consumer',
            injectionPoint: 'after-opaque',
            requirements: { sampledSceneColor: true, sampledDepth: false },
            create: () => ({
                record: () => {
                    /* Test ordering only. */
                },
                destroy: () => {
                    /* No owned state. */
                }
            })
        };
        expect(
            () =>
                new ForwardRenderPipelineFactory({
                    features: [consumer, new SubsurfaceScattering()]
                })
        ).toThrow(/first and only/u);
    });

    it('snapshots physical profile distances and rejects invalid finite budgets', () => {
        const radii: [number, number, number] = [0.1, 0.05, 0.02];
        const profile = new SubsurfaceScatteringProfile({ radius: radii });
        radii[0] = 1;
        expect(profile.radius).toEqual([0.1, 0.05, 0.02]);
        expect(Object.isFrozen(profile.radius)).toBe(true);
        for (const radius of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
            expect(() => new SubsurfaceScatteringProfile({ radius: [radius, 1, 1] })).toThrow(
                /radius/u
            );
        expect(() => new SubsurfaceScattering({ maxPixelCount: 0 })).toThrow(/maxPixelCount/u);
        expect(() => new SubsurfaceScattering({ maxRadiusPixels: 257 })).toThrow(
            /maxRadiusPixels/u
        );
        expect(() => new SubsurfaceScattering({ normalThreshold: -1 })).toThrow(/normalThreshold/u);
        expect(snapshotSubsurfaceScatteringOptions()).toEqual({
            sampleCount: 17,
            maxRadiusPixels: 64,
            normalThreshold: 0.5,
            maxPixelCount: 1920 * 1080
        });
        expect(SUBSURFACE_SCATTERING_LAYOUT.byteLength).toBe(32);
        expect(SUBSURFACE_SCATTERING_LAYOUT.fields.u_sssProjection.offset).toBe(0);
        expect(SUBSURFACE_SCATTERING_LAYOUT.fields.u_sssFilter.offset).toBe(16);
        expect(getUniformBlockBinding('SubsurfaceScatteringBlock')).toBe(13);
        expect(getWebGPUUniformBlockBinding('SubsurfaceScatteringBlock')).toEqual({
            group: 0,
            binding: 5
        });
    });
});

describe.each(['webgl2', 'webgpu'] as const)('subsurface diffusion through %s', backend => {
    it.each(['activation', 'replacement'] as const)(
        'applies beforeRender subsurface %s in the current frame without another split feature',
        async change => {
            const fixture = surface();
            const canvas = document.createElement('canvas');
            const diagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend,
                width: 64,
                height: 64,
                antialias: false,
                domElement: canvas,
                renderPipeline: new ForwardRenderPipelineFactory({
                    opaqueTexture: false,
                    features: [new SubsurfaceScattering()]
                })
            });
            const target = renderer.createRenderTarget({
                width: 64,
                height: 64,
                colorAttachments: [{ format: 'rgba32float' }]
            });
            const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
            try {
                renderer.renderToTarget(target, fixture.scene, camera);
                const reference = await pixels(target);
                expect(at(reference, 34, 12)).toBeGreaterThan(at(reference, 34, 12, 2) + 0.01);
                if (change === 'activation') fixture.material.subsurfaceFactor = 0;
                else
                    fixture.mesh.material = new PBRMaterial({
                        baseColorMap: fixture.texture,
                        metallic: 0,
                        roughness: 1
                    });
                const callback = vi.fn(() => {
                    fixture.material.subsurfaceFactor = 1;
                    fixture.mesh.material = fixture.material;
                });
                fixture.mesh.on('beforeRender', callback, true);
                renderer.renderToTarget(target, fixture.scene, camera, true);
                const updated = await pixels(target);
                expect(callback).toHaveBeenCalledOnce();
                expect(at(updated, 34, 12)).toBeCloseTo(at(reference, 34, 12), 4);
                expect(updated).toEqual(reference);
                expect(
                    diagnostics
                        .snapshot()
                        .renderGraph?.passes.filter(pass => pass.name.startsWith('Subsurface'))
                ).toHaveLength(4);
                fixture.material.subsurfaceFactor = 0;
                renderer.renderToTarget(target, fixture.scene, camera, true);
                expect(callback).toHaveBeenCalledOnce();
                expect(
                    diagnostics
                        .snapshot()
                        .renderGraph?.passes.some(pass => pass.name.startsWith('Subsurface'))
                ).toBe(false);
            } finally {
                target.destroy();
                renderer.destroy();
                fixture.texture.destroy();
                unregisterRendererDiagnostics(canvas);
            }
        }
    );

    it.each(['standard', 'reversed', 'logarithmic'] as const)(
        'diffuses only diffuse lighting with channel radii, preserves row orientation and foreground at %s depth',
        async depthCase => {
            const depthMode = depthCase === 'reversed' ? 'reversed' : 'standard';
            const fixture = surface();
            const canvas = document.createElement('canvas');
            const diagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend,
                useLogDepth: depthCase === 'logarithmic',
                width: 64,
                height: 64,
                antialias: false,
                domElement: canvas,
                renderPipeline: new ForwardRenderPipelineFactory({
                    sceneColorFormat: 'rgba16float',
                    features: [
                        new SubsurfaceScattering({
                            sampleCount:
                                depthCase === 'standard' ? 25 : depthCase === 'reversed' ? 9 : 17
                        })
                    ]
                })
            });
            const target = renderer.createRenderTarget({
                width: 64,
                height: 64,
                colorAttachments: [{ format: 'rgba32float' }],
                depthStencilAttachment: { depthMode }
            });
            const camera =
                depthCase === 'logarithmic'
                    ? new PerspectiveCamera({
                          z: 3,
                          near: 0.1,
                          far: 10,
                          aspect: 1,
                          fov: 36.86989765
                      })
                    : new OrthographicCamera({ z: 3, near: 0.1, far: 10, depthMode });
            try {
                fixture.material.subsurfaceFactor = 0;
                renderer.renderToTarget(target, fixture.scene, camera);
                const baseline = await pixels(target);
                expect(
                    diagnostics
                        .snapshot()
                        .renderGraph?.passes.some(pass => pass.name.startsWith('Subsurface'))
                ).toBe(false);
                fixture.material.subsurfaceFactor = 1;
                renderer.renderToTarget(target, fixture.scene, camera);
                const scattered = await pixels(target);
                const redGain = at(scattered, 34, 12) - at(baseline, 34, 12);
                const greenGain = at(scattered, 34, 12, 1) - at(baseline, 34, 12, 1);
                const blueGain = at(scattered, 34, 12, 2) - at(baseline, 34, 12, 2);
                expect(redGain).toBeGreaterThan(0.015);
                expect(redGain).toBeGreaterThan(greenGain * 1.5);
                expect(greenGain).toBeGreaterThan(blueGain);
                expect(at(scattered, 34, 12)).toBeGreaterThan(at(scattered, 34, 52) * 2);
                expect(at(scattered, 4, 12)).toBeCloseTo(at(baseline, 4, 12), 3);
                expect(at(scattered, 34, 12, 3)).toBe(1);
                expect(
                    diagnostics
                        .snapshot()
                        .renderGraph?.passes.filter(pass => pass.name.startsWith('Subsurface'))
                ).toHaveLength(4);
                const foreground = new Mesh({
                    geometry: new PlaneGeometry({ width: 0.5, height: 2 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        diffuse: new Color(0, 0.7, 0)
                    }),
                    z: 0.5
                });
                foreground.addTo(fixture.scene);
                renderer.renderToTarget(target, fixture.scene, camera);
                const covered = await pixels(target);
                expect(at(covered, 32, 12)).toBe(0);
                expect(at(covered, 32, 12, 1)).toBeCloseTo(0.7, 3);
            } finally {
                target.destroy();
                renderer.destroy();
                fixture.texture.destroy();
                unregisterRendererDiagnostics(canvas);
            }
        }
    );

    it('preserves emission and zero-factor pixels, bounds memory, rolls back and rebuilds after resize/release', async () => {
        let fail = false;
        const failure: ForwardRenderPipelineFeature = {
            name: 'discard after scattering',
            injectionPoint: 'after-transparent',
            requirements: { sampledSceneColor: false, sampledDepth: false },
            create: () => ({
                record: () => {
                    if (fail) throw new Error('discard subsurface frame');
                },
                destroy: () => {
                    /* No owned state. */
                }
            })
        };
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend,
            width: 64,
            height: 64,
            antialias: false,
            domElement: canvas,
            renderPipeline: new ForwardRenderPipelineFactory({
                sceneColorFormat: 'rgba16float',
                features: [new SubsurfaceScattering({ maxPixelCount: 4096 }), failure]
            })
        });
        let target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const fixture = surface();
        fixture.material.baseColor.set(0, 0, 0, 1);
        fixture.material.emissionFactor.set(0.25, 1.5, 0.5, 1);
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            fixture.material.subsurfaceFactor = 0;
            renderer.renderToTarget(target, fixture.scene, camera);
            const baseline = await pixels(target);
            fixture.material.subsurfaceFactor = 1;
            renderer.renderToTarget(target, fixture.scene, camera);
            expect(await pixels(target)).toEqual(baseline);
            fail = true;
            expect(() => {
                renderer.renderToTarget(target, fixture.scene, camera);
            }).toThrow(/after-transparent/u);
            fail = false;
            renderer.renderToTarget(target, fixture.scene, camera);
            expect(await pixels(target)).toEqual(baseline);
            target.resize(65, 65);
            let budgetError: unknown;
            try {
                renderer.renderToTarget(target, fixture.scene, camera);
            } catch (error) {
                budgetError = error;
            }
            expect(budgetError).toBeInstanceOf(Error);
            if (!(budgetError instanceof Error)) throw new Error('Missing budget validation error');
            expect(budgetError.cause).toBeInstanceOf(RangeError);
            if (!(budgetError.cause instanceof Error))
                throw new Error('Missing budget validation cause');
            expect(budgetError.cause.message).toMatch(/maxPixelCount/u);
            target.resize(32, 32);
            renderer.renderToTarget(target, fixture.scene, camera);
            expect(at(await pixels(target), 8, 8, 1, 32)).toBeGreaterThan(1.4);
            renderer.releaseGPUResources();
            target = renderer.createRenderTarget({
                width: 32,
                height: 32,
                depthStencilAttachment: false,
                colorAttachments: [{ format: 'rgba32float' }]
            });
            renderer.renderToTarget(target, fixture.scene, camera);
            expect(at(await pixels(target), 8, 8, 1, 32)).toBeGreaterThan(1.4);
            fixture.mesh.visible = false;
            renderer.renderToTarget(target, fixture.scene, camera);
            expect(
                diagnostics
                    .snapshot()
                    .renderGraph?.passes.some(pass => pass.name.startsWith('Subsurface'))
            ).toBe(false);
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
            unregisterRendererDiagnostics(canvas);
        }
    });

    it('isolates adjacent profiles but diffuses across identical canonical profiles', async () => {
        const renderer = await Renderer.create({
            backend,
            width: 64,
            height: 64,
            antialias: false,
            domElement: document.createElement('canvas'),
            renderPipeline: new ForwardRenderPipelineFactory({
                features: [new SubsurfaceScattering({ sampleCount: 25 })]
            })
        });
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const scene = new Node();
        const leftProfile = new SubsurfaceScatteringProfile({ radius: [0.12, 0.04, 0.015] });
        const material = (profile: SubsurfaceScatteringProfile, white: boolean): PBRMaterial =>
            new PBRMaterial({
                baseColor: new Color(white ? 1 : 0, white ? 1 : 0, white ? 1 : 0),
                metallic: 0,
                roughness: 1,
                subsurfaceProfile: profile
            });
        const geometry = new PlaneGeometry({ width: 1, height: 2 });
        new Mesh({ geometry, material: material(leftProfile, true), x: -0.5 }).addTo(scene);
        const right = new Mesh({
            geometry,
            material: material(
                new SubsurfaceScatteringProfile({ radius: [0.12, 0.04, 0.015] }),
                false
            ),
            x: 0.5
        });
        right.addTo(scene);
        new DirectionalLight({ amount: 2, direction: new Vector3(0, 0, -1) }).addTo(scene);
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.renderToTarget(target, scene, camera);
            const shared = await pixels(target);
            right.z = -1;
            renderer.renderToTarget(target, scene, camera);
            const separated = await pixels(target);
            expect(at(shared, 34, 16) - at(separated, 34, 16)).toBeGreaterThan(0.015);
            right.z = 0;
            right.material = material(
                new SubsurfaceScatteringProfile({ radius: [0.11, 0.04, 0.015] }),
                false
            );
            renderer.renderToTarget(target, scene, camera);
            const isolated = await pixels(target);
            expect(at(shared, 34, 16) - at(isolated, 34, 16)).toBeGreaterThan(0.015);
            expect(at(isolated, 34, 16)).toBeCloseTo(at(isolated, 50, 16), 3);
        } finally {
            target.destroy();
            renderer.destroy();
        }
    });

    it('uses identical alpha-mask coverage with simultaneous skin and morph deformation', async () => {
        const renderer = await Renderer.create({
            backend,
            width: 64,
            height: 64,
            antialias: false,
            domElement: document.createElement('canvas'),
            renderPipeline: new ForwardRenderPipelineFactory({
                features: [new SubsurfaceScattering({ sampleCount: 25 })]
            })
        });
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float', clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
        });
        const source = new PlaneGeometry({ width: 1.5, height: 1.5 });
        const count = source.vertices?.count ?? 0;
        const weights = new Float32Array(count * 4);
        const offsets = new Float32Array(count * 3);
        for (let vertex = 0; vertex < count; vertex++) {
            weights[vertex * 4] = 1;
            offsets[vertex * 3] = 0.125;
        }
        const geometry = new MorphGeometry({
            vertices: source.vertices,
            normals: source.normals,
            uvs: new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2),
            indices: source.indices,
            skinIndices: new GeometryData(new Uint8Array(count * 4), 4),
            skinWeights: new GeometryData(weights, 4),
            weights: [1],
            targets: { vertices: [new GeometryData(offsets, 3)] }
        });
        const texture = new Texture({
            width: 2,
            height: 2,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 0])
        });
        const material = new PBRMaterial({
            baseColorMap: texture,
            coverage: { mode: 'mask', cutoff: 0.5 },
            metallic: 0,
            roughness: 1,
            subsurfaceProfile: new SubsurfaceScatteringProfile({ radius: [0.12, 0.04, 0.015] })
        });
        const joint = new Node({ x: 0.125 });
        const scene = new Node();
        joint.addTo(scene);
        new SkinnedMesh({
            geometry,
            material,
            skeleton: new Skeleton({ jointNodeList: [joint], inverseBindMatrices: [new Matrix4()] })
        }).addTo(scene);
        new DirectionalLight({ amount: 2, direction: new Vector3(0, 0, -1) }).addTo(scene);
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            material.subsurfaceFactor = 0;
            renderer.renderToTarget(target, scene, camera);
            const baseline = await pixels(target);
            material.subsurfaceFactor = 1;
            renderer.renderToTarget(target, scene, camera);
            const scattered = await pixels(target);
            expect(at(scattered, 42, 16) - at(baseline, 42, 16)).toBeGreaterThan(0.01);
            expect(at(scattered, 42, 48, 3)).toBe(0);
            expect(at(scattered, 42, 48)).toBe(0);
            expect(at(scattered, 12, 16, 3)).toBe(0);
            joint.x = -0.125;
            geometry.weights = [0];
            renderer.renderToTarget(target, scene, camera);
            const moved = await pixels(target);
            expect(at(moved, 32, 16)).toBeGreaterThan(0.01);
            expect(at(moved, 56, 16, 3)).toBe(0);
        } finally {
            target.destroy();
            renderer.destroy();
            texture.destroy();
        }
    });

    it('diffuses the hybrid baseline with the exact profile and material strength while preserving confidence alpha', async () => {
        const feature: ForwardRenderPipelineFeature = {
            name: 'hybrid baseline validation',
            injectionPoint: 'after-opaque',
            requirements: new SubsurfaceScattering().requirements,
            create: () => {
                const controller = new SubsurfaceScatteringController(
                    snapshotSubsurfaceScatteringOptions({ sampleCount: 25 })
                );
                const shader = new Shader({
                    vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
                    fs: `#version 300 es
precision highp float;
in vec2 v_uv;
layout(location=0) out vec4 color;
void main() { float value = v_uv.x < 0.5 ? 1.0 : 0.0; color = vec4(vec3(value), value); }`
                });
                const pass = new FullscreenRenderPass({
                    name: 'DDGI synthetic baseline',
                    shader,
                    pipelineState: {
                        ...DEFAULT_MATERIAL_PIPELINE_STATE,
                        depthTest: false,
                        depthWrite: false,
                        cullMode: 'none'
                    }
                });
                return {
                    record: context => {
                        const sceneColor = context.resources.color;
                        const sceneDepth = context.resources.depth;
                        if (sceneColor === null || sceneDepth === null)
                            throw new Error('Missing baseline fixture input');
                        const baseline = context.pipeline.graph.createTexture(
                            'DDGI synthetic baseline',
                            { format: 'rgba16float', extent: { relativeTo: 'output', scale: 1 } }
                        );
                        context.pipeline.graph.addPass(pass, {
                            inputTextures: [],
                            colorAttachments: [
                                {
                                    texture: baseline,
                                    loadOp: 'clear',
                                    storeOp: 'store',
                                    clearValue: { r: 0, g: 0, b: 0, a: 0 }
                                }
                            ]
                        });
                        const result = controller.record(context.pipeline, {
                            cullingResults: context.cullingResults,
                            sceneColor,
                            sceneDepth,
                            sceneScale: 1,
                            hybridBaseline: baseline
                        });
                        if (result.hybridBaseline === undefined)
                            throw new Error('Missing scattered hybrid baseline');
                        context.resources.replaceColor(result.hybridBaseline, 'linear');
                    },
                    destroy: () => {
                        controller.destroy();
                        shader.destroy();
                    }
                };
            }
        };
        const fixture = surface();
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const renderer = await Renderer.create({
            backend,
            width: 64,
            height: 64,
            antialias: false,
            domElement: canvas,
            renderPipeline: new ForwardRenderPipelineFactory({ features: [feature] })
        });
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.renderToTarget(target, fixture.scene, camera);
            const full = await pixels(target);
            // The right-side source has zero confidence alpha and zero radiance, but still receives
            // a physical RGB diffusion contribution. Treating baseline alpha as SSS strength fails.
            expect(at(full, 34, 12)).toBeGreaterThan(0.1);
            expect(at(full, 34, 12)).toBeGreaterThan(at(full, 34, 12, 1));
            expect(at(full, 34, 12, 1)).toBeGreaterThan(at(full, 34, 12, 2));
            expect(at(full, 34, 12, 3)).toBe(0);
            expect(at(full, 12, 12, 3)).toBe(1);
            fixture.material.subsurfaceFactor = 0.5;
            renderer.renderToTarget(target, fixture.scene, camera);
            const half = await pixels(target);
            expect(at(half, 34, 12)).toBeCloseTo(at(full, 34, 12) * 0.5, 3);
            fixture.material.subsurfaceFactor = 0;
            renderer.renderToTarget(target, fixture.scene, camera);
            const disabled = await pixels(target);
            expect(at(disabled, 34, 12)).toBe(0);
            expect(at(disabled, 12, 12)).toBe(1);
            expect(
                diagnostics
                    .snapshot()
                    .renderGraph?.passes.some(pass => pass.name.includes('Subsurface'))
            ).toBe(false);
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
            unregisterRendererDiagnostics(canvas);
        }
    });

    it('projects physical diffusion at the opaque render scale before temporal upscaling', async () => {
        const fixture = surface();
        const renderer = await Renderer.create({
            backend,
            width: 64,
            height: 64,
            antialias: false,
            domElement: document.createElement('canvas'),
            renderPipeline: new ForwardRenderPipelineFactory({
                features: [
                    new SubsurfaceScattering({ sampleCount: 25 }),
                    new TemporalAA({ renderScale: 0.5, sharpness: 0 })
                ]
            })
        });
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            depthStencilAttachment: false,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const camera = new PerspectiveCamera({
            z: 3,
            near: 0.1,
            far: 10,
            aspect: 1,
            fov: 36.86989765
        });
        try {
            for (let frame = 0; frame < 8; frame++) {
                renderer.renderToTarget(target, fixture.scene, camera);
                await renderer.waitForIdle();
            }
            const result = await pixels(target);
            expect(result.every(Number.isFinite)).toBe(true);
            expect(at(result, 34, 12)).toBeGreaterThan(at(result, 34, 12, 1) + 0.01);
            expect(at(result, 34, 12, 1)).toBeGreaterThan(at(result, 34, 12, 2));
            expect(at(result, 12, 12)).toBeGreaterThan(at(result, 34, 12));
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
        }
    });

    it('rejects forceMaterial overrides involving authored or effective subsurface surfaces', async () => {
        const renderer = await Renderer.create({
            backend,
            width: 8,
            height: 8,
            antialias: false,
            domElement: document.createElement('canvas'),
            renderPipeline: new ForwardRenderPipelineFactory({
                features: [new SubsurfaceScattering()]
            })
        });
        const target = renderer.createRenderTarget({ width: 8, height: 8 });
        const fixture = surface();
        const ordinary = new BasicMaterial({ lightType: 'NONE' });
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.forceMaterial = ordinary;
            expect(() => {
                renderer.renderToTarget(target, fixture.scene, camera);
            }).toThrow(/forceMaterial/u);
            renderer.forceMaterial = fixture.material;
            fixture.mesh.material = ordinary;
            expect(() => {
                renderer.renderToTarget(target, fixture.scene, camera);
            }).toThrow(/forceMaterial/u);
            renderer.forceMaterial = null;
            fixture.mesh.material = fixture.material;
            renderer.renderToTarget(target, fixture.scene, camera);
            await renderer.waitForIdle();
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
        }
    });

    it('rejects opted-in surfaces without a diffusion pipeline', async () => {
        const renderer = await Renderer.create({
            backend,
            width: 8,
            height: 8,
            antialias: false,
            domElement: document.createElement('canvas')
        });
        const target = renderer.createRenderTarget({ width: 8, height: 8 });
        const fixture = surface();
        try {
            expect(() => {
                renderer.renderToTarget(
                    target,
                    fixture.scene,
                    new OrthographicCamera({ z: 3, far: 10 })
                );
            }).toThrow(/SubsurfaceScattering pipeline/u);
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
        }
    });
});

describe('subsurface native clustered lighting', () => {
    it('uses the diffused DDGI baseline for native hybrid SSGI and removes all extra passes at zero strength', async () => {
        const fixture = surface();
        fixture.mesh.contributeToGlobalIllumination = false;
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [
                {
                    geometry: fixture.geometry,
                    material: new PBRMaterial({ metallic: 0, roughness: 1 })
                }
            ],
            subsurfaceScattering: {},
            temporalAA: { sharpness: 0 },
            screenSpaceGlobalIllumination: { rayCount: 4, stepCount: 6, denoisePasses: 1 },
            dynamicGlobalIllumination: {
                origin: new Vector3(-1, -1, 0),
                spacing: new Vector3(2, 2, 2),
                probeCounts: [2, 2, 2],
                maxProbesPerFrame: 8,
                raysPerProbe: 64,
                maxMeshes: 4,
                maxTriangles: 4,
                maxTextureTexels: 4,
                hysteresis: 0,
                environment: new Color(0.2, 0.4, 0.8)
            },
            hiZ: false,
            maxObjects: 8,
            maxLights: 8,
            maxLightIndices: 128,
            maxLightsPerCluster: 8,
            maxViewportWidth: 64,
            maxViewportHeight: 64,
            bloomStrength: 0
        });
        const renderer = await Renderer.create({
            backend: 'webgpu',
            width: 64,
            height: 64,
            antialias: false,
            domElement: canvas,
            renderPipeline: factory
        });
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const camera = new PerspectiveCamera({
            z: 3,
            near: 0.1,
            far: 10,
            aspect: 1,
            fov: 36.86989765
        });
        try {
            for (let frame = 0; frame < 4; frame++) {
                renderer.renderToTarget(target, fixture.scene, camera);
                await renderer.waitForIdle();
            }
            const shaded = await pixels(target);
            expect(shaded.every(Number.isFinite)).toBe(true);
            expect(at(shaded, 12, 12)).toBeGreaterThan(0.1);
            expect(
                diagnostics
                    .snapshot()
                    .renderGraph?.passes.some(
                        pass => pass.name === 'Subsurface DDGI baseline replacement'
                    )
            ).toBe(true);
            fixture.material.subsurfaceFactor = 0;
            renderer.renderToTarget(target, fixture.scene, camera);
            await renderer.waitForIdle();
            expect(
                diagnostics
                    .snapshot()
                    .renderGraph?.passes.some(pass => pass.name.includes('Subsurface'))
            ).toBe(false);
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
            unregisterRendererDiagnostics(canvas);
        }
    }, 30000);

    it('extracts the same clustered direct diffuse before diffusion', async () => {
        const fixture = surface();
        const bucket = new PBRMaterial({ metallic: 0, roughness: 1 });
        const renderer = await Renderer.create({
            backend: 'webgpu',
            width: 64,
            height: 64,
            antialias: false,
            domElement: document.createElement('canvas'),
            renderPipeline: new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry: fixture.geometry, material: bucket }],
                subsurfaceScattering: { sampleCount: 25 },
                hiZ: false,
                maxObjects: 8,
                maxLights: 8,
                maxLightIndices: 128,
                maxLightsPerCluster: 8,
                maxViewportWidth: 64,
                maxViewportHeight: 64,
                bloomStrength: 0,
                toneMapping: 'aces'
            })
        });
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const camera = new PerspectiveCamera({
            z: 3,
            near: 0.1,
            far: 10,
            aspect: 1,
            fov: 36.86989765
        });
        try {
            fixture.material.subsurfaceFactor = 0;
            renderer.renderToTarget(target, fixture.scene, camera);
            const baseline = await pixels(target);
            fixture.material.subsurfaceFactor = 1;
            renderer.renderToTarget(target, fixture.scene, camera);
            const scattered = await pixels(target);
            expect(at(scattered, 34, 12) - at(baseline, 34, 12)).toBeGreaterThan(0.015);
            expect(at(scattered, 34, 12) - at(baseline, 34, 12)).toBeGreaterThan(
                at(scattered, 34, 12, 2) - at(baseline, 34, 12, 2)
            );
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
        }
    });
});

describe('subsurface device-generation recovery', () => {
    it('rebuilds diffusion after real WebGPU device replacement with the same public resources', async () => {
        const renderer = await Renderer.create({
            backend: 'webgpu',
            width: 64,
            height: 64,
            antialias: false,
            domElement: document.createElement('canvas'),
            renderPipeline: new ForwardRenderPipelineFactory({
                features: [new SubsurfaceScattering()]
            })
        });
        const extension = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
        if (extension === null) throw new Error('RHI recovery extension unavailable');
        const fixture = surface();
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const identity = target.getColorTexture();
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.renderToTarget(target, fixture.scene, camera);
            const before = await pixels(target);
            const previous = extension.device;
            const lost = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceLost',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            const restored = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            previous.destroy();
            await lost;
            await Promise.all([renderer.waitForIdle(), restored]);
            expect(extension.device).not.toBe(previous);
            expect(renderer.isReady).toBe(true);
            renderer.renderToTarget(target, fixture.scene, camera);
            expect(await pixels(target)).toEqual(before);
            expect(target.getColorTexture()).toBe(identity);
            expect(fixture.mesh.material).toBe(fixture.material);
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
        }
    }, 15000);

    it('rebuilds diffusion after real WebGL context loss while preserving target and material identities', async () => {
        const canvas = document.createElement('canvas');
        const renderer = await Renderer.create({
            backend: 'webgl2',
            width: 64,
            height: 64,
            antialias: false,
            domElement: canvas,
            renderPipeline: new ForwardRenderPipelineFactory({
                features: [new SubsurfaceScattering()]
            })
        });
        const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
        if (extension === undefined || extension === null)
            throw new Error('Context-loss extension unavailable');
        const fixture = surface();
        const target = renderer.createRenderTarget({
            width: 64,
            height: 64,
            colorAttachments: [{ format: 'rgba32float' }]
        });
        const identity = target.getColorTexture();
        const camera = new OrthographicCamera({ z: 3, near: 0.1, far: 10 });
        try {
            renderer.renderToTarget(target, fixture.scene, camera);
            const before = await pixels(target);
            const lost = new Promise<Event>(resolve => {
                canvas.addEventListener('webglcontextlost', resolve, { once: true });
            });
            extension.loseContext();
            expect((await lost).defaultPrevented).toBe(true);
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
            renderer.renderToTarget(target, fixture.scene, camera);
            expect(await pixels(target)).toEqual(before);
            expect(target.getColorTexture()).toBe(identity);
            expect(fixture.mesh.material).toBe(fixture.material);
        } finally {
            target.destroy();
            renderer.destroy();
            fixture.texture.destroy();
        }
    }, 15000);
});
