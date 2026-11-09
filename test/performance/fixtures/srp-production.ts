import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import BoxGeometry from '../../../src/geometry/BoxGeometry';
import BasicMaterial from '../../../src/material/BasicMaterial';
import Color from '../../../src/math/Color';
import { srpSpatialPixelRange } from '../../../benchmarks/srp/statistics';
import Renderer from '../../../src/render/Renderer';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import type { ForwardRenderPipelineFeature } from '../../../src/render/pipeline/ForwardRenderPipeline';
import { PresentRenderPass } from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import { PostProcessRenderPipelineFactory } from '../../../src/render/postprocessing/PostProcessRenderPipeline';
import {
    SRP_PROTOCOL,
    type SRPBackend,
    type SRPFixture,
    type SRPFrameSample,
    type SRPWorkload
} from '../../../benchmarks/srp/contract';

/** Real scene + HDR bloom/grading + bounded custom fullscreen continuations. */
export async function createSRPFixture(
    backend: SRPBackend,
    workload: SRPWorkload,
    native: boolean
): Promise<SRPFixture> {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const diagnostics = registerRendererDiagnostics(canvas);
    const feature: ForwardRenderPipelineFeature = {
        name: 'SRP continuation workload',
        injectionPoint: 'before-output',
        requirements: { sampledSceneColor: true, sampledDepth: false },
        create() {
            const passes = Array.from(
                { length: SRP_PROTOCOL.continuationPasses },
                (_, i) => new PresentRenderPass(`SRP continuation ${String(i)}`)
            );
            return {
                record(context): void {
                    let source = context.resources.color;
                    if (source === null) throw new Error('SRP workload requires color');
                    for (const pass of passes) {
                        const destination = context.pipeline.graph.createTexture(pass.name, {
                            format: 'rgba16float',
                            extent: { relativeTo: 'output', scale: 1 }
                        });
                        context.pipeline.graph.addPass(pass, {
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
                    context.resources.replaceColor(source, context.resources.colorEncoding);
                },
                destroy(): void {
                    /* The renderer owns prepared resources. */
                }
            };
        }
    };
    const renderer = await Renderer.create({
        backend,
        domElement: canvas,
        width: SRP_PROTOCOL.width,
        height: SRP_PROTOCOL.height,
        pixelRatio: 1,
        antialias: false,
        ...(backend === 'webgpu' && native
            ? { forceFallbackAdapter: false, requiredFeatures: ['timestamp-query' as const] }
            : {}),
        ...(workload === 'default'
            ? {}
            : {
                  renderPipeline: new PostProcessRenderPipelineFactory({
                      opaqueTexture: false,
                      bloom: { intensity: 0.3 },
                      colorUber: { dithering: false },
                      features: workload === 'custom' ? [feature] : []
                  })
              })
    });
    const target = renderer.createRenderTarget({
        width: SRP_PROTOCOL.width,
        height: SRP_PROTOCOL.height,
        colorAttachments: [{ format: 'rgba8unorm' }]
    });
    const scene = new Node();
    const geometry = new BoxGeometry();
    for (let i = 0; i < 12; i++) {
        const mesh = new Mesh({
            geometry,
            material: new BasicMaterial({
                lightType: 'NONE',
                diffuse: new Color(0.3 + (i % 3) * 0.5, 0.2 + (i % 4) * 0.3, 0.4)
            })
        });
        mesh.setPosition(((i % 4) - 1.5) * 1.2, (Math.floor(i / 4) - 1) * 1.2, -(i % 3) * 0.2);
        scene.addChild(mesh);
    }
    const camera = new PerspectiveCamera({
        aspect: SRP_PROTOCOL.width / SRP_PROTOCOL.height,
        near: 0.1,
        far: 100
    });
    camera.setPosition(0, 0, 7);
    function renderSRPAllocationFrame(): void {
        renderer.renderToTarget(target, scene, camera);
    }
    const render = renderSRPAllocationFrame;
    return {
        render,
        async settle(): Promise<void> {
            await renderer.waitForIdle();
        },
        async frame(): Promise<SRPFrameSample> {
            const start = performance.now();
            render();
            const cpuMs = performance.now() - start;
            const fenceStart = performance.now();
            await renderer.waitForIdle();
            const fenceMs = performance.now() - fenceStart;
            const frameIndex = diagnostics.snapshot().renderGraph?.frameIndex;
            let snapshot = diagnostics.snapshot();
            if (backend === 'webgpu' && native) {
                const deadline = performance.now() + 10000;
                while (
                    snapshot.renderGraph?.gpuStatus === 'pending' &&
                    performance.now() < deadline
                ) {
                    await new Promise<void>(resolve => setTimeout(resolve, 0));
                    snapshot = diagnostics.snapshot();
                }
                if (
                    snapshot.renderGraph?.frameIndex !== frameIndex ||
                    snapshot.renderGraph?.gpuStatus !== 'ready'
                )
                    throw new Error('SRP GPU timestamps did not resolve for the sampled frame');
            }
            const timeline = snapshot.renderGraph;
            if (timeline === null) throw new Error('SRP timeline missing');
            const gpuPassMs =
                timeline.gpuStatus === 'ready'
                    ? timeline.passes.reduce((sum, pass) => {
                          if (pass.kind !== null && pass.gpuDurationMs === null)
                              throw new Error('Missing GPU pass timestamp');
                          return sum + (pass.gpuDurationMs ?? 0);
                      }, 0)
                    : null;
            return {
                scheduleCacheHit: timeline.scheduleCacheHit,
                cpuMs,
                fenceMs,
                recordMs: timeline.recordDurationMs,
                compileMs: timeline.compileDurationMs,
                prepareMs: timeline.prepareDurationMs,
                executeMs: timeline.executeDurationMs,
                gpuPassMs,
                ...timeline.memory,
                draws: snapshot.frame.draws,
                commands: snapshot.frame.commands,
                passes: snapshot.frame.passes,
                submissions: snapshot.frame.submissions
            };
        },
        async pixels(): Promise<{ sha256: string; range: number }> {
            const pixels = (await target.readColorAttachment()).data;
            const range = srpSpatialPixelRange(pixels);
            const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(pixels));
            return {
                sha256: Array.from(new Uint8Array(hash), byte =>
                    byte.toString(16).padStart(2, '0')
                ).join(''),
                range
            };
        },
        async destroy(): Promise<void> {
            await renderer.waitForIdle();
            target.destroy();
            renderer.destroy();
            unregisterRendererDiagnostics(canvas, diagnostics);
            canvas.remove();
        }
    };
}
