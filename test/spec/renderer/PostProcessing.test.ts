import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import Renderer from '../../../src/render/Renderer';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../../../src/render/pipeline/ForwardRenderPipeline';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderPipelineColorAttachment,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import {
    Bloom,
    ColorUber,
    PostProcessRenderPipelineFactory,
    TemporalAA
} from '../../../src/render/postprocessing';
import Shader from '../../../src/shader/Shader';
import type { RHIDevice } from '../../../src/render/rhi/core';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

const activeRenderers: Renderer[] = [];

interface TemporalFailureParameters {
    readonly attachment: RenderPipelineColorAttachment;
}

class TemporalAcceptanceRuntime implements ForwardRenderPipelineFeatureRuntime {
    fail = false;
    readonly jitterSamples: { readonly x: number; readonly y: number }[] = [];
    readonly pass: ScriptableRenderPass<TemporalFailureParameters> = {
        name: 'TemporalAA acceptance failure boundary',
        setup(builder: ScriptableRenderPassBuilder, parameters: TemporalFailureParameters): void {
            builder.useColorAttachment(parameters.attachment);
        },
        execute: (): void => {
            if (this.fail) throw new Error('forced TemporalAA submission failure');
        }
    };

    record(context: ForwardRenderFeatureContext): void {
        const color = context.resources.color;
        if (color === null) throw new Error('TemporalAA acceptance color is unavailable');
        this.jitterSamples.push({
            x: context.pipeline.camera.projectionJitterX,
            y: context.pipeline.camera.projectionJitterY
        });
        context.pipeline.graph.addPass(this.pass, {
            attachment: {
                texture: color,
                loadOp: 'load',
                storeOp: 'store'
            }
        });
    }

    destroy(): void {
        // No renderer-local GPU objects.
    }
}

class TemporalAcceptanceFeature implements ForwardRenderPipelineFeature {
    readonly name = 'temporal-aa-acceptance-boundary';
    readonly injectionPoint = 'after-opaque' as const;
    readonly requirements = Object.freeze({ sampledSceneColor: false, sampledDepth: false });
    readonly runtime = new TemporalAcceptanceRuntime();

    create(): ForwardRenderPipelineFeatureRuntime {
        return this.runtime;
    }
}

function observePassLabels(device: RHIDevice): {
    readonly labels: string[];
    restore(): void;
} {
    const labels: string[] = [];
    const queue = device.graphicsQueue;
    const beginFrame = queue.beginFrame.bind(queue);
    const spy = vi.spyOn(queue, 'beginFrame').mockImplementation(descriptor => {
        const commands = beginFrame(descriptor);
        const beginRenderPass = commands.beginRenderPass.bind(commands);
        vi.spyOn(commands, 'beginRenderPass').mockImplementation(pass => {
            labels.push(pass.label ?? '');
            return beginRenderPass(pass);
        });
        return commands;
    });
    return {
        labels,
        restore: () => {
            spy.mockRestore();
        }
    };
}

function rhiDevice(renderer: Renderer): RHIDevice {
    const extension = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
    if (extension === null) throw new Error('Expected the public RHI extension');
    return extension.device;
}

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
});

