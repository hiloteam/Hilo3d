import type {
    PhysicsAngularVelocity,
    PhysicsCharacterControllerOptions,
    PhysicsCharacterMovement,
    PhysicsColliderDescriptor,
    PhysicsDebugGeometry,
    PhysicsDimension,
    PhysicsJointDescriptor,
    PhysicsPointProjection,
    PhysicsPose,
    PhysicsQueryFilter,
    PhysicsRaycastHit,
    PhysicsRigidBodyDescriptor,
    PhysicsRigidBodyType,
    PhysicsRotation,
    PhysicsShape,
    PhysicsShapeCastHit,
    PhysicsVector
} from './types.js';

/** Typed identity for a deliberately backend-specific extension. */
export class PhysicsBackendExtension<T> {
    readonly name: string;
    declare private readonly extensionType: T;

    constructor(name: string) {
        if (name.trim().length === 0) {
            throw new TypeError('Physics backend extension names cannot be empty.');
        }
        this.name = name;
    }
}

/** Create a typed backend extension identity shared by an adapter and its consumers. */
export function createPhysicsBackendExtension<T>(name: string): PhysicsBackendExtension<T> {
    return new PhysicsBackendExtension<T>(name);
}

export interface PhysicsBackendCollisionEvent {
    readonly type: 'collision';
    readonly collider1: number;
    readonly collider2: number;
    readonly started: boolean;
}

export interface PhysicsBackendContactForceEvent<D extends PhysicsDimension> {
    readonly type: 'contact-force';
    readonly collider1: number;
    readonly collider2: number;
    readonly totalForce: PhysicsVector<D>;
    readonly totalForceMagnitude: number;
    readonly maxForceDirection: PhysicsVector<D>;
    readonly maxForceMagnitude: number;
}

export type PhysicsBackendEvent<D extends PhysicsDimension> =
    PhysicsBackendCollisionEvent | PhysicsBackendContactForceEvent<D>;

