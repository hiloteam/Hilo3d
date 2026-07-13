#version 300 es
precision highp float;
uniform sampler2D u_diffuse;
in vec2 v_uv;
layout(location = 0) out vec4 fragmentColor;
void main(void) {
    fragmentColor = texture(u_diffuse, v_uv);
}
