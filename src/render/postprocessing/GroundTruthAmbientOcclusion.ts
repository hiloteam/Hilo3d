import type Camera from '../../camera/Camera';
import { getTransformHistoryRevision } from '../../core/TransformHistory';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Matrix4 from '../../math/Matrix4';
import Shader from '../../shader/Shader';
import UniformBuffer from '../UniformBuffer';
import { renderTargetFormatHasStencil } from '../RenderTarget';
import { depthClearValue } from '../renderer/DepthConvention';
import type {
    ForwardRenderFeatureContext,
    ForwardRenderFeatureRequirements,
    ForwardRenderPipelineFeature,
    ForwardRenderPipelineFeatureRuntime
} from '../pipeline/ForwardRenderPipeline';
import type { RenderPipelineContext, RenderPipelineRequirements } from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import type { CullingResultsHandle, RendererListHandle } from '../pipeline/RendererList';
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
import { createStd140Layout } from '../ubo/Std140Layout';
import { registerUniformBlockBinding } from '../ubo/UniformBlockBindings';

const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const INVALID_CULLING_RESULTS = 0 as CullingResultsHandle;
const INVALID_RENDERER_LIST = 0 as RendererListHandle;
const CAMERA_HISTORY_RETENTION_FRAMES = 120;

/** Quality preset used when an individual GTAO sampling control is omitted. */
export type GroundTruthAmbientOcclusionQuality = 'low' | 'medium' | 'high' | 'ultra';

/** Normal source used for GTAO horizon integration and edge rejection. */
export type GroundTruthAmbientOcclusionNormalSource = 'material' | 'geometry' | 'hybrid';

/** Production controls for ground-truth ambient occlusion. */
export interface GroundTruthAmbientOcclusionOptions {
    /** Sampling preset. Individual resolution/direction/step controls override it. Defaults to high. */
    readonly quality?: GroundTruthAmbientOcclusionQuality;
    /** Internal AO resolution relative to opaque rendering. Defaults to the quality preset. */
    readonly resolutionScale?: number;
    /** View-space horizon-search radius. Defaults to 2. */
    readonly radius?: number;
    /** Fraction of the radius at which distance falloff begins. Defaults to 0.6. */
    readonly falloffStart?: number;
    /** View-space self-intersection rejection distance. Defaults to 0.05. */
    readonly thickness?: number;
    /** Blend between a thin depth field and a solid occluder. Defaults to 0.5. */
    readonly thicknessBlend?: number;
    /** Number of rotated horizon slices per pixel. Defaults to the quality preset. */
    readonly directionCount?: 2 | 3 | 4 | 6 | 8;
    /** Samples evaluated on each side of a horizon slice. Defaults to the quality preset. */
    readonly stepCount?: 3 | 4 | 5 | 6 | 8 | 10 | 12;
    /** Contrast applied to the physically normalized visibility. Defaults to 1.2. */
    readonly power?: number;
    /** Occlusion intensity before contrast. Defaults to 1. */
    readonly intensity?: number;
    /** Angular self-occlusion bias in radians. Defaults to 0.035. */
    readonly bias?: number;
    /** Radius of the additional contact-occlusion lobe, relative to radius. Defaults to 0.2. */
    readonly contactRadiusScale?: number;
    /** Strength of the contact-occlusion lobe. Defaults to 0.35. */
    readonly contactStrength?: number;
    /** Normal source used by the horizon search. Defaults to hybrid. */
    readonly normalSource?: GroundTruthAmbientOcclusionNormalSource;
    /** Geometric-normal contribution in hybrid mode. Defaults to 0.65. */
    readonly geometricNormalWeight?: number;
    /** Strength of bent-normal redirection. Defaults to 1. */
    readonly bentNormalStrength?: number;
    /** Strength of color-aware multi-bounce diffuse AO. Defaults to 1. */
    readonly multiBounce?: number;
    /** View distance where AO starts fading. Defaults to 100. */
    readonly distanceFadeStart?: number;
    /** View distance where AO is fully disabled. Defaults to 200. */
    readonly distanceFadeEnd?: number;
    /** Screen-edge fade width in AO pixels. Defaults to 2. */
    readonly edgeFadePixels?: number;
    /** Maximum accepted temporal contribution. Defaults to 0.9. */
    readonly historyWeight?: number;
    /** Maximum relative reprojected view-depth error. Defaults to 0.03. */
    readonly depthThreshold?: number;
    /** Minimum normal agreement accepted by temporal reprojection. Defaults to 0.82. */
    readonly normalThreshold?: number;
}

/** @internal Immutable validated GTAO configuration. */
export interface GroundTruthAmbientOcclusionSettings {
    readonly quality: GroundTruthAmbientOcclusionQuality;
    readonly resolutionScale: number;
    readonly radius: number;
    readonly falloffStart: number;
    readonly thickness: number;
    readonly thicknessBlend: number;
    readonly directionCount: 2 | 3 | 4 | 6 | 8;
    readonly stepCount: 3 | 4 | 5 | 6 | 8 | 10 | 12;
    readonly power: number;
    readonly intensity: number;
    readonly bias: number;
    readonly contactRadiusScale: number;
    readonly contactStrength: number;
    readonly normalSource: GroundTruthAmbientOcclusionNormalSource;
    readonly geometricNormalWeight: number;
    readonly bentNormalStrength: number;
    readonly multiBounce: number;
    readonly distanceFadeStart: number;
    readonly distanceFadeEnd: number;
    readonly edgeFadePixels: number;
    readonly historyWeight: number;
    readonly depthThreshold: number;
    readonly normalThreshold: number;
}

const GTAO_QUALITY_DEFAULTS = Object.freeze({
    low: Object.freeze({ resolutionScale: 0.5, directionCount: 2 as const, stepCount: 4 as const }),
    medium: Object.freeze({
        resolutionScale: 0.5,
        directionCount: 3 as const,
        stepCount: 5 as const
    }),
    high: Object.freeze({
        resolutionScale: 0.5,
        directionCount: 4 as const,
        stepCount: 6 as const
    }),
    ultra: Object.freeze({
        resolutionScale: 0.75,
        directionCount: 6 as const,
        stepCount: 8 as const
    })
});

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

function stringMember<T extends string>(value: T, values: readonly T[], label: string): T {
    if (!values.includes(value)) {
        throw new TypeError(`${label} must be one of ${values.join(', ')}`);
    }
    return value;
}

