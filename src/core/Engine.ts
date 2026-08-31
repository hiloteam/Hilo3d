import type Camera from '../camera/Camera';
import type Fog from './Fog';
import type World from '../ecs/World';
import Renderer, { type RendererBackend, type RendererFrame } from '../render/Renderer';
import type {
    RendererAutoOptions,
    RendererCreateOptions,
    RendererWebGL2Options,
    RendererWebGPUOptions
} from '../render/RendererOptions';
import { setCameraCompositionSingleSample } from '../render/internal/CameraCompositionPolicy';
import type { RenderWorld } from '../render/world/RenderWorld';
import { getTransformStore } from '../scene/components/Transform';
import { RENDER_WORLD } from '../scene/systems/RenderExtractionSystem';

/** Renderer options whose ownership moves to Engine. */
export type EngineOwnedRendererFields = 'domElement' | 'width' | 'height' | 'pixelRatio';

/** Canvas and presentation sizing owned by Engine. */
export interface EngineOwnershipOptions {
    readonly canvas?: HTMLCanvasElement;
    readonly container?: HTMLElement;
    readonly width?: number;
    readonly height?: number;
    readonly pixelRatio?: number;
}

/** WebGPU-first Engine options. */
export type EngineAutoParameters = Omit<RendererAutoOptions, EngineOwnedRendererFields> &
    EngineOwnershipOptions;

/** Explicit WebGL 2 Engine options. */
export type EngineWebGL2Parameters = Omit<RendererWebGL2Options, EngineOwnedRendererFields> &
    EngineOwnershipOptions;

/** Explicit WebGPU Engine options. */
export type EngineWebGPUParameters = Omit<RendererWebGPUOptions, EngineOwnedRendererFields> &
    EngineOwnershipOptions;

/** Options accepted by Engine.create(). */
export type EngineParameters =
    EngineAutoParameters | EngineWebGL2Parameters | EngineWebGPUParameters;

/** Frame result suitable for diagnostics and deterministic tests. */
export interface EngineFrameResult {
    readonly backend: RendererBackend;
    readonly cameraCount: number;
    readonly submitted: boolean;
    readonly worldFrame: number;
    readonly renderObjectCount: number;
}

function createRenderer(options: RendererCreateOptions): Promise<Renderer> {
    if (options.backend === 'webgpu') return Renderer.create(options);
    if (options.backend === 'webgl2') return Renderer.create(options);
    return Renderer.create(options as RendererAutoOptions);
}

/**
 * Graphics, canvas, presentation, and submission owner for ECS Worlds.
 *
 * Engine never owns gameplay components. Pass an initialized World to `frame()`; the World may
 * also update headlessly without an Engine.
 */
export default class Engine {
    readonly renderer: Renderer;
    readonly canvas: HTMLCanvasElement;
    readonly ready: Promise<void>;
    width: number;
    height: number;
    pixelRatio: number;
    fog: Fog | null;
    private readonly activeCameras: Camera[] = [];
    private readonly activeCameraEntityIndices = new Map<Camera, number>();
    private readonly ownsCanvas: boolean;
    private activeRenderWorld: RenderWorld | null = null;
    private cameraRenderWorld: RenderWorld | null = null;
    private cameraRevision = -1;
    private destroyed = false;
    private readonly recordCameraComposition = (frame: RendererFrame): void => {
        const renderWorld = this.activeRenderWorld;
        if (!renderWorld) throw new Error('Engine has no RenderWorld for camera composition.');
        for (const camera of this.activeCameras) frame.render(renderWorld, camera, true);
    };

    private constructor(
        renderer: Renderer,
        canvas: HTMLCanvasElement,
        ownsCanvas: boolean,
        width: number,
        height: number,
        pixelRatio: number,
        fog: Fog | null
    ) {
        this.renderer = renderer;
        this.canvas = canvas;
        this.ownsCanvas = ownsCanvas;
        this.width = width;
        this.height = height;
        this.pixelRatio = pixelRatio;
        this.fog = fog;
        this.ready = renderer.ready;
    }

    /** Create and initialize the renderer without constructing a gameplay World. */
    static async create(parameters: EngineParameters = {}): Promise<Engine> {
        const {
            canvas: suppliedCanvas,
            container,
            width: requestedWidth,
            height: requestedHeight,
            pixelRatio: requestedPixelRatio,
            ...rendererParameters
        } = parameters;
        const ownsCanvas = suppliedCanvas === undefined;
        const canvas = suppliedCanvas ?? document.createElement('canvas');
        if (container && canvas.parentElement !== container) container.appendChild(canvas);
        const width = requestedWidth ?? window.innerWidth;
        const height = requestedHeight ?? window.innerHeight;
        const requestedRatio = requestedPixelRatio ?? window.devicePixelRatio;
        const pixelRatio = Math.max(1, Math.min(requestedRatio, 1024 / Math.max(width, height), 2));
        const rendererOptions: RendererCreateOptions = {
            ...rendererParameters,
            width: Math.max(1, Math.round(width * pixelRatio)),
            height: Math.max(1, Math.round(height * pixelRatio)),
            pixelRatio,
            domElement: canvas
        };
        let renderer: Renderer;
        try {
            renderer = await createRenderer(rendererOptions);
        } catch (cause) {
            if (ownsCanvas) canvas.remove();
            throw cause;
        }
        const engine = new Engine(
            renderer,
            canvas,
            ownsCanvas,
            width,
            height,
            pixelRatio,
            rendererParameters.fog ?? null
        );
        engine.resize(width, height, pixelRatio, true);
        return engine;
    }

