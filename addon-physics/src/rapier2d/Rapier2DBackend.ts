import RAPIER from '@dimforge/rapier2d-compat';
import {
    createPhysicsBackendExtension,
    type PhysicsBackend,
    type PhysicsBackendEvent,
    type PhysicsBackendExtension,
    type PhysicsBackendWorld,
    type PhysicsBackendWorldOptions
} from '../PhysicsBackend.js';
import type {
    PhysicsCharacterCollision,
    PhysicsCharacterControllerOptions,
    PhysicsCharacterMovement,
    PhysicsCoefficientCombineRule,
    PhysicsColliderDescriptor2D,
    PhysicsDebugGeometry,
    PhysicsJointDescriptor2D,
    PhysicsPointProjection2D,
    PhysicsPose2D,
    PhysicsQueryFilter,
    PhysicsRaycastHit2D,
    PhysicsRigidBodyDescriptor2D,
    PhysicsRigidBodyType,
    PhysicsShape2D,
    PhysicsShapeCastHit2D,
    PhysicsVector2
} from '../types.js';

export interface Rapier2DNativeExtension {
    readonly module: typeof RAPIER;
    readonly world: RAPIER.World;
}

export const RAPIER_2D_NATIVE_EXTENSION =
    createPhysicsBackendExtension<Rapier2DNativeExtension>('rapier2d-native');

let initialization: Promise<void> | null = null;

function initializeRapier(): Promise<void> {
    return (initialization ??= RAPIER.init().catch((cause: unknown) => {
        initialization = null;
        throw cause;
    }));
}

function requireFinite(value: number, name: string): number {
    if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
    return value;
}

function requireNonNegative(value: number, name: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative finite number.`);
    }
    return value;
}

function requirePositive(value: number, name: string): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive finite number.`);
    }
    return value;
}

function requireIntegerInRange(value: number, min: number, max: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new RangeError(`${name} must be an integer in [${String(min)}, ${String(max)}].`);
    }
    return value;
}

function requireFiniteArray(values: Float32Array, name: string): void {
    for (const value of values) requireFinite(value, name);
}

function requireIndices(indices: Uint32Array, vertexCount: number, name: string): void {
    for (const index of indices) {
        if (index >= vertexCount) {
            throw new RangeError(`${name} contains an out-of-range vertex index.`);
        }
    }
}

function vector(value: PhysicsVector2): RAPIER.Vector {
    return {
        x: requireFinite(value.x, 'Vector x'),
        y: requireFinite(value.y, 'Vector y')
    };
}

function unitVector(value: PhysicsVector2, name: string): RAPIER.Vector {
    const result = vector(value);
    const length = Math.hypot(result.x, result.y);
    if (length <= Number.EPSILON) throw new RangeError(`${name} cannot be zero.`);
    return { x: result.x / length, y: result.y / length };
}

function jointLimits(values: readonly [number, number]): [number, number] {
    const min = requireFinite(values[0], 'Joint limit minimum');
    const max = requireFinite(values[1], 'Joint limit maximum');
    if (min > max) throw new RangeError('Joint limits must be ordered min <= max.');
    return [min, max];
}

function pose(position: RAPIER.Vector, rotation: RAPIER.Rotation): PhysicsPose2D {
    return {
        position: { x: position.x, y: position.y },
        rotation
    };
}

function bodyDescriptor(type: PhysicsRigidBodyType): RAPIER.RigidBodyDesc {
    switch (type) {
        case 'dynamic':
            return RAPIER.RigidBodyDesc.dynamic();
        case 'fixed':
            return RAPIER.RigidBodyDesc.fixed();
        case 'kinematic-position':
            return RAPIER.RigidBodyDesc.kinematicPositionBased();
        case 'kinematic-velocity':
            return RAPIER.RigidBodyDesc.kinematicVelocityBased();
    }
}

function bodyType(type: RAPIER.RigidBodyType): PhysicsRigidBodyType {
    switch (type) {
        case RAPIER.RigidBodyType.Dynamic:
            return 'dynamic';
        case RAPIER.RigidBodyType.Fixed:
            return 'fixed';
        case RAPIER.RigidBodyType.KinematicPositionBased:
            return 'kinematic-position';
        case RAPIER.RigidBodyType.KinematicVelocityBased:
            return 'kinematic-velocity';
    }
}

function combineRule(rule: PhysicsCoefficientCombineRule): RAPIER.CoefficientCombineRule {
    switch (rule) {
        case 'average':
            return RAPIER.CoefficientCombineRule.Average;
        case 'min':
            return RAPIER.CoefficientCombineRule.Min;
        case 'multiply':
            return RAPIER.CoefficientCombineRule.Multiply;
        case 'max':
            return RAPIER.CoefficientCombineRule.Max;
    }
}

