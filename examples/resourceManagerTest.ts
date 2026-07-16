import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage, renderer } = await createExampleContext();

const diagnosticsPanel = document.createElement('pre');
diagnosticsPanel.id = 'resource-diagnostics';
diagnosticsPanel.style.cssText =
    'position:fixed;left:1rem;top:1rem;margin:0;padding:.75rem;background:#000b;color:#fff;font:12px/1.5 monospace;z-index:2';
document.body.append(diagnosticsPanel);
const diagnosticsLog: string[] = [];

function recordDiagnostics(label: string): void {
    const diagnostics = renderer.resourceManager.getDiagnostics(stage);
    const message = `${label}: ${JSON.stringify(diagnostics)}`;
    diagnosticsLog.push(message);
    diagnosticsPanel.textContent = diagnosticsLog.join('\n');
    console.info(message);
}

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const colorBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.8, 0, 0)
    }),
    x: -1
});
colorBox.onUpdate = () => {
    colorBox.rotationX += 0.5;
    colorBox.rotationY += 0.5;
};
stage.addChild(colorBox);

const colorBox2 = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.Color(0.8, 0, 0)
    }),
    x: -1.2
});
colorBox2.onUpdate = () => {
    colorBox2.rotationX += 0.5;
    colorBox2.rotationY += 0.5;
};
stage.addChild(colorBox2.setScale(0.5));

const texture = new Hilo3d.LazyTexture({
    autoLoad: false,
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
let angle = 0;
const axis = new Hilo3d.Vector3(1, 1, 1).normalize();
const textureBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: texture
    }),
    x: 1
});
textureBox.onUpdate = () => {
    angle += Hilo3d.math.DEG2RAD;
    textureBox.quaternion.setAxisAngle(axis, angle);
};
stage.addChild(textureBox);

function waitForNextRender(): Promise<void> {
    return new Promise(resolve => {
        renderer.on(
            'afterRender',
            () => {
                resolve();
            },
            true
        );
    });
}

void (async () => {
    await texture.load();
    await waitForNextRender();
    recordDiagnostics('initial');

    colorBox.destroy(renderer, true);
    await waitForNextRender();
    recordDiagnostics('colorBox destroyed');

    colorBox2.destroy(renderer, true);
    await waitForNextRender();
    recordDiagnostics('colorBox2 destroyed');

    textureBox.destroy(renderer, true);
    await waitForNextRender();
    recordDiagnostics('textureBox destroyed');

    const postDestroyBox = new Hilo3d.Mesh({
        geometry: new Hilo3d.BoxGeometry(),
        material: new Hilo3d.BasicMaterial({
            diffuse: new Hilo3d.Color(0.1, 0.8, 0.3),
            lightType: 'NONE'
        })
    });
    postDestroyBox.rotationX = 25;
    postDestroyBox.rotationY = 35;
    stage.addChild(postDestroyBox);
    await waitForNextRender();
    recordDiagnostics('post-destroy mesh rendered');
    document.body.dataset['resourceDiagnosticsComplete'] = 'true';
})().catch((error: unknown) => {
    console.error('Resource manager example failed', error);
});
