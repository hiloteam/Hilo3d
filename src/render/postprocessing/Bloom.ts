import Material from '../../material/Material';
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

const BLOOM_BLOCK = `layout(std140) uniform BloomBlock {
    float u_threshold;
    float u_knee;
    float u_clamp;
    float u_intensity;
    float u_scatter;
    vec4 u_tint;
};`;

const PREFILTER_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
${BLOOM_BLOCK}
layout(location = 0) out vec4 color;

vec3 prefilterSample(vec2 uv) {
    vec3 value = min(texture(u_source, uv).rgb, vec3(u_clamp));
    float brightness = max(value.r, max(value.g, value.b));
    float soft = clamp(brightness - u_threshold + u_knee, 0.0, 2.0 * u_knee);
    soft = soft * soft / max(4.0 * u_knee, 1e-5);
    float contribution = max(soft, brightness - u_threshold) / max(brightness, 1e-5);
    return value * contribution;
}

void accumulateKaris(
    inout vec3 weightedColor,
    inout float totalWeight,
    vec3 value,
    float spatialWeight
) {
    float luminance = dot(value, vec3(0.2126, 0.7152, 0.0722));
    float weight = spatialWeight / (1.0 + luminance);
    weightedColor += value * weight;
    totalWeight += weight;
}

void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
    vec2 wide = texel * 2.0;
    vec3 result = vec3(0.0);
    float totalWeight = 0.0;
    accumulateKaris(result, totalWeight, prefilterSample(v_uv), 0.125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(-wide.x, wide.y)), 0.03125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(wide.x, wide.y)), 0.03125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv - wide), 0.03125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(wide.x, -wide.y)), 0.03125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(0.0, wide.y)), 0.0625);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(-wide.x, 0.0)), 0.0625);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(wide.x, 0.0)), 0.0625);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv - vec2(0.0, wide.y)), 0.0625);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(-texel.x, texel.y)), 0.125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + texel), 0.125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv - texel), 0.125);
    accumulateKaris(result, totalWeight, prefilterSample(v_uv + vec2(texel.x, -texel.y)), 0.125);
    color = vec4(result / max(totalWeight, 1e-5), 1.0);
}`;

const DOWNSAMPLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
${BLOOM_BLOCK}
layout(location = 0) out vec4 color;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
    vec2 wide = texel * 2.0;
    vec3 result = texture(u_source, v_uv).rgb * 0.125;
    result += texture(u_source, v_uv + vec2(-wide.x, wide.y)).rgb * 0.03125;
    result += texture(u_source, v_uv + vec2(wide.x, wide.y)).rgb * 0.03125;
    result += texture(u_source, v_uv - wide).rgb * 0.03125;
    result += texture(u_source, v_uv + vec2(wide.x, -wide.y)).rgb * 0.03125;
    result += texture(u_source, v_uv + vec2(0.0, wide.y)).rgb * 0.0625;
    result += texture(u_source, v_uv + vec2(-wide.x, 0.0)).rgb * 0.0625;
    result += texture(u_source, v_uv + vec2(wide.x, 0.0)).rgb * 0.0625;
    result += texture(u_source, v_uv - vec2(0.0, wide.y)).rgb * 0.0625;
    result += texture(u_source, v_uv + vec2(-texel.x, texel.y)).rgb * 0.125;
    result += texture(u_source, v_uv + texel).rgb * 0.125;
    result += texture(u_source, v_uv - texel).rgb * 0.125;
    result += texture(u_source, v_uv + vec2(texel.x, -texel.y)).rgb * 0.125;
    color = vec4(result, 1.0);
}`;

const UPSAMPLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_high;
uniform sampler2D u_low;
${BLOOM_BLOCK}
layout(location = 0) out vec4 color;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_low, 0));
    vec3 low = texture(u_low, v_uv).rgb * 4.0;
    low += texture(u_low, v_uv + vec2(texel.x, 0.0)).rgb * 2.0;
    low += texture(u_low, v_uv - vec2(texel.x, 0.0)).rgb * 2.0;
    low += texture(u_low, v_uv + vec2(0.0, texel.y)).rgb * 2.0;
    low += texture(u_low, v_uv - vec2(0.0, texel.y)).rgb * 2.0;
    low += texture(u_low, v_uv + texel).rgb;
    low += texture(u_low, v_uv - texel).rgb;
    low += texture(u_low, v_uv + vec2(texel.x, -texel.y)).rgb;
    low += texture(u_low, v_uv + vec2(-texel.x, texel.y)).rgb;
    low *= 1.0 / 16.0;
    color = vec4(texture(u_high, v_uv).rgb + low * u_scatter, 1.0);
}`;

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
${BLOOM_BLOCK}
layout(location = 0) out vec4 color;
void main() {
    vec4 scene = texture(u_scene, v_uv);
    vec3 bloom = texture(u_bloom, v_uv).rgb * u_tint.rgb * u_intensity;
    color = vec4(scene.rgb + bloom, scene.a);
}`;

