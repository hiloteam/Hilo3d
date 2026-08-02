import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const queriedCanvas = document.querySelector<HTMLCanvasElement>('#interface-canvas');
if (!queriedCanvas) throw new Error('Canvas texture example requires #interface-canvas.');
const canvas: HTMLCanvasElement = queriedCanvas;
const queriedContext = canvas.getContext('2d');
if (!queriedContext) throw new Error('Canvas texture example requires a 2D rendering context.');
const context: CanvasRenderingContext2D = queriedContext;

const { stage } = await createExampleContext({
    camera: { z: 4 },
    controls: { enablePan: true }
});

const texture = new Hilo3d.Texture({
    image: canvas,
    autoUpdate: true,
    wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
    wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
});
const material = new Hilo3d.BasicMaterial({
    diffuse: texture,
    lightType: 'NONE',
    cullMode: 'none'
});
const display = new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 1.5, height: 2.668 }),
    material
});
display.addTo(stage);

function drawInterface(elapsed: number): void {
    const width = canvas.width;
    const height = canvas.height;
    const pulse = (Math.sin(elapsed * 0.002) + 1) * 0.5;

    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#101b35');
    background.addColorStop(1, '#24114d');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    context.fillStyle = '#f7f9ff';
    context.font = '600 34px system-ui, sans-serif';
    context.fillText('Hilo3d', 28, 60);
    context.fillStyle = '#9ca9c8';
    context.font = '18px system-ui, sans-serif';
    context.fillText('Live CanvasTexture dashboard', 28, 92);

    const cards = [
        { label: 'Frame', value: String(Math.floor(elapsed / 16.67)), color: '#60a5fa' },
        { label: 'Signal', value: `${String(Math.round(pulse * 100))}%`, color: '#a78bfa' },
        { label: 'Mode', value: 'ESM', color: '#34d399' }
    ];
    cards.forEach((card, index) => {
        const y = 130 + index * 108;
        context.fillStyle = 'rgba(255, 255, 255, 0.08)';
        context.fillRect(24, y, width - 48, 84);
        context.fillStyle = card.color;
        context.fillRect(24, y, 6, 84);
        context.fillStyle = '#aeb9d4';
        context.font = '16px system-ui, sans-serif';
        context.fillText(card.label, 48, y + 30);
        context.fillStyle = '#ffffff';
        context.font = '600 28px system-ui, sans-serif';
        context.fillText(card.value, 48, y + 64);
    });

    context.strokeStyle = `rgba(96, 165, 250, ${String(0.45 + pulse * 0.5)})`;
    context.lineWidth = 5;
    context.beginPath();
    context.arc(width / 2, 535, 62, -Math.PI / 2, -Math.PI / 2 + pulse * Math.PI * 2);
    context.stroke();
}

let elapsed = 0;
display.onUpdate = deltaTime => {
    elapsed += deltaTime;
    drawInterface(elapsed);
    display.rotationY = Math.sin(elapsed * 0.0006) * 12;
};
drawInterface(0);
