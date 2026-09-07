# Character animation and behavior composition

The animation runtime uses one backend-neutral path:

`AnimationTrack → AnimationClip / AnimationBlendTree1D → AnimationLayer → Animation → Node`

Tracks sample numeric values into reusable storage. Layers combine poses. Only the final mixer
writes node properties, before scene transforms and skeleton palettes are collected for rendering.
Animation does not introduce a second renderer, skinning implementation or backend-specific path.

## Assets, instances and evaluation

- `AnimationTrack` owns copied, private typed arrays. Construction validates shape, finite values,
  strictly increasing nonnegative times and quaternion keys. LINEAR uses shortest-arc quaternion
  slerp; CUBICSPLINE implements glTF Hermite tangents scaled by segment duration and normalizes the
  resulting quaternion. Sampling clamps to the first/last key outside the authored range.
- `AnimationClip` is immutable and shareable. Its start/end window is measured in source seconds.
  The default start is zero, preserving the hold before a delayed first key. Empty/static clips are
  valid. Duplicate writes within a clip are rejected, including aliases discovered at binding time.
- `Animation` owns resolved node/property bindings, captured reference values, parameters and
  scratch storage. `addLayer()` prepares these outside the frame loop; author all layers before
  evaluation so reference values describe the intended rest pose. Missing targets fail explicitly.
  IDs take precedence over names. Use unique names or glTF node IDs for predictable bindings.
- Each update restores the reference pose in memory, evaluates layers in insertion order, and writes
  each bound property once. Untouched properties remain outside animation ownership. There are no
  per-frame scene searches, keyframe slices, maps, or pose/track array allocations. A track uses
  binary search, O(log keys); sampling/mixing costs O(active channel components), plus O(layer count
  × bound properties + configured states) for initialization and composition.
- Rotation contributions are hemisphere-aligned to the reference quaternion and normalized after
  weighted accumulation. Final override/additive layer interpolation uses shortest-arc slerp.
  Weighted multi-motion quaternion mixing is normalized linear blending, not a geodesic mean.
- Morph weights are blended in original target order, then stably ranked by absolute influence into
  reusable buffers once per property write. Negative influences remain valid.
- `clone(root)` shares assets but copies playback weights, transitions, clocks and reference values
  into independent storage. Application binding resolvers must resolve against their supplied node;
  Morph-mesh clones own separate mutable geometry/weights; static meshes continue sharing geometry.
  callbacks and authoring configuration are shared functions and should not capture another
  character.

All public animation time values use **seconds**, except `tick(milliseconds)`, which implements the
engine Ticker convention. `update(seconds)` evaluates explicitly even while automatic ticking is
paused. Choose manual update or automatic `Animation.tick`, never both in the same frame. `play()`
on the mixer enrolls it in automatic ticking; `AnimationLayer.play()` only changes layer state. Call
`resume()` to enroll custom layers. `pause()` removes automatic ticking while retaining pose;
`stop(true)` restores references; `destroy()` removes ticking and releases bound scene references.

## Transitions, locomotion and layers

```ts
const animation = new Animation({ rootNode: pet, clips });
const locomotion = new AnimationBlendTree1D('Locomotion', 'speed', [
    { threshold: 0, clip: idle },
    { threshold: 1, clip: walk },
    { threshold: 2.4, clip: run }
]);
const body = animation.addLayer({
    name: 'body',
    motions: [locomotion, happy, sleep, attack],
    onEvent(event) {
        if (event.type === 'marker' && event.name === 'spark') spawnSpark();
    }
});
body.play('Locomotion');

// In the application's update, before rendering:
animation.setParameter('speed', actualSpeed, 0.12, dt); // optional half-life damping
animation.update(dt);

// A discrete action, retaining the current blended source pose:
body.play('Happy', { fade: 0.25, loop: false });
// A behavior sequence can advance when body.finished becomes true.
```

A transition fades all existing contributing states from their current weights to the new target.
Interruption does not reset the source pose. Reversing toward a still-live state preserves that
state's clock. Repeated requests for the current live destination are idempotent; requesting a
finished one-shot restarts it. Zero duration changes weights immediately. Envelopes are linear in
elapsed time and independent of frame subdivision. `synchronize: true` initializes a new destination
from the previous destination's unwrapped normalized phase.

A 1D tree clamps outside its thresholds and samples only the adjacent pair. Both clips sample the
same normalized phase; phase advances using their weighted duration. Walk/run assets must have
matching foot-contact phases: this is normalized-cycle synchronization, not marker-based retiming or
foot IK. Parameter damping is optional and independent of the transition envelope.

Layers provide `weight`, `playbackRate`, exact node-name/ID masks, and `override` or `additive`
mode. Missing mask entries have zero influence. Missing channels contribute the lower pose for
override and the captured reference for additive; fading an upper layer to zero therefore reveals
the lower pose continuously. Additive translation/scale use component differences from the captured
reference; rotation uses `inverse(reference) × sample`, composed onto the lower rotation. Additive
scale is a linear offset, not a multiplicative ratio. Authored clips must use this reference-pose
convention. Use an attention layer masked to head/neck, or apply procedural head/tail adjustments
after `animation.update()` and before rendering. Never multiply a procedural delta repeatedly onto
the previous frame for a property outside animation ownership; retain an explicit rest value
instead.

## Pokémon-style behavior composition

A reusable character profile maps semantic roles to assets; the engine does not need species logic:

