import { WebGPUDevice } from '../../src/render/rhi/backends/webgpu/WebGPUDevice';
import { expect } from 'vitest';
import type { RHIDevice } from '../../src/render/rhi/core';
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

export async function verifyStableTransparentComposition(
    backend: 'webgl2' | 'webgpu',
    mode: 'sorted' | 'weighted',
    depthMode: 'standard' | 'reversed'
): Promise<void> {
    let target: RenderTarget | null = null;
    let fail = false;
    const copy = new PresentRenderPass();
    const capture: ForwardRenderPipelineFeature = {
        name: 'capture composed transparent depth',
        injectionPoint: 'before-output',
        requirements: { sampledSceneColor: true, sampledDepth: false },
        create() {
            return {
                name: 'capture composed transparent depth',
                record(context): void {
                    if (fail && context.pipeline.camera.visibility === 2)
                        throw new Error('discard composed stable depth');
                    if (context.pipeline.camera.visibility !== 2) return;
                    if (target === null || context.resources.color === null)
                        throw new Error('Missing composition capture');
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
                    /* owns no external resources */
                }
            };
        }
    };
    const renderer = await Renderer.create({
        backend,
        width: 32,
        height: 32,
        antialias: false,
        depth: true,
        stencil: true,
        domElement: document.createElement('canvas'),
        renderPipeline: new ForwardRenderPipelineFactory({
            sceneColorFormat: 'rgba16float',
            weightedBlendedTransparency: true,
            features: [
                new TemporalAA({ historyWeight: 0.94, sharpness: 0, renderScale: 0.5 }),
                capture
            ]
        })
    });
    const device = (renderer.getExtension('rhi') as { device: RHIDevice }).device;
    renderer.clearColor = new Color(0, 0, 0);
    const scene = new Node();
    const geometry = new PlaneGeometry({ width: 2, height: 2 });
    const blocker = new Mesh({
        geometry,
        material: new BasicMaterial({ lightType: 'NONE', diffuse: new Color(0, 0, 0) }),
        z: 0.5,
        layer: 1,
        frustumTest: false
    }).addTo(scene);
    const red = new Mesh({
        geometry,
        material: new BasicMaterial({
            lightType: 'NONE',
            diffuse: new Color(1, 0, 0),
            opacity: 0.75,
            compositing:
                mode === 'weighted'
                    ? { mode: 'weighted-blended' }
                    : { mode: 'alpha-blend', premultiplied: false }
        }),
        layer: 2,
        frustumTest: false
    }).addTo(scene);
    const base = new PerspectiveCamera({
        z: 4,
        aspect: 1,
        near: 0.1,
        far: 20,
        depthMode,
        visibility: 1
    });
    const overlay = new PerspectiveCamera({
        z: 4,
        aspect: 1,
        near: 0.1,
        far: 20,
        depthMode,
        visibility: 2,
        clearColor: false,
        clearDepth: false,
        clearStencil: false
    });
    const createTarget = (): RenderTarget =>
        renderer.createRenderTarget({
            width: renderer.width,
            height: renderer.height,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: false
        });
    target = createTarget();
    const draw = (): void => {
        renderer.renderFrame(frame => {
            frame.render(scene, base);
            frame.render(scene, overlay);
        });
    };
    const center = async (): Promise<number> => {
        if (device instanceof WebGPUDevice) device.nativeHandle.pushErrorScope('validation');
        draw();
        await renderer.waitForIdle();
        if (device instanceof WebGPUDevice)
            expect(await device.nativeHandle.popErrorScope()).toBeNull();
        if (target === null) throw new Error('Missing target');
        const image = await target.readColorAttachment();
        return (
            image.data[
                (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4
            ] ?? 0
        );
    };
    try {
        for (let phase = 0; phase < 8; phase++) expect(await center()).toBeLessThan(2);
        // Clearing only the overlay depth must deliberately reveal the further layer.
        overlay.clearDepth = true;
        expect(await center()).toBeGreaterThan(120);
        overlay.clearDepth = false;
        expect(await center()).toBeLessThan(2);
        // A first camera with no transparent draw still publishes stable depth for the overlay.
        blocker.visible = false;
        expect(await center()).toBeGreaterThan(120);
        blocker.visible = true;
        fail = true;
        expect(draw).toThrow(/capture composed transparent depth failed at before-output/u);
        fail = false;
        expect(await center()).toBeLessThan(2);
        renderer.resize(40, 40);
        target.resize(40, 40);
        expect(await center()).toBeLessThan(2);
        target.destroy();
        renderer.releaseGPUResources();
        target = createTarget();
        expect(await center()).toBeLessThan(2);
        red.visible = false;
        expect(await center()).toBeLessThan(2);
    } finally {
        target.destroy();
        renderer.destroy();
    }
}
