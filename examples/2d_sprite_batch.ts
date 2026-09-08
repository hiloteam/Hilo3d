import * as Hilo3d from '../src/Hilo3d';
import { createStardustAtlas } from './shared/stardustAtlas';
import { atlasFrame, createGridFrames } from './shared/moonlit2d';
import {
    createStudio,
    createStudioScene,
    createStudioAtlas,
    fitStudioRoot,
    studioText
} from './shared/studio2d';

const studio = createStudio(1);
const scene = await createStudioScene(studio);
const { stage, ticker } = scene;
const texture = createStardustAtlas();
const frames = createGridFrames(texture, 4, 4);
const root = new Hilo3d.Node().addTo(stage);
fitStudioRoot(scene, root);
const atlas = createStudioAtlas();
// Fine atlas-backed registration marks keep the center airy even at the largest population.
for (let index = 0; index < 41; index++) {
    new Hilo3d.Sprite({
        frame: atlas.line,
        width: 0.6,
        height: 500,
        x: index * 25,
        y: 310,
        tint: new Hilo3d.Color(0.2, 0.4, 0.4, 0.12),
        pointerEnabled: false,
        sortingLayer: -10
    }).addTo(root);
}
const title = studioText(root, 'A field of possibilities.', 500, 58, {
    font: 'italic 30px Georgia, serif',
    textAlign: 'center'
});
title.anchorX = 0.5;
const subtitle = studioText(root, 'ONE ATLAS. A THOUSAND LITTLE WORLDS.', 500, 105, {
    font: '9px ui-monospace, monospace',
    letterSpacing: 2,
    textAlign: 'center',
    fillStyle: '#83a9a3'
});
subtitle.anchorX = 0.5;
let count = 4096;
let formation = 'Spiral galaxy';
let speed = 0.7;
let playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
let elapsed = 0;
let spread = 1;
const MAX_COUNT = 8192;
const seeds = new Float32Array(MAX_COUNT * 3);
let randomState = 0x51a7;
function random(): number {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
}
const sprites = Array.from({ length: MAX_COUNT }, (_, index) => {
    seeds[index * 3] = random();
    seeds[index * 3 + 1] = random();
    seeds[index * 3 + 2] = random();
    const size = 10 + random() * 23;
    const color =
        index % 3 === 0 ? [1, 0.64, 0.26] : index % 3 === 1 ? [0.23, 0.8, 0.9] : [0.57, 0.46, 1];
    return new Hilo3d.Sprite({
        frame: atlasFrame(frames, index % frames.length),
        width: size,
        height: size,
        visible: index < count,
        sortingLayer: 0,
        pointerEnabled: false,
        tint: new Hilo3d.Color(color[0], color[1], color[2], 0.3 + random() * 0.6)
    }).addTo(root);
});
const population = studioText(root, '4,096', 500, 514, {
    font: '42px Georgia, serif',
    textAlign: 'center',
    fillStyle: '#ead4a5'
});
population.anchorX = 0.5;
const label = studioText(root, 'INDIVIDUAL SPRITES / ONE SHARED MATERIAL', 500, 568, {
    font: '9px ui-monospace, monospace',
    textAlign: 'center',
    letterSpacing: 1.5,
    fillStyle: '#83a9a3'
});
label.anchorX = 0.5;

