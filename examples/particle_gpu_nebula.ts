import * as Hilo3d from '../src/Hilo3d';
import * as Particle from '@hilo/addon-particle';
import { createExampleContext } from './shared/init';
import {
    createParticleTexture,
    installExampleDisposal,
    requireElement
} from './shared/particleShowcase';

const testMode = new URLSearchParams(window.location.search).get('test') === '1';
const stormCapacity = testMode ? 4_096 : 24_576;
const coreCapacity = testMode ? 2_048 : 8_192;
const sparkCapacity = testMode ? 2_048 : 8_192;
const statelessCapacity = testMode ? 2_048 : 8_192;
const portrait = window.innerWidth < 720;

const context = await createExampleContext({
    backend: 'webgpu',
    camera: { fov: 42, near: 0.1, far: 120, x: 0, y: 1.2, z: portrait ? 27 : 12.8 },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.7, knee: 0.42, intensity: 0.48, scatter: 0.68, maxLevels: 6 },
            colorUber: {
                exposure: -0.12,
                contrast: 0.12,
                saturation: -0.08,
                temperature: 0.035,
                tint: 0,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.5,
                vignetteSmoothness: 0.52,
                vignetteColor: new Hilo3d.Color(0.001, 0.002, 0.012, 0.78)
            },
            opaqueTexture: true
        })
    },
    controls: {
        target: new Hilo3d.Vector3(portrait ? 0 : -0.55, portrait ? 0.65 : 0.15, 0),
        minDistance: 6,
        maxDistance: 36,
        minPolarAngle: 0.45,
        maxPolarAngle: 2.55
    }
});
const { stage, renderer, directionLight, ambientLight } = context;

renderer.clearColor.set(0.0015, 0.0025, 0.005, 1);
directionLight.amount = 0.4;
directionLight.color.set(0.62, 0.72, 0.9, 1);
ambientLight.amount = 0.08;

// The opaque center is also the scene-depth collision surface for the resident dust.
const horizon = new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 1.16, widthSegments: 64, heightSegments: 48 }),
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.0002, 0.0003, 0.0006),
        lightType: 'NONE'
    })
}).addTo(stage);

const disk = new Hilo3d.Node({ rotationX: 23, rotationZ: -19 }).addTo(stage);

// A procedural optical veil supplies continuous gas between the individual particles.
// The ordinary material shader owns the managed texture's UV normalization.
function createCelestialTexture(kind: 'disk' | 'photon'): Hilo3d.Texture<Uint8Array> {
    const size = kind === 'disk' ? 1536 : 512;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const nx = ((x + 0.5) / size) * 2 - 1;
            const ny = ((y + 0.5) / size) * 2 - 1;
            const radius = Math.hypot(nx, ny) * (kind === 'disk' ? 4.5 : 1.55);
            const angle = Math.atan2(ny, nx);
            let alpha: number;
            let blueMix: number;
            let brightness: number;
            if (kind === 'disk') {
                const inner = Math.min(1, Math.max(0, (radius - 1.2) / 0.22));
                const outer = Math.pow(Math.max(0, 1 - Math.max(0, radius - 2.05) / 2.3), 1.7);
                const spiral = angle + Math.log(Math.max(radius, 0.2)) * 5.5;
                const billow = Math.sin(spiral * 3 + Math.sin(angle * 5) * 0.6) * 0.5 + 0.5;
                const wisps =
                    Math.sin(radius * 86 + angle * 6 + Math.sin(spiral * 7) * 1.6) * 0.5 + 0.5;
                const fine =
                    Math.sin(radius * 193 + angle * 11 + Math.cos(spiral * 5) * 2.5) * 0.5 + 0.5;
                const asymmetry = 0.52 + 0.48 * Math.pow(Math.sin(angle + 0.7) * 0.5 + 0.5, 2);
                alpha =
                    inner *
                    outer *
                    asymmetry *
                    (0.09 + billow * 0.34 + wisps * wisps * 0.22 + fine * 0.08);
                blueMix = Math.max(0, Math.min(1, (radius - 2.15) / 1.7)) * 0.96;
                brightness = 0.76 + billow * 0.24;
            } else {
                const distance = Math.abs(radius - 1.195);
                alpha =
                    Math.exp((-distance * distance) / 0.00024) * 0.95 +
                    Math.exp((-distance * distance) / 0.006) * 0.16;
                blueMix = Math.pow(Math.cos(angle - 0.5) * 0.5 + 0.5, 5) * 0.5;
                brightness = 1;
            }
            const offset = (y * size + x) * 4;
            pixels[offset] = Math.round((255 - blueMix * 160) * brightness);
            pixels[offset + 1] = Math.round(
                (kind === 'disk' ? 168 + blueMix * 16 : 216) * brightness
            );
            pixels[offset + 2] = Math.round(
                kind === 'disk' ? 83 + blueMix * 145 : 155 + blueMix * 100
            );
            pixels[offset + 3] = Math.round(Math.min(1, alpha) * 255);
        }
    }
    return new Hilo3d.Texture({
        image: pixels,
        width: size,
        height: size,
        internalFormat: Hilo3d.constants.RGBA8,
        format: Hilo3d.constants.RGBA,
        type: Hilo3d.constants.UNSIGNED_BYTE,
        wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.CLAMP_TO_EDGE,
        magFilter: Hilo3d.constants.LINEAR,
        minFilter: Hilo3d.constants.LINEAR_MIPMAP_LINEAR
    });
}

