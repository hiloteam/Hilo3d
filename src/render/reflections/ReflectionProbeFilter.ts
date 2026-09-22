import Shader from '../../shader/Shader';
import portableCoordinates from '../../shader/method/portableCoordinates.glsl';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../material/MaterialDefinition';
import { FullscreenRenderPass } from '../pipeline/passes/FullscreenRenderPass';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../pipeline/passes/internal/PortableFullscreenShader';
import UniformBuffer from '../UniformBuffer';
import { createStd140Layout } from '../ubo/Std140Layout';
import { registerUniformBlockBinding } from '../ubo/UniformBlockBindings';

registerUniformBlockBinding('ReflectionFilterBlock');
const layout = createStd140Layout({ u_filter: 'vec4' });
const state = {
    ...DEFAULT_MATERIAL_PIPELINE_STATE,
    depthTest: false,
    depthWrite: false,
    cullMode: 'none'
} as const;

/** @internal One immutable roughness band; GPU work stays in the shared raster/Naga path. */
export function createReflectionFilterPass(
    resolution: number,
    roughness: number,
    samples: number
): FullscreenRenderPass {
    return new FullscreenRenderPass({
        name: `Reflection GGX roughness ${String(roughness)}`,
        pipelineState: state,
        uniformBuffers: [new UniformBuffer(layout, { u_filter: [resolution, roughness, 0, 0] })],
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
uniform sampler2D u_faces;
layout(std140) uniform ReflectionFilterBlock { vec4 u_filter; };
layout(location=0) out vec4 color;
${portableCoordinates}
const float PI = 3.141592653589793;

vec3 sampleFaces(vec3 d) {
    vec3 a = abs(d);
    vec2 uv;
    float face;
    if (a.x >= a.y && a.x >= a.z) {
        if (d.x > 0.0) { uv = vec2(-d.z, -d.y) / a.x; face = 0.0; }
        else { uv = vec2(d.z, -d.y) / a.x; face = 1.0; }
    } else if (a.y >= a.z) {
        if (d.y > 0.0) { uv = vec2(d.x, d.z) / a.y; face = 2.0; }
        else { uv = vec2(d.x, -d.z) / a.y; face = 3.0; }
    } else {
        if (d.z > 0.0) { uv = vec2(d.x, -d.y) / a.z; face = 4.0; }
        else { uv = vec2(-d.x, -d.y) / a.z; face = 5.0; }
    }
    // Camera up vectors match the standard cube projection (including the downward t axis). Atlas
    // rows follow native viewport packing; normalize within the face exactly once.
    uv = uv * 0.5 + 0.5;
    float r = u_filter.x;
    uv = clamp(uv, vec2(0.5 / r), vec2(1.0 - 0.5 / r));
    vec2 atlas = (vec2(mod(face, 3.0), floor(face / 3.0)) + hiloRenderTargetUV(uv)) / vec2(3.0, 2.0);
    return textureLod(u_faces, atlas, 0.0).rgb;
}

float radicalInverse(uint bits) {
    bits = (bits << 16u) | (bits >> 16u);
    bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
    bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
    bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
    bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
    return float(bits) * 2.3283064365386963e-10;
}
void main() {
    // Fullscreen vertex pre-normalizes graph UVs. Undo that once to author the output atlas in
    // bottom-left space; source lookups perform their own explicit normalization above.
    vec2 local = hiloRenderTargetUV(v_uv);
    vec2 extent = vec2(u_filter.x * 2.0, u_filter.x);
    vec2 uv = (local * (extent + 2.0) - 1.0) / extent;
    uv = vec2(fract(uv.x), clamp(uv.y, 0.0, 1.0));
    float phi = (uv.x - 0.5) * 2.0 * PI;
    float theta = uv.y * PI;
    vec3 n = vec3(sin(theta) * sin(phi), cos(theta), sin(theta) * cos(phi));
    if (u_filter.y < 0.0001) { color = vec4(sampleFaces(n), 1.0); return; }
    vec3 up = abs(n.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 t = normalize(cross(up, n));
    vec3 b = cross(n, t);
    float alpha = max(u_filter.y * u_filter.y, 0.001);
    vec3 total = vec3(0.0);
    float weight = 0.0;
    for (uint i = 0u; i < ${String(samples)}u; i++) {
        vec2 xi = vec2(float(i) / ${String(samples)}.0, radicalInverse(i));
        float angle = 2.0 * PI * xi.x;
        float cosTheta = sqrt((1.0 - xi.y) / (1.0 + (alpha * alpha - 1.0) * xi.y));
        float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));
        vec3 h = normalize(t * cos(angle) * sinTheta + b * sin(angle) * sinTheta + n * cosTheta);
        vec3 l = normalize(2.0 * dot(n, h) * h - n);
        float nl = max(dot(n, l), 0.0);
        if (nl > 0.0) { total += sampleFaces(l) * nl; weight += nl; }
    }
    color = vec4(total / max(weight, 0.000001), 1.0);
}`
        })
    });
}

/** @internal Keeps the renderer history recipe as the sole device-generation validity source. */
export const REFLECTION_MARKER_PASS = new FullscreenRenderPass({
    name: 'Reflection capture generation',
    pipelineState: state,
    shader: new Shader({
        vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
        fs: `#version 300 es
precision highp float;
layout(location=0) out vec4 color;
void main() { color = vec4(1.0); }`
    })
});
