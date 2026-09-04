#version 300 es
precision highp float;
uniform sampler2D u_diffuse;
in vec2 v_uv;
layout(location = 0) out vec4 fragmentColor;
vec2 hiloTextureUV(vec2 uv) {
#ifdef HILO_WEBGPU
    return uv;
#else
    return vec2(uv.x, 1.0 - uv.y);
#endif
}
void main(void) {
    fragmentColor = texture(u_diffuse, hiloTextureUV(v_uv));
}
