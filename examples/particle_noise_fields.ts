import * as Hilo3d from '../src/Hilo3d';
import * as Particle from '@hilo/addon-particle';
import { createExampleContext } from './shared/init';
import { installExampleDisposal } from './shared/particleShowcase';

const context = await createExampleContext({
    camera: { fov: 38, near: 0.1, far: 70, x: 0, y: 0.15, z: 10.8 },
    stage: {
        pixelRatio: 1.5,
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: { threshold: 0.74, knee: 0.4, intensity: 0.42, scatter: 0.6, maxLevels: 5 },
            colorUber: {
                exposure: 0.06,
                contrast: 0.08,
                saturation: 0.02,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.32,
                vignetteSmoothness: 0.76,
                vignetteColor: new Hilo3d.Color(0.008, 0.012, 0.016, 0.5)
            }
        })
    },
    controls: {
        target: new Hilo3d.Vector3(0, 0.15, 0),
        minDistance: 8,
        maxDistance: 17,
        minPolarAngle: 0.95,
        maxPolarAngle: 2.05
    }
});
const { stage, renderer } = context;
renderer.clearColor.set(0.003, 0.008, 0.015, 1);

/** Smooth grains and low-opacity gas have no hard heads or radial star rays. */
function createFilamentTexture(soft = false): Hilo3d.Texture<Uint8Array> {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = ((x + 0.5) / size) * 2 - 1;
            const v = ((y + 0.5) / size) * 2 - 1;
            const radius = Math.hypot(u, v);
            const alpha = Math.exp(-(u * u + v * v) * (soft ? 3 : 8)) * Math.max(0, 1 - radius);
            const offset = (y * size + x) * 4;
            data[offset] = 255;
            data[offset + 1] = 255;
            data[offset + 2] = 255;
            data[offset + 3] = Math.round(alpha * 255);
        }
    }
    return new Hilo3d.Texture({
        image: data,
        width: size,
        height: size,
        internalFormat: Hilo3d.constants.RGBA8,
        format: Hilo3d.constants.RGBA,
        type: Hilo3d.constants.UNSIGNED_BYTE,
        wrapS: Hilo3d.constants.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.CLAMP_TO_EDGE,
        minFilter: Hilo3d.constants.LINEAR,
        magFilter: Hilo3d.constants.LINEAR
    });
}
const texture = createFilamentTexture();
const mistTexture = createFilamentTexture(true);
interface Field {
    readonly name: string;
    readonly position: Particle.ParticleVector3;
    readonly mode: 'position-offset' | 'force';
    readonly field: 'vector' | 'curl';
    readonly color: Particle.ParticleColor;
}
const fields: readonly Field[] = [
    {
        name: 'jade-current',
        position: [-2.15, 1.15, 0],
        mode: 'position-offset',
        field: 'vector',
        color: [0.14, 0.85, 0.65, 0.75]
    },
    {
        name: 'glacial-gyre',
        position: [2.15, 1.15, 0],
        mode: 'position-offset',
        field: 'curl',
        color: [0.22, 0.61, 1, 0.72]
    },
    {
        name: 'gilded-drift',
        position: [-2.15, -1.25, 0],
        mode: 'force',
        field: 'vector',
        color: [1, 0.56, 0.13, 0.72]
    },
    {
        name: 'copper-eddy',
        position: [2.15, -1.25, 0],
        mode: 'force',
        field: 'curl',
        color: [1, 0.24, 0.15, 0.72]
    }
];

/** Deterministic emission samples form a fluid volume, never a rendered line mesh. */
function pointOnCurrent(
    study: number,
    u: number,
    lane: number,
    depth: number
): Particle.ParticleVector3 {
    const t = u * Math.PI * 2;
    if (study === 0) {
        return [
            (u - 0.5) * 3.15,
            Math.sin(u * 5.8 - 0.8) * 0.37 + lane * (0.1 + Math.sin(u * Math.PI) * 0.45),
            depth * 0.19 + Math.cos(u * 4.2) * 0.13
        ];
    }
    if (study === 1) {
        const radius = 0.64 + lane * 0.22 + Math.sin(t * 2.3) * 0.08;
        return [
            Math.cos(t) * radius * 1.65,
            Math.sin(t) * radius * 0.72,
            depth * 0.16 + Math.sin(t) * 0.16
        ];
    }
    if (study === 2) {
        return [
            (u - 0.5) * 3.15,
            Math.sin(u * 5.4 + 0.35) * 0.36 +
                lane * (0.08 + Math.pow(Math.sin(u * Math.PI), 2) * 0.62),
            depth * 0.17 + Math.sin(u * 7) * 0.13
        ];
    }
    const angle = t * 1.1 - 0.8;
    const radius = 0.12 + Math.pow(u, 0.7) * 0.93 + lane * (0.025 + u * 0.16);
    return [
        Math.cos(angle) * radius * 1.35,
        Math.sin(angle) * radius * 0.7,
        depth * 0.13 + Math.cos(angle) * 0.12
    ];
}
function random(index: number, channel: number): number {
    let value = (Math.imul(index + 19, 0x9e3779b1) ^ Math.imul(channel + 47, 0x85ebca6b)) >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d) >>> 0;
    value ^= value >>> 15;
    return (value >>> 0) / 0x1_0000_0000;
}