function interactionGroups(groups: {
    readonly memberships: number;
    readonly filter: number;
}): number {
    if (
        !Number.isSafeInteger(groups.memberships) ||
        groups.memberships < 0 ||
        groups.memberships > 0xffff ||
        !Number.isSafeInteger(groups.filter) ||
        groups.filter < 0 ||
        groups.filter > 0xffff
    ) {
        throw new RangeError(
            'Physics interaction memberships and filters must be 16-bit integers.'
        );
    }
    return ((groups.memberships << 16) | groups.filter) >>> 0;
}

function createColliderDescriptor(descriptor: PhysicsColliderDescriptor2D): RAPIER.ColliderDesc {
    const shape = descriptor.shape;
    let result: RAPIER.ColliderDesc | null;
    switch (shape.type) {
        case 'ball':
            result = RAPIER.ColliderDesc.ball(requirePositive(shape.radius, 'Ball radius'));
            break;
        case 'cuboid': {
            const x = requirePositive(shape.halfExtents.x, 'Cuboid half extent x');
            const y = requirePositive(shape.halfExtents.y, 'Cuboid half extent y');
            result =
                shape.borderRadius === undefined
                    ? RAPIER.ColliderDesc.cuboid(x, y)
                    : RAPIER.ColliderDesc.roundCuboid(
                          x,
                          y,
                          requirePositive(shape.borderRadius, 'Cuboid border radius')
                      );
            break;
        }
        case 'capsule':
            result = RAPIER.ColliderDesc.capsule(
                requirePositive(shape.halfHeight, 'Capsule half height'),
                requirePositive(shape.radius, 'Capsule radius')
            );
            break;
        case 'segment':
            result = RAPIER.ColliderDesc.segment(vector(shape.a), vector(shape.b));
            break;
        case 'triangle':
            result =
                shape.borderRadius === undefined
                    ? RAPIER.ColliderDesc.triangle(
                          vector(shape.a),
                          vector(shape.b),
                          vector(shape.c)
                      )
                    : RAPIER.ColliderDesc.roundTriangle(
                          vector(shape.a),
                          vector(shape.b),
                          vector(shape.c),
                          requirePositive(shape.borderRadius, 'Triangle border radius')
                      );
            break;
        case 'polyline':
            if (shape.vertices.length < 4 || shape.vertices.length % 2 !== 0) {
                throw new RangeError('2D polylines require packed xy vertices.');
            }
            requireFiniteArray(shape.vertices, 'Polyline vertex');
            if (shape.indices) {
                if (shape.indices.length % 2 !== 0) {
                    throw new RangeError('2D polyline indices must contain endpoint pairs.');
                }
                requireIndices(shape.indices, shape.vertices.length / 2, 'Polyline indices');
            }
            result = RAPIER.ColliderDesc.polyline(shape.vertices, shape.indices);
            break;
        case 'trimesh':
            if (
                shape.vertices.length < 6 ||
                shape.vertices.length % 2 !== 0 ||
                shape.indices.length < 3 ||
                shape.indices.length % 3 !== 0
            ) {
                throw new RangeError(
                    '2D triangle meshes require packed xy vertices and triangles.'
                );
            }
            requireFiniteArray(shape.vertices, 'Triangle-mesh vertex');
            requireIndices(shape.indices, shape.vertices.length / 2, 'Triangle-mesh indices');
            result = RAPIER.ColliderDesc.trimesh(shape.vertices, shape.indices);
            break;
        case 'convex-hull':
            if (shape.points.length < 6 || shape.points.length % 2 !== 0) {
                throw new RangeError('2D convex hulls require packed xy points.');
            }
            requireFiniteArray(shape.points, 'Convex-hull point');
            result =
                shape.borderRadius === undefined
                    ? RAPIER.ColliderDesc.convexHull(shape.points)
                    : RAPIER.ColliderDesc.roundConvexHull(
                          shape.points,
                          requirePositive(shape.borderRadius, 'Convex hull border radius')
                      );
            if (!result) throw new RangeError('Rapier could not construct the 2D convex hull.');
            break;
        case 'heightfield':
            if (shape.heights.length < 2) {
                throw new RangeError('2D heightfields require at least two samples.');
            }
            requireFiniteArray(shape.heights, 'Heightfield sample');
            result = RAPIER.ColliderDesc.heightfield(shape.heights, vector(shape.scale));
            break;
        case 'halfspace':
            result = RAPIER.ColliderDesc.halfspace(unitVector(shape.normal, 'Halfspace normal'));
            break;
    }

    if (descriptor.localPosition) {
        const translation = vector(descriptor.localPosition);
        result.setTranslation(translation.x, translation.y);
    }
    if (descriptor.localRotation !== undefined) {
        result.setRotation(requireFinite(descriptor.localRotation, 'Collider local rotation'));
    }
    if (descriptor.enabled !== undefined) result.setEnabled(descriptor.enabled);
    if (descriptor.sensor !== undefined) result.setSensor(descriptor.sensor);
    if (descriptor.density !== undefined && descriptor.mass !== undefined) {
        throw new TypeError('Collider density and mass are mutually exclusive.');
    }
    if (descriptor.density !== undefined)
        result.setDensity(requireNonNegative(descriptor.density, 'Collider density'));
    if (descriptor.mass !== undefined)
        result.setMass(requireNonNegative(descriptor.mass, 'Collider mass'));
    if (descriptor.friction !== undefined)
        result.setFriction(requireNonNegative(descriptor.friction, 'Collider friction'));
    if (descriptor.restitution !== undefined) {
        const restitution = requireNonNegative(descriptor.restitution, 'Collider restitution');
        if (restitution > 1) throw new RangeError('Collider restitution must be in [0, 1].');
        result.setRestitution(restitution);
    }
    if (descriptor.frictionCombineRule)
        result.setFrictionCombineRule(combineRule(descriptor.frictionCombineRule));
    if (descriptor.restitutionCombineRule)
        result.setRestitutionCombineRule(combineRule(descriptor.restitutionCombineRule));
    if (descriptor.contactSkin !== undefined)
        result.setContactSkin(requireNonNegative(descriptor.contactSkin, 'Collider contact skin'));
    if (descriptor.collisionGroups)
        result.setCollisionGroups(interactionGroups(descriptor.collisionGroups));
    if (descriptor.solverGroups) result.setSolverGroups(interactionGroups(descriptor.solverGroups));
    let events = RAPIER.ActiveEvents.NONE;
    if (descriptor.collisionEvents) events |= RAPIER.ActiveEvents.COLLISION_EVENTS;
    if (descriptor.contactForceEventThreshold !== undefined) {
        events |= RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS;
        result.setContactForceEventThreshold(
            requireNonNegative(
                descriptor.contactForceEventThreshold,
                'Contact force event threshold'
            )
        );
    }
    result.setActiveEvents(events);
    return result;
}

