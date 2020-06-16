import webgl from './webgl';
import webglExtensions from './webglExtensions';
import * as Hilo from './Hilo';

/**
 * WebGL, WebGL extensions 枚举值
 * @constant
 * @type {Object}
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
