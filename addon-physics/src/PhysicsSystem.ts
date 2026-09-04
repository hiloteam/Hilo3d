import {
    InterpolatedTransform,
    InterpolatedTransformStore,
    ChangedComponentStore,
    LocalTransform,
    WORLD_SYSTEM_API_VERSION,
    defineWorldResource,
    getTransformStore,
    type ComponentStore,
    type Entity,
    type WorldResource,
    type WorldSystem,
    type TransformStore
} from 'hilo3d';
import {
    AttachedBody,
    CharacterController,
    Collider,
    RigidBody,
    type AttachedBodyValue,
    type CharacterControllerValue,
    type ColliderValue,
    type RigidBodyValue
} from './PhysicsComponents.js';
import {
    type PhysicsCharacterController,
    type PhysicsCollider,
    type PhysicsRigidBody,
    PhysicsWorld,
    type PhysicsWorldOptions
} from './PhysicsWorld.js';
import type { PhysicsBackendEvent, PhysicsWorldSnapshot } from './PhysicsBackend.js';
import type {
    PhysicsColliderDescriptor,
    PhysicsDimension,
    PhysicsPose,
    PhysicsRigidBodyDescriptor
} from './types.js';

const ABSENT_HANDLE = -1;

function requireChangedStore<T>(
    store: ComponentStore<T>,
    componentName: string
): ChangedComponentStore<T> {
    if (!isChangedStore(store)) {
        throw new TypeError(`${componentName} requires a change-tracked component store.`);
    }
    return store;
}

function isChangedStore<T>(store: ComponentStore<T>): store is ChangedComponentStore<T> {
    return store instanceof ChangedComponentStore;
}

/** One collision/contact event resolved back to ECS Entity identities. */
export interface PhysicsEntityEvent<D extends PhysicsDimension> {
    readonly event: PhysicsBackendEvent<D>;
    readonly collider1: Entity;
    readonly collider2: Entity;
}

/** Stable snapshot including backend bytes and Entity/native-handle association. */
export interface PhysicsEcsSnapshot {
    /** Backend-owned simulation snapshot. */
    readonly backend: PhysicsWorldSnapshot;
    /** Entity indices associated with `bodyHandles`. */
    readonly bodyEntities: Uint32Array;
    /** Opaque body handles preserved as full JavaScript numbers. */
    readonly bodyHandles: Float64Array;
    /** Entity indices associated with `colliderHandles`. */
    readonly colliderEntities: Uint32Array;
    /** Opaque collider handles preserved as full JavaScript numbers. */
    readonly colliderHandles: Float64Array;
}

/** Allocation-free counters for the most recent fixed-step synchronization. */
export interface PhysicsRuntimeDiagnostics {
    /** Live native rigid bodies associated with World Entities. */
    readonly bodyCount: number;
    /** Live native colliders associated with World Entities. */
    readonly colliderCount: number;
    /** Explicitly dirty Entities synchronized during the latest fixed step. */
    readonly structuralSyncCount: number;
    /** Attached colliders visited because their body changed. */
    readonly dependentColliderVisitCount: number;
    /** Dynamic or velocity-kinematic poses written to Transform in the latest fixed step. */
    readonly poseWriteCount: number;
}

/** Addon-owned runtime resource exposed to gameplay Systems. */
export class PhysicsRuntime<D extends PhysicsDimension> {
    readonly events: PhysicsEntityEvent<D>[] = [];
    private bodyHandlesByEntity: Float64Array;
    private colliderHandlesByEntity: Float64Array;
    private restoreHandler: (() => void) | null = null;
    private presentBodyCount = 0;
    private presentColliderCount = 0;
    private structuralSyncCount = 0;
    private dependentColliderVisitCount = 0;
    private poseWriteCount = 0;

    constructor(
        readonly physicsWorld: PhysicsWorld<D>,
        entityCapacity: number
    ) {
        this.bodyHandlesByEntity = new Float64Array(entityCapacity);
        this.colliderHandlesByEntity = new Float64Array(entityCapacity);
        this.bodyHandlesByEntity.fill(ABSENT_HANDLE);
        this.colliderHandlesByEntity.fill(ABSENT_HANDLE);
    }

