import type {
    RHICapabilities,
    RHIFeatureName,
    RHILimits,
    RHITextureFormat,
    RHITextureFormatCapabilities
} from '../../core';
import { webGL2FormatInfo } from './WebGL2Formats';

const COLOR_RENDERABLE = new Set<RHITextureFormat>([
    'r8unorm',
    'r8uint',
    'r8sint',
    'r16uint',
    'r16sint',
    'rg8unorm',
    'rg8uint',
    'rg8sint',
    'rgba8unorm',
    'rgba8unorm-srgb',
    'rgba8uint',
    'rgba8sint',
    'bgra8unorm',
    'bgra8unorm-srgb',
    'rgb10a2unorm',
    'rgb10a2uint'
]);
const FLOAT_COLOR = new Set<RHITextureFormat>([
    'r16float',
    'rg16float',
    'r32float',
    'rg32float',
    'rgba16float',
    'rgba32float',
    'rg11b10ufloat'
]);
const DEPTH_STENCIL = new Set<RHITextureFormat>([
    'stencil8',
    'depth16unorm',
    'depth24plus',
    'depth24plus-stencil8',
    'depth32float',
    'depth32float-stencil8'
]);

function glLimit(gl: WebGL2RenderingContext, name: GLenum, fallback: number): number {
    const value: unknown = gl.getParameter(name);
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Immutable WebGL2 capability snapshot consumed by the portable validation layer. */
export class WebGL2Capabilities implements RHICapabilities {
    readonly features: ReadonlySet<RHIFeatureName>;
    readonly limits: Readonly<RHILimits>;
    readonly #colorBufferFloat: boolean;
    readonly #floatLinear: boolean;
    readonly #floatBlend: boolean;
    readonly #bc: boolean;
    readonly #bcSRGB: boolean;
    readonly #etc: boolean;
    readonly #astc: boolean;
    readonly #formats = new Map<RHITextureFormat, RHITextureFormatCapabilities>();

    constructor(private readonly gl: WebGL2RenderingContext) {
        const features = new Set<RHIFeatureName>();
        features.add('buffer-mapping');
        this.#colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
        this.#floatLinear = gl.getExtension('OES_texture_float_linear') !== null;
        this.#floatBlend = gl.getExtension('EXT_float_blend') !== null;
        this.#bc =
            gl.getExtension('WEBGL_compressed_texture_s3tc') !== null ||
            gl.getExtension('MOZ_WEBGL_compressed_texture_s3tc') !== null ||
            gl.getExtension('WEBKIT_WEBGL_compressed_texture_s3tc') !== null;
        this.#bcSRGB = gl.getExtension('WEBGL_compressed_texture_s3tc_srgb') !== null;
        this.#etc = gl.getExtension('WEBGL_compressed_texture_etc') !== null;
        this.#astc = gl.getExtension('WEBGL_compressed_texture_astc') !== null;
        if (gl.getExtension('EXT_texture_filter_anisotropic') !== null)
            features.add('anisotropic-filtering');
        if (this.#floatLinear) features.add('float32-filterable');
        if (this.#floatBlend) features.add('float32-blendable');
        if (this.#bc && this.#bcSRGB) features.add('texture-compression-bc');
        if (this.#etc) features.add('texture-compression-etc2');
        if (this.#astc) features.add('texture-compression-astc');
        this.features = features;
        const maxTextureUnits = glLimit(gl, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, 16);
        this.limits = Object.freeze({
            maxTextureDimension2D: glLimit(gl, gl.MAX_TEXTURE_SIZE, 2048),
            maxTextureDimension3D: glLimit(gl, gl.MAX_3D_TEXTURE_SIZE, 256),
            maxTextureArrayLayers: glLimit(gl, gl.MAX_ARRAY_TEXTURE_LAYERS, 256),
            maxBindGroups: 4,
            maxBindingsPerBindGroup: Math.max(16, maxTextureUnits),
            maxDynamicUniformBuffersPerPipelineLayout: glLimit(
                gl,
                gl.MAX_UNIFORM_BUFFER_BINDINGS,
                12
            ),
            maxSampledTexturesPerShaderStage: glLimit(gl, gl.MAX_TEXTURE_IMAGE_UNITS, 16),
            maxSamplersPerShaderStage: glLimit(gl, gl.MAX_TEXTURE_IMAGE_UNITS, 16),
            maxUniformBuffersPerShaderStage: Math.min(
                glLimit(gl, gl.MAX_VERTEX_UNIFORM_BLOCKS, 12),
                glLimit(gl, gl.MAX_FRAGMENT_UNIFORM_BLOCKS, 12)
            ),
            maxUniformBufferBindingSize: glLimit(gl, gl.MAX_UNIFORM_BLOCK_SIZE, 16_384),
            maxVertexBuffers: glLimit(gl, gl.MAX_VERTEX_ATTRIBS, 16),
            maxBufferSize: 0x7fffffff,
            maxVertexAttributes: glLimit(gl, gl.MAX_VERTEX_ATTRIBS, 16),
            maxVertexBufferArrayStride: 2048,
            minUniformBufferOffsetAlignment: glLimit(gl, gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT, 256),
            maxColorAttachments: glLimit(gl, gl.MAX_COLOR_ATTACHMENTS, 4)
        });
    }

    getTextureFormatCapabilities(format: RHITextureFormat): RHITextureFormatCapabilities {
        const cached = this.#formats.get(format);
        if (cached !== undefined) return cached;
        const compressed =
            format.startsWith('bc') ||
            format.startsWith('astc') ||
            format.startsWith('etc2') ||
            format.startsWith('eac');
        const compressedAvailable = format.startsWith('bc')
            ? this.#bc && (!format.endsWith('-srgb') || this.#bcSRGB)
            : format.startsWith('astc')
              ? this.#astc
              : (format.startsWith('etc2') || format.startsWith('eac')) && this.#etc;
        const renderable =
            COLOR_RENDERABLE.has(format) ||
            DEPTH_STENCIL.has(format) ||
            (this.#colorBufferFloat && FLOAT_COLOR.has(format));
        const integer = format.endsWith('uint') || format.endsWith('sint');
        const float32 = format === 'r32float' || format === 'rg32float' || format === 'rgba32float';
        const sampled = compressed ? compressedAvailable : format !== 'stencil8';
        const filterable = sampled && !integer && (!float32 || this.#floatLinear);
        const sampleCounts = new Set<number>();
        if (renderable) {
            sampleCounts.add(1);
            try {
                const info = webGL2FormatInfo(this.gl, format);
                const native: unknown = this.gl.getInternalformatParameter(
                    this.gl.RENDERBUFFER,
                    info.internalFormat,
                    this.gl.SAMPLES
                );
                if (typeof native === 'number') {
                    if (Number.isSafeInteger(native) && native > 1) sampleCounts.add(native);
                } else if (native !== null && typeof native === 'object' && 'length' in native) {
                    const values = native as ArrayLike<unknown>;
                    for (const count of Array.from(values)) {
                        if (typeof count === 'number' && Number.isSafeInteger(count) && count > 1) {
                            sampleCounts.add(count);
                        }
                    }
                }
            } catch {
                // A valid renderable format may expose only the mandatory single-sample path.
            }
        }
        const result = Object.freeze({
            sampled,
            filterable,
            renderable,
            blendable: renderable && !integer && (!float32 || this.#floatBlend),
            storage: false,
            sampleCounts: Object.freeze([...sampleCounts].sort((first, second) => first - second))
        });
        this.#formats.set(format, result);
        return result;
    }
}
