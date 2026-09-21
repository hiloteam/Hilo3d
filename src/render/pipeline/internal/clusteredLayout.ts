import {
    MAX_DIRECTIONAL_LIGHTS,
    MAX_DIRECTIONAL_SHADOW_CASCADES,
    MAX_POINT_LIGHTS,
    MAX_SHADOW_ATLAS_SLICES,
    MAX_SPOT_LIGHTS
} from '../../ubo/BuiltInUniformBlocks';

/** Shared CPU/GPU record layouts and flags for the Clustered pipeline. */

export const OBJECT_RECORD_BYTES = 208;

export const LIGHT_RECORD_FLOATS = 28;

export const LIGHT_RECORD_BYTES = LIGHT_RECORD_FLOATS * 4;

export const BUCKET_RECORD_BYTES = 48;

export const FRAME_OUTPUT_MAPPING_VEC4 = 32;

export const FRAME_BASE_VEC4_COUNT = FRAME_OUTPUT_MAPPING_VEC4 + 1;

export const SHADOW_ATLAS_SIZE_VEC4 = FRAME_BASE_VEC4_COUNT;

export const SHADOW_METADATA_VEC4 = SHADOW_ATLAS_SIZE_VEC4 + 1;

export const SHADOW_ATLAS_RECTS_VEC4 = SHADOW_METADATA_VEC4 + 1;

export const SHADOW_DIRECTIONAL_BIASES_VEC4 = SHADOW_ATLAS_RECTS_VEC4 + MAX_SHADOW_ATLAS_SLICES;

export const SHADOW_DIRECTIONAL_SPLITS_VEC4 =
    SHADOW_DIRECTIONAL_BIASES_VEC4 + MAX_DIRECTIONAL_LIGHTS;

export const SHADOW_DIRECTIONAL_PARAMS_VEC4 =
    SHADOW_DIRECTIONAL_SPLITS_VEC4 + MAX_DIRECTIONAL_LIGHTS;

export const SHADOW_DIRECTIONAL_MATRICES_VEC4 =
    SHADOW_DIRECTIONAL_PARAMS_VEC4 + MAX_DIRECTIONAL_LIGHTS;

export const SHADOW_SPOT_BIASES_VEC4 =
    SHADOW_DIRECTIONAL_MATRICES_VEC4 + MAX_DIRECTIONAL_LIGHTS * MAX_DIRECTIONAL_SHADOW_CASCADES * 4;

export const SHADOW_SPOT_MATRICES_VEC4 = SHADOW_SPOT_BIASES_VEC4 + MAX_SPOT_LIGHTS;

export const SHADOW_POINT_BIASES_VEC4 = SHADOW_SPOT_MATRICES_VEC4 + MAX_SPOT_LIGHTS * 4;

export const SHADOW_POINT_MATRICES_VEC4 = SHADOW_POINT_BIASES_VEC4 + MAX_POINT_LIGHTS;

const FRAME_VEC4_COUNT = SHADOW_POINT_MATRICES_VEC4 + MAX_POINT_LIGHTS * 6 * 4;

export const FRAME_RECORD_BYTES = FRAME_VEC4_COUNT * 16;

export const INDIRECT_ARGUMENT_BYTES = 20;

// The draw-local visible-range base is exposed through a statically aligned storage binding.
// WebGPU's default/minimum storage offset alignment is at most 256 bytes, so one record per
// aligned stride is portable without requesting the optional indirect-first-instance feature.
export const BUCKET_OFFSET_STRIDE_BYTES = 256;

export const BUCKET_OFFSET_STRIDE_WORDS = BUCKET_OFFSET_STRIDE_BYTES / 4;

export const STATS_BYTES = 16;

// WebGPU guarantees at least an 8192-wide 2D texture. Factories specialize the shader and graph
// to the exact configured viewport pyramid while this remains the portable upper bound.
const MAX_HIZ_LEVEL_COUNT = 13;

export const MAX_HIZ_OCCLUSION_DIAMETER = 1 << MAX_HIZ_LEVEL_COUNT;

export const OBJECT_ACTIVE_FLAG = 1;

export const OBJECT_FRUSTUM_CULLING_FLAG = 2;

export const OBJECT_HIZ_STABLE_FLAG = 4;

export const OBJECT_MOTION_HISTORY_FLAG = 8;

export const OBJECT_MOTION_CHANGED_FLAG = 16;

export const OBJECT_RECEIVE_SHADOW_FLAG = 32;

export const OBJECT_CAST_SHADOW_FLAG = 64;

export const OBJECT_SHADOW_DIRTY_FLAG = 128;

export const LIGHT_COOKIE_FLAG = 1;

export const LIGHT_IES_FLAG = 2;

export const CULL_WORKGROUP_SIZE = 64;

export const SHADOW_FRAME_STRIDE_BYTES = 768;

export const SHADOW_FRAME_WORDS = SHADOW_FRAME_STRIDE_BYTES / 4;

export const SHADOW_FRAME_BINDING_BYTES = FRAME_BASE_VEC4_COUNT * 16;

export const PREFIX_WORKGROUP_SIZE = 256;
