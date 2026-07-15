import type Camera from '../../camera/Camera';
import type Fog from '../../core/Fog';
import type LightManager from '../../light/LightManager';
import type { RendererViewport } from '../RendererCore';

/** Minimal renderer dimensions required by built-in material semantics. */
export interface SemanticRendererState {
    readonly width: number;
    readonly height: number;
    getViewport(): RendererViewport;
}

/** Explicit, invocation-scoped semantic inputs; no renderer-global active camera is required. */
export interface SemanticFrameState {
    readonly renderer: SemanticRendererState;
    readonly camera: Camera;
    readonly lightManager: LightManager;
    readonly fog: Fog | null;
    /** Physical attachment pixels, snapshotted for this pass. */
    readonly viewport: RendererViewport;
    /** Reusable numeric form consumed by legacy uniform packing code. */
    readonly viewportData: Float32Array;
}

function snapshotViewport(viewport: RendererViewport): RendererViewport {
    const [x, y, width, height] = viewport;
    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
    ) {
        throw new RangeError('Semantic viewport must contain finite x/y and positive width/height');
    }
    return Object.freeze([x, y, width, height]);
}

export function createSemanticFrameState(options: {
    readonly renderer: SemanticRendererState;
    readonly camera: Camera;
    readonly lightManager: LightManager;
    readonly fog: Fog | null;
    readonly viewport?: RendererViewport;
}): Readonly<SemanticFrameState> {
    const viewport = snapshotViewport(options.viewport ?? options.renderer.getViewport());
    return Object.freeze({
        renderer: options.renderer,
        camera: options.camera,
        lightManager: options.lightManager,
        fog: options.fog,
        viewport,
        viewportData: new Float32Array(viewport)
    });
}
