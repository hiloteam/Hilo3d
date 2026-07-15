import type {
    RHICommandContext,
    RHIFrameDiagnostics,
    RHIRenderPassDescriptor
} from '../../core/RHICommands';
import type { RHIExternalImageDimensionsStorage } from '../../core/RHICopyValidation';
import type {
    RHIFrameDescriptor,
    RHIQueue,
    RHIQueueState,
    RHISubmission,
    RHISubmissionStatus
} from '../../core/RHIQueue';
import { RHIValidationError } from '../../core/RHIValidation';
import { RHIBufferUsage, type RHIDataSource } from '../../core/RHITypes';
import { WebGPUV2Object, createWebGPUV2Deferred, type WebGPUV2Deferred } from './WebGPUV2Base';
import { WebGPUV2CommandContext, type WebGPUV2FrameReferences } from './WebGPUV2Commands';
import type { WebGPUV2Device } from './WebGPUV2Device';
import { WebGPUV2ExternalImageStager } from './WebGPUV2ExternalImages';
import { WebGPUV2RenderPassStorage } from './WebGPUV2RenderPass';

const MIN_UPLOAD_PAGE_CAPACITY = 64 * 1024;
const MIN_TEXTURE_SCRATCH_CAPACITY = 256;

interface WebGPUV2UploadPage {
    readonly native: GPUBuffer;
    readonly capacity: number;
    cursor: number;
    bytes: Uint8Array | null;
    state: 'ready' | 'active' | 'unmapped' | 'mapping' | 'failed' | 'destroyed';
    remapSucceeded: () => void;
    remapFailed: (reason: unknown) => void;
}

function alignUploadOffset(offset: number, alignment: number): number {
    const remainder = offset % alignment;
    return remainder === 0 ? offset : offset + alignment - remainder;
}

export interface WebGPUV2UploadAllocation {
    buffer: GPUBuffer | null;
    offset: number;
}

function highWaterCapacity(required: number, minimum: number, maximum: number): number {
    let capacity = Math.min(maximum, Math.max(1, minimum));
    while (capacity < required) {
        capacity = Math.min(maximum, capacity * 2);
        if (capacity < required && capacity === maximum) {
            throw new RangeError('WebGPU upload arena capacity is exhausted');
        }
    }
    return capacity;
}

/** Native upload pages and CPU row-repack storage reused for the queue generation. */
class WebGPUV2UploadPool {
    readonly #pages: WebGPUV2UploadPage[] = [];
    readonly #byteViews = new WeakMap<object, Uint8Array>();
    #remapError: Error | null = null;
    #textureScratch = new Uint8Array(0);

    constructor(readonly owner: WebGPUV2Device) {}

    beginFrame(): void {
        this.assertRemapHealthy();
        let index = 0;
        while (index < this.#pages.length) {
            const page = this.#pages[index];
            if (page === undefined) {
                throw new Error('WebGPU upload page storage contains an empty slot');
            }
            if (page.state === 'active' || page.state === 'unmapped') {
                throw new Error(`WebGPU upload page entered beginFrame while ${page.state}`);
            }
            index += 1;
        }
    }

    stage(
        data: RHIDataSource,
        dataOffset: number,
        byteLength: number,
        diagnostics: RHIFrameDiagnostics,
        result: WebGPUV2UploadAllocation,
        alignment = 4
    ): void {
        if (!Number.isSafeInteger(alignment) || alignment < 1) {
            throw new RangeError('WebGPU upload alignment must be a positive safe integer');
        }
        const allocationSize = Math.ceil(byteLength / 4) * 4;
        const page = this.allocatePage(allocationSize, alignment, diagnostics);
        const offset = alignUploadOffset(page.cursor, alignment);
        page.cursor = offset + allocationSize;
        const source = this.sourceBytes(data);
        const target = page.bytes;
        if (target === null) throw new Error('WebGPU upload page lost its mapped byte range');
        if (dataOffset === 0 && byteLength === source.byteLength) {
            target.set(source, offset);
        } else {
            for (let byte = 0; byte < byteLength; byte += 1) {
                const value = source[dataOffset + byte];
                if (value === undefined) {
                    throw new RangeError('WebGPU upload source range exceeds byte length');
                }
                target[offset + byte] = value;
            }
        }
        result.buffer = page.native;
        result.offset = offset;
    }

