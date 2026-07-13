import {
    ALWAYS,
    CLAMP_TO_EDGE,
    COLOR_ATTACHMENT0,
    COLOR_BUFFER_BIT,
    DEPTH_ATTACHMENT,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    DEPTH_STENCIL,
    DEPTH_STENCIL_ATTACHMENT,
    EQUAL,
    FLOAT,
    GEQUAL,
    GREATER,
    LEQUAL,
    LESS,
    NEAREST,
    NEVER,
    NOTEQUAL,
    RGBA,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../constants/webgl';
import {
    COMPARE_REF_TO_TEXTURE,
    DEPTH24_STENCIL8,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F,
    DRAW_FRAMEBUFFER,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    HALF_FLOAT,
    READ_FRAMEBUFFER,
    RGBA16F,
    RGBA32F,
    RGBA8,
    SRGB8_ALPHA8,
    UNSIGNED_INT_24_8
} from '../constants/webgl2';
import Texture from '../texture/Texture';
import Framebuffer, { type FramebufferAttachmentInfo } from './Framebuffer';
import { presentWebGLTexture } from './WebGLCanvasPresenter';
import {
    normalizeRenderTargetParameters,
    renderTargetFormatHasStencil,
    type NormalizedRenderTargetColorAttachment,
    type NormalizedRenderTargetDepthStencilAttachment,
    type NormalizedRenderTargetParameters,
    type RenderTarget,
    type RenderTargetColorAttachmentReadback,
    type RenderTargetColorFormat,
    type RenderTargetCompareFunction,
    type RenderTargetDepthStencilFormat,
    type RenderTargetParameters,
    type RenderTargetReadColorAttachmentOptions,
    type RenderTargetSampleCount
} from './RenderTarget';
import type WebGLRenderer from './WebGLRenderer';

interface WebGLColorFormatDescription {
    readonly internalFormat: GLenum;
    readonly format: GLenum;
    readonly type: GLenum;
}

interface WebGLDepthFormatDescription extends WebGLColorFormatDescription {
    readonly attachment: GLenum;
}

function colorFormatDescription(format: RenderTargetColorFormat): WebGLColorFormatDescription {
    switch (format) {
        case 'rgba8unorm':
            return { internalFormat: RGBA8, format: RGBA, type: UNSIGNED_BYTE };
        case 'rgba8unorm-srgb':
            return { internalFormat: SRGB8_ALPHA8, format: RGBA, type: UNSIGNED_BYTE };
        case 'rgba16float':
            return { internalFormat: RGBA16F, format: RGBA, type: HALF_FLOAT };
        case 'rgba32float':
            return { internalFormat: RGBA32F, format: RGBA, type: FLOAT };
    }
}

function depthFormatDescription(
    format: RenderTargetDepthStencilFormat
): WebGLDepthFormatDescription {
    switch (format) {
        case 'depth16unorm':
            return {
                internalFormat: DEPTH_COMPONENT16,
                format: DEPTH_COMPONENT,
                type: UNSIGNED_SHORT,
                attachment: DEPTH_ATTACHMENT
            };
        case 'depth24plus':
            return {
                internalFormat: DEPTH_COMPONENT24,
                format: DEPTH_COMPONENT,
                type: UNSIGNED_INT,
                attachment: DEPTH_ATTACHMENT
            };
        case 'depth24plus-stencil8':
            return {
                internalFormat: DEPTH24_STENCIL8,
                format: DEPTH_STENCIL,
                type: UNSIGNED_INT_24_8,
                attachment: DEPTH_STENCIL_ATTACHMENT
            };
        case 'depth32float':
            return {
                internalFormat: DEPTH_COMPONENT32F,
                format: DEPTH_COMPONENT,
                type: FLOAT,
                attachment: DEPTH_ATTACHMENT
            };
        case 'depth32float-stencil8':
            return {
                internalFormat: DEPTH32F_STENCIL8,
                format: DEPTH_STENCIL,
                type: FLOAT_32_UNSIGNED_INT_24_8_REV,
                attachment: DEPTH_STENCIL_ATTACHMENT
            };
    }
}

function compareFunction(compare: RenderTargetCompareFunction): GLenum {
    switch (compare) {
        case 'never':
            return NEVER;
        case 'less':
            return LESS;
        case 'equal':
            return EQUAL;
        case 'less-equal':
            return LEQUAL;
        case 'greater':
            return GREATER;
        case 'not-equal':
            return NOTEQUAL;
        case 'greater-equal':
            return GEQUAL;
        case 'always':
            return ALWAYS;
    }
}

function numericLimit(gl: WebGL2RenderingContext, parameter: GLenum, name: string): number {
    const value: unknown = gl.getParameter(parameter);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`WebGL2 did not expose a numeric ${name} limit`);
    }
    return value;
}

