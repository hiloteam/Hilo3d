import * as Hilo3d from '../../src/Hilo3d';

/** Weather is independent of both the train controls and the current shadow technique. */
export type WeatherType = 'clear' | 'rain' | 'snow' | 'storm';

export interface CsmToyWeather {
    readonly lightningFlash: number;
    setWeather(type: WeatherType): void;
    setMotion(enabled: boolean): void;
    setDusk(enabled: boolean): void;
    /** One short pulse, also available when automatic flashes are reduced by accessibility settings. */
    triggerLightning(): void;
    /** Advance weather in milliseconds. */
    tick(dt: number): void;
}

const WEATHER_BLOCK_NAME = 'CsmToyWeatherBlock';
const weatherBlockSource = `layout(std140) uniform CsmToyWeatherBlock {
    float u_weatherTime;
    float u_weatherDusk;
    float u_weatherFlash;
};`;

function cameraBlocks(): string {
    const source = Hilo3d.Shader.shaders['chunk/uniformBlocks.glsl'];
    if (!source) throw new Error('Missing portable weather camera blocks');
    return source;
}

/** Initial centers and two random seeds are immutable; the vertex shader reconstructs motion. */
function precipitationGeometry(count: number): Hilo3d.Geometry {
    const positions = new Float32Array(count * 12);
    const coordinates = new Float32Array(count * 8);
    const seeds = new Float32Array(count * 8);
    const indices = new Uint16Array(count * 6);
    const corners: readonly (readonly [number, number])[] = [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
    ];
    let state = 19790623;
    const random = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
    for (let particle = 0; particle < count; particle += 1) {
        const x = random() * 47 - 23.5;
        const y = random() * 33.8 + 1.2;
        const z = random() * 86 - 53;
        const speed = random();
        const size = random();
        for (const [corner, coordinate] of corners.entries()) {
            const vertex = particle * 4 + corner;
            positions.set([x, y, z], vertex * 3);
            coordinates.set(coordinate, vertex * 2);
            seeds.set([speed, size], vertex * 2);
        }
        const start = particle * 4;
        indices.set([start, start + 1, start + 2, start, start + 2, start + 3], particle * 6);
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(positions, 3),
        uvs: new Hilo3d.GeometryData(coordinates, 2),
        uvs1: new Hilo3d.GeometryData(seeds, 2),
        indices: new Hilo3d.GeometryData(indices, 1)
    });
}

function precipitationMaterial(block: Hilo3d.UniformBuffer, snow: boolean): Hilo3d.ShaderMaterial {
    return new Hilo3d.ShaderMaterial({
        name: snow ? 'Little Sunshine / soft falling snow' : 'Little Sunshine / fine rain',
        sourceRevision: snow ? 'csm-toy-snow-v1' : 'csm-toy-rain-v1',
        compositing: { mode: 'alpha-blend', premultiplied: false },
        state: { depthWrite: false, cullMode: 'none' },
        uniformBlocks: { [WEATHER_BLOCK_NAME]: block },
        vs: `#version 300 es
precision highp float;
precision highp int;
#define HILO_VERTEX_SHADER
${cameraBlocks()}
${weatherBlockSource}
in vec3 a_position;
in vec2 a_texcoord0;
in vec2 a_texcoord1;
out vec2 v_particleUV;
out float v_particleAlpha;
void main() {
    vec2 corner = a_texcoord0 * 2.0 - 1.0;
    float speed = a_texcoord1.x;
    float seed = a_texcoord1.y;
    float time = u_weatherTime;
    vec3 position = a_position;
    ${
        snow
            ? `position.y = 1.2 + mod(a_position.y - 1.2 - time * (1.25 + speed * 1.65), 33.8);
    position.x += sin(time * (0.48 + speed * 0.25) + seed * 24.0) * 0.7;
    position.z += cos(time * 0.37 + speed * 19.0) * 0.8;`
            : `position.y = 1.2 + mod(a_position.y - 1.2 - time * (23.0 + speed * 11.0), 33.8);
    position.x = mod(a_position.x + 23.5 - time * 2.5, 47.0) - 23.5;`
    }
    vec4 viewPosition = u_viewMatrix * vec4(position, 1.0);
    ${
        snow
            ? `float radius = 0.075 + seed * seed * 0.13;
    viewPosition.xy += corner * radius;`
            : `vec3 along = mat3(u_viewMatrix) * normalize(vec3(0.085, 1.0, 0.0));
    vec2 across = vec2(along.y, -along.x) / max(length(along.xy), 0.001);
    float halfWidth = 0.035 + seed * 0.03;
    float halfLength = 0.6 + speed * 0.45;
    viewPosition.xyz += vec3(across, 0.0) * corner.x * halfWidth
        + along * corner.y * halfLength;`
    }
    gl_Position = u_projectionMatrix * viewPosition;
    v_particleUV = corner;
    v_particleAlpha = smoothstep(1.2, 2.15, position.y)
        * (1.0 - smoothstep(30.0, 35.0, position.y)) * (0.68 + seed * 0.32);
}`,
        fs: `#version 300 es
precision highp float;
precision highp int;
${weatherBlockSource}
in vec2 v_particleUV;
in float v_particleAlpha;
layout(location = 0) out vec4 fragmentColor;
void main() {
    ${
        snow
            ? `float radius = length(v_particleUV);
    float edge = max(fwidth(radius), 0.07);
    float coverage = 1.0 - smoothstep(0.63 - edge, 0.9 + edge, radius);
    float center = 1.0 - smoothstep(0.0, 0.9, radius);
    vec3 color = mix(vec3(0.67, 0.78, 0.9), vec3(0.95, 0.98, 1.0), center);
    color *= mix(1.0, 0.8, u_weatherDusk);
    float alpha = coverage * v_particleAlpha * 0.87;`
            : `float taper = 0.23 + (1.0 - v_particleUV.y) * 0.37;
    float across = abs(v_particleUV.x) / taper;
    float coverage = 1.0 - smoothstep(0.25, 1.0, across);
    coverage *= 1.0 - smoothstep(0.55, 1.0, abs(v_particleUV.y));
    vec3 color = mix(vec3(0.43, 0.62, 0.77), vec3(0.37, 0.51, 0.7), u_weatherDusk);
    float alpha = coverage * v_particleAlpha * 0.5;`
    }
    if (alpha < 0.006) discard;
    fragmentColor = vec4(color + vec3(0.35) * u_weatherFlash, alpha);
}`
    });
}

