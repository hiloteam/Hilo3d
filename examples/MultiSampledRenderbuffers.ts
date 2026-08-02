import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import { createTexturePreview } from './shared/ScreenMesh';

const { camera, stage, renderer, ticker } = await createExampleContext();

ticker.targetFPS = 1;
renderer.clearColor = new Hilo3d.Color(0.9, 0.6, 0.3);

const sphereGeometry = new Hilo3d.PlaneGeometry();
const material = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    diffuse: new Hilo3d.Color(1, 1, 1),
    state: { wireframe: true }
});

camera.lookAt(new Hilo3d.Vector3(0, 0, 0));

const sceneNode = new Hilo3d.Node();
const mesh = new Hilo3d.Mesh({
    material,
    geometry: sphereGeometry,
    x: 0,
    y: 0,
    z: 0,
    rotationZ: 30
}).setScale(1.4);
mesh.onUpdate = () => {
    mesh.rotationZ += 6.7;
};
sceneNode.addChild(mesh);

const framebufferWidth = Math.max(1, Math.floor(renderer.width / 32));
const framebufferHeight = Math.max(1, Math.floor(renderer.height / 32));

const sampleCounts = [1, 4] as const;
const renderTargets = sampleCounts.map(sampleCount =>
    renderer.createRenderTarget({
        width: framebufferWidth,
        height: framebufferHeight,
        sampleCount,
        colorAttachments: [
            {
                clearValue: { r: 0.9, g: 0.6, b: 0.3, a: 1 }
            }
        ],
        depthStencilAttachment: { format: 'depth24plus' },
        label: `Multisample.${String(sampleCount)}x`
    })
);

const viewports = [
    { x: 0.025, y: 0.25, width: 0.45, height: 0.5 },
    { x: 0.525, y: 0.25, width: 0.45, height: 0.5 }
] as const;
renderTargets.forEach((target, index) => {
    const viewport = viewports[index];
    if (!viewport) throw new Error('Missing multisample preview viewport.');
    stage.addChild(
        createTexturePreview(
            () => target.getColorTexture(),
            viewport,
            `Multisample.${String(sampleCounts[index])}x.preview`
        )
    );
});

stage.onUpdate = function (deltaTime) {
    sceneNode.traverseUpdate(deltaTime);
    renderTargets.forEach(target => {
        renderer.renderToTarget(target, sceneNode, camera, false);
    });
};
