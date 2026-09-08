import * as Hilo3d from '../src/Hilo3d';
import { loadOrnateUiSkins, ORNATE_UI_INSETS, ORNATE_UI_SCALE } from './shared/ornateUi2d';
import {
    atlasFrame,
    addMoonlitBackground,
    loadMoonlitTexture,
    createGridFrames
} from './shared/moonlit2d';
import {
    setStudioTextColor,
    createStudio,
    createStudioScene,
    createStudioAtlas,
    studioText
} from './shared/studio2d';

const studio = createStudio(4);
const scene = await createStudioScene(studio);
const { stage, ticker } = scene;
const [landscape, seeds, skins] = await Promise.all([
    loadMoonlitTexture('background'),
    loadMoonlitTexture('seeds'),
    loadOrnateUiSkins()
]);
let activeSkin = skins[0];
if (!activeSkin) throw new Error('The ornate skin collection is empty.');
const background = addMoonlitBackground(scene, landscape);
background.tint.set(0.4, 0.55, 0.56, 1);
const atlas = createStudioAtlas();
const root = new Hilo3d.Node().addTo(stage);
const PANEL_SCALE = 2 / 7;
const panel = new Hilo3d.SlicedSprite({
    frame: activeSkin.frames.up,
    insets: ORNATE_UI_INSETS,
    width: 832 / PANEL_SCALE,
    height: 470 / PANEL_SCALE,
    scaleX: PANEL_SCALE,
    scaleY: PANEL_SCALE,
    x: 500,
    y: 310,
    anchorX: 0.5,
    anchorY: 0.5,
    pointerEnabled: false
}).addTo(root);
const banner = new Hilo3d.SlicedSprite({
    frame: activeSkin.frames.down ?? activeSkin.frames.up,
    insets: ORNATE_UI_INSETS,
    width: 288 / PANEL_SCALE,
    height: 414 / PANEL_SCALE,
    scaleX: PANEL_SCALE,
    scaleY: PANEL_SCALE,
    x: 256,
    y: 310,
    anchorX: 0.5,
    anchorY: 0.5,
    pointerEnabled: false,
    sortingLayer: 5
}).addTo(root);
// Large panels reuse complete corners, uniform edge samples, and a flat center.
// The tiny samples avoid magnifying source grain when a frame becomes a tall window.
const panelCenter = new Hilo3d.SpriteFrame({
    texture: atlas.texture,
    x: 576,
    y: 64,
    width: 1,
    height: 1
});
function applyPanelSkin(target: Hilo3d.SlicedSprite, frame: Hilo3d.SpriteFrame): void {
    target.setFrame(frame);
    const centerX = frame.x + Math.floor(frame.width / 2);
    const centerY = frame.y + Math.floor(frame.height / 2);
    const edgeSamples = [
        [1, centerX, frame.y, 1, 140],
        [3, frame.x, centerY, 154, 1],
        [5, frame.x + frame.width - 154, centerY, 154, 1],
        [7, centerX, frame.y + frame.height - 140, 1, 140]
    ] as const;
    for (const [part, x, y, width, height] of edgeSamples) {
        target.parts[part]?.setFrame(
            new Hilo3d.SpriteFrame({ texture: frame.texture, x, y, width, height })
        );
    }
    const center = target.parts[4];
    if (center) {
        center.setFrame(panelCenter);
        const factor = target === banner ? 0.55 : 1;
        if (frame.texture.name === skins[1]?.name)
            center.tint.set(0.032 * factor, 0.005 * factor, 0.029 * factor, 1);
        else center.tint.set(0.002 * factor, 0.032 * factor, 0.028 * factor, 1);
    }
}
applyPanelSkin(panel, activeSkin.frames.up);
applyPanelSkin(banner, activeSkin.frames.down ?? activeSkin.frames.up);
const bannerLabel = studioText(root, 'THE NIGHT SERVICE', 256, 134, {
    font: '9px ui-monospace, monospace',
    letterSpacing: 1.5,
    textAlign: 'center'
});
bannerLabel.anchorX = 0.5;
const emblem = new Hilo3d.Sprite({
    frame: atlasFrame(createGridFrames(seeds, 4, 4), 0),
    width: 162,
    height: 162,
    x: 256,
    y: 265,
    pointerEnabled: false,
    sortingLayer: 10
}).addTo(root);
const bannerTitle = studioText(root, 'A ticket to\nsomewhere.', 256, 364, {
    font: 'italic 29px Georgia, serif',
    lineHeight: 37,
    textAlign: 'center'
});
bannerTitle.anchorX = 0.5;
const departures = studioText(root, 'DEPARTURES / 21:30', 256, 467, {
    font: '9px ui-monospace, monospace',
    letterSpacing: 1,
    textAlign: 'center',
    fillStyle: '#99b3a3'
});
departures.anchorX = 0.5;
const eyebrow = studioText(root, 'CHOOSE YOUR NEXT CHAPTER', 450, 119, {
    font: '9px ui-monospace, monospace',
    letterSpacing: 1.4,
    fillStyle: '#d2bc8b'
});
const title = studioText(root, 'The travel bureau', 446, 156, {
    font: '34px Georgia, serif',
    fillStyle: '#f5dfac'
});
const message = studioText(root, '星光专线即将发车。选择你的目的地。', 450, 215, {
    font: '12px system-ui, sans-serif',
    maxWidth: 390,
    fillStyle: '#c9c8af',
    maxLines: 2,
    overflow: 'ellipsis',
    lineHeight: 19
});
let buttonWidth = 360;
let buttonHeight = 58;
let dispatched = 0;
let buttonX = 650;
let buttonY = 296;
const routes = [
    ['温室花园  /  Garden', '花园专线已出票。一路有光。'],
    ['月光港湾  /  Harbor', '港湾专线已出票。晚风正好。'],
    ['群星山谷  /  Locked', '山谷专线已出票。繁星相伴。']
] as const;
const buttonSets = skins.map(skin =>
    routes.map(([label, result], index) => {
        const button = new Hilo3d.UiButton({
            frames: skin.frames,
            insets: ORNATE_UI_INSETS,
            width: buttonWidth / ORNATE_UI_SCALE,
            height: buttonHeight / ORNATE_UI_SCALE,
            scaleX: ORNATE_UI_SCALE,
            scaleY: ORNATE_UI_SCALE,
            visible: skin === activeSkin,
            x: 650,
            y: 296 + index * 78,
            anchorX: 0.5,
            anchorY: 0.5,
            label,
            labelStyle: {
                font: '600 13px system-ui, sans-serif',
                fillStyle: '#f6e4bc',
                resolution: 2,
                padding: 5,
                textAlign: 'center'
            },
            enabled: index < 2,
            sortingLayer: 20
        }).addTo(root);
        setStudioTextColor(button.label);
        button.label.setScale(1 / ORNATE_UI_SCALE);
        button.on('click', () => {
            dispatched++;
            message.setText(result);
            document.body.dataset['dispatches'] = String(dispatched);
            studio.status.textContent = `TICKET ${String(dispatched).padStart(3, '0')} · ${result}`;
        });
        return button;
    })
);
let buttons = buttonSets[0];
if (!buttons) throw new Error('No UI buttons were initialized.');
const guides = new Hilo3d.Node({ visible: true }).addTo(root);
for (const offset of [-1, 1]) {
    new Hilo3d.Sprite({
        frame: atlas.line,
        width: 1,
        height: 70,
        x: 650 + offset * 160,
        y: 296,
        sortingLayer: 200,
        tint: new Hilo3d.Color(0.4, 0.7, 0.7, 0.85),
        pointerEnabled: false
    }).addTo(guides);
    new Hilo3d.Sprite({
        frame: atlas.line,
        width: 376,
        height: 1,
        x: 650,
        y: 296 + offset * 9,
        sortingLayer: 200,
        tint: new Hilo3d.Color(0.4, 0.7, 0.7, 0.85),
        pointerEnabled: false
    }).addTo(guides);
}
function resizeButtons(): void {
    for (const set of buttonSets)
        set.forEach((button, index) => {
            button.setSize(buttonWidth / ORNATE_UI_SCALE, buttonHeight / ORNATE_UI_SCALE);
            button.setPosition(buttonX, buttonY + index * (buttonHeight + 20), 0);
        });
    guides.children.forEach((child, index) => {
        if (child instanceof Hilo3d.Sprite) {
            const side = index < 2 ? -1 : 1;
            if (index % 2 === 0) {
                child.y = buttonY;
                child.x = buttonX + side * (buttonWidth / 2 - 22);
                child.height = buttonHeight + 12;
            } else {
                child.width = buttonWidth + 12;
                child.x = buttonX;
                child.y = buttonY + side * (buttonHeight / 2 - 20);
            }
        }
    });
    document.body.dataset['buttonWidth'] = String(buttonWidth);
}
stage.enableDOMEvent(['pointermove', 'pointerdown', 'pointerup', 'click']);
studio.section(
    'A RESPONSIVE SKIN',
    'ImageGen 美术图集。宝石、卷草和金属边框通过真正的九宫格拉伸。'
);
const sourceMap = document.createElement('div');
sourceMap.className = 'studio-slice-source';
sourceMap.setAttribute('role', 'img');
sourceMap.setAttribute('aria-label', '九宫格原图：固定四角、单向拉伸的边、双向拉伸的中心');
for (const symbol of ['▪', '↔', '▪', '↕', '↔ ↕', '↕', '▪', '↔', '▪']) {
    const cell = document.createElement('span');
    cell.textContent = symbol;
    sourceMap.append(cell);
}
const sourceLegend = document.createElement('p');
sourceLegend.className = 'studio-slice-legend';
sourceLegend.textContent =
    '原始美术图集 / 按钮角部 22 × 20 px\n宝石与卷草保持比例，边线沿单轴延伸。';
