import { vi, type Mock } from 'vitest';

export interface FakeWebGL2 {
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly getContext: Mock;
    call(name: string): Mock;
}

const webglConstants = {
    NONE: 0,
    ZERO: 0,
    ONE: 1,
    FALSE: 0,
    TRUE: 1,
    POINTS: 0x0000,
    LINES: 0x0001,
    LINE_LOOP: 0x0002,
    LINE_STRIP: 0x0003,
    TRIANGLES: 0x0004,
    TRIANGLE_STRIP: 0x0005,
    NEVER: 0x0200,
    LESS: 0x0201,
    EQUAL: 0x0202,
    LEQUAL: 0x0203,
    GREATER: 0x0204,
    NOTEQUAL: 0x0205,
    GEQUAL: 0x0206,
    ALWAYS: 0x0207,
    SRC_COLOR: 0x0300,
    ONE_MINUS_SRC_COLOR: 0x0301,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    DST_ALPHA: 0x0304,
    ONE_MINUS_DST_ALPHA: 0x0305,
    DST_COLOR: 0x0306,
    ONE_MINUS_DST_COLOR: 0x0307,
    SRC_ALPHA_SATURATE: 0x0308,
    FRONT: 0x0404,
    BACK: 0x0405,
    FRONT_AND_BACK: 0x0408,
    INVALID_ENUM: 0x0500,
    INVALID_VALUE: 0x0501,
    INVALID_OPERATION: 0x0502,
    OUT_OF_MEMORY: 0x0505,
    CW: 0x0900,
    CCW: 0x0901,
    LINE_WIDTH: 0x0b21,
    CULL_FACE: 0x0b44,
    BLEND: 0x0be2,
    DITHER: 0x0bd0,
    DEPTH_TEST: 0x0b71,
    STENCIL_TEST: 0x0b90,
    SCISSOR_TEST: 0x0c11,
    COLOR_BUFFER_BIT: 0x00004000,
    DEPTH_BUFFER_BIT: 0x00000100,
    STENCIL_BUFFER_BIT: 0x00000400,
    KEEP: 0x1e00,
    REPLACE: 0x1e01,
    INCR: 0x1e02,
    DECR: 0x1e03,
    INVERT: 0x150a,
    INCR_WRAP: 0x8507,
    DECR_WRAP: 0x8508,
    BYTE: 0x1400,
    UNSIGNED_BYTE: 0x1401,
    SHORT: 0x1402,
    UNSIGNED_SHORT: 0x1403,
    INT: 0x1404,
    UNSIGNED_INT: 0x1405,
    FLOAT: 0x1406,
    HALF_FLOAT: 0x140b,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    ARRAY_BUFFER_BINDING: 0x8894,
    ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    STREAM_DRAW: 0x88e0,
    COPY_READ_BUFFER: 0x8f36,
    COPY_WRITE_BUFFER: 0x8f37,
    UNIFORM_BUFFER: 0x8a11,
    UNIFORM_BUFFER_OFFSET_ALIGNMENT: 0x8a34,
    MAX_UNIFORM_BLOCK_SIZE: 0x8a30,
    MAX_UNIFORM_BUFFER_BINDINGS: 0x8a2f,
    MAX_VERTEX_UNIFORM_BLOCKS: 0x8a2b,
    MAX_FRAGMENT_UNIFORM_BLOCKS: 0x8a2d,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ACTIVE_ATTRIBUTES: 0x8b89,
    ACTIVE_UNIFORMS: 0x8b86,
    ACTIVE_UNIFORM_BLOCKS: 0x8a36,
    INVALID_INDEX: 0xffffffff,
    TEXTURE_2D: 0x0de1,
    TEXTURE_3D: 0x806f,
    TEXTURE_2D_ARRAY: 0x8c1a,
    TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_CUBE_MAP_POSITIVE_X: 0x8515,
    TEXTURE0: 0x84c0,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TEXTURE_WRAP_R: 0x8072,
    TEXTURE_COMPARE_MODE: 0x884c,
    TEXTURE_COMPARE_FUNC: 0x884d,
    COMPARE_REF_TO_TEXTURE: 0x884e,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    REPEAT: 0x2901,
    CLAMP_TO_EDGE: 0x812f,
    MIRRORED_REPEAT: 0x8370,
    RED: 0x1903,
    RG: 0x8227,
    RGB: 0x1907,
    RGBA: 0x1908,
    RED_INTEGER: 0x8d94,
    RG_INTEGER: 0x8228,
    RGBA_INTEGER: 0x8d99,
    DEPTH_COMPONENT: 0x1902,
    DEPTH_STENCIL: 0x84f9,
    STENCIL_INDEX: 0x1901,
    R8: 0x8229,
    R8_SNORM: 0x8f94,
    R8UI: 0x8232,
    R8I: 0x8231,
    R16UI: 0x8234,
    R16I: 0x8233,
    R16F: 0x822d,
    RG8: 0x822b,
    RG8_SNORM: 0x8f95,
    RG8UI: 0x8238,
    RG8I: 0x8237,
    R32UI: 0x8236,
    R32I: 0x8235,
    R32F: 0x822e,
    RG16UI: 0x823a,
    RG16I: 0x8239,
    RG16F: 0x822f,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8c43,
    RGBA8_SNORM: 0x8f97,
    RGBA8UI: 0x8d7c,
    RGBA8I: 0x8d8e,
    RGB10_A2: 0x8059,
    R11F_G11F_B10F: 0x8c3a,
    RGB9_E5: 0x8c3d,
    RG32UI: 0x823c,
    RG32I: 0x823b,
    RG32F: 0x8230,
    RGBA16UI: 0x8d76,
    RGBA16I: 0x8d88,
    RGBA16F: 0x881a,
    RGBA32UI: 0x8d70,
    RGBA32I: 0x8d82,
    RGBA32F: 0x8814,
    STENCIL_INDEX8: 0x8d48,
    DEPTH_COMPONENT16: 0x81a5,
    DEPTH_COMPONENT24: 0x81a6,
    DEPTH_COMPONENT32F: 0x8cac,
    DEPTH24_STENCIL8: 0x88f0,
    DEPTH32F_STENCIL8: 0x8cad,
    UNSIGNED_INT_24_8: 0x84fa,
    FLOAT_32_UNSIGNED_INT_24_8_REV: 0x8dad,
    FRAMEBUFFER: 0x8d40,
    READ_FRAMEBUFFER: 0x8ca8,
    DRAW_FRAMEBUFFER: 0x8ca9,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
    COLOR_ATTACHMENT0: 0x8ce0,
    DEPTH_ATTACHMENT: 0x8d00,
    STENCIL_ATTACHMENT: 0x8d20,
    DEPTH_STENCIL_ATTACHMENT: 0x821a,
    RENDERBUFFER: 0x8d41,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_3D_TEXTURE_SIZE: 0x8073,
    MAX_ARRAY_TEXTURE_LAYERS: 0x88ff,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8b4d,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8b4c,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_VERTEX_ATTRIBS: 0x8869,
    MAX_DRAW_BUFFERS: 0x8824,
    MAX_COLOR_ATTACHMENTS: 0x8cdf,
    MAX_SAMPLES: 0x8d57,
    MAX_ELEMENTS_VERTICES: 0x80e8,
    MAX_ELEMENTS_INDICES: 0x80e9,
    MAX_VARYING_VECTORS: 0x8dfc,
    FUNC_ADD: 0x8006,
    FUNC_SUBTRACT: 0x800a,
    FUNC_REVERSE_SUBTRACT: 0x800b,
    MIN: 0x8007,
    MAX: 0x8008,
    CONSTANT_COLOR: 0x8001,
    ONE_MINUS_CONSTANT_COLOR: 0x8002,
    CONSTANT_ALPHA: 0x8003,
    ONE_MINUS_CONSTANT_ALPHA: 0x8004,
    RASTERIZER_DISCARD: 0x8c89,
    POLYGON_OFFSET_FILL: 0x8037,
    NO_ERROR: 0
} as const;

