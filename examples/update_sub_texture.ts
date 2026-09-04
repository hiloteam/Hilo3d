import { BasicMaterial, PlaneGeometry, Texture } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const runtime = await createExampleRuntime();
const canvas = document.createElement('canvas');
canvas.width = 512;
canvas.height = 512;
const context = canvas.getContext('2d');
if (!context) throw new Error('Update-sub-texture example requires a 2D canvas context.');
context.fillStyle = '#00b894';
context.fillRect(0, 0, 512, 512);
const texture = new Texture({ image: canvas, flipY: true });
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 4, height: 4 }),
    material: new BasicMaterial({ lightType: 'NONE', diffuse: texture, cullMode: 'none' })
});
let tile = 0;
window.setInterval(() => {
    const size = 64;
    const x = (tile % 8) * size;
    const y = Math.floor(tile / 8) * size;
    context.fillStyle = tile % 2 === 0 ? '#55efc4' : '#0984e3';
    context.fillRect(x, y, size, size);
    context.fillStyle = '#07111f';
    context.font = 'bold 28px serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(tile), x + size / 2, y + size / 2);
    texture.updateSubTexture({
        mipLevel: 0,
        x,
        y: texture.flipY ? texture.height - y - size : y,
        width: size,
        height: size,
        image: context.getImageData(x, y, size, size)
    });
    tile = (tile + 1) % 64;
}, 90);
runtime.start();
