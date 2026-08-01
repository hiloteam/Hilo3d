import type { RHICapabilities } from './RHICapabilities';
import type {
    RHICommandContext,
    RHIComputePassEncoder,
    RHIRenderPassColorAttachment,
    RHIRenderPassDepthStencilAttachment,
    RHIRenderPassDescriptor,
    RHIRenderPassEncoder
} from './RHICommands';
import type {
    RHIBindGroupDescriptor,
    RHIBindGroupLayoutDescriptor,
    RHIBindGroupLayoutEntry,
    RHIBindingResource,
    RHIBufferBinding,
    RHIComputePipelineDescriptor,
    RHIGraphicsPipelineDescriptor,
    RHIPipelineLayout,
    RHIPipelineLayoutDescriptor,
    RHIStencilFaceState,
    RHITextureSampleType
} from './RHIPipeline';
import type {
    RHIBufferDescriptor,
    RHIDestroyable,
    RHIDevice,
    RHIDeviceOwnedObject,
    RHINormalizedBufferDescriptor,
    RHINormalizedSamplerDescriptor,
    RHINormalizedShaderDescriptor,
    RHINormalizedTextureDescriptor,
    RHINormalizedTextureViewDescriptor,
    RHIResourceLifetime,
    RHISamplerDescriptor,
    RHIShaderArtifact,
    RHIShader,
    RHIShaderDescriptor,
    RHIShaderReflection,
    RHIShaderBindingReflection,
    RHIShaderOverrideReflection,
    RHITexture,
    RHITextureDescriptor,
    RHITextureViewDescriptor,
    RHITextureView,
    RHIWebGL2PreparedShaderBindings
} from './RHIResources';
import type { RHINormalizedSurfaceConfiguration, RHISurfaceConfiguration } from './RHISurface';
import {
    RHIBufferUsage,
    RHIColorWrite,
    RHIShaderStage,
    RHITextureUsage,
    type RHIColor,
    type RHIDataSource,
    type RHILoadOp,
    type RHIStoreOp,
    type RHITextureFormat,
    type RHITextureViewDimension
} from './RHITypes';

export type RHIValidationErrorCode =
    | 'destroyed-object'
    | 'incompatible-layout'
    | 'invalid-descriptor'
    | 'invalid-state'
    | 'out-of-bounds'
    | 'stale-generation'
    | 'unsupported-feature'
    | 'unsupported-format'
    | 'wrong-device';

/** Error thrown before native execution when a portable RHI contract is violated. */
export class RHIValidationError extends Error {
    readonly code: RHIValidationErrorCode;
    readonly path: string;

    constructor(code: RHIValidationErrorCode, message: string, path = '') {
        super(path === '' ? message : `${path}: ${message}`);
        this.name = 'RHIValidationError';
        this.code = code;
        this.path = path;
    }
}

function fail(code: RHIValidationErrorCode, message: string, path: string): never {
    throw new RHIValidationError(code, message, path);
}

function positiveInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
        fail('invalid-descriptor', 'must be a positive safe integer', path);
    }
}

function nonNegativeInteger(value: number, path: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail('invalid-descriptor', 'must be a non-negative safe integer', path);
    }
}

function finiteNumber(value: number, path: string): void {
    if (!Number.isFinite(value)) {
        fail('invalid-descriptor', 'must be finite', path);
    }
}

const PORTABLE_WGSL_IDENTIFIER = /^[A-Za-z_]\w*$/u;

function validPipelineConstantIdentifier(value: string): boolean {
    if (PORTABLE_WGSL_IDENTIFIER.test(value)) return true;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return false;
    const id = Number(value);
    return Number.isSafeInteger(id) && id <= 65_535;
}

function normalizedLabel(label: string | undefined): string {
    return label ?? '';
}

function normalizedLifetime(lifetime: RHIResourceLifetime | undefined): RHIResourceLifetime {
    return lifetime ?? 'persistent';
}

/** Copy creation data so later caller mutations cannot affect resource initialization. */
export function snapshotRHIDataSource(data: RHIDataSource): Uint8Array {
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data.slice(0));
    }
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
}

function hasDestroyedState(
    object: RHIDeviceOwnedObject
): object is RHIDeviceOwnedObject & RHIDestroyable {
    return 'destroyed' in object;
}

/** Validate identity, ownership, generation, and logical destruction before command use. */
export function assertRHIObjectOwnedBy(
    device: RHIDevice,
    object: RHIDeviceOwnedObject,
    path = 'object'
): void {
    if (device.destroyed) {
        fail('destroyed-object', 'owner device is destroyed', path);
    }
    if (object.deviceId !== device.id) {
        fail('wrong-device', `belongs to device ${String(object.deviceId)}`, path);
    }
    if (object.deviceGeneration !== device.generation) {
        fail(
            'stale-generation',
            `belongs to generation ${String(object.deviceGeneration)}, current generation is ${String(device.generation)}`,
            path
        );
    }
    if (hasDestroyedState(object) && object.destroyed) {
        fail('destroyed-object', 'has been destroyed', path);
    }
}

/** Validate that objects can participate in the same command without needing a device reference. */
export function assertRHISameOwner(
    first: RHIDeviceOwnedObject,
    second: RHIDeviceOwnedObject,
    path = 'object'
): void {
    if (first.deviceId !== second.deviceId) {
        fail('wrong-device', 'objects belong to different devices', path);
    }
    if (first.deviceGeneration !== second.deviceGeneration) {
        fail('stale-generation', 'objects belong to different device generations', path);
    }
}

/** Context-local ownership check used by optional validation layers around backend hot paths. */
export function assertRHIObjectOwnedByContext(
    context: RHICommandContext,
    object: RHIDeviceOwnedObject,
    path = 'object'
): void {
    assertRHISameOwner(context, object, path);
    if (hasDestroyedState(object) && object.destroyed) {
        fail('destroyed-object', 'has been destroyed', path);
    }
}

export function assertRHICommandContextOpen(context: RHICommandContext): void {
    if (context.state !== 'open') {
        fail('invalid-state', `command context is ${context.state}`, 'context');
    }
}

export function assertRHIRenderPassOpen(pass: RHIRenderPassEncoder): void {
    if (pass.state !== 'open') {
        fail('invalid-state', `render pass is ${pass.state}`, 'renderPass');
    }
}

export function assertRHIComputePassOpen(pass: RHIComputePassEncoder): void {
    if (pass.state !== 'open') {
        fail('invalid-state', `compute pass is ${pass.state}`, 'computePass');
    }
}

export function normalizeRHIBufferDescriptor(
    descriptor: RHIBufferDescriptor,
    capabilities: RHICapabilities
): Readonly<RHINormalizedBufferDescriptor> {
    positiveInteger(descriptor.size, 'buffer.size');
    if (descriptor.size > capabilities.limits.maxBufferSize) {
        fail('out-of-bounds', 'exceeds maxBufferSize', 'buffer.size');
    }

    const allowedUsage =
        RHIBufferUsage.MAP_READ |
        RHIBufferUsage.MAP_WRITE |
        RHIBufferUsage.COPY_SRC |
        RHIBufferUsage.COPY_DST |
        RHIBufferUsage.INDEX |
        RHIBufferUsage.VERTEX |
        RHIBufferUsage.UNIFORM |
        RHIBufferUsage.STORAGE |
        RHIBufferUsage.INDIRECT |
        RHIBufferUsage.QUERY_RESOLVE;
    positiveInteger(descriptor.usage, 'buffer.usage');
    if ((descriptor.usage & ~allowedUsage) !== 0) {
        fail('invalid-descriptor', 'contains unknown usage flags', 'buffer.usage');
    }
    if (
        (descriptor.usage & (RHIBufferUsage.MAP_READ | RHIBufferUsage.MAP_WRITE)) !== 0 &&
        !capabilities.features.has('buffer-mapping')
    ) {
        fail('unsupported-feature', 'buffer mapping is unsupported', 'buffer.usage');
    }
    const hasMapRead = (descriptor.usage & RHIBufferUsage.MAP_READ) !== 0;
    const hasMapWrite = (descriptor.usage & RHIBufferUsage.MAP_WRITE) !== 0;
    if (
        hasMapRead &&
        (descriptor.usage & ~(RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_DST)) !== 0
    ) {
        fail('invalid-descriptor', 'MAP_READ may only be combined with COPY_DST', 'buffer.usage');
    }
    if (
        hasMapWrite &&
        (descriptor.usage & ~(RHIBufferUsage.MAP_WRITE | RHIBufferUsage.COPY_SRC)) !== 0
    ) {
        fail('invalid-descriptor', 'MAP_WRITE may only be combined with COPY_SRC', 'buffer.usage');
    }
    if (
        (descriptor.usage & RHIBufferUsage.STORAGE) !== 0 &&
        !capabilities.features.has('storage-buffers')
    ) {
        fail('unsupported-feature', 'storage buffers are unsupported', 'buffer.usage');
    }
    if (
        (descriptor.usage & RHIBufferUsage.INDIRECT) !== 0 &&
        !capabilities.features.has('indirect-draw')
    ) {
        fail('unsupported-feature', 'indirect draw is unsupported', 'buffer.usage');
    }
    if (
        descriptor.initialData !== undefined &&
        descriptor.initialData.byteLength > descriptor.size
    ) {
        fail('out-of-bounds', 'initial data exceeds buffer size', 'buffer.initialData');
    }
    if (descriptor.initialData !== undefined && descriptor.mappedAtCreation === true) {
        fail(
            'invalid-descriptor',
            'initialData and mappedAtCreation are mutually exclusive',
            'buffer'
        );
    }
    if (descriptor.mappedAtCreation === true && descriptor.size % 4 !== 0) {
        fail(
            'invalid-descriptor',
            'mapped-at-creation buffer size must be 4-byte aligned',
            'buffer.size'
        );
    }
    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        size: descriptor.size,
        usage: descriptor.usage,
        mappedAtCreation: descriptor.mappedAtCreation ?? false
    });
}

/** WebGPU-shaped buffer mapping alignment and allocation range contract shared by all backends. */
export function assertRHIBufferMapRange(
    bufferSize: number,
    offset: number,
    size: number,
    path: string
): void {
    nonNegativeInteger(offset, `${path}.offset`);
    positiveInteger(size, `${path}.size`);
    if (offset + size > bufferSize) {
        fail('out-of-bounds', 'mapped range exceeds buffer size', path);
    }
    if (offset % 8 !== 0) {
        fail('invalid-descriptor', 'mapping offset must be 8-byte aligned', `${path}.offset`);
    }
    if (size % 4 !== 0) {
        fail('invalid-descriptor', 'mapping size must be 4-byte aligned', `${path}.size`);
    }
}

/** A returned mapped range must be fully contained in the range established by mapAsync. */
export function assertRHIGetMappedRange(
    mappedOffset: number,
    mappedSize: number,
    offset: number,
    size: number,
    path = 'buffer.mappedRange'
): void {
    assertRHIBufferMapRange(mappedOffset + mappedSize, offset, size, path);
    if (offset < mappedOffset || offset + size > mappedOffset + mappedSize) {
        fail('out-of-bounds', 'requested range is outside the active mapping', path);
    }
}

