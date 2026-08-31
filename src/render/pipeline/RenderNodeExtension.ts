import type Camera from '../../camera/Camera';
import type Node from '../../core/Node';
import type { RendererContract } from '../Renderer';
import type { RenderPipelineContext } from './RenderPipeline';
import type { RenderGraphTextureHandle } from './ScriptableRenderGraph';

/** Stable symbol used by optional addons to attach renderer lifecycle behavior to a scene node. */
export const RENDER_NODE_EXTENSION = Symbol('hilo3d.render-node-extension.v1');

/** GPU graph contribution owned by an optional scene-node addon. */
export interface RenderNodeGPUExtension {
    /** Whether this contribution has an opaque or alpha-masked phase. */
    readonly hasOpaqueRenderers: boolean;
    /** Whether simulation or raster needs the current sampled scene depth. */
    readonly requiresSampledDepth: boolean;
    /** Whether graph work must run even when the contribution is outside the camera. */
    readonly hasPendingWork: boolean;
    /** Test view visibility without issuing render commands. */
    isVisible(camera: Camera): boolean;
    /** Record one opaque or transparent contribution through the active Render Graph. */
    record(
        context: RenderPipelineContext,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        drawVisible: boolean,
        phase: 'opaque' | 'transparent'
    ): void;
    /** Commit staged state only after the enclosing frame submission succeeds. */
    frameSubmitted(frameIndex: number): void;
    /** Roll back staged state after recording or submission is discarded. */
    frameDiscarded(frameIndex: number): void;
}

/** Optional render lifecycle implemented by addon-owned scene nodes. */
export interface RenderNodeExtension {
    /** Allocate or recover renderer-local resources before node updates and graph recording. */
    prepareRenderer?(renderer: RendererContract): void;
    /** Refresh camera-dependent streams before scene collection. */
    prepareView?(camera: Camera): void;
    /** Active GPU contribution, or `null` when this node uses ordinary scene rendering only. */
    readonly gpu: RenderNodeGPUExtension | null;
}

/** Read and validate an optional render-node extension without importing its addon package. */
export function getRenderNodeExtension(node: Node): RenderNodeExtension | null {
    const extension: unknown = Reflect.get(node, RENDER_NODE_EXTENSION);
    if (extension === undefined || extension === null) return null;
    if (typeof extension !== 'object') {
        throw new TypeError('Render node extensions must be objects.');
    }
    const gpu: unknown = Reflect.get(extension, 'gpu');
    if (gpu !== null && typeof gpu !== 'object') {
        throw new TypeError('Render node GPU extensions must be objects or null.');
    }
    for (const hook of ['prepareRenderer', 'prepareView'] as const) {
        const callback: unknown = Reflect.get(extension, hook);
        if (callback !== undefined && typeof callback !== 'function') {
            throw new TypeError(`Render node extension hook ${hook} must be a function.`);
        }
    }
    return extension as RenderNodeExtension;
}
