import type { RHICapabilities } from './RHICapabilities';
import type { RHICacheCounters } from './RHICacheDiagnostics';
import type { RHIExecutionInteropHost } from './RHIInterop';
import type {
    RHIBindGroup,
    RHIBindGroupDescriptor,
    RHIBindGroupLayout,
    RHIBindGroupLayoutDescriptor,
    RHIComputePipeline,
    RHIComputePipelineDescriptor,
    RHIGraphicsPipeline,
    RHIGraphicsPipelineDescriptor,
    RHIPipelineLayout,
    RHIPipelineLayoutDescriptor,
    RHIStorageTextureAccess,
    RHITextureSampleType
} from './RHIPipeline';
import type { RHIQueue } from './RHIQueue';
import type { RHISurface } from './RHISurface';
import type {
    RHIBackend,
    RHIBufferUsageFlags,
    RHIDataSource,
    RHIExtent3D,
    RHINormalizedExtent3D,
    RHIShaderStageName,
    RHITextureAspect,
    RHITextureDimension,
    RHITextureFormat,
    RHITextureUsageFlags,
    RHITextureViewDimension
} from './RHITypes';

/** Stable logical identity. IDs are stable for the lifetime of an object. */
export interface RHIObject {
    readonly id: number;
    readonly deviceGeneration: number;
    label?: string;
}

/** An object with exactly one owner device. */
export interface RHIDeviceOwnedObject extends RHIObject {
    readonly deviceId: number;
}

export interface RHIDestroyable extends RHIObject {
    readonly destroyed: boolean;
    destroy(): void;
}

export interface RHIDeviceOwnedDestroyable extends RHIDeviceOwnedObject, RHIDestroyable {}

export type RHIResourceLifetime = 'persistent' | 'frame' | 'transient';

/** A resource whose logical lifetime and native allocation are owned by the RHI device. */
export interface RHIResource extends RHIDeviceOwnedDestroyable {
    readonly lifetime: RHIResourceLifetime;
}

export interface RHIResourceDescriptorBase {
    readonly label?: string;
    readonly lifetime?: RHIResourceLifetime;
}

export interface RHIBufferDescriptor extends RHIResourceDescriptorBase {
    readonly size: number;
    readonly usage: RHIBufferUsageFlags;
    readonly mappedAtCreation?: boolean;
    /** The device must snapshot these bytes before createBuffer returns. */
    readonly initialData?: RHIDataSource;
}

export interface RHINormalizedBufferDescriptor {
    readonly label: string;
    readonly lifetime: RHIResourceLifetime;
    readonly size: number;
    readonly usage: RHIBufferUsageFlags;
    readonly mappedAtCreation: boolean;
}

export type RHIBufferMapState = 'unmapped' | 'pending' | 'mapped';
export type RHIBufferMapMode = 'read' | 'write';

export interface RHIBuffer extends RHIResource {
    readonly descriptor: Readonly<RHINormalizedBufferDescriptor>;
    readonly size: number;
    readonly usage: RHIBufferUsageFlags;
    readonly mapState: RHIBufferMapState;
    mapAsync(mode: RHIBufferMapMode, offset?: number, size?: number): Promise<void>;
    getMappedRange(offset?: number, size?: number): ArrayBuffer;
    unmap(): void;
}

export interface RHITextureDescriptor extends RHIResourceDescriptorBase {
    readonly size: RHIExtent3D;
    readonly mipLevelCount?: number;
    readonly sampleCount?: number;
    readonly dimension?: RHITextureDimension;
    /** Fixed native/view interpretation. Views may select ranges but cannot change this dimension. */
    readonly viewDimension?: RHITextureViewDimension;
    readonly format: RHITextureFormat;
    readonly usage: RHITextureUsageFlags;
    readonly viewFormats?: readonly RHITextureFormat[];
}

