import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import ComputeKernel from '../compute/ComputeKernel';
import ComputeSampler from '../compute/ComputeSampler';
import ComputeShader, { type ComputeShaderBinding } from '../compute/ComputeShader';
import type { RenderPipelineContext } from '../pipeline/RenderPipeline';
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
    RenderPipelineExtent,
    RenderPipelineHistoryTextureDescriptor,
    RenderPipelineTextureDescriptor
} from '../pipeline/ScriptableRenderGraph';

const INVALID_BUFFER = 0 as RenderGraphBufferHandle;
const INVALID_TEXTURE = 0 as RenderGraphTextureHandle;
const TRACE_WORKGROUP_SIZE = 8;
const MAX_TRACE_HIZ_LEVELS = 8;
const COLOR_PYRAMID_LEVELS = 4;
const SPATIAL_FILTER_STEPS = Object.freeze([1, 2, 4, 8] as const);

/** Production controls for the WebGPU high-end hierarchical screen-space reflection path. */
export interface ScreenSpaceReflectionsOptions {
    /** Reflection trace resolution relative to the internal scene. Defaults to 0.5. */
    readonly resolutionScale?: number;
    /** Maximum view-space ray length. Defaults to 80. */
    readonly maxRayDistance?: number;
    /** View-space surface thickness accepted as a hit. Defaults to 0.2. */
    readonly thickness?: number;
    /** Minimum view-space distance advanced by the finest hierarchy level. Defaults to 0.12. */
    readonly stride?: number;
    /** Maximum hierarchical iterations per reflected pixel. Defaults to 64. */
    readonly maxSteps?: number;
    /** Surfaces at or above this perceptual roughness stop tracing. Defaults to 0.85. */
    readonly roughnessCutoff?: number;
    /** Width of the screen-edge confidence fade in normalized coordinates. Defaults to 0.08. */
    readonly edgeFade?: number;
    /** Maximum accepted temporal history contribution. Defaults to 0.9. */
    readonly historyWeight?: number;
    /** Maximum relative reprojected view-depth error. Defaults to 0.03. */
    readonly depthThreshold?: number;
    /** Linear HDR reflection multiplier. Defaults to 1. */
    readonly intensity?: number;
}

/** @internal Immutable validated SSR configuration. */
export interface ScreenSpaceReflectionsSettings {
    readonly resolutionScale: number;
    readonly maxRayDistance: number;
    readonly thickness: number;
    readonly stride: number;
    readonly maxSteps: number;
    readonly roughnessCutoff: number;
    readonly edgeFade: number;
    readonly historyWeight: number;
    readonly depthThreshold: number;
    readonly intensity: number;
}

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

