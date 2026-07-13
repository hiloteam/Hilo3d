import type Camera from '../camera/Camera';
import type Fog from '../core/Fog';
import type Mesh from '../core/Mesh';
import type Node from '../core/Node';
import type { EventListener } from '../core/EventDispatcher';
import type Material from '../material/Material';
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
