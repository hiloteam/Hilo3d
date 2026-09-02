import { EventDispatcher, type DispatchEvent } from 'hilo3d';
import type {
    PhysicsBackend,
    PhysicsBackendExtension,
    PhysicsBackendEvent,
    PhysicsBackendWorld,
    PhysicsJointMotorOptions,
    PhysicsWorldSnapshot
} from './PhysicsBackend.js';
import type {
    PhysicsAngularVelocity,
    PhysicsCharacterControllerOptions,
    PhysicsCharacterMovement,
    PhysicsColliderDescriptor,
    PhysicsDebugGeometry,
    PhysicsDimension,
    PhysicsJointDescriptor,
    PhysicsOverlapShapeOptions,
    PhysicsPointProjection,
    PhysicsPose,
    PhysicsQueryFilter,
    PhysicsRaycastHit,
    PhysicsRigidBodyDescriptor,
    PhysicsRigidBodyType,
    PhysicsShape,
    PhysicsShapeCastHit,
    PhysicsShapeCastOptions,
    PhysicsVector,
    PhysicsWorldDiagnostics
} from './types.js';

const SNAPSHOT_VERSION = 1 as const;

function readRuntimeProperty(value: object, key: PropertyKey): unknown {
    return Reflect.get(value, key);
}

export interface PhysicsWorldOptions<D extends PhysicsDimension> {
    readonly backend: PhysicsBackend<D>;
    readonly gravity: PhysicsVector<D>;
    /** Fixed simulation interval in seconds. Defaults to 1/60. */
    readonly fixedTimeStep?: number;
    /** Maximum fixed steps performed by one visual frame. Defaults to 4. */
    readonly maxSubSteps?: number;
    /** Maximum visual delta accepted in seconds. Defaults to 0.25. */
    readonly maxDeltaSeconds?: number;
    readonly timeScale?: number;
    readonly lengthUnit?: number;
    readonly solverIterations?: number;
    readonly internalPgsIterations?: number;
    readonly maxCcdSubsteps?: number;
}

export interface PhysicsAdvanceResult {
    readonly steps: number;
    readonly interpolationAlpha: number;
    readonly droppedTimeSeconds: number;
}

export interface PhysicsCollisionEvent<D extends PhysicsDimension> extends DispatchEvent {
    readonly type: 'collisionstart' | 'collisionend';
    readonly collider1: PhysicsCollider<D>;
    readonly collider2: PhysicsCollider<D>;
    readonly body1: PhysicsRigidBody<D> | null;
    readonly body2: PhysicsRigidBody<D> | null;
}

export interface PhysicsContactForceEvent<D extends PhysicsDimension> extends DispatchEvent {
    readonly type: 'contactforce';
    readonly collider1: PhysicsCollider<D>;
    readonly collider2: PhysicsCollider<D>;
    readonly body1: PhysicsRigidBody<D> | null;
    readonly body2: PhysicsRigidBody<D> | null;
    readonly totalForce: PhysicsVector<D>;
    readonly totalForceMagnitude: number;
    readonly maxForceDirection: PhysicsVector<D>;
    readonly maxForceMagnitude: number;
}

export type PhysicsWorldEvent<D extends PhysicsDimension> =
    PhysicsCollisionEvent<D> | PhysicsContactForceEvent<D>;

export type PhysicsColliderEvent<D extends PhysicsDimension> = PhysicsWorldEvent<D> & {
    readonly self: PhysicsCollider<D>;
    readonly other: PhysicsCollider<D>;
};

function requirePositiveFinite(value: number, name: string): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive finite number.`);
    }
    return value;
}

function requireNonNegativeFinite(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative finite number.`);
    }
    return value;
}

function requirePositiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer.`);
    }
    return value;
}

abstract class PhysicsObject<D extends PhysicsDimension> extends EventDispatcher {
    readonly world: PhysicsWorld<D>;
    readonly handle: number;
    readonly generation: number;

    constructor(world: PhysicsWorld<D>, handle: number) {
        super();
        this.world = world;
        this.handle = handle;
        this.generation = world.generation;
    }

    abstract get valid(): boolean;

    protected requireValid(kind: string): void {
        if (!this.valid) throw new Error(`${kind} ${String(this.handle)} is no longer valid.`);
    }
}

/** Backend-independent rigid body handle with force, impulse, velocity, sleep, and pose controls. */
export class PhysicsRigidBody<D extends PhysicsDimension> extends PhysicsObject<D> {
    readonly type: PhysicsRigidBodyType;
    readonly userData: unknown;

    constructor(
        world: PhysicsWorld<D>,
        handle: number,
        type: PhysicsRigidBodyType,
        userData?: unknown
    ) {
        super(world, handle);
        this.type = type;
        this.userData = userData;
    }

    get valid(): boolean {
        return this.generation === this.world.generation && this.world.hasRigidBody(this.handle);
    }

    get pose(): PhysicsPose<D> {
        this.requireValid('Rigid body');
        return this.world.backendWorld.bodyPose(this.handle);
    }

    get linearVelocity(): PhysicsVector<D> {
        this.requireValid('Rigid body');
        return this.world.backendWorld.bodyLinearVelocity(this.handle);
    }

    get angularVelocity(): PhysicsAngularVelocity<D> {
        this.requireValid('Rigid body');
        return this.world.backendWorld.bodyAngularVelocity(this.handle);
    }

    get sleeping(): boolean {
        this.requireValid('Rigid body');
        return this.world.backendWorld.isRigidBodySleeping(this.handle);
    }

    setPose(pose: PhysicsPose<D>, wakeUp = true): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.setBodyPose(this.handle, pose, wakeUp);
        return this;
    }

    setNextKinematicPose(pose: PhysicsPose<D>): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.setNextKinematicPose(this.handle, pose);
        return this;
    }

    setLinearVelocity(velocity: PhysicsVector<D>, wakeUp = true): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.setBodyLinearVelocity(this.handle, velocity, wakeUp);
        return this;
    }

    setAngularVelocity(velocity: PhysicsAngularVelocity<D>, wakeUp = true): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.setBodyAngularVelocity(this.handle, velocity, wakeUp);
        return this;
    }

    applyForce(force: PhysicsVector<D>, wakeUp = true): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.applyForce(this.handle, force, wakeUp);
        return this;
    }

    applyImpulse(impulse: PhysicsVector<D>, wakeUp = true): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.applyImpulse(this.handle, impulse, wakeUp);
        return this;
    }

    applyTorque(torque: PhysicsAngularVelocity<D>, wakeUp = true): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.applyTorque(this.handle, torque, wakeUp);
        return this;
    }

    applyTorqueImpulse(torqueImpulse: PhysicsAngularVelocity<D>, wakeUp = true): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.applyTorqueImpulse(this.handle, torqueImpulse, wakeUp);
        return this;
    }

    sleep(): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.sleepRigidBody(this.handle);
        return this;
    }

    wake(): this {
        this.requireValid('Rigid body');
        this.world.backendWorld.wakeRigidBody(this.handle);
        return this;
    }

    destroy(): void {
        if (this.valid) this.world.removeRigidBody(this);
    }
}

/** Backend-independent collider handle. Collision and force events are dispatched on this object. */
export class PhysicsCollider<D extends PhysicsDimension> extends PhysicsObject<D> {
    readonly parent: PhysicsRigidBody<D> | null;
    readonly userData: unknown;

    constructor(
        world: PhysicsWorld<D>,
        handle: number,
        parent: PhysicsRigidBody<D> | null,
        userData?: unknown
    ) {
        super(world, handle);
        this.parent = parent;
        this.userData = userData;
    }

    get valid(): boolean {
        return this.generation === this.world.generation && this.world.hasCollider(this.handle);
    }

    destroy(wakeUp = true): void {
        if (this.valid) this.world.removeCollider(this, wakeUp);
    }
}

/** Backend-independent impulse-joint handle with common limits and motor controls. */
export class PhysicsJoint<D extends PhysicsDimension> extends PhysicsObject<D> {
    get valid(): boolean {
        return this.generation === this.world.generation && this.world.hasJoint(this.handle);
    }

    setLimits(min: number, max: number): this {
        this.requireValid('Joint');
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
            throw new RangeError('Joint limits must be finite and ordered min <= max.');
        }
        this.world.backendWorld.setJointLimits(this.handle, min, max);
        return this;
    }

    configureMotor(options: PhysicsJointMotorOptions): this {
        this.requireValid('Joint');
        const targetPosition = options.targetPosition ?? 0;
        const targetVelocity = options.targetVelocity ?? 0;
        const stiffness = requireNonNegativeFinite(options.stiffness ?? 0, 'Motor stiffness');
        const damping = requireNonNegativeFinite(options.damping ?? 0, 'Motor damping');
        if (!Number.isFinite(targetPosition) || !Number.isFinite(targetVelocity)) {
            throw new RangeError('Motor targets must be finite.');
        }
        this.world.backendWorld.configureJointMotor(
            this.handle,
            targetPosition,
            targetVelocity,
            stiffness,
            damping
        );
        return this;
    }

    destroy(wakeUp = true): void {
        if (this.valid) this.world.removeJoint(this, wakeUp);
    }
}

/** Backend-independent kinematic character controller. The caller applies the returned movement. */
export class PhysicsCharacterController<D extends PhysicsDimension> extends PhysicsObject<D> {
    get valid(): boolean {
        return (
            this.generation === this.world.generation &&
            this.world.hasCharacterController(this.handle)
        );
    }

    computeMovement(
        collider: PhysicsCollider<D>,
        desiredTranslation: PhysicsVector<D>,
        filter?: PhysicsQueryFilter
    ): PhysicsCharacterMovement<D> {
        this.requireValid('Character controller');
        return this.world.computeCharacterMovement(this, collider, desiredTranslation, filter);
    }

    destroy(): void {
        if (this.valid) this.world.removeCharacterController(this);
    }
}

/**
 * Production scheduler and object owner shared by all physics backends. Simulation uses a bounded
 * fixed step; rendering may interpolate one step behind while authoritative state stays discrete.
 */
export class PhysicsWorld<D extends PhysicsDimension> extends EventDispatcher {
    readonly backendWorld: PhysicsBackendWorld<D>;
    readonly dimension: D;
    readonly fixedTimeStep: number;
    readonly maxSubSteps: number;
    readonly maxDeltaSeconds: number;
    paused = false;
    private generationValue = 1;
    private timeScaleValue: number;
    private accumulator = 0;
    private simulatedSteps = 0;
    private droppedTime = 0;
    private interpolationAlpha = 0;
    private destroyed = false;
    private readonly bodies = new Map<number, PhysicsRigidBody<D>>();
    private readonly colliders = new Map<number, PhysicsCollider<D>>();
    private readonly joints = new Map<number, PhysicsJoint<D>>();
    private readonly characterControllers = new Map<number, PhysicsCharacterController<D>>();

    get generation(): number {
        return this.generationValue;
    }

    get timeScale(): number {
        return this.timeScaleValue;
    }

    set timeScale(value: number) {
        this.timeScaleValue = requireNonNegativeFinite(value, 'Physics timeScale');
    }

    private constructor(backendWorld: PhysicsBackendWorld<D>, options: PhysicsWorldOptions<D>) {
        super();
        this.backendWorld = backendWorld;
        this.dimension = backendWorld.dimension;
        this.fixedTimeStep = requirePositiveFinite(
            options.fixedTimeStep ?? 1 / 60,
            'Physics fixedTimeStep'
        );
        this.maxSubSteps = requirePositiveInteger(options.maxSubSteps ?? 4, 'Physics maxSubSteps');
        this.maxDeltaSeconds = requirePositiveFinite(
            options.maxDeltaSeconds ?? 0.25,
            'Physics maxDeltaSeconds'
        );
        this.timeScaleValue = requireNonNegativeFinite(options.timeScale ?? 1, 'Physics timeScale');
    }

    static async create<D extends PhysicsDimension>(
        options: PhysicsWorldOptions<D>
    ): Promise<PhysicsWorld<D>> {
        let backendWorld: PhysicsBackendWorld<D> | undefined;
        try {
            backendWorld = await options.backend.createWorld({
                gravity: options.gravity,
                lengthUnit: requirePositiveFinite(options.lengthUnit ?? 1, 'Physics lengthUnit'),
                solverIterations: requirePositiveInteger(
                    options.solverIterations ?? 4,
                    'Physics solverIterations'
                ),
                internalPgsIterations: requirePositiveInteger(
                    options.internalPgsIterations ?? 1,
                    'Physics internalPgsIterations'
                ),
                maxCcdSubsteps: requirePositiveInteger(
                    options.maxCcdSubsteps ?? 1,
                    'Physics maxCcdSubsteps'
                )
            });
            if (
                backendWorld.id !== options.backend.id ||
                readRuntimeProperty(backendWorld, 'dimension') !== options.backend.dimension
            ) {
                throw new TypeError('Physics backend returned an incompatible world.');
            }
            return new PhysicsWorld(backendWorld, options);
        } catch (cause) {
            if (backendWorld) {
                try {
                    backendWorld.destroy();
                } catch (destroyCause) {
                    throw new AggregateError(
                        [cause, destroyCause],
                        'Physics world creation and cleanup both failed.',
                        { cause: destroyCause }
                    );
                }
            }
            throw cause;
        }
    }

    setGravity(gravity: PhysicsVector<D>): this {
        this.requireAlive();
        this.backendWorld.setGravity(gravity);
        return this;
    }

    createRigidBody(descriptor: PhysicsRigidBodyDescriptor<D>): PhysicsRigidBody<D> {
        this.requireAlive();
        const handle = this.backendWorld.createRigidBody(descriptor);
        const body = new PhysicsRigidBody(
            this,
            handle,
            descriptor.type ?? 'dynamic',
            descriptor.userData
        );
        this.bodies.set(handle, body);
        return body;
    }

    removeRigidBody(body: PhysicsRigidBody<D>): void {
        this.requireOwned(body, 'Rigid body');
        this.backendWorld.removeRigidBody(body.handle);
        for (const collider of [...this.colliders.values()]) {
            if (collider.parent?.handle === body.handle) {
                collider.off();
                this.colliders.delete(collider.handle);
            }
        }
        this.bodies.delete(body.handle);
        body.off();
        for (const [handle, joint] of this.joints) {
            if (!this.backendWorld.hasJoint(handle)) {
                joint.off();
                this.joints.delete(handle);
            }
        }
    }

    getRigidBody(handle: number): PhysicsRigidBody<D> | null {
        return this.bodies.get(handle) ?? null;
    }

    hasRigidBody(handle: number): boolean {
        return this.bodies.has(handle) && this.backendWorld.hasRigidBody(handle);
    }

    createCollider(
        descriptor: PhysicsColliderDescriptor<D>,
        parent?: PhysicsRigidBody<D>
    ): PhysicsCollider<D> {
        this.requireAlive();
        if (parent) this.requireOwned(parent, 'Rigid body');
        const handle = this.backendWorld.createCollider(descriptor, parent?.handle);
        const collider = new PhysicsCollider(this, handle, parent ?? null, descriptor.userData);
        this.colliders.set(handle, collider);
        return collider;
    }

    removeCollider(collider: PhysicsCollider<D>, wakeUp = true): void {
        this.requireOwned(collider, 'Collider');
        this.backendWorld.removeCollider(collider.handle, wakeUp);
        this.colliders.delete(collider.handle);
        collider.off();
    }

    getCollider(handle: number): PhysicsCollider<D> | null {
        return this.colliders.get(handle) ?? null;
    }

    hasCollider(handle: number): boolean {
        return this.colliders.has(handle) && this.backendWorld.hasCollider(handle);
    }

    createJoint(
        descriptor: PhysicsJointDescriptor<D>,
        body1: PhysicsRigidBody<D>,
        body2: PhysicsRigidBody<D>,
        wakeUp = true
    ): PhysicsJoint<D> {
        this.requireAlive();
        this.requireOwned(body1, 'Rigid body');
        this.requireOwned(body2, 'Rigid body');
        if (body1 === body2) throw new TypeError('A joint requires two distinct rigid bodies.');
        const handle = this.backendWorld.createJoint(
            descriptor,
            body1.handle,
            body2.handle,
            wakeUp
        );
        const joint = new PhysicsJoint(this, handle);
        this.joints.set(handle, joint);
        return joint;
    }

    removeJoint(joint: PhysicsJoint<D>, wakeUp = true): void {
        this.requireOwned(joint, 'Joint');
        this.backendWorld.removeJoint(joint.handle, wakeUp);
        this.joints.delete(joint.handle);
        joint.off();
    }

    getJoint(handle: number): PhysicsJoint<D> | null {
        return this.joints.get(handle) ?? null;
    }

    hasJoint(handle: number): boolean {
        return this.joints.has(handle) && this.backendWorld.hasJoint(handle);
    }

    createCharacterController(
        options: PhysicsCharacterControllerOptions<D>
    ): PhysicsCharacterController<D> {
        this.requireAlive();
        const handle = this.backendWorld.createCharacterController(options);
        const controller = new PhysicsCharacterController(this, handle);
        this.characterControllers.set(handle, controller);
        return controller;
    }

    removeCharacterController(controller: PhysicsCharacterController<D>): void {
        this.requireOwned(controller, 'Character controller');
        this.backendWorld.removeCharacterController(controller.handle);
        this.characterControllers.delete(controller.handle);
        controller.off();
    }

    hasCharacterController(handle: number): boolean {
        return (
            this.characterControllers.has(handle) &&
            this.backendWorld.hasCharacterController(handle)
        );
    }

    computeCharacterMovement(
        controller: PhysicsCharacterController<D>,
        collider: PhysicsCollider<D>,
        desiredTranslation: PhysicsVector<D>,
        filter?: PhysicsQueryFilter
    ): PhysicsCharacterMovement<D> {
        this.requireOwned(controller, 'Character controller');
        this.requireOwned(collider, 'Character collider');
        return this.backendWorld.computeCharacterMovement(
            controller.handle,
            collider.handle,
            desiredTranslation,
            filter
        );
    }

    /** Advance from a visual-frame duration expressed in milliseconds. */
    advance(deltaTimeMilliseconds: number): PhysicsAdvanceResult {
        this.requireAlive();
        if (!Number.isFinite(deltaTimeMilliseconds) || deltaTimeMilliseconds < 0) {
            throw new RangeError('Physics frame delta must be a non-negative finite number.');
        }
        if (this.paused || this.timeScale === 0) {
            return { steps: 0, interpolationAlpha: this.interpolationAlpha, droppedTimeSeconds: 0 };
        }
        const scaledDelta = (deltaTimeMilliseconds / 1000) * this.timeScale;
        requireNonNegativeFinite(scaledDelta, 'Scaled physics frame delta');
        const acceptedDelta = Math.min(scaledDelta, this.maxDeltaSeconds);
        let droppedThisFrame = scaledDelta - acceptedDelta;
        this.accumulator += acceptedDelta;

        const availableSteps = Math.floor(this.accumulator / this.fixedTimeStep);
        const stepCount = Math.min(availableSteps, this.maxSubSteps);
        if (availableSteps > this.maxSubSteps) {
            const overflowSteps = availableSteps - this.maxSubSteps;
            const overflowTime = overflowSteps * this.fixedTimeStep;
            this.accumulator -= overflowTime;
            droppedThisFrame += overflowTime;
        }
        for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
            this.backendWorld.step(this.fixedTimeStep);
            this.drainBackendEvents();
            this.accumulator -= this.fixedTimeStep;
            this.simulatedSteps += 1;
        }
        this.accumulator = Math.max(0, this.accumulator);
        this.interpolationAlpha = Math.min(1, Math.max(0, this.accumulator / this.fixedTimeStep));
        this.droppedTime += droppedThisFrame;
        return {
            steps: stepCount,
            interpolationAlpha: this.interpolationAlpha,
            droppedTimeSeconds: droppedThisFrame
        };
    }

    castRay(
        origin: PhysicsVector<D>,
        direction: PhysicsVector<D>,
        maxDistance: number,
        solid = true,
        filter?: PhysicsQueryFilter
    ): PhysicsRaycastHit<D> | null {
        this.requireAlive();
        requirePositiveFinite(maxDistance, 'Ray maxDistance');
        const magnitude =
            'z' in direction
                ? Math.hypot(direction.x, direction.y, direction.z)
                : Math.hypot(direction.x, direction.y);
        requirePositiveFinite(magnitude, 'Ray direction length');
        return this.backendWorld.castRay(origin, direction, maxDistance, solid, filter);
    }

    /** Sweep a portable shape along `velocity * maxTimeOfImpact`. */
    castShape(
        pose: PhysicsPose<D>,
        velocity: PhysicsVector<D>,
        shape: PhysicsShape<D>,
        options: PhysicsShapeCastOptions = {}
    ): PhysicsShapeCastHit<D> | null {
        this.requireAlive();
        const magnitude =
            'z' in velocity
                ? Math.hypot(velocity.x, velocity.y, velocity.z)
                : Math.hypot(velocity.x, velocity.y);
        requirePositiveFinite(magnitude, 'Shape-cast velocity length');
        return this.backendWorld.castShape(
            pose,
            velocity,
            shape,
            requireNonNegativeFinite(options.targetDistance ?? 0, 'Shape-cast target distance'),
            requirePositiveFinite(
                options.maxTimeOfImpact ?? 1,
                'Shape-cast maximum time of impact'
            ),
            options.stopAtPenetration ?? true,
            options.filter
        );
    }

    /** Collect colliders overlapping a portable shape, bounded by `maxResults`. */
    overlapShape(
        pose: PhysicsPose<D>,
        shape: PhysicsShape<D>,
        options: PhysicsOverlapShapeOptions = {}
    ): readonly PhysicsCollider<D>[] {
        this.requireAlive();
        const handles = this.backendWorld.intersectionsWithShape(
            pose,
            shape,
            requirePositiveInteger(options.maxResults ?? 64, 'Shape overlap maxResults'),
            options.filter
        );
        return handles.flatMap(handle => {
            const collider = this.colliders.get(handle);
            return collider ? [collider] : [];
        });
    }

    /** Project a point onto the nearest collider from the last completed simulation step. */
    projectPoint(
        point: PhysicsVector<D>,
        solid = true,
        filter?: PhysicsQueryFilter
    ): PhysicsPointProjection<D> | null {
        this.requireAlive();
        return this.backendWorld.projectPoint(point, solid, filter);
    }

    takeSnapshot(): PhysicsWorldSnapshot {
        this.requireAlive();
        return {
            version: SNAPSHOT_VERSION,
            backendId: this.backendWorld.id,
            dimension: this.dimension,
            data: this.backendWorld.takeSnapshot().slice()
        };
    }

    /**
     * Restore native state and start a new object generation. Existing body/collider/joint wrappers
     * become invalid and transform bindings are deliberately cleared.
     */
    restoreSnapshot(snapshot: PhysicsWorldSnapshot): void {
        this.requireAlive();
        if (
            readRuntimeProperty(snapshot, 'version') !== SNAPSHOT_VERSION ||
            snapshot.backendId !== this.backendWorld.id ||
            snapshot.dimension !== this.dimension
        ) {
            throw new TypeError('Physics snapshot is incompatible with this world.');
        }
        this.backendWorld.restoreSnapshot(snapshot.data.slice());
        this.generationValue += 1;
        this.accumulator = 0;
        this.interpolationAlpha = 0;
        for (const object of [
            ...this.bodies.values(),
            ...this.colliders.values(),
            ...this.joints.values(),
            ...this.characterControllers.values()
        ]) {
            object.off();
        }
        this.bodies.clear();
        this.colliders.clear();
        this.joints.clear();
        this.characterControllers.clear();
        for (const handle of this.backendWorld.rigidBodyHandles()) {
            this.bodies.set(
                handle,
                new PhysicsRigidBody(this, handle, this.backendWorld.rigidBodyType(handle))
            );
        }
        for (const handle of this.backendWorld.colliderHandles()) {
            const parentHandle = this.backendWorld.colliderParent(handle);
            const parent =
                parentHandle === undefined ? null : (this.bodies.get(parentHandle) ?? null);
            this.colliders.set(handle, new PhysicsCollider(this, handle, parent));
        }
        for (const handle of this.backendWorld.jointHandles()) {
            this.joints.set(handle, new PhysicsJoint(this, handle));
        }
        this.fire('snapshotrestored');
    }

    debugRender(): PhysicsDebugGeometry {
        this.requireAlive();
        return this.backendWorld.debugRender();
    }

    getExtension<T>(extension: PhysicsBackendExtension<T>): T | null {
        this.requireAlive();
        return this.backendWorld.getExtension(extension);
    }

    getDiagnostics(): PhysicsWorldDiagnostics {
        return Object.freeze({
            bodyCount: this.bodies.size,
            colliderCount: this.colliders.size,
            jointCount: this.joints.size,
            characterControllerCount: this.characterControllers.size,
            simulatedSteps: this.simulatedSteps,
            droppedTimeSeconds: this.droppedTime,
            accumulatorSeconds: this.accumulator,
            interpolationAlpha: this.interpolationAlpha
        });
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const object of [
            ...this.bodies.values(),
            ...this.colliders.values(),
            ...this.joints.values(),
            ...this.characterControllers.values()
        ]) {
            object.off();
        }
        this.bodies.clear();
        this.colliders.clear();
        this.joints.clear();
        this.characterControllers.clear();
        this.off();
        this.backendWorld.destroy();
    }

    private drainBackendEvents(): void {
        this.backendWorld.drainEvents(event => {
            this.dispatchBackendEvent(event);
        });
    }

    private dispatchBackendEvent(event: PhysicsBackendEvent<D>): void {
        const firstHandle = Math.min(event.collider1, event.collider2);
        const secondHandle = Math.max(event.collider1, event.collider2);
        const collider1 = this.colliders.get(firstHandle);
        const collider2 = this.colliders.get(secondHandle);
        if (!collider1 || !collider2) return;
        const common = {
            collider1,
            collider2,
            body1: collider1.parent,
            body2: collider2.parent
        };
        let worldEvent: PhysicsWorldEvent<D>;
        if (event.type === 'collision') {
            worldEvent = {
                type: event.started ? 'collisionstart' : 'collisionend',
                ...common
            };
        } else {
            worldEvent = {
                type: 'contactforce',
                ...common,
                totalForce: event.totalForce,
                totalForceMagnitude: event.totalForceMagnitude,
                maxForceDirection: event.maxForceDirection,
                maxForceMagnitude: event.maxForceMagnitude
            };
        }
        this.fire(worldEvent);
        const firstEvent: PhysicsColliderEvent<D> = {
            ...worldEvent,
            self: collider1,
            other: collider2
        };
        const secondEvent: PhysicsColliderEvent<D> = {
            ...worldEvent,
            self: collider2,
            other: collider1
        };
        collider1.fire(firstEvent);
        collider2.fire(secondEvent);
    }

    private requireOwned(object: PhysicsObject<D>, kind: string): void {
        this.requireAlive();
        if (object.world !== this || !object.valid) {
            throw new TypeError(`${kind} does not belong to this active physics world.`);
        }
    }

    private requireAlive(): void {
        if (this.destroyed) throw new Error('Physics world has been destroyed.');
    }
}