const studies = fields.map((field, index) => {
    const definition = Particle.ParticleSystemDefinition.create({
        emitters: [
            {
                name: field.name,
                capacity: 5000,
                fixedStep: 1 / 30,
                execution: 'cpu',
                simulationSpace: 'local',
                bounds: { mode: 'manual', min: [-2.2, -1.1, -0.8], max: [2.2, 1.1, 0.8] },
                initialize: {
                    lifetime: { min: 1.35, max: 2.1 },
                    size: { min: 0.02, max: 0.036 }
                },
                modules: [
                    {
                        type: 'noise',
                        mode: field.mode,
                        field: field.field,
                        strength:
                            field.mode === 'position-offset'
                                ? [0.035, 0.045, 0.035]
                                : [0.09, 0.1, 0.07],
                        frequency: 1.25,
                        octaves: 1,
                        scrollVelocity: [0.13, 0.09, 0.08],
                        seedOffset: index * 31
                    },
                    { type: 'drag', coefficient: 0.12 },
                    {
                        type: 'size-over-lifetime',
                        curve: new Particle.ParticleCurve([
                            { time: 0, value: 0.7 },
                            { time: 1, value: 1.3 }
                        ])
                    },
                    {
                        type: 'color-over-lifetime',
                        gradient: new Particle.ParticleGradient([
                            {
                                time: 0,
                                color: [
                                    0.65 + field.color[0] * 0.35,
                                    0.65 + field.color[1] * 0.35,
                                    0.65 + field.color[2] * 0.35,
                                    0
                                ]
                            },
                            { time: 0.15, color: field.color },
                            {
                                time: 0.55,
                                color: [
                                    field.color[0] * 0.65,
                                    field.color[1] * 0.72,
                                    field.color[2] * 0.85,
                                    0.4
                                ]
                            },
                            {
                                time: 1,
                                color: [
                                    field.color[0] * 0.35,
                                    field.color[1] * 0.4,
                                    field.color[2] * 0.65,
                                    0
                                ]
                            }
                        ])
                    }
                ],
                renderers: [
                    {
                        type: 'sprite',
                        texture,
                        alignment: 'stretched',
                        stretchScale: 2,
                        blend: 'additive',
                        depthWrite: false,
                        sort: 'none'
                    }
                ]
            },
            {
                // A small base opacity prevents a flash on birth; the gradient is a multiplier.
                name: 'mist',
                capacity: 1400,
                execution: 'cpu',
                fixedStep: 1 / 30,
                bounds: { mode: 'manual', min: [-2.2, -1.1, -0.8], max: [2.2, 1.1, 0.8] },
                initialize: {
                    lifetime: { min: 1.4, max: 2 },
                    size: { min: 0.08, max: 0.14 },
                    color: [field.color[0], field.color[1], field.color[2], 0.03]
                },
                modules: [
                    {
                        type: 'size-over-lifetime',
                        curve: new Particle.ParticleCurve([
                            { time: 0, value: 0.6 },
                            { time: 1, value: 1.4 }
                        ])
                    },
                    {
                        type: 'color-over-lifetime',
                        gradient: new Particle.ParticleGradient([
                            { time: 0, color: [1, 1, 1, 0] },
                            {
                                time: 0.22,
                                color: [1, 1, 1, 1.4]
                            },
                            {
                                time: 0.65,
                                color: [1, 1, 1, 0.65]
                            },
                            { time: 1, color: [1, 1, 1, 0] }
                        ])
                    }
                ],
                renderers: [
                    {
                        type: 'sprite',
                        texture: mistTexture,
                        alignment: 'view',
                        blend: 'additive',
                        depthWrite: false,
                        renderOrder: -1
                    }
                ]
            }
        ]
    });
    const system = new Particle.ParticleSystem({
        definition,
        seed: 401 + index * 73,
        autoPlay: false,
        x: field.position[0],
        y: field.position[1],
        z: field.position[2]
    }).addTo(stage);
    const samples: Readonly<Particle.ParticleSystemEmitCommand>[] = [];
    for (let sample = 0; sample < 4096; sample += 1) {
        const u = random(sample, index * 7);
        const lane = (random(sample, 8) + random(sample, 9) + random(sample, 10) - 1.5) * 0.68;
        const depth = random(sample, 11) * 2 - 1;
        const point = pointOnCurrent(index, u, lane, depth);
        const next = pointOnCurrent(index, u + 0.001, lane, depth);
        const speed = 0.19 + random(sample, 12) * 0.17;
        const dx = next[0] - point[0];
        const dy = next[1] - point[1];
        const dz = next[2] - point[2];
        const scale = speed / Math.max(0.00001, Math.hypot(dx, dy, dz));
        samples.push({
            count: 1,
            emitter: sample % 4 === 0 ? 'mist' : field.name,
            position: point,
            velocity: [dx * scale, dy * scale, dz * scale]
        });
    }
    return { system, samples, cursor: 0, accumulator: 0 };
});

