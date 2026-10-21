import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import type { RendererScene } from '../../../src/render/RendererCore';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import {
    RenderPipelineHost,
    type RenderPipelineHostLifecycle
} from '../../../src/render/internal/RenderPipelineHost';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => {
        resolve = complete;
    });
    return { promise, resolve };
}

function createRuntime() {
    return {
        name: 'host lifecycle test',
        record: vi.fn<RenderPipeline['record']>(),
        frameSubmitted: vi.fn<(frameIndex: number) => unknown>(),
        frameDiscarded: vi.fn<(frameIndex: number) => unknown>(),
        destroy: vi.fn<() => unknown>()
    };
}

function createFixture(backend = new FakeWebGLRHIBackend()) {
    const device = backend.createDevice();
    const camera = new PerspectiveCamera();
    const unreachable = (): never => {
        throw new Error('Unexpected allocation');
    };
    const lifecycle = {
        createPipelineRenderTarget: vi.fn(unreachable),
        createPipelineStorageBuffer: vi.fn(unreachable),
        warmupStorageGraphicsShaders: vi.fn(() => Promise.resolve()),
        createFrameContext: frameIndex =>
            createRenderGraphFrameContext({
                renderer: {} as RendererCore,
                rhi: device,
                frameIndex,
                camera,
                lightManager: new LightManager(),
                fog: null,
                viewport: { x: 0, y: 0, width: 1, height: 1, minDepth: 0, maxDepth: 1 }
            }),
        beginFrame: vi.fn(),
        completeFrame: vi.fn<RenderPipelineHostLifecycle['completeFrame']>(),
        failFrame: vi.fn(),
        endFrame: vi.fn(),
        createPipelineContext: vi.fn(() => ({}) as RenderPipelineContext),
        endPipelineInvocation: vi.fn()
    } satisfies RenderPipelineHostLifecycle;
    const host = new RenderPipelineHost(lifecycle);
    const record = (): void => {
        host.recordPipeline({} as RendererScene, camera, null, false);
    };
    return { backend, device, host, lifecycle, record };
}

