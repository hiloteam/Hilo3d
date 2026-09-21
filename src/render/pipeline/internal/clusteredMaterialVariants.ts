import type Mesh from '../../../core/Mesh';
import PBRMaterial from '../../../material/PBRMaterial';
import type { MaterialPipelineState } from '../../../material/MaterialDefinition';
import { resolveMaterialPassState } from '../../../material/MaterialCompiler';
import type Texture from '../../../texture/Texture';
import {
    CLAMP_TO_EDGE,
    LINEAR,
    LINEAR_MIPMAP_LINEAR,
    LINEAR_MIPMAP_NEAREST,
    MIRRORED_REPEAT,
    NEAREST,
    NEAREST_MIPMAP_LINEAR,
    NEAREST_MIPMAP_NEAREST,
    REPEAT,
    TEXTURE_2D
} from '../../../constants/webgl';
import type {
    ComputeSamplerAddressMode,
    ComputeSamplerDescriptor,
    ComputeSamplerFilterMode
} from '../../compute/ComputeSampler';
import type { PBR_GPU_MATERIAL_TEXTURE_SLOTS } from '../../renderer/PBRGPUMaterialRecord';

/** Material eligibility, texture variants, and sampler recipes for Clustered rendering. */

export function clusteredTransparentMaterial(mesh: Mesh): PBRMaterial | null {
    const material = mesh.material;
    if (
        !(material instanceof PBRMaterial) ||
        mesh.geometry === null ||
        material.lightType !== 'PBR' ||
        !material.isTransparent ||
        material.requiresOpaqueSceneTexture ||
        material.forwardQueue !== 'transparent' ||
        mesh.useInstanced
    ) {
        return null;
    }
    return material;
}

export function clusteredOpaqueMaterial(mesh: Mesh): PBRMaterial | null {
    const material = mesh.material;
    if (
        !(material instanceof PBRMaterial) ||
        mesh.geometry === null ||
        material.lightType !== 'PBR' ||
        material.forwardQueue !== 'opaque' ||
        material.requiresOpaqueSceneTexture ||
        mesh.useInstanced
    ) {
        return null;
    }
    return material;
}

export type PBRTextureRole =
    | 'baseColorMap'
    | 'metallicMap'
    | 'roughnessMap'
    | 'metallicRoughnessMap'
    | 'occlusionMap'
    | 'emission'
    | 'normalMap'
    | 'opacityMap';

export interface PBRTextureBinding {
    readonly role: PBRTextureRole;
    readonly shaderName: string;
    readonly texture: Texture<unknown>;
    readonly uv: 0 | 1;
    readonly slotIndex: number;
}

export interface PBRMaterialVariant {
    readonly key: string;
    readonly textures: readonly PBRTextureBinding[];
    readonly usesUV0: boolean;
    readonly usesUV1: boolean;
    readonly normalUV: 0 | 1 | null;
    readonly occlusionInMetallicRoughness: boolean;
    readonly coverageMode: 'opaque' | 'mask';
    readonly alphaCutoff: number;
}

