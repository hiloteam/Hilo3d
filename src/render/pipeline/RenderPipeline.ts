import type Camera from '../../camera/Camera';
import type { RendererFeatureName } from '../RendererOptions';
import type { RendererScene, RendererViewport } from '../RendererCore';
import type {
    RenderTargetColor,
    RenderTargetColorFormat,
    RenderTargetDepthStencilFormat,
    RenderTargetLoadOp,
    RenderTargetStoreOp,
    RenderTargetSampleCount
} from '../RenderTarget';
import type { RenderPassParameterPool } from './RenderPassParameterPool';
import type {
    CullingOptions,
    CullingResultsHandle,
    RendererListDescriptor,
    RendererListHandle
} from './RendererList';
import type { ScriptableRenderGraph } from './ScriptableRenderGraph';
import type { RenderPipelineTextureFormat } from './RenderPipelineTexture';

/** Optional renderer capabilities exposed only after their complete SRP/RHI path is available. */
export type RenderPipelineCapabilityName =
    'storage-buffer' | 'storage-texture' | 'compute-pass' | 'indirect-draw';

/** Portable texture roles available to creation-time requirement validation. */
export type RenderPipelineTextureUse =
    | 'sampled'
    | 'filterable-sampled'
    | 'color-attachment'
    | 'depth-stencil-attachment'
    | 'storage'
    | 'copy-source'
    | 'copy-destination';

/** Public limits that a pipeline may inspect without observing native backend types. */
export interface RenderPipelineLimits {
    /** Maximum width or height of a two-dimensional texture. */
    readonly maxTextureDimension2D: number;
    /** Maximum simultaneous color attachments in one raster pass. */
    readonly maxColorAttachments: number;
    /** Maximum sampled textures visible to one shader stage. */
    readonly maxSampledTexturesPerShaderStage: number;
    /** Maximum bind groups in one pipeline layout. */
    readonly maxBindGroups: number;
    /** Maximum bindings declared by one bind group. */
    readonly maxBindingsPerBindGroup: number;
    /** Maximum byte size of any GPU buffer. */
    readonly maxBufferSize: number;
    /** Maximum storage buffers visible to one shader stage, when storage is supported. */
    readonly maxStorageBuffersPerShaderStage?: number;
    /** Maximum storage textures visible to one shader stage, when storage is supported. */
    readonly maxStorageTexturesPerShaderStage?: number;
    /** Maximum byte range of one storage-buffer binding. */
    readonly maxStorageBufferBindingSize?: number;
    /** Required byte alignment for static and dynamic storage-buffer offsets. */
    readonly minStorageBufferOffsetAlignment?: number;
    /** Maximum dynamic storage-buffer bindings in one pipeline layout. */
    readonly maxDynamicStorageBuffersPerPipelineLayout?: number;
    /** Maximum workgroup address-space storage in bytes. */
    readonly maxComputeWorkgroupStorageSize?: number;
    /** Maximum shader invocations in one workgroup. */
    readonly maxComputeInvocationsPerWorkgroup?: number;
    /** Maximum X dimension of a compute workgroup. */
    readonly maxComputeWorkgroupSizeX?: number;
    /** Maximum Y dimension of a compute workgroup. */
    readonly maxComputeWorkgroupSizeY?: number;
    /** Maximum Z dimension of a compute workgroup. */
    readonly maxComputeWorkgroupSizeZ?: number;
    /** Maximum direct dispatch count in each dimension. */
    readonly maxComputeWorkgroupsPerDimension?: number;
    /** Minimum native subgroup size when the optional subgroups feature is enabled. */
    readonly subgroupMinSize?: number;
    /** Maximum native subgroup size when the optional subgroups feature is enabled. */
    readonly subgroupMaxSize?: number;
}

/** Frozen effective capabilities for one renderer device generation. */
export interface RenderPipelineCapabilities {
    /** Backend-neutral limit snapshot. */
    readonly limits: Readonly<RenderPipelineLimits>;
    /** Return whether one optional renderer device feature is enabled for this generation. */
    supportsFeature(feature: RendererFeatureName): boolean;
    /** Return whether an optional pipeline capability is fully implemented end to end. */
    supportsCapability(capability: RenderPipelineCapabilityName): boolean;
    /** Return whether a texture format supports a portable role and sample count. */
    supportsTextureFormat(
        format: RenderPipelineTextureFormat,
        use: RenderPipelineTextureUse,
        sampleCount?: RenderTargetSampleCount
    ): boolean;
}

/** One texture-format constraint validated before the pipeline runtime is created. */
export interface RenderPipelineTextureRequirement {
    /** Required portable format. */
    readonly format: RenderPipelineTextureFormat;
    /** Required graph or pass role. */
    readonly use: RenderPipelineTextureUse;
    /** Required sample count, defaulting to one. */
    readonly sampleCount?: RenderTargetSampleCount;
}

/** Static renderer/device constraints declared before asynchronous backend selection. */
export interface RenderPipelineRequirements {
    /** Required public renderer device features. */
    readonly requiredFeatures?: readonly RendererFeatureName[];
    /** Required SRP capabilities; unsupported capabilities fail instead of degrading. */
    readonly requiredCapabilities?: readonly RenderPipelineCapabilityName[];
    /** Minimum values for named fields in {@link RenderPipelineLimits}. */
    readonly requiredLimits?: Readonly<Record<string, number>>;
    /** Required texture-format roles. */
    readonly requiredTextureFormats?: readonly Readonly<RenderPipelineTextureRequirement>[];
}

