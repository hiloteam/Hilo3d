import math from '../math/math';
import Cache from '../utils/Cache';
import GLSL300VertDefineCode from '../shader/chunk/GLSL300Define.vert';
import GLSL300FragDefineCode from '../shader/chunk/GLSL300Define.frag';
import { VERTEX_SHADER } from '../constants/webgl';
import glType from './glType';
import extensions from './extensions';
import Shader from '../shader/Shader';
import UniformBuffer from './UniformBuffer';
import requireGLResource from './requireGLResource';
import type WebGLState from './WebGLState';
import type WebGLResourceManager from './WebGLResourceManager';
import type { GLContext, GLTypeInfo, UniformArray, UniformScalar } from './types';

export interface ProgramParameters {
    state: WebGLState;
    vertexShader?: string;
    fragShader?: string;
}

export class ShaderCompilationError extends Error {
    readonly shaderType: GLenum;
    readonly infoLog: string;
    readonly source: string;

    constructor(shaderType: GLenum, infoLog: string, source: string) {
        const stage = shaderType === VERTEX_SHADER ? 'vertex' : 'fragment';
        super(`${stage} shader compilation failed: ${infoLog}\n${source}`);
        this.name = 'ShaderCompilationError';
        this.shaderType = shaderType;
        this.infoLog = infoLog;
        this.source = source;
    }
}

export class ProgramLinkError extends Error {
    readonly infoLog: string;

    constructor(infoLog: string) {
        super(`WebGL program link failed: ${infoLog}`);
        this.name = 'ProgramLinkError';
        this.infoLog = infoLog;
    }
}

export interface AttributePointerParameters {
    type?: GLenum;
    normalized?: boolean;
    stride?: GLsizei;
    offset?: GLintptr;
    size?: GLint;
}

export interface ProgramAttribute {
    name: string;
    location: GLint;
    type: GLenum;
    size: GLint;
    glTypeInfo: GLTypeInfo;
    pointer(parameters: AttributePointerParameters): void;
    enable(): void;
    divisor(value?: GLuint): void;
    addTo<State extends object>(array: (State | undefined)[], data: State): void;
}

export interface ProgramUniform {
    name: string;
    location: WebGLUniformLocation | null;
    type: GLenum;
    size: GLint;
    glTypeInfo: GLTypeInfo;
    textureIndex?: number;
}

export interface ProgramUniformBlock {
    blockIndex: GLuint;
}

export interface ProgramRenderer {
    resourceManager: WebGLResourceManager;
}

const cache = new Cache<Program>();

function numericParameter(value: unknown, name: string): number {
    if (typeof value !== 'number') throw new TypeError(`WebGL ${name} did not return a number`);
    return value;
}

function isUniformArray(value: unknown): value is UniformArray {
    return (
        Array.isArray(value) ||
        value instanceof Float32Array ||
        value instanceof Int32Array ||
        value instanceof Uint32Array
    );
}

function isUniformScalar(value: unknown): value is UniformScalar {
    return typeof value === 'number' || typeof value === 'boolean';
}

function integerArray(value: unknown): number[] | null {
    if (value instanceof Int32Array || value instanceof Uint32Array) return Array.from(value);
    if (!Array.isArray(value)) return null;
    const result: number[] = [];
    for (const item of value as unknown[]) {
        if (typeof item !== 'number' || !Number.isInteger(item)) return null;
        result.push(item);
    }
    return result;
}

function uniformBlockIndices(value: unknown, count: number): Int32Array {
    const values = integerArray(value);
    if (values?.length !== count) {
        throw new TypeError('WebGL UNIFORM_BLOCK_INDEX query did not return integer array data');
    }
    return Int32Array.from(values, index => (index === 0xffffffff ? -1 : index));
}

function isWebGL2Context(gl: GLContext): gl is WebGL2RenderingContext {
    return 'bindBufferBase' in gl && 'getActiveUniforms' in gl;
}

class Program {
    static get cache(): Cache<Program> {
        return cache;
    }

    static reset(_gl?: GLContext): void {
        cache.each(program => program.destroy());
    }

    static getProgram(shader: Shader, state: WebGLState): Program {
        const cached = cache.get(shader.id);
        if (cached) return cached;

        const program = new Program({
            state,
            vertexShader: shader.vs,
            fragShader: shader.fs
        });
        cache.add(shader.id, program);
        return program;
    }

    static getBlankProgram(state: WebGLState): Program {
        const shader = Shader.getCustomShader(
            'void main(){}',
            'precision HILO_MAX_FRAGMENT_PRECISION float;void main(){gl_FragColor = vec4(0.0);}',
            '',
            '__hiloBlankShader'
        );
        return this.getProgram(shader, state);
    }

