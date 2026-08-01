import type { RendererBackend } from './RendererCore';

/** Portable roles that determine how a renderer-owned storage buffer may be used. */
export type StorageBufferUsage =
    'storage' | 'vertex' | 'index' | 'indirect' | 'copy-source' | 'copy-destination';

/** Device-loss policy for contents that may have been changed by GPU work. */
export type StorageBufferRecoveryPolicy = 'cpu-shadow' | 'reinitialize';

/** Creation options for a renderer-owned WebGPU storage buffer. */
export interface StorageBufferDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** Allocation size in bytes; must be positive and four-byte aligned. */
    readonly byteLength: number;
    /** Intended roles. `storage` is mandatory and each role may appear only once. */
    readonly usage: readonly StorageBufferUsage[];
    /** Initial bytes copied into the CPU recovery shadow; remaining bytes start at zero. */
    readonly initialData?: ArrayBuffer | ArrayBufferView;
    /** Device-loss content policy. Defaults to `cpu-shadow`. */
    readonly recovery?: StorageBufferRecoveryPolicy;
}

/** Immutable aligned view used when binding part of a {@link StorageBuffer}. */
export interface StorageBufferRange {
    /** Source storage buffer. */
    readonly buffer: StorageBuffer;
    /** First bound byte. */
    readonly byteOffset: number;
    /** Number of bound bytes. */
    readonly byteLength: number;
}

/** Asynchronous snapshot returned by {@link StorageBuffer.read}. */
export interface StorageBufferReadback {
    /** Copied bytes for the requested range. */
    readonly data: Uint8Array;
    /** Source byte offset represented by `data`. */
    readonly byteOffset: number;
    /** Number of source bytes represented by `data`. */
    readonly byteLength: number;
}

/**
 * Renderer-owned persistent storage buffer shared by compute, copy, and GPU-driven raster passes.
 *
 * The object exposes no native WebGPU handle. Import it through the active Scriptable Render Graph
 * before using it in a pass.
 */
export interface StorageBuffer {
    /** Backend that owns the resource. Storage buffers are currently WebGPU-only. */
    readonly backend: RendererBackend;
    /** Stable diagnostic label. */
    readonly label: string;
    /** Allocation size in bytes. */
    readonly byteLength: number;
    /** Immutable set of roles declared at creation. */
    readonly usage: ReadonlySet<StorageBufferUsage>;
    /** Device-loss content policy. */
    readonly recovery: StorageBufferRecoveryPolicy;
    /** Whether {@link StorageBuffer.destroy} has released this public identity. */
    readonly isDestroyed: boolean;
    /** Queue a four-byte-aligned CPU update for the next frame that imports the buffer. */
    write(byteOffset: number, data: ArrayBufferView): void;
    /** Create an immutable four-byte-aligned binding range without allocating GPU state. */
    range(byteOffset: number, byteLength: number): StorageBufferRange;
    /**
     * Read a four-byte-aligned range after the next valid submission.
     *
     * A renderer accepts one pending storage-buffer readback at a time. Await this promise before
     * starting another read from any storage buffer owned by the same renderer.
     */
    read(byteOffset?: number, byteLength?: number): Promise<StorageBufferReadback>;
    /** Release the renderer-owned resource. Destruction is idempotent and submission-aware. */
    destroy(): void;
}

/** @internal Validated descriptor retained by the renderer implementation. */
export interface NormalizedStorageBufferDescriptor {
    readonly label: string;
    readonly byteLength: number;
    readonly usage: readonly StorageBufferUsage[];
    readonly recovery: StorageBufferRecoveryPolicy;
    readonly initialData: Uint8Array;
}

/** @internal Caller-owned dirty-span result used by renderer upload caches. */
export interface StorageBufferDirtySpan {
    byteOffset: number;
    byteLength: number;
}

/** @internal Renderer callbacks used by the public storage-buffer implementation. */
export interface StorageBufferHost {
    readonly backend: RendererBackend;
    assertStorageBufferMutationAllowed(operation: string): void;
    storageBufferWritten(buffer: RendererStorageBuffer): void;
    readStorageBuffer(
        buffer: RendererStorageBuffer,
        byteOffset: number,
        byteLength: number
    ): Promise<StorageBufferReadback>;
    storageBufferDestroyed(buffer: RendererStorageBuffer): void;
}

