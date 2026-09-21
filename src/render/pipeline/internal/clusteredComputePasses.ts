import ComputeKernel from '../../compute/ComputeKernel';
import ComputeShader, { type ComputeShaderBinding } from '../../compute/ComputeShader';
import { ComputeRenderPass } from '../passes';
import {
    CULL_WORKGROUP_SIZE,
    OBJECT_ACTIVE_FLAG,
    OBJECT_FRUSTUM_CULLING_FLAG,
    OBJECT_HIZ_STABLE_FLAG,
    OBJECT_CAST_SHADOW_FLAG,
    BUCKET_OFFSET_STRIDE_WORDS,
    PREFIX_WORKGROUP_SIZE
} from './clusteredLayout';

/** Compute kernels and reusable pass instances for GPU Scene visibility and clustered lighting. */

export function computePass(shader: ComputeShader): ComputeRenderPass {
    return new ComputeRenderPass(new ComputeKernel({ label: shader.label, shader }), shader.label);
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
struct ObjectRecord {
    model0: vec4<f32>, model1: vec4<f32>, model2: vec4<f32>, model3: vec4<f32>,
    previous0: vec4<f32>, previous1: vec4<f32>, previous2: vec4<f32>, previous3: vec4<f32>,
    normal0: vec4<f32>, normal1: vec4<f32>, normal2: vec4<f32>,
    bounds: vec4<f32>,
    metadata: vec4<u32>,
};
struct BucketRecord {
    indices0: vec4<u32>,
    indices1: vec4<u32>,
    thresholds: vec4<f32>,
};
fn objectModel(object: ObjectRecord) -> mat4x4<f32> {
    return mat4x4<f32>(object.model0, object.model1, object.model2, object.model3);
}
fn objectPreviousModel(object: ObjectRecord) -> mat4x4<f32> {
    return mat4x4<f32>(object.previous0, object.previous1, object.previous2, object.previous3);
}
fn maximumScale(model: mat4x4<f32>) -> f32 {
    return max(length(model[0].xyz), max(length(model[1].xyz), length(model[2].xyz)));
}
fn projectedRadiusPixels(
    projection: mat4x4<f32>, viewportSize: vec2<f32>, nearPlane: f32,
    viewDepth: f32, radius: f32
) -> vec2<f32> {
    let projectionScale = vec2<f32>(abs(projection[0][0]), abs(projection[1][1]));
    return projectionScale * viewportSize * radius / max(viewDepth, nearPlane) * 0.5;
}
fn selectPhysicalBucket(bucket: BucketRecord, radiusPixels: f32) -> u32 {
    let count = bucket.indices0.y;
    if (count > 0u && radiusPixels <= bucket.thresholds.x) { return bucket.indices0.z; }
    if (count > 1u && radiusPixels <= bucket.thresholds.y) { return bucket.indices0.w; }
    if (count > 2u && radiusPixels <= bucket.thresholds.z) { return bucket.indices1.x; }
    return bucket.indices0.x;
}
`;

export function gpuSceneCullShader(hiZLevelCount: number): ComputeShader {
    const withHiZ = hiZLevelCount > 0;
    const maxHiZOcclusionDiameter = 2 ** hiZLevelCount;
    const textureDeclarations = withHiZ
        ? Array.from(
              { length: hiZLevelCount },
              (_unused, index) =>
                  `@group(0) @binding(${String(6 + index)}) var previousHiZ${String(index)}: texture_2d<f32>;`
          ).join('\n')
        : '';
    const dimensionCases = Array.from(
        { length: Math.max(0, hiZLevelCount - 1) },
        (_unused, index) =>
            `        case ${String(index)}u: { return textureDimensions(previousHiZ${String(index)}); }`
    ).join('\n');
    const loadCases = Array.from(
        { length: Math.max(0, hiZLevelCount - 1) },
        (_unused, index) =>
            `        case ${String(index)}u: { return textureLoad(previousHiZ${String(index)}, pixel, 0).xy; }`
    ).join('\n');
    const lastHiZLevel = Math.max(0, hiZLevelCount - 1);
    const textureSample = withHiZ
        ? `
fn hiZDimensions(level: u32) -> vec2<u32> {
    switch level {
${dimensionCases}
        default: { return textureDimensions(previousHiZ${String(lastHiZLevel)}); }
    }
}
fn hiZLoad(level: u32, pixel: vec2<i32>) -> vec2<f32> {
    switch level {
${loadCases}
        default: { return textureLoad(previousHiZ${String(lastHiZLevel)}, pixel, 0).xy; }
    }
}
fn depthFromDistance(depthParameters: vec4<f32>, distance: f32) -> f32 {
    let nearPlane = depthParameters.x;
    let farPlane = depthParameters.y;
    let standard = (farPlane - nearPlane * farPlane / max(distance, nearPlane)) /
        max(farPlane - nearPlane, 0.0001);
    return select(standard, 1.0 - standard, depthParameters.w > 0.5);
}
fn occludedByPreviousHiZ(
    frame: FrameData,
    previousCenter: vec3<f32>,
    radius: f32
) -> bool {
    if (frame.budgets.z == 0u || radius <= 0.0) { return false; }
    let viewCenter = frame.previousView * vec4<f32>(previousCenter, 1.0);
    let viewDepth = max(-viewCenter.z, frame.previousDepth.x);
    let nearestViewDepth = max(viewDepth - radius, frame.previousDepth.x);
    if (-viewCenter.z - radius <= frame.previousDepth.x) { return false; }
    var minimumUv = vec2<f32>(1.0);
    var maximumUv = vec2<f32>(0.0);
    for (var cornerIndex = 0u; cornerIndex < 8u; cornerIndex += 1u) {
        let signs = vec3<f32>(
            select(-1.0, 1.0, (cornerIndex & 1u) != 0u),
            select(-1.0, 1.0, (cornerIndex & 2u) != 0u),
            select(-1.0, 1.0, (cornerIndex & 4u) != 0u)
        );
        let corner = frame.previousProjection * vec4<f32>(viewCenter.xyz + signs * radius, 1.0);
        if (corner.w <= 0.0) { return false; }
        let cornerNdc = corner.xy / corner.w;
        let cornerUv = cornerNdc * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5);
        minimumUv = min(minimumUv, cornerUv);
        maximumUv = max(maximumUv, cornerUv);
    }
    minimumUv = clamp(minimumUv, vec2<f32>(0.0), vec2<f32>(0.999999));
    maximumUv = clamp(maximumUv, vec2<f32>(0.0), vec2<f32>(0.999999));
    let extentPixels = max((maximumUv - minimumUv) * frame.viewport.zw, vec2<f32>(1.0));
    let diameter = max(extentPixels.x, extentPixels.y);
    if (diameter > ${String(maxHiZOcclusionDiameter)}.0) { return false; }
    let level = u32(clamp(ceil(log2(diameter)) - 1.0, 0.0, ${String(lastHiZLevel)}.0));
    let dimensions = hiZDimensions(level);
    let nearestDepth = depthFromDistance(frame.previousDepth, nearestViewDepth);
    var hidden = true;
    for (var sampleIndex = 0u; sampleIndex < 4u; sampleIndex += 1u) {
        let uv = vec2<f32>(
            select(minimumUv.x, maximumUv.x, (sampleIndex & 1u) != 0u),
            select(minimumUv.y, maximumUv.y, (sampleIndex & 2u) != 0u)
        );
        let pixel = vec2<i32>(uv * vec2<f32>(dimensions));
        let bounds = hiZLoad(level, pixel);
        let depth = select(bounds.y, bounds.x, frame.previousDepth.w > 0.5);
        let sampleHidden = select(
            (depth < nearestDepth - 0.0005),
            (depth > nearestDepth + 0.0005),
            frame.previousDepth.w > 0.5
        );
        hidden = hidden && sampleHidden;
    }
    return hidden;
}`
        : `
