/**
 * Common TypeScript type definitions for Hilo3d
 */

import type Mesh from '../core/Mesh';
import type Material from '../material/Material';
import type Fog from '../core/Fog';
import type Geometry from '../geometry/Geometry';
import type Skeleton from '../core/Skeleton';
import type Texture from '../texture/Texture';
import type Color from '../math/Color';

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
