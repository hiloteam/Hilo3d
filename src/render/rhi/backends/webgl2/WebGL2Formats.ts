import type {
    RHIAddressMode,
    RHIBlendFactor,
    RHIBlendOperation,
    RHICompareFunction,
    RHIPrimitiveTopology,
    RHIStencilOperation,
    RHITextureFormat,
    RHIVertexFormat
} from '../../core';

export interface WebGL2FormatInfo {
    readonly internalFormat: GLenum;
    readonly format: GLenum;
    readonly type: GLenum;
    readonly bytesPerTexel: number;
    readonly blockWidth: number;
    readonly blockHeight: number;
    readonly bytesPerBlock: number;
    readonly category:
        'color' | 'uint' | 'sint' | 'depth' | 'stencil' | 'depth-stencil' | 'compressed';
}

function scalar(
    internalFormat: GLenum,
    format: GLenum,
    type: GLenum,
    bytesPerTexel: number,
    category: WebGL2FormatInfo['category'] = 'color'
): WebGL2FormatInfo {
    return {
        internalFormat,
        format,
        type,
        bytesPerTexel,
        blockWidth: 1,
        blockHeight: 1,
        bytesPerBlock: bytesPerTexel,
        category
    };
}

function compressed(internalFormat: GLenum, bytesPerBlock: 8 | 16): WebGL2FormatInfo {
    return {
        internalFormat,
        format: 0,
        type: 0,
        bytesPerTexel: 0,
        blockWidth: 4,
        blockHeight: 4,
        bytesPerBlock,
        category: 'compressed'
    };
}

/** Native mappings kept inside the WebGL2 hardware boundary. */
export function webGL2FormatInfo(
    gl: WebGL2RenderingContext,
    format: RHITextureFormat
): WebGL2FormatInfo {
    switch (format) {
        case 'r8unorm':
            return scalar(gl.R8, gl.RED, gl.UNSIGNED_BYTE, 1);
        case 'r8snorm':
            return scalar(gl.R8_SNORM, gl.RED, gl.BYTE, 1);
        case 'r8uint':
            return scalar(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 1, 'uint');
        case 'r8sint':
            return scalar(gl.R8I, gl.RED_INTEGER, gl.BYTE, 1, 'sint');
        case 'r16uint':
            return scalar(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, 2, 'uint');
        case 'r16sint':
            return scalar(gl.R16I, gl.RED_INTEGER, gl.SHORT, 2, 'sint');
        case 'r16float':
            return scalar(gl.R16F, gl.RED, gl.HALF_FLOAT, 2);
        case 'rg8unorm':
            return scalar(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, 2);
        case 'rg8snorm':
            return scalar(gl.RG8_SNORM, gl.RG, gl.BYTE, 2);
        case 'rg8uint':
            return scalar(gl.RG8UI, gl.RG_INTEGER, gl.UNSIGNED_BYTE, 2, 'uint');
        case 'rg8sint':
            return scalar(gl.RG8I, gl.RG_INTEGER, gl.BYTE, 2, 'sint');
        case 'r32uint':
            return scalar(gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, 4, 'uint');
        case 'r32sint':
            return scalar(gl.R32I, gl.RED_INTEGER, gl.INT, 4, 'sint');
        case 'r32float':
            return scalar(gl.R32F, gl.RED, gl.FLOAT, 4);
        case 'rg16uint':
            return scalar(gl.RG16UI, gl.RG_INTEGER, gl.UNSIGNED_SHORT, 4, 'uint');
        case 'rg16sint':
            return scalar(gl.RG16I, gl.RG_INTEGER, gl.SHORT, 4, 'sint');
        case 'rg16float':
            return scalar(gl.RG16F, gl.RG, gl.HALF_FLOAT, 4);
        case 'rgba8unorm':
        case 'bgra8unorm':
            return scalar(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 4);
        case 'rgba8unorm-srgb':
        case 'bgra8unorm-srgb':
            return scalar(gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, 4);
        case 'rgba8snorm':
            return scalar(gl.RGBA8_SNORM, gl.RGBA, gl.BYTE, 4);
        case 'rgba8uint':
            return scalar(gl.RGBA8UI, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, 4, 'uint');
        case 'rgba8sint':
            return scalar(gl.RGBA8I, gl.RGBA_INTEGER, gl.BYTE, 4, 'sint');
        case 'rgb10a2unorm':
            return scalar(gl.RGB10_A2, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, 4);
        case 'rgb10a2uint':
            return scalar(
                gl.RGB10_A2UI,
                gl.RGBA_INTEGER,
                gl.UNSIGNED_INT_2_10_10_10_REV,
                4,
                'uint'
            );
        case 'rg11b10ufloat':
            return scalar(gl.R11F_G11F_B10F, gl.RGB, gl.UNSIGNED_INT_10F_11F_11F_REV, 4);
        case 'rgb9e5ufloat':
            return scalar(gl.RGB9_E5, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, 4);
        case 'rg32uint':
            return scalar(gl.RG32UI, gl.RG_INTEGER, gl.UNSIGNED_INT, 8, 'uint');
        case 'rg32sint':
            return scalar(gl.RG32I, gl.RG_INTEGER, gl.INT, 8, 'sint');
        case 'rg32float':
            return scalar(gl.RG32F, gl.RG, gl.FLOAT, 8);
        case 'rgba16uint':
            return scalar(gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, 8, 'uint');
        case 'rgba16sint':
            return scalar(gl.RGBA16I, gl.RGBA_INTEGER, gl.SHORT, 8, 'sint');
        case 'rgba16float':
            return scalar(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, 8);
        case 'rgba32uint':
            return scalar(gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 16, 'uint');
        case 'rgba32sint':
            return scalar(gl.RGBA32I, gl.RGBA_INTEGER, gl.INT, 16, 'sint');
        case 'rgba32float':
            return scalar(gl.RGBA32F, gl.RGBA, gl.FLOAT, 16);
        case 'stencil8':
            return scalar(gl.STENCIL_INDEX8, 0x1901, gl.UNSIGNED_BYTE, 1, 'stencil');
        case 'depth16unorm':
            return scalar(gl.DEPTH_COMPONENT16, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, 2, 'depth');
        case 'depth24plus':
            return scalar(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, 4, 'depth');
        case 'depth24plus-stencil8':
            return scalar(
                gl.DEPTH24_STENCIL8,
                gl.DEPTH_STENCIL,
                gl.UNSIGNED_INT_24_8,
                4,
                'depth-stencil'
            );
        case 'depth32float':
            return scalar(gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT, gl.FLOAT, 4, 'depth');
        case 'depth32float-stencil8':
            return scalar(
                gl.DEPTH32F_STENCIL8,
                gl.DEPTH_STENCIL,
                gl.FLOAT_32_UNSIGNED_INT_24_8_REV,
                8,
                'depth-stencil'
            );
        case 'bc1-rgba-unorm':
            return compressed(0x83f1, 8);
        case 'bc1-rgba-unorm-srgb':
            return compressed(0x8c4d, 8);
        case 'bc2-rgba-unorm':
            return compressed(0x83f2, 16);
        case 'bc2-rgba-unorm-srgb':
            return compressed(0x8c4e, 16);
        case 'bc3-rgba-unorm':
            return compressed(0x83f3, 16);
        case 'bc3-rgba-unorm-srgb':
            return compressed(0x8c4f, 16);
        case 'eac-r11unorm':
            return compressed(0x9270, 8);
        case 'eac-r11snorm':
            return compressed(0x9271, 8);
        case 'eac-rg11unorm':
            return compressed(0x9272, 16);
        case 'eac-rg11snorm':
            return compressed(0x9273, 16);
        case 'etc2-rgb8unorm':
            return compressed(0x9274, 8);
        case 'etc2-rgb8unorm-srgb':
            return compressed(0x9275, 8);
        case 'etc2-rgb8a1unorm':
            return compressed(0x9276, 8);
        case 'etc2-rgb8a1unorm-srgb':
            return compressed(0x9277, 8);
        case 'etc2-rgba8unorm':
            return compressed(0x9278, 16);
        case 'etc2-rgba8unorm-srgb':
            return compressed(0x9279, 16);
        case 'astc-4x4-unorm':
            return compressed(0x93b0, 16);
        case 'astc-4x4-unorm-srgb':
            return compressed(0x93d0, 16);
    }
}