fn occludedByPreviousHiZ(
    frame: FrameData,
    previousCenter: vec3<f32>,
    radius: f32
) -> bool {
    return false;
}`;
    return new ComputeShader({
        label: withHiZ
            ? 'GPU Scene previous Hi-Z occlusion, frustum, and LOD culling'
            : 'GPU Scene frustum and LOD culling',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> objects: array<ObjectRecord>;
@group(0) @binding(2) var<storage, read> buckets: array<BucketRecord>;
@group(0) @binding(3) var<storage, read_write> selectedPhysicalBuckets: array<u32>;
@group(0) @binding(4) var<storage, read_write> indirectArguments: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> cullStats: array<atomic<u32>>;
${textureDeclarations}
${textureSample}
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.x || id.x >= frameData.budgets.x) { return; }
    selectedPhysicalBuckets[id.x] = 0xffffffffu;
    let object = objects[id.x];
    let objectFlags = object.metadata.z;
    if ((objectFlags & ${String(OBJECT_ACTIVE_FLAG)}u) == 0u || (object.metadata.y & frameData.budgets.w) == 0u) { return; }
    let model = objectModel(object);
    let previousModel = objectPreviousModel(object);
    let localCenter = vec4<f32>(object.bounds.xyz, 1.0);
    let center = (model * localCenter).xyz;
    let previousCenter = (previousModel * localCenter).xyz;
    let radius = object.bounds.w * maximumScale(model);
    let previousRadius = object.bounds.w * maximumScale(previousModel);
    let viewCenter = frameData.view * vec4<f32>(center, 1.0);
    let viewDepth = -viewCenter.z;
    if ((objectFlags & ${String(OBJECT_FRUSTUM_CULLING_FLAG)}u) != 0u) {
        let projectionScale = vec2<f32>(
            abs(frameData.projection[0][0]), abs(frameData.projection[1][1])
        );
        let sidePlaneDistance = abs(viewCenter.xy) * projectionScale - vec2<f32>(viewDepth);
        let sidePlaneRadius = sqrt(projectionScale * projectionScale + vec2<f32>(1.0)) * radius;
        if (any(sidePlaneDistance > sidePlaneRadius)) { return; }
        if (viewDepth + radius < frameData.depth.x || viewDepth - radius > frameData.depth.y) { return; }
    }
    if (
        (objectFlags & ${String(OBJECT_HIZ_STABLE_FLAG)}u) != 0u &&
        occludedByPreviousHiZ(frameData, previousCenter, previousRadius)
    ) {
        _ = atomicAdd(&cullStats[1], 1u);
        return;
    }
    let radiusPixels = projectedRadiusPixels(
        frameData.projection, frameData.viewport.zw, frameData.depth.x, viewDepth, radius
    );
    let physicalBucket = selectPhysicalBucket(
        buckets[object.metadata.x], max(radiusPixels.x, radiusPixels.y)
    );
    if (physicalBucket != buckets[object.metadata.x].indices0.x) {
        _ = atomicAdd(&cullStats[2], 1u);
    }
    _ = atomicAdd(&indirectArguments[physicalBucket * 5u + 1u], 1u);
    selectedPhysicalBuckets[id.x] = physicalBucket;
    _ = atomicAdd(&cullStats[0], 1u);
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: gpuSceneCullBindings(hiZLevelCount)
    });
}

function gpuSceneCullBindings(hiZLevelCount: number): readonly ComputeShaderBinding[] {
    const bindings: ComputeShaderBinding[] = [
        { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
        { name: 'objects', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
        { name: 'buckets', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
        {
            name: 'selectedPhysicalBuckets',
            group: 0,
            binding: 3,
            kind: 'storage-buffer',
            access: 'write-discard'
        },
        {
            name: 'indirectArguments',
            group: 0,
            binding: 4,
            kind: 'storage-buffer',
            access: 'read-write'
        },
        {
            name: 'cullStats',
            group: 0,
            binding: 5,
            kind: 'storage-buffer',
            access: 'read-write'
        }
    ];
    if (hiZLevelCount > 0) {
        for (let index = 0; index < hiZLevelCount; index += 1) {
            bindings.push({
                name: `previousHiZ${String(index)}`,
                group: 0,
                binding: 6 + index,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            });
        }
    }
    return Object.freeze(bindings);
}

export const GPU_SCENE_CULL_PASS = computePass(gpuSceneCullShader(0));

export const GPU_SHADOW_CULL_PASS = computePass(
    new ComputeShader({
        label: 'GPU Scene shadow caster frustum culling',
        source: `${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> objects: array<ObjectRecord>;
@group(0) @binding(2) var<storage, read> buckets: array<BucketRecord>;
@group(0) @binding(3) var<storage, read_write> selectedPhysicalBuckets: array<u32>;
@group(0) @binding(4) var<storage, read_write> indirectArguments: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> cullStats: array<atomic<u32>>;
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.x || id.x >= frameData.budgets.x) { return; }
    selectedPhysicalBuckets[id.x] = 0xffffffffu;
    let object = objects[id.x];
    let flags = object.metadata.z;
    if (
        (flags & ${String(OBJECT_ACTIVE_FLAG | OBJECT_CAST_SHADOW_FLAG)}u) !=
        ${String(OBJECT_ACTIVE_FLAG | OBJECT_CAST_SHADOW_FLAG)}u ||
        (object.metadata.y & frameData.budgets.w) == 0u
    ) { return; }
    let model = objectModel(object);
    let localCenter = vec4<f32>(object.bounds.xyz, 1.0);
    let center = (model * localCenter).xyz;
    let radius = object.bounds.w * maximumScale(model);
    let clip = frameData.currentViewProjection * vec4<f32>(center, 1.0);
    let rowX = vec3<f32>(
        frameData.currentViewProjection[0].x,
        frameData.currentViewProjection[1].x,
        frameData.currentViewProjection[2].x
    );
    let rowY = vec3<f32>(
        frameData.currentViewProjection[0].y,
        frameData.currentViewProjection[1].y,
        frameData.currentViewProjection[2].y
    );
    let radiusX = radius * length(rowX);
    let radiusY = radius * length(rowY);
    if ((flags & ${String(OBJECT_FRUSTUM_CULLING_FLAG)}u) != 0u) {
        if (clip.x + radiusX < -clip.w || clip.x - radiusX > clip.w) { return; }
        if (clip.y + radiusY < -clip.w || clip.y - radiusY > clip.w) { return; }
    }
    let bucket = buckets[object.metadata.x].indices0.x;
    _ = atomicAdd(&indirectArguments[bucket * 5u + 1u], 1u);
    selectedPhysicalBuckets[id.x] = bucket;
    _ = atomicAdd(&cullStats[0], 1u);
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: gpuSceneCullBindings(0)
    })
);

