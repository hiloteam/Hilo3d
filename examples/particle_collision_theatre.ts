import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import {
    createParticleTexture,
    installExampleDisposal,
    requireElement
} from './shared/particleShowcase';

type RainPayload = Readonly<{
    position: Hilo3d.ParticleVector3;
    velocity: Hilo3d.ParticleVector3;
}>;

type CollisionLane = Readonly<{
    emitter: string;
    event: string;
    x: number;
    phase: number;
    burstCounts: readonly [number, number, number];
    color: readonly [number, number, number];
    collider: Hilo3d.ParticleAnalyticCollider;
}>;

const context = await createExampleContext({
    camera: { fov: 40, near: 0.1, far: 60, x: 0.15, y: 2.5, z: 11.8 },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.95, knee: 0.2, intensity: 0.24, scatter: 0.3, maxLevels: 3 },
            colorUber: {
                exposure: -0.18,
                contrast: 0.13,
                saturation: 0.1,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.58,
                vignetteSmoothness: 0.6,
                vignetteColor: new Hilo3d.Color(0.004, 0.006, 0.018, 0.62)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0.15, 0.55, 0),
        minDistance: 8,
        maxDistance: 17,
        minPolarAngle: 0.62,
        maxPolarAngle: 2.05
    }
});
const { stage, renderer, directionLight, ambientLight } = context;

renderer.clearColor.set(0.002, 0.004, 0.012, 1);
directionLight.amount = 3.8;
directionLight.color.set(0.66, 0.82, 1, 1);
directionLight.direction.set(-0.35, -1, -0.24);
ambientLight.amount = 0.28;
ambientLight.color.set(0.28, 0.34, 0.72, 1);

const floorY = -1.24;
new Hilo3d.Mesh({
    y: floorY - 0.1,
    geometry: new Hilo3d.BoxGeometry({ width: 8.8, height: 0.2, depth: 5.6 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.018, 0.04, 0.095),
        metallic: 0.84,
        roughness: 0.24
    }),
    receiveShadows: true
}).addTo(stage);

const lanes: readonly CollisionLane[] = Object.freeze([
    {
        emitter: 'sphere-stream',
        event: 'impact-sphere',
        x: -2.7,
        phase: 0.15,
        burstCounts: [1, 3, 1],
        color: [0.08, 0.88, 1],
        collider: { type: 'sphere', center: [-2.7, -0.4, 0], radius: 0.68 }
    },
    {
        emitter: 'box-stream',
        event: 'impact-box',
        x: -0.88,
        phase: 0.65,
        burstCounts: [2, 1, 4],
        color: [0.92, 0.16, 1],
        collider: { type: 'box', center: [-0.88, -0.5, 0], size: [1.08, 1.08, 1.08] }
    },
    {
        emitter: 'capsule-stream',
        event: 'impact-capsule',
        x: 1.12,
        phase: 1.1,
        burstCounts: [1, 2, 1],
        color: [1, 0.42, 0.06],
        collider: {
            type: 'capsule',
            start: [0.68, -0.92, 0],
            end: [1.48, 0.82, 0],
            radius: 0.25
        }
    },
    {
        emitter: 'plane-stream',
        event: 'impact-plane',
        x: 3,
        phase: 1.6,
        burstCounts: [3, 1, 2],
        color: [0.34, 1, 0.46],
        collider: { type: 'plane', normal: [0, 1, 0], offset: floorY }
    }
]);

function laneMaterial(color: readonly [number, number, number]): Hilo3d.PBRMaterial {
    return new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(color[0] * 0.1, color[1] * 0.1, color[2] * 0.1),
        metallic: 0.68,
        roughness: 0.32,
        emissionFactor: new Hilo3d.Color(color[0] * 0.016, color[1] * 0.016, color[2] * 0.016)
    });
}

