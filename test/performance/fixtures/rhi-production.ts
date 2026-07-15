import manifestValue from '../../../benchmarks/rhi/manifest.json';
import {
    RHI_BENCHMARK_ALLOCATION_PROFILER_PROTOCOL,
    RHI_BENCHMARK_FIXTURE_PROTOCOL_VERSION,
    type RHIBenchmarkDiagnosticSample,
    type RHIBenchmarkFixtureFrameSample,
    type RHIBenchmarkFixtureMetadata,
    type RHIBenchmarkFixtureRoundResult,
    type RHIBenchmarkNativeCreateCounts,
    type RHIBenchmarkProductionFixture,
    type RHIBenchmarkTimingSample
} from '../../../benchmarks/rhi/fixture-contract';
import type {
    RendererArchitecture,
    RHIBenchmarkBackend,
    RHIBenchmarkManifest,
    RHIBenchmarkQuality,
    RHIBenchmarkScenarioId,
    RHIBenchmarkScenarioManifest
} from '../../../benchmarks/rhi/result-schema';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import AmbientLight from '../../../src/light/AmbientLight';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PointLight from '../../../src/light/PointLight';
import BasicMaterial from '../../../src/material/BasicMaterial';
import PBRMaterial from '../../../src/material/PBRMaterial';
import ShaderMaterial from '../../../src/material/ShaderMaterial';
import Color from '../../../src/math/Color';
import Vector3 from '../../../src/math/Vector3';
import RendererCore, { type RendererScene } from '../../../src/render/RendererCore';
import type {
    RendererCacheCountersSnapshot,
    RendererDiagnostics,
    RendererDiagnosticsSnapshot,
    RendererNativeObjectCountersSnapshot
} from '../../../src/render/RendererDiagnostics';
import SharedRendererDriver from '../../../src/render/internal/SharedRendererDriver';
import Program from '../../../src/render/internal/webgl2/Program';
import WebGL2Driver from '../../../src/render/internal/webgl2/WebGL2Driver';
import WebGPUDriver from '../../../src/render/internal/webgpu/WebGPUDriver';
import { WebGPUPipelineManager } from '../../../src/render/internal/webgpu/WebGPUPipelineManager';
import { WebGPUDevice } from '../../../src/render/rhi/webgpu/WebGPUDevice';
import { WebGL2Queue } from '../../../src/render/rhi/backends/webgl2/WebGL2Commands';
import { WebGPUQueue } from '../../../src/render/rhi/backends/webgpu/WebGPUQueue';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import { PipelineResourceCache } from '../../../src/render/renderer/PipelineResourceCache';
import { ShaderArtifactCompiler } from '../../../src/render/renderer/ShaderArtifactCompiler';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import Shader from '../../../src/shader/Shader';
import Texture from '../../../src/texture/Texture';
import { NEAREST } from '../../../src/constants/webgl';
import {
    MRT_MSAA_POSTPROCESS_EFFECT_PASS_COUNT,
    createMRTMSAAPostProcessWorkload,
    mrtMSAAPostProcessPrimaryDrawCount,
    mrtMSAAPostProcessSourceTargetParameters,
    recordMRTMSAAPostProcessWorkload,
    type MRTMSAAPostProcessWorkload
} from './rhi-postprocess-workload';
import {
    benchmarkInFlightBatchIsFull,
    benchmarkMaterialIndex,
    benchmarkMeshCastsShadow,
    benchmarkMeshDepth,
    benchmarkPrimaryDrawCount
} from './rhi-scene-workload';

type AnyMethod = (this: unknown, ...args: unknown[]) => unknown;

interface PerformanceMemory {
    readonly usedJSHeapSize: number;
}

interface FrameTimings {
    renderer: number;
    framePlan: number;
    renderFrame: number;
    graphCompile: number;
    graphExecute: number;
    queueEnd: number;
    legacySubmit: number;
}

interface NativeWebGPUExtension {
    readonly gpuDevice: GPUDevice;
}

interface RHIExtension {
    readonly device: { readonly nativeHandle?: GPUDevice };
}

function fixtureFailure(message: string): never {
    throw new Error(`RHI production fixture failed: ${message}`);
}

function fixtureManifest(value: unknown): RHIBenchmarkManifest {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        fixtureFailure('benchmark manifest is not an object');
    }
    const manifest = value as Record<string, unknown>;
    const sampling = manifest['sampling'];
    if (
        manifest['schemaVersion'] !== 2 ||
        manifest['suite'] !== 'rhi' ||
        !Array.isArray(manifest['scenarios']) ||
        typeof sampling !== 'object' ||
        sampling === null ||
        Array.isArray(sampling) ||
        !Number.isSafeInteger((sampling as Record<string, unknown>)['rounds'])
    ) {
        fixtureFailure('benchmark manifest is invalid');
    }
    // The Node preflight performs the complete schema/fingerprint validation before this browser
    // module is served. This local guard deliberately stays browser-only (no node:* imports).
    return value as RHIBenchmarkManifest;
}

function benchmarkMemory(): PerformanceMemory {
    const memory = (
        performance as Performance & {
            readonly memory?: unknown;
        }
    ).memory;
    if (typeof memory !== 'object' || memory === null) {
        fixtureFailure('Chromium precise memory API is unavailable');
    }
    const usedJSHeapSize = (memory as Record<string, unknown>)['usedJSHeapSize'];
    if (typeof usedJSHeapSize !== 'number' || !Number.isSafeInteger(usedJSHeapSize)) {
        fixtureFailure('Chromium precise usedJSHeapSize is unavailable');
    }
    return { usedJSHeapSize };
}

