import * as Hilo3d from '../src/Hilo3d';
import * as Particle from '@hilo3d/addon-particle';
import { createExampleContext } from './shared/init';
import {
    addParticlePedestal,
    createParticleAtlas,
    createParticleTexture,
    installExampleDisposal
} from './shared/particleShowcase';

const particlePlugin = Particle.createParticleStagePlugin({ budget: false });
const context = await createExampleContext({
    camera: { fov: 44, near: 0.1, far: 80, x: 0, y: 1.15, z: 9.2 },
    stage: {
        plugins: [particlePlugin],
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.72, knee: 0.5, intensity: 0.66, scatter: 0.7, maxLevels: 6 },
            colorUber: {
                exposure: -0.2,
                contrast: 0.08,
                saturation: 0.12,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.58,
                vignetteSmoothness: 0.62,
                vignetteColor: new Hilo3d.Color(0.002, 0.004, 0.016, 0.62)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0, 0.35, 0),
        minDistance: 6.4,
        maxDistance: 15,
        minPolarAngle: 0.7,
        maxPolarAngle: 2.15
    }
});
const { stage, renderer, directionLight, ambientLight } = context;
const particles = stage.pluginHost.get(Particle.PARTICLE_STAGE_SERVICE);

renderer.clearColor.set(0.002, 0.004, 0.014, 1);
directionLight.amount = 2.2;
directionLight.color.set(0.65, 0.78, 1, 1);
ambientLight.amount = 0.2;
addParticlePedestal(stage, new Hilo3d.Color(0.025, 0.055, 0.12));

const discTexture = createParticleTexture({ style: 'disc' });
const sparkTexture = createParticleTexture({ style: 'spark' });
const ringTexture = createParticleTexture({ style: 'ring' });
const smokeTexture = createParticleTexture({ style: 'smoke' });
const atlasTexture = createParticleAtlas();

const growThenFade = new Particle.ParticleCurve(
    [
        { time: 0, value: 0.05 },
        { time: 0.18, value: 1 },
        { time: 0.72, value: 0.62 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
const emberSize = new Particle.ParticleCurve([
    { time: 0, value: 0.25 },
    { time: 0.12, value: 1 },
    { time: 1, value: 0.08 }
]);
const spinCurve = new Particle.ParticleCurve(
    [
        { time: 0, value: -1.2 },
        { time: 0.5, value: 1.4 },
        { time: 1, value: -1.2 }
    ],
    { wrap: 'ping-pong', interpolation: 'smooth' }
);

function createSystem(
    definition: Readonly<Particle.ParticleEmitterDefinitionInput>,
    position: readonly [number, number, number],
    seed: number
): Particle.ParticleSystem {
    return particles.createSystem(
        {
            x: position[0],
            y: position[1],
            z: position[2],
            definition: Particle.ParticleSystemDefinition.create({ emitters: [definition] }),
            seed
        },
        stage
    );
}

const fire = createSystem(
    {
        name: 'solar-fire',
        capacity: 720,
        execution: 'cpu',
        duration: 6,
        prewarm: true,
        emission: { rateOverTime: { min: 150, max: 190 }, bursts: [{ time: 0, count: 64 }] },
        shape: { type: 'cone', radius: 0.38, angle: 14, length: 0.5, distribution: 'volume' },
        initialize: {
            lifetime: { min: 0.8, max: 1.65 },
            speed: { min: 1.25, max: 2.5 },
            size: { min: 0.16, max: 0.4 },
            color: { min: [1, 0.12, 0.015, 0.95], max: [1, 0.8, 0.15, 1] }
        },
        modules: [
            { type: 'wind', force: [0.15, 0.38, 0.04] },
            { type: 'drag', coefficient: 0.34 },
            {
                type: 'noise',
                mode: 'force',
                field: 'curl',
                strength: [0.72, 0.3, 0.72],
                frequency: 1.8,
                octaves: 3,
                scrollVelocity: [0.08, 0.4, -0.05],
                damping: 0.22
            },
            { type: 'size-over-lifetime', curve: growThenFade },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [1, 0.96, 0.72, 1] },
                    { time: 0.22, color: [1, 0.32, 0.025, 0.95] },
                    { time: 0.72, color: [0.72, 0.03, 0.018, 0.55] },
                    { time: 1, color: [0.1, 0.004, 0.01, 0] }
                ])
            },
            { type: 'texture-sheet', mode: 'lifetime', rows: 4, columns: 4, cycles: 1 }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: atlasTexture,
                alignment: 'view',
                blend: 'additive',
                depthWrite: false,
                sort: 'oldest',
                renderOrder: 3
            }
        ]
    },
    [0, -1.25, 0],
    301
);

