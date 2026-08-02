import type Animation from '../animation/Animation';
import type Camera from '../camera/Camera';
import type Geometry from '../geometry/Geometry';
import type GeometryData from '../geometry/GeometryData';
import type Light from '../light/Light';
import type Material from '../material/MaterialInstance';
import type Mesh from '../core/Mesh';
import type Node from '../core/Node';
import type Texture from '../texture/Texture';
import type { JsonValue } from './BasicLoader';

export type GLTFIndex = string | number;
export type GLTFCollection<Value> =
    readonly (Value | null)[] | Readonly<Record<string, Value | null>>;
export type GLTFExtensionMap = Readonly<Record<string, unknown>>;

export interface GLTFProperty {
    name?: string;
    extensions?: GLTFExtensionMap;
    extras?: JsonValue;
}

export interface GLTFAsset extends GLTFProperty {
    version: string;
    minVersion?: string;
    generator?: string;
    copyright?: string;
}

export interface GLTFBuffer extends GLTFProperty {
    uri?: string;
    byteLength: number;
}

export interface GLTFBufferView extends GLTFProperty {
    buffer: GLTFIndex;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
}

export type GLTFComponentType = 5120 | 5121 | 5122 | 5123 | 5125 | 5126;
export type GLTFAccessorType = 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT2' | 'MAT3' | 'MAT4';

export interface GLTFSparseIndices {
    bufferView: GLTFIndex;
    byteOffset?: number;
    componentType: 5121 | 5123 | 5125;
}

export interface GLTFSparseValues {
    bufferView: GLTFIndex;
    byteOffset?: number;
}

export interface GLTFSparseAccessor {
    count: number;
    indices: GLTFSparseIndices;
    values: GLTFSparseValues;
}

export interface GLTFAccessor extends GLTFProperty {
    bufferView?: GLTFIndex;
    byteOffset?: number;
    /** glTF 1.0 stored stride on the accessor rather than its buffer view. */
    byteStride?: number;
    componentType: GLTFComponentType;
    normalized?: boolean;
    count: number;
    type: GLTFAccessorType;
    max?: readonly number[];
    min?: readonly number[];
    sparse?: GLTFSparseAccessor;
}

export interface GLTFImage extends GLTFProperty {
    uri?: string;
    mimeType?: string;
    bufferView?: GLTFIndex;
}

export interface GLTFSampler extends GLTFProperty {
    magFilter?: number;
    minFilter?: number;
    wrapS?: number;
    wrapT?: number;
}

export interface GLTFTexture extends GLTFProperty {
    sampler?: GLTFIndex;
    /** Optional when a required texture-source extension supplies the image. */
    source?: GLTFIndex;
}

export interface GLTFTextureInfo {
    index: GLTFIndex;
    texCoord?: number;
    scale?: number;
    strength?: number;
    extensions?: GLTFExtensionMap;
}

export type GLTFMaterialValue =
    boolean | number | string | readonly number[] | GLTFTextureInfo | null;

export interface GLTFPBRMetallicRoughness {
    baseColorFactor?: readonly number[];
    baseColorTexture?: GLTFTextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: GLTFTextureInfo;
}

export interface GLTFTextureTransformExtension {
    offset?: readonly [number, number];
    rotation?: number;
    scale?: readonly [number, number];
    texCoord?: number;
}

export interface GLTFPBRSpecularGlossinessExtension {
    diffuseFactor?: readonly [number, number, number, number];
    diffuseTexture?: GLTFTextureInfo;
    specularFactor?: readonly [number, number, number];
    glossinessFactor?: number;
    specularGlossinessTexture?: GLTFTextureInfo;
}

export interface GLTFClearcoatExtension {
    clearcoatFactor?: number;
    clearcoatTexture?: GLTFTextureInfo;
    clearcoatRoughnessFactor?: number;
    clearcoatRoughnessTexture?: GLTFTextureInfo;
    clearcoatNormalTexture?: GLTFTextureInfo;
}

export interface GLTFAnisotropyExtension {
    anisotropyStrength?: number;
    anisotropyRotation?: number;
    anisotropyTexture?: GLTFTextureInfo;
}

export interface GLTFTransmissionExtension {
    transmissionFactor?: number;
    transmissionTexture?: GLTFTextureInfo;
}

export interface GLTFVolumeExtension {
    thicknessFactor?: number;
    thicknessTexture?: GLTFTextureInfo;
    attenuationDistance?: number;
    attenuationColor?: readonly [number, number, number];
}

export interface GLTFIorExtension {
    ior?: number;
}