export interface RHINormalizedTextureDescriptor {
    readonly label: string;
    readonly lifetime: RHIResourceLifetime;
    readonly size: Readonly<RHINormalizedExtent3D>;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension: RHITextureDimension;
    readonly viewDimension: RHITextureViewDimension;
    readonly format: RHITextureFormat;
    readonly usage: RHITextureUsageFlags;
    readonly viewFormats: readonly RHITextureFormat[];
}

export interface RHITextureViewDescriptor {
    readonly label?: string;
    readonly format?: RHITextureFormat;
    readonly dimension?: RHITextureViewDimension;
    readonly aspect?: RHITextureAspect;
    readonly baseMipLevel?: number;
    readonly mipLevelCount?: number;
    readonly baseArrayLayer?: number;
    readonly arrayLayerCount?: number;
}

export interface RHINormalizedTextureViewDescriptor {
    readonly label: string;
    readonly format: RHITextureFormat;
    readonly dimension: RHITextureViewDimension;
    readonly aspect: RHITextureAspect;
    readonly baseMipLevel: number;
    readonly mipLevelCount: number;
    readonly baseArrayLayer: number;
    readonly arrayLayerCount: number;
}

export interface RHITexture extends RHIResource {
    readonly descriptor: Readonly<RHINormalizedTextureDescriptor>;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension: RHITextureDimension;
    readonly format: RHITextureFormat;
    readonly usage: RHITextureUsageFlags;
    createView(descriptor?: RHITextureViewDescriptor): RHITextureView;
}

export interface RHITextureView extends RHIDeviceOwnedDestroyable {
    readonly texture: RHITexture;
    readonly descriptor: Readonly<RHINormalizedTextureViewDescriptor>;
    readonly format: RHITextureFormat;
    readonly dimension: RHITextureViewDimension;
    readonly aspect: RHITextureAspect;
}

export type RHIAddressMode = 'clamp-to-edge' | 'repeat' | 'mirror-repeat';
export type RHIFilterMode = 'nearest' | 'linear';
export type RHIMipmapFilterMode = 'nearest' | 'linear';
export type RHICompareFunction =
    | 'never'
    | 'less'
    | 'equal'
    | 'less-equal'
    | 'greater'
    | 'not-equal'
    | 'greater-equal'
    | 'always';

export interface RHISamplerDescriptor extends RHIResourceDescriptorBase {
    readonly addressModeU?: RHIAddressMode;
    readonly addressModeV?: RHIAddressMode;
    readonly addressModeW?: RHIAddressMode;
    readonly magFilter?: RHIFilterMode;
    readonly minFilter?: RHIFilterMode;
    readonly mipmapFilter?: RHIMipmapFilterMode;
    readonly lodMinClamp?: number;
    readonly lodMaxClamp?: number;
    readonly compare?: RHICompareFunction;
    readonly maxAnisotropy?: number;
}

export interface RHINormalizedSamplerDescriptor {
    readonly label: string;
    readonly lifetime: RHIResourceLifetime;
    readonly addressModeU: RHIAddressMode;
    readonly addressModeV: RHIAddressMode;
    readonly addressModeW: RHIAddressMode;
    readonly magFilter: RHIFilterMode;
    readonly minFilter: RHIFilterMode;
    readonly mipmapFilter: RHIMipmapFilterMode;
    readonly lodMinClamp: number;
    readonly lodMaxClamp: number;
    readonly compare?: RHICompareFunction;
    readonly maxAnisotropy: number;
}

export interface RHISampler extends RHIResource {
    readonly descriptor: Readonly<RHINormalizedSamplerDescriptor>;
}

export type RHIShaderBindingKind =
    | 'uniform-buffer'
    | 'storage-buffer'
    | 'read-only-storage-buffer'
    | 'sampler'
    | 'comparison-sampler'
    | 'sampled-texture'
    | 'storage-texture';

