import * as H from '../../src/Hilo3d';

H.registerUniformBlockBinding('PianoMagicPlumeBlock');
const basicVertexSource = H.Shader.shaders['basic.vert'];
if (!basicVertexSource)
    throw new Error('The piano plume requires the built-in basic vertex shader.');

/** Example-owned animation block; per-note parameters travel in the shared vertex stream. */
export const PIANO_MAGIC_PLUME_LAYOUT = H.createStd140Layout({ u_flow: 'vec4' });
// The material has no texture slot from which the built-in path could infer UV usage.
export const PIANO_MAGIC_PLUME_VERTEX_SOURCE = `#ifndef HILO_HAS_TEXCOORD0
#define HILO_HAS_TEXCOORD0 1
#endif
${basicVertexSource}`;

/**
 * A texture-free layer of rolling luminous fluid. UV y rises from the key to the tip;
 * vertex color carries seed, intensity, normalized head height and key velocity, respectively.
 * These are procedural coordinates, so no managed-image or attachment UV boundary is crossed.
 */
export const PIANO_MAGIC_PLUME_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_texcoord0;
in vec4 v_color;
layout(std140) uniform PianoMagicPlumeBlock {
    vec4 u_flow;
};
layout(location = 0) out vec4 fragmentColor;

float plumeHash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float plumeNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(plumeHash(cell), plumeHash(cell + vec2(1.0, 0.0)), f.x),
               mix(plumeHash(cell + vec2(0.0, 1.0)), plumeHash(cell + vec2(1.0)), f.x), f.y);
}
float plumeFbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.57;
    const mat2 turn = mat2(1.6, 1.2, -1.2, 1.6);
    for (int octave = 0; octave < 3; octave++) {
        value += plumeNoise(p) * amplitude;
        p = turn * p + vec2(4.7, 1.8);
        amplitude *= 0.45;
    }
    return value;
}
void main() {
    float height = v_texcoord0.y;
    float seed = v_color.x;
    float intensity = clamp(v_color.y, 0.0, 1.0);
    if (intensity == 0.0) {
        fragmentColor = vec4(0.0);
        return;
    }
    float head = clamp(v_color.z, 0.02, 1.0);
    float velocity = clamp(v_color.w, 0.0, 1.0);
    float time = u_flow.x * (0.56 + velocity * 0.16);
    float phase = seed * 6.2831853;
    float x = v_texcoord0.x - 0.5;
    float rising = height * 5.2 - time;
    vec2 p = vec2(x * 3.7 + seed * 19.0, rising + seed * 8.3);
    // Six low-frequency noise evaluations shape the volume. Two finer samples reveal crests.
    float flow = plumeFbm(p);
    float fold = plumeFbm(p * vec2(1.35, 0.86) + vec2(6.4, -time * 0.12));
    float detail = plumeNoise(p * vec2(2.7, 1.8) + (flow - 0.5) * 1.4);
    float crestNoise = plumeNoise(vec2(x * 8.7 + seed * 31.0, rising * 2.3 + 4.1));
    float curl = sin(rising * 1.75 + phase);
    float center = curl * (0.018 + height * 0.115) + (flow - 0.48) * height * 0.46;
    float distance = x - center;
    float swell = 0.072 + height * 0.11 + fold * 0.095;
    float body = exp(-distance * distance / (swell * swell));
    float billow = smoothstep(0.22, 0.76, flow * 0.56 + fold * 0.44);
    float cloud = body * (0.19 + billow * 0.74) * (0.76 + detail * 0.24);

    // Broad, overlapping folds read as translucent depth. They move with the rising field,
    // changing thickness and branching rather than tracing two continuous neon lines.
    float split = sin(rising * 2.4 + phase + 1.3) * (0.014 + height * 0.075);
    float foldWidth = 0.036 + fold * 0.053 + height * 0.026;
    float nearFold = distance - split - (fold - 0.45) * 0.12;
    float farFold = distance + split * 1.6 + (flow - 0.45) * 0.13;
    float nearLight = exp(-nearFold * nearFold / (foldWidth * foldWidth));
    float farLight = exp(-farFold * farFold / (foldWidth * foldWidth * 1.9));
    float foldLight = (nearLight * 0.64 + farLight * 0.28) * billow * (0.32 + detail * 0.68);
    float crest = nearLight * nearLight * smoothstep(0.64, 0.86, crestNoise);
    crest *= smoothstep(0.47, 0.79, detail) * billow;
    float hotBase = exp(-x * x * 240.0) * exp(-height * 12.0);

    float sides = 1.0 - smoothstep(0.30, 0.475, abs(x));
    float tip = 1.0 - smoothstep(max(0.015, head - 0.30), head, height);
    float base = smoothstep(0.0, 0.022, height);
    float envelope = sides * tip * base * intensity;
    float density = cloud * 0.68 + foldLight * 0.48 + crest * 0.22 + hotBase * 0.3;
    vec3 deepBlue = mix(vec3(0.018, 0.062, 0.23), vec3(0.027, 0.115, 0.38), fold);
    vec3 radiance = deepBlue * cloud;
    radiance += mix(vec3(0.028, 0.22, 0.58), vec3(0.10, 0.48, 0.86), detail) * foldLight;
    radiance += vec3(0.42, 0.86, 1.12) * crest * 0.78;
    radiance += vec3(0.038, 0.25, 0.50) * hotBase;
    // RGB already contains density and coverage; the material uses ONE + ONE blending.
    fragmentColor = vec4(radiance * envelope, clamp(density * envelope, 0.0, 1.0));
}`;

export interface MagicPlumeMaterial {
    readonly material: H.ShaderMaterial;
    update(seconds: number): void;
}

/** One reusable material for a batch of world-space, key-anchored plume quads. */
export function createMagicPlumeMaterial(): MagicPlumeMaterial {
    const frame = H.UniformBuffer.fromSchema(PIANO_MAGIC_PLUME_LAYOUT);
    const parameters = new Float32Array(4);
    frame.set('u_flow', parameters);
    const material = new H.ShaderMaterial({
        sourceRevision: 'piano-magic-plume-v2',
        vs: PIANO_MAGIC_PLUME_VERTEX_SOURCE,
        fs: PIANO_MAGIC_PLUME_FRAGMENT_SOURCE,
        attributes: {
            a_position: H.MaterialAttributeSemantic.POSITION,
            a_texcoord0: H.MaterialAttributeSemantic.TEXCOORD_0,
            a_color: H.MaterialAttributeSemantic.COLOR_0
        },
        uniformBlocks: { PianoMagicPlumeBlock: frame },
        compositing: { mode: 'additive', premultiplied: true },
        state: { depthWrite: false, cullMode: 'none' }
    });
    return {
        material,
        update(seconds): void {
            parameters[0] = seconds;
            frame.set('u_flow', parameters);
        }
    };
}
