# Native DDGI evidence protocol

This is a separate, versioned **baseline-candidate** protocol for the original Afternoon Atelier. It
does not modify the immutable RHI snapshots, their schema, or their enrolled rig manifest. A
successful capture is reviewable evidence of this fixed workload, not a release performance claim.

## Preconditions

- Use the enrolled physical macOS rig, its exact Node/Playwright/Chromium versions and executable,
  AC High Power Mode, and an audited environment JSON. `assertRHIPhase0Preflight` verifies the
  existing fingerprint, current machine, power state and browser executable bytes.
- Commit the complete fixture and collector first. `auditedRHIBenchmarkCommit` rejects tracked or
  untracked changes and records the full 40-character commit. It checks the tree again after
  capture.
- Close competing GPU workloads. Do not run browser tests, Blender rendering or other captures
  concurrently. This protocol does not infer thermal or scheduling equivalence from timing alone.
- Start a **built** examples preview, for example
  `npx vite preview --config vite.examples.config.ts --host 127.0.0.1 --port 4173 --strictPort`. The
  collector runs `npm run examples:build` from the clean committed tree before opening browsers.
  Every served response must byte-match the resulting `dist-examples/` file; a stale preview or
  source/dev server fails.

Use the same audit variables as the RHI protocol:

```sh
export HILO3D_RHI_BENCHMARK_ENVIRONMENT=/absolute/path/to/audited-environment.json
export HILO3D_RHI_BENCHMARK_BROWSER_EXECUTABLE=/absolute/path/to/enrolled/Chromium
npm run benchmark:ddgi:collect -- \
  --output /absolute/path/to/fresh-ddgi-candidate.json \
  --url http://127.0.0.1:4173/examples/dynamic_global_illumination_atelier.html
```

The URL must be the exact known HTML entry on a loopback HTTP origin, without credentials, query or
fragment. External requests, redirects, path escapes, software adapters, differing device/driver
identities, browser errors and missing timestamps abort capture. The collector supplies COOP/COEP
headers to the byte-verified local responses for a cross-origin-isolated clock. No credentials or
external model/service requests are part of the workload.

## Fixed workload and timing boundaries

Each mode runs in three independent Chromium processes, with 64 warmup frames followed by 120
measured frames at 960 × 600, device scale 1. Mode order alternates between rounds. The scene and
camera stay fixed in the night preset. The `enabled` mode retains the 315-probe volume, 48 updates
and 6,144 primary rays per frame (128 rays per probe). The active ray scene has 27,312 triangles.
The `disabled` mode constructs the pipeline without DDGI; it must have no probe runtime or DDGI
passes. The normal interactive intensity toggle is deliberately not used for cost comparison.

The explicit benchmark-only URL exposes a bounded `measureFrame()` hook and disables the ticker:

1. `cpuRecordMs` times the synchronous `stage.tick()` call, including engine frame work.
2. `fenceWaitMs` separately times the renderer queue fence. It includes browser scheduling and
   submission waits; it is **not** a GPU execution time.
3. Native Render Graph timestamps are resolved for that exact frame. `gpuPassTimeSumMs` sums actual
   render/compute pass durations. It excludes gaps between passes, presentation and untimed work; it
   must never be called end-to-end GPU frame time.
4. Timestamp polling and diagnostic GPU counter readback happen outside the first two intervals and
   have their own reported durations. The profiler is enabled identically for both modes.

The report retains all frame samples and per-pass GPU durations, CPU graph segments, real draw/
dispatch/submission counters, probe/ray budgets, resident bytes and uploaded bytes. Missing or
unresolved GPU timestamps fail rather than becoming zero. Scene pixels are captured after measured
frames. A fixed interior region excludes overlay controls, rejects uniform output and requires a
visible enabled/disabled difference in each round. Pixel hashes identify the captured output.

## Review and retention

Output uses exclusive creation (`flag: 'wx'`) and cannot target `benchmarks/`; existing reports are
never overwritten. Reports record the enrolled environment, complete commit, SHA-256 map and digest
for the GLB/example/GI source closure, and all served build artifacts. Source, power and environment
validation runs again before writing. Retain the complete raw report and audit alongside any
reviewed summary. The workload/protocol digest must match before cross-commit comparison;
independently review and explicitly enroll a new fixture revision when it differs. The separate
implementation digest and complete commit identify engine changes and are expected to differ.

The first accepted capture can be reviewed as the initial DDGI baseline candidate. Establishing a
release gate requires separate review of repeatability and budgets. This static room does not
measure startup, moving lights/occluders, material churn, large scene uploads, memory pressure or
application tail latency. Local art previews and UI smoke timing are not substitutes for this
protocol.

The collector rejects timing sets whose CPU or GPU pass-time round medians differ by more than 30%,
or whose per-round p95 exceeds three times its median. This is a noise gate, not proof that no other
process used the GPU. A stable competing workload can pass; operator isolation and independent
review remain required. Failed captures must be rerun under quieter conditions with a fresh output
path, without trimming samples or relaxing thresholds to obtain a passing result.
