import { describe, expect, it } from 'vitest';
import { RendererDiagnostics } from '../../../src/render/RendererDiagnostics';
import { RHICacheCounter, RHICacheCounterContinuation } from '../../../src/render/rhi/core';

describe('RendererDiagnostics', () => {
    it('tracks native object lifecycle totals and independent high-water marks', () => {
        const diagnostics = new RendererDiagnostics();

        diagnostics.recordNativeObjectCreated('buffer', 3);
        diagnostics.recordNativeObjectDestroyed('buffer');
        diagnostics.recordNativeObjectCreated('buffer', 2);
        diagnostics.recordNativeObjectCreated('texture');
        diagnostics.recordNativeObjectDestroyed('buffer', 4);

        const snapshot = diagnostics.snapshot();
        expect(snapshot.nativeObjects.buffer).toEqual({
            created: 5,
            destroyed: 5,
            live: 0,
            highWater: 4
        });
        expect(snapshot.nativeObjects.texture).toEqual({
            created: 1,
            destroyed: 0,
            live: 1,
            highWater: 1
        });
        expect(snapshot.nativeObjects.pipeline).toEqual({
            created: 0,
            destroyed: 0,
            live: 0,
            highWater: 0
        });
    });

    it('rejects lifecycle underflow instead of reporting a negative live count', () => {
        const diagnostics = new RendererDiagnostics();
        diagnostics.recordNativeObjectCreated('program');

        expect(() => {
            diagnostics.recordNativeObjectDestroyed('program', 2);
        }).toThrow('Cannot destroy more native objects than are live');
        expect(diagnostics.snapshot().nativeObjects.program).toEqual({
            created: 1,
            destroyed: 0,
            live: 1,
            highWater: 1
        });
    });

    it('keeps creation-only counters exact without inventing lifecycle totals', () => {
        const diagnostics = new RendererDiagnostics();

        diagnostics.recordNativeObjectCreatedOnly('sampler', 2);
        diagnostics.recordNativeObjectCreatedOnly('sampler');

        expect(diagnostics.snapshot().nativeObjects.sampler).toEqual({
            created: 3,
            destroyed: null,
            live: null,
            highWater: null
        });
        expect(() => {
            diagnostics.recordNativeObjectCreated('sampler');
        }).toThrow('Cannot mix complete and creation-only');
        expect(() => {
            diagnostics.recordNativeObjectDestroyed('sampler');
        }).toThrow('Cannot mix complete and creation-only');
    });

    it('tracks cache outcomes, current size, and lifetime high-water size separately', () => {
        const diagnostics = new RendererDiagnostics();

        diagnostics.recordCacheMiss('pipeline', 2);
        diagnostics.recordCacheHit('pipeline', 7);
        diagnostics.setCacheSize('pipeline', 4);
        diagnostics.recordCacheEviction('pipeline');
        diagnostics.setCacheSize('pipeline', 3);
        diagnostics.setCacheSize('pipeline', 2);

        expect(diagnostics.snapshot().caches.pipeline).toEqual({
            hits: 7,
            misses: 2,
            evictions: 1,
            size: 2,
            highWater: 4
        });
    });

    it('synchronizes reusable cumulative cache providers without changing frame counters', () => {
        const diagnostics = new RendererDiagnostics();
        const cache = new RHICacheCounter();

        cache.recordMiss();
        cache.recordInsertion();
        diagnostics.synchronizeCache('pipeline', cache);
        cache.recordHit();
        cache.recordReplacement();
        diagnostics.synchronizeCache('pipeline', cache);

        expect(diagnostics.snapshot().caches.pipeline).toEqual({
            hits: 1,
            misses: 1,
            evictions: 1,
            size: 1,
            highWater: 1
        });
        expect(diagnostics.snapshot().frame.draws).toBe(0);
        expect(() => {
            diagnostics.synchronizeCache('pipeline', {
                hits: 0,
                misses: 1,
                evictions: 1,
                size: 1,
                highWater: 1
            });
        }).toThrow(/cannot move backwards/u);
    });

    it('preserves cumulative counters across cache-provider generation changes', () => {
        const firstGeneration = new RHICacheCounter();
        firstGeneration.recordMiss();
        firstGeneration.recordInsertion();
        firstGeneration.recordHit();
        const continuation = new RHICacheCounterContinuation(firstGeneration);

        const secondGeneration = new RHICacheCounter();
        continuation.rebind(secondGeneration);
        expect(continuation).toMatchObject({
            hits: 1,
            misses: 1,
            evictions: 1,
            size: 0,
            highWater: 1
        });

        secondGeneration.recordMiss();
        secondGeneration.recordInsertion();
        secondGeneration.recordHit();
        expect(continuation).toMatchObject({
            hits: 2,
            misses: 2,
            evictions: 1,
            size: 1,
            highWater: 1
        });
        firstGeneration.clear();
        expect(continuation.evictions).toBe(1);
    });

    it('reports unavailable cache metrics as null and rejects fabricated observations', () => {
        const diagnostics = new RendererDiagnostics();

        diagnostics.markCacheHitOnly('pipeline');
        diagnostics.markCacheHitOnly('pipeline');
        diagnostics.recordCacheHit('pipeline', 3);
        diagnostics.markCacheUnavailable('buffer');

        expect(diagnostics.snapshot().caches.pipeline).toEqual({
            hits: 3,
            misses: null,
            evictions: null,
            size: null,
            highWater: null
        });
        expect(diagnostics.snapshot().caches.buffer).toEqual({
            hits: null,
            misses: null,
            evictions: null,
            size: null,
            highWater: null
        });
        expect(() => {
            diagnostics.recordCacheMiss('pipeline');
        }).toThrow('diagnostics are unavailable');
        expect(() => {
            diagnostics.recordCacheHit('buffer');
        }).toThrow('diagnostics are unavailable');
    });

    it('resets only frame-local counters', () => {
        const diagnostics = new RendererDiagnostics();
        diagnostics.recordNativeObjectCreated('vertexArray', 2);
        diagnostics.recordCacheHit('vertexArray');
        diagnostics.setCacheSize('vertexArray', 2);
        diagnostics.recordDraw(8);
        diagnostics.recordIndirectDraw(2);
        diagnostics.recordDispatch(4);
        diagnostics.recordDispatchedWorkgroup(96);
        diagnostics.recordBufferClear(3);
        diagnostics.recordCommand(12);
        diagnostics.recordPass(3);
        diagnostics.recordStateChange(5);
        diagnostics.recordComputePipelineSwitch(2);
        diagnostics.recordComputeBindGroupSwitch(3);
        diagnostics.recordUpload(2);
        diagnostics.recordSubmission();
        diagnostics.recordArenaGrowth(2);
        diagnostics.recordShadowScheduling({
            requestedSlices: 5,
            updatedSlices: 3,
            deferredSlices: 2,
            requestedPages: 12,
            updatedPages: 8,
            deferredPages: 4,
            residentPages: 20,
            budgetOverflowPages: 1
        });
        diagnostics.recordShadowScheduling({
            requestedSlices: 2,
            updatedSlices: 1,
            deferredSlices: 1,
            requestedPages: 3,
            updatedPages: 2,
            deferredPages: 1,
            residentPages: 24,
            budgetOverflowPages: 2
        });

        expect(diagnostics.snapshot().frame).toEqual({
            draws: 8,
            indirectDraws: 2,
            dispatches: 4,
            dispatchedWorkgroups: 96,
            bufferClears: 3,
            commands: 12,
            passes: 3,
            stateChanges: 5,
            computePipelineSwitches: 2,
            computeBindGroupSwitches: 3,
            uploads: 2,
            submissions: 1,
            arenaGrowths: 2,
            shadowRequestedSlices: 7,
            shadowUpdatedSlices: 4,
            shadowDeferredSlices: 3,
            shadowRequestedPages: 15,
            shadowUpdatedPages: 10,
            shadowDeferredPages: 5,
            shadowResidentPages: 24,
            shadowBudgetOverflowPages: 3
        });

        diagnostics.resetFrame();

        const snapshot = diagnostics.snapshot();
        expect(snapshot.frame).toEqual({
            draws: 0,
            indirectDraws: 0,
            dispatches: 0,
            dispatchedWorkgroups: 0,
            bufferClears: 0,
            commands: 0,
            passes: 0,
            stateChanges: 0,
            computePipelineSwitches: 0,
            computeBindGroupSwitches: 0,
            uploads: 0,
            submissions: 0,
            arenaGrowths: 0,
            shadowRequestedSlices: 0,
            shadowUpdatedSlices: 0,
            shadowDeferredSlices: 0,
            shadowRequestedPages: 0,
            shadowUpdatedPages: 0,
            shadowDeferredPages: 0,
            shadowResidentPages: 0,
            shadowBudgetOverflowPages: 0
        });
        expect(snapshot.nativeObjects.vertexArray.live).toBe(2);
        expect(snapshot.caches.vertexArray).toMatchObject({ hits: 1, size: 2, highWater: 2 });
    });

    it('returns frozen snapshots isolated from later counter updates', () => {
        const diagnostics = new RendererDiagnostics();
        diagnostics.recordNativeObjectCreated('texture');
        diagnostics.recordCacheMiss('texture');
        diagnostics.setCacheSize('texture', 1);
        diagnostics.recordDraw();

        const first = diagnostics.snapshot();
        diagnostics.recordNativeObjectCreated('texture');
        diagnostics.recordCacheHit('texture');
        diagnostics.setCacheSize('texture', 2);
        diagnostics.recordDraw(2);
        const second = diagnostics.snapshot();

        expect(first.nativeObjects.texture.live).toBe(1);
        expect(first.caches.texture).toMatchObject({ hits: 0, size: 1, highWater: 1 });
        expect(first.frame.draws).toBe(1);
        expect(second.nativeObjects.texture.live).toBe(2);
        expect(second.caches.texture).toMatchObject({ hits: 1, size: 2, highWater: 2 });
        expect(second.frame.draws).toBe(3);
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(first.nativeObjects.texture)).toBe(true);
        expect(Object.isFrozen(first.caches.texture)).toBe(true);
        expect(Object.isFrozen(first.frame)).toBe(true);
    });

    it('requires positive safe increments and non-negative safe cache sizes', () => {
        const diagnostics = new RendererDiagnostics();

        expect(() => {
            diagnostics.recordDraw(0);
        }).toThrow('positive safe integers');
        expect(() => {
            diagnostics.recordCacheHit('buffer', Number.NaN);
        }).toThrow('positive safe integers');
        expect(() => {
            diagnostics.recordNativeObjectCreated('buffer', 1.5);
        }).toThrow('positive safe integers');
        expect(() => {
            diagnostics.setCacheSize('buffer', -1);
        }).toThrow('non-negative safe integers');
    });
});
