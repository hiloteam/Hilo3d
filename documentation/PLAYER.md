# Studio projects and standalone Player

Hilo Studio can package a project as a static website with its own Player. The current source adds
this workflow together with authored physics, particles and audio components. It uses the same scene
adapter, script sandbox, fixed-step clock and addon owners as Studio Play. This is repository source
functionality; its presence here does not claim an npm release or completion of the full production
acceptance matrix. See [validation status](#validation-status).

## Create and export an experience

1. Open a project in [Hilo Studio](./EDITOR.md). Import its GLB models, textures and any PCM WAV
   sounds. Add authored cameras, timeline clips and scripts as needed.
2. Select an object and use its **Components** inspector to add **Physics**, **Particles** or
   **Audio**. Component edits participate in project validation, undo, prefabs and exports.
3. Use **Play**, **Pause**, **Step** and **Stop** to check the actual simulation. Authoring data
   remains unchanged; Stop restores the authored transforms and imported model poses.
4. Open **Publish website**. Choose the title, first scene, a camera and optional timeline clip for
   each scene, and whether to show playback controls. The initial choices use each scene's first
   visible authored camera and first timeline clip. Choosing **Automatic framing** uses the shared
   framing camera; it does not add editor gizmos or mouse camera gestures to the Player.
5. Choose **Download website ZIP**, extract it and upload the entire extracted directory to a static
   HTTP(S) host. Open its `index.html` URL. Visitors explicitly click **Start experience** to run
   scripts and simulation and enable sound.

The publisher takes a detached project snapshot when its dialog opens. Changes made afterward are
included by reopening the dialog and exporting again. Export downloads a website; it does not log
into a hosting provider, upload files or make the project publicly accessible by itself.

The Player exposes Pause/Resume, Restart, scene selection and full screen when controls are enabled.
Restart restores and starts a fresh run of the current scene. Changing scenes returns to the Start
screen. Loading or opening a project never executes authored scripts automatically. The authored
camera remains the actual engine camera node, so timeline and script changes continue to move its
view during playback.

## Deployment layout and versions

The website contains `index.html`, compiled JavaScript/CSS and local WASM resources, `player.json`,
`project.zip`, a README, the Hilo3D license and dependency notices. `project.zip` is the editable
Studio workspace with scene documents, scripts and binary assets; source names, checksums and
user-supplied asset license/attribution metadata are retained. Website export does not conceal
script source or assets. Keep a source project backup and distribute assets under their applicable
licenses.

`player.json` uses `format: "hilo3d-player"`, version 1. It selects the title, first scene,
per-scene camera and timeline clip, and controls visibility. Scene and clip IDs are checked against
the bundled project. The Player requires an exact match between the manifest's `engineVersion` and
its compiled engine version. Studio additionally verifies the production template inventory, sizes
and SHA-256 hashes before packaging it. Re-export from the matching Studio build when updating the
runtime.

URLs are relative to the deployed directory, supporting both domain-root and subdirectory hosting.
No editor server, CDN, package registry or development tool is needed by visitors. Serve the whole
directory with normal HTML, JavaScript, CSS, JSON and WASM MIME types; do not replace asset requests
with an HTML fallback. Direct `file://` opening is unsupported because the Player loads local
project resources through HTTP requests. Hosting does not install a service worker or promise
offline availability after the browser cache is cleared.

Use HTTPS for deployment. WebGPU requires a secure context; loopback development hosts are usable
for local testing. `?backend=webgl2` and `?backend=webgpu` request an explicit backend; omitting the
parameter uses the engine's `auto` policy. Explicit WebGPU failure is surfaced rather than silently
selecting WebGL2. Both backends use the shared renderer, Render Graph and portable RHI, including
particle rendering. Browser audio playback remains subject to a user gesture and device policy.

## Authored components

Scene version 3 adds optional `components.physics`, `components.particles` and `components.audio`
records to existing node types. A node can combine components. Their source contracts are
[`components.ts`](../editor/components.ts) and the [scene schema](../editor/scene.schema.json).
Scenes without a component allocate none of that component's optional runtime. Scene versions 1 and
2 migrate to version 3 without adding components or changing authored transforms; older version
numbers cannot be used to smuggle in new component fields. The project container remains version 1.

| Component | Authored behavior                                                                                                                            | Current boundary                                                                                                                                                                                               |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physics   | Rapier 3D static, dynamic or position-driven kinematic bodies; box, sphere or capsule collider; mass, friction, restitution and sensor flag. | One collider per authored node; gravity is `(0, -9.81, 0)` meters/second². No mesh-collider baking, joints, character-controller inspector or collision callback scripting in this format.                     |
| Particles | Seed, capacity, emission rate, lifetime, speed, size, color, gravity, point/box/sphere shape, loop and duration.                             | Portable CPU simulation, additive sprite rendering and local simulation space. No GPU-only emitter selector, arbitrary module graph, textured-particle asset or world-space trail authoring in this inspector. |
| Audio     | Imported WAV asset, autoplay after Start, loop, volume, spatial/nonspatial source and attenuation distances.                                 | PCM clips with one active voice per component, at most 32 authored sources. No streaming URL, audio mixer graph or compressed audio import in this format.                                                     |

The underlying addons expose broader features. Studio's persisted component contract deliberately
states which of those features a project can author and export; see
[physics](./PHYSICS_ARCHITECTURE.md), [particles](./PARTICLE_SYSTEM.md) and [audio](./AUDIO.md) for
the engine contracts.

### Physics ownership and transforms

Collider dimensions use local meters. Box `size` is the full width, height and depth; sphere
`radius` and capsule `radius`/`halfHeight` follow their named dimensions. Node scale is baked into
the collider when Play starts. Sphere and capsule nodes require uniform scale; physics ancestors
require unit scale. Parent translation and rotation are supported through the public node-transform
bridge.

Dynamic bodies own their transforms. Their scripts can apply impulses, emit particles or play sound,
but cannot use transform setters, translation, rotation or scale commands. Timeline motion on a
dynamic body or any of its ancestors is rejected. Ancestor scripts are also rejected for dynamic
bodies because they could move the parent independently. Use a kinematic body for scripted or
keyframed motion. Scale tracks on physics nodes or ancestors are rejected, and runtime scale changes
fail explicitly; stop playback and edit collider dimensions before restarting.

Physics output is copied back into the isolated script scene after each simulation step, so the next
script update reads the current body pose. These values do not overwrite the authored project.
Sensor colliders participate in the physics world but this script contract does not expose collision
or sensor event callbacks.

### Particle space and budgets

The initial emitter contract runs at 60 fixed steps per second on both backends. Each emitter has a
fixed seed and a capacity of 1–4,096 particles; aggregate scene capacity is limited to 32,768. Rate
is bounded to 1,000 particles/second, with zero permitted for script-triggered emission. A script
burst also respects the emitter's capacity. Stopping and restarting constructs fresh seeded
simulation state, making the same steps and commands repeatable within this runtime.

Simulation is local to the authored node. Existing particles follow the emitter's parent and node
transforms; gravity is expressed in that local space. A moving emitter therefore does not leave a
world-space trail. Box extent is the local half-size; sphere extent must have equal components and
uses that value as its radius. Offscreen rendering culling does not stop simulation. Particle
systems are manually advanced by the shared playback clock, so ordinary Stage render ticks cannot
advance them a second time or unpause them.

### Audio assets and playback

Import accepts RIFF WAV with mono/stereo integer PCM, 8/16/24/32-bit samples and an 8–192 kHz sample
rate. A file must contain a consistent PCM format followed by complete sample frames, fit the 16 MiB
per-asset source limit and last at most 300 seconds. Unsupported codecs, floating-point WAV,
malformed chunks and inconsistent lengths are rejected before project installation. Project-wide
asset limits still apply; a valid file is not an unlimited decoded-memory allowance.

The runtime reserves at most 64 MiB for decoded clips and 32 real/total voices. Encoded input is
bounded separately, and failure to decode or fit a budget is visible. Identical asset IDs share a
prepared clip; each component owns its current voice. Calling `playAudio()` replaces that node's
previous voice, while `stopAudio()` stops it. Spatial sources follow their node and the current
runtime camera supplies the listener transform.

An audio session is created and unlocked directly from the Play/Start gesture before asynchronous
resource preparation. Clips and autoplay sources are prepared paused and resume only when the
controller permits playback. A pause retains voice position; Stop releases voices, clip leases,
object URLs and the audio context. Scenes without audio create no audio context. This is functional
browser playback, not a claim about device latency or Safari/Firefox compatibility for this new
Player workflow.

## Scripts, animation and the simulation clock

The shared controller waits for referenced GLB and texture resources before starting scripts, then
prepares components before entering playback. Each simulation step is exactly `1 / 60` second. It
samples the selected timeline clip, runs the bounded script update, applies script transforms and
component commands, advances embedded GLB animation and components, then accepts dynamic-body
transforms. The render loop consumes those node states through the normal Stage path. Elapsed-time
catch-up is capped at 50 ms per frame, so a long stall does not produce an unbounded simulation
burst.

Each imported GLB instance plays its first embedded clip when Play starts; a separate GLB clip
selector is not part of this component format. Mixers stay off the global animation ticker and
advance only with the playback clock. Pause freezes simulation and model animation, Step advances
one fixed step while remaining paused, and Stop restores authored transforms and model reference
poses. The selected timeline's keyed channels are sampled before scripts, giving scripts the last
transform update before physics ownership is applied.

In addition to the existing transform/input/log helpers, a bound script can issue these commands:

| Method                      | Requirement                                    | Bound                                                             |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `ctx.applyImpulse(x, y, z)` | A dynamic physics component on the bound node. | Each finite component must have absolute value at most 1,000,000. |
| `ctx.emitParticles(count)`  | A particle component on the bound node.        | Integer count from 1 to 4,096.                                    |
| `ctx.playAudio()`           | An audio component on the bound node.          | Replaces that component's active voice.                           |
| `ctx.stopAudio()`           | An audio component on the bound node.          | Stops that component's active voice.                              |

At most 128 component commands may be returned by one lifecycle step across all script bindings. The
main-thread host validates returned transforms, target IDs, component existence, command fields and
numeric budgets before applying them. No native body, particle, audio or graphics handle crosses
into the script context. Keyboard input uses lowercase single characters such as `"d"`, plus
`"ArrowUp"`, `"ArrowDown"`, `"ArrowLeft"`, `"ArrowRight"` and `"Space"`; pointer coordinates are
normalized to `[-1, 1]`. Scripts remain isolated in the same opaque-origin iframe/Worker boundary
and watchdogs described in [Scripts and Play](./EDITOR.md#scripts-and-play).

## Lifetime and failures

Scene selection stops the existing script session and components before replacing scene resources.
Normal exit stops render scheduling, cancels pending preparation and waits for bounded script
termination and addon cleanup before destroying the viewport. Late asynchronous component creation
is either canceled or disposed; it cannot reactivate an older scene. Active script stop hooks run
before component destruction, and failed startup leaves playback stopped with an error message.

Hidden-page and persisted page transitions pause playback and audio; persisted navigation retains
resources for return. An in-flight startup can finish paused and cannot start sounds while the
controller is suspended. The standalone Player resumes playback on return when it had suspended an
active session. Studio retains its separate authoring interaction rules. These event contracts do
not establish actual BFCache eligibility on every browser. Device/context recovery continues to
belong to the shared renderer and preserves the explicit backend selection.

## Build and validation

```sh
npm run player:build
npm run editor:build
npx vitest run test/spec/editor/ComponentAuthoring.test.ts test/spec/editor/PlayController.test.ts test/spec/editor/ScriptRuntime.test.ts test/spec/editor/PlayerExport.test.ts
npm run test:editor:render
npm run test:player
npm run test:editor
npm run docs:check
```

`player:build` generates the production template under ignored `dist-player/`; it is not a project
website until export adds a project and manifest. `editor:build` first builds that template and
includes it under `editor/player-template/`. Development serves a production template built on the
first export request, retaining the production script-isolation and relative-resource behavior. Do
not hand-edit or commit these generated directories. Broader repository checks and deployment
commands remain in [Engineering](./ENGINEERING.md).

### Validation status

Local acceptance recorded on 2026-10-13 for the `codex/studio-player` worktree based on `0750991e`.
This evidence covers the changed source, not a published npm version or remote CI run.

| Check                                                          | Executed result                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor document, authoring, script/controller and export tests | 22 files, 185 tests passed.                                                                                                                                                                                                                                                                                    |
| Editor GPU/resource suite                                      | 25 tests passed, including dual-backend Player cameras, GLB animation, Rapier, particle pixels, PCM/audio lifecycle and cancellation.                                                                                                                                                                          |
| Collaboration service/client suite                             | 17 tests passed, including bounded-response cancellation and typed HTTP failures.                                                                                                                                                                                                                              |
| Existing editor UI                                             | Seven cases passed across the authoring run and the post-fix collaboration rerun, on their declared backends.                                                                                                                                                                                                  |
| Component and startup lifecycle UI                             | Four cases passed: both-backend audio-owner replacement and actual WebGPU initialization interrupted by ordinary/persisted page transitions.                                                                                                                                                                   |
| Production Player export                                       | Both backend cases passed. Each downloads and extracts a real ZIP, runs it on an independent static origin at root and subdirectory URLs, and checks pixels, physics, particles, sound, animation, input, pause/step/restart, scene switching, reload and teardown. All network failure checks remain enabled. |
| Built Pages editor                                             | Both backend cases passed at root and project-subpath URLs.                                                                                                                                                                                                                                                    |
| Engineering and package checks                                 | Type checking, typed ESLint, formatting, modernity, API reports, ESM type consumers, packed-package runtime checks, documentation and complete site builds passed.                                                                                                                                             |
| UI scheduling                                                  | All 124 WebGL2 tests are assigned to exactly one group.                                                                                                                                                                                                                                                        |

Browser evidence uses Chromium and the repository's software-GPU correctness lanes. The complete
engine `validate`/coverage/gallery matrix, Safari/Firefox/mobile and physical-GPU performance lanes
were not run for this change. No performance, hardware-latency or target-host deployment claim is
made. The new production export check is wired into local validation and the required macOS editor
CI job; that job consumes the package job's built site rather than rebuilding a different artifact.
