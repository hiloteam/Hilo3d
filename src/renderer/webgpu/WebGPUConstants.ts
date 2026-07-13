/**
 * WebGPU flag values are part of the WebGPU ABI, but the ambient TypeScript
 * declarations intentionally do not expose the browser's runtime constants.
 * Keeping the flags here also lets the resource layer run against test devices
 * without installing mutable globals.
 */
export const WebGPUBufferUsage = Object.freeze({
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
} satisfies Record<string, GPUBufferUsageFlags>);

export const WebGPUTextureUsage = Object.freeze({
    COPY_SRC: 0x01,
    COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04,
    STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10
} satisfies Record<string, GPUTextureUsageFlags>);

export const WebGPUShaderStage = Object.freeze({
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4
} satisfies Record<string, GPUShaderStageFlags>);

export const WebGPUMapMode = Object.freeze({
    READ: 0x1,
    WRITE: 0x2
} satisfies Record<string, GPUMapModeFlags>);
