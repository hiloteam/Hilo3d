import type Camera from '../../camera/Camera';
import { getTransformHistoryRevision } from '../../core/TransformHistory';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Matrix4 from '../../math/Matrix4';
import Shader from '../../shader/Shader';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderFeatureRequirements,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../pipeline/ForwardRenderPipeline';
import type { CullingResultsHandle, RendererListHandle } from '../pipeline/RendererList';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import type { RenderPipelineContext, RenderPipelineRequirements } from '../pipeline/RenderPipeline';
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
    RenderPipelineDepthStencilAttachment
} from '../pipeline/ScriptableRenderGraph';
import UniformBuffer from '../UniformBuffer';
import { createStd140Layout } from '../ubo/Std140Layout';
import { registerUniformBlockBinding } from '../ubo/UniformBlockBindings';

const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const INVALID_CULLING_RESULTS = 0 as CullingResultsHandle;
const INVALID_RENDERER_LIST = 0 as RendererListHandle;
const CAMERA_HISTORY_RETENTION_FRAMES = 120;

/** Production controls for portable screen-space diffuse global illumination. */
export interface ScreenSpaceGlobalIlluminationOptions {
    /** Internal tracing resolution relative to opaque rendering. Defaults to 0.5. */
    readonly resolutionScale?: number;
    /** Stochastic hemisphere rays traced per pixel. Defaults to 8. */
    readonly rayCount?: 4 | 6 | 8 | 12;
    /** Depth tests performed along each ray. Defaults to 8. */
    readonly stepCount?: 6 | 8 | 10 | 12;
    /** Maximum view-space ray distance. Defaults to 4. */
    readonly maxRayDistance?: number;
    /** View-space hit thickness used by ray/depth intersection. Defaults to 0.18. */
    readonly thickness?: number;
    /** Fraction of the trace distance at which contribution fading begins. Defaults to 0.72. */
    readonly distanceFadeStart?: number;
    /** Strength of the diffuse bounce added to linear scene color. Defaults to 1. */
    readonly intensity?: number;
    /** Saturation of transported radiance. Defaults to 1.1. */
    readonly saturation?: number;
    /** Firefly clamp for transported linear radiance. Defaults to 8. */
    readonly maxRadiance?: number;
    /** Maximum accepted temporal contribution. Defaults to 0.92. */
    readonly historyWeight?: number;
    /** Maximum relative reprojected view-depth error. Defaults to 0.025. */
    readonly depthThreshold?: number;
    /** Minimum normal similarity accepted by reprojection. Defaults to 0.82. */
    readonly normalThreshold?: number;
    /** Number of edge-aware a-trous denoise passes. Defaults to 3. */
    readonly denoisePasses?: 1 | 2 | 3;
}

/** @internal Immutable validated SSGI configuration. */
export interface ScreenSpaceGlobalIlluminationSettings {
    readonly resolutionScale: number;
    readonly rayCount: 4 | 6 | 8 | 12;
    readonly stepCount: 6 | 8 | 10 | 12;
    readonly maxRayDistance: number;
    readonly thickness: number;
    readonly distanceFadeStart: number;
    readonly intensity: number;
    readonly saturation: number;
    readonly maxRadiance: number;
    readonly historyWeight: number;
    readonly depthThreshold: number;
    readonly normalThreshold: number;
    readonly denoisePasses: 1 | 2 | 3;
}

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

function member<T extends number>(value: T, values: readonly T[], label: string): T {
    if (!values.includes(value)) {
        throw new RangeError(`${label} must be one of ${values.join(', ')}`);
    }
    return value;
}

/** @internal Validate and freeze public SSGI options. */
export function snapshotScreenSpaceGlobalIlluminationOptions(
    options: Readonly<ScreenSpaceGlobalIlluminationOptions>
): Readonly<ScreenSpaceGlobalIlluminationSettings> {
    return Object.freeze({
        resolutionScale: finiteRange(
            options.resolutionScale ?? 0.5,
            0.25,
            1,
            'ScreenSpaceGlobalIllumination resolutionScale'
        ),
        rayCount: member(
            options.rayCount ?? 8,
            [4, 6, 8, 12] as const,
            'ScreenSpaceGlobalIllumination rayCount'
        ),
        stepCount: member(
            options.stepCount ?? 8,
            [6, 8, 10, 12] as const,
            'ScreenSpaceGlobalIllumination stepCount'
        ),
        maxRayDistance: finiteRange(
            options.maxRayDistance ?? 4,
            0.1,
            100,
            'ScreenSpaceGlobalIllumination maxRayDistance'
        ),
        thickness: finiteRange(
            options.thickness ?? 0.18,
            0.001,
            10,
            'ScreenSpaceGlobalIllumination thickness'
        ),
        distanceFadeStart: finiteRange(
            options.distanceFadeStart ?? 0.72,
            0,
            0.98,
            'ScreenSpaceGlobalIllumination distanceFadeStart'
        ),
        intensity: finiteRange(
            options.intensity ?? 1,
            0,
            8,
            'ScreenSpaceGlobalIllumination intensity'
        ),
        saturation: finiteRange(
            options.saturation ?? 1.1,
            0,
            2,
            'ScreenSpaceGlobalIllumination saturation'
        ),
        maxRadiance: finiteRange(
            options.maxRadiance ?? 8,
            0.25,
            64,
            'ScreenSpaceGlobalIllumination maxRadiance'
        ),
        historyWeight: finiteRange(
            options.historyWeight ?? 0.92,
            0,
            0.98,
            'ScreenSpaceGlobalIllumination historyWeight'
        ),
        depthThreshold: finiteRange(
            options.depthThreshold ?? 0.025,
            0,
            1,
            'ScreenSpaceGlobalIllumination depthThreshold'
        ),
        normalThreshold: finiteRange(
            options.normalThreshold ?? 0.82,
            0,
            1,
            'ScreenSpaceGlobalIllumination normalThreshold'
        ),
        denoisePasses: member(
            options.denoisePasses ?? 3,
            [1, 2, 3] as const,
            'ScreenSpaceGlobalIllumination denoisePasses'
        )
    });
}

