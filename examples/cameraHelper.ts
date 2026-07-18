import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import { createTexturePreview } from './shared/ScreenMesh';

const { stage, renderer } = await createExampleContext();

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
    })
});
colorBox.onUpdate = () => {
    colorBox.rotationX += 0.5;
    colorBox.rotationY += 0.5;
};
colorBox.setScale(0.3);
stage.addChild(colorBox);

const testCamera = new Hilo3d.PerspectiveCamera({
    aspect: innerWidth / innerHeight,
    far: 1.5,
    near: 0.5,
    x: 1,
    rotationY: 90
});

Hilo3d.Tween.to(
    testCamera,
    {
        fov: 20
    },
    {
        duration: 1500,
        reverse: true,
        loop: true
    }
);

const cameraHelper = new Hilo3d.CameraHelper({
    camera: testCamera,
    color: new Hilo3d.Color(0.3, 0.6, 0.9)
});

stage.addChild(cameraHelper);

const cameraTarget = renderer.createRenderTarget({
    width: renderer.width,
    height: renderer.height,
    colorAttachments: [
        {
            clearValue: { r: 1, g: 1, b: 1, a: 1 }
        }
    ],
    label: 'CameraHelper.preview'
});
const previewSize = 0.4;
const preview = createTexturePreview(
    () => cameraTarget.getColorTexture(),
    { x: 1 - previewSize, y: 1 - previewSize, width: previewSize, height: previewSize },
    'CameraHelper.preview'
);
stage.addChild(preview);

stage.onUpdate = () => {
    if (cameraTarget.width !== renderer.width || cameraTarget.height !== renderer.height) {
        cameraTarget.resize(renderer.width, renderer.height);
    }
    preview.visible = false;
    try {
        renderer.renderToTarget(cameraTarget, stage, testCamera, false);
    } finally {
        preview.visible = true;
    }
};