/** @internal Validate and freeze public GTAO options. */
export function snapshotGroundTruthAmbientOcclusionOptions(
    options: Readonly<GroundTruthAmbientOcclusionOptions>
): Readonly<GroundTruthAmbientOcclusionSettings> {
    const quality = stringMember(
        options.quality ?? 'high',
        ['low', 'medium', 'high', 'ultra'] as const,
        'GroundTruthAmbientOcclusion quality'
    );
    const defaults = GTAO_QUALITY_DEFAULTS[quality];
    const distanceFadeStart = finiteRange(
        options.distanceFadeStart ?? 100,
        0,
        1_000_000,
        'GroundTruthAmbientOcclusion distanceFadeStart'
    );
    const distanceFadeEnd = finiteRange(
        options.distanceFadeEnd ?? 200,
        0.001,
        1_000_000,
        'GroundTruthAmbientOcclusion distanceFadeEnd'
    );
    if (distanceFadeEnd <= distanceFadeStart) {
        throw new RangeError(
            'GroundTruthAmbientOcclusion distanceFadeEnd must be greater than distanceFadeStart'
        );
    }
    return Object.freeze({
        quality,
        resolutionScale: finiteRange(
            options.resolutionScale ?? defaults.resolutionScale,
            0.25,
            1,
            'GroundTruthAmbientOcclusion resolutionScale'
        ),
        radius: finiteRange(options.radius ?? 2, 0.05, 100, 'GroundTruthAmbientOcclusion radius'),
        falloffStart: finiteRange(
            options.falloffStart ?? 0.6,
            0,
            0.95,
            'GroundTruthAmbientOcclusion falloffStart'
        ),
        thickness: finiteRange(
            options.thickness ?? 0.05,
            0,
            10,
            'GroundTruthAmbientOcclusion thickness'
        ),
        thicknessBlend: finiteRange(
            options.thicknessBlend ?? 0.5,
            0,
            1,
            'GroundTruthAmbientOcclusion thicknessBlend'
        ),
        directionCount: member(
            options.directionCount ?? defaults.directionCount,
            [2, 3, 4, 6, 8] as const,
            'GroundTruthAmbientOcclusion directionCount'
        ),
        stepCount: member(
            options.stepCount ?? defaults.stepCount,
            [3, 4, 5, 6, 8, 10, 12] as const,
            'GroundTruthAmbientOcclusion stepCount'
        ),
        power: finiteRange(options.power ?? 1.2, 0.25, 4, 'GroundTruthAmbientOcclusion power'),
        intensity: finiteRange(
            options.intensity ?? 1,
            0,
            4,
            'GroundTruthAmbientOcclusion intensity'
        ),
        bias: finiteRange(options.bias ?? 0.035, 0, 0.5, 'GroundTruthAmbientOcclusion bias'),
        contactRadiusScale: finiteRange(
            options.contactRadiusScale ?? 0.2,
            0.02,
            1,
            'GroundTruthAmbientOcclusion contactRadiusScale'
        ),
        contactStrength: finiteRange(
            options.contactStrength ?? 0.35,
            0,
            2,
            'GroundTruthAmbientOcclusion contactStrength'
        ),
        normalSource: stringMember(
            options.normalSource ?? 'hybrid',
            ['material', 'geometry', 'hybrid'] as const,
            'GroundTruthAmbientOcclusion normalSource'
        ),
        geometricNormalWeight: finiteRange(
            options.geometricNormalWeight ?? 0.65,
            0,
            1,
            'GroundTruthAmbientOcclusion geometricNormalWeight'
        ),
        bentNormalStrength: finiteRange(
            options.bentNormalStrength ?? 1,
            0,
            1,
            'GroundTruthAmbientOcclusion bentNormalStrength'
        ),
        multiBounce: finiteRange(
            options.multiBounce ?? 1,
            0,
            1,
            'GroundTruthAmbientOcclusion multiBounce'
        ),
        distanceFadeStart,
        distanceFadeEnd,
        edgeFadePixels: finiteRange(
            options.edgeFadePixels ?? 2,
            0,
            32,
            'GroundTruthAmbientOcclusion edgeFadePixels'
        ),
        historyWeight: finiteRange(
            options.historyWeight ?? 0.9,
            0,
            0.98,
            'GroundTruthAmbientOcclusion historyWeight'
        ),
        depthThreshold: finiteRange(
            options.depthThreshold ?? 0.03,
            0,
            1,
            'GroundTruthAmbientOcclusion depthThreshold'
        ),
        normalThreshold: finiteRange(
            options.normalThreshold ?? 0.82,
            0,
            1,
            'GroundTruthAmbientOcclusion normalThreshold'
        )
    });
}

/** Static requirements shared by Forward and Clustered GTAO integrations. */
export const GROUND_TRUTH_AMBIENT_OCCLUSION_REQUIREMENTS = Object.freeze({
    requiredTextureFormats: Object.freeze([
        Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const }),
        Object.freeze({ format: 'rgba8unorm' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'rgba8unorm' as const, use: 'filterable-sampled' as const })
    ])
}) satisfies Readonly<RenderPipelineRequirements>;

const GTAO_BLOCK = `layout(std140) uniform GroundTruthAmbientOcclusionBlock {
    mat4 u_gtaoInverseProjection;
    vec4 u_gtaoProjection;
    vec4 u_gtaoSearch;
    vec4 u_gtaoTemporal;
    vec4 u_gtaoEffects;
    vec4 u_gtaoContact;
    vec4 u_gtaoFade;
};`;

registerUniformBlockBinding('GroundTruthAmbientOcclusionBlock');

const gtaoLayout = createStd140Layout({
    u_gtaoInverseProjection: 'mat4',
    u_gtaoProjection: 'vec4',
    u_gtaoSearch: 'vec4',
    u_gtaoTemporal: 'vec4',
    u_gtaoEffects: 'vec4',
    u_gtaoContact: 'vec4',
    u_gtaoFade: 'vec4'
});

