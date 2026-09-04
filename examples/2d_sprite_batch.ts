import { LocalTransform, createCanvasTextSystem } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import {
    createGridFrames,
    createSpriteEntity,
    createTextEntity,
    loadExampleTexture
} from './shared/twoD';

const SPRITE_COUNT = 4096;
const runtime = await createExampleRuntime([createCanvasTextSystem()]);
runtime.engine.renderer.clearColor.set(0.012, 0.028, 0.065, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 5.2, 0, Math.PI / 2);
const [background, atlas] = await Promise.all([
    loadExampleTexture(new URL('./image/2d/moonlit-conservatory.png', import.meta.url).href),
    loadExampleTexture(new URL('./image/2d/star-seeds-atlas.png', import.meta.url).href)
]);
createSpriteEntity(
    runtime.world,
    { texture: background, width: 7.1, height: 4 },
    { position: [0, 0, -2] },
    -100
);
const frames = createGridFrames(atlas, 4, 4);
let randomState = 0x5eed1234;
function random(): number {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState / 0x1_0000_0000;
}
const sprites: {
    readonly entity: ReturnType<typeof createSpriteEntity>;
    readonly x: number;
    readonly y: number;
    readonly phase: number;
}[] = [];
for (let index = 0; index < SPRITE_COUNT; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 0.35 + Math.sqrt(random()) * 2.7;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.52;
    const size = 0.035 + random() * 0.07;
    const frame = frames[Math.floor(random() * frames.length)];
    if (!frame) throw new Error('Star-seed atlas is incomplete.');
    sprites.push({
        entity: createSpriteEntity(
            runtime.world,
            {
                frame,
                width: size,
                height: size,
                tint: [0.72 + random() * 0.28, 0.82 + random() * 0.16, 1, 0.5 + random() * 0.5]
            },
            { position: [x, y, random() * 0.4 - 0.2] },
            10
        ),
        x,
        y,
        phase: random() * Math.PI * 2
    });
}
createTextEntity(
    runtime.world,
    {
        text: 'THE STAR-SEED SWARM',
        font: '700 32px Georgia',
        fillStyle: '#fff3d0',
        padding: 8,
        resolution: 2
    },
    { position: [0, 1.55, 0.5], scale: [0.004, 0.004, 0.004] }
);
createTextEntity(
    runtime.world,
    {
        text: '4,096 ECS SPRITES • ONE ATLAS • PORTABLE BATCHING',
        font: '650 12px ui-monospace',
        fillStyle: '#82e1ea',
        padding: 5,
        resolution: 2
    },
    { position: [0, 1.25, 0.5], scale: [0.004, 0.004, 0.004] }
);
runtime.start(time => {
    for (let index = 0; index < sprites.length; index += 16) {
        const sprite = sprites[index];
        if (!sprite) continue;
        runtime.world.set(sprite.entity, LocalTransform, {
            position: [sprite.x, sprite.y + Math.sin(time * 1.8 + sprite.phase) * 0.06, 0]
        });
    }
});
