import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../material/MaterialDefinition';
import Shader from '../../../shader/Shader';
import { FullscreenRenderPass } from '../passes';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../passes/internal/PortableFullscreenShader';

/** Portable fullscreen passes for Clustered HDR bloom and display conversion. */

export const BLOOM_PREFILTER_PASS = new FullscreenRenderPass({
    name: 'Clustered Forward+ bloom prefilter',
    shader: new Shader({
        vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
        fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
layout(location=0) out vec4 color;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_scene, 0));
    vec3 value = vec3(0.0);
    value += texture(u_scene, v_uv + texel * vec2(-1.5, -1.5)).rgb;
    value += texture(u_scene, v_uv + texel * vec2( 1.5, -1.5)).rgb;
    value += texture(u_scene, v_uv + texel * vec2(-1.5,  1.5)).rgb;
    value += texture(u_scene, v_uv + texel * vec2( 1.5,  1.5)).rgb;
    value *= 0.25;
    float brightness = max(max(value.r, value.g), value.b);
    value *= max(brightness - 0.85, 0.0) / max(brightness, 0.0001);
    color = vec4(value, 1.0);
}`
    }),
    pipelineState: {
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        depthTest: false,
        depthWrite: false,
        cullMode: 'none'
    }
});

function bloomBlurPass(name: string, axis: 'x' | 'y'): FullscreenRenderPass {
    const offset = axis === 'x' ? 'vec2(texel.x, 0.0)' : 'vec2(0.0, texel.y)';
    return new FullscreenRenderPass({
        name,
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location=0) out vec4 color;
void main() {
    vec2 texel = 1.0 / vec2(textureSize(u_source, 0));
    vec2 axisOffset = ${offset};
    vec3 value = texture(u_source, v_uv).rgb * 0.227027;
    value += texture(u_source, v_uv + axisOffset * 1.384615).rgb * 0.316216;
    value += texture(u_source, v_uv - axisOffset * 1.384615).rgb * 0.316216;
    value += texture(u_source, v_uv + axisOffset * 3.230769).rgb * 0.070270;
    value += texture(u_source, v_uv - axisOffset * 3.230769).rgb * 0.070270;
    color = vec4(value, 1.0);
}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}

export const BLOOM_HORIZONTAL_PASS = bloomBlurPass('Clustered Forward+ bloom horizontal blur', 'x');

export const BLOOM_VERTICAL_PASS = bloomBlurPass('Clustered Forward+ bloom vertical blur', 'y');

export function displayPass(
    exposure: number,
    bloomStrength: number,
    autoExposure: boolean,
    toneMapping: 'aces' | 'filmic'
): FullscreenRenderPass {
    const withBloom = bloomStrength > 0;
    return new FullscreenRenderPass({
        name: `Clustered Forward+ ${toneMapping === 'aces' ? 'ACES' : 'filmic'} display transform`,
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
${withBloom ? 'uniform sampler2D u_bloom;' : ''}
${autoExposure ? 'uniform sampler2D u_autoExposure;' : ''}
layout(location=0) out vec4 color;
vec3 aces(vec3 value) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((value * (a * value + b)) / (value * (c * value + d) + e), 0.0, 1.0);
}
vec3 filmic(vec3 value) {
    value = max(value - vec3(0.004), vec3(0.0));
    return clamp((value * (6.2 * value + 0.5)) / (value * (6.2 * value + 1.7) + 0.06), 0.0, 1.0);
}
void main() {
    vec3 hdr = texture(u_scene, v_uv).rgb${withBloom ? ` + texture(u_bloom, v_uv).rgb * ${String(bloomStrength)}` : ''};
    float adaptedExposure = ${autoExposure ? 'texelFetch(u_autoExposure, ivec2(0), 0).r' : '1.0'};
    hdr *= ${String(exposure)} * max(adaptedExposure, 0.0);
    float vignette = smoothstep(0.9, 0.22, length(v_uv - vec2(0.5)));
    vec3 mapped = ${toneMapping === 'aces' ? 'aces(hdr)' : 'filmic(hdr)'} * mix(0.78, 1.0, vignette);
    color = vec4(pow(mapped, vec3(1.0 / 2.2)), 1.0);
}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}