function horizonFragment(settings: Readonly<GroundTruthAmbientOcclusionSettings>): string {
    return `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_sceneDepth;
uniform sampler2D u_materialAttributes;
${GTAO_BLOCK}
layout(location = 0) out vec4 gtaoResult;
const float PI = 3.141592653589793;
const float HALF_PI = 1.570796326794897;

vec3 decodeOctahedralNormal(vec2 encoded) {
    encoded = encoded * 2.0 - 1.0;
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

vec2 encodeOctahedralNormal(vec3 value) {
    vec3 normal = normalize(value);
    normal /= max(abs(normal.x) + abs(normal.y) + abs(normal.z), 1e-6);
    vec2 encoded = normal.xy;
    if (normal.z < 0.0) {
        encoded = (1.0 - abs(encoded.yx)) * vec2(
            encoded.x >= 0.0 ? 1.0 : -1.0,
            encoded.y >= 0.0 ? 1.0 : -1.0
        );
    }
    return encoded;
}

vec2 ndcForUV(vec2 uv) {
    vec2 ndc = uv * 2.0 - 1.0;
    #ifdef HILO_WEBGPU
        ndc.y = -ndc.y;
    #endif
    return ndc;
}

vec3 reconstructViewPosition(vec2 uv, float deviceDepth) {
    if (u_gtaoProjection.w > 0.5) {
        vec4 rayPoint = u_gtaoInverseProjection * vec4(ndcForUV(uv), 0.0, 1.0);
        vec3 ray = rayPoint.xyz / max(abs(rayPoint.w), 1e-6) * sign(rayPoint.w);
        float viewDepth = exp2(deviceDepth * u_gtaoFade.z) - 1.0;
        return ray * (viewDepth / max(-ray.z, 1e-6));
    }
    vec4 homogeneous = u_gtaoInverseProjection * vec4(
        ndcForUV(uv),
        deviceDepth * 2.0 - 1.0,
        1.0
    );
    return homogeneous.xyz / max(abs(homogeneous.w), 1e-6) * sign(homogeneous.w);
}

bool isBackground(float depth) {
    return u_gtaoProjection.z > 0.5 ? depth <= 1e-6 : depth >= 0.999999;
}

float interleavedGradientNoise(vec2 pixel) {
    return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

ivec2 pixelForUV(vec2 uv, ivec2 size) {
    return clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
}

vec3 positionAt(ivec2 pixel, ivec2 size, vec3 fallback) {
    float depth = texelFetch(u_sceneDepth, pixel, 0).r;
    if (isBackground(depth)) return fallback;
    return reconstructViewPosition((vec2(pixel) + 0.5) / vec2(size), depth);
}

vec3 geometricNormalAt(ivec2 pixel, ivec2 size, vec3 center, vec3 referenceNormal) {
    ivec2 leftPixel = max(pixel - ivec2(1, 0), ivec2(0));
    ivec2 rightPixel = min(pixel + ivec2(1, 0), size - ivec2(1));
    ivec2 topPixel = max(pixel - ivec2(0, 1), ivec2(0));
    ivec2 bottomPixel = min(pixel + ivec2(0, 1), size - ivec2(1));
    vec3 left = positionAt(leftPixel, size, center);
    vec3 right = positionAt(rightPixel, size, center);
    vec3 top = positionAt(topPixel, size, center);
    vec3 bottom = positionAt(bottomPixel, size, center);
    vec3 dx = abs(left.z - center.z) < abs(right.z - center.z)
        ? center - left
        : right - center;
    vec3 dy = abs(top.z - center.z) < abs(bottom.z - center.z)
        ? center - top
        : bottom - center;
    vec3 geometric = cross(dx, dy);
    if (dot(geometric, geometric) < 1e-10) return referenceNormal;
    geometric = normalize(geometric);
    return dot(geometric, referenceNormal) < 0.0 ? -geometric : geometric;
}

float horizonCandidate(float cosine, float distanceToSample, float distanceWeight) {
    float angle = acos(clamp(cosine, -1.0, 1.0));
    float thinSurfaceAngle = min(
        angle + u_gtaoSearch.z / max(distanceToSample, u_gtaoSearch.z + 1e-5),
        PI
    );
    float thicknessAdjusted = mix(cos(thinSurfaceAngle), cosine, u_gtaoEffects.z);
    float biased = cos(min(acos(clamp(thicknessAdjusted, -1.0, 1.0)) + u_gtaoEffects.y, PI));
    return mix(-1.0, biased, distanceWeight);
}

float integrateVisibility(vec2 horizonCosine, float normalAngle, float projectedLength) {
    vec2 horizonAngle = acos(clamp(horizonCosine, vec2(-1.0), vec2(1.0)));
    float lower = max(-horizonAngle.x, normalAngle - HALF_PI);
    float upper = min(horizonAngle.y, normalAngle + HALF_PI);
    if (upper <= lower) return 0.0;
    return projectedLength * 0.5 * (
        sin(upper - normalAngle) - sin(lower - normalAngle)
    );
}

vec3 integrateBentDirection(
    vec2 horizonCosine,
    float normalAngle,
    vec3 viewDirection,
    vec3 sliceDirection
) {
    vec2 horizonAngle = acos(clamp(horizonCosine, vec2(-1.0), vec2(1.0)));
    float lower = max(-horizonAngle.x, normalAngle - HALF_PI);
    float upper = min(horizonAngle.y, normalAngle + HALF_PI);
    if (upper <= lower) return vec3(0.0);
    return viewDirection * (sin(upper) - sin(lower)) +
        sliceDirection * (cos(lower) - cos(upper));
}

void main() {
    ivec2 depthSize = textureSize(u_sceneDepth, 0);
    ivec2 pixel = pixelForUV(v_uv, depthSize);
    vec2 centerUV = (vec2(pixel) + 0.5) / vec2(depthSize);
    float centerDepth = texelFetch(u_sceneDepth, pixel, 0).r;
    if (isBackground(centerDepth)) {
        gtaoResult = vec4(0.0, 0.0, 1.0, 0.0);
        return;
    }
    vec3 center = reconstructViewPosition(centerUV, centerDepth);
    vec4 attributes = texelFetch(u_materialAttributes, pixel, 0);
    vec3 materialNormal = decodeOctahedralNormal(attributes.xy);
    vec3 geometryNormal = geometricNormalAt(pixel, depthSize, center, materialNormal);
    vec3 normal = ${
        settings.normalSource === 'material'
            ? 'materialNormal'
            : settings.normalSource === 'geometry'
              ? 'geometryNormal'
              : 'normalize(mix(materialNormal, geometryNormal, u_gtaoFade.w))'
    };
    float viewDepth = max(-center.z, 1e-4);
    float radiusPixels = u_gtaoProjection.y > 0.5
        ? u_gtaoSearch.x * u_gtaoProjection.x * float(depthSize.y) * 0.5 / viewDepth
        : u_gtaoSearch.x * float(depthSize.y) * 0.5 / max(abs(u_gtaoInverseProjection[1][1]), 1e-5);
    radiusPixels = clamp(radiusPixels, 1.0, 256.0);
    float phase = u_gtaoTemporal.w;
    float noise = interleavedGradientNoise(vec2(pixel) + vec2(phase * 17.0, phase * 29.0));
    float visibilitySum = 0.0;
    float contactVisibilitySum = 0.0;
    vec3 bentSum = vec3(0.0);
    vec3 viewDirection = normalize(-center);
    for (int directionIndex = 0; directionIndex < ${String(settings.directionCount)}; directionIndex++) {
        float angle = (float(directionIndex) + noise) * PI / float(${String(settings.directionCount)});
        vec2 screenDirection = vec2(cos(angle), sin(angle));
        vec3 sliceDirection = normalize(
            reconstructViewPosition(centerUV + screenDirection / vec2(depthSize), centerDepth) -
            center
        );
        vec3 sliceNormal = normalize(cross(sliceDirection, viewDirection));
        vec3 projectedNormal = normal - sliceNormal * dot(normal, sliceNormal);
        float projectedLength = max(length(projectedNormal), 1e-5);
        projectedNormal /= projectedLength;
        float normalCosine = clamp(dot(projectedNormal, viewDirection), -1.0, 1.0);
        float normalAngle = acos(normalCosine) *
            (dot(projectedNormal, sliceDirection) < 0.0 ? -1.0 : 1.0);
        vec2 horizons = vec2(-1.0);
        vec2 contactHorizons = vec2(-1.0);
        for (int side = -1; side <= 1; side += 2) {
            for (int stepIndex = 0; stepIndex < ${String(settings.stepCount)}; stepIndex++) {
                float stepNoise = fract(noise + float(stepIndex) * 0.61803398875);
                float stepFraction = (float(stepIndex) + 0.65 + stepNoise * 0.7) /
                    float(${String(settings.stepCount)});
                float pixelDistance = max(1.0, radiusPixels * stepFraction * stepFraction);
                vec2 sampleUV = centerUV + screenDirection * float(side) * pixelDistance /
                    vec2(depthSize);
                if (any(lessThanEqual(sampleUV, vec2(0.0))) ||
                    any(greaterThanEqual(sampleUV, vec2(1.0)))) continue;
                ivec2 samplePixel = pixelForUV(sampleUV, depthSize);
                sampleUV = (vec2(samplePixel) + 0.5) / vec2(depthSize);
                float sampleDepth = texelFetch(u_sceneDepth, samplePixel, 0).r;
                if (isBackground(sampleDepth)) continue;
                vec3 delta = reconstructViewPosition(sampleUV, sampleDepth) - center;
                float distanceToSample = length(delta);
                if (distanceToSample <= u_gtaoSearch.z || distanceToSample >= u_gtaoSearch.x) continue;
                float distanceWeight = 1.0 - smoothstep(
                    u_gtaoSearch.x * u_gtaoSearch.y,
                    u_gtaoSearch.x,
                    distanceToSample
                );
                float candidate = horizonCandidate(
                    dot(delta / distanceToSample, viewDirection),
                    distanceToSample,
                    distanceWeight
                );
                int component = side < 0 ? 0 : 1;
                horizons[component] = max(horizons[component], candidate);
                float contactWeight = 1.0 - smoothstep(
                    u_gtaoSearch.x * u_gtaoContact.x * 0.7,
                    u_gtaoSearch.x * u_gtaoContact.x,
                    distanceToSample
                );
                contactHorizons[component] = max(
                    contactHorizons[component],
                    horizonCandidate(
                        dot(delta / distanceToSample, viewDirection),
                        distanceToSample,
                        contactWeight
                    )
                );
            }
        }
        visibilitySum += clamp(
            integrateVisibility(horizons, normalAngle, projectedLength),
            0.0,
            1.0
        );
        contactVisibilitySum += clamp(
            integrateVisibility(contactHorizons, normalAngle, projectedLength),
            0.0,
            1.0
        );
        bentSum += integrateBentDirection(horizons, normalAngle, viewDirection, sliceDirection);
    }
    float inverseDirectionCount = 1.0 / float(${String(settings.directionCount)});
    float baseVisibility = clamp(visibilitySum * inverseDirectionCount, 0.0, 1.0);
    float contactVisibility = clamp(contactVisibilitySum * inverseDirectionCount, 0.0, 1.0);
    float combinedOcclusion = (1.0 - baseVisibility) * u_gtaoEffects.x +
        (1.0 - contactVisibility) * u_gtaoContact.y;
    float visibility = pow(clamp(1.0 - combinedOcclusion, 0.0, 1.0), u_gtaoSearch.w);
    float distanceFade = 1.0 - smoothstep(u_gtaoFade.x, u_gtaoFade.y, viewDepth);
    float edgeDistance = min(
        min(float(pixel.x), float(pixel.y)),
        min(float(depthSize.x - 1 - pixel.x), float(depthSize.y - 1 - pixel.y))
    );
    float edgeFade = u_gtaoContact.z <= 0.0
        ? 1.0
        : smoothstep(0.0, u_gtaoContact.z, edgeDistance);
    float fade = distanceFade * edgeFade;
    visibility = mix(1.0, visibility, fade);
    vec3 integratedBent = dot(bentSum, bentSum) > 1e-8 ? normalize(bentSum) : normal;
    if (dot(integratedBent, normal) < 0.0) integratedBent = normal;
    vec3 bentNormal = normalize(mix(
        normal,
        integratedBent,
        (1.0 - visibility) * u_gtaoEffects.w * fade
    ));
    gtaoResult = vec4(encodeOctahedralNormal(bentNormal), visibility, log2(1.0 + viewDepth));
}`;
}

