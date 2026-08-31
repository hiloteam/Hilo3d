import type Camera from '../../camera/Camera';
import type Mesh from '../../core/Mesh';
import type { RendererContract } from '../Renderer';
import type { RenderPipelineContext } from './RenderPipeline';
import type { RenderGraphTextureHandle } from './ScriptableRenderGraph';

/** GPU graph contribution owned by an explicitly extracted ECS renderer extension. */
export interface RenderGPUExtension {
    readonly hasOpaqueRenderers: boolean;
    readonly requiresSampledDepth: boolean;
    readonly hasPendingWork: boolean;
    isVisible(camera: Camera): boolean;
    record(
        context: RenderPipelineContext,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        drawVisible: boolean,
        phase: 'opaque' | 'transparent'
    ): void;
    frameSubmitted(frameIndex: number): void;
    frameDiscarded(frameIndex: number): void;
}

/**
 * Explicit renderer contribution referenced by an ECS component.
 *
 * CPU mesh views and GPU graph work share this one extraction boundary; there is no scene-node
 * symbol lookup or hierarchy discovery.
 */
export interface RenderExtension {
    setWorldTransform?(source: ArrayLike<number>, offset: number, revision: number): void;
    prepareRenderer?(renderer: RendererContract): void;
    prepareView?(camera: Camera): void;
    readonly meshes?: readonly Mesh[];
    readonly gpu: RenderGPUExtension | null;
}
