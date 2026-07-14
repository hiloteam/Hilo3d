import type {
    RHIAddressMode,
    RHIBlendFactor,
    RHIBlendOperation,
    RHICompareFunction,
    RHIPrimitiveTopology,
    RHIStencilOperation,
    RHITextureFormat,
    RHITextureFormatCapabilities,
    RHIVertexFormat
} from '../RHI';

export interface WebGLFormatInfo {
    readonly internalFormat: GLenum;
    readonly format: GLenum;
    readonly type: GLenum;
    readonly bytesPerBlock: number;
    readonly blockWidth: number;
    readonly blockHeight: number;
    readonly kind: 'float' | 'sint' | 'uint' | 'depth' | 'stencil' | 'depth-stencil' | 'compressed';
}

export interface CompressedTextureExtensions {
    readonly bc: WEBGL_compressed_texture_s3tc | null;
    readonly bcSrgb: WEBGL_compressed_texture_s3tc_srgb | null;
    readonly etc: WEBGL_compressed_texture_etc | null;
    readonly astc: WEBGL_compressed_texture_astc | null;
}

export function compressedExtensions(gl: WebGL2RenderingContext): CompressedTextureExtensions {
    return {
        bc: gl.getExtension('WEBGL_compressed_texture_s3tc'),
        bcSrgb: gl.getExtension('WEBGL_compressed_texture_s3tc_srgb'),
        etc: gl.getExtension('WEBGL_compressed_texture_etc'),
        astc: gl.getExtension('WEBGL_compressed_texture_astc')
    };
}

