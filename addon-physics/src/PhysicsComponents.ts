import { ChangedComponentStore, defineComponent, type Entity } from 'hilo3d';
import type {
    PhysicsCharacterControllerOptions,
    PhysicsColliderDescriptor2D,
    PhysicsColliderDescriptor3D,
    PhysicsRigidBodyDescriptor2D,
    PhysicsRigidBodyDescriptor3D
} from './types.js';

/** Rigid-body component authored directly on an Entity. */
export type RigidBodyValue =
    | (PhysicsRigidBodyDescriptor2D & {
          readonly dimension?: '2d';
          readonly interpolate?: boolean;
      })
    | (PhysicsRigidBodyDescriptor3D & {
          readonly dimension?: '3d';
          readonly interpolate?: boolean;
      });

/** Collider component. Put it on a body Entity or relate it through AttachedBody. */
export type ColliderValue =
    | (PhysicsColliderDescriptor2D & { readonly dimension?: '2d' })
    | (PhysicsColliderDescriptor3D & { readonly dimension?: '3d' });

/** Compound-collider relationship to the Entity containing its RigidBody. */
export interface AttachedBodyValue {
    readonly body: Entity;
}

/** Character-controller component with an explicit collider Entity. */
export interface CharacterControllerValue {
    readonly dimension: '2d' | '3d';
    readonly collider: Entity;
    readonly options: PhysicsCharacterControllerOptions<'2d' | '3d'>;
}

function changedStore<T>(initialCapacity: number): ChangedComponentStore<T> {
    return new ChangedComponentStore(initialCapacity, value => value);
}

export const RigidBody = defineComponent<RigidBodyValue>(
    '@hilo3d/addon-physics/rigid-body',
    changedStore
);

export const Collider = defineComponent<ColliderValue>(
    '@hilo3d/addon-physics/collider',
    changedStore
);

export const AttachedBody = defineComponent<AttachedBodyValue>(
    '@hilo3d/addon-physics/attached-body',
    changedStore
);

export const CharacterController = defineComponent<CharacterControllerValue>(
    '@hilo3d/addon-physics/character-controller',
    changedStore
);
