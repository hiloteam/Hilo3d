#version 300 es
precision highp float;
in vec3 a_pos;
in vec2 a_uv;
out vec2 v_uv;
layout(std140) uniform ShaderLoaderBlock {
    mat4 u_mat;
    float u_diff;
};
void main(void) {
    v_uv = a_uv;
    vec4 pos = vec4(a_pos, 1.0);
    float angle = pos.x * pos.y * 30.0 + u_diff;
    pos.z = sin(angle) * 0.02;
    gl_Position = u_mat * pos;
}
