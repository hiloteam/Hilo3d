# @hilo3d/addon-particle

Optional CPU, stateless, and stateful WebGPU particle systems for Hilo3D. Installing or importing
`hilo3d` alone does not load this package.

```ts
import * as Hilo3d from 'hilo3d';
import {
    PARTICLE_STAGE_SERVICE,
    ParticleSystemDefinition,
    createParticleStagePlugin
} from '@hilo3d/addon-particle';

const particlePlugin = createParticleStagePlugin();
const stage = await Hilo3d.Stage.create({
    camera,
    plugins: [particlePlugin]
});
const particles = stage.pluginHost.get(PARTICLE_STAGE_SERVICE);
const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'spark',
            capacity: 256,
            execution: 'auto',
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 64 }] },
            initialize: { lifetime: 0.8, speed: 3, size: 0.05 },
            renderers: [{ type: 'sprite', blend: 'additive' }]
        }
    ]
});

particles.createSystem({ definition, seed: 42 });
```

The Stage plugin owns registered systems, applies one optional frame-wide budget, and destroys
renderer resources before Stage teardown. `ParticleSystem` can still be used directly when an
application explicitly owns its lifecycle.
