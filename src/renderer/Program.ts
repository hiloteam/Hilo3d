import math from '../math/math';
import Cache from '../utils/Cache';
import log from '../utils/log';
import glType from './glType';
import extensions from './extensions';
import Shader from '../shader/Shader';
import constants from '../constants';

const GLSL300VertDefineCode = require('../shader/chunk/GLSL300Define.vert');
const GLSL300FragDefineCode = require('../shader/chunk/GLSL300Define.frag');

const {
    VERTEX_SHADER,
} = constants;

const cache = new Cache();

interface AttributeInfo {
    name: string;
    location: number;
    type: number;
    size: number;
    glTypeInfo: any;
    pointer: (params: {
        type?: number;
        normalized?: boolean;
        stride?: number;
        offset?: number;
        size?: number;
    }) => void;
    enable: () => void;
    divisor: (d?: number) => void;
    addTo: (array: any, data: any) => void;
}

interface UniformInfo {
    name: string;
    location: WebGLUniformLocation | null;
    type: number;
    size: number;
    glTypeInfo: any;
    textureIndex?: number;
}

interface UniformBlockInfo {
    blockIndex: number;
}

interface ProgramParams {
    state: any;
    vertexShader?: string;
    fragShader?: string;
    ignoreError?: boolean;
}

/**
 * @class
 */
class Program {
    /**
     * 缓存
     * @type {Cache}
     * @readOnly
     * @return {Cache}
     */
    static get cache(): Cache {
        return cache;
    }

    /**
     * 重置缓存
     */
    static reset(_gl: WebGLRenderingContext | WebGL2RenderingContext): void {
        cache.each((program: Program) => {
            program.destroy();
        });
    }

    /**
     * 获取程序
     * @param  {Shader} shader
     * @param  {WebGLState} state
     * @param  {Boolean} [ignoreError=false]
     * @return {Program}
     */
    static getProgram(shader: Shader, state: any, ignoreError: boolean = false): Program {
        const id = shader.id;
        let program = cache.get(id) as Program;
        if (!program) {
            program = new Program({
                state,
                vertexShader: shader.vs,
                fragShader: shader.fs,
                ignoreError
            });
            cache.add(id, program);
        }

        return program;
    }

    /**
     * 获取空白程序
     * @param  {WebGLState} state
     * @return {Program}
     */
    static getBlankProgram(state: any): Program {
        const shader = Shader.getCustomShader('void main(){}', 'precision HILO_MAX_FRAGMENT_PRECISION float;void main(){gl_FragColor = vec4(0.0);}', '', '__hiloBlankShader');
        return this.getProgram(shader, state, true);
    }

    /**
     * @default Program
     * @type {String}
     */
    className: string = 'Program';

    /**
     * @default true
     * @type {Boolean}
     */
    isProgram: boolean = true;

    /**
     * id
     * @type {String}
     */
    id: string;

    /**
     * 片段代码
     * @type {String}
     * @default ''
     */
    fragShader: string = '';

    /**
     * 顶点代码
     * @type {String}
     * @default ''
     */
    vertexShader: string = '';

    /**
     * attribute 集合
     * @type {Object}
     * @default null
     */
    attributes: Record<string, AttributeInfo> | null = null;

    /**
     * uniform 集合
     * @type {Object}
     * @default null
     */
    uniforms: Record<string, UniformInfo> | null = null;

    /**
     * uniformBlock 集合
     * @type {Object}
     * @default null
     */
    uniformBlocks: Record<string, UniformBlockInfo> | null = null;

    /**
     * program
     * @type {WebGLProgram}
     * @default null
     */
    program: WebGLProgram | null = null;

    /**
     * gl
     * @type {WebGLRenderingContext}
     */
    gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

    /**
     * webglState
     * @type {WebGLState}
     * @default null
     */
    state: any = null;

    /**
     * 是否始终使用
     * @default true
     * @type {Boolean}
     */
    alwaysUse: boolean = false;

    /**
     * 是否是 WebGL2
     * @default false
     * @type {Boolean}
     */
    isWebGL2: boolean = false;

