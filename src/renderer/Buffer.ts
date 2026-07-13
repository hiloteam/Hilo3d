import Cache from '../utils/Cache';
import math from '../math/math';
import { ARRAY_BUFFER, ELEMENT_ARRAY_BUFFER, STATIC_DRAW } from '../constants/webgl';
import requireGLResource from './requireGLResource';
import type GeometryData from '../geometry/GeometryData';
import type WebGLResourceManager from './WebGLResourceManager';
import type { GLContext, TypedArray } from './types';
export type BufferData = TypedArray | ArrayBuffer;

export interface BufferRenderer {
    resourceManager: WebGLResourceManager;
}

const cache = new Cache<Buffer>();
/**
 * 缓冲
 */
class Buffer {
    /**
     * 缓存
     */
    static get cache(): Cache<Buffer> {
        return cache;
    }
    /**
     * 重置缓存
     */
    static reset(_gl?: GLContext): void {
        cache.each(buffer => {
            buffer.destroy();
        });
    }
    /**
     * 生成顶点缓冲
     * @param gl -
     * @param geometryData -
     * @param usage - Buffer usage; defaults to STATIC_DRAW.
     */
    static createVertexBuffer(
        gl: GLContext,
        geometryData: GeometryData,
        usage: GLenum = STATIC_DRAW
    ): Buffer {
        return this.createBuffer(gl, ARRAY_BUFFER, geometryData, usage);
    }
    private static createBuffer(
        gl: GLContext,
        target: GLenum,
        geometryData: GeometryData,
        usage: GLenum
    ): Buffer {
        const id = geometryData.bufferViewId;
        let buffer = cache.get(id);
        if (buffer) {
            return buffer;
        }
        geometryData.isDirty = false;
        buffer = new Buffer(gl, target, geometryData.data, usage);
        cache.add(id, buffer);
        return buffer;
    }
    /**
     * 生成索引缓冲
     * @param gl -
     * @param geometryData -
     * @param usage - Buffer usage; defaults to STATIC_DRAW.
     */
    static createIndexBuffer(
        gl: GLContext,
        geometryData: GeometryData,
        usage: GLenum = STATIC_DRAW
    ): Buffer {
        return this.createBuffer(gl, ELEMENT_ARRAY_BUFFER, geometryData, usage);
    }
    readonly className = 'Buffer';
    readonly isBuffer = true;
    readonly id: string;
    readonly gl: GLContext;
    readonly target: GLenum;
    readonly usage: GLenum;
    readonly buffer: WebGLBuffer;
    data: BufferData | null = null;
    private _isDestroyed = false;
    /**
     * @param gl -
     * @param target - Buffer target; defaults to ARRAY_BUFFER.
     * @param data - Initial data; defaults to null.
     * @param usage - Buffer usage; defaults to STATIC_DRAW.
     */
    constructor(
        gl: GLContext,
        target: GLenum = ARRAY_BUFFER,
        data: BufferData | null = null,
        usage: GLenum = STATIC_DRAW
    ) {
        /**
         * id
         */
        this.id = math.generateUUID(this.className);
        this.gl = gl;
        /**
         * target
         */
        this.target = target;
        /**
         * usage
         */
        this.usage = usage;
        /**
         * buffer
         */
        this.buffer = requireGLResource(gl.createBuffer(), 'a buffer');
        if (data) {
            this.bufferData(data);
        }
    }
    /**
     * 绑定
     * @returns this
     */
    bind(): this {
        this.gl.bindBuffer(this.target, this.buffer);
        return this;
    }
    /**
     * 上传数据
     * @param data -
     * @returns this
     */
    bufferData(data: BufferData): this {
        const { gl, target, usage } = this;
        this.bind();
        gl.bufferData(target, data, usage);
        this.data = data;
        return this;
    }
    /**
     * 上传部分数据
     * @param byteOffset -
     * @param data -
     * @param isBinding -
     * @returns this
     */
    bufferSubData(byteOffset: number, data: TypedArray, isBinding = false): this {
        const { gl, target } = this;
        if (!isBinding) {
            this.bind();
        }
        gl.bufferSubData(target, byteOffset, data);
        return this;
    }
    /**
     * @param geometryData -
     * @returns this
     */
    uploadGeometryData(geometryData: GeometryData): this {
        const subDataList = geometryData.subDataUpdates;
        if (
            !this.data ||
            this.data.byteLength < geometryData.data.byteLength ||
            geometryData.isAllDataDirty
        ) {
            this.bufferData(geometryData.data);
        } else if (subDataList.length) {
            this.bind();
            subDataList.forEach(subData => {
                this.bufferSubData(subData.byteOffset, subData.data, true);
            });
        } else {
            this.bufferData(geometryData.data);
        }
        geometryData.isDirty = false;
        return this;
    }
    /**
     * 没有被引用时销毁资源
     * @param renderer -
     * @returns this
     */
    destroyIfNoRef(renderer: BufferRenderer): this {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);
        return this;
    }
    /**
     * 销毁资源
     * @returns this
     */
    destroy(): this {
        if (this._isDestroyed) {
            return this;
        }
        this.gl.deleteBuffer(this.buffer);
        this.data = null;
        cache.removeObject(this);
        this._isDestroyed = true;
        return this;
    }
}
export default Buffer;
