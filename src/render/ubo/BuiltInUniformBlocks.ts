import { createStd140Layout, type Std140Layout, type Std140Value } from './Std140Layout';
import { MATERIAL_TEXTURE_SLOT_COUNT } from '../../material/MaterialTextureSlots';

export const MAX_DIRECTIONAL_LIGHTS = 8;
export const MAX_DIRECTIONAL_SHADOW_CASCADES = 4;
export const MAX_SPOT_LIGHTS = 8;
export const MAX_POINT_LIGHTS = 16;
export const MAX_AREA_LIGHTS = 8;
export const MAX_SKIN_JOINTS = 128;
export const MAX_MORPH_WEIGHTS = 8;
export const MAX_INSTANCES_PER_DRAW = 128;
export const MAX_SHADOW_ATLAS_SLICES =
    MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES +
    MAX_SPOT_LIGHTS +
    MAX_POINT_LIGHTS * 6;

export const frameBlockLayout = createStd140Layout({
    u_rendererSize: 'vec2',
    u_time: 'float',
    u_frameIndex: 'float'
});

export const cameraBlockLayout = createStd140Layout({
    u_viewMatrix: 'mat4',
    u_projectionMatrix: 'mat4',
    u_viewProjectionMatrix: 'mat4',
    u_previousViewMatrix: 'mat4',
    u_previousProjectionMatrix: 'mat4',
    u_previousViewProjectionMatrix: 'mat4',
    u_viewInverseMatrix: 'mat4',
    u_previousViewInverseMatrix: 'mat4',
    u_projectionInverseMatrix: 'mat4',
    u_viewInverseNormalMatrix: 'mat3',
    u_cameraPositionNear: 'vec4',
    u_cameraParams: 'vec4',
    u_renderOrigin: 'vec4',
    u_previousRenderOrigin: 'vec4',
    u_historyParams: 'vec4',
    u_viewport: 'vec4'
});

export const sceneBlockLayout = createStd140Layout({
    u_fogColor: 'vec4',
    u_fogInfo: 'vec4'
});

