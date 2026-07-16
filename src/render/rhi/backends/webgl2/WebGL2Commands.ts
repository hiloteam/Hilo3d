import {
    RHIBufferUsage,
    RHIValidationError,
    assertRHIObjectOwnedBy,
    assertRHIObjectOwnedByContext,
    createRHIRenderPassDescriptorSnapshotStorage,
    validateRHIWriteBuffer,
    validateRHIWriteTexture,
    validateRHICommandCopyExternalImageToTexture,
    validateRHICommandGenerateMipmaps,
    validateRHICopyBufferToBuffer,
    validateRHICopyBufferToTexture,
    validateRHICopyTextureToBuffer,
    validateRHICopyTextureToTexture,
    validateRHIRenderPassPipelineDepthStencilAccess,
    snapshotRHIRenderPassDescriptorInto,
    type RHIBindGroup,
    type RHIBuffer,
    type RHIColor,
    type RHICacheCounter,
    type RHICommandContext,
    type RHICommandContextState,
    type RHIDataSource,
    type RHIDrawArgumentsRecord,
    type RHIExtent3D,
    type RHIExternalImageDimensionsStorage,
    type RHIFrameDescriptor,
    type RHIFrameDiagnostics,
    type RHIGraphicsPipeline,
    type RHIImageCopyBuffer,
    type RHIImageCopyExternalImage,
    type RHIImageCopyExternalImageToTexture,
    type RHIImageCopyTexture,
    type RHIImageDataLayout,
    type RHIIndexBufferBindingRecord,
    type RHIIndexFormat,
    type RHIQueue,
    type RHIQueueState,
    type RHIRect,
    type RHIRenderPassDescriptor,
    type RHIRenderPassDescriptorSnapshotStorage,
    type RHIRenderPassEncoder,
    type RHIRenderPassState,
    type RHISubmission,
    type RHISubmissionStatus,
    type RHITextureAspect,
    type RHITexture,
    type RHIUInt32View,
    type RHIViewport,
    type RHIVertexBufferBindingRecord
} from '../../core';
import type { WebGL2RHIDevice } from './WebGL2Device';
import { webGL2FormatInfo } from './WebGL2Formats';
import {
    WEBGL2_BUFFER_OBJECT_KIND,
    WebGL2ObjectBase,
    hasWebGL2ObjectKind,
    requireNative,
    type WebGL2DestroyableBase,
    type WebGL2DestroyObserver
} from './WebGL2Internal';
import type {
    WebGL2GraphicsPipeline,
    WebGL2BoundGroup,
    WebGL2IndexBufferBinding,
    WebGL2VertexBufferBinding
} from './WebGL2Pipeline';
import type { WebGL2Buffer, WebGL2Texture, WebGL2TextureView } from './WebGL2Resources';

function resetDiagnostics(target?: RHIFrameDiagnostics): RHIFrameDiagnostics {
    const value = target ?? {
        commandCount: 0,
        drawCount: 0,
        pipelineSwitches: 0,
        bindGroupSwitches: 0,
        vertexBufferSwitches: 0,
        nativeStateCalls: 0,
        frameArenaGrowths: 0,
        transientAllocations: 0,
        cacheHits: 0,
        cacheMisses: 0
    };
    value.commandCount = 0;
    value.drawCount = 0;
    value.pipelineSwitches = 0;
    value.bindGroupSwitches = 0;
    value.vertexBufferSwitches = 0;
    value.nativeStateCalls = 0;
    value.frameArenaGrowths = 0;
    value.transientAllocations = 0;
    value.cacheHits = 0;
    value.cacheMisses = 0;
    return value;
}

function normalizedExtent(size: RHIExtent3D): Required<RHIExtent3D> {
    return {
        width: size.width,
        height: size.height ?? 1,
        depthOrArrayLayers: size.depthOrArrayLayers ?? 1
    };
}

function assertWebGL2BufferToTextureAspectCopySupported(
    texture: WebGL2Texture,
    aspect: RHITextureAspect,
    path: string
): void {
    const category = texture.formatInfo.category;
    if (category !== 'stencil' && category !== 'depth-stencil') return;
    throw new RHIValidationError(
        'unsupported-feature',
        `WebGL2 cannot copy the ${aspect} aspect of ${texture.format} from a buffer`,
        path
    );
}

function assertWebGL2CompressedBufferToTextureCopySupported(
    texture: WebGL2Texture,
    destination: RHIImageCopyTexture,
    size: RHIExtent3D
): void {
    if (texture.formatInfo.category !== 'compressed') return;
    const mipLevel = destination.mipLevel ?? 0;
    const mipWidth = Math.max(1, Math.floor(texture.width / 2 ** mipLevel));
    const mipHeight = Math.max(1, Math.floor(texture.height / 2 ** mipLevel));
    const originX = destination.origin?.x ?? 0;
    const originY = destination.origin?.y ?? 0;
    const width = size.width;
    const height = size.height ?? 1;
    if (originX === 0 && originY === 0 && width === mipWidth && height === mipHeight) {
        return;
    }
    throw new RHIValidationError(
        'unsupported-feature',
        'WebGL2 compressed buffer uploads support complete mip slices only; partial regions cannot preserve the portable top-left row contract',
        'destination'
    );
}

function assertWebGL2TextureToBufferAspectCopySupported(
    texture: WebGL2Texture,
    aspect: RHITextureAspect,
    path: string
): void {
    const category = texture.formatInfo.category;
    if (category !== 'depth' && category !== 'stencil' && category !== 'depth-stencil') return;
    throw new RHIValidationError(
        'unsupported-feature',
        `WebGL2 cannot copy the ${aspect} aspect of ${texture.format} to a buffer`,
        path
    );
}

type WebGL2ExternalImageUploadContext = WebGL2RenderingContext & {
    texSubImage2D(
        target: GLenum,
        level: GLint,
        xOffset: GLint,
        yOffset: GLint,
        width: GLsizei,
        height: GLsizei,
        format: GLenum,
        type: GLenum,
        source: RHIImageCopyExternalImage['source']
    ): void;
    texSubImage3D(
        target: GLenum,
        level: GLint,
        xOffset: GLint,
        yOffset: GLint,
        zOffset: GLint,
        width: GLsizei,
        height: GLsizei,
        depth: GLsizei,
        format: GLenum,
        type: GLenum,
        source: RHIImageCopyExternalImage['source']
    ): void;
};

function attachmentPoint(gl: WebGL2RenderingContext, view: WebGL2TextureView): GLenum {
    if (view.aspect === 'stencil-only' || view.format === 'stencil8') return gl.STENCIL_ATTACHMENT;
    if (
        view.aspect === 'depth-only' ||
        view.format === 'depth16unorm' ||
        view.format === 'depth24plus' ||
        view.format === 'depth32float'
    )
        return gl.DEPTH_ATTACHMENT;
    if (view.format.includes('stencil')) return gl.DEPTH_STENCIL_ATTACHMENT;
    return gl.COLOR_ATTACHMENT0;
}

function attachView(
    gl: WebGL2RenderingContext,
    target: GLenum,
    attachment: GLenum,
    view: WebGL2TextureView
): void {
    const texture = view.texture;
    if (texture.nativeRenderbuffer !== null) {
        gl.framebufferRenderbuffer(target, attachment, gl.RENDERBUFFER, texture.nativeRenderbuffer);
    } else if (texture.nativeTexture !== null && texture.target === gl.TEXTURE_2D) {
        gl.framebufferTexture2D(
            target,
            attachment,
            gl.TEXTURE_2D,
            texture.nativeTexture,
            view.descriptor.baseMipLevel
        );
    } else if (texture.nativeTexture !== null && texture.target === gl.TEXTURE_CUBE_MAP) {
        gl.framebufferTexture2D(
            target,
            attachment,
            gl.TEXTURE_CUBE_MAP_POSITIVE_X + view.descriptor.baseArrayLayer,
            texture.nativeTexture,
            view.descriptor.baseMipLevel
        );
    } else if (texture.nativeTexture !== null) {
        gl.framebufferTextureLayer(
            target,
            attachment,
            texture.nativeTexture,
            view.descriptor.baseMipLevel,
            view.descriptor.baseArrayLayer
        );
    } else {
        throw new RHIValidationError(
            'invalid-state',
            'surface texture cannot be attached to an offscreen framebuffer',
            'renderPass'
        );
    }
}

interface WebGL2FramebufferCacheRecord {
    readonly native: WebGLFramebuffer;
    readonly colorTextureIds: Uint32Array;
    readonly colorMipLevels: Uint32Array;
    readonly colorArrayLayers: Uint32Array;
    readonly depthTextureId: number;
    readonly depthMipLevel: number;
    readonly depthArrayLayer: number;
    lastUsed: number;
}

const MAX_FRAMEBUFFER_RECORDS = 256;

function viewMatches(
    textureId: number,
    mipLevel: number,
    arrayLayer: number,
    view: WebGL2TextureView | null
): boolean {
    return view === null
        ? textureId === 0
        : textureId === view.texture.id &&
              mipLevel === view.descriptor.baseMipLevel &&
              arrayLayer === view.descriptor.baseArrayLayer;
}

/** Device-generation cache of exact default/offscreen render-pass attachment bindings. */
export class WebGL2FramebufferCache {
    readonly #records: WebGL2FramebufferCacheRecord[] = [];
    #lastRecord: WebGL2FramebufferCacheRecord | null = null;
    #clock = 0;
    #hasSurfaceRecord = false;
    #surfaceFormat = '';
    #surfaceWidth = 0;
    #surfaceHeight = 0;
    #surfaceFramebuffer: WebGLFramebuffer | null = null;
    #surfaceExternal = false;

    constructor(
        readonly owner: WebGL2RHIDevice,
        readonly metrics: RHICacheCounter
    ) {}

