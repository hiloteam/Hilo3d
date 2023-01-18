import Class from '../core/Class';
import Buffer from './Buffer';

/**
 * Uniform Buffer Object
 * @class
 */
const UniformBuffer = Class.create(/** @lends UniformBuffer.prototype */ {
    /**
     * @default Buffer
     * @type {String}
     */
    className: 'UniformBuffer',

    /**
     * @default true
     * @type {Boolean}
     */
    isUniformBuffer: true,

    /**
     * is dirty
     * @type {Boolean}
     * @default false
    */
    isDirty: false,

    /**
     * data
     * @type {TypedArray|ArrayBuffer}
     * @default null
     */
    data: {
        get() {
            return this._data;
        },
        set(data) {
            this._data = data;
            this.isDirty = true;
        }
    },

    /**
     * data
     * @type {TypedArray|ArrayBuffer}
     * @default null
     * @private
     */
    _data: null,

    /**
     * @type {Buffer}
     * @default null
     * @private
     */
    _buffer: null,

    /**
     * @constructs
     */
    constructor(data) {
        this.data = data;
    },

    getBuffer(gl) {
        if (!this._buffer) {
            this._buffer = new Buffer(gl, gl.UNIFORM_BUFFER, null, gl.DYNAMIC_DRAW);
        }

        if (this.isDirty) {
            this._buffer.bufferData(this.data);
            this.isDirty = false;
        }
        return this._buffer;
    },

    destroy() {
        if (this._buffer) {
            this._buffer.destroy();
            this._buffer = null;
        }
        this.isDirty = true;
    },
});

export default UniformBuffer;
