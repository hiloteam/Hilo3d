import * as Hilo3d from '../src/Hilo3d';
import { applyEnvironmentMaps } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

type ShadowMode = 0 | 1 | 2 | 4;

const FULL_CIRCLE = Math.PI * 2;
const ATLAS_SIZE = 2048;
const MSAA_SAMPLES = 4;
const BACKEND_LABELS: Readonly<Record<Hilo3d.RendererBackend, string>> = Object.freeze({
    webgl2: 'WebGL 2',
    webgpu: 'WebGPU'
});

function geometryFrom(
    positions: readonly number[],
    normals: readonly number[],
    texcoords: readonly number[],
    indices: readonly number[]
): Hilo3d.Geometry {
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(positions), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        uvs: new Hilo3d.GeometryData(new Float32Array(texcoords), 2),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function createColumnGeometry(
    topRadius: number,
    bottomRadius: number,
    sides = 32
): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const texcoords: number[] = [];
    const indices: number[] = [];
    const slope = bottomRadius - topRadius;
    const normalScale = 1 / Math.hypot(1, slope);

    for (let side = 0; side <= sides; side += 1) {
        const ratio = side / sides;
        const angle = ratio * FULL_CIRCLE;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        positions.push(
            cosine * bottomRadius,
            -0.5,
            sine * bottomRadius,
            cosine * topRadius,
            0.5,
            sine * topRadius
        );
        normals.push(
            cosine * normalScale,
            slope * normalScale,
            sine * normalScale,
            cosine * normalScale,
            slope * normalScale,
            sine * normalScale
        );
        texcoords.push(ratio, 1, ratio, 0);
    }

    for (let side = 0; side < sides; side += 1) {
        const bottom = side * 2;
        const top = bottom + 1;
        const nextBottom = bottom + 2;
        const nextTop = bottom + 3;
        indices.push(bottom, top, nextTop, bottom, nextTop, nextBottom);
    }

    const addCap = (height: number, radius: number, normalY: -1 | 1): void => {
        const centerIndex = positions.length / 3;
        positions.push(0, height, 0);
        normals.push(0, normalY, 0);
        texcoords.push(0.5, 0.5);
        for (let side = 0; side <= sides; side += 1) {
            const angle = (side / sides) * FULL_CIRCLE;
            const cosine = Math.cos(angle);
            const sine = Math.sin(angle);
            positions.push(cosine * radius, height, sine * radius);
            normals.push(0, normalY, 0);
            texcoords.push(cosine * 0.5 + 0.5, sine * 0.5 + 0.5);
        }
        for (let side = 0; side < sides; side += 1) {
            const current = centerIndex + side + 1;
            const next = current + 1;
            if (normalY > 0) indices.push(centerIndex, next, current);
            else indices.push(centerIndex, current, next);
        }
    };

    addCap(-0.5, bottomRadius, -1);
    addCap(0.5, topRadius, 1);
    return geometryFrom(positions, normals, texcoords, indices);
}

function createOpenArcGeometry(
    startAngle: number,
    sweepAngle: number,
    arcSegments = 48,
    tubeSegments = 16
): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const texcoords: number[] = [];
    const indices: number[] = [];
    const majorRadius = 1;
    const tubeRadius = 0.16;

    for (let arc = 0; arc <= arcSegments; arc += 1) {
        const u = arc / arcSegments;
        const angle = startAngle + sweepAngle * u;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        for (let tube = 0; tube <= tubeSegments; tube += 1) {
            const v = tube / tubeSegments;
            const tubeAngle = v * FULL_CIRCLE;
            const radial = Math.cos(tubeAngle);
            const depth = Math.sin(tubeAngle);
            positions.push(
                cosine * (majorRadius + tubeRadius * radial),
                sine * (majorRadius + tubeRadius * radial),
                tubeRadius * depth
            );
            normals.push(cosine * radial, sine * radial, depth);
            texcoords.push(u, v);
        }
    }

    const rowLength = tubeSegments + 1;
    for (let arc = 0; arc < arcSegments; arc += 1) {
        for (let tube = 0; tube < tubeSegments; tube += 1) {
            const current = arc * rowLength + tube;
            const nextArc = current + rowLength;
            indices.push(current, nextArc, nextArc + 1, current, nextArc + 1, current + 1);
        }
    }

    return geometryFrom(positions, normals, texcoords, indices);
}

