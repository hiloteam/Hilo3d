import type {
    PhysicsBackend,
    PhysicsBackendExtension,
    PhysicsBackendWorld,
    PhysicsBackendWorldOptions
} from '../../../addon-physics/src/PhysicsBackend';
import type {
    PhysicsCharacterControllerOptions,
    PhysicsCharacterMovement,
    PhysicsColliderDescriptor,
    PhysicsDebugGeometry,
    PhysicsJointDescriptor,
    PhysicsPointProjection,
    PhysicsPose,
    PhysicsQueryFilter,
    PhysicsRaycastHit,
    PhysicsRigidBodyDescriptor,
    PhysicsRigidBodyType,
    PhysicsShape,
    PhysicsShapeCastHit,
    PhysicsVector3
} from '../../../addon-physics/src/types';

interface BodyRecord {
    readonly type: PhysicsRigidBodyType;
    pose: PhysicsPose<'3d'>;
    velocity: PhysicsVector3;
    angularVelocity: PhysicsVector3;
    sleeping: boolean;
}

interface SnapshotData {
    readonly nextHandle: number;
    readonly bodies: readonly (readonly [number, BodyRecord])[];
    readonly colliders: readonly (readonly [number, number | null])[];
}

function zero(): PhysicsVector3 {
    return { x: 0, y: 0, z: 0 };
}

function clonePose3D(pose: PhysicsPose<'3d'>): PhysicsPose<'3d'> {
    return {
        position: { ...pose.position },
        rotation: { ...pose.rotation }
    };
}

