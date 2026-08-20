import * as Hilo3d from '../src/Hilo3d';
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
const statelessCapacity = testMode ? 4_096 : 24_576;

const context = await createExampleContext({
    backend: 'webgpu',
    camera: { fov: 43, near: 0.1, far: 120, x: 0, y: 1.5, z: 11.5 },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.78, knee: 0.52, intensity: 0.7, scatter: 0.72, maxLevels: 7 },
            colorUber: {
                exposure: -0.32,
                contrast: 0.16,
                saturation: 0.14,
                temperature: -0.03,
                tint: 0.04,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.74,
                vignetteSmoothness: 0.52,
                vignetteColor: new Hilo3d.Color(0.001, 0.002, 0.012, 0.78)
            },
            opaqueTexture: true
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0, 0.2, 0),
        minDistance: 6,
        maxDistance: 20,
        minPolarAngle: 0.45,
        maxPolarAngle: 2.55
    }
});
const { stage, renderer, directionLight, ambientLight } = context;

renderer.clearColor.set(0.001, 0.002, 0.009, 1);
directionLight.amount = 3.4;
directionLight.color.set(0.4, 0.68, 1, 1);
ambientLight.amount = 0.18;
ambientLight.color.set(0.32, 0.18, 0.72, 1);

const horizon = new Hilo3d.Mesh({
    y: 0.15,
    geometry: new Hilo3d.SphereGeometry({ radius: 1.12, widthSegments: 48, heightSegments: 32 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.002, 0.003, 0.008),
        metallic: 0.94,
        roughness: 0.08
    })
}).addTo(stage);

