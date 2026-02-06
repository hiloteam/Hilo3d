/**
 * Common TypeScript type definitions for Hilo3d
 */

import type Mesh from '../core/Mesh';
import type Material from '../material/Material';
import type Fog from '../core/Fog';
import type Geometry from '../geometry/Geometry';
import type Skeleton from '../core/Skeleton';

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
