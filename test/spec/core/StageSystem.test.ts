import { describe, expect, it, vi } from 'vitest';
import type Stage from '../../../src/core/Stage';
import {
    STAGE_SYSTEM_API_VERSION,
    StageSystemRegistry,
    createStageSystemService,
    type StageSystem
} from '../../../src/core/StageSystem';

function createRegistry(): StageSystemRegistry {
    return new StageSystemRegistry(Object.create(null) as Stage);
}

describe('StageSystemRegistry', () => {
    it('orders dependencies, publishes typed services, dispatches hooks, and tears down in reverse', async () => {
        const events: string[] = [];
        const valueService = createStageSystemService<number>('test/value');
        const provider: StageSystem = {
            descriptor: {
                id: 'test/provider',
                version: '1.0.0',
                apiVersion: STAGE_SYSTEM_API_VERSION,
                provides: [valueService]
            },
            setup(context) {
                events.push('provider:setup');
                context.provide(valueService, 42);
                return {
                    beforeUpdate: () => events.push('provider:update'),
                    destroy: () => events.push('provider:destroy')
                };
            }
        };
        const consumer: StageSystem = {
            descriptor: {
                id: 'test/consumer',
                version: '1.0.0',
                apiVersion: STAGE_SYSTEM_API_VERSION,
                requires: ['test/provider']
            },
            async setup(context) {
                await Promise.resolve();
                events.push(`consumer:${String(context.get(valueService))}`);
                return {
                    beforeUpdate: () => events.push('consumer:update'),
                    destroy: () => events.push('consumer:destroy')
                };
            }
        };
        const registry = createRegistry();

        await registry.initialize([consumer, provider]);
        registry.runBeforeUpdate(16);
        expect(registry.get(valueService)).toBe(42);
        registry.destroy();

        expect(events).toEqual([
            'provider:setup',
            'consumer:42',
            'provider:update',
            'consumer:update',
            'consumer:destroy',
            'provider:destroy'
        ]);
        expect(registry.getOptional(valueService)).toBeUndefined();
    });

    it('rolls back initialized runtimes when asynchronous setup fails', async () => {
        const destroy = vi.fn();
        const registry = createRegistry();
        await expect(
            registry.initialize([
                {
                    descriptor: {
                        id: 'test/ready',
                        version: '1.0.0',
                        apiVersion: STAGE_SYSTEM_API_VERSION
                    },
                    setup: () => ({ destroy })
                },
                {
                    descriptor: {
                        id: 'test/fails',
                        version: '1.0.0',
                        apiVersion: STAGE_SYSTEM_API_VERSION,
                        requires: ['test/ready']
                    },
                    setup: async () => {
                        await Promise.resolve();
                        throw new Error('setup failed');
                    }
                }
            ])
        ).rejects.toThrow('setup failed');
        expect(destroy).toHaveBeenCalledOnce();
        expect(registry.has('test/ready')).toBe(false);
    });

    it('keeps setup services private and disposes a late runtime after host destruction', async () => {
        const service = createStageSystemService<number>('test/pending');
        const destroy = vi.fn();
        let continueSetup = (): void => {
            throw new Error('Setup gate was not initialized.');
        };
        const setupGate = new Promise<void>(resolve => {
            continueSetup = resolve;
        });
        const registry = createRegistry();
        await registry.initialize([]);

        const installation = registry.install({
            descriptor: {
                id: 'test/pending',
                version: '1.0.0',
                apiVersion: STAGE_SYSTEM_API_VERSION,
                provides: [service]
            },
            async setup(context) {
                context.provide(service, 7);
                expect(context.get(service)).toBe(7);
                await setupGate;
                return { destroy };
            }
        });

        expect(registry.getOptional(service)).toBeUndefined();
        registry.destroy();
        continueSetup();

        await expect(installation).rejects.toThrow('after its Stage was destroyed');
        expect(destroy).toHaveBeenCalledOnce();
        expect(registry.getOptional(service)).toBeUndefined();
    });

    it('compiles hard dependencies plus soft before/after constraints once per mutation', async () => {
        const events: string[] = [];
        const system = (
            id: string,
            ordering: Pick<StageSystem['descriptor'], 'requires' | 'before' | 'after'> = {}
        ): StageSystem => ({
            descriptor: {
                id,
                version: '1.0.0',
                apiVersion: STAGE_SYSTEM_API_VERSION,
                ...ordering
            },
            setup: () => ({ beforeUpdate: () => events.push(id) })
        });

        const registry = createRegistry();
        await registry.initialize([
            system('base'),
            system('late', { after: ['base', 'optional/missing'] }),
            system('early', { before: ['base'] })
        ]);
        registry.runBeforeUpdate(16);
        expect(events).toEqual(['early', 'base', 'late']);

        events.length = 0;
        await registry.install(system('middle', { after: ['base'], before: ['late'] }));
        registry.runBeforeUpdate(16);
        expect(events).toEqual(['early', 'base', 'middle', 'late']);
        registry.destroy();
    });

    it('rejects missing dependencies, cycles, duplicate ids, and dependant-first removal', async () => {
        const system = (id: string, requires?: readonly string[]): StageSystem => ({
            descriptor: {
                id,
                version: '1.0.0',
                apiVersion: STAGE_SYSTEM_API_VERSION,
                ...(requires === undefined ? {} : { requires })
            },
            setup: () => ({})
        });

        await expect(createRegistry().initialize([system('a', ['missing'])])).rejects.toThrow(
            'requires missing System'
        );
        await expect(
            createRegistry().initialize([system('a', ['b']), system('b', ['a'])])
        ).rejects.toThrow('ordering cycle');
        await expect(createRegistry().initialize([system('a'), system('a')])).rejects.toThrow(
            'Duplicate Stage System'
        );

        const registry = createRegistry();
        await registry.initialize([system('a'), system('b', ['a'])]);
        expect(() => {
            registry.uninstall('a');
        }).toThrow('depends on it');
        registry.uninstall('b');
        registry.uninstall('a');
        expect(registry.has('a')).toBe(false);
    });

    it('cleans up a returned runtime when runtime validation fails', async () => {
        const destroy = vi.fn();
        await expect(
            createRegistry().initialize([
                {
                    descriptor: {
                        id: 'test/invalid-runtime',
                        version: '1.0.0',
                        apiVersion: STAGE_SYSTEM_API_VERSION
                    },
                    setup: () => ({ beforeUpdate: 1, destroy }) as unknown as never
                }
            ])
        ).rejects.toThrow('beforeUpdate must be a function');
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('rejects conflicting service providers before either setup allocates resources', async () => {
        const service = createStageSystemService<number>('test/conflict');
        const setup = vi.fn(() => ({ destroy: vi.fn() }));
        const system = (id: string): StageSystem => ({
            descriptor: {
                id,
                version: '1.0.0',
                apiVersion: STAGE_SYSTEM_API_VERSION,
                provides: [service]
            },
            setup
        });

        await expect(createRegistry().initialize([system('a'), system('b')])).rejects.toThrow(
            'provided by both a and b'
        );
        expect(setup).not.toHaveBeenCalled();
    });
});
