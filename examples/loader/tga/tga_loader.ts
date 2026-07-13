import * as Hilo3d from '../../../src/Hilo3d';
import { createExampleContext } from '../../shared/init';
import TGALoader from './TGALoader';

const { stage } = createExampleContext();

const boxGeometry = new Hilo3d.BoxGeometry();
boxGeometry.setAllRectUV([
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0]
]);

const tgaLoader = new TGALoader();
const diffuse = await tgaLoader.load({
    src: 'data:application/octet-stream;base64,AAACAAAAAAAAAAAAAgACABggAAD/AP8A/wAA////'
});
const box = new Hilo3d.Mesh({
    geometry: boxGeometry,
    material: new Hilo3d.BasicMaterial({ diffuse })
});
box.onUpdate = () => {
    box.rotationX += 0.5;
    box.rotationZ += 0.5;
};
stage.addChild(box);
