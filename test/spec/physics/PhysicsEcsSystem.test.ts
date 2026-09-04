import { describe, expect, it } from 'vitest';
import {
    AttachedBody,
    Collider,
    PHYSICS_RUNTIME_3D,
    RigidBody,
    createPhysicsSystem
} from '../../../addon-physics/src/index';
import World from '../../../src/ecs/World';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import { MeshRenderer } from '../../../src/scene/components/Rendering';
import { InterpolatedTransform, LocalTransform } from '../../../src/scene/components/Transform';
import {
    createRenderExtractionSystem,
    RENDER_WORLD
} from '../../../src/scene/systems/RenderExtractionSystem';
import { createTransformSystem } from '../../../src/scene/systems/TransformSystem';
import { FakePhysics3DBackend } from './FakePhysics3DBackend';

function physicsSystem(fractionalHandles = false) {
    return createPhysicsSystem({
        id: 'test/fake-physics-system',
        world: {
            backend: new FakePhysics3DBackend(fractionalHandles),
            gravity: { x: 0, y: -9.81, z: 0 },
            fixedTimeStep: 0.01,
            maxSubSteps: 4
        }
    });
}

describe('ECS physics integration', () => {
    it('owns body/collider handles on the same Entity and installs interpolation history', async () => {
        const world = await World.create({
            fixedDeltaMilliseconds: 10,
            systems: [physicsSystem(), createTransformSystem()]
        });
        const entity = world.createEntity();
        world.add(entity, LocalTransform, { position: [0, 3, 0] });
        world.add(entity, RigidBody, { type: 'dynamic', dimension: '3d', interpolate: true });
        world.add(entity, Collider, {
            dimension: '3d',
            shape: { type: 'ball', radius: 0.5 }
        });
        for (let index = 0; index < 64; index++) {
            const fixed = world.createEntity();
            world.add(fixed, LocalTransform, { position: [index, 0, 0] });
            world.add(fixed, RigidBody, { type: 'fixed', dimension: '3d' });
        }

        world.update(10);

        const runtime = world.getResource(PHYSICS_RUNTIME_3D);
        const entityIndex = world.entityIndex(entity);
        expect(runtime.bodyHandle(entityIndex)).not.toBeNull();
        expect(runtime.colliderHandle(entityIndex)).not.toBeNull();
        expect(world.has(entity, InterpolatedTransform)).toBe(true);
        expect(runtime.getDiagnostics().bodyCount).toBe(65);
        expect(runtime.getDiagnostics().dependentColliderVisitCount).toBeLessThanOrEqual(1);

        world.set(entity, RigidBody, {
            type: 'dynamic',
            dimension: '3d',
            interpolate: true,
            linearDamping: 0.25
        });
        world.update(10);
        expect(runtime.getDiagnostics().structuralSyncCount).toBe(1);
        expect(runtime.getDiagnostics().dependentColliderVisitCount).toBeLessThanOrEqual(1);
        world.destroy();
    });

    it('restores snapshots and preserves compound-collider Entity associations', async () => {
        const world = await World.create({
            fixedDeltaMilliseconds: 10,
            systems: [physicsSystem(), createTransformSystem()]
        });
        const body = world.createEntity();
        const compound = world.createEntity();
        world.add(body, LocalTransform, {});
        world.add(body, RigidBody, { type: 'fixed', dimension: '3d' });
        world.add(compound, Collider, {
            dimension: '3d',
            shape: { type: 'cuboid', halfExtents: { x: 1, y: 1, z: 1 } }
        });
        world.add(compound, AttachedBody, { body });
        world.update(10);
        const runtime = world.getResource(PHYSICS_RUNTIME_3D);
        const bodyIndex = world.entityIndex(body);
        const colliderIndex = world.entityIndex(compound);
        const bodyHandle = runtime.bodyHandle(bodyIndex);
        const colliderHandle = runtime.colliderHandle(colliderIndex);
        const snapshot = runtime.takeSnapshot();

        runtime.restoreSnapshot(snapshot);

        expect(runtime.bodyHandle(bodyIndex)).toBe(bodyHandle);
        expect(runtime.colliderHandle(colliderIndex)).toBe(colliderHandle);
        expect(runtime.physicsWorld.getCollider(colliderHandle ?? -1)?.valid).toBe(true);
        expect(() => {
            runtime.restoreSnapshot({
                ...snapshot,
                bodyHandles: new Float64Array([0xffff_ffff])
            });
        }).toThrow(/stale native handle/u);
        world.destroy();
    });

    it('preserves fractional generational handles without 32-bit truncation', async () => {
        const world = await World.create({
            fixedDeltaMilliseconds: 10,
            systems: [physicsSystem(true), createTransformSystem()]
        });
        const first = world.createEntity(LocalTransform);
        const second = world.createEntity(LocalTransform);
        world.add(first, RigidBody, { type: 'fixed', dimension: '3d' });
        world.add(second, RigidBody, { type: 'dynamic', dimension: '3d' });
        world.update(10);

        const runtime = world.getResource(PHYSICS_RUNTIME_3D);
        const firstHandle = runtime.bodyHandle(world.entityIndex(first));
        const secondHandle = runtime.bodyHandle(world.entityIndex(second));
        expect(firstHandle).toBe(Number.MIN_VALUE);
        expect(secondHandle).toBe(Number.MIN_VALUE * 2);
        expect(secondHandle).not.toBe(firstHandle);

        const snapshot = runtime.takeSnapshot();
        runtime.restoreSnapshot(snapshot);
        expect(runtime.bodyHandle(world.entityIndex(first))).toBe(firstHandle);
        expect(runtime.bodyHandle(world.entityIndex(second))).toBe(secondHandle);
        world.destroy();
    });

    it('synchronizes a 10k composed scene without scanning unrelated colliders per body', async () => {
        const entityCount = 10_000;
        const world = await World.create({
            initialCapacity: entityCount,
            fixedDeltaMilliseconds: 10,
            systems: [physicsSystem(), createTransformSystem(), createRenderExtractionSystem()]
        });
        const geometry = new BoxGeometry();
        const material = new BasicMaterial();
        for (let index = 0; index < entityCount; index++) {
            const entity = world.createEntity();
            world.add(entity, LocalTransform, { position: [index, 0, 0] });
            world.add(entity, MeshRenderer, { geometry, material });
            world.add(entity, RigidBody, { type: 'fixed', dimension: '3d' });
            world.add(entity, Collider, {
                dimension: '3d',
                shape: { type: 'ball', radius: 0.5 }
            });
        }

        world.update(10);

        expect(world.getResource(PHYSICS_RUNTIME_3D).getDiagnostics()).toMatchObject({
            bodyCount: entityCount,
            colliderCount: entityCount,
            structuralSyncCount: entityCount,
            dependentColliderVisitCount: 0
        });
        expect(world.getResource(RENDER_WORLD).getDiagnostics()).toMatchObject({
            renderObjectCount: entityCount,
            structuralUpdateCount: entityCount
        });
        world.destroy();
    });
});
