import Shader, { type ShaderPrecisionProvider } from '../shader/Shader';
import screenVert from '../shader/screen.vert';
import screenFrag from '../shader/screen.frag';
import Cache from '../utils/Cache';
import Program from './Program';
import VertexArrayObject from './VertexArrayObject';
import math from '../math/math';
import Color from '../math/Color';
import GeometryData from '../geometry/GeometryData';
import Texture, { type TextureBinding } from '../texture/Texture';
import { getTypedArrayClass } from '../utils/util';
import {
    CLAMP_TO_EDGE,
    COLOR_ATTACHMENT0,
    COLOR_BUFFER_BIT,
    CULL_FACE,
    DEPTH_STENCIL_ATTACHMENT,
    DEPTH_TEST,
    FRAMEBUFFER,
    NEAREST,
    RGBA,
    TEXTURE_2D,
    TRIANGLE_STRIP,
    UNSIGNED_BYTE
} from '../constants/webgl';
import { DEPTH24_STENCIL8, DRAW_FRAMEBUFFER, READ_FRAMEBUFFER, RGBA8 } from '../constants/webgl2';
import requireGLResource from './requireGLResource';
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
export interface FramebufferRenderer extends ShaderPrecisionProvider {
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

const cache = new Cache<Framebuffer>();
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

    static get cache(): Cache<Framebuffer> {
        return cache;
    }

    static reset(_gl?: GLContext): void {
        cache.each(framebuffer => {
            framebuffer.reset();
        });
    }

    static destroy(_gl?: GLContext): void {
        cache.each(framebuffer => {
            framebuffer.destroy();
        });
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
    private _preFramebuffer: WebGLFramebuffer | null = null;

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
        cache.add(this.id, this);
    }

    init(): void {
        if (this._isDestroyed) throw new Error('Cannot initialize a destroyed framebuffer');
        if (!this._isInit && this.renderer.isInit) {
            this._isInit = true;
            this.reset();
        }
    }

    reset(): void {
        if (!this.renderer.isInit) return;
        this._isInit = true;
        this.destroyResource();
        this.framebuffer = requireGLResource(this.gl.createFramebuffer(), 'a framebuffer');
        this.bind();
        this.createAttachments();
        if (!this.isComplete()) {
            const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
            this.unbind();
            this.destroyResource();
            throw new Error(`Framebuffer is incomplete (status ${String(status)})`);
        }
        this.unbind();
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

        if (drawBuffers.length > 1) this.gl.drawBuffers(drawBuffers);
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
        const texture = this.createTexture(options);
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
        info.texture = texture;
        if (attachment === COLOR_ATTACHMENT0) this.texture = texture;
        return texture;
    }

    private createRenderbufferAttachment(
        info: FramebufferAttachmentInfo,
        attachment: GLenum
    ): WebGLRenderbuffer {
        const gl = this.gl;
        const renderbuffer = requireGLResource(gl.createRenderbuffer(), 'a renderbuffer');
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
        info.renderbuffer = renderbuffer;
        if (attachment === COLOR_ATTACHMENT0) this.renderbuffer = renderbuffer;
        return renderbuffer;
    }

