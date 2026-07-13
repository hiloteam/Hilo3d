import type Camera from '../camera/Camera';
import type Fog from '../core/Fog';
import type Mesh from '../core/Mesh';
import type Node from '../core/Node';
import type { EventListener } from '../core/EventDispatcher';

export type RendererBackend = 'webgl2' | 'webgpu';

export type RendererScene = Node & { readonly fog?: Fog | null };

/** Resource lifecycle surface shared by graphics backends. */
export interface RendererResourceManager {
    destroyMesh(mesh: Mesh): void;
}

/** Public backend-neutral renderer contract used by Stage and scene resources. */
export interface Renderer {
    readonly backend: RendererBackend;
    readonly className: string;
    readonly ready: Promise<void>;
    readonly isReady: boolean;
    readonly resourceManager: RendererResourceManager;
    width: number;
    height: number;
    pixelRatio: number;
    domElement: HTMLCanvasElement | null;
    resize(width: number, height: number, force?: boolean): void;
    setOffset(x: number, y: number): void;
    render(stage: RendererScene, camera: Camera, fireEvent?: boolean): void;
    releaseGPUResources(): void;
    destroy(): void;
    on(type: string, listener: EventListener, once?: boolean): this;
    off(type?: string, listener?: EventListener): this;
}
