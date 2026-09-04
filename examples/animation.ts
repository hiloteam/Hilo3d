import {
    AnimationClip,
    Animator,
    BasicMaterial,
    BoxGeometry,
    LazyTexture,
    createAnimationSystem
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime([createAnimationSystem()]);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 4.5, 0.55, 1.15);
const box = createMeshEntity(runtime.world, {
    geometry: new BoxGeometry(),
    material: new BasicMaterial({
        diffuse: new LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    })
});
const player = runtime.world.createEntity();
runtime.world.add(player, Animator, {
    clip: new AnimationClip('texture-box-orbit', [
        {
            target: box,
            property: 'translation',
            times: new Float32Array([0, 0.5, 1, 1.5, 2.5]),
            values: new Float32Array([1, 1, 0, 0.4, -0.5, 0.3, -0.4, -0.5, 0.3, -1, 1, 0, 1, 1, 0]),
            width: 3
        },
        {
            target: box,
            property: 'scale',
            times: new Float32Array([0, 0.8, 1.6, 2.5]),
            values: new Float32Array([0.5, 1, 1, 1, 0.5, 1, 0.5, 1, 1, 1, 0.5, 1]),
            width: 3
        }
    ]),
    playing: true,
    loop: true
});
runtime.start();
