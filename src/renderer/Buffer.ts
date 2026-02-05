/* eslint no-buffer-constructor: "off" */
/* global GLenum */
import Cache from '../utils/Cache';
import math from '../math/math';

import constants from '../constants';

const {
    ARRAY_BUFFER,
    ELEMENT_ARRAY_BUFFER,
    STATIC_DRAW
} = constants;

// TypedArray type definition
type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

// GeometryData interface (simplified for Buffer's needs)
interface GeometryData {
    bufferViewId: string;
    isDirty: boolean;
    data: TypedArray;
    _isAllDirty?: boolean;
    subDataList?: Array<{
        byteOffset: number;
        data: TypedArray;
    }>;
}

// WebGLRenderer interface (simplified for Buffer's needs)
interface WebGLRenderer {
    resourceManager: {
        destroyIfNoRef(obj: any): void;
    };
}

const cache = new Cache<Buffer>();

/**
 * 缓冲
 * @class
 */
class Buffer {
    /**
     * 缓存
     * @type {Cache}
     * @readOnly
     * @return {Cache}
     */
    static get cache(): Cache<Buffer> {
        return cache;
    }

    /**
     * 重置缓存
     */
    static reset(_gl: WebGLRenderingContext): void {
        cache.each((buffer: Buffer) => {
            buffer.destroy();
        });
    }

    /**
     * 生成顶点缓冲
     * @param  {WebGLRenderingContext} gl
     * @param  {GeometryData} geometryData
     * @param  {GLenum} [usage = STATIC_DRAW]
     * @return {Buffer}
     */
    static createVertexBuffer(gl: WebGLRenderingContext, geometryData: GeometryData, usage: GLenum = STATIC_DRAW): Buffer {
        return this.createBuffer(gl, ARRAY_BUFFER, geometryData, usage);
    }

    /**
     * 生成缓冲
     * @param  {WebGLRenderingContext} gl
     * @param  {GLenum} target
     * @param  {GeometryData} geometryData
     * @param  {GLenum} usage
     * @return {Buffer}
     */
    static createBuffer(gl: WebGLRenderingContext, target: GLenum, geometryData: GeometryData, usage: GLenum): Buffer {
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
     * @param  {WebGLRenderingContext} gl
     * @param  {GeometryData} geometryData
     * @param  {GLenum} [usage = STATIC_DRAW]
     * @return {Buffer}
     */
    static createIndexBuffer(gl: WebGLRenderingContext, geometryData: GeometryData, usage: GLenum = STATIC_DRAW): Buffer {
        return this.createBuffer(gl, ELEMENT_ARRAY_BUFFER, geometryData, usage);
    }

    /**
     * @default Buffer
     * @type {String}
     */
    readonly className: string = 'Buffer';

    /**
     * @default true
     * @type {Boolean}
     */
    readonly isBuffer: boolean = true;

    /**
     * id
     * @type {String}
     */
    id: string;

    /**
     * WebGL rendering context
     * @type {WebGLRenderingContext}
     */
    gl: WebGLRenderingContext;

    /**
     * target
     * @type {GLenum}
     */
    target: GLenum;

    /**
     * usage
     * @type {GLenum}
     */
    usage: GLenum;

    /**
     * buffer
     * @type {WebGLBuffer}
     */
    buffer: WebGLBuffer | null;

    /**
     * data
     * @type {TypedArray}
     */
    data: TypedArray | null = null;

    /**
     * @type {Boolean}
     */
    private _isDestroyed: boolean = false;

    /**
     * @constructs
     * @param  {WebGLRenderingContext} gl
     * @param  {GLenum} [target = ARRAY_BUFFER]
     * @param  {TypedArray} [data = null]
     * @param  {GLenum} [usage = STATIC_DRAW]
     */
    constructor(gl: WebGLRenderingContext, target: GLenum = ARRAY_BUFFER, data: TypedArray | null = null, usage: GLenum = STATIC_DRAW) {
        this.id = math.generateUUID(this.className);
        this.gl = gl;
        this.target = target;
        this.usage = usage;
        this.buffer = gl.createBuffer();

        if (data) {
            this.bufferData(data);
        }
    }

    /**
     * 绑定
     * @return {Buffer} this
     */
    bind(): this {
        this.gl.bindBuffer(this.target, this.buffer);
        return this;
    }

    /**
     * 上传数据
     * @param  {TypedArray} data
     * @return {Buffer} this
     */
    bufferData(data: TypedArray): this {
        const {
            gl,
            target,
            usage
        } = this;

        this.bind();
        gl.bufferData(target, data, usage);
        this.data = data;
        return this;
    }

    /**
     * 上传部分数据
     * @param  {Number} byteOffset
     * @param  {TypedArray} data
     * @param  {Boolean} [isBinding=false]
     * @return {Buffer} this
     */
    bufferSubData(byteOffset: number, data: TypedArray, isBinding: boolean = false): this {
        const {
            gl,
            target
        } = this;

        if (!isBinding) {
            this.bind();
        }
        gl.bufferSubData(target, byteOffset, data);
        return this;
    }

    /**
     * @param  {GeometryData} geometryData
     * @return {Buffer} this
     */
    uploadGeometryData(geometryData: GeometryData): this {
        const subDataList = geometryData.subDataList;
        if (!this.data || this.data.byteLength < geometryData.data.byteLength || geometryData._isAllDirty === true) {
            this.bufferData(geometryData.data);
        } else if (subDataList && subDataList.length) {
            this.bind();
            subDataList.forEach((subData) => {
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
     * @param  {WebGLRenderer} renderer
     * @return {Buffer} this
     */
    destroyIfNoRef(renderer: WebGLRenderer): this {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);
        return this;
    }

    /**
     * 销毁资源
     * @return {Buffer} this
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