function createRoundedSlabGeometry(segments = 64, exponent = 4.4): Hilo3d.Geometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const texcoords: number[] = [];
    const indices: number[] = [];
    const points: (readonly [number, number, number, number])[] = [];
    const power = 2 / exponent;

    for (let segment = 0; segment < segments; segment += 1) {
        const angle = (segment / segments) * FULL_CIRCLE;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        const x = Math.sign(cosine) * Math.pow(Math.abs(cosine), power);
        const z = Math.sign(sine) * Math.pow(Math.abs(sine), power);
        const gradientX = Math.sign(x) * Math.pow(Math.abs(x), exponent - 1);
        const gradientZ = Math.sign(z) * Math.pow(Math.abs(z), exponent - 1);
        const gradientLength = Math.hypot(gradientX, gradientZ) || 1;
        points.push([x, z, gradientX / gradientLength, gradientZ / gradientLength]);
    }

    const topCenter = positions.length / 3;
    positions.push(0, 0.5, 0);
    normals.push(0, 1, 0);
    texcoords.push(0.5, 0.5);
    const topStart = positions.length / 3;
    for (const [x, z] of points) {
        positions.push(x, 0.5, z);
        normals.push(0, 1, 0);
        texcoords.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    }

    const bottomCenter = positions.length / 3;
    positions.push(0, -0.5, 0);
    normals.push(0, -1, 0);
    texcoords.push(0.5, 0.5);
    const bottomStart = positions.length / 3;
    for (const [x, z] of points) {
        positions.push(x, -0.5, z);
        normals.push(0, -1, 0);
        texcoords.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    }

    for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        indices.push(topCenter, topStart + next, topStart + segment);
        indices.push(bottomCenter, bottomStart + segment, bottomStart + next);
    }

    const sideStart = positions.length / 3;
    for (const [x, z, normalX, normalZ] of points) {
        positions.push(x, -0.5, z, x, 0.5, z);
        normals.push(normalX, 0, normalZ, normalX, 0, normalZ);
        texcoords.push(0, 1, 0, 0);
    }
    for (let segment = 0; segment < segments; segment += 1) {
        const next = (segment + 1) % segments;
        const bottom = sideStart + segment * 2;
        const top = bottom + 1;
        const nextBottom = sideStart + next * 2;
        const nextTop = nextBottom + 1;
        indices.push(bottom, nextTop, nextBottom, bottom, top, nextTop);
    }

    return geometryFrom(positions, normals, texcoords, indices);
}

function requireElement<ElementType extends HTMLElement>(
    selector: string,
    constructor: new () => ElementType
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof constructor)) throw new Error(`Missing control ${selector}`);
    return element;
}

function place(
    parent: Hilo3d.Node,
    geometry: Hilo3d.Geometry,
    material: Hilo3d.Material,
    position: readonly [number, number, number],
    scale: readonly [number, number, number],
    rotation: readonly [number, number, number] = [0, 0, 0]
): Hilo3d.Mesh {
    const mesh = new Hilo3d.Mesh({
        geometry,
        material,
        useInstanced: true,
        x: position[0],
        y: position[1],
        z: position[2],
        rotationX: rotation[0],
        rotationY: rotation[1],
        rotationZ: rotation[2]
    }).addTo(parent);
    mesh.setScale(scale[0], scale[1], scale[2]);
    return mesh;
}