const TEMPORAL_INITIALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_current;
layout(location = 0) out vec4 historyOutput;
void main() { historyOutput = texture(u_current, v_uv); }`;

const TEMPORAL_RESOLVE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_current;
uniform sampler2D u_history;
uniform sampler2D u_motionDepth;
uniform sampler2D u_materialAttributes;
${GTAO_BLOCK}
layout(location = 0) out vec4 historyOutput;

vec3 decodeOctahedralNormal(vec2 encoded) {
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
vec2 encodeOctahedralNormal(vec3 value) {
    vec3 normal = normalize(value);
    normal /= max(abs(normal.x) + abs(normal.y) + abs(normal.z), 1e-6);
    vec2 encoded = normal.xy;
    if (normal.z < 0.0) {
        encoded = (1.0 - abs(encoded.yx)) * vec2(
            encoded.x >= 0.0 ? 1.0 : -1.0,
            encoded.y >= 0.0 ? 1.0 : -1.0
        );
    }
    return encoded;
}
ivec2 pixelForUV(vec2 uv, ivec2 size) {
    return clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
}
vec3 materialNormalAt(vec2 uv) {
    ivec2 size = textureSize(u_materialAttributes, 0);
    vec2 encoded = texelFetch(u_materialAttributes, pixelForUV(uv, size), 0).xy * 2.0 - 1.0;
    return decodeOctahedralNormal(encoded);
}
float relativeDepthError(float previousLog, float expectedLog) {
    float previous = exp2(max(previousLog, 0.0)) - 1.0;
    float expected = exp2(max(expectedLog, 0.0)) - 1.0;
    return abs(previous - expected) / max(expected, 1e-3);
}
vec4 closestMotion(vec2 uv, float currentLogDepth) {
    ivec2 size = textureSize(u_motionDepth, 0);
    ivec2 center = pixelForUV(uv, size);
    vec4 closest = texelFetch(u_motionDepth, center, 0);
    float closestError = abs(closest.w - currentLogDepth);
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 coordinate = clamp(center + ivec2(x, y), ivec2(0), size - ivec2(1));
            vec4 candidate = texelFetch(u_motionDepth, coordinate, 0);
            float error = abs(candidate.w - currentLogDepth);
            if (error < closestError) {
                closest = candidate;
                closestError = error;
            }
        }
    }
    return closest;
}
vec4 sampleHistory(vec2 uv) {
    ivec2 size = textureSize(u_history, 0);
    vec2 position = uv * vec2(size) - 0.5;
    ivec2 base = ivec2(floor(position));
    vec2 fraction = fract(position);
    vec3 bent = vec3(0.0);
    float visibility = 0.0;
    float depth = 0.0;
    float totalWeight = 0.0;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 coordinate = clamp(base + ivec2(x, y), ivec2(0), size - ivec2(1));
            vec2 axisWeight = mix(vec2(1.0) - fraction, fraction, vec2(float(x), float(y)));
            float weight = axisWeight.x * axisWeight.y;
            vec4 sampleValue = texelFetch(u_history, coordinate, 0);
            bent += decodeOctahedralNormal(sampleValue.xy) * weight;
            visibility += sampleValue.z * weight;
            depth += sampleValue.w * weight;
            totalWeight += weight;
        }
    }
    return vec4(
        encodeOctahedralNormal(normalize(bent / max(totalWeight, 1e-5))),
        visibility / max(totalWeight, 1e-5),
        depth / max(totalWeight, 1e-5)
    );
}
void main() {
    ivec2 currentSize = textureSize(u_current, 0);
    ivec2 currentPixel = clamp(ivec2(v_uv * vec2(currentSize)), ivec2(0), currentSize - ivec2(1));
    vec4 current = texelFetch(u_current, currentPixel, 0);
    vec4 motion = closestMotion(v_uv, current.w);
    vec2 historyUV = v_uv - motion.xy;
    vec2 halfTexel = 0.5 / vec2(textureSize(u_history, 0));
    bool inside = all(greaterThanEqual(historyUV, halfTexel)) &&
        all(lessThanEqual(historyUV, vec2(1.0) - halfTexel));
    vec4 previous = sampleHistory(clamp(historyUV, halfTexel, vec2(1.0) - halfTexel));
    float mean = 0.0;
    float meanSquare = 0.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 coordinate = clamp(currentPixel + ivec2(x, y), ivec2(0), currentSize - ivec2(1));
            float value = texelFetch(u_current, coordinate, 0).z;
            mean += value;
            meanSquare += value * value;
        }
    }
    mean /= 9.0;
    meanSquare /= 9.0;
    float standardDeviation = sqrt(max(meanSquare - mean * mean, 0.0));
    float clipRadius = max(standardDeviation * 1.5, 0.018);
    previous.z = clamp(previous.z, mean - clipRadius, mean + clipRadius);
    float depthError = relativeDepthError(previous.w, motion.z);
    float normalAgreement = dot(materialNormalAt(v_uv), materialNormalAt(historyUV));
    bool accepted = inside && motion.z >= 0.0 && depthError <= u_gtaoTemporal.y &&
        normalAgreement >= u_gtaoTemporal.z;
    float velocityPixels = length(motion.xy * vec2(textureSize(u_motionDepth, 0)));
    float confidence = (1.0 - smoothstep(0.0, u_gtaoTemporal.y, depthError)) *
        smoothstep(u_gtaoTemporal.z, 1.0, normalAgreement);
    float stableWeight = u_gtaoTemporal.x * confidence;
    float weight = accepted ? mix(
        stableWeight,
        min(stableWeight, 0.5),
        clamp(velocityPixels / 16.0, 0.0, 1.0)
    ) : 0.0;
    vec3 bent = normalize(mix(
        decodeOctahedralNormal(current.xy),
        decodeOctahedralNormal(previous.xy),
        weight
    ));
    historyOutput = vec4(
        encodeOctahedralNormal(bent),
        mix(current.z, previous.z, weight),
        current.w
    );
}`;

