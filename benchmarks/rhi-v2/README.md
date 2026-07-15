# RHI v2 performance baseline

This directory freezes the benchmark contract and production A/B capture pipeline. It contains no
synthetic performance numbers. A baseline is accepted only after an enrolled physical,
fixed-configuration Linux runner has produced complete raw samples and passed the verifier.

## Frozen contract

[`manifest.json`](./manifest.json) fixes all ten scenarios from the RHI v2 refactor plan, WebGL2 and
WebGPU, scene quality, 300 warm-up frames, 2,000 sampled frames, seven independent rounds, seeded
execution ordering, and seeded 95% bootstrap confidence intervals.

Schema v2 requires frame-build, graph-compile, RHI issue/encode, RHI execute/end-frame, combined
RHI, and total renderer CPU segments; GPU timing; renderer and RHI-hot-path allocation; heap
high-water and retained heap; native buffer/texture/pipeline/bind-group/VAO/program creation;
command/draw/state counts; pipeline/bind-group/VAO/framebuffer cache hit rates; and first
shader/pipeline preparation timing. Timing, GPU, draw/state, and cache-diagnostic metrics contain
2,000 main-pass samples per round. The independent allocation pass contains exactly 21 measured
samples per round; `sampling.allocationSampleFrames` is deliberately separate from the 2,000-frame
`sampling.sampleFrames` contract. Heap, native-object, and first-prepare metrics contain one
explicit observation per round rather than fabricated frame samples. The first-complex-frame CPU
metric likewise records one cold-entry observation per round so its p95 gate cannot be diluted by
later steady frames.

Summaries use deterministic R-7 p50/p95/p99, MAD, population CV, and seeded 95% bootstrap median
intervals. Paired legacy/RHI-v2 gates require at least seven rounds. A positive paired regression
whose confidence interval excludes zero fails independently of the Section 11.4 hard caps.

## Enrolling the performance rig

`rig.acceptedFingerprintSha256` is intentionally empty until the dedicated runner is audited. The
fingerprint must cover the stable machine identity recorded by the future collector: OS/kernel, CPU
model, GPU adapter and driver, browser build, Playwright version, Node version, and power profile.
Add the audited SHA-256 digest explicitly; do not use a wildcard or a developer laptop fingerprint
as a placeholder.

An empty allowlist makes preflight, collection, summarization, freezing, and verification fail. The
audit command prints a candidate environment JSON but never edits the allowlist; enrollment remains
an explicit reviewed manifest change.

## Production fixture and collector

[`rhi-v2-production.html`](../../test/performance/fixtures/rhi-v2-production.html) loads the
versioned browser fixture protocol. Every scenario/backend/round launches the legacy and RHI-v2
renderer in separate fresh pages, in deterministic seeded order. Both pages build the same
manifest-owned scene quality. The collector rejects reused page identities, changed quality, changed
draw counts, and different pixel hashes.

Metrics are collected in independent passes so profilers do not contaminate wall-clock samples:

- instrumented production method boundaries on a cross-origin-isolated high-resolution clock produce
  frame-build, graph-compile, command, execute, combined-RHI, and renderer CPU segments;
- `EXT_disjoint_timer_query_webgl2` and WebGPU `timestamp-query` produce GPU samples, with no CPU
  wall-clock fallback;
