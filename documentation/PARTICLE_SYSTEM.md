# Particle system

Hilo3D exposes one versioned particle asset model for portable CPU simulation and stateful WebGPU
simulation. P0-P2 are implemented: immutable definitions compile to a liveness-based SoA plan, CPU
emitters render through one instanced `Mesh`, and WebGPU emitters record persistent simulation,
compaction, sorting, indirect arguments, and storage-aware sprite raster through the Render Graph.

## Public workflow

```ts
import { ParticleCurve, ParticleGradient, ParticleSystem, ParticleSystemDefinition } from 'hilo3d';

const definition = ParticleSystemDefinition.create({
    emitters: [
        {
            name: 'fire',
            capacity: 8192,
            execution: 'auto',
            emission: {
                rateOverTime: 900,
                bursts: [{ time: 0, count: 128 }]
            },
            shape: {
                type: 'cone',
                radius: 0.3,
                angle: 18,
                length: 0.8,
                distribution: 'volume'
            },
            initialize: {
                lifetime: { min: 0.8, max: 1.6 },
                speed: { min: 0.7, max: 1.8 },
                size: { min: 0.04, max: 0.12 },
                color: [1, 0.4, 0.08, 1]
            },
            modules: [
                { type: 'gravity', force: [0, 0.35, 0] },
                { type: 'drag', coefficient: 0.12 },
                {
                    type: 'size-over-lifetime',
                    curve: new ParticleCurve([
                        { time: 0, value: 0.2 },
                        { time: 0.25, value: 1 },
                        { time: 1, value: 0 }
                    ])
                },
                {
                    type: 'color-over-lifetime',
                    gradient: new ParticleGradient([
                        { time: 0, color: [1, 0.8, 0.2, 1] },
                        { time: 1, color: [0.25, 0.02, 0.01, 0] }
                    ])
                }
            ],
            renderers: [{ type: 'sprite', blend: 'additive', depthWrite: false }]
        }
    ]
});

const particles = new ParticleSystem({ definition, seed: 42 }).addTo(stage);
particles
    .emit(32)
    .pause()
    .simulate(1 / 60)
    .play();
```

Definitions and their emitter/module/renderer records are immutable snapshots. Changing input
objects after `ParticleSystemDefinition.create()` cannot mutate an existing compiled runtime. Create
a new definition when topology changes. `ParticleCurve`, `ParticleGradient`, and typed
`ParticleParameter` tokens are immutable as well.

## Execution policy

| `execution` | Implemented behavior                                                                                                              |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `auto`      | Portable CPU stateful plan by default. A WebGPU compilation environment may opt into GPU execution with `preferGPUAboveCapacity`. |
| `cpu`       | Dense CPU SoA simulation and a shared portable GLSL ES 3.00 instanced sprite path on WebGL 2 and WebGPU.                          |
| `gpu`       | Stateful WebGPU compute/storage/indirect path. Explicit WebGL 2 compilation fails before a frame begins.                          |
| `stateless` | Reserved for P3 and currently fails clearly during compilation; it never silently runs as another plan.                           |

Pass `{ compilationEnvironment: { backend: 'webgpu' } }` to `ParticleSystem` when an emitter
explicitly requests `gpu`. GPU definitions cannot use dynamic bounds. Vector fields require manual
bounds because the compiler cannot infer a conservative extent from arbitrary texture contents.

`aliveCount` intentionally reports only CPU-resident particles. GPU emitters do not read alive
counts, sort keys, state, or indirect arguments back to JavaScript in the production loop.

## Implemented P0-P2 modules

- Lifecycle and spawn: duration, loop, delay, prewarm, fixed step, time scale, rate over time, rate
  over distance, burst, and manual emission.
- Shapes: point, line/edge, box, circle/disc, sphere/hemisphere, cone, and torus/donut with the
  applicable surface/volume, arc, and thickness controls.
- Initialization: position, direction, speed, lifetime, mass, color, size, and rotation using
  constants or deterministic ranges.
- Motion: velocity, force, gravity, wind, drag, limit velocity, inherited emitter velocity, lifetime
  by emitter speed, radial/orbital/vortex force, point/line attraction, rotation around a point,
  sphere conformance, vector field, and deterministic vector/curl noise.
- Visual values: color/alpha/size/rotation over lifetime, color/size/rotation by speed,
  texture-sheet lifetime/speed/FPS modes, camera offset/fade, screen-space size, and typed custom
  channels.
- Kill: age/capacity plus speed, distance, plane, box, and sphere conditions.

The sprite renderer supports view, world-up, velocity, and stretched alignment; alpha,
premultiplied-alpha, and additive composition; depth test/write; pivot and texture sheets; render
order; and `none`, distance, youngest, or oldest CPU sorting. GPU distance sorting uses Bitonic for
power-of-two capacities up to 4096 and a distance-bucket profile for larger or non-power-of-two
capacities.

## Runtime and renderer contract

`ParticleSystem` is a scene `Node`, not a collection of per-particle objects. Its public controls
are `play()`, `pause()`, `stop()`, `restart()`, `simulate()`, `emit()`, and `sendEvent()`.
Fixed-step CPU simulation is reproducible for the same definition, seed, emission commands, and time
steps.

CPU emitters update one dense interleaved instance stream per sprite renderer and issue one direct
instanced draw. GPU emitters retain double-buffered state, alive/dead indices, spawn commands,
renderer data, counters, and indirect arguments as renderer-owned resources. Simulation records at
most once per application frame; sorting and raster are camera-specific. Submission success commits
the staged clock and buffer generation, while a discarded frame rolls them back.

On WebGPU device restoration, GPU emitter resources are recreated from backend-neutral definitions
and the deterministic seed. The P2 recovery policy restarts the emitter from its initial clock;
public `ParticleSystem` and definition identities remain unchanged. CPU state remains resident and
is re-uploaded through normal resource recovery.

The default Forward pipeline owns the built-in GPU particle feature. It is inert on WebGL 2 and when
a scene has no GPU particle emitters. GPU simulation, compaction, sort, renderer-data build, and
indirect raster all declare their storage, indirect, and attachment access through the Render Graph.

## Current boundary

P3-P6 remain outside this implementation. In particular, there is no stateless runtime, global
particle budget manager, collision/event channel, soft-particle depth sampling, mesh/ribbon/trail
renderer, serialization upgrade pipeline, capture cache, or graph editor yet. The public fixed
module union rejects arbitrary callbacks and arbitrary shader source by design.

The existing [`compute_particles.ts`](../examples/compute_particles.ts) showcase intentionally keeps
its specialized implementation for now. It will be migrated only after the remaining particle
feature phases are complete, so P0-P2 do not reduce or reshape that fixture prematurely.
