import Shader from '../shader/Shader';
import screenVert from '../shader/screen.vert';
import screenFrag from '../shader/screen.frag';
import Cache from '../utils/Cache';
import log from '../utils/log';
import Program from './Program';
import VertexArrayObject from './VertexArrayObject';
import math from '../math/math';
import Color from '../math/Color';
import GeometryData from '../geometry/GeometryData';
import Texture from '../texture/Texture';
import {
    getTypedArrayClass
} from '../utils/util';

import constants from '../constants';
import extensions from './extensions';
import capabilities from './capabilities';
import WebGLState from './WebGLState';

const {
    FRAMEBUFFER,
    TEXTURE_2D,
    RGBA,
    UNSIGNED_BYTE,
    COLOR_ATTACHMENT0,
    DEPTH_STENCIL_ATTACHMENT,
    DEPTH_STENCIL,
    DEPTH_TEST,
    CULL_FACE,
    TRIANGLE_STRIP,
    NEAREST,
    CLAMP_TO_EDGE,
    COLOR_BUFFER_BIT,
    READ_FRAMEBUFFER,
    DRAW_FRAMEBUFFER,
} = constants;

const cache = new Cache<Framebuffer>();

const defaultAttachmentOptions = {
    framebufferTarget: FRAMEBUFFER,
    attachment: COLOR_ATTACHMENT0,
    target: TEXTURE_2D,
    format: RGBA,
    internalFormat: RGBA,
    type: UNSIGNED_BYTE,
    minFilter: NEAREST,
    magFilter: NEAREST,
    wrapS: CLAMP_TO_EDGE,
    wrapT: CLAMP_TO_EDGE,
};

interface FramebufferParams {
    width?: number;
    height?: number;
    framebufferTarget?: number;
    target?: number;
    format?: number;
    internalFormat?: number;
    type?: number;
    minFilter?: number;
    magFilter?: number;
    wrapS?: number;
    wrapT?: number;
    data?: any;
    needRenderbuffer?: boolean;
    useVao?: boolean;
    colorAttachmentInfos?: AttachmentInfo[];
    depthStencilAttachmentInfo?: AttachmentInfo;
}

/**
 * 帧缓冲
 * @class
 */
class Framebuffer {
    static readonly ATTACHMENT_TYPE_TEXTURE = 'TEXTURE';

    static readonly ATTACHMENT_TYPE_RENDERBUFFER = 'RENDERBUFFER';

    /**
     * 缓存
     * @readOnly
     * @type {Cache}
     */
    static get cache(): Cache<Framebuffer> {
        return cache;
    }

    /**
     * 重置所有framebuffer
     * @param  {WebGLRenderingContext} gl
     */
    static reset(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        cache.each((framebuffer) => {
            framebuffer.reset();
        });
    }

    /**
     * 销毁所有 Framebuffer
     * @param  {WebGLRenderingContext} gl
     */
    static destroy(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        cache.each((framebuffer) => {
            framebuffer.destroy();
        });
    }

    /**
     * @default Framebuffer
     * @type {String}
     */
    className: string = 'Framebuffer';

    /**
     * @default true
     * @type {Boolean}
     */
    isFramebuffer: boolean = true;

    /**
     * id
     * @type {string}
     */
    id: string;

    /**
     * bufferInternalFormat
     * @type {GLenum}
     * @default gl.DEPTH_STENCIL
     */
    bufferInternalFormat: number = DEPTH_STENCIL;

    /**
     * framebufferTarget
     * @type {GLenum}
     * @default gl.FRAMEBUFFER
     */
    framebufferTarget: number = defaultAttachmentOptions.framebufferTarget;

    /**
     * texture target
     * @type {GLenum}
     * @default gl.TEXTURE_2D
     */
    target: number = defaultAttachmentOptions.target;

    /**
     * texture format
     * @type {GLenum}
     * @default gl.RGBA
     */
    format: number = defaultAttachmentOptions.format;

