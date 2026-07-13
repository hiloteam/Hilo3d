import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage, renderer } = createExampleContext();

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

const framebuffer = new Hilo3d.Framebuffer(renderer, {
    width: renderer.width,
    height: renderer.height
});

const clearColor = new Hilo3d.Color(1, 1, 1);
renderer.on('afterRender', function () {
    const currentCamera = testCamera;
    const stageCamera = stage.camera;
    if (!stageCamera) throw new Error('Camera helper example requires a stage camera');

    framebuffer.bind();
    renderer.state.viewport(0, 0, framebuffer.width, framebuffer.height);
    renderer.clear(clearColor);
    currentCamera.updateViewProjectionMatrix();
    Hilo3d.semantic.setCamera(currentCamera);
    renderer.renderScene();
    framebuffer.unbind();
    Hilo3d.semantic.setCamera(stageCamera);
    renderer.viewport();
    const size = 0.4;
    framebuffer.render(1 - size, 1 - size, size, size);
});
