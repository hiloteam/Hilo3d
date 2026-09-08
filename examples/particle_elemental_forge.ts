import * as Hilo3d from '../src/Hilo3d';
import * as Particle from '@hilo/addon-particle';
import { createExampleContext } from './shared/init';
import {
    createParticleAtlas,
    createParticleTexture,
    installExampleDisposal
} from './shared/particleShowcase';

const particleSystem = Particle.createParticleStageSystem({ budget: false });
const context = await createExampleContext({
    camera: { fov: 38, near: 0.1, far: 80, x: 3.6, y: 2.1, z: 9.3 },
    stage: {
        systems: [particleSystem],
        useInstanced: true,
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.94, knee: 0.35, intensity: 0.3, scatter: 0.56, maxLevels: 5 },
            colorUber: {
                exposure: 0.05,
                contrast: 0.08,
                saturation: -0.08,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.34,
                vignetteSmoothness: 0.72,
                vignetteColor: new Hilo3d.Color(0.007, 0.009, 0.011, 0.5)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(-0.45, 0.1, 0),
        minDistance: 6,
        maxDistance: 14,
        minPolarAngle: 0.6,
        maxPolarAngle: 1.82
    }
});
const { stage, renderer, directionLight, ambientLight } = context;
const particles = stage.systems.get(Particle.PARTICLE_STAGE_SERVICE);

renderer.clearColor.set(0.012, 0.016, 0.018, 1);
directionLight.amount = 3.8;
directionLight.color.set(1, 0.8, 0.57, 1);
directionLight.direction.set(-0.5, -0.85, -0.6);
ambientLight.amount = 0.55;
ambientLight.color.set(0.5, 0.57, 0.62, 1);
new Hilo3d.PointLight({
    x: 0,
    y: -0.4,
    z: 0.2,
    amount: 4.5,
    range: 5,
    color: new Hilo3d.Color(1, 0.37, 0.07)
}).addTo(stage);
new Hilo3d.PointLight({
    x: -2.3,
    y: 1.8,
    z: -1.6,
    amount: 12,
    range: 7,
    color: new Hilo3d.Color(0.25, 0.58, 0.63)
}).addTo(stage);

const bronze = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.3, 0.17, 0.08),
    metallic: 0.72,
    roughness: 0.41
});
const darkMetal = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.027, 0.037, 0.041),
    metallic: 0.55,
    roughness: 0.38
});
const goldLine = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    diffuse: new Hilo3d.Color(1.05, 0.61, 0.23)
});
const coolLine = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    diffuse: new Hilo3d.Color(0.19, 0.4, 0.41)
});

/** Small, smooth metal rings keep the apparatus legible behind the much finer moving sparks. */
function createHoopGeometry(radius: number, tube: number, arc = Math.PI * 2): Hilo3d.Geometry {
    const segments = 144;
    const sides = 8;
    const vertices: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    for (let segment = 0; segment <= segments; segment += 1) {
        const angle = (segment / segments) * arc;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        for (let side = 0; side <= sides; side += 1) {
            const section = (side / sides) * Math.PI * 2;
            const radial = Math.cos(section);
            const vertical = Math.sin(section);
            vertices.push(
                (radius + tube * radial) * cosine,
                tube * vertical,
                (radius + tube * radial) * sine
            );
            normals.push(radial * cosine, vertical, radial * sine);
            if (segment < segments && side < sides) {
                const a = segment * (sides + 1) + side;
                const b = a + sides + 1;
                indices.push(a, a + 1, b, b, a + 1, b + 1);
            }
        }
    }
    return new Hilo3d.Geometry({
        vertices: new Hilo3d.GeometryData(new Float32Array(vertices), 3),
        normals: new Hilo3d.GeometryData(new Float32Array(normals), 3),
        indices: new Hilo3d.GeometryData(new Uint16Array(indices), 1)
    });
}

function addHoop(
    radius: number,
    tube: number,
    height: number,
    material: Hilo3d.MaterialInstance,
    parent: Hilo3d.Node = stage
): Hilo3d.Mesh {
    return new Hilo3d.Mesh({
        y: height,
        geometry: createHoopGeometry(radius, tube),
        material,
        castShadows: false
    }).addTo(parent);
}

