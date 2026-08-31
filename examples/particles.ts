import { ParticleSystemDefinition, createParticleWorldSystem } from '@hilo3d/addon-particle';
import { createExampleRuntime } from './shared/runtime';

const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'sparks',
            capacity: 2048,
            looping: true,
            emission: { rateOverTime: 180 },
            shape: { type: 'sphere', radius: 0.3 },
            initialize: {
                lifetime: { min: 0.8, max: 1.8 },
                speed: { min: 0.8, max: 2.6 },
                size: { min: 0.04, max: 0.12 },
                color: [0.2, 0.7, 1, 1]
            },
            modules: [{ type: 'gravity', force: [0, -1.4, 0] }],
            renderers: [{ type: 'sprite', blend: 'additive' }]
        }
    ]
});
const particleSystem = createParticleWorldSystem({
    setup(runtime): void {
        runtime.create({ definition });
    }
});
const runtime = await createExampleRuntime([particleSystem]);
runtime.start();
