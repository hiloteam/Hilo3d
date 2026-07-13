import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './js/init';

const { camera, stage } = createExampleContext();

const geometry = new Hilo3d.PlaneGeometry({
    width: 50,
    height: 50,
    heightSegments: 32,
    widthSegments: 64
});

camera.z = 90;
camera.far = 1000;

const data = new Float32Array(128);
for (let i = 0; i < 128; i++) {
    data[i] = Math.random() * 2;
}

const material = new Hilo3d.BasicMaterial({
    diffuse: new Hilo3d.DataTexture({ data }),
    side: Hilo3d.constants.FRONT_AND_BACK
});
const colorBox = new Hilo3d.Mesh({
    geometry,
    material
});
colorBox.onUpdate = () => {
    for (let i = 0; i < 128; i += 1) data[i] = Math.random() * 2;
    const texture = material.diffuse;
    if (texture instanceof Hilo3d.Texture) texture.needUpdate = true;
};
stage.addChild(colorBox);