const base = new Hilo3d.Mesh({
    y: -1.58,
    scaleY: 0.12,
    geometry: new Hilo3d.SphereGeometry({ radius: 2.32, widthSegments: 96, heightSegments: 24 }),
    material: darkMetal
}).addTo(stage);
addHoop(2.1, 0.012, -1.39, bronze);
addHoop(2.28, 0.012, -1.55, bronze);
addHoop(1.98, 0.006, -1.38, coolLine);

const crucible = new Hilo3d.Mesh({
    y: -1.22,
    scaleY: 0.23,
    geometry: new Hilo3d.SphereGeometry({ radius: 1.16, widthSegments: 72, heightSegments: 32 }),
    material: bronze
}).addTo(stage);
new Hilo3d.Mesh({
    y: -1.05,
    scaleY: 0.025,
    geometry: new Hilo3d.SphereGeometry({ radius: 1.02, widthSegments: 72, heightSegments: 16 }),
    material: darkMetal
}).addTo(stage);
addHoop(1.055, 0.022, -1.03, bronze);
addHoop(0.96, 0.008, -1.012, goldLine);
addHoop(0.81, 0.006, -1.003, goldLine);

const apparatus = new Hilo3d.Node({ y: 0.43, rotationY: 12 }).addTo(stage);
const outerHoop = addHoop(1.85, 0.023, 0, bronze, apparatus);
outerHoop.rotationX = 72;
outerHoop.rotationZ = -19;
const innerHoop = addHoop(1.68, 0.016, 0, bronze, apparatus);
innerHoop.rotationX = 42;
innerHoop.rotationZ = -32;
const fineHoop = addHoop(1.88, 0.0045, 0, goldLine, apparatus);
fineHoop.rotationX = outerHoop.rotationX;
fineHoop.rotationZ = outerHoop.rotationZ;

const tickGeometry = new Hilo3d.BoxGeometry({ width: 0.007, height: 0.014, depth: 0.07 });
for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * Math.PI * 2;
    new Hilo3d.Mesh({
        x: Math.cos(angle) * 2.06,
        y: -1.375,
        z: Math.sin(angle) * 2.06,
        rotationY: 90 - (angle * 180) / Math.PI,
        scaleZ: index % 6 === 0 ? 1.65 : 0.7,
        geometry: tickGeometry,
        material: index % 6 === 0 ? goldLine : bronze,
        castShadows: false
    }).addTo(stage);
}

