import type {
    RendererStorageBuffer,
    StorageBufferDirtySpan,
    StorageBufferUsage
} from '../StorageBuffer';
import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import {
    RHIBufferUsage,
    type RHIBuffer,
    type RHIBufferUsageFlags,
    type RHIDevice,
    type RHISubmission
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

type StorageBufferCacheState = 'idle' | 'active' | 'destroyed';

interface StorageBufferRecord {
    readonly source: RendererStorageBuffer;
    readonly usage: RHIBufferUsageFlags;
    handle: ResourceRegistryHandle<RHIBuffer> | null;
    committedRevision: number;
    registryGeneration: number;
    initialized: boolean;
    lastCreatedDeviceId: number;
    lastCreatedRevision: number;
}

interface PendingStorageBufferUse {
    readonly record: StorageBufferRecord;
    readonly handle: ResourceRegistryHandle<RHIBuffer>;
    readonly sourceRevision: number;
    readonly registryGeneration: number;
    readonly initializedAtFrameStart: boolean;
    initializedAfterCommit: boolean;
    gpuWrittenAfterCommit: boolean;
}

export interface StorageBufferResourceCacheDiagnostics {
    readonly usage: RHIBufferUsageFlags;
    readonly committedRevision: number;
    readonly sourceRevision: number;
    readonly registryGeneration: number;
    readonly initialized: boolean;
    readonly handle: ResourceRegistryHandle<RHIBuffer>;
}

function usageFlag(usage: StorageBufferUsage): RHIBufferUsageFlags {
    switch (usage) {
        case 'storage':
            return RHIBufferUsage.STORAGE;
        case 'vertex':
            return RHIBufferUsage.VERTEX;
        case 'index':
            return RHIBufferUsage.INDEX;
        case 'indirect':
            return RHIBufferUsage.INDIRECT;
        case 'copy-source':
            return RHIBufferUsage.COPY_SRC;
        case 'copy-destination':
            return RHIBufferUsage.COPY_DST;
    }
}

function rhiUsage(source: RendererStorageBuffer): RHIBufferUsageFlags {
    let result = 0;
    for (const usage of source.usage) result |= usageFlag(usage);
    return result;
}

function requireHandle(record: StorageBufferRecord): ResourceRegistryHandle<RHIBuffer> {
    if (record.handle === null) throw new Error('Storage buffer record has no registry handle');
    return record.handle;
}

function createRegistryBuffer(record: StorageBufferRecord, device: RHIDevice): RHIBuffer {
    const restoreCpuShadow =
        record.lastCreatedDeviceId === 0 || record.source.recovery === 'cpu-shadow';
    const initialData = restoreCpuShadow
        ? new Uint8Array(record.source.recoveryCpuData()).slice()
        : undefined;
    const resource = device.createBuffer({
        label: record.source.label,
        lifetime: 'persistent',
        size: record.source.byteLength,
        usage: record.usage,
        ...(initialData === undefined ? {} : { initialData })
    });
    record.lastCreatedDeviceId = resource.deviceId;
    record.lastCreatedRevision = restoreCpuShadow ? record.source.revision : -1;
    return resource;
}

/** Renderer-local transactional cache for public StorageBuffer identities. */
export class StorageBufferResourceCache implements RHIUploadBatchParticipant {
    readonly #records = new WeakMap<RendererStorageBuffer, StorageBufferRecord>();
    readonly #recordSet = new Set<StorageBufferRecord>();
    readonly #pending = new Map<StorageBufferRecord, PendingStorageBufferUse>();
    readonly #capturedRevisions = new Map<RendererStorageBuffer, number>();
    readonly #dirtySpan: StorageBufferDirtySpan = { byteOffset: 0, byteLength: 0 };
    #state: StorageBufferCacheState = 'idle';
    #frameIndex = 0;
    #uploads: RHIUploadBatch | null = null;

    constructor(readonly registry: ResourceRegistry) {}

    get active(): boolean {
        return this.#state === 'active';
    }

    beginFrame(frameIndex: number, uploads: RHIUploadBatch): void {
        if (this.#state === 'destroyed') throw new Error('Storage buffer cache is destroyed');
        if (this.#state === 'active')
            throw new Error('Storage buffer cache frame is already active');
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
            throw new RangeError('Storage buffer cache frame index must be non-negative');
        }
        this.#frameIndex = frameIndex;
        this.#uploads = uploads;
        this.#state = 'active';
        uploads.enlist(this);
    }

    prepare(source: RendererStorageBuffer): RHIBuffer {
        this.assertActive();
        if (source.isDestroyed) throw new Error('Cannot prepare a destroyed StorageBuffer');
        const revision = this.captureRevision(source);
        let record = this.#records.get(source);
        record ??= this.createRecord(source);
        this.synchronizeRecord(record);
        const existing = this.#pending.get(record);
        if (existing !== undefined) return this.registry.resolve(existing.handle);

        const handle = requireHandle(record);
        const resource = this.registry.resolve(handle);
        let initializedAtFrameStart = record.initialized;
        if (record.committedRevision !== revision) {
            const retained =
                record.committedRevision >= 0
                    ? source.getDirtySpanSince(record.committedRevision, this.#dirtySpan)
                    : false;
            const fullUpload = !retained;
            const byteOffset = fullUpload ? 0 : this.#dirtySpan.byteOffset;
            const byteLength = fullUpload ? source.byteLength : this.#dirtySpan.byteLength;
            if (byteLength > 0) {
                this.requireUploads().writeBuffer(
                    resource,
                    byteOffset,
                    source.cpuData(),
                    byteOffset,
                    byteLength
                );
            }
            if (byteOffset === 0 && byteLength === source.byteLength) {
                initializedAtFrameStart = true;
            }
        }
        this.#pending.set(record, {
            record,
            handle,
            sourceRevision: revision,
            registryGeneration: this.registry.generation,
            initializedAtFrameStart,
            initializedAfterCommit: initializedAtFrameStart,
            gpuWrittenAfterCommit: false
        });
        return resource;
    }

    getHandle(source: RendererStorageBuffer): ResourceRegistryHandle<RHIBuffer> {
        const record = this.requirePreparedRecord(source);
        return this.requirePending(record).handle;
    }

    isInitializedAtFrameStart(source: RendererStorageBuffer): boolean {
        const record = this.requirePreparedRecord(source);
        return this.requirePending(record).initializedAtFrameStart;
    }

    stageCompleteGPUWrite(source: RendererStorageBuffer): void {
        const record = this.requirePreparedRecord(source);
        const pending = this.requirePending(record);
        pending.initializedAfterCommit = true;
        pending.gpuWrittenAfterCommit = true;
    }

    /** Stage a possibly partial GPU mutation without claiming complete initialization. */
    stageGPUWrite(source: RendererStorageBuffer): void {
        const record = this.requirePreparedRecord(source);
        this.requirePending(record).gpuWrittenAfterCommit = true;
    }

    prepareCommit(submission: RHISubmission): void {
        if (this.#state !== 'active') return;
        if (submission.status === 'failed') {
            throw submission.error instanceof Error
                ? submission.error
                : new Error('Cannot commit a failed storage-buffer submission');
        }
        if (submission.deviceId !== this.registry.deviceId) {
            throw new Error('Storage buffer submission belongs to another RHI device');
        }
        for (const [source, revision] of this.#capturedRevisions) {
            if (source.revision !== revision) {
                throw new Error('StorageBuffer changed after its first use in one frame');
            }
        }
        for (const pending of this.#pending.values()) {
            if (pending.registryGeneration !== this.registry.generation) {
                throw new Error('Storage buffer belongs to a stale registry generation');
            }
            const buffer = this.registry.resolve(pending.handle);
            if (buffer.deviceId !== submission.deviceId) {
                throw new Error('Storage buffer belongs to another submission device');
            }
        }
    }

    commit(submission: RHISubmission): void {
        if (this.#state !== 'active') return;
        this.prepareCommit(submission);
        for (const pending of this.#pending.values()) {
            this.registry.markUsed(pending.handle, this.#frameIndex);
            pending.record.committedRevision = pending.sourceRevision;
            pending.record.registryGeneration = pending.registryGeneration;
            pending.record.initialized = pending.initializedAfterCommit;
            pending.record.source.acknowledgeDirtyRevision(pending.sourceRevision);
            if (pending.gpuWrittenAfterCommit) pending.record.source.noteGPUWrite();
        }
        this.finishFrame();
    }

    rollback(): void {
        if (this.#state !== 'active') return;
        this.finishFrame();
    }

    detach(source: RendererStorageBuffer): boolean {
        this.assertIdle();
        const record = this.#records.get(source);
        if (record === undefined) return false;
        this.#records.delete(source);
        this.#recordSet.delete(record);
        this.registry.release(requireHandle(record));
        record.handle = null;
        return true;
    }

    diagnostics(
        source: RendererStorageBuffer
    ): Readonly<StorageBufferResourceCacheDiagnostics> | null {
        const record = this.#records.get(source);
        if (record === undefined) return null;
        this.synchronizeRecord(record);
        return Object.freeze({
            usage: record.usage,
            committedRevision: record.committedRevision,
            sourceRevision: source.revision,
            registryGeneration: record.registryGeneration,
            initialized: record.initialized,
            handle: requireHandle(record)
        });
    }

    /** Capture the new device-generation recovery boundary before application writes resume. */
    synchronizeAfterRecovery(): void {
        this.assertIdle();
        for (const record of this.#recordSet) this.synchronizeRecord(record);
    }

    destroy(): void {
        if (this.#state === 'destroyed') return;
        this.assertIdle();
        for (const record of this.#recordSet) {
            this.registry.release(requireHandle(record));
            record.handle = null;
        }
        this.#recordSet.clear();
        this.#pending.clear();
        this.#capturedRevisions.clear();
        this.#state = 'destroyed';
    }

    private createRecord(source: RendererStorageBuffer): StorageBufferRecord {
        const record: StorageBufferRecord = {
            source,
            usage: rhiUsage(source),
            handle: null,
            committedRevision: -1,
            registryGeneration: this.registry.generation,
            initialized: true,
            lastCreatedDeviceId: 0,
            lastCreatedRevision: -1
        };
        record.handle = this.registry.register({
            label: source.label,
            create: device => createRegistryBuffer(record, device)
        });
        record.committedRevision = record.lastCreatedRevision;
        if (record.committedRevision >= 0) {
            source.acknowledgeDirtyRevision(record.committedRevision);
        }
        this.#records.set(source, record);
        this.#recordSet.add(record);
        return record;
    }

    private synchronizeRecord(record: StorageBufferRecord): void {
        if (record.registryGeneration === this.registry.generation) return;
        record.registryGeneration = this.registry.generation;
        if (record.source.recovery === 'cpu-shadow') {
            record.committedRevision = record.lastCreatedRevision;
            record.initialized = true;
            record.source.acknowledgeDirtyRevision(record.committedRevision);
            return;
        }
        // A reinitialize recipe deliberately creates an empty allocation after device loss. Treat
        // the current CPU revision as acknowledged so stale shadow bytes are not silently restored;
        // later CPU writes are still uploaded transactionally from this recovery boundary.
        record.committedRevision = record.source.revision;
        record.initialized = false;
        record.source.acknowledgeDirtyRevision(record.committedRevision);
    }

    private captureRevision(source: RendererStorageBuffer): number {
        const captured = this.#capturedRevisions.get(source);
        if (captured !== undefined) return captured;
        const revision = source.revision;
        this.#capturedRevisions.set(source, revision);
        return revision;
    }

    private requirePreparedRecord(source: RendererStorageBuffer): StorageBufferRecord {
        this.assertActive();
        const record = this.#records.get(source);
        if (record === undefined || !this.#pending.has(record)) {
            throw new Error('StorageBuffer must be prepared before graph access');
        }
        return record;
    }

    private requirePending(record: StorageBufferRecord): PendingStorageBufferUse {
        const pending = this.#pending.get(record);
        if (pending === undefined) throw new Error('StorageBuffer has no pending frame use');
        return pending;
    }

    private requireUploads(): RHIUploadBatch {
        if (this.#uploads === null) throw new Error('Storage buffer cache has no upload batch');
        return this.#uploads;
    }

    private finishFrame(): void {
        this.#pending.clear();
        this.#capturedRevisions.clear();
        this.#uploads = null;
        this.#state = 'idle';
    }

    private assertActive(): void {
        if (this.#state !== 'active') {
            throw new Error(
                this.#state === 'destroyed'
                    ? 'Storage buffer cache is destroyed'
                    : 'Storage buffer cache requires beginFrame before use'
            );
        }
    }

    private assertIdle(): void {
        if (this.#state === 'active') {
            throw new Error('Cannot mutate storage buffer cache during an active frame');
        }
        if (this.#state === 'destroyed') throw new Error('Storage buffer cache is destroyed');
    }
}
