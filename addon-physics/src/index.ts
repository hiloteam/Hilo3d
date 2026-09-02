/**
 * Backend-neutral optional physics API. This entry imports no Rapier module or WASM payload.
 *
 * @packageDocumentation
 */
export {
    createPhysicsBackendExtension,
    type PhysicsBackend,
    type PhysicsBackendCollisionEvent,
    type PhysicsBackendContactForceEvent,
    type PhysicsBackendEvent,
    type PhysicsBackendExtension,
    type PhysicsBackendWorld,
    type PhysicsBackendWorldOptions,
    type PhysicsJointMotorOptions,
    type PhysicsWorldSnapshot
} from './PhysicsBackend.js';
export {
    PhysicsCharacterController,
    PhysicsCollider,
    PhysicsJoint,
    PhysicsRigidBody,
    PhysicsWorld,
    type PhysicsAdvanceResult,
    type PhysicsColliderEvent,
    type PhysicsCollisionEvent,
    type PhysicsContactForceEvent,
    type PhysicsWorldEvent,
    type PhysicsWorldOptions
} from './PhysicsWorld.js';
export {
    AttachedBody,
    CharacterController,
    Collider,
    RigidBody,
    type AttachedBodyValue,
    type CharacterControllerValue,
    type ColliderValue,
    type RigidBodyValue
} from './PhysicsComponents.js';
export {
    createPhysicsSystem,
    PHYSICS_RUNTIME_2D,
    PHYSICS_RUNTIME_3D,
    PhysicsRuntime,
    type PhysicsEcsSnapshot,
    type PhysicsEntityEvent,
    type PhysicsRuntimeDiagnostics,
    type PhysicsSystemOptions
} from './PhysicsSystem.js';
export type * from './types.js';
