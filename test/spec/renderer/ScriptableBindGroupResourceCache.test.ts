import { describe, expect, it } from 'vitest';
import {
    RHIBufferUsage,
    RHIShaderStage,
    type RHIBindGroupDescriptor,
    type RHIBindGroupLayout
} from '../../../src/render/rhi/core';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ScriptableBindGroupResourceCache } from '../../../src/render/renderer/ScriptableBindGroupResourceCache';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

describe('ScriptableBindGroupResourceCache', () => {
    it('reuses exact stable bindings, rebuilds on recovery, and rejects frame-only resources', () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const layout = registry.register<RHIBindGroupLayout>({
            label: 'stable storage layout',
            create: device =>
                device.createBindGroupLayout({
                    label: 'stable storage layout',
                    entries: [
                        {
                            binding: 0,
                            visibility: RHIShaderStage.COMPUTE,
                            buffer: { type: 'storage', minBindingSize: 16 }
                        }
                    ]
                })
        });
        const storage = registry.registerBuffer({
            label: 'stable storage',
            size: 256,
            usage: RHIBufferUsage.STORAGE
        });
        const cache = new ScriptableBindGroupResourceCache(registry);
        const owner = {};
        const descriptor = (): RHIBindGroupDescriptor => ({
            label: 'scriptable storage',
            lifetime: 'frame',
            layout: registry.resolve(layout),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: registry.resolve(storage),
                        offset: 0,
                        size: 256
                    }
                }
            ]
        });

        const firstHandle = cache.prepare(owner, 0, descriptor());
        expect(firstHandle).not.toBeNull();
        if (firstHandle === null) throw new Error('Stable bind group was not cached');
        const first = registry.resolve(firstHandle);
        expect(cache.prepare(owner, 0, descriptor())).toBe(firstHandle);
        expect(cache.metrics).toMatchObject({ hits: 1, misses: 1, size: 1 });

        const replacement = backend.createDevice();
        registry.recover(replacement);
        expect(cache.prepare(owner, 0, descriptor())).toBe(firstHandle);
        expect(registry.resolve(firstHandle)).not.toBe(first);
        expect(registry.resolve(firstHandle).deviceId).toBe(replacement.id);

        const transient = replacement.createBuffer({
            lifetime: 'frame',
            size: 256,
            usage: RHIBufferUsage.STORAGE
        });
        const transientDescriptor: RHIBindGroupDescriptor = {
            ...descriptor(),
            entries: [{ binding: 0, resource: { buffer: transient } }]
        };
        expect(cache.prepare(owner, 0, transientDescriptor)).toBeNull();
        expect(cache.metrics.size).toBe(0);

        transient.destroy();
        cache.destroy();
        registry.destroy();
        backend.destroy();
    });
});