    /**
     * texture internalFormat
     * @type {GLenum}
     * @default gl.RGBA
     */
    internalFormat: number = defaultAttachmentOptions.internalFormat;

    /**
     * texture type
     * @type {GLenum}
     * @default gl.UNSIGNED_BYTE
     */
    type: number = defaultAttachmentOptions.type;

    /**
     * texture minFilter
     * @type {GLenum}
     * @default gl.NEAREST
     */
    minFilter: number = defaultAttachmentOptions.minFilter;

    /**
     * texture magFilter
     * @type {GLenum}
     * @default gl.NEAREST
     */
    magFilter: number = defaultAttachmentOptions.magFilter;

    /**
     * texture wrapS
     * @type {GLenum}
     * @default gl.CLAMP_TO_EDGE
     */
    wrapS: number = defaultAttachmentOptions.wrapS;

    /**
     * texture wrapS
     * @type {GLenum}
     * @default gl.CLAMP_TO_EDGE
     */
    wrapT: number = defaultAttachmentOptions.wrapT;

    /**
     * texture data
     * @type {TypedArray}
     * @default null
     */
    data: any = null;

    /**
     * attachment
     * @type {GLenum}
     * @default gl.COLOR_ATTACHMENT0
     */
    attachment: number = defaultAttachmentOptions.attachment;

    /**
     * 是否需要renderbuffer
     * @type {Boolean}
     * @default true
     */
    needRenderbuffer: boolean = true;

    /**
     * 是否使用VAO
     * @type {Boolean}
     * @default true
     */
    useVao: boolean = true;

    /**
     * width
     * @type {number}
     */
    width: number;

    /**
     * height
     * @type {number}
     */
    height: number;

    /**
     * renderer
     * @type {WebGLRenderer}
     * @default null
     */
    renderer: any;

    /**
     * gl
     * @type {WebGLRenderingContext}
     */
    gl: WebGLRenderingContext | WebGL2RenderingContext;

    /**
     * state
     * @type {WebGLState}
     */
    state: WebGLState;

    /**
     * texture
     * @type {Texture}
     */
    texture: Texture | null = null;

    /**
     * renderbuffer
     * @type {WebGLRenderbuffer}
     */
    renderbuffer: WebGLRenderbuffer | null = null;

    /**
     * framebuffer
     * @type {WebGLFramebuffer}
     */
    framebuffer: WebGLFramebuffer | null = null;

    /**
     * colorAttachmentInfos
     * @type {AttachmentInfo[]}
     */
    colorAttachmentInfos: AttachmentInfo[];

    /**
     * depthStencilAttachmentInfo
     * @type {AttachmentInfo}
     */
    depthStencilAttachmentInfo: AttachmentInfo | undefined;

    private _isInit: boolean = false;

    private _isDestroyed: boolean = false;

    private _preFramebuffer: WebGLFramebuffer | null = null;

    /**
     * @constructs
     * @param {WebGLRenderer}  renderer
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(renderer: any, params?: FramebufferParams) {
        this.id = math.generateUUID(this.className);
        this.renderer = renderer;
        Object.assign(this, params);

        if (!this.width) {
            this.width = renderer.width;
        }

        if (!this.height) {
            this.height = renderer.height;
        }

        if (this.colorAttachmentInfos === undefined) {
            this.colorAttachmentInfos = [{
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
                data: this.data,
            }];
        }

        if (this.depthStencilAttachmentInfo === undefined && this.needRenderbuffer) {
            this.depthStencilAttachmentInfo = {
                attachmentType: Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER,
                framebufferTarget: this.framebufferTarget,
                attachment: DEPTH_STENCIL_ATTACHMENT,
                internalFormat: DEPTH_STENCIL,
            };
        }

        cache.add(this.id, this);
    }

    /**
     * init
     */
    init(): void {
        if (!this._isInit && this.renderer.isInit) {
            this._isInit = true;
            const renderer = this.renderer;
            this.gl = renderer.gl;
            this.state = renderer.state;
            this.reset();
        }
    }

