import type Camera from '../../camera/Camera';
import type Fog from '../../core/Fog';
import type LightManager from '../../light/LightManager';
import type RendererCore from '../RendererCore';
import type { RHIDevice, RHIViewport } from '../rhi/core';
import { createSemanticFrameState, type SemanticFrameState } from './SemanticFrameState';

/** Immutable identity snapshot consumed by semantic resolution and pass preparation for one frame. */
export interface RenderGraphFrameContext {
    readonly renderer: RendererCore;
    readonly rhi: RHIDevice;
    readonly frameIndex: number;
    readonly camera: Camera;
    readonly lightManager: LightManager;
    readonly fog: Fog | null;
    readonly viewport: Readonly<RHIViewport>;
    readonly semantic: Readonly<SemanticFrameState>;
}

export function createRenderGraphFrameContext(
    context: Omit<RenderGraphFrameContext, 'viewport' | 'semantic'> & {
        readonly viewport: RHIViewport;
    }
): RenderGraphFrameContext {
    if (!Number.isSafeInteger(context.frameIndex) || context.frameIndex < 0) {
        throw new RangeError('Render frame index must be a non-negative safe integer');
    }
    const viewport = Object.freeze({ ...context.viewport });
    if (
        !Number.isFinite(viewport.x) ||
        !Number.isFinite(viewport.y) ||
        !Number.isFinite(viewport.width) ||
        !Number.isFinite(viewport.height) ||
        !Number.isFinite(viewport.minDepth) ||
        !Number.isFinite(viewport.maxDepth) ||
        viewport.width <= 0 ||
        viewport.height <= 0 ||
        viewport.minDepth < 0 ||
        viewport.maxDepth > 1 ||
        viewport.minDepth > viewport.maxDepth
    ) {
        throw new RangeError('Render frame viewport is invalid');
    }
    const semantic = createSemanticFrameState({
        renderer: context.renderer,
        camera: context.camera,
        lightManager: context.lightManager,
        fog: context.fog,
        viewport: [viewport.x, viewport.y, viewport.width, viewport.height]
    });
    return Object.freeze({ ...context, viewport, semantic });
}
