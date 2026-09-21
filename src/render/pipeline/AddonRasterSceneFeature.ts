import type Camera from '../../camera/Camera';
import type Node from '../../core/Node';
import { getRenderNodeExtension, type RenderNodeRasterExtension } from './RenderNodeExtension';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from './ForwardRenderPipeline';
import type { RenderPipelineContext } from './RenderPipeline';

function visibleRaster(node: Node, camera: Camera): RenderNodeRasterExtension | null {
    const raster = getRenderNodeExtension(node)?.raster;
    if (raster === undefined || raster === null || (node.layer & camera.visibility) === 0)
        return null;
    for (let ancestor: Node | null = node; ancestor !== null; ancestor = ancestor.parent) {
        if (!ancestor.visible) return null;
    }
    const visible = raster.isVisible(camera);
    if (typeof visible !== 'boolean')
        throw new TypeError('Render node raster isVisible must return boolean.');
    return visible ? raster : null;
}

function assertSynchronous(value: unknown): void {
    if (
        value !== null &&
        (typeof value === 'object' || typeof value === 'function') &&
        typeof Reflect.get(value, 'then') === 'function'
    ) {
        throw new TypeError('Render node raster record must be synchronous.');
    }
}

class AddonRasterSceneFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #recorded = new Set<RenderNodeRasterExtension>();

    requiresSplitScene(context: RenderPipelineContext): boolean {
        let required = false;
        context.scene.traverse(node => {
            if (visibleRaster(node, context.camera) !== null) required = true;
        });
        return required;
    }

    record(context: ForwardRenderFeatureContext): void {
        context.pipeline.scene.traverse(node => {
            const raster = visibleRaster(node, context.pipeline.camera);
            if (raster === null) return;
            this.#recorded.add(raster);
            assertSynchronous(raster.record(context));
        });
    }

    frameSubmitted(frameIndex: number): void {
        this.finishFrame(frameIndex, 'frameSubmitted');
    }

    frameDiscarded(frameIndex: number): void {
        this.finishFrame(frameIndex, 'frameDiscarded');
    }

    destroy(): void {
        this.#recorded.clear();
    }

    private finishFrame(frameIndex: number, callback: 'frameSubmitted' | 'frameDiscarded'): void {
        if (this.#recorded.size === 0) return;
        const errors: unknown[] = [];
        for (const raster of this.#recorded) {
            try {
                raster[callback]?.(frameIndex);
            } catch (error: unknown) {
                errors.push(error);
            }
        }
        this.#recorded.clear();
        if (errors.length !== 0)
            throw new AggregateError(errors, `Render node raster ${callback} failed.`);
    }
}

/** Built-in capability-independent bridge for optional portable scene-node prepasses. */
export const addonRasterSceneFeature: ForwardRenderPipelineFeature = Object.freeze({
    name: '__hilo3d-addon-raster-scene',
    injectionPoint: 'before-transparent',
    requirements: Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false,
        splitScene: false
    }),
    create(): ForwardRenderPipelineFeatureRuntime {
        return new AddonRasterSceneFeatureRuntime();
    }
});
