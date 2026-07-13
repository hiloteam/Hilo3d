import type Camera from '../camera/Camera';
import OrthographicCamera from '../camera/OrthographicCamera';
import PerspectiveCamera from '../camera/PerspectiveCamera';
import type Fog from '../core/Fog';
import Mesh from '../core/Mesh';
import Node from '../core/Node';
import { EventDispatcher } from '../core/EventDispatcher';
import GeometryData from '../geometry/GeometryData';
import Light, { type ShadowCameraParameters } from '../light/Light';
import LightManager from '../light/LightManager';
import type DirectionalLight from '../light/DirectionalLight';
import type PointLight from '../light/PointLight';
import type SpotLight from '../light/SpotLight';
import type Material from '../material/Material';
import GeometryMaterial from '../material/GeometryMaterial';
import semantic from '../material/semantic';
import Color from '../math/Color';
import Matrix4 from '../math/Matrix4';
import Vector3 from '../math/Vector3';
import Shader from '../shader/Shader';
import {
    NagaShaderTranslator,
    type TranslatedShaderPair,
    type WebGPUVertexInput
} from '../shader/GlslToWgsl';
import Texture from '../texture/Texture';
import { DEPTH } from '../constants/Hilo';
import {
    BACK,
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    LINEAR,
    LINE_STRIP,
    LINES,
    TRIANGLE_STRIP,
    UNSIGNED_INT
} from '../constants/webgl';
import { DEPTH_COMPONENT24 } from '../constants/webgl2';
import RenderInfo from './RenderInfo';
import RenderList from './RenderList';
import GraphicsResourceManager, { type ManagedResource } from './GraphicsResourceManager';
import BuiltInUniformBlockManager from './BuiltInUniformBlockManager';
import UniformBuffer from './UniformBuffer';
import {
    BUILT_IN_UNIFORM_BLOCK_LAYOUTS,
    instanceBlockLayout,
    MAX_AREA_LIGHTS,
    MAX_DIRECTIONAL_LIGHTS,
    MAX_INSTANCES_PER_DRAW,
    MAX_POINT_LIGHTS,
    MAX_SHADOW_ATLAS_SLICES,
    MAX_SPOT_LIGHTS
} from './ubo/BuiltInUniformBlocks';
import type { RendererScene } from './Renderer';
import type { ShaderPrecision } from './types';
import WebGPUBindGroupManager, {
    type ResolvedWebGPUSampler,
    type WebGPUPipelineBindingLayout
} from './webgpu/WebGPUBindGroupManager';
import {
    WebGPUBufferManager,
    type WebGPUIndexBufferBinding,
    type WebGPUInstanceBufferSource,
    type WebGPUVertexBufferSource,
    type WebGPUVertexBufferBinding
} from './webgpu/WebGPUBufferManager';
import { WebGPUShaderStage, WebGPUTextureUsage } from './webgpu/WebGPUConstants';
import { WebGPUPipelineManager } from './webgpu/WebGPUPipelineManager';
import { createWebGPURenderState, type WebGPURenderState } from './webgpu/WebGPURenderState';
import WebGPUTextureManager, { resolveWebGPUTextureFormat } from './webgpu/WebGPUTextureManager';
import WebGPURenderTarget, { type WebGPURenderTargetParameters } from './webgpu/WebGPURenderTarget';
import {
    WebGPUUniformBufferManager,
    type WebGPUUniformBufferBinding
} from './webgpu/WebGPUUniformBufferManager';
import { WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE } from './webgpu/WgslUniformLayout';

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
    preserveDrawingBuffer?: boolean;
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
    /** Render through an engine-owned sampleable target and present it to the canvas. */
    useFramebuffer?: boolean;
    framebufferOption?: WebGPUFramebufferParameters;
}

export type WebGPUFramebufferParameters = Omit<WebGPURenderTargetParameters, 'width' | 'height'> & {
    readonly width?: number;
    readonly height?: number;
};

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

interface WebGPUPresentPipeline {
    readonly bindGroupLayout: GPUBindGroupLayout;
    readonly pipeline: GPURenderPipeline;
}

interface WebGPUInstanceBatchOwner {
    readonly key: string;
}

