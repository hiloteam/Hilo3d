import Buffer from './Buffer';
import type { TypedArray } from './types';

export type UniformBufferData = TypedArray | ArrayBuffer;
/**
 * Uniform Buffer Object
 */
class UniformBuffer {
    readonly className = 'UniformBuffer';
    readonly isUniformBuffer = true;
    /**
     * is dirty
     */
    isDirty = false;
    /**
     * data
     */
    get data(): UniformBufferData {
        return this._data;
    }
    /**
     * data
     */
    set data(data: UniformBufferData) {
        this._data = data;
        this.isDirty = true;
    }
    /**
     * data
     */
    private _data: UniformBufferData = new ArrayBuffer(0);
    private _buffer: Buffer | null = null;
    constructor(data: UniformBufferData) {
        this.data = data;
    }
    getBuffer(gl: WebGL2RenderingContext): Buffer {
        this._buffer ??= new Buffer(gl, gl.UNIFORM_BUFFER, null, gl.DYNAMIC_DRAW);
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
