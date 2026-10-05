import * as H from '../../src/Hilo3d';

H.registerUniformBlockBinding('PianoNebulaBlock');
/** Example-owned, 16-byte std140 frame block: seconds, note energy, enabled, viewport aspect. */
export const PIANO_NEBULA_LAYOUT = H.createStd140Layout({ u_nebula: 'vec4' });

export const PIANO_NEBULA_VERTEX_SOURCE = `#version 300 es
precision highp float;
in vec3 a_position;
in vec2 a_texcoord0;
out vec2 v_uv;
void main() {
    // Procedural coordinates are top-left logical image coordinates; no textures are sampled.
    v_uv = vec2(a_texcoord0.x, 1.0 - a_texcoord0.y);
    gl_Position = vec4(a_position.xy, 0.999, 1.0);
}`;

export const PIANO_NEBULA_FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 v_uv;
layout(std140) uniform PianoNebulaBlock {
    vec4 u_nebula;
};
layout(location = 0) out vec4 fragmentColor;

float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), f.x),
               mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0)), f.x), f.y);
}
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.52;
    const mat2 turn = mat2(1.62, 1.17, -1.17, 1.62);
    for (int octave = 0; octave < 5; octave++) {
        value += noise(p) * amplitude;
        p = turn * p + vec2(7.3, 4.1);
        amplitude *= 0.48;
    }
    return value;
}
float fineStars(vec2 p, float scale, float threshold, float time) {
    vec2 grid = p * scale;
    vec2 cell = floor(grid);
    vec2 local = fract(grid) - vec2(0.5);
    float seed = hash21(cell + vec2(12.7, 8.3));
    float star = pow(max(0.0, 1.0 - length(local) * 2.0), 14.0);
    return star * step(threshold, seed) * (0.72 + 0.28 * sin(time + seed * 113.0));
}
void main() {
    float time = u_nebula.x * 0.027;
    float energy = clamp(u_nebula.y, 0.0, 1.0);
    vec2 p = (v_uv - 0.5) * vec2(u_nebula.w, 1.0);
    // Counter-moving noise layers produce rolling dust instead of sliding a static picture.
    vec2 drift = vec2(time * 0.23, -time * 0.16);
    vec2 warp = vec2(fbm(p * 2.1 + drift), fbm(p * 2.1 + vec2(8.4, 3.2) - drift * 0.7));
    vec2 folded = p * 3.25 + (warp - 0.5) * 2.8;
    float cloud = fbm(folded + vec2(time * 0.1, 0.0));
    float detail = fbm(p * 13.5 + warp * 4.2 - drift);
    float dust = fbm(p * 5.8 + warp * 3.0 + vec2(-4.6, time * 0.18));
    float bandPosition = p.y - p.x * 0.28 - 0.1 + (warp.x - 0.5) * 0.48;
    float band = exp(-bandPosition * bandPosition * 13.0);
    float wisps = smoothstep(0.31, 0.75, cloud + (detail - 0.5) * 0.32);
    float density = wisps * band;
    float filaments = pow(clamp(1.0 - abs(cloud - 0.57) * 5.4, 0.0, 1.0), 4.0);
    filaments *= smoothstep(0.43, 0.77, detail) * band;
    float darkLanes = smoothstep(0.43, 0.68, dust) * smoothstep(0.37, 0.63, detail);
    float violet = smoothstep(-0.1, 0.8, p.x) * smoothstep(0.38, 0.68, warp.y);
    vec3 gas = mix(vec3(0.012, 0.076, 0.22), vec3(0.12, 0.027, 0.24), violet * 0.72);
    vec3 radiance = vec3(0.00008, 0.00012, 0.0003);
    radiance += gas * density * 1.8;
    radiance += vec3(0.06, 0.16, 0.27) * filaments * 1.6;
    radiance *= 1.0 - darkLanes * 0.87;
    // Silence leaves almost no gas visible; the musical envelope reveals it behind the instrument.
    vec2 lightField = (v_uv - vec2(0.6, 0.53)) * vec2(u_nebula.w, 1.0);
    float localReveal = exp(-dot(lightField, lightField) * 5.8);
    radiance *= 0.0025 + energy * energy * 0.16 * localReveal;
    float farStars = fineStars(p + vec2(time * 0.002, 0.0), 145.0, 0.987, time * 0.9);
    farStars += fineStars(p + vec2(7.3, 1.2), 263.0, 0.997, time * 0.7) * 0.7;
    radiance += vec3(0.52, 0.68, 1.0) * farStars * (0.018 + energy * 0.07);
    float leftQuiet = mix(0.36, 1.0, smoothstep(0.04, 0.47, v_uv.x));
    radiance *= leftQuiet;
    fragmentColor = vec4(radiance * u_nebula.z, 1.0);
}`;

export interface PianoNebula {
    update(seconds: number, energy: number): void;
    setEnabled(enabled: boolean): void;
    dispose(): void;
}

/** One ordinary scene draw, before opaque objects, through the shared Render Graph/RHI. */
export function createPianoNebula(stage: H.Stage, camera: H.PerspectiveCamera): PianoNebula {
    const frame = H.UniformBuffer.fromSchema(PIANO_NEBULA_LAYOUT);
    const parameters = new Float32Array([0, 0, 1, camera.aspect]);
    const mesh = new H.Mesh({
        name: 'NOCTURNE procedural nebula',
        geometry: new H.PlaneGeometry({ width: 2, height: 2 }),
        material: new H.ShaderMaterial({
            sourceRevision: 'piano-procedural-nebula-v1',
            vs: PIANO_NEBULA_VERTEX_SOURCE,
            fs: PIANO_NEBULA_FRAGMENT_SOURCE,
            attributes: {
                a_position: H.MaterialAttributeSemantic.POSITION,
                a_texcoord0: H.MaterialAttributeSemantic.TEXCOORD_0
            },
            uniformBlocks: { PianoNebulaBlock: frame },
            state: { depthTest: false, depthWrite: false, cullMode: 'none' }
        }),
        renderOrder: -100000,
        frustumTest: false,
        castShadows: false,
        receiveShadows: false
    }).addTo(stage);
    frame.set('u_nebula', parameters);
    let disposed = false;
    return {
        update(seconds, energy): void {
            if (disposed) return;
            parameters[0] = seconds;
            parameters[1] = energy;
            parameters[3] = camera.aspect;
            // UniformBuffer only commits dirty bytes; the backing array is reused each frame.
            frame.set('u_nebula', parameters);
        },
        setEnabled(enabled): void {
            if (disposed) return;
            mesh.visible = enabled;
            parameters[2] = enabled ? 1 : 0;
            frame.set('u_nebula', parameters);
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            mesh.destroy(stage.renderer);
        }
    };
}
