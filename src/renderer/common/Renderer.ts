import type Camera from '../../camera/Camera';
import type Fog from '../../core/Fog';
import type Mesh from '../../core/Mesh';
import type Node from '../../core/Node';
import type { EventListener } from '../../core/EventDispatcher';
import type Material from '../../material/Material';
import type {
    RenderTarget,
    RenderTargetParameters,
    RenderTargetSelectionOptions
} from './RenderTarget';

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
export function createRendererFrame(renderer: Renderer, isActive: () => boolean): RendererFrame {
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
export interface Renderer {
    readonly backend: RendererBackend;
    readonly className: string;
    readonly ready: Promise<void>;
    readonly isReady: boolean;
    readonly resourceManager: RendererResourceManager;
    readonly renderTarget: RenderTarget | null;
    width: number;
    height: number;
    pixelRatio: number;
    domElement: HTMLCanvasElement | null;
    useInstanced: boolean;
    forceMaterial: Material | null;
    resize(width: number, height: number, force?: boolean): void;
    setOffset(x: number, y: number): void;
    /** Return the viewport that numeric shader semantics use for the active render pass. */
    getViewport(): RendererViewport;
    render(stage: RendererScene, camera: Camera, fireEvent?: boolean): void;
    /** Record resource-ready renderer passes in one synchronous backend frame boundary. */
    renderFrame(callback: RendererFrameCallback): void;
    supportsTextureCompression(format: TextureCompressionFormat): boolean;
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
    releaseGPUResources(): void;
    destroy(): void;
    on(type: string, listener: EventListener, once?: boolean): this;
    off(type?: string, listener?: EventListener): this;
}