    readonly className = 'Program';
    readonly isProgram = true;
    readonly id: string;
    readonly gl: GLContext;
    readonly state: WebGLState;
    readonly isWebGL2: boolean;
    fragShader = '';
    vertexShader = '';
    attributes: Record<string, ProgramAttribute> = {};
    uniforms: Record<string, ProgramUniform> = {};
    uniformBlocks: Record<string, ProgramUniformBlock> = {};
    program: WebGLProgram | null;
    alwaysUse = false;
    private readonly uniformValues = new Map<string, UniformScalar>();
    private _isDestroyed = false;

    constructor(params: ProgramParameters) {
        this.id = math.generateUUID(this.className);
        this.state = params.state;
        this.gl = params.state.gl;
        this.isWebGL2 = params.state.isWebGL2;
        this.vertexShader = params.vertexShader ?? '';
        this.fragShader = params.fragShader ?? '';
        this.program = this.createProgram();
        this.initAttributes();
        this.initUniforms();
    }

    createProgram(): WebGLProgram {
        const gl = this.gl;
        const program = requireGLResource(gl.createProgram(), 'a program');
        let vertexShader: WebGLShader | null = null;
        let fragShader: WebGLShader | null = null;
        try {
            vertexShader = this.createShader(gl.VERTEX_SHADER, this.vertexShader);
            fragShader = this.createShader(gl.FRAGMENT_SHADER, this.fragShader);
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragShader);
            gl.linkProgram(program);
            const linked: unknown = gl.getProgramParameter(program, gl.LINK_STATUS);
            if (linked !== true) {
                const error = new ProgramLinkError(
                    gl.getProgramInfoLog(program) ?? 'unknown error'
                );
                throw error;
            }
            return program;
        } catch (error: unknown) {
            gl.deleteProgram(program);
            throw error;
        } finally {
            if (vertexShader) gl.deleteShader(vertexShader);
            if (fragShader) gl.deleteShader(fragShader);
        }
    }

    useProgram(): void {
        this.state.useProgram(this.program);
    }

    /** Set a reflected GLSL uniform through the validated property generated at link time. */
    setUniform(name: string, value: unknown): void {
        if (!this.uniforms[name]) throw new Error(`Program has no active uniform named ${name}`);
        if (!Reflect.set(this, name, value)) throw new Error(`Unable to update uniform ${name}`);
    }

    /** Bind a named uniform block through the validated property generated at link time. */
    setUniformBlock(name: string, value: UniformBuffer): void {
        if (!this.uniformBlocks[name])
            throw new Error(`Program has no active uniform block named ${name}`);
        if (!Reflect.set(this, name, value))
            throw new Error(`Unable to bind uniform block ${name}`);
    }

    createShader(shaderType: GLenum, source: string): WebGLShader {
        const code = this.isWebGL2 ? this.convertToGLSL300(shaderType, source) : source;
        const shader = requireGLResource(this.gl.createShader(shaderType), 'a shader');
        this.gl.shaderSource(shader, code);
        this.gl.compileShader(shader);
        const compiled: unknown = this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS);
        if (compiled !== true) {
            const numberedCode = code
                .split('\n')
                .map((line, index) => `${String(index + 1)} ${line}`)
                .join('\n');
            const error = new ShaderCompilationError(
                shaderType,
                this.gl.getShaderInfoLog(shader) ?? 'unknown error',
                numberedCode
            );
            this.gl.deleteShader(shader);
            throw error;
        }
        return shader;
    }

    private convertToGLSL300(shaderType: GLenum, code: string): string {
        if (shaderType === this.gl.VERTEX_SHADER) return GLSL300VertDefineCode + code;
        return (GLSL300FragDefineCode + code).replace(/gl_FragData\[(\d)\]/g, 'hilo_FragData$1');
    }

    initAttributes(): void {
        const program = this.program;
        if (!program) return;
        const gl = this.gl;
        const count = numericParameter(
            gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES),
            'ACTIVE_ATTRIBUTES'
        );
        const instancedExtension = extensions.instanced;

        for (let index = 0; index < count; index++) {
            const active = gl.getActiveAttrib(program, index);
            if (!active) continue;
            const { name, type, size } = active;
            const baseLocation = gl.getAttribLocation(program, name);
            const glTypeInfo = glType.get(type);
            const matrixSize = glTypeInfo.type === 'Matrix' ? Math.sqrt(glTypeInfo.size) : 1;

            const eachLocation = (callback: (location: GLint, offset: number) => void): void => {
                for (let item = 0; item < matrixSize; item++) callback(baseLocation + item, item);
            };

            const attribute: ProgramAttribute = {
                name,
                location: baseLocation,
                type,
                size,
                glTypeInfo,
                pointer: parameters => {
                    const pointerType = parameters.type ?? gl.FLOAT;
                    const normalized = parameters.normalized ?? false;
                    const offset = parameters.offset ?? 0;
                    if (matrixSize === 1) {
                        gl.vertexAttribPointer(
                            baseLocation,
                            parameters.size ?? glTypeInfo.size,
                            pointerType,
                            normalized,
                            parameters.stride ?? 0,
                            offset
                        );
                        return;
                    }
                    const matrixStride = glTypeInfo.byteSize;
                    const stride =
                        parameters.stride === undefined || parameters.stride === 0
                            ? matrixStride
                            : parameters.stride;
                    const vectorByteSize = matrixSize * 4;
                    eachLocation((location, item) => {
                        gl.vertexAttribPointer(
                            location,
                            matrixSize,
                            pointerType,
                            normalized,
                            stride,
                            offset + vectorByteSize * item
                        );
                    });
                },
                enable: () => {
                    eachLocation(location => {
                        gl.enableVertexAttribArray(location);
                    });
                },
                divisor: (value = 1) => {
                    if (instancedExtension)
                        eachLocation(location => {
                            instancedExtension.vertexAttribDivisor(location, value);
                        });
                },
                addTo: (array, data) => {
                    eachLocation(location => {
                        array[location] = data;
                    });
                }
            };
            this.attributes[name] = attribute;
        }
    }

    initUniforms(): void {
        const program = this.program;
        if (!program) return;
        const gl = this.gl;
        const count = numericParameter(
            gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS),
            'ACTIVE_UNIFORMS'
        );
        let activeUniformBlockIndices: Int32Array | null = null;

        if (this.isWebGL2 && isWebGL2Context(gl)) {
            const blockCount = numericParameter(
                gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS),
                'ACTIVE_UNIFORM_BLOCKS'
            );
            for (let index = 0; index < blockCount; index++) {
                const blockName = gl.getActiveUniformBlockName(program, index);
                if (!blockName) continue;
                const blockIndex = gl.getUniformBlockIndex(program, blockName);
                gl.uniformBlockBinding(program, blockIndex, index);
                this.uniformBlocks[blockName] = { blockIndex };
                Object.defineProperty(this, blockName, {
                    set: (value: unknown) => {
                        if (!(value instanceof UniformBuffer)) {
                            throw new TypeError(
                                `Uniform block ${blockName} requires a UniformBuffer`
                            );
                        }
                        gl.bindBufferBase(gl.UNIFORM_BUFFER, index, value.getBuffer(gl).buffer);
                    }
                });
            }
            const indices = Array.from({ length: count }, (_value, index) => index);
            const queriedBlockIndices: unknown = gl.getActiveUniforms(
                program,
                indices,
                gl.UNIFORM_BLOCK_INDEX
            );
            activeUniformBlockIndices = uniformBlockIndices(queriedBlockIndices, count);
        }

        let nextTextureIndex = 0;
        for (let index = 0; index < count; index++) {
            const active = gl.getActiveUniform(program, index);
            if (!active || (activeUniformBlockIndices?.[index] ?? -1) !== -1) continue;
            const name = active.name.replace(/\[0\]$/, '');
            const location = gl.getUniformLocation(program, name);
            const glTypeInfo = glType.get(active.type);
            const info: ProgramUniform = {
                name,
                location,
                type: active.type,
                size: active.size,
                glTypeInfo
            };
            if (active.type === gl.SAMPLER_2D || active.type === gl.SAMPLER_CUBE) {
                info.textureIndex = nextTextureIndex;
                nextTextureIndex += active.size;
            }
            this.uniforms[name] = info;

            Object.defineProperty(this, name, {
                set: (value: unknown) => {
                    if (isUniformArray(value)) {
                        glTypeInfo.uniformArray(location, value);
                    } else if (glTypeInfo.size === 1 && active.size === 1) {
                        if (!isUniformScalar(value)) {
                            throw new TypeError(`Uniform ${name} requires a scalar value`);
                        }
                        if (this.uniformValues.get(name) !== value) {
                            this.uniformValues.set(name, value);
                            glTypeInfo.uniform(location, value);
                        }
                    } else {
                        throw new TypeError(`Uniform ${name} requires numeric array data`);
                    }
                }
            });
        }
    }

    destroyIfNoRef(renderer: ProgramRenderer): this {
        renderer.resourceManager.destroyIfNoRef(this);
        return this;
    }

    destroy(): this {
        if (this._isDestroyed) return this;
        if (this.program) this.gl.deleteProgram(this.program);
        this.program = null;
        this.attributes = {};
        this.uniforms = {};
        this.uniformBlocks = {};
        this.uniformValues.clear();
        cache.removeObject(this);
        this._isDestroyed = true;
        return this;
    }
}

export default Program;