/** Static requirements shared by Forward and Clustered SSGI integrations. */
export const SCREEN_SPACE_GLOBAL_ILLUMINATION_REQUIREMENTS = Object.freeze({
    requiredTextureFormats: Object.freeze([
        Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const })
    ])
}) satisfies Readonly<RenderPipelineRequirements>;

const SSGI_BLOCK = `layout(std140) uniform ScreenSpaceGlobalIlluminationBlock {
    mat4 u_ssgiProjection;
    mat4 u_ssgiInverseProjection;
    vec4 u_ssgiProjectionInfo;
    vec4 u_ssgiTrace;
    vec4 u_ssgiTemporal;
    vec4 u_ssgiComposite;
};`;

registerUniformBlockBinding('ScreenSpaceGlobalIlluminationBlock');

const ssgiLayout = createStd140Layout({
    u_ssgiProjection: 'mat4',
    u_ssgiInverseProjection: 'mat4',
    u_ssgiProjectionInfo: 'vec4',
    u_ssgiTrace: 'vec4',
    u_ssgiTemporal: 'vec4',
    u_ssgiComposite: 'vec4'
});

const SCREEN_SPACE_HELPERS = `
vec2 ssgiNDCForUV(vec2 uv) {
    vec2 ndc = uv * 2.0 - 1.0;
    #ifdef HILO_WEBGPU
        ndc.y = -ndc.y;
    #endif
    return ndc;
}
vec2 ssgiUVForNDC(vec2 ndc) {
    #ifdef HILO_WEBGPU
        ndc.y = -ndc.y;
    #endif
    return ndc * 0.5 + 0.5;
}
vec3 ssgiReconstructViewPosition(vec2 uv, float deviceDepth) {
    vec4 homogeneous = u_ssgiInverseProjection * vec4(
        ssgiNDCForUV(uv), deviceDepth * 2.0 - 1.0, 1.0
    );
    return homogeneous.xyz / max(abs(homogeneous.w), 1e-6) * sign(homogeneous.w);
}
vec2 ssgiProjectViewPosition(vec3 position) {
    vec4 clip = u_ssgiProjection * vec4(position, 1.0);
    return ssgiUVForNDC(clip.xy / max(abs(clip.w), 1e-6) * sign(clip.w));
}
vec3 ssgiDecodeNormal(vec2 encoded) {
    vec3 normal = vec3(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
    if (normal.z < 0.0) {
        vec2 original = normal.xy;
        normal.xy = (1.0 - abs(original.yx)) * vec2(
            original.x >= 0.0 ? 1.0 : -1.0,
            original.y >= 0.0 ? 1.0 : -1.0
        );
    }
    return normalize(normal);
}
bool ssgiIsBackground(float depth) {
    return u_ssgiProjectionInfo.z > 0.5 ? depth <= 1e-6 : depth >= 0.999999;
}
float ssgiNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}
float ssgiLuminance(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}
`;

