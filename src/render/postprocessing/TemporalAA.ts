import type Camera from '../../camera/Camera';
import { getTransformHistoryRevision } from '../../core/TransformHistory';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import UniformBuffer from '../UniformBuffer';
import { renderTargetFormatHasStencil, type RenderTargetDepthStencilFormat } from '../RenderTarget';
import { depthClearValue } from '../renderer/DepthConvention';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderFeatureRequirements,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../pipeline/ForwardRenderPipeline';
import type { RenderPipelineContext, RenderPipelineRequirements } from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import type { CullingResultsHandle } from '../pipeline/RendererList';
import {
    FullscreenRenderPass,
    SceneRenderPass,
    type FullscreenRenderPassParameters,
    type SceneRenderPassParameters
} from '../pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    RenderPipelineExtent,
    RenderPipelineHistoryTextureResources,
    RenderPipelineTextureDescriptor
} from '../pipeline/ScriptableRenderGraph';
import { createStd140Layout } from '../ubo/Std140Layout';
import { registerUniformBlockBinding } from '../ubo/UniformBlockBindings';
import type { RenderGraphTimelineSnapshot } from '../graph/RenderGraphTimeline';

const TEMPORAL_AA_BLOCK = `layout(std140) uniform TemporalAABlock {
    float u_historyWeight;
    float u_depthThreshold;
    float u_varianceGamma;
    float u_sharpness;
};`;

const INITIALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_velocity;
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;
void main() {
    vec4 current = texture(u_scene, v_uv);
    vec4 motion = texture(u_velocity, v_uv);
    historyColor = current;
    resolvedColor = current;
    historyDepth = motion.w;
}`;

const RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_history;
uniform sampler2D u_velocity;
uniform sampler2D u_historyDepth;
uniform sampler2D u_reactiveMask;
${TEMPORAL_AA_BLOCK}
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;

vec3 rgbToYCoCg(vec3 value) {
    return vec3(
        dot(value, vec3(0.25, 0.5, 0.25)),
        dot(value, vec3(0.5, 0.0, -0.5)),
        dot(value, vec3(-0.25, 0.5, -0.25))
    );
}

vec3 yCoCgToRgb(vec3 value) {
    return vec3(value.x + value.y - value.z, value.x + value.z, value.x - value.y - value.z);
}

float relativeDepthError(float historyLogDepth, float expectedLogDepth) {
    float historyLinear = exp2(max(historyLogDepth, 0.0)) - 1.0;
    float expectedLinear = exp2(max(expectedLogDepth, 0.0)) - 1.0;
    return abs(historyLinear - expectedLinear) / max(expectedLinear, 1e-3);
}

float minimumHistoryDepthError(vec2 historyUV, float expectedLogDepth) {
    ivec2 dimensions = textureSize(u_historyDepth, 0);
    vec2 samplePosition = historyUV * vec2(dimensions) - 0.5;
    ivec2 base = ivec2(floor(samplePosition));
    float error = 1e20;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 coordinate = clamp(base + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            error = min(
                error,
                relativeDepthError(texelFetch(u_historyDepth, coordinate, 0).r, expectedLogDepth)
            );
        }
    }
    return error;
}

float dilatedReactiveMask(ivec2 pixel, ivec2 dimensions) {
    float reactive = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 coordinate = clamp(pixel + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            reactive = max(reactive, texelFetch(u_reactiveMask, coordinate, 0).r);
        }
    }
    return reactive;
}

void main() {
    ivec2 dimensions = textureSize(u_scene, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(dimensions)), ivec2(0), dimensions - ivec2(1));
    vec4 current = texelFetch(u_scene, pixel, 0);
    vec4 motion = texelFetch(u_velocity, pixel, 0);
    vec2 historyUV = v_uv - motion.xy;
    vec2 halfTexel = 0.5 / vec2(dimensions);
    bool inside = all(greaterThanEqual(historyUV, halfTexel)) &&
        all(lessThanEqual(historyUV, vec2(1.0) - halfTexel));

    vec3 currentWorking = rgbToYCoCg(current.rgb);
    vec3 neighborhoodMin = currentWorking;
    vec3 neighborhoodMax = currentWorking;
    vec3 moment1 = currentWorking;
    vec3 moment2 = currentWorking * currentWorking;
    vec3 crossSum = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            if (x == 0 && y == 0) continue;
            ivec2 coordinate = clamp(pixel + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            vec3 sampleWorking = rgbToYCoCg(texelFetch(u_scene, coordinate, 0).rgb);
            neighborhoodMin = min(neighborhoodMin, sampleWorking);
            neighborhoodMax = max(neighborhoodMax, sampleWorking);
            moment1 += sampleWorking;
            moment2 += sampleWorking * sampleWorking;
            if (abs(x) + abs(y) == 1) crossSum += sampleWorking;
        }
    }

    vec3 mean = moment1 / 9.0;
    vec3 deviation = sqrt(max(moment2 / 9.0 - mean * mean, vec3(0.0)));
    vec3 clipMin = max(neighborhoodMin, mean - deviation * u_varianceGamma);
    vec3 clipMax = min(neighborhoodMax, mean + deviation * u_varianceGamma);
    vec2 sampledHistoryUV = clamp(historyUV, halfTexel, vec2(1.0) - halfTexel);
    vec4 sampledPrevious = textureLod(u_history, sampledHistoryUV, 0.0);
    vec4 previous = inside ? sampledPrevious : current;
    vec3 previousWorking = clamp(rgbToYCoCg(previous.rgb), clipMin, clipMax);

    bool velocityValid = motion.z >= 0.0;
    float depthError = velocityValid && inside
        ? minimumHistoryDepthError(historyUV, motion.z)
        : 1e20;
    float accepted = velocityValid && inside && depthError <= u_depthThreshold ? 1.0 : 0.0;
    float velocityPixels = length(motion.xy * vec2(dimensions));
    float motionResponse = clamp(velocityPixels / 32.0, 0.0, 1.0);
    float temporalWeight = mix(u_historyWeight, min(u_historyWeight, 0.6), motionResponse);
    float luminanceDelta = abs(previousWorking.x - currentWorking.x) /
        max(max(abs(previousWorking.x), abs(currentWorking.x)), 0.1);
    float reactive = clamp(luminanceDelta * 1.5, 0.0, 1.0);
    float authoredReactive = dilatedReactiveMask(pixel, dimensions);
    temporalWeight *= 1.0 - max(reactive * 0.8, authoredReactive);

    vec3 resolvedWorking = mix(currentWorking, previousWorking, temporalWeight * accepted);
    vec3 resolved = max(yCoCgToRgb(resolvedWorking), vec3(0.0));
    vec3 crossAverage = crossSum * 0.25;
    vec3 sharpenedWorking = resolvedWorking +
        (resolvedWorking - crossAverage) * u_sharpness;
    vec3 sharpened = max(yCoCgToRgb(sharpenedWorking), vec3(0.0));
    historyColor = vec4(resolved, current.a);
    resolvedColor = vec4(sharpened, current.a);
    historyDepth = motion.w;
}`;

