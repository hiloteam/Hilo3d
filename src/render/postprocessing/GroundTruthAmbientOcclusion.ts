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

/** Production controls for ground-truth ambient occlusion. */
export interface GroundTruthAmbientOcclusionOptions {
    /** Internal AO resolution relative to opaque rendering. Defaults to 0.5. */
    readonly resolutionScale?: number;
    /** View-space horizon-search radius. Defaults to 2. */
    readonly radius?: number;
    /** Fraction of the radius at which distance falloff begins. Defaults to 0.6. */
    readonly falloffStart?: number;
    /** Thin-surface tolerance in view-space units. Defaults to 0.05. */
    readonly thickness?: number;
    /** Number of rotated horizon slices per pixel. Defaults to 6. */
    readonly directionCount?: 4 | 6 | 8;
    /** Samples evaluated on each side of a horizon slice. Defaults to 4. */
    readonly stepCount?: 3 | 4 | 5 | 6;
    /** Contrast applied to the physically normalized visibility. Defaults to 1.2. */
    readonly power?: number;
    /** Maximum accepted temporal contribution. Defaults to 0.9. */
    readonly historyWeight?: number;
    /** Maximum relative reprojected view-depth error. Defaults to 0.03. */
    readonly depthThreshold?: number;
}

/** @internal Immutable validated GTAO configuration. */
export interface GroundTruthAmbientOcclusionSettings {
    readonly resolutionScale: number;
    readonly radius: number;
    readonly falloffStart: number;
    readonly thickness: number;
    readonly directionCount: 4 | 6 | 8;
    readonly stepCount: 3 | 4 | 5 | 6;
    readonly power: number;
    readonly historyWeight: number;
    readonly depthThreshold: number;
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

/** @internal Validate and freeze public GTAO options. */
export function snapshotGroundTruthAmbientOcclusionOptions(
    options: Readonly<GroundTruthAmbientOcclusionOptions>
): Readonly<GroundTruthAmbientOcclusionSettings> {
    return Object.freeze({
        resolutionScale: finiteRange(
            options.resolutionScale ?? 0.5,
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
        directionCount: member(
            options.directionCount ?? 6,
            [4, 6, 8] as const,
            'GroundTruthAmbientOcclusion directionCount'
        ),
        stepCount: member(
            options.stepCount ?? 4,
            [3, 4, 5, 6] as const,
            'GroundTruthAmbientOcclusion stepCount'
        ),
        power: finiteRange(options.power ?? 1.2, 0.25, 4, 'GroundTruthAmbientOcclusion power'),
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
        )
    });
}

/** Static requirements shared by Forward and Clustered GTAO integrations. */
export const GROUND_TRUTH_AMBIENT_OCCLUSION_REQUIREMENTS = Object.freeze({
    requiredTextureFormats: Object.freeze([
        Object.freeze({ format: 'rgba16float' as const, use: 'color-attachment' as const }),
        Object.freeze({ format: 'rgba16float' as const, use: 'filterable-sampled' as const })
    ])
}) satisfies Readonly<RenderPipelineRequirements>;

const GTAO_BLOCK = `layout(std140) uniform GroundTruthAmbientOcclusionBlock {
    mat4 u_gtaoInverseProjection;
    vec4 u_gtaoProjection;
    vec4 u_gtaoSearch;
    vec4 u_gtaoTemporal;
};`;

registerUniformBlockBinding('GroundTruthAmbientOcclusionBlock');

const gtaoLayout = createStd140Layout({
    u_gtaoInverseProjection: 'mat4',
    u_gtaoProjection: 'vec4',
    u_gtaoSearch: 'vec4',
    u_gtaoTemporal: 'vec4'
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

vec2 ndcForUV(vec2 uv) {
    vec2 ndc = uv * 2.0 - 1.0;
    #ifdef HILO_WEBGPU
        ndc.y = -ndc.y;
    #endif
    return ndc;
}

vec3 reconstructViewPosition(vec2 uv, float deviceDepth) {
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

void main() {
    ivec2 depthSize = textureSize(u_sceneDepth, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(depthSize)), ivec2(0), depthSize - ivec2(1));
    float centerDepth = texelFetch(u_sceneDepth, pixel, 0).r;
    if (isBackground(centerDepth)) {
        gtaoResult = vec4(0.0, 0.0, 1.0, 0.0);
        return;
    }
    vec3 center = reconstructViewPosition(v_uv, centerDepth);
    vec4 attributes = texelFetch(u_materialAttributes, pixel, 0);
    vec3 normal = decodeOctahedralNormal(attributes.xy);
    float viewDepth = max(-center.z, 1e-4);
    float radiusPixels = u_gtaoProjection.y > 0.5
        ? u_gtaoSearch.x * u_gtaoProjection.x * float(depthSize.y) * 0.5 / viewDepth
        : u_gtaoSearch.x * float(depthSize.y) * 0.5 / max(abs(u_gtaoInverseProjection[1][1]), 1e-5);
    radiusPixels = clamp(radiusPixels, 1.0, 256.0);
    float noise = interleavedGradientNoise(vec2(pixel) + u_gtaoTemporal.w * 17.0);
    float occlusion = 0.0;
    vec3 bent = normal;
    for (int directionIndex = 0; directionIndex < ${String(settings.directionCount)}; directionIndex++) {
        float angle = (float(directionIndex) + noise) * PI / float(${String(settings.directionCount)});
        vec2 screenDirection = vec2(cos(angle), sin(angle));
        float directionOcclusion = 0.0;
        vec3 directionBend = vec3(0.0);
        for (int side = -1; side <= 1; side += 2) {
            float horizon = 0.0;
            for (int stepIndex = 0; stepIndex < ${String(settings.stepCount)}; stepIndex++) {
                float stepFraction = (float(stepIndex) + 1.0 + noise * 0.35) /
                    float(${String(settings.stepCount)});
                float pixelDistance = max(1.0, radiusPixels * stepFraction * stepFraction);
                vec2 sampleUV = v_uv + screenDirection * float(side) * pixelDistance /
                    vec2(depthSize);
                if (any(lessThanEqual(sampleUV, vec2(0.0))) ||
                    any(greaterThanEqual(sampleUV, vec2(1.0)))) continue;
                ivec2 samplePixel = clamp(
                    ivec2(sampleUV * vec2(depthSize)),
                    ivec2(0),
                    depthSize - ivec2(1)
                );
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
                float sampleHorizon = max(dot(normal, delta / distanceToSample), 0.0) *
                    distanceWeight;
                horizon = max(horizon, sampleHorizon);
            }
            directionOcclusion += horizon;
            vec2 away = -screenDirection * float(side);
            vec3 tangent = normalize(
                reconstructViewPosition(v_uv + away * 0.01, centerDepth) - center
            );
            directionBend += tangent * horizon;
        }
        occlusion += min(directionOcclusion * 0.5, 1.0);
        bent += directionBend / float(${String(settings.directionCount)});
    }
    float visibility = pow(
        clamp(1.0 - occlusion / float(${String(settings.directionCount)}), 0.0, 1.0),
        u_gtaoSearch.w
    );
    vec3 bentNormal = normalize(mix(normal, normalize(bent), 1.0 - visibility));
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
in vec2 v_uv;
uniform sampler2D u_current;
uniform sampler2D u_history;
uniform sampler2D u_motionDepth;
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
float relativeDepthError(float previousLog, float expectedLog) {
    float previous = exp2(max(previousLog, 0.0)) - 1.0;
    float expected = exp2(max(expectedLog, 0.0)) - 1.0;
    return abs(previous - expected) / max(expected, 1e-3);
}
void main() {
    ivec2 currentSize = textureSize(u_current, 0);
    ivec2 currentPixel = clamp(ivec2(v_uv * vec2(currentSize)), ivec2(0), currentSize - ivec2(1));
    vec4 current = texelFetch(u_current, currentPixel, 0);
    vec4 motion = texture(u_motionDepth, v_uv);
    vec2 historyUV = v_uv - motion.xy;
    vec2 halfTexel = 0.5 / vec2(textureSize(u_history, 0));
    bool inside = all(greaterThanEqual(historyUV, halfTexel)) &&
        all(lessThanEqual(historyUV, vec2(1.0) - halfTexel));
    vec4 previous = texture(u_history, clamp(historyUV, halfTexel, vec2(1.0) - halfTexel));
    float minimumVisibility = current.z;
    float maximumVisibility = current.z;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            ivec2 coordinate = clamp(currentPixel + ivec2(x, y), ivec2(0), currentSize - ivec2(1));
            float value = texelFetch(u_current, coordinate, 0).z;
            minimumVisibility = min(minimumVisibility, value);
            maximumVisibility = max(maximumVisibility, value);
        }
    }
    previous.z = clamp(previous.z, minimumVisibility, maximumVisibility);
    bool accepted = inside && motion.z >= 0.0 &&
        relativeDepthError(previous.w, motion.z) <= u_gtaoTemporal.y;
    float velocityPixels = length(motion.xy * vec2(textureSize(u_motionDepth, 0)));
    float weight = accepted
        ? mix(u_gtaoTemporal.x, min(u_gtaoTemporal.x, 0.55), clamp(velocityPixels / 24.0, 0.0, 1.0))
        : 0.0;
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
uniform sampler2D u_motionDepth;
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
void main() {
    ivec2 size = textureSize(u_source, 0);
    ivec2 pixel = clamp(ivec2(v_uv * vec2(size)), ivec2(0), size - ivec2(1));
    vec4 center = texelFetch(u_source, pixel, 0);
    vec3 centerNormal = decodeOctahedralNormal(texture(u_materialAttributes, v_uv).xy);
    float centerDepth = texture(u_motionDepth, v_uv).w;
    vec4 sum = center * 0.4;
    float totalWeight = 0.4;
    const ivec2 offsets[8] = ivec2[8](
        ivec2(1, 0), ivec2(-1, 0), ivec2(0, 1), ivec2(0, -1),
        ivec2(1, 1), ivec2(-1, 1), ivec2(1, -1), ivec2(-1, -1)
    );
    for (int index = 0; index < 8; index++) {
        ivec2 coordinate = clamp(pixel + offsets[index] * ${String(step)}, ivec2(0), size - ivec2(1));
        vec2 sampleUV = (vec2(coordinate) + 0.5) / vec2(size);
        vec4 sampleValue = texelFetch(u_source, coordinate, 0);
        vec3 sampleNormal = decodeOctahedralNormal(texture(u_materialAttributes, sampleUV).xy);
        float sampleDepth = texture(u_motionDepth, sampleUV).w;
        float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 16.0);
        float relativeDepth = abs((exp2(centerDepth) - 1.0) - (exp2(sampleDepth) - 1.0)) /
            max(exp2(centerDepth) - 1.0, 1e-3);
        float depthWeight = exp(-relativeDepth * 48.0);
        float spatialWeight = index < 4 ? 0.075 : 0.0375;
        float weight = normalWeight * depthWeight * spatialWeight;
        sum += sampleValue * weight;
        totalWeight += weight;
    }
    filtered = sum / max(totalWeight, 1e-5);
}`;
}

const UPSAMPLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_lowResolutionAO;
uniform sampler2D u_materialAttributes;
uniform sampler2D u_motionDepth;
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
void main() {
    ivec2 lowSize = textureSize(u_lowResolutionAO, 0);
    vec2 lowPosition = v_uv * vec2(lowSize) - 0.5;
    ivec2 base = ivec2(floor(lowPosition));
    vec3 centerNormal = decodeOctahedralNormal(texture(u_materialAttributes, v_uv).xy);
    float centerDepth = clamp(texture(u_motionDepth, v_uv).w, 0.0, 32.0);
    vec4 fallback = texture(u_lowResolutionAO, v_uv);
    vec4 sum = fallback * 1e-4;
    float totalWeight = 1e-4;
    for (int y = 0; y <= 1; y++) {
        for (int x = 0; x <= 1; x++) {
            ivec2 coordinate = clamp(base + ivec2(x, y), ivec2(0), lowSize - ivec2(1));
            vec2 sampleUV = (vec2(coordinate) + 0.5) / vec2(lowSize);
            vec4 sampleValue = texelFetch(u_lowResolutionAO, coordinate, 0);
            vec3 sampleNormal = decodeOctahedralNormal(texture(u_materialAttributes, sampleUV).xy);
            vec2 bilinear = 1.0 - abs(vec2(coordinate) - lowPosition);
            float spatialWeight = max(bilinear.x, 0.001) * max(bilinear.y, 0.001);
            float normalWeight = pow(clamp(dot(centerNormal, sampleNormal), 0.0, 1.0), 12.0);
            float sampleDepth = clamp(sampleValue.w, 0.0, 32.0);
            float depthWeight = exp(-abs(sampleDepth - centerDepth) * 24.0);
            float weight = spatialWeight * normalWeight * depthWeight;
            sum += sampleValue * weight;
            totalWeight += weight;
        }
    }
    fullResolutionAO = sum / max(totalWeight, 1e-4);
    fullResolutionAO.z = clamp(fullResolutionAO.z, 0.0, 1.0);
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
    readonly #block: UniformBuffer<typeof gtaoLayout.schema>;
    readonly #inverseProjection = new Matrix4();
    readonly #horizonPass: FullscreenRenderPass;
    readonly #initializePass = fullscreenPass(
        'GTAO initialize temporal history',
        TEMPORAL_INITIALIZE_FRAGMENT
    );
    readonly #resolvePass: FullscreenRenderPass;
    readonly #filterPasses = Object.freeze([
        fullscreenPass('GTAO edge-aware filter 1', spatialFilterFragment(1)),
        fullscreenPass('GTAO edge-aware filter 2', spatialFilterFragment(2))
    ]);
    readonly #upsamplePass = fullscreenPass(
        'GTAO bilateral full-resolution upsample',
        UPSAMPLE_FRAGMENT
    );
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
        this.#block = UniformBuffer.fromSchema(gtaoLayout, {
            u_gtaoInverseProjection: this.#inverseProjection.elements,
            u_gtaoProjection: [1, 1, 0, 0],
            u_gtaoSearch: [
                settings.radius,
                settings.falloffStart,
                settings.thickness,
                settings.power
            ],
            u_gtaoTemporal: [settings.historyWeight, settings.depthThreshold, 0, 0]
        });
        this.#horizonPass = fullscreenPass(
            'GTAO rotated horizon search',
            horizonFragment(settings),
            [this.#block]
        );
        this.#resolvePass = fullscreenPass(
            'GTAO production temporal resolve',
            TEMPORAL_RESOLVE_FRAGMENT,
            [this.#block]
        );
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
        this.#inverseProjection.invert(camera.jitteredProjectionMatrix);
        const projection = camera.jitteredProjectionMatrix.elements;
        const state = this.stageCamera(context, camera);
        this.#block
            .set('u_gtaoInverseProjection', this.#inverseProjection.elements)
            .set('u_gtaoProjection', [
                Math.abs(projection[5]),
                camera.isPerspectiveCamera ? 1 : 0,
                camera.depthMode === 'reversed' ? 1 : 0,
                0
            ])
            .set('u_gtaoTemporal', [
                this.#settings.historyWeight,
                this.#settings.depthThreshold,
                0,
                this.#submissionIndex % 8
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
            this.#horizonPass,
            [resources.sceneDepth, resources.materialAttributes],
            current
        );

        const historyAccepted = !discontinuous && (resources.historyValid ?? true) && history.valid;
        this.addFullscreen(
            context,
            historyAccepted ? this.#resolvePass : this.#initializePass,
            historyAccepted ? [current, history.history(), resources.motionDepth] : [current],
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
                [filtered, resources.materialAttributes, resources.motionDepth],
                destination
            );
            filtered = destination;
        }

        if (aoWidth === sceneWidth && aoHeight === sceneHeight) return filtered;
        const fullResolution = context.graph.createTexture(
            'GTAO full-resolution bent normal and visibility',
            this.#fullResolutionDescriptor
        );
        this.addFullscreen(
            context,
            this.#upsamplePass,
            [filtered, resources.materialAttributes, resources.motionDepth],
            fullResolution
        );
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
            format: 'rgba16float',
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
            clearValue: { r: 0, g: 0, b: 1, a: 0 }
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
