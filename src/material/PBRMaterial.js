import Class from '../core/Class';
import Color from '../math/Color';
import Material from './Material';
import capabilities from '../renderer/capabilities';

/**
 * PBR材质
 * @class
 * @extends Material
 * @example
 * const material = new Hilo3d.PBRMaterial();
 */
const PBRMaterial = Class.create(/** @lends PBRMaterial.prototype */ {
    Extends: Material,

    /**
     * @default true
     * @type {boolean}
     */
    isPBRMaterial: true,

    /**
     * @default PBRMaterial
     * @type {string}
     */
    className: 'PBRMaterial',

    /**
     * 光照类型，只能为 PBR
     * @default PBR
     * @readOnly
     * @type {string}
     */
    lightType: 'PBR',

    /**
     * gammaCorrection
     * @type {Boolean}
     * @default true
     */
    gammaCorrection: true,

    /**
     * 是否使用物理灯光
     * @type {Boolean}
     * @default true
     */
    usePhysicsLight: true,

    /**
     * 基础颜色
     * @default null
     * @type {Color}
     */
    baseColor: null,

    /**
     * 基础颜色贴图(sRGB空间)
     * @default null
     * @type {Texture}
     */
    baseColorMap: null,

    /**
     * 金属度
     * @default 1
     * @type {Number}
     */
    metallic: 1,

    /**
     * 金属度贴图
     * @default null
     * @type {Texture}
     */
    metallicMap: null,

    /**
     * 粗糙度
     * @default 1
     * @type {Number}
     */
    roughness: 1,

    /**
     * 粗糙度贴图
     * @default null
     * @type {Texture}
     */
    roughnessMap: null,

    /**
     * 金属度及粗糙度贴图，金属度为B通道，粗糙度为G通道，可以指定R通道作为环境光遮蔽
     * @default null
     * @type {Texture}
     */
    metallicRoughnessMap: null,

    /**
     * 环境光遮蔽贴图
     * @default null
     * @type {Texture}
     */
    occlusionMap: null,
    /**
     * 环境光遮蔽强度
     * @default 1
     * @type {Number}
     */
    occlusionStrength: 1,

    /**
     * 环境光遮蔽贴图(occlusionMap)包含在 metallicRoughnessMap 的R通道中
     * @default false
     * @type {boolean}
     */
    isOcclusionInMetallicRoughnessMap: false,

    /**
     * 漫反射辐照(Diffuse IBL)贴图
     * @default null
     * @type {CubeTexture|Texture}
     */
    diffuseEnvMap: null,
    /**
     * 漫反射 SphericalHarmonics3
     * @type {SphericalHarmonics3}
     */
    diffuseEnvSphereHarmonics3: null,

    /**
     * 漫反射环境强度
     * @default 1
     * @type {Number}
     */
    diffuseEnvIntensity: 1,

    /**
     * BRDF贴图，跟环境反射贴图一起使用 [示例]{@link https://gw.alicdn.com/tfs/TB1EvwBRFXXXXbNXpXXXXXXXXXX-256-256.png}
     * @default null
     * @type {Texture}
     */
    brdfLUT: null,

    /**
     * 环境反射(Specular IBL)贴图
     * @default 1
     * @type {Number}
     */
    specularEnvIntensity: 1,

    /**
     * 环境反射(Specular IBL)贴图
     * @default null
     * @type {CubeTexture|Texture}
     */
    specularEnv: null,

    /**
     * 放射光贴图(sRGB 空间)，或颜色
     * @default Color(0, 0, 0)
     * @type {Texture|Color}
     */
    emission: null,

    /**
     * 是否基于反射光泽度的 PBR，具体见 [KHR_materials_pbrSpecularGlossiness]{@link https://github.com/KhronosGroup/glTF/tree/master/extensions/Khronos/KHR_materials_pbrSpecularGlossiness}
     * @default false
     * @type {boolean}
     */
    isSpecularGlossiness: false,

    /**
     * 镜面反射率，针对 isSpecularGlossiness 渲染
     * @default Color(1, 1, 1)
     * @type {Color}
     */
    specular: null,

    /**
     * 光泽度，针对 isSpecularGlossiness 渲染，默认PBR无效
     * @default 1
     * @type {number}
     */
    glossiness: 1,

    /**
     * 镜面反射即光泽度贴图，RGB 通道为镜面反射率，A 通道为光泽度
     * @default null
     * @type {Texture}
     */
    specularGlossinessMap: null,


    usedUniformVectors: 11,

    /**
     * @constructs
     * @param {object} params 初始化参数，所有params都会复制到实例上
     */
    constructor(params) {
        this.baseColor = new Color(1, 1, 1);
        this.specular = new Color(1, 1, 1);

        PBRMaterial.superclass.constructor.call(this, params);

        Object.assign(this.uniforms, {
            u_baseColor: 'BASECOLOR',
            u_metallic: 'METALLIC',
            u_roughness: 'ROUGHNESS',
            u_specular: 'SPECULAR',
            u_glossiness: 'GLOSSINESS',
            u_brdfLUT: 'BRDFLUT',
            u_diffuseEnvMap: 'DIFFUSEENVMAP',
            u_diffuseEnvIntensity: 'DIFFUSEENVINTENSITY',
            u_occlusionStrength: 'OCCLUSIONSTRENGTH',
            u_specularEnvMap: 'SPECULARENVMAP',
            u_specularEnvIntensity: 'SPECULARENVINTENSITY',
            u_specularEnvMapMipCount: 'SPECULARENVMAPMIPCOUNT',
            u_diffuseEnvSphereHarmonics3: 'DIFFUSEENVSPHEREHARMONICS3'
        });

        this.addTextureUniforms({
            u_baseColorMap: 'BASECOLORMAP',
            u_metallicMap: 'METALLICMAP',
            u_roughnessMap: 'ROUGHNESSMAP',
            u_metallicRoughnessMap: 'METALLICROUGHNESSMAP',
            u_occlusionMap: 'OCCLUSIONMAP',
            u_specularGlossinessMap: 'SPECULARGLOSSINESSMAP',
            u_lightMap: 'LIGHTMAP'
        });
    },
    getRenderOption(option = {}) {
        PBRMaterial.superclass.getRenderOption.call(this, option);
        const textureOption = this._textureOption.reset(option);

        textureOption.add(this.baseColorMap, 'BASE_COLOR_MAP');
        textureOption.add(this.metallicMap, 'METALLIC_MAP');
        textureOption.add(this.roughnessMap, 'ROUGHNESS_MAP');
        textureOption.add(this.metallicRoughnessMap, 'METALLIC_ROUGHNESS_MAP');
        textureOption.add(this.diffuseEnvMap, 'DIFFUSE_ENV_MAP');
        textureOption.add(this.occlusionMap, 'OCCLUSION_MAP');
        textureOption.add(this.lightMap, 'LIGHT_MAP');

        if (this.brdfLUT) {
            textureOption.add(this.specularEnvMap, 'SPECULAR_ENV_MAP');

            if (capabilities.SHADER_TEXTURE_LOD && this.specularEnvMap) {
                option.USE_SHADER_TEXTURE_LOD = 1;
            }
        }

        if (this.isSpecularGlossiness) {
            option.PBR_SPECULAR_GLOSSINESS = 1;
            textureOption.add(this.specularGlossinessMap, 'SPECULAR_GLOSSINESS_MAP');
        }

        if (this.isOcclusionInMetallicRoughnessMap) {
            option.IS_OCCLUSION_MAP_IN_METALLIC_ROUGHNESS_MAP = 1;
        }

        if (this.occlusionStrength !== 1) {
            option.OCCLUSION_STRENGTH = 1;
        }

        if (this.diffuseEnvSphereHarmonics3) {
            option.HAS_NORMAL = 1;
            option.DIFFUSE_ENV_SPHERE_HARMONICS3 = 1;
        }

        if (this.specularEnvMap || this.diffuseEnvSphereHarmonics3 || this.specularEnvMap) {
            option.NEED_WORLD_NORMAL = 1;
        }

        textureOption.update();

        return option;
    }
});

export default PBRMaterial;
