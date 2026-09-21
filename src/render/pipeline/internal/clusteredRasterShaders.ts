import { DDGI_GLSL_SAMPLING_SOURCE } from '../../gi/DynamicGlobalIllumination';
import type Fog from '../../../core/Fog';
import type Mesh from '../../../core/Mesh';
import LightManager from '../../../light/LightManager';
import type PBRMaterial from '../../../material/PBRMaterial';
import Shader from '../../../shader/Shader';
import pbrBrdfSource from '../../../shader/chunk/pbr_brdf.glsl';
import pbrSurfaceSource from '../../../shader/chunk/pbr_surface.glsl';
import encodingSource from '../../../shader/method/encoding.glsl';
import getAreaLightSource from '../../../shader/method/getAreaLight.glsl';
import portableCoordinatesSource from '../../../shader/method/portableCoordinates.glsl';
import type { ShaderReadBinding } from '../../compute/ComputeShader';
import StorageGraphicsShader, {
    createStorageGraphicsShaderFromPortable
} from '../../compute/StorageGraphicsShader';
import {
    prepareGLSLForNaga,
    type GlslSamplerType,
    type WebGPUSamplerBinding
} from '../../shader/GlslToWgsl';
import {
    getWebGPUSceneTextureBinding,
    getWebGPUUniformBlockBinding
} from '../../shader/WebGPUBindingLayout';
import { PBR_GPU_MATERIAL_RECORD_BYTES } from '../../renderer/PBRGPUMaterialRecord';
import {
    MAX_DIRECTIONAL_LIGHTS,
    MAX_DIRECTIONAL_SHADOW_CASCADES,
    MAX_SPOT_LIGHTS
} from '../../ubo/BuiltInUniformBlocks';
import type { GPUDrivenVertexBufferLayout } from '../passes';
import type { VirtualShadowMapSettings } from '../VirtualShadowMaps';
import {
    FRAME_RECORD_BYTES,
    LIGHT_RECORD_BYTES,
    OBJECT_MOTION_CHANGED_FLAG,
    OBJECT_MOTION_HISTORY_FLAG,
    SHADOW_ATLAS_RECTS_VEC4,
    SHADOW_ATLAS_SIZE_VEC4,
    SHADOW_METADATA_VEC4,
    SHADOW_DIRECTIONAL_SPLITS_VEC4,
    SHADOW_DIRECTIONAL_PARAMS_VEC4,
    SHADOW_DIRECTIONAL_MATRICES_VEC4,
    SHADOW_SPOT_MATRICES_VEC4,
    SHADOW_POINT_MATRICES_VEC4,
    SHADOW_DIRECTIONAL_BIASES_VEC4,
    SHADOW_SPOT_BIASES_VEC4,
    SHADOW_POINT_BIASES_VEC4,
    LIGHT_COOKIE_FLAG,
    LIGHT_IES_FLAG,
    LIGHT_RECORD_FLOATS,
    OBJECT_RECEIVE_SHADOW_FLAG
} from './clusteredLayout';
import type {
    PBRMaterialVariant,
    PBRTextureRole,
    PBRTextureBinding
} from './clusteredMaterialVariants';

/** Storage raster variants, shader caches, and vertex layouts used by Clustered rendering. */

const CLUSTERED_AREA_LIGHT_SOURCE = getAreaLightSource
    .replace(
        'texture(areaLightsLtcTexture1, hiloTextureUV(uv))',
        'textureLod(areaLightsLtcTexture1, hiloTextureUV(uv), 0.0)'
    )
    .replace(
        'texture(areaLightsLtcTexture2, hiloTextureUV(uv))',
        'textureLod(areaLightsLtcTexture2, hiloTextureUV(uv), 0.0)'
    );

const CLUSTERED_SCENE_LIGHT_MANAGER = new LightManager();

const CLUSTERED_TRANSPARENT_SHADER_CACHE = new WeakMap<Shader, StorageGraphicsShader>();

function clusteredTransparentFragmentSource(source: string): string {
    return source
        .replace(
            'texture(areaLightsLtcTexture1, hiloTextureUV(uv))',
            'textureLod(areaLightsLtcTexture1, hiloTextureUV(uv), 0.0)'
        )
        .replace(
            'texture(areaLightsLtcTexture2, hiloTextureUV(uv))',
            'textureLod(areaLightsLtcTexture2, hiloTextureUV(uv), 0.0)'
        );
}

function sampledTextureViewDimension(type: GlslSamplerType): '2d' | '2d-array' | '3d' | 'cube' {
    if (type.includes('2DArray')) return '2d-array';
    if (type.includes('3D')) return '3d';
    if (type.includes('Cube')) return 'cube';
    return '2d';
}

function sampledTextureSampleType(
    name: string,
    type: GlslSamplerType
): 'float' | 'unfilterable-float' | 'depth' | 'sint' | 'uint' {
    if (type.endsWith('Shadow')) return 'depth';
    if (type.startsWith('isampler')) return 'sint';
    if (type.startsWith('usampler')) return 'uint';
    if (name === 'u_areaLightsLtcTexture1' || name === 'u_areaLightsLtcTexture2') {
        return 'unfilterable-float';
    }
    return 'float';
}

function appendStorageSamplerBindings(
    bindings: ShaderReadBinding[],
    sampler: Readonly<WebGPUSamplerBinding>
): void {
    if (sampler.arrayIndex !== 0) {
        throw new TypeError(
            `Clustered transparent sampler arrays are unsupported (${sampler.name}[${String(sampler.arrayIndex)}])`
        );
    }
    bindings.push({
        name: sampler.name,
        group: sampler.group,
        binding: sampler.textureBinding,
        kind: 'sampled-texture',
        sampleType: sampledTextureSampleType(sampler.name, sampler.type),
        viewDimension: sampledTextureViewDimension(sampler.type)
    });
    bindings.push({
        name: sampler.name,
        group: sampler.group,
        binding: sampler.samplerBinding,
        kind: sampler.type.endsWith('Shadow') ? 'comparison-sampler' : 'sampler'
    });
}

export function clusteredTransparentShader(
    mesh: Mesh,
    material: PBRMaterial,
    fog: Fog | null,
    withShadows: boolean,
    withDynamicGlobalIllumination = false,
    giSurface = false
): StorageGraphicsShader {
    let header = Shader.getHeader(
        mesh,
        material,
        CLUSTERED_SCENE_LIGHT_MANAGER,
        fog,
        false,
        'forward'
    );
    header += '#define HILO_CLUSTERED_FORWARD 1\n';
    if (withDynamicGlobalIllumination) header += '#define HILO_DYNAMIC_GI 1\n';
    if (giSurface) header += '#define HILO_DDGI_SURFACE 1\n';
    if (withShadows && mesh.receiveShadows) {
        header += '#define HILO_CLUSTERED_SHADOWS 1\n';
    }
    const baseShader = Shader.getBasicShader(material, false, header, undefined, 'forward');
    const cached = CLUSTERED_TRANSPARENT_SHADER_CACHE.get(baseShader);
    if (cached !== undefined) return cached;
    const prepared = prepareGLSLForNaga(
        baseShader.vs,
        baseShader.fs,
        getWebGPUUniformBlockBinding,
        { resolveSamplerBinding: getWebGPUSceneTextureBinding }
    );
    const bindings: ShaderReadBinding[] = prepared.uniformBlocks.map(block => ({
        name: block.name,
        group: block.group,
        binding: block.binding,
        kind: 'uniform-buffer'
    }));
    for (const sampler of prepared.samplers) appendStorageSamplerBindings(bindings, sampler);
    bindings.push(
        {
            name: 'clusterFrameData',
            group: 3,
            binding: 0,
            kind: 'read-only-storage-buffer',
            minBindingSize: FRAME_RECORD_BYTES
        },
        {
            name: 'clusterLights',
            group: 3,
            binding: 1,
            kind: 'read-only-storage-buffer',
            minBindingSize: LIGHT_RECORD_BYTES
        },
        {
            name: 'clusterLightGrid',
            group: 3,
            binding: 2,
            kind: 'read-only-storage-buffer',
            minBindingSize: 8
        },
        {
            name: 'clusterLightIndices',
            group: 3,
            binding: 3,
            kind: 'read-only-storage-buffer',
            minBindingSize: 4
        }
    );
    if (withDynamicGlobalIllumination) {
        bindings.push({
            name: 'ddgiProbes',
            group: 3,
            binding: 4,
            kind: 'read-only-storage-buffer'
        });
    }
    let fragmentSource = clusteredTransparentFragmentSource(baseShader.fs);
    if (withDynamicGlobalIllumination) {
        for (const marker of [
            'void main(void)',
            'vec3 diffuseLighting = directDiffuse + indirectDiffuse;'
        ]) {
            const index = fragmentSource.indexOf(marker);
            if (index < 0 || fragmentSource.includes(marker, index + marker.length)) {
                throw new Error(
                    `DDGI shared PBR integration requires one shader marker: ${marker}`
                );
            }
        }
        fragmentSource = fragmentSource
            .replace(
                'void main(void)',
                `
${DDGI_GLSL_SAMPLING_SOURCE}
void main(void)`
            )
            .replace(
                'vec3 diffuseLighting = directDiffuse + indirectDiffuse;',
                `
mat4 ddgiInverseView = inverse(mat4(clusterFrameData.values[8u], clusterFrameData.values[9u],
    clusterFrameData.values[10u], clusterFrameData.values[11u]));
vec4 ddgiSample = hiloDDGISample((ddgiInverseView * vec4(v_fragPos, 1.0)).xyz,
    normalize(mat3(ddgiInverseView) * N), normalize(mat3(ddgiInverseView) * V));
vec3 ddgiDiffuseContribution = ddgiSample.rgb * iblDiffuseColor * materialAmbientOcclusion * gtaoDiffuseVisibility;
indirectDiffuse = indirectDiffuse * (1.0 - ddgiSample.a) + ddgiDiffuseContribution;
vec3 diffuseLighting = directDiffuse + indirectDiffuse;`
            );
    }
    if (giSurface) {
        fragmentSource = fragmentSource
            .replace(
                'void main(void)',
                'layout(location=1) out vec4 ddgiDiffuseAlbedo;\nvoid main(void)'
            )
            .replace(
                'vec3 diffuseLighting = directDiffuse + indirectDiffuse;',
                `
    float ddgiLayerTransmission = 1.0;
    #ifdef HILO_HAS_CLEARCOAT
        ddgiLayerTransmission *= 1.0 - clearcoatFactor * hiloFresnelSchlickScalar(0.04, max(abs(dot(clearcoatNormal, V)), 1e-4));
    #endif
    #ifdef HILO_HAS_FOG
        float ddgiFogTransmission = 1.0;
        #ifdef HILO_FOG_LINEAR
            ddgiFogTransmission = (u_fogInfo.y - v_dist) / (u_fogInfo.y - u_fogInfo.x);
        #elif defined(HILO_FOG_EXP)
            ddgiFogTransmission = exp(-abs(u_fogInfo.x * v_dist));
        #elif defined(HILO_FOG_EXP2)
            ddgiFogTransmission = exp(-(u_fogInfo.x * v_dist) * (u_fogInfo.x * v_dist));
        #endif
        ddgiLayerTransmission *= clamp(ddgiFogTransmission, 0.0, 1.0);
    #endif
    hilo_FragColor = vec4(ddgiDiffuseContribution * ddgiLayerTransmission, ddgiSample.a);
    ddgiDiffuseAlbedo = vec4(iblDiffuseColor * materialAmbientOcclusion * gtaoDiffuseVisibility * ddgiLayerTransmission, 1.0);
    return;
    vec3 diffuseLighting = directDiffuse + indirectDiffuse;`
            );
    }
    const result = createStorageGraphicsShaderFromPortable({
        label: `Clustered transparent PBR (${material.definition.id})`,
        portableVertexSource: baseShader.vs,
        portableFragmentSource: fragmentSource,
        bindings
    });
    CLUSTERED_TRANSPARENT_SHADER_CACHE.set(baseShader, result);
    return result;
}

