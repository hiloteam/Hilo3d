import {
    MAX_DIRECTIONAL_LIGHTS,
    MAX_DIRECTIONAL_SHADOW_CASCADES,
    MAX_SPOT_LIGHTS
} from '../ubo/BuiltInUniformBlocks';
import {
    FRAME_BASE_VEC4_COUNT,
    SHADOW_ATLAS_RECTS_VEC4,
    SHADOW_ATLAS_SIZE_VEC4,
    SHADOW_METADATA_VEC4,
    SHADOW_DIRECTIONAL_BIASES_VEC4,
    SHADOW_DIRECTIONAL_SPLITS_VEC4,
    SHADOW_DIRECTIONAL_PARAMS_VEC4,
    SHADOW_DIRECTIONAL_MATRICES_VEC4,
    SHADOW_SPOT_BIASES_VEC4,
    SHADOW_SPOT_MATRICES_VEC4,
    SHADOW_POINT_BIASES_VEC4,
    SHADOW_POINT_MATRICES_VEC4
} from '../pipeline/internal/clusteredLayout';

function shadowOffset(vec4: number): string {
    return `${String(vec4 - FRAME_BASE_VEC4_COUNT)}u`;
}

/**
 * Shared-atlas compute consumer of the canonical Clustered frame ABI. Shadow matrices map
 * main-camera view space to OpenGL clip space; atlas rectangles already use top-left rows.
 * A medium has no surface normal, so only the minimum depth bias applies, never slope bias.
 */
export const VOLUMETRIC_SHADOW_SAMPLING_WGSL = `
fn shadowMatrix(base: u32) -> mat4x4<f32> {
    return mat4x4<f32>(frameData.shadows[base], frameData.shadows[base + 1u],
        frameData.shadows[base + 2u], frameData.shadows[base + 3u]);
}
fn atlasVisibility(slice: u32, bias: f32, position: vec3<f32>, matrix: mat4x4<f32>) -> f32 {
    let clip = matrix * vec4<f32>(position, 1.0);
    if (clip.w <= 0.0) { return 1.0; }
    let projection = clip.xyz / clip.w * 0.5 + vec3<f32>(0.5);
    if (any(projection < vec3<f32>(0.0)) || any(projection > vec3<f32>(1.0))) { return 1.0; }
    let rect = frameData.shadows[${shadowOffset(SHADOW_ATLAS_RECTS_VEC4)} + slice];
    if (any(abs(rect.xy) <= vec2<f32>(0.0))) { return 1.0; }
    // Exactly one clip-to-top-left normalization. Neither the atlas rect nor textureLoad flips Y.
    let uv = rect.zw + vec2<f32>(projection.x, 1.0 - projection.y) * rect.xy;
    let atlasSize = frameData.shadows[${shadowOffset(SHADOW_ATLAS_SIZE_VEC4)}].xy;
    let lower = vec2<i32>(round(min(rect.zw, rect.zw + rect.xy) * atlasSize));
    let upper = vec2<i32>(round(max(rect.zw, rect.zw + rect.xy) * atlasSize)) - vec2<i32>(1);
    let center = vec2<i32>(floor(uv * atlasSize));
    let reversed = frameData.shadows[${shadowOffset(SHADOW_METADATA_VEC4)}].w > 0.5;
    let reference = projection.z + select(-bias, bias, reversed);
    var visible = 0.0;
    // Nine bounded point comparisons: no derivatives, implicit LOD or cross-tile filtering.
    for (var y = -1; y <= 1; y += 1) {
        for (var x = -1; x <= 1; x += 1) {
            let sampleDepth = textureLoad(shadowAtlas, clamp(center + vec2<i32>(x, y), lower, upper), 0);
            visible += select(0.0, 1.0, select(reference <= sampleDepth, reference >= sampleDepth, reversed));
        }
    }
    return visible / 9.0;
}
fn directionalVisibility(index: u32, bias: f32, position: vec3<f32>) -> f32 {
    let splits = frameData.shadows[${shadowOffset(SHADOW_DIRECTIONAL_SPLITS_VEC4)} + index];
    let params = frameData.shadows[${shadowOffset(SHADOW_DIRECTIONAL_PARAMS_VEC4)} + index];
    let count = clamp(u32(params.x + 0.5), 1u, ${String(MAX_DIRECTIONAL_SHADOW_CASCADES)}u);
    let depth = max(-position.z, 0.0);
    if (depth > splits[count - 1u]) { return 1.0; }
    var cascade = 0u;
    if (count > 1u && depth > splits.x) { cascade = 1u; }
    if (count > 2u && depth > splits.y) { cascade = 2u; }
    if (count > 3u && depth > splits.z) { cascade = 3u; }
    let slice = index * ${String(MAX_DIRECTIONAL_SHADOW_CASCADES)}u + cascade;
    var visibility = atlasVisibility(slice, bias, position,
        shadowMatrix(${shadowOffset(SHADOW_DIRECTIONAL_MATRICES_VEC4)} + slice * 4u));
    if (cascade + 1u < count && params.y > 0.0) {
        var previousSplit = frameData.depth.x;
        if (cascade > 0u) { previousSplit = splits[cascade - 1u]; }
        let start = splits[cascade] - max(splits[cascade] - previousSplit, 0.00001) * params.y;
        if (depth > start) {
            let next = atlasVisibility(slice + 1u, bias, position,
                shadowMatrix(${shadowOffset(SHADOW_DIRECTIONAL_MATRICES_VEC4)} + (slice + 1u) * 4u));
            visibility = mix(visibility, next, smoothstep(start, splits[cascade], depth));
        }
    }
    return clamp(1.0 - (1.0 - visibility) * clamp(params.z, 0.0, 4.0), 0.0, 1.0);
}
fn sharedShadowVisibility(metadata: vec4<f32>, position: vec3<f32>) -> f32 {
    let kind = u32(metadata.x + 0.5);
    let index = u32(metadata.y + 0.5);
    if (kind == 1u) {
        return directionalVisibility(index,
            frameData.shadows[${shadowOffset(SHADOW_DIRECTIONAL_BIASES_VEC4)} + index].x, position);
    }
    if (kind == 2u) {
        return atlasVisibility(${String(MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES)}u + index,
            frameData.shadows[${shadowOffset(SHADOW_SPOT_BIASES_VEC4)} + index].x, position,
            shadowMatrix(${shadowOffset(SHADOW_SPOT_MATRICES_VEC4)} + index * 4u));
    }
    if (kind == 3u) {
        let bias = frameData.shadows[${shadowOffset(SHADOW_POINT_BIASES_VEC4)} + index].x;
        for (var face = 0u; face < 6u; face += 1u) {
            let matrixIndex = index * 6u + face;
            let matrix = shadowMatrix(${shadowOffset(SHADOW_POINT_MATRICES_VEC4)} + matrixIndex * 4u);
            let clip = matrix * vec4<f32>(position, 1.0);
            if (clip.w > 0.0 && all(abs(clip.xy / clip.w) <= vec2<f32>(1.0001))) {
                return atlasVisibility(${String(MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES + MAX_SPOT_LIGHTS)}u + matrixIndex,
                    bias, position, matrix);
            }
        }
    }
    return 1.0;
}`;
