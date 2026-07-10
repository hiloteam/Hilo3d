import * as webgl from './webgl';
import * as webgl2 from './webgl2';
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
    webgl2,
    Hilo
};
Object.assign(constants, webgl, webglExtensions, webgl2, Hilo);

export default constants;
