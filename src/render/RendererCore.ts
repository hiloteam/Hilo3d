import type Camera from '../camera/Camera';
import type Fog from '../core/Fog';
import type Mesh from '../core/Mesh';
import type Node from '../core/Node';
import { EventDispatcher, type EventListener } from '../core/EventDispatcher';
import LightManager from '../light/LightManager';
import type Material from '../material/Material';
import Color from '../math/Color';
import type { RendererDiagnostics, RendererDiagnosticsSnapshot } from './RendererDiagnostics';
import type { Resource, ShaderPrecision } from './types';
import GraphicsResourceManager from './GraphicsResourceManager';
import RenderInfo from './RenderInfo';
import RenderList from './RenderList';
import { RenderGraphFramePlanner, type RenderGraphFramePlan } from './RenderGraphFramePlan';
import { getRegisteredRendererDiagnostics } from './diagnostics/RendererDiagnosticsRegistry';
import type {
    RenderTarget,
    RenderTargetParameters,
    RenderTargetSelectionOptions
} from './RenderTarget';
import type { StorageBuffer, StorageBufferDescriptor } from './StorageBuffer';

export type RendererBackend = 'webgl2' | 'webgpu';

/** Current render-pass viewport in physical attachment pixels: x, y, width, height. */
export type RendererViewport = readonly [x: number, y: number, width: number, height: number];

/** Native compressed texture families understood by the engine texture model. */
export type TextureCompressionFormat = 'bc' | 'etc1' | 'etc2' | 'astc-4x4' | 'pvrtc';

export type RendererScene = Node & { readonly fog?: Fog | null };

/** Backend-neutral snapshot of renderer-managed resource ownership. */
export interface RendererResourceDiagnostics {
    readonly trackedMeshCount: number;
    readonly trackedResourceCount: number;
    readonly usedResourceCount: number;
    readonly pendingDestroyCount: number;
    readonly frameActive: boolean;
}

/** Resource lifecycle surface shared by graphics backends. */
export interface RendererResourceManager {
    destroyMesh(mesh: Mesh): void;
    destroyIfNoRef(resource: Resource): void;
    getDiagnostics(rootNode?: Node): RendererResourceDiagnostics;
}

/**
 * Commands recorded inside one synchronous application frame. Scene GPU-resource content must be
 * settled before its first use and the facade must not escape the callback.
 */
export interface RendererFrame {
    readonly backend: RendererBackend;
    render(stage: RendererScene, camera: Camera, fireEvent?: boolean): void;
    renderToTarget(
        target: RenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent?: boolean
    ): void;
    present(target?: RenderTarget): void;
}

/** Synchronous frame recorder. Returning a Promise is rejected at runtime. */
export type RendererFrameCallback = (frame: RendererFrame) => unknown;

/** Create one invocation-scoped backend-neutral command facade. */
export function createRendererFrame(
    renderer: RendererCore,
    isActive: () => boolean
): RendererFrame {
    const assertActive = (): void => {
        if (!isActive()) {
            throw new Error(
                'Renderer frame commands are only valid inside their synchronous callback'
            );
        }
    };
    return Object.freeze({
        get backend() {
            return renderer.backend;
        },
        render(stage: RendererScene, camera: Camera, fireEvent = false) {
            assertActive();
            renderer.render(stage, camera, fireEvent);
        },
        renderToTarget(
            target: RenderTarget,
            stage: RendererScene,
            camera: Camera,
            fireEvent = false
        ) {
            assertActive();
            renderer.renderToTarget(target, stage, camera, fireEvent);
        },
        present(target?: RenderTarget) {
            assertActive();
            if (target) renderer.present(target);
            else renderer.present();
        }
    });
}

/** Invoke a recorder and reject async callbacks before a backend closes its frame boundary. */
export function invokeRendererFrameCallback(
    callback: RendererFrameCallback,
    frame: RendererFrame
): void {
    const result: unknown = callback(frame);
    if (
        (typeof result === 'object' && result !== null && 'then' in result) ||
        typeof result === 'function'
    ) {
        const then: unknown = Reflect.get(result, 'then');
        if (typeof then === 'function') {
            throw new TypeError(
                'Renderer frame callbacks must be synchronous and cannot return a Promise'
            );
        }
    }
}

/** Public backend-neutral renderer contract used by Stage and scene resources. */
export interface RendererContract {
    readonly backend: RendererBackend;
    readonly className: string;
    readonly ready: Promise<void>;
    readonly isReady: boolean;
    readonly renderInfo: RenderInfo;
    readonly lightManager: LightManager;
    readonly resourceManager: RendererResourceManager;
    readonly renderTarget: RenderTarget | null;
    width: number;
    height: number;
    pixelRatio: number;
    domElement: HTMLCanvasElement | null;
    useInstanced: boolean;
    forceMaterial: Material | null;
    clearColor: Color;
    resize(width: number, height: number, force?: boolean): void;
    setOffset(x: number, y: number): void;
    /** Return the viewport that numeric shader semantics use for the active render pass. */
    getViewport(): RendererViewport;
    render(stage: RendererScene, camera: Camera, fireEvent?: boolean): void;
    /** Record resource-ready renderer passes in one synchronous backend frame boundary. */
    renderFrame(callback: RendererFrameCallback): void;
    supportsTextureCompression(format: TextureCompressionFormat): boolean;
    /** Create a WebGPU renderer-owned storage buffer. WebGL 2 rejects this operation. */
    createStorageBuffer(descriptor: Readonly<StorageBufferDescriptor>): StorageBuffer;
    createRenderTarget(parameters: RenderTargetParameters): RenderTarget;
    setRenderTarget(target: RenderTarget | null, options?: RenderTargetSelectionOptions): this;
    /** Present the first color attachment of a renderer-owned target to the canvas. */
    present(target?: RenderTarget): void;
    renderToTarget(
        target: RenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent?: boolean
    ): void;
    onInit(callback: (renderer: this) => void): void;
    /** Resolve after all work submitted before this call has completed. */
    waitForIdle(): Promise<void>;
    /** Explicit opt-in access to a backend extension; unknown names return null. */
    getExtension(name: string): object | null;
    releaseGPUResources(): void;
    destroy(): void;
    on(type: string, listener: EventListener, once?: boolean): this;
    off(type?: string, listener?: EventListener): this;
}

