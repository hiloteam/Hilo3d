import { isWebGL2 } from '../utils/util';

/**
 * WebGL 状态管理，减少 api 调用
 * @class
 */
class WebGLState {
    /**
     * @default WebGLState
     * @type {String}
     */
    className: string = 'WebGLState';

    /**
     * @default true
     * @type {Boolean}
     */
    isWebGLState: boolean = true;

    /**
     * 系统framebuffer
     * @default true
     * @type {null}
     */
    systemFramebuffer: WebGLFramebuffer | null = null;

    /**
    * 是否是 WebGL2
    * @default false
    * @type {Boolean}
    */
    isWebGL2: boolean = false;

    /**
     * gl
     * @type {WebGLRenderingContext}
     */
    gl: WebGLRenderingContext | WebGL2RenderingContext;

    activeTextureIndex: number | null = null;
    textureUnitDict: Record<number, Record<number, WebGLTexture | null>> = {};
    currentFramebuffer: WebGLFramebuffer | null = null;
    preFramebuffer: WebGLFramebuffer | null = null;

    private _dict: Record<string | number, any> = {};
    private _pixelStorei: Record<number, number> = {};

    /**
     * @constructs
     * @param  {WebGLRenderingContext} gl
     */
    constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
        this.gl = gl;
        this.isWebGL2 = isWebGL2(gl);
        this.reset();
    }

    /**
     * 重置状态
     */
    reset(): void {
        this._dict = {};
        this.activeTextureIndex = null;
        this.textureUnitDict = {};
        this.currentFramebuffer = null;
        this.preFramebuffer = null;
        this._pixelStorei = {};
    }

    /**
     * enable
     * @param  {GLenum} capability
     */
    enable(capability: number): void {
        const value = this._dict[capability];
        if (value !== true) {
            this._dict[capability] = true;
            this.gl.enable(capability);
        }
    }

    /**
     * disable
     * @param  {GLenum} capability
     */
    disable(capability: number): void {
        const value = this._dict[capability];
        if (value !== false) {
            this._dict[capability] = false;
            this.gl.disable(capability);
        }
    }

    /**
     * bindFramebuffer
     * @param  {GLenum} target
     * @param  {WebGLFramebuffer} framebuffer
     */
    bindFramebuffer(target: number, framebuffer: WebGLFramebuffer | null): void {
        if (this.currentFramebuffer !== framebuffer) {
            this.preFramebuffer = this.currentFramebuffer;
            this.currentFramebuffer = framebuffer;
            this.gl.bindFramebuffer(target, framebuffer);
        }
    }

    /**
     * 绑定系统framebuffer
     */
    bindSystemFramebuffer(): void {
        this.bindFramebuffer(this.gl.FRAMEBUFFER, this.systemFramebuffer);
    }

    /**
     * useProgram
     * @param  { WebGLProgram} program
     */
    useProgram(program: WebGLProgram | null): void {
        this.set1('useProgram', program);
    }

    /**
     * depthFunc
     * @param  {GLenum } func
     */
    depthFunc(func: number): void {
        this.set1('depthFunc', func);
    }

    /**
     * depthMask
     * @param  {GLenum } flag
     */
    depthMask(flag: boolean): void {
        this.set1('depthMask', flag);
    }

    /**
     * clear
     * @param  {Number} mask
     */
    clear(mask: number): void {
        this.gl.clear(mask);
    }

    /**
     * depthRange
     * @param  {Number} zNear
     * @param  {Number} zFar
     */
    depthRange(zNear: number, zFar: number): void {
        this.set2('depthRange', zNear, zFar);
    }

    /**
     * stencilFunc
     * @param  {GLenum} func
     * @param  {Number} ref
     * @param  {Number} mask
     */
    stencilFunc(func: number, ref: number, mask: number): void {
        this.set3('stencilFunc', func, ref, mask);
    }

    /**
     * stencilMask
     * @param  {Number} mask
     */
    stencilMask(mask: number): void {
        this.set1('stencilMask', mask);
    }

    /**
     * stencilOp
     * @param  {GLenum} fail
     * @param  {GLenum} zfail
     * @param  {GLenum} zpass
     */
    stencilOp(fail: number, zfail: number, zpass: number): void {
        this.set3('stencilOp', fail, zfail, zpass);
    }

    /**
     * colorMask
     * @param  {Boolean} red
     * @param  {Boolean} green
     * @param  {Boolean} blue
     * @param  {Boolean} alpha
     */
    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void {
        this.set4('colorMask', red, green, blue, alpha);
    }

    /**
     * cullFace
     * @param  {GLenum} mode
     */
    cullFace(mode: number): void {
        this.set1('cullFace', mode);
    }

    /**
     * frontFace
     * @param  {GLenum} mode
     */
    frontFace(mode: number): void {
        this.set1('frontFace', mode);
    }

    /**
     * blendFuncSeparate
     * @param  {GLenum} srcRGB
     * @param  {GLenum} dstRGB
     * @param  {GLenum} srcAlpha
     * @param  {GLenum} dstAlpha
     */
    blendFuncSeparate(srcRGB: number, dstRGB: number, srcAlpha: number, dstAlpha: number): void {
        this.set4('blendFuncSeparate', srcRGB, dstRGB, srcAlpha, dstAlpha);
    }

    /**
     * blendEquationSeparate
     * @param  {GLenum} modeRGB
     * @param  {GLenum} modeAlpha
     */
    blendEquationSeparate(modeRGB: number, modeAlpha: number): void {
        this.set2('blendEquationSeparate', modeRGB, modeAlpha);
    }

    /**
     * pixelStorei
     * @param  {GLenum} pname
     * @param  {GLenum} param
     */
    pixelStorei(pname: number, param: number): void {
        const currentParam = this._pixelStorei[pname];
        if (currentParam !== param) {
            this._pixelStorei[pname] = param;
            this.gl.pixelStorei(pname, param);
        }
    }

    /**
     * viewport
     * @param  {Number} x
     * @param  {Number} y
     * @param  {Number} width
     * @param  {Number} height
     */
    viewport(x: number, y: number, width: number, height: number): void {
        this.set4('viewport', x, y, width, height);
    }

    /**
     * activeTexture
     * @param  {GLenum} texture
     */
    activeTexture(texture: number): void {
        if (this.activeTextureIndex !== texture) {
            this.activeTextureIndex = texture;
            this.gl.activeTexture(texture);
        }
    }

    /**
     * bindTexture
     * @param  {GLenum} target
     * @param  {WebGLTexture } texture
     */
    bindTexture(target: number, texture: WebGLTexture | null): void {
        let textureUnit = this.getActiveTextureUnit();
        if (textureUnit[target] !== texture) {
            textureUnit[target] = texture;
            this.gl.bindTexture(target, texture);
        }
    }

    /**
     * 获取当前激活的纹理对象
     * @return {GLenum}
     */
    getActiveTextureUnit(): Record<number, WebGLTexture | null> {
        let textureUnit = this.textureUnitDict[this.activeTextureIndex!];
        if (!textureUnit) {
            textureUnit = this.textureUnitDict[this.activeTextureIndex!] = {};
        }
        return textureUnit;
    }

    /**
     * 调 gl 1参数方法
     * @private
     * @param  {String} name  方法名
     * @param  {Number|Object} param 方法参数
     */
    private set1(name: string, param: any): void {
        const value = this._dict[name];
        if (value !== param) {
            this._dict[name] = param;
            (this.gl as any)[name](param);
        }
    }

    /**
     * 调 gl 2参数方法
     * @private
     * @param  {String} name  方法名
     * @param  {Number|Object} param0 方法参数
     * @param  {Number|Object} param1 方法参数
     */
    private set2(name: string, param0: any, param1: any): void {
        let value = this._dict[name] as any[];
        if (!value) {
            value = this._dict[name] = [];
        }

        if (value[0] !== param0 || value[1] !== param1) {
            value[0] = param0;
            value[1] = param1;
            (this.gl as any)[name](param0, param1);
        }
    }

    /**
     * 调 gl 3参数方法
     * @private
     * @param  {String} name  方法名
     * @param  {Number|Object} param0 方法参数
     * @param  {Number|Object} param1 方法参数
     * @param  {Number|Object} param2 方法参数
     */
    private set3(name: string, param0: any, param1: any, param2: any): void {
        let value = this._dict[name] as any[];
        if (!value) {
            value = this._dict[name] = [];
        }

        if (value[0] !== param0 || value[1] !== param1 || value[2] !== param2) {
            value[0] = param0;
            value[1] = param1;
            value[2] = param2;
            (this.gl as any)[name](param0, param1, param2);
        }
    }

    /**
     * 调 gl 4参数方法
     * @private
     * @param  {String} name  方法名
     * @param  {Number|Object} param0 方法参数
     * @param  {Number|Object} param1 方法参数
     * @param  {Number|Object} param2 方法参数
     * @param  {Number|Object} param3 方法参数
     */
    private set4(name: string, param0: any, param1: any, param2: any, param3: any): void {
        let value = this._dict[name] as any[];
        if (!value) {
            value = this._dict[name] = [];
        }

        if (value[0] !== param0 || value[1] !== param1 || value[2] !== param2 || value[3] !== param3) {
            value[0] = param0;
            value[1] = param1;
            value[2] = param2;
            value[3] = param3;
            (this.gl as any)[name](param0, param1, param2, param3);
        }
    }

    get(name: string): any {
        return this._dict[name];
    }
}

export default WebGLState;
