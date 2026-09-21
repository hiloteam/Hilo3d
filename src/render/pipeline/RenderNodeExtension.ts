import type Camera from '../../camera/Camera';
import type Node from '../../core/Node';
import type { RendererContract } from '../Renderer';
import type { RenderPipelineContext } from './RenderPipeline';
import type { RenderGraphTextureHandle } from './ScriptableRenderGraph';
import type { ForwardRenderFeatureContext } from './ForwardRenderPipeline';

/** Process-global symbol used by optional addons to attach renderer behavior across package copies. */
export const RENDER_NODE_EXTENSION = Symbol.for('hilo3d.render-node-extension.v1');

/** Portable graph work automatically recorded before transparent rendering by Forward. */
export interface RenderNodeRasterExtension {
    /**
     * Whether this view needs the contribution. Forward also checks node/ancestor visibility
     * and the node's camera layer. Return false when no prepass is needed to retain one scene pass.
     */
    isVisible(camera: Camera): boolean;
    /**
     * Record portable graph passes using this invocation's shared camera and culling results.
     * Promise-like return values are rejected before RHI execution. The context cannot be retained.
     */
    record(context: ForwardRenderFeatureContext): unknown;
    /** Commit once per application frame after all recorded views have submitted successfully. */
    frameSubmitted?(frameIndex: number): void;
    /** Roll back once per discarded application frame, including a failed record callback. */
    frameDiscarded?(frameIndex: number): void;
}

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
    /** Portable Forward prepass contribution; omitted/null nodes require no raster bridge work. */
    readonly raster?: RenderNodeRasterExtension | null;
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
    const raster: unknown = Reflect.get(extension, 'raster');
    if (raster !== undefined && raster !== null) {
        if (typeof raster !== 'object') {
            throw new TypeError('Render node raster extensions must be objects or null.');
        }
        for (const hook of ['isVisible', 'record'] as const) {
            if (typeof Reflect.get(raster, hook) !== 'function') {
                throw new TypeError(`Render node raster hook ${hook} must be a function.`);
            }
        }
        for (const hook of ['frameSubmitted', 'frameDiscarded'] as const) {
            const callback: unknown = Reflect.get(raster, hook);
            if (callback !== undefined && typeof callback !== 'function') {
                throw new TypeError(`Render node raster hook ${hook} must be a function.`);
            }
        }
    }
    return extension as RenderNodeExtension;
}
