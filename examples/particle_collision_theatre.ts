import {
    ParticleCurve,
    ParticleGradient,
    ParticleSystemDefinition,
    createParticleWorldSystem
} from '@hilo3d/addon-particle';
import { BoxGeometry, Color, PBRMaterial } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';
import { createParticleTexture } from './shared/particle';

const particleTexture = createParticleTexture('spark');
const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'collision-rain',
            capacity: 1800,
            execution: 'cpu',
            looping: true,
            emission: { rateOverTime: 220, bursts: [{ time: 0, count: 180 }] },
            shape: { type: 'line', start: [-3, 3, 0], end: [3, 3, 0] },
            initialize: {
                lifetime: { min: 3, max: 6 },
                direction: { min: [-0.3, -1, -0.2], max: [0.3, -0.5, 0.2] },
                speed: { min: 1.4, max: 3.8 },
                size: { min: 0.035, max: 0.09 }
            },
            modules: [
                { type: 'gravity', force: [0, -2.4, 0] },
                {
                    type: 'collision',
                    colliders: [
                        { type: 'plane', normal: [0, 1, 0], offset: 1.35 },
                        { type: 'sphere', center: [0, 0.2, 0], radius: 1.1 },
                        { type: 'box', center: [-2.1, -0.4, 0], size: [1.2, 0.7, 1.2] }
                    ],
                    bounce: 0.72,
                    friction: 0.08,
                    event: 'impact'
                },
                {
                    type: 'size-over-lifetime',
                    curve: new ParticleCurve([
                        { time: 0, value: 0.4 },
                        { time: 0.2, value: 1 },
                        { time: 1, value: 0 }
                    ])
                },
                {
                    type: 'color-over-lifetime',
                    gradient: new ParticleGradient([
                        { time: 0, color: [0.15, 0.9, 1, 1] },
                        { time: 0.55, color: [0.75, 0.2, 1, 0.9] },
                        { time: 1, color: [1, 0.2, 0.1, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture: particleTexture,
                    alignment: 'stretched',
                    stretchScale: 2.4,
                    blend: 'additive',
                    depthWrite: false
                }
            ]
        }
    ]
});
const particleSystem = createParticleWorldSystem({
    setup: particleRuntime => {
        particleRuntime.create({ definition, seed: 420 });
    }
});
const runtime = await createExampleRuntime([particleSystem]);
runtime.engine.renderer.clearColor.set(0.002, 0.004, 0.015, 1);
runtime.controls.setView({ x: 0, y: 0.5, z: 0 }, 9, 0.3, 1.3);
createMeshEntity(runtime.world, {
    geometry: new BoxGeometry({ width: 8, height: 0.2, depth: 6 }),
    material: new PBRMaterial({
        baseColor: new Color(0.025, 0.06, 0.13),
        metallic: 0.55,
        roughness: 0.36
    }),
    position: [0, -1.45, 0]
});
document.body.dataset['particleExampleReady'] = 'true';
runtime.start();
