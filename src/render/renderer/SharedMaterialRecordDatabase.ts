import MaterialInstance from '../../material/MaterialInstance';
import type { MaterialFamily } from '../../material/MaterialDefinition';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../pipeline/RenderPipeline';

/** @internal Immutable renderer-local reference to one compact GPU material record. */
export interface SharedMaterialRecordHandle {
    readonly materialId: number;
    readonly family: MaterialFamily;
    readonly layout: string;
    readonly recordIndex: number;
    readonly byteOffset: number;
    readonly byteLength: number;
}

/** @internal One fixed-layout material family stored in a renderer-owned storage buffer. */
export interface SharedMaterialRecordDatabaseDescriptor<MaterialType extends MaterialInstance> {
    readonly label: string;
    readonly family: MaterialFamily;
    readonly layout: string;
    readonly recordByteLength: number;
    readonly materials: readonly MaterialType[];
    readonly packRecord: (material: MaterialType, target: Uint8Array) => void;
}

type DatabaseCreateContext = Pick<RenderPipelineCreateContext, 'createStorageBuffer'>;
type DatabaseFrameContext = Pick<RenderPipelineContext, 'frameIndex' | 'writeStorageBuffer'>;

interface SharedMaterialRecordEntry<MaterialType extends MaterialInstance> {
    readonly material: MaterialType;
    readonly handle: Readonly<SharedMaterialRecordHandle>;
}

function requireNonEmpty(value: string, path: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new TypeError(`${path} must be a non-empty string`);
    }
    return value;
}

function requireMaterialFamily(value: MaterialFamily): MaterialFamily {
    switch (value) {
        case 'basic':
        case 'pbr':
        case 'geometry':
        case 'sprite':
        case 'custom':
            return value;
        default:
            throw new TypeError(`Unknown GPU material database family ${String(value)}`);
    }
}

function requireRecordByteLength(value: number): number {
    if (!Number.isSafeInteger(value) || value < 4 || value % 4 !== 0) {
        throw new RangeError(
            'GPU material database recordByteLength must be a positive four-byte-aligned integer'
        );
    }
    return value;
}

function requireMaterialInstance(value: MaterialInstance): void {
    if (!(value instanceof MaterialInstance)) {
        throw new TypeError('GPU material database entries must be MaterialInstance objects');
    }
}

/**
 * @internal Renderer-local compact material database shared by GPU-driven render passes.
 *
 * Material identities are deduplicated into stable dense handles. Instance revisions stage only
 * changed records, adjacent records are coalesced into one upload, and revisions commit only after
 * a valid RHI submission. The renderer-owned CPU shadow supplies device-loss recovery without
 * replacing public material identities.
 */
export class SharedMaterialRecordDatabase<MaterialType extends MaterialInstance> {
    readonly buffer: StorageBuffer;
    readonly family: MaterialFamily;
    readonly layout: string;
    readonly recordByteLength: number;
    readonly #packRecord: (material: MaterialType, target: Uint8Array) => void;
    readonly #entries: readonly SharedMaterialRecordEntry<MaterialType>[];
    readonly #handleByMaterial = new Map<MaterialType, Readonly<SharedMaterialRecordHandle>>();
    readonly #bytes: Uint8Array;
    readonly #committedRevisions: number[];
    readonly #stagedRevisions: number[];
    readonly #stagedRecordIndices: number[] = [];
    readonly #stagedUploadRecordIndices: number[] = [];
    readonly #initialCommitPending: boolean[];
    #stagedFrame = -1;
    #destroyed = false;

