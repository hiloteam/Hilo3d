import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import { createParticleTexture, installExampleDisposal } from './shared/particleShowcase';

const context = await createExampleContext({
    camera: { fov: 40, near: 0.1, far: 80, x: 0, y: 2, z: 10.8 },
    stage: {
        useInstanced: true,
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.8, knee: 0.45, intensity: 0.5, scatter: 0.68, maxLevels: 6 },
            colorUber: {
                exposure: -0.24,
                contrast: 0.12,
                saturation: 0.1,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.62,
                vignetteSmoothness: 0.56,
                vignetteColor: new Hilo3d.Color(0.002, 0.006, 0.02, 0.68)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0, 0.1, 0),
        minDistance: 6,
        maxDistance: 16,
        minPolarAngle: 0.55,
        maxPolarAngle: 2.35
    }
});
const { stage, renderer, directionLight, ambientLight } = context;

renderer.clearColor.set(0.002, 0.006, 0.018, 1);
directionLight.amount = 4.6;
directionLight.color.set(0.48, 0.82, 1, 1);
directionLight.direction.set(-0.45, -1, -0.25);
ambientLight.amount = 0.36;
ambientLight.color.set(0.32, 0.22, 0.72, 1);

new Hilo3d.PointLight({
    x: -2.4,
    y: 2.4,
    z: 1.4,
    amount: 16,
    range: 9,
    color: new Hilo3d.Color(0.18, 0.82, 1)
}).addTo(stage);
new Hilo3d.PointLight({
    x: 2.7,
    y: 0.5,
    z: 0.5,
    amount: 13,
    range: 8,
    color: new Hilo3d.Color(0.92, 0.2, 1)
}).addTo(stage);

