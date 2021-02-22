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
     * 光照类型，只能为 PBR 或 NONE
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
     * 环境反射(Specular IBL)贴图强度
     * @default 1
     * @type {Number}
     */
    specularEnvIntensity: 1,

    /**
     * 环境反射(Specular IBL)贴图
     * @default null
     * @type {CubeTexture|Texture}
     */
    specularEnvMap: null,

    /**
     * 环境反射是否包含 mipmaps
     * @default false
     * @type {boolean}
     */
    isSpecularEnvMapIncludeMipmaps: false,

    /**
     * 放射光贴图(sRGB 空间)
     * @default null
     * @type {Texture}
     */
    emission: null,

    /**
     * The emissive color of the material.
     * @default new Color(0, 0, 0)
     * @type {Color}
     */
    emissionFactor: null,

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

    /**
     * The clearcoat layer intensity.
     * @default 0
     * @type {number}
     */
    clearcoatFactor: 0,

    /**
     * The clearcoat layer intensity texture.
     * @default null
     * @type {Texture}
     */
    clearcoatMap: null,

    /**
     * The clearcoat layer roughness.
     * @default 0
     * @type {number}
     */
    clearcoatRoughnessFactor: 0,

    /**
     * The clearcoat layer roughness texture.
     * @default null
     * @type {Texture}
     */
    clearcoatRoughnessMap: null,

    /**
     * The clearcoat normal map texture.
     * @default null
     * @type {Texture}
     */
    clearcoatNormalMap: null,

    usedUniformVectors: 11,

    /**
     * @constructs
     * @param {Object} [params] 初始化参数，所有params都会复制到实例上
     * @param {string} [params.lightType=PBR] 光照类型，只能为 PBR 或 NONE
     * @param {Color} [params.baseColor=new Color(1, 1, 1)] 基础颜色
     * @param {Texture} [params.baseColorMap] 基础颜色贴图(sRGB空间)
     * @param {number} [params.metallic=1] 金属度
     * @param {Texture} [params.metallicMap] 金属度贴图
     * @param {number} [params.roughness=1] 粗糙度
     * @param {Texture} [params.roughnessMap] 粗糙度贴图
     * @param {Texture} [params.occlusionMap] 环境光遮蔽贴图
     * @param {number} [params.occlusionStrength=1] 环境光遮蔽强度
     * @param {Texture|Color} [params.emission] 放射光贴图(sRGB 空间)，或颜色
     * @param {Texture} [params.diffuseEnvMap] 漫反射辐照(Diffuse IBL)贴图
     * @param {SphericalHarmonics3} [params.diffuseEnvSphereHarmonics3] 漫反射 SphericalHarmonics3
     * @param {number} [params.diffuseEnvIntensity=1] 漫反射强度
     * @param {Texture} [params.specularEnvMap] 环境反射(Specular IBL)贴图
     * @param {Texture} [params.brdfLUT] BRDF贴图，跟环境反射贴图一起使用
     * @param {number} [params.specularEnvIntensity=1] 环境反射(Specular IBL)贴图强度
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params) {
        this.baseColor = new Color(1, 1, 1);
        this.specular = new Color(1, 1, 1);
        this.emissionFactor = new Color(0, 0, 0);

        PBRMaterial.superclass.constructor.call(this, params);

        Object.assign(this.uniforms, {
            u_baseColor: 'BASECOLOR',
            u_metallic: 'METALLIC',
            u_roughness: 'ROUGHNESS',
            u_specular: 'SPECULAR',
            u_emissionFactor: 'EMISSIONFACTOR',
            u_glossiness: 'GLOSSINESS',
            u_brdfLUT: 'BRDFLUT',
            u_diffuseEnvMap: 'DIFFUSEENVMAP',
            u_diffuseEnvIntensity: 'DIFFUSEENVINTENSITY',
            u_occlusionStrength: 'OCCLUSIONSTRENGTH',
            u_specularEnvMap: 'SPECULARENVMAP',
            u_specularEnvIntensity: 'SPECULARENVINTENSITY',
            u_specularEnvMapMipCount: 'SPECULARENVMAPMIPCOUNT',
            u_diffuseEnvSphereHarmonics3: 'DIFFUSEENVSPHEREHARMONICS3',
            u_clearcoatFactor: 'CLEARCOATFACTOR',
            u_clearcoatRoughnessFactor: 'CLEARCOATROUGHNESSFACTOR',
        });

        this.addTextureUniforms({
            u_baseColorMap: 'BASECOLORMAP',
            u_metallicMap: 'METALLICMAP',
            u_roughnessMap: 'ROUGHNESSMAP',
            u_metallicRoughnessMap: 'METALLICROUGHNESSMAP',
            u_occlusionMap: 'OCCLUSIONMAP',
            u_specularGlossinessMap: 'SPECULARGLOSSINESSMAP',
            u_lightMap: 'LIGHTMAP',
            u_clearcoatMap: 'CLEARCOATMAP',
            u_clearcoatRoughnessMap: 'CLEARCOATROUGHNESSMAP',
            u_clearcoatNormalMap: 'CLEARCOATNORMALMAP',
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

        if (this.specularEnvMap && this.isSpecularEnvMapIncludeMipmaps) {
            option.IS_SPECULAR_ENV_MAP_INCLUDE_MIPMAPS = 1;
        }

        if (this.clearcoatFactor > 0) {
            option.HAS_CLEARCOAT = 1;
            option.HAS_NORMAL = 1;

            if (this.clearcoatMap) {
                textureOption.add(this.clearcoatMap, 'CLEARCOAT_MAP');
            }

            if (this.clearcoatNormalMap) {
                textureOption.add(this.clearcoatNormalMap, 'CLEARCOAT_NORMAL_MAP');
            }

            if (this.clearcoatRoughnessMap) {
                textureOption.add(this.clearcoatRoughnessMap, 'CLEARCOAT_ROUGHNESS_MAP');
            }
        }

        textureOption.update();

        return option;
    }
});

export default PBRMaterial;
