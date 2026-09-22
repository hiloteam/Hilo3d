# @hilo/addon-assets

Unreleased A0 texture streaming for Hilo3D. This checkout still uses the alpha.8 development package
version; the new package/API must not be assumed to exist in that published release.

An optional ESM addon owns KTX2/Basis requests, dedicated module workers, shared asset identities,
reference-counted leases, visibility/LOD demand and bounded texture residency. The core owns GPU
allocation, graph validation, uploads, submission fences and device recovery. No addon code or WASM
enters the core package.

```ts
import { Stage } from 'hilo3d';
import { ASSET_STAGE_SERVICE, createAssetStageSystem } from '@hilo/addon-assets';

const stage = await Stage.create({ systems: [createAssetStageSystem()] });
const assets = stage.systems.get(ASSET_STAGE_SERVICE);
const lease = assets.acquireTexture({
    id: 'stone',
    version: 'content-hash',
    url: '/stone.ktx2',
    byteLength: 966,
    width: 40,
    height: 40,
    mipLevelCount: 6
});
// Assign lease.texture to a material immediately; it starts as a neutral placeholder.
// Tick the Stage before awaiting readiness. Standalone AssetManager pumps via rAF by default.
await lease.ready;
await lease.setDemand({ mipLevel: 2, priority: 10, visible: true });
lease.release();
// Stop the application ticker, then stage.destroy() disposes its asset manager and workers.
```

Manifest sizes/dimensions above illustrate the fixture, not an arbitrary stone texture. Metadata
must match the encoded asset. Content changes require a different version. HTTP URLs receive an
explicit `hilo_asset_version` query; custom authenticated transport can use the fetch option.

Supported: full-chain, non-array 2D KTX2 ETC1S and UASTC LDR (including UASTC Zstandard),
linear/sRGB, top-left `rd` orientation. Target preference is ASTC 4×4 → BC3 → ETC2 RGBA → RGBA8;
suffixes with non-block-aligned base dimensions use RGBA8. The initial coarse mip is followed by the
requested suffix. Texture identity survives promotion, eviction and recovery.

See the repository
[asset contract](https://github.com/hiloteam/Hilo3d/blob/dev/documentation/ASSET_STREAMING.md) for
budgets, errors and boundaries. The bundle includes a checksum-pinned raw WASM runtime; consumers
need no CDN, SDK URL or JavaScript wrapper. Vite automatically emits the module worker and WASM
asset. Other bundlers must support `new Worker(new URL(..., import.meta.url), { type: 'module' })`
and static asset URLs. Worker creation requires a CSP permitting the emitted same-origin worker and
WASM.

The published addon peers with the exact core version. Runtime/binary licenses are included in
[THIRD-PARTY-NOTICES](./THIRD-PARTY-NOTICES.md).
