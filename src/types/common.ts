/**
 * Common TypeScript type definitions for Hilo3d
 */

import type Geometry from '../geometry/Geometry';
import type Skeleton from '../core/Skeleton';
import type Texture from '../texture/Texture';
import type Color from '../math/Color';

// WebGL type aliases
export type GLenum = number;
export type GLint = number;
export type GLuint = number;
export type GLsizei = number;
export type GLintptr = number;
export type GLboolean = boolean;

/**
 * Mesh-like object interface
 */
export interface MeshLike {
    id: string;
    isSkinedMesh?: boolean;
    skeleton?: Skeleton;
    geometry: Geometry;
    getRenderOption(options: RenderOptions): void;
}

/**
 * Material-like object interface
 */
export interface MaterialLike {
    id: string;
    className: string;
    lightType?: string;
    isDirty?: boolean;
    shaderName?: string;
    shaderCacheId?: string;
    useHeaderCache?: boolean;
    isBasicMaterial?: boolean;
    isPBRMaterial?: boolean;
    isShaderMaterial?: boolean;
    isGeometryMaterial?: boolean;
    vs?: string;
    fs?: string;
    onBeforeCompile?: (vs: string, fs: string) => { vs: string; fs: string };
    getRenderOption(options: RenderOptions): void;
    getInstancedUniforms?(): Array<{ name: string }>;
    _shaderNumId?: number;
}

/**
 * LightManager-like interface
 */
export interface LightManagerLike {
    lightInfo: {
        uid: string;
    };
    getRenderOption(options: RenderOptions): void;
}

/**
 * Fog-like interface
 */
export interface FogLike {
    mode: string;
    getRenderOption(options: RenderOptions): void;
}

/**
 * WebGLRenderer-like interface
 */
export interface WebGLRendererLike {
    vertexPrecision: string;
    fragmentPrecision: string;
    resourceManager: {
        destroyIfNoRef(obj: unknown): void;
    };
}

/**
 * Render options dictionary
 */
export interface RenderOptions {
    [key: string]: number | string | boolean;
    HAS_FOG?: number;
    USE_LOG_DEPTH?: number;
    USE_FRAG_DEPTH?: number;
    HAS_NORMAL?: number;
    NORMAL_MAP?: number;
    HAS_TANGENT?: number;
    RECEIVE_SHADOWS?: number;
    DIRECTIONAL_LIGHTS_SMC?: number;
    SPOT_LIGHTS_SMC?: number;
    POINT_LIGHTS_SMC?: number;
}

/**
 * Shader constructor parameters
 */
export interface ShaderParams {
    vs?: string;
    fs?: string;
    alwaysUse?: boolean;
}

/**
 * Base material constructor parameters
 */
export interface MaterialParams {
    id?: string;
    name?: string;
    lightType?: string;
    diffuse?: Color | null;
    ambient?: Color | null;
    specular?: Color | null;
    emission?: Color | null;
    shininess?: number;
    transparency?: number;
    alphaCutoff?: number;
    normalMap?: Texture | null;
    parallaxMap?: Texture | null;
    emissionMap?: Texture | null;
    specularMap?: Texture | null;
    diffuseMap?: Texture | null;
    ambientMap?: Texture | null;
    alphaMap?: Texture | null;
    transparentMap?: Texture | null;
    side?: string;
    gammaOutput?: boolean;
    gammaFactor?: number;
    useHDR?: boolean;
    uvMatrix?: any; // Matrix3 but avoid circular dependency
    uvMatrix1?: any; // Matrix3
    writeOriginData?: boolean;
    premultiplyAlpha?: boolean;
    [key: string]: any; // Allow additional custom properties
}

/**
 * PBR material constructor parameters
 */
export interface PBRMaterialParams extends MaterialParams {
    baseColor?: Color | null;
    metallic?: number;
    roughness?: number;
    baseColorMap?: Texture | null;
    metallicMap?: Texture | null;
    roughnessMap?: Texture | null;
    metallicRoughnessMap?: Texture | null;
    occlusionMap?: Texture | null;
    brdfLUT?: Texture | null;
}

