import { BasicMaterial, LocalTransform, PlaneGeometry, Texture, constants } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const queriedCanvas = document.querySelector<HTMLCanvasElement>('#interface-canvas');
if (!queriedCanvas) throw new Error('Canvas texture example requires #interface-canvas.');
const canvas: HTMLCanvasElement = queriedCanvas;
const queriedContext = canvas.getContext('2d');
if (!queriedContext) throw new Error('Canvas texture example requires a 2D context.');
const context: CanvasRenderingContext2D = queriedContext;
const runtime = await createExampleRuntime();
const texture = new Texture({
    image: canvas,
    autoUpdate: true,
    wrapS: constants.webgl.CLAMP_TO_EDGE,
    wrapT: constants.webgl.CLAMP_TO_EDGE
});
const display = createMeshEntity(runtime.world, {
    geometry: new PlaneGeometry({ width: 1.5, height: 2.668 }),
    material: new BasicMaterial({ diffuse: texture, lightType: 'NONE', cullMode: 'none' })
});
function draw(elapsed: number): void {
    const pulse = (Math.sin(elapsed * 2) + 1) * 0.5;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, '#101b35');
    gradient.addColorStop(1, '#24114d');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f7f9ff';
    context.font = '600 34px system-ui';
    context.fillText('Hilo3D', 28, 60);
    context.fillStyle = '#9ca9c8';
    context.font = '18px system-ui';
    context.fillText('Live CanvasTexture dashboard', 28, 92);
    ['Frame', 'Signal', 'Mode'].forEach((label, index) => {
        const y = 130 + index * 108;
        context.fillStyle = 'rgba(255,255,255,.08)';
        context.fillRect(24, y, canvas.width - 48, 84);
        context.fillStyle = ['#60a5fa', '#a78bfa', '#34d399'][index] ?? '#fff';
        context.fillText(label, 48, y + 45);
    });
    context.strokeStyle = `rgba(96,165,250,${String(0.45 + pulse * 0.5)})`;
    context.lineWidth = 5;
    context.beginPath();
    context.arc(canvas.width / 2, 535, 62, -Math.PI / 2, -Math.PI / 2 + pulse * Math.PI * 2);
    context.stroke();
}
runtime.start(time => {
    draw(time);
    runtime.world.set(display, LocalTransform, {
        rotation: quaternionFromDegrees(0, Math.sin(time * 0.6) * 12)
    });
});
