import * as Hilo3d from '../src/Hilo3d';
import {
    addMoonlitBackground,
    createGridFrames,
    createMoonlitScene,
    loadMoonlitTexture,
    setTextOrder
} from './shared/moonlit2d';

const scene = await createMoonlitScene();
const { stage, ticker } = scene;
const [backgroundTexture, seedTexture] = await Promise.all([
    loadMoonlitTexture('background'),
    loadMoonlitTexture('seeds')
]);
addMoonlitBackground(scene, backgroundTexture);

const title = setTextOrder(
    new Hilo3d.Text2D({
        text: 'MOONLIT TYPE',
        style: {
            font: '700 42px Georgia, serif',
            fillStyle: '#fff5d7',
            strokeStyle: '#07162b',
            strokeWidth: 6,
            padding: 10,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage),
    100
);
const eyebrow = setTextOrder(
    new Hilo3d.Text2D({
        text: 'CANVAS 2D → TEXTURE → SPRITE BATCH',
        style: {
            font: '650 12px ui-monospace, monospace',
            fillStyle: '#72dbe8',
            strokeStyle: '#07162b',
            strokeWidth: 3,
            padding: 5,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage),
    100
);
const quote = setTextOrder(
    new Hilo3d.Text2D({
        text: '“Every quiet garden\nkeeps a constellation.”',
        style: {
            font: 'italic 600 27px Georgia, serif',
            fillStyle: '#f4dfac',
            strokeStyle: '#061326',
            strokeWidth: 5,
            lineHeight: 38,
            padding: 12,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5,
        anchorY: 0.5
    }).addTo(stage),
    100
);
const score = setTextOrder(
    new Hilo3d.Text2D({
        text: 'STAR SEEDS  000',
        style: {
            font: '700 18px ui-monospace, monospace',
            fillStyle: '#ffffff',
            strokeStyle: '#0a203b',
            strokeWidth: 5,
            padding: 7,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage),
    100
);
const action = setTextOrder(
    new Hilo3d.Text2D({
        text: 'CLICK TO CHANGE THE MOOD',
        style: {
            font: '700 13px system-ui, sans-serif',
            fillStyle: '#07162b',
            strokeStyle: '#f3d895',
            strokeWidth: 7,
            padding: 9,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5,
        anchorY: 0.5,
        useHandCursor: true
    }).addTo(stage),
    110
);
const backend = setTextOrder(
    new Hilo3d.Text2D({
        text: stage.renderer.backend.toUpperCase(),
        style: {
            font: '700 10px ui-monospace, monospace',
            fillStyle: '#e9cd88',
            strokeStyle: '#07162b',
            strokeWidth: 3,
            padding: 5,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5
    }).addTo(stage),
    100
);

const frames = createGridFrames(seedTexture, 4, 4);
const ornaments = [0, 3, 5, 10, 13, 15].map((frameIndex, index) => {
    const frame = frames[frameIndex];
    if (!frame) throw new Error('Moonlit seed atlas is incomplete.');
    return new Hilo3d.Sprite({
        frame,
        width: index % 3 === 0 ? 72 : 50,
        height: index % 3 === 0 ? 72 : 50,
        pointerEnabled: false,
        tint: new Hilo3d.Color(0.9, 0.97, 1, 0.9)
    }).addTo(stage);
});

const moods = [
    {
        text: '“Every quiet garden\nkeeps a constellation.”',
        fillStyle: '#f4dfac'
    },
    {
        text: '“The smallest light\nstill changes the night.”',
        fillStyle: '#a8edf3'
    },
    {
        text: '“Let the moon remember\nwhere you planted wonder.”',
        fillStyle: '#f7d4ee'
    }
] as const;
let moodIndex = 0;
action.on('click', () => {
    moodIndex = (moodIndex + 1) % moods.length;
    const mood = moods[moodIndex];
    if (!mood) throw new Error('Text mood storage is incomplete.');
    quote.setText(mood.text).setStyle({ fillStyle: mood.fillStyle });
});
stage.enableDOMEvent('click');

let seedCount = 0;
let scoreElapsed = 0;
let animationElapsed = 0;
ticker.addTick({
    tick(dt): void {
        scoreElapsed += dt;
        animationElapsed += dt;
        if (scoreElapsed >= 650) {
            scoreElapsed %= 650;
            seedCount = (seedCount + 7) % 1000;
            score.setText(`STAR SEEDS  ${String(seedCount).padStart(3, '0')}`);
        }
        const pulse = 1 + Math.sin(animationElapsed * 0.003) * 0.025;
        action.setScale(pulse);
    }
});

scene.addLayout((width, height) => {
    const compactScale = Math.min(1, width / 680);
    title.setScale(compactScale);
    title.setPosition(width * 0.5, Math.max(24, height * 0.06), 30);
    eyebrow.setScale(Math.min(1, width / 520));
    eyebrow.setPosition(width * 0.5, Math.max(82, height * 0.15), 30);
    quote.setScale(compactScale);
    quote.setPosition(width * 0.5, height * 0.47, 30);
    score.setScale(Math.min(1, width / 420));
    score.setPosition(width * 0.5, height * 0.69, 30);
    action.setPosition(width * 0.5, height * 0.8, 30);
    backend.setPosition(width * 0.5, height - 34, 30);
    const radiusX = Math.min(width * 0.37, 430);
    const radiusY = Math.min(height * 0.28, 210);
    for (let index = 0; index < ornaments.length; index += 1) {
        const ornament = ornaments[index];
        if (!ornament) continue;
        const angle = (index / ornaments.length) * Math.PI * 2;
        ornament.x = width * 0.5 + Math.cos(angle) * radiusX;
        ornament.y = height * 0.49 + Math.sin(angle) * radiusY;
    }
});

scene.start();
