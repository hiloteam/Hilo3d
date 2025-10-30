/**
 * WebGPU常量定义
 * 这些常量用于抽象WebGPU的具体实现，提供与WebGL类似的接口
 * @module constants/webgpu
 */

/**
 * Texture formats
 * @memberOf constants
 */
export const WEBGPU_TEXTURE_FORMATS = {
    RGBA8_UNORM: 'rgba8unorm',
    RGBA8_UNORM_SRGB: 'rgba8unorm-srgb',
    BGRA8_UNORM: 'bgra8unorm',
    BGRA8_UNORM_SRGB: 'bgra8unorm-srgb',
    DEPTH24_PLUS: 'depth24plus',
    DEPTH24_PLUS_STENCIL8: 'depth24plus-stencil8',
    DEPTH32_FLOAT: 'depth32float',
    R32_FLOAT: 'r32float',
    RG32_FLOAT: 'rg32float',
    RGBA32_FLOAT: 'rgba32float'
};

/**
 * Buffer usage flags
 * @memberOf constants
 */
export const WEBGPU_BUFFER_USAGE = {
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
};

/**
 * Shader stage flags
 * @memberOf constants
 */
export const WEBGPU_SHADER_STAGE = {
    VERTEX: 0x1,
    FRAGMENT: 0x2,
    COMPUTE: 0x4
};

/**
 * Primitive topology
 * @memberOf constants
 */
export const WEBGPU_PRIMITIVE_TOPOLOGY = {
    POINT_LIST: 'point-list',
    LINE_LIST: 'line-list',
    LINE_STRIP: 'line-strip',
    TRIANGLE_LIST: 'triangle-list',
    TRIANGLE_STRIP: 'triangle-strip'
};

/**
 * Compare functions
 * @memberOf constants
 */
export const WEBGPU_COMPARE_FUNCTION = {
    NEVER: 'never',
    LESS: 'less',
    EQUAL: 'equal',
    LESS_EQUAL: 'less-equal',
    GREATER: 'greater',
    NOT_EQUAL: 'not-equal',
    GREATER_EQUAL: 'greater-equal',
    ALWAYS: 'always'
};

/**
 * Blend factors
 * @memberOf constants
 */
export const WEBGPU_BLEND_FACTOR = {
    ZERO: 'zero',
    ONE: 'one',
    SRC: 'src',
    ONE_MINUS_SRC: 'one-minus-src',
    SRC_ALPHA: 'src-alpha',
    ONE_MINUS_SRC_ALPHA: 'one-minus-src-alpha',
    DST: 'dst',
    ONE_MINUS_DST: 'one-minus-dst',
    DST_ALPHA: 'dst-alpha',
    ONE_MINUS_DST_ALPHA: 'one-minus-dst-alpha',
    SRC_ALPHA_SATURATED: 'src-alpha-saturated',
    CONSTANT: 'constant',
    ONE_MINUS_CONSTANT: 'one-minus-constant'
};

/**
 * Blend operations
 * @memberOf constants
 */
export const WEBGPU_BLEND_OPERATION = {
    ADD: 'add',
    SUBTRACT: 'subtract',
    REVERSE_SUBTRACT: 'reverse-subtract',
    MIN: 'min',
    MAX: 'max'
};

/**
 * Cull modes
 * @memberOf constants
 */
export const WEBGPU_CULL_MODE = {
    NONE: 'none',
    FRONT: 'front',
    BACK: 'back'
};

/**
 * Front face
 * @memberOf constants
 */
export const WEBGPU_FRONT_FACE = {
    CCW: 'ccw',
    CW: 'cw'
};

/**
 * Load operations
 * @memberOf constants
 */
export const WEBGPU_LOAD_OP = {
    LOAD: 'load',
    CLEAR: 'clear'
};

/**
 * Store operations
 * @memberOf constants
 */
export const WEBGPU_STORE_OP = {
    STORE: 'store',
    DISCARD: 'discard'
};

/**
 * Address modes
 * @memberOf constants
 */
export const WEBGPU_ADDRESS_MODE = {
    CLAMP_TO_EDGE: 'clamp-to-edge',
    REPEAT: 'repeat',
    MIRROR_REPEAT: 'mirror-repeat'
};

/**
 * Filter modes
 * @memberOf constants
 */
export const WEBGPU_FILTER_MODE = {
    NEAREST: 'nearest',
    LINEAR: 'linear'
};

/**
 * Vertex formats
 * @memberOf constants
 */
export const WEBGPU_VERTEX_FORMAT = {
    UINT8X2: 'uint8x2',
    UINT8X4: 'uint8x4',
    SINT8X2: 'sint8x2',
    SINT8X4: 'sint8x4',
    UNORM8X2: 'unorm8x2',
    UNORM8X4: 'unorm8x4',
    SNORM8X2: 'snorm8x2',
    SNORM8X4: 'snorm8x4',
    UINT16X2: 'uint16x2',
    UINT16X4: 'uint16x4',
    SINT16X2: 'sint16x2',
    SINT16X4: 'sint16x4',
    UNORM16X2: 'unorm16x2',
    UNORM16X4: 'unorm16x4',
    SNORM16X2: 'snorm16x2',
    SNORM16X4: 'snorm16x4',
    FLOAT16X2: 'float16x2',
    FLOAT16X4: 'float16x4',
    FLOAT32: 'float32',
    FLOAT32X2: 'float32x2',
    FLOAT32X3: 'float32x3',
    FLOAT32X4: 'float32x4',
    UINT32: 'uint32',
    UINT32X2: 'uint32x2',
    UINT32X3: 'uint32x3',
    UINT32X4: 'uint32x4',
    SINT32: 'sint32',
    SINT32X2: 'sint32x2',
    SINT32X3: 'sint32x3',
    SINT32X4: 'sint32x4'
};
