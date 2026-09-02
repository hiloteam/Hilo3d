import * as Hilo3d from 'hilo3d';
import { reportStartupFailure } from './startup';
import './style.css';

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
        antialias: true,
        clearColor: new Hilo3d.Color(0.025, 0.055, 0.12)
    });

    const camera = world.createEntity();
    world.add(camera, Hilo3d.LocalTransform, { position: [4, 3, 7] });
    world.add(camera, Hilo3d.PerspectiveCamera, {
        aspect: innerWidth / innerHeight,
        fov: 55,
        near: 0.1,
        far: 200
    });
    world.add(camera, Hilo3d.CameraOutput, { enabled: true });

    const player = world.createEntity();
    world.add(player, Hilo3d.LocalTransform, {});
    world.add(player, Hilo3d.MeshRenderer, {
        geometry: new Hilo3d.BoxGeometry(),
        material: new Hilo3d.PBRMaterial({
            baseColor: new Hilo3d.Color(0.15, 0.72, 1),
            metallic: 0.15,
            roughness: 0.45
        }),
        castShadows: true,
        receiveShadows: true
    });

    const ambient = world.createEntity();
    world.add(ambient, Hilo3d.AmbientLight, { color: [0.5, 0.65, 1], amount: 0.65 });
    const sun = world.createEntity();
    world.add(sun, Hilo3d.LocalTransform, {});
    world.add(sun, Hilo3d.DirectionalLight, {
        color: [1, 0.92, 0.76],
        amount: 3,
        direction: [-1, -1, -0.5]
    });

    const controls = new Hilo3d.OrbitControls(engine, world, camera, {
        target: new Hilo3d.Vector3(0, 0, 0),
        distance: 8
    });
    controls.setView({ x: 0, y: 0, z: 0 }, 8, 0.55, 1.1);
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
        world.set(camera, Hilo3d.PerspectiveCamera, {
            aspect: innerWidth / innerHeight,
            fov: 55,
            near: 0.1,
            far: 200
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