/** @internal Validate and freeze the public SSR configuration. */
export function snapshotScreenSpaceReflectionsOptions(
    options: Readonly<ScreenSpaceReflectionsOptions>
): Readonly<ScreenSpaceReflectionsSettings> {
    return Object.freeze({
        resolutionScale: finiteRange(
            options.resolutionScale ?? 0.5,
            0.25,
            1,
            'Screen-space reflections resolutionScale'
        ),
        maxRayDistance: finiteRange(
            options.maxRayDistance ?? 80,
            0.1,
            10_000,
            'Screen-space reflections maxRayDistance'
        ),
        thickness: finiteRange(
            options.thickness ?? 0.2,
            0.001,
            100,
            'Screen-space reflections thickness'
        ),
        stride: finiteRange(options.stride ?? 0.12, 0.001, 100, 'Screen-space reflections stride'),
        maxSteps: positiveInteger(
            options.maxSteps ?? 64,
            8,
            96,
            'Screen-space reflections maxSteps'
        ),
        roughnessCutoff: finiteRange(
            options.roughnessCutoff ?? 0.85,
            0.05,
            1,
            'Screen-space reflections roughnessCutoff'
        ),
        edgeFade: finiteRange(
            options.edgeFade ?? 0.08,
            0.001,
            0.5,
            'Screen-space reflections edgeFade'
        ),
        historyWeight: finiteRange(
            options.historyWeight ?? 0.9,
            0,
            0.98,
            'Screen-space reflections historyWeight'
        ),
        depthThreshold: finiteRange(
            options.depthThreshold ?? 0.03,
            0,
            1,
            'Screen-space reflections depthThreshold'
        ),
        intensity: finiteRange(options.intensity ?? 1, 0, 4, 'Screen-space reflections intensity')
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
};`;

function computePass(shader: ComputeShader): ComputeRenderPass {
    return new ComputeRenderPass(new ComputeKernel({ label: shader.label, shader }), shader.label);
}

const LINEAR_CLAMP_SAMPLER = new ComputeSampler({
    label: 'Screen-space reflections linear clamp',
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'nearest'
});

const COLOR_DOWNSAMPLE_PASS = computePass(
    new ComputeShader({
        label: 'Screen-space reflections radiance-cone downsample',
        source: `
@group(0) @binding(0) var sourceColor: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var destination: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let inputSize = vec2<f32>(textureDimensions(sourceColor));
    let texel = vec2<f32>(0.5) / inputSize;
    var value = textureSampleLevel(sourceColor, linearSampler, uv + vec2<f32>(-texel.x, -texel.y), 0.0);
    value += textureSampleLevel(sourceColor, linearSampler, uv + vec2<f32>(texel.x, -texel.y), 0.0);
    value += textureSampleLevel(sourceColor, linearSampler, uv + vec2<f32>(-texel.x, texel.y), 0.0);
    value += textureSampleLevel(sourceColor, linearSampler, uv + texel, 0.0);
    textureStore(destination, vec2<i32>(id.xy), value * 0.25);
}`,
        workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
        bindings: [
            {
                name: 'sourceColor',
                group: 0,
                binding: 0,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            { name: 'linearSampler', group: 0, binding: 1, kind: 'sampler' },
            {
                name: 'destination',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

function traceShader(
    settings: Readonly<ScreenSpaceReflectionsSettings>,
    hiZLevelCount: number
): ComputeShader {
    const colorDeclarations = Array.from(
        { length: COLOR_PYRAMID_LEVELS },
        (_unused, index) =>
            `@group(0) @binding(${String(1 + index)}) var sceneColor${String(index)}: texture_2d<f32>;`
    ).join('\n');
    const depthBinding = 1 + COLOR_PYRAMID_LEVELS;
    const attributesBinding = depthBinding + 1;
    const hiZBinding = attributesBinding + 1;
    const hiZDeclarations = Array.from(
        { length: hiZLevelCount },
        (_unused, index) =>
            `@group(0) @binding(${String(hiZBinding + index)}) var hiZ${String(index)}: texture_2d<f32>;`
    ).join('\n');
    const samplerBinding = hiZBinding + hiZLevelCount;
    const outputBinding = samplerBinding + 1;
    const colorCases = Array.from(
        { length: COLOR_PYRAMID_LEVELS - 1 },
        (_unused, index) =>
            `        case ${String(index)}u: { return textureSampleLevel(sceneColor${String(index)}, linearSampler, uv, 0.0).rgb; }`
    ).join('\n');
    const hiZCases = Array.from(
        { length: Math.max(0, hiZLevelCount - 1) },
        (_unused, index) =>
            `        case ${String(index)}u: { return textureLoad(hiZ${String(index)}, pixelFor(hiZ${String(index)}, uv), 0).xy; }`
    ).join('\n');
    const lastColor = COLOR_PYRAMID_LEVELS - 1;
    const lastHiZ = hiZLevelCount - 1;
    const bindings: ComputeShaderBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' }
    ];
    for (let index = 0; index < COLOR_PYRAMID_LEVELS; index += 1) {
        bindings.push({
            name: `sceneColor${String(index)}`,
            group: 0,
            binding: 1 + index,
            kind: 'sampled-texture',
            sampleType: 'float'
        });
    }
    bindings.push({
        name: 'sceneDepth',
        group: 0,
        binding: depthBinding,
        kind: 'sampled-texture',
        sampleType: 'depth'
    });
    bindings.push({
        name: 'materialAttributes',
        group: 0,
        binding: attributesBinding,
        kind: 'sampled-texture',
        sampleType: 'float'
    });
    for (let index = 0; index < hiZLevelCount; index += 1) {
        bindings.push({
            name: `hiZ${String(index)}`,
            group: 0,
            binding: hiZBinding + index,
            kind: 'sampled-texture',
            sampleType: 'unfilterable-float'
        });
    }
    bindings.push({ name: 'linearSampler', group: 0, binding: samplerBinding, kind: 'sampler' });
    bindings.push({
        name: 'reflectionOutput',
        group: 0,
        binding: outputBinding,
        kind: 'storage-texture',
        access: 'write-only',
        format: 'rgba16float'
    });
    return new ComputeShader({
        label: 'Hierarchical screen-space reflection trace',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
${colorDeclarations}
@group(0) @binding(${String(depthBinding)}) var sceneDepth: texture_depth_2d;
@group(0) @binding(${String(attributesBinding)}) var materialAttributes: texture_2d<f32>;
${hiZDeclarations}
@group(0) @binding(${String(samplerBinding)}) var linearSampler: sampler;
@group(0) @binding(${String(outputBinding)}) var reflectionOutput: texture_storage_2d<rgba16float, write>;

fn pixelFor(source: texture_2d<f32>, uv: vec2<f32>) -> vec2<i32> {
    let dimensions = textureDimensions(source);
    return clamp(vec2<i32>(uv * vec2<f32>(dimensions)), vec2<i32>(0), vec2<i32>(dimensions) - vec2<i32>(1));
}
fn sampleColor(level: u32, uv: vec2<f32>) -> vec3<f32> {
    switch level {
${colorCases}
        default: { return textureSampleLevel(sceneColor${String(lastColor)}, linearSampler, uv, 0.0).rgb; }
    }
}
fn sampleHiZ(level: u32, uv: vec2<f32>) -> vec2<f32> {
    switch level {
${hiZCases}
        default: { return textureLoad(hiZ${String(lastHiZ)}, pixelFor(hiZ${String(lastHiZ)}, uv), 0).xy; }
    }
}
fn decodeOctahedralNormal(encoded: vec2<f32>) -> vec3<f32> {
    var normal = vec3<f32>(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
    if (normal.z < 0.0) {
        let original = normal.xy;
        normal.x = (1.0 - abs(original.y)) * select(-1.0, 1.0, original.x >= 0.0);
        normal.y = (1.0 - abs(original.x)) * select(-1.0, 1.0, original.y >= 0.0);
    }
    return normalize(normal);
}
fn reconstructViewPosition(uv: vec2<f32>, deviceDepth: f32) -> vec3<f32> {
    let ndc = vec3<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, deviceDepth * 2.0 - 1.0);
    let viewZ = -frameData.projection[3][2] /
        (ndc.z + frameData.projection[2][2]);
    let viewX = -(ndc.x + frameData.projection[2][0]) * viewZ /
        frameData.projection[0][0];
    let viewY = -(ndc.y + frameData.projection[2][1]) * viewZ /
        frameData.projection[1][1];
    return vec3<f32>(viewX, viewY, viewZ);
}
fn projectViewPosition(position: vec3<f32>) -> vec3<f32> {
    let clip = frameData.projection * vec4<f32>(position, 1.0);
    if (clip.w <= 1e-6) { return vec3<f32>(-1.0); }
    let ndc = clip.xyz / clip.w;
    return vec3<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z * 0.5 + 0.5);
}
fn rayIsInFront(rayDepth: f32, bounds: vec2<f32>) -> bool {
    return select((rayDepth < bounds.x), (rayDepth > bounds.y), frameData.depth.w > 0.5);
}
fn rayIsBehind(rayDepth: f32, bounds: vec2<f32>) -> bool {
    return select((rayDepth > bounds.y), (rayDepth < bounds.x), frameData.depth.w > 0.5);
}
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(reflectionOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let depthSize = textureDimensions(sceneDepth);
    let depthPixel = clamp(vec2<i32>(uv * vec2<f32>(depthSize)), vec2<i32>(0), vec2<i32>(depthSize) - vec2<i32>(1));
    let deviceDepth = textureLoad(sceneDepth, depthPixel, 0);
    let background = select(deviceDepth >= 0.999999, deviceDepth <= 0.000001, frameData.depth.w > 0.5);
    let attributes = textureLoad(materialAttributes, pixelFor(materialAttributes, uv), 0);
    let packedMaterial = u32(max(round(attributes.w), 0.0));
    let receivesReflection = (packedMaterial & 1u) != 0u;
    let roughness = clamp(attributes.z, 0.045, 1.0);
    if (background || !receivesReflection || roughness >= ${String(settings.roughnessCutoff)}) {
        textureStore(reflectionOutput, vec2<i32>(id.xy), vec4<f32>(0.0));
        return;
    }

    let origin = reconstructViewPosition(uv, deviceDepth);
    let normal = decodeOctahedralNormal(attributes.xy);
    let incident = normalize(origin);
    let direction = normalize(reflect(incident, normal));
    if (direction.z >= -0.0001) {
        textureStore(reflectionOutput, vec2<i32>(id.xy), vec4<f32>(0.0));
        return;
    }
    let minimumStep = max(${String(settings.stride)}, -origin.z * 0.002);
    let startDistance = max(${String(settings.thickness)} * 1.5, minimumStep);
    var distance = startDistance;
    var previousDistance = distance;
    var level = 0u;
    var hitUv = vec2<f32>(-1.0);
    var hitDistance = 0.0;
    for (var iteration = 0u; iteration < ${String(settings.maxSteps)}u; iteration += 1u) {
        if (distance > ${String(settings.maxRayDistance)}) { break; }
        let rayPoint = origin + direction * distance;
        let projected = projectViewPosition(rayPoint);
        if (
            projected.x <= 0.0 || projected.y <= 0.0 ||
            projected.x >= 1.0 || projected.y >= 1.0 || projected.z < 0.0 || projected.z > 1.0
        ) { break; }
        let bounds = sampleHiZ(level, projected.xy);
        if (rayIsInFront(projected.z, bounds)) {
            previousDistance = distance;
            distance += minimumStep * exp2(f32(level));
            level = min(level + 1u, ${String(lastHiZ)}u);
            continue;
        }
        if (level > 0u) {
            level -= 1u;
            distance = max(startDistance, mix(previousDistance, distance, 0.5));
            continue;
        }
        let exactPixel = clamp(vec2<i32>(projected.xy * vec2<f32>(depthSize)), vec2<i32>(0), vec2<i32>(depthSize) - vec2<i32>(1));
        let exactDepth = textureLoad(sceneDepth, exactPixel, 0);
        let scenePosition = reconstructViewPosition(projected.xy, exactDepth);
        let penetration = (-rayPoint.z) - (-scenePosition.z);
        let thickness = ${String(settings.thickness)} * (1.0 + max(-rayPoint.z, 0.0) * 0.002);
        if (!rayIsBehind(projected.z, bounds) || (penetration >= -thickness * 0.25 && penetration <= thickness)) {
            if (penetration >= -thickness * 0.25 && penetration <= thickness) {
                hitUv = projected.xy;
                hitDistance = distance;
                break;
            }
        }
        previousDistance = distance;
        distance += minimumStep;
    }
    if (hitUv.x < 0.0) {
        textureStore(reflectionOutput, vec2<i32>(id.xy), vec4<f32>(0.0));
        return;
    }
    let edgeDistance = min(min(hitUv.x, 1.0 - hitUv.x), min(hitUv.y, 1.0 - hitUv.y));
    let edgeConfidence = smoothstep(0.0, ${String(settings.edgeFade)}, edgeDistance);
    let distanceConfidence = clamp(1.0 - hitDistance / ${String(settings.maxRayDistance)}, 0.0, 1.0);
    let roughnessConfidence = clamp(1.0 - roughness / ${String(settings.roughnessCutoff)}, 0.0, 1.0);
    let viewDirection = normalize(-origin);
    let ndotv = clamp(dot(normal, viewDirection), 0.0, 1.0);
    let metallic = f32((packedMaterial >> 1u) & 255u) / 255.0;
    let f0 = mix(0.04, 0.9, metallic);
    let fresnel = f0 + (1.0 - f0) * pow(1.0 - ndotv, 5.0);
    let coneLevel = min(
        u32(clamp(floor(roughness * roughness * 4.0 + log2(1.0 + hitDistance * roughness * 0.05)), 0.0, ${String(lastColor)}.0)),
        ${String(lastColor)}u
    );
    let confidence = edgeConfidence * distanceConfidence * roughnessConfidence;
    let radiance = sampleColor(coneLevel, hitUv) * fresnel * confidence;
    textureStore(reflectionOutput, vec2<i32>(id.xy), vec4<f32>(radiance, confidence));
}`,
        workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
        bindings
    });
}

