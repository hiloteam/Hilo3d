import { describe, expect, it } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Node from '../../../src/core/Node';
import Renderer from '../../../src/render/Renderer';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import { PresentRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import type {
    ScriptableRenderPass,
    RenderGraphTextureHandle
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import type { RHIDevice } from '../../../src/render/rhi/core';

describe.each(['webgl2', 'webgpu'] as const)('RG1 production pixels on %s', backend => {
    it('preserves pixels through reuse, resize, topology changes, discarded frames and multi-camera output', async () => {
        const canvas = document.createElement('canvas');
        const diagnostics = registerRendererDiagnostics(canvas);
        const copies = Array.from(
            { length: 6 },
            (_, i) => new PresentRenderPass(`reuse copy ${String(i)}`)
        );
        let count = 6;
        let fail = false;
        const initialize: ScriptableRenderPass<{ texture: RenderGraphTextureHandle }> = {
            name: 'reuse green source',
            setup(builder, { texture }): void {
                builder.useColorAttachment({
                    texture,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0.125, g: 0.75, b: 0.25, a: 1 }
                });
            },
            execute(): void {
                /* The attachment declaration records the clear. */
            }
        };
        const failure: ScriptableRenderPass<{ fail: boolean }> = {
            name: 'reuse failure boundary',
            setup(builder): void {
                builder.markSideEffect();
            },
            execute(_context, { fail: shouldFail }): void {
                if (shouldFail) throw new Error('deliberate reuse discard');
            }
        };
        const renderer = await Renderer.create({
            backend,
            domElement: canvas,
            width: 8,
            height: 4,
            antialias: false,
            renderPipeline: {
                name: 'reuse integration',
                create() {
                    return {
                        name: 'reuse integration',
                        record(context): void {
                            const output = context.graph.importOutput();
                            let source = context.graph.createTexture('reuse source', {
                                format: 'rgba8unorm',
                                extent: { relativeTo: 'output', scale: 1 }
                            });
                            context.graph.addPass(initialize, { texture: source });
                            for (let i = 0; i < count; i++) {
                                const pass = copies[i];
                                if (!pass) throw new Error('Missing reuse copy');
                                const destination =
                                    i === count - 1
                                        ? output.color(0)
                                        : context.graph.createTexture(
                                              `reuse scratch ${String(i)}`,
                                              {
                                                  format: 'rgba8unorm',
                                                  extent: { relativeTo: 'output', scale: 1 }
                                              }
                                          );
                                context.graph.addPass(pass, {
                                    inputTextures: [source],
                                    colorAttachments: [
                                        {
                                            texture: destination,
                                            loadOp: 'clear',
                                            storeOp: 'store',
                                            clearValue: { r: 0, g: 0, b: 0, a: 1 }
                                        }
                                    ]
                                });
                                source = destination;
                            }
                            context.graph.addPass(failure, { fail });
                        },
                        destroy(): void {
                            /* Renderer owns resources. */
                        }
                    };
                }
            }
        });
        let first = renderer.createRenderTarget({ width: 8, height: 4 });
        const second = renderer.createRenderTarget({ width: 8, height: 4 });
        const scene = new Node();
        const camera = new PerspectiveCamera();
        const draw = (): void => {
            renderer.renderToTarget(first, scene, camera);
        };
        try {
            draw();
            await renderer.waitForIdle();
            draw();
            await renderer.waitForIdle();
            const timeline = diagnostics.snapshot().renderGraph;
            expect(timeline?.scheduleCacheHit).toBe(true);
            expect(timeline?.memory.aliasedTextures).toBe(4);
            const reference = (await first.readColorAttachment()).data;
            expect(Array.from(reference.slice(0, 4))).toEqual([32, 191, 64, 255]);
            fail = true;
            expect(draw).toThrow('deliberate reuse discard');
            fail = false;
            draw();
            await renderer.waitForIdle();
            expect((await first.readColorAttachment()).data).toEqual(reference);
            count = 3;
            draw();
            await renderer.waitForIdle();
            expect(diagnostics.snapshot().renderGraph?.scheduleCacheHit).toBe(false);
            expect((await first.readColorAttachment()).data).toEqual(reference);
            first.resize(4, 8);
            draw();
            await renderer.waitForIdle();
            expect(diagnostics.snapshot().renderGraph?.scheduleCacheHit).toBe(false);
            expect((await first.readColorAttachment()).data).toEqual(reference);
            renderer.renderFrame(frame => {
                frame.renderToTarget(first, scene, camera);
                frame.renderToTarget(second, scene, camera);
            });
            await renderer.waitForIdle();
            expect((await first.readColorAttachment()).data).toEqual(reference);
            expect((await second.readColorAttachment()).data).toEqual(reference);
            renderer.releaseGPUResources();
            first = renderer.createRenderTarget({ width: 4, height: 8 });
            draw();
            await renderer.waitForIdle();
            expect((await first.readColorAttachment()).data).toEqual(reference);
            if (backend === 'webgpu') {
                const extension = renderer.getExtension('rhi') as {
                    readonly device: RHIDevice;
                } | null;
                if (!extension) throw new Error('Missing test RHI extension');
                const restored = new Promise<void>(resolve =>
                    renderer.on('webgpuDeviceRestored', () => {
                        resolve();
                    })
                );
                extension.device.destroy();
                await restored;
                draw();
                await renderer.waitForIdle();
                expect(diagnostics.snapshot().renderGraph?.scheduleCacheHit).toBe(false);
                expect((await first.readColorAttachment()).data).toEqual(reference);
            }
        } finally {
            first.destroy();
            second.destroy();
            renderer.destroy();
            unregisterRendererDiagnostics(canvas, diagnostics);
        }
    }, 30000);
});
