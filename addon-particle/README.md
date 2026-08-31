# @hilo3d/addon-particle

Optional production particle simulation and rendering for Hilo3D's ECS runtime.

```ts
import { LocalTransform, World, createRenderExtractionSystem, createTransformSystem } from 'hilo3d';
import {
    ParticleEmitter,
    ParticleSystem,
    ParticleSystemDefinition,
    createParticleWorldSystem
} from '@hilo3d/addon-particle';

const world = await World.create({
    systems: [
        createParticleWorldSystem({ backend: 'webgpu' }),
        createTransformSystem(),
        createRenderExtractionSystem()
    ]
});
const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'sparks',
            capacity: 4096,
            emission: { rateOverTime: 200 },
            initialize: { lifetime: 2, speed: 4 },
            modules: [{ type: 'gravity', force: [0, -9.81, 0] }],
            renderers: [{ type: 'sprite', blend: 'additive' }]
        }
    ]
});
const emitter = world.createEntity();
world.add(emitter, LocalTransform, {});
world.add(emitter, ParticleEmitter, {
    system: new ParticleSystem({ definition })
});
```

The World System owns optional created resources, applies one frame-wide budget, and synchronizes an
explicit render extension into `RenderWorld`. Particles remain packed simulation records rather than
per-particle Entities. Portable CPU, stateful WebGPU, stateless WebGPU, mesh/sprite/ribbon,
authoring, serialization, preview, cache, and baking APIs share the same definition contract.
