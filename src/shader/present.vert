#version 300 es

precision highp float;

#include "./method/portableCoordinates.glsl"

out vec2 v_uv;

void main() {
    vec2 positions[3] = vec2[](
        vec2(-1.0, -1.0),
        vec2(3.0, -1.0),
        vec2(-1.0, 3.0)
    );
    vec2 position = positions[gl_VertexID];
    gl_Position = vec4(position, 0.0, 1.0);
    v_uv = hiloRenderTargetUV(position * 0.5 + 0.5);
}
