import * as Hilo3d from '../src/Hilo3d';
import {
    atlasFrame,
    addMoonlitBackground,
    createGridFrames,
    loadMoonlitTexture
} from './shared/moonlit2d';
import { createStudio, createStudioScene, fitStudioRoot, studioText } from './shared/studio2d';

const studio = createStudio(0);
const BACKGROUND_LAYER = 1 << 2;
const backgroundCamera = new Hilo3d.Camera2D({
    width: 1000,
    height: 620,
    visibility: BACKGROUND_LAYER,
    priority: -100,
    clearColor: true
});
const worldCamera = new Hilo3d.PerspectiveCamera({
    aspect: 1.6,
    visibility: 1,
    priority: 0,
    clearColor: false,
    z: 5
});
const uiCamera = new Hilo3d.Camera2D({
    width: 1000,
    height: 620,
    priority: 100,
    clearColor: false
});
const scene = await createStudioScene(studio, [backgroundCamera, worldCamera, uiCamera]);
const { stage, ticker } = scene;
const [backgroundTexture, mothTexture, seedTexture] = await Promise.all([
    loadMoonlitTexture('background'),
    loadMoonlitTexture('moth'),
    loadMoonlitTexture('seeds')
]);
addMoonlitBackground(scene, backgroundTexture, BACKGROUND_LAYER);
const root = new Hilo3d.Node().addTo(stage);
fitStudioRoot(scene, root);
const frames = createGridFrames(mothTexture, 8, 1).map(
    frame =>
        new Hilo3d.SpriteFrame({
            texture: mothTexture,
            x: frame.x,
            y: 195,
            width: frame.width,
            height: 310
        })
);
const moth = new Hilo3d.Sprite({
    frames,
    width: 290,
    height: 331,
    x: 500,
    y: 322,
    sortingLayer: 20,
    useHandCursor: true,
    frameRate: 12
}).addTo(root);
const reflection = new Hilo3d.Sprite({
    frames,
    width: 220,
    height: 110,
    x: 500,
    y: 477,
    sortingLayer: 10,
    autoPlay: false,
    pointerEnabled: false,
    tint: new Hilo3d.Color(0.55, 0.77, 0.78, 0.2),
    scaleY: -1
}).addTo(root);

// A real PBR object in the middle camera makes 2D / 3D composition directly inspectable.
const orrery = new Hilo3d.Node().addTo(stage);
const gemMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.15, 0.54, 0.47),
    metallic: 0.75,
    roughness: 0.23
});
for (let index = 0; index < 5; index++) {
    const angle = (index / 5) * Math.PI * 2;
    new Hilo3d.Mesh({
        geometry: new Hilo3d.SphereGeometry({
            radius: 0.075 + index * 0.012,
            widthSegments: 20,
            heightSegments: 12
        }),
        material: gemMaterial,
        x: Math.cos(angle) * 0.97,
        y: Math.sin(angle) * 0.65 - 0.2
    }).addTo(orrery);
}
stage.addChild(new Hilo3d.AmbientLight({ color: new Hilo3d.Color(0.4, 0.65, 0.64), amount: 1.8 }));
stage.addChild(
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.78, 0.42),
        amount: 3,
        direction: new Hilo3d.Vector3(-1, -0.7, -1)
    })
);

const seedFrames = createGridFrames(seedTexture, 4, 4);
const sparks = Array.from({ length: 54 }, (_, index) =>
    new Hilo3d.Sprite({
        frame: atlasFrame(seedFrames, index % 16),
        width: 9 + (index % 12),
        height: 9 + (index % 12),
        sortingLayer: 5,
        pointerEnabled: false,
        tint: new Hilo3d.Color(1, 0.9, 0.68, 0.5)
    }).addTo(root)
);
studioText(root, 'L U N A   /   N o .  0 1', 500, 50, {
    font: '11px ui-monospace, monospace',
    textAlign: 'center'
}).anchorX = 0.5;
const caption = studioText(root, 'The keeper of small lights', 500, 548, {
    font: 'italic 25px Georgia, serif',
    textAlign: 'center',
    strokeStyle: '#122b33',
    strokeWidth: 3
});
caption.anchorX = 0.5;