    /**
     * reset
     * @private
     */
    reset(): void {
        this.destroyResource();
        const gl = this.gl;
        /**
         * framebuffer
         * @type {WebGLFramebuffer}
         */
        this.framebuffer = gl.createFramebuffer();
        this.bind();

        this._createAttachments();

        if (!this.isComplete()) {
            log.warn('Framebuffer is not complete => ' + gl.checkFramebufferStatus(gl.FRAMEBUFFER));
        }

        this.unbind();
    }

    private _createAttachments(): void {
        const { colorAttachmentInfos, depthStencilAttachmentInfo } = this;
        const drawBuffers: number[] = [];
        if (colorAttachmentInfos) {
            colorAttachmentInfos.forEach((attachmentInfo, index) => {
                const attachment = COLOR_ATTACHMENT0 + index;
                switch (attachmentInfo.attachmentType) {
                    case Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER:
                        this._createRenderbufferAttachment(attachmentInfo, attachment);
                        break;
                    case Framebuffer.ATTACHMENT_TYPE_TEXTURE:
                    default:
                        this._createTextureAttachment(attachmentInfo, attachment);
                        break;
                }

                drawBuffers.push(attachment);
            });
        }

        if (depthStencilAttachmentInfo) {
            const attachment = depthStencilAttachmentInfo.attachment!;
            switch (depthStencilAttachmentInfo.attachmentType) {
                case Framebuffer.ATTACHMENT_TYPE_RENDERBUFFER:
                    this._createRenderbufferAttachment(depthStencilAttachmentInfo, attachment);
                    break;
                case Framebuffer.ATTACHMENT_TYPE_TEXTURE:
                default:
                    this._createTextureAttachment(depthStencilAttachmentInfo, attachment);
                    break;
            }
        }

        if (drawBuffers.length > 1 && capabilities.DRAW_BUFFERS) {
            extensions.drawBuffers.drawBuffers(drawBuffers);
        }
    }

    private _createTextureAttachment(attachmentInfo: AttachmentInfo, attachment: number): Texture {
        const state = this.state;
        const gl = state.gl;

        const textureOptions = Object.assign({}, defaultAttachmentOptions, attachmentInfo);
        const texture = new Texture({
            minFilter: textureOptions.minFilter,
            magFilter: textureOptions.magFilter,
            internalFormat: textureOptions.internalFormat,
            format: textureOptions.format,
            type: textureOptions.type,
            width: this.width,
            height: this.height,
            image: textureOptions.data,
            wrapS: textureOptions.wrapS,
            wrapT: textureOptions.wrapT
        });

        const glTexture = texture.getGLTexture(state);
        gl.framebufferTexture2D(textureOptions.framebufferTarget, attachment, textureOptions.target, glTexture, 0);
        attachmentInfo.texture = texture;

        if (attachment === COLOR_ATTACHMENT0) {
            this.texture = texture;
        }
        return texture;
    }

    private _createRenderbufferAttachment(attachmentInfo: AttachmentInfo, attachment: number): WebGLRenderbuffer {
        const {
            gl,
            width,
            height
        } = this;
        const renderbuffer = gl.createRenderbuffer()!;
        gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
        if (attachmentInfo.samples && attachmentInfo.samples > 0) {
            (gl as WebGL2RenderingContext).renderbufferStorageMultisample(gl.RENDERBUFFER, attachmentInfo.samples, attachmentInfo.internalFormat!, width, height);
        } else {
            gl.renderbufferStorage(gl.RENDERBUFFER, attachmentInfo.internalFormat!, width, height);
        }
        gl.framebufferRenderbuffer(attachmentInfo.framebufferTarget || defaultAttachmentOptions.framebufferTarget, attachment, gl.RENDERBUFFER, renderbuffer);
        attachmentInfo.renderbuffer = renderbuffer;

        return renderbuffer;
    }