function laneWireMaterial(color: readonly [number, number, number]): Hilo3d.BasicMaterial {
    return new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(color[0] * 0.9, color[1] * 0.9, color[2] * 0.9),
        compositing: { mode: 'alpha-blend', premultiplied: false },
        opacity: 0.78,
        state: { wireframe: true, depthWrite: false }
    });
}

function addColliderMesh(
    geometry: Hilo3d.Geometry,
    wireGeometry: Hilo3d.Geometry,
    position: Hilo3d.ParticleVector3,
    color: readonly [number, number, number],
    rotationZ = 0
): Hilo3d.Node {
    const root = new Hilo3d.Node({
        x: position[0],
        y: position[1],
        z: position[2],
        rotationZ
    }).addTo(stage);
    new Hilo3d.Mesh({ geometry, material: laneMaterial(color), castShadows: false }).addTo(root);
    new Hilo3d.Mesh({
        geometry: wireGeometry,
        material: laneWireMaterial(color),
        castShadows: false
    }).addTo(root);
    return root;
}

addColliderMesh(
    new Hilo3d.SphereGeometry({ radius: 0.68, widthSegments: 22, heightSegments: 14 }),
    new Hilo3d.SphereGeometry({ radius: 0.695, widthSegments: 22, heightSegments: 14 }),
    [-2.7, -0.4, 0],
    lanes[0]?.color ?? [0, 1, 1]
);
addColliderMesh(
    new Hilo3d.BoxGeometry({ width: 1.08, height: 1.08, depth: 1.08 }),
    new Hilo3d.BoxGeometry({ width: 1.1, height: 1.1, depth: 1.1 }),
    [-0.88, -0.5, 0],
    lanes[1]?.color ?? [1, 0, 1]
);

const capsuleStart = lanes[2]?.collider;
if (capsuleStart?.type !== 'capsule') throw new Error('Collision theatre capsule lane is invalid');
const capsuleDx = capsuleStart.end[0] - capsuleStart.start[0];
const capsuleDy = capsuleStart.end[1] - capsuleStart.start[1];
const capsuleLength = Math.hypot(capsuleDx, capsuleDy);
const capsuleCenter: Hilo3d.ParticleVector3 = [
    (capsuleStart.start[0] + capsuleStart.end[0]) * 0.5,
    (capsuleStart.start[1] + capsuleStart.end[1]) * 0.5,
    0
];
const capsuleColor = lanes[2]?.color ?? [1, 0.5, 0];
addColliderMesh(
    new Hilo3d.BoxGeometry({ width: 0.5, height: capsuleLength, depth: 0.5 }),
    new Hilo3d.BoxGeometry({ width: 0.515, height: capsuleLength + 0.015, depth: 0.515 }),
    capsuleCenter,
    capsuleColor,
    -(Math.atan2(capsuleDx, capsuleDy) * 180) / Math.PI
);
for (const endpoint of [capsuleStart.start, capsuleStart.end]) {
    addColliderMesh(
        new Hilo3d.SphereGeometry({
            radius: capsuleStart.radius,
            widthSegments: 16,
            heightSegments: 10
        }),
        new Hilo3d.SphereGeometry({
            radius: capsuleStart.radius + 0.012,
            widthSegments: 16,
            heightSegments: 10
        }),
        endpoint,
        capsuleColor
    );
}

addColliderMesh(
    new Hilo3d.BoxGeometry({ width: 1.35, height: 0.08, depth: 1.35 }),
    new Hilo3d.BoxGeometry({ width: 1.38, height: 0.095, depth: 1.38 }),
    [3, floorY + 0.04, 0],
    lanes[3]?.color ?? [0.3, 1, 0.5]
);

for (const lane of lanes) {
    const sourcePort = new Hilo3d.Mesh({
        x: lane.x,
        y: 2.92,
        geometry: new Hilo3d.SphereGeometry({ radius: 0.16, widthSegments: 14, heightSegments: 6 }),
        material: laneWireMaterial(lane.color),
        castShadows: false
    }).addTo(stage);
    sourcePort.scale.set(1.2, 0.1, 1.2);
}

