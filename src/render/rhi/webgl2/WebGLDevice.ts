import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHI,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupLayout,
    type RHIBindGroupLayoutDescriptor,
    type RHIBuffer,
    type RHIBufferDescriptor,
    type RHIBufferSource,
    type RHICommandBuffer,
    type RHICreateOptions,
    type RHIDevice,
    type RHIDeviceLostInfo,
    type RHIExtent3D,
    type RHIFeatureName,
    type RHIImageCopyBuffer,
    type RHIImageCopyExternalImage,
    type RHIImageCopyTexture,
    type RHIImageDataLayout,
    type RHILimits,
    type RHIPipelineLayout,
    type RHIPipelineLayoutDescriptor,
    type RHIQueue,
    type RHIRenderPassDescriptor,
    type RHIRenderPipeline,
    type RHIRenderPipelineDescriptor,
    type RHISamplerDescriptor,
    type RHIShaderModule,
    type RHIShaderModuleDescriptor,
    type RHISurface,
    type RHISurfaceConfiguration,
    type RHITexture,
    type RHITextureDescriptor,
    type RHITextureFormat,
    type RHITextureFormatCapabilities
} from '../RHI';
import {
    BoundedCache,
    WebGLDestroyableBase,
    WebGLObjectBase,
    WebGLRHIDiagnostics,
    WebGLRHIState,
    cloneBytes,
    glNumber,
    glResource,
    hasUsage,
    requireInteger,
    requirePositiveInteger,
    requireRange,
    sourceBytes,
    type DisposableWebGLObject,
    type WebGLRHICreateOptions
} from './WebGLInternal';
import {
    compressedExtensions,
    webGLFormatCapabilities,
    type CompressedTextureExtensions,
    type WebGLFormatInfo
} from './WebGLFormats';
import {
    WebGLRHIBindGroup,
    WebGLRHIBindGroupLayout,
    WebGLRHIBuffer,
    WebGLRHIPipelineLayout,
    WebGLRHISampler,
    WebGLRHIShaderModule,
    WebGLRHITexture,
    WebGLRHITextureView,
    bindGroupLayoutKey,
    cloneLayoutEntry,
    normalizeSamplerDescriptor,
    samplerKey
} from './WebGLResources';
import {
    WebGLRHIRenderPipeline,
    renderPipelineKey,
    snapshotPipelineDescriptor
} from './WebGLPipeline';
import {
    WebGLRHICommandBuffer,
    WebGLRHICommandEncoder,
    type WebGLRenderPassTarget
} from './WebGLCommands';

interface CachedFramebuffer {
    readonly native: WebGLFramebuffer;
    readonly width: number;
    readonly height: number;
    readonly sampleCount: number;
}

function mipDimension(value: number, level: number): number {
    return Math.max(1, value >> level);
}

function attachmentPointForView(gl: WebGL2RenderingContext, view: WebGLRHITextureView): GLenum {
    const kind = view.texture.formatInfo.kind;
    if (view.aspect === 'depth-only' || kind === 'depth') return gl.DEPTH_ATTACHMENT;
    if (view.aspect === 'stencil-only' || kind === 'stencil') return gl.STENCIL_ATTACHMENT;
    if (kind === 'depth-stencil') return gl.DEPTH_STENCIL_ATTACHMENT;
    return gl.COLOR_ATTACHMENT0;
}

function typedPixelData(info: WebGLFormatInfo, bytes: Uint8Array): ArrayBufferView {
    const aligned = (alignment: number): Uint8Array => {
        if (bytes.byteOffset % alignment === 0) return bytes;
        return cloneBytes(bytes);
    };
    switch (info.type) {
        // Numeric constants are stable across WebGL contexts and avoid needing a context argument here.
        case 0x1400:
            return new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        case 0x1401:
            return bytes;
        case 0x1402: {
            const value = aligned(2);
            return new Int16Array(value.buffer, value.byteOffset, value.byteLength / 2);
        }
        case 0x1403:
        case 0x140b: {
            const value = aligned(2);
            return new Uint16Array(value.buffer, value.byteOffset, value.byteLength / 2);
        }
        case 0x1404: {
            const value = aligned(4);
            return new Int32Array(value.buffer, value.byteOffset, value.byteLength / 4);
        }
        case 0x1405:
        case 0x8036:
        case 0x8368:
        case 0x8c3b:
        case 0x84fa:
        case 0x8dad: {
            const value = aligned(4);
            return new Uint32Array(value.buffer, value.byteOffset, value.byteLength / 4);
        }
        case 0x1406: {
            const value = aligned(4);
            return new Float32Array(value.buffer, value.byteOffset, value.byteLength / 4);
        }
        default:
            return bytes;
    }
}

function origin3D(
    origin: RHIImageCopyTexture['origin']
): Required<NonNullable<RHIImageCopyTexture['origin']>> {
    return { x: origin?.x ?? 0, y: origin?.y ?? 0, z: origin?.z ?? 0 };
}

function extent3D(extent: RHIExtent3D): Required<RHIExtent3D> {
    const result = {
        width: extent.width,
        height: extent.height ?? 1,
        depthOrArrayLayers: extent.depthOrArrayLayers ?? 1
    };
    requirePositiveInteger(result.width, 'Copy width');
    requirePositiveInteger(result.height, 'Copy height');
    requirePositiveInteger(result.depthOrArrayLayers, 'Copy depth or array layer count');
    return result;
}

/** @internal Exact WebGL sampler state used by the native WebGL2 driver adapter. */
export interface WebGLLegacySamplerDescriptor {
    readonly cacheKey: string;
    readonly magFilter: GLenum;
    readonly minFilter: GLenum;
    readonly wrapS: GLenum;
    readonly wrapT: GLenum;
    readonly wrapR: GLenum;
    readonly comparison: boolean;
    readonly compareFunction: GLenum;
    readonly anisotropy: number;
    readonly anisotropyParameter?: GLenum;
}

export class WebGLRHIQueue extends WebGLObjectBase implements RHIQueue {
    readonly device: WebGLRHIDevice;
    /** @internal WebGL has one immediate context rather than a separate native queue. */
    readonly native: WebGL2RenderingContext;

    constructor(device: WebGLRHIDevice) {
        super('WebGL2 default queue');
        this.device = device;
        this.native = device.gl;
    }

    submit(commandBuffers: readonly RHICommandBuffer[]): void {
        this.device.assertAlive();
        for (const commandBuffer of commandBuffers) {
            if (
                !(commandBuffer instanceof WebGLRHICommandBuffer) ||
                commandBuffer.device !== this.device
            ) {
                throw new TypeError('Command buffer belongs to a different RHI device');
            }
            if (commandBuffer.submitted)
                throw new Error('Command buffer has already been submitted');
        }
        for (const commandBuffer of commandBuffers) {
            (commandBuffer as WebGLRHICommandBuffer).submitted = true;
        }
        // Encoding already executed the GL calls. submit is deliberately a non-replaying ownership boundary.
        if (this.device.diagnostics) this.device.diagnostics.submissions++;
    }

    writeBuffer(
        buffer: RHIBuffer,
        bufferOffset: number,
        data: RHIBufferSource,
        dataOffset = 0,
        size?: number
    ): void {
        this.device.assertAlive();
        const concrete = this.device.requireBuffer(buffer);
        concrete.assertUsable();
        if (!hasUsage(concrete.usage, RHIBufferUsage.COPY_DST)) {
            throw new Error('Buffer was not created with COPY_DST usage');
        }
        const bytes = sourceBytes(data, dataOffset, size);
        if (bufferOffset % 4 !== 0 || bytes.byteLength % 4 !== 0) {
            throw new RangeError('writeBuffer offset and size must be multiples of 4');
        }
        requireRange(bufferOffset, bytes.byteLength, concrete.size, 'Buffer write');
        this.device.state.bindBuffer(this.device.gl.COPY_WRITE_BUFFER, concrete.native);
        this.device.gl.bufferSubData(this.device.gl.COPY_WRITE_BUFFER, bufferOffset, bytes);
        if (this.device.diagnostics) this.device.diagnostics.bufferUploads++;
    }

    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIBufferSource,
        dataLayout: RHIImageDataLayout,
        size: RHIExtent3D
    ): void {
        this.device.writeTexture(destination, data, dataLayout, size);
    }

    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.device.copyExternalImageToTexture(source, destination, copySize);
    }

    async onSubmittedWorkDone(): Promise<void> {
        this.device.assertAlive();
        const { gl } = this.device;
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!sync) return;
        gl.flush();
        await new Promise<void>((resolve, reject) => {
            const poll = (): void => {
                if (this.device.destroyed) {
                    gl.deleteSync(sync);
                    reject(new Error('Device was lost while waiting for submitted work'));
                    return;
                }
                const status = gl.clientWaitSync(sync, 0, 0);
                if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) {
                    gl.deleteSync(sync);
                    resolve();
                    return;
                }
                if (status === gl.WAIT_FAILED) {
                    gl.deleteSync(sync);
                    reject(new Error('WebGL failed while waiting for submitted work'));
                    return;
                }
                globalThis.setTimeout(poll, 0);
            };
            poll();
        });
    }
}

