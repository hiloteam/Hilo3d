import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

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
