# Checked consumer recipes

These ESM TypeScript modules use only public package imports. Copy the relevant files, including
relative helpers, into a Vite project. Core scenes need only `hilo3d`; optional recipes require the
matching addons. Files are typechecked through both Bundler and NodeNext and compiled/bundled
against actual packed checkout packages by `npm run test:package`. This verifies the checkout
contract, not every npm release or browser/device. See [versions](./VERSIONS.md).

Markdown snippets are synchronized from [recipe source](../test/types/recipes/); edit the
TypeScript, then run `npm run docs:sync`. Source-link and snippet checks reject drift.

## Lifecycle

Call `destroy()` when unmounting. A persisted navigation pauses ticking and keeps resources for the
return; normal teardown stops ticking before releasing controls, systems and Stage resources.

<!-- recipe: test/types/recipes/lifecycle.ts -->

```ts
import { type Stage, Ticker } from 'hilo3d';

export interface RunningScene {
    readonly stage: Stage;
    destroy(): void;
}

/** Own ticking, resize listeners and persisted-page navigation in one place. */
export function runScene(stage: Stage, resize: () => void, dispose?: () => void): RunningScene {
    const ticker = new Ticker(60);
    let destroyed = false;
    const onHide = (event: PageTransitionEvent): void => {
        if (event.persisted) ticker.stop();
        else destroy();
    };
    const onShow = (event: PageTransitionEvent): void => {
        if (event.persisted && !destroyed) {
            resize();
            ticker.start();
        }
    };
    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        ticker.stop();
        ticker.removeTick(stage);
        window.removeEventListener('resize', resize);
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('pageshow', onShow);
        try {
            dispose?.();
        } finally {
            stage.destroy();
        }
    }
    try {
        resize();
        ticker.addTick(stage);
        window.addEventListener('resize', resize);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('pageshow', onShow);
        ticker.start();
    } catch (error: unknown) {
        destroy();
        throw error;
    }
    return { stage, destroy };
}
```

<!-- /recipe -->

## 2D scene

