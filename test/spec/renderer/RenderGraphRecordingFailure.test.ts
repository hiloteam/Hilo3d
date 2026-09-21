import { describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import {
    RenderGraphBuilder,
    RenderGraphBuilderStorage
} from '../../../src/render/graph/RenderGraphBuilder';
import { RHITextureUsage } from '../../../src/render/rhi/core';
import { FakeWebGLRHIBackend } from '../rhi/portable/FakeRHIBackend';

describe('Render Graph abandoned recording', () => {
    it.each(['record', 'setup', 'promise'] as const)(
        'recycles repeated %s failures and accepts the next valid frame',
        failure => {
            const backend = new FakeWebGLRHIBackend();
            const device = backend.createDevice();
            const frame = new RenderGraphFrame();
            const capacities: number[] = [];
            const spy = vi.spyOn(RenderGraph.prototype, 'createBuilder');
            const captureCapacity = (): void => {
                const graph = spy.mock.contexts.at(-1);
                if (!(graph instanceof RenderGraph)) throw new Error('Expected the frame graph');
                capacities.push(graph.storageDiagnostics.builderStorageCapacity);
            };
            const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
            const context = createRenderGraphFrameContext({
                renderer: {} as RendererCore,
                rhi: device,
                frameIndex: 0,
                camera: new PerspectiveCamera(),
                lightManager: new LightManager(),
                fog: null,
                viewport: { x: 0, y: 0, width: 4, height: 4, minDepth: 0, maxDepth: 1 }
            });
            try {
                for (let index = 0; index < 8; index++) {
                    expect(() =>
                        frame.execute(context, scope => {
                            scope.graph.addPass(
                                {
                                    name: 'retained pass parameters',
                                    setup(pass): void {
                                        pass.markSideEffect();
                                    },
                                    execute(): void {
                                        // This fixture verifies ownership and metadata without emitting commands.
                                    }
                                },
                                { payload: new Uint8Array(1024) }
                            );
                            if (failure === 'setup')
                                scope.graph.addPass(
                                    {
                                        name: 'throwing setup',
                                        setup(): void {
                                            throw new Error('setup failed');
                                        },
                                        execute(): void {
                                            // This fixture verifies ownership and metadata without emitting commands.
                                        }
                                    },
                                    undefined
                                );
                            if (failure === 'promise') return Promise.resolve();
                            throw new Error('record failed');
                        })
                    ).toThrow();
                    captureCapacity();
                    expect(frame.active).toBe(false);
                }
                expect(beginFrame).not.toHaveBeenCalled();
                const result = frame.execute(context, scope =>
                    scope.graph.addPass(
                        {
                            name: 'recovered',
                            setup(pass): void {
                                pass.markSideEffect();
                            },
                            execute(): void {
                                // This fixture verifies ownership and metadata without emitting commands.
                            }
                        },
                        undefined
                    )
                );
                captureCapacity();
                expect(result.submission.status).toBe('succeeded');
                expect(beginFrame).toHaveBeenCalledOnce();
                expect(capacities).toEqual(new Array<number>(9).fill(1));
                for (const buildResult of spy.mock.results) {
                    if (buildResult.type === 'return') {
                        expect(() => buildResult.value.finish()).toThrow(/consumed/u);
                    }
                }
            } finally {
                spy.mockRestore();
                frame.destroy();
                backend.destroy();
            }
        }
    );

    it('clears private builder references and makes discard idempotent', () => {
        const storage = new RenderGraphBuilderStorage();
        const builder = new RenderGraphBuilder(storage);
        const texture = builder.createTexture('unsubmitted resource', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        builder.addPass(
            {
                name: 'unsubmitted pass',
                setup(pass): void {
                    pass.writeTexture(texture);
                },
                execute(): void {
                    // This fixture verifies ownership and metadata without emitting commands.
                }
            },
            { payload: new Uint8Array(1024) }
        );
        const pass = storage.passes[0];
        expect(pass?.params).toBeDefined();
        builder.discard();
        builder.discard();
        expect(storage.resources).toHaveLength(0);
        expect(storage.passes).toHaveLength(0);
        expect(pass?.params).toBeUndefined();
        expect(pass?.writes).toHaveLength(0);
        expect(() => builder.finish()).toThrow(/consumed/u);
    });
});