// The depth prepass and color pass must use a byte-identical clip-space expression. Splitting the
// multiplication at worldPosition changes floating-point rounding and makes the later depth test
// reject fragments as camera matrices move, producing holes even though both passes draw the same
// geometry.
const GPU_SCENE_POSITION_TRANSFORM_SOURCE = `
mat4 readObjectMatrix(uint base) {
    return mat4(objects.values[base], objects.values[base + 1u], objects.values[base + 2u], objects.values[base + 3u]);
}
mat4 readFrameMatrix(uint base) {
    return mat4(frameData.values[base], frameData.values[base + 1u], frameData.values[base + 2u], frameData.values[base + 3u]);
}
vec4 gpuSceneClipPosition(uint objectBase, vec3 position) {
    return readFrameMatrix(0u) * readObjectMatrix(objectBase) * vec4(position, 1.0);
}`;

const GPU_SCENE_VISIBLE_INDEX_SOURCE = `
uint gpuSceneVisibleObjectIndex() {
    return visibleIndices.values[visibleOffset.value + uint(gl_InstanceIndex)];
}`;

const GPU_SCENE_DEPTH_SHADER = new StorageGraphicsShader({
    label: 'GPU Scene indirect depth prepass',
    vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(std430) readonly buffer VisibleOffsetBlock { uint value; } visibleOffset;
layout(location=0) in vec3 a_position;
${GPU_SCENE_POSITION_TRANSFORM_SOURCE}
${GPU_SCENE_VISIBLE_INDEX_SOURCE}
void main() {
    uint objectIndex = gpuSceneVisibleObjectIndex();
    uint objectBase = objectIndex * 13u;
    gl_Position = gpuSceneClipPosition(objectBase, a_position);
}`,
    fragmentSource: `#version 310 es
precision highp float;
void main() {}`,
    bindings: [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        {
            name: 'visibleOffset',
            group: 0,
            binding: 3,
            kind: 'read-only-storage-buffer',
            minBindingSize: 4
        }
    ]
});

const GPU_SCENE_TEMPORAL_DEPTH_SHADER = new StorageGraphicsShader({
    label: 'GPU Scene fused depth and temporal motion prepass',
    vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(std430) readonly buffer VisibleOffsetBlock { uint value; } visibleOffset;
layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;
layout(std430) readonly buffer PreviousVisibilityBlock { uint values[]; } previousVisibility;
layout(location=0) in vec3 a_position;
out vec4 v_currentClipPosition;
out vec4 v_previousClipPosition;
out float v_currentViewDepth;
out float v_previousViewDepth;
flat out float v_motionHistoryValid;
flat out float v_temporalReactiveFactor;
${GPU_SCENE_POSITION_TRANSFORM_SOURCE}
${GPU_SCENE_VISIBLE_INDEX_SOURCE}
void main() {
    uint objectIndex = gpuSceneVisibleObjectIndex();
    uint objectBase = objectIndex * 13u;
    uint flags = floatBitsToUint(objects.values[objectBase + 12u].z);
    uint materialIndex = floatBitsToUint(objects.values[objectBase + 12u].w);
    mat4 currentModel = readObjectMatrix(objectBase);
    mat4 previousModel = (flags & ${String(OBJECT_MOTION_CHANGED_FLAG)}u) != 0u
        ? readObjectMatrix(objectBase + 4u)
        : currentModel;
    vec4 localPosition = vec4(a_position, 1.0);
    gl_Position = gpuSceneClipPosition(objectBase, a_position);
    v_currentClipPosition = gl_Position;
    v_previousClipPosition = readFrameMatrix(4u) * previousModel * localPosition;
    v_currentViewDepth = abs((readFrameMatrix(8u) * currentModel * localPosition).z);
    v_previousViewDepth = abs((readFrameMatrix(16u) * previousModel * localPosition).z);
    bool cameraHistoryValid = floatBitsToUint(frameData.values[30u].z) != 0u;
    v_motionHistoryValid =
        cameraHistoryValid &&
        (flags & ${String(OBJECT_MOTION_HISTORY_FLAG)}u) != 0u &&
        previousVisibility.values[objectIndex] != 0u
            ? 1.0
            : 0.0;
    v_temporalReactiveFactor = materials.values[materialIndex * ${String(PBR_GPU_MATERIAL_RECORD_BYTES / 16)}u + 2u].w;
}`,
    fragmentSource: `#version 310 es
precision highp float;
${portableCoordinatesSource}
in vec4 v_currentClipPosition;
in vec4 v_previousClipPosition;
in float v_currentViewDepth;
in float v_previousViewDepth;
flat in float v_motionHistoryValid;
flat in float v_temporalReactiveFactor;
layout(location=0) out vec4 motionData;
layout(location=1) out float reactiveMask;
void main() {
    reactiveMask = clamp(v_temporalReactiveFactor, 0.0, 1.0);
    float currentLogDepth = log2(1.0 + max(v_currentViewDepth, 0.0));
    if (
        v_motionHistoryValid < 0.5 ||
        v_currentClipPosition.w <= 1e-6 ||
        v_previousClipPosition.w <= 1e-6
    ) {
        motionData = vec4(0.0, 0.0, -1.0, currentLogDepth);
        return;
    }
    vec2 currentUV = hiloRenderTargetUV(
        v_currentClipPosition.xy / v_currentClipPosition.w * 0.5 + 0.5
    );
    vec2 previousUV = hiloRenderTargetUV(
        v_previousClipPosition.xy / v_previousClipPosition.w * 0.5 + 0.5
    );
    motionData = vec4(
        currentUV - previousUV,
        log2(1.0 + max(v_previousViewDepth, 0.0)),
        currentLogDepth
    );
}`,
    bindings: [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        {
            name: 'visibleOffset',
            group: 0,
            binding: 3,
            kind: 'read-only-storage-buffer',
            minBindingSize: 4
        },
        { name: 'materials', group: 0, binding: 4, kind: 'read-only-storage-buffer' },
        { name: 'previousVisibility', group: 0, binding: 5, kind: 'read-only-storage-buffer' }
    ]
});

const GPU_SCENE_PBR_SHADER_CACHE = new Map<string, StorageGraphicsShader>();

const GPU_SCENE_ATTRIBUTES_SHADER_CACHE = new Map<string, StorageGraphicsShader>();

const GPU_SCENE_MASKED_DEPTH_SHADER_CACHE = new Map<string, StorageGraphicsShader>();

function variantTexture(
    variant: Readonly<PBRMaterialVariant>,
    role: PBRTextureRole
): PBRTextureBinding | null {
    return variant.textures.find(binding => binding.role === role) ?? null;
}

function variantSampleUV(binding: Readonly<PBRTextureBinding>): string {
    return binding.uv === 0 ? 'v_uv0' : 'v_uv1';
}

export function coverageTextures(
    variant: Readonly<PBRMaterialVariant>
): readonly Readonly<PBRTextureBinding>[] {
    return variant.textures.filter(
        binding => binding.role === 'baseColorMap' || binding.role === 'opacityMap'
    );
}

