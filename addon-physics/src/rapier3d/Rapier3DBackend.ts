import RAPIER from '@dimforge/rapier3d-compat';
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
    PhysicsColliderDescriptor3D,
    PhysicsDebugGeometry,
    PhysicsJointDescriptor3D,
    PhysicsPointProjection3D,
    PhysicsPose3D,
    PhysicsQueryFilter,
    PhysicsQuaternion,
    PhysicsRaycastHit3D,
    PhysicsRigidBodyDescriptor3D,
    PhysicsRigidBodyType,
    PhysicsShape3D,
    PhysicsShapeCastHit3D,
    PhysicsVector3
} from '../types.js';

export interface Rapier3DNativeExtension {
    readonly module: typeof RAPIER;
    readonly world: RAPIER.World;
}

export const RAPIER_3D_NATIVE_EXTENSION =
    createPhysicsBackendExtension<Rapier3DNativeExtension>('rapier3d-native');

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

function vector(value: PhysicsVector3): RAPIER.Vector {
    return {
        x: requireFinite(value.x, 'Vector x'),
        y: requireFinite(value.y, 'Vector y'),
        z: requireFinite(value.z, 'Vector z')
    };
}

function unitVector(value: PhysicsVector3, name: string): RAPIER.Vector {
    const result = vector(value);
    const length = Math.hypot(result.x, result.y, result.z);
    if (length <= Number.EPSILON) throw new RangeError(`${name} cannot be zero.`);
    return { x: result.x / length, y: result.y / length, z: result.z / length };
}

function jointLimits(values: readonly [number, number]): [number, number] {
    const min = requireFinite(values[0], 'Joint limit minimum');
    const max = requireFinite(values[1], 'Joint limit maximum');
    if (min > max) throw new RangeError('Joint limits must be ordered min <= max.');
    return [min, max];
}

function quaternion(value: PhysicsQuaternion): RAPIER.Rotation {
    const x = requireFinite(value.x, 'Quaternion x');
    const y = requireFinite(value.y, 'Quaternion y');
    const z = requireFinite(value.z, 'Quaternion z');
    const w = requireFinite(value.w, 'Quaternion w');
    const length = Math.hypot(x, y, z, w);
    if (length <= Number.EPSILON) throw new RangeError('Physics quaternions cannot be zero.');
    return { x: x / length, y: y / length, z: z / length, w: w / length };
}