describe('RenderPipelineHost initialization ownership', () => {
    it('rejects concurrent initialization before invoking a second factory', async () => {
        const fixture = createFixture();
        const runtime = createRuntime();
        const pending = deferred<RenderPipeline>();
        const initialization = fixture.host.initialize(
            { name: 'first', create: () => pending.promise },
            fixture.device.capabilities
        );
        const secondCreate = vi.fn(() => createRuntime());
        await expect(
            fixture.host.initialize(
                { name: 'second', create: secondCreate },
                fixture.device.capabilities
            )
        ).rejects.toThrow(/initializing/u);
        expect(secondCreate).not.toHaveBeenCalled();
        pending.resolve(runtime);
        await initialization;
        expect(fixture.host.initialized).toBe(true);
        fixture.host.destroy();
        expect(runtime.destroy).toHaveBeenCalledOnce();
        fixture.backend.destroy();
    });

    it('destroys a late factory result after cancellation without reviving the host', async () => {
        const fixture = createFixture();
        const runtime = createRuntime();
        const pending = deferred<RenderPipeline>();
        const initialization = fixture.host.initialize(
            { name: 'late', create: () => pending.promise },
            fixture.device.capabilities
        );
        fixture.host.destroy();
        pending.resolve(runtime);
        await expect(initialization).rejects.toThrow(/destroyed/u);
        expect(fixture.host.initialized).toBe(false);
        expect(runtime.destroy).toHaveBeenCalledOnce();
        fixture.host.destroy();
        expect(runtime.destroy).toHaveBeenCalledOnce();
        fixture.backend.destroy();
    });

    it('never destroys another host runtime when a cancelled factory returns its singleton', async () => {
        const owner = createFixture();
        const cancelled = createFixture();
        const runtime = createRuntime();
        await owner.host.initialize(
            { name: 'owner', create: () => runtime },
            owner.device.capabilities
        );
        const pending = deferred<RenderPipeline>();
        const initialization = cancelled.host.initialize(
            { name: 'cancelled', create: () => pending.promise },
            cancelled.device.capabilities
        );
        cancelled.host.destroy();
        Reflect.set(runtime, 'record', null);
        pending.resolve(runtime);
        await expect(initialization).rejects.toThrow(/already attached/u);
        expect(runtime.destroy).not.toHaveBeenCalled();
        owner.host.destroy();
        expect(runtime.destroy).toHaveBeenCalledOnce();
        owner.backend.destroy();
        cancelled.backend.destroy();
    });

    it('expires creation methods on both success and failure without reviving old leases', async () => {
        const fixture = createFixture();
        const contexts: RenderPipelineCreateContext[] = [];
        const failure = new Error('factory failed');
        await expect(
            fixture.host.initialize(
                {
                    name: 'failed creation',
                    create(context) {
                        contexts.push(context);
                        throw failure;
                    }
                },
                fixture.device.capabilities
            )
        ).rejects.toThrow(failure);
        const expired = contexts[0];
        if (expired === undefined) throw new Error('Expected failed creation context');
        await fixture.host.initialize(
            {
                name: 'retry',
                create(context) {
                    expect(() => expired.warmupStorageGraphicsShaders([])).toThrow(
                        /no longer active/u
                    );
                    contexts.push(context);
                    return createRuntime();
                }
            },
            fixture.device.capabilities
        );
        const completed = contexts[1];
        if (completed === undefined) throw new Error('Expected successful creation context');
        expect(() => completed.warmupStorageGraphicsShaders([])).toThrow(/no longer active/u);
        expect(fixture.lifecycle.warmupStorageGraphicsShaders).not.toHaveBeenCalled();
        fixture.host.destroy();
        fixture.backend.destroy();
    });

    it.each(['frameSubmitted', 'frameDiscarded', 'recordRenderGraphTimeline'])(
        'rejects an invalid optional %s hook during creation',
        async hook => {
            const fixture = createFixture();
            const runtime = createRuntime();
            Reflect.set(runtime, hook, 1);
            await expect(
                fixture.host.initialize(
                    { name: 'invalid hook', create: () => runtime },
                    fixture.device.capabilities
                )
            ).rejects.toThrow(`${hook} must be a function`);
            expect(runtime.destroy).toHaveBeenCalledOnce();
            fixture.host.destroy();
            fixture.backend.destroy();
        }
    );
});