export interface RHIShaderBindingReflection {
    readonly group: number;
    readonly binding: number;
    readonly kind: RHIShaderBindingKind;
    readonly name?: string;
    /** Logical GLSL sampler-array element. Omitted values are normalized to element zero. */
    readonly arrayIndex?: number;
    readonly minBindingSize?: number;
    /** Sampled-texture metadata emitted by the backend-neutral shader compiler. */
    readonly sampleType?: RHITextureSampleType;
    readonly viewDimension?: RHITextureViewDimension;
    readonly multisampled?: boolean;
    /** Storage-texture metadata emitted by the backend-neutral shader compiler. */
    readonly storageTextureAccess?: RHIStorageTextureAccess;
    readonly storageTextureFormat?: RHITextureFormat;
}

export interface RHIShaderVertexInputReflection {
    readonly location: number;
    readonly name?: string;
}

export interface RHIShaderFragmentOutputReflection {
    readonly location: number;
    readonly name?: string;
}

/** One WGSL pipeline override visible to portable compute-pipeline validation. */
export interface RHIShaderOverrideReflection {
    /** Pipeline constant identifier string: declaration name, or decimal `@id` value. */
    readonly name: string;
    readonly type: 'bool' | 'f16' | 'f32' | 'i32' | 'u32';
    /** Whether pipeline creation must supply a value because the declaration has no initializer. */
    readonly required: boolean;
}

/** Reflection is produced above the RHI together with the backend-specific artifact. */
export interface RHIShaderReflection {
    readonly bindings: readonly RHIShaderBindingReflection[];
    readonly vertexInputs?: readonly RHIShaderVertexInputReflection[];
    readonly fragmentOutputs?: readonly RHIShaderFragmentOutputReflection[];
    /** Resolved workgroup dimensions for a compute entry point. */
    readonly workgroupSize?: readonly [number, number, number];
    /** Statically allocated workgroup address-space bytes for a compute entry point. */
    readonly workgroupStorageSize?: number;
    /** Complete WGSL pipeline-override ABI for a compute module. */
    readonly overrides?: readonly RHIShaderOverrideReflection[];
    /** The shader source uses WGSL `f16` and requires the explicitly enabled shader-f16 feature. */
    readonly requiresF16?: boolean;
}

/** A named GLSL uniform block resolved to one portable logical binding. */
export interface RHIWebGL2PreparedUniformBlockBinding {
    readonly name: string;
    readonly group: number;
    readonly binding: number;
}

/**
 * One GLSL combined-sampler element resolved to its separate portable texture and sampler
 * bindings. `arrayIndex` is zero for a scalar sampler.
 */
export interface RHIWebGL2PreparedCombinedSamplerBinding {
    readonly name: string;
    readonly group: number;
    readonly textureBinding: number;
    readonly samplerBinding: number;
    readonly arrayIndex: number;
}

/** Backend preparation performed above the RHI; it contains no native WebGL handles or types. */
export interface RHIWebGL2PreparedShaderBindings {
    readonly uniformBlocks?: readonly RHIWebGL2PreparedUniformBlockBinding[];
    readonly combinedSamplers?: readonly RHIWebGL2PreparedCombinedSamplerBinding[];
}

interface RHIShaderArtifactBase {
    readonly backend: RHIBackend;
    readonly stage: RHIShaderStageName;
    readonly code: string | Uint32Array;
    readonly entryPoint: string;
    readonly reflection: Readonly<RHIShaderReflection>;
    readonly cacheKey: number;
}

/** Descriptor input accepts a dynamic backend while normalization creates a strict artifact. */
export interface RHIShaderArtifactInput extends RHIShaderArtifactBase {
    readonly preparedBindings?: RHIWebGL2PreparedShaderBindings;
}

/** Prepared vertex/fragment artifacts supplied to an RHI-owned internal graphics utility. */
export interface RHIGraphicsShaderArtifactInput {
    readonly vertex: Readonly<RHIShaderArtifactInput>;
    readonly fragment: Readonly<RHIShaderArtifactInput>;
}

export interface RHIWebGL2ShaderArtifact extends RHIShaderArtifactBase {
    readonly backend: 'webgl2';
    readonly code: string;
    readonly preparedBindings?: Readonly<RHIWebGL2PreparedShaderBindings>;
}