createSystem(
    {
        name: 'forge-heart',
        capacity: 180,
        execution: 'cpu',
        emission: {
            rateOverTime: 12,
            bursts: [{ time: 0, count: 28, cycles: 4, interval: 1.1 }]
        },
        shape: { type: 'point' },
        initialize: {
            lifetime: { min: 0.45, max: 0.9 },
            direction: { min: [-1, -0.1, -1], max: [1, 1, 1] },
            speed: { min: 0.35, max: 1.2 },
            size: { min: 0.08, max: 0.22 }
        },
        modules: [
            { type: 'radial-force', center: [0, 0, 0], strength: 0.8 },
            { type: 'drag', coefficient: 0.42 },
            { type: 'size-over-lifetime', curve: growThenFade },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [1, 1, 0.8, 1] },
                    { time: 0.35, color: [1, 0.3, 0.04, 0.92] },
                    { time: 1, color: [0.8, 0.02, 0.12, 0] }
                ])
            }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: sparkTexture,
                alignment: 'velocity',
                blend: 'additive',
                depthWrite: false,
                renderOrder: 5
            }
        ]
    },
    [0, -0.45, 0.05],
    191
);

createSystem(
    {
        name: 'frost-disc',
        capacity: 460,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 105, bursts: [{ time: 0, count: 48 }] },
        shape: { type: 'disc', radius: 0.82, arc: (Math.PI * 5) / 3, distribution: 'surface' },
        initialize: {
            lifetime: { min: 1.3, max: 2.5 },
            direction: { min: [-0.18, 0.5, -0.18], max: [0.18, 1, 0.18] },
            speed: { min: 0.15, max: 0.65 },
            size: { min: 0.06, max: 0.14 },
            rotation: { min: -3.14, max: 3.14 }
        },
        modules: [
            { type: 'orbital-force', center: [0, 0.5, 0], strength: 0.72, axis: [0, 1, 0] },
            { type: 'gravity', force: [0, 0.1, 0] },
            { type: 'rotation-over-lifetime', curve: spinCurve, cycles: 2 },
            { type: 'size-over-lifetime', curve: growThenFade },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [0.92, 1, 1, 0] },
                    { time: 0.18, color: [0.35, 0.92, 1, 0.9] },
                    { time: 0.72, color: [0.25, 0.42, 1, 0.48] },
                    { time: 1, color: [0.12, 0.18, 0.5, 0] }
                ])
            }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: sparkTexture,
                blend: 'additive',
                alignment: 'world-up',
                sort: 'distance'
            }
        ]
    },
    [-2.35, -1.05, 0.35],
    77
);

createSystem(
    {
        name: 'plasma-torus',
        capacity: 520,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 125 },
        shape: { type: 'torus', radius: 0.74, tubeRadius: 0.12, arc: Math.PI * 2 },
        initialize: {
            lifetime: { min: 1.4, max: 2.3 },
            direction: [0, 0.35, 0],
            speed: { min: 0.08, max: 0.32 },
            size: { min: 0.08, max: 0.18 }
        },
        modules: [
            { type: 'vortex-force', center: [0, 0, 0], strength: 1.45, axis: [0.1, 1, 0.2] },
            { type: 'point-attraction', point: [0, 0.52, 0], strength: 0.28 },
            { type: 'drag', coefficient: 0.18 },
            { type: 'size-by-speed', speedRange: [0, 2], curve: growThenFade },
            {
                type: 'color-by-speed',
                speedRange: [0, 2],
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [0.2, 0.12, 1, 0.5] },
                    { time: 0.55, color: [0.7, 0.18, 1, 0.9] },
                    { time: 1, color: [0.2, 0.92, 1, 1] }
                ])
            },
            { type: 'alpha-over-lifetime', curve: growThenFade }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: ringTexture,
                blend: 'additive',
                alignment: 'velocity',
                sort: 'youngest'
            }
        ]
    },
    [2.35, -0.95, 0.2],
    909
);

