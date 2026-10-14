import Camera from '../../camera/Camera';
import type { RenderPipelineContext } from '../pipeline/RenderPipeline';
import { getTransformHistoryRevision } from '../../core/TransformHistory';

/** A pass-local camera identity with the same physical view and an unjittered raster projection. */
class StableRasterCamera extends Camera {
    near = 0;
    far: number | null = null;
    #sourceRevision = -1;

    synchronize(source: Camera): void {
        const revision = getTransformHistoryRevision(source);
        if (revision !== this.#sourceRevision) {
            this.invalidateTransformHistory();
            this.#sourceRevision = revision;
        }
        this.depthMode = source.depthMode;
        this.visibility = source.visibility;
        this.isPerspectiveCamera = source.isPerspectiveCamera;
        this.isOrthographicCamera = source.isOrthographicCamera;
        const near: unknown = Reflect.get(source, 'near');
        const far: unknown = Reflect.get(source, 'far');
        this.near = typeof near === 'number' ? near : 0;
        this.far = typeof far === 'number' ? far : null;
        this.worldMatrix.copy(source.worldMatrix);
        this.matrix.copy(source.worldMatrix);
        this.viewMatrix.copy(source.viewMatrix);
        this.projectionMatrix.copy(source.projectionMatrix);
        this.jitteredProjectionMatrix.copy(source.projectionMatrix);
        this.viewProjectionMatrix.copy(source.viewProjectionMatrix);
        this.jitteredViewProjectionMatrix.copy(source.viewProjectionMatrix);
        this.updateFrustum(this.viewProjectionMatrix);
    }

    // Addon raster preparation may refresh the camera. This snapshot deliberately has no authored
    // Node transform: recomposing its default transform would replace the physical source view.
    override updateViewMatrix(): this {
        return this;
    }
    override updateProjectionMatrix(): void {
        /* synchronized from the physical source camera */
    }
}

const cameras = new WeakMap<Camera, StableRasterCamera>();
const active = new WeakMap<Camera, StableRasterCamera>();
const resolved = new WeakMap<object, number>();
const composition = new WeakSet();

/** @internal Explicit frame callbacks may preserve depth for a later camera invocation. */
export function markStableDepthComposition(context: RenderPipelineContext): void {
    composition.add(context);
}

/** @internal Ordinary single-camera render calls require no speculative depth prepass. */
export function requiresStableDepthComposition(context: RenderPipelineContext): boolean {
    return composition.has(context);
}

/** @internal Mark only this invocation after its opaque temporal resolve was recorded. */
export function markTemporalResolved(context: Pick<RenderPipelineContext, 'frameIndex'>): void {
    resolved.set(context, context.frameIndex);
}

/** @internal A discarded or different invocation cannot inherit an earlier temporal marker. */
export function hasTemporalResolved(context: Pick<RenderPipelineContext, 'frameIndex'>): boolean {
    return resolved.get(context) === context.frameIndex;
}

/** @internal Resolve a synchronous pass scope without mutating the authored camera or its history. */
export function resolveRasterCamera(camera: Camera): Camera {
    return active.get(camera) ?? camera;
}

/** @internal Record stable post-resolve passes with reusable, independent camera semantics. */
export function withStableRasterCamera<T>(
    context: Pick<RenderPipelineContext, 'camera'>,
    record: () => T
): T {
    const source = context.camera;
    if (source instanceof StableRasterCamera) return record();
    let camera = cameras.get(source);
    if (camera === undefined) {
        camera = new StableRasterCamera();
        cameras.set(source, camera);
    }
    camera.synchronize(source);
    active.set(source, camera);
    try {
        return record();
    } finally {
        active.delete(source);
    }
}
