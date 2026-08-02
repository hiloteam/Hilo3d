import type Camera from '../../camera/Camera';
import PerspectiveCamera from '../../camera/PerspectiveCamera';
import Mesh from '../../core/Mesh';
import Node from '../../core/Node';
import { getTransformHistoryRevision } from '../../core/TransformHistory';
import Geometry from '../../geometry/Geometry';
import type GeometryData from '../../geometry/GeometryData';
import AmbientLight from '../../light/AmbientLight';
import AreaLight from '../../light/AreaLight';
import DirectionalLight from '../../light/DirectionalLight';
import PointLight from '../../light/PointLight';
import SpotLight from '../../light/SpotLight';
import PBRMaterial from '../../material/PBRMaterial';
import {
    DEFAULT_MATERIAL_PIPELINE_STATE,
    type MaterialCullMode,
    type MaterialFrontFace,
    type MaterialPipelineState
} from '../../material/MaterialDefinition';
import { resolveMaterialPassState } from '../../material/MaterialCompiler';
import Matrix3 from '../../math/Matrix3';
import Matrix4 from '../../math/Matrix4';
import Vector3 from '../../math/Vector3';
import Shader from '../../shader/Shader';
import pbrBrdfSource from '../../shader/chunk/pbr_brdf.glsl';
import pbrSurfaceSource from '../../shader/chunk/pbr_surface.glsl';
import encodingSource from '../../shader/method/encoding.glsl';
import type Texture from '../../texture/Texture';
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
    TEXTURE_2D,
    TRIANGLES
} from '../../constants/webgl';
import ComputeKernel from '../compute/ComputeKernel';
import ComputeSampler, {
    type ComputeSamplerAddressMode,
    type ComputeSamplerDescriptor,
    type ComputeSamplerFilterMode
} from '../compute/ComputeSampler';
import ComputeShader, {
    type ComputeShaderBinding,
    type ShaderReadBinding
} from '../compute/ComputeShader';
import StorageGraphicsShader from '../compute/StorageGraphicsShader';
import { depthClearValue } from '../renderer/DepthConvention';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext,
    RenderPipelineFactory,
    RenderPipelineRequirements
} from './RenderPipeline';
import type {
    CullingResultsHandle,
    RendererListDescriptor,
    RendererListHandle
} from './RendererList';
import { RenderPassParameterPool } from './RenderPassParameterPool';
import {
    ComputeRenderPass,
    FullscreenRenderPass,
    GPUDrivenRenderPass,
    PresentRenderPass,
    SceneRenderPass,
    TextureCopyPass,
    type ComputeRenderPassParameters,
    type FullscreenRenderPassParameters,
    type GPUDrivenRenderPassParameters,
    type GPUDrivenVertexBufferLayout,
    type SceneRenderPassParameters,
    type TextureCopyPassParameters
} from './passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from './passes/internal/PortableFullscreenShader';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    RenderPipelineHistoryTextureDescriptor,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext
} from './ScriptableRenderGraph';

const OBJECT_RECORD_BYTES = 208;
const LIGHT_RECORD_BYTES = 64;
const MATERIAL_RECORD_BYTES = 144;
const BUCKET_RECORD_BYTES = 48;
const FRAME_RECORD_BYTES = 496;
const INDIRECT_ARGUMENT_BYTES = 20;
const STATS_BYTES = 16;
const HIZ_LEVEL_COUNT = 6;
const CULL_WORKGROUP_SIZE = 64;
const PREFIX_WORKGROUP_SIZE = 256;
const DEFAULT_MAX_OBJECTS = 16_384;
const DEFAULT_MAX_LIGHTS = 512;
const DEFAULT_MAX_LIGHT_INDICES = 1_048_576;
const DEFAULT_MAX_LIGHTS_PER_CLUSTER = 96;
const DEFAULT_TILE_SIZE = 32;
const DEFAULT_Z_SLICES = 24;
const DEFAULT_MAX_VIEWPORT_WIDTH = 2560;
const DEFAULT_MAX_VIEWPORT_HEIGHT = 1440;
const INVALID_BUFFER = 0 as RenderGraphBufferHandle;
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const INVALID_CULLING_RESULTS = 0 as CullingResultsHandle;
const INVALID_RENDERER_LIST = 0 as RendererListHandle;

/** One lower-detail geometry selected when its projected bounding radius is small enough. */
export interface GPUSceneLOD {
    /** Indexed triangle geometry with float32 position/normal and any material-required UV/tangent streams. */
    readonly geometry: Geometry;
    /** Maximum projected radius in physical pixels at which this LOD is selected. */
    readonly maximumProjectedRadius: number;
}

/** One material/geometry family consumed by the GPU Scene fixed-bucket indirect path. */
export interface GPUSceneBucket {
    /** Highest-detail indexed triangle geometry. */
    readonly geometry: Geometry;
    /**
     * Opaque built-in metallic/roughness PBR material evaluated by the shared surface/BRDF
     * contract. Base-color, metallic, roughness, combined metallic-roughness, occlusion, emission,
     * and normal maps support UV0/UV1 and material UV matrices. Layered extensions, custom
     * compilation, parallax/environment inputs, and non-default depth/alpha modes fail closed.
     */
    readonly material: PBRMaterial;
    /** Optional coarse levels ordered from smallest to largest projected-radius threshold. */
    readonly lods?: readonly GPUSceneLOD[];
}

/** Construction options for the WebGPU high-end GPU Scene and Clustered Forward+ pipeline. */
export interface ClusteredForwardPlusPipelineOptions {
    /**
     * GPU Scene bucket families. Compatible opaque meshes match by identity; other scene meshes
     * remain renderable through the shared Forward compatibility path.
     */
    readonly buckets: readonly GPUSceneBucket[];
    /** Stable GPU Scene object capacity. Excess meshes use the Forward fallback. Defaults to 16,384. */
    readonly maxObjects?: number;
    /** GPU light-database capacity. Extra traversal-order lights are deterministically dropped. */
    readonly maxLights?: number;
    /** Global cluster light-index budget. Defaults to 1,048,576 indices. */
    readonly maxLightIndices?: number;
    /** Per-cluster allocation ceiling. Defaults to 96. */
    readonly maxLightsPerCluster?: number;
    /** Cluster tile width and height in physical pixels. Defaults to 32. */
    readonly tileSize?: number;
    /** Logarithmic view-depth slice count. Defaults to 24. */
    readonly zSlices?: number;
    /** Largest supported physical output width. Defaults to 2560. */
    readonly maxViewportWidth?: number;
    /** Largest supported physical output height. Defaults to 1440. */
    readonly maxViewportHeight?: number;
    /** Enable previous-frame Hi-Z occlusion. Defaults to true. */
    readonly hiZ?: boolean;
    /** Bloom contribution mixed into the final display transform. Defaults to 0.7. */
    readonly bloomStrength?: number;
    /** Exposure multiplier applied before the ACES display transform. Defaults to 1. */
    readonly exposure?: number;
}

/** On-demand GPU counters plus current CPU database occupancy. */
export interface ClusteredForwardPlusDiagnostics {
    /** Ordinary registered meshes currently occupying stable GPU Scene slots. */
    readonly objectCount: number;
    /** Visible-layer meshes routed through the shared Forward compatibility fallback. */
    readonly fallbackObjectCount: number;
    /** Enabled supported lights uploaded to the current GPU light database. */
    readonly lightCount: number;
    /** Enabled supported lights rejected by the configured light capacity. */
    readonly droppedLightCount: number;
    /** Objects written to a fixed visible bucket by the most recent submitted cull. */
    readonly visibleObjectCount: number;
    /** Objects rejected by conservative previous-frame Hi-Z occlusion. */
    readonly occludedObjectCount: number;
    /** Visible objects that selected a lower-detail geometry bucket. */
    readonly lodObjectCount: number;
    /** Light indices retained by the bounded cluster allocator. */
    readonly clusterLightIndexCount: number;
    /** Light-index entries truncated by per-cluster or global allocation limits. */
    readonly clusterOverflowCount: number;
    /** Whether conservative occlusion used a valid previous-frame Hi-Z pyramid. */
    readonly hiZValid: boolean;
}

interface NormalizedLOD {
    readonly geometry: Geometry;
    readonly maximumProjectedRadius: number;
}

interface NormalizedBucket {
    readonly geometry: Geometry;
    readonly material: PBRMaterial;
    readonly lods: readonly NormalizedLOD[];
    readonly frontFace: MaterialFrontFace;
    readonly cullMode: MaterialCullMode;
}

interface NormalizedOptions {
    readonly buckets: readonly NormalizedBucket[];
    readonly maxObjects: number;
    readonly maxLights: number;
    readonly maxLightIndices: number;
    readonly maxLightsPerCluster: number;
    readonly tileSize: number;
    readonly zSlices: number;
    readonly maxViewportWidth: number;
    readonly maxViewportHeight: number;
    readonly hiZ: boolean;
    readonly bloomStrength: number;
    readonly exposure: number;
}

interface ClusterCapacityPlan {
    readonly maxTilesX: number;
    readonly maxTilesY: number;
    readonly maxTiles: number;
    readonly maxClusters: number;
    readonly maxClusterBlocks: number;
}

interface BufferRequirementPlan {
    readonly maxStorageBufferBindingSize: number;
    readonly maxBufferSize: number;
    readonly maxComputeWorkgroupsPerDimension: number;
}

interface PhysicalBucket {
    readonly logicalIndex: number;
    readonly physicalIndex: number;
    readonly geometry: Geometry;
    readonly position: StorageBuffer;
    readonly normal: StorageBuffer;
    readonly uv0: StorageBuffer | null;
    readonly uv1: StorageBuffer | null;
    readonly tangent0: StorageBuffer | null;
    readonly tangent1: StorageBuffer | null;
    readonly index: StorageBuffer;
    readonly indexFormat: 'uint16' | 'uint32';
    readonly indexCount: number;
    readonly positionSource: GeometryData;
    readonly normalSource: GeometryData;
    readonly uv0Source: GeometryData | null;
    readonly uv1Source: GeometryData | null;
    readonly tangent0Source: GeometryData | null;
    readonly tangent1Source: GeometryData | null;
    readonly indexSource: GeometryData;
    positionRevision: number;
    normalRevision: number;
    uv0Revision: number;
    uv1Revision: number;
    tangent0Revision: number;
    tangent1Revision: number;
    indexRevision: number;
    readonly depthPass: GPUDrivenRenderPass;
    colorPass: GPUDrivenRenderPass;
    materialVariantKey: string;
    materialVariant: Readonly<PBRMaterialVariant>;
}

type PBRTextureRole =
    | 'baseColorMap'
    | 'metallicMap'
    | 'roughnessMap'
    | 'metallicRoughnessMap'
    | 'occlusionMap'
    | 'emission'
    | 'normalMap';

interface PBRTextureBinding {
    readonly role: PBRTextureRole;
    readonly shaderName: string;
    readonly texture: Texture<unknown>;
    readonly uv: 0 | 1;
}

interface PBRMaterialVariant {
    readonly key: string;
    readonly textures: readonly PBRTextureBinding[];
    readonly usesUV0: boolean;
    readonly usesUV1: boolean;
    readonly normalUV: 0 | 1 | null;
    readonly gammaCorrection: boolean;
    readonly occlusionInMetallicRoughness: boolean;
}

interface GPUSceneObjectRecord {
    readonly mesh: Mesh;
    readonly slot: number;
    logicalBucket: number;
    seenFrame: number;
    pendingWorldVersion: number;
    committedWorldVersion: number;
    readonly committedMatrix: Float32Array;
    readonly pendingMatrix: Float32Array;
}

function positiveInteger(value: unknown, name: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
    return value as number;
}

