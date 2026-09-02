# ECS 2D games

Use `OrthographicCamera`, `SpriteRenderer`, `SpriteAnimation`, `CanvasText`, `RenderOrder`, and
`LocalTransform`. Install the Systems required by authored data:

```ts
const world = await Hilo3d.World.create({
    systems: [
        Hilo3d.createCanvasTextSystem(),
        Hilo3d.createSpriteAnimationSystem(),
        Hilo3d.createInteractionSystem(),
        Hilo3d.createTransformSystem(),
        Hilo3d.createRenderExtractionSystem()
    ]
});
```

Create sprite resources once, then compose an Entity:

```ts
const sprite = world.createEntity();
world.add(sprite, Hilo3d.LocalTransform, { position: [120, 80, 0] });
world.add(
    sprite,
    Hilo3d.SpriteRenderer,
    Hilo3d.createSpriteRenderer({ frame, width: 64, height: 64, anchorX: 0.5, anchorY: 0.5 })
);
world.add(sprite, Hilo3d.RenderOrder, { sortingLayer: 10, zIndex: 2 });
world.add(sprite, Hilo3d.PointerTarget, { propagation: 'ancestors' });
```

Sorting is explicit component data, independent of transform hierarchy and camera layer masks.
Sprite frame changes should go through `SpriteAnimation` or update `SpriteRenderer`; do not rebuild
Geometry every frame.

Pointer inputs are queued into `InteractionRuntime`. A delivered event contains target and
current-target Entity handles plus a propagation flag; the engine does not allocate a listener
container for every Entity.

For responsive HUD, resize Engine and replace the orthographic camera component. Keep dense text,
menus, and accessibility UI in DOM overlays unless scene-space rendering is required.
