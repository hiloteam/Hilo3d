import {
    createStagePluginService,
    STAGE_PLUGIN_API_VERSION,
    type Stage,
    type StagePlugin,
    type StagePluginService
} from 'hilo3d';
import { PhysicsWorld, type PhysicsWorldOptions } from './PhysicsWorld.js';
import type { PhysicsDimension } from './types.js';

export const PHYSICS_WORLD_2D_SERVICE = createStagePluginService<PhysicsWorld<'2d'>>(
    '@hilo3d/addon-physics/world-2d'
);
export const PHYSICS_WORLD_3D_SERVICE = createStagePluginService<PhysicsWorld<'3d'>>(
    '@hilo3d/addon-physics/world-3d'
);

export interface PhysicsStagePluginOptions<D extends PhysicsDimension> {
    readonly id: string;
    readonly service: StagePluginService<PhysicsWorld<D>>;
    readonly world: PhysicsWorldOptions<D>;
    /** Populate bodies and bindings before `Stage.create()` resolves. */
    readonly setup?: (world: PhysicsWorld<D>, stage: Stage) => void | Promise<void>;
}

/** Create a Stage plugin around any backend implementing the portable physics contract. */
export function createPhysicsStagePlugin<D extends PhysicsDimension>(
    options: PhysicsStagePluginOptions<D>
): StagePlugin {
    return {
        descriptor: {
            id: options.id,
            version: '0.1.0',
            apiVersion: STAGE_PLUGIN_API_VERSION
        },
        async setup(context) {
            const world = await PhysicsWorld.create(options.world);
            try {
                await options.setup?.(world, context.stage);
            } catch (cause) {
                world.destroy();
                throw cause;
            }
            context.provide(options.service, world);
            return {
                afterUpdate(deltaTimeMilliseconds: number): void {
                    world.advance(deltaTimeMilliseconds);
                },
                destroy(): void {
                    world.destroy();
                }
            };
        }
    };
}
