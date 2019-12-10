import webgl from './webgl';
import webglExtensions from './webglExtensions';
import * as Hilo from './Hilo';

const constants = {
    webgl,
    webglExtensions,
    Hilo
};
Object.assign(constants, webgl, webglExtensions, Hilo);

export default constants;
/**
 * Hilo3d 枚举值，可通过 Hilo3d.constants.xxx 获取
 * @typedef {Number} GLenum
 */
