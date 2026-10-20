import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Node from '../../../src/core/Node';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import {
    ForwardRenderPipelineFactory,
    type ForwardRenderPipelineFeature,
    type ForwardRenderPipelineFeatureRuntime
} from '../../../src/render/pipeline/ForwardRenderPipeline';
import { createRenderPipelineCapabilities } from '../../../src/render/pipeline/RenderPipelineCapabilities';
import { acquireRenderPassParameters } from '../../../src/render/pipeline/RenderPassParameterPool';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineCreateContext
} from '../../../src/render/pipeline/RenderPipeline';
import type {
    CullingResultsHandle,
    RendererListHandle
} from '../../../src/render/pipeline/RendererList';
import type { RenderGraphPassHandle } from '../../../src/render/pipeline/ScriptableRenderGraph';
import type { RenderGraphTimelineSnapshot } from '../../../src/render/graph/RenderGraphTimeline';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

const TIMELINE: Readonly<RenderGraphTimelineSnapshot> = {
    frameIndex: 7,
    recordDurationMs: 0,
    compileDurationMs: 0,
    prepareDurationMs: 0,
    executeDurationMs: 0,
    gpuStatus: 'unavailable',
    passes: [],
    resources: []
};

function unused(): never {
    throw new Error('Unexpected resource operation in Forward callback fixture');
}

function emptyRuntime(): ForwardRenderPipelineFeatureRuntime {
    return {
        record(): void {
            /* No graph work in this callback fixture. */
        },
        destroy(): void {
            /* No owned resources. */
        }
    };
}

function feature(
    name: string,
    runtime: ForwardRenderPipelineFeatureRuntime
): ForwardRenderPipelineFeature {
    return {
        name,
        injectionPoint: 'before-output',
        requirements: { sampledSceneColor: false, sampledDepth: false },
        create: () => runtime
    };
}

type Notification = 'frameSubmitted' | 'frameDiscarded' | 'recordRenderGraphTimeline';

function notify(pipeline: RenderPipeline, notification: Notification): void | Promise<void> {
    if (notification === 'recordRenderGraphTimeline')
        return pipeline.recordRenderGraphTimeline?.(TIMELINE);
    else pipeline[notification]?.(7);
}

