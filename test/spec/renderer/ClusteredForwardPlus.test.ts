import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import Skeleton from '../../../src/core/Skeleton';
import SkinnedMesh from '../../../src/core/SkinnedMesh';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import MorphGeometry from '../../../src/geometry/MorphGeometry';
import AmbientLight from '../../../src/light/AmbientLight';
import AreaLight from '../../../src/light/AreaLight';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PointLight from '../../../src/light/PointLight';
import SpotLight from '../../../src/light/SpotLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Color from '../../../src/math/Color';
import Matrix3 from '../../../src/math/Matrix3';
import Matrix4 from '../../../src/math/Matrix4';
import Vector3 from '../../../src/math/Vector3';
import ParticleSystem from '../../../addon-particle/src/ParticleSystem';
import ParticleSystemDefinition from '../../../addon-particle/src/ParticleSystemDefinition';
import Renderer from '../../../src/render/Renderer';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import {
    acquireRenderPassParameters,
    type RenderPassParameterPool
} from '../../../src/render/pipeline/RenderPassParameterPool';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineShadowResources
} from '../../../src/render/pipeline/RenderPipeline';
import {
    snapshotVirtualShadowMapOptions,
    VirtualShadowMapController,
    virtualShadowBucketOffsetRange,
    virtualShadowClearIndirectOffset,
    virtualShadowIndirectOffset,
    virtualShadowPhysicalPageRange,
    type VirtualShadowFrameResources,
    type VirtualShadowRecordInputs
} from '../../../src/render/pipeline/VirtualShadowMaps';
import { ComputeRenderPass, FullscreenRenderPass } from '../../../src/render/pipeline/passes';
import {
    ScreenSpaceReflectionsController,
    snapshotScreenSpaceReflectionsOptions
} from '../../../src/render/postprocessing/ScreenSpaceReflections';
import { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';
import type { RHIDevice } from '../../../src/render/rhi/core';
import type { StorageBuffer } from '../../../src/render/StorageBuffer';
import Texture from '../../../src/texture/Texture';
import { RGBA, TEXTURE_2D, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { RGBA8 } from '../../../src/constants/webgl2';

declare const __HILO3D_GITHUB_ACTIONS_COVERAGE__: boolean;

function rgbaTexture(
    pixel: readonly [number, number, number, number],
    uv: 0 | 1
): Texture<Uint8Array> {
    return new Texture({
        image: new Uint8Array(pixel),
        target: TEXTURE_2D,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        width: 1,
        height: 1,
        uv
    });
}

describe('ClusteredForwardPlusPipelineFactory', () => {
    it('declares the complete WebGPU storage, compute, indirect, and texture contract', () => {
        const geometry = new BoxGeometry();
        const material = new PBRMaterial();
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            maxObjects: 1_024,
            maxLightIndices: 65_536
        });

        expect(factory.name).toBe('GPU Scene + Clustered Forward+');
        expect(factory.requirements.requiredCapabilities).toEqual([
            'storage-buffer',
            'storage-texture',
            'compute-pass',
            'indirect-draw'
        ]);
        expect(factory.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 22,
            maxStorageBuffersPerShaderStage: 8,
            maxStorageTexturesPerShaderStage: 1,
            maxSampledTexturesPerShaderStage: 12,
            maxSamplersPerShaderStage: 11,
            maxComputeInvocationsPerWorkgroup: 256
        });
        expect(
            factory.requirements.requiredLimits?.['maxComputeWorkgroupsPerDimension']
        ).toBeGreaterThan(0);
        expect(factory.requirements.requiredTextureFormats).toContainEqual({
            format: 'rg32float',
            use: 'storage'
        });

        const withTemporalAA = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {}
        });
        expect(withTemporalAA.requirements.requiredLimits).toMatchObject({
            maxColorAttachments: 4
        });
        expect(withTemporalAA.requirements.requiredTextureFormats).toContainEqual({
            format: 'r32float',
            use: 'color-attachment'
        });
        expect(withTemporalAA.requirements.requiredTextureFormats).toContainEqual({
            format: 'r8unorm',
            use: 'color-attachment'
        });
        const withDynamicResolution = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: { dynamicResolution: { minScale: 0.6 } }
        });
        expect(withDynamicResolution.requirements.requiredFeatures).toContain('timestamp-query');

        const withoutHiZ = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            hiZ: false,
            tileSize: 128,
            zSlices: 1,
            maxViewportWidth: 9_000,
            maxViewportHeight: 1
        });
        expect(withoutHiZ.requirements.requiredCapabilities).not.toContain('storage-texture');
        expect(withoutHiZ.requirements.requiredTextureFormats).not.toContainEqual({
            format: 'rg32float',
            use: 'storage'
        });
        expect(withoutHiZ.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 22,
            maxSampledTexturesPerShaderStage: 11
        });

        const maximumHiZ = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            maxViewportWidth: 8_192,
            maxViewportHeight: 8_192
        });
        expect(maximumHiZ.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 22,
            maxSampledTexturesPerShaderStage: 13
        });

        const withVirtualShadows = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            maxObjects: 64,
            virtualShadows: {
                virtualResolution: 1_024,
                pageSize: 128,
                physicalPageCount: 16,
                maxPageUpdatesPerFrame: 8,
                directionalClipmapLevels: 3
            }
        });
        expect(withVirtualShadows.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 26,
            maxSampledTexturesPerShaderStage: 13,
            maxSamplersPerShaderStage: 13,
            maxTextureDimension2D: 512
        });
        expect(withVirtualShadows.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba32float', use: 'sampled' },
                { format: 'rgba32float', use: 'storage' },
                { format: 'depth32float', use: 'sampled' }
            ])
        );

        const withReflections = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {},
            screenSpaceReflections: {}
        });
        expect(withReflections.requirements.requiredLimits).toMatchObject({
            maxStorageTexturesPerShaderStage: 4,
            maxSampledTexturesPerShaderStage: 16,
            maxColorAttachments: 4
        });
        expect(withReflections.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'storage' },
                { format: 'r32float', use: 'storage' },
                { format: 'rg32float', use: 'storage' },
                { format: 'rgba8unorm', use: 'color-attachment' },
                { format: 'rgba8unorm', use: 'filterable-sampled' }
            ])
        );

        const fullResolution4KReflections = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            maxObjects: 1,
            maxLights: 1,
            maxLightIndices: 1,
            maxLightsPerCluster: 1,
            zSlices: 1,
            maxViewportWidth: 3_840,
            maxViewportHeight: 2_160,
            temporalAA: {},
            screenSpaceReflections: { resolutionScale: 1 }
        });
        expect(
            fullResolution4KReflections.requirements.requiredLimits?.[
                'maxComputeWorkgroupsPerDimension'
            ]
        ).toBe(65_535);

        const withGTAO = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {},
            groundTruthAmbientOcclusion: {}
        });
        expect(withGTAO.requirements.requiredLimits).toMatchObject({
            maxSampledTexturesPerShaderStage: 12,
            maxSamplersPerShaderStage: 12
        });

        const withSSGI = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            temporalAA: {},
            screenSpaceGlobalIllumination: {}
        });
        expect(withSSGI.requirements.requiredLimits).toMatchObject({
            maxSampledTexturesPerShaderStage: 12,
            maxColorAttachments: 4
        });
        expect(withSSGI.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'color-attachment' },
                { format: 'rgba16float', use: 'filterable-sampled' }
            ])
        );

        const withVolumetrics = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            hiZ: false,
            volumetricLighting: { quality: 'ultra' }
        });
        expect(withVolumetrics.requirements.requiredCapabilities).toContain('storage-texture');
        expect(withVolumetrics.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 22,
            maxStorageTexturesPerShaderStage: 2
        });
        expect(withVolumetrics.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'storage' },
                { format: 'r32float', use: 'storage' },
                { format: 'r32float', use: 'sampled' }
            ])
        );

        const withWeather = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material }],
            hiZ: false,
            autoExposure: {},
            atmosphere: { quality: 'ultra' },
            volumetricLighting: {}
        });
        expect(withWeather.requirements.requiredCapabilities).toContain('storage-texture');
        expect(withWeather.requirements.requiredLimits).toMatchObject({
            maxBindingsPerBindGroup: 24,
            maxStorageTexturesPerShaderStage: 2,
            maxSamplersPerShaderStage: 12
        });
        expect(withWeather.requirements.requiredTextureFormats).toEqual(
            expect.arrayContaining([
                { format: 'rgba16float', use: 'storage' },
                { format: 'rgba16float', use: 'filterable-sampled' },
                { format: 'r32float', use: 'storage' }
            ])
        );
    });

    it('constructs, reads, and releases the screen-space reflection runtime', async () => {
        const counters = new Uint32Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const destroy = vi.fn();
        const read = vi.fn(() =>
            Promise.resolve({
                data: new Uint8Array(counters.buffer),
                byteOffset: 0,
                byteLength: counters.byteLength
            })
        );
        const diagnostics = { destroy, read } as unknown as StorageBuffer;
        const createStorageBuffer = vi.fn(() => diagnostics);
        const context = { createStorageBuffer } as unknown as RenderPipelineCreateContext;
        const settings = snapshotScreenSpaceReflectionsOptions({ maxSteps: 8 });

        expect(() => new ScreenSpaceReflectionsController(settings, context, 1, 0)).toThrow(
            /at least one Hi-Z level/u
        );

        const controller = new ScreenSpaceReflectionsController(settings, context, 0.75, 12);
        expect(createStorageBuffer).toHaveBeenCalledOnce();
        expect(createStorageBuffer).toHaveBeenCalledWith({
            label: 'Screen-space reflections diagnostics',
            byteLength: 32,
            usage: ['storage', 'copy-source'],
            recovery: 'reinitialize'
        });
        await expect(controller.readDiagnostics()).resolves.toEqual({
            activeTileCount: 1,
            activePixelCount: 2,
            hitPixelCount: 3,
            missPixelCount: 4,
            uncertainPixelCount: 5,
            backfaceRejectedPixelCount: 6,
            historyAcceptedPixelCount: 7,
            historyRejectedPixelCount: 8
        });

        controller.destroy();
        controller.destroy();
        expect(destroy).toHaveBeenCalledOnce();
        await expect(controller.readDiagnostics()).rejects.toThrow(/is destroyed/u);
    });

    it('records and transactionally owns virtual-shadow page state without GPU readback', async () => {
        const settings = snapshotVirtualShadowMapOptions({
            virtualResolution: 512,
            pageSize: 64,
            physicalPageCount: 4,
            maxPageUpdatesPerFrame: 2,
            directionalClipmapLevels: 2,
            firstDirectionalClipmapExtent: 16
        });
        const counters = new Uint32Array([9, 8, 7, 6, 5, 4, 3, 2]);
        const created: {
            readonly label: string;
            readonly destroy: ReturnType<typeof vi.fn>;
        }[] = [];
        type StorageDescriptor = Parameters<RenderPipelineCreateContext['createStorageBuffer']>[0];
        const createStorageBuffer = vi.fn((descriptor: StorageDescriptor): StorageBuffer => {
            const destroy = vi.fn();
            const data =
                descriptor.label === 'Virtual shadow request, residency, and update counters'
                    ? new Uint8Array(counters.buffer)
                    : new Uint8Array(descriptor.byteLength);
            created.push({ label: descriptor.label ?? '', destroy });
            return {
                byteLength: descriptor.byteLength,
                destroy,
                read: vi.fn(() =>
                    Promise.resolve({
                        data,
                        byteOffset: data.byteOffset,
                        byteLength: data.byteLength
                    })
                )
            } as unknown as StorageBuffer;
        });
        const createContext = { createStorageBuffer } as unknown as RenderPipelineCreateContext;
        const controller = new VirtualShadowMapController(
            settings,
            createContext,
            [{ indexCount: 36 }, { indexCount: 12 }],
            3,
            64
        );

        expect(createStorageBuffer).toHaveBeenCalledTimes(12);
        expect(created.map(entry => entry.label)).toEqual(
            expect.arrayContaining([
                'Virtual shadow directional clipmap database',
                'Virtual shadow physical residency state A',
                'Virtual shadow physical residency state B',
                'Virtual shadow page bucket indirect arguments'
            ])
        );
        expect(virtualShadowPhysicalPageRange(2)).toEqual({
            byteOffset: 512,
            byteLength: 32
        });
        expect(virtualShadowBucketOffsetRange(2, 1, 3)).toEqual({
            byteOffset: 1_792,
            byteLength: 4
        });
        expect(virtualShadowIndirectOffset(2, 1, 3)).toBe(140);
        expect(virtualShadowClearIndirectOffset(2)).toBe(32);

        const light = new DirectionalLight({ direction: new Vector3(1, -2, 1) });
        const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 30 });
        camera.setPosition(4, 3, 6).lookAt(new Vector3()).updateViewProjectionMatrix();
        const shadows = {
            depthMode: 'standard',
            directionalLights: [light],
            directionalShadowCount: 1
        } as unknown as Readonly<RenderPipelineShadowResources>;
        const noDirectionalShadows = {
            depthMode: 'reversed',
            directionalLights: [],
            directionalShadowCount: 0
        } as unknown as Readonly<RenderPipelineShadowResources>;
        const owner = {};
        const passNames: string[] = [];
        let nextHandle = 10;
        const makeContext = (frameIndex: number, historyValid: boolean): RenderPipelineContext => {
            const graph = {
                acquireHistoryTexture: vi.fn(() => ({
                    current: 1,
                    valid: historyValid,
                    generation: 0,
                    historyCount: historyValid ? 1 : 0,
                    history: vi.fn(() => 2)
                })),
                acquirePersistentTarget: vi.fn(() => ({
                    width: settings.physicalAtlasWidth,
                    height: settings.physicalAtlasHeight,
                    sampleCount: 1,
                    colorAttachmentCount: 0,
                    color: vi.fn(),
                    depthStencil: 3
                })),
                importStorageBuffer: vi.fn(() => nextHandle++),
                addPass: vi.fn((pass: { readonly name: string }) => {
                    passNames.push(pass.name);
                    return nextHandle++;
                })
            };
            return {
                frameIndex,
                camera,
                viewport: [0, 0, 64, 64],
                graph,
                writeStorageBuffer: vi.fn(),
                acquirePassParameters: (pool: RenderPassParameterPool<object>): object =>
                    acquireRenderPassParameters(pool, owner, frameIndex)
            } as unknown as RenderPipelineContext;
        };
        const makeInputs = (
            shadowResources: Readonly<RenderPipelineShadowResources>,
            activeObjectHighWater: number,
            hiZHistoryValid: boolean
        ): Readonly<VirtualShadowRecordInputs> =>
            ({
                frameBuffer: 20,
                objects: 21,
                bucketData: 22,
                previousHiZ: hiZHistoryValid ? 23 : null,
                hiZHistoryValid,
                shadows: shadowResources,
                activeObjectHighWater,
                previousViewMatrix: camera.viewMatrix.elements,
                cameraHistoryValid: hiZHistoryValid
            }) as unknown as Readonly<VirtualShadowRecordInputs>;

        const first = controller.record(
            makeContext(1, false),
            makeInputs(noDirectionalShadows, 0, false)
        );
        expect(first).toMatchObject<Partial<VirtualShadowFrameResources>>({
            clearAtlas: true,
            directionalLightCount: 0
        });
        expect(passNames).not.toContain('Virtual shadow receiver depth page requests');
        controller.frameDiscarded(0);
        controller.frameDiscarded(1);

        passNames.length = 0;
        const second = controller.record(makeContext(2, true), makeInputs(shadows, 3, true));
        expect(second.clearAtlas).toBe(true);
        expect(passNames).toEqual(
            expect.arrayContaining([
                'Virtual shadow receiver depth page requests',
                'Virtual shadow changed-caster page invalidation',
                'Virtual shadow deterministic page-table allocation and remap',
                'Virtual shadow per-page caster culling',
                'Virtual shadow per-page bucket prefix',
                'Virtual shadow per-page visible caster compact'
            ])
        );
        controller.frameSubmitted(1);
        controller.frameSubmitted(2);

        const third = controller.record(makeContext(3, true), makeInputs(shadows, 3, true));
        expect(third.clearAtlas).toBe(false);
        controller.frameSubmitted(3);
        controller.invalidateAll();
        const invalidated = controller.record(makeContext(4, true), makeInputs(shadows, 3, false));
        expect(invalidated.clearAtlas).toBe(true);
        controller.frameDiscarded(4);

        await expect(controller.readDiagnostics()).resolves.toEqual({
            requestedPageCount: 9,
            renderedPageCount: 8,
            deferredPageCount: 7,
            residentPageCount: 6,
            evictionCount: 5,
            invalidatedPageCount: 4,
            physicalPageCapacity: 4,
            directionalClipmapLevelCount: 2
        });
        controller.destroy();
        controller.destroy();
        expect(created.every(entry => entry.destroy.mock.calls.length === 1)).toBe(true);
        expect(() => {
            controller.invalidateAll();
        }).toThrow(/is destroyed/u);
        expect(() => controller.record(makeContext(5, true), makeInputs(shadows, 3, true))).toThrow(
            /is destroyed/u
        );
        await expect(controller.readDiagnostics()).rejects.toThrow(/is destroyed/u);

        const failingCreateStorageBuffer = vi.fn(
            (descriptor: StorageDescriptor): StorageBuffer =>
                ({
                    byteLength: descriptor.byteLength,
                    destroy: vi.fn(() => {
                        if (descriptor.label === 'Virtual shadow receiver request bitset') {
                            throw new Error('injected destroy failure');
                        }
                    })
                }) as unknown as StorageBuffer
        );
        const failingController = new VirtualShadowMapController(
            settings,
            {
                createStorageBuffer: failingCreateStorageBuffer
            } as unknown as RenderPipelineCreateContext,
            [{ indexCount: 3 }],
            1,
            64
        );
        expect(() => {
            failingController.destroy();
        }).toThrow(/resource destruction failed/u);
        expect(() => {
            failingController.destroy();
        }).not.toThrow();
    });

    it('validates every virtual-shadow option boundary', () => {
        expect(() => snapshotVirtualShadowMapOptions(null)).toThrow(/must be an object/u);
        expect(() => snapshotVirtualShadowMapOptions([])).toThrow(/must be an object/u);
        expect(() => snapshotVirtualShadowMapOptions({ virtualResolution: 511 })).toThrow(
            /powers of two/u
        );
        expect(() => snapshotVirtualShadowMapOptions({ pageSize: 32 })).toThrow(
            /between 64 and 256/u
        );
        expect(() => snapshotVirtualShadowMapOptions({ pageSize: 512 })).toThrow(
            /between 64 and 256/u
        );
        expect(() =>
            snapshotVirtualShadowMapOptions({ virtualResolution: 64, pageSize: 64 })
        ).toThrow(/between 8 and 128 pages/u);
        expect(() =>
            snapshotVirtualShadowMapOptions({ virtualResolution: 65_536, pageSize: 64 })
        ).toThrow(/between 8 and 128 pages/u);
        expect(() => snapshotVirtualShadowMapOptions({ physicalPageCount: 257 })).toThrow(
            /cannot exceed 256/u
        );
        expect(() => snapshotVirtualShadowMapOptions({ directionalClipmapLevels: 5 })).toThrow(
            /cannot exceed four/u
        );
        expect(() => snapshotVirtualShadowMapOptions({ firstDirectionalClipmapExtent: 0 })).toThrow(
            /finite and positive/u
        );
        expect(() => snapshotVirtualShadowMapOptions({ maxPageUpdatesPerFrame: 0 })).toThrow(
            /positive safe integer/u
        );
    });

    it('validates bucket identities, opaque materials, and unique LOD thresholds', () => {
        const geometry = new BoxGeometry();
        const material = new PBRMaterial();
        const transparent = new PBRMaterial({
            compositing: { mode: 'alpha-blend', premultiplied: true }
        });
        const manifestMesh = new Mesh({
            geometry: new BoxGeometry({ widthSegments: 2 }),
            material: new PBRMaterial({ clearcoatFactor: 0.5 })
        });

        expect(() => new ClusteredForwardPlusPipelineFactory({ buckets: [] })).toThrow(
            /at least one GPU Scene bucket/u
        );
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material: transparent }]
                })
        ).toThrow(/opaque and unblended/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [
                        {
                            geometry,
                            material,
                            lods: [
                                { geometry: new BoxGeometry(), maximumProjectedRadius: 24 },
                                { geometry: new BoxGeometry(), maximumProjectedRadius: 24 }
                            ]
                        }
                    ]
                })
        ).toThrow(/LOD thresholds must be unique/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    tileSize: 4
                })
        ).toThrow(/tileSize must be between 8 and 128/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [
                        {
                            geometry,
                            material: new PBRMaterial({
                                coverage: { mode: 'mask', cutoff: 0.5 }
                            })
                        }
                    ]
                })
        ).not.toThrow();
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [
                        {
                            geometry,
                            material: new PBRMaterial({
                                coverage: { mode: 'alpha-to-coverage', cutoff: 0.5 }
                            })
                        }
                    ]
                })
        ).toThrow(/unsupported raster or alpha mode/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material: new PBRMaterial({ clearcoatFactor: 0.5 }) }]
                })
        ).toThrow(/unsupported layered PBR feature/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry: new MorphGeometry(), material }]
                })
        ).toThrow(/must not use morph geometry/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    hiZ: 'true'
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/hiZ must be a boolean/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    hiZ: false,
                    virtualShadows: {}
                })
        ).toThrow(/virtual shadows require hiZ/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    virtualShadows: { pageSize: 96 }
                })
        ).toThrow(/powers of two/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    virtualShadows: { physicalPageCount: 4, maxPageUpdatesPerFrame: 5 }
                })
        ).toThrow(/cannot exceed physicalPageCount/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: { varianceGamma: 8 }
                })
        ).toThrow(/varianceGamma/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    screenSpaceReflections: {}
                })
        ).toThrow(/require temporalAA/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    groundTruthAmbientOcclusion: {}
                })
        ).toThrow(/requires temporalAA/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    screenSpaceGlobalIllumination: {}
                })
        ).toThrow(/requires temporalAA/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: {},
                    screenSpaceGlobalIllumination: { stepCount: 7 as 6 }
                })
        ).toThrow(/stepCount/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    hiZ: false,
                    temporalAA: {},
                    screenSpaceReflections: {}
                })
        ).toThrow(/require hiZ/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: {},
                    screenSpaceReflections: { maxSteps: 7 }
                })
        ).toThrow(/maxSteps/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: {},
                    screenSpaceReflections: { maxRayDistance: 1, stride: 0.3 }
                })
        ).toThrow(/at least four stride steps/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    temporalAA: {},
                    screenSpaceReflections: { maxRayDistance: 1, thickness: 0.6 }
                })
        ).toThrow(/must not exceed half maxRayDistance/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    volumetricLighting: { quality: 'cinematic' }
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/quality/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    volumetricLighting: { resolutionScale: 2 }
                })
        ).toThrow(/resolutionScale/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    variantManifest: {
                        entries: [{ mesh: manifestMesh }, { mesh: manifestMesh }],
                        maxVariants: 1,
                        warmupBatchSize: 1
                    }
                })
        ).not.toThrow();
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    variantManifest: { entries: [{ mesh: new Mesh() }] }
                })
        ).toThrow(/native clustered PBR/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    variantManifest: { entries: [], maxVariants: 0 }
                })
        ).toThrow(/positive safe integer/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    volumetricLighting: {
                        localVolumes: [
                            {
                                shape: 'sphere',
                                center: new Vector3(),
                                radius: 0,
                                density: 1
                            }
                        ]
                    }
                })
        ).toThrow(/radius/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    toneMapping: 'linear'
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/toneMapping/u);
        expect(
            () =>
                new ClusteredForwardPlusPipelineFactory({
                    buckets: [{ geometry, material }],
                    atmosphere: { quality: 'cinematic' }
                } as unknown as ConstructorParameters<
                    typeof ClusteredForwardPlusPipelineFactory
                >[0])
        ).toThrow(/quality/u);
    });

    it('requests limits for every configured cluster, geometry, and dispatch allocation', () => {
        const geometry = new BoxGeometry();
        const factory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry, material: new PBRMaterial() }],
            maxObjects: 1,
            maxLights: 1,
            maxLightIndices: 1,
            maxLightsPerCluster: 1,
            tileSize: 8,
            zSlices: 64,
            maxViewportWidth: 4_096,
            maxViewportHeight: 2_160
        });
        const maxClusters = Math.ceil(4_096 / 8) * Math.ceil(2_160 / 8) * 64;
        const clusterGridBytes = maxClusters * 8;
        const clusterBlockCount = Math.ceil(maxClusters / 256);

        expect(factory.requirements.requiredLimits).toMatchObject({
            maxStorageBufferBindingSize: clusterGridBytes,
            maxBufferSize: clusterGridBytes,
            maxComputeWorkgroupsPerDimension: clusterBlockCount
        });

        const vertexValues = new Float32Array(4_096 * 3);
        const geometryBufferBytes = vertexValues.byteLength;
        const largeGeometry = new Geometry({
            vertices: new GeometryData(vertexValues, 3),
            normals: new GeometryData(vertexValues.slice(), 3),
            indices: new GeometryData(new Uint16Array([0, 0, 0]), 1)
        });
        const geometryFactory = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry: largeGeometry, material: new PBRMaterial() }],
            maxObjects: 1,
            maxLights: 1,
            maxLightIndices: 1,
            maxLightsPerCluster: 1,
            tileSize: 8,
            zSlices: 1,
            maxViewportWidth: 8,
            maxViewportHeight: 8
        });

        expect(geometryFactory.requirements.requiredLimits).toMatchObject({
            maxStorageBufferBindingSize: geometryBufferBytes,
            maxBufferSize: geometryBufferBytes
        });
    });

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'shades globally sorted layered, morph, and skinned transparent PBR from clustered lights',
        async () => {
            const bucketGeometry = new BoxGeometry();
            const bucketMaterial = new PBRMaterial();
            const layeredMesh = new Mesh({
                geometry: new BoxGeometry({ widthSegments: 2 }),
                material: new PBRMaterial({
                    baseColor: new Color(0.35, 0.9, 0.25),
                    clearcoatFactor: 0.75,
                    clearcoatRoughnessFactor: 0.18,
                    anisotropyStrength: 0.45,
                    iridescenceFactor: 0.55,
                    iridescenceThicknessMinimum: 160,
                    iridescenceThicknessMaximum: 360
                }),
                y: 1.05,
                scaleX: 0.55,
                scaleY: 0.55,
                scaleZ: 0.55,
                frustumTest: false
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry: bucketGeometry, material: bucketMaterial }],
                maxObjects: 1,
                maxLights: 4,
                maxLightIndices: 4_096,
                maxLightsPerCluster: 4,
                maxViewportWidth: 64,
                maxViewportHeight: 32,
                hiZ: false,
                bloomStrength: 0,
                temporalAA: { renderScale: 0.5 },
                variantManifest: {
                    entries: [{ mesh: layeredMesh, shadowed: false }],
                    maxVariants: 4,
                    warmupBatchSize: 1
                }
            });
            const canvas = document.createElement('canvas');
            const rendererDiagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: canvas,
                width: 64,
                height: 32,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            renderer.clearColor = new Color(0, 0, 0);
            const target = renderer.createRenderTarget({
                width: 64,
                height: 32,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
            });
            const particleSystem = new ParticleSystem({
                definition: ParticleSystemDefinition.create({
                    emitters: [
                        {
                            name: 'clustered-temporal-stateless',
                            capacity: 64,
                            execution: 'stateless',
                            duration: 4,
                            emission: { rateOverTime: 16 },
                            initialize: {
                                lifetime: 2,
                                direction: [0, 1, 0],
                                speed: 0.35,
                                size: 0.35,
                                color: [1, 0.55, 0.12, 0.8]
                            },
                            renderers: [{ type: 'sprite', blend: 'additive', depthTest: false }]
                        }
                    ]
                }),
                seed: 31,
                autoPlay: false,
                compilationEnvironment: { backend: 'webgpu' }
            });
            particleSystem.simulate(0.5);
            try {
                const scene = new Node();
                particleSystem.addTo(scene);
                const morphSource = new BoxGeometry({ widthSegments: 2 });
                const morphVertices = morphSource.vertices;
                if (morphVertices === null) throw new Error('Expected morph source vertices');
                const morphTarget = new Float32Array(morphVertices.data.length);
                for (let index = 0; index < morphTarget.length; index += 3) {
                    morphTarget[index] = 0.08;
                }
                const morphGeometry = new MorphGeometry({
                    vertices: morphSource.vertices,
                    normals: morphSource.normals,
                    uvs: morphSource.uvs,
                    indices: morphSource.indices,
                    weights: new Float32Array([0.5]),
                    targets: {
                        vertices: [new GeometryData(morphTarget, 3)]
                    }
                });
                const morphMaterial = new PBRMaterial({
                    compositing: { mode: 'alpha-blend', premultiplied: true },
                    cullMode: 'none',
                    opacity: 0.72,
                    baseColor: new Color(0.95, 0.18, 0.08),
                    metallic: 0.05,
                    roughness: 0.32,
                    clearcoatFactor: 0.85,
                    clearcoatRoughnessFactor: 0.16
                });
                const morphMesh = new Mesh({
                    geometry: morphGeometry,
                    material: morphMaterial,
                    x: -0.75,
                    z: -0.6,
                    frustumTest: false
                });

                const skinGeometry = new BoxGeometry({ widthSegments: 2 });
                const skinVertices = skinGeometry.vertices;
                if (skinVertices === null) throw new Error('Expected skin source vertices');
                const skinIndices = new Uint8Array(skinVertices.count * 4);
                const skinWeights = new Uint8Array(skinVertices.count * 4);
                for (let index = 0; index < skinVertices.count; index += 1) {
                    skinWeights[index * 4] = 255;
                }
                skinGeometry.skinIndices = new GeometryData(skinIndices, 4);
                skinGeometry.skinWeights = new GeometryData(skinWeights, 4, {
                    normalized: true
                });
                const joint = new Node();
                joint.updateMatrixWorld(true);
                const skinMaterial = new PBRMaterial({
                    compositing: { mode: 'alpha-blend', premultiplied: true },
                    cullMode: 'none',
                    opacity: 0.68,
                    baseColor: new Color(0.05, 0.3, 1),
                    metallic: 0.2,
                    roughness: 0.38,
                    anisotropyStrength: 0.65,
                    anisotropyRotation: 0.4,
                    iridescenceFactor: 0.7,
                    iridescenceThicknessMinimum: 180,
                    iridescenceThicknessMaximum: 420
                });
                const skinned = new SkinnedMesh({
                    geometry: skinGeometry,
                    material: skinMaterial,
                    skeleton: new Skeleton({
                        jointNodeList: [joint],
                        jointNames: ['root'],
                        inverseBindMatrices: [new Matrix4()]
                    }),
                    x: 0.75,
                    z: 0.6,
                    frustumTest: false
                });
                skinned.updateMatrixWorld(true);
                skinned.addTo(scene);
                morphMesh.addTo(scene);
                layeredMesh.addTo(scene);
                new AmbientLight({ amount: 0.01 }).addTo(scene);
                const layeredPoint = new PointLight({
                    amount: 100,
                    range: 8,
                    z: 3,
                    lightLayerMask: 1
                });
                layeredPoint.addTo(scene);
                const photometricLight = new SpotLight({
                    amount: 10,
                    range: 8,
                    z: 3,
                    direction: new Vector3(0, 0, -1),
                    lightLayerMask: 1,
                    cookie: {
                        scale: [0.9, 0.7],
                        intensity: 0.9,
                        softness: 0.2
                    },
                    iesProfile: { intensity: 1.1, exponent: 1.5 }
                });
                photometricLight.addTo(scene);
                const camera = new PerspectiveCamera({
                    aspect: 2,
                    near: 0.1,
                    far: 20,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                const prepareStorageScene = vi.spyOn(
                    MeshDrawProcessor.prototype,
                    'prepareStorageScene'
                );
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const readback = await target.readColorAttachment();
                let colorEnergy = 0;
                for (let offset = 0; offset < readback.data.length; offset += 4) {
                    colorEnergy +=
                        (readback.data[offset] ?? 0) +
                        (readback.data[offset + 1] ?? 0) +
                        (readback.data[offset + 2] ?? 0);
                }
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 0,
                    clusteredDeformedObjectCount: 1,
                    clusteredTransparentObjectCount: 2,
                    lightCount: 2,
                    warmedMaterialVariantCount: 1,
                    activeMaterialVariantCount: 3,
                    materialVariantBudgetExceededCount: 0,
                    materialVariantBudget: 4
                });
                const nativePasses = rendererDiagnostics
                    .snapshot()
                    .renderGraph?.passes.map(pass => pass.name);
                expect(nativePasses).toContain('GPU Scene deformed and layered clustered PBR');
                expect(nativePasses).toContain('Clustered Forward+ transparent PBR');
                expect(nativePasses).toContain(
                    'Transparent transmission and particle temporal reactive coverage'
                );
                expect(nativePasses).toContain(
                    'Transparent transmission and particle resurrection'
                );
                expect(nativePasses).toContain('Transparent GPU particle temporal composition');
                expect(prepareStorageScene.mock.calls.slice(-2).map(call => call[0])).toEqual([
                    morphMesh,
                    skinned
                ]);
                expect(colorEnergy).toBeGreaterThan(1_000);
                prepareStorageScene.mockRestore();

                layeredPoint.lightLayerMask = 2;
                photometricLight.lightLayerMask = 2;
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const layerExcluded = await target.readColorAttachment();
                let excludedEnergy = 0;
                for (let offset = 0; offset < layerExcluded.data.length; offset += 4) {
                    excludedEnergy +=
                        (layerExcluded.data[offset] ?? 0) +
                        (layerExcluded.data[offset + 1] ?? 0) +
                        (layerExcluded.data[offset + 2] ?? 0);
                }
                expect(excludedEnergy).toBeLessThan(colorEnergy * 0.75);
                layeredPoint.lightLayerMask = 1;
                photometricLight.lightLayerMask = 1;

                const runtimeVariant = new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({ baseColor: new Color(0.8, 0.8, 0.2) }),
                    y: -1.25,
                    x: -2,
                    frustumTest: false
                });
                runtimeVariant.addTo(scene);
                const originalFullscreenExecute = Object.getOwnPropertyDescriptor(
                    FullscreenRenderPass.prototype,
                    'execute'
                )?.value as (
                    this: FullscreenRenderPass,
                    ...parameters: Parameters<FullscreenRenderPass['execute']>
                ) => void;
                let injectedFailure = false;
                let resurrectionPassCount = 0;
                const executeFailure = vi
                    .spyOn(FullscreenRenderPass.prototype, 'execute')
                    .mockImplementation(function (
                        this: FullscreenRenderPass,
                        ...parameters: Parameters<typeof originalFullscreenExecute>
                    ): void {
                        if (this.name === 'Transparent transmission and particle resurrection') {
                            resurrectionPassCount++;
                        }
                        if (!injectedFailure && resurrectionPassCount === 2) {
                            injectedFailure = true;
                            throw new Error('injected clustered temporal submission failure');
                        }
                        originalFullscreenExecute.apply(this, parameters);
                    });
                try {
                    expect(() => {
                        renderer.renderToTarget(target, scene, camera);
                    }).toThrow(/injected clustered temporal submission failure/u);
                } finally {
                    executeFailure.mockRestore();
                }
                expect(injectedFailure).toBe(true);
                expect(await factory.readDiagnostics()).toMatchObject({
                    activeMaterialVariantCount: 3,
                    materialVariantBudgetExceededCount: 0
                });
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    fallbackObjectCount: 0,
                    clusteredDeformedObjectCount: 2,
                    activeMaterialVariantCount: 4,
                    materialVariantBudgetExceededCount: 0
                });

                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({
                        clearcoatFactor: 0.45,
                        clearcoatRoughnessFactor: 0.3
                    }),
                    y: -1.25,
                    x: 2,
                    frustumTest: false
                }).addTo(scene);
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    fallbackObjectCount: 1,
                    clusteredDeformedObjectCount: 2,
                    activeMaterialVariantCount: 4,
                    materialVariantBudgetExceededCount: 1
                });

                const extension = renderer.getExtension('rhi') as {
                    readonly device: RHIDevice;
                } | null;
                if (extension === null) throw new Error('Expected the public RHI extension');
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
                extension.device.destroy();
                await deviceLost;
                await Promise.all([renderer.waitForIdle(), deviceRestored]);
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                expect(
                    rendererDiagnostics.snapshot().renderGraph?.passes.map(pass => pass.name)
                ).toContain('Transparent temporal history initialize');
                expect(await factory.readDiagnostics()).toMatchObject({
                    activeMaterialVariantCount: 4,
                    materialVariantBudgetExceededCount: 1
                });

                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({ transmissionFactor: 0.45 }),
                    y: -1.2,
                    frustumTest: false
                }).addTo(scene);
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    fallbackObjectCount: 4,
                    clusteredDeformedObjectCount: 2,
                    clusteredTransparentObjectCount: 0,
                    materialVariantBudgetExceededCount: 1
                });
                const mixedPasses = rendererDiagnostics
                    .snapshot()
                    .renderGraph?.passes.map(pass => pass.name);
                expect(mixedPasses).toContain('Clustered Forward+ compatibility opaque copy');
                expect(mixedPasses).toContain('Clustered Forward+ compatibility fallback');
                expect(mixedPasses).not.toContain('Clustered Forward+ transparent PBR');
            } finally {
                particleSystem.destroy(renderer);
                target.destroy();
                renderer.destroy();
                unregisterRendererDiagnostics(canvas, rendererDiagnostics);
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'renders every compacted material bucket without indirect-first-instance',
        async () => {
            const geometry = new BoxGeometry();
            const materials = [
                new PBRMaterial({
                    baseColor: new Color(0, 0, 0),
                    emissionFactor: new Color(3, 0, 0)
                }),
                new PBRMaterial({
                    baseColor: new Color(0, 0, 0),
                    emissionFactor: new Color(0, 3, 0)
                }),
                new PBRMaterial({
                    baseColor: new Color(0, 0, 0),
                    emissionFactor: new Color(0, 0, 3)
                })
            ] as const;
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: materials.map(material => ({ geometry, material })),
                maxObjects: materials.length,
                maxLights: 1,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                maxViewportWidth: 96,
                maxViewportHeight: 48,
                hiZ: false,
                bloomStrength: 0
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 96,
                height: 48,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            const target = renderer.createRenderTarget({
                width: 96,
                height: 48,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
            });
            try {
                const scene = new Node();
                for (let index = 0; index < materials.length; index += 1) {
                    const material = materials[index];
                    if (material === undefined) throw new Error('Expected a bucket material');
                    new Mesh({
                        geometry,
                        material,
                        x: (index - 1) * 2,
                        frustumTest: false
                    }).addTo(scene);
                }
                const camera = new PerspectiveCamera({
                    aspect: 2,
                    fov: 45,
                    near: 0.1,
                    far: 20,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                renderer.renderToTarget(target, scene, camera);
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const readback = await target.readColorAttachment();
                const dominant: [number, number, number] = [0, 0, 0];
                for (let offset = 0; offset < readback.data.length; offset += 4) {
                    const red = readback.data[offset] ?? 0;
                    const green = readback.data[offset + 1] ?? 0;
                    const blue = readback.data[offset + 2] ?? 0;
                    const maximum = Math.max(red, green, blue);
                    if (maximum < 32) continue;
                    if (red > green * 1.5 && red > blue * 1.5) dominant[0]++;
                    if (green > red * 1.5 && green > blue * 1.5) dominant[1]++;
                    if (blue > red * 1.5 && blue > green * 1.5) dominant[2]++;
                }

                expect(dominant[0]).toBeGreaterThan(20);
                expect(dominant[1]).toBeGreaterThan(20);
                expect(dominant[2]).toBeGreaterThan(20);
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 3,
                    fallbackObjectCount: 0,
                    visibleObjectCount: 3
                });
            } finally {
                target.destroy();
                renderer.destroy();
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'integrates GTAO into GPU Scene and Forward fallback SSR reflection data',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial({
                baseColor: new Color(0.65, 0.55, 0.42),
                metallic: 0,
                roughness: 0.7
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 2,
                maxLights: 1,
                maxLightIndices: 128,
                maxLightsPerCluster: 1,
                maxViewportWidth: 64,
                maxViewportHeight: 64,
                bloomStrength: 0,
                temporalAA: {},
                screenSpaceReflections: {
                    resolutionScale: 0.5,
                    maxSteps: 8
                },
                groundTruthAmbientOcclusion: {
                    directionCount: 4,
                    stepCount: 3,
                    resolutionScale: 0.5
                }
            });
            const canvas = document.createElement('canvas');
            const rendererDiagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: canvas,
                width: 64,
                height: 64,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                new Mesh({ geometry, material, frustumTest: false }).addTo(scene);
                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({
                        baseColor: new Color(0.3, 0.45, 0.75),
                        metallic: 0.35,
                        roughness: 0.3,
                        iridescenceFactor: 0.7,
                        iridescenceThicknessMinimum: 180,
                        iridescenceThicknessMaximum: 420
                    }),
                    x: 1.25,
                    frustumTest: false
                }).addTo(scene);
                new PointLight({ amount: 4, range: 8, z: 3 }).addTo(scene);
                const camera = new PerspectiveCamera({
                    aspect: 1,
                    near: 0.1,
                    far: 20,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 4).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                await renderer.waitForIdle();
                renderer.render(scene, camera);
                await renderer.waitForIdle();

                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 1
                });
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
                const passNames = rendererDiagnostics
                    .snapshot()
                    .renderGraph?.passes.map(pass => pass.name);
                expect(passNames).toEqual(
                    expect.arrayContaining([
                        'GPU Scene GTAO material attributes',
                        'GTAO rotated horizon search',
                        'GTAO production temporal resolve',
                        'Clustered PBR buckets',
                        'Clustered Forward+ fallback material attributes',
                        'Screen-space reflections finalize indirect tile dispatch',
                        'Hierarchical screen-space reflection trace'
                    ])
                );
            } finally {
                unregisterRendererDiagnostics(canvas);
                renderer.destroy();
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'renders GPU Scene culling, indirect buckets and clustered lighting on real WebGPU',
        async () => {
            const geometry = new BoxGeometry({ widthSegments: 2 });
            const uv0 = geometry.uvs;
            if (uv0 === null) throw new Error('Expected box UV data');
            geometry.uvs1 = new GeometryData(uv0.data.slice(), 2);
            const surfaceTexture = rgbaTexture([190, 140, 90, 255], 0);
            const normalTexture = rgbaTexture([128, 128, 255, 255], 1);
            const uv0Transform = new Matrix3().fromRotationTranslationScale(0, 0.1, 0.05, 0.8, 0.8);
            const uv1Transform = new Matrix3().fromRotationTranslationScale(0, 0, 0, 1, 1);
            const material = new PBRMaterial({
                coverage: { mode: 'mask', cutoff: 0.5 },
                metallic: 0.35,
                roughness: 0.28,
                baseColorMap: { texture: surfaceTexture, transform: uv0Transform },
                opacityMap: { texture: surfaceTexture, transform: uv0Transform },
                metallicMap: surfaceTexture,
                roughnessMap: surfaceTexture,
                metallicRoughnessMap: surfaceTexture,
                occlusionMap: surfaceTexture,
                emission: surfaceTexture,
                emissionFactor: new Color(0.02, 0.01, 0.005),
                normalMap: { texture: normalTexture, transform: uv1Transform },
                normalScale: 0.75,
                isOcclusionInMetallicRoughnessMap: true
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 8,
                maxLights: 8,
                maxLightIndices: 4_096,
                maxLightsPerCluster: 8,
                maxViewportWidth: 128,
                maxViewportHeight: 128,
                temporalAA: { renderScale: 0.75 },
                screenSpaceReflections: {
                    resolutionScale: 0.5,
                    maxSteps: 8,
                    roughnessCutoff: 0.25
                },
                volumetricLighting: {
                    quality: 'low',
                    density: 0.018,
                    maxDistance: 20,
                    shadowSteps: 2,
                    localVolumes: [
                        {
                            shape: 'sphere',
                            center: new Vector3(0, 0, 1),
                            radius: 3,
                            density: 0.01,
                            albedo: new Color(0.7, 0.82, 1)
                        }
                    ]
                }
            });
            const canvas = document.createElement('canvas');
            const rendererDiagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: canvas,
                width: 128,
                height: 96,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                const meshes: Mesh[] = [];
                for (let index = 0; index < 12; index += 1) {
                    const mesh = new Mesh({
                        geometry,
                        material,
                        x: ((index % 4) - 1.5) * 0.85,
                        y: (Math.floor(index / 4) - 1) * 0.85,
                        z: 0,
                        scaleX: index === 0 ? 1.75 : 1
                    });
                    meshes.push(mesh);
                    mesh.addTo(scene);
                }
                for (let index = 0; index < 4; index += 1) {
                    const angle = (index / 4) * Math.PI * 2;
                    new PointLight({
                        amount: 3,
                        range: 6,
                        x: Math.cos(angle) * 2.5,
                        y: Math.sin(angle) * 1.5,
                        z: 3
                    }).addTo(scene);
                }
                new AreaLight({ amount: 2, width: 2, height: 2, z: 3 }).addTo(scene);
                const camera = new PerspectiveCamera({
                    aspect: 4 / 3,
                    near: 0.1,
                    far: 30,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 8).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                renderer.render(scene, camera);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                const diagnostics = await factory.readDiagnostics();

                expect(diagnostics.objectCount).toBe(8);
                expect(diagnostics.fallbackObjectCount).toBe(0);
                expect(diagnostics.lightCount).toBe(5);
                expect(diagnostics.visibleObjectCount).toBeGreaterThan(0);
                expect(diagnostics.clusterLightIndexCount).toBeGreaterThan(0);
                expect(diagnostics.clusterOverflowCount).toBe(0);
                expect(diagnostics.hiZValid).toBe(true);
                expect(diagnostics.volumetricFroxelCount).toBeGreaterThan(0);
                expect(diagnostics.volumetricHistoryUsed).toBe(true);
                expect(diagnostics.screenSpaceReflectionActiveTileCount).toBeGreaterThan(0);
                expect(diagnostics.screenSpaceReflectionActivePixelCount).toBeGreaterThan(0);
                expect(
                    diagnostics.screenSpaceReflectionHitPixelCount +
                        diagnostics.screenSpaceReflectionMissPixelCount
                ).toBe(diagnostics.screenSpaceReflectionActivePixelCount);
                expect(
                    diagnostics.screenSpaceReflectionUncertainPixelCount +
                        diagnostics.screenSpaceReflectionBackfaceRejectedPixelCount
                ).toBeLessThanOrEqual(diagnostics.screenSpaceReflectionMissPixelCount);
                expect(
                    diagnostics.screenSpaceReflectionHistoryAcceptedPixelCount +
                        diagnostics.screenSpaceReflectionHistoryRejectedPixelCount
                ).toBeGreaterThan(0);
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
                const passNames = rendererDiagnostics
                    .snapshot()
                    .renderGraph?.passes.map(pass => pass.name);
                expect(passNames).toBeDefined();
                const fallbackDepthIndex =
                    passNames?.indexOf('Clustered Forward+ fallback depth prepass') ?? -1;
                const currentHiZIndex =
                    passNames?.indexOf('GPU Scene current depth Hi-Z min/max mip zero') ?? -1;
                expect(fallbackDepthIndex).toBeGreaterThan(-1);
                expect(currentHiZIndex).toBeGreaterThan(fallbackDepthIndex);
                expect(passNames).toContain('Screen-space reflections adaptive confidence filter');
                expect(passNames).toContain(
                    'Screen-space reflections variance-guided stability filter'
                );
                expect(passNames).toContain(
                    'Screen-space reflections residual coverage cleanup filter'
                );
                expect(passNames).toEqual(
                    expect.arrayContaining([
                        'Screen-space reflections active tile classification',
                        'Screen-space reflections coherent tile compaction',
                        'Hierarchical screen-space reflection trace'
                    ])
                );
                expect(passNames).toEqual(
                    expect.arrayContaining([
                        'Froxel volumetric light and density injection',
                        'Froxel cumulative line integration',
                        'Froxel constant-time view reconstruction',
                        'Volumetric lighting depth-aware temporal resolve',
                        'Volumetric lighting linear HDR composite'
                    ])
                );

                material.roughness = 1;
                renderer.render(scene, camera);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(
                    (await factory.readDiagnostics()).screenSpaceReflectionActivePixelCount
                ).toBe(0);
                material.roughness = 0.28;
                renderer.render(scene, camera);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(
                    (await factory.readDiagnostics()).screenSpaceReflectionActivePixelCount
                ).toBeGreaterThan(0);

                material.metallic = 0.9;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(
                    (await factory.readDiagnostics()).screenSpaceReflectionHistoryRejectedPixelCount
                ).toBeGreaterThan(0);
                material.metallic = 0.35;
                renderer.render(scene, camera);
                await renderer.waitForIdle();

                const movingMesh = meshes[0];
                if (movingMesh === undefined) throw new Error('Expected a moving SSR fixture mesh');
                movingMesh.x += 0.35;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                const movingDiagnostics = await factory.readDiagnostics();
                expect(
                    movingDiagnostics.screenSpaceReflectionHitPixelCount +
                        movingDiagnostics.screenSpaceReflectionMissPixelCount
                ).toBe(movingDiagnostics.screenSpaceReflectionActivePixelCount);
                renderer.render(scene, camera);
                await renderer.waitForIdle();

                camera.setPosition(0.25, 0, 8).lookAt(new Vector3(0, 0, 0));
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                material.setTextureSlot('baseColor', {
                    texture: rgbaTexture([80, 160, 220, 255], 0),
                    transform: uv0Transform
                });
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 0
                });

                camera.invalidateTransformHistory();
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                renderer.resize(80, 96, true);
                camera.aspect = 80 / 96;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                const extension = renderer.getExtension('rhi') as {
                    readonly device: RHIDevice;
                } | null;
                if (extension === null) throw new Error('Expected the public RHI extension');
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
                extension.device.destroy();
                await deviceLost;
                await Promise.all([renderer.waitForIdle(), deviceRestored]);
                renderer.render(scene, camera);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 0,
                    hiZValid: true
                });

                camera.depthMode = 'standard';
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(false);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect((await factory.readDiagnostics()).hiZValid).toBe(true);

                const maskedMaterial = new PBRMaterial({
                    coverage: { mode: 'mask', cutoff: 0.5 }
                });
                for (const mesh of meshes) mesh.material = maskedMaterial;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 0
                });
                for (const mesh of meshes) mesh.material = material;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 0
                });

                const removedMesh = meshes[0];
                if (removedMesh === undefined) throw new Error('Expected a removable GPU mesh');
                removedMesh.removeFromParent();
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 7,
                    fallbackObjectCount: 0
                });
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 0
                });
                removedMesh.addTo(scene);

                const originalVertices = geometry.vertices;
                if (originalVertices === null) throw new Error('Expected box vertex data');
                geometry.vertices = new GeometryData(
                    originalVertices.data.slice(),
                    originalVertices.size,
                    {
                        normalized: originalVertices.normalized,
                        stride: originalVertices.stride,
                        offset: originalVertices.offset
                    }
                );
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 0,
                    fallbackObjectCount: 0
                });
                geometry.vertices = originalVertices;
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 0
                });

                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new BasicMaterial({ lightType: 'NONE' }),
                    x: 2.5
                }).addTo(scene);
                new Mesh({
                    geometry: new BoxGeometry(),
                    material: new PBRMaterial({ transmissionFactor: 0.35 }),
                    x: -2.5
                }).addTo(scene);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 8,
                    fallbackObjectCount: 2
                });
            } finally {
                renderer.destroy();
                unregisterRendererDiagnostics(canvas, rendererDiagnostics);
            }
        },
        30_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'keeps directional, shadowed, and exact LTC area lights on the native path',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial();
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 1,
                maxLights: 9,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                maxViewportWidth: 32,
                maxViewportHeight: 32,
                hiZ: false,
                bloomStrength: 0
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                new Mesh({ geometry, material }).addTo(scene);
                let firstDirectional: DirectionalLight | null = null;
                for (let index = 0; index < 8; index += 1) {
                    const light = new DirectionalLight({ amount: 0.25 }).addTo(scene);
                    firstDirectional ??= light;
                }
                const camera = new PerspectiveCamera({
                    aspect: 1,
                    near: 0.1,
                    far: 20,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 0,
                    lightCount: 8,
                    clusterLightIndexCount: 0,
                    clusterOverflowCount: 0
                });

                if (firstDirectional === null) throw new Error('Expected a directional light');
                firstDirectional.shadow = {};
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 0,
                    lightCount: 8,
                    clusterLightIndexCount: 0
                });
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
                camera.depthMode = 'standard';
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 0,
                    lightCount: 8,
                    clusterLightIndexCount: 0
                });
                firstDirectional.shadow = null;

                new AreaLight({ amount: 1, z: 2 }).addTo(scene);
                renderer.render(scene, camera);
                await renderer.waitForIdle();
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 0,
                    lightCount: 9,
                    clusterLightIndexCount: 0,
                    clusterOverflowCount: 0
                });
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
            } finally {
                renderer.destroy();
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'bounds cluster allocation overflow deterministically on real WebGPU',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial();
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 1,
                maxLights: 8,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                tileSize: 16,
                zSlices: 8,
                maxViewportWidth: 32,
                maxViewportHeight: 32,
                hiZ: false
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            try {
                const scene = new Node();
                new Mesh({ geometry, material }).addTo(scene);
                for (let index = 0; index < 8; index += 1) {
                    new PointLight({ amount: 1, range: 20, z: 2 }).addTo(scene);
                }
                const camera = new PerspectiveCamera({ aspect: 1, near: 0.1, far: 20 });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                renderer.render(scene, camera);
                await renderer.waitForIdle();
                const diagnostics = await factory.readDiagnostics();

                expect(diagnostics.clusterLightIndexCount).toBeLessThanOrEqual(1);
                expect(diagnostics.clusterOverflowCount).toBeGreaterThan(0);
            } finally {
                renderer.destroy();
            }
        }
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'evaluates LTC area lights in clustered storage PBR without compatibility fallback',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial({
                baseColor: new Color(1, 1, 1),
                metallic: 0,
                roughness: 0.8
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 1,
                maxLights: 1,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                maxViewportWidth: 32,
                maxViewportHeight: 32,
                hiZ: false,
                bloomStrength: 0
            });
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: document.createElement('canvas'),
                width: 32,
                height: 32,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            const target = renderer.createRenderTarget({
                width: 32,
                height: 32,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
            });
            try {
                const scene = new Node();
                new Mesh({ geometry, material, frustumTest: false }).addTo(scene);
                const area = new AreaLight({
                    amount: 6,
                    width: 4,
                    height: 4,
                    z: 2,
                    rotationY: 180
                }).addTo(scene);
                const camera = new PerspectiveCamera({
                    aspect: 1,
                    near: 0.1,
                    far: 20,
                    depthMode: 'reversed'
                });
                camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const lit = await target.readColorAttachment({
                    x: 12,
                    y: 12,
                    width: 8,
                    height: 8
                });
                area.enabled = false;
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const unlit = await target.readColorAttachment({
                    x: 12,
                    y: 12,
                    width: 8,
                    height: 8
                });
                const energy = (data: Uint8Array): number => {
                    let result = 0;
                    for (let offset = 0; offset < data.length; offset += 4) {
                        result +=
                            (data[offset] ?? 0) + (data[offset + 1] ?? 0) + (data[offset + 2] ?? 0);
                    }
                    return result;
                };

                expect(energy(lit.data)).toBeGreaterThan(energy(unlit.data) + 1_000);
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 1,
                    fallbackObjectCount: 0,
                    lightCount: 0
                });
            } finally {
                target.destroy();
                renderer.destroy();
            }
        },
        20_000
    );

    it.skipIf(__HILO3D_GITHUB_ACTIONS_COVERAGE__)(
        'samples GPU-requested virtual pages with stable shadow-atlas fallback',
        async () => {
            const geometry = new BoxGeometry();
            const material = new PBRMaterial({
                baseColor: new Color(0.9, 0.9, 0.9),
                metallic: 0,
                roughness: 0.9
            });
            const factory = new ClusteredForwardPlusPipelineFactory({
                buckets: [{ geometry, material }],
                maxObjects: 2,
                maxLights: 1,
                maxLightIndices: 1,
                maxLightsPerCluster: 1,
                maxViewportWidth: 64,
                maxViewportHeight: 64,
                virtualShadows: {
                    virtualResolution: 512,
                    pageSize: 64,
                    physicalPageCount: 16,
                    maxPageUpdatesPerFrame: 16,
                    directionalClipmapLevels: 2,
                    firstDirectionalClipmapExtent: 16
                },
                bloomStrength: 0
            });
            const canvas = document.createElement('canvas');
            const rendererDiagnostics = registerRendererDiagnostics(canvas);
            const renderer = await Renderer.create({
                backend: 'webgpu',
                domElement: canvas,
                width: 64,
                height: 64,
                antialias: false,
                renderingProfile: 'high-end',
                renderPipeline: factory
            });
            const target = renderer.createRenderTarget({
                width: 64,
                height: 64,
                colorAttachments: [{ format: 'rgba8unorm' }],
                depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
            });
            try {
                const scene = new Node();
                const floor = new Mesh({
                    geometry,
                    material,
                    y: -1,
                    scaleX: 5,
                    scaleY: 0.2,
                    scaleZ: 5,
                    frustumTest: false
                }).addTo(scene);
                const caster = new Mesh({
                    geometry,
                    material,
                    y: 0,
                    frustumTest: false
                }).addTo(scene);
                new AmbientLight({ amount: 0.05 }).addTo(scene);
                const light = new DirectionalLight({
                    amount: 4,
                    direction: new Vector3(1, -2, 1)
                }).addTo(scene);
                const camera = new PerspectiveCamera({
                    aspect: 1,
                    near: 0.1,
                    far: 30,
                    depthMode: 'reversed'
                });
                camera.setPosition(4, 3, 6).lookAt(new Vector3(0, -0.5, 0));
                const energy = (data: Uint8Array): number => {
                    let result = 0;
                    for (let offset = 0; offset < data.length; offset += 4) {
                        result +=
                            (data[offset] ?? 0) + (data[offset + 1] ?? 0) + (data[offset + 2] ?? 0);
                    }
                    return result;
                };

                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const unshadowed = await target.readColorAttachment();
                light.shadow = { width: 128, height: 128 };
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const shadowed = await target.readColorAttachment();

                expect(energy(unshadowed.data)).toBeGreaterThan(energy(shadowed.data) + 2_000);
                expect(await factory.readDiagnostics()).toMatchObject({
                    objectCount: 2,
                    fallbackObjectCount: 0,
                    lightCount: 1,
                    virtualShadows: {
                        physicalPageCapacity: 16,
                        directionalClipmapLevelCount: 2
                    }
                });
                const originalComputeExecute = Object.getOwnPropertyDescriptor(
                    ComputeRenderPass.prototype,
                    'execute'
                )?.value as (
                    this: ComputeRenderPass,
                    ...parameters: Parameters<ComputeRenderPass['execute']>
                ) => void;
                let injectedFailure = false;
                const computeFailure = vi
                    .spyOn(ComputeRenderPass.prototype, 'execute')
                    .mockImplementation(function (
                        this: ComputeRenderPass,
                        ...parameters: Parameters<typeof originalComputeExecute>
                    ): void {
                        if (
                            !injectedFailure &&
                            this.name ===
                                'Virtual shadow deterministic page-table allocation and remap'
                        ) {
                            injectedFailure = true;
                            throw new Error('injected virtual-shadow submission failure');
                        }
                        originalComputeExecute.apply(this, parameters);
                    });
                try {
                    expect(() => {
                        renderer.renderToTarget(target, scene, camera);
                    }).toThrow(/injected virtual-shadow submission failure/u);
                } finally {
                    computeFailure.mockRestore();
                }
                expect(injectedFailure).toBe(true);
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();

                const extension = renderer.getExtension('rhi') as {
                    readonly device: RHIDevice;
                } | null;
                if (extension === null) throw new Error('Expected the public RHI extension');
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
                extension.device.destroy();
                await deviceLost;
                await Promise.all([renderer.waitForIdle(), deviceRestored]);
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const recoveredDiagnostics = await factory.readDiagnostics();
                expect(recoveredDiagnostics).toMatchObject({
                    virtualShadows: {
                        physicalPageCapacity: 16,
                        directionalClipmapLevelCount: 2
                    }
                });
                expect(recoveredDiagnostics.virtualShadows?.requestedPageCount).toBeGreaterThan(0);
                expect(recoveredDiagnostics.virtualShadows?.renderedPageCount).toBeGreaterThan(0);

                floor.x = 8;
                caster.x = 8;
                camera.setPosition(12, 3, 6).lookAt(new Vector3(8, -0.5, 0));
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                renderer.renderToTarget(target, scene, camera);
                await renderer.waitForIdle();
                const remappedDiagnostics = await factory.readDiagnostics();
                expect(remappedDiagnostics.virtualShadows?.evictionCount).toBeGreaterThan(0);
                expect(
                    rendererDiagnostics.snapshot().renderGraph?.passes.map(pass => pass.name)
                ).toEqual(
                    expect.arrayContaining([
                        'Virtual shadow receiver depth page requests',
                        'Virtual shadow deterministic page-table allocation and remap',
                        'GPU Scene virtual shadow physical page updates'
                    ])
                );
            } finally {
                unregisterRendererDiagnostics(canvas, rendererDiagnostics);
                target.destroy();
                renderer.destroy();
            }
        },
        20_000
    );
});