function colorAttachmentInfo(
    attachment: NormalizedRenderTargetColorAttachment,
    sampleCount: RenderTargetSampleCount,
    asTexture: boolean
): FramebufferAttachmentInfo {
    const format = colorFormatDescription(attachment.format);
    return {
        attachmentType: asTexture
            ? Framebuffer.ATTACHMENT_TYPE_TEXTURE
            : Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
        internalFormat: format.internalFormat,
        format: format.format,
        type: format.type,
        minFilter: NEAREST,
        magFilter: NEAREST,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        ...(asTexture ? {} : { samples: sampleCount })
    };
}

function depthAttachmentInfo(
    attachment: NormalizedRenderTargetDepthStencilAttachment,
    sampleCount: RenderTargetSampleCount
): FramebufferAttachmentInfo {
    const format = depthFormatDescription(attachment.format);
    return {
        attachmentType: attachment.sampled
            ? Framebuffer.ATTACHMENT_TYPE_TEXTURE
            : Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
        attachment: format.attachment,
        internalFormat: format.internalFormat,
        format: format.format,
        type: format.type,
        minFilter: NEAREST,
        magFilter: NEAREST,
        wrapS: CLAMP_TO_EDGE,
        wrapT: CLAMP_TO_EDGE,
        ...(!attachment.sampled && sampleCount > 1 ? { samples: sampleCount } : {})
    };
}

/** WebGL 2 implementation of the backend-neutral render-target contract. */
class WebGLRenderTarget implements RenderTarget {
    readonly backend = 'webgl2' as const;
    readonly className = 'WebGLRenderTarget';
    readonly isWebGLRenderTarget = true;
    private readonly owner: WebGLRenderer;
    readonly label: string;
    readonly sampleCount: RenderTargetSampleCount;
    readonly colorFormats: readonly RenderTargetColorFormat[];
    readonly depthStencilFormat: RenderTargetDepthStencilFormat | null;

    private parameters: NormalizedRenderTargetParameters;
    private readonly drawFramebuffer: Framebuffer;
    private resolveFramebuffers: Framebuffer[];
    private destroyed = false;
    private readonly onDestroy: (target: WebGLRenderTarget) => void;

    get width(): number {
        return this.parameters.width;
    }

    get height(): number {
        return this.parameters.height;
    }

    get colorAttachmentCount(): number {
        return this.parameters.colorAttachments.length;
    }

    get isDestroyed(): boolean {
        return this.destroyed;
    }

    constructor(
        owner: WebGLRenderer,
        parameters: RenderTargetParameters,
        onDestroy: (target: WebGLRenderTarget) => void = () => undefined
    ) {
        if (!owner.isInit) {
            throw new Error('WebGL render targets require an initialized WebGL2 renderer');
        }
        const normalized = normalizeRenderTargetParameters(parameters);
        const maxColorAttachments = numericLimit(
            owner.gl,
            owner.gl.MAX_COLOR_ATTACHMENTS,
            'MAX_COLOR_ATTACHMENTS'
        );
        if (normalized.colorAttachments.length > maxColorAttachments) {
            throw new RangeError(
                `Render target has ${String(normalized.colorAttachments.length)} color attachments; this WebGL2 renderer supports ${String(maxColorAttachments)}`
            );
        }
        if (normalized.sampleCount > numericLimit(owner.gl, owner.gl.MAX_SAMPLES, 'MAX_SAMPLES')) {
            throw new RangeError(
                `Render target requests ${String(normalized.sampleCount)} samples beyond this WebGL2 renderer limit`
            );
        }
        this.owner = owner;
        this.parameters = normalized;
        this.label = normalized.label;
        this.sampleCount = normalized.sampleCount;
        this.colorFormats = Object.freeze(
            normalized.colorAttachments.map(attachment => attachment.format)
        );
        this.depthStencilFormat = normalized.depthStencilAttachment?.format ?? null;
        this.onDestroy = onDestroy;
        const resources = this.createFramebuffers(normalized);
        this.drawFramebuffer = resources.draw;
        this.resolveFramebuffers = resources.resolves;
        this.configureSampledDepth();
    }

