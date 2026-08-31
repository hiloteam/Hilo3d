# Build particle effects

Install and import `@hilo3d/addon-particle` only for effects that need many sprites, meshes,
ribbons, trails, or deterministic authored behavior. The core `hilo3d` package deliberately does not
export particle classes. Keep damage, collision authority, scoring, and save state in the game
simulation; particle events can request gameplay actions, but particle state is presentation.

```sh
npm install @hilo3d/addon-particle
```

```ts
import * as Hilo3d from 'hilo3d';
import {
    PARTICLE_STAGE_SERVICE,
    ParticleSystemDefinition,
    createParticleStagePlugin
} from '@hilo3d/addon-particle';

const particlePlugin = createParticleStagePlugin();
const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    camera,
    plugins: [particlePlugin]
});
const particles = stage.pluginHost.get(PARTICLE_STAGE_SERVICE);

const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'spark-burst',
            capacity: 512,
            execution: 'auto',
            emission: { rateOverTime: 0, bursts: [{ time: 0, count: 80 }] },
            shape: { type: 'sphere', radius: 0.12, distribution: 'volume' },
            initialize: {
                lifetime: { min: 0.35, max: 0.8 },
                speed: { min: 1.5, max: 4 },
                size: { min: 0.025, max: 0.07 },
                color: [1, 0.45, 0.08, 1]
            },
            modules: [
                { type: 'gravity', force: [0, -4, 0] },
                { type: 'drag', coefficient: 0.2 }
            ],
            renderers: [{ type: 'sprite', blend: 'additive', depthWrite: false }]
        }
    ]
});

const sparks = particles.createSystem({
    definition,
    seed: 42,
    autoPlay: false
});

sparks.setPosition(hit.x, hit.y, hit.z).restart().play();
```

Choose `execution: 'auto'` when the definition has a valid portable path. Use explicit CPU for
deterministic compatibility or explicit stateful WebGPU only when the effect requires its supported
GPU modules and the game has a clear unsupported-device result. Unsupported module/backend pairs
fail compilation; do not catch that failure and silently remove required behavior.

The Stage plugin owns registered systems, applies its optional frame-wide quality budget before node
updates, and destroys particle render resources before the renderer. Use standalone `ParticleSystem`
construction only when another owner will call `destroy(stage.renderer)` before the renderer is
released. Never share a managed system between Stages.

Reuse immutable definitions across systems, pool short-lived systems, and update declared
`ParticleParameter` values instead of rebuilding definitions every frame. Use bounded capacities and
quality budgets. Advanced mesh, ribbon, collision, event, checkpoint, baking, JSON, and external
authoring APIs should be adopted only when the effect needs them; inspect the installed declarations
for their exact versioned contracts.

Release or pool application-owned systems when their gameplay owner leaves the scene; whole-Stage
shutdown is handled by the plugin. Exercise CPU and the selected WebGPU path separately before
making parity, event, recovery, or performance claims. Do not add the addon dependency to games that
have no authored particles.
