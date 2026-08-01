import type {
    RenderTarget,
    RenderTargetColor,
    RenderTargetColorFormat,
    RenderTargetDepthStencilFormat,
    RenderTargetLoadOp,
    RenderTargetSampleCount,
    RenderTargetStoreOp
} from '../RenderTarget';
import type { RendererViewport } from '../RendererCore';
import type { StorageBuffer } from '../StorageBuffer';
import type { RenderPipelineCapabilities } from './RenderPipeline';
import type {
    RenderPipelineTextureAspect,
    RenderPipelineTextureDimension,
    RenderPipelineTextureFormat,
    RenderPipelineTextureViewDimension
} from './RenderPipelineTexture';
import type { RendererListHandle } from './RendererList';

declare const renderGraphTextureHandleBrand: unique symbol;
declare const renderGraphTextureViewHandleBrand: unique symbol;
declare const renderGraphBufferHandleBrand: unique symbol;
declare const renderGraphPassHandleBrand: unique symbol;

/** Opaque texture identity scoped to one scriptable frame. */
export type RenderGraphTextureHandle = number & {
    readonly [renderGraphTextureHandleBrand]: true;
};

/** Opaque view identity selecting subresources from one graph texture. */
export type RenderGraphTextureViewHandle = number & {
    readonly [renderGraphTextureViewHandleBrand]: true;
};

/** A complete graph texture or one explicit mip/layer/aspect view. */
export type RenderGraphTextureAccessHandle =
    RenderGraphTextureHandle | RenderGraphTextureViewHandle;

/** Opaque buffer identity scoped to one scriptable frame. */
export type RenderGraphBufferHandle = number & {
    readonly [renderGraphBufferHandleBrand]: true;
};

/** Opaque pass identity scoped to one scriptable frame. */
export type RenderGraphPassHandle = number & {
    readonly [renderGraphPassHandleBrand]: true;
};

/** Absolute or output-relative two-dimensional resource extent. */
export type RenderPipelineExtent =
    | Readonly<{ width: number; height: number }>
    | Readonly<{
          relativeTo: 'output';
          scale: number;
          minWidth?: number;
          minHeight?: number;
      }>;

/** Backend-neutral transient texture descriptor. Usage is inferred from pass declarations. */
export interface RenderPipelineTextureDescriptor {
    /** Color or depth/stencil format. */
    readonly format: RenderPipelineTextureFormat;
    /** Absolute or output-relative dimensions. */
    readonly extent: RenderPipelineExtent;
    /** Raster sample count, defaulting to one. */
    readonly sampleCount?: RenderTargetSampleCount;
    /** Mip count, defaulting to one; multisampled textures require one mip. */
    readonly mipLevelCount?: number;
    /** Texture depth or array-layer count, defaulting to one. */
    readonly depthOrArrayLayers?: number;
    /** Physical texture dimension, defaulting to `2d`. */
    readonly dimension?: RenderPipelineTextureDimension;
    /** Default whole-resource view dimension. */
    readonly viewDimension?: RenderPipelineTextureViewDimension;
    /** Compatible formats that explicit views may select. */
    readonly viewFormats?: readonly RenderPipelineTextureFormat[];
}

/** Explicit subresource selection into one graph texture. */
export interface RenderPipelineTextureViewDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** Optional compatible format reinterpretation declared by the parent texture. */
    readonly format?: RenderPipelineTextureFormat;
    /** View dimensionality. */
    readonly dimension?: RenderPipelineTextureViewDimension;
    /** Color, depth, stencil, or all compatible aspects. */
    readonly aspect?: RenderPipelineTextureAspect;
    /** First selected mip. */
    readonly baseMipLevel?: number;
    /** Number of selected mips. */
    readonly mipLevelCount?: number;
    /** First selected array layer. */
    readonly baseArrayLayer?: number;
    /** Number of selected array layers. */
    readonly arrayLayerCount?: number;
}