The container must have a nonzero CSS size. The camera and Stage are resized together. To use 3D
instead, see [getting started](./GETTING_STARTED.md#first-3d-scene).

<!-- recipe: test/types/recipes/scene2d.ts -->

```ts
import { Camera2D, Stage, Text2D } from 'hilo3d';
import { runScene, type RunningScene } from './lifecycle.js';

export async function startScene2D(container: HTMLElement): Promise<RunningScene> {
    const camera = new Camera2D({ width: 640, height: 480 });
    const stage = await Stage.create({ backend: 'auto', container, camera });
    try {
        new Text2D({
            text: 'Hello Hilo3D',
            style: { font: '24px sans-serif', lineHeight: 32, fillStyle: '#1a2638' },
            x: 24,
            y: 24,
            anchorX: 0,
            anchorY: 0
        }).addTo(stage);
        return runScene(stage, () => {
            const width = Math.max(1, container.clientWidth);
            const height = Math.max(1, container.clientHeight);
            stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
            camera.resize(width, height);
        });
    } catch (error: unknown) {
        stage.destroy();
        throw error;
    }
}
```

<!-- /recipe -->

## Assets and animation

Load before starting rendering, then add the returned node to your Stage. Preserve the directory
structure for glTF assets with external buffers/images. This minimal helper assumes loading finishes
before application teardown; cancellable scene transitions must guard against late completion. For
complete clip/layer playback and ownership, see [animation](./ANIMATION_SYSTEM.md).

<!-- recipe: test/types/recipes/assets.ts -->

```ts
import { GLTFLoader, type Animation, type Node } from 'hilo3d';

/** Load before starting the ticker; the returned model owns the loaded scene/assets. */
export async function loadModel(url: string): Promise<Node> {
    const model = await new GLTFLoader().load({ src: url });
    await model.ready;
    return model.node;
}

/** Manual animation update runs before Stage rendering; do not also enroll automatic ticking. */
export function updateAnimation(animation: Animation, milliseconds: number): void {
    animation.update(Math.min(milliseconds, 50) / 1000);
}
```

<!-- /recipe -->

## Post-processing

Pass the selected factory to `Stage.create()` as `renderPipeline`. The exposure factory declares
WebGPU requirements. It cannot be used on explicit WebGL2. Effects and their histories are opt-in;
see [PBR/post-processing](./PBR_AND_POST_PROCESSING.md).

<!-- recipe: test/types/recipes/postprocessing.ts -->

```ts
import { PostProcessRenderPipelineFactory } from 'hilo3d';

/** Pass this factory as Stage.create({ renderPipeline: ... }); both backends are supported. */
export function portablePostProcessing(): PostProcessRenderPipelineFactory {
    return new PostProcessRenderPipelineFactory({
        bloom: { intensity: 0.8 },
        colorUber: { exposure: 0, toneMapping: 'filmic', filmicSlope: 1 }
    });
}

/** Auto exposure requires WebGPU; explicit WebGL2 creation must fail instead of emulating it. */
export function webGPUExposure(): PostProcessRenderPipelineFactory {
    return new PostProcessRenderPipelineFactory({
        autoExposure: {},
        bloom: { intensity: 0.8 },
        colorUber: { exposure: 0, toneMapping: 'filmic' }
    });
}
```

<!-- /recipe -->

## Optional addons

Install the addon version matching your exact `hilo3d` version; each addon declares an exact core
peer. For example, with the alpha.8 release:

```sh
npm install --save-exact hilo3d@2.0.0-alpha.8 @hilo/addon-particle@2.0.0-alpha.8
# Only for 3D physics:
npm install --save-exact @hilo/addon-physics@2.0.0-alpha.8 @dimforge/rapier3d-compat@0.20.0
```

Rapier's declarations use explicit resource-management symbols. Keep strict checking enabled and
include `ESNext.Disposable` in the consumer TypeScript `compilerOptions.lib`, alongside `ES2022`,
`DOM` and `DOM.Iterable`; this is a type-library requirement, not a request to suppress dependency
errors or to use disposal syntax in the application.

These creation helpers return an unticked Stage. Use the lifecycle helper with camera resize logic;
the Stage owns the installed System. The particle recipe selects portable CPU simulation explicitly.
The physics recipe creates one falling body; add a fixed ground collider when a floor is required.
Use the independent `/rapier2d` adapter and its peer for 2D; do not load both dimensions
accidentally.

<!-- recipe: test/types/recipes/particles.ts -->

```ts
import { PerspectiveCamera, Stage } from 'hilo3d';
import {
    PARTICLE_STAGE_SERVICE,
    ParticleSystemDefinition,
    createParticleStageSystem
} from '@hilo/addon-particle';

/** The caller starts ticking and owns Stage.destroy(); the Stage System owns its particles. */
export async function createParticleScene(container: HTMLElement): Promise<Stage> {
    const stage = await Stage.create({
        backend: 'auto',
        container,
        camera: new PerspectiveCamera({ z: 6 }),
        systems: [createParticleStageSystem()]
    });
    try {
        const definition = ParticleSystemDefinition.create({
            emitters: [
                {
                    name: 'spark',
                    capacity: 256,
                    execution: 'cpu',
                    emission: { rateOverTime: 40 },
                    initialize: { lifetime: 0.8, speed: 3, size: 0.05 },
                    renderers: [{ type: 'sprite', blend: 'additive' }]
                }
            ]
        });
        stage.systems.get(PARTICLE_STAGE_SERVICE).createSystem({ definition, seed: 42 });
        return stage;
    } catch (error: unknown) {
        stage.destroy();
        throw error;
    }
}
```

<!-- /recipe -->

<!-- recipe: test/types/recipes/physics.ts -->

```ts
import { PerspectiveCamera, Stage, type Mesh } from 'hilo3d';
import {
    PHYSICS_WORLD_3D_SERVICE,
    bindNode3D,
    createRapier3DPhysicsSystem
} from '@hilo/addon-physics/rapier3d';

/** Use an unscaled, unpivoted mesh. Stage ticking steps physics; do not step it a second time. */
export async function createPhysicsScene(container: HTMLElement, mesh: Mesh): Promise<Stage> {
    const stage = await Stage.create({
        backend: 'auto',
        container,
        camera: new PerspectiveCamera({ z: 8 }),
        systems: [
            createRapier3DPhysicsSystem({
                gravity: { x: 0, y: -9.81, z: 0 },
                fixedTimeStep: 1 / 60,
                maxSubSteps: 4
            })
        ]
    });
    try {
        stage.addChild(mesh);
        const world = stage.systems.get(PHYSICS_WORLD_3D_SERVICE);
        const body = world.createRigidBody({ type: 'dynamic', position: { x: 0, y: 4, z: 0 } });
        world.createCollider({ shape: { type: 'ball', radius: 0.5 }, density: 1 }, body);
        bindNode3D(world, body, mesh);
        return stage;
    } catch (error: unknown) {
        stage.destroy();
        throw error;
    }
}
```

<!-- /recipe -->
