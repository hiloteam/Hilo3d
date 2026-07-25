import * as Hilo3d from '../src/Hilo3d';
import { resolveExampleBackend } from './shared/backend';
import {
    createPostalBackground,
    createPostalButtonFrames,
    loadPostalUiTexture,
    POSTAL_UI_INSETS
} from './shared/postalUi';

function requireContainer(): HTMLElement {
    const container = document.querySelector<HTMLElement>('#container');
    if (!container) throw new Error('2D text layout example requires #container.');
    return container;
}

const camera = new Hilo3d.Camera2D({ width: innerWidth, height: innerHeight });
const stage = await Hilo3d.Stage.create({
    backend: resolveExampleBackend(),
    container: requireContainer(),
    camera,
    width: innerWidth,
    height: innerHeight,
    pixelRatio: Math.min(devicePixelRatio || 1, 2),
    antialias: false,
    alpha: false,
    useInstanced: true,
    clearColor: new Hilo3d.Color(0.03, 0.09, 0.12)
});
const texture = await loadPostalUiTexture();
const frames = createPostalButtonFrames(texture);
const background = new Hilo3d.Sprite({
    texture: createPostalBackground(),
    anchorX: 0,
    anchorY: 0,
    sortingLayer: -100,
    pointerEnabled: false,
    autoPlay: false
}).addTo(stage);
const title = new Hilo3d.Text2D({
    text: 'MEASURED TEXT LAYOUT',
    style: {
        font: '800 30px ui-monospace, monospace',
        fillStyle: '#fff0bd',
        strokeStyle: '#162b30',
        strokeWidth: 6,
        padding: 9,
        letterSpacing: 1.2,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5,
    anchorY: 0.5,
    sortingLayer: 20,
    pointerEnabled: false
}).addTo(stage);
const subtitle = new Hilo3d.Text2D({
    text: 'REAL GLYPH WIDTH  •  CJK WRAP  •  MAX LINES  •  ELLIPSIS',
    style: {
        font: '700 11px ui-monospace, monospace',
        fillStyle: '#9de2d2',
        strokeStyle: '#102b35',
        strokeWidth: 4,
        padding: 5,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5,
    anchorY: 0.5,
    sortingLayer: 20,
    pointerEnabled: false
}).addTo(stage);

const cardCopy = [
    {
        heading: '01  中英混排自动换行',
        body: '枫叶镇 Maple Post 的 courier 需要在 18:30 前送达 12 个包裹。文字会按 Canvas 实际字形宽度换行。'
    },
    {
        heading: '02  最多三行与省略号',
        body: 'Priority dispatch: the northern bridge is closed after sunset, so choose the forest route and keep the medicine parcel dry.'
    },
    {
        heading: '03  字距与段落间距',
        body: 'TRACKING  MP-2048\n第二段保留额外间距，并且纹理只在文字或样式变化时重新栅格化。'
    }
] as const;
const cards = cardCopy.map((copy, index) => {
    const panel = new Hilo3d.SlicedSprite({
        frame: frames.up,
        insets: POSTAL_UI_INSETS,
        width: 340,
        height: 250,
        anchorX: 0.5,
        anchorY: 0.5,
        sortingLayer: 0,
        pointerEnabled: false
    }).addTo(stage);
    const heading = new Hilo3d.Text2D({
        text: copy.heading,
        style: {
            font: '800 16px system-ui, sans-serif',
            fillStyle: '#55321a',
            strokeStyle: '#fff0bd',
            strokeWidth: 2,
            maxWidth: 270,
            padding: 4,
            letterSpacing: 0.5,
            resolution: 2
        },
        anchorX: 0.5,
        anchorY: 0,
        sortingLayer: 10,
        pointerEnabled: false
    }).addTo(stage);
    const body = new Hilo3d.Text2D({
        text: copy.body,
        style: {
            font: '600 15px system-ui, sans-serif',
            fillStyle: '#573b27',
            maxWidth: 270,
            maxLines: index === 1 ? 3 : 0,
            overflow: index === 1 ? 'ellipsis' : 'clip',
            lineHeight: 23,
            paragraphSpacing: index === 2 ? 12 : 0,
            letterSpacing: index === 2 ? 1 : 0,
            padding: 4,
            resolution: 2
        },
        anchorX: 0.5,
        anchorY: 0,
        sortingLayer: 10,
        pointerEnabled: false
    }).addTo(stage);
    return { panel, heading, body };
});

function resize(): void {
    const width = innerWidth;
    const height = innerHeight;
    stage.resize(width, height);
    camera.resize(width, height);
    background.width = width;
    background.height = height;
    title.setScale(Math.min(1, width / 640));
    title.setPosition(width * 0.5, 52, 0);
    subtitle.setScale(Math.min(1, width / 620));
    subtitle.setPosition(width * 0.5, 102, 0);
    const columns = width >= 980 ? 3 : 1;
    const cardWidth = Math.min(350, width - 36);
    const cardHeight = columns === 3 ? 300 : 190;
    const gap = 22;
    const totalWidth = columns * cardWidth + (columns - 1) * gap;
    for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        if (!card) continue;
        const column = columns === 3 ? index : 0;
        const row = columns === 3 ? 0 : index;
        const x = width * 0.5 - totalWidth * 0.5 + cardWidth * 0.5 + column * (cardWidth + gap);
        const y = columns === 3 ? height * 0.54 : 190 + row * (cardHeight + 12);
        const textWidth = cardWidth - 76;
        card.panel.setSize(cardWidth, cardHeight);
        card.panel.setPosition(x, y, 0);
        card.heading.setStyle({ maxWidth: textWidth });
        card.heading.setPosition(x, y - cardHeight * 0.32, 0);
        card.body.setStyle({ maxWidth: textWidth });
        card.body.setPosition(x, y - cardHeight * 0.15, 0);
    }
}
window.addEventListener('resize', resize);
resize();

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
document.querySelector<HTMLElement>('#loading')?.remove();
document.body.dataset['exampleReady'] = 'true';
console.info(`2D text layout uses ${stage.renderer.backend}`);