/**
 * Shader material constructor parameters
 */
export interface ShaderMaterialParams extends MaterialParams {
    vs?: string;
    fs?: string;
    uniforms?: any;
    attributes?: any;
    shaderCacheId?: string;
    useHeaderCache?: boolean;
}

/**
 * Geometry material constructor parameters
 */
export interface GeometryMaterialParams extends MaterialParams {
    useInstanced?: boolean;
}

/**
 * GeometryData constructor parameters
 */
export interface GeometryDataParams {
    bufferViewId?: string;
    stride?: number;
    offset?: number;
    normalized?: boolean;
    type?: number;
    target?: number;
    usage?: number;
    count?: number;
    realSize?: number;
    quantization?: any; // Quantization parameters
    min?: number[];
    max?: number[];
    [key: string]: any;
}

/**
 * Geometry constructor parameters
 */
export interface GeometryParams {
    id?: string;
    mode?: number;
    indices?: any; // GeometryData or TypedArray
    vertices?: any; // GeometryData or TypedArray
    normals?: any;
    tangents?: any;
    uvs?: any;
    uvs1?: any;
    colors?: any;
    skinIndices?: any;
    skinWeights?: any;
    [key: string]: any; // Allow custom attributes
}

/**
 * Camera constructor parameters
 */
export interface CameraParams {
    id?: string;
    name?: string;
    x?: number;
    y?: number;
    z?: number;
    rotationX?: number;
    rotationY?: number;
    rotationZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    [key: string]: any;
}

/**
 * Perspective camera constructor parameters
 */
export interface PerspectiveCameraParams extends CameraParams {
    fov?: number;
    aspect?: number;
    near?: number;
    far?: number | null;
}

/**
 * Orthographic camera constructor parameters
 */
export interface OrthographicCameraParams extends CameraParams {
    left?: number;
    right?: number;
    bottom?: number;
    top?: number;
    near?: number;
    far?: number;
}

/**
 * WebGL Extension interface for ANGLE_instanced_arrays
 */
export interface ANGLEInstancedArraysExtension {
    drawArraysInstancedANGLE(mode: GLenum, first: GLint, count: GLsizei, instanceCount: GLsizei): void;
    drawElementsInstancedANGLE(mode: GLenum, count: GLsizei, type: GLenum, offset: GLintptr, instanceCount: GLsizei): void;
    vertexAttribDivisorANGLE(index: GLuint, divisor: GLuint): void;
}

/**
 * WebGL Extension interface for OES_vertex_array_object
 */
export interface OESVertexArrayObjectExtension {
    createVertexArrayOES(): WebGLVertexArrayObject | null;
    deleteVertexArrayOES(vertexArray: WebGLVertexArrayObject | null): void;
    isVertexArrayOES(vertexArray: WebGLVertexArrayObject | null): GLboolean;
    bindVertexArrayOES(vertexArray: WebGLVertexArrayObject | null): void;
}

/**
 * WebGL Extension interface for WEBGL_draw_buffers
 */
export interface WEBGLDrawBuffersExtension {
    drawBuffersWEBGL(buffers: GLenum[]): void;
}

/**
 * WebGLRenderer constructor parameters
 */
export interface WebGLRendererParams {
    canvas?: HTMLCanvasElement;
    width?: number;
    height?: number;
    pixelRatio?: number;
    alpha?: boolean;
    depth?: boolean;
    stencil?: boolean;
    antialias?: boolean;
    premultipliedAlpha?: boolean;
    preserveDrawingBuffer?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    powerPreference?: 'default' | 'high-performance' | 'low-power';
    vertexPrecision?: string;
    fragmentPrecision?: string;
    useInstanced?: boolean;
    useVao?: boolean;
    logInfo?: boolean;
    [key: string]: any;
}

/**
 * GLTF Accessor data structure
 */
export interface GLTFAccessor {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
    max?: number[];
    min?: number[];
    sparse?: {
        count: number;
        indices: {
            bufferView: number;
            byteOffset?: number;
            componentType: number;
        };
        values: {
            bufferView: number;
            byteOffset?: number;
        };
    };
    normalized?: boolean;
    name?: string;
}

