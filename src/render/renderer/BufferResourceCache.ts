import type GeometryData from '../../geometry/GeometryData';
import type UniformBuffer from '../UniformBuffer';
import type { RHIUploadBatch, RHIUploadBatchParticipant } from '../frame/RHIUploadBatch';
import {
    RHIBufferUsage,
    type RHIBuffer,
    type RHIBufferUsageFlags,
    type RHIDevice,
    type RHISubmission
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';
import { isUint8RHIIndexSource, mapPortableRHIIndexFormat } from './RHIIndexPreparation';

export type BufferResourceKind = 'vertex' | 'index' | 'uniform';
type BufferSource = GeometryData | UniformBuffer;
type CacheState = 'idle' | 'active' | 'destroyed';
type IndexBufferVariant = 'plain' | 'primitive-restart';

export interface IndexBufferPreparationOptions {
    /** Remap Uint8's strip-restart marker from `0xff` to Uint16's `0xffff`. */
    readonly primitiveRestart?: boolean;
}

interface GeometryBufferRecords {
    vertex: BufferResourceRecord | null;
    index: BufferResourceRecord | null;
    indexPrimitiveRestart: BufferResourceRecord | null;
}

interface BufferResourceRecord {
    readonly source: BufferSource;
    readonly kind: BufferResourceKind;
    readonly usage: RHIBufferUsageFlags;
    readonly indexVariant: IndexBufferVariant | null;
    /** All GeometryData aliases for one canonical vertex byte range; null for other kinds. */
    readonly vertexSources: GeometryData[] | null;
    readonly committedVertexRevisions: Map<GeometryData, number> | null;
    readonly lastCreatedVertexRevisions: Map<GeometryData, number> | null;
    vertexBufferViewId: string | null;
    handle: ResourceRegistryHandle<RHIBuffer> | null;
    allocatedSize: number;
    committedRevision: number;
    registryGeneration: number;
    lastCreatedDeviceId: number;
    lastCreatedRevision: number;
    lastCreatedSize: number;
}

interface PendingBufferUse {
    readonly record: BufferResourceRecord;
    readonly handle: ResourceRegistryHandle<RHIBuffer>;
    readonly sourceRevision: number;
    readonly allocatedSize: number;
    readonly registryGeneration: number;
    fullUploadStaged: boolean;
}

export interface BufferResourceCacheDiagnostics {
    readonly kind: BufferResourceKind;
    readonly usage: RHIBufferUsageFlags;
    readonly allocatedSize: number;
    /** `-1` means no successful graph execution has committed this allocation yet. */
    readonly committedRevision: number;
    readonly sourceRevision: number;
    readonly registryGeneration: number;
    readonly handle: ResourceRegistryHandle<RHIBuffer>;
}

function sourceRevision(source: BufferSource): number {
    return source.revision;
}

function directSourceBytes(record: BufferResourceRecord): Uint8Array {
    if (record.kind === 'uniform') return new Uint8Array((record.source as UniformBuffer).data);
    const data = (record.source as GeometryData).data;
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function vertexArrayStride(source: GeometryData): number {
    return source.stride === 0 ? source.size * source.data.BYTES_PER_ELEMENT : source.stride;
}

function sharesExactByteRange(left: GeometryData, right: GeometryData): boolean {
    return (
        left.data === right.data ||
        (left.data.buffer === right.data.buffer &&
            left.data.byteOffset === right.data.byteOffset &&
            left.data.byteLength === right.data.byteLength)
    );
}

function requireCanonicalVertexAlias(canonical: GeometryData, candidate: GeometryData): void {
    if (canonical.bufferViewId !== candidate.bufferViewId) {
        throw new TypeError('Canonical vertex buffer aliases must share one bufferViewId');
    }
    if (!sharesExactByteRange(canonical, candidate)) {
        throw new TypeError(
            `Vertex sources sharing bufferViewId ${candidate.bufferViewId} must reference the exact same underlying byte range`
        );
    }
    if (vertexArrayStride(canonical) !== vertexArrayStride(candidate)) {
        throw new TypeError(
            `Vertex sources sharing bufferViewId ${candidate.bufferViewId} must use the same effective array stride`
        );
    }
}

function widensUint8Indices(record: BufferResourceRecord): boolean {
    return record.kind === 'index' && isUint8RHIIndexSource(record.source as GeometryData);
}

function logicalByteLength(record: BufferResourceRecord): number {
    if (!widensUint8Indices(record)) return directSourceBytes(record).byteLength;
    const byteLength = (record.source as GeometryData).data.length * Uint16Array.BYTES_PER_ELEMENT;
    if (!Number.isSafeInteger(byteLength)) {
        throw new RangeError('Widened Uint8 index data exceeds the safe integer range');
    }
    return byteLength;
}

function alignedBufferSize(byteLength: number): number {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new RangeError('Logical buffer byte length must be a non-negative safe integer');
    }
    const aligned = Math.ceil(byteLength / 4) * 4;
    if (!Number.isSafeInteger(aligned)) {
        throw new RangeError('Logical buffer padded size exceeds the safe integer range');
    }
    return Math.max(4, aligned);
}

function alignedStart(value: number): number {
    return Math.floor(value / 4) * 4;
}

function alignedEnd(value: number): number {
    return Math.ceil(value / 4) * 4;
}

function snapshotRange(record: BufferResourceRecord, start: number, end: number): Uint8Array {
    const snapshot = new Uint8Array(end - start);
    if (widensUint8Indices(record)) {
        if (start % 2 !== 0 || end % 2 !== 0) {
            throw new RangeError('Widened Uint8 index snapshots must be Uint16 aligned');
        }
        const source = (record.source as GeometryData).data;
        const firstIndex = start / Uint16Array.BYTES_PER_ELEMENT;
        const endIndex = Math.min(source.length, end / Uint16Array.BYTES_PER_ELEMENT);
        const output = new Uint16Array(snapshot.buffer);
        const remapRestart = record.indexVariant === 'primitive-restart';
        for (let index = firstIndex; index < endIndex; index++) {
            const value = source[index];
            if (value === undefined) throw new RangeError('Uint8 index source changed length');
            output[index - firstIndex] = remapRestart && value === 0xff ? 0xffff : value;
        }
        return snapshot;
    }
    const bytes = directSourceBytes(record);
    if (start < bytes.byteLength) {
        snapshot.set(bytes.subarray(start, Math.min(end, bytes.byteLength)));
    }
    return snapshot;
}

function snapshotPaddedSource(record: BufferResourceRecord): Uint8Array {
    return snapshotRange(record, 0, alignedBufferSize(logicalByteLength(record)));
}

function bufferUsage(kind: BufferResourceKind): RHIBufferUsageFlags {
    if (kind === 'vertex') return RHIBufferUsage.VERTEX | RHIBufferUsage.COPY_DST;
    if (kind === 'index') return RHIBufferUsage.INDEX | RHIBufferUsage.COPY_DST;
    return RHIBufferUsage.UNIFORM | RHIBufferUsage.COPY_DST;
}

function bufferLabel(record: BufferResourceRecord): string {
    if (record.kind === 'uniform') return 'UniformBuffer RHI resource';
    const variant = record.indexVariant === 'primitive-restart' ? ' primitive-restart' : '';
    return `${record.kind}${variant} GeometryData ${(record.source as GeometryData).id}`;
}

function createRegistryBuffer(record: BufferResourceRecord, device: RHIDevice): RHIBuffer {
    const revision = sourceRevision(record.source);
    const initialData = snapshotPaddedSource(record);
    const buffer = device.createBuffer({
        label: bufferLabel(record),
        lifetime: 'persistent',
        size: initialData.byteLength,
        usage: record.usage,
        initialData
    });
    record.lastCreatedDeviceId = buffer.deviceId;
    record.lastCreatedRevision = revision;
    record.lastCreatedSize = buffer.size;
    if (record.lastCreatedVertexRevisions && record.vertexSources) {
        record.lastCreatedVertexRevisions.clear();
        for (const source of record.vertexSources) {
            record.lastCreatedVertexRevisions.set(source, sourceRevision(source));
        }
    }
    return buffer;
}

function requireRecordHandle(record: BufferResourceRecord): ResourceRegistryHandle<RHIBuffer> {
    if (!record.handle) throw new Error('Logical buffer record has no registry handle');
    return record.handle;
}

/**
 * Logical renderer buffer cache.
 *
 * Records retain only CPU sources, revisions, and `ResourceRegistryHandle`s. Concrete RHI buffers
 * are resolved for the caller during graph prepare and are never stored as cache/native handles.
 */
export class BufferResourceCache implements RHIUploadBatchParticipant {
    private geometryRecords = new WeakMap<GeometryData, GeometryBufferRecords>();
    private uniformRecords = new WeakMap<UniformBuffer, BufferResourceRecord>();
    readonly #vertexRecordsByBufferViewId = new Map<string, BufferResourceRecord>();
    readonly #records = new Set<BufferResourceRecord>();
    readonly #pending = new Map<BufferResourceRecord, PendingBufferUse>();
    readonly #sourceRevisions = new Map<BufferSource, number>();
    readonly #uniformDirtySpan = { byteOffset: 0, byteLength: 0 };
    readonly #dirtyRange = { start: 0, end: 0 };
    #state: CacheState = 'idle';
    #frameIndex = 0;
    #uploads: RHIUploadBatch | null = null;

    constructor(readonly registry: ResourceRegistry) {}

    get active(): boolean {
        return this.#state === 'active';
    }

    /** Enlist this stable cache in one RenderGraphFrame/RHIUploadBatch transaction. */
    beginFrame(frameIndex: number, uploads: RHIUploadBatch): void {
        if (this.#state === 'destroyed') throw new Error('Buffer resource cache is destroyed');
        if (this.#state === 'active')
            throw new Error('Buffer resource cache frame is already active');
        if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
            throw new RangeError('Buffer resource cache frame index must be non-negative');
        }
        uploads.enlist(this);
        this.#frameIndex = frameIndex;
        this.#uploads = uploads;
        this.#state = 'active';
    }

    getVertexBuffer(source: GeometryData, sources: readonly GeometryData[] = [source]): RHIBuffer {
        return this.prepareVertexSources(source, sources);
    }

    prepareVertexBuffer(
        source: GeometryData,
        sources: readonly GeometryData[] = [source]
    ): RHIBuffer {
        return this.prepareVertexSources(source, sources);
    }

    getIndexBuffer(source: GeometryData, options?: IndexBufferPreparationOptions): RHIBuffer {
        return this.getBuffer(source, 'index', options);
    }

    prepareIndexBuffer(source: GeometryData, options?: IndexBufferPreparationOptions): RHIBuffer {
        return this.getIndexBuffer(source, options);
    }

    getUniformBuffer(source: UniformBuffer): RHIBuffer {
        return this.getBuffer(source, 'uniform');
    }

    prepareUniformBuffer(source: UniformBuffer): RHIBuffer {
        return this.getUniformBuffer(source);
    }

    /**
     * Return the stable logical handle behind a prepared std140 buffer. UniformBuffer byte length
     * is fixed by its layout, so unlike resizable geometry storage this handle never needs a
     * transactional replacement. Bind-group recipes use it to rebuild after device recovery.
     */
    getUniformBufferHandle(source: UniformBuffer): ResourceRegistryHandle<RHIBuffer> {
        const record = this.uniformRecords.get(source);
        if (!record)
            throw new Error('Uniform buffer must be prepared before requesting its handle');
        const pending = this.#pending.get(record);
        const handle = requireRecordHandle(record);
        if (pending && pending.handle !== handle) {
            throw new Error('Uniform buffer unexpectedly changed allocation identity');
        }
        return handle;
    }

    getBuffer(
        source: GeometryData,
        kind: 'vertex' | 'index',
        options?: IndexBufferPreparationOptions
    ): RHIBuffer;
    getBuffer(source: UniformBuffer, kind: 'uniform'): RHIBuffer;
    getBuffer(
        source: BufferSource,
        kind: BufferResourceKind,
        options?: IndexBufferPreparationOptions
    ): RHIBuffer {
        if (kind === 'vertex') {
            const vertexSource = source as GeometryData;
            return this.prepareVertexSources(vertexSource, [vertexSource]);
        }
        this.assertActive();
        this.requireSourceKind(source, kind);
        const revision = this.captureSourceRevision(source);
        let record = this.findRecord(source, kind, options);
        let initializedThisFrame = false;
        if (!record) {
            record = this.createRecord(source, kind, this.indexVariant(source, kind, options));
            initializedThisFrame = true;
        }
        this.synchronizeRecord(record);

        const existing = this.#pending.get(record);
        if (existing) return this.registry.resolve(existing.handle);

        const requiredSize = alignedBufferSize(logicalByteLength(record));
        let handle = requireRecordHandle(record);
        if (record.allocatedSize !== requiredSize) {
            handle = this.createReplacementHandle(record);
            initializedThisFrame = true;
        } else if (record.committedRevision !== revision && !initializedThisFrame) {
            this.enqueueUpdate(record, handle);
        }
        const buffer = this.registry.resolve(handle);
        if (record.lastCreatedRevision !== revision && initializedThisFrame) {
            throw new Error(
                'Logical buffer source changed while its allocation was being prepared'
            );
        }
        const pending: PendingBufferUse = {
            record,
            handle,
            sourceRevision: revision,
            allocatedSize: buffer.size,
            registryGeneration: this.registry.generation,
            fullUploadStaged: initializedThisFrame
        };
        this.#pending.set(record, pending);
        return buffer;
    }

    private prepareVertexSources(
        source: GeometryData,
        aliases: readonly GeometryData[]
    ): RHIBuffer {
        this.assertActive();
        this.requireSourceKind(source, 'vertex');
        const sources: GeometryData[] = [source];
        for (const alias of aliases) {
            this.requireSourceKind(alias, 'vertex');
            requireCanonicalVertexAlias(source, alias);
            if (!sources.includes(alias)) sources.push(alias);
        }

        let record = this.#vertexRecordsByBufferViewId.get(source.bufferViewId) ?? null;
        for (const alias of sources) {
            const mapped = this.geometryRecords.get(alias)?.vertex ?? null;
            if (mapped !== null && record !== null && mapped !== record) {
                throw new Error(
                    `Vertex source ${alias.id} is already attached to another canonical buffer record`
                );
            }
            record ??= mapped;
        }

        let initializedThisFrame = false;
        let addedAlias = false;
        if (record === null) {
            record = this.createRecord(source, 'vertex', null, sources);
            initializedThisFrame = true;
        } else {
            this.rebindVertexRecord(record, source.bufferViewId);
            const recordSources = record.vertexSources;
            if (!recordSources) throw new Error('Canonical vertex record lost its alias sources');
            for (const existing of recordSources) requireCanonicalVertexAlias(source, existing);
            for (const alias of sources) {
                if (recordSources.includes(alias)) continue;
                recordSources.push(alias);
                this.installVertexSource(record, alias);
                addedAlias = true;
            }
        }
        this.synchronizeRecord(record);

        const recordSources = record.vertexSources;
        if (!recordSources) throw new Error('Canonical vertex record lost its alias sources');
        for (const alias of recordSources) this.captureSourceRevision(alias);

        const existing = this.#pending.get(record);
        if (existing) {
            if (addedAlias && !existing.fullUploadStaged) {
                this.enqueueUpdate(record, existing.handle, true);
                existing.fullUploadStaged = true;
            }
            return this.registry.resolve(existing.handle);
        }

        const requiredSize = alignedBufferSize(logicalByteLength(record));
        let handle = requireRecordHandle(record);
        let fullUploadStaged = false;
        if (record.allocatedSize !== requiredSize) {
            handle = this.createReplacementHandle(record);
            initializedThisFrame = true;
        } else if (this.vertexRecordNeedsUpload(record) && !initializedThisFrame) {
            fullUploadStaged = recordSources.length > 1;
            this.enqueueUpdate(record, handle, fullUploadStaged);
        }
        const buffer = this.registry.resolve(handle);
        if (initializedThisFrame && !this.lastCreatedVertexSourcesAreStable(record)) {
            throw new Error(
                'Canonical vertex buffer source changed while its allocation was being prepared'
            );
        }
        this.#pending.set(record, {
            record,
            handle,
            sourceRevision: this.requireCapturedSourceRevision(record.source),
            allocatedSize: buffer.size,
            registryGeneration: this.registry.generation,
            fullUploadStaged
        });
        return buffer;
    }

    /** Validation half of the upload batch's two-phase commit. */
    prepareCommit(submission: RHISubmission): void {
        if (this.#state !== 'active') return;
        if (submission.status === 'failed') {
            const error = submission.error;
            throw error instanceof Error
                ? error
                : new Error('Cannot commit a failed RHI submission');
        }
        if (this.registry.generation !== this.pendingRegistryGeneration()) {
            throw new Error('Resource registry changed during a buffer cache frame');
        }
        for (const [source, revision] of this.#sourceRevisions) {
            if (sourceRevision(source) !== revision) {
                throw new Error('Logical buffer source changed after its first use in one frame');
            }
        }
        for (const pending of this.#pending.values()) {
            const buffer = this.registry.resolve(pending.handle);
            if (buffer.deviceId !== submission.deviceId) {
                throw new Error('Buffer cache submission belongs to another RHI device');
            }
            if (pending.registryGeneration !== this.registry.generation) {
                throw new Error('Buffer cache resource belongs to a stale registry generation');
            }
        }
    }

    /** Commit staged handles/revisions only after graph execution returned `submission`. */
    commit(submission: RHISubmission): void {
        if (this.#state !== 'active') return;
        this.prepareCommit(submission);
        for (const pending of this.#pending.values()) {
            const record = pending.record;
            const previous = requireRecordHandle(record);
            this.registry.markUsed(pending.handle, this.#frameIndex);
            if (pending.handle !== previous) {
                record.handle = pending.handle;
                this.registry.release(previous);
            }
            record.allocatedSize = pending.allocatedSize;
            record.committedRevision = pending.sourceRevision;
            if (record.committedVertexRevisions && record.vertexSources) {
                for (const source of record.vertexSources) {
                    record.committedVertexRevisions.set(
                        source,
                        this.requireCapturedSourceRevision(source)
                    );
                }
            }
            record.registryGeneration = pending.registryGeneration;
        }
        this.finishTransaction();
    }

    /** Keep committed revisions/handles unchanged so immediate writes are retried next frame. */
    rollback(): void {
        if (this.#state !== 'active') return;
        let rollbackError: unknown;
        try {
            for (const pending of this.#pending.values()) {
                try {
                    const current = pending.record.handle;
                    if (current && pending.handle !== current) {
                        this.registry.discardUnsubmitted(pending.handle);
                    }
                } catch (error) {
                    rollbackError ??= error;
                }
            }
        } finally {
            this.finishTransaction();
        }
        if (rollbackError !== undefined) {
            throw rollbackError instanceof Error
                ? rollbackError
                : new Error('Buffer resource cache rollback failed');
        }
    }

    diagnostics(
        source: GeometryData,
        kind: 'vertex' | 'index',
        options?: IndexBufferPreparationOptions
    ): Readonly<BufferResourceCacheDiagnostics> | null;
    diagnostics(
        source: UniformBuffer,
        kind: 'uniform'
    ): Readonly<BufferResourceCacheDiagnostics> | null;
    diagnostics(
        source: BufferSource,
        kind: BufferResourceKind,
        options?: IndexBufferPreparationOptions
    ): Readonly<BufferResourceCacheDiagnostics> | null {
        const record = this.findRecord(source, kind, options);
        if (!record) return null;
        this.synchronizeRecord(record);
        return Object.freeze({
            kind: record.kind,
            usage: record.usage,
            allocatedSize: record.allocatedSize,
            committedRevision:
                record.kind === 'vertex'
                    ? (record.committedVertexRevisions?.get(source as GeometryData) ?? -1)
                    : record.committedRevision,
            sourceRevision: sourceRevision(source),
            registryGeneration: record.registryGeneration,
            handle: requireRecordHandle(record)
        });
    }

    resolveBuffer(
        source: GeometryData,
        kind: 'vertex' | 'index',
        options?: IndexBufferPreparationOptions
    ): RHIBuffer;
    resolveBuffer(source: UniformBuffer, kind: 'uniform'): RHIBuffer;
    resolveBuffer(
        source: BufferSource,
        kind: BufferResourceKind,
        options?: IndexBufferPreparationOptions
    ): RHIBuffer {
        const record = this.findRecord(source, kind, options);
        if (!record) throw new Error('Logical buffer source is not cached');
        this.synchronizeRecord(record);
        return this.registry.resolve(requireRecordHandle(record));
    }

    detach(source: GeometryData, kind?: 'vertex' | 'index'): number;
    detach(source: UniformBuffer, kind?: 'uniform'): number;
    detach(source: BufferSource, kind?: BufferResourceKind): number {
        this.assertIdle();
        let count = 0;
        if (kind === undefined || kind === 'vertex' || kind === 'index') {
            const records = this.geometryRecords.get(source as GeometryData);
            if (records) {
                if (kind === undefined || kind === 'vertex') {
                    count += this.detachRecord(records.vertex);
                    records.vertex = null;
                }
                if (kind === undefined || kind === 'index') {
                    count += this.detachRecord(records.index);
                    count += this.detachRecord(records.indexPrimitiveRestart);
                    records.index = null;
                    records.indexPrimitiveRestart = null;
                }
                if (!records.vertex && !records.index && !records.indexPrimitiveRestart) {
                    this.geometryRecords.delete(source as GeometryData);
                }
            }
        }
        if (kind === undefined || kind === 'uniform') {
            const record = this.uniformRecords.get(source as UniformBuffer);
            count += this.detachRecord(record ?? null);
            if (record) this.uniformRecords.delete(source as UniformBuffer);
        }
        return count;
    }

    detachGeometryData(source: GeometryData): number {
        return this.detach(source);
    }

    detachUniformBuffer(source: UniformBuffer): boolean {
        return this.detach(source) > 0;
    }

    markUsed(
        source: GeometryData,
        kind: 'vertex' | 'index',
        frameIndex: number,
        options?: IndexBufferPreparationOptions
    ): void;
    markUsed(source: UniformBuffer, kind: 'uniform', frameIndex: number): void;
    markUsed(
        source: BufferSource,
        kind: BufferResourceKind,
        frameIndex: number,
        options?: IndexBufferPreparationOptions
    ): void {
        const record = this.findRecord(source, kind, options);
        if (!record) throw new Error('Logical buffer source is not cached');
        this.registry.markUsed(requireRecordHandle(record), frameIndex);
    }

    collect(completedFrame: number): number {
        return this.registry.collect(completedFrame);
    }

    recover(device: RHIDevice): void {
        this.assertIdle();
        this.registry.recover(device);
        this.synchronizeAfterRecovery();
    }

    synchronizeAfterRecovery(): void {
        this.assertIdle();
        for (const record of this.#records) this.synchronizeRecord(record);
    }

    destroy(): void {
        if (this.#state === 'destroyed') return;
        if (this.#state === 'active') this.rollback();
        for (const record of this.#records) {
            const handle = record.handle;
            if (handle) this.registry.release(handle);
        }
        this.#records.clear();
        this.#vertexRecordsByBufferViewId.clear();
        this.geometryRecords = new WeakMap();
        this.uniformRecords = new WeakMap();
        this.#state = 'destroyed';
    }

    private createRecord(
        source: BufferSource,
        kind: BufferResourceKind,
        indexVariant: IndexBufferVariant | null,
        vertexSources: readonly GeometryData[] = []
    ): BufferResourceRecord {
        const canonicalVertexSources = kind === 'vertex' ? [...vertexSources] : null;
        if (kind === 'vertex' && canonicalVertexSources?.length === 0) {
            canonicalVertexSources.push(source as GeometryData);
        }
        const record: BufferResourceRecord = {
            source,
            kind,
            usage: bufferUsage(kind),
            indexVariant,
            vertexSources: canonicalVertexSources,
            committedVertexRevisions: kind === 'vertex' ? new Map() : null,
            lastCreatedVertexRevisions: kind === 'vertex' ? new Map() : null,
            vertexBufferViewId: kind === 'vertex' ? (source as GeometryData).bufferViewId : null,
            handle: null,
            allocatedSize: 0,
            committedRevision: -1,
            registryGeneration: this.registry.generation,
            lastCreatedDeviceId: -1,
            lastCreatedRevision: -1,
            lastCreatedSize: 0
        };
        record.handle = this.registry.register<RHIBuffer>({
            label: bufferLabel(record),
            create: device => createRegistryBuffer(record, device)
        });
        record.allocatedSize = this.registry.resolve(record.handle).size;
        this.installRecord(record);
        this.#records.add(record);
        return record;
    }

    private createReplacementHandle(
        record: BufferResourceRecord
    ): ResourceRegistryHandle<RHIBuffer> {
        return this.registry.register<RHIBuffer>({
            label: bufferLabel(record),
            create: device => createRegistryBuffer(record, device)
        });
    }

    private enqueueUpdate(
        record: BufferResourceRecord,
        handle: ResourceRegistryHandle<RHIBuffer>,
        forceFull = false
    ): void {
        const uploads = this.#uploads;
        if (!uploads) throw new Error('Buffer resource cache has no active upload batch');
        const range = forceFull ? null : this.dirtyRange(record);
        const end = range ? alignedEnd(range.end) : record.allocatedSize;
        const start = range ? alignedStart(range.start) : 0;
        uploads.writeBuffer(
            this.registry.resolve(handle),
            start,
            snapshotRange(record, start, end)
        );
    }

    private dirtyRange(
        record: BufferResourceRecord
    ): { readonly start: number; readonly end: number } | null {
        if (record.committedRevision < 0) return null;
        if (record.kind === 'uniform') {
            const retained = (record.source as UniformBuffer).getDirtySpanSince(
                record.committedRevision,
                this.#uniformDirtySpan
            );
            if (!retained || this.#uniformDirtySpan.byteLength === 0) return null;
            this.#dirtyRange.start = this.#uniformDirtySpan.byteOffset;
            this.#dirtyRange.end =
                this.#uniformDirtySpan.byteOffset + this.#uniformDirtySpan.byteLength;
            return this.#dirtyRange;
        }
        if ((record.vertexSources?.length ?? 0) > 1) return null;
        const updates = (record.source as GeometryData).getSubDataUpdatesSince(
            record.committedRevision
        );
        if (!updates || updates.length === 0) return null;
        const scale = widensUint8Indices(record) ? Uint16Array.BYTES_PER_ELEMENT : 1;
        let start = record.allocatedSize;
        let end = 0;
        for (const update of updates) {
            const updateStart = update.byteOffset * scale;
            if (updateStart < start) start = updateStart;
            const updateEnd = (update.byteOffset + update.data.byteLength) * scale;
            if (updateEnd > end) end = updateEnd;
        }
        this.#dirtyRange.start = start;
        this.#dirtyRange.end = end;
        return this.#dirtyRange;
    }

    private captureSourceRevision(source: BufferSource): number {
        const revision = sourceRevision(source);
        const captured = this.#sourceRevisions.get(source);
        if (captured !== undefined && captured !== revision) {
            throw new Error('Logical buffer source changed after its first use in one frame');
        }
        if (captured === undefined) this.#sourceRevisions.set(source, revision);
        return revision;
    }

    private requireCapturedSourceRevision(source: BufferSource): number {
        const revision = this.#sourceRevisions.get(source);
        if (revision === undefined) {
            throw new Error('Logical buffer source revision was not captured for this frame');
        }
        return revision;
    }

    private vertexRecordNeedsUpload(record: BufferResourceRecord): boolean {
        const sources = record.vertexSources;
        const committed = record.committedVertexRevisions;
        if (!sources || !committed) throw new Error('Vertex record lost its alias revision state');
        for (const source of sources) {
            if (committed.get(source) !== this.requireCapturedSourceRevision(source)) return true;
        }
        return false;
    }

    private lastCreatedVertexSourcesAreStable(record: BufferResourceRecord): boolean {
        const sources = record.vertexSources;
        const created = record.lastCreatedVertexRevisions;
        if (!sources || !created) return false;
        for (const source of sources) {
            if (created.get(source) !== this.requireCapturedSourceRevision(source)) return false;
        }
        return true;
    }

    private synchronizeRecord(record: BufferResourceRecord): void {
        if (record.registryGeneration === this.registry.generation) return;
        const resource = this.registry.resolve(requireRecordHandle(record));
        record.allocatedSize = resource.size;
        record.registryGeneration = this.registry.generation;
        record.committedRevision =
            resource.deviceId === record.lastCreatedDeviceId &&
            resource.size === record.lastCreatedSize
                ? record.lastCreatedRevision
                : -1;
        if (record.committedVertexRevisions) {
            record.committedVertexRevisions.clear();
            if (record.committedRevision >= 0 && record.lastCreatedVertexRevisions !== null) {
                for (const [source, revision] of record.lastCreatedVertexRevisions) {
                    record.committedVertexRevisions.set(source, revision);
                }
            }
        }
    }

    private installRecord(record: BufferResourceRecord): void {
        if (record.kind === 'uniform') {
            this.uniformRecords.set(record.source as UniformBuffer, record);
            return;
        }
        if (record.kind === 'vertex') {
            const bufferViewId = record.vertexBufferViewId;
            if (!bufferViewId || !record.vertexSources) {
                throw new Error('Canonical vertex record is missing its buffer-view identity');
            }
            const existing = this.#vertexRecordsByBufferViewId.get(bufferViewId);
            if (existing !== undefined && existing !== record) {
                throw new Error(
                    `bufferViewId ${bufferViewId} already has a canonical vertex record`
                );
            }
            this.#vertexRecordsByBufferViewId.set(bufferViewId, record);
            for (const source of record.vertexSources) this.installVertexSource(record, source);
            return;
        }
        const source = record.source as GeometryData;
        let records = this.geometryRecords.get(source);
        if (!records) {
            records = { vertex: null, index: null, indexPrimitiveRestart: null };
            this.geometryRecords.set(source, records);
        }
        if (record.indexVariant === 'primitive-restart') {
            records.indexPrimitiveRestart = record;
        } else {
            records.index = record;
        }
    }

    private installVertexSource(record: BufferResourceRecord, source: GeometryData): void {
        let records = this.geometryRecords.get(source);
        if (!records) {
            records = { vertex: null, index: null, indexPrimitiveRestart: null };
            this.geometryRecords.set(source, records);
        }
        if (records.vertex !== null && records.vertex !== record) {
            throw new Error(`Vertex source ${source.id} already belongs to another buffer record`);
        }
        records.vertex = record;
    }

    private rebindVertexRecord(record: BufferResourceRecord, bufferViewId: string): void {
        const previousId = record.vertexBufferViewId;
        if (previousId === bufferViewId) return;
        const sources = record.vertexSources;
        if (!sources) throw new Error('Canonical vertex record lost its alias sources');
        for (const source of sources) {
            if (source.bufferViewId !== bufferViewId) {
                throw new TypeError(
                    'GeometryData aliases in one canonical vertex record must keep one bufferViewId'
                );
            }
        }
        const existing = this.#vertexRecordsByBufferViewId.get(bufferViewId);
        if (existing !== undefined && existing !== record) {
            throw new Error(`bufferViewId ${bufferViewId} already has a canonical vertex record`);
        }
        if (previousId !== null && this.#vertexRecordsByBufferViewId.get(previousId) === record) {
            this.#vertexRecordsByBufferViewId.delete(previousId);
        }
        record.vertexBufferViewId = bufferViewId;
        this.#vertexRecordsByBufferViewId.set(bufferViewId, record);
    }

    private findRecord(
        source: BufferSource,
        kind: BufferResourceKind,
        options?: IndexBufferPreparationOptions
    ): BufferResourceRecord | null {
        if (kind === 'uniform') return this.uniformRecords.get(source as UniformBuffer) ?? null;
        const records = this.geometryRecords.get(source as GeometryData);
        if (kind === 'vertex') return records?.vertex ?? null;
        if (this.indexVariant(source, kind, options) === 'primitive-restart') {
            return records?.indexPrimitiveRestart ?? null;
        }
        return (
            records?.index ??
            (isUint8RHIIndexSource(source as GeometryData)
                ? null
                : (records?.indexPrimitiveRestart ?? null))
        );
    }

    private indexVariant(
        source: BufferSource,
        kind: BufferResourceKind,
        options?: IndexBufferPreparationOptions
    ): IndexBufferVariant | null {
        if (kind !== 'index') return null;
        return options?.primitiveRestart === true && isUint8RHIIndexSource(source as GeometryData)
            ? 'primitive-restart'
            : 'plain';
    }

    private detachRecord(record: BufferResourceRecord | null): number {
        if (!record || !this.#records.delete(record)) return 0;
        if (record.vertexSources) {
            for (const source of record.vertexSources) {
                const records = this.geometryRecords.get(source);
                if (records?.vertex !== record) continue;
                records.vertex = null;
                if (!records.index && !records.indexPrimitiveRestart) {
                    this.geometryRecords.delete(source);
                }
            }
            const bufferViewId = record.vertexBufferViewId;
            if (
                bufferViewId !== null &&
                this.#vertexRecordsByBufferViewId.get(bufferViewId) === record
            ) {
                this.#vertexRecordsByBufferViewId.delete(bufferViewId);
            }
        }
        this.registry.release(requireRecordHandle(record));
        record.handle = null;
        return 1;
    }

    private pendingRegistryGeneration(): number {
        const first = this.#pending.values().next().value;
        return first?.registryGeneration ?? this.registry.generation;
    }

    private finishTransaction(): void {
        this.#pending.clear();
        this.#sourceRevisions.clear();
        this.#uploads = null;
        this.#state = 'idle';
    }

    private requireSourceKind(source: BufferSource, kind: BufferResourceKind): void {
        if (kind === 'uniform') {
            if (!('getDirtyRangesSince' in source)) {
                throw new TypeError('Uniform buffer cache entries require a UniformBuffer source');
            }
        } else if (!('getSubDataUpdatesSince' in source)) {
            throw new TypeError('Vertex/index buffer cache entries require GeometryData');
        } else if (kind === 'index') {
            mapPortableRHIIndexFormat(source);
        }
    }

    private assertActive(): void {
        if (this.#state !== 'active') {
            if (this.#state === 'destroyed') throw new Error('Buffer resource cache is destroyed');
            throw new Error('Buffer resource cache requires beginFrame before preparation');
        }
    }

    private assertIdle(): void {
        if (this.#state === 'active') {
            throw new Error('Buffer resource cache operation is not allowed during a frame');
        }
        if (this.#state === 'destroyed') throw new Error('Buffer resource cache is destroyed');
    }
}