function finiteNonNegative(value: unknown, name: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a finite non-negative number`);
    }
    return value;
}

function finitePositive(value: unknown, name: string): number {
    const result = finiteNonNegative(value, name);
    if (result === 0) throw new RangeError(`${name} must be greater than zero`);
    return result;
}

function safeProduct(name: string, ...values: readonly number[]): number {
    let result = 1;
    for (const value of values) {
        result *= value;
        if (!Number.isSafeInteger(result)) {
            throw new RangeError(`${name} exceeds the safe integer range`);
        }
    }
    return result;
}

function bucketMaterialIssue(material: PBRMaterial): string | null {
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
        material.coverage.mode !== 'opaque' ||
        material.opacity !== 1
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

function validateBucketMaterial(material: PBRMaterial, bucketIndex: number): void {
    const issue = bucketMaterialIssue(material);
    if (issue !== null) {
        throw new TypeError(`GPU Scene bucket ${String(bucketIndex)} material ${issue}`);
    }
}

function requireBucketPassState(
    material: PBRMaterial,
    role: 'forward' | 'depth-only'
): Readonly<MaterialPipelineState> {
    const state = resolveMaterialPassState(material, role);
    if (state === null) {
        throw new TypeError(`Clustered material ${material.definition.id} has no ${role} pass`);
    }
    return state;
}

const PBR_TEXTURE_ROLES: readonly Readonly<{
    role: PBRTextureRole;
    shaderName: string;
}>[] = Object.freeze([
    Object.freeze({ role: 'baseColorMap', shaderName: 'u_baseColorMap' }),
    Object.freeze({ role: 'metallicMap', shaderName: 'u_metallicMap' }),
    Object.freeze({ role: 'roughnessMap', shaderName: 'u_roughnessMap' }),
    Object.freeze({ role: 'metallicRoughnessMap', shaderName: 'u_metallicRoughnessMap' }),
    Object.freeze({ role: 'occlusionMap', shaderName: 'u_occlusionMap' }),
    Object.freeze({ role: 'emission', shaderName: 'u_emission' }),
    Object.freeze({ role: 'normalMap', shaderName: 'u_normalMap' })
]);

function materialTexture(material: PBRMaterial, role: PBRTextureRole): Texture<unknown> | null {
    const slotName =
        role === 'baseColorMap'
            ? 'baseColor'
            : role === 'metallicMap'
              ? 'metallic'
              : role === 'roughnessMap'
                ? 'roughness'
                : role === 'metallicRoughnessMap'
                  ? 'metallicRoughness'
                  : role === 'occlusionMap'
                    ? 'occlusion'
                    : role === 'normalMap'
                      ? 'normal'
                      : 'emission';
    return material.getTextureSlot(slotName)?.texture ?? null;
}

function pbrMaterialVariant(material: PBRMaterial): Readonly<PBRMaterialVariant> {
    const textures: PBRTextureBinding[] = [];
    let usesUV0 = false;
    let usesUV1 = false;
    let normalUV: 0 | 1 | null = null;
    for (const definition of PBR_TEXTURE_ROLES) {
        const texture = materialTexture(material, definition.role);
        if (texture === null) continue;
        const slotName =
            definition.role === 'baseColorMap'
                ? 'baseColor'
                : definition.role === 'metallicMap'
                  ? 'metallic'
                  : definition.role === 'roughnessMap'
                    ? 'roughness'
                    : definition.role === 'metallicRoughnessMap'
                      ? 'metallicRoughness'
                      : definition.role === 'occlusionMap'
                        ? 'occlusion'
                        : definition.role === 'normalMap'
                          ? 'normal'
                          : 'emission';
        const uv = material.getTextureSlot(slotName)?.uvSet ?? 0;
        usesUV0 ||= uv === 0;
        usesUV1 ||= uv === 1;
        if (definition.role === 'normalMap') normalUV = uv;
        textures.push(
            Object.freeze({
                role: definition.role,
                shaderName: definition.shaderName,
                texture,
                uv
            })
        );
    }
    const gammaCorrection = material.getTextureSlot('baseColor')?.encoding === 'srgb';
    const occlusionInMetallicRoughness = material.isOcclusionInMetallicRoughnessMap;
    return Object.freeze({
        key: [
            gammaCorrection ? 'gamma' : 'linear',
            occlusionInMetallicRoughness ? 'mrao' : 'separate-ao',
            ...textures.map(binding => `${binding.role}:${String(binding.uv)}`)
        ].join('|'),
        textures: Object.freeze(textures),
        usesUV0,
        usesUV1,
        normalUV,
        gammaCorrection,
        occlusionInMetallicRoughness
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

function textureSamplerDescriptor(texture: Texture<unknown>): Readonly<ComputeSamplerDescriptor> {
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

function textureSamplerKey(texture: Texture<unknown>): string {
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

function clusterCapacityPlan(options: Readonly<NormalizedOptions>): Readonly<ClusterCapacityPlan> {
    const maxTilesX = Math.ceil(options.maxViewportWidth / options.tileSize);
    const maxTilesY = Math.ceil(options.maxViewportHeight / options.tileSize);
    const maxTiles = safeProduct('Clustered Forward+ maximum tile count', maxTilesX, maxTilesY);
    const maxClusters = safeProduct(
        'Clustered Forward+ maximum cluster count',
        maxTiles,
        options.zSlices
    );
    return Object.freeze({
        maxTilesX,
        maxTilesY,
        maxTiles,
        maxClusters,
        maxClusterBlocks: Math.ceil(maxClusters / PREFIX_WORKGROUP_SIZE)
    });
}

function bufferRequirementPlan(
    options: Readonly<NormalizedOptions>,
    physicalCount: number
): Readonly<BufferRequirementPlan> {
    const capacity = clusterCapacityPlan(options);
    const storageBufferLengths = [
        FRAME_RECORD_BYTES,
        safeProduct('GPU Scene object database size', options.maxObjects, OBJECT_RECORD_BYTES),
        safeProduct('GPU Scene bucket database size', options.buckets.length, BUCKET_RECORD_BYTES),
        safeProduct(
            'GPU Scene material database size',
            options.buckets.length,
            MATERIAL_RECORD_BYTES
        ),
        safeProduct(
            'Clustered Forward+ light database size',
            options.maxLights,
            LIGHT_RECORD_BYTES
        ),
        safeProduct(
            'GPU Scene visible database size',
            visibleBucketCapacity(options.maxObjects),
            physicalCount,
            4
        ),
        safeProduct('GPU Scene indirect database size', physicalCount, INDIRECT_ARGUMENT_BYTES),
        safeProduct('Clustered Forward+ tile-depth database size', capacity.maxTiles, 8),
        safeProduct('Clustered Forward+ cluster-count database size', capacity.maxClusters, 4),
        safeProduct('Clustered Forward+ cluster-grid database size', capacity.maxClusters, 8),
        safeProduct('Clustered Forward+ cluster-cursor database size', capacity.maxClusters, 4),
        safeProduct('Clustered Forward+ cluster-block database size', capacity.maxClusterBlocks, 4),
        safeProduct('Clustered Forward+ light-index database size', options.maxLightIndices, 4),
        STATS_BYTES
    ];
    let maxStorageBufferBindingSize = Math.max(...storageBufferLengths);
    let maxBufferSize = maxStorageBufferBindingSize;
    for (const bucket of options.buckets) {
        for (const geometry of [bucket.geometry, ...bucket.lods.map(lod => lod.geometry)]) {
            const data = validateGeometryData(geometry);
            const largestGeometryBuffer = Math.max(
                alignedByteLength(data.position.data.byteLength),
                alignedByteLength(data.normal.data.byteLength),
                ...[data.uv0, data.uv1, data.tangent0, data.tangent1]
                    .filter((value): value is GeometryData => value !== null)
                    .map(value => alignedByteLength(value.data.byteLength)),
                alignedByteLength(data.index.data.byteLength)
            );
            maxStorageBufferBindingSize = Math.max(
                maxStorageBufferBindingSize,
                largestGeometryBuffer
            );
            maxBufferSize = Math.max(maxBufferSize, largestGeometryBuffer);
        }
    }
    const maxComputeWorkgroupsPerDimension = Math.max(
        Math.ceil(options.maxObjects / CULL_WORKGROUP_SIZE),
        Math.ceil(options.maxLights / CULL_WORKGROUP_SIZE),
        capacity.maxClusterBlocks,
        capacity.maxTilesX,
        capacity.maxTilesY,
        Math.ceil(options.maxViewportWidth / 16),
        Math.ceil(options.maxViewportHeight / 16),
        1
    );
    return Object.freeze({
        maxStorageBufferBindingSize,
        maxBufferSize,
        maxComputeWorkgroupsPerDimension
    });
}

function visibleBucketCapacity(maxObjects: number): number {
    return Math.ceil((maxObjects * 4) / 256) * 64;
}

function normalizeOptions(options: unknown): Readonly<NormalizedOptions> {
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
        throw new TypeError('Clustered Forward+ options must be an object');
    }
    const input = options as Partial<ClusteredForwardPlusPipelineOptions>;
    const rawBuckets: unknown = input.buckets;
    if (!Array.isArray(rawBuckets) || rawBuckets.length === 0) {
        throw new RangeError('Clustered Forward+ requires at least one GPU Scene bucket');
    }
    const buckets = rawBuckets.map((bucket: unknown, bucketIndex): NormalizedBucket => {
        if (typeof bucket !== 'object' || bucket === null || Array.isArray(bucket)) {
            throw new TypeError(`GPU Scene bucket ${String(bucketIndex)} must be an object`);
        }
        const bucketInput = bucket as Partial<GPUSceneBucket>;
        if (!(bucketInput.geometry instanceof Geometry)) {
            throw new TypeError(`GPU Scene bucket ${String(bucketIndex)} requires Geometry`);
        }
        if (bucketInput.geometry.isMorphGeometry) {
            throw new TypeError(
                `GPU Scene bucket ${String(bucketIndex)} must not use morph geometry`
            );
        }
        if (!(bucketInput.material instanceof PBRMaterial)) {
            throw new TypeError(`GPU Scene bucket ${String(bucketIndex)} requires PBRMaterial`);
        }
        validateBucketMaterial(bucketInput.material, bucketIndex);
        validateGeometryData(bucketInput.geometry);
        const rawLODs: unknown = bucketInput.lods ?? [];
        if (!Array.isArray(rawLODs)) {
            throw new TypeError(`GPU Scene bucket ${String(bucketIndex)} lods must be an array`);
        }
        const lods = rawLODs
            .map((lod: unknown, lodIndex): NormalizedLOD => {
                if (typeof lod !== 'object' || lod === null || Array.isArray(lod)) {
                    throw new TypeError(
                        `GPU Scene bucket ${String(bucketIndex)} LOD ${String(lodIndex)} must be an object`
                    );
                }
                const lodInput = lod as Partial<GPUSceneLOD>;
                if (!(lodInput.geometry instanceof Geometry)) {
                    throw new TypeError(
                        `GPU Scene bucket ${String(bucketIndex)} LOD ${String(lodIndex)} requires Geometry`
                    );
                }
                if (lodInput.geometry.isMorphGeometry) {
                    throw new TypeError(
                        `GPU Scene bucket ${String(bucketIndex)} LOD ${String(lodIndex)} must not use morph geometry`
                    );
                }
                validateGeometryData(lodInput.geometry);
                return Object.freeze({
                    geometry: lodInput.geometry,
                    maximumProjectedRadius: finitePositive(
                        lodInput.maximumProjectedRadius,
                        `GPU Scene bucket ${String(bucketIndex)} LOD threshold`
                    )
                });
            })
            .sort((left, right) => left.maximumProjectedRadius - right.maximumProjectedRadius);
        if (lods.length > 3) throw new RangeError('GPU Scene buckets support at most three LODs');
        for (let index = 1; index < lods.length; index += 1) {
            if (
                (lods[index - 1]?.maximumProjectedRadius ?? 0) ===
                lods[index]?.maximumProjectedRadius
            ) {
                throw new RangeError('GPU Scene LOD thresholds must be unique');
            }
        }
        return Object.freeze({
            geometry: bucketInput.geometry,
            material: bucketInput.material,
            lods: Object.freeze(lods),
            frontFace:
                resolveMaterialPassState(bucketInput.material, 'forward')?.frontFace ?? 'ccw',
            cullMode: resolveMaterialPassState(bucketInput.material, 'forward')?.cullMode ?? 'back'
        });
    });
    const materialIdentities = new Map<Geometry, Set<PBRMaterial>>();
    for (const bucket of buckets) {
        let materials = materialIdentities.get(bucket.geometry);
        if (materials === undefined) {
            materials = new Set();
            materialIdentities.set(bucket.geometry, materials);
        }
        if (materials.has(bucket.material)) {
            throw new TypeError('GPU Scene bucket geometry/material identities must be unique');
        }
        materials.add(bucket.material);
    }
    const maxViewportWidth = positiveInteger(
        input.maxViewportWidth ?? DEFAULT_MAX_VIEWPORT_WIDTH,
        'Clustered Forward+ maxViewportWidth'
    );
    const maxViewportHeight = positiveInteger(
        input.maxViewportHeight ?? DEFAULT_MAX_VIEWPORT_HEIGHT,
        'Clustered Forward+ maxViewportHeight'
    );
    const tileSize = positiveInteger(
        input.tileSize ?? DEFAULT_TILE_SIZE,
        'Clustered Forward+ tileSize'
    );
    if (tileSize < 8 || tileSize > 128) {
        throw new RangeError('Clustered Forward+ tileSize must be between 8 and 128');
    }
    const zSlices = positiveInteger(
        input.zSlices ?? DEFAULT_Z_SLICES,
        'Clustered Forward+ zSlices'
    );
    if (zSlices > 64) throw new RangeError('Clustered Forward+ zSlices cannot exceed 64');
    if (input.hiZ !== undefined && typeof input.hiZ !== 'boolean') {
        throw new TypeError('Clustered Forward+ hiZ must be a boolean');
    }
    return Object.freeze({
        buckets: Object.freeze(buckets),
        maxObjects: positiveInteger(
            input.maxObjects ?? DEFAULT_MAX_OBJECTS,
            'Clustered Forward+ maxObjects'
        ),
        maxLights: positiveInteger(
            input.maxLights ?? DEFAULT_MAX_LIGHTS,
            'Clustered Forward+ maxLights'
        ),
        maxLightIndices: positiveInteger(
            input.maxLightIndices ?? DEFAULT_MAX_LIGHT_INDICES,
            'Clustered Forward+ maxLightIndices'
        ),
        maxLightsPerCluster: positiveInteger(
            input.maxLightsPerCluster ?? DEFAULT_MAX_LIGHTS_PER_CLUSTER,
            'Clustered Forward+ maxLightsPerCluster'
        ),
        tileSize,
        zSlices,
        maxViewportWidth,
        maxViewportHeight,
        hiZ: input.hiZ ?? true,
        bloomStrength: finiteNonNegative(
            input.bloomStrength ?? 0.7,
            'Clustered Forward+ bloomStrength'
        ),
        exposure: finitePositive(input.exposure ?? 1, 'Clustered Forward+ exposure')
    });
}

function computePass(shader: ComputeShader): ComputeRenderPass {
    return new ComputeRenderPass(new ComputeKernel({ label: shader.label, shader }), shader.label);
}

const FRAME_WGSL = `
struct FrameData {
    currentViewProjection: mat4x4<f32>,
    previousViewProjection: mat4x4<f32>,
    view: mat4x4<f32>,
    projection: mat4x4<f32>,
    previousView: mat4x4<f32>,
    previousProjection: mat4x4<f32>,
    viewport: vec4<f32>,
    depth: vec4<f32>,
    previousDepth: vec4<f32>,
    cluster: vec4<u32>,
    counts: vec4<u32>,
    budgets: vec4<u32>,
    ambient: vec4<f32>,
};
struct ObjectRecord {
    model0: vec4<f32>, model1: vec4<f32>, model2: vec4<f32>, model3: vec4<f32>,
    previous0: vec4<f32>, previous1: vec4<f32>, previous2: vec4<f32>, previous3: vec4<f32>,
    normal0: vec4<f32>, normal1: vec4<f32>, normal2: vec4<f32>,
    bounds: vec4<f32>,
    metadata: vec4<u32>,
};
struct BucketRecord {
    indices0: vec4<u32>,
    indices1: vec4<u32>,
    thresholds: vec4<f32>,
};
fn objectModel(object: ObjectRecord) -> mat4x4<f32> {
    return mat4x4<f32>(object.model0, object.model1, object.model2, object.model3);
}
fn objectPreviousModel(object: ObjectRecord) -> mat4x4<f32> {
    return mat4x4<f32>(object.previous0, object.previous1, object.previous2, object.previous3);
}
fn maximumScale(model: mat4x4<f32>) -> f32 {
    return max(length(model[0].xyz), max(length(model[1].xyz), length(model[2].xyz)));
}
fn projectedRadiusPixels(
    projection: mat4x4<f32>, viewportSize: vec2<f32>, nearPlane: f32,
    viewDepth: f32, radius: f32
) -> vec2<f32> {
    let projectionScale = vec2<f32>(abs(projection[0][0]), abs(projection[1][1]));
    return projectionScale * viewportSize * radius / max(viewDepth, nearPlane) * 0.5;
}
fn selectPhysicalBucket(bucket: BucketRecord, radiusPixels: f32) -> u32 {
    let count = bucket.indices0.y;
    if (count > 0u && radiusPixels <= bucket.thresholds.x) { return bucket.indices0.z; }
    if (count > 1u && radiusPixels <= bucket.thresholds.y) { return bucket.indices0.w; }
    if (count > 2u && radiusPixels <= bucket.thresholds.z) { return bucket.indices1.x; }
    return bucket.indices0.x;
}
`;

function gpuSceneCullShader(withHiZ: boolean): ComputeShader {
    const textureDeclarations = withHiZ
        ? Array.from(
              { length: HIZ_LEVEL_COUNT },
              (_unused, index) =>
                  `@group(0) @binding(${String(6 + index)}) var previousHiZ${String(index)}: texture_2d<f32>;`
          ).join('\n')
        : '';
    const textureSample = withHiZ
        ? `
fn hiZDimensions(level: u32) -> vec2<u32> {
    switch level {
        case 0u: { return textureDimensions(previousHiZ0); }
        case 1u: { return textureDimensions(previousHiZ1); }
        case 2u: { return textureDimensions(previousHiZ2); }
        case 3u: { return textureDimensions(previousHiZ3); }
        case 4u: { return textureDimensions(previousHiZ4); }
        default: { return textureDimensions(previousHiZ5); }
    }
}
fn hiZLoad(level: u32, pixel: vec2<i32>) -> f32 {
    switch level {
        case 0u: { return textureLoad(previousHiZ0, pixel, 0).x; }
        case 1u: { return textureLoad(previousHiZ1, pixel, 0).x; }
        case 2u: { return textureLoad(previousHiZ2, pixel, 0).x; }
        case 3u: { return textureLoad(previousHiZ3, pixel, 0).x; }
        case 4u: { return textureLoad(previousHiZ4, pixel, 0).x; }
        default: { return textureLoad(previousHiZ5, pixel, 0).x; }
    }
}
fn depthFromDistance(depthParameters: vec4<f32>, distance: f32) -> f32 {
    let nearPlane = depthParameters.x;
    let farPlane = depthParameters.y;
    let standard = (farPlane - nearPlane * farPlane / max(distance, nearPlane)) /
        max(farPlane - nearPlane, 0.0001);
    return select(standard, 1.0 - standard, depthParameters.w > 0.5);
}
fn occludedByPreviousHiZ(
    frame: FrameData,
    previousCenter: vec3<f32>,
    radius: f32,
    motion: f32
) -> bool {
    if (frame.budgets.z == 0u || motion > radius * 0.25 || radius <= 0.0) { return false; }
    let clip = frame.previousViewProjection * vec4<f32>(previousCenter, 1.0);
    if (clip.w <= 0.0) { return false; }
    let ndc = clip.xy / clip.w;
    let viewCenter = frame.previousView * vec4<f32>(previousCenter, 1.0);
    let viewDepth = max(-viewCenter.z, frame.previousDepth.x);
    let radiusPixels = projectedRadiusPixels(
        frame.previousProjection, frame.viewport.zw, frame.previousDepth.x, viewDepth, radius
    );
    if (max(radiusPixels.x, radiusPixels.y) > 96.0) { return false; }
    let diameter = max(max(radiusPixels.x, radiusPixels.y) * 2.0, 1.0);
    let level = u32(clamp(floor(log2(diameter)) - 1.0, 0.0, ${String(HIZ_LEVEL_COUNT - 1)}.0));
    let dimensions = hiZDimensions(level);
    let centerUv = ndc * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    let radiusUv = radiusPixels / frame.viewport.zw;
    let nearestDepth = depthFromDistance(
        frame.previousDepth, max(viewDepth - radius, frame.previousDepth.x)
    );
    var hidden = true;
    for (var sampleIndex = 0u; sampleIndex < 5u; sampleIndex += 1u) {
        var offset = vec2<f32>(0.0);
        if (sampleIndex == 1u) { offset = vec2<f32>(-radiusUv.x, -radiusUv.y); }
        if (sampleIndex == 2u) { offset = vec2<f32>( radiusUv.x, -radiusUv.y); }
        if (sampleIndex == 3u) { offset = vec2<f32>(-radiusUv.x,  radiusUv.y); }
        if (sampleIndex == 4u) { offset = vec2<f32>( radiusUv.x,  radiusUv.y); }
        let uv = clamp(centerUv + offset, vec2<f32>(0.0), vec2<f32>(0.999999));
        let pixel = vec2<i32>(uv * vec2<f32>(dimensions));
        let depth = hiZLoad(level, pixel);
        let sampleHidden = select(
            (depth < nearestDepth - 0.0005),
            (depth > nearestDepth + 0.0005),
            frame.previousDepth.w > 0.5
        );
        hidden = hidden && sampleHidden;
    }
    return hidden;
}`
        : `
fn occludedByPreviousHiZ(
    frame: FrameData,
    previousCenter: vec3<f32>,
    radius: f32,
    motion: f32
) -> bool {
    return false;
}`;
    return new ComputeShader({
        label: withHiZ
            ? 'GPU Scene previous Hi-Z occlusion, frustum, and LOD culling'
            : 'GPU Scene frustum and LOD culling',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> objects: array<ObjectRecord>;
@group(0) @binding(2) var<storage, read> buckets: array<BucketRecord>;
@group(0) @binding(3) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> indirectArguments: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> cullStats: array<atomic<u32>>;
${textureDeclarations}
${textureSample}
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.x || id.x >= frameData.budgets.x) { return; }
    let object = objects[id.x];
    if (object.metadata.z == 0u || (object.metadata.y & frameData.budgets.w) == 0u) { return; }
    let model = objectModel(object);
    let previousModel = objectPreviousModel(object);
    let localCenter = vec4<f32>(object.bounds.xyz, 1.0);
    let center = (model * localCenter).xyz;
    let previousCenter = (previousModel * localCenter).xyz;
    let radius = object.bounds.w * maximumScale(model);
    let previousRadius = object.bounds.w * maximumScale(previousModel);
    let clip = frameData.currentViewProjection * vec4<f32>(center, 1.0);
    if (clip.w <= 0.0) { return; }
    let radiusClip = vec2<f32>(
        abs(frameData.projection[0][0]), abs(frameData.projection[1][1])
    ) * radius;
    if (abs(clip.x) > clip.w + radiusClip.x || abs(clip.y) > clip.w + radiusClip.y) { return; }
    let viewCenter = frameData.view * vec4<f32>(center, 1.0);
    let viewDepth = -viewCenter.z;
    if (viewDepth + radius < frameData.depth.x || viewDepth - radius > frameData.depth.y) { return; }
    let motion = distance(center, previousCenter) + abs(radius - previousRadius);
    if (occludedByPreviousHiZ(frameData, previousCenter, previousRadius, motion)) {
        _ = atomicAdd(&cullStats[1], 1u);
        return;
    }
    let radiusPixels = projectedRadiusPixels(
        frameData.projection, frameData.viewport.zw, frameData.depth.x, viewDepth, radius
    );
    let physicalBucket = selectPhysicalBucket(
        buckets[object.metadata.x], max(radiusPixels.x, radiusPixels.y)
    );
    if (physicalBucket != buckets[object.metadata.x].indices0.x) {
        _ = atomicAdd(&cullStats[2], 1u);
    }
    let localIndex = atomicAdd(&indirectArguments[physicalBucket * 5u + 1u], 1u);
    if (localIndex >= frameData.budgets.x) {
        _ = atomicAdd(&cullStats[3], 1u);
        return;
    }
    visibleIndices[physicalBucket * frameData.budgets.x + localIndex] = id.x;
    _ = atomicAdd(&cullStats[0], 1u);
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: gpuSceneCullBindings(withHiZ)
    });
}

function gpuSceneCullBindings(withHiZ: boolean): readonly ComputeShaderBinding[] {
    const bindings: ComputeShaderBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'buckets', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        {
            name: 'visibleIndices',
            group: 0,
            binding: 3,
            kind: 'storage-buffer',
            access: 'write-discard'
        },
        {
            name: 'indirectArguments',
            group: 0,
            binding: 4,
            kind: 'storage-buffer',
            access: 'read-write'
        },
        {
            name: 'cullStats',
            group: 0,
            binding: 5,
            kind: 'storage-buffer',
            access: 'read-write'
        }
    ];
    if (withHiZ) {
        for (let index = 0; index < HIZ_LEVEL_COUNT; index += 1) {
            bindings.push({
                name: `previousHiZ${String(index)}`,
                group: 0,
                binding: 6 + index,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            });
        }
    }
    return Object.freeze(bindings);
}

const GPU_SCENE_CULL_PASS = computePass(gpuSceneCullShader(false));

const GPU_SCENE_HIZ_CULL_PASS = computePass(gpuSceneCullShader(true));

const HIZ_DEPTH_REDUCE_PASS = computePass(
    new ComputeShader({
        label: 'GPU Scene current depth Hi-Z mip zero',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var sourceDepth: texture_depth_2d;
@group(0) @binding(2) var destination: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    let inputSize = textureDimensions(sourceDepth);
    let base = id.xy * 2u;
    var reduced = select(0.0, 1.0, frameData.depth.w > 0.5);
    for (var y = 0u; y < 2u; y += 1u) {
        for (var x = 0u; x < 2u; x += 1u) {
            let pixel = min(base + vec2<u32>(x, y), inputSize - vec2<u32>(1u));
            let value = textureLoad(sourceDepth, vec2<i32>(pixel), 0);
            reduced = select(max(reduced, value), min(reduced, value), frameData.depth.w > 0.5);
        }
    }
    textureStore(destination, vec2<i32>(id.xy), vec4<f32>(reduced));
}`,
        workgroupSize: [8, 8],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'sourceDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'destination',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            }
        ]
    })
);

