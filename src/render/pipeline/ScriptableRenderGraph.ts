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
import type { RenderPipelineCapabilities } from './RenderPipeline';
import type { RendererListHandle } from './RendererList';

declare const renderGraphTextureHandleBrand: unique symbol;
declare const renderGraphPassHandleBrand: unique symbol;

/** Opaque texture identity scoped to one scriptable frame. */
export type RenderGraphTextureHandle = number & {
    readonly [renderGraphTextureHandleBrand]: true;
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
    readonly format: RenderTargetColorFormat | RenderTargetDepthStencilFormat;
    /** Absolute or output-relative dimensions. */
    readonly extent: RenderPipelineExtent;
    /** Raster sample count, defaulting to one. */
    readonly sampleCount?: RenderTargetSampleCount;
    /** Mip count, defaulting to one; multisampled textures require one mip. */
    readonly mipLevelCount?: number;
}

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

/** One setup-declared color attachment. */
export interface RenderPipelineColorAttachment {
    /** Attachment source texture. */
    readonly texture: RenderGraphTextureHandle;
    /** Optional single-sample resolve destination. */
    readonly resolveTarget?: RenderGraphTextureHandle;
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
    readonly texture: RenderGraphTextureHandle;
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
    readTexture(texture: RenderGraphTextureHandle): void;
    /** Declare one complete texture copy and its exact source/destination dependency pair. */
    copyTexture(source: RenderGraphTextureHandle, destination: RenderGraphTextureHandle): void;
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
    /** Copy the complete single-sample source texture into the destination. */
    copyTexture(source: RenderGraphTextureHandle, destination: RenderGraphTextureHandle): void;
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
    /** Import the current surface or selected RenderTarget output. */
    importOutput(): RenderPipelineOutputResources;
    /** Import a RenderTarget owned by the current Renderer. */
    importRenderTarget(target: RenderTarget): RenderPipelineTargetResources;
    /** Acquire a renderer-local persistent target keyed by runtime-owned object identity. */
    acquirePersistentTarget(
        key: object,
        descriptor: Readonly<RenderPipelinePersistentTargetDescriptor>
    ): RenderPipelineTargetResources;
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