function createJointDescriptor(descriptor: PhysicsJointDescriptor2D): RAPIER.JointData {
    let result: RAPIER.JointData;
    switch (descriptor.type) {
        case 'fixed':
            result = RAPIER.JointData.fixed(
                vector(descriptor.anchor1),
                requireFinite(descriptor.rotation1 ?? 0, 'Fixed joint rotation 1'),
                vector(descriptor.anchor2),
                requireFinite(descriptor.rotation2 ?? 0, 'Fixed joint rotation 2')
            );
            break;
        case 'revolute':
            result = RAPIER.JointData.revolute(
                vector(descriptor.anchor1),
                vector(descriptor.anchor2)
            );
            if (descriptor.limits) {
                result.limitsEnabled = true;
                result.limits = jointLimits(descriptor.limits);
            }
            break;
        case 'prismatic':
            result = RAPIER.JointData.prismatic(
                vector(descriptor.anchor1),
                vector(descriptor.anchor2),
                unitVector(descriptor.axis, 'Prismatic joint axis')
            );
            if (descriptor.limits) {
                result.limitsEnabled = true;
                result.limits = jointLimits(descriptor.limits);
            }
            break;
        case 'rope':
            result = RAPIER.JointData.rope(
                requirePositive(descriptor.length, 'Rope length'),
                vector(descriptor.anchor1),
                vector(descriptor.anchor2)
            );
            break;
        case 'spring':
            result = RAPIER.JointData.spring(
                requireNonNegative(descriptor.restLength, 'Spring rest length'),
                requireNonNegative(descriptor.stiffness, 'Spring stiffness'),
                requireNonNegative(descriptor.damping, 'Spring damping'),
                vector(descriptor.anchor1),
                vector(descriptor.anchor2)
            );
            break;
    }
    return result;
}