const pointShadowDirections = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
] as const;
const pointShadowUps = [
    [0, -1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, -1, 0],
    [0, -1, 0]
] as const;

const PRESENT_SHADER = /* wgsl */ `
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    let positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    let coordinates = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0)
    );
    var output: VertexOutput;
    output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
    output.uv = coordinates[vertexIndex];
    return output;
}

@group(0) @binding(0) var sourceTexture: texture_2d<f32>;

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
    let dimensions = vec2<i32>(textureDimensions(sourceTexture));
    let maximum = dimensions - vec2<i32>(1);
    let coordinate = clamp(vec2<i32>(floor(input.uv * vec2<f32>(dimensions))), vec2<i32>(0), maximum);
    return textureLoad(sourceTexture, coordinate, 0);
}
`;

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

function shaderLanguageFeatureAvailable(gpu: GPU): boolean {
    const features: unknown = Reflect.get(gpu, 'wgslLanguageFeatures');
    if (typeof features !== 'object' || features === null) return false;
    const has: unknown = Reflect.get(features, 'has');
    return (
        typeof has === 'function' &&
        Reflect.apply(has, features, [WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE]) === true
    );
}

function adapterIsFallback(adapter: GPUAdapter): boolean {
    const info: unknown = Reflect.get(adapter, 'info');
    return (
        typeof info === 'object' && info !== null && Reflect.get(info, 'isFallbackAdapter') === true
    );
}

function faceCount(mode: GLenum, vertexCount: number): number {
    if (mode === TRIANGLE_STRIP) return Math.max(0, vertexCount - 2);
    if (mode === LINES || mode === LINE_STRIP) return 0;
    return vertexCount / 3;
}

function isStripMode(mode: GLenum): boolean {
    return mode === LINE_STRIP || mode === TRIANGLE_STRIP;
}

function currentGPU(): GPU | undefined {
    const gpu: unknown = Reflect.get(navigator, 'gpu');
    return typeof gpu === 'object' && gpu !== null ? (gpu as GPU) : undefined;
}

/** WebGPU renderer using the same GLSL source of truth through the Naga compiler. */
class WebGPURenderer extends EventDispatcher {
    readonly backend = 'webgpu' as const;
    readonly className = 'WebGPURenderer';
    readonly isWebGPURenderer = true;
    readonly renderInfo = new RenderInfo();
    readonly renderList = new RenderList();
    readonly lightManager = new LightManager();
    readonly resourceManager = new GraphicsResourceManager();
    readonly ready: Promise<void>;

    width = 0;
    height = 0;
    pixelRatio = 1;
    domElement: HTMLCanvasElement | null = null;
    useInstanced = false;
    alpha = false;
    depth = true;
    stencil = false;
    antialias = true;
    premultipliedAlpha = true;
    preserveDrawingBuffer = false;
    failIfMajorPerformanceCaveat = false;
    powerPreference: GPUPowerPreference = 'high-performance';
    forceFallbackAdapter = false;
    requiredFeatures: readonly GPUFeatureName[] = [];
    requiredLimits: Readonly<Record<string, number>> = {};
    useLogDepth = false;
    vertexPrecision: ShaderPrecision = 'highp';
    fragmentPrecision: ShaderPrecision = 'highp';
    fog: Fog | null = null;
    offsetX = 0;
    offsetY = 0;
    forceMaterial: Material | null = null;
    clearColor = new Color(1, 1, 1);
    useFramebuffer = false;
    framebufferOption: WebGPUFramebufferParameters = {};
    renderTarget: WebGPURenderTarget | null = null;
    isInitFailed = false;