export function normalizeRHITextureDescriptor(
    descriptor: RHITextureDescriptor,
    capabilities: RHICapabilities
): Readonly<RHINormalizedTextureDescriptor> {
    const dimension = descriptor.dimension ?? '2d';
    const width = descriptor.size.width;
    const height = descriptor.size.height ?? 1;
    const depthOrArrayLayers = descriptor.size.depthOrArrayLayers ?? 1;
    const viewDimension =
        descriptor.viewDimension ??
        (dimension === '1d'
            ? '1d'
            : dimension === '3d'
              ? '3d'
              : depthOrArrayLayers > 1
                ? '2d-array'
                : '2d');
    positiveInteger(width, 'texture.size.width');
    positiveInteger(height, 'texture.size.height');
    positiveInteger(depthOrArrayLayers, 'texture.size.depthOrArrayLayers');

    if (dimension === '1d') {
        if (!capabilities.features.has('texture-1d')) {
            fail('unsupported-feature', '1D textures are unsupported', 'texture.dimension');
        }
        if (height !== 1 || depthOrArrayLayers !== 1) {
            fail(
                'invalid-descriptor',
                '1D textures require height and depth to equal 1',
                'texture.size'
            );
        }
        const limit = capabilities.limits.maxTextureDimension1D;
        if (limit === undefined || width > limit) {
            fail('out-of-bounds', 'exceeds maxTextureDimension1D', 'texture.size.width');
        }
    } else if (dimension === '2d') {
        if (
            width > capabilities.limits.maxTextureDimension2D ||
            height > capabilities.limits.maxTextureDimension2D
        ) {
            fail('out-of-bounds', 'exceeds maxTextureDimension2D', 'texture.size');
        }
        if (depthOrArrayLayers > capabilities.limits.maxTextureArrayLayers) {
            fail(
                'out-of-bounds',
                'exceeds maxTextureArrayLayers',
                'texture.size.depthOrArrayLayers'
            );
        }
    } else if (
        width > capabilities.limits.maxTextureDimension3D ||
        height > capabilities.limits.maxTextureDimension3D ||
        depthOrArrayLayers > capabilities.limits.maxTextureDimension3D
    ) {
        fail('out-of-bounds', 'exceeds maxTextureDimension3D', 'texture.size');
    }

    const viewRequires2DTexture =
        viewDimension === '2d' ||
        viewDimension === '2d-array' ||
        viewDimension === 'cube' ||
        viewDimension === 'cube-array';
    if (
        (viewDimension === '1d' && dimension !== '1d') ||
        (viewRequires2DTexture && dimension !== '2d') ||
        (viewDimension === '3d' && dimension !== '3d')
    ) {
        fail(
            'invalid-descriptor',
            'view dimension is incompatible with the texture dimension',
            'texture.viewDimension'
        );
    }
    if (viewDimension === '2d' && depthOrArrayLayers !== 1) {
        fail(
            'invalid-descriptor',
            '2D textures require exactly one array layer',
            'texture.size.depthOrArrayLayers'
        );
    }
    if (viewDimension === 'cube' || viewDimension === 'cube-array') {
        if (width !== height) {
            fail('invalid-descriptor', 'cube textures require square faces', 'texture.size');
        }
        if (viewDimension === 'cube' && depthOrArrayLayers !== 6) {
            fail(
                'invalid-descriptor',
                'cube textures require exactly six array layers',
                'texture.size.depthOrArrayLayers'
            );
        }
        if (viewDimension === 'cube-array') {
            if (!capabilities.features.has('cube-map-arrays')) {
                fail(
                    'unsupported-feature',
                    'cube-map arrays are unsupported',
                    'texture.viewDimension'
                );
            }
            if (depthOrArrayLayers % 6 !== 0) {
                fail(
                    'invalid-descriptor',
                    'cube-map arrays require a multiple of six array layers',
                    'texture.size.depthOrArrayLayers'
                );
            }
        }
    }

    const allowedUsage =
        RHITextureUsage.COPY_SRC |
        RHITextureUsage.COPY_DST |
        RHITextureUsage.TEXTURE_BINDING |
        RHITextureUsage.STORAGE_BINDING |
        RHITextureUsage.RENDER_ATTACHMENT;
    positiveInteger(descriptor.usage, 'texture.usage');
    if ((descriptor.usage & ~allowedUsage) !== 0) {
        fail('invalid-descriptor', 'contains unknown usage flags', 'texture.usage');
    }

    const formatCapabilities = capabilities.getTextureFormatCapabilities(descriptor.format);
    if ((descriptor.usage & RHITextureUsage.TEXTURE_BINDING) !== 0 && !formatCapabilities.sampled) {
        fail('unsupported-format', 'format is not sampleable', 'texture.format');
    }
    if (
        (descriptor.usage & RHITextureUsage.RENDER_ATTACHMENT) !== 0 &&
        !formatCapabilities.renderable
    ) {
        fail('unsupported-format', 'format is not renderable', 'texture.format');
    }
    if ((descriptor.usage & RHITextureUsage.STORAGE_BINDING) !== 0) {
        if (!capabilities.features.has('storage-textures')) {
            fail('unsupported-feature', 'storage textures are unsupported', 'texture.usage');
        }
        if (!formatCapabilities.storage) {
            fail('unsupported-format', 'format cannot be used for storage', 'texture.format');
        }
    }

    const sampleCount = descriptor.sampleCount ?? 1;
    positiveInteger(sampleCount, 'texture.sampleCount');
    if (sampleCount !== 1 && !formatCapabilities.sampleCounts.includes(sampleCount)) {
        fail('unsupported-format', 'sample count is unsupported for format', 'texture.sampleCount');
    }
    if (
        sampleCount > 1 &&
        descriptor.mipLevelCount !== undefined &&
        descriptor.mipLevelCount !== 1
    ) {
        fail(
            'invalid-descriptor',
            'multisampled textures require one mip level',
            'texture.mipLevelCount'
        );
    }
    if (sampleCount > 1 && dimension !== '2d') {
        fail('invalid-descriptor', 'multisampling requires a 2D texture', 'texture.dimension');
    }
    if (sampleCount > 1 && depthOrArrayLayers !== 1) {
        fail(
            'invalid-descriptor',
            'multisampled textures require exactly one array layer',
            'texture.size.depthOrArrayLayers'
        );
    }
    if (sampleCount > 1 && viewDimension !== '2d') {
        fail(
            'invalid-descriptor',
            'multisampling requires a 2D view dimension',
            'texture.viewDimension'
        );
    }
    if (sampleCount > 1 && (descriptor.usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
        fail(
            'invalid-descriptor',
            'multisampling requires RENDER_ATTACHMENT usage',
            'texture.usage'
        );
    }
    if (sampleCount > 1 && (descriptor.usage & RHITextureUsage.STORAGE_BINDING) !== 0) {
        fail(
            'invalid-descriptor',
            'multisampled textures cannot be storage textures',
            'texture.usage'
        );
    }

    const mipLevelCount = descriptor.mipLevelCount ?? 1;
    positiveInteger(mipLevelCount, 'texture.mipLevelCount');
    const largestMipExtent =
        dimension === '1d'
            ? width
            : dimension === '2d'
              ? Math.max(width, height)
              : Math.max(width, height, depthOrArrayLayers);
    const maximumMipLevelCount = Math.floor(Math.log2(largestMipExtent)) + 1;
    if (mipLevelCount > maximumMipLevelCount) {
        fail('out-of-bounds', 'exceeds the texture mip chain', 'texture.mipLevelCount');
    }

    const viewFormats = Object.freeze([...(descriptor.viewFormats ?? [])]);
    if (new Set(viewFormats).size !== viewFormats.length) {
        fail('invalid-descriptor', 'contains duplicate formats', 'texture.viewFormats');
    }
    for (let index = 0; index < viewFormats.length; index += 1) {
        const viewFormat = viewFormats[index];
        if (
            viewFormat !== undefined &&
            !rhiTextureViewFormatsCompatible(descriptor.format, viewFormat)
        ) {
            fail(
                'invalid-descriptor',
                'format is not view-compatible with the texture format',
                `texture.viewFormats[${String(index)}]`
            );
        }
    }

    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        size: Object.freeze({ width, height, depthOrArrayLayers }),
        mipLevelCount,
        sampleCount,
        dimension,
        viewDimension,
        format: descriptor.format,
        usage: descriptor.usage,
        viewFormats
    });
}

/** WebGPU-compatible view-format families are singletons except for linear/sRGB pairs. */
function rhiTextureViewFormatCompatibilityKey(format: RHITextureFormat): string {
    return format.endsWith('-srgb') ? format.slice(0, -'-srgb'.length) : format;
}

function rhiTextureViewFormatsCompatible(
    textureFormat: RHITextureFormat,
    viewFormat: RHITextureFormat
): boolean {
    return (
        rhiTextureViewFormatCompatibilityKey(textureFormat) ===
        rhiTextureViewFormatCompatibilityKey(viewFormat)
    );
}

type RHITextureViewNormalizationSource = Pick<
    RHITexture,
    | 'width'
    | 'height'
    | 'depthOrArrayLayers'
    | 'mipLevelCount'
    | 'sampleCount'
    | 'dimension'
    | 'format'
> & {
    readonly descriptor: Pick<RHINormalizedTextureDescriptor, 'viewDimension' | 'viewFormats'>;
};

function defaultTextureViewArrayLayerCount(
    texture: RHITextureViewNormalizationSource,
    dimension: RHITextureViewDimension,
    baseArrayLayer: number
): number {
    if (dimension === 'cube') {
        return 6;
    }
    if (dimension === '2d-array' || dimension === 'cube-array') {
        return texture.depthOrArrayLayers - baseArrayLayer;
    }
    return 1;
}

function textureViewDimensionIsCompatible(
    textureDimension: RHITextureViewDimension,
    viewDimension: RHITextureViewDimension
): boolean {
    if (textureDimension === viewDimension) return true;
    if (textureDimension === '2d-array') return viewDimension === '2d';
    if (textureDimension === 'cube') return viewDimension === '2d';
    if (textureDimension === 'cube-array') {
        return viewDimension === 'cube' || viewDimension === '2d' || viewDimension === '2d-array';
    }
    return false;
}

function normalizeTextureViewDescriptor(
    texture: RHITextureViewNormalizationSource,
    descriptor: RHITextureViewDescriptor = {}
): Readonly<RHINormalizedTextureViewDescriptor> {
    const baseMipLevel = descriptor.baseMipLevel ?? 0;
    const baseArrayLayer = descriptor.baseArrayLayer ?? 0;
    const dimension = descriptor.dimension ?? texture.descriptor.viewDimension;
    if (!textureViewDimensionIsCompatible(texture.descriptor.viewDimension, dimension)) {
        fail(
            'invalid-descriptor',
            'view dimension cannot reinterpret the texture creation view dimension',
            'textureView.dimension'
        );
    }
    nonNegativeInteger(baseMipLevel, 'textureView.baseMipLevel');
    nonNegativeInteger(baseArrayLayer, 'textureView.baseArrayLayer');
    const mipLevelCount = descriptor.mipLevelCount ?? texture.mipLevelCount - baseMipLevel;
    const arrayLayerCount =
        descriptor.arrayLayerCount ??
        defaultTextureViewArrayLayerCount(texture, dimension, baseArrayLayer);
    positiveInteger(mipLevelCount, 'textureView.mipLevelCount');
    positiveInteger(arrayLayerCount, 'textureView.arrayLayerCount');
    if (baseMipLevel + mipLevelCount > texture.mipLevelCount) {
        fail('out-of-bounds', 'mip range exceeds texture', 'textureView.mipLevelCount');
    }
    if (baseArrayLayer + arrayLayerCount > texture.depthOrArrayLayers) {
        fail('out-of-bounds', 'array range exceeds texture', 'textureView.arrayLayerCount');
    }

    const format = descriptor.format ?? texture.format;
    if (format !== texture.format && !texture.descriptor.viewFormats.includes(format)) {
        fail('invalid-descriptor', 'format was not declared in viewFormats', 'textureView.format');
    }
    if (!rhiTextureViewFormatsCompatible(texture.format, format)) {
        fail(
            'invalid-descriptor',
            'format is not view-compatible with the texture format',
            'textureView.format'
        );
    }

    if (texture.dimension === '1d' && dimension !== '1d') {
        fail('invalid-descriptor', '1D texture requires a 1D view', 'textureView.dimension');
    }
    if (
        texture.dimension === '2d' &&
        dimension !== '2d' &&
        dimension !== '2d-array' &&
        dimension !== 'cube' &&
        dimension !== 'cube-array'
    ) {
        fail(
            'invalid-descriptor',
            '2D texture requires a 2D, array, or cube view',
            'textureView.dimension'
        );
    }
    if (texture.dimension === '3d' && dimension !== '3d') {
        fail('invalid-descriptor', '3D texture requires a 3D view', 'textureView.dimension');
    }

    if (dimension === '1d' && (baseArrayLayer !== 0 || arrayLayerCount !== 1)) {
        fail('invalid-descriptor', '1D views select exactly one layer', 'textureView');
    }
    if (dimension === '2d' && arrayLayerCount !== 1) {
        fail('invalid-descriptor', '2D views select exactly one array layer', 'textureView');
    }
    if (dimension === '3d' && (baseArrayLayer !== 0 || arrayLayerCount !== 1)) {
        fail('invalid-descriptor', '3D views do not select array layers', 'textureView');
    }
    if (dimension === 'cube' || dimension === 'cube-array') {
        if (texture.width !== texture.height) {
            fail('invalid-descriptor', 'cube views require square texture faces', 'textureView');
        }
        if (arrayLayerCount % 6 !== 0) {
            fail(
                'invalid-descriptor',
                'cube views require a multiple of six layers',
                'textureView'
            );
        }
        if (dimension === 'cube' && arrayLayerCount !== 6) {
            fail('invalid-descriptor', 'a cube view requires exactly six layers', 'textureView');
        }
        if (texture.descriptor.viewDimension === 'cube-array' && baseArrayLayer % 6 !== 0) {
            fail(
                'invalid-descriptor',
                'cube views of cube-map arrays must begin on a six-layer boundary',
                'textureView.baseArrayLayer'
            );
        }
    }
    if (
        texture.sampleCount > 1 &&
        (dimension !== '2d' || mipLevelCount !== 1 || arrayLayerCount !== 1)
    ) {
        fail(
            'invalid-descriptor',
            'multisampled texture views must select one 2D mip and layer',
            'textureView'
        );
    }

    const aspect = descriptor.aspect ?? 'all';
    if (aspect === 'depth-only' && !rhiTextureFormatHasDepth(format)) {
        fail(
            'invalid-descriptor',
            'depth-only aspect requires a depth format',
            'textureView.aspect'
        );
    }
    if (aspect === 'stencil-only' && !rhiTextureFormatHasStencil(format)) {
        fail(
            'invalid-descriptor',
            'stencil-only aspect requires a stencil format',
            'textureView.aspect'
        );
    }

    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        format,
        dimension,
        aspect,
        baseMipLevel,
        mipLevelCount,
        baseArrayLayer,
        arrayLayerCount
    });
}

/** Normalize a texture view against an already-normalized backend-neutral texture descriptor. */
export function normalizeRHITextureViewDescriptorForTextureDescriptor(
    texture: Readonly<RHINormalizedTextureDescriptor>,
    descriptor: RHITextureViewDescriptor = {}
): Readonly<RHINormalizedTextureViewDescriptor> {
    return normalizeTextureViewDescriptor(
        {
            width: texture.size.width,
            height: texture.size.height,
            depthOrArrayLayers: texture.size.depthOrArrayLayers,
            mipLevelCount: texture.mipLevelCount,
            sampleCount: texture.sampleCount,
            dimension: texture.dimension,
            format: texture.format,
            descriptor: texture
        },
        descriptor
    );
}

export function normalizeRHITextureViewDescriptor(
    texture: RHITexture,
    descriptor: RHITextureViewDescriptor = {}
): Readonly<RHINormalizedTextureViewDescriptor> {
    if (texture.destroyed) {
        fail('destroyed-object', 'texture has been destroyed', 'textureView.texture');
    }
    return normalizeTextureViewDescriptor(texture, descriptor);
}

export function normalizeRHISamplerDescriptor(
    descriptor: RHISamplerDescriptor,
    capabilities: RHICapabilities
): Readonly<RHINormalizedSamplerDescriptor> {
    const lodMinClamp = descriptor.lodMinClamp ?? 0;
    const lodMaxClamp = descriptor.lodMaxClamp ?? 32;
    const maxAnisotropy = descriptor.maxAnisotropy ?? 1;
    finiteNumber(lodMinClamp, 'sampler.lodMinClamp');
    finiteNumber(lodMaxClamp, 'sampler.lodMaxClamp');
    if (lodMinClamp < 0 || lodMaxClamp < lodMinClamp) {
        fail('invalid-descriptor', 'LOD clamps must satisfy 0 <= min <= max', 'sampler');
    }
    positiveInteger(maxAnisotropy, 'sampler.maxAnisotropy');
    if (maxAnisotropy > 1 && !capabilities.features.has('anisotropic-filtering')) {
        fail(
            'unsupported-feature',
            'anisotropic filtering is unsupported',
            'sampler.maxAnisotropy'
        );
    }
    if (
        maxAnisotropy > 1 &&
        (descriptor.magFilter !== 'linear' ||
            descriptor.minFilter !== 'linear' ||
            descriptor.mipmapFilter !== 'linear')
    ) {
        fail(
            'invalid-descriptor',
            'anisotropic filtering requires all filter modes to be linear',
            'sampler.maxAnisotropy'
        );
    }

    const normalized = {
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        addressModeU: descriptor.addressModeU ?? 'clamp-to-edge',
        addressModeV: descriptor.addressModeV ?? 'clamp-to-edge',
        addressModeW: descriptor.addressModeW ?? 'clamp-to-edge',
        magFilter: descriptor.magFilter ?? 'nearest',
        minFilter: descriptor.minFilter ?? 'nearest',
        mipmapFilter: descriptor.mipmapFilter ?? 'nearest',
        lodMinClamp,
        lodMaxClamp,
        maxAnisotropy,
        ...(descriptor.compare === undefined ? {} : { compare: descriptor.compare })
    } satisfies RHINormalizedSamplerDescriptor;
    return Object.freeze(normalized);
}