interface StorageBufferDirtyRange {
    readonly firstRevision: number;
    readonly revision: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}

const MAX_RETAINED_DIRTY_RANGES = 64;

class ImmutableUsageSet implements ReadonlySet<StorageBufferUsage> {
    readonly #values: Set<StorageBufferUsage>;

    constructor(values: readonly StorageBufferUsage[]) {
        this.#values = new Set(values);
        Object.freeze(this);
    }

    get size(): number {
        return this.#values.size;
    }

    has(value: StorageBufferUsage): boolean {
        return this.#values.has(value);
    }

    entries(): SetIterator<[StorageBufferUsage, StorageBufferUsage]> {
        return this.#values.entries();
    }

    keys(): SetIterator<StorageBufferUsage> {
        return this.#values.keys();
    }

    values(): SetIterator<StorageBufferUsage> {
        return this.#values.values();
    }

    forEach(
        callbackfn: (value: StorageBufferUsage, value2: StorageBufferUsage, set: this) => void,
        thisArg?: unknown
    ): void {
        for (const value of this.#values) callbackfn.call(thisArg, value, value, this);
    }

    [Symbol.iterator](): SetIterator<StorageBufferUsage> {
        return this.#values[Symbol.iterator]();
    }
}

function requireAlignedRange(
    byteLength: number,
    byteOffset: number,
    rangeByteLength: number,
    operation: string
): void {
    if (
        !Number.isSafeInteger(byteOffset) ||
        !Number.isSafeInteger(rangeByteLength) ||
        byteOffset < 0 ||
        rangeByteLength < 1 ||
        byteOffset + rangeByteLength > byteLength
    ) {
        throw new RangeError(
            `${operation} byte range [${String(byteOffset)}, ${String(byteOffset + rangeByteLength)}) is invalid`
        );
    }
    if (byteOffset % 4 !== 0 || rangeByteLength % 4 !== 0) {
        throw new RangeError(`${operation} byte offset and length must be 4-byte aligned`);
    }
}

function sourceBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (!ArrayBuffer.isView(data)) {
        throw new TypeError('Storage buffer data must be an ArrayBuffer or ArrayBufferView');
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function parseStorageBufferUsage(value: unknown): StorageBufferUsage {
    switch (value) {
        case 'storage':
        case 'vertex':
        case 'index':
        case 'indirect':
        case 'copy-source':
        case 'copy-destination':
            return value;
        default:
            throw new TypeError(`Unknown storage buffer usage ${String(value)}`);
    }
}

function parseRecoveryPolicy(value: unknown): StorageBufferRecoveryPolicy {
    if (value === 'cpu-shadow' || value === 'reinitialize') return value;
    throw new TypeError(`Unknown storage buffer recovery policy ${String(value)}`);
}

/** @internal Validate and snapshot public storage-buffer creation options. */
export function normalizeStorageBufferDescriptor(
    descriptor: Readonly<StorageBufferDescriptor>
): Readonly<NormalizedStorageBufferDescriptor> {
    if (descriptor.label !== undefined && typeof descriptor.label !== 'string') {
        throw new TypeError('Storage buffer label must be a string');
    }
    if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 4) {
        throw new RangeError('Storage buffer byteLength must be an integer of at least 4 bytes');
    }
    if (descriptor.byteLength % 4 !== 0) {
        throw new RangeError('Storage buffer byteLength must be 4-byte aligned');
    }
    const rawUsage: unknown = descriptor.usage;
    if (!Array.isArray(rawUsage) || rawUsage.length === 0) {
        throw new TypeError('Storage buffer usage must contain at least one purpose');
    }
    const usage = new Set<StorageBufferUsage>();
    const rawUsageValues: readonly unknown[] = rawUsage;
    for (const rawValue of rawUsageValues) {
        const value = parseStorageBufferUsage(rawValue);
        if (usage.has(value)) throw new TypeError(`Duplicate storage buffer usage ${value}`);
        usage.add(value);
    }
    if (!usage.has('storage')) {
        throw new TypeError('Storage buffer usage must include storage');
    }
    const initialData = new Uint8Array(descriptor.byteLength);
    if (descriptor.initialData !== undefined) {
        const source = sourceBytes(descriptor.initialData);
        if (source.byteLength > descriptor.byteLength) {
            throw new RangeError('Storage buffer initialData exceeds byteLength');
        }
        initialData.set(source);
    }
    const recovery = parseRecoveryPolicy(descriptor.recovery ?? 'cpu-shadow');
    return Object.freeze({
        label: descriptor.label ?? 'StorageBuffer',
        byteLength: descriptor.byteLength,
        usage: Object.freeze([...usage]),
        recovery,
        initialData
    });
}

/** @internal Renderer-owned public storage-buffer implementation. */
export class RendererStorageBuffer implements StorageBuffer {
    readonly backend: RendererBackend;
    readonly label: string;
    readonly byteLength: number;
    readonly usage: ReadonlySet<StorageBufferUsage>;
    readonly recovery: StorageBufferRecoveryPolicy;
    readonly #host: StorageBufferHost;
    readonly #data: ArrayBuffer;
    readonly #dirtyRanges: StorageBufferDirtyRange[] = [];
    #revision = 0;
    #gpuContentsMayDiffer = false;
    #destroyed = false;

