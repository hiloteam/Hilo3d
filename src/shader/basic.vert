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

    #if defined(HILO_NORMAL_MAP) || defined(HILO_CLEARCOAT_NORMAL_MAP)
        vec4 tangent = a_tangent;
    #endif

    #include "./chunk/color_main.vert"
    #include "./chunk/unQuantize_main.vert"
    #include "./chunk/morph_main.vert"
    #include "./chunk/joint_main.vert"
    #include "./chunk/uv_main.vert"
    #include "./chunk/normal_main.vert"
    #include "./chunk/lightFog_main.vert"

    gl_Position = u_viewProjectionMatrix * u_modelMatrix * pos;

    #ifdef HILO_PICKING_PASS
        v_objectIdColor = u_objectIdColor;
    #endif

    #include "./chunk/logDepth_main.vert"
}