    /**
     * framebuffer 是否完成
     * @return {Boolean}
     */
    isComplete(): boolean {
        const gl = this.gl;
        if (gl && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
            return true;
        }
        return false;
    }

    /**
     * 绑定
     */
    bind(): void {
        this.init();
        if (this._isInit) {
            this._preFramebuffer = this.state.currentFramebuffer;
            this.state.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
        }
    }

    /**
     * 解绑
     */
    unbind(): void {
        this.init();
        if (this._isInit) {
            const state = this.state;
            state.bindFramebuffer(this.gl.FRAMEBUFFER, this._preFramebuffer);
        }
    }

    clear(clearColor: Color = new Color(0, 0, 0, 0)): void {
        if (this._isInit) {
            const {
                gl
            } = this;
            gl.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        }
    }

    /**
     * 渲染当前纹理
     * @param  {Number} [x=0]
     * @param  {Number} [y=0]
     * @param  {Number} [width=1]
     * @param  {Number} [height=1]
     * @param  {Color} [clearColor=null]
     */
    render(x: number = 0, y: number = 0, width: number = 1, height: number = 1, clearColor: Color | null = null, texture: Texture | null = null): void {
        if (this._isInit) {
            const {
                gl,
                state,
                colorAttachmentInfos,
            } = this;

            if (!texture) {
                if (colorAttachmentInfos[0]) {
                    texture = colorAttachmentInfos[0].texture!;
                } else {
                    return;
                }
            }

            state.disable(DEPTH_TEST);
            state.disable(CULL_FACE);

            if (clearColor) {
                this.clear(clearColor);
            }

            const shader = Shader.getCustomShader(screenVert, screenFrag, '', 'FramebufferTextureShader');
            const program = Program.getProgram(shader, state);
            program.useProgram();

            const vaoId = `${x}_${y}_${width}_${height}_${program.id}`;
            const vao = VertexArrayObject.getVao(gl, vaoId, {
                useVao: this.useVao,
                useInstanced: false,
                mode: TRIANGLE_STRIP
            });

            if (vao.isDirty) {
                vao.isDirty = false;
                x = x * 2 - 1;
                y = 1 - y * 2;
                width *= 2;
                height *= 2;
                const vertices = [x, y, x + width, y, x, y - height, x + width, y - height];
                vao.addAttribute(new GeometryData(new Float32Array(vertices), 2), program.attributes.a_position);
                vao.addAttribute(new GeometryData(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2), program.attributes.a_texcoord0);
            }

            state.activeTexture(gl.TEXTURE0);
            state.bindTexture(gl.TEXTURE_2D, texture.getGLTexture(state));
            vao.draw();
        }
    }

    /**
     * resize
     * @param  {Number} width
     * @param  {Number} height
     * @param  {Boolean} [force=true]
     */
    resize(width: number, height: number, force?: boolean): void {
        if (force || this.width !== width || this.height !== height) {
            this.width = width;
            this.height = height;

            if (this._isInit) {
                this.reset();
            }
        }
    }

    /**
     * 读取区域像素
     * @param  {Number} x
     * @param  {Number} y
     * @param  {Number} [width=1]
     * @param  {Number} [height=1]
     * @return {TypedArray}
     */
    readPixels(x: number, y: number, width: number = 1, height: number = 1): ArrayBufferView {
        const TypedArray = getTypedArrayClass(this.type);
        const pixels = new TypedArray(width * height * 4);

        if (this._isInit) {
            const gl = this.gl;
            // convert to webgl coordinate system
            y = this.height - y - height;

            this.bind();
            gl.readPixels(x, y, width, height, this.format, this.type, pixels);
            this.unbind();
        }

        return pixels;
    }

