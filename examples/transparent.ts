import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage } = createExampleContext();

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const container = new Hilo3d.Node({
    rotationY: -70
}).addTo(stage);
const totalNum = 8;
let n = totalNum;
while (n--) {
    const box = new Hilo3d.Mesh({
        geometry: boxGeometry,
        material: new Hilo3d.BasicMaterial({
            transparent: true,
            transparency: 0.5,
            diffuse: new Hilo3d.Color(Math.random(), Math.random(), Math.random())
        }),
        x: -totalNum * 0.5 + n + 0.2,
        rotationX: n * 36
    });
    box.onUpdate = () => {
        box.rotationX += 0.5;
    };
    container.addChild(box);
}
stage.setScale(0.4);