const methodNames = [
    'activeTexture',
    'attachShader',
    'bindAttribLocation',
    'bindBuffer',
    'bindBufferBase',
    'bindBufferRange',
    'bindFramebuffer',
    'bindRenderbuffer',
    'bindSampler',
    'bindTexture',
    'bindVertexArray',
    'blendColor',
    'blendEquationSeparate',
    'blendFuncSeparate',
    'blitFramebuffer',
    'bufferData',
    'bufferSubData',
    'clear',
    'clearBufferfi',
    'clearBufferfv',
    'clearBufferiv',
    'clearBufferuiv',
    'clearColor',
    'clearDepth',
    'clearStencil',
    'colorMask',
    'compileShader',
    'compressedTexSubImage2D',
    'compressedTexSubImage3D',
    'copyBufferSubData',
    'copyTexSubImage2D',
    'copyTexSubImage3D',
    'cullFace',
    'deleteBuffer',
    'deleteFramebuffer',
    'deleteProgram',
    'deleteRenderbuffer',
    'deleteSampler',
    'deleteShader',
    'deleteTexture',
    'deleteVertexArray',
    'depthFunc',
    'depthMask',
    'depthRange',
    'detachShader',
    'disable',
    'disableVertexAttribArray',
    'drawArrays',
    'drawArraysInstanced',
    'drawBuffers',
    'drawElements',
    'drawElementsInstanced',
    'enable',
    'enableVertexAttribArray',
    'finish',
    'flush',
    'framebufferRenderbuffer',
    'framebufferTexture2D',
    'framebufferTextureLayer',
    'frontFace',
    'generateMipmap',
    'getBufferSubData',
    'invalidateFramebuffer',
    'lineWidth',
    'linkProgram',
    'pixelStorei',
    'polygonOffset',
    'readBuffer',
    'readPixels',
    'renderbufferStorage',
    'renderbufferStorageMultisample',
    'samplerParameterf',
    'samplerParameteri',
    'scissor',
    'shaderSource',
    'stencilFunc',
    'stencilFuncSeparate',
    'stencilMask',
    'stencilMaskSeparate',
    'stencilOp',
    'stencilOpSeparate',
    'texImage2D',
    'texImage3D',
    'texParameteri',
    'texStorage2D',
    'texStorage3D',
    'texSubImage2D',
    'texSubImage3D',
    'uniformBlockBinding',
    'uniform1i',
    'uniform1iv',
    'useProgram',
    'vertexAttribDivisor',
    'vertexAttribIPointer',
    'vertexAttribPointer',
    'viewport'
] as const;

