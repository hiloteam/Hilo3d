import { expect } from 'vitest';
import PerspectiveCamera from '../../src/camera/PerspectiveCamera';
import Mesh from '../../src/core/Mesh';
import Node from '../../src/core/Node';
import PlaneGeometry from '../../src/geometry/PlaneGeometry';
import BasicMaterial from '../../src/material/BasicMaterial';
import Color from '../../src/math/Color';
import Renderer from '../../src/render/Renderer';
import type { RenderTarget } from '../../src/render/RenderTarget';
import {
    ForwardRenderPipelineFactory,
    type ForwardRenderPipelineFeature
} from '../../src/render/pipeline/ForwardRenderPipeline';
import { PresentRenderPass } from '../../src/render/pipeline/passes/FullscreenRenderPass';
import { TemporalAA } from '../../src/render/postprocessing/TemporalAA';

export async function verifyTemporalHistoryRetirement(backend: 'webgl2' | 'webgpu'): Promise<void> {
    let target: RenderTarget | null = null;
    let fail = false;
    const copy = new PresentRenderPass('Capture temporal camera retirement');
    const capture: ForwardRenderPipelineFeature = {
        name: 'capture temporal camera retirement',
        injectionPoint: 'before-output',
        requirements: { sampledSceneColor: true, sampledDepth: false },
        create() {
            return {
                name: 'capture temporal camera retirement',
                record(context): void {
                    if (context.pipeline.camera.visibility !== 2) return;
                    if (fail) throw new Error('forced temporal retirement discard');
                    if (target === null || context.resources.color === null)
                        throw new Error('Missing temporal capture target');
                    context.pipeline.graph.addPass(copy, {
                        inputTextures: [context.resources.color],
                        colorAttachments: [
                            {
                                texture: context.pipeline.graph.importRenderTarget(target).color(0),
                                loadOp: 'clear',
                                storeOp: 'store',
                                clearValue: { r: 0, g: 0, b: 0, a: 1 }
                            }
                        ]
                    });
                },
                destroy(): void {
                    copy.shader.destroy();
                }
            };
        }
    };
    const renderer = await Renderer.create({
        backend,
        width: 16,
        height: 16,
        antialias: false,
        domElement: document.createElement('canvas'),
        renderPipeline: new ForwardRenderPipelineFactory({
            features: [new TemporalAA({ sharpness: 0 }), capture]
        })
    });
    const createTarget = (): RenderTarget =>
        renderer.createRenderTarget({
            width: 16,
            height: 16,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: false
        });
    target = createTarget();
    const scene = new Node();
    new Mesh({
        geometry: new PlaneGeometry({ width: 2, height: 2 }),
        material: new BasicMaterial({ lightType: 'NONE', diffuse: new Color(0, 1, 0) }),
        layer: 2,
        frustumTest: false
    }).addTo(scene);
    const first = new PerspectiveCamera({ z: 4, aspect: 1, near: 0.1, far: 20, visibility: 1 });
    const later = new PerspectiveCamera({ z: 4, aspect: 1, near: 0.1, far: 20, visibility: 2 });
    const draw = (): void => {
        renderer.renderFrame(frame => {
            frame.render(scene, first);
            frame.render(scene, later);
        });
    };
    const readTwice = async (): Promise<void> => {
        if (target === null) throw new Error('Missing temporal capture target');
        for (let read = 0; read < 2; read++) {
            const pixels = (await target.readColorAttachment()).data;
            expect(pixels[(8 * 16 + 8) * 4 + 1]).toBeGreaterThan(180);
        }
    };
    try {
        draw();
        await renderer.waitForIdle();
        await readTwice();
        fail = true;
        expect(draw).toThrow(/capture temporal camera retirement failed at before-output/u);
        fail = false;
        for (let cycle = 0; cycle < 3; cycle++) {
            draw();
            await renderer.waitForIdle();
            await readTwice();
        }
        target.destroy();
        renderer.releaseGPUResources();
        target = createTarget();
        draw();
        await renderer.waitForIdle();
        await readTwice();
    } finally {
        target.destroy();
        renderer.destroy();
    }
}
