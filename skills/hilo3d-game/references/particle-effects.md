# Build particle effects

Use the public particle system for effects that need many sprites, meshes, ribbons, trails, or
deterministic authored behavior. Keep damage, collision authority, scoring, and save state in the
game simulation; particle events can request gameplay actions, but particle state is presentation.

```ts
const definition = Hilo3d.ParticleSystemDefinition.create({
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

const sparks = new Hilo3d.ParticleSystem({
    definition,
    seed: 42,
    autoPlay: false
}).addTo(stage);

sparks.setPosition(hit.x, hit.y, hit.z).restart().play();
```

Choose `execution: 'auto'` when the definition has a valid portable path. Use explicit CPU for
deterministic compatibility or explicit stateful WebGPU only when the effect requires its supported
GPU modules and the game has a clear unsupported-device result. Unsupported module/backend pairs
fail compilation; do not catch that failure and silently remove required behavior.

Reuse immutable definitions across systems, pool short-lived systems, and update declared
`ParticleParameter` values instead of rebuilding definitions every frame. Use bounded capacities and
quality budgets. Advanced mesh, ribbon, collision, event, checkpoint, baking, JSON, and external
authoring APIs should be adopted only when the effect needs them; inspect the installed declarations
for their exact versioned contracts.

Destroy or pool application-owned systems when their owner leaves the scene. Exercise CPU and the
selected WebGPU path separately before making parity, event, recovery, or performance claims.
