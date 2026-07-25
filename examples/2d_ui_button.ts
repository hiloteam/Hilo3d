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
    if (!container) throw new Error('2D UI button example requires #container.');
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
const atlas = await loadPostalUiTexture();
const frames = createPostalButtonFrames(atlas);

const background = new Hilo3d.Sprite({
    texture: createPostalBackground(),
    anchorX: 0,
    anchorY: 0,
    sortingLayer: -100,
    pointerEnabled: false,
    autoPlay: false
}).addTo(stage);
const panel = new Hilo3d.SlicedSprite({
    frame: frames.up,
    insets: POSTAL_UI_INSETS,
    anchorX: 0.5,
    anchorY: 0.5,
    sortingLayer: 0,
    pointerEnabled: false
}).addTo(stage);
const title = new Hilo3d.Text2D({
    text: 'MAPLE POST GUILD',
    style: {
        font: '800 28px ui-monospace, monospace',
        fillStyle: '#513019',
        strokeStyle: '#fff0bd',
        strokeWidth: 3,
        padding: 8,
        letterSpacing: 1,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5,
    anchorY: 0.5,
    sortingLayer: 10,
    pointerEnabled: false
}).addTo(stage);
const message = new Hilo3d.Text2D({
    text: 'Choose a dispatch route.\nCorners stay crisp at every button width.',
    style: {
        font: '600 15px system-ui, sans-serif',
        fillStyle: '#59391f',
        lineHeight: 23,
        maxWidth: 430,
        padding: 5,
        resolution: 2,
        textAlign: 'center'
    },
    anchorX: 0.5,
    anchorY: 0.5,
    sortingLayer: 10,
    pointerEnabled: false
}).addTo(stage);

const buttonStyle: Hilo3d.Text2DStyle = {
    font: '800 15px ui-monospace, monospace',
    fillStyle: '#4c2c16',
    strokeStyle: '#fff5ce',
    strokeWidth: 2,
    padding: 4,
    letterSpacing: 0.8,
    resolution: 2,
    textAlign: 'center'
};
const routes = [
    { label: 'HARBOR ROUTE', result: 'Harbor dispatch queued — 8 parcels.' },
    { label: 'FOREST ROUTE', result: 'Forest dispatch queued — 12 parcels.' }
] as const;
const buttons = routes.map(route =>
    new Hilo3d.UiButton({
        frames,
        insets: POSTAL_UI_INSETS,
        width: 300,
        height: 110,
        anchorX: 0.5,
        anchorY: 0.5,
        label: route.label,
        labelStyle: buttonStyle,
        sortingLayer: 20
    }).addTo(stage)
);
const disabledButton = new Hilo3d.UiButton({
    frames,
    insets: POSTAL_UI_INSETS,
    width: 300,
    height: 110,
    anchorX: 0.5,
    anchorY: 0.5,
    label: 'MOUNTAIN — LOCKED',
    labelStyle: buttonStyle,
    enabled: false,
    sortingLayer: 20
}).addTo(stage);
for (let index = 0; index < buttons.length; index += 1) {
    const button = buttons[index];
    const route = routes[index];
    if (!button || !route) continue;
    button.on('click', () => message.setText(route.result));
}
stage.enableDOMEvent(['pointermove', 'pointerdown', 'pointerup', 'click']);

function resize(): void {
    const width = innerWidth;
    const height = innerHeight;
    stage.resize(width, height);
    camera.resize(width, height);
    background.width = width;
    background.height = height;
    const panelWidth = Math.min(620, Math.max(330, width - 36));
    const panelHeight = Math.min(610, Math.max(500, height - 46));
    panel.setSize(panelWidth, panelHeight);
    panel.setPosition(width * 0.5, height * 0.5, 0);
    title.setPosition(width * 0.5, height * 0.5 - panelHeight * 0.34, 0);
    message.setStyle({ maxWidth: Math.min(430, panelWidth - 90) });
    message.setPosition(width * 0.5, height * 0.5 - panelHeight * 0.19, 0);
    const buttonWidth = Math.min(340, panelWidth - 84);
    const buttonHeight = 110;
    for (let index = 0; index < buttons.length; index += 1) {
        const button = buttons[index];
        if (!button) continue;
        button.setSize(buttonWidth, buttonHeight);
        button.setPosition(width * 0.5, height * 0.5 - 18 + index * 114, 0);
    }
    disabledButton.setSize(buttonWidth, buttonHeight);
    disabledButton.setPosition(width * 0.5, height * 0.5 + 210, 0);
}
window.addEventListener('resize', resize);
resize();

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);
ticker.start();
document.querySelector<HTMLElement>('#loading')?.remove();
document.body.dataset['exampleReady'] = 'true';
console.info(`2D UI buttons use ${stage.renderer.backend}`);
