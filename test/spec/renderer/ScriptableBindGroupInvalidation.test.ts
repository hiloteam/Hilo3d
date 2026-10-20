import { describe, expect, it, vi } from 'vitest';
import {
    RHIBufferUsage,
    RHIShaderStage,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupLayout,
    type RHIBuffer,
    type RHIDevice
} from '../../../src/render/rhi/core';
import {
    ResourceRegistry,
    type ResourceRegistryHandle
} from '../../../src/render/renderer/ResourceRegistry';
import { ScriptableBindGroupResourceCache } from '../../../src/render/renderer/ScriptableBindGroupResourceCache';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function fixture(duplicateBinding = false): {
    readonly backend: FakeWebGPURHIBackend;
    readonly device: RHIDevice;
    readonly registry: ResourceRegistry;
    readonly cache: ScriptableBindGroupResourceCache;
    readonly layout: ResourceRegistryHandle<RHIBindGroupLayout>;
    createBuffer(): ResourceRegistryHandle<RHIBuffer>;
    descriptor(buffer: ResourceRegistryHandle<RHIBuffer>, offset?: number): RHIBindGroupDescriptor;
    destroy(): void;
} {
    const backend = new FakeWebGPURHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const cache = new ScriptableBindGroupResourceCache(registry);
    const layout = registry.register<RHIBindGroupLayout>({
        create(layoutDevice) {
            const entries = [
                {
                    binding: 0,
                    visibility: RHIShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' as const }
                }
            ];
            if (duplicateBinding) {
                entries.push({
                    binding: 1,
                    visibility: RHIShaderStage.COMPUTE,
                    buffer: { type: 'read-only-storage' }
                });
            }
            return layoutDevice.createBindGroupLayout({ entries });
        }
    });
    return {
        backend,
        device,
        registry,
        cache,
        layout,
        createBuffer() {
            return registry.registerBuffer({ size: 512, usage: RHIBufferUsage.STORAGE });
        },
        descriptor(buffer, offset = 0) {
            const entries = [
                { binding: 0, resource: { buffer: registry.resolve(buffer), offset, size: 256 } }
            ];
            if (duplicateBinding) {
                entries.push({
                    binding: 1,
                    resource: { buffer: registry.resolve(buffer), offset, size: 256 }
                });
            }
            return { layout: registry.resolve(layout), entries };
        },
        destroy() {
            cache.destroy();
            registry.destroy();
            backend.destroy();
        }
    };
}

function requireGroup(
    handle: ResourceRegistryHandle<RHIBindGroup> | null
): ResourceRegistryHandle<RHIBindGroup> {
    if (handle === null) throw new Error('Expected a persistent bind group');
    return handle;
}