function advanceCurrent(seconds: number): void {
    for (const study of studies) {
        study.accumulator += seconds * 2100;
        const count = Math.floor(study.accumulator);
        study.accumulator -= count;
        for (let index = 0; index < count; index += 1) {
            const sample = study.samples[study.cursor];
            if (sample) study.system.emit(sample);
            study.cursor = (study.cursor + 1597) % study.samples.length;
        }
        study.system.simulate(seconds);
    }
}
// Fixed-step warm-up fills the live currents without substituting static contour geometry.
for (let frame = 0; frame < 63; frame += 1) advanceCurrent(1 / 30);

const labelElements = document.querySelectorAll<HTMLElement>('.noise-label');
const studyLabels = studies.map((study, index) => {
    const element = labelElements[index];
    if (!element) throw new Error('Each noise study requires a label');
    return {
        study: study.system,
        element,
        projected: new Hilo3d.Vector3(),
        worldMatrix: new Hilo3d.Matrix4()
    };
});
let viewportWidth = window.innerWidth;
let viewportHeight = window.innerHeight;
function updateStudyLabels(): void {
    context.camera.updateViewProjectionMatrix();
    for (const label of studyLabels) {
        label.worldMatrix.multiply(stage.worldMatrix, label.study.matrix);
        label.projected
            .set(0, viewportWidth < 720 ? -0.7 : -0.88, 0)
            .transformMat4(label.worldMatrix)
            .transformMat4(context.camera.viewProjectionMatrix);
        const x = (label.projected.x + 1) * viewportWidth * 0.5;
        const y = (1 - label.projected.y) * viewportHeight * 0.5 + 20;
        const visible =
            label.projected.z > -1 &&
            label.projected.z < 1 &&
            x > 24 &&
            x < viewportWidth - 24 &&
            y > 24 &&
            y < viewportHeight - 112;
        label.element.style.visibility = visible ? 'visible' : 'hidden';
        if (visible)
            label.element.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translateX(-50%)`;
    }
}
function fitStudies(): void {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    const portrait = viewportWidth < 720 && viewportWidth < viewportHeight;
    studies.forEach((study, index) => {
        const field = fields[index];
        if (!field) return;
        study.system.position.set(
            portrait ? 0 : field.position[0],
            portrait ? 1.98 - index * 1.15 : field.position[1],
            0
        );
        study.system.setScale(portrait ? 0.64 : 1);
    });
    context.orbitControls.setView(
        new Hilo3d.Vector3(0, 0.15, portrait ? 9.8 : 10.8),
        new Hilo3d.Vector3(0, 0.15, 0)
    );
}
fitStudies();
window.addEventListener('resize', fitStudies);
let accumulator = 0;
stage.onUpdate = deltaTime => {
    accumulator += Math.min(deltaTime * 0.001, 0.1);
    let steps = 0;
    while (accumulator >= 1 / 30 && steps < 3) {
        advanceCurrent(1 / 30);
        accumulator -= 1 / 30;
        steps += 1;
    }
    updateStudyLabels();
};
document.body.dataset['particleExampleReady'] = 'true';
installExampleDisposal(() => {
    window.removeEventListener('resize', fitStudies);
    context.dispose();
});
