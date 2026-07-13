import math from '../math/math';
import Color from '../math/Color';
import Texture, { releaseTextureWebGLAllocation, type TextureBinding } from '../texture/Texture';
import { getTypedArrayClass } from '../utils/util';
import {
    CLAMP_TO_EDGE,
    COLOR_ATTACHMENT0,
    COLOR_BUFFER_BIT,
    DEPTH_STENCIL_ATTACHMENT,
    FRAMEBUFFER,
    NEAREST,
    RGBA,
    TEXTURE_2D,
    UNSIGNED_BYTE
} from '../constants/webgl';
import { DEPTH24_STENCIL8, DRAW_FRAMEBUFFER, READ_FRAMEBUFFER, RGBA8 } from '../constants/webgl2';
import requireGLResource from './requireGLResource';
import WebGLContextCache from './WebGLContextCache';
import type Cache from '../utils/Cache';
import type WebGLState from './WebGLState';
import type { GLContext, TypedArray } from './types';

export type FramebufferAttachmentType = 'TEXTURE' | 'RENDERBUFFER';

/** Texture surface accepted by a framebuffer, including custom Texture subclasses. */
export interface FramebufferTexture extends TextureBinding {
    readonly mipmapCount: number;
    destroy(): unknown;
}

export interface FramebufferAttachmentInfo {
    attachmentType: FramebufferAttachmentType;
    framebufferTarget?: GLenum;
    attachment?: GLenum;
    samples?: number;
    target?: GLenum;
    internalFormat?: GLenum;
    format?: GLenum;
    type?: GLenum;
    minFilter?: GLenum;
    magFilter?: GLenum;
    wrapS?: GLenum;
    wrapT?: GLenum;
    data?: TypedArray | null;
    texture?: FramebufferTexture | null;
    renderbuffer?: WebGLRenderbuffer | null;
}

export interface FramebufferParameters {
    width?: number;
    height?: number;
    bufferInternalFormat?: GLenum;
    framebufferTarget?: GLenum;
    target?: GLenum;
    format?: GLenum;
    internalFormat?: GLenum;
    type?: GLenum;
    minFilter?: GLenum;
    magFilter?: GLenum;
    wrapS?: GLenum;
    wrapT?: GLenum;
    data?: TypedArray | null;
    attachment?: GLenum;
    needRenderbuffer?: boolean;
    colorAttachmentInfos?: FramebufferAttachmentInfo[];
    depthStencilAttachmentInfo?: FramebufferAttachmentInfo;
}

export interface FramebufferCopyRectangle {
    readonly 0: number;
    readonly 1: number;
    readonly 2: number;
    readonly 3: number;
}

export interface CopyFramebufferOptions {
    mask?: GLbitfield;
    filter?: GLenum;
    srcSize?: FramebufferCopyRectangle;
    dstSize?: FramebufferCopyRectangle;
}

/** Minimal renderer contract needed to allocate a framebuffer lazily. */
export interface FramebufferRenderer {
    readonly isInit: boolean;
    readonly gl: GLContext | null;
    readonly state: WebGLState | null;
    width: number;
    height: number;
}

export interface ResolvedAttachmentOptions {
    framebufferTarget: GLenum;
    attachment: GLenum;
    target: GLenum;
    format: GLenum;
    internalFormat: GLenum;
    type: GLenum;
    minFilter: GLenum;
    magFilter: GLenum;
    wrapS: GLenum;
    wrapT: GLenum;
    data: TypedArray | null;
}

const contextCaches = new WebGLContextCache<Framebuffer>();
const defaultAttachmentOptions: ResolvedAttachmentOptions = {
    framebufferTarget: FRAMEBUFFER,
    attachment: COLOR_ATTACHMENT0,
    target: TEXTURE_2D,
    format: RGBA,
    internalFormat: RGBA8,
    type: UNSIGNED_BYTE,
    minFilter: NEAREST,
    magFilter: NEAREST,
    wrapS: CLAMP_TO_EDGE,
    wrapT: CLAMP_TO_EDGE,
    data: null
};

/** Render target backed by texture or renderbuffer attachments. */
class Framebuffer {
    static readonly ATTACHMENT_TYPE_TEXTURE: FramebufferAttachmentType = 'TEXTURE';
    static readonly ATTACHMENT_TYPE_RENDERBUFFER: FramebufferAttachmentType = 'RENDERBUFFER';