function traceFragment(settings: Readonly<ScreenSpaceGlobalIlluminationSettings>): string {
    return `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_sceneColor;
uniform sampler2D u_sceneDepth;
uniform sampler2D u_materialAttributes;
${SSGI_BLOCK}
layout(location = 0) out vec4 ssgiResult;
const float PI = 3.141592653589793;
${SCREEN_SPACE_HELPERS}

void main() {
    ivec2 depthSize = textureSize(u_sceneDepth, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(depthSize)), ivec2(0), depthSize - ivec2(1));
    float centerDepth = texelFetch(u_sceneDepth, pixel, 0).r;
    if (ssgiIsBackground(centerDepth)) {
        ssgiResult = vec4(0.0, 0.0, 0.0, -1.0);
        return;
    }
    vec3 center = ssgiReconstructViewPosition(v_uv, centerDepth);
    vec3 normal = ssgiDecodeNormal(textureLod(u_materialAttributes, v_uv, 0.0).xy);
    vec3 helper = abs(normal.z) < 0.92 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(helper, normal));
    vec3 bitangent = cross(normal, tangent);
    float noise = ssgiNoise(vec2(pixel) + u_ssgiProjectionInfo.w * 23.17);
    vec3 radiance = vec3(0.0);
    float confidence = 0.0;
    for (int rayIndex = 0; rayIndex < ${String(settings.rayCount)}; rayIndex++) {
        float sequence = (float(rayIndex) + noise) / float(${String(settings.rayCount)});
        float angle = sequence * PI * 2.0 + u_ssgiProjectionInfo.w * 2.39996323;
        float elevation = mix(0.28, 0.82, fract(sequence * 3.75487766 + noise));
        vec3 rayDirection = normalize(
            tangent * cos(angle) * sqrt(1.0 - elevation * elevation) +
            bitangent * sin(angle) * sqrt(1.0 - elevation * elevation) +
            normal * elevation
        );
        float nDotRay = max(dot(normal, rayDirection), 0.0);
        bool found = false;
        for (int stepIndex = 0; stepIndex < ${String(settings.stepCount)}; stepIndex++) {
            float linearStep = (float(stepIndex) + 1.0 + noise * 0.45) /
                float(${String(settings.stepCount)});
            float distanceAlongRay = u_ssgiTrace.x * linearStep * linearStep;
            vec3 rayPosition = center + rayDirection * distanceAlongRay;
            vec2 sampleUV = ssgiProjectViewPosition(rayPosition);
            if (any(lessThanEqual(sampleUV, vec2(0.002))) ||
                any(greaterThanEqual(sampleUV, vec2(0.998)))) break;
            float sampleDepth = textureLod(u_sceneDepth, sampleUV, 0.0).r;
            if (ssgiIsBackground(sampleDepth)) continue;
            vec3 surface = ssgiReconstructViewPosition(sampleUV, sampleDepth);
            float depthDelta = abs(surface.z - rayPosition.z);
            float adaptiveThickness = u_ssgiTrace.y * (1.0 + distanceAlongRay * 0.08);
            if (depthDelta > adaptiveThickness) continue;
            vec3 toSurface = surface - center;
            float surfaceDistance = length(toSurface);
            if (surfaceDistance < u_ssgiTrace.y * 1.5 || surfaceDistance > u_ssgiTrace.x * 1.1) {
                continue;
            }
            vec3 hitNormal = ssgiDecodeNormal(textureLod(u_materialAttributes, sampleUV, 0.0).xy);
            float receiver = nDotRay;
            float emitter = max(dot(hitNormal, -normalize(toSurface)), 0.05);
            float fade = 1.0 - smoothstep(
                u_ssgiTrace.x * u_ssgiTrace.z,
                u_ssgiTrace.x,
                surfaceDistance
            );
            vec2 edge = min(sampleUV, vec2(1.0) - sampleUV);
            float edgeFade = smoothstep(0.0, 0.055, min(edge.x, edge.y));
            vec3 sampleRadiance = max(textureLod(u_sceneColor, sampleUV, 0.0).rgb, vec3(0.0));
            float sampleLuminance = ssgiLuminance(sampleRadiance);
            sampleRadiance *= min(1.0, u_ssgiComposite.y / max(sampleLuminance, 1e-4));
            sampleRadiance = mix(
                vec3(ssgiLuminance(sampleRadiance)),
                sampleRadiance,
                u_ssgiTemporal.w
            );
            float weight = receiver * emitter * fade * edgeFade /
                (1.0 + surfaceDistance * surfaceDistance * 0.18);
            radiance += sampleRadiance * weight;
            confidence += weight;
            found = true;
            break;
        }
        if (!found) radiance += vec3(0.0);
    }
    radiance *= PI / float(${String(settings.rayCount)});
    ssgiResult = vec4(radiance, log2(1.0 + max(-center.z, 0.0)));
}`;
}