export interface PhysicsBackendWorld<D extends PhysicsDimension> {
    readonly id: string;
    readonly dimension: D;
    setGravity(gravity: PhysicsVector<D>): void;
    step(deltaSeconds: number): void;
    createRigidBody(descriptor: PhysicsRigidBodyDescriptor<D>): number;
    removeRigidBody(handle: number): void;
    hasRigidBody(handle: number): boolean;
    rigidBodyType(handle: number): PhysicsRigidBodyType;
    bodyPose(handle: number): PhysicsPose<D>;
    setBodyPose(handle: number, pose: PhysicsPose<D>, wakeUp: boolean): void;
    setNextKinematicPose(handle: number, pose: PhysicsPose<D>): void;
    bodyLinearVelocity(handle: number): PhysicsVector<D>;
    setBodyLinearVelocity(handle: number, velocity: PhysicsVector<D>, wakeUp: boolean): void;
    bodyAngularVelocity(handle: number): PhysicsAngularVelocity<D>;
    setBodyAngularVelocity(
        handle: number,
        velocity: PhysicsAngularVelocity<D>,
        wakeUp: boolean
    ): void;
    applyForce(handle: number, force: PhysicsVector<D>, wakeUp: boolean): void;
    applyImpulse(handle: number, impulse: PhysicsVector<D>, wakeUp: boolean): void;
    applyTorque(handle: number, torque: PhysicsAngularVelocity<D>, wakeUp: boolean): void;
    applyTorqueImpulse(
        handle: number,
        torqueImpulse: PhysicsAngularVelocity<D>,
        wakeUp: boolean
    ): void;
    sleepRigidBody(handle: number): void;
    wakeRigidBody(handle: number): void;
    isRigidBodySleeping(handle: number): boolean;
    createCollider(descriptor: PhysicsColliderDescriptor<D>, parentHandle?: number): number;
    removeCollider(handle: number, wakeUp: boolean): void;
    hasCollider(handle: number): boolean;
    colliderParent(handle: number): number | undefined;
    createJoint(
        descriptor: PhysicsJointDescriptor<D>,
        body1: number,
        body2: number,
        wakeUp: boolean
    ): number;
    removeJoint(handle: number, wakeUp: boolean): void;
    hasJoint(handle: number): boolean;
    setJointLimits(handle: number, min: number, max: number): void;
    configureJointMotor(
        handle: number,
        targetPosition: number,
        targetVelocity: number,
        stiffness: number,
        damping: number
    ): void;
    createCharacterController(options: PhysicsCharacterControllerOptions<D>): number;
    removeCharacterController(handle: number): void;
    hasCharacterController(handle: number): boolean;
    computeCharacterMovement(
        controllerHandle: number,
        colliderHandle: number,
        desiredTranslation: PhysicsVector<D>,
        filter?: PhysicsQueryFilter
    ): PhysicsCharacterMovement<D>;
    castRay(
        origin: PhysicsVector<D>,
        direction: PhysicsVector<D>,
        maxDistance: number,
        solid: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsRaycastHit<D> | null;
    castShape(
        pose: PhysicsPose<D>,
        velocity: PhysicsVector<D>,
        shape: PhysicsShape<D>,
        targetDistance: number,
        maxTimeOfImpact: number,
        stopAtPenetration: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsShapeCastHit<D> | null;
    intersectionsWithShape(
        pose: PhysicsPose<D>,
        shape: PhysicsShape<D>,
        maxResults: number,
        filter?: PhysicsQueryFilter
    ): readonly number[];
    projectPoint(
        point: PhysicsVector<D>,
        solid: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsPointProjection<D> | null;
    drainEvents(visitor: (event: PhysicsBackendEvent<D>) => void): void;
    takeSnapshot(): Uint8Array;
    restoreSnapshot(snapshot: Uint8Array): void;
    rigidBodyHandles(): readonly number[];
    colliderHandles(): readonly number[];
    jointHandles(): readonly number[];
    debugRender(): PhysicsDebugGeometry;
    getExtension<T>(extension: PhysicsBackendExtension<T>): T | null;
    destroy(): void;
}

/** Backend composition root. Implementations own native/WASM initialization and world creation. */
export interface PhysicsBackend<D extends PhysicsDimension> {
    readonly id: string;
    readonly dimension: D;
    createWorld(options: PhysicsBackendWorldOptions<D>): Promise<PhysicsBackendWorld<D>>;
}

export interface PhysicsBackendWorldOptions<D extends PhysicsDimension> {
    readonly gravity: PhysicsVector<D>;
    readonly lengthUnit: number;
    readonly solverIterations: number;
    readonly internalPgsIterations: number;
    readonly maxCcdSubsteps: number;
}

export interface PhysicsTransformTarget<D extends PhysicsDimension> {
    readPose(): PhysicsPose<D>;
    writePose(pose: PhysicsPose<D>): void;
    invalidateHistory?(): void;
}

export type PhysicsTransformSyncMode = 'auto' | 'physics-to-target' | 'target-to-physics' | 'none';

export interface PhysicsTransformBindingOptions {
    readonly sync?: PhysicsTransformSyncMode;
    /** Interpolate dynamic poses between fixed simulation states. */
    readonly interpolate?: boolean;
}

export interface PhysicsWorldSnapshot {
    readonly version: 1;
    readonly backendId: string;
    readonly dimension: PhysicsDimension;
    readonly data: Uint8Array;
}

export interface PhysicsJointMotorOptions {
    readonly targetPosition?: number;
    readonly targetVelocity?: number;
    readonly stiffness?: number;
    readonly damping?: number;
}

export function cloneVector<D extends PhysicsDimension>(
    vector: PhysicsVector<D>
): PhysicsVector<D> {
    if ('z' in vector) {
        return { x: vector.x, y: vector.y, z: vector.z } as PhysicsVector<D>;
    }
    return { x: vector.x, y: vector.y } as PhysicsVector<D>;
}

export function cloneRotation<D extends PhysicsDimension>(
    rotation: PhysicsRotation<D>
): PhysicsRotation<D> {
    if (typeof rotation === 'number') return rotation;
    return {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
        w: rotation.w
    } as PhysicsRotation<D>;
}

export function clonePose<D extends PhysicsDimension>(pose: PhysicsPose<D>): PhysicsPose<D> {
    return {
        position: cloneVector(pose.position),
        rotation: cloneRotation(pose.rotation)
    } as PhysicsPose<D>;
}