/** Backend-neutral transient buffer descriptor. Usage is inferred from pass declarations. */
export interface RenderPipelineBufferDescriptor {
    /** Optional diagnostic label, defaulting to the graph resource name. */
    readonly label?: string;
    /** Allocation size in bytes. */
    readonly byteLength: number;
}

/** Portable roles that consume initialized graph-buffer contents. */
export type RenderGraphBufferReadUse = 'storage' | 'vertex' | 'index' | 'copy-source' | 'indirect';

/** Portable roles that completely replace graph-buffer contents. */
export type RenderGraphBufferWriteUse = 'storage' | 'copy-destination';

/** Frame-scoped graph handles representing one imported or persistent render target. */
export interface RenderPipelineTargetResources {
    /** Target width in physical pixels. */
    readonly width: number;
    /** Target height in physical pixels. */
    readonly height: number;
    /** Target raster sample count. */
    readonly sampleCount: RenderTargetSampleCount;
    /** Number of continuous color attachments. */
    readonly colorAttachmentCount: number;
    /** Return one color attachment handle. */
    color(index: number): RenderGraphTextureHandle;
    /** Depth/stencil attachment handle, or null when absent. */
    readonly depthStencil: RenderGraphTextureHandle | null;
}

/** Graph resources representing the current invocation output. */
export type RenderPipelineOutputResources = RenderPipelineTargetResources;

/** Recovery-aware persistent render-target recipe owned by a pipeline runtime key. */
export interface RenderPipelinePersistentTargetDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** Absolute or output-relative dimensions. */
    readonly extent: RenderPipelineExtent;
    /** Continuous color attachment formats. */
    readonly colorFormats: readonly RenderTargetColorFormat[];
    /** Optional depth/stencil attachment format. */
    readonly depthStencilFormat?: RenderTargetDepthStencilFormat;
    /** Raster sample count, defaulting to one. */
    readonly sampleCount?: RenderTargetSampleCount;
}

/** Explicit creation roles for a recovery-aware history texture. */
export type RenderPipelinePersistentTextureUsage =
    'sampled' | 'storage' | 'attachment' | 'copy-source' | 'copy-destination';

/**
 * Recovery recipe for a renderer-owned double- or triple-buffered history texture.
 *
 * The first release accepts one single-sample 2D color mip and array layer. This fail-closed
 * boundary ensures any submitted current-slot writer fully initializes the next readable slot.
 */
export interface RenderPipelineHistoryTextureDescriptor extends RenderPipelineTextureDescriptor {
    /** Optional diagnostic label. */
    readonly label?: string;
    /** Complete immutable usage set required by every history slot. */
    readonly usage: readonly RenderPipelinePersistentTextureUsage[];
    /** Number of rotating slots, defaulting to two. */
    readonly bufferCount?: 2 | 3;
}

/** Frame-scoped handles for one persistent history ring. */
export interface RenderPipelineHistoryTextureResources {
    /** Slot that this frame may completely replace. */
    readonly current: RenderGraphTextureHandle;
    /** Whether the immediately previous slot contains valid submitted contents. */
    readonly valid: boolean;
    /** Invalidation generation for cached temporal state. */
    readonly generation: number;
    /** Number of readable history slots. */
    readonly historyCount: number;
    /** Return history slot zero (previous frame) through `historyCount - 1`. */
    history(index?: number): RenderGraphTextureHandle;
}

/** One setup-declared color attachment. */
export interface RenderPipelineColorAttachment {
    /** Attachment source texture. */
    readonly texture: RenderGraphTextureAccessHandle;
    /** Optional single-sample resolve destination. */
    readonly resolveTarget?: RenderGraphTextureAccessHandle;
    /** Whether existing contents are loaded or cleared. */
    readonly loadOp: RenderTargetLoadOp;
    /** Whether resulting contents remain available after the pass. */
    readonly storeOp: RenderTargetStoreOp;
    /** Required clear color when loadOp is `clear`. */
    readonly clearValue?: RenderTargetColor;
}