    /** Resolve an Entity index to its current backend rigid-body handle. */
    bodyHandle(entityIndex: number): number | null {
        const handle = this.bodyHandlesByEntity[entityIndex] ?? ABSENT_HANDLE;
        return handle === ABSENT_HANDLE ? null : handle;
    }

    /** Resolve an Entity index to its current backend collider handle. */
    colliderHandle(entityIndex: number): number | null {
        const handle = this.colliderHandlesByEntity[entityIndex] ?? ABSENT_HANDLE;
        return handle === ABSENT_HANDLE ? null : handle;
    }

    /** Return counters for the latest fixed-step synchronization. */
    getDiagnostics(): PhysicsRuntimeDiagnostics {
        return {
            bodyCount: this.presentBodyCount,
            colliderCount: this.presentColliderCount,
            structuralSyncCount: this.structuralSyncCount,
            dependentColliderVisitCount: this.dependentColliderVisitCount,
            poseWriteCount: this.poseWriteCount
        };
    }

    /** Capture backend state together with stable World-local associations. */
    takeSnapshot(): PhysicsEcsSnapshot {
        const bodyCount = this.countPresent(this.bodyHandlesByEntity);
        const colliderCount = this.countPresent(this.colliderHandlesByEntity);
        const bodyEntities = new Uint32Array(bodyCount);
        const bodyHandles = new Float64Array(bodyCount);
        const colliderEntities = new Uint32Array(colliderCount);
        const colliderHandles = new Float64Array(colliderCount);
        this.copyPresent(this.bodyHandlesByEntity, bodyEntities, bodyHandles);
        this.copyPresent(this.colliderHandlesByEntity, colliderEntities, colliderHandles);
        return {
            backend: this.physicsWorld.takeSnapshot(),
            bodyEntities,
            bodyHandles,
            colliderEntities,
            colliderHandles
        };
    }

    /** Restore backend bytes and reject stale or mismatched native associations. */
    restoreSnapshot(snapshot: PhysicsEcsSnapshot): void {
        this.physicsWorld.restoreSnapshot(snapshot.backend);
        this.bodyHandlesByEntity.fill(ABSENT_HANDLE);
        this.colliderHandlesByEntity.fill(ABSENT_HANDLE);
        this.presentBodyCount = 0;
        this.presentColliderCount = 0;
        this.restoreHandles(snapshot.bodyEntities, snapshot.bodyHandles, true);
        this.restoreHandles(snapshot.colliderEntities, snapshot.colliderHandles, false);
        this.events.length = 0;
        this.restoreHandler?.();
    }

    /** @internal */
    setBodyHandle(entityIndex: number, handle: number | null): void {
        this.ensureEntityCapacity(entityIndex + 1);
        const present = (this.bodyHandlesByEntity[entityIndex] ?? ABSENT_HANDLE) !== ABSENT_HANDLE;
        if (!present && handle !== null) this.presentBodyCount++;
        else if (present && handle === null) this.presentBodyCount--;
        this.bodyHandlesByEntity[entityIndex] = handle ?? ABSENT_HANDLE;
    }

    /** @internal */
    setColliderHandle(entityIndex: number, handle: number | null): void {
        this.ensureEntityCapacity(entityIndex + 1);
        const present =
            (this.colliderHandlesByEntity[entityIndex] ?? ABSENT_HANDLE) !== ABSENT_HANDLE;
        if (!present && handle !== null) this.presentColliderCount++;
        else if (present && handle === null) this.presentColliderCount--;
        this.colliderHandlesByEntity[entityIndex] = handle ?? ABSENT_HANDLE;
    }

    /** @internal */
    setStepDiagnostics(
        structuralSyncCount: number,
        dependentColliderVisitCount: number,
        poseWriteCount: number
    ): void {
        this.structuralSyncCount = structuralSyncCount;
        this.dependentColliderVisitCount = dependentColliderVisitCount;
        this.poseWriteCount = poseWriteCount;
    }

    /** @internal Reconnect System-local wrappers after a native snapshot restore. */
    setRestoreHandler(handler: (() => void) | null): void {
        this.restoreHandler = handler;
    }

