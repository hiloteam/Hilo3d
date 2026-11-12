# SRP and Render Graph measurements

This separate versioned protocol measures the current shared renderer, Render Graph and RHI. It does
not change the immutable [RHI baseline](../rhi/README.md), restore a retired renderer, or
automatically enroll a performance budget.

The three fixed workloads use a 960 × 600 offscreen target and twelve colored boxes:

- `default`: the default Forward pipeline.
- `postprocess`: HDR Forward, Bloom and Color Uber, with dithering disabled.
- `custom`: the same effects plus sixteen public fullscreen continuation passes. These identity
  passes isolate custom-SRP recording and transient pressure; they are not sixteen different
  artistic effects.

Each capture uses three fresh Chromium processes, 64 warmup frames and 120 measured frames per
round. Every frame renders real geometry, submits and waits for completion. Synchronous CPU work,
the fence wait and asynchronous timestamp polling are separate. WebGPU native captures require
timestamp-query and reject missing results; summed pass time is not end-to-end GPU time. WebGL2 GPU
times remain null. Readback SHA-256 and nonuniform pixels are required after every round.

The optional renderer timeline reports record/compile/prepare/execute time, logical transient bytes,
peak simultaneous live bytes, physically reserved bytes and texture alias count. These descriptor
estimates include mip/layer/sample counts and conservative opaque-depth sizes. They exclude
imported/history/extracted resources, driver padding, idle-pool retention and other in-flight
frames; they are not hardware memory measurements. Profiling remains enabled equally in both
captures. CPU allocation uses one-byte CDP sampling, seven discarded settling profiles and three
separate one-frame profiles. Raw profiles are retained; only synchronous engine descendants of the
named frame boundary count. Async completion and pixel readback do not count.

## Commands

```sh
# Local diagnostic; dirty trees are recorded, never presented as enrolled evidence.
npm run benchmark:srp:collect -- --native --backend=webgpu --workload=custom --output=reports/srp/custom.json
npm run benchmark:srp:collect -- --native --backend=webgl2 --workload=custom --output=reports/srp/custom-webgl2.json

# Software correctness/allocation diagnostic, with no fabricated GPU timings.
npm run benchmark:srp:collect -- --backend=webgpu --workload=postprocess --output=reports/srp/software.json

# Audited candidate: use the exact Node/browser and environment variables from the RHI protocol.
# Commit the fixture/collector and complete workload first; isolate other GPU workloads.
npm run benchmark:srp:collect -- --candidate --backend=webgpu --workload=custom --output=reports/srp/candidate.json

# Compare the same workload/protocol on two different clean commits and the same audited rig.
npm run benchmark:srp:compare -- reports/srp/before.json reports/srp/after.json reports/srp/comparison.json
```

The collector checks source hashes before/after capture, records the complete commit, dirty state,
browser executable checksum and actual GPU/driver identity, and uses exclusive output creation.
Candidate mode also reuses the enrolled rig/power preflight before and after capture. Comparison
recomputes summaries and rejects incomplete rounds, differing workloads/protocols/rigs/pixels,
same-commit evidence and noisy CPU round medians. `--diagnostic` on the comparison command allows
local dirty/same-commit captures, while retaining workload/rig/pixel checks. It never upgrades
diagnostics to evidence. Independent review, accepted budgets and immutable retention remain
separate decisions; no command here freezes or replaces a baseline.

## STRATA pressure observations

STRATA's existing diagnostic API additionally exposes `meshletRayGeometry` (retained snapshot bytes,
cumulative completed-copy bytes/count/time) and `virtualShadowVisibleBytes` (the subset of meshlet
allocation reserved for all physical shadow-page visibility lists). CPU copy counters include
completed copies from subsequently discarded GPU frames; they describe CPU work, not committed
residency. Unchanged page sets reuse a snapshot without incrementing the counters. The shadow value
is allocation capacity, not current visible-meshlet occupancy.

Use the production-quality STRATA page, its existing camera presets, coarse/adaptive controls and
shared stable-capture helper to observe coarse → refined → coarse transitions. Retain real HTTP
loading and GPU submission waits. These pressure observations complement the fixed SRP workload;
they need a separately reviewed streaming workload before becoming a physical bandwidth budget.