new Hilo3d.PointLight({
    x: -2.8,
    y: 2.4,
    z: 1.5,
    amount: 24,
    range: 10,
    color: new Hilo3d.Color(0.12, 0.68, 1)
}).addTo(stage);
const softTexture = createParticleTexture({ style: 'disc', size: 64 });
const sparkTexture = createParticleTexture({ style: 'spark', size: 64 });
const ringTexture = createParticleTexture({ style: 'ring', size: 64 });
const fade = new Hilo3d.ParticleCurve(
    [
        { time: 0, value: 0 },
        { time: 0.08, value: 1 },
        { time: 0.78, value: 0.72 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);

const gpuDefinition = Hilo3d.ParticleSystemDefinition.create({
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
            shape: { type: 'torus', radius: 2.2, tubeRadius: 0.52, distribution: 'volume' },
            initialize: {
                lifetime: { min: 6, max: 10 },
                direction: { min: [-0.12, -0.04, -0.12], max: [0.12, 0.18, 0.12] },
                speed: { min: 0.08, max: 0.42 },
                size: { min: 0.06, max: 0.16 },
                mass: { min: 0.6, max: 1.6 }
            },
            modules: [
                {
                    type: 'vortex-force',
                    center: [0, 0.1, 0],
                    strength: { min: 0.28, max: 0.9 },
                    axis: [0.08, 1, 0.04]
                },
                { type: 'point-attraction', point: [0, 0.15, 0], strength: 0.24 },
                {
                    type: 'noise',
                    mode: 'force',
                    field: 'curl',
                    strength: { min: [0.16, 0.08, 0.16], max: [0.72, 0.38, 0.72] },
                    frequency: 1.35,
                    octaves: 4,
                    lacunarity: 2.1,
                    persistence: 0.52,
                    scrollVelocity: [0.08, 0.14, -0.06],
                    damping: 0.18,
                    seedOffset: 71
                },
                { type: 'drag', coefficient: 0.14 },
                { type: 'limit-velocity', limit: 1.45, dampen: 0.22 },
                {
                    type: 'collision',
                    colliders: [
                        { type: 'sphere', center: [0, 0.15, 0], radius: 1.2 },
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
                    gradient: new Hilo3d.ParticleGradient([
                        { time: 0, color: [0.14, 0.72, 1, 0] },
                        { time: 0.12, color: [0.08, 0.9, 1, 0.82] },
                        { time: 0.48, color: [0.34, 0.2, 1, 0.76] },
                        { time: 0.78, color: [1, 0.12, 0.72, 0.62] },
                        { time: 1, color: [1, 0.38, 0.08, 0] }
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
            shape: { type: 'torus', radius: 1.72, tubeRadius: 0.34, distribution: 'volume' },
            initialize: {
                lifetime: { min: 5.5, max: 8.5 },
                direction: { min: [-0.04, -0.015, -0.04], max: [0.04, 0.04, 0.04] },
                speed: { min: 0.02, max: 0.12 },
                size: { min: 0.14, max: 0.32 }
            },
            modules: [
                {
                    type: 'vortex-force',
                    center: [0, 0.15, 0],
                    strength: { min: 0.18, max: 0.5 },
                    axis: [0.04, 1, 0.02]
                },
                {
                    type: 'noise',
                    mode: 'force',
                    field: 'curl',
                    strength: [0.22, 0.08, 0.22],
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
                    gradient: new Hilo3d.ParticleGradient([
                        { time: 0, color: [0.16, 0.92, 1, 0] },
                        { time: 0.12, color: [0.42, 1, 1, 1] },
                        { time: 0.56, color: [0.28, 0.62, 1, 0.92] },
                        { time: 0.82, color: [1, 0.18, 1, 0.78] },
                        { time: 1, color: [1, 0.12, 0.48, 0] }
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
                    gradient: new Hilo3d.ParticleGradient([
                        { time: 0, color: [1, 0.9, 0.48, 1] },
                        { time: 0.35, color: [0.22, 0.82, 1, 0.92] },
                        { time: 1, color: [0.62, 0.08, 1, 0] }
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

const resident = new Hilo3d.ParticleSystem({
    y: 0,
    rotationX: 58,
    definition: gpuDefinition,
    seed: 65_536,
    compilationEnvironment: { backend: 'webgpu', preferGPUAboveCapacity: 1_024 }
}).addTo(stage);
resident.emit({ emitter: 'resident-nebula', count: testMode ? 768 : 6_144 });
resident.emit({ emitter: 'luminous-core', count: testMode ? 512 : 4_096 });

const statelessDefinition = Hilo3d.ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'stateless-stars',
            capacity: statelessCapacity,
            execution: 'stateless',
            duration: 10,
            looping: true,
            prewarm: !testMode,
            bounds: { mode: 'manual', min: [-8, -6, -8], max: [8, 8, 8] },
            emission: { rateOverTime: 2_400 },
            shape: {
                type: 'torus',
                radius: 3.55,
                tubeRadius: 0.82,
                thickness: 0.48,
                distribution: 'volume'
            },
            initialize: {
                lifetime: { min: 7.5, max: 10 },
                direction: { min: [-0.08, -0.04, -0.08], max: [0.08, 0.04, 0.08] },
                speed: { min: 0.03, max: 0.12 },
                size: { min: 0.012, max: 0.045 }
            },
            modules: [
                { type: 'velocity-over-lifetime', velocity: [0, 0.025, 0] },
                {
                    type: 'noise',
                    mode: 'position-offset',
                    field: 'vector',
                    strength: [0.22, 0.12, 0.22],
                    frequency: 0.72,
                    octaves: 2,
                    scrollVelocity: [0.015, 0.03, -0.02],
                    seedOffset: 19
                },
                { type: 'drag', coefficient: 0.025 },
                { type: 'alpha-over-lifetime', curve: fade },
                {
                    type: 'color-over-lifetime',
                    gradient: new Hilo3d.ParticleGradient([
                        { time: 0, color: [0.2, 0.65, 1, 0] },
                        { time: 0.18, color: [0.22, 0.85, 1, 0.72] },
                        { time: 0.65, color: [0.58, 0.28, 1, 0.6] },
                        { time: 1, color: [1, 0.16, 0.58, 0] }
                    ])
                },
                { type: 'screen-space-size', scale: 0.86 }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: ringTexture,
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

const stateless = new Hilo3d.ParticleSystem({
    rotationX: 64,
    definition: statelessDefinition,
    seed: 8008,
    compilationEnvironment: { backend: 'webgpu' }
}).addTo(stage);

const readout = requireElement('#particle-readout', HTMLOutputElement);
let nextReadoutUpdate = 0;
horizon.onUpdate = deltaTime => {
    horizon.rotationY += deltaTime * 0.008;
    resident.rotationY += deltaTime * 0.0016;
    stateless.rotationY -= deltaTime * 0.0006;
    const now = performance.now();
    if (now < nextReadoutUpdate) return;
    nextReadoutUpdate = now + 500;
    readout.textContent = [
        'stateful GPU      40,960 cap',
        'stateless GPU     24,576 cap',
        'total             65,536 cap',
        `draws             ${String(renderer.renderInfo.drawCount).padStart(6)}`,
        `faces             ${String(renderer.renderInfo.faceCount).padStart(6)}`,
        '',
        'simulation + events remain resident',
        'alive counts intentionally not read back'
    ].join('\n');
};

document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    context.dispose();
});
