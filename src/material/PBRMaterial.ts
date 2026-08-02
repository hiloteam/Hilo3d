import Color from '../math/Color';
import type SphericalHarmonics3 from '../math/SphericalHarmonics3';
import Texture from '../texture/Texture';
import CubeTexture from '../texture/CubeTexture';
import MaterialInstance, {
    type MaterialInstanceParameters,
    type MaterialTexture,
    type MaterialTextureValue
} from './MaterialInstance';
import type {
    MaterialCullMode,
    MaterialFrontFace,
    MaterialPipelineState,
    MaterialTextureEncoding,
    MaterialTextureSlotInput
} from './MaterialDefinition';
import {
    getBuiltInMaterialDefinition,
    type BuiltInTextureSlotRequest
} from './BuiltInMaterialDefinitions';
import { MaterialTextureSlot } from './MaterialTextureSlots';
import { MaterialTextureSemantic, MaterialUniformSemantic } from './MaterialSemantics';
import type { ShaderOptions } from '../render/types';

export type PBRMaterialTextureInput = Texture<unknown> | MaterialTextureSlotInput | null;

export interface PBRMaterialParameters extends MaterialInstanceParameters {
    /** Compile the standard surface without lighting. */
    readonly unlit?: boolean;
    readonly baseColor?: Color;
    readonly baseColorMap?: PBRMaterialTextureInput;
    readonly metallic?: number;
    readonly metallicMap?: PBRMaterialTextureInput;
    readonly roughness?: number;
    readonly roughnessMap?: PBRMaterialTextureInput;
    readonly metallicRoughnessMap?: PBRMaterialTextureInput;
    readonly occlusionMap?: PBRMaterialTextureInput;
    readonly occlusionStrength?: number;
    readonly isOcclusionInMetallicRoughnessMap?: boolean;
    readonly diffuseEnvMap?: MaterialTexture | MaterialTextureSlotInput | null;
    readonly diffuseEnvSphereHarmonics3?: SphericalHarmonics3 | null;
    readonly diffuseEnvIntensity?: number;
    readonly brdfLUT?: Texture | null;
    readonly specularEnvIntensity?: number;
    readonly specularEnvMap?: MaterialTexture | MaterialTextureSlotInput | null;
    readonly isSpecularEnvMapIncludeMipmaps?: boolean;
    readonly emission?: MaterialTextureValue | MaterialTextureSlotInput;
    readonly emissionFactor?: Color;
    readonly isSpecularGlossiness?: boolean;
    readonly specular?: Color;
    readonly glossiness?: number;
    readonly specularGlossinessMap?: PBRMaterialTextureInput;
    readonly lightMap?: PBRMaterialTextureInput;
    readonly clearcoatFactor?: number;
    readonly clearcoatMap?: PBRMaterialTextureInput;
    readonly clearcoatRoughnessFactor?: number;
    readonly clearcoatRoughnessMap?: PBRMaterialTextureInput;
    readonly clearcoatNormalMap?: PBRMaterialTextureInput;
    readonly clearcoatNormalScale?: number;
    readonly anisotropyStrength?: number;
    readonly anisotropyRotation?: number;
    readonly anisotropyMap?: PBRMaterialTextureInput;
    readonly transmissionFactor?: number;
    readonly transmissionMap?: PBRMaterialTextureInput;
    readonly thicknessFactor?: number;
    readonly thicknessMap?: PBRMaterialTextureInput;
    readonly attenuationDistance?: number;
    readonly attenuationColor?: Color;
    readonly ior?: number;
    readonly iridescenceFactor?: number;
    readonly iridescenceMap?: PBRMaterialTextureInput;
    readonly iridescenceIor?: number;
    readonly iridescenceThicknessMinimum?: number;
    readonly iridescenceThicknessMaximum?: number;
    readonly iridescenceThicknessMap?: PBRMaterialTextureInput;
    readonly frontFace?: MaterialFrontFace;
    readonly cullMode?: MaterialCullMode;
    readonly state?: Partial<Readonly<MaterialPipelineState>>;
}

export type MutablePBRMaterialParameters = {
    -readonly [Name in keyof PBRMaterialParameters]: PBRMaterialParameters[Name];
};

/** Mutable import-time descriptor. It is finalized into one immutable-topology material instance. */
export class PBRMaterialBuilder {
    readonly parameters: MutablePBRMaterialParameters;

