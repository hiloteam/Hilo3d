# Game architecture

## Contents

- [Organize by ownership](#organize-by-ownership)
- [Scale the module layout with complexity](#scale-the-module-layout-with-complexity)
- [Keep render objects disposable](#keep-render-objects-disposable)
- [Model game states explicitly](#model-game-states-explicitly)
- [Use one scheduler](#use-one-scheduler)
- [Record input state](#record-input-state)
- [Centralize asset identity](#centralize-asset-identity)
- [Choose camera and UI boundaries early](#choose-camera-and-ui-boundaries-early)
- [Keep collision appropriate to the game](#keep-collision-appropriate-to-the-game)
- [Load before play](#load-before-play)
- [Resize deliberately](#resize-deliberately)
- [Pause correctly](#pause-correctly)
- [Tear down completely](#tear-down-completely)
- [Test gameplay logic separately](#test-gameplay-logic-separately)

## Organize by ownership

Keep four boundaries:

1. **Input** records buttons, axes, pointer positions, and one-shot actions.
2. **Simulation** owns authoritative game state, movement, collision, score, and rules.
3. **Presentation** maps state to Hilo3D nodes, materials, text, particles, and cameras.
4. **Lifecycle** owns loading, start/pause/resume/restart, resize, listeners, and teardown.

For a prototype, these may be classes in one file. Split them once each boundary has independent
state or tests.

## Scale the module layout with complexity

Keep a small vertical slice compact. When rules, view state, content, or UI become independently
testable, prefer an ownership-based split:

```text
src/
  game/
    simulation/
      state.ts
      systems/
      rules/
    content/
    input/
      actions.ts
      bindings.ts
    assets/
      manifest.ts
  hilo/
    stage/
    view/
      entities/
      fx/
      camera/
    adapters/
      stageBridge.ts
  ui/
    hud/
    menus/
    overlays/
  main.ts
```

Keep `game/` free of DOM and GPU dependencies where practical. Let `hilo/` adapt game snapshots to
nodes and convert picked or browser input into game actions. Use `ui/` for either DOM surfaces or
Hilo3D HUD composition; keep the ownership explicit when both exist.

## Keep render objects disposable

Treat Hilo3D nodes, materials, animations, tweens, emitters, camera rigs, and DOM elements as
presentation state. The simulation must not require one of them to stay alive. Use one adapter
boundary where presentation reads simulation state and input emits actions back.

Derive animation playback, hit effects, camera shake, and labels from authoritative game events or
state. Do not create a second state machine from sprite flags, tween completion, or scene-graph
lifetime. View objects may cache the last presented value to avoid redundant GPU or Canvas work, but
that cache is not saveable game state.

## Model game states explicitly

Use a union instead of scattered booleans:

```ts
type GameState = 'loading' | 'ready' | 'playing' | 'paused' | 'won' | 'lost';
```

Centralize transitions:

```ts
function setState(next: GameState): void {
    state = next;
    pauseLabel.visible = next === 'paused';
}
```

Restart by resetting state and existing objects. Do not reload the page or create a second Stage.

## Use one scheduler

Register tickables in dependency order:

```ts
const ticker = new Hilo3d.Ticker(60);
ticker.addTick(inputSystem);
ticker.addTick(simulation);
ticker.addTick(presentation);
ticker.addTick(Hilo3d.Tween);
ticker.addTick(Hilo3d.Animation);
ticker.addTick(stage);
```

`dt` is milliseconds. Clamp it:

```ts
tick(dt: number): void {
    const seconds = Math.min(dt, 50) / 1000;
    player.x += velocityX * seconds;
}
```

For physics or deterministic rules, use a fixed-step accumulator:

```ts
const STEP = 1 / 60;
let accumulator = 0;

function update(dtMilliseconds: number): void {
    accumulator = Math.min(accumulator + dtMilliseconds / 1000, 0.25);
    while (accumulator >= STEP) {
        simulate(STEP);
        accumulator -= STEP;
    }
}
```

Render once after the fixed steps. Do not tie game speed to the monitor refresh rate.

## Record input state

Use DOM listeners to record input, not to mutate the world in unrelated callbacks:

```ts
const keys = new Set<string>();

const onKeyDown = (event: KeyboardEvent): void => {
    keys.add(event.code);
};
const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
};

window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);
```

Read `keys` in the simulation tick. Use `event.code` for physical controls. Prevent browser
scrolling only for keys the focused game actually consumes.

For Hilo3D object picking:

```ts
button.on('click', () => activate());
stage.enableDOMEvent('click');
```

For drag controls enable `pointerdown`, `pointermove`, `pointerup`, and `pointercancel`. Capture
only the information the simulation needs. Disable unused event types to avoid unnecessary picking.

`StagePointerEvent.stageX` and `stageY` are logical Stage pixels. They map directly to the default
top-left `Camera2D` layout. Narrow the event before reading them:

```ts
sprite.on('pointerdown', event => {
    if (
        'stageX' in event &&
        typeof event.stageX === 'number' &&
        'stageY' in event &&
        typeof event.stageY === 'number'
    ) {
        dragTarget.set(event.stageX, event.stageY);
    }
});
```

For a 3D surface, use `event.hitPoint` from a picked Mesh or
`stage.getMeshResultAtPoint(stageX, stageY, true)`. A screen coordinate alone does not identify a
unique 3D world position; intersect the camera ray with the intended plane or collision geometry.

## Centralize asset identity

Use stable, human-readable manifest keys instead of embedding file paths throughout gameplay and
presentation code:

```ts
export const assets = {
    playerAtlas: new URL('../../assets/characters/player.png', import.meta.url).href,
    level: new URL('../../assets/environment/level.glb', import.meta.url).href,
    click: new URL('../../assets/audio/click.ogg', import.meta.url).href
} as const;
```

Organize shipped assets by purpose, for example `characters/`, `environment/`, `ui/`, `fx/`,
`audio/`, `data/`, and `models/`. Keep gameplay code dependent on semantic keys or loaded resource
handles, not deployment paths. Validate duplicate keys and required asset failures at the loading
boundary.

## Choose camera and UI boundaries early

Choose a camera contract before building movement and interaction:

- 2D: locked, follow, room-based, or tactical-pan;
- 3D: follow, orbit, first-person, or scripted;
- hybrid: a world camera plus one or more higher-priority `Camera2D` layers.

Keep camera logic in presentation. Simulation may expose a focus target, facing, room, or event, but
must not depend on camera interpolation or shake. Use `OrbitControls` for perspective-camera orbit,
dolly, and pan instead of adding local pointer, wheel, or touch gesture handlers.

Use Hilo3D `Sprite`, `Text2D`, `SlicedSprite`, and `UiButton` for low-density HUD and effects that
must share camera, layer, picking, or render composition. Use DOM overlays for dense text,
responsive menus, forms, settings, and accessible navigation. Keep secondary panels from covering
the active playfield and give canvas and DOM input one explicit focus policy.

## Keep collision appropriate to the game

- 2D arcade: axis-aligned boxes, circles, grids, or spatial hashes.
- Simple 3D: spheres, AABBs, rays, and Hilo3D picking.
- Dynamic rigid bodies: integrate a physics library such as `cannon-es`.

Separate collision shape from render geometry. Approximate complex art with stable simple shapes.
Use layer or category masks to skip impossible pairs.

## Load before play

Represent asset loading as a state. Load independent assets concurrently:

```ts
const [playerTexture, levelModel] = await Promise.all([
    new Hilo3d.TextureLoader().load({ src: playerUrl, flipY: true }),
    new Hilo3d.GLTFLoader().load({ src: levelUrl })
]);
await levelModel.ready;
```

Surface meaningful errors. A missing required player or level asset should block play. Optional
cosmetics may use an intentional fallback.

Avoid third-party CDNs for runtime assets when a project can ship them locally.

## Resize deliberately

```ts
function resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
    perspectiveCamera.aspect = width / height;
    uiCamera.resize(width, height);
    layoutHud(width, height);
}
```

Register one resize listener and call it once after scene creation. Recalculate layout from logical
Stage dimensions, not backing-buffer pixels.

## Pause correctly

Choose one of two policies:

- Pause simulation but keep rendering menus and UI.
- Pause the ticker completely when nothing needs to animate.

For the first policy, leave Stage ticking and skip only gameplay simulation. Reset transient input
when focus is lost:

```ts
window.addEventListener('blur', () => {
    keys.clear();
    state = 'paused';
});
```

## Tear down completely

One owner should dispose the application:

```ts
function destroy(): void {
    ticker.stop();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', resize);
    stage.destroy();
}
```

`stage.destroy()` disables DOM event types registered through `stage.enableDOMEvent(...)`, clears
Hilo3D node listeners in the Stage tree, destroys the renderer, and releases owned rendering
resources. The application must still remove listeners it registered directly on `window`,
`document`, the canvas, audio objects, gamepads, or other external owners. Do not destroy textures
or materials still shared by live objects.

## Test gameplay logic separately

Keep simulation functions free of DOM and GPU dependencies where practical. Unit-test:

- movement and clamping;
- collision and damage;
- scoring and state transitions;
- fixed-step behavior;
- restart determinism.

Integration-test as required by the containing project:

- asset loading and first frame;
- input routing and picking;
- backend selection;
- resize and device pixel ratio;
- pause/resume after focus loss;
- backend parity when it is in scope.
