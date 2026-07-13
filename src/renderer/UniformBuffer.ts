import Buffer from './Buffer';
import type {
    Std140FieldValue,
    Std140Layout,
    Std140Schema,
    Std140Values
} from './ubo/Std140Layout';
import type { TypedArray } from './types';

export type UniformBufferData = TypedArray | ArrayBuffer;
export interface UniformBufferRange {
    readonly uniformBuffer: UniformBuffer;
    readonly byteOffset: number;
    readonly byteLength: number;
}

interface ContextResource {
    buffer: Buffer;
    byteLength: number;
    version: number;
}

interface DirtyUpdate {
    version: number;
    start: number;
    end: number;
}

function byteView(data: UniformBufferData): Uint8Array {
    return data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * Uniform Buffer Object
 */
class UniformBuffer<Schema extends Std140Schema = Std140Schema> {
    readonly className = 'UniformBuffer';
    readonly isUniformBuffer = true;
    /**
     * is dirty
     */
    get isDirty(): boolean {
        return this.dirtyUpdates.length > 0;
    }
    set isDirty(value: boolean) {
        if (value) this.markDirty();
    }
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
        if (this.layout && data.byteLength < this.layout.byteLength) {
            throw new RangeError(
                `Uniform buffer is ${String(data.byteLength)} bytes; std140 layout requires ${String(this.layout.byteLength)}`
            );
        }
        this._data = data;
        this.recordDirty(0, data.byteLength);
    }
    /**
     * data
     */
    private _data: UniformBufferData = new ArrayBuffer(0);
    readonly layout: Std140Layout<Schema> | null;
    private readonly resources = new Map<WebGL2RenderingContext, ContextResource>();
    private readonly dirtyUpdates: DirtyUpdate[] = [];
    private version = 0;

    constructor(data: UniformBufferData, layout?: Std140Layout<Schema>) {
        this.layout = layout ?? null;
        this.data = data;
    }

    static fromSchema<const Schema extends Std140Schema>(
        layout: Std140Layout<Schema>,
        values: Partial<Std140Values<Schema>> = {}
    ): UniformBuffer<Schema> {
        return new UniformBuffer(layout.createBuffer(values), layout);
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
        if (!this.layout || !(this.data instanceof ArrayBuffer)) {
            throw new Error('UniformBuffer.set requires an ArrayBuffer-backed std140 layout');
        }
        const dirty = this.layout.write(this.data, name, value);
        this.recordDirty(dirty.byteOffset, dirty.byteOffset + dirty.byteLength);
        return this;
    }

    range(byteOffset: number, byteLength: number): UniformBufferRange {
        this.assertRange(byteOffset, byteLength);
        return Object.freeze({ uniformBuffer: this, byteOffset, byteLength });
    }

    getBuffer(gl: WebGL2RenderingContext): Buffer {
        let resource = this.resources.get(gl);
        if (!resource) {
            const buffer = new Buffer(gl, gl.UNIFORM_BUFFER, this.data, gl.DYNAMIC_DRAW);
            resource = { buffer, byteLength: this.byteLength, version: this.version };
            this.resources.set(gl, resource);
            this.pruneDirtyUpdates();
            return buffer;
        }
        if (resource.version !== this.version) {
            if (resource.byteLength !== this.byteLength) {
                resource.buffer.bufferData(this.data);
                resource.byteLength = this.byteLength;
            } else {
                let start = this.byteLength;
                let end = 0;
                for (const update of this.dirtyUpdates) {
                    if (update.version <= resource.version) continue;
                    start = Math.min(start, update.start);
                    end = Math.max(end, update.end);
                }
                if (end > start) {
                    resource.buffer.bufferSubData(start, byteView(this.data).subarray(start, end));
                }
            }
            resource.version = this.version;
            this.pruneDirtyUpdates();
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
        this.version++;
        this.dirtyUpdates.push({ version: this.version, start, end });
    }

    private pruneDirtyUpdates(): void {
        if (this.resources.size === 0) return;
        let minimumVersion = this.version;
        for (const resource of this.resources.values()) {
            minimumVersion = Math.min(minimumVersion, resource.version);
        }
        while ((this.dirtyUpdates[0]?.version ?? Infinity) <= minimumVersion) {
            this.dirtyUpdates.shift();
        }
    }
}
export default UniformBuffer;
