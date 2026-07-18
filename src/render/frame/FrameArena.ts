const DEFAULT_CAPACITY = 64 * 1024;
const MAX_ARRAY_BUFFER_SIZE = 0x7fff_fff8;

function requireNonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function requirePowerOfTwo(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || (value & (value - 1)) !== 0) {
        throw new RangeError(`${name} must be a positive power of two`);
    }
}

function alignedOffset(offset: number, alignment: number): number {
    const remainder = offset % alignment;
    return remainder === 0 ? offset : offset + alignment - remainder;
}

function byteView(data: ArrayBuffer | ArrayBufferView): Uint8Array {
    if (data instanceof Uint8Array) return data;
    return data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Numeric allocation token. It is valid only for the arena generation that created it. */
export interface FrameArenaAllocation {
    readonly offset: number;
    readonly byteLength: number;
    readonly generation: number;
}

/**
 * Reusable byte storage for one logical render frame.
 *
 * The hot allocation method returns a numeric offset and does not create a view or an object.
 * Capacity grows geometrically only when a frame exceeds the previous high-water mark.
 */
export class FrameArena {
    private storage: ArrayBuffer;
    private bytes: Uint8Array;
    private cursor = 0;
    private currentGeneration = 1;
    private currentStorageGeneration = 1;
    private currentHighWater = 0;
    private totalGrowths = 0;

    constructor(initialCapacity = DEFAULT_CAPACITY) {
        requireNonNegativeSafeInteger(initialCapacity, 'Frame arena initial capacity');
        if (initialCapacity > MAX_ARRAY_BUFFER_SIZE) {
            throw new RangeError('Frame arena initial capacity exceeds the supported maximum');
        }
        this.storage = new ArrayBuffer(initialCapacity);
        this.bytes = new Uint8Array(this.storage);
    }

    get generation(): number {
        return this.currentGeneration;
    }

    /** Changes only when high-water growth replaces the backing ArrayBuffer. */
    get storageGeneration(): number {
        return this.currentStorageGeneration;
    }

    get byteLength(): number {
        return this.cursor;
    }

    get capacity(): number {
        return this.storage.byteLength;
    }

    get highWaterByteLength(): number {
        return this.currentHighWater;
    }

    get growthCount(): number {
        return this.totalGrowths;
    }

    /** Start the next frame while retaining storage and the historical high-water mark. */
    reset(): void {
        if (this.currentGeneration === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Frame arena generation space is exhausted');
        }
        this.currentGeneration++;
        this.cursor = 0;
    }

    /** Reserve bytes and return their offset without allocating a wrapper object. */
    allocate(byteLength: number, alignment = 1): number {
        requireNonNegativeSafeInteger(byteLength, 'Frame arena allocation size');
        requirePowerOfTwo(alignment, 'Frame arena allocation alignment');
        const offset = alignedOffset(this.cursor, alignment);
        const end = offset + byteLength;
        if (!Number.isSafeInteger(end) || end > MAX_ARRAY_BUFFER_SIZE) {
            throw new RangeError('Frame arena allocation exceeds the supported maximum');
        }
        this.ensureCapacity(end);
        this.cursor = end;
        if (end > this.currentHighWater) this.currentHighWater = end;
        return offset;
    }

    /** Convenience for non-hot paths that need a self-validating allocation token. */
    allocateTracked(byteLength: number, alignment = 1): FrameArenaAllocation {
        const offset = this.allocate(byteLength, alignment);
        return Object.freeze({ offset, byteLength, generation: this.currentGeneration });
    }

    /** Copy immutable frame input into arena-owned storage and return its numeric offset. */
    copy(data: ArrayBuffer | ArrayBufferView, alignment = 1): number {
        const source = byteView(data);
        const offset = this.allocate(source.byteLength, alignment);
        this.bytes.set(source, offset);
        return offset;
    }

    write(offset: number, data: ArrayBuffer | ArrayBufferView): void {
        const source = byteView(data);
        this.assertRange(offset, source.byteLength);
        this.bytes.set(source, offset);
    }

    /** Explicitly creates a view; callers must keep it out of steady per-draw paths. */
    view(offset: number, byteLength: number): Uint8Array {
        this.assertRange(offset, byteLength);
        return new Uint8Array(this.storage, offset, byteLength);
    }

    /** Reuse a caller-owned view while the arena storage and requested range remain unchanged. */
    reuseView(current: Uint8Array | null, offset: number, byteLength: number): Uint8Array {
        this.assertRange(offset, byteLength);
        if (
            current !== null &&
            current.buffer === this.storage &&
            current.byteOffset === offset &&
            current.byteLength === byteLength
        ) {
            return current;
        }
        return new Uint8Array(this.storage, offset, byteLength);
    }

    viewTracked(allocation: FrameArenaAllocation): Uint8Array {
        if (allocation.generation !== this.currentGeneration) {
            throw new Error('Frame arena allocation belongs to a stale frame generation');
        }
        return this.view(allocation.offset, allocation.byteLength);
    }

    private assertRange(offset: number, byteLength: number): void {
        requireNonNegativeSafeInteger(offset, 'Frame arena offset');
        requireNonNegativeSafeInteger(byteLength, 'Frame arena range size');
        if (offset + byteLength > this.cursor) {
            throw new RangeError('Frame arena range exceeds allocated storage');
        }
    }

    private ensureCapacity(required: number): void {
        if (required <= this.storage.byteLength) return;
        let capacity = Math.max(1, this.storage.byteLength);
        while (capacity < required) {
            const doubled = capacity * 2;
            capacity = doubled > MAX_ARRAY_BUFFER_SIZE ? MAX_ARRAY_BUFFER_SIZE : doubled;
            if (capacity < required && capacity === MAX_ARRAY_BUFFER_SIZE) {
                throw new RangeError('Frame arena capacity is exhausted');
            }
        }
        const nextStorage = new ArrayBuffer(capacity);
        const nextBytes = new Uint8Array(nextStorage);
        nextBytes.set(this.bytes.subarray(0, this.cursor));
        this.storage = nextStorage;
        this.bytes = nextBytes;
        this.currentStorageGeneration++;
        this.totalGrowths++;
    }
}

/**
 * Reuses heterogeneous pass-parameter or draw-record objects across frames. The factory runs only
 * when a frame exceeds the pool's previous high-water count.
 */
export class FrameObjectPool<T> {
    private readonly values: T[] = [];
    private cursor = 0;

    constructor(
        private readonly create: () => T,
        private readonly resetValue?: (value: T) => void
    ) {}

    get size(): number {
        return this.cursor;
    }

    get capacity(): number {
        return this.values.length;
    }

    reset(): void {
        this.cursor = 0;
    }

    allocate(): T {
        let value = this.values[this.cursor];
        if (value === undefined) {
            value = this.create();
            this.values.push(value);
        }
        this.cursor++;
        this.resetValue?.(value);
        return value;
    }
}