    constructor(initial: Readonly<PBRMaterialParameters> = {}) {
        this.parameters = {
            ...initial,
            ...(initial.baseColor === undefined
                ? {}
                : {
                      baseColor: new Color(
                          initial.baseColor.r,
                          initial.baseColor.g,
                          initial.baseColor.b,
                          initial.baseColor.a
                      )
                  }),
            ...(initial.emissionFactor === undefined
                ? {}
                : {
                      emissionFactor: new Color(
                          initial.emissionFactor.r,
                          initial.emissionFactor.g,
                          initial.emissionFactor.b,
                          initial.emissionFactor.a
                      )
                  }),
            ...(initial.specular === undefined
                ? {}
                : {
                      specular: new Color(
                          initial.specular.r,
                          initial.specular.g,
                          initial.specular.b,
                          initial.specular.a
                      )
                  }),
            ...(initial.attenuationColor === undefined
                ? {}
                : {
                      attenuationColor: new Color(
                          initial.attenuationColor.r,
                          initial.attenuationColor.g,
                          initial.attenuationColor.b,
                          initial.attenuationColor.a
                      )
                  })
        };
        this.parameters.baseColor ??= new Color(1, 1, 1);
        this.parameters.emissionFactor ??= new Color(0, 0, 0);
        this.parameters.specular ??= new Color(1, 1, 1);
        this.parameters.attenuationColor ??= new Color(1, 1, 1);
    }

    build(): PBRMaterial {
        return new PBRMaterial(this.parameters);
    }
}

function input(
    value: PBRMaterialTextureInput | MaterialTextureValue | undefined
): MaterialTextureSlotInput | null {
    if (value === undefined || value === null || value instanceof Color) return null;
    return value instanceof Texture ? { texture: value } : value;
}

function texture(
    value: PBRMaterialTextureInput | MaterialTextureValue | undefined
): Texture<unknown> | null {
    return input(value)?.texture ?? null;
}

function requireRange(value: number, name: string, minimum: number, maximum: number): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(`${name} must be between ${String(minimum)} and ${String(maximum)}`);
    }
    return value;
}

