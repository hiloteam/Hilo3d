import { describe, expect, it } from 'vitest';
import { ScriptableRenderPipelineResources } from '../../../src/render/internal/ScriptableRenderPipelineContext';
import { RHITextureUsage } from '../../../src/render/rhi/core';
import type { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

const HISTORY_RECIPE = Object.freeze({
    label: 'transactional history',
    width: 8,
    height: 4,
    depthOrArrayLayers: 1,
    mipLevelCount: 1,
    sampleCount: 1 as const,
    dimension: '2d' as const,
    viewDimension: '2d' as const,
    format: 'rgba8unorm' as const,
    usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT,
    viewFormats: Object.freeze([]),
    bufferCount: 3 as const
});

describe('ScriptableRenderPipelineResources history', () => {
    it('rolls back failed rotation and invalidates rebuilt device generations', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new ScriptableRenderPipelineResources();
        const targets = {} as unknown as RenderTargetResourceCache;
        const runtimeOwner = Object.freeze({});
        const key = Object.freeze({});

        resources.beginFrame(0, registry);
        const first = resources.prepareHistoryTexture(
            runtimeOwner,
            key,
            0,
            registry,
            HISTORY_RECIPE
        );
        expect(first.writeIndex).toBe(0);
        expect(first.initialized).toEqual([false, false, false]);
        resources.noteHistoryTextureWrite(first.state);
        resources.endFrame(targets, registry, true);

        resources.beginFrame(1, registry);
        const failed = resources.prepareHistoryTexture(
            runtimeOwner,
            key,
            1,
            registry,
            HISTORY_RECIPE
        );
        expect(failed.writeIndex).toBe(1);
        expect(failed.initialized).toEqual([true, false, false]);
        resources.noteHistoryTextureWrite(failed.state);
        resources.endFrame(targets, registry, false);

        resources.beginFrame(2, registry);
        const retried = resources.prepareHistoryTexture(
            runtimeOwner,
            key,
            2,
            registry,
            HISTORY_RECIPE
        );
        expect(retried.writeIndex).toBe(1);
        expect(retried.initialized).toEqual([true, false, false]);
        resources.noteHistoryTextureWrite(retried.state);
        resources.endFrame(targets, registry, true);

        const replacementDevice = backend.createDevice();
        registry.recover(replacementDevice);
        resources.beginFrame(3, registry);
        const recovered = resources.prepareHistoryTexture(
            runtimeOwner,
            key,
            3,
            registry,
            HISTORY_RECIPE
        );
        expect(recovered.writeIndex).toBe(0);
        expect(recovered.initialized).toEqual([false, false, false]);
        expect(recovered.generation).toBe(retried.generation + 1);
        resources.endFrame(targets, registry, false);

        resources.beginFrame(4, registry);
        expect(resources.releaseHistoryTexture(runtimeOwner, key)).toBe(true);
        resources.endFrame(targets, registry, true);
        expect(registry.collect(4)).toBe(3);
        resources.releasePersistentTargets(targets, registry);
        registry.destroy();
        backend.destroy();
    });

    it('commits an unwritten descriptor revision as wholly invalid history', () => {
        const backend = new FakeWebGPURHIBackend();
        const registry = new ResourceRegistry(backend.createDevice());
        const resources = new ScriptableRenderPipelineResources();
        const targets = {} as unknown as RenderTargetResourceCache;
        const runtimeOwner = Object.freeze({});
        const key = Object.freeze({});

        resources.beginFrame(0, registry);
        const initial = resources.prepareHistoryTexture(
            runtimeOwner,
            key,
            0,
            registry,
            HISTORY_RECIPE
        );
        resources.noteHistoryTextureWrite(initial.state);
        resources.endFrame(targets, registry, true);

        resources.beginFrame(1, registry);
        const revised = resources.prepareHistoryTexture(runtimeOwner, key, 1, registry, {
            ...HISTORY_RECIPE,
            width: 16
        });
        expect(revised.writeIndex).toBe(0);
        expect(revised.initialized).toEqual([false, false, false]);
        resources.endFrame(targets, registry, true);

        resources.beginFrame(2, registry);
        const next = resources.prepareHistoryTexture(runtimeOwner, key, 2, registry, {
            ...HISTORY_RECIPE,
            width: 16
        });
        expect(next.writeIndex).toBe(0);
        expect(next.initialized).toEqual([false, false, false]);
        resources.endFrame(targets, registry, false);

        resources.releasePersistentTargets(targets, registry);
        registry.destroy();
        backend.destroy();
    });
});