function createDeviceLimits(gl: WebGL2RenderingContext): RHILimits {
    const maxTextureUnits = glNumber(gl, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, 16);
    const maxUniformBuffers = glNumber(gl, gl.MAX_UNIFORM_BUFFER_BINDINGS, 12);
    return Object.freeze({
        maxTextureDimension1D: 0,
        maxTextureDimension2D: glNumber(gl, gl.MAX_TEXTURE_SIZE, 2048),
        maxTextureDimension3D: glNumber(gl, gl.MAX_3D_TEXTURE_SIZE, 256),
        maxTextureArrayLayers: glNumber(gl, gl.MAX_ARRAY_TEXTURE_LAYERS, 256),
        maxBindGroups: 4,
        maxBindingsPerBindGroup: Math.max(1, maxUniformBuffers + maxTextureUnits * 2),
        maxDynamicUniformBuffersPerPipelineLayout: maxUniformBuffers,
        maxSampledTexturesPerShaderStage: glNumber(gl, gl.MAX_TEXTURE_IMAGE_UNITS, 16),
        maxSamplersPerShaderStage: glNumber(gl, gl.MAX_TEXTURE_IMAGE_UNITS, 16),
        maxUniformBuffersPerShaderStage: Math.min(
            glNumber(gl, gl.MAX_VERTEX_UNIFORM_BLOCKS, 12),
            glNumber(gl, gl.MAX_FRAGMENT_UNIFORM_BLOCKS, 12),
            maxUniformBuffers
        ),
        maxStorageBuffersPerShaderStage: 0,
        maxStorageTexturesPerShaderStage: 0,
        maxStorageBufferBindingSize: 0,
        minStorageBufferOffsetAlignment: 0,
        maxUniformBufferBindingSize: glNumber(gl, gl.MAX_UNIFORM_BLOCK_SIZE, 16384),
        maxVertexBuffers: glNumber(gl, gl.MAX_VERTEX_ATTRIBS, 16),
        maxBufferSize: 0x7fffffff,
        maxVertexAttributes: glNumber(gl, gl.MAX_VERTEX_ATTRIBS, 16),
        // WebGL 2 vertexAttribPointer/vertexAttribIPointer restrict stride to 0..255 bytes.
        maxVertexBufferArrayStride: 255,
        minUniformBufferOffsetAlignment: glNumber(gl, gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT, 256),
        maxColorAttachments: glNumber(gl, gl.MAX_COLOR_ATTACHMENTS, 4)
    });
}

function createDeviceFeatures(
    gl: WebGL2RenderingContext,
    extensions: CompressedTextureExtensions
): ReadonlySet<RHIFeatureName> {
    const features = new Set<RHIFeatureName>();
    if (extensions.bc && extensions.bcSrgb) features.add('texture-compression-bc');
    // ETC2/EAC is core in WebGL 2.
    features.add('texture-compression-etc2');
    if (extensions.astc) features.add('texture-compression-astc');
    features.add('depth32float-stencil8');
    if (gl.getExtension('OES_texture_float_linear')) features.add('float32-filterable');
    return features;
}

function validateRequiredCapabilities(
    features: ReadonlySet<RHIFeatureName>,
    limits: RHILimits,
    options: RHICreateOptions
): void {
    for (const feature of options.requiredFeatures ?? []) {
        if (!features.has(feature))
            throw new Error(`Required RHI feature is unavailable: ${feature}`);
    }
    const requiredLimits = options.requiredLimits;
    if (!requiredLimits) return;
    for (const runtimeKey of Object.keys(requiredLimits)) {
        if (!Object.prototype.hasOwnProperty.call(limits, runtimeKey)) {
            throw new Error(`Unknown required RHI limit: ${runtimeKey}`);
        }
        const key = runtimeKey as keyof RHILimits;
        const required = requiredLimits[key];
        if (required === undefined || required === 0) continue;
        if (!Number.isSafeInteger(required) || required < 0) {
            throw new RangeError(`Required RHI limit ${key} must be a non-negative safe integer`);
        }
        const supported = limits[key];
        const alignment =
            key === 'minUniformBufferOffsetAlignment' || key === 'minStorageBufferOffsetAlignment';
        const unsupported = alignment
            ? supported === 0 || supported > required
            : supported < required;
        if (unsupported) {
            throw new Error(
                `Required RHI limit ${key}=${String(required)} is unsupported by WebGL 2 limit ${String(supported)}`
            );
        }
    }
}

/** Concrete WebGL 2 device. Native adoption helpers are backend-private migration seams. */
export class WebGLRHIDevice extends WebGLDestroyableBase implements RHIDevice {
    readonly gl: WebGL2RenderingContext;
    readonly native: WebGL2RenderingContext;
    readonly state: WebGLRHIState;
    readonly features: ReadonlySet<RHIFeatureName>;
    readonly limits: RHILimits;
    readonly queue: WebGLRHIQueue;
    readonly lost: Promise<RHIDeviceLostInfo>;
    readonly diagnostics: WebGLRHIDiagnostics | null;
    readonly compressedTextureExtensions: CompressedTextureExtensions;
    readonly colorBufferFloat: boolean;
    private resolveLost!: (info: RHIDeviceLostInfo) => void;
    private lossResolved = false;
    private readonly disposableRefs = new Set<WeakRef<DisposableWebGLObject>>();
    private readonly disposableRefsByObject = new WeakMap<
        DisposableWebGLObject,
        WeakRef<DisposableWebGLObject>
    >();
    private registrationsSincePrune = 0;
    private readonly bufferIdentities = new WeakMap<WebGLBuffer, WebGLRHIBuffer>();
    private readonly textureIdentities = new WeakMap<WebGLTexture, WebGLRHITexture>();
    private readonly samplerIdentities = new WeakMap<WebGLSampler, WebGLRHISampler>();
    private readonly pipelineIdentities = new WeakMap<WebGLProgram, WebGLRHIRenderPipeline>();
    private readonly samplerCache = new BoundedCache<WebGLRHISampler>(128);
    private readonly bindGroupLayoutCache = new BoundedCache<WebGLRHIBindGroupLayout>(256);
    private readonly pipelineLayoutCache = new BoundedCache<WebGLRHIPipelineLayout>(128);
    private readonly pipelineCache = new BoundedCache<WebGLRHIRenderPipeline>(256);
    private readonly formatCapabilityCache = new Map<
        RHITextureFormat,
        RHITextureFormatCapabilities
    >();
    private readonly framebufferCache: BoundedCache<CachedFramebuffer>;

    constructor(
        gl: WebGL2RenderingContext,
        options: RHICreateOptions,
        diagnostics: WebGLRHIDiagnostics | null = null
    ) {
        super('WebGL2 device');
        this.gl = gl;
        this.native = gl;
        this.diagnostics = diagnostics;
        this.state = new WebGLRHIState(gl, diagnostics ?? undefined);
        this.compressedTextureExtensions = compressedExtensions(gl);
        this.colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
        this.features = createDeviceFeatures(gl, this.compressedTextureExtensions);
        this.limits = createDeviceLimits(gl);
        validateRequiredCapabilities(this.features, this.limits, options);
        this.queue = new WebGLRHIQueue(this);
        this.lost = new Promise(resolve => {
            this.resolveLost = resolve;
        });
        this.framebufferCache = new BoundedCache(256, record => {
            if (!this._destroyed) gl.deleteFramebuffer(record.native);
        });
    }

    createBuffer(descriptor: RHIBufferDescriptor): WebGLRHIBuffer {
        this.assertAlive();
        return new WebGLRHIBuffer(this, descriptor);
    }

    getTextureFormatCapabilities(format: RHITextureFormat): RHITextureFormatCapabilities {
        this.assertAlive();
        const cached = this.formatCapabilityCache.get(format);
        if (cached) return cached;
        const capabilities = webGLFormatCapabilities(
            this.gl,
            this.compressedTextureExtensions,
            this.colorBufferFloat,
            this.features.has('float32-filterable'),
            format
        );
        this.formatCapabilityCache.set(format, capabilities);
        return capabilities;
    }

    createTexture(descriptor: RHITextureDescriptor): WebGLRHITexture {
        this.assertAlive();
        return new WebGLRHITexture(this, descriptor);
    }

    createSampler(descriptor: RHISamplerDescriptor = {}): WebGLRHISampler {
        this.assertAlive();
        const normalized = normalizeSamplerDescriptor(descriptor);
        const key = samplerKey(normalized);
        const cached = this.samplerCache.get(key);
        if (cached) return cached;
        const sampler = new WebGLRHISampler(this, descriptor);
        this.samplerCache.set(key, sampler);
        return sampler;
    }

    /**
     * @internal Resolve legacy GLenum sampler state through the device-owned immutable cache.
     * This preserves exact non-mipmapped WebGL filters that have no portable WebGPU spelling.
     */
    createLegacySampler(descriptor: WebGLLegacySamplerDescriptor): WebGLSampler {
        this.assertAlive();
        const key = descriptor.cacheKey;
        const cached = this.samplerCache.get(key);
        if (cached) return cached.native;
        const gl = this.gl;
        const native = glResource(gl.createSampler(), 'a legacy WebGL sampler');
        try {
            gl.samplerParameteri(native, gl.TEXTURE_MAG_FILTER, descriptor.magFilter);
            gl.samplerParameteri(native, gl.TEXTURE_MIN_FILTER, descriptor.minFilter);
            gl.samplerParameteri(native, gl.TEXTURE_WRAP_S, descriptor.wrapS);
            gl.samplerParameteri(native, gl.TEXTURE_WRAP_T, descriptor.wrapT);
            gl.samplerParameteri(native, gl.TEXTURE_WRAP_R, descriptor.wrapR);
            gl.samplerParameteri(
                native,
                gl.TEXTURE_COMPARE_MODE,
                descriptor.comparison ? gl.COMPARE_REF_TO_TEXTURE : gl.NONE
            );
            gl.samplerParameteri(native, gl.TEXTURE_COMPARE_FUNC, descriptor.compareFunction);
            if (descriptor.anisotropyParameter !== undefined) {
                gl.samplerParameterf(native, descriptor.anisotropyParameter, descriptor.anisotropy);
            }
        } catch (error) {
            gl.deleteSampler(native);
            throw error;
        }
        const sampler = new WebGLRHISampler(this, {}, native, true, false);
        this.samplerCache.set(key, sampler);
        return native;
    }

