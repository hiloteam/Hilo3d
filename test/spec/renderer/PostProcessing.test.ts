import { afterEach, describe, expect, it, vi } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Stage from '../../../src/core/Stage';
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
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import {
    acquireRenderPassParameters,
    type RenderPassParameterPool
} from '../../../src/render/pipeline/RenderPassParameterPool';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphBufferHandle,
    RenderGraphPassHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineHistoryTextureDescriptor,
    RenderPipelineHistoryTextureResources,
    RenderPipelineTextureDescriptor,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import {
    Bloom,
    AutoExposure,
    ColorUber,
    GroundTruthAmbientOcclusion,
    PostProcessRenderPipelineFactory,
    ScreenSpaceGlobalIllumination,
    TemporalAA
} from '../../../src/render/postprocessing';
import {
    TemporalResolveController,
    snapshotTemporalAAOptions
} from '../../../src/render/postprocessing/TemporalAA';
import {
    AtmosphereWeatherController,
    snapshotAtmosphereWeatherOptions
} from '../../../src/render/postprocessing/AtmosphereWeather';
import { snapshotGroundTruthAmbientOcclusionOptions } from '../../../src/render/postprocessing/GroundTruthAmbientOcclusion';
import type { RenderGraphTimelineSnapshot } from '../../../src/render/graph/RenderGraphTimeline';
import Shader from '../../../src/shader/Shader';
import type { RHIDevice } from '../../../src/render/rhi/core';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

