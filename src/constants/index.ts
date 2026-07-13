import * as webgl from './webgl';
import * as webgl2 from './webgl2';
import * as webglExtensions from './webglExtensions';
import * as Hilo from './Hilo';

/**
 * WebGL, WebGL extensions 枚举值
 * @example
 * ```ts
 * Hilo3d.constants.LINEAR_MIPMAP_NEAREST
 * ```
 */
const constants = {
    ...webgl,
    ...webglExtensions,
    ...webgl2,
    ...Hilo,
    webgl,
    webglExtensions,
    webgl2,
    Hilo
} as const;

export {
    Hilo as engineConstants,
    webgl as webglConstants,
    webgl2 as webgl2Constants,
    webglExtensions as webglExtensionConstants
};
export default constants;
