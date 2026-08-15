import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import {
    addParticlePedestal,
    createParticleTexture,
    installExampleDisposal
} from './shared/particleShowcase';

const context = await createExampleContext({
    camera: { fov: 42, near: 0.1, far: 70, x: 0, y: 1.2, z: 10.2 },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.62, knee: 0.52, intensity: 0.7, scatter: 0.72, maxLevels: 6 },
            colorUber: {
                exposure: -0.22,
                contrast: 0.14,
                saturation: 0.12,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.68,
                vignetteSmoothness: 0.54,
                vignetteColor: new Hilo3d.Color(0.002, 0.003, 0.016, 0.72)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0, 0.2, 0),
        minDistance: 8,
        maxDistance: 17,
        minPolarAngle: 0.65,
        maxPolarAngle: 2.1
    }
});
const { stage, renderer, directionLight, ambientLight } = context;

renderer.clearColor.set(0.001, 0.004, 0.014, 1);
directionLight.amount = 2.2;
ambientLight.amount = 0.22;
addParticlePedestal(stage, new Hilo3d.Color(0.022, 0.046, 0.11));

const texture = createParticleTexture({ style: 'disc' });
const spark = createParticleTexture({ style: 'spark' });
const fade = new Hilo3d.ParticleCurve(
    [
        { time: 0, value: 0 },
        { time: 0.12, value: 1 },
        { time: 0.82, value: 0.78 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);

interface FieldParameters {
    readonly name: string;
    readonly position: readonly [number, number, number];
    readonly execution: 'cpu' | 'stateless';
    readonly mode: 'position-offset' | 'force';
    readonly field: 'vector' | 'curl';
    readonly color: readonly [number, number, number, number];
    readonly strength: Hilo3d.ParticleVector3;
    readonly frequency: number;
    readonly octaves: 1 | 2 | 3 | 4;
    readonly scroll: Hilo3d.ParticleVector3;
    readonly damping?: number;
}

const fields: readonly FieldParameters[] = [
    {
        name: 'vector-position',
        position: [-2.25, 0.85, 0],
        execution: 'stateless',
        mode: 'position-offset',
        field: 'vector',
        color: [0.08, 0.92, 1, 1],
        strength: [0.75, 0.48, 0.34],
        frequency: 1.1,
        octaves: 2,
        scroll: [0.12, 0.06, -0.04]
    },
    {
        name: 'curl-position',
        position: [2.25, 0.85, 0],
        execution: 'stateless',
        mode: 'position-offset',
        field: 'curl',
        color: [0.64, 0.2, 1, 1],
        strength: [0.48, 0.72, 0.48],
        frequency: 1.75,
        octaves: 4,
        scroll: [-0.08, 0.1, 0.05]
    },
    {
        name: 'vector-force',
        position: [-2.25, -1.05, 0],
        execution: 'cpu',
        mode: 'force',
        field: 'vector',
        color: [1, 0.58, 0.08, 1],
        strength: [0.85, 0.44, 0.6],
        frequency: 0.74,
        octaves: 1,
        scroll: [0.04, 0.16, 0]
    },
    {
        name: 'curl-force',
        position: [2.25, -1.05, 0],
        execution: 'cpu',
        mode: 'force',
        field: 'curl',
        color: [1, 0.12, 0.48, 1],
        strength: [0.92, 0.58, 0.92],
        frequency: 1.32,
        octaves: 3,
        scroll: [0.09, 0.03, -0.07],
        damping: 0.36
    }
];

const systems = fields.map((field, index) => {
    const gradient = new Hilo3d.ParticleGradient([
        { time: 0, color: [1, 1, 1, 0] },
        { time: 0.16, color: field.color },
        { time: 0.72, color: [field.color[0] * 0.5, field.color[1] * 0.5, field.color[2], 0.72] },
        { time: 1, color: [field.color[0] * 0.18, field.color[1] * 0.18, field.color[2] * 0.32, 0] }
    ]);
    const definition = Hilo3d.ParticleSystemDefinition.create({
        emitters: [
            {
                name: field.name,
                capacity: 1_280,
                execution: field.execution,
                duration: 6,
                looping: true,
                prewarm: true,
                bounds: { mode: 'manual', min: [-2, -2, -2], max: [2, 2, 2] },
                emission: { rateOverTime: 210, bursts: [{ time: 0, count: 210 }] },
                shape: { type: 'box', size: [1.4, 1.15, 0.55], distribution: 'volume' },
                initialize: {
                    lifetime: { min: 3.8, max: 5.8 },
                    direction: { min: [-0.08, -0.05, -0.08], max: [0.08, 0.12, 0.08] },
                    speed: { min: 0.02, max: 0.16 },
                    size: { min: 0.028, max: 0.078 }
                },
                modules: [
                    {
                        type: 'noise',
                        mode: field.mode,
                        field: field.field,
                        strength: field.strength,
                        frequency: field.frequency,
                        octaves: field.octaves,
                        lacunarity: 2.05,
                        persistence: 0.52,
                        scrollVelocity: field.scroll,
                        ...(field.damping === undefined ? {} : { damping: field.damping }),
                        seedOffset: index * 37 + 11
                    },
                    ...(field.mode === 'force'
                        ? ([
                              { type: 'drag', coefficient: 0.16 },
                              { type: 'limit-velocity', limit: 0.82, dampen: 0.22 }
                          ] as const)
                        : []),
                    { type: 'size-over-lifetime', curve: fade },
                    { type: 'color-over-lifetime', gradient },
                    { type: 'screen-space-size', scale: 0.92 }
                ],
                renderers: [
                    {
                        type: 'sprite',
                        texture: field.mode === 'force' ? spark : texture,
                        alignment: field.mode === 'force' ? 'stretched' : 'view',
                        stretchScale: field.mode === 'force' ? 2.8 : 1,
                        blend: 'additive',
                        depthWrite: false,
                        sort: 'none'
                    }
                ]
            }
        ]
    });
    return new Hilo3d.ParticleSystem({
        x: field.position[0],
        y: field.position[1],
        z: field.position[2],
        definition,
        seed: 100 + index * 73
    }).addTo(stage);
});

let elapsed = 0;
stage.onUpdate = deltaTime => {
    elapsed += deltaTime * 0.001;
    systems.forEach((system, index) => {
        system.rotationY = Math.sin(elapsed * (0.22 + index * 0.03) + index) * 8;
    });
};

document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    context.dispose();
});
