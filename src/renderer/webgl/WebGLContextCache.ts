import Cache from '../../utils/Cache';
import type { GLContext } from './WebGLTypes';

/** Owns one cache namespace per WebGL context without retaining disposed contexts. */
class WebGLContextCache<Value> {
    private readonly contexts = new WeakMap<GLContext, Cache<Value>>();

    get(gl: GLContext): Cache<Value> {
        let cache = this.contexts.get(gl);
        if (!cache) {
            cache = new Cache<Value>();
            this.contexts.set(gl, cache);
        }
        return cache;
    }

    peek(gl: GLContext): Cache<Value> | undefined {
        return this.contexts.get(gl);
    }

    delete(gl: GLContext): void {
        this.contexts.delete(gl);
    }
}

export default WebGLContextCache;
