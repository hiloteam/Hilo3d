import {
    LocalTransform,
    SpriteAnimation,
    SpriteFrame,
    createCanvasTextSystem,
    createSpriteAnimationSystem
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createSpriteEntity, createTextEntity, loadExampleTexture } from './shared/twoD';

const runtime = await createExampleRuntime([
    createCanvasTextSystem(),
    createSpriteAnimationSystem()
]);
runtime.engine.renderer.clearColor.set(0.015, 0.03, 0.07, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 5, 0, Math.PI / 2);
const [background, mothTexture] = await Promise.all([
    loadExampleTexture(new URL('./image/2d/moonlit-conservatory.png', import.meta.url).href),
    loadExampleTexture(new URL('./image/2d/moon-moth-strip.png', import.meta.url).href)
]);
createSpriteEntity(
    runtime.world,
    { texture: background, width: 7.1, height: 4 },
    { position: [0, 0, -1] },
    -100
);
const frameWidth = mothTexture.origWidth / 8;
const mothFrames = Array.from(
    { length: 8 },
    (_, index) =>
        new SpriteFrame({
            texture: mothTexture,
            x: index * frameWidth,
            y: 150,
            width: frameWidth,
            height: 410,
            duration: 82
        })
);
const initialMothFrame = mothFrames[0];
if (!initialMothFrame) throw new Error('Moon-moth atlas is incomplete.');
const moth = createSpriteEntity(
    runtime.world,
    { frame: initialMothFrame, width: 1.45, height: 1.12 },
    { position: [0, -0.1, 0] },
    20
);
runtime.world.add(moth, SpriteAnimation, { frames: mothFrames, frameRate: 12, loop: true });
createTextEntity(
    runtime.world,
    {
        text: 'THE MOON MOTH',
        font: '700 34px Georgia',
        fillStyle: '#fff5d7',
        padding: 8,
        resolution: 2
    },
    { position: [0, 1.45, 0.1], scale: [0.004, 0.004, 0.004] }
);
const status = createTextEntity(
    runtime.world,
    {
        text: 'CLICK TO PAUSE • ECS SPRITE ANIMATION',
        font: '650 13px system-ui',
        fillStyle: '#8be7ee',
        padding: 5,
        resolution: 2
    },
    { position: [0, -1.5, 0.1], scale: [0.0045, 0.0045, 0.0045] }
);
let playing = true;
runtime.engine.canvas.addEventListener('click', () => {
    playing = !playing;
    runtime.world.set(moth, SpriteAnimation, {
        frames: mothFrames,
        frameRate: 12,
        loop: true,
        playing
    });
    runtime.world.set(status, LocalTransform, {
        position: [0, -1.5, 0.1],
        scale: [playing ? 0.0045 : 0.005, playing ? 0.0045 : 0.005, 0.0045]
    });
});
runtime.start(time => {
    runtime.world.set(moth, LocalTransform, {
        position: [0, -0.1 + Math.sin(time * 2.3) * 0.12, 0],
        scale: [1, 1, 1]
    });
});