    /** Update one World, render all active extracted cameras, then execute cleanup. */
    frame(world: World, deltaTimeMilliseconds: number): EngineFrameResult {
        this.requireActive('frame');
        world.beginFrame(deltaTimeMilliseconds);
        let renderError: unknown;
        let submitted = false;
        let renderWorld: RenderWorld | undefined;
        try {
            renderWorld = world.getResource(RENDER_WORLD);
            renderWorld.fog = this.fog;
            this.retireRemovedMeshes(renderWorld);
            this.refreshActiveCameras(renderWorld);
            this.activeRenderWorld = renderWorld;
            if (this.activeCameras.length === 1) {
                const camera = this.activeCameras[0];
                if (camera) {
                    this.renderer.render(renderWorld, camera, true);
                    submitted = true;
                }
            } else if (this.activeCameras.length > 1) {
                for (const camera of this.activeCameras) {
                    setCameraCompositionSingleSample(camera, true);
                }
                try {
                    this.renderer.renderFrame(this.recordCameraComposition);
                    submitted = true;
                } finally {
                    for (const camera of this.activeCameras) {
                        setCameraCompositionSingleSample(camera, false);
                    }
                }
            }
            if (submitted) getTransformStore(world).commitWorldHistory();
        } catch (cause) {
            renderError = cause;
            getTransformStore(world).discardWorldHistory();
        } finally {
            this.activeRenderWorld = null;
        }
        try {
            world.finishFrame();
        } catch (cleanupError) {
            if (renderError !== undefined) {
                throw new AggregateError(
                    [renderError, cleanupError],
                    'Engine rendering and World cleanup both failed.',
                    { cause: cleanupError }
                );
            }
            throw cleanupError;
        }
        if (renderError instanceof Error) throw renderError;
        if (renderError !== undefined) {
            throw new Error('Engine rendering threw a non-Error value.', { cause: renderError });
        }
        const diagnostics = world.getDiagnostics();
        return {
            backend: this.renderer.backend,
            cameraCount: this.activeCameras.length,
            submitted,
            worldFrame: diagnostics.frameCount,
            renderObjectCount: renderWorld?.length ?? 0
        };
    }

    /** Resize CSS and physical renderer extents. */
    resize(width: number, height: number, pixelRatio = this.pixelRatio, force = false): this {
        this.requireActive('resize');
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new RangeError('Engine dimensions must be finite and positive.');
        }
        if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
            throw new RangeError('Engine pixelRatio must be finite and positive.');
        }
        this.width = width;
        this.height = height;
        this.pixelRatio = pixelRatio;
        this.renderer.resize(
            Math.max(1, Math.round(width * pixelRatio)),
            Math.max(1, Math.round(height * pixelRatio)),
            force
        );
        this.canvas.style.width = `${String(width)}px`;
        this.canvas.style.height = `${String(height)}px`;
        return this;
    }

    /** Release presentation resources without destroying any World. */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        try {
            this.renderer.destroy();
        } finally {
            if (this.ownsCanvas) this.canvas.remove();
        }
    }

    private refreshActiveCameras(renderWorld: RenderWorld): void {
        if (
            this.cameraRenderWorld === renderWorld &&
            this.cameraRevision === renderWorld.cameras.revision
        )
            return;
        this.cameraRenderWorld = renderWorld;
        this.cameraRevision = renderWorld.cameras.revision;
        this.activeCameras.length = 0;
        this.activeCameraEntityIndices.clear();
        for (let index = 0; index < renderWorld.cameras.length; index++) {
            const camera = renderWorld.cameras.cameras[index];
            if (camera && renderWorld.cameras.isOutputEnabled(index)) {
                this.activeCameras.push(camera);
                this.activeCameraEntityIndices.set(
                    camera,
                    renderWorld.cameras.entities[index] ?? 0
                );
            }
        }
        this.activeCameras.sort(
            (left, right) =>
                left.priority - right.priority ||
                (this.activeCameraEntityIndices.get(left) ?? 0) -
                    (this.activeCameraEntityIndices.get(right) ?? 0)
        );
    }

    private retireRemovedMeshes(renderWorld: RenderWorld): void {
        const meshes = renderWorld.getRetiredMeshes();
        for (let index = 0; index < renderWorld.retiredRenderIdCount; index++) {
            const mesh = meshes[index];
            if (mesh) this.renderer.resourceManager.destroyMesh(mesh);
        }
        renderWorld.clearRetiredRenderIds();
    }

    private requireActive(operation: string): void {
        if (this.destroyed) throw new Error(`Cannot ${operation} a destroyed Engine.`);
    }
}
