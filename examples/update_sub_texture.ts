import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { camera, stage } = createExampleContext();

const geometry = new Hilo3d.PlaneGeometry({
    width: 50,
    height: 50,
    heightSegments: 32,
    widthSegments: 64
});

camera.z = 90;
camera.far = 1000;

let bgColor = '#00b894';
let frontColor = '#55efc4';

const canvas = document.createElement('canvas');
canvas.width = 512;
canvas.height = 512;
function require2DContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = target.getContext('2d');
    if (!context) throw new Error('Update-sub-texture example requires a 2D canvas context');
    return context;
}
const ctx = require2DContext(canvas);
ctx.fillStyle = bgColor;
ctx.fillRect(0, 0, 512, 512);

const texture = new Hilo3d.Texture({
    image: canvas,
    flipY: true
});
function updateSubCanvas(x: number, y: number, width: number, height: number): void {
    const glY = texture.flipY ? texture.height - y - height : y;
    texture.updateSubTexture(x, glY, ctx.getImageData(x, y, width, height));
}

const colorBox = new Hilo3d.Mesh({
    geometry,
    material: new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: texture,
        side: Hilo3d.constants.FRONT_AND_BACK
    })
});
stage.addChild(colorBox);

const sleep = async (time: number): Promise<void> => {
    return new Promise(resolve => {
        setTimeout(resolve, time);
    });
};
async function updateTextTexture(): Promise<never> {
    let num = 0;
    const size = 64;
    ctx.font = 'bold 32px serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (;;) {
        for (let y = 0; y < 512; y += size) {
            for (let x = 0; x < 512; x += size) {
                await sleep(50);
                ctx.fillStyle = frontColor;
                ctx.fillRect(x, y, size, size);
                ctx.fillStyle = bgColor;
                ctx.fillText(String(num), x + size * 0.5, y + size * 0.5);
                updateSubCanvas(x + 10, y + 10, size - 20, size - 20);
                num += 1;
            }
        }
        await sleep(500);
        texture.needUpdate = true;
        await sleep(1000);
        [bgColor, frontColor] = [frontColor, bgColor];
        texture.flipY = !texture.flipY;
    }
}

void updateTextTexture().catch((error: unknown) => {
    console.error('Failed to update sub-texture', error);
});
