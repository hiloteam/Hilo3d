import type Camera from '../../camera/Camera';
import Color from '../../math/Color';
import Matrix4 from '../../math/Matrix4';
import Vector3 from '../../math/Vector3';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import ComputeKernel from '../compute/ComputeKernel';
import ComputeSampler from '../compute/ComputeSampler';
import ComputeShader from '../compute/ComputeShader';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import {
    ComputeRenderPass,
    FullscreenRenderPass,
    type ComputeRenderPassParameters,
    type FullscreenRenderPassParameters
} from '../pipeline/passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureAccessHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineHistoryTextureDescriptor,
    RenderPipelineTextureDescriptor
} from '../pipeline/ScriptableRenderGraph';

const INVALID_BUFFER = 0 as RenderGraphBufferHandle;
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const VOLUME_FRAME_BYTES = 144;
const LOCAL_VOLUME_RECORD_BYTES = 48;
const MAX_LOCAL_VOLUMES = 32;
const INJECTION_WORKGROUP_SIZE = 4;
const INTEGRATION_WORKGROUP_SIZE = 8;
const MAX_FROXEL_SLICES = 64;

/** Named performance/quality presets for froxel reconstruction and light visibility. */
export type VolumetricLightingQuality = 'low' | 'medium' | 'high' | 'ultra';
/** Optional integrated-volume diagnostic shown in place of the composited HDR scene. */
export type VolumetricLightingDebugView = 'none' | 'radiance' | 'transmittance';

/** One world-space spherical local fog-density volume. */
export interface VolumetricSphereFogVolume {
    /** Discriminant selecting spherical density evaluation. */
    readonly shape: 'sphere';
    /** Mutable world-space center sampled at frame-record time. */
    readonly center: Readonly<Vector3>;
    /** Outer sphere radius in world units. */
    readonly radius: number;
    /** Density added inside the volume. */
    readonly density: number;
    /** Single-scattering albedo tint. Defaults to the global fog albedo. */
    readonly albedo?: Readonly<Color>;
    /** Fraction of the radius used for a smooth edge. Defaults to 0.2. */
    readonly edgeFalloff?: number;
}

/** One axis-aligned world-space box local fog-density volume. */
export interface VolumetricBoxFogVolume {
    /** Discriminant selecting axis-aligned box density evaluation. */
    readonly shape: 'box';
    /** Mutable world-space center sampled at frame-record time. */
    readonly center: Readonly<Vector3>;
    /** Mutable positive half extent sampled at frame-record time. */
    readonly halfExtents: Readonly<Vector3>;
    /** Density added inside the volume. */
    readonly density: number;
    /** Single-scattering albedo tint. Defaults to the global fog albedo. */
    readonly albedo?: Readonly<Color>;
    /** Fraction of the smallest half extent used for a smooth edge. Defaults to 0.2. */
    readonly edgeFalloff?: number;
}

/** Local fog shapes injected into the camera-aligned froxel volume. */
export type VolumetricFogVolume = VolumetricSphereFogVolume | VolumetricBoxFogVolume;

/** Production controls for WebGPU Clustered Forward+ froxel volumetric lighting. */
export interface VolumetricLightingOptions {
    /** Preset used for unspecified reconstruction and shadow budgets. Defaults to high. */
    readonly quality?: VolumetricLightingQuality;
    /** Froxel XY and reconstruction resolution relative to the internal scene. Defaults to the preset. */
    readonly resolutionScale?: number;
    /** Depth-aware screen-space light visibility samples in [0, 8]. Defaults to the preset. */
    readonly shadowSteps?: number;
    /** Global extinction density in inverse world units. Defaults to 0.025. */
    readonly density?: number;
    /** World-space height at and below which global density is constant. Defaults to 0. */
    readonly baseHeight?: number;
    /** Exponential density falloff above baseHeight. Defaults to 0.12. */
    readonly heightFalloff?: number;
    /** Maximum integrated view distance in world units. Defaults to 120. */
    readonly maxDistance?: number;
    /** Global single-scattering albedo. Defaults to a cool neutral white. */
    readonly albedo?: Readonly<Color>;
    /** Henyey-Greenstein anisotropy in [-0.9, 0.9]. Positive values emphasize forward scatter. */
    readonly anisotropy?: number;
    /** Ambient light injected into the medium. Defaults to 0.12. */
    readonly ambientStrength?: number;
    /** Sub-froxel stochastic sample offset strength in [0, 1]. Defaults to 1. */
    readonly jitterStrength?: number;
    /** Maximum temporal history contribution in [0, 0.98]. Defaults to 0.9. */
    readonly historyWeight?: number;
    /** Maximum relative scene-depth disagreement accepted during reprojection. Defaults to 0.04. */
    readonly depthThreshold?: number;
    /** Optional world-space local fog volumes, limited to 32. */
    readonly localVolumes?: readonly VolumetricFogVolume[];
    /** Replace normal composition with an integrated radiance or extinction diagnostic. */
    readonly debugView?: VolumetricLightingDebugView;
}

/** @internal Immutable validated volumetric-lighting configuration. */
export interface VolumetricLightingSettings {
    readonly quality: VolumetricLightingQuality;
    readonly resolutionScale: number;
    readonly shadowSteps: number;
    readonly density: number;
    readonly baseHeight: number;
    readonly heightFalloff: number;
    readonly maxDistance: number;
    readonly albedo: Readonly<{ r: number; g: number; b: number }>;
    readonly anisotropy: number;
    readonly ambientStrength: number;
    readonly jitterStrength: number;
    readonly historyWeight: number;
    readonly depthThreshold: number;
    readonly localVolumes: readonly VolumetricFogVolume[];
    readonly debugView: VolumetricLightingDebugView;
}

function validateQuality(value: string): asserts value is VolumetricLightingQuality {
    if (!Object.prototype.hasOwnProperty.call(QUALITY_DEFAULTS, value)) {
        throw new TypeError(`Volumetric lighting quality has an unsupported value ${value}`);
    }
}

function validateDebugView(value: string): asserts value is VolumetricLightingDebugView {
    if (!['none', 'radiance', 'transmittance'].includes(value)) {
        throw new TypeError(`Volumetric lighting debugView has an unsupported value ${value}`);
    }
}

interface QualityDefaults {
    readonly resolutionScale: number;
    readonly shadowSteps: number;
}

const QUALITY_DEFAULTS: Readonly<Record<VolumetricLightingQuality, QualityDefaults>> =
    Object.freeze({
        low: Object.freeze({ resolutionScale: 0.25, shadowSteps: 1 }),
        medium: Object.freeze({ resolutionScale: 0.375, shadowSteps: 2 }),
        high: Object.freeze({ resolutionScale: 0.5, shadowSteps: 3 }),
        ultra: Object.freeze({ resolutionScale: 0.75, shadowSteps: 5 })
    });

function finiteRange(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be finite and between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

function positiveInteger(value: number, minimum: number, maximum: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new RangeError(
            `${label} must be an integer between ${String(minimum)} and ${String(maximum)}`
        );
    }
    return value;
}

function validateVector(value: unknown, label: string, positive = false): asserts value is Vector3 {
    if (!(value instanceof Vector3)) throw new TypeError(`${label} must be a Vector3`);
    for (const [axis, component] of [
        ['x', value.x],
        ['y', value.y],
        ['z', value.z]
    ] as const) {
        if (!Number.isFinite(component) || (positive && component <= 0)) {
            throw new RangeError(
                `${label}.${axis} must be ${positive ? 'positive and ' : ''}finite`
            );
        }
    }
}