const discTexture = createParticleTexture({ style: 'disc' });
const sparkTexture = createParticleTexture({ style: 'comet' });
const smokeTexture = createParticleTexture({ style: 'smoke' });
const atlasTexture = createParticleAtlas();
const fade = new Particle.ParticleCurve(
    [
        { time: 0, value: 0 },
        { time: 0.12, value: 1 },
        { time: 0.64, value: 0.75 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
const emberSize = new Particle.ParticleCurve([
    { time: 0, value: 0.5 },
    { time: 0.16, value: 1 },
    { time: 0.68, value: 0.72 },
    { time: 1, value: 0.1 }
]);
const fireColor = new Particle.ParticleGradient([
    { time: 0, color: [1.4, 0.76, 0.28, 0] },
    { time: 0.08, color: [1.45, 0.83, 0.38, 0.95] },
    { time: 0.45, color: [1.1, 0.42, 0.095, 0.82] },
    { time: 0.78, color: [0.66, 0.2, 0.038, 0.55] },
    { time: 1, color: [0.4, 0.095, 0.025, 0] }
]);

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

// Eight emitter shapes share one visual vocabulary: molten gold, oxidation, and suspended ash.
createSystem(
    {
        name: 'molten-column',
        capacity: 2400,
        execution: 'cpu',
        duration: 8,
        prewarm: true,
        emission: { rateOverTime: 850 },
        shape: { type: 'cone', radius: 0.36, angle: 12, length: 0.28, distribution: 'volume' },
        initialize: {
            lifetime: { min: 1.7, max: 2.75 },
            speed: { min: 0.85, max: 1.48 },
            size: { min: 0.012, max: 0.028 }
        },
        modules: [
            { type: 'vortex-force', center: [0, 0.8, 0], strength: 0.72, axis: [0, 1, 0] },
            { type: 'point-attraction', point: [0, 2.35, 0], strength: 0.9 },
            {
                type: 'noise',
                mode: 'force',
                field: 'curl',
                strength: [0.28, 0.12, 0.28],
                frequency: 1.65,
                octaves: 2,
                scrollVelocity: [0.03, 0.16, -0.02],
                damping: 0.2
            },
            { type: 'drag', coefficient: 0.25 },
            { type: 'size-over-lifetime', curve: emberSize },
            { type: 'color-over-lifetime', gradient: fireColor }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: discTexture,
                alignment: 'stretched',
                stretchScale: 1.8,
                blend: 'additive',
                depthWrite: false,
                renderOrder: 3
            }
        ]
    },
    [0, -0.98, 0],
    301
);

createSystem(
    {
        name: 'golden-filaments',
        capacity: 260,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 78 },
        shape: { type: 'point' },
        initialize: {
            lifetime: { min: 1.4, max: 2.8 },
            direction: { min: [-0.26, 0.8, -0.26], max: [0.26, 1, 0.26] },
            speed: { min: 0.9, max: 1.8 },
            size: { min: 0.016, max: 0.032 }
        },
        modules: [
            { type: 'gravity', force: [0, -0.38, 0] },
            { type: 'orbital-force', center: [0, 0.5, 0], strength: 0.2, axis: [0, 1, 0] },
            { type: 'size-over-lifetime', curve: emberSize },
            { type: 'color-over-lifetime', gradient: fireColor }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: sparkTexture,
                alignment: 'stretched',
                stretchScale: 10,
                blend: 'additive',
                depthWrite: false,
                renderOrder: 4
            }
        ]
    },
    [0, -0.72, 0],
    191
);

createSystem(
    {
        name: 'oxidised-halo',
        capacity: 520,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 110 },
        shape: { type: 'disc', radius: 1.03, distribution: 'surface' },
        initialize: {
            lifetime: { min: 2.8, max: 4.3 },
            direction: [0, 1, 0],
            speed: { min: 0.04, max: 0.2 },
            size: { min: 0.012, max: 0.032 }
        },
        modules: [
            { type: 'rotate-around-point', center: [0, 0, 0], axis: [0, 1, 0], angularSpeed: 0.18 },
            { type: 'alpha-over-lifetime', curve: fade },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [0.28, 0.67, 0.69, 0] },
                    { time: 0.2, color: [0.35, 0.75, 0.73, 0.75] },
                    { time: 0.7, color: [0.14, 0.35, 0.37, 0.4] },
                    { time: 1, color: [0.1, 0.26, 0.29, 0] }
                ])
            }
        ],
        renderers: [{ type: 'sprite', texture: discTexture, blend: 'additive', depthWrite: false }]
    },
    [0, -0.99, 0],
    77
);

const aureole = createSystem(
    {
        name: 'orbital-cinders',
        capacity: 740,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 185 },
        shape: { type: 'torus', radius: 1.2, tubeRadius: 0.018, distribution: 'volume' },
        initialize: {
            lifetime: { min: 2.4, max: 3.8 },
            speed: 0.008,
            size: { min: 0.01, max: 0.026 },
            color: { min: [0.75, 0.39, 0.12, 0.45], max: [1.2, 0.86, 0.46, 0.9] }
        },
        modules: [
            { type: 'rotate-around-point', center: [0, 0, 0], axis: [0, 1, 0], angularSpeed: 0.34 },
            { type: 'alpha-over-lifetime', curve: fade }
        ],
        renderers: [{ type: 'sprite', texture: discTexture, blend: 'additive', depthWrite: false }]
    },
    [0, 0.47, 0],
    909
);
aureole.rotationZ = 18;
aureole.rotationX = 18;

