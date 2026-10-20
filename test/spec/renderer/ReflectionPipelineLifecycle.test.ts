import { afterEach, describe, expect, it, vi } from 'vitest';
import Node from '../../../src/core/Node';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Vector3 from '../../../src/math/Vector3';
import type { RenderTarget } from '../../../src/render/RenderTarget';
import {
    ReflectionProbe,
    reflectionProbeState
} from '../../../src/render/reflections/ReflectionProbe';
import { ReflectionProbePipelineFactory } from '../../../src/render/reflections/ReflectionProbePipeline';
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
import type {
    RenderGraphPassHandle,
    RenderGraphTextureHandle,
    RenderPipelineTargetResources
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import type { RenderGraphTimelineSnapshot } from '../../../src/render/graph/RenderGraphTimeline';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

const backends: FakeWebGLRHIBackend[] = [];
const pipelines: RenderPipeline[] = [];

afterEach(() => {
    for (const pipeline of pipelines) pipeline.destroy();
    pipelines.length = 0;
    for (const backend of backends) backend.destroy();
    backends.length = 0;
});

function unused(): never {
    throw new Error('Unexpected operation in reflection lifecycle fixture');
}

function createProbe(): ReflectionProbe {
    return new ReflectionProbe({
        position: new Vector3(),
        boxMin: new Vector3(-1, -1, -1),
        boxMax: new Vector3(1, 1, 1)
    });
}

function fixture(probe = createProbe()) {
    const backend = new FakeWebGLRHIBackend();
    backends.push(backend);
    const inner = {
        name: 'reflection lifecycle test',
        record: vi.fn<RenderPipeline['record']>(),
        frameSubmitted: vi.fn<(frameIndex: number) => unknown>(),
        frameDiscarded: vi.fn<(frameIndex: number) => unknown>(),
        recordRenderGraphTimeline:
            vi.fn<NonNullable<RenderPipeline['recordRenderGraphTimeline']>>(),
        destroy: vi.fn<() => unknown>()
    };
    const targets: ReturnType<typeof createTarget>[] = [];
    function createTarget(width: number, height: number, depth: boolean) {
        return {
            backend: 'webgl2',
            label: 'reflection test target',
            sampleCount: 1,
            colorAttachmentCount: 1,
            colorFormats: ['rgba16float'],
            depthStencilFormat: depth ? 'depth32float' : null,
            isDestroyed: false,
            width,
            height,
            getColorTexture: vi.fn(() => reflectionProbeState(probe).texture),
            getDepthTexture: unused,
            readColorAttachment: unused,
            resize: unused,
            destroy: vi.fn()
        } satisfies RenderTarget;
    }
    const createRenderTarget = vi.fn<RenderPipelineCreateContext['createRenderTarget']>(
        parameters => {
            const target = createTarget(
                parameters.width,
                parameters.height,
                parameters.depthStencilAttachment !== false
            );
            targets.push(target);
            return target;
        }
    );
    const creation: RenderPipelineCreateContext = {
        capabilities: createRenderPipelineCapabilities(backend.createDevice().capabilities),
        createRenderTarget,
        createStorageBuffer: unused,
        warmupStorageGraphicsShaders: unused
    };
    const factory = new ReflectionProbePipelineFactory({
        probes: [probe],
        pipeline: { name: inner.name, create: () => inner },
        resolution: 16,
        roughnessLevels: 2,
        facesPerFrame: 6,
        filterLevelsPerFrame: 2
    });
    const owner = {};
    const texture = 1 as RenderGraphTextureHandle;
    function resources(target?: RenderTarget): RenderPipelineTargetResources {
        return {
            width: target?.width ?? 1,
            height: target?.height ?? 1,
            sampleCount: 1,
            colorAttachmentCount: 1,
            color: () => texture,
            depthStencil: texture
        };
    }
    function context(frameIndex: number): RenderPipelineContext {
        const value: RenderPipelineContext = {
            frameIndex,
            scene: new Node(),
            camera: new PerspectiveCamera(),
            viewport: [0, 0, 1, 1],
            clearColor: { r: 0, g: 0, b: 0, a: 1 },
            capabilities: creation.capabilities,
            useLogDepth: false,
            output: {
                kind: 'render-target',
                width: 1,
                height: 1,
                sampleCount: 1,
                colorAttachmentCount: 1,
                colorFormat: () => 'rgba16float',
                colorAttachment: unused,
                depthStencilFormat: 'depth32float',
                depthStencilAttachment: null
            },
            prepareScene: vi.fn(),
            cull: () => 1 as CullingResultsHandle,
            createRendererList: () => 1 as RendererListHandle,
            createOrderedRendererList: unused,
            recordShadows: () => null,
            acquirePassParameters: pool => acquireRenderPassParameters(pool, owner, frameIndex),
            writeStorageBuffer: unused,
            recordView(camera, target, record) {
                record({
                    ...value,
                    camera,
                    graph: { ...value.graph, importOutput: () => resources(target) }
                });
            },
            graph: {
                createTexture: unused,
                createTextureView: unused,
                createBuffer: unused,
                importStorageBuffer: unused,
                importTexture: unused,
                importRenderTarget: resources,
                importOutput: resources,
                acquirePersistentTarget: unused,
                invalidateHistoryTexture: unused,
                releaseHistoryTexture: unused,
                releasePersistentTarget: unused,
                acquireHistoryTexture: () => ({
                    current: texture,
                    valid: true,
                    generation: 0,
                    historyCount: 1,
                    history: () => texture
                }),
                addPass: () => 1 as RenderGraphPassHandle
            }
        };
        return value;
    }
    async function create(): Promise<RenderPipeline> {
        const pipeline = await factory.create(creation);
        pipelines.push(pipeline);
        return pipeline;
    }
    return { probe, inner, targets, createRenderTarget, create, context };
}

describe('Reflection pipeline lifecycle', () => {
    it('publishes submitted captures before notifying a failing inner runtime', async () => {
        const test = fixture();
        const pipeline = await test.create();
        const failure = new Error('inner submission failed');
        test.inner.frameSubmitted.mockImplementationOnce(() => {
            throw failure;
        });
        pipeline.record(test.context(0));
        expect(() => {
            pipeline.frameSubmitted?.(0);
        }).toThrow(failure);
        expect(test.probe.getDiagnostics()).toMatchObject({
            ready: true,
            captures: 1,
            capturedRevision: 1
        });
        const next = test.context(1);
        const recordView = vi.spyOn(next, 'recordView');
        pipeline.record(next);
        pipeline.frameSubmitted?.(1);
        expect(recordView).not.toHaveBeenCalled();
        expect(test.probe.getDiagnostics().captures).toBe(1);
    });

    it('still notifies the inner runtime if capture publication fails', async () => {
        const test = fixture();
        const pipeline = await test.create();
        const failure = new Error('target publication failed');
        test.targets[2]?.getColorTexture.mockImplementationOnce(() => {
            throw failure;
        });
        pipeline.record(test.context(0));
        expect(() => {
            pipeline.frameSubmitted?.(0);
        }).toThrow(failure);
        expect(test.inner.frameSubmitted).toHaveBeenCalledExactlyOnceWith(0);
        expect(test.probe.getDiagnostics().ready).toBe(false);
    });

    it.each(['record', 'frameSubmitted', 'frameDiscarded', 'destroy'] as const)(
        'rejects and observes an asynchronous wrapped %s result',
        async hook => {
            const test = fixture();
            const pipeline = await test.create();
            test.inner[hook].mockImplementationOnce(() =>
                Promise.reject(new Error('late inner failure'))
            );
            expect(() => {
                if (hook === 'record') pipeline.record(test.context(0));
                else if (hook === 'destroy') pipeline.destroy();
                else pipeline[hook]?.(0);
            }).toThrow(/must be synchronous/u);
            await Promise.resolve();
        }
    );

    it('forwards asynchronous timeline notifications to their owner', async () => {
        const test = fixture();
        const pipeline = await test.create();
        const failure = new Error('timeline failed');
        test.inner.recordRenderGraphTimeline.mockImplementationOnce(() => Promise.reject(failure));
        const snapshot: RenderGraphTimelineSnapshot = {
            frameIndex: 0,
            recordDurationMs: 0,
            compileDurationMs: 0,
            prepareDurationMs: 0,
            executeDurationMs: 0,
            gpuStatus: 'unavailable',
            passes: [],
            resources: []
        };
        await expect(pipeline.recordRenderGraphTimeline?.(snapshot)).rejects.toThrow(failure);
    });

    it('attempts every owned cleanup once and releases probe ownership after failures', async () => {
        const test = fixture();
        const pipeline = await test.create();
        const targetFailure = new Error('target destroy failed');
        const innerFailure = new Error('inner destroy failed');
        test.targets[0]?.destroy.mockImplementationOnce(() => {
            throw targetFailure;
        });
        test.inner.destroy.mockImplementationOnce(() => {
            throw innerFailure;
        });
        expect(() => {
            pipeline.destroy();
        }).toThrow(expect.objectContaining({ errors: [targetFailure, innerFailure] }));
        expect(() => {
            pipeline.destroy();
        }).not.toThrow();
        for (const target of test.targets) expect(target.destroy).toHaveBeenCalledOnce();
        expect(test.inner.destroy).toHaveBeenCalledOnce();
        expect(reflectionProbeState(test.probe).owner).toBeNull();
        expect(() => pipeline.record(test.context(1))).toThrow(/destroyed/u);
        await fixture(test.probe).create();
    });

    it('cleans partial creation without masking the allocation error', async () => {
        const test = fixture();
        const allocationFailure = new Error('allocation failed');
        const cleanupFailure = new Error('cleanup failed');
        const create = test.createRenderTarget.getMockImplementation();
        if (create === undefined) throw new Error('Missing target factory');
        test.createRenderTarget
            .mockImplementationOnce(parameters => {
                const target = create(parameters);
                test.targets[0]?.destroy.mockImplementationOnce(() => {
                    throw cleanupFailure;
                });
                return target;
            })
            .mockImplementationOnce(() => {
                throw allocationFailure;
            });
        await expect(test.create()).rejects.toThrow(
            expect.objectContaining({ errors: [allocationFailure, cleanupFailure] })
        );
        expect(test.targets[0]?.destroy).toHaveBeenCalledOnce();
        expect(test.inner.destroy).toHaveBeenCalledOnce();
        expect(reflectionProbeState(test.probe).owner).toBeNull();
    });

    it('does not release or invalidate another live pipeline probe during failed creation', async () => {
        const first = fixture();
        const owner = await first.create();
        owner.record(first.context(0));
        owner.frameSubmitted?.(0);
        const second = fixture(first.probe);
        await expect(second.create()).rejects.toThrow(/already belongs/u);
        expect(first.probe.getDiagnostics().ready).toBe(true);
        expect(reflectionProbeState(first.probe).owner).toBe(owner);
        expect(first.inner.destroy).not.toHaveBeenCalled();
        expect(second.inner.destroy).toHaveBeenCalledOnce();
    });
});
