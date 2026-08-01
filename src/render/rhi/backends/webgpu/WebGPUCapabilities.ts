import type {
    RHICapabilities,
    RHIFeatureName,
    RHILimits,
    RHITextureFormatCapabilities
} from '../../core/RHICapabilities';
import type { RHITextureFormat } from '../../core/RHITypes';

type NativeFeatureGate = GPUFeatureName | 'texture-formats-tier2';

interface TextureFormatProfile {
    readonly requiredFeature?: NativeFeatureGate;
    readonly filterable?: true | NativeFeatureGate;
    readonly renderable?: true | NativeFeatureGate;
    readonly multisample?: true | NativeFeatureGate;
    readonly storage?: true | NativeFeatureGate;
    readonly blendable?: true | NativeFeatureGate;
}

const CORE_FEATURE: NativeFeatureGate = 'core-features-and-limits';
const TIER1_FEATURE: NativeFeatureGate = 'texture-formats-tier1';
const RG11B10_RENDERABLE_FEATURE: NativeFeatureGate = 'rg11b10ufloat-renderable';

/** GPUWeb format table restricted to the portable RHI format union. */
const TEXTURE_FORMAT_PROFILES = Object.freeze({
    r8unorm: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: TIER1_FEATURE,
        blendable: true
    },
    r8snorm: {
        filterable: true,
        renderable: TIER1_FEATURE,
        multisample: TIER1_FEATURE,
        storage: TIER1_FEATURE,
        blendable: TIER1_FEATURE
    },
    r8uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r8sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r16uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r16sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r16float: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: TIER1_FEATURE,
        blendable: true
    },
    rg8unorm: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: TIER1_FEATURE,
        blendable: true
    },
    rg8snorm: {
        filterable: true,
        renderable: TIER1_FEATURE,
        multisample: TIER1_FEATURE,
        storage: TIER1_FEATURE,
        blendable: TIER1_FEATURE
    },
    rg8uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg8sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r32uint: { renderable: true, storage: true },
    r32sint: { renderable: true, storage: true },
    r32float: {
        filterable: 'float32-filterable',
        renderable: true,
        multisample: CORE_FEATURE,
        storage: true,
        blendable: 'float32-blendable'
    },
    rg16uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg16sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg16float: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: TIER1_FEATURE,
        blendable: true
    },
    rgba8unorm: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: true,
        blendable: true
    },
    'rgba8unorm-srgb': { filterable: true, renderable: true, multisample: true, blendable: true },
    rgba8snorm: {
        filterable: true,
        renderable: TIER1_FEATURE,
        multisample: TIER1_FEATURE,
        storage: true,
        blendable: TIER1_FEATURE
    },
    rgba8uint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    rgba8sint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    bgra8unorm: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: 'bgra8unorm-storage',
        blendable: true
    },
    'bgra8unorm-srgb': {
        requiredFeature: CORE_FEATURE,
        filterable: true,
        renderable: true,
        multisample: true,
        blendable: true
    },
    rgb10a2unorm: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: TIER1_FEATURE,
        blendable: true
    },
    rgb10a2uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg11b10ufloat: {
        filterable: true,
        renderable: RG11B10_RENDERABLE_FEATURE,
        multisample: RG11B10_RENDERABLE_FEATURE,
        storage: TIER1_FEATURE,
        blendable: RG11B10_RENDERABLE_FEATURE
    },
    rgb9e5ufloat: { filterable: true },
    rg32uint: { renderable: true, storage: CORE_FEATURE },
    rg32sint: { renderable: true, storage: CORE_FEATURE },
    rg32float: {
        filterable: 'float32-filterable',
        renderable: true,
        storage: CORE_FEATURE,
        blendable: 'float32-blendable'
    },
    rgba16uint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    rgba16sint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    rgba16float: {
        filterable: true,
        renderable: true,
        multisample: CORE_FEATURE,
        storage: true,
        blendable: true
    },
    rgba32uint: { renderable: true, storage: true },
    rgba32sint: { renderable: true, storage: true },
    rgba32float: {
        filterable: 'float32-filterable',
        renderable: true,
        storage: true,
        blendable: 'float32-blendable'
    },
    stencil8: { renderable: true, multisample: true },
    depth16unorm: { renderable: true, multisample: true },
    depth24plus: { renderable: true, multisample: true },
    'depth24plus-stencil8': { renderable: true, multisample: true },
    depth32float: { renderable: true, multisample: true },
    'depth32float-stencil8': {
        requiredFeature: 'depth32float-stencil8',
        renderable: true,
        multisample: true
    },
    'bc1-rgba-unorm': { requiredFeature: 'texture-compression-bc', filterable: true },
    'bc1-rgba-unorm-srgb': { requiredFeature: 'texture-compression-bc', filterable: true },
    'bc2-rgba-unorm': { requiredFeature: 'texture-compression-bc', filterable: true },
    'bc2-rgba-unorm-srgb': { requiredFeature: 'texture-compression-bc', filterable: true },
    'bc3-rgba-unorm': { requiredFeature: 'texture-compression-bc', filterable: true },
    'bc3-rgba-unorm-srgb': { requiredFeature: 'texture-compression-bc', filterable: true },
    'etc2-rgb8unorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'etc2-rgb8unorm-srgb': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'etc2-rgb8a1unorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'etc2-rgb8a1unorm-srgb': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'etc2-rgba8unorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'etc2-rgba8unorm-srgb': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'eac-r11unorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'eac-r11snorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'eac-rg11unorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'eac-rg11snorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'astc-4x4-unorm': { requiredFeature: 'texture-compression-astc', filterable: true },
    'astc-4x4-unorm-srgb': { requiredFeature: 'texture-compression-astc', filterable: true }
} as const satisfies Readonly<Record<RHITextureFormat, TextureFormatProfile>>);

