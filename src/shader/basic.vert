#include "./chunk/extensions.vert"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.vert"
#include "./chunk/uniformBlocks.glsl"

in vec3 a_position;

#include "./chunk/unQuantize.vert"
#include "./chunk/joint.vert"
#include "./chunk/uv.vert"
#include "./chunk/normal.vert"
#include "./chunk/lightFog.vert"
#include "./chunk/morph.vert"
#include "./chunk/color.vert"
#include "./chunk/logDepth.vert"
#ifdef HILO_PICKING_PASS
out vec4 v_objectIdColor;
#endif
#ifdef HILO_MOTION_VECTOR_PASS
out vec4 v_currentClipPosition;
out vec4 v_previousClipPosition;
out float v_currentViewDepth;
out float v_previousViewDepth;
flat out float v_motionHistoryValid;
#endif
void main(void) {
    vec4 pos = vec4(a_position, 1.0);
    #ifdef HILO_HAS_TEXCOORD0
        vec2 uv = a_texcoord0;
    #endif
    #ifdef HILO_HAS_TEXCOORD1
        vec2 uv1 = a_texcoord1;
    #endif
    #ifdef HILO_HAS_NORMAL
        vec3 normal = a_normal;
    #endif

    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP) || defined(HILO_NEED_TANGENT_BASIS)
        vec4 tangent = a_tangent;
    #endif

    #include "./chunk/color_main.vert"
    #include "./chunk/unQuantize_main.vert"
    #ifdef HILO_MOTION_VECTOR_PASS
        vec4 previousPos = pos;
    #endif
    #include "./chunk/morph_main.vert"
    #include "./chunk/joint_main.vert"
    #include "./chunk/uv_main.vert"
    #include "./chunk/normal_main.vert"
    #include "./chunk/lightFog_main.vert"

    vec4 currentClipPosition = u_viewProjectionMatrix * u_modelMatrix * pos;
    gl_Position = currentClipPosition;

    #ifdef HILO_MOTION_VECTOR_PASS
        #if defined(HILO_MORPH_TARGET_COUNT) && defined(HILO_MORPH_HAS_POSITION)
            previousPos.xyz += hiloPreviousMorphPositionOffset();
        #endif
        #ifdef HILO_JOINT_COUNT
            previousPos = getPreviousJointMat(a_skinWeights, a_skinIndices) * previousPos;
        #endif
        v_currentClipPosition = currentClipPosition;
        v_previousClipPosition =
            u_previousViewProjectionMatrix * u_previousModelMatrix * previousPos;
        v_currentViewDepth = abs((u_viewMatrix * u_modelMatrix * pos).z);
        v_previousViewDepth =
            abs((u_previousViewMatrix * u_previousModelMatrix * previousPos).z);
        v_motionHistoryValid = min(u_cameraHistoryValid, u_modelHistoryValid);
        #ifdef HILO_JOINT_COUNT
            v_motionHistoryValid = min(v_motionHistoryValid, u_skinHistoryValid);
        #endif
        #if defined(HILO_MORPH_TARGET_COUNT) && defined(HILO_MORPH_HAS_POSITION)
            v_motionHistoryValid = min(v_motionHistoryValid, u_morphHistoryValid);
        #endif
    #endif

    #ifdef HILO_PICKING_PASS
        v_objectIdColor = u_objectIdColor;
    #endif

    #include "./chunk/logDepth_main.vert"
}
