import Camera from '../../camera/Camera';
import type Mesh from '../../core/Mesh';
import type { DispatchEvent } from '../../core/EventDispatcher';
import { LINES, LINE_STRIP, TRIANGLES, TRIANGLE_STRIP } from '../../constants/webgl';
import type Texture from '../../texture/Texture';
import Shader from '../../shader/Shader';
import {
    DEFAULT_MATERIAL_PIPELINE_STATE,
    type MaterialPipelineState
} from '../../material/MaterialDefinition';
import {
    createRendererFrame,
    invokeRendererFrameCallback,
    default as RendererCore,
    type RendererBackend,
    type RendererFrameCallback,
    type RendererScene,
    type RendererViewport,
    type TextureCompressionFormat
} from '../RendererCore';
import type {
    RendererContextPowerPreference,
    RendererFeatureName,
    RendererWebGL2Options,
    RendererWebGPUOptions
} from '../RendererOptions';
import { defaultForwardRenderPipelineFactory } from '../pipeline/ForwardRenderPipeline';
import type {
    RenderPipelineCapabilities,
    RenderPipelineContext,
    RenderPipelineFactory
} from '../pipeline/RenderPipeline';
import { getRenderNodeExtension } from '../pipeline/RenderNodeExtension';
import type {
    RenderTarget,
    RenderTargetColorAttachmentReadback,
    RenderTargetCompareFunction,
    RenderTargetParameters,
    RenderTargetPresentationOptions,
    RenderTargetReadColorAttachmentOptions,
    RenderTargetSelectionOptions
} from '../RenderTarget';
import type { RenderColorEncoding } from '../RenderColorEncoding';
import {
    RendererStorageBuffer,
    type StorageBuffer,
    type StorageBufferDescriptor,
    type StorageBufferHost,
    type StorageBufferReadback
} from '../StorageBuffer';
import {
    createRenderGraphFrameContext,
    type RenderGraphFrameContext
} from '../frame/RenderGraphFrameContext';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import {
    constructRHIDevice,
    createRHIDevice,
    waitForWebGL2RHIContextRestored,
    type RHIRequestableWebGPUFeature,
    type WebGPURHIDeviceCreateOptions
} from '../rhi/RHIFactory';
import {
    RHICacheCounterAggregate,
    RHICacheCounterContinuation,
    RHITextureUsage,
    type RHIDevice,
    type RHIExecutionInteropHost,
    type RHISampler,
    type RHISamplerDescriptor,
    type RHISurface,
    type RHIViewport
} from '../rhi/core';
import { externalTextureBindingRegistry } from '../renderer/ExternalTextureBindingRegistry';
import type { FullscreenDrawProcessor } from '../renderer/FullscreenDrawProcessor';
import { MeshDrawProcessor } from '../renderer/MeshDrawProcessor';
import type { PreparedDraw } from '../renderer/PreparedDraw';
import type { RHIMeshDrawTargetDescriptor } from '../renderer/RHIDescriptorMapping';
import { OffscreenRenderTargetRenderer } from '../renderer/OffscreenRenderTargetRenderer';
import { PostProcessRenderer } from '../renderer/PostProcessRenderer';
import {
    RHIRecoveryCoordinator,
    type RHIRecoveryCoordinatorEvent
} from '../renderer/RHIRecoveryCoordinator';
import { RHIRenderTarget, type RHIRenderTargetHost } from '../renderer/RHIRenderTarget';
import { RenderTargetReadback } from '../renderer/RenderTargetReadback';
import type { RenderTargetGraphBridge } from '../renderer/RenderTargetGraphBridge';
import {
    RenderTargetResourceCache,
    type RenderTargetResourceRecord
} from '../renderer/RenderTargetResourceCache';
import { RenderTargetTextureBindingProvider } from '../renderer/RenderTargetTextureBindingProvider';
import { RendererRecoveringError, type ResourceRegistryHandle } from '../renderer/ResourceRegistry';
import { ShaderArtifactCompiler } from '../renderer/ShaderArtifactCompiler';
import { ShadowAtlasMeshPreparer } from '../renderer/ShadowAtlasMeshPreparer';
import { ShadowAtlasContentCache } from '../renderer/ShadowAtlasContentCache';
import {
    ShadowAtlasPageResidency,
    type ShadowAtlasPageRegion
} from '../renderer/ShadowAtlasPageResidency';
import { ShadowAtlasRenderer } from '../renderer/ShadowAtlasRenderer';
import { ShadowAtlasResourceCache } from '../renderer/ShadowAtlasResourceCache';
import { ShadowAtlasSceneAdapter } from '../renderer/ShadowAtlasSceneAdapter';
import { ShadowAtlasTextureBinding } from '../renderer/ShadowAtlasTextureBinding';
import { ShadowAtlasUpdateScheduler } from '../renderer/ShadowAtlasUpdateScheduler';
import { ComputePipelineResourceCache } from '../renderer/ComputePipelineResourceCache';
import { ComputeSamplerResourceCache } from '../renderer/ComputeSamplerResourceCache';
import { GPUDrivenPipelineResourceCache } from '../renderer/GPUDrivenPipelineResourceCache';
import { ScriptableBindGroupResourceCache } from '../renderer/ScriptableBindGroupResourceCache';
import { StorageBufferReadbackService } from '../renderer/StorageBufferReadback';
import { StorageBufferResourceCache } from '../renderer/StorageBufferResourceCache';
import { prepareWebGPUMipmapShaderArtifacts } from '../renderer/WebGPUMipmapShader';
import { WgslComputeShaderCompiler } from '../shader/WgslComputeCompiler';
import { StorageGraphicsShaderCompiler } from '../shader/StorageGraphicsShaderCompiler';
import type StorageGraphicsShader from '../compute/StorageGraphicsShader';
import { RenderPipelineHost, type RenderPipelineHostLifecycle } from './RenderPipelineHost';
import { cameraCompositionRequiresSingleSample } from './CameraCompositionPolicy';
import { depthClearValue } from '../renderer/DepthConvention';
import {
    ScriptableRenderPipelineContextImpl,
    ScriptableRenderPipelineResources,
    type ScriptableRenderPipelineServices,
    type ScriptableShadowAtlasBuild,
    type ScriptableSurfaceFramePolicy
} from './ScriptableRenderPipelineContext';

type SharedRendererOptions =
    Omit<RendererWebGL2Options, 'backend'> | Omit<RendererWebGPUOptions, 'backend'>;

interface RenderingResources {
    readonly processor: MeshDrawProcessor;
    readonly targets: RenderTargetResourceCache;
    readonly offscreen: OffscreenRenderTargetRenderer;
    readonly postProcess: PostProcessRenderer;
    readonly readback: RenderTargetReadback;
    readonly storageBuffers: StorageBufferResourceCache;
    readonly storageReadback: StorageBufferReadbackService;
    readonly computePipelines: ComputePipelineResourceCache;
    readonly computeSamplers: ComputeSamplerResourceCache;
    readonly gpuDrivenPipelines: GPUDrivenPipelineResourceCache;
    readonly scriptableBindGroups: ScriptableBindGroupResourceCache;
    readonly shadowScene: ShadowAtlasSceneAdapter;
    readonly shadowContent: ShadowAtlasContentCache;
    readonly shadowUpdates: ShadowAtlasUpdateScheduler;
    readonly shadowPages: ShadowAtlasPageResidency;
    readonly shadowResources: ShadowAtlasResourceCache;
    readonly shadowRenderer: ShadowAtlasRenderer;
    readonly shadowPreparer: ShadowAtlasMeshPreparer;
    readonly shadowBinding: ShadowAtlasTextureBinding;
    readonly shadowClearShaders: Readonly<Record<'standard' | 'reversed', Shader>>;
    readonly shadowClearOwners: Readonly<Record<'standard' | 'reversed', object>>;
    readonly shadowClearTarget: {
        readonly colorFormats: RHIMeshDrawTargetDescriptor['colorFormats'];
        depthStencilFormat: NonNullable<RHIMeshDrawTargetDescriptor['depthStencilFormat']>;
        readonly sampleCount: 1;
    };
    readonly shadowOwner: object;
    readonly shadowPrepareOptions: {
        width: number;
        height: number;
        receiverDrivenResolution: boolean;
        minimumResolution: number;
        frameIndex: number;
        cascadeUpdateIntervals: readonly number[];
    };
    readonly shadowRenderOptions: {
        label: string;
        preparer: ShadowAtlasMeshPreparer;
        depthClearValue: number;
        dirtySlices: readonly boolean[] | undefined;
        pageRegions: readonly ShadowAtlasPageRegion[] | undefined;
        sliceClearDraw: PreparedDraw | undefined;
    };
    readonly shadowViewport: {
        x: number;
        y: number;
        width: number;
        height: number;
        minDepth: number;
        maxDepth: number;
    };
    readonly recovery: RHIRecoveryCoordinator;
}

interface PendingAfterSceneEvent {
    readonly meshes: Mesh[];
    source: readonly Mesh[] | null;
}

const OPTIONAL_WEBGPU_FEATURES: readonly RHIRequestableWebGPUFeature[] = Object.freeze([
    'timestamp-query',
    'shader-f16',
    'subgroups',
    'float32-filterable',
    'texture-compression-bc',
    'texture-compression-etc2',
    'texture-compression-astc'
]);

const SHADOW_ATLAS_CLEAR_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
void main() {}
`;
const EMPTY_SHADOW_COLOR_FORMATS = Object.freeze([]);

function shadowAtlasClearVertexSource(depthMode: Camera['depthMode']): string {
    const clipDepth = depthMode === 'reversed' ? '-1.0' : '1.0';
    return `#version 300 es
