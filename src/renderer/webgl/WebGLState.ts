import type { GLContext } from './WebGLTypes';
import { WebGLCapabilities } from './capabilities';
import { WebGLExtensions } from './extensions';
import { WebGLUniformBufferManager } from './WebGLUniformBufferManager';
import { WebGLTextureManager } from './WebGLTextureManager';
import { WebGLSamplerManager } from './WebGLSamplerManager';
import type Buffer from './Buffer';
import type Texture from '../../texture/Texture';
import type Cache from '../../utils/Cache';
import type UniformBuffer from '../common/UniformBuffer';
import type { UniformBufferRange } from '../common/UniformBuffer';
import type { WebGLRHIState } from '../../rhi/webgl/WebGLInternal';
import type { WebGLRHIDevice } from '../../rhi/webgl/WebGLDevice';

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

const uniformBufferManagers = new WeakMap<WebGLState, WebGLUniformBufferManager>();
const textureManagers = new WeakMap<WebGLState, WebGLTextureManager>();
const samplerManagers = new WeakMap<WebGLState, WebGLSamplerManager>();

let attachRHIAdapter: (
    adapter: WebGLState,
    rhiState: WebGLRHIState,
    rhiDevice: WebGLRHIDevice
) => void = () => {
    throw new Error('WebGLState RHI attachment is unavailable before class initialization');
};
let adapterUsesRHI: (
    adapter: WebGLState,
    rhiState: WebGLRHIState,
    rhiDevice: WebGLRHIDevice
) => boolean = () => false;

/** Attach the renderer migration adapter to its concrete RHI owner. @internal */
export function attachWebGLStateRHI(
    adapter: WebGLState,
    rhiState: WebGLRHIState,
    rhiDevice: WebGLRHIDevice
): void {
    attachRHIAdapter(adapter, rhiState, rhiDevice);
}

/** Test the module-private RHI attachment without exposing it on the public adapter. @internal */
export function webGLStateUsesRHI(
    adapter: WebGLState,
    rhiState: WebGLRHIState,
    rhiDevice: WebGLRHIDevice
): boolean {
    return adapterUsesRHI(adapter, rhiState, rhiDevice);
}

function uniformBufferManagerFor(state: WebGLState): WebGLUniformBufferManager {
    const manager = uniformBufferManagers.get(state);
    if (!manager) throw new Error('WebGL uniform-buffer state is unavailable');
    return manager;
}

/** @internal */
export function getWebGLUniformBuffer(state: WebGLState, buffer: UniformBuffer): Buffer {
    return uniformBufferManagerFor(state).getBuffer(buffer);
}

/** @internal */
export function bindWebGLUniformBuffer(
    state: WebGLState,
    buffer: UniformBuffer,
    bindingPoint: number,
    range?: UniformBufferRange
): void {
    uniformBufferManagerFor(state).bind(buffer, bindingPoint, range);
}

/** @internal */
export function releaseWebGLUniformBuffer(state: WebGLState, buffer: UniformBuffer): void {
    uniformBufferManagerFor(state).release(buffer);
}

/** @internal */
export function destroyWebGLUniformBuffers(state: WebGLState): void {
    uniformBufferManagerFor(state).destroy();
}

function textureManagerFor(state: WebGLState): WebGLTextureManager {
    const manager = textureManagers.get(state);
    if (!manager) throw new Error('WebGL texture state is unavailable');
    return manager;
}

/** @internal */
export function getWebGLTexture(state: WebGLState, texture: Texture<unknown>): WebGLTexture {
    return textureManagerFor(state).get(texture);
}

/** @internal */
export function releaseWebGLTexture(state: WebGLState, texture: Texture<unknown>): boolean {
    return textureManagerFor(state).release(texture);
}

/** @internal */
export function destroyWebGLTextures(state: WebGLState): void {
    textureManagerFor(state).destroy();
}

/** @internal */
export function getWebGLTextureCache(state: WebGLState): Cache<WebGLTexture> {
    return textureManagerFor(state).cache;
}

function samplerManagerFor(state: WebGLState): WebGLSamplerManager {
    const manager = samplerManagers.get(state);
    if (!manager) throw new Error('WebGL sampler state is unavailable');
    return manager;
}

/** Bind one immutable context-local sampler variant. @internal */
export function bindWebGLSampler(
    state: WebGLState,
    texture: Texture<unknown>,
    textureUnit: number,
    comparison: boolean,
    compareFunction?: GLenum
): WebGLSampler {
    return samplerManagerFor(state).bind(texture, textureUnit, comparison, compareFunction);
}

