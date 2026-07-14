import type Camera from '../../camera/Camera';
import OrthographicCamera from '../../camera/OrthographicCamera';
import PerspectiveCamera from '../../camera/PerspectiveCamera';
import type Fog from '../../core/Fog';
import type Mesh from '../../core/Mesh';
import GeometryData from '../../geometry/GeometryData';
import CameraHelper from '../../helper/CameraHelper';
import type Light from '../../light/Light';
import type { ShadowCameraParameters } from '../../light/Light';
import type DirectionalLight from '../../light/DirectionalLight';
import type PointLight from '../../light/PointLight';
import type SpotLight from '../../light/SpotLight';
import {
    POINT_SHADOW_DIRECTIONS,
    POINT_SHADOW_UPS,
    resolvePointShadowCameraPlanes
} from '../../light/PointShadowCamera';
import type Material from '../../material/Material';
import GeometryMaterial from '../../material/GeometryMaterial';
import semantic from '../../material/semantic';
import Color from '../../math/Color';
import Matrix4 from '../../math/Matrix4';
import Vector3 from '../../math/Vector3';
import type { WebGPUDevice } from '../../rhi/webgpu/WebGPUDevice';
import { WebGPURHI } from '../../rhi/webgpu/WebGPURHI';
import Shader from '../../shader/Shader';
import { CollisionSafeVariantKeyRegistry } from '../../shader/VariantHash';
import presentFragmentSource from '../../shader/present.frag';
import presentVertexSource from '../../shader/present.vert';
import {
    NagaShaderTranslator,
    specializeWebGPUDepthSamplers,
    type TranslatedShaderPair,
    type WebGPUVertexInput
} from '../shader/GlslToWgsl';
import Texture from '../../texture/Texture';
import { DEPTH } from '../../constants/Hilo';
import {
    BACK,
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    LINEAR,
    LINE_STRIP,
    LINES,
    TRIANGLE_STRIP,
    UNSIGNED_INT
} from '../../constants/webgl';
import { DEPTH_COMPONENT24 } from '../../constants/webgl2';
import type { ManagedResource } from '../common/GraphicsResourceManager';
import RenderList from '../common/RenderList';
import BuiltInUniformBlockManager from '../common/BuiltInUniformBlockManager';
import { touchBoundedLruEntry } from '../common/BoundedLruCache';
import UniformBuffer from '../common/UniformBuffer';
import {
    BUILT_IN_UNIFORM_BLOCK_LAYOUTS,
    instanceBlockLayout,
    MAX_AREA_LIGHTS,
    MAX_DIRECTIONAL_LIGHTS,
    MAX_INSTANCES_PER_DRAW,
    MAX_POINT_LIGHTS,
    MAX_SHADOW_ATLAS_SLICES,
    MAX_SPOT_LIGHTS
} from '../common/ubo/BuiltInUniformBlocks';
import {
    createRendererFrame,
    invokeRendererFrameCallback,
    default as Renderer,
    type RendererFrameCallback,
    type RendererScene,
    type RendererViewport,
    type TextureCompressionFormat
} from '../common/Renderer';
import type {
    RenderTarget,
    RenderTargetParameters,
    RenderTargetSelectionOptions
} from '../common/RenderTarget';
import type { ShaderPrecision } from '../common/types';
import WebGPUBindGroupManager, {
    type ResolvedWebGPUSampler,
    type WebGPUPipelineBindingLayout
} from './WebGPUBindGroupManager';
import {
    WebGPUBufferManager,
    type WebGPUIndexBufferBinding,
    type WebGPUInstanceBufferSource,
    type WebGPUVertexBufferSource,
    type WebGPUVertexBufferBinding
} from './WebGPUBufferManager';
import { WebGPUTextureUsage } from './WebGPUConstants';
import WebGPUCommandState from './WebGPUCommandState';
import { WebGPUPipelineManager } from './WebGPUPipelineManager';
import {
    createWebGPURenderState,
    resolveWebGPUFragmentColorFormats,
    type WebGPURenderState
} from './WebGPURenderState';
import {
    type default as WebGPUTextureManager,
    beginWebGPUTextureSubmission,
    createWebGPUTextureManagerForRHI,
    endWebGPUTextureSubmission,
    restoreWebGPUTextureDevice,
    suspendWebGPUTextures,
    resolveWebGPUTextureFormat
} from './WebGPUTextureManager';
import WebGPURenderTarget, {
    createWebGPURenderTargetForRHI,
    restoreWebGPURenderTarget,
    setWebGPURenderTargetOperationGuard,
    suspendWebGPURenderTarget
} from './WebGPURenderTarget';
import {
    createWebGPUFullscreenPassBindGroup,
    createWebGPUFullscreenPassResources,
    type WebGPUFullscreenPassResources
} from './WebGPUFullscreenPass';
import {
    WebGPUUniformBufferManager,
    type WebGPUUniformBufferBinding
} from './WebGPUUniformBufferManager';

/** Specialized module variants retained for each translated base shader. */
export const MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS = 32;

export interface WebGPURendererParameters {
    width?: number;
    height?: number;
    pixelRatio?: number;
    domElement?: HTMLCanvasElement | null;
    useInstanced?: boolean;
    alpha?: boolean;
    depth?: boolean;
    stencil?: boolean;
    antialias?: boolean;
    premultipliedAlpha?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    powerPreference?: GPUPowerPreference;
    forceFallbackAdapter?: boolean;
    requiredFeatures?: readonly GPUFeatureName[];
    requiredLimits?: Readonly<Record<string, number>>;
    useLogDepth?: boolean;
    vertexPrecision?: ShaderPrecision;
    fragmentPrecision?: ShaderPrecision;
    fog?: Fog | null;
    offsetX?: number;
    offsetY?: number;
    forceMaterial?: Material | null;
    clearColor?: Color;
}

/** Adapter-only options used by the lightweight WebGPU support probe. */
export interface WebGPUSupportOptions {
    powerPreference?: GPUPowerPreference;
    forceFallbackAdapter?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    requiredFeatures?: readonly GPUFeatureName[];
    requiredLimits?: Readonly<Record<string, number>>;
}

/**
 * Observable WebGPU device lifecycle.
 *
 * `recovering` skips render submissions while native resources are rebuilt. `failed` is terminal
 * for rendering and causes subsequent render calls to throw the recovery error. `destroyed` is
 * entered only by explicit renderer destruction.
 */
export type WebGPUDeviceRecoveryState =
    'initializing' | 'ready' | 'recovering' | 'failed' | 'destroyed';

interface CompiledWebGPUShader {
    readonly translated: TranslatedShaderPair;
    readonly vertexModule: GPUShaderModule;
    readonly fragmentModule: GPUShaderModule;
}

interface WebGPUDrawSetup {
    readonly pipeline: GPURenderPipeline;
    readonly renderState: WebGPURenderState;
    readonly vertexBuffers: readonly WebGPUVertexBufferBinding[];
    readonly indexBuffer: WebGPUIndexBufferBinding | null;
    readonly bindGroups: readonly GPUBindGroup[];
    readonly vertexCount: number;
    readonly instanceCount: number;
}

interface WebGPUDrawTargetState {
    readonly colorFormats: readonly (GPUTextureFormat | null)[];
    readonly depthStencilFormat?: GPUTextureFormat;
    readonly depthTestEnabled: boolean;
    readonly stencilTestEnabled: boolean;
    readonly sampleCount: 1 | 4;
}

interface WebGPUShadowSlice {
    readonly camera: Camera;
    readonly logicalIndex: number;
    readonly physicalIndex: number;
}

interface WebGPUShadowFrameData {
    readonly directionalMapSizes: Float32Array;
    readonly directionalBiases: Float32Array;
    readonly directionalMatrices: Float32Array;
    readonly spotMapSizes: Float32Array;
    readonly spotBiases: Float32Array;
    readonly spotMatrices: Float32Array;
    readonly pointBiases: Float32Array;
    readonly pointCameraPlanes: Float32Array;
    readonly pointMatrices: Float32Array;
}

interface WebGPUPresentPipeline extends WebGPUFullscreenPassResources {
    readonly pipeline: GPURenderPipeline;
}

interface WebGPUInstanceBatchOwner {
    readonly key: string;
}

function formatHasDepth(format: GPUTextureFormat | undefined): boolean {
    return format !== undefined && format !== 'stencil8';
}

function formatHasStencil(format: GPUTextureFormat | undefined): boolean {
    return (
        format === 'stencil8' ||
        format === 'depth24plus-stencil8' ||
        format === 'depth32float-stencil8'
    );
}

function cameraClippingPlanes(camera: Camera): { near: number; far: number } {
    const near: unknown = Reflect.get(camera, 'near');
    const far: unknown = Reflect.get(camera, 'far');
    if (typeof near !== 'number' || !Number.isFinite(near) || near <= 0) {
        throw new TypeError('Shadow rendering requires a camera with a positive finite near plane');
    }
    if (far !== null && (typeof far !== 'number' || !Number.isFinite(far) || far <= near)) {
        throw new TypeError(
            'Shadow rendering requires a null or finite far plane greater than near'
        );
    }
    return { near, far: far ?? near * 1000 };
}

function positiveShadowDimension(
    value: number | undefined,
    fallback: number,
    name: string
): number {
    const resolved = value ?? fallback;
    if (!Number.isFinite(resolved) || resolved <= 0 || !Number.isInteger(resolved)) {
        throw new RangeError(`${name} must be a positive integer`);
    }
    return resolved;
}

function materialFor(mesh: Mesh, forceMaterial: Material | null): Material {
    const material = forceMaterial ?? mesh.material;
    if (!material) throw new Error(`Mesh ${mesh.id} cannot render without a material`);
    return material;
}

function geometryFor(mesh: Mesh) {
    if (!mesh.geometry) throw new Error(`Mesh ${mesh.id} cannot render without geometry`);
    return mesh.geometry;
}

function isNumericArrayLike(value: unknown): value is ArrayLike<number> {
    if (typeof value !== 'object' || value === null || !('length' in value)) return false;
    const length: unknown = value.length;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) return false;
    for (let index = 0; index < length; index++) {
        if (typeof Reflect.get(value, index) !== 'number') return false;
    }
    return true;
}

function genericVertexAttributeSize(type: string): 1 | 2 | 3 | 4 | null {
    if (type === 'float' || type === 'int' || type === 'uint') return 1;
    const vector = /^(?:i|u)?vec([2-4])$/u.exec(type);
    const size = vector?.[1] === undefined ? Number.NaN : Number(vector[1]);
    return size === 2 || size === 3 || size === 4 ? size : null;
}

function adapterIsFallback(adapter: GPUAdapter): boolean {
    const info: unknown = Reflect.get(adapter, 'info');
    return (
        typeof info === 'object' && info !== null && Reflect.get(info, 'isFallbackAdapter') === true
    );
}

const LARGEST_BUILT_IN_UNIFORM_BLOCK = Math.max(
    ...Object.values(BUILT_IN_UNIFORM_BLOCK_LAYOUTS).map(layout => layout.byteLength)
);

function validateAdapterLimit(adapter: GPUAdapter, name: string, required: number): void {
    if (!Number.isSafeInteger(required) || required < 0) {
        throw new RangeError(`Required WebGPU limit ${name} must be a non-negative safe integer`);
    }
    if (required === 0) return;
    const supported: unknown = Reflect.get(adapter.limits, name);
    if (typeof supported !== 'number' || !Number.isFinite(supported)) {
        throw new Error(`WebGPU adapter does not expose required limit ${name}`);
    }
    const lowerIsBetter =
        name === 'minUniformBufferOffsetAlignment' || name === 'minStorageBufferOffsetAlignment';
    if ((lowerIsBetter && supported > required) || (!lowerIsBetter && supported < required)) {
        throw new Error(
            `WebGPU adapter limit ${name} is ${String(supported)}; ${String(required)} is required`
        );
    }
}

