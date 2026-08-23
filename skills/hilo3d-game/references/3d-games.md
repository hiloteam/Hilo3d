# Build 3D games

## Contents

- [Create a world with visible scale](#create-a-world-with-visible-scale)
- [Reuse geometry and materials](#reuse-geometry-and-materials)
- [Choose materials intentionally](#choose-materials-intentionally)
- [Add shadows sparingly](#add-shadows-sparingly)
- [Load glTF assets](#load-gltf-assets)
- [Drive character and camera movement](#drive-character-and-camera-movement)
- [Use picking for world interaction](#use-picking-for-world-interaction)
- [Integrate physics with cannon-es](#integrate-physics-with-cannon-es)
- [Design a complete 3D vertical slice](#design-a-complete-3d-vertical-slice)

## Create a world with visible scale

Start with a camera, at least one lit object, ambient fill, and a key light:

```ts
const camera = new Hilo3d.PerspectiveCamera({
    fov: 50,
    aspect: width / height,
    near: 0.1,
    far: 200,
    z: 7
});

const stage = await Hilo3d.Stage.create({
    backend: 'auto',
    container,
    camera,
    width,
    height,
    antialias: true,
    clearColor: new Hilo3d.Color(0.025, 0.035, 0.075)
});

new Hilo3d.AmbientLight({
    color: new Hilo3d.Color(0.45, 0.55, 0.8),
    amount: 0.65
}).addTo(stage);

new Hilo3d.DirectionalLight({
    color: new Hilo3d.Color(1, 0.9, 0.72),
    amount: 4,
    direction: new Hilo3d.Vector3(-1, -1.2, -0.6)
}).addTo(stage);
```

Use consistent world units. A practical default is one unit per meter for physics and character
movement.

## Reuse geometry and materials

```ts
const obstacleGeometry = new Hilo3d.BoxGeometry({ width: 1, height: 1, depth: 1 });
const obstacleMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.15, 0.6, 0.95),
    metallic: 0.15,
    roughness: 0.5
});

for (const position of obstaclePositions) {
    new Hilo3d.Mesh({
        geometry: obstacleGeometry,
        material: obstacleMaterial,
        x: position.x,
        y: position.y,
        z: position.z
    }).addTo(stage);
}
```

Set `useInstanced: true` when many meshes share geometry and material and do not require independent
render state. Keep a conservative object count before adding occlusion or elaborate level streaming.

## Choose materials intentionally

Use `PBRMaterial` for:

- glTF-aligned assets;
- metal, plastic, stone, wood, painted surfaces;
- image-based lighting and physically meaningful roughness.

Use `BasicMaterial` with `lightType: 'NONE'` for:

- debug shapes;
- flat collectibles and effects;
- stylized unlit surfaces;
- UI-like 3D markers.

Avoid using transparency when alpha cutout is sufficient. For foliage or fences, construct the
material with `coverage: { mode: 'mask', cutoff: 0.5 }` so depth writing and sorting remain stable.
For real transparency, use `compositing: { mode: 'alpha-blend', premultiplied: true }` and set
`Mesh.renderOrder` only when depth sorting is insufficient. Coverage, compositing, culling, and
other topology choices are immutable; construct a new material when one changes.

## Add shadows sparingly

```ts
const sun = new Hilo3d.DirectionalLight({
    amount: 4,
    direction: new Hilo3d.Vector3(-1, -1, -0.5),
    shadow: {
        width: 1024,
        height: 1024,
        minBias: 0.0005,
        maxBias: 0.003
    }
});
```

Enable `castShadows` and `receiveShadows` only on relevant `Mesh` objects. One high-quality key
shadow usually gives better performance and visual consistency than many shadow-casting lights.

## Load glTF assets

```ts
const loader = new Hilo3d.GLTFLoader();
const model = await loader.load({
    src: new URL('./assets/level.glb', import.meta.url).href
});
await model.ready;

model.node.setScale(1);
model.node.addTo(stage);
model.anim?.play();
```

Treat `model.ready` as part of required asset readiness. Inspect `model.resourceErrors` when using
optional error-tolerant loading.

Prefer `.glb` for a single deployable asset and standard glTF PBR textures. Compress textures only
when target backend/device support is considered. Keep a fallback for required content.

Use `model.bounds` or `model.node.getBounds()` to frame imported content. Do not assume authoring
units or object origin.

## Drive character and camera movement

Convert input to an intent vector, normalize diagonals, then multiply by units per second:

```ts
const move = new Hilo3d.Vector3();

function updatePlayer(dtMilliseconds: number): void {
    const dt = Math.min(dtMilliseconds, 50) / 1000;
    move.set(
        Number(keys.has('KeyD')) - Number(keys.has('KeyA')),
        0,
        Number(keys.has('KeyS')) - Number(keys.has('KeyW'))
    );
    if (move.length() > 0) move.normalize();
    player.x += move.x * PLAYER_SPEED * dt;
    player.z += move.z * PLAYER_SPEED * dt;
}
```

Use an explicit camera rig:

```ts
const cameraRig = new Hilo3d.Node().addTo(stage);
camera.addTo(cameraRig);
```

For player-controlled orbit, dolly, and pan, use the public controls instead of implementing local
pointer, wheel, and touch gestures:

```ts
const controls = new Hilo3d.OrbitControls(stage, {
    camera,
    target: new Hilo3d.Vector3(0, 1, 0),
    minDistance: 2,
    maxDistance: 12
});
```

Use `controls.setView(position, target)` for scripted tours that should retain the same orbit
contract. Call `controls.dispose()` during application teardown.

For follow cameras, smooth toward a target position with a frame-rate-independent factor:

```ts
const blend = 1 - Math.exp(-8 * dtSeconds);
cameraRig.x += (player.x - cameraRig.x) * blend;
cameraRig.z += (player.z - cameraRig.z) * blend;
```

## Use picking for world interaction

Enable only needed events:

```ts
stage.enableDOMEvent('click');
interactable.on('click', event => {
    if (!('hitPoint' in event) || !(event.hitPoint instanceof Hilo3d.Vector3)) return;
    const point = event.hitPoint;
    select(interactable, point);
});
```

For aiming or editor-like tools, call `stage.getMeshResultAtPoint(x, y, true)` with Stage logical
coordinates. Use `Ray` and `Mesh.raycast()` for explicit ray tests.

## Integrate physics with cannon-es

Hilo3D does not hide physics behind render objects. Keep one mapping from Mesh to physics Body:

```ts
import * as CANNON from 'cannon-es';

const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.8, 0)
});

const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5))
});
world.addBody(body);
```

Fixed-step the world and copy transforms into the Mesh before Stage rendering:

```ts
world.step(1 / 60, Math.min(dtMilliseconds, 100) / 1000, 3);
mesh.position.set(body.position.x, body.position.y, body.position.z);
mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
```

Use simple collision shapes and remove bodies when entities despawn. Avoid allocating vectors in the
synchronization loop.

## Design a complete 3D vertical slice

Include:

- a controllable or automatically animated player object;
- obstacles, targets, or collectibles;
- camera movement;
- a win/loss or score condition;
- visible lighting and material response;
- collision or picking;
- a restart path;
- a 2D or DOM control hint.

The bundled `3d` starter uses only generated primitives, so it runs before art assets exist.
