import portableCoordinates from '../../../../shader/method/portableCoordinates.glsl';

/**
 * Portable attribute-free fullscreen triangle vertex shader.
 *
 * WebGPU render attachments use a top-left texture origin, so sampled graph textures need one
 * vertical UV normalization while WebGL 2 retains its bottom-left render-target convention.
 */
export const PORTABLE_FULLSCREEN_VERTEX_SOURCE = `#version 300 es
out vec2 v_uv;
${portableCoordinates}
void main() {
    v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
    v_uv = hiloRenderTargetUV(v_uv);
}`;
