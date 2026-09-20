import {
    AmbientLight,
    BoxGeometry,
    Color,
    DirectionalLight,
    Mesh,
    OrbitControls,
    PBRMaterial,
    PerspectiveCamera,
    Stage,
    Vector3
} from 'hilo3d';
import { runScene, type RunningScene } from './lifecycle.js';

export async function startScene3D(container: HTMLElement): Promise<RunningScene> {
    const camera = new PerspectiveCamera({ x: 3, y: 2, z: 4 });
    const stage = await Stage.create({
        backend: 'auto',
        container,
        camera,
        clearColor: new Color(0.03, 0.04, 0.06)
    });
    let controls: OrbitControls | undefined;
    try {
        new Mesh({
            geometry: new BoxGeometry(),
            material: new PBRMaterial({
                baseColor: new Color(0.83, 0.12, 0.09),
                metallic: 0.1,
                roughness: 0.6
            })
        }).addTo(stage);
        new AmbientLight({ amount: 1 }).addTo(stage);
        new DirectionalLight({ amount: 3, direction: new Vector3(-1, -1, -1) }).addTo(stage);
        controls = new OrbitControls(stage);
        return runScene(
            stage,
            () => {
                const width = Math.max(1, container.clientWidth);
                const height = Math.max(1, container.clientHeight);
                stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
                camera.aspect = width / height;
            },
            () => controls?.dispose()
        );
    } catch (error: unknown) {
        controls?.dispose();
        stage.destroy();
        throw error;
    }
}