const NO_SAMPLE_COUNTS: readonly number[] = Object.freeze([]);
const SINGLE_SAMPLE_COUNT: readonly number[] = Object.freeze([1]);
const MULTISAMPLE_COUNTS: readonly number[] = Object.freeze([1, 4]);

function nativeLimit(limits: GPUSupportedLimits, name: string, fallback: number): number {
    const value: unknown = Reflect.get(limits, name);
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : fallback;
}

function hasNativeFeature(features: GPUSupportedFeatures, feature: NativeFeatureGate): boolean {
    const has: unknown = Reflect.get(features, 'has');
    if (typeof has !== 'function') return false;
    if (Reflect.apply(has, features, [feature]) === true) return true;
    if (feature === TIER1_FEATURE || feature === RG11B10_RENDERABLE_FEATURE) {
        if (Reflect.apply(has, features, ['texture-formats-tier2']) === true) return true;
    }
    return (
        feature === RG11B10_RENDERABLE_FEATURE &&
        Reflect.apply(has, features, [TIER1_FEATURE]) === true
    );
}

function capabilityEnabled(
    gate: true | NativeFeatureGate | undefined,
    features: GPUSupportedFeatures
): boolean {
    return gate === true || (gate !== undefined && hasNativeFeature(features, gate));
}

function createFeatures(device: GPUDevice): ReadonlySet<RHIFeatureName> {
    const result = new Set<RHIFeatureName>([
        'buffer-mapping',
        'texture-1d',
        'cube-map-arrays',
        'draw-base-vertex',
        'draw-first-instance',
        'indirect-draw',
        'storage-buffers',
        'storage-textures',
        'compute-pipelines',
        'anisotropic-filtering'
    ]);
    const portableNativeFeatures: readonly RHIFeatureName[] = [
        'timestamp-query',
        'shader-f16',
        'subgroups',
        'texture-compression-bc',
        'texture-compression-etc2',
        'texture-compression-astc',
        'depth32float-stencil8',
        'float32-filterable',
        'float32-blendable'
    ];
    for (const feature of portableNativeFeatures) {
        if (hasNativeFeature(device.features, feature as NativeFeatureGate)) result.add(feature);
    }
    if (nativeLimit(device.limits, 'maxTextureDimension1D', 0) === 0) {
        result.delete('texture-1d');
    }
    if (nativeLimit(device.limits, 'maxStorageBuffersPerShaderStage', 0) === 0) {
        result.delete('storage-buffers');
    }
    if (nativeLimit(device.limits, 'maxStorageTexturesPerShaderStage', 0) === 0) {
        result.delete('storage-textures');
    }
    return result;
}

