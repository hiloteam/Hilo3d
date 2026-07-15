import {
    RHIBufferUsage,
    RHIShaderStage,
    RHITextureUsage,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupEntry,
    type RHIBindGroupLayout,
    type RHIBindGroupLayoutDescriptor,
    type RHIBindGroupLayoutEntry,
    type RHIBuffer,
    type RHIBufferBinding,
    type RHIBufferDescriptor,
    type RHINormalizedSamplerDescriptor,
    type RHIPipelineLayout,
    type RHIPipelineLayoutDescriptor,
    type RHISampler,
    type RHISamplerDescriptor,
    type RHIPreparedShaderBindings,
    type RHIShaderModule,
    type RHIShaderModuleDescriptor,
    type RHITexture,
    type RHITextureDescriptor,
    type RHITextureDimension,
    type RHITextureFormat,
    type RHITextureSampleType,
    type RHITextureView,
    type RHITextureViewDescriptor,
    type RHITextureViewDimension
} from '../RHI';
import {
    WebGLDestroyableBase,
    WebGLObjectBase,
    glNumber,
    glResource,
    hasUsage,
    requireInteger,
    requirePositiveInteger,
    requireRange,
    type DisposableWebGLObject
} from './WebGLInternal';
import { addressMode, compareFunction, formatInfo, type WebGLFormatInfo } from './WebGLFormats';
import type { WebGLRHIDevice } from './WebGLDevice';

export class WebGLRHIBuffer
    extends WebGLDestroyableBase
    implements RHIBuffer, DisposableWebGLObject
{
    readonly device: WebGLRHIDevice;
    readonly size: number;
    readonly usage: number;
    readonly native: WebGLBuffer;
    private readonly owned: boolean;
    private _mapState: 'unmapped' | 'pending' | 'mapped' = 'unmapped';
    private mappedMode: 'read' | 'write' | null = null;
    private mappedOffset = 0;
    private mappedSize = 0;
    private mappedData: ArrayBuffer | null = null;

    constructor(
        device: WebGLRHIDevice,
        descriptor: RHIBufferDescriptor,
        native?: WebGLBuffer,
        owned = true,
        initialize = true
    ) {
        super(descriptor.label);
        requirePositiveInteger(descriptor.size, 'Buffer size');
        if (descriptor.size % 4 !== 0) throw new RangeError('Buffer size must be a multiple of 4');
        if (!Number.isSafeInteger(descriptor.usage) || descriptor.usage <= 0) {
            throw new RangeError('Buffer usage must be a non-zero integer bit mask');
        }
        if (
            hasUsage(descriptor.usage, RHIBufferUsage.MAP_READ) ||
            hasUsage(descriptor.usage, RHIBufferUsage.MAP_WRITE)
        ) {
            throw new Error(
                'WebGL 2 RHI does not support persistent buffer mapping; use queue.writeBuffer'
            );
        }
        if (hasUsage(descriptor.usage, RHIBufferUsage.STORAGE)) {
            throw new Error('WebGL 2 RHI does not support storage buffers');
        }
        this.device = device;
        this.size = descriptor.size;
        this.usage = descriptor.usage;
        this.native = native ?? glResource(device.gl.createBuffer(), 'a buffer');
        this.owned = owned;
        device.registerDisposable(this);
        device.registerBufferIdentity(this.native, this);
        device.diagnostics?.recordResource('buffer');
        if (initialize) {
            device.state.bindBuffer(device.gl.COPY_WRITE_BUFFER, this.native);
            const dynamic =
                hasUsage(this.usage, RHIBufferUsage.COPY_DST) ||
                hasUsage(this.usage, RHIBufferUsage.MAP_WRITE);
            device.gl.bufferData(
                device.gl.COPY_WRITE_BUFFER,
                this.size,
                dynamic ? device.gl.DYNAMIC_DRAW : device.gl.STATIC_DRAW
            );
        }
        if (descriptor.mappedAtCreation === true) {
            this.beginMap('write', 0, this.size);
        }
    }

    get mapState(): 'unmapped' | 'pending' | 'mapped' {
        return this._mapState;
    }

    mapAsync(mode: 'read' | 'write', offset = 0, size = this.size - offset): Promise<void> {
        this.assertUsable();
        void mode;
        void offset;
        void size;
        return Promise.reject(
            new Error('WebGL 2 RHI does not support mapAsync; use queue.writeBuffer')
        );
    }

    getMappedRange(
        offset = this.mappedOffset,
        size = this.mappedOffset + this.mappedSize - offset
    ): ArrayBuffer {
        this.assertUsable();
        if (this._mapState !== 'mapped' || !this.mappedData)
            throw new Error('Buffer is not mapped');
        requireRange(offset, size, this.size, 'Mapped range');
        if (offset < this.mappedOffset || offset + size > this.mappedOffset + this.mappedSize) {
            throw new RangeError('Requested range is outside the mapped range');
        }
        if (offset !== this.mappedOffset || size !== this.mappedSize) {
            throw new Error(
                'WebGL mapped-at-creation staging exposes the complete allocation only'
            );
        }
        return this.mappedData;
    }

    unmap(): void {
        this.assertUsable();
        if (this._mapState === 'unmapped') return;
        if (this._mapState === 'pending') throw new Error('Buffer mapping is still pending');
        const data = this.mappedData;
        if (this.mappedMode === 'write' && data) {
            const destination = new Uint8Array(data);
            this.device.state.bindBuffer(this.device.gl.COPY_WRITE_BUFFER, this.native);
            this.device.gl.bufferSubData(
                this.device.gl.COPY_WRITE_BUFFER,
                this.mappedOffset,
                destination
            );
            this.device.diagnostics?.recordBufferUpload();
        }
        this.clearMap();
    }

    destroy(): void {
        this.dispose(false);
    }

    dispose(contextLost = false): void {
        if (this._destroyed) return;
        this._destroyed = true;
        this.clearMap();
        if (this.owned && !contextLost) this.device.gl.deleteBuffer(this.native);
        this.device.unregisterDisposable(this);
        this.device.unregisterBufferIdentity(this.native, this);
    }

    private beginMap(mode: 'read' | 'write', offset: number, size: number): void {
        this.mappedMode = mode;
        this.mappedOffset = offset;
        this.mappedSize = size;
        this.mappedData = new ArrayBuffer(size);
        this._mapState = 'mapped';
    }

    private clearMap(): void {
        this._mapState = 'unmapped';
        this.mappedMode = null;
        this.mappedOffset = 0;
        this.mappedSize = 0;
        this.mappedData = null;
    }

    assertUsable(): void {
        this.device.assertAlive();
        if (this._destroyed) throw new Error('Buffer is destroyed');
    }
}

