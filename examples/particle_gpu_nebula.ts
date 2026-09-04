import {
    ParticleGradient,
    ParticleSystemDefinition,
    createParticleWorldSystem
} from '@hilo3d/addon-particle';
import { Color, PBRMaterial, SphereGeometry } from 'hilo3d';
import { createParticleTexture } from './shared/particle';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const requestedBackend = new URLSearchParams(location.search).get('backend');
const backend = requestedBackend === 'webgpu' ? 'webgpu' : 'webgl2';
const texture = createParticleTexture('disc');
const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'gpu-nebula',
            capacity: 4096,
            execution: backend === 'webgpu' ? 'gpu' : 'cpu',
            looping: true,
            prewarm: true,
            bounds: { mode: 'manual', min: [-6, -4, -6], max: [6, 4, 6] },
            emission: { rateOverTime: 900, bursts: [{ time: 0, count: 1800 }] },
            shape: { type: 'sphere', radius: 2.4, distribution: 'volume' },
            initialize: {
                lifetime: { min: 5, max: 12 },
                direction: { min: [-0.25, -0.2, -0.25], max: [0.25, 0.2, 0.25] },
                speed: { min: 0.03, max: 0.42 },
                size: { min: 0.015, max: 0.07 }
            },
            modules: [
                {
                    type: 'rotate-around-point',
                    center: [0, 0, 0],
                    axis: [0.1, 1, 0.05],
                    angularSpeed: { min: 0.08, max: 0.34 }
                },
                { type: 'radial-force', center: [0, 0, 0], strength: -0.08 },
                { type: 'drag', coefficient: 0.03 },
                {
                    type: 'color-over-lifetime',
                    gradient: new ParticleGradient([
                        { time: 0, color: [0.1, 0.8, 1, 0] },
                        { time: 0.2, color: [0.12, 0.65, 1, 0.9] },
                        { time: 0.65, color: [0.75, 0.12, 1, 0.75] },
                        { time: 1, color: [1, 0.12, 0.35, 0] }
                    ])
                }
            ],
            renderers: [{ type: 'sprite', texture, blend: 'additive', depthWrite: false }]
        }
    ]
});
const particleSystem = createParticleWorldSystem({
    backend,
    setup: particleRuntime => {
        particleRuntime.create({ definition, seed: 2026 });
    }
});
const runtime = await createExampleRuntime([particleSystem]);
runtime.engine.renderer.clearColor.set(0.001, 0.002, 0.012, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 9.5, 0.4, 1.2);
createMeshEntity(runtime.world, {
    geometry: new SphereGeometry({ radius: 0.38, widthSegments: 28, heightSegments: 18 }),
    material: new PBRMaterial({
        baseColor: new Color(0.02, 0.04, 0.12),
        metallic: 0.92,
        roughness: 0.12
    })
});
document.body.dataset['particleExampleReady'] = 'true';
runtime.start();
