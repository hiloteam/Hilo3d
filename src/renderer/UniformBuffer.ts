import Buffer from './Buffer';

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

/**
 * Uniform Buffer Object
 * @class
 */
class UniformBuffer {
    /**
     * @default Buffer
     * @type {String}
     */
    className: string = 'UniformBuffer';

    /**
     * @default true
     * @type {Boolean}
     */
    isUniformBuffer: boolean = true;

    /**
     * is dirty
     * @type {Boolean}
     * @default false
    */
    isDirty: boolean = false;

    /**
     * data
     * @type {TypedArray|ArrayBuffer}
     * @default null
     * @private
     */
    private _data: TypedArray | ArrayBuffer | null = null;

    /**
     * @type {Buffer}
     * @default null
     * @private
     */
    private _buffer: Buffer | null = null;

    /**
     * @constructs
     */
    constructor(data?: TypedArray | ArrayBuffer) {
        if (data) {
            this.data = data;
        }
    }

    /**
     * data getter
     * @type {TypedArray|ArrayBuffer}
     */
    get data(): TypedArray | ArrayBuffer | null {
        return this._data;
    }

    /**
     * data setter
     * @type {TypedArray|ArrayBuffer}
     */
    set data(data: TypedArray | ArrayBuffer | null) {
        this._data = data;
        this.isDirty = true;
    }

    getBuffer(gl: WebGLRenderingContext | WebGL2RenderingContext): Buffer {
        if (!this._buffer) {
            this._buffer = new Buffer(gl, gl.UNIFORM_BUFFER, null, gl.DYNAMIC_DRAW);
        }

        if (this.isDirty) {
            this._buffer.bufferData(this.data);
            this.isDirty = false;
        }
        return this._buffer;
    }

    destroy(): void {
        if (this._buffer) {
            this._buffer.destroy();
            this._buffer = null;
        }
        this.isDirty = true;
    }
}

export default UniformBuffer;
