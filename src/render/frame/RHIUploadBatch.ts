import {
    validateRHIWriteBuffer,
    validateRHIWriteTexture,
    validateRHICopyExternalImageToTexture,
    validateRHIGenerateMipmaps,
    getRHIExternalImageSourceDimensions,
    type RHIBuffer,
    type RHICommandContext,
    type RHIDataSource,
    type RHIDevice,
    type RHIExtent3D,
    type RHIExternalImageSource,
    type RHIImageCopyExternalImage,
    type RHIImageCopyExternalImageToTexture,
    type RHIImageCopyTexture,
    type RHIImageDataLayout,
    type RHISubmission,
    type RHITexture,
    type RHITextureAspect
} from '../rhi/core';
import type { FrameArena } from './FrameArena';

type UploadBatchState = 'recording' | 'flushed';

/** A stable renderer cache enlisted in the upload batch's frame transaction. */
export interface RHIUploadBatchParticipant {
    /** Validate source stability and submission ownership without mutating committed state. */
    prepareCommit(submission: RHISubmission): void;
    /** Commit staged revisions after graph execution returned a submission. */
    commit(submission: RHISubmission): void;
    /** Discard staged metadata after build, prepare, or execute failure. */
    rollback(): void;
}

interface MutableTextureDestination {
    texture: RHITexture | null;
    mipLevel: number | undefined;
    readonly origin: { x: number; y: number; z: number };
    aspect: RHITextureAspect | undefined;
    premultipliedAlpha?: boolean;
}

interface MutableImageDataLayout {
    offset: number | undefined;
    bytesPerRow: number | undefined;
    rowsPerImage: number | undefined;
}

interface MutableExtent3D {
    width: number;
    height: number;
    depthOrArrayLayers: number;
}

interface TextureUploadRecord {
    readonly destination: MutableTextureDestination;
    readonly layout: MutableImageDataLayout;
    readonly size: MutableExtent3D;
    sourceOffset: number;
    sourceByteLength: number;
    sourceView: Uint8Array | null;
}

interface ExternalImageUploadRecord {
    readonly sourceDescriptor: {
        source: RHIExternalImageSource | null;
        readonly origin: { x: number; y: number };
        flipY: boolean;
    };
    readonly destination: MutableTextureDestination;
    readonly size: MutableExtent3D;
    sourceWidth: number;
    sourceHeight: number;
}

