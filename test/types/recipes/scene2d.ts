import { Camera2D, Stage, Text2D } from 'hilo3d';
import { runScene, type RunningScene } from './lifecycle.js';

export async function startScene2D(container: HTMLElement): Promise<RunningScene> {
    const camera = new Camera2D({ width: 640, height: 480 });
    const stage = await Stage.create({ backend: 'auto', container, camera });
    try {
        new Text2D({
            text: 'Hello Hilo3D',
            style: { font: '24px sans-serif', lineHeight: 32, fillStyle: '#1a2638' },
            x: 24,
            y: 24,
            anchorX: 0,
            anchorY: 0
        }).addTo(stage);
        return runScene(stage, () => {
            const width = Math.max(1, container.clientWidth);
            const height = Math.max(1, container.clientHeight);
            stage.resize(width, height, Math.min(devicePixelRatio || 1, 2));
            camera.resize(width, height);
        });
    } catch (error: unknown) {
        stage.destroy();
        throw error;
    }
}