const TAAU_RECONSTRUCTION = `
vec4 sampleReconstructedScene(vec2 uv) {
    ivec2 dimensions = textureSize(u_scene, 0);
    vec2 position = uv * vec2(dimensions) - 0.5;
    ivec2 base = ivec2(floor(position));
    vec2 fraction = fract(position);
    vec4 weightX = vec4(
        -0.5 * fraction.x + fraction.x * fraction.x - 0.5 * fraction.x * fraction.x * fraction.x,
        1.0 - 2.5 * fraction.x * fraction.x + 1.5 * fraction.x * fraction.x * fraction.x,
        0.5 * fraction.x + 2.0 * fraction.x * fraction.x - 1.5 * fraction.x * fraction.x * fraction.x,
        -0.5 * fraction.x * fraction.x + 0.5 * fraction.x * fraction.x * fraction.x
    );
    vec4 weightY = vec4(
        -0.5 * fraction.y + fraction.y * fraction.y - 0.5 * fraction.y * fraction.y * fraction.y,
        1.0 - 2.5 * fraction.y * fraction.y + 1.5 * fraction.y * fraction.y * fraction.y,
        0.5 * fraction.y + 2.0 * fraction.y * fraction.y - 1.5 * fraction.y * fraction.y * fraction.y,
        -0.5 * fraction.y * fraction.y + 0.5 * fraction.y * fraction.y * fraction.y
    );
    vec4 result = vec4(0.0);
    for (int y = 0; y < 4; y++) {
        for (int x = 0; x < 4; x++) {
            ivec2 coordinate = clamp(
                base + ivec2(x - 1, y - 1),
                ivec2(0),
                dimensions - ivec2(1)
            );
            result += texelFetch(u_scene, coordinate, 0) * weightX[x] * weightY[y];
        }
    }
    return result;
}

ivec2 currentPixel(vec2 uv) {
    ivec2 dimensions = textureSize(u_scene, 0);
    return clamp(ivec2(uv * vec2(dimensions)), ivec2(0), dimensions - ivec2(1));
}`;

const TAAU_INITIALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_velocity;
uniform sampler2D u_sceneDepth;
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;
${TAAU_RECONSTRUCTION}
void main() {
    ivec2 pixel = currentPixel(v_uv);
    vec4 current = sampleReconstructedScene(v_uv);
    vec4 motion = texelFetch(u_velocity, pixel, 0);
    historyColor = vec4(max(current.rgb, vec3(0.0)), clamp(current.a, 0.0, 1.0));
    resolvedColor = historyColor;
    historyDepth = motion.w;
    gl_FragDepth = texelFetch(u_sceneDepth, pixel, 0).r;
}`;

const TAAU_RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_history;
uniform sampler2D u_velocity;
uniform sampler2D u_historyDepth;
uniform sampler2D u_sceneDepth;
uniform sampler2D u_reactiveMask;
${TEMPORAL_AA_BLOCK}
layout(location = 0) out vec4 historyColor;
layout(location = 1) out vec4 resolvedColor;
layout(location = 2) out float historyDepth;
${TAAU_RECONSTRUCTION}

vec3 rgbToYCoCg(vec3 value) {
    return vec3(
        dot(value, vec3(0.25, 0.5, 0.25)),
        dot(value, vec3(0.5, 0.0, -0.5)),
        dot(value, vec3(-0.25, 0.5, -0.25))
    );
}

vec3 yCoCgToRgb(vec3 value) {
    return vec3(value.x + value.y - value.z, value.x + value.z, value.x - value.y - value.z);
}

float relativeDepthError(float historyLogDepth, float expectedLogDepth) {
    float historyLinear = exp2(max(historyLogDepth, 0.0)) - 1.0;
    float expectedLinear = exp2(max(expectedLogDepth, 0.0)) - 1.0;
    return abs(historyLinear - expectedLinear) / max(expectedLinear, 1e-3);
}

float minimumHistoryDepthError(vec2 historyUV, float expectedLogDepth) {
    ivec2 dimensions = textureSize(u_historyDepth, 0);
    vec2 samplePosition = historyUV * vec2(dimensions) - 0.5;
    ivec2 base = ivec2(floor(samplePosition));
    float error = 1e20;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 coordinate = clamp(base + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            error = min(
                error,
                relativeDepthError(texelFetch(u_historyDepth, coordinate, 0).r, expectedLogDepth)
            );
        }
    }
    return error;
}

float dilatedReactiveMask(ivec2 pixel, ivec2 dimensions) {
    float reactive = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 coordinate = clamp(pixel + ivec2(x, y), ivec2(0), dimensions - ivec2(1));
            reactive = max(reactive, texelFetch(u_reactiveMask, coordinate, 0).r);
        }
    }
    return reactive;
}

void main() {
    ivec2 currentDimensions = textureSize(u_scene, 0);
    ivec2 historyDimensions = textureSize(u_history, 0);
    ivec2 pixel = currentPixel(v_uv);
    vec4 current = sampleReconstructedScene(v_uv);
    vec4 motion = texelFetch(u_velocity, pixel, 0);
    vec2 historyUV = v_uv - motion.xy;
    vec2 halfHistoryTexel = 0.5 / vec2(historyDimensions);
    bool inside = all(greaterThanEqual(historyUV, halfHistoryTexel)) &&
        all(lessThanEqual(historyUV, vec2(1.0) - halfHistoryTexel));

    vec3 currentWorking = rgbToYCoCg(current.rgb);
    vec3 neighborhoodMin = currentWorking;
    vec3 neighborhoodMax = currentWorking;
    vec3 moment1 = currentWorking;
    vec3 moment2 = currentWorking * currentWorking;
    vec3 crossSum = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            if (x == 0 && y == 0) continue;
            ivec2 coordinate = clamp(
                pixel + ivec2(x, y),
                ivec2(0),
                currentDimensions - ivec2(1)
            );
            vec3 sampleWorking = rgbToYCoCg(texelFetch(u_scene, coordinate, 0).rgb);
            neighborhoodMin = min(neighborhoodMin, sampleWorking);
            neighborhoodMax = max(neighborhoodMax, sampleWorking);
            moment1 += sampleWorking;
            moment2 += sampleWorking * sampleWorking;
            if (abs(x) + abs(y) == 1) crossSum += sampleWorking;
        }
    }

    vec3 mean = moment1 / 9.0;
    vec3 deviation = sqrt(max(moment2 / 9.0 - mean * mean, vec3(0.0)));
    vec3 clipMin = max(neighborhoodMin, mean - deviation * u_varianceGamma);
    vec3 clipMax = min(neighborhoodMax, mean + deviation * u_varianceGamma);
    vec2 sampledHistoryUV = clamp(
        historyUV,
        halfHistoryTexel,
        vec2(1.0) - halfHistoryTexel
    );
    vec4 sampledPrevious = textureLod(u_history, sampledHistoryUV, 0.0);
    vec4 previous = inside ? sampledPrevious : current;
    vec3 previousWorking = clamp(rgbToYCoCg(previous.rgb), clipMin, clipMax);

    bool velocityValid = motion.z >= 0.0;
    float depthError = velocityValid && inside
        ? minimumHistoryDepthError(historyUV, motion.z)
        : 1e20;
    float accepted = velocityValid && inside && depthError <= u_depthThreshold ? 1.0 : 0.0;
    float velocityPixels = length(motion.xy * vec2(historyDimensions));
    float motionResponse = clamp(velocityPixels / 32.0, 0.0, 1.0);
    float temporalWeight = mix(u_historyWeight, min(u_historyWeight, 0.6), motionResponse);
    float luminanceDelta = abs(previousWorking.x - currentWorking.x) /
        max(max(abs(previousWorking.x), abs(currentWorking.x)), 0.1);
    float reactive = clamp(luminanceDelta * 1.5, 0.0, 1.0);
    float authoredReactive = dilatedReactiveMask(pixel, currentDimensions);
    temporalWeight *= 1.0 - max(reactive * 0.8, authoredReactive);

    vec3 resolvedWorking = mix(currentWorking, previousWorking, temporalWeight * accepted);
    vec3 resolved = max(yCoCgToRgb(resolvedWorking), vec3(0.0));
    vec3 crossAverage = crossSum * 0.25;
    vec3 sharpenedWorking = resolvedWorking +
        (resolvedWorking - crossAverage) * u_sharpness;
    vec3 sharpened = max(yCoCgToRgb(sharpenedWorking), vec3(0.0));
    historyColor = vec4(resolved, clamp(current.a, 0.0, 1.0));
    resolvedColor = vec4(sharpened, clamp(current.a, 0.0, 1.0));
    historyDepth = motion.w;
    gl_FragDepth = texelFetch(u_sceneDepth, pixel, 0).r;
}`;

