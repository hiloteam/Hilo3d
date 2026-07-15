import {
    Std140Layout,
    type Std140FieldValue,
    type Std140Schema,
    type Std140WriteResult,
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

/** @internal Caller-owned scratch result for allocation-free backend uploads. */
export interface UniformBufferDirtySpan {
    byteOffset: number;
    byteLength: number;
}

const MAX_RETAINED_DIRTY_RANGES = 64;

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
    readonly #writeResult: Std140WriteResult = { byteOffset: 0, byteLength: 0 };
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
        const target = byteView(this.data);
        const source = byteView(data);
        let start = 0;
        while (start < source.byteLength && target[byteOffset + start] === source[start]) start++;
        if (start === source.byteLength) return this;
        let end = source.byteLength;
        while (end > start && target[byteOffset + end - 1] === source[end - 1]) end--;
        target.set(source, byteOffset);
        this.recordDirty(byteOffset + start, byteOffset + end);
        return this;
    }

    /** Pack and update a named field when this buffer was constructed from a std140 layout. */
    set<Name extends keyof Schema & string>(
        name: Name,
        value: Std140FieldValue<Schema[Name]>
    ): this {
        const dirty = this.layout.writeInto(this.data, name, value, this.#writeResult);
        if (dirty.byteLength > 0) {
            this.recordDirty(dirty.byteOffset, dirty.byteOffset + dirty.byteLength);
        }
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
        this.assertRevision(revision);
        if (revision < this.discardedDirtyRevision) return null;
        return this.dirtyUpdates.filter(update => update.revision > revision);
    }

    /**
     * Merge retained writes into caller-owned storage without allocating an array. `false` means
     * the requested revision fell outside the bounded history and requires a full upload.
     *
     * @internal
     */
    getDirtySpanSince(
        revision: number,
        result: { byteOffset: number; byteLength: number }
    ): boolean {
        this.assertRevision(revision);
        result.byteOffset = 0;
        result.byteLength = 0;
        if (revision < this.discardedDirtyRevision) return false;
        let start = this.byteLength;
        let end = 0;
        for (const update of this.dirtyUpdates) {
            if (update.revision <= revision) continue;
            if (update.byteOffset < start) start = update.byteOffset;
            const updateEnd = update.byteOffset + update.byteLength;
            if (updateEnd > end) end = updateEnd;
        }
        if (end > start) {
            result.byteOffset = start;
            result.byteLength = end - start;
        }
        return true;
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

    private assertRevision(revision: number): void {
        if (!Number.isSafeInteger(revision) || revision < 0 || revision > this._revision) {
            throw new RangeError(
                `Uniform buffer revision must be an integer in [0, ${String(this._revision)}]`
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