createSystem(
    {
        name: 'ember-box',
        capacity: 260,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 46, bursts: [{ time: 0, count: 24, cycles: 3, interval: 1.2 }] },
        shape: { type: 'box', size: [5.2, 0.12, 1.8], distribution: 'volume' },
        initialize: {
            lifetime: { min: 2, max: 4.2 },
            direction: { min: [-0.12, 0.5, -0.1], max: [0.12, 1, 0.1] },
            speed: { min: 0.15, max: 0.55 },
            size: { min: 0.025, max: 0.075 }
        },
        modules: [
            { type: 'wind', force: [0.16, 0.12, 0] },
            { type: 'drag', coefficient: 0.08 },
            { type: 'size-over-lifetime', curve: emberSize },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [1, 0.55, 0.08, 1] },
                    { time: 0.7, color: [0.28, 0.62, 1, 0.62] },
                    { time: 1, color: [0.08, 0.15, 0.4, 0] }
                ])
            }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: discTexture,
                blend: 'additive',
                alignment: 'stretched',
                stretchScale: 2.2,
                depthWrite: false,
                renderOrder: 1
            }
        ]
    },
    [0, -1.26, -1.6],
    1234
);

createSystem(
    {
        name: 'aether-sphere',
        capacity: 380,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 82 },
        shape: { type: 'sphere', radius: 1.22, thickness: 0.06, distribution: 'surface' },
        initialize: {
            lifetime: { min: 2.4, max: 4.2 },
            speed: 0.04,
            size: { min: 0.02, max: 0.055 }
        },
        modules: [
            { type: 'rotate-around-point', center: [0, 0, 0], axis: [0, 1, 0], angularSpeed: 0.32 },
            { type: 'camera-fade', range: [2, 14] },
            { type: 'screen-space-size', scale: 1.1 },
            { type: 'alpha-over-lifetime', curve: growThenFade },
            { type: 'custom-channel', name: 'aetherBand', valueType: 'float', value: 0.72 }
        ],
        renderers: [{ type: 'sprite', texture: discTexture, blend: 'additive', depthWrite: false }]
    },
    [0, 0.35, -0.4],
    55
);

createSystem(
    {
        name: 'line-comets',
        capacity: 180,
        execution: 'cpu',
        emission: { rateOverTime: 32 },
        shape: { type: 'line', start: [-2.8, 0, 0], end: [2.8, 0, 0] },
        initialize: {
            lifetime: { min: 1.1, max: 2.1 },
            direction: { min: [-0.08, 0.75, -0.08], max: [0.08, 1, 0.08] },
            speed: { min: 0.55, max: 1.2 },
            size: { min: 0.035, max: 0.08 }
        },
        modules: [
            { type: 'limit-velocity', limit: 1.1, dampen: 0.2 },
            { type: 'alpha-over-lifetime', curve: growThenFade },
            { type: 'kill-distance', range: [0, 5.5] }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: sparkTexture,
                blend: 'additive',
                alignment: 'stretched',
                stretchScale: 4
            }
        ]
    },
    [0, 1.72, -0.4],
    812
);

createSystem(
    {
        name: 'hemisphere-mist',
        capacity: 190,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 36 },
        shape: {
            type: 'hemisphere',
            radius: 1.1,
            thickness: 0.32,
            distribution: 'volume',
            arc: (Math.PI * 11) / 9
        },
        initialize: {
            lifetime: { min: 2.8, max: 4.4 },
            speed: { min: 0.03, max: 0.16 },
            size: { min: 0.28, max: 0.58 }
        },
        modules: [
            { type: 'velocity-over-lifetime', velocity: [0.04, 0.08, -0.03] },
            { type: 'size-over-lifetime', curve: growThenFade },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [0.18, 0.38, 0.8, 0] },
                    { time: 0.3, color: [0.22, 0.5, 1, 0.2] },
                    { time: 1, color: [0.5, 0.16, 0.8, 0] }
                ])
            }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: smokeTexture,
                blend: 'premultiplied-alpha',
                depthWrite: false,
                sort: 'distance',
                renderOrder: -1
            }
        ]
    },
    [0, -0.75, -1.2],
    486
);

fire.onUpdate = deltaTime => {
    fire.rotationY += deltaTime * 0.008;
};

document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    context.dispose();
});
