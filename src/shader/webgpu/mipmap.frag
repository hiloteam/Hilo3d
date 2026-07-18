#version 300 es

precision highp float;

uniform sampler2D u_sourceTexture;
layout(location = 0) out vec4 outputColor;

void main() {
    ivec2 dimensions = textureSize(u_sourceTexture, 0);
    ivec2 maximum = dimensions - ivec2(1);
    ivec2 origin = ivec2(gl_FragCoord.xy) * 2;
    vec4 a = texelFetch(u_sourceTexture, min(origin, maximum), 0);
    vec4 b = texelFetch(u_sourceTexture, min(origin + ivec2(1, 0), maximum), 0);
    vec4 c = texelFetch(u_sourceTexture, min(origin + ivec2(0, 1), maximum), 0);
    vec4 d = texelFetch(u_sourceTexture, min(origin + ivec2(1, 1), maximum), 0);
    outputColor = (a + b + c + d) * 0.25;
}
