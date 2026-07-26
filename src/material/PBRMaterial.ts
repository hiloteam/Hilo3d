import Color from '../math/Color';
import type SphericalHarmonics3 from '../math/SphericalHarmonics3';
import type Texture from '../texture/Texture';
import Material, {
    type MaterialParameters,
    type MaterialTexture,
    type MaterialTextureValue
} from './Material';
import type { ShaderOptions } from '../render/types';

export interface PBRMaterialParameters extends MaterialParameters {
    lightType?: 'PBR' | 'NONE';
    baseColor?: Color;
    baseColorMap?: Texture | null;
    metallic?: number;
    metallicMap?: Texture | null;
    roughness?: number;
    roughnessMap?: Texture | null;
    metallicRoughnessMap?: Texture | null;
    occlusionMap?: Texture | null;
    occlusionStrength?: number;
    isOcclusionInMetallicRoughnessMap?: boolean;
    diffuseEnvMap?: MaterialTexture | null;
    diffuseEnvSphereHarmonics3?: SphericalHarmonics3 | null;
    diffuseEnvIntensity?: number;
    brdfLUT?: Texture | null;
    specularEnvIntensity?: number;
    specularEnvMap?: MaterialTexture | null;
    isSpecularEnvMapIncludeMipmaps?: boolean;
    emission?: MaterialTextureValue;
    emissionFactor?: Color;
    isSpecularGlossiness?: boolean;
    specular?: Color;
    glossiness?: number;
    specularGlossinessMap?: Texture | null;
    lightMap?: Texture | null;
    clearcoatFactor?: number;
    clearcoatMap?: Texture | null;
    clearcoatRoughnessFactor?: number;
    clearcoatRoughnessMap?: Texture | null;
    clearcoatNormalMap?: Texture | null;
    clearcoatNormalScale?: number;
    anisotropyStrength?: number;
    anisotropyRotation?: number;
    anisotropyMap?: Texture | null;
    transmissionFactor?: number;
    transmissionMap?: Texture | null;
    thicknessFactor?: number;
    thicknessMap?: Texture | null;
    attenuationDistance?: number;
    attenuationColor?: Color;
    ior?: number;
    iridescenceFactor?: number;
    iridescenceMap?: Texture | null;
    iridescenceIor?: number;
    iridescenceThicknessMinimum?: number;
    iridescenceThicknessMaximum?: number;
    iridescenceThicknessMap?: Texture | null;
}
/**
 * PBR材质
 * @example
 * ```ts
 * const material = new Hilo3d.PBRMaterial();
 * ```
 */