    private adapter: GPUAdapter | null = null;
    private device: GPUDevice | null = null;
    private context: GPUCanvasContext | null = null;
    private canvasFormat: GPUTextureFormat = 'bgra8unorm';
    private depthStencilFormat: GPUTextureFormat | undefined;
    private sampleCount: 1 | 4 = 1;
    private depthTexture: GPUTexture | null = null;
    private multisampleTexture: GPUTexture | null = null;
    private readonly translator = new NagaShaderTranslator();
    private compiledShaders = new WeakMap<Shader, CompiledWebGPUShader>();
    private pipelineManager: WebGPUPipelineManager | null = null;
    private bufferManager: WebGPUBufferManager | null = null;
    private textureManager: WebGPUTextureManager | null = null;
    private uniformBufferManager: WebGPUUniformBufferManager | null = null;
    private bindGroupManager: WebGPUBindGroupManager | null = null;
    private readonly uniformBlockManager: BuiltInUniformBlockManager;
    private instanceUniformBuffers = new WeakMap<WebGPUInstanceBatchOwner, UniformBuffer>();
    private readonly instanceBatchOwners = new Map<string, WebGPUInstanceBatchOwner>();
    private activePass: GPURenderPassEncoder | null = null;
    private activeDrawTarget: WebGPUDrawTargetState | null = null;
    private activeViewport: readonly [number, number, number, number] | null = null;
    private ownsRenderTarget = false;
    private autoPresentRenderTarget = false;
    private readonly presentPipelines = new Map<GPUTextureSampleType, WebGPUPresentPipeline>();
    private bufferOwnerResources = new WeakMap<object, ManagedResource>();
    private uniformResources = new WeakMap<UniformBuffer, ManagedResource>();
    private nextManagedResourceId = 1;
    private shadowAtlasTexture: Texture<null> | null = null;
    private shadowAtlasGPUTexture: GPUTexture | null = null;
    private shadowAtlasWidth = 0;
    private shadowAtlasHeight = 0;
    private shadowCameras = new WeakMap<Light, Camera[]>();
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

    constructor(params: WebGPURendererParameters = {}) {
        super();
        Object.assign(this, params);
        this.requiredFeatures = [...(params.requiredFeatures ?? [])];
        this.requiredLimits = { ...(params.requiredLimits ?? {}) };
        this.framebufferOption = { ...(params.framebufferOption ?? {}) };
        this.uniformBlockManager = new BuiltInUniformBlockManager(this);
        this.ready = this.initialize(++this.initializationGeneration);
    }

    get isReady(): boolean {
        return this.initialized && !this.destroyed && !this.isInitFailed;
    }

    get gpuDevice(): GPUDevice {
        if (!this.device)
            throw new Error('WebGPURenderer is not initialized; await renderer.ready');
        return this.device;
    }

    private assertInitializationActive(generation: number): void {
        if (this.destroyed || generation !== this.initializationGeneration) {
            throw new Error('WebGPURenderer initialization was cancelled');
        }
    }