export interface RHIWebGPUShaderArtifact extends RHIShaderArtifactBase {
    readonly backend: 'webgpu';
    readonly code: string;
}

/** Backend is the discriminant; GLSL-only preparation cannot appear on normalized WebGPU data. */
export type RHIShaderArtifact = RHIWebGL2ShaderArtifact | RHIWebGPUShaderArtifact;

export interface RHIShaderDescriptor extends RHIResourceDescriptorBase {
    readonly artifact: RHIShaderArtifactInput;
}

export interface RHINormalizedShaderDescriptor {
    readonly label: string;
    readonly lifetime: RHIResourceLifetime;
    readonly artifact: RHIShaderArtifact;
}

export interface RHIShader extends RHIResource {
    readonly descriptor: Readonly<RHINormalizedShaderDescriptor>;
    readonly artifact: RHIShaderArtifact;
    readonly stage: RHIShaderStageName;
}

/** Query kinds exposed by the portable RHI. Timestamp queries remain capability-gated. */
export type RHIQueryType = 'timestamp';

export interface RHIQuerySetDescriptor extends RHIResourceDescriptorBase {
    readonly type: RHIQueryType;
    readonly count: number;
}

export interface RHINormalizedQuerySetDescriptor {
    readonly label: string;
    readonly lifetime: RHIResourceLifetime;
    readonly type: RHIQueryType;
    readonly count: number;
}

/** Device-owned query storage resolved explicitly into a QUERY_RESOLVE buffer. */
export interface RHIQuerySet extends RHIResource {
    readonly descriptor: Readonly<RHINormalizedQuerySetDescriptor>;
    readonly type: RHIQueryType;
    readonly count: number;
}

export type RHIDeviceLostReason =
    'destroyed' | 'context-lost' | 'adapter-removed' | 'reset' | 'unknown';

export interface RHIDeviceLostInfo {
    readonly reason: RHIDeviceLostReason;
    readonly message: string;
    readonly generation: number;
}

/**
 * RHI device and presentation surface are independent. A device can be used headlessly and may
 * own multiple surfaces. Device generation changes invalidate every device-owned object.
 */
export interface RHIDevice extends RHIDestroyable {
    readonly backend: RHIBackend;
    readonly capabilities: RHICapabilities;
    readonly generation: number;
    readonly lost: Promise<RHIDeviceLostInfo>;
    readonly graphicsQueue: RHIQueue;
    /** Exact vertex-input binding cache, or `null` when supplied by a higher renderer layer. */
    readonly vertexInputCacheMetrics?: Readonly<RHICacheCounters> | null;
    /** Exact render-pass attachment binding cache, when implemented by the device. */
    readonly framebufferCacheMetrics?: Readonly<RHICacheCounters> | null;

    /** Optional backend-owned native interop surface. Portable devices return no extension. */
    resolveInteropExtension?(name: string, host: RHIExecutionInteropHost): object | null;

    createBuffer(descriptor: RHIBufferDescriptor): RHIBuffer;
    createTexture(descriptor: RHITextureDescriptor): RHITexture;
    createSampler(descriptor?: RHISamplerDescriptor): RHISampler;
    createShader(descriptor: RHIShaderDescriptor): RHIShader;
    /** Create a query set or fail before native work when its feature is unavailable. */
    createQuerySet(descriptor: RHIQuerySetDescriptor): RHIQuerySet;
    createBindGroupLayout(descriptor: RHIBindGroupLayoutDescriptor): RHIBindGroupLayout;
    createPipelineLayout(descriptor: RHIPipelineLayoutDescriptor): RHIPipelineLayout;
    createBindGroup(descriptor: RHIBindGroupDescriptor): RHIBindGroup;
    createGraphicsPipeline(descriptor: RHIGraphicsPipelineDescriptor): RHIGraphicsPipeline;
    /** Create a compute pipeline or fail when compute-pipelines is unsupported. */
    createComputePipeline(descriptor: RHIComputePipelineDescriptor): RHIComputePipeline;
    createSurface(canvas: HTMLCanvasElement): RHISurface;
}