const drawMetric = studio.metric('Draw calls', '—');
const triangleMetric = studio.metric('Triangles', '—');
const fpsMetric = studio.metric('FPS', '—');
const frameMetric = studio.metric('Frame interval', '—');
const debugGrid = document.createElement('div');
debugGrid.className = 'studio-debug-grid';
for (const output of [drawMetric, triangleMetric, fpsMetric, frameMetric]) {
    if (output.parentElement) debugGrid.append(output.parentElement);
}
const debugPanel = document.createElement('aside');
debugPanel.className = 'studio-render-debug';
debugPanel.setAttribute('aria-label', 'Renderer statistics');
const debugHeading = document.createElement('h2');
debugHeading.textContent = 'RENDER DEBUG';
frameMetric.title = '平均帧间隔，不是 GPU 耗时';
debugPanel.append(debugHeading, debugGrid);
studio.container.append(debugPanel);
studio.section('THE PARTICLE FIELD', '每颗星种都是独立 Sprite。切换数量或队形，观察同图集合批。');
const countMetric = studio.metric('活跃 Sprite', '4,096');
const batchMetric = studio.metric('预期精灵批次', '32');
studio.select('精灵数量', ['512', '2048', '4096', '8192'], String(count), value => {
    count = Number(value);
    sprites.forEach((sprite, index) => {
        sprite.visible = index < count;
    });
    countMetric.value = count.toLocaleString('en-US');
    batchMetric.value = String(Math.ceil(count / 128));
    population.setText(count.toLocaleString('en-US'));
    document.body.dataset['spriteCount'] = String(count);
});
studio.select('星群队形', ['Spiral galaxy', 'Ribbon river', 'Orbital rings'], formation, value => {
    formation = value;
    document.body.dataset['formation'] = value;
});
studio.range(
    '流动速度',
    0,
    2,
    speed,
    0.1,
    value => {
        speed = value;
    },
    '×'
);
studio.range(
    '星群展开',
    0.6,
    1.2,
    spread,
    0.05,
    value => {
        spread = value;
    },
    '×'
);
const play = studio.button(playing ? '暂停流动  /  Pause' : '继续流动  /  Play', () => {
    playing = !playing;
    play.textContent = playing ? '暂停流动  / Pause' : '继续流动  /  Play';
});
studio.status.textContent = 'LIVE FIELD · 调整数量、队形与流动速度';
document.body.dataset['spriteCount'] = String(count);
document.body.dataset['formation'] = formation;
ticker.addTick({
    tick(dt): void {
        if (playing) elapsed += Math.min(dt, 50) * speed;
        for (let index = 0; index < count; index++) {
            const sprite = sprites[index];
            if (!sprite) continue;
            const a = seeds[index * 3] ?? 0;
            const b = seeds[index * 3 + 1] ?? 0;
            const c = seeds[index * 3 + 2] ?? 0;
            const time = elapsed * 0.00013;
            let x: number;
            let y: number;
            if (formation === 'Spiral galaxy') {
                const radius = Math.sqrt(a) * 370;
                const angle = ((index % 3) * Math.PI * 2) / 3 + a * 7 + b * 0.5 + time;
                x = Math.cos(angle) * radius;
                y = Math.sin(angle) * radius * 0.44 + (c - 0.5) * 32;
            } else if (formation === 'Ribbon river') {
                x = (a * 2 - 1) * 410;
                y = Math.sin(a * 9 + time * 2) * 78 + Math.sin(a * 17 - time) * 28 + (b - 0.5) * 62;
            } else {
                const radius = 100 + (index % 4) * 80 + b * 16;
                const angle = a * Math.PI * 2 + time * (index % 2 ? 1 : -1);
                x = Math.cos(angle) * radius;
                y = Math.sin(angle) * radius * 0.42;
            }
            sprite.x = 500 + x * spread;
            sprite.y = 326 + y * spread;
            sprite.rotationZ = (a * 360 + elapsed * 0.003) % 360;
        }
    }
});
scene.start();
let statisticsElapsed = 0;
let statisticsFrames = 0;
// This observer follows Stage in the ticker. RenderInfo publishes the preceding completed frame.
ticker.addTick({
    tick(dt): void {
        statisticsElapsed += dt;
        statisticsFrames++;
        if (statisticsElapsed < 250) return;
        const { drawCount, faceCount } = stage.renderer.renderInfo;
        const frameInterval = statisticsElapsed / statisticsFrames;
        drawMetric.value = drawCount.toLocaleString('en-US');
        triangleMetric.value = faceCount.toLocaleString('en-US');
        fpsMetric.value = (1000 / frameInterval).toFixed(1);
        frameMetric.value = `${frameInterval.toFixed(2)} ms`;
        document.body.dataset['drawCount'] = String(drawCount);
        document.body.dataset['triangleCount'] = String(faceCount);
        statisticsElapsed = 0;
        statisticsFrames = 0;
    }
});