export interface GLTFIridescenceExtension {
    iridescenceFactor?: number;
    iridescenceTexture?: GLTFTextureInfo;
    iridescenceIor?: number;
    iridescenceThicknessMinimum?: number;
    iridescenceThicknessMaximum?: number;
    iridescenceThicknessTexture?: GLTFTextureInfo;
}

export interface GLTFMaterialsCommonExtension {
    technique?: 'CONSTANT' | 'LAMBERT' | 'PHONG' | 'BLINN';
    values: Readonly<Record<string, GLTFMaterialValue>>;
    doubleSided?: boolean;
    transparent?: boolean;
    transparency?: number;
}

export interface GLTFMaterial extends GLTFProperty {
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
    alphaCutoff?: number;
    doubleSided?: boolean;
    normalTexture?: GLTFTextureInfo;
    occlusionTexture?: GLTFTextureInfo;
    emissiveTexture?: GLTFTextureInfo;
    emissiveFactor?: readonly number[];
    pbrMetallicRoughness?: GLTFPBRMetallicRoughness;
    transparencyTexture?: GLTFTextureInfo;
    technique?: GLTFIndex;
    values?: Readonly<Record<string, GLTFMaterialValue>>;
}

export type GLTFMorphTarget = Readonly<Record<string, GLTFIndex>>;

export interface GLTFPrimitive extends GLTFProperty {
    attributes: Readonly<Record<string, GLTFIndex>>;
    indices?: GLTFIndex;
    material?: GLTFIndex;
    mode?: number;
    targets?: readonly GLTFMorphTarget[];
}

export interface GLTFMesh extends GLTFProperty {
    primitives: readonly GLTFPrimitive[];
    weights?: readonly number[];
}

export interface GLTFNode extends GLTFProperty {
    camera?: GLTFIndex;
    children?: readonly GLTFIndex[];
    skin?: GLTFIndex;
    matrix?: readonly number[];
    mesh?: GLTFIndex;
    meshes?: readonly GLTFIndex[];
    rotation?: readonly number[];
    scale?: readonly number[];
    translation?: readonly number[];
    weights?: readonly number[];
    jointName?: string;
}

export interface GLTFPerspectiveCamera {
    aspectRatio?: number;
    yfov: number;
    zfar?: number;
    znear: number;
}

export interface GLTFOrthographicCamera {
    xmag: number;
    ymag: number;
    zfar: number;
    znear: number;
}

export interface GLTFCamera extends GLTFProperty {
    type: 'perspective' | 'orthographic';
    perspective?: GLTFPerspectiveCamera;
    orthographic?: GLTFOrthographicCamera;
    /** glTF 1.0 stored aspectRatio beside the perspective object. */
    aspectRatio?: number;
}

export interface GLTFAnimationTarget {
    id?: GLTFIndex;
    node?: GLTFIndex;
    path: 'translation' | 'rotation' | 'scale' | 'weights';
}

export interface GLTFAnimationChannel {
    sampler: GLTFIndex;
    target: GLTFAnimationTarget;
}

export interface GLTFAnimationSampler {
    input: GLTFIndex;
    interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
    output: GLTFIndex;
}

export interface GLTFAnimation extends GLTFProperty {
    channels: readonly GLTFAnimationChannel[];
    samplers: GLTFCollection<GLTFAnimationSampler>;
    /** glTF 1.0 maps animation parameter names to accessor ids. */
    parameters?: Readonly<Record<string, GLTFIndex>>;
}

export interface GLTFSkin extends GLTFProperty {
    inverseBindMatrices?: GLTFIndex;
    joints?: readonly GLTFIndex[];
    /** glTF 1.0 represented joints by their jointName values. */
    jointNames?: readonly string[];
    skeleton?: GLTFIndex;
    bindShapeMatrix?: readonly number[];
}

export interface GLTFScene extends GLTFProperty {
    nodes?: readonly GLTFIndex[];
}

export interface GLTFTechniqueStates {
    enable?: readonly number[];
    functions?: Readonly<Record<string, readonly number[]>>;
}

export interface GLTFShader extends GLTFProperty {
    uri?: string;
    bufferView?: GLTFIndex;
    type?: number;
}

export interface GLTFProgram extends GLTFProperty {
    attributes?: readonly string[];
    fragmentShader: GLTFIndex;
    vertexShader: GLTFIndex;
}

export interface GLTFTechniqueBinding {
    type?: number;
    semantic?: string;
    node?: GLTFIndex;
    value?: JsonValue;
    count?: number;
}

export interface GLTFTechnique extends GLTFProperty {
    program?: GLTFIndex;
    attributes?: Readonly<Record<string, GLTFTechniqueBinding | GLTFIndex>>;
    uniforms?: Readonly<Record<string, GLTFTechniqueBinding | GLTFIndex>>;
    parameters?: Readonly<Record<string, GLTFTechniqueBinding>>;
    states?: GLTFTechniqueStates;
}

