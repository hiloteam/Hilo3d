import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext, resolveExampleBackend } from './shared/init';

const backend = resolveExampleBackend();
const { stage } = await createExampleContext({ backend });

const info = document.getElementById('info');
if (!info) throw new Error('WebGL support example requires #info');
info.textContent = [
    `Selected backend: ${backend}`,
    `WebGL 2: ${backend === 'webgl2' ? 'available (active context)' : 'not probed'}`,
    `WebGPU: ${backend === 'webgpu' ? 'available (active adapter/device)' : 'not probed'}`
].join('\n');

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
    textureBox.rotationX += 0.5;
    textureBox.rotationZ += 0.5;
};
stage.addChild(textureBox);