const sceneContext = await createExampleContext({
    camera: {
        fov: 38,
        near: 0.2,
        far: 900,
        x: 12,
        y: 46,
        z: 108
    },
    stage: {
        antialias: true,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        useInstanced: true,
        fog: new Hilo3d.Fog({
            mode: 'LINEAR',
            start: 154,
            end: 294,
            color: new Hilo3d.Color(0.73, 0.6, 0.72)
        }),
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            colorUber: {
                exposure: 0.045,
                contrast: 0.13,
                saturation: 0.1,
                temperature: 0.04,
                tint: 0.024,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.055,
                vignetteSmoothness: 0.9,
                vignetteColor: new Hilo3d.Color(0.12, 0.11, 0.27, 0.3)
            }
        })
    },
    controls: {
        enabled: true,
        enablePan: false,
        minDistance: 78,
        maxDistance: 225,
        target: new Hilo3d.Vector3(0, 6, -30),
        minPolarAngle: Math.PI * 0.18,
        maxPolarAngle: Math.PI * 0.48,
        rotateSpeed: 0.72,
        zoomSpeed: 0.8
    },
    autoStart: false
});

const { stage, renderer, camera, directionLight, ambientLight, ticker } = sceneContext;
renderer.clearColor.set(0.38, 0.45, 0.68, 1);
directionLight.amount = 3.45;
directionLight.color.set(1, 0.72, 0.46, 1);
directionLight.direction.set(-0.88, -0.68, -0.38);
ambientLight.amount = 0.022;
ambientLight.color.set(0.4, 0.5, 0.92, 1);

const shadowConfiguration: Hilo3d.DirectionalLightShadowOptions = {
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    minBias: 0.0002,
    maxBias: 0.0026,
    cascadeCount: 4,
    cascadeSplitLambda: 0.35,
    cascadeMaxDistance: 200,
    cascadeBlend: 0.1,
    stabilizeCascades: true,
    shadowStrength: 3
};
directionLight.shadow = shadowConfiguration;

function ceramic(red: number, green: number, blue: number, roughness = 0.61): Hilo3d.PBRMaterial {
    return new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(red, green, blue),
        metallic: 0,
        roughness,
        clearcoatFactor: 0.035,
        clearcoatRoughnessFactor: 0.76,
        ior: 1.42,
        specularEnvIntensity: 0.34,
        diffuseEnvIntensity: 0.86,
        castShadows: true,
        receiveShadows: true
    });
}

const porcelain = ceramic(0.9, 0.86, 0.74, 0.7);
const porcelainLight = ceramic(0.98, 0.91, 0.75, 0.68);
const coral = ceramic(0.94, 0.3, 0.28, 0.54);
const saffron = ceramic(0.98, 0.62, 0.14, 0.58);
const mint = ceramic(0.17, 0.68, 0.59, 0.57);
const cobalt = ceramic(0.17, 0.32, 0.72, 0.55);
const lilac = ceramic(0.57, 0.42, 0.8, 0.59);
const rose = ceramic(0.88, 0.48, 0.58, 0.6);
const underside = ceramic(0.24, 0.19, 0.38, 0.76);

const environmentMaps = await loadEnvironmentMaps();
applyEnvironmentMaps(
    [porcelain, porcelainLight, coral, saffron, mint, cobalt, lilac, rose, underside],
    environmentMaps
);