const meteorTexture = createParticleTexture({ style: 'comet' });
const glowTexture = createParticleTexture({ style: 'disc' });
const fadeCurve = new Hilo3d.ParticleCurve(
    [
        { time: 0, value: 0.12 },
        { time: 0.1, value: 1 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
const sparkFadeCurve = new Hilo3d.ParticleCurve(
    [
        { time: 0, value: 0.72 },
        { time: 0.08, value: 1 },
        { time: 0.62, value: 0.68 },
        { time: 1, value: 0 }
    ],
    { interpolation: 'smooth' }
);
function collisionEmitter(lane: CollisionLane): Hilo3d.ParticleEmitterDefinitionInput {
    const triggerModule: readonly Hilo3d.ParticleModule[] =
        lane.emitter === 'sphere-stream'
            ? [
                  {
                      type: 'trigger',
                      volumes: [{ type: 'sphere', center: [-2.7, 1.62, 0], radius: 0.58 }],
                      events: { enter: 'gate-enter', inside: 'gate-inside', exit: 'gate-exit' }
                  }
              ]
            : [];
    return {
        name: lane.emitter,
        capacity: 96,
        execution: 'cpu',
        duration: 9.5,
        fixedStep: 1 / 120,
        maxCatchUpSteps: 16,
        eventCapacity: 768,
        eventOverflow: 'drop-oldest',
        bounds: { mode: 'dynamic' },
        emission: {
            rateOverTime: { min: 0.12, max: 0.45 },
            bursts: lane.burstCounts.map((count, index) => ({
                time: lane.phase + index * 3.1,
                count
            }))
        },
        shape: { type: 'disc', radius: 0.2, distribution: 'volume' },
        initialize: {
            position: [lane.x, 2.72, 0],
            direction: { min: [-0.08, -1, -0.04], max: [0.08, -0.96, 0.04] },
            speed: { min: 1.4, max: 2.05 },
            lifetime: { min: 3.8, max: 5.2 },
            size: { min: 0.11, max: 0.145 },
            mass: { min: 0.8, max: 1.25 }
        },
        modules: [
            { type: 'gravity', force: [0, -0.4, 0] },
            { type: 'drag', coefficient: 0.035 },
            {
                type: 'collision',
                colliders: [lane.collider],
                bounce: 0.38,
                friction: 0.06,
                radiusScale: 0.8,
                lifetimeLoss: 0.78,
                event: lane.event
            },
            ...triggerModule,
            {
                type: 'sub-emitter',
                event: lane.event,
                emitter: 'impact-sparks',
                count: 96,
                inheritVelocity: false
            },
            { type: 'size-by-speed', speedRange: [0, 4], curve: fadeCurve },
            {
                type: 'color-over-lifetime',
                gradient: new Hilo3d.ParticleGradient([
                    {
                        time: 0,
                        color: [lane.color[0] * 1.8, lane.color[1] * 1.8, lane.color[2] * 1.8, 1]
                    },
                    {
                        time: 0.55,
                        color: [lane.color[0] * 1.25, lane.color[1] * 1.25, lane.color[2] * 1.25, 1]
                    },
                    { time: 1, color: [1, 0.3, 0.04, 0.72] }
                ])
            }
        ],
        renderers: [
            {
                type: 'sprite',
                texture: meteorTexture,
                alignment: 'stretched',
                stretchScale: 1.5,
                pivot: [0.5, 1],
                blend: 'additive',
                depthWrite: false,
                sort: 'distance',
                renderOrder: 2
            },
            {
                type: 'sprite',
                texture: glowTexture,
                alignment: 'view',
                blend: 'additive',
                depthWrite: false,
                sort: 'distance',
                renderOrder: 3
            }
        ]
    };
}

const definition = Hilo3d.ParticleSystemDefinition.create({
    emitters: [
        ...lanes.map(collisionEmitter),
        {
            name: 'rain-stream',
            capacity: 420,
            execution: 'cpu',
            duration: 9.5,
            fixedStep: 1 / 120,
            maxCatchUpSteps: 16,
            eventCapacity: 1_024,
            eventOverflow: 'drop-oldest',
            overflow: 'replace-oldest',
            bounds: { mode: 'dynamic' },
            emission: { rateOverTime: 0 },
            initialize: {
                direction: [0, -1, 0],
                speed: 3,
                lifetime: { min: 2.6, max: 4.2 },
                size: { min: 0.085, max: 0.12 },
                mass: { min: 0.72, max: 1.1 }
            },
            modules: [
                { type: 'gravity', force: [0, -0.55, 0] },
                { type: 'drag', coefficient: 0.025 },
                {
                    type: 'collision',
                    colliders: [{ type: 'plane', normal: [0, 1, 0], offset: floorY }],
                    bounce: 0.12,
                    friction: 0.04,
                    radiusScale: 0.7,
                    lifetimeLoss: 0.9,
                    event: 'impact-rain'
                },
                {
                    type: 'sub-emitter',
                    event: 'impact-rain',
                    emitter: 'impact-sparks',
                    count: 14,
                    inheritVelocity: false
                },
                { type: 'size-by-speed', speedRange: [0, 5], curve: fadeCurve },
                {
                    type: 'color-over-lifetime',
                    gradient: new Hilo3d.ParticleGradient([
                        { time: 0, color: [1.45, 1.8, 2.3, 1] },
                        { time: 0.55, color: [0.36, 0.9, 1.5, 0.95] },
                        { time: 1, color: [1, 0.24, 0.025, 0.7] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: meteorTexture,
                    alignment: 'stretched',
                    stretchScale: 1.35,
                    pivot: [0.5, 1],
                    blend: 'additive',
                    depthWrite: false,
                    sort: 'distance',
                    renderOrder: 2
                },
                {
                    type: 'sprite',
                    texture: glowTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthWrite: false,
                    sort: 'distance',
                    renderOrder: 3
                }
            ]
        },
        {
            name: 'impact-sparks',
            capacity: 9_600,
            execution: 'cpu',
            eventCapacity: 8_192,
            eventOverflow: 'drop-oldest',
            overflow: 'replace-oldest',
            bounds: { mode: 'dynamic' },
            shape: { type: 'sphere', radius: 0.09, distribution: 'surface' },
            initialize: {
                lifetime: { min: 0.42, max: 0.92 },
                speed: { min: 0.35, max: 2.45 },
                size: { min: 0.025, max: 0.06 }
            },
            modules: [
                { type: 'gravity', force: [0, -1.35, 0] },
                { type: 'drag', coefficient: 0.58 },
                { type: 'size-over-lifetime', curve: sparkFadeCurve },
                { type: 'alpha-over-lifetime', curve: sparkFadeCurve },
                {
                    type: 'color-over-lifetime',
                    gradient: new Hilo3d.ParticleGradient([
                        { time: 0, color: [2.4, 2.1, 1.25, 1] },
                        { time: 0.28, color: [2.2, 0.62, 0.04, 1] },
                        { time: 0.72, color: [1.2, 0.12, 0.015, 0.9] },
                        { time: 1, color: [0.45, 0.01, 0.005, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: glowTexture,
                    alignment: 'view',
                    blend: 'additive',
                    depthWrite: false,
                    renderOrder: 5
                }
            ]
        }
    ]
});

const particles = new Hilo3d.ParticleSystem({
    definition,
    seed: 991,
    eventReadbackCapacity: 12_288
}).addTo(stage);

const rainChannel = new Hilo3d.ParticleEventChannel<RainPayload>({
    name: 'theatre-rain',
    capacity: 192,
    overflow: 'drop-oldest',
    schema: { position: 'vec3', velocity: 'vec3' }
});

const readout = requireElement('#particle-readout', HTMLOutputElement);
const burstButton = requireElement('#burst-button', HTMLButtonElement);
const pauseButton = requireElement('#pause-button', HTMLButtonElement);
const restartButton = requireElement('#restart-button', HTMLButtonElement);
const totals: Record<string, number> = {};
let rainBurstIndex = 0;

function rainRandom(index: number, channel: number): number {
    let value = (Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 17, 0x85ebca6b)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d) >>> 0;
    value ^= value >>> 15;
    return (value >>> 0) / 0x1_0000_0000;
}

function launchMeteorRain(): void {
    const rainCount = 144;
    const sequenceBase = rainBurstIndex * rainCount;
    rainBurstIndex += 1;
    for (let index = 0; index < rainCount; index += 1) {
        const sequence = sequenceBase + index;
        rainChannel.submit({
            position: [
                -4.15 + rainRandom(sequence, 0) * 8.3,
                3.05 + rainRandom(sequence, 1) * 1.55,
                -1.4 + rainRandom(sequence, 2) * 2.8
            ],
            velocity: [
                (rainRandom(sequence, 3) - 0.5) * 0.24,
                -(2.45 + rainRandom(sequence, 4) * 1.75),
                (rainRandom(sequence, 5) - 0.5) * 0.16
            ]
        });
    }
    rainChannel.emitTo(particles, {
        emitter: 'rain-stream',
        positionField: 'position',
        velocityField: 'velocity',
        count: 1
    });
}

burstButton.addEventListener('click', () => {
    launchMeteorRain();
});
pauseButton.addEventListener('click', () => {
    if (particles.playing) {
        particles.pause();
        pauseButton.textContent = 'Play';
    } else {
        particles.play();
        pauseButton.textContent = 'Pause';
    }
});
restartButton.addEventListener('click', () => {
    particles.restart();
    rainChannel.drain();
    rainBurstIndex = 0;
    pauseButton.textContent = 'Pause';
    for (const key of Object.keys(totals)) totals[key] = 0;
});

const canvas = stage.renderer.domElement;
if (canvas === null) throw new Error('Particle collision theatre requires a presentation canvas');
let pointerStart: Readonly<{ id: number; x: number; y: number }> | null = null;
canvas.addEventListener('pointerdown', event => {
    if (event.button === 0) {
        pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
});
canvas.addEventListener('pointerup', event => {
    if (pointerStart?.id !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    pointerStart = null;
    if (distance <= 6) launchMeteorRain();
});
canvas.addEventListener('pointercancel', () => {
    pointerStart = null;
});

let readingEvents = false;
let lastRead = 0;
particles.onUpdate = () => {
    const now = performance.now();
    if (readingEvents || now - lastRead < 140) return;
    lastRead = now;
    readingEvents = true;
    void particles.readEvents(12_288).then(aggregate => {
        for (const [name, count] of Object.entries(aggregate.counts)) {
            totals[name] = (totals[name] ?? 0) + count;
        }
        const impactCount =
            lanes.reduce((sum, lane) => sum + (totals[lane.event] ?? 0), 0) +
            (totals['impact-rain'] ?? 0);
        readout.textContent = [
            `alive      ${String(particles.aliveCount).padStart(5)}`,
            `collisions ${String(impactCount).padStart(5)}`,
            `sphere     ${String(totals['impact-sphere'] ?? 0).padStart(5)}`,
            `box        ${String(totals['impact-box'] ?? 0).padStart(5)}`,
            `capsule    ${String(totals['impact-capsule'] ?? 0).padStart(5)}`,
            `plane      ${String(totals['impact-plane'] ?? 0).padStart(5)}`,
            `rain       ${String(totals['impact-rain'] ?? 0).padStart(5)}`,
            `trigger    ${String(totals['gate-enter'] ?? 0).padStart(5)}`,
            `dropped    ${String(aggregate.droppedCount + rainChannel.droppedCount).padStart(5)}`,
            '',
            'click canvas · full-field meteor rain'
        ].join('\n');
        readingEvents = false;
    });
};

document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    context.dispose();
});