    createShaderModule(descriptor: RHIShaderModuleDescriptor): WebGLRHIShaderModule {
        this.assertAlive();
        return new WebGLRHIShaderModule(this, descriptor);
    }

    createBindGroupLayout(descriptor: RHIBindGroupLayoutDescriptor): WebGLRHIBindGroupLayout {
        this.assertAlive();
        const entries = descriptor.entries
            .map(cloneLayoutEntry)
            .sort((left, right) => left.binding - right.binding);
        const key = bindGroupLayoutKey(entries);
        const cached = this.bindGroupLayoutCache.get(key);
        if (cached) return cached;
        const layout = new WebGLRHIBindGroupLayout(this, {
            ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
            entries
        });
        this.bindGroupLayoutCache.set(key, layout);
        return layout;
    }

    createPipelineLayout(descriptor: RHIPipelineLayoutDescriptor): WebGLRHIPipelineLayout {
        this.assertAlive();
        const layouts = descriptor.bindGroupLayouts.map(layout =>
            this.requireBindGroupLayout(layout)
        );
        const key = layouts.map(layout => layout.id).join(',');
        const cached = this.pipelineLayoutCache.get(key);
        if (cached) return cached;
        const layout = new WebGLRHIPipelineLayout(this, {
            ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
            bindGroupLayouts: Object.freeze(layouts)
        });
        this.pipelineLayoutCache.set(key, layout);
        return layout;
    }

    createBindGroup(descriptor: RHIBindGroupDescriptor): WebGLRHIBindGroup {
        this.assertAlive();
        return new WebGLRHIBindGroup(this, descriptor);
    }

    createRenderPipeline(descriptor: RHIRenderPipelineDescriptor): WebGLRHIRenderPipeline {
        this.assertAlive();
        const snapshot = snapshotPipelineDescriptor(descriptor);
        const key = renderPipelineKey(snapshot);
        const cached = this.pipelineCache.get(key);
        if (cached) return cached;
        const pipeline = new WebGLRHIRenderPipeline(this, snapshot, key);
        this.pipelineCache.set(key, pipeline);
        return pipeline;
    }

    createRenderPipelineAsync(
        descriptor: RHIRenderPipelineDescriptor
    ): Promise<WebGLRHIRenderPipeline> {
        return Promise.resolve(this.createRenderPipeline(descriptor));
    }

    createCommandEncoder(descriptor: { readonly label?: string } = {}): WebGLRHICommandEncoder {
        this.assertAlive();
        return new WebGLRHICommandEncoder(this, descriptor.label);
    }

    /** @internal Wrap a borrowed native buffer without reallocating it. */
    wrapBuffer(native: WebGLBuffer, descriptor: RHIBufferDescriptor): WebGLRHIBuffer {
        return (
            this.bufferIdentities.get(native) ??
            new WebGLRHIBuffer(this, descriptor, native, false, false)
        );
    }

    /** @internal Adopt an owned native buffer without reallocating it. */
    adoptBuffer(native: WebGLBuffer, descriptor: RHIBufferDescriptor): WebGLRHIBuffer {
        return (
            this.bufferIdentities.get(native) ??
            new WebGLRHIBuffer(this, descriptor, native, true, false)
        );
    }

    /** @internal Wrap a borrowed native texture without reallocating it. */
    wrapTexture(native: WebGLTexture, descriptor: RHITextureDescriptor): WebGLRHITexture {
        return (
            this.textureIdentities.get(native) ??
            new WebGLRHITexture(this, descriptor, native, false, false)
        );
    }

    /** @internal Adopt an owned native texture without reallocating it. */
    adoptTexture(native: WebGLTexture, descriptor: RHITextureDescriptor): WebGLRHITexture {
        return (
            this.textureIdentities.get(native) ??
            new WebGLRHITexture(this, descriptor, native, true, false)
        );
    }

    /** @internal Wrap a borrowed native sampler and preserve wrapper identity. */
    wrapSampler(native: WebGLSampler, descriptor: RHISamplerDescriptor = {}): WebGLRHISampler {
        return (
            this.samplerIdentities.get(native) ??
            new WebGLRHISampler(this, descriptor, native, false, false)
        );
    }

    /** @internal Adopt an owned native sampler and preserve wrapper identity. */
    adoptSampler(native: WebGLSampler, descriptor: RHISamplerDescriptor = {}): WebGLRHISampler {
        return (
            this.samplerIdentities.get(native) ??
            new WebGLRHISampler(this, descriptor, native, true, false)
        );
    }

    /** @internal Wrap a borrowed, already-linked native program as a pipeline. */
    wrapRenderPipeline(
        native: WebGLProgram,
        descriptor: RHIRenderPipelineDescriptor
    ): WebGLRHIRenderPipeline {
        const existing = this.pipelineIdentities.get(native);
        if (existing) return existing;
        const snapshot = snapshotPipelineDescriptor(descriptor);
        return new WebGLRHIRenderPipeline(
            this,
            snapshot,
            renderPipelineKey(snapshot),
            native,
            false,
            false
        );
    }

    /** @internal Adopt an owned, already-linked native program as a pipeline. */
    adoptRenderPipeline(
        native: WebGLProgram,
        descriptor: RHIRenderPipelineDescriptor
    ): WebGLRHIRenderPipeline {
        const existing = this.pipelineIdentities.get(native);
        if (existing) return existing;
        const snapshot = snapshotPipelineDescriptor(descriptor);
        return new WebGLRHIRenderPipeline(
            this,
            snapshot,
            renderPipelineKey(snapshot),
            native,
            true,
            false
        );
    }

    beginRenderPass(descriptor: RHIRenderPassDescriptor): WebGLRenderPassTarget {
        this.assertAlive();
        const depthStencilAttachment = descriptor.depthStencilAttachment;
        if (
            depthStencilAttachment?.depthReadOnly === true &&
            (depthStencilAttachment.depthLoadOp !== undefined ||
                depthStencilAttachment.depthStoreOp !== undefined)
        ) {
            throw new Error(
                'A depth-read-only render attachment cannot specify depth load or store operations'
            );
        }
        if (
            depthStencilAttachment?.stencilReadOnly === true &&
            (depthStencilAttachment.stencilLoadOp !== undefined ||
                depthStencilAttachment.stencilStoreOp !== undefined)
        ) {
            throw new Error(
                'A stencil-read-only render attachment cannot specify stencil load or store operations'
            );
        }
        if (descriptor.colorAttachments.length > this.limits.maxColorAttachments) {
            throw new RangeError('Render pass has too many color attachments');
        }
        const colorViews: (WebGLRHITextureView | null)[] = [];
        let width = 0;
        let height = 0;
        let sampleCount = 0;
        const acceptView = (view: WebGLRHITextureView): void => {
            view.texture.assertUsable();
            if (!hasUsage(view.texture.usage, RHITextureUsage.RENDER_ATTACHMENT)) {
                throw new Error('Render attachment texture lacks RENDER_ATTACHMENT usage');
            }
            if (
                !view.texture.surfaceTexture &&
                (view.mipLevelCount !== 1 || view.arrayLayerCount !== 1)
            ) {
                throw new Error(
                    'Render attachment views must select one mip level and one array layer'
                );
            }
            const viewWidth = mipDimension(view.texture.width, view.baseMipLevel);
            const viewHeight = mipDimension(view.texture.height, view.baseMipLevel);
            if (width === 0) {
                width = viewWidth;
                height = viewHeight;
                sampleCount = view.texture.sampleCount;
            } else if (
                width !== viewWidth ||
                height !== viewHeight ||
                sampleCount !== view.texture.sampleCount
            ) {
                throw new Error(
                    'Render pass attachments must have equal dimensions and sample counts'
                );
            }
        };
        for (const attachment of descriptor.colorAttachments) {
            if (!attachment) {
                colorViews.push(null);
                continue;
            }
            const view = this.requireTextureView(attachment.view);
            if (
                view.texture.formatInfo.kind !== 'float' &&
                view.texture.formatInfo.kind !== 'sint' &&
                view.texture.formatInfo.kind !== 'uint'
            ) {
                throw new Error('Color attachment must use a color format');
            }
            acceptView(view);
            colorViews.push(view);
            if (attachment.resolveTarget) {
                const resolve = this.requireTextureView(attachment.resolveTarget);
                resolve.texture.assertUsable();
                if (!hasUsage(resolve.texture.usage, RHITextureUsage.RENDER_ATTACHMENT)) {
                    throw new Error('Resolve target lacks RENDER_ATTACHMENT usage');
                }
                if (view.texture.sampleCount <= 1 || resolve.texture.sampleCount !== 1) {
                    throw new Error(
                        'Resolve requires a multisampled source and single-sampled target'
                    );
                }
                if (resolve.format !== view.format)
                    throw new Error('Resolve target format does not match source');
                if (
                    !resolve.texture.surfaceTexture &&
                    (resolve.mipLevelCount !== 1 || resolve.arrayLayerCount !== 1)
                ) {
                    throw new Error(
                        'Resolve target views must select one mip level and one array layer'
                    );
                }
                const sourceWidth = mipDimension(view.texture.width, view.baseMipLevel);
                const sourceHeight = mipDimension(view.texture.height, view.baseMipLevel);
                const resolveWidth = mipDimension(resolve.texture.width, resolve.baseMipLevel);
                const resolveHeight = mipDimension(resolve.texture.height, resolve.baseMipLevel);
                if (sourceWidth !== resolveWidth || sourceHeight !== resolveHeight) {
                    throw new Error('Resolve target dimensions do not match the source attachment');
                }
            }
        }
        const depthView = descriptor.depthStencilAttachment
            ? this.requireTextureView(descriptor.depthStencilAttachment.view)
            : null;
        if (depthView) acceptView(depthView);
        if (width === 0 || height === 0)
            throw new Error('Render pass requires at least one attachment');
        let surfaceAttachmentCount = 0;
        for (const view of colorViews) {
            if (view?.texture.surfaceTexture === true) surfaceAttachmentCount++;
        }
        const hasSurface = surfaceAttachmentCount > 0 || depthView?.texture.surfaceTexture === true;
        if (hasSurface && (surfaceAttachmentCount !== 1 || depthView !== null)) {
            throw new Error(
                'The default framebuffer surface cannot be mixed with offscreen attachments'
            );
        }
        const framebuffer = hasSurface
            ? null
            : this.framebufferForViews(colorViews, depthView).native;
        this.state.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
        return {
            framebuffer,
            width,
            height,
            sampleCount,
            colorViews: Object.freeze(colorViews),
            depthStencilView: depthView
        };
    }