const TEMPORAL_INITIALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_current;
layout(location = 0) out vec4 historyOutput;
void main() { historyOutput = textureLod(u_current, v_uv, 0.0); }`;

const TEMPORAL_RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_current;
uniform sampler2D u_history;
uniform sampler2D u_motionDepth;
uniform sampler2D u_materialAttributes;
${SSGI_BLOCK}
layout(location = 0) out vec4 historyOutput;
${SCREEN_SPACE_HELPERS}

vec3 rgbToYCoCg(vec3 value) {
    return vec3(
        dot(value, vec3(0.25, 0.5, 0.25)),
        dot(value, vec3(0.5, 0.0, -0.5)),
        dot(value, vec3(-0.25, 0.5, -0.25))
    );
}
vec3 yCoCgToRGB(vec3 value) {
    return vec3(value.x + value.y - value.z, value.x + value.z, value.x - value.y - value.z);
}
float relativeDepthError(float previousLog, float expectedLog) {
    float previous = exp2(max(previousLog, 0.0)) - 1.0;
    float expected = exp2(max(expectedLog, 0.0)) - 1.0;
    return abs(previous - expected) / max(expected, 1e-3);
}

void main() {
    ivec2 currentSize = textureSize(u_current, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(currentSize)), ivec2(0), currentSize - ivec2(1));
    vec4 current = texelFetch(u_current, pixel, 0);
    if (current.a < 0.0) {
        historyOutput = current;
        return;
    }
    vec4 motion = textureLod(u_motionDepth, v_uv, 0.0);
    vec2 historyUV = v_uv - motion.xy;
    vec2 halfTexel = 0.5 / vec2(textureSize(u_history, 0));
    bool inside = all(greaterThanEqual(historyUV, halfTexel)) &&
        all(lessThanEqual(historyUV, vec2(1.0) - halfTexel));
    vec4 previous = textureLod(
        u_history,
        clamp(historyUV, halfTexel, vec2(1.0) - halfTexel),
        0.0
    );
    vec3 minimumValue = rgbToYCoCg(current.rgb);
    vec3 maximumValue = minimumValue;
    vec3 averageValue = vec3(0.0);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 coordinate = clamp(pixel + ivec2(x, y), ivec2(0), currentSize - ivec2(1));
            vec3 value = rgbToYCoCg(max(texelFetch(u_current, coordinate, 0).rgb, vec3(0.0)));
            minimumValue = min(minimumValue, value);
            maximumValue = max(maximumValue, value);
            averageValue += value;
        }
    }
    averageValue /= 9.0;
    vec3 extent = max((maximumValue - minimumValue) * 0.55, vec3(0.015));
    vec3 previousYCoCg = clamp(rgbToYCoCg(previous.rgb), averageValue - extent, averageValue + extent);
    previous.rgb = max(yCoCgToRGB(previousYCoCg), vec3(0.0));
    vec3 currentNormal = ssgiDecodeNormal(textureLod(u_materialAttributes, v_uv, 0.0).xy);
    vec3 reprojectedNormal = ssgiDecodeNormal(textureLod(
        u_materialAttributes,
        clamp(historyUV, halfTexel, vec2(1.0) - halfTexel),
        0.0
    ).xy);
    bool accepted = inside && motion.z >= 0.0 && previous.a >= 0.0 &&
        relativeDepthError(previous.a, motion.z) <= u_ssgiTemporal.y &&
        dot(currentNormal, reprojectedNormal) >= u_ssgiTemporal.z;
    float velocityPixels = length(motion.xy * vec2(textureSize(u_motionDepth, 0)));
    float luminanceDelta = abs(ssgiLuminance(current.rgb) - ssgiLuminance(previous.rgb)) /
        max(max(ssgiLuminance(current.rgb), ssgiLuminance(previous.rgb)), 0.08);
    float reactive = clamp(luminanceDelta * 0.8, 0.0, 1.0);
    float weight = accepted
        ? min(u_ssgiTemporal.x, mix(u_ssgiTemporal.x, 0.35, reactive)) *
            mix(1.0, 0.4, clamp(velocityPixels / 20.0, 0.0, 1.0))
        : 0.0;
    historyOutput = vec4(mix(current.rgb, previous.rgb, weight), current.a);
}`;

function denoiseFragment(step: number): string {
    return `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_materialAttributes;
uniform sampler2D u_motionDepth;
${SSGI_BLOCK}
layout(location = 0) out vec4 filtered;
${SCREEN_SPACE_HELPERS}
void main() {
    ivec2 size = textureSize(u_source, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(size)), ivec2(0), size - ivec2(1));
    vec4 center = texelFetch(u_source, pixel, 0);
    if (center.a < 0.0) {
        filtered = center;
        return;
    }
    vec3 centerNormal = ssgiDecodeNormal(textureLod(u_materialAttributes, v_uv, 0.0).xy);
    float centerDepth = center.a;
    float centerLuminance = ssgiLuminance(center.rgb);
    vec4 sum = center * 0.24;
    float totalWeight = 0.24;
    const ivec2 offsets[12] = ivec2[12](
        ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1),
        ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1),
        ivec2(2, 0), ivec2(-2, 0), ivec2(0, 2), ivec2(0, -2)
    );
    for (int index = 0; index < 12; index++) {
        ivec2 coordinate = clamp(pixel + offsets[index] * ${String(step)}, ivec2(0), size - ivec2(1));
        vec2 sampleUV = (vec2(coordinate) + 0.5) / vec2(size);
        vec4 sampleValue = texelFetch(u_source, coordinate, 0);
        if (sampleValue.a < 0.0) continue;
        vec3 sampleNormal = ssgiDecodeNormal(textureLod(u_materialAttributes, sampleUV, 0.0).xy);
        float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 24.0);
        float depthWeight = exp(-abs(sampleValue.a - centerDepth) * 38.0);
        float luminanceWeight = exp(
            -abs(ssgiLuminance(sampleValue.rgb) - centerLuminance) /
            max(0.18 + centerLuminance * 0.35, 1e-3)
        );
        float kernelWeight = index < 4 ? 0.075 : (index < 8 ? 0.046875 : 0.0234375);
        float weight = normalWeight * depthWeight * luminanceWeight * kernelWeight;
        sum += sampleValue * weight;
        totalWeight += weight;
    }
    filtered = sum / max(totalWeight, 1e-5);
    filtered.a = center.a;
}`;
}

const UPSAMPLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_lowResolutionGI;
uniform sampler2D u_materialAttributes;
uniform sampler2D u_motionDepth;
${SSGI_BLOCK}
layout(location = 0) out vec4 fullResolutionGI;
${SCREEN_SPACE_HELPERS}
void main() {
    ivec2 lowSize = textureSize(u_lowResolutionGI, 0);
    vec2 lowPosition = v_uv * vec2(lowSize) - 0.5;
    ivec2 base = ivec2(floor(lowPosition));
    vec3 centerNormal = ssgiDecodeNormal(textureLod(u_materialAttributes, v_uv, 0.0).xy);
    float centerDepth = textureLod(u_motionDepth, v_uv, 0.0).w;
    vec4 fallback = textureLod(u_lowResolutionGI, v_uv, 0.0);
    vec4 sum = vec4(fallback.rgb, centerDepth) * 1e-4;
    float totalWeight = 1e-4;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 coordinate = clamp(base + ivec2(x, y), ivec2(0), lowSize - ivec2(1));
            vec2 sampleUV = (vec2(coordinate) + 0.5) / vec2(lowSize);
            vec4 sampleValue = texelFetch(u_lowResolutionGI, coordinate, 0);
            if (sampleValue.a < 0.0) continue;
            vec3 sampleNormal = ssgiDecodeNormal(textureLod(u_materialAttributes, sampleUV, 0.0).xy);
            vec2 bilinear = 1.0 - abs(vec2(coordinate) - lowPosition);
            float spatialWeight = max(bilinear.x, 0.001) * max(bilinear.y, 0.001);
            float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 18.0);
            float depthWeight = exp(-abs(sampleValue.a - centerDepth) * 34.0);
            float weight = spatialWeight * normalWeight * depthWeight;
            sum += sampleValue * weight;
            totalWeight += weight;
        }
    }
    fullResolutionGI = sum / max(totalWeight, 1e-4);
    fullResolutionGI.a = centerDepth;
}`;

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_sceneColor;
uniform sampler2D u_globalIllumination;
${SSGI_BLOCK}
layout(location = 0) out vec4 composedColor;
void main() {
    vec4 scene = textureLod(u_sceneColor, v_uv, 0.0);
    vec4 indirect = textureLod(u_globalIllumination, v_uv, 0.0);
    float valid = step(0.0, indirect.a);
    composedColor = vec4(
        max(scene.rgb, vec3(0.0)) + max(indirect.rgb, vec3(0.0)) * u_ssgiComposite.x * valid,
        scene.a
    );
}`;

function fullscreenPass(
    name: string,
    fragmentSource: string,
    uniformBuffers: readonly UniformBuffer[] = []
): FullscreenRenderPass {
    return new FullscreenRenderPass({
        name,
        shader: new Shader({ vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE, fs: fragmentSource }),
        uniformBuffers,
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}

class MutableFullscreenParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'clear', storeOp: 'store' }
    ];

    reset(): void {
        this.inputTextures.length = 0;
        this.colorAttachments[0] = {
            texture: INVALID_TEXTURE,
            loadOp: 'clear',
            storeOp: 'store'
        };
    }
}

interface SSGICameraState {
    readonly camera: Camera;
    readonly historyKey: object;
    readonly committedProjection: Float32Array;
    committedTransformRevision: number;
    committedSubmission: number;
    pendingFrame: number;
    pendingTransformRevision: number;
    readonly pendingProjection: Float32Array;
    lastTouchedFrame: number;
}

function projectionCut(previous: ArrayLike<number>, current: ArrayLike<number>): boolean {
    for (const index of [0, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15]) {
        const before = previous[index] ?? 0;
        const after = current[index] ?? 0;
        const scale = Math.max(Math.abs(before), Math.abs(after), 1e-6);
        if (Math.abs(before - after) / scale > 0.05) return true;
    }
    return false;
}

/** Inputs shared by ordinary Forward and Clustered Forward+ SSGI recording. */
export interface ScreenSpaceGlobalIlluminationResources {
    readonly sceneColor: RenderGraphTextureHandle;
    readonly sceneDepth: RenderGraphTextureHandle;
    readonly materialAttributes: RenderGraphTextureHandle;
    readonly motionDepth: RenderGraphTextureHandle;
    readonly sceneScale: number;
    /** Additional producer-specific temporal validity, such as a GPU Scene camera cut. */
    readonly historyValid?: boolean;
}