describe('built-in post-processing', () => {
    it('normalizes sampled render-target UVs exactly once on WebGPU', () => {
        expect(PORTABLE_FULLSCREEN_VERTEX_SOURCE).toContain('#ifdef HILO_WEBGPU');
        expect(PORTABLE_FULLSCREEN_VERTEX_SOURCE).toContain('v_uv = hiloRenderTargetUV(v_uv);');
        const mainSource = PORTABLE_FULLSCREEN_VERTEX_SOURCE.slice(
            PORTABLE_FULLSCREEN_VERTEX_SOURCE.indexOf('void main()')
        );
        expect(mainSource.match(/hiloRenderTargetUV/gu)).toHaveLength(1);
        expect(mainSource).not.toContain('1.0 -');
    });

    it('normalizes projected transmission UVs through the same portable helper', () => {
        const source = Shader.shaders['chunk/pbr.frag'];
        expect(source).toContain('vec2 hiloRenderTargetUV(vec2 uv)');
        expect(source).toContain('uv = hiloRenderTargetUV(uv);');
    });

    it('normalizes managed 2D, cube, BRDF, and LTC texture coordinates centrally', () => {
        const coordinates = Shader.shaders['method/portableCoordinates.glsl'];
        const uv = Shader.shaders['chunk/uv.frag'];
        const environment = Shader.shaders['method/textureEnvMap.glsl'];
        const pbr = Shader.shaders['chunk/pbr.frag'];
        const areaLight = Shader.shaders['method/getAreaLight.glsl'];

        expect(coordinates).toContain('vec2 hiloTextureUV(vec2 uv)');
        expect(coordinates).toContain('vec3 hiloTextureCubeDirection(vec3 direction)');
        expect(coordinates).toMatch(
            /vec3 hiloTextureCubeDirection\(vec3 direction\)\s*\{\s*return direction;\s*\}/u
        );
        expect(uv).toContain('texture(sourceTexture, hiloTextureUV(hiloMaterialUV(slot)))');
        expect(uv).toContain('vec3 hiloDecodeMaterialColor(vec3 sampled, int slot)');
        expect(uv).toContain('vec4 hiloMaterialSample(vec4 sampled, int slot)');
        expect(environment).toContain('texture(uTexture, hiloTextureCubeDirection(position))');
        expect(pbr).toContain(
            'radiance = HILO_DECODE_MATERIAL_COLOR(radiance, HILO_SPECULAR_ENV_MAP);'
        );
        expect(pbr).toContain(
            'irradiance = HILO_DECODE_MATERIAL_COLOR(irradiance, HILO_DIFFUSE_ENV_MAP);'
        );
        expect(pbr).toContain('hiloTextureUV(vec2(NdotV, 1.0 - perceptualRoughness))');
        expect(areaLight).toContain('texture(areaLightsLtcTexture1, hiloTextureUV(uv))');
    });

    it('declares the linear HDR feature requirements before renderer creation', () => {
        const bloom = new Bloom();
        const colorUber = new ColorUber();
        const temporalAA = new TemporalAA();
        const factory = new PostProcessRenderPipelineFactory({ temporalAA: {} });

        expect(temporalAA.injectionPoint).toBe('after-opaque');
        expect(bloom.injectionPoint).toBe('after-transparent');
        expect(colorUber.injectionPoint).toBe('after-post-process');
        expect(factory.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'color-attachment' },
                { format: 'rgba16float', use: 'filterable-sampled' },
                { format: 'rg16float', use: 'color-attachment' },
                { format: 'r16float', use: 'color-attachment' },
                { format: 'rgba8unorm', use: 'color-attachment' }
            ])
        );
    });

    it('validates bloom and grading ranges at construction time', () => {
        expect(() => new Bloom({ maxLevels: 0 })).toThrow(/maxLevels/u);
        expect(() => new Bloom({ knee: 0 })).toThrow(/knee/u);
        expect(() => new TemporalAA({ historyWeight: 2 })).toThrow(/historyWeight/u);
        expect(() => new TemporalAA({ depthThreshold: -1 })).toThrow(/depthThreshold/u);
        expect(() => new ColorUber({ temperature: 2 }).create()).toThrow(/temperature/u);
    });

    it.each(['webgl2', 'webgpu'] as const)(
        'renders HDR bloom and a transmissive volume through the opaque scene texture on %s',
        async backend => {
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 32,
                height: 24,
                antialias: false,
                renderPipeline: new PostProcessRenderPipelineFactory({
                    temporalAA: {},
                    bloom: {
                        threshold: 0.7,
                        intensity: 0.8,
                        maxLevels: 3,
                        minResolution: 2
                    },
                    colorUber: {
                        toneMapping: 'pbr-neutral',
                        exposure: -0.2
                    }
                })
            });
            activeRenderers.push(renderer);

            const scene = new Node();
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry({ width: 3, height: 3, depth: 0.2 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        diffuse: new Color(2.5, 0.3, 0.08)
                    }),
                    z: -1,
                    frustumTest: false
                })
            );
            const instancedGeometry = new BoxGeometry({
                width: 0.25,
                height: 0.25,
                depth: 0.25
            });
            const instancedMaterial = new BasicMaterial({ lightType: 'NONE' });
            scene.addChild(
                new Mesh({
                    geometry: instancedGeometry,
                    material: instancedMaterial,
                    x: -1,
                    y: 0.7,
                    useInstanced: true,
                    frustumTest: false
                })
            );
            scene.addChild(
                new Mesh({
                    geometry: instancedGeometry,
                    material: instancedMaterial,
                    x: -0.65,
                    y: 0.7,
                    useInstanced: true,
                    frustumTest: false
                })
            );
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry({ width: 0.35, height: 0.35, depth: 0.35 }),
                    material: new BasicMaterial({
                        lightType: 'NONE',
                        coverage: { mode: 'mask', cutoff: 0.5 },
                        opacity: 0.75
                    }),
                    x: 1.1,
                    frustumTest: false
                })
            );
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({
                        baseColor: new Color(0.7, 0.9, 1),
                        metallic: 0,
                        roughness: 0.16,
                        transmissionFactor: 0.85,
                        thicknessFactor: 0.4,
                        attenuationDistance: 2,
                        attenuationColor: new Color(0.7, 0.9, 1),
                        ior: 1.45
                    }),
                    frustumTest: false
                })
            );
            const camera = new PerspectiveCamera({ aspect: 4 / 3, z: 3 });

            expect(() => {
                renderer.render(scene, camera);
            }).not.toThrow();
            expect(() => {
                renderer.render(scene, camera);
            }).not.toThrow();
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
        }
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'covers the native-resolution TemporalAA acceptance lifecycle on WebGPU',
        async () => {
            const boundary = new TemporalAcceptanceFeature();
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 24,
                height: 16,
                antialias: false,
                renderPipeline: new PostProcessRenderPipelineFactory({
                    temporalAA: {},
                    bloom: false,
                    features: [boundary]
                })
            });
            activeRenderers.push(renderer);
            const scene = new Node();
            const material = new BasicMaterial({ lightType: 'NONE' });
            const moving = new Mesh({
                geometry: new BoxGeometry(),
                material,
                frustumTest: false
            });
            scene.addChild(moving);
            const camera = new PerspectiveCamera({ aspect: 3 / 2, z: 4 });
            let observed = observePassLabels(rhiDevice(renderer));

            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA initialize history');

            observed.labels.length = 0;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA resolve');

            moving.x = 0.4;
            renderer.render(scene, camera);
            await renderer.waitForIdle();

            camera.setPosition(0.25, 0, 4).lookAt(new Vector3(0, 0, 0));
            renderer.render(scene, camera);
            await renderer.waitForIdle();

            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry({ width: 0.5, height: 0.5, depth: 0.5 }),
                    material,
                    x: -0.75,
                    frustumTest: false
                })
            );
            renderer.render(scene, camera);
            await renderer.waitForIdle();

            observed.labels.length = 0;
            camera.invalidateTransformHistory();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA initialize history');

            observed.labels.length = 0;
            renderer.resize(30, 18, true);
            camera.aspect = 30 / 18;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA initialize history');
            renderer.render(scene, camera);
            await renderer.waitForIdle();

            boundary.runtime.fail = true;
            expect(() => {
                renderer.render(scene, camera);
            }).toThrow(/forced TemporalAA submission failure/u);
            const failedSample = boundary.runtime.jitterSamples.at(-1);
            expect(camera.projectionJitterX).toBe(0);
            expect(camera.projectionJitterY).toBe(0);

            boundary.runtime.fail = false;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(boundary.runtime.jitterSamples.at(-1)).toEqual(failedSample);

            observed.restore();
            const deviceLost = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceLost',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            const deviceRestored = new Promise<void>(resolve => {
                renderer.on(
                    'webgpuDeviceRestored',
                    () => {
                        resolve();
                    },
                    true
                );
            });
            rhiDevice(renderer).destroy();
            await deviceLost;
            await Promise.all([renderer.waitForIdle(), deviceRestored]);

            observed = observePassLabels(rhiDevice(renderer));
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA initialize history');
            observed.labels.length = 0;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA resolve');
            observed.restore();
        }
    );
});
