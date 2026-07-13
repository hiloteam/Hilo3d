import type UniformBuffer from '../UniformBuffer';
import type { Std140Layout } from '../ubo/Std140Layout';
import { WgslUniformLayout } from './WgslUniformLayout';
import { WebGPUBufferUsage } from './WebGPUConstants';

export interface WebGPUUniformBufferBinding {
    readonly buffer: GPUBuffer;
    readonly offset: number;
    readonly size: number;
}

interface CachedUniformBuffer extends WebGPUUniformBufferBinding {
    revision: number;
    byteLength: number;
    data: Uint8Array;
}

function alignedUniformByteLength(byteLength: number): number {
    return Math.max(16, Math.ceil(byteLength / 16) * 16);
}

function changedByteRange(
    previous: Uint8Array,
    current: Uint8Array
): readonly [start: number, end: number] | null {
    let start = 0;
    while (start < current.length && previous[start] === current[start]) start++;
    if (start === current.length) return null;
    let end = current.length;
    while (end > start && previous[end - 1] === current[end - 1]) end--;
    return [Math.floor(start / 4) * 4, Math.ceil(end / 4) * 4];
}

/** Transcodes logical std140 parameter blocks into WGSL natural-layout device buffers. */
export class WebGPUUniformBufferManager {
    private readonly device: GPUDevice;
    private resources = new WeakMap<UniformBuffer, CachedUniformBuffer>();
    private layouts = new WeakMap<Std140Layout, WgslUniformLayout>();
    private readonly ownedBuffers = new Set<GPUBuffer>();

    constructor(device: GPUDevice) {
        this.device = device;
    }

    getBinding(uniformBuffer: UniformBuffer): WebGPUUniformBufferBinding {
        const layout = uniformBuffer.layout;
        if (!layout || !(uniformBuffer.data instanceof ArrayBuffer)) {
            throw new TypeError(
                'WebGPU uniform buffers require UniformBuffer.fromSchema with an ArrayBuffer-backed layout'
            );
        }
        let wgslLayout = this.layouts.get(layout);
        if (!wgslLayout) {
            wgslLayout = new WgslUniformLayout(layout);
            this.layouts.set(layout, wgslLayout);
        }
        let resource = this.resources.get(uniformBuffer);
        if (resource?.revision !== uniformBuffer.revision) {
            const dirtyRanges = resource
                ? uniformBuffer.getDirtyRangesSince(resource.revision)
                : null;
            const data = wgslLayout.transcode(uniformBuffer.data);
            const bytes = new Uint8Array(data);
            const allocationSize = alignedUniformByteLength(data.byteLength);
            if (data.byteLength > this.device.limits.maxUniformBufferBindingSize) {
                throw new RangeError(
                    `WebGPU uniform block size ${String(data.byteLength)} exceeds maxUniformBufferBindingSize ${String(this.device.limits.maxUniformBufferBindingSize)}`
                );
            }
            if (allocationSize > this.device.limits.maxBufferSize) {
                throw new RangeError(
                    `WebGPU uniform allocation ${String(allocationSize)} exceeds maxBufferSize ${String(this.device.limits.maxBufferSize)}`
                );
            }
            if (resource?.byteLength !== allocationSize) {
                const previousBuffer = resource?.buffer;
                previousBuffer?.destroy();
                if (previousBuffer) this.ownedBuffers.delete(previousBuffer);
                const buffer = this.device.createBuffer({
                    label: `Uniform:${uniformBuffer.className}`,
                    size: allocationSize,
                    usage: WebGPUBufferUsage.UNIFORM | WebGPUBufferUsage.COPY_DST
                });
                this.ownedBuffers.add(buffer);
                resource = {
                    buffer,
                    offset: 0,
                    size: data.byteLength,
                    revision: uniformBuffer.revision,
                    byteLength: allocationSize,
                    data: bytes.slice()
                };
                this.resources.set(uniformBuffer, resource);
                this.device.queue.writeBuffer(resource.buffer, 0, bytes);
            } else {
                const range =
                    dirtyRanges === null
                        ? [0, bytes.byteLength]
                        : changedByteRange(resource.data, bytes);
                if (range && range[1] > range[0]) {
                    const [start, end] = range;
                    this.device.queue.writeBuffer(
                        resource.buffer,
                        start,
                        bytes.subarray(start, end)
                    );
                }
                resource.data = bytes.slice();
            }
            resource.revision = uniformBuffer.revision;
        }
        return resource;
    }

    /** Release one logical block while leaving shared layout metadata reusable. */
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
        this.layouts = new WeakMap();
    }
}
