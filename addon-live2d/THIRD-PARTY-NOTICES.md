# Package licenses

The Hilo3D adapter and internal build tools are MIT licensed; see [LICENSE](./LICENSE). The
generated files in `dist/runtime/prebuilt/` also contain Live2D software under its own terms. The
MIT license does not apply to that third-party software.

- `live2dcubismcore.min.js` is the unmodified Cubism Core redistributable, governed by the
  [Live2D Proprietary Software License](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html).
- `runtime-core.js` combines the MIT adapter with Cubism Framework CPU modules governed by the
  [Live2D Open Software License](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html).
- `dist/runtime/prebuilt/licenses/` preserves the original Core, Framework and SDK notices, the Core
  redistributable-file list and the adapter MIT license. Keep these with application deployments.
- `dist/runtime/prebuilt/live2d-runtime.manifest.json` identifies the included files and source
  hashes.

Use and redistribution of the included Live2D software are subject to the linked Live2D agreements,
including their applicable publication-license conditions. The bundled runtime does not grant a
Cubism SDK Release License or rights to character artwork. Model files are supplied separately by
the application. This integration is not an official Live2D product.