function queryFlags(filter?: PhysicsQueryFilter): RAPIER.QueryFilterFlags | undefined {
    if (!filter) return undefined;
    let flags = 0;
    if (filter.excludeFixed) flags |= RAPIER.QueryFilterFlags.EXCLUDE_FIXED;
    if (filter.excludeKinematic) flags |= RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC;
    if (filter.excludeDynamic) flags |= RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC;
    if (filter.excludeSensors) flags |= RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    if (filter.excludeSolids) flags |= RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS;
    return flags === 0 ? undefined : flags;
}

class Rapier2DWorld implements PhysicsBackendWorld<'2d'> {
    readonly id = 'rapier2d-compat-0.20';
    readonly dimension = '2d' as const;
    private world: RAPIER.World;
    private readonly eventQueue = new RAPIER.EventQueue(true);
    private readonly characterControllers = new Map<number, RAPIER.KinematicCharacterController>();
    private nextCharacterControllerHandle = 1;
    private destroyed = false;

    constructor(options: PhysicsBackendWorldOptions<'2d'>) {
        this.world = new RAPIER.World(vector(options.gravity));
        this.world.lengthUnit = options.lengthUnit;
        this.world.numSolverIterations = options.solverIterations;
        this.world.numInternalPgsIterations = options.internalPgsIterations;
        this.world.maxCcdSubsteps = options.maxCcdSubsteps;
    }

    setGravity(gravity: PhysicsVector2): void {
        this.requireAlive();
        this.world.gravity = vector(gravity);
    }

    step(deltaSeconds: number): void {
        this.requireAlive();
        this.world.timestep = requirePositive(deltaSeconds, 'Physics timestep');
        this.world.step(this.eventQueue);
    }

    createRigidBody(descriptor: PhysicsRigidBodyDescriptor2D): number {
        this.requireAlive();
        const result = bodyDescriptor(descriptor.type ?? 'dynamic');
        if (descriptor.position) {
            const translation = vector(descriptor.position);
            result.setTranslation(translation.x, translation.y);
        }
        if (descriptor.rotation !== undefined)
            result.setRotation(requireFinite(descriptor.rotation, 'Rigid body rotation'));
        if (descriptor.linearVelocity) {
            const velocity = vector(descriptor.linearVelocity);
            result.setLinvel(velocity.x, velocity.y);
        }
        if (descriptor.angularVelocity !== undefined)
            result.setAngvel(requireFinite(descriptor.angularVelocity, 'Angular velocity'));
        if (descriptor.enabled !== undefined) result.setEnabled(descriptor.enabled);
        if (descriptor.gravityScale !== undefined)
            result.setGravityScale(requireFinite(descriptor.gravityScale, 'Gravity scale'));
        if (descriptor.additionalMass !== undefined)
            result.setAdditionalMass(
                requireNonNegative(descriptor.additionalMass, 'Additional mass')
            );
        if (descriptor.linearDamping !== undefined)
            result.setLinearDamping(requireNonNegative(descriptor.linearDamping, 'Linear damping'));
        if (descriptor.angularDamping !== undefined)
            result.setAngularDamping(
                requireNonNegative(descriptor.angularDamping, 'Angular damping')
            );
        if (descriptor.canSleep !== undefined) result.setCanSleep(descriptor.canSleep);
        if (descriptor.sleeping !== undefined) result.setSleeping(descriptor.sleeping);
        if (descriptor.continuousCollisionDetection !== undefined)
            result.setCcdEnabled(descriptor.continuousCollisionDetection);
        if (descriptor.softCcdPrediction !== undefined)
            result.setSoftCcdPrediction(
                requireNonNegative(descriptor.softCcdPrediction, 'Soft CCD prediction')
            );
        if (descriptor.dominanceGroup !== undefined)
            result.setDominanceGroup(
                requireIntegerInRange(descriptor.dominanceGroup, -127, 127, 'Dominance group')
            );
        if (descriptor.additionalSolverIterations !== undefined)
            result.setAdditionalSolverIterations(
                requireIntegerInRange(
                    descriptor.additionalSolverIterations,
                    0,
                    0xffffffff,
                    'Additional solver iterations'
                )
            );
        if (descriptor.enabledTranslations)
            result.enabledTranslations(...descriptor.enabledTranslations);
        if (descriptor.rotationEnabled === false) result.lockRotations();
        if (descriptor.userData !== undefined) result.setUserData(descriptor.userData);
        return this.world.createRigidBody(result).handle;
    }

    removeRigidBody(handle: number): void {
        this.world.removeRigidBody(this.body(handle));
    }

    hasRigidBody(handle: number): boolean {
        return !this.destroyed && this.world.bodies.contains(handle);
    }

    rigidBodyType(handle: number): PhysicsRigidBodyType {
        return bodyType(this.body(handle).bodyType());
    }

