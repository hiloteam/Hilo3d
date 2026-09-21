import { OrthographicCamera, Stage } from 'hilo3d';
import { configureLive2D, Live2DModel } from '@hilo/addon-live2d';
import { runScene } from './lifecycle.js';

/** High-level Live2D scene with a lifecycle-owned ticker. */
export interface Live2DScene {
    readonly stage: Stage;
    readonly model: Live2DModel;
    destroy(): void;
}

/** Load a model with one deployment URL; Stage owns animation, masks and destruction. */
export async function createLive2DScene(
    container: HTMLElement,
    modelUrl: string,
    runtimeUrl: string,
    signal?: AbortSignal
): Promise<Live2DScene> {
    configureLive2D({ runtimeUrl });
    const model = await Live2DModel.load(modelUrl, signal === undefined ? {} : { signal });
    let stage: Stage | null = null;
    try {
        const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 2 });
        stage = await Stage.create({ backend: 'auto', container, camera });
        signal?.throwIfAborted();
        stage.addChild(model);
        if (model.settings.motions['Idle']?.length) model.playMotion('Idle', { loop: true });
        const ownedStage = stage;
        const running = runScene(stage, (): void => {
            const width = Math.max(1, container.clientWidth);
            const height = Math.max(1, container.clientHeight);
            ownedStage.resize(width, height);
            camera.left = -width / height;
            camera.right = width / height;
        });
        return {
            stage,
            model,
            destroy: (): void => {
                running.destroy();
            }
        };
    } catch (error: unknown) {
        model.destroy(stage?.renderer);
        stage?.destroy();
        throw error;
    }
}
