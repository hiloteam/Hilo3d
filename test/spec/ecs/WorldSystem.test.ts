import { describe, expect, it, vi } from 'vitest';
import type { PendingEntity } from '../../../src/ecs/CommandBuffer';
import { defineComponent } from '../../../src/ecs/Component';
import { defineWorldResource } from '../../../src/ecs/Resource';
import { WORLD_SYSTEM_API_VERSION, type WorldSystem } from '../../../src/ecs/System';
import World from '../../../src/ecs/World';

const Counter = defineComponent<number>('test/counter');

function system(
    id: string,
    phase: WorldSystem['descriptor']['phase'],
    execute: NonNullable<Awaited<ReturnType<WorldSystem['setup']>>>['execute'],
    ordering: Pick<WorldSystem['descriptor'], 'requires' | 'before' | 'after'> = {}
): WorldSystem {
    return {
        descriptor: {
            id,
            version: '1.0.0',
            apiVersion: WORLD_SYSTEM_API_VERSION,
            phase,
            ...ordering
        },
        setup: () => ({ execute })
    };
}

describe('ECS World System scheduler', () => {
    it('compiles phase order, fixed steps, interpolation, and overload dropping', async () => {
        const events: string[] = [];
        const world = await World.create({
            fixedDeltaMilliseconds: 10,
            maxSubSteps: 2,
            maxDeltaMilliseconds: 100,
            systems: [
                system('test/input', 'input', context => {
                    events.push(`${context.phase}:${String(context.deltaTimeMilliseconds)}`);
                }),
                system('test/fixed', 'physics', context => {
                    events.push(`${context.phase}:${String(context.fixedStepIndex)}`);
                }),
                system('test/late', 'update', () => events.push('late'), {
                    after: ['test/early']
                }),
                system('test/early', 'update', () => events.push('early')),
                system('test/transform', 'transform', context => {
                    events.push(`alpha:${context.interpolationAlpha.toFixed(1)}`);
                })
            ]
        });

        world.update(35);

        expect(events).toEqual([
            'input:35',
            'physics:0',
            'physics:1',
            'early',
            'late',
            'alpha:0.5'
        ]);
        expect(world.getDiagnostics()).toMatchObject({
            frameCount: 1,
            fixedStepCount: 2,
            interpolationAlpha: 0.5,
            droppedTimeMilliseconds: 10
        });
        world.destroy();
    });

    it('publishes typed resources, rolls setup back, and destroys in reverse order', async () => {
        const events: string[] = [];
        const Value = defineWorldResource<number>('test/value');
        const provider: WorldSystem = {
            descriptor: {
                id: 'test/provider',
                version: '1.0.0',
                apiVersion: WORLD_SYSTEM_API_VERSION,
                phase: 'input',
                provides: [Value]
            },
            setup(context) {
                events.push('provider:setup');
                context.provide(Value, 42);
                return {
                    execute: () => undefined,
                    destroy: () => events.push('provider:destroy')
                };
            }
        };
        const consumer: WorldSystem = {
            descriptor: {
                id: 'test/consumer',
                version: '1.0.0',
                apiVersion: WORLD_SYSTEM_API_VERSION,
                phase: 'update',
                requires: ['test/provider']
            },
            async setup(context) {
                await Promise.resolve();
                events.push(`consumer:${String(context.get(Value))}`);
                return {
                    execute: () => undefined,
                    destroy: () => events.push('consumer:destroy')
                };
            }
        };

        const world = await World.create({ systems: [consumer, provider] });
        expect(world.getResource(Value)).toBe(42);
        world.destroy();
        expect(events).toEqual([
            'provider:setup',
            'consumer:42',
            'consumer:destroy',
            'provider:destroy'
        ]);

        const cleanup = vi.fn();
        await expect(
            World.create({
                systems: [
                    {
                        ...provider,
                        setup: context => {
                            context.provide(Value, 1);
                            return { execute: () => undefined, destroy: cleanup };
                        }
                    },
                    {
                        descriptor: {
                            id: 'test/failure',
                            version: '1.0.0',
                            apiVersion: WORLD_SYSTEM_API_VERSION,
                            phase: 'update',
                            requires: ['test/provider']
                        },
                        setup: () => {
                            throw new Error('setup failed');
                        }
                    }
                ]
            })
        ).rejects.toThrow('setup failed');
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('uses deferred commands for composition during execution', async () => {
        let pending: PendingEntity | undefined;
        const spawningSystem: WorldSystem = {
            descriptor: {
                id: 'test/spawn',
                version: '1.0.0',
                apiVersion: WORLD_SYSTEM_API_VERSION,
                phase: 'update',
                access: { writes: [Counter] }
            },
            setup(context) {
                context.world.query(Counter);
                return {
                    execute(execution) {
                        expect(() => execution.world.createEntity()).toThrow(/command buffer/u);
                        pending = execution.commands.spawn();
                        execution.commands.add(pending, Counter, 7);
                    }
                };
            }
        };
        const world = await World.create({ systems: [spawningSystem] });
        const query = world.query(Counter);

        world.update(1);

        expect(query.length).toBe(1);
        expect(world.entityCount).toBe(1);
        if (pending === undefined) throw new Error('The spawn System did not queue an Entity.');
        const entity = world.commands.resolve(pending);
        expect(world.get(entity, Counter)).toBe(7);
        world.destroy();
    });

    it('rejects dependency cycles, impossible cross-phase order, and asynchronous execute', async () => {
        await expect(
            World.create({
                systems: [
                    system('test/a', 'update', () => undefined, { requires: ['test/b'] }),
                    system('test/b', 'update', () => undefined, { requires: ['test/a'] })
                ]
            })
        ).rejects.toThrow(/ordering cycle/u);

        await expect(
            World.create({
                systems: [
                    system('test/render', 'render-extract', () => undefined),
                    system('test/early', 'update', () => undefined, {
                        after: ['test/render']
                    })
                ]
            })
        ).rejects.toThrow(/conflicts with phases/u);

        const promiseReturningExecute = (): unknown => Promise.resolve();
        const asyncWorld = await World.create({
            systems: [system('test/async', 'update', promiseReturningExecute)]
        });
        expect(() => {
            asyncWorld.update(1);
        }).toThrow(/returned a Promise/u);
        asyncWorld.destroy();
    });

    it('requires explicit same-phase ordering for declared read/write hazards', async () => {
        const writer = system('test/writer', 'update', () => undefined);
        const reader = system('test/reader', 'update', () => undefined);
        const writerWithAccess: WorldSystem = {
            ...writer,
            descriptor: { ...writer.descriptor, access: { writes: [Counter] } }
        };
        const readerWithAccess: WorldSystem = {
            ...reader,
            descriptor: { ...reader.descriptor, access: { reads: [Counter] } }
        };

        await expect(
            World.create({ systems: [writerWithAccess, readerWithAccess] })
        ).rejects.toThrow(/unordered update access hazard/u);

        const orderedReader: WorldSystem = {
            ...readerWithAccess,
            descriptor: { ...readerWithAccess.descriptor, after: ['test/writer'] }
        };
        const world = await World.create({ systems: [orderedReader, writerWithAccess] });
        world.destroy();
    });

    it('reports both input clamping and fixed-step overload as dropped time', async () => {
        const world = await World.create({
            fixedDeltaMilliseconds: 10,
            maxSubSteps: 2,
            maxDeltaMilliseconds: 30
        });

        world.update(100);

        expect(world.getDiagnostics()).toMatchObject({
            fixedStepCount: 2,
            interpolationAlpha: 0,
            droppedTimeMilliseconds: 80
        });
        world.destroy();
    });
});