export function formatInfo(
    gl: WebGL2RenderingContext,
    extensions: CompressedTextureExtensions,
    format: RHITextureFormat
): WebGLFormatInfo {
    const scalar = (
        internalFormat: GLenum,
        pixelFormat: GLenum,
        type: GLenum,
        bytesPerBlock: number,
        kind: WebGLFormatInfo['kind']
    ): WebGLFormatInfo => ({
        internalFormat,
        format: pixelFormat,
        type,
        bytesPerBlock,
        blockWidth: 1,
        blockHeight: 1,
        kind
    });
    const compressed = (internalFormat: GLenum, bytesPerBlock: number): WebGLFormatInfo => ({
        internalFormat,
        format: internalFormat,
        type: gl.UNSIGNED_BYTE,
        bytesPerBlock,
        blockWidth: 4,
        blockHeight: 4,
        kind: 'compressed'
    });
    switch (format) {
        case 'r8unorm':
            return scalar(gl.R8, gl.RED, gl.UNSIGNED_BYTE, 1, 'float');
        case 'r8snorm':
            return scalar(gl.R8_SNORM, gl.RED, gl.BYTE, 1, 'float');
        case 'r8uint':
            return scalar(gl.R8UI, gl.RED_INTEGER, gl.UNSIGNED_BYTE, 1, 'uint');
        case 'r8sint':
            return scalar(gl.R8I, gl.RED_INTEGER, gl.BYTE, 1, 'sint');
        case 'r16uint':
            return scalar(gl.R16UI, gl.RED_INTEGER, gl.UNSIGNED_SHORT, 2, 'uint');
        case 'r16sint':
            return scalar(gl.R16I, gl.RED_INTEGER, gl.SHORT, 2, 'sint');
        case 'r16float':
            return scalar(gl.R16F, gl.RED, gl.HALF_FLOAT, 2, 'float');
        case 'rg8unorm':
            return scalar(gl.RG8, gl.RG, gl.UNSIGNED_BYTE, 2, 'float');
        case 'rg8snorm':
            return scalar(gl.RG8_SNORM, gl.RG, gl.BYTE, 2, 'float');
        case 'rg8uint':
            return scalar(gl.RG8UI, gl.RG_INTEGER, gl.UNSIGNED_BYTE, 2, 'uint');
        case 'rg8sint':
            return scalar(gl.RG8I, gl.RG_INTEGER, gl.BYTE, 2, 'sint');
        case 'r32uint':
            return scalar(gl.R32UI, gl.RED_INTEGER, gl.UNSIGNED_INT, 4, 'uint');
        case 'r32sint':
            return scalar(gl.R32I, gl.RED_INTEGER, gl.INT, 4, 'sint');
        case 'r32float':
            return scalar(gl.R32F, gl.RED, gl.FLOAT, 4, 'float');
        case 'rg16uint':
            return scalar(gl.RG16UI, gl.RG_INTEGER, gl.UNSIGNED_SHORT, 4, 'uint');
        case 'rg16sint':
            return scalar(gl.RG16I, gl.RG_INTEGER, gl.SHORT, 4, 'sint');
        case 'rg16float':
            return scalar(gl.RG16F, gl.RG, gl.HALF_FLOAT, 4, 'float');
        case 'rgba8unorm':
        case 'bgra8unorm':
            return scalar(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 4, 'float');
        case 'rgba8unorm-srgb':
        case 'bgra8unorm-srgb':
            return scalar(gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, 4, 'float');
        case 'rgba8snorm':
            return scalar(gl.RGBA8_SNORM, gl.RGBA, gl.BYTE, 4, 'float');
        case 'rgba8uint':
            return scalar(gl.RGBA8UI, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, 4, 'uint');
        case 'rgba8sint':
            return scalar(gl.RGBA8I, gl.RGBA_INTEGER, gl.BYTE, 4, 'sint');
        case 'rgb10a2unorm':
            return scalar(gl.RGB10_A2, gl.RGBA, gl.UNSIGNED_INT_2_10_10_10_REV, 4, 'float');
        case 'rgb10a2uint':
            return scalar(
                gl.RGB10_A2UI,
                gl.RGBA_INTEGER,
                gl.UNSIGNED_INT_2_10_10_10_REV,
                4,
                'uint'
            );
        case 'rg11b10ufloat':
            return scalar(gl.R11F_G11F_B10F, gl.RGB, gl.UNSIGNED_INT_10F_11F_11F_REV, 4, 'float');
        case 'rgb9e5ufloat':
            return scalar(gl.RGB9_E5, gl.RGB, gl.UNSIGNED_INT_5_9_9_9_REV, 4, 'float');
        case 'rg32uint':
            return scalar(gl.RG32UI, gl.RG_INTEGER, gl.UNSIGNED_INT, 8, 'uint');
        case 'rg32sint':
            return scalar(gl.RG32I, gl.RG_INTEGER, gl.INT, 8, 'sint');
        case 'rg32float':
            return scalar(gl.RG32F, gl.RG, gl.FLOAT, 8, 'float');
        case 'rgba16uint':
            return scalar(gl.RGBA16UI, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, 8, 'uint');
        case 'rgba16sint':
            return scalar(gl.RGBA16I, gl.RGBA_INTEGER, gl.SHORT, 8, 'sint');
        case 'rgba16float':
            return scalar(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, 8, 'float');
        case 'rgba32uint':
            return scalar(gl.RGBA32UI, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 16, 'uint');
        case 'rgba32sint':
            return scalar(gl.RGBA32I, gl.RGBA_INTEGER, gl.INT, 16, 'sint');
        case 'rgba32float':
            return scalar(gl.RGBA32F, gl.RGBA, gl.FLOAT, 16, 'float');
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
        case 'bc1-rgba-unorm': {
            if (!extensions.bc) throw new Error('texture-compression-bc is unavailable');
            return compressed(extensions.bc.COMPRESSED_RGBA_S3TC_DXT1_EXT, 8);
        }
        case 'bc2-rgba-unorm': {
            if (!extensions.bc) throw new Error('texture-compression-bc is unavailable');
            return compressed(extensions.bc.COMPRESSED_RGBA_S3TC_DXT3_EXT, 16);
        }
        case 'bc3-rgba-unorm': {
            if (!extensions.bc) throw new Error('texture-compression-bc is unavailable');
            return compressed(extensions.bc.COMPRESSED_RGBA_S3TC_DXT5_EXT, 16);
        }
        case 'bc1-rgba-unorm-srgb': {
            if (!extensions.bcSrgb) throw new Error('texture-compression-bc is unavailable');
            return compressed(extensions.bcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT, 8);
        }
        case 'bc2-rgba-unorm-srgb': {
            if (!extensions.bcSrgb) throw new Error('texture-compression-bc is unavailable');
            return compressed(extensions.bcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT, 16);
        }
        case 'bc3-rgba-unorm-srgb': {
            if (!extensions.bcSrgb) throw new Error('texture-compression-bc is unavailable');
            return compressed(extensions.bcSrgb.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT, 16);
        }
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
        case 'eac-r11unorm':
            return compressed(0x9270, 8);
        case 'eac-r11snorm':
            return compressed(0x9271, 8);
        case 'eac-rg11unorm':
            return compressed(0x9272, 16);
        case 'eac-rg11snorm':
            return compressed(0x9273, 16);
        case 'astc-4x4-unorm': {
            if (!extensions.astc) throw new Error('texture-compression-astc is unavailable');
            return compressed(extensions.astc.COMPRESSED_RGBA_ASTC_4x4_KHR, 16);
        }
        case 'astc-4x4-unorm-srgb': {
            if (!extensions.astc) throw new Error('texture-compression-astc is unavailable');
            return compressed(extensions.astc.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR, 16);
        }
    }
}