void main() {
    vec2 positions[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    gl_Position = vec4(positions[gl_VertexID], ${clipDepth}, 1.0);
}`;
}

const SHADOW_ATLAS_CLEAR_PIPELINE_STATE: Readonly<MaterialPipelineState> = Object.freeze({
    ...DEFAULT_MATERIAL_PIPELINE_STATE,
    cullMode: 'none',
    depthTest: true,
    depthWrite: true,
    depthCompare: 'always'
});

const REQUESTABLE_WEBGPU_FEATURES = new Set<string>([
    ...OPTIONAL_WEBGPU_FEATURES,
    'depth32float-stencil8',
    'float32-blendable'
]);

function snapshotRequiredWebGPUFeatures(
    features: readonly RendererFeatureName[] | undefined
): readonly RHIRequestableWebGPUFeature[] {
    if (features === undefined) return Object.freeze([]);
    const result = new Array<RHIRequestableWebGPUFeature>(features.length);
    for (let index = 0; index < features.length; index += 1) {
        const feature = features[index];
        if (feature === undefined || !REQUESTABLE_WEBGPU_FEATURES.has(feature)) {
            throw new TypeError(
                `Renderer required feature ${String(feature)} is outside the portable RHI feature set`
            );
        }
        result[index] = feature;
    }
    return Object.freeze(result);
}

function asError(reason: unknown, message: string): Error {
    return reason instanceof Error ? reason : new Error(`${message}: ${String(reason)}`);
}

function positiveSurfaceDimension(value: number, fallback: number): number {
    if (Number.isSafeInteger(value) && value > 0) return value;
    if (Number.isSafeInteger(fallback) && fallback > 0) return fallback;
    return 1;
}

function countMeshFaces(mesh: Mesh): number {
    const geometry = mesh.geometry;
    if (geometry === null) return 0;
    const elementCount = geometry.indices?.count ?? geometry.vertices?.count ?? 0;
    if (geometry.mode === TRIANGLES) return Math.floor(elementCount / 3);
    if (geometry.mode === TRIANGLE_STRIP) return Math.max(0, elementCount - 2);
    if (geometry.mode === LINES || geometry.mode === LINE_STRIP) return 0;
    return 0;
}

function resolvePresentationColorEncoding(value: unknown): RenderColorEncoding {
    const encoding = value ?? 'linear';
    if (encoding !== 'linear' && encoding !== 'srgb') {
        throw new TypeError('Render-target presentation color encoding must be linear or srgb');
    }
    return encoding;
}

function reportListenerFailure(reason: unknown): void {
    const error = asError(reason, 'Renderer lifecycle listener failed');
    queueMicrotask(() => {
        const reporter: unknown = Reflect.get(globalThis, 'reportError');
        if (typeof reporter === 'function') {
            try {
                Reflect.apply(reporter, globalThis, [error]);
                return;
            } catch {
                // Fall through to the console without replacing the renderer operation.
            }
        }
        globalThis.console.error(error);
    });
}

/**
 * The single production renderer frontend shared by the concrete WebGL2 and WebGPU RHI
 * devices. Backend selection happens once during construction; scene traversal, resource
 * preparation, graph execution, events and recovery are identical afterwards.
 */
class SharedRendererDriver
    extends RendererCore
    implements
        RHIRenderTargetHost,
        StorageBufferHost,
        RenderPipelineHostLifecycle,
        ScriptableRenderPipelineServices
{
    override readonly className = 'Renderer' as const;
    override readonly backend: RendererBackend;
    override readonly ready: Promise<void>;
    override renderTarget: RHIRenderTarget | null = null;

    preserveDrawingBuffer = false;
    powerPreference: RendererContextPowerPreference = 'default';
    forceFallbackAdapter = false;
    requiredFeatures: readonly RendererFeatureName[] = Object.freeze([]);
    requiredLimits: Readonly<Record<string, number>> = Object.freeze({});
    renderPipeline: RenderPipelineFactory = defaultForwardRenderPipelineFactory;

    readonly #compiler = new ShaderArtifactCompiler();
    readonly #computeCompiler = new WgslComputeShaderCompiler();
    readonly #storageGraphicsCompiler = new StorageGraphicsShaderCompiler();
    readonly #fallbackCamera = new Camera();
    readonly #pipelineHost = new RenderPipelineHost(this);
    readonly #scriptablePipelineResources = new ScriptableRenderPipelineResources();
    readonly #scriptablePipelineContexts: ScriptableRenderPipelineContextImpl[] = [];
    readonly #visibleMeshes: Mesh[] = [];
    readonly #collectVisibleMesh = (mesh: Mesh): void => {
        this.#visibleMeshes.push(mesh);
    };
    readonly #renderTargets = new Set<RHIRenderTarget>();
    readonly #storageBuffers = new Set<RendererStorageBuffer>();
    readonly #renderTargetTextureBindings = new Set<RenderTargetTextureBindingProvider>();
    readonly #getActiveUploadBatch = () => this.#pipelineHost.requireActiveScope().uploads;
    readonly #retiredResourceCleanups = new Set<Promise<void>>();
    readonly #webGPUDeviceOptions: Readonly<
        Omit<WebGPURHIDeviceCreateOptions, 'mipmapShaderArtifacts'>
    >;
    readonly #webGLContextOptions: Readonly<NonNullable<RendererWebGL2Options>>;
    readonly #rhiExtension: object;
    readonly #executionInteropHost: RHIExecutionInteropHost;

    #device: RHIDevice | null = null;
    #webGPUMipmapShaderArtifacts: ReturnType<typeof prepareWebGPUMipmapShaderArtifacts> | null =
        null;
    #surface: RHISurface | null = null;
    #resources: RenderingResources | null = null;
    #lastStage: RendererScene | null = null;
    #lastCamera: Camera | null = null;
    #pendingPresentationStage: RendererScene | null = null;
    #pendingPresentationCamera: Camera | null = null;
    #presentationViewport: Readonly<RHIViewport> | null = null;
    #initialized = false;
    #destroyed = false;
    #meshFrameStarted = false;
    #meshSemanticFrameStarted = false;
    #fullscreenFrameStarted = false;
    #surfaceRequested = false;
    #surfaceDepthMode: Camera['depthMode'] | null = null;
    #shadowBindingAttachedThisFrame = false;
    #applicationPassCount = 0;
    #applicationFaceCount = 0;
    readonly #usedTargets: RenderTargetResourceRecord[] = [];
    readonly #afterSceneEvents: PendingAfterSceneEvent[] = [];
    readonly #frameCleanupFailures: unknown[] = [];
    #afterSceneEventCount = 0;
    #ownsRenderTarget = false;
    #autoPresentRenderTarget = false;
    #selectedTargetColorEncoding: RenderColorEncoding = 'linear';
    #pipelineCacheMetrics: RHICacheCounterContinuation | null = null;
    #bindGroupCacheMetrics: RHICacheCounterContinuation | null = null;
    #shadowAtlasCacheMetrics: RHICacheCounterContinuation | null = null;
    #vertexInputCacheMetrics: RHICacheCounterContinuation | null = null;
    #framebufferCacheMetrics: RHICacheCounterContinuation | null = null;
    #scriptablePipelineContextCursor = 0;
    #activeScriptablePipelineContext: ScriptableRenderPipelineContextImpl | null = null;
    #scriptableResourcesFrameStarted = false;

    readonly #handleManagedMeshDestroy = (event: DispatchEvent): void => {
        const mesh = event.detail;
        if (typeof mesh !== 'object' || mesh === null) return;
        const resources = this.#resources;
        if (resources === null) return;
        resources.processor.detachMesh(mesh as Mesh);
    };

    constructor(backend: RendererBackend, options: SharedRendererOptions = {}) {
        super();
        this.backend = backend;
        if (
            backend === 'webgpu' &&
            Object.prototype.hasOwnProperty.call(options, 'preserveDrawingBuffer')
        ) {
            throw new TypeError(
                'Renderer preserveDrawingBuffer is WebGL2-only; WebGPU requires an explicit copy/readback pass'
            );
        }
        Object.assign(this, options);
        const renderingProfile: unknown = this.renderingProfile;
        if (renderingProfile !== 'portable' && renderingProfile !== 'high-end') {
            throw new TypeError('Renderer renderingProfile must be "portable" or "high-end"');
        }
        if (this.renderingProfile === 'high-end') this.cameraRelative = true;
        const optionRequiredFeatures =
            'requiredFeatures' in options ? options.requiredFeatures : undefined;
        const optionRequiredLimits =
            'requiredLimits' in options ? options.requiredLimits : undefined;
        this.requiredFeatures = Object.freeze([...(optionRequiredFeatures ?? [])]);
        this.requiredLimits = Object.freeze({ ...(optionRequiredLimits ?? {}) });
        this.attachRegisteredDiagnostics(this.domElement);
        this.resourceManager.on('destroyMesh', this.#handleManagedMeshDestroy);

        const requiredFeatures = snapshotRequiredWebGPUFeatures(this.requiredFeatures);
        this.#webGPUDeviceOptions = Object.freeze({
            ...(this.powerPreference === 'low-power' || this.powerPreference === 'high-performance'
                ? { powerPreference: this.powerPreference }
                : {}),
            forceFallbackAdapter: this.forceFallbackAdapter,
            rejectFallbackAdapter: this.failIfMajorPerformanceCaveat,
            requiredFeatures,
            optionalFeatures: OPTIONAL_WEBGPU_FEATURES,
            requiredLimits: this.requiredLimits,
            label: 'Hilo3d shared renderer WebGPU RHI',
            ...(this.rendererDiagnosticsSink === null
                ? {}
                : { diagnosticsSink: this.rendererDiagnosticsSink })
        });
        this.#webGLContextOptions = Object.freeze({
            alpha: this.alpha,
            // RHI owns multisampling explicitly. An antialiased default framebuffer cannot be
            // the destination of the Render Graph's explicit WebGL multisample resolve.
            antialias: false,
            depth: this.depth,
            stencil: this.stencil,
            premultipliedAlpha: this.premultipliedAlpha,
            preserveDrawingBuffer: this.preserveDrawingBuffer,
            failIfMajorPerformanceCaveat: this.failIfMajorPerformanceCaveat,
            powerPreference:
                this.powerPreference === 'low-power' || this.powerPreference === 'high-performance'
                    ? this.powerPreference
                    : 'default'
        });
        const extension = {};
        Object.defineProperties(extension, {
            device: { enumerable: true, get: () => this.requireDevice() },
            surface: { enumerable: true, get: () => this.requireSurface() },
            recoveryState: {
                enumerable: true,
                get: () => this.#resources?.recovery.state ?? 'destroyed'
            }
        });
        this.#rhiExtension = Object.freeze(extension);
        const executionInteropHost = {};
        Object.defineProperties(executionInteropHost, {
            executionDevice: { enumerable: true, get: () => this.requireDevice() },
            presentationSurface: { enumerable: true, get: () => this.requireSurface() },
            assertPresentationMutationAllowed: {
                enumerable: true,
                value: (operation: string) => {
                    this.assertPresentationMutationAllowed(operation);
                }
            },
            executeRetainedPresentation: {
                enumerable: true,
                value: () => {
                    this.executeRetainedPresentation();
                }
            },
            setPresentationViewport: {
                enumerable: true,
                value: (viewport: Readonly<RHIViewport> | null) => {
                    this.setPresentationViewport(viewport);
                }
            }
        });
        this.#executionInteropHost = Object.freeze(executionInteropHost) as RHIExecutionInteropHost;

        this.ready = backend === 'webgl2' ? this.initializeWebGL2() : this.initializeWebGPU();
    }

    override get isReady(): boolean {
        return (
            this.#initialized &&
            this.#pipelineHost.initialized &&
            !this.#destroyed &&
            this.#device?.destroyed === false &&
            this.#resources?.recovery.state === 'ready'
        );
    }

    get renderTargetResources(): RenderTargetResourceCache {
        return this.requireResources().targets;
    }

    override resize(width: number, height: number, force = false): void {
        if (!Number.isSafeInteger(width) || width <= 0) {
            throw new RangeError('Renderer width must be a positive safe integer');
        }
        if (!Number.isSafeInteger(height) || height <= 0) {
            throw new RangeError('Renderer height must be a positive safe integer');
        }
        if (!force && this.width === width && this.height === height) return;
        this.assertNoFrameMutation('resize');
        this.width = width;
        this.height = height;
        const surface = this.#surface;
        if (surface !== null && !surface.destroyed) this.configureSurface(surface);
        else if (this.domElement !== null) {
            this.domElement.width = width;
            this.domElement.height = height;
        }
    }

    override setOffset(x: number, y: number): void {
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new RangeError('Renderer offsets must be finite');
        }
        this.assertNoFrameMutation('setOffset');
        this.offsetX = x;
        this.offsetY = y;
    }

    override getViewport(): RendererViewport {
        const target = this.renderTarget;
        if (target !== null) return [0, 0, target.width, target.height];
        const presentation = this.#presentationViewport;
        if (presentation !== null) {
            return [presentation.x, presentation.y, presentation.width, presentation.height];
        }
        const configuration = this.#surface?.configuration;
        return [
            this.offsetX,
            this.offsetY,
            configuration?.width ??
                positiveSurfaceDimension(this.width, this.domElement?.width ?? 0),
            configuration?.height ??
                positiveSurfaceDimension(this.height, this.domElement?.height ?? 0)
        ];
    }

    override render(stage: RendererScene, camera: Camera, fireEvent = false): void {
        this.prepareAddonRendererResources(stage, camera);
        this.recordFrameCommand(() => {
            const selected = this.renderTarget;
            this.#pipelineHost.recordPipeline(stage, camera, selected, fireEvent);
            if (selected !== null && this.#autoPresentRenderTarget) {
                this.presentInternal(selected, this.#selectedTargetColorEncoding);
            }
        });
    }

    override renderFrame(callback: RendererFrameCallback): void {
        this.assertReadyForRender();
        this.#pipelineHost.execute(() => {
            let facadeActive = true;
            try {
                invokeRendererFrameCallback(
                    callback,
                    createRendererFrame(this, () => facadeActive && this.#pipelineHost.recording)
                );
            } finally {
                facadeActive = false;
            }
        });
    }

    private recordFrameCommand(command: () => void): void {
        this.assertReadyForRender();
        this.#pipelineHost.recordCommand(command);
    }

    createFrameContext(frameIndex: number): RenderGraphFrameContext {
        return this.createContext(
            this.#lastCamera ?? this.#fallbackCamera,
            this.surfaceViewport(),
            frameIndex
        );
    }

    beginFrame(_frameIndex: number): void {
        const resources = this.requireResources();
        this.resetDiagnosticsFrame();
        // RenderInfo publishes the previous completed frame on reset. Reset once per application
        // frame so multiple camera or scriptable-pipeline passes accumulate into one snapshot.
        this.renderInfo.reset();
        this.#meshFrameStarted = false;
        this.#meshSemanticFrameStarted = false;
        this.#fullscreenFrameStarted = false;
        this.#surfaceRequested = false;
        this.#surfaceDepthMode = null;
        this.#shadowBindingAttachedThisFrame = false;
        this.#applicationPassCount = 0;
        this.#applicationFaceCount = 0;
        this.#pendingPresentationStage = null;
        this.#pendingPresentationCamera = null;
        this.#usedTargets.length = 0;
        this.#scriptablePipelineContextCursor = 0;
        this.#activeScriptablePipelineContext = null;
        this.#scriptableResourcesFrameStarted = false;
        this.clearAfterSceneEvents();
        resources.offscreen.beginComposition();
        resources.shadowRenderer.beginComposition();
        resources.postProcess.beginComposition();
    }

    completeFrame(frameIndex: number, execution: RGExecutionResult, uploadCount: number): void {
        const resources = this.requireResources();
        for (const target of this.#usedTargets) {
            resources.targets.markUsed(target, frameIndex);
        }
        void resources.processor.submissions.track(frameIndex, execution.submission);
        if (this.hasFullscreenFrameWork()) {
            void resources.postProcess.fullscreen.trackSubmission(frameIndex, execution.submission);
        }
        if (this.hasSurfaceWork() && this.requireSurface().state === 'acquired') {
            this.requireSurface().present();
        }
        if (this.#applicationFaceCount > 0) {
            this.renderInfo.addFaceCount(this.#applicationFaceCount);
        }
        if (execution.diagnostics.drawCount > 0) {
            this.renderInfo.addDrawCount(execution.diagnostics.drawCount);
        }
        this.recordExecutionDiagnostics(
            execution.diagnostics,
            this.#applicationPassCount,
            uploadCount
        );
        for (let index = 0; index < this.#afterSceneEventCount; index += 1) {
            const pending = this.#afterSceneEvents[index];
            if (pending !== undefined) {
                this.fireAfterSceneEvents(pending.source ?? pending.meshes, true);
            }
        }
        this.commitPendingPresentation();
    }

    failFrame(_error: unknown): void {
        const resources = this.requireResources();
        if (this.hasAttachedShadowBinding()) {
            resources.shadowBinding.detach(this.lightManager);
        }
        const surface = this.#surface;
        if (surface?.state === 'acquired') {
            try {
                surface.present();
            } catch {
                // Preserve the graph build/prepare/execute error.
            }
        }
    }

    endFrame(submitted: boolean): void {
        const resources = this.requireResources();
        const failures = this.#frameCleanupFailures;
        failures.length = 0;
        for (let index = 0; index < this.#scriptablePipelineContextCursor; index += 1) {
            const context = this.#scriptablePipelineContexts[index];
            if (context === undefined) continue;
            try {
                context.releaseFrameReferences();
            } catch (error) {
                failures.push(error);
            }
        }
        if (this.#scriptableResourcesFrameStarted) {
            try {
                this.#scriptablePipelineResources.endFrame(
                    resources.targets,
                    resources.processor.registry,
                    submitted
                );
            } catch (error) {
                failures.push(error);
            }
        }
        try {
            resources.postProcess.endComposition();
        } catch (error) {
            failures.push(error);
        }
        try {
            resources.shadowRenderer.endComposition();
        } catch (error) {
            failures.push(error);
        }
        try {
            resources.offscreen.endComposition();
        } catch (error) {
            failures.push(error);
        }
        try {
            this.clearAfterSceneEvents();
        } catch (error) {
            failures.push(error);
        }
        this.#usedTargets.length = 0;
        this.#meshFrameStarted = false;
        this.#meshSemanticFrameStarted = false;
        this.#fullscreenFrameStarted = false;
        this.#surfaceRequested = false;
        this.#shadowBindingAttachedThisFrame = false;
        this.#pendingPresentationStage = null;
        this.#pendingPresentationCamera = null;
        this.#activeScriptablePipelineContext = null;
        this.#scriptableResourcesFrameStarted = false;
        if (!submitted) {
            try {
                this.synchronizeCacheDiagnosticsAfterFailure();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length !== 0) {
            const failure = new AggregateError(failures, 'Renderer frame cleanup failed', {
                cause: failures[0]
            });
            failures.length = 0;
            throw failure;
        }
    }

    createPipelineContext(
        scene: RendererScene,
        camera: Camera,
        target: RenderTarget | null,
        fireEvent: boolean,
        capabilities: RenderPipelineCapabilities,
        runtimeOwner: object
    ): RenderPipelineContext {
        this.configureCameraProfile(camera);
        const resources = this.requireResources();
        if (!this.#scriptableResourcesFrameStarted) {
            const frameIndex = this.#pipelineHost.activeFrameIndex;
            if (frameIndex === null) {
                throw new Error('Scriptable pipeline resources require an active frame');
            }
            this.#scriptablePipelineResources.beginFrame(frameIndex, resources.processor.registry);
            resources.storageBuffers.beginFrame(
                frameIndex,
                this.#pipelineHost.requireActiveScope().uploads
            );
            this.#scriptableResourcesFrameStarted = true;
        }
        resources.shadowBinding.detach(this.lightManager);
        this.#shadowBindingAttachedThisFrame = false;
        let context = this.#scriptablePipelineContexts[this.#scriptablePipelineContextCursor++];
        if (context === undefined) {
            context = new ScriptableRenderPipelineContextImpl(
                this,
                this.#scriptablePipelineResources
            );
            this.#scriptablePipelineContexts.push(context);
        }
        this.#activeScriptablePipelineContext = context;
        return context.begin(
            scene,
            camera,
            target,
            fireEvent,
            capabilities,
            runtimeOwner,
            this.#pipelineHost.requireActiveScope()
        );
    }

    createPipelineStorageBuffer(descriptor: Readonly<StorageBufferDescriptor>): StorageBuffer {
        if (this.#destroyed) throw new Error('Renderer is destroyed');
        if (this.#pipelineHost.recording) {
            throw new Error('Pipeline storage buffers must be created during initialization');
        }
        const features = this.requireDevice().capabilities.features;
        if (
            this.backend !== 'webgpu' ||
            !features.has('storage-buffers') ||
            !features.has('compute-pipelines')
        ) {
            throw new Error('Pipeline storage buffers require a compute-capable WebGPU renderer');
        }
        const buffer = new RendererStorageBuffer(this, descriptor);
        this.#storageBuffers.add(buffer);
        return buffer;
    }

    endPipelineInvocation(completed: boolean): void {
        const context = this.#activeScriptablePipelineContext;
        this.#activeScriptablePipelineContext = null;
        context?.end(completed);
    }

    get renderer(): RendererCore {
        return this;
    }

    getScriptableSurface(): RHISurface {
        return this.requireSurface();
    }

    getScriptableSurfaceFramePolicy(camera: Camera): Readonly<ScriptableSurfaceFramePolicy> {
        const isOverlayCamera = this.#surfaceRequested;
        if (
            isOverlayCamera &&
            !camera.clearDepth &&
            this.#surfaceDepthMode !== null &&
            this.#surfaceDepthMode !== camera.depthMode
        ) {
            throw new TypeError(
                'Composed cameras may preserve surface depth only when their depth modes match.'
            );
        }
        this.#surfaceDepthMode = camera.depthMode;
        const preservePreviousColor = isOverlayCamera && !camera.clearColor;
        return Object.freeze({
            sampleCount: cameraCompositionRequiresSingleSample(camera) ? 1 : this.antialias ? 4 : 1,
            colorLoadOp: preservePreviousColor ? 'load' : 'clear',
            depthLoadOp: isOverlayCamera && !camera.clearDepth ? 'load' : 'clear',
            depthStoreOp: 'store',
            stencilLoadOp: isOverlayCamera && !camera.clearStencil ? 'load' : 'clear',
            stencilStoreOp: 'store'
        });
    }

    getScriptableMeshProcessor(): MeshDrawProcessor {
        return this.requireResources().processor;
    }

    getScriptableFullscreenProcessor(): FullscreenDrawProcessor {
        return this.requireResources().postProcess.fullscreen;
    }

    getScriptableTargetResources(): RenderTargetResourceCache {
        return this.requireResources().targets;
    }

    getScriptableTargetBridge(): RenderTargetGraphBridge {
        return this.requireResources().offscreen.bridge;
    }

    getScriptableStorageBufferResources(): StorageBufferResourceCache {
        return this.requireResources().storageBuffers;
    }

    resolveScriptableStorageBuffer(buffer: StorageBuffer): RendererStorageBuffer {
        if (!(buffer instanceof RendererStorageBuffer)) {
            throw new TypeError('StorageBuffer was not created by a Hilo3D Renderer');
        }
        return this.requireOwnedStorageBuffer(buffer);
    }

    getScriptableComputePipelineResources(): ComputePipelineResourceCache {
        return this.requireResources().computePipelines;
    }

    getScriptableComputeSamplerResources(): ComputeSamplerResourceCache {
        return this.requireResources().computeSamplers;
    }

    getScriptableGPUDrivenPipelineResources(): GPUDrivenPipelineResourceCache {
        return this.requireResources().gpuDrivenPipelines;
    }

    getScriptableBindGroupResources(): ScriptableBindGroupResourceCache {
        return this.requireResources().scriptableBindGroups;
    }

    resolveScriptableRenderTarget(target: RenderTarget): RHIRenderTarget {
        return this.requireOwnedTarget(target);
    }

    createScriptableFrameContext(
        camera: Camera,
        viewport: Readonly<RHIViewport>,
        frameIndex: number
    ): RenderGraphFrameContext {
        return this.createContext(camera, viewport, frameIndex);
    }

    beginScriptableResourcePass(context: RenderGraphFrameContext): void {
        if (this.#meshFrameStarted) return;
        this.requireResources().processor.beginResourceFrame(
            context,
            this.#pipelineHost.requireActiveScope().uploads
        );
        this.#meshFrameStarted = true;
    }

    beginScriptableMeshPass(context: RenderGraphFrameContext): void {
        this.ensureMeshFrame(context);
    }

    beginScriptableFullscreenPass(context: RenderGraphFrameContext): void {
        if (this.#fullscreenFrameStarted) return;
        this.requireResources().postProcess.fullscreen.beginFrame(
            context,
            this.#pipelineHost.requireActiveScope().uploads
        );
        this.#fullscreenFrameStarted = true;
    }

    prepareScriptableCullingScene(scene: RendererScene, camera: Camera): void {
        this.fog = scene.fog ?? null;
        scene.updateMatrixWorld();
        camera.updateViewProjectionMatrix();
    }

    markScriptableTargetUsed(record: Readonly<RenderTargetResourceRecord>): void {
        this.#usedTargets.push(record);
    }

    markScriptableSurfaceRequested(): void {
        this.#surfaceRequested = true;
    }

    fireScriptableBeforeScene(
        meshes: readonly Mesh[],
        enabled: boolean,
        fireRendererEvents: boolean
    ): void {
        if (!enabled) return;
        if (fireRendererEvents) {
            this.fire('beforeRender');
            this.fire('beforeRenderScene');
        }
        for (const mesh of meshes) mesh.fire('beforeRender', mesh);
    }

    recordScriptableShadows(
        meshes: readonly Mesh[],
        cacheMeshes: readonly Mesh[],
        camera: Camera,
        viewport: Readonly<RHIViewport>,
        width: number,
        height: number
    ): Readonly<ScriptableShadowAtlasBuild> | null {
        const resources = this.requireResources();
        const context = this.createContext(camera, viewport);
        this.ensureMeshFrame(context);
        return this.renderSceneShadows(resources, context, meshes, cacheMeshes, width, height);
    }

    recordScriptablePass(passCount: number): void {
        this.recordSceneBuild([], false, 0, passCount);
    }

    recordScriptableFaces(meshes: readonly Mesh[]): void {
        this.recordSceneBuild(meshes, false, 0, 0);
    }

    queueScriptableAfterScene(meshes: readonly Mesh[], enabled: boolean): void {
        if (enabled) this.queueAfterSceneEvents(meshes, true);
    }

    retainScriptablePresentation(scene: RendererScene, camera: Camera): void {
        this.#pendingPresentationStage = scene;
        this.#pendingPresentationCamera = camera;
    }

    private commitPendingPresentation(): void {
        const stage = this.#pendingPresentationStage;
        const camera = this.#pendingPresentationCamera;
        if (stage === null || camera === null) return;
        this.#lastStage = stage;
        this.#lastCamera = camera;
    }

    private synchronizeCacheDiagnosticsAfterFailure(): void {
        if (this.rendererDiagnosticsSink === null) return;
        this.synchronizeCacheDiagnostics();
    }

    override supportsTextureCompression(format: TextureCompressionFormat): boolean {
        const features = this.requireDevice().capabilities.features;
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

    override createStorageBuffer(descriptor: Readonly<StorageBufferDescriptor>): StorageBuffer {
        this.assertReadyForRender();
        this.assertNoFrameMutation('createStorageBuffer');
        const features = this.requireDevice().capabilities.features;
        if (
            this.backend !== 'webgpu' ||
            !features.has('storage-buffers') ||
            !features.has('compute-pipelines')
        ) {
            throw new Error('StorageBuffer is supported only by a compute-capable WebGPU renderer');
        }
        const buffer = new RendererStorageBuffer(this, descriptor);
        this.#storageBuffers.add(buffer);
        return buffer;
    }

    async warmupStorageGraphicsShaders(
        shaders: readonly StorageGraphicsShader[],
        batchSize = 4
    ): Promise<void> {
        if (this.#destroyed) throw new Error('Renderer is destroyed');
        if (this.#pipelineHost.recording) {
            throw new Error(
                'Storage graphics warmup is allowed only during pipeline initialization'
            );
        }
        if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
            throw new RangeError('Storage graphics warmup batchSize must be a positive integer');
        }
        const features = this.requireDevice().capabilities.features;
        if (
            this.backend !== 'webgpu' ||
            !features.has('storage-buffers') ||
            !features.has('compute-pipelines')
        ) {
            throw new Error('Storage graphics warmup requires a compute-capable WebGPU renderer');
        }
        const pipelines = this.requireResources().gpuDrivenPipelines;
        for (let index = 0; index < shaders.length; index += 1) {
            const shader = shaders[index];
            if (shader === undefined) throw new Error('Storage graphics warmup shader is missing');
            pipelines.resolveCompiledShader(shader);
            if ((index + 1) % batchSize === 0) await Promise.resolve();
        }
    }

    override createRenderTarget(parameters: RenderTargetParameters): RHIRenderTarget {
        this.assertReadyForRender();
        this.assertNoFrameMutation('createRenderTarget');
        const depth = parameters.depthStencilAttachment;
        const resolvedParameters =
            this.renderingProfile === 'high-end' &&
            depth !== false &&
            depth?.depthMode === undefined
                ? {
                      ...parameters,
                      depthStencilAttachment: { ...(depth ?? {}), depthMode: 'reversed' as const }
                  }
                : parameters;
        const target = new RHIRenderTarget(this, resolvedParameters);
        this.#renderTargets.add(target);
        return target;
    }

    override setRenderTarget(
        target: RenderTarget | null,
        options: RenderTargetSelectionOptions = {}
    ): this {
        this.assertNoFrameMutation('setRenderTarget');
        const resolved = target === null ? null : this.requireOwnedTarget(target);
        const previous = this.renderTarget;
        const destroyPrevious =
            this.#ownsRenderTarget && previous !== null && previous !== resolved;
        this.renderTarget = resolved;
        this.#ownsRenderTarget = resolved !== null && options.takeOwnership === true;
        this.#autoPresentRenderTarget = resolved !== null && options.present === true;
        this.#selectedTargetColorEncoding = resolvePresentationColorEncoding(options.colorEncoding);
        if (destroyPrevious) previous.destroy();
        return this;
    }

    override present(target?: RenderTarget, options: RenderTargetPresentationOptions = {}): void {
        const explicitColorEncoding =
            options.colorEncoding === undefined
                ? null
                : resolvePresentationColorEncoding(options.colorEncoding);
        this.recordFrameCommand(() => {
            const resolvedTarget = target ?? this.requireSelectedRenderTarget();
            const colorEncoding =
                explicitColorEncoding ??
                (resolvedTarget === this.renderTarget
                    ? this.#selectedTargetColorEncoding
                    : 'linear');
            this.presentInternal(resolvedTarget, colorEncoding);
        });
    }

    private presentInternal(target: RenderTarget, colorEncoding: RenderColorEncoding): void {
        const resolved = this.requireOwnedTarget(target);
        if (resolved.colorAttachmentCount === 0) {
            throw new TypeError('A depth-only render target cannot be presented');
        }
        const resources = this.requireResources();
        const context = this.createContext(
            this.#lastCamera ?? this.#fallbackCamera,
            this.surfaceViewport()
        );
        resources.postProcess.buildPresent(
            this.#pipelineHost.requireActiveScope(),
            context,
            this.requireSurface(),
            resolved.resourceRecord,
            { clearColor: this.clearColor, colorEncoding },
            this.#fullscreenFrameStarted
        );
        this.#fullscreenFrameStarted = true;
        this.#surfaceRequested = true;
        this.#applicationPassCount++;
        this.#usedTargets.push(resolved.resourceRecord);
    }

    override renderToTarget(
        target: RenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent = false
    ): void {
        this.prepareAddonRendererResources(stage, camera);
        this.recordFrameCommand(() => {
            this.#pipelineHost.recordPipeline(
                stage,
                camera,
                this.requireOwnedTarget(target),
                fireEvent
            );
        });
    }

    private prepareAddonRendererResources(scene: RendererScene, camera: Camera): void {
        scene.traverse(node => {
            const extension = getRenderNodeExtension(node);
            extension?.prepareRenderer?.(this);
            extension?.prepareView?.(camera);
        });
    }

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

    override async waitForIdle(): Promise<void> {
        await this.ready;
        const resources = this.#resources;
        const recovery = resources?.recovery.recoveryPromise;
        if (recovery !== null && recovery !== undefined) await recovery;
        if (resources !== null) {
            await Promise.all([
                resources.processor.submissions.waitForIdle(),
                resources.shadowRenderer.waitForIdle(),
                resources.postProcess.fullscreen.submissions.waitForIdle()
            ]);
        }
        await Promise.all([...this.#retiredResourceCleanups]);
        const device = this.#device;
        if (device !== null && !device.destroyed) {
            await device.graphicsQueue.onSubmittedWorkDone();
        }
    }

    override getExtension(name: string): object | null {
        if (name === 'rhi') return this.#rhiExtension;
        return (
            this.requireDevice().resolveInteropExtension?.(name, this.#executionInteropHost) ?? null
        );
    }

    override releaseGPUResources(): void {
        this.assertReadyForRender();
        this.assertNoFrameMutation('releaseGPUResources');
        this.destroyAllRenderTargets();
        this.retireRenderingResources();
        this.createRenderingResources(this.requireDevice());
    }

    override destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const failures: unknown[] = [];
        const attempt = (operation: () => void): void => {
            try {
                operation();
            } catch (error) {
                failures.push(error);
            }
        };
        attempt(() => {
            this.destroyAllRenderTargets();
        });
        attempt(() => {
            this.destroyAllStorageBuffers();
        });
        attempt(() => {
            this.#pipelineHost.destroy();
        });
        attempt(() => {
            this.retireRenderingResources();
        });
        attempt(() => this.#surface?.destroy());
        this.#surface = null;
        attempt(() => this.#device?.destroy());
        this.#device = null;
        this.#initialized = false;
        attempt(() => this.resourceManager.off('destroyMesh', this.#handleManagedMeshDestroy));
        attempt(() => this.resourceManager.clear());
        attempt(() => this.off());
        if (failures.length > 0) {
            throw new AggregateError(failures, 'Renderer failed while destroying owned resources');
        }
    }

    registerRenderTargetColorTexture(
        target: RHIRenderTarget,
        attachmentIndex: number,
        texture: Texture<unknown>
    ): () => void {
        const format = target.colorFormats[attachmentIndex];
        if (format === undefined) {
            throw new RangeError(
                `Render target color attachment ${String(attachmentIndex)} does not exist`
            );
        }
        const filterable =
            this.requireResources().processor.registry.deviceCapabilities.getTextureFormatCapabilities(
                format
            ).filterable;
        const filter = filterable ? 'linear' : 'nearest';
        return this.registerRenderTargetTextureBinding(
            target,
            attachmentIndex,
            texture,
            {
                label: `${target.label} color ${String(attachmentIndex)} sampler`,
                lifetime: 'persistent',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: filter,
                minFilter: filter,
                mipmapFilter: 'nearest',
                lodMinClamp: 0,
                lodMaxClamp: 0,
                maxAnisotropy: 1
            },
            null
        );
    }

    registerRenderTargetDepthTexture(
        target: RHIRenderTarget,
        texture: Texture<unknown>,
        compare: RenderTargetCompareFunction
    ): () => void {
        return this.registerRenderTargetTextureBinding(
            target,
            null,
            texture,
            {
                label: `${target.label} depth numeric sampler`,
                lifetime: 'persistent',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'nearest',
                minFilter: 'nearest',
                mipmapFilter: 'nearest',
                lodMinClamp: 0,
                lodMaxClamp: 0,
                maxAnisotropy: 1
            },
            {
                label: `${target.label} depth comparison sampler`,
                lifetime: 'persistent',
                addressModeU: 'clamp-to-edge',
                addressModeV: 'clamp-to-edge',
                addressModeW: 'clamp-to-edge',
                magFilter: 'nearest',
                minFilter: 'nearest',
                mipmapFilter: 'nearest',
                lodMinClamp: 0,
                lodMaxClamp: 0,
                compare,
                maxAnisotropy: 1
            }
        );
    }

    private registerRenderTargetTextureBinding(
        target: RHIRenderTarget,
        attachmentIndex: number | null,
        texture: Texture<unknown>,
        samplerDescriptor: Readonly<RHISamplerDescriptor> | null,
        comparisonSamplerDescriptor: Readonly<RHISamplerDescriptor> | null
    ): () => void {
        const registry = this.requireResources().processor.registry;
        const sampler =
            samplerDescriptor === null ? null : registry.registerSampler(samplerDescriptor);
        let comparisonSampler: ResourceRegistryHandle<RHISampler> | null = null;
        let provider: RenderTargetTextureBindingProvider | null = null;
        let unregister: () => void;
        try {
            comparisonSampler =
                comparisonSamplerDescriptor === null
                    ? null
                    : registry.registerSampler(comparisonSamplerDescriptor);
            provider = new RenderTargetTextureBindingProvider({
                target,
                attachmentIndex,
                texture,
                registry,
                sampler,
                comparisonSampler,
                getUploadBatch: this.#getActiveUploadBatch
            });
            unregister = externalTextureBindingRegistry.register(texture, provider);
            this.#renderTargetTextureBindings.add(provider);
        } catch (error) {
            if (comparisonSampler !== null) registry.discardUnsubmitted(comparisonSampler);
            if (sampler !== null) registry.discardUnsubmitted(sampler);
            throw error;
        }
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            unregister();
            this.#renderTargetTextureBindings.delete(provider);
            if (comparisonSampler !== null) registry.release(comparisonSampler);
            if (sampler !== null) registry.release(sampler);
        };
    }

    async readRenderTargetColorAttachment(
        target: RHIRenderTarget,
        options: RenderTargetReadColorAttachmentOptions = {}
    ): Promise<RenderTargetColorAttachmentReadback> {
        this.assertRenderTargetMutationAllowed('readback');
        this.assertReadyForRender();
        const resolved = this.requireOwnedTarget(target);
        const resources = this.requireResources();
        const context = this.createContext(this.#lastCamera ?? this.#fallbackCamera, {
            x: 0,
            y: 0,
            width: resolved.width,
            height: resolved.height,
            minDepth: 0,
            maxDepth: 1
        });
        return resources.readback.read(context, resolved.resourceRecord, options);
    }

    assertStorageBufferMutationAllowed(operation: string): void {
        this.assertNoFrameMutation(`storage-buffer ${operation}`);
    }

    storageBufferWritten(buffer: RendererStorageBuffer): void {
        this.requireOwnedStorageBuffer(buffer);
    }

    async readStorageBuffer(
        buffer: RendererStorageBuffer,
        byteOffset: number,
        byteLength: number
    ): Promise<StorageBufferReadback> {
        this.assertStorageBufferMutationAllowed('readback');
        this.assertReadyForRender();
        const source = this.requireOwnedStorageBuffer(buffer);
        const context = this.createContext(
            this.#lastCamera ?? this.#fallbackCamera,
            this.surfaceViewport()
        );
        return this.requireResources().storageReadback.read(
            context,
            source,
            byteOffset,
            byteLength
        );
    }

    storageBufferDestroyed(buffer: RendererStorageBuffer): void {
        if (!this.#storageBuffers.delete(buffer)) return;
        const resources = this.#resources;
        if (resources !== null) resources.storageBuffers.detach(buffer);
    }

    assertRenderTargetMutationAllowed(operation: string): void {
        this.assertNoFrameMutation(`render-target ${operation}`);
    }

    renderTargetResized(target: RHIRenderTarget): void {
        for (const provider of this.#renderTargetTextureBindings) {
            if (provider.target === target) provider.rebaseAllocation();
        }
    }

    renderTargetDestroyed(target: RHIRenderTarget): void {
        this.#renderTargets.delete(target);
        if (this.renderTarget !== target) return;
        this.renderTarget = null;
        this.#ownsRenderTarget = false;
        this.#autoPresentRenderTarget = false;
        this.#selectedTargetColorEncoding = 'linear';
    }

    private async initializeWebGL2(): Promise<void> {
        try {
            const canvas = this.requireCanvas();
            const device = constructRHIDevice('webgl2', {
                canvas,
                context: this.#webGLContextOptions,
                label: 'Hilo3d shared renderer WebGL2 RHI',
                ...(this.rendererDiagnosticsSink === null
                    ? {}
                    : { diagnosticsSink: this.rendererDiagnosticsSink })
            });
            this.adoptInitialDevice(device);
            await this.initializeRenderPipeline(device);
            this.fire('init');
        } catch (reason) {
            throw this.publishInitializationFailure(reason);
        }
    }

    private async initializeWebGPU(): Promise<void> {
        try {
            if (this.alpha && !this.premultipliedAlpha) {
                throw new Error('WebGPU canvas compositing requires premultiplied alpha');
            }
            this.requireCanvas();
            await Promise.all([
                this.#compiler.initialize(),
                this.#computeCompiler.initialize(),
                this.#storageGraphicsCompiler.initialize()
            ]);
            if (this.rendererWasDestroyed()) {
                throw new Error('Renderer initialization was cancelled');
            }
            const device = await createRHIDevice('webgpu', this.webGPUDeviceCreateOptions());
            if (this.rendererWasDestroyed()) {
                device.destroy();
                throw new Error('Renderer initialization was cancelled');
            }
            this.adoptInitialDevice(device);
            await this.initializeRenderPipeline(device);
            this.fire('init');
        } catch (reason) {
            throw this.publishInitializationFailure(reason);
        }
    }

    private adoptInitialDevice(device: RHIDevice): void {
        let surface: RHISurface | null = null;
        try {
            surface = device.createSurface(this.requireCanvas());
            this.#device = device;
            this.#surface = surface;
            this.configureSurface(surface);
            Shader.init(this);
            this.createRenderingResources(device);
        } catch (error) {
            surface?.destroy();
            device.destroy();
            this.#surface = null;
            this.#device = null;
            throw error;
        }
    }

    private async initializeRenderPipeline(device: RHIDevice): Promise<void> {
        await this.requireResources().postProcess.initialize();
        if (this.rendererWasDestroyed()) {
            throw new Error('Renderer initialization was cancelled');
        }
        await this.#pipelineHost.initialize(this.renderPipeline, device.capabilities);
        if (this.rendererWasDestroyed()) {
            throw new Error('Renderer initialization was cancelled');
        }
        this.#initialized = true;
        this.isInitFailed = false;
    }

    private createRenderingResources(device: RHIDevice): void {
        if (this.#resources !== null) {
            throw new Error('Renderer resources already exist');
        }
        const processor = new MeshDrawProcessor(this, device, this.#compiler);
        const targets = new RenderTargetResourceCache(processor.registry);
        const offscreen = new OffscreenRenderTargetRenderer(targets, processor.submissions);
        const postProcess = new PostProcessRenderer(targets, 0, this.#compiler);
        const readback = new RenderTargetReadback(targets, processor.submissions);
        const storageBuffers = new StorageBufferResourceCache(processor.registry);
        const storageReadback = new StorageBufferReadbackService(
            storageBuffers,
            processor.submissions
        );
        const computePipelines = new ComputePipelineResourceCache(
            processor.registry,
            this.#computeCompiler
        );
        const computeSamplers = new ComputeSamplerResourceCache(processor.registry);
        const gpuDrivenPipelines = new GPUDrivenPipelineResourceCache(
            processor.registry,
            this.#storageGraphicsCompiler
        );
        const scriptableBindGroups = new ScriptableBindGroupResourceCache(processor.registry);
        const shadowScene = new ShadowAtlasSceneAdapter();
        const shadowContent = new ShadowAtlasContentCache();
        const shadowUpdates = new ShadowAtlasUpdateScheduler({
            maxUpdatesPerFrame: this.renderingProfile === 'high-end' ? 8 : 4
        });
        const shadowPages = new ShadowAtlasPageResidency({
            pageSize: 128,
            maxPageUpdatesPerFrame: this.renderingProfile === 'high-end' ? 32 : 16
        });
        const shadowResources = new ShadowAtlasResourceCache(processor.registry);
        const shadowRenderer = new ShadowAtlasRenderer(
            processor.registry,
            0,
            0,
            undefined,
            offscreen.bridge
        );
        const shadowPreparer = new ShadowAtlasMeshPreparer(processor);
        const shadowBinding = new ShadowAtlasTextureBinding();
        const shadowClearShaders = Object.freeze({
            standard: new Shader({
                vs: shadowAtlasClearVertexSource('standard'),
                fs: SHADOW_ATLAS_CLEAR_FRAGMENT_SOURCE
            }),
            reversed: new Shader({
                vs: shadowAtlasClearVertexSource('reversed'),
                fs: SHADOW_ATLAS_CLEAR_FRAGMENT_SOURCE
            })
        });
        const shadowClearOwners = Object.freeze({
            standard: Object.freeze({ depthMode: 'standard' }),
            reversed: Object.freeze({ depthMode: 'reversed' })
        });
        const shadowClearTarget = {
            colorFormats: EMPTY_SHADOW_COLOR_FORMATS,
            depthStencilFormat: 'depth24plus' as const,
            sampleCount: 1 as const
        };
        const shadowOwner = Object.freeze({ renderer: this });
        const shadowPrepareOptions = {
            width: 1,
            height: 1,
            receiverDrivenResolution: this.renderingProfile === 'high-end',
            minimumResolution: 128,
            frameIndex: 0,
            cascadeUpdateIntervals:
                this.renderingProfile === 'high-end'
                    ? Object.freeze([1, 2, 4, 8])
                    : Object.freeze([1, 1, 1, 1])
        };
        const shadowRenderOptions = {
            label: 'Shadow atlas',
            preparer: shadowPreparer,
            depthClearValue: 1,
            dirtySlices: undefined,
            pageRegions: undefined,
            sliceClearDraw: undefined
        };
        const shadowViewport = {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            minDepth: 0,
            maxDepth: 1
        };
        const recovery = new RHIRecoveryCoordinator({
            device,
            registry: processor.registry,
            submissions: processor.submissions,
            createReplacementDevice: () => this.createReplacementDevice()
        });
        recovery.registerSubmissionTracker(postProcess.fullscreen.submissions);
        recovery.registerSubmissionTracker(shadowRenderer.submissions);
        recovery.registerSynchronizer(processor.buffers);
        recovery.registerSynchronizer(processor.textures);
        recovery.registerSynchronizer(processor.uniformBlocks);
        recovery.registerSynchronizer(postProcess.fullscreen);
        recovery.registerSynchronizer(storageBuffers);
        recovery.registerSynchronizer({
            synchronizeAfterRecovery: () => {
                shadowContent.invalidateAll();
                shadowPages.invalidateAll();
            }
        });
        recovery.registerSynchronizer({
            synchronizeAfterRecovery: () => {
                // Render-target pass contents are not recoverable from isolated public patches.
                // Preserve Texture identity but acknowledge history at the new allocation boundary.
                for (const provider of this.#renderTargetTextureBindings) {
                    provider.rebaseAllocation();
                }
            }
        });
        recovery.registerSynchronizer({
            synchronizeAfterRecovery: () => {
                this.adoptRecoveredDevice(recovery.device);
            }
        });
        recovery.addListener(event => {
            this.handleRecoveryEvent(event);
        });
        const renderingResources: RenderingResources = {
            processor,
            targets,
            offscreen,
            postProcess,
            readback,
            storageBuffers,
            storageReadback,
            computePipelines,
            computeSamplers,
            gpuDrivenPipelines,
            scriptableBindGroups,
            shadowScene,
            shadowContent,
            shadowUpdates,
            shadowPages,
            shadowResources,
            shadowRenderer,
            shadowPreparer,
            shadowBinding,
            shadowClearShaders,
            shadowClearOwners,
            shadowClearTarget,
            shadowOwner,
            shadowPrepareOptions,
            shadowRenderOptions,
            shadowViewport,
            recovery
        };
        this.#resources = renderingResources;
        this.bindCacheDiagnostics(device, renderingResources);
        this.renderList.orderedOnly = true;
        this.renderList.useInstanced = this.useInstanced;
    }

    private bindCacheDiagnostics(device: RHIDevice, resources: RenderingResources): void {
        if (this.rendererDiagnosticsSink === null) return;
        const pipelineMetrics = new RHICacheCounterAggregate([
            resources.processor.pipelines.metrics,
            resources.postProcess.fullscreen.pipelines.metrics
        ]);
        const bindGroupMetrics = new RHICacheCounterAggregate([
            resources.processor.bindGroups.metrics,
            resources.postProcess.fullscreen.bindGroups.metrics,
            resources.scriptableBindGroups.metrics
        ]);
        if (this.#pipelineCacheMetrics === null) {
            this.#pipelineCacheMetrics = new RHICacheCounterContinuation(pipelineMetrics);
        } else this.#pipelineCacheMetrics.rebind(pipelineMetrics);
        if (this.#bindGroupCacheMetrics === null) {
            this.#bindGroupCacheMetrics = new RHICacheCounterContinuation(bindGroupMetrics);
        } else this.#bindGroupCacheMetrics.rebind(bindGroupMetrics);
        if (this.#shadowAtlasCacheMetrics === null) {
            this.#shadowAtlasCacheMetrics = new RHICacheCounterContinuation(
                resources.shadowContent.metrics
            );
        } else this.#shadowAtlasCacheMetrics.rebind(resources.shadowContent.metrics);
        this.bindDeviceCacheDiagnostics(device, resources.processor);
    }

    private bindDeviceCacheDiagnostics(device: RHIDevice, processor: MeshDrawProcessor): void {
        if (this.rendererDiagnosticsSink === null) return;
        const vertexInputMetrics =
            device.vertexInputCacheMetrics ?? processor.vertexInputCacheMetrics;
        const framebufferMetrics = device.framebufferCacheMetrics;
        if (framebufferMetrics === null || framebufferMetrics === undefined) {
            throw new Error('RHI device does not expose framebuffer cache diagnostics');
        }
        if (this.#vertexInputCacheMetrics === null) {
            this.#vertexInputCacheMetrics = new RHICacheCounterContinuation(vertexInputMetrics);
        } else this.#vertexInputCacheMetrics.rebind(vertexInputMetrics);
        if (this.#framebufferCacheMetrics === null) {
            this.#framebufferCacheMetrics = new RHICacheCounterContinuation(framebufferMetrics);
        } else this.#framebufferCacheMetrics.rebind(framebufferMetrics);
    }

    private retireRenderingResources(): void {
        const resources = this.#resources;
        if (resources === null) return;
        this.#resources = null;
        const failures: unknown[] = [];
        const attempt = (operation: () => void): void => {
            try {
                operation();
            } catch (error) {
                failures.push(error);
            }
        };
        attempt(() => {
            resources.recovery.destroy();
        });
        attempt(() => {
            resources.offscreen.destroy();
        });
        attempt(() => {
            resources.readback.destroy();
        });
        attempt(() => {
            resources.storageReadback.destroy();
        });
        attempt(() => {
            resources.computePipelines.destroy();
        });
        attempt(() => {
            resources.computeSamplers.destroy();
        });
        attempt(() => {
            resources.gpuDrivenPipelines.destroy();
        });
        attempt(() => {
            resources.scriptableBindGroups.destroy();
        });
        attempt(() => {
            resources.storageBuffers.destroy();
        });
        attempt(() => {
            this.#scriptablePipelineResources.releasePersistentTargets(
                resources.targets,
                resources.processor.registry
            );
        });
        attempt(() => {
            resources.targets.destroy();
        });
        attempt(() => {
            resources.shadowBinding.destroy();
        });
        attempt(() => {
            resources.shadowContent.destroy();
        });
        attempt(() => {
            resources.shadowPages.destroy();
        });
        attempt(() => {
            resources.shadowPreparer.destroy();
        });
        attempt(() => {
            resources.shadowResources.destroy();
        });
        attempt(() => {
            resources.shadowScene.destroy();
        });
        attempt(() => {
            resources.shadowClearShaders.standard.destroy();
            resources.shadowClearShaders.reversed.destroy();
        });
        const cleanup = (async (): Promise<void> => {
            await Promise.allSettled([
                resources.processor.submissions.waitForIdle(),
                resources.shadowRenderer.waitForIdle(),
                resources.postProcess.fullscreen.submissions.waitForIdle()
            ]);
            resources.shadowRenderer.destroy();
            resources.postProcess.destroy();
            resources.processor.destroy();
        })();
        this.#retiredResourceCleanups.add(cleanup);
        void cleanup.then(
            () => this.#retiredResourceCleanups.delete(cleanup),
            () => this.#retiredResourceCleanups.delete(cleanup)
        );
        if (failures.length !== 0) {
            throw new AggregateError(failures, 'Renderer resources failed while being retired', {
                cause: failures[0]
            });
        }
    }

    private async createReplacementDevice(): Promise<RHIDevice> {
        if (this.rendererWasDestroyed()) throw new Error('Renderer recovery was cancelled');
        let replacement: RHIDevice;
        if (this.backend === 'webgpu') {
            replacement = await createRHIDevice('webgpu', this.webGPUDeviceCreateOptions());
        } else {
            await this.waitForWebGLContextRestored();
            if (this.rendererWasDestroyed()) throw new Error('Renderer recovery was cancelled');
            replacement = constructRHIDevice('webgl2', {
                canvas: this.requireCanvas(),
                context: this.#webGLContextOptions,
                label: 'Hilo3d recovered shared renderer WebGL2 RHI',
                ...(this.rendererDiagnosticsSink === null
                    ? {}
                    : { diagnosticsSink: this.rendererDiagnosticsSink })
            });
        }
        try {
            this.#pipelineHost.validateReplacementDevice(replacement.capabilities);
            return replacement;
        } catch (error) {
            replacement.destroy();
            throw error;
        }
    }

    private waitForWebGLContextRestored(): Promise<void> {
        return waitForWebGL2RHIContextRestored(this.requireCanvas(), this.#webGLContextOptions);
    }

    private webGPUDeviceCreateOptions(): Readonly<WebGPURHIDeviceCreateOptions> {
        this.#webGPUMipmapShaderArtifacts ??= prepareWebGPUMipmapShaderArtifacts(this.#compiler);
        return Object.freeze({
            ...this.#webGPUDeviceOptions,
            mipmapShaderArtifacts: this.#webGPUMipmapShaderArtifacts
        });
    }

    private adoptRecoveredDevice(device: RHIDevice): void {
        if (this.#destroyed) throw new Error('Renderer recovery was cancelled');
        const previousDevice = this.#device;
        const previousSurface = this.#surface;
        const surface = device.createSurface(this.requireCanvas());
        try {
            this.configureSurface(surface);
            this.#pipelineHost.adoptReplacementDevice(device.capabilities);
        } catch (error) {
            surface.destroy();
            throw error;
        }
        this.#device = device;
        this.#surface = surface;
        this.bindDeviceCacheDiagnostics(device, this.requireResources().processor);
        previousSurface?.destroy();
        if (previousDevice !== null && previousDevice !== device) previousDevice.destroy();
    }

    private handleRecoveryEvent(event: Readonly<RHIRecoveryCoordinatorEvent>): void {
        if (event.state === 'recovering') {
            this.#presentationViewport = null;
            this.dispatchLifecycleEvent('rhiDeviceLost', event.loss);
            this.dispatchLifecycleEvent(
                this.backend === 'webgl2' ? 'webglContextLost' : 'webgpuDeviceLost',
                event.loss
            );
            return;
        }
        if (event.state === 'ready' && event.attempt > 0) {
            this.dispatchLifecycleEvent('rhiDeviceRestored', event.device);
            this.dispatchLifecycleEvent(
                this.backend === 'webgl2' ? 'webglContextRestored' : 'webgpuDeviceRestored',
                event.device
            );
            return;
        }
        if (event.state === 'failed') {
            this.dispatchLifecycleEvent('rhiDeviceRecoveryFailed', event.error);
            if (this.backend === 'webgpu') {
                this.dispatchLifecycleEvent('webgpuDeviceRecoveryFailed', event.error);
            }
        }
    }

    private dispatchLifecycleEvent(type: string, detail: unknown): void {
        try {
            this.fire(type, detail);
        } catch (reason) {
            reportListenerFailure(reason);
        }
    }

    private renderSceneToTarget(
        target: RHIRenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent: boolean
    ): void {
        const resources = this.requireResources();
        const visible = this.prepareScene(stage, camera);
        const context = this.createContext(camera, {
            x: 0,
            y: 0,
            width: target.width,
            height: target.height,
            minDepth: 0,
            maxDepth: 1
        });
        this.ensureMeshFrame(context);
        const shadowBuild = this.renderSceneShadows(
            resources,
            context,
            visible,
            visible,
            target.width,
            target.height
        );
        const shadowPassCount = shadowBuild?.passCount ?? 0;
        const normalized = target.normalizedParameters;
        const depth = normalized.depthStencilAttachment;
        if (depth !== null && depth.depthMode !== camera.depthMode) {
            throw new TypeError(
                `Render target depth mode ${depth.depthMode} does not match camera depth mode ${camera.depthMode}`
            );
        }
        this.fireBeforeSceneEvents(visible, fireEvent);
        const record = resources.offscreen.build(
            this.#pipelineHost.requireActiveScope(),
            context,
            target,
            {
                label: target.label,
                width: target.width,
                height: target.height,
                colorFormats: target.colorFormats,
                sampleCount: target.sampleCount,
                depthStencilFormat: target.depthStencilFormat,
                depthStencilSampled: depth?.sampled ?? false
            },
            {
                classifiedMeshes: visible,
                meshProcessor: resources.processor,
                colorOperations: normalized.colorAttachments,
                ...(depth === null
                    ? {}
                    : {
                          depthLoadOp: depth.depthLoadOp,
                          depthStoreOp: depth.depthStoreOp,
                          clearDepth: depth.depthClearValue,
                          stencilLoadOp: depth.stencilLoadOp,
                          stencilStoreOp: depth.stencilStoreOp,
                          clearStencil: depth.stencilClearValue
                      })
            },
            true
        );
        this.#usedTargets.push(record);
        this.recordSceneBuild(visible, fireEvent, shadowPassCount);
    }

    private renderSceneShadows(
        resources: RenderingResources,
        context: RenderGraphFrameContext,
        meshes: readonly Mesh[],
        cacheMeshes: readonly Mesh[],
        defaultWidth: number,
        defaultHeight: number
    ): Readonly<ScriptableShadowAtlasBuild> | null {
        const prepareOptions = resources.shadowPrepareOptions;
        prepareOptions.width = positiveSurfaceDimension(defaultWidth, this.width);
        prepareOptions.height = positiveSurfaceDimension(defaultHeight, this.height);
        prepareOptions.frameIndex = context.frameIndex;

        // Frame planning resets LightManager's public atlas fields. Also remove the private active
        // binding before shadow preparation so any failure cannot revive last frame's atlas through
        // MeshDrawProcessor.beginFrame().
        resources.shadowBinding.detach(this.lightManager);
        this.#shadowBindingAttachedThisFrame = false;
        const plan = resources.shadowScene.prepare(
            this.lightManager,
            context.camera,
            resources.processor.registry.deviceCapabilities,
            prepareOptions
        );
        if (plan.atlas.sliceCount === 0) {
            const uploads = this.#pipelineHost.requireActiveScope().uploads;
            resources.shadowContent.stageEmpty(uploads);
            resources.shadowPages.stageEmpty(uploads);
            this.rendererDiagnosticsSink?.recordShadowScheduling({
                requestedSlices: 0,
                updatedSlices: 0,
                deferredSlices: 0,
                requestedPages: 0,
                updatedPages: 0,
                deferredPages: 0,
                residentPages: 0,
                budgetOverflowPages: 0
            });
            resources.shadowPreparer.retireAll(uploads);
            resources.shadowResources.detach(resources.shadowOwner);
            return null;
        }

        const atlas = resources.shadowResources.prepare(
            resources.shadowOwner,
            plan.atlas,
            context.camera.depthMode
        );
        const scope = this.#pipelineHost.requireActiveScope();
        const content = resources.shadowContent.stage(atlas, plan, cacheMeshes, scope.uploads);
        const updates = resources.shadowUpdates.schedule(plan, content, context.frameIndex);
        const pages = resources.shadowPages.stage(
            plan,
            content,
            updates.scheduledSlices,
            scope.uploads
        );
        let completedUpdateCount = 0;
        for (let index = 0; index < content.sliceCount; index += 1) {
            if (content.dirtySlices[index] === true && pages.completedSlices[index] === true) {
                completedUpdateCount++;
            }
        }
        this.rendererDiagnosticsSink?.recordShadowScheduling({
            requestedSlices: updates.requestedUpdateCount,
            updatedSlices: completedUpdateCount,
            deferredSlices: updates.requestedUpdateCount - completedUpdateCount,
            requestedPages: pages.requestedPageCount,
            updatedPages: pages.scheduledPageCount,
            deferredPages: pages.deferredPageCount,
            residentPages: pages.residentPageCount,
            budgetOverflowPages: pages.budgetOverflowCount
        });
        resources.shadowContent.deferUnscheduled(pages.completedSlices);
        resources.shadowRenderOptions.depthClearValue = depthClearValue(context.camera.depthMode);
        resources.shadowRenderOptions.dirtySlices = updates.scheduledSlices;
        resources.shadowRenderOptions.pageRegions = pages.updateRegions;
        if (pages.scheduledPageCount > 0) {
            this.beginScriptableFullscreenPass(context);
            const depthMode = context.camera.depthMode;
            resources.shadowClearTarget.depthStencilFormat = plan.atlas.format;
            resources.shadowRenderOptions.sliceClearDraw = resources.postProcess.fullscreen.prepare(
                {
                    owner: resources.shadowClearOwners[depthMode],
                    shader: resources.shadowClearShaders[depthMode],
                    pipelineState: SHADOW_ATLAS_CLEAR_PIPELINE_STATE,
                    target: resources.shadowClearTarget,
                    fragmentOutputMode: 'depth-only',
                    depthMode
                }
            );
        } else resources.shadowRenderOptions.sliceClearDraw = undefined;
        resources.shadowPreparer.configure(plan, meshes);
        const viewport = resources.shadowViewport;
        viewport.width = atlas.width;
        viewport.height = atlas.height;
        const build = resources.shadowRenderer.build(
            scope,
            context,
            atlas,
            plan.atlas,
            resources.shadowRenderOptions,
            true,
            resources.processor.resourceUses
        );
        resources.shadowBinding.update(atlas);
        resources.shadowBinding.attach(this.lightManager, plan);
        this.#shadowBindingAttachedThisFrame = true;
        return Object.freeze({
            passCount: build.passCount,
            texture: build.texture,
            atlas,
            plan,
            dirtySlices: updates.scheduledSlices,
            pageRegions: pages.updateRegions
        });
    }

    private prepareScene(stage: RendererScene, camera: Camera): readonly Mesh[] {
        if (!this.#pipelineHost.recording) this.resetDiagnosticsFrame();
        this.configureCameraProfile(camera);
        this.fog = stage.fog ?? null;
        stage.updateMatrixWorld();
        camera.updateViewProjectionMatrix();
        this.buildFramePlan(stage, camera);
        const visible = this.#visibleMeshes;
        visible.length = 0;
        this.renderList.traverse(this.#collectVisibleMesh);
        return visible;
    }

    private configureCameraProfile(camera: Camera): void {
        if (this.renderingProfile === 'high-end') camera.depthMode = 'reversed';
    }

    private executeRetainedPresentation(): void {
        const stage = this.#lastStage;
        const camera = this.#lastCamera;
        if (stage === null || camera === null) {
            throw new Error('No completed presentation inputs are available for repetition');
        }
        this.render(stage, camera, false);
    }

    private setPresentationViewport(viewport: Readonly<RHIViewport> | null): void {
        this.assertPresentationMutationAllowed('change the presentation viewport');
        this.#presentationViewport =
            viewport === null
                ? null
                : Object.freeze({
                      x: viewport.x,
                      y: viewport.y,
                      width: viewport.width,
                      height: viewport.height,
                      minDepth: viewport.minDepth,
                      maxDepth: viewport.maxDepth
                  });
    }

    private assertPresentationMutationAllowed(operation: string): void {
        if (this.#pipelineHost.recording) {
            throw new Error(`Cannot ${operation} during an active frame`);
        }
    }

    private ensureMeshFrame(context: RenderGraphFrameContext): void {
        const resources = this.requireResources();
        if (!this.#meshFrameStarted) {
            resources.processor.beginFrame(
                context,
                this.#pipelineHost.requireActiveScope().uploads
            );
            this.#meshFrameStarted = true;
            this.#meshSemanticFrameStarted = true;
            return;
        }
        if (!this.#meshSemanticFrameStarted) {
            resources.processor.beginSemanticFrame(context);
            this.#meshSemanticFrameStarted = true;
        } else {
            resources.processor.beginContextPass(context);
        }
    }

    private recordSceneBuild(
        meshes: readonly Mesh[],
        fireEvent: boolean,
        shadowPassCount: number,
        passCountOverride?: number
    ): void {
        let faces = 0;
        let hasTransparent = false;
        for (const mesh of meshes) {
            faces += countMeshFaces(mesh);
            if (mesh.material?.forwardQueue === 'transparent') hasTransparent = true;
        }
        this.#applicationFaceCount += faces;
        this.#applicationPassCount +=
            passCountOverride ?? shadowPassCount + (hasTransparent ? 2 : 1);
        if (!fireEvent) return;
        this.queueAfterSceneEvents(meshes);
    }

    private queueAfterSceneEvents(meshes: readonly Mesh[], retainReference = false): void {
        let pending = this.#afterSceneEvents[this.#afterSceneEventCount];
        if (pending === undefined) {
            pending = { meshes: [], source: null };
            this.#afterSceneEvents.push(pending);
        }
        const snapshot = pending.meshes;
        pending.source = retainReference ? meshes : null;
        if (retainReference) snapshot.length = 0;
        else {
            snapshot.length = meshes.length;
            for (let index = 0; index < meshes.length; index += 1) {
                const mesh = meshes[index];
                if (mesh !== undefined) snapshot[index] = mesh;
            }
        }
        this.#afterSceneEventCount++;
    }

    private clearAfterSceneEvents(): void {
        for (let index = 0; index < this.#afterSceneEventCount; index += 1) {
            const pending = this.#afterSceneEvents[index];
            if (pending !== undefined) {
                pending.meshes.length = 0;
                pending.source = null;
            }
        }
        this.#afterSceneEventCount = 0;
    }

    private hasFullscreenFrameWork(): boolean {
        return this.#fullscreenFrameStarted;
    }

    private hasSurfaceWork(): boolean {
        return this.#surfaceRequested;
    }

    private hasAttachedShadowBinding(): boolean {
        return this.#shadowBindingAttachedThisFrame;
    }

    private fireBeforeSceneEvents(meshes: readonly Mesh[], enabled: boolean): void {
        if (!enabled) return;
        this.fire('beforeRender');
        this.fire('beforeRenderScene');
        for (const mesh of meshes) mesh.fire('beforeRender', mesh);
    }

    private fireAfterSceneEvents(meshes: readonly Mesh[], enabled: boolean): void {
        if (!enabled) return;
        for (const mesh of meshes) mesh.fire('afterRender', mesh);
        this.fire('afterRender');
    }

    private recordExecutionDiagnostics(
        diagnostics: Readonly<{
            readonly drawCount: number;
            readonly indirectDrawCount: number;
            readonly dispatchCount: number;
            readonly dispatchedWorkgroupCount: number;
            readonly bufferClearCount: number;
            readonly commandCount: number;
            readonly pipelineSwitches: number;
            readonly bindGroupSwitches: number;
            readonly vertexBufferSwitches: number;
            readonly computePipelineSwitches: number;
            readonly computeBindGroupSwitches: number;
            readonly nativeStateCalls: number;
            readonly frameArenaGrowths: number;
        }>,
        passCount: number,
        uploadCount: number
    ): void {
        const sink = this.rendererDiagnosticsSink;
        if (sink === null) return;
        if (diagnostics.drawCount > 0) sink.recordDraw(diagnostics.drawCount);
        if (diagnostics.indirectDrawCount > 0) {
            sink.recordIndirectDraw(diagnostics.indirectDrawCount);
        }
        if (diagnostics.dispatchCount > 0) sink.recordDispatch(diagnostics.dispatchCount);
        if (diagnostics.dispatchedWorkgroupCount > 0) {
            sink.recordDispatchedWorkgroup(diagnostics.dispatchedWorkgroupCount);
        }
        if (diagnostics.bufferClearCount > 0) {
            sink.recordBufferClear(diagnostics.bufferClearCount);
        }
        if (diagnostics.commandCount > 0) sink.recordCommand(diagnostics.commandCount);
        if (passCount > 0) sink.recordPass(passCount);
        const stateChanges =
            diagnostics.pipelineSwitches +
            diagnostics.bindGroupSwitches +
            diagnostics.vertexBufferSwitches +
            diagnostics.nativeStateCalls;
        if (stateChanges > 0) sink.recordStateChange(stateChanges);
        if (diagnostics.computePipelineSwitches > 0) {
            sink.recordComputePipelineSwitch(diagnostics.computePipelineSwitches);
        }
        if (diagnostics.computeBindGroupSwitches > 0) {
            sink.recordComputeBindGroupSwitch(diagnostics.computeBindGroupSwitches);
        }
        if (uploadCount > 0) sink.recordUpload(uploadCount);
        if (diagnostics.frameArenaGrowths > 0) {
            sink.recordArenaGrowth(diagnostics.frameArenaGrowths);
        }
        sink.recordSubmission();
        this.synchronizeCacheDiagnostics();
    }

    private synchronizeCacheDiagnostics(): void {
        const sink = this.rendererDiagnosticsSink;
        if (sink === null) return;
        const pipeline = this.#pipelineCacheMetrics;
        const bindGroup = this.#bindGroupCacheMetrics;
        const vertexInput = this.#vertexInputCacheMetrics;
        const framebuffer = this.#framebufferCacheMetrics;
        const shadowAtlas = this.#shadowAtlasCacheMetrics;
        if (
            pipeline === null ||
            bindGroup === null ||
            vertexInput === null ||
            framebuffer === null ||
            shadowAtlas === null
        ) {
            throw new Error('Renderer cache diagnostics are not initialized');
        }
        sink.synchronizeCache('pipeline', pipeline);
        sink.synchronizeCache('bindGroup', bindGroup);
        sink.synchronizeCache('vertexArray', vertexInput);
        sink.synchronizeCache('framebuffer', framebuffer);
        sink.synchronizeCache('shadowAtlas', shadowAtlas);
    }

    private createContext(
        camera: Camera,
        viewport: RenderGraphFrameContext['viewport'],
        frameIndex = this.#pipelineHost.activeFrameIndex ?? this.#pipelineHost.allocateFrameIndex()
    ): RenderGraphFrameContext {
        return createRenderGraphFrameContext({
            renderer: this,
            rhi: this.requireDevice(),
            frameIndex,
            camera,
            lightManager: this.lightManager,
            fog: this.fog,
            viewport: { ...viewport }
        });
    }

    private surfaceViewport(): RenderGraphFrameContext['viewport'] {
        const presentation = this.#presentationViewport;
        if (presentation !== null) return { ...presentation };
        const configuration = this.#surface?.configuration;
        return {
            x: this.offsetX,
            y: this.offsetY,
            width:
                configuration?.width ??
                positiveSurfaceDimension(this.width, this.domElement?.width ?? 0),
            height:
                configuration?.height ??
                positiveSurfaceDimension(this.height, this.domElement?.height ?? 0),
            minDepth: 0,
            maxDepth: 1
        };
    }

    private configureSurface(surface: RHISurface): void {
        const canvas = this.requireCanvas();
        const width = positiveSurfaceDimension(this.width, canvas.width);
        const height = positiveSurfaceDimension(this.height, canvas.height);
        surface.configure({
            format: 'rgba8unorm',
            depthStencilFormat:
                this.depth || this.stencil
                    ? this.stencil
                        ? 'depth24plus-stencil8'
                        : 'depth24plus'
                    : null,
            width,
            height,
            usage: RHITextureUsage.RENDER_ATTACHMENT,
            alphaMode: this.alpha ? 'premultiplied' : 'opaque'
        });
    }

    private destroyAllRenderTargets(): void {
        const targets = [...this.#renderTargets];
        for (const target of targets) target.destroy();
        this.#renderTargets.clear();
        this.renderTarget = null;
        this.#ownsRenderTarget = false;
        this.#autoPresentRenderTarget = false;
        this.#selectedTargetColorEncoding = 'linear';
    }

    private destroyAllStorageBuffers(): void {
        for (const buffer of [...this.#storageBuffers]) buffer.destroy();
        this.#storageBuffers.clear();
    }

    private requireOwnedStorageBuffer(buffer: RendererStorageBuffer): RendererStorageBuffer {
        if (!(buffer instanceof RendererStorageBuffer) || !this.#storageBuffers.has(buffer)) {
            throw new TypeError('StorageBuffer belongs to a different renderer');
        }
        if (buffer.isDestroyed) throw new Error('Cannot use a destroyed StorageBuffer');
        return buffer;
    }

    private requireOwnedTarget(target: RenderTarget): RHIRenderTarget {
        if (!(target instanceof RHIRenderTarget) || !target.belongsTo(this)) {
            throw new TypeError('Render target belongs to a different renderer');
        }
        if (target.isDestroyed) throw new Error('Cannot use a destroyed render target');
        return target;
    }

    private requireSelectedRenderTarget(): RHIRenderTarget {
        const target = this.renderTarget;
        if (target === null) throw new Error('No render target is selected');
        return target;
    }

    private requireCanvas(): HTMLCanvasElement {
        const canvas = this.domElement;
        if (canvas === null) throw new Error(`${this.backend} renderer requires a canvas`);
        return canvas;
    }

    private requireDevice(): RHIDevice {
        const device = this.#device;
        if (device === null || device.destroyed) {
            throw new Error('Renderer RHI device is unavailable');
        }
        return device;
    }

    private requireSurface(): RHISurface {
        const surface = this.#surface;
        if (surface === null || surface.destroyed) {
            throw new Error('Renderer RHI surface is unavailable');
        }
        return surface;
    }

    private requireResources(): RenderingResources {
        const resources = this.#resources;
        if (resources === null) throw new Error('Renderer resources are unavailable');
        return resources;
    }

    private assertReadyForRender(): void {
        if (this.#destroyed) throw new Error('Renderer is destroyed');
        const resources = this.#resources;
        if (resources?.recovery.state === 'recovering') throw new RendererRecoveringError();
        if (resources?.recovery.state === 'failed') {
            throw new Error('Renderer device recovery failed', {
                cause: resources.recovery.failure ?? undefined
            });
        }
        if (!this.isReady) {
            throw new Error(`${this.backend} renderer is not ready; await renderer.ready`);
        }
    }

    private assertNoFrameMutation(operation: string): void {
        const resources = this.#resources;
        if (
            this.#pipelineHost.recording ||
            resources?.offscreen.active === true ||
            resources?.shadowRenderer.active === true ||
            resources?.postProcess.active === true ||
            resources?.readback.frame.active === true ||
            resources?.storageReadback.frame.active === true
        ) {
            const error = new Error(`Renderer ${operation} cannot run while a frame is active`);
            this.#pipelineHost.abort(error);
            throw error;
        }
    }

    private publishInitializationFailure(reason: unknown): Error {
        const failure = asError(reason, `${this.backend} renderer initialization failed`);
        this.isInitFailed = true;
        this.#initialized = false;
        this.#surface?.destroy();
        this.#surface = null;
        this.#device?.destroy();
        this.#device = null;
        queueMicrotask(() => {
            if (!this.#destroyed) this.dispatchLifecycleEvent('initFailed', failure);
        });
        return failure;
    }

    private rendererWasDestroyed(): boolean {
        return this.#destroyed;
    }
}

export default SharedRendererDriver;
