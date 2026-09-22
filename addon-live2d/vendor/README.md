# Runtime inputs owned by addon-live2d

This directory contains original third-party SDK inputs used to build the addon runtime. They are
not covered by Hilo3D's MIT license. The addon package includes the original Core executable and a
compiled CPU Framework bundle with their notices; the raw SDK source tree is not published.

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
live under `../../examples/models/live2d/Miku/`.

## Generated runtime

`npm run build --workspace=@hilo/addon-live2d` builds the runtime into
`addon-live2d/dist/runtime/prebuilt/` after verifying pinned input hashes. The application's bundler
copies the static asset URLs alongside its own JavaScript; direct browser ESM uses the package
layout. Applications call `Live2DModel.load()` without preparing an SDK or selecting a runtime URL.

The source-checkout Vite plugin uses the same builder with an ignored
`addon-live2d/.cache/prebuilt-runtime/` directory. Original SDK inputs remain unchanged and are
excluded from first-party lint/formatting, while the builder, adapter and provenance remain checked.