// Rotate the veil about the disk normal; keep the plane's fixed tilt on its child.
const accretionFlow = new Hilo3d.Node().addTo(disk);
new Hilo3d.Mesh({
    rotationX: -90,
    geometry: new Hilo3d.PlaneGeometry({ width: 9, height: 9 }),
    material: new Hilo3d.BasicMaterial({
        diffuse: createCelestialTexture('disk'),
        lightType: 'NONE',
        cullMode: 'none',
        compositing: { mode: 'additive', premultiplied: false },
        state: { depthWrite: false }
    })
}).addTo(accretionFlow);

const photonRing = new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 3.1, height: 3.1 }),
    material: new Hilo3d.BasicMaterial({
        diffuse: createCelestialTexture('photon'),
        lightType: 'NONE',
        cullMode: 'none',
        compositing: { mode: 'additive', premultiplied: false },
        state: { depthWrite: false }
    })
}).addTo(stage);

// Fine orbit filaments give the rotating dust a continuous, legible silhouette.
function createOrbitFilaments(): Hilo3d.Geometry {
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    for (let lane = 0; lane < 22; lane += 1) {
        const radius = 1.22 + Math.pow(lane / 21, 1.35) * 2.75;
        const width = 0.002 + (1 - lane / 22) * 0.001;
        const start = Math.sin(lane * 8.37) * Math.PI;
        const span = 3.1 + (Math.sin(lane * 3.14) * 0.5 + 0.5) * 2.9;
        for (let segment = 0; segment <= 256; segment += 1) {
            const progress = segment / 256;
            const angle = start + progress * span;
            const ripple = Math.sin(angle * 3 + lane * 0.7) * 0.012;
            const opacity =
                Math.pow(Math.sin(progress * Math.PI), 0.6) * (0.035 + 0.06 * (1 - lane / 22));
            for (let edge = -1; edge <= 1; edge += 2) {
                const radial = radius + ripple + edge * width;
                vertices.push(
                    Math.cos(angle) * radial,
                    Math.sin(angle * 2 + lane) * 0.008,
                    Math.sin(angle) * radial
                );
                colors.push(1.4, 0.55 + (lane / 22) * 0.12, 0.17 + (lane / 22) * 0.15, opacity);
            }
            if (segment < 256) {
                const vertex = (lane * 257 + segment) * 2;
                indices.push(vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(vertices), 3),
        colors: new Hilo3d.GeometryData(new Float32Array(colors), 4),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

new Hilo3d.Mesh({
    geometry: createOrbitFilaments(),
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        cullMode: 'none',
        compositing: { mode: 'alpha-blend', premultiplied: false },
        state: { depthWrite: false }
    })
}).addTo(disk);

// Sparse fixed stars keep the dark center and accretion disk as the visual focus.
const starGeometry = new Hilo3d.Geometry();
for (let index = 0; index < 380; index += 1) {
    const random = (offset: number): number => {
        const value = Math.sin(index * 127.1 + offset * 311.7) * 43758.5453;
        return value - Math.floor(value);
    };
    const x = (random(1) - 0.5) * 44;
    const y = (random(2) - 0.5) * 28;
    const z = -12 - random(3) * 14;
    const radius = 0.004 + Math.pow(random(4), 5) * 0.03;
    starGeometry.addFace(
        [x - radius, y - radius, z],
        [x + radius, y - radius, z],
        [x, y + radius, z]
    );
}
new Hilo3d.Mesh({
    geometry: starGeometry,
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(0.42, 0.48, 0.58)
    })
}).addTo(stage);

const softTexture = createParticleTexture({ style: 'disc', size: 64 });
const sparkTexture = createParticleTexture({ style: 'spark', size: 64 });

