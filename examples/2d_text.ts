import * as Hilo3d from '../src/Hilo3d';
import {
    atlasFrame,
    addMoonlitBackground,
    loadMoonlitTexture,
    createGridFrames
} from './shared/moonlit2d';
import {
    createStudio,
    createStudioScene,
    createStudioAtlas,
    STUDIO_INSETS,
    studioText
} from './shared/studio2d';

const studio = createStudio(2);
const scene = await createStudioScene(studio);
const { stage, ticker } = scene;
const [landscape, seeds] = await Promise.all([
    loadMoonlitTexture('background'),
    loadMoonlitTexture('seeds')
]);
const background = addMoonlitBackground(scene, landscape);
background.tint.set(0.4, 0.53, 0.55, 1);
const atlas = createStudioAtlas();
const root = new Hilo3d.Node({ rotationZ: -2 }).addTo(stage);
const panel = new Hilo3d.SlicedSprite({
    frame: atlas.paper,
    insets: STUDIO_INSETS,
    width: 824,
    height: 450,
    x: 500,
    y: 302,
    anchorX: 0.5,
    anchorY: 0.5,
    pointerEnabled: false
}).addTo(root);
const art = new Hilo3d.Sprite({
    texture: landscape,
    x: 252,
    y: 302,
    width: 245,
    height: 368,
    frame: new Hilo3d.SpriteFrame({
        texture: landscape,
        x: landscape.origWidth * 0.32,
        y: 0,
        width: landscape.origWidth * 0.36,
        height: landscape.origHeight
    }),
    sortingLayer: 5,
    pointerEnabled: false
}).addTo(root);
const artLabel = studioText(root, 'POSTCARD / 001', 151, 467, {
    font: '9px ui-monospace, monospace',
    letterSpacing: 1.5,
    fillStyle: '#f4e6c9',
    strokeStyle: '#122b33',
    strokeWidth: 2
});
const eyebrow = studioText(root, 'FROM THE LUMINOUS GARDEN', 420, 119, {
    font: '9px ui-monospace, monospace',
    letterSpacing: 1.7,
    fillStyle: '#7c8473'
});
const title = studioText(root, 'Dear moon,', 416, 158, {
    font: 'italic 48px Georgia, serif',
    fillStyle: '#284944'
});
const quote = studioText(root, 'Keep a little light\nfor the long way home.', 421, 241, {
    font: '26px Georgia, serif',
    lineHeight: 37,
    fillStyle: '#455c50',
    maxWidth: 397
});
const signature = studioText(root, '愿每一束微光，都能找到归途。', 422, 350, {
    font: '12px system-ui, sans-serif',
    fillStyle: '#7b816e',
    maxWidth: 365
});
const score = studioText(root, 'LETTERS SENT  /  000', 422, 447, {
    font: '10px ui-monospace, monospace',
    letterSpacing: 1.2,
    fillStyle: '#758070'
});
const action = studioText(root, 'Send a little light  ↗', 421, 399, {
    font: '600 15px system-ui, sans-serif',
    fillStyle: '#9b6638',
    padding: 8
});
action.pointerEnabled = true;
action.useHandCursor = true;
const seal = new Hilo3d.Sprite({
    frame: atlasFrame(createGridFrames(seeds, 4, 4), 0),
    x: 837,
    y: 438,
    width: 63,
    height: 63,
    sortingLayer: 110,
    pointerEnabled: false
}).addTo(root);
const caption = studioText(root, 'A NOTE TO THE NIGHT, WRITTEN IN LIGHT.', 500, 567, {
    font: '9px ui-monospace, monospace',
    textAlign: 'center',
    letterSpacing: 2
});
caption.anchorX = 0.5;

