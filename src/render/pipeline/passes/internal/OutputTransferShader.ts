/** @internal Exact linear-light to sRGB output transfer for browser presentation surfaces. */
export const LINEAR_TO_SRGB_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location = 0) out vec4 color;

vec3 linearToSRGB(vec3 value) {
    vec3 low = value * 12.92;
    vec3 high = 1.055 * pow(max(value, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return mix(high, low, lessThanEqual(value, vec3(0.0031308)));
}

void main() {
    vec4 source = texture(u_source, v_uv);
    color = vec4(linearToSRGB(max(source.rgb, vec3(0.0))), source.a);
}`;

/** @internal Preserve display-encoded values that already underwent a display transform. */
export const SRGB_PASSTHROUGH_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_source, v_uv);
}`;
