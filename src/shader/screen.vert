#include "./chunk/extensions.vert"
#include "./chunk/baseDefine.glsl"
#include "./chunk/precision.vert"

in vec2 a_position;
in vec2 a_texcoord0;
out vec2 v_texcoord0;


void main(void) {
    vec4 pos = vec4(a_position, 0.0, 1.0);
    gl_Position = pos;
    v_texcoord0 = a_texcoord0;
}