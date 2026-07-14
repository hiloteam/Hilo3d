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
import { WebGPUDevice } from '../../rhi/webgpu/WebGPUDevice';
import type {
    RenderTarget,
    RenderTargetColorAttachmentOptions,
    RenderTargetColorAttachmentReadback,
    RenderTargetColorFormat,
    RenderTargetDepthStencilAttachmentOptions,
    RenderTargetDepthStencilFormat,
    RenderTargetParameters,
    RenderTargetReadColorAttachmentOptions
} from '../common/RenderTarget';
import { WebGPUBufferUsage, WebGPUMapMode, WebGPUTextureUsage } from './WebGPUConstants';
import {
    createWebGPUSamplerDescriptor,
    registerWebGPUExternalTexture,
    registerWebGPUExternalTextureOwner,
    releaseWebGPUTextureResource,
    replaceWebGPUExternalTextureBatch,
    resolveWebGPUTextureFormat,
    unregisterWebGPUExternalTextureOwner,
    type default as WebGPUTextureManager,
    type WebGPUExternalTextureRegistration,
    type WebGPUTextureFormatInfo,
    type WebGPUTextureResource
} from './WebGPUTextureManager';

export const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256;

export type WebGPUColorRenderTargetFormat = RenderTargetColorFormat;

export type WebGPUDepthStencilRenderTargetFormat = RenderTargetDepthStencilFormat;

export interface WebGPUColorAttachmentOptions extends RenderTargetColorAttachmentOptions {
    /** Stable engine texture identity exposed to materials; its GPU allocation becomes target-owned. */
    readonly texture?: Texture<unknown>;
    /** Native target format. It must agree with `texture` when both are supplied. */
}

export interface WebGPUDepthStencilAttachmentOptions extends RenderTargetDepthStencilAttachmentOptions {
    /** Supplying a texture implies `sampled: true`. */
    readonly texture?: Texture<unknown>;
}

export interface WebGPURenderTargetParameters extends Omit<
    RenderTargetParameters,
    'colorAttachments' | 'depthStencilAttachment'