studio.inspector.append(sourceMap, sourceLegend);
function updateSourceMap(): void {
    if (!activeSkin) return;
    const frame = activeSkin.frames.up;
    const previewScale = 184 / frame.width;
    sourceMap.style.width = '184px';
    sourceMap.style.height = `${String(frame.height * previewScale)}px`;
    sourceMap.style.backgroundImage = `url("${activeSkin.image.src}")`;
    sourceMap.style.backgroundSize = `${String(activeSkin.image.width * previewScale)}px ${String(activeSkin.image.height * previewScale)}px`;
    sourceMap.style.backgroundPosition = `${String(-frame.x * previewScale)}px ${String(-frame.y * previewScale)}px`;
    sourceMap.style.gridTemplateColumns = `${String(154 * previewScale)}px 1fr ${String(154 * previewScale)}px`;
    sourceMap.style.gridTemplateRows = `${String(140 * previewScale)}px 1fr ${String(140 * previewScale)}px`;
    document.body.dataset['uiSkin'] = activeSkin.name;
}
studio.select(
    '九宫格美术皮肤',
    skins.map(skin => skin.name),
    activeSkin.name,
    name => {
        const index = skins.findIndex(skin => skin.name === name);
        const skin = skins[index];
        const set = buttonSets[index];
        if (!skin || !set) return;
        activeSkin = skin;
        buttons = set;
        buttonSets.forEach((group, groupIndex) => {
            for (const button of group) button.visible = groupIndex === index;
        });
        applyPanelSkin(panel, skin.frames.up);
        applyPanelSkin(banner, skin.frames.down ?? skin.frames.up);
        updateSourceMap();
    }
);
updateSourceMap();
studio.range(
    '按钮宽度',
    210,
    410,
    buttonWidth,
    2,
    value => {
        buttonWidth = value;
        resizeButtons();
    },
    ' px'
);
studio.range(
    '按钮高度',
    42,
    74,
    buttonHeight,
    2,
    value => {
        buttonHeight = value;
        resizeButtons();
    },
    ' px'
);
studio.toggle('显示九宫格切线', true, value => {
    guides.visible = value;
});
studio.toggle('解锁群星山谷', false, value => {
    for (const set of buttonSets)
        set[2]?.setEnabled(value).setLabel(value ? '群星山谷  /  Valley' : '群星山谷  /  Locked');
});
studio.section('POINTER STATES', '在两种皮肤间切换；每套都有默认、悬停、按下与禁用四帧。');
const state = studio.metric('花园按钮状态', 'up');
studio.metric('图集状态', '2 skins × 4 states');
studio.metric('单按钮分片', '9 sprites + 1 label');
studio.metric('固定角部', '22 × 20 px');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let elapsed = 0;
ticker.addTick({
    tick(dt): void {
        elapsed += dt;
        if (!reducedMotion) emblem.rotationZ = Math.sin(elapsed * 0.0007) * 5;
        const currentState = buttons?.[0]?.state ?? 'up';
        if (state.value !== currentState) state.value = currentState;
        document.body.dataset['buttonState'] = currentState;
    }
});
document.body.dataset['dispatches'] = '0';
scene.addLayout((width, height) => {
    const narrow = width < 600;
    const designWidth = narrow ? 460 : 1000;
    const designHeight = narrow ? 780 : 620;
    const scale = Math.min(width / designWidth, height / designHeight);
    root.setScale(scale);
    root.setPosition((width - designWidth * scale) / 2, (height - designHeight * scale) / 2, 0);
    panel.setSize((narrow ? 430 : 832) / PANEL_SCALE, (narrow ? 730 : 470) / PANEL_SCALE);
    panel.setPosition(narrow ? 230 : 500, narrow ? 387 : 310, 0);
    banner.setSize((narrow ? 380 : 288) / PANEL_SCALE, (narrow ? 238 : 414) / PANEL_SCALE);
    banner.setPosition(narrow ? 230 : 256, narrow ? 169 : 310, 0);
    bannerLabel.setPosition(narrow ? 230 : 256, narrow ? 77 : 134, 0);
    emblem.setPosition(narrow ? 126 : 256, narrow ? 174 : 265, 0);
    emblem.width = emblem.height = narrow ? 113 : 162;
    bannerTitle.setPosition(narrow ? 300 : 256, narrow ? 135 : 364, 0);
    bannerTitle.setScale(narrow ? 0.85 : 1);
    departures.setPosition(narrow ? 230 : 256, narrow ? 254 : 467, 0);
    eyebrow.setPosition(narrow ? 52 : 450, narrow ? 314 : 119, 0);
    title.setPosition(narrow ? 49 : 446, narrow ? 350 : 156, 0);
    message.setPosition(narrow ? 52 : 450, narrow ? 407 : 215, 0);
    message.setStyle({ maxWidth: narrow ? 355 : 390 });
    buttonX = narrow ? 230 : 650;
    buttonY = narrow ? 489 : 296;
    resizeButtons();
});
scene.start();
