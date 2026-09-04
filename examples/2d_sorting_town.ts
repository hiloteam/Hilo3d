import {
    LocalTransform,
    RenderOrder,
    SpriteAnimation,
    createCanvasTextSystem,
    createSpriteAnimationSystem
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import {
    createGridFrames,
    createSpriteEntity,
    createTextEntity,
    loadExampleTexture
} from './shared/twoD';

const runtime = await createExampleRuntime([
    createCanvasTextSystem(),
    createSpriteAnimationSystem()
]);
runtime.engine.renderer.clearColor.set(0.03, 0.07, 0.1, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 5, 0, Math.PI / 2);
const [ground, objects, courierTexture] = await Promise.all([
    loadExampleTexture(new URL('./image/2d/sorting-town-ground.png', import.meta.url).href),
    loadExampleTexture(new URL('./image/2d/sorting-town-objects.png', import.meta.url).href),
    loadExampleTexture(new URL('./image/2d/sorting-town-courier.png', import.meta.url).href)
]);
createSpriteEntity(
    runtime.world,
    { texture: ground, width: 6.7, height: 4 },
    { position: [0, 0, -2] },
    -100
);
const objectFrames = createGridFrames(objects, 3, 2);
for (let index = 0; index < 30; index += 1) {
    const frame = objectFrames[index % objectFrames.length];
    if (!frame) continue;
    const x = ((index * 37) % 100) / 18 - 2.75;
    const y = ((index * 61) % 100) / 42 - 1.15;
    createSpriteEntity(
        runtime.world,
        { frame, width: 0.55, height: 0.55, anchorY: 0.9 },
        { position: [x, y, 0] },
        Math.round((1.6 - y) * 100)
    );
}
const courierFrames = createGridFrames(courierTexture, 4, 4);
const initialCourierFrame = courierFrames[0];
if (!initialCourierFrame) throw new Error('Courier atlas is incomplete.');
const courier = createSpriteEntity(
    runtime.world,
    { frame: initialCourierFrame, width: 0.72, height: 0.72, anchorY: 0.85 },
    { position: [-2.5, -0.9, 0.2] },
    250
);
runtime.world.add(courier, SpriteAnimation, { frames: courierFrames, frameRate: 10, loop: true });
createTextEntity(
    runtime.world,
    {
        text: 'SORTING TOWN • ECS Z-ORDER',
        font: '800 26px ui-monospace',
        fillStyle: '#fff0bd',
        padding: 7,
        resolution: 2
    },
    { position: [0, 1.55, 0.5], scale: [0.004, 0.004, 0.004] }
);
runtime.start(time => {
    const cycle = (time * 0.55) % 1;
    const x = -2.5 + cycle * 5;
    const y = -0.9 + Math.sin(cycle * Math.PI * 2) * 0.75;
    runtime.world.set(courier, LocalTransform, { position: [x, y, 0.2] });
    runtime.world.set(courier, RenderOrder, { sortingLayer: Math.round((1.6 - y) * 100) });
});
