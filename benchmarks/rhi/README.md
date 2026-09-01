# Current RHI benchmark baseline

This suite measures the production rendering architecture only:

```text
SharedRendererDriver -> Render Graph -> RHI -> WebGL2 / WebGPU backend
```

The removed feature-driver and pre-refactor RHI implementations are not benchmark dependencies.
`RendererArchitecture` therefore has one valid value, `rhi`, and manifest schema version 4 records a
single architecture across both supported backends.

## Baseline policy

The current implementation is the baseline. The enrolled rig is the dedicated Apple M3 Max MacBook
Pro described by the `hilo3d-rhi-perf-macos-m3-max` profile. A capture is tied to a full Git commit,
the production fixture checksum, an audited physical-rig fingerprint, Chromium, Node.js, Playwright,
macOS/Metal GPU identity, and fixed sampling parameters. Future implementations should be compared
with an immutable snapshot from an earlier commit; they must not restore a second renderer
implementation merely to perform same-commit A/B testing.

The suite covers ten fixed scenarios, WebGL2 and WebGPU, seven isolated rounds, 2,000 timing/GPU
samples per round, and 21 allocation profiles. Every backend/round opens a fresh page, renderer,
graphics context/device, scene, shader cache, and diagnostics sink. Pixel hashes and observed draw
counts must remain stable across rounds. `quality.surfaceOutputPassCount` explicitly accounts for
the final linear-to-sRGB surface transfer, so primary scene draw counts are not inflated to absorb
fixed output work.

`acceptedFingerprintSha256` is fail-closed: it may contain only fingerprints produced by the audit
on the reviewed M3 Max rig. An OS, Chromium binary, browser version, Metal driver, Node version, or
hardware identity change produces a different fingerprint and requires a fresh review rather than
silently extending the existing baseline.

## Enrolled macOS rig

Evidence collection requires all of the following:

- macOS on the enrolled Apple M3 Max machine, connected to AC power;
- **High Power** selected for “On power adapter” in System Settings → Battery;
- no thermal or performance warning reported by `pmset -g therm` since boot;
- exact Node.js and Playwright versions from `manifest.json`;
- the Playwright-managed Chromium executable whose SHA-256 is part of the enrolled fingerprint;
- native Metal through ANGLE, a non-fallback adapter, both backend GPU timers, precise memory, and
  the Chromium allocation profiler.

The audit and every mutating pipeline stage recheck the live power state. Keep the lid open, avoid
external-display changes and background workloads, and let the machine return to a stable
temperature before a capture. macOS results are comparable only with verified snapshots from this
same rig profile.

## Commands

```bash
# Validate the contract and collector without producing evidence.
npm run test:rhi-benchmark-contract
npm run test:rhi-benchmark-smoke

# On the enrolled Mac, use the exact Node version from manifest.json and locate pinned Chromium.
export HILO3D_RHI_BENCHMARK_POWER_PROFILE=fixed-performance
export HILO3D_RHI_BENCHMARK_BROWSER_EXECUTABLE="$(node --input-type=module -e \
  'import { chromium } from "playwright"; console.log(chromium.executablePath())')"
mkdir -p reports/rhi
node_modules/.bin/jiti scripts/performance/audit-rhi-benchmark-environment.ts \
  > reports/rhi/macos-m3-max.environment.json
export HILO3D_RHI_BENCHMARK_ENVIRONMENT="$PWD/reports/rhi/macos-m3-max.environment.json"

# Preflight, then collect a temporary current-RHI capture from a clean committed worktree.
npm run benchmark:rhi:preflight
npm run benchmark:rhi:collect -- reports/rhi/current.raw.json.gz

# Summarize, inspect, and freeze the approved snapshot.
npm run benchmark:rhi:summarize -- \
  reports/rhi/current.raw.json.gz \
  reports/rhi/current.summary.json
npm run benchmark:rhi:report -- \
  reports/rhi/current.summary.json \
  reports/rhi/report.md
npm run benchmark:rhi:freeze -- \
  reports/rhi/current.summary.json \
  reports/rhi/current.raw.json.gz
```

The immutable baseline directory is:

```text
benchmarks/rhi/baselines/<rig-profile>/
├── current.raw.json.gz
├── current.summary.json
└── report.md
```

Verify a frozen snapshot with:

```bash
npm run benchmark:rhi:verify -- \
  benchmarks/rhi/baselines/<rig-profile>/current.summary.json
```

Collectors and summarizers cannot write directly into the baseline directory. The freezer checks the
raw checksum, manifest checksum, commit, environment, production fixture, recomputed statistics,
canonical filenames, and destination before making one atomic immutable write.

## What is and is not evidence

`test:rhi-benchmark-smoke` is a non-evidence compatibility and allocation smoke test using isolated
current-RHI pages. It verifies that both backends initialize, render, expose diagnostics, produce a
pixel hash, and stay within the temporary RHI hot-path allocation budget. It does not create or
verify a performance baseline.

Only an enrolled-rig capture that passes preflight and is frozen by `benchmark:rhi:freeze` is
baseline evidence. Cross-commit comparison/gating should consume two verified schema-v4 snapshots.
The old same-commit legacy/RHI candidate gate was removed with the legacy renderer.

## Files

- `manifest.json`: frozen workload, sampling, backend, and physical-rig contract.
- `result-schema.ts`: JSON-safe raw and summarized artifact types plus metric definitions.
- `fixture-contract.ts`: browser fixture protocol used by the Playwright collector.
- `test/performance/fixtures/rhi-production.ts`: production shared-renderer workload.
- `scripts/performance/collect-rhi-benchmark.ts`: audited current-RHI collector.
- `scripts/performance/summarize-rhi-benchmark.ts`: raw verifier and deterministic summarizer.
- `scripts/performance/freeze-rhi-baseline.ts`: atomic baseline enrollment.
- `scripts/performance/verify-rhi-baseline.ts`: manifest, environment, and frozen snapshot verifier.

## Agent guidance

Do not add backend branches above the RHI boundary, import backend internals into shared rendering,
change fixed sampling silently, enroll a machine without an environment audit, fabricate benchmark
artifacts, or reintroduce legacy renderer code for comparisons. When changing the fixture contract,
bump its protocol and update collector tests in the same change.