function validateColor(value: unknown, label: string): asserts value is Color {
    if (!(value instanceof Color)) throw new TypeError(`${label} must be a Color`);
    for (const [channel, component] of [
        ['r', value.r],
        ['g', value.g],
        ['b', value.b]
    ] as const) {
        if (!Number.isFinite(component) || component < 0 || component > 1) {
            throw new RangeError(`${label}.${channel} must be finite and between 0 and 1`);
        }
    }
}

function validateLocalVolume(volume: unknown, index: number): VolumetricFogVolume {
    const label = `Volumetric lighting localVolumes[${String(index)}]`;
    if (typeof volume !== 'object' || volume === null || Array.isArray(volume)) {
        throw new TypeError(`${label} must be an object`);
    }
    const candidate = volume as Partial<VolumetricFogVolume>;
    validateVector(candidate.center, `${label}.center`);
    finiteRange(candidate.density ?? Number.NaN, 0, 100, `${label}.density`);
    finiteRange(candidate.edgeFalloff ?? 0.2, 0.001, 1, `${label}.edgeFalloff`);
    if (candidate.albedo !== undefined) validateColor(candidate.albedo, `${label}.albedo`);
    if (candidate.shape === 'sphere') {
        finiteRange(candidate.radius ?? Number.NaN, 0.001, 100_000, `${label}.radius`);
        return volume as VolumetricSphereFogVolume;
    }
    if (candidate.shape === 'box') {
        validateVector(candidate.halfExtents, `${label}.halfExtents`, true);
        return volume as VolumetricBoxFogVolume;
    }
    throw new TypeError(`${label}.shape must be sphere or box`);
}

/** @internal Validate and freeze the public froxel-volumetric configuration. */
export function snapshotVolumetricLightingOptions(
    options: Readonly<VolumetricLightingOptions>
): Readonly<VolumetricLightingSettings> {
    const quality: string = options.quality ?? 'high';
    validateQuality(quality);
    const defaults = QUALITY_DEFAULTS[quality];
    const albedo = options.albedo ?? new Color(0.92, 0.96, 1, 1);
    validateColor(albedo, 'Volumetric lighting albedo');
    const localVolumes = options.localVolumes ?? [];
    if (!Array.isArray(localVolumes)) {
        throw new TypeError('Volumetric lighting localVolumes must be an array');
    }
    if (localVolumes.length > MAX_LOCAL_VOLUMES) {
        throw new RangeError(
            `Volumetric lighting supports at most ${String(MAX_LOCAL_VOLUMES)} local volumes`
        );
    }
    const debugView: string = options.debugView ?? 'none';
    validateDebugView(debugView);
    return Object.freeze({
        quality,
        resolutionScale: finiteRange(
            options.resolutionScale ?? defaults.resolutionScale,
            0.125,
            1,
            'Volumetric lighting resolutionScale'
        ),
        shadowSteps: positiveInteger(
            options.shadowSteps ?? defaults.shadowSteps,
            0,
            8,
            'Volumetric lighting shadowSteps'
        ),
        density: finiteRange(options.density ?? 0.025, 0, 10, 'Volumetric lighting density'),
        baseHeight: finiteRange(
            options.baseHeight ?? 0,
            -100_000,
            100_000,
            'Volumetric lighting baseHeight'
        ),
        heightFalloff: finiteRange(
            options.heightFalloff ?? 0.12,
            0,
            100,
            'Volumetric lighting heightFalloff'
        ),
        maxDistance: finiteRange(
            options.maxDistance ?? 120,
            0.1,
            1_000_000,
            'Volumetric lighting maxDistance'
        ),
        albedo: Object.freeze({ r: albedo.r, g: albedo.g, b: albedo.b }),
        anisotropy: finiteRange(
            options.anisotropy ?? 0.35,
            -0.9,
            0.9,
            'Volumetric lighting anisotropy'
        ),
        ambientStrength: finiteRange(
            options.ambientStrength ?? 0.12,
            0,
            4,
            'Volumetric lighting ambientStrength'
        ),
        jitterStrength: finiteRange(
            options.jitterStrength ?? 1,
            0,
            1,
            'Volumetric lighting jitterStrength'
        ),
        historyWeight: finiteRange(
            options.historyWeight ?? 0.9,
            0,
            0.98,
            'Volumetric lighting historyWeight'
        ),
        depthThreshold: finiteRange(
            options.depthThreshold ?? 0.04,
            0,
            1,
            'Volumetric lighting depthThreshold'
        ),
        localVolumes: Object.freeze(localVolumes.map(validateLocalVolume)),
        debugView
    });
}

const FRAME_WGSL = `
struct FrameData {
    currentViewProjection: mat4x4<f32>,
    previousViewProjection: mat4x4<f32>,
    view: mat4x4<f32>,
    projection: mat4x4<f32>,
    previousView: mat4x4<f32>,
    previousProjection: mat4x4<f32>,
    viewport: vec4<f32>,
    depth: vec4<f32>,
    previousDepth: vec4<f32>,
    cluster: vec4<u32>,
    counts: vec4<u32>,
    budgets: vec4<u32>,
    directional: vec4<u32>,
    ambient: vec4<f32>,
};
struct VolumetricFrameData {
    inverseView: mat4x4<f32>,
    fog: vec4<f32>,
    scattering: vec4<f32>,
    temporal: vec4<f32>,
    quality: vec4<f32>,
    grid: vec4<u32>,
};
struct LightRecord {
    positionRange: vec4<f32>,
    colorType: vec4<f32>,
    directionOuter: vec4<f32>,
    attenuationInner: vec4<f32>,
};
struct LocalFogVolume {
    centerShape: vec4<f32>,
    extentDensity: vec4<f32>,
    albedoFalloff: vec4<f32>,
};`;

function computePass(shader: ComputeShader): ComputeRenderPass {
    return new ComputeRenderPass(new ComputeKernel({ label: shader.label, shader }), shader.label);
}

