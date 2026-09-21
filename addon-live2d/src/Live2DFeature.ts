import type {
    ForwardRenderPipelineFeature,
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeatureRuntime
} from 'hilo3d';
import { Live2DNode } from './Live2DNode.js';

/** Portable soft-mask prepass; install once in ForwardRenderPipelineFactory.features. */
export const live2DFeature: ForwardRenderPipelineFeature = Object.freeze({
    name: '@hilo/addon-live2d/masks',
    injectionPoint: 'before-transparent',
    requirements: Object.freeze({
        sampledSceneColor: false,
        sampledDepth: false,
        splitScene: true
    }),
    create(): ForwardRenderPipelineFeatureRuntime {
        return {
            record(context: ForwardRenderFeatureContext): void {
                context.pipeline.scene.traverse(node => {
                    if (node instanceof Live2DNode) node.recordMasks(context);
                });
            },
            destroy(): void {
                // Targets belong to their nodes; this feature retains no resources.
            }
        };
    }
});
