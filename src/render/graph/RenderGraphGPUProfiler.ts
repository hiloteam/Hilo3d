import {
    RHIBufferUsage,
    type RHIBuffer,
    type RHICommandContext,
    type RHIDevice,
    type RHIQuerySet,
    type RHISubmission,
    type RHITimestampWrites
} from '../rhi/core';
import type { RenderGraphTimelineRecorder } from './RenderGraphTimeline';

const MAX_IN_FLIGHT_TIMELINES = 3;
const MAX_TIMESTAMP_QUERY_COUNT = 8192;

interface TimestampSlot {
    deviceId: number;
    generation: number;
    capacity: number;
    querySet: RHIQuerySet;
    resolveBuffer: RHIBuffer;
    readbackBuffer: RHIBuffer;
    busy: boolean;
    disposeWhenFree: boolean;
}

function queryCapacity(required: number): number {
    let capacity = 2;
    while (capacity < required) capacity *= 2;
    return capacity;
}

function destroySlot(slot: TimestampSlot): void {
    slot.querySet.destroy();
    slot.resolveBuffer.destroy();
    slot.readbackBuffer.destroy();
}

function createSlot(device: RHIDevice, capacity: number): TimestampSlot {
    let querySet: RHIQuerySet | null = null;
    let resolveBuffer: RHIBuffer | null = null;
    let readbackBuffer: RHIBuffer | null = null;
    try {
        querySet = device.createQuerySet({
            label: 'Render Graph timestamp queries',
            lifetime: 'persistent',
            type: 'timestamp',
            count: capacity
        });
        resolveBuffer = device.createBuffer({
            label: 'Render Graph timestamp resolve',
            lifetime: 'persistent',
            size: capacity * 8,
            usage: RHIBufferUsage.QUERY_RESOLVE | RHIBufferUsage.COPY_SRC
        });
        readbackBuffer = device.createBuffer({
            label: 'Render Graph timestamp readback',
            lifetime: 'persistent',
            size: capacity * 8,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        return {
            deviceId: device.id,
            generation: device.generation,
            capacity,
            querySet,
            resolveBuffer,
            readbackBuffer,
            busy: false,
            disposeWhenFree: false
        };
    } catch (error) {
        readbackBuffer?.destroy();
        resolveBuffer?.destroy();
        querySet?.destroy();
        throw error;
    }
}

/** @internal One submission's timestamp plan and asynchronous readback ownership. */
export class RenderGraphGPUProfileFrame {
    readonly #queryPassIndices: number[] = [];
    #queryCount = 0;
    #settled = false;

    constructor(
        readonly slot: TimestampSlot,
        readonly recorder: RenderGraphTimelineRecorder,
        readonly release: (slot: TimestampSlot) => void
    ) {}

    timestampWrites(passIndex: number): Readonly<RHITimestampWrites> {
        const beginningOfPassWriteIndex = this.#queryCount;
        this.#queryCount += 2;
        this.#queryPassIndices.push(passIndex);
        return Object.freeze({
            querySet: this.slot.querySet,
            beginningOfPassWriteIndex,
            endOfPassWriteIndex: beginningOfPassWriteIndex + 1
        });
    }

    resolve(context: RHICommandContext): void {
        if (this.#queryCount === 0) return;
        context.resolveQuerySet(this.slot.querySet, 0, this.#queryCount, this.slot.resolveBuffer);
        context.copyBufferToBuffer(
            this.slot.resolveBuffer,
            0,
            this.slot.readbackBuffer,
            0,
            this.#queryCount * 8
        );
    }

    submitted(submission: RHISubmission): void {
        if (this.#queryCount === 0) {
            this.releaseSlot();
            return;
        }
        this.recorder.markGPUPending();
        const byteLength = this.#queryCount * 8;
        void submission.done
            .then(async () => {
                await this.slot.readbackBuffer.mapAsync('read', 0, byteLength);
                const mapped = this.slot.readbackBuffer.getMappedRange(0, byteLength);
                const timestamps = new BigUint64Array(
                    new BigUint64Array(mapped, 0, this.#queryCount)
                );
                this.slot.readbackBuffer.unmap();
                this.releaseSlot();
                this.recorder.completeGPU(this.#queryPassIndices, timestamps);
            })
            .catch(() => {
                if (this.slot.readbackBuffer.mapState === 'mapped') {
                    try {
                        this.slot.readbackBuffer.unmap();
                    } catch {
                        // Device loss may make even cleanup validation unavailable.
                    }
                }
                this.releaseSlot();
                this.recorder.failGPU();
            });
    }

    abort(): void {
        this.releaseSlot();
    }

    private releaseSlot(): void {
        if (this.#settled) return;
        this.#settled = true;
        this.release(this.slot);
    }
}

/** @internal Small timestamp-query ring; it exists only when a timeline sink is registered. */
export class RenderGraphGPUProfiler {
    readonly #slots: TimestampSlot[] = [];
    #destroyed = false;
    readonly #releaseSlot = (slot: TimestampSlot): void => {
        slot.busy = false;
        if (slot.disposeWhenFree || this.#destroyed) {
            destroySlot(slot);
            const index = this.#slots.indexOf(slot);
            if (index >= 0) this.#slots.splice(index, 1);
        }
    };

    begin(
        device: RHIDevice,
        recorder: RenderGraphTimelineRecorder
    ): RenderGraphGPUProfileFrame | null {
        if (this.#destroyed || !device.capabilities.features.has('timestamp-query')) {
            recorder.markGPUUnavailable('unavailable');
            return null;
        }
        const passCount = recorder.timestampPassCount;
        if (passCount === 0) {
            recorder.markGPUUnavailable('unavailable');
            return null;
        }
        const required = passCount * 2;
        if (required > MAX_TIMESTAMP_QUERY_COUNT) {
            recorder.markGPUUnavailable('saturated');
            return null;
        }
        let slot = this.#slots.find(
            candidate =>
                !candidate.busy &&
                candidate.deviceId === device.id &&
                candidate.generation === device.generation &&
                candidate.capacity >= required
        );
        if (slot === undefined) {
            slot = this.#slots.find(candidate => !candidate.busy);
            if (slot !== undefined) {
                destroySlot(slot);
                const index = this.#slots.indexOf(slot);
                this.#slots.splice(index, 1);
                slot = undefined;
            }
        }
        if (slot === undefined && this.#slots.length < MAX_IN_FLIGHT_TIMELINES) {
            const capacity = queryCapacity(required);
            slot = createSlot(device, capacity);
            this.#slots.push(slot);
        }
        if (slot === undefined) {
            recorder.markGPUUnavailable('saturated');
            return null;
        }
        slot.busy = true;
        return new RenderGraphGPUProfileFrame(slot, recorder, this.#releaseSlot);
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        for (let index = this.#slots.length - 1; index >= 0; index -= 1) {
            const slot = this.#slots[index];
            if (slot === undefined) continue;
            if (slot.busy) slot.disposeWhenFree = true;
            else {
                destroySlot(slot);
                this.#slots.splice(index, 1);
            }
        }
    }
}
