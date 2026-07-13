import type { GLContext } from './types';
import { WebGLCapabilities } from './capabilities';
import { WebGLExtensions } from './extensions';

export type StateValue = number | boolean | WebGLProgram | null;
export type OneParameterMethod =
    'useProgram' | 'depthFunc' | 'depthMask' | 'stencilMask' | 'cullFace' | 'frontFace' | 'enable';
export type TwoParameterMethod = 'depthRange' | 'blendEquationSeparate';
export type ThreeParameterMethod = 'stencilFunc' | 'stencilOp';
export type FourParameterMethod = 'colorMask' | 'blendFuncSeparate' | 'viewport';

function numberValue(value: StateValue, method: string): number {
    if (typeof value !== 'number') throw new TypeError(`${method} requires numeric parameters`);
    return value;
}

function booleanValue(value: StateValue, method: string): boolean {
    if (typeof value !== 'boolean') throw new TypeError(`${method} requires boolean parameters`);
    return value;
}

function sameValues(
    previous: readonly StateValue[] | undefined,
    next: readonly StateValue[]
): boolean {
    return (
        previous?.length === next.length && next.every((value, index) => previous[index] === value)
    );
}

/** WebGL state cache that avoids redundant context calls. */
class WebGLState {
    readonly className = 'WebGLState';
    readonly isWebGLState = true;
    readonly gl: GLContext;
    readonly capabilities: WebGLCapabilities;
    readonly extensions: WebGLExtensions;
    systemFramebuffer: WebGLFramebuffer | null = null;
    currentDrawFramebuffer: WebGLFramebuffer | null = null;
    currentReadFramebuffer: WebGLFramebuffer | null = null;
    preFramebuffer: WebGLFramebuffer | null = null;

    get currentFramebuffer(): WebGLFramebuffer | null {
        return this.currentDrawFramebuffer;
    }

    private readonly state = new Map<string, readonly StateValue[]>();
    private activeTextureIndex: GLenum | null = null;
    private readonly textureUnits = new Map<GLenum, Map<GLenum, WebGLTexture | null>>();
    private readonly pixelStore = new Map<GLenum, number | boolean>();

    constructor(
        gl: GLContext,
        contextCapabilities?: WebGLCapabilities,
        contextExtensions?: WebGLExtensions
    ) {
        this.gl = gl;
        if (contextExtensions) {
            this.extensions = contextExtensions;
        } else {
            this.extensions = new WebGLExtensions();
            this.extensions.init(gl);
        }
        if (contextCapabilities) {
            this.capabilities = contextCapabilities;
        } else {
            this.capabilities = new WebGLCapabilities(this.extensions);
            this.capabilities.init(gl);
        }
        this.reset();
    }

    reset(): void {
        this.state.clear();
        this.activeTextureIndex = null;
        this.textureUnits.clear();
        this.currentDrawFramebuffer = null;
        this.currentReadFramebuffer = null;
        this.preFramebuffer = null;
        this.pixelStore.clear();
    }

    enable(capability: GLenum): void {
        const key = `capability:${String(capability)}`;
        if (this.state.get(key)?.[0] === true) return;
        this.state.set(key, [true]);
        this.gl.enable(capability);
    }

    disable(capability: GLenum): void {
        const key = `capability:${String(capability)}`;
        if (this.state.get(key)?.[0] === false) return;
        this.state.set(key, [false]);
        this.gl.disable(capability);
    }

