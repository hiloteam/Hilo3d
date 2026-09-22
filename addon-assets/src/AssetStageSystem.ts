import { STAGE_SYSTEM_API_VERSION, createStageSystemService, type StageSystem } from 'hilo3d';
import { AssetManager } from './AssetManager.js';
import type { AssetManagerOptions } from './types.js';

/** Renderer-local asset ownership, destroyed before its Stage renderer. */
export const ASSET_STAGE_SERVICE = createStageSystemService<AssetManager>(
    '@hilo/addon-assets/runtime'
);

/** Install bounded texture streaming into the standard Stage lifecycle. */
export function createAssetStageSystem(
    options: Readonly<Omit<AssetManagerOptions, 'autoUpdate'>> = {}
): StageSystem {
    return {
        descriptor: {
            id: '@hilo/addon-assets',
            version: '2.0.0-alpha.8',
            apiVersion: STAGE_SYSTEM_API_VERSION,
            provides: [ASSET_STAGE_SERVICE]
        },
        setup(context) {
            const manager = new AssetManager(context.stage.renderer, {
                ...options,
                autoUpdate: false
            });
            try {
                context.provide(ASSET_STAGE_SERVICE, manager);
            } catch (error) {
                manager.destroy();
                throw error;
            }
            return {
                beforeUpdate(): void {
                    void manager.update().catch(() => {
                        /* Manager diagnostics and all pending leases retain this failure. */
                    });
                },
                destroy(): void {
                    manager.destroy();
                }
            };
        }
    };
}
