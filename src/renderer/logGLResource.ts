import log from '../utils/log';
import Shader from '../shader/Shader';
import Texture from '../texture/Texture';
import Buffer from './Buffer';
import VertexArrayObject from './VertexArrayObject';
import Program from './Program';
import Framebuffer from './Framebuffer';

interface GLResource {
    prototype: {
        className: string;
    };
    cache: {
        _cache: Record<string, any>;
    };
}

const resourceList: GLResource[] = [Shader, Program, Buffer, VertexArrayObject, Texture, Framebuffer] as any[];

/**
 * 打印所有 gl 资源
 * @return gl资源数量字符串
 */
const logGLResource = function(): string {
    let msg = '';
    resourceList.forEach((ResourceClass) => {
        msg += `${ResourceClass.prototype.className}:${Object.keys(ResourceClass.cache._cache).length} `;
    });
    log.log(msg);
    return msg;
};

export default logGLResource;
