import {
    CanvasText,
    SpriteRenderer,
    createCanvasTextSystem,
    createSpriteRenderer,
    type Entity,
    type SpriteFrame
} from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import {
    createGridFrames,
    createSpriteEntity,
    createTextEntity,
    loadExampleTexture
} from './shared/twoD';

const runtime = await createExampleRuntime([createCanvasTextSystem()]);
runtime.engine.renderer.clearColor.set(0.03, 0.09, 0.12, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 5.2, 0, Math.PI / 2);
const atlas = await loadExampleTexture(
    new URL('./image/2d/postal-ui-buttons.png', import.meta.url).href
);
const frames = createGridFrames(atlas, 4, 1);
const up = frames[0];
const hover = frames[1];
const down = frames[2];
const disabled = frames[3];
if (!up || !hover || !down || !disabled) throw new Error('Postal UI atlas is incomplete.');
createSpriteEntity(
    runtime.world,
    { frame: up, width: 4.2, height: 3.45 },
    { position: [0, 0, -0.5] },
    -10
);
createTextEntity(
    runtime.world,
    {
        text: 'MAPLE POST GUILD',
        font: '800 28px ui-monospace',
        fillStyle: '#513019',
        padding: 8,
        resolution: 2
    },
    { position: [0, 1.28, 0.2], scale: [0.004, 0.004, 0.004] }
);
const message = createTextEntity(
    runtime.world,
    {
        text: 'Choose a dispatch route.',
        font: '600 15px system-ui',
        fillStyle: '#59391f',
        padding: 5,
        resolution: 2
    },
    { position: [0, 0.83, 0.2], scale: [0.0038, 0.0038, 0.0038] }
);
const routes = [
    { label: 'HARBOR ROUTE', result: 'Harbor dispatch queued — 8 parcels.', y: 0.22 },
    { label: 'FOREST ROUTE', result: 'Forest dispatch queued — 12 parcels.', y: -0.48 }
] as const;
const buttons: { readonly entity: Entity; readonly y: number; readonly result: string }[] = [];
for (const route of routes) {
    const entity = createSpriteEntity(
        runtime.world,
        { frame: up, width: 2.65, height: 0.58 },
        { position: [0, route.y, 0] },
        20
    );
    buttons.push({ entity, y: route.y, result: route.result });
    createTextEntity(
        runtime.world,
        {
            text: route.label,
            font: '800 15px ui-monospace',
            fillStyle: '#4c2c16',
            padding: 4,
            resolution: 2
        },
        { position: [0, route.y, 0.2], scale: [0.0035, 0.0035, 0.0035] },
        30
    );
}
createSpriteEntity(
    runtime.world,
    { frame: disabled, width: 2.65, height: 0.58 },
    { position: [0, -1.18, 0] },
    20
);
createTextEntity(
    runtime.world,
    {
        text: 'MOUNTAIN — LOCKED',
        font: '800 15px ui-monospace',
        fillStyle: '#6c6259',
        padding: 4,
        resolution: 2
    },
    { position: [0, -1.18, 0.2], scale: [0.0035, 0.0035, 0.0035] },
    30
);

function buttonAt(event: PointerEvent): (typeof buttons)[number] | undefined {
    const bounds = runtime.engine.canvas.getBoundingClientRect();
    const worldX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 6.7;
    const worldY = (0.5 - (event.clientY - bounds.top) / bounds.height) * 4;
    return buttons.find(button => Math.abs(worldX) < 1.35 && Math.abs(worldY - button.y) < 0.32);
}

function setButtonFrame(entity: Entity, frame: SpriteFrame): void {
    runtime.world.set(
        entity,
        SpriteRenderer,
        createSpriteRenderer({ frame, width: 2.65, height: 0.58 })
    );
}
runtime.engine.canvas.addEventListener('pointermove', event => {
    const active = buttonAt(event);
    for (const button of buttons) setButtonFrame(button.entity, button === active ? hover : up);
    runtime.engine.canvas.style.cursor = active ? 'pointer' : '';
});
runtime.engine.canvas.addEventListener('pointerdown', event => {
    const active = buttonAt(event);
    if (active) setButtonFrame(active.entity, down);
});
runtime.engine.canvas.addEventListener('pointerup', event => {
    const active = buttonAt(event);
    if (!active) return;
    setButtonFrame(active.entity, hover);
    runtime.world.set(message, CanvasText, {
        text: active.result,
        font: '600 15px system-ui',
        fillStyle: '#59391f',
        padding: 5,
        resolution: 2
    });
});
document.querySelector<HTMLElement>('#loading')?.remove();
document.body.dataset['exampleReady'] = 'true';
runtime.start();
