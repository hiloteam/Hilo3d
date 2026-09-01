# ECS migration benchmark

This registered cross-commit gate compares the removed Node/Stage update path at the frozen RHI
baseline commit with the current `World -> TransformSystem -> RenderExtractionSystem` path. The
fixture contains 100,000 static and 10,000 dynamic renderable transforms. Each measured frame
updates the dynamic subset, propagates world matrices, and produces the renderer collection.

The two commits run in fresh Node processes and alternate order for three rounds. The median
round-p95 candidate time must improve by at least 25%. Candidate diagnostics must report exactly
10,000 transform and bounds updates, proving that the 100,000 static records were not scanned by
dirty propagation. Allocation sampling separately gates the Transform and render-extraction core;
the World transaction shell is excluded because V8 allocates fixed exception-handler contexts for
the required rollback boundary.

Use Node 22.23.1 and a clean detached worktree at the manifest's `baselineCommit`:

```bash
git worktree add --detach /tmp/hilo3d-ecs-baseline \
  2f72d916510db137b8e3cbb16161a1b38721c227
npm run benchmark:ecs:compare -- /tmp/hilo3d-ecs-baseline
git worktree remove /tmp/hilo3d-ecs-baseline
```

The command fails closed for a different Node version, baseline commit, dirty worktree, entity or
dirty-counter mismatch, less than 25% p95 improvement, or any allocation attributed below the
Transform/extraction hot boundaries. It prints the complete JSON evidence to stdout; callers should
store that temporary artifact with the MR evidence rather than overwrite the frozen RHI baseline.
Allocation sampling requires three consecutive empty static and dynamic profiler-conditioning
profiles (with a hard attempt limit) before its three measured profiles; this excludes one-time V8
profiler/JIT tiering metadata, while recurring per-frame allocations can never reach the measured
stage and fail closed.
