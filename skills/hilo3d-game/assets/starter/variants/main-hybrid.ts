import * as Hilo3d from 'hilo3d';
import { reportStartupFailure } from './startup';
import './style.css';

const WORLD_LAYER = 1;
const HUD_LAYER = 2;

async function main(): Promise<void> {
    const container = document.querySelector<HTMLElement>('#app');
    if (!container) throw new Error('Missing #app container.');
    const world = await Hilo3d.World.create({
        systems: [
            Hilo3d.createCanvasTextSystem(),
            Hilo3d.createTransformSystem(),
            Hilo3d.createRenderExtractionSystem()
        ]
    });
    const engine = await Hilo3d.Engine.create({
        backend: 'auto',
        container,
        width: innerWidth,
        height: innerHeight,
        antialias: true,
        clearColor: new Hilo3d.Color(0.025, 0.055, 0.12)
    });

    const worldCamera = world.createEntity();
    world.add(worldCamera, Hilo3d.LocalTransform, { position: [4, 3, 7] });
    world.add(worldCamera, Hilo3d.PerspectiveCamera, {
        aspect: innerWidth / innerHeight,
        fov: 55,
        near: 0.1,
        far: 200,
        visibility: WORLD_LAYER,
        priority: 0
    });
    world.add(worldCamera, Hilo3d.CameraOutput, { enabled: true });

    const hudCamera = world.createEntity();
    world.add(hudCamera, Hilo3d.LocalTransform, { position: [0, 0, 10] });
    world.add(hudCamera, Hilo3d.OrthographicCamera, {
        left: 0,
        right: innerWidth,
        top: 0,
        bottom: innerHeight,
        near: 0.1,
        far: 100,
        visibility: HUD_LAYER,
        priority: 100,
        clearColor: false,
        clearDepth: false
    });
    world.add(hudCamera, Hilo3d.CameraOutput, { enabled: true });

    const player = world.createEntity();
    world.add(player, Hilo3d.LocalTransform, {});
    world.add(player, Hilo3d.RenderVisibility, { layer: WORLD_LAYER });
    world.add(player, Hilo3d.MeshRenderer, {
        geometry: new Hilo3d.BoxGeometry(),
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.2, 0.75, 1),
            roughness: 0.45
        })
    });
    const ambient = world.createEntity();
    world.add(ambient, Hilo3d.AmbientLight, { color: [0.65, 0.75, 1], amount: 0.9 });

    const hud = world.createEntity();
    world.add(hud, Hilo3d.LocalTransform, { position: [24, 24, 0] });
    world.add(hud, Hilo3d.RenderVisibility, { layer: HUD_LAYER });
    world.add(hud, Hilo3d.CanvasText, {
        text: 'ECS world + HUD camera',
        font: '700 20px sans-serif',
        fillStyle: '#eaf8ff',
        padding: 8
    });

    const controls = new Hilo3d.OrbitControls(engine, world, worldCamera, {
        target: new Hilo3d.Vector3(0, 0, 0),
        distance: 8
    });
    const transforms = Hilo3d.getTransformStore(world);
    const playerIndex = world.entityIndex(player);
    let previous = performance.now();
    let animationFrame = 0;
    const frame = (now: number): void => {
        const delta = Math.max(0, Math.min(now - previous, 100));
        previous = now;
        const angle = now * 0.0005;
        transforms.setRotation(playerIndex, 0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5));
        engine.frame(world, delta);
        animationFrame = requestAnimationFrame(frame);
    };
    animationFrame = requestAnimationFrame(frame);

    const resize = (): void => {
        engine.resize(innerWidth, innerHeight);
        world.set(worldCamera, Hilo3d.PerspectiveCamera, {
            aspect: innerWidth / innerHeight,
            fov: 55,
            near: 0.1,
            far: 200,
            visibility: WORLD_LAYER,
            priority: 0
        });
        world.set(hudCamera, Hilo3d.OrthographicCamera, {
            left: 0,
            right: innerWidth,
            top: 0,
            bottom: innerHeight,
            near: 0.1,
            far: 100,
            visibility: HUD_LAYER,
            priority: 100,
            clearColor: false,
            clearDepth: false
        });
    };
    addEventListener('resize', resize);
    document.querySelector('#loading')?.remove();
    addEventListener(
        'beforeunload',
        () => {
            cancelAnimationFrame(animationFrame);
            removeEventListener('resize', resize);
            controls.destroy();
            engine.destroy();
            world.destroy();
        },
        { once: true }
    );
}

void main().catch(reportStartupFailure);
