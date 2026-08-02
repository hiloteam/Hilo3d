import Color from '../math/Color';
import type Matrix4 from '../math/Matrix4';
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
    MaterialTextureSlotInput
} from './MaterialDefinition';
import { getBuiltInMaterialDefinition } from './BuiltInMaterialDefinitions';
import { MaterialTextureSlot } from './MaterialTextureSlots';
import { MaterialTextureSemantic, MaterialUniformSemantic } from './MaterialSemantics';
import type { ShaderOptions } from '../render/types';

export type BasicLightType = 'NONE' | 'PHONG' | 'BLINN-PHONG' | 'LAMBERT';
export type MaterialColorOrTextureInput =
    Color | Texture<unknown> | MaterialTextureSlotInput | null;

export interface BasicMaterialParameters extends MaterialInstanceParameters {
    readonly lightType?: BasicLightType;
    readonly diffuse?: MaterialColorOrTextureInput;
    readonly ambient?: MaterialColorOrTextureInput;
    readonly specular?: MaterialColorOrTextureInput;
    readonly emission?: MaterialColorOrTextureInput;
    readonly specularEnvMap?: MaterialTexture | MaterialTextureSlotInput | null;
    readonly specularEnvMatrix?: Matrix4 | null;
    readonly reflectivity?: number;
    readonly refractRatio?: number;
    readonly refractivity?: number;
    readonly shininess?: number;
    readonly frontFace?: MaterialFrontFace;
    readonly cullMode?: MaterialCullMode;
    readonly state?: Partial<Readonly<MaterialPipelineState>>;
}

function textureInput(value: MaterialColorOrTextureInput): MaterialTextureSlotInput | null {
    if (value === null || value instanceof Color) return null;
    return value instanceof Texture ? { texture: value } : value;
}

function textureValue(value: MaterialColorOrTextureInput): Texture<unknown> | null {
    const input = textureInput(value);
    return input?.texture ?? null;
}

function colorValue(value: MaterialColorOrTextureInput, fallback: Color): Color {
    return value instanceof Color ? value : fallback;
}

function lightModel(lightType: BasicLightType): 0 | 1 | 2 | 3 {
    switch (lightType) {
        case 'LAMBERT':
            return 1;
        case 'PHONG':
            return 2;
        case 'BLINN-PHONG':
            return 3;
        default:
            return 0;
    }
}