function reflectedBindingKey(group: number, binding: number): string {
    return `${String(group)}:${String(binding)}`;
}

function validatePreparedBindingName(name: string, path: string): void {
    if (typeof name !== 'string' || name.trim().length === 0) {
        fail('invalid-descriptor', 'must be a non-empty GLSL resource name', path);
    }
}

function validateWebGL2PreparedBindings(
    prepared: RHIWebGL2PreparedShaderBindings,
    reflectedBindings: ReadonlyMap<string, RHIShaderBindingReflection>
): void {
    const uniformNames = new Set<string>();
    const uniformBindings = new Set<string>();
    for (let index = 0; index < (prepared.uniformBlocks?.length ?? 0); index += 1) {
        const mapping = prepared.uniformBlocks?.[index];
        if (mapping === undefined) continue;
        const path = `shader.artifact.preparedBindings.uniformBlocks[${String(index)}]`;
        validatePreparedBindingName(mapping.name, `${path}.name`);
        nonNegativeInteger(mapping.group, `${path}.group`);
        nonNegativeInteger(mapping.binding, `${path}.binding`);
        if (uniformNames.has(mapping.name)) {
            fail('invalid-descriptor', 'duplicates a GLSL uniform-block name', `${path}.name`);
        }
        uniformNames.add(mapping.name);
        const bindingKey = reflectedBindingKey(mapping.group, mapping.binding);
        if (uniformBindings.has(bindingKey)) {
            fail('invalid-descriptor', 'duplicates a logical uniform binding', `${path}.binding`);
        }
        uniformBindings.add(bindingKey);
        if (reflectedBindings.get(bindingKey)?.kind !== 'uniform-buffer') {
            fail('invalid-descriptor', 'must reference a reflected uniform-buffer binding', path);
        }
    }

    const combinedSamplerElements = new Set<string>();
    for (let index = 0; index < (prepared.combinedSamplers?.length ?? 0); index += 1) {
        const mapping = prepared.combinedSamplers?.[index];
        if (mapping === undefined) continue;
        const path = `shader.artifact.preparedBindings.combinedSamplers[${String(index)}]`;
        validatePreparedBindingName(mapping.name, `${path}.name`);
        nonNegativeInteger(mapping.group, `${path}.group`);
        nonNegativeInteger(mapping.textureBinding, `${path}.textureBinding`);
        nonNegativeInteger(mapping.samplerBinding, `${path}.samplerBinding`);
        nonNegativeInteger(mapping.arrayIndex, `${path}.arrayIndex`);
        if (mapping.textureBinding === mapping.samplerBinding) {
            fail(
                'invalid-descriptor',
                'texture and sampler bindings must be different',
                `${path}.samplerBinding`
            );
        }
        const nativeElementKey = `${mapping.name}:${String(mapping.arrayIndex)}`;
        if (combinedSamplerElements.has(nativeElementKey)) {
            fail('invalid-descriptor', 'duplicates a GLSL sampler element', path);
        }
        combinedSamplerElements.add(nativeElementKey);

        const texture = reflectedBindings.get(
            reflectedBindingKey(mapping.group, mapping.textureBinding)
        );
        if (texture?.kind !== 'sampled-texture') {
            fail(
                'invalid-descriptor',
                'must reference a reflected sampled-texture binding',
                `${path}.textureBinding`
            );
        }
        if ((texture.arrayIndex ?? 0) !== mapping.arrayIndex) {
            fail(
                'invalid-descriptor',
                'must match the reflected sampled-texture arrayIndex',
                `${path}.arrayIndex`
            );
        }
        const sampler = reflectedBindings.get(
            reflectedBindingKey(mapping.group, mapping.samplerBinding)
        );
        if (sampler?.kind !== 'sampler' && sampler?.kind !== 'comparison-sampler') {
            fail(
                'invalid-descriptor',
                'must reference a reflected sampler binding',
                `${path}.samplerBinding`
            );
        }
        if ((sampler.arrayIndex ?? 0) !== mapping.arrayIndex) {
            fail(
                'invalid-descriptor',
                'must match the reflected sampler arrayIndex',
                `${path}.arrayIndex`
            );
        }
    }
}

function snapshotWebGL2PreparedBindings(
    prepared: RHIWebGL2PreparedShaderBindings
): Readonly<RHIWebGL2PreparedShaderBindings> {
    return Object.freeze({
        ...(prepared.uniformBlocks === undefined
            ? {}
            : {
                  uniformBlocks: Object.freeze(
                      prepared.uniformBlocks.map(mapping => Object.freeze({ ...mapping }))
                  )
              }),
        ...(prepared.combinedSamplers === undefined
            ? {}
            : {
                  combinedSamplers: Object.freeze(
                      prepared.combinedSamplers.map(mapping => Object.freeze({ ...mapping }))
                  )
              })
    });
}

export function normalizeRHIShaderDescriptor(
    descriptor: RHIShaderDescriptor,
    device: RHIDevice
): Readonly<RHINormalizedShaderDescriptor> {
    const artifact = descriptor.artifact;
    if (artifact.backend !== device.backend) {
        fail(
            'invalid-descriptor',
            `artifact targets ${artifact.backend}, device uses ${device.backend}`,
            'shader.artifact.backend'
        );
    }
    if (!(['vertex', 'fragment', 'compute'] as const).includes(artifact.stage)) {
        fail('invalid-descriptor', 'has an invalid shader stage', 'shader.artifact.stage');
    }
    if (artifact.stage === 'compute' && !device.capabilities.features.has('compute-pipelines')) {
        fail('unsupported-feature', 'compute shaders are unsupported', 'shader.artifact.stage');
    }
    if (artifact.entryPoint.length === 0) {
        fail('invalid-descriptor', 'must not be empty', 'shader.artifact.entryPoint');
    }
    if (typeof artifact.code !== 'string' && !(artifact.code instanceof Uint32Array)) {
        fail('invalid-descriptor', 'must be a string or Uint32Array', 'shader.artifact.code');
    }
    if (artifact.code.length === 0) {
        fail('invalid-descriptor', 'must not be empty', 'shader.artifact.code');
    }
    if (typeof artifact.code !== 'string') {
        fail(
            'invalid-descriptor',
            artifact.backend === 'webgl2'
                ? 'GLSL backend artifacts require string code'
                : 'WGSL backend artifacts require string code',
            'shader.artifact.code'
        );
    }
    if (artifact.backend === 'webgpu' && artifact.preparedBindings !== undefined) {
        fail(
            'invalid-descriptor',
            'GLSL prepared bindings are only valid for the GLSL backend',
            'shader.artifact.preparedBindings'
        );
    }
    nonNegativeInteger(artifact.cacheKey, 'shader.artifact.cacheKey');

    const bindings = artifact.reflection.bindings;
    const seenBindings = new Set<string>();
    const reflectedBindings = new Map<string, RHIShaderBindingReflection>();
    for (let index = 0; index < bindings.length; index += 1) {
        const binding = bindings[index];
        if (binding === undefined) {
            continue;
        }
        const bindingPath = `shader.artifact.reflection.bindings[${String(index)}]`;
        nonNegativeInteger(binding.group, `${bindingPath}.group`);
        nonNegativeInteger(binding.binding, `${bindingPath}.binding`);
        if (binding.arrayIndex !== undefined) {
            nonNegativeInteger(binding.arrayIndex, `${bindingPath}.arrayIndex`);
            if (
                binding.kind !== 'sampled-texture' &&
                binding.kind !== 'sampler' &&
                binding.kind !== 'comparison-sampler'
            ) {
                fail(
                    'invalid-descriptor',
                    'is only valid for sampled-texture and sampler bindings',
                    `${bindingPath}.arrayIndex`
                );
            }
        }
        if (binding.minBindingSize !== undefined) {
            nonNegativeInteger(binding.minBindingSize, `${bindingPath}.minBindingSize`);
            if (
                binding.kind !== 'uniform-buffer' &&
                binding.kind !== 'storage-buffer' &&
                binding.kind !== 'read-only-storage-buffer'
            ) {
                fail(
                    'invalid-descriptor',
                    'is only valid for buffer bindings',
                    `${bindingPath}.minBindingSize`
                );
            }
        }
        const hasSampledTextureMetadata =
            binding.sampleType !== undefined || binding.multisampled !== undefined;
        if (hasSampledTextureMetadata && binding.kind !== 'sampled-texture') {
            fail(
                'invalid-descriptor',
                'sampleType and multisampled are only valid for sampled-texture bindings',
                bindingPath
            );
        }
        if (
            binding.viewDimension !== undefined &&
            binding.kind !== 'sampled-texture' &&
            binding.kind !== 'storage-texture'
        ) {
            fail(
                'invalid-descriptor',
                'viewDimension is only valid for texture bindings',
                `${bindingPath}.viewDimension`
            );
        }
        const hasStorageTextureMetadata =
            binding.storageTextureAccess !== undefined ||
            binding.storageTextureFormat !== undefined;
        if (hasStorageTextureMetadata && binding.kind !== 'storage-texture') {
            fail(
                'invalid-descriptor',
                'storageTextureAccess and storageTextureFormat are only valid for storage-texture bindings',
                bindingPath
            );
        }
        if (binding.kind === 'storage-texture') {
            if (binding.storageTextureAccess === undefined) {
                fail(
                    'invalid-descriptor',
                    'storage-texture reflection requires storageTextureAccess',
                    `${bindingPath}.storageTextureAccess`
                );
            }
            if (binding.storageTextureFormat === undefined) {
                fail(
                    'invalid-descriptor',
                    'storage-texture reflection requires storageTextureFormat',
                    `${bindingPath}.storageTextureFormat`
                );
            }
        }
        if (
            binding.storageTextureAccess !== undefined &&
            !(['write-only', 'read-only', 'read-write'] as const).includes(
                binding.storageTextureAccess
            )
        ) {
            fail(
                'invalid-descriptor',
                'has an invalid storage texture access',
                `${bindingPath}.storageTextureAccess`
            );
        }
        if (
            binding.sampleType !== undefined &&
            !(['float', 'unfilterable-float', 'depth', 'sint', 'uint'] as const).includes(
                binding.sampleType
            )
        ) {
            fail('invalid-descriptor', 'has an invalid sample type', `${bindingPath}.sampleType`);
        }
        if (
            binding.viewDimension !== undefined &&
            !(['1d', '2d', '2d-array', 'cube', 'cube-array', '3d'] as const).includes(
                binding.viewDimension
            )
        ) {
            fail(
                'invalid-descriptor',
                'has an invalid texture view dimension',
                `${bindingPath}.viewDimension`
            );
        }
        if (binding.multisampled !== undefined && typeof binding.multisampled !== 'boolean') {
            fail('invalid-descriptor', 'must be a boolean', `${bindingPath}.multisampled`);
        }
        const key = reflectedBindingKey(binding.group, binding.binding);
        if (seenBindings.has(key)) {
            fail('invalid-descriptor', 'contains a duplicate group/binding pair', bindingPath);
        }
        seenBindings.add(key);
        reflectedBindings.set(key, binding);
    }

    const {
        workgroupSize,
        workgroupStorageSize,
        overrides,
        requiresF16,
        vertexInputs,
        fragmentOutputs
    } = artifact.reflection;
    if (artifact.stage === 'compute') {
        if (workgroupSize === undefined) {
            fail(
                'invalid-descriptor',
                'compute shader reflection requires workgroupSize',
                'shader.artifact.reflection.workgroupSize'
            );
        }
        if (workgroupStorageSize === undefined) {
            fail(
                'invalid-descriptor',
                'compute shader reflection requires exact workgroupStorageSize',
                'shader.artifact.reflection.workgroupStorageSize'
            );
        }
        if (overrides === undefined) {
            fail(
                'invalid-descriptor',
                'compute shader reflection requires a complete overrides ABI',
                'shader.artifact.reflection.overrides'
            );
        }
        if (vertexInputs !== undefined || fragmentOutputs !== undefined) {
            fail(
                'invalid-descriptor',
                'compute shader reflection cannot declare graphics inputs or outputs',
                'shader.artifact.reflection'
            );
        }
    } else if (
        workgroupSize !== undefined ||
        workgroupStorageSize !== undefined ||
        overrides !== undefined
    ) {
        fail(
            'invalid-descriptor',
            'compute metadata is only valid for compute shaders',
            'shader.artifact.reflection'
        );
    }
    if (workgroupSize !== undefined) {
        const workgroupDimensionCount: unknown = Reflect.get(workgroupSize, 'length');
        if (workgroupDimensionCount !== 3) {
            fail(
                'invalid-descriptor',
                'must contain exactly three dimensions',
                'shader.artifact.reflection.workgroupSize'
            );
        }
        for (let index = 0; index < 3; index += 1) {
            const dimension = workgroupSize[index];
            if (dimension !== undefined) {
                positiveInteger(
                    dimension,
                    `shader.artifact.reflection.workgroupSize[${String(index)}]`
                );
            }
        }
    }
    if (workgroupStorageSize !== undefined) {
        nonNegativeInteger(workgroupStorageSize, 'shader.artifact.reflection.workgroupStorageSize');
    }
    if (overrides !== undefined) {
        const seenOverrides = new Set<string>();
        for (let index = 0; index < overrides.length; index += 1) {
            const override = overrides[index];
            if (override === undefined) continue;
            const overridePath = `shader.artifact.reflection.overrides[${String(index)}]`;
            if (
                typeof override.name !== 'string' ||
                !validPipelineConstantIdentifier(override.name)
            ) {
                fail(
                    'invalid-descriptor',
                    'name must be a WGSL identifier or canonical numeric ID up to 65535',
                    `${overridePath}.name`
                );
            }
            if (seenOverrides.has(override.name)) {
                fail('invalid-descriptor', 'contains a duplicate override name', overridePath);
            }
            seenOverrides.add(override.name);
            if (!(['bool', 'f16', 'f32', 'i32', 'u32'] as const).includes(override.type)) {
                fail('invalid-descriptor', 'has an invalid override type', `${overridePath}.type`);
            }
            if (typeof override.required !== 'boolean') {
                fail('invalid-descriptor', 'must be a boolean', `${overridePath}.required`);
            }
        }
    }
    if (requiresF16 !== undefined && typeof requiresF16 !== 'boolean') {
        fail('invalid-descriptor', 'must be a boolean', 'shader.artifact.reflection.requiresF16');
    }
    if (requiresF16 === true && !device.capabilities.features.has('shader-f16')) {
        fail(
            'unsupported-feature',
            'WGSL f16 requires the shader-f16 device feature',
            'shader.artifact.reflection.requiresF16'
        );
    }
    if (artifact.stage !== 'vertex' && vertexInputs !== undefined) {
        fail(
            'invalid-descriptor',
            'vertexInputs are only valid for vertex shaders',
            'shader.artifact.reflection.vertexInputs'
        );
    }
    if (artifact.stage !== 'fragment' && fragmentOutputs !== undefined) {
        fail(
            'invalid-descriptor',
            'fragmentOutputs are only valid for fragment shaders',
            'shader.artifact.reflection.fragmentOutputs'
        );
    }

    if (artifact.backend === 'webgl2' && artifact.preparedBindings !== undefined) {
        validateWebGL2PreparedBindings(artifact.preparedBindings, reflectedBindings);
    }

    const reflection: RHIShaderReflection = Object.freeze({
        bindings: Object.freeze(
            artifact.reflection.bindings.map(binding => Object.freeze({ ...binding }))
        ),
        ...(artifact.reflection.vertexInputs === undefined
            ? {}
            : {
                  vertexInputs: Object.freeze(
                      artifact.reflection.vertexInputs.map(input => Object.freeze({ ...input }))
                  )
              }),
        ...(artifact.reflection.fragmentOutputs === undefined
            ? {}
            : {
                  fragmentOutputs: Object.freeze(
                      artifact.reflection.fragmentOutputs.map(output =>
                          Object.freeze({ ...output })
                      )
                  )
              }),
        ...(workgroupSize === undefined
            ? {}
            : {
                  workgroupSize: Object.freeze([
                      workgroupSize[0],
                      workgroupSize[1],
                      workgroupSize[2]
                  ] satisfies [number, number, number])
              }),
        ...(workgroupStorageSize === undefined ? {} : { workgroupStorageSize }),
        ...(overrides === undefined
            ? {}
            : {
                  overrides: Object.freeze(
                      overrides.map(override => Object.freeze({ ...override }))
                  )
              }),
        ...(requiresF16 === undefined ? {} : { requiresF16 })
    });
    const commonArtifact = {
        stage: artifact.stage,
        entryPoint: artifact.entryPoint,
        reflection,
        cacheKey: artifact.cacheKey
    };
    const artifactSnapshot: RHIShaderArtifact =
        artifact.backend === 'webgl2'
            ? Object.freeze({
                  backend: 'webgl2',
                  ...commonArtifact,
                  code: artifact.code,
                  ...(artifact.preparedBindings === undefined
                      ? {}
                      : {
                            preparedBindings: snapshotWebGL2PreparedBindings(
                                artifact.preparedBindings
                            )
                        })
              })
            : Object.freeze({
                  backend: 'webgpu',
                  ...commonArtifact,
                  code: artifact.code
              });
    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        artifact: artifactSnapshot
    });
}

