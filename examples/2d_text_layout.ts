import * as Hilo3d from '../src/Hilo3d';
import { atlasFrame, loadMoonlitTexture, createGridFrames } from './shared/moonlit2d';
import {
    createStudio,
    createStudioScene,
    createStudioAtlas,
    STUDIO_INSETS,
    studioText
} from './shared/studio2d';

const studio = createStudio(3);
const scene = await createStudioScene(studio);
const atlas = createStudioAtlas();
const seeds = createGridFrames(await loadMoonlitTexture('seeds'), 4, 4);
const root = new Hilo3d.Node().addTo(scene.stage);
const heading = studioText(root, 'Notes from the field.', 570, 58, {
    font: 'italic 40px Georgia, serif',
    textAlign: 'center'
});
heading.anchorX = 0.5;
const subheading = studioText(root, 'A SMALL JOURNAL OF TYPOGRAPHIC POSSIBILITIES', 570, 115, {
    font: '9px ui-monospace, monospace',
    letterSpacing: 2,
    textAlign: 'center',
    fillStyle: '#89aaa0'
});
subheading.anchorX = 0.5;
const copy = [
    [
        '01 / THE OBSERVATION',
        '两种语言，\n同一段旅程。',
        '月光温室 Luminous Garden 的第 12 次观测，在 21:30 开始。\nEvery small discovery deserves a little room to grow.',
        '中英混排 · 实测字形宽度'
    ],
    [
        '02 / THE EXCERPT',
        'A story,\nbeautifully brief.',
        'Somewhere beyond the last lantern, a tiny moth carries a map of all the gardens it has ever visited. Even the longest story can leave a little space for wonder.',
        '最多三行 · 自动省略号'
    ],
    [
        '03 / THE RHYTHM',
        'Space to\nbreathe.',
        'FIELD NOTE  /  024\n星种沿着风的轨迹生长。\nLeave a little silence between the lines.',
        '字间距 · 段落间距'
    ]
] as const;
let requestedWidth = 320;
let tracking = 1;
let maxLines = 3;
let guides = true;
const cards = copy.map(([eyebrow, title, body, note], index) => {
    const group = new Hilo3d.Node().addTo(root);
    const panel = new Hilo3d.SlicedSprite({
        frame: atlas.paper,
        insets: STUDIO_INSETS,
        width: 320,
        height: 360,
        anchorX: 0,
        anchorY: 0,
        pointerEnabled: false
    }).addTo(group);
    studioText(group, eyebrow, 24, 27, {
        font: '9px ui-monospace, monospace',
        fillStyle: '#808571',
        letterSpacing: 1
    });
    const titleNode = studioText(group, title, 23, 65, {
        font: '29px Georgia, serif',
        lineHeight: 36,
        fillStyle: '#284d42'
    });
    const bodyNode = studioText(group, body, 24, 165, {
        font: '15px system-ui, sans-serif',
        maxWidth: 268,
        lineHeight: 25,
        fillStyle: '#586754',
        maxLines: index === 1 ? 3 : 0,
        overflow: 'ellipsis',
        paragraphSpacing: index === 2 ? 14 : 6,
        letterSpacing: index === 2 ? tracking : 0
    });
    const footnote = studioText(group, note, 24, 323, {
        font: '9px system-ui, sans-serif',
        fillStyle: '#858a73'
    });
    const icon = new Hilo3d.Sprite({
        frame: atlasFrame(seeds, index * 5),
        width: 45,
        height: 45,
        x: 271,
        y: 95,
        sortingLayer: 110,
        pointerEnabled: false
    }).addTo(group);
    const guide = new Hilo3d.Sprite({
        frame: atlas.line,
        width: 1,
        height: 139,
        x: 296,
        y: 226,
        tint: new Hilo3d.Color(0.4, 0.65, 0.6, 0.45),
        sortingLayer: 90,
        pointerEnabled: false
    }).addTo(group);
    return { group, panel, titleNode, bodyNode, footnote, icon, guide };
});
const widthMetric = studio.metric('正文可用宽度', '268 px');
let viewportWidth = 1000;
let viewportHeight = 620;
function layout(): void {
    const narrow = viewportWidth < 600;
    const designWidth = narrow ? 400 : 1140;
    const designHeight = narrow ? 1320 : 620;
    const scale = Math.min(viewportWidth / designWidth, viewportHeight / designHeight);
    root.setScale(scale);
    root.setPosition(
        (viewportWidth - designWidth * scale) / 2,
        (viewportHeight - designHeight * scale) / 2,
        0
    );
    heading.x = subheading.x = designWidth / 2;
    heading.setScale(narrow ? 0.83 : 1);
    subheading.setScale(narrow ? 0.58 : 1);
    const cardWidth = Math.min(requestedWidth, narrow ? 364 : 354);
    const textWidth = cardWidth - 52;
    cards.forEach((card, index) => {
        card.group.setPosition(
            narrow
                ? (400 - cardWidth) / 2
                : (1140 - cardWidth * 3 - 36) / 2 + index * (cardWidth + 18),
            narrow ? 175 + index * 375 : 184,
            0
        );
        card.panel.setSize(cardWidth, 356);
        card.bodyNode.setStyle({
            maxWidth: textWidth,
            maxLines: index === 1 ? maxLines : 5,
            letterSpacing: index === 2 ? tracking : 0
        });
        card.titleNode.setStyle({ maxWidth: cardWidth - 58 });
        card.icon.x = cardWidth - 45;
        card.icon.visible = cardWidth >= 305;
        card.guide.x = cardWidth - 25;
        card.guide.visible = guides;
    });
    widthMetric.value = `${String(Math.round(textWidth))} px`;
    document.body.dataset['textWidth'] = String(textWidth);
}
studio.section('THE TYPE SETTER', '拖动栏宽观察真实换行；三张卡片分别展示混排、截断和排版节奏。');
studio.range(
    '卡片宽度',
    260,
    354,
    requestedWidth,
    2,
    value => {
        requestedWidth = value;
        layout();
    },
    ' px'
);
studio.range('摘录最多行数', 1, 5, 3, 1, value => {
    maxLines = value;
    layout();
    document.body.dataset['maxLines'] = String(value);
});
studio.range(
    '第三栏字距',
    0,
    3,
    tracking,
    0.25,
    value => {
        tracking = value;
        layout();
    },
    ' px'
);
studio.toggle('显示排版边界', guides, value => {
    guides = value;
    layout();
});
studio.section(
    'A LIVE MARGIN',
    '卡片与文字都在引擎画布中。窄屏自动堆叠，仍使用相同的 Text2D 内容。'
);
studio.metric('测量', 'Canvas.measureText');
studio.metric('溢出策略', 'ellipsis');
studio.status.textContent = 'LIVE TYPESET · 改变栏宽，观察每一行的重新排列';
scene.addLayout((width, height) => {
    viewportWidth = width;
    viewportHeight = height;
    layout();
});
scene.start();
