import {
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    DEPTH_STENCIL,
    FLOAT,
    LINEAR,
    NEAREST,
    RGBA,
    TEXTURE_2D,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../../constants/webgl';
import {
    DEPTH24_STENCIL8,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    HALF_FLOAT,
    RGBA16F,
    RGBA32F,
    RGBA8,
    SRGB8_ALPHA8,
    UNSIGNED_INT_24_8
} from '../../constants/webgl2';
import Texture from '../../texture/Texture';
import { WebGPUBufferUsage, WebGPUMapMode, WebGPUTextureUsage } from './WebGPUConstants';
import {
    createWebGPUSamplerDescriptor,
    resolveWebGPUTextureFormat,
    type default as WebGPUTextureManager,
    type WebGPUTextureFormatInfo,
    type WebGPUTextureResource
} from './WebGPUTextureManager';

export const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;

export type WebGPUColorRenderTargetFormat =
    'rgba8unorm' | 'rgba8unorm-srgb' | 'rgba16float' | 'rgba32float';

export type WebGPUDepthStencilRenderTargetFormat =
    | 'depth16unorm'
    | 'depth24plus'
    | 'depth24plus-stencil8'
    | 'depth32float'
    | 'depth32float-stencil8';

export interface WebGPUColorAttachmentOptions {
    /** Stable engine texture identity exposed to materials; its GPU allocation becomes target-owned. */
    readonly texture?: Texture<unknown>;
    /** Native target format. It must agree with `texture` when both are supplied. */
    readonly format?: WebGPUColorRenderTargetFormat;
    readonly clearValue?: GPUColor;
    readonly loadOp?: GPULoadOp;
    readonly storeOp?: GPUStoreOp;
    readonly label?: string;
}

export interface WebGPUDepthStencilAttachmentOptions {
    /** Supplying a texture implies `sampled: true`. */
    readonly texture?: Texture<unknown>;
    readonly format?: WebGPUDepthStencilRenderTargetFormat;
    /** Depth sampling is opt-in and is unavailable when MSAA is enabled. */
    readonly sampled?: boolean;
    readonly compare?: GPUCompareFunction;
    readonly depthClearValue?: number;
    readonly depthLoadOp?: GPULoadOp;
    readonly depthStoreOp?: GPUStoreOp;
    readonly stencilClearValue?: GPUStencilValue;
    readonly stencilLoadOp?: GPULoadOp;
    readonly stencilStoreOp?: GPUStoreOp;
    readonly label?: string;
}

export interface WebGPURenderTargetParameters {
    readonly width: number;
    readonly height: number;
    /** Defaults to one sampleable rgba8unorm attachment; an empty array creates a depth-only target. */
    readonly colorAttachments?: readonly WebGPUColorAttachmentOptions[];
    /** Defaults to a non-sampled depth24plus-stencil8 attachment. */
    readonly depthStencilAttachment?: WebGPUDepthStencilAttachmentOptions | false;
    /** Core WebGPU guarantees sample counts 1 and 4. */
    readonly sampleCount?: 1 | 4;
    readonly label?: string;
}

export interface WebGPUColorAttachmentOperations {
    readonly clearValue?: GPUColor;
    readonly loadOp?: GPULoadOp;
    readonly storeOp?: GPUStoreOp;
}

export interface WebGPUDepthStencilAttachmentOperations {
    readonly depthClearValue?: number;
    readonly depthLoadOp?: GPULoadOp;
    readonly depthStoreOp?: GPUStoreOp;
    readonly stencilClearValue?: GPUStencilValue;
    readonly stencilLoadOp?: GPULoadOp;
    readonly stencilStoreOp?: GPUStoreOp;
}

export interface WebGPURenderPassOptions {
    /** When present, one operation object is required for each color attachment. */
    readonly colorAttachments?: readonly WebGPUColorAttachmentOperations[];
    readonly depthStencilAttachment?: WebGPUDepthStencilAttachmentOperations;
    readonly label?: string;
}

export interface WebGPUReadColorAttachmentOptions {
    readonly attachmentIndex?: number;
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
}

/** Tightly packed raw texel bytes in the attachment's native format. */
export interface WebGPUColorAttachmentReadback {
    readonly data: Uint8Array;
    readonly format: WebGPUColorRenderTargetFormat;
    readonly width: number;
    readonly height: number;
    readonly bytesPerPixel: number;
    readonly bytesPerRow: number;
}

interface ColorAttachmentState {
    readonly texture: Texture<unknown>;
    readonly format: WebGPUColorRenderTargetFormat;
    readonly formatInfo: WebGPUTextureFormatInfo;
    readonly clearValue: GPUColor;
    readonly loadOp: GPULoadOp;
    readonly storeOp: GPUStoreOp;
    readonly label: string;
    resource: WebGPUTextureResource | null;
    multisampleTexture: GPUTexture | null;
    multisampleView: GPUTextureView | null;
}

interface DepthStencilAttachmentState {
    readonly texture: Texture<unknown> | null;
    readonly format: WebGPUDepthStencilRenderTargetFormat;
    readonly sampled: boolean;
    readonly compare: GPUCompareFunction;
    readonly depthClearValue: number;
    readonly depthLoadOp: GPULoadOp;
    readonly depthStoreOp: GPUStoreOp;
    readonly stencilClearValue: GPUStencilValue;
    readonly stencilLoadOp: GPULoadOp;
    readonly stencilStoreOp: GPUStoreOp;
    readonly label: string;
    gpuTexture: GPUTexture | null;
    renderView: GPUTextureView | null;
}

const COLOR_FORMATS = new Set<GPUTextureFormat>([
    'rgba8unorm',
    'rgba8unorm-srgb',
    'rgba16float',
    'rgba32float'
]);

const DEPTH_STENCIL_FORMATS = new Set<GPUTextureFormat>([
    'depth16unorm',
    'depth24plus',
    'depth24plus-stencil8',
    'depth32float',
    'depth32float-stencil8'
]);

function assertPositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive integer`);
    }
}

function assertLoadOp(value: unknown, name: string): asserts value is GPULoadOp {
    if (value !== 'clear' && value !== 'load') {
        throw new TypeError(`${name} must be "clear" or "load"`);
    }
}

function assertStoreOp(value: unknown, name: string): asserts value is GPUStoreOp {
    if (value !== 'store' && value !== 'discard') {
        throw new TypeError(`${name} must be "store" or "discard"`);
    }
}

function assertSampleCount(value: unknown): asserts value is 1 | 4 {
    if (value !== 1 && value !== 4) {
        throw new RangeError('WebGPU render-target sampleCount must be 1 or 4');
    }
}

function assertDepthClearValue(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError('Depth clear value must be a finite number in [0, 1]');
    }
}

function assertStencilClearValue(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError('Stencil clear value must be an unsigned 32-bit integer');
    }
}

function hasStencil(format: WebGPUDepthStencilRenderTargetFormat): boolean {
    return format === 'depth24plus-stencil8' || format === 'depth32float-stencil8';
}

function align(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function createColorTexture(
    format: WebGPUColorRenderTargetFormat,
    width: number,
    height: number,
    label: string
): Texture<null> {
    const common = {
        width,
        height,
        image: null,
        format: RGBA,
        minFilter: LINEAR,
        magFilter: LINEAR,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        needUpdate: false,
        name: label
    } as const;
    switch (format) {
        case 'rgba8unorm':
            return new Texture({ ...common, internalFormat: RGBA8, type: UNSIGNED_BYTE });
        case 'rgba8unorm-srgb':
            return new Texture({ ...common, internalFormat: SRGB8_ALPHA8, type: UNSIGNED_BYTE });
        case 'rgba16float':
            return new Texture({ ...common, internalFormat: RGBA16F, type: HALF_FLOAT });
        case 'rgba32float':
            return new Texture({
                ...common,
                internalFormat: RGBA32F,
                type: FLOAT,
                minFilter: NEAREST,
                magFilter: NEAREST
            });
    }
}

function createDepthTexture(
    format: WebGPUDepthStencilRenderTargetFormat,
    width: number,
    height: number,
    label: string
): Texture<null> {
    const common = {
        width,
        height,
        image: null,
        minFilter: LINEAR,
        magFilter: LINEAR,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        needUpdate: false,
        name: label
    } as const;
    switch (format) {
        case 'depth16unorm':
            return new Texture({
                ...common,
                internalFormat: DEPTH_COMPONENT16,
                format: DEPTH_COMPONENT,
                type: UNSIGNED_SHORT
            });
        case 'depth24plus':
            return new Texture({
                ...common,
                internalFormat: DEPTH_COMPONENT24,
                format: DEPTH_COMPONENT,
                type: UNSIGNED_INT
            });
        case 'depth24plus-stencil8':
            return new Texture({
                ...common,
                internalFormat: DEPTH24_STENCIL8,
                format: DEPTH_STENCIL,
                type: UNSIGNED_INT_24_8
            });
        case 'depth32float':
            return new Texture({
                ...common,
                internalFormat: DEPTH_COMPONENT32F,
                format: DEPTH_COMPONENT,
                type: FLOAT
            });
        case 'depth32float-stencil8':
            return new Texture({
                ...common,
                internalFormat: DEPTH32F_STENCIL8,
                format: DEPTH_STENCIL,
                type: FLOAT_32_UNSIGNED_INT_24_8_REV
            });
    }
}

function validateRenderTargetTexture(texture: Texture<unknown>, role: string): void {
    if (texture.target !== TEXTURE_2D) {
        throw new TypeError(`${role} must use the TEXTURE_2D target`);
    }
    if (texture.compressed) {
        throw new TypeError(`${role} cannot be compressed`);
    }
    if (texture.image !== null || (texture.mipmaps?.length ?? 0) > 0) {
        throw new TypeError(`${role} cannot contain image or mipmap source data`);
    }
    if (texture.useMipmap) {
        throw new TypeError(`${role} cannot request mipmap generation`);
    }
}

function normalizeColorAttachment(
    options: WebGPUColorAttachmentOptions,
    index: number,
    width: number,
    height: number,
    sampleCount: number,
    targetLabel: string
): ColorAttachmentState {
    const label = options.label ?? `${targetLabel}.color[${String(index)}]`;
    const texture =
        options.texture ?? createColorTexture(options.format ?? 'rgba8unorm', width, height, label);
    validateRenderTargetTexture(texture, `Color attachment ${String(index)}`);
    const formatInfo = resolveWebGPUTextureFormat(texture);
    if (formatInfo.isDepth || !COLOR_FORMATS.has(formatInfo.format)) {
        throw new TypeError(
            `Color attachment ${String(index)} format ${formatInfo.format} is not a sampleable WebGPU render-target format`
        );
    }
    const format = formatInfo.format as WebGPUColorRenderTargetFormat;
    if (options.format !== undefined && options.format !== format) {
        throw new TypeError(
            `Color attachment ${String(index)} declares ${options.format} but its texture maps to ${format}`
        );
    }
    const loadOp = options.loadOp ?? 'clear';
    const storeOp = options.storeOp ?? (sampleCount > 1 ? 'discard' : 'store');
    assertLoadOp(loadOp, `Color attachment ${String(index)} loadOp`);
    assertStoreOp(storeOp, `Color attachment ${String(index)} storeOp`);
    return {
        texture,
        format,
        formatInfo,
        clearValue: options.clearValue ?? { r: 0, g: 0, b: 0, a: 0 },
        loadOp,
        storeOp,
        label,
        resource: null,
        multisampleTexture: null,
        multisampleView: null
    };
}

function normalizeDepthStencilAttachment(
    options: WebGPUDepthStencilAttachmentOptions,
    width: number,
    height: number,
    sampleCount: number,
    targetLabel: string
): DepthStencilAttachmentState {
    if (options.texture !== undefined && options.sampled === false) {
        throw new TypeError('A supplied depth texture requires sampled: true');
    }
    const sampled = options.texture !== undefined || options.sampled === true;
    if (sampled && sampleCount > 1) {
        throw new TypeError(
            'WebGPU cannot resolve a multisampled depth attachment into a sampleable depth texture'
        );
    }
    if (!sampled && options.compare !== undefined) {
        throw new TypeError('Depth comparison sampling requires sampled: true');
    }
    const label = options.label ?? `${targetLabel}.depthStencil`;
    const requestedFormat = options.format ?? 'depth24plus-stencil8';
    const texture =
        options.texture ??
        (sampled ? createDepthTexture(requestedFormat, width, height, label) : null);
    let format = requestedFormat;
    if (texture) {
        validateRenderTargetTexture(texture, 'Depth/stencil attachment');
        const formatInfo = resolveWebGPUTextureFormat(texture);
        if (!formatInfo.isDepth || !DEPTH_STENCIL_FORMATS.has(formatInfo.format)) {
            throw new TypeError(
                `Depth/stencil attachment format ${formatInfo.format} is not a supported depth format`
            );
        }
        format = formatInfo.format as WebGPUDepthStencilRenderTargetFormat;
        if (options.format !== undefined && options.format !== format) {
            throw new TypeError(
                `Depth/stencil attachment declares ${options.format} but its texture maps to ${format}`
            );
        }
    }
    const depthClearValue = options.depthClearValue ?? 1;
    const depthLoadOp = options.depthLoadOp ?? 'clear';
    const depthStoreOp = options.depthStoreOp ?? 'store';
    const stencilClearValue = options.stencilClearValue ?? 0;
    const stencilLoadOp = options.stencilLoadOp ?? 'clear';
    const stencilStoreOp = options.stencilStoreOp ?? 'store';
    assertDepthClearValue(depthClearValue);
    assertStencilClearValue(stencilClearValue);
    assertLoadOp(depthLoadOp, 'Depth loadOp');
    assertStoreOp(depthStoreOp, 'Depth storeOp');
    assertLoadOp(stencilLoadOp, 'Stencil loadOp');
    assertStoreOp(stencilStoreOp, 'Stencil storeOp');
    if (
        !hasStencil(format) &&
        (options.stencilClearValue !== undefined ||
            options.stencilLoadOp !== undefined ||
            options.stencilStoreOp !== undefined)
    ) {
        throw new TypeError(
            `Stencil operations require a depth/stencil format; received ${format}`
        );
    }
    return {
        texture,
        format,
        sampled,
        compare: options.compare ?? 'less-equal',
        depthClearValue,
        depthLoadOp,
        depthStoreOp,
        stencilClearValue,
        stencilLoadOp,
        stencilStoreOp,
        label,
        gpuTexture: null,
        renderView: null
    };
}

/**
 * Device-scoped WebGPU render target with sampleable color resolves, optional depth/stencil,
 * explicit multisampling and aligned asynchronous readback.
 */
export default class WebGPURenderTarget {
    readonly className = 'WebGPURenderTarget';
    readonly isWebGPURenderTarget = true;
    readonly device: GPUDevice;
    readonly textureManager: WebGPUTextureManager;
    readonly sampleCount: 1 | 4;
    readonly label: string;
    readonly colorTextures: readonly Texture<unknown>[];
    readonly colorFormats: readonly WebGPUColorRenderTargetFormat[];
    readonly depthStencilFormat: WebGPUDepthStencilRenderTargetFormat | null;

    private _width: number;
    private _height: number;
    private readonly colorAttachments: ColorAttachmentState[];
    private readonly depthStencilAttachment: DepthStencilAttachmentState | null;
    private destroyed = false;

    get width(): number {
        return this._width;
    }

    get height(): number {
        return this._height;
    }

    get colorAttachmentCount(): number {
        return this.colorAttachments.length;
    }

    get depthTexture(): Texture<unknown> | null {
        return this.depthStencilAttachment?.texture ?? null;
    }

    get isDestroyed(): boolean {
        return this.destroyed;
    }

    constructor(
        device: GPUDevice,
        textureManager: WebGPUTextureManager,
        parameters: WebGPURenderTargetParameters
    ) {
        if (textureManager.device !== device) {
            throw new TypeError(
                'WebGPURenderTarget and WebGPUTextureManager must use the same device'
            );
        }
        assertPositiveInteger(parameters.width, 'Render-target width');
        assertPositiveInteger(parameters.height, 'Render-target height');
        const sampleCount: unknown = parameters.sampleCount ?? 1;
        assertSampleCount(sampleCount);
        this.device = device;
        this.textureManager = textureManager;
        this.sampleCount = sampleCount;
        this.label = parameters.label ?? 'WebGPURenderTarget';
        this._width = parameters.width;
        this._height = parameters.height;
        const colorOptions = parameters.colorAttachments ?? [{}];
        this.colorAttachments = colorOptions.map((options, index) =>
            normalizeColorAttachment(
                options,
                index,
                this._width,
                this._height,
                sampleCount,
                this.label
            )
        );
        const depthOptions = parameters.depthStencilAttachment;
        this.depthStencilAttachment =
            depthOptions === false
                ? null
                : normalizeDepthStencilAttachment(
                      depthOptions ?? {},
                      this._width,
                      this._height,
                      sampleCount,
                      this.label
                  );
        if (this.colorAttachments.length === 0 && this.depthStencilAttachment === null) {
            throw new TypeError('A WebGPU render target requires at least one attachment');
        }
        this.colorTextures = Object.freeze(
            this.colorAttachments.map(attachment => attachment.texture)
        );
        this.colorFormats = Object.freeze(
            this.colorAttachments.map(attachment => attachment.format)
        );
        this.depthStencilFormat = this.depthStencilAttachment?.format ?? null;
        this.validateDeviceLimits(this._width, this._height);
        try {
            this.createResources();
        } catch (error) {
            this.releaseResources();
            this.destroyed = true;
            throw error;
        }
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error('WebGPURenderTarget has been destroyed');
    }

    private validateDeviceLimits(width: number, height: number): void {
        const { limits } = this.device;
        if (width > limits.maxTextureDimension2D || height > limits.maxTextureDimension2D) {
            throw new RangeError(
                `Render-target size ${String(width)}x${String(height)} exceeds maxTextureDimension2D ${String(limits.maxTextureDimension2D)}`
            );
        }
        if (this.colorAttachments.length > limits.maxColorAttachments) {
            throw new RangeError(
                `Render target has ${String(this.colorAttachments.length)} color attachments; device supports ${String(limits.maxColorAttachments)}`
            );
        }
        const bytesPerSample = this.colorAttachments.reduce(
            (sum, attachment) => sum + attachment.formatInfo.bytesPerPixel,
            0
        );
        if (bytesPerSample > limits.maxColorAttachmentBytesPerSample) {
            throw new RangeError(
                `Color attachments require ${String(bytesPerSample)} bytes per sample; device supports ${String(limits.maxColorAttachmentBytesPerSample)}`
            );
        }
        if (
            this.depthStencilAttachment?.format === 'depth32float-stencil8' &&
            !this.device.features.has('depth32float-stencil8')
        ) {
            throw new TypeError(
                'WebGPU format depth32float-stencil8 requires the depth32float-stencil8 device feature'
            );
        }
        if (!this.device.features.has('float32-filterable')) {
            for (const [index, attachment] of this.colorAttachments.entries()) {
                if (attachment.format !== 'rgba32float') continue;
                const sampler = createWebGPUSamplerDescriptor(attachment.texture, 1);
                if (
                    sampler.magFilter === 'linear' ||
                    sampler.minFilter === 'linear' ||
                    sampler.mipmapFilter === 'linear'
                ) {
                    throw new TypeError(
                        `Color attachment ${String(index)} uses filtered rgba32float sampling, but the device does not expose float32-filterable`
                    );
                }
            }
        }
    }

    private createResources(): void {
        for (const attachment of this.colorAttachments) {
            attachment.texture.width = this._width;
            attachment.texture.height = this._height;
            attachment.texture.needUpdate = false;
            attachment.texture.needDestroy = false;
            const resolveTexture = this.device.createTexture({
                label: attachment.label,
                size: { width: this._width, height: this._height, depthOrArrayLayers: 1 },
                mipLevelCount: 1,
                sampleCount: 1,
                dimension: '2d',
                format: attachment.format,
                usage:
                    WebGPUTextureUsage.COPY_SRC |
                    WebGPUTextureUsage.TEXTURE_BINDING |
                    WebGPUTextureUsage.RENDER_ATTACHMENT
            });
            attachment.resource = this.textureManager.registerExternal(
                attachment.texture,
                resolveTexture,
                { takeOwnership: true }
            );
            if (this.sampleCount > 1) {
                attachment.multisampleTexture = this.device.createTexture({
                    label: `${attachment.label}.multisample`,
                    size: { width: this._width, height: this._height, depthOrArrayLayers: 1 },
                    mipLevelCount: 1,
                    sampleCount: this.sampleCount,
                    dimension: '2d',
                    format: attachment.format,
                    usage: WebGPUTextureUsage.RENDER_ATTACHMENT
                });
                attachment.multisampleView = attachment.multisampleTexture.createView({
                    dimension: '2d'
                });
            }
        }

        const depth = this.depthStencilAttachment;
        if (!depth) return;
        if (depth.texture) {
            depth.texture.width = this._width;
            depth.texture.height = this._height;
            depth.texture.needUpdate = false;
            depth.texture.needDestroy = false;
        }
        depth.gpuTexture = this.device.createTexture({
            label: depth.label,
            size: { width: this._width, height: this._height, depthOrArrayLayers: 1 },
            mipLevelCount: 1,
            sampleCount: this.sampleCount,
            dimension: '2d',
            format: depth.format,
            usage:
                WebGPUTextureUsage.RENDER_ATTACHMENT |
                (depth.sampled ? WebGPUTextureUsage.TEXTURE_BINDING : 0)
        });
        depth.renderView = depth.gpuTexture.createView({ dimension: '2d' });
        if (depth.texture) {
            try {
                this.textureManager.registerExternal(depth.texture, depth.gpuTexture, {
                    takeOwnership: true,
                    compare: depth.compare,
                    viewDescriptor: {
                        dimension: '2d',
                        aspect: hasStencil(depth.format) ? 'depth-only' : 'all'
                    }
                });
            } catch (error) {
                depth.gpuTexture = null;
                depth.renderView = null;
                throw error;
            }
        }
    }

    private releaseResources(): void {
        for (const attachment of this.colorAttachments) {
            this.textureManager.destroy(attachment.texture);
            attachment.resource = null;
            attachment.multisampleTexture?.destroy();
            attachment.multisampleTexture = null;
            attachment.multisampleView = null;
        }
        const depth = this.depthStencilAttachment;
        if (!depth?.gpuTexture) return;
        if (depth.texture) {
            this.textureManager.destroy(depth.texture);
        } else {
            depth.gpuTexture.destroy();
        }
        depth.gpuTexture = null;
        depth.renderView = null;
    }

    getColorTexture(index = 0): Texture<unknown> {
        this.assertAlive();
        const texture = this.colorAttachments[index]?.texture;
        if (!texture)
            throw new RangeError(`Color attachment index ${String(index)} is out of range`);
        return texture;
    }

    getColorGPUTexture(index = 0): GPUTexture {
        this.assertAlive();
        const texture = this.colorAttachments[index]?.resource?.gpuTexture;
        if (!texture)
            throw new RangeError(`Color attachment index ${String(index)} is out of range`);
        return texture;
    }

    getDepthStencilGPUTexture(): GPUTexture | null {
        this.assertAlive();
        return this.depthStencilAttachment?.gpuTexture ?? null;
    }

    /** Render-pass layout values consumed by pipeline creation. */
    getRenderPassLayout(): GPURenderPassLayout {
        this.assertAlive();
        return {
            colorFormats: [...this.colorFormats],
            ...(this.depthStencilFormat === null
                ? {}
                : { depthStencilFormat: this.depthStencilFormat }),
            sampleCount: this.sampleCount
        };
    }

    createRenderPassDescriptor(options: WebGPURenderPassOptions = {}): GPURenderPassDescriptor {
        this.assertAlive();
        const colorOperations = options.colorAttachments;
        if (
            colorOperations !== undefined &&
            colorOperations.length !== this.colorAttachments.length
        ) {
            throw new RangeError(
                `Render-pass color operations contain ${String(colorOperations.length)} entries; ${String(this.colorAttachments.length)} are required`
            );
        }
        const colorAttachments = this.colorAttachments.map((attachment, index) => {
            const operation = colorOperations?.[index];
            const loadOp = operation?.loadOp ?? attachment.loadOp;
            const storeOp = operation?.storeOp ?? attachment.storeOp;
            assertLoadOp(loadOp, `Color attachment ${String(index)} loadOp`);
            assertStoreOp(storeOp, `Color attachment ${String(index)} storeOp`);
            if (!attachment.resource) {
                throw new Error(`Color attachment ${String(index)} has no GPU resource`);
            }
            return {
                view: attachment.multisampleView ?? attachment.resource.view,
                ...(attachment.multisampleView === null
                    ? {}
                    : { resolveTarget: attachment.resource.view }),
                clearValue: operation?.clearValue ?? attachment.clearValue,
                loadOp,
                storeOp
            } satisfies GPURenderPassColorAttachment;
        });

        const depth = this.depthStencilAttachment;
        const depthOperation = options.depthStencilAttachment;
        if (!depth && depthOperation !== undefined) {
            throw new TypeError('Depth/stencil operations require a depth/stencil attachment');
        }
        let depthStencilAttachment: GPURenderPassDepthStencilAttachment | undefined;
        if (depth) {
            if (!depth.renderView) throw new Error('Depth/stencil attachment has no GPU resource');
            const depthClearValue = depthOperation?.depthClearValue ?? depth.depthClearValue;
            const depthLoadOp = depthOperation?.depthLoadOp ?? depth.depthLoadOp;
            const depthStoreOp = depthOperation?.depthStoreOp ?? depth.depthStoreOp;
            assertDepthClearValue(depthClearValue);
            assertLoadOp(depthLoadOp, 'Depth loadOp');
            assertStoreOp(depthStoreOp, 'Depth storeOp');
            const stencilOperationSpecified =
                depthOperation?.stencilClearValue !== undefined ||
                depthOperation?.stencilLoadOp !== undefined ||
                depthOperation?.stencilStoreOp !== undefined;
            if (!hasStencil(depth.format) && stencilOperationSpecified) {
                throw new TypeError(
                    `Stencil operations require a depth/stencil format; received ${depth.format}`
                );
            }
            depthStencilAttachment = {
                view: depth.renderView,
                depthClearValue,
                depthLoadOp,
                depthStoreOp,
                ...(hasStencil(depth.format)
                    ? {
                          stencilClearValue:
                              depthOperation?.stencilClearValue ?? depth.stencilClearValue,
                          stencilLoadOp: depthOperation?.stencilLoadOp ?? depth.stencilLoadOp,
                          stencilStoreOp: depthOperation?.stencilStoreOp ?? depth.stencilStoreOp
                      }
                    : {})
            };
            if (hasStencil(depth.format)) {
                assertStencilClearValue(depthStencilAttachment.stencilClearValue ?? 0);
                assertLoadOp(depthStencilAttachment.stencilLoadOp ?? 'clear', 'Stencil loadOp');
                assertStoreOp(depthStencilAttachment.stencilStoreOp ?? 'store', 'Stencil storeOp');
            }
        }

        return {
            ...(options.label === undefined ? {} : { label: options.label }),
            colorAttachments,
            ...(depthStencilAttachment === undefined ? {} : { depthStencilAttachment })
        };
    }

    resize(width: number, height: number): void {
        this.assertAlive();
        assertPositiveInteger(width, 'Render-target width');
        assertPositiveInteger(height, 'Render-target height');
        this.validateDeviceLimits(width, height);
        if (width === this._width && height === this._height) return;
        this.releaseResources();
        this._width = width;
        this._height = height;
        try {
            this.createResources();
        } catch (error) {
            this.releaseResources();
            this.destroyed = true;
            throw error;
        }
    }

    async readColorAttachment(
        options: WebGPUReadColorAttachmentOptions = {}
    ): Promise<WebGPUColorAttachmentReadback> {
        this.assertAlive();
        const attachmentIndex = options.attachmentIndex ?? 0;
        if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0) {
            throw new RangeError('Color attachment index must be a non-negative integer');
        }
        const attachment = this.colorAttachments[attachmentIndex];
        if (!attachment?.resource) {
            throw new RangeError(
                `Color attachment index ${String(attachmentIndex)} is out of range`
            );
        }
        const x = options.x ?? 0;
        const y = options.y ?? 0;
        if (!Number.isInteger(x) || x < 0 || !Number.isInteger(y) || y < 0) {
            throw new RangeError('Readback origin must contain non-negative integers');
        }
        const width = options.width ?? this._width - x;
        const height = options.height ?? this._height - y;
        assertPositiveInteger(width, 'Readback width');
        assertPositiveInteger(height, 'Readback height');
        if (x + width > this._width || y + height > this._height) {
            throw new RangeError('Readback rectangle exceeds the color attachment bounds');
        }
        const bytesPerPixel = attachment.formatInfo.bytesPerPixel;
        const bytesPerRow = width * bytesPerPixel;
        const alignedBytesPerRow = align(bytesPerRow, WEBGPU_BYTES_PER_ROW_ALIGNMENT);
        const readBuffer = this.device.createBuffer({
            label: `${attachment.label}.readback`,
            size: alignedBytesPerRow * height,
            usage: WebGPUBufferUsage.COPY_DST | WebGPUBufferUsage.MAP_READ
        });
        const encoder = this.device.createCommandEncoder({
            label: `${attachment.label}.readbackEncoder`
        });
        encoder.copyTextureToBuffer(
            {
                texture: attachment.resource.gpuTexture,
                origin: { x, y, z: 0 },
                mipLevel: 0,
                aspect: 'all'
            },
            {
                buffer: readBuffer,
                offset: 0,
                bytesPerRow: alignedBytesPerRow,
                rowsPerImage: height
            },
            { width, height, depthOrArrayLayers: 1 }
        );
        this.device.queue.submit([encoder.finish()]);

        let mapped = false;
        try {
            await readBuffer.mapAsync(WebGPUMapMode.READ, 0, alignedBytesPerRow * height);
            mapped = true;
            const mappedBytes = new Uint8Array(readBuffer.getMappedRange());
            const data = new Uint8Array(bytesPerRow * height);
            for (let row = 0; row < height; row++) {
                data.set(
                    mappedBytes.subarray(
                        row * alignedBytesPerRow,
                        row * alignedBytesPerRow + bytesPerRow
                    ),
                    row * bytesPerRow
                );
            }
            return {
                data,
                format: attachment.format,
                width,
                height,
                bytesPerPixel,
                bytesPerRow
            };
        } finally {
            if (mapped) readBuffer.unmap();
            readBuffer.destroy();
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.releaseResources();
        this.destroyed = true;
    }
}