export interface WebGL2VertexFormatInfo {
    readonly components: number;
    readonly type: GLenum;
    readonly normalized: boolean;
    readonly integer: boolean;
    readonly bytes: number;
}

export function webGL2VertexFormatInfo(
    gl: WebGL2RenderingContext,
    format: RHIVertexFormat
): WebGL2VertexFormatInfo {
    const info = (
        components: number,
        type: GLenum,
        bytes: number,
        normalized = false,
        integer = false
    ): WebGL2VertexFormatInfo => ({ components, type, normalized, integer, bytes });
    switch (format) {
        case 'uint8x2':
            return info(2, gl.UNSIGNED_BYTE, 2, false, true);
        case 'uint8x4':
            return info(4, gl.UNSIGNED_BYTE, 4, false, true);
        case 'sint8x2':
            return info(2, gl.BYTE, 2, false, true);
        case 'sint8x4':
            return info(4, gl.BYTE, 4, false, true);
        case 'unorm8x2':
            return info(2, gl.UNSIGNED_BYTE, 2, true);
        case 'unorm8x4':
            return info(4, gl.UNSIGNED_BYTE, 4, true);
        case 'snorm8x2':
            return info(2, gl.BYTE, 2, true);
        case 'snorm8x4':
            return info(4, gl.BYTE, 4, true);
        case 'uint16x2':
            return info(2, gl.UNSIGNED_SHORT, 4, false, true);
        case 'uint16x4':
            return info(4, gl.UNSIGNED_SHORT, 8, false, true);
        case 'sint16x2':
            return info(2, gl.SHORT, 4, false, true);
        case 'sint16x4':
            return info(4, gl.SHORT, 8, false, true);
        case 'unorm16x2':
            return info(2, gl.UNSIGNED_SHORT, 4, true);
        case 'unorm16x4':
            return info(4, gl.UNSIGNED_SHORT, 8, true);
        case 'snorm16x2':
            return info(2, gl.SHORT, 4, true);
        case 'snorm16x4':
            return info(4, gl.SHORT, 8, true);
        case 'float16x2':
            return info(2, gl.HALF_FLOAT, 4);
        case 'float16x4':
            return info(4, gl.HALF_FLOAT, 8);
        case 'float32':
            return info(1, gl.FLOAT, 4);
        case 'float32x2':
            return info(2, gl.FLOAT, 8);
        case 'float32x3':
            return info(3, gl.FLOAT, 12);
        case 'float32x4':
            return info(4, gl.FLOAT, 16);
        case 'uint32':
            return info(1, gl.UNSIGNED_INT, 4, false, true);
        case 'uint32x2':
            return info(2, gl.UNSIGNED_INT, 8, false, true);
        case 'uint32x3':
            return info(3, gl.UNSIGNED_INT, 12, false, true);
        case 'uint32x4':
            return info(4, gl.UNSIGNED_INT, 16, false, true);
        case 'sint32':
            return info(1, gl.INT, 4, false, true);
        case 'sint32x2':
            return info(2, gl.INT, 8, false, true);
        case 'sint32x3':
            return info(3, gl.INT, 12, false, true);
        case 'sint32x4':
            return info(4, gl.INT, 16, false, true);
    }
}