    endRenderPass(target: WebGLRenderPassTarget, descriptor: RHIRenderPassDescriptor): void {
        const { gl, state } = this;
        for (let index = 0; index < descriptor.colorAttachments.length; index++) {
            const attachment = descriptor.colorAttachments[index];
            if (!attachment?.resolveTarget) continue;
            const resolveView = this.requireTextureView(attachment.resolveTarget);
            const resolveFramebuffer = resolveView.texture.surfaceTexture
                ? null
                : this.framebufferForViews([resolveView], null);
            const resolveWidth = mipDimension(resolveView.texture.width, resolveView.baseMipLevel);
            const resolveHeight = mipDimension(
                resolveView.texture.height,
                resolveView.baseMipLevel
            );
            state.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
            state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveFramebuffer?.native ?? null);
            gl.readBuffer(gl.COLOR_ATTACHMENT0 + index);
            gl.blitFramebuffer(
                0,
                0,
                target.width,
                target.height,
                0,
                0,
                resolveWidth,
                resolveHeight,
                gl.COLOR_BUFFER_BIT,
                gl.NEAREST
            );
        }
        const invalidAttachments = state.scratchAttachments;
        invalidAttachments.length = 0;
        for (let index = 0; index < descriptor.colorAttachments.length; index++) {
            if (descriptor.colorAttachments[index]?.storeOp === 'discard') {
                invalidAttachments.push(
                    target.framebuffer ? gl.COLOR_ATTACHMENT0 + index : gl.COLOR
                );
            }
        }
        const depthStencil = descriptor.depthStencilAttachment;
        if (depthStencil?.depthStoreOp === 'discard') {
            invalidAttachments.push(target.framebuffer ? gl.DEPTH_ATTACHMENT : gl.DEPTH);
        }
        if (depthStencil?.stencilStoreOp === 'discard') {
            invalidAttachments.push(target.framebuffer ? gl.STENCIL_ATTACHMENT : gl.STENCIL);
        }
        if (invalidAttachments.length > 0) {
            state.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
            gl.invalidateFramebuffer(gl.FRAMEBUFFER, invalidAttachments);
        }
    }

    copyBufferToBuffer(
        source: RHIBuffer,
        sourceOffset: number,
        destination: RHIBuffer,
        destinationOffset: number,
        size: number
    ): void {
        this.assertAlive();
        const sourceBuffer = this.requireBuffer(source);
        const destinationBuffer = this.requireBuffer(destination);
        sourceBuffer.assertUsable();
        destinationBuffer.assertUsable();
        if (!hasUsage(sourceBuffer.usage, RHIBufferUsage.COPY_SRC)) {
            throw new Error('Source buffer lacks COPY_SRC usage');
        }
        if (!hasUsage(destinationBuffer.usage, RHIBufferUsage.COPY_DST)) {
            throw new Error('Destination buffer lacks COPY_DST usage');
        }
        if (sourceOffset % 4 !== 0 || destinationOffset % 4 !== 0 || size % 4 !== 0) {
            throw new RangeError('Buffer copy offsets and size must be multiples of 4');
        }
        requireRange(sourceOffset, size, sourceBuffer.size, 'Source buffer copy');
        requireRange(destinationOffset, size, destinationBuffer.size, 'Destination buffer copy');
        if (
            sourceBuffer === destinationBuffer &&
            sourceOffset < destinationOffset + size &&
            destinationOffset < sourceOffset + size
        )
            throw new Error('Overlapping copies within one buffer are not allowed');
        this.state.bindBuffer(this.gl.COPY_READ_BUFFER, sourceBuffer.native);
        this.state.bindBuffer(this.gl.COPY_WRITE_BUFFER, destinationBuffer.native);
        this.gl.copyBufferSubData(
            this.gl.COPY_READ_BUFFER,
            this.gl.COPY_WRITE_BUFFER,
            sourceOffset,
            destinationOffset,
            size
        );
    }

    copyTextureToBuffer(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyBuffer,
        copySize: RHIExtent3D
    ): void {
        this.assertAlive();
        const texture = this.requireTexture(source.texture);
        const buffer = this.requireBuffer(destination.buffer);
        texture.assertUsable();
        buffer.assertUsable();
        if (!hasUsage(texture.usage, RHITextureUsage.COPY_SRC))
            throw new Error('Source texture lacks COPY_SRC usage');
        if (!hasUsage(buffer.usage, RHIBufferUsage.COPY_DST))
            throw new Error('Destination buffer lacks COPY_DST usage');
        if (texture.sampleCount !== 1)
            throw new Error('Multisampled textures cannot be copied to a buffer');
        if (texture.formatInfo.kind === 'compressed')
            throw new Error('Compressed texture readback is unsupported');
        const extent = extent3D(copySize);
        const origin = origin3D(source.origin);
        const mipLevel = source.mipLevel ?? 0;
        this.validateTextureCopy(texture, mipLevel, origin, extent);
        const bytesPerRow =
            destination.bytesPerRow ?? extent.width * texture.formatInfo.bytesPerBlock;
        const rowsPerImage = destination.rowsPerImage ?? extent.height;
        if (bytesPerRow < extent.width * texture.formatInfo.bytesPerBlock) {
            throw new RangeError('bytesPerRow is too small for the texture copy');
        }
        if (bytesPerRow % texture.formatInfo.bytesPerBlock !== 0) {
            throw new RangeError('bytesPerRow must be a multiple of the texel byte size');
        }
        if (rowsPerImage < extent.height) throw new RangeError('rowsPerImage is too small');
        const bufferOffset = destination.offset ?? 0;
        const required =
            bufferOffset +
            (extent.depthOrArrayLayers - 1) * rowsPerImage * bytesPerRow +
            (extent.height - 1) * bytesPerRow +
            extent.width * texture.formatInfo.bytesPerBlock;
        if (required > buffer.size)
            throw new RangeError('Texture-to-buffer copy exceeds the destination buffer');
        const gl = this.gl;
        this.state.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer.native);
        this.state.pixelStorei(gl.PACK_ALIGNMENT, 1);
        this.state.pixelStorei(gl.PACK_ROW_LENGTH, bytesPerRow / texture.formatInfo.bytesPerBlock);
        const mipHeight = mipDimension(texture.height, mipLevel);
        for (let layer = 0; layer < extent.depthOrArrayLayers; layer++) {
            const framebuffer = this.framebufferForSubresource(
                texture,
                mipLevel,
                origin.z + layer,
                source.aspect ?? 'all'
            );
            this.state.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
            const offset = bufferOffset + layer * rowsPerImage * bytesPerRow;
            gl.readPixels(
                origin.x,
                mipHeight - origin.y - extent.height,
                extent.width,
                extent.height,
                texture.formatInfo.format,
                texture.formatInfo.type,
                offset
            );
        }
        this.state.pixelStorei(gl.PACK_ROW_LENGTH, 0);
        this.state.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }

    copyBufferToTexture(
        source: RHIImageCopyBuffer,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertAlive();
        const buffer = this.requireBuffer(source.buffer);
        const texture = this.requireTexture(destination.texture);
        buffer.assertUsable();
        texture.assertUsable();
        if (!hasUsage(buffer.usage, RHIBufferUsage.COPY_SRC))
            throw new Error('Source buffer lacks COPY_SRC usage');
        if (!hasUsage(texture.usage, RHITextureUsage.COPY_DST))
            throw new Error('Destination texture lacks COPY_DST usage');
        if (!texture.nativeTexture)
            throw new Error('Cannot copy a buffer into a renderbuffer or surface texture');
        if (texture.formatInfo.kind === 'compressed') {
            throw new Error('WebGL 2 buffer-to-texture copies do not support compressed formats');
        }
        const extent = extent3D(copySize);
        const origin = origin3D(destination.origin);
        const mipLevel = destination.mipLevel ?? 0;
        this.validateTextureCopy(texture, mipLevel, origin, extent);
        const bytesPerTexel = texture.formatInfo.bytesPerBlock;
        const tightRowBytes = extent.width * bytesPerTexel;
        const bytesPerRow = source.bytesPerRow ?? tightRowBytes;
        const rowsPerImage = source.rowsPerImage ?? extent.height;
        if (bytesPerRow < tightRowBytes || bytesPerRow % bytesPerTexel !== 0) {
            throw new RangeError('Buffer-to-texture bytesPerRow is invalid');
        }
        if (rowsPerImage < extent.height)
            throw new RangeError('Buffer-to-texture rowsPerImage is too small');
        const sourceOffset = source.offset ?? 0;
        const required =
            sourceOffset +
            (extent.depthOrArrayLayers - 1) * rowsPerImage * bytesPerRow +
            (extent.height - 1) * bytesPerRow +
            tightRowBytes;
        if (required > buffer.size)
            throw new RangeError('Buffer-to-texture copy exceeds the source buffer');
        const gl = this.gl;
        this.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer.native);
        this.state.bindTexture(0, texture.target, texture.nativeTexture);
        this.state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        this.state.pixelStorei(gl.UNPACK_ROW_LENGTH, bytesPerRow / bytesPerTexel);
        this.state.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, rowsPerImage);
        this.state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        if (texture.target === gl.TEXTURE_2D) {
            if (extent.depthOrArrayLayers !== 1 || origin.z !== 0)
                throw new RangeError('2D texture copies require one layer');
            gl.texSubImage2D(
                texture.target,
                mipLevel,
                origin.x,
                origin.y,
                extent.width,
                extent.height,
                texture.formatInfo.format,
                texture.formatInfo.type,
                sourceOffset
            );
        } else if (texture.target === gl.TEXTURE_CUBE_MAP) {
            const layerStride = rowsPerImage * bytesPerRow;
            for (let layer = 0; layer < extent.depthOrArrayLayers; layer++) {
                gl.texSubImage2D(
                    gl.TEXTURE_CUBE_MAP_POSITIVE_X + origin.z + layer,
                    mipLevel,
                    origin.x,
                    origin.y,
                    extent.width,
                    extent.height,
                    texture.formatInfo.format,
                    texture.formatInfo.type,
                    sourceOffset + layer * layerStride
                );
            }
        } else {
            gl.texSubImage3D(
                texture.target,
                mipLevel,
                origin.x,
                origin.y,
                origin.z,
                extent.width,
                extent.height,
                extent.depthOrArrayLayers,
                texture.formatInfo.format,
                texture.formatInfo.type,
                sourceOffset
            );
        }
        this.state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        this.state.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
        this.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        if (this.diagnostics) this.diagnostics.textureUploads++;
    }

    copyTextureToTexture(
        source: RHIImageCopyTexture,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertAlive();
        const sourceTexture = this.requireTexture(source.texture);
        const destinationTexture = this.requireTexture(destination.texture);
        sourceTexture.assertUsable();
        destinationTexture.assertUsable();
        if (!hasUsage(sourceTexture.usage, RHITextureUsage.COPY_SRC))
            throw new Error('Source texture lacks COPY_SRC usage');
        if (!hasUsage(destinationTexture.usage, RHITextureUsage.COPY_DST))
            throw new Error('Destination texture lacks COPY_DST usage');
        if (sourceTexture.format !== destinationTexture.format)
            throw new Error('Texture copy formats must match');
        if (sourceTexture.sampleCount !== destinationTexture.sampleCount) {
            throw new Error('Texture copy sample counts must match');
        }
        const extent = extent3D(copySize);
        const sourceOrigin = origin3D(source.origin);
        const destinationOrigin = origin3D(destination.origin);
        const sourceMip = source.mipLevel ?? 0;
        const destinationMip = destination.mipLevel ?? 0;
        this.validateTextureCopy(sourceTexture, sourceMip, sourceOrigin, extent);
        this.validateTextureCopy(destinationTexture, destinationMip, destinationOrigin, extent);
        const gl = this.gl;
        const kind = sourceTexture.formatInfo.kind;
        const mask =
            kind === 'depth'
                ? gl.DEPTH_BUFFER_BIT
                : kind === 'stencil'
                  ? gl.STENCIL_BUFFER_BIT
                  : kind === 'depth-stencil'
                    ? gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT
                    : gl.COLOR_BUFFER_BIT;
        const sourceMipHeight = mipDimension(sourceTexture.height, sourceMip);
        const destinationMipHeight = mipDimension(destinationTexture.height, destinationMip);
        for (let layer = 0; layer < extent.depthOrArrayLayers; layer++) {
            const sourceFramebuffer = this.framebufferForSubresource(
                sourceTexture,
                sourceMip,
                sourceOrigin.z + layer,
                source.aspect ?? 'all'
            );
            const destinationFramebuffer = this.framebufferForSubresource(
                destinationTexture,
                destinationMip,
                destinationOrigin.z + layer,
                destination.aspect ?? 'all'
            );
            this.state.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
            this.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, destinationFramebuffer);
            gl.blitFramebuffer(
                sourceOrigin.x,
                sourceMipHeight - sourceOrigin.y - extent.height,
                sourceOrigin.x + extent.width,
                sourceMipHeight - sourceOrigin.y,
                destinationOrigin.x,
                destinationMipHeight - destinationOrigin.y - extent.height,
                destinationOrigin.x + extent.width,
                destinationMipHeight - destinationOrigin.y,
                mask,
                gl.NEAREST
            );
        }
    }

    writeTexture(
        destination: RHIImageCopyTexture,
        data: RHIBufferSource,
        dataLayout: RHIImageDataLayout,
        copySize: RHIExtent3D
    ): void {
        this.assertAlive();
        const texture = this.requireTexture(destination.texture);
        texture.assertUsable();
        if (!hasUsage(texture.usage, RHITextureUsage.COPY_DST))
            throw new Error('Destination texture lacks COPY_DST usage');
        if (!texture.nativeTexture)
            throw new Error('Cannot write pixels into a renderbuffer or surface texture');
        const extent = extent3D(copySize);
        const origin = origin3D(destination.origin);
        const mipLevel = destination.mipLevel ?? 0;
        this.validateTextureCopy(texture, mipLevel, origin, extent);
        const info = texture.formatInfo;
        const tightRowBytes = Math.ceil(extent.width / info.blockWidth) * info.bytesPerBlock;
        const copyRows = Math.ceil(extent.height / info.blockHeight);
        const bytesPerRow = dataLayout.bytesPerRow ?? tightRowBytes;
        const rowsPerImage = dataLayout.rowsPerImage ?? copyRows;
        if (bytesPerRow < tightRowBytes || rowsPerImage < copyRows) {
            throw new RangeError('Texture data layout is smaller than the copy extent');
        }
        if (
            info.kind === 'compressed' &&
            (bytesPerRow !== tightRowBytes || rowsPerImage !== copyRows)
        ) {
            throw new Error('WebGL compressed texture writes require a tightly packed data layout');
        }
        if (info.kind !== 'compressed' && bytesPerRow % info.bytesPerBlock !== 0) {
            throw new RangeError('bytesPerRow must be a multiple of the texel byte size');
        }
        const dataOffset = dataLayout.offset ?? 0;
        const requiredBytes =
            (extent.depthOrArrayLayers - 1) * rowsPerImage * bytesPerRow +
            (copyRows - 1) * bytesPerRow +
            tightRowBytes;
        const bytes = sourceBytes(data, dataOffset, requiredBytes, 'bytes');
        const gl = this.gl;
        this.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        this.state.bindTexture(0, texture.target, texture.nativeTexture);
        this.state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        this.state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        this.state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        if (info.kind !== 'compressed') {
            this.state.pixelStorei(gl.UNPACK_ROW_LENGTH, bytesPerRow / info.bytesPerBlock);
            this.state.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, rowsPerImage);
        }
        if (texture.target === gl.TEXTURE_2D) {
            if (extent.depthOrArrayLayers !== 1 || origin.z !== 0)
                throw new RangeError('2D texture copies require one layer');
            const pixels = typedPixelData(info, bytes);
            if (info.kind === 'compressed') {
                gl.compressedTexSubImage2D(
                    texture.target,
                    mipLevel,
                    origin.x,
                    origin.y,
                    extent.width,
                    extent.height,
                    info.internalFormat,
                    pixels
                );
            } else {
                gl.texSubImage2D(
                    texture.target,
                    mipLevel,
                    origin.x,
                    origin.y,
                    extent.width,
                    extent.height,
                    info.format,
                    info.type,
                    pixels
                );
            }
        } else if (texture.target === gl.TEXTURE_CUBE_MAP) {
            const layerStride = rowsPerImage * bytesPerRow;
            for (let layer = 0; layer < extent.depthOrArrayLayers; layer++) {
                const layerBytes = bytes.subarray(
                    layer * layerStride,
                    layer * layerStride + copyRows * bytesPerRow
                );
                const pixels = typedPixelData(info, layerBytes);
                const face = gl.TEXTURE_CUBE_MAP_POSITIVE_X + origin.z + layer;
                if (info.kind === 'compressed') {
                    gl.compressedTexSubImage2D(
                        face,
                        mipLevel,
                        origin.x,
                        origin.y,
                        extent.width,
                        extent.height,
                        info.internalFormat,
                        pixels
                    );
                } else {
                    gl.texSubImage2D(
                        face,
                        mipLevel,
                        origin.x,
                        origin.y,
                        extent.width,
                        extent.height,
                        info.format,
                        info.type,
                        pixels
                    );
                }
            }
        } else {
            const pixels = typedPixelData(info, bytes);
            if (info.kind === 'compressed') {
                gl.compressedTexSubImage3D(
                    texture.target,
                    mipLevel,
                    origin.x,
                    origin.y,
                    origin.z,
                    extent.width,
                    extent.height,
                    extent.depthOrArrayLayers,
                    info.internalFormat,
                    pixels
                );
            } else {
                gl.texSubImage3D(
                    texture.target,
                    mipLevel,
                    origin.x,
                    origin.y,
                    origin.z,
                    extent.width,
                    extent.height,
                    extent.depthOrArrayLayers,
                    info.format,
                    info.type,
                    pixels
                );
            }
        }
        this.state.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        this.state.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
        if (this.diagnostics) this.diagnostics.textureUploads++;
    }

    copyExternalImageToTexture(
        source: RHIImageCopyExternalImage,
        destination: RHIImageCopyTexture,
        copySize: RHIExtent3D
    ): void {
        this.assertAlive();
        const texture = this.requireTexture(destination.texture);
        texture.assertUsable();
        if (!hasUsage(texture.usage, RHITextureUsage.COPY_DST))
            throw new Error('Destination texture lacks COPY_DST usage');
        if (!texture.nativeTexture || texture.sampleCount !== 1)
            throw new Error('External images require a single-sampled texture destination');
        if (texture.formatInfo.kind !== 'float')
            throw new Error('External images require a normalized or floating-point color format');
        const extent = extent3D(copySize);
        if (extent.depthOrArrayLayers !== 1)
            throw new Error('External image copies support one destination layer');
        const sourceX = source.origin?.x ?? 0;
        const sourceY = source.origin?.y ?? 0;
        if (sourceX !== 0 || sourceY !== 0) {
            throw new Error('WebGL 2 direct external-image copies require a zero source origin');
        }
        const origin = origin3D(destination.origin);
        const mipLevel = destination.mipLevel ?? 0;
        this.validateTextureCopy(texture, mipLevel, origin, extent);
        const dimensions = this.externalImageDimensions(source.source);
        if (
            dimensions &&
            (dimensions.width !== extent.width || dimensions.height !== extent.height)
        ) {
            throw new Error(
                'WebGL 2 direct external-image copies require copySize to match the source dimensions'
            );
        }
        const gl = this.gl;
        this.state.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
        this.state.bindTexture(0, texture.target, texture.nativeTexture);
        this.state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        this.state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, source.flipY === true ? 1 : 0);
        this.state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        const target =
            texture.target === gl.TEXTURE_CUBE_MAP
                ? gl.TEXTURE_CUBE_MAP_POSITIVE_X + origin.z
                : texture.target;
        if (target !== gl.TEXTURE_2D && texture.target !== gl.TEXTURE_CUBE_MAP) {
            throw new Error('External image copies currently require a 2D or cube texture');
        }
        gl.texSubImage2D(
            target,
            mipLevel,
            origin.x,
            origin.y,
            texture.formatInfo.format,
            texture.formatInfo.type,
            source.source
        );
        if (this.diagnostics) this.diagnostics.textureUploads++;
    }

    destroy(): void {
        this.shutdown(false, 'destroyed', 'WebGL RHI device was destroyed');
    }

    /** @internal Called by WebGLRHI when the canvas loses its context. */
    handleContextLost(): void {
        this.shutdown(true, 'unknown', 'WebGL context was lost');
    }

    assertAlive(): void {
        if (this._destroyed) throw new Error('WebGL RHI device is destroyed or lost');
    }

    /** @internal Invalidate cached GL state before or after direct native-context work. */
    invalidateStateCache(): void {
        this.state.invalidate();
    }

    /**
     * @internal Execute a native fast path. A state-managed adapter may preserve the canonical
     * differential; arbitrary native callers retain the conservative invalidate-before/after mode.
     */
    runWithNativeContext<T>(callback: (gl: WebGL2RenderingContext) => T, stateManaged = false): T {
        this.assertAlive();
        if (stateManaged) return callback(this.gl);
        this.state.invalidate();
        try {
            return callback(this.gl);
        } finally {
            this.state.invalidate();
        }
    }

    registerDisposable(value: DisposableWebGLObject): void {
        if (this.disposableRefsByObject.has(value)) return;
        const reference = new WeakRef(value);
        this.disposableRefsByObject.set(value, reference);
        this.disposableRefs.add(reference);
        this.registrationsSincePrune++;
        if (this.registrationsSincePrune >= 64) {
            this.registrationsSincePrune = 0;
            for (const candidate of this.disposableRefs) {
                if (candidate.deref() === undefined) this.disposableRefs.delete(candidate);
            }
        }
    }

    unregisterDisposable(value: DisposableWebGLObject): void {
        const reference = this.disposableRefsByObject.get(value);
        if (!reference) return;
        this.disposableRefsByObject.delete(value);
        this.disposableRefs.delete(reference);
    }

    registerBufferIdentity(native: WebGLBuffer, buffer: WebGLRHIBuffer): void {
        this.bufferIdentities.set(native, buffer);
    }

    unregisterBufferIdentity(native: WebGLBuffer, buffer: WebGLRHIBuffer): void {
        if (this.bufferIdentities.get(native) === buffer) this.bufferIdentities.delete(native);
    }

    registerTextureIdentity(native: WebGLTexture, texture: WebGLRHITexture): void {
        this.textureIdentities.set(native, texture);
    }

    unregisterTextureIdentity(native: WebGLTexture, texture: WebGLRHITexture): void {
        if (this.textureIdentities.get(native) === texture) this.textureIdentities.delete(native);
    }

    registerSamplerIdentity(native: WebGLSampler, sampler: WebGLRHISampler): void {
        this.samplerIdentities.set(native, sampler);
    }

    unregisterSamplerIdentity(native: WebGLSampler, sampler: WebGLRHISampler): void {
        if (this.samplerIdentities.get(native) === sampler) this.samplerIdentities.delete(native);
    }

    registerPipelineIdentity(native: WebGLProgram, pipeline: WebGLRHIRenderPipeline): void {
        this.pipelineIdentities.set(native, pipeline);
    }

    unregisterPipelineIdentity(native: WebGLProgram, pipeline: WebGLRHIRenderPipeline): void {
        if (this.pipelineIdentities.get(native) === pipeline)
            this.pipelineIdentities.delete(native);
    }

    removePipelineCacheEntry(key: string, pipeline: WebGLRHIRenderPipeline): void {
        this.pipelineCache.deleteIf(key, pipeline);
    }

    requireBuffer(buffer: RHIBuffer): WebGLRHIBuffer {
        if (!(buffer instanceof WebGLRHIBuffer) || buffer.device !== this) {
            throw new TypeError('Buffer belongs to a different RHI device');
        }
        return buffer;
    }

    requireTexture(texture: RHITexture): WebGLRHITexture {
        if (!(texture instanceof WebGLRHITexture) || texture.device !== this) {
            throw new TypeError('Texture belongs to a different RHI device');
        }
        return texture;
    }

    requireTextureView(resource: unknown): WebGLRHITextureView {
        if (!(resource instanceof WebGLRHITextureView) || resource.texture.device !== this) {
            throw new TypeError('Texture view belongs to a different RHI device');
        }
        return resource;
    }

    requireSampler(resource: unknown): WebGLRHISampler {
        if (!(resource instanceof WebGLRHISampler) || resource.device !== this) {
            throw new TypeError('Sampler belongs to a different RHI device');
        }
        return resource;
    }

    requireShaderModule(module: RHIShaderModule): WebGLRHIShaderModule {
        if (!(module instanceof WebGLRHIShaderModule) || module.device !== this) {
            throw new TypeError('Shader module belongs to a different RHI device');
        }
        module.assertUsable();
        return module;
    }

    requireBindGroupLayout(layout: RHIBindGroupLayout): WebGLRHIBindGroupLayout {
        if (!(layout instanceof WebGLRHIBindGroupLayout) || layout.device !== this) {
            throw new TypeError('Bind group layout belongs to a different RHI device');
        }
        return layout;
    }

    requirePipelineLayout(layout: RHIPipelineLayout): WebGLRHIPipelineLayout {
        if (!(layout instanceof WebGLRHIPipelineLayout) || layout.device !== this) {
            throw new TypeError('Pipeline layout belongs to a different RHI device');
        }
        return layout;
    }

    requireBindGroup(group: RHIBindGroup): WebGLRHIBindGroup {
        if (!(group instanceof WebGLRHIBindGroup) || group.device !== this) {
            throw new TypeError('Bind group belongs to a different RHI device');
        }
        return group;
    }

    requirePipeline(pipeline: RHIRenderPipeline): WebGLRHIRenderPipeline {
        if (!(pipeline instanceof WebGLRHIRenderPipeline) || pipeline.device !== this) {
            throw new TypeError('Render pipeline belongs to a different RHI device');
        }
        return pipeline;
    }

    private framebufferForViews(
        colorViews: readonly (WebGLRHITextureView | null)[],
        depthView: WebGLRHITextureView | null
    ): CachedFramebuffer {
        let key = 'pass:';
        for (let index = 0; index < colorViews.length; index++) {
            const view = colorViews[index];
            key += view
                ? `c${String(index)},${String(view.texture.id)},${String(view.baseMipLevel)},${String(view.baseArrayLayer)};`
                : `c${String(index)},-;`;
        }
        key += depthView
            ? `d${String(depthView.texture.id)},${String(depthView.baseMipLevel)},${String(depthView.baseArrayLayer)},${depthView.aspect}`
            : 'd-';
        const cached = this.framebufferCache.get(key);
        if (cached) return cached;
        const firstView = colorViews.find(view => view !== null) ?? depthView;
        if (!firstView) throw new Error('Framebuffer requires an attachment');
        const width = mipDimension(firstView.texture.width, firstView.baseMipLevel);
        const height = mipDimension(firstView.texture.height, firstView.baseMipLevel);
        const native = glResource(this.gl.createFramebuffer(), 'a framebuffer');
        this.state.bindFramebuffer(this.gl.FRAMEBUFFER, native);
        const drawBuffers: GLenum[] = [];
        for (let index = 0; index < colorViews.length; index++) {
            const view = colorViews[index];
            if (!view) {
                drawBuffers.push(this.gl.NONE);
                continue;
            }
            this.attachFramebufferView(this.gl.COLOR_ATTACHMENT0 + index, view);
            drawBuffers.push(this.gl.COLOR_ATTACHMENT0 + index);
        }
        if (depthView)
            this.attachFramebufferView(attachmentPointForView(this.gl, depthView), depthView);
        this.gl.drawBuffers(drawBuffers.length > 0 ? drawBuffers : [this.gl.NONE]);
        const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
        if (typeof status === 'number' && status !== this.gl.FRAMEBUFFER_COMPLETE) {
            this.gl.deleteFramebuffer(native);
            throw new Error(`WebGL framebuffer is incomplete: ${String(status)}`);
        }
        const record = { native, width, height, sampleCount: firstView.texture.sampleCount };
        this.framebufferCache.set(key, record);
        this.diagnostics?.recordResource('framebuffer');
        return record;
    }

    private framebufferForSubresource(
        texture: WebGLRHITexture,
        mipLevel: number,
        layer: number,
        aspect: 'all' | 'stencil-only' | 'depth-only'
    ): WebGLFramebuffer | null {
        if (texture.surfaceTexture) return null;
        const key = `copy:${String(texture.id)},${String(mipLevel)},${String(layer)},${aspect}`;
        const cached = this.framebufferCache.get(key);
        if (cached) return cached.native;
        const native = glResource(this.gl.createFramebuffer(), 'a framebuffer');
        this.state.bindFramebuffer(this.gl.FRAMEBUFFER, native);
        const view = new WebGLRHITextureView(
            texture,
            '',
            texture.format,
            texture.dimension === '3d' ? '3d' : '2d',
            aspect,
            mipLevel,
            1,
            layer,
            1
        );
        const point = attachmentPointForView(this.gl, view);
        this.attachFramebufferView(point, view);
        this.gl.drawBuffers(
            point === this.gl.COLOR_ATTACHMENT0 ? [this.gl.COLOR_ATTACHMENT0] : [this.gl.NONE]
        );
        const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
        if (typeof status === 'number' && status !== this.gl.FRAMEBUFFER_COMPLETE) {
            this.gl.deleteFramebuffer(native);
            throw new Error(`WebGL copy framebuffer is incomplete: ${String(status)}`);
        }
        const record = {
            native,
            width: mipDimension(texture.width, mipLevel),
            height: mipDimension(texture.height, mipLevel),
            sampleCount: texture.sampleCount
        };
        this.framebufferCache.set(key, record);
        this.diagnostics?.recordResource('framebuffer');
        return native;
    }

    private attachFramebufferView(attachment: GLenum, view: WebGLRHITextureView): void {
        const { gl } = this;
        const texture = view.texture;
        if (texture.nativeRenderbuffer) {
            gl.framebufferRenderbuffer(
                gl.FRAMEBUFFER,
                attachment,
                gl.RENDERBUFFER,
                texture.nativeRenderbuffer
            );
        } else if (texture.nativeTexture) {
            if (texture.target === gl.TEXTURE_2D) {
                gl.framebufferTexture2D(
                    gl.FRAMEBUFFER,
                    attachment,
                    gl.TEXTURE_2D,
                    texture.nativeTexture,
                    view.baseMipLevel
                );
            } else if (texture.target === gl.TEXTURE_CUBE_MAP) {
                gl.framebufferTexture2D(
                    gl.FRAMEBUFFER,
                    attachment,
                    gl.TEXTURE_CUBE_MAP_POSITIVE_X + view.baseArrayLayer,
                    texture.nativeTexture,
                    view.baseMipLevel
                );
            } else {
                gl.framebufferTextureLayer(
                    gl.FRAMEBUFFER,
                    attachment,
                    texture.nativeTexture,
                    view.baseMipLevel,
                    view.baseArrayLayer
                );
            }
        } else {
            throw new Error('Surface textures cannot be attached to an offscreen framebuffer');
        }
    }

    private validateTextureCopy(
        texture: WebGLRHITexture,
        mipLevel: number,
        origin: { readonly x: number; readonly y: number; readonly z: number },
        extent: Required<RHIExtent3D>
    ): void {
        requireInteger(mipLevel, 'Texture copy mip level');
        if (mipLevel >= texture.mipLevelCount)
            throw new RangeError('Texture copy mip level is out of range');
        requireInteger(origin.x, 'Texture copy origin x');
        requireInteger(origin.y, 'Texture copy origin y');
        requireInteger(origin.z, 'Texture copy origin z');
        if (
            origin.x + extent.width > mipDimension(texture.width, mipLevel) ||
            origin.y + extent.height > mipDimension(texture.height, mipLevel) ||
            origin.z + extent.depthOrArrayLayers > texture.depthOrArrayLayers
        )
            throw new RangeError('Texture copy exceeds the selected subresource');
    }

    private externalImageDimensions(
        source: TexImageSource
    ): { readonly width: number; readonly height: number } | null {
        const candidate = source as unknown as {
            readonly width?: number;
            readonly height?: number;
            readonly videoWidth?: number;
            readonly videoHeight?: number;
            readonly naturalWidth?: number;
            readonly naturalHeight?: number;
        };
        const width = candidate.videoWidth ?? candidate.naturalWidth ?? candidate.width;
        const height = candidate.videoHeight ?? candidate.naturalHeight ?? candidate.height;
        return typeof width === 'number' && typeof height === 'number' ? { width, height } : null;
    }

    private shutdown(
        contextLost: boolean,
        reason: RHIDeviceLostInfo['reason'],
        message: string
    ): void {
        if (this._destroyed) return;
        if (contextLost) this.framebufferCache.discard();
        else this.framebufferCache.clear();
        for (const reference of this.disposableRefs) reference.deref()?.dispose(contextLost);
        this.disposableRefs.clear();
        this.samplerCache.discard();
        this.bindGroupLayoutCache.discard();
        this.pipelineLayoutCache.discard();
        this.pipelineCache.discard();
        this.state.invalidate();
        this._destroyed = true;
        if (!this.lossResolved) {
            this.lossResolved = true;
            this.resolveLost({ reason, message });
        }
    }
}

