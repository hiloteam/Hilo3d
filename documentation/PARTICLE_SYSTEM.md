# Hilo3D particle system

Status: current optional-addon contract

`@hilo3d/addon-particle` provides immutable particle assets, deterministic CPU simulation, WebGPU
compute/storage paths, stateless execution, authoring, serialization, preview, baking, and budget
control. The root engine has no particle dependency.

## ECS ownership

`createParticleWorldSystem()` publishes `PARTICLE_RUNTIME`. A particle resource becomes part of a
World by adding `ParticleEmitter` to an Entity that also owns `LocalTransform`. The System writes an
explicit `RenderExtensionComponent`; render extraction is the only path into `RenderWorld`.

```ts
const world = await World.create({
    systems: [
        createParticleWorldSystem({ backend: 'webgpu' }),
        createTransformSystem(),
        createRenderExtractionSystem()
    ]
});

const emitter = world.createEntity();
world.add(emitter, LocalTransform, { position: [0, 1, 0] });
world.add(emitter, ParticleEmitter, {
    system: new ParticleSystem({ definition })
});
```

`ParticleRuntime.create()` is a convenience that creates and owns a resource plus its Entity.
Externally created resources may be registered with `runtime.own()`. World teardown destroys owned
resources before renderer teardown.

Particles are not per-particle Entities. A `ParticleSystem` is a simulation/render resource with
packed buffers and one or more renderer meshes. This keeps high-count particle iteration out of the
general component/query layer.

## Execution paths

- Portable CPU: deterministic fixed-step packed arrays and reusable render writers.
- Stateful WebGPU: compute update, storage buffers, events, compaction, and storage-aware raster.
- Stateless WebGPU: analytic lifetime evaluation when authored modules satisfy eligibility rules.
- Mesh, sprite, and ribbon renderers share the same definition and budget contracts.

Unsupported storage/compute requirements fail closed on WebGL 2. Renderer contributions are explicit
objects, not symbol discovery or scene traversal.

## Authoring and lifecycle

`ParticleSystemDefinition` is immutable and versioned. Authoring graphs compile into the same
runtime definition and return structured diagnostics. Serialized definitions reference resources
explicitly. Preview, baking, simulation-cache, event-channel, pooling, and budget APIs retain
deterministic seeds and bounded capacities.

Each application frame advances a World-owned emitter once, applies the optional frame-wide budget,
and updates the extracted render extension. Resource destruction is idempotent. Renderer resources
are retired through normal submission-aware renderer ownership.

## Performance contract

- packed numeric state and free lists;
- fixed capacity with explicit overflow policy;
- allocation-stable simulation and writer buffers after warmup;
- no per-particle Entity, closure, or object wrapper;
- one World-level budget pass;
- WebGPU storage/indirect work stays under the shared Render Graph/RHI lifecycle.

The maintained ECS example is `examples/particles.html`; unit coverage remains under
`test/spec/particle/`.