/** Release every context-local sampler variant. @internal */
export function destroyWebGLSamplers(state: WebGLState): void {
    samplerManagerFor(state).destroy();
}

/** WebGL state cache that avoids redundant context calls. */
class WebGLState {
    readonly className = 'WebGLState';
    readonly isWebGLState = true;
    readonly gl: GLContext;
    readonly capabilities: WebGLCapabilities;
    readonly extensions: WebGLExtensions;
    #rhiState: WebGLRHIState | null = null;
    #rhiDevice: WebGLRHIDevice | null = null;
    systemFramebuffer: WebGLFramebuffer | null = null;
    private currentDrawFramebufferValue: WebGLFramebuffer | null = null;
    private currentReadFramebufferValue: WebGLFramebuffer | null = null;
    private preFramebufferValue: WebGLFramebuffer | null = null;

    get currentDrawFramebuffer(): WebGLFramebuffer | null {
        return this.#rhiState?.currentDrawFramebuffer ?? this.currentDrawFramebufferValue;
    }

    get currentReadFramebuffer(): WebGLFramebuffer | null {
        return this.#rhiState?.currentReadFramebuffer ?? this.currentReadFramebufferValue;
    }

    get preFramebuffer(): WebGLFramebuffer | null {
        return this.#rhiState?.preFramebuffer ?? this.preFramebufferValue;
    }

    get currentFramebuffer(): WebGLFramebuffer | null {
        return this.currentDrawFramebuffer;
    }

    private readonly state = new Map<string, readonly StateValue[]>();
    private activeTextureIndex: GLenum | null = null;
    private readonly textureUnits = new Map<GLenum, Map<GLenum, WebGLTexture | null>>();
    private readonly delegatedTextureUnitView = new Map<GLenum, WebGLTexture | null>();
    private readonly pixelStore = new Map<GLenum, number | boolean>();

    static {
        attachRHIAdapter = (adapter, rhiState, rhiDevice) => {
            if (rhiState.gl !== adapter.gl) {
                throw new TypeError('WebGLState and WebGLRHIState must belong to the same context');
            }
            if (rhiDevice.gl !== adapter.gl || rhiDevice.state !== rhiState) {
                throw new TypeError('WebGLState must use one matching WebGL RHI device and state');
            }
            adapter.#rhiState = rhiState;
            adapter.#rhiDevice = rhiDevice;
            samplerManagerFor(adapter).attachRHI(rhiState, rhiDevice);
            adapter.reset();
        };
        adapterUsesRHI = (adapter, rhiState, rhiDevice) =>
            adapter.#rhiState === rhiState && adapter.#rhiDevice === rhiDevice;
    }

    constructor(
        gl: GLContext,
        contextCapabilities?: WebGLCapabilities,
        contextExtensions?: WebGLExtensions
    ) {
        this.gl = gl;
        uniformBufferManagers.set(this, new WebGLUniformBufferManager(gl));
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
        textureManagers.set(this, new WebGLTextureManager(this));
        samplerManagers.set(this, new WebGLSamplerManager(this));
        this.reset();
    }

    reset(): void {
        this.#rhiState?.invalidate();
        this.state.clear();
        this.activeTextureIndex = null;
        this.textureUnits.clear();
        this.delegatedTextureUnitView.clear();
        this.currentDrawFramebufferValue = null;
        this.currentReadFramebufferValue = null;
        this.preFramebufferValue = null;
        this.pixelStore.clear();
        samplerManagerFor(this).resetBindings();
    }