function adapterSubgroupSize(
    info: Pick<GPUAdapterInfo, 'subgroupMinSize' | 'subgroupMaxSize'> | undefined,
    name: 'subgroupMinSize' | 'subgroupMaxSize'
): number | undefined {
    const value = info?.[name];
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

function createLimits(
    native: GPUSupportedLimits,
    features: ReadonlySet<RHIFeatureName>,
    adapterInfo?: Pick<GPUAdapterInfo, 'subgroupMinSize' | 'subgroupMaxSize'>
): Readonly<RHILimits> {
    const maxStorageBuffersPerShaderStage = nativeLimit(
        native,
        'maxStorageBuffersPerShaderStage',
        8
    );
    const maxStorageTexturesPerShaderStage = nativeLimit(
        native,
        'maxStorageTexturesPerShaderStage',
        4
    );
    const subgroupMinSize = features.has('subgroups')
        ? adapterSubgroupSize(adapterInfo, 'subgroupMinSize')
        : undefined;
    const subgroupMaxSize = features.has('subgroups')
        ? adapterSubgroupSize(adapterInfo, 'subgroupMaxSize')
        : undefined;
    return Object.freeze({
        maxTextureDimension1D: nativeLimit(native, 'maxTextureDimension1D', 8192),
        maxTextureDimension2D: nativeLimit(native, 'maxTextureDimension2D', 8192),
        maxTextureDimension3D: nativeLimit(native, 'maxTextureDimension3D', 2048),
        maxTextureArrayLayers: nativeLimit(native, 'maxTextureArrayLayers', 256),
        maxBindGroups: nativeLimit(native, 'maxBindGroups', 4),
        maxBindingsPerBindGroup: nativeLimit(native, 'maxBindingsPerBindGroup', 1000),
        maxDynamicUniformBuffersPerPipelineLayout: nativeLimit(
            native,
            'maxDynamicUniformBuffersPerPipelineLayout',
            8
        ),
        maxDynamicStorageBuffersPerPipelineLayout: nativeLimit(
            native,
            'maxDynamicStorageBuffersPerPipelineLayout',
            4
        ),
        maxSampledTexturesPerShaderStage: nativeLimit(
            native,
            'maxSampledTexturesPerShaderStage',
            16
        ),
        maxSamplersPerShaderStage: nativeLimit(native, 'maxSamplersPerShaderStage', 16),
        maxUniformBuffersPerShaderStage: nativeLimit(native, 'maxUniformBuffersPerShaderStage', 12),
        maxUniformBufferBindingSize: nativeLimit(native, 'maxUniformBufferBindingSize', 65_536),
        maxVertexBuffers: nativeLimit(native, 'maxVertexBuffers', 8),
        maxBufferSize: nativeLimit(native, 'maxBufferSize', 268_435_456),
        maxVertexAttributes: nativeLimit(native, 'maxVertexAttributes', 16),
        maxVertexBufferArrayStride: nativeLimit(native, 'maxVertexBufferArrayStride', 2048),
        minUniformBufferOffsetAlignment: nativeLimit(
            native,
            'minUniformBufferOffsetAlignment',
            256
        ),
        maxColorAttachments: nativeLimit(native, 'maxColorAttachments', 8),
        maxStorageBuffersPerShaderStage,
        maxStorageTexturesPerShaderStage,
        maxStorageBufferBindingSize: nativeLimit(
            native,
            'maxStorageBufferBindingSize',
            134_217_728
        ),
        minStorageBufferOffsetAlignment: nativeLimit(
            native,
            'minStorageBufferOffsetAlignment',
            256
        ),
        maxComputeWorkgroupStorageSize: nativeLimit(
            native,
            'maxComputeWorkgroupStorageSize',
            16_384
        ),
        maxComputeInvocationsPerWorkgroup: nativeLimit(
            native,
            'maxComputeInvocationsPerWorkgroup',
            256
        ),
        maxComputeWorkgroupSizeX: nativeLimit(native, 'maxComputeWorkgroupSizeX', 256),
        maxComputeWorkgroupSizeY: nativeLimit(native, 'maxComputeWorkgroupSizeY', 256),
        maxComputeWorkgroupSizeZ: nativeLimit(native, 'maxComputeWorkgroupSizeZ', 64),
        maxComputeWorkgroupsPerDimension: nativeLimit(
            native,
            'maxComputeWorkgroupsPerDimension',
            65_535
        ),
        ...(subgroupMinSize === undefined ? {} : { subgroupMinSize }),
        ...(subgroupMaxSize === undefined ? {} : { subgroupMaxSize })
    });
}

export class WebGPUCapabilities implements RHICapabilities {
    readonly features: ReadonlySet<RHIFeatureName>;
    readonly limits: Readonly<RHILimits>;
    readonly #nativeFeatures: GPUSupportedFeatures;
    readonly #formatCapabilities = new Map<RHITextureFormat, RHITextureFormatCapabilities>();

    constructor(
        device: GPUDevice,
        adapterInfo?: Pick<GPUAdapterInfo, 'subgroupMinSize' | 'subgroupMaxSize'>
    ) {
        this.#nativeFeatures = device.features;
        this.features = createFeatures(device);
        this.limits = createLimits(device.limits, this.features, adapterInfo);
    }

    getTextureFormatCapabilities(format: RHITextureFormat): RHITextureFormatCapabilities {
        const cached = this.#formatCapabilities.get(format);
        if (cached !== undefined) return cached;
        const profile: TextureFormatProfile = TEXTURE_FORMAT_PROFILES[format];
        const sampled =
            profile.requiredFeature === undefined ||
            hasNativeFeature(this.#nativeFeatures, profile.requiredFeature);
        const renderable = sampled && capabilityEnabled(profile.renderable, this.#nativeFeatures);
        const multisample =
            renderable && capabilityEnabled(profile.multisample, this.#nativeFeatures);
        const result = Object.freeze({
            sampled,
            filterable: sampled && capabilityEnabled(profile.filterable, this.#nativeFeatures),
            renderable,
            blendable: renderable && capabilityEnabled(profile.blendable, this.#nativeFeatures),
            storage:
                sampled &&
                this.features.has('storage-textures') &&
                capabilityEnabled(profile.storage, this.#nativeFeatures),
            sampleCounts: renderable
                ? multisample
                    ? MULTISAMPLE_COUNTS
                    : SINGLE_SAMPLE_COUNT
                : NO_SAMPLE_COUNTS
        });
        this.#formatCapabilities.set(format, result);
        return result;
    }
}
