import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ShadowAtlasPlanner } from '../../../src/render/renderer/ShadowAtlasPlanner';
import { ShadowAtlasResourceCache } from '../../../src/render/renderer/ShadowAtlasResourceCache';
import { RHITextureUsage } from '../../../src/render/rhi/core';
import { describe, expect, it } from 'vitest';
import { FakeWebGLRHIBackend, type FakeRHITexture } from '../rhi/portable/FakeRHIBackend';

describe('ShadowAtlasResourceCache', () => {
    it('reuses a logical atlas and rebuilds it on same-backend recovery', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new ShadowAtlasResourceCache(registry);
        const planner = new ShadowAtlasPlanner();
        const light = {};
        const owner = {};
        const plan = planner.build(
            {
                directional: [{ owner: light, width: 64, height: 32 }],
                spot: [],
                point: []
            },
            firstDevice.capabilities
        );

        const resource = cache.prepare(owner, plan);
        const firstTexture = cache.resolve(owner) as FakeRHITexture;
        expect(cache.prepare(owner, plan)).toBe(resource);
        expect(firstTexture.descriptor).toMatchObject({
            lifetime: 'persistent',
            size: { width: 64, height: 32, depthOrArrayLayers: 1 },
            sampleCount: 1,
            dimension: '2d',
            viewDimension: '2d',
            format: 'depth24plus'
        });
        expect(firstTexture.usage).toBe(
            RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
        );
        cache.markUsed(owner, 5);

        const secondDevice = backend.createDevice();
        registry.recover(secondDevice);
        const secondTexture = cache.resolve(owner) as FakeRHITexture;
        expect(secondTexture).not.toBe(firstTexture);
        expect(secondTexture.deviceId).toBe(secondDevice.id);
        expect(secondTexture.descriptor).toEqual(firstTexture.descriptor);
        expect(firstTexture.destroyed).toBe(true);
        expect(cache.prepare(owner, plan)).toBe(resource);

        expect(cache.detach(owner)).toBe(true);
        expect(cache.detach(owner)).toBe(false);
        expect(registry.collect(4)).toBe(0);
        expect(secondTexture.destroyed).toBe(false);
        expect(registry.collect(5)).toBe(3);
        expect(secondTexture.destroyed).toBe(true);
        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('atomically replaces resized atlases and defers each release to last use', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new ShadowAtlasResourceCache(registry);
        const planner = new ShadowAtlasPlanner();
        const light = {};
        const owner = {};
        const firstPlan = planner.build(
            {
                directional: [{ owner: light, width: 32, height: 32 }],
                spot: [],
                point: []
            },
            device.capabilities
        );
        const firstResource = cache.prepare(owner, firstPlan);
        const firstTexture = cache.resolve(owner);
        cache.markUsed(owner, 3);

        const resizedPlan = planner.build(
            {
                directional: [{ owner: light, width: 64, height: 32 }],
                spot: [],
                point: []
            },
            device.capabilities
        );
        const secondResource = cache.prepare(owner, resizedPlan);
        const secondTexture = cache.resolve(owner);
        expect(secondResource).not.toBe(firstResource);
        expect(secondResource.token).toBe(firstResource.token + 1);
        expect(secondTexture).not.toBe(firstTexture);
        expect(firstTexture.destroyed).toBe(false);

        expect(cache.detach(owner)).toBe(true);
        expect(registry.collect(0)).toBe(3);
        expect(secondTexture.destroyed).toBe(true);
        expect(firstTexture.destroyed).toBe(false);
        expect(registry.collect(3)).toBe(3);
        expect(firstTexture.destroyed).toBe(true);
        expect(() => cache.resolve(owner)).toThrow('not prepared');
        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects empty plans and releases all retained records on destroy', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new ShadowAtlasResourceCache(registry);
        const planner = new ShadowAtlasPlanner();
        const empty = planner.build({ directional: [], spot: [], point: [] }, device.capabilities);
        expect(() => cache.prepare({}, empty)).toThrow('empty plan');

        const populated = planner.build(
            { directional: [{ owner: {}, width: 16, height: 16 }], spot: [], point: [] },
            device.capabilities
        );
        const owner = {};
        const resource = cache.prepare(owner, populated);
        const texture = registry.resolve(resource.texture);
        cache.destroy();
        expect(registry.diagnostics().pendingReleaseCount).toBe(2);
        expect(registry.collect(0)).toBe(3);
        expect(texture.destroyed).toBe(true);
        expect(() => cache.prepare(owner, populated)).toThrow('destroyed');
        registry.destroy();
        backend.destroy();
    });
});
