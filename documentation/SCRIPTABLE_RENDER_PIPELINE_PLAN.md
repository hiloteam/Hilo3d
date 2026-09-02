# Scriptable Render Pipeline implementation record

Status: completed production contract

## Boundary

`Renderer.create({ renderPipeline })` installs one shared `RenderPipelineHost`. `Engine.create()`
passes the same option through while owning Canvas and presentation. Pipeline factories receive
validated capabilities before creating runtime objects.

Default Forward and scriptable pipelines both record into one `RenderGraphFrame`, then use the same
portable RHI, resource caches, shader compilation, submission, and recovery services. A scriptable
pipeline cannot introduce a backend-specific scene frontend or a second graph.

## Scene data

Pipeline scene input is a renderer-owned `RenderWorld` produced by ECS render extraction. Scene
passes consume dense renderer views, stable IDs, packed transforms/bounds, lights, cameras, and
explicit extensions. They do not discover application objects or traverse World hierarchy.

## Graph phases

- `setup`: declare transient, persistent, imported, history, output, and dependency edges.
- compile/validation: reject invalid descriptors or ordering before an RHI frame begins.
- `prepare`: build reusable pipelines, bindings, draw packets, and resources without commands.
- `execute`: emit graphics, compute, copy, readback, and presentation commands.

A graph failure rolls back frame-local revisions. Persistent and temporal resources commit only
after a valid submission. Destruction and replacement remain submission-aware.

## Passes and capabilities

The public pipeline surface includes scene, fullscreen, compute, GPU-driven, copy, and present
passes. WebGPU supports compute, storage buffers/textures, and indirect execution. WebGL 2 rejects
unsupported requirements before allocation; it does not emulate them.

Portable raster stays GLSL ES 3.00 -> engine preprocessing -> Naga -> WGSL. Direct WGSL belongs to
`ComputeShader`; constrained storage-aware raster uses `StorageGraphicsShader`.

## Validation

The maintained contracts cover:

- dependency/resource validation and graph culling;
- MRT, MSAA, depth, render targets, readback, and presentation;
- pipeline/resource preparation rollback;
- temporal history and recovery;
- WebGL 2 and WebGPU shader/pipeline execution;
- exact pass, draw, dispatch, upload, and lifecycle diagnostics.

See [Rendering architecture](./RENDERING_ARCHITECTURE.md) for the current end-to-end flow.