- Chromium CDP sampling at a one-byte interval profiles the independent 21-sample allocation pass,
  not the 2,000-frame main timing/GPU pass. Timing wrappers are suspended once for the complete
  allocation phase; 30 ordinary post-suspend frames retrain the restored production call sites
  before sampling. The profiler then uses exactly two sessions. Stage A runs an unmarked 70,000-draw
  tier-up budget, capped at 288 frames, without retaining collected objects; a major GC precedes its
  stop and its deliberately unparsed profile is discarded completely. Stage B uses one new
  retained-object session and targets 67,000 cumulative draws before the terminal five-frame zero
  window of one fixed 21-frame marked quiescence probe. The unmarked restart is capped at 288 frames
  and deducts only the preceding 16 fixed probe frames from that target; no observed result moves
  the window. The probe uses the unchanged markers and classifier, and a fresh unchanged 21-frame
  measured window follows immediately after its terminal five-frame zero proof in that same session.
  There is no duplicate discard window. Only the final `HeapProfiler.stopSampling` result is parsed:
  the probe must end in five consecutive zero-hot frames or the run aborts. This deliberately avoids
  the full GC and profile translation performed by an in-session `getSamplingProfile`, which can
  perturb later V8 tiers while the sampler remains active. No measured frame is selected from the
  quiescence probe, and the profiler is never restarted between quiescence and measurement. For
  512-draw cases the two unmarked budgets are 137 and 115 frames; for 256-draw cases they are 274
  and 246. The classifier's dedicated renderer boundary excludes application-side scene mutation
  while retaining frame construction and public RHI lifecycle shells for legacy/RHI-v2 A/B
  comparison. The zero-allocation hot counter includes SharedDrawPass/PreparedDraw execution and
  concrete context commands (including allocations in their helper/native descendants), while
  frame/pass/submission shell creation and WebGPU encoder creation/finalization are lifecycle costs
  outside that hot counter. In every marked Stage B frame, the end marker closes the synchronous
  renderer window before `waitForIdle`; sampling remains active while that wait settles, but the
  parser excludes work outside the marker pair. The wait completes before the next start marker, and
  the final wait completes before `stopSampling` returns the single profile that is split into frame
  samples;
- Chromium precise-memory data plus a CDP major collection produce high-water and retained heap;
- renderer diagnostics produce exact native creation, command/draw/state, and cache hit/miss data.

Pipeline, bind-group, VAO, and framebuffer hit rates all require a non-zero `hits + misses`
denominator on every sampled frame. WebGPU uses the corresponding logical vertex-input and render
attachment plan caches for the VAO/framebuffer metrics; it never reports a fictitious native object.
Unavailable, hit-only, zero-request, disjoint, fallback, or imprecise measurements fail before any
artifact is opened.

### Non-evidence fixture smoke

`npm run test:rhi-benchmark-smoke` opens fresh legacy and RHI-v2 pages for a representative
WebGL2/WebGPU matrix. Each page runs 30 ordinary warm-up frames, suspends timing instrumentation,
runs 30 fixed post-suspend ordinary frames, then uses the same discarded 70,000-draw exact tier-up
session, retained-object fixed restart/probe tier target, marked quiescence proof, and fresh 21
measured profiles as the formal collector. The smoke prints both quiescence vectors and the measured
vectors, then requires the RHI-v2 measured hot-path maximum to be exactly zero, its
renderer-allocation median not to exceed paired legacy, and manifest quality, observed draw counts,
and pixel hashes to match. Pass `-- --all` to cover all ten scenarios. This command deliberately
bypasses enrolled-rig preflight, may use a software adapter, keeps results only in memory, and never
calls collection, freezing, verification, or the candidate wall-clock/GPU gate. It is a PR
allocation/fixture regression gate, not an enrolled-rig performance baseline or timing claim. For
local diagnosis, narrow the same fixed gate with
`-- --scenario=pbr-lights-shadows --backend=webgl2`; this changes case selection, not its sample
counts or budgets.

## Result layout

Temporary collector output belongs under the ignored `reports/rhi-v2/` directory. Once collected, a
baseline directory will contain:

```text
benchmarks/rhi-v2/baselines/<rig-profile>/
├── legacy.raw.json.gz
├── legacy.summary.json
└── report.md
```

The raw artifact contains both architectures; the frozen `legacy.summary.json` selects the legacy
half as the immutable baseline. Both files identify one full, clean Git commit. `report.md` is a
human-readable rendering of the checked summary, not an independent source of numbers.

Verify a candidate summary with:

```sh
npm run benchmark:rhi:verify -- benchmarks/rhi-v2/baselines/<rig-profile>/legacy.summary.json
```

## Paired candidate gate

Phase 7 evaluates a newly collected paired raw artifact against the checked benchmark contract and
an immutable Phase 0 legacy baseline:

```sh
npm run benchmark:rhi:gate -- \
  reports/rhi-v2/candidate.raw.json.gz \
  benchmarks/rhi-v2/baselines/<rig-profile>/legacy.summary.json \
  reports/rhi-v2/candidate.gate.json \
  reports/rhi-v2/candidate.gate.md
```

Paired statistical inference comes exclusively from the current raw artifact's legacy and RHI-v2
values for the same scenario, backend, and round. Section 11.4 hard caps are separate cross-time
comparisons against the verified frozen legacy summary: each cap checks both current RHI-v2 and
current legacy drift against `frozen-legacy`. Cross-time rows never claim a paired confidence
interval or statistical significance, so a common regression in both current paths cannot disappear
behind a zero paired difference.

