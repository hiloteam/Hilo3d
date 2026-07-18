import type { RHITextureFormat } from './RHITypes';

/** Optional functionality. Portable graphics functionality is expressed by limits and formats. */
export type RHIFeatureName =
    | 'buffer-mapping'
    | 'texture-1d'
    | 'cube-map-arrays'
    | 'draw-base-vertex'
    | 'draw-first-instance'
    | 'indirect-draw'
    | 'storage-buffers'
    | 'storage-textures'
    | 'compute-pipelines'
    | 'shader-f16'
    | 'timestamp-query'
    | 'anisotropic-filtering'
    | 'texture-compression-bc'
    | 'texture-compression-etc2'
    | 'texture-compression-astc'
    | 'depth32float-stencil8'
    | 'float32-filterable'
    | 'float32-blendable';

/**
 * Typed device limits. A limit that only exists with an optional feature is itself optional;
 * zero is never used to mean either unknown or unsupported.
 */
export interface RHILimits {
    readonly maxTextureDimension1D?: number;
    readonly maxTextureDimension2D: number;
    readonly maxTextureDimension3D: number;
    readonly maxTextureArrayLayers: number;
    readonly maxBindGroups: number;
    readonly maxBindingsPerBindGroup: number;
    readonly maxDynamicUniformBuffersPerPipelineLayout: number;
    readonly maxDynamicStorageBuffersPerPipelineLayout?: number;
    readonly maxSampledTexturesPerShaderStage: number;
    readonly maxSamplersPerShaderStage: number;
    readonly maxUniformBuffersPerShaderStage: number;
    readonly maxUniformBufferBindingSize: number;
    readonly maxVertexBuffers: number;
    readonly maxBufferSize: number;
    readonly maxVertexAttributes: number;
    readonly maxVertexBufferArrayStride: number;
    readonly minUniformBufferOffsetAlignment: number;
    readonly maxColorAttachments: number;
    readonly maxStorageBuffersPerShaderStage?: number;
    readonly maxStorageTexturesPerShaderStage?: number;
    readonly maxStorageBufferBindingSize?: number;
    readonly minStorageBufferOffsetAlignment?: number;
    readonly maxComputeWorkgroupStorageSize?: number;
    readonly maxComputeInvocationsPerWorkgroup?: number;
    readonly maxComputeWorkgroupSizeX?: number;
    readonly maxComputeWorkgroupSizeY?: number;
    readonly maxComputeWorkgroupSizeZ?: number;
    readonly maxComputeWorkgroupsPerDimension?: number;
}

/** Immutable capabilities for one texture format on one device generation. */
export interface RHITextureFormatCapabilities {
    readonly sampled: boolean;
    readonly filterable: boolean;
    readonly renderable: boolean;
    readonly blendable: boolean;
    readonly storage: boolean;
    /** Sorted, unique render-attachment sample counts. Empty when not renderable. */
    readonly sampleCounts: readonly number[];
}

/** Capability snapshot belonging to a single device generation. */
export interface RHICapabilities {
    readonly features: ReadonlySet<RHIFeatureName>;
    readonly limits: Readonly<RHILimits>;
    getTextureFormatCapabilities(format: RHITextureFormat): RHITextureFormatCapabilities;
}

export function rhiHasFeature(capabilities: RHICapabilities, feature: RHIFeatureName): boolean {
    return capabilities.features.has(feature);
}