    bodyPose(handle: number): PhysicsPose2D {
        const body = this.body(handle);
        return pose(body.translation(), body.rotation());
    }

    setBodyPose(handle: number, value: PhysicsPose2D, wakeUp: boolean): void {
        const body = this.body(handle);
        body.setTranslation(vector(value.position), wakeUp);
        body.setRotation(requireFinite(value.rotation, 'Rigid body rotation'), wakeUp);
    }

    setNextKinematicPose(handle: number, value: PhysicsPose2D): void {
        const body = this.body(handle);
        body.setNextKinematicTranslation(vector(value.position));
        body.setNextKinematicRotation(requireFinite(value.rotation, 'Kinematic rotation'));
    }

    bodyLinearVelocity(handle: number): PhysicsVector2 {
        const value = this.body(handle).linvel();
        return { x: value.x, y: value.y };
    }

    setBodyLinearVelocity(handle: number, velocity: PhysicsVector2, wakeUp: boolean): void {
        this.body(handle).setLinvel(vector(velocity), wakeUp);
    }

    bodyAngularVelocity(handle: number): number {
        return this.body(handle).angvel();
    }

    setBodyAngularVelocity(handle: number, velocity: number, wakeUp: boolean): void {
        this.body(handle).setAngvel(requireFinite(velocity, 'Angular velocity'), wakeUp);
    }

    applyForce(handle: number, force: PhysicsVector2, wakeUp: boolean): void {
        this.body(handle).addForce(vector(force), wakeUp);
    }

    applyImpulse(handle: number, impulse: PhysicsVector2, wakeUp: boolean): void {
        this.body(handle).applyImpulse(vector(impulse), wakeUp);
    }

    applyTorque(handle: number, torque: number, wakeUp: boolean): void {
        this.body(handle).addTorque(requireFinite(torque, 'Torque'), wakeUp);
    }

    applyTorqueImpulse(handle: number, torqueImpulse: number, wakeUp: boolean): void {
        this.body(handle).applyTorqueImpulse(
            requireFinite(torqueImpulse, 'Torque impulse'),
            wakeUp
        );
    }

    sleepRigidBody(handle: number): void {
        this.body(handle).sleep();
    }

    wakeRigidBody(handle: number): void {
        this.body(handle).wakeUp();
    }

    isRigidBodySleeping(handle: number): boolean {
        return this.body(handle).isSleeping();
    }

    createCollider(descriptor: PhysicsColliderDescriptor2D, parentHandle?: number): number {
        const parent = parentHandle === undefined ? undefined : this.body(parentHandle);
        return this.world.createCollider(createColliderDescriptor(descriptor), parent).handle;
    }

    removeCollider(handle: number, wakeUp: boolean): void {
        this.world.removeCollider(this.collider(handle), wakeUp);
    }

    hasCollider(handle: number): boolean {
        return !this.destroyed && this.world.colliders.contains(handle);
    }

    colliderParent(handle: number): number | undefined {
        return this.collider(handle).parent()?.handle;
    }

    createJoint(
        descriptor: PhysicsJointDescriptor2D,
        body1: number,
        body2: number,
        wakeUp: boolean
    ): number {
        const joint = this.world.createImpulseJoint(
            createJointDescriptor(descriptor),
            this.body(body1),
            this.body(body2),
            wakeUp
        );
        joint.setContactsEnabled(descriptor.contactsEnabled ?? true);
        return joint.handle;
    }

    removeJoint(handle: number, wakeUp: boolean): void {
        this.world.removeImpulseJoint(this.joint(handle), wakeUp);
    }

    hasJoint(handle: number): boolean {
        return !this.destroyed && this.world.impulseJoints.contains(handle);
    }

    setJointLimits(handle: number, min: number, max: number): void {
        const joint = this.joint(handle);
        if (!(joint instanceof RAPIER.UnitImpulseJoint)) {
            throw new TypeError('Only revolute and prismatic joints support scalar limits.');
        }
        const limits = jointLimits([min, max]);
        joint.setLimits(limits[0], limits[1]);
    }

    configureJointMotor(
        handle: number,
        targetPosition: number,
        targetVelocity: number,
        stiffness: number,
        damping: number
    ): void {
        const joint = this.joint(handle);
        if (!(joint instanceof RAPIER.UnitImpulseJoint)) {
            throw new TypeError(
                'Only revolute and prismatic joints support the common scalar motor.'
            );
        }
        joint.configureMotor(
            requireFinite(targetPosition, 'Motor target position'),
            requireFinite(targetVelocity, 'Motor target velocity'),
            requireNonNegative(stiffness, 'Motor stiffness'),
            requireNonNegative(damping, 'Motor damping')
        );
    }