The evaluator verifies the frozen summary against the fixed sibling `legacy.raw.json.gz`, requires
both captures to use the same manifest and exact audited environment, and recomputes the frozen
summary from its raw samples. The summary argument must be the canonical, non-symlink repository
path `benchmarks/rhi-v2/baselines/<rig-profile>/legacy.summary.json`; arbitrary temporary summaries
and symlinked summary/raw files are rejected. Output parents are resolved without writes and may not
reach the immutable baseline directory through a symlink. The current capture must identify the
current clean commit and current production-fixture checksum; those identities are intentionally
allowed to differ from the older frozen baseline.

The machine-readable JSON and Markdown rendering identify each row's reference and comparison. They
include every metric's paired significance gate, both frozen-reference forms of every applicable
Section 11.4 hard cap, and per-round parity requiring both current paths to match the frozen pixel
hash and the manifest draw count. Candidate validation keeps well-formed parity mismatches long
enough to emit a diagnostic FAIL artifact; malformed hashes, metrics, or case matrices still fail
before output. A statistically significant regression or a hard-cap/parity violation fails the
command. Both output files are published without overwriting existing files; if either cannot be
published, neither is left behind. A completed failing report is still written for diagnosis and the
command exits non-zero.

This report's scope is explicitly `performance-and-pixel`. It does not attest context/device-loss
recovery; run the separate lifecycle/runtime recovery suite, including
`test/spec/renderer/ResourceLifecycleGate.test.ts`, before declaring the overall Phase 7 gate
complete.

## Dedicated-runner procedure

On the prospective Linux rig, pin the Chromium binary and verify the CPU/GPU power policy first:

```sh
export HILO3D_RHI_BENCHMARK_BROWSER_EXECUTABLE=/opt/chromium/chrome
export HILO3D_RHI_BENCHMARK_POWER_PROFILE=fixed-performance
npm run benchmark:rhi:audit-environment > /secure/hilo3d-rhi-environment.candidate.json
```

Review the candidate identity, browser SHA-256, GPU/driver identity, capabilities, runner labels,
and power configuration. Then add only its reviewed `fingerprintSha256` to
`rig.acceptedFingerprintSha256`, commit that change, and point preflight at the unchanged audited
JSON:

```sh
export HILO3D_RHI_BENCHMARK_ENVIRONMENT=/secure/hilo3d-rhi-environment.json
npm run benchmark:rhi:preflight
```

Preflight hashes the actual Chromium executable and the HTML/TypeScript fixture closure, compares
the running OS/kernel, Node, CPU, and Playwright identity, rechecks every observable CPU governor
and the audited power-profile acknowledgement, requires the enrolled fingerprint, and performs no
writes. Collection additionally requires the same clean source commit before and after capture. The
guarded pipeline entry points are:

```sh
npm run benchmark:rhi:collect -- reports/rhi-v2/legacy.raw.json.gz
npm run benchmark:rhi:summarize -- reports/rhi-v2/legacy.raw.json.gz reports/rhi-v2/legacy.summary.json
npm run benchmark:rhi:freeze -- reports/rhi-v2/legacy.summary.json reports/rhi-v2/legacy.raw.json.gz
npm run benchmark:rhi:report -- reports/rhi-v2/legacy.summary.json reports/rhi-v2/report.md
```

Every mutating capture/freeze stage runs the same preflight before opening an output file. It
requires the production fixture, an audited Chromium executable SHA-256, an environment JSON named
by `HILO3D_RHI_BENCHMARK_ENVIRONMENT`, an enrolled combined environment fingerprint, and the
dedicated Linux performance rig. This repository intentionally has no enrolled fingerprint or raw
baseline yet, so capture currently hard-fails closed and cannot create evidence on a developer
machine.

Run the schema and rejection-path contract with:

```sh
npm run test:rhi-benchmark-contract
```

The fixture, Playwright adapter, raw schema, statistics, reports, and mutation guards are executable
infrastructure, not evidence by themselves. Phase 0 remains incomplete until the audited dedicated
rig is enrolled and its real paired raw capture, frozen legacy summary, and variance report are
committed. The Phase 7 candidate gate additionally requires a current paired capture and its final
machine-readable and Markdown gate reports.
