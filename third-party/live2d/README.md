# Live2D SDK inputs for the offline character example

This directory contains original third-party SDK inputs for the maintained Live2D example. They are
not covered by Hilo3D's MIT license. They are not included in the `hilo3d` or `@hilo/addon-live2d`
npm packages.

- `cubism-5-r.5/Core/` contains the unmodified Core executable, declarations, license notice and
  redistributable-file list from an authorized, pre-existing local SDK copy associated with Cubism
  SDK for Web 5-r.5. Its executable SHA-256 is
  `8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47`.
- `cubism-5-r.5/Framework/` contains the unmodified source tree, license, README and TypeScript
  configuration from the official
  [5-r.5 Framework tag](https://github.com/Live2D/CubismWebFramework/tree/198a3769c26ca3d7b600e932590433badd392edd),
  commit `198a3769c26ca3d7b600e932590433badd392edd`. The complete source tree preserves upstream
  imports; the runtime builder selects CPU modules and rejects native WebGL/WebGPU renderers.
- `cubism-5-r.5/SDK-LICENSE.md` preserves the accompanying SDK notice.
- [provenance.json](./provenance.json) records acquisition details and every vendored file's byte
  length and SHA-256. Runtime preparation verifies these hashes before bundling.

The official SDK ZIP endpoint returned HTTP 403 during this work. The Core executable was copied
from the existing installation, not obtained by circumventing that response. We do not claim that
its bytes were independently compared with that inaccessible archive. Framework files were obtained
and verified independently through the official public GitHub tag.

Core is governed by the
[Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).
Framework is governed by the
[Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html).
The original notices also describe applicable SDK release-license conditions. Preserve those notices
and review their terms when distributing a deployment. Hatsune Miku artwork and its separate terms
live under `examples/models/live2d/Miku/`.

## Generated runtime

Vite serves `/examples/assets/live2d/runtime/runtime.js`. On the first matching development request,
[the preparation script](../../scripts/prepare-live2d-example.ts) verifies the SDK inputs and builds
the runtime into ignored `.cache/live2d-example-runtime/`. Successful requests share that build.
Development watches addon source/tools and pinned SDK inputs; a change invalidates the cache,
rebuilds through a serialized queue, then fully reloads the page so its CPU runtime is current.

`npm run examples:build` generates the same files and copies the runtime, immutable Core/CPU
modules, original license notices and manifest into `dist-examples/examples/assets/live2d/runtime/`.
Site publication copies this directory with the rest of the examples. Development and published
examples need neither a CDN nor a raw `third-party/` URL. Generated JavaScript is never committed
under `examples/`.

To prepare the cache explicitly, run `npx jiti scripts/prepare-live2d-example.ts` after `npm ci`. No
prior engine or addon build is required. Original SDK sources are excluded only from first-party
formatting/linting; the first-party scripts and provenance files retain normal checks.