function requireFiniteNonNegative(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be finite and non-negative`);
    }
    return value;
}

function createDefinition(parameters: Readonly<BasicMaterialParameters>) {
    const lightType = parameters.lightType ?? 'BLINN-PHONG';
    const diffuse = textureInput(parameters.diffuse ?? null);
    const ambient = textureInput(parameters.ambient ?? null);
    const specular = textureInput(parameters.specular ?? null);
    const emission = textureInput(parameters.emission ?? null);
    const specularEnvironment = textureInput(parameters.specularEnvMap ?? null);
    const normal = parameters.normalMap ?? null;
    const parallax = parameters.parallaxMap ?? null;
    const opacity = parameters.opacityMap ?? null;
    return getBuiltInMaterialDefinition({
        family: 'basic',
        lightModel: lightModel(lightType),
        ...(parameters.coverage === undefined ? {} : { coverage: parameters.coverage }),
        ...(parameters.compositing === undefined ? {} : { compositing: parameters.compositing }),
        ...(parameters.frontFace === undefined ? {} : { frontFace: parameters.frontFace }),
        ...(parameters.cullMode === undefined ? {} : { cullMode: parameters.cullMode }),
        ...(parameters.state === undefined ? {} : { state: parameters.state }),
        staticFeatures: {
            ...(lightType === 'NONE' ? {} : { HAS_NORMAL: 1 }),
            ...(lightType === 'PHONG' || lightType === 'BLINN-PHONG' ? { HAS_SPECULAR: 1 } : {}),
            ...(diffuse !== null && !(diffuse.texture instanceof CubeTexture)
                ? { DIFFUSE_MAP: MaterialTextureSlot.DIFFUSE }
                : diffuse?.texture instanceof CubeTexture
                  ? { DIFFUSE_CUBE_MAP: 1 }
                  : {}),
            ...(ambient !== null ? { AMBIENT_MAP: MaterialTextureSlot.AMBIENT } : {}),
            ...(specular !== null ? { SPECULAR_MAP: MaterialTextureSlot.SPECULAR } : {}),
            ...(emission !== null ? { EMISSION_MAP: MaterialTextureSlot.EMISSION } : {}),
            ...(normal !== null
                ? { NORMAL_MAP: MaterialTextureSlot.NORMAL, HAS_NORMAL: 1, HAS_TANGENT: 1 }
                : {}),
            ...(parallax !== null ? { PARALLAX_MAP: MaterialTextureSlot.PARALLAX } : {}),
            ...(opacity !== null ? { TRANSPARENCY_MAP: MaterialTextureSlot.OPACITY } : {}),
            ...(specularEnvironment === null
                ? {}
                : {
                      SPECULAR_ENV_MAP: 1,
                      ...(specularEnvironment.texture instanceof CubeTexture
                          ? { SPECULAR_ENV_MAP_CUBE: 1 }
                          : {})
                  })
        },
        textureSlots: [
            { name: 'normal', index: MaterialTextureSlot.NORMAL, value: normal, encoding: 'data' },
            {
                name: 'parallax',
                index: MaterialTextureSlot.PARALLAX,
                value: parallax,
                encoding: 'data'
            },
            {
                name: 'emission',
                index: MaterialTextureSlot.EMISSION,
                value: emission,
                encoding: 'srgb'
            },
            {
                name: 'opacity',
                index: MaterialTextureSlot.OPACITY,
                value: opacity,
                encoding: 'data'
            },
            {
                name: 'diffuse',
                index: MaterialTextureSlot.DIFFUSE,
                value: diffuse,
                encoding: 'srgb'
            },
            {
                name: 'specular',
                index: MaterialTextureSlot.SPECULAR,
                value: specular,
                encoding: 'srgb'
            },
            {
                name: 'ambient',
                index: MaterialTextureSlot.AMBIENT,
                value: ambient,
                encoding: 'srgb'
            },
            {
                name: 'specularEnvironment',
                index: MaterialTextureSlot.SPECULAR_ENVIRONMENT,
                value: specularEnvironment,
                encoding: 'linear'
            }
        ]
    });
}

/** Built-in Blinn/Phong/Lambert or unlit material instance. */
class BasicMaterial extends MaterialInstance {
    readonly isBasicMaterial = true;
    override readonly className: string = 'BasicMaterial';
    readonly diffuse: MaterialTextureValue;
    readonly ambient: MaterialTextureValue;
    readonly specular: MaterialTextureValue;
    readonly emission: MaterialTextureValue;
    readonly specularEnvMap: MaterialTexture | null;
    readonly specularEnvMatrix: Matrix4 | null;
    #reflectivity = 0;
    #refractRatio = 0;
    #refractivity = 0;
    #shininess = 32;

    constructor(params: Readonly<BasicMaterialParameters> = {}) {
        super(createDefinition(params), params, false);
        this.diffuse =
            textureValue(params.diffuse ?? null) ??
            colorValue(params.diffuse ?? null, new Color(0.5, 0.5, 0.5));
        this.ambient =
            textureValue(params.ambient ?? null) ?? colorValue(params.ambient ?? null, new Color());
        this.specular =
            textureValue(params.specular ?? null) ??
            colorValue(params.specular ?? null, new Color(1, 1, 1));
        this.emission =
            textureValue(params.emission ?? null) ??
            colorValue(params.emission ?? null, new Color(0, 0, 0));
        this.specularEnvMap =
            params.specularEnvMap instanceof Texture
                ? params.specularEnvMap
                : (params.specularEnvMap?.texture ?? null);
        this.specularEnvMatrix = params.specularEnvMatrix ?? null;
        this.#reflectivity = requireFiniteNonNegative(params.reflectivity ?? 0, 'reflectivity');
        this.#refractRatio = requireFiniteNonNegative(params.refractRatio ?? 0, 'refractRatio');
        this.#refractivity = requireFiniteNonNegative(params.refractivity ?? 0, 'refractivity');
        this.#shininess = requireFiniteNonNegative(params.shininess ?? 32, 'shininess');
        for (const [name, value] of [
            ['diffuse', params.diffuse],
            ['ambient', params.ambient],
            ['specular', params.specular],
            ['emission', params.emission],
            ['specularEnvironment', params.specularEnvMap]
        ] as const) {
            if (value !== null && value !== undefined && !(value instanceof Color)) {
                this.setTextureSlot(name, value);
            }
        }
        this.initializeBasicMaterialBindings();
    }

    get reflectivity(): number {
        return this.#reflectivity;
    }

    set reflectivity(value: number) {
        value = requireFiniteNonNegative(value, 'reflectivity');
        if (value === this.#reflectivity) return;
        this.#reflectivity = value;
        this.markDataChanged();
    }

    get refractRatio(): number {
        return this.#refractRatio;
    }

    set refractRatio(value: number) {
        value = requireFiniteNonNegative(value, 'refractRatio');
        if (value === this.#refractRatio) return;
        this.#refractRatio = value;
        this.markDataChanged();
    }

    get refractivity(): number {
        return this.#refractivity;
    }

    set refractivity(value: number) {
        value = requireFiniteNonNegative(value, 'refractivity');
        if (value === this.#refractivity) return;
        this.#refractivity = value;
        this.markDataChanged();
    }

    get shininess(): number {
        return this.#shininess;
    }

    set shininess(value: number) {
        value = requireFiniteNonNegative(value, 'shininess');
        if (value === this.#shininess) return;
        this.#shininess = value;
        this.markDataChanged();
    }

    protected initializeBasicMaterialBindings(): void {
        this.initializeBindings();
        Object.assign(this.uniforms, {
            u_diffuseColor: MaterialUniformSemantic.DIFFUSE_COLOR,
            u_specularColor: MaterialUniformSemantic.SPECULAR_COLOR,
            u_ambientColor: MaterialUniformSemantic.AMBIENT_COLOR,
            u_shininess: MaterialUniformSemantic.SHININESS,
            u_reflectivity: MaterialUniformSemantic.REFLECTIVITY,
            u_refractRatio: MaterialUniformSemantic.REFRACT_RATIO,
            u_refractivity: MaterialUniformSemantic.REFRACTIVITY,
            u_specularEnvMap: MaterialTextureSemantic.SPECULAR_ENV_MAP,
            u_specularEnvMatrix: MaterialUniformSemantic.SPECULAR_ENV_MATRIX,
            u_emission: MaterialUniformSemantic.EMISSION_COLOR
        });
        this.addTextureUniforms({
            u_diffuse: MaterialTextureSemantic.DIFFUSE,
            u_specular: MaterialTextureSemantic.SPECULAR,
            u_ambient: MaterialTextureSemantic.AMBIENT,
            u_emission: MaterialTextureSemantic.EMISSION
        });
    }

    override getRenderOption(option: ShaderOptions = {}): ShaderOptions {
        return super.getRenderOption(option);
    }
}

export default BasicMaterial;
