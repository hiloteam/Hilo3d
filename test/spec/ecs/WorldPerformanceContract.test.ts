import { describe, expect, it } from 'vitest';
import type { PendingEntity } from '../../../src/ecs/CommandBuffer';
import { defineComponent, type ComponentStore } from '../../../src/ecs/Component';
import type { Entity } from '../../../src/ecs/Entity';
import { WORLD_SYSTEM_API_VERSION, type WorldSystem } from '../../../src/ecs/System';
import World from '../../../src/ecs/World';

const HotValue = defineComponent<number>('performance/hot-value');

describe('ECS steady-state performance contracts', () => {
    it('reuses query and store buffers across repeated allocation-free update dispatch', async () => {
        const entityCount = 10_000;
        let hotStore: ComponentStore<number> | undefined;
        const updateSystem: WorldSystem = {
            descriptor: {
                id: 'performance/update-hot-values',
                version: '1.0.0',
                apiVersion: WORLD_SYSTEM_API_VERSION,
                phase: 'update',
                access: { writes: [HotValue] }
            },
            setup(context) {
                const store = context.world.getStore(HotValue);
                hotStore = store;
                const query = context.world.query(HotValue);
                return {
                    execute() {
                        for (let denseIndex = 0; denseIndex < query.length; denseIndex++) {
                            const entityIndex = query.entityIndices[denseIndex] ?? 0;
                            store.set(entityIndex, store.get(entityIndex) + 1);
                        }
                    }
                };
            }
        };
        const world = await World.create({
            initialCapacity: entityCount,
            systems: [updateSystem]
        });
        for (let index = 0; index < entityCount; index++) {
            const entity = world.createEntity();
            world.add(entity, HotValue, index);
        }
        const resolvedHotStore = hotStore;
        if (resolvedHotStore === undefined) throw new Error('Hot component store was not set up.');
        const query = world.query(HotValue);
        const queryBuffer = query.entityIndices;
        const storeBuffer = resolvedHotStore.entityIndices;
        const entityCapacity = world.getDiagnostics().entityCapacity;

        for (let frame = 0; frame < 20; frame++) world.update(1);

        expect(query.entityIndices).toBe(queryBuffer);
        expect(resolvedHotStore.entityIndices).toBe(storeBuffer);
        expect(world.getDiagnostics()).toMatchObject({
            entityCount,
            entityCapacity,
            queuedCommandCount: 0,
            frameCount: 20
        });
        expect(query.length).toBe(entityCount);
        expect(resolvedHotStore.getByDenseIndex(0)).toBe(20);
        expect(resolvedHotStore.getByDenseIndex(entityCount - 1)).toBe(entityCount - 1 + 20);
        world.destroy();
    });

    it('retains bounded high-water storage across repeated 10k structural churn batches', async () => {
        const entityCount = 10_000;
        const world = await World.create({ initialCapacity: entityCount });
        const store = world.getStore(HotValue);
        const query = world.query(HotValue);
        let live: Entity[] = [];
        for (let index = 0; index < entityCount; index++) {
            const entity = world.createEntity();
            live.push(entity);
            world.add(entity, HotValue, index);
        }

        const churn = (): void => {
            const pending: PendingEntity[] = [];
            for (const entity of live) world.commands.destroy(entity);
            for (let index = 0; index < entityCount; index++) {
                const entity = world.commands.spawn();
                pending.push(entity);
                world.commands.add(entity, HotValue, index);
            }
            world.commands.apply(world);
            live = pending.map(entity => world.commands.resolve(entity));
        };

        churn();
        const storeEntities = store.entityIndices;
        const queryEntities = query.entityIndices;
        const commandCapacity = world.commands.capacity;
        const entityCapacity = world.getDiagnostics().entityCapacity;
        for (let cycle = 0; cycle < 4; cycle++) churn();

        expect(store.entityIndices).toBe(storeEntities);
        expect(query.entityIndices).toBe(queryEntities);
        expect(world.commands.capacity).toBe(commandCapacity);
        expect(world.getDiagnostics()).toMatchObject({
            entityCount,
            entityCapacity,
            queuedCommandCount: 0
        });
        expect(query.length).toBe(entityCount);
        world.destroy();
    });
});
