import { describe, expect, it } from 'vitest';
import { SparseSetComponentStore, defineComponent } from '../../../src/ecs/Component';
import World from '../../../src/ecs/World';
import { LocalTransform } from '../../../src/scene/components/Transform';

interface PositionValue {
    x: number;
    y: number;
}

const Position = defineComponent<PositionValue>('test/position');
const Velocity = defineComponent<PositionValue>('test/velocity');
const Disabled = defineComponent<true>('test/disabled');

function queryEntities(world: World, query: ReturnType<World['query']>): readonly number[] {
    const entities: number[] = [];
    for (let index = 0; index < query.length; index++) {
        entities.push(world.entityAt(query.entityIndices[index] ?? 0));
    }
    return entities;
}

describe('ECS Entity and component storage', () => {
    it('creates an Entity with one initial component while keeping empty Entities empty', async () => {
        const world = await World.create();
        const logical = world.createEntity();
        const spatial = world.createEntity(LocalTransform);
        const positioned = world.createEntity(Position, { x: 1, y: 2 });

        expect(world.has(logical, LocalTransform)).toBe(false);
        expect(world.has(spatial, LocalTransform)).toBe(true);
        expect(world.get(spatial, LocalTransform)).toMatchObject({
            position: [0, 0, 0],
            rotation: [0, 0, 0, 1],
            scale: [1, 1, 1]
        });
        expect(world.get(positioned, Position)).toEqual({ x: 1, y: 2 });
        world.destroy();
    });

    it('rolls back Entity creation when its initial component is invalid', async () => {
        const world = await World.create();

        expect(() => world.createEntity(LocalTransform, { rotation: [0, 0, 0, 0] })).toThrow(
            /quaternion cannot be zero/u
        );
        expect(world.entityCount).toBe(0);
        world.destroy();
    });

    it('invalidates stale handles and rejects handles owned by another World', async () => {
        const firstWorld = await World.create({ initialCapacity: 1 });
        const secondWorld = await World.create({ initialCapacity: 1 });
        const first = firstWorld.createEntity();
        const foreign = secondWorld.createEntity();

        expect(firstWorld.isAlive(first)).toBe(true);
        expect(firstWorld.isAlive(foreign)).toBe(false);

        firstWorld.destroyEntity(first);
        const replacement = firstWorld.createEntity();
        expect(replacement).not.toBe(first);
        expect(firstWorld.isAlive(first)).toBe(false);
        expect(() => {
            firstWorld.add(first, Position, { x: 1, y: 2 });
        }).toThrow(/not alive/u);

        firstWorld.destroy();
        expect(firstWorld.isAlive(replacement)).toBe(false);
        expect(firstWorld.getDiagnostics().entityCount).toBe(0);
        expect(() => firstWorld.getStore(Position)).toThrow(/World is destroyed/u);
        secondWorld.destroy();
    });

    it('stores composable data and incrementally maintains required and excluded queries', async () => {
        const world = await World.create({ initialCapacity: 2 });
        const moving = world.createEntity();
        const stationary = world.createEntity();
        world.add(moving, Position, { x: 1, y: 2 });
        world.add(moving, Velocity, { x: 3, y: 4 });
        world.add(stationary, Position, { x: 5, y: 6 });

        const positionQuery = world.query(Position);
        const movingQuery = world.query(Position, Velocity);
        const enabledMovingQuery = world.query({ all: [Position, Velocity], none: [Disabled] });

        expect(new Set(queryEntities(world, positionQuery))).toEqual(new Set([moving, stationary]));
        expect(queryEntities(world, movingQuery)).toEqual([moving]);
        expect(queryEntities(world, enabledMovingQuery)).toEqual([moving]);
        expect(world.query(Velocity, Position)).toBe(movingQuery);

        const membershipRevision = movingQuery.revision;
        world.set(moving, Velocity, { x: 7, y: 8 });
        expect(world.get(moving, Velocity)).toEqual({ x: 7, y: 8 });
        expect(movingQuery.revision).toBe(membershipRevision);

        world.add(moving, Disabled, true);
        expect(enabledMovingQuery.length).toBe(0);
        world.remove(moving, Disabled);
        expect(queryEntities(world, enabledMovingQuery)).toEqual([moving]);

        world.remove(moving, Velocity);
        expect(movingQuery.length).toBe(0);
        expect(enabledMovingQuery.length).toBe(0);
        expect(positionQuery.length).toBe(2);

        world.destroyEntity(stationary);
        expect(queryEntities(world, positionQuery)).toEqual([moving]);
        world.destroy();
    });

    it('uses swap-remove while preserving entity lookup and entry revisions', () => {
        const store = new SparseSetComponentStore<number>(8, 2);
        store.add(1, 10);
        store.add(3, 30);
        store.add(5, 50);
        const firstRevision = store.getEntryRevision(5);

        expect(store.remove(3)).toBe(true);
        expect(store.length).toBe(2);
        expect(store.get(1)).toBe(10);
        expect(store.get(5)).toBe(50);
        expect(store.entityIndices[1]).toBe(5);

        store.set(5, 55);
        expect(store.get(5)).toBe(55);
        expect(store.getEntryRevision(5)).toBe(firstRevision + 1);
        expect(store.remove(3)).toBe(false);
    });

    it('validates a deferred structural batch before mutating the World', async () => {
        const world = await World.create();
        const first = world.createEntity();
        const second = world.createEntity();
        world.add(first, Position, { x: 0, y: 0 });

        world.commands.destroy(second);
        world.commands.add(first, Position, { x: 1, y: 1 });

        expect(() => {
            world.commands.apply(world);
        }).toThrow(/already has component/u);
        expect(world.isAlive(second)).toBe(true);
        expect(world.get(first, Position)).toEqual({ x: 0, y: 0 });
        expect(world.commands.length).toBe(0);
        world.destroy();
    });

    it('prevalidates deferred component values before applying an earlier command', async () => {
        const world = await World.create();
        const first = world.createEntity();
        const second = world.createEntity();
        world.getStore(LocalTransform);
        world.commands.destroy(second);
        world.commands.add(first, LocalTransform, { rotation: [0, 0, 0, 0] });

        expect(() => {
            world.commands.apply(world);
        }).toThrow(/quaternion cannot be zero/u);
        expect(world.isAlive(first)).toBe(true);
        expect(world.isAlive(second)).toBe(true);
        expect(world.has(first, LocalTransform)).toBe(false);
        world.destroy();
    });

    it('keeps a custom SoA store intact when a direct payload is invalid', async () => {
        const world = await World.create();
        const entity = world.createEntity();

        expect(() => {
            world.add(entity, LocalTransform, { rotation: [0, 0, 0, 0] });
        }).toThrow(/quaternion cannot be zero/u);
        expect(world.has(entity, LocalTransform)).toBe(false);

        world.add(entity, LocalTransform, { position: [1, 2, 3] });
        expect(world.get(entity, LocalTransform).position).toEqual([1, 2, 3]);
        expect(() => {
            world.set(entity, LocalTransform, { rotation: [0, 0, 0, 0] });
        }).toThrow(/quaternion cannot be zero/u);
        expect(world.get(entity, LocalTransform).position).toEqual([1, 2, 3]);
        world.destroy();
    });
});