export class WebGLRHISurface extends WebGLDestroyableBase implements RHISurface {
    readonly canvas: HTMLCanvasElement;
    readonly device: WebGLRHIDevice;
    private _width: number;
    private _height: number;
    private _format: RHITextureFormat = 'bgra8unorm';
    private _configuration: RHISurfaceConfiguration = Object.freeze({
        format: 'bgra8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT,
        alphaMode: 'premultiplied'
    });
    private currentTexture: WebGLRHITexture;

    constructor(device: WebGLRHIDevice, canvas: HTMLCanvasElement, width: number, height: number) {
        super('WebGL2 canvas surface');
        requirePositiveInteger(width, 'Surface width');
        requirePositiveInteger(height, 'Surface height');
        this.device = device;
        this.canvas = canvas;
        this._width = width;
        this._height = height;
        canvas.width = width;
        canvas.height = height;
        this.currentTexture = this.createSurfaceTexture();
    }

    get width(): number {
        return this._width;
    }

    get height(): number {
        return this._height;
    }

    get format(): RHITextureFormat {
        return this._format;
    }

    /** @internal Snapshot used to rebuild the surface after context restoration. */
    get configuration(): RHISurfaceConfiguration {
        return this._configuration;
    }

    configure(configuration: RHISurfaceConfiguration): void {
        this.assertUsable();
        if (
            configuration.format !== 'rgba8unorm' &&
            configuration.format !== 'bgra8unorm' &&
            configuration.format !== 'rgba8unorm-srgb' &&
            configuration.format !== 'bgra8unorm-srgb'
        )
            throw new Error(`Unsupported WebGL canvas surface format: ${configuration.format}`);
        const usage = configuration.usage ?? RHITextureUsage.RENDER_ATTACHMENT;
        if (!hasUsage(usage, RHITextureUsage.RENDER_ATTACHMENT)) {
            throw new Error('WebGL canvas surface usage must include RENDER_ATTACHMENT');
        }
        if ((usage & (RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.STORAGE_BINDING)) !== 0) {
            throw new Error(
                'The WebGL default framebuffer cannot be sampled or used as a storage texture'
            );
        }
        this.currentTexture.dispose(false);
        this._format = configuration.format;
        this._configuration = Object.freeze({
            format: configuration.format,
            usage,
            alphaMode: configuration.alphaMode ?? 'premultiplied'
        });
        this.currentTexture = this.createSurfaceTexture();
    }

