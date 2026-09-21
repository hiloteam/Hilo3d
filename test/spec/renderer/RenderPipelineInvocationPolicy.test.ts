import { afterEach, describe, expect, it, vi } from 'vitest';
import Camera from '../../../src/camera/Camera';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import PBRMaterial from '../../../src/material/PBRMaterial';
import Renderer from '../../../src/render/Renderer';
import { ClusteredForwardPlusPipelineFactory } from '../../../src/render/pipeline/ClusteredForwardPlus';
import { ForwardRenderPipelineFactory } from '../../../src/render/pipeline/ForwardRenderPipeline';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineFactory,
    RenderPipelineInvocationPolicy
} from '../../../src/render/pipeline/RenderPipeline';
import { snapshotRenderPipelineFactory } from '../../../src/render/pipeline/RenderPipelineFactory';
import { PostProcessRenderPipelineFactory } from '../../../src/render/postprocessing/PostProcessRenderPipeline';
import type { ScriptableRenderPass } from '../../../src/render/pipeline/ScriptableRenderGraph';
import type { RHIQueue } from '../../../src/render/rhi/core';

class TrackingPipeline implements RenderPipeline {
    readonly name = 'invocation-policy-test';
    readonly submitted: number[] = [];
    readonly discarded: number[] = [];
    readonly recorded: Camera[] = [];
    readonly pass: ScriptableRenderPass<object> = {
        name: 'policy side effect',
        setup(builder): void {
            builder.markSideEffect();
        },
        execute(): void {
            // A real application graph submission proves permitted invocations remain valid.
        }
    };

    record(context: RenderPipelineContext): void {
        this.recorded.push(context.camera);
        context.graph.addPass(this.pass, {});
    }

    frameSubmitted(frameIndex: number): void {
        this.submitted.push(frameIndex);
    }

    frameDiscarded(frameIndex: number): void {
        this.discarded.push(frameIndex);
    }

    destroy(): void {
        // No renderer-local resources.
    }
}

function factoryFor(
    runtime: TrackingPipeline,
    invocationPolicy?: Readonly<RenderPipelineInvocationPolicy>
): RenderPipelineFactory {
    return {
        name: 'invocation-policy-test',
        ...(invocationPolicy === undefined ? {} : { invocationPolicy }),
        create(): RenderPipeline {
            return runtime;
        }
    };
}

const activeRenderers: Renderer[] = [];

async function createRenderer(factory: RenderPipelineFactory): Promise<Renderer> {
    const renderer = await Renderer.create({
        backend: 'webgl2',
        domElement: document.createElement('canvas'),
        width: 4,
        height: 4,
        antialias: false,
        renderPipeline: factory
    });
    activeRenderers.push(renderer);
    return renderer;
}

function graphicsQueue(renderer: Renderer): RHIQueue {
    const extension = renderer.getExtension('rhi') as {
        readonly device?: { readonly graphicsQueue: RHIQueue };
    } | null;
    if (extension?.device === undefined) throw new Error('Expected RHI extension');
    return extension.device.graphicsQueue;
}

afterEach(() => {
    for (const renderer of activeRenderers.splice(0)) renderer.destroy();
});