export function gpuSceneMaskedDepthShader(
    variant: Readonly<PBRMaterialVariant>,
    temporal: boolean
): StorageGraphicsShader {
    if (variant.coverageMode !== 'mask') {
        return temporal ? GPU_SCENE_TEMPORAL_DEPTH_SHADER : GPU_SCENE_DEPTH_SHADER;
    }
    const cacheKey = `${variant.key}|temporal=${temporal ? '1' : '0'}`;
    const cached = GPU_SCENE_MASKED_DEPTH_SHADER_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;
    const textures = coverageTextures(variant);
    const baseColorMap = textures.find(binding => binding.role === 'baseColorMap') ?? null;
    const opacityMap = textures.find(binding => binding.role === 'opacityMap') ?? null;
    const usesUV0 = textures.some(binding => binding.uv === 0);
    const usesUV1 = textures.some(binding => binding.uv === 1);
    const textureDeclarations = textures
        .map(binding => `uniform sampler2D ${binding.shaderName};`)
        .join('\n');
    const vertexUVDeclarations = [
        usesUV0 ? 'layout(location=2) in vec2 a_uv0;\nout vec2 v_uv0;' : '',
        usesUV1 ? 'layout(location=3) in vec2 a_uv1;\nout vec2 v_uv1;' : ''
    ]
        .filter(Boolean)
        .join('\n');
    const fragmentUVDeclarations = [
        usesUV0 ? 'in vec2 v_uv0;' : '',
        usesUV1 ? 'in vec2 v_uv1;' : ''
    ]
        .filter(Boolean)
        .join('\n');
    const vertexUVWrites = [usesUV0 ? 'v_uv0 = a_uv0;' : '', usesUV1 ? 'v_uv1 = a_uv1;' : '']
        .filter(Boolean)
        .join('\n    ');
    const materialSample = (binding: Readonly<PBRTextureBinding>): string =>
        `hiloMaterialSample(${binding.shaderName}, materialBase, ${String(binding.slotIndex)}u, ${variantSampleUV(binding)})`;
    const temporalVertexDeclarations = temporal
        ? `out vec4 v_currentClipPosition;
out vec4 v_previousClipPosition;
out float v_currentViewDepth;
out float v_previousViewDepth;
flat out float v_motionHistoryValid;
flat out float v_temporalReactiveFactor;`
        : '';
    const temporalVertexWrites = temporal
        ? `mat4 currentModel = readObjectMatrix(objectBase);
    mat4 previousModel = (flags & ${String(OBJECT_MOTION_CHANGED_FLAG)}u) != 0u
        ? readObjectMatrix(objectBase + 4u)
        : currentModel;
    vec4 localPosition = vec4(a_position, 1.0);
    v_currentClipPosition = gl_Position;
    v_previousClipPosition = readFrameMatrix(4u) * previousModel * localPosition;
    v_currentViewDepth = abs((readFrameMatrix(8u) * currentModel * localPosition).z);
    v_previousViewDepth = abs((readFrameMatrix(16u) * previousModel * localPosition).z);
    bool cameraHistoryValid = floatBitsToUint(frameData.values[30u].z) != 0u;
    v_motionHistoryValid =
        cameraHistoryValid &&
        (flags & ${String(OBJECT_MOTION_HISTORY_FLAG)}u) != 0u &&
        previousVisibility.values[objectIndex] != 0u
            ? 1.0
            : 0.0;
    v_temporalReactiveFactor = materials.values[
        v_materialIndex * ${String(PBR_GPU_MATERIAL_RECORD_BYTES / 16)}u + 2u
    ].w;`
        : '';
    const temporalFragmentDeclarations = temporal
        ? `${portableCoordinatesSource}
in vec4 v_currentClipPosition;
in vec4 v_previousClipPosition;
in float v_currentViewDepth;
in float v_previousViewDepth;
flat in float v_motionHistoryValid;
flat in float v_temporalReactiveFactor;
layout(location=0) out vec4 motionData;
layout(location=1) out float reactiveMask;`
        : '';
    const temporalFragmentWrite = temporal
        ? `reactiveMask = clamp(v_temporalReactiveFactor, 0.0, 1.0);
    float currentLogDepth = log2(1.0 + max(v_currentViewDepth, 0.0));
    if (
        v_motionHistoryValid < 0.5 ||
        v_currentClipPosition.w <= 1e-6 ||
        v_previousClipPosition.w <= 1e-6
    ) {
        motionData = vec4(0.0, 0.0, -1.0, currentLogDepth);
        return;
    }
    vec2 currentUV = hiloRenderTargetUV(
        v_currentClipPosition.xy / v_currentClipPosition.w * 0.5 + 0.5
    );
    vec2 previousUV = hiloRenderTargetUV(
        v_previousClipPosition.xy / v_previousClipPosition.w * 0.5 + 0.5
    );
    motionData = vec4(
        currentUV - previousUV,
        log2(1.0 + max(v_previousViewDepth, 0.0)),
        currentLogDepth
    );`
        : '';
    const bindings: ShaderReadBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        {
            name: 'visibleOffset',
            group: 0,
            binding: 3,
            kind: 'read-only-storage-buffer',
            minBindingSize: 4
        },
        { name: 'materials', group: 0, binding: 4, kind: 'read-only-storage-buffer' }
    ];
    if (temporal) {
        bindings.push({
            name: 'previousVisibility',
            group: 0,
            binding: 5,
            kind: 'read-only-storage-buffer'
        });
    }
    for (let index = 0; index < textures.length; index += 1) {
        const texture = textures[index];
        if (texture === undefined) continue;
        bindings.push(
            {
                name: texture.shaderName,
                group: 1,
                binding: index * 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: texture.shaderName,
                group: 1,
                binding: index * 2 + 1,
                kind: 'sampler'
            }
        );
    }
    const shader = new StorageGraphicsShader({
        label: `GPU Scene masked ${temporal ? 'temporal ' : ''}depth (${variant.key})`,
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(std430) readonly buffer VisibleOffsetBlock { uint value; } visibleOffset;
layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;
${temporal ? 'layout(std430) readonly buffer PreviousVisibilityBlock { uint values[]; } previousVisibility;' : ''}
layout(location=0) in vec3 a_position;
${vertexUVDeclarations}
flat out uint v_materialIndex;
${temporalVertexDeclarations}
${GPU_SCENE_POSITION_TRANSFORM_SOURCE}
${GPU_SCENE_VISIBLE_INDEX_SOURCE}
void main() {
    uint objectIndex = gpuSceneVisibleObjectIndex();
    uint objectBase = objectIndex * 13u;
    uint flags = floatBitsToUint(objects.values[objectBase + 12u].z);
    gl_Position = gpuSceneClipPosition(objectBase, a_position);
    v_materialIndex = floatBitsToUint(objects.values[objectBase + 12u].w);
    ${vertexUVWrites}
    ${temporalVertexWrites}
}`,
        fragmentSource: `#version 310 es
precision highp float;
precision highp int;
layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;
${textureDeclarations}
${fragmentUVDeclarations}
flat in uint v_materialIndex;
${temporalFragmentDeclarations}
${encodingSource}
float hiloMaterialChannel(vec4 value, int channel) {
    if (channel == 0) return value.r;
    if (channel == 1) return value.g;
    if (channel == 2) return value.b;
    if (channel == 3) return value.a;
    return channel == 5 ? 1.0 : 0.0;
}
vec4 hiloMaterialSample(sampler2D source, uint materialBase, uint slotIndex, vec2 uv) {
    uint slotBase = materialBase + 4u + slotIndex * 5u;
    mat3 transform = mat3(
        materials.values[slotBase].xyz,
        materials.values[slotBase + 1u].xyz,
        materials.values[slotBase + 2u].xyz
    );
    vec4 info = materials.values[slotBase + 3u];
    vec4 sampled = texture(source, (transform * vec3(uv, 1.0)).xy);
    if (int(info.y) == 1) sampled = sRGBToLinear(sampled);
    ivec4 channels = ivec4(materials.values[slotBase + 4u]);
    return vec4(
        hiloMaterialChannel(sampled, channels.x),
        hiloMaterialChannel(sampled, channels.y),
        hiloMaterialChannel(sampled, channels.z),
        hiloMaterialChannel(sampled, channels.w)
    );
}
void main() {
    uint materialBase = v_materialIndex * ${String(PBR_GPU_MATERIAL_RECORD_BYTES / 16)}u;
    float opacity = materials.values[materialBase + 3u].x;
    vec4 baseColorSample = vec4(1.0);
    ${baseColorMap === null ? '' : `baseColorSample = ${materialSample(baseColorMap)};`}
    float coverageAlpha = baseColorSample.a * opacity;
    ${opacityMap === null ? '' : `coverageAlpha *= ${materialSample(opacityMap)}.r;`}
    if (coverageAlpha < ${String(variant.alphaCutoff)}) discard;
    ${temporalFragmentWrite}
}`,
        bindings
    });
    GPU_SCENE_MASKED_DEPTH_SHADER_CACHE.set(cacheKey, shader);
    return shader;
}

const GPU_SCENE_VIRTUAL_SHADOW_SHADER_CACHE = new Map<string, StorageGraphicsShader>();

function virtualShadowVertexTransformSource(settings: Readonly<VirtualShadowMapSettings>): string {
    return `
mat4 hiloVirtualShadowMatrix(uint mapIndex) {
    uint base = 13u + mapIndex * 5u;
    return mat4(
        clipmapData.values[base],
        clipmapData.values[base + 1u],
        clipmapData.values[base + 2u],
        clipmapData.values[base + 3u]
    );
}
vec4 hiloVirtualShadowAtlasPosition(vec4 clipPosition, vec2 logicalPage, uint physicalIndex) {
    vec2 logicalUV = vec2(
        clipPosition.x / clipPosition.w * 0.5 + 0.5,
        0.5 - clipPosition.y / clipPosition.w * 0.5
    );
    v_virtualPageUV = logicalUV * ${String(settings.virtualPageGridSize)}.0 - logicalPage;
    vec2 pageNDC = vec2(v_virtualPageUV.x * 2.0 - 1.0, 1.0 - v_virtualPageUV.y * 2.0);
    uint column = physicalIndex % ${String(settings.physicalPageColumns)}u;
    uint row = physicalIndex / ${String(settings.physicalPageColumns)}u;
    vec2 atlasUV = (vec2(float(column), float(row)) + pageNDC * 0.5 + 0.5) /
        vec2(${String(settings.physicalPageColumns)}.0, ${String(settings.physicalPageRows)}.0);
    vec2 atlasNDC = vec2(atlasUV.x * 2.0 - 1.0, 1.0 - atlasUV.y * 2.0);
    return vec4(atlasNDC * clipPosition.w, clipPosition.zw);
}`;
}

export function gpuSceneVirtualShadowShader(
    variant: Readonly<PBRMaterialVariant>,
    settings: Readonly<VirtualShadowMapSettings>
): StorageGraphicsShader {
    const cacheKey = `${variant.key}|${String(settings.virtualResolution)}|${String(settings.pageSize)}|${String(settings.physicalPageCount)}`;
    const cached = GPU_SCENE_VIRTUAL_SHADOW_SHADER_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;
    const textures = coverageTextures(variant);
    const baseColorMap = textures.find(binding => binding.role === 'baseColorMap') ?? null;
    const opacityMap = textures.find(binding => binding.role === 'opacityMap') ?? null;
    const usesUV0 = textures.some(binding => binding.uv === 0);
    const usesUV1 = textures.some(binding => binding.uv === 1);
    const textureDeclarations = textures
        .map(binding => `uniform sampler2D ${binding.shaderName};`)
        .join('\n');
    const vertexUVDeclarations = [
        usesUV0 ? 'layout(location=2) in vec2 a_uv0;\nout vec2 v_uv0;' : '',
        usesUV1 ? 'layout(location=3) in vec2 a_uv1;\nout vec2 v_uv1;' : ''
    ]
        .filter(Boolean)
        .join('\n');
    const fragmentUVDeclarations = [
        usesUV0 ? 'in vec2 v_uv0;' : '',
        usesUV1 ? 'in vec2 v_uv1;' : ''
    ]
        .filter(Boolean)
        .join('\n');
    const vertexUVWrites = [usesUV0 ? 'v_uv0 = a_uv0;' : '', usesUV1 ? 'v_uv1 = a_uv1;' : '']
        .filter(Boolean)
        .join('\n    ');
    const materialSample = (binding: Readonly<PBRTextureBinding>): string =>
        `hiloMaterialSample(${binding.shaderName}, materialBase, ${String(binding.slotIndex)}u, ${variantSampleUV(binding)})`;
    const bindings: ShaderReadBinding[] = [
        { name: 'clipmapData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        {
            name: 'physicalPage',
            group: 0,
            binding: 1,
            kind: 'read-only-storage-buffer',
            minBindingSize: 32
        },
        { name: 'objects', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
        {
            name: 'visibleOffset',
            group: 0,
            binding: 4,
            kind: 'read-only-storage-buffer',
            minBindingSize: 4
        }
    ];
    if (variant.coverageMode === 'mask') {
        bindings.push({
            name: 'materials',
            group: 0,
            binding: 5,
            kind: 'read-only-storage-buffer'
        });
    }
    for (let index = 0; index < textures.length; index += 1) {
        const texture = textures[index];
        if (texture === undefined) continue;
        bindings.push(
            {
                name: texture.shaderName,
                group: 1,
                binding: index * 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: texture.shaderName,
                group: 1,
                binding: index * 2 + 1,
                kind: 'sampler'
            }
        );
    }
    const shader = new StorageGraphicsShader({
        label: `GPU Scene virtual shadow depth (${variant.key})`,
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer ClipmapDataBlock { vec4 values[]; } clipmapData;
layout(std430) readonly buffer PhysicalPageBlock { uvec4 values[]; } physicalPage;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(std430) readonly buffer VisibleOffsetBlock { uint value; } visibleOffset;
layout(location=0) in vec3 a_position;
${vertexUVDeclarations}
out vec2 v_virtualPageUV;
${variant.coverageMode === 'mask' ? 'flat out uint v_materialIndex;' : ''}
mat4 readObjectMatrix(uint base) {
    return mat4(
        objects.values[base],
        objects.values[base + 1u],
        objects.values[base + 2u],
        objects.values[base + 3u]
    );
}
${GPU_SCENE_VISIBLE_INDEX_SOURCE}
${virtualShadowVertexTransformSource(settings)}
void main() {
    uint objectIndex = gpuSceneVisibleObjectIndex();
    uint objectBase = objectIndex * 13u;
    uint mapIndex = physicalPage.values[0].x;
    uint mapBase = 13u + mapIndex * 5u;
    ivec2 origin = ivec2(floatBitsToInt(clipmapData.values[mapBase + 4u].xy));
    ivec2 absolutePage = floatBitsToInt(uintBitsToFloat(physicalPage.values[0].yz));
    vec2 logicalPage = vec2(absolutePage - origin);
    vec4 worldPosition = readObjectMatrix(objectBase) * vec4(a_position, 1.0);
    vec4 lightClip = hiloVirtualShadowMatrix(mapIndex) * worldPosition;
    gl_Position = hiloVirtualShadowAtlasPosition(
        lightClip,
        logicalPage,
        physicalPage.values[1].w
    );
    ${variant.coverageMode === 'mask' ? 'v_materialIndex = floatBitsToUint(objects.values[objectBase + 12u].w);' : ''}
    ${vertexUVWrites}
}`,
        fragmentSource: `#version 310 es
precision highp float;
precision highp int;
in vec2 v_virtualPageUV;
${fragmentUVDeclarations}
${variant.coverageMode === 'mask' ? 'layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;\nflat in uint v_materialIndex;' : ''}
${textureDeclarations}
${variant.coverageMode === 'mask' ? encodingSource : ''}
${
    variant.coverageMode === 'mask'
        ? `float hiloMaterialChannel(vec4 value, int channel) {
    if (channel == 0) return value.r;
    if (channel == 1) return value.g;
    if (channel == 2) return value.b;
    if (channel == 3) return value.a;
    return channel == 5 ? 1.0 : 0.0;
}
vec4 hiloMaterialSample(sampler2D source, uint materialBase, uint slotIndex, vec2 uv) {
    uint slotBase = materialBase + 4u + slotIndex * 5u;
    mat3 transform = mat3(
        materials.values[slotBase].xyz,
        materials.values[slotBase + 1u].xyz,
        materials.values[slotBase + 2u].xyz
    );
    vec4 info = materials.values[slotBase + 3u];
    vec4 sampled = texture(source, (transform * vec3(uv, 1.0)).xy);
    if (int(info.y) == 1) sampled = sRGBToLinear(sampled);
    ivec4 channels = ivec4(materials.values[slotBase + 4u]);
    return vec4(
        hiloMaterialChannel(sampled, channels.x),
        hiloMaterialChannel(sampled, channels.y),
        hiloMaterialChannel(sampled, channels.z),
        hiloMaterialChannel(sampled, channels.w)
    );
}`
        : ''
}
void main() {
    if (any(lessThan(v_virtualPageUV, vec2(0.0))) || any(greaterThan(v_virtualPageUV, vec2(1.0)))) discard;
    ${
        variant.coverageMode === 'mask'
            ? `uint materialBase = v_materialIndex * ${String(PBR_GPU_MATERIAL_RECORD_BYTES / 16)}u;
    float coverageAlpha = materials.values[materialBase + 3u].x;
    ${baseColorMap === null ? '' : `coverageAlpha *= ${materialSample(baseColorMap)}.a;`}
    ${opacityMap === null ? '' : `coverageAlpha *= ${materialSample(opacityMap)}.r;`}
    if (coverageAlpha < ${String(variant.alphaCutoff)}) discard;`
            : ''
    }
}`,
        bindings
    });
    GPU_SCENE_VIRTUAL_SHADOW_SHADER_CACHE.set(cacheKey, shader);
    return shader;
}

