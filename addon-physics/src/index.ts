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
    type PhysicsTransformBindingOptions,
    type PhysicsTransformSyncMode,
    type PhysicsTransformTarget,
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
export { HiloNodeTransform2D, HiloNodeTransform3D } from './HiloNodeTransform.js';
export {
    createPhysicsStageSystem,
    PHYSICS_WORLD_2D_SERVICE,
    PHYSICS_WORLD_3D_SERVICE,
    type PhysicsStageSystemOptions
} from './PhysicsStageSystem.js';
export type * from './types.js';
