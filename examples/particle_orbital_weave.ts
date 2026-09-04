import {
    ParticleCurve,
    ParticleGradient,
    ParticleSystemDefinition,
    createParticleWorldSystem
} from '@hilo3d/addon-particle';
import { BasicMaterial, Color, LocalTransform, PBRMaterial, SphereGeometry } from 'hilo3d';
import { createParticleTexture } from './shared/particle';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const texture = createParticleTexture('ring');
const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'orbital-weave',
            capacity: 2400,
            execution: 'cpu',
            looping: true,
            prewarm: true,
            emission: { rateOverTime: 280, bursts: [{ time: 0, count: 500 }] },
            shape: { type: 'torus', radius: 1.65, tubeRadius: 0.32, distribution: 'volume' },
            initialize: {
                lifetime: { min: 4.8, max: 7.4 },
                speed: { min: 0.04, max: 0.24 },
                size: { min: 0.03, max: 0.1 }
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
                    type: 'size-over-lifetime',
                    curve: new ParticleCurve([
                        { time: 0, value: 0.12 },
                        { time: 0.18, value: 1 },
                        { time: 1, value: 0 }
                    ])
                },
                {
                    type: 'color-over-lifetime',
                    gradient: new ParticleGradient([
                        { time: 0, color: [0.12, 0.88, 1, 0] },
                        { time: 0.2, color: [0.12, 0.88, 1, 0.95] },
                        { time: 0.7, color: [0.88, 0.16, 1, 0.82] },
                        { time: 1, color: [1, 0.44, 0.18, 0] }
                    ])
                }
            ],
            renderers: [
                {
                    type: 'sprite',
                    texture,
                    alignment: 'stretched',
                    stretchScale: 1.8,
                    blend: 'additive',
                    depthWrite: false
                }
            ]
        }
    ]
});
const particleSystem = createParticleWorldSystem({
    setup: particleRuntime => {
        particleRuntime.create({ definition, seed: 2026 });
    }
});
const runtime = await createExampleRuntime([particleSystem]);
runtime.engine.renderer.clearColor.set(0.002, 0.006, 0.018, 1);
runtime.controls.setView({ x: 0, y: 0.1, z: 0 }, 10.8, 0.42, 1.18);
const core = createMeshEntity(runtime.world, {
    geometry: new SphereGeometry({ radius: 0.72, widthSegments: 36, heightSegments: 24 }),
    material: new PBRMaterial({
        baseColor: new Color(0.012, 0.026, 0.08),
        metallic: 0.92,
        roughness: 0.12
    }),
    position: [0, 0.25, 0]
});
const wire = createMeshEntity(runtime.world, {
    geometry: new SphereGeometry({ radius: 0.745, widthSegments: 22, heightSegments: 14 }),
    material: new BasicMaterial({
        lightType: 'NONE',
        diffuse: new Color(0.38, 1, 1),
        opacity: 0.32,
        compositing: { mode: 'alpha-blend', premultiplied: true },
        state: { wireframe: true, depthWrite: false }
    }),
    position: [0, 0.25, 0]
});
document.body.dataset['particleExampleReady'] = 'true';
runtime.start(time => {
    runtime.world.set(core, LocalTransform, {
        position: [0, 0.25, 0],
        rotation: quaternionFromDegrees(time * 8, time * 16, 0)
    });
    runtime.world.set(wire, LocalTransform, {
        position: [0, 0.25, 0],
        rotation: quaternionFromDegrees(time * 11, -time * 19, 0)
    });
});