function layoutEntryKindCount(entry: RHIBindGroupLayoutEntry): number {
    return (
        Number(entry.buffer !== undefined) +
        Number(entry.sampler !== undefined) +
        Number(entry.texture !== undefined) +
        Number(entry.storageTexture !== undefined)
    );
}

export function validateRHIBindGroupLayoutDescriptor(
    descriptor: RHIBindGroupLayoutDescriptor,
    capabilities: RHICapabilities
): void {
    if (descriptor.entries.length > capabilities.limits.maxBindingsPerBindGroup) {
        fail('out-of-bounds', 'contains too many entries', 'bindGroupLayout.entries');
    }
    const bindings = new Set<number>();
    for (let index = 0; index < descriptor.entries.length; index += 1) {
        const entry = descriptor.entries[index];
        if (entry === undefined) {
            continue;
        }
        nonNegativeInteger(entry.binding, `bindGroupLayout.entries[${String(index)}].binding`);
        if (bindings.has(entry.binding)) {
            fail(
                'invalid-descriptor',
                'contains a duplicate binding',
                `bindGroupLayout.entries[${String(index)}].binding`
            );
        }
        bindings.add(entry.binding);
        if (layoutEntryKindCount(entry) !== 1) {
            fail(
                'invalid-descriptor',
                'must declare exactly one resource kind',
                `bindGroupLayout.entries[${String(index)}]`
            );
        }
        if (
            entry.visibility <= 0 ||
            (entry.visibility &
                ~(RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT | RHIShaderStage.COMPUTE)) !==
                0
        ) {
            fail(
                'invalid-descriptor',
                'contains invalid shader-stage flags',
                `bindGroupLayout.entries[${String(index)}].visibility`
            );
        }
        if (
            (entry.visibility & RHIShaderStage.COMPUTE) !== 0 &&
            !capabilities.features.has('compute-pipelines')
        ) {
            fail(
                'unsupported-feature',
                'compute shader visibility is unsupported',
                `bindGroupLayout.entries[${String(index)}].visibility`
            );
        }
        const bufferType = entry.buffer?.type ?? 'uniform';
        if (entry.buffer?.minBindingSize !== undefined) {
            nonNegativeInteger(
                entry.buffer.minBindingSize,
                `bindGroupLayout.entries[${String(index)}].buffer.minBindingSize`
            );
        }
        if (
            (bufferType === 'storage' || bufferType === 'read-only-storage') &&
            !capabilities.features.has('storage-buffers')
        ) {
            fail(
                'unsupported-feature',
                'storage buffers are unsupported',
                `bindGroupLayout.entries[${String(index)}].buffer.type`
            );
        }
        if (entry.storageTexture !== undefined && !capabilities.features.has('storage-textures')) {
            fail(
                'unsupported-feature',
                'storage textures are unsupported',
                `bindGroupLayout.entries[${String(index)}].storageTexture`
            );
        }
        if (
            entry.storageTexture !== undefined &&
            !(['write-only', 'read-only', 'read-write'] as const).includes(
                entry.storageTexture.access
            )
        ) {
            fail(
                'invalid-descriptor',
                'has an invalid access mode',
                `bindGroupLayout.entries[${String(index)}].storageTexture.access`
            );
        }
        if (
            entry.storageTexture !== undefined &&
            !capabilities.getTextureFormatCapabilities(entry.storageTexture.format).storage
        ) {
            fail(
                'unsupported-format',
                'format cannot be used as a storage texture',
                `bindGroupLayout.entries[${String(index)}].storageTexture.format`
            );
        }
    }
}

function snapshotRHIBindGroupLayoutEntry(
    entry: RHIBindGroupLayoutEntry
): Readonly<RHIBindGroupLayoutEntry> {
    return Object.freeze({
        binding: entry.binding,
        visibility: entry.visibility,
        ...(entry.buffer === undefined ? {} : { buffer: Object.freeze({ ...entry.buffer }) }),
        ...(entry.sampler === undefined ? {} : { sampler: Object.freeze({ ...entry.sampler }) }),
        ...(entry.texture === undefined ? {} : { texture: Object.freeze({ ...entry.texture }) }),
        ...(entry.storageTexture === undefined
            ? {}
            : { storageTexture: Object.freeze({ ...entry.storageTexture }) })
    });
}

/** Snapshot structural layout data without freezing any device-owned object. */
export function snapshotRHIBindGroupLayoutDescriptor(
    descriptor: RHIBindGroupLayoutDescriptor,
    capabilities: RHICapabilities
): Readonly<RHIBindGroupLayoutDescriptor> {
    validateRHIBindGroupLayoutDescriptor(descriptor, capabilities);
    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        entries: Object.freeze(descriptor.entries.map(snapshotRHIBindGroupLayoutEntry))
    });
}

interface RHIShaderStageBindingCounts {
    sampledTextures: number;
    samplers: number;
    uniformBuffers: number;
    storageBuffers: number;
    storageTextures: number;
}

function emptyRHIShaderStageBindingCounts(): RHIShaderStageBindingCounts {
    return {
        sampledTextures: 0,
        samplers: 0,
        uniformBuffers: 0,
        storageBuffers: 0,
        storageTextures: 0
    };
}

function countRHIShaderStageBinding(
    counts: RHIShaderStageBindingCounts,
    entry: RHIBindGroupLayoutEntry
): void {
    if (entry.texture !== undefined) {
        counts.sampledTextures += 1;
    } else if (entry.sampler !== undefined) {
        counts.samplers += 1;
    } else if (entry.buffer !== undefined) {
        if ((entry.buffer.type ?? 'uniform') === 'uniform') {
            counts.uniformBuffers += 1;
        } else {
            counts.storageBuffers += 1;
        }
    } else if (entry.storageTexture !== undefined) {
        counts.storageTextures += 1;
    }
}

function validateRHIShaderStageBindingLimits(
    device: RHIDevice,
    stage: 'vertex' | 'fragment' | 'compute',
    counts: RHIShaderStageBindingCounts
): void {
    const limits = device.capabilities.limits;
    const path = 'pipelineLayout.bindGroupLayouts';
    if (counts.sampledTextures > limits.maxSampledTexturesPerShaderStage) {
        fail('out-of-bounds', `${stage} stage contains too many sampled textures`, path);
    }
    if (counts.samplers > limits.maxSamplersPerShaderStage) {
        fail('out-of-bounds', `${stage} stage contains too many samplers`, path);
    }
    if (counts.uniformBuffers > limits.maxUniformBuffersPerShaderStage) {
        fail('out-of-bounds', `${stage} stage contains too many uniform buffers`, path);
    }
    if (
        counts.storageBuffers > 0 &&
        (limits.maxStorageBuffersPerShaderStage === undefined ||
            counts.storageBuffers > limits.maxStorageBuffersPerShaderStage)
    ) {
        fail('out-of-bounds', `${stage} stage contains too many storage buffers`, path);
    }
    if (
        counts.storageTextures > 0 &&
        (limits.maxStorageTexturesPerShaderStage === undefined ||
            counts.storageTextures > limits.maxStorageTexturesPerShaderStage)
    ) {
        fail('out-of-bounds', `${stage} stage contains too many storage textures`, path);
    }
}

export function validateRHIPipelineLayoutDescriptor(
    device: RHIDevice,
    descriptor: RHIPipelineLayoutDescriptor
): void {
    if (descriptor.bindGroupLayouts.length > device.capabilities.limits.maxBindGroups) {
        fail('out-of-bounds', 'contains too many bind groups', 'pipelineLayout.bindGroupLayouts');
    }
    let dynamicUniformBufferCount = 0;
    let dynamicStorageBufferCount = 0;
    const vertexCounts = emptyRHIShaderStageBindingCounts();
    const fragmentCounts = emptyRHIShaderStageBindingCounts();
    const computeCounts = emptyRHIShaderStageBindingCounts();
    for (let index = 0; index < descriptor.bindGroupLayouts.length; index += 1) {
        const layout = descriptor.bindGroupLayouts[index];
        if (layout !== undefined) {
            assertRHIObjectOwnedBy(
                device,
                layout,
                `pipelineLayout.bindGroupLayouts[${String(index)}]`
            );
            for (const entry of layout.entries) {
                if ((entry.visibility & RHIShaderStage.VERTEX) !== 0) {
                    countRHIShaderStageBinding(vertexCounts, entry);
                }
                if ((entry.visibility & RHIShaderStage.FRAGMENT) !== 0) {
                    countRHIShaderStageBinding(fragmentCounts, entry);
                }
                if ((entry.visibility & RHIShaderStage.COMPUTE) !== 0) {
                    countRHIShaderStageBinding(computeCounts, entry);
                }
                if (entry.buffer?.hasDynamicOffset === true) {
                    if ((entry.buffer.type ?? 'uniform') === 'uniform') {
                        dynamicUniformBufferCount += 1;
                    } else {
                        dynamicStorageBufferCount += 1;
                    }
                }
            }
        }
    }
    if (
        dynamicUniformBufferCount >
        device.capabilities.limits.maxDynamicUniformBuffersPerPipelineLayout
    ) {
        fail(
            'out-of-bounds',
            'contains too many dynamic uniform buffers',
            'pipelineLayout.bindGroupLayouts'
        );
    }
    if (
        dynamicStorageBufferCount > 0 &&
        (device.capabilities.limits.maxDynamicStorageBuffersPerPipelineLayout === undefined ||
            dynamicStorageBufferCount >
                device.capabilities.limits.maxDynamicStorageBuffersPerPipelineLayout)
    ) {
        fail(
            'out-of-bounds',
            'contains too many dynamic storage buffers',
            'pipelineLayout.bindGroupLayouts'
        );
    }
    validateRHIShaderStageBindingLimits(device, 'vertex', vertexCounts);
    validateRHIShaderStageBindingLimits(device, 'fragment', fragmentCounts);
    validateRHIShaderStageBindingLimits(device, 'compute', computeCounts);
}

export function snapshotRHIPipelineLayoutDescriptor(
    device: RHIDevice,
    descriptor: RHIPipelineLayoutDescriptor
): Readonly<RHIPipelineLayoutDescriptor> {
    validateRHIPipelineLayoutDescriptor(device, descriptor);
    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        bindGroupLayouts: Object.freeze([...descriptor.bindGroupLayouts])
    });
}

function bindingObject(resource: RHIBindingResource): RHIDeviceOwnedObject {
    return 'buffer' in resource ? resource.buffer : resource;
}

function rhiTextureFormatSampleClass(
    view: RHITextureView
): Exclude<RHITextureSampleType, 'unfilterable-float'> {
    if (view.aspect === 'stencil-only' || view.format === 'stencil8') {
        return 'uint';
    }
    if (rhiTextureFormatHasDepth(view.format)) {
        return 'depth';
    }
    if (view.format.endsWith('sint')) {
        return 'sint';
    }
    if (view.format.endsWith('uint')) {
        return 'uint';
    }
    return 'float';
}

function rhiTextureViewMatchesSampleType(
    device: RHIDevice,
    view: RHITextureView,
    sampleType: RHITextureSampleType
): boolean {
    const formatCapabilities = device.capabilities.getTextureFormatCapabilities(view.format);
    if (!formatCapabilities.sampled) {
        return false;
    }
    const actualClass = rhiTextureFormatSampleClass(view);
    if (sampleType === 'unfilterable-float') {
        return actualClass === 'float';
    }
    if (sampleType === 'float') {
        return actualClass === 'float' && formatCapabilities.filterable;
    }
    return sampleType === actualClass;
}

function rhiSamplerUsesFiltering(resource: Exclude<RHIBindingResource, RHIBufferBinding>): boolean {
    if ('texture' in resource) {
        return false;
    }
    return (
        resource.descriptor.magFilter === 'linear' ||
        resource.descriptor.minFilter === 'linear' ||
        resource.descriptor.mipmapFilter === 'linear' ||
        resource.descriptor.maxAnisotropy > 1
    );
}

