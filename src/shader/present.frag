#version 300 es

precision highp float;
precision highp sampler2D;

in vec2 v_uv;
uniform sampler2D u_sourceTexture;
layout(location = 0) out vec4 fragmentColor;

void main() {
    ivec2 dimensions = textureSize(u_sourceTexture, 0);
    ivec2 maximum = dimensions - ivec2(1);
    ivec2 coordinate = clamp(ivec2(floor(v_uv * vec2(dimensions))), ivec2(0), maximum);
    fragmentColor = texelFetch(u_sourceTexture, coordinate, 0);
}
