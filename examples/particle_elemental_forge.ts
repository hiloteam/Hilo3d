import {
    ParticleCurve,
    ParticleGradient,
    ParticleSystemDefinition,
    createParticleWorldSystem
} from '@hilo3d/addon-particle';
import { BoxGeometry, Color, PBRMaterial } from 'hilo3d';
import { createParticleTexture } from './shared/particle';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const spark = createParticleTexture('spark');
const smoke = createParticleTexture('smoke');
const fade = new ParticleCurve([
    { time: 0, value: 0 },
    { time: 0.15, value: 1 },
    { time: 1, value: 0 }
]);
const sources = [
    {
        name: 'fire',
        position: [-2.1, -0.9, 0] as const,
        color: [1, 0.22, 0.02, 1] as const,
        force: [0, 1.8, 0] as const,
        texture: spark
    },
    {
        name: 'frost',
        position: [0, -0.9, 0] as const,
        color: [0.08, 0.82, 1, 1] as const,
        force: [0, 1.2, 0] as const,
        texture: smoke
    },
    {
        name: 'arcane',
        position: [2.1, -0.9, 0] as const,
        color: [0.72, 0.16, 1, 1] as const,
        force: [0, 1.5, 0] as const,
        texture: spark
    }
] as const;
const definition = ParticleSystemDefinition.create({
    emitters: sources.map(source => ({
        name: source.name,
        capacity: 1200,
        execution: 'cpu' as const,
        looping: true,
        emission: { rateOverTime: 190, bursts: [{ time: 0, count: 90 }] },
        shape: { type: 'circle' as const, radius: 0.55 },
        initialize: {
            position: source.position,
            lifetime: { min: 1.4, max: 3.2 },
            direction: { min: [-0.3, 0.4, -0.2], max: [0.3, 1, 0.2] },
            speed: { min: 0.35, max: 1.4 },
            size: { min: 0.04, max: 0.16 }
        },
        modules: [
            { type: 'gravity' as const, force: source.force },
            {
                type: 'noise' as const,
                mode: 'force' as const,
                field: 'curl' as const,
                strength: [0.45, 0.35, 0.45] as const,
                frequency: 1.3,
                octaves: 2 as const
            },
            { type: 'size-over-lifetime' as const, curve: fade },
            {
                type: 'color-over-lifetime' as const,
                gradient: new ParticleGradient([
                    { time: 0, color: [1, 1, 1, 0] },
                    { time: 0.15, color: source.color },
                    {
                        time: 1,
                        color: [
                            source.color[0] * 0.25,
                            source.color[1] * 0.25,
                            source.color[2] * 0.25,
                            0
                        ]
                    }
                ])
            }
        ],
        renderers: [
            {
                type: 'sprite' as const,
                texture: source.texture,
                blend: 'additive' as const,
                depthWrite: false
            }
        ]
    }))
});
const particleSystem = createParticleWorldSystem({
    setup: particleRuntime => {
        particleRuntime.create({ definition, seed: 777 });
    }
});
const runtime = await createExampleRuntime([particleSystem]);
runtime.engine.renderer.clearColor.set(0.002, 0.004, 0.014, 1);
runtime.controls.setView({ x: 0, y: 0.3, z: 0 }, 9.5, 0.25, 1.3);
createMeshEntity(runtime.world, {
    geometry: new BoxGeometry({ width: 7.6, height: 0.22, depth: 5 }),
    material: new PBRMaterial({
        baseColor: new Color(0.03, 0.04, 0.08),
        metallic: 0.75,
        roughness: 0.26
    }),
    position: [0, -1.5, 0]
});
document.body.dataset['particleExampleReady'] = 'true';
runtime.start();