const skyMaterial = new Hilo3d.ShaderMaterial({
    shaderCacheId: 'FourCourtsProceduralSky',
    depthTest: false,
    depthMask: false,
    renderOrder: -1000,
    castShadows: false,
    receiveShadows: false,
    needBasicUniforms: false,
    needBasicAttributes: false,
    attributes: {
        a_position: 'POSITION'
    },
    vs: `#version 300 es
        precision highp float;
        in vec2 a_position;
        out vec2 v_uv;
        void main(void) {
            v_uv = a_position * 0.5 + 0.5;
            gl_Position = vec4(a_position, 0.9999, 1.0);
        }
    `,
    fs: `#version 300 es
        precision highp float;
        in vec2 v_uv;
        layout(location = 0) out vec4 fragmentColor;

        float hash(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
        }

        float noise(vec2 point) {
            vec2 cell = floor(point);
            vec2 fraction = fract(point);
            fraction = fraction * fraction * (3.0 - 2.0 * fraction);
            float a = hash(cell);
            float b = hash(cell + vec2(1.0, 0.0));
            float c = hash(cell + vec2(0.0, 1.0));
            float d = hash(cell + vec2(1.0, 1.0));
            return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
        }

        float fbm(vec2 point) {
            float value = 0.0;
            float amplitude = 0.55;
            for (int octave = 0; octave < 5; octave += 1) {
                value += noise(point) * amplitude;
                point = mat2(1.63, 1.17, -1.17, 1.63) * point + 0.19;
                amplitude *= 0.48;
            }
            return value;
        }

        void main(void) {
            vec3 horizon = vec3(1.03, 0.58, 0.39);
            vec3 lavender = vec3(0.55, 0.48, 0.76);
            vec3 zenith = vec3(0.23, 0.35, 0.63);
            vec3 color = mix(horizon, lavender, smoothstep(0.18, 0.67, v_uv.y));
            color = mix(color, zenith, smoothstep(0.66, 1.0, v_uv.y));

            vec2 sunPoint = vec2(0.73, 0.7);
            float sunDistance = length((v_uv - sunPoint) * vec2(1.55, 1.0));
            float sunGlow = exp(-sunDistance * sunDistance * 17.0);
            float sunCore = 1.0 - smoothstep(0.026, 0.032, sunDistance);
            color += vec3(0.42, 0.18, 0.035) * sunGlow;
            color = mix(color, vec3(1.22, 0.84, 0.34), sunCore * 0.96);

            vec2 cloudPoint = vec2(v_uv.x * 3.15, v_uv.y * 5.2);
            float cloudNoise = fbm(cloudPoint + vec2(0.0, 1.6));
            float cloudBand =
                smoothstep(0.56, 0.73, cloudNoise + sin(v_uv.x * 9.0) * 0.045) *
                smoothstep(0.24, 0.43, v_uv.y) *
                (1.0 - smoothstep(0.82, 0.96, v_uv.y));
            float fineCloud = fbm(cloudPoint * 1.7 + vec2(4.2, -2.1));
            cloudBand *= smoothstep(0.42, 0.68, fineCloud);

            vec3 cloudShadow = vec3(0.56, 0.53, 0.76);
            vec3 cloudLight = vec3(1.05, 0.87, 0.69);
            float cloudLightness = smoothstep(0.49, 0.76, fineCloud + v_uv.y * 0.1);
            vec3 cloudColor = mix(cloudShadow, cloudLight, cloudLightness);
            color = mix(color, cloudColor, cloudBand * 0.72);

            float horizonGlow = exp(-abs(v_uv.y - 0.34) * 12.0);
            color = mix(color, vec3(1.04, 0.67, 0.48), horizonGlow * 0.14);
            fragmentColor = vec4(color, 1.0);
        }
    `
});

const screenGeometry = new Hilo3d.Geometry({
    mode: Hilo3d.constants.TRIANGLE_STRIP,
    vertices: new Hilo3d.GeometryData(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2)
});
new Hilo3d.Mesh({
    geometry: screenGeometry,
    material: skyMaterial,
    frustumTest: false
}).addTo(stage);

const unitBox = new Hilo3d.BoxGeometry().setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);
const sphere = new Hilo3d.SphereGeometry({
    radius: 1,
    heightSegments: 24,
    widthSegments: 32
});
const pillar = createColumnGeometry(1, 1);
const taper = createColumnGeometry(0.05, 1, 36);
const crescent = createOpenArcGeometry((-145 * Math.PI) / 180, (286 * Math.PI) / 180);
const platformSlab = createRoundedSlabGeometry();