    enable(capability: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.enable(capability, true);
            return;
        }
        const key = `capability:${String(capability)}`;
        if (this.state.get(key)?.[0] === true) return;
        this.state.set(key, [true]);
        this.gl.enable(capability);
    }

    disable(capability: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.enable(capability, false);
            return;
        }
        const key = `capability:${String(capability)}`;
        if (this.state.get(key)?.[0] === false) return;
        this.state.set(key, [false]);
        this.gl.disable(capability);
    }

    /** Returns a capability value while keeping the state cache synchronized with WebGL. */
    isEnabled(capability: GLenum): boolean {
        if (this.#rhiState) return this.#rhiState.isEnabled(capability);
        const key = `capability:${String(capability)}`;
        const cached = this.state.get(key)?.[0];
        if (typeof cached === 'boolean') return cached;
        const enabled = this.gl.isEnabled(capability);
        this.state.set(key, [enabled]);
        return enabled;
    }

    bindFramebuffer(target: GLenum, framebuffer: WebGLFramebuffer | null): void {
        if (this.#rhiState) {
            this.#rhiState.bindFramebuffer(target, framebuffer);
            return;
        }
        if (target === this.gl.FRAMEBUFFER) {
            if (
                this.currentDrawFramebufferValue === framebuffer &&
                this.currentReadFramebufferValue === framebuffer
            ) {
                return;
            }
            this.preFramebufferValue = this.currentDrawFramebufferValue;
            this.currentDrawFramebufferValue = framebuffer;
            this.currentReadFramebufferValue = framebuffer;
        } else if (target === this.gl.DRAW_FRAMEBUFFER) {
            if (this.currentDrawFramebufferValue === framebuffer) return;
            this.preFramebufferValue = this.currentDrawFramebufferValue;
            this.currentDrawFramebufferValue = framebuffer;
        } else if (target === this.gl.READ_FRAMEBUFFER) {
            if (this.currentReadFramebufferValue === framebuffer) return;
            this.currentReadFramebufferValue = framebuffer;
        } else {
            throw new RangeError(`Unsupported framebuffer target: ${String(target)}`);
        }
        this.gl.bindFramebuffer(target, framebuffer);
    }

    bindSystemFramebuffer(): void {
        this.bindFramebuffer(this.gl.FRAMEBUFFER, this.systemFramebuffer);
    }

    useProgram(program: WebGLProgram | null): void {
        if (this.#rhiState) {
            this.#rhiState.useProgram(program);
            return;
        }
        this.set1('useProgram', program);
    }

    depthFunc(func: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.depthFunc(func);
            return;
        }
        this.set1('depthFunc', func);
    }

    depthMask(flag: boolean): void {
        if (this.#rhiState) {
            this.#rhiState.depthMask(flag);
            return;
        }
        this.set1('depthMask', flag);
    }

    clear(mask: GLbitfield): void {
        this.gl.clear(mask);
    }

    depthRange(zNear: number, zFar: number): void {
        if (this.#rhiState) {
            this.#rhiState.depthRange(zNear, zFar);
            return;
        }
        this.set2('depthRange', zNear, zFar);
    }

    stencilFunc(func: GLenum, ref: GLint, mask: GLuint): void {
        if (this.#rhiState) {
            this.#rhiState.stencilFunc(func, ref, mask);
            return;
        }
        this.set3('stencilFunc', func, ref, mask);
    }

    stencilMask(mask: GLuint): void {
        if (this.#rhiState) {
            this.#rhiState.stencilMask(mask);
            return;
        }
        this.set1('stencilMask', mask);
    }

    stencilOp(fail: GLenum, zfail: GLenum, zpass: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.stencilOp(fail, zfail, zpass);
            return;
        }
        this.set3('stencilOp', fail, zfail, zpass);
    }

    colorMask(red: boolean, green: boolean, blue: boolean, alpha: boolean): void {
        if (this.#rhiState) {
            this.#rhiState.colorMask(red, green, blue, alpha);
            return;
        }
        this.set4('colorMask', red, green, blue, alpha);
    }

    cullFace(mode: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.cullFace(mode);
            return;
        }
        this.set1('cullFace', mode);
    }

    frontFace(mode: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.frontFace(mode);
            return;
        }
        this.set1('frontFace', mode);
    }

    blendFuncSeparate(srcRGB: GLenum, dstRGB: GLenum, srcAlpha: GLenum, dstAlpha: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha);
            return;
        }
        this.set4('blendFuncSeparate', srcRGB, dstRGB, srcAlpha, dstAlpha);
    }

    blendEquationSeparate(modeRGB: GLenum, modeAlpha: GLenum): void {
        if (this.#rhiState) {
            this.#rhiState.blendEquationSeparate(modeRGB, modeAlpha);
            return;
        }
        this.set2('blendEquationSeparate', modeRGB, modeAlpha);
    }

    pixelStorei(pname: GLenum, param: number | boolean): void {
        if (this.#rhiState) {
            this.#rhiState.pixelStorei(pname, param);
            return;
        }
        if (this.pixelStore.get(pname) === param) return;
        this.pixelStore.set(pname, param);
        this.gl.pixelStorei(pname, param);
    }

    viewport(x: GLint, y: GLint, width: GLsizei, height: GLsizei): void {
        if (this.#rhiState) {
            this.#rhiState.viewport(x, y, width, height);
            return;
        }
        this.set4('viewport', x, y, width, height);
    }

    activeTexture(texture: GLenum): void {
        if (this.#rhiState) {
            const unit = texture - this.gl.TEXTURE0;
            if (!Number.isInteger(unit) || unit < 0) {
                throw new RangeError(`Invalid WebGL texture unit: ${String(texture)}`);
            }
            this.#rhiState.activeTexture(unit);
            return;
        }
        if (this.activeTextureIndex === texture) return;
        this.activeTextureIndex = texture;
        this.gl.activeTexture(texture);
    }

    bindTexture(target: GLenum, texture: WebGLTexture | null): void {
        if (this.#rhiState) {
            this.#rhiState.bindTexture(this.#rhiState.currentTextureUnit, target, texture);
            return;
        }
        const textureUnit = this.getActiveTextureUnit();
        if (textureUnit.get(target) === texture) return;
        textureUnit.set(target, texture);
        this.gl.bindTexture(target, texture);
    }

    getActiveTextureUnit(): Map<GLenum, WebGLTexture | null> {
        if (this.#rhiState) {
            const unit = this.#rhiState.currentTextureUnit;
            this.delegatedTextureUnitView.clear();
            this.addDelegatedTextureBinding(unit, this.gl.TEXTURE_2D);
            this.addDelegatedTextureBinding(unit, this.gl.TEXTURE_CUBE_MAP);
            this.addDelegatedTextureBinding(unit, this.gl.TEXTURE_3D);
            this.addDelegatedTextureBinding(unit, this.gl.TEXTURE_2D_ARRAY);
            return this.delegatedTextureUnitView;
        }
        const activeIndex = this.activeTextureIndex ?? this.gl.TEXTURE0;
        let textureUnit = this.textureUnits.get(activeIndex);
        if (!textureUnit) {
            textureUnit = new Map();
            this.textureUnits.set(activeIndex, textureUnit);
        }
        return textureUnit;
    }

    private addDelegatedTextureBinding(unit: number, target: GLenum): void {
        const texture = this.#rhiState?.getBoundTexture(unit, target);
        if (texture !== undefined) this.delegatedTextureUnitView.set(target, texture);
    }

    set1(name: OneParameterMethod, param: StateValue): void {
        if (this.#rhiState) {
            switch (name) {
                case 'useProgram':
                    if (param !== null && typeof param !== 'object') {
                        throw new TypeError('useProgram requires a WebGLProgram or null');
                    }
                    this.#rhiState.useProgram(param);
                    return;
                case 'depthMask':
                    this.#rhiState.depthMask(booleanValue(param, name));
                    return;
                case 'depthFunc':
                    this.#rhiState.depthFunc(numberValue(param, name));
                    return;
                case 'stencilMask':
                    this.#rhiState.stencilMask(numberValue(param, name));
                    return;
                case 'cullFace':
                    this.#rhiState.cullFace(numberValue(param, name));
                    return;
                case 'frontFace':
                    this.#rhiState.frontFace(numberValue(param, name));
                    return;
                case 'enable':
                    this.#rhiState.enable(numberValue(param, name), true);
                    return;
            }
        }
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
        if (this.#rhiState) {
            if (name === 'depthRange') this.#rhiState.depthRange(param0, param1);
            else this.#rhiState.blendEquationSeparate(param0, param1);
            return;
        }
        const values = [param0, param1];
        if (sameValues(this.state.get(name), values)) return;
        this.state.set(name, values);
        if (name === 'depthRange') this.gl.depthRange(param0, param1);
        else this.gl.blendEquationSeparate(param0, param1);
    }

    set3(name: ThreeParameterMethod, param0: number, param1: number, param2: number): void {
        if (this.#rhiState) {
            if (name === 'stencilFunc') this.#rhiState.stencilFunc(param0, param1, param2);
            else this.#rhiState.stencilOp(param0, param1, param2);
            return;
        }
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
        if (this.#rhiState) {
            if (name === 'colorMask') {
                this.#rhiState.colorMask(
                    booleanValue(param0, name),
                    booleanValue(param1, name),
                    booleanValue(param2, name),
                    booleanValue(param3, name)
                );
            } else if (name === 'blendFuncSeparate') {
                this.#rhiState.blendFuncSeparate(
                    numberValue(param0, name),
                    numberValue(param1, name),
                    numberValue(param2, name),
                    numberValue(param3, name)
                );
            } else {
                this.#rhiState.viewport(
                    numberValue(param0, name),
                    numberValue(param1, name),
                    numberValue(param2, name),
                    numberValue(param3, name)
                );
            }
            return;
        }
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
        if (this.#rhiState) {
            return this.#rhiState.getCachedState(name) as
                StateValue | readonly StateValue[] | undefined;
        }
        const values = this.state.get(name);
        return values?.length === 1 ? values[0] : values;
    }
}

export default WebGLState;