registerUniformBlockBinding('BloomBlock');

const bloomLayout = createStd140Layout({
    u_threshold: 'float',
    u_knee: 'float',
    u_clamp: 'float',
    u_intensity: 'float',
    u_scatter: 'float',
    u_tint: 'vec4'
});

interface MutableBloomAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

class BloomPassParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureHandle[] = [];
    readonly colorAttachments: MutableBloomAttachment[] = [];
    readonly #attachment: MutableBloomAttachment = {
        texture: 0 as RenderGraphTextureHandle,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 0 }
    };

    configure(
        inputs: readonly RenderGraphTextureHandle[],
        destination: RenderGraphTextureHandle
    ): void {
        this.inputTextures.length = inputs.length;
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index];
            if (input === undefined) throw new TypeError('Bloom input array must not be sparse');
            this.inputTextures[index] = input;
        }
        this.#attachment.texture = destination;
        this.colorAttachments[0] = this.#attachment;
        this.colorAttachments.length = 1;
    }

    reset(): void {
        this.inputTextures.length = 0;
        this.colorAttachments.length = 0;
    }
}

/** Quality and shape controls for the HDR bloom pyramid. */
export interface BloomOptions {
    /** Linear HDR threshold. Defaults to 1. */
    readonly threshold?: number;
    /** Soft-threshold width. Defaults to 0.5. */
    readonly knee?: number;
    /** Maximum prefilter value used to contain fireflies. Defaults to 65,000. */
    readonly clamp?: number;
    /** Final additive bloom intensity. Defaults to 0.8. */
    readonly intensity?: number;
    /** Energy passed from each coarser level during tent upsampling. Defaults to 0.7. */
    readonly scatter?: number;
    /** Bloom tint in linear color. Defaults to white. */
    readonly tint?: Color;
    /** Maximum number of half-resolution pyramid levels. Defaults to 6. */
    readonly maxLevels?: number;
    /** Smallest pyramid dimension. Defaults to 16 pixels. */
    readonly minResolution?: number;
}

interface BloomSettings {
    readonly threshold: number;
    readonly knee: number;
    readonly clamp: number;
    readonly intensity: number;
    readonly scatter: number;
    readonly tint: readonly [number, number, number, number];
    readonly maxLevels: number;
    readonly minResolution: number;
}

function finiteAtLeast(value: number, minimum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum) {
        throw new RangeError(`${label} must be finite and at least ${String(minimum)}`);
    }
    return value;
}

function snapshotBloomOptions(options: Readonly<BloomOptions>): BloomSettings {
    const maxLevels = options.maxLevels ?? 6;
    const minResolution = options.minResolution ?? 16;
    if (!Number.isSafeInteger(maxLevels) || maxLevels < 1 || maxLevels > 10) {
        throw new RangeError('Bloom maxLevels must be an integer in [1, 10]');
    }
    if (!Number.isSafeInteger(minResolution) || minResolution < 1) {
        throw new RangeError('Bloom minResolution must be a positive integer');
    }
    const tint = options.tint ?? new Color(1, 1, 1, 1);
    const tintValue: readonly [number, number, number, number] = Object.freeze([
        tint.r,
        tint.g,
        tint.b,
        tint.a
    ]);
    return Object.freeze({
        threshold: finiteAtLeast(options.threshold ?? 1, 0, 'Bloom threshold'),
        knee: finiteAtLeast(options.knee ?? 0.5, 1e-5, 'Bloom knee'),
        clamp: finiteAtLeast(options.clamp ?? 65000, 0, 'Bloom clamp'),
        intensity: finiteAtLeast(options.intensity ?? 0.8, 0, 'Bloom intensity'),
        scatter: finiteAtLeast(options.scatter ?? 0.7, 0, 'Bloom scatter'),
        tint: tintValue,
        maxLevels,
        minResolution
    });
}

class BloomRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #settings: BloomSettings;
    readonly #block: UniformBuffer<typeof bloomLayout.schema>;
    readonly #prefilter: FullscreenRenderPass;
    readonly #downsample: FullscreenRenderPass;
    readonly #upsample: FullscreenRenderPass;
    readonly #composite: FullscreenRenderPass;
    readonly #parameters = new RenderPassParameterPool(
        () => new BloomPassParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #downDescriptors: {
        readonly format: 'rgba16float';
        readonly extent: { readonly relativeTo: 'output'; scale: number };
    }[] = [];
    readonly #upDescriptors: {
        readonly format: 'rgba16float';
        readonly extent: { readonly relativeTo: 'output'; scale: number };
    }[] = [];
    readonly #downHandles: RenderGraphTextureHandle[] = [];
    readonly #upHandles: RenderGraphTextureHandle[] = [];
    readonly #compositeDescriptor = {
        format: 'rgba16float' as const,
        extent: Object.freeze({ relativeTo: 'output' as const, scale: 1 })
    };

    constructor(settings: BloomSettings) {
        this.#settings = settings;
        this.#block = UniformBuffer.fromSchema(bloomLayout, {
            u_threshold: settings.threshold,
            u_knee: settings.knee,
            u_clamp: settings.clamp,
            u_intensity: settings.intensity,
            u_scatter: settings.scatter,
            u_tint: settings.tint
        });
        const material = new Material({
            depthTest: false,
            depthMask: false,
            cullFace: false
        });
        const pass = (name: string, fs: string): FullscreenRenderPass =>
            new FullscreenRenderPass({
                name,
                shader: new Shader({ vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE, fs }),
                material,
                uniformBuffers: [this.#block]
            });
        this.#prefilter = pass('Bloom prefilter', PREFILTER_FRAGMENT);
        this.#downsample = pass('Bloom downsample', DOWNSAMPLE_FRAGMENT);
        this.#upsample = pass('Bloom tent upsample', UPSAMPLE_FRAGMENT);
        this.#composite = pass('Bloom HDR composite', COMPOSITE_FRAGMENT);
        for (let index = 0; index < settings.maxLevels; index += 1) {
            const scale = 0.5 ** (index + 1);
            this.#downDescriptors.push({
                format: 'rgba16float',
                extent: { relativeTo: 'output', scale }
            });
            this.#upDescriptors.push({
                format: 'rgba16float',
                extent: { relativeTo: 'output', scale }
            });
        }
    }

    record(context: ForwardRenderFeatureContext): void {
        const scene = context.resources.color;
        if (scene === null) throw new Error('Bloom requires scene color');
        const minimumDimension = Math.min(
            context.pipeline.output.width,
            context.pipeline.output.height
        );
        let levelCount = 1;
        while (
            levelCount < this.#settings.maxLevels &&
            minimumDimension * 0.5 ** (levelCount + 1) >= this.#settings.minResolution
        ) {
            levelCount++;
        }
        this.#downHandles.length = levelCount;
        this.#upHandles.length = Math.max(0, levelCount - 1);
        let source = scene;
        for (let index = 0; index < levelCount; index += 1) {
            const descriptor = this.#downDescriptors[index];
            if (descriptor === undefined) throw new Error('Bloom downsample descriptor is missing');
            const destination = context.pipeline.graph.createTexture(
                `bloom down ${String(index)}`,
                descriptor
            );
            this.#downHandles[index] = destination;
            const parameters = context.pipeline.acquirePassParameters(this.#parameters);
            parameters.configure([source], destination);
            context.pipeline.graph.addPass(
                index === 0 ? this.#prefilter : this.#downsample,
                parameters
            );
            source = destination;
        }
        let bloom = this.#downHandles[levelCount - 1];
        if (bloom === undefined) throw new Error('Bloom pyramid is empty');
        for (let index = levelCount - 2; index >= 0; index -= 1) {
            const high = this.#downHandles[index];
            const descriptor = this.#upDescriptors[index];
            if (high === undefined || descriptor === undefined) {
                throw new Error('Bloom upsample level is incomplete');
            }
            const destination = context.pipeline.graph.createTexture(
                `bloom up ${String(index)}`,
                descriptor
            );
            this.#upHandles[index] = destination;
            const parameters = context.pipeline.acquirePassParameters(this.#parameters);
            parameters.configure([high, bloom], destination);
            context.pipeline.graph.addPass(this.#upsample, parameters);
            bloom = destination;
        }
        const destination = context.pipeline.graph.createTexture(
            'bloom composite',
            this.#compositeDescriptor
        );
        const parameters = context.pipeline.acquirePassParameters(this.#parameters);
        parameters.configure([scene, bloom], destination);
        context.pipeline.graph.addPass(this.#composite, parameters);
        context.resources.replaceColor(destination);
    }

    destroy(): void {
        // Uniform buffers are backend-neutral CPU resources owned by this renderer-local runtime.
    }
}

/**
 * Built-in high-quality HDR bloom feature.
 *
 * It performs a soft-knee Karis prefilter, a bounded half-resolution pyramid, tent upsampling,
 * and linear HDR composition. Pair it with {@link ColorUber} or use
 * {@link PostProcessRenderPipelineFactory} so tone mapping happens after bloom.
 */
export class Bloom implements ForwardRenderPipelineFeature {
    readonly name = 'bloom';
    readonly injectionPoint = 'after-transparent' as const;
    readonly requirements = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: false,
        requiredTextureFormats: Object.freeze([
            Object.freeze({
                format: 'rgba16float' as const,
                use: 'color-attachment' as const
            }),
            Object.freeze({
                format: 'rgba16float' as const,
                use: 'filterable-sampled' as const
            })
        ])
    });
    readonly #settings: BloomSettings;

    constructor(options: Readonly<BloomOptions> = {}) {
        this.#settings = snapshotBloomOptions(options);
    }

    create(): ForwardRenderPipelineFeatureRuntime {
        return new BloomRuntime(this.#settings);
    }
}
