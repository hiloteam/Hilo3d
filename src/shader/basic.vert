#pragma glslify: import('./chunk/extensions.vert');
#pragma glslify: import('./chunk/baseDefine.glsl');
#pragma glslify: import('./chunk/precision.vert');

attribute vec3 a_position;
uniform mat4 u_modelViewProjectionMatrix;

#pragma glslify: import('./chunk/unQuantize.vert');
#pragma glslify: import('./chunk/joint.vert');
#pragma glslify: import('./chunk/uv.vert');
#pragma glslify: import('./chunk/normal.vert');
#pragma glslify: import('./chunk/lightFog.vert');
#pragma glslify: import('./chunk/morph.vert');
#pragma glslify: import('./chunk/color.vert');
#pragma glslify: import('./chunk/logDepth.vert');
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

    #ifdef HILO_NORMAL_MAP
        vec4 tangent = a_tangent;
    #endif

    #pragma glslify: import('./chunk/color_main.vert');
    #pragma glslify: import('./chunk/unQuantize_main.vert');
    #pragma glslify: import('./chunk/morph_main.vert');
    #pragma glslify: import('./chunk/joint_main.vert');
    #pragma glslify: import('./chunk/uv_main.vert');
    #pragma glslify: import('./chunk/normal_main.vert');
    #pragma glslify: import('./chunk/lightFog_main.vert');

    gl_Position = u_modelViewProjectionMatrix * pos;

    #pragma glslify: import('./chunk/logDepth_main.vert');
}