    /**
     * 是否忽略错误
     * @type {Boolean}
     */
    ignoreError?: boolean;

    private _dict: Record<string, any> | null = {};

    private _isDestroyed: boolean = false;

    /**
     * @constructs
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     * @param  {WebGLState} params.state WebGL state
     */
    constructor(params: ProgramParams) {
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
        this._dict = {};

        this.attributes = {};
        this.uniforms = {};
        this.uniformBlocks = {};
        this.gl = this.state.gl;
        this.isWebGL2 = this.state.isWebGL2;
        this.program = this.createProgram();

        if (this.program) {
            this.initAttributes();
            this.initUniforms();
            return this;
        }

        if (this.ignoreError) {
            return this;
        }

        return Program.getBlankProgram(params.state);
    }

    /**
     * 生成 program
     * @return {WebGLProgram}
     */
    createProgram(): WebGLProgram | null {
        const gl = this.gl!;
        const program = gl.createProgram()!;
        const vertexShader = this.createShader(gl.VERTEX_SHADER, this.vertexShader);
        const fragShader = this.createShader(gl.FRAGMENT_SHADER, this.fragShader);

        if (vertexShader && fragShader) {
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragShader);
            gl.linkProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragShader);

            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                const error = gl.getProgramInfoLog(program);
                log.error('compileProgramError: ' + error, this);
                gl.deleteProgram(program);
                return null;
            }

            return program;
        }

        return null;
    }

    /**
     * 使用 program
     */
    useProgram(): void {
        this.state.useProgram(this.program);
    }

    /**
     * 生成 shader
     * @param  {Number} shaderType
     * @param  {String} code
     * @return {WebGLShader}
     */
    createShader(shaderType: number, code: string): WebGLShader | null {
        if (this.isWebGL2) {
            code = Program._convertToGLSL300(shaderType, code);
        }
        const gl = this.gl!;
        const shader = gl.createShader(shaderType)!;
        gl.shaderSource(shader, code);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(shader);
            log.error('compileShaderError: ' + error, code.split('\n').map((line, index) => `${index + 1} ${line}`).join('\n'));
            return null;
        }

        return shader;
    }

    private static _convertToGLSL300(shaderType: number, code: string): string {
        let finalCode = code;
        if (shaderType === VERTEX_SHADER) {
            finalCode = GLSL300VertDefineCode + code;
        } else {
            finalCode = GLSL300FragDefineCode + code;
            finalCode = finalCode.replace(/gl_FragData\[(\d)\]/g, 'hilo_FragData$1');
        }

        return finalCode;
    }

    /**
     * 初始化 attribute 信息
     */
    initAttributes(): void {
        const gl = this.gl!;
        const program = this.program!;

        const num = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        const instancedExtension = extensions.instanced;
        for (let i = 0; i < num; i++) {
            const {
                name,
                type,
                size
            } = gl.getActiveAttrib(program, i)!;
            const location = gl.getAttribLocation(program, name);
            const glTypeInfo = glType.get(type);
            let pointer = ({
                type = gl.FLOAT,
                normalized = false,
                stride = 0,
                offset = 0,
                size = glTypeInfo.size,
            }: {
                type?: number;
                normalized?: boolean;
                stride?: number;
                offset?: number;
                size?: number;
            }) => {
                gl.vertexAttribPointer(location, size, type, normalized, stride, offset);
            };
            let enable = () => {
                gl.enableVertexAttribArray(location);
            };
            let divisor = (_d?: number) => {};
            let addTo = (array: any, data: any) => {
                array[location] = data;
            };

            if (instancedExtension) {
                divisor = (d: number = 1) => {
                    instancedExtension.vertexAttribDivisor(location, d);
                };
            }

            if (glTypeInfo.type === 'Matrix') {
                const matrixStride = glTypeInfo.byteSize;
                const size = glTypeInfo.size;
                const matSize = Math.sqrt(size);
                const vectorByteSize = matSize * 4;

                const each = (callback: (location: number, i: number) => void) => {
                    for (let i = 0; i < matSize; i++) {
                        callback(location + i, i);
                    }
                };
                pointer = ({
                    type = gl.FLOAT,
                    normalized = false,
                    stride = 0,
                    offset = 0
                }: {
                    type?: number;
                    normalized?: boolean;
                    stride?: number;
                    offset?: number;
                }) => {
                    let realStride;
                    if (stride === 0) {
                        realStride = matrixStride;
                    } else {
                        realStride = stride;
                    }
                    each((location, i) => {
                        gl.vertexAttribPointer(location, matSize, type, normalized, realStride, offset + vectorByteSize * i);
                    });
                };

                enable = () => {
                    each((location) => {
                        gl.enableVertexAttribArray(location);
                    });
                };

                addTo = (array, data) => {
                    each((location) => {
                        array[location] = data;
                    });
                };

                if (instancedExtension) {
                    divisor = (d: number = 1) => {
                        each((location) => {
                            instancedExtension.vertexAttribDivisor(location, d);
                        });
                    };
                }
            }
            this.attributes![name] = {
                name,
                location,
                type,
                size,
                glTypeInfo,
                pointer,
                enable,
                divisor,
                addTo
            };
        }
    }

    /**
     * 初始化 uniform 信息
     */
    initUniforms(): void {
        const gl = this.gl! as WebGL2RenderingContext;
        const program = this.program!;
        const uniforms = this.uniforms!;
        const uniformBlocks = this.uniformBlocks!;

        const num = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        let uniformBlockIndices: number[] | undefined;
        if (this.isWebGL2) {
            const blockNum = gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS);
            for (let i = 0; i < blockNum; i++) {
                const blockName = gl.getActiveUniformBlockName(program, i)!;
                const blockIndex = gl.getUniformBlockIndex(program, blockName);
                gl.uniformBlockBinding(program, blockIndex, i);
                uniformBlocks[blockName] = {
                    blockIndex,
                };
                Object.defineProperty(this, blockName, {
                    set: (uniformBuffer: any) => {
                        gl.bindBufferBase(gl.UNIFORM_BUFFER, i, uniformBuffer.getBuffer(gl).buffer);
                    }
                });
            }

            let uniformIndices: number[] = [];
            for (let i = 0; i < num; i++) {
                uniformIndices.push(i);
            }
            uniformBlockIndices = gl.getActiveUniforms(program, uniformIndices, gl.UNIFORM_BLOCK_INDEX);
        }

        let textureIndex = 0;
        for (let i = 0; i < num; i++) {
            let {
                name,
                size,
                type
            } = gl.getActiveUniform(program, i)!;

            // uniform block index -1 说明不是 uniform block
            if (uniformBlockIndices && uniformBlockIndices[i] !== -1) {
                continue;
            }

            name = name.replace(/\[0\]$/, '');
            const location = gl.getUniformLocation(program, name);
            const glTypeInfo = glType.get(type);
            const {
                uniformArray,
                uniform
            } = glTypeInfo;

            uniforms[name] = {
                name,
                location,
                type,
                size,
                glTypeInfo
            };

            if (type === gl.SAMPLER_2D || type === gl.SAMPLER_CUBE) {
                uniforms[name].textureIndex = textureIndex;
                textureIndex += size;
            }

            Object.defineProperty(this, name, {
                set: glTypeInfo.size > 1 || size > 1 ? (value: any) => {
                    uniformArray(location, value);
                } : (value: any) => {
                    if (this._dict[name] !== value) {
                        this._dict[name] = value;
                        uniform(location, value);
                    }
                }
            });
        }
    }

    /**
     * 没有被引用时销毁资源
     * @param  {WebGLRenderer} renderer
     * @return {Program} this
     */
    destroyIfNoRef(renderer: any): Program {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);

        return this;
    }

    /**
     * 销毁资源
     * @return {Program} this
     */
    destroy(): Program {
        if (this._isDestroyed) {
            return this;
        }

        this.gl!.deleteProgram(this.program);
        this.uniforms = null;
        this.uniformBlocks = null;
        this.attributes = null;
        this.program = null;
        this.gl = null;
        this.state = null;
        this._dict = null;
        cache.removeObject(this);

        this._isDestroyed = true;
        return this;
    }
}

export default Program;
