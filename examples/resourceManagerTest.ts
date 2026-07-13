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

let angle = 0;
const axis = new Hilo3d.Vector3(1, 1, 1).normalize();
const textureBox = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({
        diffuse: new Hilo3d.LazyTexture({
            src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href
        })
    }),
    x: 1
});
textureBox.onUpdate = () => {
    angle += Hilo3d.math.DEG2RAD;
    textureBox.quaternion.setAxisAngle(axis, angle);
};
stage.addChild(textureBox);

const sleep = async (time: number): Promise<void> => {
    return new Promise(resolve => {
        setTimeout(resolve, time);
    });
};
void (async () => {
    stage.renderer.onInit(() => {
        stage.renderer.resourceManager.on('destroyResource', e => {
            console.log(`%c - ${String(e.detail)}`, 'color:red');
        });
    });

    const WAIT_TIME = 1000;
    await sleep(WAIT_TIME);
    Hilo3d.logGLResource();

    await sleep(WAIT_TIME);
    colorBox.destroy(renderer, true);
    console.log('\n----------------------------\ncolorBox destroy');
    await sleep(WAIT_TIME);
    Hilo3d.logGLResource();

    await sleep(WAIT_TIME);
    colorBox2.destroy(renderer, true);
    console.log('\n----------------------------\ncolorBox2 destroy');
    await sleep(WAIT_TIME);
    Hilo3d.logGLResource();

    await sleep(WAIT_TIME);
    textureBox.destroy(renderer, true);
    console.log('\n----------------------------\ntextureBox destroy');
    await sleep(WAIT_TIME);
    Hilo3d.logGLResource();

    console.log(`
queryObjects(WebGLBuffer);
queryObjects(WebGLProgram);
queryObjects(Hilo3d.VertexArrayObject);
`);
})().catch((error: unknown) => {
    console.error('Resource manager example failed', error);
});
