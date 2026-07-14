import type UniformBuffer from '../common/UniformBuffer';
import { WebGPUDevice } from '../../rhi/webgpu/WebGPUDevice';
import type { Std140Layout } from '../common/ubo/Std140Layout';
import { WgslUniformLayout } from './WgslUniformLayout';
import { WebGPUBufferUsage } from './WebGPUConstants';

const MAX_UNIFORM_BUFFER_SLOTS_PER_SUBMISSION = 256;

export interface WebGPUUniformBufferBinding {
    readonly buffer: GPUBuffer;
    readonly offset: number;
    readonly size: number;
}

interface CachedUniformBufferSlot extends WebGPUUniformBufferBinding {
    revision: number;
    byteLength: number;
    data: Uint8Array;
}

interface CachedUniformBuffer {
    readonly slots: CachedUniformBufferSlot[];
    readonly submissionBindings: Map<number, CachedUniformBufferSlot>;
    submissionGeneration: number;
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

/** Uploads the shared std140 ABI consumed by portable WGSL uniform wrappers. */
export class WebGPUUniformBufferManager {
    private readonly owner: GPUDevice | WebGPUDevice;
    private readonly device: GPUDevice;
    private resources = new WeakMap<UniformBuffer, CachedUniformBuffer>();
    private layouts = new WeakMap<Std140Layout, WgslUniformLayout>();
    private readonly ownedBuffers = new Set<GPUBuffer>();
    private submissionActive = false;
    private submissionGeneration = 0;

    constructor(deviceOrOwner: GPUDevice | WebGPUDevice) {
        this.owner = deviceOrOwner;
        this.device =
            deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
    }

    /**
     * Preserve every logical UBO revision referenced by one command-buffer submission.
     * Slots are pooled and reused by the next submission after the previous one has been queued.
     */
    beginSubmission(): void {
        if (this.submissionActive) {
            throw new Error('A WebGPU uniform-buffer submission is already active');
        }
        this.submissionActive = true;
        this.submissionGeneration++;
    }

    endSubmission(): void {
        this.submissionActive = false;
    }

    getBinding(uniformBuffer: UniformBuffer): WebGPUUniformBufferBinding {
        const layout = uniformBuffer.layout;
        let wgslLayout = this.layouts.get(layout);
        if (!wgslLayout) {
            wgslLayout = new WgslUniformLayout(layout);
            this.layouts.set(layout, wgslLayout);
        }
        let resource = this.resources.get(uniformBuffer);
        if (!resource) {
            resource = {
                slots: [],
                submissionBindings: new Map(),
                submissionGeneration: -1
            };
            this.resources.set(uniformBuffer, resource);
        }
        if (!this.submissionActive) {
            return this.synchronizeSlot(resource, 0, uniformBuffer, wgslLayout);
        }
        if (resource.submissionGeneration !== this.submissionGeneration) {
            resource.submissionGeneration = this.submissionGeneration;
            resource.submissionBindings.clear();
        }
        const revision = uniformBuffer.revision;
        const cached = resource.submissionBindings.get(revision);
        if (cached) return cached;
        if (resource.submissionBindings.size >= MAX_UNIFORM_BUFFER_SLOTS_PER_SUBMISSION) {
            throw new RangeError(
                `One WebGPU submission cannot reference more than ${String(MAX_UNIFORM_BUFFER_SLOTS_PER_SUBMISSION)} revisions of the same uniform block`
            );
        }
        const slot = this.synchronizeSlot(
            resource,
            resource.submissionBindings.size,
            uniformBuffer,
            wgslLayout
        );
        resource.submissionBindings.set(revision, slot);
        return slot;
    }

    private synchronizeSlot(
        resource: CachedUniformBuffer,
        slotIndex: number,
        uniformBuffer: UniformBuffer,
        wgslLayout: WgslUniformLayout
    ): CachedUniformBufferSlot {
        let slot = resource.slots[slotIndex];
        if (slot?.revision === uniformBuffer.revision) return slot;

        const dirtyRanges = slot ? uniformBuffer.getDirtyRangesSince(slot.revision) : null;
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
        if (slot?.byteLength !== allocationSize) {
            const previousBuffer = slot?.buffer;
            previousBuffer?.destroy();
            if (previousBuffer) this.ownedBuffers.delete(previousBuffer);
            const descriptor: GPUBufferDescriptor = {
                label: `Uniform:${uniformBuffer.className}:${String(slotIndex)}`,
                size: allocationSize,
                usage: WebGPUBufferUsage.UNIFORM | WebGPUBufferUsage.COPY_DST
            };
            const buffer =
                this.owner instanceof WebGPUDevice
                    ? this.owner.createNativeBuffer(descriptor)
                    : this.owner.createBuffer(descriptor);
            this.ownedBuffers.add(buffer);
            slot = {
                buffer,
                offset: 0,
                size: data.byteLength,
                revision: uniformBuffer.revision,
                byteLength: allocationSize,
                data: bytes.slice()
            };
            resource.slots[slotIndex] = slot;
            if (this.owner instanceof WebGPUDevice) {
                this.owner.writeNativeBuffer(slot.buffer, 0, bytes);
            } else {
                this.owner.queue.writeBuffer(slot.buffer, 0, bytes);
            }
            return slot;
        }

        const range =
            dirtyRanges === null ? [0, bytes.byteLength] : changedByteRange(slot.data, bytes);
        if (range && range[1] > range[0]) {
            const [start, end] = range;
            const changed = bytes.subarray(start, end);
            if (this.owner instanceof WebGPUDevice) {
                this.owner.writeNativeBuffer(slot.buffer, start, changed);
            } else {
                this.owner.queue.writeBuffer(slot.buffer, start, changed);
            }
        }
        slot.data = bytes.slice();
        slot.revision = uniformBuffer.revision;
        return slot;
    }

    /** Release one logical block while leaving shared layout metadata reusable. */
    release(uniformBuffer: UniformBuffer): void {
        const resource = this.resources.get(uniformBuffer);
        if (!resource) return;
        for (const slot of resource.slots) {
            slot.buffer.destroy();
            this.ownedBuffers.delete(slot.buffer);
        }
        this.resources.delete(uniformBuffer);
    }

    destroy(): void {
        for (const buffer of this.ownedBuffers) buffer.destroy();
        this.ownedBuffers.clear();
        this.resources = new WeakMap();
        this.layouts = new WeakMap();
        this.submissionActive = false;
    }
}
