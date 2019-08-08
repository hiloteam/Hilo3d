#ifdef GL_ES
precision highp float;
#endif
attribute vec3 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
uniform mat4 u_mat;
uniform float u_diff;
void main(void) {
    v_uv = a_uv;
    vec4 pos = vec4(a_pos, 1.0);
    float angle = pos.x * pos.y * 30.0 + u_diff;
    pos.z = sin(angle) * 0.02;
    gl_Position = u_mat * pos;
}