    resize(width: number, height: number): void {
        this.assertUsable();
        requirePositiveInteger(width, 'Surface width');
        requirePositiveInteger(height, 'Surface height');
        if (this._width === width && this._height === height) return;
        this._width = width;
        this._height = height;
        this.canvas.width = width;
        this.canvas.height = height;
        this.currentTexture.setSurfaceSize(width, height);
        this.device.state.invalidate();
    }

    getCurrentTexture(): WebGLRHITexture {
        this.assertUsable();
        return this.currentTexture;
    }

    destroy(): void {
        if (this._destroyed) return;
        this.currentTexture.dispose(false);
        this._destroyed = true;
    }

    /** @internal Context-lost teardown does not issue GL deletion calls. */
    handleContextLost(): void {
        if (this._destroyed) return;
        this.currentTexture.dispose(true);
        this._destroyed = true;
    }

    private createSurfaceTexture(): WebGLRHITexture {
        return new WebGLRHITexture(
            this.device,
            {
                label: 'WebGL2 current surface texture',
                size: { width: this._width, height: this._height },
                format: this._format,
                usage: this._configuration.usage ?? RHITextureUsage.RENDER_ATTACHMENT
            },
            null,
            false,
            false,
            true
        );
    }

    private assertUsable(): void {
        this.device.assertAlive();
        if (this._destroyed) throw new Error('WebGL surface is destroyed');
    }
}

