import type { Node, Stage, StageSystem } from 'hilo3d';
import type { PhysicsTransformBindingOptions } from './PhysicsBackend.js';
import { HiloNodeTransform3D } from './HiloNodeTransform.js';
import { createPhysicsStageSystem, PHYSICS_WORLD_3D_SERVICE } from './PhysicsStageSystem.js';
import type { PhysicsRigidBody, PhysicsWorld, PhysicsWorldOptions } from './PhysicsWorld.js';
import {
    RAPIER_3D_NATIVE_EXTENSION,
    Rapier3DBackend,
    type Rapier3DNativeExtension
} from './rapier3d/Rapier3DBackend.js';

export * from './index.js';
export { RAPIER_3D_NATIVE_EXTENSION, Rapier3DBackend, type Rapier3DNativeExtension };

export type Rapier3DPhysicsSystemOptions = Omit<PhysicsWorldOptions<'3d'>, 'backend'> & {
    readonly setup?: (world: PhysicsWorld<'3d'>, stage: Stage) => void | Promise<void>;
};

/** Create the standard Rapier 3D Stage System without importing the 2D WASM module. */
export function createRapier3DPhysicsSystem(options: Rapier3DPhysicsSystemOptions): StageSystem {
    const { setup, ...worldOptions } = options;
    return createPhysicsStageSystem({
        id: '@hilo3d/addon-physics/rapier3d',
        service: PHYSICS_WORLD_3D_SERVICE,
        world: { ...worldOptions, backend: new Rapier3DBackend() },
        ...(setup === undefined ? {} : { setup })
    });
}

/** Bind a 3D rigid body to a Hilo3D Node in world space. */
export function bindNode3D(
    world: PhysicsWorld<'3d'>,
    body: PhysicsRigidBody<'3d'>,
    node: Node,
    options?: PhysicsTransformBindingOptions
): HiloNodeTransform3D {
    const target = new HiloNodeTransform3D(node);
    world.bindTransform(body, target, options);
    return target;
}