function isFloat32Format(format: RHITextureFormat): boolean {
    return (
        format === 'r32float' ||
        format === 'rg32float' ||
        format === 'rgba32float' ||
        format === 'depth32float' ||
        format === 'depth32float-stencil8'
    );
}

function requiresColorBufferFloat(format: RHITextureFormat): boolean {
    switch (format) {
        case 'r16float':
        case 'rg16float':
        case 'r32float':
        case 'rg32float':
        case 'rgba16float':
        case 'rgba32float':
        case 'rg11b10ufloat':
            return true;
        default:
            return false;
    }
}

function isCoreColorRenderable(format: RHITextureFormat): boolean {
    switch (format) {
        case 'r8unorm':
        case 'r8uint':
        case 'r8sint':
        case 'r16uint':
        case 'r16sint':
        case 'rg8unorm':
        case 'rg8uint':
        case 'rg8sint':
        case 'r32uint':
        case 'r32sint':
        case 'rg16uint':
        case 'rg16sint':
        case 'rgba8unorm':
        case 'rgba8unorm-srgb':
        case 'rgba8uint':
        case 'rgba8sint':
        case 'rgb10a2unorm':
        case 'rgb10a2uint':
        case 'rg32uint':
        case 'rg32sint':
        case 'rgba16uint':
        case 'rgba16sint':
        case 'rgba32uint':
        case 'rgba32sint':
            return true;
        default:
            return false;
    }
}

function isDepthStencilRenderable(format: RHITextureFormat): boolean {
    return (
        format === 'stencil8' ||
        format === 'depth16unorm' ||
        format === 'depth24plus' ||
        format === 'depth24plus-stencil8' ||
        format === 'depth32float' ||
        format === 'depth32float-stencil8'
    );
}

function renderSampleCounts(gl: WebGL2RenderingContext, internalFormat: GLenum): readonly number[] {
    const counts = new Set<number>([1]);
    try {
        const native = gl.getInternalformatParameter(
            gl.RENDERBUFFER,
            internalFormat,
            gl.SAMPLES
        ) as ArrayLike<number> | number | null;
        if (typeof native === 'number') {
            if (Number.isSafeInteger(native) && native > 1) counts.add(native);
        } else if (native) {
            for (const count of Array.from(native)) {
                if (Number.isSafeInteger(count) && count > 1) counts.add(count);
            }
        }
    } catch {
        // Some implementations throw for valid single-sampled formats with no MSAA support.
    }
    return Object.freeze([...counts].sort((left, right) => left - right));
}

/** Queries WebGL's actually exposed portable capabilities for one RHI format. */
export function webGLFormatCapabilities(
    gl: WebGL2RenderingContext,
    extensions: CompressedTextureExtensions,
    colorBufferFloat: boolean,
    float32Linear: boolean,
    format: RHITextureFormat
): RHITextureFormatCapabilities {
    if (format === 'bgra8unorm' || format === 'bgra8unorm-srgb') {
        return Object.freeze({
            sampled: false,
            filterable: false,
            renderable: false,
            storage: false,
            sampleCounts: Object.freeze([])
        });
    }
    let info: WebGLFormatInfo;
    try {
        info = formatInfo(gl, extensions, format);
    } catch {
        return Object.freeze({
            sampled: false,
            filterable: false,
            renderable: false,
            storage: false,
            sampleCounts: Object.freeze([])
        });
    }
    const sampled = format !== 'stencil8';
    const filterable =
        sampled &&
        info.kind !== 'sint' &&
        info.kind !== 'uint' &&
        (!isFloat32Format(format) || float32Linear);
    const renderable =
        isCoreColorRenderable(format) ||
        isDepthStencilRenderable(format) ||
        (colorBufferFloat && requiresColorBufferFloat(format));
    return Object.freeze({
        sampled,
        filterable,
        renderable,
        storage: false,
        sampleCounts: renderable ? renderSampleCounts(gl, info.internalFormat) : Object.freeze([])
    });
}