export function virtualShadowClearShader(
    settings: Readonly<VirtualShadowMapSettings>
): StorageGraphicsShader {
    return new StorageGraphicsShader({
        label: 'Virtual shadow physical page depth clear',
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer ClipmapDataBlock { uvec4 values[]; } clipmapData;
layout(std430) readonly buffer PhysicalPageBlock { uvec4 values[]; } physicalPage;
out vec2 v_pageUV;
void main() {
    vec2 triangle = gl_VertexID == 0 ? vec2(-1.0, -1.0) :
        (gl_VertexID == 1 ? vec2(3.0, -1.0) : vec2(-1.0, 3.0));
    uint physicalIndex = physicalPage.values[1].w;
    uint column = physicalIndex % ${String(settings.physicalPageColumns)}u;
    uint row = physicalIndex / ${String(settings.physicalPageColumns)}u;
    vec2 atlasUV = (vec2(float(column), float(row)) + triangle * 0.5 + 0.5) /
        vec2(${String(settings.physicalPageColumns)}.0, ${String(settings.physicalPageRows)}.0);
    vec2 atlasNDC = vec2(atlasUV.x * 2.0 - 1.0, 1.0 - atlasUV.y * 2.0);
    float farNDC = clipmapData.values[2u].w == 0u ? 1.0 : -1.0;
    v_pageUV = triangle * 0.5 + 0.5;
    gl_Position = vec4(atlasNDC, farNDC, 1.0);
}`,
        fragmentSource: `#version 310 es
precision highp float;
in vec2 v_pageUV;
void main() {
    if (any(lessThan(v_pageUV, vec2(0.0))) || any(greaterThan(v_pageUV, vec2(1.0)))) discard;
}`,
        bindings: [
            { name: 'clipmapData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'physicalPage',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: 32
            }
        ]
    });
}

function gpuSceneVirtualShadowSource(settings: Readonly<VirtualShadowMapSettings>): string {
    return `
vec4 hiloVirtualShadowTableTexel(uint linearIndex) {
    uint width = ${String(settings.pageTableWidth)}u;
    return texelFetch(
        u_virtualShadowPageTable,
        ivec2(int(linearIndex % width), int(linearIndex / width)),
        0
    );
}
mat4 hiloVirtualShadowMapMatrix(uint mapIndex) {
    uint base = 13u + mapIndex * 5u;
    return mat4(
        hiloVirtualShadowTableTexel(base),
        hiloVirtualShadowTableTexel(base + 1u),
        hiloVirtualShadowTableTexel(base + 2u),
        hiloVirtualShadowTableTexel(base + 3u)
    );
}
mat4 hiloVirtualShadowInverseView() {
    return mat4(
        hiloVirtualShadowTableTexel(5u),
        hiloVirtualShadowTableTexel(6u),
        hiloVirtualShadowTableTexel(7u),
        hiloVirtualShadowTableTexel(8u)
    );
}
float hiloVirtualDirectionalShadow(int lightIndex, float bias, vec3 viewPosition) {
    vec4 config = hiloVirtualShadowTableTexel(0u);
    int lightCount = int(config.x + 0.5);
    int levels = int(config.y + 0.5);
    int grid = int(config.z + 0.5);
    if (lightIndex < 0 || lightIndex >= lightCount) return -1.0;
    vec4 world = hiloVirtualShadowInverseView() * vec4(viewPosition, 1.0);
    world /= max(abs(world.w), 0.000001) * sign(world.w);
    for (int level = 0; level < ${String(settings.directionalClipmapLevels)}; level++) {
        if (level >= levels) break;
        uint mapIndex = uint(lightIndex * levels + level);
        vec4 clipPosition = hiloVirtualShadowMapMatrix(mapIndex) * world;
        if (clipPosition.w <= 0.0) continue;
        vec3 projection = clipPosition.xyz / clipPosition.w;
        vec2 logicalUV = vec2(
            projection.x * 0.5 + 0.5,
            0.5 - projection.y * 0.5
        );
        if (
            any(lessThan(logicalUV, vec2(0.0))) ||
            any(greaterThanEqual(logicalUV, vec2(1.0))) ||
            projection.z < -1.0 || projection.z > 1.0
        ) continue;
        ivec2 logicalPage = ivec2(floor(logicalUV * float(grid)));
        int tableY = ${String(settings.pageTableHeaderRows)} + int(mapIndex) * grid + logicalPage.y;
        vec4 entry = texelFetch(
            u_virtualShadowPageTable,
            ivec2(logicalPage.x, tableY),
            0
        );
        if (entry.x < 0.5) continue;
        uint mapBase = 13u + mapIndex * 5u;
        vec4 identity = hiloVirtualShadowTableTexel(mapBase + 4u);
        ivec2 absolutePage = ivec2(round(identity.xy)) + logicalPage;
        if (any(notEqual(ivec2(round(entry.yz)), absolutePage))) continue;
        uint epoch = uint(identity.z + 0.5);
        if (uint(entry.w + 0.5) != epoch) continue;
        uint physicalIndex = uint(entry.x - 0.5);
        uint column = physicalIndex % ${String(settings.physicalPageColumns)}u;
        uint row = physicalIndex / ${String(settings.physicalPageColumns)}u;
        vec2 pageUV = fract(logicalUV * float(grid));
        vec2 atlasSlots = vec2(
            ${String(settings.physicalPageColumns)}.0,
            ${String(settings.physicalPageRows)}.0
        );
        vec2 atlasUV = (vec2(float(column), float(row)) + pageUV) / atlasSlots;
        vec2 texel = vec2(
            1.0 / ${String(settings.physicalAtlasWidth)}.0,
            1.0 / ${String(settings.physicalAtlasHeight)}.0
        );
        vec2 rectMin = vec2(float(column), float(row)) / atlasSlots + texel * 0.5;
        vec2 rectMax = vec2(float(column + 1u), float(row + 1u)) / atlasSlots - texel * 0.5;
        bool reversed = hiloVirtualShadowTableTexel(2u).w > 0.5;
        float depthBias = reversed ? bias : -bias;
        float visibility = 0.0;
        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 sampleUV = clamp(
                    atlasUV + vec2(float(x), float(y)) * texel,
                    rectMin,
                    rectMax
                );
                visibility += textureLod(
                    u_virtualShadowAtlas,
                    vec3(hiloRenderTargetUV(sampleUV), projection.z * 0.5 + 0.5 + depthBias),
                    0.0
                );
            }
        }
        return visibility / 9.0;
    }
    return -1.0;
}`;
}

function gpuSceneShadowSource(virtualShadows: Readonly<VirtualShadowMapSettings> | null): string {
    return `
mat4 hiloShadowMatrix(uint base) {
    return mat4(
        frameData.values[base],
        frameData.values[base + 1u],
        frameData.values[base + 2u],
        frameData.values[base + 3u]
    );
}
float hiloShadowAtlasVisibility(int sliceIndex, float bias, vec3 viewPosition, mat4 lightMatrix) {
    vec4 clipPosition = lightMatrix * vec4(viewPosition, 1.0);
    if (clipPosition.w <= 0.0) return 1.0;
    vec3 projection = clipPosition.xyz / clipPosition.w;
    projection = projection * 0.5 + 0.5;
    if (
        any(lessThan(projection, vec3(0.0))) ||
        any(greaterThan(projection, vec3(1.0)))
    ) return 1.0;
    vec4 atlasRect = frameData.values[${String(SHADOW_ATLAS_RECTS_VEC4)}u + uint(sliceIndex)];
    vec2 atlasUV = atlasRect.zw + hiloRenderTargetUV(projection.xy) * atlasRect.xy;
    vec2 texel = frameData.values[${String(SHADOW_ATLAS_SIZE_VEC4)}u].zw;
    vec2 rectEnd = atlasRect.zw + atlasRect.xy;
    vec2 rectMin = min(atlasRect.zw, rectEnd) + texel * 0.5;
    vec2 rectMax = max(atlasRect.zw, rectEnd) - texel * 0.5;
    float depthBias = frameData.values[${String(SHADOW_METADATA_VEC4)}u].w > 0.5
        ? bias
        : -bias;
    float visibility = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 sampleUV = clamp(
                atlasUV + vec2(float(x), float(y)) * texel,
                rectMin,
                rectMax
            );
            visibility += textureLod(
                u_shadowAtlas,
                vec3(sampleUV, projection.z + depthBias),
                0.0
            );
        }
    }
    return visibility / 9.0;
}
float hiloDirectionalShadow(int index, float bias, vec3 viewPosition) {
    vec4 splits = frameData.values[${String(SHADOW_DIRECTIONAL_SPLITS_VEC4)}u + uint(index)];
    vec4 params = frameData.values[${String(SHADOW_DIRECTIONAL_PARAMS_VEC4)}u + uint(index)];
    int cascadeCount = clamp(int(params.x + 0.5), 1, ${String(MAX_DIRECTIONAL_SHADOW_CASCADES)});
    float viewDepth = max(-viewPosition.z, 0.0);
    ${
        virtualShadows === null
            ? ''
            : `float virtualVisibility = hiloVirtualDirectionalShadow(index, bias, viewPosition);
    if (virtualVisibility >= 0.0) {
        float virtualStrength = clamp(params.z, 0.0, 4.0);
        return clamp(1.0 - (1.0 - virtualVisibility) * virtualStrength, 0.0, 1.0);
    }`
    }
    int cascade = 0;
    if (cascadeCount > 1 && viewDepth > splits.x) cascade = 1;
    if (cascadeCount > 2 && viewDepth > splits.y) cascade = 2;
    if (cascadeCount > 3 && viewDepth > splits.z) cascade = 3;
    if (viewDepth > splits[cascadeCount - 1]) return 1.0;
    int matrixIndex = index * ${String(MAX_DIRECTIONAL_SHADOW_CASCADES)} + cascade;
    uint matrixBase = ${String(SHADOW_DIRECTIONAL_MATRICES_VEC4)}u + uint(matrixIndex) * 4u;
    float visibility = hiloShadowAtlasVisibility(
        matrixIndex,
        bias,
        viewPosition,
        hiloShadowMatrix(matrixBase)
    );
    float blend = params.y;
    if (cascade < cascadeCount - 1 && blend > 0.0) {
        float previousSplit = cascade == 0
            ? frameData.values[25u].x
            : splits[cascade - 1];
        float interval = max(splits[cascade] - previousSplit, 0.00001);
        float blendStart = splits[cascade] - interval * blend;
        if (viewDepth > blendStart) {
            int nextMatrixIndex = matrixIndex + 1;
            float nextVisibility = hiloShadowAtlasVisibility(
                nextMatrixIndex,
                bias,
                viewPosition,
                hiloShadowMatrix(
                    ${String(SHADOW_DIRECTIONAL_MATRICES_VEC4)}u +
                        uint(nextMatrixIndex) * 4u
                )
            );
            visibility = mix(
                visibility,
                nextVisibility,
                smoothstep(blendStart, splits[cascade], viewDepth)
            );
        }
    }
    float strength = clamp(params.z, 0.0, 4.0);
    return clamp(1.0 - (1.0 - visibility) * strength, 0.0, 1.0);
}
float hiloSpotShadow(int index, float bias, vec3 viewPosition) {
    int sliceIndex = ${String(MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES)} + index;
    uint matrixBase = ${String(SHADOW_SPOT_MATRICES_VEC4)}u + uint(index) * 4u;
    return hiloShadowAtlasVisibility(
        sliceIndex,
        bias,
        viewPosition,
        hiloShadowMatrix(matrixBase)
    );
}
float hiloPointShadow(int index, float bias, vec3 viewPosition) {
    int matrixOffset = index * 6;
    for (int face = 0; face < 6; face++) {
        int matrixIndex = matrixOffset + face;
        uint matrixBase = ${String(SHADOW_POINT_MATRICES_VEC4)}u + uint(matrixIndex) * 4u;
        mat4 lightMatrix = hiloShadowMatrix(matrixBase);
        vec4 clipPosition = lightMatrix * vec4(viewPosition, 1.0);
        if (clipPosition.w <= 0.0) continue;
        vec3 projection = clipPosition.xyz / clipPosition.w;
        if (abs(projection.x) <= 1.0001 && abs(projection.y) <= 1.0001) {
            int sliceIndex = ${String(MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES + MAX_SPOT_LIGHTS)} +
                matrixIndex;
            return hiloShadowAtlasVisibility(
                sliceIndex,
                bias,
                viewPosition,
                lightMatrix
            );
        }
    }
    return 1.0;
}
float hiloClusteredShadow(
    vec4 metadata,
    vec3 viewPosition,
    vec3 normal,
    vec3 lightDirection
) {
    int kind = int(metadata.x + 0.5);
    int index = int(metadata.y + 0.5);
    if (kind == 0) return 1.0;
    uint biasBase = kind == 1
        ? ${String(SHADOW_DIRECTIONAL_BIASES_VEC4)}u
        : (kind == 2
            ? ${String(SHADOW_SPOT_BIASES_VEC4)}u
            : ${String(SHADOW_POINT_BIASES_VEC4)}u);
    vec2 biasParameters = frameData.values[biasBase + uint(index)].xy;
    float bias = max(
        biasParameters.y * (1.0 - dot(normal, lightDirection)),
        biasParameters.x
    );
    if (kind == 1) return hiloDirectionalShadow(index, bias, viewPosition);
    if (kind == 2) return hiloSpotShadow(index, bias, viewPosition);
    return hiloPointShadow(index, bias, viewPosition);
}`;
}

function finishDDGISurfaceSource(source: string, surface: boolean): string {
    if (!surface) return source;
    const marker = source.indexOf('// DDGI_SURFACE_END');
    if (marker < 0) throw new Error('DDGI surface shader marker is missing');
    return `${source.slice(0, marker)}\n}`;
}

export function gpuScenePBRShader(
    variant: Readonly<PBRMaterialVariant>,
    withMaterialAttributes: boolean,
    withReflectionData: boolean,
    withGroundTruthAmbientOcclusion: boolean,
    withCloudShadow: boolean,
    withShadows: boolean,
    virtualShadows: Readonly<VirtualShadowMapSettings> | null,
    withDynamicGlobalIllumination: boolean,
    giSurface = false
): StorageGraphicsShader {
    const cacheKey = `${variant.key}|gi-surface=${giSurface ? '1' : '0'}|ddgi=${withDynamicGlobalIllumination ? '1' : '0'}|attributes=${withMaterialAttributes ? '1' : '0'}|reflections=${withReflectionData ? '1' : '0'}|gtao=${withGroundTruthAmbientOcclusion ? '1' : '0'}|cloud-shadow=${withCloudShadow ? '1' : '0'}|shadows=${withShadows ? '1' : '0'}|virtual-shadows=${virtualShadows === null ? '0' : `${String(virtualShadows.virtualResolution)}:${String(virtualShadows.pageSize)}:${String(virtualShadows.physicalPageCount)}`}`;
    const cached = GPU_SCENE_PBR_SHADER_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;
    const textureDeclarations = variant.textures
        .map(binding => `uniform sampler2D ${binding.shaderName};`)
        .join('\n');
    const vertexUVDeclarations = [
        variant.usesUV0 ? 'layout(location=2) in vec2 a_uv0;\nout vec2 v_uv0;' : '',
        variant.usesUV1 ? 'layout(location=3) in vec2 a_uv1;\nout vec2 v_uv1;' : '',
        variant.normalUV === null ? '' : 'layout(location=4) in vec4 a_tangent;\nout mat3 v_TBN;'
    ]
        .filter(Boolean)
        .join('\n');
    const fragmentUVDeclarations = [
        variant.usesUV0 ? 'in vec2 v_uv0;' : '',
        variant.usesUV1 ? 'in vec2 v_uv1;' : '',
        variant.normalUV === null ? '' : 'in mat3 v_TBN;'
    ]
        .filter(Boolean)
        .join('\n');
    const vertexUVWrites = [
        variant.usesUV0 ? 'v_uv0 = a_uv0;' : '',
        variant.usesUV1 ? 'v_uv1 = a_uv1;' : '',
        variant.normalUV === null
            ? ''
            : `vec3 tangent = normalize(viewNormalMatrix * a_tangent.xyz);
    tangent = normalize(tangent - dot(tangent, viewNormal) * viewNormal);
    vec3 bitangent = cross(viewNormal, tangent) * a_tangent.w;
    v_TBN = mat3(tangent, bitangent, viewNormal);`
    ]
        .filter(Boolean)
        .join('\n    ');
    const baseColorMap = variantTexture(variant, 'baseColorMap');
    const metallicMap = variantTexture(variant, 'metallicMap');
    const roughnessMap = variantTexture(variant, 'roughnessMap');
    const metallicRoughnessMap = variantTexture(variant, 'metallicRoughnessMap');
    const occlusionMap = variantTexture(variant, 'occlusionMap');
    const emissionMap = variantTexture(variant, 'emission');
    const normalMap = variantTexture(variant, 'normalMap');
    const opacityMap = variantTexture(variant, 'opacityMap');
    const materialSample = (binding: Readonly<PBRTextureBinding>): string =>
        `hiloMaterialSample(${binding.shaderName}, materialBase, ${String(binding.slotIndex)}u, ${variantSampleUV(binding)})`;
    const bindings: ShaderReadBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        { name: 'materials', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
        { name: 'lights', group: 0, binding: 4, kind: 'read-only-storage-buffer' },
        { name: 'clusterGrid', group: 0, binding: 5, kind: 'read-only-storage-buffer' },
        { name: 'clusterIndices', group: 0, binding: 6, kind: 'read-only-storage-buffer' },
        {
            name: 'visibleOffset',
            group: 0,
            binding: 7,
            kind: 'read-only-storage-buffer',
            minBindingSize: 4
        }
    ];
    if (withDynamicGlobalIllumination)
        bindings.push({
            name: 'ddgiProbes',
            group: 0,
            binding: 8,
            kind: 'read-only-storage-buffer'
        });
    for (let index = 0; index < variant.textures.length; index += 1) {
        const texture = variant.textures[index];
        if (texture === undefined) continue;
        bindings.push({
            name: texture.shaderName,
            group: 1,
            binding: index * 2,
            kind: 'sampled-texture',
            sampleType: 'float'
        });
        bindings.push({
            name: texture.shaderName,
            group: 1,
            binding: index * 2 + 1,
            kind: 'sampler'
        });
    }
    if (withGroundTruthAmbientOcclusion) {
        const binding = variant.textures.length * 2;
        bindings.push(
            {
                name: 'u_gtaoTexture',
                group: 1,
                binding,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            { name: 'u_gtaoTexture', group: 1, binding: binding + 1, kind: 'sampler' }
        );
    }
    const areaTextureIndex = variant.textures.length + (withGroundTruthAmbientOcclusion ? 1 : 0);
    for (let index = 0; index < 2; index += 1) {
        const name = index === 0 ? 'u_areaLightsLtcTexture1' : 'u_areaLightsLtcTexture2';
        const binding = (areaTextureIndex + index) * 2;
        bindings.push(
            {
                name,
                group: 1,
                binding,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            { name, group: 1, binding: binding + 1, kind: 'sampler' }
        );
    }
    if (withShadows) {
        const textureIndex = areaTextureIndex + 2;
        const binding = textureIndex * 2;
        bindings.push(
            {
                name: 'u_shadowAtlas',
                group: 1,
                binding,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'u_shadowAtlas',
                group: 1,
                binding: binding + 1,
                kind: 'comparison-sampler'
            }
        );
    }
    if (virtualShadows !== null) {
        const pageTableTextureIndex = areaTextureIndex + 3;
        const pageTableBinding = pageTableTextureIndex * 2;
        bindings.push(
            {
                name: 'u_virtualShadowPageTable',
                group: 1,
                binding: pageTableBinding,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            {
                name: 'u_virtualShadowPageTable',
                group: 1,
                binding: pageTableBinding + 1,
                kind: 'sampler'
            },
            {
                name: 'u_virtualShadowAtlas',
                group: 1,
                binding: pageTableBinding + 2,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'u_virtualShadowAtlas',
                group: 1,
                binding: pageTableBinding + 3,
                kind: 'comparison-sampler'
            }
        );
    }
    const shadowTextureCount = withShadows ? 1 : 0;
    const virtualShadowTextureCount = virtualShadows === null ? 0 : 2;
    if (withCloudShadow) {
        const cloudTextureIndex =
            areaTextureIndex + 2 + shadowTextureCount + virtualShadowTextureCount;
        const binding = cloudTextureIndex * 2;
        bindings.push(
            {
                name: 'u_cloudShadowTexture',
                group: 1,
                binding,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'u_cloudShadowTexture',
                group: 1,
                binding: binding + 1,
                kind: 'sampler'
            }
        );
    }
    const shader = new StorageGraphicsShader({
        label: `Built-in clustered storage PBR (${variant.key})`,
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;
layout(std430) readonly buffer LightDataBlock { vec4 values[]; } lights;
layout(std430) readonly buffer ClusterGridBlock { uvec2 values[]; } clusterGrid;
layout(std430) readonly buffer ClusterIndexBlock { uint values[]; } clusterIndices;
layout(std430) readonly buffer VisibleOffsetBlock { uint value; } visibleOffset;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
${vertexUVDeclarations}
out vec3 v_viewPosition;
out vec3 v_viewNormal;
flat out uint v_materialIndex;
flat out uint v_objectFlags;
flat out uint v_objectLayer;
${GPU_SCENE_POSITION_TRANSFORM_SOURCE}
${GPU_SCENE_VISIBLE_INDEX_SOURCE}
mat3 readObjectNormalMatrix(uint base) {
    return mat3(objects.values[base + 8u].xyz, objects.values[base + 9u].xyz, objects.values[base + 10u].xyz);
}
void main() {
    uint objectIndex = gpuSceneVisibleObjectIndex();
    uint objectBase = objectIndex * 13u;
    mat4 model = readObjectMatrix(objectBase);
    mat4 view = readFrameMatrix(8u);
    mat3 viewNormalMatrix = mat3(view) * readObjectNormalMatrix(objectBase);
    vec4 worldPosition = model * vec4(a_position, 1.0);
    vec3 viewNormal = normalize(viewNormalMatrix * a_normal);
    v_viewPosition = (view * worldPosition).xyz;
    v_viewNormal = viewNormal;
    v_materialIndex = floatBitsToUint(objects.values[objectBase + 12u].w);
    v_objectFlags = floatBitsToUint(objects.values[objectBase + 12u].z);
    v_objectLayer = floatBitsToUint(objects.values[objectBase + 12u].y);
    ${vertexUVWrites}
    gl_Position = gpuSceneClipPosition(objectBase, a_position);
}`,
        fragmentSource: finishDDGISurfaceSource(
            `#version 310 es
precision highp float;
precision highp int;
#define HILO_PI 3.141592653589793
#define HILO_INVERSE_PI 0.3183098861837907
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;
layout(std430) readonly buffer LightDataBlock { vec4 values[]; } lights;
layout(std430) readonly buffer ClusterGridBlock { uvec2 values[]; } clusterGrid;
layout(std430) readonly buffer ClusterIndexBlock { uint values[]; } clusterIndices;
${withDynamicGlobalIllumination ? DDGI_GLSL_SAMPLING_SOURCE : ''}
${textureDeclarations}
${withGroundTruthAmbientOcclusion ? 'uniform sampler2D u_gtaoTexture;' : ''}
${
    withGroundTruthAmbientOcclusion
        ? `vec3 hiloDecodeGTAOBentNormal(vec2 encoded) {
    vec3 normal = vec3(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
    if (normal.z < 0.0) {
        vec2 original = normal.xy;
        normal.xy = (1.0 - abs(original.yx)) * vec2(
            original.x >= 0.0 ? 1.0 : -1.0,
            original.y >= 0.0 ? 1.0 : -1.0
        );
    }
    return normalize(normal);
}
vec3 hiloGTAOMultiBounceVisibility(float visibility, vec3 albedo, float strength) {
    vec3 a = 2.0404 * albedo - 0.3324;
    vec3 b = -4.7951 * albedo + 0.6417;
    vec3 c = 2.7552 * albedo + 0.6903;
    vec3 multiBounce = max(
        vec3(visibility),
        ((visibility * a + b) * visibility + c) * visibility
    );
    return mix(vec3(visibility), clamp(multiBounce, 0.0, 1.0), strength);
}
float hiloGTAOSpecularVisibility(
    float visibility,
    vec3 bentNormal,
    vec3 normal,
    vec3 viewDirection,
    float perceptualRoughness
) {
    vec3 reflectionDirection = -normalize(reflect(viewDirection, normal));
    float coneCosine = clamp(1.0 - visibility, 0.0, 1.0);
    float lobeWidth = max(perceptualRoughness * perceptualRoughness, 0.04);
    float directionalVisibility = smoothstep(
        coneCosine - lobeWidth,
        coneCosine + lobeWidth,
        dot(reflectionDirection, bentNormal)
    );
    return mix(max(visibility, directionalVisibility), visibility, perceptualRoughness);
}`
        : ''
}
${withCloudShadow ? 'uniform sampler2D u_cloudShadowTexture;' : ''}
uniform sampler2D u_areaLightsLtcTexture1;
uniform sampler2D u_areaLightsLtcTexture2;
${withShadows ? 'uniform highp sampler2DShadow u_shadowAtlas;' : ''}
${virtualShadows === null ? '' : 'uniform highp sampler2D u_virtualShadowPageTable;\nuniform highp sampler2DShadow u_virtualShadowAtlas;'}
in vec3 v_viewPosition;
in vec3 v_viewNormal;
${fragmentUVDeclarations}
flat in uint v_materialIndex;
flat in uint v_objectFlags;
flat in uint v_objectLayer;
layout(location=0) out vec4 color;
${giSurface ? 'layout(location=1) out vec4 ddgiDiffuseAlbedo;' : ''}
${withMaterialAttributes ? 'layout(location=1) out vec4 materialAttributes;' : ''}
${
    withReflectionData
        ? `layout(location=${withMaterialAttributes ? '2' : '1'}) out vec4 reflectionResponse;
layout(location=${withMaterialAttributes ? '3' : '2'}) out vec4 reflectionFallbackSpecular;`
        : ''
}
${encodingSource}
${portableCoordinatesSource}
float hiloMaterialChannel(vec4 value, int channel) {
    if (channel == 0) return value.r;
    if (channel == 1) return value.g;
    if (channel == 2) return value.b;
    if (channel == 3) return value.a;
    return channel == 5 ? 1.0 : 0.0;
}
vec4 hiloMaterialSample(sampler2D source, uint materialBase, uint slotIndex, vec2 uv) {
    uint slotBase = materialBase + 4u + slotIndex * 5u;
    mat3 transform = mat3(
        materials.values[slotBase].xyz,
        materials.values[slotBase + 1u].xyz,
        materials.values[slotBase + 2u].xyz
    );
    vec4 info = materials.values[slotBase + 3u];
    vec4 sampled = texture(source, (transform * vec3(uv, 1.0)).xy);
    if (int(info.y) == 1) sampled = sRGBToLinear(sampled);
    ivec4 channels = ivec4(materials.values[slotBase + 4u]);
    return vec4(
        hiloMaterialChannel(sampled, channels.x),
        hiloMaterialChannel(sampled, channels.y),
        hiloMaterialChannel(sampled, channels.z),
        hiloMaterialChannel(sampled, channels.w)
    );
}
${pbrSurfaceSource}
${pbrBrdfSource}
${CLUSTERED_AREA_LIGHT_SOURCE}
${virtualShadows === null ? '' : gpuSceneVirtualShadowSource(virtualShadows)}
${withShadows ? gpuSceneShadowSource(virtualShadows) : ''}
float hiloClusteredPhotometricAttenuation(
    vec3 viewPosition,
    vec3 lightPosition,
    vec3 lightAxis,
    vec4 cookieParameters,
    vec4 photometricParameters,
    uint featureFlags
) {
    vec3 axis = normalize(lightAxis);
    vec3 delta = viewPosition - lightPosition;
    vec3 reference = abs(axis.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 right = normalize(cross(reference, axis));
    vec3 up = cross(axis, right);
    float axialDistance = max(dot(delta, axis), 1e-5);
    float attenuation = 1.0;
    if ((featureFlags & ${String(LIGHT_COOKIE_FLAG)}u) != 0u) {
        vec2 projected = vec2(dot(delta, right), dot(delta, up)) / axialDistance;
        vec2 coordinate = (projected - cookieParameters.zw) / cookieParameters.xy;
        float edge = 1.0 - max(abs(coordinate.x), abs(coordinate.y));
        attenuation *= photometricParameters.x * smoothstep(
            0.0,
            max(photometricParameters.y, 1e-5),
            edge
        );
    }
    if ((featureFlags & ${String(LIGHT_IES_FLAG)}u) != 0u) {
        float axialCosine = max(dot(normalize(delta), axis), 0.0);
        attenuation *= photometricParameters.z * pow(axialCosine, photometricParameters.w);
    }
    return attenuation;
}
vec3 hiloEvaluateClusteredLight(
    uint lightIndex,
    vec3 viewPosition,
    vec3 normal,
    vec3 viewDirection,
    HiloMetallicRoughnessSurface surface,
    float visibility
) {
    uint lightBase = lightIndex * ${String(LIGHT_RECORD_FLOATS / 4)}u;
    vec4 positionRange = lights.values[lightBase];
    vec4 colorType = lights.values[lightBase + 1u];
    vec4 directionOuter = lights.values[lightBase + 2u];
    vec4 attenuationInner = lights.values[lightBase + 3u];
    vec4 shadowMetadata = lights.values[lightBase + 4u];
    uint lightLayerMask = floatBitsToUint(shadowMetadata.z);
    if ((v_objectLayer & lightLayerMask) == 0u) return vec3(0.0);
    vec3 areaWidth = lights.values[lightBase + 5u].xyz;
    vec3 areaHeight = lights.values[lightBase + 6u].xyz;
    uint lightType = uint(colorType.w + 0.5);
    if (lightType == 3u) {
        vec3 areaDiffuse;
        vec3 areaSpecular;
        getAreaLightComponents(
            surface.diffuseColor,
            surface.specularColor,
            surface.roughness,
            normal,
            viewDirection,
            viewPosition,
            positionRange.xyz,
            colorType.rgb,
            areaWidth,
            areaHeight,
            u_areaLightsLtcTexture1,
            u_areaLightsLtcTexture2,
            areaDiffuse,
            areaSpecular
        );
        return areaDiffuse + areaSpecular;
    }
    vec3 lightDirection;
    vec3 radiance = colorType.rgb;
    if (lightType == 2u) {
        lightDirection = normalize(-directionOuter.xyz);
    } else {
        vec3 delta = positionRange.xyz - viewPosition;
        float distanceToLight = max(length(delta), 0.0001);
        lightDirection = delta / distanceToLight;
        float attenuation = 1.0 / max(
            attenuationInner.x + attenuationInner.y * distanceToLight +
                attenuationInner.z * distanceToLight * distanceToLight,
            0.0001
        );
        float rangeFade = clamp(
            1.0 - pow(distanceToLight / max(positionRange.w, 0.0001), 4.0),
            0.0,
            1.0
        );
        radiance *= attenuation * rangeFade * rangeFade;
        if (lightType == 1u) {
            float theta = dot(lightDirection, normalize(-directionOuter.xyz));
            radiance *= smoothstep(directionOuter.w, attenuationInner.w, theta);
            radiance *= hiloClusteredPhotometricAttenuation(
                viewPosition,
                positionRange.xyz,
                directionOuter.xyz,
                lights.values[lightBase + 5u],
                lights.values[lightBase + 6u],
                floatBitsToUint(shadowMetadata.w)
            );
        }
    }
    vec3 lightDiffuse;
    vec3 lightSpecular;
    hiloEvaluateBaseBRDF(
        normal,
        viewDirection,
        lightDirection,
        normal,
        normal,
        surface.specularColor,
        surface.diffuseColor,
        surface.roughness,
        0.0,
        0.0,
        1.3,
        0.0,
        lightDiffuse,
        lightSpecular
    );
    ${
        withShadows
            ? `float shadow = ((v_objectFlags & ${String(OBJECT_RECEIVE_SHADOW_FLAG)}u) != 0u)
        ? hiloClusteredShadow(shadowMetadata, viewPosition, normal, lightDirection)
        : 1.0;
    return shadow * visibility * radiance * (lightDiffuse + lightSpecular);`
            : 'return visibility * radiance * (lightDiffuse + lightSpecular);'
    }
}
void main() {
    uint materialBase = v_materialIndex * ${String(PBR_GPU_MATERIAL_RECORD_BYTES / 16)}u;
    vec4 baseMetallic = materials.values[materialBase];
    vec4 emissionRoughness = materials.values[materialBase + 1u];
    vec4 materialParameters = materials.values[materialBase + 2u];
    float opacity = materials.values[materialBase + 3u].x;
    vec4 baseColorSample = vec4(1.0);
    ${baseColorMap === null ? '' : `baseColorSample = ${materialSample(baseColorMap)};`}
    float coverageAlpha = baseColorSample.a * opacity;
    ${opacityMap === null ? '' : `coverageAlpha *= ${materialSample(opacityMap)}.r;`}
    ${variant.coverageMode === 'mask' ? `if (coverageAlpha < ${String(variant.alphaCutoff)}) discard;` : ''}
    vec3 emissionSample = vec3(1.0);
    ${emissionMap === null ? '' : `emissionSample = ${materialSample(emissionMap)}.rgb;`}
    float metallic = baseMetallic.a;
    ${metallicMap === null ? '' : `metallic *= ${materialSample(metallicMap)}.r;`}
    float roughness = emissionRoughness.a;
    ${roughnessMap === null ? '' : `roughness *= ${materialSample(roughnessMap)}.r;`}
    float occlusion = 1.0;
    ${occlusionMap === null ? '' : `occlusion = ${materialSample(occlusionMap)}.r;`}
    ${
        metallicRoughnessMap === null
            ? ''
            : `vec4 metallicRoughnessSample = ${materialSample(metallicRoughnessMap)};
    roughness *= metallicRoughnessSample.g;
    metallic *= metallicRoughnessSample.b;
    ${variant.occlusionInMetallicRoughness ? 'occlusion = metallicRoughnessSample.r;' : ''}`
    }
    HiloMetallicRoughnessSurface surface = hiloEvaluateMetallicRoughnessSurface(
        hiloEvaluatePBRBaseColor(vec4(baseMetallic.rgb, 1.0), baseColorSample),
        hiloEvaluatePBREmission(emissionRoughness.rgb, emissionSample),
        metallic,
        roughness,
        occlusion,
        materialParameters.y,
        materialParameters.x
    );
    vec3 normal = normalize(v_viewNormal);
    ${
        normalMap === null
            ? ''
            : `vec3 tangentNormal = ${materialSample(normalMap)}.rgb * 2.0 - 1.0;
    tangentNormal.xy *= materialParameters.z;
    normal = normalize(v_TBN * tangentNormal);`
    }
    ${
        withMaterialAttributes
            ? `vec3 octahedralNormal = normal /
        max(abs(normal.x) + abs(normal.y) + abs(normal.z), 0.000001);
    vec2 encodedNormal = octahedralNormal.xy;
    if (octahedralNormal.z < 0.0) {
        vec2 octahedralSign = vec2(
            encodedNormal.x >= 0.0 ? 1.0 : -1.0,
            encodedNormal.y >= 0.0 ? 1.0 : -1.0
        );
        encodedNormal = (1.0 - abs(encodedNormal.yx)) * octahedralSign;
    }
    encodedNormal = encodedNormal * 0.5 + 0.5;
    float metallicBits = floor(clamp(surface.metallic, 0.0, 1.0) * 127.0 + 0.5);
    materialAttributes = vec4(
        encodedNormal,
        surface.roughness,
        (1.0 + metallicBits * 2.0) / 255.0
    );`
            : ''
    }
    vec3 viewDirection = normalize(-v_viewPosition);
    float depth = max(-v_viewPosition.z, frameData.values[25u].x);
    uvec4 cluster = floatBitsToUint(frameData.values[27u]);
    uint tileX = min(uint(gl_FragCoord.x) / cluster.w, cluster.x - 1u);
    uint tileY = min(uint(gl_FragCoord.y) / cluster.w, cluster.y - 1u);
    float logScale = frameData.values[25u].z;
    uint slice = min(uint(clamp(log(depth / frameData.values[25u].x) / logScale, 0.0, 0.999999) * float(cluster.z)), cluster.z - 1u);
    uint clusterIndex = slice * cluster.x * cluster.y + tileY * cluster.x + tileX;
    uvec2 allocation = clusterGrid.values[clusterIndex];
    uvec4 directional = floatBitsToUint(frameData.values[30u]);
    vec3 ambientDiffuseOcclusion = vec3(surface.occlusion);
    float ambientSpecularOcclusion = surface.occlusion;
    ${
        withGroundTruthAmbientOcclusion
            ? `vec4 gtaoSample = texture(
        u_gtaoTexture,
        gl_FragCoord.xy / frameData.values[24u].zw
    );
    float gtaoVisibility = clamp(gtaoSample.b, 0.0, 1.0);
    vec3 gtaoBentNormal = hiloDecodeGTAOBentNormal(gtaoSample.xy);
    ambientDiffuseOcclusion *= hiloGTAOMultiBounceVisibility(
        gtaoVisibility,
        clamp(surface.baseColor.rgb, 0.0, 1.0),
        clamp(gtaoSample.a, 0.0, 1.0)
    );
    ambientSpecularOcclusion *= hiloGTAOSpecularVisibility(
        gtaoVisibility,
        gtaoBentNormal,
        normal,
        viewDirection,
        surface.roughness
    );`
            : ''
    }
    vec3 lighting = frameData.values[31u].rgb * surface.iblDiffuseColor *
        ambientDiffuseOcclusion * HILO_INVERSE_PI;
    ${
        withDynamicGlobalIllumination
            ? `
    mat4 ddgiInverseView = inverse(mat4(frameData.values[8u], frameData.values[9u], frameData.values[10u], frameData.values[11u]));
    vec4 ddgiSample = hiloDDGISample((ddgiInverseView * vec4(v_viewPosition, 1.0)).xyz,
        normalize(mat3(ddgiInverseView) * normal), normalize(mat3(ddgiInverseView) * viewDirection));
    vec3 ddgiDiffuseContribution = ddgiSample.rgb * surface.iblDiffuseColor * ambientDiffuseOcclusion;
    lighting = lighting * (1.0 - ddgiSample.a) + ddgiDiffuseContribution;`
            : ''
    }
    ${
        withReflectionData
            ? `float reflectionNdotV = max(abs(dot(normal, viewDirection)), 0.0001);
    vec3 ssrReflectionResponse = hiloFresnelSchlick(
        surface.specularColor,
        reflectionNdotV
    );
    vec3 ssrFallbackSpecular = frameData.values[31u].rgb *
        ssrReflectionResponse *
        mix(1.0, 0.35, surface.roughness) * ambientSpecularOcclusion;
    lighting += ssrFallbackSpecular;
    reflectionResponse = vec4(ssrReflectionResponse, 1.0);
    reflectionFallbackSpecular = vec4(ssrFallbackSpecular, 1.0);`
            : ''
    }
    ${
        giSurface
            ? `
    color = vec4(ddgiDiffuseContribution, ddgiSample.a);
    ddgiDiffuseAlbedo = vec4(surface.iblDiffuseColor * ambientDiffuseOcclusion, 1.0);
    // DDGI_SURFACE_END`
            : ''
    }
    float cloudShadow = 1.0;
    ${
        withCloudShadow
            ? 'cloudShadow = clamp(texture(u_cloudShadowTexture, gl_FragCoord.xy / frameData.values[24u].zw).r, 0.12, 1.0);'
            : ''
    }
    for (uint lightIndex = 0u; lightIndex < directional.x; lightIndex += 1u) {
        lighting += hiloEvaluateClusteredLight(
            lightIndex, v_viewPosition, normal, viewDirection, surface, cloudShadow
        );
    }
    for (uint localIndex = 0u; localIndex < allocation.y; localIndex += 1u) {
        uint lightIndex = clusterIndices.values[allocation.x + localIndex];
        lighting += hiloEvaluateClusteredLight(
            lightIndex, v_viewPosition, normal, viewDirection, surface, 1.0
        );
    }
    color = vec4(
        lighting + surface.emissionColor,
        ${variant.coverageMode === 'mask' ? '1.0' : 'coverageAlpha'}
    );
}`,
            giSurface
        ),
        bindings
    });
    GPU_SCENE_PBR_SHADER_CACHE.set(cacheKey, shader);
    return shader;
}

export function gpuSceneMaterialAttributesShader(
    variant: Readonly<PBRMaterialVariant>,
    withReflectionData: boolean
): StorageGraphicsShader {
    const cacheKey = `${variant.key}|reflections=${withReflectionData ? '1' : '0'}`;
    const cached = GPU_SCENE_ATTRIBUTES_SHADER_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;
    const textureDeclarations = variant.textures
        .map(binding => `uniform sampler2D ${binding.shaderName};`)
        .join('\n');
    const vertexUVDeclarations = [
        variant.usesUV0 ? 'layout(location=2) in vec2 a_uv0;\nout vec2 v_uv0;' : '',
        variant.usesUV1 ? 'layout(location=3) in vec2 a_uv1;\nout vec2 v_uv1;' : '',
        variant.normalUV === null ? '' : 'layout(location=4) in vec4 a_tangent;\nout mat3 v_TBN;'
    ]
        .filter(Boolean)
        .join('\n');
    const fragmentUVDeclarations = [
        variant.usesUV0 ? 'in vec2 v_uv0;' : '',
        variant.usesUV1 ? 'in vec2 v_uv1;' : '',
        variant.normalUV === null ? '' : 'in mat3 v_TBN;'
    ]
        .filter(Boolean)
        .join('\n');
    const vertexUVWrites = [
        variant.usesUV0 ? 'v_uv0 = a_uv0;' : '',
        variant.usesUV1 ? 'v_uv1 = a_uv1;' : '',
        variant.normalUV === null
            ? ''
            : `vec3 tangent = normalize(viewNormalMatrix * a_tangent.xyz);
    tangent = normalize(tangent - dot(tangent, viewNormal) * viewNormal);
    vec3 bitangent = cross(viewNormal, tangent) * a_tangent.w;
    v_TBN = mat3(tangent, bitangent, viewNormal);`
    ]
        .filter(Boolean)
        .join('\n    ');
    const metallicMap = variantTexture(variant, 'metallicMap');
    const roughnessMap = variantTexture(variant, 'roughnessMap');
    const metallicRoughnessMap = variantTexture(variant, 'metallicRoughnessMap');
    const normalMap = variantTexture(variant, 'normalMap');
    const baseColorMap = variantTexture(variant, 'baseColorMap');
    const opacityMap = variantTexture(variant, 'opacityMap');
    const materialSample = (binding: Readonly<PBRTextureBinding>): string =>
        `hiloMaterialSample(${binding.shaderName}, materialBase, ${String(binding.slotIndex)}u, ${variantSampleUV(binding)})`;
    const bindings: ShaderReadBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        { name: 'materials', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
        {
            name: 'visibleOffset',
            group: 0,
            binding: 4,
            kind: 'read-only-storage-buffer',
            minBindingSize: 4
        }
    ];
    for (let index = 0; index < variant.textures.length; index += 1) {
        const texture = variant.textures[index];
        if (texture === undefined) continue;
        bindings.push(
            {
                name: texture.shaderName,
                group: 1,
                binding: index * 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: texture.shaderName,
                group: 1,
                binding: index * 2 + 1,
                kind: 'sampler'
            }
        );
    }
    const shader = new StorageGraphicsShader({
        label: `Built-in clustered material attributes (${variant.key})`,
        vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;
layout(std430) readonly buffer VisibleOffsetBlock { uint value; } visibleOffset;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
${vertexUVDeclarations}
out vec3 v_viewNormal;
out vec3 v_viewPosition;
flat out uint v_materialIndex;
${GPU_SCENE_POSITION_TRANSFORM_SOURCE}
${GPU_SCENE_VISIBLE_INDEX_SOURCE}
mat3 readObjectNormalMatrix(uint base) {
    return mat3(objects.values[base + 8u].xyz, objects.values[base + 9u].xyz, objects.values[base + 10u].xyz);
}
void main() {
    uint objectIndex = gpuSceneVisibleObjectIndex();
    uint objectBase = objectIndex * 13u;
    mat4 model = readObjectMatrix(objectBase);
    mat4 view = readFrameMatrix(8u);
    mat3 viewNormalMatrix = mat3(view) * readObjectNormalMatrix(objectBase);
    vec3 viewNormal = normalize(viewNormalMatrix * a_normal);
    v_viewNormal = viewNormal;
    v_viewPosition = (view * model * vec4(a_position, 1.0)).xyz;
    v_materialIndex = floatBitsToUint(objects.values[objectBase + 12u].w);
    ${vertexUVWrites}
    gl_Position = gpuSceneClipPosition(objectBase, a_position);
}`,
        fragmentSource: `#version 310 es
precision highp float;
precision highp int;
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer MaterialDataBlock { vec4 values[]; } materials;
${textureDeclarations}
in vec3 v_viewNormal;
in vec3 v_viewPosition;
${fragmentUVDeclarations}
flat in uint v_materialIndex;
layout(location=0) out vec4 materialAttributes;
${withReflectionData ? 'layout(location=1) out vec4 reflectionResponse;\nlayout(location=2) out vec4 reflectionFallbackSpecular;' : ''}
${encodingSource}
float hiloMaterialChannel(vec4 value, int channel) {
    if (channel == 0) return value.r;
    if (channel == 1) return value.g;
    if (channel == 2) return value.b;
    if (channel == 3) return value.a;
    return channel == 5 ? 1.0 : 0.0;
}
vec4 hiloMaterialSample(sampler2D source, uint materialBase, uint slotIndex, vec2 uv) {
    uint slotBase = materialBase + 4u + slotIndex * 5u;
    mat3 transform = mat3(
        materials.values[slotBase].xyz,
        materials.values[slotBase + 1u].xyz,
        materials.values[slotBase + 2u].xyz
    );
    vec4 info = materials.values[slotBase + 3u];
    vec4 sampled = texture(source, (transform * vec3(uv, 1.0)).xy);
    if (int(info.y) == 1) sampled = sRGBToLinear(sampled);
    ivec4 channels = ivec4(materials.values[slotBase + 4u]);
    return vec4(
        hiloMaterialChannel(sampled, channels.x),
        hiloMaterialChannel(sampled, channels.y),
        hiloMaterialChannel(sampled, channels.z),
        hiloMaterialChannel(sampled, channels.w)
    );
}
void main() {
    uint materialBase = v_materialIndex * ${String(PBR_GPU_MATERIAL_RECORD_BYTES / 16)}u;
    vec4 baseMetallic = materials.values[materialBase];
    vec4 emissionRoughness = materials.values[materialBase + 1u];
    vec4 materialParameters = materials.values[materialBase + 2u];
    float opacity = materials.values[materialBase + 3u].x;
    vec4 baseColorSample = vec4(1.0);
    ${baseColorMap === null ? '' : `baseColorSample = ${materialSample(baseColorMap)};`}
    float coverageAlpha = baseColorSample.a * opacity;
    ${opacityMap === null ? '' : `coverageAlpha *= ${materialSample(opacityMap)}.r;`}
    ${variant.coverageMode === 'mask' ? `if (coverageAlpha < ${String(variant.alphaCutoff)}) discard;` : ''}
    float metallic = baseMetallic.a;
    ${metallicMap === null ? '' : `metallic *= ${materialSample(metallicMap)}.r;`}
    float roughness = emissionRoughness.a;
    ${roughnessMap === null ? '' : `roughness *= ${materialSample(roughnessMap)}.r;`}
    ${
        metallicRoughnessMap === null
            ? ''
            : `vec4 metallicRoughnessSample = ${materialSample(metallicRoughnessMap)};
    roughness *= metallicRoughnessSample.g;
    metallic *= metallicRoughnessSample.b;`
    }
    vec3 normal = normalize(v_viewNormal);
    ${
        normalMap === null
            ? ''
            : `vec3 tangentNormal = ${materialSample(normalMap)}.rgb * 2.0 - 1.0;
    tangentNormal.xy *= materialParameters.z;
    normal = normalize(v_TBN * tangentNormal);`
    }
    vec3 octahedralNormal = normal /
        max(abs(normal.x) + abs(normal.y) + abs(normal.z), 0.000001);
    vec2 encodedNormal = octahedralNormal.xy;
    if (octahedralNormal.z < 0.0) {
        vec2 octahedralSign = vec2(
            encodedNormal.x >= 0.0 ? 1.0 : -1.0,
            encodedNormal.y >= 0.0 ? 1.0 : -1.0
        );
        encodedNormal = (1.0 - abs(encodedNormal.yx)) * octahedralSign;
    }
    encodedNormal = encodedNormal * 0.5 + 0.5;
    float metallicBits = floor(clamp(metallic, 0.0, 1.0) * 127.0 + 0.5);
    materialAttributes = vec4(
        encodedNormal,
        clamp(roughness, 0.045, 1.0),
        (1.0 + metallicBits * 2.0) / 255.0
    );
    ${
        withReflectionData
            ? `vec3 baseColor = baseMetallic.rgb * baseColorSample.rgb;
    float ior = max(materialParameters.x, 1.0);
    float dielectricF0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
    vec3 reflectionF0 = mix(vec3(dielectricF0), baseColor, clamp(metallic, 0.0, 1.0));
    float reflectionNdotV = max(abs(dot(normal, normalize(-v_viewPosition))), 0.0001);
    vec3 response = reflectionF0 + (vec3(1.0) - reflectionF0) *
        pow(1.0 - reflectionNdotV, 5.0);
    vec3 fallbackSpecular = frameData.values[31u].rgb * response *
        mix(1.0, 0.35, clamp(roughness, 0.045, 1.0));
    reflectionResponse = vec4(response, 1.0);
    reflectionFallbackSpecular = vec4(fallbackSpecular, 1.0);`
            : ''
    }
}`,
        bindings
    });
    GPU_SCENE_ATTRIBUTES_SHADER_CACHE.set(cacheKey, shader);
    return shader;
}