export const GPU_SCENE_BUCKET_PREFIX_PASS = computePass(
    new ComputeShader({
        label: 'GPU Scene visible bucket prefix',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read_write> indirectArguments: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> bucketCursors: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> bucketOffsets: array<u32>;
@compute @workgroup_size(1)
fn main() {
    var offset = 0u;
    for (var bucket = 0u; bucket < frameData.counts.y; bucket += 1u) {
        let count = atomicLoad(&indirectArguments[bucket * 5u + 1u]);
        bucketOffsets[bucket * ${String(BUCKET_OFFSET_STRIDE_WORDS)}u] = offset;
        atomicStore(&indirectArguments[bucket * 5u + 4u], 0u);
        atomicStore(&bucketCursors[bucket], 0u);
        offset += count;
    }
}`,
        workgroupSize: [1],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'indirectArguments',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            {
                name: 'bucketCursors',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'bucketOffsets',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);

function gpuSceneVisibleCompactPass(trackVisibility: boolean): ComputeRenderPass {
    return computePass(
        new ComputeShader({
            label: trackVisibility
                ? 'GPU Scene visible compact and temporal visibility write'
                : 'GPU Scene visible compact write',
            source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> selectedPhysicalBuckets: array<u32>;
@group(0) @binding(2) var<storage, read_write> bucketCursors: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> bucketOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> visibleIndices: array<u32>;
${trackVisibility ? '@group(0) @binding(5) var<storage, read_write> currentVisibility: array<u32>;' : ''}
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.x || id.x >= frameData.budgets.x) { return; }
    let bucket = selectedPhysicalBuckets[id.x];
    if (bucket == 0xffffffffu) { return; }
    let localIndex = atomicAdd(&bucketCursors[bucket], 1u);
    let offset = bucketOffsets[bucket * ${String(BUCKET_OFFSET_STRIDE_WORDS)}u];
    visibleIndices[offset + localIndex] = id.x;
    ${trackVisibility ? 'currentVisibility[id.x] = 1u;' : ''}
}`,
            workgroupSize: [CULL_WORKGROUP_SIZE],
            bindings: [
                { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
                {
                    name: 'selectedPhysicalBuckets',
                    group: 0,
                    binding: 1,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'bucketCursors',
                    group: 0,
                    binding: 2,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'bucketOffsets',
                    group: 0,
                    binding: 3,
                    kind: 'read-only-storage-buffer'
                },
                {
                    name: 'visibleIndices',
                    group: 0,
                    binding: 4,
                    kind: 'storage-buffer',
                    access: 'write-discard'
                },
                ...(trackVisibility
                    ? ([
                          {
                              name: 'currentVisibility',
                              group: 0,
                              binding: 5,
                              kind: 'storage-buffer',
                              access: 'read-write'
                          }
                      ] as const)
                    : [])
            ]
        })
    );
}

