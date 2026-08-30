import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import Shader from '../../shader/Shader';
import ComputeKernel from '../compute/ComputeKernel';
import ComputeSampler from '../compute/ComputeSampler';
import ComputeShader, { type ComputeShaderBinding } from '../compute/ComputeShader';
import type { StorageBuffer } from '../StorageBuffer';
import type {
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../pipeline/RenderPipeline';
import { RenderPassParameterPool } from '../pipeline/RenderPassParameterPool';
import {
    ComputeRenderPass,
    FullscreenRenderPass,
    type ComputeDispatch,
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
const MIN_REFLECTION_RESPONSE = 1 / 1024;
const SSR_DIAGNOSTIC_BYTES = 32;
const TEMPORAL_SEQUENCE_LENGTH = 32;
const DETERMINISTIC_REFLECTION_ROUGHNESS = 0.1;
const STOCHASTIC_RAY_COUNT = 4;
const MAX_HISTORY_SAMPLE_COUNT = 31;
const MAX_INDIRECT_DISPATCH_X = 65_535;

/** Submitted GPU work counters for the hierarchical SSR trace. */
export interface ScreenSpaceReflectionsDiagnostics {
    /** Eight-by-eight trace tiles containing at least one eligible receiver. */
    readonly activeTileCount: number;
    /** Eligible reflective receiver pixels classified in active tiles. */
    readonly activePixelCount: number;
    /** Eligible receiver pixels that produced a valid screen-space hit. */
    readonly hitPixelCount: number;
    /** Eligible receiver pixels that exhausted or left the screen-space trace. */
    readonly missPixelCount: number;
    /** Missed receiver pixels whose hierarchy crossing could not be validated precisely. */
    readonly uncertainPixelCount: number;
    /** Missed receiver pixels rejected because the visible hit faced away from the ray. */
    readonly backfaceRejectedPixelCount: number;
    /** Temporal pixels that consumed either surface- or hit-domain history. */
    readonly historyAcceptedPixelCount: number;
    /** Temporal pixels that rejected all available history candidates. */
    readonly historyRejectedPixelCount: number;
}

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
    /** Linear HDR multiplier applied to SSR radiance, without scaling fallback removal. Defaults to 1. */
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
    const settings: ScreenSpaceReflectionsSettings = {
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
    };
    if (settings.stride * 4 > settings.maxRayDistance) {
        throw new RangeError(
            'Screen-space reflections maxRayDistance must cover at least four stride steps'
        );
    }
    if (settings.thickness * 2 > settings.maxRayDistance) {
        throw new RangeError(
            'Screen-space reflections thickness must not exceed half maxRayDistance'
        );
    }
    return Object.freeze(settings);
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

const TRACE_RESET_PASS = computePass(
    new ComputeShader({
        label: 'Screen-space reflections clear trace targets and counters',
        source: `
struct DispatchArguments {
    x: atomic<u32>,
    y: atomic<u32>,
    z: atomic<u32>,
};
struct TraceDiagnostics {
    activeTiles: atomic<u32>,
    activePixels: atomic<u32>,
    hitPixels: atomic<u32>,
    missPixels: atomic<u32>,
    uncertainPixels: atomic<u32>,
    backfaceRejectedPixels: atomic<u32>,
    historyAcceptedPixels: atomic<u32>,
    historyRejectedPixels: atomic<u32>,
};
@group(0) @binding(0) var<storage, read_write> dispatchArguments: DispatchArguments;
@group(0) @binding(1) var<storage, read_write> diagnostics: TraceDiagnostics;
@group(0) @binding(2) var reflectionOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var hitOutput: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (all(id.xy == vec2<u32>(0u))) {
        atomicStore(&dispatchArguments.x, 0u);
        atomicStore(&dispatchArguments.y, 1u);
        atomicStore(&dispatchArguments.z, 1u);
        atomicStore(&diagnostics.activeTiles, 0u);
        atomicStore(&diagnostics.activePixels, 0u);
        atomicStore(&diagnostics.hitPixels, 0u);
        atomicStore(&diagnostics.missPixels, 0u);
        atomicStore(&diagnostics.uncertainPixels, 0u);
        atomicStore(&diagnostics.backfaceRejectedPixels, 0u);
        atomicStore(&diagnostics.historyAcceptedPixels, 0u);
        atomicStore(&diagnostics.historyRejectedPixels, 0u);
    }
    let outputSize = textureDimensions(reflectionOutput);
    if (any(id.xy >= outputSize)) { return; }
    textureStore(reflectionOutput, vec2<i32>(id.xy), vec4<f32>(0.0));
    textureStore(hitOutput, vec2<i32>(id.xy), vec4<f32>(-1.0, -1.0, 0.0, 0.0));
}`,
        workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
        bindings: [
            {
                name: 'dispatchArguments',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'diagnostics',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'reflectionOutput',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'hitOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

function tileClassificationPass(
    settings: Readonly<ScreenSpaceReflectionsSettings>
): ComputeRenderPass {
    return computePass(
        new ComputeShader({
            label: 'Screen-space reflections active tile classification',
            source: `${FRAME_WGSL}
struct TileMask { values: array<u32> };
struct TraceDiagnostics {
    activeTiles: atomic<u32>,
    activePixels: atomic<u32>,
    hitPixels: atomic<u32>,
    missPixels: atomic<u32>,
    uncertainPixels: atomic<u32>,
    backfaceRejectedPixels: atomic<u32>,
    historyAcceptedPixels: atomic<u32>,
    historyRejectedPixels: atomic<u32>,
};
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read_write> tileMask: TileMask;
@group(0) @binding(2) var<storage, read_write> diagnostics: TraceDiagnostics;
@group(0) @binding(3) var sceneDepth: texture_depth_2d;
@group(0) @binding(4) var materialAttributes: texture_2d<f32>;
@group(0) @binding(5) var reflectionResponse: texture_2d<f32>;
@group(0) @binding(6) var traceExtent: texture_2d<f32>;
var<workgroup> eligibility: array<u32, ${String(TRACE_WORKGROUP_SIZE * TRACE_WORKGROUP_SIZE)}>;
fn pixelFor(source: texture_2d<f32>, uv: vec2<f32>) -> vec2<i32> {
    let dimensions = textureDimensions(source);
    return clamp(
        vec2<i32>(uv * vec2<f32>(dimensions)),
        vec2<i32>(0),
        vec2<i32>(dimensions) - vec2<i32>(1)
    );
}
fn depthPixelFor(source: texture_depth_2d, uv: vec2<f32>) -> vec2<i32> {
    let dimensions = textureDimensions(source);
    return clamp(
        vec2<i32>(uv * vec2<f32>(dimensions)),
        vec2<i32>(0),
        vec2<i32>(dimensions) - vec2<i32>(1)
    );
}
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(
    @builtin(global_invocation_id) id: vec3<u32>,
    @builtin(local_invocation_index) localIndex: u32,
    @builtin(workgroup_id) groupId: vec3<u32>
) {
    let outputSize = textureDimensions(traceExtent);
    eligibility[localIndex] = 0u;
    if (all(id.xy < outputSize)) {
        let uv = clamp(
            (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize),
            vec2<f32>(0.0),
            vec2<f32>(1.0)
        );
        let depthPixel = depthPixelFor(sceneDepth, uv);
        let deviceDepth = textureLoad(sceneDepth, depthPixel, 0);
        let background = select(
            deviceDepth >= 0.999999,
            deviceDepth <= 0.000001,
            frameData.depth.w > 0.5
        );
        let attributes = textureLoad(
            materialAttributes,
            pixelFor(materialAttributes, uv),
            0
        );
        let packedMaterial = u32(clamp(round(attributes.w * 255.0), 0.0, 255.0));
        let response = max(
            textureLoad(reflectionResponse, pixelFor(reflectionResponse, uv), 0).rgb,
            vec3<f32>(0.0)
        );
        let eligible = !background &&
            (packedMaterial & 1u) != 0u &&
            attributes.z < ${String(settings.roughnessCutoff)} &&
            max(max(response.r, response.g), response.b) >= ${String(MIN_REFLECTION_RESPONSE)};
        eligibility[localIndex] = select(0u, 1u, eligible);
    }
    workgroupBarrier();
    if (localIndex == 0u) {
        var activePixels = 0u;
        for (var index = 0u; index < ${String(
            TRACE_WORKGROUP_SIZE * TRACE_WORKGROUP_SIZE
        )}u; index += 1u) {
            activePixels += eligibility[index];
        }
        let tileCountX = (outputSize.x + ${String(TRACE_WORKGROUP_SIZE - 1)}u) /
            ${String(TRACE_WORKGROUP_SIZE)}u;
        let tileIndex = groupId.y * tileCountX + groupId.x;
        tileMask.values[tileIndex] = select(0u, 1u, activePixels != 0u);
        if (activePixels != 0u) { atomicAdd(&diagnostics.activePixels, activePixels); }
    }
}`,
            workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
            bindings: [
                { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
                {
                    name: 'tileMask',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'write-discard'
                },
                {
                    name: 'diagnostics',
                    group: 0,
                    binding: 2,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'sceneDepth',
                    group: 0,
                    binding: 3,
                    kind: 'sampled-texture',
                    sampleType: 'depth'
                },
                {
                    name: 'materialAttributes',
                    group: 0,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'reflectionResponse',
                    group: 0,
                    binding: 5,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'traceExtent',
                    group: 0,
                    binding: 6,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                }
            ]
        })
    );
}

const TILE_COMPACTION_PASS = computePass(
    new ComputeShader({
        label: 'Screen-space reflections coherent tile compaction',
        source: `
struct DispatchArguments {
    x: atomic<u32>,
    y: atomic<u32>,
    z: atomic<u32>,
};
struct TileMask { values: array<u32> };
struct TileList { values: array<u32> };
struct TraceDiagnostics {
    activeTiles: atomic<u32>,
    activePixels: atomic<u32>,
    hitPixels: atomic<u32>,
    missPixels: atomic<u32>,
    uncertainPixels: atomic<u32>,
    backfaceRejectedPixels: atomic<u32>,
    historyAcceptedPixels: atomic<u32>,
    historyRejectedPixels: atomic<u32>,
};
@group(0) @binding(0) var<storage, read_write> dispatchArguments: DispatchArguments;
@group(0) @binding(1) var<storage, read> tileMask: TileMask;
@group(0) @binding(2) var<storage, read_write> tileList: TileList;
@group(0) @binding(3) var<storage, read_write> diagnostics: TraceDiagnostics;
@group(0) @binding(4) var traceExtent: texture_2d<f32>;
var<workgroup> prefix: array<u32, 64>;
var<workgroup> groupBase: u32;
@compute @workgroup_size(64)
fn main(
    @builtin(global_invocation_id) id: vec3<u32>,
    @builtin(local_invocation_index) localIndex: u32,
    @builtin(workgroup_id) groupId: vec3<u32>
) {
    let outputSize = textureDimensions(traceExtent);
    let tileCount = vec2<u32>(
        (outputSize.x + ${String(TRACE_WORKGROUP_SIZE - 1)}u) /
            ${String(TRACE_WORKGROUP_SIZE)}u,
        (outputSize.y + ${String(TRACE_WORKGROUP_SIZE - 1)}u) /
            ${String(TRACE_WORKGROUP_SIZE)}u
    );
    let totalTiles = tileCount.x * tileCount.y;
    var tileIsActive = 0u;
    if (id.x < totalTiles) { tileIsActive = tileMask.values[id.x]; }
    prefix[localIndex] = tileIsActive;
    workgroupBarrier();
    var offset = 1u;
    while (offset < 64u) {
        var value = 0u;
        if (localIndex >= offset) { value = prefix[localIndex - offset]; }
        workgroupBarrier();
        prefix[localIndex] += value;
        workgroupBarrier();
        offset *= 2u;
    }
    let groupCount = prefix[63u];
    if (localIndex == 0u) {
        groupBase = atomicAdd(&dispatchArguments.x, groupCount);
        atomicAdd(&diagnostics.activeTiles, groupCount);
    }
    workgroupBarrier();
    if (tileIsActive != 0u) {
        let tileIndex = id.x;
        let tile = vec2<u32>(tileIndex % tileCount.x, tileIndex / tileCount.x);
        tileList.values[groupBase + prefix[localIndex] - 1u] =
            (tile.y << 16u) | tile.x;
    }
}`,
        workgroupSize: [64],
        bindings: [
            {
                name: 'dispatchArguments',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'tileMask',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer'
            },
            {
                name: 'tileList',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'diagnostics',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'traceExtent',
                group: 0,
                binding: 4,
                kind: 'sampled-texture',
                sampleType: 'float'
            }
        ]
    })
);

const TILE_DISPATCH_FINALIZE_PASS = computePass(
    new ComputeShader({
        label: 'Screen-space reflections finalize indirect tile dispatch',
        source: `
struct DispatchArguments {
    x: atomic<u32>,
    y: atomic<u32>,
    z: atomic<u32>,
};
struct TraceDiagnostics {
    activeTiles: atomic<u32>,
    activePixels: atomic<u32>,
    hitPixels: atomic<u32>,
    missPixels: atomic<u32>,
    uncertainPixels: atomic<u32>,
    backfaceRejectedPixels: atomic<u32>,
    historyAcceptedPixels: atomic<u32>,
    historyRejectedPixels: atomic<u32>,
};
@group(0) @binding(0) var<storage, read_write> dispatchArguments: DispatchArguments;
@group(0) @binding(1) var<storage, read_write> diagnostics: TraceDiagnostics;
@compute @workgroup_size(1)
fn main() {
    let activeTileCount = atomicLoad(&diagnostics.activeTiles);
    atomicStore(
        &dispatchArguments.x,
        min(activeTileCount, ${String(MAX_INDIRECT_DISPATCH_X)}u)
    );
    atomicStore(
        &dispatchArguments.y,
        max(
            1u,
            (activeTileCount + ${String(MAX_INDIRECT_DISPATCH_X - 1)}u) /
                ${String(MAX_INDIRECT_DISPATCH_X)}u
        )
    );
    atomicStore(&dispatchArguments.z, 1u);
}`,
        workgroupSize: [1],
        bindings: [
            {
                name: 'dispatchArguments',
                group: 0,
                binding: 0,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'diagnostics',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'read-write'
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
            `@group(0) @binding(${String(3 + index)}) var sceneColor${String(index)}: texture_2d<f32>;`
    ).join('\n');
    const depthBinding = 3 + COLOR_PYRAMID_LEVELS;
    const attributesBinding = depthBinding + 1;
    const responseBinding = attributesBinding + 1;
    const motionBinding = responseBinding + 1;
    const hiZBinding = motionBinding + 1;
    const hiZDeclarations = Array.from(
        { length: hiZLevelCount },
        (_unused, index) =>
            `@group(0) @binding(${String(hiZBinding + index)}) var hiZ${String(index)}: texture_2d<f32>;`
    ).join('\n');
    const samplerBinding = hiZBinding + hiZLevelCount;
    const outputBinding = samplerBinding + 1;
    const hitOutputBinding = outputBinding + 1;
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
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'tileList', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        {
            name: 'diagnostics',
            group: 0,
            binding: 2,
            kind: 'storage-buffer',
            access: 'read-write'
        }
    ];
    for (let index = 0; index < COLOR_PYRAMID_LEVELS; index += 1) {
        bindings.push({
            name: `sceneColor${String(index)}`,
            group: 0,
            binding: 3 + index,
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
    bindings.push({
        name: 'reflectionResponse',
        group: 0,
        binding: responseBinding,
        kind: 'sampled-texture',
        sampleType: 'float'
    });
    bindings.push({
        name: 'motionDepth',
        group: 0,
        binding: motionBinding,
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
    bindings.push({
        name: 'hitOutput',
        group: 0,
        binding: hitOutputBinding,
        kind: 'storage-texture',
        access: 'write-only',
        format: 'rgba16float'
    });
    return new ComputeShader({
        label: 'Hierarchical screen-space reflection trace',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
struct TileList { values: array<u32> };
struct TraceDiagnostics {
    activeTiles: atomic<u32>,
    activePixels: atomic<u32>,
    hitPixels: atomic<u32>,
    missPixels: atomic<u32>,
    uncertainPixels: atomic<u32>,
    backfaceRejectedPixels: atomic<u32>,
    historyAcceptedPixels: atomic<u32>,
    historyRejectedPixels: atomic<u32>,
};
@group(0) @binding(1) var<storage, read> tileList: TileList;
@group(0) @binding(2) var<storage, read_write> diagnostics: TraceDiagnostics;
${colorDeclarations}
@group(0) @binding(${String(depthBinding)}) var sceneDepth: texture_depth_2d;
@group(0) @binding(${String(attributesBinding)}) var materialAttributes: texture_2d<f32>;
@group(0) @binding(${String(responseBinding)}) var reflectionResponse: texture_2d<f32>;
@group(0) @binding(${String(motionBinding)}) var motionDepth: texture_2d<f32>;
${hiZDeclarations}
@group(0) @binding(${String(samplerBinding)}) var linearSampler: sampler;
@group(0) @binding(${String(outputBinding)}) var reflectionOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(${String(hitOutputBinding)}) var hitOutput: texture_storage_2d<rgba16float, write>;

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
    let encodedSigned = encoded * 2.0 - vec2<f32>(1.0);
    var normal = vec3<f32>(
        encodedSigned,
        1.0 - abs(encodedSigned.x) - abs(encodedSigned.y)
    );
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
fn isBackgroundDepth(deviceDepth: f32) -> bool {
    return select(
        deviceDepth >= 0.999999,
        deviceDepth <= 0.000001,
        frameData.depth.w > 0.5
    );
}
fn random2(pixel: vec2<u32>, sampleIndex: u32, phase: u32) -> vec2<f32> {
    var scramble = pixel.x * 1973u + pixel.y * 9277u + 911u;
    scramble ^= scramble >> 16u;
    scramble *= 2246822519u;
    scramble ^= scramble >> 13u;
    scramble *= 3266489917u;
    scramble ^= scramble >> 16u;
    let temporalIndex = phase & ${String(TEMPORAL_SEQUENCE_LENGTH - 1)}u;
    var reversed = sampleIndex;
    reversed = (reversed << 16u) | (reversed >> 16u);
    reversed = ((reversed & 1431655765u) << 1u) | ((reversed & 2863311530u) >> 1u);
    reversed = ((reversed & 858993459u) << 2u) | ((reversed & 3435973836u) >> 2u);
    reversed = ((reversed & 252645135u) << 4u) | ((reversed & 4042322160u) >> 4u);
    reversed = ((reversed & 16711935u) << 8u) | ((reversed & 4278255360u) >> 8u);
    let pixelRotation = vec2<f32>(
        f32(scramble & 65535u),
        f32((scramble >> 16u) & 65535u)
    ) / 65536.0;
    let temporalRotation = f32(temporalIndex) * vec2<f32>(
        0.7548776662466927,
        0.5698402909980532
    );
    let hammersley = vec2<f32>(
        (f32(sampleIndex) + 0.5) / ${String(STOCHASTIC_RAY_COUNT)}.0,
        f32(reversed ^ scramble) * 2.3283064365386963e-10
    );
    return fract(hammersley + pixelRotation + temporalRotation);
}
fn sampleVisibleGGX(
    surfaceNormal: vec3<f32>,
    viewDirection: vec3<f32>,
    roughness: f32,
    random: vec2<f32>
) -> vec3<f32> {
    let helper = select(
        vec3<f32>(0.0, 1.0, 0.0),
        vec3<f32>(0.0, 0.0, 1.0),
        abs(surfaceNormal.z) < 0.999
    );
    let tangent = normalize(cross(helper, surfaceNormal));
    let bitangent = cross(surfaceNormal, tangent);
    let localView = vec3<f32>(
        dot(viewDirection, tangent),
        dot(viewDirection, bitangent),
        max(dot(viewDirection, surfaceNormal), 1e-4)
    );
    let alpha = max(roughness * roughness, 0.002);
    let stretchedView = normalize(vec3<f32>(
        alpha * localView.x,
        alpha * localView.y,
        localView.z
    ));
    let lensq = dot(stretchedView.xy, stretchedView.xy);
    var basisX = vec3<f32>(1.0, 0.0, 0.0);
    if (lensq > 1e-7) {
        basisX = vec3<f32>(-stretchedView.y, stretchedView.x, 0.0) / sqrt(lensq);
    }
    let basisY = cross(stretchedView, basisX);
    let radius = sqrt(random.x);
    let phi = 6.28318530718 * random.y;
    let diskX = radius * cos(phi);
    var diskY = radius * sin(phi);
    let blend = 0.5 * (1.0 + stretchedView.z);
    diskY = mix(sqrt(max(0.0, 1.0 - diskX * diskX)), diskY, blend);
    let projected = diskX * basisX + diskY * basisY +
        sqrt(max(0.0, 1.0 - diskX * diskX - diskY * diskY)) * stretchedView;
    let localHalf = normalize(vec3<f32>(
        alpha * projected.x,
        alpha * projected.y,
        max(projected.z, 0.0)
    ));
    return normalize(
        tangent * localHalf.x + bitangent * localHalf.y + surfaceNormal * localHalf.z
    );
}
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(
    @builtin(workgroup_id) groupId: vec3<u32>,
    @builtin(local_invocation_id) localId: vec3<u32>
) {
    let compactIndex = groupId.y * ${String(MAX_INDIRECT_DISPATCH_X)}u + groupId.x;
    if (compactIndex >= atomicLoad(&diagnostics.activeTiles)) { return; }
    let packedTile = tileList.values[compactIndex];
    let tile = vec2<u32>(packedTile & 65535u, packedTile >> 16u);
    let id = vec3<u32>(tile * ${String(TRACE_WORKGROUP_SIZE)}u + localId.xy, 0u);
    let outputSize = textureDimensions(reflectionOutput);
    if (any(id.xy >= outputSize)) { return; }
    let depthSize = textureDimensions(sceneDepth);
    let uv = clamp(
        (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize),
        vec2<f32>(0.0),
        vec2<f32>(1.0)
    );
    let depthPixel = clamp(vec2<i32>(uv * vec2<f32>(depthSize)), vec2<i32>(0), vec2<i32>(depthSize) - vec2<i32>(1));
    let deviceDepth = textureLoad(sceneDepth, depthPixel, 0);
    let attributes = textureLoad(materialAttributes, pixelFor(materialAttributes, uv), 0);
    let packedMaterial = u32(clamp(round(attributes.w * 255.0), 0.0, 255.0));
    let receivesReflection = (packedMaterial & 1u) != 0u;
    let roughness = clamp(attributes.z, 0.045, 1.0);
    let surfaceResponse = max(
        textureLoad(reflectionResponse, pixelFor(reflectionResponse, uv), 0).rgb,
        vec3<f32>(0.0)
    );
    let responseEnergy = max(max(surfaceResponse.r, surfaceResponse.g), surfaceResponse.b);
    if (
        isBackgroundDepth(deviceDepth) || !receivesReflection ||
        roughness >= ${String(settings.roughnessCutoff)} ||
        responseEnergy < ${String(MIN_REFLECTION_RESPONSE)}
    ) { return; }

    let surfacePosition = reconstructViewPosition(uv, deviceDepth);
    let normal = decodeOctahedralNormal(attributes.xy);
    let incident = normalize(surfacePosition);
    let viewDirection = -incident;
    let mirrorDirection = normalize(reflect(incident, normal));
    let originBias = max(${String(settings.thickness)} * 0.15, -surfacePosition.z * 0.0005);
    let origin = surfacePosition + normal * originBias;
    let minimumStep = max(${String(settings.stride)}, -origin.z * 0.002);
    let startDistance = minimumStep;
    let roughnessRatio = clamp(roughness / ${String(settings.roughnessCutoff)}, 0.0, 1.0);
    let maximumDistance = mix(
        ${String(settings.maxRayDistance)},
        ${String(settings.maxRayDistance * 0.25)},
        smoothstep(0.2, 1.0, roughnessRatio)
    );
    let maximumIterations = u32(max(
        8.0,
        floor(
            ${String(settings.maxSteps)}.0 * mix(1.0, 0.35, roughnessRatio) *
                select(1.0, 0.55, roughness > ${String(DETERMINISTIC_REFLECTION_ROUGHNESS)})
        )
    ));
    let rayCount = select(
        1u,
        ${String(STOCHASTIC_RAY_COUNT)}u,
        roughness > ${String(DETERMINISTIC_REFLECTION_ROUGHNESS)}
    );
    var accumulatedRadiance = vec3<f32>(0.0);
    var accumulatedConfidence = 0.0;
    var bestConfidence = 0.0;
    var bestHitMotion = vec4<f32>(0.0);
    var validRayCount = 0u;
    var anyUncertain = false;
    var anyBackfaceRejected = false;
    for (var sampleIndex = 0u; sampleIndex < ${String(STOCHASTIC_RAY_COUNT)}u; sampleIndex += 1u) {
        if (sampleIndex >= rayCount) { break; }
        var direction = mirrorDirection;
        if (rayCount > 1u) {
            let halfVector = sampleVisibleGGX(
                normal,
                viewDirection,
                roughness,
                random2(
                    id.xy,
                    sampleIndex,
                    u32(frameData.ambient.w)
                )
            );
            let stochasticDirection = normalize(reflect(incident, halfVector));
            if (dot(stochasticDirection, normal) > 1e-4) {
                direction = stochasticDirection;
            }
        }
        var distance = startDistance;
        var previousDistance = 0.0;
        var hasFrontSample = false;
        var level = 0u;
        var hitUv = vec2<f32>(-1.0);
        var hitDistance = 0.0;
        var uncertain = false;
        var backfaceRejected = false;
        for (var iteration = 0u; iteration < ${String(settings.maxSteps)}u; iteration += 1u) {
            if (iteration >= maximumIterations || distance > maximumDistance) { break; }
            let rayPoint = origin + direction * distance;
            let projected = projectViewPosition(rayPoint);
            if (
                projected.x <= 0.0 || projected.y <= 0.0 ||
                projected.x >= 1.0 || projected.y >= 1.0 ||
                projected.z < 0.0 || projected.z > 1.0
            ) { break; }
            let bounds = sampleHiZ(level, projected.xy);
            if (rayIsInFront(projected.z, bounds)) {
                previousDistance = distance;
                hasFrontSample = true;
                distance += minimumStep * exp2(f32(level));
                level = min(level + 1u, ${String(lastHiZ)}u);
                continue;
            }
            if (level > 0u) {
                level -= 1u;
                distance = max(startDistance, mix(previousDistance, distance, 0.5));
                continue;
            }
            let exactPixel = clamp(
                vec2<i32>(projected.xy * vec2<f32>(depthSize)),
                vec2<i32>(0),
                vec2<i32>(depthSize) - vec2<i32>(1)
            );
            let exactDepth = textureLoad(sceneDepth, exactPixel, 0);
            if (isBackgroundDepth(exactDepth)) {
                uncertain = true;
                break;
            }
            let scenePosition = reconstructViewPosition(projected.xy, exactDepth);
            let penetration = (-rayPoint.z) - (-scenePosition.z);
            let grazingScale = 1.0 / max(abs(dot(normal, direction)), 0.25);
            let thickness = ${String(settings.thickness)} *
                (1.0 + max(-rayPoint.z, 0.0) * 0.002) * min(grazingScale, 2.5);
            if (
                !rayIsBehind(projected.z, bounds) ||
                (penetration >= -thickness * 0.25 && penetration <= thickness)
            ) {
                if (penetration >= -thickness * 0.25 && penetration <= thickness) {
                    var refinedDistance = distance;
                    if (hasFrontSample && previousDistance < distance) {
                        let previousPoint = origin + direction * previousDistance;
                        let previousProjected = projectViewPosition(previousPoint);
                        let previousDepthPixel = clamp(
                            vec2<i32>(previousProjected.xy * vec2<f32>(depthSize)),
                            vec2<i32>(0),
                            vec2<i32>(depthSize) - vec2<i32>(1)
                        );
                        let previousDepth = textureLoad(sceneDepth, previousDepthPixel, 0);
                        if (!isBackgroundDepth(previousDepth)) {
                            let previousScene = reconstructViewPosition(
                                previousProjected.xy,
                                previousDepth
                            );
                            let previousPenetration =
                                (-previousPoint.z) - (-previousScene.z);
                            let denominator = previousPenetration - penetration;
                            if (abs(denominator) > 1e-5) {
                                refinedDistance = mix(
                                    previousDistance,
                                    distance,
                                    clamp(previousPenetration / denominator, 0.0, 1.0)
                                );
                            }
                        }
                    }
                    let refinedUv = projectViewPosition(
                        origin + direction * refinedDistance
                    ).xy;
                    let hitAttributes = textureLoad(
                        materialAttributes,
                        pixelFor(materialAttributes, refinedUv),
                        0
                    );
                    let hitNormal = decodeOctahedralNormal(hitAttributes.xy);
                    if (dot(hitNormal, direction) >= -0.01) {
                        backfaceRejected = true;
                        break;
                    }
                    hitUv = refinedUv;
                    hitDistance = refinedDistance;
                    break;
                }
            }
            if (penetration > thickness) {
                uncertain = true;
                break;
            }
            previousDistance = distance;
            distance += minimumStep;
        }
        anyUncertain = anyUncertain || uncertain;
        anyBackfaceRejected = anyBackfaceRejected || backfaceRejected;
        if (hitUv.x < 0.0) { continue; }
        let edgeDistance = min(
            min(hitUv.x, 1.0 - hitUv.x),
            min(hitUv.y, 1.0 - hitUv.y)
        );
        let edgeConfidence = smoothstep(0.0, ${String(settings.edgeFade)}, edgeDistance);
        let distanceConfidence = clamp(1.0 - hitDistance / maximumDistance, 0.0, 1.0);
        let roughnessConfidence = clamp(
            1.0 - roughness / ${String(settings.roughnessCutoff)},
            0.0,
            1.0
        );
        let coneLevel = min(
            u32(clamp(
                floor(
                    roughness * 6.0 +
                    log2(1.0 + hitDistance * roughness * 0.05)
                ),
                0.0,
                ${String(lastColor)}.0
            )),
            ${String(lastColor)}u
        );
        let confidence = edgeConfidence * distanceConfidence * roughnessConfidence;
        let hitMotion = textureLoad(motionDepth, pixelFor(motionDepth, hitUv), 0);
        accumulatedRadiance += sampleColor(coneLevel, hitUv) * surfaceResponse * confidence;
        accumulatedConfidence += confidence;
        validRayCount += 1u;
        if (confidence > bestConfidence) {
            bestConfidence = confidence;
            bestHitMotion = hitMotion;
        }
    }
    if (validRayCount == 0u) {
        if (anyBackfaceRejected) {
            atomicAdd(&diagnostics.backfaceRejectedPixels, 1u);
        } else if (anyUncertain) {
            atomicAdd(&diagnostics.uncertainPixels, 1u);
        }
        atomicAdd(&diagnostics.missPixels, 1u);
        return;
    }
    let inverseRayCount = 1.0 / f32(rayCount);
    textureStore(
        reflectionOutput,
        vec2<i32>(id.xy),
        vec4<f32>(
            accumulatedRadiance * inverseRayCount,
            accumulatedConfidence * inverseRayCount
        )
    );
    textureStore(
        hitOutput,
        vec2<i32>(id.xy),
        bestHitMotion
    );
    atomicAdd(&diagnostics.hitPixels, 1u);
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
@group(0) @binding(1) var currentHit: texture_2d<f32>;
@group(0) @binding(2) var motionDepth: texture_2d<f32>;
@group(0) @binding(3) var materialAttributes: texture_2d<f32>;
@group(0) @binding(4) var reflectionResponse: texture_2d<f32>;
@group(0) @binding(5) var historyOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var depthOutput: texture_storage_2d<r32float, write>;
@group(0) @binding(7) var stateOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var responseStateOutput: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(historyOutput);
    if (any(id.xy >= outputSize)) { return; }
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let reflectionSize = textureDimensions(currentReflection);
    let reflectionPixel = clamp(vec2<i32>(uv * vec2<f32>(reflectionSize)), vec2<i32>(0), vec2<i32>(reflectionSize) - vec2<i32>(1));
    let hitSize = textureDimensions(currentHit);
    let hitPixel = clamp(vec2<i32>(uv * vec2<f32>(hitSize)), vec2<i32>(0), vec2<i32>(hitSize) - vec2<i32>(1));
    let motionSize = textureDimensions(motionDepth);
    let motionPixel = clamp(vec2<i32>(uv * vec2<f32>(motionSize)), vec2<i32>(0), vec2<i32>(motionSize) - vec2<i32>(1));
    var current = textureLoad(currentReflection, reflectionPixel, 0);
    let hit = textureLoad(currentHit, hitPixel, 0);
    let attributesSize = textureDimensions(materialAttributes);
    let attributesPixel = clamp(
        vec2<i32>(uv * vec2<f32>(attributesSize)),
        vec2<i32>(0),
        vec2<i32>(attributesSize) - vec2<i32>(1)
    );
    let attributes = textureLoad(materialAttributes, attributesPixel, 0);
    current.a = select(0.0, 1.0 + min(current.a, 0.999) * 0.5, current.a > 0.0);
    textureStore(historyOutput, vec2<i32>(id.xy), current);
    textureStore(
        depthOutput,
        vec2<i32>(id.xy),
        vec4<f32>(textureLoad(motionDepth, motionPixel, 0).w)
    );
    textureStore(
        stateOutput,
        vec2<i32>(id.xy),
        vec4<f32>(attributes.xy, attributes.z, hit.w)
    );
    let responseSize = textureDimensions(reflectionResponse);
    let responsePixel = clamp(
        vec2<i32>(uv * vec2<f32>(responseSize)),
        vec2<i32>(0),
        vec2<i32>(responseSize) - vec2<i32>(1)
    );
    textureStore(
        responseStateOutput,
        vec2<i32>(id.xy),
        vec4<f32>(max(textureLoad(reflectionResponse, responsePixel, 0).rgb, vec3<f32>(0.0)), attributes.w)
    );
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
                name: 'currentHit',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'motionDepth',
                group: 0,
                binding: 2,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'materialAttributes',
                group: 0,
                binding: 3,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
            {
                name: 'reflectionResponse',
                group: 0,
                binding: 4,
                kind: 'sampled-texture',
                sampleType: 'float'
            },
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
            },
            {
                name: 'stateOutput',
                group: 0,
                binding: 7,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'responseStateOutput',
                group: 0,
                binding: 8,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const TEMPORAL_HISTORY_RESET_PASS = computePass(
    new ComputeShader({
        label: 'Screen-space reflections clear temporal history targets',
        source: `
@group(0) @binding(0) var historyOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var depthOutput: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var stateOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var responseStateOutput: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(historyOutput);
    if (any(id.xy >= outputSize)) { return; }
    let pixel = vec2<i32>(id.xy);
    textureStore(historyOutput, pixel, vec4<f32>(0.0));
    textureStore(depthOutput, pixel, vec4<f32>(0.0));
    textureStore(stateOutput, pixel, vec4<f32>(0.0));
    textureStore(responseStateOutput, pixel, vec4<f32>(0.0));
}`,
        workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
        bindings: [
            {
                name: 'historyOutput',
                group: 0,
                binding: 0,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'depthOutput',
                group: 0,
                binding: 1,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'r32float'
            },
            {
                name: 'stateOutput',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            },
            {
                name: 'responseStateOutput',
                group: 0,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
            }
        ]
    })
);

const SPATIAL_FILTER_RESET_PASS = computePass(
    new ComputeShader({
        label: 'Screen-space reflections clear adaptive filter target',
        source: `
@group(0) @binding(0) var destination: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    textureStore(destination, vec2<i32>(id.xy), vec4<f32>(0.0));
}`,
        workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
        bindings: [
            {
                name: 'destination',
                group: 0,
                binding: 0,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float'
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
struct TraceDiagnostics {
    activeTiles: atomic<u32>,
    activePixels: atomic<u32>,
    hitPixels: atomic<u32>,
    missPixels: atomic<u32>,
    uncertainPixels: atomic<u32>,
    backfaceRejectedPixels: atomic<u32>,
    historyAcceptedPixels: atomic<u32>,
    historyRejectedPixels: atomic<u32>,
};
@group(0) @binding(0) var<storage, read_write> diagnostics: TraceDiagnostics;
struct TileList { values: array<u32> };
@group(0) @binding(1) var<storage, read> tileList: TileList;
@group(0) @binding(2) var currentReflection: texture_2d<f32>;
@group(0) @binding(3) var currentHit: texture_2d<f32>;
@group(0) @binding(4) var motionDepth: texture_2d<f32>;
@group(0) @binding(5) var materialAttributes: texture_2d<f32>;
@group(0) @binding(6) var reactiveMask: texture_2d<f32>;
@group(0) @binding(7) var currentResponse: texture_2d<f32>;
@group(0) @binding(8) var previousHistory: texture_2d<f32>;
@group(0) @binding(9) var previousDepth: texture_2d<f32>;
@group(0) @binding(10) var previousState: texture_2d<f32>;
@group(0) @binding(11) var previousResponseState: texture_2d<f32>;
@group(0) @binding(12) var linearSampler: sampler;
@group(0) @binding(13) var historyOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(14) var depthOutput: texture_storage_2d<r32float, write>;
@group(0) @binding(15) var stateOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(16) var responseStateOutput: texture_storage_2d<rgba16float, write>;
fn pixelFor(source: texture_2d<f32>, uv: vec2<f32>) -> vec2<i32> {
    let dimensions = textureDimensions(source);
    return clamp(
        vec2<i32>(uv * vec2<f32>(dimensions)),
        vec2<i32>(0),
        vec2<i32>(dimensions) - vec2<i32>(1)
    );
}
fn decodeOctahedralNormal(encoded: vec2<f32>) -> vec3<f32> {
    let encodedSigned = encoded * 2.0 - vec2<f32>(1.0);
    var normal = vec3<f32>(
        encodedSigned,
        1.0 - abs(encodedSigned.x) - abs(encodedSigned.y)
    );
    if (normal.z < 0.0) {
        let original = normal.xy;
        normal.x = (1.0 - abs(original.y)) * select(-1.0, 1.0, original.x >= 0.0);
        normal.y = (1.0 - abs(original.x)) * select(-1.0, 1.0, original.y >= 0.0);
    }
    return normalize(normal);
}
fn relativeDepthError(historyLogDepth: f32, expectedLogDepth: f32) -> f32 {
    let historyLinear = exp2(max(historyLogDepth, 0.0)) - 1.0;
    let expectedLinear = exp2(max(expectedLogDepth, 0.0)) - 1.0;
    return abs(historyLinear - expectedLinear) / max(expectedLinear, 0.001);
}
fn rgbToYCoCg(value: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        value.r * 0.25 + value.g * 0.5 + value.b * 0.25,
        value.r * 0.5 - value.b * 0.5,
        -value.r * 0.25 + value.g * 0.5 - value.b * 0.25
    );
}
fn yCoCgToRGB(value: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(value.x + value.y - value.z, value.x + value.z, value.x - value.y - value.z);
}
fn historySampleCount(packed: f32) -> f32 { return floor(max(packed, 0.0)); }
fn historyConfidence(packed: f32) -> f32 {
    return clamp(fract(max(packed, 0.0)) * 2.0, 0.0, 1.0);
}
fn packHistoryState(sampleCount: f32, confidence: f32) -> f32 {
    return min(sampleCount, ${String(MAX_HISTORY_SAMPLE_COUNT)}.0) +
        min(confidence, 0.999) * 0.5;
}
fn materialContinuity(currentPacked: f32, previousPacked: f32) -> f32 {
    let currentBits = u32(clamp(round(currentPacked * 255.0), 0.0, 255.0));
    let previousBits = u32(clamp(round(previousPacked * 255.0), 0.0, 255.0));
    return select(0.0, 1.0, currentBits == previousBits);
}
fn responseContinuity(current: vec3<f32>, previous: vec3<f32>) -> f32 {
    let scale = max(max(length(current), length(previous)), 0.05);
    return exp2(-length(current - previous) * 6.0 / scale);
}
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(
    @builtin(workgroup_id) groupId: vec3<u32>,
    @builtin(local_invocation_id) localId: vec3<u32>
) {
    let compactIndex = groupId.y * ${String(MAX_INDIRECT_DISPATCH_X)}u + groupId.x;
    if (compactIndex >= atomicLoad(&diagnostics.activeTiles)) { return; }
    let packedTile = tileList.values[compactIndex];
    let tile = vec2<u32>(packedTile & 65535u, packedTile >> 16u);
    let id = vec3<u32>(tile * ${String(TRACE_WORKGROUP_SIZE)}u + localId.xy, 0u);
    let outputSize = textureDimensions(historyOutput);
    if (any(id.xy >= outputSize)) { return; }
    let pixel = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let currentSize = textureDimensions(currentReflection);
    let currentPixel = clamp(vec2<i32>(uv * vec2<f32>(currentSize)), vec2<i32>(0), vec2<i32>(currentSize) - vec2<i32>(1));
    let current = textureLoad(currentReflection, currentPixel, 0);
    let currentHitValue = textureLoad(currentHit, pixelFor(currentHit, uv), 0);
    let motionSize = textureDimensions(motionDepth);
    let motionPixel = clamp(vec2<i32>(uv * vec2<f32>(motionSize)), vec2<i32>(0), vec2<i32>(motionSize) - vec2<i32>(1));
    let motion = textureLoad(motionDepth, motionPixel, 0);
    let currentAttributes = textureLoad(
        materialAttributes,
        pixelFor(materialAttributes, uv),
        0
    );
    let responseState = vec4<f32>(
        max(textureLoad(currentResponse, pixelFor(currentResponse, uv), 0).rgb, vec3<f32>(0.0)),
        currentAttributes.w
    );
    let packedMaterial = u32(clamp(round(currentAttributes.w * 255.0), 0.0, 255.0));
    let eligible = (packedMaterial & 1u) != 0u &&
        currentAttributes.z < ${String(settings.roughnessCutoff)};
    if (!eligible) {
        textureStore(historyOutput, pixel, vec4<f32>(0.0));
        textureStore(depthOutput, pixel, vec4<f32>(motion.w));
        textureStore(
            stateOutput,
            pixel,
            vec4<f32>(currentAttributes.xy, currentAttributes.z, 0.0)
        );
        textureStore(responseStateOutput, pixel, responseState);
        return;
    }
    let surfaceHistoryUv = uv - motion.xy;
    let hitHistoryUv = uv - currentHitValue.xy;
    let halfTexel = vec2<f32>(0.5) / vec2<f32>(outputSize);
    let surfaceInside = all(surfaceHistoryUv >= halfTexel) &&
        all(surfaceHistoryUv <= vec2<f32>(1.0) - halfTexel);
    let hitInside = all(hitHistoryUv >= halfTexel) &&
        all(hitHistoryUv <= vec2<f32>(1.0) - halfTexel);
    var neighborhoodSum = vec3<f32>(0.0);
    var neighborhoodSquaredSum = vec3<f32>(0.0);
    var neighborhoodWeight = 0.0;
    for (var y = -1; y <= 1; y += 1) {
        for (var x = -1; x <= 1; x += 1) {
            let coordinate = clamp(currentPixel + vec2<i32>(x, y), vec2<i32>(0), vec2<i32>(currentSize) - vec2<i32>(1));
            let sampleValue = textureLoad(currentReflection, coordinate, 0);
            if (sampleValue.a > 0.0) {
                let yCoCg = rgbToYCoCg(sampleValue.rgb);
                neighborhoodSum += yCoCg;
                neighborhoodSquaredSum += yCoCg * yCoCg;
                neighborhoodWeight += 1.0;
            }
        }
    }
    if (neighborhoodWeight < 0.5) {
        let fallback = rgbToYCoCg(current.rgb);
        neighborhoodSum = fallback;
        neighborhoodSquaredSum = fallback * fallback;
        neighborhoodWeight = 1.0;
    }
    let neighborhoodCenter = neighborhoodSum / neighborhoodWeight;
    let neighborhoodVariance = max(
        neighborhoodSquaredSum / neighborhoodWeight - neighborhoodCenter * neighborhoodCenter,
        vec3<f32>(0.0)
    );
    let denoiseStrength = smoothstep(
        0.0,
        1.0,
        clamp(
            (currentAttributes.z - ${String(DETERMINISTIC_REFLECTION_ROUGHNESS)}) /
                max(
                    ${String(Math.min(settings.roughnessCutoff, 0.16))} -
                        ${String(DETERMINISTIC_REFLECTION_ROUGHNESS)},
                    0.01
                ),
            0.0,
            1.0
        )
    );
    let neighborhoodExtent = max(
        sqrt(neighborhoodVariance) * mix(1.5, 2.5, denoiseStrength),
        vec3<f32>(0.0125)
    );
    var stableCurrent = current.rgb;
    if (current.a > 0.0 && neighborhoodWeight >= 3.0 && denoiseStrength > 0.0) {
        let currentYCoCg = rgbToYCoCg(current.rgb);
        let luminanceSigma = sqrt(neighborhoodVariance.x);
        let fireflyCeiling = neighborhoodCenter.x + max(
            0.025,
            luminanceSigma * mix(3.0, 1.5, denoiseStrength)
        );
        if (currentYCoCg.x > fireflyCeiling) {
            stableCurrent *= fireflyCeiling / max(currentYCoCg.x, 1e-5);
        }
    }
    let currentNormal = decodeOctahedralNormal(currentAttributes.xy);
    let reactive = textureLoad(reactiveMask, pixelFor(reactiveMask, uv), 0).r;

    var surfaceHistory = vec4<f32>(0.0);
    var surfaceScore = 0.0;
    if (surfaceInside && motion.z >= 0.0) {
        surfaceHistory = textureSampleLevel(
            previousHistory,
            linearSampler,
            surfaceHistoryUv,
            0.0
        );
        let surfaceState = textureLoad(
            previousState,
            pixelFor(previousState, surfaceHistoryUv),
            0
        );
        let surfaceResponseState = textureLoad(
            previousResponseState,
            pixelFor(previousResponseState, surfaceHistoryUv),
            0
        );
        let depthError = relativeDepthError(
            textureLoad(previousDepth, pixelFor(previousDepth, surfaceHistoryUv), 0).x,
            motion.z
        );
        let normalWeight = smoothstep(
            0.82,
            0.98,
            dot(currentNormal, decodeOctahedralNormal(surfaceState.xy))
        );
        let roughnessWeight = exp2(
            -abs(currentAttributes.z - surfaceState.z) * 24.0
        );
        let surfaceMaterialWeight = materialContinuity(
            currentAttributes.w,
            surfaceResponseState.w
        );
        let surfaceResponseWeight = responseContinuity(
            responseState.rgb,
            surfaceResponseState.rgb
        );
        if (
            depthError <= ${String(settings.depthThreshold)} &&
            historyConfidence(surfaceHistory.a) > 0.0
        ) {
            surfaceScore = normalWeight * roughnessWeight *
                surfaceMaterialWeight * surfaceResponseWeight;
        }
    }

    var hitHistory = vec4<f32>(0.0);
    var hitScore = 0.0;
    let dominantDirection = 1.0 - smoothstep(0.08, 0.45, currentAttributes.z);
    if (
        current.a > 0.0 && currentHitValue.z >= 0.0 && hitInside &&
        dominantDirection > 0.0
    ) {
        hitHistory = textureSampleLevel(previousHistory, linearSampler, hitHistoryUv, 0.0);
        let hitState = textureLoad(
            previousState,
            pixelFor(previousState, hitHistoryUv),
            0
        );
        let hitResponseState = textureLoad(
            previousResponseState,
            pixelFor(previousResponseState, hitHistoryUv),
            0
        );
        let hitDepthError = relativeDepthError(hitState.w, currentHitValue.z);
        let hitNormalWeight = smoothstep(
            0.82,
            0.98,
            dot(currentNormal, decodeOctahedralNormal(hitState.xy))
        );
        let hitRoughnessWeight = exp2(
            -abs(currentAttributes.z - hitState.z) * 24.0
        );
        let hitMaterialWeight = materialContinuity(
            currentAttributes.w,
            hitResponseState.w
        );
        let hitResponseWeight = responseContinuity(
            responseState.rgb,
            hitResponseState.rgb
        );
        if (
            hitDepthError <= ${String(Math.max(settings.depthThreshold * 2, 0.01))} &&
            historyConfidence(hitHistory.a) > 0.0
        ) {
            hitScore = dominantDirection * hitNormalWeight * hitRoughnessWeight *
                hitMaterialWeight * hitResponseWeight;
        }
    }
    surfaceScore *= 1.0 - clamp(reactive, 0.0, 1.0);
    hitScore *= 1.0 - clamp(reactive, 0.0, 1.0);

    let surfaceYCoCg = rgbToYCoCg(surfaceHistory.rgb);
    let hitYCoCg = rgbToYCoCg(hitHistory.rgb);
    let surfaceError = select(
        1e9,
        length(surfaceYCoCg - neighborhoodCenter),
        surfaceScore > 0.01
    );
    let hitError = select(
        1e9,
        length(hitYCoCg - neighborhoodCenter),
        hitScore > 0.01
    );
    let useHitHistory = hitScore > 0.01 && hitError <= surfaceError + 0.01;
    var selectedHistory = surfaceHistory;
    var selectedScore = surfaceScore;
    if (useHitHistory) {
        selectedHistory = hitHistory;
        selectedScore = hitScore;
    }
    let historyAvailable = selectedScore > 0.01;
    let selectedYCoCg = clamp(
        rgbToYCoCg(selectedHistory.rgb),
        neighborhoodCenter - neighborhoodExtent,
        neighborhoodCenter + neighborhoodExtent
    );
    let clampedHistory = max(yCoCgToRGB(selectedYCoCg), vec3<f32>(0.0));
    let previousCount = historySampleCount(selectedHistory.a);
    let previousConfidence = historyConfidence(selectedHistory.a);
    let maxFrames = mix(
        4.0,
        24.0,
        denoiseStrength
    );
    let velocityPixels = length(motion.xy * vec2<f32>(motionSize));
    let motionResponse = clamp(velocityPixels / 24.0, 0.0, 1.0);
    var resolvedRadiance = stableCurrent;
    var resolvedConfidence = current.a;
    var resolvedCount = select(0.0, 1.0, current.a > 0.0);
    if (historyAvailable) {
        atomicAdd(&diagnostics.historyAcceptedPixels, 1u);
        if (current.a > 0.0) {
            resolvedCount = min(previousCount * selectedScore + 1.0, maxFrames);
            let blend = min(
                ${String(settings.historyWeight)},
                max(0.0, 1.0 - 1.0 / max(resolvedCount, 1.0))
            ) * selectedScore * (1.0 - motionResponse * 0.65);
            resolvedRadiance = mix(stableCurrent, clampedHistory, blend);
            resolvedConfidence = max(current.a, previousConfidence * blend);
        } else {
            resolvedCount = max(previousCount * selectedScore - 0.25, 1.0);
            resolvedRadiance = clampedHistory;
            resolvedConfidence = previousConfidence * min(selectedScore, 0.82);
        }
    } else {
        atomicAdd(&diagnostics.historyRejectedPixels, 1u);
    }
    textureStore(
        historyOutput,
        pixel,
        vec4<f32>(
            resolvedRadiance,
            packHistoryState(resolvedCount, resolvedConfidence)
        )
    );
    textureStore(depthOutput, pixel, vec4<f32>(motion.w));
    textureStore(
        stateOutput,
        pixel,
        vec4<f32>(currentAttributes.xy, currentAttributes.z, currentHitValue.w)
    );
    textureStore(responseStateOutput, pixel, responseState);
}`,
            workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
            bindings: [
                {
                    name: 'diagnostics',
                    group: 0,
                    binding: 0,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'tileList',
                    group: 0,
                    binding: 1,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'currentReflection',
                    group: 0,
                    binding: 2,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'currentHit',
                    group: 0,
                    binding: 3,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'motionDepth',
                    group: 0,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'materialAttributes',
                    group: 0,
                    binding: 5,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'reactiveMask',
                    group: 0,
                    binding: 6,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'currentResponse',
                    group: 0,
                    binding: 7,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'previousHistory',
                    group: 0,
                    binding: 8,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'previousDepth',
                    group: 0,
                    binding: 9,
                    kind: 'sampled-texture',
                    sampleType: 'unfilterable-float'
                },
                {
                    name: 'previousState',
                    group: 0,
                    binding: 10,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'previousResponseState',
                    group: 0,
                    binding: 11,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                { name: 'linearSampler', group: 0, binding: 12, kind: 'sampler' },
                {
                    name: 'historyOutput',
                    group: 0,
                    binding: 13,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                },
                {
                    name: 'depthOutput',
                    group: 0,
                    binding: 14,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'r32float'
                },
                {
                    name: 'stateOutput',
                    group: 0,
                    binding: 15,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                },
                {
                    name: 'responseStateOutput',
                    group: 0,
                    binding: 16,
                    kind: 'storage-texture',
                    access: 'write-only',
                    format: 'rgba16float'
                }
            ]
        })
    );
}

function spatialFilterPass(
    settings: Readonly<ScreenSpaceReflectionsSettings>,
    stage: 'reconstruction' | 'stability' | 'cleanup'
): ComputeRenderPass {
    const adaptiveRadius = stage === 'stability';
    const maximumRadius = stage === 'stability' ? 3 : 1;
    const minimumCenterWeight = stage === 'cleanup' ? 4 : stage === 'stability' ? 2 : 1;
    const maximumCenterWeight = stage === 'cleanup' ? 10 : stage === 'stability' ? 6 : 4;
    const taps = [
        [-1, -1, 1],
        [0, -1, 2],
        [1, -1, 1],
        [-1, 0, 2],
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
            pixel + vec2<i32>(${String(x)}, ${String(y)}) * filterRadius,
            vec2<i32>(0),
            vec2<i32>(outputSize) - vec2<i32>(1)
        );
        let neighbor = textureLoad(sourceReflection, neighborCoordinate, 0);
        let neighborConfidence = historyConfidence(neighbor.a);
        if (neighborConfidence > 0.0001) {
            let neighborUv = (vec2<f32>(neighborCoordinate) + vec2<f32>(0.5)) /
                vec2<f32>(outputSize);
            let neighborAttributes = textureLoad(
                materialAttributes,
                pixelFor(materialAttributes, neighborUv),
                0
            );
            let neighborResponseState = textureLoad(
                responseHistory,
                pixelFor(responseHistory, neighborUv),
                0
            );
            let neighborPacked = u32(clamp(round(neighborAttributes.w * 255.0), 0.0, 255.0));
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
                let materialWeight = select(0.0, 1.0, centerPacked == neighborPacked);
                let responseScale = max(
                    max(length(centerResponseState.rgb), length(neighborResponseState.rgb)),
                    0.05
                );
                let responseWeight = exp2(
                    -length(centerResponseState.rgb - neighborResponseState.rgb) *
                        6.0 / responseScale
                );
                let neighborHitDepth = textureLoad(
                    stateHistory,
                    pixelFor(stateHistory, neighborUv),
                    0
                ).w;
                let hitDepthContinuity = select(
                    0.45,
                    exp2(-abs(centerHitDepth - neighborHitDepth) * 4.0),
                    centerHitDepth > 0.0 && neighborHitDepth > 0.0
                );
                let hitDepthWeight = mix(
                    hitDepthContinuity,
                    1.0,
                    spatialDenoiseStrength * 0.85
                );
                let centerLuminance = dot(
                    center.rgb,
                    vec3<f32>(0.2126, 0.7152, 0.0722)
                );
                let neighborLuminance = dot(
                    neighbor.rgb,
                    vec3<f32>(0.2126, 0.7152, 0.0722)
                );
                let luminanceWeight = exp2(
                    -abs(neighborLuminance - centerLuminance) /
                        max(
                            0.05 + max(centerLuminance, neighborLuminance) *
                                mix(0.3, 0.8, spatialDenoiseStrength),
                            0.05
                        )
                );
                let confidenceWeight = clamp(0.25 + neighborConfidence, 0.0, 1.0);
                let weight = ${String(weight)}.0 * normalWeight * depthWeight *
                    roughnessWeight * materialWeight * responseWeight * hitDepthWeight *
                    luminanceWeight * confidenceWeight;
                accumulation += neighbor.rgb * weight;
                confidenceAccumulation += neighborConfidence * weight;
                totalWeight += weight;
            }
        }
    }`
        )
        .join('\n');
    return computePass(
        new ComputeShader({
            label:
                stage === 'reconstruction'
                    ? 'Screen-space reflections adaptive confidence filter'
                    : stage === 'stability'
                      ? 'Screen-space reflections variance-guided stability filter'
                      : 'Screen-space reflections residual coverage cleanup filter',
            source: `
struct TraceDiagnostics {
    activeTiles: atomic<u32>,
    activePixels: atomic<u32>,
    hitPixels: atomic<u32>,
    missPixels: atomic<u32>,
    uncertainPixels: atomic<u32>,
    backfaceRejectedPixels: atomic<u32>,
    historyAcceptedPixels: atomic<u32>,
    historyRejectedPixels: atomic<u32>,
};
struct TileList { values: array<u32> };
@group(0) @binding(0) var<storage, read_write> diagnostics: TraceDiagnostics;
@group(0) @binding(1) var<storage, read> tileList: TileList;
@group(0) @binding(2) var sourceReflection: texture_2d<f32>;
@group(0) @binding(3) var motionDepth: texture_2d<f32>;
@group(0) @binding(4) var materialAttributes: texture_2d<f32>;
@group(0) @binding(5) var stateHistory: texture_2d<f32>;
@group(0) @binding(6) var responseHistory: texture_2d<f32>;
@group(0) @binding(7) var destination: texture_storage_2d<rgba16float, write>;
fn pixelFor(source: texture_2d<f32>, uv: vec2<f32>) -> vec2<i32> {
    let dimensions = textureDimensions(source);
    return clamp(
        vec2<i32>(uv * vec2<f32>(dimensions)),
        vec2<i32>(0),
        vec2<i32>(dimensions) - vec2<i32>(1)
    );
}
fn decodeOctahedralNormal(encoded: vec2<f32>) -> vec3<f32> {
    let encodedSigned = encoded * 2.0 - vec2<f32>(1.0);
    var normal = vec3<f32>(
        encodedSigned,
        1.0 - abs(encodedSigned.x) - abs(encodedSigned.y)
    );
    if (normal.z < 0.0) {
        let original = normal.xy;
        normal.x = (1.0 - abs(original.y)) * select(-1.0, 1.0, original.x >= 0.0);
        normal.y = (1.0 - abs(original.x)) * select(-1.0, 1.0, original.y >= 0.0);
    }
    return normalize(normal);
}
fn historySampleCount(packed: f32) -> f32 { return floor(max(packed, 0.0)); }
fn historyConfidence(packed: f32) -> f32 {
    return clamp(fract(max(packed, 0.0)) * 2.0, 0.0, 1.0);
}
fn packHistoryState(sampleCount: f32, confidence: f32) -> f32 {
    return min(sampleCount, ${String(MAX_HISTORY_SAMPLE_COUNT)}.0) +
        min(confidence, 0.999) * 0.5;
}
@compute @workgroup_size(${String(TRACE_WORKGROUP_SIZE)}, ${String(TRACE_WORKGROUP_SIZE)})
fn main(
    @builtin(workgroup_id) groupId: vec3<u32>,
    @builtin(local_invocation_id) localId: vec3<u32>
) {
    let compactIndex = groupId.y * ${String(MAX_INDIRECT_DISPATCH_X)}u + groupId.x;
    if (compactIndex >= atomicLoad(&diagnostics.activeTiles)) { return; }
    let packedTile = tileList.values[compactIndex];
    let tile = vec2<u32>(packedTile & 65535u, packedTile >> 16u);
    let id = vec3<u32>(tile * ${String(TRACE_WORKGROUP_SIZE)}u + localId.xy, 0u);
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    let pixel = vec2<i32>(id.xy);
    let uv = (vec2<f32>(id.xy) + vec2<f32>(0.5)) / vec2<f32>(outputSize);
    let centerAttributes = textureLoad(
        materialAttributes,
        pixelFor(materialAttributes, uv),
        0
    );
    let centerPacked = u32(clamp(round(centerAttributes.w * 255.0), 0.0, 255.0));
    let centerResponseState = textureLoad(
        responseHistory,
        pixelFor(responseHistory, uv),
        0
    );
    if (
        (centerPacked & 1u) == 0u ||
        centerAttributes.z >= ${String(settings.roughnessCutoff)}
    ) {
        textureStore(destination, pixel, vec4<f32>(0.0));
        return;
    }
    let centerNormal = decodeOctahedralNormal(centerAttributes.xy);
    let centerLogDepth = textureLoad(motionDepth, pixelFor(motionDepth, uv), 0).w;
    let center = textureLoad(sourceReflection, pixel, 0);
    let centerConfidence = historyConfidence(center.a);
    if (centerAttributes.z <= 0.08 && centerConfidence > 0.0) {
        textureStore(destination, pixel, center);
        return;
    }
    let spatialDenoiseStrength = smoothstep(
        0.0,
        1.0,
        clamp(
            (centerAttributes.z - 0.08) /
                max(${String(Math.min(settings.roughnessCutoff, 0.2) - 0.08)}, 0.01),
            0.0,
            1.0
        )
    );
    let filterRadius = ${
        adaptiveRadius
            ? `i32(clamp(
        ceil(spatialDenoiseStrength * ${String(maximumRadius)}.0),
        1.0,
        ${String(maximumRadius)}.0
    ))`
            : '1'
    };
    let centerHitDepth = textureLoad(stateHistory, pixelFor(stateHistory, uv), 0).w;
    let historyMaturity = clamp(
        historySampleCount(center.a) / ${String(MAX_HISTORY_SAMPLE_COUNT)}.0,
        0.0,
        1.0
    );
    let centerWeight = mix(
        ${String(minimumCenterWeight)}.0,
        ${String(maximumCenterWeight)}.0,
        historyMaturity
    );
    var accumulation = center.rgb * centerConfidence * centerWeight;
    var confidenceAccumulation = centerConfidence * centerConfidence * centerWeight;
    var totalWeight = centerConfidence * centerWeight;
${tapSource}
    if (totalWeight > 0.0001) {
        textureStore(
            destination,
            pixel,
            vec4<f32>(
                accumulation / totalWeight,
                packHistoryState(
                    historySampleCount(center.a),
                    confidenceAccumulation / totalWeight
                )
            )
        );
    } else {
        textureStore(destination, pixel, vec4<f32>(0.0));
    }
}`,
            workgroupSize: [TRACE_WORKGROUP_SIZE, TRACE_WORKGROUP_SIZE],
            bindings: [
                {
                    name: 'diagnostics',
                    group: 0,
                    binding: 0,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'tileList',
                    group: 0,
                    binding: 1,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'sourceReflection',
                    group: 0,
                    binding: 2,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'motionDepth',
                    group: 0,
                    binding: 3,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'materialAttributes',
                    group: 0,
                    binding: 4,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'stateHistory',
                    group: 0,
                    binding: 5,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'responseHistory',
                    group: 0,
                    binding: 6,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'destination',
                    group: 0,
                    binding: 7,
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
uniform sampler2D u_reflection;
uniform sampler2D u_fallbackSpecular;
uniform sampler2D u_materialAttributes;
uniform sampler2D u_motionDepth;
layout(location=0) out vec4 color;
vec3 decodeOctahedralNormal(vec2 encoded) {
    encoded = encoded * 2.0 - 1.0;
    vec3 normal = vec3(encoded, 1.0 - abs(encoded.x) - abs(encoded.y));
    if (normal.z < 0.0) {
        vec2 original = normal.xy;
        normal.xy = (1.0 - abs(original.yx)) *
            vec2(original.x >= 0.0 ? 1.0 : -1.0, original.y >= 0.0 ? 1.0 : -1.0);
    }
    return normalize(normal);
}
float historyConfidence(float packed) {
    return clamp(fract(max(packed, 0.0)) * 2.0, 0.0, 1.0);
}
vec4 resolveReflection(vec2 uv) {
    ivec2 reflectionSize = textureSize(u_reflection, 0);
    ivec2 materialSize = textureSize(u_materialAttributes, 0);
    if (all(equal(reflectionSize, materialSize))) {
        vec4 resolved = texture(u_reflection, uv);
        resolved.a = historyConfidence(resolved.a);
        return resolved;
    }
    vec4 centerAttributes = texture(u_materialAttributes, uv);
    vec3 centerNormal = decodeOctahedralNormal(centerAttributes.xy);
    float centerLogDepth = texture(u_motionDepth, uv).w;
    vec2 reflectionCoordinate = uv * vec2(reflectionSize) - 0.5;
    ivec2 base = ivec2(floor(reflectionCoordinate));
    vec2 fraction = fract(reflectionCoordinate);
    vec3 radiance = vec3(0.0);
    float confidence = 0.0;
    float totalWeight = 0.0;
    for (int y = 0; y <= 1; y += 1) {
        for (int x = 0; x <= 1; x += 1) {
            ivec2 coordinate = clamp(
                base + ivec2(x, y),
                ivec2(0),
                reflectionSize - ivec2(1)
            );
            vec2 sampleUv = (vec2(coordinate) + 0.5) / vec2(reflectionSize);
            vec4 sampleValue = texelFetch(u_reflection, coordinate, 0);
            float sampleConfidence = historyConfidence(sampleValue.a);
            vec4 sampleAttributes = texture(u_materialAttributes, sampleUv);
            vec3 sampleNormal = decodeOctahedralNormal(sampleAttributes.xy);
            float sampleLogDepth = texture(u_motionDepth, sampleUv).w;
            vec2 bilinearAxis = vec2(
                x == 0 ? 1.0 - fraction.x : fraction.x,
                y == 0 ? 1.0 - fraction.y : fraction.y
            );
            float spatialWeight = bilinearAxis.x * bilinearAxis.y;
            float normalWeight = pow(max(dot(centerNormal, sampleNormal), 0.0), 32.0);
            float depthWeight = exp2(-abs(centerLogDepth - sampleLogDepth) * 32.0);
            float roughnessWeight = exp2(
                -abs(centerAttributes.z - sampleAttributes.z) * 20.0
            );
            float weight = spatialWeight * normalWeight * depthWeight * roughnessWeight;
            weight *= max(sampleConfidence, 1e-3);
            radiance += sampleValue.rgb * weight;
            confidence += sampleConfidence * weight;
            totalWeight += weight;
        }
    }
    if (totalWeight <= 1e-5) return vec4(0.0);
    return vec4(radiance / totalWeight, confidence / totalWeight);
}
void main() {
    vec4 reflection = resolveReflection(v_uv);
    vec3 fallbackSpecular = texture(u_fallbackSpecular, v_uv).rgb;
    float confidenceGate = smoothstep(0.08, 0.35, reflection.a);
    float replacementConfidence = reflection.a * confidenceGate;
    color = vec4(
        reflection.rgb * (${String(intensity)} * confidenceGate) -
            fallbackSpecular * replacementConfidence,
        0.0
    );
}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none',
            blend: {
                color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
                alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' }
            }
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
    dispatch: ComputeDispatch = { x: 1, y: 1, z: 1 };

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
        this.dispatch = { x, y, z: 1 };
    }

    setIndirectDispatch(buffer: RenderGraphBufferHandle): void {
        this.dispatch = { indirectBuffer: buffer, indirectOffset: 0 };
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
    /** View-dependent reflection response written by the material-attributes ABI. */
    readonly reflectionResponse: RenderGraphTextureHandle;
    /** Environment/probe specular already present in sceneColor and replaced on valid SSR hits. */
    readonly fallbackSpecular: RenderGraphTextureHandle;
    readonly motionDepth: RenderGraphTextureHandle;
    /** Authored and transparency-derived temporal rejection signal. */
    readonly reactiveMask: RenderGraphTextureHandle;
    /** Current internal scene resolution relative to the output. */
    readonly sceneScale: number;
    readonly hiZ: readonly RenderGraphTextureHandle[];
    /** False after camera cuts or other temporal discontinuities. */
    readonly historyValid: boolean;
}

/**
 * @internal WebGPU high-end hierarchical trace, temporal rejection, and HDR composite controller.
 */
export class ScreenSpaceReflectionsController {
    readonly #settings: Readonly<ScreenSpaceReflectionsSettings>;
    readonly #traceHiZLevelCount: number;
    readonly #tileClassificationPass: ComputeRenderPass;
    readonly #tracePass: ComputeRenderPass;
    readonly #temporalResolvePass: ComputeRenderPass;
    readonly #spatialReconstructionPass: ComputeRenderPass;
    readonly #spatialStabilityPass: ComputeRenderPass;
    readonly #spatialCleanupPass: ComputeRenderPass;
    readonly #compositePass: FullscreenRenderPass;
    readonly #colorHistoryKey = Object.freeze({});
    readonly #depthHistoryKey = Object.freeze({});
    readonly #stateHistoryKey = Object.freeze({});
    readonly #responseHistoryKey = Object.freeze({});
    readonly #diagnostics: StorageBuffer;
    readonly #colorPyramidDescriptors: readonly Readonly<RenderPipelineTextureDescriptor>[];
    readonly #colorPyramidExtents: readonly {
        readonly relativeTo: 'output';
        scale: number;
        readonly minWidth: 1;
        readonly minHeight: 1;
    }[];
    readonly #reflectionExtent: {
        readonly relativeTo: 'output';
        scale: number;
        readonly minWidth: 1;
        readonly minHeight: 1;
    };
    readonly #reflectionDescriptor: Readonly<RenderPipelineTextureDescriptor>;
    readonly #colorHistoryDescriptor: Readonly<RenderPipelineHistoryTextureDescriptor>;
    readonly #depthHistoryDescriptor: Readonly<RenderPipelineHistoryTextureDescriptor>;
    readonly #stateHistoryDescriptor: Readonly<RenderPipelineHistoryTextureDescriptor>;
    readonly #responseHistoryDescriptor: Readonly<RenderPipelineHistoryTextureDescriptor>;
    readonly #downsamplePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 2, 1)
    );
    readonly #tracePool: RenderPassParameterPool<MutableComputeParameters>;
    readonly #traceResetPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 2, 0)
    );
    readonly #classificationPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(3, 4, 0)
    );
    readonly #compactionPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(4, 1, 0)
    );
    readonly #dispatchFinalizePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 0, 0)
    );
    readonly #initializePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 9, 0)
    );
    readonly #historyResetPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 4, 0)
    );
    readonly #resolvePool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 14, 1)
    );
    readonly #filterResetPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(0, 1, 0)
    );
    readonly #spatialFilterPool = new RenderPassParameterPool(
        () => new MutableComputeParameters(2, 6, 0)
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
        context: RenderPipelineCreateContext,
        sceneScale: number,
        hiZLevelCount: number
    ) {
        this.#settings = settings;
        this.#traceHiZLevelCount = Math.min(hiZLevelCount, MAX_TRACE_HIZ_LEVELS);
        if (this.#traceHiZLevelCount < 1) {
            throw new RangeError('Screen-space reflections require at least one Hi-Z level');
        }
        this.#diagnostics = context.createStorageBuffer({
            label: 'Screen-space reflections diagnostics',
            byteLength: SSR_DIAGNOSTIC_BYTES,
            usage: ['storage', 'copy-source'],
            recovery: 'reinitialize'
        });
        this.#tileClassificationPass = tileClassificationPass(settings);
        this.#tracePass = computePass(traceShader(settings, this.#traceHiZLevelCount));
        this.#temporalResolvePass = temporalResolvePass(settings);
        this.#spatialReconstructionPass = spatialFilterPass(settings, 'reconstruction');
        this.#spatialStabilityPass = spatialFilterPass(settings, 'stability');
        this.#spatialCleanupPass = spatialFilterPass(settings, 'cleanup');
        this.#compositePass = compositePass(settings.intensity);
        this.#tracePool = new RenderPassParameterPool(
            () =>
                new MutableComputeParameters(
                    3,
                    COLOR_PYRAMID_LEVELS + 4 + this.#traceHiZLevelCount + 2,
                    1
                )
        );
        this.#colorPyramidExtents = Object.freeze(
            Array.from({ length: COLOR_PYRAMID_LEVELS - 1 }, (_unused, index) => ({
                relativeTo: 'output' as const,
                scale: sceneScale / 2 ** (index + 1),
                minWidth: 1 as const,
                minHeight: 1 as const
            }))
        );
        this.#colorPyramidDescriptors = Object.freeze(
            this.#colorPyramidExtents.map(extent =>
                Object.freeze({
                    format: 'rgba16float' as const,
                    extent
                })
            )
        );
        this.#reflectionExtent = {
            relativeTo: 'output',
            scale: sceneScale * settings.resolutionScale,
            minWidth: 1 as const,
            minHeight: 1 as const
        };
        const reflectionExtent: RenderPipelineExtent = this.#reflectionExtent;
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
        this.#stateHistoryDescriptor = Object.freeze({
            label: 'Screen-space reflections material and hit-depth history',
            format: 'rgba16float',
            extent: reflectionExtent,
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2
        });
        this.#responseHistoryDescriptor = Object.freeze({
            label: 'Screen-space reflections response and material history',
            format: 'rgba16float',
            extent: reflectionExtent,
            usage: Object.freeze(['sampled' as const, 'storage' as const]),
            bufferCount: 2
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
        for (let index = 0; index < this.#colorPyramidExtents.length; index += 1) {
            const extent = this.#colorPyramidExtents[index];
            if (extent !== undefined) extent.scale = resources.sceneScale / 2 ** (index + 1);
        }
        this.#reflectionExtent.scale = resources.sceneScale * this.#settings.resolutionScale;
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
            const scale = resources.sceneScale / 2 ** (index + 1);
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
        const currentHit = context.graph.createTexture(
            'Screen-space reflections current hit motion and view depth',
            this.#reflectionDescriptor
        );
        const reflectionScale = resources.sceneScale * this.#settings.resolutionScale;
        const reflectionWidth = Math.max(1, Math.floor(context.output.width * reflectionScale));
        const reflectionHeight = Math.max(1, Math.floor(context.output.height * reflectionScale));
        const tileCountX = Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE));
        const tileCountY = Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE));
        const dispatchArguments = context.graph.createBuffer(
            'Screen-space reflections indirect dispatch arguments',
            { byteLength: 12 }
        );
        const tileMask = context.graph.createBuffer('Screen-space reflections active tile mask', {
            byteLength: tileCountX * tileCountY * 4
        });
        const tileList = context.graph.createBuffer('Screen-space reflections active tile list', {
            byteLength: tileCountX * tileCountY * 4
        });
        const diagnostics = context.graph.importStorageBuffer(this.#diagnostics);

        const reset = context.acquirePassParameters(this.#traceResetPool);
        reset.setBuffer(0, dispatchArguments);
        reset.setBuffer(1, diagnostics);
        reset.setTexture(0, currentReflection);
        reset.setTexture(1, currentHit);
        reset.setDispatch(tileCountX, tileCountY);
        context.graph.addPass(TRACE_RESET_PASS, reset);

        const classification = context.acquirePassParameters(this.#classificationPool);
        classification.setBuffer(0, resources.frameBuffer);
        classification.setBuffer(1, tileMask);
        classification.setBuffer(2, diagnostics);
        classification.setTexture(0, resources.sceneDepth);
        classification.setTexture(1, resources.materialAttributes);
        classification.setTexture(2, resources.reflectionResponse);
        classification.setTexture(3, currentReflection);
        classification.setDispatch(tileCountX, tileCountY);
        context.graph.addPass(this.#tileClassificationPass, classification);

        const compaction = context.acquirePassParameters(this.#compactionPool);
        compaction.setBuffer(0, dispatchArguments);
        compaction.setBuffer(1, tileMask);
        compaction.setBuffer(2, tileList);
        compaction.setBuffer(3, diagnostics);
        compaction.setTexture(0, currentReflection);
        compaction.setDispatch(Math.max(1, Math.ceil((tileCountX * tileCountY) / 64)), 1);
        context.graph.addPass(TILE_COMPACTION_PASS, compaction);

        const dispatchFinalize = context.acquirePassParameters(this.#dispatchFinalizePool);
        dispatchFinalize.setBuffer(0, dispatchArguments);
        dispatchFinalize.setBuffer(1, diagnostics);
        dispatchFinalize.setDispatch(1, 1);
        context.graph.addPass(TILE_DISPATCH_FINALIZE_PASS, dispatchFinalize);

        const trace = context.acquirePassParameters(this.#tracePool);
        trace.setBuffer(0, resources.frameBuffer);
        trace.setBuffer(1, tileList);
        trace.setBuffer(2, diagnostics);
        let textureIndex = 0;
        for (const color of colorLevels) trace.setTexture(textureIndex++, color);
        trace.setTexture(textureIndex++, resources.sceneDepth);
        trace.setTexture(textureIndex++, resources.materialAttributes);
        trace.setTexture(textureIndex++, resources.reflectionResponse);
        trace.setTexture(textureIndex++, resources.motionDepth);
        for (let index = 0; index < this.#traceHiZLevelCount; index += 1) {
            const hiZ = resources.hiZ[index];
            if (hiZ === undefined)
                throw new Error('Screen-space reflections Hi-Z level is missing');
            trace.setTexture(textureIndex++, hiZ);
        }
        trace.setTexture(textureIndex++, currentReflection);
        trace.setTexture(textureIndex, currentHit);
        trace.setIndirectDispatch(dispatchArguments);
        context.graph.addPass(this.#tracePass, trace);

        const colorHistory = context.graph.acquireHistoryTexture(
            this.#colorHistoryKey,
            this.#colorHistoryDescriptor
        );
        const depthHistory = context.graph.acquireHistoryTexture(
            this.#depthHistoryKey,
            this.#depthHistoryDescriptor
        );
        const stateHistory = context.graph.acquireHistoryTexture(
            this.#stateHistoryKey,
            this.#stateHistoryDescriptor
        );
        const responseHistory = context.graph.acquireHistoryTexture(
            this.#responseHistoryKey,
            this.#responseHistoryDescriptor
        );
        if (
            colorHistory.generation !== depthHistory.generation ||
            colorHistory.generation !== stateHistory.generation ||
            colorHistory.generation !== responseHistory.generation ||
            colorHistory.valid !== depthHistory.valid ||
            colorHistory.valid !== stateHistory.valid ||
            colorHistory.valid !== responseHistory.valid
        ) {
            throw new Error('Screen-space reflections history generations diverged');
        }
        if (resources.historyValid && colorHistory.valid) {
            const historyReset = context.acquirePassParameters(this.#historyResetPool);
            historyReset.setTexture(0, colorHistory.current);
            historyReset.setTexture(1, depthHistory.current);
            historyReset.setTexture(2, stateHistory.current);
            historyReset.setTexture(3, responseHistory.current);
            historyReset.setDispatch(
                Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
            );
            context.graph.addPass(TEMPORAL_HISTORY_RESET_PASS, historyReset);

            const resolve = context.acquirePassParameters(this.#resolvePool);
            resolve.setBuffer(0, diagnostics);
            resolve.setBuffer(1, tileList);
            resolve.setTexture(0, currentReflection);
            resolve.setTexture(1, currentHit);
            resolve.setTexture(2, resources.motionDepth);
            resolve.setTexture(3, resources.materialAttributes);
            resolve.setTexture(4, resources.reactiveMask);
            resolve.setTexture(5, resources.reflectionResponse);
            resolve.setTexture(6, colorHistory.history());
            resolve.setTexture(7, depthHistory.history());
            resolve.setTexture(8, stateHistory.history());
            resolve.setTexture(9, responseHistory.history());
            resolve.setTexture(10, colorHistory.current);
            resolve.setTexture(11, depthHistory.current);
            resolve.setTexture(12, stateHistory.current);
            resolve.setTexture(13, responseHistory.current);
            resolve.setIndirectDispatch(dispatchArguments);
            context.graph.addPass(this.#temporalResolvePass, resolve);
        } else {
            const initialize = context.acquirePassParameters(this.#initializePool);
            initialize.setTexture(0, currentReflection);
            initialize.setTexture(1, currentHit);
            initialize.setTexture(2, resources.motionDepth);
            initialize.setTexture(3, resources.materialAttributes);
            initialize.setTexture(4, resources.reflectionResponse);
            initialize.setTexture(5, colorHistory.current);
            initialize.setTexture(6, depthHistory.current);
            initialize.setTexture(7, stateHistory.current);
            initialize.setTexture(8, responseHistory.current);
            initialize.setDispatch(
                Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
                Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
            );
            context.graph.addPass(TEMPORAL_INITIALIZE_PASS, initialize);
        }

        const reconstructed = context.graph.createTexture(
            'Screen-space reflections confidence reconstruction',
            this.#reflectionDescriptor
        );
        const reconstructionReset = context.acquirePassParameters(this.#filterResetPool);
        reconstructionReset.setTexture(0, reconstructed);
        reconstructionReset.setDispatch(
            Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
            Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
        );
        context.graph.addPass(SPATIAL_FILTER_RESET_PASS, reconstructionReset);

        const reconstruction = context.acquirePassParameters(this.#spatialFilterPool);
        reconstruction.setBuffer(0, diagnostics);
        reconstruction.setBuffer(1, tileList);
        reconstruction.setTexture(0, colorHistory.current);
        reconstruction.setTexture(1, resources.motionDepth);
        reconstruction.setTexture(2, resources.materialAttributes);
        reconstruction.setTexture(3, stateHistory.current);
        reconstruction.setTexture(4, responseHistory.current);
        reconstruction.setTexture(5, reconstructed);
        reconstruction.setIndirectDispatch(dispatchArguments);
        context.graph.addPass(this.#spatialReconstructionPass, reconstruction);

        const filtered = context.graph.createTexture(
            'Screen-space reflections variance-guided stability filter',
            this.#reflectionDescriptor
        );
        const filterReset = context.acquirePassParameters(this.#filterResetPool);
        filterReset.setTexture(0, filtered);
        filterReset.setDispatch(
            Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
            Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
        );
        context.graph.addPass(SPATIAL_FILTER_RESET_PASS, filterReset);

        const filter = context.acquirePassParameters(this.#spatialFilterPool);
        filter.setBuffer(0, diagnostics);
        filter.setBuffer(1, tileList);
        filter.setTexture(0, reconstructed);
        filter.setTexture(1, resources.motionDepth);
        filter.setTexture(2, resources.materialAttributes);
        filter.setTexture(3, stateHistory.current);
        filter.setTexture(4, responseHistory.current);
        filter.setTexture(5, filtered);
        filter.setIndirectDispatch(dispatchArguments);
        context.graph.addPass(this.#spatialStabilityPass, filter);

        const stabilized = context.graph.createTexture(
            'Screen-space reflections residual coverage cleanup',
            this.#reflectionDescriptor
        );
        const stabilityReset = context.acquirePassParameters(this.#filterResetPool);
        stabilityReset.setTexture(0, stabilized);
        stabilityReset.setDispatch(
            Math.max(1, Math.ceil(reflectionWidth / TRACE_WORKGROUP_SIZE)),
            Math.max(1, Math.ceil(reflectionHeight / TRACE_WORKGROUP_SIZE))
        );
        context.graph.addPass(SPATIAL_FILTER_RESET_PASS, stabilityReset);

        const stability = context.acquirePassParameters(this.#spatialFilterPool);
        stability.setBuffer(0, diagnostics);
        stability.setBuffer(1, tileList);
        stability.setTexture(0, filtered);
        stability.setTexture(1, resources.motionDepth);
        stability.setTexture(2, resources.materialAttributes);
        stability.setTexture(3, stateHistory.current);
        stability.setTexture(4, responseHistory.current);
        stability.setTexture(5, stabilized);
        stability.setIndirectDispatch(dispatchArguments);
        context.graph.addPass(this.#spatialCleanupPass, stability);

        const composite = context.acquirePassParameters(this.#compositePool);
        composite.inputTextures.length = 4;
        composite.inputTextures[0] = stabilized;
        composite.inputTextures[1] = resources.fallbackSpecular;
        composite.inputTextures[2] = resources.materialAttributes;
        composite.inputTextures[3] = resources.motionDepth;
        composite.colorAttachments[0] = {
            texture: resources.sceneColor,
            loadOp: 'load',
            storeOp: 'store'
        };
        context.graph.addPass(this.#compositePass, composite);
        return resources.sceneColor;
    }

    async readDiagnostics(): Promise<Readonly<ScreenSpaceReflectionsDiagnostics>> {
        if (this.#destroyed) throw new Error('Screen-space reflections controller is destroyed');
        const result = await this.#diagnostics.read();
        const values = new Uint32Array(
            result.data.buffer,
            result.data.byteOffset,
            result.data.byteLength / 4
        );
        return Object.freeze({
            activeTileCount: values[0] ?? 0,
            activePixelCount: values[1] ?? 0,
            hitPixelCount: values[2] ?? 0,
            missPixelCount: values[3] ?? 0,
            uncertainPixelCount: values[4] ?? 0,
            backfaceRejectedPixelCount: values[5] ?? 0,
            historyAcceptedPixelCount: values[6] ?? 0,
            historyRejectedPixelCount: values[7] ?? 0
        });
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#diagnostics.destroy();
    }
}

/** @internal Maximum sampled Hi-Z levels retained by the production SSR trace ABI. */
export const SCREEN_SPACE_REFLECTION_TRACE_HIZ_LEVELS = MAX_TRACE_HIZ_LEVELS;

/** @internal Number of sampled radiance levels used for the roughness cone. */
export const SCREEN_SPACE_REFLECTION_COLOR_LEVELS = COLOR_PYRAMID_LEVELS;