export interface WebGLRHIContextLifecycleEvent {
    readonly type: 'lost' | 'restored';
    readonly generation: number;
    readonly nativeContext: WebGL2RenderingContext;
    readonly nativeEvent: Event;
}

export type WebGLRHIContextLifecycleListener = (event: WebGLRHIContextLifecycleEvent) => void;

/** WebGL 2 RHI root with context-loss recovery by generation replacement. */
export class WebGLRHI extends WebGLDestroyableBase implements RHI {
    readonly ready: Promise<void>;
    readonly diagnostics: WebGLRHIDiagnostics | null;
    generation = 1;
    recovery: Promise<void>;
    private readonly options: WebGLRHICreateOptions;
    private readonly contextAttributes: WebGLContextAttributes;
    private _gl: WebGL2RenderingContext;
    private _device: WebGLRHIDevice;
    private _surface: WebGLRHISurface;
    private _isReady = true;
    private resolveRecovery: (() => void) | null = null;
    private rejectRecovery: ((reason?: unknown) => void) | null = null;
    private readonly contextLostListener: EventListener;
    private readonly contextRestoredListener: EventListener;
    private readonly lifecycleListeners = new Set<WebGLRHIContextLifecycleListener>();

    constructor(options: WebGLRHICreateOptions) {
        super('WebGL2 RHI');
        requirePositiveInteger(options.width, 'RHI width');
        requirePositiveInteger(options.height, 'RHI height');
        options.canvas.width = options.width;
        options.canvas.height = options.height;
        this.options = Object.freeze({ ...options });
        this.contextAttributes = Object.freeze({
            alpha: options.alpha ?? true,
            antialias: options.antialias ?? true,
            depth: options.depth ?? true,
            stencil: options.stencil ?? true,
            premultipliedAlpha: options.premultipliedAlpha ?? true,
            preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
            failIfMajorPerformanceCaveat: options.failIfMajorPerformanceCaveat ?? false,
            ...(options.powerPreference === undefined
                ? {}
                : { powerPreference: options.powerPreference })
        });
        const gl = options.canvas.getContext('webgl2', this.contextAttributes);
        if (!gl) throw new Error('could not create a WebGL 2 context');
        this._gl = gl;
        this.diagnostics = options.diagnostics === true ? new WebGLRHIDiagnostics(true) : null;
        this._device = new WebGLRHIDevice(gl, options, this.diagnostics);
        this._surface = new WebGLRHISurface(
            this._device,
            options.canvas,
            options.width,
            options.height
        );
        this.ready = Promise.resolve();
        this.recovery = Promise.resolve();
        this.contextLostListener = event => {
            event.preventDefault();
            this.handleContextLost(event);
        };
        this.contextRestoredListener = event => {
            this.handleContextRestored(event);
        };
        options.canvas.addEventListener('webglcontextlost', this.contextLostListener);
        options.canvas.addEventListener('webglcontextrestored', this.contextRestoredListener);
    }