export const GPU_SCENE_VISIBLE_COMPACT_PASS = gpuSceneVisibleCompactPass(false);

export const GPU_SCENE_TEMPORAL_VISIBLE_COMPACT_PASS = gpuSceneVisibleCompactPass(true);

export const HIZ_DEPTH_REDUCE_PASS = computePass(
    new ComputeShader({
        label: 'GPU Scene current depth Hi-Z min/max mip zero',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var sourceDepth: texture_depth_2d;
@group(0) @binding(2) var destination: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    let inputSize = textureDimensions(sourceDepth);
    let base = id.xy * 2u;
    var minimumDepth = 1.0;
    var maximumDepth = 0.0;
    for (var y = 0u; y < 2u; y += 1u) {
        for (var x = 0u; x < 2u; x += 1u) {
            let pixel = min(base + vec2<u32>(x, y), inputSize - vec2<u32>(1u));
            let value = textureLoad(sourceDepth, vec2<i32>(pixel), 0);
            minimumDepth = min(minimumDepth, value);
            maximumDepth = max(maximumDepth, value);
        }
    }
    textureStore(destination, vec2<i32>(id.xy), vec4<f32>(minimumDepth, maximumDepth, 0.0, 0.0));
}`,
        workgroupSize: [8, 8],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'sourceDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'destination',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rg32float'
            }
        ]
    })
);

export const HIZ_FLOAT_REDUCE_PASS = computePass(
    new ComputeShader({
        label: 'GPU Scene current Hi-Z min/max reduction',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var sourceDepth: texture_2d<f32>;
@group(0) @binding(2) var destination: texture_storage_2d<rg32float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let outputSize = textureDimensions(destination);
    if (any(id.xy >= outputSize)) { return; }
    let inputSize = textureDimensions(sourceDepth);
    let base = id.xy * 2u;
    var minimumDepth = 1.0;
    var maximumDepth = 0.0;
    for (var y = 0u; y < 2u; y += 1u) {
        for (var x = 0u; x < 2u; x += 1u) {
            let pixel = min(base + vec2<u32>(x, y), inputSize - vec2<u32>(1u));
            let value = textureLoad(sourceDepth, vec2<i32>(pixel), 0).xy;
            minimumDepth = min(minimumDepth, value.x);
            maximumDepth = max(maximumDepth, value.y);
        }
    }
    textureStore(destination, vec2<i32>(id.xy), vec4<f32>(minimumDepth, maximumDepth, 0.0, 0.0));
}`,
        workgroupSize: [8, 8],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'sourceDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float'
            },
            {
                name: 'destination',
                group: 0,
                binding: 2,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rg32float'
            }
        ]
    })
);

