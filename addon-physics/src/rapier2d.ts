import type { Node, Stage, StagePlugin } from 'hilo3d';
import type { PhysicsTransformBindingOptions } from './PhysicsBackend.js';
import { HiloNodeTransform2D } from './HiloNodeTransform.js';
import { createPhysicsStagePlugin, PHYSICS_WORLD_2D_SERVICE } from './PhysicsStagePlugin.js';
import type { PhysicsRigidBody, PhysicsWorld, PhysicsWorldOptions } from './PhysicsWorld.js';
import {
    RAPIER_2D_NATIVE_EXTENSION,
    Rapier2DBackend,
    type Rapier2DNativeExtension
} from './rapier2d/Rapier2DBackend.js';

export * from './index.js';
export { RAPIER_2D_NATIVE_EXTENSION, Rapier2DBackend, type Rapier2DNativeExtension };

export type Rapier2DPhysicsPluginOptions = Omit<PhysicsWorldOptions<'2d'>, 'backend'> & {
    readonly setup?: (world: PhysicsWorld<'2d'>, stage: Stage) => void | Promise<void>;
};

/** Create the standard Rapier 2D Stage plugin without importing the 3D WASM module. */
export function createRapier2DPhysicsPlugin(options: Rapier2DPhysicsPluginOptions): StagePlugin {
    const { setup, ...worldOptions } = options;
    return createPhysicsStagePlugin({
        id: '@hilo3d/addon-physics/rapier2d',
        service: PHYSICS_WORLD_2D_SERVICE,
        world: { ...worldOptions, backend: new Rapier2DBackend() },
        ...(setup === undefined ? {} : { setup })
    });
}

/** Bind a 2D rigid body to a Hilo3D Node's XY plane. */
export function bindNode2D(
    world: PhysicsWorld<'2d'>,
    body: PhysicsRigidBody<'2d'>,
    node: Node,
    options?: PhysicsTransformBindingOptions
): HiloNodeTransform2D {
    const target = new HiloNodeTransform2D(node);
    world.bindTransform(body, target, options);
    return target;
}
