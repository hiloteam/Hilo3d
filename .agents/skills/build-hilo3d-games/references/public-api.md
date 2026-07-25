# Hilo3D 2.0.0 public API

This is a task-oriented map, not a replacement for the installed declarations. When exact types
matter, inspect `node_modules/hilo3d/dist/Hilo3d.d.ts`.

## Contents

- [Imports and initialization](#imports-and-initialization)
- [Scene graph](#scene-graph)
- [Stage and cameras](#stage-and-cameras)
- [Loop and time](#loop-and-time)
- [Geometry](#geometry)
- [Materials](#materials)
- [Lights](#lights)
- [Textures and loaders](#textures-and-loaders)
- [2D](#2d)
- [Math](#math)
- [Renderer-level features](#renderer-level-features)

## Imports and initialization

Use the package root:

```ts
import * as Hilo3d from 'hilo3d';
```

The package is ESM-only. Create rendering entry points asynchronously:

```ts
const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    container,
    width,
    height,
    camera
});

const renderer = await Hilo3d.Renderer.create({
    backend: 'webgl2',
    domElement: canvas
});
```

Prefer `Stage` for games because it owns the scene root, cameras, renderer, DOM picking, update
traversal, resize, and teardown.

## Scene graph

`Node` is the base of scene objects.

Common constructor fields:

- identity and data: `name`, `userData`;
- transform: `x`, `y`, `z`, `scaleX/Y/Z`, `rotationX/Y/Z`, `pivotX/Y/Z`;
- behavior: `visible`, `layer`, `pointerEnabled`, `pointerChildren`, `useHandCursor`, `onUpdate`;
- hierarchy: `parent`.

Common methods:

```ts
parent.addChild(child);
parent.removeChild(child);
child.addTo(parent);
child.removeFromParent();
child.setPosition(x, y, z);
child.setScale(uniformScale);
child.setRotation(xDegrees, yDegrees, zDegrees);
child.lookAt(target);
child.on(type, listener);
child.off(type, listener);
```

Use `Node` containers to group transforms and game entities. Share render resources across many
`Mesh` or `Sprite` instances.

`Mesh` combines a `Geometry` and `Material`:

```ts
const mesh = new Hilo3d.Mesh({
    geometry,
    material,
    useInstanced: false,
    frustumTest: true,
    layer: 1
});
```

Destroy a standalone mesh with a renderer:

```ts
mesh.destroy(stage.renderer, true);
```

The second argument destroys its textures. Use it only when those textures are not shared.
Destroying the whole `Stage` is the normal application teardown.

## Stage and cameras

Useful Stage options include:

- `backend: 'auto' | 'webgl2' | 'webgpu'`;
- `container` or `canvas`;
- `camera` for one camera or `cameras` for a composition;
- `width`, `height`, `pixelRatio`;
- `clearColor`, `alpha`, `depth`, `stencil`, `antialias`;
- `useInstanced`, `useLogDepth`, `gameMode`.

Useful methods:

```ts
stage.tick(dtMilliseconds);
stage.resize(width, height, pixelRatio?);
stage.setCameras(cameras);
stage.addCamera(camera);
stage.removeCamera(camera);
stage.enableDOMEvent(['pointerdown', 'pointermove', 'pointerup']);
stage.getMeshResultAtPoint(x, y, true);
stage.releaseGPUResources();
stage.destroy();
```

Camera fields shared by 2D and 3D:

- `visibility`: layer bit mask;
- `priority`: lower values render first;
- `clearColor`, `clearDepth`, `clearStencil`.

Create 3D cameras with:

```ts
const camera = new Hilo3d.PerspectiveCamera({
    fov: 50,
    aspect: width / height,
    near: 0.1,
    far: 200,
    z: 6
});
```

Create pixel-space 2D cameras with:

```ts
const camera = new Hilo3d.Camera2D({
    width,
    height,
    priority: 100,
    visibility: Hilo3d.DEFAULT_2D_LAYER,
    clearColor: false
});
```

`Camera2D` uses a top-left origin, right-growing X, and down-growing Y. Call
`camera.resize(width, height)` after Stage resize.

## Loop and time

`Ticker` dispatches millisecond deltas:

```ts
const ticker = new Hilo3d.Ticker(60);
ticker.addTick(gameSimulation);
ticker.addTick(Hilo3d.Tween);
ticker.addTick(Hilo3d.Animation);
ticker.addTick(stage);
ticker.start();
```

Other useful methods are `removeTick`, `pause`, `resume`, `stop`, `nextTick`, `timeout`, and
`interval`. `pause()` suppresses callbacks without discarding the loop; `stop()` cancels it.

## Geometry

Built-in geometry:

```ts
new Hilo3d.BoxGeometry({ width: 1, height: 1, depth: 1 });
new Hilo3d.SphereGeometry({ radius: 0.5, widthSegments: 32, heightSegments: 16 });
new Hilo3d.PlaneGeometry({ width: 2, height: 2 });
```

Use `Geometry` and `GeometryData` for custom attributes and indices. Reuse one geometry for objects
with the same topology. Do not recreate geometry during animation.

## Materials

Use `PBRMaterial` for physically based 3D:

```ts
const material = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.2, 0.65, 1),
    metallic: 0.2,
    roughness: 0.55,
    castShadows: true,
    receiveShadows: true
});
```

Important PBR inputs include `baseColorMap`, `metallicRoughnessMap`, `normalMap`, `occlusionMap`,
`emission`, `emissionFactor`, `diffuseEnvMap`, `specularEnvMap`, `brdfLUT`, and clearcoat fields.

Use `BasicMaterial` for unlit, Lambert, Phong, or Blinn-Phong rendering:

```ts
new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    diffuse: new Hilo3d.Color(1, 0.4, 0.1),
    transparent: true
});
```

Material controls include `renderOrder`, `transparent`, `transparency`, `alphaCutoff`, `depthTest`,
`depthMask`, `cullFace`, `side`, `blend`, `castShadows`, and `receiveShadows`.

Use `ShaderMaterial` only when built-in materials cannot express the effect. Portable raster shaders
use GLSL ES 3.00 and registered std140 uniform blocks; classic numeric uniforms are not a portable
extension point.

## Lights

Common lights:

```ts
new Hilo3d.AmbientLight({ color, amount: 0.5 });
new Hilo3d.DirectionalLight({ color, amount: 3, direction });
new Hilo3d.PointLight({ color, amount: 5, range: 12 });
new Hilo3d.SpotLight({ color, amount: 8, range: 20 });
new Hilo3d.AreaLight({ color, amount: 2 });
```

Directional, point, and spot lights support shadow configuration. Shadows consume passes and texture
memory; add them selectively.

## Textures and loaders

Load an image as a texture:

```ts
const texture = await new Hilo3d.TextureLoader().load({
    src: new URL('./assets/player.png', import.meta.url).href,
    flipY: true
});
```

Or load the image and configure the texture explicitly:

```ts
const image = await new Hilo3d.BasicLoader().loadImg(url);
const texture = new Hilo3d.Texture({
    image,
    flipY: true,
    premultiplyAlpha: true,
    minFilter: Hilo3d.constants.webgl.LINEAR,
    magFilter: Hilo3d.constants.webgl.LINEAR
});
```

Other public loaders include `GLTFLoader`, `HDRLoader`, `KTXLoader`, `CubeTextureLoader`,
`LoadQueue`, and `Loader`.

Load glTF:

```ts
const model = await new Hilo3d.GLTFLoader().load({ src: modelUrl });
await model.ready;
model.node.addTo(stage);
model.anim?.play();
```

The result exposes `node`, `scene`, `meshes`, `cameras`, `lights`, `textures`, `materials`, optional
`anim` and `bounds`, `ready`, and `resourceErrors`.

## 2D

Core 2D types are `Camera2D`, `Sprite`, `SpriteFrame`, `SpriteMaterial`, and `Text2D`. See
[2D games](2d-games.md) for complete patterns.

## Math

Common public math types include `Color`, `Vector2`, `Vector3`, `Vector4`, `Euler`, `Quaternion`,
`Matrix3`, `Matrix4`, `Ray`, `Plane`, `Sphere`, and `Frustum`.

Reuse temporary math instances inside hot loops:

```ts
const velocity = new Hilo3d.Vector3();
const target = new Hilo3d.Vector3();
```

## Renderer-level features

The Stage exposes `stage.renderer`. Public renderer features include:

- `backend`, `renderInfo`, and `resourceManager.getDiagnostics(...)`;
- `renderFrame(...)` for application-owned multi-pass work;
- `createRenderTarget(...)` and `createStorageBuffer(...)`;
- `renderToTarget(...)`, `present(...)`, and `waitForIdle()`;
- checked native extensions through `getExtension(...)`;
- `releaseGPUResources()` and `destroy()`.

Stay at Stage/scene level unless the game genuinely needs render targets, post-processing, readback,
compute, storage buffers, or custom pipeline orchestration.