const activeRenderers: Renderer[] = [];
const taaIntegrationBackends = __HILO3D_GITHUB_ACTIONS_COVERAGE__
    ? (['webgl2'] as const)
    : (['webgl2', 'webgpu'] as const);

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

    it('exposes color-aware diffuse and bent-cone specular GTAO integration', () => {
        const pbr = Shader.shaders['chunk/pbr.frag'];
        const pbrMain = Shader.shaders['chunk/pbr_main.frag'];
        expect(pbr).toContain('hiloGTAOMultiBounceVisibility');
        expect(pbr).toContain('hiloGTAOSpecularVisibility');
        expect(pbrMain).toContain('gtaoDiffuseVisibility');
        expect(pbrMain).toContain('gtaoSpecularVisibility');
        expect(pbrMain).not.toContain('ao *= gtaoVisibility');
    });

    it('normalizes GTAO quality presets while preserving explicit sampling overrides', () => {
        expect(snapshotGroundTruthAmbientOcclusionOptions({ quality: 'ultra' })).toMatchObject({
            quality: 'ultra',
            resolutionScale: 0.75,
            directionCount: 6,
            stepCount: 8,
            normalSource: 'hybrid',
            multiBounce: 1
        });
        expect(
            snapshotGroundTruthAmbientOcclusionOptions({
                quality: 'low',
                resolutionScale: 1,
                directionCount: 8,
                stepCount: 12
            })
        ).toMatchObject({
            quality: 'low',
            resolutionScale: 1,
            directionCount: 8,
            stepCount: 12
        });
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
        const autoExposure = new AutoExposure();
        const colorUber = new ColorUber();
        const gtao = new GroundTruthAmbientOcclusion();
        const ssgi = new ScreenSpaceGlobalIllumination();
        const temporalAA = new TemporalAA();
        const factory = new PostProcessRenderPipelineFactory({
            groundTruthAmbientOcclusion: {},
            screenSpaceGlobalIllumination: {},
            temporalAA: {}
        });

        expect(gtao.injectionPoint).toBe('before-opaque');
        expect(ssgi.injectionPoint).toBe('after-opaque');
        expect(ssgi.requirements.sampledSceneColor).toBe(true);
        expect(ssgi.requirements.sampledDepth).toBe(true);
        expect(temporalAA.injectionPoint).toBe('after-opaque');
        expect(bloom.injectionPoint).toBe('after-transparent');
        expect(autoExposure.injectionPoint).toBe('after-post-process');
        expect(autoExposure.requirements.requiredCapabilities).toEqual([
            'storage-buffer',
            'storage-texture',
            'compute-pass'
        ]);
        expect(colorUber.injectionPoint).toBe('after-post-process');
        expect(factory.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'color-attachment' },
                { format: 'rgba16float', use: 'filterable-sampled' },
                { format: 'r32float', use: 'color-attachment' },
                { format: 'r32float', use: 'sampled' },
                { format: 'rgba8unorm', use: 'color-attachment' },
                { format: 'rgba8unorm', use: 'filterable-sampled' }
            ])
        );
    });

    it('validates bloom and grading ranges at construction time', () => {
        expect(() => new Bloom({ maxLevels: 0 })).toThrow(/maxLevels/u);
        expect(() => new Bloom({ knee: 0 })).toThrow(/knee/u);
        expect(() => new TemporalAA({ historyWeight: 2 })).toThrow(/historyWeight/u);
        expect(() => new TemporalAA({ depthThreshold: -1 })).toThrow(/depthThreshold/u);
        expect(() => new TemporalAA({ varianceGamma: 0 })).toThrow(/varianceGamma/u);
        expect(() => new TemporalAA({ sharpness: 1 })).toThrow(/sharpness/u);
        expect(() => new TemporalAA({ renderScale: 0.49 })).toThrow(/renderScale/u);
        expect(() => new TemporalAA({ renderScale: 1.01 })).toThrow(/renderScale/u);
        expect(
            () => new TemporalAA({ dynamicResolution: { minScale: 0.8, maxScale: 0.7 } })
        ).toThrow(/minScale/u);
        expect(() => new TemporalAA({ dynamicResolution: { initialScale: 0.4 } })).toThrow(
            /initialScale/u
        );
        expect(() => new TemporalAA({ dynamicResolution: { warmupFrames: 0 } })).toThrow(
            /warmupFrames/u
        );
        expect(() => new GroundTruthAmbientOcclusion({ resolutionScale: 0.2 })).toThrow(
            /resolutionScale/u
        );
        expect(() => new GroundTruthAmbientOcclusion({ directionCount: 5 as 4 })).toThrow(
            /directionCount/u
        );
        expect(() => new GroundTruthAmbientOcclusion({ radius: 0 })).toThrow(/radius/u);
        expect(
            () =>
                new GroundTruthAmbientOcclusion({
                    distanceFadeStart: 20,
                    distanceFadeEnd: 20
                })
        ).toThrow(/distanceFadeEnd/u);
        expect(
            () => new GroundTruthAmbientOcclusion({ normalSource: 'invalid' as 'hybrid' })
        ).toThrow(/normalSource/u);
        expect(() => new ScreenSpaceGlobalIllumination({ resolutionScale: 0.2 })).toThrow(
            /resolutionScale/u
        );
        expect(() => new ScreenSpaceGlobalIllumination({ rayCount: 5 as 4 })).toThrow(/rayCount/u);
        expect(() => new ScreenSpaceGlobalIllumination({ maxRayDistance: 0 })).toThrow(
            /maxRayDistance/u
        );
        expect(() => new ScreenSpaceGlobalIllumination({ denoisePasses: 4 as 3 })).toThrow(
            /denoisePasses/u
        );
        expect(() => new ColorUber({ temperature: 2 }).create()).toThrow(/temperature/u);
        expect(() => new ColorUber({ toneMapping: 'filmic', filmicSlope: 0 }).create()).toThrow(
            /filmic slope/u
        );
        expect(() => new AutoExposure({ minimumEV: -16 })).toThrow(/minimumEV/u);
        expect(() => new AutoExposure({ lowPercentile: 0.4, highPercentile: 0.3 })).toThrow(
            /highPercentile/u
        );
    });

    it('resizes atmosphere and cloud resources with the runtime scene scale', () => {
        const scales = new Map<string, number>();
        let nextHandle = 1;
        let frameIndex = 0;
        const owner = Object.freeze({});
        const nextTexture = (): RenderGraphTextureHandle =>
            nextHandle++ as RenderGraphTextureHandle;
        const rememberScale = (
            name: string,
            descriptor: Readonly<RenderPipelineTextureDescriptor>
        ): void => {
            if ('relativeTo' in descriptor.extent) {
                scales.set(name, descriptor.extent.scale);
            }
        };
        const graph = {
            createTexture(
                name: string,
                descriptor: Readonly<RenderPipelineTextureDescriptor>
            ): RenderGraphTextureHandle {
                rememberScale(name, descriptor);
                return nextTexture();
            },
            importStorageBuffer(_buffer: StorageBuffer): RenderGraphBufferHandle {
                return nextHandle++ as RenderGraphBufferHandle;
            },
            acquireHistoryTexture(
                _key: object,
                descriptor: Readonly<RenderPipelineHistoryTextureDescriptor>
            ): RenderPipelineHistoryTextureResources {
                rememberScale(descriptor.label ?? 'history', descriptor);
                const current = nextTexture();
                return {
                    current,
                    valid: false,
                    generation: 0,
                    historyCount: 1,
                    history: () => current
                };
            },
            invalidateHistoryTexture(_key: object): boolean {
                return true;
            },
            addPass(_pass: unknown, _parameters: unknown): RenderGraphPassHandle {
                return nextHandle++ as RenderGraphPassHandle;
            }
        };
        const camera = new PerspectiveCamera({ aspect: 4 / 3, z: 4 });
        const context = {
            get frameIndex(): number {
                return frameIndex;
            },
            camera,
            output: { width: 160, height: 120 },
            graph,
            acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P {
                return acquireRenderPassParameters(pool, owner, frameIndex);
            },
            writeStorageBuffer(
                _buffer: StorageBuffer,
                _byteOffset: number,
                _data: ArrayBufferView
            ): void {
                // The test only inspects graph descriptors.
            }
        } as unknown as RenderPipelineContext;
        const destroyBuffer = vi.fn();
        const buffer = { destroy: destroyBuffer } as unknown as StorageBuffer;
        const createContext = {
            createStorageBuffer: () => buffer
        } as unknown as RenderPipelineCreateContext;
        const controller = new AtmosphereWeatherController(
            snapshotAtmosphereWeatherOptions({ quality: 'high' }),
            createContext,
            1
        );
        const record = (sceneScale: number): void => {
            const sceneDepth = nextTexture();
            const prerequisites = controller.recordPrerequisites(
                context,
                sceneDepth,
                sceneScale,
                false
            );
            controller.recordComposite(context, {
                sceneColor: nextTexture(),
                sceneDepth,
                sceneScale,
                prerequisites
            });
        };

        record(1);
        expect(scales.get('Volumetric cloud screen-space shadow')).toBe(1);
        expect(scales.get('Physical sky and aerial perspective HDR scene')).toBe(1);
        expect(scales.get('Volumetric cloud radiance history')).toBe(0.625);
        expect(scales.get('Volumetric cloud current radiance and transmittance')).toBe(0.625);
        controller.frameSubmitted(frameIndex);

        scales.clear();
        frameIndex += 1;
        record(0.6);
        expect(scales.get('Volumetric cloud screen-space shadow')).toBe(0.6);
        expect(scales.get('Physical sky and aerial perspective HDR scene')).toBe(0.6);
        expect(scales.get('Physical atmosphere and volumetric cloud HDR scene')).toBe(0.6);
        expect(scales.get('Volumetric cloud radiance history')).toBe(0.375);
        expect(scales.get('Volumetric cloud current radiance and transmittance')).toBe(0.375);
        expect(() => controller.recordPrerequisites(context, nextTexture(), 0, false)).toThrow(
            /sceneScale/u
        );
        controller.destroy();
        expect(destroyBuffer).toHaveBeenCalledOnce();
    });

    it('drives quantized dynamic resolution only from ready complete GPU timelines', () => {
        const controller = new TemporalResolveController(
            snapshotTemporalAAOptions({
                dynamicResolution: {
                    minScale: 0.5,
                    maxScale: 1,
                    initialScale: 1,
                    targetFrameTimeMs: 10,
                    hysteresis: 0.1,
                    response: 1,
                    scaleStep: 0.1,
                    warmupFrames: 2,
                    settlingFrames: 2
                }
            })
        );
        const timeline = (
            frameIndex: number,
            gpuStatus: RenderGraphTimelineSnapshot['gpuStatus'],
            durationMs: number | null
        ): RenderGraphTimelineSnapshot => ({
            frameIndex,
            recordDurationMs: 0,
            compileDurationMs: 0,
            prepareDurationMs: 0,
            executeDurationMs: 0,
            gpuStatus,
            passes: [
                {
                    name: 'measured',
                    kind: 'render',
                    cpuDurationMs: 0,
                    gpuDurationMs: durationMs
                }
            ],
            resources: []
        });

        controller.recordRenderGraphTimeline(timeline(0, 'pending', null));
        controller.recordRenderGraphTimeline(timeline(0, 'ready', 20));
        expect(controller.renderScale).toBe(1);
        controller.recordRenderGraphTimeline(timeline(1, 'ready', 20));
        expect(controller.renderScale).toBe(0.9);
        controller.recordRenderGraphTimeline(timeline(1, 'ready', 20));
        controller.recordRenderGraphTimeline(timeline(2, 'failed', null));
        controller.recordRenderGraphTimeline(timeline(3, 'ready', 20));
        expect(controller.renderScale).toBe(0.9);
        controller.recordRenderGraphTimeline(timeline(4, 'ready', 20));
        expect(controller.renderScale).toBe(0.8);
        expect(controller.dynamicResolutionDiagnostics).toMatchObject({
            renderScale: 0.8,
            smoothedGPUFrameTimeMs: 20,
            sampledFrameCount: 4
        });
        controller.destroy();
        controller.recordRenderGraphTimeline(timeline(5, 'ready', 1));
        expect(controller.renderScale).toBe(0.8);
    });

    it('declares dynamic-resolution timestamp and reactive-mask requirements', () => {
        const feature = new TemporalAA({
            dynamicResolution: { minScale: 0.6, initialScale: 0.8 }
        });
        const fixed = new TemporalAA();
        const dynamicRuntime = feature.create();
        const fixedRuntime = fixed.create();

        expect(feature.requirements.sceneScale).toBe(0.6);
        expect(feature.requirements.requiredFeatures).toContain('timestamp-query');
        expect(dynamicRuntime.usesRenderGraphTimeline).toBe(true);
        expect(fixedRuntime.usesRenderGraphTimeline).toBe(false);
        expect(feature.readDynamicResolutionDiagnostics()).toMatchObject({ renderScale: 0.8 });
        expect(feature.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'r8unorm', use: 'color-attachment' },
                { format: 'r8unorm', use: 'sampled' }
            ])
        );
        dynamicRuntime.destroy();
        fixedRuntime.destroy();
        expect(() => feature.readDynamicResolutionDiagnostics()).toThrow(/exactly one live/u);
    });

    it.each(taaIntegrationBackends)(
        'renders submission-aware SSGI and reuses GTAO attributes on %s',
        async backend => {
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 40,
                height: 32,
                antialias: false,
                renderPipeline: new PostProcessRenderPipelineFactory({
                    groundTruthAmbientOcclusion: {
                        resolutionScale: 0.5,
                        directionCount: 4,
                        stepCount: 3
                    },
                    screenSpaceGlobalIllumination: {
                        resolutionScale: 0.5,
                        rayCount: 4,
                        stepCount: 6,
                        denoisePasses: 2
                    },
                    bloom: false
                })
            });
            activeRenderers.push(renderer);
            const scene = new Node();
            const material = new PBRMaterial({
                baseColor: new Color(0.7, 0.2, 0.08),
                metallic: 0,
                roughness: 0.8
            });
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry({ width: 3, height: 0.2, depth: 3 }),
                    material,
                    y: -0.8,
                    frustumTest: false
                })
            );
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry(),
                    material,
                    frustumTest: false
                })
            );
            const camera = new PerspectiveCamera({ aspect: 5 / 4, z: 4 });
            const observed = observePassLabels(rhiDevice(renderer));

            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toEqual(
                expect.arrayContaining([
                    'GTAO material attributes',
                    'SSGI stochastic diffuse ray trace',
                    'SSGI initialize radiance history',
                    'SSGI edge-aware a-trous denoise 1',
                    'SSGI edge-aware a-trous denoise 2',
                    'SSGI bilateral full-resolution upsample',
                    'SSGI linear HDR diffuse composite'
                ])
            );
            expect(observed.labels).not.toContain('SSGI material attributes');
            expect(observed.labels).not.toContain('SSGI motion and logarithmic depth');

            observed.labels.length = 0;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('SSGI variance-clipped temporal resolve');

            observed.labels.length = 0;
            camera.invalidateTransformHistory();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('SSGI initialize radiance history');
            observed.restore();
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
        },
        30_000
    );

    it('produces standalone SSGI attributes and motion when GTAO is disabled', async () => {
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 20,
            height: 16,
            antialias: false,
            renderPipeline: new PostProcessRenderPipelineFactory({
                screenSpaceGlobalIllumination: {
                    resolutionScale: 0.5,
                    rayCount: 4,
                    stepCount: 6,
                    denoisePasses: 1
                },
                bloom: false
            })
        });
        activeRenderers.push(renderer);
        const scene = new Node();
        scene.addChild(
            new Mesh({
                geometry: new BoxGeometry(),
                material: new PBRMaterial(),
                frustumTest: false
            })
        );
        const camera = new PerspectiveCamera({ aspect: 5 / 4, z: 4 });
        const observed = observePassLabels(rhiDevice(renderer));

        renderer.render(scene, camera);
        await renderer.waitForIdle();
        expect(observed.labels).toEqual(
            expect.arrayContaining([
                'SSGI material attributes',
                'SSGI motion and logarithmic depth',
                'SSGI stochastic diffuse ray trace',
                'SSGI linear HDR diffuse composite'
            ])
        );
        observed.restore();
    });

    it.each(taaIntegrationBackends)(
        'renders submission-aware GTAO and indirect-only PBR integration on %s',
        async backend => {
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 40,
                height: 32,
                antialias: false,
                renderPipeline: new PostProcessRenderPipelineFactory({
                    groundTruthAmbientOcclusion: {
                        resolutionScale: 0.5,
                        directionCount: 4,
                        stepCount: 3
                    },
                    bloom: false
                })
            });
            activeRenderers.push(renderer);
            const scene = new Node();
            const material = new PBRMaterial({
                baseColor: new Color(0.7, 0.62, 0.5),
                metallic: 0,
                roughness: 0.7
            });
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry({ width: 3, height: 0.2, depth: 3 }),
                    material,
                    y: -0.8,
                    frustumTest: false
                })
            );
            scene.addChild(
                new Mesh({
                    geometry: new BoxGeometry(),
                    material,
                    frustumTest: false
                })
            );
            const camera = new PerspectiveCamera({ aspect: 5 / 4, z: 4 });
            const observed = observePassLabels(rhiDevice(renderer));

            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toEqual(
                expect.arrayContaining([
                    'GTAO rotated horizon search',
                    'GTAO initialize temporal history',
                    'GTAO edge-aware filter 1',
                    'GTAO bilateral full-resolution upsample'
                ])
            );

            observed.labels.length = 0;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('GTAO production temporal resolve');

            observed.labels.length = 0;
            camera.invalidateTransformHistory();
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('GTAO initialize temporal history');
            observed.restore();
            expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
        }
    );

    it.each(taaIntegrationBackends)(
        'isolates per-camera GTAO uniforms while decoding logarithmic depth on %s',
        async backend => {
            const first = new PerspectiveCamera({
                aspect: 1,
                near: 0.1,
                far: 80,
                z: 5,
                priority: -1
            });
            const second = new PerspectiveCamera({
                aspect: 1,
                near: 0.2,
                far: 160,
                x: 1,
                z: 6,
                priority: 1,
                clearColor: false
            });
            const stage = await Stage.create({
                backend,
                width: 40,
                height: 40,
                pixelRatio: 1,
                antialias: false,
                useLogDepth: true,
                cameras: [second, first],
                renderPipeline: new PostProcessRenderPipelineFactory({
                    groundTruthAmbientOcclusion: {
                        quality: 'low',
                        resolutionScale: 1
                    },
                    bloom: false
                })
            });
            try {
                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({
                        baseColor: new Color(0.7, 0.6, 0.5),
                        roughness: 0.8
                    }),
                    frustumTest: false
                }).addTo(stage);
                const observed = observePassLabels(rhiDevice(stage.renderer));
                stage.tick(16);
                await stage.renderer.waitForIdle();
                expect(
                    observed.labels.filter(label => label === 'GTAO rotated horizon search')
                ).toHaveLength(2);
                observed.restore();
            } finally {
                stage.destroy();
            }
        }
    );

    it('rejects incompatible GTAO logarithmic-depth camera contracts while recording', async () => {
        const camera = new OrthographicCamera({
            left: -1,
            right: 1,
            top: 1,
            bottom: -1,
            near: 0.1,
            far: 80,
            z: 5
        });
        const stage = await Stage.create({
            backend: 'webgl2',
            width: 24,
            height: 24,
            pixelRatio: 1,
            antialias: false,
            useLogDepth: true,
            cameras: [camera],
            renderPipeline: new PostProcessRenderPipelineFactory({
                groundTruthAmbientOcclusion: { quality: 'low' },
                bloom: false
            })
        });
        try {
            let causeMessage = '';
            try {
                stage.tick(16);
                throw new Error('Expected GTAO logarithmic-depth validation to reject the camera');
            } catch (error) {
                if (error instanceof Error && error.cause instanceof Error) {
                    causeMessage = error.cause.message;
                }
            }
            expect(causeMessage).toMatch(/standard-Z perspective camera/u);
        } finally {
            stage.destroy();
        }
    });

    it.each(taaIntegrationBackends)(
        'renders fixed-scale TAAU, HDR bloom, and transmissive composition on %s',
        async backend => {
            const renderer = await Renderer.create({
                backend,
                domElement: document.createElement('canvas'),
                width: 32,
                height: 24,
                antialias: false,
                renderPipeline: new PostProcessRenderPipelineFactory({
                    temporalAA: { renderScale: 0.75 },
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
            const observed = observePassLabels(rhiDevice(renderer));

            expect(() => {
                renderer.render(scene, camera);
            }).not.toThrow();
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA upscale initialize history');
            observed.labels.length = 0;
            expect(() => {
                renderer.render(scene, camera);
            }).not.toThrow();
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA temporal upscale');
            observed.restore();
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
            expect(camera.projectionJitterX).toBe(0);
            expect(camera.projectionJitterY).toBe(0);

            observed.labels.length = 0;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA production resolve');
            expect(camera.projectionJitterX).toBe(0);
            expect(camera.projectionJitterY).toBe(0);

            observed.labels.length = 0;
            camera.fov = 72;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA initialize history');
            expect(camera.projectionJitterX).toBe(0);
            expect(camera.projectionJitterY).toBe(0);

            observed.labels.length = 0;
            renderer.render(scene, camera);
            await renderer.waitForIdle();
            expect(observed.labels).toContain('TemporalAA production resolve');

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
            expect(observed.labels).toContain('TemporalAA production resolve');
            observed.restore();
        }
    );
});
