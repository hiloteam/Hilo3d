/**
 * Portable Live2D rendering for Hilo3D's WebGL2 and WebGPU backends.
 * Applications configure a separately deployed, licensed Cubism Core/Framework runtime once;
 * high-level models own animation sessions, loaded assets and portable drawable rendering.
 * SDK binaries and character assets are not distributed in this package.
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
export {
    configureLive2D,
    type Live2DConfiguration,
    type Live2DRuntimeProviderOptions
} from './Live2DConfiguration.js';
export type * from './runtime/Live2DRuntime.js';