type Point3 = readonly [number, number, number];

function lightningGeometry(): Hilo3d.Geometry {
    const positions: number[] = [];
    const tangents: number[] = [];
    const coordinates: number[] = [];
    const indices: number[] = [];
    const branches: readonly (readonly Point3[])[] = [
        [
            [-5, 76, -78],
            [-2.8, 70, -78],
            [-4.6, 66, -77],
            [0.2, 60, -77],
            [-1.5, 55, -76],
            [2.7, 48, -76],
            [0.8, 44, -75],
            [4.8, 37, -75],
            [3.2, 33, -74],
            [7.8, 25, -73]
        ],
        [
            [-4.6, 66, -77],
            [-9.4, 63, -77],
            [-8.2, 59, -76],
            [-13, 55, -76]
        ],
        [
            [-1.5, 55, -76],
            [4.6, 53, -77],
            [3.9, 49, -78],
            [9.9, 45, -78]
        ],
        [
            [0.8, 44, -75],
            [-3.5, 40, -74],
            [-2, 37, -74],
            [-4.9, 32, -73]
        ]
    ];
    for (const [branchIndex, points] of branches.entries()) {
        for (let segment = 1; segment < points.length; segment += 1) {
            const from = points[segment - 1];
            const to = points[segment];
            if (!from || !to) continue;
            const tangent: Point3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
            const start = positions.length / 3;
            positions.push(...from, ...from, ...to, ...to);
            for (let corner = 0; corner < 4; corner += 1) tangents.push(...tangent);
            const width = branchIndex === 0 ? 0.72 - segment * 0.025 : 0.42 - segment * 0.045;
            coordinates.push(-1, width, 1, width, 1, width * 0.86, -1, width * 0.86);
            indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        // This custom shader uses the normal stream for the authored segment direction.
        normals: new Hilo3d.GeometryData(new Float32Array(tangents), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(coordinates), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function lightningMaterial(block: Hilo3d.UniformBuffer): Hilo3d.ShaderMaterial {
    return new Hilo3d.ShaderMaterial({
        name: 'Little Sunshine / distant branching lightning',
        sourceRevision: 'csm-toy-lightning-v1',
        compositing: { mode: 'additive', premultiplied: false },
        state: { depthWrite: false, cullMode: 'none' },
        uniformBlocks: { [WEATHER_BLOCK_NAME]: block },
        vs: `#version 300 es
precision highp float;
precision highp int;
#define HILO_VERTEX_SHADER
${cameraBlocks()}
in vec3 a_position;
in vec3 a_normal;
in vec2 a_texcoord0;
out float v_boltAcross;
void main() {
    vec4 viewPosition = u_viewMatrix * u_modelMatrix * vec4(a_position, 1.0);
    vec3 along = mat3(u_viewMatrix) * a_normal;
    vec2 across = vec2(along.y, -along.x) / max(length(along.xy), 0.001);
    viewPosition.xy += across * a_texcoord0.x * a_texcoord0.y;
    v_boltAcross = a_texcoord0.x;
    gl_Position = u_projectionMatrix * viewPosition;
}`,
        fs: `#version 300 es
precision highp float;
precision highp int;
${weatherBlockSource}
in float v_boltAcross;
layout(location = 0) out vec4 fragmentColor;
void main() {
    float across = abs(v_boltAcross);
    float core = 1.0 - smoothstep(0.12, 0.38, across);
    float halo = pow(max(0.0, 1.0 - across), 2.0) * 0.2;
    vec3 color = mix(vec3(0.48, 0.72, 1.25), vec3(2.7, 2.75, 2.65), core);
    fragmentColor = vec4(color, (core + halo) * u_weatherFlash);
}`
    });
}

/** Three small portable draws, hidden in clear weather; no per-particle runtime allocations. */
export function createCsmToyWeather(stage: Hilo3d.Stage): CsmToyWeather {
    Hilo3d.registerUniformBlockBinding(WEATHER_BLOCK_NAME);
    const block = Hilo3d.UniformBuffer.fromSchema(
        Hilo3d.createStd140Layout({
            u_weatherTime: 'float',
            u_weatherDusk: 'float',
            u_weatherFlash: 'float'
        }),
        { u_weatherTime: 0, u_weatherDusk: 0, u_weatherFlash: 0 }
    );
    const rain = new Hilo3d.Mesh({
        name: 'Toy town / fine rainfall',
        geometry: precipitationGeometry(320),
        material: precipitationMaterial(block, false),
        castShadows: false,
        receiveShadows: false,
        frustumTest: false,
        visible: false,
        renderOrder: 18
    }).addTo(stage);
    const snow = new Hilo3d.Mesh({
        name: 'Toy town / drifting snowflakes',
        geometry: precipitationGeometry(350),
        material: precipitationMaterial(block, true),
        castShadows: false,
        receiveShadows: false,
        frustumTest: false,
        visible: false,
        renderOrder: 18
    }).addTo(stage);
    const lightning = new Hilo3d.Mesh({
        name: 'Toy town / distant forked lightning',
        geometry: lightningGeometry(),
        material: lightningMaterial(block),
        castShadows: false,
        receiveShadows: false,
        frustumTest: false,
        visible: false,
        renderOrder: 17
    }).addTo(stage);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let weather: WeatherType = 'clear';
    let motionEnabled = true;
    let elapsed = 0;
    let stormElapsed = 0;
    let nextStrike = 6.2;
    let strikeCount = 0;
    let pulseRemaining = 0;
    let pulseDuration = 0.25;
    let flash = 0;
    let flashPeak = 1;
    const startLightning = (): void => {
        strikeCount += 1;
        lightning.x = Math.sin(strikeCount * 2.4) * 6;
        pulseDuration = reducedMotion.matches ? 0.6 : 0.25;
        pulseRemaining = pulseDuration;
        flashPeak = reducedMotion.matches ? 0.2 : 1;
        flash = flashPeak;
        block.set('u_weatherFlash', flash);
        lightning.visible = true;
    };
    return {
        get lightningFlash(): number {
            return flash;
        },
        setWeather(type: WeatherType): void {
            if (weather === type) return;
            weather = type;
            rain.visible = type === 'rain' || type === 'storm';
            snow.visible = type === 'snow';
            lightning.visible = false;
            pulseRemaining = 0;
            flash = 0;
            stormElapsed = 0;
            nextStrike = 6.2;
            block.set('u_weatherFlash', 0);
        },
        setMotion(enabled: boolean): void {
            motionEnabled = enabled;
        },
        setDusk(enabled: boolean): void {
            block.set('u_weatherDusk', enabled ? 1 : 0);
        },
        triggerLightning(): void {
            startLightning();
        },
        tick(dt: number): void {
            const seconds = Math.max(0, Math.min(dt, 50)) / 1000;
            // A manually triggered flash always decays, including while motion is paused.
            if (pulseRemaining > 0) {
                pulseRemaining = Math.max(0, pulseRemaining - seconds);
                flash = flashPeak * Math.pow(pulseRemaining / pulseDuration, 2);
                block.set('u_weatherFlash', flash);
                lightning.visible = pulseRemaining > 0;
            }
            if (!motionEnabled || weather === 'clear') return;
            elapsed += seconds;
            block.set('u_weatherTime', elapsed);
            if (weather !== 'storm' || reducedMotion.matches) return;
            stormElapsed += seconds;
            if (stormElapsed >= nextStrike) {
                startLightning();
                nextStrike = stormElapsed + 6.1 + (Math.sin(strikeCount * 2.17) * 0.5 + 0.5) * 3.7;
            }
        }
    };
}