    bindSurface(view: WebGL2TextureView): void {
        const texture = view.texture;
        const presentation = this.owner.nativePresentation;
        const matches =
            this.#hasSurfaceRecord &&
            this.#surfaceFormat === texture.format &&
            this.#surfaceWidth === texture.width &&
            this.#surfaceHeight === texture.height &&
            this.#surfaceFramebuffer === presentation.framebuffer &&
            this.#surfaceExternal === presentation.externalActive;
        if (matches) {
            this.recordHit();
        } else {
            if (this.#hasSurfaceRecord) this.metrics.recordReplacement();
            else this.metrics.recordInsertion();
            this.#hasSurfaceRecord = true;
            this.#surfaceFormat = texture.format;
            this.#surfaceWidth = texture.width;
            this.#surfaceHeight = texture.height;
            this.#surfaceFramebuffer = presentation.framebuffer;
            this.#surfaceExternal = presentation.externalActive;
            this.recordMiss();
        }
        const gl = this.owner.gl;
        this.owner.state.bindFramebuffer(gl.FRAMEBUFFER, presentation.framebuffer);
        gl.drawBuffers(presentation.drawBuffers);
    }

    bindOffscreen(descriptor: Readonly<RHIRenderPassDescriptor>): WebGLFramebuffer {
        let record = this.#lastRecord;
        if (record === null || !this.matches(record, descriptor)) {
            record = null;
            let index = 0;
            while (index < this.#records.length) {
                const candidate = this.#records[index];
                index++;
                if (candidate === undefined) continue;
                if (this.matches(candidate, descriptor)) {
                    record = candidate;
                    break;
                }
            }
        }
        if (record !== null) {
            record.lastUsed = ++this.#clock;
            this.#lastRecord = record;
            this.owner.state.bindFramebuffer(this.owner.gl.FRAMEBUFFER, record.native);
            this.recordHit();
            return record.native;
        }

        const replacement = this.createRecord(descriptor);
        if (this.#records.length === MAX_FRAMEBUFFER_RECORDS) {
            let oldestIndex = 0;
            for (let index = 1; index < this.#records.length; index += 1) {
                if (
                    (this.#records[index]?.lastUsed ?? Number.MAX_SAFE_INTEGER) <
                    (this.#records[oldestIndex]?.lastUsed ?? Number.MAX_SAFE_INTEGER)
                ) {
                    oldestIndex = index;
                }
            }
            const evicted = this.#records[oldestIndex];
            if (evicted) {
                this.owner.gl.deleteFramebuffer(evicted.native);
                this.owner.recordNativeObjectDestroyed('framebuffer');
            }
            this.#records[oldestIndex] = replacement;
            this.metrics.recordReplacement();
        } else {
            this.#records.push(replacement);
            this.metrics.recordInsertion();
        }
        this.#lastRecord = replacement;
        this.recordMiss();
        return replacement.native;
    }

    /** Remove every attachment plan that retains a texture being destroyed or replaced. */
    releaseTexture(textureId: number, contextLost = false): void {
        let removed = 0;
        for (let index = this.#records.length - 1; index >= 0; index -= 1) {
            const record = this.#records[index];
            if (
                record === undefined ||
                (record.depthTextureId !== textureId && !record.colorTextureIds.includes(textureId))
            ) {
                continue;
            }
            if (removed === 0 && !contextLost) {
                this.owner.state.bindFramebuffer(this.owner.gl.FRAMEBUFFER, null);
            }
            if (!contextLost) this.owner.gl.deleteFramebuffer(record.native);
            this.owner.recordNativeObjectDestroyed('framebuffer');
            if (this.#lastRecord === record) this.#lastRecord = null;
            this.#records.splice(index, 1);
            removed++;
        }
        if (removed > 0) this.metrics.recordRemoval(removed);
    }

    clear(contextLost: boolean): void {
        const recordCount = this.#records.length;
        if (!contextLost) {
            for (const record of this.#records) this.owner.gl.deleteFramebuffer(record.native);
        }
        if (recordCount > 0) {
            this.owner.recordNativeObjectDestroyed('framebuffer', recordCount);
        }
        this.#records.length = 0;
        this.#lastRecord = null;
        this.#hasSurfaceRecord = false;
        this.#surfaceFormat = '';
        this.#surfaceWidth = 0;
        this.#surfaceHeight = 0;
        this.#surfaceFramebuffer = null;
        this.#surfaceExternal = false;
        this.metrics.clear();
    }

    private matches(
        record: WebGL2FramebufferCacheRecord,
        descriptor: Readonly<RHIRenderPassDescriptor>
    ): boolean {
        const colors = descriptor.colorAttachments;
        if (record.colorTextureIds.length !== colors.length) return false;
        for (let index = 0; index < colors.length; index += 1) {
            const attachment = colors[index];
            const view =
                attachment === null || attachment === undefined
                    ? null
                    : this.owner.requireTextureView(attachment.view);
            if (
                !viewMatches(
                    record.colorTextureIds[index] ?? 0,
                    record.colorMipLevels[index] ?? 0,
                    record.colorArrayLayers[index] ?? 0,
                    view
                )
            ) {
                return false;
            }
        }
        const depth =
            descriptor.depthStencilAttachment === undefined
                ? null
                : this.owner.requireTextureView(descriptor.depthStencilAttachment.view);
        return viewMatches(
            record.depthTextureId,
            record.depthMipLevel,
            record.depthArrayLayer,
            depth
        );
    }

    private createRecord(
        descriptor: Readonly<RHIRenderPassDescriptor>
    ): WebGL2FramebufferCacheRecord {
        const gl = this.owner.gl;
        const colors = descriptor.colorAttachments;
        const colorTextureIds = new Uint32Array(colors.length);
        const colorMipLevels = new Uint32Array(colors.length);
        const colorArrayLayers = new Uint32Array(colors.length);
        const native = requireNative(gl.createFramebuffer(), 'render framebuffer');
        this.owner.recordNativeObjectCreated('framebuffer');
        this.owner.state.bindFramebuffer(gl.FRAMEBUFFER, native);
        try {
            const drawBuffers: GLenum[] = [];
            for (let index = 0; index < colors.length; index += 1) {
                const attachment = colors[index];
                if (attachment === null || attachment === undefined) {
                    drawBuffers.push(gl.NONE);
                    continue;
                }
                const view = this.owner.requireTextureView(attachment.view);
                colorTextureIds[index] = view.texture.id;
                colorMipLevels[index] = view.descriptor.baseMipLevel;
                colorArrayLayers[index] = view.descriptor.baseArrayLayer;
                attachView(gl, gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + index, view);
                drawBuffers.push(gl.COLOR_ATTACHMENT0 + index);
            }
            if (drawBuffers.length > 0) gl.drawBuffers(drawBuffers);
            let depthTextureId = 0;
            let depthMipLevel = 0;
            let depthArrayLayer = 0;
            if (descriptor.depthStencilAttachment !== undefined) {
                const depth = this.owner.requireTextureView(descriptor.depthStencilAttachment.view);
                depthTextureId = depth.texture.id;
                depthMipLevel = depth.descriptor.baseMipLevel;
                depthArrayLayer = depth.descriptor.baseArrayLayer;
                attachView(gl, gl.FRAMEBUFFER, attachmentPoint(gl, depth), depth);
            }
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('WebGL2 render framebuffer is incomplete');
            }
            return {
                native,
                colorTextureIds,
                colorMipLevels,
                colorArrayLayers,
                depthTextureId,
                depthMipLevel,
                depthArrayLayer,
                lastUsed: ++this.#clock
            };
        } catch (error) {
            gl.deleteFramebuffer(native);
            this.owner.recordNativeObjectDestroyed('framebuffer');
            throw error;
        }
    }

    private recordHit(): void {
        this.metrics.recordHit();
        this.owner.currentDiagnostics.cacheHits++;
    }

    private recordMiss(): void {
        this.metrics.recordMiss();
        this.owner.currentDiagnostics.cacheMisses++;
    }
}

const MAX_SAFE_INTEGER = 0x1fffffffffffff;

function isSafeIntegerPrimitive(value: unknown): value is number {
    return (
        typeof value === 'number' &&
        value >= -MAX_SAFE_INTEGER &&
        value <= MAX_SAFE_INTEGER &&
        value % 1 === 0
    );
}

function assertObservedObjectUsable(
    owner: WebGL2RHIDevice,
    object: WebGL2DestroyableBase,
    path: string
): void {
    if (owner.destroyed) {
        throw new RHIValidationError('destroyed-object', 'owner device is destroyed', path);
    }
    if (object.deviceId !== owner.id) {
        throw new RHIValidationError(
            'wrong-device',
            `belongs to device ${String(object.deviceId)}`,
            path
        );
    }
    if (object.deviceGeneration !== owner.generationValue) {
        throw new RHIValidationError(
            'stale-generation',
            `belongs to generation ${String(object.deviceGeneration)}, current generation is ${String(owner.generationValue)}`,
            path
        );
    }
    if (object.destroyed) {
        throw new RHIValidationError('destroyed-object', 'has been destroyed', path);
    }
}

const EMPTY_DYNAMIC_OFFSETS = new Uint32Array(0);
const EMPTY_GL_ENUMS: GLenum[] = [];
const CLEAR_COLOR_SCRATCH = new Float32Array(4);
const CLEAR_DEPTH_SCRATCH = new Float32Array(1);
const CLEAR_STENCIL_SCRATCH = new Int32Array(1);

type MutableRHIViewport = {
    -readonly [Key in keyof RHIViewport]: RHIViewport[Key];
};

/** Queue-owned backing leased only while one immediate WebGL render pass is open. */
class WebGL2RenderPassStorage {
    readonly snapshot: RHIRenderPassDescriptorSnapshotStorage;
    readonly attachmentViewport: MutableRHIViewport = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        minDepth: 0,
        maxDepth: 1
    };
    readonly groups: WebGL2BoundGroup[];
    readonly vertexBuffers: WebGL2VertexBufferBinding[];
    readonly indexBuffer: WebGL2IndexBufferBinding = {
        buffer: null,
        format: 'uint16',
        offset: 0,
        size: 0
    };
    readonly singleColorDrawBuffer: GLenum[];
    readonly #drawBufferArrays: (GLenum[] | undefined)[] = [];
    readonly #invalidateArrays: (GLenum[] | undefined)[] = [];
    drawBuffers: GLenum[] = [];

    constructor(readonly owner: WebGL2RHIDevice) {
        this.snapshot = createRHIRenderPassDescriptorSnapshotStorage();
        this.groups = Array.from({ length: owner.capabilities.limits.maxBindGroups }, () => ({
            group: null,
            dynamicOffsets: new Uint32Array(
                owner.capabilities.limits.maxDynamicUniformBuffersPerPipelineLayout
            ),
            dynamicOffsetCount: 0
        }));
        this.vertexBuffers = Array.from(
            { length: owner.capabilities.limits.maxVertexBuffers },
            () => ({ buffer: null, offset: 0, size: 0 })
        );
        this.singleColorDrawBuffer = [owner.gl.COLOR_ATTACHMENT0];
    }

    prepare(
        descriptor: RHIRenderPassDescriptor,
        diagnostics: RHIFrameDiagnostics
    ): Readonly<RHIRenderPassDescriptor> {
        if (snapshotRHIRenderPassDescriptorInto(this.owner, descriptor, this.snapshot)) {
            diagnostics.frameArenaGrowths++;
            diagnostics.transientAllocations++;
        }
        const colorCount = descriptor.colorAttachments.length;
        let drawBuffers = this.#drawBufferArrays[colorCount];
        if (drawBuffers === undefined) {
            drawBuffers = new Array<GLenum>(colorCount).fill(this.owner.gl.NONE);
            this.#drawBufferArrays[colorCount] = drawBuffers;
            diagnostics.frameArenaGrowths++;
            diagnostics.transientAllocations++;
        } else {
            drawBuffers.fill(this.owner.gl.NONE);
        }
        this.drawBuffers = drawBuffers;
        this.indexBuffer.buffer = null;
        this.indexBuffer.format = 'uint16';
        this.indexBuffer.offset = 0;
        this.indexBuffer.size = 0;
        let index = 0;
        while (index < this.groups.length) {
            const group = this.groups[index];
            index++;
            if (group === undefined) continue;
            group.group = null;
            group.dynamicOffsetCount = 0;
        }
        index = 0;
        while (index < this.vertexBuffers.length) {
            const binding = this.vertexBuffers[index];
            index++;
            if (binding === undefined) continue;
            binding.buffer = null;
            binding.offset = 0;
            binding.size = 0;
        }
        return this.snapshot.descriptor;
    }

    invalidateAttachments(
        descriptor: Readonly<RHIRenderPassDescriptor>,
        surface: boolean,
        diagnostics: RHIFrameDiagnostics
    ): GLenum[] {
        const colorBitCount = this.owner.capabilities.limits.maxColorAttachments;
        let mask = 0;
        for (let index = 0; index < descriptor.colorAttachments.length; index += 1) {
            if (descriptor.colorAttachments[index]?.storeOp === 'discard') mask += 2 ** index;
        }
        const depthStencil = descriptor.depthStencilAttachment;
        if (depthStencil?.depthStoreOp === 'discard') mask += 2 ** colorBitCount;
        if (depthStencil?.stencilStoreOp === 'discard') mask += 2 ** (colorBitCount + 1);
        if (mask === 0) return EMPTY_GL_ENUMS;
        if (surface) mask += 2 ** (colorBitCount + 2);
        let attachments = this.#invalidateArrays[mask];
        if (attachments !== undefined) return attachments;
        attachments = [];
        const gl = this.owner.gl;
        for (let index = 0; index < descriptor.colorAttachments.length; index += 1) {
            if (descriptor.colorAttachments[index]?.storeOp === 'discard') {
                attachments.push(surface ? gl.COLOR : gl.COLOR_ATTACHMENT0 + index);
            }
        }
        if (depthStencil?.depthStoreOp === 'discard') {
            attachments.push(surface ? gl.DEPTH : gl.DEPTH_ATTACHMENT);
        }
        if (depthStencil?.stencilStoreOp === 'discard') {
            attachments.push(surface ? gl.STENCIL : gl.STENCIL_ATTACHMENT);
        }
        this.#invalidateArrays[mask] = attachments;
        diagnostics.frameArenaGrowths++;
        diagnostics.transientAllocations++;
        return attachments;
    }

    release(): void {
        this.indexBuffer.buffer = null;
        let index = 0;
        while (index < this.groups.length) {
            const group = this.groups[index];
            index++;
            if (group === undefined) continue;
            group.group = null;
            group.dynamicOffsetCount = 0;
        }
        index = 0;
        while (index < this.vertexBuffers.length) {
            const binding = this.vertexBuffers[index];
            index++;
            if (binding !== undefined) binding.buffer = null;
        }
    }
}

const MIN_TRANSFER_BUFFER_CAPACITY = 256;

function transferBufferCapacity(current: number, required: number): number {
    let capacity = Math.max(MIN_TRANSFER_BUFFER_CAPACITY, current);
    while (capacity < required) capacity *= 2;
    return capacity;
}

/** Queue-owned native transfer objects retained at their device-generation high-water mark. */
class WebGL2TransferPool {
    #uploadBuffer: WebGLBuffer | null = null;
    #uploadCapacity = 0;
    #readFramebuffer: WebGLFramebuffer | null = null;
    #drawFramebuffer: WebGLFramebuffer | null = null;
    #surfaceResolveRenderbuffer: WebGLRenderbuffer | null = null;
    #surfaceResolveInternalFormat = 0;
    #surfaceResolveWidth = 0;
    #surfaceResolveHeight = 0;
    readonly #byteViews = new WeakMap<object, Uint8Array>();

    constructor(readonly owner: WebGL2RHIDevice) {}

    stageTextureUpload(data: RHIDataSource, diagnostics: RHIFrameDiagnostics): WebGLBuffer {
        const gl = this.owner.gl;
        let buffer = this.#uploadBuffer;
        if (buffer === null) {
            buffer = requireNative(gl.createBuffer(), 'texture-write staging buffer');
            this.owner.recordNativeObjectCreated('buffer');
            this.#uploadBuffer = buffer;
        }
        this.owner.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer);
        if (this.#uploadCapacity < data.byteLength) {
            this.#uploadCapacity = transferBufferCapacity(this.#uploadCapacity, data.byteLength);
            gl.bufferData(gl.PIXEL_UNPACK_BUFFER, this.#uploadCapacity, gl.STREAM_DRAW);
            diagnostics.frameArenaGrowths++;
            diagnostics.transientAllocations++;
        }
        // WebGL snapshots BufferSource synchronously. Passing the caller's exact source keeps
        // texture staging free of temporary byte views; byte addressing happens later through
        // the pixel-unpack-buffer offset.
        gl.bufferSubData(gl.PIXEL_UNPACK_BUFFER, 0, data);
        return buffer;
    }

    sourceBytes(data: RHIDataSource): Uint8Array {
        if (data instanceof Uint8Array) return data;
        const key = data as object;
        let bytes = this.#byteViews.get(key);
        if (bytes !== undefined) return bytes;
        bytes =
            data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.#byteViews.set(key, bytes);
        return bytes;
    }

    copyReadFramebuffer(): WebGLFramebuffer {
        let framebuffer = this.#readFramebuffer;
        if (framebuffer === null) {
            framebuffer = requireNative(this.owner.gl.createFramebuffer(), 'copy read framebuffer');
            this.owner.recordNativeObjectCreated('framebuffer');
            this.#readFramebuffer = framebuffer;
        }
        return framebuffer;
    }

    copyDrawFramebuffer(): WebGLFramebuffer {
        let framebuffer = this.#drawFramebuffer;
        if (framebuffer === null) {
            framebuffer = requireNative(this.owner.gl.createFramebuffer(), 'copy draw framebuffer');
            this.owner.recordNativeObjectCreated('framebuffer');
            this.#drawFramebuffer = framebuffer;
        }
        return framebuffer;
    }

    surfaceResolveRenderbuffer(
        internalFormat: GLenum,
        width: number,
        height: number
    ): WebGLRenderbuffer {
        const gl = this.owner.gl;
        let renderbuffer = this.#surfaceResolveRenderbuffer;
        if (renderbuffer === null) {
            renderbuffer = requireNative(gl.createRenderbuffer(), 'surface resolve renderbuffer');
            this.owner.recordNativeObjectCreated('renderbuffer');
            this.#surfaceResolveRenderbuffer = renderbuffer;
        }
        this.owner.state.bindRenderbuffer(renderbuffer);
        if (
            this.#surfaceResolveInternalFormat !== internalFormat ||
            this.#surfaceResolveWidth !== width ||
            this.#surfaceResolveHeight !== height
        ) {
            gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
            this.#surfaceResolveInternalFormat = internalFormat;
            this.#surfaceResolveWidth = width;
            this.#surfaceResolveHeight = height;
        }
        this.owner.state.bindRenderbuffer(null);
        return renderbuffer;
    }

    release(contextLost: boolean): void {
        const gl = this.owner.gl;
        if (this.#uploadBuffer !== null) {
            if (!contextLost) gl.deleteBuffer(this.#uploadBuffer);
            this.owner.recordNativeObjectDestroyed('buffer');
            this.#uploadBuffer = null;
        }
        if (this.#readFramebuffer !== null) {
            if (!contextLost) gl.deleteFramebuffer(this.#readFramebuffer);
            this.owner.recordNativeObjectDestroyed('framebuffer');
            this.#readFramebuffer = null;
        }
        if (this.#drawFramebuffer !== null) {
            if (!contextLost) gl.deleteFramebuffer(this.#drawFramebuffer);
            this.owner.recordNativeObjectDestroyed('framebuffer');
            this.#drawFramebuffer = null;
        }
        if (this.#surfaceResolveRenderbuffer !== null) {
            if (!contextLost) gl.deleteRenderbuffer(this.#surfaceResolveRenderbuffer);
            this.owner.recordNativeObjectDestroyed('renderbuffer');
            this.#surfaceResolveRenderbuffer = null;
        }
        this.#uploadCapacity = 0;
        this.#surfaceResolveInternalFormat = 0;
        this.#surfaceResolveWidth = 0;
        this.#surfaceResolveHeight = 0;
    }
}

class WebGL2Submission extends WebGL2ObjectBase implements RHISubmission {
    readonly status: RHISubmissionStatus = 'succeeded';
    readonly done = Promise.resolve();
    readonly error = undefined;

    constructor(
        owner: WebGL2RHIDevice,
        readonly frameId: number
    ) {
        super(owner, `WebGL2 submission ${String(frameId)}`);
    }
}

export class WebGL2Queue extends WebGL2ObjectBase implements RHIQueue {
    #state: RHIQueueState = 'idle';
    #active: WebGL2CommandContext | null = null;
    #lastSubmission: WebGL2Submission | null = null;
    #nextFrameId = 1;
    readonly #transfers: WebGL2TransferPool;
    /** @internal Shared by the synchronous external-image validation/upload command. */
    readonly externalImageDimensions: RHIExternalImageDimensionsStorage = {
        width: 0,
        height: 0
    };
    #renderPassStorage: WebGL2RenderPassStorage | null = null;
    #renderPassStorageLeased = false;

    constructor(owner: WebGL2RHIDevice) {
        super(owner, 'WebGL2 graphics queue');
        this.#transfers = new WebGL2TransferPool(owner);
    }

    get state(): RHIQueueState {
        return this.#state;
    }

    beginFrame(descriptor: RHIFrameDescriptor = {}): WebGL2CommandContext {
        if (this.#state !== 'idle')
            throw new RHIValidationError('invalid-state', `queue is ${this.#state}`, 'queue');
        this.assertUsable('queue');
        this.owner.nativePresentation.assertFrameAvailable();
        const diagnostics = resetDiagnostics(descriptor.diagnostics);
        const frameId = descriptor.frameIndex ?? this.#nextFrameId++;
        const context = new WebGL2CommandContext(
            this.owner,
            this,
            frameId,
            descriptor.label ?? '',
            diagnostics
        );
        this.#active = context;
        this.#state = 'frame-open';
        this.owner.currentDiagnostics = diagnostics;
        this.owner.state.setDiagnostics(diagnostics);
        return context;
    }

    endFrame(context: RHICommandContext): WebGL2Submission {
        const concrete = this.requireActive(context);
        if (concrete.state !== 'open')
            throw new RHIValidationError(
                'invalid-state',
                `context is ${concrete.state}`,
                'context'
            );
        try {
            this.owner.gl.flush();
            this.owner.assertNoNativeError('endFrame');
        } catch (error) {
            this.onExecutionFailure(concrete, error);
            throw error;
        }
        concrete.finish();
        const submission = new WebGL2Submission(this.owner, concrete.frameId);
        this.#lastSubmission = submission;
        this.#active = null;
        this.#state = 'idle';
        this.owner.state.setDiagnostics(null);
        return submission;
    }

    abortFrame(context: RHICommandContext, _reason?: unknown): void {
        const concrete = this.requireActive(context);
        concrete.abort();
        this.owner.discardNativeErrors();
        this.#active = null;
        this.#state = 'idle';
        this.owner.state.setDiagnostics(null);
        this.owner.state.reset();
    }

    onSubmittedWorkDone(submission?: RHISubmission): Promise<void> {
        if (submission !== undefined) {
            assertRHIObjectOwnedBy(this.owner, submission, 'submission');
            return submission.done;
        }
        return this.#lastSubmission?.done ?? Promise.resolve();
    }

    onExecutionFailure(context: WebGL2CommandContext, _error: unknown): void {
        if (this.#active !== context) return;
        context.abort();
        this.owner.discardNativeErrors();
        this.#active = null;
        this.#state = 'idle';
        this.owner.state.setDiagnostics(null);
        this.owner.state.reset();
    }

    handleContextLost(_error: unknown): void {
        this.#active?.abort();
        this.#active = null;
        this.#state = 'lost';
        this.owner.state.setDiagnostics(null);
        this.#transfers.release(true);
    }

    handleDeviceDestroyed(_error: unknown): void {
        this.#active?.abort();
        this.#active = null;
        this.#state = 'destroyed';
        this.owner.state.setDiagnostics(null);
        this.#transfers.release(false);
    }

    /** @internal */
    stageTextureUpload(data: RHIDataSource, diagnostics: RHIFrameDiagnostics): WebGLBuffer {
        return this.#transfers.stageTextureUpload(data, diagnostics);
    }

    /** @internal Cold fallback for byte ranges that WebGL cannot address in source elements. */
    sourceBytes(data: RHIDataSource): Uint8Array {
        return this.#transfers.sourceBytes(data);
    }

    /** @internal */
    copyReadFramebuffer(): WebGLFramebuffer {
        return this.#transfers.copyReadFramebuffer();
    }

    /** @internal */
    copyDrawFramebuffer(): WebGLFramebuffer {
        return this.#transfers.copyDrawFramebuffer();
    }

    /** @internal */
    surfaceResolveRenderbuffer(
        internalFormat: GLenum,
        width: number,
        height: number
    ): WebGLRenderbuffer {
        return this.#transfers.surfaceResolveRenderbuffer(internalFormat, width, height);
    }

    /** @internal Lease queue-owned pass backing; nested passes are rejected by the context first. */
    acquireRenderPassStorage(
        descriptor: RHIRenderPassDescriptor,
        diagnostics: RHIFrameDiagnostics
    ): WebGL2RenderPassStorage {
        if (this.#renderPassStorageLeased) {
            throw new Error('WebGL2 render-pass backing is already leased');
        }
        let storage = this.#renderPassStorage;
        if (storage === null) {
            storage = new WebGL2RenderPassStorage(this.owner);
            this.#renderPassStorage = storage;
            diagnostics.frameArenaGrowths++;
            diagnostics.transientAllocations++;
        }
        this.#renderPassStorageLeased = true;
        try {
            storage.prepare(descriptor, diagnostics);
            return storage;
        } catch (error) {
            this.#renderPassStorageLeased = false;
            throw error;
        }
    }

    /** @internal */
    releaseRenderPassStorage(storage: WebGL2RenderPassStorage): void {
        if (storage !== this.#renderPassStorage || !this.#renderPassStorageLeased) {
            throw new Error('WebGL2 render-pass backing is not leased');
        }
        storage.release();
        this.#renderPassStorageLeased = false;
    }

    private requireActive(context: RHICommandContext): WebGL2CommandContext {
        if (
            !(context instanceof WebGL2CommandContext) ||
            context !== this.#active ||
            this.#state !== 'frame-open'
        ) {
            throw new RHIValidationError(
                'invalid-state',
                'context is not the active queue frame',
                'context'
            );
        }
        assertRHIObjectOwnedBy(this.owner, context, 'context');
        return context;
    }
}

export class WebGL2CommandContext extends WebGL2ObjectBase implements RHICommandContext {
    #state: RHICommandContextState = 'open';
    #activePass: WebGL2RenderPass | null = null;
    #externalImageUploadPhase = true;

    constructor(
        owner: WebGL2RHIDevice,
        readonly queue: WebGL2Queue,
        readonly frameId: number,
        label: string,
        readonly diagnostics: RHIFrameDiagnostics
    ) {
        super(owner, label);
    }

    get state(): RHICommandContextState {
        return this.#state;
    }

    writeBuffer(
        destination: RHIBuffer,
        destinationOffset: number,
        data: RHIDataSource,
        dataOffset = 0,
        size?: number
    ): void {
        this.requireOpen();
        validateRHIWriteBuffer(this.owner, destination, destinationOffset, data, dataOffset, size);
        const writeSize = size ?? data.byteLength - dataOffset;
        const concrete = this.owner.requireBuffer(destination);
        this.closeExternalImageUploadPhase();
        try {
            const gl = this.owner.gl;
            this.owner.state.bindBuffer(concrete.nativeTarget, concrete.native);
            const elementSize = ArrayBuffer.isView(data)
                ? (Reflect.get(data, 'BYTES_PER_ELEMENT') as unknown)
                : undefined;
            const direct =
                ArrayBuffer.isView(data) &&
                (typeof elementSize !== 'number' ||
                    elementSize <= 1 ||
                    (dataOffset % elementSize === 0 && writeSize % elementSize === 0));
            const source = direct ? data : this.queue.sourceBytes(data);
            const sourceOffset =
                direct && typeof elementSize === 'number' && elementSize > 1
                    ? dataOffset / elementSize
                    : dataOffset;
            const sourceSize =
                direct && typeof elementSize === 'number' && elementSize > 1
                    ? writeSize / elementSize
                    : writeSize;
            gl.bufferSubData(
                concrete.nativeTarget,
                destinationOffset,
                source,
                sourceOffset,
                sourceSize
            );
            this.nativeSucceeded('writeBuffer');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIDataSource,
        dataLayout: RHIImageDataLayout,
        writeSize: RHIExtent3D
    ): void {
        this.requireOpen();
        validateRHIWriteTexture(this.owner, destination, data, dataLayout, writeSize);
        const texture = this.owner.requireTexture(destination.texture);
        assertWebGL2BufferToTextureAspectCopySupported(
            texture,
            destination.aspect ?? 'all',
            'destination.aspect'
        );
        assertWebGL2CompressedBufferToTextureCopySupported(texture, destination, writeSize);
        this.closeExternalImageUploadPhase();
        try {
            const gl = this.owner.gl;
            this.queue.stageTextureUpload(data, this.diagnostics);
            try {
                this.uploadBufferBytesToTexture(dataLayout, texture, destination, writeSize);
            } finally {
                this.owner.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
            }
            this.nativeSucceeded('writeTexture');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyExternalImageToTexture,
        copySize: RHIExtent3D
    ): void {
        validateRHICommandCopyExternalImageToTexture(
            this,
            source,
            destination,
            copySize,
            this.queue.externalImageDimensions
        );
        if (!this.#externalImageUploadPhase) {
            throw new RHIValidationError(
                'invalid-state',
                'external-image copies must precede every other frame command',
                'context'
            );
        }
        const texture = this.owner.requireTexture(destination.texture);
        try {
            this.uploadExternalImageToTexture(
                source,
                texture,
                destination,
                copySize,
                this.queue.externalImageDimensions
            );
            this.nativeSucceeded('copyExternalImageToTexture');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    generateMipmaps(texture: RHITexture): void {
        validateRHICommandGenerateMipmaps(this, texture);
        const concrete = this.owner.requireTexture(texture);
        this.closeExternalImageUploadPhase();
        try {
            const gl = this.owner.gl;
            if (concrete.nativeTexture === null) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'surface and multisample textures cannot generate mipmaps',
                    'texture'
                );
            }
            const previousActiveTexture = this.owner.state.activeTextureUnit;
            const previousTexture = this.owner.state.boundTexture(0, concrete.target);
            try {
                concrete.bindFullMipChain(0);
                gl.generateMipmap(concrete.target);
                this.diagnostics.nativeStateCalls++;
            } finally {
                this.owner.state.bindTexture(0, concrete.target, previousTexture);
                this.owner.state.activeTexture(previousActiveTexture);
            }
            this.nativeSucceeded('generateMipmaps');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    beginRenderPass(descriptor: RHIRenderPassDescriptor): WebGL2RenderPass {
        this.requireOpen();
        const storage = this.queue.acquireRenderPassStorage(descriptor, this.diagnostics);
        this.closeExternalImageUploadPhase();
        const pass = new WebGL2RenderPass(this.owner, this, storage);
        this.#activePass = pass;
        this.#state = 'render-pass';
        try {
            pass.beginNative();
            this.nativeSucceeded('beginRenderPass');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
        return pass;
    }

    copyBufferToBuffer(
        source: RHIBuffer,
        sourceOffset: number,
        destination: RHIBuffer,
        destinationOffset: number,
        size: number
    ): void {
        validateRHICopyBufferToBuffer(
            this,
            source,
            sourceOffset,
            destination,
            destinationOffset,
            size
        );
        const src = this.owner.requireBuffer(source);
        const dst = this.owner.requireBuffer(destination);
        this.closeExternalImageUploadPhase();
        try {
            const gl = this.owner.gl;
            this.owner.state.bindBuffer(gl.COPY_READ_BUFFER, src.native);
            this.owner.state.bindBuffer(gl.COPY_WRITE_BUFFER, dst.native);
            gl.copyBufferSubData(
                gl.COPY_READ_BUFFER,
                gl.COPY_WRITE_BUFFER,
                sourceOffset,
                destinationOffset,
                size
            );
            this.nativeSucceeded('copyBufferToBuffer');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        validateRHICopyBufferToTexture(this, source, destination, copySize);
        const src = this.owner.requireBuffer(source.buffer);
        const dst = this.owner.requireTexture(destination.texture);
        assertWebGL2BufferToTextureAspectCopySupported(
            dst,
            destination.aspect ?? 'all',
            'destination.aspect'
        );
        assertWebGL2CompressedBufferToTextureCopySupported(dst, destination, copySize);
        this.closeExternalImageUploadPhase();
        try {
            this.copyBufferToTextureNative(src, source, dst, destination, copySize);
            this.nativeSucceeded('copyBufferToTexture');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void {
        validateRHICopyTextureToBuffer(this, source, destination, copySize);
        const src = this.owner.requireTexture(source.texture);
        const dst = this.owner.requireBuffer(destination.buffer);
        assertWebGL2TextureToBufferAspectCopySupported(
            src,
            source.aspect ?? 'all',
            'source.aspect'
        );
        this.closeExternalImageUploadPhase();
        try {
            this.copyTextureToBufferNative(src, source, dst, destination, copySize);
            this.nativeSucceeded('copyTextureToBuffer');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        validateRHICopyTextureToTexture(this, source, destination, copySize);
        const src = this.owner.requireTexture(source.texture);
        const dst = this.owner.requireTexture(destination.texture);
        this.closeExternalImageUploadPhase();
        try {
            this.copyTextureToTextureNative(src, source, dst, destination, copySize);
            this.nativeSucceeded('copyTextureToTexture');
        } catch (error) {
            this.nativeFailed(error);
        }
        this.diagnostics.commandCount++;
    }

    nativeSucceeded(operation: string): void {
        this.owner.assertNoNativeError(operation);
    }

    nativeFailed(error: unknown): never {
        this.queue.onExecutionFailure(this, error);
        throw error;
    }

    finishPass(pass: WebGL2RenderPass, storage: WebGL2RenderPassStorage): void {
        if (this.#activePass !== pass)
            throw new RHIValidationError(
                'invalid-state',
                'render pass is not active',
                'renderPass'
            );
        this.#activePass = null;
        this.#state = 'open';
        this.queue.releaseRenderPassStorage(storage);
    }

    /** @internal Release backing while the frame itself transitions to aborted. */
    abortPass(pass: WebGL2RenderPass, storage: WebGL2RenderPassStorage): void {
        if (this.#activePass !== pass) return;
        this.#activePass = null;
        this.queue.releaseRenderPassStorage(storage);
    }

    finish(): void {
        this.#state = 'ended';
    }

    abort(): void {
        this.#activePass?.abort();
        this.#activePass = null;
        this.#state = 'aborted';
    }

    private requireOpen(): void {
        if (this.#state !== 'open')
            throw new RHIValidationError('invalid-state', `context is ${this.#state}`, 'context');
    }

    private closeExternalImageUploadPhase(): void {
        this.#externalImageUploadPhase = false;
    }

    private uploadExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destinationTexture: WebGL2Texture,
        destination: RHIImageCopyExternalImageToTexture,
        size: RHIExtent3D,
        sourceDimensions: Readonly<{ readonly width: number; readonly height: number }>
    ): void {
        const gl = this.owner.gl;
        if (destinationTexture.nativeTexture === null) {
            throw new RHIValidationError(
                'unsupported-feature',
                'cannot copy an external image into a surface or multisample texture',
                'destination.texture'
            );
        }
        const state = this.owner.state;
        const previousActiveTexture = state.activeTextureUnit;
        const previousTexture = state.boundTexture(0, destinationTexture.target);
        const previousUnpackBuffer = state.boundBuffer(gl.PIXEL_UNPACK_BUFFER);
        const previousAlignment = state.pixelStore(gl.UNPACK_ALIGNMENT, 4);
        const previousRowLength = state.pixelStore(gl.UNPACK_ROW_LENGTH, 0);
        const previousImageHeight = state.pixelStore(gl.UNPACK_IMAGE_HEIGHT, 0);
        const previousSkipPixels = state.pixelStore(gl.UNPACK_SKIP_PIXELS, 0);
        const previousSkipRows = state.pixelStore(gl.UNPACK_SKIP_ROWS, 0);
        const previousSkipImages = state.pixelStore(gl.UNPACK_SKIP_IMAGES, 0);
        const previousFlipY = state.pixelStore(gl.UNPACK_FLIP_Y_WEBGL, 0);
        const previousPremultipliedAlpha = state.pixelStore(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        const previousColorspaceConversion = state.pixelStore(
            gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
            gl.BROWSER_DEFAULT_WEBGL
        );
        const width = size.width;
        const height = size.height ?? 1;
        const destinationX = destination.origin?.x ?? 0;
        const destinationY = destination.origin?.y ?? 0;
        const destinationZ = destination.origin?.z ?? 0;
        const mipLevel = destination.mipLevel ?? 0;
        const mipHeight = Math.max(1, Math.floor(destinationTexture.height / 2 ** mipLevel));
        const nativeDestinationY = mipHeight - destinationY - height;
        const info = destinationTexture.formatInfo;
        const externalGL = gl as WebGL2ExternalImageUploadContext;
        try {
            state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
            state.activateTextureBinding(
                0,
                destinationTexture.target,
                destinationTexture.nativeTexture
            );
            state.setPixelStore(gl.UNPACK_ALIGNMENT, 1);
            state.setPixelStore(gl.UNPACK_ROW_LENGTH, sourceDimensions.width);
            state.setPixelStore(gl.UNPACK_IMAGE_HEIGHT, sourceDimensions.height);
            state.setPixelStore(gl.UNPACK_SKIP_PIXELS, source.origin?.x ?? 0);
            state.setPixelStore(gl.UNPACK_SKIP_ROWS, source.origin?.y ?? 0);
            state.setPixelStore(gl.UNPACK_SKIP_IMAGES, 0);
            // DOM uploads place the source's first row at WebGL's bottom row. Invert the native
            // flag so the public RHI contract retains top-left rows unless flipY is requested.
            state.setPixelStore(gl.UNPACK_FLIP_Y_WEBGL, source.flipY === true ? 0 : 1);
            state.setPixelStore(
                gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
                destination.premultipliedAlpha === true ? 1 : 0
            );
            state.setPixelStore(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
            if (
                destinationTexture.target === gl.TEXTURE_2D ||
                destinationTexture.target === gl.TEXTURE_CUBE_MAP
            ) {
                const target =
                    destinationTexture.target === gl.TEXTURE_CUBE_MAP
                        ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + destinationZ
                        : gl.TEXTURE_2D;
                externalGL.texSubImage2D(
                    target,
                    mipLevel,
                    destinationX,
                    nativeDestinationY,
                    width,
                    height,
                    info.format,
                    info.type,
                    source.source
                );
            } else {
                externalGL.texSubImage3D(
                    destinationTexture.target,
                    mipLevel,
                    destinationX,
                    nativeDestinationY,
                    destinationZ,
                    width,
                    height,
                    1,
                    info.format,
                    info.type,
                    source.source
                );
            }
        } finally {
            state.setPixelStore(gl.UNPACK_ALIGNMENT, previousAlignment);
            state.setPixelStore(gl.UNPACK_ROW_LENGTH, previousRowLength);
            state.setPixelStore(gl.UNPACK_IMAGE_HEIGHT, previousImageHeight);
            state.setPixelStore(gl.UNPACK_SKIP_PIXELS, previousSkipPixels);
            state.setPixelStore(gl.UNPACK_SKIP_ROWS, previousSkipRows);
            state.setPixelStore(gl.UNPACK_SKIP_IMAGES, previousSkipImages);
            state.setPixelStore(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
            state.setPixelStore(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, previousPremultipliedAlpha);
            state.setPixelStore(
                gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
                previousColorspaceConversion
            );
            state.bindTexture(0, destinationTexture.target, previousTexture);
            state.activeTexture(previousActiveTexture);
            state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, previousUnpackBuffer);
        }
    }

    private copyBufferToTextureNative(
        sourceBuffer: WebGL2Buffer,
        source: RHIImageCopyBuffer,
        destinationTexture: WebGL2Texture,
        destination: RHIImageCopyTexture,
        size: RHIExtent3D
    ): void {
        const gl = this.owner.gl;
        this.owner.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, sourceBuffer.native);
        this.uploadBufferBytesToTexture(source, destinationTexture, destination, size);
        this.owner.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    }

    private uploadBufferBytesToTexture(
        source: RHIImageDataLayout,
        destinationTexture: WebGL2Texture,
        destination: RHIImageCopyTexture,
        size: RHIExtent3D
    ): void {
        const gl = this.owner.gl;
        if (destinationTexture.nativeTexture === null)
            throw new RHIValidationError(
                'unsupported-feature',
                'cannot copy into surface or multisample texture',
                'destination.texture'
            );
        const width = size.width;
        const height = size.height ?? 1;
        const depthOrArrayLayers = size.depthOrArrayLayers ?? 1;
        const originX = destination.origin?.x ?? 0;
        const originY = destination.origin?.y ?? 0;
        const originZ = destination.origin?.z ?? 0;
        const mip = destination.mipLevel ?? 0;
        const mipHeight = Math.max(1, Math.floor(destinationTexture.height / 2 ** mip));
        const info = destinationTexture.formatInfo;
        const blockColumns = Math.ceil(width / info.blockWidth);
        const blockRows = Math.ceil(height / info.blockHeight);
        const tightBytesPerRow = blockColumns * info.bytesPerBlock;
        const bytesPerRow = source.bytesPerRow ?? tightBytesPerRow;
        const rowsPerImage = source.rowsPerImage ?? blockRows;
        this.owner.state.activateTextureBinding(
            0,
            destinationTexture.target,
            destinationTexture.nativeTexture
        );
        this.owner.state.setPixelStore(gl.UNPACK_ALIGNMENT, 1);
        if (info.category === 'compressed') {
            this.owner.state.setPixelStore(gl.UNPACK_ROW_LENGTH, 0);
            if (bytesPerRow !== tightBytesPerRow || rowsPerImage !== blockRows) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'WebGL2 compressed texture uploads require tightly packed texel-block rows',
                    'dataLayout'
                );
            }
            const imageSize = tightBytesPerRow * blockRows;
            for (let layer = 0; layer < depthOrArrayLayers; layer += 1) {
                const offset = (source.offset ?? 0) + layer * imageSize;
                if (
                    destinationTexture.target === gl.TEXTURE_2D ||
                    destinationTexture.target === gl.TEXTURE_CUBE_MAP
                ) {
                    const target =
                        destinationTexture.target === gl.TEXTURE_CUBE_MAP
                            ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + originZ + layer
                            : destinationTexture.target;
                    gl.compressedTexSubImage2D(
                        target,
                        mip,
                        originX,
                        originY,
                        width,
                        height,
                        info.internalFormat,
                        imageSize,
                        offset
                    );
                } else {
                    gl.compressedTexSubImage3D(
                        destinationTexture.target,
                        mip,
                        originX,
                        originY,
                        originZ + layer,
                        width,
                        height,
                        1,
                        info.internalFormat,
                        imageSize,
                        offset
                    );
                }
            }
            return;
        }
        this.owner.state.setPixelStore(gl.UNPACK_ROW_LENGTH, bytesPerRow / info.bytesPerTexel);
        // PBO and typed-array uploads cannot use the DOM-source flip flag. Address each source
        // row directly so portable top-to-bottom order reaches WebGL's bottom-left texture space
        // without allocating a vertically flipped staging image.
        for (let layer = 0; layer < depthOrArrayLayers; layer += 1) {
            const layerOffset = (source.offset ?? 0) + layer * rowsPerImage * bytesPerRow;
            for (let row = 0; row < height; row += 1) {
                const offset = layerOffset + row * bytesPerRow;
                const destinationY = mipHeight - originY - 1 - row;
                if (
                    destinationTexture.target === gl.TEXTURE_2D ||
                    destinationTexture.target === gl.TEXTURE_CUBE_MAP
                ) {
                    const target =
                        destinationTexture.target === gl.TEXTURE_CUBE_MAP
                            ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + originZ + layer
                            : destinationTexture.target;
                    gl.texSubImage2D(
                        target,
                        mip,
                        originX,
                        destinationY,
                        width,
                        1,
                        info.format,
                        info.type,
                        offset
                    );
                } else {
                    gl.texSubImage3D(
                        destinationTexture.target,
                        mip,
                        originX,
                        destinationY,
                        originZ + layer,
                        width,
                        1,
                        1,
                        info.format,
                        info.type,
                        offset
                    );
                }
            }
        }
        this.owner.state.setPixelStore(gl.UNPACK_ROW_LENGTH, 0);
    }

    private copyTextureToBufferNative(
        sourceTexture: WebGL2Texture,
        source: RHIImageCopyTexture,
        destinationBuffer: WebGL2Buffer,
        destination: RHIImageCopyBuffer,
        size: RHIExtent3D
    ): void {
        const gl = this.owner.gl;
        if (sourceTexture.nativeTexture === null)
            throw new RHIValidationError(
                'unsupported-feature',
                'cannot copy surface or multisample texture to a buffer',
                'source.texture'
            );
        const extent = normalizedExtent(size);
        const origin = {
            x: source.origin?.x ?? 0,
            y: source.origin?.y ?? 0,
            z: source.origin?.z ?? 0
        };
        const mipLevel = source.mipLevel ?? 0;
        const mipHeight = Math.max(1, Math.floor(sourceTexture.height / 2 ** mipLevel));
        const readY = mipHeight - origin.y - extent.height;
        const info = sourceTexture.formatInfo;
        const bytesPerRow = destination.bytesPerRow ?? extent.width * info.bytesPerTexel;
        const rowsPerImage = destination.rowsPerImage ?? extent.height;
        const framebuffer = this.queue.copyReadFramebuffer();
        this.owner.state.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
        this.owner.state.bindBuffer(gl.PIXEL_PACK_BUFFER, destinationBuffer.native);
        this.owner.state.setPixelStore(gl.PACK_ALIGNMENT, 1);
        this.owner.state.setPixelStore(gl.PACK_ROW_LENGTH, bytesPerRow / info.bytesPerTexel);
        for (let layer = 0; layer < extent.depthOrArrayLayers; layer += 1) {
            this.attachTextureLayer(
                gl.READ_FRAMEBUFFER,
                sourceTexture,
                mipLevel,
                origin.z + layer,
                source.aspect ?? 'all'
            );
            const offset = (destination.offset ?? 0) + layer * rowsPerImage * bytesPerRow;
            // readPixels emits bottom-to-top rows, while the portable RHI copy contract follows
            // WebGPU's top-to-bottom texture coordinates and buffer row order. Writing one row at
            // a time keeps the destination portable without a CPU staging allocation.
            for (let row = 0; row < extent.height; row += 1) {
                gl.readPixels(
                    origin.x,
                    readY + extent.height - 1 - row,
                    extent.width,
                    1,
                    info.format,
                    info.type,
                    offset + row * bytesPerRow
                );
            }
        }
        this.owner.state.setPixelStore(gl.PACK_ROW_LENGTH, 0);
        this.owner.state.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        this.owner.state.reset();
    }

    private copyTextureToTextureNative(
        sourceTexture: WebGL2Texture,
        source: RHIImageCopyTexture,
        destinationTexture: WebGL2Texture,
        destination: RHIImageCopyTexture,
        size: RHIExtent3D
    ): void {
        const gl = this.owner.gl;
        if (sourceTexture.nativeTexture === null || destinationTexture.nativeTexture === null)
            throw new RHIValidationError(
                'unsupported-feature',
                'surface and multisample copies need explicit resolve support',
                'copy'
            );
        const extent = normalizedExtent(size);
        const sourceOrigin = {
            x: source.origin?.x ?? 0,
            y: source.origin?.y ?? 0,
            z: source.origin?.z ?? 0
        };
        const destinationOrigin = {
            x: destination.origin?.x ?? 0,
            y: destination.origin?.y ?? 0,
            z: destination.origin?.z ?? 0
        };
        const sourceMipLevel = source.mipLevel ?? 0;
        const destinationMipLevel = destination.mipLevel ?? 0;
        const sourceMipHeight = Math.max(1, Math.floor(sourceTexture.height / 2 ** sourceMipLevel));
        const destinationMipHeight = Math.max(
            1,
            Math.floor(destinationTexture.height / 2 ** destinationMipLevel)
        );
        const sourceY = sourceMipHeight - sourceOrigin.y - extent.height;
        const destinationY = destinationMipHeight - destinationOrigin.y - extent.height;
        const read = this.queue.copyReadFramebuffer();
        const draw = this.queue.copyDrawFramebuffer();
        this.owner.state.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
        this.owner.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
        const aspect = source.aspect ?? 'all';
        const mask =
            aspect === 'stencil-only'
                ? gl.STENCIL_BUFFER_BIT
                : aspect === 'depth-only'
                  ? gl.DEPTH_BUFFER_BIT
                  : sourceTexture.formatInfo.category === 'depth-stencil'
                    ? gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT
                    : gl.COLOR_BUFFER_BIT;
        for (let layer = 0; layer < extent.depthOrArrayLayers; layer += 1) {
            this.attachTextureLayer(
                gl.READ_FRAMEBUFFER,
                sourceTexture,
                sourceMipLevel,
                sourceOrigin.z + layer,
                aspect
            );
            this.attachTextureLayer(
                gl.DRAW_FRAMEBUFFER,
                destinationTexture,
                destinationMipLevel,
                destinationOrigin.z + layer,
                destination.aspect ?? 'all'
            );
            gl.blitFramebuffer(
                sourceOrigin.x,
                sourceY,
                sourceOrigin.x + extent.width,
                sourceY + extent.height,
                destinationOrigin.x,
                destinationY,
                destinationOrigin.x + extent.width,
                destinationY + extent.height,
                mask,
                gl.NEAREST
            );
        }
        this.owner.state.reset();
    }

    private attachTextureLayer(
        target: GLenum,
        texture: WebGL2Texture,
        mipLevel: number,
        layer: number,
        aspect: RHITextureAspect
    ): void {
        const gl = this.owner.gl;
        const viewLike = { aspect, format: texture.format } as const;
        const attachment = attachmentPoint(gl, viewLike as WebGL2TextureView);
        if (texture.target === gl.TEXTURE_2D)
            gl.framebufferTexture2D(
                target,
                attachment,
                gl.TEXTURE_2D,
                texture.nativeTexture,
                mipLevel
            );
        else if (texture.target === gl.TEXTURE_CUBE_MAP)
            gl.framebufferTexture2D(
                target,
                attachment,
                gl.TEXTURE_CUBE_MAP_POSITIVE_X + layer,
                texture.nativeTexture,
                mipLevel
            );
        else gl.framebufferTextureLayer(target, attachment, texture.nativeTexture, mipLevel, layer);
    }
}

export class WebGL2RenderPass
    extends WebGL2ObjectBase
    implements RHIRenderPassEncoder, WebGL2DestroyObserver
{
    readonly contextId: number;
    readonly #storage: WebGL2RenderPassStorage;
    readonly #descriptor: Readonly<RHIRenderPassDescriptor>;
    #state: RHIRenderPassState = 'open';
    #framebuffer: WebGLFramebuffer | null = null;
    #pipeline: WebGL2GraphicsPipeline | null = null;
    readonly #groups: WebGL2BoundGroup[];
    readonly #vertexBuffers: WebGL2VertexBufferBinding[];
    readonly #drawBuffers: GLenum[];
    readonly #indexBuffer: WebGL2IndexBufferBinding;
    readonly #singleColorDrawBuffer: GLenum[];
    #stencilReference = 0;
    #surfacePass = false;
    #presentationPass = false;
    #drawBufferMask = -1;
    #drawBatchPending = false;
    #viewportStateChanged = false;
    #scissorStateChanged = false;
    #observedResourcesValid = true;
    #observingResources = true;

    constructor(
        owner: WebGL2RHIDevice,
        readonly context: WebGL2CommandContext,
        storage: WebGL2RenderPassStorage
    ) {
        super(owner, storage.snapshot.descriptor.label ?? 'WebGL2 render pass');
        this.contextId = context.id;
        this.#storage = storage;
        this.#descriptor = storage.snapshot.descriptor;
        this.#groups = storage.groups;
        this.#vertexBuffers = storage.vertexBuffers;
        this.#drawBuffers = storage.drawBuffers;
        this.#indexBuffer = storage.indexBuffer;
        this.#singleColorDrawBuffer = storage.singleColorDrawBuffer;
        this.subscribeAttachmentResources();
    }

    get state(): RHIRenderPassState {
        return this.#state;
    }

    beginNative(): void {
        const gl = this.owner.gl;
        const colors = this.#descriptor.colorAttachments;
        let firstColor: (typeof colors)[number] | undefined;
        let scanIndex = 0;
        while (scanIndex < colors.length) {
            const attachment = colors[scanIndex];
            scanIndex++;
            if (attachment !== null && attachment !== undefined) {
                firstColor = attachment;
                break;
            }
        }
        const firstColorView =
            firstColor === undefined || firstColor === null
                ? null
                : this.owner.requireTextureView(firstColor.view);
        const surface =
            firstColorView !== null &&
            firstColorView.texture.isSurfaceTexture &&
            !firstColorView.texture.isSurfaceDepthStencilTexture;
        const resolveTargetView =
            firstColor?.resolveTarget === undefined
                ? null
                : this.owner.requireTextureView(firstColor.resolveTarget);
        const resolvesToSurface =
            resolveTargetView !== null &&
            resolveTargetView.texture.isSurfaceTexture &&
            !resolveTargetView.texture.isSurfaceDepthStencilTexture;
        this.#presentationPass = surface || resolvesToSurface;
        if (surface) {
            const depthStencil = this.#descriptor.depthStencilAttachment;
            const depthStencilView =
                depthStencil === undefined
                    ? null
                    : this.owner.requireTextureView(depthStencil.view);
            let colorAttachmentCount = 0;
            scanIndex = 0;
            while (scanIndex < colors.length) {
                if (colors[scanIndex] !== null) colorAttachmentCount++;
                scanIndex++;
            }
            if (colorAttachmentCount !== 1) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'WebGL2 default framebuffer supports exactly one surface color attachment',
                    'renderPass'
                );
            }
            if (
                depthStencilView !== null &&
                !depthStencilView.texture.isSurfaceDepthStencilTexture
            ) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'WebGL2 surface passes require the presentation-owned depth/stencil attachment',
                    'renderPass.depthStencilAttachment'
                );
            }
            this.#surfacePass = true;
            this.owner.framebufferCache.bindSurface(firstColorView);
        } else {
            const framebuffer = this.owner.framebufferCache.bindOffscreen(this.#descriptor);
            this.#framebuffer = framebuffer;
        }
        const depthStencil = this.#descriptor.depthStencilAttachment;
        const externalViewport = this.#presentationPass
            ? this.owner.nativePresentation.viewport
            : null;
        if (
            this.#presentationPass &&
            this.owner.nativePresentation.externalActive &&
            externalViewport === null
        ) {
            throw new RHIValidationError(
                'invalid-state',
                'external presentation requires a selected eye viewport',
                'renderPass'
            );
        }
        if (externalViewport === null) {
            this.owner.state.setCapability(gl.SCISSOR_TEST, false);
        } else {
            this.owner.state.setScissor(
                externalViewport.x,
                externalViewport.y,
                externalViewport.width,
                externalViewport.height
            );
        }
        this.owner.state.setColorMask(0xf);
        this.owner.state.setDepth(false, gl.ALWAYS, true);
        this.owner.state.setDepthRange(0, 1);
        this.owner.state.setStencilWriteMask(0xffffffff);
        for (let index = 0; index < colors.length; index += 1) {
            const attachment = colors[index];
            if (attachment?.loadOp === 'clear' && attachment.clearValue) {
                const color = attachment.clearValue;
                CLEAR_COLOR_SCRATCH[0] = color.r;
                CLEAR_COLOR_SCRATCH[1] = color.g;
                CLEAR_COLOR_SCRATCH[2] = color.b;
                CLEAR_COLOR_SCRATCH[3] = color.a;
                gl.clearBufferfv(gl.COLOR, index, CLEAR_COLOR_SCRATCH);
            }
        }
        if (depthStencil?.depthLoadOp === 'clear') {
            CLEAR_DEPTH_SCRATCH[0] = depthStencil.depthClearValue ?? 1;
            gl.clearBufferfv(gl.DEPTH, 0, CLEAR_DEPTH_SCRATCH);
        }
        if (depthStencil?.stencilLoadOp === 'clear') {
            CLEAR_STENCIL_SCRATCH[0] = depthStencil.stencilClearValue ?? 0;
            gl.clearBufferiv(gl.STENCIL, 0, CLEAR_STENCIL_SCRATCH);
        }
        const extentTexture = firstColor?.view.texture ?? depthStencil?.view.texture;
        if (extentTexture !== undefined) {
            const mipLevel =
                firstColor?.view.descriptor.baseMipLevel ??
                depthStencil?.view.descriptor.baseMipLevel ??
                0;
            const viewport = this.#storage.attachmentViewport;
            viewport.width = Math.max(1, Math.floor(extentTexture.width / 2 ** mipLevel));
            viewport.height = Math.max(1, Math.floor(extentTexture.height / 2 ** mipLevel));
            this.owner.state.setViewportRecord(viewport);
        }
        this.context.diagnostics.commandCount++;
    }

    setPipeline(pipeline: RHIGraphicsPipeline): void {
        this.requireOpen();
        const concrete = this.owner.requirePipeline(pipeline);
        if (this.#pipeline === concrete) {
            this.context.diagnostics.commandCount++;
            return;
        }
        this.validatePipelineCompatibility(concrete);
        this.context.diagnostics.pipelineSwitches++;
        this.#pipeline = concrete;
        try {
            this.flushPendingDrawBatch();
            concrete.applyState(this.#stencilReference);
            this.applyPipelineDrawBuffers(concrete);
            this.context.nativeSucceeded('renderPass.setPipeline');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.context.diagnostics.commandCount++;
    }

    setBindGroup(
        index: number,
        bindGroup: RHIBindGroup,
        dynamicOffsets: RHIUInt32View = EMPTY_DYNAMIC_OFFSETS
    ): void {
        this.requireOpen();
        const concrete = this.owner.requireBindGroup(bindGroup);
        if (!concrete.preparedResourcesValid) concrete.assertPreparedResourcesUsable();
        if (!isSafeIntegerPrimitive(index) || index < 0 || index >= this.#groups.length)
            throw new RHIValidationError(
                'out-of-bounds',
                'bind group index is out of range',
                'renderPass.bindGroup'
            );
        const expected = this.#pipeline?.descriptor.layout.bindGroupLayouts[index];
        if (expected !== undefined && expected !== concrete.layout)
            throw new RHIValidationError(
                'incompatible-layout',
                'bind group layout does not match pipeline',
                'renderPass.bindGroup'
            );
        let dynamicOffsetCount = 0;
        if (dynamicOffsets !== EMPTY_DYNAMIC_OFFSETS || concrete.dynamicOffsetCount !== 0) {
            dynamicOffsetCount = dynamicOffsets.length;
        }
        if (dynamicOffsetCount !== concrete.dynamicOffsetCount)
            throw new RHIValidationError(
                'incompatible-layout',
                'dynamic offset count does not match layout',
                'renderPass.dynamicOffsets'
            );
        const bound = this.#groups[index];
        if (bound === undefined) throw new Error('bind group storage is unavailable');
        for (let offsetIndex = 0; offsetIndex < dynamicOffsetCount; offsetIndex += 1) {
            const value = dynamicOffsets[offsetIndex] ?? 0;
            const alignment = this.owner.capabilities.limits.minUniformBufferOffsetAlignment;
            if (value % alignment !== 0)
                throw new RHIValidationError(
                    'invalid-descriptor',
                    'dynamic offset is not aligned',
                    'renderPass.dynamicOffsets'
                );
            const resource = concrete.dynamicBuffer(offsetIndex);
            const baseOffset = resource.offset;
            const bindingSize = resource.size;
            if (
                baseOffset + value > MAX_SAFE_INTEGER ||
                baseOffset + value + bindingSize > resource.buffer.size
            ) {
                throw new RHIValidationError(
                    'out-of-bounds',
                    'dynamic binding range exceeds its buffer',
                    'renderPass.dynamicOffsets'
                );
            }
            bound.dynamicOffsets[offsetIndex] = value;
        }
        if (bound.group !== concrete) this.context.diagnostics.bindGroupSwitches++;
        bound.group = concrete;
        bound.dynamicOffsetCount = dynamicOffsetCount;
        this.context.diagnostics.commandCount++;
    }

    setVertexBuffer(
        slot: number,
        buffer: RHIBuffer,
        offset = 0,
        size = buffer.size - offset
    ): void {
        this.requireOpen();
        let concrete = buffer as WebGL2Buffer;
        if (
            this.owner.destroyed ||
            !hasWebGL2ObjectKind(buffer, WEBGL2_BUFFER_OBJECT_KIND) ||
            concrete.owner !== this.owner ||
            concrete.deviceId !== this.owner.id ||
            concrete.deviceGeneration !== this.owner.generationValue ||
            concrete.destroyed
        ) {
            concrete = this.owner.requireBuffer(buffer);
        }
        if ((concrete.usage & RHIBufferUsage.VERTEX) === 0)
            throw new RHIValidationError(
                'invalid-descriptor',
                'buffer lacks VERTEX usage',
                'renderPass.vertexBuffer'
            );
        if (!isSafeIntegerPrimitive(slot) || slot < 0 || slot >= this.#vertexBuffers.length)
            throw new RHIValidationError(
                'out-of-bounds',
                'vertex slot is out of range',
                'renderPass.vertexBuffer'
            );
        if (offset < 0 || size <= 0 || offset + size > concrete.size)
            throw new RHIValidationError(
                'out-of-bounds',
                'vertex buffer range exceeds buffer',
                'renderPass.vertexBuffer'
            );
        const previous = this.#vertexBuffers[slot];
        if (previous === undefined) throw new Error('vertex buffer storage is unavailable');
        if (previous.buffer !== concrete || previous.offset !== offset || previous.size !== size)
            this.context.diagnostics.vertexBufferSwitches++;
        previous.buffer = concrete;
        previous.offset = offset;
        previous.size = size;
        this.context.diagnostics.commandCount++;
    }

    setVertexBufferRecord(record: Readonly<RHIVertexBufferBindingRecord>): void {
        const slot = record.slot;
        const buffer = record.buffer;
        const offset = record.offset;
        const size = record.size ?? buffer.size - offset;
        this.requireOpen();
        let concrete = buffer as WebGL2Buffer;
        if (
            this.owner.destroyed ||
            !hasWebGL2ObjectKind(buffer, WEBGL2_BUFFER_OBJECT_KIND) ||
            concrete.owner !== this.owner ||
            concrete.deviceId !== this.owner.id ||
            concrete.deviceGeneration !== this.owner.generationValue ||
            concrete.destroyed
        ) {
            concrete = this.owner.requireBuffer(buffer);
        }
        if ((concrete.usage & RHIBufferUsage.VERTEX) === 0)
            throw new RHIValidationError(
                'invalid-descriptor',
                'buffer lacks VERTEX usage',
                'renderPass.vertexBuffer'
            );
        if (!isSafeIntegerPrimitive(slot) || slot < 0 || slot >= this.#vertexBuffers.length)
            throw new RHIValidationError(
                'out-of-bounds',
                'vertex slot is out of range',
                'renderPass.vertexBuffer'
            );
        if (offset < 0 || size <= 0 || offset + size > concrete.size)
            throw new RHIValidationError(
                'out-of-bounds',
                'vertex buffer range exceeds buffer',
                'renderPass.vertexBuffer'
            );
        const previous = this.#vertexBuffers[slot];
        if (previous === undefined) throw new Error('vertex buffer storage is unavailable');
        if (previous.buffer !== concrete || previous.offset !== offset || previous.size !== size)
            this.context.diagnostics.vertexBufferSwitches++;
        previous.buffer = concrete;
        previous.offset = offset;
        previous.size = size;
        this.context.diagnostics.commandCount++;
    }

    setIndexBuffer(
        buffer: RHIBuffer,
        format: RHIIndexFormat,
        offset = 0,
        size = buffer.size - offset
    ): void {
        this.requireOpen();
        let concrete = buffer as WebGL2Buffer;
        if (
            this.owner.destroyed ||
            !hasWebGL2ObjectKind(buffer, WEBGL2_BUFFER_OBJECT_KIND) ||
            concrete.owner !== this.owner ||
            concrete.deviceId !== this.owner.id ||
            concrete.deviceGeneration !== this.owner.generationValue ||
            concrete.destroyed
        ) {
            concrete = this.owner.requireBuffer(buffer);
        }
        if ((concrete.usage & RHIBufferUsage.INDEX) === 0)
            throw new RHIValidationError(
                'invalid-descriptor',
                'buffer lacks INDEX usage',
                'renderPass.indexBuffer'
            );
        const alignment = format === 'uint16' ? 2 : 4;
        if (offset % alignment !== 0 || size <= 0 || offset + size > concrete.size)
            throw new RHIValidationError(
                'out-of-bounds',
                'index buffer range is invalid',
                'renderPass.indexBuffer'
            );
        const current = this.#indexBuffer;
        if (
            current.buffer !== concrete ||
            current.format !== format ||
            current.offset !== offset ||
            current.size !== size
        ) {
            current.buffer = concrete;
            current.format = format;
            current.offset = offset;
            current.size = size;
        }
        this.context.diagnostics.commandCount++;
    }

    setIndexBufferRecord(record: Readonly<RHIIndexBufferBindingRecord>): void {
        const buffer = record.buffer;
        const format = record.format;
        const offset = record.offset;
        const size = record.size ?? buffer.size - offset;
        this.requireOpen();
        let concrete = buffer as WebGL2Buffer;
        if (
            this.owner.destroyed ||
            !hasWebGL2ObjectKind(buffer, WEBGL2_BUFFER_OBJECT_KIND) ||
            concrete.owner !== this.owner ||
            concrete.deviceId !== this.owner.id ||
            concrete.deviceGeneration !== this.owner.generationValue ||
            concrete.destroyed
        ) {
            concrete = this.owner.requireBuffer(buffer);
        }
        if ((concrete.usage & RHIBufferUsage.INDEX) === 0)
            throw new RHIValidationError(
                'invalid-descriptor',
                'buffer lacks INDEX usage',
                'renderPass.indexBuffer'
            );
        const alignment = format === 'uint16' ? 2 : 4;
        if (offset % alignment !== 0 || size <= 0 || offset + size > concrete.size)
            throw new RHIValidationError(
                'out-of-bounds',
                'index buffer range is invalid',
                'renderPass.indexBuffer'
            );
        const current = this.#indexBuffer;
        if (
            current.buffer !== concrete ||
            current.format !== format ||
            current.offset !== offset ||
            current.size !== size
        ) {
            current.buffer = concrete;
            current.format = format;
            current.offset = offset;
            current.size = size;
        }
        this.context.diagnostics.commandCount++;
    }

    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number
    ): void {
        this.requireOpen();
        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            !Number.isFinite(minDepth) ||
            !Number.isFinite(maxDepth) ||
            width < 0 ||
            height < 0 ||
            minDepth < 0 ||
            maxDepth > 1 ||
            minDepth > maxDepth
        ) {
            throw new RHIValidationError(
                'invalid-descriptor',
                'viewport has an invalid finite range',
                'renderPass.viewport'
            );
        }
        const initialViewport = this.#storage.attachmentViewport;
        if (
            !this.#viewportStateChanged &&
            x === initialViewport.x &&
            y === initialViewport.y &&
            width === initialViewport.width &&
            height === initialViewport.height &&
            minDepth === 0 &&
            maxDepth === 1
        ) {
            this.context.diagnostics.commandCount++;
            return;
        }
        this.#viewportStateChanged = true;
        try {
            this.flushPendingDrawBatch();
            this.owner.state.setViewport(x, y, width, height);
            this.owner.state.setDepthRange(minDepth, maxDepth);
            this.context.nativeSucceeded('renderPass.setViewport');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.context.diagnostics.commandCount++;
    }

    setViewportRecord(viewport: Readonly<RHIViewport>): void {
        this.requireOpen();
        if (
            !Number.isFinite(viewport.x) ||
            !Number.isFinite(viewport.y) ||
            !Number.isFinite(viewport.width) ||
            !Number.isFinite(viewport.height) ||
            !Number.isFinite(viewport.minDepth) ||
            !Number.isFinite(viewport.maxDepth) ||
            viewport.width < 0 ||
            viewport.height < 0 ||
            viewport.minDepth < 0 ||
            viewport.maxDepth > 1 ||
            viewport.minDepth > viewport.maxDepth
        ) {
            throw new RHIValidationError(
                'invalid-descriptor',
                'viewport has an invalid finite range',
                'renderPass.viewport'
            );
        }
        const initialViewport = this.#storage.attachmentViewport;
        if (
            !this.#viewportStateChanged &&
            viewport.x === initialViewport.x &&
            viewport.y === initialViewport.y &&
            viewport.width === initialViewport.width &&
            viewport.height === initialViewport.height &&
            viewport.minDepth === 0 &&
            viewport.maxDepth === 1
        ) {
            this.context.diagnostics.commandCount++;
            return;
        }
        this.#viewportStateChanged = true;
        try {
            this.flushPendingDrawBatch();
            this.owner.state.setViewportRecord(viewport);
            this.context.nativeSucceeded('renderPass.setViewport');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.context.diagnostics.commandCount++;
    }

    setScissorRect(x: number, y: number, width: number, height: number): void {
        this.requireOpen();
        if (
            !isSafeIntegerPrimitive(x) ||
            !isSafeIntegerPrimitive(y) ||
            !isSafeIntegerPrimitive(width) ||
            !isSafeIntegerPrimitive(height) ||
            x < 0 ||
            y < 0 ||
            width < 0 ||
            height < 0
        ) {
            throw new RHIValidationError(
                'invalid-descriptor',
                'scissor rectangle must contain non-negative safe integers',
                'renderPass.scissor'
            );
        }
        const externalViewport = this.#presentationPass
            ? this.owner.nativePresentation.viewport
            : null;
        const initialScissor = externalViewport ?? this.#storage.attachmentViewport;
        if (
            !this.#scissorStateChanged &&
            x === initialScissor.x &&
            y === initialScissor.y &&
            width === initialScissor.width &&
            height === initialScissor.height
        ) {
            this.context.diagnostics.commandCount++;
            return;
        }
        this.#scissorStateChanged = true;
        try {
            this.flushPendingDrawBatch();
            this.owner.state.setScissor(x, y, width, height);
            this.context.nativeSucceeded('renderPass.setScissorRect');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.context.diagnostics.commandCount++;
    }

    setScissorRectRecord(rect: Readonly<RHIRect>): void {
        this.requireOpen();
        if (
            !isSafeIntegerPrimitive(rect.x) ||
            !isSafeIntegerPrimitive(rect.y) ||
            !isSafeIntegerPrimitive(rect.width) ||
            !isSafeIntegerPrimitive(rect.height) ||
            rect.x < 0 ||
            rect.y < 0 ||
            rect.width < 0 ||
            rect.height < 0
        ) {
            throw new RHIValidationError(
                'invalid-descriptor',
                'scissor rectangle must contain non-negative safe integers',
                'renderPass.scissor'
            );
        }
        const externalViewport = this.#presentationPass
            ? this.owner.nativePresentation.viewport
            : null;
        const initialScissor = externalViewport ?? this.#storage.attachmentViewport;
        if (
            !this.#scissorStateChanged &&
            rect.x === initialScissor.x &&
            rect.y === initialScissor.y &&
            rect.width === initialScissor.width &&
            rect.height === initialScissor.height
        ) {
            this.context.diagnostics.commandCount++;
            return;
        }
        this.#scissorStateChanged = true;
        try {
            this.flushPendingDrawBatch();
            this.owner.state.setScissorRectRecord(rect);
            this.context.nativeSucceeded('renderPass.setScissorRect');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.context.diagnostics.commandCount++;
    }

    setBlendConstant(color: RHIColor): void {
        this.requireOpen();
        if (
            !Number.isFinite(color.r) ||
            !Number.isFinite(color.g) ||
            !Number.isFinite(color.b) ||
            !Number.isFinite(color.a)
        ) {
            throw new RHIValidationError(
                'invalid-descriptor',
                'blend constant components must be finite',
                'renderPass.blendConstant'
            );
        }
        try {
            this.flushPendingDrawBatch();
            this.owner.state.setBlendColor(color.r, color.g, color.b, color.a);
            this.context.nativeSucceeded('renderPass.setBlendConstant');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.context.diagnostics.commandCount++;
    }

    setStencilReference(reference: number): void {
        this.requireOpen();
        if (!isSafeIntegerPrimitive(reference) || reference < 0 || reference > 0xffffffff) {
            throw new RHIValidationError(
                'out-of-bounds',
                'stencil reference must be an unsigned 32-bit integer',
                'renderPass.stencilReference'
            );
        }
        this.#stencilReference = reference;
        try {
            this.flushPendingDrawBatch();
            this.#pipeline?.applyState(reference);
            this.context.nativeSucceeded('renderPass.setStencilReference');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.context.diagnostics.commandCount++;
    }

    draw(vertexCount: number, instanceCount = 1, firstVertex = 0, firstInstance = 0): void {
        this.requireOpen();
        this.validateDrawArguments(vertexCount, instanceCount, firstVertex, firstInstance, 'draw');
        if (firstInstance !== 0)
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support firstInstance',
                'renderPass.draw.firstInstance'
            );
        try {
            const pipeline = this.prepareDraw(false);
            if (instanceCount === 1)
                this.owner.gl.drawArrays(pipeline.topology, firstVertex, vertexCount);
            else
                this.owner.gl.drawArraysInstanced(
                    pipeline.topology,
                    firstVertex,
                    vertexCount,
                    instanceCount
                );
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.recordDraw();
    }

    drawRecord(record: Readonly<RHIDrawArgumentsRecord>): void {
        const vertexCount = record.elementCount;
        const instanceCount = record.instanceCount;
        const firstVertex = record.firstElement;
        const firstInstance = record.firstInstance;
        this.requireOpen();
        this.validateDrawArguments(vertexCount, instanceCount, firstVertex, firstInstance, 'draw');
        if (firstInstance !== 0)
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support firstInstance',
                'renderPass.draw.firstInstance'
            );
        try {
            const pipeline = this.prepareDraw(false);
            if (instanceCount === 1)
                this.owner.gl.drawArrays(pipeline.topology, firstVertex, vertexCount);
            else
                this.owner.gl.drawArraysInstanced(
                    pipeline.topology,
                    firstVertex,
                    vertexCount,
                    instanceCount
                );
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.recordDraw();
    }

    drawIndexed(
        indexCount: number,
        instanceCount = 1,
        firstIndex = 0,
        baseVertex = 0,
        firstInstance = 0
    ): void {
        this.requireOpen();
        this.validateDrawArguments(
            indexCount,
            instanceCount,
            firstIndex,
            firstInstance,
            'drawIndexed'
        );
        if (!isSafeIntegerPrimitive(baseVertex))
            throw new RHIValidationError(
                'invalid-descriptor',
                'baseVertex must be a safe integer',
                'renderPass.drawIndexed.baseVertex'
            );
        if (baseVertex !== 0)
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support baseVertex',
                'renderPass.drawIndexed.baseVertex'
            );
        if (firstInstance !== 0)
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support firstInstance',
                'renderPass.drawIndexed.firstInstance'
            );
        const index = this.#indexBuffer;
        if (index.buffer === null)
            throw new RHIValidationError('invalid-state', 'index buffer is not set', 'renderPass');
        const byteSize = index.format === 'uint16' ? 2 : 4;
        if (firstIndex > index.size / byteSize || indexCount > index.size / byteSize - firstIndex) {
            throw new RHIValidationError(
                'out-of-bounds',
                'indexed draw exceeds the bound index buffer range',
                'renderPass.drawIndexed'
            );
        }
        const type =
            index.format === 'uint16' ? this.owner.gl.UNSIGNED_SHORT : this.owner.gl.UNSIGNED_INT;
        const offset = index.offset + firstIndex * byteSize;
        try {
            const pipeline = this.prepareDraw(true);
            const gl = this.owner.gl;
            if (instanceCount === 1) gl.drawElements(pipeline.topology, indexCount, type, offset);
            else
                gl.drawElementsInstanced(
                    pipeline.topology,
                    indexCount,
                    type,
                    offset,
                    instanceCount
                );
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.recordDraw();
    }

    drawIndexedRecord(record: Readonly<RHIDrawArgumentsRecord>): void {
        const indexCount = record.elementCount;
        const instanceCount = record.instanceCount;
        const firstIndex = record.firstElement;
        const baseVertex = record.baseVertex;
        const firstInstance = record.firstInstance;
        this.requireOpen();
        this.validateDrawArguments(
            indexCount,
            instanceCount,
            firstIndex,
            firstInstance,
            'drawIndexed'
        );
        if (!isSafeIntegerPrimitive(baseVertex))
            throw new RHIValidationError(
                'invalid-descriptor',
                'baseVertex must be a safe integer',
                'renderPass.drawIndexed.baseVertex'
            );
        if (baseVertex !== 0)
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support baseVertex',
                'renderPass.drawIndexed.baseVertex'
            );
        if (firstInstance !== 0)
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support firstInstance',
                'renderPass.drawIndexed.firstInstance'
            );
        const index = this.#indexBuffer;
        if (index.buffer === null)
            throw new RHIValidationError('invalid-state', 'index buffer is not set', 'renderPass');
        const byteSize = index.format === 'uint16' ? 2 : 4;
        if (firstIndex > index.size / byteSize || indexCount > index.size / byteSize - firstIndex) {
            throw new RHIValidationError(
                'out-of-bounds',
                'indexed draw exceeds the bound index buffer range',
                'renderPass.drawIndexed'
            );
        }
        const type =
            index.format === 'uint16' ? this.owner.gl.UNSIGNED_SHORT : this.owner.gl.UNSIGNED_INT;
        const offset = index.offset + firstIndex * byteSize;
        try {
            const pipeline = this.prepareDraw(true);
            const gl = this.owner.gl;
            if (instanceCount === 1) gl.drawElements(pipeline.topology, indexCount, type, offset);
            else
                gl.drawElementsInstanced(
                    pipeline.topology,
                    indexCount,
                    type,
                    offset,
                    instanceCount
                );
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.recordDraw();
    }

    end(): void {
        this.requireOpen();
        try {
            this.flushPendingDrawBatch();
            this.assertAttachmentResourcesUsable();
            this.endNative();
            this.context.nativeSucceeded('renderPass.end');
        } catch (error) {
            this.context.nativeFailed(error);
        }
        this.#state = 'ended';
        this.#pipeline = null;
        this.unsubscribeObservedResources();
        this.context.finishPass(this, this.#storage);
        this.context.diagnostics.commandCount++;
    }

    abort(): void {
        if (this.#state !== 'open') return;
        this.#state = 'aborted';
        this.#framebuffer = null;
        this.#pipeline = null;
        this.#drawBatchPending = false;
        this.unsubscribeObservedResources();
        this.owner.discardNativeErrors();
        this.owner.state.reset();
        this.context.abortPass(this, this.#storage);
    }

    private prepareDraw(indexed: boolean): WebGL2GraphicsPipeline {
        this.assertAttachmentResourcesUsable();
        this.assertBoundBuffersUsable();
        const pipeline = this.#pipeline;
        if (pipeline === null)
            throw new RHIValidationError('invalid-state', 'pipeline is not set', 'renderPass');
        if (
            this.owner.destroyed ||
            pipeline.destroyed ||
            pipeline.deviceGeneration !== this.owner.generationValue
        ) {
            pipeline.assertPreparedUsable();
        }
        for (
            let index = 0;
            index < pipeline.descriptor.layout.bindGroupLayouts.length;
            index += 1
        ) {
            if (!pipeline.requiresBindGroup(index)) continue;
            const bound = this.#groups[index];
            if (bound?.group === undefined || bound.group === null)
                throw new RHIValidationError(
                    'invalid-state',
                    `bind group ${String(index)} is not set`,
                    'renderPass'
                );
            if (bound.group.layout !== pipeline.descriptor.layout.bindGroupLayouts[index])
                throw new RHIValidationError(
                    'incompatible-layout',
                    'bound group layout does not match pipeline',
                    'renderPass'
                );
            if (
                this.owner.destroyed ||
                bound.group.destroyed ||
                bound.group.deviceGeneration !== this.owner.generationValue ||
                !bound.group.preparedResourcesValid
            ) {
                bound.group.assertPreparedResourcesUsable();
            }
        }
        pipeline.bindGroups(this.#groups);
        pipeline.bindVertexArray(this.#vertexBuffers, indexed ? this.#indexBuffer : null);
        return pipeline;
    }

    onWebGL2ObjectInvalidated(_object: WebGL2DestroyableBase): void {
        this.#observedResourcesValid = false;
    }

    private assertAttachmentResourcesUsable(): void {
        if (this.#observedResourcesValid) return;
        const colors = this.#descriptor.colorAttachments;
        let attachmentIndex = 0;
        while (attachmentIndex < colors.length) {
            const attachment = colors[attachmentIndex];
            if (attachment !== null && attachment !== undefined) {
                const view = attachment.view as WebGL2TextureView;
                const path = `renderPass.colorAttachments[${String(attachmentIndex)}].view`;
                assertObservedObjectUsable(this.owner, view, path);
                assertObservedObjectUsable(this.owner, view.texture, `${path}.texture`);
                if (attachment.resolveTarget !== undefined) {
                    const resolveTarget = attachment.resolveTarget as WebGL2TextureView;
                    const resolvePath = `renderPass.colorAttachments[${String(attachmentIndex)}].resolveTarget`;
                    assertObservedObjectUsable(this.owner, resolveTarget, resolvePath);
                    assertObservedObjectUsable(
                        this.owner,
                        resolveTarget.texture,
                        `${resolvePath}.texture`
                    );
                }
            }
            attachmentIndex++;
        }
        const depthStencil = this.#descriptor.depthStencilAttachment;
        if (depthStencil !== undefined) {
            const view = depthStencil.view as WebGL2TextureView;
            const path = 'renderPass.depthStencilAttachment.view';
            assertObservedObjectUsable(this.owner, view, path);
            assertObservedObjectUsable(this.owner, view.texture, `${path}.texture`);
        }
        this.#observedResourcesValid = true;
    }

    private assertBoundBuffersUsable(): void {
        let slot = 0;
        while (slot < this.#vertexBuffers.length) {
            const buffer = this.#vertexBuffers[slot]?.buffer;
            if (buffer?.destroyed === true) {
                assertObservedObjectUsable(
                    this.owner,
                    buffer,
                    `renderPass.vertexBuffers[${String(slot)}]`
                );
            }
            slot++;
        }
        const indexBuffer = this.#indexBuffer.buffer;
        if (indexBuffer?.destroyed === true) {
            assertObservedObjectUsable(this.owner, indexBuffer, 'renderPass.indexBuffer');
        }
    }

    private subscribeAttachmentResources(): void {
        const colors = this.#descriptor.colorAttachments;
        let index = 0;
        while (index < colors.length) {
            const attachment = colors[index++];
            if (attachment === null || attachment === undefined) continue;
            this.subscribeTextureView(attachment.view as WebGL2TextureView);
            if (attachment.resolveTarget !== undefined) {
                this.subscribeTextureView(attachment.resolveTarget as WebGL2TextureView);
            }
        }
        const depthStencil = this.#descriptor.depthStencilAttachment;
        if (depthStencil !== undefined) {
            this.subscribeTextureView(depthStencil.view as WebGL2TextureView);
        }
    }

    private subscribeTextureView(view: WebGL2TextureView): void {
        view.addDestroyObserver(this);
        view.texture.addDestroyObserver(this);
    }

    private unsubscribeTextureView(view: WebGL2TextureView): void {
        view.removeDestroyObserver(this);
        view.texture.removeDestroyObserver(this);
    }

    private unsubscribeObservedResources(): void {
        if (!this.#observingResources) return;
        this.#observingResources = false;
        const colors = this.#descriptor.colorAttachments;
        let index = 0;
        while (index < colors.length) {
            const attachment = colors[index++];
            if (attachment === null || attachment === undefined) continue;
            this.unsubscribeTextureView(attachment.view as WebGL2TextureView);
            if (attachment.resolveTarget !== undefined) {
                this.unsubscribeTextureView(attachment.resolveTarget as WebGL2TextureView);
            }
        }
        const depthStencil = this.#descriptor.depthStencilAttachment;
        if (depthStencil !== undefined) {
            this.unsubscribeTextureView(depthStencil.view as WebGL2TextureView);
        }
    }

    private applyPipelineDrawBuffers(pipeline: WebGL2GraphicsPipeline): void {
        if (pipeline.colorOutputMask === this.#drawBufferMask) return;
        const gl = this.owner.gl;
        for (let index = 0; index < this.#drawBuffers.length; index += 1) {
            const attachment = this.#descriptor.colorAttachments[index];
            const enabled =
                attachment !== null &&
                attachment !== undefined &&
                (pipeline.colorOutputMask & (1 << index)) !== 0;
            this.#drawBuffers[index] = enabled
                ? this.#surfacePass
                    ? this.owner.nativePresentation.colorAttachment
                    : gl.COLOR_ATTACHMENT0 + index
                : gl.NONE;
        }
        if (this.#drawBuffers.length > 0) gl.drawBuffers(this.#drawBuffers);
        this.#drawBufferMask = pipeline.colorOutputMask;
    }

    private validatePipelineCompatibility(pipeline: WebGL2GraphicsPipeline): void {
        const passColors = this.#descriptor.colorAttachments;
        const fragment = pipeline.descriptor.fragment;
        const targetCount = fragment?.targets.length ?? 0;
        if (targetCount !== passColors.length)
            throw new RHIValidationError(
                'incompatible-layout',
                'pipeline color target count does not match pass',
                'renderPass.pipeline'
            );
        for (let index = 0; index < targetCount; index += 1) {
            const target = fragment?.targets[index];
            const attachment = passColors[index];
            if (
                (target === null) !== (attachment === null) ||
                (target && attachment && target.format !== attachment.view.format)
            )
                throw new RHIValidationError(
                    'incompatible-layout',
                    'pipeline color format does not match pass',
                    'renderPass.pipeline'
                );
        }
        const passDepth = this.#descriptor.depthStencilAttachment?.view.format;
        const pipelineDepth = pipeline.descriptor.depthStencil?.format;
        if (passDepth !== pipelineDepth)
            throw new RHIValidationError(
                'incompatible-layout',
                'pipeline depth format does not match pass',
                'renderPass.pipeline'
            );
        let attachment = this.#descriptor.depthStencilAttachment?.view.texture;
        let index = 0;
        while (index < passColors.length) {
            const color = passColors[index];
            index++;
            if (color !== null && color !== undefined) {
                attachment = color.view.texture;
                break;
            }
        }
        if (attachment && (pipeline.descriptor.multisample?.count ?? 1) !== attachment.sampleCount)
            throw new RHIValidationError(
                'incompatible-layout',
                'pipeline sample count does not match pass',
                'renderPass.pipeline'
            );
        validateRHIRenderPassPipelineDepthStencilAccess(this.#descriptor, pipeline.descriptor);
    }

    private endNative(): void {
        const gl = this.owner.gl;
        for (let index = 0; index < this.#descriptor.colorAttachments.length; index += 1) {
            const attachment = this.#descriptor.colorAttachments[index];
            if (attachment?.resolveTarget !== undefined) {
                const target = this.owner.requireTextureView(attachment.resolveTarget);
                const surfaceTarget = target.texture.isSurfaceTexture;
                const externalSurface =
                    surfaceTarget && this.owner.nativePresentation.externalActive;
                const surfaceNeedsIntermediate =
                    surfaceTarget && !externalSurface && gl.getContextAttributes()?.alpha === false;
                const width = Math.max(
                    1,
                    Math.floor(target.texture.width / 2 ** target.descriptor.baseMipLevel)
                );
                const height = Math.max(
                    1,
                    Math.floor(target.texture.height / 2 ** target.descriptor.baseMipLevel)
                );
                const destination =
                    surfaceTarget && !surfaceNeedsIntermediate
                        ? this.owner.nativePresentation.framebuffer
                        : this.context.queue.copyDrawFramebuffer();
                let intermediate: WebGLRenderbuffer | null = null;
                if (surfaceNeedsIntermediate) {
                    intermediate = this.context.queue.surfaceResolveRenderbuffer(
                        webGL2FormatInfo(gl, target.format).internalFormat,
                        width,
                        height
                    );
                }
                this.owner.state.bindFramebuffer(gl.READ_FRAMEBUFFER, this.#framebuffer);
                this.owner.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destination);
                gl.readBuffer(gl.COLOR_ATTACHMENT0 + index);
                if (intermediate !== null) {
                    gl.framebufferRenderbuffer(
                        gl.DRAW_FRAMEBUFFER,
                        gl.COLOR_ATTACHMENT0,
                        gl.RENDERBUFFER,
                        intermediate
                    );
                    gl.drawBuffers(this.#singleColorDrawBuffer);
                } else if (surfaceTarget) {
                    gl.drawBuffers(this.owner.nativePresentation.drawBuffers);
                } else {
                    attachView(gl, gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, target);
                    gl.drawBuffers(this.#singleColorDrawBuffer);
                }
                const resolveViewport = externalSurface
                    ? this.owner.nativePresentation.viewport
                    : null;
                if (externalSurface && resolveViewport === null) {
                    throw new RHIValidationError(
                        'invalid-state',
                        'external resolve requires a selected eye viewport',
                        'renderPass.resolveTarget'
                    );
                }
                const resolveX = resolveViewport?.x ?? 0;
                const resolveY = resolveViewport?.y ?? 0;
                const resolveWidth = resolveViewport?.width ?? width;
                const resolveHeight = resolveViewport?.height ?? height;
                gl.blitFramebuffer(
                    resolveX,
                    resolveY,
                    resolveX + resolveWidth,
                    resolveY + resolveHeight,
                    resolveX,
                    resolveY,
                    resolveX + resolveWidth,
                    resolveY + resolveHeight,
                    gl.COLOR_BUFFER_BIT,
                    gl.NEAREST
                );
                if (intermediate !== null) {
                    this.owner.state.bindFramebuffer(gl.READ_FRAMEBUFFER, destination);
                    this.owner.state.bindFramebuffer(
                        gl.DRAW_FRAMEBUFFER,
                        this.owner.nativePresentation.framebuffer
                    );
                    gl.readBuffer(gl.COLOR_ATTACHMENT0);
                    gl.drawBuffers(this.owner.nativePresentation.drawBuffers);
                    gl.blitFramebuffer(
                        0,
                        0,
                        width,
                        height,
                        0,
                        0,
                        width,
                        height,
                        gl.COLOR_BUFFER_BIT,
                        gl.NEAREST
                    );
                    this.owner.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
                }
            }
        }
        const invalidate = this.#storage.invalidateAttachments(
            this.#descriptor,
            this.#surfacePass && !this.owner.nativePresentation.externalActive,
            this.context.diagnostics
        );
        if (invalidate.length > 0 && (this.#framebuffer !== null || this.#surfacePass)) {
            this.owner.state.bindFramebuffer(
                gl.FRAMEBUFFER,
                this.#surfacePass ? this.owner.nativePresentation.framebuffer : this.#framebuffer
            );
            gl.invalidateFramebuffer(gl.FRAMEBUFFER, invalidate);
        }
        this.#framebuffer = null;
        this.#surfacePass = false;
        this.owner.state.bindFramebuffer(
            gl.FRAMEBUFFER,
            this.#presentationPass ? this.owner.nativePresentation.framebuffer : null
        );
        this.#presentationPass = false;
    }

    private recordDraw(): void {
        this.#drawBatchPending = true;
        this.context.diagnostics.commandCount += 1;
        this.context.diagnostics.drawCount += 1;
    }

    private flushPendingDrawBatch(): void {
        if (!this.#drawBatchPending) return;
        this.context.nativeSucceeded('renderPass.drawBatch');
        this.#drawBatchPending = false;
    }

    private validateDrawArguments(
        count: number,
        instanceCount: number,
        first: number,
        firstInstance: number,
        path: string
    ): void {
        if (
            !isSafeIntegerPrimitive(count) ||
            count <= 0 ||
            !isSafeIntegerPrimitive(instanceCount) ||
            instanceCount <= 0 ||
            !isSafeIntegerPrimitive(first) ||
            first < 0 ||
            !isSafeIntegerPrimitive(firstInstance) ||
            firstInstance < 0
        ) {
            throw new RHIValidationError(
                'invalid-descriptor',
                'draw counts must be positive and first offsets non-negative safe integers',
                `renderPass.${path}`
            );
        }
    }

    private requireOpen(): void {
        if (this.#state !== 'open' || this.context.state !== 'render-pass')
            throw new RHIValidationError(
                'invalid-state',
                `render pass is ${this.#state}`,
                'renderPass'
            );
        assertRHIObjectOwnedByContext(this.context, this, 'renderPass');
    }
}
