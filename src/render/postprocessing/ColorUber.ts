import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Color from '../../math/Color';
import Shader from '../../shader/Shader';
import UniformBuffer from '../UniformBuffer';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../pipeline/ForwardRenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import {
    FullscreenRenderPass,
    type FullscreenRenderPassParameters
} from '../pipeline/passes/FullscreenRenderPass';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment
} from '../pipeline/ScriptableRenderGraph';
import { createStd140Layout } from '../ubo/Std140Layout';
import { registerUniformBlockBinding } from '../ubo/UniformBlockBindings';

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(std140) uniform ColorUberBlock {
    vec4 u_colorFilter;
    vec4 u_lift;
    vec4 u_gamma;
    vec4 u_gain;
    vec4 u_channelRed;
    vec4 u_channelGreen;
    vec4 u_channelBlue;
    vec4 u_vignetteColor;
    vec4 u_whiteBalance;
    vec4 u_filmicCurve;
    vec4 u_filmicClip;
    float u_exposure;
    float u_contrast;
    float u_saturation;
    float u_hueShift;
    float u_vignetteIntensity;
    float u_vignetteSmoothness;
    float u_toneMapping;
    float u_dithering;
};
layout(location = 0) out vec4 color;

vec3 linearToSRGB(vec3 value) {
    vec3 low = value * 12.92;
    vec3 high = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, lessThanEqual(value, vec3(0.0031308)));
}

vec3 whiteBalance(vec3 value) {
    vec3 lms = vec3(
        dot(value, vec3(0.390405, 0.549941, 0.00892632)),
        dot(value, vec3(0.0708416, 0.963172, 0.00135775)),
        dot(value, vec3(0.0231082, 0.128021, 0.936245))
    );
    lms *= u_whiteBalance.rgb;
    return vec3(
        dot(lms, vec3(2.85847, -1.62879, -0.024891)),
        dot(lms, vec3(-0.210182, 1.1582, 0.000324281)),
        dot(lms, vec3(-0.041812, -0.118169, 1.06867))
    );
}

vec3 hueShift(vec3 value, float angle) {
    vec3 yiq = vec3(
        dot(value, vec3(0.299, 0.587, 0.114)),
        dot(value, vec3(0.596, -0.275, -0.321)),
        dot(value, vec3(0.212, -0.523, 0.311))
    );
    float hue = atan(yiq.z, yiq.y) + angle;
    float chroma = length(yiq.yz);
    yiq.yz = chroma * vec2(cos(hue), sin(hue));
    return max(vec3(
        dot(yiq, vec3(1.0, 0.956, 0.621)),
        dot(yiq, vec3(1.0, -0.272, -0.647)),
        dot(yiq, vec3(1.0, -1.106, 1.703))
    ), vec3(0.0));
}

