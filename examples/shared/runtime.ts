import {
    AmbientLight,
    CameraOutput,
    Engine,
    LocalTransform,
    OrbitControls,
    PerspectiveCamera,
    RENDER_WORLD,
    Vector3,
    World,
    createRenderExtractionSystem,
    createTransformSystem,
    type Entity,
    type WorldSystem
} from 'hilo3d';

export interface ExampleRuntime {
    readonly engine: Engine;
    readonly world: World;
    readonly camera: Entity;
    readonly controls: OrbitControls;
    start(beforeFrame?: (elapsedSeconds: number) => void): void;
    destroy(): void;
}

export interface ExampleRenderStatus {
    readonly backend: 'webgl2' | 'webgpu';
    readonly cameraCount: number;
    readonly renderObjectCount: number;
    readonly lightCount: number;
    readonly worldFrame: number;
    readonly submittedFrameCount: number;
    readonly destroyed: boolean;
}

declare global {
    interface Window {
        __HILO_ECS_STATUS__?: ExampleRenderStatus;
    }
}

function requestedBackend(): 'auto' | 'webgl2' | 'webgpu' {
    const value = new URLSearchParams(location.search).get('backend');
    return value === 'webgl2' || value === 'webgpu' ? value : 'auto';
}

export async function createExampleRuntime(
    additionalSystems: readonly WorldSystem[] = []
): Promise<ExampleRuntime> {
    const container = document.querySelector<HTMLElement>('#app');
    if (!container) throw new Error('Example requires #app.');
    const world = await World.create({
        initialCapacity: 1024,
        systems: [...additionalSystems, createTransformSystem(), createRenderExtractionSystem()]
    });
    const engine = await Engine.create({
        backend: requestedBackend(),
        container,
        width: innerWidth,
        height: innerHeight,
        antialias: true
    });
    const renderWorld = world.getResource(RENDER_WORLD);
    let renderStatus: ExampleRenderStatus = {
        backend: engine.renderer.backend,
        cameraCount: 0,
        renderObjectCount: 0,
        lightCount: 0,
        worldFrame: 0,
        submittedFrameCount: 0,
        destroyed: false
    };
    window.__HILO_ECS_STATUS__ = renderStatus;
    const camera = world.createEntity();
    world.add(camera, LocalTransform, { position: [4, 3, 7] });
    world.add(camera, PerspectiveCamera, {
        aspect: innerWidth / innerHeight,
        fov: 60,
        near: 0.1,
        far: 100
    });
    world.add(camera, CameraOutput, { enabled: true });
    const ambient = world.createEntity();
    world.add(ambient, LocalTransform, {});
    world.add(ambient, AmbientLight, { amount: 0.8, color: [0.8, 0.88, 1] });
    const controls = new OrbitControls(engine, world, camera, {
        target: new Vector3(0, 0.5, 0),
        distance: 8,
        minDistance: 2,
        maxDistance: 24
    });
    controls.setView({ x: 0, y: 0.5, z: 0 }, 8, 0.55, 1.15);
    let animationFrame = 0;
    let previous = performance.now();
    let started = false;
    let beforeFrameCallback: ((elapsedSeconds: number) => void) | undefined;
    const frame = (now: number): void => {
        if (!started) return;
        const delta = Math.max(0, Math.min(now - previous, 100));
        previous = now;
        beforeFrameCallback?.(now * 0.001);
        const result = engine.frame(world, delta);
        renderStatus = {
            backend: result.backend,
            cameraCount: result.cameraCount,
            renderObjectCount: result.renderObjectCount,
            lightCount: renderWorld.lights.length,
            worldFrame: result.worldFrame,
            submittedFrameCount: renderStatus.submittedFrameCount + (result.submitted ? 1 : 0),
            destroyed: false
        };
        window.__HILO_ECS_STATUS__ = renderStatus;
        animationFrame = requestAnimationFrame(frame);
    };
    const resize = (): void => {
        engine.resize(innerWidth, innerHeight);
        world.set(camera, PerspectiveCamera, {
            aspect: innerWidth / innerHeight,
            fov: 60,
            near: 0.1,
            far: 100
        });
    };
    addEventListener('resize', resize);
    const destroy = (): void => {
        started = false;
        cancelAnimationFrame(animationFrame);
        removeEventListener('resize', resize);
        controls.destroy();
        engine.destroy();
        world.destroy();
        window.__HILO_ECS_STATUS__ = { ...renderStatus, destroyed: true };
    };
    addEventListener('beforeunload', destroy, { once: true });
    return {
        engine,
        world,
        camera,
        controls,
        start(beforeFrame): void {
            if (started) return;
            started = true;
            beforeFrameCallback = beforeFrame;
            previous = performance.now();
            animationFrame = requestAnimationFrame(frame);
        },
        destroy
    };
}
