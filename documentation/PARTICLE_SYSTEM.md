# Particle system

Hilo3D exposes one versioned particle asset model for portable CPU simulation, stateful WebGPU
simulation, and lightweight stateless reconstruction. P0-P4 are implemented: immutable definitions
compile to a liveness-based SoA plan, CPU emitters render through one instanced `Mesh`, WebGPU
stateful emitters record persistent simulation and storage raster through the Render Graph, and
stateless emitters rebuild renderer attributes from absolute time without cross-frame particle
state. P4 adds analytic/depth interaction, soft particles, bounded events, typed channels, and
GPU-resident sub-emitter routing.

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

| `execution` | Implemented behavior                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auto`      | Selects stateless when every fixed module is reconstructible; otherwise a WebGPU environment may select GPU stateful above `preferGPUAboveCapacity`, with CPU stateful as the portable fallback. |
| `cpu`       | Dense CPU SoA simulation and a shared portable GLSL ES 3.00 instanced sprite path on WebGL 2 and WebGPU.                                                                                         |
| `gpu`       | Stateful WebGPU compute/storage/indirect path. Explicit WebGL 2 compilation fails before a frame begins.                                                                                         |
| `stateless` | Requires every module to be stateless-compatible and reports the exact blocking module/reason before a frame; the portable generator works on WebGL 2 and WebGPU.                                |

Pass `{ compilationEnvironment: { backend: 'webgpu' } }` to `ParticleSystem` when an emitter
explicitly requests `gpu`. GPU definitions cannot use dynamic bounds. Vector fields require manual
bounds because the compiler cannot infer a conservative extent from arbitrary texture contents.

`aliveCount` intentionally reports only CPU-resident particles. GPU emitters do not read alive
counts, sort keys, state, or indirect arguments back to JavaScript in the production loop.

## Implemented P0-P4 modules

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
- Interaction: CPU/WebGPU analytic plane, sphere, axis-aligned box, and capsule collision; CPU
  trigger enter/inside/exit state; and WebGPU scene-depth collision.

The sprite renderer supports view, world-up, velocity, and stretched alignment; alpha,
premultiplied-alpha, and additive composition; depth test/write; pivot and texture sheets; render
order; and `none`, distance, youngest, or oldest CPU sorting. GPU distance sorting uses Bitonic for
power-of-two capacities up to 4096 and a distance-bucket profile for larger or non-power-of-two
capacities. Soft sprites sample the Forward scene depth through the constrained storage-raster
shader, perform their depth comparison in the fragment stage, and omit a depth attachment from that
pass. `softParticle.distance` and optional `contrast` control the fade; `depthWrite: true` is
rejected before graph compilation.

## Interaction and bounded events

CPU simulation writes birth, death, collision, and trigger records to compact typed-array rings. No
per-particle JavaScript callback runs in the simulation loop. `await system.readEvents(limit)`
materializes a bounded aggregate after simulation, including per-name counts, remaining records, and
dropped-event diagnostics. Emitter `eventCapacity`/`eventOverflow` and system
`eventReadbackCapacity` make both queue limits explicit.

`sub-emitter` modules route matching CPU events to an existing emitter as batched spawn commands.
For GPU-to-GPU routes, simulation/initialize kernels capture compact records in renderer-owned
buffers and a later Render Graph compute pass writes the target emitter's active state directly. The
spawned target particles participate from the following simulation frame; event counts and particle
state never cross a CPU readback boundary. GPU-to-CPU routes fail compilation.

`ParticleEventChannel<Payload>` is the application-facing typed service path. Its fixed schema
accepts float/uint/boolean/vector/color fields, validates payloads, applies `drop-new` or
`drop-oldest`, exposes capacity diagnostics, and can drain position/velocity bursts into a resident
`ParticleSystem` without constructing short-lived systems.

## Stateless reconstruction and scalability

Every compiled emitter retains per-module stateless metadata with one of three outcomes: `exact`,
`approximated`, or `stateful-only`. Lifetime/color/size/rotation/SubUV LUTs, constant
velocity/force/gravity/wind/drag, and position-offset noise use absolute age directly. Bounded
fixed-sample reconstruction covers limit velocity, orbital/vortex/attraction/conform families.
Feedback noise, vector fields, conditional kill modules, inherited emitter velocity, and
rate-over-distance remain stateful-only and identify their reason in the compilation diagnostic.

The CPU stateless runtime retains only emitter time, seed, parameters, and bounded manual-spawn
metadata. It rebuilds the dense renderer input for the active lifetime interval and reports zero
`persistentStateByteLength`; it does not retain position/velocity arrays as simulation history. The
WebGPU stateless compiler produces a Naga-validated renderer-data/indirect generator with a
`regenerate` recovery policy and no state/alive/dead recovery buffers.

`ParticleBudgetManager` resolves a complete request set in stable priority/distance/identity order,
so visibility, distance, system, emitter, particle, spawn-rate, sorting, soft-particle, collision,
and ribbon quality decisions are deterministic and carry explicit degradation reasons.
`ParticleSystemPool` reuses stopped instances by immutable definition and seed for short-lived
effects without changing public identity while an instance is active.

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
a scene has no GPU particle emitters. GPU simulation, event capture/routing, compaction, sort,
renderer-data build, and indirect raster all declare their storage, sampled depth, indirect, and
attachment access through the Render Graph. Scene-depth collision reads depth from compute. Soft
sprites use sampled depth without attaching it to the same pass, so the graph contains no
sampled-depth/attachment feedback edge.

## Current boundary

P5-P6 remain outside this implementation. In particular, there is no mesh/ribbon/trail renderer,
serialization upgrade pipeline, capture cache, or graph editor yet. GPU event observation is
intentionally limited to resident routing; application-visible GPU diagnostics remain aggregate and
asynchronous rather than a production-loop particle readback. The public fixed module union rejects
arbitrary callbacks and arbitrary shader source by design.

The existing [`compute_particles.ts`](../examples/compute_particles.ts) showcase intentionally keeps
its specialized implementation for now. It will be migrated only after the remaining particle
feature phases are complete, so P0-P4 do not reduce or reshape that fixture prematurely.
