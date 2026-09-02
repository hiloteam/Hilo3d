import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../src/ecs/Entity';
import World from '../../../src/ecs/World';
import {
    getHierarchyStore,
    getTransformStore,
    Hierarchy,
    InterpolatedTransform,
    LocalTransform,
    WorldTransform
} from '../../../src/scene/components/Transform';
import { createTransformSystem } from '../../../src/scene/systems/TransformSystem';

function translation(matrix: Float32Array): readonly number[] {
    return [matrix[12] ?? 0, matrix[13] ?? 0, matrix[14] ?? 0];
}

describe('ECS Transform and hierarchy', () => {
    it('composes parent-first matrices and exposes WorldTransform as read-only derived data', async () => {
        const world = await World.create({ systems: [createTransformSystem()] });
        const root = world.createEntity();
        const child = world.createEntity();
        world.add(root, LocalTransform, { position: [2, 3, 4] });
        world.add(root, Hierarchy, { parent: null });
        world.add(child, LocalTransform, { position: [5, 0, 0] });
        world.add(child, Hierarchy, { parent: root });

        world.update(0);

        expect(translation(world.get(root, WorldTransform).matrix)).toEqual([2, 3, 4]);
        expect(translation(world.get(child, WorldTransform).matrix)).toEqual([7, 3, 4]);
        expect(() => {
            world.add(child, WorldTransform, {
                matrix: new Float32Array(16),
                previousMatrix: new Float32Array(16),
                revision: 0,
                historyValid: false
            });
        }).toThrow(/read-only/u);
        world.destroy();
    });

    it('validates a reparent batch before mutation and rejects cycles', async () => {
        const world = await World.create({ systems: [createTransformSystem()] });
        const root = world.createEntity();
        const child = world.createEntity();
        world.add(root, LocalTransform, {});
        world.add(root, Hierarchy, { parent: null });
        world.add(child, LocalTransform, {});
        world.add(child, Hierarchy, { parent: root });
        world.update(0);

        world.set(root, Hierarchy, { parent: child });
        world.set(child, Hierarchy, { parent: root });
        expect(() => {
            world.update(0);
        }).toThrow(/cycle/u);
        expect(getTransformStore(world).parentIndexOf(world.entityIndex(root))).toBe(-1);
        expect(getTransformStore(world).parentIndexOf(world.entityIndex(child))).toBe(
            world.entityIndex(root)
        );

        world.set(root, Hierarchy, { parent: null });
        world.set(child, Hierarchy, { parent: root });
        world.update(0);
        world.destroy();
    });

    it('keeps previous matrices transactional across submitted and discarded frames', async () => {
        const world = await World.create({ systems: [createTransformSystem()] });
        const entity = world.createEntity();
        world.add(entity, LocalTransform, { position: [1, 0, 0] });
        world.update(0);
        const transforms = getTransformStore(world);

        expect(world.get(entity, WorldTransform).historyValid).toBe(false);
        transforms.commitWorldHistory();
        expect(world.get(entity, WorldTransform).historyValid).toBe(true);

        transforms.setPosition(world.entityIndex(entity), 9, 0, 0);
        world.update(0);
        let snapshot = world.get(entity, WorldTransform);
        expect(translation(snapshot.matrix)).toEqual([9, 0, 0]);
        expect(translation(snapshot.previousMatrix)).toEqual([1, 0, 0]);

        transforms.discardWorldHistory();
        snapshot = world.get(entity, WorldTransform);
        expect(translation(snapshot.previousMatrix)).toEqual([1, 0, 0]);
        transforms.commitWorldHistory();
        expect(translation(world.get(entity, WorldTransform).previousMatrix)).toEqual([9, 0, 0]);
        world.destroy();
    });

    it('copies camera-relative matrices without changing authoritative world coordinates', async () => {
        const world = await World.create({ systems: [createTransformSystem()] });
        const entity = world.createEntity();
        world.add(entity, LocalTransform, { position: [100_010, -20, 30] });
        world.update(0);
        const transforms = getTransformStore(world);
        const relative = new Float32Array(16);

        transforms.copyWorldMatrix(world.entityIndex(entity), relative, 0, [100_000, -25, 10]);

        expect(translation(relative)).toEqual([10, 5, 20]);
        expect(translation(world.get(entity, WorldTransform).matrix)).toEqual([100_010, -20, 30]);
        world.destroy();
    });

    it('detaches children and repairs authored hierarchy when a parent is destroyed', async () => {
        const world = await World.create({ systems: [createTransformSystem()] });
        const root = world.createEntity();
        const child = world.createEntity();
        world.add(root, LocalTransform, { position: [3, 0, 0] });
        world.add(root, Hierarchy, { parent: null });
        world.add(child, LocalTransform, { position: [2, 0, 0] });
        world.add(child, Hierarchy, { parent: root });
        world.update(0);

        world.destroyEntity(root);
        world.update(0);

        expect(world.get(child, Hierarchy).parent).toBeNull();
        expect(translation(world.get(child, WorldTransform).matrix)).toEqual([2, 0, 0]);
        world.destroy();
    });

    it('updates only a one-percent dirty subset in a wide 100k transform scene', async () => {
        const entityCount = 100_000;
        const dirtyCount = entityCount / 100;
        const world = await World.create({
            initialCapacity: entityCount,
            systems: [createTransformSystem()]
        });
        const entities: Entity[] = [];
        for (let index = 0; index < entityCount; index++) {
            const entity = world.createEntity();
            entities.push(entity);
            world.add(entity, LocalTransform, { position: [index, 0, 0] });
        }
        world.update(0);
        const transforms = getTransformStore(world);
        expect(transforms.getDiagnostics().updatedWorldMatrixCount).toBe(entityCount);

        for (let index = 0; index < dirtyCount; index++) {
            const entity = entities[index];
            if (entity === undefined) throw new Error('Missing transform benchmark Entity.');
            transforms.setPosition(world.entityIndex(entity), index + 1, 2, 3);
        }
        world.update(0);

        expect(transforms.getDiagnostics()).toMatchObject({
            transformCount: entityCount,
            queuedDirtyCount: 0,
            updatedWorldMatrixCount: dirtyCount
        });
        world.destroy();
    });

    it('updates deep subtrees iteratively without recursion or unrelated matrix work', async () => {
        const entityCount = 1_024;
        const world = await World.create({
            initialCapacity: entityCount,
            systems: [createTransformSystem()]
        });
        const entities: Entity[] = [];
        let parent: Entity | null = null;
        for (let index = 0; index < entityCount; index++) {
            const entity = world.createEntity();
            entities.push(entity);
            world.add(entity, LocalTransform, { position: [1, 0, 0] });
            world.add(entity, Hierarchy, { parent });
            parent = entity;
        }
        world.update(0);
        const transforms = getTransformStore(world);
        const root = entities[0];
        const leaf = entities[entityCount - 1];
        if (root === undefined || leaf === undefined) throw new Error('Missing deep-tree Entity.');

        transforms.setPosition(world.entityIndex(root), 2, 0, 0);
        world.update(0);
        expect(transforms.getDiagnostics().updatedWorldMatrixCount).toBe(entityCount);
        expect(translation(world.get(leaf, WorldTransform).matrix)).toEqual([
            entityCount + 1,
            0,
            0
        ]);

        transforms.setPosition(world.entityIndex(leaf), 3, 0, 0);
        world.update(0);
        expect(transforms.getDiagnostics().updatedWorldMatrixCount).toBe(1);
        world.destroy();
    });

    it('validates and updates a 100k deep hierarchy in linear relationship visits', async () => {
        const entityCount = 100_000;
        const world = await World.create({
            initialCapacity: entityCount,
            systems: [createTransformSystem()]
        });
        let parent: Entity | null = null;
        let root: Entity | null = null;
        let leaf: Entity | null = null;
        for (let index = 0; index < entityCount; index++) {
            const entity = world.createEntity();
            root ??= entity;
            leaf = entity;
            world.add(entity, LocalTransform, { position: [1, 0, 0] });
            world.add(entity, Hierarchy, { parent });
            parent = entity;
        }

        world.update(0);

        expect(getHierarchyStore(world).getDiagnostics()).toEqual({
            appliedRelationshipCount: entityCount,
            validationVisitCount: entityCount
        });
        expect(getTransformStore(world).getDiagnostics().updatedWorldMatrixCount).toBe(entityCount);
        if (root === null || leaf === null) throw new Error('Missing deep hierarchy Entity.');
        getTransformStore(world).setPosition(world.entityIndex(root), 2, 0, 0);
        world.update(0);
        expect(getTransformStore(world).getDiagnostics().updatedWorldMatrixCount).toBe(entityCount);
        expect(translation(world.get(leaf, WorldTransform).matrix)).toEqual([
            entityCount + 1,
            0,
            0
        ]);
        world.destroy();
    }, 30_000);

    it('updates only one-percent dirty leaves in a mixed hierarchy forest', async () => {
        const branchCount = 100;
        const branchLength = 100;
        const entityCount = branchCount * branchLength;
        const world = await World.create({
            initialCapacity: entityCount,
            systems: [createTransformSystem()]
        });
        const leaves: Entity[] = [];
        for (let branch = 0; branch < branchCount; branch++) {
            let parent: Entity | null = null;
            for (let depth = 0; depth < branchLength; depth++) {
                const entity = world.createEntity();
                world.add(entity, LocalTransform, { position: [1, branch, 0] });
                world.add(entity, Hierarchy, { parent });
                parent = entity;
                if (depth === branchLength - 1) leaves.push(entity);
            }
        }
        world.update(0);
        const transforms = getTransformStore(world);

        for (const leaf of leaves) transforms.setPosition(world.entityIndex(leaf), 2, 0, 0);
        world.update(0);

        expect(leaves).toHaveLength(entityCount / 100);
        expect(transforms.getDiagnostics().updatedWorldMatrixCount).toBe(leaves.length);
        world.destroy();
    });

    it('samples fixed-step pose history through the interpolation SoA', async () => {
        const world = await World.create({
            fixedDeltaMilliseconds: 10,
            systems: [createTransformSystem()]
        });
        const entity = world.createEntity();
        world.add(entity, LocalTransform, {});
        world.add(entity, InterpolatedTransform, {
            previousPosition: [0, 0, 0],
            previousRotation: [0, 0, 0, 1],
            currentPosition: [10, 4, -2],
            currentRotation: [0, 0, 0, 1]
        });

        world.update(5);

        expect(translation(world.get(entity, WorldTransform).matrix)).toEqual([5, 2, -1]);
        world.destroy();
    });
});