function sourceBytes(data: RHIDataSource): Uint8Array {
    if (data instanceof Uint8Array) return data;
    return data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function requireRange(offset: number, size: number, capacity: number, name: string): void {
    if (!Number.isSafeInteger(offset) || offset < 0) {
        throw new RangeError(`${name} offset must be a non-negative safe integer`);
    }
    if (!Number.isSafeInteger(size) || size < 0 || offset + size > capacity) {
        throw new RangeError(`${name} range exceeds the data source`);
    }
}

/**
 * Reusable upload recorder owned by one RenderFrame. Buffer records use parallel arrays and merge
 * adjacent destination ranges; texture descriptor objects are retained at their high-water count.
 */
export class RHIUploadBatch {
    readonly #buffers: (RHIBuffer | null)[] = [];
    readonly #bufferDestinationOffsets: number[] = [];
    readonly #bufferSourceOffsets: number[] = [];
    readonly #bufferSizes: number[] = [];
    readonly #bufferSourceViews: (Uint8Array | null)[] = [];
    readonly #textureRecords: TextureUploadRecord[] = [];
    readonly #externalImageRecords: ExternalImageUploadRecord[] = [];
    readonly #mipmapTextures: (RHITexture | null)[] = [];
    readonly #participants: (RHIUploadBatchParticipant | null)[] = [];
    #bufferCount = 0;
    #textureCount = 0;
    #externalImageCount = 0;
    #mipmapCount = 0;
    #participantCount = 0;
    #viewStorageGeneration: number;
    #state: UploadBatchState = 'recording';

    constructor(readonly arena: FrameArena) {
        this.#viewStorageGeneration = arena.storageGeneration;
    }

    get pendingCount(): number {
        return (
            this.#bufferCount + this.#textureCount + this.#externalImageCount + this.#mipmapCount
        );
    }

    reset(): void {
        this.rollback();
        this.synchronizeViewStorage();
        for (let index = 0; index < this.#bufferCount; index += 1) this.#buffers[index] = null;
        for (let index = 0; index < this.#textureCount; index += 1) {
            const record = this.#textureRecords[index];
            if (record) record.destination.texture = null;
        }
        for (let index = 0; index < this.#externalImageCount; index += 1) {
            const record = this.#externalImageRecords[index];
            if (record) {
                record.sourceDescriptor.source = null;
                record.destination.texture = null;
            }
        }
        for (let index = 0; index < this.#mipmapCount; index += 1) {
            this.#mipmapTextures[index] = null;
        }
        this.#bufferCount = 0;
        this.#textureCount = 0;
        this.#externalImageCount = 0;
        this.#mipmapCount = 0;
        this.#state = 'recording';
    }

    enlist(participant: RHIUploadBatchParticipant): void {
        this.assertRecording();
        for (let index = 0; index < this.#participantCount; index += 1) {
            if (this.#participants[index] === participant) return;
        }
        this.#participants[this.#participantCount++] = participant;
    }

    writeBuffer(
        destination: RHIBuffer,
        destinationOffset: number,
        data: RHIDataSource,
        dataOffset = 0,
        size?: number
    ): void {
        this.assertRecording();
        const bytes = sourceBytes(data);
        const byteLength = size ?? bytes.byteLength - dataOffset;
        requireRange(dataOffset, byteLength, bytes.byteLength, 'Buffer upload source');
        if (destinationOffset % 4 !== 0 || dataOffset % 4 !== 0 || byteLength % 4 !== 0) {
            throw new RangeError('Buffer upload offsets and size must be 4-byte aligned');
        }
        const sourceOffset = this.arena.allocate(byteLength, 4);
        this.arena.write(sourceOffset, bytes.subarray(dataOffset, dataOffset + byteLength));

        const previous = this.#bufferCount - 1;
        if (
            previous >= 0 &&
            this.#buffers[previous] === destination &&
            (this.#bufferDestinationOffsets[previous] ?? 0) + (this.#bufferSizes[previous] ?? 0) ===
                destinationOffset &&
            (this.#bufferSourceOffsets[previous] ?? 0) + (this.#bufferSizes[previous] ?? 0) ===
                sourceOffset
        ) {
            this.#bufferSizes[previous] = (this.#bufferSizes[previous] ?? 0) + byteLength;
            return;
        }
        const index = this.#bufferCount++;
        this.#buffers[index] = destination;
        this.#bufferDestinationOffsets[index] = destinationOffset;
        this.#bufferSourceOffsets[index] = sourceOffset;
        this.#bufferSizes[index] = byteLength;
    }

    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIDataSource,
        layout: RHIImageDataLayout,
        size: RHIExtent3D
    ): void {
        this.assertRecording();
        const bytes = sourceBytes(data);
        const sourceOffset = this.arena.copy(bytes, 4);
        const index = this.#textureCount++;
        let record = this.#textureRecords[index];
        if (!record) {
            record = {
                destination: {
                    texture: destination.texture,
                    mipLevel: destination.mipLevel,
                    origin: {
                        x: destination.origin?.x ?? 0,
                        y: destination.origin?.y ?? 0,
                        z: destination.origin?.z ?? 0
                    },
                    aspect: destination.aspect
                },
                layout: {
                    offset: layout.offset,
                    bytesPerRow: layout.bytesPerRow,
                    rowsPerImage: layout.rowsPerImage
                },
                size: {
                    width: size.width,
                    height: size.height ?? 1,
                    depthOrArrayLayers: size.depthOrArrayLayers ?? 1
                },
                sourceOffset,
                sourceByteLength: bytes.byteLength,
                sourceView: null
            };
            this.#textureRecords[index] = record;
            return;
        }
        record.destination.texture = destination.texture;
        record.destination.mipLevel = destination.mipLevel;
        record.destination.origin.x = destination.origin?.x ?? 0;
        record.destination.origin.y = destination.origin?.y ?? 0;
        record.destination.origin.z = destination.origin?.z ?? 0;
        record.destination.aspect = destination.aspect;
        record.layout.offset = layout.offset;
        record.layout.bytesPerRow = layout.bytesPerRow;
        record.layout.rowsPerImage = layout.rowsPerImage;
        record.size.width = size.width;
        record.size.height = size.height ?? 1;
        record.size.depthOrArrayLayers = size.depthOrArrayLayers ?? 1;
        record.sourceOffset = sourceOffset;
        record.sourceByteLength = bytes.byteLength;
    }

    /** Record a live external source for the frame's upload-only pre-pass. */
    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyExternalImageToTexture,
        size: RHIExtent3D
    ): void {
        this.assertRecording();
        const dimensions = getRHIExternalImageSourceDimensions(source.source);
        const index = this.#externalImageCount++;
        let record = this.#externalImageRecords[index];
        if (!record) {
            record = {
                sourceDescriptor: {
                    source: source.source,
                    origin: { x: source.origin?.x ?? 0, y: source.origin?.y ?? 0 },
                    flipY: source.flipY ?? false
                },
                destination: {
                    texture: destination.texture,
                    mipLevel: destination.mipLevel,
                    origin: {
                        x: destination.origin?.x ?? 0,
                        y: destination.origin?.y ?? 0,
                        z: destination.origin?.z ?? 0
                    },
                    aspect: destination.aspect,
                    premultipliedAlpha: destination.premultipliedAlpha ?? false
                },
                size: {
                    width: size.width,
                    height: size.height ?? 1,
                    depthOrArrayLayers: size.depthOrArrayLayers ?? 1
                },
                sourceWidth: dimensions.width,
                sourceHeight: dimensions.height
            };
            this.#externalImageRecords[index] = record;
            return;
        }
        record.sourceDescriptor.source = source.source;
        record.sourceDescriptor.origin.x = source.origin?.x ?? 0;
        record.sourceDescriptor.origin.y = source.origin?.y ?? 0;
        record.sourceDescriptor.flipY = source.flipY ?? false;
        record.destination.texture = destination.texture;
        record.destination.mipLevel = destination.mipLevel;
        record.destination.origin.x = destination.origin?.x ?? 0;
        record.destination.origin.y = destination.origin?.y ?? 0;
        record.destination.origin.z = destination.origin?.z ?? 0;
        record.destination.aspect = destination.aspect;
        record.destination.premultipliedAlpha = destination.premultipliedAlpha ?? false;
        record.size.width = size.width;
        record.size.height = size.height ?? 1;
        record.size.depthOrArrayLayers = size.depthOrArrayLayers ?? 1;
        record.sourceWidth = dimensions.width;
        record.sourceHeight = dimensions.height;
    }

    /** Rebuild one texture's derived mip levels after all of its staged level-zero uploads. */
    generateMipmaps(texture: RHITexture): void {
        this.assertRecording();
        this.#mipmapTextures[this.#mipmapCount++] = texture;
    }

    /** Validate every destination and image layout before queue.beginFrame starts execution. */
    validate(device: RHIDevice): void {
        this.assertRecording();
        for (let index = 0; index < this.#externalImageCount; index += 1) {
            const record = this.#externalImageRecords[index];
            const texture = record?.destination.texture;
            const source = record?.sourceDescriptor.source;
            if (!record || !texture || !source) {
                throw new Error('RHI upload batch external-image record is incomplete');
            }
            const dimensions = getRHIExternalImageSourceDimensions(source);
            if (
                dimensions.width !== record.sourceWidth ||
                dimensions.height !== record.sourceHeight
            ) {
                throw new Error('External-image dimensions changed after upload recording');
            }
            validateRHICopyExternalImageToTexture(
                device,
                record.sourceDescriptor as RHIImageCopyExternalImage,
                record.destination as RHIImageCopyExternalImageToTexture,
                record.size
            );
        }
        for (let index = 0; index < this.#bufferCount; index += 1) {
            const buffer = this.#buffers[index];
            const destinationOffset = this.#bufferDestinationOffsets[index];
            const sourceOffset = this.#bufferSourceOffsets[index];
            const size = this.#bufferSizes[index];
            if (
                !buffer ||
                destinationOffset === undefined ||
                sourceOffset === undefined ||
                size === undefined
            ) {
                throw new Error('RHI upload batch buffer record is incomplete');
            }
            validateRHIWriteBuffer(
                device,
                buffer,
                destinationOffset,
                this.bufferSourceView(index, sourceOffset, size)
            );
        }
        for (let index = 0; index < this.#textureCount; index += 1) {
            const record = this.#textureRecords[index];
            const texture = record?.destination.texture;
            if (!record || !texture) {
                throw new Error('RHI upload batch texture record is incomplete');
            }
            validateRHIWriteTexture(
                device,
                record.destination as RHIImageCopyTexture,
                this.textureSourceView(record),
                record.layout as RHIImageDataLayout,
                record.size
            );
        }
        for (let index = 0; index < this.#mipmapCount; index += 1) {
            const texture = this.#mipmapTextures[index];
            if (!texture) throw new Error('RHI upload batch mipmap record is incomplete');
            validateRHIGenerateMipmaps(device, texture);
        }
    }

    flush(context: RHICommandContext): void {
        this.assertRecording();
        // WebGPU's native external copy is a queue operation, so issue every external upload before
        // encoding any command-buffer work. This ordering is the portable frame contract.
        for (let index = 0; index < this.#externalImageCount; index += 1) {
            const record = this.#externalImageRecords[index];
            const texture = record?.destination.texture;
            const source = record?.sourceDescriptor.source;
            if (!record || !texture || !source) {
                throw new Error('RHI upload batch external-image record is incomplete');
            }
            const dimensions = getRHIExternalImageSourceDimensions(source);
            if (
                dimensions.width !== record.sourceWidth ||
                dimensions.height !== record.sourceHeight
            ) {
                throw new Error('External-image dimensions changed after upload recording');
            }
            context.copyExternalImageToTexture(
                record.sourceDescriptor as RHIImageCopyExternalImage,
                record.destination as RHIImageCopyExternalImageToTexture,
                record.size
            );
        }
        for (let index = 0; index < this.#bufferCount; index += 1) {
            const buffer = this.#buffers[index];
            const destinationOffset = this.#bufferDestinationOffsets[index];
            const sourceOffset = this.#bufferSourceOffsets[index];
            const size = this.#bufferSizes[index];
            if (
                !buffer ||
                destinationOffset === undefined ||
                sourceOffset === undefined ||
                size === undefined
            ) {
                throw new Error('RHI upload batch buffer record is incomplete');
            }
            context.writeBuffer(
                buffer,
                destinationOffset,
                this.bufferSourceView(index, sourceOffset, size)
            );
        }
        for (let index = 0; index < this.#textureCount; index += 1) {
            const record = this.#textureRecords[index];
            const texture = record?.destination.texture;
            if (!record || !texture)
                throw new Error('RHI upload batch texture record is incomplete');
            context.writeTexture(
                record.destination as RHIImageCopyTexture,
                this.textureSourceView(record),
                record.layout as RHIImageDataLayout,
                record.size
            );
        }
        for (let index = 0; index < this.#mipmapCount; index += 1) {
            const texture = this.#mipmapTextures[index];
            if (!texture) throw new Error('RHI upload batch mipmap record is incomplete');
            context.generateMipmaps(texture);
        }
        this.#state = 'flushed';
    }

    /** Commit every enlisted logical cache only after the graph returned a submission. */
    commit(submission: RHISubmission): void {
        if (this.#state !== 'flushed') {
            throw new Error('RHI upload batch cannot commit before it is flushed');
        }
        try {
            for (let index = 0; index < this.#participantCount; index += 1) {
                this.#participants[index]?.prepareCommit(submission);
            }
            for (let index = 0; index < this.#participantCount; index += 1) {
                this.#participants[index]?.commit(submission);
            }
        } catch (error) {
            this.rollback();
            throw error;
        }
        this.clearParticipants();
    }

    /** Roll back cache metadata; already-issued immediate hardware writes are retried next frame. */
    rollback(): void {
        for (let index = this.#participantCount - 1; index >= 0; index -= 1) {
            try {
                this.#participants[index]?.rollback();
            } catch {
                // Rollback is best-effort and must never replace the original frame failure.
            }
        }
        this.clearParticipants();
    }

    private clearParticipants(): void {
        for (let index = 0; index < this.#participantCount; index += 1) {
            this.#participants[index] = null;
        }
        this.#participantCount = 0;
    }

    private bufferSourceView(index: number, offset: number, size: number): Uint8Array {
        this.synchronizeViewStorage();
        const view = this.arena.reuseView(this.#bufferSourceViews[index] ?? null, offset, size);
        this.#bufferSourceViews[index] = view;
        return view;
    }

    private textureSourceView(record: TextureUploadRecord): Uint8Array {
        this.synchronizeViewStorage();
        record.sourceView = this.arena.reuseView(
            record.sourceView,
            record.sourceOffset,
            record.sourceByteLength
        );
        return record.sourceView;
    }

    private synchronizeViewStorage(): void {
        const generation = this.arena.storageGeneration;
        if (generation === this.#viewStorageGeneration) return;
        for (let index = 0; index < this.#bufferSourceViews.length; index += 1) {
            this.#bufferSourceViews[index] = null;
        }
        for (const record of this.#textureRecords) record.sourceView = null;
        this.#viewStorageGeneration = generation;
    }

    private assertRecording(): void {
        if (this.#state !== 'recording')
            throw new Error('RHI upload batch has already been flushed');
    }
}