function wrapTimedMethod(
    target: object,
    key: string,
    elapsed: (duration: number) => void
): () => void {
    const original = Reflect.get(target, key) as unknown;
    if (typeof original !== 'function') fixtureFailure(`instrumentation target ${key} is missing`);
    const wrapped: AnyMethod = function (this: unknown, ...args: unknown[]): unknown {
        const started = performance.now();
        try {
            return Reflect.apply(original as AnyMethod, this, args);
        } finally {
            elapsed(performance.now() - started);
        }
    };
    Reflect.set(target, key, wrapped);
    return () => {
        Reflect.set(target, key, original);
    };
}

class TimingProbe {
    readonly #restores: (() => void)[] = [];
    readonly #timings: FrameTimings = {
        renderer: 0,
        framePlan: 0,
        renderFrame: 0,
        graphCompile: 0,
        graphExecute: 0,
        queueEnd: 0,
        legacySubmit: 0
    };
    #shaderPrepare = 0;
    #pipelinePrepare = 0;
    #collectInitialPrepare = true;
    #active = false;

    constructor(readonly architecture: RendererArchitecture) {
        this.resume();
    }

    resume(): void {
        if (this.#active) return;
        const add =
            (key: keyof FrameTimings) =>
            (duration: number): void => {
                this.#timings[key] += duration;
            };
        this.#restores.push(
            wrapTimedMethod(RendererCore.prototype, 'buildFramePlan', add('framePlan')),
            wrapTimedMethod(RenderGraphFrame.prototype, 'execute', add('renderFrame')),
            wrapTimedMethod(RenderGraph.prototype, 'compile', add('graphCompile')),
            wrapTimedMethod(RenderGraph.prototype, 'execute', add('graphExecute')),
            wrapTimedMethod(WebGL2Queue.prototype, 'endFrame', add('queueEnd')),
            wrapTimedMethod(WebGPUQueue.prototype, 'endFrame', add('queueEnd')),
            wrapTimedMethod(WebGPUDevice.prototype, 'submitNative', add('legacySubmit')),
            wrapTimedMethod(Shader, 'getShader', duration => {
                if (this.#collectInitialPrepare) this.#shaderPrepare += duration;
            }),
            wrapTimedMethod(ShaderArtifactCompiler.prototype, 'compile', duration => {
                if (this.#collectInitialPrepare) this.#shaderPrepare += duration;
            }),
            wrapTimedMethod(Program, 'getProgram', duration => {
                if (this.#collectInitialPrepare) this.#pipelinePrepare += duration;
            }),
            wrapTimedMethod(WebGPUPipelineManager.prototype, 'getPipelineSync', duration => {
                if (this.#collectInitialPrepare) this.#pipelinePrepare += duration;
            }),
            wrapTimedMethod(PipelineResourceCache.prototype, 'prepare', duration => {
                if (this.#collectInitialPrepare) this.#pipelinePrepare += duration;
            })
        );
        this.#active = true;
    }

    suspend(): void {
        if (!this.#active) return;
        for (let index = this.#restores.length - 1; index >= 0; index -= 1) {
            this.#restores[index]?.();
        }
        this.#restores.length = 0;
        this.#active = false;
    }

    resetFrame(): void {
        for (const key of Object.keys(this.#timings) as (keyof FrameTimings)[]) {
            this.#timings[key] = 0;
        }
    }

    measureRenderer(render: () => void): RHIBenchmarkTimingSample {
        this.resetFrame();
        const started = performance.now();
        render();
        this.#timings.renderer = performance.now() - started;
        // The first measured render is the cold complex frame. Later cache lookups must not be
        // mislabeled as first-time shader/pipeline preparation.
        this.#collectInitialPrepare = false;
        const graphBuild = Math.max(
            0,
            this.#timings.renderFrame - this.#timings.graphCompile - this.#timings.graphExecute
        );
        const frameBuildCpuMs = this.#timings.framePlan + graphBuild;
        const graphCompileCpuMs = this.#timings.graphCompile;
        const rhiExecuteCpuMs =
            this.architecture === 'rhi' ? this.#timings.queueEnd : this.#timings.legacySubmit;
        const rhiCommandCpuMs =
            this.architecture === 'rhi'
                ? Math.max(0, this.#timings.graphExecute - this.#timings.queueEnd)
                : Math.max(0, this.#timings.renderer - frameBuildCpuMs - rhiExecuteCpuMs);
        return {
            frameBuildCpuMs,
            graphCompileCpuMs,
            rhiCommandCpuMs,
            rhiExecuteCpuMs,
            rhiTotalCpuMs: rhiCommandCpuMs + rhiExecuteCpuMs,
            rendererCpuMs: this.#timings.renderer
        };
    }

    get shaderPrepareMs(): number {
        return this.#shaderPrepare;
    }

    get pipelinePrepareMs(): number {
        return this.#pipelinePrepare;
    }

    destroy(): void {
        this.suspend();
    }
}

function cacheRate(
    before: RendererCacheCountersSnapshot,
    after: RendererCacheCountersSnapshot
): number | null {
    if (
        before.hits === null ||
        before.misses === null ||
        after.hits === null ||
        after.misses === null
    ) {
        return null;
    }
    const hits = after.hits - before.hits;
    const misses = after.misses - before.misses;
    return hits + misses === 0 ? null : hits / (hits + misses);
}

function frameDiagnostics(
    before: RendererDiagnosticsSnapshot,
    after: RendererDiagnosticsSnapshot
): RHIBenchmarkDiagnosticSample {
    return {
        rhiCommandCount: after.frame.commands,
        actualDrawCount: after.frame.draws,
        nativeStateCallCount: after.frame.stateChanges,
        pipelineCacheHitRate: cacheRate(before.caches.pipeline, after.caches.pipeline),
        bindGroupCacheHitRate: cacheRate(before.caches.bindGroup, after.caches.bindGroup),
        vaoCacheHitRate: cacheRate(before.caches.vertexArray, after.caches.vertexArray),
        framebufferCacheHitRate: cacheRate(before.caches.framebuffer, after.caches.framebuffer)
    };
}

function created(counter: RendererNativeObjectCountersSnapshot): number {
    return counter.created;
}

function nativeCreateCounts(snapshot: RendererDiagnosticsSnapshot): RHIBenchmarkNativeCreateCounts {
    const native = snapshot.nativeObjects;
    const knownCreationCount =
        created(native.buffer) +
        created(native.texture) +
        created(native.pipeline) +
        created(native.bindGroup) +
        created(native.vertexArray) +
        created(native.program);
    if (knownCreationCount === 0) {
        return {
            nativeBufferCreateCount: null,
            nativeTextureCreateCount: null,
            nativePipelineCreateCount: null,
            nativeBindGroupCreateCount: null,
            nativeVaoCreateCount: null,
            nativeProgramCreateCount: null
        };
    }
    return {
        nativeBufferCreateCount: created(native.buffer),
        nativeTextureCreateCount: created(native.texture),
        nativePipelineCreateCount: created(native.pipeline),
        nativeBindGroupCreateCount: created(native.bindGroup),
        nativeVaoCreateCount: created(native.vertexArray),
        nativeProgramCreateCount: created(native.program)
    };
}

function captureWebGL2Context(canvas: HTMLCanvasElement): () => WebGL2RenderingContext | null {
    const original = canvas.getContext.bind(canvas) as (
        contextId: string,
        options?: unknown
    ) => RenderingContext | null;
    let captured: WebGL2RenderingContext | null = null;
    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value(this: HTMLCanvasElement, contextId: string, options?: unknown): unknown {
            const context = original(contextId, options);
            if (contextId === 'webgl2' && context instanceof WebGL2RenderingContext) {
                captured = context;
            }
            return context;
        }
    });
    return () => captured;
}

function scenarioFromManifest(
    manifest: RHIBenchmarkManifest,
    scenarioId: string
): RHIBenchmarkScenarioManifest {
    const scenario = manifest.scenarios.find(candidate => candidate.id === scenarioId);
    if (!scenario) fixtureFailure(`unknown scenario ${scenarioId}`);
    return scenario;
}

function queryParameter(query: URLSearchParams, name: string, accepted: readonly string[]): string {
    const value = query.get(name);
    if (!value || !accepted.includes(value)) fixtureFailure(`invalid ${name} query parameter`);
    return value;
}

type BenchmarkTexture = Texture;

function texture(size: number, seed: number): BenchmarkTexture {
    const data = new Uint8Array(size * size * 4);
    for (let index = 0; index < data.length; index += 4) {
        data[index] = (seed * 31 + index) & 0xff;
        data[index + 1] = (seed * 67 + index) & 0xff;
        data[index + 2] = (seed * 97 + index) & 0xff;
        data[index + 3] = 255;
    }
    return new Texture({
        width: size,
        height: size,
        image: data,
        minFilter: NEAREST,
        magFilter: NEAREST,
        isImageCanRelease: false
    });
}

interface DynamicExternalTexture {
    readonly texture: BenchmarkTexture;
    readonly context: CanvasRenderingContext2D;
    readonly pixels: ImageData;
}

function dynamicExternalTexture(seed: number): DynamicExternalTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    if (!context) fixtureFailure('dynamic external-image texture requires a 2D canvas context');
    const pixels = context.createImageData(canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = (seed * 31 + index) & 0xff;
        pixels.data[index + 1] = (seed * 67 + index) & 0xff;
        pixels.data[index + 2] = (seed * 97 + index) & 0xff;
        pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return {
        texture: new Texture({
            width: canvas.width,
            height: canvas.height,
            image: canvas,
            minFilter: NEAREST,
            magFilter: NEAREST,
            flipY: false,
            premultiplyAlpha: false,
            autoUpdate: true,
            isImageCanRelease: false
        }),
        context,
        pixels
    };
}

function variantMaterial(
    scenarioId: RHIBenchmarkScenarioId,
    variant: number,
    image: BenchmarkTexture | null,
    pbr: boolean,
    texturePool: readonly BenchmarkTexture[] = []
): BasicMaterial | PBRMaterial {
    const textureCount = texturePool.length;
    const pooledTexture = (offset: number): BenchmarkTexture | null =>
        textureCount === 0 ? null : (texturePool[offset % textureCount] ?? null);
    const material = pbr
        ? new PBRMaterial({
              baseColor: new Color(0.35 + (variant % 5) * 0.08, 0.45, 0.7),
              baseColorMap: pooledTexture(variant * 3) ?? image,
              normalMap: pooledTexture(variant * 3 + 1),
              metallicRoughnessMap: pooledTexture(variant * 3 + 2),
              metallic: 0.3,
              roughness: 0.6
          })
        : new BasicMaterial({
              lightType: 'NONE',
              diffuse: image ?? new Color(0.25 + (variant % 7) * 0.07, 0.55, 0.8)
          });
    material.shaderCacheId = `rhi-benchmark-${scenarioId}-${String(variant)}`;
    material.onBeforeCompile = (vs, fs) => ({
        vs: `${vs}\n// rhi benchmark variant ${String(variant)} vertex`,
        fs: `${fs}\n// rhi benchmark variant ${String(variant)} fragment`
    });
    return material;
}

function fullscreenGeometry(): Geometry {
    return new Geometry({
        vertices: new GeometryData(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
    });
}

function benchmarkBoxGeometry(): BoxGeometry {
    return new BoxGeometry().setAllRectUV([
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0]
    ]);
}

function mrtMaterial(): ShaderMaterial {
    return new ShaderMaterial({
        needBasicUniforms: false,
        needBasicAttributes: false,
        depthTest: false,
        cullFace: false,
        attributes: { a_position: 'POSITION' },
        vs: `#version 300 es
            in vec3 a_position;
            void main() { gl_Position = vec4(a_position, 1.0); }`,
        fs: `#version 300 es
            precision highp float;
            layout(location=0) out vec4 color0;
            layout(location=1) out vec4 color1;
            layout(location=2) out vec4 color2;
            layout(location=3) out vec4 color3;
            void main() {
                color0 = vec4(0.2, 0.4, 0.8, 1.0);
                color1 = vec4(0.8, 0.2, 0.4, 1.0);
                color2 = vec4(0.4, 0.8, 0.2, 1.0);
                color3 = vec4(0.6, 0.3, 0.9, 1.0);
            }`
    });
}

function createRenderer(
    architecture: RendererArchitecture,
    backend: RHIBenchmarkBackend,
    canvas: HTMLCanvasElement,
    quality: RHIBenchmarkQuality,
    adapterPolicy: 'physical' | 'swiftshader'
): RendererCore {
    const common = {
        domElement: canvas,
        width: quality.width,
        height: quality.height,
        pixelRatio: quality.devicePixelRatio,
        antialias: quality.msaaSampleCount === 4,
        failIfMajorPerformanceCaveat: adapterPolicy === 'physical',
        powerPreference: 'high-performance' as const,
        useInstanced: quality.instanceCount > 1
    };
    if (architecture === 'legacy') {
        return backend === 'webgl2'
            ? new WebGL2Driver({ ...common, preserveDrawingBuffer: true })
            : new WebGPUDriver({
                  ...common,
                  forceFallbackAdapter: adapterPolicy === 'swiftshader',
                  requiredFeatures: ['timestamp-query']
              });
    }
    return backend === 'webgl2'
        ? new SharedRendererDriver(backend, { ...common, preserveDrawingBuffer: true })
        : new SharedRendererDriver(backend, {
              ...common,
              forceFallbackAdapter: adapterPolicy === 'swiftshader',
              requiredFeatures: ['timestamp-query']
          });
}

function addLights(scene: Node, quality: RHIBenchmarkQuality): void {
    if (quality.lightCount === 0) return;
    scene.addChild(new AmbientLight({ amount: 0.2 }));
    for (let index = 1; index < quality.lightCount; index += 1) {
        if (index <= 4) {
            scene.addChild(
                new DirectionalLight({
                    amount: 0.8,
                    direction: new Vector3(-1 + index * 0.1, -1, -0.5),
                    ...(index === 1 && quality.shadowMapSize > 0
                        ? {
                              shadow: {
                                  width: quality.shadowMapSize,
                                  height: quality.shadowMapSize
                              }
                          }
                        : {})
                })
            );
        } else {
            scene.addChild(
                new PointLight({
                    amount: 1.2,
                    x: (index % 3) - 1,
                    y: 1 + (index % 2),
                    z: 2,
                    range: 12
                })
            );
        }
    }
}

class BrowserBenchmarkFixture implements RHIBenchmarkProductionFixture {
    readonly metadata: RHIBenchmarkFixtureMetadata;
    readonly #canvas: HTMLCanvasElement;
    readonly #renderer: RendererCore;
    readonly #diagnostics: RendererDiagnostics;
    readonly #probe: TimingProbe;
    readonly #scenario: RHIBenchmarkScenarioManifest;
    readonly #scene = new Node() as RendererScene;
    readonly #camera: PerspectiveCamera;
    readonly #textures: BenchmarkTexture[] = [];
    readonly #materials: (BasicMaterial | PBRMaterial | ShaderMaterial)[] = [];
    readonly #meshes: Mesh[] = [];
    readonly #nativeWebGL: () => WebGL2RenderingContext | null;
    #target: RenderTarget | null = null;
    #mrtMSAAPostProcess: MRTMSAAPostProcessWorkload | null = null;
    #dynamicTexture: BenchmarkTexture | null = null;
    #dynamicPixels: Uint8Array | null = null;
    #dynamicExternalContext: CanvasRenderingContext2D | null = null;
    #dynamicExternalPixels: ImageData | null = null;
    #dynamicGeometry: GeometryData | null = null;
    readonly #dynamicGeometryUpdate = new Float32Array(1);
    #dynamicGeometryBaseValue = 0;
    #frameIndex = 0;
    #heapHighWaterBytes = 0;
    #firstComplexFrameCpuMs = 0;
    #firstFrameRecorded = false;
    #allocationSampling = false;
    #destroyed = false;

    private constructor(
        metadata: RHIBenchmarkFixtureMetadata,
        scenario: RHIBenchmarkScenarioManifest,
        canvas: HTMLCanvasElement,
        renderer: RendererCore,
        diagnostics: RendererDiagnostics,
        probe: TimingProbe,
        nativeWebGL: () => WebGL2RenderingContext | null
    ) {
        this.metadata = metadata;
        this.#scenario = scenario;
        this.#canvas = canvas;
        this.#renderer = renderer;
        this.#diagnostics = diagnostics;
        this.#probe = probe;
        this.#nativeWebGL = nativeWebGL;
        this.#camera = new PerspectiveCamera({
            aspect: scenario.quality.width / scenario.quality.height,
            near: 0.1,
            far: 100,
            z: 4
        });
    }

    static async create(
        scenario: RHIBenchmarkScenarioManifest,
        architecture: RendererArchitecture,
        backend: RHIBenchmarkBackend,
        round: number,
        orderPosition: number,
        adapterPolicy: 'physical' | 'swiftshader'
    ): Promise<BrowserBenchmarkFixture> {
        if (!globalThis.crossOriginIsolated) {
            fixtureFailure('benchmark requires a cross-origin-isolated high-resolution clock');
        }
        const canvas = document.createElement('canvas');
        canvas.width = scenario.quality.width;
        canvas.height = scenario.quality.height;
        canvas.dataset['hilo3dBackend'] = backend;
        document.body.appendChild(canvas);
        const nativeWebGL = captureWebGL2Context(canvas);
        const diagnostics = registerRendererDiagnostics(canvas);
        const probe = new TimingProbe(architecture);
        try {
            const renderer = createRenderer(
                architecture,
                backend,
                canvas,
                scenario.quality,
                adapterPolicy
            );
            await renderer.ready;
            renderer.resize(scenario.quality.width, scenario.quality.height, true);
            const fixture = new BrowserBenchmarkFixture(
                {
                    protocolVersion: RHI_BENCHMARK_FIXTURE_PROTOCOL_VERSION,
                    isolationId: crypto.randomUUID(),
                    architecture,
                    backend,
                    scenarioId: scenario.id,
                    quality: scenario.quality,
                    capabilities: {
                        cpuSegments: 'instrumented-production-method-boundaries-v1',
                        highResolutionClock: 'cross-origin-isolated-performance-now-v1',
                        gpuTimer:
                            backend === 'webgl2'
                                ? 'ext-disjoint-timer-query-webgl2'
                                : 'webgpu-timestamp-query',
                        allocationProfiler: RHI_BENCHMARK_ALLOCATION_PROFILER_PROTOCOL,
                        preciseMemory: 'chromium-precise-memory-v1',
                        nativeCounters: 'renderer-diagnostics-v1'
                    }
                },
                scenario,
                canvas,
                renderer,
                diagnostics,
                probe,
                nativeWebGL
            );
            fixture.buildScene();
            void round;
            void orderPosition;
            return fixture;
        } catch (error) {
            probe.destroy();
            unregisterRendererDiagnostics(canvas, diagnostics);
            canvas.remove();
            throw error;
        }
    }

    private buildScene(): void {
        const quality = this.#scenario.quality;
        const shadowDraws = quality.shadowMapSize > 0 ? 1 : 0;
        const isPbr =
            this.#scenario.id === 'pbr-lights-shadows' ||
            this.#scenario.id === 'first-complex-frame';
        const textureSize =
            quality.dynamicUploadBytesPerFrame > 0
                ? Math.sqrt(quality.dynamicUploadBytesPerFrame / 4)
                : 2;
        for (let index = 0; index < quality.textureCount; index += 1) {
            if (quality.dynamicUploadBytesPerFrame > 0 && index === 0) {
                if (!Number.isInteger(textureSize)) {
                    fixtureFailure('dynamic upload byte count must describe one square RGBA image');
                }
                const dynamic = texture(textureSize, index + 1);
                const pixels = dynamic.image;
                if (!(pixels instanceof Uint8Array)) {
                    fixtureFailure('dynamic typed-array texture lost its byte source');
                }
                this.#textures.push(dynamic);
                this.#dynamicTexture = dynamic;
                this.#dynamicPixels = pixels;
            } else if (quality.dynamicUploadBytesPerFrame > 0 && index === 1) {
                const external = dynamicExternalTexture(index + 1);
                this.#textures.push(external.texture);
                this.#dynamicExternalContext = external.context;
                this.#dynamicExternalPixels = external.pixels;
            } else {
                this.#textures.push(texture(2, index + 1));
            }
        }
        if (
            quality.dynamicUploadBytesPerFrame > 0 &&
            (this.#dynamicTexture === null || this.#dynamicExternalContext === null)
        ) {
            fixtureFailure('dynamic upload scenario requires typed-array and external textures');
        }
        for (let index = 0; index < quality.shaderVariantCount; index += 1) {
            this.#materials.push(
                variantMaterial(
                    this.#scenario.id,
                    index,
                    this.#textures[index % Math.max(1, this.#textures.length)] ?? null,
                    isPbr,
                    this.#textures
                )
            );
        }
        if (shadowDraws > 0) {
            if (this.#materials.length < 2) {
                fixtureFailure('a shadow benchmark requires a dedicated caster material');
            }
            for (const material of this.#materials) material.castShadows = false;
        }
        addLights(this.#scene, quality);
        if (this.#scenario.id === 'large-instancing') {
            this.buildInstancingScene();
        } else {
            const primaryDraws =
                this.#scenario.id === 'mrt-msaa-postprocess'
                    ? mrtMSAAPostProcessPrimaryDrawCount(quality.drawCount)
                    : benchmarkPrimaryDrawCount(
                          quality.drawCount,
                          quality.postProcessPassCount,
                          shadowDraws
                      );
            const geometry =
                this.#scenario.id === 'mrt-msaa-postprocess'
                    ? fullscreenGeometry()
                    : benchmarkBoxGeometry();
            if (quality.dynamicUploadBytesPerFrame > 0 && geometry.vertices) {
                geometry.isStatic = false;
                this.#dynamicGeometry = geometry.vertices;
                this.#dynamicGeometryBaseValue = geometry.vertices.data[0] ?? 0;
            }
            if (this.#scenario.id === 'mrt-msaa-postprocess') {
                this.#materials.length = 0;
                this.#materials.push(mrtMaterial());
            }
            for (let index = 0; index < primaryDraws; index += 1) {
                const material =
                    this.#materials[
                        benchmarkMaterialIndex(index, this.#materials.length, shadowDraws > 0)
                    ];
                if (!material) fixtureFailure('scenario material set is empty');
                if (shadowDraws > 0) {
                    material.castShadows = benchmarkMeshCastsShadow(index, true);
                }
                const mesh = new Mesh({
                    geometry,
                    material,
                    frustumTest: false,
                    z: benchmarkMeshDepth(index, this.#scenario.id === 'scene-churn-10000-frame')
                });
                this.#meshes.push(mesh);
                this.#scene.addChild(mesh);
            }
        }
        if (quality.mrtColorAttachments > 1 || quality.postProcessPassCount > 0) {
            this.#target = this.#renderer.createRenderTarget(
                this.#scenario.id === 'mrt-msaa-postprocess'
                    ? mrtMSAAPostProcessSourceTargetParameters(quality.width, quality.height)
                    : {
                          width: quality.width,
                          height: quality.height,
                          sampleCount: quality.msaaSampleCount as 1 | 4,
                          colorAttachments: Array.from(
                              { length: quality.mrtColorAttachments },
                              (_, index) => ({
                                  format: 'rgba8unorm' as const,
                                  clearValue: {
                                      r: index * 0.02,
                                      g: 0.03,
                                      b: 0.05,
                                      a: 1
                                  }
                              })
                          ),
                          depthStencilAttachment: { format: 'depth24plus' },
                          label: `${this.#scenario.id} benchmark target`
                      }
            );
        }
        if (this.#scenario.id === 'mrt-msaa-postprocess') {
            const source = this.#target;
            if (!source) fixtureFailure('MRT/MSAA post-process source target is missing');
            if (quality.postProcessPassCount !== MRT_MSAA_POSTPROCESS_EFFECT_PASS_COUNT) {
                fixtureFailure('MRT/MSAA post-process manifest must require exactly three effects');
            }
            this.#mrtMSAAPostProcess = createMRTMSAAPostProcessWorkload(
                this.#renderer,
                source,
                quality.width,
                quality.height
            );
        }
        this.#heapHighWaterBytes = benchmarkMemory().usedJSHeapSize;
    }

    private buildInstancingScene(): void {
        const quality = this.#scenario.quality;
        const batchSize = 128;
        const batchCount = Math.ceil(quality.instanceCount / batchSize);
        if (batchCount !== quality.drawCount) {
            fixtureFailure(
                `large-instancing drawCount must equal ceil(instanceCount/${String(batchSize)})`
            );
        }
        let remaining = quality.instanceCount;
        for (let batch = 0; batch < batchCount; batch += 1) {
            const material = variantMaterial(
                this.#scenario.id,
                0,
                this.#textures[0] ?? null,
                false
            );
            this.#materials.push(material);
            const geometry = benchmarkBoxGeometry();
            const instances = Math.min(batchSize, remaining);
            remaining -= instances;
            for (let index = 0; index < instances; index += 1) {
                const mesh = new Mesh({
                    geometry,
                    material,
                    useInstanced: true,
                    frustumTest: false,
                    x: ((index + batch * batchSize) % 100) * 0.001,
                    y: Math.floor((index + batch * batchSize) / 100) * 0.001
                });
                this.#meshes.push(mesh);
                this.#scene.addChild(mesh);
            }
        }
    }

    private updateScenario(): void {
        const pixels = this.#dynamicPixels;
        if (pixels && this.#dynamicTexture) {
            const offset = (this.#frameIndex * 4) % pixels.length;
            pixels[offset] = ((pixels[offset] ?? 0) + 1) & 0xff;
            this.#dynamicTexture.image = pixels;
        }
        const externalPixels = this.#dynamicExternalPixels;
        const externalContext = this.#dynamicExternalContext;
        if (externalPixels && externalContext) {
            const offset = (this.#frameIndex * 4) % externalPixels.data.length;
            externalPixels.data[offset] = ((externalPixels.data[offset] ?? 0) + 1) & 0xff;
            externalContext.putImageData(externalPixels, 0, 0);
        }
        const dynamicGeometry = this.#dynamicGeometry;
        if (dynamicGeometry) {
            this.#dynamicGeometryUpdate[0] =
                this.#dynamicGeometryBaseValue + (this.#frameIndex % 2 === 0 ? 0 : 0.0001);
            dynamicGeometry.setSubData(0, this.#dynamicGeometryUpdate);
        }
        if (this.#scenario.id === 'scene-churn-10000-frame') {
            const slot = this.#frameIndex % this.#meshes.length;
            const previous = this.#meshes[slot];
            if (!previous) fixtureFailure('scene churn mesh slot is missing');
            previous.destroy(this.#renderer as never);
            const material = variantMaterial(
                this.#scenario.id,
                this.#frameIndex % this.#scenario.quality.shaderVariantCount,
                this.#textures[this.#frameIndex % Math.max(1, this.#textures.length)] ?? null,
                false
            );
            material.castShadows = benchmarkMeshCastsShadow(
                slot,
                this.#scenario.quality.shadowMapSize > 0
            );
            const replacement = new Mesh({
                geometry: benchmarkBoxGeometry(),
                material,
                frustumTest: false,
                z: benchmarkMeshDepth(slot, true)
            });
            // The replacement mesh owns this transient material reference. Retaining every churn
            // material in the fixture would manufacture an unbounded leak in both architectures.
            this.#meshes[slot] = replacement;
            this.#scene.addChild(replacement);
        }
        this.#scene.traverseUpdate(1 / 60);
        this.#frameIndex += 1;
    }

    private renderRendererFrame(): void {
        const target = this.#target;
        if (target) {
            this.#renderer.renderFrame(frame => {
                const postProcess = this.#mrtMSAAPostProcess;
                if (postProcess) {
                    recordMRTMSAAPostProcessWorkload(frame, postProcess, this.#scene, this.#camera);
                    return;
                }
                frame.renderToTarget(target, this.#scene, this.#camera);
                for (let pass = 0; pass < this.#scenario.quality.postProcessPassCount; pass += 1) {
                    frame.present(target);
                }
            });
        } else {
            this.#renderer.render(this.#scene, this.#camera);
        }
    }

    private renderFrame(): void {
        this.updateScenario();
        this.renderRendererFrame();
    }

    /** Named CDP root that excludes application-side scene/workload mutation. */
    private renderAllocationRendererBoundary(): void {
        this.renderRendererFrame();
    }

    private recordHeap(): number {
        const used = benchmarkMemory().usedJSHeapSize;
        this.#heapHighWaterBytes = Math.max(this.#heapHighWaterBytes, used);
        return used;
    }

    async warmup(frameCount: number): Promise<void> {
        let inFlightFrames = 0;
        for (let frame = 0; frame < frameCount; frame += 1) {
            if (!this.#firstFrameRecorded) {
                const timing = this.#probe.measureRenderer(() => {
                    this.renderFrame();
                });
                this.#firstComplexFrameCpuMs = timing.rendererCpuMs;
                this.#firstFrameRecorded = true;
            } else {
                this.renderFrame();
            }
            this.recordHeap();
            inFlightFrames += 1;
            if (benchmarkInFlightBatchIsFull(inFlightFrames)) {
                await this.#renderer.waitForIdle();
                inFlightFrames = 0;
            }
        }
        if (inFlightFrames > 0) await this.#renderer.waitForIdle();
    }

    async sampleTimingFrames(
        frameCount: number
    ): Promise<readonly RHIBenchmarkFixtureFrameSample[]> {
        const samples = new Array<RHIBenchmarkFixtureFrameSample>(frameCount);
        let inFlightFrames = 0;
        for (let frame = 0; frame < frameCount; frame += 1) {
            const before = this.#diagnostics.snapshot();
            const timing = this.#probe.measureRenderer(() => {
                this.renderFrame();
            });
            const after = this.#diagnostics.snapshot();
            samples[frame] = {
                timing,
                diagnostics: frameDiagnostics(before, after),
                heapUsedBytes: this.recordHeap()
            };
            inFlightFrames += 1;
            if (benchmarkInFlightBatchIsFull(inFlightFrames)) {
                await this.#renderer.waitForIdle();
                inFlightFrames = 0;
            }
        }
        if (inFlightFrames > 0) await this.#renderer.waitForIdle();
        return samples;
    }

    async sampleGpuFrames(frameCount: number): Promise<readonly number[]> {
        if (this.metadata.backend === 'webgl2') return this.sampleWebGLGpuFrames(frameCount);
        return this.sampleWebGPUGpuFrames(frameCount);
    }

    private async sampleWebGLGpuFrames(frameCount: number): Promise<readonly number[]> {
        const gl = this.#nativeWebGL();
        if (!gl) fixtureFailure('WebGL2 context was not captured');
        const extensionValue: unknown = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        if (typeof extensionValue !== 'object' || extensionValue === null) {
            fixtureFailure('EXT_disjoint_timer_query_webgl2 is unavailable');
        }
        const extension = extensionValue as Record<string, unknown>;
        const timeElapsed = extension['TIME_ELAPSED_EXT'];
        const gpuDisjoint = extension['GPU_DISJOINT_EXT'];
        if (typeof timeElapsed !== 'number' || typeof gpuDisjoint !== 'number') {
            fixtureFailure('EXT_disjoint_timer_query_webgl2 constants are unavailable');
        }
        const samples = new Array<number>(frameCount);
        for (let frame = 0; frame < frameCount; frame += 1) {
            const query = gl.createQuery();
            gl.beginQuery(timeElapsed, query);
            this.renderFrame();
            gl.endQuery(timeElapsed);
            let attempts = 0;
            while (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
                if (attempts++ > 100_000) fixtureFailure('WebGL2 timer query timed out');
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            if (gl.getParameter(gpuDisjoint) === true) {
                fixtureFailure('WebGL2 GPU timer became disjoint');
            }
            const elapsed: unknown = gl.getQueryParameter(query, gl.QUERY_RESULT);
            if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) {
                fixtureFailure('WebGL2 GPU timer result is invalid');
            }
            samples[frame] = elapsed / 1_000_000;
            gl.deleteQuery(query);
            this.recordHeap();
        }
        return samples;
    }

    private nativeWebGPUDevice(): GPUDevice {
        if (this.metadata.architecture === 'legacy') {
            const extension = this.#renderer.getExtension(
                'webgpu-native'
            ) as NativeWebGPUExtension | null;
            if (!extension?.gpuDevice) fixtureFailure('legacy WebGPU native device is unavailable');
            return extension.gpuDevice;
        }
        const extension = this.#renderer.getExtension('rhi') as RHIExtension | null;
        const device = extension?.device.nativeHandle;
        if (!device) fixtureFailure('RHI WebGPU native device is unavailable');
        return device;
    }

    private async sampleWebGPUGpuFrames(frameCount: number): Promise<readonly number[]> {
        const device = this.nativeWebGPUDevice();
        if (!device.features.has('timestamp-query')) {
            fixtureFailure('WebGPU timestamp-query feature is unavailable');
        }
        const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
        const QUERY_RESOLVE = 0x0200;
        const COPY_SRC = 0x0004;
        const COPY_DST = 0x0008;
        const MAP_READ = 0x0001;
        const resolveBuffer = device.createBuffer({
            size: 16,
            usage: QUERY_RESOLVE | COPY_SRC
        });
        const readBuffer = device.createBuffer({
            size: 16,
            usage: COPY_DST | MAP_READ
        });
        const samples = new Array<number>(frameCount);
        try {
            for (let frame = 0; frame < frameCount; frame += 1) {
                const before = device.createCommandEncoder();
                before
                    .beginComputePass({
                        timestampWrites: { querySet, beginningOfPassWriteIndex: 0 }
                    })
                    .end();
                device.queue.submit([before.finish()]);
                this.renderFrame();
                const after = device.createCommandEncoder();
                after
                    .beginComputePass({
                        timestampWrites: { querySet, endOfPassWriteIndex: 1 }
                    })
                    .end();
                after.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
                after.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
                device.queue.submit([after.finish()]);
                await readBuffer.mapAsync(MAP_READ);
                const timestamps = new BigUint64Array(readBuffer.getMappedRange());
                const start = timestamps[0];
                const end = timestamps[1];
                if (start === undefined || end === undefined || end < start) {
                    fixtureFailure('WebGPU timestamp query result is invalid');
                }
                samples[frame] = Number(end - start) / 1_000_000;
                readBuffer.unmap();
                this.recordHeap();
            }
        } finally {
            querySet.destroy();
            resolveBuffer.destroy();
            readBuffer.destroy();
        }
        return samples;
    }

    beginAllocationSampling(): void {
        if (this.#allocationSampling) {
            fixtureFailure('allocation sampling phase is already active');
        }
        // Rest-parameter timing wrappers allocate argument arrays and rewriting prototypes between
        // samples deoptimizes the exact call sites under test. Suspend once for the whole phase.
        this.#probe.suspend();
        this.#allocationSampling = true;
    }

    renderAllocationFrame(): void {
        if (!this.#allocationSampling) {
            fixtureFailure('allocation frame requires an active sampling phase');
        }
        this.updateScenario();
        this.renderAllocationRendererBoundary();
        this.recordHeap();
    }

    async settleAllocationFrame(): Promise<void> {
        await this.#renderer.waitForIdle();
    }

    endAllocationSampling(): void {
        if (!this.#allocationSampling) {
            fixtureFailure('allocation sampling phase is not active');
        }
        this.#allocationSampling = false;
        this.#probe.resume();
    }

    async completeRound(): Promise<void> {
        const churnFrames = this.#scenario.quality.churnFrames;
        let inFlightFrames = 0;
        while (this.#frameIndex < churnFrames) {
            this.renderFrame();
            this.recordHeap();
            inFlightFrames += 1;
            if (benchmarkInFlightBatchIsFull(inFlightFrames)) {
                await this.#renderer.waitForIdle();
                inFlightFrames = 0;
            }
        }
        if (churnFrames > 0 && this.#frameIndex !== churnFrames) {
            fixtureFailure('scene churn exceeded its fixed 10,000-frame budget');
        }
        if (inFlightFrames > 0) await this.#renderer.waitForIdle();
    }

    private async pixelHash(): Promise<string> {
        const blob = await new Promise<Blob>((resolve, reject) => {
            this.#canvas.toBlob(value => {
                if (value) resolve(value);
                else reject(new Error('canvas PNG capture failed'));
            }, 'image/png');
        });
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(
            ''
        );
    }

    capturePixelHash(): Promise<string> {
        return this.pixelHash();
    }

    async finishRound(retainedHeapBytes: number): Promise<RHIBenchmarkFixtureRoundResult> {
        if (!Number.isSafeInteger(retainedHeapBytes) || retainedHeapBytes < 0) {
            fixtureFailure('retained heap is not an exact byte count');
        }
        const snapshot = this.#diagnostics.snapshot();
        return {
            heapHighWaterBytes: this.#heapHighWaterBytes,
            retainedHeapBytes,
            nativeCreateCounts: nativeCreateCounts(snapshot),
            firstComplexFrameCpuMs: this.#firstComplexFrameCpuMs,
            shaderFirstPrepareMs: this.#probe.shaderPrepareMs,
            pipelineFirstPrepareMs: this.#probe.pipelinePrepareMs,
            pixelHashSha256: await this.pixelHash()
        };
    }

    destroy(): Promise<void> {
        if (this.#destroyed) return Promise.resolve();
        this.#destroyed = true;
        for (const pass of this.#mrtMSAAPostProcess?.passes ?? []) pass.output?.destroy();
        this.#target?.destroy();
        this.#renderer.destroy();
        this.#probe.destroy();
        unregisterRendererDiagnostics(this.#canvas, this.#diagnostics);
        this.#canvas.remove();
        return Promise.resolve();
    }
}

async function main(): Promise<void> {
    const manifest = fixtureManifest(manifestValue);
    const query = new URLSearchParams(location.search);
    const architecture = queryParameter(query, 'architecture', [
        'legacy',
        'rhi'
    ]) as RendererArchitecture;
    const backend = queryParameter(query, 'backend', ['webgl2', 'webgpu']) as RHIBenchmarkBackend;
    const scenario = scenarioFromManifest(
        manifest,
        queryParameter(
            query,
            'scenario',
            manifest.scenarios.map(candidate => candidate.id)
        )
    );
    const round = Number(query.get('round'));
    const orderPosition = Number(query.get('orderPosition'));
    const adapterPolicy = queryParameter(query, 'adapterPolicy', ['physical', 'swiftshader']) as
        'physical' | 'swiftshader';
    if (!Number.isSafeInteger(round) || round < 1 || round > manifest.sampling.rounds) {
        fixtureFailure('round query parameter is out of range');
    }
    if (orderPosition !== 0 && orderPosition !== 1) {
        fixtureFailure('orderPosition query parameter is out of range');
    }
    window.__HILO3D_RHI_BENCHMARK__ = await BrowserBenchmarkFixture.create(
        scenario,
        architecture,
        backend,
        round,
        orderPosition,
        adapterPolicy
    );
}

if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    document.documentElement.dataset['hiloRhiBenchmark'] === 'production-rhi'
) {
    void main().catch((error: unknown) => {
        window.__HILO3D_RHI_BENCHMARK_ERROR__ =
            error instanceof Error
                ? `${error.name}: ${error.message}\n${error.stack ?? ''}`
                : String(error);
    });
}