    /** @internal Grow Entity-indexed native associations only at a structural sync point. */
    ensureEntityCapacity(capacity: number): void {
        if (capacity <= this.bodyHandlesByEntity.length) return;
        const next = Math.max(capacity, this.bodyHandlesByEntity.length * 2, 16);
        const bodyHandles = new Float64Array(next);
        bodyHandles.fill(ABSENT_HANDLE);
        bodyHandles.set(this.bodyHandlesByEntity);
        this.bodyHandlesByEntity = bodyHandles;
        const colliderHandles = new Float64Array(next);
        colliderHandles.fill(ABSENT_HANDLE);
        colliderHandles.set(this.colliderHandlesByEntity);
        this.colliderHandlesByEntity = colliderHandles;
    }

    private countPresent(handles: Float64Array): number {
        let count = 0;
        for (const handle of handles) if (handle !== ABSENT_HANDLE) count++;
        return count;
    }

    private copyPresent(source: Float64Array, entities: Uint32Array, handles: Float64Array): void {
        let output = 0;
        for (let entityIndex = 0; entityIndex < source.length; entityIndex++) {
            const handle = source[entityIndex] ?? ABSENT_HANDLE;
            if (handle === ABSENT_HANDLE) continue;
            entities[output] = entityIndex;
            handles[output] = handle;
            output++;
        }
    }

    private restoreHandles(entities: Uint32Array, handles: Float64Array, body: boolean): void {
        if (entities.length !== handles.length) {
            throw new TypeError('Physics ECS snapshot association arrays have different lengths.');
        }
        for (let index = 0; index < entities.length; index++) {
            const entityIndex = entities[index] ?? 0;
            this.ensureEntityCapacity(entityIndex + 1);
            const handle = handles[index] ?? 0;
            const valid = body
                ? this.physicsWorld.hasRigidBody(handle)
                : this.physicsWorld.hasCollider(handle);
            if (!valid) {
                throw new Error(`Physics snapshot contains stale native handle ${String(handle)}.`);
            }
            if (body) this.bodyHandlesByEntity[entityIndex] = handle;
            else this.colliderHandlesByEntity[entityIndex] = handle;
            if (body) this.presentBodyCount++;
            else this.presentColliderCount++;
        }
    }
}

export const PHYSICS_RUNTIME_2D = defineWorldResource<PhysicsRuntime<'2d'>>(
    '@hilo3d/addon-physics/runtime-2d'
);
export const PHYSICS_RUNTIME_3D = defineWorldResource<PhysicsRuntime<'3d'>>(
    '@hilo3d/addon-physics/runtime-3d'
);

export interface PhysicsSystemOptions<D extends PhysicsDimension> {
    readonly id?: string;
    readonly resource?: WorldResource<PhysicsRuntime<D>>;
    readonly world: PhysicsWorldOptions<D>;
}

function rigidBodyDescriptor<D extends PhysicsDimension>(
    value: RigidBodyValue,
    dimension: D
): PhysicsRigidBodyDescriptor<D> {
    if (value.dimension !== undefined && value.dimension !== dimension) {
        throw new TypeError(`RigidBody dimension ${value.dimension} does not match ${dimension}.`);
    }
    const { dimension: _dimension, interpolate: _interpolate, ...descriptor } = value;
    void _dimension;
    void _interpolate;
    return descriptor as PhysicsRigidBodyDescriptor<D>;
}

function colliderDescriptor<D extends PhysicsDimension>(
    value: ColliderValue,
    dimension: D
): PhysicsColliderDescriptor<D> {
    if (value.dimension !== undefined && value.dimension !== dimension) {
        throw new TypeError(`Collider dimension ${value.dimension} does not match ${dimension}.`);
    }
    const { dimension: _dimension, ...descriptor } = value;
    void _dimension;
    return descriptor as PhysicsColliderDescriptor<D>;
}

interface MutablePhysicsPose2D {
    position: { x: number; y: number };
    rotation: number;
}

interface MutablePhysicsPose3D {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
}

