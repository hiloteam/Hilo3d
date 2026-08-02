import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

const geometry = new Hilo3d.PlaneGeometry();
const colors = [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0];
geometry.colors = new Hilo3d.GeometryData(new Float32Array(colors), 3);
const mesh = new Hilo3d.Mesh({
    geometry,
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        cullMode: 'none'
    })
});
stage.addChild(mesh);