function addPlatform(
    x: number,
    y: number,
    z: number,
    width: number,
    depth: number,
    rotationY: number
): Hilo3d.Node {
    const platform = new Hilo3d.Node({ x, y, z, rotationY }).addTo(stage);
    place(platform, platformSlab, underside, [0, -1.05, 0], [width * 0.53, 1.65, depth * 0.54]);
    place(platform, platformSlab, porcelain, [0, 0, 0], [width * 0.5, 0.62, depth * 0.5]);
    place(
        platform,
        platformSlab,
        porcelainLight,
        [0, 0.42, -0.15],
        [width * 0.47, 0.16, depth * 0.46]
    );
    return platform;
}

function addPillar(
    parent: Hilo3d.Node,
    x: number,
    z: number,
    radius: number,
    height: number,
    material: Hilo3d.Material
): void {
    place(parent, pillar, material, [x, height * 0.5 + 0.55, z], [radius, height, radius]);
}

function addOrb(
    parent: Hilo3d.Node,
    x: number,
    y: number,
    z: number,
    radius: number,
    material: Hilo3d.Material
): void {
    place(parent, sphere, material, [x, y, z], [radius, radius, radius]);
}

const nearCourt = addPlatform(24, 23, 68, 18, 11, -11);
place(nearCourt, crescent, coral, [1.8, 5.5, -0.3], [3.6, 3.6, 3.6], [0, -7, -4]);
addOrb(nearCourt, 1.8, 5.45, -0.5, 1.16, cobalt);
addPillar(nearCourt, -4.8, 1.4, 0.34, 5.7, saffron);
addOrb(nearCourt, -4.8, 6.45, 1.4, 0.62, rose);
addPillar(nearCourt, 5.4, 2.0, 0.26, 3.8, mint);
addOrb(nearCourt, -0.9, 1.4, 3.1, 0.82, saffron);
place(nearCourt, unitBox, lilac, [-3.1, 1.3, -3.0], [1.9, 1.7, 1.9], [0, 22, 0]);

const chimeCourt = addPlatform(-9, 7.5, 32, 25, 15, 13);
place(chimeCourt, crescent, mint, [-3.4, 6.4, 0.1], [4.1, 4.1, 4.1], [0, 12, 18]);
addOrb(chimeCourt, -3.4, 6.35, -0.2, 1.25, coral);
const chimePositions = [
    [2.0, -2.4, 6.0, cobalt],
    [4.2, -1.2, 9.4, saffron],
    [6.3, -0.1, 7.4, rose],
    [8.1, 1.0, 5.2, lilac]
] as const;
for (const [x, z, height, material] of chimePositions) {
    addPillar(chimeCourt, x, z, 0.25, height, material);
    addOrb(chimeCourt, x, height + 0.7, z, 0.48, porcelainLight);
}
place(chimeCourt, unitBox, saffron, [5.1, 1.4, 4.0], [3.4, 1.7, 3.4], [0, -18, 0]);

const prismCourt = addPlatform(26, 5, 0, 33, 18, -9);
place(prismCourt, taper, saffron, [0, 5.4, -0.3], [3.2, 10.2, 3.2], [0, 18, 0]);
place(prismCourt, crescent, lilac, [0, 11.3, -0.3], [3.25, 3.25, 3.25], [0, -12, 14]);
addOrb(prismCourt, -5.2, 2.05, 2.4, 1.55, mint);
addOrb(prismCourt, 5.2, 1.65, 1.2, 1.2, coral);
addPillar(prismCourt, 7.3, -3.2, 0.38, 6.8, cobalt);
place(prismCourt, unitBox, rose, [-7.4, 1.55, -3.6], [3.2, 2.2, 3.2], [0, 28, 0]);