    get device(): WebGLRHIDevice {
        return this._device;
    }

    get surface(): WebGLRHISurface {
        return this._surface;
    }

    /** @internal Current generation's native context. */
    get gl(): WebGL2RenderingContext {
        return this._gl;
    }

    /** @internal Alias used by native migration adapters. */
    get native(): WebGL2RenderingContext {
        return this._gl;
    }

    get nativeContext(): WebGL2RenderingContext {
        return this._gl;
    }

    /** @internal Current generation's state differential. */
    get state(): WebGLRHIState {
        return this._device.state;
    }

    get isReady(): boolean {
        return this._isReady && !this._destroyed;
    }

    /** Subscribe one renderer/runtime owner to the root context lifecycle. */
    addContextLifecycleListener(listener: WebGLRHIContextLifecycleListener): () => void {
        if (this._destroyed) throw new Error('Cannot subscribe to a destroyed WebGL RHI');
        this.lifecycleListeners.add(listener);
        return () => {
            this.lifecycleListeners.delete(listener);
        };
    }

    destroy(): void {
        if (this._destroyed) return;
        this.options.canvas.removeEventListener('webglcontextlost', this.contextLostListener);
        this.options.canvas.removeEventListener(
            'webglcontextrestored',
            this.contextRestoredListener
        );
        this._surface.destroy();
        this._device.destroy();
        this._isReady = false;
        this._destroyed = true;
        this.rejectRecovery?.(new Error('WebGL RHI was destroyed during context recovery'));
        this.resolveRecovery = null;
        this.rejectRecovery = null;
        this.lifecycleListeners.clear();
    }

    private handleContextLost(nativeEvent: Event): void {
        if (this._destroyed || !this._isReady) return;
        this._isReady = false;
        this._surface.handleContextLost();
        this._device.handleContextLost();
        this.recovery = new Promise<void>((resolve, reject) => {
            this.resolveRecovery = resolve;
            this.rejectRecovery = reject;
        });
        this.notifyLifecycle('lost', nativeEvent);
    }

    private handleContextRestored(nativeEvent: Event): void {
        if (this._destroyed || this._isReady) return;
        let nextDevice: WebGLRHIDevice | null = null;
        let nextSurface: WebGLRHISurface | null = null;
        try {
            const previousConfiguration = this._surface.configuration;
            const gl = this.options.canvas.getContext('webgl2', this.contextAttributes);
            if (!gl) throw new Error('WebGL 2 context could not be reacquired after restoration');
            nextDevice = new WebGLRHIDevice(gl, this.options, this.diagnostics);
            nextSurface = new WebGLRHISurface(
                nextDevice,
                this.options.canvas,
                this.options.canvas.width,
                this.options.canvas.height
            );
            nextSurface.configure(previousConfiguration);
            this._gl = gl;
            this._device = nextDevice;
            this._surface = nextSurface;
            this.generation++;
            this._isReady = true;
            this.notifyLifecycle('restored', nativeEvent);
            this.resolveRecovery?.();
            this.resolveRecovery = null;
            this.rejectRecovery = null;
        } catch (error) {
            this._isReady = false;
            nextSurface?.handleContextLost();
            nextDevice?.handleContextLost();
            this.rejectRecovery?.(error);
            this.resolveRecovery = null;
            this.rejectRecovery = null;
        }
    }

    private notifyLifecycle(type: 'lost' | 'restored', nativeEvent: Event): void {
        let firstError: unknown;
        let listenerFailed = false;
        for (const listener of this.lifecycleListeners) {
            try {
                listener({
                    type,
                    generation: this.generation,
                    nativeContext: this._gl,
                    nativeEvent
                });
            } catch (error) {
                if (!listenerFailed) firstError = error;
                listenerFailed = true;
            }
        }
        if (listenerFailed) throw firstError;
    }
}

/** Create a WebGL 2 implementation of the portable RHI. */
export function createWebGLRHI(options: WebGLRHICreateOptions): Promise<WebGLRHI> {
    return Promise.resolve(new WebGLRHI(options));
}

export { WebGLRHI as WebGL2RHI, WebGLRHIDevice as WebGL2RHIDevice };

export const createWebGL2RHI = createWebGLRHI;

export default createWebGLRHI;
