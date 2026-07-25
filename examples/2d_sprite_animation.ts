import * as Hilo3d from '../src/Hilo3d';
import {
    addMoonlitBackground,
    createGridFrames,
    createMoonlitScene,
    loadMoonlitTexture,
    setTextOrder
} from './shared/moonlit2d';

const BACKGROUND_LAYER = 1 << 2;
const backgroundCamera = new Hilo3d.Camera2D({
    width: innerWidth,
    height: innerHeight,
    visibility: BACKGROUND_LAYER,
    priority: -100,
    clearColor: true
});
const worldCamera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    visibility: 1,
    priority: 0,
    clearColor: false,
    z: 4.5
});
const uiCamera = new Hilo3d.Camera2D({
    width: innerWidth,
    height: innerHeight,
    visibility: Hilo3d.DEFAULT_2D_LAYER,
    priority: 100,
    clearColor: false
});
const scene = await createMoonlitScene([backgroundCamera, worldCamera, uiCamera]);
const { stage } = scene;
const [backgroundTexture, mothTexture, seedTexture] = await Promise.all([
    loadMoonlitTexture('background'),
    loadMoonlitTexture('moth'),
    loadMoonlitTexture('seeds')
]);

addMoonlitBackground(scene, backgroundTexture, BACKGROUND_LAYER);

const moon = new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({
        radius: 0.82,
        widthSegments: 48,
        heightSegments: 24
    }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.08, 0.22, 0.34),
        emission: new Hilo3d.Color(0.01, 0.12, 0.19),
        metallic: 0.72,
        roughness: 0.24
    }),
    z: -0.15
}).addTo(stage);
moon.onUpdate = dt => {
    moon.rotationY += dt * 0.012;
    moon.rotationX += dt * 0.004;
};
stage.addChild(
    new Hilo3d.AmbientLight({
        layer: 1,
        color: new Hilo3d.Color(0.2, 0.38, 0.62),
        amount: 1.1
    })
);
stage.addChild(
    new Hilo3d.DirectionalLight({
        layer: 1,
        color: new Hilo3d.Color(1, 0.8, 0.48),
        amount: 3,
        direction: new Hilo3d.Vector3(-1, -0.7, -1)
    })
);

const generatedFrames = createGridFrames(mothTexture, 8, 1);
const mothFrames = generatedFrames.map(
    frame =>
        new Hilo3d.SpriteFrame({
            texture: mothTexture,
            x: frame.x,
            y: 150,
            width: frame.width,
            height: 410,
            duration: 82
        })
);
const moth = new Hilo3d.Sprite({
    frames: mothFrames,
    width: 265,
    height: 210,
    useHandCursor: true,
    z: 20
}).addTo(stage);
if (moth.material) moth.material.renderOrder = 20;

const title = setTextOrder(
    new Hilo3d.Text2D({
        text: 'THE MOON MOTH',
        style: {
            font: '700 34px Georgia, serif',
            fillStyle: '#fff5d7',
            strokeStyle: '#07162b',
            strokeWidth: 5,
            padding: 8,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5,
        z: 40
    }).addTo(stage),
    100
);
const status = setTextOrder(
    new Hilo3d.Text2D({
        text: 'CLICK THE MOTH TO PAUSE',
        style: {
            font: '650 13px system-ui, sans-serif',
            fillStyle: '#8be7ee',
            strokeStyle: '#07162b',
            strokeWidth: 3,
            padding: 5,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5,
        z: 40
    }).addTo(stage),
    100
);
const backend = setTextOrder(
    new Hilo3d.Text2D({
        text: `${stage.renderer.backend.toUpperCase()} • 3 CAMERAS • 2D + 3D`,
        style: {
            font: '600 11px ui-monospace, monospace',
            fillStyle: '#e8cf91',
            strokeStyle: '#07162b',
            strokeWidth: 3,
            padding: 4,
            resolution: 2,
            textAlign: 'center'
        },
        anchorX: 0.5,
        z: 40
    }).addTo(stage),
    100
);

const seedFrames = createGridFrames(seedTexture, 4, 4);
const decorationIndices = [0, 1, 4, 7, 12, 14] as const;
const decorations = decorationIndices.map((frameIndex, index) => {
    const frame = seedFrames[frameIndex];
    if (!frame) throw new Error('Moonlit seed atlas is incomplete.');
    const sprite = new Hilo3d.Sprite({
        frame,
        width: index % 2 === 0 ? 58 : 46,
        height: index % 2 === 0 ? 58 : 46,
        pointerEnabled: false,
        tint: new Hilo3d.Color(0.82, 0.94, 1, 0.88),
        z: 5
    }).addTo(stage);
    if (sprite.material) sprite.material.renderOrder = 5;
    return sprite;
});

let mothBaseY = innerHeight * 0.52;
let elapsed = 0;
moth.onUpdate = dt => {
    elapsed += dt;
    moth.y = mothBaseY + Math.sin(elapsed * 0.0023) * 12;
    moth.rotationZ = Math.sin(elapsed * 0.0014) * 2;
};
moth.on('click', () => {
    if (moth.playing) {
        moth.pause();
        status.setText('PAUSED • CLICK TO RESUME');
    } else {
        moth.play();
        status.setText('IN FLIGHT • CLICK TO PAUSE');
    }
});
stage.enableDOMEvent('click');

scene.addLayout((width, height) => {
    const compactScale = Math.min(1, width / 720);
    title.setScale(compactScale);
    title.setPosition(width * 0.5, Math.max(28, height * 0.07), 40);
    moth.x = width * 0.5;
    mothBaseY = height * 0.52;
    status.setScale(Math.min(1, width / 500));
    status.setPosition(width * 0.5, height - 72, 40);
    backend.setScale(Math.min(1, width / 520));
    backend.setPosition(width * 0.5, height - 42, 40);
    const radiusX = Math.min(width * 0.34, 360);
    const radiusY = Math.min(height * 0.26, 170);
    for (let index = 0; index < decorations.length; index += 1) {
        const sprite = decorations[index];
        if (!sprite) continue;
        const angle = (index / decorations.length) * Math.PI * 2 - Math.PI * 0.5;
        sprite.x = width * 0.5 + Math.cos(angle) * radiusX;
        sprite.y = height * 0.53 + Math.sin(angle) * radiusY;
    }
});

scene.start();