function spatialFilterFragment(step: number): string {
    return `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
uniform sampler2D u_materialAttributes;
layout(location = 0) out vec4 filtered;
vec3 decodeOctahedralNormal(vec2 encoded) {
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
vec2 encodeOctahedralNormal(vec3 value) {
    vec3 normal = normalize(value);
    normal /= max(abs(normal.x) + abs(normal.y) + abs(normal.z), 1e-6);
    vec2 encoded = normal.xy;
    if (normal.z < 0.0) {
        encoded = (1.0 - abs(encoded.yx)) * vec2(
            encoded.x >= 0.0 ? 1.0 : -1.0,
            encoded.y >= 0.0 ? 1.0 : -1.0
        );
    }
    return encoded;
}
ivec2 pixelForUV(vec2 uv, ivec2 size) {
    return clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
}
vec3 materialNormalAt(vec2 uv) {
    ivec2 size = textureSize(u_materialAttributes, 0);
    vec2 encoded = texelFetch(u_materialAttributes, pixelForUV(uv, size), 0).xy * 2.0 - 1.0;
    return decodeOctahedralNormal(encoded);
}
float viewDepth(float logarithmicDepth) {
    return exp2(max(logarithmicDepth, 0.0)) - 1.0;
}
void main() {
    ivec2 size = textureSize(u_source, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(size)), ivec2(0), size - ivec2(1));
    vec4 center = texelFetch(u_source, pixel, 0);
    vec3 centerNormal = materialNormalAt(v_uv);
    float centerDepth = viewDepth(center.w);
    vec3 bentSum = decodeOctahedralNormal(center.xy);
    float visibilitySum = center.z;
    float totalWeight = 1.0;
    const ivec2 offsets[4] = ivec2[4](
        ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1)
    );
    for (int index = 0; index < 4; index++) {
        ivec2 coordinate = clamp(pixel + offsets[index] * ${String(step)}, ivec2(0), size - ivec2(1));
        vec2 sampleUV = (vec2(coordinate) + 0.5) / vec2(size);
        vec4 sampleValue = texelFetch(u_source, coordinate, 0);
        vec3 sampleNormal = materialNormalAt(sampleUV);
        float sampleDepth = viewDepth(sampleValue.w);
        float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 24.0);
        float relativeDepth = abs(centerDepth - sampleDepth) / max(centerDepth, 1e-3);
        float depthWeight = exp(-relativeDepth * 64.0);
        float spatialWeight = 0.42;
        float weight = normalWeight * depthWeight * spatialWeight;
        bentSum += decodeOctahedralNormal(sampleValue.xy) * weight;
        visibilitySum += sampleValue.z * weight;
        totalWeight += weight;
    }
    filtered = vec4(
        encodeOctahedralNormal(normalize(bentSum / max(totalWeight, 1e-5))),
        clamp(visibilitySum / max(totalWeight, 1e-5), 0.0, 1.0),
        center.w
    );
}`;
}