export function gpuSceneVertexLayouts(
    variant: Readonly<PBRMaterialVariant>
): readonly GPUDrivenVertexBufferLayout[] {
    const layouts: GPUDrivenVertexBufferLayout[] = [
        {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, format: 'float32x3', byteOffset: 0 }]
        },
        {
            arrayStride: 12,
            attributes: [{ shaderLocation: 1, format: 'float32x3', byteOffset: 0 }]
        }
    ];
    if (variant.usesUV0) {
        layouts.push({
            arrayStride: 8,
            attributes: [{ shaderLocation: 2, format: 'float32x2', byteOffset: 0 }]
        });
    }
    if (variant.usesUV1) {
        layouts.push({
            arrayStride: 8,
            attributes: [{ shaderLocation: 3, format: 'float32x2', byteOffset: 0 }]
        });
    }
    if (variant.normalUV !== null) {
        layouts.push({
            arrayStride: 16,
            attributes: [{ shaderLocation: 4, format: 'float32x4', byteOffset: 0 }]
        });
    }
    return layouts;
}

const GPU_SCENE_POSITION_VERTEX_LAYOUT: GPUDrivenVertexBufferLayout = Object.freeze({
    arrayStride: 12,
    attributes: Object.freeze([
        Object.freeze({ shaderLocation: 0, format: 'float32x3' as const, byteOffset: 0 })
    ])
});

const GPU_SCENE_DEPTH_VERTEX_LAYOUTS: readonly GPUDrivenVertexBufferLayout[] = Object.freeze([
    GPU_SCENE_POSITION_VERTEX_LAYOUT
]);

export function gpuSceneDepthVertexLayouts(
    variant: Readonly<PBRMaterialVariant>
): readonly GPUDrivenVertexBufferLayout[] {
    if (variant.coverageMode === 'opaque') return GPU_SCENE_DEPTH_VERTEX_LAYOUTS;
    const textures = coverageTextures(variant);
    const layouts: GPUDrivenVertexBufferLayout[] = [GPU_SCENE_POSITION_VERTEX_LAYOUT];
    if (textures.some(binding => binding.uv === 0)) {
        layouts.push({
            arrayStride: 8,
            attributes: [{ shaderLocation: 2, format: 'float32x2', byteOffset: 0 }]
        });
    }
    if (textures.some(binding => binding.uv === 1)) {
        layouts.push({
            arrayStride: 8,
            attributes: [{ shaderLocation: 3, format: 'float32x2', byteOffset: 0 }]
        });
    }
    return layouts;
}
