# Documentation and package versions

The repository and development website can contain **Unreleased** features even while package.json
still carries the last release number. Read the top of [CHANGELOG](../CHANGELOG.md) and the
installed package declarations before choosing an API. DDGI is an Unreleased source feature as of
this review; its presence in current docs does not promise it exists in the alpha.8 tarball. Local
reflection probes and auxiliary SRP views are likewise Unreleased source APIs.

## Install a matching release

For Hilo3D 2.0 alpha, use `npm install --save-exact hilo3d@next`. Resolve and pin the concrete
version; do not leave a moving dist-tag in a reproducible template. The 2026-09-20 registry check
returned `latest: 1.19.1` and `next: 2.0.0-alpha.8`; these are dated observations, not permanent tag
values. Use `npm view hilo3d dist-tags --json` to inspect current channels.

Optional `@hilo/addon-particle` and `@hilo/addon-physics` packages must match the exact core
version. The physics adapters also require the chosen dimension's Rapier peer. The installed `.d.ts`
files are the consumer's exact API reference; repository internals are not supported deep imports.

## Documentation builds

The site builder writes `documentation/build.json` containing the source commit, package version,
exact matching Git tag if present, and whether tracked or untracked source changes exist. It labels
an untagged or modified checkout as a development snapshot. A clean exact release-tag checkout is
labeled as release source, not as proof that npm accepted the publication.

The generated llms.txt links that provenance. Published Markdown repeats the build label; links to
source code outside the published document set use the full commit. For a dirty local build those
remote source links refer to the base commit, so local modifications are explicitly flagged. No live
npm network lookup is required during a reproducible site build.

## Consumer and contributor sources

| Task                                | Read first                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Build with an installed npm version | Its declarations, release changelog/tag and matching recipes; reject APIs marked Unreleased.                |
| Work on the current checkout        | AGENTS, documentation index, relevant current contract, source and tests.                                   |
| Understand an old decision          | Archive with its frozen code baseline; never treat an old plan as an implementation instruction.            |
| Assess performance                  | The enrolled benchmark protocol and accepted capture for that workload/commit; local smoke is insufficient. |

When publishing a release, build documentation from the matching clean tag and keep its provenance.
A development deployment must remain labeled as development even when its package version equals a
published release. Recipes are verified against packed checkout packages; they must not be described
as verified against a registry release unless that separate consumer check actually ran.