function validateWebGPUAdapter(adapter: GPUAdapter, options: WebGPUSupportOptions): void {
    if (options.failIfMajorPerformanceCaveat === true && adapterIsFallback(adapter)) {
        throw new Error('The available WebGPU adapter is a fallback/software adapter');
    }
    for (const feature of options.requiredFeatures ?? []) {
        if (!adapter.features.has(feature)) {
            throw new Error(`WebGPU adapter does not support required feature ${feature}`);
        }
    }
    for (const [name, required] of Object.entries(options.requiredLimits ?? {})) {
        validateAdapterLimit(adapter, name, required);
    }
    if (adapter.limits.maxBindGroups < 4) {
        throw new Error('WebGPU adapter exposes fewer than the four required bind groups');
    }
    if (adapter.limits.maxUniformBufferBindingSize < LARGEST_BUILT_IN_UNIFORM_BLOCK) {
        throw new Error(
            `WebGPU adapter exposes ${String(adapter.limits.maxUniformBufferBindingSize)} bytes per uniform buffer binding; Hilo3d requires ${String(LARGEST_BUILT_IN_UNIFORM_BLOCK)}`
        );
    }
    if (adapter.limits.maxUniformBuffersPerShaderStage < 9) {
        throw new Error(
            `WebGPU adapter exposes ${String(adapter.limits.maxUniformBuffersPerShaderStage)} uniform buffers per shader stage; Hilo3d built-in variants require 9`
        );
    }
}

function faceCount(mode: GLenum, vertexCount: number): number {
    if (mode === TRIANGLE_STRIP) return Math.max(0, vertexCount - 2);
    if (mode === LINES || mode === LINE_STRIP) return 0;
    return vertexCount / 3;
}

function isStripMode(mode: GLenum): boolean {
    return mode === LINE_STRIP || mode === TRIANGLE_STRIP;
}

type WebGPUDeviceLifecycleEventName =
    'webgpuDeviceLost' | 'webgpuDeviceRestored' | 'webgpuDeviceRecoveryFailed';

function reportToConsole(...values: unknown[]): void {
    const consoleObject: unknown = Reflect.get(globalThis, 'console');
    const consoleError: unknown =
        typeof consoleObject === 'object' && consoleObject !== null
            ? Reflect.get(consoleObject, 'error')
            : undefined;
    if (typeof consoleError !== 'function') return;
    try {
        const log = consoleError as (this: unknown, ...messages: unknown[]) => void;
        log.call(consoleObject, ...values);
    } catch {
        return;
    }
}

function reportAsynchronousError(error: Error): void {
    queueMicrotask(() => {
        const reporter: unknown = Reflect.get(globalThis, 'reportError');
        if (typeof reporter === 'function') {
            try {
                const report = reporter as (this: unknown, reportedError: Error) => void;
                report.call(globalThis, error);
                return;
            } catch (reportingError: unknown) {
                reportToConsole(error, reportingError);
                return;
            }
        }
        reportToConsole(error);
    });
}

const WEBGPU_TEXTURE_COMPRESSION_FEATURES: readonly GPUFeatureName[] = [
    'texture-compression-bc',
    'texture-compression-etc2',
    'texture-compression-astc'
];

/**
 * WebGPU renderer using the same GLSL source of truth through the Naga compiler.
 *
 * Device loss is recovered without switching backends. The renderer dispatches
 * `webgpuDeviceLost` with a `GPUDeviceLostInfo` detail before requesting a replacement
 * adapter/device. On success it dispatches `webgpuDeviceRestored` with the replacement
 * `GPUDevice`; on terminal failure it dispatches `webgpuDeviceRecoveryFailed` with the causal
 * `Error`. Render calls made while recovery is in progress skip the frame without a
 * queue submission. Render calls after a failed recovery throw explicitly.
 */
class WebGPURenderer extends Renderer {
    override readonly backend = 'webgpu' as const;
    override readonly className = 'WebGPURenderer';
    readonly isWebGPURenderer = true;
    override readonly ready: Promise<void>;

    powerPreference: GPUPowerPreference = 'high-performance';
    forceFallbackAdapter = false;
    requiredFeatures: readonly GPUFeatureName[] = [];
    requiredLimits: Readonly<Record<string, number>> = {};
    override renderTarget: WebGPURenderTarget | null = null;

    private readonly rejectFallbackAdapter: boolean;
    private rhi: WebGPURHI | null = null;
    private device: GPUDevice | null = null;
    private context: GPUCanvasContext | null = null;
    private canvasFormat: GPUTextureFormat = 'bgra8unorm';
    private depthStencilFormat: GPUTextureFormat | undefined;
    private sampleCount: 1 | 4 = 1;
    private depthTexture: GPUTexture | null = null;
    private multisampleTexture: GPUTexture | null = null;
    private readonly translator = new NagaShaderTranslator();
    private presentShader: TranslatedShaderPair | null = null;
    private compiledShaders = new WeakMap<Shader, CompiledWebGPUShader>();
    private depthOnlyCompiledShaders = new WeakMap<Shader, CompiledWebGPUShader>();
    private depthSpecializedShaders = new WeakMap<
        CompiledWebGPUShader,
        Map<string, CompiledWebGPUShader>
    >();
    private pipelineManager: WebGPUPipelineManager | null = null;
    private bufferManager: WebGPUBufferManager | null = null;
    private textureManager: WebGPUTextureManager | null = null;
    private recoveryTextureManager: WebGPUTextureManager | null = null;
    private uniformBufferManager: WebGPUUniformBufferManager | null = null;
    private bindGroupManager: WebGPUBindGroupManager | null = null;
    private readonly uniformBlockManager: BuiltInUniformBlockManager;
    private instanceUniformBuffers = new WeakMap<WebGPUInstanceBatchOwner, UniformBuffer>();
    private readonly instanceBatchOwners = new Map<string, WebGPUInstanceBatchOwner>();
    private readonly instanceBatchVariantKeys = new CollisionSafeVariantKeyRegistry();
    private readonly commandState = new WebGPUCommandState();
    private _activePass: GPURenderPassEncoder | null = null;
    private frameEncoder: GPUCommandEncoder | null = null;
    private frameCanvasTexture: GPUTexture | null = null;
    private frameHasCommands = false;
    private frameAborted = false;
    private frameAbortReason: unknown;
    private frameGeometryRevisions = new WeakMap<GeometryData, number>();
    private frameTextureRevisions = new WeakMap<Texture<unknown>, number>();
    private readonly frameResourceRoots = new Set<RendererScene>();
    private activeDrawTarget: WebGPUDrawTargetState | null = null;
    private activeViewport: RendererViewport | null = null;
    private ownsRenderTarget = false;
    private autoPresentRenderTarget = false;
    private readonly renderTargets = new Set<WebGPURenderTarget>();
    private readonly presentPipelines = new Map<GPUTextureSampleType, WebGPUPresentPipeline>();
    private presentBindGroups = new WeakMap<
        GPUTextureView,
        Map<GPUBindGroupLayout, GPUBindGroup>
    >();
    private bufferOwnerResources = new WeakMap<object, ManagedResource>();
    private uniformResources = new WeakMap<UniformBuffer, ManagedResource>();
    private readonly genericVertexAttributes = new WeakMap<object, Map<string, GeometryData>>();
    private nextManagedResourceId = 1;
    private shadowAtlasTexture: Texture<null> | null = null;
    private shadowAtlasGPUTexture: GPUTexture | null = null;
    private shadowAtlasWidth = 0;
    private shadowAtlasHeight = 0;
    private readonly shadowCameras = new Map<Light, Camera[]>();
    private readonly shadowCameraHelpers = new Map<Light, CameraHelper>();
    private readonly shadowMaterial = new GeometryMaterial({
        vertexType: DEPTH,
        side: BACK,
        writeOriginData: false
    });
    private destroyed = false;
    private initialized = false;
    private initializationGeneration = 0;
    private deviceStateActive = false;
    private deviceLossInfo: GPUDeviceLostInfo | null = null;
    private recoveryError: Error | null = null;
    private _recoveryState: WebGPUDeviceRecoveryState = 'initializing';
    private _recoveryPromise: Promise<void> | null = null;

    private get activePass(): GPURenderPassEncoder | null {
        return this._activePass;
    }

    private set activePass(pass: GPURenderPassEncoder | null) {
        this._activePass = pass;
        if (pass) this.commandState.beginPass(pass);
        else this.commandState.endPass();
    }

    /**
     * Probe adapter availability and the renderer's minimum limits without creating a device,
     * context, shader compiler, pipeline, or GPU resource.
     */
    static async isSupported(options: WebGPUSupportOptions = {}): Promise<boolean> {
        const snapshot: Required<WebGPUSupportOptions> = Object.freeze({
            powerPreference: options.powerPreference ?? 'high-performance',
            forceFallbackAdapter: options.forceFallbackAdapter ?? false,
            failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat ?? false,
            requiredFeatures: Object.freeze([...(options.requiredFeatures ?? [])]),
            requiredLimits: Object.freeze({ ...(options.requiredLimits ?? {}) })
        });
        return WebGPURHI.isSupported({
            powerPreference: snapshot.powerPreference,
            forceFallbackAdapter: snapshot.forceFallbackAdapter,
            adapterValidator: adapter => {
                validateWebGPUAdapter(adapter, snapshot);
            }
        });
    }

    constructor(params: WebGPURendererParameters = {}) {
        super();
        if (Object.prototype.hasOwnProperty.call(params, 'preserveDrawingBuffer')) {
            throw new TypeError(
                'WebGPU does not expose preserveDrawingBuffer; use an explicit copy/readback pass'
            );
        }
        Object.assign(this, params);
        this.requiredFeatures = [...(params.requiredFeatures ?? [])];
        this.requiredLimits = { ...(params.requiredLimits ?? {}) };
        this.rejectFallbackAdapter = this.failIfMajorPerformanceCaveat;
        this.uniformBlockManager = new BuiltInUniformBlockManager(this);
        this.ready = this.initialize(++this.initializationGeneration);
    }

    override get isReady(): boolean {
        return this.initialized && !this.destroyed && !this.isInitFailed;
    }

    /** Current initialization, recovery, failure, or destruction state. */
    get recoveryState(): WebGPUDeviceRecoveryState {
        return this._recoveryState;
    }

    /**
     * Promise for the most recently started device recovery, or `null` before the first loss.
     *
     * It resolves only after the canvas, managers, render targets, and device observers are bound
     * to the replacement device. It rejects with the recovery/cancellation error on terminal
     * failure. The settled promise remains observable until another loss starts a new recovery.
     */
    get recoveryPromise(): Promise<void> | null {
        return this._recoveryPromise;
    }

    get gpuDevice(): GPUDevice {
        if (!this.device)
            throw new Error('WebGPURenderer is not initialized; await renderer.ready');
        return this.device;
    }

    private get concreteDevice(): WebGPUDevice {
        const rhi = this.rhi;
        if (!rhi?.isReady) throw new Error('WebGPURenderer RHI is unavailable');
        return rhi.device;
    }

    private assertInitializationActive(generation: number): void {
        if (this.destroyed || generation !== this.initializationGeneration) {
            throw new Error('WebGPURenderer initialization was cancelled');
        }
    }

