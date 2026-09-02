import type { WorldSystem } from 'hilo3d';
import { createPhysicsSystem } from './PhysicsSystem.js';
import type { PhysicsWorldOptions } from './PhysicsWorld.js';
import {
    RAPIER_3D_NATIVE_EXTENSION,
    Rapier3DBackend,
    type Rapier3DNativeExtension
} from './rapier3d/Rapier3DBackend.js';

export * from './index.js';
export { RAPIER_3D_NATIVE_EXTENSION, Rapier3DBackend, type Rapier3DNativeExtension };

export type Rapier3DPhysicsSystemOptions = Omit<PhysicsWorldOptions<'3d'>, 'backend'>;

/** Create the standard Rapier 3D ECS System without importing the 2D WASM module. */
export function createRapier3DPhysicsSystem(options: Rapier3DPhysicsSystemOptions): WorldSystem {
    return createPhysicsSystem({
        id: '@hilo3d/addon-physics/rapier3d',
        world: { ...options, backend: new Rapier3DBackend() }
    });
}