> {
    /** Defaults to one sampleable rgba8unorm attachment; an empty array creates a depth-only target. */
    readonly colorAttachments?: readonly WebGPUColorAttachmentOptions[];
    /** Defaults to a non-sampled depth24plus-stencil8 attachment. */
    readonly depthStencilAttachment?: WebGPUDepthStencilAttachmentOptions | false;
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

export type WebGPUReadColorAttachmentOptions = RenderTargetReadColorAttachmentOptions;

/** Tightly packed raw texel bytes in the attachment's native format. */
export type WebGPUColorAttachmentReadback = RenderTargetColorAttachmentReadback;

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

interface StagedColorAttachmentResources {
    readonly attachment: ColorAttachmentState;
    readonly gpuTexture: GPUTexture;
    readonly multisampleTexture: GPUTexture | null;
    readonly multisampleView: GPUTextureView | null;
}

interface StagedDepthStencilResources {
    readonly gpuTexture: GPUTexture;
    readonly renderView: GPUTextureView;
}

interface StagedRenderTargetResources {
    readonly colors: readonly StagedColorAttachmentResources[];
    readonly depth: StagedDepthStencilResources | null;
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
const operationGuards = new WeakMap<WebGPURenderTarget, (operation: string) => void>();

/** @internal Install a renderer-owned guard around submission-crossing target operations. */
export function setWebGPURenderTargetOperationGuard(
    target: WebGPURenderTarget,
    guard: (operation: string) => void
): void {
    operationGuards.set(target, guard);
}

export default class WebGPURenderTarget implements RenderTarget {
    readonly backend = 'webgpu' as const;
    readonly className = 'WebGPURenderTarget';
    readonly isWebGPURenderTarget = true;
    readonly sampleCount: 1 | 4;
    readonly label: string;
    readonly colorTextures: readonly Texture<unknown>[];
    readonly colorFormats: readonly WebGPUColorRenderTargetFormat[];
    readonly depthStencilFormat: WebGPUDepthStencilRenderTargetFormat | null;

    private _width: number;
    private _height: number;
    private _owner: GPUDevice | WebGPUDevice;
    private _device: GPUDevice;
    private _textureManager: WebGPUTextureManager;
    private readonly colorAttachments: ColorAttachmentState[];
    private readonly depthStencilAttachment: DepthStencilAttachmentState | null;
    private destroyed = false;
    private resourcesAvailable = false;
    private attachmentRecoveryPending = false;
    private deviceResourcesSuspended = false;
    private attachmentOwnerManager: WebGPUTextureManager | null = null;
    private readonly onDestroy: (target: WebGPURenderTarget) => void;

    private readonly invalidateAttachmentResources = (recoverImmediately = true): void => {
        if (this.destroyed) return;
        // Clear every target-side handle before the guard can reject a frame-crossing rebuild.
        // A caught guard error therefore cannot leave a stale render-pass attachment usable.
        this.releaseResources();
        this.attachmentRecoveryPending = true;
        if (this.deviceResourcesSuspended) return;
        operationGuards.get(this)?.('render-target attachment recovery');
        if (!recoverImmediately) return;
        this.ensureAttachmentResources();
    };

    private readonly ensureAttachmentResources = (): void => {
        this.assertAlive();
        if (this.resourcesAvailable) {
            this.attachmentRecoveryPending = false;
            return;
        }
        if (this.deviceResourcesSuspended || !this.attachmentRecoveryPending) {
            throw new Error('WebGPURenderTarget GPU resources are unavailable during recovery');
        }
        operationGuards.get(this)?.('render-target attachment recovery');
        try {
            this.createResources();
            this.attachmentRecoveryPending = false;
        } catch (error) {
            this.releaseResources();
            this.attachmentRecoveryPending = true;
            throw error;
        }
    };

    get device(): GPUDevice {
        return this._device;
    }

    get textureManager(): WebGPUTextureManager {
        return this._textureManager;
    }

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

    private createNativeTexture(descriptor: GPUTextureDescriptor): GPUTexture {
        return this._owner instanceof WebGPUDevice
            ? this._owner.createNativeTexture(descriptor)
            : this._owner.createTexture(descriptor);
    }

    private createNativeBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
        return this._owner instanceof WebGPUDevice
            ? this._owner.createNativeBuffer(descriptor)
            : this._owner.createBuffer(descriptor);
    }

    private createNativeCommandEncoder(descriptor: GPUCommandEncoderDescriptor): GPUCommandEncoder {
        return this._owner instanceof WebGPUDevice
            ? this._owner.createNativeCommandEncoder(descriptor)
            : this._owner.createCommandEncoder(descriptor);
    }

    private submitNative(commandBuffers: readonly GPUCommandBuffer[]): void {
        if (this._owner instanceof WebGPUDevice) this._owner.submitNative(commandBuffers);
        else this._owner.queue.submit(commandBuffers);
    }

    constructor(
        device: GPUDevice,
        textureManager: WebGPUTextureManager,
        parameters: WebGPURenderTargetParameters,
        onDestroy?: (target: WebGPURenderTarget) => void
    );
    constructor(
        deviceOrOwner: GPUDevice | WebGPUDevice,
        textureManager: WebGPUTextureManager,
        parameters: WebGPURenderTargetParameters,
        onDestroy: (target: WebGPURenderTarget) => void = () => undefined
    ) {
        const device =
            deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
        if (textureManager.device !== device) {
            throw new TypeError(
                'WebGPURenderTarget and WebGPUTextureManager must use the same device'
            );
        }
        assertPositiveInteger(parameters.width, 'Render-target width');
        assertPositiveInteger(parameters.height, 'Render-target height');
        const sampleCount: unknown = parameters.sampleCount ?? 1;
        assertSampleCount(sampleCount);
        this._owner = deviceOrOwner;
        this._device = device;
        this._textureManager = textureManager;
        this.onDestroy = onDestroy;
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
            this.registerAttachmentOwners(textureManager);
            this.createResources();
        } catch (error) {
            this.releaseResources();
            this.unregisterAttachmentOwners();
            this.destroyed = true;
            throw error;
        }
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error('WebGPURenderTarget has been destroyed');
    }

    private assertResourcesAvailable(): void {
        this.assertAlive();
        const changedTexture = this.findAttachmentTextureNeedingAllocation();
        if (changedTexture) {
            if (changedTexture.isImageReleased) {
                throw new Error(
                    `Texture ${changedTexture.id} cannot recreate changed GPU allocations after its image was released`
                );
            }
            changedTexture.destroy();
            changedTexture.needDestroy = false;
        }
        if (!this.resourcesAvailable && this.attachmentRecoveryPending) {
            this.ensureAttachmentResources();
        }
        if (!this.resourcesAvailable) {
            throw new Error('WebGPURenderTarget GPU resources are unavailable during recovery');
        }
    }

    private findAttachmentTextureNeedingAllocation(): Texture<unknown> | null {
        for (const attachment of this.colorAttachments) {
            if (attachment.texture.needDestroy) return attachment.texture;
        }
        const depthTexture = this.depthStencilAttachment?.texture ?? null;
        return depthTexture?.needDestroy === true ? depthTexture : null;
    }

    private forEachAttachmentTexture(visitor: (texture: Texture<unknown>) => void): void {
        for (const attachment of this.colorAttachments) visitor(attachment.texture);
        const depthTexture = this.depthStencilAttachment?.texture;
        if (depthTexture) visitor(depthTexture);
    }

    private registerAttachmentOwners(manager: WebGPUTextureManager): void {
        if (this.attachmentOwnerManager === manager) return;
        if (this.attachmentOwnerManager) {
            throw new Error('WebGPURenderTarget attachment owners are already registered');
        }
        const attachmentTextures: Texture<unknown>[] = [];
        const identities = new Set<Texture<unknown>>();
        this.forEachAttachmentTexture(texture => {
            if (identities.has(texture)) {
                throw new TypeError(
                    `Texture ${texture.id} cannot back more than one WebGPU render-target attachment`
                );
            }
            identities.add(texture);
            attachmentTextures.push(texture);
        });
        const registered: Texture<unknown>[] = [];
        try {
            for (const texture of attachmentTextures) {
                registerWebGPUExternalTextureOwner(
                    manager,
                    texture,
                    this.invalidateAttachmentResources,
                    this.ensureAttachmentResources
                );
                registered.push(texture);
            }
            this.attachmentOwnerManager = manager;
        } catch (error) {
            for (const texture of registered) {
                unregisterWebGPUExternalTextureOwner(manager, texture);
            }
            throw error;
        }
    }

    private unregisterAttachmentOwners(): void {
        const manager = this.attachmentOwnerManager;
        if (!manager) return;
        this.forEachAttachmentTexture(texture => {
            unregisterWebGPUExternalTextureOwner(manager, texture);
        });
        this.attachmentOwnerManager = null;
    }

    private validateAttachmentTextures(): void {
        for (const [index, attachment] of this.colorAttachments.entries()) {
            validateRenderTargetTexture(attachment.texture, `Color attachment ${String(index)}`);
            const format = resolveWebGPUTextureFormat(attachment.texture).format;
            if (format !== attachment.format) {
                throw new TypeError(
                    `Color attachment ${String(index)} changed from ${attachment.format} to ${format}`
                );
            }
        }
        const depth = this.depthStencilAttachment;
        if (!depth?.texture) return;
        validateRenderTargetTexture(depth.texture, 'Depth/stencil attachment');
        const format = resolveWebGPUTextureFormat(depth.texture).format;
        if (format !== depth.format) {
            throw new TypeError(
                `Depth/stencil attachment changed from ${depth.format} to ${format}`
            );
        }
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
        this.resourcesAvailable = false;
        this.validateAttachmentTextures();
        for (const attachment of this.colorAttachments) {
            attachment.texture.width = this._width;
            attachment.texture.height = this._height;
            attachment.texture.needUpdate = false;
            attachment.texture.needDestroy = false;
            const resolveTexture = this.createNativeTexture({
                label: attachment.label,
                size: { width: this._width, height: this._height, depthOrArrayLayers: 1 },
                mipLevelCount: 1,
                sampleCount: 1,
                dimension: '2d',
                format: attachment.format,
                usage:
                    WebGPUTextureUsage.COPY_SRC |
                    WebGPUTextureUsage.COPY_DST |
                    WebGPUTextureUsage.TEXTURE_BINDING |
                    WebGPUTextureUsage.RENDER_ATTACHMENT
            });
            attachment.resource = registerWebGPUExternalTexture(
                this.textureManager,
                attachment.texture,
                resolveTexture,
                { takeOwnership: true }
            );
            if (this.sampleCount > 1) {
                attachment.multisampleTexture = this.createNativeTexture({
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
        if (!depth) {
            this.resourcesAvailable = true;
            return;
        }
        if (depth.texture) {
            depth.texture.width = this._width;
            depth.texture.height = this._height;
            depth.texture.needUpdate = false;
            depth.texture.needDestroy = false;
        }
        depth.gpuTexture = this.createNativeTexture({
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
        try {
            depth.renderView = depth.gpuTexture.createView({ dimension: '2d' });
        } catch (error) {
            depth.gpuTexture.destroy();
            depth.gpuTexture = null;
            depth.renderView = null;
            throw error;
        }
        if (depth.texture) {
            try {
                registerWebGPUExternalTexture(
                    this.textureManager,
                    depth.texture,
                    depth.gpuTexture,
                    {
                        takeOwnership: true,
                        compare: depth.compare,
                        viewDescriptor: {
                            dimension: '2d',
                            aspect: hasStencil(depth.format) ? 'depth-only' : 'all'
                        }
                    }
                );
            } catch (error) {
                depth.gpuTexture = null;
                depth.renderView = null;
                throw error;
            }
        }
        this.resourcesAvailable = true;
    }

    private releaseResources(): void {
        this.resourcesAvailable = false;
        for (const attachment of this.colorAttachments) {
            if (attachment.resource) {
                releaseWebGPUTextureResource(this.textureManager, attachment.texture);
            }
            attachment.resource = null;
            attachment.multisampleTexture?.destroy();
            attachment.multisampleTexture = null;
            attachment.multisampleView = null;
        }
        const depth = this.depthStencilAttachment;
        if (!depth?.gpuTexture) return;
        if (depth.texture) {
            releaseWebGPUTextureResource(this.textureManager, depth.texture);
        } else {
            depth.gpuTexture.destroy();
        }
        depth.gpuTexture = null;
        depth.renderView = null;
    }

    private stageResources(width: number, height: number): StagedRenderTargetResources {
        const colors: StagedColorAttachmentResources[] = [];
        let depth: StagedDepthStencilResources | null = null;
        try {
            for (const attachment of this.colorAttachments) {
                const gpuTexture = this.createNativeTexture({
                    label: attachment.label,
                    size: { width, height, depthOrArrayLayers: 1 },
                    mipLevelCount: 1,
                    sampleCount: 1,
                    dimension: '2d',
                    format: attachment.format,
                    usage:
                        WebGPUTextureUsage.COPY_SRC |
                        WebGPUTextureUsage.COPY_DST |
                        WebGPUTextureUsage.TEXTURE_BINDING |
                        WebGPUTextureUsage.RENDER_ATTACHMENT
                });
                let multisampleTexture: GPUTexture | null = null;
                let multisampleView: GPUTextureView | null = null;
                try {
                    if (this.sampleCount > 1) {
                        multisampleTexture = this.createNativeTexture({
                            label: `${attachment.label}.multisample`,
                            size: { width, height, depthOrArrayLayers: 1 },
                            mipLevelCount: 1,
                            sampleCount: this.sampleCount,
                            dimension: '2d',
                            format: attachment.format,
                            usage: WebGPUTextureUsage.RENDER_ATTACHMENT
                        });
                        multisampleView = multisampleTexture.createView({ dimension: '2d' });
                    }
                } catch (error) {
                    gpuTexture.destroy();
                    multisampleTexture?.destroy();
                    throw error;
                }
                colors.push({
                    attachment,
                    gpuTexture,
                    multisampleTexture,
                    multisampleView
                });
            }

            const attachment = this.depthStencilAttachment;
            if (attachment) {
                const gpuTexture = this.createNativeTexture({
                    label: attachment.label,
                    size: { width, height, depthOrArrayLayers: 1 },
                    mipLevelCount: 1,
                    sampleCount: this.sampleCount,
                    dimension: '2d',
                    format: attachment.format,
                    usage:
                        WebGPUTextureUsage.RENDER_ATTACHMENT |
                        (attachment.sampled ? WebGPUTextureUsage.TEXTURE_BINDING : 0)
                });
                try {
                    depth = {
                        gpuTexture,
                        renderView: gpuTexture.createView({ dimension: '2d' })
                    };
                } catch (error) {
                    gpuTexture.destroy();
                    throw error;
                }
            }
            return { colors, depth };
        } catch (error) {
            for (const color of colors) {
                color.gpuTexture.destroy();
                color.multisampleTexture?.destroy();
            }
            throw error;
        }
    }

    private destroyStagedUnregisteredResources(staged: StagedRenderTargetResources): void {
        for (const color of staged.colors) color.multisampleTexture?.destroy();
        if (staged.depth && this.depthStencilAttachment?.texture === null) {
            staged.depth.gpuTexture.destroy();
        }
    }

    /** @internal Suspend native allocations while retaining the public target and textures. */
    private suspendDeviceResources(): void {
        if (this.destroyed) return;
        this.deviceResourcesSuspended = true;
        this.attachmentRecoveryPending = false;
        this.releaseResources();
    }

    /** @internal Recreate native allocations on a replacement WebGPU device. */
    private restoreDeviceResources(
        deviceOrOwner: GPUDevice | WebGPUDevice,
        textureManager: WebGPUTextureManager
    ): void {
        this.assertAlive();
        const device =
            deviceOrOwner instanceof WebGPUDevice ? deviceOrOwner.nativeDevice : deviceOrOwner;
        if (textureManager.device !== device) {
            throw new TypeError(
                'WebGPURenderTarget and WebGPUTextureManager must use the same device'
            );
        }
        this.releaseResources();
        this.unregisterAttachmentOwners();
        this._owner = deviceOrOwner;
        this._device = device;
        this._textureManager = textureManager;
        this.deviceResourcesSuspended = false;
        this.attachmentRecoveryPending = false;
        try {
            this.registerAttachmentOwners(textureManager);
            this.validateDeviceLimits(this._width, this._height);
            this.createResources();
        } catch (error) {
            this.releaseResources();
            this.attachmentRecoveryPending = this.attachmentOwnerManager !== null;
            throw error;
        }
    }

    getColorTexture(index = 0): Texture<unknown> {
        this.assertAlive();
        const texture = this.colorAttachments[index]?.texture;
        if (!texture)
            throw new RangeError(`Color attachment index ${String(index)} is out of range`);
        return texture;
    }

    getDepthTexture(): Texture<unknown> | null {
        return this.depthTexture;
    }

    getColorGPUTexture(index = 0): GPUTexture {
        this.assertResourcesAvailable();
        const texture = this.colorAttachments[index]?.resource?.gpuTexture;
        if (!texture)
            throw new RangeError(`Color attachment index ${String(index)} is out of range`);
        return texture;
    }

    getDepthStencilGPUTexture(): GPUTexture | null {
        this.assertResourcesAvailable();
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
        this.assertResourcesAvailable();
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
        operationGuards.get(this)?.('render-target resize');
        if (!this.resourcesAvailable) {
            this._width = width;
            this._height = height;
            for (const attachment of this.colorAttachments) {
                attachment.texture.width = width;
                attachment.texture.height = height;
            }
            const depthTexture = this.depthStencilAttachment?.texture;
            if (depthTexture) {
                depthTexture.width = width;
                depthTexture.height = height;
            }
            return;
        }

        this.validateAttachmentTextures();

        const staged = this.stageResources(width, height);
        const previousColorDimensions = this.colorAttachments.map(attachment => ({
            width: attachment.texture.width,
            height: attachment.texture.height
        }));
        const depthTexture = this.depthStencilAttachment?.texture ?? null;
        const previousDepthDimensions = depthTexture
            ? { width: depthTexture.width, height: depthTexture.height }
            : null;
        for (const attachment of this.colorAttachments) {
            attachment.texture.width = width;
            attachment.texture.height = height;
        }
        if (depthTexture) {
            depthTexture.width = width;
            depthTexture.height = height;
        }

        const registrations: WebGPUExternalTextureRegistration[] = staged.colors.map(color => ({
            texture: color.attachment.texture,
            gpuTexture: color.gpuTexture,
            options: { takeOwnership: true }
        }));
        const depth = this.depthStencilAttachment;
        if (depth?.texture && staged.depth) {
            registrations.push({
                texture: depth.texture,
                gpuTexture: staged.depth.gpuTexture,
                options: {
                    takeOwnership: true,
                    compare: depth.compare,
                    viewDescriptor: {
                        dimension: '2d',
                        aspect: hasStencil(depth.format) ? 'depth-only' : 'all'
                    }
                }
            });
        }

        let resources: readonly WebGPUTextureResource[];
        try {
            resources = replaceWebGPUExternalTextureBatch(this.textureManager, registrations);
        } catch (error) {
            this.colorAttachments.forEach((attachment, index) => {
                const dimensions = previousColorDimensions[index];
                if (!dimensions) return;
                attachment.texture.width = dimensions.width;
                attachment.texture.height = dimensions.height;
            });
            if (depthTexture && previousDepthDimensions) {
                depthTexture.width = previousDepthDimensions.width;
                depthTexture.height = previousDepthDimensions.height;
            }
            this.destroyStagedUnregisteredResources(staged);
            throw error;
        }

        const previousMultisampleTextures = this.colorAttachments.map(
            attachment => attachment.multisampleTexture
        );
        const previousDepthGPUTexture = depth?.gpuTexture ?? null;
        for (const [index, stagedColor] of staged.colors.entries()) {
            const resource = resources[index];
            if (!resource) {
                throw new Error(
                    `Atomic external-texture replacement omitted color attachment ${String(index)}`
                );
            }
            stagedColor.attachment.resource = resource;
            stagedColor.attachment.multisampleTexture = stagedColor.multisampleTexture;
            stagedColor.attachment.multisampleView = stagedColor.multisampleView;
        }
        if (depth && staged.depth) {
            depth.gpuTexture = staged.depth.gpuTexture;
            depth.renderView = staged.depth.renderView;
        }
        this._width = width;
        this._height = height;
        for (const texture of previousMultisampleTextures) texture?.destroy();
        if (depth?.texture === null) previousDepthGPUTexture?.destroy();
    }

    async readColorAttachment(
        options: WebGPUReadColorAttachmentOptions = {}
    ): Promise<WebGPUColorAttachmentReadback> {
        operationGuards.get(this)?.('render-target readback');
        this.assertResourcesAvailable();
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
        const readBuffer = this.createNativeBuffer({
            label: `${attachment.label}.readback`,
            size: alignedBytesPerRow * height,
            usage: WebGPUBufferUsage.COPY_DST | WebGPUBufferUsage.MAP_READ
        });
        const encoder = this.createNativeCommandEncoder({
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
        this.submitNative([encoder.finish()]);

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
        operationGuards.get(this)?.('render-target destroy');
        this.unregisterAttachmentOwners();
        this.releaseResources();
        this.attachmentRecoveryPending = false;
        this.deviceResourcesSuspended = false;
        this.destroyed = true;
        this.onDestroy(this);
    }
}

type WebGPURenderTargetRHIConstructor = new (
    deviceOrOwner: GPUDevice | WebGPUDevice,
    textureManager: WebGPUTextureManager,
    parameters: WebGPURenderTargetParameters,
    onDestroy?: (target: WebGPURenderTarget) => void
) => WebGPURenderTarget;

/** Create a production render target with a concrete one-hop RHI device owner. @internal */
export function createWebGPURenderTargetForRHI(
    device: WebGPUDevice,
    textureManager: WebGPUTextureManager,
    parameters: WebGPURenderTargetParameters,
    onDestroy?: (target: WebGPURenderTarget) => void
): WebGPURenderTarget {
    const InternalConstructor = WebGPURenderTarget as unknown as WebGPURenderTargetRHIConstructor;
    return new InternalConstructor(device, textureManager, parameters, onDestroy);
}

interface WebGPURenderTargetInternalAccess {
    suspendDeviceResources(): void;
    restoreDeviceResources(
        device: GPUDevice | WebGPUDevice,
        textureManager: WebGPUTextureManager
    ): void;
}

function internalTargetAccess(target: WebGPURenderTarget): WebGPURenderTargetInternalAccess {
    return target as unknown as WebGPURenderTargetInternalAccess;
}

/** Suspend native allocations while retaining target identity for device recovery. @internal */
export function suspendWebGPURenderTarget(target: WebGPURenderTarget): void {
    internalTargetAccess(target).suspendDeviceResources();
}

/** Restore a suspended target on the replacement manager/device pair. @internal */
export function restoreWebGPURenderTarget(
    target: WebGPURenderTarget,
    device: GPUDevice | WebGPUDevice,
    textureManager: WebGPUTextureManager
): void {
    internalTargetAccess(target).restoreDeviceResources(device, textureManager);
}
