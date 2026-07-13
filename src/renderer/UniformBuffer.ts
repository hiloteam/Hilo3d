import Buffer from './Buffer';
import {
    Std140Layout,
    type Std140FieldValue,
    type Std140Schema,
    type Std140Values
} from './ubo/Std140Layout';
import type { TypedArray } from './types';

export interface UniformBufferRange {
    readonly uniformBuffer: UniformBuffer;
    readonly byteOffset: number;
    readonly byteLength: number;
}

/** One CPU byte-range mutation retained for backend-local incremental uploads. */
export interface UniformBufferDirtyRange {
    readonly revision: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}

const MAX_RETAINED_DIRTY_RANGES = 64;

interface ContextResource {
    buffer: Buffer;
    byteLength: number;
    revision: number;
}

function byteView(data: ArrayBuffer | TypedArray): Uint8Array {
    return data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Portable std140 uniform block shared byte-for-byte by WebGL2 and WebGPU. */
class UniformBuffer<Schema extends Std140Schema = Std140Schema> {
    readonly className = 'UniformBuffer';
    readonly isUniformBuffer = true;
    /**
     * data
     */
    get data(): ArrayBuffer {
        return this._data;
    }
    /**
     * data
     */
    set data(data: ArrayBuffer) {
        if (!(data instanceof ArrayBuffer)) {
            throw new TypeError(
                'UniformBuffer data must be an ArrayBuffer packed by its std140 layout'
            );
        }
        if (data.byteLength !== this.layout.byteLength) {
            throw new RangeError(
                `Uniform buffer is ${String(data.byteLength)} bytes; std140 layout requires exactly ${String(this.layout.byteLength)}`
            );
        }
        this._data = data;
        this.recordDirty(0, data.byteLength);
    }
    /**
     * data
     */
    private _data: ArrayBuffer;
    readonly layout: Std140Layout<Schema>;
    private readonly resources = new Map<WebGL2RenderingContext, ContextResource>();
    private readonly dirtyUpdates: UniformBufferDirtyRange[] = [];
    private discardedDirtyRevision = 0;
    private _revision = 0;

    /** Monotonic CPU-data revision shared by WebGL2 and WebGPU upload caches. */
    get revision(): number {
        return this._revision;
    }

    constructor(layout: Std140Layout<Schema>, values: Partial<Std140Values<Schema>> = {}) {
        if (!(layout instanceof Std140Layout)) {
            throw new TypeError('UniformBuffer construction requires a Std140Layout schema');
        }
        this.layout = layout;
        this._data = layout.createBuffer(values);
        this.recordDirty(0, this._data.byteLength);
    }

    static fromSchema<const Schema extends Std140Schema>(
        layout: Std140Layout<Schema>,
        values: Partial<Std140Values<Schema>> = {}
    ): UniformBuffer<Schema> {
        return new UniformBuffer(layout, values);
    }

    get byteLength(): number {
        return this.data.byteLength;
    }

    /** Mark externally mutated bytes for upload on every context using this buffer. */
    markDirty(byteOffset = 0, byteLength = this.byteLength - byteOffset): this {
        this.assertRange(byteOffset, byteLength);
        this.recordDirty(byteOffset, byteOffset + byteLength);
        return this;
    }

    /** Copy raw bytes into the backing store and enqueue the smallest possible GPU update. */
    write(byteOffset: number, data: TypedArray): this {
        this.assertRange(byteOffset, data.byteLength);
        byteView(this.data).set(byteView(data), byteOffset);
        this.recordDirty(byteOffset, byteOffset + data.byteLength);
        return this;
    }

    /** Pack and update a named field when this buffer was constructed from a std140 layout. */
    set<Name extends keyof Schema & string>(
        name: Name,
        value: Std140FieldValue<Schema[Name]>
    ): this {
        const dirty = this.layout.write(this.data, name, value);
        this.recordDirty(dirty.byteOffset, dirty.byteOffset + dirty.byteLength);
        return this;
    }

    range(byteOffset: number, byteLength: number): UniformBufferRange {
        this.assertRange(byteOffset, byteLength);
        return Object.freeze({ uniformBuffer: this, byteOffset, byteLength });
    }

    /**
     * Return retained writes newer than a backend-local revision. `null` means the consumer fell
     * behind the bounded history window and must upload the complete current buffer.
     */
    getDirtyRangesSince(revision: number): readonly UniformBufferDirtyRange[] | null {
        if (!Number.isSafeInteger(revision) || revision < 0 || revision > this._revision) {
            throw new RangeError(
                `Uniform buffer revision must be an integer in [0, ${String(this._revision)}]`
            );
        }
        if (revision < this.discardedDirtyRevision) return null;
        return this.dirtyUpdates.filter(update => update.revision > revision);
    }

    getBuffer(gl: WebGL2RenderingContext): Buffer {
        let resource = this.resources.get(gl);
        if (!resource) {
            const buffer = new Buffer(gl, gl.UNIFORM_BUFFER, this.data, gl.DYNAMIC_DRAW);
            resource = { buffer, byteLength: this.byteLength, revision: this._revision };
            this.resources.set(gl, resource);
            return buffer;
        }
        if (resource.revision !== this._revision) {
            const updates = this.getDirtyRangesSince(resource.revision);
            if (resource.byteLength !== this.byteLength || updates === null) {
                resource.buffer.bufferData(this.data);
                resource.byteLength = this.byteLength;
            } else {
                let start = this.byteLength;
                let end = 0;
                for (const update of updates) {
                    start = Math.min(start, update.byteOffset);
                    end = Math.max(end, update.byteOffset + update.byteLength);
                }
                if (end > start) {
                    resource.buffer.bufferSubData(start, byteView(this.data).subarray(start, end));
                }
            }
            resource.revision = this._revision;
        }
        return resource.buffer;
    }

    bind(gl: WebGL2RenderingContext, bindingPoint: number, range?: UniformBufferRange): void {
        const buffer = this.getBuffer(gl).buffer;
        if (!range) {
            gl.bindBufferBase(gl.UNIFORM_BUFFER, bindingPoint, buffer);
            return;
        }
        if (range.uniformBuffer !== this)
            throw new TypeError('Uniform buffer range owner mismatch');
        const alignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
        if (range.byteOffset % alignment !== 0) {
            throw new RangeError(
                `Uniform buffer range offset ${String(range.byteOffset)} is not aligned to ${String(alignment)}`
            );
        }
        gl.bindBufferRange(
            gl.UNIFORM_BUFFER,
            bindingPoint,
            buffer,
            range.byteOffset,
            range.byteLength
        );
    }

    /** Destroy one context allocation, or every allocation owned by this logical buffer. */
    destroy(gl?: WebGL2RenderingContext): void {
        if (gl) {
            this.resources.get(gl)?.buffer.destroy();
            this.resources.delete(gl);
        } else {
            for (const resource of this.resources.values()) resource.buffer.destroy();
            this.resources.clear();
        }
    }

    private assertRange(byteOffset: number, byteLength: number): void {
        if (
            !Number.isSafeInteger(byteOffset) ||
            !Number.isSafeInteger(byteLength) ||
            byteOffset < 0 ||
            byteLength < 1 ||
            byteOffset + byteLength > this.byteLength
        ) {
            throw new RangeError(
                `Uniform buffer byte range [${String(byteOffset)}, ${String(byteOffset + byteLength)}) is invalid`
            );
        }
    }

    private recordDirty(start: number, end: number): void {
        this._revision++;
        this.dirtyUpdates.push({
            revision: this._revision,
            byteOffset: start,
            byteLength: end - start
        });
        while (this.dirtyUpdates.length > MAX_RETAINED_DIRTY_RANGES) {
            const discarded = this.dirtyUpdates.shift();
            if (discarded) this.discardedDirtyRevision = discarded.revision;
        }
    }
}
export default UniformBuffer;