function pose(position: RAPIER.Vector, rotation: RAPIER.Rotation): PhysicsPose3D {
    return {
        position: { x: position.x, y: position.y, z: position.z },
        rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }
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

function createColliderDescriptor(descriptor: PhysicsColliderDescriptor3D): RAPIER.ColliderDesc {
    const shape = descriptor.shape;
    let result: RAPIER.ColliderDesc | null;
    switch (shape.type) {
        case 'ball':
            result = RAPIER.ColliderDesc.ball(requirePositive(shape.radius, 'Ball radius'));
            break;
        case 'cuboid': {
            const halfExtents = shape.halfExtents;
            const x = requirePositive(halfExtents.x, 'Cuboid half extent x');
            const y = requirePositive(halfExtents.y, 'Cuboid half extent y');
            const z = requirePositive(halfExtents.z, 'Cuboid half extent z');
            result =
                shape.borderRadius === undefined
                    ? RAPIER.ColliderDesc.cuboid(x, y, z)
                    : RAPIER.ColliderDesc.roundCuboid(
                          x,
                          y,
                          z,
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
        case 'cylinder':
            result =
                shape.borderRadius === undefined
                    ? RAPIER.ColliderDesc.cylinder(
                          requirePositive(shape.halfHeight, 'Cylinder half height'),
                          requirePositive(shape.radius, 'Cylinder radius')
                      )
                    : RAPIER.ColliderDesc.roundCylinder(
                          requirePositive(shape.halfHeight, 'Cylinder half height'),
                          requirePositive(shape.radius, 'Cylinder radius'),
                          requirePositive(shape.borderRadius, 'Cylinder border radius')
                      );
            break;
        case 'cone':
            result =
                shape.borderRadius === undefined
                    ? RAPIER.ColliderDesc.cone(
                          requirePositive(shape.halfHeight, 'Cone half height'),
                          requirePositive(shape.radius, 'Cone radius')
                      )
                    : RAPIER.ColliderDesc.roundCone(
                          requirePositive(shape.halfHeight, 'Cone half height'),
                          requirePositive(shape.radius, 'Cone radius'),
                          requirePositive(shape.borderRadius, 'Cone border radius')
                      );
            break;
        case 'trimesh':
            if (
                shape.vertices.length < 9 ||
                shape.vertices.length % 3 !== 0 ||
                shape.indices.length < 3 ||
                shape.indices.length % 3 !== 0
            ) {
                throw new RangeError(
                    '3D triangle meshes require packed xyz vertices and triangles.'
                );
            }
            requireFiniteArray(shape.vertices, 'Triangle-mesh vertex');
            requireIndices(shape.indices, shape.vertices.length / 3, 'Triangle-mesh indices');
            result = RAPIER.ColliderDesc.trimesh(shape.vertices, shape.indices);
            break;
        case 'convex-hull':
            if (shape.points.length < 12 || shape.points.length % 3 !== 0) {
                throw new RangeError('3D convex hulls require packed xyz points.');
            }
            requireFiniteArray(shape.points, 'Convex-hull point');
            result =
                shape.borderRadius === undefined
                    ? RAPIER.ColliderDesc.convexHull(shape.points)
                    : RAPIER.ColliderDesc.roundConvexHull(
                          shape.points,
                          requirePositive(shape.borderRadius, 'Convex hull border radius')
                      );
            if (!result) throw new RangeError('Rapier could not construct the 3D convex hull.');
            break;
        case 'heightfield':
            if (!Number.isSafeInteger(shape.rows) || shape.rows < 2) {
                throw new RangeError('Heightfield rows must be an integer of at least 2.');
            }
            if (!Number.isSafeInteger(shape.columns) || shape.columns < 2) {
                throw new RangeError('Heightfield columns must be an integer of at least 2.');
            }
            if (shape.heights.length !== (shape.rows + 1) * (shape.columns + 1)) {
                throw new RangeError(
                    'Heightfield sample count must equal (rows + 1) * (columns + 1).'
                );
            }
            requireFiniteArray(shape.heights, 'Heightfield sample');
            result = RAPIER.ColliderDesc.heightfield(
                shape.rows,
                shape.columns,
                shape.heights,
                vector(shape.scale)
            );
            break;
    }

    if (descriptor.localPosition) {
        const translation = vector(descriptor.localPosition);
        result.setTranslation(translation.x, translation.y, translation.z);
    }
    if (descriptor.localRotation) result.setRotation(quaternion(descriptor.localRotation));
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

function createJointDescriptor(descriptor: PhysicsJointDescriptor3D): RAPIER.JointData {
    let result: RAPIER.JointData;
    switch (descriptor.type) {
        case 'fixed':
            result = RAPIER.JointData.fixed(
                vector(descriptor.anchor1),
                quaternion(descriptor.rotation1 ?? { x: 0, y: 0, z: 0, w: 1 }),
                vector(descriptor.anchor2),
                quaternion(descriptor.rotation2 ?? { x: 0, y: 0, z: 0, w: 1 })
            );
            break;
        case 'spherical':
            result = RAPIER.JointData.spherical(
                vector(descriptor.anchor1),
                vector(descriptor.anchor2)
            );
            break;
        case 'revolute':
            result = RAPIER.JointData.revolute(
                vector(descriptor.anchor1),
                vector(descriptor.anchor2),
                unitVector(descriptor.axis, 'Revolute joint axis')
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

class Rapier3DWorld implements PhysicsBackendWorld<'3d'> {
    readonly id = 'rapier3d-compat-0.20';
    readonly dimension = '3d' as const;
    private world: RAPIER.World;
    private readonly eventQueue = new RAPIER.EventQueue(true);
    private readonly characterControllers = new Map<number, RAPIER.KinematicCharacterController>();
    private nextCharacterControllerHandle = 1;
    private destroyed = false;

    constructor(options: PhysicsBackendWorldOptions<'3d'>) {
        this.world = new RAPIER.World(vector(options.gravity));
        this.world.lengthUnit = options.lengthUnit;
        this.world.numSolverIterations = options.solverIterations;
        this.world.numInternalPgsIterations = options.internalPgsIterations;
        this.world.maxCcdSubsteps = options.maxCcdSubsteps;
    }

    setGravity(gravity: PhysicsVector3): void {
        this.requireAlive();
        this.world.gravity = vector(gravity);
    }

    step(deltaSeconds: number): void {
        this.requireAlive();
        this.world.timestep = requirePositive(deltaSeconds, 'Physics timestep');
        this.world.step(this.eventQueue);
    }

    createRigidBody(descriptor: PhysicsRigidBodyDescriptor3D): number {
        this.requireAlive();
        const result = bodyDescriptor(descriptor.type ?? 'dynamic');
        if (descriptor.position) {
            const translation = vector(descriptor.position);
            result.setTranslation(translation.x, translation.y, translation.z);
        }
        if (descriptor.rotation) result.setRotation(quaternion(descriptor.rotation));
        if (descriptor.linearVelocity) {
            const velocity = vector(descriptor.linearVelocity);
            result.setLinvel(velocity.x, velocity.y, velocity.z);
        }
        if (descriptor.angularVelocity) result.setAngvel(vector(descriptor.angularVelocity));
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
        if (descriptor.enabledRotations) result.enabledRotations(...descriptor.enabledRotations);
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

    bodyPose(handle: number): PhysicsPose3D {
        const body = this.body(handle);
        return pose(body.translation(), body.rotation());
    }

    setBodyPose(handle: number, value: PhysicsPose3D, wakeUp: boolean): void {
        const body = this.body(handle);
        body.setTranslation(vector(value.position), wakeUp);
        body.setRotation(quaternion(value.rotation), wakeUp);
    }

    setNextKinematicPose(handle: number, value: PhysicsPose3D): void {
        const body = this.body(handle);
        body.setNextKinematicTranslation(vector(value.position));
        body.setNextKinematicRotation(quaternion(value.rotation));
    }

    bodyLinearVelocity(handle: number): PhysicsVector3 {
        const value = this.body(handle).linvel();
        return { x: value.x, y: value.y, z: value.z };
    }

    setBodyLinearVelocity(handle: number, velocity: PhysicsVector3, wakeUp: boolean): void {
        this.body(handle).setLinvel(vector(velocity), wakeUp);
    }

    bodyAngularVelocity(handle: number): PhysicsVector3 {
        const value = this.body(handle).angvel();
        return { x: value.x, y: value.y, z: value.z };
    }

    setBodyAngularVelocity(handle: number, velocity: PhysicsVector3, wakeUp: boolean): void {
        this.body(handle).setAngvel(vector(velocity), wakeUp);
    }

    applyForce(handle: number, force: PhysicsVector3, wakeUp: boolean): void {
        this.body(handle).addForce(vector(force), wakeUp);
    }

    applyImpulse(handle: number, impulse: PhysicsVector3, wakeUp: boolean): void {
        this.body(handle).applyImpulse(vector(impulse), wakeUp);
    }

    applyTorque(handle: number, torque: PhysicsVector3, wakeUp: boolean): void {
        this.body(handle).addTorque(vector(torque), wakeUp);
    }

    applyTorqueImpulse(handle: number, torqueImpulse: PhysicsVector3, wakeUp: boolean): void {
        this.body(handle).applyTorqueImpulse(vector(torqueImpulse), wakeUp);
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

    createCollider(descriptor: PhysicsColliderDescriptor3D, parentHandle?: number): number {
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
        descriptor: PhysicsJointDescriptor3D,
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

    createCharacterController(options: PhysicsCharacterControllerOptions<'3d'>): number {
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
        desiredTranslation: PhysicsVector3,
        filter?: PhysicsQueryFilter
    ): PhysicsCharacterMovement<'3d'> {
        const controller = this.characterController(controllerHandle);
        controller.computeColliderMovement(
            this.collider(colliderHandle),
            vector(desiredTranslation),
            queryFlags(filter),
            filter?.groups ? interactionGroups(filter.groups) : undefined,
            this.characterQueryPredicate(filter)
        );
        const movement = controller.computedMovement();
        const collisions: PhysicsCharacterCollision<'3d'>[] = [];
        for (let index = 0; index < controller.numComputedCollisions(); index += 1) {
            const collision = controller.computedCollision(index);
            if (!collision) continue;
            collisions.push({
                colliderHandle: collision.collider?.handle ?? null,
                translationApplied: {
                    x: collision.translationDeltaApplied.x,
                    y: collision.translationDeltaApplied.y,
                    z: collision.translationDeltaApplied.z
                },
                translationRemaining: {
                    x: collision.translationDeltaRemaining.x,
                    y: collision.translationDeltaRemaining.y,
                    z: collision.translationDeltaRemaining.z
                },
                timeOfImpact: collision.toi,
                witness1: {
                    x: collision.witness1.x,
                    y: collision.witness1.y,
                    z: collision.witness1.z
                },
                witness2: {
                    x: collision.witness2.x,
                    y: collision.witness2.y,
                    z: collision.witness2.z
                },
                normal1: {
                    x: collision.normal1.x,
                    y: collision.normal1.y,
                    z: collision.normal1.z
                },
                normal2: {
                    x: collision.normal2.x,
                    y: collision.normal2.y,
                    z: collision.normal2.z
                }
            });
        }
        return {
            translation: { x: movement.x, y: movement.y, z: movement.z },
            grounded: controller.computedGrounded(),
            collisions
        };
    }

    castRay(
        origin: PhysicsVector3,
        direction: PhysicsVector3,
        maxDistance: number,
        solid: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsRaycastHit3D | null {
        const directionLength = Math.hypot(direction.x, direction.y, direction.z);
        const normalized = {
            x: direction.x / directionLength,
            y: direction.y / directionLength,
            z: direction.z / directionLength
        };
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
            point: { x: point.x, y: point.y, z: point.z },
            normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
            distance: hit.timeOfImpact
        };
    }

    castShape(
        value: PhysicsPose3D,
        velocity: PhysicsVector3,
        shape: PhysicsShape3D,
        targetDistance: number,
        maxTimeOfImpact: number,
        stopAtPenetration: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsShapeCastHit3D | null {
        const hit = this.world.castShape(
            vector(value.position),
            quaternion(value.rotation),
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
            witness1: { x: hit.witness1.x, y: hit.witness1.y, z: hit.witness1.z },
            witness2: { x: hit.witness2.x, y: hit.witness2.y, z: hit.witness2.z },
            normal1: { x: hit.normal1.x, y: hit.normal1.y, z: hit.normal1.z },
            normal2: { x: hit.normal2.x, y: hit.normal2.y, z: hit.normal2.z }
        };
    }

    intersectionsWithShape(
        value: PhysicsPose3D,
        shape: PhysicsShape3D,
        maxResults: number,
        filter?: PhysicsQueryFilter
    ): readonly number[] {
        const limit = requireIntegerInRange(maxResults, 1, 0xffffffff, 'Shape query maxResults');
        const handles: number[] = [];
        this.world.intersectionsWithShape(
            vector(value.position),
            quaternion(value.rotation),
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
        point: PhysicsVector3,
        solid: boolean,
        filter?: PhysicsQueryFilter
    ): PhysicsPointProjection3D | null {
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
            point: {
                x: projection.point.x,
                y: projection.point.y,
                z: projection.point.z
            },
            inside: projection.isInside
        };
    }

    drainEvents(visitor: (event: PhysicsBackendEvent<'3d'>) => void): void {
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
                totalForce: { x: totalForce.x, y: totalForce.y, z: totalForce.z },
                totalForceMagnitude: event.totalForceMagnitude(),
                maxForceDirection: { x: direction.x, y: direction.y, z: direction.z },
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
        if (extension.name !== RAPIER_3D_NATIVE_EXTENSION.name) return null;
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
        if (!body) throw new Error(`Rapier 3D rigid body ${String(handle)} is invalid.`);
        return body;
    }

    private collider(handle: number): RAPIER.Collider {
        this.requireAlive();
        const collider = this.world.colliders.get(handle);
        if (!collider) throw new Error(`Rapier 3D collider ${String(handle)} is invalid.`);
        return collider;
    }

    private joint(handle: number): RAPIER.ImpulseJoint {
        this.requireAlive();
        const joint = this.world.impulseJoints.get(handle);
        if (!joint) throw new Error(`Rapier 3D joint ${String(handle)} is invalid.`);
        return joint;
    }

    private characterController(handle: number): RAPIER.KinematicCharacterController {
        this.requireAlive();
        const controller = this.characterControllers.get(handle);
        if (!controller)
            throw new Error(`Rapier 3D character controller ${String(handle)} is invalid.`);
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
        if (this.destroyed) throw new Error('Rapier 3D world has been destroyed.');
    }
}

/** Rapier 0.20 3D adapter. Importing this module is the opt-in WASM boundary. */
export class Rapier3DBackend implements PhysicsBackend<'3d'> {
    readonly id = 'rapier3d-compat-0.20';
    readonly dimension = '3d' as const;

    async createWorld(
        options: PhysicsBackendWorldOptions<'3d'>
    ): Promise<PhysicsBackendWorld<'3d'>> {
        await initializeRapier();
        return new Rapier3DWorld(options);
    }
}
