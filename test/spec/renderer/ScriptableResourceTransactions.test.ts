import { describe, expect, it, vi } from 'vitest';
import {
    ScriptableRenderPipelineResources,
    type HistoryTextureRecipe
} from '../../../src/render/internal/ScriptableRenderPipelineResources';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { RHITextureUsage } from '../../../src/render/rhi/core';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

const historyRecipe: Readonly<HistoryTextureRecipe> = {
    label: 'resource transaction history',
    width: 4,
    height: 4,
    depthOrArrayLayers: 1,
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: '2d',
    viewDimension: '2d',
    format: 'rgba8unorm',
    usage: RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.RENDER_ATTACHMENT,
    viewFormats: [],
    bufferCount: 3
};

function fixture(): {
    backend: FakeWebGPURHIBackend;
    registry: ResourceRegistry;
    targets: RenderTargetResourceCache;
    resources: ScriptableRenderPipelineResources;
} {
    const backend = new FakeWebGPURHIBackend();
    const registry = new ResourceRegistry(backend.createDevice());
    return {
        backend,
        registry,
        targets: new RenderTargetResourceCache(registry),
        resources: new ScriptableRenderPipelineResources()
    };
}

describe('scriptable resource transactions', () => {
    it('freezes a cached persistent target descriptor at the first acquisition in each frame', () => {
        const { backend, registry, targets, resources } = fixture();
        const owner = {};
        const key = {};
        const descriptor = { width: 4, height: 4, colorFormats: ['rgba8unorm'] as const };
        try {
            resources.beginFrame(0, registry);
            const initial = resources.preparePersistentTarget(owner, key, 0, targets, descriptor);
            resources.endFrame(targets, registry, true);

            resources.beginFrame(1, registry);
            expect(resources.preparePersistentTarget(owner, key, 1, targets, descriptor)).toBe(
                initial
            );
            expect(() =>
                resources.preparePersistentTarget(owner, key, 1, targets, {
                    ...descriptor,
                    width: 8
                })
            ).toThrow(/multiple descriptors in one frame/u);
            expect(targets.metrics.size).toBe(1);
            resources.endFrame(targets, registry, false);

            resources.beginFrame(2, registry);
            const resized = resources.preparePersistentTarget(owner, key, 2, targets, {
                ...descriptor,
                width: 8
            });
            expect(resized.width).toBe(8);
            expect(() =>
                resources.preparePersistentTarget(owner, key, 2, targets, descriptor)
            ).toThrow(/multiple descriptors in one frame/u);
            resources.endFrame(targets, registry, true);
            resources.releasePersistentTargets(targets, registry);
        } finally {
            registry.destroy();
            backend.destroy();
        }
    });

    it.each(['release', 'resize', 'destroy'] as const)(
        'retains and retries history handle cleanup after a %s failure',
        operation => {
            const { backend, registry, targets, resources } = fixture();
            const owner = {};
            const key = {};
            try {
                resources.beginFrame(0, registry);
                resources.prepareHistoryTexture(owner, key, 0, registry, historyRecipe);
                resources.endFrame(targets, registry, true);

                const release = registry.release.bind(registry);
                const failure = new Error('history release failed');
                vi.spyOn(registry, 'release').mockImplementationOnce(() => {
                    throw failure;
                });
                if (operation === 'destroy') {
                    expect(() => {
                        resources.releasePersistentTargets(targets, registry);
                    }).toThrow(AggregateError);
                } else {
                    resources.beginFrame(1, registry);
                    if (operation === 'resize') {
                        resources.prepareHistoryTexture(owner, key, 1, registry, {
                            ...historyRecipe,
                            width: 8
                        });
                    } else expect(resources.releaseHistoryTexture(owner, key)).toBe(true);
                    expect(() => {
                        resources.endFrame(targets, registry, true);
                    }).toThrow(AggregateError);
                }
                // All later handles are released even when the first release fails.
                expect(registry.collect(1)).toBe(2);
                vi.spyOn(registry, 'release').mockImplementation(release);
                if (operation === 'destroy') {
                    resources.releasePersistentTargets(targets, registry);
                } else {
                    // Deferred cleanup must run even when this frame acquires no resources.
                    resources.beginFrame(2, registry);
                    resources.endFrame(targets, registry, true);
                }
                expect(registry.collect(2)).toBe(1);
                expect(registry.diagnostics().trackedResourceCount).toBe(
                    operation === 'resize' ? 3 : 0
                );
                resources.releasePersistentTargets(targets, registry);
                registry.collect(2);
                expect(registry.diagnostics().trackedResourceCount).toBe(0);
            } finally {
                registry.destroy();
                backend.destroy();
            }
        }
    );

    it('preserves inactive histories while rolling back another history acquisition and release', () => {
        const { backend, registry, targets, resources } = fixture();
        const owner = {};
        const retainedKey = {};
        const releaseKey = {};
        try {
            resources.beginFrame(0, registry);
            const retained = resources.prepareHistoryTexture(
                owner,
                retainedKey,
                0,
                registry,
                historyRecipe
            );
            resources.prepareHistoryTexture(owner, releaseKey, 0, registry, historyRecipe);
            resources.endFrame(targets, registry, true);
            const generation = retained.state.generation;

            resources.beginFrame(1, registry);
            resources.prepareHistoryTexture(owner, {}, 1, registry, historyRecipe);
            expect(resources.releaseHistoryTexture(owner, releaseKey)).toBe(true);
            resources.endFrame(targets, registry, false);
            expect(registry.diagnostics().trackedResourceCount).toBe(6);

            resources.beginFrame(2, registry);
            const reacquired = resources.prepareHistoryTexture(
                owner,
                retainedKey,
                2,
                registry,
                historyRecipe
            );
            expect(reacquired.handles).toBe(retained.handles);
            expect(reacquired.generation).toBe(generation);
            expect(resources.releaseHistoryTexture(owner, releaseKey)).toBe(true);
            resources.endFrame(targets, registry, true);
            expect(registry.collect(2)).toBe(3);
            resources.releasePersistentTargets(targets, registry);
        } finally {
            registry.destroy();
            backend.destroy();
        }
    });

    it('cleans every allocated history slot when allocation and one destructor both fail', () => {
        const { backend, registry, targets, resources } = fixture();
        const register = registry.registerTexture.bind(registry);
        const allocationFailure = new Error('history allocation failed');
        const cleanupFailure = new Error('history destruction failed');
        let registered = 0;
        vi.spyOn(registry, 'registerTexture').mockImplementation(descriptor => {
            if (registered === 2) throw allocationFailure;
            const handle = register(descriptor);
            if (registered++ === 0) {
                const texture = registry.resolve(handle);
                const destroy = texture.destroy.bind(texture);
                vi.spyOn(texture, 'destroy').mockImplementation(() => {
                    destroy();
                    throw cleanupFailure;
                });
            }
            return handle;
        });
        try {
            resources.beginFrame(0, registry);
            expect(() =>
                resources.prepareHistoryTexture({}, {}, 0, registry, historyRecipe)
            ).toThrow(
                expect.objectContaining({
                    cause: allocationFailure,
                    errors: [allocationFailure, cleanupFailure]
                })
            );
            expect(registry.diagnostics().trackedResourceCount).toBe(0);
            resources.endFrame(targets, registry, false);
        } finally {
            registry.destroy();
            backend.destroy();
        }
    });
});
