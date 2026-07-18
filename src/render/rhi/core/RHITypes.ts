/**
 * Backend-neutral scalar, flag, and value types shared by the RHI core.
 *
 * Native WebGL and WebGPU types deliberately do not cross this boundary.
 *
 * @internal
 */

export type RHIBackend = 'webgl2' | 'webgpu';

export const RHIBufferUsage = Object.freeze({
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200
});

export const RHITextureUsage = Object.freeze({
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10
});

export const RHIShaderStage = Object.freeze({
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4
});

export const RHIColorWrite = Object.freeze({
    RED: 0x1,
    GREEN: 0x2,
    BLUE: 0x4,
    ALPHA: 0x8,
    ALL: 0xf
});

export type RHIBufferUsageFlags = number;
export type RHITextureUsageFlags = number;
export type RHIShaderStageFlags = number;
export type RHIColorWriteFlags = number;

export type RHIPowerPreference = 'low-power' | 'high-performance';
export type RHIShaderStageName = 'vertex' | 'fragment' | 'compute';
export type RHIDataSource = ArrayBuffer | ArrayBufferView;
/** Preallocated dynamic-offset storage; ordinary arrays are excluded from the draw hot path. */
export type RHIUInt32View = Uint32Array;

export interface RHIColor {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

export interface RHIOrigin2D {
    readonly x?: number;
    readonly y?: number;
}

export interface RHIOrigin3D extends RHIOrigin2D {
    readonly z?: number;
}

export interface RHIExtent3D {
    readonly width: number;
    readonly height?: number;
    readonly depthOrArrayLayers?: number;
}

export interface RHINormalizedExtent3D {
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
}

export interface RHIViewport {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly minDepth: number;
    readonly maxDepth: number;
}

export interface RHIRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export type RHITextureDimension = '1d' | '2d' | '3d';
export type RHITextureViewDimension = '1d' | '2d' | '2d-array' | 'cube' | 'cube-array' | '3d';
export type RHITextureAspect = 'all' | 'stencil-only' | 'depth-only';

export type RHITextureFormat =
    | 'r8unorm'
    | 'r8snorm'
    | 'r8uint'
    | 'r8sint'
    | 'r16uint'
    | 'r16sint'
    | 'r16float'
    | 'rg8unorm'
    | 'rg8snorm'
    | 'rg8uint'
    | 'rg8sint'
    | 'r32uint'
    | 'r32sint'
    | 'r32float'
    | 'rg16uint'
    | 'rg16sint'
    | 'rg16float'
    | 'rgba8unorm'
    | 'rgba8unorm-srgb'
    | 'rgba8snorm'
    | 'rgba8uint'
    | 'rgba8sint'
    | 'bgra8unorm'
    | 'bgra8unorm-srgb'
    | 'rgb10a2unorm'
    | 'rgb10a2uint'
    | 'rg11b10ufloat'
    | 'rgb9e5ufloat'
    | 'rg32uint'
    | 'rg32sint'
    | 'rg32float'
    | 'rgba16uint'
    | 'rgba16sint'
    | 'rgba16float'
    | 'rgba32uint'
    | 'rgba32sint'
    | 'rgba32float'
    | 'stencil8'
    | 'depth16unorm'
    | 'depth24plus'
    | 'depth24plus-stencil8'
    | 'depth32float'
    | 'depth32float-stencil8'
    | 'bc1-rgba-unorm'
    | 'bc1-rgba-unorm-srgb'
    | 'bc2-rgba-unorm'
    | 'bc2-rgba-unorm-srgb'
    | 'bc3-rgba-unorm'
    | 'bc3-rgba-unorm-srgb'
    | 'etc2-rgb8unorm'
    | 'etc2-rgb8unorm-srgb'
    | 'etc2-rgb8a1unorm'
    | 'etc2-rgb8a1unorm-srgb'
    | 'etc2-rgba8unorm'
    | 'etc2-rgba8unorm-srgb'
    | 'eac-r11unorm'
    | 'eac-r11snorm'
    | 'eac-rg11unorm'
    | 'eac-rg11snorm'
    | 'astc-4x4-unorm'
    | 'astc-4x4-unorm-srgb';

export type RHILoadOp = 'load' | 'clear';
export type RHIStoreOp = 'store' | 'discard';
export type RHIIndexFormat = 'uint16' | 'uint32';
