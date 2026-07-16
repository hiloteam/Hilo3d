import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import { createTexturePreview } from './shared/ScreenMesh';

const { camera, stage, renderer } = await createExampleContext();

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
const texture = new Hilo3d.LazyTexture({
    src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
});
const textureMaterial = new Hilo3d.BasicMaterial({ diffuse: texture.clone() });
const textureBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: textureMaterial,
    x: 1,
    rotationX: 45
});
textureBox.onUpdate = () => {
    textureBox.rotationX += 0.5;
    textureBox.rotationZ += 0.5;
};
stage.addChild(textureBox);

const renderTarget = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height,
    colorAttachments: [
        {
            clearValue: { r: 1, g: 1, b: 1, a: 1 }
        }
    ],
    label: 'RenderTarget.preview'
});
const preview = createTexturePreview(
    () => renderTarget.getColorTexture(),
    { x: 0, y: 0.7, width: 0.3, height: 0.3 },
    'RenderTarget.preview'
);
stage.addChild(preview);

stage.onUpdate = () => {
    if (renderTarget.width !== renderer.width || renderTarget.height !== renderer.height) {
        renderTarget.resize(renderer.width, renderer.height);
    }
    preview.visible = false;
    try {
        renderer.renderToTarget(renderTarget, stage, camera, false);
    } finally {
        preview.visible = true;
    }
};
