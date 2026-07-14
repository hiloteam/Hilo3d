import type {
    RHIBindGroupDescriptor,
    RHIBindGroupLayoutDescriptor,
    RHIBufferDescriptor,
    RHIDevice,
    RHIDeviceLostInfo,
    RHIFeatureName,
    RHILimits,
    RHIPipelineLayoutDescriptor,
    RHIRenderPipelineDescriptor,
    RHISamplerDescriptor,
    RHIShaderModuleDescriptor,
    RHITextureDescriptor,
    RHITextureFormat,
    RHITextureFormatCapabilities,
    RHITextureViewDescriptor
} from '../RHI';
import {
    EMPTY_BIND_GROUP_LAYOUT_ENTRIES,
    WebGPUDestroyableObject,
    assertOwner,
    labelOf,
    owners,
    type WebGPURHIDiagnostics
} from './WebGPUBase';
import {
    WebGPUBindGroup,
    WebGPUBindGroupLayout,
    WebGPUPipelineLayout,
    WebGPURenderPipeline,
    nativeBindGroupEntry,
    nativeBindGroupLayoutEntry,
    nativeRenderPipelineDescriptor,
    shaderModule,
    snapshotBindGroupDescriptor,
    snapshotBindGroupLayoutDescriptor,
    snapshotPipelineLayoutDescriptor,
    snapshotRenderPipelineDescriptor
} from './WebGPUBindings';
import { WebGPUCommandEncoder, WebGPUQueue } from './WebGPUCommands';
import { textureDescriptor } from './WebGPUDescriptors';
import { renderStageStorageLimit } from './WebGPULimits';
import { getWebGPUNativeDeviceCache, type WebGPUNativeDeviceCache } from './WebGPUNativeCache';
import {
    WebGPUBuffer,
    WebGPUSampler,
    WebGPUShaderModule,
    WebGPUTexture,
    WebGPUTextureView,
    nativeSamplerDescriptor
} from './WebGPUResources';

function assertPipelineResources(
    descriptor: RHIRenderPipelineDescriptor,
    device: WebGPUDevice
): void {
    shaderModule(descriptor.vertex.module, device, 'Vertex');
    if (descriptor.fragment) shaderModule(descriptor.fragment.module, device, 'Fragment');
    if (!(descriptor.layout instanceof WebGPUPipelineLayout)) {
        throw new TypeError('Expected a WebGPU pipeline layout');
    }
    assertOwner(descriptor.layout, device, 'Pipeline layout');
}

function limitsOf(nativeLimits: GPUSupportedLimits): RHILimits & {
    readonly maxStorageBuffersPerShaderStage: number;
    readonly maxStorageTexturesPerShaderStage: number;
} {
    const maxStorageBuffersPerShaderStage = renderStageStorageLimit(nativeLimits, 'buffer').value;
    const maxStorageTexturesPerShaderStage = renderStageStorageLimit(nativeLimits, 'texture').value;
    return Object.freeze({
        maxTextureDimension1D: nativeLimits.maxTextureDimension1D,
        maxTextureDimension2D: nativeLimits.maxTextureDimension2D,
        maxTextureDimension3D: nativeLimits.maxTextureDimension3D,
        maxTextureArrayLayers: nativeLimits.maxTextureArrayLayers,
        maxBindGroups: nativeLimits.maxBindGroups,
        maxBindingsPerBindGroup: nativeLimits.maxBindingsPerBindGroup,
        maxDynamicUniformBuffersPerPipelineLayout:
            nativeLimits.maxDynamicUniformBuffersPerPipelineLayout,
        maxSampledTexturesPerShaderStage: nativeLimits.maxSampledTexturesPerShaderStage,
        maxSamplersPerShaderStage: nativeLimits.maxSamplersPerShaderStage,
        maxUniformBuffersPerShaderStage: nativeLimits.maxUniformBuffersPerShaderStage,
        maxStorageBufferBindingSize:
            maxStorageBuffersPerShaderStage > 0
                ? nativeLimit(nativeLimits, 'maxStorageBufferBindingSize')
                : 0,
        minStorageBufferOffsetAlignment:
            maxStorageBuffersPerShaderStage > 0
                ? nativeLimit(nativeLimits, 'minStorageBufferOffsetAlignment')
                : 0,
        maxUniformBufferBindingSize: nativeLimits.maxUniformBufferBindingSize,
        maxVertexBuffers: nativeLimits.maxVertexBuffers,
        maxBufferSize: nativeLimits.maxBufferSize,
        maxVertexAttributes: nativeLimits.maxVertexAttributes,
        maxVertexBufferArrayStride: nativeLimits.maxVertexBufferArrayStride,
        minUniformBufferOffsetAlignment: nativeLimits.minUniformBufferOffsetAlignment,
        maxColorAttachments: nativeLimits.maxColorAttachments,
        maxStorageBuffersPerShaderStage,
        maxStorageTexturesPerShaderStage
    });
}