function requireNonNegative(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be finite and non-negative`);
    }
    return value;
}

function requireAttenuationDistance(value: number): number {
    if ((value !== Number.POSITIVE_INFINITY && !Number.isFinite(value)) || value <= 0) {
        throw new RangeError('attenuationDistance must be positive or positive infinity');
    }
    return value;
}

function slot(
    name: string,
    index: number,
    value: PBRMaterialTextureInput | MaterialTextureValue | undefined,
    encoding: MaterialTextureEncoding
): BuiltInTextureSlotRequest {
    return { name, index, value: input(value), encoding };
}

function createDefinition(parameters: Readonly<PBRMaterialParameters>) {
    const baseColor = input(parameters.baseColorMap);
    const metallic = input(parameters.metallicMap);
    const roughness = input(parameters.roughnessMap);
    const combined = input(parameters.metallicRoughnessMap);
    const occlusion = input(parameters.occlusionMap);
    const normal = input(parameters.normalMap);
    const emission = input(parameters.emission);
    const specularGlossiness = input(parameters.specularGlossinessMap);
    const light = input(parameters.lightMap);
    const clearcoat = input(parameters.clearcoatMap);
    const clearcoatRoughness = input(parameters.clearcoatRoughnessMap);
    const clearcoatNormal = input(parameters.clearcoatNormalMap);
    const anisotropy = input(parameters.anisotropyMap);
    const transmission = input(parameters.transmissionMap);
    const thickness = input(parameters.thicknessMap);
    const iridescence = input(parameters.iridescenceMap);
    const iridescenceThickness = input(parameters.iridescenceThicknessMap);
    const diffuseEnvironment = input(parameters.diffuseEnvMap);
    const specularEnvironment = input(parameters.specularEnvMap);
    const opacity = input(parameters.opacityMap);
    const hasClearcoat =
        (parameters.clearcoatFactor ?? 0) > 0 ||
        clearcoat !== null ||
        clearcoatRoughness !== null ||
        clearcoatNormal !== null;
    const hasAnisotropy = (parameters.anisotropyStrength ?? 0) > 0 || anisotropy !== null;
    const hasTransmission = (parameters.transmissionFactor ?? 0) > 0 || transmission !== null;
    const hasVolume =
        hasTransmission && ((parameters.thicknessFactor ?? 0) > 0 || thickness !== null);
    const hasIridescence = (parameters.iridescenceFactor ?? 0) > 0 || iridescence !== null;
    return getBuiltInMaterialDefinition({
        family: 'pbr',
        lightModel: parameters.unlit === true ? 0 : 4,
        ...(parameters.coverage === undefined ? {} : { coverage: parameters.coverage }),
        ...(parameters.compositing === undefined ? {} : { compositing: parameters.compositing }),
        ...(parameters.frontFace === undefined ? {} : { frontFace: parameters.frontFace }),
        ...(parameters.cullMode === undefined ? {} : { cullMode: parameters.cullMode }),
        ...(parameters.state === undefined ? {} : { state: parameters.state }),
        staticFeatures: {
            ...(parameters.unlit === true ? {} : { HAS_NORMAL: 1, USE_PHYSICS_LIGHT: 1 }),
            ...(baseColor === null ? {} : { BASE_COLOR_MAP: MaterialTextureSlot.BASE_COLOR }),
            ...(metallic === null ? {} : { METALLIC_MAP: MaterialTextureSlot.METALLIC }),
            ...(roughness === null ? {} : { ROUGHNESS_MAP: MaterialTextureSlot.ROUGHNESS }),
            ...(combined === null
                ? {}
                : { METALLIC_ROUGHNESS_MAP: MaterialTextureSlot.METALLIC_ROUGHNESS }),
            ...(occlusion === null ? {} : { OCCLUSION_MAP: MaterialTextureSlot.OCCLUSION }),
            ...(normal === null ? {} : { NORMAL_MAP: MaterialTextureSlot.NORMAL, HAS_TANGENT: 1 }),
            ...(emission === null ? {} : { EMISSION_MAP: MaterialTextureSlot.EMISSION }),
            ...(specularGlossiness === null
                ? {}
                : { SPECULAR_GLOSSINESS_MAP: MaterialTextureSlot.SPECULAR_GLOSSINESS }),
            ...(light === null ? {} : { LIGHT_MAP: MaterialTextureSlot.LIGHT }),
            ...(parameters.isSpecularGlossiness === true ? { PBR_SPECULAR_GLOSSINESS: 1 } : {}),
            ...(parameters.isOcclusionInMetallicRoughnessMap === true
                ? { IS_OCCLUSION_MAP_IN_METALLIC_ROUGHNESS_MAP: 1 }
                : {}),
            ...((parameters.occlusionStrength ?? 1) !== 1 ? { OCCLUSION_STRENGTH: 1 } : {}),
            ...(diffuseEnvironment === null
                ? {}
                : {
                      DIFFUSE_ENV_MAP: MaterialTextureSlot.DIFFUSE_ENVIRONMENT,
                      ...(diffuseEnvironment.texture instanceof CubeTexture
                          ? { DIFFUSE_ENV_MAP_CUBE: 1 }
                          : {})
                  }),
            ...(parameters.diffuseEnvSphereHarmonics3 === undefined ||
            parameters.diffuseEnvSphereHarmonics3 === null
                ? {}
                : { DIFFUSE_ENV_SPHERE_HARMONICS3: 1, NEED_WORLD_NORMAL: 1 }),
            ...(specularEnvironment === null
                ? {}
                : {
                      SPECULAR_ENV_MAP: MaterialTextureSlot.SPECULAR_ENVIRONMENT,
                      ...(specularEnvironment.texture instanceof CubeTexture
                          ? { SPECULAR_ENV_MAP_CUBE: 1 }
                          : {}),
                      NEED_WORLD_NORMAL: 1,
                      USE_SHADER_TEXTURE_LOD: 1
                  }),
            ...(parameters.isSpecularEnvMapIncludeMipmaps === true
                ? { IS_SPECULAR_ENV_MAP_INCLUDE_MIPMAPS: 1 }
                : {}),
            ...(hasClearcoat ? { HAS_CLEARCOAT: 1 } : {}),
            ...(clearcoat === null ? {} : { CLEARCOAT_MAP: MaterialTextureSlot.CLEARCOAT }),
            ...(clearcoatRoughness === null
                ? {}
                : { CLEARCOAT_ROUGHNESS_MAP: MaterialTextureSlot.CLEARCOAT_ROUGHNESS }),
            ...(clearcoatNormal === null
                ? {}
                : { CLEARCOAT_NORMAL_MAP: MaterialTextureSlot.CLEARCOAT_NORMAL, HAS_TANGENT: 1 }),
            ...(hasAnisotropy ? { HAS_ANISOTROPY: 1, NEED_TANGENT_BASIS: 1, HAS_TANGENT: 1 } : {}),
            ...(anisotropy === null ? {} : { ANISOTROPY_MAP: MaterialTextureSlot.ANISOTROPY }),
            ...(hasTransmission ? { HAS_TRANSMISSION: 1 } : {}),
            ...(transmission === null
                ? {}
                : { TRANSMISSION_MAP: MaterialTextureSlot.TRANSMISSION }),
            ...(hasVolume ? { HAS_VOLUME: 1 } : {}),
            ...(thickness === null ? {} : { THICKNESS_MAP: MaterialTextureSlot.THICKNESS }),
            ...(hasIridescence ? { HAS_IRIDESCENCE: 1 } : {}),
            ...(iridescence === null ? {} : { IRIDESCENCE_MAP: MaterialTextureSlot.IRIDESCENCE }),
            ...(iridescenceThickness === null
                ? {}
                : { IRIDESCENCE_THICKNESS_MAP: MaterialTextureSlot.IRIDESCENCE_THICKNESS }),
            ...(opacity === null ? {} : { TRANSPARENCY_MAP: MaterialTextureSlot.OPACITY })
        },
        textureSlots: [
            slot('normal', MaterialTextureSlot.NORMAL, parameters.normalMap, 'data'),
            slot('emission', MaterialTextureSlot.EMISSION, parameters.emission, 'srgb'),
            slot('opacity', MaterialTextureSlot.OPACITY, parameters.opacityMap, 'data'),
            slot('baseColor', MaterialTextureSlot.BASE_COLOR, parameters.baseColorMap, 'srgb'),
            slot('metallic', MaterialTextureSlot.METALLIC, parameters.metallicMap, 'data'),
            slot('roughness', MaterialTextureSlot.ROUGHNESS, parameters.roughnessMap, 'data'),
            slot(
                'metallicRoughness',
                MaterialTextureSlot.METALLIC_ROUGHNESS,
                parameters.metallicRoughnessMap,
                'data'
            ),
            slot('occlusion', MaterialTextureSlot.OCCLUSION, parameters.occlusionMap, 'data'),
            slot(
                'specularGlossiness',
                MaterialTextureSlot.SPECULAR_GLOSSINESS,
                parameters.specularGlossinessMap,
                'srgb'
            ),
            slot('light', MaterialTextureSlot.LIGHT, parameters.lightMap, 'linear'),
            slot('clearcoat', MaterialTextureSlot.CLEARCOAT, parameters.clearcoatMap, 'data'),
            slot(
                'clearcoatRoughness',
                MaterialTextureSlot.CLEARCOAT_ROUGHNESS,
                parameters.clearcoatRoughnessMap,
                'data'
            ),
            slot(
                'clearcoatNormal',
                MaterialTextureSlot.CLEARCOAT_NORMAL,
                parameters.clearcoatNormalMap,
                'data'
            ),
            slot('anisotropy', MaterialTextureSlot.ANISOTROPY, parameters.anisotropyMap, 'data'),
            slot(
                'transmission',
                MaterialTextureSlot.TRANSMISSION,
                parameters.transmissionMap,
                'data'
            ),
            slot('thickness', MaterialTextureSlot.THICKNESS, parameters.thicknessMap, 'data'),
            slot('iridescence', MaterialTextureSlot.IRIDESCENCE, parameters.iridescenceMap, 'data'),
            slot(
                'iridescenceThickness',
                MaterialTextureSlot.IRIDESCENCE_THICKNESS,
                parameters.iridescenceThicknessMap,
                'data'
            ),
            slot(
                'diffuseEnvironment',
                MaterialTextureSlot.DIFFUSE_ENVIRONMENT,
                parameters.diffuseEnvMap,
                'linear'
            ),
            slot(
                'specularEnvironment',
                MaterialTextureSlot.SPECULAR_ENVIRONMENT,
                parameters.specularEnvMap,
                'linear'
            )
        ]
    });
}

/** Physically based standard-surface material with immutable shader topology. */
class PBRMaterial extends MaterialInstance {
    readonly isPBRMaterial = true;
    override readonly className: string = 'PBRMaterial';
    readonly baseColor: Color;
    readonly baseColorMap: Texture<unknown> | null;
    #metallic = 1;
    readonly metallicMap: Texture<unknown> | null;
    #roughness = 1;
    readonly roughnessMap: Texture<unknown> | null;
    readonly metallicRoughnessMap: Texture<unknown> | null;
    readonly occlusionMap: Texture<unknown> | null;
    #occlusionStrength = 1;
    readonly isOcclusionInMetallicRoughnessMap: boolean;
    readonly diffuseEnvMap: MaterialTexture | null;
    readonly diffuseEnvSphereHarmonics3: SphericalHarmonics3 | null;
    #diffuseEnvIntensity = 1;
    readonly brdfLUT: Texture<unknown> | null;
    #specularEnvIntensity = 1;
    readonly specularEnvMap: MaterialTexture | null;
    readonly isSpecularEnvMapIncludeMipmaps: boolean;
    readonly emission: MaterialTextureValue;
    readonly emissionFactor: Color;
    readonly isSpecularGlossiness: boolean;
    readonly specular: Color;
    #glossiness = 1;
    readonly specularGlossinessMap: Texture<unknown> | null;
    readonly lightMap: Texture<unknown> | null;
    #clearcoatFactor = 0;
    readonly clearcoatMap: Texture<unknown> | null;
    #clearcoatRoughnessFactor = 0;
    readonly clearcoatRoughnessMap: Texture<unknown> | null;
    readonly clearcoatNormalMap: Texture<unknown> | null;
    #clearcoatNormalScale = 1;
    #anisotropyStrength = 0;
    #anisotropyRotation = 0;
    readonly anisotropyMap: Texture<unknown> | null;
    #transmissionFactor = 0;
    readonly transmissionMap: Texture<unknown> | null;
    #thicknessFactor = 0;
    readonly thicknessMap: Texture<unknown> | null;
    #attenuationDistance = Number.POSITIVE_INFINITY;
    readonly attenuationColor: Color;
    #ior = 1.5;
    #iridescenceFactor = 0;
    readonly iridescenceMap: Texture<unknown> | null;
    #iridescenceIor = 1.3;
    #iridescenceThicknessMinimum = 100;
    #iridescenceThicknessMaximum = 400;
    readonly iridescenceThicknessMap: Texture<unknown> | null;

    constructor(params: Readonly<PBRMaterialParameters> = {}) {
        super(createDefinition(params), params, false);
        this.baseColor = params.baseColor ?? new Color(1, 1, 1);
        this.baseColorMap = texture(params.baseColorMap);
        this.#metallic = requireRange(params.metallic ?? 1, 'metallic', 0, 1);
        this.metallicMap = texture(params.metallicMap);
        this.#roughness = requireRange(params.roughness ?? 1, 'roughness', 0, 1);
        this.roughnessMap = texture(params.roughnessMap);
        this.metallicRoughnessMap = texture(params.metallicRoughnessMap);
        this.occlusionMap = texture(params.occlusionMap);
        this.#occlusionStrength = requireRange(
            params.occlusionStrength ?? 1,
            'occlusionStrength',
            0,
            1
        );
        this.isOcclusionInMetallicRoughnessMap = params.isOcclusionInMetallicRoughnessMap ?? false;
        this.diffuseEnvMap = texture(params.diffuseEnvMap);
        this.diffuseEnvSphereHarmonics3 = params.diffuseEnvSphereHarmonics3 ?? null;
        this.#diffuseEnvIntensity = requireNonNegative(
            params.diffuseEnvIntensity ?? 1,
            'diffuseEnvIntensity'
        );
        this.brdfLUT = params.brdfLUT ?? null;
        this.#specularEnvIntensity = requireNonNegative(
            params.specularEnvIntensity ?? 1,
            'specularEnvIntensity'
        );
        this.specularEnvMap = texture(params.specularEnvMap);
        this.isSpecularEnvMapIncludeMipmaps = params.isSpecularEnvMapIncludeMipmaps ?? false;
        this.emission =
            texture(params.emission) ?? (params.emission instanceof Color ? params.emission : null);
        this.emissionFactor = params.emissionFactor ?? new Color(0, 0, 0);
        this.isSpecularGlossiness = params.isSpecularGlossiness ?? false;
        this.specular = params.specular ?? new Color(1, 1, 1);
        this.#glossiness = requireRange(params.glossiness ?? 1, 'glossiness', 0, 1);
        this.specularGlossinessMap = texture(params.specularGlossinessMap);
        this.lightMap = texture(params.lightMap);
        this.#clearcoatFactor = requireRange(params.clearcoatFactor ?? 0, 'clearcoatFactor', 0, 1);
        this.clearcoatMap = texture(params.clearcoatMap);
        this.#clearcoatRoughnessFactor = requireRange(
            params.clearcoatRoughnessFactor ?? 0,
            'clearcoatRoughnessFactor',
            0,
            1
        );
        this.clearcoatRoughnessMap = texture(params.clearcoatRoughnessMap);
        this.clearcoatNormalMap = texture(params.clearcoatNormalMap);
        this.#clearcoatNormalScale = requireNonNegative(
            params.clearcoatNormalScale ?? 1,
            'clearcoatNormalScale'
        );
        this.#anisotropyStrength = requireRange(
            params.anisotropyStrength ?? 0,
            'anisotropyStrength',
            0,
            1
        );
        this.#anisotropyRotation = params.anisotropyRotation ?? 0;
        if (!Number.isFinite(this.#anisotropyRotation)) {
            throw new RangeError('anisotropyRotation must be finite');
        }
        this.anisotropyMap = texture(params.anisotropyMap);
        this.#transmissionFactor = requireRange(
            params.transmissionFactor ?? 0,
            'transmissionFactor',
            0,
            1
        );
        this.transmissionMap = texture(params.transmissionMap);
        this.#thicknessFactor = requireNonNegative(params.thicknessFactor ?? 0, 'thicknessFactor');
        this.thicknessMap = texture(params.thicknessMap);
        this.#attenuationDistance = requireAttenuationDistance(
            params.attenuationDistance ?? Number.POSITIVE_INFINITY
        );
        this.attenuationColor = params.attenuationColor ?? new Color(1, 1, 1);
        this.#ior = requireNonNegative(params.ior ?? 1.5, 'ior');
        if (this.#ior === 0) throw new RangeError('ior must be greater than zero');
        this.#iridescenceFactor = requireRange(
            params.iridescenceFactor ?? 0,
            'iridescenceFactor',
            0,
            1
        );
        this.iridescenceMap = texture(params.iridescenceMap);
        this.#iridescenceIor = requireNonNegative(params.iridescenceIor ?? 1.3, 'iridescenceIor');
        if (this.#iridescenceIor === 0) {
            throw new RangeError('iridescenceIor must be greater than zero');
        }
        this.#iridescenceThicknessMinimum = requireNonNegative(
            params.iridescenceThicknessMinimum ?? 100,
            'iridescenceThicknessMinimum'
        );
        this.#iridescenceThicknessMaximum = requireNonNegative(
            params.iridescenceThicknessMaximum ?? 400,
            'iridescenceThicknessMaximum'
        );
        if (this.#iridescenceThicknessMinimum > this.#iridescenceThicknessMaximum) {
            throw new RangeError(
                'iridescenceThicknessMinimum must not exceed iridescenceThicknessMaximum'
            );
        }
        this.iridescenceThicknessMap = texture(params.iridescenceThicknessMap);
        for (const [name, value] of [
            ['baseColor', params.baseColorMap],
            ['metallic', params.metallicMap],
            ['roughness', params.roughnessMap],
            ['metallicRoughness', params.metallicRoughnessMap],
            ['occlusion', params.occlusionMap],
            ['normal', params.normalMap],
            ['emission', params.emission],
            ['opacity', params.opacityMap],
            ['specularGlossiness', params.specularGlossinessMap],
            ['light', params.lightMap],
            ['clearcoat', params.clearcoatMap],
            ['clearcoatRoughness', params.clearcoatRoughnessMap],
            ['clearcoatNormal', params.clearcoatNormalMap],
            ['anisotropy', params.anisotropyMap],
            ['transmission', params.transmissionMap],
            ['thickness', params.thicknessMap],
            ['iridescence', params.iridescenceMap],
            ['iridescenceThickness', params.iridescenceThicknessMap],
            ['diffuseEnvironment', params.diffuseEnvMap],
            ['specularEnvironment', params.specularEnvMap]
        ] as const) {
            if (value !== undefined && value !== null && !(value instanceof Color)) {
                this.setTextureSlot(name, value);
            }
        }
        this.initializeBindings();
        Object.assign(this.uniforms, {
            u_baseColor: MaterialUniformSemantic.BASE_COLOR,
            u_metallic: MaterialUniformSemantic.METALLIC,
            u_roughness: MaterialUniformSemantic.ROUGHNESS,
            u_specularColor: MaterialUniformSemantic.SPECULAR_COLOR,
            u_emissionFactor: MaterialUniformSemantic.EMISSION_FACTOR,
            u_glossiness: MaterialUniformSemantic.GLOSSINESS,
            u_brdfLUT: MaterialTextureSemantic.BRDF_LUT,
            u_diffuseEnvMap: MaterialTextureSemantic.DIFFUSE_ENV_MAP,
            u_diffuseEnvIntensity: MaterialUniformSemantic.DIFFUSE_ENV_INTENSITY,
            u_occlusionStrength: MaterialUniformSemantic.OCCLUSION_STRENGTH,
            u_specularEnvMap: MaterialTextureSemantic.SPECULAR_ENV_MAP,
            u_specularEnvIntensity: MaterialUniformSemantic.SPECULAR_ENV_INTENSITY,
            u_specularEnvMapMipCount: MaterialUniformSemantic.SPECULAR_ENV_MIP_COUNT,
            u_diffuseEnvSphereHarmonics3: MaterialUniformSemantic.DIFFUSE_ENV_SPHERICAL_HARMONICS,
            u_clearcoatFactor: MaterialUniformSemantic.CLEARCOAT_FACTOR,
            u_clearcoatRoughnessFactor: MaterialUniformSemantic.CLEARCOAT_ROUGHNESS_FACTOR,
            u_clearcoatNormalScale: MaterialUniformSemantic.CLEARCOAT_NORMAL_SCALE,
            u_anisotropyStrength: MaterialUniformSemantic.ANISOTROPY_STRENGTH,
            u_anisotropyRotation: MaterialUniformSemantic.ANISOTROPY_ROTATION,
            u_transmissionFactor: MaterialUniformSemantic.TRANSMISSION_FACTOR,
            u_thicknessFactor: MaterialUniformSemantic.THICKNESS_FACTOR,
            u_attenuationDistance: MaterialUniformSemantic.ATTENUATION_DISTANCE,
            u_attenuationColor: MaterialUniformSemantic.ATTENUATION_COLOR,
            u_ior: MaterialUniformSemantic.IOR,
            u_iridescenceFactor: MaterialUniformSemantic.IRIDESCENCE_FACTOR,
            u_iridescenceIor: MaterialUniformSemantic.IRIDESCENCE_IOR,
            u_iridescenceThicknessMinimum: MaterialUniformSemantic.IRIDESCENCE_THICKNESS_MINIMUM,
            u_iridescenceThicknessMaximum: MaterialUniformSemantic.IRIDESCENCE_THICKNESS_MAXIMUM,
            u_opaqueTexture: MaterialTextureSemantic.OPAQUE_SCENE_TEXTURE
        });
        this.addTextureUniforms({
            u_emission: MaterialTextureSemantic.EMISSION,
            u_baseColorMap: MaterialTextureSemantic.BASE_COLOR_MAP,
            u_metallicMap: MaterialTextureSemantic.METALLIC_MAP,
            u_roughnessMap: MaterialTextureSemantic.ROUGHNESS_MAP,
            u_metallicRoughnessMap: MaterialTextureSemantic.METALLIC_ROUGHNESS_MAP,
            u_occlusionMap: MaterialTextureSemantic.OCCLUSION_MAP,
            u_specularGlossinessMap: MaterialTextureSemantic.SPECULAR_GLOSSINESS_MAP,
            u_lightMap: MaterialTextureSemantic.LIGHT_MAP,
            u_clearcoatMap: MaterialTextureSemantic.CLEARCOAT_MAP,
            u_clearcoatRoughnessMap: MaterialTextureSemantic.CLEARCOAT_ROUGHNESS_MAP,
            u_clearcoatNormalMap: MaterialTextureSemantic.CLEARCOAT_NORMAL_MAP,
            u_anisotropyMap: MaterialTextureSemantic.ANISOTROPY_MAP,
            u_transmissionMap: MaterialTextureSemantic.TRANSMISSION_MAP,
            u_thicknessMap: MaterialTextureSemantic.THICKNESS_MAP,
            u_iridescenceMap: MaterialTextureSemantic.IRIDESCENCE_MAP,
            u_iridescenceThicknessMap: MaterialTextureSemantic.IRIDESCENCE_THICKNESS_MAP
        });
    }

    get metallic(): number {
        return this.#metallic;
    }

    set metallic(value: number) {
        value = requireRange(value, 'metallic', 0, 1);
        if (value === this.#metallic) return;
        this.#metallic = value;
        this.markDataChanged();
    }

    get roughness(): number {
        return this.#roughness;
    }

    set roughness(value: number) {
        value = requireRange(value, 'roughness', 0, 1);
        if (value === this.#roughness) return;
        this.#roughness = value;
        this.markDataChanged();
    }

    get occlusionStrength(): number {
        return this.#occlusionStrength;
    }

    set occlusionStrength(value: number) {
        value = requireRange(value, 'occlusionStrength', 0, 1);
        this.assertTopologyFeature('OCCLUSION_STRENGTH', value !== 1, 'occlusionStrength');
        if (value === this.#occlusionStrength) return;
        this.#occlusionStrength = value;
        this.markDataChanged();
    }

    get diffuseEnvIntensity(): number {
        return this.#diffuseEnvIntensity;
    }

    set diffuseEnvIntensity(value: number) {
        value = requireNonNegative(value, 'diffuseEnvIntensity');
        if (value === this.#diffuseEnvIntensity) return;
        this.#diffuseEnvIntensity = value;
        this.markDataChanged();
    }

    get specularEnvIntensity(): number {
        return this.#specularEnvIntensity;
    }

    set specularEnvIntensity(value: number) {
        value = requireNonNegative(value, 'specularEnvIntensity');
        if (value === this.#specularEnvIntensity) return;
        this.#specularEnvIntensity = value;
        this.markDataChanged();
    }

    get glossiness(): number {
        return this.#glossiness;
    }

    set glossiness(value: number) {
        value = requireRange(value, 'glossiness', 0, 1);
        if (value === this.#glossiness) return;
        this.#glossiness = value;
        this.markDataChanged();
    }

    get clearcoatFactor(): number {
        return this.#clearcoatFactor;
    }

    set clearcoatFactor(value: number) {
        value = requireRange(value, 'clearcoatFactor', 0, 1);
        this.assertTopologyFeature('HAS_CLEARCOAT', value !== 0, 'clearcoatFactor');
        if (value === this.#clearcoatFactor) return;
        this.#clearcoatFactor = value;
        this.markDataChanged();
    }

    get clearcoatRoughnessFactor(): number {
        return this.#clearcoatRoughnessFactor;
    }

    set clearcoatRoughnessFactor(value: number) {
        value = requireRange(value, 'clearcoatRoughnessFactor', 0, 1);
        if (value === this.#clearcoatRoughnessFactor) return;
        this.#clearcoatRoughnessFactor = value;
        this.markDataChanged();
    }

    get clearcoatNormalScale(): number {
        return this.#clearcoatNormalScale;
    }

    set clearcoatNormalScale(value: number) {
        value = requireNonNegative(value, 'clearcoatNormalScale');
        if (value === this.#clearcoatNormalScale) return;
        this.#clearcoatNormalScale = value;
        this.markDataChanged();
    }

    get anisotropyStrength(): number {
        return this.#anisotropyStrength;
    }

    set anisotropyStrength(value: number) {
        value = requireRange(value, 'anisotropyStrength', 0, 1);
        this.assertTopologyFeature('HAS_ANISOTROPY', value !== 0, 'anisotropyStrength');
        if (value === this.#anisotropyStrength) return;
        this.#anisotropyStrength = value;
        this.markDataChanged();
    }

    get anisotropyRotation(): number {
        return this.#anisotropyRotation;
    }

    set anisotropyRotation(value: number) {
        if (!Number.isFinite(value)) throw new RangeError('anisotropyRotation must be finite');
        if (value === this.#anisotropyRotation) return;
        this.#anisotropyRotation = value;
        this.markDataChanged();
    }

    get transmissionFactor(): number {
        return this.#transmissionFactor;
    }

    set transmissionFactor(value: number) {
        value = requireRange(value, 'transmissionFactor', 0, 1);
        this.assertTopologyFeature('HAS_TRANSMISSION', value !== 0, 'transmissionFactor');
        if (value === this.#transmissionFactor) return;
        this.#transmissionFactor = value;
        this.markDataChanged();
    }

    get thicknessFactor(): number {
        return this.#thicknessFactor;
    }

    set thicknessFactor(value: number) {
        value = requireNonNegative(value, 'thicknessFactor');
        this.assertTopologyFeature('HAS_VOLUME', value !== 0, 'thicknessFactor');
        if (value === this.#thicknessFactor) return;
        this.#thicknessFactor = value;
        this.markDataChanged();
    }

    get attenuationDistance(): number {
        return this.#attenuationDistance;
    }

    set attenuationDistance(value: number) {
        value = requireAttenuationDistance(value);
        if (value === this.#attenuationDistance) return;
        this.#attenuationDistance = value;
        this.markDataChanged();
    }

    get ior(): number {
        return this.#ior;
    }

    set ior(value: number) {
        value = requireNonNegative(value, 'ior');
        if (value === 0) throw new RangeError('ior must be greater than zero');
        if (value === this.#ior) return;
        this.#ior = value;
        this.markDataChanged();
    }

    get iridescenceFactor(): number {
        return this.#iridescenceFactor;
    }

    set iridescenceFactor(value: number) {
        value = requireRange(value, 'iridescenceFactor', 0, 1);
        this.assertTopologyFeature('HAS_IRIDESCENCE', value !== 0, 'iridescenceFactor');
        if (value === this.#iridescenceFactor) return;
        this.#iridescenceFactor = value;
        this.markDataChanged();
    }

    get iridescenceIor(): number {
        return this.#iridescenceIor;
    }

    set iridescenceIor(value: number) {
        value = requireNonNegative(value, 'iridescenceIor');
        if (value === 0) throw new RangeError('iridescenceIor must be greater than zero');
        if (value === this.#iridescenceIor) return;
        this.#iridescenceIor = value;
        this.markDataChanged();
    }

    get iridescenceThicknessMinimum(): number {
        return this.#iridescenceThicknessMinimum;
    }

    set iridescenceThicknessMinimum(value: number) {
        value = requireNonNegative(value, 'iridescenceThicknessMinimum');
        if (value > this.#iridescenceThicknessMaximum) {
            throw new RangeError(
                'iridescenceThicknessMinimum must not exceed iridescenceThicknessMaximum'
            );
        }
        if (value === this.#iridescenceThicknessMinimum) return;
        this.#iridescenceThicknessMinimum = value;
        this.markDataChanged();
    }

    get iridescenceThicknessMaximum(): number {
        return this.#iridescenceThicknessMaximum;
    }

    set iridescenceThicknessMaximum(value: number) {
        value = requireNonNegative(value, 'iridescenceThicknessMaximum');
        if (value < this.#iridescenceThicknessMinimum) {
            throw new RangeError(
                'iridescenceThicknessMaximum must not be less than iridescenceThicknessMinimum'
            );
        }
        if (value === this.#iridescenceThicknessMaximum) return;
        this.#iridescenceThicknessMaximum = value;
        this.markDataChanged();
    }

    private assertTopologyFeature(feature: string, active: boolean, propertyName: string): void {
        if (active && this.definition.staticFeatures[feature] !== 1) {
            throw new TypeError(
                `${propertyName} changes PBR topology; construct a new PBRMaterial with that feature enabled`
            );
        }
    }

    /** Transmission is a shading property, not an alias for alpha compositing. */
    get requiresOpaqueSceneTexture(): boolean {
        return this.definition.staticFeatures['HAS_TRANSMISSION'] === 1;
    }

    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        return super.getRenderOption(option);
    }
}

export default PBRMaterial;
