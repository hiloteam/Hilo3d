# Hilo3D 2D rendering

Status: current ECS contract

2D and 3D content share one World, Transform hierarchy, renderer extraction, Render Graph, and RHI.

## Components

- `SpriteRenderer`: Geometry, Material, UV rectangle, size/anchor, tint, and batching data.
- `SpriteAnimation`: frame sequence, frame rate, looping, and packed playback state.
- `CanvasText`: text/font/layout input whose System produces a sprite representation.
- `RenderOrder`: independent `sortingLayer`, `zIndex`, and render order.
- `RenderVisibility`: visibility and layer mask.
- `PointerTarget` / `PointerCapture`: hit identity, propagation, and capture policy.

A sprite Entity normally combines `LocalTransform + SpriteRenderer + RenderOrder`. No 2D class
hierarchy exists.

## Systems

`createSpriteAnimationSystem()` advances packed playback state and updates sprite UV data.
`createCanvasTextSystem()` maintains text resources and sprite output. `createInteractionSystem()`
consumes normalized pointer input, performs picking, resolves the Hierarchy ancestor chain, and
publishes capture/target delivery through `INTERACTION_RUNTIME`.

Render extraction converts sprite components to the same renderer-owned mesh records used by 3D.
Sprite batching respects material/texture identity and stable explicit order.

## Camera and coordinates

Camera Entities use `PerspectiveCamera` or `OrthographicCamera`, optional `CameraOutput`, and
`LocalTransform`. Multiple cameras are priority-sorted and recorded in one renderer submission.
Visibility masks are independent from Hierarchy.

Managed image and glyph textures use top-left logical UVs and `hiloTextureUV()`; render-target
inputs use `hiloRenderTargetUV()`. DOM pointer coordinates are normalized once before
InteractionSystem consumes them.

## Example

```ts
const sprite = world.createEntity();
world.add(sprite, LocalTransform, { position: [120, 80, 0] });
world.add(
    sprite,
    SpriteRenderer,
    createSpriteRenderer({
        geometry,
        material,
        size: [64, 64],
        anchor: [0.5, 0.5]
    })
);
world.add(sprite, RenderOrder, { sortingLayer: 2, zIndex: 10 });
world.add(sprite, PointerTarget, { enabled: true });
```

Automated coverage for animation, text, pointer propagation/capture, ordering, and backend parity is
under `test/spec/ecs/` and `test/ui/`.
