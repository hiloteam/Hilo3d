import { BasicMaterial, BoxGeometry, Color, LazyTexture, LocalTransform } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const runtime = await createExampleRuntime();
const backend = runtime.engine.renderer.backend;
const info = document.getElementById('info');
if (!info) throw new Error('Graphics support example requires #info.');
info.textContent = [
    `Selected backend: ${backend}`,
    `WebGL 2: ${backend === 'webgl2' ? 'available (active context)' : 'not selected'}`,
    `WebGPU: ${backend === 'webgpu' ? 'available (active adapter/device)' : 'not selected'}`
].join('\n');
const geometry = new BoxGeometry();
const colorBox = createMeshEntity(runtime.world, {
    geometry,
    material: new BasicMaterial({ diffuse: new Color(0.8, 0, 0) }),
    position: [-1, 0, 0]
});
const textureBox = createMeshEntity(runtime.world, {
    geometry,
    material: new BasicMaterial({
        diffuse: new LazyTexture({ src: new URL('./image/UV_Grid_Sm.jpg', import.meta.url).href })
    }),
    position: [1, 0, 0]
});
runtime.start(time => {
    runtime.world.set(colorBox, LocalTransform, {
        position: [-1, 0, 0],
        rotation: quaternionFromDegrees(time * 30, time * 30)
    });
    runtime.world.set(textureBox, LocalTransform, {
        position: [1, 0, 0],
        rotation: quaternionFromDegrees(time * 30, 0, time * 30)
    });
});
