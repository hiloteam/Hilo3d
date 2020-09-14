import * as webgl from './webgl';
import * as webglExtensions from './webglExtensions';
import * as Hilo from './Hilo';

/**
 * WebGL, WebGL extensions 枚举值
 * @namespace
 * @example
 * Hilo3d.constants.LINEAR_MIPMAP_NEAREST
 */
const constants = {
    webgl,
    webglExtensions,
    Hilo
};
Object.assign(constants, webgl, webglExtensions, Hilo);

export default constants;
