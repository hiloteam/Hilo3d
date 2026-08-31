import type { WorldSystem } from 'hilo3d';
import { createPhysicsSystem } from './PhysicsSystem.js';
import type { PhysicsWorldOptions } from './PhysicsWorld.js';
import {
    RAPIER_2D_NATIVE_EXTENSION,
    Rapier2DBackend,
    type Rapier2DNativeExtension
} from './rapier2d/Rapier2DBackend.js';

export * from './index.js';
export { RAPIER_2D_NATIVE_EXTENSION, Rapier2DBackend, type Rapier2DNativeExtension };

export type Rapier2DPhysicsSystemOptions = Omit<PhysicsWorldOptions<'2d'>, 'backend'>;

/** Create the standard Rapier 2D ECS System without importing the 3D WASM module. */
export function createRapier2DPhysicsSystem(options: Rapier2DPhysicsSystemOptions): WorldSystem {
    return createPhysicsSystem({
        id: '@hilo3d/addon-physics/rapier2d',
        world: { ...options, backend: new Rapier2DBackend() }
    });
}
