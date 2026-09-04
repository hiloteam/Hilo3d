import { CanvasText, LocalTransform, createCanvasTextSystem } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import {
    createGridFrames,
    createSpriteEntity,
    createTextEntity,
    loadExampleTexture
} from './shared/twoD';

const runtime = await createExampleRuntime([createCanvasTextSystem()]);
runtime.engine.renderer.clearColor.set(0.015, 0.03, 0.07, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 5, 0, Math.PI / 2);
const [background, seeds] = await Promise.all([
    loadExampleTexture(new URL('./image/2d/moonlit-conservatory.png', import.meta.url).href),
    loadExampleTexture(new URL('./image/2d/star-seeds-atlas.png', import.meta.url).href)
]);
createSpriteEntity(
    runtime.world,
    { texture: background, width: 7.1, height: 4 },
    { position: [0, 0, -2] },
    -100
);
const seedFrames = createGridFrames(seeds, 4, 4);
for (let index = 0; index < 8; index += 1) {
    const frame = seedFrames[index * 2];
    if (!frame) continue;
    const angle = (index / 8) * Math.PI * 2;
    createSpriteEntity(
        runtime.world,
        { frame, width: 0.36, height: 0.36, tint: [0.9, 0.97, 1, 0.9] },
        { position: [Math.cos(angle) * 2.4, Math.sin(angle) * 1.25, 0] },
        20
    );
}
createTextEntity(
    runtime.world,
    {
        text: 'MOONLIT TYPE',
        font: '700 42px Georgia',
        fillStyle: '#fff5d7',
        padding: 10,
        resolution: 2
    },
    { position: [0, 1.45, 0.2], scale: [0.0042, 0.0042, 0.0042] }
);
createTextEntity(
    runtime.world,
    {
        text: 'CANVAS 2D → TEXTURE → ECS SPRITE',
        font: '650 12px ui-monospace',
        fillStyle: '#72dbe8',
        padding: 5,
        resolution: 2
    },
    { position: [0, 1.12, 0.2], scale: [0.0042, 0.0042, 0.0042] }
);
const quote = createTextEntity(
    runtime.world,
    {
        text: '“Every quiet garden keeps a constellation.”',
        font: 'italic 600 27px Georgia',
        fillStyle: '#f4dfac',
        padding: 12,
        resolution: 2
    },
    { position: [0, 0.1, 0.2], scale: [0.0042, 0.0042, 0.0042] }
);
const action = createTextEntity(
    runtime.world,
    {
        text: 'CLICK TO CHANGE THE MOOD',
        font: '700 13px system-ui',
        fillStyle: '#a8edf3',
        padding: 8,
        resolution: 2
    },
    { position: [0, -1.1, 0.2], scale: [0.0045, 0.0045, 0.0045] }
);
const moods = [
    { text: '“Every quiet garden keeps a constellation.”', fillStyle: '#f4dfac' },
    { text: '“The smallest light still changes the night.”', fillStyle: '#a8edf3' },
    { text: '“Let the moon remember where you planted wonder.”', fillStyle: '#f7d4ee' }
] as const;
let moodIndex = 0;
runtime.engine.canvas.addEventListener('click', () => {
    moodIndex = (moodIndex + 1) % moods.length;
    const mood = moods[moodIndex];
    if (mood)
        runtime.world.set(quote, CanvasText, {
            ...mood,
            font: 'italic 600 27px Georgia',
            padding: 12,
            resolution: 2
        });
});
runtime.start(time => {
    const pulse = 0.0045 + Math.sin(time * 3) * 0.00015;
    runtime.world.set(action, LocalTransform, {
        position: [0, -1.1, 0.2],
        scale: [pulse, pulse, pulse]
    });
});