class PBRMaterial extends Material {
    isPBRMaterial = true;
    override readonly className: string = 'PBRMaterial';
    /**
     * 光照类型，只能为 PBR 或 NONE
     */
    override lightType: 'PBR' | 'NONE' = 'PBR';
    /**
     * gammaCorrection
     */
    override gammaCorrection = true;
    /**
     * 是否使用物理灯光
     */
    override usePhysicsLight = true;
    /**
     * 基础颜色
     */
    baseColor: Color = new Color(1, 1, 1);
    /**
     * 基础颜色贴图(sRGB空间)
     */
    baseColorMap: Texture | null = null;
    /**
     * 金属度
     */
    metallic = 1;
    /**
     * 金属度贴图
     */
    metallicMap: Texture | null = null;
    /**
     * 粗糙度
     */
    roughness = 1;
    /**
     * 粗糙度贴图
     */
    roughnessMap: Texture | null = null;
    /**
     * 金属度及粗糙度贴图，金属度为B通道，粗糙度为G通道，可以指定R通道作为环境光遮蔽
     */
    metallicRoughnessMap: Texture | null = null;
    /**
     * 环境光遮蔽贴图
     */
    occlusionMap: Texture | null = null;
    /**
     * 环境光遮蔽强度
     */
    occlusionStrength = 1;
    /**
     * 环境光遮蔽贴图(occlusionMap)包含在 metallicRoughnessMap 的R通道中
     */
    isOcclusionInMetallicRoughnessMap = false;
    /**
     * 漫反射辐照(Diffuse IBL)贴图
     */
    diffuseEnvMap: MaterialTexture | null = null;
    /**
     * 漫反射 SphericalHarmonics3
     */
    diffuseEnvSphereHarmonics3: SphericalHarmonics3 | null = null;
    /**
     * 漫反射环境强度
     */
    diffuseEnvIntensity = 1;
    /**
     * BRDF lookup texture used with an environment reflection map.
     */
    brdfLUT: Texture | null = null;
    /**
     * 环境反射(Specular IBL)贴图强度
     */
    specularEnvIntensity = 1;
    /**
     * 环境反射(Specular IBL)贴图
     */
    specularEnvMap: MaterialTexture | null = null;
    /**
     * 环境反射是否包含 mipmaps
     */
    isSpecularEnvMapIncludeMipmaps = false;
    /**
     * 放射光贴图(sRGB 空间)
     */
    override emission: MaterialTextureValue = null;
    /**
     * The emissive color of the material.
     */
    emissionFactor: Color = new Color(0, 0, 0);
    /**
     * 是否基于反射光泽度的 PBR，具体见 [KHR_materials_pbrSpecularGlossiness]{@link https://github.com/KhronosGroup/glTF/tree/master/extensions/Khronos/KHR_materials_pbrSpecularGlossiness}
     */
    isSpecularGlossiness = false;
    /**
     * 镜面反射率，针对 isSpecularGlossiness 渲染
     */
    specular: Color = new Color(1, 1, 1);
    /**
     * 光泽度，针对 isSpecularGlossiness 渲染，默认PBR无效
     */
    glossiness = 1;
    /**
     * 镜面反射即光泽度贴图，RGB 通道为镜面反射率，A 通道为光泽度
     */
    specularGlossinessMap: Texture | null = null;
    lightMap: Texture | null = null;
    /**
     * The clearcoat layer intensity.
     */
    clearcoatFactor = 0;
    /**
     * The clearcoat layer intensity texture.
     */
    clearcoatMap: Texture | null = null;
    /**
     * The clearcoat layer roughness.
     */
    clearcoatRoughnessFactor = 0;
    /**
     * The clearcoat layer roughness texture.
     */
    clearcoatRoughnessMap: Texture | null = null;
    /**
     * The clearcoat normal map texture.
     */
    clearcoatNormalMap: Texture | null = null;
    /** Scale applied to the clearcoat normal texture XY channels. */
    clearcoatNormalScale = 1;
    /** Strength of the anisotropic GGX lobe in the range [0, 1]. */
    anisotropyStrength = 0;
    /** Counter-clockwise anisotropy direction rotation in tangent space, in radians. */
    anisotropyRotation = 0;
    /** RG tangent-space direction and B strength texture from KHR_materials_anisotropy. */
    anisotropyMap: Texture | null = null;
    private _transmissionFactor = 0;
    /** Thin-surface transmission fraction in the range [0, 1]. */
    get transmissionFactor(): number {
        return this._transmissionFactor;
    }
    set transmissionFactor(value: number) {
        this._transmissionFactor = value;
        if (value > 0) this.transparent = true;
    }
    /** Linear R-channel transmission texture. */
    transmissionMap: Texture | null = null;
    /** Maximum volume thickness in scene units. */
    thicknessFactor = 0;
    /** Linear G-channel thickness texture. */
    thicknessMap: Texture | null = null;
    /** Beer-Lambert attenuation distance; positive infinity disables attenuation. */
    attenuationDistance = Number.POSITIVE_INFINITY;
    /** Linear attenuation color reached after {@link PBRMaterial.attenuationDistance}. */
    attenuationColor: Color = new Color(1, 1, 1);
    /** Index of refraction used by screen-space volume refraction. */
    ior = 1.5;
    /** Thin-film iridescence intensity in the range [0, 1]. */
    iridescenceFactor = 0;
    /** Linear R-channel thin-film intensity texture. */
    iridescenceMap: Texture | null = null;
    /** Index of refraction of the thin-film layer. */
    iridescenceIor = 1.3;
    /** Thin-film thickness represented by a zero texture sample, in nanometers. */
    iridescenceThicknessMinimum = 100;
    /** Thin-film thickness represented by a one texture sample, in nanometers. */
    iridescenceThicknessMaximum = 400;
    /** Linear G-channel thin-film thickness texture. */
    iridescenceThicknessMap: Texture | null = null;
    usedUniformVectors = 16;
    /**
     * @param params - 初始化参数，所有params都会复制到实例上
     * - `params.lightType`: 光照类型，只能为 PBR 或 NONE
     * - `params.baseColor`: 基础颜色
     * - `params.baseColorMap`: 基础颜色贴图(sRGB空间)
     * - `params.metallic`: 金属度
     * - `params.metallicMap`: 金属度贴图
     * - `params.roughness`: 粗糙度
     * - `params.roughnessMap`: 粗糙度贴图
     * - `params.occlusionMap`: 环境光遮蔽贴图
     * - `params.occlusionStrength`: 环境光遮蔽强度
     * - `params.emission`: 放射光贴图(sRGB 空间)，或颜色
     * - `params.diffuseEnvMap`: 漫反射辐照(Diffuse IBL)贴图
     * - `params.diffuseEnvSphereHarmonics3`: 漫反射 SphericalHarmonics3
     * - `params.diffuseEnvIntensity`: 漫反射强度
     * - `params.specularEnvMap`: 环境反射(Specular IBL)贴图
     * - `params.brdfLUT`: BRDF贴图，跟环境反射贴图一起使用
     * - `params.specularEnvIntensity`: 环境反射(Specular IBL)贴图强度
     */
    constructor(params: PBRMaterialParameters = {}) {
        super({}, false);
        Object.assign(this, params);
        this.initializeBindings();
        Object.assign(this.uniforms, {
            u_baseColor: 'BASECOLOR',
            u_metallic: 'METALLIC',
            u_roughness: 'ROUGHNESS',
            u_specularColor: 'SPECULAR',
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
            u_clearcoatNormalScale: 'CLEARCOATNORMALSCALE',
            u_anisotropyStrength: 'ANISOTROPYSTRENGTH',
            u_anisotropyRotation: 'ANISOTROPYROTATION',
            u_transmissionFactor: 'TRANSMISSIONFACTOR',
            u_thicknessFactor: 'THICKNESSFACTOR',
            u_attenuationDistance: 'ATTENUATIONDISTANCE',
            u_attenuationColor: 'ATTENUATIONCOLOR',
            u_ior: 'IOR',
            u_iridescenceFactor: 'IRIDESCENCEFACTOR',
            u_iridescenceIor: 'IRIDESCENCEIOR',
            u_iridescenceThicknessMinimum: 'IRIDESCENCETHICKNESSMINIMUM',
            u_iridescenceThicknessMaximum: 'IRIDESCENCETHICKNESSMAXIMUM',
            u_opaqueTexture: 'OPAQUETEXTURE'
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
            u_anisotropyMap: 'ANISOTROPYMAP',
            u_transmissionMap: 'TRANSMISSIONMAP',
            u_thicknessMap: 'THICKNESSMAP',
            u_iridescenceMap: 'IRIDESCENCEMAP',
            u_iridescenceThicknessMap: 'IRIDESCENCETHICKNESSMAP'
        });
    }
    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        super.getRenderOption(option);
        const textureOption = this.textureOption.reset(option);
        textureOption.add(this.baseColorMap, 'BASE_COLOR_MAP');
        textureOption.add(this.metallicMap, 'METALLIC_MAP');
        textureOption.add(this.roughnessMap, 'ROUGHNESS_MAP');
        textureOption.add(this.metallicRoughnessMap, 'METALLIC_ROUGHNESS_MAP');
        textureOption.add(this.diffuseEnvMap, 'DIFFUSE_ENV_MAP');
        textureOption.add(this.occlusionMap, 'OCCLUSION_MAP');
        textureOption.add(this.lightMap, 'LIGHT_MAP');
        if (this.brdfLUT) {
            textureOption.add(this.specularEnvMap, 'SPECULAR_ENV_MAP');
            if (this.specularEnvMap) {
                option['USE_SHADER_TEXTURE_LOD'] = 1;
            }
        }
        if (this.isSpecularGlossiness) {
            option['PBR_SPECULAR_GLOSSINESS'] = 1;
            textureOption.add(this.specularGlossinessMap, 'SPECULAR_GLOSSINESS_MAP');
        }
        if (this.isOcclusionInMetallicRoughnessMap) {
            option['IS_OCCLUSION_MAP_IN_METALLIC_ROUGHNESS_MAP'] = 1;
        }
        if (this.occlusionStrength !== 1) {
            option['OCCLUSION_STRENGTH'] = 1;
        }
        if (this.diffuseEnvSphereHarmonics3) {
            option['HAS_NORMAL'] = 1;
            option['DIFFUSE_ENV_SPHERE_HARMONICS3'] = 1;
        }
        if (this.specularEnvMap || this.diffuseEnvSphereHarmonics3 || this.diffuseEnvMap) {
            option['NEED_WORLD_NORMAL'] = 1;
        }
        if (this.specularEnvMap && this.isSpecularEnvMapIncludeMipmaps) {
            option['IS_SPECULAR_ENV_MAP_INCLUDE_MIPMAPS'] = 1;
        }
        if (this.clearcoatFactor > 0) {
            option['HAS_CLEARCOAT'] = 1;
            option['HAS_NORMAL'] = 1;
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
        if (this.anisotropyStrength > 0) {
            option['HAS_ANISOTROPY'] = 1;
            option['HAS_NORMAL'] = 1;
            option['NEED_TANGENT_BASIS'] = 1;
            textureOption.add(this.anisotropyMap, 'ANISOTROPY_MAP');
        }
        if (this.transmissionFactor > 0) {
            option['HAS_TRANSMISSION'] = 1;
            option['HAS_NORMAL'] = 1;
            textureOption.add(this.transmissionMap, 'TRANSMISSION_MAP');
            if (this.thicknessFactor > 0) {
                option['HAS_VOLUME'] = 1;
                textureOption.add(this.thicknessMap, 'THICKNESS_MAP');
            }
        }
        if (this.iridescenceFactor > 0) {
            option['HAS_IRIDESCENCE'] = 1;
            option['HAS_NORMAL'] = 1;
            textureOption.add(this.iridescenceMap, 'IRIDESCENCE_MAP');
            textureOption.add(this.iridescenceThicknessMap, 'IRIDESCENCE_THICKNESS_MAP');
        }
        textureOption.update();
        return option;
    }
}
export default PBRMaterial;