export const lightBlockLayout = createStd140Layout({
    u_ambientLightsColor: 'vec3',
    u_directionalLightsColor: { type: 'vec3', arrayLength: MAX_DIRECTIONAL_LIGHTS },
    u_directionalLightsInfo: { type: 'vec3', arrayLength: MAX_DIRECTIONAL_LIGHTS },
    u_directionalLightsShadowMapSize: { type: 'vec2', arrayLength: MAX_DIRECTIONAL_LIGHTS },
    u_directionalLightsShadowBias: { type: 'vec2', arrayLength: MAX_DIRECTIONAL_LIGHTS },
    u_directionalLightSpaceMatrix: { type: 'mat4', arrayLength: MAX_DIRECTIONAL_LIGHTS },
    u_directionalCascadeSplits: { type: 'vec4', arrayLength: MAX_DIRECTIONAL_LIGHTS },
    u_directionalCascadeParams: { type: 'vec4', arrayLength: MAX_DIRECTIONAL_LIGHTS },
    u_directionalCascadeMatrices: {
        type: 'mat4',
        arrayLength: MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES
    },
    u_spotLightsPos: { type: 'vec3', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightsDir: { type: 'vec3', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightsColor: { type: 'vec3', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightsCutoffs: { type: 'vec2', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightsInfo: { type: 'vec3', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightsRange: { type: 'float', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightsShadowMapSize: { type: 'vec2', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightsShadowBias: { type: 'vec2', arrayLength: MAX_SPOT_LIGHTS },
    u_spotLightSpaceMatrix: { type: 'mat4', arrayLength: MAX_SPOT_LIGHTS },
    u_pointLightsPos: { type: 'vec3', arrayLength: MAX_POINT_LIGHTS },
    u_pointLightsColor: { type: 'vec3', arrayLength: MAX_POINT_LIGHTS },
    u_pointLightsInfo: { type: 'vec3', arrayLength: MAX_POINT_LIGHTS },
    u_pointLightsRange: { type: 'float', arrayLength: MAX_POINT_LIGHTS },
    u_pointLightsShadowBias: { type: 'vec2', arrayLength: MAX_POINT_LIGHTS },
    u_pointLightSpaceMatrix: { type: 'mat4', arrayLength: MAX_POINT_LIGHTS },
    u_pointLightCamera: { type: 'vec2', arrayLength: MAX_POINT_LIGHTS },
    u_shadowAtlasSize: 'vec4',
    u_shadowAtlasRects: { type: 'vec4', arrayLength: MAX_SHADOW_ATLAS_SLICES },
    u_pointShadowMatrices: { type: 'mat4', arrayLength: MAX_POINT_LIGHTS * 6 },
    u_areaLightsPos: { type: 'vec3', arrayLength: MAX_AREA_LIGHTS },
    u_areaLightsColor: { type: 'vec3', arrayLength: MAX_AREA_LIGHTS },
    u_areaLightsWidth: { type: 'vec3', arrayLength: MAX_AREA_LIGHTS },
    u_areaLightsHeight: { type: 'vec3', arrayLength: MAX_AREA_LIGHTS }
});

export const materialBlockLayout = createStd140Layout({
    u_diffuseColor: 'vec4',
    u_specularColor: 'vec4',
    u_ambientColor: 'vec4',
    u_emissionColor: 'vec4',
    u_baseColor: 'vec4',
    u_emissionFactor: 'vec4',
    u_diffuseEnvSphereHarmonics3: { type: 'vec3', arrayLength: 9 },
    u_specularEnvMatrix: 'mat4',
    u_normalMapScale: 'float',
    u_transparencyFactor: 'float',
    u_alphaCutoff: 'float',
    u_shininess: 'float',
    u_reflectivity: 'float',
    u_refractRatio: 'float',
    u_refractivity: 'float',
    u_metallic: 'float',
    u_roughness: 'float',
    u_occlusionStrength: 'float',
    u_diffuseEnvIntensity: 'float',
    u_specularEnvIntensity: 'float',
    u_specularEnvMapMipCount: 'float',
    u_glossiness: 'float',
    u_clearcoatFactor: 'float',
    u_clearcoatRoughnessFactor: 'float',
    u_clearcoatNormalScale: 'float',
    u_anisotropyStrength: 'float',
    u_anisotropyRotation: 'float',
    u_transmissionFactor: 'float',
    u_thicknessFactor: 'float',
    u_attenuationDistance: 'float',
    u_ior: 'float',
    u_iridescenceFactor: 'float',
    u_iridescenceIor: 'float',
    u_iridescenceThicknessMinimum: 'float',
    u_iridescenceThicknessMaximum: 'float',
    u_attenuationColor: 'vec4'
});

/** Per-texture-slot metadata kept separate from the stable scalar material ABI. */
export const materialTextureBlockLayout = createStd140Layout({
    u_materialTextureTransforms: { type: 'mat3', arrayLength: MATERIAL_TEXTURE_SLOT_COUNT },
    u_materialTextureInfo: { type: 'vec4', arrayLength: MATERIAL_TEXTURE_SLOT_COUNT },
    u_materialTextureChannels: { type: 'ivec4', arrayLength: MATERIAL_TEXTURE_SLOT_COUNT }
});

export const modelBlockLayout = createStd140Layout({
    u_modelMatrix: 'mat4',
    u_previousModelMatrix: 'mat4',
    u_normalWorldMatrix: 'mat3',
    u_objectIdColor: 'vec4'
});

export const geometryBlockLayout = createStd140Layout({
    u_positionDecodeMat: 'mat4',
    u_normalDecodeMat: 'mat4',
    u_uvDecodeMat: 'mat3',
    u_uv1DecodeMat: 'mat3'
});

export const skinningBlockLayout = createStd140Layout({
    u_jointMat: { type: 'mat4', arrayLength: MAX_SKIN_JOINTS },
    u_previousJointMat: { type: 'mat4', arrayLength: MAX_SKIN_JOINTS }
});

export const morphBlockLayout = createStd140Layout({
    u_morphWeights0: 'vec4',
    u_morphWeights1: 'vec4',
    u_previousMorphWeights0: 'vec4',
    u_previousMorphWeights1: 'vec4'
});

export const instanceBlockLayout = createStd140Layout({
    u_instanceModelMatrices: { type: 'mat4', arrayLength: MAX_INSTANCES_PER_DRAW },
    u_previousInstanceModelMatrices: { type: 'mat4', arrayLength: MAX_INSTANCES_PER_DRAW },
    u_instanceNormalMatrices: { type: 'mat4', arrayLength: MAX_INSTANCES_PER_DRAW }
});

export const BUILT_IN_UNIFORM_BLOCK_LAYOUTS: Readonly<Record<string, Std140Layout>> = Object.freeze(
    {
        FrameBlock: frameBlockLayout,
        CameraBlock: cameraBlockLayout,
        SceneBlock: sceneBlockLayout,
        LightBlock: lightBlockLayout,
        MaterialBlock: materialBlockLayout,
        MaterialTextureBlock: materialTextureBlockLayout,
        ModelBlock: modelBlockLayout,
        GeometryBlock: geometryBlockLayout,
        SkinningBlock: skinningBlockLayout,
        MorphBlock: morphBlockLayout,
        InstanceBlock: instanceBlockLayout
    }
);

export function paddedStd140Value(
    layout: Std140Layout,
    fieldName: string,
    value: unknown
): Std140Value | null {
    const field = layout.fields[fieldName];
    if (!field || value === undefined || value === null) return null;
    const requiredLength = field.componentCount * field.arrayLength;
    if (typeof value === 'number' || typeof value === 'boolean') {
        if (requiredLength === 1) return value;
        const result = new Float32Array(requiredLength);
        result[0] = Number(value);
        return result;
    }
    if (!Array.isArray(value) && !ArrayBuffer.isView(value)) {
        if (typeof value !== 'object') return null;
        const elements: unknown = Reflect.get(value, 'elements');
        if (!Array.isArray(elements) && !ArrayBuffer.isView(elements)) return null;
        value = elements;
    }
    if (value instanceof DataView) return null;
    const arrayValue = value as ArrayLike<unknown>;
    if (arrayValue.length === requiredLength) {
        let isNumeric = true;
        let index = 0;
        while (index < arrayValue.length) {
            const item = arrayValue[index];
            if (typeof item !== 'number' && typeof item !== 'boolean') {
                isNumeric = false;
                break;
            }
            index++;
        }
        if (isNumeric) return arrayValue as ArrayLike<number | boolean>;
    }
    const values = Array.from(arrayValue, Number);
    if (values.length > requiredLength) {
        throw new RangeError(
            `${fieldName} provides ${String(values.length)} values; the fixed graphics ABI allows ${String(requiredLength)}`
        );
    }
    const result = new Float32Array(requiredLength);
    result.set(values);
    return result;
}
