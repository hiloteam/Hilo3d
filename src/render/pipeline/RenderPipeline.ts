import type Camera from '../../camera/Camera';
import type { CameraDepthMode } from '../../camera/Camera';
import type DirectionalLight from '../../light/DirectionalLight';
import type PointLight from '../../light/PointLight';
import type SpotLight from '../../light/SpotLight';
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
import type { StorageBuffer, StorageBufferDescriptor } from '../StorageBuffer';
import type {
    CullingOptions,
    CullingResultsHandle,
    RendererListDescriptor,
    RendererListHandle
} from './RendererList';
import type { RenderGraphTextureHandle, ScriptableRenderGraph } from './ScriptableRenderGraph';
import type { RenderPipelineTextureFormat } from './RenderPipelineTexture';
import type { RenderGraphTimelineSnapshot } from '../graph/RenderGraphTimeline';
import type StorageGraphicsShader from '../compute/StorageGraphicsShader';
import type Mesh from '../../core/Mesh';

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
    /** Maximum samplers visible to one shader stage. */
    readonly maxSamplersPerShaderStage: number;
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
    /**
     * Create a renderer-owned persistent storage buffer during pipeline initialization.
     *
     * The returned identity participates in normal device-loss recovery and must be destroyed by
     * the pipeline runtime. Creation-time allocation keeps fixed GPU databases out of frame
     * recording while avoiding native backend access.
     */
    createStorageBuffer(descriptor: Readonly<StorageBufferDescriptor>): StorageBuffer;
    /** Translate and validate storage-aware raster variants before the first application frame. */
    warmupStorageGraphicsShaders(
        shaders: readonly StorageGraphicsShader[],
        batchSize?: number
    ): Promise<void>;
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

/** Frame-scoped shared shadow-atlas data available to custom and built-in pipelines. */
export interface RenderPipelineShadowResources {
    /** Exact graph texture written by the recorded shadow passes. */
    readonly atlas: RenderGraphTextureHandle;
    /** Atlas dimensions and reciprocal dimensions as `[width, height, 1/width, 1/height]`. */
    readonly atlasSize: Float32Array;
    /** Top-left atlas rectangles as packed `[scaleX, scaleY, offsetX, offsetY]` values. */
    readonly atlasRects: Float32Array;
    /** Depth convention used by the atlas texture and comparison sampler. */
    readonly depthMode: CameraDepthMode;
    /** Shadow-first directional-light order used by the packed directional arrays. */
    readonly directionalLights: readonly DirectionalLight[];
    /** Shadow-first spot-light order used by the packed spot arrays. */
    readonly spotLights: readonly SpotLight[];
    /** Shadow-first point-light order used by the packed point arrays. */
    readonly pointLights: readonly PointLight[];
    /** Number of leading directional lights with valid packed shadow data. */
    readonly directionalShadowCount: number;
    /** Number of leading spot lights with valid packed shadow data. */
    readonly spotShadowCount: number;
    /** Number of leading point lights with valid packed shadow data. */
    readonly pointShadowCount: number;
    /** Directional minimum/slope bias pairs in shadow-first light order. */
    readonly directionalBiases: Float32Array;
    /** Four cascade far distances per directional light. */
    readonly directionalCascadeSplits: Float32Array;
    /** Cascade count, blend fraction, and shadow strength per directional light. */
    readonly directionalCascadeParams: Float32Array;
    /** View-space-to-shadow-clip matrices for every directional cascade. */
    readonly directionalCascadeMatrices: Float32Array;
    /** Spot minimum/slope bias pairs in shadow-first light order. */
    readonly spotBiases: Float32Array;
    /** View-space-to-shadow-clip matrices for shadowed spot lights. */
    readonly spotMatrices: Float32Array;
    /** Point minimum/slope bias pairs in shadow-first light order. */
    readonly pointBiases: Float32Array;
    /** Six view-space-to-shadow-clip face matrices per shadowed point light. */
    readonly pointMatrices: Float32Array;
    /** Physical atlas slices in dense render order. Values are valid only for this invocation. */
    readonly slices: readonly Readonly<RenderPipelineShadowSlice>[];
    /** Page-granular atlas updates recorded this frame, in render order. */
    readonly pageRegions: readonly Readonly<RenderPipelineShadowPageRegion>[];
}

