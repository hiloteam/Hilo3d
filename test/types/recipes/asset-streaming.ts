import { PerspectiveCamera, Stage } from 'hilo3d';
import {
    ASSET_STAGE_SERVICE,
    createAssetStageSystem,
    type TextureAssetLease,
    type TextureAssetSource
} from '@hilo/addon-assets';

/** Unreleased asset addon recipe. Start ticking before awaiting lease.ready. */
export async function createStreamingScene(
    container: HTMLElement,
    source: Readonly<TextureAssetSource>
): Promise<{ stage: Stage; lease: TextureAssetLease }> {
    const stage = await Stage.create({
        container,
        camera: new PerspectiveCamera({ z: 4 }),
        systems: [createAssetStageSystem()]
    });
    try {
        const lease = stage.systems
            .get(ASSET_STAGE_SERVICE)
            .acquireTexture(source, { priority: 10 });
        return { stage, lease };
    } catch (error) {
        stage.destroy();
        throw error;
    }
}
