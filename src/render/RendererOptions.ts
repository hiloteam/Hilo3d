import type Fog from '../core/Fog';
import type Material from '../material/Material';
import type Color from '../math/Color';
import type { RendererBackend } from './RendererCore';
import type { ShaderPrecision } from './types';

/** Backend-neutral power policy used while selecting a graphics adapter. */
export type RendererAdapterPowerPreference = 'low-power' | 'high-performance';

/** Backend-neutral context power policy; `default` is accepted by WebGL2 contexts. */
export type RendererContextPowerPreference = 'default' | RendererAdapterPowerPreference;

/** Optional device capabilities that the renderer can request through the portable RHI. */
export type RendererFeatureName =
    | 'texture-compression-bc'
    | 'texture-compression-etc2'
    | 'texture-compression-astc'
    | 'timestamp-query'
    | 'depth32float-stencil8'
    | 'float32-filterable'
    | 'float32-blendable';

/** Backend-independent construction options. */
export interface RendererCommonOptions {
    width?: number;
    height?: number;
    pixelRatio?: number;
    domElement?: HTMLCanvasElement | null;
    useInstanced?: boolean;
    alpha?: boolean;
    depth?: boolean;
    stencil?: boolean;
    antialias?: boolean;
    premultipliedAlpha?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    useLogDepth?: boolean;
    vertexPrecision?: ShaderPrecision;
    fragmentPrecision?: ShaderPrecision;
    fog?: Fog | null;
    offsetX?: number;
    offsetY?: number;
    forceMaterial?: Material | null;
    clearColor?: Color;
}

/** WebGPU adapter/device constraints accepted by support probes and automatic selection. */
export interface RendererSupportOptions {
    powerPreference?: RendererAdapterPowerPreference;
    forceFallbackAdapter?: boolean;
    failIfMajorPerformanceCaveat?: boolean;
    requiredFeatures?: readonly RendererFeatureName[];
    requiredLimits?: Readonly<Record<string, number>>;
}

/** WebGL2 renderer creation options. */
export interface RendererWebGL2Options extends RendererCommonOptions {
    backend?: 'webgl2';
    preserveDrawingBuffer?: boolean;
    powerPreference?: RendererContextPowerPreference;
}

/** WebGPU renderer creation options. */
export interface RendererWebGPUOptions extends RendererCommonOptions, RendererSupportOptions {
    backend: 'webgpu';
    /** WebGPU has no preserved default framebuffer. */
    preserveDrawingBuffer?: never;
}

export interface RendererOptionsMap {
    readonly webgl2: RendererWebGL2Options;
    readonly webgpu: RendererWebGPUOptions;
}

/** Options for an explicitly selected renderer backend. */
export type RendererOptions<Backend extends RendererBackend = RendererBackend> =
    RendererOptionsMap[Backend];

export type RendererExplicitOptions = RendererOptions;

/** WebGPU-first asynchronous backend-selection options. */
export interface RendererAutoOptions extends RendererCommonOptions, RendererSupportOptions {
    backend?: 'auto';
    /** Supplying this WebGL2-only option makes automatic selection choose WebGL2. */
    preserveDrawingBuffer?: boolean;
}

/** Options accepted by Renderer.create. */
export type RendererCreateOptions = RendererExplicitOptions | RendererAutoOptions;
