import {
    ParticleCurve,
    ParticleGradient,
    ParticleSystemDefinition,
    createParticleWorldSystem
} from '@hilo3d/addon-particle';
import { BoxGeometry, Color, PBRMaterial } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createParticleTexture } from './shared/particle';
import { createMeshEntity } from './shared/scene';

const texture = createParticleTexture('disc');
const colors = [
    [0.08, 0.92, 1, 1],
    [0.64, 0.2, 1, 1],
    [1, 0.58, 0.08, 1],
    [1, 0.12, 0.48, 1]
] as const;
const positions = [
    [-2.25, 0.85, 0],
    [2.25, 0.85, 0],
    [-2.25, -1.05, 0],
    [2.25, -1.05, 0]
] as const;
const definition = ParticleSystemDefinition.create({
    emitters: colors.map((color, index) => ({
        name: `noise-field-${String(index + 1)}`,
        capacity: 900,
        execution: index < 2 ? ('stateless' as const) : ('cpu' as const),
        looping: true,
        prewarm: true,
        emission: { rateOverTime: 150, bursts: [{ time: 0, count: 120 }] },
        shape: { type: 'box' as const, size: [1.25, 0.9, 0.4] },
        initialize: {
            position: positions[index] ?? [0, 0, 0],
            lifetime: { min: 3.8, max: 5.8 },
            direction: { min: [-0.08, -0.05, -0.08], max: [0.08, 0.12, 0.08] },
            speed: { min: 0.02, max: 0.16 },
            size: { min: 0.028, max: 0.078 }
        },
        modules: [
            {
                type: 'noise' as const,
                mode: index < 2 ? ('position-offset' as const) : ('force' as const),
                field: index % 2 === 0 ? ('vector' as const) : ('curl' as const),
                strength: [0.75, 0.55, 0.55] as const,
                frequency: 0.8 + index * 0.35,
                octaves: (index + 1) as 1 | 2 | 3 | 4,
                scrollVelocity: [0.08, 0.1, -0.04] as const
            },
            {
                type: 'size-over-lifetime' as const,
                curve: new ParticleCurve([
                    { time: 0, value: 0 },
                    { time: 0.2, value: 1 },
                    { time: 1, value: 0 }
                ])
            },
            {
                type: 'color-over-lifetime' as const,
                gradient: new ParticleGradient([
                    { time: 0, color: [1, 1, 1, 0] },
                    { time: 0.2, color },
                    { time: 1, color: [color[0] * 0.25, color[1] * 0.25, color[2] * 0.35, 0] }
                ])
            }
        ],
        renderers: [
            { type: 'sprite' as const, texture, blend: 'additive' as const, depthWrite: false }
        ]
    }))
});
const particleSystem = createParticleWorldSystem({
    setup: particleRuntime => {
        particleRuntime.create({ definition, seed: 111 });
    }
});
const runtime = await createExampleRuntime([particleSystem]);
runtime.engine.renderer.clearColor.set(0.001, 0.004, 0.014, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 10.2, 0.2, 1.35);
createMeshEntity(runtime.world, {
    geometry: new BoxGeometry({ width: 7.6, height: 0.22, depth: 7.6 }),
    material: new PBRMaterial({
        baseColor: new Color(0.022, 0.046, 0.11),
        metallic: 0.72,
        roughness: 0.28
    }),
    position: [0, -1.48, 0]
});
document.body.dataset['particleExampleReady'] = 'true';
runtime.start();
