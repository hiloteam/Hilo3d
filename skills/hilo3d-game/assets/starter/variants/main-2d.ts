import * as Hilo3d from 'hilo3d';
import { reportStartupFailure } from './startup';
import './style.css';

function createPlayerFrame(): Hilo3d.SpriteFrame {
    const size = 32;
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const inside = Math.hypot(x - 15.5, y - 15.5) < 14;
            pixels[offset] = inside ? 48 : 0;
            pixels[offset + 1] = inside ? 210 : 0;
            pixels[offset + 2] = inside ? 255 : 0;
            pixels[offset + 3] = inside ? 255 : 0;
        }
    }
    const texture = new Hilo3d.Texture({ image: pixels, width: size, height: size });
    return Hilo3d.SpriteFrame.fromTexture(texture);
}

async function main(): Promise<void> {
    const container = document.querySelector<HTMLElement>('#app');
    if (!container) throw new Error('Missing #app container.');
    const world = await Hilo3d.World.create({
        systems: [Hilo3d.createTransformSystem(), Hilo3d.createRenderExtractionSystem()]
    });
    const engine = await Hilo3d.Engine.create({
        backend: 'auto',
        container,
        width: innerWidth,
        height: innerHeight,
        antialias: false,
        clearColor: new Hilo3d.Color(0.025, 0.055, 0.12)
    });
    const camera = world.createEntity();
    world.add(camera, Hilo3d.LocalTransform, { position: [0, 0, 10] });
    world.add(camera, Hilo3d.OrthographicCamera, {
        left: 0,
        right: innerWidth,
        top: 0,
        bottom: innerHeight,
        near: 0.1,
        far: 100
    });
    world.add(camera, Hilo3d.CameraOutput, { enabled: true });

    const playerFrame = createPlayerFrame();
    const player = world.createEntity();
    world.add(player, Hilo3d.LocalTransform, {
        position: [innerWidth * 0.5, innerHeight * 0.5, 0]
    });
    world.add(
        player,
        Hilo3d.SpriteRenderer,
        Hilo3d.createSpriteRenderer({ frame: playerFrame, width: 64, height: 64 })
    );
    const transforms = Hilo3d.getTransformStore(world);
    const playerIndex = world.entityIndex(player);
    let previous = performance.now();
    let animationFrame = 0;
    const frame = (now: number): void => {
        const delta = Math.max(0, Math.min(now - previous, 100));
        previous = now;
        transforms.setPosition(
            playerIndex,
            innerWidth * 0.5 + Math.cos(now * 0.001) * Math.min(innerWidth * 0.3, 240),
            innerHeight * 0.5 + Math.sin(now * 0.0015) * Math.min(innerHeight * 0.25, 140),
            0
        );
        engine.frame(world, delta);
        animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);

    const resize = (): void => {
        engine.resize(innerWidth, innerHeight);
        world.set(camera, Hilo3d.OrthographicCamera, {
            left: 0,
            right: innerWidth,
            top: 0,
            bottom: innerHeight,
            near: 0.1,
            far: 100
        });
    };
    addEventListener('resize', resize);
    document.querySelector('#loading')?.remove();
    addEventListener(
        'beforeunload',
        () => {
            cancelAnimationFrame(animationFrame);
            removeEventListener('resize', resize);
            engine.destroy();
            world.destroy();
            playerFrame.texture.destroy();
        },
        { once: true }
    );
}

void main().catch(reportStartupFailure);
