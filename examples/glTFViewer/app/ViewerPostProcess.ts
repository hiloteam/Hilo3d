import * as Hilo3d from '../../../src/Hilo3d';

const FULLSCREEN_VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;
void main() {
    v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const COLOR_GRADE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sceneColor;
layout(std140) uniform ViewerColorGradeBlock {
    float u_exposure;
    float u_contrast;
    float u_saturation;
    float u_vignette;
    float u_toneMapping;
};
layout(location = 0) out vec4 color;

vec3 linearToSRGB(vec3 value) {
    vec3 low = value * 12.92;
    vec3 high = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, lessThanEqual(value, vec3(0.0031308)));
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

float interleavedGradientNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec4 source = texture(u_sceneColor, v_uv);
    vec3 result = source.rgb * exp2(u_exposure);
    result = (result - vec3(0.18)) * u_contrast + vec3(0.18);
    float luminance = dot(result, vec3(0.2126, 0.7152, 0.0722));
    result = mix(vec3(luminance), result, u_saturation);

    if (u_toneMapping < 0.5) {
        result = pbrNeutral(result);
    } else if (u_toneMapping < 1.5) {
        result = acesFitted(result);
    } else if (u_toneMapping < 2.5) {
        result = result / (vec3(1.0) + result);
    }

    vec2 dimensions = vec2(textureSize(u_sceneColor, 0));
    vec2 centered = v_uv * 2.0 - 1.0;
    centered.x *= dimensions.x / max(dimensions.y, 1.0);
    float vignette = smoothstep(0.25, 1.2, length(centered)) * u_vignette;
    result *= 1.0 - vignette * 0.72;
    result = linearToSRGB(max(result, vec3(0.0)));
    result += (interleavedGradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
    color = vec4(result, source.a);
}`;

Hilo3d.registerUniformBlockBinding('ViewerColorGradeBlock');

const colorGradeLayout = Hilo3d.createStd140Layout({
    u_exposure: 'float',
    u_contrast: 'float',
    u_saturation: 'float',
    u_vignette: 'float',
    u_toneMapping: 'float'
});

export type ViewerToneMappingMode = 'pbr-neutral' | 'aces' | 'reinhard' | 'none';
export type ViewerLookPreset = 'neutral' | 'studio' | 'cinematic';

export interface ViewerPostProcessState {
    readonly exposure: number;
    readonly contrast: number;
    readonly saturation: number;
    readonly vignette: number;
    readonly toneMapping: ViewerToneMappingMode;
}

class ToggleableBloomRuntime implements Hilo3d.ForwardRenderPipelineFeatureRuntime {
    readonly #controller: ViewerBloomController;
    readonly #runtime: Hilo3d.ForwardRenderPipelineFeatureRuntime;

    constructor(
        controller: ViewerBloomController,
        runtime: Hilo3d.ForwardRenderPipelineFeatureRuntime
    ) {
        this.#controller = controller;
        this.#runtime = runtime;
    }

    record(context: Hilo3d.ForwardRenderFeatureContext): void {
        if (this.#controller.enabled) this.#runtime.record(context);
    }

    destroy(): void {
        this.#runtime.destroy();
    }
}

export class ViewerBloomController implements Hilo3d.ForwardRenderPipelineFeature {
    readonly name = 'gltf-viewer-bloom';
    readonly injectionPoint = 'after-transparent' as const;
    readonly requirements: Hilo3d.ForwardRenderPipelineFeature['requirements'];
    readonly #feature: Hilo3d.Bloom;
    #enabled = true;

    constructor(options: Readonly<Hilo3d.BloomOptions>) {
        this.#feature = new Hilo3d.Bloom(options);
        this.requirements = this.#feature.requirements;
    }

    get enabled(): boolean {
        return this.#enabled;
    }

    setEnabled(enabled: boolean): void {
        this.#enabled = enabled;
    }

    create(): Hilo3d.ForwardRenderPipelineFeatureRuntime {
        return new ToggleableBloomRuntime(this, this.#feature.create());
    }
}

interface MutableColorAttachment extends Hilo3d.RenderPipelineColorAttachment {
    texture: Hilo3d.RenderGraphTextureHandle;
}

class ViewerColorGradeParameters implements Hilo3d.FullscreenRenderPassParameters {
    readonly inputTextures: Hilo3d.RenderGraphTextureHandle[] = [];
    readonly colorAttachments: MutableColorAttachment[] = [];
    readonly #attachment: MutableColorAttachment = {
        texture: 0 as Hilo3d.RenderGraphTextureHandle,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
    };

    configure(
        source: Hilo3d.RenderGraphTextureHandle,
        destination: Hilo3d.RenderGraphTextureHandle
    ): void {
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

class ViewerColorGradeRuntime implements Hilo3d.ForwardRenderPipelineFeatureRuntime {
    readonly #pass: Hilo3d.FullscreenRenderPass;
    readonly #parameters = new Hilo3d.RenderPassParameterPool(
        () => new ViewerColorGradeParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #descriptor = {
        format: 'rgba8unorm' as const,
        extent: Object.freeze({ relativeTo: 'output' as const, scale: 1 })
    };

    constructor(block: Hilo3d.UniformBuffer<typeof colorGradeLayout.schema>) {
        this.#pass = new Hilo3d.FullscreenRenderPass({
            name: 'glTF Viewer color grade',
            shader: new Hilo3d.Shader({
                vs: FULLSCREEN_VERTEX_SOURCE,
                fs: COLOR_GRADE_FRAGMENT_SOURCE
            }),
            pipelineState: {
                ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
                depthTest: false,
                depthWrite: false,
                cullMode: 'none'
            },
            uniformBuffers: [block]
        });
    }

    record(context: Hilo3d.ForwardRenderFeatureContext): void {
        const source = context.resources.color;
        if (source === null) throw new Error('glTF Viewer color grade requires scene color');
        const destination = context.pipeline.graph.createTexture(
            'glTF Viewer color grade output',
            this.#descriptor
        );
        const parameters = context.pipeline.acquirePassParameters(this.#parameters);
        parameters.configure(source, destination);
        context.pipeline.graph.addPass(this.#pass, parameters);
        context.resources.replaceColor(destination, 'srgb');
    }

    destroy(): void {
        // The renderer owns the pipeline objects; the controller retains only CPU-side UBO data.
    }
}

class ViewerColorGradeFeature implements Hilo3d.ForwardRenderPipelineFeature {
    readonly name = 'gltf-viewer-color-grade';
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

    constructor(readonly block: Hilo3d.UniformBuffer<typeof colorGradeLayout.schema>) {}

    create(): Hilo3d.ForwardRenderPipelineFeatureRuntime {
        return new ViewerColorGradeRuntime(this.block);
    }
}

function toneMappingValue(mode: ViewerToneMappingMode): number {
    switch (mode) {
        case 'pbr-neutral':
            return 0;
        case 'aces':
            return 1;
        case 'reinhard':
            return 2;
        case 'none':
            return 3;
    }
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(`${label} must be between ${String(minimum)} and ${String(maximum)}`);
    }
    return value;
}

const DEFAULT_STATE: ViewerPostProcessState = Object.freeze({
    exposure: -0.3,
    contrast: 0.04,
    saturation: 0,
    vignette: 0.12,
    toneMapping: 'pbr-neutral'
});

const PRESETS: Readonly<Record<ViewerLookPreset, ViewerPostProcessState>> = Object.freeze({
    neutral: DEFAULT_STATE,
    studio: Object.freeze({
        exposure: -0.18,
        contrast: 0.12,
        saturation: -0.04,
        vignette: 0.18,
        toneMapping: 'pbr-neutral'
    }),
    cinematic: Object.freeze({
        exposure: -0.42,
        contrast: 0.22,
        saturation: -0.12,
        vignette: 0.34,
        toneMapping: 'aces'
    })
});

export class ViewerPostProcessController {
    readonly feature: Hilo3d.ForwardRenderPipelineFeature;
    readonly #block = Hilo3d.UniformBuffer.fromSchema(colorGradeLayout, {
        u_exposure: DEFAULT_STATE.exposure,
        u_contrast: 1 + DEFAULT_STATE.contrast,
        u_saturation: 1 + DEFAULT_STATE.saturation,
        u_vignette: DEFAULT_STATE.vignette,
        u_toneMapping: toneMappingValue(DEFAULT_STATE.toneMapping)
    });
    #state: ViewerPostProcessState = DEFAULT_STATE;

    constructor() {
        this.feature = new ViewerColorGradeFeature(this.#block);
    }

    get state(): ViewerPostProcessState {
        return this.#state;
    }

    setExposure(value: number): void {
        value = finiteRange(value, -3, 3, 'Viewer exposure');
        this.#state = Object.freeze({ ...this.#state, exposure: value });
        this.#block.set('u_exposure', value);
    }

    setContrast(value: number): void {
        value = finiteRange(value, -0.75, 1, 'Viewer contrast');
        this.#state = Object.freeze({ ...this.#state, contrast: value });
        this.#block.set('u_contrast', 1 + value);
    }

    setSaturation(value: number): void {
        value = finiteRange(value, -1, 1, 'Viewer saturation');
        this.#state = Object.freeze({ ...this.#state, saturation: value });
        this.#block.set('u_saturation', 1 + value);
    }

    setVignette(value: number): void {
        value = finiteRange(value, 0, 1, 'Viewer vignette');
        this.#state = Object.freeze({ ...this.#state, vignette: value });
        this.#block.set('u_vignette', value);
    }

    setToneMapping(value: ViewerToneMappingMode): void {
        this.#state = Object.freeze({ ...this.#state, toneMapping: value });
        this.#block.set('u_toneMapping', toneMappingValue(value));
    }

    applyPreset(preset: ViewerLookPreset): void {
        const state = PRESETS[preset];
        this.setExposure(state.exposure);
        this.setContrast(state.contrast);
        this.setSaturation(state.saturation);
        this.setVignette(state.vignette);
        this.setToneMapping(state.toneMapping);
    }

    reset(): void {
        this.applyPreset('neutral');
    }
}