    createCharacterController(options: PhysicsCharacterControllerOptions<'2d'>): number {
        this.requireAlive();
        const controller = this.world.createCharacterController(
            requirePositive(options.offset, 'Character controller offset')
        );
        if (options.up) controller.setUp(unitVector(options.up, 'Character up vector'));
        if (options.slide !== undefined) controller.setSlideEnabled(options.slide);
        if (options.autostep === false) {
            controller.disableAutostep();
        } else if (options.autostep) {
            controller.enableAutostep(
                requirePositive(options.autostep.maxHeight, 'Character autostep height'),
                requirePositive(options.autostep.minWidth, 'Character autostep width'),
                options.autostep.includeDynamicBodies ?? false
            );
        }
        if (options.maxSlopeClimbAngle !== undefined) {
            controller.setMaxSlopeClimbAngle(
                requireNonNegative(options.maxSlopeClimbAngle, 'Maximum slope climb angle')
            );
        }
        if (options.minSlopeSlideAngle !== undefined) {
            controller.setMinSlopeSlideAngle(
                requireNonNegative(options.minSlopeSlideAngle, 'Minimum slope slide angle')
            );
        }
        if (options.snapToGroundDistance === false) {
            controller.disableSnapToGround();
        } else if (options.snapToGroundDistance !== undefined) {
            controller.enableSnapToGround(
                requirePositive(options.snapToGroundDistance, 'Snap-to-ground distance')
            );
        }
        if (options.applyImpulsesToDynamicBodies !== undefined) {
            controller.setApplyImpulsesToDynamicBodies(options.applyImpulsesToDynamicBodies);
        }
        if (options.characterMass !== undefined) {
            controller.setCharacterMass(
                options.characterMass === null
                    ? null
                    : requireNonNegative(options.characterMass, 'Character mass')
            );
        }
        if (options.normalNudgeFactor !== undefined) {
            controller.setNormalNudgeFactor(
                requireNonNegative(options.normalNudgeFactor, 'Character normal nudge factor')
            );
        }
        const handle = this.nextCharacterControllerHandle;
        this.nextCharacterControllerHandle += 1;
        this.characterControllers.set(handle, controller);
        return handle;
    }

    removeCharacterController(handle: number): void {
        const controller = this.characterController(handle);
        this.world.removeCharacterController(controller);
        this.characterControllers.delete(handle);
    }

    hasCharacterController(handle: number): boolean {
        return !this.destroyed && this.characterControllers.has(handle);
    }

    computeCharacterMovement(
        controllerHandle: number,
        colliderHandle: number,
        desiredTranslation: PhysicsVector2,
        filter?: PhysicsQueryFilter
    ): PhysicsCharacterMovement<'2d'> {
        const controller = this.characterController(controllerHandle);
        controller.computeColliderMovement(
            this.collider(colliderHandle),
            vector(desiredTranslation),
            queryFlags(filter),
            filter?.groups ? interactionGroups(filter.groups) : undefined,
            this.characterQueryPredicate(filter)
        );
        const movement = controller.computedMovement();
        const collisions: PhysicsCharacterCollision<'2d'>[] = [];
        for (let index = 0; index < controller.numComputedCollisions(); index += 1) {
            const collision = controller.computedCollision(index);
            if (!collision) continue;
            collisions.push({
                colliderHandle: collision.collider?.handle ?? null,
                translationApplied: {
                    x: collision.translationDeltaApplied.x,
                    y: collision.translationDeltaApplied.y
                },
                translationRemaining: {
                    x: collision.translationDeltaRemaining.x,
                    y: collision.translationDeltaRemaining.y
                },
                timeOfImpact: collision.toi,
                witness1: { x: collision.witness1.x, y: collision.witness1.y },
                witness2: { x: collision.witness2.x, y: collision.witness2.y },
                normal1: { x: collision.normal1.x, y: collision.normal1.y },
                normal2: { x: collision.normal2.x, y: collision.normal2.y }
            });
        }
        return {
            translation: { x: movement.x, y: movement.y },
            grounded: controller.computedGrounded(),
            collisions
        };
    }