    /**
     * copy framebuffer
     */
    copyFramebuffer(srcFramebuffer: Framebuffer, config: CopyFramebufferConfig = {}): void {
        this.init();
        if (this._isInit) {
            const gl = this.gl as WebGL2RenderingContext;
            let {
                mask,
                filter,
                srcSize,
                dstSize
            } = config;

            if (!mask) {
                mask = COLOR_BUFFER_BIT;
            }

            if (!filter) {
                filter = NEAREST;
            }

            if (!srcSize) {
                srcSize = [0, 0, srcFramebuffer.width, srcFramebuffer.height];
            }

            if (!dstSize) {
                dstSize = [0, 0, this.width, this.height];
            }

            gl.bindFramebuffer(READ_FRAMEBUFFER, srcFramebuffer.framebuffer);
            gl.bindFramebuffer(DRAW_FRAMEBUFFER, this.framebuffer);
            gl.blitFramebuffer(
                srcSize[0], srcSize[1], srcSize[2], srcSize[3],
                dstSize[0], dstSize[1], dstSize[2], dstSize[3],
                mask, filter,
            );
            gl.bindFramebuffer(READ_FRAMEBUFFER, null);
            gl.bindFramebuffer(DRAW_FRAMEBUFFER, null);
        }
    }

    /**
     * 销毁资源
     * @return {Framebuffer} this
     */
    destroy(): this {
        if (this._isDestroyed) {
            return this;
        }
        this.destroyResource();
        this.gl = null!;
        cache.removeObject(this);

        this._isDestroyed = true;
        return this;
    }

    /**
     * 只销毁 gl 资源
     * @return {Framebuffer} this
     */
    destroyResource(): this {
        const gl = this.gl;
        if (gl) {
            if (this.framebuffer) {
                gl.deleteFramebuffer(this.framebuffer);
                this.framebuffer = null;
            }

            if (this.colorAttachmentInfos) {
                this.colorAttachmentInfos.forEach((attachmentInfo) => {
                    const { texture, renderbuffer } = attachmentInfo;
                    attachmentInfo.texture = undefined;
                    attachmentInfo.renderbuffer = undefined;
                    if (texture) {
                        texture.destroy();
                    } else if (renderbuffer) {
                        gl.deleteRenderbuffer(renderbuffer);
                    }
                });
            }

            if (this.depthStencilAttachmentInfo) {
                const { texture, renderbuffer } = this.depthStencilAttachmentInfo;
                this.depthStencilAttachmentInfo.texture = undefined;
                this.depthStencilAttachmentInfo.renderbuffer = undefined;
                if (texture) {
                    texture.destroy();
                } else if (renderbuffer) {
                    gl.deleteRenderbuffer(renderbuffer);
                }
            }
        }
        return this;
    }
}

export default Framebuffer;

interface CopyFramebufferConfig {
    mask?: number;
    filter?: number;
    srcSize?: number[];
    dstSize?: number[];
}

/**
 * @typedef {object} AttachmentInfo
 * @property {'TEXTURE'|'RENDERBUFFER'} attachmentType
 * @property {GLenum} framebufferTarget
 * @property {GLenum} attachment
 * @property {number} samples
 * @property {GLenum} target
 * @property {GLenum} internalFormat
 * @property {GLenum} format
 * @property {GLenum} type
 * @property {GLenum} minFilter
 * @property {GLenum} magFilter
 * @property {GLenum} wrapS
 * @property {GLenum} wrapT
 * @property {TypedArray} data
 * @property {Texture} texture
 * @property {WebGLRenderbuffer} renderbuffer
 */
interface AttachmentInfo {
    attachmentType?: string;
    framebufferTarget?: number;
    attachment?: number;
    samples?: number;
    target?: number;
    internalFormat?: number;
    format?: number;
    type?: number;
    minFilter?: number;
    magFilter?: number;
    wrapS?: number;
    wrapT?: number;
    data?: any;
    texture?: Texture;
    renderbuffer?: WebGLRenderbuffer;
}
