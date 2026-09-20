# Compute, storage and GPU-driven rendering

Status: current public contract, reviewed against source commit `6433334c` on 2026-09-20. The
[original implementation plan](./archive/COMPUTE_STORAGE_IMPLEMENTATION_PLAN.md) preserves design
history. This capability uses the same shared renderer, SRP, Render Graph and portable RHI; it does
not expose native WebGPU objects or create a second renderer.

## Backend and shader boundaries

| Workload             | Authored source                                                          | Backend and validation                                                                                 |
| -------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Portable raster      | GLSL ES 3.00, std140 data, samplers                                      | WebGL2 compiles it; WebGPU uses engine preprocessing -> Vulkan GLSL 4.50 -> Naga -> WGSL.              |
| Compute              | Direct WGSL through `ComputeShader`                                      | WebGPU only; explicit bindings/workgroup contract and Naga WGSL validation before pipeline creation.   |
| Storage-aware raster | Constrained GLSL ES 3.10 readonly std430 through `StorageGraphicsShader` | WebGPU only; preprocessing -> Vulkan GLSL 4.50 -> Naga -> WGSL. No parallel hand-authored raster WGSL. |

`storage-buffer`, `storage-texture`, `compute-pass` and `indirect-draw` requirements exclude WebGL2
before runtime construction. Capabilities additionally depend on actual device formats and limits.
Unsupported requests fail clearly; there is no CPU, transform-feedback or fragment-compute
emulation. An `auto` request restricted to WebGPU by these requirements cannot fall back after
initialization fails. Optional `shader-f16`, `subgroups` and timestamp queries have their own
capability gates; they are not unconditional compute requirements.

## Public building blocks

| API                     | Responsibility                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `StorageLayout`         | WGSL host-shareable data layout, explicit sizes/alignment and typed packing.                    |
| `StorageBuffer`         | Renderer-owned storage, bounded partial writes, range bindings, readback and recovery recipe.   |
| `ComputeShader`         | Validated direct WGSL and declared binding/workgroup ABI.                                       |
| `ComputeKernel`         | Reusable compute pipeline configuration.                                                        |
| `ComputeRenderPass`     | Graph-declared inputs/outputs and direct or indirect dispatch.                                  |
| `StorageGraphicsShader` | Validated readonly storage graphics source and resources.                                       |
| `GPUDrivenRenderPass`   | Prepared graphics bindings and vertex/index input, direct/indirect procedural or indexed draws. |
| `SceneRenderPass`       | Shared scene list with optional pass-global readonly storage at group 3.                        |

Import public APIs from the `hilo3d` root. Exact types are in the installed declarations; repository
definitions are [StorageBuffer](../src/render/StorageBuffer.ts), [compute](../src/render/compute/),
[passes](../src/render/pipeline/passes/) and
[ScriptableRenderGraph](../src/render/pipeline/ScriptableRenderGraph.ts). The generic Scene
storage-shader replacement can expand instanced items into direct draws; ordinary high-end GPU Scene
uses its dedicated shared material/object databases instead.

## Graph access and resource lifetime

Declare buffer storage, vertex, index, copy, indirect, clear and read-write accesses during `setup`.
Ordinary separate read + write declarations do not stand in for explicit `readWriteBuffer()`.
Imported buffers must provide the usage superset required by all live passes. Sizes, offsets,
alignment, ranges, copy pairs and device limits are validated before beginning the RHI frame.

Texture views name mip/layer/aspect/dimension explicitly. Sampled, storage, attachment and copy
accesses participate in one hazard analysis. Same-pass sampled/attachment feedback is rejected; do
not silently copy a texture to conceal it. Persistent history currently has the constrained
single-sample, single-mip, single-layer 2D color recipe; broader views do not imply broader history
validity support.

```text
factory requirements -> backend selection -> runtime
  -> graph setup / validation
  -> prepare pipelines, layouts and bindings
  -> execute compute / raster / copies
  -> submission -> commit revisions and history
```

Preparation creates reusable objects without issuing commands. Execution uses explicit layouts and
the same command scope as scene rendering. Resources stay alive until their submission completes.
Staged CPU uploads and cache revisions commit only after a valid submission; failed frames retry
instead of marking data clean prematurely. Graph-transient native bindings have frame lifetime.

## Recovery and readback

- `cpu-shadow` resources rebuild from retained backend-neutral bytes after device loss.
- `reinitialize` resources rebuild through their initialization recipe; GPU-only state is not
  implicitly preserved by retaining the JavaScript object.
- An application needing resumable simulation must define explicit checkpoints. Asynchronous
  readback is deliberate work with bounded ownership, not a per-frame synchronization mechanism.
- Context/device generations invalidate native allocations and cached bindings. Public buffer and
  renderer identities remain stable where the resource contract promises it.
- Temporal resource rotation, GPU particle clocks and other staged state follow submission hooks,
  not attempted frame counts.

## Supported workflows and limits

The engine supports compute -> compute, compute -> graphics, raster/copy -> compute, buffer clear,
direct/indirect dispatch, direct/indirect draw, storage textures and readonly storage raster.
GPU-driven workloads keep active counts and indirect arguments resident on the GPU.

There is one command scope and queue. The API does not promise async-compute queues, user barriers,
hardware ray tracing, mesh shaders, bindless descriptor arrays, sparse residency or indirect-count
draws. Such future work needs explicit contracts rather than a native handle escape hatch.

Production consumers include [Clustered rendering](./MODERN_WEBGPU_RENDERING_ROADMAP.md),
[particles](./PARTICLE_SYSTEM.md), [auto exposure](./PBR_AND_POST_PROCESSING.md),
[atmosphere](./PHYSICAL_ATMOSPHERE_AND_WEATHER.md) and [DDGI](./DYNAMIC_GLOBAL_ILLUMINATION.md).
DDGI is currently an Unreleased source feature; consult [versions](./VERSIONS.md) before using it
with an npm tarball.

The [GPU-driven example](../examples/compute_gpu_driven.ts),
[specialized particles](../examples/compute_particles.ts) and
[path tracer](../examples/compute_raytracing.ts) exercise distinct workloads. The last two are
specialized compute showcases, not promises of an identical public simulation or real-time GI API.

## Validation and evidence

Changes require affected compute/storage/renderer tests, `test:render:architecture`, `test:rhi`,
`test:webgpu` and relevant browser lanes. Keep WebGL2 negative capability tests. API changes require
`api:update`, `api:check`, `test:types` and `test:package` as well as documentation/changelog
updates.

Actual physical-GPU execution and cross-commit performance enrollment are separate evidence. The
[RHI benchmark protocol](../benchmarks/rhi/README.md),
[DDGI candidate protocol](../benchmarks/ddgi/README.md) and [roadmap](./ROADMAP.md) describe their
limits. A passing local smoke or the existence of test code is not a release performance claim.
