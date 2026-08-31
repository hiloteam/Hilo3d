import { describe, expect, it, vi } from 'vitest';
import type Stage from '../../../src/core/Stage';
import {
    STAGE_PLUGIN_API_VERSION,
    StagePluginHost,
    createStagePluginService,
    type StagePlugin
} from '../../../src/core/StagePlugin';

function createHost(): StagePluginHost {
    return new StagePluginHost(Object.create(null) as Stage);
}

describe('StagePluginHost', () => {
    it('orders dependencies, publishes typed services, dispatches hooks, and tears down in reverse', async () => {
        const events: string[] = [];
        const valueService = createStagePluginService<number>('test/value');
        const provider: StagePlugin = {
            descriptor: {
                id: 'test/provider',
                version: '1.0.0',
                apiVersion: STAGE_PLUGIN_API_VERSION
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
        const consumer: StagePlugin = {
            descriptor: {
                id: 'test/consumer',
                version: '1.0.0',
                apiVersion: STAGE_PLUGIN_API_VERSION,
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
        const host = createHost();

        await host.initialize([consumer, provider]);
        host.runBeforeUpdate(16);
        expect(host.get(valueService)).toBe(42);
        host.destroy();

        expect(events).toEqual([
            'provider:setup',
            'consumer:42',
            'provider:update',
            'consumer:update',
            'consumer:destroy',
            'provider:destroy'
        ]);
        expect(host.getOptional(valueService)).toBeUndefined();
    });

    it('rolls back initialized runtimes when asynchronous setup fails', async () => {
        const destroy = vi.fn();
        const host = createHost();
        await expect(
            host.initialize([
                {
                    descriptor: {
                        id: 'test/ready',
                        version: '1.0.0',
                        apiVersion: STAGE_PLUGIN_API_VERSION
                    },
                    setup: () => ({ destroy })
                },
                {
                    descriptor: {
                        id: 'test/fails',
                        version: '1.0.0',
                        apiVersion: STAGE_PLUGIN_API_VERSION,
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
        expect(host.has('test/ready')).toBe(false);
    });

    it('keeps setup services private and disposes a late runtime after host destruction', async () => {
        const service = createStagePluginService<number>('test/pending');
        const destroy = vi.fn();
        let continueSetup = (): void => {
            throw new Error('Setup gate was not initialized.');
        };
        const setupGate = new Promise<void>(resolve => {
            continueSetup = resolve;
        });
        const host = createHost();
        await host.initialize([]);

        const installation = host.install({
            descriptor: {
                id: 'test/pending',
                version: '1.0.0',
                apiVersion: STAGE_PLUGIN_API_VERSION
            },
            async setup(context) {
                context.provide(service, 7);
                expect(context.get(service)).toBe(7);
                await setupGate;
                return { destroy };
            }
        });

        expect(host.getOptional(service)).toBeUndefined();
        host.destroy();
        continueSetup();

        await expect(installation).rejects.toThrow('after its Stage was destroyed');
        expect(destroy).toHaveBeenCalledOnce();
        expect(host.getOptional(service)).toBeUndefined();
    });

    it('rejects missing dependencies, cycles, duplicate ids, and dependant-first removal', async () => {
        const plugin = (id: string, requires?: readonly string[]): StagePlugin => ({
            descriptor: {
                id,
                version: '1.0.0',
                apiVersion: STAGE_PLUGIN_API_VERSION,
                ...(requires === undefined ? {} : { requires })
            },
            setup: () => ({})
        });

        await expect(createHost().initialize([plugin('a', ['missing'])])).rejects.toThrow(
            'requires missing plugin'
        );
        await expect(
            createHost().initialize([plugin('a', ['b']), plugin('b', ['a'])])
        ).rejects.toThrow('dependency cycle');
        await expect(createHost().initialize([plugin('a'), plugin('a')])).rejects.toThrow(
            'Duplicate Stage plugin'
        );

        const host = createHost();
        await host.initialize([plugin('a'), plugin('b', ['a'])]);
        expect(() => {
            host.uninstall('a');
        }).toThrow('depends on it');
        host.uninstall('b');
        host.uninstall('a');
        expect(host.has('a')).toBe(false);
    });
});