studio.section('WRITE A POSTCARD', '主画面中的标题、正文、签名和交互链接均由 Text2D 绘制。');
const editor = document.createElement('textarea');
editor.className = 'studio-editor';
editor.setAttribute('aria-label', 'Postcard message');
editor.maxLength = 140;
editor.value = quote.text;
editor.addEventListener('input', () => {
    quote.setText(editor.value);
    document.body.dataset['message'] = editor.value;
});
studio.inspector.append(editor);
quote.setStyle({ maxLines: 3, overflow: 'ellipsis' });
studio.range(
    '正文字号',
    18,
    30,
    26,
    1,
    value => {
        quote.setStyle({ font: `${String(value)}px Georgia, serif`, lineHeight: value * 1.35 });
    },
    ' px'
);
studio.range(
    '标题描边',
    0,
    3,
    0,
    0.5,
    value => {
        title.setStyle({ strokeWidth: value, strokeStyle: '#c2a277' });
    },
    ' px'
);
studio.select('纸上心情', ['Sage & honey', 'Rose & ink', 'Ocean blue'], 'Sage & honey', value => {
    const color =
        value === 'Rose & ink' ? '#8d5362' : value === 'Ocean blue' ? '#38687b' : '#455c50';
    quote.setStyle({ fillStyle: color });
    title.setStyle({ fillStyle: color });
});
let sent = 0;
let pulse = 0;
function sendLetter(): void {
    sent += 1;
    pulse = 1;
    score.setText(`LETTERS SENT  /  ${String(sent).padStart(3, '0')}`);
    signature.setText('已寄出。下一站，月亮。');
    studio.status.textContent = `DELIVERED · 已寄出 ${String(sent)} 封月光来信`;
    document.body.dataset['lettersSent'] = String(sent);
}
action.on('click', sendLetter);
stage.enableDOMEvent('click');
studio.button('寄出明信片  /  Send', sendLetter);
studio.section(
    'TEXTURE LIFECYCLE',
    '只在内容或样式变化时重绘 Canvas；动态分数继续复用原纹理与材质。'
);
studio.metric('文字路径', 'Canvas → Texture → Sprite');
studio.metric('内容更新', 'setText()');
studio.metric('样式更新', 'setStyle()');
document.body.dataset['lettersSent'] = '0';
ticker.addTick({
    tick(dt): void {
        pulse = Math.max(0, pulse - dt * 0.002);
        seal.rotationZ = pulse * 20;
        seal.setScale(1 + Math.sin(pulse * Math.PI) * 0.22);
    }
});
const portraitFrame = atlasFrame(art.frames, 0);
const landscapeFrame = Hilo3d.SpriteFrame.fromTexture(landscape);
scene.addLayout((width, height) => {
    const narrow = width < 600;
    const designWidth = narrow ? 460 : 1000;
    const designHeight = narrow ? 790 : 620;
    const scale = Math.min(width / designWidth, height / designHeight);
    root.setScale(scale);
    root.rotationZ = narrow ? 0 : -2;
    root.setPosition((width - designWidth * scale) / 2, (height - designHeight * scale) / 2, 0);
    panel.setSize(narrow ? 414 : 824, narrow ? 718 : 450);
    panel.setPosition(narrow ? 230 : 500, narrow ? 392 : 302, 0);
    art.setFrame(narrow ? landscapeFrame : portraitFrame);
    art.width = narrow ? 365 : 245;
    art.height = narrow ? 205 : 368;
    art.setPosition(narrow ? 230 : 252, narrow ? 170 : 302, 0);
    artLabel.setPosition(narrow ? 67 : 151, narrow ? 246 : 467, 0);
    eyebrow.setPosition(narrow ? 53 : 420, narrow ? 310 : 119, 0);
    title.setPosition(narrow ? 49 : 416, narrow ? 348 : 158, 0);
    quote.setPosition(narrow ? 53 : 421, narrow ? 427 : 241, 0);
    quote.setStyle({ maxWidth: narrow ? 350 : 397 });
    signature.setPosition(narrow ? 53 : 422, narrow ? 558 : 350, 0);
    signature.setStyle({ maxWidth: narrow ? 350 : 365 });
    action.setPosition(narrow ? 50 : 421, narrow ? 610 : 399, 0);
    score.setPosition(narrow ? 53 : 422, narrow ? 680 : 447, 0);
    seal.setPosition(narrow ? 380 : 837, narrow ? 666 : 438, 0);
    caption.setPosition(narrow ? 230 : 500, narrow ? 770 : 567, 0);
    caption.setScale(narrow ? 0.8 : 1);
});
scene.start();