export function compareFunction(gl: WebGL2RenderingContext, compare: RHICompareFunction): GLenum {
    switch (compare) {
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

export function addressMode(gl: WebGL2RenderingContext, mode: RHIAddressMode): GLenum {
    switch (mode) {
        case 'clamp-to-edge':
            return gl.CLAMP_TO_EDGE;
        case 'repeat':
            return gl.REPEAT;
        case 'mirror-repeat':
            return gl.MIRRORED_REPEAT;
    }
}

export function stencilOperation(
    gl: WebGL2RenderingContext,
    operation: RHIStencilOperation
): GLenum {
    switch (operation) {
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

export function primitiveTopology(
    gl: WebGL2RenderingContext,
    topology: RHIPrimitiveTopology
): GLenum {
    switch (topology) {
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

export function blendFactor(gl: WebGL2RenderingContext, factor: RHIBlendFactor): GLenum {
    switch (factor) {
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

export function blendOperation(gl: WebGL2RenderingContext, operation: RHIBlendOperation): GLenum {
    switch (operation) {
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

interface VertexFormatInfo {
    readonly components: number;
    readonly type: GLenum;
    readonly normalized: boolean;
    readonly integer: boolean;
    readonly bytes: number;
}

export function vertexFormatInfo(
    gl: WebGL2RenderingContext,
    format: RHIVertexFormat
): VertexFormatInfo {
    const result = (
        components: number,
        type: GLenum,
        normalized: boolean,
        integer: boolean,
        bytes: number
    ): VertexFormatInfo => ({ components, type, normalized, integer, bytes });
    switch (format) {
        case 'uint8x2':
            return result(2, gl.UNSIGNED_BYTE, false, true, 2);
        case 'uint8x4':
            return result(4, gl.UNSIGNED_BYTE, false, true, 4);
        case 'sint8x2':
            return result(2, gl.BYTE, false, true, 2);
        case 'sint8x4':
            return result(4, gl.BYTE, false, true, 4);
        case 'unorm8x2':
            return result(2, gl.UNSIGNED_BYTE, true, false, 2);
        case 'unorm8x4':
            return result(4, gl.UNSIGNED_BYTE, true, false, 4);
        case 'snorm8x2':
            return result(2, gl.BYTE, true, false, 2);
        case 'snorm8x4':
            return result(4, gl.BYTE, true, false, 4);
        case 'uint16x2':
            return result(2, gl.UNSIGNED_SHORT, false, true, 4);
        case 'uint16x4':
            return result(4, gl.UNSIGNED_SHORT, false, true, 8);
        case 'sint16x2':
            return result(2, gl.SHORT, false, true, 4);
        case 'sint16x4':
            return result(4, gl.SHORT, false, true, 8);
        case 'unorm16x2':
            return result(2, gl.UNSIGNED_SHORT, true, false, 4);
        case 'unorm16x4':
            return result(4, gl.UNSIGNED_SHORT, true, false, 8);
        case 'snorm16x2':
            return result(2, gl.SHORT, true, false, 4);
        case 'snorm16x4':
            return result(4, gl.SHORT, true, false, 8);
        case 'float16x2':
            return result(2, gl.HALF_FLOAT, false, false, 4);
        case 'float16x4':
            return result(4, gl.HALF_FLOAT, false, false, 8);
        case 'float32':
            return result(1, gl.FLOAT, false, false, 4);
        case 'float32x2':
            return result(2, gl.FLOAT, false, false, 8);
        case 'float32x3':
            return result(3, gl.FLOAT, false, false, 12);
        case 'float32x4':
            return result(4, gl.FLOAT, false, false, 16);
        case 'uint32':
            return result(1, gl.UNSIGNED_INT, false, true, 4);
        case 'uint32x2':
            return result(2, gl.UNSIGNED_INT, false, true, 8);
        case 'uint32x3':
            return result(3, gl.UNSIGNED_INT, false, true, 12);
        case 'uint32x4':
            return result(4, gl.UNSIGNED_INT, false, true, 16);
        case 'sint32':
            return result(1, gl.INT, false, true, 4);
        case 'sint32x2':
            return result(2, gl.INT, false, true, 8);
        case 'sint32x3':
            return result(3, gl.INT, false, true, 12);
        case 'sint32x4':
            return result(4, gl.INT, false, true, 16);
    }
}

/** Concrete WebGL buffer wrapper. Its native handle is exposed only for backend migration code. */
