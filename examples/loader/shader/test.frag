#version 300 es
precision highp float;
// Fetched as standalone GLSL by ShaderMaterialLoader, without build-time includes. This is the
// same managed-image boundary as src/shader/method/portableCoordinates.glsl: logical row 0 is top.
vec2 hiloTextureUV(vec2 uv) {
#ifdef HILO_WEBGPU
    return uv;
#else
    return vec2(uv.x, 1.0 - uv.y);
#endif
}
uniform sampler2D u_diffuse;
in vec2 v_uv;
layout(location = 0) out vec4 fragmentColor;
void main(void) {
    fragmentColor = texture(u_diffuse, hiloTextureUV(v_uv));
}