    private async initialize(generation: number): Promise<void> {
        let initializingRHI: WebGPURHI | null = null;
        try {
            this.assertInitializationActive(generation);
            if (this.alpha && !this.premultipliedAlpha) {
                throw new Error('WebGPU canvas compositing requires premultiplied alpha');
            }
            const canvas = this.domElement;
            if (!canvas) throw new Error('WebGPURenderer requires a canvas');
            initializingRHI = new WebGPURHI({
                canvas,
                width: this.width > 0 ? this.width : canvas.width,
                height: this.height > 0 ? this.height : canvas.height,
                powerPreference: this.powerPreference,
                alpha: this.alpha,
                antialias: this.antialias,
                forceFallbackAdapter: this.forceFallbackAdapter,
                rejectFallbackAdapter: this.rejectFallbackAdapter,
                nativeRequiredFeatures: this.requiredFeatures,
                nativeOptionalFeatures: [
                    'float32-filterable',
                    ...WEBGPU_TEXTURE_COMPRESSION_FEATURES
                ],
                requiredLimits: this.requiredLimits,
                adapterValidator: adapter => {
                    validateWebGPUAdapter(adapter, {
                        failIfMajorPerformanceCaveat: this.rejectFallbackAdapter,
                        requiredFeatures: this.requiredFeatures,
                        requiredLimits: this.requiredLimits
                    });
                },
                includeEmptyDeviceDescriptorFields: true
            });
            this.rhi = initializingRHI;
            await initializingRHI.ready;
            this.assertInitializationActive(generation);
            const device = initializingRHI.nativeDevice;
            this.device = device;
            this.deviceStateActive = true;
            const context = initializingRHI.nativeContext;
            this.context = context;
            this.canvasFormat = initializingRHI.surface.format;
            this.sampleCount = this.antialias ? 4 : 1;
            this.depthStencilFormat =
                this.depth || this.stencil
                    ? this.stencil
                        ? 'depth24plus-stencil8'
                        : 'depth24plus'
                    : undefined;
            await this.translator.initialize();
            this.assertInitializationActive(generation);
            this.pipelineManager = new WebGPUPipelineManager(initializingRHI.device);
            this.bufferManager = new WebGPUBufferManager(initializingRHI.device);
            this.textureManager = createWebGPUTextureManagerForRHI(
                initializingRHI.device,
                this.translator,
                () => {
                    this.bindGroupManager?.clearBindGroups();
                }
            );
            this.uniformBufferManager = new WebGPUUniformBufferManager(initializingRHI.device);
            this.bindGroupManager = new WebGPUBindGroupManager(
                initializingRHI.device,
                this.textureManager
            );
            Shader.init(this);
            this.renderList.useInstanced = this.useInstanced;
            this.createRenderAttachments();
            this.observeDevice(device, generation);
            this.initialized = true;
            this._recoveryState = 'ready';
            this.recoveryError = null;
            this.deviceLossInfo = null;
            this.fire('init');
        } catch (error: unknown) {
            const cancelled = this.destroyed || generation !== this.initializationGeneration;
            const failure = cancelled
                ? new Error('WebGPURenderer initialization was cancelled')
                : error instanceof Error
                  ? error
                  : new Error(String(error));
            this.disposeDeviceState();
            initializingRHI?.destroy();
            if (this.rhi === initializingRHI) this.rhi = null;
            if (!cancelled) {
                this.isInitFailed = true;
                this._recoveryState = 'failed';
                this.recoveryError = failure;
                this.fire('initFailed', failure);
            }
            throw failure;
        }
    }

    override resize(width: number, height: number, force = false): void {
        if (!force && this.width === width && this.height === height) return;
        this.assertNoActiveFrameMutation('resize');
        this.width = width;
        this.height = height;
        if (this.rhi?.isReady) {
            this.rhi.surface.resize(width, height);
        } else if (this.domElement) {
            this.domElement.width = width;
            this.domElement.height = height;
        }
        if (this.device) {
            this.createRenderAttachments();
        }
        this.activeViewport = null;
    }

    override setOffset(x: number, y: number): void {
        this.offsetX = x;
        this.offsetY = y;
        this.activeViewport = null;
    }

    private getDefaultViewport(): RendererViewport {
        const target = this.renderTarget;
        if (target) return [0, 0, target.width, target.height];
        const canvas = this.domElement;
        return [
            this.offsetX,
            this.offsetY,
            this.width > 0 ? this.width : Math.max(1, canvas?.width ?? 0),
            this.height > 0 ? this.height : Math.max(1, canvas?.height ?? 0)
        ];
    }

    /** Return the physical-pixel viewport used by the active render pass. */
    override getViewport(): RendererViewport {
        return this.activeViewport ?? this.getDefaultViewport();
    }

    private beginCameraPass(
        camera: Camera,
        viewport: RendererViewport = this.getDefaultViewport()
    ): void {
        this.activeViewport = viewport;
        semantic.setCamera(camera);
        semantic.setViewport(viewport);
        this.uniformBlockManager.beginPass(camera, viewport);
    }

    /** Run a callback once initialization is complete, consistently with WebGLRenderer. */
    override onInit(callback: (renderer: this) => void): void {
        if (this.isReady) {
            callback(this);
            return;
        }
        this.on(
            'init',
            () => {
                callback(this);
            },
            true
        );
    }

    override render(stage: RendererScene, camera: Camera, fireEvent = false): void {
        this.assertFrameUsable();
        try {
            this.renderInternal(stage, camera, fireEvent);
        } catch (error: unknown) {
            this.abortActiveFrame(error);
            throw error;
        }
    }

    private renderInternal(stage: RendererScene, camera: Camera, fireEvent: boolean): void {
        if (this._recoveryState === 'recovering') return;
        if (this._recoveryState === 'failed' && this.recoveryError) {
            const context = this.deviceLossInfo ? 'device recovery' : 'initialization';
            throw new Error(
                `WebGPURenderer cannot render because WebGPU ${context} failed: ${this.recoveryError.message}`,
                { cause: this.recoveryError }
            );
        }
        if (!this.isReady)
            throw new Error('WebGPURenderer is not ready; await stage.ready before rendering');
        const context = this.context;
        if (!context) throw new Error('WebGPU canvas context is unavailable');
        this.resourceManager.beginFrame();
        let ownsResourceSubmission = false;
        try {
            this.fog = stage.fog ?? null;
            this.renderInfo.reset();
            semantic.init(this, camera, this.lightManager, this.fog);
            stage.updateMatrixWorld();
            camera.updateViewProjectionMatrix();
            const sceneViewport = this.getDefaultViewport();
            this.activeViewport = sceneViewport;
            semantic.setViewport(sceneViewport);
            if (this.frameEncoder) this.uniformBlockManager.beginPass(camera, sceneViewport);
            else this.uniformBlockManager.beginFrame(camera, sceneViewport);

            const framePlan = this.buildFramePlan(stage, camera);
            this.pruneShadowOwners(framePlan.shadowLights);
            this.validateLightLimits();
            const ownsEncoder = this.frameEncoder === null;
            const encoder =
                this.frameEncoder ??
                this.concreteDevice.createNativeCommandEncoder({ label: 'Hilo3d frame' });
            if (ownsEncoder) {
                this.beginResourceSubmission();
                ownsResourceSubmission = true;
            }
            const shadowFrame = this.renderShadowAtlas(camera, framePlan.meshes, encoder);
            this.lightManager.updateInfo(camera);
            this.applyShadowFrameData(shadowFrame);
            this.beginCameraPass(camera, sceneViewport);
            if (fireEvent) this.fire('beforeRender');

            const renderTarget = this.renderTarget;
            const needsCanvasTexture = renderTarget === null || this.autoPresentRenderTarget;
            const currentTexture = needsCanvasTexture
                ? this.getFrameCanvasTexture(context, ownsEncoder)
                : null;
            const passDescriptor = renderTarget
                ? this.createRenderTargetPassDescriptor(renderTarget)
                : this.createCanvasRenderPassDescriptor(currentTexture);
            const targetLayout = renderTarget?.getRenderPassLayout();
            const targetDepthStencilFormat = targetLayout?.depthStencilFormat;
            this.activeDrawTarget = targetLayout
                ? {
                      colorFormats: targetLayout.colorFormats,
                      ...(targetDepthStencilFormat
                          ? { depthStencilFormat: targetDepthStencilFormat }
                          : {}),
                      depthTestEnabled: formatHasDepth(targetDepthStencilFormat),
                      stencilTestEnabled: formatHasStencil(targetDepthStencilFormat),
                      sampleCount: targetLayout.sampleCount as 1 | 4
                  }
                : this.getMainDrawTarget();
            this.activeViewport = sceneViewport;
            const pass = encoder.beginRenderPass(passDescriptor);
            this.activePass = pass;
            try {
                if (fireEvent) this.fire('beforeRenderScene');
                this.renderScene();
            } finally {
                this.activePass = null;
                this.activeDrawTarget = null;
                this.activeViewport = null;
                pass.end();
            }
            if (renderTarget && this.autoPresentRenderTarget) {
                if (!currentTexture) throw new Error('WebGPU presentation texture is unavailable');
                this.encodePresent(encoder, renderTarget, currentTexture);
            }
            if (ownsEncoder) this.concreteDevice.submitNative([encoder.finish()]);
            else this.frameHasCommands = true;
            this.resourceManager.endFrame();
        } catch (error: unknown) {
            this.resourceManager.abortFrame();
            this.resourceManager.destroyUnusedResource(stage);
            throw error;
        } finally {
            if (ownsResourceSubmission) this.endResourceSubmission();
        }
        if (fireEvent) this.fire('afterRender');
        if (this.frameEncoder) this.frameResourceRoots.add(stage);
        else this.resourceManager.destroyUnusedResource(stage);
    }

    /**
     * Record multiple scene, offscreen and presentation passes into one command encoder and submit
     * them together. Existing renderer calls made inside the callback join the same frame.
     */
    override renderFrame(callback: RendererFrameCallback): void {
        if (this.frameEncoder) {
            const error = new Error('Nested renderer frames are not supported');
            this.abortActiveFrame(error);
            throw error;
        }
        if (this._recoveryState === 'recovering') return;
        if (!this.isReady) {
            throw new Error('WebGPURenderer is not ready; await stage.ready before rendering');
        }
        const encoder = this.concreteDevice.createNativeCommandEncoder({
            label: 'Hilo3d application frame'
        });
        this.beginResourceSubmission();
        this.frameEncoder = encoder;
        this.frameCanvasTexture = null;
        this.frameHasCommands = false;
        this.frameAborted = false;
        this.frameAbortReason = undefined;
        this.frameGeometryRevisions = new WeakMap();
        this.frameTextureRevisions = new WeakMap();
        this.frameResourceRoots.clear();
        let submitted = false;
        let facadeActive = true;
        try {
            this.uniformBlockManager.beginApplicationFrame();
            invokeRendererFrameCallback(
                callback,
                createRendererFrame(this, () => facadeActive && this.frameEncoder === encoder)
            );
            if (this.applicationFrameWasAborted()) throw this.createFrameAbortedError();
            if (this.applicationFrameHasCommands()) {
                this.concreteDevice.submitNative([encoder.finish()]);
                submitted = true;
            }
        } finally {
            facadeActive = false;
            this.endResourceSubmission();
            this.frameEncoder = null;
            this.frameCanvasTexture = null;
            this.frameHasCommands = false;
            this.frameAborted = false;
            this.frameAbortReason = undefined;
            this.frameGeometryRevisions = new WeakMap();
            this.frameTextureRevisions = new WeakMap();
            for (const root of this.frameResourceRoots) {
                this.resourceManager.destroyUnusedResource(root);
            }
            this.frameResourceRoots.clear();
            if (!submitted) this.commandState.endPass();
        }
    }

    private abortActiveFrame(reason: unknown): void {
        if (!this.frameEncoder || this.frameAborted) return;
        this.frameAborted = true;
        this.frameAbortReason = reason;
    }

    private beginResourceSubmission(): void {
        const uniformBuffers = this.requireUniformBufferManager();
        const buffers = this.requireBufferManager();
        const textures = this.requireTextureManager();
        uniformBuffers.beginSubmission();
        try {
            buffers.beginSubmission();
            try {
                beginWebGPUTextureSubmission(textures);
            } catch (error: unknown) {
                buffers.endSubmission();
                throw error;
            }
        } catch (error: unknown) {
            uniformBuffers.endSubmission();
            throw error;
        }
    }

    private endResourceSubmission(): void {
        if (this.textureManager) endWebGPUTextureSubmission(this.textureManager);
        this.bufferManager?.endSubmission();
        this.uniformBufferManager?.endSubmission();
    }

    private applicationFrameWasAborted(): boolean {
        return this.frameAborted;
    }

    private applicationFrameHasCommands(): boolean {
        return this.frameHasCommands;
    }

    private assertFrameUsable(): void {
        if (this.frameEncoder && this.frameAborted) throw this.createFrameAbortedError();
    }

    private createFrameAbortedError(): Error {
        return new Error('WebGPU frame recording was aborted after a renderer command failed', {
            cause: this.frameAbortReason
        });
    }

    private assertNoActiveFrameMutation(operation: string): void {
        if (!this.frameEncoder) return;
        const error = new Error(
            `WebGPU renderer ${operation} cannot run while an application frame is recording`
        );
        this.abortActiveFrame(error);
        throw error;
    }

