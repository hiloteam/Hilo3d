# Particle effects

Install the particle addon as a World System:

```ts
import { ParticleSystemDefinition, createParticleWorldSystem } from '@hilo3d/addon-particle';

const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'spark-burst',
            capacity: 512,
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 80 }] },
            shape: { type: 'sphere', radius: 0.12 },
            initialize: {
                lifetime: { min: 0.35, max: 0.8 },
                speed: { min: 1.5, max: 4 },
                size: { min: 0.025, max: 0.07 },
                color: [1, 0.45, 0.08, 1]
            },
            modules: [{ type: 'gravity', force: [0, -4, 0] }],
            renderers: [{ type: 'sprite', blend: 'additive' }]
        }
    ]
});

const particles = createParticleWorldSystem({
    setup(runtime): void {
        runtime.create({ definition });
    }
});
```

Pass the particle System to `World.create()` before transform and render extraction. It owns its
runtime resource and exposes rendering only through the explicit ECS render-extension component;
there is no scene-node registration table.

Use bounded capacities and event/readback budgets. Prefer portable CPU execution when both backends
must match; select advanced stateful/stateless GPU paths only when their declared capability gates
pass. Destroy the World to release the installed particle runtime, then destroy application-owned
textures or geometry.