export function webGL2Topology(gl: WebGL2RenderingContext, value: RHIPrimitiveTopology): GLenum {
    switch (value) {
        case 'point-list':
            return gl.POINTS;
        case 'line-list':
            return gl.LINES;
        case 'line-strip':
            return gl.LINE_STRIP;
        case 'triangle-list':
            return gl.TRIANGLES;
        case 'triangle-strip':
            return gl.TRIANGLE_STRIP;
    }
}

export function webGL2Compare(gl: WebGL2RenderingContext, value: RHICompareFunction): GLenum {
    switch (value) {
        case 'never':
            return gl.NEVER;
        case 'less':
            return gl.LESS;
        case 'equal':
            return gl.EQUAL;
        case 'less-equal':
            return gl.LEQUAL;
        case 'greater':
            return gl.GREATER;
        case 'not-equal':
            return gl.NOTEQUAL;
        case 'greater-equal':
            return gl.GEQUAL;
        case 'always':
            return gl.ALWAYS;
    }
}

export function webGL2StencilOp(gl: WebGL2RenderingContext, value: RHIStencilOperation): GLenum {
    switch (value) {
        case 'keep':
            return gl.KEEP;
        case 'zero':
            return gl.ZERO;
        case 'replace':
            return gl.REPLACE;
        case 'invert':
            return gl.INVERT;
        case 'increment-clamp':
            return gl.INCR;
        case 'decrement-clamp':
            return gl.DECR;
        case 'increment-wrap':
            return gl.INCR_WRAP;
        case 'decrement-wrap':
            return gl.DECR_WRAP;
    }
}

export function webGL2BlendFactor(gl: WebGL2RenderingContext, value: RHIBlendFactor): GLenum {
    switch (value) {
        case 'zero':
            return gl.ZERO;
        case 'one':
            return gl.ONE;
        case 'src':
            return gl.SRC_COLOR;
        case 'one-minus-src':
            return gl.ONE_MINUS_SRC_COLOR;
        case 'src-alpha':
            return gl.SRC_ALPHA;
        case 'one-minus-src-alpha':
            return gl.ONE_MINUS_SRC_ALPHA;
        case 'dst':
            return gl.DST_COLOR;
        case 'one-minus-dst':
            return gl.ONE_MINUS_DST_COLOR;
        case 'dst-alpha':
            return gl.DST_ALPHA;
        case 'one-minus-dst-alpha':
            return gl.ONE_MINUS_DST_ALPHA;
        case 'src-alpha-saturated':
            return gl.SRC_ALPHA_SATURATE;
        case 'constant':
            return gl.CONSTANT_COLOR;
        case 'one-minus-constant':
            return gl.ONE_MINUS_CONSTANT_COLOR;
    }
}

export function webGL2BlendOperation(gl: WebGL2RenderingContext, value: RHIBlendOperation): GLenum {
    switch (value) {
        case 'add':
            return gl.FUNC_ADD;
        case 'subtract':
            return gl.FUNC_SUBTRACT;
        case 'reverse-subtract':
            return gl.FUNC_REVERSE_SUBTRACT;
        case 'min':
            return gl.MIN;
        case 'max':
            return gl.MAX;
    }
}

export function webGL2AddressMode(gl: WebGL2RenderingContext, value: RHIAddressMode): GLenum {
    switch (value) {
        case 'clamp-to-edge':
            return gl.CLAMP_TO_EDGE;
        case 'repeat':
            return gl.REPEAT;
        case 'mirror-repeat':
            return gl.MIRRORED_REPEAT;
    }
}