/** One setup-declared depth/stencil attachment. */
export interface RenderPipelineDepthStencilAttachment {
    /** Depth/stencil texture handle. */
    readonly texture: RenderGraphTextureAccessHandle;
    /** Depth aspect load operation. */
    readonly depthLoadOp?: RenderTargetLoadOp;
    /** Depth aspect store operation. */
    readonly depthStoreOp?: RenderTargetStoreOp;
    /** Depth clear value. */
    readonly depthClearValue?: number;
    /** Prevent depth writes while retaining read-only attachment access. */
    readonly depthReadOnly?: boolean;
    /** Stencil aspect load operation. */
    readonly stencilLoadOp?: RenderTargetLoadOp;
    /** Stencil aspect store operation. */
    readonly stencilStoreOp?: RenderTargetStoreOp;
    /** Unsigned stencil clear value. */
    readonly stencilClearValue?: number;
    /** Prevent stencil writes while retaining read-only attachment access. */
    readonly stencilReadOnly?: boolean;
}

/** Setup-only dependency declaration surface for one pass. */
export interface ScriptableRenderPassBuilder {
    /** Declare a sampled texture read. */
    readTexture(texture: RenderGraphTextureAccessHandle): void;
    /**
     * Declare a write-only storage-texture binding that completely replaces its subresource.
     * Partial in-place texture updates are intentionally outside the first public compute ABI.
     */
    writeStorageTexture(texture: RenderGraphTextureAccessHandle): void;
    /** Declare one complete selected-subresource copy and its exact dependency pair. */
    copyTexture(
        source: RenderGraphTextureAccessHandle,
        destination: RenderGraphTextureAccessHandle
    ): void;
    /** Declare one initialized buffer read for the given portable role. */
    readBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferReadUse): void;
    /** Declare a complete buffer replacement for the given portable role. */
    writeBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferWriteUse): void;
    /** Declare a storage binding that reads and writes the same initialized buffer. */
    readWriteBuffer(buffer: RenderGraphBufferHandle): void;
    /** Declare one complete buffer copy and its exact source/destination dependency pair. */
    copyBuffer(source: RenderGraphBufferHandle, destination: RenderGraphBufferHandle): void;
    /** Declare one WebGPU clear and its exact destination byte range. */
    clearBuffer(buffer: RenderGraphBufferHandle, byteOffset?: number, byteLength?: number): void;
    /** Declare a color attachment. */
    useColorAttachment(options: Readonly<RenderPipelineColorAttachment>): void;
    /** Declare a depth/stencil attachment. */
    useDepthStencilAttachment(options: Readonly<RenderPipelineDepthStencilAttachment>): void;
    /** Declare a renderer list that may be drawn during execute. */
    useRendererList(list: RendererListHandle): void;
    /** Add an explicit dependency on an earlier public pass handle. */
    dependsOn(pass: RenderGraphPassHandle): void;
    /** Keep the pass alive even when it does not contribute to a marked output. */
    markSideEffect(): void;
}

/** Execute-only backend-neutral command facade. */
export interface ScriptableRenderCommands {
    /** Set the raster viewport in physical attachment pixels. */
    setViewport(viewport: RendererViewport): void;
    /** Set the raster scissor in physical attachment pixels. */
    setScissor(rect: RendererViewport): void;
    /** Set the unsigned stencil reference. */
    setStencilReference(reference: number): void;
    /** Draw a renderer list declared during setup. */
    drawRendererList(list: RendererListHandle): void;
    /** Copy the complete selected single-sample subresource into the destination. */
    copyTexture(
        source: RenderGraphTextureAccessHandle,
        destination: RenderGraphTextureAccessHandle
    ): void;
    /** Copy one complete buffer using a source/destination pair declared during setup. */
    copyBuffer(source: RenderGraphBufferHandle, destination: RenderGraphBufferHandle): void;
    /** Clear the exact destination byte range declared during setup. */
    clearBuffer(buffer: RenderGraphBufferHandle, byteOffset?: number, byteLength?: number): void;
}

