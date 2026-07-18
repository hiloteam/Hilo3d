import {
    RHIBufferUsage,
    RHITextureUsage,
    RHIValidationError,
    assertRHIBufferMapRange,
    assertRHIGetMappedRange,
    normalizeRHIBufferDescriptor,
    normalizeRHISamplerDescriptor,
    normalizeRHIShaderDescriptor,
    normalizeRHITextureDescriptor,
    normalizeRHITextureViewDescriptor,
    snapshotRHIDataSource,
    type RHIBuffer,
    type RHIBufferDescriptor,
    type RHIBufferMapMode,
    type RHIBufferMapState,
    type RHINormalizedBufferDescriptor,
    type RHINormalizedSamplerDescriptor,
    type RHINormalizedShaderDescriptor,
    type RHINormalizedTextureDescriptor,
    type RHINormalizedTextureViewDescriptor,
    type RHISampler,
    type RHISamplerDescriptor,
    type RHIShader,
    type RHIShaderDescriptor,
    type RHITexture,
    type RHITextureDescriptor,
    type RHITextureView,
    type RHITextureViewDescriptor
} from '../../core';
import type { WebGL2RHIDevice } from './WebGL2Device';
import {
    webGL2AddressMode,
    webGL2Compare,
    webGL2FormatInfo,
    type WebGL2FormatInfo
} from './WebGL2Formats';
import {
    WEBGL2_BUFFER_OBJECT_KIND,
    WEBGL2_SAMPLER_OBJECT_KIND,
    WEBGL2_SHADER_OBJECT_KIND,
    WEBGL2_TEXTURE_OBJECT_KIND,
    WEBGL2_TEXTURE_VIEW_OBJECT_KIND,
    WebGL2DestroyableBase,
    WebGL2ResourceBase,
    requireNative
} from './WebGL2Internal';

function normalizeWebGL2BufferDescriptor(
    owner: WebGL2RHIDevice,
    descriptor: RHIBufferDescriptor
): Readonly<RHINormalizedBufferDescriptor> {
    const normalized = normalizeRHIBufferDescriptor(descriptor, owner.capabilities);
    if (
        (normalized.usage & RHIBufferUsage.INDEX) !== 0 &&
        (normalized.usage & RHIBufferUsage.VERTEX) !== 0
    ) {
        throw new RHIValidationError(
            'unsupported-feature',
            'WebGL2 buffers cannot be both index and vertex buffers',
            'buffer.usage'
        );
    }
    return normalized;
}

function normalizeWebGL2TextureDescriptor(
    owner: WebGL2RHIDevice,
    descriptor: RHITextureDescriptor
): Readonly<RHINormalizedTextureDescriptor> {
    const normalized = normalizeRHITextureDescriptor(descriptor, owner.capabilities);
    if (normalized.viewFormats.some(format => format !== normalized.format)) {
        throw new RHIValidationError(
            'unsupported-feature',
            'WebGL2 cannot reinterpret texture formats without native texture views',
            'texture.viewFormats'
        );
    }
    return normalized;
}

export class WebGL2Buffer extends WebGL2ResourceBase implements RHIBuffer {
    readonly descriptor: Readonly<RHINormalizedBufferDescriptor>;
    readonly size: number;
    readonly usage: number;
    readonly native: WebGLBuffer;
    readonly nativeTarget: GLenum;
    #mapState: RHIBufferMapState = 'unmapped';
    #mappedData: ArrayBuffer | null = null;
    #mappedMode: RHIBufferMapMode | null = null;
    #mappedOffset = 0;
    #mappedSize = 0;
    readonly #mappedWriteRanges: { readonly offset: number; readonly data: ArrayBuffer }[] = [];