function nativeLimit(limits: GPUSupportedLimits, name: keyof RHILimits): number {
    const value: unknown = Reflect.get(limits, name);
    return typeof value === 'number' ? value : 0;
}

function featuresOf(device: GPUDevice): ReadonlySet<RHIFeatureName> {
    const features = new Set<RHIFeatureName>();
    device.features.forEach(feature => {
        if (
            feature === 'texture-compression-bc' ||
            feature === 'texture-compression-etc2' ||
            feature === 'texture-compression-astc' ||
            feature === 'depth32float-stencil8' ||
            feature === 'float32-filterable'
        ) {
            features.add(feature);
        }
    });
    if (renderStageStorageLimit(device.limits, 'buffer').value > 0) {
        features.add('storage-buffers');
    }
    if (renderStageStorageLimit(device.limits, 'texture').value > 0) {
        features.add('storage-textures');
    }
    features.add('buffer-mapping');
    features.add('draw-base-vertex');
    features.add('draw-first-instance');
    if (device.limits.maxTextureDimension1D > 0) features.add('texture-1d');
    features.delete('compute-pipelines');
    return features;
}

type NativeFeatureGate =
    | GPUFeatureName
    // GPUWeb has standardized tier 2, but the DOM types may lag the specification.
    | 'texture-formats-tier2';

interface TextureFormatProfile {
    readonly requiredFeature?: NativeFeatureGate;
    readonly filterable?: true | NativeFeatureGate;
    readonly renderable?: true | NativeFeatureGate;
    readonly multisample?: true | NativeFeatureGate;
    readonly storage?: true | NativeFeatureGate;
}

const CORE_FEATURE: NativeFeatureGate = 'core-features-and-limits';
const TIER1_FEATURE: NativeFeatureGate = 'texture-formats-tier1';
const RG11B10_RENDERABLE_FEATURE: NativeFeatureGate = 'rg11b10ufloat-renderable';

/**
 * GPUWeb's texture-format table, restricted to the portable RHI format union.
 * Missing capability fields deliberately mean unsupported; this makes the query
 * conservative when GPUWeb adds a capability without a corresponding native feature.
 */