const horizonCourt = addPlatform(-20, 8.5, -84, 45, 22, 8);
place(horizonCourt, crescent, cobalt, [-2.5, 8.6, 0], [5.9, 5.9, 5.9], [0, 10, -8]);
addOrb(horizonCourt, -2.5, 8.55, -0.4, 1.8, saffron);
addPillar(horizonCourt, -10.5, -1.4, 0.44, 10.4, coral);
addPillar(horizonCourt, 7.6, -2.4, 0.34, 8.5, mint);
addPillar(horizonCourt, 10.2, -0.7, 0.3, 6.3, lilac);
addOrb(horizonCourt, -10.5, 11.45, -1.4, 0.72, porcelainLight);
addOrb(horizonCourt, 7.6, 9.45, -2.4, 0.62, porcelainLight);
addOrb(horizonCourt, 10.2, 7.25, -0.7, 0.55, porcelainLight);
place(horizonCourt, unitBox, rose, [8.4, 1.75, 4.2], [4.4, 2.6, 4.4], [0, -16, 0]);

const fillLight = new Hilo3d.AreaLight({
    color: new Hilo3d.Color(0.32, 0.46, 1),
    amount: 0.004,
    width: 90,
    height: 46,
    x: 45,
    y: 68,
    z: 16
}).addTo(stage);
fillLight.lookAt(new Hilo3d.Vector3(0, 3, -80));

const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-cascade-count]')];
const stabilizeToggle = requireElement('#stabilizeToggle', HTMLButtonElement);
const lambdaControl = requireElement('#lambdaControl', HTMLInputElement);
const blendControl = requireElement('#blendControl', HTMLInputElement);
const strengthControl = requireElement('#strengthControl', HTMLInputElement);
const distanceControl = requireElement('#distanceControl', HTMLInputElement);
const lambdaOutput = requireElement('#lambdaOutput', HTMLOutputElement);
const blendOutput = requireElement('#blendOutput', HTMLOutputElement);
const strengthOutput = requireElement('#strengthOutput', HTMLOutputElement);
const distanceOutput = requireElement('#distanceOutput', HTMLOutputElement);
const splitTrack = requireElement('#splitTrack', HTMLDivElement);
const splitValues = requireElement('#splitValues', HTMLDivElement);
const modeSummary = requireElement('#modeSummary', HTMLElement);
const backendBadge = requireElement('#backendBadge', HTMLElement);
const splitSegments = [...splitTrack.querySelectorAll<HTMLElement>('i')];

let shadowMode: ShadowMode = 4;
let stabilization = true;

function calculateSplits(count: Exclude<ShadowMode, 0>): number[] {
    const near = camera.near;
    const far = shadowConfiguration.cascadeMaxDistance ?? camera.far ?? 200;
    const lambda = shadowConfiguration.cascadeSplitLambda ?? 0.5;
    const splits: number[] = [];
    for (let index = 1; index <= count; index += 1) {
        const ratio = index / count;
        const uniform = near + (far - near) * ratio;
        const logarithmic = near * Math.pow(far / near, ratio);
        splits.push(uniform + (logarithmic - uniform) * lambda);
    }
    return splits;
}

function refreshDepthReadout(): void {
    if (shadowMode === 0) {
        modeSummary.textContent = 'disabled';
        splitValues.textContent = 'Directional shadows off';
        splitSegments.forEach(segment => {
            segment.hidden = true;
        });
        document.body.dataset['csmSplits'] = '';
        return;
    }

    const splits = calculateSplits(shadowMode);
    const distances = splits.map((value, index) => value - (splits[index - 1] ?? camera.near));
    splitSegments.forEach((segment, index) => {
        const distance = distances[index];
        segment.hidden = distance === undefined;
        if (distance !== undefined) segment.style.flexGrow = String(distance);
    });
    modeSummary.textContent =
        shadowMode === 1
            ? `single ${String(ATLAS_SIZE)}²`
            : `${String(shadowMode)} × ${String(ATLAS_SIZE)}²`;
    splitValues.textContent = splits
        .map((split, index) => `C${String(index + 1)} ${split.toFixed(1)} m`)
        .join('  ·  ');
    document.body.dataset['csmSplits'] = splits.map(split => split.toFixed(1)).join(',');
}