    constructor(owner: WebGL2RHIDevice, descriptor: RHIBufferDescriptor) {
        const normalized = normalizeWebGL2BufferDescriptor(owner, descriptor);
        super(owner, normalized.label, normalized.lifetime, WEBGL2_BUFFER_OBJECT_KIND);
        this.descriptor = normalized;
        this.size = normalized.size;
        this.usage = normalized.usage;
        const gl = owner.gl;
        this.native = requireNative(gl.createBuffer(), 'buffer');
        const isIndexBuffer = (this.usage & RHIBufferUsage.INDEX) !== 0;
        const allocationTarget = isIndexBuffer
            ? gl.ELEMENT_ARRAY_BUFFER
            : (this.usage & RHIBufferUsage.VERTEX) !== 0
              ? gl.ARRAY_BUFFER
              : (this.usage & RHIBufferUsage.UNIFORM) !== 0
                ? gl.UNIFORM_BUFFER
                : gl.COPY_WRITE_BUFFER;
        // WebGL associates a buffer with its first non-copy target. Establish index-buffer typing
        // on the default VAO so the element binding of a cached draw VAO is never touched. The next
        // draw binds its cached VAO explicitly; restoring a prior VAO here would be unsafe when
        // resource eviction has already deleted that native object.
        if (isIndexBuffer) owner.state.bindVertexArray(null);
        owner.state.bindBuffer(allocationTarget, this.native);
        const data =
            descriptor.initialData === undefined
                ? null
                : snapshotRHIDataSource(descriptor.initialData);
        const nativeUsage =
            (this.usage & RHIBufferUsage.COPY_DST) !== 0 ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
        gl.bufferData(allocationTarget, this.size, nativeUsage);
        if (data !== null && data.byteLength > 0) {
            gl.bufferSubData(allocationTarget, 0, data);
        }
        // Mutations use a copy target so they never alter a VAO-local element-array binding.
        this.nativeTarget = isIndexBuffer ? gl.COPY_WRITE_BUFFER : allocationTarget;
        if (normalized.mappedAtCreation) {
            this.#mappedData = new ArrayBuffer(this.size);
            this.#mapState = 'mapped';
            this.#mappedMode = 'write';
            this.#mappedSize = this.size;
        }
        owner.assertNoNativeError('createBuffer');
        this.trackNativeObject('buffer');
    }

    get mapState(): RHIBufferMapState {
        return this.#mapState;
    }