export const CLUSTER_DEPTH_BOUNDS_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ depth-driven tile bounds',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var sceneDepth: texture_depth_2d;
@group(0) @binding(2) var<storage, read_write> tileDepthBounds: array<vec2<u32>>;
fn distanceFromDepth(frame: FrameData, rawDepth: f32) -> f32 {
    let standard = select(rawDepth, 1.0 - rawDepth, frame.depth.w > 0.5);
    return frame.depth.x * frame.depth.y /
        max(frame.depth.y - standard * (frame.depth.y - frame.depth.x), 0.0001);
}
fn depthSlice(frame: FrameData, distance: f32) -> u32 {
    let normalized = log(max(distance, frame.depth.x) / frame.depth.x) / frame.depth.z;
    return min(u32(clamp(normalized, 0.0, 0.999999) * f32(frame.cluster.z)), frame.cluster.z - 1u);
}
var<workgroup> minimumDepthBits: atomic<u32>;
var<workgroup> maximumDepthBits: atomic<u32>;
var<workgroup> coveredPixels: atomic<u32>;
@compute @workgroup_size(8, 8)
fn main(
    @builtin(workgroup_id) tile: vec3<u32>,
    @builtin(local_invocation_id) local: vec3<u32>,
    @builtin(local_invocation_index) localIndex: u32
) {
    if (localIndex == 0u) {
        atomicStore(&minimumDepthBits, bitcast<u32>(frameData.depth.y));
        atomicStore(&maximumDepthBits, bitcast<u32>(frameData.depth.x));
        atomicStore(&coveredPixels, 0u);
    }
    workgroupBarrier();
    let tileIndex = tile.y * frameData.cluster.x + tile.x;
    let size = textureDimensions(sceneDepth);
    let origin = tile.xy * frameData.cluster.w;
    let end = min(origin + vec2<u32>(frameData.cluster.w), size);
    for (var y = origin.y + local.y; y < end.y; y += 8u) {
        for (var x = origin.x + local.x; x < end.x; x += 8u) {
            let rawDepth = textureLoad(sceneDepth, vec2<i32>(i32(x), i32(y)), 0);
            let empty = select(rawDepth >= 0.999999, rawDepth <= 0.000001, frameData.depth.w > 0.5);
            if (!empty) {
                let distance = distanceFromDepth(frameData, rawDepth);
                _ = atomicMin(&minimumDepthBits, bitcast<u32>(distance));
                _ = atomicMax(&maximumDepthBits, bitcast<u32>(distance));
                _ = atomicOr(&coveredPixels, 1u);
            }
        }
    }
    workgroupBarrier();
    if (localIndex == 0u) {
        let covered = atomicLoad(&coveredPixels) != 0u;
        let minimumDistance = bitcast<f32>(atomicLoad(&minimumDepthBits));
        let maximumDistance = bitcast<f32>(atomicLoad(&maximumDepthBits));
        tileDepthBounds[tileIndex] = select(
            vec2<u32>(frameData.cluster.z, 0u),
            vec2<u32>(depthSlice(frameData, minimumDistance), depthSlice(frameData, maximumDistance)),
            covered
        );
    }
}`,
        workgroupSize: [8, 8],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'sceneDepth',
                group: 0,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'depth'
            },
            {
                name: 'tileDepthBounds',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

const LIGHT_CLUSTER_COMMON = `
${FRAME_WGSL}
struct LightRecord {
    positionRange: vec4<f32>,
    colorType: vec4<f32>,
    directionOuter: vec4<f32>,
    attenuationInner: vec4<f32>,
    shadow: vec4<f32>,
    areaWidth: vec4<f32>,
    areaHeight: vec4<f32>,
};
fn depthSlice(frame: FrameData, distance: f32) -> u32 {
    let normalized = log(max(distance, frame.depth.x) / frame.depth.x) / frame.depth.z;
    return min(u32(clamp(normalized, 0.0, 0.999999) * f32(frame.cluster.z)), frame.cluster.z - 1u);
}
fn lightTileBounds(frame: FrameData, light: LightRecord) -> vec4<u32> {
    let lightType = u32(light.colorType.w + 0.5);
    if (lightType == 2u) {
        return vec4<u32>(0u, 0u, frame.cluster.x - 1u, frame.cluster.y - 1u);
    }
    let viewDepth = -light.positionRange.z;
    let radius = light.positionRange.w;
    if (viewDepth + radius <= frame.depth.x) {
        return vec4<u32>(frame.cluster.x, frame.cluster.y, 0u, 0u);
    }
    if (viewDepth - radius <= frame.depth.x) {
        return vec4<u32>(0u, 0u, frame.cluster.x - 1u, frame.cluster.y - 1u);
    }
    let depth = viewDepth;
    let clip = frame.projection * vec4<f32>(light.positionRange.xyz, 1.0);
    let center = clip.xy / clip.w;
    let radiusNdc = vec2<f32>(
        abs(frame.projection[0][0]), abs(frame.projection[1][1])
    ) * light.positionRange.w / depth;
    let minimum = clamp(
        (center - radiusNdc) * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5),
        vec2<f32>(0.0), vec2<f32>(0.999999)
    );
    let maximum = clamp(
        (center + radiusNdc) * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5),
        vec2<f32>(0.0), vec2<f32>(0.999999)
    );
    let low = min(minimum, maximum);
    let high = max(minimum, maximum);
    return vec4<u32>(
        min(u32(low.x * f32(frame.cluster.x)), frame.cluster.x - 1u),
        min(u32(low.y * f32(frame.cluster.y)), frame.cluster.y - 1u),
        min(u32(high.x * f32(frame.cluster.x)), frame.cluster.x - 1u),
        min(u32(high.y * f32(frame.cluster.y)), frame.cluster.y - 1u)
    );
}
fn lightSliceBounds(frame: FrameData, light: LightRecord) -> vec2<u32> {
    let lightType = u32(light.colorType.w + 0.5);
    if (lightType == 2u) { return vec2<u32>(0u, frame.cluster.z - 1u); }
    let depth = -light.positionRange.z;
    return vec2<u32>(
        depthSlice(frame, max(frame.depth.x, depth - light.positionRange.w)),
        depthSlice(frame, min(frame.depth.y, depth + light.positionRange.w))
    );
}
`;

export const CLUSTER_LIGHT_COUNT_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ light count',
        source: `
