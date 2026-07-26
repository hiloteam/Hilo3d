# Build 2D games

## Contents

- [Use the 2D coordinate contract](#use-the-2d-coordinate-contract)
- [Match anchors to the layout coordinate system](#match-anchors-to-the-layout-coordinate-system)
- [Build sprites from textures and atlas frames](#build-sprites-from-textures-and-atlas-frames)
- [Replace Sprite sources in place](#replace-sprite-sources-in-place)
- [Control display order](#control-display-order)
- [Preserve batching](#preserve-batching)
- [Use Text2D for dynamic labels](#use-text2d-for-dynamic-labels)
- [Build scalable panels and buttons](#build-scalable-panels-and-buttons)
- [Add pointer interaction](#add-pointer-interaction)
- [Use simple collision shapes](#use-simple-collision-shapes)
- [Compose a 2D background, 3D world, and HUD](#compose-a-2d-background-3d-world-and-hud)
- [Design a complete 2D vertical slice](#design-a-complete-2d-vertical-slice)

## Use the 2D coordinate contract

`Camera2D` projects logical game pixels with:

- origin at the top-left;
- positive X to the right;
- positive Y downward;
- default visibility `DEFAULT_2D_LAYER`;
- default priority `100`;
- color preserved from lower-priority cameras.

Create a 2D-only Stage:

```ts
const camera = new Hilo3d.Camera2D({ width, height });
const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    container,
    camera,
    width,
    height,
    useInstanced: true
});
```

On resize, update both:

```ts
stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
camera.resize(width, height);
```

## Match anchors to the layout coordinate system

> **Coordinate invariant:** never infer Sprite positioning from the Camera origin.

`Camera2D` has a top-left screen origin, but every `Sprite` and `Text2D` defaults to a centered
`anchorX: 0.5, anchorY: 0.5`. `sprite.x/y` is the anchor's position in the **parent node's local
coordinate system**; it is not the image's top-left corner. The anchor changes which point of the
visual sits at that local position. Parent translation, scale, and rotation then produce the world
position. Do not assume a top-left Camera also changes the Sprite anchor.

For UI coordinates measured from a mockup's left/top edge, make the contract explicit:

```ts
const panel = new Hilo3d.Sprite({
    texture: panelTexture,
    x: 24,
    y: 20,
    width: 360,
    height: 180,
    anchorX: 0,
    anchorY: 0
});
```

For centered game objects, retain the default anchor and position their center:

```ts
portrait.x = panelLeft + portrait.width * 0.5;
portrait.y = panelTop + portrait.height * 0.5;
```

Apply the same rule to cover backgrounds, panels, portraits, titles, and bottom/right-aligned HUD
items. Check every required responsive edge size: an anchor mismatch often clips exactly half of a
visual while arithmetic and hit boxes otherwise look plausible.

For nested UI, keep the same contract at every level:

```ts
const panel = new Hilo3d.Node({ x: 24, y: 20 }).addTo(stage);
const icon = new Hilo3d.Sprite({
    texture: iconTexture,
    x: 12,
    y: 12,
    anchorX: 0,
    anchorY: 0
}).addTo(panel);
```

Here the icon's top-left is `(12, 12)` in `panel` local space and `(36, 32)` in world space before
any parent scale or rotation. Do not feed DOM `clientX/clientY` directly into a nested Sprite; let
Stage/Camera picking perform screen-to-world conversion, then transform to local space when custom
drag logic needs it.

## Build sprites from textures and atlas frames

For a full texture:

```ts
const sprite = new Hilo3d.Sprite({
    texture,
    x: 200,
    y: 160,
    width: 64,
    height: 64,
    anchorX: 0.5,
    anchorY: 0.5,
    tint: new Hilo3d.Color(1, 1, 1, 1)
}).addTo(stage);
```

For an atlas:

```ts
const frames = [
    new Hilo3d.SpriteFrame({
        texture: atlas,
        x: 0,
        y: 0,
        width: 64,
        height: 64,
        duration: 90
    }),
    new Hilo3d.SpriteFrame({
        texture: atlas,
        x: 64,
        y: 0,
        width: 64,
        height: 64,
        duration: 90
    })
];

const player = new Hilo3d.Sprite({
    frames,
    frameRate: 12,
    loop: true,
    autoPlay: true
});
```

Control animation with `play()`, `pause()`, `stop()`, and `gotoFrame(index)`. Listen for
`framechange`, `loop`, and `complete` when game logic needs animation events.

Frame coordinates use top-left source pixels: X grows right and Y grows down. `Texture.flipY`
controls upload/sampling orientation and does not change this atlas-coordinate contract.
`SpriteFrame` accounts for that policy for both complete textures and atlas subframes; do not
manually invert atlas rows.

Define animation rows through semantic names (`up`, `down`, `left`, `right`) and map them from the
authored atlas contract. Do not let gameplay code depend on an image viewer's apparent row order:
texture orientation, authored facing direction, and atlas tooling can make a visually plausible
numeric row map point the character the wrong way.

## Replace Sprite sources in place

Do not mutate `sprite.material` to swap character skins. Use the public source APIs:

```ts
portrait.setTexture(texture, { resize: true });
portrait.setFrame(frame, { resize: true });
portrait.setFrames(walkFrames, { currentFrame: 0, autoPlay: false });
```

They update UVs, shared material selection, animation state, and optional logical size together
while preserving the Sprite node and its renderer-side instance arrays. A Sprite may also be
constructed from only `material: SpriteMaterial.forTexture(texture)`; the complete initial frame is
inferred from the material texture.

## Control display order

Every `Sprite` and `Text2D` uses the Node-level display key:

```text
sortingLayer -> zIndex -> stable scene-tree traversal order
```

Higher `sortingLayer` and `zIndex` values render later. Equal values keep the order established by
`addChild()`. Use `sortingLayer` for coarse groups such as background, world, and HUD, then use
`zIndex` within a group:

```ts
background.sortingLayer = 0;
player.sortingLayer = 10;
hud.sortingLayer = 100;
tooltip.sortingLayer = 100;
tooltip.zIndex = 20;
```

For top-down worlds, anchor each actor or prop at its ground-contact point and derive `zIndex` from
that foot/base Y coordinate. Update moving actors after movement; static scenery only needs the
value once:

```ts
building.anchorY = 1;
building.zIndex = Math.round(building.y);

player.anchorY = 1;
player.onUpdate = () => {
    player.zIndex = Math.round(player.y);
};
```

This keeps a character behind a building while north of its base and in front after walking south.
Do not sort by Sprite center or top edge: differently sized art will cross at visibly wrong points.
See `examples/2d_sorting_town.ts` for A* movement through an atlas-batched top-down scene.

`Node.layer` remains a Camera visibility bit mask and is unrelated to `sortingLayer`. Do not mutate
`SpriteMaterial.renderOrder` to position one Sprite: default materials are shared by texture, so a
material mutation can affect several Sprites. Pointer picking follows the same 2D display key and
selects the visually topmost overlapping node.

## Preserve batching

Default Sprites use one shared quad and opt into portable instancing. Sprites batch when they share
the same geometry and `SpriteMaterial` identity, are adjacent after display sorting, and fit within
the 128-instance portable limit. The default material cache shares a material per texture.

Do:

- place many frames on one atlas;
- let Sprites using the same texture use the default material;
- update transforms, tint, size, and UV frame in place;
- keep decorative non-interactive sprites `pointerEnabled: false`.

Avoid:

- one texture per tiny sprite;
- one custom material per sprite;
- rebuilding Geometry or Sprite every animation frame;
- changing material identity merely to change tint;
- thousands of dynamic `Text2D` labels.

Portable sprite draws are split at 128 instances. Large scenes can still batch efficiently across
multiple draws. Batching never changes display order: `A(atlas1), B(atlas2), C(atlas1)` remains
three draws because C cannot cross B to join A. Put related art on one atlas and keep same-layer
Sprites contiguous in the scene tree to recover large batches without visual-order bugs.

## Use Text2D for dynamic labels

```ts
const score = new Hilo3d.Text2D({
    text: '枫叶镇 Maple Post 的快递将在 18:30 前送达。',
    style: {
        font: '700 24px system-ui, sans-serif',
        fillStyle: '#ffffff',
        strokeStyle: '#10152b',
        strokeWidth: 4,
        padding: 6,
        maxWidth: 320,
        maxLines: 3,
        overflow: 'ellipsis',
        lineHeight: 32,
        paragraphSpacing: 8,
        letterSpacing: 0.5,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5
}).addTo(stage);

score.setText('SCORE 120');
score.setStyle({ fillStyle: '#ffe082' });
```

`Text2D` rerasterizes only after `setText()` or `setStyle()`. It preserves its Canvas, Texture,
material, and pipeline identity. Each label still owns a texture and draw item.

Use:

- `Text2D` for scores, timers, prompts, and low-frequency labels;
- a font atlas and normal Sprites for large amounts of mostly static glyphs;
- DOM for accessible forms, long text, and screen-reader navigation.

`maxWidth` wrapping uses Canvas glyph measurements rather than character counts. CJK characters are
valid break points, Latin words stay together when they fit, and oversized tokens fall back to
character breaks. Call `setStyle({ maxWidth })` from a resize handler to reflow responsive labels.

## Build scalable panels and buttons

Use `SlicedSprite` for atlas-backed frames that must resize without distorting corners:

```ts
const panel = new Hilo3d.SlicedSprite({
    frame: panelFrame,
    insets: { left: 24, right: 24, top: 20, bottom: 20 },
    width: 480,
    height: 260
});
```

Its nine child Sprites use one texture and stay adjacent, so they normally form one portable
instance batch. Use `UiButton` when the same skin has interaction states:

The source art must itself be nine-slice-safe:

- keep every corner ornament completely inside its fixed corner inset;
- make each stretchable edge segment continuous and uniform;
- keep emblems, clasps, notches, protrusions, and other unique details out of edge centers;
- use a flat, repeatable, or uniformly stretchable center;
- check at least one target size wider and one target size taller than the source frame.

Slicing an arbitrary ornate frame does not make it scalable. Details that cross a slice boundary or
sit inside a stretchable edge become elongated gaps and detached top/center/bottom bands.

```ts
const button = new Hilo3d.UiButton({
    frames: { up, hover, down, disabled },
    insets: { left: 24, right: 24, top: 20, bottom: 20 },
    width: 260,
    height: 72,
    label: 'START'
});
stage.enableDOMEvent(['pointermove', 'pointerdown', 'pointerup', 'click']);
```

State changes update the nine existing frames in place. Put all four states on one atlas so hover
and press transitions reuse shared Sprite materials and pipelines.

## Add pointer interaction

```ts
button.on('click', event => {
    if ('stopPropagation' in event && typeof event.stopPropagation === 'function') {
        event.stopPropagation();
    }
    activateButton();
});
stage.enableDOMEvent('click');
```

For drag:

```ts
stage.enableDOMEvent(['pointerdown', 'pointermove', 'pointerup', 'pointercancel']);
```

Sprites use their actual width, height, anchor, and world transform for CPU hit tests.
Higher-priority cameras receive pointer hits first. Layer filtering for picking matches rendering.

Set `useHandCursor: true` only for clickable objects. Disable picking on backgrounds and particle
decorations.

## Use simple collision shapes

For centered sprites:

```ts
function overlaps(a: Hilo3d.Sprite, b: Hilo3d.Sprite): boolean {
    return (
        Math.abs(a.x - b.x) * 2 < a.width * Math.abs(a.scaleX) + b.width * Math.abs(b.scaleX) &&
        Math.abs(a.y - b.y) * 2 < a.height * Math.abs(a.scaleY) + b.height * Math.abs(b.scaleY)
    );
}
```

Adjust for anchors if they differ from `0.5`. For many moving objects, use a uniform grid or spatial
hash instead of testing every pair.

## Compose a 2D background, 3D world, and HUD

Use distinct layer bits:

```ts
const WORLD_LAYER = 1;
const BACKGROUND_LAYER = 1 << 2;
const UI_LAYER = Hilo3d.DEFAULT_2D_LAYER;
```

Create cameras with increasing priorities. The background camera clears color, the world and UI
cameras normally preserve it. See [Rendering and performance](rendering-performance.md) for the full
hybrid pattern.

## Design a complete 2D vertical slice

Include:

- one controllable Sprite;
- one collectible, obstacle, target, or enemy;
- collision feedback;
- a Text2D score or state label;
- keyboard and pointer/touch controls;
- an explicit restart path;
- responsive layout;
- shared atlas resources.

The bundled `2d` starter demonstrates this without external assets by generating one Canvas atlas at
runtime.
