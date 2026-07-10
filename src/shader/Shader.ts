// @ts-nocheck
// Legacy Class.create module; public API is checked by types/index.d.ts.
/* eslint global-require: "off" */
import Class from '../core/Class';
import math from '../math/math';
import Cache from '../utils/Cache';
import capabilities from '../renderer/capabilities';
import basicFragCode from './basic.frag';
import basicVertCode from './basic.vert';
import geometryFragCode from './geometry.frag';
import pbrFragCode from './pbr.frag';

const cache = new Cache();
const headerCache = new Cache();
const CUSTUM_OPTION_PREFIX = 'HILO_CUSTUM_OPTION_';
const shaderModules = import.meta.glob<string>('./**/*.{frag,glsl,vert}', {
    eager: true,
    import: 'default'
});
const shaderSources = Object.fromEntries(
    Object.entries(shaderModules).map(([path, source]) => [path.slice(2), source])
);

/**
 * Shader类
 * @class
 */
const Shader = Class.create<typeof hilo3d.Shader>()(/** @lends Shader.prototype */ {
    /**
     * @default true
     * @type {boolean}
     */
    isShader: true,
    /**
     * @default Shader
     * @type {string}
     */
    className: 'Shader',
    /**
     * vs 顶点代码
     * @default ''·
     * @type {String}
     */
    vs: '',
    /**
     * vs 片段代码
     * @default ''
     * @type {String}
     */
    fs: '',

    Statics: /** @lends Shader */ {
        commonOptions: {},
        /**
         * 内部的所有shader块字符串，可以用来拼接glsl代码
         * @type {Object}
         */
        shaders: shaderSources,

        /**
         * 初始化
         * @param  {WebGLRenderer} renderer
         */
        init(renderer) {
            this.renderer = renderer;
            this.commonHeader = this._getCommonHeader(this.renderer);
        },

        /**
         * Shader 缓存
         * @readOnly
         * @type {Cache}
         */
        cache: {
            get() {
                return cache;
            }
        },

        /**
         * Shader header缓存，一般不用管
         * @readOnly
         * @type {Cache}
         */
        headerCache: {
            get() {
                return headerCache;
            }
        },

        /**
         * 重置
         */
        reset(gl) { // eslint-disable-line no-unused-vars
            cache.removeAll();
        },
        /**
         * 获取header缓存的key
         * @param {Mesh} mesh mesh
         * @param {Material} material 材质
         * @param {LightManager} lightManager lightManager
         * @param {Fog} fog fog
         * @param {Boolean} useLogDepth 是否使用对数深度
         * @return {string}
         */
        getHeaderKey(mesh, material, lightManager, fog, useLogDepth) {
            let headerKey = 'header_' + material.id + '_' + lightManager.lightInfo.uid;
            if (mesh.isSkinedMesh) {
                headerKey += '_joint' + mesh.skeleton.jointCount;
            }
            if (fog) {
                headerKey += '_fog_' + fog.mode;
            }

            headerKey += '_' + mesh.geometry.getShaderKey();

            if (useLogDepth) {
                headerKey += '_fogDepth';
            }
            return headerKey;
        },
        /**
         * 获取header
         * @param {Mesh} mesh
         * @param {Material} material
         * @param {LightManager} lightManager
         * @param {Fog} fog
         * @return {String}
         */
        getHeader(mesh, material, lightManager, fog, useLogDepth) {
            const headerKey = this.getHeaderKey(mesh, material, lightManager, fog);
            let header = headerCache.get(headerKey);
            if (!header || material.isDirty) {
                const headers = {};
                Object.assign(headers, this.commonOptions);
                const lightType = material.lightType;
                if (lightType && lightType !== 'NONE') {
                    lightManager.getRenderOption(headers);
                }
                material.getRenderOption(headers);
                mesh.getRenderOption(headers);

                if (fog) {
                    headers.HAS_FOG = 1;
                    fog.getRenderOption(headers);
                }

                if (useLogDepth) {
                    headers.USE_LOG_DEPTH = 1;
                    if (capabilities.FRAG_DEPTH) {
                        headers.USE_FRAG_DEPTH = 1;
                    }
                }

                if (headers.HAS_NORMAL && headers.NORMAL_MAP) {
                    headers.HAS_TANGENT = 1;
                }

                if (!headers.RECEIVE_SHADOWS) {
                    delete headers.DIRECTIONAL_LIGHTS_SMC;
                    delete headers.SPOT_LIGHTS_SMC;
                    delete headers.POINT_LIGHTS_SMC;
                }

                header = `#define SHADER_NAME ${material.shaderName || material.className}\n`;
                header += Object.keys(headers).map((name) => {
                    if (name.indexOf(CUSTUM_OPTION_PREFIX) > -1) {
                        return `#define ${name.replace(CUSTUM_OPTION_PREFIX, '')} ${headers[name]}`;
                    }
                    return `#define HILO_${name} ${headers[name]}`;
                }).join('\n') + '\n';

                headerCache.add(headerKey, header);
            }
            return header;
        },
        _getCommonHeader(renderer) {
            const vertexPrecision = capabilities.getMaxPrecision(capabilities.MAX_VERTEX_PRECISION, renderer.vertexPrecision);
            const fragmentPrecision = capabilities.getMaxPrecision(capabilities.MAX_FRAGMENT_PRECISION, renderer.fragmentPrecision);
            const precision = capabilities.getMaxPrecision(vertexPrecision, fragmentPrecision);
            return `
#define HILO_MAX_PRECISION ${precision}
#define HILO_MAX_VERTEX_PRECISION ${vertexPrecision}
#define HILO_MAX_FRAGMENT_PRECISION ${fragmentPrecision}
`;
        },
        /**
         * 获取 shader
         * @param {Mesh} mesh
         * @param {Material} material
         * @param {Boolean} isUseInstance
         * @param {LightManager} lightManager
         * @param {Fog} fog
         * @param {Boolean} useLogDepth
         * @return {Shader}
         */
        getShader(mesh, material, isUseInstance, lightManager, fog, useLogDepth) {
            const header = this.getHeader(mesh, material, lightManager, fog, useLogDepth);

            if (material.isBasicMaterial || material.isPBRMaterial) {
                return this.getBasicShader(material, isUseInstance, header);
            }
            if (material.isShaderMaterial) {
                return this.getCustomShader(material.vs, material.fs, header, (material.shaderCacheId || material.id), material.useHeaderCache);
            }
            return null;
        },
        /**
         * 获取基础 shader
         * @param  {Material}  material
         * @param  {Boolean} isUseInstance
         * @param  {LightManager}  lightManager
         * @param  {Fog}  fog
         * @return {Shader}
         */
        getBasicShader(material, isUseInstance, header) {
            let instancedUniforms = '';
            if (isUseInstance) {
                instancedUniforms = material.getInstancedUniforms().map(x => x.name);
                instancedUniforms = instancedUniforms.join('|');
            }
            let key = material.className + ':' + instancedUniforms;
            if (material.onBeforeCompile) {
                key += ':' + (material.shaderCacheId || material.id);
            }

            let shader = cache.get(key);
            if (!shader) {
                let fs = '';
                let vs = basicVertCode;

                if (material.isBasicMaterial) {
                    if (material.isGeometryMaterial) {
                        fs += geometryFragCode;
                    } else {
                        fs += basicFragCode;
                    }
                } else if (material.isPBRMaterial) {
                    fs += pbrFragCode;
                }

                if (material.onBeforeCompile) {
                    const newCode = material.onBeforeCompile(vs, fs);
                    fs = newCode.fs;
                    vs = newCode.vs;
                }

                if (instancedUniforms) {
                    const instancedUniformsReg = new RegExp(`^\\s*uniform\\s+(\\w+)\\s+(${instancedUniforms});`, 'gm');
                    vs = vs.replace(instancedUniformsReg, 'attribute $1 $2;');
                }

                shader = this.getCustomShader(vs, fs, header, key, true);
            }

            if (shader) {
                const shaderNumId = this._getNumId(shader);
                if (shaderNumId !== null) {
                    material._shaderNumId = shaderNumId;
                }
            }
            return shader;
        },
        _getNumId(obj) {
            const id = obj.id;
            const res = id.match(/_(\d+)/);
            if (res && res[1]) {
                return parseInt(res[1], 10);
            }

            return null;
        },
        /**
         * 获取自定义shader
         * @param  {String} vs 顶点代码
         * @param  {String} fs 片段代码
         * @param  {String} [cacheKey] 如果有，会以此值缓存 shader
         * @param  {String} [useHeaderCache=false] 如果cacheKey和useHeaderCache同时存在，使用 cacheKey+useHeaderCache缓存 shader
         * @return {Shader}
         */
        getCustomShader(vs, fs, header, cacheKey, useHeaderCache) {
            const commonHeader = this.commonHeader;
            let shader;
            if (cacheKey) {
                if (useHeaderCache) {
                    cacheKey += ':' + header;
                }
                shader = cache.get(cacheKey);
            }

            if (!shader) {
                shader = new Shader({
                    vs: commonHeader + header + vs,
                    fs: commonHeader + header + fs
                });

                if (cacheKey) {
                    cache.add(cacheKey, shader);
                }
            }

            return shader;
        }
    },

    /**
     * 是否始终使用
     * @default true
     * @type {Boolean}
     */
    alwaysUse: false,

    /**
     * @constructs
     * @param  {Object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        this.id = math.generateUUID(this.className);
        Object.assign(this, params);
    },
    /**
     * 没有被引用时销毁资源
     * @param  {WebGLRenderer} renderer
     * @return {Shader} this
     */
    destroyIfNoRef(renderer) {
        const resourceManager = renderer.resourceManager;
        resourceManager.destroyIfNoRef(this);

        return this;
    },
    /**
     * 销毁资源
     * @return {Shader} this
     */
    destroy() {
        if (this._isDestroyed) {
            return this;
        }
        cache.removeObject(this);

        this._isDestroyed = true;
        return this;
    }
});

export default Shader;