${LIGHT_CLUSTER_COMMON}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> lights: array<LightRecord>;
@group(0) @binding(2) var<storage, read> tileDepthBounds: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read_write> clusterCounts: array<atomic<u32>>;
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.directional.y) { return; }
    let light = lights[frameData.directional.x + id.x];
    let tiles = lightTileBounds(frameData, light);
    if (tiles.x > tiles.z || tiles.y > tiles.w) { return; }
    let slices = lightSliceBounds(frameData, light);
    let tileCount = frameData.cluster.x * frameData.cluster.y;
    for (var y = tiles.y; y <= tiles.w; y += 1u) {
        for (var x = tiles.x; x <= tiles.z; x += 1u) {
            let tile = y * frameData.cluster.x + x;
            let depthBounds = tileDepthBounds[tile];
            let completeVolume = frameData.directional.w != 0u;
            let firstSlice = select(max(slices.x, depthBounds.x), slices.x, completeVolume);
            let lastSlice = select(min(slices.y, depthBounds.y), slices.y, completeVolume);
            if (firstSlice <= lastSlice) {
                for (var z = firstSlice; z <= lastSlice; z += 1u) {
                    _ = atomicAdd(&clusterCounts[z * tileCount + tile], 1u);
                }
            }
        }
    }
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'lights', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            { name: 'tileDepthBounds', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterCounts',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);

export const CLUSTER_BLOCK_SCAN_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ block-local prefix scan',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clusterCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterGrid: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read_write> blockSums: array<u32>;
var<workgroup> prefixValues: array<u32, ${String(PREFIX_WORKGROUP_SIZE)}>;
@compute @workgroup_size(${String(PREFIX_WORKGROUP_SIZE)})
fn main(
    @builtin(local_invocation_index) localIndex: u32,
    @builtin(workgroup_id) workgroup: vec3<u32>,
    @builtin(global_invocation_id) global: vec3<u32>
) {
    let clusterCount = frameData.cluster.x * frameData.cluster.y * frameData.cluster.z;
    var bounded = 0u;
    if (global.x < clusterCount) {
        bounded = min(clusterCounts[global.x], frameData.budgets.y);
    }
    prefixValues[localIndex] = bounded;
    workgroupBarrier();
    var step = 1u;
    while (step < ${String(PREFIX_WORKGROUP_SIZE)}u) {
        var addend = 0u;
        if (localIndex >= step) {
            addend = prefixValues[localIndex - step];
        }
        workgroupBarrier();
        prefixValues[localIndex] += addend;
        workgroupBarrier();
        step *= 2u;
    }
    if (global.x < clusterCount) {
        clusterGrid[global.x] = vec2<u32>(prefixValues[localIndex] - bounded, bounded);
    }
    if (localIndex == ${String(PREFIX_WORKGROUP_SIZE - 1)}u) {
        blockSums[workgroup.x] = prefixValues[localIndex];
    }
}`,
        workgroupSize: [PREFIX_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clusterCounts', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterGrid',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'blockSums',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

export const CLUSTER_BLOCK_PREFIX_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ block prefix',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> blockSums: array<u32>;
@group(0) @binding(2) var<storage, read_write> blockOffsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> clusterStats: array<atomic<u32>>;
@compute @workgroup_size(1)
fn main() {
    let clusterCount = frameData.cluster.x * frameData.cluster.y * frameData.cluster.z;
    let blockCount = (clusterCount + ${String(PREFIX_WORKGROUP_SIZE - 1)}u) /
        ${String(PREFIX_WORKGROUP_SIZE)}u;
    var offset = 0u;
    for (var block = 0u; block < blockCount; block += 1u) {
        blockOffsets[block] = offset;
        offset += blockSums[block];
    }
    atomicStore(&clusterStats[0], frameData.counts.w);
    atomicStore(&clusterStats[1], 0u);
    atomicStore(&clusterStats[2], 0u);
    atomicStore(&clusterStats[3], clusterCount);
}`,
        workgroupSize: [1],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'blockSums', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'blockOffsets',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'write-discard'
            },
            {
                name: 'clusterStats',
                group: 0,
                binding: 3,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

export const CLUSTER_PREFIX_FINALIZE_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ bounded prefix finalize',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> clusterCounts: array<u32>;
@group(0) @binding(2) var<storage, read_write> clusterGrid: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read> blockOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> clusterStats: array<atomic<u32>>;
@compute @workgroup_size(${String(PREFIX_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let clusterCount = frameData.cluster.x * frameData.cluster.y * frameData.cluster.z;
    if (id.x >= clusterCount) { return; }
    let localAllocation = clusterGrid[id.x];
    let rawOffset = blockOffsets[id.x / ${String(PREFIX_WORKGROUP_SIZE)}u] +
        localAllocation.x;
    let offset = min(rawOffset, frameData.counts.z);
    let available = min(localAllocation.y, frameData.counts.z - offset);
    clusterGrid[id.x] = vec2<u32>(offset, available);
    _ = atomicAdd(&clusterStats[1], available);
    _ = atomicAdd(&clusterStats[2], clusterCounts[id.x] - available);
}`,
        workgroupSize: [PREFIX_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'clusterCounts', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterGrid',
                group: 0,
                binding: 2,
                kind: 'storage-buffer',
                access: 'read-write'
            },
            { name: 'blockOffsets', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterStats',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);

export const CLUSTER_INDEX_RESET_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ deterministic light-index reset',
        source: `
${FRAME_WGSL}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read_write> clusterLightIndices: array<atomic<u32>>;
@compute @workgroup_size(${String(PREFIX_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.counts.z) { return; }
    atomicStore(&clusterLightIndices[id.x], 0xffffffffu);
}`,
        workgroupSize: [PREFIX_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterLightIndices',
                group: 0,
                binding: 1,
                kind: 'storage-buffer',
                access: 'write-discard'
            }
        ]
    })
);

export const CLUSTER_LIGHT_WRITE_PASS = computePass(
    new ComputeShader({
        label: 'Clustered Forward+ light index write',
        source: `
${LIGHT_CLUSTER_COMMON}
@group(0) @binding(0) var<storage, read> frameData: FrameData;
@group(0) @binding(1) var<storage, read> lights: array<LightRecord>;
@group(0) @binding(2) var<storage, read> tileDepthBounds: array<vec2<u32>>;
@group(0) @binding(3) var<storage, read> clusterGrid: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read_write> clusterLightIndices: array<atomic<u32>>;
@compute @workgroup_size(${String(CULL_WORKGROUP_SIZE)})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= frameData.directional.y) { return; }
    let lightIndex = frameData.directional.x + id.x;
    let light = lights[lightIndex];
    let tiles = lightTileBounds(frameData, light);
    if (tiles.x > tiles.z || tiles.y > tiles.w) { return; }
    let slices = lightSliceBounds(frameData, light);
    let tileCount = frameData.cluster.x * frameData.cluster.y;
    for (var y = tiles.y; y <= tiles.w; y += 1u) {
        for (var x = tiles.x; x <= tiles.z; x += 1u) {
            let tile = y * frameData.cluster.x + x;
            let depthBounds = tileDepthBounds[tile];
            let completeVolume = frameData.directional.w != 0u;
            let firstSlice = select(max(slices.x, depthBounds.x), slices.x, completeVolume);
            let lastSlice = select(min(slices.y, depthBounds.y), slices.y, completeVolume);
            if (firstSlice <= lastSlice) {
                for (var z = firstSlice; z <= lastSlice; z += 1u) {
                    let cluster = z * tileCount + tile;
                    let allocation = clusterGrid[cluster];
                    var candidate = lightIndex;
                    for (var slot = 0u; slot < allocation.y; slot += 1u) {
                        let previous = atomicMin(
                            &clusterLightIndices[allocation.x + slot], candidate
                        );
                        candidate = max(candidate, previous);
                        if (candidate == 0xffffffffu) { break; }
                    }
                }
            }
        }
    }
}`,
        workgroupSize: [CULL_WORKGROUP_SIZE],
        bindings: [
            { name: 'frameData', group: 0, binding: 0, kind: 'read-only-storage-buffer' },
            { name: 'lights', group: 0, binding: 1, kind: 'read-only-storage-buffer' },
            { name: 'tileDepthBounds', group: 0, binding: 2, kind: 'read-only-storage-buffer' },
            { name: 'clusterGrid', group: 0, binding: 3, kind: 'read-only-storage-buffer' },
            {
                name: 'clusterLightIndices',
                group: 0,
                binding: 4,
                kind: 'storage-buffer',
                access: 'read-write'
            }
        ]
    })
);