## Local validation, 2026-11-09

Development base: `fc9dc703`, branch `codex/render-graph-reuse`, Node 25.8.1 and npm 10.9.4. These
are uncommitted development observations on the local Metal adapter, not enrolled cross-commit
performance evidence. The initial captures preceded final diagnostic fields, spatial-pixel
validation and protocol-closure hashing; scene settings and timing boundaries did not change. Raw
source digests, samples and allocation profiles remain under ignored `reports/rg1/`. Strict
comparison must reject the initial/final protocol-digest mismatch.

Each number below is the median of three round medians. Both custom workloads retained identical
before/after pixel hashes, as did the default and post-process workloads. All 360 measured frames in
every final capture hit the submitted schedule cache.

| Workload             | Backend | Compile CPU ms, before → after | Transient physical estimate MiB, before → after | Sampled CPU allocation bytes/frame, before → after |
| -------------------- | ------- | ------------------------------ | ----------------------------------------------- | -------------------------------------------------- |
| Custom continuations | WebGPU  | 0.165 → 0.060                  | 84.22 → 13.91                                   | 748,452 → 666,332                                  |
| Custom continuations | WebGL2  | 0.070 → 0.030                  | 84.22 → 13.91                                   | 738,240 → 653,992                                  |
| Default Forward      | WebGPU  | 0.085 → 0.035                  | 0 → 0                                           | 429,160 → 420,704                                  |
| HDR post-process     | WebGPU  | 0.115 → 0.040                  | 13.91 → 13.91                                   | 582,880 → 542,304                                  |

Custom transient reservation fell by 83.49%; this is a graph allocation estimate, not total GPU
memory. Whole-frame CPU time did not improve consistently: default Forward changed from 2.105 to
2.350 ms, mainly in recording outside compilation; custom WebGPU changed from 2.130 to 2.025 ms. Do
not turn these local observations into an overall frame-rate or regression-budget claim. Independent
clean-commit captures, rig isolation and budget review remain open.

The native STRATA streaming test additionally observed 137,458,752 newly copied CPU bytes between
overview and the refined close view. Retained ray snapshots grew from 7,633,152 to 9,466,560 bytes
and dropped to 2,362,560 bytes after coarsening. Virtual-shadow visibility capacity remained
37,748,736 bytes (36 MiB) throughout. These are requested-capacity/completed-copy observations of
that camera sequence; they are not a streaming-bandwidth baseline.

Executed acceptance:

- Final focused Graph/SRP/meshlet regressions: 34 files, 300 tests passed. This includes real
  WebGL2/WebGPU pixels, resize, topology changes, discarded frames, multiple outputs and device
  loss.
- Renderer architecture: 150 passed. Portable RHI: 224 passed; native RHI: three passed, with the
  existing optional f16 case skipped because the adapter lacks the capability.
- Real canvas presentation suite: six passed. Complete affected hosted-profile WebGL2 groups:
  123/123 passed. Complete software WebGPU: 38/38 passed. Native STRATA: 4/4 passed. Browser runs
  had no retries, flaky cases or unexpected failures.
- Typecheck, full lint, API update/check, consumer types, documentation, formatting and actual
  installed-package checks passed. Performance protocol contracts: 87 passed, including solid-color
  negative controls. The comparison CLI was also exercised on a diagnostic round trip.

The six WebGL2 receipts share source fingerprint
`bca494ec7294f89db5dc03f7b76491ec8d0254bd8725342d6ec5d6f6a6b7babc`. All engine, example and
renderer/browser-test sources were unchanged after those broad gates; final follow-ups only
strengthened the benchmark pixel validator/protocol digest and updated documentation. Focused tests
and final captures were rerun. The first UI attempt stopped in inventory preflight because the
orchestration's global JSON-output variable redirected the list reporter; removing that variable
allowed all complete groups to pass. No test, retry or threshold changed for that fix.

Full `validate`/coverage and the complete native-device matrix were not run. No immutable RHI
baseline was changed, and no candidate was enrolled by these runs.