    private getFrameCanvasTexture(context: GPUCanvasContext, ownsEncoder: boolean): GPUTexture {
        // Keep the context parameter as an ownership assertion for legacy call sites.
        if (context !== this.context)
            throw new TypeError('WebGPU canvas context ownership mismatch');
        const surface = this.rhi?.surface;
        if (!surface) throw new Error('WebGPURenderer surface is unavailable');
        if (ownsEncoder) return surface.getCurrentNativeTexture();
        return (this.frameCanvasTexture ??= surface.getCurrentNativeTexture());
    }

    renderScene(): void {
        this.renderList.traverse(
            mesh => {
                this.renderMesh(mesh);
            },
            meshes => {
                this.renderInstancedMeshes(meshes);
            }
        );
    }

    private getMainDrawTarget(): WebGPUDrawTargetState {
        return {
            colorFormats: [this.canvasFormat],
            ...(this.depthStencilFormat ? { depthStencilFormat: this.depthStencilFormat } : {}),
            depthTestEnabled: this.depth,
            stencilTestEnabled: this.stencil,
            sampleCount: this.sampleCount
        };
    }

    private createCanvasRenderPassDescriptor(
        currentTexture: GPUTexture | null
    ): GPURenderPassDescriptor {
        if (!currentTexture) throw new Error('WebGPU canvas texture is unavailable');
        const colorView = currentTexture.createView();
        const colorAttachment: GPURenderPassColorAttachment = {
            view: this.multisampleTexture?.createView() ?? colorView,
            ...(this.multisampleTexture ? { resolveTarget: colorView } : {}),
            clearValue: {
                r: this.clearColor.r,
                g: this.clearColor.g,
                b: this.clearColor.b,
                a: this.clearColor.a
            },
            loadOp: 'clear',
            storeOp: 'store'
        };
        const descriptor: GPURenderPassDescriptor = {
            label: 'Hilo3d scene',
            colorAttachments: [colorAttachment]
        };
        if (this.depthTexture && this.depthStencilFormat) {
            descriptor.depthStencilAttachment = {
                view: this.depthTexture.createView(),
                depthClearValue: 1,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                ...(this.stencil
                    ? {
                          stencilClearValue: 0,
                          stencilLoadOp: 'clear' as const,
                          stencilStoreOp: 'store' as const
                      }
                    : {})
            };
        }
        return descriptor;
    }

    private createRenderTargetPassDescriptor(
        renderTarget: WebGPURenderTarget
    ): GPURenderPassDescriptor {
        return renderTarget.createRenderPassDescriptor({
            label: 'Hilo3d scene target'
        });
    }

    /** Create a device-compatible offscreen target without exposing renderer internals. */
    override createRenderTarget(parameters: RenderTargetParameters): WebGPURenderTarget {
        const target = createWebGPURenderTargetForRHI(
            this.concreteDevice,
            this.requireTextureManager(),
            parameters,
            destroyedTarget => {
                this.resourceManager.releasePass(destroyedTarget).destroyUnusedResource();
                this.renderTargets.delete(destroyedTarget);
                if (this.renderTarget === destroyedTarget) {
                    this.renderTarget = null;
                    this.ownsRenderTarget = false;
                    this.autoPresentRenderTarget = false;
                }
            }
        );
        setWebGPURenderTargetOperationGuard(target, operation => {
            this.assertNoActiveFrameMutation(operation);
        });
        this.renderTargets.add(target);
        return target;
    }

    override supportsTextureCompression(format: TextureCompressionFormat): boolean {
        const features = this.gpuDevice.features;
        switch (format) {
            case 'bc':
                return features.has('texture-compression-bc');
            case 'etc1':
            case 'etc2':
                return features.has('texture-compression-etc2');
            case 'astc-4x4':
                return features.has('texture-compression-astc');
            case 'pvrtc':
                return false;
        }
    }

    /** Select an offscreen target. Explicit targets are not presented unless requested. */
    override setRenderTarget(
        target: RenderTarget | null,
        options: RenderTargetSelectionOptions = {}
    ): this {
        this.assertNoActiveFrameMutation('setRenderTarget');
        let resolved: WebGPURenderTarget | null = null;
        if (target !== null) {
            if (!(target instanceof WebGPURenderTarget)) {
                throw new TypeError(
                    'WebGPU render target belongs to a different device or renderer'
                );
            }
            if (
                !this.renderTargets.has(target) ||
                (this.device !== null && target.device !== this.device)
            ) {
                throw new TypeError(
                    'WebGPU render target belongs to a different device or renderer'
                );
            }
            if (target.isDestroyed)
                throw new Error('Cannot select a destroyed WebGPU render target');
            resolved = target;
        }
        const previous = this.renderTarget;
        const destroyPrevious = this.ownsRenderTarget && previous !== null && previous !== resolved;
        this.renderTarget = resolved;
        this.activeViewport = null;
        this.ownsRenderTarget = resolved !== null && options.takeOwnership === true;
        this.autoPresentRenderTarget = resolved !== null && options.present === true;
        if (destroyPrevious) previous.destroy();
        return this;
    }

    /** Render one scoped pass without changing the caller's persistent target selection. */
    override renderToTarget(
        target: RenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent = false
    ): void {
        this.assertFrameUsable();
        try {
            this.renderToTargetInternal(target, stage, camera, fireEvent);
        } catch (error: unknown) {
            this.abortActiveFrame(error);
            throw error;
        }
    }

    private renderToTargetInternal(
        target: RenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent: boolean
    ): void {
        if (!(target instanceof WebGPURenderTarget)) {
            throw new TypeError('WebGPU render target belongs to a different device or renderer');
        }
        if (
            !this.renderTargets.has(target) ||
            (this.device !== null && target.device !== this.device)
        ) {
            throw new TypeError('WebGPU render target belongs to a different device or renderer');
        }
        if (target.isDestroyed)
            throw new Error('Cannot render to a destroyed WebGPU render target');
        if (this._recoveryState === 'recovering') return;
        if (this._recoveryState === 'failed') {
            this.render(stage, camera, fireEvent);
            return;
        }
        const previousTarget = this.renderTarget;
        const previousOwnership = this.ownsRenderTarget;
        const previousPresentation = this.autoPresentRenderTarget;
        this.renderTarget = target;
        this.activeViewport = null;
        this.ownsRenderTarget = false;
        this.autoPresentRenderTarget = false;
        try {
            this.render(stage, camera, fireEvent);
        } finally {
            this.renderTarget = previousTarget?.isDestroyed === false ? previousTarget : null;
            this.activeViewport = null;
            this.ownsRenderTarget = this.renderTarget !== null && previousOwnership;
            this.autoPresentRenderTarget = this.renderTarget !== null && previousPresentation;
        }
    }

    /** Present the first color attachment of a render target to the canvas. */
    override present(target: RenderTarget = this.requireRenderTarget()): void {
        this.assertFrameUsable();
        try {
            this.presentInternal(target);
        } catch (error: unknown) {
            this.abortActiveFrame(error);
            throw error;
        }
    }

    private presentInternal(target: RenderTarget): void {
        if (!(target instanceof WebGPURenderTarget)) {
            throw new TypeError('WebGPU render target belongs to a different device or renderer');
        }
        const device = this.gpuDevice;
        if (target.device !== device || !this.renderTargets.has(target)) {
            throw new TypeError('WebGPU render target belongs to a different device or renderer');
        }
        if (target.isDestroyed) throw new Error('Cannot present a destroyed WebGPU render target');
        const context = this.context;
        if (!context) throw new Error('WebGPU canvas context is unavailable');
        const ownsEncoder = this.frameEncoder === null;
        const encoder =
            this.frameEncoder ??
            this.concreteDevice.createNativeCommandEncoder({ label: 'Hilo3d present' });
        this.encodePresent(encoder, target, this.getFrameCanvasTexture(context, ownsEncoder));
        if (ownsEncoder) this.concreteDevice.submitNative([encoder.finish()]);
        else this.frameHasCommands = true;
    }

