import { BasicMaterial, Matrix3, PlaneGeometry, Texture } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

function createSpriteSheet(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 174;
    canvas.height = 1512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Sprite animation requires a 2D canvas context.');
    const frameHeight = canvas.height / 12;
    for (let frame = 0; frame < 12; frame += 1) {
        const y = frame * frameHeight;
        context.fillStyle = `hsl(${String(190 + frame * 8)} 70% 24%)`;
        context.fillRect(0, y, canvas.width, frameHeight);
        context.save();
        context.translate(87, y + frameHeight / 2);
        context.rotate(Math.sin((frame / 12) * Math.PI * 2) * 0.12);
        context.fillStyle = `hsl(${String(25 + frame * 6)} 85% 62%)`;
        context.beginPath();
        context.ellipse(0, 0, 48, 30, 0, 0, Math.PI * 2);
        context.fill();
        context.beginPath();
        context.moveTo(-40, 0);
        context.lineTo(-72, -27);
        context.lineTo(-72, 27);
        context.closePath();
        context.fill();
        context.fillStyle = '#111827';
        context.beginPath();
        context.arc(22, -7, 4, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }
    return canvas;
}

const runtime = await createExampleRuntime();
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 2.5, 0, Math.PI / 2);
const transform = new Matrix3();
const material = new BasicMaterial({
    lightType: 'NONE',
    cullMode: 'none',
    diffuse: {
        texture: new Texture({ flipY: true, image: createSpriteSheet() }),
        transform
    },
    compositing: { mode: 'alpha-blend', premultiplied: true }
});
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry(),
    material,
    scale: [1.15, 1.15, 1.15]
});
let activeFrame = -1;
runtime.start(time => {
    const frame = Math.floor(time / 0.16) % 12;
    if (frame === activeFrame) return;
    activeFrame = frame;
    transform.set(1, 0, 0, 0, 1 / 12, 0, 0, 1 - 1 / 12 - frame / 12, 1);
    material.invalidateData();
});