const TEMPORAL_INITIALIZE_PASS = computePass(
    new ComputeShader({
        label: 'Screen-space reflections initialize temporal history',
        source: `
@group(0) @binding(0) var currentReflection: texture_2d<f32>;
@group(0) @binding(1) var motionDepth: texture_2d<f32>;
@group(0) @binding(2) var historyOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var depthOutput: texture_storage_2d<r32float, write>;
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(historyOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let reflectionSize = textureDimensions(currentReflection);
    let reflectionPixel = clamp(vec2<i32>(uv * vec2<f32>(reflectionSize)), vec2<i32>(0), vec2<i32>(reflectionSize) - vec2<i32>(1));
    let motionSize = textureDimensions(motionDepth);
    let motionPixel = clamp(vec2<i32>(uv * vec2<f32>(motionSize)), vec2<i32>(0), vec2<i32>(motionSize) - vec2<i32>(1));
    textureStore(historyOutput, vec2<i32>(id.xy), textureLoad(currentReflection, reflectionPixel, 0));
    textureStore(depthOutput, vec2<i32>(id.xy), vec4<f32>(textureLoad(motionDepth, motionPixel, 0).w));
}`,
        workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
        bindings: [
            {
                name: 'currentReflection',
                group: 0,
                binding: 0,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'motionDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'historyOutput',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'depthOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            }
        ]
    })
);