function createWorld(options: PhysicsBackendWorldOptions<'3d'>): PhysicsBackendWorld<'3d'> {
    let gravity = { ...options.gravity };
    let nextHandle = 1;
    const bodies = new Map<number, BodyRecord>();
    const colliders = new Map<number, number | null>();
    const joints = new Set<number>();
    const controllers = new Set<number>();
    const body = (handle: number): BodyRecord => {
        const value = bodies.get(handle);
        if (!value) throw new ReferenceError(`Missing fake body ${String(handle)}.`);
        return value;
    };
    const world: PhysicsBackendWorld<'3d'> = {
        id: 'test/fake-physics-3d',
        dimension: '3d',
        setGravity(value): void {
            gravity = { ...value };
        },
        step(deltaSeconds): void {
            for (const value of bodies.values()) {
                if (value.type !== 'dynamic' && value.type !== 'kinematic-velocity') continue;
                if (value.type === 'dynamic') {
                    value.velocity = {
                        x: value.velocity.x,
                        y: value.velocity.y + gravity.y * deltaSeconds,
                        z: value.velocity.z
                    };
                }
                value.pose = {
                    position: {
                        x: value.pose.position.x + value.velocity.x * deltaSeconds,
                        y: value.pose.position.y + value.velocity.y * deltaSeconds,
                        z: value.pose.position.z + value.velocity.z * deltaSeconds
                    },
                    rotation: { ...value.pose.rotation }
                };
            }
        },
        createRigidBody(descriptor: PhysicsRigidBodyDescriptor<'3d'>): number {
            const handle = nextHandle++;
            bodies.set(handle, {
                type: descriptor.type ?? 'dynamic',
                pose: {
                    position: { ...(descriptor.position ?? zero()) },
                    rotation: { ...(descriptor.rotation ?? { x: 0, y: 0, z: 0, w: 1 }) }
                },
                velocity: { ...(descriptor.linearVelocity ?? zero()) },
                angularVelocity: { ...(descriptor.angularVelocity ?? zero()) },
                sleeping: descriptor.sleeping ?? false
            });
            return handle;
        },
        removeRigidBody(handle): void {
            bodies.delete(handle);
            for (const [colliderHandle, parent] of colliders) {
                if (parent === handle) colliders.delete(colliderHandle);
            }
        },
        hasRigidBody: handle => bodies.has(handle),
        rigidBodyType: handle => body(handle).type,
        bodyPose: handle => clonePose3D(body(handle).pose),
        setBodyPose(handle, pose): void {
            body(handle).pose = clonePose3D(pose);
        },
        setNextKinematicPose(handle, pose): void {
            body(handle).pose = clonePose3D(pose);
        },
        bodyLinearVelocity: handle => ({ ...body(handle).velocity }),
        setBodyLinearVelocity(handle, velocity): void {
            body(handle).velocity = { ...velocity };
        },
        bodyAngularVelocity: handle => ({ ...body(handle).angularVelocity }),
        setBodyAngularVelocity(handle, velocity): void {
            body(handle).angularVelocity = { ...velocity };
        },
        applyForce(handle, force): void {
            const value = body(handle).velocity;
            body(handle).velocity = {
                x: value.x + force.x,
                y: value.y + force.y,
                z: value.z + force.z
            };
        },
        applyImpulse(handle, impulse): void {
            const value = body(handle).velocity;
            body(handle).velocity = {
                x: value.x + impulse.x,
                y: value.y + impulse.y,
                z: value.z + impulse.z
            };
        },
        applyTorque(handle, torque): void {
            body(handle).angularVelocity = { ...torque };
        },
        applyTorqueImpulse(handle, torque): void {
            body(handle).angularVelocity = { ...torque };
        },
        sleepRigidBody(handle): void {
            body(handle).sleeping = true;
        },
        wakeRigidBody(handle): void {
            body(handle).sleeping = false;
        },
        isRigidBodySleeping: handle => body(handle).sleeping,
        createCollider(
            _descriptor: PhysicsColliderDescriptor<'3d'>,
            parentHandle?: number
        ): number {
            const handle = nextHandle++;
            colliders.set(handle, parentHandle ?? null);
            return handle;
        },
        removeCollider: handle => {
            colliders.delete(handle);
        },
        hasCollider: handle => colliders.has(handle),
        colliderParent: handle => colliders.get(handle) ?? undefined,
        createJoint(
            _descriptor: PhysicsJointDescriptor<'3d'>,
            _body1: number,
            _body2: number,
            _wakeUp: boolean
        ): number {
            const handle = nextHandle++;
            joints.add(handle);
            return handle;
        },
        removeJoint: handle => {
            joints.delete(handle);
        },
        hasJoint: handle => joints.has(handle),
        setJointLimits(): void {
            return;
        },
        configureJointMotor(): void {
            return;
        },
        createCharacterController(_options: PhysicsCharacterControllerOptions<'3d'>): number {
            const handle = nextHandle++;
            controllers.add(handle);
            return handle;
        },
        removeCharacterController: handle => {
            controllers.delete(handle);
        },
        hasCharacterController: handle => controllers.has(handle),
        computeCharacterMovement(
            _controllerHandle: number,
            _colliderHandle: number,
            desiredTranslation: PhysicsVector3
        ): PhysicsCharacterMovement<'3d'> {
            return { translation: { ...desiredTranslation }, grounded: false, collisions: [] };
        },
        castRay(
            _origin: PhysicsVector3,
            _direction: PhysicsVector3,
            _maxDistance: number,
            _solid: boolean,
            _filter?: PhysicsQueryFilter
        ): PhysicsRaycastHit<'3d'> | null {
            return null;
        },
        castShape(
            _pose: PhysicsPose<'3d'>,
            _velocity: PhysicsVector3,
            _shape: PhysicsShape<'3d'>,
            _targetDistance: number,
            _maxTimeOfImpact: number,
            _stopAtPenetration: boolean,
            _filter?: PhysicsQueryFilter
        ): PhysicsShapeCastHit<'3d'> | null {
            return null;
        },
        intersectionsWithShape: () => [],
        projectPoint(
            _point: PhysicsVector3,
            _solid: boolean,
            _filter?: PhysicsQueryFilter
        ): PhysicsPointProjection<'3d'> | null {
            return null;
        },
        drainEvents(): void {
            return;
        },
        takeSnapshot(): Uint8Array {
            const data: SnapshotData = {
                nextHandle,
                bodies: [...bodies.entries()],
                colliders: [...colliders.entries()]
            };
            return new TextEncoder().encode(JSON.stringify(data));
        },
        restoreSnapshot(snapshot): void {
            const data = JSON.parse(new TextDecoder().decode(snapshot)) as SnapshotData;
            nextHandle = data.nextHandle;
            bodies.clear();
            colliders.clear();
            for (const [handle, value] of data.bodies) {
                bodies.set(handle, {
                    ...value,
                    pose: clonePose3D(value.pose),
                    velocity: { ...value.velocity },
                    angularVelocity: { ...value.angularVelocity }
                });
            }
            for (const [handle, parent] of data.colliders) colliders.set(handle, parent);
        },
        rigidBodyHandles: () => [...bodies.keys()],
        colliderHandles: () => [...colliders.keys()],
        jointHandles: () => [...joints],
        debugRender(): PhysicsDebugGeometry {
            return { vertices: new Float32Array(), colors: new Float32Array() };
        },
        getExtension<T>(_extension: PhysicsBackendExtension<T>): T | null {
            return null;
        },
        destroy(): void {
            bodies.clear();
            colliders.clear();
            joints.clear();
            controllers.clear();
        }
    };
    return world;
}

/** Deterministic in-memory backend for ECS wiring and lifecycle tests. */
export class FakePhysics3DBackend implements PhysicsBackend<'3d'> {
    readonly id = 'test/fake-physics-3d';
    readonly dimension = '3d' as const;

    createWorld(options: PhysicsBackendWorldOptions<'3d'>): Promise<PhysicsBackendWorld<'3d'>> {
        return Promise.resolve(createWorld(options));
    }
}
