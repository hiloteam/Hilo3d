import log from '../utils/log';
import Shader from '../shader/Shader';
import Texture from '../texture/Texture';
import Buffer from './Buffer';
import VertexArrayObject from './VertexArrayObject';
import Program from './Program';
import Framebuffer from './Framebuffer';
import type Cache from '../utils/Cache';

function cacheSize<Value>(cache: Cache<Value>): number {
    let size = 0;
    cache.each(() => {
        size += 1;
    });
    return size;
}

const resources = [
    { name: 'Shader', count: () => cacheSize(Shader.cache) },
    { name: 'Program', count: () => cacheSize(Program.cache) },
    { name: 'Buffer', count: () => cacheSize(Buffer.cache) },
    { name: 'VertexArrayObject', count: () => cacheSize(VertexArrayObject.cache) },
    { name: 'Texture', count: () => cacheSize(Texture.cache) },
    { name: 'Framebuffer', count: () => cacheSize(Framebuffer.cache) }
] as const;

/** Log and return current WebGL resource-cache sizes. */
function logGLResource(): string {
    const message = `${resources
        .map(resource => `${resource.name}:${String(resource.count())}`)
        .join(' ')} `;
    log.log(message);
    return message;
}

export default logGLResource;