function temporalResolvePass(
    settings: Readonly<ScreenSpaceReflectionsSettings>
): ComputeRenderPass {
    return computePass(
        new ComputeShader({
            label: 'Screen-space reflections production temporal resolve',
            source: `
@group(0) @binding(0) var currentReflection: texture_2d<f32>;
@group(0) @binding(1) var motionDepth: texture_2d<f32>;
@group(0) @binding(2) var previousHistory: texture_2d<f32>;
@group(0) @binding(3) var previousDepth: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;
@group(0) @binding(5) var historyOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var depthOutput: texture_storage_2d<r32float, write>;
fn relativeDepthError(historyLogDepth: f32, expectedLogDepth: f32) -> f32 {
    let historyLinear = exp2(max(historyLogDepth, 0.0)) - 1.0;
    let expectedLinear = exp2(max(expectedLogDepth, 0.0)) - 1.0;
    return abs(historyLinear - expectedLinear) / max(expectedLinear, 0.001);
}
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(historyOutput);
    if (any(id.xy >= outputSize)) { return; }
    let pixel = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let currentSize = textureDimensions(currentReflection);
    let currentPixel = clamp(vec2<i32>(uv * vec2<f32>(currentSize)), vec2<i32>(0), vec2<i32>(currentSize) - vec2<i32>(1));
    let current = textureLoad(currentReflection, currentPixel, 0);
    let motionSize = textureDimensions(motionDepth);
    let motionPixel = clamp(vec2<i32>(uv * vec2<f32>(motionSize)), vec2<i32>(0), vec2<i32>(motionSize) - vec2<i32>(1));
    let motion = textureLoad(motionDepth, motionPixel, 0);
    let historyUv = uv - motion.xy;
    let halfTexel = vec2<f32>(0.5) / vec2<f32>(outputSize);
    let inside = all(historyUv >= halfTexel) && all(historyUv <= vec2<f32>(1.0) - halfTexel);
    var minimumValue = current.rgb;
    var maximumValue = current.rgb;
    for (var y = -1; y <= 1; y += 1) {
        for (var x = -1; x <= 1; x += 1) {
            let coordinate = clamp(currentPixel + vec2<i32>(x, y), vec2<i32>(0), vec2<i32>(currentSize) - vec2<i32>(1));
            let value = textureLoad(currentReflection, coordinate, 0).rgb;
            minimumValue = min(minimumValue, value);
            maximumValue = max(maximumValue, value);
        }
    }
    var weight = 0.0;
    var history = vec4<f32>(0.0);
    if (inside && motion.z >= 0.0) {
        history = textureSampleLevel(previousHistory, linearSampler, historyUv, 0.0);
        let historyDepthSize = textureDimensions(previousDepth);
        let historyDepthPixel = clamp(vec2<i32>(historyUv * vec2<f32>(historyDepthSize)), vec2<i32>(0), vec2<i32>(historyDepthSize) - vec2<i32>(1));
        let depthError = relativeDepthError(
            textureLoad(previousDepth, historyDepthPixel, 0).x,
            motion.z
        );
        let velocityPixels = length(motion.xy * vec2<f32>(motionSize));
        let motionResponse = clamp(velocityPixels / 24.0, 0.0, 1.0);
        let confidence = max(current.a, min(history.a, 0.25));
        weight = select(
            ${String(settings.historyWeight)} * confidence * (1.0 - motionResponse * 0.65),
            0.0,
            depthError > ${String(settings.depthThreshold)}
        );
        history = vec4<f32>(clamp(history.rgb, minimumValue, maximumValue), history.a);
    }
    var resolved = mix(current, history, clamp(weight, 0.0, ${String(settings.historyWeight)}));
    resolved.a = max(current.a, history.a * weight);
    textureStore(historyOutput, pixel, resolved);
    textureStore(depthOutput, pixel, vec4<f32>(motion.w));
}`,
            workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
            bindings: [
                {
                    name: 'currentReflection',
                    group: 0,
                    binding: 0,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'motionDepth',
                    group: 0,
                    binding: 1,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'previousHistory',
                    group: 0,
                    binding: 2,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'previousDepth',
                    group: 0,
                    binding: 3,
                    kind: 'sampled-texture',
                    sampleType: 'unfilterable-float'
                },
                { name: 'linearSampler', group: 0, binding: 4, kind: 'sampler' },
                {
                    name: 'historyOutput',
                    group: 0,
                    binding: 5,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                },
                {
                    name: 'depthOutput',
                    group: 0,
                    binding: 6,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'r32float'
                }
            ]
        })
    );
}

