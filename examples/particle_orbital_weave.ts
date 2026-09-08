import * as Hilo3d from '../src/Hilo3d';
import * as Particle from '@hilo/addon-particle';
import { createExampleContext } from './shared/init';
import { createParticleTexture, installExampleDisposal } from './shared/particleShowcase';

const context = await createExampleContext({
    autoStart: false,
    camera: { fov: 36, near: 0.1, far: 80, x: 0, y: 0.2, z: 10.8 },
    stage: {
        pixelRatio: 1.5,
        useInstanced: true,
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 1.25, knee: 0.4, intensity: 0.32, scatter: 0.6, maxLevels: 5 },
            colorUber: {
                exposure: 0,
                contrast: 0.06,
                saturation: 0.04,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.35,
                vignetteSmoothness: 0.8,
                vignetteColor: new Hilo3d.Color(0.002, 0.005, 0.018, 0.8)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0, 0, 0),
        minDistance: 6,
        maxDistance: 28,
        minPolarAngle: 0.5,
        maxPolarAngle: 2.6
    }
});
const { stage, renderer } = context;
renderer.clearColor.set(0.002, 0.005, 0.011, 1);

const grainTexture = createParticleTexture({ style: 'disc', size: 32 });
const sparkTexture = createParticleTexture({ style: 'spark', size: 32 });
const ribbonTexture = createParticleTexture({ style: 'ribbon', size: 32 });