describe('Scriptable bind-group dependency invalidation', () => {
    it('invalidates only groups using a destroyed dependency and retains its pending fence', async () => {
        const f = fixture(true);
        const victim = f.createBuffer();
        const survivor = f.createBuffer();
        const first = requireGroup(f.cache.prepare({}, 0, f.descriptor(victim)));
        const second = requireGroup(f.cache.prepare({}, 2, f.descriptor(victim)));
        const survivorOwner = {};
        const untouched = requireGroup(f.cache.prepare(survivorOwner, 0, f.descriptor(survivor)));
        const firstGroup = f.registry.resolve(first);
        const secondGroup = f.registry.resolve(second);
        const buffer = f.registry.resolve(victim);
        f.registry.markUsed(first, 7);
        f.registry.markUsed(second, 7);
        const submission = f.device.graphicsQueue.endFrame(f.device.graphicsQueue.beginFrame());
        const collected = submission.done.then(() => f.registry.collect(7));

        expect(f.cache.invalidateResource(victim)).toBe(2);
        f.registry.release(victim);
        expect(f.registry.collect(6)).toBe(0);
        expect(firstGroup.destroyed).toBe(false);
        expect(secondGroup.destroyed).toBe(false);
        expect(buffer.destroyed).toBe(false);
        expect(f.cache.metrics.size).toBe(1);
        expect(f.cache.prepare(survivorOwner, 0, f.descriptor(survivor))).toBe(untouched);
        expect(f.cache.invalidateResource(victim)).toBe(0);

        f.backend.completeNextSubmission();
        await collected;
        expect(firstGroup.destroyed).toBe(true);
        expect(secondGroup.destroyed).toBe(true);
        expect(buffer.destroyed).toBe(true);
        expect(f.registry.resolve(untouched).destroyed).toBe(false);
        f.destroy();
    });

    it('removes reverse dependencies on replacement, pruning, detachment and transient fallback', () => {
        const f = fixture();
        const first = f.createBuffer();
        const second = f.createBuffer();
        const owner = {};
        f.cache.prepare(owner, 0, f.descriptor(first));
        const replacement = requireGroup(f.cache.prepare(owner, 0, f.descriptor(second)));
        expect(f.cache.invalidateResource(first)).toBe(0);
        expect(f.cache.prepare(owner, 0, f.descriptor(second))).toBe(replacement);
        f.cache.prune(owner, []);
        expect(f.cache.invalidateResource(second)).toBe(0);

        f.cache.prepare(owner, 0, f.descriptor(first));
        f.cache.prepare(owner, 1, f.descriptor(second));
        f.cache.prune(owner, [1]);
        expect(f.cache.invalidateResource(first)).toBe(0);
        expect(f.cache.detach(owner)).toBe(true);
        expect(f.cache.invalidateResource(second)).toBe(0);

        f.cache.prepare(owner, 0, f.descriptor(first));
        const transient = f.device.createBuffer({
            lifetime: 'frame',
            size: 256,
            usage: RHIBufferUsage.STORAGE
        });
        expect(
            f.cache.prepare(owner, 0, {
                layout: f.registry.resolve(f.layout),
                entries: [{ binding: 0, resource: { buffer: transient } }]
            })
        ).toBeNull();
        expect(f.cache.invalidateResource(first)).toBe(0);
        expect(f.cache.invalidateResource(f.layout)).toBe(0);
        expect(f.cache.metrics.size).toBe(0);
        transient.destroy();
        f.destroy();
    });

    it('keeps dependency identities across device recovery and clears every affected owner', () => {
        const f = fixture(true);
        const buffer = f.createBuffer();
        const owner = {};
        const handle = requireGroup(f.cache.prepare(owner, 0, f.descriptor(buffer)));
        const oldGroup = f.registry.resolve(handle);
        f.registry.recover(f.backend.createDevice());
        const rebuilt = f.registry.resolve(handle);
        expect(rebuilt).not.toBe(oldGroup);
        expect(f.cache.prepare(owner, 0, f.descriptor(buffer))).toBe(handle);
        expect(f.cache.invalidateResource(buffer)).toBe(1);
        f.registry.release(buffer);
        f.registry.collect(0);
        expect(rebuilt.destroyed).toBe(true);
        expect(f.cache.detach(owner)).toBe(false);
        f.destroy();
    });

    it('matches fresh descriptors without rebuilding frozen recipes on cache hits', () => {
        const f = fixture(true);
        const buffer = f.createBuffer();
        const owner = {};
        const first = requireGroup(f.cache.prepare(owner, 0, f.descriptor(buffer)));
        const descriptors = Array.from({ length: 16 }, () => f.descriptor(buffer));
        const activeSlots = [0];
        const freeze = vi.spyOn(Object, 'freeze');
        let matched = true;
        for (const descriptor of descriptors) {
            matched = f.cache.prepare(owner, 0, descriptor) === first && matched;
            f.cache.prune(owner, activeSlots);
        }
        const freezeCalls = freeze.mock.calls.length;
        freeze.mockRestore();
        expect(matched).toBe(true);
        expect(freezeCalls).toBe(0);
        expect(f.cache.metrics).toMatchObject({ hits: 16, misses: 1, size: 1 });
        const changedRange = requireGroup(f.cache.prepare(owner, 0, f.descriptor(buffer, 256)));
        expect(changedRange).not.toBe(first);
        const descriptor = f.descriptor(buffer, 256);
        const reordered = requireGroup(
            f.cache.prepare(owner, 0, { ...descriptor, entries: [...descriptor.entries].reverse() })
        );
        expect(reordered).not.toBe(changedRange);
        expect(f.cache.invalidateResource(buffer)).toBe(1);
        f.destroy();
    });
});