const ribbonTexture = createParticleTexture({ style: 'ribbon', size: 32 });
const pulse = new Hilo3d.ParticleCurve(
    [
        { time: 0, value: 0.12 },
        { time: 0.18, value: 1 },
        { time: 0.8, value: 0.72 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
const orbitColor = new Hilo3d.ParticleGradient([
    { time: 0, color: [0.12, 0.88, 1, 0.95] },
    { time: 0.38, color: [0.24, 0.3, 1, 0.9] },
    { time: 0.72, color: [0.88, 0.16, 1, 0.82] },
    { time: 1, color: [1, 0.44, 0.18, 0] }
]);

const trailWidth = new Hilo3d.ParticleCurve(
    [
        { time: 0, value: 0.08 },
        { time: 0.08, value: 1 },
        { time: 0.78, value: 0.72 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);

const weaveDefinition = Hilo3d.ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'lit-orbit-meshes',
            capacity: 240,
            execution: 'cpu',
            prewarm: true,
            overflow: 'replace-oldest',
            bounds: { mode: 'automatic' },
            emission: { rateOverTime: 38, bursts: [{ time: 0, count: 80 }] },
            shape: { type: 'torus', radius: 1.65, tubeRadius: 0.32, distribution: 'volume' },
            initialize: {
                lifetime: { min: 4.8, max: 7.4 },
                direction: { min: [-0.1, -0.05, -0.1], max: [0.1, 0.05, 0.1] },
                speed: { min: 0.04, max: 0.24 },
                size: { min: 0.075, max: 0.18 },
                rotation: { min: -3.14, max: 3.14 },
                meshIndex: { min: 0, max: 1 }
            },
            modules: [
                {
                    type: 'rotate-around-point',
                    center: [0, 0, 0],
                    axis: [0.12, 1, 0.08],
                    angularSpeed: { min: 0.34, max: 0.62 }
                },
                { type: 'conform-sphere', center: [0, 0, 0], radius: 1.8, strength: 1.1 },
                {
                    type: 'orbital-force',
                    center: [0, 0, 0],
                    strength: { min: 0.12, max: 0.42 },
                    axis: [0, 1, 0]
                },
                { type: 'drag', coefficient: 0.16 },
                {
                    type: 'rotation-over-lifetime',
                    curve: new Hilo3d.ParticleCurve([
                        { time: 0, value: 0 },
                        { time: 1, value: 6.28 }
                    ]),
                    cycles: 2
                },
                { type: 'size-over-lifetime', curve: pulse },
                { type: 'color-over-lifetime', gradient: orbitColor }
            ],
            renderers: [
                {
                    type: 'mesh',
                    meshes: [
                        {
                            geometry: new Hilo3d.BoxGeometry({
                                width: 0.7,
                                height: 0.7,
                                depth: 0.7
                            })
                        },
                        {
                            geometry: new Hilo3d.SphereGeometry({
                                radius: 0.45,
                                widthSegments: 12,
                                heightSegments: 8
                            })
                        }
                    ],
                    orientation: 'velocity',
                    coverage: 'opaque',
                    lighting: 'lambert',
                    depthTest: true,
                    depthWrite: true,
                    motionVectors: true,
                    renderOrder: 0
                }
            ]
        }
    ]
});

const weave = new Hilo3d.ParticleSystem({
    y: 0.25,
    definition: weaveDefinition,
    seed: 2026
}).addTo(stage);

function createOrbitPathDefinition(
    name: string,
    type: 'ribbon' | 'trail',
    gradient: Hilo3d.ParticleGradient,
    facing: 'view' | 'world-up'
): Hilo3d.ParticleSystemDefinition {
    return Hilo3d.ParticleSystemDefinition.create({
        emitters: [
            {
                name,
                capacity: 220,
                execution: 'cpu',
                simulationSpace: 'world',
                duration: 12,
                looping: true,
                fixedStep: 1 / 60,
                bounds: { mode: 'dynamic' },
                emission: { rateOverTime: 56 },
                initialize: {
                    lifetime: 3.35,
                    speed: 0,
                    size: 0.09,
                    ribbonId: 0
                },
                modules: [
                    { type: 'size-over-lifetime', curve: trailWidth },
                    { type: 'color-over-lifetime', gradient }
                ],
                renderers: [
                    {
                        type,
                        texture: ribbonTexture,
                        coverage: 'transparent',
                        blend: 'additive',
                        facing,
                        widthScale: type === 'trail' ? 0.82 : 1.05,
                        uvMode: 'repeat',
                        tilesPerUnit: 3.6,
                        depthWrite: false,
                        renderOrder: type === 'trail' ? 3 : 2
                    }
                ]
            }
        ]
    });
}

const cyanPath = new Hilo3d.ParticleSystem({
    definition: createOrbitPathDefinition(
        'cyan-trail',
        'trail',
        new Hilo3d.ParticleGradient([
            { time: 0, color: [0.75, 1, 1, 1] },
            { time: 0.32, color: [0.04, 0.82, 1, 0.9] },
            { time: 1, color: [0.02, 0.18, 1, 0] }
        ]),
        'view'
    ),
    seed: 404
}).addTo(stage);
const magentaPath = new Hilo3d.ParticleSystem({
    definition: createOrbitPathDefinition(
        'magenta-ribbon',
        'ribbon',
        new Hilo3d.ParticleGradient([
            { time: 0, color: [1, 0.9, 1, 1] },
            { time: 0.35, color: [1, 0.08, 0.72, 0.88] },
            { time: 1, color: [0.25, 0.03, 0.8, 0] }
        ]),
        'world-up'
    ),
    seed: 405
}).addTo(stage);
const amberPath = new Hilo3d.ParticleSystem({
    definition: createOrbitPathDefinition(
        'amber-trail',
        'trail',
        new Hilo3d.ParticleGradient([
            { time: 0, color: [1, 1, 0.82, 1] },
            { time: 0.3, color: [1, 0.44, 0.06, 0.9] },
            { time: 1, color: [0.76, 0.04, 0.2, 0] }
        ]),
        'view'
    ),
    seed: 406
}).addTo(stage);

const core = new Hilo3d.Mesh({
    y: 0.25,
    geometry: new Hilo3d.SphereGeometry({ radius: 0.72, widthSegments: 36, heightSegments: 24 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.012, 0.026, 0.08),
        metallic: 0.92,
        roughness: 0.12,
        emissionFactor: new Hilo3d.Color(0.006, 0.04, 0.16)
    })
}).addTo(stage);
const coreWire = new Hilo3d.Mesh({
    y: 0.25,
    rotationX: 17,
    rotationY: 31,
    geometry: new Hilo3d.SphereGeometry({
        radius: 0.745,
        widthSegments: 22,
        heightSegments: 14
    }),
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(0.38, 1.15, 2.6),
        compositing: { mode: 'alpha-blend', premultiplied: true },
        opacity: 0.32,
        state: { wireframe: true, depthWrite: false }
    }),
    castShadows: false,
    receiveShadows: false
}).addTo(stage);

let pathTime = 0;
core.onUpdate = deltaTime => {
    pathTime += deltaTime * 0.001;
    core.rotationY += deltaTime * 0.014;
    core.rotationX += deltaTime * 0.006;
    coreWire.rotationY -= deltaTime * 0.018;
    coreWire.rotationX += deltaTime * 0.009;
    weave.rotationY += deltaTime * 0.003;
    cyanPath.position.set(
        Math.cos(pathTime * 1.05) * 2.75,
        0.25 + Math.sin(pathTime * 2.1) * 0.75,
        Math.sin(pathTime * 1.05) * 1.65
    );
    magentaPath.position.set(
        Math.cos(pathTime * 0.82 + 2.1) * 2.35,
        0.25 + Math.sin(pathTime * 1.64 + 0.7) * 1.35,
        Math.sin(pathTime * 0.82 + 2.1) * 2.15
    );
    amberPath.position.set(
        Math.cos(pathTime * 1.28 + 4.2) * 1.95,
        0.25 + Math.sin(pathTime * 2.56 + 1.4) * 1.05,
        Math.sin(pathTime * 1.28 + 4.2) * 2.55
    );
};

document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    context.dispose();
});
