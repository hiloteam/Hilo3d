# @hilo/addon-audio

Optional, strict TypeScript/ESM game audio for Hilo3D. Prepared for **2.0.0-alpha.9**; npm
publication is pending. Use matching core/addon tarballs from this checkout until publication, then
install both packages at the exact same version.

- Shared Web Audio runtime for either renderer, with no dependency from the core into the addon.
- HRTF/equal-power 3D sound, distance curves, cones, explicit-velocity Doppler and budgeted
  occlusion.
- Bounded real and virtual voices, scheduled playback, loops, pause/seek, fades and concurrency
  rules.
- Hierarchical mixing, snapshots, convolution sends, sidechain ducking and optional output
  compression.
- Weighted sound cues, deduplicated decoded clip caching, and separate HTML media streaming.
- Explicit ownership, Stage service integration, diagnostics and real Chromium PCM/package tests.

Create `AudioEngine` and call `update()` each frame, or install `createAudioStageSystem()` and
obtain `AUDIO_STAGE_SERVICE`. Call `audio.resume()` directly from a user gesture. Load short effects
with `audio.clips.load(url)`; the returned lease must be released. Long music/dialogue can use
`audio.createStream(url)`. Destroy the engine (or its owning Stage) after stopping the frame loop.

See the maintained
[audio contract](https://github.com/hiloteam/Hilo3d/blob/dev/documentation/AUDIO.md) and
[checked recipe](https://github.com/hiloteam/Hilo3d/blob/dev/test/types/recipes/audio.ts).
Repository main may be newer than an installed package; its declarations define the exact API.

All times are seconds on the audio clock. Hilo3D world units become meters through `metersPerUnit`.
Spatial sources use local -Z forward and +Y up. Streaming is a separate 2D path. Browser codec,
autoplay and device support still apply; advanced authoring graphs, ambisonics and propagation
simulation are outside this implementation.