    private encodePresent(
        encoder: GPUCommandEncoder,
        target: WebGPURenderTarget,
        currentTexture: GPUTexture
    ): void {
        if (target.colorAttachmentCount < 1) {
            throw new TypeError('A depth-only WebGPU render target cannot be presented');
        }
        const texture = target.getColorTexture(0);
        this.assertFrameTextureStable(texture);
        const resource = this.requireTextureManager().get(texture);
        const sampleType = resolveWebGPUTextureFormat(texture).sampleType;
        if (sampleType !== 'float' && sampleType !== 'unfilterable-float') {
            throw new TypeError(`WebGPU presentation does not support ${sampleType} textures`);
        }
        const presentPipeline = this.getPresentPipeline(sampleType);
        const bindGroup = this.getPresentBindGroup(presentPipeline, resource.view);
        const pass = encoder.beginRenderPass({
            label: 'Hilo3d present pass',
            colorAttachments: [
                {
                    view: currentTexture.createView(),
                    clearValue: {
                        r: this.clearColor.r,
                        g: this.clearColor.g,
                        b: this.clearColor.b,
                        a: this.clearColor.a
                    },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(presentPipeline.pipeline);
        pass.setBindGroup(presentPipeline.bindGroupIndex, bindGroup);
        pass.setViewport(0, 0, this.width, this.height, 0, 1);
        pass.draw(3);
        pass.end();
    }

    private getPresentPipeline(sampleType: GPUTextureSampleType): WebGPUPresentPipeline {
        const cached = this.presentPipelines.get(sampleType);
        if (cached) return cached;
        const shader =
            this.presentShader ??
            (this.presentShader = this.translator.translate(
                presentVertexSource,
                presentFragmentSource
            ));
        const resources = createWebGPUFullscreenPassResources(
            this.concreteDevice,
            shader,
            sampleType,
            `Hilo3d present ${sampleType}`
        );
        const vertexModule = this.concreteDevice.createNativeShaderModule({
            label: 'Hilo3d present vertex shader',
            code: shader.vertex.wgsl
        });
        const fragmentModule = this.concreteDevice.createNativeShaderModule({
            label: 'Hilo3d present fragment shader',
            code: shader.fragment.wgsl
        });
        const pipeline = this.concreteDevice.createNativeRenderPipeline({
            label: `Hilo3d present ${sampleType}`,
            layout: resources.pipelineLayout,
            vertex: { module: vertexModule, entryPoint: 'main' },
            fragment: {
                module: fragmentModule,
                entryPoint: 'main',
                targets: [{ format: this.canvasFormat }]
            },
            primitive: { topology: 'triangle-list' },
            multisample: { count: 1 }
        });
        const result = { ...resources, pipeline };
        this.presentPipelines.set(sampleType, result);
        return result;
    }

    private getPresentBindGroup(
        pipeline: WebGPUPresentPipeline,
        view: GPUTextureView
    ): GPUBindGroup {
        let layouts = this.presentBindGroups.get(view);
        const cached = layouts?.get(pipeline.bindGroupLayout);
        if (cached) return cached;
        const bindGroup = createWebGPUFullscreenPassBindGroup(
            this.concreteDevice,
            pipeline,
            view,
            'Hilo3d present bind group'
        );
        if (!layouts) {
            layouts = new Map();
            this.presentBindGroups.set(view, layouts);
        }
        layouts.set(pipeline.bindGroupLayout, bindGroup);
        return bindGroup;
    }

    private requireRenderTarget(): WebGPURenderTarget {
        if (!this.renderTarget) throw new Error('No WebGPU render target is selected');
        return this.renderTarget;
    }

    private validateLightLimits(): void {
        const limits = [
            ['directional', this.lightManager.directionalLights.length, MAX_DIRECTIONAL_LIGHTS],
            ['spot', this.lightManager.spotLights.length, MAX_SPOT_LIGHTS],
            ['point', this.lightManager.pointLights.length, MAX_POINT_LIGHTS],
            ['area', this.lightManager.areaLights.length, MAX_AREA_LIGHTS]
        ] as const;
        for (const [kind, count, maximum] of limits) {
            if (count > maximum) {
                throw new RangeError(
                    `WebGPU ${kind} light count ${String(count)} exceeds the fixed UBO ABI limit ${String(maximum)}`
                );
            }
        }
    }

    private renderShadowAtlas(
        mainCamera: Camera,
        sceneMeshes: readonly Mesh[],
        encoder: GPUCommandEncoder
    ): WebGPUShadowFrameData | null {
        if (!this.lightManager.shadowEnabled) return null;
        const directionalLights = this.lightManager.directionalLights.filter(
            light => light.shadow !== null
        );
        const spotLights = this.lightManager.spotLights.filter(light => light.shadow !== null);
        const pointLights = this.lightManager.pointLights.filter(light => light.shadow !== null);
        const sliceCount = directionalLights.length + spotLights.length + pointLights.length * 6;
        if (sliceCount === 0) return null;
        if (sliceCount > MAX_SHADOW_ATLAS_SLICES) {
            throw new RangeError(
                `WebGPU shadow atlas requires ${String(sliceCount)} slices; the UBO ABI supports ${String(MAX_SHADOW_ATLAS_SLICES)}`
            );
        }

        const defaultWidth = Math.max(1, this.width);
        const defaultHeight = Math.max(1, this.height);
        const shadowLights: readonly Light[] = [
            ...directionalLights,
            ...spotLights,
            ...pointLights
        ];
        let requestedTileWidth = 1;
        let requestedTileHeight = 1;
        for (const light of shadowLights) {
            const shadow = light.shadow;
            if (!shadow) continue;
            requestedTileWidth = Math.max(
                requestedTileWidth,
                positiveShadowDimension(shadow.width, defaultWidth, 'shadow.width')
            );
            requestedTileHeight = Math.max(
                requestedTileHeight,
                positiveShadowDimension(shadow.height, defaultHeight, 'shadow.height')
            );
        }
        const columns = Math.ceil(Math.sqrt(sliceCount));
        const rows = Math.ceil(sliceCount / columns);
        const maximumDimension = this.gpuDevice.limits.maxTextureDimension2D;
        const tileWidth = Math.min(requestedTileWidth, Math.floor(maximumDimension / columns));
        const tileHeight = Math.min(requestedTileHeight, Math.floor(maximumDimension / rows));
        if (tileWidth < 1 || tileHeight < 1) {
            throw new RangeError(
                `WebGPU shadow atlas cannot place ${String(sliceCount)} slices within maxTextureDimension2D ${String(maximumDimension)}`
            );
        }
        if (tileWidth !== requestedTileWidth || tileHeight !== requestedTileHeight) {
            this.fire('shadowAtlasResolutionClamped', {
                requestedWidth: requestedTileWidth,
                requestedHeight: requestedTileHeight,
                width: tileWidth,
                height: tileHeight,
                maxTextureDimension2D: maximumDimension
            });
        }
        const atlasWidth = columns * tileWidth;
        const atlasHeight = rows * tileHeight;
        this.ensureShadowAtlas(atlasWidth, atlasHeight);

        const rects = new Float32Array(MAX_SHADOW_ATLAS_SLICES * 4);
        const directionalMapSizes = new Float32Array(
            this.lightManager.directionalLights.length * 2
        );
        const directionalBiases = new Float32Array(this.lightManager.directionalLights.length * 2);
        const directionalMatrices = new Float32Array(
            this.lightManager.directionalLights.length * 16
        );
        const spotMapSizes = new Float32Array(this.lightManager.spotLights.length * 2);
        const spotBiases = new Float32Array(this.lightManager.spotLights.length * 2);
        const spotMatrices = new Float32Array(this.lightManager.spotLights.length * 16);
        const pointBiases = new Float32Array(this.lightManager.pointLights.length * 2);
        const pointCameraPlanes = new Float32Array(this.lightManager.pointLights.length * 2);
        const pointMatrices = new Float32Array(this.lightManager.pointLights.length * 6 * 16);
        const slices: WebGPUShadowSlice[] = [];
        const lightSpaceMatrix = new Matrix4();
        let physicalIndex = 0;

        const registerSlice = (camera: Camera, logicalIndex: number): void => {
            const column = physicalIndex % columns;
            const row = Math.floor(physicalIndex / columns);
            const rectOffset = logicalIndex * 4;
            rects[rectOffset] = tileWidth / atlasWidth;
            // WebGPU render targets and sampled textures both use a top-left origin. The
            // negative scale converts the engine's OpenGL-style projected Y coordinate.
            rects[rectOffset + 1] = -tileHeight / atlasHeight;
            rects[rectOffset + 2] = (column * tileWidth) / atlasWidth;
            rects[rectOffset + 3] = ((row + 1) * tileHeight) / atlasHeight;
            slices.push({ camera, logicalIndex, physicalIndex });
            physicalIndex++;
        };

        directionalLights.forEach((light, index) => {
            const camera = this.updateDirectionalShadowCamera(light, mainCamera);
            registerSlice(camera, index);
            directionalMapSizes.set([tileWidth, tileHeight], index * 2);
            directionalBiases.set(
                [light.shadow?.minBias ?? 0.005, light.shadow?.maxBias ?? 0.05],
                index * 2
            );
            lightSpaceMatrix.multiply(camera.viewProjectionMatrix, mainCamera.worldMatrix);
            directionalMatrices.set(lightSpaceMatrix.elements, index * 16);
        });
        spotLights.forEach((light, index) => {
            const camera = this.updateSpotShadowCamera(light, mainCamera, tileWidth / tileHeight);
            registerSlice(camera, MAX_DIRECTIONAL_LIGHTS + index);
            spotMapSizes.set([tileWidth, tileHeight], index * 2);
            spotBiases.set(
                [light.shadow?.minBias ?? 0.005, light.shadow?.maxBias ?? 0.05],
                index * 2
            );
            lightSpaceMatrix.multiply(camera.viewProjectionMatrix, mainCamera.worldMatrix);
            spotMatrices.set(lightSpaceMatrix.elements, index * 16);
        });
        pointLights.forEach((light, index) => {
            const cameras = this.updatePointShadowCameras(light, mainCamera);
            const shadow = light.shadow;
            pointBiases.set([shadow?.minBias ?? 0.005, shadow?.maxBias ?? 0.05], index * 2);
            pointCameraPlanes.set([cameras[0]?.near ?? 0, cameras[0]?.far ?? 0], index * 2);
            cameras.forEach((camera, face) => {
                const logicalIndex = MAX_DIRECTIONAL_LIGHTS + MAX_SPOT_LIGHTS + index * 6 + face;
                registerSlice(camera, logicalIndex);
                lightSpaceMatrix.multiply(camera.viewProjectionMatrix, mainCamera.worldMatrix);
                pointMatrices.set(lightSpaceMatrix.elements, (index * 6 + face) * 16);
            });
        });

        this.lightManager.shadowAtlas = this.shadowAtlasTexture;
        this.lightManager.shadowAtlasSize = new Float32Array([
            atlasWidth,
            atlasHeight,
            1 / atlasWidth,
            1 / atlasHeight
        ]);
        this.lightManager.shadowAtlasRects = rects;
        this.lightManager.pointShadowMatrices = pointMatrices;

        const previousForceMaterial = this.forceMaterial;
        const previousViewport = this.activeViewport;
        try {
            slices.forEach(slice => {
                this.renderShadowSlice(slice, sceneMeshes, columns, tileWidth, tileHeight, encoder);
            });
        } finally {
            this.activePass = null;
            this.activeViewport = previousViewport;
            this.forceMaterial = previousForceMaterial;
            semantic.setCamera(mainCamera);
        }
        return {
            directionalMapSizes,
            directionalBiases,
            directionalMatrices,
            spotMapSizes,
            spotBiases,
            spotMatrices,
            pointBiases,
            pointCameraPlanes,
            pointMatrices
        };
    }

    private renderShadowSlice(
        slice: WebGPUShadowSlice,
        sceneMeshes: readonly Mesh[],
        columns: number,
        tileWidth: number,
        tileHeight: number,
        encoder: GPUCommandEncoder
    ): void {
        const atlas = this.shadowAtlasGPUTexture;
        if (!atlas) throw new Error('WebGPU shadow atlas is unavailable');
        const pass = encoder.beginRenderPass({
            label: `Hilo3d shadow slice ${String(slice.logicalIndex)}`,
            colorAttachments: [null],
            depthStencilAttachment: {
                view: atlas.createView(),
                depthClearValue: 1,
                depthLoadOp: slice.physicalIndex === 0 ? 'clear' : 'load',
                depthStoreOp: 'store'
            }
        });
        const column = slice.physicalIndex % columns;
        const row = Math.floor(slice.physicalIndex / columns);
        this.activeViewport = [column * tileWidth, row * tileHeight, tileWidth, tileHeight];
        this.activePass = pass;
        this.beginCameraPass(slice.camera, this.activeViewport);
        const shadowList = new RenderList();
        shadowList.useInstanced = this.useInstanced;
        for (const mesh of sceneMeshes) {
            if (mesh.material?.castShadows === true) shadowList.addMesh(mesh, slice.camera);
        }
        shadowList.sort();
        const target: WebGPUDrawTargetState = {
            colorFormats: [null],
            depthStencilFormat: 'depth24plus',
            depthTestEnabled: true,
            stencilTestEnabled: false,
            sampleCount: 1
        };
        try {
            shadowList.traverse(
                mesh => {
                    const material = mesh.material;
                    if (!material) return;
                    this.forceMaterial = material.getShadowMaterial(this.shadowMaterial);
                    this.encodeDraw(this.setupDraw([mesh], false, target));
                },
                meshes => {
                    const first = meshes[0];
                    if (!first?.material) return;
                    this.forceMaterial = first.material.getShadowMaterial(this.shadowMaterial);
                    for (let start = 0; start < meshes.length; start += MAX_INSTANCES_PER_DRAW) {
                        const batch = meshes.slice(start, start + MAX_INSTANCES_PER_DRAW);
                        this.encodeDraw(
                            this.setupDraw(batch, true, target, this.getInstanceBatchOwner(batch))
                        );
                    }
                }
            );
        } finally {
            this.activePass = null;
            pass.end();
        }
    }

    private applyShadowFrameData(data: WebGPUShadowFrameData | null): void {
        if (!data) return;
        if (this.lightManager.directionalInfo && data.directionalBiases.length > 0) {
            this.lightManager.directionalInfo.shadowMapSize = data.directionalMapSizes;
            this.lightManager.directionalInfo.shadowBias = data.directionalBiases;
            this.lightManager.directionalInfo.lightSpaceMatrix = data.directionalMatrices;
        }
        if (this.lightManager.spotInfo && data.spotBiases.length > 0) {
            this.lightManager.spotInfo.shadowMapSize = data.spotMapSizes;
            this.lightManager.spotInfo.shadowBias = data.spotBiases;
            this.lightManager.spotInfo.lightSpaceMatrix = data.spotMatrices;
        }
        if (this.lightManager.pointInfo && data.pointBiases.length > 0) {
            this.lightManager.pointInfo.shadowBias = data.pointBiases;
            this.lightManager.pointInfo.cameras = data.pointCameraPlanes;
        }
        this.lightManager.pointShadowMatrices = data.pointMatrices;
    }

    private applyPlanarShadowCameraInfo(
        camera: OrthographicCamera | PerspectiveCamera,
        info: ShadowCameraParameters,
        mainCamera: Camera
    ): void {
        Object.assign(camera, info);
        const clipping = cameraClippingPlanes(mainCamera);
        if (info.near === undefined) camera.near = clipping.near;
        if (info.far === undefined) camera.far = clipping.far;
    }

    private updateDirectionalShadowCamera(
        light: DirectionalLight,
        mainCamera: Camera
    ): OrthographicCamera {
        let cameras = this.shadowCameras.get(light);
        const cachedCamera = cameras?.[0];
        let camera: OrthographicCamera;
        if (cachedCamera instanceof OrthographicCamera) {
            camera = cachedCamera;
        } else {
            camera = new OrthographicCamera();
            camera.addTo(light);
            cameras = [camera];
            this.shadowCameras.set(light, cameras);
        }
        camera.lookAt(light.direction);
        const info = light.shadow?.cameraInfo;
        if (info) {
            this.applyPlanarShadowCameraInfo(camera, info, mainCamera);
        } else {
            camera.updateViewMatrix();
            const transform = new Matrix4().multiply(camera.viewMatrix, mainCamera.worldMatrix);
            const bounds = mainCamera.getGeometry().getBounds(transform);
            camera.near = -bounds.zMax;
            camera.far = -bounds.zMin;
            camera.left = bounds.xMin;
            camera.right = bounds.xMax;
            camera.bottom = bounds.yMin;
            camera.top = bounds.yMax;
        }
        camera.updateViewProjectionMatrix();
        this.updatePlanarShadowDebugHelper(light, camera);
        return camera;
    }

    private updateSpotShadowCamera(
        light: SpotLight,
        mainCamera: Camera,
        aspect: number
    ): PerspectiveCamera {
        let cameras = this.shadowCameras.get(light);
        const cachedCamera = cameras?.[0];
        let camera: PerspectiveCamera;
        if (cachedCamera instanceof PerspectiveCamera) {
            camera = cachedCamera;
        } else {
            camera = new PerspectiveCamera();
            camera.addTo(light);
            cameras = [camera];
            this.shadowCameras.set(light, cameras);
        }
        camera.lookAt(light.direction);
        const info = light.shadow?.cameraInfo;
        if (info) {
            this.applyPlanarShadowCameraInfo(camera, info, mainCamera);
        } else {
            camera.fov = light.outerCutoff * 2;
            camera.near = 0.01;
            camera.far = cameraClippingPlanes(mainCamera).far;
            camera.aspect = aspect;
        }
        camera.updateViewProjectionMatrix();
        this.updatePlanarShadowDebugHelper(light, camera);
        return camera;
    }

    private updatePlanarShadowDebugHelper(light: Light, camera: Camera): void {
        if (light.shadow?.debug !== true) return;
        let helper = this.shadowCameraHelpers.get(light);
        if (!helper) {
            helper = new CameraHelper({
                camera,
                color: new Color(0, 1, 0)
            });
            helper.addTo(light);
            this.shadowCameraHelpers.set(light, helper);
        } else {
            helper.camera = camera;
        }
        helper.onUpdate?.(0);
    }

    private releaseShadowHelper(light: Light): void {
        const helper = this.shadowCameraHelpers.get(light);
        if (!helper) return;
        this.shadowCameraHelpers.delete(light);
        helper.destroy(this);
    }

    private releaseShadowCameras(light: Light): void {
        const cameras = this.shadowCameras.get(light);
        if (!cameras) return;
        this.shadowCameras.delete(light);
        for (const camera of cameras) {
            camera.removeFromParent();
            camera.off();
        }
    }

    private pruneShadowOwners(activeShadowLights: ReadonlySet<Light>): void {
        for (const light of this.shadowCameras.keys()) {
            if (!activeShadowLights.has(light)) this.releaseShadowCameras(light);
        }
        for (const light of this.shadowCameraHelpers.keys()) {
            if (!activeShadowLights.has(light) || light.shadow?.debug !== true) {
                this.releaseShadowHelper(light);
            }
        }
    }

    private releaseAllShadowOwners(): void {
        for (const light of [...this.shadowCameraHelpers.keys()]) this.releaseShadowHelper(light);
        for (const light of [...this.shadowCameras.keys()]) this.releaseShadowCameras(light);
    }

    private updatePointShadowCameras(
        light: PointLight,
        mainCamera: Camera
    ): readonly PerspectiveCamera[] {
        let cameras = this.shadowCameras.get(light);
        if (cameras?.length !== 6) {
            cameras = Array.from({ length: 6 }, () => new PerspectiveCamera());
            this.shadowCameras.set(light, cameras);
        }
        const { near, far } = resolvePointShadowCameraPlanes(light, mainCamera);
        const position = new Vector3();
        light.worldMatrix.getTranslation(position);
        cameras.forEach((candidate, face) => {
            if (!(candidate instanceof PerspectiveCamera)) {
                throw new TypeError('Point-light shadow cache contains a non-perspective camera');
            }
            candidate.position.copy(position);
            candidate.up.fromArray(POINT_SHADOW_UPS[face] ?? POINT_SHADOW_UPS[0]);
            const direction = POINT_SHADOW_DIRECTIONS[face] ?? POINT_SHADOW_DIRECTIONS[0];
            candidate.lookAt(
                new Vector3(
                    position.x + direction[0],
                    position.y + direction[1],
                    position.z + direction[2]
                )
            );
            candidate.fov = 90;
            candidate.aspect = 1;
            candidate.near = near;
            candidate.far = far;
            candidate.updateViewProjectionMatrix();
        });
        return cameras as PerspectiveCamera[];
    }

    private ensureShadowAtlas(width: number, height: number): void {
        if (
            this.shadowAtlasTexture &&
            this.shadowAtlasGPUTexture &&
            this.shadowAtlasWidth === width &&
            this.shadowAtlasHeight === height
        ) {
            return;
        }
        this.destroyShadowAtlas();
        const texture = new Texture<null>({
            image: null,
            name: 'Hilo3d WebGPU shadow atlas',
            width,
            height,
            internalFormat: DEPTH_COMPONENT24,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_INT,
            magFilter: LINEAR,
            minFilter: LINEAR,
            wrapS: CLAMP_TO_EDGE,
            wrapT: CLAMP_TO_EDGE,
            needUpdate: false
        });
        const gpuTexture = this.concreteDevice.createNativeTexture({
            label: texture.name,
            size: { width, height, depthOrArrayLayers: 1 },
            format: 'depth24plus',
            usage:
                WebGPUTextureUsage.RENDER_ATTACHMENT |
                WebGPUTextureUsage.TEXTURE_BINDING |
                WebGPUTextureUsage.COPY_SRC
        });
        this.requireTextureManager().registerExternal(texture, gpuTexture, {
            compare: 'less-equal',
            takeOwnership: true
        });
        this.shadowAtlasTexture = texture;
        this.shadowAtlasGPUTexture = gpuTexture;
        this.shadowAtlasWidth = width;
        this.shadowAtlasHeight = height;
    }

    private destroyShadowAtlas(): void {
        if (this.shadowAtlasTexture && this.textureManager) {
            this.textureManager.destroy(this.shadowAtlasTexture);
        } else {
            this.shadowAtlasGPUTexture?.destroy();
        }
        this.shadowAtlasTexture = null;
        this.shadowAtlasGPUTexture = null;
        this.shadowAtlasWidth = 0;
        this.shadowAtlasHeight = 0;
    }

    renderMesh(mesh: Mesh, silent = false): void {
        if (!silent) mesh.fire('beforeRender', mesh);
        const setup = this.setupDraw([mesh], false);
        this.encodeDraw(setup);
        this.renderInfo.addFaceCount(faceCount(geometryFor(mesh).mode, setup.vertexCount));
        this.renderInfo.addDrawCount(1);
        if (!silent) mesh.fire('afterRender', mesh);
    }

    renderInstancedMeshes(meshes: readonly Mesh[], silent = false): void {
        const mesh = meshes[0];
        if (!mesh) return;
        if (!silent) meshes.forEach(item => item.fire('beforeRender', item));
        for (let start = 0; start < meshes.length; start += MAX_INSTANCES_PER_DRAW) {
            const batch = meshes.slice(start, start + MAX_INSTANCES_PER_DRAW);
            const setup = this.setupDraw(
                batch,
                true,
                this.activeDrawTarget ?? this.getMainDrawTarget(),
                this.getInstanceBatchOwner(batch)
            );
            this.encodeDraw(setup);
            this.renderInfo.addFaceCount(
                faceCount(geometryFor(mesh).mode, setup.vertexCount) * setup.instanceCount
            );
            this.renderInfo.addDrawCount(1);
        }
        if (!silent) meshes.forEach(item => item.fire('afterRender', item));
    }

    private setupDraw(
        meshes: readonly Mesh[],
        useInstanced: boolean,
        target: WebGPUDrawTargetState = this.activeDrawTarget ?? this.getMainDrawTarget(),
        instanceBatchOwner?: WebGPUInstanceBatchOwner
    ): WebGPUDrawSetup {
        const mesh = meshes[0];
        if (!mesh) throw new Error('A WebGPU draw requires at least one mesh');
        const geometry = geometryFor(mesh);
        geometry.normalizePrimitiveTopology();
        const material = materialFor(mesh, this.forceMaterial);
        if (material.wireframe && geometry.mode !== LINES) geometry.convertToLinesMode();
        const shader = Shader.getShader(
            mesh,
            material,
            useInstanced,
            this.lightManager,
            this.fog,
            this.useLogDepth,
            this
        );
        if (!shader) throw new Error(`Material ${material.className} has no renderable shader`);
        const depthOnly = target.colorFormats.every(format => format === null);
        let compiled = this.getCompiledShader(shader, depthOnly);
        const fragmentColorFormats = resolveWebGPUFragmentColorFormats(
            compiled.translated.fragmentOutputs,
            target.colorFormats
        );
        const vertexBuffers = this.resolveVertexBuffers(
            meshes,
            material,
            compiled.translated.vertexInputs,
            useInstanced,
            instanceBatchOwner
        );
        const stripMode = isStripMode(geometry.mode);
        const indexBuffer = geometry.indices
            ? this.requireBufferManager().getIndexBuffer(
                  this.assertFrameGeometryStable(geometry.indices),
                  {
                      primitiveRestart: stripMode
                  }
              )
            : null;
        const samplers = this.resolveSamplers(compiled.translated, mesh, material);
        compiled = this.getDepthSpecializedShader(shader, compiled, samplers);
        const bindingLayout = this.requireBindGroupManager().getLayout(
            compiled.translated,
            samplers
        );
        const blockNames = compiled.translated.uniformBlocks.map(block => block.name);
        const uniformBlocks: Record<string, UniformBuffer> = {
            ...this.uniformBlockManager.getUniformBlocks(
                blockNames.filter(name => name !== 'InstanceBlock'),
                mesh,
                material,
                semantic.camera
            )
        };
        if (blockNames.includes('InstanceBlock')) {
            if (!instanceBatchOwner) {
                throw new Error('Instanced WebGPU draws require a stable batch owner');
            }
            uniformBlocks['InstanceBlock'] = this.getInstanceUniformBuffer(
                instanceBatchOwner,
                meshes
            );
        }
        const uniformBindings: Record<string, WebGPUUniformBufferBinding> = {};
        for (const [name, block] of Object.entries(uniformBlocks)) {
            uniformBindings[name] = this.requireUniformBufferManager().getBinding(block);
        }
        const bindGroups = this.requireBindGroupManager().getBindGroups(
            bindingLayout,
            compiled.translated,
            uniformBindings,
            samplers
        );
        const stripIndexFormat = indexBuffer && stripMode ? indexBuffer.format : undefined;
        const renderState = createWebGPURenderState(material, geometry.mode, {
            colorFormats: fragmentColorFormats,
            ...(target.depthStencilFormat ? { depthStencilFormat: target.depthStencilFormat } : {}),
            depthTestEnabled: target.depthTestEnabled,
            stencilTestEnabled: target.stencilTestEnabled,
            sampleCount: target.sampleCount,
            ...(stripIndexFormat ? { stripIndexFormat } : {})
        });
        const pipeline = this.getPipeline(
            shader,
            compiled,
            bindingLayout,
            vertexBuffers,
            renderState
        );
        const managedResources: ManagedResource[] = [
            this.getBufferOwnerResource(geometry),
            ...Object.values(uniformBlocks).map(block => this.getUniformResource(block))
        ];
        if (geometry.indices) {
            managedResources.push(this.getBufferOwnerResource(geometry.indices));
        }
        if (instanceBatchOwner) {
            managedResources.push(this.getBufferOwnerResource(instanceBatchOwner));
        }
        for (const batchMesh of meshes) {
            this.resourceManager.addMeshResources(batchMesh, managedResources, {
                key: `${material.id}:${shader.id}:${
                    instanceBatchOwner ? `instanced:${instanceBatchOwner.key}` : 'direct'
                }`,
                pass: this.renderTarget ?? this
            });
        }
        const fallbackVertexCount = vertexBuffers[0]?.count ?? 0;
        return {
            pipeline,
            renderState,
            vertexBuffers,
            indexBuffer,
            bindGroups,
            vertexCount: indexBuffer?.count ?? fallbackVertexCount,
            instanceCount: useInstanced ? meshes.length : 1
        };
    }

    private getInstanceBatchOwner(meshes: readonly Mesh[]): WebGPUInstanceBatchOwner {
        const mesh = meshes[0];
        if (!mesh) throw new Error('An instance batch owner requires at least one mesh');
        const material = materialFor(mesh, this.forceMaterial);
        const geometry = geometryFor(mesh);
        const key = this.instanceBatchVariantKeys.resolve('webgpu-instance-batch', [
            material.id,
            geometry.id,
            ...meshes.map(batchMesh => batchMesh.id)
        ]);
        let owner = this.instanceBatchOwners.get(key);
        if (!owner) {
            owner = { key };
            this.instanceBatchOwners.set(key, owner);
        }
        return owner;
    }

    private getInstanceUniformBuffer(
        owner: WebGPUInstanceBatchOwner,
        meshes: readonly Mesh[]
    ): UniformBuffer {
        if (meshes.length === 0) throw new Error('InstanceBlock requires at least one mesh');
        let buffer = this.instanceUniformBuffers.get(owner);
        if (!buffer) {
            buffer = UniformBuffer.fromSchema(instanceBlockLayout);
            this.instanceUniformBuffers.set(owner, buffer);
        }
        const modelMatrices = new Float32Array(MAX_INSTANCES_PER_DRAW * 16);
        const normalMatrices = new Float32Array(MAX_INSTANCES_PER_DRAW * 16);
        const normalMatrix = new Matrix4();
        meshes.forEach((mesh, index) => {
            modelMatrices.set(mesh.worldMatrix.elements, index * 16);
            normalMatrix.invert(mesh.worldMatrix).transpose();
            normalMatrices.set(normalMatrix.elements, index * 16);
        });
        buffer.set('u_instanceModelMatrices', modelMatrices);
        buffer.set('u_instanceNormalMatrices', normalMatrices);
        return buffer;
    }

    private resolveVertexBuffers(
        meshes: readonly Mesh[],
        material: Material,
        inputs: readonly WebGPUVertexInput[],
        useInstanced: boolean,
        instanceBatchOwner?: WebGPUInstanceBatchOwner
    ): readonly WebGPUVertexBufferBinding[] {
        const mesh = meshes[0];
        if (!mesh) throw new Error('Cannot resolve a vertex input without a mesh');
        const perVertex: WebGPUVertexBufferSource[] = [];
        const perInstance: WebGPUInstanceBufferSource[] = [];
        for (const input of inputs) {
            if (Object.hasOwn(material.attributes, input.name)) {
                const value = material.getAttributeData(input.name, mesh, { name: input.name });
                if (value === undefined || value === null) {
                    perVertex.push({
                        geometryData: this.getGenericVertexAttribute(geometryFor(mesh), input),
                        input
                    });
                    continue;
                }
                if (!(value instanceof GeometryData)) {
                    throw new TypeError(`Vertex input ${input.name} must resolve to GeometryData`);
                }
                perVertex.push({ geometryData: value, input });
                continue;
            }
            if (!useInstanced) {
                throw new Error(
                    `No material attribute binding exists for vertex input ${input.name}`
                );
            }
            const instanced = material
                .getInstancedUniforms()
                .find(item => item.name === input.name);
            if (!instanced) {
                throw new Error(`No instanced binding exists for vertex input ${input.name}`);
            }
            perInstance.push({
                input,
                getValue: instanceIndex => {
                    const instanceMesh = meshes[instanceIndex];
                    if (!instanceMesh) {
                        throw new RangeError(
                            `Missing mesh for instanced input ${input.name} at ${String(instanceIndex)}`
                        );
                    }
                    const value = instanced.info.get(instanceMesh, material, {
                        name: input.name
                    });
                    if (!isNumericArrayLike(value)) {
                        throw new TypeError(
                            `Instanced input ${input.name} must resolve to numeric array data`
                        );
                    }
                    return value;
                }
            });
        }
        const result: WebGPUVertexBufferBinding[] = [];
        if (perVertex.length > 0) {
            for (const source of perVertex) {
                this.assertFrameGeometryStable(source.geometryData);
            }
            result.push(
                this.requireBufferManager().getInterleavedVertexBuffer(geometryFor(mesh), perVertex)
            );
        }
        if (perInstance.length > 0) {
            if (!instanceBatchOwner) {
                throw new Error('Instanced WebGPU vertex inputs require a stable batch owner');
            }
            result.push(
                this.requireBufferManager().getInterleavedInstanceBuffer(
                    instanceBatchOwner,
                    meshes.length,
                    perInstance
                )
            );
        }
        if (result.length === 0) {
            throw new Error('A WebGPU draw requires at least one vertex or instance input');
        }
        return result;
    }

    private getGenericVertexAttribute(
        geometry: ReturnType<typeof geometryFor>,
        input: WebGPUVertexInput
    ): GeometryData {
        const vertexCount = geometry.vertices?.count;
        if (vertexCount === undefined) {
            throw new Error(
                `Cannot provide the generic default for vertex input ${input.name} without geometry vertices`
            );
        }
        const size = genericVertexAttributeSize(input.type);
        if (size === null) {
            throw new TypeError(
                `Vertex input ${input.name} type ${input.type} cannot use a generic default attribute`
            );
        }
        let attributes = this.genericVertexAttributes.get(geometry);
        if (!attributes) {
            attributes = new Map();
            this.genericVertexAttributes.set(geometry, attributes);
        }
        let attribute = attributes.get(input.type);
        if (attribute?.count === vertexCount) return attribute;

        const values = new Float32Array(vertexCount * size);
        // WebGL's disabled-array generic value is (0, 0, 0, 1). Repeating that value is the
        // deterministic WebGPU equivalent; it deliberately does not synthesize semantic data.
        if (size === 4) {
            for (let vertex = 0; vertex < vertexCount; vertex++) {
                values[vertex * size + 3] = 1;
            }
        }
        attribute = new GeometryData(values, size);
        attributes.set(input.type, attribute);
        return attribute;
    }

    private resolveSamplers(
        shader: TranslatedShaderPair,
        mesh: Mesh,
        material: Material
    ): readonly ResolvedWebGPUSampler[] {
        const values = new Map<string, unknown>();
        const firstIndices = new Map<string, number>();
        shader.samplers.forEach((binding, index) => {
            if (!firstIndices.has(binding.name)) firstIndices.set(binding.name, index);
        });
        return shader.samplers.map(binding => {
            if (!values.has(binding.name)) {
                values.set(
                    binding.name,
                    material.getUniformData(binding.name, mesh, {
                        name: binding.name,
                        textureIndex: firstIndices.get(binding.name) ?? 0
                    })
                );
            }
            const value = values.get(binding.name);
            const texture: unknown = Array.isArray(value)
                ? (value as readonly unknown[])[binding.arrayIndex]
                : value;
            if (!(texture instanceof Texture)) {
                throw new TypeError(
                    `WebGPU sampler ${binding.name}[${String(binding.arrayIndex)}] must resolve to a Texture`
                );
            }
            this.assertFrameTextureStable(texture);
            return this.requireBindGroupManager().resolveSampler(binding, texture);
        });
    }

    private assertFrameGeometryStable(geometryData: GeometryData): GeometryData {
        if (!this.frameEncoder) return geometryData;
        const revision = this.frameGeometryRevisions.get(geometryData);
        if (revision === undefined) {
            this.frameGeometryRevisions.set(geometryData, geometryData.revision);
        } else if (revision !== geometryData.revision) {
            const error = new Error(
                'GeometryData cannot change after its first use in one WebGPU renderFrame callback'
            );
            this.abortActiveFrame(error);
            throw error;
        }
        return geometryData;
    }

    private assertFrameTextureStable(texture: Texture<unknown>): void {
        if (!this.frameEncoder) return;
        const revision = this.frameTextureRevisions.get(texture);
        if (revision === undefined) {
            this.frameTextureRevisions.set(texture, texture.updateRevision);
        } else if (revision !== texture.updateRevision) {
            const error = new Error(
                'Texture content cannot change after its first use in one WebGPU renderFrame callback'
            );
            this.abortActiveFrame(error);
            throw error;
        }
    }

    private getCompiledShader(shader: Shader, depthOnly = false): CompiledWebGPUShader {
        const cache = depthOnly ? this.depthOnlyCompiledShaders : this.compiledShaders;
        const cached = cache.get(shader);
        if (cached) return cached;
        const translated = this.translator.translate(
            shader.vs,
            shader.fs,
            undefined,
            depthOnly ? { fragmentOutputs: 'depth-only' } : undefined
        );
        const variant = depthOnly ? ':depth-only' : '';
        const result: CompiledWebGPUShader = {
            translated,
            vertexModule: this.concreteDevice.createNativeShaderModule({
                label: `${shader.id}:vertex${variant}`,
                code: translated.vertex.wgsl
            }),
            fragmentModule: this.concreteDevice.createNativeShaderModule({
                label: `${shader.id}:fragment${variant}`,
                code: translated.fragment.wgsl
            })
        };
        cache.set(shader, result);
        return result;
    }

    private getDepthSpecializedShader(
        shader: Shader,
        compiled: CompiledWebGPUShader,
        samplers: readonly ResolvedWebGPUSampler[]
    ): CompiledWebGPUShader {
        const depthBindings = samplers
            .filter(
                sampler =>
                    !sampler.binding.type.endsWith('Shadow') &&
                    resolveWebGPUTextureFormat(sampler.texture).isDepth
            )
            .map(sampler => sampler.binding)
            .sort(
                (left, right) =>
                    left.group - right.group || left.textureBinding - right.textureBinding
            );
        if (depthBindings.length === 0) return compiled;
        const signature = depthBindings
            .map(binding => `${String(binding.group)}:${String(binding.textureBinding)}`)
            .join(',');
        let variants = this.depthSpecializedShaders.get(compiled);
        if (!variants) {
            variants = new Map();
            this.depthSpecializedShaders.set(compiled, variants);
        }
        const cached = variants.get(signature);
        if (cached) {
            touchBoundedLruEntry(
                variants,
                signature,
                cached,
                MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS
            );
            return cached;
        }
        const translated = specializeWebGPUDepthSamplers(compiled.translated, depthBindings);
        const result: CompiledWebGPUShader = {
            translated,
            vertexModule: this.concreteDevice.createNativeShaderModule({
                label: `${shader.id}:vertex:depth:${signature}`,
                code: translated.vertex.wgsl
            }),
            fragmentModule: this.concreteDevice.createNativeShaderModule({
                label: `${shader.id}:fragment:depth:${signature}`,
                code: translated.fragment.wgsl
            })
        };
        touchBoundedLruEntry(variants, signature, result, MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS);
        return result;
    }

    private getPipeline(
        shader: Shader,
        compiled: CompiledWebGPUShader,
        bindingLayout: WebGPUPipelineBindingLayout,
        vertexBuffers: readonly WebGPUVertexBufferBinding[],
        renderState: WebGPURenderState
    ): GPURenderPipeline {
        return this.requirePipelineManager().getPipelineSync({
            label: shader.id,
            layout: bindingLayout.pipelineLayout,
            vertex: {
                module: compiled.vertexModule,
                entryPoint: 'main',
                buffers: vertexBuffers.map(binding => binding.layout)
            },
            fragment: { module: compiled.fragmentModule, entryPoint: 'main' },
            renderState
        });
    }

    private encodeDraw(setup: WebGPUDrawSetup): void {
        const pass = this.activePass;
        if (!pass) throw new Error('WebGPU draw commands require an active render pass');
        this.commandState.setPipeline(setup.pipeline);
        setup.bindGroups.forEach((group, index) => {
            this.commandState.setBindGroup(index, group);
        });
        setup.vertexBuffers.forEach((binding, index) => {
            this.commandState.setVertexBuffer(index, binding.buffer);
        });
        const viewport = this.activeViewport ?? [
            this.offsetX,
            this.offsetY,
            this.width,
            this.height
        ];
        this.commandState.setViewport(
            viewport[0],
            viewport[1],
            viewport[2],
            viewport[3],
            setup.renderState.dynamic.depthRange[0],
            setup.renderState.dynamic.depthRange[1]
        );
        if (setup.renderState.usesStencil) {
            this.commandState.setStencilReference(setup.renderState.dynamic.stencilReference);
        }
        if (setup.indexBuffer) {
            this.commandState.setIndexBuffer(setup.indexBuffer.buffer, setup.indexBuffer.format);
            pass.drawIndexed(setup.vertexCount, setup.instanceCount);
        } else {
            pass.draw(setup.vertexCount, setup.instanceCount);
        }
    }

    private createRenderAttachments(): void {
        const device = this.device;
        if (!device) return;
        this.depthTexture?.destroy();
        this.multisampleTexture?.destroy();
        this.depthTexture = null;
        this.multisampleTexture = null;
        const size = {
            width: Math.max(1, this.width),
            height: Math.max(1, this.height),
            depthOrArrayLayers: 1
        };
        if (this.depthStencilFormat) {
            this.depthTexture = this.concreteDevice.createNativeTexture({
                label: 'Hilo3d depth/stencil',
                size,
                format: this.depthStencilFormat,
                sampleCount: this.sampleCount,
                usage: WebGPUTextureUsage.RENDER_ATTACHMENT
            });
        }
        if (this.sampleCount > 1) {
            this.multisampleTexture = this.concreteDevice.createNativeTexture({
                label: 'Hilo3d multisample color',
                size,
                format: this.canvasFormat,
                sampleCount: this.sampleCount,
                usage: WebGPUTextureUsage.RENDER_ATTACHMENT
            });
        }
    }

    private getBufferOwnerResource(owner: object): ManagedResource {
        const cached = this.bufferOwnerResources.get(owner);
        if (cached) return cached;
        const resource: ManagedResource = {
            id: `WebGPUBufferOwner:${String(this.nextManagedResourceId++)}`,
            destroy: () => {
                this.bufferManager?.releaseOwner(owner);
                const batchKey: unknown = Reflect.get(owner, 'key');
                if (
                    typeof batchKey === 'string' &&
                    this.instanceBatchOwners.get(batchKey) === owner
                ) {
                    this.instanceBatchOwners.delete(batchKey);
                    this.instanceBatchVariantKeys.release(batchKey);
                }
                this.bufferOwnerResources.delete(owner);
            }
        };
        this.bufferOwnerResources.set(owner, resource);
        return resource;
    }

    private getUniformResource(buffer: UniformBuffer): ManagedResource {
        const cached = this.uniformResources.get(buffer);
        if (cached) return cached;
        const resource: ManagedResource = {
            id: `WebGPUUniform:${String(this.nextManagedResourceId++)}`,
            destroy: () => {
                this.uniformBufferManager?.release(buffer);
                this.uniformBlockManager.releaseBuffer(buffer);
                this.bindGroupManager?.clearBindGroups();
                this.uniformResources.delete(buffer);
            }
        };
        this.uniformResources.set(buffer, resource);
        return resource;
    }

    private releaseDeviceResources(options: {
        readonly preserveRenderTargets: boolean;
        readonly preserveTextureRecoveryData: boolean;
    }): void {
        this.depthTexture?.destroy();
        this.multisampleTexture?.destroy();
        this.depthTexture = null;
        this.multisampleTexture = null;
        this.destroyShadowAtlas();
        this.releaseAllShadowOwners();
        if (options.preserveRenderTargets) {
            this.renderTargets.forEach(target => {
                suspendWebGPURenderTarget(target);
            });
        } else {
            this.renderTargets.forEach(target => {
                target.destroy();
            });
            this.renderTargets.clear();
            this.renderTarget = null;
            this.ownsRenderTarget = false;
            this.autoPresentRenderTarget = false;
        }
        this.bufferManager?.destroy();
        if (options.preserveTextureRecoveryData && this.textureManager) {
            suspendWebGPUTextures(this.textureManager);
        } else this.textureManager?.destroyAll();
        this.uniformBufferManager?.destroy();
        this.bindGroupManager?.clear();
        this.pipelineManager?.clear();
        this.presentPipelines.clear();
        this.presentBindGroups = new WeakMap();
        this.compiledShaders = new WeakMap();
        this.depthOnlyCompiledShaders = new WeakMap();
        this.depthSpecializedShaders = new WeakMap();
        this.instanceUniformBuffers = new WeakMap();
        this.instanceBatchOwners.clear();
        this.instanceBatchVariantKeys.clear();
        this.bufferOwnerResources = new WeakMap();
        this.uniformResources = new WeakMap();
        this.resourceManager.clear();
    }

    override releaseGPUResources(): void {
        this.assertNoActiveFrameMutation('releaseGPUResources');
        this.releaseDeviceResources({
            preserveRenderTargets: false,
            preserveTextureRecoveryData: true
        });
        if (this.deviceStateActive && !this.destroyed) this.createRenderAttachments();
    }

    private fireDeviceLifecycleEvent(type: WebGPUDeviceLifecycleEventName, detail: unknown): void {
        try {
            this.fire(type, detail);
        } catch (error: unknown) {
            const cause = error instanceof Error ? error : new Error(String(error));
            reportAsynchronousError(
                new Error(`WebGPURenderer ${type} listener failed: ${cause.message}`, { cause })
            );
        }
    }

    private observeDevice(device: GPUDevice, generation: number): void {
        device.addEventListener('uncapturederror', event => {
            if (
                this.destroyed ||
                generation !== this.initializationGeneration ||
                this.device !== device
            ) {
                return;
            }
            this.fire('webgpuUncapturedError', event.error);
        });
        void device.lost.then(
            info => {
                try {
                    this.handleDeviceLoss(device, generation, info);
                } catch (error: unknown) {
                    const cause = error instanceof Error ? error : new Error(String(error));
                    reportAsynchronousError(
                        new Error(`WebGPURenderer device-loss observer failed: ${cause.message}`, {
                            cause
                        })
                    );
                }
            },
            (error: unknown) => {
                const cause = error instanceof Error ? error : new Error(String(error));
                reportAsynchronousError(
                    new Error(`WebGPU device.lost rejected unexpectedly: ${cause.message}`, {
                        cause
                    })
                );
            }
        );
    }

    private async recoverDevice(lostDevice: GPUDevice, generation: number): Promise<void> {
        const textureManager = this.textureManager;
        this.recoveryTextureManager = textureManager;
        try {
            this.disposeDeviceState({
                expectedDevice: lostDevice,
                preserveRenderTargets: true,
                suspendSurface: true
            });
            const rhi = this.rhi;
            if (!rhi) {
                throw new Error('WebGPURenderer recovery configuration is unavailable');
            }
            await rhi.recover();
            this.assertInitializationActive(generation);
            await this.translator.initialize();
            this.assertInitializationActive(generation);
            this.activateRecoveredDevice(generation, textureManager);
            this.initialized = true;
            this.isInitFailed = false;
            this.deviceLossInfo = null;
            this.recoveryError = null;
            this._recoveryState = 'ready';
            this.recoveryTextureManager = null;
            this.fireDeviceLifecycleEvent('webgpuDeviceRestored', this.device);
        } catch (error: unknown) {
            const cancelled = this.destroyed || generation !== this.initializationGeneration;
            const failure =
                error instanceof Error
                    ? error
                    : new Error(`WebGPU recovery failed: ${String(error)}`);
            if (this.deviceStateActive) {
                this.disposeDeviceState({ preserveRenderTargets: true, suspendSurface: true });
            }
            textureManager?.destroyAll();
            if (this.recoveryTextureManager === textureManager) {
                this.recoveryTextureManager = null;
            }
            if (!cancelled) {
                this.rhi?.destroy();
                this.rhi = null;
                this.initialized = false;
                this.isInitFailed = true;
                this.recoveryError = failure;
                this._recoveryState = 'failed';
                this.fireDeviceLifecycleEvent('webgpuDeviceRecoveryFailed', failure);
            }
            throw failure;
        }
    }

    private activateRecoveredDevice(
        generation: number,
        recoveryTextureManager: WebGPUTextureManager | null
    ): void {
        const rhi = this.rhi;
        if (!rhi?.isReady) throw new Error('WebGPURenderer recovery RHI is unavailable');
        const device = rhi.nativeDevice;
        const context = rhi.nativeContext;
        this.device = device;
        this.context = context;
        this.deviceStateActive = true;
        this.pipelineManager = new WebGPUPipelineManager(rhi.device);
        this.bufferManager = new WebGPUBufferManager(rhi.device);
        if (recoveryTextureManager) {
            restoreWebGPUTextureDevice(recoveryTextureManager, rhi.device);
            this.textureManager = recoveryTextureManager;
        } else {
            this.textureManager = createWebGPUTextureManagerForRHI(
                rhi.device,
                this.translator,
                () => {
                    this.bindGroupManager?.clearBindGroups();
                }
            );
        }
        this.uniformBufferManager = new WebGPUUniformBufferManager(rhi.device);
        this.bindGroupManager = new WebGPUBindGroupManager(rhi.device, this.textureManager);
        for (const target of this.renderTargets) {
            restoreWebGPURenderTarget(target, rhi.device, this.textureManager);
        }
        Shader.init(this);
        this.renderList.useInstanced = this.useInstanced;
        this.createRenderAttachments();
        this.observeDevice(device, generation);
    }

    private handleDeviceLoss(device: GPUDevice, generation: number, info: GPUDeviceLostInfo): void {
        if (
            this.destroyed ||
            generation !== this.initializationGeneration ||
            this.device !== device
        ) {
            return;
        }
        const recoveryGeneration = ++this.initializationGeneration;
        this.initialized = false;
        this.isInitFailed = false;
        this.deviceLossInfo = info;
        this.recoveryError = null;
        this._recoveryState = 'recovering';
        this.fireDeviceLifecycleEvent('webgpuDeviceLost', info);
        const recovery = this.recoverDevice(device, recoveryGeneration);
        this._recoveryPromise = recovery;
        void recovery.catch(() => undefined);
    }

    private disposeDeviceState(
        options: {
            readonly expectedDevice?: GPUDevice;
            readonly preserveRenderTargets?: boolean;
            readonly suspendSurface?: boolean;
        } = {}
    ): void {
        if (options.expectedDevice && this.device !== options.expectedDevice) return;
        if (!this.deviceStateActive) {
            if (options.preserveRenderTargets !== true) {
                this.releaseDeviceResources({
                    preserveRenderTargets: false,
                    preserveTextureRecoveryData: false
                });
            }
            this.initialized = false;
            return;
        }
        this.deviceStateActive = false;
        try {
            this.releaseDeviceResources({
                preserveRenderTargets: options.preserveRenderTargets === true,
                preserveTextureRecoveryData: options.preserveRenderTargets === true
            });
        } finally {
            this.pipelineManager = null;
            this.bufferManager = null;
            this.textureManager = null;
            this.uniformBufferManager = null;
            this.bindGroupManager = null;
            this.context = null;
            this.device = null;
            this.activePass = null;
            this.activeDrawTarget = null;
            this.activeViewport = null;
            this.initialized = false;
            if (options.suspendSurface === true && this.rhi && !this.rhi.destroyed) {
                this.rhi.suspendSurface();
            }
        }
    }

    override destroy(): void {
        if (this.destroyed) return;
        this.assertNoActiveFrameMutation('destroy');
        this.destroyed = true;
        this._recoveryState = 'destroyed';
        this.initializationGeneration++;
        try {
            this.disposeDeviceState();
        } finally {
            this.rhi?.destroy();
            this.rhi = null;
            this.recoveryTextureManager?.destroyAll();
            this.recoveryTextureManager = null;
            this.off();
        }
    }

    private requirePipelineManager(): WebGPUPipelineManager {
        if (!this.pipelineManager) throw new Error('WebGPU pipeline manager is unavailable');
        return this.pipelineManager;
    }

    private requireBufferManager(): WebGPUBufferManager {
        if (!this.bufferManager) throw new Error('WebGPU buffer manager is unavailable');
        return this.bufferManager;
    }

    private requireUniformBufferManager(): WebGPUUniformBufferManager {
        if (!this.uniformBufferManager) throw new Error('WebGPU uniform manager is unavailable');
        return this.uniformBufferManager;
    }

    private requireTextureManager(): WebGPUTextureManager {
        if (!this.textureManager) throw new Error('WebGPU texture manager is unavailable');
        return this.textureManager;
    }

    private requireBindGroupManager(): WebGPUBindGroupManager {
        if (!this.bindGroupManager) throw new Error('WebGPU bind-group manager is unavailable');
        return this.bindGroupManager;
    }
}

export default WebGPURenderer;
