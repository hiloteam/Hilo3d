import {
    createStageSystemService,
    STAGE_SYSTEM_API_VERSION,
    type Stage,
    type StageSystem,
    type StageSystemService
} from 'hilo3d';
import { PhysicsWorld, type PhysicsWorldOptions } from './PhysicsWorld.js';
import type { PhysicsDimension } from './types.js';

export const PHYSICS_WORLD_2D_SERVICE = createStageSystemService<PhysicsWorld<'2d'>>(
    '@hilo3d/addon-physics/world-2d'
);
export const PHYSICS_WORLD_3D_SERVICE = createStageSystemService<PhysicsWorld<'3d'>>(
    '@hilo3d/addon-physics/world-3d'
);

export interface PhysicsStageSystemOptions<D extends PhysicsDimension> {
    readonly id: string;
    readonly service: StageSystemService<PhysicsWorld<D>>;
    readonly world: PhysicsWorldOptions<D>;
    /** Populate bodies and bindings before `Stage.create()` resolves. */
    readonly setup?: (world: PhysicsWorld<D>, stage: Stage) => void | Promise<void>;
}

/** Create a Stage System around any backend implementing the portable physics contract. */
export function createPhysicsStageSystem<D extends PhysicsDimension>(
    options: PhysicsStageSystemOptions<D>
): StageSystem {
    return {
        descriptor: {
            id: options.id,
            version: '0.1.0',
            apiVersion: STAGE_SYSTEM_API_VERSION,
            provides: [options.service]
        },
        async setup(context) {
            let allocatedWorld: PhysicsWorld<D> | undefined;
            try {
                const world = await PhysicsWorld.create(options.world);
                allocatedWorld = world;
                context.provide(options.service, world);
                await options.setup?.(world, context.stage);
                return {
                    afterUpdate(deltaTimeMilliseconds: number): void {
                        world.advance(deltaTimeMilliseconds);
                    },
                    destroy(): void {
                        world.destroy();
                    }
                };
            } catch (cause) {
                if (allocatedWorld === undefined) throw cause;
                try {
                    allocatedWorld.destroy();
                } catch (destroyCause) {
                    throw new AggregateError(
                        [cause, destroyCause],
                        'Physics System setup and rollback both failed.',
                        { cause: destroyCause }
                    );
                }
                throw cause;
            }
        }
    };
}