/** One frame-scoped physical page update within a shadow slice. */
export interface RenderPipelineShadowPageRegion {
    /** Dense physical slice containing this page. */
    readonly slicePhysicalIndex: number;
    /** Zero-based horizontal virtual-page coordinate within the slice. */
    readonly pageX: number;
    /** Zero-based vertical virtual-page coordinate within the slice. */
    readonly pageY: number;
    /** Physical atlas X origin in pixels. */
    readonly x: number;
    /** Physical atlas Y origin in pixels. */
    readonly y: number;
    /** Physical page width in pixels; edge pages may be smaller than the page size. */
    readonly width: number;
    /** Physical page height in pixels; edge pages may be smaller than the page size. */
    readonly height: number;
}

/** One frame-scoped shadow-atlas slice exposed for GPU-driven caster work. */
export interface RenderPipelineShadowSlice {
    /** Light projection represented by the slice. */
    readonly kind: 'directional' | 'spot' | 'point';
    /** Stable LightBlock ABI index. */
    readonly sliceIndex: number;
    /** Dense physical placement index within the atlas. */
    readonly physicalIndex: number;
    /** Point-light cube face, or null for planar shadows. */
    readonly face: number | null;
    /** Directional cascade index, or null for local lights. */
    readonly cascade: number | null;
    /** Atlas viewport as `[x, y, width, height]`. */
    readonly viewport: RendererViewport;
    /** World-space to shadow clip-space transform. */
    readonly viewProjectionMatrix: Float32Array;
    /** Shadow-camera near plane. */
    readonly near: number;
    /** Shadow-camera far plane. */
    readonly far: number;
    /** Whether the submission-aware cache scheduled this slice for update. */
    readonly dirty: boolean;
}

/** Optional hybrid-shadow selection used by GPU-managed pipelines. */
export interface RenderPipelineShadowOptions {
    /**
     * Mesh identities omitted from CPU shadow draws while remaining part of cache invalidation.
     * The caller must record equivalent atlas writes for every exposed `pageRegions` entry.
     */
    readonly excludeMeshes?: readonly Mesh[];
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

    /** Update scene world matrices and the active camera without building a CPU render list. */
    prepareScene(): void;
    /** Collect camera-visible scene meshes and lights into a frame-scoped handle. */
    cull(options?: Readonly<CullingOptions>): CullingResultsHandle;
    /** Select and sort a reusable draw list from current-frame culling results. */
    createRendererList(descriptor: Readonly<RendererListDescriptor>): RendererListHandle;
    /**
     * Record the shared directional, spot, and point-light shadow atlas for these results.
     * Returns the exact graph texture and packed sampling data, or `null` when no shadow slice is
     * active. The returned arrays are frame-scoped and must not be retained after `record()`.
     */
    recordShadows(
        cullingResults: CullingResultsHandle,
        options?: Readonly<RenderPipelineShadowOptions>
    ): Readonly<RenderPipelineShadowResources> | null;
    /** Acquire one runtime-owned, high-water reusable parameter slot. */
    acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P;
    /**
     * Stage a dirty upload to a pipeline-owned storage buffer before importing it into this graph.
     * Failed frames retain the dirty CPU shadow for a later valid submission.
     */
    writeStorageBuffer(buffer: StorageBuffer, byteOffset: number, data: ArrayBufferView): void;
}

/** Renderer-local runtime created exactly once by a RenderPipelineFactory. */
export interface RenderPipeline {
    /** Human-readable runtime name used in diagnostics. */
    readonly name: string;
    /** Whether this runtime needs Render Graph timing without external diagnostics. */
    readonly usesRenderGraphTimeline?: boolean;
    /**
     * Record one invocation synchronously into the active application Render Graph.
     *
     * @returns An ignored synchronous value. Promise-like values are rejected before RHI execution.
     */
    record(context: RenderPipelineContext): unknown;
    /** Commit CPU-side temporal state after the frame has submitted successfully. */
    frameSubmitted?(frameIndex: number): void;
    /** Roll back staged CPU-side temporal state after recording or submission failure. */
    frameDiscarded?(frameIndex: number): void;
    /**
     * Consume opt-in Render Graph timing snapshots. GPU-ready snapshots arrive asynchronously
     * after submission completion and may be used by renderer-local adaptive quality controllers.
     */
    recordRenderGraphTimeline?(snapshot: Readonly<RenderGraphTimelineSnapshot>): void;
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
