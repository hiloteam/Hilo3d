import * as Hilo3d from '../src/Hilo3d';
import Stats from './shared/stats';
import {
    addMoonlitBackground,
    createGridFrames,
    createMoonlitScene,
    loadMoonlitTexture,
    setTextOrder
} from './shared/moonlit2d';

const SPRITE_COUNT = 4096;
const GROUP_COUNT = 4;
const scene = await createMoonlitScene();
const { stage, ticker } = scene;
const [backgroundTexture, seedTexture] = await Promise.all([
    loadMoonlitTexture('background'),
    loadMoonlitTexture('seeds')
]);
addMoonlitBackground(scene, backgroundTexture);
const frames = createGridFrames(seedTexture, 4, 4);

let randomState = 0x5eed1234;
function random(): number {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState / 0x1_0000_0000;
}

const groups = Array.from({ length: GROUP_COUNT }, (_, groupIndex) => {
    const group = new Hilo3d.Node();
    group.onUpdate = dt => {
        group.rotationZ += dt * (groupIndex % 2 === 0 ? 0.0018 : -0.0012);
    };
    stage.addChild(group);
    return group;
});

for (let index = 0; index < SPRITE_COUNT; index += 1) {
    const group = groups[index % groups.length];
    if (!group) throw new Error('Sprite batch group storage is incomplete.');
    const frame = frames[Math.floor(random() * frames.length)];
    if (!frame) throw new Error('Moonlit seed atlas is incomplete.');
    const angle = random() * Math.PI * 2;
    const radius = 70 + Math.sqrt(random()) * 620;
    const size = 18 + random() * 34;
    const warmth = random();
    group.addChild(
        new Hilo3d.Sprite({
            frame,
            width: size,
            height: size,
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius * 0.55,
            tint: new Hilo3d.Color(
                0.72 + warmth * 0.28,
                0.82 + warmth * 0.16,
                0.9 + (1 - warmth) * 0.1,
                0.45 + random() * 0.5
            ),
            pointerEnabled: false
        })
    );
}

const title = setTextOrder(
    new Hilo3d.Text2D({
        text: 'THE STAR-SEED SWARM',
        style: {
            font: '700 32px Georgia, serif',
            fillStyle: '#fff3d0',
            strokeStyle: '#061326',
            strokeWidth: 6,
            padding: 9,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage),
    100
);
const details = setTextOrder(
    new Hilo3d.Text2D({
        text: '4,096 SPRITES  •  32 PORTABLE INSTANCE BATCHES  •  1 ATLAS',
        style: {
            font: '650 12px ui-monospace, monospace',
            fillStyle: '#82e1ea',
            strokeStyle: '#061326',
            strokeWidth: 4,
            padding: 6,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage),
    100
);
const backend = setTextOrder(
    new Hilo3d.Text2D({
        text: `${stage.renderer.backend.toUpperCase()} • SHARED QUAD + MATERIAL`,
        style: {
            font: '700 10px ui-monospace, monospace',
            fillStyle: '#e8cc88',
            strokeStyle: '#061326',
            strokeWidth: 3,
            padding: 5,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage),
    100
);

scene.addLayout((width, height) => {
    const contentScale = Math.min(width / 1280, height / 720);
    for (const group of groups) {
        group.setPosition(width * 0.5, height * 0.52, 0);
        group.setScale(contentScale);
    }
    title.setScale(Math.min(1, width / 680));
    title.setPosition(width * 0.5, Math.max(26, height * 0.06), 30);
    details.setScale(Math.min(1, width / 660));
    details.setPosition(width * 0.5, Math.max(76, height * 0.13), 30);
    backend.setPosition(width * 0.5, height - 36, 30);
});

new Stats(ticker, stage.renderer);
scene.start();