/** Immutable creation inputs for one renderer-local pipeline runtime. */
export interface RenderPipelineCreateContext {
    /** Capabilities for the selected device generation. */
    readonly capabilities: RenderPipelineCapabilities;
}

/** Attachment operations selected for one physical output color attachment. */
export interface RenderPipelineOutputColorAttachment {
    /** Clear value used when {@link RenderPipelineOutputColorAttachment.loadOp} is `clear`. */
    readonly clearValue: Readonly<RenderTargetColor>;
    /** Whether the invocation loads or clears the attachment's existing contents. */
    readonly loadOp: RenderTargetLoadOp;
    /** Whether the invocation preserves or discards the attachment's resulting contents. */
    readonly storeOp: RenderTargetStoreOp;
}

/**
 * Attachment operations selected for one physical output depth/stencil attachment.
 *
 * Stencil fields are ignored when {@link RenderPipelineOutput.depthStencilFormat} has no stencil
 * aspect.
 */
export interface RenderPipelineOutputDepthStencilAttachment {
    /** Depth clear value used when depthLoadOp is `clear`. */
    readonly depthClearValue: number;
    /** Whether the invocation loads or clears existing depth contents. */
    readonly depthLoadOp: RenderTargetLoadOp;
    /** Whether the invocation preserves or discards resulting depth contents. */
    readonly depthStoreOp: RenderTargetStoreOp;
    /** Stencil clear value used when stencilLoadOp is `clear`. */
    readonly stencilClearValue: number;
    /** Whether the invocation loads or clears existing stencil contents. */
    readonly stencilLoadOp: RenderTargetLoadOp;
    /** Whether the invocation preserves or discards resulting stencil contents. */
    readonly stencilStoreOp: RenderTargetStoreOp;
}

/** Physical output metadata for one pipeline invocation. */
export interface RenderPipelineOutput {
    /** Whether this invocation renders to the configured surface or a RenderTarget. */
    readonly kind: 'surface' | 'render-target';
    /** Output width in physical pixels. */
    readonly width: number;
    /** Output height in physical pixels. */
    readonly height: number;
    /** Output raster sample count. */
    readonly sampleCount: RenderTargetSampleCount;
    /** Number of continuous output color attachments. */
    readonly colorAttachmentCount: number;
    /** Output depth/stencil format, or null when no depth attachment exists. */
    readonly depthStencilFormat: RenderTargetDepthStencilFormat | null;
    /** Selected depth/stencil operations, or null when no depth attachment exists. */
    readonly depthStencilAttachment: Readonly<RenderPipelineOutputDepthStencilAttachment> | null;
    /** Return the format for one output color attachment. */
    colorFormat(index: number): RenderTargetColorFormat;
    /** Return the selected load, store, and clear policy for one output color attachment. */
    colorAttachment(index: number): Readonly<RenderPipelineOutputColorAttachment>;
}

/** Frame-scoped recording context; retaining it after record() returns is an error. */
export interface RenderPipelineContext {
    /** Monotonic application frame index. */
    readonly frameIndex: number;
    /** Scene supplied to the current renderer invocation. */
    readonly scene: RendererScene;
    /** Camera supplied to the current renderer invocation. */
    readonly camera: Camera;
    /** Active viewport in physical pixels. */
    readonly viewport: RendererViewport;
    /** Renderer clear color snapshotted for this synchronous invocation. */
    readonly clearColor: Readonly<RenderTargetColor>;
    /** Physical output metadata. */
    readonly output: RenderPipelineOutput;
    /** Effective capabilities for the current device generation. */
    readonly capabilities: RenderPipelineCapabilities;
    /** Backend-neutral graph facade for this invocation. */
    readonly graph: ScriptableRenderGraph;

    /** Collect camera-visible scene meshes and lights into a frame-scoped handle. */
    cull(options?: Readonly<CullingOptions>): CullingResultsHandle;
    /** Select and sort a reusable draw list from current-frame culling results. */
    createRendererList(descriptor: Readonly<RendererListDescriptor>): RendererListHandle;
    /** Record the shared directional, spot, and point-light shadow atlas for these results. */
    recordShadows(cullingResults: CullingResultsHandle): void;
    /** Acquire one runtime-owned, high-water reusable parameter slot. */
    acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P;
}

/** Renderer-local runtime created exactly once by a RenderPipelineFactory. */
export interface RenderPipeline {
    /** Human-readable runtime name used in diagnostics. */
    readonly name: string;
    /**
     * Record one invocation synchronously into the active application Render Graph.
     *
     * @returns An ignored synchronous value. Promise-like values are rejected before RHI execution.
     */
    record(context: RenderPipelineContext): unknown;
    /** Release runtime-owned state exactly once during Renderer destruction. */
    destroy(): void;
}

/** Reusable pipeline configuration; create() must return a new runtime for every Renderer. */
export interface RenderPipelineFactory {
    /** Human-readable factory name used in selection and initialization diagnostics. */
    readonly name: string;
    /** Static constraints snapshotted before asynchronous renderer creation. */
    readonly requirements?: Readonly<RenderPipelineRequirements>;
    /** Create independent state for one Renderer. */
    create(context: RenderPipelineCreateContext): RenderPipeline | Promise<RenderPipeline>;
}
