import * as Hilo3d from '../../src/Hilo3d';

export type ScriptablePipelineView = 'beauty' | 'bloom' | 'depth' | 'contours';

/** Live controls for the gallery's four custom graph passes. */
export interface ScriptablePipelineSettings {
    enabled: boolean;
    bloom: number;
    dispersion: number;
    contours: number;
    exposure: number;
    mode: ScriptablePipelineView;
    split: boolean;
    splitPosition: number;
    time: number;
}

/** Submitted work from this feature; these counts exclude the shared scene/shadow/output passes. */
export interface ScriptablePipelineDiagnostics {
    readonly passNames: readonly string[];
    passCount: number;
    frameCount: number;
    outputWidth: number;
    outputHeight: number;
    bloomWidth: number;
    bloomHeight: number;
}

export interface ScriptablePipelineEffects {
    readonly feature: Hilo3d.ForwardRenderPipelineFeature;
    readonly settings: ScriptablePipelineSettings;
    readonly diagnostics: ScriptablePipelineDiagnostics;
}

const PASS_NAMES = Object.freeze([
    'Atelier · highlight extraction',
    'Atelier · bloom horizontal',
    'Atelier · bloom vertical',
    'Atelier · spectral finish'
]);

const coordinateSource = Hilo3d.Shader.shaders['method/portableCoordinates.glsl'];
if (coordinateSource === undefined) {
    throw new Error('The gallery requires the portable render-target coordinate helpers.');
}

// The triangle keeps the engine's fullscreen geometry convention. Every fragment texture sample
// crosses hiloRenderTargetUV once; blur offsets and asymmetric composition stay in that convention.
const VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;
void main() {
    v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
layout(location = 0) out vec4 color;
${coordinateSource}
`;

const EXTRACT_SOURCE = `${FRAGMENT_HEADER}
uniform sampler2D u_source;
vec3 sampleScene(vec2 uv) {
    return texture(u_source, hiloRenderTargetUV(uv)).rgb;
}
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
    vec3 source = sampleScene(v_uv) * 0.5;
    source += sampleScene(v_uv + vec2(-1.0, -1.0) * texel) * 0.125;
    source += sampleScene(v_uv + vec2( 1.0, -1.0) * texel) * 0.125;
    source += sampleScene(v_uv + vec2(-1.0,  1.0) * texel) * 0.125;
    source += sampleScene(v_uv + vec2( 1.0,  1.0) * texel) * 0.125;
    float brightness = max(source.r, max(source.g, source.b));
    float knee = clamp(brightness - 0.55, 0.0, 1.1);
    float contribution = max(brightness - 1.1, knee * knee / 4.4);
    color = vec4(source * contribution / max(brightness, 0.0001), 1.0);
}`;

function blurSource(horizontal: boolean): string {
    return `${FRAGMENT_HEADER}
uniform sampler2D u_source;
vec3 sampleBloom(vec2 uv) {
    return texture(u_source, hiloRenderTargetUV(uv)).rgb;
}
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
    vec2 direction = ${horizontal ? 'vec2(texel.x, 0.0)' : 'vec2(0.0, texel.y)'};
    // A normalized 13-texel Gaussian (sigma 3) uses seven bilinear samples. Adjacent texel
    // weights are paired without scaling their offsets, so tiny highlights leave no gaps.
    vec3 result = sampleBloom(v_uv) * 0.1370228165;
    result += sampleBloom(v_uv + direction * 1.4584295168) * 0.2393373249;
    result += sampleBloom(v_uv - direction * 1.4584295168) * 0.2393373249;
    result += sampleBloom(v_uv + direction * 3.4039848067) * 0.1394403032;
    result += sampleBloom(v_uv - direction * 3.4039848067) * 0.1394403032;
    result += sampleBloom(v_uv + direction * 5.3518057801) * 0.0527109636;
    result += sampleBloom(v_uv - direction * 5.3518057801) * 0.0527109636;
    color = vec4(result, 1.0);
}`;
}

const FINISH_SOURCE = `${FRAGMENT_HEADER}
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_depth;
layout(std140) uniform AtelierFinishBlock {
    mat4 u_inverseProjection;
    vec4 u_effects;
    vec4 u_view;
    vec4 u_depthInfo;
};