    private assertAlive(): void {
        if (this.destroyed) throw new Error('WebGL render target has been destroyed');
    }

    private createFramebuffers(parameters: NormalizedRenderTargetParameters): {
        draw: Framebuffer;
        resolves: Framebuffer[];
    } {
        const multisampled = parameters.sampleCount > 1;
        const draw = new Framebuffer(this.owner, {
            width: parameters.width,
            height: parameters.height,
            needRenderbuffer: false,
            colorAttachmentInfos: parameters.colorAttachments.map(attachment =>
                colorAttachmentInfo(attachment, parameters.sampleCount, !multisampled)
            ),
            ...(parameters.depthStencilAttachment
                ? {
                      depthStencilAttachmentInfo: depthAttachmentInfo(
                          parameters.depthStencilAttachment,
                          parameters.sampleCount
                      )
                  }
                : {})
        });
        const resolves: Framebuffer[] = [];
        try {
            draw.init();
            if (multisampled && parameters.colorAttachments.length > 0) {
                for (const attachment of parameters.colorAttachments) {
                    const resolve = new Framebuffer(this.owner, {
                        width: parameters.width,
                        height: parameters.height,
                        needRenderbuffer: false,
                        colorAttachmentInfos: [colorAttachmentInfo(attachment, 1, true)]
                    });
                    resolve.init();
                    resolves.push(resolve);
                }
            }
            return { draw, resolves };
        } catch (error) {
            draw.destroy();
            resolves.forEach(resolve => resolve.destroy());
            throw error;
        }
    }