function setShadowMode(mode: ShadowMode): void {
    shadowMode = mode;
    shadowConfiguration.cascadeCount = mode === 0 ? 1 : mode;
    shadowConfiguration.stabilizeCascades = stabilization;
    directionLight.shadow = mode === 0 ? null : shadowConfiguration;
    directionLight.isDirty = true;
    modeButtons.forEach(button => {
        button.setAttribute(
            'aria-pressed',
            String(Number(button.dataset['cascadeCount']) === mode)
        );
    });
    document.body.dataset['csmMode'] = mode === 0 ? 'off' : String(mode);
    refreshDepthReadout();
}

function setStabilization(enabled: boolean): void {
    stabilization = enabled;
    shadowConfiguration.stabilizeCascades = enabled;
    directionLight.isDirty = true;
    stabilizeToggle.setAttribute('aria-pressed', String(enabled));
    document.body.dataset['csmStabilized'] = String(enabled);
}

for (const button of modeButtons) {
    button.addEventListener('click', () => {
        const value = Number(button.dataset['cascadeCount']);
        if (value !== 0 && value !== 1 && value !== 2 && value !== 4) {
            throw new RangeError(`Unsupported cascade count ${String(value)}`);
        }
        setShadowMode(value);
    });
}

stabilizeToggle.addEventListener('click', () => {
    setStabilization(!stabilization);
});

lambdaControl.addEventListener('input', () => {
    shadowConfiguration.cascadeSplitLambda = lambdaControl.valueAsNumber;
    lambdaOutput.value = lambdaControl.valueAsNumber.toFixed(2);
    directionLight.isDirty = true;
    refreshDepthReadout();
});

blendControl.addEventListener('input', () => {
    shadowConfiguration.cascadeBlend = blendControl.valueAsNumber;
    blendOutput.value = `${String(Math.round(blendControl.valueAsNumber * 100))}%`;
    directionLight.isDirty = true;
});

strengthControl.addEventListener('input', () => {
    shadowConfiguration.shadowStrength = strengthControl.valueAsNumber;
    strengthOutput.value = strengthControl.valueAsNumber.toFixed(2);
    directionLight.isDirty = true;
    document.body.dataset['csmStrength'] = strengthControl.value;
});

distanceControl.addEventListener('input', () => {
    shadowConfiguration.cascadeMaxDistance = distanceControl.valueAsNumber;
    distanceOutput.value = `${String(distanceControl.valueAsNumber)} m`;
    directionLight.isDirty = true;
    refreshDepthReadout();
});

const handleKeyboard = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === 'Digit1') setShadowMode(1);
    else if (event.code === 'Digit2') setShadowMode(2);
    else if (event.code === 'Digit4') setShadowMode(4);
    else if (event.code === 'KeyO') setShadowMode(shadowMode === 0 ? 4 : 0);
    else if (event.code === 'KeyS') setStabilization(!stabilization);
};
window.addEventListener('keydown', handleKeyboard);

backendBadge.textContent = `${BACKEND_LABELS[renderer.backend]} · ${String(MSAA_SAMPLES)}× MSAA`;
document.body.dataset['csmMsaa'] = String(MSAA_SAMPLES);
document.body.dataset['csmStrength'] = strengthControl.value;
setShadowMode(4);
setStabilization(true);
ticker.start();
document.body.dataset['csmReady'] = 'true';

window.addEventListener(
    'pagehide',
    () => {
        window.removeEventListener('keydown', handleKeyboard);
        sceneContext.dispose();
    },
    { once: true }
);
