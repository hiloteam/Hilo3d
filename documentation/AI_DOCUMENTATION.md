# AI documentation maintenance

Hilo3D has three complementary entry points: [AGENTS](../AGENTS.md) for engine contributors,
[the game skill](../skills/hilo3d-game/SKILL.md) for standalone consumers, and
[llms.txt](../llms.txt) for web discovery. Keep the index short and link current contracts instead
of copying API signatures into another manual. The [llms.txt proposal](https://llmstxt.org/)
describes a Markdown navigation convention; availability does not guarantee every agent will
discover or use it.

## Source and publication

The root llms.txt is the single authored index. `scripts/documentation-manifest.ts` defines
published Markdown roots and recipe documents. The site builder copies them, rewrites source-only
links to commit-pinned repository URLs, copies referenced documentation assets and emits build
provenance. It uses the same output under custom-domain and project-subpath hosting; no
root-relative links. The source index remains readable directly in a checkout. Archive is available
through an explicit historical index, outside the primary llms.txt path list.

`npm run docs:check` checks local file/anchor links, current executable npm command names, recipe
synchronization and TypeDoc. Historical archive commands are intentionally excluded from executable
command validation. `npm run site:check:links` also checks published Markdown and llms.txt
destinations. Generated docs/site files remain ignored. Do not add a hand-maintained llms-full.txt
or duplicate API schema; exact installed declarations and existing API Extractor reports remain
authoritative.

## Recipe workflow

Edit `test/types/recipes/`, then run `npm run docs:sync` to refresh marked Markdown blocks.
`npm run test:types` verifies Bundler and NodeNext consumption; `npm run test:package` additionally
installs actual core/addon tarballs and compiles/bundles recipes without source aliases. Optional
addons are isolated in their own recipe modules. This is type/build evidence, not a browser
rendering or lifetime test. Existing browser fixtures remain the runtime evidence for the referenced
APIs.

See [version policy](./VERSIONS.md). A development checkout carrying alpha.8 plus Unreleased changes
must never be labeled as the alpha.8 npm API. Site provenance is generated from the actual build;
release publication and physical performance results must be verified separately.

## Consumer task checklist

Use only llms.txt as the documentation starting point, with an exact installed package, to evaluate:

1. Create and resize a 2D text/sprite scene with correct anchors.
2. Create a 3D PBR scene with public OrbitControls and deterministic teardown.
3. Load a local GLB, select animation and keep milliseconds/seconds correct.
4. Add portable Bloom/filmic, then explain why auto exposure requires WebGPU.
5. Add particles or one physics dimension with matching addon/peer versions.
6. Stop ticking before teardown, preserve persisted navigation and surface startup failures.

Record package version, documentation build, task, API errors, missing imports, backend mistakes,
lifecycle failures and actual browser checks. This is a repeatable evaluation protocol; adding it to
the repository does not claim an agent evaluation was executed. Do not involve external agents or
services automatically in ordinary CI.
