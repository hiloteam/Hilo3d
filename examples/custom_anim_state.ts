import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';

const { stage } = await createExampleContext();

function isNumberArray(value: unknown): value is number[] {
    return Array.isArray(value) && value.every((item: unknown) => typeof item === 'number');
}

Hilo3d.AnimationStates.registerStateHandler('UV_Translate', (node, state) => {
    const mesh =
        node instanceof Hilo3d.Mesh
            ? node
            : node.children.find(child => child instanceof Hilo3d.Mesh);
    if (!mesh?.material) throw new Error('UV animation requires a mesh material');
    if (!isNumberArray(state)) {
        throw new TypeError('UV animation state must be a numeric array');
    }
    mesh.material.uvMatrix ??= new Hilo3d.Matrix3();
    const [x = 0, y = 0, scaleX = 1, scaleY = 1] = state;
    mesh.material.uvMatrix.set(scaleX, 0, 0, 0, scaleY, 0, x, y, 1);
});

const geometry = new Hilo3d.PlaneGeometry();

function createSpriteSheet(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = 174;
    canvas.height = 1512;
    const drawingContext = canvas.getContext('2d');
    if (!drawingContext) throw new Error('Sprite animation requires a 2D canvas context.');
    const frameHeight = canvas.height / 12;
    for (let frame = 0; frame < 12; frame += 1) {
        const y = frame * frameHeight;
        drawingContext.fillStyle = `hsl(${String(190 + frame * 8)} 70% 24%)`;
        drawingContext.fillRect(0, y, canvas.width, frameHeight);
        drawingContext.save();
        drawingContext.translate(87, y + frameHeight / 2);
        drawingContext.rotate(Math.sin((frame / 12) * Math.PI * 2) * 0.12);
        drawingContext.fillStyle = `hsl(${String(25 + frame * 6)} 85% 62%)`;
        drawingContext.beginPath();
        drawingContext.ellipse(0, 0, 48, 30, 0, 0, Math.PI * 2);
        drawingContext.fill();
        drawingContext.beginPath();
        drawingContext.moveTo(-40, 0);
        drawingContext.lineTo(-72, -27);
        drawingContext.lineTo(-72, 27);
        drawingContext.closePath();
        drawingContext.fill();
        drawingContext.fillStyle = '#111827';
        drawingContext.beginPath();
        drawingContext.arc(22, -7, 4, 0, Math.PI * 2);
        drawingContext.fill();
        drawingContext.restore();
    }
    return canvas;
}

const mat = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    side: Hilo3d.constants.FRONT_AND_BACK,
    diffuse: new Hilo3d.Texture({
        flipY: true,
        image: createSpriteSheet()
    }),
    uvMatrix: new Hilo3d.Matrix3(),
    transparent: true
});

const rect = new Hilo3d.Mesh({
    geometry,
    material: mat
});
stage.addChild(rect);

const keyTime: number[] = [];
const states: number[][] = [];
const w = 1;
const h = 12;
for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
        keyTime.push(0.16 * (i + 1) * (j + 1));
        states.push([j / w, 1 - 1 / h - i / h, 1 / w, 1 / h]);
    }
}

const anim = new Hilo3d.Animation({
    animStatesList: [
        new Hilo3d.AnimationStates({
            interpolationType: 'STEP',
            nodeName: rect.name,
            keyTime,
            states,
            type: Hilo3d.AnimationStates.getType('UV_Translate')
        })
    ]
});
rect.setAnim(anim);
anim.play();
