import type { RHIBindGroup, RHIComputePipeline, RHIGraphicsPipeline } from './RHIPipeline';
import type {
    RHIBuffer,
    RHIDeviceOwnedObject,
    RHIQuerySet,
    RHITexture,
    RHITextureView
} from './RHIResources';
import type {
    RHIColor,
    RHIDataSource,
    RHIExtent3D,
    RHIIndexFormat,
    RHILoadOp,
    RHIOrigin3D,
    RHIRect,
    RHIStoreOp,
    RHITextureAspect,
    RHIViewport,
    RHIUInt32View
} from './RHITypes';

export interface RHIRenderPassColorAttachment {
    readonly view: RHITextureView;
    readonly resolveTarget?: RHITextureView;
    readonly clearValue?: RHIColor;
    readonly loadOp: RHILoadOp;
    readonly storeOp: RHIStoreOp;
}

export interface RHIRenderPassDepthStencilAttachment {
    readonly view: RHITextureView;
    readonly depthClearValue?: number;
    readonly depthLoadOp?: RHILoadOp;
    readonly depthStoreOp?: RHIStoreOp;
    readonly depthReadOnly?: boolean;
    readonly stencilClearValue?: number;
    readonly stencilLoadOp?: RHILoadOp;
    readonly stencilStoreOp?: RHIStoreOp;
    readonly stencilReadOnly?: boolean;
}

export interface RHIRenderPassDescriptor {
    readonly label?: string;
    readonly colorAttachments: readonly (RHIRenderPassColorAttachment | null)[];
    readonly depthStencilAttachment?: RHIRenderPassDepthStencilAttachment;
    readonly timestampWrites?: RHITimestampWrites;
}

/** Timestamp indices written by one native render or compute pass. */
export interface RHITimestampWrites {
    readonly querySet: RHIQuerySet;
    readonly beginningOfPassWriteIndex?: number;
    readonly endOfPassWriteIndex?: number;
}

export interface RHIImageCopyTexture {
    readonly texture: RHITexture;
    readonly mipLevel?: number;
    /** Top-left texture-space origin; copied buffer rows retain that top-to-bottom order. */
    readonly origin?: RHIOrigin3D;
    readonly aspect?: RHITextureAspect;
}

/** Browser-owned image sources with a synchronous portable backend copy path. */
export type RHIExternalImageSource =
    HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas | HTMLVideoElement;

/** Source region and orientation for one browser external-image copy. */
export interface RHIImageCopyExternalImage {
    readonly source: RHIExternalImageSource;
    /** Top-left origin in the source image before `flipY` is applied. */
    readonly origin?: Readonly<{ readonly x?: number; readonly y?: number }>;
    readonly flipY?: boolean;
}

/** Destination subresource and alpha representation for one external-image copy. */
export interface RHIImageCopyExternalImageToTexture extends RHIImageCopyTexture {
    /** Whether RGB values written to the texture are premultiplied by alpha. */
    readonly premultipliedAlpha?: boolean;
}

export interface RHIImageCopyBuffer {
    readonly buffer: RHIBuffer;
    readonly offset?: number;
    readonly bytesPerRow?: number;
    readonly rowsPerImage?: number;
}

/** Byte layout for CPU image data. Offsets and row strides are always measured in bytes. */
export interface RHIImageDataLayout {
    readonly offset?: number;
    readonly bytesPerRow?: number;
    readonly rowsPerImage?: number;
}

/** @internal Allocation-stable arguments for one render-pass vertex-buffer command. */
export interface RHIVertexBufferBindingRecord {
    readonly slot: number;
    readonly buffer: RHIBuffer;
    readonly offset: number;
    readonly size: number | undefined;
}

/** @internal Allocation-stable arguments for one render-pass index-buffer command. */
export interface RHIIndexBufferBindingRecord {
    readonly buffer: RHIBuffer;
    readonly format: RHIIndexFormat;
    readonly offset: number;
    readonly size: number | undefined;
}

/**
 * @internal Allocation-stable arguments shared by direct and indexed render-pass draw commands.
 * `elementCount` and `firstElement` mean vertices for `drawRecord` and indices for
 * `drawIndexedRecord`; `baseVertex` is read only by `drawIndexedRecord`.
 */
export interface RHIDrawArgumentsRecord {
    readonly elementCount: number;
    readonly instanceCount: number;
    readonly firstElement: number;
    readonly baseVertex: number;
    readonly firstInstance: number;
}

/** Reused per renderer; fields are mutable so default diagnostics do not allocate per frame. */
export interface RHIFrameDiagnostics {
    commandCount: number;
    drawCount: number;
    indirectDrawCount: number;
    dispatchCount: number;
    dispatchedWorkgroupCount: number;
    bufferClearCount: number;
    pipelineSwitches: number;
    bindGroupSwitches: number;
    computePipelineSwitches: number;
    computeBindGroupSwitches: number;
    vertexBufferSwitches: number;
    nativeStateCalls: number;
    frameArenaGrowths: number;
    transientAllocations: number;
    cacheHits: number;
    cacheMisses: number;
}

export type RHICommandContextState = 'open' | 'render-pass' | 'compute-pass' | 'ended' | 'aborted';
export type RHIRenderPassState = 'open' | 'ended' | 'aborted';
export type RHIComputePassState = 'open' | 'ended' | 'aborted';

/** Debug annotations map to native markers when available and preserve validated nesting. */
export interface RHIDebugCommands {
    pushDebugGroup(label: string): void;
    popDebugGroup(): void;
    insertDebugMarker(label: string): void;
}

/** Optional debug metadata for a backend-neutral compute pass. */
export interface RHIComputePassDescriptor {
    readonly label?: string;
    readonly timestampWrites?: RHITimestampWrites;
}

