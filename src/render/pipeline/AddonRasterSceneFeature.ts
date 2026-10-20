import type Camera from '../../camera/Camera';
import Node from '../../core/Node';
import { assertSynchronousResult } from '../internal/ScriptableRenderPipelineValidation';
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

class AddonRasterSceneFeatureRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #recorded = new Set<RenderNodeRasterExtension>();

    requiresSplitScene(context: RenderPipelineContext): boolean {
        let required = false;
        context.scene.traverse(node => {
            if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
            if (visibleRaster(node, context.camera) !== null) {
                required = true;
                return Node.TRAVERSE_STOP_ALL;
            }
            return Node.TRAVERSE_STOP_NONE;
        });
        return required;
    }

    record(context: ForwardRenderFeatureContext): void {
        context.pipeline.scene.traverse(node => {
            if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
            const raster = visibleRaster(node, context.pipeline.camera);
            if (raster === null) return Node.TRAVERSE_STOP_NONE;
            this.#recorded.add(raster);
            assertSynchronousResult('Render node raster record', raster.record(context));
            return Node.TRAVERSE_STOP_NONE;
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
        let errors: unknown[] | undefined;
        for (const raster of this.#recorded) {
            try {
                assertSynchronousResult(
                    `Render node raster ${callback}`,
                    raster[callback]?.(frameIndex)
                );
            } catch (error: unknown) {
                (errors ??= []).push(error);
            }
        }
        this.#recorded.clear();
        if (errors !== undefined)
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
