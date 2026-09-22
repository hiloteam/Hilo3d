/**
 * Portable Live2D rendering for Hilo3D's WebGL2 and WebGPU backends.
 * Models automatically load the prebuilt runtime included in this addon.
 * High-level models own animation sessions, assets and portable drawable rendering.
 * Redistributable SDK runtime files retain their separate Live2D licenses; artwork is not bundled.
 *
 * @packageDocumentation
 */

export { Live2DNode, type Live2DNodeOptions } from './Live2DNode.js';
export { live2DFeature } from './Live2DFeature.js';
export * from './Live2DSource.js';
export * from './Live2DAssets.js';

export {
    Live2DModel,
    type Live2DModelLoadOptions,
    type Live2DBounds,
    type Live2DParameterOptions
} from './Live2DModel.js';
export { configureLive2D, type Live2DConfiguration } from './Live2DConfiguration.js';
export type * from './runtime/Live2DRuntime.js';