    castRay(
        origin: PhysicsVector2,
        direction: PhysicsVector2,
        maxDistance: number,
        solid: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsRaycastHit2D | null {
        const directionLength = Math.hypot(direction.x, direction.y);
        const normalized = { x: direction.x / directionLength, y: direction.y / directionLength };
        const ray = new RAPIER.Ray(vector(origin), normalized);
        const hit = this.world.castRayAndGetNormal(
            ray,
            maxDistance,
            solid,
            queryFlags(filter),
            filter?.groups ? interactionGroups(filter.groups) : undefined,
            filter?.excludeCollider === undefined
                ? undefined
                : (this.world.colliders.get(filter.excludeCollider) ?? undefined),
            filter?.excludeRigidBody === undefined
                ? undefined
                : (this.world.bodies.get(filter.excludeRigidBody) ?? undefined),
            filter?.predicate === undefined
                ? undefined
                : collider => filter.predicate?.(collider.handle) ?? true
        );
        if (!hit) return null;
        const point = ray.pointAt(hit.timeOfImpact);
        return {
            colliderHandle: hit.collider.handle,
            point: { x: point.x, y: point.y },
            normal: { x: hit.normal.x, y: hit.normal.y },
            distance: hit.timeOfImpact
        };
    }

    castShape(
        value: PhysicsPose2D,
        velocity: PhysicsVector2,
        shape: PhysicsShape2D,
        targetDistance: number,
        maxTimeOfImpact: number,
        stopAtPenetration: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsShapeCastHit2D | null {
        const hit = this.world.castShape(
            vector(value.position),
            requireFinite(value.rotation, 'Shape-cast rotation'),
            vector(velocity),
            createColliderDescriptor({ shape }).shape,
            requireNonNegative(targetDistance, 'Shape-cast target distance'),
            requirePositive(maxTimeOfImpact, 'Shape-cast maximum time of impact'),
            stopAtPenetration,
            queryFlags(filter),
            filter?.groups ? interactionGroups(filter.groups) : undefined,
            filter?.excludeCollider === undefined
                ? undefined
                : (this.world.colliders.get(filter.excludeCollider) ?? undefined),
            filter?.excludeRigidBody === undefined
                ? undefined
                : (this.world.bodies.get(filter.excludeRigidBody) ?? undefined),
            filter?.predicate === undefined
                ? undefined
                : collider => filter.predicate?.(collider.handle) ?? true
        );
        if (!hit) return null;
        return {
            colliderHandle: hit.collider.handle,
            timeOfImpact: hit.time_of_impact,
            witness1: { x: hit.witness1.x, y: hit.witness1.y },
            witness2: { x: hit.witness2.x, y: hit.witness2.y },
            normal1: { x: hit.normal1.x, y: hit.normal1.y },
            normal2: { x: hit.normal2.x, y: hit.normal2.y }
        };
    }

    intersectionsWithShape(
        value: PhysicsPose2D,
        shape: PhysicsShape2D,
        maxResults: number,
        filter?: PhysicsQueryFilter
    ): readonly number[] {
        const limit = requireIntegerInRange(maxResults, 1, 0xffffffff, 'Shape query maxResults');
        const handles: number[] = [];
        this.world.intersectionsWithShape(
            vector(value.position),
            requireFinite(value.rotation, 'Shape-query rotation'),
            createColliderDescriptor({ shape }).shape,
            collider => {
                handles.push(collider.handle);
                return handles.length < limit;
            },
            queryFlags(filter),
            filter?.groups ? interactionGroups(filter.groups) : undefined,
            filter?.excludeCollider === undefined
                ? undefined
                : (this.world.colliders.get(filter.excludeCollider) ?? undefined),
            filter?.excludeRigidBody === undefined
                ? undefined
                : (this.world.bodies.get(filter.excludeRigidBody) ?? undefined),
            filter?.predicate === undefined
                ? undefined
                : collider => filter.predicate?.(collider.handle) ?? true
        );
        return handles;
    }

    projectPoint(
        point: PhysicsVector2,
        solid: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsPointProjection2D | null {
        const projection = this.world.projectPoint(
            vector(point),
            solid,
            queryFlags(filter),
            filter?.groups ? interactionGroups(filter.groups) : undefined,
            filter?.excludeCollider === undefined
                ? undefined
                : (this.world.colliders.get(filter.excludeCollider) ?? undefined),
            filter?.excludeRigidBody === undefined
                ? undefined
                : (this.world.bodies.get(filter.excludeRigidBody) ?? undefined),
            filter?.predicate === undefined
                ? undefined
                : collider => filter.predicate?.(collider.handle) ?? true
        );
        if (!projection) return null;
        return {
            colliderHandle: projection.collider.handle,
            point: { x: projection.point.x, y: projection.point.y },
            inside: projection.isInside
        };
    }

    drainEvents(visitor: (event: PhysicsBackendEvent<'2d'>) => void): void {
        this.eventQueue.drainCollisionEvents((collider1, collider2, started) => {
            visitor({ type: 'collision', collider1, collider2, started });
        });
        this.eventQueue.drainContactForceEvents(event => {
            const totalForce = event.totalForce();
            const direction = event.maxForceDirection();
            visitor({
                type: 'contact-force',
                collider1: event.collider1(),
                collider2: event.collider2(),
                totalForce: { x: totalForce.x, y: totalForce.y },
                totalForceMagnitude: event.totalForceMagnitude(),
                maxForceDirection: { x: direction.x, y: direction.y },
                maxForceMagnitude: event.maxForceMagnitude()
            });
        });
    }

    takeSnapshot(): Uint8Array {
        this.requireAlive();
        return this.world.takeSnapshot();
    }

    restoreSnapshot(snapshot: Uint8Array): void {
        this.requireAlive();
        const replacement = RAPIER.World.restoreSnapshot(snapshot);
        this.clearCharacterControllers();
        this.world.free();
        this.world = replacement;
        this.eventQueue.clear();
    }

    rigidBodyHandles(): readonly number[] {
        const handles: number[] = [];
        this.world.bodies.forEach(body => handles.push(body.handle));
        return handles.sort((left, right) => left - right);
    }

    colliderHandles(): readonly number[] {
        const handles: number[] = [];
        this.world.colliders.forEach(collider => handles.push(collider.handle));
        return handles.sort((left, right) => left - right);
    }

    jointHandles(): readonly number[] {
        return this.world.impulseJoints
            .getAll()
            .map(joint => joint.handle)
            .sort((left, right) => left - right);
    }

    debugRender(): PhysicsDebugGeometry {
        const buffers = this.world.debugRender();
        return { vertices: buffers.vertices.slice(), colors: buffers.colors.slice() };
    }

    getExtension<T>(extension: PhysicsBackendExtension<T>): T | null {
        if (extension.name !== RAPIER_2D_NATIVE_EXTENSION.name) return null;
        return { module: RAPIER, world: this.world } as T;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.clearCharacterControllers();
        this.eventQueue.free();
        this.world.free();
    }

    private body(handle: number): RAPIER.RigidBody {
        this.requireAlive();
        const body = this.world.bodies.get(handle);
        if (!body) throw new Error(`Rapier 2D rigid body ${String(handle)} is invalid.`);
        return body;
    }

    private collider(handle: number): RAPIER.Collider {
        this.requireAlive();
        const collider = this.world.colliders.get(handle);
        if (!collider) throw new Error(`Rapier 2D collider ${String(handle)} is invalid.`);
        return collider;
    }

    private joint(handle: number): RAPIER.ImpulseJoint {
        this.requireAlive();
        const joint = this.world.impulseJoints.get(handle);
        if (!joint) throw new Error(`Rapier 2D joint ${String(handle)} is invalid.`);
        return joint;
    }

    private characterController(handle: number): RAPIER.KinematicCharacterController {
        this.requireAlive();
        const controller = this.characterControllers.get(handle);
        if (!controller)
            throw new Error(`Rapier 2D character controller ${String(handle)} is invalid.`);
        return controller;
    }

    private characterQueryPredicate(
        filter?: PhysicsQueryFilter
    ): ((collider: RAPIER.Collider) => boolean) | undefined {
        if (
            filter?.excludeCollider === undefined &&
            filter?.excludeRigidBody === undefined &&
            filter?.predicate === undefined
        ) {
            return undefined;
        }
        return collider => {
            if (collider.handle === filter.excludeCollider) return false;
            if (collider.parent()?.handle === filter.excludeRigidBody) return false;
            return filter.predicate?.(collider.handle) ?? true;
        };
    }

    private clearCharacterControllers(): void {
        for (const controller of this.characterControllers.values()) {
            this.world.removeCharacterController(controller);
        }
        this.characterControllers.clear();
    }

    private requireAlive(): void {
        if (this.destroyed) throw new Error('Rapier 2D world has been destroyed.');
    }
}

/** Rapier 0.20 2D adapter. Importing this module is the opt-in WASM boundary. */
export class Rapier2DBackend implements PhysicsBackend<'2d'> {
    readonly id = 'rapier2d-compat-0.20';
    readonly dimension = '2d' as const;

    async createWorld(
        options: PhysicsBackendWorldOptions<'2d'>
    ): Promise<PhysicsBackendWorld<'2d'>> {
        await initializeRapier();
        return new Rapier2DWorld(options);
    }
}
