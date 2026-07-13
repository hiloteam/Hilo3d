import math from '../math/math';
import Cache from '../utils/Cache';
import { VERTEX_SHADER } from '../constants/webgl';
import glType from './glType';
import Shader from '../shader/Shader';
import UniformBuffer, { type UniformBufferRange } from './UniformBuffer';
import { BUILT_IN_UNIFORM_BLOCK_LAYOUTS } from './ubo/BuiltInUniformBlocks';
import { getUniformBlockBinding } from './ubo/UniformBlockBindings';
import requireGLResource from './requireGLResource';
import type WebGLState from './WebGLState';
import type GraphicsResourceManager from './GraphicsResourceManager';
import type { GLContext, GLTypeInfo } from './types';

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
    name: string;
    blockIndex: GLuint;
    bindingPoint: GLuint;
    byteLength: number;
    activeUniformIndices: readonly GLuint[];
    uniformNames: readonly string[];
}

export interface ProgramRenderer {
    resourceManager: GraphicsResourceManager;
}

const cache = new Cache<Program>();

function numericParameter(value: unknown, name: string): number {
    if (typeof value !== 'number') throw new TypeError(`WebGL ${name} did not return a number`);
    return value;
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

function isUniformBufferRange(value: unknown): value is UniformBufferRange {
    return (
        typeof value === 'object' &&
        value !== null &&
        'uniformBuffer' in value &&
        (value as { uniformBuffer?: unknown }).uniformBuffer instanceof UniformBuffer &&
        'byteOffset' in value &&
        'byteLength' in value
    );
}

function isSamplerType(gl: WebGL2RenderingContext, type: GLenum): boolean {
    return new Set<GLenum>([
        gl.SAMPLER_2D,
        gl.SAMPLER_3D,
        gl.SAMPLER_CUBE,
        gl.SAMPLER_2D_SHADOW,
        gl.SAMPLER_2D_ARRAY,
        gl.SAMPLER_2D_ARRAY_SHADOW,
        gl.SAMPLER_CUBE_SHADOW,
        gl.INT_SAMPLER_2D,
        gl.INT_SAMPLER_3D,
        gl.INT_SAMPLER_CUBE,
        gl.INT_SAMPLER_2D_ARRAY,
        gl.UNSIGNED_INT_SAMPLER_2D,
        gl.UNSIGNED_INT_SAMPLER_3D,
        gl.UNSIGNED_INT_SAMPLER_CUBE,
        gl.UNSIGNED_INT_SAMPLER_2D_ARRAY
    ]).has(type);
}

interface SamplerTypeInfo extends GLTypeInfo {
    uniform(location: WebGLUniformLocation | null, value: number): void;
    uniformArray(location: WebGLUniformLocation | null, value: readonly number[]): void;
}

function samplerTypeInfo(gl: WebGL2RenderingContext, type: GLenum): SamplerTypeInfo {
    return {
        name: 'SAMPLER',
        byteSize: 4,
        type: 'Scalar',
        size: 1,
        glValue: type,
        uniform(location, value) {
            gl.uniform1i(location, value);
        },
        uniformArray(location, value) {
            gl.uniform1iv(location, Array.from(value));
        }
    };
}

function reflectedUniformValues(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    indices: readonly GLuint[],
    pname: GLenum,
    label: string
): number[] {
    const values = integerArray(gl.getActiveUniforms(program, indices, pname));
    if (values?.length !== indices.length) {
        throw new TypeError(`WebGL did not return ${label} for reflected uniform block members`);
    }
    return values;
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
            'precision HILO_MAX_FRAGMENT_PRECISION float;out vec4 hiloFragColor;void main(){hiloFragColor=vec4(0.0);}',
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
    fragShader = '';
    vertexShader = '';
    attributes: Record<string, ProgramAttribute> = {};
    uniforms: Record<string, ProgramUniform> = {};
    uniformBlocks: Record<string, ProgramUniformBlock> = {};
    program: WebGLProgram | null;
    alwaysUse = false;
    private readonly uniformValues = new Map<string, number>();
    private _isDestroyed = false;

    constructor(params: ProgramParameters) {
        this.id = math.generateUUID(this.className);
        this.state = params.state;
        this.gl = params.state.gl;
        this.vertexShader = params.vertexShader ?? '';
        this.fragShader = params.fragShader ?? '';
        this.program = this.createProgram();
        try {
            this.initAttributes();
            this.initUniforms();
        } catch (error: unknown) {
            this.gl.deleteProgram(this.program);
            this.program = null;
            throw error;
        }
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
    setUniformBlock(name: string, value: UniformBuffer | UniformBufferRange): void {
        if (!this.uniformBlocks[name])
            throw new Error(`Program has no active uniform block named ${name}`);
        if (!Reflect.set(this, name, value))
            throw new Error(`Unable to bind uniform block ${name}`);
    }

    createShader(shaderType: GLenum, source: string): WebGLShader {
        const shader = requireGLResource(this.gl.createShader(shaderType), 'a shader');
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        const compiled: unknown = this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS);
        if (compiled !== true) {
            const numberedCode = source
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

    initAttributes(): void {
        const program = this.program;
        if (!program) return;
        const gl = this.gl;
        const count = numericParameter(
            gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES),
            'ACTIVE_ATTRIBUTES'
        );
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
                    eachLocation(location => {
                        gl.vertexAttribDivisor(location, value);
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
        let activeUniformBlockIndices: Int32Array;

        {
            const blockCount = numericParameter(
                gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS),
                'ACTIVE_UNIFORM_BLOCKS'
            );
            const maximumBindings = numericParameter(
                gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS),
                'MAX_UNIFORM_BUFFER_BINDINGS'
            );
            for (let index = 0; index < blockCount; index++) {
                const blockName = gl.getActiveUniformBlockName(program, index);
                if (!blockName) continue;
                const blockIndex = gl.getUniformBlockIndex(program, blockName);
                const bindingPoint = getUniformBlockBinding(blockName);
                if (bindingPoint >= maximumBindings) {
                    throw new RangeError(
                        `Uniform block ${blockName} binding point ${String(bindingPoint)} exceeds WebGL2 limit ${String(maximumBindings)}`
                    );
                }
                const byteLength = numericParameter(
                    gl.getActiveUniformBlockParameter(
                        program,
                        blockIndex,
                        gl.UNIFORM_BLOCK_DATA_SIZE
                    ),
                    'UNIFORM_BLOCK_DATA_SIZE'
                );
                const queriedIndices: unknown = gl.getActiveUniformBlockParameter(
                    program,
                    blockIndex,
                    gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES
                );
                const activeUniformIndices = integerArray(queriedIndices);
                if (!activeUniformIndices) {
                    throw new TypeError(
                        `WebGL did not return active uniform indices for block ${blockName}`
                    );
                }
                const uniformNames = activeUniformIndices.map(uniformIndex => {
                    const uniformName = gl.getActiveUniform(program, uniformIndex)?.name;
                    if (!uniformName) {
                        throw new TypeError(
                            `WebGL did not return active uniform ${String(uniformIndex)} for block ${blockName}`
                        );
                    }
                    return (uniformName.split('.').at(-1) ?? uniformName).replace(/\[0\]$/, '');
                });
                const canonicalLayout = BUILT_IN_UNIFORM_BLOCK_LAYOUTS[blockName];
                if (canonicalLayout) {
                    if (Math.ceil(byteLength / 16) * 16 !== canonicalLayout.byteLength) {
                        throw new Error(
                            `${blockName} is ${String(byteLength)} bytes in GLSL but the canonical ABI requires ${String(canonicalLayout.byteLength)}`
                        );
                    }
                    const offsets = reflectedUniformValues(
                        gl,
                        program,
                        activeUniformIndices,
                        gl.UNIFORM_OFFSET,
                        'UNIFORM_OFFSET'
                    );
                    const arrayStrides = reflectedUniformValues(
                        gl,
                        program,
                        activeUniformIndices,
                        gl.UNIFORM_ARRAY_STRIDE,
                        'UNIFORM_ARRAY_STRIDE'
                    );
                    const matrixStrides = reflectedUniformValues(
                        gl,
                        program,
                        activeUniformIndices,
                        gl.UNIFORM_MATRIX_STRIDE,
                        'UNIFORM_MATRIX_STRIDE'
                    );
                    uniformNames.forEach((uniformName, uniformIndex) => {
                        const field = canonicalLayout.fields[uniformName];
                        if (!field) {
                            throw new Error(
                                `${blockName}.${uniformName} is outside the canonical WebGL2 ABI`
                            );
                        }
                        const reflected = {
                            offset: offsets[uniformIndex],
                            arrayStride: arrayStrides[uniformIndex],
                            matrixStride: matrixStrides[uniformIndex]
                        };
                        if (
                            reflected.offset !== field.offset ||
                            reflected.arrayStride !== field.arrayStride ||
                            reflected.matrixStride !== field.matrixStride
                        ) {
                            throw new Error(
                                `${blockName}.${uniformName} std140 layout does not match the canonical WebGL2 ABI`
                            );
                        }
                    });
                }
                gl.uniformBlockBinding(program, blockIndex, bindingPoint);
                this.uniformBlocks[blockName] = {
                    name: blockName,
                    blockIndex,
                    bindingPoint,
                    byteLength,
                    activeUniformIndices,
                    uniformNames
                };
                Object.defineProperty(this, blockName, {
                    set: (value: unknown) => {
                        const uniformBuffer =
                            value instanceof UniformBuffer
                                ? value
                                : isUniformBufferRange(value)
                                  ? value.uniformBuffer
                                  : null;
                        if (!uniformBuffer) {
                            throw new TypeError(
                                `Uniform block ${blockName} requires a UniformBuffer or UniformBufferRange`
                            );
                        }
                        const range = isUniformBufferRange(value) ? value : undefined;
                        const availableByteLength = range?.byteLength ?? uniformBuffer.byteLength;
                        if (availableByteLength < byteLength) {
                            throw new RangeError(
                                `Uniform block ${blockName} requires ${String(byteLength)} bytes; binding provides ${String(availableByteLength)}`
                            );
                        }
                        uniformBuffer.bind(gl, bindingPoint, range);
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
        const maximumTextureUnits = numericParameter(
            gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
            'MAX_COMBINED_TEXTURE_IMAGE_UNITS'
        );
        for (let index = 0; index < count; index++) {
            const active = gl.getActiveUniform(program, index);
            if (!active || activeUniformBlockIndices[index] !== -1) continue;
            const name = active.name.replace(/\[0\]$/, '');
            if (!isSamplerType(gl, active.type)) {
                throw new Error(
                    `Classic uniform ${name} is not a sampler; place non-texture data in a std140 uniform block`
                );
            }
            const location = gl.getUniformLocation(program, name);
            const glTypeInfo = samplerTypeInfo(gl, active.type);
            const info: ProgramUniform = {
                name,
                location,
                type: active.type,
                size: active.size,
                glTypeInfo
            };
            info.textureIndex = nextTextureIndex;
            nextTextureIndex += active.size;
            if (nextTextureIndex > maximumTextureUnits) {
                throw new RangeError(
                    `Program requires ${String(nextTextureIndex)} texture units but WebGL2 exposes ${String(maximumTextureUnits)}`
                );
            }
            this.uniforms[name] = info;

            Object.defineProperty(this, name, {
                set: (value: unknown) => {
                    if (typeof value === 'number' && Number.isInteger(value) && active.size === 1) {
                        if (this.uniformValues.get(name) !== value) {
                            this.uniformValues.set(name, value);
                            glTypeInfo.uniform(location, value);
                        }
                    } else {
                        const units = integerArray(value);
                        if (units?.length !== active.size) {
                            throw new TypeError(
                                `Sampler uniform ${name} requires ${String(active.size)} integer texture unit${active.size === 1 ? '' : 's'}`
                            );
                        }
                        glTypeInfo.uniformArray(location, units);
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