export function validateRHIBindGroupDescriptor(
    device: RHIDevice,
    descriptor: RHIBindGroupDescriptor
): void {
    assertRHIObjectOwnedBy(device, descriptor.layout, 'bindGroup.layout');
    const layoutByBinding = new Map<number, RHIBindGroupLayoutEntry>();
    for (const entry of descriptor.layout.entries) {
        layoutByBinding.set(entry.binding, entry);
    }
    if (descriptor.entries.length !== descriptor.layout.entries.length) {
        fail('incompatible-layout', 'entry count does not match layout', 'bindGroup.entries');
    }
    const seen = new Set<number>();
    for (let index = 0; index < descriptor.entries.length; index += 1) {
        const entry = descriptor.entries[index];
        if (entry === undefined) {
            continue;
        }
        if (seen.has(entry.binding) || !layoutByBinding.has(entry.binding)) {
            fail(
                'incompatible-layout',
                'binding is duplicate or absent from layout',
                `bindGroup.entries[${String(index)}].binding`
            );
        }
        seen.add(entry.binding);
        const layoutEntry = layoutByBinding.get(entry.binding);
        if (layoutEntry === undefined) {
            fail(
                'incompatible-layout',
                'binding is absent from layout',
                `bindGroup.entries[${String(index)}].binding`
            );
        }
        assertRHIObjectOwnedBy(
            device,
            bindingObject(entry.resource),
            `bindGroup.entries[${String(index)}].resource`
        );
        if ('texture' in entry.resource) {
            assertRHIObjectOwnedBy(
                device,
                entry.resource.texture,
                `bindGroup.entries[${String(index)}].resource.texture`
            );
        }
        if (layoutEntry.buffer !== undefined) {
            if (!('buffer' in entry.resource)) {
                fail(
                    'incompatible-layout',
                    'layout requires a buffer',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            if (entry.resource.buffer.mapState !== 'unmapped') {
                fail(
                    'invalid-state',
                    `buffer is ${entry.resource.buffer.mapState}`,
                    `bindGroup.entries[${String(index)}].resource.buffer`
                );
            }
            const offset = entry.resource.offset ?? 0;
            const size = entry.resource.size ?? entry.resource.buffer.size - offset;
            nonNegativeInteger(offset, `bindGroup.entries[${String(index)}].resource.offset`);
            positiveInteger(size, `bindGroup.entries[${String(index)}].resource.size`);
            if (offset + size > entry.resource.buffer.size) {
                fail(
                    'out-of-bounds',
                    'buffer binding exceeds buffer size',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            const bufferType = layoutEntry.buffer.type ?? 'uniform';
            const requiredUsage =
                bufferType === 'uniform' ? RHIBufferUsage.UNIFORM : RHIBufferUsage.STORAGE;
            if ((entry.resource.buffer.usage & requiredUsage) === 0) {
                fail(
                    'incompatible-layout',
                    `buffer lacks required ${bufferType} usage`,
                    `bindGroup.entries[${String(index)}].resource.buffer`
                );
            }
            if (size < (layoutEntry.buffer.minBindingSize ?? 0)) {
                fail(
                    'incompatible-layout',
                    'buffer range is smaller than minBindingSize',
                    `bindGroup.entries[${String(index)}].resource.size`
                );
            }
            const alignment =
                bufferType === 'uniform'
                    ? device.capabilities.limits.minUniformBufferOffsetAlignment
                    : device.capabilities.limits.minStorageBufferOffsetAlignment;
            if (alignment !== undefined && offset % alignment !== 0) {
                fail(
                    'invalid-descriptor',
                    'buffer offset does not meet device alignment',
                    `bindGroup.entries[${String(index)}].resource.offset`
                );
            }
            const maximumBindingSize =
                bufferType === 'uniform'
                    ? device.capabilities.limits.maxUniformBufferBindingSize
                    : device.capabilities.limits.maxStorageBufferBindingSize;
            if (maximumBindingSize !== undefined && size > maximumBindingSize) {
                fail(
                    'out-of-bounds',
                    'buffer binding size exceeds device limit',
                    `bindGroup.entries[${String(index)}].resource.size`
                );
            }
        } else if (layoutEntry.sampler !== undefined) {
            if ('buffer' in entry.resource || 'texture' in entry.resource) {
                fail(
                    'incompatible-layout',
                    'layout requires a sampler',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            const comparisonRequired = (layoutEntry.sampler.type ?? 'filtering') === 'comparison';
            if (comparisonRequired !== (entry.resource.descriptor.compare !== undefined)) {
                fail(
                    'incompatible-layout',
                    comparisonRequired
                        ? 'layout requires a comparison sampler'
                        : 'layout requires a non-comparison sampler',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            if (
                (layoutEntry.sampler.type ?? 'filtering') === 'non-filtering' &&
                rhiSamplerUsesFiltering(entry.resource)
            ) {
                fail(
                    'incompatible-layout',
                    'layout requires a non-filtering sampler',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
        } else if (layoutEntry.texture !== undefined) {
            if (!('texture' in entry.resource) || 'buffer' in entry.resource) {
                fail(
                    'incompatible-layout',
                    'layout requires a sampled texture view',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            if ((entry.resource.texture.usage & RHITextureUsage.TEXTURE_BINDING) === 0) {
                fail(
                    'incompatible-layout',
                    'texture lacks TEXTURE_BINDING usage',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            const expectedSampleType = layoutEntry.texture.sampleType ?? 'float';
            if (!rhiTextureViewMatchesSampleType(device, entry.resource, expectedSampleType)) {
                fail(
                    'incompatible-layout',
                    `texture format is incompatible with ${expectedSampleType} sample type`,
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            const expectedDimension = layoutEntry.texture.viewDimension ?? '2d';
            if (entry.resource.dimension !== expectedDimension) {
                fail(
                    'incompatible-layout',
                    'texture view dimension does not match layout',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            const expectedMultisampled = layoutEntry.texture.multisampled ?? false;
            if (entry.resource.texture.sampleCount > 1 !== expectedMultisampled) {
                fail(
                    'incompatible-layout',
                    'texture sample count does not match layout',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
        } else if (layoutEntry.storageTexture !== undefined) {
            if (!('texture' in entry.resource) || 'buffer' in entry.resource) {
                fail(
                    'incompatible-layout',
                    'layout requires a storage texture view',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            if ((entry.resource.texture.usage & RHITextureUsage.STORAGE_BINDING) === 0) {
                fail(
                    'incompatible-layout',
                    'texture lacks STORAGE_BINDING usage',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            if (!device.capabilities.getTextureFormatCapabilities(entry.resource.format).storage) {
                fail(
                    'incompatible-layout',
                    'texture view format cannot be used for storage',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            if (entry.resource.texture.sampleCount !== 1) {
                fail(
                    'incompatible-layout',
                    'storage textures must be single-sampled',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            if (entry.resource.format !== layoutEntry.storageTexture.format) {
                fail(
                    'incompatible-layout',
                    'storage texture format does not match layout',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
            const expectedDimension = layoutEntry.storageTexture.viewDimension ?? '2d';
            if (entry.resource.dimension !== expectedDimension) {
                fail(
                    'incompatible-layout',
                    'storage texture view dimension does not match layout',
                    `bindGroup.entries[${String(index)}].resource`
                );
            }
        }
    }
}

function snapshotRHIBindingResource(resource: RHIBindingResource): RHIBindingResource {
    if (!('buffer' in resource)) {
        return resource;
    }
    const snapshot: RHIBufferBinding = Object.freeze({
        buffer: resource.buffer,
        ...(resource.offset === undefined ? {} : { offset: resource.offset }),
        ...(resource.size === undefined ? {} : { size: resource.size })
    });
    return snapshot;
}

export function snapshotRHIBindGroupDescriptor(
    device: RHIDevice,
    descriptor: RHIBindGroupDescriptor
): Readonly<RHIBindGroupDescriptor> {
    validateRHIBindGroupDescriptor(device, descriptor);
    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        layout: descriptor.layout,
        entries: Object.freeze(
            descriptor.entries.map(entry =>
                Object.freeze({
                    binding: entry.binding,
                    resource: snapshotRHIBindingResource(entry.resource)
                })
            )
        )
    });
}

function layoutEntryMatchesShaderBinding(
    entry: RHIBindGroupLayoutEntry,
    kind: RHIShader['artifact']['reflection']['bindings'][number]['kind']
): boolean {
    switch (kind) {
        case 'uniform-buffer':
            return entry.buffer !== undefined && (entry.buffer.type ?? 'uniform') === 'uniform';
        case 'storage-buffer':
            return entry.buffer?.type === 'storage';
        case 'read-only-storage-buffer':
            return entry.buffer?.type === 'read-only-storage';
        case 'sampler':
            return (
                entry.sampler !== undefined && (entry.sampler.type ?? 'filtering') !== 'comparison'
            );
        case 'comparison-sampler':
            return entry.sampler?.type === 'comparison';
        case 'sampled-texture':
            return entry.texture !== undefined;
        case 'storage-texture':
            return entry.storageTexture !== undefined;
    }
}

function validateRHIShaderAgainstPipelineLayout(
    shader: RHIShader,
    layout: RHIPipelineLayout,
    stageFlag: number,
    path: string
): void {
    for (let index = 0; index < shader.artifact.reflection.bindings.length; index += 1) {
        const reflected = shader.artifact.reflection.bindings[index];
        if (reflected === undefined) {
            continue;
        }
        const group = layout.bindGroupLayouts[reflected.group];
        if (group === undefined) {
            fail(
                'incompatible-layout',
                'shader binding group is absent from pipeline layout',
                `${path}.artifact.reflection.bindings[${String(index)}]`
            );
        }
        const entry = group.entries.find(candidate => candidate.binding === reflected.binding);
        if (entry === undefined || !layoutEntryMatchesShaderBinding(entry, reflected.kind)) {
            fail(
                'incompatible-layout',
                'shader binding is absent or has an incompatible resource kind',
                `${path}.artifact.reflection.bindings[${String(index)}]`
            );
        }
        if ((entry.visibility & stageFlag) === 0) {
            fail(
                'incompatible-layout',
                'shader stage is not visible to this binding',
                `${path}.artifact.reflection.bindings[${String(index)}]`
            );
        }
        if (
            reflected.minBindingSize !== undefined &&
            (entry.buffer?.minBindingSize ?? 0) < reflected.minBindingSize
        ) {
            fail(
                'incompatible-layout',
                'layout minBindingSize is smaller than the shader requirement',
                `${path}.artifact.reflection.bindings[${String(index)}]`
            );
        }
        if (reflected.kind === 'sampled-texture' && entry.texture !== undefined) {
            if (
                reflected.sampleType !== undefined &&
                (entry.texture.sampleType ?? 'float') !== reflected.sampleType
            ) {
                fail(
                    'incompatible-layout',
                    'layout texture sample type does not match shader reflection',
                    `${path}.artifact.reflection.bindings[${String(index)}]`
                );
            }
            if (
                reflected.viewDimension !== undefined &&
                (entry.texture.viewDimension ?? '2d') !== reflected.viewDimension
            ) {
                fail(
                    'incompatible-layout',
                    'layout texture view dimension does not match shader reflection',
                    `${path}.artifact.reflection.bindings[${String(index)}]`
                );
            }
            if (
                reflected.multisampled !== undefined &&
                (entry.texture.multisampled ?? false) !== reflected.multisampled
            ) {
                fail(
                    'incompatible-layout',
                    'layout texture sample count contract does not match shader reflection',
                    `${path}.artifact.reflection.bindings[${String(index)}]`
                );
            }
        }
        if (reflected.kind === 'storage-texture' && entry.storageTexture !== undefined) {
            if (
                reflected.storageTextureAccess !== undefined &&
                entry.storageTexture.access !== reflected.storageTextureAccess
            ) {
                fail(
                    'incompatible-layout',
                    'layout storage texture access does not match shader reflection',
                    `${path}.artifact.reflection.bindings[${String(index)}]`
                );
            }
            if (
                reflected.storageTextureFormat !== undefined &&
                entry.storageTexture.format !== reflected.storageTextureFormat
            ) {
                fail(
                    'incompatible-layout',
                    'layout storage texture format does not match shader reflection',
                    `${path}.artifact.reflection.bindings[${String(index)}]`
                );
            }
            if (
                reflected.viewDimension !== undefined &&
                (entry.storageTexture.viewDimension ?? '2d') !== reflected.viewDimension
            ) {
                fail(
                    'incompatible-layout',
                    'layout storage texture view dimension does not match shader reflection',
                    `${path}.artifact.reflection.bindings[${String(index)}]`
                );
            }
        }
    }
}

export function validateRHIGraphicsPipelineDescriptor(
    device: RHIDevice,
    descriptor: RHIGraphicsPipelineDescriptor
): void {
    assertRHIObjectOwnedBy(device, descriptor.layout, 'graphicsPipeline.layout');
    assertRHIObjectOwnedBy(device, descriptor.vertex.shader, 'graphicsPipeline.vertex.shader');
    if (descriptor.vertex.shader.stage !== 'vertex') {
        fail('invalid-descriptor', 'must use a vertex shader', 'graphicsPipeline.vertex.shader');
    }
    validateRHIShaderAgainstPipelineLayout(
        descriptor.vertex.shader,
        descriptor.layout,
        RHIShaderStage.VERTEX,
        'graphicsPipeline.vertex.shader'
    );
    const topology = descriptor.primitive.topology ?? 'triangle-list';
    const stripTopology = topology === 'line-strip' || topology === 'triangle-strip';
    if (!stripTopology && descriptor.primitive.stripIndexFormat !== undefined) {
        fail(
            'invalid-descriptor',
            'stripIndexFormat is only valid for strip topologies',
            'graphicsPipeline.primitive.stripIndexFormat'
        );
    }
    const buffers = descriptor.vertex.buffers ?? [];
    if (buffers.length > device.capabilities.limits.maxVertexBuffers) {
        fail(
            'out-of-bounds',
            'contains too many vertex buffers',
            'graphicsPipeline.vertex.buffers'
        );
    }
    let attributeCount = 0;
    const attributeLocations = new Set<number>();
    for (let index = 0; index < buffers.length; index += 1) {
        const buffer = buffers[index];
        if (buffer === null || buffer === undefined) {
            continue;
        }
        nonNegativeInteger(
            buffer.arrayStride,
            `graphicsPipeline.vertex.buffers[${String(index)}].arrayStride`
        );
        if (buffer.arrayStride > device.capabilities.limits.maxVertexBufferArrayStride) {
            fail(
                'out-of-bounds',
                'array stride exceeds device limit',
                `graphicsPipeline.vertex.buffers[${String(index)}].arrayStride`
            );
        }
        attributeCount += buffer.attributes.length;
        for (
            let attributeIndex = 0;
            attributeIndex < buffer.attributes.length;
            attributeIndex += 1
        ) {
            const attribute = buffer.attributes[attributeIndex];
            if (attribute === undefined) {
                continue;
            }
            nonNegativeInteger(
                attribute.offset,
                `graphicsPipeline.vertex.buffers[${String(index)}].attributes[${String(attributeIndex)}].offset`
            );
            nonNegativeInteger(
                attribute.shaderLocation,
                `graphicsPipeline.vertex.buffers[${String(index)}].attributes[${String(attributeIndex)}].shaderLocation`
            );
            if (attributeLocations.has(attribute.shaderLocation)) {
                fail(
                    'invalid-descriptor',
                    'contains a duplicate shader location',
                    `graphicsPipeline.vertex.buffers[${String(index)}].attributes[${String(attributeIndex)}]`
                );
            }
            attributeLocations.add(attribute.shaderLocation);
        }
    }
    if (attributeCount > device.capabilities.limits.maxVertexAttributes) {
        fail('out-of-bounds', 'contains too many vertex attributes', 'graphicsPipeline.vertex');
    }
    for (const input of descriptor.vertex.shader.artifact.reflection.vertexInputs ?? []) {
        if (!attributeLocations.has(input.location)) {
            fail(
                'incompatible-layout',
                `shader input location ${String(input.location)} is not provided`,
                'graphicsPipeline.vertex.buffers'
            );
        }
    }

    const fragment = descriptor.fragment;
    if (fragment !== undefined) {
        assertRHIObjectOwnedBy(device, fragment.shader, 'graphicsPipeline.fragment.shader');
        if (fragment.shader.stage !== 'fragment') {
            fail(
                'invalid-descriptor',
                'must use a fragment shader',
                'graphicsPipeline.fragment.shader'
            );
        }
        validateRHIShaderAgainstPipelineLayout(
            fragment.shader,
            descriptor.layout,
            RHIShaderStage.FRAGMENT,
            'graphicsPipeline.fragment.shader'
        );
        if (fragment.targets.length > device.capabilities.limits.maxColorAttachments) {
            fail(
                'out-of-bounds',
                'contains too many color targets',
                'graphicsPipeline.fragment.targets'
            );
        }
        for (let index = 0; index < fragment.targets.length; index += 1) {
            const target = fragment.targets[index];
            if (target === null || target === undefined) {
                continue;
            }
            const format = device.capabilities.getTextureFormatCapabilities(target.format);
            if (
                rhiTextureFormatHasDepth(target.format) ||
                rhiTextureFormatHasStencil(target.format)
            ) {
                fail(
                    'invalid-descriptor',
                    'color target requires a color format',
                    `graphicsPipeline.fragment.targets[${String(index)}].format`
                );
            }
            if (!format.renderable) {
                fail(
                    'unsupported-format',
                    'target format is not renderable',
                    `graphicsPipeline.fragment.targets[${String(index)}].format`
                );
            }
            if (target.blend !== undefined && !format.blendable) {
                fail(
                    'unsupported-format',
                    'target format is not blendable',
                    `graphicsPipeline.fragment.targets[${String(index)}].blend`
                );
            }
            const writeMask = target.writeMask ?? RHIColorWrite.ALL;
            nonNegativeInteger(
                writeMask,
                `graphicsPipeline.fragment.targets[${String(index)}].writeMask`
            );
            if ((writeMask & ~RHIColorWrite.ALL) !== 0) {
                fail(
                    'invalid-descriptor',
                    'contains invalid color write flags',
                    `graphicsPipeline.fragment.targets[${String(index)}].writeMask`
                );
            }
        }
        for (const output of fragment.shader.artifact.reflection.fragmentOutputs ?? []) {
            if (
                fragment.targets[output.location] === undefined ||
                fragment.targets[output.location] === null
            ) {
                fail(
                    'incompatible-layout',
                    `shader output location ${String(output.location)} has no color target`,
                    'graphicsPipeline.fragment.targets'
                );
            }
        }
    }

    const count = descriptor.multisample?.count ?? 1;
    positiveInteger(count, 'graphicsPipeline.multisample.count');
    if (fragment !== undefined) {
        for (let index = 0; index < fragment.targets.length; index += 1) {
            const target = fragment.targets[index];
            if (
                target !== null &&
                target !== undefined &&
                !device.capabilities
                    .getTextureFormatCapabilities(target.format)
                    .sampleCounts.includes(count)
            ) {
                fail(
                    'unsupported-format',
                    'sample count is unsupported for target format',
                    `graphicsPipeline.fragment.targets[${String(index)}]`
                );
            }
        }
    }
    if (descriptor.depthStencil !== undefined) {
        if (
            !rhiTextureFormatHasDepth(descriptor.depthStencil.format) &&
            !rhiTextureFormatHasStencil(descriptor.depthStencil.format)
        ) {
            fail(
                'invalid-descriptor',
                'depthStencil requires a depth or stencil format',
                'graphicsPipeline.depthStencil.format'
            );
        }
        const depthFormat = device.capabilities.getTextureFormatCapabilities(
            descriptor.depthStencil.format
        );
        if (!depthFormat.renderable || !depthFormat.sampleCounts.includes(count)) {
            fail(
                'unsupported-format',
                'depth/stencil format or sample count is unsupported',
                'graphicsPipeline.depthStencil.format'
            );
        }
    }
}

/**
 * Deeply snapshot pipeline state while preserving layout and shader object identities. The result
 * can be cached directly; no clone, sort, reflection, or stringify work is needed at draw time.
 */
export function snapshotRHIGraphicsPipelineDescriptor(
    device: RHIDevice,
    descriptor: RHIGraphicsPipelineDescriptor
): Readonly<RHIGraphicsPipelineDescriptor> {
    validateRHIGraphicsPipelineDescriptor(device, descriptor);
    const vertex = Object.freeze({
        shader: descriptor.vertex.shader,
        ...(descriptor.vertex.buffers === undefined
            ? {}
            : {
                  buffers: Object.freeze(
                      descriptor.vertex.buffers.map(buffer =>
                          buffer === null
                              ? null
                              : Object.freeze({
                                    arrayStride: buffer.arrayStride,
                                    ...(buffer.stepMode === undefined
                                        ? {}
                                        : { stepMode: buffer.stepMode }),
                                    attributes: Object.freeze(
                                        buffer.attributes.map(attribute =>
                                            Object.freeze({ ...attribute })
                                        )
                                    )
                                })
                      )
                  )
              })
    });
    const fragment =
        descriptor.fragment === undefined
            ? undefined
            : Object.freeze({
                  shader: descriptor.fragment.shader,
                  targets: Object.freeze(
                      descriptor.fragment.targets.map(target =>
                          target === null
                              ? null
                              : Object.freeze({
                                    format: target.format,
                                    ...(target.writeMask === undefined
                                        ? {}
                                        : { writeMask: target.writeMask }),
                                    ...(target.blend === undefined
                                        ? {}
                                        : {
                                              blend: Object.freeze({
                                                  color: Object.freeze({ ...target.blend.color }),
                                                  alpha: Object.freeze({ ...target.blend.alpha })
                                              })
                                          })
                                })
                      )
                  )
              });
    const depthStencil =
        descriptor.depthStencil === undefined
            ? undefined
            : Object.freeze({
                  ...descriptor.depthStencil,
                  ...(descriptor.depthStencil.stencilFront === undefined
                      ? {}
                      : {
                            stencilFront: Object.freeze({
                                ...descriptor.depthStencil.stencilFront
                            })
                        }),
                  ...(descriptor.depthStencil.stencilBack === undefined
                      ? {}
                      : {
                            stencilBack: Object.freeze({
                                ...descriptor.depthStencil.stencilBack
                            })
                        })
              });

    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        layout: descriptor.layout,
        vertex,
        ...(fragment === undefined ? {} : { fragment }),
        primitive: Object.freeze({ ...descriptor.primitive }),
        ...(depthStencil === undefined ? {} : { depthStencil }),
        ...(descriptor.multisample === undefined
            ? {}
            : { multisample: Object.freeze({ ...descriptor.multisample }) })
    });
}

function requireRHIComputeLimit(value: number | undefined, name: string): number {
    if (value === undefined) {
        fail(
            'unsupported-feature',
            `compute capability is missing ${name}`,
            `device.capabilities.limits.${name}`
        );
    }
    return value;
}

const MAX_F32 = 3.402_823_466_385_288_6e38;
const MIN_I32 = -0x8000_0000;
const MAX_I32 = 0x7fff_ffff;
const MAX_U32 = 0xffff_ffff;

function validateRHIOverrideConstant(
    override: Readonly<RHIShaderOverrideReflection>,
    value: number | boolean,
    path: string
): void {
    if (override.type === 'bool') {
        if (typeof value !== 'boolean') {
            fail('invalid-descriptor', 'must be a boolean for a bool override', path);
        }
        return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail('invalid-descriptor', `must be a finite number for ${override.type}`, path);
    }
    switch (override.type) {
        case 'i32':
            if (!Number.isInteger(value) || value < MIN_I32 || value > MAX_I32) {
                fail('out-of-bounds', 'must be an integer in the i32 range', path);
            }
            return;
        case 'u32':
            if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
                fail('out-of-bounds', 'must be an integer in the u32 range', path);
            }
            return;
        case 'f16':
        case 'f32':
            if (Math.abs(value) > MAX_F32) {
                fail('out-of-bounds', 'must be representable as an f32 pipeline value', path);
            }
            return;
    }
}

export function validateRHIComputePipelineDescriptor(
    device: RHIDevice,
    descriptor: RHIComputePipelineDescriptor
): void {
    if (!device.capabilities.features.has('compute-pipelines')) {
        fail('unsupported-feature', 'compute pipelines are unsupported', 'computePipeline');
    }
    assertRHIObjectOwnedBy(device, descriptor.layout, 'computePipeline.layout');
    assertRHIObjectOwnedBy(device, descriptor.compute.shader, 'computePipeline.compute.shader');
    if (descriptor.compute.shader.stage !== 'compute') {
        fail('invalid-descriptor', 'must use a compute shader', 'computePipeline.compute.shader');
    }
    validateRHIShaderAgainstPipelineLayout(
        descriptor.compute.shader,
        descriptor.layout,
        RHIShaderStage.COMPUTE,
        'computePipeline.compute.shader'
    );

    const workgroupSize = descriptor.compute.shader.artifact.reflection.workgroupSize;
    if (workgroupSize === undefined) {
        fail(
            'invalid-descriptor',
            'compute shader reflection requires workgroupSize',
            'computePipeline.compute.shader.artifact.reflection.workgroupSize'
        );
    }
    const limits = device.capabilities.limits;
    const maximumDimensions = [
        requireRHIComputeLimit(limits.maxComputeWorkgroupSizeX, 'maxComputeWorkgroupSizeX'),
        requireRHIComputeLimit(limits.maxComputeWorkgroupSizeY, 'maxComputeWorkgroupSizeY'),
        requireRHIComputeLimit(limits.maxComputeWorkgroupSizeZ, 'maxComputeWorkgroupSizeZ')
    ] as const;
    for (let index = 0; index < workgroupSize.length; index += 1) {
        const dimension = workgroupSize[index];
        const maximum = maximumDimensions[index];
        if (dimension !== undefined && maximum !== undefined && dimension > maximum) {
            fail(
                'out-of-bounds',
                'workgroup dimension exceeds the device limit',
                `computePipeline.compute.shader.artifact.reflection.workgroupSize[${String(index)}]`
            );
        }
    }
    const invocationCount = workgroupSize[0] * workgroupSize[1] * workgroupSize[2];
    if (
        invocationCount >
        requireRHIComputeLimit(
            limits.maxComputeInvocationsPerWorkgroup,
            'maxComputeInvocationsPerWorkgroup'
        )
    ) {
        fail(
            'out-of-bounds',
            'workgroup invocation count exceeds the device limit',
            'computePipeline.compute.shader.artifact.reflection.workgroupSize'
        );
    }
    const workgroupStorageSize = descriptor.compute.shader.artifact.reflection.workgroupStorageSize;
    if (workgroupStorageSize === undefined) {
        fail(
            'invalid-descriptor',
            'compute shader reflection requires exact workgroupStorageSize',
            'computePipeline.compute.shader.artifact.reflection.workgroupStorageSize'
        );
    }
    if (
        workgroupStorageSize >
        requireRHIComputeLimit(
            limits.maxComputeWorkgroupStorageSize,
            'maxComputeWorkgroupStorageSize'
        )
    ) {
        fail(
            'out-of-bounds',
            'workgroup storage exceeds the device limit',
            'computePipeline.compute.shader.artifact.reflection.workgroupStorageSize'
        );
    }

    const overrideABI = descriptor.compute.shader.artifact.reflection.overrides;
    if (overrideABI === undefined) {
        fail(
            'invalid-descriptor',
            'compute shader reflection requires a complete overrides ABI',
            'computePipeline.compute.shader.artifact.reflection.overrides'
        );
    }
    const overrideByName = new Map(overrideABI.map(override => [override.name, override]));
    const constants = descriptor.compute.constants ?? {};
    for (const [name, value] of Object.entries(constants)) {
        const override = overrideByName.get(name);
        if (override === undefined) {
            fail(
                'invalid-descriptor',
                'does not name a reflected pipeline override',
                `computePipeline.compute.constants.${name}`
            );
        }
        validateRHIOverrideConstant(override, value, `computePipeline.compute.constants.${name}`);
    }
    for (const override of overrideABI) {
        if (override.required && !Object.prototype.hasOwnProperty.call(constants, override.name)) {
            fail(
                'invalid-descriptor',
                'required pipeline override has no supplied value',
                `computePipeline.compute.constants.${override.name}`
            );
        }
    }
}

export function snapshotRHIComputePipelineDescriptor(
    device: RHIDevice,
    descriptor: RHIComputePipelineDescriptor
): Readonly<RHIComputePipelineDescriptor> {
    validateRHIComputePipelineDescriptor(device, descriptor);
    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        lifetime: normalizedLifetime(descriptor.lifetime),
        layout: descriptor.layout,
        compute: Object.freeze({
            shader: descriptor.compute.shader,
            ...(descriptor.compute.constants === undefined
                ? {}
                : { constants: Object.freeze({ ...descriptor.compute.constants }) })
        })
    });
}

function validateAttachmentView(view: RHITextureView, path: string): void {
    if (
        view.dimension !== '2d' ||
        view.descriptor.mipLevelCount !== 1 ||
        view.descriptor.arrayLayerCount !== 1
    ) {
        fail('invalid-descriptor', 'attachment view must select one 2D mip and layer', path);
    }
    if (view.aspect !== 'all') {
        fail('invalid-descriptor', 'attachment view must select every texture aspect', path);
    }
}

function renderPassColorPath(index: number, suffix: string): string {
    return `renderPass.colorAttachments[${String(index)}]${suffix}`;
}

/** Ownership checks whose indexed error path is constructed only on validation failure. */
function assertRenderPassColorObjectOwnedBy(
    device: RHIDevice,
    object: RHIDeviceOwnedObject,
    index: number,
    suffix: string
): void {
    if (device.destroyed) {
        fail('destroyed-object', 'owner device is destroyed', renderPassColorPath(index, suffix));
    }
    if (object.deviceId !== device.id) {
        fail(
            'wrong-device',
            `belongs to device ${String(object.deviceId)}`,
            renderPassColorPath(index, suffix)
        );
    }
    if (object.deviceGeneration !== device.generation) {
        fail(
            'stale-generation',
            `belongs to generation ${String(object.deviceGeneration)}, current generation is ${String(device.generation)}`,
            renderPassColorPath(index, suffix)
        );
    }
    if (hasDestroyedState(object) && object.destroyed) {
        fail('destroyed-object', 'has been destroyed', renderPassColorPath(index, suffix));
    }
}

function validateRenderPassColorAttachmentView(
    view: RHITextureView,
    index: number,
    suffix: string
): void {
    if (
        view.dimension !== '2d' ||
        view.descriptor.mipLevelCount !== 1 ||
        view.descriptor.arrayLayerCount !== 1
    ) {
        fail(
            'invalid-descriptor',
            'attachment view must select one 2D mip and layer',
            renderPassColorPath(index, suffix)
        );
    }
    if (view.aspect !== 'all') {
        fail(
            'invalid-descriptor',
            'attachment view must select every texture aspect',
            renderPassColorPath(index, suffix)
        );
    }
}

function validateRHIRenderPassLoadOp(value: unknown, path: string): asserts value is RHILoadOp {
    if (value !== 'load' && value !== 'clear') {
        fail('invalid-descriptor', 'must be load or clear', path);
    }
}

function validateRHIRenderPassStoreOp(value: unknown, path: string): asserts value is RHIStoreOp {
    if (value !== 'store' && value !== 'discard') {
        fail('invalid-descriptor', 'must be store or discard', path);
    }
}

function validateRHIRenderPassDepthStencilAspect(options: {
    readonly rootPath: string;
    readonly label: 'depth' | 'stencil';
    readonly hasAspect: boolean;
    readonly clearValue: unknown;
    readonly loadOp: unknown;
    readonly storeOp: unknown;
    readonly readOnly: unknown;
}): void {
    const { rootPath, label, hasAspect, clearValue, loadOp, storeOp, readOnly } = options;
    const used =
        clearValue !== undefined ||
        loadOp !== undefined ||
        storeOp !== undefined ||
        readOnly !== undefined;
    if (!hasAspect) {
        if (used) {
            fail(
                'invalid-descriptor',
                `${label} operations do not match the attachment format`,
                rootPath
            );
        }
        return;
    }
    if (readOnly !== undefined && typeof readOnly !== 'boolean') {
        fail('invalid-descriptor', 'must be a boolean', `${rootPath}.${label}ReadOnly`);
    }
    if (loadOp !== undefined) {
        validateRHIRenderPassLoadOp(loadOp, `${rootPath}.${label}LoadOp`);
    }
    if (storeOp !== undefined) {
        validateRHIRenderPassStoreOp(storeOp, `${rootPath}.${label}StoreOp`);
    }
    if (readOnly === true) {
        if (clearValue !== undefined || loadOp !== undefined || storeOp !== undefined) {
            fail(
                'invalid-descriptor',
                `read-only ${label} cannot declare clear, load, or store operations`,
                rootPath
            );
        }
        return;
    }
    if (!used) return;
    if (loadOp === undefined || storeOp === undefined) {
        fail(
            'invalid-descriptor',
            `writable ${label} requires explicit load and store operations`,
            rootPath
        );
    }
}

function rhiStencilFaceWrites(face: Readonly<RHIStencilFaceState> | undefined): boolean {
    return (
        (face?.failOp ?? 'keep') !== 'keep' ||
        (face?.depthFailOp ?? 'keep') !== 'keep' ||
        (face?.passOp ?? 'keep') !== 'keep'
    );
}

function rhiStencilFaceReads(face: Readonly<RHIStencilFaceState> | undefined): boolean {
    return (face?.compare ?? 'always') !== 'always';
}

function rhiGraphicsPipelineReadsDepth(
    descriptor: Readonly<RHIGraphicsPipelineDescriptor>
): boolean {
    const depthStencil = descriptor.depthStencil;
    return (
        depthStencil !== undefined &&
        rhiTextureFormatHasDepth(depthStencil.format) &&
        (depthStencil.depthCompare ?? 'always') !== 'always'
    );
}

function rhiGraphicsPipelineReadsStencil(
    descriptor: Readonly<RHIGraphicsPipelineDescriptor>
): boolean {
    const depthStencil = descriptor.depthStencil;
    if (depthStencil === undefined || !rhiTextureFormatHasStencil(depthStencil.format)) {
        return false;
    }
    const cullMode = descriptor.primitive.cullMode ?? 'none';
    return (
        (cullMode !== 'front' && rhiStencilFaceReads(depthStencil.stencilFront)) ||
        (cullMode !== 'back' && rhiStencilFaceReads(depthStencil.stencilBack))
    );
}

function rhiGraphicsPipelineWritesStencil(
    descriptor: Readonly<RHIGraphicsPipelineDescriptor>
): boolean {
    const depthStencil = descriptor.depthStencil;
    if (depthStencil === undefined || (depthStencil.stencilWriteMask ?? 0xffffffff) === 0) {
        return false;
    }
    const cullMode = descriptor.primitive.cullMode ?? 'none';
    return (
        (cullMode !== 'front' && rhiStencilFaceWrites(depthStencil.stencilFront)) ||
        (cullMode !== 'back' && rhiStencilFaceWrites(depthStencil.stencilBack))
    );
}

function rhiRenderPassDepthAspectUnused(
    attachment: Readonly<RHIRenderPassDepthStencilAttachment>
): boolean {
    return (
        attachment.depthClearValue === undefined &&
        attachment.depthLoadOp === undefined &&
        attachment.depthStoreOp === undefined &&
        attachment.depthReadOnly === undefined
    );
}

function rhiRenderPassStencilAspectUnused(
    attachment: Readonly<RHIRenderPassDepthStencilAttachment>
): boolean {
    return (
        attachment.stencilClearValue === undefined &&
        attachment.stencilLoadOp === undefined &&
        attachment.stencilStoreOp === undefined &&
        attachment.stencilReadOnly === undefined
    );
}

/**
 * Reject reads from unavailable aspects and writes to unavailable or read-only aspects.
 *
 * @internal Render-pass descriptors and pipeline descriptors must already be validated.
 */
export function validateRHIRenderPassPipelineDepthStencilAccess(
    renderPass: Readonly<RHIRenderPassDescriptor>,
    pipeline: Readonly<RHIGraphicsPipelineDescriptor>
): void {
    const pipelineDepthStencil = pipeline.depthStencil;
    const attachment = renderPass.depthStencilAttachment;
    if (pipelineDepthStencil === undefined) return;
    if (pipelineDepthStencil.format !== attachment?.view.format) return;

    const depthAspectUnavailable =
        !rhiTextureFormatHasDepth(attachment.view.format) ||
        rhiRenderPassDepthAspectUnused(attachment);
    if (
        pipelineDepthStencil.depthWriteEnabled === true &&
        (depthAspectUnavailable || attachment.depthReadOnly === true)
    ) {
        fail(
            'incompatible-layout',
            'pipeline writes a read-only or unused render-pass depth aspect',
            'pipeline.depthStencil.depthWriteEnabled'
        );
    }
    if (rhiGraphicsPipelineReadsDepth(pipeline) && depthAspectUnavailable) {
        fail(
            'incompatible-layout',
            'pipeline reads an unavailable or unused render-pass depth aspect',
            'pipeline.depthStencil.depthCompare'
        );
    }
    const stencilAspectUnavailable =
        !rhiTextureFormatHasStencil(attachment.view.format) ||
        rhiRenderPassStencilAspectUnused(attachment);
    if (
        rhiGraphicsPipelineWritesStencil(pipeline) &&
        (stencilAspectUnavailable || attachment.stencilReadOnly === true)
    ) {
        fail(
            'incompatible-layout',
            'pipeline writes a read-only or unused render-pass stencil aspect',
            'pipeline.depthStencil'
        );
    }
    if (rhiGraphicsPipelineReadsStencil(pipeline) && stencilAspectUnavailable) {
        fail(
            'incompatible-layout',
            'pipeline reads an unavailable or unused render-pass stencil aspect',
            'pipeline.depthStencil'
        );
    }
}

export function validateRHIRenderPassDescriptor(
    device: RHIDevice,
    descriptor: RHIRenderPassDescriptor
): void {
    if (
        descriptor.colorAttachments.length === 0 &&
        descriptor.depthStencilAttachment === undefined
    ) {
        fail('invalid-descriptor', 'requires at least one attachment', 'renderPass');
    }
    if (descriptor.colorAttachments.length > device.capabilities.limits.maxColorAttachments) {
        fail('out-of-bounds', 'contains too many color attachments', 'renderPass.colorAttachments');
    }
    let attachmentWidth = 0;
    let attachmentHeight = 0;
    let attachmentSampleCount = 0;
    let hasAttachmentSize = false;
    for (let index = 0; index < descriptor.colorAttachments.length; index += 1) {
        const attachment = descriptor.colorAttachments[index];
        if (attachment === null || attachment === undefined) {
            continue;
        }
        assertRenderPassColorObjectOwnedBy(device, attachment.view, index, '.view');
        assertRenderPassColorObjectOwnedBy(device, attachment.view.texture, index, '.view.texture');
        validateRenderPassColorAttachmentView(attachment.view, index, '.view');
        if (
            rhiTextureFormatHasDepth(attachment.view.format) ||
            rhiTextureFormatHasStencil(attachment.view.format)
        ) {
            fail(
                'invalid-descriptor',
                'color attachment requires a color format',
                `renderPass.colorAttachments[${String(index)}].view.format`
            );
        }
        if ((attachment.view.texture.usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
            fail(
                'invalid-descriptor',
                'texture lacks RENDER_ATTACHMENT usage',
                `renderPass.colorAttachments[${String(index)}].view`
            );
        }
        const texture = attachment.view.texture;
        const mipDivisor = 2 ** attachment.view.descriptor.baseMipLevel;
        const width = Math.max(1, Math.floor(texture.width / mipDivisor));
        const height = Math.max(1, Math.floor(texture.height / mipDivisor));
        if (
            hasAttachmentSize &&
            (width !== attachmentWidth ||
                height !== attachmentHeight ||
                texture.sampleCount !== attachmentSampleCount)
        ) {
            fail(
                'invalid-descriptor',
                'attachments have incompatible extents or sample counts',
                'renderPass'
            );
        }
        attachmentWidth = width;
        attachmentHeight = height;
        attachmentSampleCount = texture.sampleCount;
        hasAttachmentSize = true;
        validateRHIRenderPassLoadOp(
            attachment.loadOp,
            `renderPass.colorAttachments[${String(index)}].loadOp`
        );
        validateRHIRenderPassStoreOp(
            attachment.storeOp,
            `renderPass.colorAttachments[${String(index)}].storeOp`
        );
        if (attachment.loadOp === 'clear' && attachment.clearValue === undefined) {
            fail(
                'invalid-descriptor',
                'clear load operation requires clearValue',
                `renderPass.colorAttachments[${String(index)}].clearValue`
            );
        }
        if (
            attachment.clearValue !== undefined &&
            (!Number.isFinite(attachment.clearValue.r) ||
                !Number.isFinite(attachment.clearValue.g) ||
                !Number.isFinite(attachment.clearValue.b) ||
                !Number.isFinite(attachment.clearValue.a))
        ) {
            fail(
                'invalid-descriptor',
                'clear color components must be finite',
                `renderPass.colorAttachments[${String(index)}].clearValue`
            );
        }
        if (attachment.resolveTarget !== undefined) {
            assertRenderPassColorObjectOwnedBy(
                device,
                attachment.resolveTarget,
                index,
                '.resolveTarget'
            );
            assertRenderPassColorObjectOwnedBy(
                device,
                attachment.resolveTarget.texture,
                index,
                '.resolveTarget.texture'
            );
            validateRenderPassColorAttachmentView(
                attachment.resolveTarget,
                index,
                '.resolveTarget'
            );
            if (
                (attachment.resolveTarget.texture.usage & RHITextureUsage.RENDER_ATTACHMENT) ===
                0
            ) {
                fail(
                    'invalid-descriptor',
                    'resolve texture lacks RENDER_ATTACHMENT usage',
                    `renderPass.colorAttachments[${String(index)}].resolveTarget`
                );
            }
            if (
                attachment.view.texture.sampleCount <= 1 ||
                attachment.resolveTarget.texture.sampleCount !== 1
            ) {
                fail(
                    'invalid-descriptor',
                    'resolve requires a multisampled source and single-sampled target',
                    `renderPass.colorAttachments[${String(index)}].resolveTarget`
                );
            }
            if (attachment.view.format !== attachment.resolveTarget.format) {
                fail(
                    'invalid-descriptor',
                    'resolve formats must match',
                    `renderPass.colorAttachments[${String(index)}].resolveTarget`
                );
            }
            const resolveTexture = attachment.resolveTarget.texture;
            const resolveMipDivisor = 2 ** attachment.resolveTarget.descriptor.baseMipLevel;
            const resolveWidth = Math.max(1, Math.floor(resolveTexture.width / resolveMipDivisor));
            const resolveHeight = Math.max(
                1,
                Math.floor(resolveTexture.height / resolveMipDivisor)
            );
            if (resolveWidth !== width || resolveHeight !== height) {
                fail(
                    'invalid-descriptor',
                    'resolve target extent must match the source',
                    `renderPass.colorAttachments[${String(index)}].resolveTarget`
                );
            }
        }
    }

    const depthStencil = descriptor.depthStencilAttachment;
    if (depthStencil !== undefined) {
        assertRHIObjectOwnedBy(device, depthStencil.view, 'renderPass.depthStencilAttachment.view');
        assertRHIObjectOwnedBy(
            device,
            depthStencil.view.texture,
            'renderPass.depthStencilAttachment.view.texture'
        );
        validateAttachmentView(depthStencil.view, 'renderPass.depthStencilAttachment.view');
        if (
            !rhiTextureFormatHasDepth(depthStencil.view.format) &&
            !rhiTextureFormatHasStencil(depthStencil.view.format)
        ) {
            fail(
                'invalid-descriptor',
                'depth/stencil attachment requires a depth or stencil format',
                'renderPass.depthStencilAttachment.view.format'
            );
        }
        if ((depthStencil.view.texture.usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
            fail(
                'invalid-descriptor',
                'texture lacks RENDER_ATTACHMENT usage',
                'renderPass.depthStencilAttachment.view'
            );
        }
        const depthTexture = depthStencil.view.texture;
        const depthMipDivisor = 2 ** depthStencil.view.descriptor.baseMipLevel;
        const depthWidth = Math.max(1, Math.floor(depthTexture.width / depthMipDivisor));
        const depthHeight = Math.max(1, Math.floor(depthTexture.height / depthMipDivisor));
        if (
            hasAttachmentSize &&
            (depthWidth !== attachmentWidth ||
                depthHeight !== attachmentHeight ||
                depthTexture.sampleCount !== attachmentSampleCount)
        ) {
            fail(
                'invalid-descriptor',
                'attachments have incompatible extents or sample counts',
                'renderPass'
            );
        }
        const depthStencilPath = 'renderPass.depthStencilAttachment';
        const hasDepth = rhiTextureFormatHasDepth(depthStencil.view.format);
        const hasStencil = rhiTextureFormatHasStencil(depthStencil.view.format);
        validateRHIRenderPassDepthStencilAspect({
            rootPath: depthStencilPath,
            label: 'depth',
            hasAspect: hasDepth,
            clearValue: depthStencil.depthClearValue,
            loadOp: depthStencil.depthLoadOp,
            storeOp: depthStencil.depthStoreOp,
            readOnly: depthStencil.depthReadOnly
        });
        validateRHIRenderPassDepthStencilAspect({
            rootPath: depthStencilPath,
            label: 'stencil',
            hasAspect: hasStencil,
            clearValue: depthStencil.stencilClearValue,
            loadOp: depthStencil.stencilLoadOp,
            storeOp: depthStencil.stencilStoreOp,
            readOnly: depthStencil.stencilReadOnly
        });
        if (depthStencil.depthLoadOp === 'clear' && depthStencil.depthClearValue === undefined) {
            fail(
                'invalid-descriptor',
                'depth clear requires depthClearValue',
                'renderPass.depthStencilAttachment.depthClearValue'
            );
        }
        if (
            depthStencil.depthClearValue !== undefined &&
            (!Number.isFinite(depthStencil.depthClearValue) ||
                depthStencil.depthClearValue < 0 ||
                depthStencil.depthClearValue > 1)
        ) {
            fail(
                'invalid-descriptor',
                'depth clear value must be in [0, 1]',
                'renderPass.depthStencilAttachment.depthClearValue'
            );
        }
        if (
            depthStencil.stencilLoadOp === 'clear' &&
            depthStencil.stencilClearValue === undefined
        ) {
            fail(
                'invalid-descriptor',
                'stencil clear requires stencilClearValue',
                'renderPass.depthStencilAttachment.stencilClearValue'
            );
        }
        if (
            depthStencil.stencilClearValue !== undefined &&
            (!Number.isInteger(depthStencil.stencilClearValue) ||
                depthStencil.stencilClearValue < 0 ||
                depthStencil.stencilClearValue > 0xffffffff)
        ) {
            fail(
                'invalid-descriptor',
                'stencil clear value must be an unsigned 32-bit integer',
                'renderPass.depthStencilAttachment.stencilClearValue'
            );
        }
    }
}

function snapshotRHIRenderPassColorAttachment(
    attachment: RHIRenderPassColorAttachment
): Readonly<RHIRenderPassColorAttachment> {
    return Object.freeze({
        view: attachment.view,
        ...(attachment.resolveTarget === undefined
            ? {}
            : { resolveTarget: attachment.resolveTarget }),
        ...(attachment.clearValue === undefined
            ? {}
            : { clearValue: Object.freeze({ ...attachment.clearValue }) }),
        loadOp: attachment.loadOp,
        storeOp: attachment.storeOp
    });
}

function snapshotRHIRenderPassDepthStencilAttachment(
    attachment: RHIRenderPassDepthStencilAttachment
): Readonly<RHIRenderPassDepthStencilAttachment> {
    return Object.freeze({
        view: attachment.view,
        ...(attachment.depthClearValue === undefined
            ? {}
            : { depthClearValue: attachment.depthClearValue }),
        ...(attachment.depthLoadOp === undefined ? {} : { depthLoadOp: attachment.depthLoadOp }),
        ...(attachment.depthStoreOp === undefined ? {} : { depthStoreOp: attachment.depthStoreOp }),
        ...(attachment.depthReadOnly === undefined
            ? {}
            : { depthReadOnly: attachment.depthReadOnly }),
        ...(attachment.stencilClearValue === undefined
            ? {}
            : { stencilClearValue: attachment.stencilClearValue }),
        ...(attachment.stencilLoadOp === undefined
            ? {}
            : { stencilLoadOp: attachment.stencilLoadOp }),
        ...(attachment.stencilStoreOp === undefined
            ? {}
            : { stencilStoreOp: attachment.stencilStoreOp }),
        ...(attachment.stencilReadOnly === undefined
            ? {}
            : { stencilReadOnly: attachment.stencilReadOnly })
    });
}

interface MutableRHIRenderPassColorAttachment {
    view: RHITextureView;
    resolveTarget?: RHITextureView;
    clearValue?: RHIColor;
    loadOp: RHILoadOp;
    storeOp: RHIStoreOp;
}

interface MutableRHIColor {
    r: number;
    g: number;
    b: number;
    a: number;
}

interface MutableRHIRenderPassDepthStencilAttachment {
    view: RHITextureView;
    depthClearValue?: number;
    depthLoadOp?: RHILoadOp;
    depthStoreOp?: RHIStoreOp;
    depthReadOnly?: boolean;
    stencilClearValue?: number;
    stencilLoadOp?: RHILoadOp;
    stencilStoreOp?: RHIStoreOp;
    stencilReadOnly?: boolean;
}

interface MutableRHIRenderPassDescriptor {
    label: string;
    colorAttachments: (MutableRHIRenderPassColorAttachment | null)[];
    depthStencilAttachment?: MutableRHIRenderPassDepthStencilAttachment;
}

/**
 * Caller-owned mutable backing for validated render-pass snapshots. Concrete command contexts
 * lease one of these only while a native pass is open; public snapshots remain immutable.
 */
export interface RHIRenderPassDescriptorSnapshotStorage {
    readonly descriptor: Readonly<RHIRenderPassDescriptor>;
    /** Current retained color-slot capacity, useful for high-water diagnostics. */
    readonly capacity: number;
}

interface InternalRHIRenderPassDescriptorSnapshotStorage extends RHIRenderPassDescriptorSnapshotStorage {
    readonly mutableDescriptor: MutableRHIRenderPassDescriptor;
    readonly colorSlots: (MutableRHIRenderPassColorAttachment | undefined)[];
    readonly clearColors: (MutableRHIColor | undefined)[];
    mutableDepthStencil: MutableRHIRenderPassDepthStencilAttachment | null;
}

/** Allocate reusable render-pass snapshot backing outside the command hot path. */
export function createRHIRenderPassDescriptorSnapshotStorage(): RHIRenderPassDescriptorSnapshotStorage {
    const colorAttachments: (MutableRHIRenderPassColorAttachment | null)[] = [];
    const mutableDescriptor: MutableRHIRenderPassDescriptor = {
        label: '',
        colorAttachments
    };
    const storage: InternalRHIRenderPassDescriptorSnapshotStorage = {
        descriptor: mutableDescriptor,
        get capacity(): number {
            return this.colorSlots.length;
        },
        mutableDescriptor,
        colorSlots: [],
        clearColors: [],
        mutableDepthStencil: null
    };
    return storage;
}

/**
 * Validate and copy a render-pass plan into caller-owned storage. Returns whether retained slot
 * capacity grew; repeated snapshots of the same shape perform no descriptor/array allocation.
 */
export function snapshotRHIRenderPassDescriptorInto(
    device: RHIDevice,
    descriptor: RHIRenderPassDescriptor,
    storage: RHIRenderPassDescriptorSnapshotStorage
): boolean {
    validateRHIRenderPassDescriptor(device, descriptor);
    const internal = storage as InternalRHIRenderPassDescriptorSnapshotStorage;
    const target = internal.mutableDescriptor;
    const attachments = descriptor.colorAttachments;
    let grew = false;
    while (internal.colorSlots.length < attachments.length) {
        internal.clearColors.push(undefined);
        internal.colorSlots.push(undefined);
        grew = true;
    }
    target.label = normalizedLabel(descriptor.label);
    target.colorAttachments.length = attachments.length;
    for (let index = 0; index < attachments.length; index += 1) {
        const attachment = attachments[index];
        if (attachment === null || attachment === undefined) {
            target.colorAttachments[index] = null;
            continue;
        }
        let slot = internal.colorSlots[index];
        if (slot === undefined) {
            slot = {
                view: attachment.view,
                loadOp: attachment.loadOp,
                storeOp: attachment.storeOp
            };
            internal.colorSlots[index] = slot;
            grew = true;
        }
        slot.view = attachment.view;
        if (attachment.resolveTarget === undefined) delete slot.resolveTarget;
        else slot.resolveTarget = attachment.resolveTarget;
        slot.loadOp = attachment.loadOp;
        slot.storeOp = attachment.storeOp;
        const sourceClear = attachment.clearValue;
        if (sourceClear === undefined) {
            delete slot.clearValue;
        } else {
            let clearColor = internal.clearColors[index];
            if (clearColor === undefined) {
                clearColor = { r: 0, g: 0, b: 0, a: 0 };
                internal.clearColors[index] = clearColor;
                grew = true;
            }
            clearColor.r = sourceClear.r;
            clearColor.g = sourceClear.g;
            clearColor.b = sourceClear.b;
            clearColor.a = sourceClear.a;
            slot.clearValue = clearColor;
        }
        target.colorAttachments[index] = slot;
    }
    const sourceDepthStencil = descriptor.depthStencilAttachment;
    if (sourceDepthStencil === undefined) {
        delete target.depthStencilAttachment;
    } else {
        let depthStencil = internal.mutableDepthStencil;
        if (depthStencil === null) {
            depthStencil = { view: sourceDepthStencil.view };
            internal.mutableDepthStencil = depthStencil;
            grew = true;
        }
        depthStencil.view = sourceDepthStencil.view;
        if (sourceDepthStencil.depthClearValue === undefined) delete depthStencil.depthClearValue;
        else depthStencil.depthClearValue = sourceDepthStencil.depthClearValue;
        if (sourceDepthStencil.depthLoadOp === undefined) delete depthStencil.depthLoadOp;
        else depthStencil.depthLoadOp = sourceDepthStencil.depthLoadOp;
        if (sourceDepthStencil.depthStoreOp === undefined) delete depthStencil.depthStoreOp;
        else depthStencil.depthStoreOp = sourceDepthStencil.depthStoreOp;
        if (sourceDepthStencil.depthReadOnly === undefined) delete depthStencil.depthReadOnly;
        else depthStencil.depthReadOnly = sourceDepthStencil.depthReadOnly;
        if (sourceDepthStencil.stencilClearValue === undefined)
            delete depthStencil.stencilClearValue;
        else depthStencil.stencilClearValue = sourceDepthStencil.stencilClearValue;
        if (sourceDepthStencil.stencilLoadOp === undefined) delete depthStencil.stencilLoadOp;
        else depthStencil.stencilLoadOp = sourceDepthStencil.stencilLoadOp;
        if (sourceDepthStencil.stencilStoreOp === undefined) delete depthStencil.stencilStoreOp;
        else depthStencil.stencilStoreOp = sourceDepthStencil.stencilStoreOp;
        if (sourceDepthStencil.stencilReadOnly === undefined) delete depthStencil.stencilReadOnly;
        else depthStencil.stencilReadOnly = sourceDepthStencil.stencilReadOnly;
        target.depthStencilAttachment = depthStencil;
    }
    return grew;
}

/** Snapshot a pass plan outside command execution; resource views retain their stable identity. */
export function snapshotRHIRenderPassDescriptor(
    device: RHIDevice,
    descriptor: RHIRenderPassDescriptor
): Readonly<RHIRenderPassDescriptor> {
    validateRHIRenderPassDescriptor(device, descriptor);
    return Object.freeze({
        label: normalizedLabel(descriptor.label),
        colorAttachments: Object.freeze(
            descriptor.colorAttachments.map(attachment =>
                attachment === null ? null : snapshotRHIRenderPassColorAttachment(attachment)
            )
        ),
        ...(descriptor.depthStencilAttachment === undefined
            ? {}
            : {
                  depthStencilAttachment: snapshotRHIRenderPassDepthStencilAttachment(
                      descriptor.depthStencilAttachment
                  )
              })
    });
}

export function normalizeRHISurfaceConfiguration(
    configuration: RHISurfaceConfiguration,
    capabilities: RHICapabilities
): Readonly<RHINormalizedSurfaceConfiguration> {
    positiveInteger(configuration.width, 'surface.width');
    positiveInteger(configuration.height, 'surface.height');
    const format = capabilities.getTextureFormatCapabilities(configuration.format);
    if (!format.renderable) {
        fail('unsupported-format', 'surface format is not renderable', 'surface.format');
    }
    const usage = configuration.usage ?? RHITextureUsage.RENDER_ATTACHMENT;
    if ((usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
        fail('invalid-descriptor', 'surface usage requires RENDER_ATTACHMENT', 'surface.usage');
    }
    const depthStencilFormat = configuration.depthStencilFormat ?? null;
    if (depthStencilFormat !== null) {
        const depthStencilCapabilities =
            capabilities.getTextureFormatCapabilities(depthStencilFormat);
        if (
            !rhiTextureFormatHasDepth(depthStencilFormat) &&
            !rhiTextureFormatHasStencil(depthStencilFormat)
        ) {
            fail(
                'invalid-descriptor',
                'surface depthStencilFormat requires a depth or stencil format',
                'surface.depthStencilFormat'
            );
        }
        if (!depthStencilCapabilities.renderable) {
            fail(
                'unsupported-format',
                'surface depth/stencil format is not renderable',
                'surface.depthStencilFormat'
            );
        }
        if (!depthStencilCapabilities.sampleCounts.includes(1)) {
            fail(
                'unsupported-format',
                'surface depth/stencil format does not support single-sample rendering',
                'surface.depthStencilFormat'
            );
        }
    }
    return Object.freeze({
        format: configuration.format,
        depthStencilFormat,
        width: configuration.width,
        height: configuration.height,
        usage,
        alphaMode: configuration.alphaMode ?? 'opaque',
        colorSpace: configuration.colorSpace ?? 'srgb',
        presentMode: configuration.presentMode ?? 'fifo'
    });
}

/** Useful to validation layers that must inspect format classes without native APIs. */
export function rhiTextureFormatHasStencil(format: RHITextureFormat): boolean {
    return format === 'stencil8' || format.endsWith('-stencil8');
}

export function rhiTextureFormatHasDepth(format: RHITextureFormat): boolean {
    return format.startsWith('depth');
}