const TEXTURE_FORMAT_PROFILES = Object.freeze({
    r8unorm: { filterable: true, renderable: true, multisample: true, storage: TIER1_FEATURE },
    r8snorm: {
        filterable: true,
        renderable: TIER1_FEATURE,
        multisample: TIER1_FEATURE,
        storage: TIER1_FEATURE
    },
    r8uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r8sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r16uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r16sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r16float: { filterable: true, renderable: true, multisample: true, storage: TIER1_FEATURE },
    rg8unorm: { filterable: true, renderable: true, multisample: true, storage: TIER1_FEATURE },
    rg8snorm: {
        filterable: true,
        renderable: TIER1_FEATURE,
        multisample: TIER1_FEATURE,
        storage: TIER1_FEATURE
    },
    rg8uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg8sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    r32uint: { renderable: true, storage: true },
    r32sint: { renderable: true, storage: true },
    r32float: {
        filterable: 'float32-filterable',
        renderable: true,
        multisample: CORE_FEATURE,
        storage: true
    },
    rg16uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg16sint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg16float: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: TIER1_FEATURE
    },
    rgba8unorm: { filterable: true, renderable: true, multisample: true, storage: true },
    'rgba8unorm-srgb': { filterable: true, renderable: true, multisample: true },
    rgba8snorm: {
        filterable: true,
        renderable: TIER1_FEATURE,
        multisample: TIER1_FEATURE,
        storage: true
    },
    rgba8uint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    rgba8sint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    bgra8unorm: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: 'bgra8unorm-storage'
    },
    'bgra8unorm-srgb': {
        requiredFeature: CORE_FEATURE,
        filterable: true,
        renderable: true,
        multisample: true
    },
    rgb10a2unorm: {
        filterable: true,
        renderable: true,
        multisample: true,
        storage: TIER1_FEATURE
    },
    rgb10a2uint: { renderable: true, multisample: CORE_FEATURE, storage: TIER1_FEATURE },
    rg11b10ufloat: {
        filterable: true,
        renderable: RG11B10_RENDERABLE_FEATURE,
        multisample: RG11B10_RENDERABLE_FEATURE,
        storage: TIER1_FEATURE
    },
    rgb9e5ufloat: { filterable: true },
    rg32uint: { renderable: true, storage: CORE_FEATURE },
    rg32sint: { renderable: true, storage: CORE_FEATURE },
    rg32float: {
        filterable: 'float32-filterable',
        renderable: true,
        storage: CORE_FEATURE
    },
    rgba16uint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    rgba16sint: { renderable: true, multisample: CORE_FEATURE, storage: true },
    rgba16float: {
        filterable: true,
        renderable: true,
        multisample: CORE_FEATURE,
        storage: true
    },
    rgba32uint: { renderable: true, storage: true },
    rgba32sint: { renderable: true, storage: true },
    rgba32float: {
        filterable: 'float32-filterable',
        renderable: true,
        storage: true
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
    'etc2-rgb8unorm-srgb': {
        requiredFeature: 'texture-compression-etc2',
        filterable: true
    },
    'etc2-rgb8a1unorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'etc2-rgb8a1unorm-srgb': {
        requiredFeature: 'texture-compression-etc2',
        filterable: true
    },
    'etc2-rgba8unorm': { requiredFeature: 'texture-compression-etc2', filterable: true },
    'etc2-rgba8unorm-srgb': {
        requiredFeature: 'texture-compression-etc2',
        filterable: true
    },
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