    constructor(
        context: DatabaseCreateContext,
        descriptor: Readonly<SharedMaterialRecordDatabaseDescriptor<MaterialType>>
    ) {
        this.family = requireMaterialFamily(descriptor.family);
        this.layout = requireNonEmpty(descriptor.layout, 'GPU material database layout');
        this.recordByteLength = requireRecordByteLength(descriptor.recordByteLength);
        const rawMaterials: unknown = descriptor.materials;
        if (!Array.isArray(rawMaterials) || rawMaterials.length === 0) {
            throw new RangeError('GPU material database requires at least one material');
        }
        if (typeof descriptor.packRecord !== 'function') {
            throw new TypeError('GPU material database packRecord must be a function');
        }
        this.#packRecord = descriptor.packRecord;

        const entries: SharedMaterialRecordEntry<MaterialType>[] = [];
        for (const material of descriptor.materials) {
            requireMaterialInstance(material);
            if (this.#handleByMaterial.has(material)) continue;
            const recordIndex = entries.length;
            const handle = Object.freeze({
                materialId: material.materialId,
                family: this.family,
                layout: this.layout,
                recordIndex,
                byteOffset: recordIndex * this.recordByteLength,
                byteLength: this.recordByteLength
            });
            this.#handleByMaterial.set(material, handle);
            entries.push(Object.freeze({ material, handle }));
        }
        this.#entries = Object.freeze(entries);
        this.#bytes = new Uint8Array(this.#entries.length * this.recordByteLength);
        this.#committedRevisions = new Array<number>(this.#entries.length);
        this.#stagedRevisions = new Array<number>(this.#entries.length).fill(-1);
        this.#initialCommitPending = new Array<boolean>(this.#entries.length).fill(true);
        for (let index = 0; index < this.#entries.length; index += 1) {
            const entry = this.#entries[index];
            if (entry === undefined) continue;
            this.packEntry(index, entry.material);
            this.#committedRevisions[index] = entry.material.revision;
        }
        this.buffer = context.createStorageBuffer({
            label: requireNonEmpty(descriptor.label, 'GPU material database label'),
            byteLength: this.#bytes.byteLength,
            usage: ['storage', 'copy-destination'],
            initialData: this.#bytes,
            recovery: 'cpu-shadow'
        });
    }

    get recordCount(): number {
        return this.#entries.length;
    }

    get isDestroyed(): boolean {
        return this.#destroyed;
    }

    getHandle(material: MaterialType): Readonly<SharedMaterialRecordHandle> {
        this.assertAlive('get a material handle');
        const handle = this.#handleByMaterial.get(material);
        if (handle === undefined) {
            throw new RangeError(
                `Material ${String(material.materialId)} is not registered in GPU material database ${this.family}/${this.layout}`
            );
        }
        return handle;
    }

    stage(context: DatabaseFrameContext): void {
        this.assertAlive('stage material records');
        if (this.#stagedFrame !== -1) {
            throw new Error(
                `GPU material database still has staged frame ${String(this.#stagedFrame)}`
            );
        }
        this.#stagedFrame = context.frameIndex;
        for (let index = 0; index < this.#entries.length; index += 1) {
            const entry = this.#entries[index];
            if (entry === undefined) continue;
            const revision = entry.material.revision;
            const changed = revision !== this.#committedRevisions[index];
            if (!changed && this.#initialCommitPending[index] !== true) continue;
            if (changed) {
                this.packEntry(index, entry.material);
                this.#stagedUploadRecordIndices.push(index);
            }
            this.#stagedRevisions[index] = revision;
            this.#stagedRecordIndices.push(index);
        }
        this.writeCoalescedRanges(context);
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#stagedFrame) return;
        for (const index of this.#stagedRecordIndices) {
            const entry = this.#entries[index];
            const revision = this.#stagedRevisions[index];
            if (entry === undefined || revision === undefined || revision < 0) continue;
            this.#committedRevisions[index] = revision;
            this.#initialCommitPending[index] = false;
            entry.material.commitTextureSlotRevision(revision);
            this.#stagedRevisions[index] = -1;
        }
        this.resetStagedFrame();
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex !== this.#stagedFrame) return;
        for (const index of this.#stagedRecordIndices) this.#stagedRevisions[index] = -1;
        this.resetStagedFrame();
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#stagedFrame = -1;
        this.#stagedRecordIndices.length = 0;
        this.#stagedUploadRecordIndices.length = 0;
        this.buffer.destroy();
    }

    private packEntry(index: number, material: MaterialType): void {
        const byteOffset = index * this.recordByteLength;
        const target = this.#bytes.subarray(byteOffset, byteOffset + this.recordByteLength);
        target.fill(0);
        this.#packRecord(material, target);
    }

    private writeCoalescedRanges(context: DatabaseFrameContext): void {
        let cursor = 0;
        while (cursor < this.#stagedUploadRecordIndices.length) {
            const first = this.#stagedUploadRecordIndices[cursor];
            if (first === undefined) break;
            let last = first;
            cursor += 1;
            while (cursor < this.#stagedUploadRecordIndices.length) {
                const next = this.#stagedUploadRecordIndices[cursor];
                if (next !== last + 1) break;
                last = next;
                cursor += 1;
            }
            const byteOffset = first * this.recordByteLength;
            const byteEnd = (last + 1) * this.recordByteLength;
            context.writeStorageBuffer(
                this.buffer,
                byteOffset,
                this.#bytes.subarray(byteOffset, byteEnd)
            );
        }
    }

    private resetStagedFrame(): void {
        this.#stagedFrame = -1;
        this.#stagedRecordIndices.length = 0;
        this.#stagedUploadRecordIndices.length = 0;
    }

    private assertAlive(operation: string): void {
        if (this.#destroyed) {
            throw new Error(`Cannot ${operation} on a destroyed GPU material database`);
        }
    }
}

export default SharedMaterialRecordDatabase;