function transformPose<D extends PhysicsDimension>(
    transforms: TransformStore,
    entityIndex: number,
    dimension: D,
    values: Float64Array,
    pose2D: MutablePhysicsPose2D,
    pose3D: MutablePhysicsPose3D
): PhysicsPose<D> {
    transforms.copyLocalPose(entityIndex, values);
    if (dimension === '2d') {
        pose2D.position.x = values[0] ?? 0;
        pose2D.position.y = values[1] ?? 0;
        pose2D.rotation = 2 * Math.atan2(values[5] ?? 0, values[6] ?? 1);
        return pose2D as PhysicsPose<D>;
    }
    pose3D.position.x = values[0] ?? 0;
    pose3D.position.y = values[1] ?? 0;
    pose3D.position.z = values[2] ?? 0;
    pose3D.rotation.x = values[3] ?? 0;
    pose3D.rotation.y = values[4] ?? 0;
    pose3D.rotation.z = values[5] ?? 0;
    pose3D.rotation.w = values[6] ?? 1;
    return pose3D as PhysicsPose<D>;
}

function writePose<D extends PhysicsDimension>(
    transforms: TransformStore,
    entityIndex: number,
    pose: PhysicsPose<D>
): void {
    if (typeof pose.rotation === 'number') {
        transforms.setPosition(entityIndex, pose.position.x, pose.position.y, 0);
        const halfAngle = pose.rotation * 0.5;
        transforms.setRotation(entityIndex, 0, 0, Math.sin(halfAngle), Math.cos(halfAngle));
        return;
    }
    if (!('z' in pose.position)) {
        throw new TypeError('3D physics pose requires a three-dimensional position.');
    }
    transforms.setPosition(entityIndex, pose.position.x, pose.position.y, pose.position.z);
    transforms.setRotation(
        entityIndex,
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w
    );
}

function interpolationValue<D extends PhysicsDimension>(
    pose: PhysicsPose<D>
): Parameters<InterpolatedTransformStore['add']>[1] {
    if (typeof pose.rotation === 'number') {
        const halfAngle = pose.rotation * 0.5;
        const position = [pose.position.x, pose.position.y, 0] as const;
        const rotation = [0, 0, Math.sin(halfAngle), Math.cos(halfAngle)] as const;
        return {
            previousPosition: position,
            previousRotation: rotation,
            currentPosition: position,
            currentRotation: rotation
        };
    }
    if (!('z' in pose.position)) {
        throw new TypeError('3D interpolation requires a three-dimensional position.');
    }
    const position = [pose.position.x, pose.position.y, pose.position.z] as const;
    const rotation = [pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w] as const;
    return {
        previousPosition: position,
        previousRotation: rotation,
        currentPosition: position,
        currentRotation: rotation
    };
}

function writeInterpolationCurrent<D extends PhysicsDimension>(
    store: InterpolatedTransformStore,
    entityIndex: number,
    pose: PhysicsPose<D>
): void {
    if (typeof pose.rotation === 'number') {
        store.setCurrent2D(entityIndex, pose.position.x, pose.position.y, pose.rotation);
        return;
    }
    if (!('z' in pose.position)) {
        throw new TypeError('3D interpolation requires a three-dimensional position.');
    }
    store.setCurrent3D(
        entityIndex,
        pose.position.x,
        pose.position.y,
        pose.position.z,
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w
    );
}

/**
 * Create a fixed-step ECS physics System. Native handles are indexed by Entity; no transform
 * application binding table or scene-object adapter exists.
 */