/** Command encoder valid only while its parent context is in the compute-pass state. */
export interface RHIComputePassEncoder extends RHIDeviceOwnedObject, RHIDebugCommands {
    readonly contextId: number;
    readonly state: RHIComputePassState;

    setPipeline(pipeline: RHIComputePipeline): void;
    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void;
    /** Dispatch positive workgroup counts bounded by maxComputeWorkgroupsPerDimension. */
    dispatchWorkgroups(x: number, y?: number, z?: number): void;
    /** Read three uint32 workgroup counts from an unmapped INDIRECT buffer. */
    dispatchWorkgroupsIndirect(buffer: RHIBuffer, offset?: number): void;
    end(): void;
}

/** A render pass is valid only while both it and its parent frame context are open. */
export interface RHIRenderPassEncoder extends RHIDeviceOwnedObject, RHIDebugCommands {
    readonly contextId: number;
    readonly state: RHIRenderPassState;

    setPipeline(pipeline: RHIGraphicsPipeline): void;
    setBindGroup(index: number, bindGroup: RHIBindGroup, dynamicOffsets?: RHIUInt32View): void;
    setVertexBuffer(slot: number, buffer: RHIBuffer, offset?: number, size?: number): void;
    /** @internal Read synchronously from caller-owned allocation-stable command storage. */
    setVertexBufferRecord(record: Readonly<RHIVertexBufferBindingRecord>): void;
    setIndexBuffer(buffer: RHIBuffer, format: RHIIndexFormat, offset?: number, size?: number): void;
    /** @internal Read synchronously from caller-owned allocation-stable command storage. */
    setIndexBufferRecord(record: Readonly<RHIIndexBufferBindingRecord>): void;
    setViewport(
        x: number,
        y: number,
        width: number,
        height: number,
        minDepth: number,
        maxDepth: number
    ): void;
    /** @internal Read synchronously from caller-owned allocation-stable command storage. */
    setViewportRecord(viewport: Readonly<RHIViewport>): void;
    setScissorRect(x: number, y: number, width: number, height: number): void;
    /** @internal Read synchronously from caller-owned allocation-stable command storage. */
    setScissorRectRecord(rect: Readonly<RHIRect>): void;
    setBlendConstant(color: RHIColor): void;
    setStencilReference(reference: number): void;
    draw(
        vertexCount: number,
        instanceCount?: number,
        firstVertex?: number,
        firstInstance?: number
    ): void;
    /** @internal Read synchronously from caller-owned allocation-stable command storage. */
    drawRecord(record: Readonly<RHIDrawArgumentsRecord>): void;
    drawIndexed(
        indexCount: number,
        instanceCount?: number,
        firstIndex?: number,
        baseVertex?: number,
        firstInstance?: number
    ): void;
    /** @internal Read synchronously from caller-owned allocation-stable command storage. */
    drawIndexedRecord(record: Readonly<RHIDrawArgumentsRecord>): void;
    /** Read one non-indexed draw packet from an unmapped INDIRECT buffer. */
    drawIndirect(buffer: RHIBuffer, offset?: number): void;
    /** Read one indexed draw packet from an unmapped INDIRECT buffer. */
    drawIndexedIndirect(buffer: RHIBuffer, offset?: number): void;
    end(): void;
}

/**
 * Portable frame command scope. Implementations may execute immediately or encode native deferred
 * work; clients cannot observe or branch on that strategy.
 */
export interface RHICommandContext extends RHIDeviceOwnedObject, RHIDebugCommands {
    readonly frameId: number;
    readonly state: RHICommandContextState;
    readonly diagnostics: RHIFrameDiagnostics;

    /**
     * Snapshot CPU bytes into a COPY_DST buffer in this frame's command order. `dataOffset` and
     * `size` address the data source's visible byte range and must be 4-byte aligned.
     */
    writeBuffer(
        destination: RHIBuffer,
        destinationOffset: number,
        data: RHIDataSource,
        dataOffset?: number,
        size?: number
    ): void;
    /** Snapshot CPU image bytes into a COPY_DST texture in this frame's command order. */
    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIDataSource,
        dataLayout: RHIImageDataLayout,
        writeSize: RHIExtent3D
    ): void;
    /**
     * Copy a live browser image into a COPY_DST texture. This is a frame pre-pass operation:
     * every external-image copy must precede all other frame commands. Source pixels are captured
     * when this method is called.
     */
    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyExternalImageToTexture,
        copySize: RHIExtent3D
    ): void;
    /**
     * Rebuild every non-base mip level from the preceding level. The texture must be a
     * single-sampled, renderable sampled color texture whose fixed view dimension is `2d` or
     * `cube`. Depth/stencil, integer, compressed, array and 3D textures are rejected before
     * native execution.
     */
    generateMipmaps(texture: RHITexture): void;
    beginRenderPass(descriptor: RHIRenderPassDescriptor): RHIRenderPassEncoder;
    /** Begin a compute pass; unsupported backends fail before native command emission. */
    beginComputePass(descriptor?: RHIComputePassDescriptor): RHIComputePassEncoder;
    /** Encode a four-byte-aligned zero fill for an unmapped COPY_DST buffer range. */
    clearBuffer(buffer: RHIBuffer, offset?: number, size?: number): void;
    copyBufferToBuffer(
        source: RHIBuffer,
        sourceOffset: number,
        destination: RHIBuffer,
        destinationOffset: number,
        size: number
    ): void;
    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void;
    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void;
    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void;
    /** Resolve a contiguous query range into an unmapped QUERY_RESOLVE buffer. */
    resolveQuerySet(
        querySet: RHIQuerySet,
        firstQuery: number,
        queryCount: number,
        destination: RHIBuffer,
        destinationOffset?: number
    ): void;
}