    /** Keep pages CPU-owned while commands are encoded, then transfer them before queue submit. */
    sealFrame(): void {
        let index = 0;
        while (index < this.#pages.length) {
            const page = this.#pages[index];
            if (page?.state === 'active') {
                page.native.unmap();
                page.bytes = null;
                page.state = 'unmapped';
            }
            index += 1;
        }
    }

    /** Queue remaps after submit; the asynchronous callbacks run outside the synchronous frame. */
    remapSubmittedFrame(): void {
        let index = 0;
        while (index < this.#pages.length) {
            const page = this.#pages[index];
            if (page?.state === 'unmapped') {
                page.state = 'mapping';
                try {
                    void page.native.mapAsync(0x2).then(page.remapSucceeded, page.remapFailed);
                } catch (error) {
                    page.remapFailed(error);
                }
            }
            index += 1;
        }
    }

    /** A frame that was never submitted leaves its mapped pages immediately reusable. */
    discardFrame(): void {
        let index = 0;
        while (index < this.#pages.length) {
            const page = this.#pages[index];
            if (page?.state === 'active') {
                page.cursor = 0;
                page.state = 'ready';
            }
            index += 1;
        }
    }

    recoverSubmissionFailure(): void {
        this.discardFrame();
        this.remapSubmittedFrame();
    }