/**
 * GLTF BufferView data structure
 */
export interface GLTFBufferView {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
    name?: string;
}

/**
 * GLTF Buffer data structure
 */
export interface GLTFBuffer {
    uri?: string;
    byteLength: number;
    name?: string;
}

/**
 * GLTF Material data structure
 */
export interface GLTFMaterial {
    name?: string;
    pbrMetallicRoughness?: {
        baseColorFactor?: number[];
        baseColorTexture?: { index: number; texCoord?: number };
        metallicFactor?: number;
        roughnessFactor?: number;
        metallicRoughnessTexture?: { index: number; texCoord?: number };
    };
    normalTexture?: { index: number; texCoord?: number; scale?: number };
    occlusionTexture?: { index: number; texCoord?: number; strength?: number };
    emissiveTexture?: { index: number; texCoord?: number };
    emissiveFactor?: number[];
    alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
    alphaCutoff?: number;
    doubleSided?: boolean;
    extensions?: any;
}

/**
 * GLTF Primitive data structure
 */
export interface GLTFPrimitive {
    attributes: Record<string, number>;
    indices?: number;
    material?: number;
    mode?: number;
    targets?: Array<Record<string, number>>;
    extensions?: any;
}

/**
 * GLTF Mesh data structure
 */
export interface GLTFMesh {
    primitives: GLTFPrimitive[];
    weights?: number[];
    name?: string;
    extensions?: any;
}

/**
 * GLTF Node data structure
 */
export interface GLTFNode {
    camera?: number;
    children?: number[];
    skin?: number;
    matrix?: number[];
    mesh?: number;
    rotation?: number[];
    scale?: number[];
    translation?: number[];
    weights?: number[];
    name?: string;
    extensions?: any;
}

/**
 * GLTF Scene data structure
 */
export interface GLTFScene {
    nodes?: number[];
    name?: string;
    extensions?: any;
}

/**
 * GLTF Texture data structure
 */
export interface GLTFTexture {
    sampler?: number;
    source?: number;
    name?: string;
    extensions?: any;
}

/**
 * GLTF Image data structure
 */
export interface GLTFImage {
    uri?: string;
    mimeType?: string;
    bufferView?: number;
    name?: string;
    extensions?: any;
}

/**
 * GLTF Sampler data structure
 */
export interface GLTFSampler {
    magFilter?: number;
    minFilter?: number;
    wrapS?: number;
    wrapT?: number;
    name?: string;
}

/**
 * GLTF Animation data structure
 */
export interface GLTFAnimation {
    channels: Array<{
        sampler: number;
        target: {
            node?: number;
            path: string;
        };
    }>;
    samplers: Array<{
        input: number;
        interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
        output: number;
    }>;
    name?: string;
}

/**
 * GLTF Skin data structure
 */
export interface GLTFSkin {
    inverseBindMatrices?: number;
    skeleton?: number;
    joints: number[];
    name?: string;
}

/**
 * GLTF Camera data structure
 */
export interface GLTFCamera {
    type: 'perspective' | 'orthographic';
    perspective?: {
        aspectRatio?: number;
        yfov: number;
        zfar?: number;
        znear: number;
    };
    orthographic?: {
        xmag: number;
        ymag: number;
        zfar: number;
        znear: number;
    };
    name?: string;
}

/**
 * Complete GLTF data structure
 */
export interface GLTFData {
    asset: {
        version: string;
        generator?: string;
        copyright?: string;
        minVersion?: string;
    };
    scene?: number;
    scenes?: GLTFScene[];
    nodes?: GLTFNode[];
    meshes?: GLTFMesh[];
    materials?: GLTFMaterial[];
    textures?: GLTFTexture[];
    images?: GLTFImage[];
    samplers?: GLTFSampler[];
    buffers?: GLTFBuffer[];
    bufferViews?: GLTFBufferView[];
    accessors?: GLTFAccessor[];
    animations?: GLTFAnimation[];
    skins?: GLTFSkin[];
    cameras?: GLTFCamera[];
    extensions?: any;
    extensionsUsed?: string[];
    extensionsRequired?: string[];
}
