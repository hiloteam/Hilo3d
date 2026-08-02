# Current RHI benchmark baseline

This suite measures the production rendering architecture only:

```text
SharedRendererDriver -> Render Graph -> RHI -> WebGL2 / WebGPU backend
```

The removed feature-driver and pre-refactor RHI implementations are not benchmark dependencies.
`RendererArchitecture` therefore has one valid value, `rhi`, and manifest schema version 4 records a
single architecture across both supported backends.

## Baseline policy

The current implementation is the baseline. A capture is tied to a full Git commit, the production
fixture checksum, an audited physical-rig fingerprint, Chromium, Node.js, Playwright, GPU/driver,
and fixed sampling parameters. Future implementations should be compared with an immutable snapshot
from an earlier commit; they must not restore a second renderer implementation merely to perform
same-commit A/B testing.

The suite covers ten fixed scenarios, WebGL2 and WebGPU, seven isolated rounds, 2,000 timing/GPU
samples per round, and 21 allocation profiles. Every backend/round opens a fresh page, renderer,
graphics context/device, scene, shader cache, and diagnostics sink. Pixel hashes and observed draw
counts must remain stable across rounds. `quality.surfaceOutputPassCount` explicitly accounts for
the final linear-to-sRGB surface transfer, so primary scene draw counts are not inflated to absorb
fixed output work.

An empty `acceptedFingerprintSha256` list is intentionally fail-closed. Audit and explicitly enroll
the physical rig before collecting evidence; do not weaken the manifest to make a workstation pass.

## Commands

```bash
# Validate the contract and collector without producing evidence.
npm run test:rhi-benchmark-contract
npm run test:rhi-benchmark-smoke

# On the enrolled physical rig, audit then collect a temporary current-RHI capture.
npm run benchmark:rhi:audit-environment
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
