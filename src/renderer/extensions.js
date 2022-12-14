import {
    WebGL1VertexArrayObjectExtension, WebGL2VertexArrayObjectExtension,
} from './extensions/VertexArrayObjectExtension';

import {
    WebGL1InstancedArraysExtension, WebGL2InstancedArraysExtension,
} from './extensions/InstancedArraysExtension';

import {
    isWebGL2
} from '../utils/util';

const WebGL2DefaultSupportExtensions = {
    OES_texture_float: {
        name: 'OES_texture_float',
    },
    EXT_frag_depth: {
        name: 'EXT_frag_depth',
    },
    OES_element_index_uint: {
        name: 'OES_element_index_uint',
    },
    EXT_shader_texture_lod: {
        name: 'EXT_shader_texture_lod',
    },
};

const WebGLPolyfillExtensions = {
    OES_vertex_array_object: {
        WebGL1: WebGL1VertexArrayObjectExtension,
        WebGL2: WebGL2VertexArrayObjectExtension,
    },

    ANGLE_instanced_arrays: {
        WebGL1: WebGL1InstancedArraysExtension,
        WebGL2: WebGL2InstancedArraysExtension,
    }
};

/**
 * WebGL 扩展
 * @namespace extensions
 * @type {Object}
 * @description WebGL 扩展管理，默认开启的扩展有：ANGLE_instanced_arrays, OES_vertex_array_object, OES_texture_float, OES_element_index_uint, EXT_shader_texture_lod, EXT_texture_filter_anisotropic, WEBGL_lose_context
 */
const extensions = {
    /**
     * ANGLE_instanced_arrays扩展
     * @type {ANGLEInstancedArrays}
     */
    instanced: undefined,

    /**
     * OES_vertex_array_object扩展
     * @type {OESVertexArrayObject}
     */
    vao: undefined,

    /**
     * OES_texture_float扩展
     * @type {OESTextureFloat}
     */
    texFloat: undefined,

    /**
     * EXT_frag_depth扩展
     * @type {EXTFragDepth}
     */
    fragDepth: undefined,

    /**
     * WEBGL_lose_context扩展
     * @type {WebGLLoseContext}
     */
    loseContext: undefined,

    /**
     * EXT_texture_filter_anisotropic
     * @type {EXTTextureFilterAnisotropic}
     */
    textureFilterAnisotropic: undefined,

    _usedExtensions: {},
    _disabledExtensions: {},

    /**
     * 初始化
     * @param {WebGLRenderingContext} gl
     */
    init(gl) {
        this.reset(gl);
    },

    /**
     * 重置扩展
     * @param {WebGLRenderingContext} gl
     */
    reset(gl) {
        this.gl = gl;
        this.isWebGL2 = isWebGL2(gl);

        const usedExtensions = this._usedExtensions;
        for (let name in usedExtensions) {
            const alias = usedExtensions[name];
            this[alias] = undefined;
            this.get(name, alias);
        }
    },

    /**
     * 使用扩展
     * @param  {String} name 扩展名称
     * @param {String} [alias=name] 别名，默认和 name 相同
     */
    use(name, alias = name) {
        this._usedExtensions[name] = alias;
        if (this.gl) {
            this.get(name, alias);
        }
    },

    /**
     * 获取扩展，如果不支持返回 null，必须在 Renderer 初始化完后用
     * @param  {String} name 扩展名称
     * @param {String} [alias=name] 别名，默认和 name 相同
     * @return {Object|null}
     */
    get(name, alias = name) {
        if (this._disabledExtensions[name]) {
            return null;
        }

        let ext = this[alias];
        if (ext === undefined) {
            ext = this._getExtension(name);
            this[alias] = ext;
        }
        return ext;
    },

    /**
     * 禁止扩展
     * @param  {String} name 扩展名称
     */
    disable(name) {
        this._disabledExtensions[name] = true;
    },

    /**
     * 开启扩展
     * @param  {String} name 扩展名称
     */
    enable(name) {
        this._disabledExtensions[name] = false;
    },

    _getExtension(name) {
        const gl = this.gl;
        const isWebGL2 = this.isWebGL2;

        if (isWebGL2 && WebGL2DefaultSupportExtensions[name]) {
            return WebGL2DefaultSupportExtensions[name];
        }

        const WebGLPolyfillExtension = WebGLPolyfillExtensions[name];
        if (WebGLPolyfillExtension) {
            if (this.isWebGL2) {
                return new WebGLPolyfillExtension.WebGL2(gl);
            }
            const originExtension = this._getOriginExtension(name);
            if (originExtension) {
                return new WebGLPolyfillExtension.WebGL1(originExtension);
            }

            return null;
        }

        const originExtension = this._getOriginExtension(name);
        return originExtension;
    },

    _getOriginExtension(name) {
        const gl = this.gl;
        if (gl && gl.getExtension) {
            return gl.getExtension(name) || gl.getExtension('WEBKIT_' + name) || gl.getExtension('MOZ_' + name) || null;
        }

        return null;
    }
};

extensions.use('ANGLE_instanced_arrays', 'instanced');
extensions.use('OES_vertex_array_object', 'vao');
extensions.use('OES_texture_float', 'texFloat');
extensions.use('OES_element_index_uint', 'uintIndices');
extensions.use('EXT_shader_texture_lod', 'shaderTextureLod');
extensions.use('EXT_frag_depth', 'fragDepth');
extensions.use('EXT_texture_filter_anisotropic', 'textureFilterAnisotropic');
extensions.use('WEBGL_lose_context', 'loseContext');
extensions.use('EXT_color_buffer_float', 'colorBufferFloat');

export default extensions;

/**
 * @typedef {any} ANGLEInstancedArrays
 */

/**
 * @typedef {any} OESVertexArrayObject
 */

/**
 * @typedef {any} OESTextureFloat
 */

/**
 * @typedef {any} EXTFragDepth
 */

/**
 * @typedef {any} WebGLLoseContext
 */

/**
 * @typedef {any} EXTTextureFilterAnisotropic
 */