vec3 sceneAt(vec2 uv) {
    return texture(u_scene, hiloRenderTargetUV(uv)).rgb;
}
float viewDepthAt(vec2 uv) {
    float depth = texture(u_depth, hiloRenderTargetUV(uv)).r;
    vec4 view = u_inverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return min(abs(view.z) / max(abs(view.w), 0.00001), u_depthInfo.x);
}
vec3 neutralTonemap(vec3 value) {
    float floorValue = min(value.r, min(value.g, value.b));
    value -= floorValue < 0.08 ? floorValue - 6.25 * floorValue * floorValue : 0.04;
    float peak = max(value.r, max(value.g, value.b));
    if (peak < 0.76) return value;
    float newPeak = 1.0 - 0.0576 / (peak - 0.52);
    value *= newPeak / peak;
    float desaturation = 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0);
    return mix(value, vec3(newPeak), desaturation);
}
vec3 linearToSRGB(vec3 value) {
    vec3 low = value * 12.92;
    vec3 high = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, lessThanEqual(value, vec3(0.0031308)));
}
void main() {
    vec2 resolution = vec2(textureSize(u_scene, 0));
    float aspect = resolution.x / resolution.y;
    // Reference-height units keep the visible lens/line width independent of canvas pixel ratio.
    vec2 referencePixel = vec2(1.0 / aspect, 1.0) / 900.0;
    vec3 source = sceneAt(v_uv);
    vec2 centered = v_uv - 0.5;
    float radius = dot(centered, centered);
    vec2 lensPosition = centered * vec2(aspect, 1.0);
    float lensRadius = length(lensPosition);
    vec2 lensDirection = lensPosition / max(lensRadius, 0.12);
    float radialWeight = mix(0.55, 1.0, smoothstep(0.0, 0.65, lensRadius));
    // Low values are restrained; the upper half visibly separates the red and blue image edges.
    float dispersionWidth = 10.0 * pow(clamp(u_effects.y, 0.0, 1.0), 1.5);
    vec2 separation = lensDirection * referencePixel * dispersionWidth * radialWeight;
    separation *= 1.0 + sin(u_view.w * 0.2) * 0.06;
    vec3 spectral = vec3(sceneAt(v_uv + separation).r, source.g, sceneAt(v_uv - separation).b);
    vec3 bloom = texture(u_bloom, hiloRenderTargetUV(v_uv)).rgb;

    float centerDepth = viewDepthAt(v_uv);
    float contourStrength = clamp(u_effects.z, 0.0, 1.0);
    vec2 stepUV = referencePixel * mix(1.15, 4.0, contourStrength);
    float leftDepth = viewDepthAt(v_uv - vec2(stepUV.x, 0.0));
    float rightDepth = viewDepthAt(v_uv + vec2(stepUV.x, 0.0));
    float downDepth = viewDepthAt(v_uv - vec2(0.0, stepUV.y));
    float upDepth = viewDepthAt(v_uv + vec2(0.0, stepUV.y));
    float curvature = abs(leftDepth + rightDepth - 2.0 * centerDepth);
    curvature += abs(downDepth + upDepth - 2.0 * centerDepth);
    float edge = smoothstep(0.003, 0.028, curvature / max(centerDepth, 0.05));

    vec3 result = spectral + bloom * u_effects.x;
    float luminance = dot(result, vec3(0.2126, 0.7152, 0.0722));
    float shadowWeight = 1.0 - smoothstep(0.04, 0.7, luminance);
    float highlightWeight = smoothstep(0.5, 2.8, luminance);
    result *= mix(vec3(1.0), vec3(0.90, 1.018, 1.038), shadowWeight * u_depthInfo.y);
    result *= mix(vec3(1.0), vec3(1.045, 1.015, 0.95), highlightWeight * u_depthInfo.y);
    result = neutralTonemap(max(result * exp2(u_effects.w), vec3(0.0)));
    float vignette = smoothstep(0.12, 0.65, radius);
    result *= 1.0 - vignette * 0.16 * u_depthInfo.y;
    // Ink belongs after tone mapping: otherwise bright metal compresses away the edge contrast.
    // Warm lines read against the dark room; deep teal lines remain legible on pale metal/stone.
    float displayLuminance = dot(result, vec3(0.2126, 0.7152, 0.0722));
    vec3 contourInk = mix(vec3(0.95, 0.48, 0.13), vec3(0.006, 0.038, 0.045),
        smoothstep(0.08, 0.48, displayLuminance));
    result = mix(result, contourInk, edge * contourStrength * 0.92);

    if (u_view.x > 0.5 && u_view.x < 1.5) {
        result = neutralTonemap(bloom * 1.7);
    } else if (u_view.x > 1.5 && u_view.x < 2.5) {
        // Focus the linear view-distance ramp on the gallery's occupied half of the frustum.
        // Further surfaces keep the far color; geometry still comes only from sampled depth.
        float depthRamp = clamp(centerDepth / (u_depthInfo.x * 0.5), 0.0, 1.0);
        vec3 nearColor = vec3(1.0, 0.47, 0.10);
        vec3 middleColor = vec3(0.016, 0.28, 0.30);
        vec3 farColor = vec3(0.005, 0.012, 0.028);
        result = mix(nearColor, middleColor, smoothstep(0.0, 0.6, depthRamp));
        result = mix(result, farColor, smoothstep(0.5, 1.0, depthRamp));
    } else if (u_view.x > 2.5) {
        result = mix(vec3(0.014, 0.041, 0.049), vec3(0.95, 0.70, 0.32), edge);
    }
    if (u_view.y > 0.5 && v_uv.x < u_view.z) {
        result = neutralTonemap(max(source * exp2(u_effects.w), vec3(0.0)));
    }
    color = vec4(linearToSRGB(max(result, vec3(0.0))), 1.0);
}`;

Hilo3d.registerUniformBlockBinding('AtelierFinishBlock');
const finishLayout = Hilo3d.createStd140Layout({
    u_inverseProjection: 'mat4',
    u_effects: 'vec4',
    u_view: 'vec4',
    u_depthInfo: 'vec4'
});

interface MutableColorAttachment extends Hilo3d.RenderPipelineColorAttachment {
    texture: Hilo3d.RenderGraphTextureHandle;
}

class EffectParameters implements Hilo3d.FullscreenRenderPassParameters {
    readonly inputTextures: Hilo3d.RenderGraphTextureHandle[] = [];
    readonly colorAttachments: MutableColorAttachment[] = [];
    readonly #attachment: MutableColorAttachment = {
        texture: 0 as Hilo3d.RenderGraphTextureHandle,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 }
    };

    configure(
        destination: Hilo3d.RenderGraphTextureHandle,
        source: Hilo3d.RenderGraphTextureHandle,
        bloom?: Hilo3d.RenderGraphTextureHandle,
        depth?: Hilo3d.RenderGraphTextureHandle
    ): void {
        this.inputTextures[0] = source;
        if (bloom !== undefined && depth !== undefined) {
            this.inputTextures[1] = bloom;
            this.inputTextures[2] = depth;
            this.inputTextures.length = 3;
        } else {
            this.inputTextures.length = 1;
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

function createPass(
    name: string,
    fragmentSource: string,
    uniformBuffers: readonly Hilo3d.UniformBuffer[] = []
): Hilo3d.FullscreenRenderPass {
    return new Hilo3d.FullscreenRenderPass({
        name,
        shader: new Hilo3d.Shader({ vs: VERTEX_SOURCE, fs: fragmentSource }),
        pipelineState: {
            ...Hilo3d.DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        },
        uniformBuffers
    });
}

const VIEW_INDEX: Readonly<Record<ScriptablePipelineView, number>> = Object.freeze({
    beauty: 0,
    bloom: 1,
    depth: 2,
    contours: 3
});

class AtelierFeatureRuntime implements Hilo3d.ForwardRenderPipelineFeatureRuntime {
    readonly #block = Hilo3d.UniformBuffer.fromSchema(finishLayout);
    readonly #extract = createPass('Atelier · highlight extraction', EXTRACT_SOURCE);
    readonly #horizontal = createPass('Atelier · bloom horizontal', blurSource(true));
    readonly #vertical = createPass('Atelier · bloom vertical', blurSource(false));
    readonly #finish = createPass('Atelier · spectral finish', FINISH_SOURCE, [this.#block]);
    readonly #parameters = new Hilo3d.RenderPassParameterPool(
        () => new EffectParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #bloomDescriptor = Object.freeze({
        format: 'rgba16float' as const,
        extent: Object.freeze({ relativeTo: 'output' as const, scale: 0.5 })
    });
    readonly #finishDescriptor = Object.freeze({
        format: 'rgba8unorm' as const,
        extent: Object.freeze({ relativeTo: 'output' as const, scale: 1 })
    });
    readonly #inverseProjection = new Hilo3d.Matrix4();
    readonly #effects = new Float32Array(4);
    readonly #view = new Float32Array(4);
    readonly #depthInfo = new Float32Array(4);
    #pendingWidth = 0;
    #pendingHeight = 0;
    #pendingPassCount = 0;

    constructor(
        readonly settings: ScriptablePipelineSettings,
        readonly diagnostics: ScriptablePipelineDiagnostics
    ) {}

    record(context: Hilo3d.ForwardRenderFeatureContext): void {
        const source = context.resources.color;
        const depth = context.resources.depth;
        if (source === null || depth === null || context.resources.colorEncoding !== 'linear') {
            throw new Error('The atelier requires linear scene color and sampled scene depth.');
        }
        if (context.pipeline.useLogDepth) {
            throw new Error('The atelier depth inspection requires a non-logarithmic camera.');
        }
        const { settings } = this;
        const { pipeline } = context;
        const { graph } = pipeline;
        const enabled = settings.enabled;
        this.#pendingWidth = pipeline.output.width;
        this.#pendingHeight = pipeline.output.height;
        this.#pendingPassCount = enabled ? 4 : 1;
        this.#inverseProjection.copy(pipeline.camera.projectionMatrix).invert();
        this.#effects[0] = enabled ? settings.bloom : 0;
        this.#effects[1] = enabled ? settings.dispersion : 0;
        this.#effects[2] = enabled ? settings.contours : 0;
        this.#effects[3] = settings.exposure;
        this.#view[0] = enabled ? VIEW_INDEX[settings.mode] : 0;
        this.#view[1] = enabled && settings.split ? 1 : 0;
        this.#view[2] = settings.splitPosition;
        this.#view[3] = settings.time;
        this.#depthInfo[0] =
            pipeline.camera instanceof Hilo3d.PerspectiveCamera
                ? (pipeline.camera.far ?? 100)
                : 100;
        this.#depthInfo[1] = enabled ? 1 : 0;
        this.#block.set('u_inverseProjection', this.#inverseProjection.elements);
        this.#block.set('u_effects', this.#effects);
        this.#block.set('u_view', this.#view);
        this.#block.set('u_depthInfo', this.#depthInfo);

        let bloom = source;
        if (enabled) {
            const highlights = graph.createTexture(
                'Atelier highlights · half',
                this.#bloomDescriptor
            );
            const horizontal = graph.createTexture(
                'Atelier bloom · horizontal',
                this.#bloomDescriptor
            );
            bloom = graph.createTexture('Atelier bloom · vertical', this.#bloomDescriptor);
            const extractParameters = pipeline.acquirePassParameters(this.#parameters);
            extractParameters.configure(highlights, source);
            graph.addPass(this.#extract, extractParameters);
            const horizontalParameters = pipeline.acquirePassParameters(this.#parameters);
            horizontalParameters.configure(horizontal, highlights);
            graph.addPass(this.#horizontal, horizontalParameters);
            const verticalParameters = pipeline.acquirePassParameters(this.#parameters);
            verticalParameters.configure(bloom, horizontal);
            graph.addPass(this.#vertical, verticalParameters);
        }
        const destination = graph.createTexture('Atelier display color', this.#finishDescriptor);
        const finishParameters = pipeline.acquirePassParameters(this.#parameters);
        finishParameters.configure(destination, source, bloom, depth);
        graph.addPass(this.#finish, finishParameters);
        context.resources.replaceColor(destination, 'srgb');
    }

    frameSubmitted(): void {
        this.diagnostics.frameCount++;
        this.diagnostics.passCount = this.#pendingPassCount;
        this.diagnostics.outputWidth = this.#pendingWidth;
        this.diagnostics.outputHeight = this.#pendingHeight;
        this.diagnostics.bloomWidth =
            this.#pendingPassCount === 4 ? Math.max(1, Math.floor(this.#pendingWidth * 0.5)) : 0;
        this.diagnostics.bloomHeight =
            this.#pendingPassCount === 4 ? Math.max(1, Math.floor(this.#pendingHeight * 0.5)) : 0;
    }

    destroy(): void {
        // Graph allocations and compiled shaders remain under renderer submission-aware ownership.
    }
}

/** Build an editable portable HDR post-process feature for the single-camera atelier example. */
export function createScriptablePipelineEffects(): ScriptablePipelineEffects {
    const settings: ScriptablePipelineSettings = {
        enabled: true,
        bloom: 0.34,
        dispersion: 0.65,
        contours: 0.18,
        exposure: 0,
        mode: 'beauty',
        split: false,
        splitPosition: 0.5,
        time: 0
    };
    const diagnostics: ScriptablePipelineDiagnostics = {
        passNames: PASS_NAMES,
        passCount: 0,
        frameCount: 0,
        outputWidth: 0,
        outputHeight: 0,
        bloomWidth: 0,
        bloomHeight: 0
    };
    const feature: Hilo3d.ForwardRenderPipelineFeature = {
        name: 'chromatic-atelier',
        injectionPoint: 'after-transparent',
        requirements: Object.freeze({
            sampledSceneColor: true,
            sampledDepth: true,
            requiredTextureFormats: Object.freeze([
                Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
                Object.freeze({
                    format: 'rgba16float' as const,
                    use: 'filterable-sampled' as const
                })
            ])
        }),
        create(): Hilo3d.ForwardRenderPipelineFeatureRuntime {
            return new AtelierFeatureRuntime(settings, diagnostics);
        }
    };
    return { feature, settings, diagnostics };
}
