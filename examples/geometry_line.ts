import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = createExampleContext();

const material = new Hilo3d.BasicMaterial({
    diffuse: new Hilo3d.Color(1, 0, 0),
    lightType: 'NONE'
});
const geometry = new Hilo3d.Geometry({ mode: Hilo3d.constants.LINES });
geometry.addPoints([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
geometry.addIndices(0, 1, 0, 2, 0, 3);

const mesh = new Hilo3d.Mesh({
    geometry,
    material,
    rotationX: 30,
    rotationY: 30
});
stage.addChild(mesh);
