import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { stage } = createExampleContext();

const container = new Hilo3d.Node();
const material = new Hilo3d.BasicMaterial({ diffuse: new Hilo3d.Color(1, 0, 0) });
const geometry = new Hilo3d.Geometry();

geometry.addFace([-0.5, -0.289, 0], [0, 0.577, 0], [0.5, -0.289, 0]);
geometry.addFace([-0.5, -0.289, 0], [0.5, -0.289, 0], [0, 0, 0.9]);
geometry.addFace([-0.5, -0.289, 0], [0, 0, 0.9], [0, 0.577, 0]);
geometry.addFace([0, 0.577, 0], [0, 0, 0.9], [0.5, -0.289, 0]);
const mesh = new Hilo3d.Mesh({
    geometry,
    material
});
container.addChild(mesh);

container.addChild(new Hilo3d.AxisHelper());
stage.addChild(container);