const creationMethodNames = [
    'createBuffer',
    'createFramebuffer',
    'createProgram',
    'createRenderbuffer',
    'createSampler',
    'createShader',
    'createTexture',
    'createVertexArray'
] as const;

export function createFakeWebGL2(): FakeWebGL2 {
    const calls = new Map<string, Mock>();
    let nextObjectId = 1;
    const method = (name: string): Mock => {
        const existing = calls.get(name);
        if (existing) return existing;
        const created = vi.fn();
        calls.set(name, created);
        return created;
    };

    for (const name of methodNames) method(name);
    for (const name of creationMethodNames) {
        calls.set(
            name,
            vi.fn(() => ({ kind: name.slice('create'.length), id: nextObjectId++ }))
        );
    }
    calls.set(
        'checkFramebufferStatus',
        vi.fn(() => webglConstants.FRAMEBUFFER_COMPLETE)
    );
    calls.set(
        'getError',
        vi.fn(() => webglConstants.NO_ERROR)
    );
    calls.set(
        'getExtension',
        vi.fn((name: string) =>
            name === 'EXT_texture_filter_anisotropic'
                ? {
                      MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
                      TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe
                  }
                : null
        )
    );
    calls.set(
        'getProgramInfoLog',
        vi.fn(() => '')
    );
    calls.set(
        'getShaderInfoLog',
        vi.fn(() => '')
    );
    calls.set(
        'getShaderParameter',
        vi.fn(
            (_shader: WebGLShader, parameter: GLenum) => parameter === webglConstants.COMPILE_STATUS
        )
    );
    calls.set(
        'getProgramParameter',
        vi.fn((_program: WebGLProgram, parameter: GLenum) =>
            parameter === webglConstants.LINK_STATUS ? true : 0
        )
    );
    calls.set(
        'getActiveAttrib',
        vi.fn(() => null)
    );
    calls.set(
        'getActiveUniform',
        vi.fn(() => null)
    );
    calls.set(
        'getActiveUniformBlockName',
        vi.fn(() => null)
    );
    calls.set(
        'getAttribLocation',
        vi.fn(() => 0)
    );
    calls.set(
        'getUniformLocation',
        vi.fn(() => null)
    );
    calls.set(
        'getUniformBlockIndex',
        vi.fn(() => webglConstants.INVALID_INDEX)
    );
    calls.set(
        'getInternalformatParameter',
        vi.fn(() => new Int32Array([4]))
    );
    calls.set(
        'getParameter',
        vi.fn((parameter: GLenum) => {
            const values: Readonly<Record<number, number>> = {
                [webglConstants.MAX_TEXTURE_SIZE]: 8192,
                [webglConstants.MAX_3D_TEXTURE_SIZE]: 2048,
                [webglConstants.MAX_ARRAY_TEXTURE_LAYERS]: 256,
                [webglConstants.MAX_COMBINED_TEXTURE_IMAGE_UNITS]: 32,
                [webglConstants.MAX_VERTEX_TEXTURE_IMAGE_UNITS]: 16,
                [webglConstants.MAX_TEXTURE_IMAGE_UNITS]: 16,
                [webglConstants.MAX_UNIFORM_BUFFER_BINDINGS]: 24,
                [webglConstants.MAX_UNIFORM_BLOCK_SIZE]: 65_536,
                [webglConstants.MAX_VERTEX_UNIFORM_BLOCKS]: 12,
                [webglConstants.MAX_FRAGMENT_UNIFORM_BLOCKS]: 12,
                [webglConstants.MAX_VERTEX_ATTRIBS]: 16,
                [webglConstants.MAX_DRAW_BUFFERS]: 8,
                [webglConstants.MAX_COLOR_ATTACHMENTS]: 8,
                [webglConstants.MAX_SAMPLES]: 4,
                [webglConstants.UNIFORM_BUFFER_OFFSET_ALIGNMENT]: 256,
                [webglConstants.MAX_ELEMENTS_VERTICES]: 1_048_576,
                [webglConstants.MAX_ELEMENTS_INDICES]: 1_048_576
            };
            return values[parameter] ?? 8;
        })
    );

    const target: Record<PropertyKey, unknown> = { ...webglConstants };
    for (const [name, value] of calls) target[name] = value;
    const gl = new Proxy(target, {
        get(object, property) {
            if (Reflect.has(object, property)) return Reflect.get(object, property);
            if (typeof property !== 'string') return undefined;
            if (/^[A-Z][A-Z0-9_]*$/u.test(property)) {
                const value = 0x10000 + nextObjectId++;
                Reflect.set(object, property, value);
                return value;
            }
            const value = method(property);
            Reflect.set(object, property, value);
            return value;
        },
        has() {
            return true;
        }
    }) as unknown as WebGL2RenderingContext;

    const canvas = document.createElement('canvas');
    const getContext = vi.fn((contextId: string) => (contextId === 'webgl2' ? gl : null));
    Object.defineProperty(canvas, 'getContext', { configurable: true, value: getContext });
    Reflect.set(target, 'canvas', canvas);
    Reflect.set(target, 'drawingBufferWidth', canvas.width);
    Reflect.set(target, 'drawingBufferHeight', canvas.height);

    return { canvas, gl, getContext, call: method };
}
