import log from '../utils/log';
import Shader from '../shader/Shader';
import Texture from '../texture/Texture';
import Buffer from './Buffer';
import VertexArrayObject from './VertexArrayObject';
import Program from './Program';
import Framebuffer from './Framebuffer';

const resourceList = [Shader, Program, Buffer, VertexArrayObject, Texture, Framebuffer];

/**
 * 打印所有 gl 资源
 * @return {string} gl资源数量字符串
 */
const logGLResource = function() {
    let msg = '';
    resourceList.forEach((ResourceClass) => {
        msg += `${ResourceClass.prototype.className}:${Object.keys(ResourceClass.cache._cache).length} `;
    });
    log.log(msg);
    return msg;
};

export default logGLResource;