function spatialFilterPass(
    step: number,
    settings: Readonly<ScreenSpaceReflectionsSettings>
): ComputeRenderPass {
    const taps = [
        [-1, -1, 1],
        [0, -1, 2],
        [1, -1, 1],
        [-1, 0, 2],
        [0, 0, 36],
        [1, 0, 2],
        [-1, 1, 1],
        [0, 1, 2],
        [1, 1, 1]
    ] as const;
    const tapSource = taps
        .map(
            ([x, y, weight]) => `
    {
        let neighborCoordinate = clamp(
            pixel + vec2<i32>(${String(x * step)}, ${String(y * step)}),
            vec2<i32>(0),
            vec2<i32>(outputSize) - vec2<i32>(1)
        );
        let neighbor = textureLoad(sourceReflection, neighborCoordinate, 0);
        if (neighbor.a > 0.0001) {
            let neighborUv = (vec2<f32>(neighborCoordinate) + vec2<f32>(0.5)) /
                vec2<f32>(outputSize);
            let neighborAttributes = textureLoad(
                materialAttributes,
                pixelFor(materialAttributes, neighborUv),
                0
            );
            let neighborPacked = u32(max(round(neighborAttributes.w), 0.0));
            if (
                (neighborPacked & 1u) != 0u &&
                neighborAttributes.z < ${String(settings.roughnessCutoff)}
            ) {
                let neighborNormal = decodeOctahedralNormal(neighborAttributes.xy);
                let neighborLogDepth = textureLoad(
                    motionDepth,
                    pixelFor(motionDepth, neighborUv),
                    0
                ).w;
                let normalWeight = pow(max(dot(centerNormal, neighborNormal), 0.0), 24.0);
                let depthWeight = exp2(-abs(centerLogDepth - neighborLogDepth) * 24.0);
                let roughnessWeight = exp2(
                    -abs(centerAttributes.z - neighborAttributes.z) * 16.0
                );
                let confidenceWeight = clamp(0.25 + neighbor.a, 0.0, 1.0);
                let weight = ${String(weight)}.0 * normalWeight * depthWeight *
                    roughnessWeight * confidenceWeight;
                accumulation += neighbor * weight;
                totalWeight += weight;
            }
        }
    }`
        )
        .join('\n');
    return computePass(
        new ComputeShader({
            label: `Screen-space reflections confidence filter step ${String(step)}`,
            source: `
@group(0) @binding(0) var sourceReflection: texture_2d<f32>;
@group(0) @binding(1) var motionDepth: texture_2d<f32>;
@group(0) @binding(2) var materialAttributes: texture_2d<f32>;
@group(0) @binding(3) var destination: texture_storage_2d<rgba16float, write>;
fn pixelFor(source: texture_2d<f32>, uv: vec2<f32>) -> vec2<i32> {
    let dimensions = textureDimensions(source);
    return clamp(
        vec2<i32>(uv * vec2<f32>(dimensions)),
        vec2<i32>(0),
        vec2<i32>(dimensions) - vec2<i32>(1)
    );
}
fn decodeOctahedralNormal(encoded: vec2<f32>) -> vec3<f32> {
    var normal = vec3<f32>(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
    if (normal.z < 0.0) {
        let original = normal.xy;
        normal.x = (1.0 - abs(original.y)) * select(-1.0, 1.0, original.x >= 0.0);
        normal.y = (1.0 - abs(original.x)) * select(-1.0, 1.0, original.y >= 0.0);
    }
    return normalize(normal);
}
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    let pixel = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let centerAttributes = textureLoad(
        materialAttributes,
        pixelFor(materialAttributes, uv),
        0
    );
    let centerPacked = u32(max(round(centerAttributes.w), 0.0));
    if (
        (centerPacked & 1u) == 0u ||
        centerAttributes.z >= ${String(settings.roughnessCutoff)}
    ) {
        textureStore(destination, pixel, vec4<f32>(0.0));
        return;
    }
    let centerNormal = decodeOctahedralNormal(centerAttributes.xy);
    let centerLogDepth = textureLoad(motionDepth, pixelFor(motionDepth, uv), 0).w;
    var accumulation = vec4<f32>(0.0);
    var totalWeight = 0.0;
${tapSource}
    if (totalWeight > 0.0001) {
        textureStore(destination, pixel, accumulation / totalWeight);
    } else {
        textureStore(destination, pixel, vec4<f32>(0.0));
    }
}`,
            workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
            bindings: [
                {
                    name: 'sourceReflection',
                    group: 0,
                    binding: 0,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'motionDepth',
                    group: 0,
                    binding: 1,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'materialAttributes',
                    group: 0,
                    binding: 2,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'destination',
                    group: 0,
                    binding: 3,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                }
            ]
        })
    );
}