export function bucketMaterialIssue(material: PBRMaterial): string | null {
    const state = resolveMaterialPassState(material, 'forward');
    if (state === null) return 'has no forward pass';
    if (material.isTransparent || state.blend !== undefined) {
        return 'must be opaque and unblended';
    }
    if (
        material.lightType !== 'PBR' ||
        state.wireframe ||
        !state.depthTest ||
        !state.depthWrite ||
        state.depthCompare !== 'less-equal' ||
        state.depthRange[0] !== 0 ||
        state.depthRange[1] !== 1 ||
        state.stencil !== undefined ||
        state.alphaToCoverage ||
        material.coverage.mode === 'alpha-to-coverage'
    ) {
        return 'uses an unsupported raster or alpha mode';
    }
    const textureFeature =
        material.getTextureSlot('parallax') !== null
            ? 'parallaxMap'
            : material.diffuseEnvMap !== null
              ? 'diffuseEnvMap'
              : material.diffuseEnvSphereHarmonics3 !== null
                ? 'diffuseEnvSphereHarmonics3'
                : material.brdfLUT !== null
                  ? 'brdfLUT'
                  : material.specularEnvMap !== null
                    ? 'specularEnvMap'
                    : material.specularGlossinessMap !== null
                      ? 'specularGlossinessMap'
                      : material.lightMap !== null
                        ? 'lightMap'
                        : material.clearcoatMap !== null
                          ? 'clearcoatMap'
                          : material.clearcoatRoughnessMap !== null
                            ? 'clearcoatRoughnessMap'
                            : material.clearcoatNormalMap !== null
                              ? 'clearcoatNormalMap'
                              : material.anisotropyMap !== null
                                ? 'anisotropyMap'
                                : material.transmissionMap !== null
                                  ? 'transmissionMap'
                                  : material.thicknessMap !== null
                                    ? 'thicknessMap'
                                    : material.iridescenceMap !== null
                                      ? 'iridescenceMap'
                                      : material.iridescenceThicknessMap !== null
                                        ? 'iridescenceThicknessMap'
                                        : null;
    if (textureFeature !== null) {
        return `uses unsupported ${textureFeature}`;
    }
    for (const definition of PBR_TEXTURE_ROLES) {
        const texture = materialTexture(material, definition.role);
        if (texture !== null && texture.target !== TEXTURE_2D) {
            return `requires ${definition.role} to be a 2D texture`;
        }
    }
    if (
        material.isSpecularGlossiness ||
        material.clearcoatFactor !== 0 ||
        material.anisotropyStrength !== 0 ||
        material.transmissionFactor !== 0 ||
        material.thicknessFactor !== 0 ||
        material.iridescenceFactor !== 0
    ) {
        return 'uses an unsupported layered PBR feature';
    }
    return null;
}

export function validateBucketMaterial(material: PBRMaterial, bucketIndex: number): void {
    const issue = bucketMaterialIssue(material);
    if (issue !== null) {
        throw new TypeError(`GPU Scene bucket ${String(bucketIndex)} material ${issue}`);
    }
}

export function requireBucketPassState(
    material: PBRMaterial,
    role: 'forward' | 'depth-only'
): Readonly<MaterialPipelineState> {
    const state = resolveMaterialPassState(material, role);
    if (state === null) {
        throw new TypeError(`Clustered material ${material.definition.id} has no ${role} pass`);
    }
    return state;
}

export const PBR_TEXTURE_ROLES: readonly Readonly<{
    role: PBRTextureRole;
    shaderName: string;
    slotName: (typeof PBR_GPU_MATERIAL_TEXTURE_SLOTS)[number];
    slotIndex: number;
}>[] = Object.freeze([
    Object.freeze({
        role: 'baseColorMap',
        shaderName: 'u_baseColorMap',
        slotName: 'baseColor',
        slotIndex: 0
    }),
    Object.freeze({
        role: 'metallicMap',
        shaderName: 'u_metallicMap',
        slotName: 'metallic',
        slotIndex: 1
    }),
    Object.freeze({
        role: 'roughnessMap',
        shaderName: 'u_roughnessMap',
        slotName: 'roughness',
        slotIndex: 2
    }),
    Object.freeze({
        role: 'metallicRoughnessMap',
        shaderName: 'u_metallicRoughnessMap',
        slotName: 'metallicRoughness',
        slotIndex: 3
    }),
    Object.freeze({
        role: 'occlusionMap',
        shaderName: 'u_occlusionMap',
        slotName: 'occlusion',
        slotIndex: 4
    }),
    Object.freeze({
        role: 'emission',
        shaderName: 'u_emission',
        slotName: 'emission',
        slotIndex: 5
    }),
    Object.freeze({
        role: 'normalMap',
        shaderName: 'u_normalMap',
        slotName: 'normal',
        slotIndex: 6
    }),
    Object.freeze({
        role: 'opacityMap',
        shaderName: 'u_opacityMap',
        slotName: 'opacity',
        slotIndex: 7
    })
]);

function materialTexture(material: PBRMaterial, role: PBRTextureRole): Texture<unknown> | null {
    const definition = PBR_TEXTURE_ROLES.find(candidate => candidate.role === role);
    if (definition === undefined) throw new Error(`Unknown clustered PBR texture role ${role}`);
    return material.getTextureSlot(definition.slotName)?.texture ?? null;
}

