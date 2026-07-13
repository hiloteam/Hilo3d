import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();

stage.renderer.stencil = true;
const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const textureBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        renderOrder: 0,
        diffuse: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        }),
        depthTest: false,
        stencilTest: true,
        stencilMask: 0xff,
        stencilFunc: Hilo3d.constants.ALWAYS,
        stencilFuncRef: 1,
        stencilFuncMask: 0xff,
        stencilOpFail: Hilo3d.constants.KEEP,
        stencilOpZFail: Hilo3d.constants.REPLACE,
        stencilOpZPass: Hilo3d.constants.REPLACE
    })
});
textureBox.onUpdate = () => {
    textureBox.rotationX += 1;
    textureBox.rotationY += 2;
};
textureBox.setScale(0.95);
stage.addChild(textureBox);

const textureBorderBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        renderOrder: 1,
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(0, 0, 0),
        depthTest: false,
        stencilTest: true,
        stencilMask: 0x00,
        stencilFunc: Hilo3d.constants.EQUAL,
        stencilFuncRef: 0,
        stencilFuncMask: 0xff,
        stencilOpFail: Hilo3d.constants.KEEP,
        stencilOpZFail: Hilo3d.constants.KEEP,
        stencilOpZPass: Hilo3d.constants.KEEP
    })
});
textureBorderBox.onUpdate = () => {
    textureBorderBox.rotationX += 1;
    textureBorderBox.rotationY += 2;
};
stage.addChild(textureBorderBox);