    isComplete(): boolean {
        return (
            this._isInit &&
            this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) === this.gl.FRAMEBUFFER_COMPLETE
        );
    }

    bind(): void {
        this.init();
        if (!this._isInit) return;
        this._preFramebuffer = this.state.currentFramebuffer;
        this.state.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    }

    unbind(): void {
        this.init();
        if (this._isInit) this.state.bindFramebuffer(this.gl.FRAMEBUFFER, this._preFramebuffer);
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

    render(
        x = 0,
        y = 0,
        width = 1,
        height = 1,
        clearColor: Color | null = null,
        texture: FramebufferTexture | null = null
    ): void {
        this.init();
        if (!this._isInit) return;
        const renderTexture = texture ?? this.colorAttachmentInfos[0]?.texture;
        if (!renderTexture) return;

        const { gl, state } = this;
        const wasDepthTestEnabled = state.isEnabled(DEPTH_TEST);
        const wasCullFaceEnabled = state.isEnabled(CULL_FACE);
        try {
            state.disable(DEPTH_TEST);
            state.disable(CULL_FACE);
            if (clearColor) this.clear(clearColor);

            const shader = Shader.getCustomShader(
                screenVert,
                screenFrag,
                '',
                'FramebufferTextureShader',
                false,
                this.renderer
            );
            const program = Program.getProgram(shader, state);
            program.useProgram();
            const vaoId = [x, y, width, height, program.id].map(String).join('_');
            const vao = VertexArrayObject.getVao(gl, vaoId, {
                useInstanced: false,
                mode: TRIANGLE_STRIP
            });
            if (vao.isDirty) {
                vao.isDirty = false;
                const left = x * 2 - 1;
                const top = 1 - y * 2;
                const scaledWidth = width * 2;
                const scaledHeight = height * 2;
                const position = program.attributes['a_position'];
                const texcoord = program.attributes['a_texcoord0'];
                if (!position || !texcoord)
                    throw new Error('Framebuffer screen shader is missing required attributes');
                vao.addAttribute(
                    new GeometryData(
                        new Float32Array([
                            left,
                            top,
                            left + scaledWidth,
                            top,
                            left,
                            top - scaledHeight,
                            left + scaledWidth,
                            top - scaledHeight
                        ]),
                        2
                    ),
                    position,
                    gl.STATIC_DRAW
                );
                vao.addAttribute(
                    new GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2),
                    texcoord,
                    gl.STATIC_DRAW
                );
            }
            state.activeTexture(gl.TEXTURE0);
            state.bindTexture(gl.TEXTURE_2D, renderTexture.getGLTexture(state));
            vao.draw();
        } finally {
            if (wasDepthTestEnabled) state.enable(DEPTH_TEST);
            else state.disable(DEPTH_TEST);
            if (wasCullFaceEnabled) state.enable(CULL_FACE);
            else state.disable(CULL_FACE);
        }
    }

    resize(width: number, height: number, force = false): void {
        if (!force && this.width === width && this.height === height) return;
        this.width = width;
        this.height = height;
        if (this._isInit) this.reset();
    }

    readPixels(x: number, y: number, width = 1, height = 1): TypedArray {
        const TypedArrayClass = getTypedArrayClass(this.type);
        const pixels = new TypedArrayClass(width * height * 4);
        this.init();
        if (!this._isInit) return pixels;
        const webGLY = this.height - y - height;
        this.bind();
        this.gl.readPixels(x, webGLY, width, height, this.format, this.type, pixels);
        this.unbind();
        return pixels;
    }

    copyFramebuffer(srcFramebuffer: Framebuffer, config: CopyFramebufferOptions = {}): void {
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
        cache.removeObject(this);
        this._isDestroyed = true;
        return this;
    }

    destroyResource(): this {
        if (!this._isInit || !this.renderer.gl) return this;
        const gl = this.gl;
        if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
        this.framebuffer = null;
        this.destroyAttachmentResources(this.colorAttachmentInfos, gl);
        if (this.depthStencilAttachmentInfo) {
            this.destroyAttachmentResources([this.depthStencilAttachmentInfo], gl);
        }
        this.texture = null;
        this.renderbuffer = null;
        return this;
    }

    private destroyAttachmentResources(
        attachmentInfos: readonly FramebufferAttachmentInfo[],
        gl: GLContext
    ): void {
        for (const info of attachmentInfos) {
            const texture = info.texture;
            const renderbuffer = info.renderbuffer;
            info.texture = null;
            info.renderbuffer = null;
            if (texture) texture.destroy();
            else if (renderbuffer) gl.deleteRenderbuffer(renderbuffer);
        }
    }
}

export default Framebuffer;