```ts
interface CreatureProfile {
    walkSpeed: number;
    runSpeed: number;
    playbackRate: number;
    roles: Record<'Idle' | 'Walk' | 'Run' | 'Happy' | 'Sleep' | 'Attack', AnimationClip>;
    traits: readonly ('shy' | 'curious' | 'playful' | 'lazy')[];
}
```

Keep an actor navigation node above the animated rig. MoveTo/MoveAway/Follow change the actor's
position and yaw; the mixer controls the rig beneath it. Feed actual movement speed into locomotion.
This prevents animation translation channels from overwriting navigation. Different characters can
share the same profile logic and clip assets, but each requires its own animation instance and pose.

An Action Composer belongs to the game layer. Its sequence runner stores a current step and elapsed
time, and advances each step on its own completion condition:

| Step                       | Completion / animation integration                                         |
| -------------------------- | -------------------------------------------------------------------------- |
| MoveTo / MoveAway / Follow | Navigation arrival or cancellation; drive Locomotion from actual speed     |
| LookAt                     | Actor yaw or masked attention target reaches desired direction             |
| PlayAnimation              | `layer.play(role, { fade: 0.25, loop: false })`; wait for `layer.finished` |
| Wait                       | Game clock; use looping Idle or Sleep as appropriate                       |
| SpawnFX / PlaySFX          | Immediate command or named clip marker                                     |
| SetEmotion / TriggerNearby | Gameplay state/event; may select Happy or Attack                           |

For example, inspect-flower is MoveTo → LookAt → Idle + Wait → Happy. An electric flower interaction
uses Attack with a `spark` marker; its callback activates an environmental effect. The same Attack
clip can emit water, fire or petals according to profile tags. The animation core does not depend on
those effects. A sequence runner should own cancellation and its destination motion so that a stale
completion from a replaced action cannot advance a new behavior.

`AnimationMarker` supplies named timestamps; events are dispatched **after all pose writeback**.
Only the transition destination emits events; a blend tree selects its dominant clip (ties use the
lower threshold), preventing double footsteps during blends. Events include a `count` coalescing
multiple crossings under a large delta. An interval is `(previous, current]`: markers at the clip
start fire on loop wrap, not on initial entry. Events are ordered by authored marker time, not by
reconstructed chronology across multiple skipped cycles. Seeking does not emit crossed markers.
Zero-duration clips do not emit markers and non-looping zero-duration clips complete on evaluation.
One-shots hold their final pose and emit `finished` once. Event records allocate only when an event
listener exists and an event occurs. Completion callbacks may select the next motion; its pose is
evaluated on the next update.

## Migration and boundaries

This is a breaking replacement. Removed: `AnimationStates`, arbitrary global state handlers,
`animStatesList`, mutable clip dictionaries, numeric `play(start, end)`, global `_anims`, old
loop/end callbacks and `isMultiAnim`. Replace them with typed tracks, clip windows, explicit custom
numeric binding resolvers, layer playback and semantic events. glTF animations now always remain
separate clips; channels outside the selected scene are omitted and duplicate glTF clip names
receive stable numeric suffixes. `HILO_animation_clips`/`ALI_animation_clips` windows use the first
source clip's tracks. Custom UV animation in `examples/custom_anim_state.ts` demonstrates the
numeric binding contract. `examples/animation.html` uses a procedural block creature as its default
character. Its six motions—Idle, Walk, Run, Happy, Sleep and Attack—demonstrate interrupted
transitions, unequal-duration gait blending, additive head attention, personality playback rate and
an Attack-triggered flower effect. Sleep compresses the block body's vertical scale to 0.6 as a
stylized resting pose.

Implemented here: CPU skeletal/TRS and morph sampling, scalar/numeric custom channels, crossfades,
1D synchronized locomotion, layers/masks, reference-based additive poses, markers, one-shots,
cloning and explicit lifecycle. This is sufficient as the animation substrate for the behavior
composition above; it is not a shipped 50–100-species AI or a humanoid retargeting solution.

Not implemented: 2D/nested blend graphs, authored state-machine/behavior-tree assets, root-motion
extraction, reverse/ping-pong playback, finite loop counts, arbitrary additive reference clips,
marker synchronization, IK/retargeting, inertialization, animation compression, crowd update LOD,
and a concrete navigation/Action Composer/VFX framework. Add these against the same pose ownership
contract when required; do not introduce parallel direct-to-node players.

The buffer-reuse test is a structural check, not a timing or GC benchmark. No claim is made that
50–100 rendered characters meet a particular frame budget; skeleton/mesh complexity, shadow passes
and skinning uploads need representative end-to-end measurement.

## References

- [Unity Blend Trees](https://docs.unity3d.com/Manual/class-BlendTree.html): separates discrete
  transitions from continuously parameterized blends and explains normalized foot-contact timing.
- [Unity Animation Layers](https://docs.unity3d.com/Manual/AnimationLayers.html): masks and additive
  / override composition.
- [Unreal Sync Groups](https://dev.epicgames.com/documentation/unreal-engine/animation-sync-groups-in-unreal-engine):
  synchronization of clips with different lengths; our initial implementation uses normalized phase.

## Validation

Targeted browser Vitest coverage exercises immutable sampling, glTF interpolation modes, quaternion
normalization, phase synchronization, interruption, masks, additive composition, sparse channels,
morph weights, event timing, one-shot completion, clones, lifecycle and buffer reuse. Public API and
package consumption checks accompany the new exports. The existing example page participates in both
backend smoke lanes; this change does not modify raster shaders or the RHI.
