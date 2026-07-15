import Camera from '../../camera/Camera';
import type Mesh from '../../core/Mesh';
import type { DispatchEvent } from '../../core/EventDispatcher';
import { LINES, LINE_STRIP, TRIANGLES, TRIANGLE_STRIP } from '../../constants/webgl';
import type Texture from '../../texture/Texture';
import Shader from '../../shader/Shader';
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
import type {
    RenderTarget,
    RenderTargetColorAttachmentReadback,
    RenderTargetCompareFunction,
    RenderTargetParameters,
    RenderTargetReadColorAttachmentOptions,
    RenderTargetSelectionOptions
} from '../RenderTarget';
import { RenderGraphFrame, type RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import {
    createRenderGraphFrameContext,
    type RenderGraphFrameContext
} from '../frame/RenderGraphFrameContext';
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
import { ForwardRenderer } from '../renderer/ForwardRenderer';
import { MeshDrawProcessor } from '../renderer/MeshDrawProcessor';
import { OffscreenRenderTargetRenderer } from '../renderer/OffscreenRenderTargetRenderer';
import { PostProcessRenderer } from '../renderer/PostProcessRenderer';
import {
    RHIRecoveryCoordinator,
    type RHIRecoveryCoordinatorEvent
} from '../renderer/RHIRecoveryCoordinator';
import { RHIRenderTarget, type RHIRenderTargetHost } from '../renderer/RHIRenderTarget';
import { RenderTargetReadback } from '../renderer/RenderTargetReadback';
import {
    RenderTargetResourceCache,
    type RenderTargetResourceRecord
} from '../renderer/RenderTargetResourceCache';
import { RenderTargetTextureBindingProvider } from '../renderer/RenderTargetTextureBindingProvider';
import { RendererRecoveringError, type ResourceRegistryHandle } from '../renderer/ResourceRegistry';
import { ShaderArtifactCompiler } from '../renderer/ShaderArtifactCompiler';
import { ShadowAtlasMeshPreparer } from '../renderer/ShadowAtlasMeshPreparer';
import { ShadowAtlasRenderer } from '../renderer/ShadowAtlasRenderer';
import { ShadowAtlasResourceCache } from '../renderer/ShadowAtlasResourceCache';
import { ShadowAtlasSceneAdapter } from '../renderer/ShadowAtlasSceneAdapter';
import { ShadowAtlasTextureBinding } from '../renderer/ShadowAtlasTextureBinding';

type SharedRendererOptions =
    Omit<RendererWebGL2Options, 'backend'> | Omit<RendererWebGPUOptions, 'backend'>;

interface RenderingResources {
    readonly processor: MeshDrawProcessor;
    readonly forward: ForwardRenderer;
    readonly targets: RenderTargetResourceCache;
    readonly offscreen: OffscreenRenderTargetRenderer;
    readonly postProcess: PostProcessRenderer;
    readonly readback: RenderTargetReadback;
    readonly shadowScene: ShadowAtlasSceneAdapter;
    readonly shadowResources: ShadowAtlasResourceCache;
    readonly shadowRenderer: ShadowAtlasRenderer;
    readonly shadowPreparer: ShadowAtlasMeshPreparer;
    readonly shadowBinding: ShadowAtlasTextureBinding;
    readonly shadowOwner: object;
    readonly shadowPrepareOptions: { width: number; height: number };
    readonly shadowRenderOptions: Readonly<{
        label: string;
        preparer: ShadowAtlasMeshPreparer;
    }>;
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

const OPTIONAL_WEBGPU_FEATURES: readonly RHIRequestableWebGPUFeature[] = Object.freeze([
    'float32-filterable',
    'texture-compression-bc',
    'texture-compression-etc2',
    'texture-compression-astc'
]);

const REQUESTABLE_WEBGPU_FEATURES = new Set<string>([
    ...OPTIONAL_WEBGPU_FEATURES,
    'timestamp-query',
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
class SharedRendererDriver extends RendererCore implements RHIRenderTargetHost {
    override readonly className = 'Renderer' as const;
    override readonly backend: RendererBackend;
    override readonly ready: Promise<void>;
    override renderTarget: RHIRenderTarget | null = null;

    preserveDrawingBuffer = false;
    powerPreference: RendererContextPowerPreference = 'default';
    forceFallbackAdapter = false;
    requiredFeatures: readonly RendererFeatureName[] = Object.freeze([]);
    requiredLimits: Readonly<Record<string, number>> = Object.freeze({});

    readonly #compiler = new ShaderArtifactCompiler();
    readonly #fallbackCamera = new Camera();
    readonly #applicationFrame = new RenderGraphFrame();
    readonly #visibleMeshes: Mesh[] = [];
    readonly #collectVisibleMesh = (mesh: Mesh): void => {
        this.#visibleMeshes.push(mesh);
    };
    readonly #renderTargets = new Set<RHIRenderTarget>();
    readonly #renderTargetTextureBindings = new Set<RenderTargetTextureBindingProvider>();
    readonly #getActiveUploadBatch = () => this.requireActiveFrameScope().uploads;
    readonly #retiredResourceCleanups = new Set<Promise<void>>();
    readonly #webGPUDeviceOptions: Readonly<WebGPURHIDeviceCreateOptions>;
    readonly #webGLContextOptions: Readonly<NonNullable<RendererWebGL2Options>>;
    readonly #rhiExtension: object;
    readonly #executionInteropHost: RHIExecutionInteropHost;

    #device: RHIDevice | null = null;
    #surface: RHISurface | null = null;
    #resources: RenderingResources | null = null;
    #lastStage: RendererScene | null = null;
    #lastCamera: Camera | null = null;
    #pendingPresentationStage: RendererScene | null = null;
    #pendingPresentationCamera: Camera | null = null;
    #presentationViewport: Readonly<RHIViewport> | null = null;
    #frameIndex = 0;
    #initialized = false;
    #destroyed = false;
    #frameRecording = false;
    #activeFrameScope: RenderGraphFrameBuildScope | null = null;
    #activeFrameIndex: number | null = null;
    #frameAbortReason: unknown;
    #frameAborted = false;
    #meshFrameStarted = false;
    #fullscreenFrameStarted = false;
    #surfaceRequested = false;
    #shadowBindingAttachedThisFrame = false;
    #applicationPassCount = 0;
    #applicationFaceCount = 0;
    readonly #usedTargets: RenderTargetResourceRecord[] = [];
    readonly #afterSceneEvents: { readonly meshes: Mesh[] }[] = [];
    #afterSceneEventCount = 0;
    #ownsRenderTarget = false;
    #autoPresentRenderTarget = false;
    #pipelineCacheMetrics: RHICacheCounterContinuation | null = null;
    #bindGroupCacheMetrics: RHICacheCounterContinuation | null = null;
    #vertexInputCacheMetrics: RHICacheCounterContinuation | null = null;
    #framebufferCacheMetrics: RHICacheCounterContinuation | null = null;

    readonly #handleManagedMeshDestroy = (event: DispatchEvent): void => {
        const mesh = event.detail;
        if (typeof mesh !== 'object' || mesh === null) return;
        const resources = this.#resources;
        if (resources === null) return;
        resources.forward.detachMesh(mesh as Mesh);
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
            // the destination of the WebGL multisample resolve used by ForwardRenderer.
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

        if (backend === 'webgl2') {
            try {
                this.initializeWebGL2();
                this.ready = Promise.resolve();
                queueMicrotask(() => {
                    if (!this.#destroyed && this.#initialized) this.fire('init');
                });
            } catch (reason) {
                const failure = this.publishInitializationFailure(reason);
                this.ready = Promise.reject(failure);
            }
        } else {
            this.ready = this.initializeWebGPU();
        }
    }

    override get isReady(): boolean {
        return (
            this.#initialized &&
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
        this.recordFrameCommand(() => {
            const selected = this.renderTarget;
            if (selected !== null) {
                this.renderSceneToTarget(selected, stage, camera, fireEvent);
                if (this.#autoPresentRenderTarget) this.presentInternal(selected);
                return;
            }
            this.renderSceneToSurface(stage, camera, fireEvent);
        });
    }

    override renderFrame(callback: RendererFrameCallback): void {
        this.assertReadyForRender();
        if (this.#frameRecording) {
            const error = new Error('Nested renderer frames are not supported');
            this.abortApplicationFrame(error);
            throw error;
        }
        this.executeApplicationFrame(() => {
            let facadeActive = true;
            try {
                invokeRendererFrameCallback(
                    callback,
                    createRendererFrame(this, () => facadeActive && this.#frameRecording)
                );
            } finally {
                facadeActive = false;
            }
        });
    }

    private recordFrameCommand(command: () => void): void {
        this.assertReadyForRender();
        if (!this.#frameRecording) {
            this.executeApplicationFrame(command);
            return;
        }
        if (this.#frameAborted) throw this.createFrameAbortedError();
        try {
            command();
        } catch (error) {
            this.abortApplicationFrame(error);
            throw error;
        }
    }

    private executeApplicationFrame(record: () => void): void {
        this.assertReadyForRender();
        if (this.#frameRecording) throw new Error('Nested renderer frames are not supported');
        const resources = this.requireResources();
        const frameIndex = this.allocateFrameIndex();
        this.resetDiagnosticsFrame();
        this.#frameRecording = true;
        this.#activeFrameIndex = frameIndex;
        this.#frameAborted = false;
        this.#frameAbortReason = undefined;
        this.#meshFrameStarted = false;
        this.#fullscreenFrameStarted = false;
        this.#surfaceRequested = false;
        this.#shadowBindingAttachedThisFrame = false;
        this.#applicationPassCount = 0;
        this.#applicationFaceCount = 0;
        this.#pendingPresentationStage = null;
        this.#pendingPresentationCamera = null;
        this.#usedTargets.length = 0;
        this.clearAfterSceneEvents();
        resources.forward.beginComposition();
        resources.offscreen.beginComposition();
        resources.shadowRenderer.beginComposition();
        resources.postProcess.beginComposition();
        const context = this.createContext(
            this.#lastCamera ?? this.#fallbackCamera,
            this.surfaceViewport()
        );
        let completed = false;
        try {
            const execution = this.#applicationFrame.execute(context, scope => {
                this.#activeFrameScope = scope;
                try {
                    record();
                    if (this.#frameAborted) throw this.createFrameAbortedError();
                } finally {
                    this.#activeFrameScope = null;
                }
            });
            for (const target of this.#usedTargets) {
                resources.targets.markUsed(target, frameIndex);
            }
            void resources.processor.submissions.track(frameIndex, execution.submission);
            if (this.hasFullscreenFrameWork()) {
                void resources.postProcess.fullscreen.trackSubmission(
                    frameIndex,
                    execution.submission
                );
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
                this.#applicationFrame.uploads.pendingCount
            );
            for (let index = 0; index < this.#afterSceneEventCount; index += 1) {
                const pending = this.#afterSceneEvents[index];
                if (pending !== undefined) this.fireAfterSceneEvents(pending.meshes, true);
            }
            this.commitPendingPresentation();
            completed = true;
        } catch (error) {
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
            throw error;
        } finally {
            this.#activeFrameScope = null;
            resources.postProcess.endComposition();
            resources.shadowRenderer.endComposition();
            resources.offscreen.endComposition();
            resources.forward.endComposition();
            this.clearAfterSceneEvents();
            this.#usedTargets.length = 0;
            this.#frameRecording = false;
            this.#activeFrameIndex = null;
            this.#frameAborted = false;
            this.#frameAbortReason = undefined;
            this.#meshFrameStarted = false;
            this.#fullscreenFrameStarted = false;
            this.#surfaceRequested = false;
            this.#shadowBindingAttachedThisFrame = false;
            this.#pendingPresentationStage = null;
            this.#pendingPresentationCamera = null;
            if (!completed) this.synchronizeCacheDiagnosticsAfterFailure();
        }
    }

    private abortApplicationFrame(reason: unknown): void {
        if (!this.#frameRecording || this.#frameAborted) return;
        this.#frameAborted = true;
        this.#frameAbortReason = reason;
    }

    private commitPendingPresentation(): void {
        const stage = this.#pendingPresentationStage;
        const camera = this.#pendingPresentationCamera;
        if (stage === null || camera === null) return;
        this.#lastStage = stage;
        this.#lastCamera = camera;
    }

    private createFrameAbortedError(): Error {
        return new Error('Renderer frame recording was aborted after a command failed', {
            cause: this.#frameAbortReason
        });
    }

    private requireActiveFrameScope(): RenderGraphFrameBuildScope {
        const scope = this.#activeFrameScope;
        if (scope === null) throw new Error('Renderer graph build requires an active frame');
        return scope;
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

    override createRenderTarget(parameters: RenderTargetParameters): RHIRenderTarget {
        this.assertReadyForRender();
        this.assertNoFrameMutation('createRenderTarget');
        const target = new RHIRenderTarget(this, parameters);
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
        if (destroyPrevious) previous.destroy();
        return this;
    }

    override present(target?: RenderTarget): void {
        this.recordFrameCommand(() => {
            this.presentInternal(target ?? this.requireSelectedRenderTarget());
        });
    }

    private presentInternal(target: RenderTarget): void {
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
            this.requireActiveFrameScope(),
            context,
            this.requireSurface(),
            resolved.resourceRecord,
            { clearColor: this.clearColor },
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
        this.recordFrameCommand(() => {
            this.renderSceneToTarget(this.requireOwnedTarget(target), stage, camera, fireEvent);
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
        this.destroyAllRenderTargets();
        this.retireRenderingResources();
        this.#surface?.destroy();
        this.#surface = null;
        this.#device?.destroy();
        this.#device = null;
        this.#applicationFrame.destroy();
        this.#initialized = false;
        this.resourceManager.off('destroyMesh', this.#handleManagedMeshDestroy);
        this.resourceManager.clear();
        this.off();
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
    }

    private initializeWebGL2(): void {
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
    }

    private async initializeWebGPU(): Promise<void> {
        try {
            if (this.alpha && !this.premultipliedAlpha) {
                throw new Error('WebGPU canvas compositing requires premultiplied alpha');
            }
            this.requireCanvas();
            await this.#compiler.initialize();
            if (this.rendererWasDestroyed()) {
                throw new Error('Renderer initialization was cancelled');
            }
            const device = await createRHIDevice('webgpu', this.#webGPUDeviceOptions);
            if (this.rendererWasDestroyed()) {
                device.destroy();
                throw new Error('Renderer initialization was cancelled');
            }
            this.adoptInitialDevice(device);
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
            this.#initialized = true;
            this.isInitFailed = false;
        } catch (error) {
            surface?.destroy();
            device.destroy();
            this.#surface = null;
            this.#device = null;
            throw error;
        }
    }

    private createRenderingResources(device: RHIDevice): void {
        if (this.#resources !== null) {
            throw new Error('Renderer resources already exist');
        }
        const processor = new MeshDrawProcessor(this, device, this.#compiler);
        const targets = new RenderTargetResourceCache(processor.registry);
        const offscreen = new OffscreenRenderTargetRenderer(targets, processor.submissions);
        const forward = new ForwardRenderer(0, undefined, offscreen.bridge);
        const postProcess = new PostProcessRenderer(targets, 0, this.#compiler);
        // The shared compiler was initialized before a WebGPU device was adopted. WebGL does not
        // require translator initialization, so this call has no synchronous prerequisite.
        void postProcess.initialize();
        const readback = new RenderTargetReadback(targets, processor.submissions);
        const shadowScene = new ShadowAtlasSceneAdapter();
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
        const shadowOwner = Object.freeze({ renderer: this });
        const shadowPrepareOptions = { width: 1, height: 1 };
        const shadowRenderOptions = Object.freeze({
            label: 'Shadow atlas',
            preparer: shadowPreparer
        });
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
        recovery.registerSynchronizer(processor.buffers);
        recovery.registerSynchronizer(processor.textures);
        recovery.registerSynchronizer(postProcess.fullscreen);
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
            forward,
            targets,
            offscreen,
            postProcess,
            readback,
            shadowScene,
            shadowResources,
            shadowRenderer,
            shadowPreparer,
            shadowBinding,
            shadowOwner,
            shadowPrepareOptions,
            shadowRenderOptions,
            shadowViewport,
            recovery
        };
        this.#resources = renderingResources;
        this.bindCacheDiagnostics(device, renderingResources);
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
            resources.postProcess.fullscreen.bindGroups.metrics
        ]);
        if (this.#pipelineCacheMetrics === null) {
            this.#pipelineCacheMetrics = new RHICacheCounterContinuation(pipelineMetrics);
        } else this.#pipelineCacheMetrics.rebind(pipelineMetrics);
        if (this.#bindGroupCacheMetrics === null) {
            this.#bindGroupCacheMetrics = new RHICacheCounterContinuation(bindGroupMetrics);
        } else this.#bindGroupCacheMetrics.rebind(bindGroupMetrics);
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
        resources.recovery.destroy();
        resources.forward.destroy();
        resources.offscreen.destroy();
        resources.readback.destroy();
        resources.targets.destroy();
        resources.shadowBinding.destroy();
        resources.shadowPreparer.destroy();
        resources.shadowResources.destroy();
        resources.shadowScene.destroy();
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
    }

    private async createReplacementDevice(): Promise<RHIDevice> {
        if (this.rendererWasDestroyed()) throw new Error('Renderer recovery was cancelled');
        if (this.backend === 'webgpu') {
            return createRHIDevice('webgpu', this.#webGPUDeviceOptions);
        }
        await this.waitForWebGLContextRestored();
        if (this.rendererWasDestroyed()) throw new Error('Renderer recovery was cancelled');
        return constructRHIDevice('webgl2', {
            canvas: this.requireCanvas(),
            context: this.#webGLContextOptions,
            label: 'Hilo3d recovered shared renderer WebGL2 RHI',
            ...(this.rendererDiagnosticsSink === null
                ? {}
                : { diagnosticsSink: this.rendererDiagnosticsSink })
        });
    }

    private waitForWebGLContextRestored(): Promise<void> {
        return waitForWebGL2RHIContextRestored(this.requireCanvas(), this.#webGLContextOptions);
    }

    private adoptRecoveredDevice(device: RHIDevice): void {
        if (this.#destroyed) throw new Error('Renderer recovery was cancelled');
        const previousDevice = this.#device;
        const previousSurface = this.#surface;
        const surface = device.createSurface(this.requireCanvas());
        try {
            this.configureSurface(surface);
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

    private renderSceneToSurface(stage: RendererScene, camera: Camera, fireEvent: boolean): void {
        const resources = this.requireResources();
        const visible = this.prepareScene(stage, camera);
        const viewport = this.surfaceViewport();
        const context = this.createContext(camera, viewport);
        this.ensureMeshFrame(context);
        const shadowPassCount = this.renderSceneShadows(
            resources,
            context,
            visible,
            viewport.width,
            viewport.height
        );
        this.fireBeforeSceneEvents(visible, fireEvent);
        resources.forward.build(
            this.requireActiveFrameScope(),
            context,
            this.requireSurface(),
            {
                classifiedMeshes: visible,
                meshProcessor: resources.processor,
                sampleCount: this.antialias ? 4 : 1,
                clearColor: this.clearColor,
                depthStencilFormat:
                    this.depth || this.stencil
                        ? this.stencil
                            ? 'depth24plus-stencil8'
                            : 'depth24plus'
                        : null,
                depthStoreOp: 'discard',
                stencilStoreOp: 'discard'
            },
            true
        );
        this.#surfaceRequested = true;
        this.recordSceneBuild(visible, fireEvent, shadowPassCount);
        this.#pendingPresentationStage = stage;
        this.#pendingPresentationCamera = camera;
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
        const shadowPassCount = this.renderSceneShadows(
            resources,
            context,
            visible,
            target.width,
            target.height
        );
        const normalized = target.normalizedParameters;
        const depth = normalized.depthStencilAttachment;
        this.fireBeforeSceneEvents(visible, fireEvent);
        const record = resources.offscreen.build(
            this.requireActiveFrameScope(),
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
        defaultWidth: number,
        defaultHeight: number
    ): number {
        const prepareOptions = resources.shadowPrepareOptions;
        prepareOptions.width = positiveSurfaceDimension(defaultWidth, this.width);
        prepareOptions.height = positiveSurfaceDimension(defaultHeight, this.height);

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
            resources.shadowPreparer.retireAll(this.requireActiveFrameScope().uploads);
            resources.shadowResources.detach(resources.shadowOwner);
            return 0;
        }

        const atlas = resources.shadowResources.prepare(resources.shadowOwner, plan.atlas);
        resources.shadowPreparer.configure(plan, meshes);
        const viewport = resources.shadowViewport;
        viewport.width = atlas.width;
        viewport.height = atlas.height;
        const passCount = resources.shadowRenderer.build(
            this.requireActiveFrameScope(),
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
        return passCount;
    }

    private prepareScene(stage: RendererScene, camera: Camera): readonly Mesh[] {
        if (!this.#frameRecording) this.resetDiagnosticsFrame();
        this.fog = stage.fog ?? null;
        this.renderInfo.reset();
        stage.updateMatrixWorld();
        camera.updateViewProjectionMatrix();
        this.buildFramePlan(stage, camera);
        const visible = this.#visibleMeshes;
        visible.length = 0;
        this.renderList.traverse(this.#collectVisibleMesh);
        return visible;
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
        if (this.#frameRecording) {
            throw new Error(`Cannot ${operation} during an active frame`);
        }
    }

    private ensureMeshFrame(context: RenderGraphFrameContext): void {
        if (this.#meshFrameStarted) return;
        const resources = this.requireResources();
        resources.processor.beginFrame(context, this.requireActiveFrameScope().uploads);
        this.#meshFrameStarted = true;
    }

    private recordSceneBuild(
        meshes: readonly Mesh[],
        fireEvent: boolean,
        shadowPassCount: number
    ): void {
        let faces = 0;
        let hasTransparent = false;
        for (const mesh of meshes) {
            faces += countMeshFaces(mesh);
            if (mesh.material?.transparent === true) hasTransparent = true;
        }
        this.#applicationFaceCount += faces;
        this.#applicationPassCount += shadowPassCount + (hasTransparent ? 2 : 1);
        if (!fireEvent) return;
        let pending = this.#afterSceneEvents[this.#afterSceneEventCount];
        if (pending === undefined) {
            pending = { meshes: [] };
            this.#afterSceneEvents.push(pending);
        }
        const snapshot = pending.meshes;
        snapshot.length = meshes.length;
        for (let index = 0; index < meshes.length; index += 1) {
            const mesh = meshes[index];
            if (mesh !== undefined) snapshot[index] = mesh;
        }
        this.#afterSceneEventCount++;
    }

    private clearAfterSceneEvents(): void {
        for (let index = 0; index < this.#afterSceneEventCount; index += 1) {
            const pending = this.#afterSceneEvents[index];
            if (pending !== undefined) pending.meshes.length = 0;
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
            readonly commandCount: number;
            readonly pipelineSwitches: number;
            readonly bindGroupSwitches: number;
            readonly vertexBufferSwitches: number;
            readonly nativeStateCalls: number;
            readonly frameArenaGrowths: number;
        }>,
        passCount: number,
        uploadCount: number
    ): void {
        const sink = this.rendererDiagnosticsSink;
        if (sink === null) return;
        if (diagnostics.drawCount > 0) sink.recordDraw(diagnostics.drawCount);
        if (diagnostics.commandCount > 0) sink.recordCommand(diagnostics.commandCount);
        if (passCount > 0) sink.recordPass(passCount);
        const stateChanges =
            diagnostics.pipelineSwitches +
            diagnostics.bindGroupSwitches +
            diagnostics.vertexBufferSwitches +
            diagnostics.nativeStateCalls;
        if (stateChanges > 0) sink.recordStateChange(stateChanges);
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
        if (
            pipeline === null ||
            bindGroup === null ||
            vertexInput === null ||
            framebuffer === null
        ) {
            throw new Error('Renderer cache diagnostics are not initialized');
        }
        sink.synchronizeCache('pipeline', pipeline);
        sink.synchronizeCache('bindGroup', bindGroup);
        sink.synchronizeCache('vertexArray', vertexInput);
        sink.synchronizeCache('framebuffer', framebuffer);
    }

    private createContext(
        camera: Camera,
        viewport: RenderGraphFrameContext['viewport']
    ): RenderGraphFrameContext {
        return createRenderGraphFrameContext({
            renderer: this,
            rhi: this.requireDevice(),
            frameIndex: this.#activeFrameIndex ?? this.allocateFrameIndex(),
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

    private allocateFrameIndex(): number {
        if (this.#frameIndex === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Renderer frame index space is exhausted');
        }
        return this.#frameIndex++;
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
            this.#frameRecording ||
            resources?.forward.active === true ||
            resources?.offscreen.active === true ||
            resources?.shadowRenderer.active === true ||
            resources?.postProcess.active === true ||
            resources?.readback.frame.active === true
        ) {
            const error = new Error(`Renderer ${operation} cannot run while a frame is active`);
            this.abortApplicationFrame(error);
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