registerUniformBlockBinding('TemporalAABlock');

const temporalAALayout = createStd140Layout({
    u_historyWeight: 'float',
    u_depthThreshold: 'float',
    u_varianceGamma: 'float',
    u_sharpness: 'float'
});

const OUTPUT_EXTENT: RenderPipelineExtent = Object.freeze({
    relativeTo: 'output' as const,
    scale: 1
});
/** @internal Return the fixed internal extent used by one temporal configuration. */
export function temporalInputExtent(renderScale: number): RenderPipelineExtent {
    return Object.freeze({ relativeTo: 'output' as const, scale: renderScale });
}

/** @internal Return the motion/depth descriptor matching one temporal input scale. */
export function temporalMotionDescriptor(
    renderScale: number
): Readonly<RenderPipelineTextureDescriptor> {
    return Object.freeze({
        format: 'rgba16float' as const,
        extent: temporalInputExtent(renderScale)
    });
}

/** @internal Return the authored reactive-mask descriptor matching one temporal input scale. */
export function temporalReactiveMaskDescriptor(
    renderScale: number
): Readonly<RenderPipelineTextureDescriptor> {
    return Object.freeze({
        format: 'r8unorm' as const,
        extent: temporalInputExtent(renderScale)
    });
}

/** @internal Motion XY, expected previous log2 view depth, and current log2 view depth. */
export const TEMPORAL_MOTION_DESCRIPTOR = temporalMotionDescriptor(1);
const RESOLVED_DESCRIPTOR = Object.freeze({
    format: 'rgba16float' as const,
    extent: OUTPUT_EXTENT
});
const COLOR_HISTORY_DESCRIPTOR = Object.freeze({
    label: 'TemporalAA color history',
    format: 'rgba16float' as const,
    extent: OUTPUT_EXTENT,
    usage: Object.freeze(['sampled' as const, 'attachment' as const]),
    bufferCount: 2 as const
});
const DEPTH_HISTORY_DESCRIPTOR = Object.freeze({
    label: 'TemporalAA linear-depth history',
    format: 'r32float' as const,
    extent: OUTPUT_EXTENT,
    usage: Object.freeze(['sampled' as const, 'attachment' as const]),
    bufferCount: 2 as const
});
const CLEAR_ZERO = Object.freeze({ r: 0, g: 0, b: 0, a: 0 });
/** @internal Clear value that marks pixels without a valid previous surface. */
export const TEMPORAL_MOTION_CLEAR = Object.freeze({ r: 0, g: 0, b: -1, a: 0 });
const CAMERA_HISTORY_RETENTION_FRAMES = 2;
const PROJECTION_CUT_THRESHOLD = 0.1;

const JITTER_SEQUENCE: readonly Readonly<{ x: number; y: number }>[] = Object.freeze([
    Object.freeze({ x: 0, y: -1 / 6 }),
    Object.freeze({ x: -1 / 4, y: 1 / 6 }),
    Object.freeze({ x: 1 / 4, y: -7 / 18 }),
    Object.freeze({ x: -3 / 8, y: -1 / 18 }),
    Object.freeze({ x: 1 / 8, y: 5 / 18 }),
    Object.freeze({ x: -1 / 8, y: -5 / 18 }),
    Object.freeze({ x: 3 / 8, y: 1 / 18 }),
    Object.freeze({ x: -7 / 16, y: 7 / 18 })
]);

interface CameraTemporalState {
    readonly camera: Camera;
    readonly colorHistoryKey: object;
    readonly depthHistoryKey: object;
    readonly committedProjection: Float32Array;
    readonly pendingProjection: Float32Array;
    committedTransformRevision: number;
    committedJitterIndex: number;
    committedSubmission: number;
    committedRenderScale: number;
    pendingTransformRevision: number;
    pendingJitterIndex: number;
    pendingFrame: number;
    pendingRenderScale: number;
    lastTouchedFrame: number;
}