    private async initialize(generation: number): Promise<void> {
        try {
            this.assertInitializationActive(generation);
            if (this.preserveDrawingBuffer) {
                throw new Error(
                    'WebGPU does not expose preserveDrawingBuffer; use an explicit copy/readback pass'
                );
            }
            if (this.alpha && !this.premultipliedAlpha) {
                throw new Error('WebGPU canvas compositing requires premultiplied alpha');
            }
            const canvas = this.domElement;
            if (!canvas) throw new Error('WebGPURenderer requires a canvas');
            const gpu = currentGPU();
            if (!gpu) throw new Error('WebGPU is unavailable in this browser or execution context');
            if (!shaderLanguageFeatureAvailable(gpu)) {
                throw new Error(
                    `WebGPU requires the WGSL ${WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE} language feature`
                );
            }
            const adapter = await gpu.requestAdapter({
                powerPreference: this.powerPreference,
                forceFallbackAdapter: this.forceFallbackAdapter
            });
            this.assertInitializationActive(generation);
            if (!adapter) throw new Error('No WebGPU adapter satisfies the requested preference');
            if (this.failIfMajorPerformanceCaveat && adapterIsFallback(adapter)) {
                throw new Error('The available WebGPU adapter is a fallback/software adapter');
            }
            const features = new Set(this.requiredFeatures);
            if (adapter.features.has('float32-filterable')) features.add('float32-filterable');
            for (const feature of features) {
                if (!adapter.features.has(feature)) {
                    throw new Error(`WebGPU adapter does not support required feature ${feature}`);
                }
            }
            if (adapter.limits.maxBindGroups < 4) {
                throw new Error('WebGPU adapter exposes fewer than the four required bind groups');
            }
            const largestBuiltInBlock = Math.max(
                ...Object.values(BUILT_IN_UNIFORM_BLOCK_LAYOUTS).map(layout => layout.byteLength)
            );
            if (adapter.limits.maxUniformBufferBindingSize < largestBuiltInBlock) {
                throw new Error(
                    `WebGPU adapter exposes ${String(adapter.limits.maxUniformBufferBindingSize)} bytes per uniform buffer binding; Hilo3d requires ${String(largestBuiltInBlock)}`
                );
            }
            if (adapter.limits.maxUniformBuffersPerShaderStage < 9) {
                throw new Error(
                    `WebGPU adapter exposes ${String(adapter.limits.maxUniformBuffersPerShaderStage)} uniform buffers per shader stage; Hilo3d built-in variants require 9`
                );
            }
            const device = await adapter.requestDevice({
                requiredFeatures: [...features],
                requiredLimits: this.requiredLimits
            });
            if (this.destroyed || generation !== this.initializationGeneration) {
                device.destroy();
                throw new Error('WebGPURenderer initialization was cancelled');
            }
            this.adapter = adapter;
            this.device = device;
            this.deviceStateActive = true;
            const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
            if (!context) throw new Error('Unable to create a WebGPU canvas context');
            this.context = context;
            this.canvasFormat = gpu.getPreferredCanvasFormat();
            this.sampleCount = this.antialias ? 4 : 1;
            this.depthStencilFormat = this.depth
                ? this.stencil
                    ? 'depth24plus-stencil8'
                    : 'depth24plus'
                : undefined;
            context.configure({
                device,
                format: this.canvasFormat,
                alphaMode: this.alpha ? 'premultiplied' : 'opaque'
            });
            this.pipelineManager = new WebGPUPipelineManager(device);
            this.bufferManager = new WebGPUBufferManager(device);
            this.textureManager = new WebGPUTextureManager(device, () => {
                this.bindGroupManager?.clearBindGroups();
            });
            this.uniformBufferManager = new WebGPUUniformBufferManager(device);
            this.bindGroupManager = new WebGPUBindGroupManager(device, this.textureManager);
            await this.translator.initialize();
            this.assertInitializationActive(generation);
            Shader.init(this);
            this.renderList.useInstanced = this.useInstanced;
            this.createRenderAttachments();
            if (this.useFramebuffer) this.createOwnedRenderTarget();
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
            void device.lost.then(info => {
                this.handleDeviceLoss(device, generation, info);
            });
            this.initialized = true;
            this.fire('init');
        } catch (error: unknown) {
            const cancelled = this.destroyed || generation !== this.initializationGeneration;
            const failure = cancelled
                ? new Error('WebGPURenderer initialization was cancelled')
                : error instanceof Error
                  ? error
                  : new Error(String(error));
            this.disposeDeviceState();
            if (!cancelled) {
                this.isInitFailed = true;
                this.fire('initFailed', failure);
            }
            throw failure;
        }
    }

    resize(width: number, height: number, force = false): void {
        if (!force && this.width === width && this.height === height) return;
        this.width = width;
        this.height = height;
        if (this.domElement) {
            this.domElement.width = width;
            this.domElement.height = height;
        }
        if (this.device) {
            this.createRenderAttachments();
            if (this.ownsRenderTarget && this.renderTarget) {
                this.renderTarget.resize(
                    this.framebufferOption.width ?? Math.max(1, width),
                    this.framebufferOption.height ?? Math.max(1, height)
                );
            }
        }
    }

    setOffset(x: number, y: number): void {
        this.offsetX = x;
        this.offsetY = y;
    }

    viewport(x?: number, y?: number): void {
        if (x !== undefined) this.offsetX = x;
        if (y !== undefined) this.offsetY = y;
    }