function defaultViewDimension(texture: WebGLRHITexture): RHITextureViewDimension {
    if (texture.dimension === '1d') return '1d';
    if (texture.dimension === '3d') return '3d';
    if (texture.target === texture.device.gl.TEXTURE_CUBE_MAP) return 'cube';
    return texture.depthOrArrayLayers === 1 ? '2d' : '2d-array';
}

function textureTarget(
    gl: WebGL2RenderingContext,
    dimension: RHITextureDimension,
    depth: number
): GLenum {
    if (dimension === '3d') return gl.TEXTURE_3D;
    if (dimension === '1d') return gl.TEXTURE_2D;
    if (depth === 1) return gl.TEXTURE_2D;
    return gl.TEXTURE_2D_ARRAY;
}

/** Concrete WebGL texture wrapper. Multisampled attachments use a native renderbuffer. */
export class WebGLRHITexture
    extends WebGLDestroyableBase
    implements RHITexture, DisposableWebGLObject
{
    readonly device: WebGLRHIDevice;
    private _width: number;
    private _height: number;
    private _depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension: RHITextureDimension;
    readonly format: RHITextureFormat;
    readonly usage: number;
    readonly target: GLenum;
    readonly native: WebGLTexture | WebGLRenderbuffer | null;
    readonly nativeTexture: WebGLTexture | null;
    readonly nativeRenderbuffer: WebGLRenderbuffer | null;
    readonly surfaceTexture: boolean;
    readonly formatInfo: WebGLFormatInfo;
    private readonly owned: boolean;

    constructor(
        device: WebGLRHIDevice,
        descriptor: RHITextureDescriptor,
        native?: WebGLTexture | WebGLRenderbuffer | null,
        owned = true,
        initialize = true,
        surfaceTexture = false
    ) {
        super(descriptor.label);
        const width = descriptor.size.width;
        const height = descriptor.size.height ?? 1;
        const depth = descriptor.size.depthOrArrayLayers ?? 1;
        requirePositiveInteger(width, 'Texture width');
        requirePositiveInteger(height, 'Texture height');
        requirePositiveInteger(depth, 'Texture depth or array layer count');
        const dimension = descriptor.dimension ?? '2d';
        if (dimension === '1d') {
            throw new Error('WebGL 2 RHI does not support 1D textures');
        }
        if (dimension === '3d' && depth > device.limits.maxTextureDimension3D) {
            throw new RangeError('3D texture depth exceeds the device limit');
        }
        if (
            width > device.limits.maxTextureDimension2D ||
            height > device.limits.maxTextureDimension2D
        ) {
            throw new RangeError('Texture dimensions exceed the device limit');
        }
        if (dimension === '2d' && depth > device.limits.maxTextureArrayLayers) {
            throw new RangeError('Texture layer count exceeds the device limit');
        }
        if (!Number.isSafeInteger(descriptor.usage) || descriptor.usage <= 0) {
            throw new RangeError('Texture usage must be a non-zero integer bit mask');
        }
        if (hasUsage(descriptor.usage, RHITextureUsage.STORAGE_BINDING)) {
            throw new Error('WebGL 2 RHI does not support storage textures');
        }
        if (
            !surfaceTexture &&
            (descriptor.format === 'bgra8unorm' || descriptor.format === 'bgra8unorm-srgb')
        ) {
            throw new Error(
                'WebGL 2 exposes BGRA only as a canvas surface pseudo-format; offscreen textures require RGBA'
            );
        }
        for (const viewFormat of descriptor.viewFormats ?? []) {
            if (viewFormat !== descriptor.format) {
                throw new Error('WebGL 2 RHI does not support alternate texture view formats');
            }
        }
        const mipLevelCount = descriptor.mipLevelCount ?? 1;
        const sampleCount = descriptor.sampleCount ?? 1;
        requirePositiveInteger(mipLevelCount, 'Texture mip level count');
        requirePositiveInteger(sampleCount, 'Texture sample count');
        const capabilities = device.getTextureFormatCapabilities(descriptor.format);
        if (hasUsage(descriptor.usage, RHITextureUsage.TEXTURE_BINDING) && !capabilities.sampled) {
            throw new Error(
                `Texture format ${descriptor.format} is not sampleable on this WebGL 2 device`
            );
        }
        if (
            !surfaceTexture &&
            hasUsage(descriptor.usage, RHITextureUsage.RENDER_ATTACHMENT) &&
            !capabilities.renderable
        ) {
            const extensionHint =
                descriptor.format.includes('float') && !device.colorBufferFloat
                    ? '; EXT_color_buffer_float is unavailable'
                    : '';
            throw new Error(
                `Texture format ${descriptor.format} is not render attachment capable on this WebGL 2 device${extensionHint}`
            );
        }
        if (
            !surfaceTexture &&
            hasUsage(descriptor.usage, RHITextureUsage.RENDER_ATTACHMENT) &&
            !capabilities.sampleCounts.includes(sampleCount)
        ) {
            throw new RangeError(
                `Texture format ${descriptor.format} does not support sample count ${String(sampleCount)}`
            );
        }
        const maxMipLevels =
            Math.floor(Math.log2(Math.max(width, height, dimension === '3d' ? depth : 1))) + 1;
        if (mipLevelCount > maxMipLevels)
            throw new RangeError('Texture mip level count is too large');
        if (sampleCount > 1) {
            if (!hasUsage(descriptor.usage, RHITextureUsage.RENDER_ATTACHMENT)) {
                throw new Error('Multisampled textures require RENDER_ATTACHMENT usage');
            }
            if (hasUsage(descriptor.usage, RHITextureUsage.TEXTURE_BINDING)) {
                throw new Error('WebGL 2 cannot sample a multisampled renderbuffer texture');
            }
            if (mipLevelCount !== 1 || depth !== 1 || dimension !== '2d') {
                throw new Error(
                    'WebGL 2 multisampled textures must be single-layer 2D textures with one mip'
                );
            }
            if (sampleCount > glNumber(device.gl, device.gl.MAX_SAMPLES, 4)) {
                throw new RangeError('Texture sample count exceeds the device limit');
            }
        }
        this.device = device;
        this._width = width;
        this._height = height;
        this._depthOrArrayLayers = depth;
        this.mipLevelCount = mipLevelCount;
        this.sampleCount = sampleCount;
        this.dimension = dimension;
        this.format = descriptor.format;
        this.usage = descriptor.usage;
        this.target = textureTarget(device.gl, dimension, depth);
        this.formatInfo = formatInfo(
            device.gl,
            device.compressedTextureExtensions,
            descriptor.format
        );
        this.surfaceTexture = surfaceTexture;
        this.owned = owned;
        if (surfaceTexture) {
            this.native = null;
            this.nativeTexture = null;
            this.nativeRenderbuffer = null;
        } else if (sampleCount > 1) {
            const renderbuffer =
                (native as WebGLRenderbuffer | null | undefined) ??
                glResource(device.gl.createRenderbuffer(), 'a renderbuffer');
            this.native = renderbuffer;
            this.nativeTexture = null;
            this.nativeRenderbuffer = renderbuffer;
            if (initialize) {
                device.state.bindRenderbuffer(renderbuffer);
                device.gl.renderbufferStorageMultisample(
                    device.gl.RENDERBUFFER,
                    sampleCount,
                    this.formatInfo.internalFormat,
                    width,
                    height
                );
            }
        } else {
            const texture =
                (native as WebGLTexture | null | undefined) ??
                glResource(device.gl.createTexture(), 'a texture');
            this.native = texture;
            this.nativeTexture = texture;
            this.nativeRenderbuffer = null;
            device.registerTextureIdentity(texture, this);
            if (initialize) this.allocateTextureStorage();
        }
        device.registerDisposable(this);
        device.diagnostics?.recordResource('texture');
    }

    get width(): number {
        return this._width;
    }

    get height(): number {
        return this._height;
    }

    get depthOrArrayLayers(): number {
        return this._depthOrArrayLayers;
    }

    createView(descriptor: RHITextureViewDescriptor = {}): WebGLRHITextureView {
        this.assertUsable();
        const format = descriptor.format ?? this.format;
        if (format !== this.format)
            throw new Error('WebGL 2 does not support texture format reinterpretation');
        const dimension = descriptor.dimension ?? defaultViewDimension(this);
        const aspect = descriptor.aspect ?? 'all';
        const baseMipLevel = descriptor.baseMipLevel ?? 0;
        const mipLevelCount = descriptor.mipLevelCount ?? this.mipLevelCount - baseMipLevel;
        const baseArrayLayer = descriptor.baseArrayLayer ?? 0;
        const arrayLayerCount =
            descriptor.arrayLayerCount ?? this.depthOrArrayLayers - baseArrayLayer;
        requireRange(baseMipLevel, mipLevelCount, this.mipLevelCount, 'Texture view mip');
        requireRange(
            baseArrayLayer,
            arrayLayerCount,
            this.depthOrArrayLayers,
            'Texture view array layer'
        );
        if (mipLevelCount === 0 || arrayLayerCount === 0)
            throw new RangeError('Texture views cannot be empty');
        if (dimension === 'cube' || dimension === 'cube-array') {
            throw new Error(
                'WebGL 2 RHI does not infer cube allocations from six-layer textures; cube views are unsupported'
            );
        }
        const nativeDimension = defaultViewDimension(this);
        const attachmentLayerView =
            nativeDimension === '2d-array' && dimension === '2d' && arrayLayerCount === 1;
        if (dimension !== nativeDimension && !attachmentLayerView) {
            throw new Error(
                `WebGL 2 cannot express a ${dimension} view of a ${nativeDimension} texture`
            );
        }
        if (dimension === '2d' && arrayLayerCount !== 1) {
            throw new Error('A WebGL 2D texture view must select exactly one array layer');
        }
        if (
            aspect === 'depth-only' &&
            this.formatInfo.kind !== 'depth' &&
            this.formatInfo.kind !== 'depth-stencil'
        ) {
            throw new Error('depth-only aspect requires a depth format');
        }
        if (
            aspect === 'stencil-only' &&
            this.formatInfo.kind !== 'stencil' &&
            this.formatInfo.kind !== 'depth-stencil'
        ) {
            throw new Error('stencil-only aspect requires a stencil format');
        }
        return new WebGLRHITextureView(
            this,
            descriptor.label,
            format,
            dimension,
            aspect,
            baseMipLevel,
            mipLevelCount,
            baseArrayLayer,
            arrayLayerCount
        );
    }

    setSurfaceSize(width: number, height: number): void {
        if (!this.surfaceTexture) throw new Error('Only a surface texture can change size');
        this._width = width;
        this._height = height;
        this._depthOrArrayLayers = 1;
    }

    destroy(): void {
        this.dispose(false);
    }

    dispose(contextLost = false): void {
        if (this._destroyed) return;
        this._destroyed = true;
        if (this.owned && !contextLost) {
            if (this.nativeTexture) this.device.gl.deleteTexture(this.nativeTexture);
            if (this.nativeRenderbuffer) this.device.gl.deleteRenderbuffer(this.nativeRenderbuffer);
        }
        if (this.nativeTexture) this.device.unregisterTextureIdentity(this.nativeTexture, this);
        this.device.unregisterDisposable(this);
    }

    assertUsable(): void {
        this.device.assertAlive();
        if (this._destroyed) throw new Error('Texture is destroyed');
    }

    private allocateTextureStorage(): void {
        const gl = this.device.gl;
        const texture = this.nativeTexture;
        if (!texture) return;
        this.device.state.bindTexture(0, this.target, texture);
        gl.texParameteri(this.target, gl.TEXTURE_BASE_LEVEL, 0);
        gl.texParameteri(this.target, gl.TEXTURE_MAX_LEVEL, this.mipLevelCount - 1);
        gl.texParameteri(this.target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(this.target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(this.target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(this.target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (this.target === gl.TEXTURE_3D || this.target === gl.TEXTURE_2D_ARRAY) {
            gl.texParameteri(this.target, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            gl.texStorage3D(
                this.target,
                this.mipLevelCount,
                this.formatInfo.internalFormat,
                this.width,
                this.height,
                this.depthOrArrayLayers
            );
        } else {
            gl.texStorage2D(
                this.target,
                this.mipLevelCount,
                this.formatInfo.internalFormat,
                this.width,
                this.height
            );
        }
    }
}

export class WebGLRHITextureView extends WebGLObjectBase implements RHITextureView {
    readonly texture: WebGLRHITexture;
    readonly format: RHITextureFormat;
    readonly dimension: RHITextureViewDimension;
    readonly aspect: 'all' | 'stencil-only' | 'depth-only';
    readonly baseMipLevel: number;
    readonly mipLevelCount: number;
    readonly baseArrayLayer: number;
    readonly arrayLayerCount: number;

    constructor(
        texture: WebGLRHITexture,
        label: string | undefined,
        format: RHITextureFormat,
        dimension: RHITextureViewDimension,
        aspect: 'all' | 'stencil-only' | 'depth-only',
        baseMipLevel: number,
        mipLevelCount: number,
        baseArrayLayer: number,
        arrayLayerCount: number
    ) {
        super(label);
        this.texture = texture;
        this.format = format;
        this.dimension = dimension;
        this.aspect = aspect;
        this.baseMipLevel = baseMipLevel;
        this.mipLevelCount = mipLevelCount;
        this.baseArrayLayer = baseArrayLayer;
        this.arrayLayerCount = arrayLayerCount;
    }
}

export function normalizeSamplerDescriptor(
    descriptor: RHISamplerDescriptor
): Readonly<RHINormalizedSamplerDescriptor> {
    const normalized = {
        addressModeU: descriptor.addressModeU ?? 'clamp-to-edge',
        addressModeV: descriptor.addressModeV ?? 'clamp-to-edge',
        addressModeW: descriptor.addressModeW ?? 'clamp-to-edge',
        magFilter: descriptor.magFilter ?? 'nearest',
        minFilter: descriptor.minFilter ?? 'nearest',
        mipmapFilter: descriptor.mipmapFilter ?? 'nearest',
        lodMinClamp: descriptor.lodMinClamp ?? 0,
        lodMaxClamp: descriptor.lodMaxClamp ?? 32,
        maxAnisotropy: descriptor.maxAnisotropy ?? 1
    } as const;
    return Object.freeze(
        descriptor.compare === undefined
            ? normalized
            : { ...normalized, compare: descriptor.compare }
    );
}

export function samplerKey(descriptor: Readonly<RHINormalizedSamplerDescriptor>): string {
    return [
        descriptor.addressModeU,
        descriptor.addressModeV,
        descriptor.addressModeW,
        descriptor.magFilter,
        descriptor.minFilter,
        descriptor.mipmapFilter,
        descriptor.lodMinClamp,
        descriptor.lodMaxClamp,
        descriptor.compare ?? '-',
        descriptor.maxAnisotropy
    ].join('|');
}

export class WebGLRHISampler extends WebGLObjectBase implements RHISampler, DisposableWebGLObject {
    readonly device: WebGLRHIDevice;
    readonly descriptor: Readonly<RHINormalizedSamplerDescriptor>;
    readonly native: WebGLSampler;
    readonly comparison: boolean;
    readonly filtering: boolean;
    private readonly owned: boolean;
    private disposed = false;

    constructor(
        device: WebGLRHIDevice,
        sourceDescriptor: RHISamplerDescriptor,
        native?: WebGLSampler,
        owned = true,
        configure = true
    ) {
        super(sourceDescriptor.label);
        this.device = device;
        this.descriptor = normalizeSamplerDescriptor(sourceDescriptor);
        this.comparison = this.descriptor.compare !== undefined;
        this.filtering =
            this.descriptor.magFilter === 'linear' ||
            this.descriptor.minFilter === 'linear' ||
            this.descriptor.mipmapFilter === 'linear' ||
            this.descriptor.maxAnisotropy > 1;
        this.native = native ?? glResource(device.gl.createSampler(), 'a sampler');
        this.owned = owned;
        device.registerDisposable(this);
        device.registerSamplerIdentity(this.native, this);
        try {
            if (configure) this.configure();
        } catch (error) {
            this.disposed = true;
            device.unregisterDisposable(this);
            device.unregisterSamplerIdentity(this.native, this);
            if (this.owned) device.gl.deleteSampler(this.native);
            throw error;
        }
        device.diagnostics?.recordResource('sampler');
    }

    dispose(contextLost = false): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.owned && !contextLost) this.device.gl.deleteSampler(this.native);
        this.device.unregisterDisposable(this);
        this.device.unregisterSamplerIdentity(this.native, this);
    }

    assertUsable(): void {
        this.device.assertAlive();
        if (this.disposed) throw new Error('Sampler is no longer valid');
    }

    private configure(): void {
        const gl = this.device.gl;
        const descriptor = this.descriptor;
        const minFilter =
            descriptor.minFilter === 'nearest'
                ? descriptor.mipmapFilter === 'nearest'
                    ? gl.NEAREST_MIPMAP_NEAREST
                    : gl.NEAREST_MIPMAP_LINEAR
                : descriptor.mipmapFilter === 'nearest'
                  ? gl.LINEAR_MIPMAP_NEAREST
                  : gl.LINEAR_MIPMAP_LINEAR;
        gl.samplerParameteri(
            this.native,
            gl.TEXTURE_WRAP_S,
            addressMode(gl, descriptor.addressModeU)
        );
        gl.samplerParameteri(
            this.native,
            gl.TEXTURE_WRAP_T,
            addressMode(gl, descriptor.addressModeV)
        );
        gl.samplerParameteri(
            this.native,
            gl.TEXTURE_WRAP_R,
            addressMode(gl, descriptor.addressModeW)
        );
        gl.samplerParameteri(
            this.native,
            gl.TEXTURE_MAG_FILTER,
            descriptor.magFilter === 'nearest' ? gl.NEAREST : gl.LINEAR
        );
        gl.samplerParameteri(this.native, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.samplerParameterf(this.native, gl.TEXTURE_MIN_LOD, descriptor.lodMinClamp);
        gl.samplerParameterf(this.native, gl.TEXTURE_MAX_LOD, descriptor.lodMaxClamp);
        gl.samplerParameteri(
            this.native,
            gl.TEXTURE_COMPARE_MODE,
            this.comparison ? gl.COMPARE_REF_TO_TEXTURE : gl.NONE
        );
        if (this.comparison) {
            gl.samplerParameteri(
                this.native,
                gl.TEXTURE_COMPARE_FUNC,
                compareFunction(gl, descriptor.compare ?? 'always')
            );
        }
        const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
        if (descriptor.maxAnisotropy > 1) {
            if (!anisotropy) throw new Error('Anisotropic filtering is unavailable');
            const maximum = glNumber(gl, anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT, 1);
            if (descriptor.maxAnisotropy > maximum)
                throw new RangeError('maxAnisotropy exceeds the device limit');
            gl.samplerParameterf(
                this.native,
                anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
                descriptor.maxAnisotropy
            );
        }
    }
}

export class WebGLRHIShaderModule
    extends WebGLObjectBase
    implements RHIShaderModule, DisposableWebGLObject
{
    readonly device: WebGLRHIDevice;
    readonly language = 'glsl' as const;
    readonly stage: 'vertex' | 'fragment';
    readonly code: string;
    readonly preparedBindings?: RHIPreparedShaderBindings;
    readonly native: WebGLShader;
    private readonly owned: boolean;
    private disposed = false;

    constructor(
        device: WebGLRHIDevice,
        descriptor: RHIShaderModuleDescriptor,
        native?: WebGLShader,
        owned = true,
        compile = true
    ) {
        super(descriptor.label);
        if (descriptor.language !== 'glsl') {
            throw new Error(
                'WebGL 2 RHI consumes prepared GLSL only; WGSL translation belongs to the shader layer'
            );
        }
        const stage: unknown = descriptor.stage;
        if (stage !== 'vertex' && stage !== 'fragment') {
            throw new Error('WebGL 2 RHI supports vertex and fragment shader modules only');
        }
        this.device = device;
        this.stage = stage;
        this.code = descriptor.code;
        const preparedBindings = snapshotPreparedShaderBindings(descriptor.preparedBindings);
        if (preparedBindings) this.preparedBindings = preparedBindings;
        const gl = device.gl;
        this.native =
            native ??
            glResource(
                gl.createShader(
                    descriptor.stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER
                ),
                'a shader'
            );
        this.owned = owned;
        device.registerDisposable(this);
        device.diagnostics?.recordResource('shaderModule');
        if (compile) {
            gl.shaderSource(this.native, descriptor.code);
            gl.compileShader(this.native);
            if (gl.getShaderParameter(this.native, gl.COMPILE_STATUS) !== true) {
                const message = gl.getShaderInfoLog(this.native) ?? 'Unknown GLSL compiler error';
                if (owned) gl.deleteShader(this.native);
                this.disposed = true;
                device.unregisterDisposable(this);
                throw new Error(`${descriptor.stage} shader compilation failed: ${message}`);
            }
        }
    }

    dispose(contextLost = false): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.owned && !contextLost) this.device.gl.deleteShader(this.native);
        this.device.unregisterDisposable(this);
    }

    assertUsable(): void {
        this.device.assertAlive();
        if (this.disposed) throw new Error('Shader module is no longer valid');
    }
}

function snapshotPreparedShaderBindings(
    source: RHIPreparedShaderBindings | undefined
): RHIPreparedShaderBindings | undefined {
    if (!source) return undefined;
    const namePattern = /^[A-Za-z_]\w*$/u;
    const uniformBlocks = (source.uniformBlocks ?? []).map(binding => {
        if (!namePattern.test(binding.name)) {
            throw new TypeError(`Invalid prepared GLSL uniform block name: ${binding.name}`);
        }
        requireInteger(binding.group, `Uniform block ${binding.name} group`);
        requireInteger(binding.binding, `Uniform block ${binding.name} binding`);
        return Object.freeze({ ...binding });
    });
    const samplers = (source.samplers ?? []).map(binding => {
        if (!namePattern.test(binding.name)) {
            throw new TypeError(`Invalid prepared GLSL sampler name: ${binding.name}`);
        }
        requireInteger(binding.arrayIndex, `Sampler ${binding.name} array index`);
        requireInteger(binding.group, `Sampler ${binding.name} group`);
        requireInteger(binding.textureBinding, `Sampler ${binding.name} texture binding`);
        requireInteger(binding.samplerBinding, `Sampler ${binding.name} sampler binding`);
        return Object.freeze({ ...binding });
    });
    return Object.freeze({
        uniformBlocks: Object.freeze(uniformBlocks),
        samplers: Object.freeze(samplers)
    });
}

export function cloneLayoutEntry(entry: RHIBindGroupLayoutEntry): RHIBindGroupLayoutEntry {
    const resourceCount =
        Number(entry.buffer !== undefined) +
        Number(entry.sampler !== undefined) +
        Number(entry.texture !== undefined) +
        Number(entry.storageTexture !== undefined);
    if (resourceCount !== 1)
        throw new Error('Each bind group layout entry must describe exactly one resource');
    if ((entry.visibility & ~(RHIShaderStage.VERTEX | RHIShaderStage.FRAGMENT)) !== 0) {
        throw new Error('Bind group visibility contains a stage unsupported by WebGL 2');
    }
    if (entry.buffer?.type === 'storage' || entry.buffer?.type === 'read-only-storage') {
        throw new Error('WebGL 2 RHI does not support storage buffers');
    }
    if (entry.storageTexture) throw new Error('WebGL 2 RHI does not support storage textures');
    if (entry.buffer) {
        return Object.freeze({
            binding: entry.binding,
            visibility: entry.visibility,
            buffer: Object.freeze({ ...entry.buffer })
        });
    }
    if (entry.sampler) {
        return Object.freeze({
            binding: entry.binding,
            visibility: entry.visibility,
            sampler: Object.freeze({ ...entry.sampler })
        });
    }
    if (entry.texture) {
        return Object.freeze({
            binding: entry.binding,
            visibility: entry.visibility,
            texture: Object.freeze({ ...entry.texture })
        });
    }
    throw new Error('WebGL 2 RHI does not support this bind group layout entry');
}

export function bindGroupLayoutKey(entries: readonly RHIBindGroupLayoutEntry[]): string {
    let key = '';
    for (const entry of entries) {
        key += `${String(entry.binding)},${String(entry.visibility)},`;
        if (entry.buffer) {
            key += `b,${entry.buffer.type ?? 'uniform'},${entry.buffer.hasDynamicOffset === true ? '1' : '0'},${String(entry.buffer.minBindingSize ?? 0)};`;
        } else if (entry.sampler) {
            key += `s,${entry.sampler.type ?? 'filtering'};`;
        } else if (entry.texture) {
            key += `t,${entry.texture.sampleType ?? 'float'},${entry.texture.viewDimension ?? '2d'},${entry.texture.multisampled === true ? '1' : '0'};`;
        } else {
            key += 'unsupported;';
        }
    }
    return key;
}

export class WebGLRHIBindGroupLayout
    extends WebGLObjectBase
    implements RHIBindGroupLayout, DisposableWebGLObject
{
    readonly device: WebGLRHIDevice;
    readonly entries: readonly RHIBindGroupLayoutEntry[];
    readonly cacheKey: string;
    private disposed = false;

    constructor(device: WebGLRHIDevice, descriptor: RHIBindGroupLayoutDescriptor) {
        super(descriptor.label);
        if (descriptor.entries.length > device.limits.maxBindingsPerBindGroup) {
            throw new RangeError('Bind group layout has too many entries');
        }
        const bindings = new Set<number>();
        const entries = descriptor.entries
            .map(cloneLayoutEntry)
            .sort((left, right) => left.binding - right.binding);
        for (const entry of entries) {
            requireInteger(entry.binding, 'Bind group binding');
            if (bindings.has(entry.binding))
                throw new Error(`Duplicate bind group binding ${String(entry.binding)}`);
            bindings.add(entry.binding);
        }
        this.device = device;
        this.entries = Object.freeze(entries);
        this.cacheKey = bindGroupLayoutKey(entries);
        device.registerDisposable(this);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.device.unregisterDisposable(this);
    }
}

export class WebGLRHIPipelineLayout
    extends WebGLObjectBase
    implements RHIPipelineLayout, DisposableWebGLObject
{
    readonly device: WebGLRHIDevice;
    readonly bindGroupLayouts: readonly WebGLRHIBindGroupLayout[];
    readonly cacheKey: string;
    private disposed = false;

    constructor(device: WebGLRHIDevice, descriptor: RHIPipelineLayoutDescriptor) {
        super(descriptor.label);
        if (descriptor.bindGroupLayouts.length > device.limits.maxBindGroups) {
            throw new RangeError('Pipeline layout has too many bind groups');
        }
        const layouts = descriptor.bindGroupLayouts.map(layout =>
            device.requireBindGroupLayout(layout)
        );
        this.device = device;
        this.bindGroupLayouts = Object.freeze(layouts);
        this.cacheKey = layouts.map(layout => layout.id).join(',');
        device.registerDisposable(this);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.device.unregisterDisposable(this);
    }
}

export function isBufferBinding(resource: unknown): resource is RHIBufferBinding {
    return typeof resource === 'object' && resource !== null && 'buffer' in resource;
}

function textureMatchesSampleType(
    view: WebGLRHITextureView,
    sampleType: RHITextureSampleType,
    filterable: boolean
): boolean {
    const kind = view.texture.formatInfo.kind;
    const floatSampled = kind === 'float' || kind === 'compressed';
    switch (sampleType) {
        case 'float':
            return floatSampled && filterable;
        case 'unfilterable-float':
            return floatSampled;
        case 'depth':
            return view.aspect !== 'stencil-only' && (kind === 'depth' || kind === 'depth-stencil');
        case 'sint':
            return kind === 'sint';
        case 'uint':
            return kind === 'uint';
    }
}

export class WebGLRHIBindGroup
    extends WebGLObjectBase
    implements RHIBindGroup, DisposableWebGLObject
{
    readonly device: WebGLRHIDevice;
    readonly layout: WebGLRHIBindGroupLayout;
    readonly entries: readonly RHIBindGroupEntry[];
    readonly entriesByBinding = new Map<number, RHIBindGroupEntry>();
    private disposed = false;

    constructor(device: WebGLRHIDevice, descriptor: RHIBindGroupDescriptor) {
        super(descriptor.label);
        this.device = device;
        this.layout = device.requireBindGroupLayout(descriptor.layout);
        const entries = descriptor.entries.map(entry => {
            const resource = isBufferBinding(entry.resource)
                ? Object.freeze({
                      buffer: entry.resource.buffer,
                      ...(entry.resource.offset === undefined
                          ? {}
                          : { offset: entry.resource.offset }),
                      ...(entry.resource.size === undefined ? {} : { size: entry.resource.size })
                  })
                : entry.resource;
            return Object.freeze({ binding: entry.binding, resource });
        });
        for (const entry of entries) {
            requireInteger(entry.binding, 'Bind group binding');
            if (this.entriesByBinding.has(entry.binding))
                throw new Error(`Duplicate bind group binding ${String(entry.binding)}`);
            this.entriesByBinding.set(entry.binding, entry);
        }
        if (this.entriesByBinding.size !== this.layout.entries.length) {
            throw new Error('Bind group entries must exactly match the layout');
        }
        for (const layoutEntry of this.layout.entries) {
            const entry = this.entriesByBinding.get(layoutEntry.binding);
            if (!entry)
                throw new Error(`Missing bind group binding ${String(layoutEntry.binding)}`);
            const resource = entry.resource;
            if (layoutEntry.buffer) {
                if (!isBufferBinding(resource))
                    throw new TypeError(`Binding ${String(entry.binding)} requires a buffer`);
                const buffer = device.requireBuffer(resource.buffer);
                buffer.assertUsable();
                if (!hasUsage(buffer.usage, RHIBufferUsage.UNIFORM)) {
                    throw new Error(`Binding ${String(entry.binding)} buffer lacks UNIFORM usage`);
                }
                const offset = resource.offset ?? 0;
                const size = resource.size ?? buffer.size - offset;
                requireRange(offset, size, buffer.size, 'Uniform buffer binding');
                if (
                    layoutEntry.buffer.minBindingSize !== undefined &&
                    size < layoutEntry.buffer.minBindingSize
                ) {
                    throw new RangeError(
                        `Binding ${String(entry.binding)} is smaller than minBindingSize`
                    );
                }
            } else if (layoutEntry.sampler) {
                const sampler = device.requireSampler(resource);
                sampler.assertUsable();
                const samplerType = layoutEntry.sampler.type ?? 'filtering';
                if ((samplerType === 'comparison') !== sampler.comparison) {
                    throw new Error(
                        `Binding ${String(entry.binding)} sampler comparison type does not match its layout`
                    );
                }
                if (samplerType === 'non-filtering' && sampler.filtering) {
                    throw new Error(
                        `Binding ${String(entry.binding)} requires a non-filtering sampler`
                    );
                }
            } else if (layoutEntry.texture) {
                const view = device.requireTextureView(resource);
                view.texture.assertUsable();
                if (!hasUsage(view.texture.usage, RHITextureUsage.TEXTURE_BINDING)) {
                    throw new Error(
                        `Binding ${String(entry.binding)} texture lacks TEXTURE_BINDING usage`
                    );
                }
                const sampleType = layoutEntry.texture.sampleType ?? 'float';
                const capabilities = device.getTextureFormatCapabilities(view.format);
                if (!textureMatchesSampleType(view, sampleType, capabilities.filterable)) {
                    throw new Error(
                        `Binding ${String(entry.binding)} texture format ${view.format} is incompatible with ${sampleType} sample type`
                    );
                }
                if ((layoutEntry.texture.multisampled ?? false) !== view.texture.sampleCount > 1) {
                    throw new Error(
                        `Binding ${String(entry.binding)} texture sample count does not match its layout`
                    );
                }
                const expectedDimension = layoutEntry.texture.viewDimension ?? '2d';
                if (view.dimension !== expectedDimension) {
                    throw new Error(
                        `Binding ${String(entry.binding)} texture view dimension does not match its layout`
                    );
                }
                if (
                    view.baseMipLevel !== 0 ||
                    view.mipLevelCount !== view.texture.mipLevelCount ||
                    view.baseArrayLayer !== 0 ||
                    view.arrayLayerCount !== view.texture.depthOrArrayLayers ||
                    view.dimension !== defaultViewDimension(view.texture)
                ) {
                    throw new Error(
                        'WebGL 2 sampled texture bindings require a full native texture view'
                    );
                }
            }
        }
        this.entries = Object.freeze(entries);
        device.registerDisposable(this);
        device.diagnostics?.recordResource('bindGroup');
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.device.unregisterDisposable(this);
    }

    assertUsable(): void {
        this.device.assertAlive();
        if (this.disposed) throw new Error('Bind group is no longer valid');
    }
}