function hasNativeFeature(features: GPUSupportedFeatures, feature: NativeFeatureGate): boolean {
    const has: unknown = Reflect.get(features, 'has');
    if (typeof has !== 'function') return false;
    const directlyEnabled = Reflect.apply(has, features, [feature]) === true;
    if (directlyEnabled) return true;
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

function textureFormatCapabilities(
    format: RHITextureFormat,
    nativeFeatures: GPUSupportedFeatures,
    storageTexturesEnabled: boolean
): RHITextureFormatCapabilities {
    const profile: TextureFormatProfile = TEXTURE_FORMAT_PROFILES[format];
    const sampled =
        profile.requiredFeature === undefined ||
        hasNativeFeature(nativeFeatures, profile.requiredFeature);
    const renderable = sampled && capabilityEnabled(profile.renderable, nativeFeatures);
    const multisample = renderable && capabilityEnabled(profile.multisample, nativeFeatures);
    return Object.freeze({
        sampled,
        filterable: sampled && capabilityEnabled(profile.filterable, nativeFeatures),
        renderable,
        storage:
            sampled && storageTexturesEnabled && capabilityEnabled(profile.storage, nativeFeatures),
        sampleCounts: renderable
            ? multisample
                ? MULTISAMPLE_COUNTS
                : SINGLE_SAMPLE_COUNT
            : NO_SAMPLE_COUNTS
    });
}

export class WebGPUDevice extends WebGPUDestroyableObject implements RHIDevice {
    readonly features: ReadonlySet<RHIFeatureName>;
    readonly limits: RHILimits & {
        readonly maxStorageBuffersPerShaderStage: number;
        readonly maxStorageTexturesPerShaderStage: number;
    };
    readonly queue: WebGPUQueue;
    readonly lost: Promise<RHIDeviceLostInfo>;
    readonly #nativeAdapter: GPUAdapter;
    readonly #nativeHandle: GPUDevice;
    readonly #diagnostics: WebGPURHIDiagnostics | null;
    readonly #nativeCache: WebGPUNativeDeviceCache;

    readonly #buffers = new WeakMap<GPUBuffer, WebGPUBuffer>();
    readonly #textures = new WeakMap<GPUTexture, WebGPUTexture>();
    readonly #textureViews = new WeakMap<GPUTextureView, WebGPUTextureView>();
    readonly #samplers = new WeakMap<GPUSampler, WebGPUSampler>();
    readonly #shaderModules = new WeakMap<GPUShaderModule, WebGPUShaderModule>();
    readonly #bindGroupLayouts = new WeakMap<GPUBindGroupLayout, WebGPUBindGroupLayout>();
    readonly #pipelineLayouts = new WeakMap<GPUPipelineLayout, WebGPUPipelineLayout>();
    readonly #bindGroups = new WeakMap<GPUBindGroup, WebGPUBindGroup>();
    readonly #renderPipelines = new WeakMap<GPURenderPipeline, WebGPURenderPipeline>();
    readonly #textureFormatCapabilities = new Map<RHITextureFormat, RHITextureFormatCapabilities>();

    #cachesDisposed = false;

    constructor(
        nativeAdapter: GPUAdapter,
        nativeHandle: GPUDevice,
        diagnostics: WebGPURHIDiagnostics | null = null
    ) {
        super(labelOf(nativeHandle));
        this.#nativeAdapter = nativeAdapter;
        this.#nativeHandle = nativeHandle;
        this.#diagnostics = diagnostics;
        this.#nativeCache = getWebGPUNativeDeviceCache(nativeHandle, { diagnostics });
        this.features = featuresOf(nativeHandle);
        this.limits = limitsOf(nativeHandle.limits);
        this.queue = new WebGPUQueue(this, nativeHandle.queue, diagnostics);
        owners.set(this, this);
        this.lost = nativeHandle.lost.then(info => {
            this.markDestroyed();
            this.disposeCaches();
            return Object.freeze({ reason: info.reason, message: info.message });
        });
    }

    /** @internal */
    get nativeAdapter(): GPUAdapter {
        return this.#nativeAdapter;
    }

    /** @internal */
    get nativeDevice(): GPUDevice {
        return this.#nativeHandle;
    }

    /** @internal */
    get nativeHandle(): GPUDevice {
        return this.#nativeHandle;
    }

    get diagnostics(): WebGPURHIDiagnostics | null {
        return this.#diagnostics;
    }

    getTextureFormatCapabilities(format: RHITextureFormat): RHITextureFormatCapabilities {
        const cached = this.#textureFormatCapabilities.get(format);
        if (cached) return cached;
        const capabilities = textureFormatCapabilities(
            format,
            this.#nativeHandle.features,
            this.features.has('storage-textures')
        );
        this.#textureFormatCapabilities.set(format, capabilities);
        return capabilities;
    }

    /** Internal native-descriptor path shared by production WebGPU managers. */
    get nativeCache(): WebGPUNativeDeviceCache {
        return this.#nativeCache;
    }

    /** One-hop renderer fast paths. These retain native handles and never allocate RHI wrappers. */
    createNativeBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
        this.assertAlive('WebGPU device');
        return this.#nativeHandle.createBuffer(descriptor);
    }

    createNativeTexture(descriptor: GPUTextureDescriptor): GPUTexture {
        this.assertAlive('WebGPU device');
        return this.#nativeHandle.createTexture(descriptor);
    }

    createNativeSampler(descriptor: GPUSamplerDescriptor = {}): GPUSampler {
        this.assertAlive('WebGPU device');
        return this.#nativeCache.createSampler(descriptor);
    }

    createNativeShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule {
        this.assertAlive('WebGPU device');
        return this.#nativeHandle.createShaderModule(descriptor);
    }

    createNativeBindGroupLayout(descriptor: GPUBindGroupLayoutDescriptor): GPUBindGroupLayout {
        this.assertAlive('WebGPU device');
        return this.#nativeCache.createBindGroupLayout(descriptor);
    }

    createNativePipelineLayout(descriptor: GPUPipelineLayoutDescriptor): GPUPipelineLayout {
        this.assertAlive('WebGPU device');
        return this.#nativeCache.createPipelineLayout(descriptor);
    }

    createNativeBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup {
        this.assertAlive('WebGPU device');
        return this.#nativeHandle.createBindGroup(descriptor);
    }

    createNativeRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline {
        this.assertAlive('WebGPU device');
        return this.#nativeCache.createRenderPipeline(descriptor);
    }

    createNativeRenderPipelineAsync(
        descriptor: GPURenderPipelineDescriptor
    ): Promise<GPURenderPipeline> {
        this.assertAlive('WebGPU device');
        return this.#nativeCache.createRenderPipelineAsync(descriptor);
    }

    getNativeRenderPipelineCacheKey(descriptor: GPURenderPipelineDescriptor): string {
        this.assertAlive('WebGPU device');
        return this.#nativeCache.getRenderPipelineCacheKey(descriptor);
    }

    createNativeCommandEncoder(descriptor: GPUCommandEncoderDescriptor = {}): GPUCommandEncoder {
        this.assertAlive('WebGPU device');
        return this.#nativeHandle.createCommandEncoder(descriptor);
    }

    submitNative(commandBuffers: readonly GPUCommandBuffer[]): void {
        this.assertAlive('WebGPU device');
        this.#nativeHandle.queue.submit(commandBuffers);
    }

    writeNativeBuffer(
        buffer: GPUBuffer,
        bufferOffset: GPUSize64,
        data: AllowSharedBufferSource,
        dataOffset?: GPUSize64,
        size?: GPUSize64
    ): void {
        this.assertAlive('WebGPU device');
        this.#nativeHandle.queue.writeBuffer(buffer, bufferOffset, data, dataOffset, size);
    }

    writeNativeTexture(
        destination: GPUTexelCopyTextureInfo,
        data: AllowSharedBufferSource,
        dataLayout: GPUTexelCopyBufferLayout,
        size: GPUExtent3D
    ): void {
        this.assertAlive('WebGPU device');
        this.#nativeHandle.queue.writeTexture(destination, data, dataLayout, size);
    }

    copyExternalImageToNativeTexture(
        source: GPUCopyExternalImageSourceInfo,
        destination: GPUCopyExternalImageDestInfo,
        copySize: GPUExtent3D
    ): void {
        this.assertAlive('WebGPU device');
        this.#nativeHandle.queue.copyExternalImageToTexture(source, destination, copySize);
    }

    onNativeSubmittedWorkDone(): Promise<void> {
        this.assertAlive('WebGPU device');
        return this.#nativeHandle.queue.onSubmittedWorkDone();
    }

    createBuffer(descriptor: RHIBufferDescriptor): WebGPUBuffer {
        this.assertAlive('WebGPU device');
        this.#diagnostics?.record('bufferCreations');
        const nativeBuffer = this.#nativeHandle.createBuffer({
            ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
            size: descriptor.size,
            usage: descriptor.usage,
            ...(descriptor.mappedAtCreation === undefined
                ? {}
                : { mappedAtCreation: descriptor.mappedAtCreation })
        });
        return this.wrapBuffer(nativeBuffer, descriptor);
    }

    /** @internal */
    wrapBuffer(nativeHandle: GPUBuffer, descriptor?: RHIBufferDescriptor): WebGPUBuffer {
        const existing = this.#buffers.get(nativeHandle);
        if (existing) return existing;
        const buffer = new WebGPUBuffer(this, nativeHandle, descriptor);
        this.#buffers.set(nativeHandle, buffer);
        return buffer;
    }

    createTexture(descriptor: RHITextureDescriptor): WebGPUTexture {
        this.assertAlive('WebGPU device');
        this.#diagnostics?.record('textureCreations');
        const nativeTexture = this.#nativeHandle.createTexture(textureDescriptor(descriptor));
        return this.wrapTexture(nativeTexture, descriptor);
    }

    /** @internal */
    wrapTexture(nativeHandle: GPUTexture, descriptor?: RHITextureDescriptor): WebGPUTexture {
        const existing = this.#textures.get(nativeHandle);
        if (existing) return existing;
        const texture = new WebGPUTexture(this, nativeHandle, descriptor);
        this.#textures.set(nativeHandle, texture);
        return texture;
    }

    /** @internal */
    wrapTextureView(
        nativeHandle: GPUTextureView,
        texture: WebGPUTexture,
        descriptor: RHITextureViewDescriptor = {}
    ): WebGPUTextureView {
        assertOwner(texture, this, 'Texture');
        const existing = this.#textureViews.get(nativeHandle);
        if (existing) return existing;
        const view = new WebGPUTextureView(this, nativeHandle, texture, descriptor);
        this.#textureViews.set(nativeHandle, view);
        return view;
    }

    createSampler(descriptor: RHISamplerDescriptor = {}): WebGPUSampler {
        this.assertAlive('WebGPU device');
        const nativeSampler = this.#nativeCache.createSampler(nativeSamplerDescriptor(descriptor));
        return this.wrapSampler(nativeSampler, descriptor);
    }

    /** @internal */
    wrapSampler(nativeHandle: GPUSampler, descriptor?: RHISamplerDescriptor): WebGPUSampler {
        const existing = this.#samplers.get(nativeHandle);
        if (existing) return existing;
        const sampler = new WebGPUSampler(this, nativeHandle, descriptor ?? {});
        this.#samplers.set(nativeHandle, sampler);
        return sampler;
    }

    createShaderModule(descriptor: RHIShaderModuleDescriptor): WebGPUShaderModule {
        this.assertAlive('WebGPU device');
        if (descriptor.language !== 'wgsl') {
            throw new TypeError('WebGPU shader modules require precompiled WGSL source');
        }
        const stage: unknown = descriptor.stage;
        if (stage !== 'vertex' && stage !== 'fragment') {
            throw new TypeError('WebGPU RHI supports only vertex and fragment shader modules');
        }
        this.#diagnostics?.record('shaderModuleCreations');
        const nativeModule = this.#nativeHandle.createShaderModule({
            ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
            code: descriptor.code
        });
        return this.wrapShaderModule(nativeModule, descriptor);
    }

    /** @internal */
    wrapShaderModule(
        nativeHandle: GPUShaderModule,
        descriptor: RHIShaderModuleDescriptor
    ): WebGPUShaderModule {
        const existing = this.#shaderModules.get(nativeHandle);
        if (existing) return existing;
        const module = new WebGPUShaderModule(this, nativeHandle, descriptor);
        this.#shaderModules.set(nativeHandle, module);
        return module;
    }

    createBindGroupLayout(descriptor: RHIBindGroupLayoutDescriptor): WebGPUBindGroupLayout {
        this.assertAlive('WebGPU device');
        const stableDescriptor = snapshotBindGroupLayoutDescriptor(descriptor);
        const nativeLayout = this.#nativeCache.createBindGroupLayout({
            ...(stableDescriptor.label === undefined ? {} : { label: stableDescriptor.label }),
            entries: stableDescriptor.entries.map(nativeBindGroupLayoutEntry)
        });
        return this.wrapBindGroupLayout(nativeLayout, stableDescriptor);
    }

    /** @internal */
    wrapBindGroupLayout(
        nativeHandle: GPUBindGroupLayout,
        descriptor?: RHIBindGroupLayoutDescriptor
    ): WebGPUBindGroupLayout {
        const stableDescriptor = snapshotBindGroupLayoutDescriptor(
            descriptor ?? { entries: EMPTY_BIND_GROUP_LAYOUT_ENTRIES }
        );
        const existing = this.#bindGroupLayouts.get(nativeHandle);
        if (existing) return existing;
        const layout = new WebGPUBindGroupLayout(this, nativeHandle, stableDescriptor);
        this.#bindGroupLayouts.set(nativeHandle, layout);
        return layout;
    }

    createPipelineLayout(descriptor: RHIPipelineLayoutDescriptor): WebGPUPipelineLayout {
        this.assertAlive('WebGPU device');
        const stableDescriptor = snapshotPipelineLayoutDescriptor(descriptor);
        const nativeLayouts = stableDescriptor.bindGroupLayouts.map(layout => {
            if (!(layout instanceof WebGPUBindGroupLayout)) {
                throw new TypeError('Expected a WebGPU bind group layout');
            }
            assertOwner(layout, this, 'Bind group layout');
            return layout.nativeHandle;
        });
        const nativeLayout = this.#nativeCache.createPipelineLayout({
            ...(stableDescriptor.label === undefined ? {} : { label: stableDescriptor.label }),
            bindGroupLayouts: nativeLayouts
        });
        return this.wrapPipelineLayout(nativeLayout, stableDescriptor);
    }

    /** @internal */
    wrapPipelineLayout(
        nativeHandle: GPUPipelineLayout,
        descriptor?: RHIPipelineLayoutDescriptor
    ): WebGPUPipelineLayout {
        const stableDescriptor = snapshotPipelineLayoutDescriptor(
            descriptor ?? { bindGroupLayouts: [] }
        );
        const existing = this.#pipelineLayouts.get(nativeHandle);
        if (existing) return existing;
        const layout = new WebGPUPipelineLayout(this, nativeHandle, stableDescriptor);
        this.#pipelineLayouts.set(nativeHandle, layout);
        return layout;
    }

    createBindGroup(descriptor: RHIBindGroupDescriptor): WebGPUBindGroup {
        this.assertAlive('WebGPU device');
        const stableDescriptor = snapshotBindGroupDescriptor(descriptor);
        if (!(stableDescriptor.layout instanceof WebGPUBindGroupLayout)) {
            throw new TypeError('Expected a WebGPU bind group layout');
        }
        assertOwner(stableDescriptor.layout, this, 'Bind group layout');
        this.#diagnostics?.record('bindGroupCreations');
        const nativeBindGroup = this.#nativeHandle.createBindGroup({
            ...(stableDescriptor.label === undefined ? {} : { label: stableDescriptor.label }),
            layout: stableDescriptor.layout.nativeHandle,
            entries: stableDescriptor.entries.map(entry => nativeBindGroupEntry(entry, this))
        });
        return this.wrapBindGroup(nativeBindGroup, stableDescriptor);
    }

    /** @internal */
    wrapBindGroup(nativeHandle: GPUBindGroup, descriptor: RHIBindGroupDescriptor): WebGPUBindGroup {
        const existing = this.#bindGroups.get(nativeHandle);
        if (existing) return existing;
        const bindGroup = new WebGPUBindGroup(this, nativeHandle, descriptor);
        this.#bindGroups.set(nativeHandle, bindGroup);
        return bindGroup;
    }

    createRenderPipeline(descriptor: RHIRenderPipelineDescriptor): WebGPURenderPipeline {
        this.assertAlive('WebGPU device');
        const stableDescriptor = snapshotRenderPipelineDescriptor(descriptor);
        assertPipelineResources(stableDescriptor, this);
        const nativeDescriptor = nativeRenderPipelineDescriptor(stableDescriptor, this);
        const nativePipeline = this.#nativeCache.createRenderPipeline(nativeDescriptor);
        return this.wrapRenderPipeline(nativePipeline, stableDescriptor);
    }

    createRenderPipelineAsync(
        descriptor: RHIRenderPipelineDescriptor
    ): Promise<WebGPURenderPipeline> {
        this.assertAlive('WebGPU device');
        const stableDescriptor = snapshotRenderPipelineDescriptor(descriptor);
        assertPipelineResources(stableDescriptor, this);
        const nativeDescriptor = nativeRenderPipelineDescriptor(stableDescriptor, this);
        return this.#nativeCache
            .createRenderPipelineAsync(nativeDescriptor)
            .then(nativePipeline => this.wrapRenderPipeline(nativePipeline, stableDescriptor));
    }

    /** @internal */
    wrapRenderPipeline(
        nativeHandle: GPURenderPipeline,
        descriptor: RHIRenderPipelineDescriptor
    ): WebGPURenderPipeline {
        const stableDescriptor = snapshotRenderPipelineDescriptor(descriptor);
        const existing = this.#renderPipelines.get(nativeHandle);
        if (existing) return existing;
        assertPipelineResources(stableDescriptor, this);
        const pipeline = new WebGPURenderPipeline(this, nativeHandle, stableDescriptor);
        this.#renderPipelines.set(nativeHandle, pipeline);
        return pipeline;
    }

    createCommandEncoder(descriptor: { readonly label?: string } = {}): WebGPUCommandEncoder {
        this.assertAlive('WebGPU device');
        this.#diagnostics?.record('commandEncoderCreations');
        const nativeEncoder = this.#nativeHandle.createCommandEncoder(
            descriptor.label === undefined ? {} : { label: descriptor.label }
        );
        return new WebGPUCommandEncoder(this, nativeEncoder, descriptor.label ?? '');
    }

    private disposeCaches(): void {
        if (this.#cachesDisposed) return;
        this.#cachesDisposed = true;
        this.#nativeCache.clear();
    }

    destroy(): void {
        const shouldDestroyNative = this.markDestroyed();
        this.disposeCaches();
        if (shouldDestroyNative) this.#nativeHandle.destroy();
    }
}