/** Execute-phase inputs for one scriptable pass. */
export interface ScriptableRenderPassContext {
    /** Command facade valid only for the active execute callback. */
    readonly commands: ScriptableRenderCommands;
}

/** Prepare-phase inputs for one scriptable pass. */
export interface ScriptableRenderPrepareContext {
    /** Effective immutable device-generation capability snapshot. */
    readonly capabilities: RenderPipelineCapabilities;
}

/** Stable pass object whose callbacks must all complete synchronously. */
export interface ScriptableRenderPass<P extends object> {
    /** Human-readable pass name used in graph diagnostics. */
    readonly name: string;
    /**
     * Declare all resources and dependencies without issuing GPU commands.
     *
     * @returns An ignored synchronous value. Promise-like values are rejected.
     */
    setup(builder: ScriptableRenderPassBuilder, parameters: P): unknown;
    /**
     * Prepare reusable backend objects after graph resources exist and before command emission.
     *
     * @returns An ignored synchronous value. Promise-like values are rejected.
     */
    prepare?(context: ScriptableRenderPrepareContext, parameters: P): unknown;
    /**
     * Emit commands through the portable facade.
     *
     * @returns An ignored synchronous value. Promise-like values are rejected.
     */
    execute(context: ScriptableRenderPassContext, parameters: P): unknown;
}

/** Narrow, backend-neutral graph surface exposed during RenderPipeline.record(). */
export interface ScriptableRenderGraph {
    /** Create a logical transient texture whose usage is inferred from live passes. */
    createTexture(
        name: string,
        descriptor: Readonly<RenderPipelineTextureDescriptor>
    ): RenderGraphTextureHandle;
    /** Create one explicit mip/layer/aspect view into a graph texture. */
    createTextureView(
        name: string,
        texture: RenderGraphTextureHandle,
        descriptor?: Readonly<RenderPipelineTextureViewDescriptor>
    ): RenderGraphTextureViewHandle;
    /** Create a logical transient buffer whose usage is inferred from live passes. */
    createBuffer(
        name: string,
        descriptor: Readonly<RenderPipelineBufferDescriptor>
    ): RenderGraphBufferHandle;
    /** Import one renderer-owned persistent StorageBuffer into the active graph. */
    importStorageBuffer(buffer: StorageBuffer): RenderGraphBufferHandle;
    /** Import the current surface or selected RenderTarget output. */
    importOutput(): RenderPipelineOutputResources;
    /** Import a RenderTarget owned by the current Renderer. */
    importRenderTarget(target: RenderTarget): RenderPipelineTargetResources;
    /** Acquire a renderer-local persistent target keyed by runtime-owned object identity. */
    acquirePersistentTarget(
        key: object,
        descriptor: Readonly<RenderPipelinePersistentTargetDescriptor>
    ): RenderPipelineTargetResources;
    /** Acquire one renderer-owned history ring; it rotates only after a successful write frame. */
    acquireHistoryTexture(
        key: object,
        descriptor: Readonly<RenderPipelineHistoryTextureDescriptor>
    ): RenderPipelineHistoryTextureResources;
    /** Invalidate submitted history before acquiring it in the active frame. */
    invalidateHistoryTexture(key: object): boolean;
    /** Transactionally release one renderer-owned history ring. */
    releaseHistoryTexture(key: object): boolean;
    /**
     * Release one persistent target by runtime-owned key.
     *
     * Release is committed only after the active frame submits successfully and is rolled back on
     * recording, compilation, preparation, or execution failure. The target cannot be released
     * after it has been acquired by the active frame.
     *
     * @returns Whether a target was associated with the key.
     */
    releasePersistentTarget(key: object): boolean;
    /** Add one stable pass with frame-retained parameters. */
    addPass<P extends object>(pass: ScriptableRenderPass<P>, parameters: P): RenderGraphPassHandle;
}