describe('Forward feature callback lifecycle', () => {
    let backend: FakeWebGLRHIBackend;
    let creation: RenderPipelineCreateContext;
    let pipelines: RenderPipeline[];

    beforeEach(() => {
        backend = new FakeWebGLRHIBackend();
        creation = {
            capabilities: createRenderPipelineCapabilities(backend.createDevice().capabilities),
            createRenderTarget: unused,
            createStorageBuffer: unused,
            warmupStorageGraphicsShaders: unused
        };
        pipelines = [];
    });

    afterEach(() => {
        for (const pipeline of pipelines) pipeline.destroy();
        backend.destroy();
    });

    function create(features: readonly ForwardRenderPipelineFeature[]): RenderPipeline {
        const pipeline = new ForwardRenderPipelineFactory({ features }).create(creation);
        pipelines.push(pipeline);
        return pipeline;
    }

    function recordContext(): RenderPipelineContext {
        const owner = {};
        return {
            frameIndex: 7,
            scene: new Node(),
            camera: new PerspectiveCamera(),
            viewport: [0, 0, 4, 4],
            clearColor: { r: 0, g: 0, b: 0, a: 1 },
            capabilities: creation.capabilities,
            useLogDepth: false,
            output: {
                kind: 'render-target',
                width: 4,
                height: 4,
                sampleCount: 1,
                colorAttachmentCount: 0,
                colorFormat: unused,
                colorAttachment: unused,
                depthStencilFormat: null,
                depthStencilAttachment: null
            },
            recordView: unused,
            prepareScene: unused,
            cull: () => 1 as CullingResultsHandle,
            createRendererList: () => 2 as RendererListHandle,
            createOrderedRendererList: unused,
            recordShadows: () => null,
            acquirePassParameters: pool => acquireRenderPassParameters(pool, owner, 7),
            writeStorageBuffer: unused,
            graph: {
                createTexture: unused,
                createTextureView: unused,
                createBuffer: unused,
                importStorageBuffer: unused,
                importTexture: unused,
                importRenderTarget: unused,
                acquirePersistentTarget: unused,
                acquireHistoryTexture: unused,
                invalidateHistoryTexture: unused,
                releaseHistoryTexture: unused,
                releasePersistentTarget: unused,
                importOutput: () => ({
                    width: 4,
                    height: 4,
                    sampleCount: 1,
                    colorAttachmentCount: 0,
                    color: unused,
                    depthStencil: null
                }),
                addPass: () => 3 as RenderGraphPassHandle
            }
        };
    }

    it.each(['frameSubmitted', 'frameDiscarded', 'recordRenderGraphTimeline'] as const)(
        'finishes %s notifications and reports all failures',
        notification => {
            const calls: string[] = [];
            const failures = [new Error('first failure'), new Error('third failure')] as const;
            const features = ['first', 'second', 'third'].map((name, index) => {
                const runtime = emptyRuntime();
                runtime[notification] = (): void => {
                    calls.push(name);
                    if (index !== 1) throw failures[index === 0 ? 0 : 1];
                };
                return feature(name, runtime);
            });
            const pipeline = create(features);
            expect(() => {
                void notify(pipeline, notification);
            }).toThrow(expect.objectContaining({ errors: failures }));
            expect(calls).toEqual(['first', 'second', 'third']);
        }
    );

    it.each(['frameSubmitted', 'frameDiscarded'] as const)(
        'rejects async %s without skipping later features or leaking the rejection',
        async notification => {
            const later = vi.fn();
            const invalid = emptyRuntime();
            Object.defineProperty(invalid, notification, {
                value: (): Promise<void> => Promise.reject(new Error('late failure'))
            });
            const valid = emptyRuntime();
            valid[notification] = later;
            const pipeline = create([feature('async', invalid), feature('later', valid)]);
            expect(() => {
                void notify(pipeline, notification);
            }).toThrow(AggregateError);
            expect(later).toHaveBeenCalledOnce();
            await Promise.resolve();
        }
    );

    it('waits for every asynchronous timeline observer and reports mixed failures', async () => {
        const calls: string[] = [];
        const synchronousFailure = new Error('synchronous observer failed');
        const asynchronousFailure = new Error('asynchronous observer failed');
        let finishObserver: (() => void) | undefined;
        const completion = new Promise<void>(resolve => {
            finishObserver = resolve;
        });
        const pipeline = create([
            feature('sync failure', {
                ...emptyRuntime(),
                recordRenderGraphTimeline(): void {
                    calls.push('sync');
                    throw synchronousFailure;
                }
            }),
            feature('async failure', {
                ...emptyRuntime(),
                recordRenderGraphTimeline(): Promise<void> {
                    calls.push('async');
                    return Promise.reject(asynchronousFailure);
                }
            }),
            feature('completion', {
                ...emptyRuntime(),
                recordRenderGraphTimeline(): Promise<void> {
                    calls.push('completion');
                    return completion;
                }
            })
        ]);
        const result = notify(pipeline, 'recordRenderGraphTimeline');
        expect(calls).toEqual(['sync', 'async', 'completion']);
        const rejection = expect(result).rejects.toEqual(
            expect.objectContaining({ errors: [synchronousFailure, asynchronousFailure] })
        );
        const settled = vi.fn();
        const settlement = Promise.resolve(result).then(settled, settled);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(settled).not.toHaveBeenCalled();
        finishObserver?.();
        await rejection;
        await settlement;
    });

    it('captures notification callbacks once and preserves their runtime receiver', () => {
        function original(this: { count: number }): void {
            this.count++;
        }
        const runtime = {
            ...emptyRuntime(),
            count: 0,
            frameSubmitted: original
        };
        let reads = 0;
        Object.defineProperty(runtime, 'frameSubmitted', {
            configurable: true,
            get(): typeof original {
                reads++;
                return original;
            }
        });
        const pipeline = create([feature('snapshot', runtime)]);
        const creationReads = reads;
        Object.defineProperty(runtime, 'frameSubmitted', { get: unused });
        pipeline.frameSubmitted?.(7);
        pipeline.frameSubmitted?.(8);
        expect(runtime.count).toBe(2);
        expect(reads).toBe(creationReads);
    });

    it('evaluates captured requirement hooks each invocation in feature declaration order', () => {
        const calls: string[] = [];
        const features = ['first', 'second'].map(name =>
            feature(name, {
                ...emptyRuntime(),
                requiresSampledDepth(): boolean {
                    calls.push(`${name}:depth`);
                    return false;
                },
                requiresSplitScene(): boolean {
                    calls.push(`${name}:split`);
                    return false;
                }
            })
        );
        const pipeline = create(features);
        const context = recordContext();
        pipeline.record(context);
        pipeline.record(context);
        expect(calls).toEqual([
            'first:depth',
            'first:split',
            'second:depth',
            'second:split',
            'first:depth',
            'first:split',
            'second:depth',
            'second:split'
        ]);
    });

    it('captures the scene scale callback but reevaluates its current value each invocation', () => {
        let scale = 1;
        const runtime = { ...emptyRuntime(), getSceneScale: () => scale };
        const pipeline = create([feature('dynamic scale', runtime)]);
        Object.defineProperty(runtime, 'getSceneScale', { get: unused });
        const context = recordContext();
        pipeline.record(context);
        scale = 0;
        expect(() => pipeline.record(context)).toThrow(/scene scale/u);
    });

    it('finishes reverse destruction when one feature throws and destroys each feature once', () => {
        const calls: string[] = [];
        const first = {
            ...emptyRuntime(),
            destroy(): void {
                calls.push('first');
            }
        };
        const second = {
            ...emptyRuntime(),
            destroy(): void {
                calls.push('second');
                throw new Error('destroy failed');
            }
        };
        const pipeline = create([feature('first', first), feature('second', second)]);
        expect(() => {
            pipeline.destroy();
        }).toThrow(AggregateError);
        expect(calls).toEqual(['second', 'first']);
        pipeline.destroy();
        expect(calls).toHaveLength(2);
    });

    it('rejects asynchronous destruction without skipping cleanup or leaking rejection', async () => {
        const destroy = vi.fn();
        const invalid = emptyRuntime();
        Object.defineProperty(invalid, 'destroy', {
            value: (): Promise<void> => Promise.reject(new Error('late destroy failure'))
        });
        const pipeline = create([
            feature('earlier cleanup', { ...emptyRuntime(), destroy }),
            feature('async destroy', invalid)
        ]);
        expect(() => {
            pipeline.destroy();
        }).toThrow(AggregateError);
        expect(destroy).toHaveBeenCalledOnce();
        await Promise.resolve();
    });

    it.each(['requiresSampledDepth', 'requiresSplitScene', 'getSceneScale'] as const)(
        'rejects async %s before recording passes and observes the rejected promise',
        async hook => {
            const runtime = emptyRuntime();
            Object.defineProperty(runtime, hook, {
                value: (): Promise<never> => Promise.reject(new Error('late query failure'))
            });
            const pipeline = create([feature('async query', runtime)]);
            const context = recordContext();
            const addPass = vi.spyOn(context.graph, 'addPass');
            expect(() => pipeline.record(context)).toThrow(/must be synchronous/u);
            expect(addPass).not.toHaveBeenCalled();
            await Promise.resolve();
        }
    );

    it('rejects async record, closes the callback scope and observes its rejection', async () => {
        const runtime = {
            ...emptyRuntime(),
            record: (): Promise<never> => Promise.reject(new Error('late record failure'))
        };
        const pipeline = create([feature('async record', runtime)]);
        expect(() => pipeline.record(recordContext())).toThrow(/failed at before-output/u);
        await Promise.resolve();
    });

    it('rejects async creation and cleans up features already created', async () => {
        const destroy = vi.fn();
        const first = feature('first', { ...emptyRuntime(), destroy });
        const invalid: ForwardRenderPipelineFeature = {
            ...feature('async create', emptyRuntime()),
            create: () =>
                Promise.reject(
                    new Error('late create failure')
                ) as unknown as ForwardRenderPipelineFeatureRuntime
        };
        expect(() => create([first, invalid])).toThrow(/create\(\) must be synchronous/u);
        expect(destroy).toHaveBeenCalledOnce();
        await Promise.resolve();
    });

    it('rejects malformed optional hooks during creation and releases the invalid runtime', () => {
        const destroy = vi.fn();
        const runtime = { ...emptyRuntime(), destroy };
        Object.defineProperty(runtime, 'frameSubmitted', { value: 1 });
        expect(() => create([feature('invalid hook', runtime)])).toThrow(
            /frameSubmitted must be a function/u
        );
        expect(destroy).toHaveBeenCalledOnce();
    });
});