studio.section('FLIGHT STUDY', '点击月蛾暂停。下方时间轴可以检查图集中的每一帧。');
const play = studio.button('暂停动画  /  Pause', togglePlayback);
studio.range(
    '播放帧率',
    1,
    24,
    12,
    1,
    value => {
        moth.frameRate = value;
    },
    ' fps'
);
let size = 1;
studio.range(
    '精灵缩放',
    0.6,
    1.5,
    1,
    0.05,
    value => {
        size = value;
    },
    '×'
);
studio.select('色彩调制', ['Moonlight', 'Rose gold', 'Glacier'], 'Moonlight', value => {
    if (value === 'Rose gold') moth.tint.set(1, 0.68, 0.6, 1);
    else if (value === 'Glacier') moth.tint.set(0.58, 0.9, 1, 1);
    else moth.tint.set(1, 1, 1, 1);
});
studio.section('COMPOSITION', '背景 → 3D 天体 → 2D 月蛾与文字；在同一应用帧内合成。');
studio.toggle('显示 3D 天体', true, value => {
    orrery.visible = value;
});
studio.toggle('显示漂浮星种', true, value => {
    for (const spark of sparks) spark.visible = value;
});
studio.metric('相机层', '2D / 3D / 2D');
const currentFrame = studio.metric('当前图集帧', '01 / 08');
const frameButtons = frames.map((_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(index + 1).padStart(2, '0');
    button.setAttribute('aria-label', `Frame ${String(index + 1)}`);
    button.addEventListener('click', () => {
        moth.pause();
        moth.gotoFrame(index);
        updatePlayback();
    });
    studio.transport.append(button);
    return button;
});
function updatePlayback(): void {
    play.textContent = moth.playing ? '暂停动画  /  Pause' : '播放动画  /  Play';
    document.body.dataset['playing'] = String(moth.playing);
    studio.status.textContent = moth.playing
        ? 'IN FLIGHT · 点击月蛾或选择一帧'
        : 'PAUSED · 选择一帧，观察双翼变化';
}
function togglePlayback(): void {
    if (moth.playing) moth.pause();
    else moth.play();
    updatePlayback();
}
moth.on('click', togglePlayback);
stage.enableDOMEvent('click');
let elapsed = 0;
let displayedFrame = -1;
ticker.addTick({
    tick(dt): void {
        if (moth.playing) elapsed += Math.min(dt, 50);
        moth.y = 315 + Math.sin(elapsed * 0.0014) * 13;
        moth.rotationZ = Math.sin(elapsed * 0.001) * 4;
        moth.setScale(size);
        reflection.gotoFrame(moth.currentFrame);
        reflection.tint.a = 0.15 + Math.sin(elapsed * 0.0014) * 0.03;
        orrery.rotationZ = elapsed * 0.003;
        for (let index = 0; index < sparks.length; index++) {
            const spark = sparks[index];
            if (!spark) continue;
            const angle = index * 2.39996 + elapsed * 0.00009;
            const radius = 130 + (index % 11) * 18;
            spark.x = 500 + Math.cos(angle) * radius;
            spark.y = 325 + Math.sin(angle) * radius * 0.62;
        }
        if (displayedFrame !== moth.currentFrame) {
            displayedFrame = moth.currentFrame;
            currentFrame.value = `${String(displayedFrame + 1).padStart(2, '0')} / 08`;
            document.body.dataset['frame'] = String(displayedFrame);
            frameButtons.forEach((button, index) => {
                button.setAttribute('aria-pressed', String(index === displayedFrame));
            });
        }
    }
});
if (matchMedia('(prefers-reduced-motion: reduce)').matches) moth.pause();
updatePlayback();
scene.start();