describe('RenderPipelineHost synchronous lifecycle', () => {
    it('discards temporal state while completing ownership after a timeline observer loses the device', async () => {
        const fixture = createFixture(new FakeWebGPURHIBackend());
        const runtime = {
            ...createRuntime(),
            usesRenderGraphTimeline: true,
            recordRenderGraphTimeline: () => {
                fixture.device.destroy();
            }
        };
        await fixture.host.initialize(
            { name: runtime.name, create: () => runtime },
            fixture.device.capabilities
        );
        expect(() => {
            fixture.host.execute(fixture.record);
        }).toThrow();
        expect(runtime.frameSubmitted).not.toHaveBeenCalled();
        expect(runtime.frameDiscarded).toHaveBeenCalledExactlyOnceWith(0);
        expect(fixture.lifecycle.completeFrame).toHaveBeenCalledOnce();
        expect(fixture.lifecycle.endFrame).toHaveBeenLastCalledWith(false);
        const execution = fixture.lifecycle.completeFrame.mock.calls[0]?.[1];
        if (execution === undefined) throw new Error('Expected retained execution ownership');
        expect(execution.submission.status).toBe('failed');
        await expect(execution.submission.done).rejects.toThrow();
        fixture.host.destroy();
        fixture.backend.destroy();
    });

    it('attempts renderer failure cleanup even when runtime discard also throws', async () => {
        const fixture = createFixture();
        const runtime = createRuntime();
        const recordFailure = new Error('record failed');
        const discardFailure = new Error('discard failed');
        const cleanupFailure = new Error('renderer cleanup failed');
        runtime.record.mockImplementationOnce(() => {
            throw recordFailure;
        });
        runtime.frameDiscarded.mockImplementationOnce(() => {
            throw discardFailure;
        });
        vi.mocked(fixture.lifecycle.failFrame).mockImplementationOnce(() => {
            throw cleanupFailure;
        });
        await fixture.host.initialize(
            { name: runtime.name, create: () => runtime },
            fixture.device.capabilities
        );
        let failure: unknown;
        try {
            fixture.host.execute(fixture.record);
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(AggregateError);
        if (!(failure instanceof AggregateError)) throw new Error('Expected aggregate failure');
        expect(failure.errors).toEqual([recordFailure, discardFailure, cleanupFailure]);
        expect(fixture.lifecycle.failFrame).toHaveBeenCalledWith(recordFailure);
        expect(fixture.lifecycle.endFrame).toHaveBeenLastCalledWith(false);
        expect(() => {
            fixture.host.execute(fixture.record);
        }).not.toThrow();
        expect(fixture.lifecycle.endFrame).toHaveBeenLastCalledWith(true);
        fixture.host.destroy();
        fixture.backend.destroy();
    });

    it('observes an invalid rejected record promise and prevents submission', async () => {
        const fixture = createFixture();
        const runtime = createRuntime();
        runtime.record.mockImplementationOnce(() =>
            Promise.reject(new Error('late record rejection'))
        );
        await fixture.host.initialize(
            { name: runtime.name, create: () => runtime },
            fixture.device.capabilities
        );
        expect(() => {
            fixture.host.execute(fixture.record);
        }).toThrow(/record\(\) must be synchronous/u);
        expect(runtime.frameSubmitted).not.toHaveBeenCalled();
        expect(runtime.frameDiscarded).toHaveBeenCalledOnce();
        await Promise.resolve();
        fixture.host.destroy();
        fixture.backend.destroy();
    });

    it('rejects asynchronous submission hooks after completing the submitted lifecycle', async () => {
        const fixture = createFixture();
        const runtime = createRuntime();
        runtime.frameSubmitted.mockImplementationOnce(() =>
            Promise.reject(new Error('late submission rejection'))
        );
        await fixture.host.initialize(
            { name: runtime.name, create: () => runtime },
            fixture.device.capabilities
        );
        expect(() => {
            fixture.host.execute(fixture.record);
        }).toThrow(/frameSubmitted\(\) must be synchronous/u);
        expect(fixture.lifecycle.completeFrame).toHaveBeenCalledOnce();
        expect(fixture.lifecycle.endFrame).toHaveBeenLastCalledWith(true);
        expect(runtime.frameDiscarded).not.toHaveBeenCalled();
        await Promise.resolve();
        expect(() => {
            fixture.host.execute(fixture.record);
        }).not.toThrow();
        fixture.host.destroy();
        fixture.backend.destroy();
    });

    it('observes asynchronous discard and destroy failures without skipping cleanup', async () => {
        const fixture = createFixture();
        const runtime = createRuntime();
        runtime.record.mockImplementationOnce(() => {
            throw new Error('record failure');
        });
        runtime.frameDiscarded.mockImplementationOnce(() =>
            Promise.reject(new Error('late discard rejection'))
        );
        runtime.destroy.mockImplementationOnce(() =>
            Promise.reject(new Error('late destroy rejection'))
        );
        await fixture.host.initialize(
            { name: runtime.name, create: () => runtime },
            fixture.device.capabilities
        );
        expect(() => {
            fixture.host.execute(fixture.record);
        }).toThrow(AggregateError);
        expect(fixture.lifecycle.failFrame).toHaveBeenCalledOnce();
        expect(fixture.lifecycle.endFrame).toHaveBeenLastCalledWith(false);
        expect(() => {
            fixture.host.destroy();
        }).toThrow(AggregateError);
        expect(() => {
            fixture.host.destroy();
        }).not.toThrow();
        expect(runtime.destroy).toHaveBeenCalledOnce();
        await Promise.resolve();
        fixture.backend.destroy();
    });
});