    private configureSampledDepth(): void {
        const depth = this.parameters.depthStencilAttachment;
        if (!depth?.sampled) return;
        const texture = this.getDepthTexture();
        if (!texture) throw new Error('Sampled depth attachment did not create a texture');
        const { gl, state } = this.owner;
        const glTexture = texture.getGLTexture(state);
        state.activeTexture(gl.TEXTURE0);
        state.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, COMPARE_REF_TO_TEXTURE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, compareFunction(depth.compare));
    }

    /** Restore sampler state after WebGL context recreation rebuilt the wrapped framebuffers. */
    handleContextRestored(): void {
        this.assertAlive();
        this.configureSampledDepth();
    }

    getColorTexture(index = 0): Texture<unknown> {
        this.assertAlive();
        if (!Number.isSafeInteger(index) || index < 0) {
            throw new RangeError('Color attachment index must be a non-negative integer');
        }
        const resolvedSource = this.resolveFramebuffers[index];
        const source = resolvedSource ?? this.drawFramebuffer;
        const texture = source.colorAttachmentInfos[resolvedSource ? 0 : index]?.texture;
        if (!(texture instanceof Texture)) {
            throw new RangeError(`Color attachment index ${String(index)} is out of range`);
        }
        return texture;
    }

    getDepthTexture(): Texture<unknown> | null {
        this.assertAlive();
        const texture = this.drawFramebuffer.depthStencilAttachmentInfo?.texture;
        if (texture === undefined || texture === null) return null;
        if (!(texture instanceof Texture)) {
            throw new TypeError('WebGL depth attachment is not an engine Texture');
        }
        return texture;
    }

    /** Bind and apply the attachment load operations for one renderer-owned pass. */
    beginRenderPass(): void {
        this.assertAlive();
        const { gl, state } = this.owner;
        this.drawFramebuffer.bind();
        state.viewport(0, 0, this.width, this.height);
        if (this.parameters.colorAttachments.some(attachment => attachment.loadOp === 'clear')) {
            state.colorMask(true, true, true, true);
        }
        for (const [index, attachment] of this.parameters.colorAttachments.entries()) {
            if (attachment.loadOp === 'clear') {
                const color = attachment.clearValue;
                gl.clearBufferfv(
                    gl.COLOR,
                    index,
                    new Float32Array([color.r, color.g, color.b, color.a])
                );
            }
        }
        const depth = this.parameters.depthStencilAttachment;
        if (!depth) return;
        const hasStencil = renderTargetFormatHasStencil(depth.format);
        if (depth.depthLoadOp === 'clear') state.depthMask(true);
        if (hasStencil && depth.stencilLoadOp === 'clear') state.stencilMask(0xff);
        if (depth.depthLoadOp === 'clear' && hasStencil && depth.stencilLoadOp === 'clear') {
            gl.clearBufferfi(gl.DEPTH_STENCIL, 0, depth.depthClearValue, depth.stencilClearValue);
            return;
        }
        if (depth.depthLoadOp === 'clear') {
            gl.clearBufferfv(gl.DEPTH, 0, new Float32Array([depth.depthClearValue]));
        }
        if (hasStencil && depth.stencilLoadOp === 'clear') {
            gl.clearBufferiv(gl.STENCIL, 0, new Int32Array([depth.stencilClearValue]));
        }
    }

    /** Resolve MSAA, apply store operations and restore the canvas framebuffer. */
    endRenderPass(commit: boolean): void {
        const { gl, state } = this.owner;
        try {
            if (!this.destroyed && commit) {
                this.resolveColorAttachments();
                const invalidated: GLenum[] = [];
                this.parameters.colorAttachments.forEach((attachment, index) => {
                    if (attachment.storeOp === 'discard') {
                        invalidated.push(COLOR_ATTACHMENT0 + index);
                    }
                });
                const depth = this.parameters.depthStencilAttachment;
                if (depth) {
                    if (renderTargetFormatHasStencil(depth.format)) {
                        if (
                            depth.depthStoreOp === 'discard' &&
                            depth.stencilStoreOp === 'discard'
                        ) {
                            invalidated.push(DEPTH_STENCIL_ATTACHMENT);
                        }
                    } else if (depth.depthStoreOp === 'discard') {
                        invalidated.push(DEPTH_ATTACHMENT);
                    }
                }
                if (invalidated.length > 0) {
                    state.bindFramebuffer(gl.FRAMEBUFFER, this.drawFramebuffer.framebuffer);
                    gl.invalidateFramebuffer(gl.FRAMEBUFFER, invalidated);
                }
            }
        } finally {
            try {
                this.drawFramebuffer.unbind();
            } finally {
                state.bindSystemFramebuffer();
                this.owner.viewport();
            }
        }
    }

    private resolveColorAttachments(): void {
        const { gl, state } = this.owner;
        if (this.resolveFramebuffers.length === 0) return;
        const previousRead = state.currentReadFramebuffer;
        const previousDraw = state.currentDrawFramebuffer;
        state.bindFramebuffer(READ_FRAMEBUFFER, this.drawFramebuffer.framebuffer);
        try {
            for (let index = 0; index < this.colorAttachmentCount; index++) {
                const destination = this.resolveFramebuffers[index];
                if (!destination) {
                    throw new Error(
                        `Missing WebGL2 resolve target for color attachment ${String(index)}`
                    );
                }
                state.bindFramebuffer(DRAW_FRAMEBUFFER, destination.framebuffer);
                const attachment = COLOR_ATTACHMENT0 + index;
                gl.readBuffer(attachment);
                gl.drawBuffers([COLOR_ATTACHMENT0]);
                gl.blitFramebuffer(
                    0,
                    0,
                    this.width,
                    this.height,
                    0,
                    0,
                    this.width,
                    this.height,
                    COLOR_BUFFER_BIT,
                    NEAREST
                );
            }
        } finally {
            state.bindFramebuffer(READ_FRAMEBUFFER, previousRead);
            state.bindFramebuffer(DRAW_FRAMEBUFFER, previousDraw);
        }
    }

    presentToCanvas(): void {
        this.assertAlive();
        if (this.colorAttachmentCount === 0) {
            throw new TypeError('A depth-only render target cannot be presented');
        }
        presentWebGLTexture(this.owner, this.getColorTexture(0));
    }

    readColorAttachment(
        options: RenderTargetReadColorAttachmentOptions = {}
    ): Promise<RenderTargetColorAttachmentReadback> {
        this.assertAlive();
        const attachmentIndex = options.attachmentIndex ?? 0;
        if (!Number.isSafeInteger(attachmentIndex) || attachmentIndex < 0) {
            throw new RangeError('Color attachment index must be a non-negative integer');
        }
        const format = this.colorFormats[attachmentIndex];
        if (!format) {
            throw new RangeError(
                `Color attachment index ${String(attachmentIndex)} is out of range`
            );
        }
        const x = options.x ?? 0;
        const y = options.y ?? 0;
        if (!Number.isSafeInteger(x) || x < 0 || !Number.isSafeInteger(y) || y < 0) {
            throw new RangeError('Readback origin must contain non-negative integers');
        }
        const width = options.width ?? this.width - x;
        const height = options.height ?? this.height - y;
        if (
            !Number.isSafeInteger(width) ||
            width <= 0 ||
            !Number.isSafeInteger(height) ||
            height <= 0
        ) {
            throw new RangeError('Readback size must contain positive integers');
        }
        if (x + width > this.width || y + height > this.height) {
            throw new RangeError('Readback rectangle exceeds the color attachment bounds');
        }
        const resolvedSource = this.resolveFramebuffers[attachmentIndex];
        const source = resolvedSource ?? this.drawFramebuffer;
        const description = colorFormatDescription(format);
        const texelCount = width * height * 4;
        const storage =
            format === 'rgba16float'
                ? new Uint16Array(texelCount)
                : format === 'rgba32float'
                  ? new Float32Array(texelCount)
                  : new Uint8Array(texelCount);
        const { gl, state } = this.owner;
        const previousRead = state.currentReadFramebuffer;
        state.bindFramebuffer(READ_FRAMEBUFFER, source.framebuffer);
        try {
            gl.readBuffer(resolvedSource ? COLOR_ATTACHMENT0 : COLOR_ATTACHMENT0 + attachmentIndex);
            gl.readPixels(
                x,
                this.height - y - height,
                width,
                height,
                description.format,
                description.type,
                storage
            );
        } finally {
            state.bindFramebuffer(READ_FRAMEBUFFER, previousRead);
        }
        const bytesPerPixel = storage.BYTES_PER_ELEMENT * 4;
        const bytesPerRow = width * bytesPerPixel;
        const nativeRows = new Uint8Array(storage.buffer, storage.byteOffset, storage.byteLength);
        const data = new Uint8Array(storage.byteLength);
        for (let row = 0; row < height; row++) {
            const sourceOffset = (height - row - 1) * bytesPerRow;
            data.set(
                nativeRows.subarray(sourceOffset, sourceOffset + bytesPerRow),
                row * bytesPerRow
            );
        }
        return Promise.resolve({ data, format, width, height, bytesPerPixel, bytesPerRow });
    }

    resize(width: number, height: number): void {
        this.assertAlive();
        if (width === this.width && height === this.height) return;
        const depth = this.parameters.depthStencilAttachment;
        const normalized = normalizeRenderTargetParameters({
            width,
            height,
            colorAttachments: this.parameters.colorAttachments,
            depthStencilAttachment: depth
                ? {
                      format: depth.format,
                      sampled: depth.sampled,
                      ...(depth.sampled ? { compare: depth.compare } : {}),
                      depthClearValue: depth.depthClearValue,
                      depthLoadOp: depth.depthLoadOp,
                      depthStoreOp: depth.depthStoreOp,
                      ...(renderTargetFormatHasStencil(depth.format)
                          ? {
                                stencilClearValue: depth.stencilClearValue,
                                stencilLoadOp: depth.stencilLoadOp,
                                stencilStoreOp: depth.stencilStoreOp
                            }
                          : {}),
                      label: depth.label
                  }
                : false,
            sampleCount: this.parameters.sampleCount,
            label: this.parameters.label
        });
        const previousParameters = this.parameters;
        const framebuffers = [this.drawFramebuffer, ...this.resolveFramebuffers];
        try {
            framebuffers.forEach(framebuffer => {
                framebuffer.resize(width, height);
            });
            this.parameters = normalized;
            this.configureSampledDepth();
        } catch (error) {
            this.parameters = previousParameters;
            const rollbackErrors: unknown[] = [];
            for (const framebuffer of framebuffers) {
                try {
                    framebuffer.resize(previousParameters.width, previousParameters.height, true);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length === 0) {
                try {
                    this.configureSampledDepth();
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (rollbackErrors.length > 0) {
                this.destroy();
                throw new AggregateError(
                    [error, ...rollbackErrors],
                    'WebGL render-target resize failed and rollback could not restore every attachment',
                    { cause: error }
                );
            }
            throw error;
        }
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.drawFramebuffer.destroy();
        this.resolveFramebuffers.forEach(resolve => resolve.destroy());
        this.resolveFramebuffers = [];
        this.onDestroy(this);
    }
}

export default WebGLRenderTarget;