function injectionPass(
    settings: Readonly<VolumetricLightingSettings>,
    withCloudShadow: boolean
): ComputeRenderPass {
    const shadowSteps = settings.shadowSteps;
    const screenSpaceVisibility =
        shadowSteps === 0
            ? `fn screenSpaceVisibility(origin: vec3<f32>, lightVector: vec3<f32>) -> f32 {
    return 1.0;
}`
            : `fn screenSpaceVisibility(origin: vec3<f32>, lightVector: vec3<f32>) -> f32 {
    var visibility = 1.0;
    for (var sampleIndex = 1u; sampleIndex <= ${String(shadowSteps)}u; sampleIndex += 1u) {
        let t = f32(sampleIndex) / f32(${String(shadowSteps + 1)});
        let samplePosition = origin + lightVector * t;
        let clip = frameData.projection * vec4<f32>(samplePosition, 1.0);
        if (clip.w <= 0.0001) { continue; }
        let ndc = clip.xyz / clip.w;
        let uv = ndc.xy * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
        if (any(uv <= vec2<f32>(0.001)) || any(uv >= vec2<f32>(0.999))) { continue; }
        let dimensions = textureDimensions(sceneDepth);
        let pixel = clamp(
            vec2<i32>(uv * vec2<f32>(dimensions)),
            vec2<i32>(0),
            vec2<i32>(dimensions) - vec2<i32>(1)
        );
        let rawDepth = textureLoad(sceneDepth, pixel, 0);
        if (depthIsEmpty(rawDepth)) { continue; }
        let occluderDepth = distanceFromDepth(rawDepth);
        let sampleDepth = -samplePosition.z;
        let bias = max(0.03, sampleDepth * 0.003);
        if (sampleDepth > occluderDepth + bias) {
            visibility *= 0.12;
            break;
        }
    }
    return visibility;
}`;
    return computePass(
        new ComputeShader({
            label: 'Froxel volumetric light and density injection',
            source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> volumetricFrame: VolumetricFrameData;
@group(0) @binding(2) var<storage, read> lights: array<LightRecord>;
@group(0) @binding(3) var<storage, read> clusterGrid: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read> clusterIndices: array<u32>;
@group(0) @binding(5) var<storage, read> localVolumes: array<LocalFogVolume>;
@group(0) @binding(6) var sceneDepth: texture_depth_2d;
@group(0) @binding(7) var froxelOutput: texture_storage_2d<rgba16float, write>;
${withCloudShadow ? '@group(0) @binding(8) var cloudShadowTexture: texture_2d<f32>;' : ''}

const HILO_PI: f32 = 3.141592653589793;

fn depthIsEmpty(rawDepth: f32) -> bool {
    return select(rawDepth >= 0.999999, rawDepth <= 0.000001, frameData.depth.w > 0.5);
}
fn distanceFromDepth(rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, frameData.depth.w > 0.5);
    return frameData.depth.x * frameData.depth.y /
        max(frameData.depth.y - standard * (frameData.depth.y - frameData.depth.x), 0.0001);
}
fn sliceDistance(slice: u32) -> f32 {
    let normalized = (f32(slice) + 0.5) / f32(volumetricFrame.grid.z);
    return frameData.depth.x * exp(frameData.depth.z * normalized);
}
fn reconstructViewPosition(uv: vec2<f32>, viewDepth: f32) -> vec3<f32> {
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let viewZ = -viewDepth;
    let viewX = -(ndc.x + frameData.projection[2][0]) * viewZ / frameData.projection[0][0];
    let viewY = -(ndc.y + frameData.projection[2][1]) * viewZ / frameData.projection[1][1];
    return vec3<f32>(viewX, viewY, viewZ);
}
fn phaseHenyeyGreenstein(cosine: f32) -> f32 {
    let g = volumetricFrame.scattering.w;
    let g2 = g * g;
    return (1.0 - g2) /
        max(4.0 * HILO_PI * pow(max(1.0 + g2 - 2.0 * g * cosine, 0.0001), 1.5), 0.0001);
}
fn cloudShadowVisibility(viewPosition: vec3<f32>) -> f32 {
    ${
        withCloudShadow
            ? `let clip = frameData.projection * vec4<f32>(viewPosition, 1.0);
    if (clip.w <= 0.0001) { return 1.0; }
    let uv = clip.xy / clip.w * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    let dimensions = textureDimensions(cloudShadowTexture);
    let pixel = clamp(
        vec2<i32>(uv * vec2<f32>(dimensions)),
        vec2<i32>(0),
        vec2<i32>(dimensions) - vec2<i32>(1)
    );
    return clamp(textureLoad(cloudShadowTexture, pixel, 0).r, 0.12, 1.0);`
            : 'return 1.0;'
    }
}
${screenSpaceVisibility}
fn evaluateLight(light: LightRecord, viewPosition: vec3<f32>, viewDirection: vec3<f32>) -> vec3<f32> {
    let lightType = u32(light.colorType.w + 0.5);
    var lightDirection: vec3<f32>;
    var radiance = light.colorType.rgb;
    var shadowVector: vec3<f32>;
    if (lightType == 2u) {
        lightDirection = normalize(-light.directionOuter.xyz);
        shadowVector = lightDirection * min(volumetricFrame.fog.w, 40.0);
        radiance *= cloudShadowVisibility(viewPosition);
    } else {
        let delta = light.positionRange.xyz - viewPosition;
        let distanceToLight = max(length(delta), 0.0001);
        lightDirection = delta / distanceToLight;
        shadowVector = delta;
        let attenuation = 1.0 / max(
            light.attenuationInner.x + light.attenuationInner.y * distanceToLight +
                light.attenuationInner.z * distanceToLight * distanceToLight,
            0.0001
        );
        let rangeFade = clamp(
            1.0 - pow(distanceToLight / max(light.positionRange.w, 0.0001), 4.0),
            0.0,
            1.0
        );
        radiance *= attenuation * rangeFade * rangeFade;
        if (lightType == 1u) {
            let theta = dot(lightDirection, normalize(-light.directionOuter.xyz));
            radiance *= smoothstep(light.directionOuter.w, light.attenuationInner.w, theta);
        }
    }
    if (max(max(radiance.r, radiance.g), radiance.b) <= 0.00001) { return vec3<f32>(0.0); }
    let visibility = screenSpaceVisibility(viewPosition, shadowVector);
    // lightDirection points from the medium toward the light, while the physical incident ray
    // travels in the opposite direction. Positive anisotropy therefore emphasizes forward
    // scattering when the incident ray continues toward the camera.
    return radiance * phaseHenyeyGreenstein(dot(-lightDirection, viewDirection)) * visibility;
}
fn volumeMask(volume: LocalFogVolume, worldPosition: vec3<f32>) -> f32 {
    let edge = clamp(volume.albedoFalloff.w, 0.001, 1.0);
    if (volume.centerShape.w < 0.5) {
        let radius = max(volume.extentDensity.x, 0.0001);
        let distanceToCenter = length(worldPosition - volume.centerShape.xyz);
        return 1.0 - smoothstep(radius * (1.0 - edge), radius, distanceToCenter);
    }
    let extent = max(volume.extentDensity.xyz, vec3<f32>(0.0001));
    let normalized = abs(worldPosition - volume.centerShape.xyz) / extent;
    let edgeDistance = max(max(normalized.x, normalized.y), normalized.z);
    return 1.0 - smoothstep(1.0 - edge, 1.0, edgeDistance);
}
@compute @workgroup_size(${String(INJECTION_WORKGROUP_SIZE)}, ${String(INJECTION_WORKGROUP_SIZE)}, 1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= volumetricFrame.grid.x || id.y >= volumetricFrame.grid.y || id.z >= volumetricFrame.grid.z) {
        return;
    }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) /
        vec2<f32>(volumetricFrame.grid.xy);
    let viewPosition = reconstructViewPosition(uv, sliceDistance(id.z));
    if (-viewPosition.z > volumetricFrame.fog.w) {
        let atlasColumns = bitcast<u32>(volumetricFrame.quality.y);
        let sliceTile = vec2<u32>(id.z % atlasColumns, id.z / atlasColumns);
        textureStore(
            froxelOutput,
            vec2<i32>(id.xy + sliceTile * volumetricFrame.grid.xy),
            vec4<f32>(0.0)
        );
        return;
    }
    let worldPosition = (volumetricFrame.inverseView * vec4<f32>(viewPosition, 1.0)).xyz;
    let viewDirection = normalize(-viewPosition);
    let globalDensity = volumetricFrame.fog.x * exp(
        -volumetricFrame.fog.y * max(worldPosition.y - volumetricFrame.fog.z, 0.0)
    );
    var density = globalDensity;
    var albedoSum = volumetricFrame.scattering.rgb * globalDensity;
    let localVolumeCount = bitcast<u32>(volumetricFrame.temporal.w);
    for (var volumeIndex = 0u; volumeIndex < localVolumeCount; volumeIndex += 1u) {
        let volume = localVolumes[volumeIndex];
        let localDensity = volume.extentDensity.w * volumeMask(volume, worldPosition);
        density += localDensity;
        albedoSum += volume.albedoFalloff.rgb * localDensity;
    }
    if (density <= 0.000001) {
        let atlasColumns = bitcast<u32>(volumetricFrame.quality.y);
        let sliceTile = vec2<u32>(id.z % atlasColumns, id.z / atlasColumns);
        textureStore(
            froxelOutput,
            vec2<i32>(id.xy + sliceTile * volumetricFrame.grid.xy),
            vec4<f32>(0.0)
        );
        return;
    }
    let albedo = clamp(albedoSum / density, vec3<f32>(0.0), vec3<f32>(1.0));
    var lighting = frameData.ambient.rgb * volumetricFrame.quality.z;
    for (var directionalIndex = 0u; directionalIndex < frameData.directional.x; directionalIndex += 1u) {
        lighting += evaluateLight(lights[directionalIndex], viewPosition, viewDirection);
    }
    let tileCount = frameData.cluster.x * frameData.cluster.y;
    let clusterTile = min(
        vec2<u32>(uv * vec2<f32>(frameData.cluster.xy)),
        frameData.cluster.xy - vec2<u32>(1u)
    );
    let clusterIndex = id.z * tileCount + clusterTile.y * frameData.cluster.x + clusterTile.x;
    let allocation = clusterGrid[clusterIndex];
    for (var localIndex = 0u; localIndex < allocation.y; localIndex += 1u) {
        let lightIndex = clusterIndices[allocation.x + localIndex];
        if (lightIndex != 0xffffffffu) {
            lighting += evaluateLight(lights[lightIndex], viewPosition, viewDirection);
        }
    }
    let source = min(lighting * albedo * density, vec3<f32>(65000.0));
    let atlasColumns = bitcast<u32>(volumetricFrame.quality.y);
    let sliceTile = vec2<u32>(id.z % atlasColumns, id.z / atlasColumns);
    textureStore(
        froxelOutput,
        vec2<i32>(id.xy + sliceTile * volumetricFrame.grid.xy),
        vec4<f32>(source, min(density, 65000.0))
    );
}`,
            workgroupSize: [INJECTION_WORKGROUP_SIZE, INJECTION_WORKGROUP_SIZE, 1],
            bindings: [
                { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
                {
                    name: 'volumetricFrame',
                    group: 0,
                    binding: 1,
                    kind: 'read-only-storage-buffer'
                },
                { name: 'lights', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
                { name: 'clusterGrid', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
                {
                    name: 'clusterIndices',
                    group: 0,
                    binding: 4,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'localVolumes',
                    group: 0,
                    binding: 5,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'sceneDepth',
                    group: 0,
                    binding: 6,
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                },
                {
                    name: 'froxelOutput',
                    group: 0,
                    binding: 7,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                },
                ...(withCloudShadow
                    ? ([
                          {
                              name: 'cloudShadowTexture',
                              group: 0,
                              binding: 8,
                              kind: 'sampled-texture' as const,
                              sampleType: 'float' as const
                          }
                      ] as const)
                    : [])
            ]
        })
    );
}

const FROXEL_LINE_INTEGRATION_PASS = computePass(
    new ComputeShader({
        label: 'Froxel cumulative line integration',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> volumetricFrame: VolumetricFrameData;
@group(0) @binding(2) var froxelAtlas: texture_2d<f32>;
@group(0) @binding(3) var integratedFroxelOutput: texture_storage_2d<rgba16float, write>;

fn atlasPixel(tile: vec2<u32>, slice: u32) -> vec2<i32> {
    let atlasColumns = bitcast<u32>(volumetricFrame.quality.y);
    let sliceTile = vec2<u32>(slice % atlasColumns, slice / atlasColumns);
    return vec2<i32>(tile + sliceTile * volumetricFrame.grid.xy);
}
fn sliceBoundary(boundary: u32) -> f32 {
    let normalized = f32(boundary) / f32(volumetricFrame.grid.z);
    return frameData.depth.x * exp(frameData.depth.z * normalized);
}
@compute @workgroup_size(${String(INTEGRATION_WORKGROUP_SIZE)}, ${String(INTEGRATION_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (any(id.xy >= volumetricFrame.grid.xy)) { return; }
    var scattering = vec3<f32>(0.0);
    var transmittance = 1.0;
    var previousDistance = frameData.depth.x;
    for (var slice = 0u; slice < ${String(MAX_FROXEL_SLICES)}u; slice += 1u) {
        if (slice >= volumetricFrame.grid.z) { break; }
        let nextDistance = min(sliceBoundary(slice + 1u), volumetricFrame.fog.w);
        let segmentLength = max(nextDistance - previousDistance, 0.0);
        if (segmentLength > 0.0 && transmittance >= 0.002) {
            let froxel = textureLoad(froxelAtlas, atlasPixel(id.xy, slice), 0);
            let extinction = max(froxel.a, 0.0);
            let segmentTransmittance = exp(-extinction * segmentLength);
            let integratedSource = select(
                froxel.rgb * segmentLength,
                froxel.rgb * (1.0 - segmentTransmittance) / max(extinction, 0.00001),
                extinction > 0.00001
            );
            scattering += transmittance * integratedSource;
            transmittance *= segmentTransmittance;
        }
        textureStore(
            integratedFroxelOutput,
            atlasPixel(id.xy, slice),
            vec4<f32>(min(scattering, vec3<f32>(65000.0)), clamp(transmittance, 0.0, 1.0))
        );
        previousDistance = nextDistance;
    }
}`,
        workgroupSize: [INTEGRATION_WORKGROUP_SIZE, INTEGRATION_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'volumetricFrame',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'froxelAtlas',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'integratedFroxelOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const INTEGRATION_PASS = computePass(
    new ComputeShader({
        label: 'Froxel constant-time view reconstruction',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> volumetricFrame: VolumetricFrameData;
@group(0) @binding(2) var sceneDepth: texture_depth_2d;
@group(0) @binding(3) var integratedFroxelAtlas: texture_2d<f32>;
@group(0) @binding(4) var integrationOutput: texture_storage_2d<rgba16float, write>;

fn depthIsEmpty(rawDepth: f32) -> bool {
    return select(rawDepth >= 0.999999, rawDepth <= 0.000001, frameData.depth.w > 0.5);
}
fn distanceFromDepth(rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, frameData.depth.w > 0.5);
    return frameData.depth.x * frameData.depth.y /
        max(frameData.depth.y - standard * (frameData.depth.y - frameData.depth.x), 0.0001);
}
fn hash12(value: vec2<f32>) -> f32 {
    let p3 = fract(vec3<f32>(value.xyx) * 0.1031);
    let mixed = p3 + dot(p3, p3.yzx + vec3<f32>(33.33));
    return fract((mixed.x + mixed.y) * mixed.z);
}
fn loadIntegratedFroxel(tile: vec2<u32>, slice: u32) -> vec4<f32> {
    let clampedTile = min(tile, volumetricFrame.grid.xy - vec2<u32>(1u));
    let atlasColumns = bitcast<u32>(volumetricFrame.quality.y);
    let sliceTile = vec2<u32>(slice % atlasColumns, slice / atlasColumns);
    return textureLoad(
        integratedFroxelAtlas,
        vec2<i32>(clampedTile + sliceTile * volumetricFrame.grid.xy),
        0
    );
}
fn sampleIntegratedFroxel(uv: vec2<f32>, slice: u32) -> vec4<f32> {
    let gridPosition = uv * vec2<f32>(volumetricFrame.grid.xy) - vec2<f32>(0.5);
    let base = vec2<i32>(floor(gridPosition));
    let fraction = fract(gridPosition);
    let maximum = vec2<i32>(volumetricFrame.grid.xy) - vec2<i32>(1);
    let p00 = vec2<u32>(clamp(base, vec2<i32>(0), maximum));
    let p10 = vec2<u32>(clamp(base + vec2<i32>(1, 0), vec2<i32>(0), maximum));
    let p01 = vec2<u32>(clamp(base + vec2<i32>(0, 1), vec2<i32>(0), maximum));
    let p11 = vec2<u32>(clamp(base + vec2<i32>(1, 1), vec2<i32>(0), maximum));
    return mix(
        mix(
            loadIntegratedFroxel(p00, slice),
            loadIntegratedFroxel(p10, slice),
            fraction.x
        ),
        mix(
            loadIntegratedFroxel(p01, slice),
            loadIntegratedFroxel(p11, slice),
            fraction.x
        ),
        fraction.y
    );
}
@compute @workgroup_size(${String(INTEGRATION_WORKGROUP_SIZE)}, ${String(INTEGRATION_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(integrationOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let depthSize = textureDimensions(sceneDepth);
    let depthPixel = clamp(
        vec2<i32>(uv * vec2<f32>(depthSize)),
        vec2<i32>(0),
        vec2<i32>(depthSize) - vec2<i32>(1)
    );
    let rawDepth = textureLoad(sceneDepth, depthPixel, 0);
    let surfaceDistance = select(
        distanceFromDepth(rawDepth),
        frameData.depth.y,
        depthIsEmpty(rawDepth)
    );
    let rayEnd = min(min(surfaceDistance, frameData.depth.y), volumetricFrame.fog.w);
    if (rayEnd <= frameData.depth.x) {
        textureStore(integrationOutput, vec2<i32>(id.xy), vec4<f32>(0.0, 0.0, 0.0, 1.0));
        return;
    }
    let frameIndex = bitcast<u32>(volumetricFrame.temporal.z);
    let unjitteredSlicePosition = clamp(
        log(rayEnd / frameData.depth.x) / frameData.depth.z * f32(volumetricFrame.grid.z),
        0.0,
        f32(volumetricFrame.grid.z)
    );
    let jitter =
        (hash12(vec2<f32>(id.xy) + vec2<f32>(f32(frameIndex) * 0.754877666)) - 0.5) *
        volumetricFrame.quality.w;
    let slicePosition = clamp(
        unjitteredSlicePosition + jitter,
        0.0,
        f32(volumetricFrame.grid.z)
    );
    let completeSlices = min(u32(floor(slicePosition)), volumetricFrame.grid.z);
    var lower = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    if (completeSlices > 0u) {
        lower = sampleIntegratedFroxel(uv, completeSlices - 1u);
    }
    let upper = sampleIntegratedFroxel(
        uv,
        min(completeSlices, volumetricFrame.grid.z - 1u)
    );
    let integrated = mix(lower, upper, fract(slicePosition));
    textureStore(
        integrationOutput,
        vec2<i32>(id.xy),
        vec4<f32>(
            min(integrated.rgb, vec3<f32>(65000.0)),
            clamp(integrated.a, 0.0, 1.0)
        )
    );
}`,
        workgroupSize: [INTEGRATION_WORKGROUP_SIZE, INTEGRATION_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'volumetricFrame',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'sceneDepth',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'integratedFroxelAtlas',
                group: 0,
                binding: 3,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'integrationOutput',
                group: 0,
                binding: 4,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const TEMPORAL_SAMPLER = new ComputeSampler({
    label: 'Volumetric lighting temporal linear clamp',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
});

const TEMPORAL_INITIALIZE_PASS = computePass(
    new ComputeShader({
        label: 'Volumetric lighting initialize temporal history',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var currentVolume: texture_2d<f32>;
@group(0) @binding(2) var sceneDepth: texture_depth_2d;
@group(0) @binding(3) var colorOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var depthOutput: texture_storage_2d<r32float, write>;
fn depthIsEmpty(rawDepth: f32) -> bool {
    return select(rawDepth >= 0.999999, rawDepth <= 0.000001, frameData.depth.w > 0.5);
}
@compute @workgroup_size(${String(INTEGRATION_WORKGROUP_SIZE)}, ${String(INTEGRATION_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(colorOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let currentSize = textureDimensions(currentVolume);
    let currentPixel = clamp(vec2<i32>(uv * vec2<f32>(currentSize)), vec2<i32>(0), vec2<i32>(currentSize) - vec2<i32>(1));
    let depthSize = textureDimensions(sceneDepth);
    let depthPixel = clamp(vec2<i32>(uv * vec2<f32>(depthSize)), vec2<i32>(0), vec2<i32>(depthSize) - vec2<i32>(1));
    let rawDepth = textureLoad(sceneDepth, depthPixel, 0);
    textureStore(colorOutput, vec2<i32>(id.xy), textureLoad(currentVolume, currentPixel, 0));
    textureStore(depthOutput, vec2<i32>(id.xy), vec4<f32>(select(rawDepth, -1.0, depthIsEmpty(rawDepth))));
}`,
        workgroupSize: [INTEGRATION_WORKGROUP_SIZE, INTEGRATION_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'currentVolume',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'sceneDepth',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'colorOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'depthOutput',
                group: 0,
                binding: 4,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            }
        ]
    })
);

const TEMPORAL_RESOLVE_PASS = computePass(
    new ComputeShader({
        label: 'Volumetric lighting depth-aware temporal resolve',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> volumetricFrame: VolumetricFrameData;
@group(0) @binding(2) var currentVolume: texture_2d<f32>;
@group(0) @binding(3) var sceneDepth: texture_depth_2d;
@group(0) @binding(4) var historyVolume: texture_2d<f32>;
@group(0) @binding(5) var historyDepth: texture_2d<f32>;
@group(0) @binding(6) var linearSampler: sampler;
@group(0) @binding(7) var colorOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var depthOutput: texture_storage_2d<r32float, write>;

fn depthIsEmpty(rawDepth: f32) -> bool {
    return select(rawDepth >= 0.999999, rawDepth <= 0.000001, frameData.depth.w > 0.5);
}
fn distanceFromDepth(rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, frameData.depth.w > 0.5);
    return frameData.depth.x * frameData.depth.y /
        max(frameData.depth.y - standard * (frameData.depth.y - frameData.depth.x), 0.0001);
}
fn reconstructViewPosition(uv: vec2<f32>, viewDepth: f32) -> vec3<f32> {
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let viewZ = -viewDepth;
    let viewX = -(ndc.x + frameData.projection[2][0]) * viewZ / frameData.projection[0][0];
    let viewY = -(ndc.y + frameData.projection[2][1]) * viewZ / frameData.projection[1][1];
    return vec3<f32>(viewX, viewY, viewZ);
}
fn pixelFor(source: texture_2d<f32>, uv: vec2<f32>) -> vec2<i32> {
    let size = textureDimensions(source);
    return clamp(vec2<i32>(uv * vec2<f32>(size)), vec2<i32>(0), vec2<i32>(size) - vec2<i32>(1));
}
fn luminance(value: vec3<f32>) -> f32 { return dot(value, vec3<f32>(0.2126, 0.7152, 0.0722)); }
@compute @workgroup_size(${String(INTEGRATION_WORKGROUP_SIZE)}, ${String(INTEGRATION_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(colorOutput);
    if (any(id.xy >= outputSize)) { return; }
    let pixel = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let current = textureLoad(currentVolume, pixelFor(currentVolume, uv), 0);
    let depthSize = textureDimensions(sceneDepth);
    let depthPixel = clamp(vec2<i32>(uv * vec2<f32>(depthSize)), vec2<i32>(0), vec2<i32>(depthSize) - vec2<i32>(1));
    let rawDepth = textureLoad(sceneDepth, depthPixel, 0);
    let empty = depthIsEmpty(rawDepth);
    let surfaceDistance = select(distanceFromDepth(rawDepth), frameData.depth.y, empty);
    let representativeDepth = max(frameData.depth.x, min(surfaceDistance, volumetricFrame.fog.w) * 0.5);
    let viewPosition = reconstructViewPosition(uv, representativeDepth);
    let worldPosition = volumetricFrame.inverseView * vec4<f32>(viewPosition, 1.0);
    let previousClip = frameData.previousViewProjection * worldPosition;
    let previousNdc = previousClip.xy / max(previousClip.w, 0.0001);
    let previousUv = previousNdc * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
    let currentDepthValue = select(rawDepth, -1.0, empty);
    var minimumValue = current;
    var maximumValue = current;
    let currentSize = vec2<i32>(textureDimensions(currentVolume));
    let currentPixel = pixelFor(currentVolume, uv);
    for (var y = -1; y <= 1; y += 1) {
        for (var x = -1; x <= 1; x += 1) {
            let neighbor = textureLoad(
                currentVolume,
                clamp(currentPixel + vec2<i32>(x, y), vec2<i32>(0), currentSize - vec2<i32>(1)),
                0
            );
            minimumValue = min(minimumValue, neighbor);
            maximumValue = max(maximumValue, neighbor);
        }
    }
    var weight = 0.0;
    var history = current;
    if (
        previousClip.w > 0.0001 && all(previousUv > vec2<f32>(0.001)) &&
        all(previousUv < vec2<f32>(0.999))
    ) {
        history = clamp(
            textureSampleLevel(historyVolume, linearSampler, previousUv, 0.0),
            minimumValue,
            maximumValue
        );
        let previousDepthValue = textureLoad(historyDepth, pixelFor(historyDepth, previousUv), 0).r;
        let sameBackground = currentDepthValue < 0.0 && previousDepthValue < 0.0;
        let depthError = abs(currentDepthValue - previousDepthValue) /
            max(max(abs(currentDepthValue), abs(previousDepthValue)), 0.0001);
        let depthValid = sameBackground ||
            (currentDepthValue >= 0.0 && previousDepthValue >= 0.0 &&
                depthError <= volumetricFrame.temporal.y);
        let radianceDelta = abs(luminance(current.rgb) - luminance(history.rgb)) /
            max(max(luminance(current.rgb), luminance(history.rgb)), 0.05);
        let transmittanceDelta = abs(current.a - history.a);
        let reactive = clamp(max(radianceDelta, transmittanceDelta * 2.0), 0.0, 1.0);
        weight = select(0.0, volumetricFrame.temporal.x * (1.0 - reactive * 0.8), depthValid);
    }
    let resolved = mix(current, history, weight);
    textureStore(colorOutput, pixel, resolved);
    textureStore(depthOutput, pixel, vec4<f32>(currentDepthValue));
}`,
        workgroupSize: [INTEGRATION_WORKGROUP_SIZE, INTEGRATION_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'volumetricFrame',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'currentVolume',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'sceneDepth',
                group: 0,
                binding: 3,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'historyVolume',
                group: 0,
                binding: 4,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'historyDepth',
                group: 0,
                binding: 5,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            { name: 'linearSampler', group: 0, binding: 6, kind: 'sampler' },
            {
                name: 'colorOutput',
                group: 0,
                binding: 7,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'depthOutput',
                group: 0,
                binding: 8,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            }
        ]
    })
);

function compositePass(debugView: VolumetricLightingDebugView): FullscreenRenderPass {
    const output =
        debugView === 'radiance'
            ? 'color = vec4(volume.rgb, 1.0);'
            : debugView === 'transmittance'
              ? 'color = vec4(vec3(1.0 - clamp(volume.a, 0.0, 1.0)), 1.0);'
              : 'color = vec4(scene.rgb * clamp(volume.a, 0.0, 1.0) + volume.rgb, scene.a);';
    return new FullscreenRenderPass({
        name: 'Volumetric lighting linear HDR composite',
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_volume;
layout(location=0) out vec4 color;
void main() {
    vec4 scene = texture(u_scene, v_uv);
    vec4 volume = texture(u_volume, v_uv);
    ${output}
}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}

interface MutableBufferBinding {
    buffer: RenderGraphBufferHandle;
}

interface MutableTextureBinding {
    texture: RenderGraphTextureAccessHandle;
}

class MutableComputeParameters implements ComputeRenderPassParameters {
    readonly buffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[];
    readonly samplers: ComputeSampler[];
    readonly dispatch: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 };

    constructor(bufferCount: number, textureCount: number, samplerCount: number) {
        this.buffers = Array.from({ length: bufferCount }, () => ({ buffer: INVALID_BUFFER }));
        this.textures = Array.from({ length: textureCount }, () => ({ texture: INVALID_TEXTURE }));
        this.samplers = Array.from({ length: samplerCount }, () => TEMPORAL_SAMPLER);
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined)
            throw new RangeError('Volumetric compute buffer slot is unavailable');
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined)
            throw new RangeError('Volumetric compute texture slot is unavailable');
        binding.texture = texture;
    }

    setDispatch(x: number, y: number, z = 1): void {
        this.dispatch.x = x;
        this.dispatch.y = y;
        this.dispatch.z = z;
    }
}

class MutableFullscreenParameters implements FullscreenRenderPassParameters {
    readonly inputTextures: RenderGraphTextureAccessHandle[] = [];
    readonly colorAttachments: RenderPipelineColorAttachment[] = [
        { texture: INVALID_TEXTURE, loadOp: 'clear', storeOp: 'store' }
    ];

    reset(): void {
        this.inputTextures.length = 0;
    }
}

/** @internal Cluster resources consumed by the froxel volumetric controller. */
export interface VolumetricLightingResources {
    readonly frameBuffer: RenderGraphBufferHandle;
    readonly lights: RenderGraphBufferHandle;
    readonly clusterGrid: RenderGraphBufferHandle;
    readonly clusterIndices: RenderGraphBufferHandle;
    readonly sceneColor: RenderGraphTextureHandle;
    readonly sceneDepth: RenderGraphTextureHandle;
    /** Optional screen-space cloud visibility coupled into directional-light scattering. */
    readonly cloudShadow?: RenderGraphTextureHandle | null;
    readonly tilesX: number;
    readonly tilesY: number;
    readonly zSlices: number;
    readonly sceneScale: number;
    readonly historyValid: boolean;
}

/** @internal Renderer-local froxel injection, integration, temporal resolve, and HDR composition. */
export class VolumetricLightingController {
    readonly #settings: Readonly<VolumetricLightingSettings>;
    readonly #frameBuffer: StorageBuffer;
    readonly #localVolumeBuffer: StorageBuffer;
    readonly #frameBytes = new ArrayBuffer(VOLUME_FRAME_BYTES);
    readonly #frameFloats = new Float32Array(this.#frameBytes);
    readonly #frameUInts = new Uint32Array(this.#frameBytes);
    readonly #frameByteView = new Uint8Array(this.#frameBytes);
    readonly #volumeFloats: Float32Array;
    readonly #volumeByteView: Uint8Array;
    readonly #inverseView = new Matrix4();
    readonly #injectionPass: ComputeRenderPass;
    readonly #withCloudShadow: boolean;
    readonly #compositePass: FullscreenRenderPass;
    readonly #colorHistoryKey = Object.freeze({});
    readonly #depthHistoryKey = Object.freeze({});
    readonly #froxelExtent = { width: 1, height: 1 };
    readonly #froxelDescriptor: RenderPipelineTextureDescriptor;
    readonly #integratedFroxelDescriptor: RenderPipelineTextureDescriptor;
    readonly #integrationDescriptor: RenderPipelineTextureDescriptor;
    readonly #colorHistoryDescriptor: RenderPipelineHistoryTextureDescriptor;
    readonly #depthHistoryDescriptor: RenderPipelineHistoryTextureDescriptor;
    readonly #compositeDescriptor: RenderPipelineTextureDescriptor;
    readonly #injectionPool: RenderPassParameterPool<MutableComputeParameters>;
    readonly #lineIntegrationPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 2, 0)
    );
    readonly #integrationPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 3, 0)
    );
    readonly #initializePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(1, 4, 0)
    );
    readonly #resolvePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 6, 1)
    );
    readonly #compositePool = new RenderPassParameterPool(
        () => new MutableFullscreenParameters(),
        parameters => {
            parameters.reset();
        }
    );
    #destroyed = false;
    #pendingFrame = -1;
    #pendingHistoryUsed = false;
    #pendingFroxelCount = 0;
    #historyUsed = false;
    #froxelCount = 0;

    constructor(
        settings: Readonly<VolumetricLightingSettings>,
        context: RenderPipelineCreateContext,
        sceneScale: number,
        withCloudShadow = false
    ) {
        this.#settings = settings;
        this.#withCloudShadow = withCloudShadow;
        this.#injectionPass = injectionPass(settings, withCloudShadow);
        this.#injectionPool = new RenderPassParameterPool(
            () => new MutableComputeParameters(6, withCloudShadow ? 3 : 2, 0)
        );
        this.#compositePass = compositePass(settings.debugView);
        this.#frameBuffer = context.createStorageBuffer({
            label: 'Volumetric lighting frame parameters',
            byteLength: VOLUME_FRAME_BYTES,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        this.#volumeFloats = new Float32Array(
            (Math.max(1, settings.localVolumes.length) * LOCAL_VOLUME_RECORD_BYTES) / 4
        );
        this.#volumeByteView = new Uint8Array(
            this.#volumeFloats.buffer,
            this.#volumeFloats.byteOffset,
            this.#volumeFloats.byteLength
        );
        this.#localVolumeBuffer = context.createStorageBuffer({
            label: 'Volumetric lighting local fog volumes',
            byteLength: this.#volumeFloats.byteLength,
            usage: ['storage', 'copy-destination'],
            recovery: 'cpu-shadow'
        });
        this.#froxelDescriptor = {
            format: 'rgba16float',
            extent: this.#froxelExtent
        };
        this.#integratedFroxelDescriptor = {
            format: 'rgba16float',
            extent: this.#froxelExtent
        };
        const integrationExtent = Object.freeze({
            relativeTo: 'output' as const,
            scale: sceneScale * settings.resolutionScale,
            minWidth: 1,
            minHeight: 1
        });
        this.#integrationDescriptor = Object.freeze({
            format: 'rgba16float' as const,
            extent: integrationExtent
        });
        this.#colorHistoryDescriptor = Object.freeze({
            label: 'Volumetric lighting integrated radiance history',
            format: 'rgba16float' as const,
            extent: integrationExtent,
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2 as const
        });
        this.#depthHistoryDescriptor = Object.freeze({
            label: 'Volumetric lighting scene-depth history',
            format: 'r32float' as const,
            extent: integrationExtent,
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2 as const
        });
        this.#compositeDescriptor = Object.freeze({
            format: 'rgba16float' as const,
            extent: Object.freeze({ relativeTo: 'output' as const, scale: sceneScale })
        });
    }

    get historyUsed(): boolean {
        return this.#historyUsed;
    }

    get froxelCount(): number {
        return this.#froxelCount;
    }

    record(
        context: RenderPipelineContext,
        resources: Readonly<VolumetricLightingResources>
    ): RenderGraphTextureHandle {
        if (this.#destroyed) throw new Error('Volumetric lighting controller is destroyed');
        this.packFrame(context.camera, context.frameIndex);
        this.packVolumes();
        const froxelTilesX = Math.max(
            1,
            Math.ceil(resources.tilesX * this.#settings.resolutionScale)
        );
        const froxelTilesY = Math.max(
            1,
            Math.ceil(resources.tilesY * this.#settings.resolutionScale)
        );
        const atlasColumns = Math.max(
            1,
            Math.min(
                resources.zSlices,
                Math.ceil(Math.sqrt((resources.zSlices * froxelTilesY) / Math.max(froxelTilesX, 1)))
            )
        );
        const atlasRows = Math.ceil(resources.zSlices / atlasColumns);
        this.#frameUInts[29] = atlasColumns;
        this.#frameUInts[32] = froxelTilesX;
        this.#frameUInts[33] = froxelTilesY;
        this.#frameUInts[34] = resources.zSlices;
        this.#frameUInts[35] = 0;
        context.writeStorageBuffer(this.#frameBuffer, 0, this.#frameByteView);
        context.writeStorageBuffer(this.#localVolumeBuffer, 0, this.#volumeByteView);
        const volumetricFrame = context.graph.importStorageBuffer(this.#frameBuffer);
        const localVolumes = context.graph.importStorageBuffer(this.#localVolumeBuffer);
        this.#froxelExtent.width = froxelTilesX * atlasColumns;
        this.#froxelExtent.height = froxelTilesY * atlasRows;
        this.#pendingFroxelCount = froxelTilesX * froxelTilesY * resources.zSlices;
        const froxel = context.graph.createTexture(
            'Volumetric lighting froxel scattering and extinction atlas',
            this.#froxelDescriptor
        );
        const injection = context.acquirePassParameters(this.#injectionPool);
        injection.setBuffer(0, resources.frameBuffer);
        injection.setBuffer(1, volumetricFrame);
        injection.setBuffer(2, resources.lights);
        injection.setBuffer(3, resources.clusterGrid);
        injection.setBuffer(4, resources.clusterIndices);
        injection.setBuffer(5, localVolumes);
        injection.setTexture(0, resources.sceneDepth);
        injection.setTexture(1, froxel);
        if (this.#withCloudShadow) {
            if (resources.cloudShadow === null || resources.cloudShadow === undefined) {
                throw new Error('Volumetric lighting cloud-shadow input is missing');
            }
            injection.setTexture(2, resources.cloudShadow);
        }
        injection.setDispatch(
            Math.max(1, Math.ceil(froxelTilesX / INJECTION_WORKGROUP_SIZE)),
            Math.max(1, Math.ceil(froxelTilesY / INJECTION_WORKGROUP_SIZE)),
            resources.zSlices
        );
        context.graph.addPass(this.#injectionPass, injection);

        const integratedFroxel = context.graph.createTexture(
            'Volumetric lighting cumulative froxel scattering and transmittance atlas',
            this.#integratedFroxelDescriptor
        );
        const lineIntegration = context.acquirePassParameters(this.#lineIntegrationPool);
        lineIntegration.setBuffer(0, resources.frameBuffer);
        lineIntegration.setBuffer(1, volumetricFrame);
        lineIntegration.setTexture(0, froxel);
        lineIntegration.setTexture(1, integratedFroxel);
        lineIntegration.setDispatch(
            Math.max(1, Math.ceil(froxelTilesX / INTEGRATION_WORKGROUP_SIZE)),
            Math.max(1, Math.ceil(froxelTilesY / INTEGRATION_WORKGROUP_SIZE))
        );
        context.graph.addPass(FROXEL_LINE_INTEGRATION_PASS, lineIntegration);

        const currentIntegration = context.graph.createTexture(
            'Volumetric lighting current integrated radiance and transmittance',
            this.#integrationDescriptor
        );
        const integrationWidth = Math.max(
            1,
            Math.floor(context.output.width * resources.sceneScale * this.#settings.resolutionScale)
        );
        const integrationHeight = Math.max(
            1,
            Math.floor(
                context.output.height * resources.sceneScale * this.#settings.resolutionScale
            )
        );
        const integration = context.acquirePassParameters(this.#integrationPool);
        integration.setBuffer(0, resources.frameBuffer);
        integration.setBuffer(1, volumetricFrame);
        integration.setTexture(0, resources.sceneDepth);
        integration.setTexture(1, integratedFroxel);
        integration.setTexture(2, currentIntegration);
        integration.setDispatch(
            Math.max(1, Math.ceil(integrationWidth / INTEGRATION_WORKGROUP_SIZE)),
            Math.max(1, Math.ceil(integrationHeight / INTEGRATION_WORKGROUP_SIZE))
        );
        context.graph.addPass(INTEGRATION_PASS, integration);

        if (!resources.historyValid) {
            context.graph.invalidateHistoryTexture(this.#colorHistoryKey);
            context.graph.invalidateHistoryTexture(this.#depthHistoryKey);
        }
        const colorHistory = context.graph.acquireHistoryTexture(
            this.#colorHistoryKey,
            this.#colorHistoryDescriptor
        );
        const depthHistory = context.graph.acquireHistoryTexture(
            this.#depthHistoryKey,
            this.#depthHistoryDescriptor
        );
        if (
            colorHistory.generation !== depthHistory.generation ||
            colorHistory.valid !== depthHistory.valid
        ) {
            throw new Error('Volumetric lighting history generations diverged');
        }
        const historyUsable = resources.historyValid && colorHistory.valid;
        if (historyUsable) {
            const resolve = context.acquirePassParameters(this.#resolvePool);
            resolve.setBuffer(0, resources.frameBuffer);
            resolve.setBuffer(1, volumetricFrame);
            resolve.setTexture(0, currentIntegration);
            resolve.setTexture(1, resources.sceneDepth);
            resolve.setTexture(2, colorHistory.history());
            resolve.setTexture(3, depthHistory.history());
            resolve.setTexture(4, colorHistory.current);
            resolve.setTexture(5, depthHistory.current);
            resolve.setDispatch(
                Math.max(1, Math.ceil(integrationWidth / INTEGRATION_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(integrationHeight / INTEGRATION_WORKGROUP_SIZE))
            );
            context.graph.addPass(TEMPORAL_RESOLVE_PASS, resolve);
        } else {
            const initialize = context.acquirePassParameters(this.#initializePool);
            initialize.setBuffer(0, resources.frameBuffer);
            initialize.setTexture(0, currentIntegration);
            initialize.setTexture(1, resources.sceneDepth);
            initialize.setTexture(2, colorHistory.current);
            initialize.setTexture(3, depthHistory.current);
            initialize.setDispatch(
                Math.max(1, Math.ceil(integrationWidth / INTEGRATION_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(integrationHeight / INTEGRATION_WORKGROUP_SIZE))
            );
            context.graph.addPass(TEMPORAL_INITIALIZE_PASS, initialize);
        }

        const composited = context.graph.createTexture(
            'Volumetric lighting composited HDR scene',
            this.#compositeDescriptor
        );
        const composite = context.acquirePassParameters(this.#compositePool);
        composite.inputTextures.length = 2;
        composite.inputTextures[0] = resources.sceneColor;
        composite.inputTextures[1] = colorHistory.current;
        composite.colorAttachments[0] = {
            texture: composited,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
        };
        context.graph.addPass(this.#compositePass, composite);
        this.#pendingFrame = context.frameIndex;
        this.#pendingHistoryUsed = historyUsable;
        return composited;
    }

    frameSubmitted(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#historyUsed = this.#pendingHistoryUsed;
        this.#froxelCount = this.#pendingFroxelCount;
        this.#pendingFrame = -1;
    }

    frameDiscarded(frameIndex: number): void {
        if (frameIndex !== this.#pendingFrame) return;
        this.#pendingFroxelCount = this.#froxelCount;
        this.#pendingFrame = -1;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        const failures: unknown[] = [];
        for (const buffer of [this.#frameBuffer, this.#localVolumeBuffer]) {
            try {
                buffer.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        if (failures.length !== 0) {
            throw new AggregateError(failures, 'Volumetric lighting resource destruction failed');
        }
    }

    private packFrame(camera: Camera, frameIndex: number): void {
        this.#inverseView.invert(camera.viewMatrix);
        const inverseView = this.#inverseView.elements;
        for (let index = 0; index < 16; index += 1) {
            this.#frameFloats[index] = inverseView[index] ?? 0;
        }
        const settings = this.#settings;
        this.#frameFloats[16] = settings.density;
        this.#frameFloats[17] = settings.heightFalloff;
        this.#frameFloats[18] = settings.baseHeight;
        this.#frameFloats[19] = settings.maxDistance;
        this.#frameFloats[20] = settings.albedo.r;
        this.#frameFloats[21] = settings.albedo.g;
        this.#frameFloats[22] = settings.albedo.b;
        this.#frameFloats[23] = settings.anisotropy;
        this.#frameFloats[24] = settings.historyWeight;
        this.#frameFloats[25] = settings.depthThreshold;
        this.#frameUInts[26] = frameIndex >>> 0;
        this.#frameUInts[27] = settings.localVolumes.length;
        this.#frameUInts[28] = 0;
        this.#frameUInts[29] = 1;
        this.#frameFloats[30] = settings.ambientStrength;
        this.#frameFloats[31] = settings.jitterStrength;
    }

    private packVolumes(): void {
        const settings = this.#settings;
        this.#volumeFloats.fill(0);
        for (let index = 0; index < settings.localVolumes.length; index += 1) {
            const volume = settings.localVolumes[index];
            if (volume === undefined) continue;
            validateVector(
                volume.center,
                `Volumetric lighting localVolumes[${String(index)}].center`
            );
            const base = index * (LOCAL_VOLUME_RECORD_BYTES / 4);
            this.#volumeFloats[base] = volume.center.x;
            this.#volumeFloats[base + 1] = volume.center.y;
            this.#volumeFloats[base + 2] = volume.center.z;
            this.#volumeFloats[base + 3] = volume.shape === 'box' ? 1 : 0;
            if (volume.shape === 'sphere') {
                const radius = finiteRange(
                    volume.radius,
                    0.001,
                    100_000,
                    `Volumetric lighting localVolumes[${String(index)}].radius`
                );
                this.#volumeFloats[base + 4] = radius;
                this.#volumeFloats[base + 5] = radius;
                this.#volumeFloats[base + 6] = radius;
            } else {
                validateVector(
                    volume.halfExtents,
                    `Volumetric lighting localVolumes[${String(index)}].halfExtents`,
                    true
                );
                this.#volumeFloats[base + 4] = volume.halfExtents.x;
                this.#volumeFloats[base + 5] = volume.halfExtents.y;
                this.#volumeFloats[base + 6] = volume.halfExtents.z;
            }
            this.#volumeFloats[base + 7] = finiteRange(
                volume.density,
                0,
                100,
                `Volumetric lighting localVolumes[${String(index)}].density`
            );
            const albedo = volume.albedo ?? settings.albedo;
            if (albedo instanceof Color) {
                validateColor(albedo, `Volumetric lighting localVolumes[${String(index)}].albedo`);
            }
            this.#volumeFloats[base + 8] = albedo.r;
            this.#volumeFloats[base + 9] = albedo.g;
            this.#volumeFloats[base + 10] = albedo.b;
            this.#volumeFloats[base + 11] = finiteRange(
                volume.edgeFalloff ?? 0.2,
                0.001,
                1,
                `Volumetric lighting localVolumes[${String(index)}].edgeFalloff`
            );
        }
    }
}

/** Required storage formats for the production froxel path. */
export const VOLUMETRIC_LIGHTING_REQUIRED_TEXTURE_FORMATS = Object.freeze([
    Object.freeze({ format: 'rgba16float' as const, use: 'storage' as const }),
    Object.freeze({ format: 'r32float' as const, use: 'storage' as const }),
    Object.freeze({ format: 'r32float' as const, use: 'sampled' as const })
]);