createSystem(
    {
        name: 'suspended-ash',
        capacity: 260,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 30 },
        shape: { type: 'box', size: [5.8, 4.4, 3], distribution: 'volume' },
        initialize: {
            lifetime: { min: 5, max: 8 },
            direction: [0.12, 0.3, 0],
            speed: { min: 0.02, max: 0.07 },
            size: { min: 0.008, max: 0.026 },
            color: { min: [0.3, 0.26, 0.19, 0.15], max: [0.68, 0.55, 0.34, 0.55] }
        },
        modules: [{ type: 'alpha-over-lifetime', curve: fade }],
        renderers: [{ type: 'sprite', texture: discTexture, blend: 'additive', depthWrite: false }]
    },
    [0, 0.4, -0.8],
    1234
);

createSystem(
    {
        name: 'aether-shell',
        capacity: 340,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 68 },
        shape: { type: 'sphere', radius: 1.5, thickness: 0.015, distribution: 'surface' },
        initialize: {
            lifetime: { min: 3.2, max: 4.8 },
            speed: 0.012,
            size: { min: 0.008, max: 0.021 },
            color: [0.5, 0.64, 0.62, 0.38]
        },
        modules: [
            { type: 'rotate-around-point', center: [0, 0, 0], axis: [0, 1, 0], angularSpeed: 0.08 },
            { type: 'alpha-over-lifetime', curve: fade }
        ],
        renderers: [{ type: 'sprite', texture: discTexture, blend: 'additive', depthWrite: false }]
    },
    [0, 0.45, 0],
    55
);

createSystem(
    {
        name: 'rim-sparks',
        capacity: 130,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 34 },
        shape: { type: 'line', start: [-0.55, 0, 0], end: [0.55, 0, 0] },
        initialize: {
            lifetime: { min: 0.65, max: 1.8 },
            direction: { min: [-0.7, 0.55, -0.5], max: [0.7, 1, 0.5] },
            speed: { min: 0.5, max: 0.9 },
            size: { min: 0.035, max: 0.065 }
        },
        modules: [
            { type: 'gravity', force: [0, -0.18, 0] },
            { type: 'texture-sheet', mode: 'lifetime', rows: 4, columns: 4, cycles: 1 },
            { type: 'size-over-lifetime', curve: emberSize },
            { type: 'color-over-lifetime', gradient: fireColor }
        ],
        renderers: [{ type: 'sprite', texture: atlasTexture, blend: 'additive', depthWrite: false }]
    },
    [0, -0.95, 0],
    812
);

createSystem(
    {
        name: 'heat-veil',
        capacity: 120,
        execution: 'cpu',
        prewarm: true,
        emission: { rateOverTime: 27 },
        shape: { type: 'hemisphere', radius: 0.58, thickness: 0.4, distribution: 'volume' },
        initialize: {
            lifetime: { min: 2.2, max: 3.6 },
            direction: [0, 1, 0],
            speed: { min: 0.07, max: 0.2 },
            size: { min: 0.2, max: 0.42 }
        },
        modules: [
            { type: 'velocity-over-lifetime', velocity: [0.03, 0.12, -0.02] },
            { type: 'size-over-lifetime', curve: fade },
            {
                type: 'color-over-lifetime',
                gradient: new Particle.ParticleGradient([
                    { time: 0, color: [0.38, 0.18, 0.055, 0] },
                    { time: 0.25, color: [0.48, 0.24, 0.09, 0.08] },
                    { time: 1, color: [0.2, 0.16, 0.11, 0] }
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
    [0, -0.7, 0],
    486
);

let elapsed = 0;
base.onUpdate = deltaTime => {
    elapsed += deltaTime * 0.001;
    apparatus.rotationY = 12 + Math.sin(elapsed * 0.12) * 12;
    innerHoop.rotationZ = -32 + Math.sin(elapsed * 0.18) * 7;
    crucible.rotationY += deltaTime * 0.001;
};

const resizeComposition = (): void => {
    const portrait = window.innerWidth < 700;
    context.camera.fov = portrait ? 60 : 38;
    context.orbitControls.setTarget(new Hilo3d.Vector3(portrait ? 0 : -0.45, 0.1, 0));
};
resizeComposition();
window.addEventListener('resize', resizeComposition);
document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    window.removeEventListener('resize', resizeComposition);
    context.dispose();
});
