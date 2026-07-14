import type { UniformBufferRange } from '../../UniformBuffer';
import type UniformBuffer from '../../UniformBuffer';
import Buffer from './Buffer';
import type { GLContext } from './WebGLTypes';

interface CachedUniformBuffer {
    readonly buffer: Buffer;
    byteLength: number;
    revision: number;
}

function byteView(data: ArrayBuffer): Uint8Array {
    return new Uint8Array(data);
}

/** Owns WebGL2 allocations for backend-neutral logical uniform blocks. */
export class WebGLUniformBufferManager {
    private readonly gl: GLContext;
    private resources = new WeakMap<UniformBuffer, CachedUniformBuffer>();
    private readonly ownedBuffers = new Set<Buffer>();

    constructor(gl: GLContext) {
        this.gl = gl;
    }

    getBuffer(uniformBuffer: UniformBuffer): Buffer {
        let resource = this.resources.get(uniformBuffer);
        if (!resource) {
            const buffer = new Buffer(
                this.gl,
                this.gl.UNIFORM_BUFFER,
                uniformBuffer.data,
                this.gl.DYNAMIC_DRAW
            );
            resource = {
                buffer,
                byteLength: uniformBuffer.byteLength,
                revision: uniformBuffer.revision
            };
            this.resources.set(uniformBuffer, resource);
            this.ownedBuffers.add(buffer);
            return buffer;
        }

        if (resource.revision === uniformBuffer.revision) return resource.buffer;
        const updates = uniformBuffer.getDirtyRangesSince(resource.revision);
        if (resource.byteLength !== uniformBuffer.byteLength || updates === null) {
            resource.buffer.bufferData(uniformBuffer.data);
            resource.byteLength = uniformBuffer.byteLength;
        } else {
            let start = uniformBuffer.byteLength;
            let end = 0;
            for (const update of updates) {
                start = Math.min(start, update.byteOffset);
                end = Math.max(end, update.byteOffset + update.byteLength);
            }
            if (end > start) {
                resource.buffer.bufferSubData(
                    start,
                    byteView(uniformBuffer.data).subarray(start, end)
                );
            }
        }
        resource.revision = uniformBuffer.revision;
        return resource.buffer;
    }

    bind(uniformBuffer: UniformBuffer, bindingPoint: number, range?: UniformBufferRange): void {
        const buffer = this.getBuffer(uniformBuffer).buffer;
        if (!range) {
            this.gl.bindBufferBase(this.gl.UNIFORM_BUFFER, bindingPoint, buffer);
            return;
        }
        if (range.uniformBuffer !== uniformBuffer) {
            throw new TypeError('Uniform buffer range owner mismatch');
        }
        const alignment = this.gl.getParameter(this.gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
        if (range.byteOffset % alignment !== 0) {
            throw new RangeError(
                `Uniform buffer range offset ${String(range.byteOffset)} is not aligned to ${String(alignment)}`
            );
        }
        this.gl.bindBufferRange(
            this.gl.UNIFORM_BUFFER,
            bindingPoint,
            buffer,
            range.byteOffset,
            range.byteLength
        );
    }

    release(uniformBuffer: UniformBuffer): void {
        const resource = this.resources.get(uniformBuffer);
        if (!resource) return;
        resource.buffer.destroy();
        this.ownedBuffers.delete(resource.buffer);
        this.resources.delete(uniformBuffer);
    }

    destroy(): void {
        for (const buffer of this.ownedBuffers) buffer.destroy();
        this.ownedBuffers.clear();
        this.resources = new WeakMap();
    }
}