const UPSAMPLE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_lowResolutionAO;
uniform sampler2D u_materialAttributes;
uniform sampler2D u_motionDepth;
${GTAO_BLOCK}
layout(location = 0) out vec4 fullResolutionAO;
vec3 decodeOctahedralNormal(vec2 encoded) {
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
vec2 encodeOctahedralNormal(vec3 value) {
    vec3 normal = normalize(value);
    normal /= max(abs(normal.x) + abs(normal.y) + abs(normal.z), 1e-6);
    vec2 encoded = normal.xy;
    if (normal.z < 0.0) {
        encoded = (1.0 - abs(encoded.yx)) * vec2(
            encoded.x >= 0.0 ? 1.0 : -1.0,
            encoded.y >= 0.0 ? 1.0 : -1.0
        );
    }
    return encoded;
}
ivec2 pixelForUV(vec2 uv, ivec2 size) {
    return clamp(ivec2(uv * vec2(size)), ivec2(0), size - ivec2(1));
}
vec3 materialNormalAt(vec2 uv) {
    ivec2 size = textureSize(u_materialAttributes, 0);
    vec2 encoded = texelFetch(u_materialAttributes, pixelForUV(uv, size), 0).xy * 2.0 - 1.0;
    return decodeOctahedralNormal(encoded);
}
void main() {
    ivec2 lowSize = textureSize(u_lowResolutionAO, 0);
    vec2 lowPosition = v_uv * vec2(lowSize) - 0.5;
    ivec2 base = ivec2(floor(lowPosition));
    vec3 centerNormal = materialNormalAt(v_uv);
    ivec2 motionSize = textureSize(u_motionDepth, 0);
    float centerDepth = texelFetch(u_motionDepth, pixelForUV(v_uv, motionSize), 0).w;
    ivec2 fallbackCoordinate = clamp(
        ivec2(floor(lowPosition + 0.5)),
        ivec2(0),
        lowSize - ivec2(1)
    );
    vec4 fallback = texelFetch(u_lowResolutionAO, fallbackCoordinate, 0);
    vec3 bentSum = vec3(0.0);
    float visibilitySum = 0.0;
    float totalWeight = 0.0;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 coordinate = clamp(base + ivec2(x, y), ivec2(0), lowSize - ivec2(1));
            vec2 sampleUV = (vec2(coordinate) + 0.5) / vec2(lowSize);
            vec4 sampleValue = texelFetch(u_lowResolutionAO, coordinate, 0);
            vec3 sampleNormal = materialNormalAt(sampleUV);
            vec2 bilinear = 1.0 - abs(vec2(coordinate) - lowPosition);
            float spatialWeight = max(bilinear.x, 0.001) * max(bilinear.y, 0.001);
            float normalWeight = pow(clamp(dot(centerNormal, sampleNormal), 0.0, 1.0), 24.0);
            float sampleDepth = sampleValue.w;
            float relativeDepth = abs(
                (exp2(sampleDepth) - 1.0) - (exp2(centerDepth) - 1.0)
            ) / max(exp2(centerDepth) - 1.0, 1e-3);
            float depthWeight = exp(-relativeDepth * 64.0);
            float weight = spatialWeight * normalWeight * depthWeight;
            bentSum += decodeOctahedralNormal(sampleValue.xy) * weight;
            visibilitySum += sampleValue.z * weight;
            totalWeight += weight;
        }
    }
    vec3 bent = totalWeight > 1e-5
        ? normalize(bentSum / totalWeight)
        : decodeOctahedralNormal(fallback.xy);
    float visibility = totalWeight > 1e-5 ? visibilitySum / totalWeight : fallback.z;
    fullResolutionAO = vec4(
        encodeOctahedralNormal(bent),
        clamp(visibility, 0.0, 1.0),
        u_gtaoContact.w
    );
}`;

const FINALIZE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
${GTAO_BLOCK}
layout(location = 0) out vec4 finalAO;
void main() {
    ivec2 size = textureSize(u_source, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(size)), ivec2(0), size - ivec2(1));
    vec4 sourceValue = texelFetch(u_source, pixel, 0);
    finalAO = vec4(sourceValue.xy, clamp(sourceValue.z, 0.0, 1.0), u_gtaoContact.w);
}`;