function compositePass(intensity: number): FullscreenRenderPass {
    return new FullscreenRenderPass({
        name: 'Screen-space reflections linear HDR composite',
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_reflection;
layout(location=0) out vec4 color;
void main() {
    vec4 scene = texture(u_scene, v_uv);
    vec4 reflection = texture(u_reflection, v_uv);
    color = vec4(scene.rgb + reflection.rgb * ${String(intensity)}, scene.a);
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
        this.samplers = Array.from({ length: samplerCount }, () => LINEAR_CLAMP_SAMPLER);
    }

    setBuffer(index: number, buffer: RenderGraphBufferHandle): void {
        const binding = this.buffers[index];
        if (binding === undefined) throw new RangeError('SSR compute buffer slot is unavailable');
        binding.buffer = buffer;
    }

    setTexture(index: number, texture: RenderGraphTextureAccessHandle): void {
        const binding = this.textures[index];
        if (binding === undefined) throw new RangeError('SSR compute texture slot is unavailable');
        binding.texture = texture;
    }

    setDispatch(x: number, y: number): void {
        this.dispatch.x = x;
        this.dispatch.y = y;
        this.dispatch.z = 1;
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

/** @internal Resources produced by the clustered opaque stage and consumed by SSR. */
export interface ScreenSpaceReflectionsResources {
    readonly frameBuffer: RenderGraphBufferHandle;
    readonly sceneColor: RenderGraphTextureHandle;
    readonly sceneDepth: RenderGraphTextureHandle;
    readonly materialAttributes: RenderGraphTextureHandle;
    readonly motionDepth: RenderGraphTextureHandle;
    readonly hiZ: readonly RenderGraphTextureHandle[];
    /** False after camera cuts or other temporal discontinuities. */
    readonly historyValid: boolean;
}

/**
 * @internal WebGPU high-end hierarchical trace, temporal rejection, and HDR composite controller.
 */
export class ScreenSpaceReflectionsController {
    readonly #settings: Readonly<ScreenSpaceReflectionsSettings>;
    readonly #sceneScale: number;
    readonly #traceHiZLevelCount: number;
    readonly #tracePass: ComputeRenderPass;
    readonly #temporalResolvePass: ComputeRenderPass;
    readonly #spatialFilterPasses: readonly ComputeRenderPass[];
    readonly #compositePass: FullscreenRenderPass;
    readonly #colorHistoryKey = Object.freeze({});
    readonly #depthHistoryKey = Object.freeze({});
    readonly #colorPyramidDescriptors: readonly Readonly<RenderPipelineTextureDescriptor>[];
    readonly #reflectionDescriptor: Readonly<RenderPipelineTextureDescriptor>;
    readonly #colorHistoryDescriptor: Readonly<RenderPipelineHistoryTextureDescriptor>;
    readonly #depthHistoryDescriptor: Readonly<RenderPipelineHistoryTextureDescriptor>;
    readonly #compositeDescriptor: Readonly<RenderPipelineTextureDescriptor>;
    readonly #downsamplePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 2, 1)
    );
    readonly #tracePool: RenderPassParameterPool<MutableComputeParameters>;
    readonly #initializePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 4, 0)
    );
    readonly #resolvePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 6, 1)
    );
    readonly #spatialFilterPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 4, 0)
    );
    readonly #compositePool = new RenderPassParameterPool(
        () => new MutableFullscreenParameters(),
        parameters => {
            parameters.reset();
        }
    );
    #destroyed = false;

    constructor(
        settings: Readonly<ScreenSpaceReflectionsSettings>,
        sceneScale: number,
        hiZLevelCount: number
    ) {
        this.#settings = settings;
        this.#sceneScale = sceneScale;
        this.#traceHiZLevelCount = Math.min(hiZLevelCount, MAX_TRACE_HIZ_LEVELS);
        if (this.#traceHiZLevelCount < 1) {
            throw new RangeError('Screen-space reflections require at least one Hi-Z level');
        }
        this.#tracePass = computePass(traceShader(settings, this.#traceHiZLevelCount));
        this.#temporalResolvePass = temporalResolvePass(settings);
        this.#spatialFilterPasses = Object.freeze(
            SPATIAL_FILTER_STEPS.map(step => spatialFilterPass(step, settings))
        );
        this.#compositePass = compositePass(settings.intensity);
        this.#tracePool = new RenderPassParameterPool(
            () =>
                new MutableComputeParameters(
                    1,
                    COLOR_PYRAMID_LEVELS + 2 + this.#traceHiZLevelCount + 1,
                    1
                )
        );
        this.#colorPyramidDescriptors = Object.freeze(
            Array.from({ length: COLOR_PYRAMID_LEVELS - 1 }, (_unused, index) =>
                Object.freeze({
                    format: 'rgba16float' as const,
                    extent: Object.freeze({
                        relativeTo: 'output' as const,
                        scale: sceneScale / 2 ** (index + 1),
                        minWidth: 1,
                        minHeight: 1
                    })
                })
            )
        );
        const reflectionExtent: RenderPipelineExtent = Object.freeze({
            relativeTo: 'output',
            scale: sceneScale * settings.resolutionScale,
            minWidth: 1,
            minHeight: 1
        });
        this.#reflectionDescriptor = Object.freeze({
            format: 'rgba16float',
            extent: reflectionExtent,
            usage: Object.freeze(['sampled' as const, 'storage' as const])
        });
        this.#colorHistoryDescriptor = Object.freeze({
            label: 'Screen-space reflections radiance history',
            format: 'rgba16float',
            extent: reflectionExtent,
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2
        });
        this.#depthHistoryDescriptor = Object.freeze({
            label: 'Screen-space reflections view-depth history',
            format: 'r32float',
            extent: reflectionExtent,
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2
        });
        this.#compositeDescriptor = Object.freeze({
            format: 'rgba16float',
            extent: Object.freeze({ relativeTo: 'output' as const, scale: sceneScale })
        });
    }

    record(
        context: RenderPipelineContext,
        resources: Readonly<ScreenSpaceReflectionsResources>
    ): RenderGraphTextureHandle {
        if (this.#destroyed) throw new Error('Screen-space reflections controller is destroyed');
        if (resources.hiZ.length < this.#traceHiZLevelCount) {
            throw new Error('Screen-space reflections Hi-Z pyramid is incomplete');
        }
        const colorLevels: RenderGraphTextureHandle[] = [resources.sceneColor];
        let source = resources.sceneColor;
        for (let index = 0; index < COLOR_PYRAMID_LEVELS - 1; index += 1) {
            const descriptor = this.#colorPyramidDescriptors[index];
            if (descriptor === undefined) {
                throw new Error('Screen-space reflections color pyramid descriptor is missing');
            }
            const destination = context.graph.createTexture(
                `Screen-space reflections radiance cone ${String(index + 1)}`,
                descriptor
            );
            const parameters = context.acquirePassParameters(this.#downsamplePool);
            parameters.setTexture(0, source);
            parameters.setTexture(1, destination);
            const scale = this.#sceneScale / 2 ** (index + 1);
            parameters.setDispatch(
                Math.max(
                    1,
                    Math.ceil(
                        Math.max(1, Math.floor(context.output.width * scale)) / TRACE_WORKGROUP_SIZE
                    )
                ),
                Math.max(
                    1,
                    Math.ceil(
                        Math.max(1, Math.floor(context.output.height * scale)) /
                            TRACE_WORKGROUP_SIZE
                    )
                )
            );
            context.graph.addPass(COLOR_DOWNSAMPLE_PASS, parameters);
            colorLevels.push(destination);
            source = destination;
        }

        const currentReflection = context.graph.createTexture(
            'Screen-space reflections current radiance and confidence',
            this.#reflectionDescriptor
        );
        const trace = context.acquirePassParameters(this.#tracePool);
        trace.setBuffer(0, resources.frameBuffer);
        let textureIndex = 0;
        for (const color of colorLevels) trace.setTexture(textureIndex++, color);
        trace.setTexture(textureIndex++, resources.sceneDepth);
        trace.setTexture(textureIndex++, resources.materialAttributes);
        for (let index = 0; index < this.#traceHiZLevelCount; index += 1) {
            const hiZ = resources.hiZ[index];
            if (hiZ === undefined)
                throw new Error('Screen-space reflections Hi-Z level is missing');
            trace.setTexture(textureIndex++, hiZ);
        }
        trace.setTexture(textureIndex, currentReflection);
        const reflectionScale = this.#sceneScale * this.#settings.resolutionScale;
        const reflectionWidth = Math.max(1, Math.floor(context.output.width * reflectionScale));
        const reflectionHeight = Math.max(1, Math.floor(context.output.height * reflectionScale));
        trace.setDispatch(
            Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
            Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
        );
        context.graph.addPass(this.#tracePass, trace);

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
            throw new Error('Screen-space reflections history generations diverged');
        }
        if (resources.historyValid && colorHistory.valid) {
            const resolve = context.acquirePassParameters(this.#resolvePool);
            resolve.setTexture(0, currentReflection);
            resolve.setTexture(1, resources.motionDepth);
            resolve.setTexture(2, colorHistory.history());
            resolve.setTexture(3, depthHistory.history());
            resolve.setTexture(4, colorHistory.current);
            resolve.setTexture(5, depthHistory.current);
            resolve.setDispatch(
                Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
            );
            context.graph.addPass(this.#temporalResolvePass, resolve);
        } else {
            const initialize = context.acquirePassParameters(this.#initializePool);
            initialize.setTexture(0, currentReflection);
            initialize.setTexture(1, resources.motionDepth);
            initialize.setTexture(2, colorHistory.current);
            initialize.setTexture(3, depthHistory.current);
            initialize.setDispatch(
                Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
            );
            context.graph.addPass(TEMPORAL_INITIALIZE_PASS, initialize);
        }

        let reflectionForComposite: RenderGraphTextureHandle = colorHistory.current;
        for (let index = 0; index < this.#spatialFilterPasses.length; index += 1) {
            const filterPass = this.#spatialFilterPasses[index];
            if (filterPass === undefined) {
                throw new Error('Screen-space reflections spatial filter pass is missing');
            }
            const filtered = context.graph.createTexture(
                `Screen-space reflections confidence filter ${String(index + 1)}`,
                this.#reflectionDescriptor
            );
            const filter = context.acquirePassParameters(this.#spatialFilterPool);
            filter.setTexture(0, reflectionForComposite);
            filter.setTexture(1, resources.motionDepth);
            filter.setTexture(2, resources.materialAttributes);
            filter.setTexture(3, filtered);
            filter.setDispatch(
                Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
            );
            context.graph.addPass(filterPass, filter);
            reflectionForComposite = filtered;
        }

        const composited = context.graph.createTexture(
            'Screen-space reflections composited HDR scene',
            this.#compositeDescriptor
        );
        const composite = context.acquirePassParameters(this.#compositePool);
        composite.inputTextures.length = 2;
        composite.inputTextures[0] = resources.sceneColor;
        composite.inputTextures[1] = reflectionForComposite;
        composite.colorAttachments[0] = {
            texture: composited,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
        };
        context.graph.addPass(this.#compositePass, composite);
        return composited;
    }

    destroy(): void {
        this.#destroyed = true;
    }
}

/** @internal Maximum sampled Hi-Z levels retained by the production SSR trace ABI. */
export const SCREEN_SPACE_REFLECTION_TRACE_HIZ_LEVELS = MAX_TRACE_HIZ_LEVELS;

/** @internal Number of sampled radiance levels used for the roughness cone. */
export const SCREEN_SPACE_REFLECTION_COLOR_LEVELS = COLOR_PYRAMID_LEVELS;