const fade = new Particle.ParticleCurve(
    [
        { time: 0, value: 0 },
        { time: 0.08, value: 1 },
        { time: 0.78, value: 0.72 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);

const gpuDefinition = Particle.ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'resident-nebula',
            capacity: stormCapacity,
            execution: 'gpu',
            duration: 12,
            looping: true,
            prewarm: !testMode,
            fixedStep: 1 / 60,
            maxCatchUpSteps: 4,
            overflow: 'drop-new',
            eventCapacity: 4_096,
            bounds: { mode: 'manual', min: [-6, -4, -6], max: [6, 6, 6] },
            emission: {
                rateOverTime: { min: 1_500, max: 1_900 },
                bursts: [
                    { time: 0, count: 3_072 },
                    { time: 3.2, count: 768, cycles: 3, interval: 2.8 }
                ]
            },
            shape: { type: 'torus', radius: 2.45, tubeRadius: 0.52, distribution: 'volume' },
            initialize: {
                lifetime: { min: 6, max: 10 },
                direction: { min: [-0.12, -0.04, -0.12], max: [0.12, 0.18, 0.12] },
                speed: { min: 0.08, max: 0.42 },
                size: { min: 0.012, max: 0.035 },
                mass: { min: 0.6, max: 1.6 }
            },
            modules: [
                {
                    type: 'vortex-force',
                    center: [0, 0, 0],
                    strength: { min: 0.14, max: 0.34 },
                    axis: [0, 1, 0]
                },
                { type: 'point-attraction', point: [0, 0, 0], strength: 0.15 },
                {
                    type: 'noise',
                    mode: 'force',
                    field: 'curl',
                    strength: { min: [0.05, 0.015, 0.05], max: [0.22, 0.055, 0.22] },
                    frequency: 1.8,
                    octaves: 3,
                    lacunarity: 2.1,
                    persistence: 0.52,
                    scrollVelocity: [0.025, 0.015, -0.02],
                    damping: 0.18,
                    seedOffset: 71
                },
                { type: 'drag', coefficient: 0.14 },
                { type: 'limit-velocity', limit: 1.45, dampen: 0.22 },
                {
                    type: 'collision',
                    colliders: [
                        { type: 'sphere', center: [0, 0, 0], radius: 1.2 },
                        { type: 'plane', normal: [0, 1, 0], offset: -1.2 }
                    ],
                    bounce: 0.58,
                    friction: 0.12,
                    radiusScale: 0.2,
                    event: 'nebula-impact'
                },
                {
                    type: 'scene-depth-collision',
                    thickness: 0.018,
                    bounce: 0.46,
                    friction: 0.15,
                    event: 'depth-impact'
                },
                {
                    type: 'sub-emitter',
                    event: 'nebula-impact',
                    emitter: 'resident-sparks',
                    count: 2,
                    inheritVelocity: true
                },
                {
                    type: 'sub-emitter',
                    event: 'depth-impact',
                    emitter: 'resident-sparks',
                    count: 3,
                    inheritVelocity: true
                },
                { type: 'size-over-lifetime', curve: fade },
                {
                    type: 'color-over-lifetime',
                    gradient: new Particle.ParticleGradient([
                        { time: 0, color: [1, 0.72, 0.38, 0] },
                        { time: 0.12, color: [1.25, 0.81, 0.45, 0.3] },
                        { time: 0.48, color: [1.0, 0.45, 0.19, 0.22] },
                        { time: 0.78, color: [0.6, 0.23, 0.1, 0.13] },
                        { time: 1, color: [0.3, 0.08, 0.02, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: softTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthTest: true,
                    depthWrite: false,
                    softParticle: { distance: 0.035, contrast: 1.25 },
                    renderOrder: 2
                }
            ]
        },
        {
            name: 'luminous-core',
            capacity: coreCapacity,
            execution: 'gpu',
            duration: 9,
            looping: true,
            prewarm: !testMode,
            bounds: { mode: 'manual', min: [-4, -3, -4], max: [4, 4, 4] },
            emission: {
                rateOverTime: { min: 720, max: 960 },
                bursts: [{ time: 0, count: 2_048 }]
            },
            shape: { type: 'torus', radius: 1.35, tubeRadius: 0.075, distribution: 'volume' },
            initialize: {
                lifetime: { min: 5.5, max: 8.5 },
                direction: { min: [-0.04, -0.015, -0.04], max: [0.04, 0.04, 0.04] },
                speed: { min: 0.02, max: 0.12 },
                size: { min: 0.018, max: 0.036 }
            },
            modules: [
                {
                    type: 'vortex-force',
                    center: [0, 0, 0],
                    strength: { min: 0.025, max: 0.08 },
                    axis: [0, 1, 0]
                },
                {
                    type: 'noise',
                    mode: 'force',
                    field: 'curl',
                    strength: [0.025, 0.008, 0.025],
                    frequency: 1.7,
                    octaves: 3,
                    scrollVelocity: [0.035, 0.08, -0.025],
                    damping: 0.22,
                    seedOffset: 113
                },
                { type: 'drag', coefficient: 0.16 },
                { type: 'size-over-lifetime', curve: fade },
                {
                    type: 'color-over-lifetime',
                    gradient: new Particle.ParticleGradient([
                        { time: 0, color: [1.7, 1.15, 0.58, 0] },
                        { time: 0.12, color: [1.6, 1.25, 0.72, 0.38] },
                        { time: 0.56, color: [1.35, 0.76, 0.3, 0.3] },
                        { time: 0.82, color: [0.8, 0.3, 0.12, 0.2] },
                        { time: 1, color: [0.5, 0.12, 0.04, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: softTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthWrite: false,
                    renderOrder: 3
                }
            ]
        },
        {
            name: 'resident-sparks',
            capacity: sparkCapacity,
            execution: 'gpu',
            bounds: { mode: 'manual', min: [-7, -5, -7], max: [7, 7, 7] },
            overflow: 'drop-new',
            initialize: {
                lifetime: { min: 0.18, max: 0.6 },
                speed: { min: 0.4, max: 1.6 },
                size: { min: 0.012, max: 0.035 }
            },
            modules: [
                { type: 'drag', coefficient: 0.72 },
                { type: 'size-over-lifetime', curve: fade },
                {
                    type: 'color-over-lifetime',
                    gradient: new Particle.ParticleGradient([
                        { time: 0, color: [1, 0.9, 0.48, 1] },
                        { time: 0.35, color: [1.2, 0.52, 0.18, 0.72] },
                        { time: 1, color: [0.3, 0.08, 0.03, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: sparkTexture,
                    alignment: 'stretched',
                    stretchScale: 1.5,
                    blend: 'additive',
                    depthWrite: false,
                    renderOrder: 4
                }
            ]
        }
    ]
});

const resident = new Particle.ParticleSystem({
    scaleY: 0.18,
    definition: gpuDefinition,
    seed: 65_536,
    compilationEnvironment: { backend: 'webgpu', preferGPUAboveCapacity: 1_024 }
}).addTo(disk);
resident.emit({ emitter: 'resident-nebula', count: testMode ? 768 : 6_144 });
resident.emit({ emitter: 'luminous-core', count: testMode ? 512 : 4_096 });

const statelessDefinition = Particle.ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'stateless-stars',
            capacity: statelessCapacity,
            execution: 'stateless',
            duration: 10,
            looping: true,
            prewarm: !testMode,
            bounds: { mode: 'manual', min: [-8, -6, -8], max: [8, 8, 8] },
            emission: { rateOverTime: 900 },
            shape: {
                type: 'torus',
                radius: 3.2,
                tubeRadius: 0.72,
                thickness: 0.3,
                distribution: 'volume'
            },
            initialize: {
                lifetime: { min: 7.5, max: 10 },
                direction: { min: [-0.08, -0.04, -0.08], max: [0.08, 0.04, 0.08] },
                speed: { min: 0.03, max: 0.12 },
                size: { min: 0.014, max: 0.05 }
            },
            modules: [
                { type: 'velocity-over-lifetime', velocity: [0, 0.005, 0] },
                {
                    type: 'noise',
                    mode: 'position-offset',
                    field: 'vector',
                    strength: [0.24, 0.08, 0.24],
                    frequency: 0.72,
                    octaves: 2,
                    scrollVelocity: [0.015, 0.03, -0.02],
                    seedOffset: 19
                },
                { type: 'drag', coefficient: 0.025 },
                { type: 'alpha-over-lifetime', curve: fade },
                {
                    type: 'color-over-lifetime',
                    gradient: new Particle.ParticleGradient([
                        { time: 0, color: [0.3, 0.5, 0.78, 0] },
                        { time: 0.18, color: [0.24, 0.42, 0.66, 0.55] },
                        { time: 0.65, color: [0.16, 0.28, 0.48, 0.35] },
                        { time: 1, color: [0.09, 0.14, 0.22, 0] }
                    ])
                },
                { type: 'screen-space-size', scale: 0.86 }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: softTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthWrite: false,
                    sort: 'none',
                    renderOrder: 0
                }
            ]
        }
    ]
});

const stateless = new Particle.ParticleSystem({
    scaleY: 0.3,
    definition: statelessDefinition,
    seed: 8008,
    compilationEnvironment: { backend: 'webgpu' }
}).addTo(disk);

const readout = requireElement('#particle-readout', HTMLOutputElement);
let nextReadoutUpdate = 0;
horizon.onUpdate = deltaTime => {
    photonRing.quaternion.copy(context.camera.quaternion);
    resident.rotationY += deltaTime * 0.0012;
    accretionFlow.rotationY += deltaTime * 0.0007;
    stateless.rotationY -= deltaTime * 0.0009;
    const now = performance.now();
    if (now < nextReadoutUpdate) return;
    nextReadoutUpdate = now + 500;
    readout.textContent = '05 — EVENT HORIZON\nCopper dust · glacial blue\nDrag to turn the orbit';
};

document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    context.dispose();
});