function fullscreenPass(
    name: string,
    fragmentSource: string,
    uniformBuffers: readonly UniformBuffer[] = []
): FullscreenRenderPass {
    return new FullscreenRenderPass({
        name,
        shader: new Shader({ vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE, fs: fragmentSource }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        },
        uniformBuffers
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

interface GTAOCameraState {
    readonly camera: Camera;
    readonly historyKey: object;
    readonly inverseProjection: Matrix4;
    readonly block: UniformBuffer<typeof gtaoLayout.schema>;
    readonly horizonPass: FullscreenRenderPass;
    readonly resolvePass: FullscreenRenderPass;
    readonly upsamplePass: FullscreenRenderPass;
    readonly finalizePass: FullscreenRenderPass;
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

/** Inputs shared by ordinary Forward and Clustered Forward+ GTAO recording. */
export interface GroundTruthAmbientOcclusionResources {
    readonly sceneDepth: RenderGraphTextureHandle;
    readonly materialAttributes: RenderGraphTextureHandle;
    readonly motionDepth: RenderGraphTextureHandle;
    readonly sceneScale: number;
    /** Additional producer-specific temporal validity, such as a GPU Scene camera cut. */
    readonly historyValid?: boolean;
}

/** @internal Portable raster GTAO, temporal accumulation, denoise, and bilateral upsample. */
export class GroundTruthAmbientOcclusionController {
    readonly #settings: Readonly<GroundTruthAmbientOcclusionSettings>;
    readonly #initializePass = fullscreenPass(
        'GTAO initialize temporal history',
        TEMPORAL_INITIALIZE_FRAGMENT
    );
    readonly #filterPasses = Object.freeze([
        fullscreenPass('GTAO edge-aware filter 1', spatialFilterFragment(1)),
        fullscreenPass('GTAO edge-aware filter 2', spatialFilterFragment(2))
    ]);
    readonly #parameters = new RenderPassParameterPool(
        () => new MutableFullscreenParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #states = new WeakMap<Camera, GTAOCameraState>();
    readonly #ownedStates = new Set<GTAOCameraState>();
    readonly #stagedStates: GTAOCameraState[] = [];
    readonly #pendingEvictions: GTAOCameraState[] = [];
    readonly #aoDescriptor: {
        format: 'rgba16float';
        extent: { width: number; height: number };
        sampleCount: 1;
    } = { format: 'rgba16float', extent: { width: 1, height: 1 }, sampleCount: 1 };
    readonly #historyDescriptor: {
        label: string;
        format: 'rgba16float';
        extent: { width: number; height: number };
        usage: readonly ['sampled', 'attachment'];
        bufferCount: 2;
    } = {
        label: 'GTAO bent-normal visibility history',
        format: 'rgba16float',
        extent: { width: 1, height: 1 },
        usage: Object.freeze(['sampled', 'attachment'] as const),
        bufferCount: 2
    };
    readonly #fullResolutionDescriptor: {
        format: 'rgba16float';
        extent: { width: number; height: number };
        sampleCount: 1;
    } = { format: 'rgba16float', extent: { width: 1, height: 1 }, sampleCount: 1 };
    #submissionIndex = 0;
    #destroyed = false;

    constructor(settings: Readonly<GroundTruthAmbientOcclusionSettings>) {
        this.#settings = settings;
    }

    record(
        context: RenderPipelineContext,
        resources: Readonly<GroundTruthAmbientOcclusionResources>
    ): RenderGraphTextureHandle {
        if (this.#destroyed) throw new Error('GroundTruthAmbientOcclusion controller is destroyed');
        const [x, y, viewportWidth, viewportHeight] = context.viewport;
        if (
            x !== 0 ||
            y !== 0 ||
            viewportWidth !== context.output.width ||
            viewportHeight !== context.output.height
        ) {
            throw new Error(
                'GroundTruthAmbientOcclusion currently requires a full-output viewport'
            );
        }
        const sceneWidth = Math.max(1, Math.floor(context.output.width * resources.sceneScale));
        const sceneHeight = Math.max(1, Math.floor(context.output.height * resources.sceneScale));
        const aoWidth = Math.max(1, Math.floor(sceneWidth * this.#settings.resolutionScale));
        const aoHeight = Math.max(1, Math.floor(sceneHeight * this.#settings.resolutionScale));
        this.#aoDescriptor.extent.width = aoWidth;
        this.#aoDescriptor.extent.height = aoHeight;
        this.#historyDescriptor.extent.width = aoWidth;
        this.#historyDescriptor.extent.height = aoHeight;
        this.#fullResolutionDescriptor.extent.width = sceneWidth;
        this.#fullResolutionDescriptor.extent.height = sceneHeight;

        const camera = context.camera;
        const farValue: unknown = Reflect.get(camera, 'far');
        if (
            context.useLogDepth &&
            (!camera.isPerspectiveCamera ||
                camera.depthMode === 'reversed' ||
                typeof farValue !== 'number' ||
                !Number.isFinite(farValue) ||
                farValue <= 0)
        ) {
            throw new Error(
                'GroundTruthAmbientOcclusion logarithmic depth requires a standard-Z perspective camera with a finite positive far plane'
            );
        }
        const far = typeof farValue === 'number' && Number.isFinite(farValue) ? farValue : 1;
        const projection = camera.jitteredProjectionMatrix.elements;
        const state = this.stageCamera(context, camera);
        state.inverseProjection.invert(camera.jitteredProjectionMatrix);
        state.block
            .set('u_gtaoInverseProjection', state.inverseProjection.elements)
            .set('u_gtaoProjection', [
                Math.abs(projection[5]),
                camera.isPerspectiveCamera ? 1 : 0,
                camera.depthMode === 'reversed' ? 1 : 0,
                context.useLogDepth ? 1 : 0
            ])
            .set('u_gtaoTemporal', [
                this.#settings.historyWeight,
                this.#settings.depthThreshold,
                this.#settings.normalThreshold,
                this.#submissionIndex % 24
            ])
            .set('u_gtaoFade', [
                this.#settings.distanceFadeStart,
                this.#settings.distanceFadeEnd,
                Math.log2(far + 1),
                this.#settings.geometricNormalWeight
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
            'GTAO current bent normal and visibility',
            this.#aoDescriptor
        );
        this.addFullscreen(
            context,
            state.horizonPass,
            [resources.sceneDepth, resources.materialAttributes],
            current
        );

        const historyAccepted = !discontinuous && (resources.historyValid ?? true) && history.valid;
        this.addFullscreen(
            context,
            historyAccepted ? state.resolvePass : this.#initializePass,
            historyAccepted
                ? [current, history.history(), resources.motionDepth, resources.materialAttributes]
                : [current],
            history.current
        );

        let filtered: RenderGraphTextureHandle = history.current;
        for (let index = 0; index < this.#filterPasses.length; index += 1) {
            const destination = context.graph.createTexture(
                `GTAO filtered visibility ${String(index + 1)}`,
                this.#aoDescriptor
            );
            const pass = this.#filterPasses[index];
            if (pass === undefined) throw new Error('GTAO spatial filter pass is missing');
            this.addFullscreen(
                context,
                pass,
                [filtered, resources.materialAttributes],
                destination
            );
            filtered = destination;
        }

        const fullResolution = context.graph.createTexture(
            'GTAO full-resolution bent normal and visibility',
            this.#fullResolutionDescriptor
        );
        if (aoWidth === sceneWidth && aoHeight === sceneHeight) {
            this.addFullscreen(context, state.finalizePass, [filtered], fullResolution);
        } else {
            this.addFullscreen(
                context,
                state.upsamplePass,
                [filtered, resources.materialAttributes, resources.motionDepth],
                fullResolution
            );
        }
        return fullResolution;
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
            if (input === undefined) throw new Error('GTAO fullscreen input is missing');
            parameters.inputTextures[index] = input;
        }
        parameters.colorAttachments[0] = {
            texture: output,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 1, a: 0 }
        };
        context.graph.addPass(pass, parameters);
    }

    private stageCamera(context: RenderPipelineContext, camera: Camera): GTAOCameraState {
        const frameIndex = context.frameIndex;
        this.sweepInactiveStates(context, camera);
        let state = this.#states.get(camera);
        if (state === undefined) {
            state = this.createCameraState(camera, frameIndex);
            this.#states.set(camera, state);
            this.#ownedStates.add(state);
        }
        if (state.pendingFrame >= 0) {
            throw new Error(
                'GroundTruthAmbientOcclusion supports one invocation per camera per frame'
            );
        }
        state.pendingFrame = frameIndex;
        state.pendingTransformRevision = getTransformHistoryRevision(camera);
        state.pendingProjection.set(camera.projectionMatrix.elements);
        state.lastTouchedFrame = frameIndex;
        this.#stagedStates.push(state);
        return state;
    }

    private createCameraState(camera: Camera, frameIndex: number): GTAOCameraState {
        const inverseProjection = new Matrix4();
        const settings = this.#settings;
        const block = UniformBuffer.fromSchema(gtaoLayout, {
            u_gtaoInverseProjection: inverseProjection.elements,
            u_gtaoProjection: [1, 1, 0, 0],
            u_gtaoSearch: [
                settings.radius,
                settings.falloffStart,
                settings.thickness,
                settings.power
            ],
            u_gtaoTemporal: [
                settings.historyWeight,
                settings.depthThreshold,
                settings.normalThreshold,
                0
            ],
            u_gtaoEffects: [
                settings.intensity,
                settings.bias,
                settings.thicknessBlend,
                settings.bentNormalStrength
            ],
            u_gtaoContact: [
                settings.contactRadiusScale,
                settings.contactStrength,
                settings.edgeFadePixels,
                settings.multiBounce
            ],
            u_gtaoFade: [
                settings.distanceFadeStart,
                settings.distanceFadeEnd,
                1,
                settings.geometricNormalWeight
            ]
        });
        return {
            camera,
            historyKey: Object.freeze({}),
            inverseProjection,
            block,
            horizonPass: fullscreenPass('GTAO rotated horizon search', horizonFragment(settings), [
                block
            ]),
            resolvePass: fullscreenPass(
                'GTAO production temporal resolve',
                TEMPORAL_RESOLVE_FRAGMENT,
                [block]
            ),
            upsamplePass: fullscreenPass(
                'GTAO bilateral full-resolution upsample',
                UPSAMPLE_FRAGMENT,
                [block]
            ),
            finalizePass: fullscreenPass('GTAO full-resolution finalize', FINALIZE_FRAGMENT, [
                block
            ]),
            committedProjection: new Float32Array(16),
            committedTransformRevision: -1,
            committedSubmission: -1,
            pendingFrame: -1,
            pendingTransformRevision: -1,
            pendingProjection: new Float32Array(16),
            lastTouchedFrame: frameIndex
        };
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

class GroundTruthAmbientOcclusionRuntime implements ForwardRenderPipelineFeatureRuntime {
    readonly #controller: GroundTruthAmbientOcclusionController;
    readonly #depthPass = new SceneRenderPass('GTAO opaque depth prepass');
    readonly #attributesPass = new SceneRenderPass('GTAO material attributes');
    readonly #motionPass = new SceneRenderPass('GTAO motion and logarithmic depth');
    readonly #sceneParameters = new RenderPassParameterPool(
        () => new MutableSceneParameters(),
        parameters => {
            parameters.reset();
        }
    );
    readonly #depthList = {
        cullingResults: INVALID_CULLING_RESULTS,
        queue: 'opaque' as const,
        sorting: 'material-front-to-back' as const,
        materialPass: 'depth-only' as const
    };
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

    constructor(settings: Readonly<GroundTruthAmbientOcclusionSettings>) {
        this.#controller = new GroundTruthAmbientOcclusionController(settings);
    }

    record(context: ForwardRenderFeatureContext): void {
        const pipeline = context.pipeline;
        const depth = context.resources.depth;
        if (depth === null)
            throw new Error('GroundTruthAmbientOcclusion requires sampled scene depth');
        this.#depthList.cullingResults = context.cullingResults;
        const depthParameters = pipeline.acquirePassParameters(this.#sceneParameters);
        depthParameters.rendererList = pipeline.createRendererList(this.#depthList);
        depthParameters.depthStencilAttachment = this.depthAttachment(pipeline, depth, true);
        pipeline.graph.addPass(this.#depthPass, depthParameters);
        context.resources.markDepthPrepassed();

        const sceneScale = context.resources.sceneScale;
        const extent = Object.freeze({ relativeTo: 'output' as const, scale: sceneScale });
        const attributes = pipeline.graph.createTexture('GTAO material attributes', {
            format: 'rgba8unorm',
            extent,
            sampleCount: 1
        });
        this.#attributeList.cullingResults = context.cullingResults;
        const attributeParameters = pipeline.acquirePassParameters(this.#sceneParameters);
        attributeParameters.rendererList = pipeline.createRendererList(this.#attributeList);
        attributeParameters.colorAttachments.push({
            texture: attributes,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.5, g: 0.5, b: 1, a: 0 }
        });
        attributeParameters.depthStencilAttachment = this.depthAttachment(pipeline, depth, false);
        pipeline.graph.addPass(this.#attributesPass, attributeParameters);
        context.resources.setMaterialAttributes(attributes);

        const sharedMotion = context.resources.motionDepth;
        const motion =
            sharedMotion ??
            pipeline.graph.createTexture('GTAO motion and logarithmic view depth', {
                format: 'rgba16float',
                extent,
                sampleCount: 1
            });
        if (sharedMotion === null) {
            this.#motionList.cullingResults = context.cullingResults;
            const motionParameters = pipeline.acquirePassParameters(this.#sceneParameters);
            motionParameters.rendererList = pipeline.createRendererList(this.#motionList);
            motionParameters.colorAttachments.push({
                texture: motion,
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: -1, a: 0 }
            });
            motionParameters.depthStencilAttachment = this.depthAttachment(pipeline, depth, false);
            pipeline.graph.addPass(this.#motionPass, motionParameters);
            context.resources.setMotionDepth(motion);
        }

        const gtao = this.#controller.record(pipeline, {
            sceneDepth: depth,
            materialAttributes: attributes,
            motionDepth: motion,
            sceneScale
        });
        context.resources.setAmbientOcclusionTexture(gtao);
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

    private depthAttachment(
        context: RenderPipelineContext,
        depth: RenderGraphTextureHandle,
        initialize: boolean
    ): RenderPipelineDepthStencilAttachment {
        const selected = context.output.depthStencilAttachment;
        const attachment: {
            texture: RenderGraphTextureHandle;
            depthLoadOp: 'clear' | 'load';
            depthStoreOp: 'store';
            depthClearValue: number;
            stencilLoadOp?: 'clear' | 'load';
            stencilStoreOp?: 'store';
            stencilClearValue?: number;
        } = {
            texture: depth,
            depthLoadOp: initialize ? (selected?.depthLoadOp ?? 'clear') : 'load',
            depthStoreOp: 'store',
            depthClearValue: selected?.depthClearValue ?? depthClearValue(context.camera.depthMode)
        };
        if (
            context.output.depthStencilFormat !== null &&
            renderTargetFormatHasStencil(context.output.depthStencilFormat)
        ) {
            attachment.stencilLoadOp = initialize ? (selected?.stencilLoadOp ?? 'clear') : 'load';
            attachment.stencilStoreOp = 'store';
            attachment.stencilClearValue = selected?.stencilClearValue ?? 0;
        }
        return attachment;
    }
}

/**
 * Portable production GTAO for the shared Forward pipeline.
 *
 * The feature records opaque depth, material attributes, and motion before shading, evaluates
 * rotated horizon visibility at configurable resolution, applies submission-aware temporal
 * rejection and edge-aware filtering, and binds the full-resolution result only to indirect PBR
 * lighting. Direct lights and emission remain unoccluded.
 */
export class GroundTruthAmbientOcclusion implements ForwardRenderPipelineFeature {
    readonly name = 'ground-truth-ambient-occlusion';
    readonly injectionPoint = 'before-opaque' as const;
    readonly requirements: Readonly<ForwardRenderFeatureRequirements> = Object.freeze({
        sampledSceneColor: false,
        sampledDepth: true,
        splitScene: true,
        ...GROUND_TRUTH_AMBIENT_OCCLUSION_REQUIREMENTS
    });
    readonly #settings: Readonly<GroundTruthAmbientOcclusionSettings>;

    constructor(options: Readonly<GroundTruthAmbientOcclusionOptions> = {}) {
        this.#settings = snapshotGroundTruthAmbientOcclusionOptions(options);
    }

    create(): ForwardRenderPipelineFeatureRuntime {
        return new GroundTruthAmbientOcclusionRuntime(this.#settings);
    }
}
