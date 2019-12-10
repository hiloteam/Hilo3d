#pragma glslify: import('./chunk/extensions.vert');
#pragma glslify: import('./chunk/baseDefine.glsl');
#pragma glslify: import('./chunk/precision.vert');

attribute vec2 a_position;
attribute vec2 a_texcoord0;
varying vec2 v_texcoord0;


void main(void) {
    vec4 pos = vec4(a_position, 0.0, 1.0);
    gl_Position = pos;
    v_texcoord0 = a_texcoord0;
}