export interface GLTFQuantizedAttributesExtension {
    decodeMatrix: readonly number[];
}

export type GLTFAnimationClipsExtension = Readonly<Record<string, readonly [number, number]>>;

export interface GLTFBoundingBoxExtension {
    min: readonly [number, number, number];
    max: readonly [number, number, number];
}

export interface GLTFPunctualSpotLight {
    innerConeAngle?: number;
    outerConeAngle?: number;
}

export interface GLTFPunctualLight extends GLTFProperty {
    type: 'directional' | 'point' | 'spot';
    color?: readonly [number, number, number];
    intensity?: number;
    range?: number;
    spot?: GLTFPunctualSpotLight;
}

export interface GLTFPunctualLightsExtension {
    lights: GLTFCollection<GLTFPunctualLight>;
}

export interface GLTFPunctualLightNodeExtension {
    light: GLTFIndex;
}

export interface GLTFRoot extends GLTFProperty {
    asset: GLTFAsset;
    scene?: GLTFIndex;
    extensionsUsed?: readonly string[];
    extensionsRequired?: readonly string[];
    buffers?: GLTFCollection<GLTFBuffer>;
    bufferViews?: GLTFCollection<GLTFBufferView>;
    accessors?: GLTFCollection<GLTFAccessor>;
    images?: GLTFCollection<GLTFImage>;
    samplers?: GLTFCollection<GLTFSampler>;
    textures?: GLTFCollection<GLTFTexture>;
    materials?: GLTFCollection<GLTFMaterial>;
    meshes?: GLTFCollection<GLTFMesh>;
    nodes?: GLTFCollection<GLTFNode>;
    cameras?: GLTFCollection<GLTFCamera>;
    animations?: GLTFCollection<GLTFAnimation>;
    skins?: GLTFCollection<GLTFSkin>;
    scenes?: GLTFCollection<GLTFScene>;
    shaders?: GLTFCollection<GLTFShader>;
    programs?: GLTFCollection<GLTFProgram>;
    techniques?: GLTFCollection<GLTFTechnique>;
}

export interface GLTFBufferViewRuntime {
    readonly id: string;
    readonly byteOffset: number;
    readonly byteLength: number;
    readonly buffer: ArrayBuffer;
    readonly byteStride?: number;
}

export interface GLTFBounds {
    min: number[];
    max: number[];
    center: number[];
    width: number;
    height: number;
    depth: number;
    size: number;
}

export interface GLTFModel {
    node: Node;
    scene: Node;
    meshes: Mesh[];
    json: GLTFRoot;
    cameras: Camera[];
    lights: Light[];
    textures: Texture[];
    materials: Material[];
    anim?: Animation;
    bounds?: GLTFBounds;
    /** Settles when progressive textures and compressed geometry finish. */
    ready: Promise<void>;
    /** Explicitly retained failures when ignoreTextureError is enabled. */
    resourceErrors: readonly Error[];
}

export interface GLTFProgressivePrimitiveState {
    geometry?: Geometry;
    meshes: Mesh[];
}

export type GLTFAccessorResult = GeometryData;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate the required glTF root contract before parser code reads it. */
export function isGLTFRoot(value: unknown): value is GLTFRoot {
    if (!isRecord(value)) return false;
    const asset = value['asset'];
    return isRecord(asset) && typeof asset['version'] === 'string';
}

export function createEmptyGLTFRoot(): GLTFRoot {
    return { asset: { version: '2.0' } };
}

export function isArrayCollection<Value>(
    collection: GLTFCollection<Value>
): collection is readonly (Value | null)[] {
    return Array.isArray(collection);
}

export function getCollectionItem<Value>(
    collection: GLTFCollection<Value> | undefined,
    key: GLTFIndex
): Value | undefined {
    if (!collection) return undefined;
    if (isArrayCollection(collection)) {
        const index = typeof key === 'number' ? key : Number(key);
        if (!Number.isInteger(index)) return undefined;
        return collection[index] ?? undefined;
    }
    return collection[String(key)] ?? undefined;
}

export function collectionEntries<Value>(
    collection: GLTFCollection<Value> | undefined
): (readonly [string, Value])[] {
    if (!collection) return [];
    const result: (readonly [string, Value])[] = [];
    if (isArrayCollection(collection)) {
        collection.forEach((value, index) => {
            if (value !== null) result.push([String(index), value]);
        });
        return result;
    }
    for (const [key, value] of Object.entries(collection)) {
        if (value !== null) result.push([key, value]);
    }
    return result;
}