export function pbrMaterialVariant(material: PBRMaterial): Readonly<PBRMaterialVariant> {
    const textures: PBRTextureBinding[] = [];
    let usesUV0 = false;
    let usesUV1 = false;
    let normalUV: 0 | 1 | null = null;
    for (const definition of PBR_TEXTURE_ROLES) {
        const texture = materialTexture(material, definition.role);
        if (texture === null) continue;
        const uv = material.getTextureSlot(definition.slotName)?.uvSet ?? 0;
        usesUV0 ||= uv === 0;
        usesUV1 ||= uv === 1;
        if (definition.role === 'normalMap') normalUV = uv;
        textures.push(
            Object.freeze({
                role: definition.role,
                shaderName: definition.shaderName,
                texture,
                uv,
                slotIndex: definition.slotIndex
            })
        );
    }
    const occlusionInMetallicRoughness = material.isOcclusionInMetallicRoughnessMap;
    const coverageMode = material.coverage.mode === 'mask' ? 'mask' : 'opaque';
    const alphaCutoff = material.coverage.mode === 'opaque' ? 0 : material.coverage.cutoff;
    return Object.freeze({
        key: [
            occlusionInMetallicRoughness ? 'mrao' : 'separate-ao',
            coverageMode === 'mask' ? `mask:${alphaCutoff.toString()}` : 'opaque',
            ...textures.map(binding => `${binding.role}:${String(binding.uv)}`)
        ].join('|'),
        textures: Object.freeze(textures),
        usesUV0,
        usesUV1,
        normalUV,
        occlusionInMetallicRoughness,
        coverageMode,
        alphaCutoff
    });
}

function textureAddressMode(value: number): ComputeSamplerAddressMode {
    switch (value) {
        case CLAMP_TO_EDGE:
            return 'clamp-to-edge';
        case REPEAT:
            return 'repeat';
        case MIRRORED_REPEAT:
            return 'mirror-repeat';
        default:
            throw new TypeError(`Unsupported GPU Scene texture wrap mode ${String(value)}`);
    }
}

function textureMagFilter(value: number): ComputeSamplerFilterMode {
    if (value === NEAREST) return 'nearest';
    if (value === LINEAR) return 'linear';
    throw new TypeError(`Unsupported GPU Scene texture magnification filter ${String(value)}`);
}

function textureMinFilters(value: number): Readonly<{
    minFilter: ComputeSamplerFilterMode;
    mipmapFilter: ComputeSamplerFilterMode;
}> {
    switch (value) {
        case NEAREST:
        case NEAREST_MIPMAP_NEAREST:
            return { minFilter: 'nearest', mipmapFilter: 'nearest' };
        case LINEAR:
        case LINEAR_MIPMAP_NEAREST:
            return { minFilter: 'linear', mipmapFilter: 'nearest' };
        case NEAREST_MIPMAP_LINEAR:
            return { minFilter: 'nearest', mipmapFilter: 'linear' };
        case LINEAR_MIPMAP_LINEAR:
            return { minFilter: 'linear', mipmapFilter: 'linear' };
        default:
            throw new TypeError(
                `Unsupported GPU Scene texture minification filter ${String(value)}`
            );
    }
}

export function textureSamplerDescriptor(
    texture: Texture<unknown>
): Readonly<ComputeSamplerDescriptor> {
    const magFilter = textureMagFilter(texture.magFilter);
    const minFilters = textureMinFilters(texture.minFilter);
    const mipmapFilter = texture.anisotropic > 1 ? 'linear' : minFilters.mipmapFilter;
    return Object.freeze({
        label: `${texture.name || texture.id} GPU Scene sampler`,
        addressModeU: textureAddressMode(texture.wrapS),
        addressModeV: textureAddressMode(texture.wrapT),
        addressModeW: textureAddressMode(texture.wrapR),
        magFilter,
        minFilter: minFilters.minFilter,
        mipmapFilter,
        lodMinClamp: 0,
        lodMaxClamp: texture.useMipmap ? Math.max(0, texture.mipmapCount - 1) : 0,
        maxAnisotropy: texture.anisotropic
    });
}

export function textureSamplerKey(texture: Texture<unknown>): string {
    return [
        texture.wrapS,
        texture.wrapT,
        texture.wrapR,
        texture.magFilter,
        texture.minFilter,
        texture.anisotropic,
        texture.useMipmap ? texture.mipmapCount : 1
    ].join(':');
}
