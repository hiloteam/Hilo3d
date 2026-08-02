import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext({ stage: { stencil: true } });
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
        diffuse: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        }),
        state: {
            depthTest: false,
            stencil: {
                front: {
                    compare: 'always',
                    failOp: 'keep',
                    depthFailOp: 'replace',
                    passOp: 'replace'
                },
                back: {
                    compare: 'always',
                    failOp: 'keep',
                    depthFailOp: 'replace',
                    passOp: 'replace'
                },
                readMask: 0xff,
                writeMask: 0xff,
                reference: 1
            }
        }
    }),
    renderOrder: 0
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
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(0, 0, 0),
        state: {
            depthTest: false,
            stencil: {
                front: {
                    compare: 'equal',
                    failOp: 'keep',
                    depthFailOp: 'keep',
                    passOp: 'keep'
                },
                back: {
                    compare: 'equal',
                    failOp: 'keep',
                    depthFailOp: 'keep',
                    passOp: 'keep'
                },
                readMask: 0xff,
                writeMask: 0,
                reference: 0
            }
        }
    }),
    renderOrder: 1
});
textureBorderBox.onUpdate = () => {
    textureBorderBox.rotationX += 1;
    textureBorderBox.rotationY += 2;
};
stage.addChild(textureBorderBox);