    /** Returns a capability value while keeping the state cache synchronized with WebGL. */
    isEnabled(capability: GLenum): boolean {
        const key = `capability:${String(capability)}`;
        const cached = this.state.get(key)?.[0];
        if (typeof cached === 'boolean') return cached;
        const enabled = this.gl.isEnabled(capability);
        this.state.set(key, [enabled]);
        return enabled;
    }

    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
        if (target === this.gl.FRAMEBUFFER) {
            if (
                this.currentDrawFramebuffer === framebuffer &&
                this.currentReadFramebuffer === framebuffer
            ) {
                return;
            }
            this.preFramebuffer = this.currentDrawFramebuffer;
            this.currentDrawFramebuffer = framebuffer;
            this.currentReadFramebuffer = framebuffer;
        } else if (target === this.gl.DRAW_FRAMEBUFFER) {
            if (this.currentDrawFramebuffer === framebuffer) return;
            this.preFramebuffer = this.currentDrawFramebuffer;
            this.currentDrawFramebuffer = framebuffer;
        } else if (target === this.gl.READ_FRAMEBUFFER) {
            if (this.currentReadFramebuffer === framebuffer) return;
            this.currentReadFramebuffer = framebuffer;
        } else {
            throw new RangeError(`Unsupported framebuffer target: ${String(target)}`);
        }
        this.gl.bindFramebuffer(target, framebuffer);
    }

    bindSystemFramebuffer(): void {
        this.bindFramebuffer(this.gl.FRAMEBUFFER, this.systemFramebuffer);
    }

    useProgram(program: WebGLProgram | null): void {
        this.set1('useProgram', program);
    }

    depthFunc(func: GLenum): void {
        this.set1('depthFunc', func);
    }

    depthMask(flag: boolean): void {
        this.set1('depthMask', flag);
    }

    clear(mask: GLbitfield): void {
        this.gl.clear(mask);
    }

    depthRange(zNear: number, zFar: number): void {
        this.set2('depthRange', zNear, zFar);
    }

    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void {
        this.set3('stencilFunc', func, ref, mask);
    }

    stencilMask(mask: GLuint): void {
        this.set1('stencilMask', mask);
    }

    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        this.set3('stencilOp', fail, zfail, zpass);
    }

    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void {
        this.set4('colorMask', red, green, blue, alpha);
    }

    cullFace(mode: GLenum): void {
        this.set1('cullFace', mode);
    }

    frontFace(mode: GLenum): void {
        this.set1('frontFace', mode);
    }

    blendFuncSeparate(srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void {
        this.set4('blendFuncSeparate', srcRGB, dstRGB, srcAlpha, dstAlpha);
    }

    blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void {
        this.set2('blendEquationSeparate', modeRGB, modeAlpha);
    }

    pixelStorei(pname: GLenum, param: number | boolean): void {
        if (this.pixelStore.get(pname) === param) return;
        this.pixelStore.set(pname, param);
        this.gl.pixelStorei(pname, param);
    }

    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        this.set4('viewport', x, y, width, height);
    }

    activeTexture(texture: GLenum): void {
        if (this.activeTextureIndex === texture) return;
        this.activeTextureIndex = texture;
        this.gl.activeTexture(texture);
    }

    bindTexture(target: GLenum, texture: WebGLTexture | null): void {
        const textureUnit = this.getActiveTextureUnit();
        if (textureUnit.get(target) === texture) return;
        textureUnit.set(target, texture);
        this.gl.bindTexture(target, texture);
    }

    getActiveTextureUnit(): Map<GLenum, WebGLTexture | null> {
        const activeIndex = this.activeTextureIndex ?? this.gl.TEXTURE0;
        let textureUnit = this.textureUnits.get(activeIndex);
        if (!textureUnit) {
            textureUnit = new Map();
            this.textureUnits.set(activeIndex, textureUnit);
        }
        return textureUnit;
    }

    set1(name: OneParameterMethod, param: StateValue): void {
        const values = [param];
        if (sameValues(this.state.get(name), values)) return;
        this.state.set(name, values);
        switch (name) {
            case 'useProgram':
                if (param !== null && typeof param !== 'object') {
                    throw new TypeError('useProgram requires a WebGLProgram or null');
                }
                this.gl.useProgram(param);
                break;
            case 'depthMask':
                this.gl.depthMask(booleanValue(param, name));
                break;
            case 'depthFunc':
                this.gl.depthFunc(numberValue(param, name));
                break;
            case 'stencilMask':
                this.gl.stencilMask(numberValue(param, name));
                break;
            case 'cullFace':
                this.gl.cullFace(numberValue(param, name));
                break;
            case 'frontFace':
                this.gl.frontFace(numberValue(param, name));
                break;
            case 'enable':
                this.gl.enable(numberValue(param, name));
                break;
        }
    }

    set2(name: TwoParameterMethod, param0: number, param1: number): void {
        const values = [param0, param1];
        if (sameValues(this.state.get(name), values)) return;
        this.state.set(name, values);
        if (name === 'depthRange') this.gl.depthRange(param0, param1);
        else this.gl.blendEquationSeparate(param0, param1);
    }

    set3(name: ThreeParameterMethod, param0: number, param1: number, param2: number): void {
        const values = [param0, param1, param2];
        if (sameValues(this.state.get(name), values)) return;
        this.state.set(name, values);
        if (name === 'stencilFunc') this.gl.stencilFunc(param0, param1, param2);
        else this.gl.stencilOp(param0, param1, param2);
    }

    set4(
        name: FourParameterMethod,
        param0: number | boolean,
        param1: number | boolean,
        param2: number | boolean,
        param3: number | boolean
    ): void {
        const values = [param0, param1, param2, param3];
        if (sameValues(this.state.get(name), values)) return;
        this.state.set(name, values);
        if (name === 'colorMask') {
            this.gl.colorMask(
                booleanValue(param0, name),
                booleanValue(param1, name),
                booleanValue(param2, name),
                booleanValue(param3, name)
            );
        } else if (name === 'blendFuncSeparate') {
            this.gl.blendFuncSeparate(
                numberValue(param0, name),
                numberValue(param1, name),
                numberValue(param2, name),
                numberValue(param3, name)
            );
        } else {
            this.gl.viewport(
                numberValue(param0, name),
                numberValue(param1, name),
                numberValue(param2, name),
                numberValue(param3, name)
            );
        }
    }

    get(name: string): StateValue | readonly StateValue[] | undefined {
        const values = this.state.get(name);
        return values?.length === 1 ? values[0] : values;
    }
}

export default WebGLState;