/** @internal Portable raster SSGI tracing, temporal accumulation, denoise, and composition. */
export class ScreenSpaceGlobalIlluminationController {
    readonly #settings: Readonly<ScreenSpaceGlobalIlluminationSettings>;
    readonly #block: UniformBuffer<typeof ssgiLayout.schema>;
    readonly #inverseProjection = new Matrix4();
    readonly #tracePass: FullscreenRenderPass;
    readonly #initializePass = fullscreenPass(
        'SSGI initialize radiance history',
        TEMPORAL_INITIALIZE_FRAGMENT
    );
    readonly #resolvePass: FullscreenRenderPass;
    readonly #denoisePasses: readonly FullscreenRenderPass[];
    readonly #upsamplePass: FullscreenRenderPass;
    readonly #compositePass: FullscreenRenderPass;
    readonly #parameters = new RenderPassParameterPool(
        () => new MutableFullscreenParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #states = new WeakMap<Camera, SSGICameraState>();
    readonly #ownedStates = new Set<SSGICameraState>();
    readonly #stagedStates: SSGICameraState[] = [];
    readonly #pendingEvictions: SSGICameraState[] = [];
    readonly #traceDescriptor = {
        format: 'rgba16float' as const,
        extent: { width: 1, height: 1 },
        sampleCount: 1 as const
    };
    readonly #historyDescriptor = {
        label: 'SSGI diffuse radiance history',
        format: 'rgba16float' as const,
        extent: { width: 1, height: 1 },
        usage: Object.freeze(['sampled', 'attachment'] as const),
        bufferCount: 2 as const
    };
    readonly #fullResolutionDescriptor = {
        format: 'rgba16float' as const,
        extent: { width: 1, height: 1 },
        sampleCount: 1 as const
    };
    #submissionIndex = 0;
    #destroyed = false;

    constructor(settings: Readonly<ScreenSpaceGlobalIlluminationSettings>) {
        this.#settings = settings;
        this.#block = UniformBuffer.fromSchema(ssgiLayout, {
            u_ssgiProjection: new Matrix4().elements,
            u_ssgiInverseProjection: this.#inverseProjection.elements,
            u_ssgiProjectionInfo: [1, 1, 0, 0],
            u_ssgiTrace: [
                settings.maxRayDistance,
                settings.thickness,
                settings.distanceFadeStart,
                0
            ],
            u_ssgiTemporal: [
                settings.historyWeight,
                settings.depthThreshold,
                settings.normalThreshold,
                settings.saturation
            ],
            u_ssgiComposite: [settings.intensity, settings.maxRadiance, 0, 0]
        });
        this.#tracePass = fullscreenPass(
            'SSGI stochastic diffuse ray trace',
            traceFragment(settings),
            [this.#block]
        );
        this.#resolvePass = fullscreenPass(
            'SSGI variance-clipped temporal resolve',
            TEMPORAL_RESOLVE_FRAGMENT,
            [this.#block]
        );
        this.#denoisePasses = Object.freeze(
            Array.from({ length: settings.denoisePasses }, (_, index) =>
                fullscreenPass(
                    `SSGI edge-aware a-trous denoise ${String(index + 1)}`,
                    denoiseFragment(2 ** index),
                    [this.#block]
                )
            )
        );
        this.#upsamplePass = fullscreenPass(
            'SSGI bilateral full-resolution upsample',
            UPSAMPLE_FRAGMENT,
            [this.#block]
        );
        this.#compositePass = fullscreenPass(
            'SSGI linear HDR diffuse composite',
            COMPOSITE_FRAGMENT,
            [this.#block]
        );
    }

    record(
        context: RenderPipelineContext,
        resources: Readonly<ScreenSpaceGlobalIlluminationResources>
    ): RenderGraphTextureHandle {
        if (this.#destroyed)
            throw new Error('ScreenSpaceGlobalIllumination controller is destroyed');
        const [x, y, viewportWidth, viewportHeight] = context.viewport;
        if (
            x !== 0 ||
            y !== 0 ||
            viewportWidth !== context.output.width ||
            viewportHeight !== context.output.height
        ) {
            throw new Error(
                'ScreenSpaceGlobalIllumination currently requires a full-output viewport'
            );
        }
        const sceneWidth = Math.max(1, Math.floor(context.output.width * resources.sceneScale));
        const sceneHeight = Math.max(1, Math.floor(context.output.height * resources.sceneScale));
        const traceWidth = Math.max(1, Math.floor(sceneWidth * this.#settings.resolutionScale));
        const traceHeight = Math.max(1, Math.floor(sceneHeight * this.#settings.resolutionScale));
        this.#traceDescriptor.extent.width = traceWidth;
        this.#traceDescriptor.extent.height = traceHeight;
        this.#historyDescriptor.extent.width = traceWidth;
        this.#historyDescriptor.extent.height = traceHeight;
        this.#fullResolutionDescriptor.extent.width = sceneWidth;
        this.#fullResolutionDescriptor.extent.height = sceneHeight;

        const camera = context.camera;
        this.#inverseProjection.invert(camera.jitteredProjectionMatrix);
        const projection = camera.jitteredProjectionMatrix.elements;
        const state = this.stageCamera(context, camera);
        this.#block
            .set('u_ssgiProjection', projection)
            .set('u_ssgiInverseProjection', this.#inverseProjection.elements)
            .set('u_ssgiProjectionInfo', [
                Math.abs(projection[5]),
                camera.isPerspectiveCamera ? 1 : 0,
                camera.depthMode === 'reversed' ? 1 : 0,
                this.#submissionIndex % 64
            ]);

        const discontinuous =
            state.committedSubmission >= 0 &&
            (state.committedSubmission !== this.#submissionIndex ||
                state.committedTransformRevision !== getTransformHistoryRevision(camera) ||
                projectionCut(state.committedProjection, camera.projectionMatrix.elements));
        if (discontinuous) context.graph.invalidateHistoryTexture(state.historyKey);
        const history = context.graph.acquireHistoryTexture(
            state.historyKey,
            this.#historyDescriptor
        );

        const current = context.graph.createTexture(
            'SSGI current diffuse radiance',
            this.#traceDescriptor
        );
        this.addFullscreen(
            context,
            this.#tracePass,
            [resources.sceneColor, resources.sceneDepth, resources.materialAttributes],
            current
        );

        const historyAccepted = !discontinuous && (resources.historyValid ?? true) && history.valid;
        this.addFullscreen(
            context,
            historyAccepted ? this.#resolvePass : this.#initializePass,
            historyAccepted
                ? [current, history.history(), resources.motionDepth, resources.materialAttributes]
                : [current],
            history.current
        );

        let filtered: RenderGraphTextureHandle = history.current;
        for (let index = 0; index < this.#denoisePasses.length; index += 1) {
            const destination = context.graph.createTexture(
                `SSGI denoised diffuse radiance ${String(index + 1)}`,
                this.#traceDescriptor
            );
            const pass = this.#denoisePasses[index];
            if (pass === undefined) throw new Error('SSGI denoise pass is missing');
            this.addFullscreen(
                context,
                pass,
                [filtered, resources.materialAttributes, resources.motionDepth],
                destination
            );
            filtered = destination;
        }

        let fullResolution = filtered;
        if (traceWidth !== sceneWidth || traceHeight !== sceneHeight) {
            fullResolution = context.graph.createTexture(
                'SSGI full-resolution diffuse radiance',
                this.#fullResolutionDescriptor
            );
            this.addFullscreen(
                context,
                this.#upsamplePass,
                [filtered, resources.materialAttributes, resources.motionDepth],
                fullResolution
            );
        }

        const composed = context.graph.createTexture('SSGI linear HDR composed scene', {
            format: 'rgba16float',
            extent: { relativeTo: 'output', scale: resources.sceneScale },
            sampleCount: 1
        });
        this.addFullscreen(
            context,
            this.#compositePass,
            [resources.sceneColor, fullResolution],
            composed
        );
        return composed;
    }

    frameSubmitted(frameIndex: number): void {
        const committedSubmission = this.#submissionIndex + 1;
        for (const state of this.#stagedStates) {
            if (state.pendingFrame !== frameIndex) continue;
            state.committedProjection.set(state.pendingProjection);
            state.committedTransformRevision = state.pendingTransformRevision;
            state.committedSubmission = committedSubmission;
            state.pendingFrame = -1;
        }
        for (const state of this.#pendingEvictions) {
            this.#states.delete(state.camera);
            this.#ownedStates.delete(state);
        }
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
        this.#submissionIndex = committedSubmission;
    }

    frameDiscarded(frameIndex: number): void {
        for (const state of this.#stagedStates) {
            if (state.pendingFrame === frameIndex) state.pendingFrame = -1;
        }
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
    }

    destroy(): void {
        this.#destroyed = true;
        this.#ownedStates.clear();
        this.#stagedStates.length = 0;
        this.#pendingEvictions.length = 0;
    }

    private addFullscreen(
        context: RenderPipelineContext,
        pass: FullscreenRenderPass,
        inputs: readonly RenderGraphTextureAccessHandle[],
        output: RenderGraphTextureHandle
    ): void {
        const parameters = context.acquirePassParameters(this.#parameters);
        parameters.inputTextures.length = inputs.length;
        for (let index = 0; index < inputs.length; index += 1) {
            const input = inputs[index];
            if (input === undefined) throw new Error('SSGI fullscreen input is missing');
            parameters.inputTextures[index] = input;
        }
        parameters.colorAttachments[0] = {
            texture: output,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
        };
        context.graph.addPass(pass, parameters);
    }

    private stageCamera(context: RenderPipelineContext, camera: Camera): SSGICameraState {
        const frameIndex = context.frameIndex;
        this.sweepInactiveStates(context, camera);
        let state = this.#states.get(camera);
        if (state === undefined) {
            state = {
                camera,
                historyKey: Object.freeze({}),
                committedProjection: new Float32Array(16),
                committedTransformRevision: -1,
                committedSubmission: -1,
                pendingFrame: -1,
                pendingTransformRevision: -1,
                pendingProjection: new Float32Array(16),
                lastTouchedFrame: frameIndex
            };
            this.#states.set(camera, state);
            this.#ownedStates.add(state);
        }
        if (state.pendingFrame >= 0) {
            throw new Error(
                'ScreenSpaceGlobalIllumination supports one invocation per camera per frame'
            );
        }
        state.pendingFrame = frameIndex;
        state.pendingTransformRevision = getTransformHistoryRevision(camera);
        state.pendingProjection.set(camera.projectionMatrix.elements);
        state.lastTouchedFrame = frameIndex;
        this.#stagedStates.push(state);
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
            context.graph.releaseHistoryTexture(state.historyKey);
            this.#pendingEvictions.push(state);
        }
    }
}

class MutableSceneParameters implements SceneRenderPassParameters {
    rendererList = INVALID_RENDERER_LIST;
    readonly colorAttachments: RenderPipelineColorAttachment[] = [];
    depthStencilAttachment?: RenderPipelineDepthStencilAttachment;

    reset(): void {
        this.rendererList = INVALID_RENDERER_LIST;
        this.colorAttachments.length = 0;
        delete this.depthStencilAttachment;
    }
}

class ScreenSpaceGlobalIlluminationRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #controller: ScreenSpaceGlobalIlluminationController;
    readonly #attributesPass = new SceneRenderPass('SSGI material attributes');
    readonly #motionPass = new SceneRenderPass('SSGI motion and logarithmic depth');
    readonly #sceneParameters = new RenderPassParameterPool(
        () => new MutableSceneParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #attributeList = {
        cullingResults: INVALID_CULLING_RESULTS,
        queue: 'opaque' as const,
        sorting: 'material-front-to-back' as const,
        materialPass: 'material-attributes' as const
    };
    readonly #motionList = {
        cullingResults: INVALID_CULLING_RESULTS,
        queue: 'opaque' as const,
        sorting: 'material-front-to-back' as const,
        materialPass: 'motion-vector' as const
    };

    constructor(settings: Readonly<ScreenSpaceGlobalIlluminationSettings>) {
        this.#controller = new ScreenSpaceGlobalIlluminationController(settings);
    }

    record(context: ForwardRenderFeatureContext): void {
        const pipeline = context.pipeline;
        const sceneColor = context.resources.color;
        const sceneDepth = context.resources.depth;
        if (sceneColor === null || sceneDepth === null) {
            throw new Error('ScreenSpaceGlobalIllumination requires sampled scene color and depth');
        }
        if (context.resources.colorEncoding !== 'linear') {
            throw new Error('ScreenSpaceGlobalIllumination requires linear scene color');
        }
        const sceneScale = context.resources.sceneScale;
        const extent = Object.freeze({ relativeTo: 'output' as const, scale: sceneScale });

        let attributes = context.resources.materialAttributes;
        if (attributes === null) {
            attributes = pipeline.graph.createTexture('SSGI material attributes', {
                format: 'rgba16float',
                extent,
                sampleCount: 1
            });
            this.#attributeList.cullingResults = context.cullingResults;
            const parameters = pipeline.acquirePassParameters(this.#sceneParameters);
            parameters.rendererList = pipeline.createRendererList(this.#attributeList);
            parameters.colorAttachments.push({
                texture: attributes,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 1, a: 0 }
            });
            parameters.depthStencilAttachment = {
                texture: sceneDepth,
                depthLoadOp: 'load',
                depthStoreOp: 'store'
            };
            pipeline.graph.addPass(this.#attributesPass, parameters);
            context.resources.setMaterialAttributes(attributes);
        }

        let motion = context.resources.motionDepth;
        if (motion === null) {
            motion = pipeline.graph.createTexture('SSGI motion and logarithmic view depth', {
                format: 'rgba16float',
                extent,
                sampleCount: 1
            });
            this.#motionList.cullingResults = context.cullingResults;
            const parameters = pipeline.acquirePassParameters(this.#sceneParameters);
            parameters.rendererList = pipeline.createRendererList(this.#motionList);
            parameters.colorAttachments.push({
                texture: motion,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: -1, a: 0 }
            });
            parameters.depthStencilAttachment = {
                texture: sceneDepth,
                depthLoadOp: 'load',
                depthStoreOp: 'store'
            };
            pipeline.graph.addPass(this.#motionPass, parameters);
            context.resources.setMotionDepth(motion);
        }

        const composed = this.#controller.record(pipeline, {
            sceneColor,
            sceneDepth,
            materialAttributes: attributes,
            motionDepth: motion,
            sceneScale
        });
        context.resources.replaceColor(composed, 'linear');
    }

    frameSubmitted(frameIndex: number): void {
        this.#controller.frameSubmitted(frameIndex);
    }

    frameDiscarded(frameIndex: number): void {
        this.#controller.frameDiscarded(frameIndex);
    }

    destroy(): void {
        this.#controller.destroy();
    }
}

/**
 * Portable production screen-space diffuse global illumination for the shared Forward pipeline.
 *
 * The feature traces stochastic view-space rays against opaque depth, transports linear HDR scene
 * radiance, rejects invalid history using motion/depth/normal data, applies variance clipping and
 * edge-aware a-trous filtering, then composites the result before transparent rendering.
 */
export class ScreenSpaceGlobalIllumination implements ForwardRenderPipelineFeature {
    readonly name = 'screen-space-global-illumination';
    readonly injectionPoint = 'after-opaque' as const;
    readonly requirements: Readonly<ForwardRenderFeatureRequirements> = Object.freeze({
        sampledSceneColor: true,
        sampledDepth: true,
        splitScene: true,
        ...SCREEN_SPACE_GLOBAL_ILLUMINATION_REQUIREMENTS
    });
    readonly #settings: Readonly<ScreenSpaceGlobalIlluminationSettings>;

    constructor(options: Readonly<ScreenSpaceGlobalIlluminationOptions> = {}) {
        this.#settings = snapshotScreenSpaceGlobalIlluminationOptions(options);
    }

    create(): ForwardRenderPipelineFeatureRuntime {
        return new ScreenSpaceGlobalIlluminationRuntime(this.#settings);
    }
}