    mapAsync(mode: RHIBufferMapMode, offset = 0, size = this.size - offset): Promise<void> {
        try {
            this.assertUsable('buffer');
            if (this.#mapState !== 'unmapped')
                throw new RHIValidationError('invalid-state', 'buffer is already mapped', 'buffer');
            const requiredUsage =
                mode === 'read' ? RHIBufferUsage.MAP_READ : RHIBufferUsage.MAP_WRITE;
            if ((this.usage & requiredUsage) === 0)
                throw new RHIValidationError(
                    'invalid-descriptor',
                    `buffer lacks MAP_${mode.toUpperCase()} usage`,
                    'buffer.usage'
                );
            assertRHIBufferMapRange(this.size, offset, size, 'buffer.map');
            this.#mapState = 'pending';
            this.#mappedMode = mode;
            this.#mappedOffset = offset;
            this.#mappedSize = size;
            this.#mappedWriteRanges.length = 0;
            this.#mappedData = new ArrayBuffer(size);
            if (mode === 'read') {
                const gl = this.owner.gl;
                this.owner.state.bindBuffer(gl.COPY_READ_BUFFER, this.native);
                gl.getBufferSubData(gl.COPY_READ_BUFFER, offset, new Uint8Array(this.#mappedData));
                this.owner.assertNoNativeError('buffer.mapAsync');
            }
            this.#mapState = 'mapped';
            return Promise.resolve();
        } catch (error) {
            this.#mapState = 'unmapped';
            this.#mappedMode = null;
            this.#mappedData = null;
            this.#mappedWriteRanges.length = 0;
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    getMappedRange(offset = 0, size = this.size - offset): ArrayBuffer {
        this.assertUsable('buffer');
        if (this.#mapState !== 'mapped' || this.#mappedData === null) {
            throw new RHIValidationError('invalid-state', 'buffer is not mapped', 'buffer');
        }
        assertRHIGetMappedRange(
            this.#mappedOffset,
            this.#mappedSize,
            offset,
            size,
            'buffer.mappedRange'
        );
        const relativeOffset = offset - this.#mappedOffset;
        if (relativeOffset === 0 && size === this.#mappedSize) return this.#mappedData;
        const range = this.#mappedData.slice(relativeOffset, relativeOffset + size);
        if (this.#mappedMode === 'write') this.#mappedWriteRanges.push({ offset, data: range });
        return range;
    }

    unmap(): void {
        this.assertUsable('buffer');
        if (this.#mapState === 'unmapped') return;
        const data = this.#mappedData;
        if (data !== null && this.#mappedMode === 'write') {
            for (const range of this.#mappedWriteRanges) {
                new Uint8Array(data, range.offset - this.#mappedOffset, range.data.byteLength).set(
                    new Uint8Array(range.data)
                );
            }
            const gl = this.owner.gl;
            this.owner.state.bindBuffer(this.nativeTarget, this.native);
            gl.bufferSubData(this.nativeTarget, this.#mappedOffset, new Uint8Array(data));
            this.owner.assertNoNativeError('buffer.unmap');
        }
        this.#mappedData = null;
        this.#mappedMode = null;
        this.#mappedOffset = 0;
        this.#mappedSize = 0;
        this.#mappedWriteRanges.length = 0;
        this.#mapState = 'unmapped';
    }

    protected releaseNative(contextLost: boolean): void {
        this.#mappedData = null;
        this.#mappedMode = null;
        this.#mappedOffset = 0;
        this.#mappedSize = 0;
        this.#mappedWriteRanges.length = 0;
        this.#mapState = 'unmapped';
        if (!contextLost) this.owner.gl.deleteBuffer(this.native);
    }
}

function textureTarget(
    gl: WebGL2RenderingContext,
    descriptor: RHINormalizedTextureDescriptor
): GLenum {
    if (descriptor.viewDimension === 'cube') return gl.TEXTURE_CUBE_MAP;
    if (descriptor.dimension === '3d') return gl.TEXTURE_3D;
    return descriptor.viewDimension === '2d-array' || descriptor.size.depthOrArrayLayers > 1
        ? gl.TEXTURE_2D_ARRAY
        : gl.TEXTURE_2D;
}

export class WebGL2Texture extends WebGL2ResourceBase implements RHITexture {
    readonly descriptor: Readonly<RHINormalizedTextureDescriptor>;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: number;
    readonly dimension;
    readonly format;
    readonly usage: number;
    readonly target: GLenum;
    readonly nativeTexture: WebGLTexture | null;
    readonly nativeRenderbuffer: WebGLRenderbuffer | null;
    readonly formatInfo: WebGL2FormatInfo;
    readonly isSurfaceTexture: boolean;
    readonly isSurfaceDepthStencilTexture: boolean;
    #samplingBaseMipLevel = 0;
    #samplingMaximumMipLevel: number;

    constructor(
        owner: WebGL2RHIDevice,
        descriptor: RHITextureDescriptor,
        options: { readonly surface?: boolean; readonly surfaceDepthStencil?: boolean } = {}
    ) {
        const normalized = normalizeWebGL2TextureDescriptor(owner, descriptor);
        super(owner, normalized.label, normalized.lifetime, WEBGL2_TEXTURE_OBJECT_KIND);
        this.descriptor = normalized;
        this.width = normalized.size.width;
        this.height = normalized.size.height;
        this.depthOrArrayLayers = normalized.size.depthOrArrayLayers;
        this.mipLevelCount = normalized.mipLevelCount;
        this.sampleCount = normalized.sampleCount;
        this.dimension = normalized.dimension;
        this.format = normalized.format;
        this.usage = normalized.usage;
        this.isSurfaceDepthStencilTexture = options.surfaceDepthStencil === true;
        this.isSurfaceTexture = options.surface === true || this.isSurfaceDepthStencilTexture;
        this.#samplingMaximumMipLevel = this.mipLevelCount - 1;
        const gl = owner.gl;
        this.target = textureTarget(gl, normalized);
        this.formatInfo = webGL2FormatInfo(gl, normalized.format);
        if (this.isSurfaceTexture) {
            this.nativeTexture = null;
            this.nativeRenderbuffer = null;
            return;
        }
        if (this.sampleCount > 1) {
            if ((this.usage & RHITextureUsage.TEXTURE_BINDING) !== 0) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'WebGL2 cannot sample a multisampled renderbuffer',
                    'texture.usage'
                );
            }
            const native = requireNative(gl.createRenderbuffer(), 'renderbuffer');
            this.nativeTexture = null;
            this.nativeRenderbuffer = native;
            owner.state.bindRenderbuffer(native);
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                this.sampleCount,
                this.formatInfo.internalFormat,
                this.width,
                this.height
            );
        } else {
            const native = requireNative(gl.createTexture(), 'texture');
            this.nativeTexture = native;
            this.nativeRenderbuffer = null;
            owner.state.activateTextureBinding(0, this.target, native);
            if (this.target === gl.TEXTURE_2D || this.target === gl.TEXTURE_CUBE_MAP) {
                gl.texStorage2D(
                    this.target,
                    this.mipLevelCount,
                    this.formatInfo.internalFormat,
                    this.width,
                    this.height
                );
            } else {
                gl.texStorage3D(
                    this.target,
                    this.mipLevelCount,
                    this.formatInfo.internalFormat,
                    this.width,
                    this.height,
                    this.depthOrArrayLayers
                );
            }
        }
        owner.assertNoNativeError('createTexture');
        this.trackNativeObject(this.sampleCount > 1 ? 'renderbuffer' : 'texture');
    }

    createView(descriptor: RHITextureViewDescriptor = {}): WebGL2TextureView {
        this.assertUsable('texture');
        const normalized = normalizeRHITextureViewDescriptor(this, descriptor);
        if (normalized.format !== this.format) {
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 cannot reinterpret texture formats without native texture views',
                'textureView.format'
            );
        }
        return new WebGL2TextureView(this.owner, this, normalized);
    }

    /** Validate immutable WebGL texture-view restrictions while a bind group is prepared. */
    validateSamplingView(view: WebGL2TextureView): void {
        if (this.nativeTexture === null) {
            throw new RHIValidationError(
                'invalid-state',
                'surface and multisample textures cannot be sampled',
                'bindGroup'
            );
        }
        if (view.dimension !== this.descriptor.viewDimension) {
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 cannot sample a lower-dimensional attachment subview',
                'bindGroup.textureView'
            );
        }
        if (
            view.dimension !== '3d' &&
            (view.descriptor.baseArrayLayer !== 0 ||
                view.descriptor.arrayLayerCount !== this.depthOrArrayLayers)
        ) {
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 cannot restrict sampled array-layer ranges without native texture views',
                'bindGroup.textureView'
            );
        }
    }

    /** Bind a view whose immutable WebGL sampling restrictions were validated at preparation. */
    bindPreparedForSampling(unit: number, view: WebGL2TextureView): void {
        const bindingChanged = this.owner.state.bindTexture(unit, this.target, this.nativeTexture);
        const maximumMipLevel = view.descriptor.baseMipLevel + view.descriptor.mipLevelCount - 1;
        if (
            this.#samplingBaseMipLevel !== view.descriptor.baseMipLevel ||
            this.#samplingMaximumMipLevel !== maximumMipLevel
        ) {
            if (!bindingChanged) this.owner.state.activeTexture(unit);
            this.owner.state.setTextureMipRange(
                this.target,
                view.descriptor.baseMipLevel,
                maximumMipLevel
            );
            this.#samplingBaseMipLevel = view.descriptor.baseMipLevel;
            this.#samplingMaximumMipLevel = maximumMipLevel;
        }
    }

    /** @internal Bind the complete immutable mip chain for frame-scoped mipmap generation. */
    bindFullMipChain(unit: number): void {
        if (this.nativeTexture === null) {
            throw new RHIValidationError(
                'invalid-state',
                'surface and multisample textures have no mip chain',
                'texture'
            );
        }
        this.owner.state.activateTextureBinding(unit, this.target, this.nativeTexture);
        const maximumMipLevel = this.mipLevelCount - 1;
        if (this.#samplingBaseMipLevel !== 0 || this.#samplingMaximumMipLevel !== maximumMipLevel) {
            this.owner.state.setTextureMipRange(this.target, 0, maximumMipLevel);
            this.#samplingBaseMipLevel = 0;
            this.#samplingMaximumMipLevel = maximumMipLevel;
        }
    }

    protected releaseNative(contextLost: boolean): void {
        if (contextLost || this.isSurfaceTexture) return;
        this.owner.framebufferCache.releaseTexture(this.id);
        if (this.nativeTexture) this.owner.gl.deleteTexture(this.nativeTexture);
        if (this.nativeRenderbuffer) this.owner.gl.deleteRenderbuffer(this.nativeRenderbuffer);
    }
}

export class WebGL2TextureView extends WebGL2DestroyableBase implements RHITextureView {
    readonly format;
    readonly dimension;
    readonly aspect;

    constructor(
        owner: WebGL2RHIDevice,
        readonly texture: WebGL2Texture,
        readonly descriptor: Readonly<RHINormalizedTextureViewDescriptor>
    ) {
        super(owner, descriptor.label, WEBGL2_TEXTURE_VIEW_OBJECT_KIND);
        this.format = descriptor.format;
        this.dimension = descriptor.dimension;
        this.aspect = descriptor.aspect;
    }

    protected releaseNative(contextLost: boolean): void {
        void contextLost;
    }
}

export class WebGL2Sampler extends WebGL2ResourceBase implements RHISampler {
    readonly descriptor: Readonly<RHINormalizedSamplerDescriptor>;
    readonly native: WebGLSampler;

    constructor(owner: WebGL2RHIDevice, descriptor: RHISamplerDescriptor = {}) {
        const normalized = normalizeRHISamplerDescriptor(descriptor, owner.capabilities);
        super(owner, normalized.label, normalized.lifetime, WEBGL2_SAMPLER_OBJECT_KIND);
        this.descriptor = normalized;
        const gl = owner.gl;
        const native = requireNative(gl.createSampler(), 'sampler');
        this.native = native;
        gl.samplerParameteri(
            native,
            gl.TEXTURE_WRAP_S,
            webGL2AddressMode(gl, normalized.addressModeU)
        );
        gl.samplerParameteri(
            native,
            gl.TEXTURE_WRAP_T,
            webGL2AddressMode(gl, normalized.addressModeV)
        );
        gl.samplerParameteri(
            native,
            gl.TEXTURE_WRAP_R,
            webGL2AddressMode(gl, normalized.addressModeW)
        );
        const minFilter =
            normalized.minFilter === 'nearest'
                ? normalized.mipmapFilter === 'nearest'
                    ? gl.NEAREST_MIPMAP_NEAREST
                    : gl.NEAREST_MIPMAP_LINEAR
                : normalized.mipmapFilter === 'nearest'
                  ? gl.LINEAR_MIPMAP_NEAREST
                  : gl.LINEAR_MIPMAP_LINEAR;
        gl.samplerParameteri(native, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.samplerParameteri(
            native,
            gl.TEXTURE_MAG_FILTER,
            normalized.magFilter === 'nearest' ? gl.NEAREST : gl.LINEAR
        );
        gl.samplerParameterf(native, gl.TEXTURE_MIN_LOD, normalized.lodMinClamp);
        gl.samplerParameterf(native, gl.TEXTURE_MAX_LOD, normalized.lodMaxClamp);
        if (normalized.maxAnisotropy > 1) {
            const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
            if (anisotropy === null) {
                throw new RHIValidationError(
                    'unsupported-feature',
                    'anisotropic filtering is unavailable',
                    'sampler.maxAnisotropy'
                );
            }
            gl.samplerParameterf(
                native,
                anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
                normalized.maxAnisotropy
            );
        }
        if (normalized.compare !== undefined) {
            gl.samplerParameteri(native, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
            gl.samplerParameteri(
                native,
                gl.TEXTURE_COMPARE_FUNC,
                webGL2Compare(gl, normalized.compare)
            );
        }
        owner.assertNoNativeError('createSampler');
        this.trackNativeObject('sampler');
    }

    protected releaseNative(contextLost: boolean): void {
        if (!contextLost) this.owner.gl.deleteSampler(this.native);
    }
}

export class WebGL2Shader extends WebGL2ResourceBase implements RHIShader {
    readonly descriptor: Readonly<RHINormalizedShaderDescriptor>;
    readonly artifact;
    readonly stage;
    readonly native: WebGLShader;

    constructor(owner: WebGL2RHIDevice, descriptor: RHIShaderDescriptor) {
        const normalized = normalizeRHIShaderDescriptor(descriptor, owner);
        super(owner, normalized.label, normalized.lifetime, WEBGL2_SHADER_OBJECT_KIND);
        this.descriptor = normalized;
        this.artifact = normalized.artifact;
        if (normalized.artifact.backend !== 'webgl2') {
            throw new RHIValidationError(
                'invalid-descriptor',
                'shader artifact does not target WebGL2',
                'shader.artifact'
            );
        }
        if (normalized.artifact.stage === 'compute') {
            throw new RHIValidationError(
                'unsupported-feature',
                'WebGL2 does not support compute shaders',
                'shader.artifact.stage'
            );
        }
        this.stage = normalized.artifact.stage;
        if (normalized.artifact.entryPoint !== 'main') {
            throw new RHIValidationError(
                'unsupported-feature',
                'GLSL ES requires the main entry point',
                'shader.artifact.entryPoint'
            );
        }
        const gl = owner.gl;
        const native = requireNative(
            gl.createShader(this.stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER),
            'shader'
        );
        this.native = native;
        gl.shaderSource(native, normalized.artifact.code);
        gl.compileShader(native);
        if (gl.getShaderParameter(native, gl.COMPILE_STATUS) !== true) {
            const message = gl.getShaderInfoLog(native) ?? 'unknown GLSL compile error';
            gl.deleteShader(native);
            throw new Error(`WebGL2 shader compile failed: ${message}`);
        }
        owner.assertNoNativeError('createShader');
        this.trackNativeObject('shaderModule');
    }

    protected releaseNative(contextLost: boolean): void {
        if (!contextLost) this.owner.gl.deleteShader(this.native);
    }
}
