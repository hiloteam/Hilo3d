import Class from '../core/Class';
import math from '../math/math';
import semantic from './semantic';
import log from '../utils/log';
import constants from '../constants';

const {
    LEQUAL,
    BACK,
    FRONT,
    FRONT_AND_BACK,
    ZERO,
    FUNC_ADD,
    ONE,
    SRC_ALPHA,
    ONE_MINUS_SRC_ALPHA
} = constants;

const blankInfo = {
    isBlankInfo: true,
    get() {
        return undefined;
    }
};

/**
 * 材质基类，一般不直接使用
 * @class
 */
const Material = Class.create(/** @lends Material.prototype */ {
    /**
     * @default true
     * @type {boolean}
     */
    isMaterial: true,
    /**
     * @default Material
     * @type {string}
     */
    className: 'Material',
    /**
     * shader cache id
     * @default null
     * @type {String}
     */
    shaderCacheId: null,
    /**
     * 光照类型
     * @default NONE
     * @type {string}
     */
    lightType: 'NONE',

    /**
     * 是否开启网格模式
     * @default false
     * @type {boolean}
     */
    wireframe: false,

    /**
     * 是否开启深度测试
     * @default true
     * @type {boolean}
     */
    depthTest: true,
    /**
     * SAMPLE_ALPHA_TO_COVERAGE
     * @default false
     * @type {Boolean}
     */
    sampleAlphaToCoverage: false,
    /**
     * 是否开启depthMask
     * @default true
     * @type {boolean}
     */
    depthMask: true,
    /**
     * 深度测试Range
     * @default [0, 1]
     * @type {Array}
     */
    depthRange: [0, 1],
    /**
     * 深度测试方法
     * @default LESS
     * @type {GLenum}
     */
    depthFunc: LEQUAL,

    _cullFace: true,

    /**
     * 法线贴图
     * @default null
     * @type {Texture}
     */
    normalMap: null,

    /**
     * 视差贴图
     * @default null
     * @type {Texture}
     */
    parallaxMap: null,

    /**
     * 法线贴图scale
     * @default 1
     * @type {Number}
     */
    normalMapScale: 1,

    /**
     * 是否忽略透明度
     * @type {Boolean}
     * @default false
     */
    ignoreTranparent: false,

    /**
     * 是否开启 gamma 矫正
     * @type {Boolean}
     * @default false
     */
    gammaCorrection: false,

    /**
     * 是否使用物理灯光
     * @type {Boolean}
     * @default false
     */
    usePhysicsLight: false,

    /**
     * 是否环境贴图和环境光同时生效
     * @type {Boolean}
     * @default false
     */
    isDiffuesEnvAndAmbientLightWorkTogether: false,

    /**
     * 渲染顺序数字小的先渲染（透明物体和不透明在不同的队列）
     * @default 0
     * @type {Number}
     */
    renderOrder: 0,
    _premultiplyAlpha: true,
    /**
     * 是否预乘 alpha
     * @type {Boolean}
     * @default true
     */
    premultiplyAlpha: {
        get() {
            return this._premultiplyAlpha;
        },
        set(value) {
            this._premultiplyAlpha = value;
            if (this.transparent) {
                this.setDefaultTransparentBlend();
            }
        }
    },

    /**
     * gammaOutput
     * @type {Boolean}
     * @deprecated
     * @default false
     */
    gammaOutput: {
        get() {
            log.warnOnce('Matrial.gammaOutput', 'material.gammaOutput has deprecated. Use material.gammaCorrection instead.');
            return this.gammaCorrection;
        },
        set(value) {
            log.warnOnce('Matrial.gammaOutput', 'material.gammaOutput has deprecated. Use material.gammaCorrection instead.');
            this.gammaCorrection = value;
        }
    },

    /**
     * gamma值
     * @type {Number}
     * @default 2.2
     */
    gammaFactor: 2.2,

    /**
     * 是否投射阴影
     * @type {Boolean}
     * @default true
     */
    castShadows: true,

    /**
     * 是否接受阴影
     * @type {Boolean}
     * @default true
     */
    receiveShadows: true,

    /**
     * uv transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     * @type {Matrix3}
     */
    uvMatrix: null,

    /**
     * uv1 transform eg:new Matrix3().fromRotationTranslationScale(Math.PI/2, 0, 0, 2, 2)
     * @type {Matrix3}
     */
    uvMatrix1: null,

    /**
     * 是否开启 CullFace
     * @default true
     * @type {boolean}
     */
    cullFace: {
        get() {
            return this._cullFace;
        },
        set(value) {
            this._cullFace = value;
            if (value) {
                this.cullFaceType = this._cullFaceType;
            } else {
                this._side = FRONT_AND_BACK;
            }
        }
    },

    _cullFaceType: BACK,
    /**
     * CullFace 类型
     * @default BACK
     * @type {GLenum}
     */
    cullFaceType: {
        get() {
            return this._cullFaceType;
        },
        set(value) {
            this._cullFaceType = value;
            if (this._cullFace) {
                if (value === BACK) {
                    this._side = FRONT;
                } else if (value === FRONT) {
                    this._side = BACK;
                }
            }
        }
    },

    _side: FRONT,
    /**
     * 显示面，可选值 FRONT, BACK, FRONT_AND_BACK
     * @type {GLenum}
     * @default FRONT
     */
    side: {
        get() {
            return this._side;
        },
        set(value) {
            if (this._side !== value) {
                this._side = value;
                if (value === FRONT_AND_BACK) {
                    this._cullFace = false;
                } else {
                    this._cullFace = true;
                    if (value === FRONT) {
                        this._cullFaceType = BACK;
                    } else if (value === BACK) {
                        this._cullFaceType = FRONT;
                    }
                }
            }
        }
    },

    /**
     * 是否开启颜色混合
     * @default false
     * @type {boolean}
     */
    blend: false,
    /**
     * 颜色混合方式
     * @default FUNC_ADD
     * @type {GLenum}
     */
    blendEquation: FUNC_ADD,
    /**
     * 透明度混合方式
     * @default FUNC_ADD
     * @type {GLenum}
     */
    blendEquationAlpha: FUNC_ADD,
    /**
     * 颜色混合来源比例
     * @default ONE
     * @type {GLenum}
     */
    blendSrc: ONE,
    /**
     * 颜色混合目标比例
     * @default ZERO
     * @type {GLenum}
     */
    blendDst: ZERO,
    /**
     * 透明度混合来源比例
     * @default ONE
     * @type {GLenum}
     */
    blendSrcAlpha: ONE,
    /**
     * 透明度混合目标比例
     * @default ONE
     * @type {GLenum}
     */
    blendDstAlpha: ZERO,

    /**
     * 当前是否需要强制更新
     * @default false
     * @type {boolean}
     */
    isDirty: false,

    /**
     * 透明度 0~1
     * @default 1
     * @type {number}
     */
    transparency: 1,

    _transparent: false,
    /**
     * 是否需要透明
     * @default false
     * @type {boolean}
     */
    transparent: {
        get() {
            return this._transparent;
        },
        set(value) {
            if (this._transparent !== value) {
                this._transparent = value;
                if (!value) {
                    this.blend = false;
                    this.depthMask = true;
                } else {
                    this.setDefaultTransparentBlend();
                }
            }
        }
    },
    setDefaultTransparentBlend() {
        this.blend = true;
        this.depthMask = false;
        if (this.premultiplyAlpha) {
            this.blendSrc = ONE;
            this.blendDst = ONE_MINUS_SRC_ALPHA;
            this.blendSrcAlpha = ONE;
            this.blendDstAlpha = ONE_MINUS_SRC_ALPHA;
        } else {
            this.blendSrc = SRC_ALPHA;
            this.blendDst = ONE_MINUS_SRC_ALPHA;
            this.blendSrcAlpha = SRC_ALPHA;
            this.blendDstAlpha = ONE_MINUS_SRC_ALPHA;
        }
    },
    /**
     * 透明度剪裁，如果渲染的颜色透明度大于等于这个值的话渲染为完全不透明，否则渲染为完全透明
     * @default 0
     * @type {number}
     */
    alphaCutoff: 0,

    /**
     * 是否使用HDR
     * @default false
     * @type {Boolean}
     */
    useHDR: false,

    /**
     * 曝光度，仅在 useHDR 为 true 时生效
     * @default 1
     * @type {Number}
     */
    exposure: 1,

    /**
     * 是否需要加基础 uniforms
     * @type {Boolean}
     * @default true
     */
    needBasicUnifroms: true,
    /**
     * 是否需要加基础 attributes
     * @type {Boolean}
     * @default true
     */
    needBasicAttributes: true,

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        /**
         * @type {string}
         */
        this.id = math.generateUUID(this.className);
        /**
         * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
         * @default {}
         * @type {object}
         */
        this.uniforms = {};

        /**
         * 可以通过指定，semantic来指定值的获取方式，或者自定义get方法
         * @default {}
         * @type {object}
         */
        this.attributes = {};

        Object.assign(this, params);

        if (this.needBasicAttributes) {
            this.addBasicAttributes();
        }

        if (this.needBasicUnifroms) {
            this.addBasicUniforms();
        }
    },
    /**
     * 增加基础 attributes
     */
    addBasicAttributes() {
        const attributes = this.attributes;
        this._copyProps(attributes, {
            a_position: 'POSITION',
            a_normal: 'NORMAL',
            a_tangent: 'TANGENT',
            a_texcoord0: 'TEXCOORD_0',
            a_texcoord1: 'TEXCOORD_1',
            a_color: 'COLOR_0',
            a_skinIndices: 'SKININDICES',
            a_skinWeights: 'SKINWEIGHTS'
        });

        ['POSITION', 'NORMAL', 'TANGENT'].forEach((name) => {
            const camelName = name.slice(0, 1) + name.slice(1).toLowerCase();
            for (let i = 0; i < 8; i++) {
                const morphAttributeName = 'a_morph' + camelName + i;
                if (attributes[morphAttributeName] === undefined) {
                    attributes[morphAttributeName] = 'MORPH' + name + i;
                }
            }
        });
    },
    /**
     * 增加基础 uniforms
     */
    addBasicUniforms() {
        this._copyProps(this.uniforms, {
            u_modelMatrix: 'MODEL',
            u_viewMatrix: 'VIEW',
            u_projectionMatrix: 'PROJECTION',
            u_modelViewMatrix: 'MODELVIEW',
            u_modelViewProjectionMatrix: 'MODELVIEWPROJECTION',
            u_viewInverseNormalMatrix: 'VIEWINVERSEINVERSETRANSPOSE',
            u_normalMatrix: 'MODELVIEWINVERSETRANSPOSE',
            u_normalWorldMatrix: 'MODELINVERSETRANSPOSE',
            u_cameraPosition: 'CAMERAPOSITION',
            u_rendererSize: 'RENDERERSIZE',
            u_logDepth: 'LOGDEPTH',

            // light
            u_ambientLightsColor: 'AMBIENTLIGHTSCOLOR',
            u_directionalLightsColor: 'DIRECTIONALLIGHTSCOLOR',
            u_directionalLightsInfo: 'DIRECTIONALLIGHTSINFO',
            u_directionalLightsShadowMap: 'DIRECTIONALLIGHTSSHADOWMAP',
            u_directionalLightsShadowMapSize: 'DIRECTIONALLIGHTSSHADOWMAPSIZE',
            u_directionalLightsShadowBias: 'DIRECTIONALLIGHTSSHADOWBIAS',
            u_directionalLightSpaceMatrix: 'DIRECTIONALLIGHTSPACEMATRIX',
            u_pointLightsPos: 'POINTLIGHTSPOS',
            u_pointLightsColor: 'POINTLIGHTSCOLOR',
            u_pointLightsInfo: 'POINTLIGHTSINFO',
            u_pointLightsRange: 'POINTLIGHTSRANGE',
            u_pointLightsShadowBias: 'POINTLIGHTSSHADOWBIAS',
            u_pointLightsShadowMap: 'POINTLIGHTSSHADOWMAP',
            u_pointLightSpaceMatrix: 'POINTLIGHTSPACEMATRIX',
            u_pointLightCamera: 'POINTLIGHTCAMERA',
            u_spotLightsPos: 'SPOTLIGHTSPOS',
            u_spotLightsDir: 'SPOTLIGHTSDIR',
            u_spotLightsColor: 'SPOTLIGHTSCOLOR',
            u_spotLightsCutoffs: 'SPOTLIGHTSCUTOFFS',
            u_spotLightsInfo: 'SPOTLIGHTSINFO',
            u_spotLightsRange: 'SPOTLIGHTSRANGE',
            u_spotLightsShadowMap: 'SPOTLIGHTSSHADOWMAP',
            u_spotLightsShadowMapSize: 'SPOTLIGHTSSHADOWMAPSIZE',
            u_spotLightsShadowBias: 'SPOTLIGHTSSHADOWBIAS',
            u_spotLightSpaceMatrix: 'SPOTLIGHTSPACEMATRIX',
            u_areaLightsPos: 'AREALIGHTSPOS',
            u_areaLightsColor: 'AREALIGHTSCOLOR',
            u_areaLightsWidth: 'AREALIGHTSWIDTH',
            u_areaLightsHeight: 'AREALIGHTSHEIGHT',
            u_areaLightsLtcTexture1: 'AREALIGHTSLTCTEXTURE1',
            u_areaLightsLtcTexture2: 'AREALIGHTSLTCTEXTURE2',

            // joint
            u_jointMat: 'JOINTMATRIX',
            u_jointMatTexture: 'JOINTMATRIXTEXTURE',
            u_jointMatTextureSize: 'JOINTMATRIXTEXTURESIZE',

            // quantization
            u_positionDecodeMat: 'POSITIONDECODEMAT',
            u_normalDecodeMat: 'NORMALDECODEMAT',
            u_uvDecodeMat: 'UVDECODEMAT',
            u_uv1DecodeMat: 'UV1DECODEMAT',

            // morph
            u_morphWeights: 'MORPHWEIGHTS',
            u_normalMapScale: 'NORMALMAPSCALE',
            u_emission: 'EMISSION',
            u_transparency: 'TRANSPARENCY',

            // uv matrix
            u_uvMatrix: 'UVMATRIX_0',
            u_uvMatrix1: 'UVMATRIX_1',

            // other info
            u_fogColor: 'FOGCOLOR',
            u_fogInfo: 'FOGINFO',
            u_alphaCutoff: 'ALPHACUTOFF',
            u_exposure: 'EXPOSURE',
            u_gammaFactor: 'GAMMAFACTOR',
        });

        this.addTextureUniforms({
            u_normalMap: 'NORMALMAP',
            u_parallaxMap: 'PARALLAXMAP',
            u_emission: 'EMISSION',
            u_transparency: 'TRANSPARENCY'
        });
    },
    /**
     * 增加贴图 uniforms
     * @param {Object} textureUniforms textureName:semanticName 键值对
     */
    addTextureUniforms(textureUniforms) {
        const uniforms = {};

        for (const uniformName in textureUniforms) {
            const semanticName = textureUniforms[uniformName];
            uniforms[uniformName] = semanticName;
            uniforms[`${uniformName}.texture`] = semanticName;
            uniforms[`${uniformName}.uv`] = `${semanticName}UV`;
        }
        this._copyProps(this.uniforms, uniforms);
    },
    /**
     * 获取渲染选项值
     * @param  {Object} [option={}] 渲染选项值
     * @return {Object} 渲染选项值
     */
    getRenderOption(option = {}) {
        const lightType = this.lightType;
        option[`LIGHT_TYPE_${lightType}`] = 1;
        option.SIDE = this.side;

        if (lightType !== 'NONE') {
            option.HAS_LIGHT = 1;
        }

        if (this.premultiplyAlpha) {
            option.PREMULTIPLY_ALPHA = 1;
        }

        const textureOption = this._textureOption.reset(option);

        if (option.HAS_LIGHT) {
            option.HAS_NORMAL = 1;
            textureOption.add(this.normalMap, 'NORMAL_MAP', () => {
                if (this.normalMapScale !== 1) {
                    option.NORMAL_MAP_SCALE = 1;
                }
            });
        }

        textureOption.add(this.parallaxMap, 'PARALLAX_MAP');
        textureOption.add(this.emission, 'EMISSION_MAP');
        textureOption.add(this.transparency, 'TRANSPARENCY_MAP');

        if (this.ignoreTranparent) {
            option.IGNORE_TRANSPARENT = 1;
        }

        if (this.alphaCutoff > 0) {
            option.ALPHA_CUTOFF = 1;
        }

        if (this.useHDR) {
            option.USE_HDR = 1;
        }

        if (this.gammaCorrection) {
            option.GAMMA_CORRECTION = 1;
        }

        if (this.receiveShadows) {
            option.RECEIVE_SHADOWS = 1;
        }

        if (this.castShadows) {
            option.CAST_SHADOWS = 1;
        }

        if (this.uvMatrix) {
            option.UV_MATRIX = 1;
        }

        if (this.uvMatrix1) {
            option.UV_MATRIX1 = 1;
        }

        if (this.usePhysicsLight) {
            option.USE_PHYSICS_LIGHT = 1;
        }

        if (this.isDiffuesEnvAndAmbientLightWorkTogether) {
            option.IS_DIFFUESENV_AND_AMBIENTLIGHT_WORK_TOGETHER = 1;
        }

        textureOption.update();
        return option;
    },
    _textureOption: {
        uvTypes: null,
        option: null,
        reset(option) {
            this.option = option;
            this.uvTypes = {};
            return this;
        },
        add(texture, optionName, callback) {
            if (texture && texture.isTexture) {
                const {
                    uvTypes,
                    option
                } = this;

                const uv = texture.uv || 0;
                uvTypes[uv] = 1;
                option[optionName] = uv;

                if (texture.isCubeTexture) {
                    option[`${optionName}_CUBE`] = 1;
                }

                if (callback) {
                    callback(texture);
                }
            }

            return this;
        },
        update() {
            const supportUV = [0, 1];
            const {
                uvTypes,
                option
            } = this;

            for (const type in uvTypes) {
                if (supportUV.indexOf(Number(type)) !== -1) {
                    option[`HAS_TEXCOORD${type}`] = 1;
                } else {
                    log.warnOnce(`Material._textureOption.update(${type})`, `uv_${type} not support!`);
                    option.HAS_TEXCOORD0 = 1;
                }
            }

            return this;
        }
    },

    /**
     * 获取 instanced uniforms
     * @private
     * @return {Object}
     */
    getInstancedUniforms() {
        let instancedUniforms = this._instancedUniforms;
        if (!this._instancedUniforms) {
            const uniforms = this.uniforms;
            instancedUniforms = this._instancedUniforms = [];
            for (let name in uniforms) {
                const info = this.getUniformInfo(name);
                if (info.isDependMesh && !info.notSupportInstanced) {
                    instancedUniforms.push({
                        name,
                        info
                    });
                }
            }
        }

        return instancedUniforms;
    },
    getUniformData(name, mesh, programInfo) {
        return this.getUniformInfo(name).get(mesh, this, programInfo);
    },
    getAttributeData(name, mesh, programInfo) {
        return this.getAttributeInfo(name).get(mesh, this, programInfo);
    },
    getUniformInfo(name) {
        return this.getInfo('uniforms', name);
    },
    getAttributeInfo(name) {
        return this.getInfo('attributes', name);
    },
    getInfo(dataType, name) {
        const dataDict = this[dataType];
        let info = dataDict[name];
        if (typeof info === 'string') {
            info = semantic[info];
        }

        if (!info || !info.get) {
            log.warnOnce('material.getInfo-' + name, 'Material.getInfo: no this semantic:' + name);
            info = blankInfo;
        }

        return info;
    },
    /**
     * clone 当前Material
     * @return {Material} 返回clone的Material
     */
    clone() {
        const newMaterial = new this.constructor();
        for (let key in this) {
            if (key !== 'id') {
                newMaterial[key] = this[key];
            }
        }
        return newMaterial;
    },
    /**
     * 销毁贴图
     * @return {Material} this
     */
    destroyTextures() {
        this.getTextures().forEach((texture) => {
            texture.destroy();
        });
    },
    /**
     * 获取材质全部贴图
     * @return {Texture[]}
     */
    getTextures() {
        const textures = [];
        for (const propName in this) {
            const texture = this[propName];
            if (texture && texture.isTexture) {
                textures.push(texture);
            }
        }

        return textures;
    },
    /**
     * 复制属性，只有没属性时才会覆盖
     * @private
     * @param  {Object} origin
     * @param  {Object} data
     */
    _copyProps(origin, data) {
        for (const key in data) {
            if (origin[key] === undefined) {
                origin[key] = data[key];
            }
        }
    }
});

export default Material;
