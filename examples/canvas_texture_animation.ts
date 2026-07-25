import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

interface Fish {
    x: number;
    y: number;
    speed: number;
    size: number;
    hue: number;
}

const queriedCanvas = document.querySelector<HTMLCanvasElement>('#animation-canvas');
if (!queriedCanvas) throw new Error('Canvas animation example requires #animation-canvas.');
const canvas: HTMLCanvasElement = queriedCanvas;
const queriedContext = canvas.getContext('2d');
if (!queriedContext) throw new Error('Canvas animation example requires a 2D rendering context.');
const context: CanvasRenderingContext2D = queriedContext;

const { stage } = await createExampleContext({ camera: { z: 4 } });
const fish: Fish[] = Array.from({ length: 12 }, (_, index) => ({
    x: (index / 12) * canvas.width,
    y: 90 + ((index * 97) % (canvas.height - 180)),
    speed: 35 + (index % 5) * 11,
    size: 13 + (index % 4) * 4,
    hue: 175 + index * 12
}));

const texture = new Hilo3d.Texture({ image: canvas, autoUpdate: true });
const screen = new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 1.5, height: 2.668 }),
    material: new Hilo3d.BasicMaterial({
        diffuse: texture,
        lightType: 'NONE',
        side: Hilo3d.constants.FRONT_AND_BACK
    })
});
screen.addTo(stage);

function drawFish(item: Fish, elapsed: number): void {
    const wobble = Math.sin(elapsed * 0.004 + item.y) * 4;
    context.save();
    context.translate(item.x, item.y + wobble);
    context.fillStyle = `hsl(${String(item.hue)} 78% 62%)`;
    context.beginPath();
    context.ellipse(0, 0, item.size * 1.45, item.size, 0, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.moveTo(-item.size * 1.2, 0);
    context.lineTo(-item.size * 2.2, -item.size);
    context.lineTo(-item.size * 2.2, item.size);
    context.closePath();
    context.fill();
    context.fillStyle = '#071525';
    context.beginPath();
    context.arc(item.size * 0.65, -item.size * 0.2, 2.5, 0, Math.PI * 2);
    context.fill();
    context.restore();
}

let elapsed = 0;
screen.onUpdate = deltaTime => {
    elapsed += deltaTime;
    const seconds = deltaTime / 1000;
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, '#082f49');
    background.addColorStop(1, '#020617');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (const item of fish) {
        item.x += item.speed * seconds;
        if (item.x - item.size * 2.2 > canvas.width) item.x = -item.size * 2.2;
        drawFish(item, elapsed);
    }

    context.fillStyle = 'rgba(255, 255, 255, 0.8)';
    context.font = '600 22px system-ui, sans-serif';
    context.fillText('Canvas 2D → WebGL texture', 22, 38);
};