    textureScratch(required: number, diagnostics: RHIFrameDiagnostics): Uint8Array {
        if (this.#textureScratch.byteLength >= required) return this.#textureScratch;
        const capacity = highWaterCapacity(
            required,
            Math.max(MIN_TEXTURE_SCRATCH_CAPACITY, this.#textureScratch.byteLength),
            0x7fff_fff8
        );
        this.#textureScratch = new Uint8Array(capacity);
        diagnostics.frameArenaGrowths++;
        diagnostics.transientAllocations++;
        return this.#textureScratch;
    }

    sourceBytes(data: RHIDataSource): Uint8Array {
        if (data instanceof Uint8Array) return data;
        const view = ArrayBuffer.isView(data);
        const key = data as object;
        let bytes = this.#byteViews.get(key);
        if (
            bytes?.byteOffset === (view ? data.byteOffset : 0) &&
            bytes.byteLength === data.byteLength &&
            bytes.buffer === (view ? data.buffer : data)
        ) {
            return bytes;
        }
        bytes = view
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);
        this.#byteViews.set(key, bytes);
        return bytes;
    }

    release(): void {
        for (const page of this.#pages) {
            page.state = 'destroyed';
            page.bytes = null;
            this.destroyBuffer(page.native);
        }
        this.#pages.length = 0;
        this.#remapError = null;
        this.#textureScratch = new Uint8Array(0);
    }

    private allocatePage(
        allocationSize: number,
        alignment: number,
        diagnostics: RHIFrameDiagnostics
    ): WebGPUV2UploadPage {
        const maximum = this.owner.nativeHandle.limits.maxBufferSize;
        if (allocationSize > maximum) {
            throw new RangeError('WebGPU upload exceeds maxBufferSize');
        }
        this.assertRemapHealthy();
        // Indexed loops are intentional: Array iteration creates a V8 iterator in this hot path.
        let index = 0;
        while (index < this.#pages.length) {
            const page = this.#pages[index];
            index += 1;
            if (page === undefined) continue;
            if (page.state !== 'active') continue;
            if (alignUploadOffset(page.cursor, alignment) + allocationSize <= page.capacity) {
                return page;
            }
        }
        let bestReadyPage: WebGPUV2UploadPage | null = null;
        index = 0;
        while (index < this.#pages.length) {
            const page = this.#pages[index];
            index += 1;
            if (page === undefined) continue;
            if (page.state !== 'ready' || page.capacity < allocationSize) continue;
            if (bestReadyPage === null || page.capacity < bestReadyPage.capacity) {
                bestReadyPage = page;
            }
        }
        if (bestReadyPage !== null) {
            bestReadyPage.cursor = 0;
            bestReadyPage.state = 'active';
            return bestReadyPage;
        }
        const capacity = highWaterCapacity(allocationSize, MIN_UPLOAD_PAGE_CAPACITY, maximum);
        const page = this.createPage(capacity, diagnostics);
        page.state = 'active';
        this.#pages.push(page);
        return page;
    }

    private createPage(capacity: number, diagnostics: RHIFrameDiagnostics): WebGPUV2UploadPage {
        const native = this.owner.nativeHandle.createBuffer({
            label: 'WebGPU upload arena',
            size: capacity,
            usage: RHIBufferUsage.MAP_WRITE | RHIBufferUsage.COPY_SRC,
            mappedAtCreation: true
        });
        this.owner.recordNativeObjectCreated('buffer', 'complete');
        let bytes: Uint8Array;
        try {
            bytes = new Uint8Array(native.getMappedRange());
        } catch (error) {
            this.destroyBuffer(native);
            throw error;
        }
        const page: WebGPUV2UploadPage = {
            native,
            capacity,
            cursor: 0,
            bytes,
            state: 'ready',
            remapSucceeded: () => {
                this.completeRemap(page);
            },
            remapFailed: reason => {
                this.failRemap(page, reason);
            }
        };
        diagnostics.frameArenaGrowths++;
        diagnostics.transientAllocations++;
        return page;
    }

    private completeRemap(page: WebGPUV2UploadPage): void {
        if (page.state !== 'mapping') return;
        try {
            page.bytes = new Uint8Array(page.native.getMappedRange());
            page.cursor = 0;
            page.state = 'ready';
        } catch (error) {
            this.failRemap(page, error);
        }
    }

    private failRemap(page: WebGPUV2UploadPage, reason: unknown): void {
        if (page.state === 'destroyed') return;
        page.bytes = null;
        page.state = 'failed';
        this.#remapError =
            reason instanceof Error
                ? reason
                : new Error(`WebGPU upload page remap failed: ${String(reason)}`);
    }

    private assertRemapHealthy(): void {
        const error = this.#remapError;
        if (error !== null) {
            throw new Error('WebGPU upload arena could not remap a submitted page', {
                cause: error
            });
        }
    }

    private destroyBuffer(buffer: GPUBuffer): void {
        buffer.destroy();
        this.owner.recordNativeObjectDestroyed('buffer');
    }
}

export class WebGPUV2Submission extends WebGPUV2Object implements RHISubmission {
    readonly frameId: number;
    readonly done: Promise<void>;
    #status: RHISubmissionStatus = 'pending';
    #error: unknown;
    #released = false;
    readonly #completion: WebGPUV2Deferred<undefined>;

    constructor(
        readonly queue: WebGPUV2Queue,
        frameId: number,
        readonly references: WebGPUV2FrameReferences,
        nativeDone: Promise<void>
    ) {
        super(queue.owner, `WebGPU submission ${String(frameId)}`);
        this.frameId = frameId;
        this.#completion = createWebGPUV2Deferred<undefined>();
        this.done = this.#completion.promise;
        void this.done.catch(() => undefined);
        void nativeDone.then(
            () => {
                this.succeed();
            },
            (reason: unknown) => {
                this.fail(reason);
            }
        );
    }

    get status(): RHISubmissionStatus {
        return this.#status;
    }

    get error(): unknown {
        return this.#error;
    }