/** @internal Resources staged for one temporal resolve invocation. */
export interface TemporalResolveFrame {
    readonly state: CameraTemporalState;
    readonly historyValid: boolean;
    readonly colorHistory: RenderPipelineHistoryTextureResources;
    readonly depthHistory: RenderPipelineHistoryTextureResources;
    readonly renderScale: number;
}

interface MutableVelocityColorAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

interface MutableVelocityDepthAttachment extends RenderPipelineDepthStencilAttachment {
    texture: RenderGraphTextureHandle;
    stencilReadOnly?: boolean;
}

class VelocityPassParameters implements SceneRenderPassParameters {
    rendererList = 0 as SceneRenderPassParameters['rendererList'];
    readonly colorAttachments: MutableVelocityColorAttachment[] = [
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: TEMPORAL_MOTION_CLEAR
        },
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        }
    ];
    readonly depthStencilAttachment: MutableVelocityDepthAttachment = {
        texture: 0 as RenderGraphTextureHandle,
        depthReadOnly: true
    };

    configure(
        rendererList: SceneRenderPassParameters['rendererList'],
        velocity: RenderGraphTextureHandle,
        reactiveMask: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle,
        stencilReadOnly: boolean
    ): void {
        this.rendererList = rendererList;
        const color = this.colorAttachments[0];
        if (color === undefined) throw new Error('TemporalAA velocity attachment is unavailable');
        color.texture = velocity;
        const reactive = this.colorAttachments[1];
        if (reactive === undefined) {
            throw new Error('TemporalAA reactive-mask attachment is unavailable');
        }
        reactive.texture = reactiveMask;
        this.depthStencilAttachment.texture = depth;
        if (stencilReadOnly) this.depthStencilAttachment.stencilReadOnly = true;
        else delete this.depthStencilAttachment.stencilReadOnly;
    }
}

interface MutableTemporalColorAttachment extends RenderPipelineColorAttachment {
    texture: RenderGraphTextureHandle;
}

interface MutableTemporalDepthAttachment extends RenderPipelineDepthStencilAttachment {
    texture: RenderGraphTextureHandle;
    depthLoadOp: 'clear';
    depthStoreOp: 'store';
    depthClearValue: number;
    stencilLoadOp?: 'clear';
    stencilStoreOp?: 'store';
    stencilClearValue?: number;
}

class TemporalResolveParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: MutableTemporalColorAttachment[] = [
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        },
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        },
        {
            texture: 0 as RenderGraphTextureHandle,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: CLEAR_ZERO
        }
    ];
    readonly #resolvedDepth: MutableTemporalDepthAttachment = {
        texture: 0 as RenderGraphTextureHandle,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
        depthClearValue: 1
    };
    depthStencilAttachment?: MutableTemporalDepthAttachment;

    configure(
        inputs: readonly RenderGraphTextureAccessHandle[],
        colorHistory: RenderGraphTextureHandle,
        resolved: RenderGraphTextureHandle,
        depthHistory: RenderGraphTextureHandle,
        resolvedDepth: RenderGraphTextureHandle | null,
        resolvedDepthFormat: RenderTargetDepthStencilFormat | null,
        resolvedDepthClearValue: number
    ): void {
        this.inputTextures.length = inputs.length;
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index];
            if (input === undefined)
                throw new TypeError('TemporalAA input array must not be sparse');
            this.inputTextures[index] = input;
        }
        const colorAttachment = this.colorAttachments[0];
        const resolvedAttachment = this.colorAttachments[1];
        const depthAttachment = this.colorAttachments[2];
        if (
            colorAttachment === undefined ||
            resolvedAttachment === undefined ||
            depthAttachment === undefined
        ) {
            throw new Error('TemporalAA resolve attachments are incomplete');
        }
        colorAttachment.texture = colorHistory;
        resolvedAttachment.texture = resolved;
        depthAttachment.texture = depthHistory;
        if (resolvedDepth === null || resolvedDepthFormat === null) {
            delete this.depthStencilAttachment;
            return;
        }
        const attachment = this.#resolvedDepth;
        attachment.texture = resolvedDepth;
        attachment.depthClearValue = resolvedDepthClearValue;
        if (renderTargetFormatHasStencil(resolvedDepthFormat)) {
            attachment.stencilLoadOp = 'clear';
            attachment.stencilStoreOp = 'store';
            attachment.stencilClearValue = 0;
        } else {
            delete attachment.stencilLoadOp;
            delete attachment.stencilStoreOp;
            delete attachment.stencilClearValue;
        }
        this.depthStencilAttachment = attachment;
    }

    reset(): void {
        this.inputTextures.length = 0;
        delete this.depthStencilAttachment;
    }
}

/** GPU-time-driven dynamic-resolution controls. */
export interface DynamicResolutionOptions {
    /** Lowest internal resolution scale. Defaults to 0.5. */
    readonly minScale?: number;
    /** Highest internal resolution scale. Defaults to 1. */
    readonly maxScale?: number;
    /** Initial scale before enough GPU samples are available. Defaults to `maxScale`. */
    readonly initialScale?: number;
    /** Target summed profiled Render Graph render/compute duration in milliseconds. Defaults to 16.667. */
    readonly targetFrameTimeMs?: number;
    /** Symmetric no-change band around the target, as a ratio. Defaults to 0.1. */
    readonly hysteresis?: number;
    /** EWMA contribution of the newest GPU sample. Defaults to 0.2. */
    readonly response?: number;
    /** Quantized scale adjustment applied at each decision. Defaults to 0.05. */
    readonly scaleStep?: number;
    /** Successful GPU samples required before the first decision. Defaults to 6. */
    readonly warmupFrames?: number;
    /** Minimum GPU samples between scale changes. Defaults to 8. */
    readonly settlingFrames?: number;
}

interface DynamicResolutionSettings {
    readonly minScale: number;
    readonly maxScale: number;
    readonly initialScale: number;
    readonly targetFrameTimeMs: number;
    readonly hysteresis: number;
    readonly response: number;
    readonly scaleStep: number;
    readonly warmupFrames: number;
    readonly settlingFrames: number;
}