export function createPhysicsSystem<D extends PhysicsDimension>(
    options: PhysicsSystemOptions<D>
): WorldSystem {
    const dimension = options.world.backend.dimension;
    const resource =
        options.resource ??
        ((dimension === '2d' ? PHYSICS_RUNTIME_2D : PHYSICS_RUNTIME_3D) as WorldResource<
            PhysicsRuntime<D>
        >);
    return {
        descriptor: {
            id: options.id ?? `@hilo3d/addon-physics/${dimension}`,
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase: 'physics',
            provides: [resource],
            access: {
                reads: [RigidBody, Collider, AttachedBody, CharacterController],
                writes: [LocalTransform, InterpolatedTransform]
            }
        },
        async setup(context) {
            const world = context.world;
            const transforms = getTransformStore(world);
            const transformPoseValues = new Float64Array(7);
            const transformPose2D: MutablePhysicsPose2D = {
                position: { x: 0, y: 0 },
                rotation: 0
            };
            const transformPose3D: MutablePhysicsPose3D = {
                position: { x: 0, y: 0, z: 0 },
                rotation: { x: 0, y: 0, z: 0, w: 1 }
            };
            const rigidBodies = requireChangedStore<RigidBodyValue>(
                world.getStore(RigidBody),
                'RigidBody'
            );
            const interpolation = world.getStore(InterpolatedTransform);
            if (!(interpolation instanceof InterpolatedTransformStore)) {
                throw new TypeError('Physics interpolation requires InterpolatedTransformStore.');
            }
            const colliders = requireChangedStore<ColliderValue>(
                world.getStore(Collider),
                'Collider'
            );
            const attachedBodies = requireChangedStore<AttachedBodyValue>(
                world.getStore(AttachedBody),
                'AttachedBody'
            );
            const controllers = requireChangedStore<CharacterControllerValue>(
                world.getStore(CharacterController),
                'CharacterController'
            );
            const bodyQuery = world.query(LocalTransform, RigidBody);
            const colliderQuery = world.query(Collider);
            const controllerQuery = world.query(CharacterController);
            const physicsWorld = await PhysicsWorld.create(options.world);
            const runtime = new PhysicsRuntime(physicsWorld, world.getDiagnostics().entityCapacity);
            context.provide(resource, runtime);
            let bodies = new Array<PhysicsRigidBody<D> | null>(
                world.getDiagnostics().entityCapacity
            ).fill(null);
            let colliderObjects = new Array<PhysicsCollider<D> | null>(
                world.getDiagnostics().entityCapacity
            ).fill(null);
            let controllerObjects = new Array<PhysicsCharacterController<D> | null>(
                world.getDiagnostics().entityCapacity
            ).fill(null);
            let structuralDirty = new Uint8Array(world.getDiagnostics().entityCapacity);
            let structuralEntities = new Uint32Array(world.getDiagnostics().entityCapacity);
            let firstColliderByBody = new Int32Array(world.getDiagnostics().entityCapacity);
            let colliderBodyIndices = new Int32Array(world.getDiagnostics().entityCapacity);
            let previousColliderByBody = new Int32Array(world.getDiagnostics().entityCapacity);
            let nextColliderByBody = new Int32Array(world.getDiagnostics().entityCapacity);
            firstColliderByBody.fill(-1);
            colliderBodyIndices.fill(-1);
            previousColliderByBody.fill(-1);
            nextColliderByBody.fill(-1);
            let structuralCount = 0;
            let dependentColliderVisitCount = 0;
            const colliderEntityByHandle = new Map<number, number>();
            const ensureCapacity = (capacity: number): void => {
                if (capacity <= structuralDirty.length) return;
                const next = Math.max(capacity, structuralDirty.length * 2, 16);
                const dirty = new Uint8Array(next);
                dirty.set(structuralDirty);
                structuralDirty = dirty;
                const entities = new Uint32Array(next);
                entities.set(structuralEntities);
                structuralEntities = entities;
                const previous = bodies.length;
                bodies.length = next;
                bodies.fill(null, previous);
                colliderObjects.length = next;
                colliderObjects.fill(null, previous);
                controllerObjects.length = next;
                controllerObjects.fill(null, previous);
                const nextFirstColliderByBody = new Int32Array(next);
                nextFirstColliderByBody.fill(-1);
                nextFirstColliderByBody.set(firstColliderByBody);
                firstColliderByBody = nextFirstColliderByBody;
                const nextColliderBodyIndices = new Int32Array(next);
                nextColliderBodyIndices.fill(-1);
                nextColliderBodyIndices.set(colliderBodyIndices);
                colliderBodyIndices = nextColliderBodyIndices;
                const nextPreviousColliderByBody = new Int32Array(next);
                nextPreviousColliderByBody.fill(-1);
                nextPreviousColliderByBody.set(previousColliderByBody);
                previousColliderByBody = nextPreviousColliderByBody;
                const nextNextColliderByBody = new Int32Array(next);
                nextNextColliderByBody.fill(-1);
                nextNextColliderByBody.set(nextColliderByBody);
                nextColliderByBody = nextNextColliderByBody;
                runtime.ensureEntityCapacity(next);
            };
            const queue = (entityIndex: number): void => {
                ensureCapacity(entityIndex + 1);
                if (structuralDirty[entityIndex] === 1) return;
                structuralDirty[entityIndex] = 1;
                structuralEntities[structuralCount] = entityIndex;
                structuralCount++;
            };
            for (let index = 0; index < bodyQuery.length; index++) {
                queue(bodyQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < colliderQuery.length; index++) {
                queue(colliderQuery.entityIndices[index] ?? 0);
            }
            for (let index = 0; index < controllerQuery.length; index++) {
                queue(controllerQuery.entityIndices[index] ?? 0);
            }
            const unsubscribe = world.subscribeStructureChanges((entityIndex, component) => {
                if (
                    component === null ||
                    component === LocalTransform ||
                    component === RigidBody ||
                    component === Collider ||
                    component === AttachedBody ||
                    component === CharacterController
                ) {
                    queue(entityIndex);
                }
            });
            const unlinkCollider = (entityIndex: number): void => {
                const bodyIndex = colliderBodyIndices[entityIndex] ?? -1;
                if (bodyIndex < 0) return;
                const previous = previousColliderByBody[entityIndex] ?? -1;
                const next = nextColliderByBody[entityIndex] ?? -1;
                if (previous < 0) firstColliderByBody[bodyIndex] = next;
                else nextColliderByBody[previous] = next;
                if (next >= 0) previousColliderByBody[next] = previous;
                colliderBodyIndices[entityIndex] = -1;
                previousColliderByBody[entityIndex] = -1;
                nextColliderByBody[entityIndex] = -1;
            };
            const linkCollider = (entityIndex: number, bodyIndex: number): void => {
                unlinkCollider(entityIndex);
                const first = firstColliderByBody[bodyIndex] ?? -1;
                colliderBodyIndices[entityIndex] = bodyIndex;
                previousColliderByBody[entityIndex] = -1;
                nextColliderByBody[entityIndex] = first;
                if (first >= 0) previousColliderByBody[first] = entityIndex;
                firstColliderByBody[bodyIndex] = entityIndex;
            };
            const removeCollider = (entityIndex: number): void => {
                unlinkCollider(entityIndex);
                const collider = colliderObjects[entityIndex];
                if (collider) colliderEntityByHandle.delete(collider.handle);
                if (collider?.valid) physicsWorld.removeCollider(collider);
                colliderObjects[entityIndex] = null;
                runtime.setColliderHandle(entityIndex, null);
            };
            const removeController = (entityIndex: number): void => {
                const controller = controllerObjects[entityIndex];
                if (controller?.valid) physicsWorld.removeCharacterController(controller);
                controllerObjects[entityIndex] = null;
            };
            const removeBody = (entityIndex: number): void => {
                const body = bodies[entityIndex];
                if (body?.valid) physicsWorld.removeRigidBody(body);
                bodies[entityIndex] = null;
                runtime.setBodyHandle(entityIndex, null);
                let colliderEntity = firstColliderByBody[entityIndex] ?? -1;
                while (colliderEntity >= 0) {
                    const next = nextColliderByBody[colliderEntity] ?? -1;
                    dependentColliderVisitCount++;
                    removeCollider(colliderEntity);
                    queue(colliderEntity);
                    colliderEntity = next;
                }
            };
            const synchronizeBody = (entityIndex: number): void => {
                if (!bodyQuery.has(entityIndex)) {
                    removeBody(entityIndex);
                    if (interpolation.has(entityIndex)) {
                        world.commands.remove(world.entityAt(entityIndex), InterpolatedTransform);
                    }
                    return;
                }
                if (bodies[entityIndex]?.valid) return;
                const value = rigidBodies.get(entityIndex);
                const descriptor = rigidBodyDescriptor(value, dimension);
                const pose = transformPose(
                    transforms,
                    entityIndex,
                    dimension,
                    transformPoseValues,
                    transformPose2D,
                    transformPose3D
                );
                const body = physicsWorld.createRigidBody({ ...descriptor, ...pose });
                bodies[entityIndex] = body;
                runtime.setBodyHandle(entityIndex, body.handle);
                const interpolate =
                    value.interpolate === true &&
                    (body.type === 'dynamic' || body.type === 'kinematic-velocity');
                if (interpolate) {
                    const initial = interpolationValue(pose);
                    if (interpolation.has(entityIndex)) interpolation.set(entityIndex, initial);
                    else {
                        world.commands.add(
                            world.entityAt(entityIndex),
                            InterpolatedTransform,
                            initial
                        );
                    }
                } else if (interpolation.has(entityIndex)) {
                    world.commands.remove(world.entityAt(entityIndex), InterpolatedTransform);
                }
            };
            const synchronizeCollider = (entityIndex: number): void => {
                removeCollider(entityIndex);
                if (!colliderQuery.has(entityIndex)) return;
                let bodyEntity = world.entityAt(entityIndex);
                if (attachedBodies.has(entityIndex))
                    bodyEntity = attachedBodies.get(entityIndex).body;
                if (!world.isAlive(bodyEntity)) {
                    throw new ReferenceError('AttachedBody references a stale Entity.');
                }
                const bodyIndex = world.entityIndex(bodyEntity);
                synchronizeBody(bodyIndex);
                const body = bodies[bodyIndex];
                if (attachedBodies.has(entityIndex) && !body?.valid) {
                    throw new TypeError(
                        'AttachedBody requires its target Entity to have RigidBody.'
                    );
                }
                const descriptor = colliderDescriptor(colliders.get(entityIndex), dimension);
                const collider = physicsWorld.createCollider(descriptor, body ?? undefined);
                colliderObjects[entityIndex] = collider;
                runtime.setColliderHandle(entityIndex, collider.handle);
                colliderEntityByHandle.set(collider.handle, entityIndex);
                if (body?.valid) linkCollider(entityIndex, bodyIndex);
            };
            const synchronizeController = (entityIndex: number): void => {
                removeController(entityIndex);
                if (!controllerQuery.has(entityIndex)) return;
                const value = controllers.get(entityIndex);
                if (value.dimension !== dimension) {
                    throw new TypeError(
                        `CharacterController dimension ${value.dimension} does not match ${dimension}.`
                    );
                }
                if (!world.isAlive(value.collider)) {
                    throw new ReferenceError(
                        'CharacterController references a stale Collider Entity.'
                    );
                }
                const colliderIndex = world.entityIndex(value.collider);
                synchronizeCollider(colliderIndex);
                const collider = colliderObjects[colliderIndex];
                if (!collider?.valid) {
                    throw new TypeError('CharacterController requires a live Collider component.');
                }
                controllerObjects[entityIndex] = physicsWorld.createCharacterController(
                    value.options
                );
            };
            const reconnectRestoredObjects = (): void => {
                colliderEntityByHandle.clear();
                firstColliderByBody.fill(-1);
                colliderBodyIndices.fill(-1);
                previousColliderByBody.fill(-1);
                nextColliderByBody.fill(-1);
                for (let entityIndex = 0; entityIndex < bodies.length; entityIndex++) {
                    const bodyHandle = runtime.bodyHandle(entityIndex);
                    bodies[entityIndex] =
                        bodyHandle === null ? null : physicsWorld.getRigidBody(bodyHandle);
                    const body = bodies[entityIndex];
                    if (body?.valid && interpolation.has(entityIndex)) {
                        interpolation.set(entityIndex, interpolationValue(body.pose));
                    }
                    const colliderHandle = runtime.colliderHandle(entityIndex);
                    colliderObjects[entityIndex] =
                        colliderHandle === null ? null : physicsWorld.getCollider(colliderHandle);
                    if (colliderHandle !== null) {
                        colliderEntityByHandle.set(colliderHandle, entityIndex);
                        const attached = attachedBodies.has(entityIndex)
                            ? attachedBodies.get(entityIndex).body
                            : world.entityAt(entityIndex);
                        if (world.isAlive(attached)) {
                            const bodyIndex = world.entityIndex(attached);
                            if (bodies[bodyIndex]?.valid) linkCollider(entityIndex, bodyIndex);
                        }
                    }
                    if (controllerObjects[entityIndex] !== null) {
                        controllerObjects[entityIndex] = null;
                        queue(entityIndex);
                    }
                }
            };
            runtime.setRestoreHandler(reconnectRestoredObjects);
            return {
                execute(execution): void {
                    runtime.events.length = 0;
                    let poseWriteCount = 0;
                    dependentColliderVisitCount = 0;
                    for (let index = 0; index < rigidBodies.changedEntityCount; index++) {
                        queue(rigidBodies.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < colliders.changedEntityCount; index++) {
                        queue(colliders.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < attachedBodies.changedEntityCount; index++) {
                        queue(attachedBodies.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < controllers.changedEntityCount; index++) {
                        queue(controllers.changedEntityIndices[index] ?? 0);
                    }
                    for (let index = 0; index < structuralCount; index++) {
                        const entityIndex = structuralEntities[index] ?? 0;
                        removeCollider(entityIndex);
                        removeController(entityIndex);
                        removeBody(entityIndex);
                        synchronizeBody(entityIndex);
                        synchronizeCollider(entityIndex);
                        synchronizeController(entityIndex);
                    }
                    const synchronizedStructureCount = structuralCount;
                    for (let index = 0; index < structuralCount; index++) {
                        structuralDirty[structuralEntities[index] ?? 0] = 0;
                    }
                    structuralCount = 0;
                    rigidBodies.clearChangedEntities();
                    colliders.clearChangedEntities();
                    attachedBodies.clearChangedEntities();
                    controllers.clearChangedEntities();
                    for (let index = 0; index < bodyQuery.length; index++) {
                        const entityIndex = bodyQuery.entityIndices[index] ?? 0;
                        const body = bodies[entityIndex];
                        if (!body?.valid) continue;
                        if (body.type === 'fixed') {
                            body.setPose(
                                transformPose(
                                    transforms,
                                    entityIndex,
                                    dimension,
                                    transformPoseValues,
                                    transformPose2D,
                                    transformPose3D
                                ),
                                false
                            );
                        } else if (body.type === 'kinematic-position') {
                            body.setNextKinematicPose(
                                transformPose(
                                    transforms,
                                    entityIndex,
                                    dimension,
                                    transformPoseValues,
                                    transformPose2D,
                                    transformPose3D
                                )
                            );
                        }
                        if (
                            interpolation.has(entityIndex) &&
                            (body.type === 'dynamic' || body.type === 'kinematic-velocity')
                        ) {
                            interpolation.capturePrevious(entityIndex);
                        }
                    }
                    physicsWorld.backendWorld.step(execution.deltaTimeMilliseconds / 1000);
                    for (let index = 0; index < bodyQuery.length; index++) {
                        const entityIndex = bodyQuery.entityIndices[index] ?? 0;
                        const body = bodies[entityIndex];
                        if (
                            body?.valid &&
                            (body.type === 'dynamic' || body.type === 'kinematic-velocity')
                        ) {
                            const pose = body.pose;
                            writePose(transforms, entityIndex, pose);
                            poseWriteCount++;
                            if (interpolation.has(entityIndex)) {
                                writeInterpolationCurrent(interpolation, entityIndex, pose);
                            }
                        }
                    }
                    physicsWorld.backendWorld.drainEvents(event => {
                        const first = colliderEntityByHandle.get(event.collider1);
                        const second = colliderEntityByHandle.get(event.collider2);
                        if (first === undefined || second === undefined) return;
                        runtime.events.push({
                            event,
                            collider1: world.entityAt(first),
                            collider2: world.entityAt(second)
                        });
                    });
                    runtime.setStepDiagnostics(
                        synchronizedStructureCount,
                        dependentColliderVisitCount,
                        poseWriteCount
                    );
                },
                destroy(): void {
                    unsubscribe();
                    runtime.setRestoreHandler(null);
                    for (const controller of controllerObjects) {
                        if (controller?.valid) physicsWorld.removeCharacterController(controller);
                    }
                    physicsWorld.destroy();
                    bodies = [];
                    colliderObjects = [];
                    controllerObjects = [];
                }
            };
        }
    };
}