vec3 pbrNeutral(vec3 value) {
    const float startCompression = 0.76;
    const float desaturation = 0.15;
    float x = min(value.r, min(value.g, value.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    value -= offset;
    float peak = max(value.r, max(value.g, value.b));
    if (peak < startCompression) return value;
    float d = 1.0 - startCompression;
    float newPeak = 1.0 - d * d / (peak + d - startCompression);
    value *= newPeak / peak;
    float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
    return mix(value, vec3(newPeak), g);
}

vec3 acesFitted(vec3 value) {
    return clamp(
        (value * (2.51 * value + 0.03)) /
            (value * (2.43 * value + 0.59) + 0.14),
        0.0,
        1.0
    );
}

vec3 parametricFilmic(vec3 value) {
    float slope = max(u_filmicCurve.x, 0.01);
    float toe = clamp(u_filmicCurve.y, 0.0, 1.0);
    float shoulder = clamp(u_filmicCurve.z, 0.0, 1.0);
    float blackClip = clamp(u_filmicCurve.w, 0.0, 0.25);
    float whiteClip = clamp(u_filmicClip.x, 0.0, 0.25);
    vec3 lifted = max(value - vec3(blackClip), vec3(0.0));
    float toePower = max(0.05, slope * mix(1.0, 3.5, toe));
    vec3 shaped = pow(lifted, vec3(toePower));
    float shoulderScale = mix(1.0, 16.0, shoulder);
    vec3 mapped = shaped / (shaped + vec3(1.0 / shoulderScale));
    return clamp(mapped * (1.0 - whiteClip), 0.0, 1.0);
}

float interleavedGradientNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec4 source = texture(u_source, v_uv);
    vec3 result = source.rgb * exp2(u_exposure);
    result = whiteBalance(result);
    result *= u_colorFilter.rgb;
    result = (result - vec3(0.18)) * u_contrast + vec3(0.18);
    result = vec3(
        dot(result, u_channelRed.rgb),
        dot(result, u_channelGreen.rgb),
        dot(result, u_channelBlue.rgb)
    );
    result = max(result + u_lift.rgb, vec3(0.0));
    result = pow(result, 1.0 / max(u_gamma.rgb, vec3(0.01))) * u_gain.rgb;
    result = hueShift(result, u_hueShift);
    float luminance = dot(result, vec3(0.2126, 0.7152, 0.0722));
    result = mix(vec3(luminance), result, u_saturation);

    if (u_toneMapping < 0.5) {
        result = pbrNeutral(result);
    } else if (u_toneMapping < 1.5) {
        result = acesFitted(result);
    } else if (u_toneMapping < 2.5) {
        result = result / (vec3(1.0) + result);
    } else if (u_toneMapping < 3.5) {
        result = parametricFilmic(result);
    }

    vec2 dimensions = vec2(textureSize(u_source, 0));
    vec2 centered = v_uv * 2.0 - 1.0;
    centered.x *= dimensions.x / max(dimensions.y, 1.0);
    float vignette = smoothstep(
        max(0.001, 1.0 - u_vignetteSmoothness),
        1.0,
        length(centered) * u_vignetteIntensity
    );
    result = mix(result, u_vignetteColor.rgb, vignette * u_vignetteColor.a);
    result = linearToSRGB(max(result, vec3(0.0)));
    if (u_dithering > 0.5) {
        result += (interleavedGradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
    }
    color = vec4(result, source.a);
}`;

registerUniformBlockBinding('ColorUberBlock');

const colorUberLayout = createStd140Layout({
    u_colorFilter: 'vec4',
    u_lift: 'vec4',
    u_gamma: 'vec4',
    u_gain: 'vec4',
    u_channelRed: 'vec4',
    u_channelGreen: 'vec4',
    u_channelBlue: 'vec4',
    u_vignetteColor: 'vec4',
    u_whiteBalance: 'vec4',
    u_filmicCurve: 'vec4',
    u_filmicClip: 'vec4',
    u_exposure: 'float',
    u_contrast: 'float',
    u_saturation: 'float',
    u_hueShift: 'float',
    u_vignetteIntensity: 'float',
    u_vignetteSmoothness: 'float',
    u_toneMapping: 'float',
    u_dithering: 'float'
});

/** Display tone-mapping operator used by {@link ColorUber}. */
export type ToneMappingMode = 'pbr-neutral' | 'aces' | 'reinhard' | 'filmic' | 'none';

/** Linear-HDR color grading and display transform settings. */
export interface ColorUberOptions {
    /** Exposure compensation in EV stops. */
    readonly exposure?: number;
    /** Contrast adjustment where zero is neutral and one doubles contrast. */
    readonly contrast?: number;
    /** Saturation adjustment where zero is neutral and -1 is grayscale. */
    readonly saturation?: number;
    /** Hue rotation in degrees. */
    readonly hueShift?: number;
    /** White-balance temperature in the normalized range [-1, 1]. */
    readonly temperature?: number;
    /** White-balance green/magenta tint in the normalized range [-1, 1]. */
    readonly tint?: number;
    readonly colorFilter?: Color;
    readonly lift?: Color;
    readonly gamma?: Color;
    readonly gain?: Color;
    readonly channelRed?: Color;
    readonly channelGreen?: Color;
    readonly channelBlue?: Color;
    readonly vignetteColor?: Color;
    readonly vignetteIntensity?: number;
    readonly vignetteSmoothness?: number;
    readonly toneMapping?: ToneMappingMode;
    /** Filmic mid-tone slope multiplier in [0.01, 4]. */
    readonly filmicSlope?: number;
    /** Filmic toe strength in [0, 1]. */
    readonly filmicToe?: number;
    /** Filmic shoulder strength in [0, 1]. */
    readonly filmicShoulder?: number;
    /** Filmic black clipping offset in [0, 0.25]. */
    readonly filmicBlackClip?: number;
    /** Filmic white clipping amount in [0, 0.25]. */
    readonly filmicWhiteClip?: number;
    readonly dithering?: boolean;
}

interface MutableColorUberAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

class ColorUberParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureHandle[] = [];
    readonly colorAttachments: MutableColorUberAttachment[] = [];
    readonly #attachment: MutableColorUberAttachment = {
        texture: 0 as RenderGraphTextureHandle,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
    };

    configure(source: RenderGraphTextureHandle, destination: RenderGraphTextureHandle): void {
        this.inputTextures[0] = source;
        this.inputTextures.length = 1;
        this.#attachment.texture = destination;
        this.colorAttachments[0] = this.#attachment;
        this.colorAttachments.length = 1;
    }

    reset(): void {
        this.inputTextures.length = 0;
        this.colorAttachments.length = 0;
    }
}

function colorValue(color: Color): readonly [number, number, number, number] {
    return Object.freeze([color.r, color.g, color.b, color.a]);
}

function finite(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return value;
}

function finiteRange(value: number, label: string, minimum: number, maximum: number): number {
    const result = finite(value, label);
    if (result < minimum || result > maximum) {
        throw new RangeError(`${label} must be in [${String(minimum)}, ${String(maximum)}]`);
    }
    return result;
}

function standardIlluminantY(x: number): number {
    return 2.87 * x - 3 * x * x - 0.27509507;
}

function cieXyToLms(x: number, y: number): readonly [number, number, number] {
    const safeY = Math.max(y, 1e-4);
    const X = x / safeY;
    const Z = (1 - x - y) / safeY;
    return [
        0.7328 * X + 0.4296 - 0.1624 * Z,
        -0.7036 * X + 1.6975 + 0.0061 * Z,
        0.003 * X + 0.0136 + 0.9834 * Z
    ];
}

function whiteBalance(
    temperatureValue: number,
    tintValue: number
): readonly [number, number, number, number] {
    const temperature = finiteRange(temperatureValue, 'Color Uber temperature', -1, 1);
    const tint = finiteRange(tintValue, 'Color Uber tint', -1, 1);
    const x = 0.31271 - temperature * (temperature < 0 ? 0.1 : 0.05);
    const y = standardIlluminantY(x) + tint * 0.05;
    const reference = cieXyToLms(0.31271, 0.32902);
    const target = cieXyToLms(x, y);
    return Object.freeze([
        reference[0] / Math.max(target[0], 1e-4),
        reference[1] / Math.max(target[1], 1e-4),
        reference[2] / Math.max(target[2], 1e-4),
        1
    ]);
}

function toneMappingValue(mode: ToneMappingMode): number {
    switch (mode) {
        case 'pbr-neutral':
            return 0;
        case 'aces':
            return 1;
        case 'reinhard':
            return 2;
        case 'filmic':
            return 3;
        case 'none':
            return 4;
    }
}

class ColorUberRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #pass: FullscreenRenderPass;
    readonly #parameters = new RenderPassParameterPool(
        () => new ColorUberParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #descriptor = {
        format: 'rgba8unorm' as const,
        extent: Object.freeze({ relativeTo: 'output' as const, scale: 1 })
    };

    constructor(options: Readonly<ColorUberOptions>) {
        const block = UniformBuffer.fromSchema(colorUberLayout, {
            u_colorFilter: colorValue(options.colorFilter ?? new Color(1, 1, 1, 1)),
            u_lift: colorValue(options.lift ?? new Color(0, 0, 0, 1)),
            u_gamma: colorValue(options.gamma ?? new Color(1, 1, 1, 1)),
            u_gain: colorValue(options.gain ?? new Color(1, 1, 1, 1)),
            u_channelRed: colorValue(options.channelRed ?? new Color(1, 0, 0, 0)),
            u_channelGreen: colorValue(options.channelGreen ?? new Color(0, 1, 0, 0)),
            u_channelBlue: colorValue(options.channelBlue ?? new Color(0, 0, 1, 0)),
            u_vignetteColor: colorValue(options.vignetteColor ?? new Color(0, 0, 0, 1)),
            u_whiteBalance: whiteBalance(options.temperature ?? 0, options.tint ?? 0),
            u_filmicCurve: Object.freeze([
                finiteRange(options.filmicSlope ?? 1, 'Color Uber filmic slope', 0.01, 4),
                finiteRange(options.filmicToe ?? 0.28, 'Color Uber filmic toe', 0, 1),
                finiteRange(options.filmicShoulder ?? 0.55, 'Color Uber filmic shoulder', 0, 1),
                finiteRange(options.filmicBlackClip ?? 0, 'Color Uber filmic black clip', 0, 0.25)
            ]),
            u_filmicClip: Object.freeze([
                finiteRange(options.filmicWhiteClip ?? 0, 'Color Uber filmic white clip', 0, 0.25),
                0,
                0,
                0
            ]),
            u_exposure: finite(options.exposure ?? 0, 'Color Uber exposure'),
            u_contrast: 1 + finite(options.contrast ?? 0, 'Color Uber contrast'),
            u_saturation: 1 + finite(options.saturation ?? 0, 'Color Uber saturation'),
            u_hueShift: (finite(options.hueShift ?? 0, 'Color Uber hue shift') * Math.PI) / 180,
            u_vignetteIntensity: finiteRange(
                options.vignetteIntensity ?? 0,
                'Color Uber vignette intensity',
                0,
                1
            ),
            u_vignetteSmoothness: finiteRange(
                options.vignetteSmoothness ?? 0.5,
                'Color Uber vignette smoothness',
                0.01,
                1
            ),
            u_toneMapping: toneMappingValue(options.toneMapping ?? 'pbr-neutral'),
            u_dithering: (options.dithering ?? true) ? 1 : 0
        });
        this.#pass = new FullscreenRenderPass({
            name: 'Color Uber display transform',
            shader: new Shader({
                vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
                fs: FRAGMENT_SOURCE
            }),
            pipelineState: {
                ...DEFAULT_MATERIAL_PIPELINE_STATE,
                depthTest: false,
                depthWrite: false,
                cullMode: 'none'
            },
            uniformBuffers: [block]
        });
    }

    record(context: ForwardRenderFeatureContext): void {
        const source = context.resources.color;
        if (source === null) throw new Error('Color Uber requires scene color');
        const destination = context.pipeline.graph.createTexture(
            'color uber output',
            this.#descriptor
        );
        const parameters = context.pipeline.acquirePassParameters(this.#parameters);
        parameters.configure(source, destination);
        context.pipeline.graph.addPass(this.#pass, parameters);
        context.resources.replaceColor(destination, 'srgb');
    }

    destroy(): void {
        // Renderer-owned backend resources retire with the pipeline runtime.
    }
}

/**
 * Built-in HDR color-grading and display transform inspired by a modern "uber post" pass.
 *
 * Bloom and lighting stay linear before this feature. The pass applies exposure, white balance,
 * channel grading, lift/gamma/gain, hue/saturation, vignette, tone mapping, sRGB output, and
 * optional 8-bit dithering in one fullscreen draw.
 */
export class ColorUber implements ForwardRenderPipelineFeature {
    readonly name = 'color-uber';
    readonly injectionPoint = 'after-post-process' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: false,
        requiredTextureFormats: Object.freeze([
            Object.freeze({
                format: 'rgba8unorm' as const,
                use: 'color-attachment' as const
            }),
            Object.freeze({
                format: 'rgba8unorm' as const,
                use: 'filterable-sampled' as const
            })
        ])
    });
    readonly #options: Readonly<ColorUberOptions>;

    constructor(options: Readonly<ColorUberOptions> = {}) {
        this.#options = Object.freeze({ ...options });
    }

    create(): ForwardRenderPipelineFeatureRuntime {
        return new ColorUberRuntime(this.#options);
    }
}
