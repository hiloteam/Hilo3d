import { createCanvasTextSystem } from 'hilo3d';
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
const panelFrame = createGridFrames(atlas, 4, 1)[0];
if (!panelFrame) throw new Error('Postal UI atlas is incomplete.');
createTextEntity(
    runtime.world,
    {
        text: 'MEASURED TEXT LAYOUT',
        font: '800 30px ui-monospace',
        fillStyle: '#fff0bd',
        padding: 8,
        resolution: 2
    },
    { position: [0, 1.55, 0.3], scale: [0.004, 0.004, 0.004] }
);
createTextEntity(
    runtime.world,
    {
        text: 'REAL GLYPH WIDTH • CJK WRAP • MAX LINES • ELLIPSIS',
        font: '700 11px ui-monospace',
        fillStyle: '#9de2d2',
        padding: 5,
        resolution: 2
    },
    { position: [0, 1.25, 0.3], scale: [0.004, 0.004, 0.004] }
);
const cards = [
    ['01  中英混排自动换行', '枫叶镇 Maple Post courier\n需要在 18:30 前送达 12 个包裹。'],
    [
        '02  最多三行与省略号',
        'Priority dispatch: northern bridge closed.\nChoose the forest route…'
    ],
    ['03  字距与段落间距', 'TRACKING MP-2048\n纹理只在文字或样式变化时重新栅格化。']
] as const;
for (let index = 0; index < cards.length; index += 1) {
    const copy = cards[index];
    if (!copy) continue;
    const x = (index - 1) * 2.05;
    createSpriteEntity(
        runtime.world,
        { frame: panelFrame, width: 1.85, height: 2.05 },
        { position: [x, -0.05, 0] },
        0
    );
    createTextEntity(
        runtime.world,
        {
            text: copy[0],
            font: '800 15px system-ui',
            fillStyle: '#55321a',
            padding: 4,
            resolution: 2
        },
        { position: [x, 0.55, 0.2], scale: [0.0032, 0.0032, 0.0032] }
    );
    const lines = copy[1].split('\n');
    lines.forEach((line, lineIndex) => {
        createTextEntity(
            runtime.world,
            {
                text: line,
                font: '600 12px system-ui',
                fillStyle: '#573b27',
                padding: 4,
                resolution: 2
            },
            { position: [x, 0.1 - lineIndex * 0.28, 0.2], scale: [0.0028, 0.0028, 0.0028] }
        );
    });
}
document.querySelector<HTMLElement>('#loading')?.remove();
document.body.dataset['exampleReady'] = 'true';
runtime.start();