    constructor(host: StorageBufferHost, descriptor: Readonly<StorageBufferDescriptor>) {
        const normalized = normalizeStorageBufferDescriptor(descriptor);
        this.#host = host;
        this.backend = host.backend;
        this.label = normalized.label;
        this.byteLength = normalized.byteLength;
        this.usage = new ImmutableUsageSet(normalized.usage);
        this.recovery = normalized.recovery;
        this.#data = new ArrayBuffer(normalized.byteLength);
        new Uint8Array(this.#data).set(normalized.initialData);
        this.recordDirty(0, this.byteLength);
    }

    get isDestroyed(): boolean {
        return this.#destroyed;
    }

    /** @internal Monotonic CPU-shadow revision consumed by renderer-local upload caches. */
    get revision(): number {
        return this.#revision;
    }

    write(byteOffset: number, data: ArrayBufferView): void {
        this.assertAlive('write');
        this.#host.assertStorageBufferMutationAllowed('write StorageBuffer');
        this.writeValidated(byteOffset, data);
    }

    /** @internal Pipeline-record upload path guarded by the renderer's active graph scope. */
    writeFromRenderPipeline(byteOffset: number, data: ArrayBufferView): void {
        this.assertAlive('write from RenderPipeline');
        this.writeValidated(byteOffset, data);
    }

    private writeValidated(byteOffset: number, data: ArrayBufferView): void {
        if (!this.usage.has('copy-destination')) {
            throw new TypeError('StorageBuffer.write() requires copy-destination usage');
        }
        const source = sourceBytes(data);
        requireAlignedRange(this.byteLength, byteOffset, source.byteLength, 'Storage buffer write');
        const target = new Uint8Array(this.#data);
        let start = 0;
        let end = source.byteLength;
        if (!this.#gpuContentsMayDiffer) {
            while (start < source.byteLength && target[byteOffset + start] === source[start])
                start += 1;
            if (start === source.byteLength) return;
            while (end > start && target[byteOffset + end - 1] === source[end - 1]) end -= 1;
        }
        target.set(source, byteOffset);
        this.recordDirty(byteOffset + start, byteOffset + end);
        this.#host.storageBufferWritten(this);
    }

    range(byteOffset: number, byteLength: number): StorageBufferRange {
        this.assertAlive('range');
        requireAlignedRange(this.byteLength, byteOffset, byteLength, 'Storage buffer binding');
        return Object.freeze({ buffer: this, byteOffset, byteLength });
    }

    async read(
        byteOffset = 0,
        byteLength = this.byteLength - byteOffset
    ): Promise<StorageBufferReadback> {
        this.assertAlive('read');
        if (!this.usage.has('copy-source')) {
            throw new TypeError('StorageBuffer.read() requires copy-source usage');
        }
        requireAlignedRange(this.byteLength, byteOffset, byteLength, 'Storage buffer read');
        return this.#host.readStorageBuffer(this, byteOffset, byteLength);
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#host.assertStorageBufferMutationAllowed('destroy StorageBuffer');
        this.#destroyed = true;
        this.#host.storageBufferDestroyed(this);
    }

    /** @internal Read-only CPU shadow; callers must snapshot before retaining bytes. */
    cpuData(): ArrayBuffer {
        this.assertAlive('access CPU shadow');
        return this.#data;
    }

    /**
     * @internal Recovery-only CPU shadow access retained until the registry recipe is retired.
     *
     * Public destruction releases the StorageBuffer identity immediately, while submission-aware
     * registry collection may keep its zero-reference recipe alive across device recovery. That
     * recipe must still be able to rebuild (and then retire) the old native allocation without
     * making any public operation on the destroyed identity valid again.
     */
    recoveryCpuData(): ArrayBuffer {
        return this.#data;
    }

    /** @internal Merge retained CPU writes into caller-owned storage without allocating. */
    getDirtySpanSince(revision: number, result: StorageBufferDirtySpan): boolean {
        this.assertRevision(revision);
        result.byteOffset = 0;
        result.byteLength = 0;
        let start = this.byteLength;
        let end = 0;
        for (const update of this.#dirtyRanges) {
            if (update.revision <= revision) continue;
            // A compacted record can only answer queries made before all of its writes. The
            // renderer cache acknowledges every successful submission, so its normal query is
            // always on that safe boundary. Returning false keeps other internal callers
            // conservative instead of treating an over-inclusive range as exact.
            if (revision >= update.firstRevision) return false;
            if (update.byteOffset < start) start = update.byteOffset;
            const updateEnd = update.byteOffset + update.byteLength;
            if (updateEnd > end) end = updateEnd;
        }
        if (end > start) {
            result.byteOffset = Math.floor(start / 4) * 4;
            result.byteLength = Math.ceil(end / 4) * 4 - result.byteOffset;
        }
        return true;
    }

    /** @internal Forget CPU writes incorporated into a committed or deliberately reset GPU baseline. */
    acknowledgeDirtyRevision(revision: number): void {
        this.assertAlive('acknowledge writes for');
        this.assertRevision(revision);
        let retained = 0;
        for (const update of this.#dirtyRanges) {
            if (update.revision <= revision) continue;
            this.#dirtyRanges[retained++] = update;
        }
        this.#dirtyRanges.length = retained;
    }

    /** @internal A submitted GPU write invalidates CPU-shadow equality as an upload shortcut. */
    noteGPUWrite(): void {
        this.assertAlive('record a GPU write for');
        this.#gpuContentsMayDiffer = true;
    }

    private assertAlive(operation: string): void {
        if (this.#destroyed) throw new Error(`Cannot ${operation} a destroyed StorageBuffer`);
    }

    private assertRevision(revision: number): void {
        if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.#revision) {
            throw new RangeError(
                `Storage buffer revision must be an integer in [0, ${String(this.#revision)}]`
            );
        }
    }

    private recordDirty(start: number, end: number): void {
        this.#revision += 1;
        this.#dirtyRanges.push({
            firstRevision: this.#revision,
            revision: this.#revision,
            byteOffset: start,
            byteLength: end - start
        });
        if (this.#dirtyRanges.length <= MAX_RETAINED_DIRTY_RANGES) return;

        // CPU mutation is forbidden while a renderer frame is active. All retained writes are
        // therefore newer than the last submitted GPU baseline and may be represented by one
        // conservative union without ever falling back to a whole-buffer shadow upload.
        const first = this.#dirtyRanges[0];
        if (first === undefined) return;
        let byteOffset = first.byteOffset;
        let byteEnd = first.byteOffset + first.byteLength;
        for (let index = 1; index < this.#dirtyRanges.length; index += 1) {
            const update = this.#dirtyRanges[index];
            if (update === undefined) continue;
            if (update.byteOffset < byteOffset) byteOffset = update.byteOffset;
            const updateEnd = update.byteOffset + update.byteLength;
            if (updateEnd > byteEnd) byteEnd = updateEnd;
        }
        this.#dirtyRanges.length = 1;
        this.#dirtyRanges[0] = {
            firstRevision: first.firstRevision,
            revision: this.#revision,
            byteOffset,
            byteLength: byteEnd - byteOffset
        };
    }
}
