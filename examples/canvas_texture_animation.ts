import { BasicMaterial, PlaneGeometry, Texture } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity } from './shared/scene';

const canvas = document.querySelector<HTMLCanvasElement>('#animation-canvas');
if (!canvas) throw new Error('Canvas animation example requires #animation-canvas.');
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas animation example requires a 2D context.');
const runtime = await createExampleRuntime();
const fish = Array.from({ length: 12 }, (_, index) => ({
    x: (index / 12) * canvas.width,
    y: 90 + ((index * 97) % (canvas.height - 180)),
    speed: 35 + (index % 5) * 11,
    size: 13 + (index % 4) * 4,
    hue: 175 + index * 12
}));
const texture = new Texture({ image: canvas, autoUpdate: true });
createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 1.5, height: 2.668 }),
    material: new BasicMaterial({ diffuse: texture, lightType: 'NONE', cullMode: 'none' })
});
runtime.start(time => {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#082f49');
    gradient.addColorStop(1, '#020617');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const item of fish) {
        item.x = (item.x + item.speed / 60) % (canvas.width + item.size * 3);
        context.fillStyle = `hsl(${String(item.hue)} 78% 62%)`;
        context.beginPath();
        context.ellipse(
            item.x,
            item.y + Math.sin(time * 4 + item.y) * 4,
            item.size * 1.45,
            item.size,
            0,
            0,
            Math.PI * 2
        );
        context.fill();
    }
    context.fillStyle = '#fff';
    context.font = '600 22px system-ui';
    context.fillText('Canvas 2D → GPU texture', 22, 38);
});