    /** @internal */
    succeed(): void {
        if (this.#status !== 'pending') return;
        this.#status = 'succeeded';
        this.releaseReferences();
        this.queue.forgetSubmission(this);
        this.#completion.resolve(undefined);
    }

    /** @internal */
    fail(reason: unknown): void {
        if (this.#status !== 'pending') return;
        this.#status = 'failed';
        this.#error = reason;
        this.releaseReferences();
        this.queue.forgetSubmission(this);
        this.#completion.reject(reason);
    }

    private releaseReferences(): void {
        if (this.#released) return;
        this.#released = true;
        this.queue.releaseFrameReferences(this.references);
    }
}

export class WebGPUV2Queue extends WebGPUV2Object implements RHIQueue {
    readonly #nativeQueue: GPUQueue;
    #queueState: RHIQueueState = 'idle';
    #activeContext: WebGPUV2CommandContext | null = null;
    readonly #pendingSubmissions = new Set<WebGPUV2Submission>();
    readonly #uploads: WebGPUV2UploadPool;
    readonly externalImages: WebGPUV2ExternalImageStager;
    /** @internal Native WebIDL dictionaries are consumed synchronously and reused per upload. */
    readonly textureUploadSource: GPUTexelCopyBufferInfo = {
        buffer: null as unknown as GPUBuffer,
        offset: 0,
        bytesPerRow: 0,
        rowsPerImage: 0
    };
    /** @internal Nested origin storage must remain identity-stable with the destination record. */
    readonly textureUploadOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
    /** @internal Native WebIDL dictionaries are consumed synchronously and reused per upload. */
    readonly textureUploadDestination: GPUTexelCopyTextureInfo = {
        texture: null as unknown as GPUTexture,
        mipLevel: 0,
        origin: this.textureUploadOrigin,
        aspect: 'all'
    };
    /** @internal Native WebIDL dictionaries are consumed synchronously and reused per upload. */
    readonly textureUploadExtent: GPUExtent3DDict = {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1
    };
    /** @internal Shared by synchronous external-image validation and native WebIDL conversion. */
    readonly externalImageDimensions: RHIExternalImageDimensionsStorage = {
        width: 0,
        height: 0
    };
    /** @internal Stable nested origin for the queue-owned external source dictionary. */
    readonly externalImageSourceOrigin: GPUOrigin2DDict = { x: 0, y: 0 };
    /** @internal Native WebIDL dictionaries are consumed synchronously and reused per upload. */
    readonly externalImageSource: GPUCopyExternalImageSourceInfo = {
        source: null as unknown as GPUCopyExternalImageSource,
        origin: this.externalImageSourceOrigin,
        flipY: false
    };
    /** @internal Stable nested origin for the queue-owned external destination dictionary. */
    readonly externalImageDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
    /** @internal Native WebIDL dictionaries are consumed synchronously and reused per upload. */
    readonly externalImageDestination: GPUCopyExternalImageDestInfo = {
        texture: null as unknown as GPUTexture,
        mipLevel: 0,
        origin: this.externalImageDestinationOrigin,
        aspect: 'all',
        colorSpace: 'srgb',
        premultipliedAlpha: false
    };
    /** @internal Native WebIDL dictionaries are consumed synchronously and reused per upload. */
    readonly externalImageExtent: GPUExtent3DDict = {
        width: 1,
        height: 1,
        depthOrArrayLayers: 1
    };
    readonly #freeFrameReferences: (WebGPUV2FrameReferences | null)[] = [];
    #freeFrameReferenceCount = 0;
    readonly #submitBuffers: GPUCommandBuffer[] = [null as unknown as GPUCommandBuffer];
    #renderPassStorage: WebGPUV2RenderPassStorage | null = null;
    #renderPassStorageLeased = false;

    constructor(owner: WebGPUV2Device, nativeQueue: GPUQueue) {
        super(owner, nativeQueue.label);
        this.#nativeQueue = nativeQueue;
        this.#uploads = new WebGPUV2UploadPool(owner);
        this.externalImages = new WebGPUV2ExternalImageStager(nativeQueue);
    }

    get state(): RHIQueueState {
        return this.#queueState;
    }

    /** @internal */
    get nativeHandle(): GPUQueue {
        return this.#nativeQueue;
    }

    beginFrame(descriptor: RHIFrameDescriptor = {}): WebGPUV2CommandContext {
        this.owner.assertUsable(this, 'queue');
        if (this.#queueState !== 'idle') {
            throw new RHIValidationError('invalid-state', `queue is ${this.#queueState}`, 'queue');
        }
        this.#uploads.beginFrame();
        const nativeEncoder = this.owner.nativeHandle.createCommandEncoder({
            label: descriptor.label ?? ''
        });
        this.owner.recordNativeObjectCreated('commandEncoder', 'creation-only');
        const context = new WebGPUV2CommandContext(
            this,
            nativeEncoder,
            descriptor,
            this.acquireFrameReferences()
        );
        this.#activeContext = context;
        this.#queueState = 'frame-open';
        return context;
    }

    endFrame(context: RHICommandContext): WebGPUV2Submission {
        const concreteContext = this.assertActiveContext(context);
        let commandBuffer: GPUCommandBuffer;
        try {
            commandBuffer = concreteContext.finishForSubmission();
        } catch (error) {
            const references = concreteContext.abort();
            this.releaseFrameReferences(references);
            this.#uploads.discardFrame();
            this.#activeContext = null;
            this.#queueState = 'idle';
            throw error;
        }

        try {
            this.#uploads.sealFrame();
            this.#submitBuffers[0] = commandBuffer;
            this.#nativeQueue.submit(this.#submitBuffers);
        } catch (error) {
            const references = concreteContext.retainedReferences;
            this.releaseFrameReferences(references);
            this.#uploads.recoverSubmissionFailure();
            this.#activeContext = null;
            this.#queueState = 'idle';
            throw error;
        } finally {
            this.#submitBuffers[0] = null as unknown as GPUCommandBuffer;
        }

        this.#uploads.remapSubmittedFrame();
        let nativeDone: Promise<void>;
        try {
            nativeDone = this.#nativeQueue.onSubmittedWorkDone();
        } catch (error) {
            nativeDone = Promise.reject(
                error instanceof Error
                    ? error
                    : new Error(`WebGPU queue fence failed: ${String(error)}`)
            );
        }
        const submission = new WebGPUV2Submission(
            this,
            concreteContext.frameId,
            concreteContext.retainedReferences,
            nativeDone
        );
        this.#pendingSubmissions.add(submission);
        this.#activeContext = null;
        this.#queueState = 'idle';
        return submission;
    }

    abortFrame(context: RHICommandContext, _reason?: unknown): void {
        const concreteContext = this.assertActiveContext(context);
        const references = concreteContext.abort();
        this.releaseFrameReferences(references);
        this.#uploads.discardFrame();
        this.#activeContext = null;
        this.#queueState = 'idle';
    }

    onSubmittedWorkDone(submission?: RHISubmission): Promise<void> {
        if (submission !== undefined) {
            if (!(submission instanceof WebGPUV2Submission) || submission.queue !== this) {
                return Promise.reject(
                    new RHIValidationError(
                        'wrong-device',
                        'submission belongs to another queue',
                        'submission'
                    )
                );
            }
            return submission.done;
        }
        return Promise.all([...this.#pendingSubmissions].map(item => item.done)).then(
            () => undefined
        );
    }

    /** @internal */
    lose(reason: unknown): void {
        if (this.#activeContext !== null) {
            const references = this.#activeContext.abort();
            this.releaseFrameReferences(references);
            this.#activeContext = null;
        }
        for (const submission of [...this.#pendingSubmissions]) submission.fail(reason);
        this.#uploads.release();
        this.#queueState = 'lost';
    }

    /** @internal */
    destroyQueue(reason: unknown): void {
        if (this.#activeContext !== null) {
            const references = this.#activeContext.abort();
            this.releaseFrameReferences(references);
            this.#activeContext = null;
        }
        for (const submission of [...this.#pendingSubmissions]) submission.fail(reason);
        this.#uploads.release();
        this.#queueState = 'destroyed';
    }

    /** @internal Queue.writeBuffer snapshots the source before this method returns. */
    stageUpload(
        data: RHIDataSource,
        dataOffset: number,
        byteLength: number,
        diagnostics: RHIFrameDiagnostics,
        result: WebGPUV2UploadAllocation,
        alignment = 4
    ): void {
        this.#uploads.stage(data, dataOffset, byteLength, diagnostics, result, alignment);
    }

    /** @internal */
    textureUploadScratch(required: number, diagnostics: RHIFrameDiagnostics): Uint8Array {
        return this.#uploads.textureScratch(required, diagnostics);
    }

    /** @internal */
    sourceBytes(data: RHIDataSource): Uint8Array {
        return this.#uploads.sourceBytes(data);
    }

    /** @internal */
    forgetSubmission(submission: WebGPUV2Submission): void {
        this.#pendingSubmissions.delete(submission);
    }

    /** @internal Release live slots, then recycle the high-water reference storage. */
    releaseFrameReferences(references: WebGPUV2FrameReferences): void {
        let index = 0;
        while (index < references.count) {
            const object = references.objects[index];
            if (object === undefined || object === null) {
                throw new Error('WebGPU frame reference storage contains an empty live slot');
            }
            references.objects[index] = null;
            object.releaseFromFrame();
            index += 1;
        }
        references.count = 0;
        this.#freeFrameReferences[this.#freeFrameReferenceCount] = references;
        this.#freeFrameReferenceCount += 1;
    }

    /** @internal A native pass consumes its descriptor synchronously and releases backing at end. */
    acquireRenderPassStorage(
        descriptor: RHIRenderPassDescriptor,
        context: WebGPUV2CommandContext
    ): WebGPUV2RenderPassStorage {
        if (this.#renderPassStorageLeased) {
            throw new Error('WebGPU render-pass backing is already leased');
        }
        let storage = this.#renderPassStorage;
        if (storage === null) {
            storage = new WebGPUV2RenderPassStorage(this.owner);
            this.#renderPassStorage = storage;
            context.diagnostics.frameArenaGrowths += 1;
            context.diagnostics.transientAllocations += 1;
        }
        this.#renderPassStorageLeased = true;
        try {
            storage.prepare(descriptor, context);
            return storage;
        } catch (error) {
            this.#renderPassStorageLeased = false;
            throw error;
        }
    }

    /** @internal */
    releaseRenderPassStorage(storage: WebGPUV2RenderPassStorage): void {
        if (storage !== this.#renderPassStorage || !this.#renderPassStorageLeased) {
            throw new Error('WebGPU render-pass backing is not leased');
        }
        storage.release();
        this.#renderPassStorageLeased = false;
    }

    private acquireFrameReferences(): WebGPUV2FrameReferences {
        if (this.#freeFrameReferenceCount === 0) return { objects: [], count: 0 };
        this.#freeFrameReferenceCount -= 1;
        const index = this.#freeFrameReferenceCount;
        const references = this.#freeFrameReferences[index];
        if (references === null || references === undefined) {
            throw new Error('WebGPU frame reference pool contains an empty free slot');
        }
        this.#freeFrameReferences[index] = null;
        return references;
    }

    private assertActiveContext(context: RHICommandContext): WebGPUV2CommandContext {
        this.owner.assertUsable(this, 'queue');
        if (
            this.#queueState !== 'frame-open' ||
            !(context instanceof WebGPUV2CommandContext) ||
            context !== this.#activeContext ||
            context.queue !== this
        ) {
            throw new RHIValidationError(
                'invalid-state',
                'context is not the active WebGPU frame',
                'context'
            );
        }
        return context;
    }
}