const dustSize = new Particle.ParticleCurve(
    [
        { time: 0, value: 0.8 },
        { time: 0.12, value: 1 },
        { time: 0.62, value: 0.72 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
const filamentSize = new Particle.ParticleCurve(
    [
        { time: 0, value: 0.75 },
        { time: 0.08, value: 1 },
        { time: 0.65, value: 0.25 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);

function cometGradient(warm: boolean, alpha = 1): Particle.ParticleGradient {
    return new Particle.ParticleGradient(
        warm
            ? [
                  { time: 0, color: [3.6, 2.5, 1.65, alpha] },
                  { time: 0.05, color: [2, 0.93, 0.42, alpha * 0.95] },
                  { time: 0.24, color: [1.3, 0.35, 0.17, alpha * 0.86] },
                  { time: 0.6, color: [0.66, 0.14, 0.15, alpha * 0.42] },
                  { time: 1, color: [0.19, 0.07, 0.14, 0] }
              ]
            : [
                  { time: 0, color: [3.8, 4.5, 5, alpha] },
                  { time: 0.04, color: [0.85, 2, 2.6, alpha * 0.95] },
                  { time: 0.24, color: [0.22, 1.08, 1.5, alpha * 0.82] },
                  { time: 0.6, color: [0.12, 0.43, 0.78, alpha * 0.46] },
                  { time: 1, color: [0.09, 0.12, 0.34, 0] }
              ]
    );
}

/** Every visible tail sample is born at the moving comet and ages in world space. */
function createComet(warm: boolean): Particle.ParticleSystem {
    const lifetime = warm ? 8 : 10;
    const density = warm ? 0.64 : 1;
    const gradient = cometGradient(warm);
    const definition = Particle.ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'dust-wake',
                capacity: Math.ceil(1200 * density * lifetime),
                execution: 'cpu',
                simulationSpace: 'world',
                fixedStep: 1 / 60,
                bounds: { mode: 'dynamic' },
                emission: { rateOverTime: 840 * density },
                shape: { type: 'sphere', radius: warm ? 0.016 : 0.022, distribution: 'volume' },
                initialize: {
                    lifetime: { min: lifetime * 0.68, max: lifetime },
                    speed: { min: 0.02, max: warm ? 0.095 : 0.14 },
                    size: { min: 0.014, max: 0.036 },
                    rotation: { min: -Math.PI, max: Math.PI }
                },
                modules: [
                    { type: 'drag', coefficient: 0.11 },
                    {
                        type: 'noise',
                        field: 'vector',
                        mode: 'force',
                        strength: [0.018, 0.018, 0.018],
                        frequency: 1.2,
                        octaves: 1,
                        scrollVelocity: [0.04, 0.03, 0],
                        seedOffset: warm ? 45 : 18
                    },
                    { type: 'size-over-lifetime', curve: dustSize },
                    { type: 'color-over-lifetime', gradient }
                ],
                renderers: [
                    {
                        type: 'sprite',
                        texture: grainTexture,
                        blend: 'additive',
                        depthWrite: false,
                        renderOrder: 3
                    }
                ]
            },
            {
                name: 'ion-mist',
                capacity: Math.ceil(320 * density * lifetime),
                execution: 'cpu',
                simulationSpace: 'world',
                bounds: { mode: 'dynamic' },
                emission: { rateOverTime: 280 * density },
                shape: { type: 'sphere', radius: 0.025, distribution: 'volume' },
                initialize: {
                    lifetime: { min: lifetime * 0.5, max: lifetime },
                    speed: { min: 0.012, max: 0.065 },
                    size: { min: 0.065, max: 0.11 }
                },
                modules: [
                    { type: 'drag', coefficient: 0.12 },
                    { type: 'size-over-lifetime', curve: dustSize },
                    { type: 'color-over-lifetime', gradient: cometGradient(warm, 0.035) }
                ],
                renderers: [
                    {
                        type: 'sprite',
                        texture: grainTexture,
                        blend: 'additive',
                        depthWrite: false,
                        renderOrder: 1
                    }
                ]
            },
            {
                name: 'escaping-grains',
                capacity: warm ? 420 : 700,
                execution: 'cpu',
                simulationSpace: 'world',
                bounds: { mode: 'dynamic' },
                emission: { rateOverTime: warm ? 55 : 88 },
                shape: { type: 'sphere', radius: 0.04, distribution: 'volume' },
                initialize: {
                    lifetime: { min: 3.5, max: 7 },
                    speed: { min: 0.15, max: 0.38 },
                    size: { min: 0.014, max: 0.034 }
                },
                modules: [
                    { type: 'drag', coefficient: 0.13 },
                    { type: 'size-over-lifetime', curve: dustSize },
                    { type: 'color-over-lifetime', gradient: cometGradient(warm, 0.72) }
                ],
                renderers: [
                    {
                        type: 'sprite',
                        texture: sparkTexture,
                        blend: 'additive',
                        depthWrite: false,
                        renderOrder: 4
                    }
                ]
            },
            {
                name: warm ? 'ember-ribbon' : 'ion-trail',
                capacity: 800,
                execution: 'cpu',
                simulationSpace: 'world',
                fixedStep: 1 / 60,
                bounds: { mode: 'dynamic' },
                emission: { rateOverTime: 72 },
                initialize: { lifetime: lifetime * 0.9, speed: 0, size: 0.012, ribbonId: 0 },
                modules: [
                    { type: 'size-over-lifetime', curve: filamentSize },
                    { type: 'color-over-lifetime', gradient: cometGradient(warm, 0.4) }
                ],
                renderers: [
                    {
                        type: warm ? 'ribbon' : 'trail',
                        texture: ribbonTexture,
                        coverage: 'transparent',
                        blend: 'additive',
                        facing: 'view',
                        widthScale: 1,
                        uvMode: 'repeat',
                        tilesPerUnit: 2,
                        depthWrite: false,
                        renderOrder: 2
                    }
                ]
            },
            {
                name: 'solid-micrometeors',
                capacity: 128,
                execution: 'cpu',
                simulationSpace: 'world',
                bounds: { mode: 'dynamic' },
                emission: { rateOverTime: 24 },
                shape: { type: 'sphere', radius: 0.025, distribution: 'volume' },
                initialize: {
                    lifetime: { min: 2, max: 4 },
                    speed: { min: 0.025, max: 0.1 },
                    size: { min: 0.024, max: 0.052 },
                    meshIndex: { min: 0, max: 1 }
                },
                modules: [
                    { type: 'size-over-lifetime', curve: dustSize },
                    { type: 'color-over-lifetime', gradient }
                ],
                renderers: [
                    {
                        type: 'mesh',
                        meshes: [
                            {
                                geometry: new Hilo3d.SphereGeometry({
                                    radius: 0.22,
                                    widthSegments: 8,
                                    heightSegments: 6
                                })
                            },
                            {
                                geometry: new Hilo3d.SphereGeometry({
                                    radius: 0.3,
                                    widthSegments: 10,
                                    heightSegments: 8
                                })
                            }
                        ],
                        orientation: 'velocity',
                        coverage: 'opaque',
                        lighting: 'lambert',
                        depthWrite: true,
                        motionVectors: true,
                        renderOrder: 0
                    }
                ]
            },
            {
                name: 'comet-heart',
                capacity: 48,
                execution: 'cpu',
                simulationSpace: 'world',
                bounds: { mode: 'dynamic' },
                emission: { rateOverTime: 120 },
                shape: { type: 'sphere', radius: 0.012, distribution: 'volume' },
                initialize: {
                    lifetime: { min: 0.055, max: 0.12 },
                    speed: { min: 0.01, max: 0.025 },
                    size: { min: 0.045, max: 0.065 }
                },
                modules: [
                    { type: 'size-over-lifetime', curve: filamentSize },
                    { type: 'color-over-lifetime', gradient }
                ],
                renderers: [
                    {
                        type: 'sprite',
                        texture: grainTexture,
                        blend: 'additive',
                        depthWrite: false,
                        renderOrder: 5
                    }
                ]
            }
        ]
    });
    return new Particle.ParticleSystem({ definition, seed: warm ? 405 : 404, autoPlay: false });
}

interface OrbitTracer {
    readonly system: Particle.ParticleSystem;
    readonly radiusX: number;
    readonly radiusY: number;
    readonly tilt: number;
    readonly depth: number;
    readonly speed: number;
    readonly phase: number;
}

const tracerWidth = new Particle.ParticleCurve(
    [
        { time: 0, value: 0.75 },
        { time: 0.07, value: 1 },
        { time: 0.45, value: 0.88 },
        { time: 0.8, value: 0.35 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);

/** A separately moving light draws one continuous, finite-lived particle ribbon. */
function createOrbitTracer(
    name: string,
    type: 'ribbon' | 'trail',
    color: readonly [number, number, number],
    lifetime: number,
    width: number,
    seed: number
): Particle.ParticleSystem {
    const gradient = new Particle.ParticleGradient([
        { time: 0, color: [color[0] * 1.5, color[1] * 1.5, color[2] * 1.5, 1] },
        { time: 0.12, color: [color[0], color[1], color[2], 0.95] },
        { time: 0.55, color: [color[0] * 0.85, color[1] * 0.85, color[2] * 0.85, 0.85] },
        { time: 0.85, color: [color[0] * 0.5, color[1] * 0.5, color[2] * 0.5, 0.45] },
        { time: 1, color: [color[0] * 0.3, color[1] * 0.3, color[2] * 0.3, 0] }
    ]);
    return new Particle.ParticleSystem({
        seed,
        autoPlay: false,
        definition: Particle.ParticleSystemDefinition.create({
            emitters: [
                {
                    name,
                    capacity: Math.ceil(lifetime * 100),
                    execution: 'cpu',
                    simulationSpace: 'world',
                    fixedStep: 1 / 60,
                    bounds: { mode: 'dynamic' },
                    emission: { rateOverTime: 90 },
                    initialize: { lifetime, speed: 0, size: width, ribbonId: 0 },
                    modules: [
                        { type: 'size-over-lifetime', curve: tracerWidth },
                        { type: 'color-over-lifetime', gradient }
                    ],
                    renderers: [
                        {
                            type,
                            texture: ribbonTexture,
                            coverage: 'transparent',
                            blend: 'additive',
                            facing: 'view',
                            widthScale: 1,
                            uvMode: 'repeat',
                            tilesPerUnit: 2,
                            depthWrite: false,
                            renderOrder: 6
                        }
                    ]
                },
                {
                    name: `${name}-head`,
                    capacity: 16,
                    execution: 'cpu',
                    simulationSpace: 'world',
                    bounds: { mode: 'dynamic' },
                    emission: { rateOverTime: 90 },
                    initialize: { lifetime: 0.065, speed: 0, size: width * 1.5 },
                    modules: [
                        { type: 'size-over-lifetime', curve: filamentSize },
                        { type: 'color-over-lifetime', gradient }
                    ],
                    renderers: [
                        {
                            type: 'sprite',
                            texture: grainTexture,
                            blend: 'additive',
                            depthWrite: false,
                            renderOrder: 7
                        }
                    ]
                }
            ]
        })
    });
}

const tracers: readonly OrbitTracer[] = [
    {
        system: createOrbitTracer('silver-ribbon', 'ribbon', [2.1, 2.4, 2.7], 7.2, 0.048, 1401),
        radiusX: 3,
        radiusY: 0.92,
        tilt: -0.28,
        depth: 1.45,
        speed: -0.5,
        phase: 1.2
    },
    {
        system: createOrbitTracer(
            'champagne-ribbon',
            'ribbon',
            [2.4, 1.75, 0.95],
            5.6,
            0.046,
            1402
        ),
        radiusX: 1.22,
        radiusY: 2.25,
        tilt: 0.4,
        depth: 1.1,
        speed: 0.61,
        phase: 0.5
    },
    {
        system: createOrbitTracer('aqua-trail', 'trail', [0.45, 1.8, 2.1], 4.8, 0.052, 1403),
        radiusX: 2.45,
        radiusY: 1.13,
        tilt: 0.6,
        depth: 1.65,
        speed: -0.73,
        phase: 2.2
    }
];

function positionTracers(time: number): void {
    for (const tracer of tracers) {
        const angle = time * tracer.speed + tracer.phase;
        const x = Math.cos(angle) * tracer.radiusX;
        const y = Math.sin(angle) * tracer.radiusY;
        const cosine = Math.cos(tracer.tilt);
        const sine = Math.sin(tracer.tilt);
        tracer.system.position.set(
            x * cosine - y * sine,
            x * sine + y * cosine,
            Math.sin(angle + 0.65) * tracer.depth
        );
    }
}

const motion = new Hilo3d.Node().addTo(stage);
const blueComet = createComet(false);
const emberComet = createComet(true);

/** Different inclinations and orbital periods keep the two wakes from forming a fixed ring. */
function positionComets(time: number): void {
    const blueAngle = time * 0.37 + 0.5;
    const blueX = Math.cos(blueAngle) * 2.6;
    const blueY = Math.sin(blueAngle) * 1.65;
    blueComet.position.set(
        blueX * 0.94 - blueY * 0.34 + 0.2,
        blueX * 0.34 + blueY * 0.94,
        Math.sin(blueAngle + 0.7) * 1.1
    );
    const emberAngle = time * 0.43 + 3.1;
    const emberX = Math.cos(emberAngle) * 1.9;
    const emberY = Math.sin(emberAngle) * 1.45;
    emberComet.position.set(
        emberX * 0.72 + emberY * 0.69 - 0.35,
        -emberX * 0.69 + emberY * 0.72 - 0.1,
        Math.cos(emberAngle + 0.3) * 1.8
    );
}

// Rehearse the actual emitters along their paths, so the first frame already has a living wake.
let orbitTime = 7;
for (let frame = 0; frame < 600; frame += 1) {
    const sampleTime = orbitTime - 10 + frame / 60;
    positionComets(sampleTime);
    positionTracers(sampleTime);
    for (const tracer of tracers) tracer.system.simulate(1 / 60);
    blueComet.simulate(1 / 60);
    emberComet.simulate(1 / 60);
}
positionComets(orbitTime);
positionTracers(orbitTime);
for (const tracer of tracers) tracer.system.addTo(stage).play();
blueComet.addTo(stage).play();
emberComet.addTo(stage).play();
motion.onUpdate = deltaTime => {
    // Match the emitters' eight fixed-step catch-up budget, including slow browser frames.
    orbitTime += Math.min(deltaTime * 0.001, 8 / 60);
    positionComets(orbitTime);
    positionTracers(orbitTime);
};

function fitOrbit(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const distance = Math.max(10.8, 10.8 / Math.max(0.4, aspect));
    context.orbitControls.setView(
        new Hilo3d.Vector3(0, 0.2, distance),
        new Hilo3d.Vector3(0, 0, 0)
    );
}
fitOrbit();
window.addEventListener('resize', fitOrbit);
context.ticker.start();
document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    window.removeEventListener('resize', fitOrbit);
    context.dispose();
});
