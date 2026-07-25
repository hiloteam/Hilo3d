# Rendering and performance

## Contents

- [Backend policy](#backend-policy)
- [Compose 3D and 2D in one Stage](#compose-3d-and-2d-in-one-stage)
- [Control draw calls](#control-draw-calls)
- [Manage transparency](#manage-transparency)
- [Use render targets and post-processing only when needed](#use-render-targets-and-post-processing-only-when-needed)
- [Portable custom shaders](#portable-custom-shaders)
- [WebGPU-only compute](#webgpu-only-compute)
- [Texture and asset performance](#texture-and-asset-performance)
- [Diagnose rendering problems](#diagnose-rendering-problems)

## Backend policy

Default to:

```ts
backend: 'auto';
```

`auto` probes WebGPU capability first and selects WebGL2 when unavailable. Once WebGPU is selected,
later initialization, shader, pipeline, or resource errors remain visible; they are not fallback
signals.

Use explicit `webgpu` when the feature genuinely requires compute, storage resources, indirect
drawing, or another WebGPU-only capability. Use explicit `webgl2` for compatibility testing or
WebGL2-only canvas behavior.

For a development query:

```ts
function backendFromUrl(): Hilo3d.StageBackend {
    const backend = new URL(location.href).searchParams.get('backend');
    return backend === 'webgpu' || backend === 'webgl2' ? backend : 'auto';
}
```

## Compose 3D and 2D in one Stage

Use layers and camera priorities:

```ts
const WORLD_LAYER = 1;
const worldCamera = new Hilo3d.PerspectiveCamera({
    aspect: width / height,
    visibility: WORLD_LAYER,
    priority: 0,
    clearColor: true,
    z: 6
});
const uiCamera = new Hilo3d.Camera2D({
    width,
    height,
    visibility: Hilo3d.DEFAULT_2D_LAYER,
    priority: 100,
    clearColor: false
});

const stage = await Hilo3d.Stage.create({
    cameras: [worldCamera, uiCamera],
    width,
    height
});
```

The collection predicate is:

```ts
(camera.visibility & node.layer) !== 0;
```

Normal 3D nodes default to layer bit 0 (`1`). Sprites and Text2D default to bit 1
(`DEFAULT_2D_LAYER`). Set lights to the world layer so the UI is not considered part of 3D lighting.

Later cameras normally clear depth/stencil while loading prior color. Preserve prior depth only when
a real effect needs it; multi-camera preservation can force single-sample attachments.

## Control draw calls

Prioritize:

1. reuse geometry and material identity;
2. atlas 2D art;
3. use instancing for repeated meshes or sprites;
4. reduce material variants and transparency layers;
5. keep lights and shadow casters bounded;
6. cull or pool offscreen and inactive entities;
7. update existing typed arrays and objects.

Do not create new `Color`, `Vector`, arrays, descriptors, materials, or geometries inside per-frame
loops without a measured reason.

Track steady-state behavior with:

```ts
const info = stage.renderer.renderInfo;
const diagnostics = stage.renderer.resourceManager.getDiagnostics(stage);
console.log(info, diagnostics);
```

Use diagnostics during development, not as a per-frame production HUD.

## Manage transparency

Transparent objects require ordering and often cost overdraw. Prefer:

- opaque rendering when possible;
- alpha cutoff for hard-edged sprites, leaves, and fences;
- fewer large transparent layers;
- explicit `renderOrder` for semantic UI layers;
- premultiplied alpha textures and matching material policy.

Do not use `renderOrder` to hide incorrect depth or blend configuration.

## Use render targets and post-processing only when needed

For offscreen rendering:

```ts
const target = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height
});
renderer.renderToTarget(target, scene, camera);
```

Resize persistent targets with the viewport and call `target.destroy()` during teardown. Compose
multiple renderer operations inside `renderer.renderFrame(...)` when they belong to one application
frame.

Stay with the default Stage path for ordinary games. Custom render pipelines, readback, multiple
targets, and post-processing add lifecycle and validation responsibilities.

## Portable custom shaders

Portable raster shader source is GLSL ES 3.00. Use:

- `in`/`out`;
- `texture()`;
- explicit fragment outputs;
- std140 uniform blocks for numeric data;
- samplers outside blocks.

Do not add hand-authored parallel WGSL for portable raster effects. WebGPU translation is handled by
Hilo3D.

Use `ShaderMaterial` for deliberate custom effects. Prefer built-in PBR or Basic materials for
common surface work so batching, shadows, semantics, and backend parity remain reliable.

## WebGPU-only compute

`ComputeShader`, `ComputeKernel`, storage buffers, compute passes, storage-aware raster, and
GPU-driven draws are advanced WebGPU-only features. Before choosing them:

- prove a CPU or portable raster solution is insufficient;
- request `backend: 'webgpu'` or explicit required features;
- provide a clear unsupported-device result;
- keep gameplay correctness independent from decorative compute when possible;
- validate on real WebGPU, not only type checks.

Do not simulate missing WebGPU compute through an unrelated hidden fallback and call it equivalent.

## Texture and asset performance

- Use power-of-two atlases when mipmapping and repeat behavior benefit from them.
- Set filters and wrapping intentionally.
- Use `premultiplyAlpha: true` for compatible translucent sprite art.
- Cap large texture dimensions for mobile-class devices.
- Prefer glTF/GLB for 3D scene delivery.
- Load independent assets concurrently and release unused resources.
- Avoid changing texture dimensions or sources every frame.
- Use `Text2D` for low-frequency label changes, not per-particle text.

## Diagnose rendering problems

When the canvas is blank:

1. await Stage creation and asset readiness;
2. inspect console errors instead of swallowing them;
3. verify camera position, near/far planes, and object scale;
4. confirm `(camera.visibility & node.layer) !== 0`;
5. confirm a material and geometry exist;
6. add ambient plus directional light for PBR;
7. test a known unlit BasicMaterial;
8. inspect backend selection and renderer diagnostics;
9. test explicit WebGL2 and WebGPU separately.

When picking fails:

1. enable the exact DOM event;
2. verify `pointerEnabled`;
3. verify camera layer visibility;
4. update Stage DOM viewport after layout changes;
5. confirm no higher-priority camera intercepts the hit.

When performance degrades:

1. compare draw and resource counts before and after;
2. look for per-frame allocations or resource creation;
3. count unique materials and textures;
4. inspect transparency and shadow passes;
5. check device pixel ratio and canvas size;
6. profile CPU simulation separately from GPU rendering.