/** Temporal anti-aliasing, temporal upscaling, and optional dynamic-resolution controls. */
export interface TemporalAAOptions {
    /**
     * Internal scene resolution relative to the output. Values below one enable TAAU. When
     * `dynamicResolution` is present this overrides that object's initial scale.
     * Defaults to 1 and is constrained to the inclusive range 0.5–1.
     */
    readonly renderScale?: number;
    /** GPU timestamp driven dynamic resolution. Omit or use false for a fixed render scale. */
    readonly dynamicResolution?: Readonly<DynamicResolutionOptions> | false;
    /** Maximum accepted history contribution after rejection. Defaults to 0.92. */
    readonly historyWeight?: number;
    /** Maximum relative previous-view-depth error. Defaults to 0.02. */
    readonly depthThreshold?: number;
    /** Standard-deviation extent used by YCoCg variance clipping. Defaults to 1.25. */
    readonly varianceGamma?: number;
    /** Resolve-only contrast restoration; history remains unsharpened. Defaults to 0.08. */
    readonly sharpness?: number;
}

/** @internal Immutable temporal settings shared by Forward and GPU Scene pipelines. */
export interface TemporalAASettings {
    readonly renderScale: number;
    readonly minimumRenderScale: number;
    readonly dynamicResolution: Readonly<DynamicResolutionSettings> | null;
    readonly historyWeight: number;
    readonly depthThreshold: number;
    readonly varianceGamma: number;
    readonly sharpness: number;
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

function positiveInteger(value: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${label} must be a positive safe integer`);
    }
    return value;
}

function snapshotDynamicResolutionOptions(
    options: Readonly<DynamicResolutionOptions>,
    renderScale: number | undefined
): Readonly<DynamicResolutionSettings> {
    const minScale = finiteRange(options.minScale ?? 0.5, 0.5, 1, 'Dynamic resolution minScale');
    const maxScale = finiteRange(options.maxScale ?? 1, 0.5, 1, 'Dynamic resolution maxScale');
    if (minScale > maxScale) {
        throw new RangeError('Dynamic resolution minScale must not exceed maxScale');
    }
    const initialScale = finiteRange(
        renderScale ?? options.initialScale ?? maxScale,
        minScale,
        maxScale,
        'Dynamic resolution initialScale'
    );
    return Object.freeze({
        minScale,
        maxScale,
        initialScale,
        targetFrameTimeMs: finiteRange(
            options.targetFrameTimeMs ?? 16.667,
            1,
            1000,
            'Dynamic resolution targetFrameTimeMs'
        ),
        hysteresis: finiteRange(options.hysteresis ?? 0.1, 0, 0.5, 'Dynamic resolution hysteresis'),
        response: finiteRange(options.response ?? 0.2, 0.01, 1, 'Dynamic resolution response'),
        scaleStep: finiteRange(
            options.scaleStep ?? 0.05,
            0.01,
            0.25,
            'Dynamic resolution scaleStep'
        ),
        warmupFrames: positiveInteger(options.warmupFrames ?? 6, 'Dynamic resolution warmupFrames'),
        settlingFrames: positiveInteger(
            options.settlingFrames ?? 8,
            'Dynamic resolution settlingFrames'
        )
    });
}

/** @internal Validate and freeze public temporal options. */
export function snapshotTemporalAAOptions(
    options: Readonly<TemporalAAOptions>
): TemporalAASettings {
    const fixedRenderScale = finiteRange(
        options.renderScale ?? 1,
        0.5,
        1,
        'TemporalAA renderScale'
    );
    const dynamicResolution =
        options.dynamicResolution === undefined || options.dynamicResolution === false
            ? null
            : snapshotDynamicResolutionOptions(options.dynamicResolution, options.renderScale);
    return Object.freeze({
        renderScale: dynamicResolution?.initialScale ?? fixedRenderScale,
        minimumRenderScale: dynamicResolution?.minScale ?? fixedRenderScale,
        dynamicResolution,
        historyWeight: finiteRange(options.historyWeight ?? 0.92, 0, 1, 'TemporalAA historyWeight'),
        depthThreshold: finiteRange(
            options.depthThreshold ?? 0.02,
            0,
            1,
            'TemporalAA depthThreshold'
        ),
        varianceGamma: finiteRange(
            options.varianceGamma ?? 1.25,
            0.25,
            4,
            'TemporalAA varianceGamma'
        ),
        sharpness: finiteRange(options.sharpness ?? 0.08, 0, 0.5, 'TemporalAA sharpness')
    });
}

/** Stable adaptive-resolution telemetry for renderer diagnostics. */
export interface DynamicResolutionDiagnostics {
    /** Current internal scene resolution relative to the output. */
    readonly renderScale: number;
    /** EWMA of accepted profiled Render Graph GPU work, or null before the first sample. */
    readonly smoothedGPUFrameTimeMs: number | null;
    /** Number of distinct ready GPU timeline samples accepted by this controller. */
    readonly sampledFrameCount: number;
}

class DynamicResolutionController {
    readonly #settings: Readonly<DynamicResolutionSettings>;
    #renderScale: number;
    #smoothedGPUFrameTimeMs: number | null = null;
    #sampledFrameCount = 0;
    #lastSampledFrame = -1;
    #samplesSinceChange = Number.POSITIVE_INFINITY;
    #destroyed = false;

    constructor(settings: Readonly<DynamicResolutionSettings>) {
        this.#settings = settings;
        this.#renderScale = settings.initialScale;
    }

    get renderScale(): number {
        return this.#renderScale;
    }

    get diagnostics(): Readonly<DynamicResolutionDiagnostics> {
        return Object.freeze({
            renderScale: this.#renderScale,
            smoothedGPUFrameTimeMs: this.#smoothedGPUFrameTimeMs,
            sampledFrameCount: this.#sampledFrameCount
        });
    }

    record(snapshot: Readonly<RenderGraphTimelineSnapshot>): void {
        if (
            this.#destroyed ||
            snapshot.gpuStatus !== 'ready' ||
            snapshot.frameIndex <= this.#lastSampledFrame
        ) {
            return;
        }
        let durationMs = 0;
        let timestampCount = 0;
        for (const pass of snapshot.passes) {
            if (pass.gpuDurationMs === null) continue;
            durationMs += pass.gpuDurationMs;
            timestampCount++;
        }
        if (timestampCount === 0 || !Number.isFinite(durationMs) || durationMs <= 0) return;
        this.#lastSampledFrame = snapshot.frameIndex;
        this.#sampledFrameCount++;
        this.#samplesSinceChange++;
        this.#smoothedGPUFrameTimeMs =
            this.#smoothedGPUFrameTimeMs === null
                ? durationMs
                : this.#smoothedGPUFrameTimeMs +
                  (durationMs - this.#smoothedGPUFrameTimeMs) * this.#settings.response;
        if (this.#sampledFrameCount < this.#settings.warmupFrames) return;
        if (this.#samplesSinceChange < this.#settings.settlingFrames) {
            return;
        }
        const lower = this.#settings.targetFrameTimeMs * (1 - this.#settings.hysteresis);
        const upper = this.#settings.targetFrameTimeMs * (1 + this.#settings.hysteresis);
        let next = this.#renderScale;
        if (this.#smoothedGPUFrameTimeMs > upper) {
            next = Math.max(this.#settings.minScale, next - this.#settings.scaleStep);
        } else if (this.#smoothedGPUFrameTimeMs < lower) {
            next = Math.min(this.#settings.maxScale, next + this.#settings.scaleStep);
        }
        next = Math.round(next * 10000) / 10000;
        if (Math.abs(next - this.#renderScale) <= 1e-6) return;
        this.#renderScale = next;
        this.#samplesSinceChange = 0;
    }

    destroy(): void {
        this.#destroyed = true;
    }
}

/** Static requirements shared by every pipeline that uses the built-in temporal resolve. */
export const TEMPORAL_AA_REQUIREMENTS = Object.freeze({
    requiredLimits: Object.freeze({ maxColorAttachments: 3 }),
    requiredTextureFormats: Object.freeze([
        Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const }),
        Object.freeze({ format: 'r32float' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'r32float' as const, use: 'sampled' as const }),
        Object.freeze({ format: 'r8unorm' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'r8unorm' as const, use: 'sampled' as const })
    ])
}) satisfies Readonly<RenderPipelineRequirements>;

function projectionCut(previous: ArrayLike<number>, current: ArrayLike<number>): boolean {
    // Any depth mapping change invalidates linear-depth history. XY scale/offset changes are
    // reprojectable until they cross a deliberate cut threshold.
    for (const index of [10, 11, 14, 15]) {
        if (Math.abs((previous[index] ?? 0) - (current[index] ?? 0)) > 1e-6) return true;
    }
    for (const index of [0, 4, 5, 8, 9, 12, 13]) {
        const before = previous[index] ?? 0;
        const after = current[index] ?? 0;
        const scale = Math.max(Math.abs(before), Math.abs(after), 1e-6);
        if (Math.abs(before - after) / scale > PROJECTION_CUT_THRESHOLD) return true;
    }
    return false;
}

/**
 * @internal Submission-aware temporal history and resolve controller shared by rendering paths.
 */
export class TemporalResolveController {
    readonly #block: UniformBuffer<typeof temporalAALayout.schema>;
    readonly #initializePass: FullscreenRenderPass;
    readonly #resolvePass: FullscreenRenderPass;
    readonly #upscaleInitializePass: FullscreenRenderPass;
    readonly #upscaleResolvePass: FullscreenRenderPass;
    readonly #dynamicResolution: DynamicResolutionController | null;
    readonly #fixedRenderScale: number;
    readonly #resolvedDepthDescriptor: {
        format: RenderTargetDepthStencilFormat;
        readonly extent: RenderPipelineExtent;
        readonly sampleCount: 1;
    } = {
        format: 'depth24plus',
        extent: OUTPUT_EXTENT,
        sampleCount: 1
    };
    readonly #resolveParameters = new RenderPassParameterPool(
        () => new TemporalResolveParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #states = new WeakMap<Camera, CameraTemporalState>();
    readonly #ownedStates = new Set<CameraTemporalState>();
    readonly #stagedStates: CameraTemporalState[] = [];
    readonly #pendingEvictions: CameraTemporalState[] = [];
    #destroyed = false;
    #submissionIndex = 0;

    constructor(settings: TemporalAASettings) {
        this.#fixedRenderScale = settings.renderScale;
        this.#dynamicResolution =
            settings.dynamicResolution === null
                ? null
                : new DynamicResolutionController(settings.dynamicResolution);
        this.#block = UniformBuffer.fromSchema(temporalAALayout, {
            u_historyWeight: settings.historyWeight,
            u_depthThreshold: settings.depthThreshold,
            u_varianceGamma: settings.varianceGamma,
            u_sharpness: settings.sharpness
        });
        const pass = (
            name: string,
            fs: string,
            uniformBuffers: readonly UniformBuffer[],
            writesDepth = false
        ) =>
            new FullscreenRenderPass({
                name,
                shader: new Shader({ vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE, fs }),
                pipelineState: {
                    ...DEFAULT_MATERIAL_PIPELINE_STATE,
                    depthTest: false,
                    depthWrite: writesDepth,
                    cullMode: 'none'
                },
                uniformBuffers
            });
        this.#initializePass = pass('TemporalAA initialize history', INITIALIZE_FRAGMENT, []);
        this.#resolvePass = pass('TemporalAA production resolve', RESOLVE_FRAGMENT, [this.#block]);
        this.#upscaleInitializePass = pass(
            'TemporalAA upscale initialize history',
            TAAU_INITIALIZE_FRAGMENT,
            [],
            true
        );
        this.#upscaleResolvePass = pass(
            'TemporalAA temporal upscale',
            TAAU_RESOLVE_FRAGMENT,
            [this.#block],
            true
        );
    }

    /** Current internal scene scale, including the last accepted GPU timing decision. */
    get renderScale(): number {
        return this.#dynamicResolution?.renderScale ?? this.#fixedRenderScale;
    }

    /** Current dynamic-resolution telemetry, or null for a fixed-scale controller. */
    get dynamicResolutionDiagnostics(): Readonly<DynamicResolutionDiagnostics> | null {
        return this.#dynamicResolution?.diagnostics ?? null;
    }

    /** Consume an asynchronous Render Graph timeline snapshot. */
    recordRenderGraphTimeline(snapshot: Readonly<RenderGraphTimelineSnapshot>): void {
        this.#dynamicResolution?.record(snapshot);
    }

    begin(context: RenderPipelineContext): TemporalResolveFrame {
        if (this.#destroyed) throw new Error('TemporalAA resolve controller is destroyed');
        const [x, y, width, height] = context.viewport;
        if (
            x !== 0 ||
            y !== 0 ||
            width !== context.output.width ||
            height !== context.output.height
        ) {
            throw new Error('TemporalAA currently requires a full-output viewport');
        }
        this.sweepInactiveStates(context, context.camera);
        const renderScale = this.renderScale;
        const inputWidth = Math.max(1, Math.floor(width * renderScale));
        const inputHeight = Math.max(1, Math.floor(height * renderScale));
        const state = this.stageCamera(
            context.camera,
            context.frameIndex,
            inputWidth,
            inputHeight,
            renderScale
        );
        const transformRevision = getTransformHistoryRevision(context.camera);
        const discontinuous =
            state.committedSubmission >= 0 &&
            (state.committedSubmission !== this.#submissionIndex ||
                state.committedTransformRevision !== transformRevision ||
                Math.abs(state.committedRenderScale - renderScale) > 1e-6 ||
                projectionCut(state.committedProjection, context.camera.projectionMatrix.elements));
        if (discontinuous) {
            context.graph.invalidateHistoryTexture(state.colorHistoryKey);
            context.graph.invalidateHistoryTexture(state.depthHistoryKey);
        }
        const colorHistory = context.graph.acquireHistoryTexture(
            state.colorHistoryKey,
            COLOR_HISTORY_DESCRIPTOR
        );
        const depthHistory = context.graph.acquireHistoryTexture(
            state.depthHistoryKey,
            DEPTH_HISTORY_DESCRIPTOR
        );
        this.validateHistoryPair(colorHistory, depthHistory);
        return Object.freeze({
            state,
            historyValid: !discontinuous && colorHistory.valid && depthHistory.valid,
            colorHistory,
            depthHistory,
            renderScale
        });
    }

    resolve(
        context: RenderPipelineContext,
        frame: TemporalResolveFrame,
        scene: RenderGraphTextureHandle,
        velocity: RenderGraphTextureHandle,
        reactiveMask: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle,
        depthFormat: RenderTargetDepthStencilFormat
    ): TemporalResolveResult {
        if (frame.state.pendingFrame !== context.frameIndex) {
            throw new Error('TemporalAA resolve frame belongs to another application frame');
        }
        const resolved = context.graph.createTexture(
            'TemporalAA resolved color',
            RESOLVED_DESCRIPTOR
        );
        const upscales = frame.renderScale < 1;
        this.#resolvedDepthDescriptor.format = depthFormat;
        const resolvedDepth = upscales
            ? context.graph.createTexture(
                  'TemporalAA resolved full-resolution depth',
                  this.#resolvedDepthDescriptor
              )
            : null;
        const parameters = context.acquirePassParameters(this.#resolveParameters);
        parameters.configure(
            frame.historyValid
                ? upscales
                    ? [
                          scene,
                          frame.colorHistory.history(),
                          velocity,
                          frame.depthHistory.history(),
                          depth,
                          reactiveMask
                      ]
                    : [
                          scene,
                          frame.colorHistory.history(),
                          velocity,
                          frame.depthHistory.history(),
                          reactiveMask
                      ]
                : [scene, velocity, ...(upscales ? [depth] : [])],
            frame.colorHistory.current,
            resolved,
            frame.depthHistory.current,
            resolvedDepth,
            upscales ? depthFormat : null,
            depthClearValue(context.camera.depthMode)
        );
        context.graph.addPass(
            upscales
                ? frame.historyValid
                    ? this.#upscaleResolvePass
                    : this.#upscaleInitializePass
                : frame.historyValid
                  ? this.#resolvePass
                  : this.#initializePass,
            parameters
        );
        return Object.freeze({ color: resolved, depth: resolvedDepth ?? depth });
    }

    frameSubmitted(frameIndex: number): void {
        const committedSubmission = this.#submissionIndex + 1;
        for (const state of this.#stagedStates) {
            if (state.pendingFrame !== frameIndex) continue;
            state.committedTransformRevision = state.pendingTransformRevision;
            state.committedJitterIndex = (state.pendingJitterIndex + 1) % JITTER_SEQUENCE.length;
            state.committedProjection.set(state.pendingProjection);
            state.committedRenderScale = state.pendingRenderScale;
            state.committedSubmission = committedSubmission;
            state.pendingFrame = -1;
            state.camera.clearProjectionJitter();
        }
        for (const state of this.#pendingEvictions) {
            this.#states.delete(state.camera);
            this.#ownedStates.delete(state);
            state.camera.clearProjectionJitter();
        }
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
        this.#submissionIndex = committedSubmission;
    }

    frameDiscarded(frameIndex: number): void {
        for (const state of this.#stagedStates) {
            if (state.pendingFrame !== frameIndex) continue;
            state.pendingFrame = -1;
            state.camera.clearProjectionJitter();
        }
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const state of this.#ownedStates) state.camera.clearProjectionJitter();
        this.#ownedStates.clear();
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
        this.#dynamicResolution?.destroy();
        this.#destroyed = true;
    }

    private stageCamera(
        camera: Camera,
        frameIndex: number,
        width: number,
        height: number,
        renderScale: number
    ): CameraTemporalState {
        let state = this.#states.get(camera);
        if (state === undefined) {
            state = {
                camera,
                colorHistoryKey: Object.freeze({}),
                depthHistoryKey: Object.freeze({}),
                committedProjection: new Float32Array(16),
                pendingProjection: new Float32Array(16),
                committedTransformRevision: -1,
                committedJitterIndex: 0,
                committedSubmission: -1,
                committedRenderScale: renderScale,
                pendingTransformRevision: -1,
                pendingJitterIndex: 0,
                pendingFrame: -1,
                pendingRenderScale: renderScale,
                lastTouchedFrame: frameIndex
            };
            this.#states.set(camera, state);
            this.#ownedStates.add(state);
        }
        if (state.pendingFrame === frameIndex) {
            throw new Error(
                'TemporalAA supports one invocation per camera in an application frame'
            );
        }
        state.pendingFrame = frameIndex;
        state.pendingRenderScale = renderScale;
        state.lastTouchedFrame = frameIndex;
        state.pendingTransformRevision = getTransformHistoryRevision(camera);
        state.pendingJitterIndex = state.committedJitterIndex;
        state.pendingProjection.set(camera.projectionMatrix.elements);
        this.#stagedStates.push(state);
        const jitter = JITTER_SEQUENCE[state.pendingJitterIndex];
        if (jitter === undefined) throw new Error('TemporalAA jitter sequence is incomplete');
        camera.setProjectionJitter((jitter.x * 2) / width, (jitter.y * 2) / height);
        return state;
    }

    private sweepInactiveStates(context: RenderPipelineContext, activeCamera: Camera): void {
        for (const state of this.#ownedStates) {
            if (
                state.camera === activeCamera ||
                state.pendingFrame >= 0 ||
                state.lastTouchedFrame >= context.frameIndex - CAMERA_HISTORY_RETENTION_FRAMES ||
                this.#pendingEvictions.includes(state)
            ) {
                continue;
            }
            context.graph.releaseHistoryTexture(state.colorHistoryKey);
            context.graph.releaseHistoryTexture(state.depthHistoryKey);
            this.#pendingEvictions.push(state);
        }
    }

    private validateHistoryPair(
        color: RenderPipelineHistoryTextureResources,
        depth: RenderPipelineHistoryTextureResources
    ): void {
        if (color.valid !== depth.valid || color.generation !== depth.generation) {
            throw new Error('TemporalAA color and depth history generations diverged');
        }
    }
}

/** @internal Full-resolution temporal resolve outputs. */
export interface TemporalResolveResult {
    readonly color: RenderGraphTextureHandle;
    readonly depth: RenderGraphTextureHandle;
}

class TemporalAARuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly usesRenderGraphTimeline: boolean;
    readonly #resolve: TemporalResolveController;
    readonly #onDestroy: (runtime: TemporalAARuntime) => void;
    readonly #velocityPass = new SceneRenderPass('TemporalAA motion vectors');
    readonly #velocityParameters = new RenderPassParameterPool(() => new VelocityPassParameters());
    readonly #inputExtent = { relativeTo: 'output' as const, scale: 1 };
    readonly #motionDescriptor: Readonly<RenderPipelineTextureDescriptor> = {
        format: 'rgba16float',
        extent: this.#inputExtent
    };
    readonly #reactiveMaskDescriptor: Readonly<RenderPipelineTextureDescriptor> = {
        format: 'r8unorm',
        extent: this.#inputExtent
    };
    readonly #rendererListDescriptor: {
        cullingResults: CullingResultsHandle;
        readonly queue: 'opaque';
        readonly sorting: 'material-front-to-back';
        readonly materialPass: 'motion-vector';
    } = {
        cullingResults: 0 as CullingResultsHandle,
        queue: 'opaque',
        sorting: 'material-front-to-back',
        materialPass: 'motion-vector'
    };

    #destroyed = false;

    constructor(settings: TemporalAASettings, onDestroy: (runtime: TemporalAARuntime) => void) {
        this.#resolve = new TemporalResolveController(settings);
        this.usesRenderGraphTimeline = settings.dynamicResolution !== null;
        this.#onDestroy = onDestroy;
    }

    getSceneScale(): number {
        return this.#resolve.renderScale;
    }

    recordRenderGraphTimeline(snapshot: Readonly<RenderGraphTimelineSnapshot>): void {
        this.#resolve.recordRenderGraphTimeline(snapshot);
    }

    get diagnostics(): Readonly<DynamicResolutionDiagnostics> {
        return (
            this.#resolve.dynamicResolutionDiagnostics ??
            Object.freeze({
                renderScale: this.#resolve.renderScale,
                smoothedGPUFrameTimeMs: null,
                sampledFrameCount: 0
            })
        );
    }

    record(context: ForwardRenderFeatureContext): void {
        const pipeline = context.pipeline;
        const scene = context.resources.color;
        const depth = context.resources.depth;
        if (scene === null || depth === null) {
            throw new Error('TemporalAA requires opaque scene color and sampled depth');
        }
        this.#inputExtent.scale = context.resources.sceneScale;
        const frame = this.#resolve.begin(pipeline);
        const velocity = pipeline.graph.createTexture(
            'TemporalAA rgba16float motion and view depth',
            this.#motionDescriptor
        );
        const reactiveMask = pipeline.graph.createTexture(
            'TemporalAA authored reactive mask',
            this.#reactiveMaskDescriptor
        );
        this.#rendererListDescriptor.cullingResults = context.cullingResults;
        const velocityList = pipeline.createRendererList(this.#rendererListDescriptor);
        const velocityParameters = pipeline.acquirePassParameters(this.#velocityParameters);
        velocityParameters.configure(
            velocityList,
            velocity,
            reactiveMask,
            depth,
            pipeline.output.depthStencilFormat !== null &&
                renderTargetFormatHasStencil(pipeline.output.depthStencilFormat)
        );
        pipeline.graph.addPass(this.#velocityPass, velocityParameters);
        context.resources.setMotionDepth(velocity);
        const resolved = this.#resolve.resolve(
            pipeline,
            frame,
            scene,
            velocity,
            reactiveMask,
            depth,
            pipeline.output.depthStencilFormat ?? 'depth24plus'
        );
        context.resources.replaceColor(resolved.color, 'linear');
        if (resolved.depth !== depth) context.resources.replaceDepth(resolved.depth);
    }

    frameSubmitted(frameIndex: number): void {
        this.#resolve.frameSubmitted(frameIndex);
    }

    frameDiscarded(frameIndex: number): void {
        this.#resolve.frameDiscarded(frameIndex);
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#resolve.destroy();
        this.#onDestroy(this);
    }
}

/**
 * Temporal anti-aliasing, temporal upscaling, and GPU-time dynamic-resolution feature.
 *
 * The feature records built-in opaque/masked motion and logarithmic view-depth data after opaque
 * shading, resolves only opaque scene color, then lets transparent rendering and Bloom compose
 * afterward. History uses submission-aware double buffers and is reset by camera cuts, resize,
 * projection discontinuities, visibility gaps, or device recovery.
 */
export class TemporalAA implements ForwardRenderPipelineFeature {
    readonly name = 'temporal-aa';
    readonly injectionPoint = 'after-opaque' as const;
    readonly requirements: Readonly<ForwardRenderFeatureRequirements>;
    readonly #settings: TemporalAASettings;
    readonly #runtimes = new Set<TemporalAARuntime>();

    constructor(options: Readonly<TemporalAAOptions> = {}) {
        this.#settings = snapshotTemporalAAOptions(options);
        this.requirements = Object.freeze({
            sampledSceneColor: true,
            sampledDepth: true,
            sceneScale: this.#settings.minimumRenderScale,
            ...TEMPORAL_AA_REQUIREMENTS,
            ...(this.#settings.dynamicResolution === null
                ? {}
                : { requiredFeatures: Object.freeze(['timestamp-query' as const]) })
        });
    }

    create(): ForwardRenderPipelineFeatureRuntime {
        const runtime = new TemporalAARuntime(this.#settings, destroyed => {
            this.#runtimes.delete(destroyed);
        });
        this.#runtimes.add(runtime);
        return runtime;
    }

    /** Read adaptive-resolution state when this feature is attached to exactly one live Renderer. */
    readDynamicResolutionDiagnostics(): Readonly<DynamicResolutionDiagnostics> {
        if (this.#runtimes.size !== 1) {
            throw new Error(
                'TemporalAA.readDynamicResolutionDiagnostics() requires exactly one live runtime'
            );
        }
        const runtime = this.#runtimes.values().next().value;
        if (!(runtime instanceof TemporalAARuntime)) {
            throw new Error('TemporalAA runtime is unavailable');
        }
        return runtime.diagnostics;
    }
}