describe('Render pipeline invocation policy', () => {
    it('advertises the built-in factory camera and application-frame contracts', () => {
        const forward = new ForwardRenderPipelineFactory();
        const postProcess = new PostProcessRenderPipelineFactory();
        const clustered = new ClusteredForwardPlusPipelineFactory({
            buckets: [{ geometry: new BoxGeometry(), material: new PBRMaterial() }]
        });

        expect(forward.invocationPolicy).toEqual({
            cameraType: 'any',
            maxInvocationsPerFrame: null
        });
        expect(clustered.invocationPolicy).toEqual({
            cameraType: 'perspective',
            maxInvocationsPerFrame: 1
        });
        expect(Object.isFrozen(forward.invocationPolicy)).toBe(true);
        expect(Object.isFrozen(clustered.invocationPolicy)).toBe(true);
        expect(postProcess.invocationPolicy).toEqual(forward.invocationPolicy);
        expect(Object.isFrozen(postProcess.invocationPolicy)).toBe(true);
    });

    it.each([null, false, {}, { cameraType: 'orthographic', maxInvocationsPerFrame: 1 }])(
        'rejects malformed invocation metadata %j before calling the factory',
        async value => {
            const create = vi.fn((): RenderPipeline => new TrackingPipeline());
            const factory = {
                name: 'invalid-policy',
                invocationPolicy: value,
                create
            } as unknown as RenderPipelineFactory;

            await expect(createRenderer(factory)).rejects.toThrow(/invocationPolicy/u);
            expect(create).not.toHaveBeenCalled();
        }
    );

    it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid invocation budget %s',
        maximum => {
            expect(() => {
                snapshotRenderPipelineFactory(
                    factoryFor(new TrackingPipeline(), {
                        cameraType: 'any',
                        maxInvocationsPerFrame: maximum
                    })
                );
            }).toThrow(/positive safe integer or null/u);
        }
    );

    it('freezes an independent snapshot before asynchronous creation', async () => {
        const runtime = new TrackingPipeline();
        const policy: { cameraType: 'any' | 'perspective'; maxInvocationsPerFrame: number | null } =
            {
                cameraType: 'perspective',
                maxInvocationsPerFrame: 1
            };
        const factory = factoryFor(runtime, policy);
        const snapshot = snapshotRenderPipelineFactory(factory);
        const pending = createRenderer(factory);
        policy.cameraType = 'any';
        policy.maxInvocationsPerFrame = null;
        const renderer = await pending;

        expect(snapshot.invocationPolicy).not.toBe(policy);
        expect(Object.isFrozen(snapshot.invocationPolicy)).toBe(true);
        expect(snapshot.invocationPolicy).toEqual({
            cameraType: 'perspective',
            maxInvocationsPerFrame: 1
        });
        expect(() => {
            renderer.render(new Node(), new OrthographicCamera());
        }).toThrow(/requires a PerspectiveCamera/u);
        expect(runtime.recorded).toHaveLength(0);
    });

    it('preserves unrestricted custom factories when the policy is omitted', async () => {
        const runtime = new TrackingPipeline();
        const renderer = await createRenderer(factoryFor(runtime));
        const cameras = [new PerspectiveCamera(), new OrthographicCamera(), new Camera()];
        const scene = new Node();
        const beginFrame = vi.spyOn(graphicsQueue(renderer), 'beginFrame');

        renderer.renderFrame(frame => {
            for (const camera of cameras) frame.render(scene, camera);
        });

        expect(runtime.recorded).toEqual(cameras);
        expect(runtime.submitted).toHaveLength(1);
        expect(beginFrame).toHaveBeenCalledOnce();
    });

    it('rejects camera mismatches before record and RHI, then accepts a new frame', async () => {
        const runtime = new TrackingPipeline();
        const renderer = await createRenderer(
            factoryFor(runtime, { cameraType: 'perspective', maxInvocationsPerFrame: 1 })
        );
        const beginFrame = vi.spyOn(graphicsQueue(renderer), 'beginFrame');
        const scene = new Node();

        expect(() => {
            renderer.renderFrame(frame => {
                expect(() => {
                    frame.render(scene, new OrthographicCamera());
                }).toThrow(/requires a PerspectiveCamera/u);
            });
        }).toThrow(/aborted/u);
        expect(runtime.recorded).toHaveLength(0);
        expect(runtime.discarded).toHaveLength(1);
        expect(runtime.submitted).toHaveLength(0);
        expect(beginFrame).not.toHaveBeenCalled();

        renderer.render(scene, new PerspectiveCamera());
        expect(runtime.recorded).toHaveLength(1);
        expect(runtime.submitted).toHaveLength(1);
        expect(beginFrame).toHaveBeenCalledOnce();
    });

    it('shares the invocation budget across surface and target calls and poisons caught errors', async () => {
        const runtime = new TrackingPipeline();
        const renderer = await createRenderer(
            factoryFor(runtime, { cameraType: 'any', maxInvocationsPerFrame: 1 })
        );
        const target = renderer.createRenderTarget({ width: 4, height: 4 });
        const beginFrame = vi.spyOn(graphicsQueue(renderer), 'beginFrame');
        const scene = new Node();
        const camera = new PerspectiveCamera();

        expect(() => {
            renderer.renderFrame(frame => {
                frame.render(scene, camera);
                expect(() => {
                    renderer.renderToTarget(target, scene, camera);
                }).toThrow(/at most 1 invocation/u);
            });
        }).toThrow(/aborted/u);
        expect(runtime.recorded).toEqual([camera]);
        expect(runtime.discarded).toHaveLength(1);
        expect(runtime.submitted).toHaveLength(0);
        expect(beginFrame).not.toHaveBeenCalled();

        renderer.renderToTarget(target, scene, camera);
        expect(runtime.recorded).toEqual([camera, camera]);
        expect(runtime.submitted).toHaveLength(1);
        expect(beginFrame).toHaveBeenCalledOnce();
        target.destroy();
    });

    it('permits a declared bounded number of invocations', async () => {
        const runtime = new TrackingPipeline();
        const renderer = await createRenderer(
            factoryFor(runtime, { cameraType: 'perspective', maxInvocationsPerFrame: 2 })
        );
        const scene = new Node();
        const camera = new PerspectiveCamera();

        renderer.renderFrame(frame => {
            frame.render(scene, camera);
            frame.render(scene, camera);
        });
        expect(runtime.recorded).toHaveLength(2);
        expect(runtime.submitted).toHaveLength(1);
    });
});