/**
 * Shared scene-renderer foundation.
 *
 * This layer deliberately owns engine concepts such as meshes, lights, render lists and shader
 * precision. The RHI below it never imports those concepts. Backend subclasses retain only the
 * resource preparation and command submission that genuinely differs between WebGPU and WebGL 2.
 *
 * The frame planner keeps and reuses its arrays, so building a frame does not allocate a second
 * command stream or add per-draw virtual dispatch.
 */
export abstract class RendererCore extends EventDispatcher implements RendererContract {
    readonly renderInfo = new RenderInfo();
    readonly renderList = new RenderList();
    readonly lightManager = new LightManager();
    readonly resourceManager = new GraphicsResourceManager();

    width = 0;
    height = 0;
    pixelRatio = 1;
    domElement: HTMLCanvasElement | null = null;
    alpha = false;
    depth = true;
    stencil = false;
    antialias = true;
    premultipliedAlpha = true;
    failIfMajorPerformanceCaveat = false;
    useLogDepth = false;
    vertexPrecision: ShaderPrecision = 'highp';
    fragmentPrecision: ShaderPrecision = 'highp';
    fog: Fog | null = null;
    offsetX = 0;
    offsetY = 0;
    forceMaterial: Material | null = null;
    clearColor = new Color(1, 1, 1);
    isInitFailed = false;

    private _useInstanced = false;
    private readonly framePlanner = new RenderGraphFramePlanner();
    private diagnosticsSink: RendererDiagnostics | null = null;

    abstract readonly backend: RendererBackend;
    abstract readonly className: string;
    abstract readonly ready: Promise<void>;
    abstract readonly renderTarget: RenderTarget | null;

    abstract get isReady(): boolean;

    get useInstanced(): boolean {
        return this._useInstanced;
    }

    set useInstanced(value: boolean) {
        this._useInstanced = value;
        this.renderList.useInstanced = value;
    }

    /** Build the allocation-reusing, backend-neutral scene plan once per camera pass. */
    protected buildFramePlan(stage: RendererScene, camera: Camera): RenderGraphFramePlan {
        return this.framePlanner.build(stage, camera, this.renderList, this.lightManager);
    }

    /** Resolve the setup-only canvas channel once; no WeakMap lookup occurs in frame hot paths. */
    protected attachRegisteredDiagnostics(canvas: HTMLCanvasElement | null): void {
        this.diagnosticsSink = canvas ? getRegisteredRendererDiagnostics(canvas) : null;
    }

    /** Internal mutable sink passed directly to one concrete backend. */
    protected get rendererDiagnosticsSink(): RendererDiagnostics | null {
        return this.diagnosticsSink;
    }

    /** Reset only per-frame counters at the backend's actual logical frame boundary. */
    protected resetDiagnosticsFrame(): void {
        this.diagnosticsSink?.resetFrame();
    }

    /** @internal Snapshot opt-in counters for benchmark and renderer diagnostics tooling. */
    getDiagnosticsSnapshot(): Readonly<RendererDiagnosticsSnapshot> | null {
        return this.diagnosticsSink?.snapshot() ?? null;
    }

    abstract resize(width: number, height: number, force?: boolean): void;
    abstract setOffset(x: number, y: number): void;
    abstract getViewport(): RendererViewport;
    abstract render(stage: RendererScene, camera: Camera, fireEvent?: boolean): void;
    abstract renderFrame(callback: RendererFrameCallback): void;
    abstract supportsTextureCompression(format: TextureCompressionFormat): boolean;
    abstract createStorageBuffer(descriptor: Readonly<StorageBufferDescriptor>): StorageBuffer;
    abstract createRenderTarget(parameters: RenderTargetParameters): RenderTarget;
    abstract setRenderTarget(
        target: RenderTarget | null,
        options?: RenderTargetSelectionOptions
    ): this;
    abstract present(target?: RenderTarget): void;
    abstract renderToTarget(
        target: RenderTarget,
        stage: RendererScene,
        camera: Camera,
        fireEvent?: boolean
    ): void;
    abstract onInit(callback: (renderer: this) => void): void;
    abstract waitForIdle(): Promise<void>;
    abstract getExtension(name: string): object | null;
    abstract releaseGPUResources(): void;
    abstract destroy(): void;
}

export default RendererCore;