    render(stage: RendererScene, camera: Camera, fireEvent = false): void {
        if (this.deviceLossInfo) {
            const message = this.deviceLossInfo.message.trim();
            throw new Error(
                `WebGPURenderer cannot render because the WebGPU device was lost${message ? `: ${message}` : ''}`
            );
        }
        if (!this.isReady)
            throw new Error('WebGPURenderer is not ready; await stage.ready before rendering');
        const device = this.gpuDevice;
        const context = this.context;
        if (!context) throw new Error('WebGPU canvas context is unavailable');
        this.resourceManager.beginFrame();
        try {
            this.fog = stage.fog ?? null;
            this.lightManager.reset();
            this.renderInfo.reset();
            this.renderList.reset();
            semantic.init(this, camera, this.lightManager, this.fog);
            stage.updateMatrixWorld();
            camera.updateViewProjectionMatrix();
            this.uniformBlockManager.beginFrame(camera);

            const lights: Light[] = [];
            const sceneMeshes: Mesh[] = [];
            stage.traverse(node => {
                if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
                if (node instanceof Mesh) {
                    sceneMeshes.push(node);
                    this.renderList.addMesh(node, camera);
                } else if (node instanceof Light) lights.push(node);
                return Node.TRAVERSE_STOP_NONE;
            });
            this.renderList.sort();
            for (const light of lights) this.lightManager.addLight(light);
            this.validateLightLimits();
            const shadowFrame = this.renderShadowAtlas(camera, sceneMeshes);
            this.lightManager.updateInfo(camera);
            this.applyShadowFrameData(shadowFrame);
            semantic.setCamera(camera);
            this.uniformBlockManager.beginPass(camera);
            if (fireEvent) this.fire('beforeRender');

            const renderTarget = this.renderTarget;
            const needsCanvasTexture = renderTarget === null || this.autoPresentRenderTarget;
            const currentTexture = needsCanvasTexture ? context.getCurrentTexture() : null;
            const encoder = device.createCommandEncoder({ label: 'Hilo3d frame' });
            const passDescriptor = renderTarget
                ? renderTarget.createRenderPassDescriptor({ label: 'Hilo3d scene target' })
                : this.createCanvasRenderPassDescriptor(currentTexture);
            const targetLayout = renderTarget?.getRenderPassLayout();
            this.activeDrawTarget = targetLayout
                ? {
                      colorFormats: targetLayout.colorFormats,
                      ...(targetLayout.depthStencilFormat
                          ? { depthStencilFormat: targetLayout.depthStencilFormat }
                          : {}),
                      sampleCount: targetLayout.sampleCount as 1 | 4
                  }
                : this.getMainDrawTarget();
            this.activeViewport = renderTarget
                ? [0, 0, renderTarget.width, renderTarget.height]
                : null;
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
            device.queue.submit([encoder.finish()]);
            this.resourceManager.endFrame();
        } catch (error: unknown) {
            this.resourceManager.abortFrame();
            this.resourceManager.destroyUnusedResource(stage);
            throw error;
        }
        if (fireEvent) this.fire('afterRender');
        this.resourceManager.destroyUnusedResource(stage);
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

    /** Create a device-compatible offscreen target without exposing renderer internals. */
    createRenderTarget(parameters: WebGPURenderTargetParameters): WebGPURenderTarget {
        return new WebGPURenderTarget(this.gpuDevice, this.requireTextureManager(), parameters);
    }

    /** Select an offscreen target. Explicit targets are not presented unless requested. */
    setRenderTarget(
        target: WebGPURenderTarget | null,
        options: { readonly present?: boolean; readonly takeOwnership?: boolean } = {}
    ): this {
        if (target && target.device !== this.gpuDevice) {
            throw new TypeError('WebGPU render target belongs to a different device');
        }
        if (target?.isDestroyed) throw new Error('Cannot select a destroyed WebGPU render target');
        if (this.ownsRenderTarget && this.renderTarget && this.renderTarget !== target) {
            this.renderTarget.destroy();
        }
        this.renderTarget = target;
        this.ownsRenderTarget = target !== null && options.takeOwnership === true;
        this.autoPresentRenderTarget = target !== null && options.present === true;
        this.useFramebuffer = target !== null;
        return this;
    }

    /** Present the first color attachment of a render target to the canvas. */
    present(target: WebGPURenderTarget = this.requireRenderTarget()): void {
        const device = this.gpuDevice;
        if (target.device !== device) {
            throw new TypeError('WebGPU render target belongs to a different device');
        }
        if (target.isDestroyed) throw new Error('Cannot present a destroyed WebGPU render target');
        const context = this.context;
        if (!context) throw new Error('WebGPU canvas context is unavailable');
        const encoder = device.createCommandEncoder({ label: 'Hilo3d present' });
        this.encodePresent(encoder, target, context.getCurrentTexture());
        device.queue.submit([encoder.finish()]);
    }

    private createOwnedRenderTarget(): void {
        if (this.ownsRenderTarget && this.renderTarget) this.renderTarget.destroy();
        const { width, height, ...configured } = this.framebufferOption;
        const depthStencilAttachment =
            configured.depthStencilAttachment ??
            (this.depth
                ? { format: this.stencil ? 'depth24plus-stencil8' : 'depth24plus' }
                : false);
        const colorAttachments = configured.colorAttachments ?? [
            {
                clearValue: {
                    r: this.clearColor.r,
                    g: this.clearColor.g,
                    b: this.clearColor.b,
                    a: this.clearColor.a
                }
            }
        ];
        this.renderTarget = this.createRenderTarget({
            ...configured,
            width: width ?? Math.max(1, this.width),
            height: height ?? Math.max(1, this.height),
            sampleCount: configured.sampleCount ?? this.sampleCount,
            colorAttachments,
            depthStencilAttachment
        });
        this.ownsRenderTarget = true;
        this.autoPresentRenderTarget = true;
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
        const resource = this.requireTextureManager().get(texture);
        const sampleType = resolveWebGPUTextureFormat(texture).sampleType;
        if (sampleType !== 'float' && sampleType !== 'unfilterable-float') {
            throw new TypeError(`WebGPU presentation does not support ${sampleType} textures`);
        }
        const presentPipeline = this.getPresentPipeline(sampleType);
        const bindGroup = this.gpuDevice.createBindGroup({
            label: 'Hilo3d present bind group',
            layout: presentPipeline.bindGroupLayout,
            entries: [{ binding: 0, resource: resource.view }]
        });
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
        pass.setBindGroup(0, bindGroup);
        pass.setViewport(0, 0, this.width, this.height, 0, 1);
        pass.draw(3);
        pass.end();
    }

    private getPresentPipeline(sampleType: GPUTextureSampleType): WebGPUPresentPipeline {
        const cached = this.presentPipelines.get(sampleType);
        if (cached) return cached;
        const device = this.gpuDevice;
        const bindGroupLayout = device.createBindGroupLayout({
            label: `Hilo3d present ${sampleType}`,
            entries: [
                {
                    binding: 0,
                    visibility: WebGPUShaderStage.FRAGMENT,
                    texture: { sampleType, viewDimension: '2d', multisampled: false }
                }
            ]
        });
        const module = device.createShaderModule({
            label: 'Hilo3d present shader',
            code: PRESENT_SHADER
        });
        const pipeline = device.createRenderPipeline({
            label: `Hilo3d present ${sampleType}`,
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            vertex: { module, entryPoint: 'vertexMain' },
            fragment: {
                module,
                entryPoint: 'fragmentMain',
                targets: [{ format: this.canvasFormat }]
            },
            primitive: { topology: 'triangle-list' },
            multisample: { count: 1 }
        });
        const result = { bindGroupLayout, pipeline };
        this.presentPipelines.set(sampleType, result);
        return result;
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
        sceneMeshes: readonly Mesh[]
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
                this.renderShadowSlice(slice, sceneMeshes, columns, tileWidth, tileHeight);
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
        tileHeight: number
    ): void {
        const atlas = this.shadowAtlasGPUTexture;
        if (!atlas) throw new Error('WebGPU shadow atlas is unavailable');
        const device = this.gpuDevice;
        const encoder = device.createCommandEncoder({
            label: `Hilo3d shadow slice ${String(slice.logicalIndex)}`
        });
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
        this.uniformBlockManager.beginPass(slice.camera);
        semantic.setCamera(slice.camera);
        const shadowList = new RenderList();
        shadowList.useInstanced = this.useInstanced;
        for (const mesh of sceneMeshes) {
            if (mesh.material?.castShadows === true) shadowList.addMesh(mesh, slice.camera);
        }
        shadowList.sort();
        const target: WebGPUDrawTargetState = {
            colorFormats: [null],
            depthStencilFormat: 'depth24plus',
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
                            this.setupDraw(
                                batch,
                                true,
                                target,
                                this.getInstanceBatchOwner(
                                    first,
                                    Math.floor(start / MAX_INSTANCES_PER_DRAW)
                                )
                            )
                        );
                    }
                }
            );
        } finally {
            this.activePass = null;
            pass.end();
        }
        device.queue.submit([encoder.finish()]);
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
        return camera;
    }

    private updatePointShadowCameras(
        light: PointLight,
        mainCamera: Camera
    ): readonly PerspectiveCamera[] {
        const info = light.shadow?.cameraInfo;
        if (info) {
            const unsupported = [
                'aspect',
                'fov',
                'left',
                'right',
                'top',
                'bottom',
                'x',
                'y',
                'z',
                'rotationX',
                'rotationY',
                'rotationZ'
            ].find(name => Reflect.get(info, name) !== undefined);
            if (unsupported) {
                throw new TypeError(
                    `Point-light shadow cameraInfo.${unsupported} cannot override the six canonical cube-face cameras`
                );
            }
        }
        let cameras = this.shadowCameras.get(light);
        if (cameras?.length !== 6) {
            cameras = Array.from({ length: 6 }, () => new PerspectiveCamera());
            this.shadowCameras.set(light, cameras);
        }
        const clipping = cameraClippingPlanes(mainCamera);
        const near = info?.near ?? clipping.near;
        const far =
            info?.far ?? (light.range > 0 ? Math.min(light.range, clipping.far) : clipping.far);
        if (far <= near) {
            throw new RangeError(
                'Point-light shadow far plane must be greater than its near plane'
            );
        }
        const position = new Vector3();
        light.worldMatrix.getTranslation(position);
        cameras.forEach((candidate, face) => {
            if (!(candidate instanceof PerspectiveCamera)) {
                throw new TypeError('Point-light shadow cache contains a non-perspective camera');
            }
            candidate.position.copy(position);
            candidate.up.fromArray(pointShadowUps[face] ?? pointShadowUps[0]);
            const direction = pointShadowDirections[face] ?? pointShadowDirections[0];
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
        const gpuTexture = this.gpuDevice.createTexture({
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
                this.getInstanceBatchOwner(mesh, Math.floor(start / MAX_INSTANCES_PER_DRAW))
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
        const compiled = this.getCompiledShader(shader);
        if (compiled.translated.fragmentOutputs.length !== target.colorFormats.length) {
            throw new Error(
                `The render target exposes ${String(target.colorFormats.length)} color slots, but the shader exposes ${String(compiled.translated.fragmentOutputs.length)} fragment outputs`
            );
        }
        const vertexBuffers = this.resolveVertexBuffers(
            meshes,
            material,
            compiled.translated.vertexInputs,
            useInstanced,
            instanceBatchOwner
        );
        const stripMode = isStripMode(geometry.mode);
        const indexBuffer = geometry.indices
            ? this.requireBufferManager().getIndexBuffer(geometry.indices, {
                  primitiveRestart: stripMode
              })
            : null;
        const samplers = this.resolveSamplers(compiled.translated, mesh, material);
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
            colorFormats: target.colorFormats,
            ...(target.depthStencilFormat ? { depthStencilFormat: target.depthStencilFormat } : {}),
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
            shader,
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
            this.resourceManager.addMeshResources(batchMesh, managedResources);
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

    private getInstanceBatchOwner(mesh: Mesh, batchIndex: number): WebGPUInstanceBatchOwner {
        const material = materialFor(mesh, this.forceMaterial);
        const geometry = geometryFor(mesh);
        const key = `${material.id}:${geometry.id}:${String(batchIndex)}`;
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
            return this.requireBindGroupManager().resolveSampler(binding, texture);
        });
    }

    private getCompiledShader(shader: Shader): CompiledWebGPUShader {
        const cached = this.compiledShaders.get(shader);
        if (cached) return cached;
        const translated = this.translator.translate(shader.vs, shader.fs);
        const device = this.gpuDevice;
        const result: CompiledWebGPUShader = {
            translated,
            vertexModule: device.createShaderModule({
                label: `${shader.id}:vertex`,
                code: translated.vertex.wgsl
            }),
            fragmentModule: device.createShaderModule({
                label: `${shader.id}:fragment`,
                code: translated.fragment.wgsl
            })
        };
        this.compiledShaders.set(shader, result);
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
        pass.setPipeline(setup.pipeline);
        setup.bindGroups.forEach((group, index) => {
            pass.setBindGroup(index, group);
        });
        setup.vertexBuffers.forEach((binding, index) => {
            pass.setVertexBuffer(index, binding.buffer);
        });
        const viewport = this.activeViewport ?? [
            this.offsetX,
            this.offsetY,
            this.width,
            this.height
        ];
        pass.setViewport(
            viewport[0],
            viewport[1],
            viewport[2],
            viewport[3],
            setup.renderState.dynamic.depthRange[0],
            setup.renderState.dynamic.depthRange[1]
        );
        if (this.stencil) pass.setStencilReference(setup.renderState.dynamic.stencilReference);
        if (setup.indexBuffer) {
            pass.setIndexBuffer(setup.indexBuffer.buffer, setup.indexBuffer.format);
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
            this.depthTexture = device.createTexture({
                label: 'Hilo3d depth/stencil',
                size,
                format: this.depthStencilFormat,
                sampleCount: this.sampleCount,
                usage: WebGPUTextureUsage.RENDER_ATTACHMENT
            });
        }
        if (this.sampleCount > 1) {
            this.multisampleTexture = device.createTexture({
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

    clear(): void {
        throw new Error('WebGPU clear operations are encoded as render-pass load operations');
    }

    clearDepth(): void {
        throw new Error('WebGPU depth clears are encoded as render-pass load operations');
    }

    clearStencil(): void {
        throw new Error('WebGPU stencil clears are encoded as render-pass load operations');
    }

    releaseGPUResources(): void {
        this.depthTexture?.destroy();
        this.multisampleTexture?.destroy();
        this.depthTexture = null;
        this.multisampleTexture = null;
        this.destroyShadowAtlas();
        if (this.ownsRenderTarget) this.renderTarget?.destroy();
        this.renderTarget = null;
        this.ownsRenderTarget = false;
        this.autoPresentRenderTarget = false;
        this.bufferManager?.destroy();
        this.textureManager?.destroyAll();
        this.uniformBufferManager?.destroy();
        this.bindGroupManager?.clear();
        this.pipelineManager?.clear();
        this.presentPipelines.clear();
        this.uniformBlockManager.destroy();
        this.compiledShaders = new WeakMap();
        this.instanceUniformBuffers = new WeakMap();
        this.instanceBatchOwners.clear();
        this.shadowCameras = new WeakMap();
        this.bufferOwnerResources = new WeakMap();
        this.uniformResources = new WeakMap();
        this.resourceManager.clear();
    }

    private handleDeviceLoss(device: GPUDevice, generation: number, info: GPUDeviceLostInfo): void {
        if (
            this.destroyed ||
            generation !== this.initializationGeneration ||
            this.device !== device
        ) {
            return;
        }
        this.initializationGeneration++;
        this.initialized = false;
        this.isInitFailed = true;
        this.deviceLossInfo = info;
        try {
            this.disposeDeviceState({ expectedDevice: device, destroyDevice: false });
        } finally {
            this.fire('webgpuDeviceLost', info);
        }
    }

    private disposeDeviceState(
        options: { readonly expectedDevice?: GPUDevice; readonly destroyDevice?: boolean } = {}
    ): void {
        if (options.expectedDevice && this.device !== options.expectedDevice) return;
        if (!this.deviceStateActive) {
            this.initialized = false;
            return;
        }
        const context = this.context;
        const device = this.device;
        this.deviceStateActive = false;
        try {
            this.releaseGPUResources();
        } finally {
            this.pipelineManager = null;
            this.bufferManager = null;
            this.textureManager = null;
            this.uniformBufferManager = null;
            this.bindGroupManager = null;
            this.context = null;
            this.device = null;
            this.adapter = null;
            this.activePass = null;
            this.activeDrawTarget = null;
            this.activeViewport = null;
            this.initialized = false;
            try {
                context?.unconfigure();
            } finally {
                if (options.destroyDevice !== false) device?.destroy();
            }
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.initializationGeneration++;
        try {
            this.disposeDeviceState();
        } finally {
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
