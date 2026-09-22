# Local reflections validation — 2026-09-22

Source: working tree on `codex/local-reflection-probes`, based on `16827950`. This is a dated local
validation record, not a published release, an immutable benchmark baseline or proof of an enrolled
cross-device performance budget. Node 25.8.1 satisfies the repository's minimum; dependency
installation and final command runs used npm 10.9.4. Browser captures used Chromium 149.0.7827.55 on
macOS. The native project disables the software rasterizer and selects ANGLE Metal.

## Executed checks

| Check                                                               | Observed result                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                 | Passed after engine and gallery changes.                                                                                                                                                                                                                   |
| `npm run lint`                                                      | Passed, including required core/addon declaration builds.                                                                                                                                                                                                  |
| `npm run format:check` and `git diff --check`                       | Passed.                                                                                                                                                                                                                                                    |
| `npm run api:update`, then `npm run api:check`                      | Passed; the API report includes probes, auxiliary views and the new reserved block binding.                                                                                                                                                                |
| `npm run test:types`                                                | Bundler and NodeNext consumers passed, including the new reflection recipe.                                                                                                                                                                                |
| `npm run test:package`                                              | Passed, including packed ESM consumers, Naga translation and the existing Live2D packed-browser fixture.                                                                                                                                                   |
| `npm run examples:build`                                            | Passed, including the redesigned gallery and its local GLB asset.                                                                                                                                                                                          |
| `npm run docs:check`                                                | Passed; source links, synchronized recipes and TypeDoc checked.                                                                                                                                                                                            |
| `npm run test:render:architecture`                                  | 150 tests passed.                                                                                                                                                                                                                                          |
| `npm run test:rhi`                                                  | 217 portable tests and 3 native-backend tests passed; the optional `shader-f16` test was skipped by the existing suite.                                                                                                                                    |
| Renderer/shader Vitest directory run                                | 1,210 passed; one old BRDF helper-name source assertion was updated to check the shared normalized sampler, then its entire file passed (21/21). No pixel threshold changed.                                                                               |
| Reflection and auxiliary-view contracts                             | All 12 cases passed across targeted runs, including mixed probe volumes, actual WebGPU/GLSL execution, real WebGPU device destruction/recovery under the browser test adapter, shadowed six-face captures, callback rollback and invalid target rejection. |
| Generic gallery release test                                        | 2/2 passed through the normal example catalog runner, with explicit test-profile query metadata.                                                                                                                                                           |
| `npm run test:ui:contract`                                          | 34 tests passed.                                                                                                                                                                                                                                           |
| `npx jiti scripts/check-ui-groups.ts`                               | All 114 WebGL2 cases were assigned exactly once.                                                                                                                                                                                                           |
| `CI=true HILO3D_UI_GROUP=post-processing npm run test:ui:webgl2:ci` | Complete group: 8/8 passed after the gallery redesign.                                                                                                                                                                                                     |
| `HILO3D_UI_GROUP=post-processing npm run test:ui:webgpu`            | Complete group: 8/8 passed after the gallery redesign.                                                                                                                                                                                                     |
| Native production-profile gallery test                              | 2/2 passed, using `HILO3D_REFLECTION_CAPTURE_QUALITY=production`, the `chromium-native-webgpu` project and both backend tags.                                                                                                                              |
| `npm run test:webgpu`                                               | 23/24 passed. The remaining SSR failure was reproduced unchanged on the clean base commit; details below.                                                                                                                                                  |

The gallery keeps real draws, GPU submission waits, on/off pixels, movement, light recapture, resize
and post-teardown error checks. Software acceptance uses an explicitly reduced backing resolution
and concentrated capture budget; the native production-profile run retains 128-pixel faces, six
roughness bands, 128 filter samples and one-face/one-band updates. Its reviewed
[screenshot](../images/reflections/adjacent-native.png) is an actual rendered frame.

## Existing SSR failure

The existing test `rejects stale Afterimage reflection trails during rapid orbit in both directions`
fails at orbit step 7 on this machine: measured red excess `1.129689578713969`, required `< 1`.

A separate, clean worktree at base commit `16827950`, with its own `npm ci`, reproduced the exact
same step and numeric result using:

```sh
HILO3D_PLAYWRIGHT_PORT=4176 npx playwright test test/ui/screen-space-reflections.spec.ts \
  --project=chromium --grep 'rejects stale Afterimage'
```

The candidate was also rerun without source changes. Its failure matches the base; the local
reflection implementation did not introduce this observation. The test was neither skipped nor
weakened. The complete WebGPU suite must therefore still be reported as non-green in this local
environment, rather than relabeled as a passing release gate.

## Remaining evidence boundaries

- Full `npm run validate`, coverage, the entire native WebGPU suite and all unrelated UI groups were
  not run as part of this change. Relevant native gallery and device-recovery checks did run.
- Dedicated capture-time, upload and driver-resident-memory budgets have not been enrolled or
  independently reviewed across physical devices. Declared texel bytes and browser correctness are
  not performance-baseline evidence.
- The supported material, capture visibility and temporal limits are specified in
  [the current local reflection contract](../LOCAL_REFLECTIONS.md).