    static getCache(gl: GLContext): Cache<Framebuffer> {
        return contextCaches.get(gl);
    }

    static reset(gl: GLContext): void {
        const cache = contextCaches.peek(gl);
        if (!cache) return;
        const framebuffers: Framebuffer[] = [];
        cache.each(framebuffer => {
            framebuffers.push(framebuffer);
        });
        const errors: unknown[] = [];
        for (const framebuffer of framebuffers) {
            try {
                framebuffer.reset();
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) {
            throw new AggregateError(errors, 'One or more WebGL framebuffers failed to reset');
        }
    }

    static destroy(gl: GLContext): void {
        const cache = contextCaches.peek(gl);
        if (!cache) return;
        cache.each(framebuffer => {
            framebuffer.destroy();
        });
        contextCaches.delete(gl);
    }

    readonly className = 'Framebuffer';
    readonly isFramebuffer = true;
    readonly id: string;
    readonly renderer: FramebufferRenderer;

    width: number;
    height: number;
    bufferInternalFormat = DEPTH24_STENCIL8;
    framebufferTarget = defaultAttachmentOptions.framebufferTarget;
    target = defaultAttachmentOptions.target;
    format = defaultAttachmentOptions.format;
    internalFormat = defaultAttachmentOptions.internalFormat;
    type = defaultAttachmentOptions.type;
    minFilter = defaultAttachmentOptions.minFilter;
    magFilter = defaultAttachmentOptions.magFilter;
    wrapS = defaultAttachmentOptions.wrapS;
    wrapT = defaultAttachmentOptions.wrapT;
    data: TypedArray | null = null;
    attachment = defaultAttachmentOptions.attachment;
    needRenderbuffer = true;
    texture: FramebufferTexture | null = null;
    renderbuffer: WebGLRenderbuffer | null = null;
    framebuffer: WebGLFramebuffer | null = null;
    colorAttachmentInfos: FramebufferAttachmentInfo[];
    depthStencilAttachmentInfo: FramebufferAttachmentInfo | undefined;

    private _isInit = false;
    private _isDestroyed = false;
    private _preReadFramebuffer: WebGLFramebuffer | null = null;
    private _preDrawFramebuffer: WebGLFramebuffer | null = null;
    private _hasSavedFramebufferBindings = false;
    private registeredContext: GLContext | null = null;

    get gl(): GLContext {
        const gl = this.renderer.gl;
        if (!gl) throw new Error('Framebuffer requires an initialized WebGL renderer');
        return gl;
    }

    get state(): WebGLState {
        const state = this.renderer.state;
        if (!state) throw new Error('Framebuffer requires an initialized WebGL state');
        return state;
    }

    constructor(renderer: FramebufferRenderer, params: FramebufferParameters = {}) {
        this.id = math.generateUUID(this.className);
        this.renderer = renderer;
        this.width = params.width ?? renderer.width;
        this.height = params.height ?? renderer.height;
        this.colorAttachmentInfos = [];
        Object.assign(this, params);

        if (params.colorAttachmentInfos === undefined) {
            this.colorAttachmentInfos = [
                {
                    attachmentType: Framebuffer.ATTACHMENT_TYPE_TEXTURE,
                    framebufferTarget: this.framebufferTarget,
                    target: this.target,
                    format: this.format,
                    internalFormat: this.internalFormat,
                    type: this.type,
                    minFilter: this.minFilter,
                    magFilter: this.magFilter,
                    wrapS: this.wrapS,
                    wrapT: this.wrapT,
                    data: this.data
                }
            ];
        }
        if (params.depthStencilAttachmentInfo !== undefined) {
            this.depthStencilAttachmentInfo = params.depthStencilAttachmentInfo;
        } else if (this.needRenderbuffer) {
            this.depthStencilAttachmentInfo = {
                attachmentType: Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
                framebufferTarget: this.framebufferTarget,
                attachment: DEPTH_STENCIL_ATTACHMENT,
                internalFormat: DEPTH24_STENCIL8
            };
        }
        this.registerContext();
    }

    private registerContext(): void {
        const gl = this.renderer.gl;
        if (!gl || this.registeredContext === gl) return;
        if (this.registeredContext) {
            contextCaches.peek(this.registeredContext)?.removeObject(this);
        }
        contextCaches.get(gl).add(this.id, this);
        this.registeredContext = gl;
    }

    init(): void {
        if (this._isDestroyed) throw new Error('Cannot initialize a destroyed framebuffer');
        this.registerContext();
        if (!this._isInit && this.renderer.isInit) {
            this.reset();
        }
    }

    reset(): void {
        if (!this.renderer.isInit) return;
        this.registerContext();
        const { gl, state } = this;
        const staleFramebuffer = this.framebuffer;
        const previousReadFramebuffer = state.currentReadFramebuffer;
        const previousDrawFramebuffer = state.currentDrawFramebuffer;
        const restoreReadFramebuffer =
            previousReadFramebuffer === staleFramebuffer
                ? state.systemFramebuffer
                : previousReadFramebuffer;
        const restoreDrawFramebuffer =
            previousDrawFramebuffer === staleFramebuffer
                ? state.systemFramebuffer
                : previousDrawFramebuffer;
        this.releaseNativeResources(true);
        try {
            this.framebuffer = requireGLResource(gl.createFramebuffer(), 'a framebuffer');
            state.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
            this.createAttachments();
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error(`Framebuffer is incomplete (status ${String(status)})`);
            }
            this._isInit = true;
        } catch (error) {
            this.releaseNativeResources(true);
            throw error;
        } finally {
            state.bindFramebuffer(gl.READ_FRAMEBUFFER, restoreReadFramebuffer);
            state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, restoreDrawFramebuffer);
        }
    }

    private resolveAttachmentOptions(info: FramebufferAttachmentInfo): ResolvedAttachmentOptions {
        return {
            framebufferTarget: info.framebufferTarget ?? defaultAttachmentOptions.framebufferTarget,
            attachment: info.attachment ?? defaultAttachmentOptions.attachment,
            target: info.target ?? defaultAttachmentOptions.target,
            format: info.format ?? defaultAttachmentOptions.format,
            internalFormat: info.internalFormat ?? defaultAttachmentOptions.internalFormat,
            type: info.type ?? defaultAttachmentOptions.type,
            minFilter: info.minFilter ?? defaultAttachmentOptions.minFilter,
            magFilter: info.magFilter ?? defaultAttachmentOptions.magFilter,
            wrapS: info.wrapS ?? defaultAttachmentOptions.wrapS,
            wrapT: info.wrapT ?? defaultAttachmentOptions.wrapT,
            data: info.data ?? null
        };
    }

    private createAttachments(): void {
        const drawBuffers: GLenum[] = [];
        this.colorAttachmentInfos.forEach((attachmentInfo, index) => {
            const attachment = COLOR_ATTACHMENT0 + index;
            this.createAttachment(attachmentInfo, attachment);
            drawBuffers.push(attachment);
        });

        const depthAttachment = this.depthStencilAttachmentInfo;
        if (depthAttachment) {
            this.createAttachment(
                depthAttachment,
                depthAttachment.attachment ?? DEPTH_STENCIL_ATTACHMENT
            );
        }

        if (drawBuffers.length === 0) {
            this.gl.drawBuffers([this.gl.NONE]);
            this.gl.readBuffer(this.gl.NONE);
        } else if (drawBuffers.length > 1) {
            this.gl.drawBuffers(drawBuffers);
        }
    }

    private createAttachment(info: FramebufferAttachmentInfo, attachment: GLenum): void {
        if (info.attachmentType === Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER) {
            this.createRenderbufferAttachment(info, attachment);
        } else {
            this.createTextureAttachment(info, attachment);
        }
    }

    /** Factory hook used by specialized framebuffer textures such as cube shadow maps. */
    createTexture(
        options: ResolvedAttachmentOptions = this.resolveAttachmentOptions({
            attachmentType: Framebuffer.ATTACHMENT_TYPE_TEXTURE,
            framebufferTarget: this.framebufferTarget,
            attachment: this.attachment,
            target: this.target,
            format: this.format,
            internalFormat: this.internalFormat,
            type: this.type,
            minFilter: this.minFilter,
            magFilter: this.magFilter,
            wrapS: this.wrapS,
            wrapT: this.wrapT,
            data: this.data
        })
    ): FramebufferTexture {
        return new Texture<TypedArray | null>({
            minFilter: options.minFilter,
            magFilter: options.magFilter,
            internalFormat: options.internalFormat,
            format: options.format,
            type: options.type,
            width: this.width,
            height: this.height,
            image: options.data,
            wrapS: options.wrapS,
            wrapT: options.wrapT
        });
    }

    private createTextureAttachment(
        info: FramebufferAttachmentInfo,
        attachment: GLenum
    ): FramebufferTexture {
        const options = this.resolveAttachmentOptions(info);
        const texture = info.texture ?? this.createTexture(options);
        if (texture instanceof Texture) {
            texture.width = this.width;
            texture.height = this.height;
        }
        info.texture = texture;
        if (attachment === COLOR_ATTACHMENT0) this.texture = texture;
        const glTexture = texture.getGLTexture(this.state);
        const textureTarget =
            options.target === this.gl.TEXTURE_CUBE_MAP
                ? this.gl.TEXTURE_CUBE_MAP_POSITIVE_X
                : options.target;
        this.gl.framebufferTexture2D(
            options.framebufferTarget,
            attachment,
            textureTarget,
            glTexture,
            0
        );
        return texture;
    }

    private createRenderbufferAttachment(
        info: FramebufferAttachmentInfo,
        attachment: GLenum
    ): WebGLRenderbuffer {
        const gl = this.gl;
        const renderbuffer = requireGLResource(gl.createRenderbuffer(), 'a renderbuffer');
        info.renderbuffer = renderbuffer;
        if (attachment === COLOR_ATTACHMENT0) this.renderbuffer = renderbuffer;
        gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
        const internalFormat = info.internalFormat ?? this.bufferInternalFormat;
        const samples = info.samples ?? 0;
        if (samples > 0) {
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                samples,
                internalFormat,
                this.width,
                this.height
            );
        } else {
            gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, this.width, this.height);
        }
        gl.framebufferRenderbuffer(
            info.framebufferTarget ?? defaultAttachmentOptions.framebufferTarget,
            attachment,
            gl.RENDERBUFFER,
            renderbuffer
        );
        return renderbuffer;
    }

    isComplete(): boolean {
        if (!this._isInit || !this.framebuffer) return false;
        const { gl, state } = this;
        const previousReadFramebuffer = state.currentReadFramebuffer;
        const previousDrawFramebuffer = state.currentDrawFramebuffer;
        state.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        try {
            return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        } finally {
            state.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
            state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDrawFramebuffer);
        }
    }

    bind(): void {
        this.init();
        if (!this._isInit) return;
        const { gl, state } = this;
        if (
            state.currentReadFramebuffer === this.framebuffer &&
            state.currentDrawFramebuffer === this.framebuffer
        ) {
            return;
        }
        if (!this._hasSavedFramebufferBindings) {
            this._preReadFramebuffer = state.currentReadFramebuffer;
            this._preDrawFramebuffer = state.currentDrawFramebuffer;
            this._hasSavedFramebufferBindings = true;
        }
        state.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    }

    unbind(): void {
        if (!this._hasSavedFramebufferBindings) return;
        this.init();
        if (!this._isInit) return;
        const { gl, state } = this;
        const previousReadFramebuffer = this._preReadFramebuffer;
        const previousDrawFramebuffer = this._preDrawFramebuffer;
        this._hasSavedFramebufferBindings = false;
        this._preReadFramebuffer = null;
        this._preDrawFramebuffer = null;
        state.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
        state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDrawFramebuffer);
    }

    /** Reattach the primary texture; cube-map subclasses use the index to select a face. */
    bindTexture(_index = 0): void {
        this.bind();
        const texture = this.texture;
        if (!texture) throw new Error('Framebuffer has no primary texture attachment');
        const glTexture = texture.getGLTexture(this.state);
        this.gl.framebufferTexture2D(
            this.framebufferTarget,
            this.attachment,
            this.target,
            glTexture,
            0
        );
    }

    clear(clearColor = new Color(0, 0, 0, 0)): void {
        this.init();
        if (!this._isInit) return;
        this.gl.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    }

    resize(width: number, height: number, force = false): void {
        if (!force && this.width === width && this.height === height) return;
        this.width = width;
        this.height = height;
        if (this._isInit || force) this.reset();
    }

    readPixels(x: number, y: number, width = 1, height = 1): TypedArray {
        const TypedArrayClass = getTypedArrayClass(this.type);
        const pixels = new TypedArrayClass(width * height * 4);
        this.init();
        if (!this._isInit) return pixels;
        const webGLY = this.height - y - height;
        this.bind();
        try {
            this.gl.readPixels(x, webGLY, width, height, this.format, this.type, pixels);
        } finally {
            this.unbind();
        }
        return pixels;
    }

    copyFramebuffer(srcFramebuffer: Framebuffer, config: CopyFramebufferOptions = {}): void {
        if (srcFramebuffer.renderer.gl !== this.renderer.gl) {
            throw new TypeError('Cannot copy framebuffers across WebGL2 contexts');
        }
        this.init();
        srcFramebuffer.init();
        if (!this._isInit) return;
        const gl = this.gl;
        const srcSize = config.srcSize ?? [0, 0, srcFramebuffer.width, srcFramebuffer.height];
        const dstSize = config.dstSize ?? [0, 0, this.width, this.height];
        const previousReadFramebuffer = this.state.currentReadFramebuffer;
        const previousDrawFramebuffer = this.state.currentDrawFramebuffer;
        this.state.bindFramebuffer(READ_FRAMEBUFFER, srcFramebuffer.framebuffer);
        this.state.bindFramebuffer(DRAW_FRAMEBUFFER, this.framebuffer);
        try {
            gl.blitFramebuffer(
                srcSize[0],
                srcSize[1],
                srcSize[2],
                srcSize[3],
                dstSize[0],
                dstSize[1],
                dstSize[2],
                dstSize[3],
                config.mask ?? COLOR_BUFFER_BIT,
                config.filter ?? NEAREST
            );
        } finally {
            this.state.bindFramebuffer(READ_FRAMEBUFFER, previousReadFramebuffer);
            this.state.bindFramebuffer(DRAW_FRAMEBUFFER, previousDrawFramebuffer);
        }
    }

    destroy(): this {
        if (this._isDestroyed) return this;
        this.destroyResource();
        if (this.registeredContext) {
            contextCaches.peek(this.registeredContext)?.removeObject(this);
            this.registeredContext = null;
        }
        this._isDestroyed = true;
        return this;
    }

    destroyResource(): this {
        return this.releaseNativeResources(false);
    }

    private releaseNativeResources(preserveTextureAttachments: boolean): this {
        this._isInit = false;
        const gl = this.renderer.gl;
        const state = this.renderer.state;
        const staleFramebuffer = this.framebuffer;
        this._hasSavedFramebufferBindings = false;
        this._preReadFramebuffer = null;
        this._preDrawFramebuffer = null;
        if (gl && state && staleFramebuffer) {
            if (state.currentReadFramebuffer === staleFramebuffer) {
                state.bindFramebuffer(gl.READ_FRAMEBUFFER, state.systemFramebuffer);
            }
            if (state.currentDrawFramebuffer === staleFramebuffer) {
                state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.systemFramebuffer);
            }
        }
        if (this.framebuffer && gl) gl.deleteFramebuffer(this.framebuffer);
        this.framebuffer = null;
        this.releaseAttachmentResources(this.colorAttachmentInfos, gl, preserveTextureAttachments);
        if (this.depthStencilAttachmentInfo) {
            this.releaseAttachmentResources(
                [this.depthStencilAttachmentInfo],
                gl,
                preserveTextureAttachments
            );
        }
        if (!preserveTextureAttachments) this.texture = null;
        this.renderbuffer = null;
        return this;
    }

    private releaseAttachmentResources(
        attachmentInfos: readonly FramebufferAttachmentInfo[],
        gl: GLContext | null,
        preserveTextureAttachments: boolean
    ): void {
        for (const info of attachmentInfos) {
            const texture = info.texture;
            const renderbuffer = info.renderbuffer;
            info.renderbuffer = null;
            if (texture) {
                if (preserveTextureAttachments) {
                    if (gl && texture instanceof Texture) {
                        releaseTextureWebGLAllocation(texture, gl);
                    }
                } else {
                    info.texture = null;
                    texture.destroy();
                }
            } else if (renderbuffer && gl) {
                gl.deleteRenderbuffer(renderbuffer);
            }
        }
    }
}

export default Framebuffer;
