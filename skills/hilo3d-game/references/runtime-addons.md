# Optional runtime addons

Read this when a game needs sound, KTX2 texture residency or Live2D models. These addons first enter
the prepared alpha.9 release; verify publication before using them in a registry consumer.

## Installation and ownership

Resolve and pin the concrete core version, then install only the needed addon at that exact version
with `--save-exact`. All five addons use an exact `hilo3d` peer; never combine independently
resolved `next` tags. Check the requested package/version in the registry before installation. Use
installed public declarations and matching release documentation; do not copy repository
implementations. The starter intentionally installs only the core, so add these packages when the
game requires them.

Prefer Stage systems for audio and assets when the Stage owns their lifetime. Standalone runtimes
require explicit updates and destruction. Stop the ticker before destroying Stage and owned media;
retain resources across persisted `pagehide` and resume on persisted `pageshow`.

## Audio

Import `createAudioStageSystem` and `AUDIO_STAGE_SERVICE` from `@hilo/addon-audio`, register the
system in `Stage.create({ systems: [...] })`, and retrieve it with `stage.systems.get(...)`. Call
`audio.resume()` directly from a user gesture. Show an enable-sound control and surface startup
failures; initialization alone does not unlock browser audio.

Audio scheduling and fades use seconds on the audio clock. Node/ticker updates use milliseconds; do
not reuse a frame delta without checking units. Set `metersPerUnit` for the game's world scale. Use
`HiloAudioTransform` for spatial emitters, decoded clips for short effects, and
`audio.createStream(url)` for long music/dialogue; streaming is a separate 2D path. Release leases
returned by `audio.clips.load(...)`. Bound voices and concurrency instead of creating unlimited
overlapping sounds. Stage destroys its audio system; explicitly destroy a standalone `AudioEngine`.
See the release-matching audio contract and checked audio recipe through `llms.txt`.

## KTX2 texture residency

Import `createAssetStageSystem` and `ASSET_STAGE_SERVICE` from `@hilo/addon-assets`. Acquire
textures from the service using stable identity, content version and accurate encoded
dimensions/byte/mip metadata. A lease exposes a stable texture identity through promotion, eviction
and recovery. Start ticking before awaiting `lease.ready`; awaiting before starting the Stage can
prevent progress. Set visible/priority/mip demand explicitly and release every lease when its
consumer is removed.

The current A0 slice supports full-chain, non-array 2D KTX2 ETC1S/UASTC LDR with top-left `rd`
orientation. It does not provide general geometry paging or sparse HTTP streaming. Ship the emitted
module worker and pinned WASM locally. Vite handles static asset URLs; another bundler must support
module workers and asset URLs. CSP must allow those local workers and WASM. Do not add a CDN runtime
or bundle an upstream JavaScript decoder wrapper. Consult the matching asset streaming contract for
budgets and format restrictions.

## Live2D

Import `Live2DModel` from `@hilo/addon-live2d`, load a `.model3.json` URL with
`Live2DModel.load(...)`, and add the model to a ticking Stage. The addon ships and lazily
initializes its package-local runtime; applications need no SDK setup, runtime URL or CDN. Model
loads support abort, timeout and explicit `assetVersion`. Each model owns its session and assets;
Stage advances and destroys it through Node lifecycle. Do not also advance the same model manually.

Use SDK-independent motion, expression and parameter methods from installed declarations.
Traditional Cubism 3.x/4.x/5.0 runtime exports are the target; select the SDK/Cubism 5.0 export
target for new models. Advanced 5.3 composition is rejected. Character assets require their own
license; the included Core/Framework notices remain separate from the adapter's MIT license. Default
Forward discovers mask passes automatically. Avoid installing legacy integration features for
ordinary model loading. Consult the matching Live2D contract for supported blending and masks.

## Browser verification

Check the installed packages in the game's real build: unlock/play/stop sound, load and release a
compressed texture, or animate and destroy a model, according to the features used. Exercise resize,
restart and navigation lifecycle. Verify local runtime assets load without a CDN, observe errors
after teardown, and use each relevant rendering backend.