const HIZ_FLOAT_REDUCE_PASS = computePass(
    new ComputeShader({
        label: 'GPU Scene current Hi-Z reduction',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var sourceDepth: texture_2d<f32>;
@group(0) @binding(2) var destination: texture_storage_2d<r32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    let inputSize = textureDimensions(sourceDepth);
    let base = id.xy * 2u;
    var reduced = select(0.0, 1.0, frameData.depth.w > 0.5);
    for (var y = 0u; y < 2u; y += 1u) {
        for (var x = 0u; x < 2u; x += 1u) {
            let pixel = min(base + vec2<u32>(x, y), inputSize - vec2<u32>(1u));
            let value = textureLoad(sourceDepth, vec2<i32>(pixel), 0).x;
            reduced = select(max(reduced, value), min(reduced, value), frameData.depth.w > 0.5);
        }
    }
    textureStore(destination, vec2<i32>(id.xy), vec4<f32>(reduced));
}`,
        workgroupSize: [8, 8],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'sourceDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            {
                name: 'destination',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            }
        ]
    })
);

const CLUSTER_DEPTH_BOUNDS_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ depth-driven tile bounds',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
@group(0) @binding(2) var<storage, read_write> tileDepthBounds: array<vec2<u32>>;
fn distanceFromDepth(frame: FrameData, rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, frame.depth.w > 0.5);
    return frame.depth.x * frame.depth.y /
        max(frame.depth.y - standard * (frame.depth.y - frame.depth.x), 0.0001);
}
fn depthSlice(frame: FrameData, distance: f32) -> u32 {
    let normalized = log(max(distance, frame.depth.x) / frame.depth.x) / frame.depth.z;
    return min(u32(clamp(normalized, 0.0, 0.999999) * f32(frame.cluster.z)), frame.cluster.z - 1u);
}
var<workgroup> minimumDepthBits: atomic<u32>;
var<workgroup> maximumDepthBits: atomic<u32>;
var<workgroup> coveredPixels: atomic<u32>;
@compute @workgroup_size(8, 8)
fn main(
    @builtin(workgroup_id) tile: vec3<u32>,
    @builtin(local_invocation_id) local: vec3<u32>,
    @builtin(local_invocation_index) localIndex: u32
) {
    if (localIndex == 0u) {
        atomicStore(&minimumDepthBits, bitcast<u32>(frameData.depth.y));
        atomicStore(&maximumDepthBits, bitcast<u32>(frameData.depth.x));
        atomicStore(&coveredPixels, 0u);
    }
    workgroupBarrier();
    let tileIndex = tile.y * frameData.cluster.x + tile.x;
    let size = textureDimensions(sceneDepth);
    let origin = tile.xy * frameData.cluster.w;
    let end = min(origin + vec2<u32>(frameData.cluster.w), size);
    for (var y = origin.y + local.y; y < end.y; y += 8u) {
        for (var x = origin.x + local.x; x < end.x; x += 8u) {
            let rawDepth = textureLoad(sceneDepth, vec2<i32>(i32(x), i32(y)), 0);
            let empty = select(rawDepth >= 0.999999, rawDepth <= 0.000001, frameData.depth.w > 0.5);
            if (!empty) {
                let distance = distanceFromDepth(frameData, rawDepth);
                _ = atomicMin(&minimumDepthBits, bitcast<u32>(distance));
                _ = atomicMax(&maximumDepthBits, bitcast<u32>(distance));
                _ = atomicOr(&coveredPixels, 1u);
            }
        }
    }
    workgroupBarrier();
    if (localIndex == 0u) {
        let covered = atomicLoad(&coveredPixels) != 0u;
        let minimumDistance = bitcast<f32>(atomicLoad(&minimumDepthBits));
        let maximumDistance = bitcast<f32>(atomicLoad(&maximumDepthBits));
        tileDepthBounds[tileIndex] = select(
            vec2<u32>(0u, frameData.cluster.z - 1u),
            vec2<u32>(depthSlice(frameData, minimumDistance), depthSlice(frameData, maximumDistance)),
            covered
        );
    }
}`,
        workgroupSize: [8, 8],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'sceneDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'tileDepthBounds',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

const LIGHT_CLUSTER_COMMON = `
${FRAME_WGSL}
struct LightRecord {
    positionRange: vec4<f32>,
    colorType: vec4<f32>,
    directionOuter: vec4<f32>,
    attenuationInner: vec4<f32>,
};
fn depthSlice(frame: FrameData, distance: f32) -> u32 {
    let normalized = log(max(distance, frame.depth.x) / frame.depth.x) / frame.depth.z;
    return min(u32(clamp(normalized, 0.0, 0.999999) * f32(frame.cluster.z)), frame.cluster.z - 1u);
}
fn lightTileBounds(frame: FrameData, light: LightRecord) -> vec4<u32> {
    let lightType = u32(light.colorType.w + 0.5);
    if (lightType == 2u) {
        return vec4<u32>(0u, 0u, frame.cluster.x - 1u, frame.cluster.y - 1u);
    }
    let depth = max(-light.positionRange.z, frame.depth.x);
    let clip = frame.projection * vec4<f32>(light.positionRange.xyz, 1.0);
    let center = clip.xy / max(clip.w, 0.0001);
    let radiusNdc = vec2<f32>(
        abs(frame.projection[0][0]), abs(frame.projection[1][1])
    ) * light.positionRange.w / depth;
    let minimum = clamp(
        (center - radiusNdc) * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5),
        vec2<f32>(0.0), vec2<f32>(0.999999)
    );
    let maximum = clamp(
        (center + radiusNdc) * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5),
        vec2<f32>(0.0), vec2<f32>(0.999999)
    );
    let low = min(minimum, maximum);
    let high = max(minimum, maximum);
    return vec4<u32>(
        min(u32(low.x * f32(frame.cluster.x)), frame.cluster.x - 1u),
        min(u32(low.y * f32(frame.cluster.y)), frame.cluster.y - 1u),
        min(u32(high.x * f32(frame.cluster.x)), frame.cluster.x - 1u),
        min(u32(high.y * f32(frame.cluster.y)), frame.cluster.y - 1u)
    );
}
fn lightSliceBounds(frame: FrameData, light: LightRecord) -> vec2<u32> {
    let lightType = u32(light.colorType.w + 0.5);
    if (lightType == 2u) { return vec2<u32>(0u, frame.cluster.z - 1u); }
    let depth = -light.positionRange.z;
    return vec2<u32>(
        depthSlice(frame, max(frame.depth.x, depth - light.positionRange.w)),
        depthSlice(frame, min(frame.depth.y, depth + light.positionRange.w))
    );
}
`;

const CLUSTER_LIGHT_COUNT_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ light count',
        source: `
${LIGHT_CLUSTER_COMMON}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> lights: array<LightRecord>;
@group(0) @binding(2) var<storage, read> tileDepthBounds: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read_write> clusterCounts: array<atomic<u32>>;
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.w) { return; }
    let light = lights[id.x];
    let tiles = lightTileBounds(frameData, light);
    let slices = lightSliceBounds(frameData, light);
    let tileCount = frameData.cluster.x * frameData.cluster.y;
    for (var y = tiles.y; y <= tiles.w; y += 1u) {
        for (var x = tiles.x; x <= tiles.z; x += 1u) {
            let tile = y * frameData.cluster.x + x;
            let depthBounds = tileDepthBounds[tile];
            let firstSlice = max(slices.x, depthBounds.x);
            let lastSlice = min(slices.y, depthBounds.y);
            if (firstSlice <= lastSlice) {
                for (var z = firstSlice; z <= lastSlice; z += 1u) {
                    _ = atomicAdd(&clusterCounts[z * tileCount + tile], 1u);
                }
            }
        }
    }
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'lights', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            { name: 'tileDepthBounds', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterCounts',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);

const CLUSTER_BLOCK_SCAN_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ block-local prefix scan',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clusterCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterGrid: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read_write> blockSums: array<u32>;
var<workgroup> prefixValues: array<u32, ${String(PREFIX_WORKGROUP_SIZE)}>;
@compute @workgroup_size(${String(PREFIX_WORKGROUP_SIZE)})
fn main(
    @builtin(local_invocation_index) localIndex: u32,
    @builtin(workgroup_id) workgroup: vec3<u32>,
    @builtin(global_invocation_id) global: vec3<u32>
) {
    let clusterCount = frameData.cluster.x * frameData.cluster.y * frameData.cluster.z;
    var bounded = 0u;
    if (global.x < clusterCount) {
        bounded = min(clusterCounts[global.x], frameData.budgets.y);
    }
    prefixValues[localIndex] = bounded;
    workgroupBarrier();
    var step = 1u;
    while (step < ${String(PREFIX_WORKGROUP_SIZE)}u) {
        var addend = 0u;
        if (localIndex >= step) {
            addend = prefixValues[localIndex - step];
        }
        workgroupBarrier();
        prefixValues[localIndex] += addend;
        workgroupBarrier();
        step *= 2u;
    }
    if (global.x < clusterCount) {
        clusterGrid[global.x] = vec2<u32>(prefixValues[localIndex] - bounded, bounded);
    }
    if (localIndex == ${String(PREFIX_WORKGROUP_SIZE - 1)}u) {
        blockSums[workgroup.x] = prefixValues[localIndex];
    }
}`,
        workgroupSize: [PREFIX_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clusterCounts', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterGrid',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'blockSums',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

const CLUSTER_BLOCK_PREFIX_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ block prefix',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> blockSums: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockOffsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> clusterStats: array<atomic<u32>>;
@compute @workgroup_size(1)
fn main() {
    let clusterCount = frameData.cluster.x * frameData.cluster.y * frameData.cluster.z;
    let blockCount = (clusterCount + ${String(PREFIX_WORKGROUP_SIZE - 1)}u) /
        ${String(PREFIX_WORKGROUP_SIZE)}u;
    var offset = 0u;
    for (var block = 0u; block < blockCount; block += 1u) {
        blockOffsets[block] = offset;
        offset += blockSums[block];
    }
    atomicStore(&clusterStats[0], frameData.counts.w);
    atomicStore(&clusterStats[1], 0u);
    atomicStore(&clusterStats[2], 0u);
    atomicStore(&clusterStats[3], clusterCount);
}`,
        workgroupSize: [1],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'blockSums', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'blockOffsets',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'clusterStats',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

const CLUSTER_PREFIX_FINALIZE_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ bounded prefix finalize',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clusterCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterGrid: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read> blockOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> clusterCursors: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> clusterStats: array<atomic<u32>>;
@compute @workgroup_size(${String(PREFIX_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let clusterCount = frameData.cluster.x * frameData.cluster.y * frameData.cluster.z;
    if (id.x >= clusterCount) { return; }
    let localAllocation = clusterGrid[id.x];
    let rawOffset = blockOffsets[id.x / ${String(PREFIX_WORKGROUP_SIZE)}u] +
        localAllocation.x;
    let offset = min(rawOffset, frameData.counts.z);
    let available = min(localAllocation.y, frameData.counts.z - offset);
    clusterGrid[id.x] = vec2<u32>(offset, available);
    atomicStore(&clusterCursors[id.x], 0u);
    _ = atomicAdd(&clusterStats[1], available);
    _ = atomicAdd(&clusterStats[2], clusterCounts[id.x] - available);
}`,
        workgroupSize: [PREFIX_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clusterCounts', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterGrid',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            { name: 'blockOffsets', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterCursors',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'clusterStats',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);

const CLUSTER_LIGHT_WRITE_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ light index write',
        source: `
${LIGHT_CLUSTER_COMMON}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> lights: array<LightRecord>;
@group(0) @binding(2) var<storage, read> tileDepthBounds: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read> clusterGrid: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read_write> clusterCursors: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> clusterLightIndices: array<u32>;
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.w) { return; }
    let light = lights[id.x];
    let tiles = lightTileBounds(frameData, light);
    let slices = lightSliceBounds(frameData, light);
    let tileCount = frameData.cluster.x * frameData.cluster.y;
    for (var y = tiles.y; y <= tiles.w; y += 1u) {
        for (var x = tiles.x; x <= tiles.z; x += 1u) {
            let tile = y * frameData.cluster.x + x;
            let depthBounds = tileDepthBounds[tile];
            let firstSlice = max(slices.x, depthBounds.x);
            let lastSlice = min(slices.y, depthBounds.y);
            if (firstSlice <= lastSlice) {
                for (var z = firstSlice; z <= lastSlice; z += 1u) {
                    let cluster = z * tileCount + tile;
                    let cursor = atomicAdd(&clusterCursors[cluster], 1u);
                    let allocation = clusterGrid[cluster];
                    if (cursor < allocation.y) {
                        clusterLightIndices[allocation.x + cursor] = id.x;
                    }
                }
            }
        }
    }
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'lights', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            { name: 'tileDepthBounds', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
            { name: 'clusterGrid', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterCursors',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'clusterLightIndices',
                group: 0,
                binding: 5,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

const GPU_SCENE_DEPTH_SHADER = new StorageGraphicsShader({
    label: 'GPU Scene indirect depth prepass',
    vertexSource: `#version 310 es
precision highp float;
precision highp int;
invariant gl_Position;
layout(std430) readonly buffer FrameDataBlock { vec4 values[]; } frameData;
layout(std430) readonly buffer ObjectBlock { vec4 values[]; } objects;
layout(std430) readonly buffer VisibleBlock { uint values[]; } visibleIndices;
layout(location=0) in vec3 a_position;
mat4 readMatrix(uint base) {
    return mat4(objects.values[base], objects.values[base + 1u], objects.values[base + 2u], objects.values[base + 3u]);
}
mat4 frameMatrix(uint base) {
    return mat4(frameData.values[base], frameData.values[base + 1u], frameData.values[base + 2u], frameData.values[base + 3u]);
}
void main() {
    uint objectIndex = visibleIndices.values[uint(gl_InstanceIndex)];
    mat4 model = readMatrix(objectIndex * 13u);
    gl_Position = frameMatrix(0u) * model * vec4(a_position, 1.0);
}`,
    fragmentSource: `#version 310 es
precision highp float;
void main() {}`,
    bindings: [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 2, kind: 'read-only-storage-buffer' }
    ]
});

const GPU_SCENE_PBR_SHADER_CACHE = new Map<string, StorageGraphicsShader>();

function variantTexture(
    variant: Readonly<PBRMaterialVariant>,
    role: PBRTextureRole
): PBRTextureBinding | null {
    return variant.textures.find(binding => binding.role === role) ?? null;
}

function variantSampleUV(binding: Readonly<PBRTextureBinding>): string {
    return binding.uv === 0 ? 'v_uv0' : 'v_uv1';
}

function gpuScenePBRShader(variant: Readonly<PBRMaterialVariant>): StorageGraphicsShader {
    const cached = GPU_SCENE_PBR_SHADER_CACHE.get(variant.key);
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
        variant.usesUV0
            ? 'v_uv0 = (readMaterialMatrix(materialBase + 3u) * vec3(a_uv0, 1.0)).xy;'
            : '',
        variant.usesUV1
            ? 'v_uv1 = (readMaterialMatrix(materialBase + 6u) * vec3(a_uv1, 1.0)).xy;'
            : '',
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
    const decode = (sample: string): string =>
        variant.gammaCorrection ? `sRGBToLinear(${sample})` : sample;
    const bindings: ShaderReadBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'visibleIndices', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        { name: 'materials', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
        { name: 'lights', group: 0, binding: 4, kind: 'read-only-storage-buffer' },
        { name: 'clusterGrid', group: 0, binding: 5, kind: 'read-only-storage-buffer' },
        { name: 'clusterIndices', group: 0, binding: 6, kind: 'read-only-storage-buffer' }
    ];
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
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
${vertexUVDeclarations}
out vec3 v_viewPosition;
out vec3 v_viewNormal;
flat out uint v_materialIndex;
mat4 readObjectMatrix(uint base) {
    return mat4(objects.values[base], objects.values[base + 1u], objects.values[base + 2u], objects.values[base + 3u]);
}
mat3 readObjectNormalMatrix(uint base) {
    return mat3(objects.values[base + 8u].xyz, objects.values[base + 9u].xyz, objects.values[base + 10u].xyz);
}
mat4 readFrameMatrix(uint base) {
    return mat4(frameData.values[base], frameData.values[base + 1u], frameData.values[base + 2u], frameData.values[base + 3u]);
}
mat3 readMaterialMatrix(uint base) {
    return mat3(materials.values[base].xyz, materials.values[base + 1u].xyz, materials.values[base + 2u].xyz);
}
void main() {
    uint objectIndex = visibleIndices.values[uint(gl_InstanceIndex)];
    uint objectBase = objectIndex * 13u;
    mat4 model = readObjectMatrix(objectBase);
    mat4 view = readFrameMatrix(8u);
    mat3 viewNormalMatrix = mat3(view) * readObjectNormalMatrix(objectBase);
    vec4 worldPosition = model * vec4(a_position, 1.0);
    vec3 viewNormal = normalize(viewNormalMatrix * a_normal);
    v_viewPosition = (view * worldPosition).xyz;
    v_viewNormal = viewNormal;
    v_materialIndex = floatBitsToUint(objects.values[objectBase + 12u].x);
    uint materialBase = v_materialIndex * 9u;
    ${vertexUVWrites}
    gl_Position = readFrameMatrix(0u) * worldPosition;
}`,
        fragmentSource: `#version 310 es
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
${textureDeclarations}
in vec3 v_viewPosition;
in vec3 v_viewNormal;
${fragmentUVDeclarations}
flat in uint v_materialIndex;
layout(location=0) out vec4 color;
${encodingSource}
${pbrSurfaceSource}
${pbrBrdfSource}
void main() {
    uint materialBase = v_materialIndex * 9u;
    vec4 baseMetallic = materials.values[materialBase];
    vec4 emissionRoughness = materials.values[materialBase + 1u];
    vec4 materialParameters = materials.values[materialBase + 2u];
    vec4 baseColorSample = vec4(1.0);
    ${
        baseColorMap === null
            ? ''
            : `baseColorSample = ${decode(
                  `texture(${baseColorMap.shaderName}, ${variantSampleUV(baseColorMap)})`
              )};`
    }
    vec3 emissionSample = vec3(1.0);
    ${
        emissionMap === null
            ? ''
            : `emissionSample = ${decode(
                  `texture(${emissionMap.shaderName}, ${variantSampleUV(emissionMap)})`
              )}.rgb;`
    }
    float metallic = baseMetallic.a;
    ${
        metallicMap === null
            ? ''
            : `metallic *= texture(${metallicMap.shaderName}, ${variantSampleUV(metallicMap)}).r;`
    }
    float roughness = emissionRoughness.a;
    ${
        roughnessMap === null
            ? ''
            : `roughness *= texture(${roughnessMap.shaderName}, ${variantSampleUV(roughnessMap)}).r;`
    }
    float occlusion = 1.0;
    ${
        occlusionMap === null
            ? ''
            : `occlusion = texture(${occlusionMap.shaderName}, ${variantSampleUV(occlusionMap)}).r;`
    }
    ${
        metallicRoughnessMap === null
            ? ''
            : `vec4 metallicRoughnessSample = texture(${metallicRoughnessMap.shaderName}, ${variantSampleUV(metallicRoughnessMap)});
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
            : `vec3 tangentNormal = texture(${normalMap.shaderName}, ${variantSampleUV(normalMap)}).rgb * 2.0 - 1.0;
    tangentNormal.xy *= materialParameters.z;
    normal = normalize(v_TBN * tangentNormal);`
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
    vec3 lighting = frameData.values[30u].rgb * surface.iblDiffuseColor *
        surface.occlusion * HILO_INVERSE_PI;
    for (uint localIndex = 0u; localIndex < allocation.y; localIndex += 1u) {
        uint lightIndex = clusterIndices.values[allocation.x + localIndex];
        uint lightBase = lightIndex * 4u;
        vec4 positionRange = lights.values[lightBase];
        vec4 colorType = lights.values[lightBase + 1u];
        vec4 directionOuter = lights.values[lightBase + 2u];
        vec4 attenuationInner = lights.values[lightBase + 3u];
        uint lightType = uint(colorType.w + 0.5);
        vec3 lightDirection;
        vec3 radiance = colorType.rgb;
        if (lightType == 2u) {
            lightDirection = normalize(-directionOuter.xyz);
        } else {
            vec3 delta = positionRange.xyz - v_viewPosition;
            float distanceToLight = max(length(delta), 0.0001);
            lightDirection = delta / distanceToLight;
            float attenuation = 1.0 / max(
                attenuationInner.x + attenuationInner.y * distanceToLight +
                    attenuationInner.z * distanceToLight * distanceToLight,
                0.0001
            );
            float rangeFade = clamp(1.0 - pow(distanceToLight / max(positionRange.w, 0.0001), 4.0), 0.0, 1.0);
            radiance *= attenuation * rangeFade * rangeFade;
            if (lightType == 1u) {
                float theta = dot(lightDirection, normalize(-directionOuter.xyz));
                radiance *= smoothstep(directionOuter.w, attenuationInner.w, theta);
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
        lighting += radiance * (lightDiffuse + lightSpecular);
    }
    color = vec4(lighting + surface.emissionColor, 1.0);
}`,
        bindings
    });
    GPU_SCENE_PBR_SHADER_CACHE.set(variant.key, shader);
    return shader;
}

const BLOOM_PREFILTER_PASS = new FullscreenRenderPass({
    name: 'Clustered Forward+ bloom prefilter',
    shader: new Shader({
        vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
        fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
layout(location=0) out vec4 color;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_scene, 0));
    vec3 value = vec3(0.0);
    value += texture(u_scene, v_uv + texel * vec2(-1.5, -1.5)).rgb;
    value += texture(u_scene, v_uv + texel * vec2( 1.5, -1.5)).rgb;
    value += texture(u_scene, v_uv + texel * vec2(-1.5,  1.5)).rgb;
    value += texture(u_scene, v_uv + texel * vec2( 1.5,  1.5)).rgb;
    value *= 0.25;
    float brightness = max(max(value.r, value.g), value.b);
    value *= max(brightness - 0.85, 0.0) / max(brightness, 0.0001);
    color = vec4(value, 1.0);
}`
    }),
    pipelineState: {
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none'
    }
});

const BLOOM_BLUR_PASS = new FullscreenRenderPass({
    name: 'Clustered Forward+ bloom blur',
    shader: new Shader({
        vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
        fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location=0) out vec4 color;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
    vec3 value = texture(u_source, v_uv).rgb * 0.227027;
    value += texture(u_source, v_uv + vec2(texel.x * 1.384615, 0.0)).rgb * 0.316216;
    value += texture(u_source, v_uv - vec2(texel.x * 1.384615, 0.0)).rgb * 0.316216;
    value += texture(u_source, v_uv + vec2(0.0, texel.y * 3.230769)).rgb * 0.070270;
    value += texture(u_source, v_uv - vec2(0.0, texel.y * 3.230769)).rgb * 0.070270;
    color = vec4(value, 1.0);
}`
    }),
    pipelineState: {
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none'
    }
});

function displayPass(exposure: number, bloomStrength: number): FullscreenRenderPass {
    return new FullscreenRenderPass({
        name: 'Clustered Forward+ ACES display transform',
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
layout(location=0) out vec4 color;
vec3 aces(vec3 value) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((value * (a * value + b)) / (value * (c * value + d) + e), 0.0, 1.0);
}
void main() {
    vec3 hdr = texture(u_scene, v_uv).rgb * ${String(exposure)} +
        texture(u_bloom, v_uv).rgb * ${String(bloomStrength)};
    float vignette = smoothstep(0.9, 0.22, length(v_uv - vec2(0.5)));
    vec3 mapped = aces(hdr) * mix(0.78, 1.0, vignette);
    color = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}

interface ClearRange {
    buffer: RenderGraphBufferHandle;
    byteOffset: number;
    byteLength: number;
}

class ClearBuffersParameters {
    readonly ranges: ClearRange[] = [];
    count = 0;

    reset(): void {
        this.count = 0;
    }

    add(buffer: RenderGraphBufferHandle, byteOffset: number, byteLength: number): void {
        let range = this.ranges[this.count];
        if (range === undefined) {
            range = { buffer, byteOffset, byteLength };
            this.ranges.push(range);
        }
        range.buffer = buffer;
        range.byteOffset = byteOffset;
        range.byteLength = byteLength;
        this.count++;
    }
}

class ClearBuffersPass implements ScriptableRenderPass<ClearBuffersParameters> {
    readonly name = 'GPU Scene and cluster counter clear';

    setup(builder: ScriptableRenderPassBuilder, parameters: ClearBuffersParameters): void {
        for (let index = 0; index < parameters.count; index += 1) {
            const range = parameters.ranges[index];
            if (range !== undefined) {
                builder.clearBuffer(range.buffer, range.byteOffset, range.byteLength);
            }
        }
    }

    execute(context: ScriptableRenderPassContext, parameters: ClearBuffersParameters): void {
        for (let index = 0; index < parameters.count; index += 1) {
            const range = parameters.ranges[index];
            if (range !== undefined) {
                context.commands.clearBuffer(range.buffer, range.byteOffset, range.byteLength);
            }
        }
    }
}

interface MutableBufferBinding {
    buffer: RenderGraphBufferHandle;
    byteOffset?: number;
    byteLength?: number;
}

interface MutableTextureBinding {
    texture: RenderGraphTextureAccessHandle;
}

class MutableComputeParameters implements ComputeRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[];
    dispatch: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };

    constructor(bufferCount: number, textureCount: number) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.textures = Array.from({ length: textureCount }, () => ({ texture: INVALID_TEXTURE }));
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('Compute buffer slot is unavailable');
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined) throw new RangeError('Compute texture slot is unavailable');
        binding.texture = texture;
    }

    setDispatch(x: number, y = 1, z = 1): void {
        this.dispatch.x = x;
        this.dispatch.y = y;
        this.dispatch.z = z;
    }
}

class MutableGPUDrivenParameters implements GPUDrivenRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly vertexBuffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[] = [];
    readonly samplers: ComputeSampler[] = [];
    indexBuffer: MutableBufferBinding = { buffer: INVALID_BUFFER };
    draw: {
        kind: 'draw-indexed-indirect';
        buffer: RenderGraphBufferHandle;
        byteOffset: number;
    } = { kind: 'draw-indexed-indirect', buffer: INVALID_BUFFER, byteOffset: 0 };
    readonly colorAttachments: RenderPipelineColorAttachment[] = [];
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;

    constructor(bufferCount: number, vertexBufferCount: number) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.vertexBuffers = Array.from({ length: vertexBufferCount }, () => ({
            buffer: INVALID_BUFFER
        }));
    }

    configure(vertexBufferCount: number, textureCount: number): void {
        while (this.vertexBuffers.length < vertexBufferCount) {
            this.vertexBuffers.push({ buffer: INVALID_BUFFER });
        }
        this.vertexBuffers.length = vertexBufferCount;
        while (this.textures.length < textureCount) {
            this.textures.push({ texture: INVALID_TEXTURE });
        }
        this.textures.length = textureCount;
        this.samplers.length = textureCount;
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('GPU-driven buffer slot is unavailable');
        binding.buffer = buffer;
    }

    setBufferRange(
        index: number,
        buffer: RenderGraphBufferHandle,
        byteOffset: number,
        byteLength: number
    ): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('GPU-driven buffer slot is unavailable');
        binding.buffer = buffer;
        binding.byteOffset = byteOffset;
        binding.byteLength = byteLength;
    }

    setVertexBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.vertexBuffers[index];
        if (binding === undefined) {
            throw new RangeError('GPU-driven vertex-buffer slot is unavailable');
        }
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined) throw new RangeError('GPU-driven texture slot is unavailable');
        binding.texture = texture;
    }
}

class MutableFullscreenParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'clear', storeOp: 'store' }
    ];
}

interface MutableFallbackColorAttachment {
    texture: RenderGraphTextureHandle;
    loadOp: 'load';
    storeOp: 'store';
}

class MutableFallbackSceneParameters implements SceneRenderPassParameters {
    rendererList = INVALID_RENDERER_LIST;
    readonly colorAttachments: MutableFallbackColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'load', storeOp: 'store' }
    ];
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;
    opaqueTexture?: RenderGraphTextureHandle;

    reset(): void {
        this.rendererList = INVALID_RENDERER_LIST;
        delete this.depthStencilAttachment;
        delete this.opaqueTexture;
    }
}

class MutableFallbackTextureCopyParameters implements TextureCopyPassParameters {
    source = INVALID_TEXTURE;
    destination = INVALID_TEXTURE;

    reset(): void {
        this.source = INVALID_TEXTURE;
        this.destination = INVALID_TEXTURE;
    }
}

interface MutableFallbackRendererListDescriptor extends RendererListDescriptor {
    cullingResults: CullingResultsHandle;
    excludeMeshes: readonly Mesh[];
}

function gpuSceneVertexLayouts(
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
const GPU_SCENE_DEPTH_VERTEX_LAYOUTS: readonly GPUDrivenVertexBufferLayout[] = Object.freeze([
    Object.freeze({
        arrayStride: 12,
        attributes: Object.freeze([
            Object.freeze({ shaderLocation: 0, format: 'float32x3' as const, byteOffset: 0 })
        ])
    })
]);

function alignedByteLength(value: number): number {
    return Math.ceil(value / 4) * 4;
}

function copyAlignedData(source: ArrayBufferView): Uint8Array {
    const result = new Uint8Array(alignedByteLength(source.byteLength));
    result.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    return result;
}

function validateGeometryData(geometry: Geometry): Readonly<{
    position: GeometryData;
    normal: GeometryData;
    uv0: GeometryData | null;
    uv1: GeometryData | null;
    tangent0: GeometryData | null;
    tangent1: GeometryData | null;
    index: GeometryData;
    indexFormat: 'uint16' | 'uint32';
}> {
    if (geometry.mode !== TRIANGLES) {
        throw new TypeError('GPU Scene geometries must use indexed triangle-list topology');
    }
    const position = geometry.vertices;
    const normal = geometry.normals;
    const uv0 = geometry.uvs;
    const uv1 = geometry.uvs1;
    const tangent0 = uv0 === null ? null : geometry.tangents;
    const tangent1 = uv1 === null ? null : geometry.tangents1;
    const index = geometry.indices;
    if (position === null || normal === null || index === null) {
        throw new TypeError('GPU Scene geometries require position, normal, and index data');
    }
    const validateVector = (value: GeometryData, name: string): void => {
        if (
            !(value.data instanceof Float32Array) ||
            value.size !== 3 ||
            value.stride !== 0 ||
            value.offset !== 0 ||
            value.normalized
        ) {
            throw new TypeError(
                `GPU Scene ${name} data must be contiguous, non-normalized float32x3`
            );
        }
    };
    validateVector(position, 'position');
    validateVector(normal, 'normal');
    if (position.count !== normal.count) {
        throw new RangeError('GPU Scene position and normal vertex counts must match');
    }
    const validateOptionalVector = (
        value: GeometryData | null,
        name: string,
        size: 2 | 4
    ): void => {
        if (value === null) return;
        if (
            !(value.data instanceof Float32Array) ||
            value.size !== size ||
            value.stride !== 0 ||
            value.offset !== 0 ||
            value.normalized
        ) {
            throw new TypeError(
                `GPU Scene ${name} data must be contiguous, non-normalized float32x${String(size)}`
            );
        }
        if (value.count !== position.count) {
            throw new RangeError(`GPU Scene position and ${name} vertex counts must match`);
        }
    };
    validateOptionalVector(uv0, 'UV0', 2);
    validateOptionalVector(uv1, 'UV1', 2);
    validateOptionalVector(tangent0, 'tangent0', 4);
    validateOptionalVector(tangent1, 'tangent1', 4);
    if (index.size !== 1 || index.stride !== 0 || index.offset !== 0 || index.normalized) {
        throw new TypeError('GPU Scene index data must be contiguous and non-normalized');
    }
    const indexFormat =
        index.data instanceof Uint16Array
            ? 'uint16'
            : index.data instanceof Uint32Array
              ? 'uint32'
              : null;
    if (indexFormat === null) {
        throw new TypeError('GPU Scene index data must use Uint16Array or Uint32Array');
    }
    if (index.count < 3 || index.count % 3 !== 0) {
        throw new RangeError('GPU Scene index data must contain complete triangles');
    }
    return Object.freeze({ position, normal, uv0, uv1, tangent0, tangent1, index, indexFormat });
}

function geometryVariantIssue(
    data: ReturnType<typeof validateGeometryData>,
    variant: Readonly<PBRMaterialVariant>
): string | null {
    if (variant.usesUV0 && data.uv0 === null) return 'requires UV0 data for its material maps';
    if (variant.usesUV1 && data.uv1 === null) return 'requires UV1 data for its material maps';
    if (variant.normalUV === 0 && data.tangent0 === null) {
        return 'requires tangent0 data for its normal map';
    }
    if (variant.normalUV === 1 && data.tangent1 === null) {
        return 'requires tangent1 data for its normal map';
    }
    return null;
}

function geometryStreamMatches(
    current: GeometryData | null,
    source: GeometryData | null,
    buffer: StorageBuffer | null
): boolean {
    if (current === null || source === null || buffer === null) {
        return current === null && source === null && buffer === null;
    }
    return current === source && alignedByteLength(current.data.byteLength) === buffer.byteLength;
}

function matrixElements(source: Matrix4, target: Float32Array, offset: number): void {
    const elements = source.elements;
    for (let index = 0; index < 16; index += 1) {
        target[offset + index] = elements[index] ?? 0;
    }
}

function arraysDiffer(first: Float32Array, second: Float32Array): boolean {
    for (let index = 0; index < first.length; index += 1) {
        if (first[index] !== second[index]) return true;
    }
    return false;
}

function colorComponents(value: Readonly<{ r: number; g: number; b: number }>): readonly number[] {
    return [value.r, value.g, value.b];
}

function materialEmission(material: PBRMaterial): readonly number[] {
    const emission = material.emissionFactor;
    return colorComponents(emission);
}

function packMaterialUVMatrix(matrix: Matrix3 | null, target: Float32Array, offset: number): void {
    const elements = matrix?.elements;
    for (let column = 0; column < 3; column += 1) {
        for (let row = 0; row < 3; row += 1) {
            const index = column * 3 + row;
            target[offset + column * 4 + row] = elements?.[index] ?? (column === row ? 1 : 0);
        }
        target[offset + column * 4 + 3] = 0;
    }
}

/**
 * Renderer-local G0/L0 runtime. It consumes registered opaque PBR bucket identities, keeps their
 * ordinary Mesh transforms in a dirty GPU database, and emits one fixed indirect draw per LOD
 * bucket. No visible count, cluster list, or indirect argument is read during production frames.
 */
class ClusteredForwardPlusPipeline implements RenderPipeline {
    readonly name = 'GPU Scene + Clustered Forward+';
    readonly #options: Readonly<NormalizedOptions>;
    readonly #frameData: StorageBuffer;
    readonly #objects: StorageBuffer;
    readonly #bucketData: StorageBuffer;
    readonly #materials: StorageBuffer;
    readonly #lights: StorageBuffer;
    readonly #visibleIndices: StorageBuffer;
    readonly #indirectArguments: StorageBuffer;
    readonly #cullStats: StorageBuffer;
    readonly #tileDepthBounds: StorageBuffer;
    readonly #clusterCounts: StorageBuffer;
    readonly #clusterGrid: StorageBuffer;
    readonly #clusterCursors: StorageBuffer;
    readonly #clusterBlockSums: StorageBuffer;
    readonly #clusterBlockOffsets: StorageBuffer;
    readonly #clusterLightIndices: StorageBuffer;
    readonly #clusterStats: StorageBuffer;
    readonly #visibleBucketCapacity: number;
    readonly #physicalBuckets: readonly PhysicalBucket[];
    readonly #logicalBucketByGeometry = new Map<Geometry, Map<PBRMaterial, number>>();
    readonly #logicalGPUCompatible: Uint8Array;
    readonly #gpuManagedMeshes: Mesh[] = [];
    readonly #objectByMesh = new Map<Mesh, GPUSceneObjectRecord>();
    readonly #freeObjectSlots: number[] = [];
    readonly #objectData: ArrayBuffer;
    readonly #objectFloats: Float32Array;
    readonly #objectUInts: Uint32Array;
    readonly #frameBytes = new ArrayBuffer(FRAME_RECORD_BYTES);
    readonly #frameFloats = new Float32Array(this.#frameBytes);
    readonly #frameUInts = new Uint32Array(this.#frameBytes);
    readonly #lightFloats: Float32Array;
    readonly #materialFloats: Float32Array;
    readonly #materialScratch: Float32Array;
    readonly #samplerByTexture = new WeakMap<
        Texture<unknown>,
        Readonly<{ key: string; sampler: ComputeSampler }>
    >();
    readonly #stagedCameraMatrix = new Float32Array(16);
    readonly #committedCameraMatrix = new Float32Array(16);
    readonly #stagedViewMatrix = new Float32Array(16);
    readonly #committedViewMatrix = new Float32Array(16);
    readonly #stagedProjectionMatrix = new Float32Array(16);
    readonly #committedProjectionMatrix = new Float32Array(16);
    readonly #stagedDepth = new Float32Array(4);
    readonly #committedDepth = new Float32Array(4);
    readonly #hizKeys = Array.from({ length: HIZ_LEVEL_COUNT }, () => Object.freeze({}));
    readonly #hizDescriptors: readonly Readonly<RenderPipelineHistoryTextureDescriptor>[];
    readonly #clearPass = new ClearBuffersPass();
    readonly #clearPool = new RenderPassParameterPool(
        () => new ClearBuffersParameters(),
        value => {
            value.reset();
        }
    );
    readonly #cullPool = new RenderPassParameterPool(() => new MutableComputeParameters(6, 0));
    readonly #hizCullPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(6, HIZ_LEVEL_COUNT)
    );
    readonly #hizPool = new RenderPassParameterPool(() => new MutableComputeParameters(1, 2));
    readonly #clusterDepthPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 1)
    );
    readonly #clusterCountPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(4, 0)
    );
    readonly #clusterBlockScanPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(4, 0)
    );
    readonly #clusterBlockPrefixPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(4, 0)
    );
    readonly #clusterPrefixFinalizePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(6, 0)
    );
    readonly #clusterWritePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(6, 0)
    );
    readonly #depthDrawPool = new RenderPassParameterPool(
        () => new MutableGPUDrivenParameters(3, 1)
    );
    readonly #colorDrawPool = new RenderPassParameterPool(
        () => new MutableGPUDrivenParameters(7, 2)
    );
    readonly #fullscreenPool = new RenderPassParameterPool(() => new MutableFullscreenParameters());
    readonly #fallbackPool = new RenderPassParameterPool(
        () => new MutableFallbackSceneParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #fallbackCopyPool = new RenderPassParameterPool(
        () => new MutableFallbackTextureCopyParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #displayPass: FullscreenRenderPass;
    readonly #fallbackPass = new SceneRenderPass('Clustered Forward+ compatibility fallback');
    readonly #fallbackCopyPass = new TextureCopyPass(
        'Clustered Forward+ compatibility opaque copy'
    );
    readonly #fallbackPresentPass = new PresentRenderPass(
        'Clustered Forward+ compatibility output'
    );
    readonly #fallbackOpaqueListDescriptor: MutableFallbackRendererListDescriptor = {
        cullingResults: INVALID_CULLING_RESULTS,
        queue: 'opaque',
        sorting: 'material-front-to-back',
        excludeMeshes: this.#gpuManagedMeshes
    };
    readonly #fallbackTransparentListDescriptor: MutableFallbackRendererListDescriptor = {
        cullingResults: INVALID_CULLING_RESULTS,
        queue: 'transparent',
        sorting: 'back-to-front',
        excludeMeshes: this.#gpuManagedMeshes
    };
    readonly #normalMatrix = new Matrix3();
    readonly #tempMatrix = new Matrix4();
    readonly #tempVector = new Vector3();
    readonly #onDestroy: (runtime: ClusteredForwardPlusPipeline) => void;
    #frameSerial = 0;
    #activeObjectHighWater = 0;
    #objectCount = 0;
    #fallbackObjectCount = 0;
    #fallbackHasOpaque = false;
    #fallbackHasTransparent = false;
    #lightCount = 0;
    #droppedLightCount = 0;
    #lastRecordedFrame = -1;
    #pendingCamera: Camera | null = null;
    #committedCamera: Camera | null = null;
    #pendingCameraRevision = -1;
    #committedCameraRevision = -1;
    #hiZValid = false;
    #destroyed = false;

    constructor(
        options: Readonly<NormalizedOptions>,
        context: RenderPipelineCreateContext,
        onDestroy: (runtime: ClusteredForwardPlusPipeline) => void
    ) {
        this.#options = options;
        this.#onDestroy = onDestroy;
        const physicalCount = options.buckets.reduce(
            (count, bucket) => count + 1 + bucket.lods.length,
            0
        );
        this.#visibleBucketCapacity = visibleBucketCapacity(options.maxObjects);
        this.#logicalGPUCompatible = new Uint8Array(options.buckets.length);
        const capacity = clusterCapacityPlan(options);
        const create = (
            descriptor: Parameters<RenderPipelineCreateContext['createStorageBuffer']>[0]
        ): StorageBuffer => context.createStorageBuffer(descriptor);
        this.#frameData = create({
            label: 'Clustered Forward+ frame database',
            byteLength: FRAME_RECORD_BYTES,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        this.#objectData = new ArrayBuffer(options.maxObjects * OBJECT_RECORD_BYTES);
        this.#objectFloats = new Float32Array(this.#objectData);
        this.#objectUInts = new Uint32Array(this.#objectData);
        this.#objects = create({
            label: 'GPU Scene object database',
            byteLength: this.#objectData.byteLength,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        const bucketBytes = this.createBucketData(physicalCount);
        this.#bucketData = create({
            label: 'GPU Scene LOD bucket database',
            byteLength: bucketBytes.byteLength,
            usage: ['storage'],
            initialData: bucketBytes,
            recovery: 'cpu-shadow'
        });
        this.#materialFloats = new Float32Array(
            (options.buckets.length * MATERIAL_RECORD_BYTES) / 4
        );
        this.#materialScratch = new Float32Array(this.#materialFloats.length);
        this.packMaterials(this.#materialFloats);
        this.#materials = create({
            label: 'GPU Scene PBR material database',
            byteLength: this.#materialFloats.byteLength,
            usage: ['storage', 'copy-destination'],
            initialData: this.#materialFloats,
            recovery: 'cpu-shadow'
        });
        this.#lightFloats = new Float32Array(options.maxLights * 16);
        this.#lights = create({
            label: 'Clustered Forward+ light database',
            byteLength: this.#lightFloats.byteLength,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        this.#visibleIndices = create({
            label: 'GPU Scene visible compact table',
            byteLength: this.#visibleBucketCapacity * physicalCount * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        const indirectData = new Uint32Array(physicalCount * 5);
        this.#physicalBuckets = Object.freeze(this.createPhysicalBuckets(context, indirectData));
        this.#logicalGPUCompatible.fill(1);
        this.#indirectArguments = create({
            label: 'GPU Scene fixed bucket indirect arguments',
            byteLength: indirectData.byteLength,
            usage: ['storage', 'indirect', 'copy-destination'],
            initialData: indirectData,
            recovery: 'cpu-shadow'
        });
        this.#cullStats = create({
            label: 'GPU Scene culling counters',
            byteLength: STATS_BYTES,
            usage: ['storage', 'copy-source', 'copy-destination'],
            recovery: 'reinitialize'
        });
        this.#tileDepthBounds = create({
            label: 'Clustered Forward+ tile depth bounds',
            byteLength: capacity.maxTiles * 8,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#clusterCounts = create({
            label: 'Clustered Forward+ cluster counts',
            byteLength: capacity.maxClusters * 4,
            usage: ['storage', 'copy-destination'],
            recovery: 'reinitialize'
        });
        this.#clusterGrid = create({
            label: 'Clustered Forward+ cluster offset/count grid',
            byteLength: capacity.maxClusters * 8,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#clusterCursors = create({
            label: 'Clustered Forward+ cluster write cursors',
            byteLength: capacity.maxClusters * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#clusterBlockSums = create({
            label: 'Clustered Forward+ cluster block sums',
            byteLength: capacity.maxClusterBlocks * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#clusterBlockOffsets = create({
            label: 'Clustered Forward+ cluster block offsets',
            byteLength: capacity.maxClusterBlocks * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#clusterLightIndices = create({
            label: 'Clustered Forward+ light index list',
            byteLength: options.maxLightIndices * 4,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#clusterStats = create({
            label: 'Clustered Forward+ allocation counters',
            byteLength: STATS_BYTES,
            usage: ['storage', 'copy-source'],
            recovery: 'reinitialize'
        });
        this.#hizDescriptors = Object.freeze(
            Array.from({ length: HIZ_LEVEL_COUNT }, (_unused, index) =>
                Object.freeze({
                    label: `GPU Scene Hi-Z level ${String(index)}`,
                    format: 'r32float' as const,
                    extent: Object.freeze({
                        relativeTo: 'output' as const,
                        scale: 1 / 2 ** (index + 1),
                        minWidth: 1,
                        minHeight: 1
                    }),
                    usage: Object.freeze(['sampled' as const, 'storage' as const]),
                    bufferCount: 2 as const
                })
            )
        );
        this.#displayPass = displayPass(options.exposure, options.bloomStrength);
        for (let slot = options.maxObjects - 1; slot >= 0; slot -= 1) {
            this.#freeObjectSlots.push(slot);
        }
        for (let index = 0; index < options.buckets.length; index += 1) {
            const bucket = options.buckets[index];
            if (bucket === undefined) continue;
            let materials = this.#logicalBucketByGeometry.get(bucket.geometry);
            if (materials === undefined) {
                materials = new Map();
                this.#logicalBucketByGeometry.set(bucket.geometry, materials);
            }
            if (materials.has(bucket.material)) {
                throw new TypeError('GPU Scene bucket geometry/material identities must be unique');
            }
            materials.set(bucket.material, index);
        }
    }

    record(context: RenderPipelineContext): void {
        if (this.#destroyed) throw new Error('Clustered Forward+ pipeline is destroyed');
        if (!(context.camera instanceof PerspectiveCamera)) {
            throw new TypeError('Clustered Forward+ requires a PerspectiveCamera');
        }
        if (context.frameIndex === this.#lastRecordedFrame) {
            throw new Error(
                'Clustered Forward+ supports one perspective-camera invocation per frame'
            );
        }
        this.#lastRecordedFrame = context.frameIndex;
        if (
            context.output.width > this.#options.maxViewportWidth ||
            context.output.height > this.#options.maxViewportHeight
        ) {
            throw new RangeError(
                `Clustered Forward+ output ${String(context.output.width)}x${String(context.output.height)} exceeds configured maximum`
            );
        }
        if (context.output.colorAttachmentCount !== 1) {
            throw new RangeError('Clustered Forward+ requires exactly one output color attachment');
        }
        if (context.output.sampleCount !== 1) {
            throw new RangeError('Clustered Forward+ currently requires a single-sample output');
        }

        // This performs canonical scene/camera matrix updates while GPU Scene retains visibility
        // ownership for compatible registered buckets.
        context.cull({ frustumCulling: false });
        this.refreshGPUCompatibility();
        this.collectScene(context);
        let fallbackCulling: CullingResultsHandle | null = null;
        if (this.#fallbackObjectCount !== 0) {
            fallbackCulling = context.cull();
            context.recordShadows(fallbackCulling);
        }
        this.syncMaterialDatabase(context);
        this.syncGeometryDatabases(context);
        const frame = this.packFrame(context);
        context.writeStorageBuffer(this.#frameData, 0, new Uint8Array(this.#frameBytes));

        const output = context.graph.importOutput();
        const outputColor = output.color(0);
        const displayColor = this.#fallbackHasTransparent
            ? context.graph.createTexture('Clustered Forward+ compatibility display', {
                  format: context.output.colorFormat(0),
                  extent: { relativeTo: 'output', scale: 1 },
                  sampleCount: 1
              })
            : outputColor;
        const sceneColor = context.graph.createTexture('Clustered Forward+ HDR scene', {
            format: 'rgba16float',
            extent: { relativeTo: 'output', scale: 1 },
            sampleCount: 1
        });
        const sceneDepth = context.graph.createTexture('GPU Scene depth', {
            format: 'depth32float',
            extent: { relativeTo: 'output', scale: 1 },
            sampleCount: 1
        });
        const bloomA = context.graph.createTexture('Clustered Forward+ bloom half A', {
            format: 'rgba16float',
            extent: { relativeTo: 'output', scale: 0.5, minWidth: 1, minHeight: 1 },
            sampleCount: 1
        });
        const bloomB = context.graph.createTexture('Clustered Forward+ bloom half B', {
            format: 'rgba16float',
            extent: { relativeTo: 'output', scale: 0.5, minWidth: 1, minHeight: 1 },
            sampleCount: 1
        });

        const frameBuffer = context.graph.importStorageBuffer(this.#frameData);
        const objects = context.graph.importStorageBuffer(this.#objects);
        const bucketData = context.graph.importStorageBuffer(this.#bucketData);
        const materials = context.graph.importStorageBuffer(this.#materials);
        const lights = context.graph.importStorageBuffer(this.#lights);
        const visible = context.graph.importStorageBuffer(this.#visibleIndices);
        const indirect = context.graph.importStorageBuffer(this.#indirectArguments);
        const cullStats = context.graph.importStorageBuffer(this.#cullStats);
        const tileDepthBounds = context.graph.importStorageBuffer(this.#tileDepthBounds);
        const clusterCounts = context.graph.importStorageBuffer(this.#clusterCounts);
        const clusterGrid = context.graph.importStorageBuffer(this.#clusterGrid);
        const clusterCursors = context.graph.importStorageBuffer(this.#clusterCursors);
        const clusterBlockSums = context.graph.importStorageBuffer(this.#clusterBlockSums);
        const clusterBlockOffsets = context.graph.importStorageBuffer(this.#clusterBlockOffsets);
        const clusterIndices = context.graph.importStorageBuffer(this.#clusterLightIndices);
        const clusterStats = context.graph.importStorageBuffer(this.#clusterStats);

        const histories = this.acquireHiZ(context);
        const clear = context.acquirePassParameters(this.#clearPool);
        // Reinitialize-policy buffers have undefined contents after device recovery. Clear the
        // complete allocation so the first recovered frame is valid even when the active viewport
        // uses only a prefix of the configured maximum cluster capacity.
        clear.add(clusterCounts, 0, this.#clusterCounts.byteLength);
        clear.add(cullStats, 0, STATS_BYTES);
        for (let index = 0; index < this.#physicalBuckets.length; index += 1) {
            clear.add(indirect, index * INDIRECT_ARGUMENT_BYTES + 4, 4);
        }
        context.graph.addPass(this.#clearPass, clear);

        const cull = context.acquirePassParameters(
            histories.valid ? this.#hizCullPool : this.#cullPool
        );
        cull.setBuffer(0, frameBuffer);
        cull.setBuffer(1, objects);
        cull.setBuffer(2, bucketData);
        cull.setBuffer(3, visible);
        cull.setBuffer(4, indirect);
        cull.setBuffer(5, cullStats);
        if (histories.valid) {
            for (let index = 0; index < HIZ_LEVEL_COUNT; index += 1) {
                const texture = histories.previous[index];
                if (texture === undefined) throw new Error('GPU Scene Hi-Z history is incomplete');
                cull.setTexture(index, texture);
            }
        }
        cull.setDispatch(Math.max(1, Math.ceil(this.#activeObjectHighWater / CULL_WORKGROUP_SIZE)));
        context.graph.addPass(
            histories.valid ? GPU_SCENE_HIZ_CULL_PASS : GPU_SCENE_CULL_PASS,
            cull
        );

        this.recordDepthPrepass(context, {
            frameBuffer,
            objects,
            visible,
            indirect,
            sceneDepth
        });
        this.recordCurrentHiZ(context, frameBuffer, sceneDepth, histories.current);
        this.recordClusterAllocation(context, {
            frame,
            frameBuffer,
            lights,
            sceneDepth,
            tileDepthBounds,
            clusterCounts,
            clusterGrid,
            clusterCursors,
            clusterBlockSums,
            clusterBlockOffsets,
            clusterIndices,
            clusterStats
        });
        this.recordColorPasses(context, {
            frameBuffer,
            objects,
            visible,
            materials,
            lights,
            clusterGrid,
            clusterIndices,
            indirect,
            sceneColor,
            sceneDepth
        });
        this.recordDisplay(context, sceneColor, bloomA, bloomB, displayColor);
        if (fallbackCulling !== null) {
            this.recordFallback(context, fallbackCulling, displayColor, sceneDepth);
        }
        if (displayColor !== outputColor) {
            this.recordFallbackPresent(context, displayColor, outputColor);
        }
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#lastRecordedFrame) return;
        for (const record of this.#objectByMesh.values()) {
            if (record.pendingWorldVersion < 0) continue;
            const moved = arraysDiffer(record.committedMatrix, record.pendingMatrix);
            record.committedMatrix.set(record.pendingMatrix);
            record.committedWorldVersion = record.pendingWorldVersion;
            record.pendingWorldVersion = -1;
            // One following upload makes previous == current after motion stops.
            if (moved) record.committedWorldVersion = -1;
        }
        this.#committedCameraMatrix.set(this.#stagedCameraMatrix);
        this.#committedViewMatrix.set(this.#stagedViewMatrix);
        this.#committedProjectionMatrix.set(this.#stagedProjectionMatrix);
        this.#committedDepth.set(this.#stagedDepth);
        this.#committedCamera = this.#pendingCamera;
        this.#committedCameraRevision = this.#pendingCameraRevision;
        this.#pendingCamera = null;
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex !== this.#lastRecordedFrame) return;
        for (const record of this.#objectByMesh.values()) record.pendingWorldVersion = -1;
        this.#pendingCamera = null;
    }

    async readDiagnostics(): Promise<Readonly<ClusteredForwardPlusDiagnostics>> {
        if (this.#destroyed) throw new Error('Clustered Forward+ pipeline is destroyed');
        const cull = await this.#cullStats.read();
        const cluster = await this.#clusterStats.read();
        const cullValues = new Uint32Array(
            cull.data.buffer,
            cull.data.byteOffset,
            cull.data.byteLength / 4
        );
        const clusterValues = new Uint32Array(
            cluster.data.buffer,
            cluster.data.byteOffset,
            cluster.data.byteLength / 4
        );
        return Object.freeze({
            objectCount: this.#objectCount,
            fallbackObjectCount: this.#fallbackObjectCount,
            lightCount: this.#lightCount,
            droppedLightCount: this.#droppedLightCount,
            visibleObjectCount: cullValues[0] ?? 0,
            occludedObjectCount: cullValues[1] ?? 0,
            lodObjectCount: cullValues[2] ?? 0,
            clusterLightIndexCount: clusterValues[1] ?? 0,
            clusterOverflowCount: clusterValues[2] ?? 0,
            hiZValid: this.#hiZValid
        });
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const buffers: StorageBuffer[] = [
            this.#frameData,
            this.#objects,
            this.#bucketData,
            this.#materials,
            this.#lights,
            this.#visibleIndices,
            this.#indirectArguments,
            this.#cullStats,
            this.#tileDepthBounds,
            this.#clusterCounts,
            this.#clusterGrid,
            this.#clusterCursors,
            this.#clusterBlockSums,
            this.#clusterBlockOffsets,
            this.#clusterLightIndices,
            this.#clusterStats
        ];
        for (const bucket of this.#physicalBuckets) {
            buffers.push(bucket.position, bucket.normal, bucket.index);
            for (const stream of [bucket.uv0, bucket.uv1, bucket.tangent0, bucket.tangent1]) {
                if (stream !== null) buffers.push(stream);
            }
        }
        const failures: unknown[] = [];
        for (const buffer of buffers) {
            try {
                buffer.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        this.#objectByMesh.clear();
        this.#logicalBucketByGeometry.clear();
        this.#onDestroy(this);
        if (failures.length !== 0) {
            throw new AggregateError(failures, 'Clustered Forward+ resource destruction failed', {
                cause: failures[0]
            });
        }
    }

    private createBucketData(physicalCount: number): Uint8Array {
        const bytes = new ArrayBuffer(this.#options.buckets.length * BUCKET_RECORD_BYTES);
        const uints = new Uint32Array(bytes);
        const floats = new Float32Array(bytes);
        let physicalIndex = 0;
        for (let logicalIndex = 0; logicalIndex < this.#options.buckets.length; logicalIndex += 1) {
            const bucket = this.#options.buckets[logicalIndex];
            if (bucket === undefined) continue;
            const base = logicalIndex * 12;
            uints[base] = physicalIndex++;
            uints[base + 1] = bucket.lods.length;
            for (let lodIndex = 0; lodIndex < bucket.lods.length; lodIndex += 1) {
                const targetIndex = physicalIndex++;
                if (lodIndex === 0) uints[base + 2] = targetIndex;
                else if (lodIndex === 1) uints[base + 3] = targetIndex;
                else uints[base + 4] = targetIndex;
                floats[base + 8 + lodIndex] = bucket.lods[lodIndex]?.maximumProjectedRadius ?? 0;
            }
        }
        if (physicalIndex !== physicalCount) {
            throw new Error('GPU Scene physical bucket planning is inconsistent');
        }
        return new Uint8Array(bytes);
    }

    private createPhysicalBuckets(
        context: RenderPipelineCreateContext,
        indirectData: Uint32Array
    ): PhysicalBucket[] {
        const result: PhysicalBucket[] = [];
        for (let logicalIndex = 0; logicalIndex < this.#options.buckets.length; logicalIndex += 1) {
            const logical = this.#options.buckets[logicalIndex];
            if (logical === undefined) continue;
            const variant = pbrMaterialVariant(logical.material);
            const levels = [logical.geometry, ...logical.lods.map(lod => lod.geometry)];
            for (const geometry of levels) {
                const validated = validateGeometryData(geometry);
                const variantIssue = geometryVariantIssue(validated, variant);
                if (variantIssue !== null) {
                    throw new TypeError(
                        `GPU Scene bucket ${String(logicalIndex)} geometry ${variantIssue}`
                    );
                }
                const physicalIndex = result.length;
                const positionData = copyAlignedData(validated.position.data);
                const normalData = copyAlignedData(validated.normal.data);
                const indexData = copyAlignedData(validated.index.data);
                const position = context.createStorageBuffer({
                    label: `GPU Scene bucket ${String(physicalIndex)} positions`,
                    byteLength: positionData.byteLength,
                    usage: ['storage', 'vertex', 'copy-destination'],
                    initialData: positionData,
                    recovery: 'cpu-shadow'
                });
                const normal = context.createStorageBuffer({
                    label: `GPU Scene bucket ${String(physicalIndex)} normals`,
                    byteLength: normalData.byteLength,
                    usage: ['storage', 'vertex', 'copy-destination'],
                    initialData: normalData,
                    recovery: 'cpu-shadow'
                });
                const createOptionalVertexStream = (
                    source: GeometryData | null,
                    name: string
                ): StorageBuffer | null => {
                    if (source === null) return null;
                    const data = copyAlignedData(source.data);
                    return context.createStorageBuffer({
                        label: `GPU Scene bucket ${String(physicalIndex)} ${name}`,
                        byteLength: data.byteLength,
                        usage: ['storage', 'vertex', 'copy-destination'],
                        initialData: data,
                        recovery: 'cpu-shadow'
                    });
                };
                const uv0 = createOptionalVertexStream(validated.uv0, 'UV0');
                const uv1 = createOptionalVertexStream(validated.uv1, 'UV1');
                const tangent0 = createOptionalVertexStream(validated.tangent0, 'tangents0');
                const tangent1 = createOptionalVertexStream(validated.tangent1, 'tangents1');
                const index = context.createStorageBuffer({
                    label: `GPU Scene bucket ${String(physicalIndex)} indices`,
                    byteLength: indexData.byteLength,
                    usage: ['storage', 'index', 'copy-destination'],
                    initialData: indexData,
                    recovery: 'cpu-shadow'
                });
                indirectData[physicalIndex * 5] = validated.index.count;
                indirectData[physicalIndex * 5 + 1] = 0;
                indirectData[physicalIndex * 5 + 2] = 0;
                indirectData[physicalIndex * 5 + 3] = 0;
                indirectData[physicalIndex * 5 + 4] = 0;
                result.push({
                    logicalIndex,
                    physicalIndex,
                    geometry,
                    position,
                    normal,
                    uv0,
                    uv1,
                    tangent0,
                    tangent1,
                    index,
                    indexFormat: validated.indexFormat,
                    indexCount: validated.index.count,
                    positionSource: validated.position,
                    normalSource: validated.normal,
                    uv0Source: validated.uv0,
                    uv1Source: validated.uv1,
                    tangent0Source: validated.tangent0,
                    tangent1Source: validated.tangent1,
                    indexSource: validated.index,
                    positionRevision: validated.position.revision,
                    normalRevision: validated.normal.revision,
                    uv0Revision: validated.uv0?.revision ?? -1,
                    uv1Revision: validated.uv1?.revision ?? -1,
                    tangent0Revision: validated.tangent0?.revision ?? -1,
                    tangent1Revision: validated.tangent1?.revision ?? -1,
                    indexRevision: validated.index.revision,
                    depthPass: new GPUDrivenRenderPass({
                        name: `GPU Scene depth bucket ${String(physicalIndex)}`,
                        shader: GPU_SCENE_DEPTH_SHADER,
                        pipelineState: requireBucketPassState(logical.material, 'depth-only'),
                        vertexLayouts: GPU_SCENE_DEPTH_VERTEX_LAYOUTS,
                        indexFormat: validated.indexFormat
                    }),
                    colorPass: this.createColorPass(
                        logical,
                        physicalIndex,
                        validated.indexFormat,
                        variant
                    ),
                    materialVariantKey: variant.key,
                    materialVariant: variant
                });
            }
        }
        return result;
    }

    private createColorPass(
        logical: Readonly<NormalizedBucket>,
        physicalIndex: number,
        indexFormat: 'uint16' | 'uint32',
        variant: Readonly<PBRMaterialVariant>
    ): GPUDrivenRenderPass {
        return new GPUDrivenRenderPass({
            name: `Clustered PBR bucket ${String(physicalIndex)}`,
            shader: gpuScenePBRShader(variant),
            pipelineState: Object.freeze({
                ...requireBucketPassState(logical.material, 'forward'),
                depthWrite: false
            }),
            vertexLayouts: gpuSceneVertexLayouts(variant),
            indexFormat
        });
    }

    private refreshGPUCompatibility(): void {
        this.#logicalGPUCompatible.fill(1);
        const variants: Readonly<PBRMaterialVariant>[] = [];
        for (let logicalIndex = 0; logicalIndex < this.#options.buckets.length; logicalIndex += 1) {
            const bucket = this.#options.buckets[logicalIndex];
            if (bucket === undefined) continue;
            variants[logicalIndex] = pbrMaterialVariant(bucket.material);
            if (
                bucketMaterialIssue(bucket.material) !== null ||
                requireBucketPassState(bucket.material, 'forward').frontFace !== bucket.frontFace ||
                requireBucketPassState(bucket.material, 'forward').cullMode !== bucket.cullMode
            ) {
                this.#logicalGPUCompatible[logicalIndex] = 0;
            }
        }
        for (const bucket of this.#physicalBuckets) {
            if (this.#logicalGPUCompatible[bucket.logicalIndex] !== 1) continue;
            let data: ReturnType<typeof validateGeometryData>;
            try {
                data = validateGeometryData(bucket.geometry);
            } catch {
                this.#logicalGPUCompatible[bucket.logicalIndex] = 0;
                continue;
            }
            const variant = variants[bucket.logicalIndex];
            if (variant === undefined) {
                this.#logicalGPUCompatible[bucket.logicalIndex] = 0;
                continue;
            }
            if (
                geometryVariantIssue(data, variant) !== null ||
                data.position !== bucket.positionSource ||
                data.normal !== bucket.normalSource ||
                data.index !== bucket.indexSource ||
                !geometryStreamMatches(data.uv0, bucket.uv0Source, bucket.uv0) ||
                !geometryStreamMatches(data.uv1, bucket.uv1Source, bucket.uv1) ||
                !geometryStreamMatches(data.tangent0, bucket.tangent0Source, bucket.tangent0) ||
                !geometryStreamMatches(data.tangent1, bucket.tangent1Source, bucket.tangent1) ||
                alignedByteLength(data.position.data.byteLength) !== bucket.position.byteLength ||
                alignedByteLength(data.normal.data.byteLength) !== bucket.normal.byteLength ||
                alignedByteLength(data.index.data.byteLength) !== bucket.index.byteLength
            ) {
                this.#logicalGPUCompatible[bucket.logicalIndex] = 0;
            }
        }
        for (const bucket of this.#physicalBuckets) {
            if (this.#logicalGPUCompatible[bucket.logicalIndex] !== 1) continue;
            const logical = this.#options.buckets[bucket.logicalIndex];
            const variant = variants[bucket.logicalIndex];
            if (logical === undefined || variant === undefined) continue;
            if (bucket.materialVariantKey === variant.key) continue;
            bucket.colorPass = this.createColorPass(
                logical,
                bucket.physicalIndex,
                bucket.indexFormat,
                variant
            );
            bucket.materialVariantKey = variant.key;
            bucket.materialVariant = variant;
        }
    }

    private collectScene(context: RenderPipelineContext): void {
        this.#frameSerial++;
        let dirtyStart = this.#options.maxObjects;
        let dirtyEnd = 0;
        let activeCount = 0;
        let highWater = 0;
        const cameraVisibility = context.camera.visibility >>> 0;
        const ambient = this.#frameFloats;
        this.#gpuManagedMeshes.length = 0;
        this.#fallbackObjectCount = 0;
        this.#fallbackHasOpaque = false;
        this.#fallbackHasTransparent = false;
        ambient[120] = 0;
        ambient[121] = 0;
        ambient[122] = 0;
        this.#lightCount = 0;
        this.#droppedLightCount = 0;

        context.scene.traverse(node => {
            if (!node.visible) return Node.TRAVERSE_STOP_CHILDREN;
            if (node instanceof Mesh && !node.isDestroyed) {
                const logicalIndex = this.findLogicalBucket(node);
                const gpuManaged =
                    logicalIndex !== null &&
                    this.#logicalGPUCompatible[logicalIndex] === 1 &&
                    !node.isSkinnedMesh &&
                    node.geometry?.isMorphGeometry !== true;
                if (gpuManaged) {
                    let record = this.#objectByMesh.get(node);
                    if (record === undefined) {
                        const slot = this.#freeObjectSlots.pop();
                        if (slot !== undefined) {
                            const initial = new Float32Array(16);
                            matrixElements(node.worldMatrix, initial, 0);
                            record = {
                                mesh: node,
                                slot,
                                logicalBucket: logicalIndex,
                                seenFrame: this.#frameSerial,
                                pendingWorldVersion: -1,
                                committedWorldVersion: -1,
                                committedMatrix: initial.slice(),
                                pendingMatrix: initial
                            };
                            this.#objectByMesh.set(node, record);
                        }
                    }
                    if (record === undefined) {
                        if ((cameraVisibility & (node.layer >>> 0)) !== 0) {
                            this.trackFallbackMesh(node);
                        }
                    } else {
                        this.#gpuManagedMeshes.push(node);
                        record.seenFrame = this.#frameSerial;
                        const dirty =
                            record.logicalBucket !== logicalIndex ||
                            record.committedWorldVersion !== node.worldMatrixVersion;
                        record.logicalBucket = logicalIndex;
                        if (dirty) {
                            this.packObject(record, node, logicalIndex);
                            dirtyStart = Math.min(dirtyStart, record.slot);
                            dirtyEnd = Math.max(dirtyEnd, record.slot + 1);
                        }
                        activeCount++;
                        highWater = Math.max(highWater, record.slot + 1);
                    }
                } else if (
                    node.geometry !== null &&
                    node.material !== null &&
                    (cameraVisibility & (node.layer >>> 0)) !== 0
                ) {
                    this.trackFallbackMesh(node);
                }
            } else if ((cameraVisibility & (node.layer >>> 0)) !== 0) {
                if (node instanceof AmbientLight && node.enabled) {
                    const color = node.getRealColor();
                    ambient[120] = (ambient[120] ?? 0) + color.r;
                    ambient[121] = (ambient[121] ?? 0) + color.g;
                    ambient[122] = (ambient[122] ?? 0) + color.b;
                } else if (
                    node instanceof PointLight ||
                    node instanceof SpotLight ||
                    node instanceof DirectionalLight ||
                    node instanceof AreaLight
                ) {
                    if (node.enabled) this.packLight(node, context.camera);
                }
            }
            return Node.TRAVERSE_STOP_NONE;
        });

        for (const [mesh, record] of this.#objectByMesh) {
            if (record.seenFrame === this.#frameSerial) continue;
            const metaOffset = record.slot * (OBJECT_RECORD_BYTES / 4) + 48;
            this.#objectUInts[metaOffset + 2] = 0;
            dirtyStart = Math.min(dirtyStart, record.slot);
            dirtyEnd = Math.max(dirtyEnd, record.slot + 1);
            this.#objectByMesh.delete(mesh);
            this.#freeObjectSlots.push(record.slot);
        }
        highWater = 0;
        for (const record of this.#objectByMesh.values()) {
            highWater = Math.max(highWater, record.slot + 1);
        }
        this.#objectCount = activeCount;
        this.#activeObjectHighWater = highWater;
        if (dirtyEnd > dirtyStart) {
            const byteOffset = dirtyStart * OBJECT_RECORD_BYTES;
            const byteLength = (dirtyEnd - dirtyStart) * OBJECT_RECORD_BYTES;
            context.writeStorageBuffer(
                this.#objects,
                byteOffset,
                new Uint8Array(this.#objectData, byteOffset, byteLength)
            );
        }
        const lightBytes = Math.max(1, this.#lightCount) * LIGHT_RECORD_BYTES;
        context.writeStorageBuffer(
            this.#lights,
            0,
            new Uint8Array(this.#lightFloats.buffer, 0, lightBytes)
        );
    }

    private trackFallbackMesh(mesh: Mesh): void {
        const material = mesh.material;
        if (material === null) return;
        this.#fallbackObjectCount++;
        if (material.isTransparent) this.#fallbackHasTransparent = true;
        else this.#fallbackHasOpaque = true;
    }

    private findLogicalBucket(mesh: Mesh): number | null {
        const geometry = mesh.geometry;
        const material = mesh.material;
        if (geometry === null || !(material instanceof PBRMaterial)) return null;
        return this.#logicalBucketByGeometry.get(geometry)?.get(material) ?? null;
    }

    private packObject(record: GPUSceneObjectRecord, mesh: Mesh, logicalIndex: number): void {
        const bucket = this.#options.buckets[logicalIndex];
        if (bucket === undefined) throw new Error('GPU Scene logical bucket is unavailable');
        const sphere = bucket.geometry.getSphereBounds();
        const floatOffset = record.slot * (OBJECT_RECORD_BYTES / 4);
        matrixElements(mesh.worldMatrix, this.#objectFloats, floatOffset);
        const hasCommitted = record.committedWorldVersion >= 0;
        const previous = hasCommitted ? record.committedMatrix : mesh.worldMatrix.elements;
        for (let index = 0; index < 16; index += 1) {
            this.#objectFloats[floatOffset + 16 + index] = previous[index] ?? 0;
        }
        this.#normalMatrix.fromMat4(mesh.worldMatrix);
        const normalDeterminant = this.#normalMatrix.determinant();
        if (!Number.isFinite(normalDeterminant) || normalDeterminant === 0) {
            throw new RangeError('GPU Scene mesh world matrix must have an invertible 3x3 basis');
        }
        this.#normalMatrix.normalFromMat4(mesh.worldMatrix);
        const normal = this.#normalMatrix.elements;
        for (let index = 0; index < 9; index += 1) {
            if (!Number.isFinite(normal[index])) {
                throw new RangeError('GPU Scene mesh normal matrix must contain finite values');
            }
        }
        for (let column = 0; column < 3; column += 1) {
            const target = floatOffset + 32 + column * 4;
            const source = column * 3;
            this.#objectFloats[target] = normal[source] ?? 0;
            this.#objectFloats[target + 1] = normal[source + 1] ?? 0;
            this.#objectFloats[target + 2] = normal[source + 2] ?? 0;
            this.#objectFloats[target + 3] = 0;
        }
        this.#objectFloats[floatOffset + 44] = sphere.center.x;
        this.#objectFloats[floatOffset + 45] = sphere.center.y;
        this.#objectFloats[floatOffset + 46] = sphere.center.z;
        this.#objectFloats[floatOffset + 47] = sphere.radius;
        this.#objectUInts[floatOffset + 48] = logicalIndex;
        this.#objectUInts[floatOffset + 49] = mesh.layer >>> 0;
        this.#objectUInts[floatOffset + 50] = 1;
        this.#objectUInts[floatOffset + 51] = 0;
        matrixElements(mesh.worldMatrix, record.pendingMatrix, 0);
        record.pendingWorldVersion = mesh.worldMatrixVersion;
    }

    private packLight(
        light: PointLight | SpotLight | DirectionalLight | AreaLight,
        camera: Camera
    ): void {
        if (this.#lightCount >= this.#options.maxLights) {
            this.#droppedLightCount++;
            return;
        }
        const base = this.#lightCount * 16;
        let type = 0;
        let range = light.range;
        let inner = 1;
        let outer = -1;
        camera.getModelViewMatrix(light, this.#tempMatrix).getTranslation(this.#tempVector);
        this.#lightFloats[base] = this.#tempVector.x;
        this.#lightFloats[base + 1] = this.#tempVector.y;
        this.#lightFloats[base + 2] = this.#tempVector.z;
        if (light instanceof DirectionalLight) {
            type = 2;
            range = this.cameraFar(camera);
            this.#tempVector.copy(light.getViewDirection(camera));
        } else if (light instanceof SpotLight) {
            type = 1;
            inner = light.cutoffCos;
            outer = light.outerCutoffCos;
            this.#tempVector.copy(light.getViewDirection(camera));
        } else if (light instanceof AreaLight) {
            type = 3;
            range ||= Math.max(light.width, light.height) * 2;
            this.#tempVector.set(0, 0, 1).transformDirection(this.#tempMatrix).normalize();
        } else {
            this.#tempVector.set(0, 0, 0);
        }
        range ||= this.cameraFar(camera);
        this.#lightFloats[base + 3] = range;
        const color = light.getRealColor();
        this.#lightFloats[base + 4] = color.r;
        this.#lightFloats[base + 5] = color.g;
        this.#lightFloats[base + 6] = color.b;
        this.#lightFloats[base + 7] = type;
        this.#lightFloats[base + 8] = this.#tempVector.x;
        this.#lightFloats[base + 9] = this.#tempVector.y;
        this.#lightFloats[base + 10] = this.#tempVector.z;
        this.#lightFloats[base + 11] = outer;
        this.#lightFloats[base + 12] = light.constantAttenuation;
        this.#lightFloats[base + 13] = light.linearAttenuation;
        this.#lightFloats[base + 14] = light.quadraticAttenuation;
        this.#lightFloats[base + 15] = inner;
        this.#lightCount++;
    }

    private packMaterials(target: Float32Array): void {
        for (let index = 0; index < this.#options.buckets.length; index += 1) {
            const material = this.#options.buckets[index]?.material;
            if (material === undefined) continue;
            const base = index * 36;
            target[base] = material.baseColor.r;
            target[base + 1] = material.baseColor.g;
            target[base + 2] = material.baseColor.b;
            target[base + 3] = material.metallic;
            const emission = materialEmission(material);
            target[base + 4] = emission[0] ?? 0;
            target[base + 5] = emission[1] ?? 0;
            target[base + 6] = emission[2] ?? 0;
            target[base + 7] = material.roughness;
            target[base + 8] = material.ior;
            target[base + 9] = material.occlusionStrength;
            target[base + 10] = material.normalScale;
            target[base + 11] = 0;
            packMaterialUVMatrix(
                material.getTextureSlot('baseColor')?.transform ?? null,
                target,
                base + 12
            );
            packMaterialUVMatrix(
                material.getTextureSlot('normal')?.transform ?? null,
                target,
                base + 24
            );
        }
    }

    private syncMaterialDatabase(context: RenderPipelineContext): void {
        this.packMaterials(this.#materialScratch);
        if (!arraysDiffer(this.#materialFloats, this.#materialScratch)) return;
        this.#materialFloats.set(this.#materialScratch);
        context.writeStorageBuffer(this.#materials, 0, this.#materialFloats);
    }

    private syncGeometryDatabases(context: RenderPipelineContext): void {
        for (const bucket of this.#physicalBuckets) {
            if (this.#logicalGPUCompatible[bucket.logicalIndex] !== 1) continue;
            if (bucket.positionRevision !== bucket.positionSource.revision) {
                const data = copyAlignedData(bucket.positionSource.data);
                if (data.byteLength !== bucket.position.byteLength) {
                    throw new RangeError(
                        'GPU Scene position buffer size changes require pipeline recreation'
                    );
                }
                context.writeStorageBuffer(bucket.position, 0, data);
                bucket.positionRevision = bucket.positionSource.revision;
            }
            if (bucket.normalRevision !== bucket.normalSource.revision) {
                const data = copyAlignedData(bucket.normalSource.data);
                if (data.byteLength !== bucket.normal.byteLength) {
                    throw new RangeError(
                        'GPU Scene normal buffer size changes require pipeline recreation'
                    );
                }
                context.writeStorageBuffer(bucket.normal, 0, data);
                bucket.normalRevision = bucket.normalSource.revision;
            }
            bucket.uv0Revision = this.syncOptionalGeometryStream(
                context,
                'UV0',
                bucket.uv0Source,
                bucket.uv0,
                bucket.uv0Revision
            );
            bucket.uv1Revision = this.syncOptionalGeometryStream(
                context,
                'UV1',
                bucket.uv1Source,
                bucket.uv1,
                bucket.uv1Revision
            );
            bucket.tangent0Revision = this.syncOptionalGeometryStream(
                context,
                'tangent0',
                bucket.tangent0Source,
                bucket.tangent0,
                bucket.tangent0Revision
            );
            bucket.tangent1Revision = this.syncOptionalGeometryStream(
                context,
                'tangent1',
                bucket.tangent1Source,
                bucket.tangent1,
                bucket.tangent1Revision
            );
            if (bucket.indexRevision !== bucket.indexSource.revision) {
                const data = copyAlignedData(bucket.indexSource.data);
                if (data.byteLength !== bucket.index.byteLength) {
                    throw new RangeError(
                        'GPU Scene index buffer size changes require pipeline recreation'
                    );
                }
                context.writeStorageBuffer(bucket.index, 0, data);
                bucket.indexRevision = bucket.indexSource.revision;
            }
        }
    }

    private syncOptionalGeometryStream(
        context: RenderPipelineContext,
        name: string,
        source: GeometryData | null,
        buffer: StorageBuffer | null,
        revision: number
    ): number {
        if (source === null || buffer === null || revision === source.revision) return revision;
        const data = copyAlignedData(source.data);
        if (data.byteLength !== buffer.byteLength) {
            throw new RangeError(
                `GPU Scene ${name} buffer size changes require pipeline recreation`
            );
        }
        context.writeStorageBuffer(buffer, 0, data);
        return source.revision;
    }

    private packFrame(context: RenderPipelineContext): Readonly<{
        tilesX: number;
        tilesY: number;
        clusterCount: number;
    }> {
        const camera = context.camera;
        const near = camera instanceof PerspectiveCamera ? camera.near : 0.1;
        const far = this.cameraFar(camera);
        const tilesX = Math.ceil(context.output.width / this.#options.tileSize);
        const tilesY = Math.ceil(context.output.height / this.#options.tileSize);
        const clusterCount = tilesX * tilesY * this.#options.zSlices;
        matrixElements(camera.viewProjectionMatrix, this.#frameFloats, 0);
        const cameraRevision = getTransformHistoryRevision(camera);
        const cameraHistoryValid =
            this.#committedCamera === camera && this.#committedCameraRevision === cameraRevision;
        const previousViewProjection = cameraHistoryValid
            ? this.#committedCameraMatrix
            : camera.viewProjectionMatrix.elements;
        const previousView = cameraHistoryValid
            ? this.#committedViewMatrix
            : camera.viewMatrix.elements;
        const previousProjection = cameraHistoryValid
            ? this.#committedProjectionMatrix
            : camera.projectionMatrix.elements;
        for (let index = 0; index < 16; index += 1) {
            this.#frameFloats[16 + index] = previousViewProjection[index] ?? 0;
            this.#frameFloats[64 + index] = previousView[index] ?? 0;
            this.#frameFloats[80 + index] = previousProjection[index] ?? 0;
        }
        matrixElements(camera.viewMatrix, this.#frameFloats, 32);
        matrixElements(camera.projectionMatrix, this.#frameFloats, 48);
        this.#frameFloats[96] = context.viewport[0];
        this.#frameFloats[97] = context.viewport[1];
        this.#frameFloats[98] = context.output.width;
        this.#frameFloats[99] = context.output.height;
        this.#frameFloats[100] = near;
        this.#frameFloats[101] = far;
        this.#frameFloats[102] = Math.log(far / near);
        this.#frameFloats[103] = camera.depthMode === 'reversed' ? 1 : 0;
        const previousDepth = cameraHistoryValid ? this.#committedDepth : this.#frameFloats;
        const previousDepthOffset = cameraHistoryValid ? 0 : 100;
        for (let index = 0; index < 4; index += 1) {
            this.#frameFloats[104 + index] = previousDepth[previousDepthOffset + index] ?? 0;
            this.#stagedDepth[index] = this.#frameFloats[100 + index] ?? 0;
        }
        this.#frameUInts[108] = tilesX;
        this.#frameUInts[109] = tilesY;
        this.#frameUInts[110] = this.#options.zSlices;
        this.#frameUInts[111] = this.#options.tileSize;
        this.#frameUInts[112] = this.#activeObjectHighWater;
        this.#frameUInts[113] = this.#options.buckets.length;
        this.#frameUInts[114] = this.#options.maxLightIndices;
        this.#frameUInts[115] = this.#lightCount;
        this.#frameUInts[116] = this.#visibleBucketCapacity;
        this.#frameUInts[117] = this.#options.maxLightsPerCluster;
        this.#frameUInts[118] = cameraHistoryValid && this.#options.hiZ ? 1 : 0;
        this.#frameUInts[119] = camera.visibility >>> 0;
        this.#frameFloats[120] = Math.min(this.#frameFloats[120] ?? 0, 4);
        this.#frameFloats[121] = Math.min(this.#frameFloats[121] ?? 0, 4);
        this.#frameFloats[122] = Math.min(this.#frameFloats[122] ?? 0, 4);
        this.#frameFloats[123] = 0;
        matrixElements(camera.viewProjectionMatrix, this.#stagedCameraMatrix, 0);
        matrixElements(camera.viewMatrix, this.#stagedViewMatrix, 0);
        matrixElements(camera.projectionMatrix, this.#stagedProjectionMatrix, 0);
        this.#pendingCamera = camera;
        this.#pendingCameraRevision = cameraRevision;
        if (!cameraHistoryValid) {
            for (const key of this.#hizKeys) context.graph.invalidateHistoryTexture(key);
        }
        return Object.freeze({ tilesX, tilesY, clusterCount });
    }

    private cameraFar(camera: Camera): number {
        const far = camera instanceof PerspectiveCamera ? camera.far : 1000;
        return (
            far ?? Math.max(camera instanceof PerspectiveCamera ? camera.near : 0.1, 0.1) * 100_000
        );
    }

    private acquireHiZ(context: RenderPipelineContext): Readonly<{
        valid: boolean;
        readonly previous: readonly RenderGraphTextureHandle[];
        readonly current: readonly RenderGraphTextureHandle[];
    }> {
        if (!this.#options.hiZ) {
            this.#hiZValid = false;
            return Object.freeze({
                valid: false,
                previous: Object.freeze([]),
                current: Object.freeze([])
            });
        }
        const previous: RenderGraphTextureHandle[] = [];
        const current: RenderGraphTextureHandle[] = [];
        let valid = true;
        for (let index = 0; index < HIZ_LEVEL_COUNT; index += 1) {
            const key = this.#hizKeys[index];
            const descriptor = this.#hizDescriptors[index];
            if (key === undefined || descriptor === undefined) {
                throw new Error('GPU Scene Hi-Z history configuration is incomplete');
            }
            const history = context.graph.acquireHistoryTexture(key, descriptor);
            current.push(history.current);
            valid &&= history.valid;
            if (history.valid) previous.push(history.history());
        }
        const cameraValid = this.#frameUInts[118] === 1;
        this.#hiZValid = valid && cameraValid;
        return Object.freeze({
            valid: this.#hiZValid,
            previous: Object.freeze(previous),
            current: Object.freeze(current)
        });
    }

    private recordDepthPrepass(
        context: RenderPipelineContext,
        resources: Readonly<{
            frameBuffer: RenderGraphBufferHandle;
            objects: RenderGraphBufferHandle;
            visible: RenderGraphBufferHandle;
            indirect: RenderGraphBufferHandle;
            sceneDepth: RenderGraphTextureHandle;
        }>
    ): void {
        for (let index = 0; index < this.#physicalBuckets.length; index += 1) {
            const bucket = this.#physicalBuckets[index];
            if (bucket === undefined) continue;
            const parameters = context.acquirePassParameters(this.#depthDrawPool);
            parameters.setBuffer(0, resources.frameBuffer);
            parameters.setBuffer(1, resources.objects);
            parameters.setBufferRange(
                2,
                resources.visible,
                index * this.#visibleBucketCapacity * 4,
                this.#visibleBucketCapacity * 4
            );
            parameters.setVertexBuffer(0, context.graph.importStorageBuffer(bucket.position));
            parameters.indexBuffer.buffer = context.graph.importStorageBuffer(bucket.index);
            parameters.draw.buffer = resources.indirect;
            parameters.draw.byteOffset = index * INDIRECT_ARGUMENT_BYTES;
            parameters.colorAttachments.length = 0;
            parameters.depthStencilAttachment = {
                texture: resources.sceneDepth,
                depthLoadOp: index === 0 ? 'clear' : 'load',
                depthStoreOp: 'store',
                depthClearValue: depthClearValue(context.camera.depthMode)
            };
            context.graph.addPass(bucket.depthPass, parameters);
        }
    }

    private recordCurrentHiZ(
        context: RenderPipelineContext,
        frameBuffer: RenderGraphBufferHandle,
        sceneDepth: RenderGraphTextureHandle,
        current: readonly RenderGraphTextureHandle[]
    ): void {
        if (!this.#options.hiZ) return;
        let source: RenderGraphTextureAccessHandle = sceneDepth;
        for (let index = 0; index < HIZ_LEVEL_COUNT; index += 1) {
            const destination = current[index];
            if (destination === undefined)
                throw new Error('GPU Scene Hi-Z current slot is missing');
            const parameters = context.acquirePassParameters(this.#hizPool);
            parameters.setBuffer(0, frameBuffer);
            parameters.setTexture(0, source);
            parameters.setTexture(1, destination);
            parameters.setDispatch(
                Math.max(1, Math.ceil(context.output.width / 2 ** (index + 1) / 8)),
                Math.max(1, Math.ceil(context.output.height / 2 ** (index + 1) / 8))
            );
            context.graph.addPass(
                index === 0 ? HIZ_DEPTH_REDUCE_PASS : HIZ_FLOAT_REDUCE_PASS,
                parameters
            );
            source = destination;
        }
    }

    private recordClusterAllocation(
        context: RenderPipelineContext,
        resources: Readonly<{
            frame: Readonly<{ tilesX: number; tilesY: number; clusterCount: number }>;
            frameBuffer: RenderGraphBufferHandle;
            lights: RenderGraphBufferHandle;
            sceneDepth: RenderGraphTextureHandle;
            tileDepthBounds: RenderGraphBufferHandle;
            clusterCounts: RenderGraphBufferHandle;
            clusterGrid: RenderGraphBufferHandle;
            clusterCursors: RenderGraphBufferHandle;
            clusterBlockSums: RenderGraphBufferHandle;
            clusterBlockOffsets: RenderGraphBufferHandle;
            clusterIndices: RenderGraphBufferHandle;
            clusterStats: RenderGraphBufferHandle;
        }>
    ): void {
        const depth = context.acquirePassParameters(this.#clusterDepthPool);
        depth.setBuffer(0, resources.frameBuffer);
        depth.setBuffer(1, resources.tileDepthBounds);
        depth.setTexture(0, resources.sceneDepth);
        depth.setDispatch(resources.frame.tilesX, resources.frame.tilesY);
        context.graph.addPass(CLUSTER_DEPTH_BOUNDS_PASS, depth);

        const count = context.acquirePassParameters(this.#clusterCountPool);
        count.setBuffer(0, resources.frameBuffer);
        count.setBuffer(1, resources.lights);
        count.setBuffer(2, resources.tileDepthBounds);
        count.setBuffer(3, resources.clusterCounts);
        count.setDispatch(Math.max(1, Math.ceil(this.#lightCount / CULL_WORKGROUP_SIZE)));
        context.graph.addPass(CLUSTER_LIGHT_COUNT_PASS, count);

        const blockCount = Math.ceil(resources.frame.clusterCount / PREFIX_WORKGROUP_SIZE);
        const blockScan = context.acquirePassParameters(this.#clusterBlockScanPool);
        blockScan.setBuffer(0, resources.frameBuffer);
        blockScan.setBuffer(1, resources.clusterCounts);
        blockScan.setBuffer(2, resources.clusterGrid);
        blockScan.setBuffer(3, resources.clusterBlockSums);
        blockScan.setDispatch(blockCount);
        context.graph.addPass(CLUSTER_BLOCK_SCAN_PASS, blockScan);

        const blockPrefix = context.acquirePassParameters(this.#clusterBlockPrefixPool);
        blockPrefix.setBuffer(0, resources.frameBuffer);
        blockPrefix.setBuffer(1, resources.clusterBlockSums);
        blockPrefix.setBuffer(2, resources.clusterBlockOffsets);
        blockPrefix.setBuffer(3, resources.clusterStats);
        blockPrefix.setDispatch(1);
        context.graph.addPass(CLUSTER_BLOCK_PREFIX_PASS, blockPrefix);

        const finalize = context.acquirePassParameters(this.#clusterPrefixFinalizePool);
        finalize.setBuffer(0, resources.frameBuffer);
        finalize.setBuffer(1, resources.clusterCounts);
        finalize.setBuffer(2, resources.clusterGrid);
        finalize.setBuffer(3, resources.clusterBlockOffsets);
        finalize.setBuffer(4, resources.clusterCursors);
        finalize.setBuffer(5, resources.clusterStats);
        finalize.setDispatch(blockCount);
        context.graph.addPass(CLUSTER_PREFIX_FINALIZE_PASS, finalize);

        const write = context.acquirePassParameters(this.#clusterWritePool);
        write.setBuffer(0, resources.frameBuffer);
        write.setBuffer(1, resources.lights);
        write.setBuffer(2, resources.tileDepthBounds);
        write.setBuffer(3, resources.clusterGrid);
        write.setBuffer(4, resources.clusterCursors);
        write.setBuffer(5, resources.clusterIndices);
        write.setDispatch(Math.max(1, Math.ceil(this.#lightCount / CULL_WORKGROUP_SIZE)));
        context.graph.addPass(CLUSTER_LIGHT_WRITE_PASS, write);
    }

    private recordColorPasses(
        context: RenderPipelineContext,
        resources: Readonly<{
            frameBuffer: RenderGraphBufferHandle;
            objects: RenderGraphBufferHandle;
            visible: RenderGraphBufferHandle;
            materials: RenderGraphBufferHandle;
            lights: RenderGraphBufferHandle;
            clusterGrid: RenderGraphBufferHandle;
            clusterIndices: RenderGraphBufferHandle;
            indirect: RenderGraphBufferHandle;
            sceneColor: RenderGraphTextureHandle;
            sceneDepth: RenderGraphTextureHandle;
        }>
    ): void {
        for (let index = 0; index < this.#physicalBuckets.length; index += 1) {
            const bucket = this.#physicalBuckets[index];
            if (bucket === undefined) continue;
            const logical = this.#options.buckets[bucket.logicalIndex];
            if (logical === undefined) continue;
            const currentVariant = pbrMaterialVariant(logical.material);
            const variant =
                currentVariant.key === bucket.materialVariantKey
                    ? currentVariant
                    : bucket.materialVariant;
            const parameters = context.acquirePassParameters(this.#colorDrawPool);
            parameters.configure(bucket.colorPass.vertexLayouts.length, variant.textures.length);
            parameters.setBuffer(0, resources.frameBuffer);
            parameters.setBuffer(1, resources.objects);
            parameters.setBufferRange(
                2,
                resources.visible,
                index * this.#visibleBucketCapacity * 4,
                this.#visibleBucketCapacity * 4
            );
            parameters.setBuffer(3, resources.materials);
            parameters.setBuffer(4, resources.lights);
            parameters.setBuffer(5, resources.clusterGrid);
            parameters.setBuffer(6, resources.clusterIndices);
            parameters.setVertexBuffer(0, context.graph.importStorageBuffer(bucket.position));
            parameters.setVertexBuffer(1, context.graph.importStorageBuffer(bucket.normal));
            let vertexSlot = 2;
            if (variant.usesUV0) {
                if (bucket.uv0 === null) throw new Error('GPU Scene UV0 buffer is unavailable');
                parameters.setVertexBuffer(
                    vertexSlot++,
                    context.graph.importStorageBuffer(bucket.uv0)
                );
            }
            if (variant.usesUV1) {
                if (bucket.uv1 === null) throw new Error('GPU Scene UV1 buffer is unavailable');
                parameters.setVertexBuffer(
                    vertexSlot++,
                    context.graph.importStorageBuffer(bucket.uv1)
                );
            }
            if (variant.normalUV !== null) {
                const tangent = variant.normalUV === 0 ? bucket.tangent0 : bucket.tangent1;
                if (tangent === null) throw new Error('GPU Scene tangent buffer is unavailable');
                parameters.setVertexBuffer(vertexSlot, context.graph.importStorageBuffer(tangent));
            }
            for (let textureIndex = 0; textureIndex < variant.textures.length; textureIndex += 1) {
                const texture = variant.textures[textureIndex]?.texture;
                if (texture === undefined) continue;
                parameters.setTexture(textureIndex, context.graph.importTexture(texture));
                parameters.samplers[textureIndex] = this.samplerFor(texture);
            }
            parameters.indexBuffer.buffer = context.graph.importStorageBuffer(bucket.index);
            parameters.draw.buffer = resources.indirect;
            parameters.draw.byteOffset = index * INDIRECT_ARGUMENT_BYTES;
            parameters.colorAttachments.length = 1;
            parameters.colorAttachments[0] = {
                texture: resources.sceneColor,
                loadOp: index === 0 ? 'clear' : 'load',
                storeOp: 'store',
                clearValue: { r: 0.004, g: 0.008, b: 0.022, a: 1 }
            };
            parameters.depthStencilAttachment = {
                texture: resources.sceneDepth,
                depthLoadOp: 'load',
                depthStoreOp: 'store',
                depthClearValue: depthClearValue(context.camera.depthMode)
            };
            context.graph.addPass(bucket.colorPass, parameters);
        }
    }

    private samplerFor(texture: Texture<unknown>): ComputeSampler {
        const key = textureSamplerKey(texture);
        const cached = this.#samplerByTexture.get(texture);
        if (cached?.key === key) return cached.sampler;
        const sampler = new ComputeSampler(textureSamplerDescriptor(texture));
        this.#samplerByTexture.set(texture, Object.freeze({ key, sampler }));
        return sampler;
    }

    private recordDisplay(
        context: RenderPipelineContext,
        sceneColor: RenderGraphTextureHandle,
        bloomA: RenderGraphTextureHandle,
        bloomB: RenderGraphTextureHandle,
        outputColor: RenderGraphTextureHandle
    ): void {
        const prefilter = context.acquirePassParameters(this.#fullscreenPool);
        prefilter.inputTextures.length = 1;
        prefilter.inputTextures[0] = sceneColor;
        prefilter.colorAttachments[0] = {
            texture: bloomA,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        context.graph.addPass(BLOOM_PREFILTER_PASS, prefilter);

        const blur = context.acquirePassParameters(this.#fullscreenPool);
        blur.inputTextures.length = 1;
        blur.inputTextures[0] = bloomA;
        blur.colorAttachments[0] = {
            texture: bloomB,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        context.graph.addPass(BLOOM_BLUR_PASS, blur);

        const display = context.acquirePassParameters(this.#fullscreenPool);
        display.inputTextures.length = 2;
        display.inputTextures[0] = sceneColor;
        display.inputTextures[1] = bloomB;
        display.colorAttachments[0] = {
            texture: outputColor,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        context.graph.addPass(this.#displayPass, display);
    }

    private recordFallback(
        context: RenderPipelineContext,
        cullingResults: CullingResultsHandle,
        outputColor: RenderGraphTextureHandle,
        sceneDepth: RenderGraphTextureHandle
    ): void {
        if (this.#fallbackHasOpaque) {
            this.recordFallbackList(
                context,
                cullingResults,
                this.#fallbackOpaqueListDescriptor,
                outputColor,
                sceneDepth,
                null
            );
        }
        if (!this.#fallbackHasTransparent) return;
        const opaqueTexture = context.graph.createTexture('Forward fallback opaque scene color', {
            format: context.output.colorFormat(0),
            extent: { relativeTo: 'output', scale: 1 },
            sampleCount: 1
        });
        const copy = context.acquirePassParameters(this.#fallbackCopyPool);
        copy.source = outputColor;
        copy.destination = opaqueTexture;
        context.graph.addPass(this.#fallbackCopyPass, copy);
        this.recordFallbackList(
            context,
            cullingResults,
            this.#fallbackTransparentListDescriptor,
            outputColor,
            sceneDepth,
            opaqueTexture
        );
    }

    private recordFallbackList(
        context: RenderPipelineContext,
        cullingResults: CullingResultsHandle,
        descriptor: MutableFallbackRendererListDescriptor,
        outputColor: RenderGraphTextureHandle,
        sceneDepth: RenderGraphTextureHandle,
        opaqueTexture: RenderGraphTextureHandle | null
    ): void {
        descriptor.cullingResults = cullingResults;
        const rendererList = context.createRendererList(descriptor);
        const parameters = context.acquirePassParameters(this.#fallbackPool);
        parameters.rendererList = rendererList;
        const color = parameters.colorAttachments[0];
        if (color === undefined)
            throw new Error('Forward fallback color attachment is unavailable');
        color.texture = outputColor;
        parameters.depthStencilAttachment = {
            texture: sceneDepth,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
            depthClearValue: depthClearValue(context.camera.depthMode)
        };
        if (opaqueTexture !== null) parameters.opaqueTexture = opaqueTexture;
        context.graph.addPass(this.#fallbackPass, parameters);
    }

    private recordFallbackPresent(
        context: RenderPipelineContext,
        source: RenderGraphTextureHandle,
        output: RenderGraphTextureHandle
    ): void {
        const parameters = context.acquirePassParameters(this.#fullscreenPool);
        parameters.inputTextures.length = 1;
        parameters.inputTextures[0] = source;
        parameters.colorAttachments[0] = {
            texture: output,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        };
        context.graph.addPass(this.#fallbackPresentPass, parameters);
    }
}

/**
 * WebGPU-only high-end factory combining G0 GPU Scene/Hi-Z and L0 Clustered Forward+.
 *
 * Compatible registered bucket meshes bypass CPU frustum sorting and ordinary PreparedDraw
 * creation. The GPU-driven path intentionally accepts opaque, unskinned, indexed triangle PBR
 * buckets with scalar factors or common opaque PBR maps. Material surface evaluation and the BRDF
 * are shared with ordinary Forward PBR; the clustered variant replaces only light-list selection
 * and iteration. Unregistered meshes, runtime-incompatible bucket state, deformation,
 * transparency, and object-capacity overflow use the shared Forward path in the same frame.
 * Invalid initial bucket declarations and unsupported devices still fail closed.
 */
export class ClusteredForwardPlusPipelineFactory implements RenderPipelineFactory {
    /** Stable diagnostic label for renderer initialization and graph tooling. */
    readonly name = 'GPU Scene + Clustered Forward+';
    /** Fail-closed WebGPU capabilities, limits, and texture formats required by this profile. */
    readonly requirements: Readonly<RenderPipelineRequirements>;
    readonly #options: Readonly<NormalizedOptions>;
    readonly #runtimes = new Set<ClusteredForwardPlusPipeline>();

    constructor(options: Readonly<ClusteredForwardPlusPipelineOptions>) {
        this.#options = normalizeOptions(options);
        const physicalCount = this.#options.buckets.reduce(
            (count, bucket) => count + 1 + bucket.lods.length,
            0
        );
        const requirements = bufferRequirementPlan(this.#options, physicalCount);
        this.requirements = Object.freeze({
            requiredCapabilities: Object.freeze([
                'storage-buffer' as const,
                'storage-texture' as const,
                'compute-pass' as const,
                'indirect-draw' as const
            ]),
            requiredTextureFormats: Object.freeze([
                Object.freeze({
                    format: 'depth32float' as const,
                    use: 'depth-stencil-attachment' as const
                }),
                Object.freeze({ format: 'depth32float' as const, use: 'sampled' as const }),
                Object.freeze({ format: 'r32float' as const, use: 'sampled' as const }),
                Object.freeze({ format: 'r32float' as const, use: 'storage' as const }),
                Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
                Object.freeze({
                    format: 'rgba16float' as const,
                    use: 'filterable-sampled' as const
                })
            ]),
            requiredLimits: Object.freeze({
                maxBindingsPerBindGroup: Math.max(
                    6 + HIZ_LEVEL_COUNT,
                    PBR_TEXTURE_ROLES.length * 2
                ),
                maxStorageBuffersPerShaderStage: 7,
                maxStorageTexturesPerShaderStage: 1,
                maxSampledTexturesPerShaderStage: Math.max(
                    HIZ_LEVEL_COUNT,
                    PBR_TEXTURE_ROLES.length
                ),
                maxSamplersPerShaderStage: PBR_TEXTURE_ROLES.length,
                maxStorageBufferBindingSize: requirements.maxStorageBufferBindingSize,
                maxBufferSize: requirements.maxBufferSize,
                maxComputeInvocationsPerWorkgroup: PREFIX_WORKGROUP_SIZE,
                maxComputeWorkgroupsPerDimension: requirements.maxComputeWorkgroupsPerDimension
            })
        });
    }

    /** Create one independent renderer-local GPU Scene and clustered-lighting runtime. */
    create(context: RenderPipelineCreateContext): RenderPipeline {
        const runtime = new ClusteredForwardPlusPipeline(this.#options, context, destroyed => {
            this.#runtimes.delete(destroyed);
        });
        this.#runtimes.add(runtime);
        return runtime;
    }

    /** Read on-demand GPU counters when this factory is attached to exactly one live Renderer. */
    async readDiagnostics(): Promise<Readonly<ClusteredForwardPlusDiagnostics>> {
        if (this.#runtimes.size !== 1) {
            throw new Error(
                'ClusteredForwardPlusPipelineFactory.readDiagnostics() requires exactly one live runtime'
            );
        }
        const runtime = this.#runtimes.values().next().value;
        if (!(runtime instanceof ClusteredForwardPlusPipeline)) {
            throw new Error('Clustered Forward+ runtime is unavailable');
        }
        return runtime.readDiagnostics();
    }
}

export default ClusteredForwardPlusPipelineFactory;
