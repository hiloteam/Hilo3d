import { afterEach, describe, expect, it } from 'vitest';
import OrthographicCamera from '../../../src/camera/OrthographicCamera';
import Node from '../../../src/core/Node';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import Renderer from '../../../src/render/Renderer';
import type {
    RenderPipeline,
    RenderPipelineContext,
    RenderPipelineFactory
} from '../../../src/render/pipeline/RenderPipeline';
import {
    FullscreenRenderPass,
    PresentRenderPass
} from '../../../src/render/pipeline/passes/FullscreenRenderPass';
import { PORTABLE_FULLSCREEN_VERTEX_SOURCE } from '../../../src/render/pipeline/passes/internal/PortableFullscreenShader';
import {
    SCREEN_SPACE_GLOBAL_ILLUMINATION_REQUIREMENTS,
    ScreenSpaceGlobalIlluminationController,
    snapshotScreenSpaceGlobalIlluminationOptions
} from '../../../src/render/postprocessing/ScreenSpaceGlobalIllumination';
import Shader from '../../../src/shader/Shader';

function sourcePass(name: string, body: string): FullscreenRenderPass {
    return new FullscreenRenderPass({
        name,
        shader: new Shader({
            vs: PORTABLE_FULLSCREEN_VERTEX_SOURCE,
            fs: `#version 300 es
precision highp float;
in vec2 v_uv;
${body}`
        }),
        pipelineState: {
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }
    });
}

/** Analytic planar transport fixture: two screen halves have opposing normals. */
class HybridFixture implements RenderPipeline {
    readonly name = 'hybrid-global-illumination-fixture';
    readonly controller = new ScreenSpaceGlobalIlluminationController(
        snapshotScreenSpaceGlobalIlluminationOptions({
            resolutionScale: 0.5,
            rayCount: 12,
            stepCount: 12,
            maxRayDistance: 2,
            thickness: 0.15,
            saturation: 1,
            denoisePasses: 2,
            intensity: 1
        }),
        true
    );
    readonly scenePass: FullscreenRenderPass;
    readonly baselinePass: FullscreenRenderPass;
    readonly present = new PresentRenderPass('Hybrid fixture present');
    omitInputs = false;

    constructor(mode: 'miss' | 'equilibrium' | 'occlusion' | 'outside') {
        const sceneRadiance = mode === 'outside' ? '0.25' : mode === 'equilibrium' ? '0.5' : '0.75';
        this.scenePass = sourcePass(
            'Hybrid analytic screen surfaces',
            `
layout(location = 0) out vec4 scene;
layout(location = 1) out vec4 depth;
layout(location = 2) out vec4 attributes;
layout(location = 3) out vec4 motion;
void main() {
    scene = vec4(vec3(${sceneRadiance}), 1.0);
    depth = vec4(0.5);
    attributes = vec4(${mode === 'miss' ? 'vec2(0.5)' : '(v_uv.x < 0.5 ? vec2(1.0, 0.5) : vec2(0.0, 0.5))'}, 1.0, 0.0);
    motion = vec4(0.0, 0.0, log2(6.05), log2(6.05));
}`
        );
        this.baselinePass = sourcePass(
            'Hybrid analytic baseline',
            `
layout(location = 0) out vec4 baseline;
layout(location = 1) out vec4 albedo;
void main() {
    baseline = ${mode === 'outside' ? 'vec4(0.0)' : 'vec4(0.5, 0.5, 0.5, 1.0)'};
    albedo = vec4(vec3(${mode === 'occlusion' ? '0.0' : '1.0'}), 1.0);
}`
        );
    }

    record(context: RenderPipelineContext): void {
        const texture = (label: string) =>
            context.graph.createTexture(label, {
                format: 'rgba16float',
                extent: { relativeTo: 'output', scale: 1 },
                sampleCount: 1
            });
        const sceneColor = texture('Hybrid test color');
        const sceneDepth = texture('Hybrid test depth');
        const materialAttributes = texture('Hybrid test attributes');
        const motionDepth = texture('Hybrid test motion');
        const hybridBaseline = texture('Hybrid test baseline');
        const hybridAlbedo = texture('Hybrid test albedo');
        const attachments = [sceneColor, sceneDepth, materialAttributes, motionDepth].map(
            handle => ({
                texture: handle,
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
                clearValue: { r: 0, g: 0, b: 0, a: 0 }
            })
        );
        context.graph.addPass(this.scenePass, { inputTextures: [], colorAttachments: attachments });
        context.graph.addPass(this.baselinePass, {
            inputTextures: [],
            colorAttachments: [hybridBaseline, hybridAlbedo].map(handle => ({
                texture: handle,
                loadOp: 'clear' as const,
                storeOp: 'store' as const,
                clearValue: { r: 0, g: 0, b: 0, a: 0 }
            }))
        });
        const color = this.controller.record(context, {
            sceneColor,
            sceneDepth,
            materialAttributes,
            motionDepth,
            sceneScale: 1,
            ...(this.omitInputs ? {} : { hybridBaseline, hybridAlbedo })
        });
        context.graph.addPass(this.present, {
            inputTextures: [color],
            colorAttachments: [
                {
                    texture: context.graph.importOutput().color(0),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 0 }
                }
            ]
        });
    }

    frameSubmitted(frameIndex: number): void {
        this.controller.frameSubmitted(frameIndex);
    }
    frameDiscarded(frameIndex: number): void {
        this.controller.frameDiscarded(frameIndex);
    }
    destroy(): void {
        this.controller.destroy();
    }
}

class HybridFixtureFactory implements RenderPipelineFactory {
    readonly name = 'hybrid-global-illumination-fixture';
    readonly requirements = SCREEN_SPACE_GLOBAL_ILLUMINATION_REQUIREMENTS;
    constructor(readonly runtime: HybridFixture) {}
    create(): RenderPipeline {
        return this.runtime;
    }
}

const renderers: Renderer[] = [];
afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.destroy();
});

describe('DDGI / SSGI overlap replacement', () => {
    it.each(['webgl2', 'webgpu'] as const)(
        'preserves offscreen energy, equilibrium and signed occlusion on %s',
        async backend => {
            const results = new Map<string, Uint8Array>();
            for (const mode of ['miss', 'equilibrium', 'occlusion', 'outside'] as const) {
                const runtime = new HybridFixture(mode);
                const renderer = await Renderer.create({
                    backend,
                    domElement: document.createElement('canvas'),
                    width: 32,
                    height: 32,
                    antialias: false,
                    renderPipeline: new HybridFixtureFactory(runtime)
                });
                renderers.push(renderer);
                const target = renderer.createRenderTarget({
                    width: 32,
                    height: 32,
                    colorAttachments: [{ format: 'rgba8unorm' }],
                    depthStencilAttachment: false
                });
                const camera = new OrthographicCamera({
                    left: -2,
                    right: 2,
                    bottom: -2,
                    top: 2,
                    near: 0.1,
                    far: 10
                });
                const root = new Node();
                for (let frame = 0; frame < 3; frame++) {
                    renderer.renderToTarget(target, root, camera);
                    await renderer.waitForIdle();
                }
                const pixels = await target.readColorAttachment();
                if (!(pixels.data instanceof Uint8Array))
                    throw new Error('Expected normalized-byte fixture output');
                results.set(mode, pixels.data.slice());
                expect(renderer.renderInfo.drawCount).toBeGreaterThan(0);
                target.destroy();
                renderer.destroy();
                renderers.pop();
            }
            const miss = results.get('miss'),
                equilibrium = results.get('equilibrium'),
                occlusion = results.get('occlusion'),
                outside = results.get('outside');
            if (!miss || !equilibrium || !occlusion || !outside)
                throw new Error('Hybrid fixture did not produce pixels');
            let darkestOcclusion = 255;
            let changedPixels = 0;
            let outsideContributionPixels = 0;
            for (let pixel = 0; pixel < miss.length; pixel += 4) {
                expect(miss[pixel]).toBeGreaterThanOrEqual(190);
                expect(miss[pixel]).toBeLessThanOrEqual(192);
                expect(equilibrium[pixel]).toBeGreaterThanOrEqual(127);
                expect(equilibrium[pixel]).toBeLessThanOrEqual(129);
                const value = occlusion[pixel] ?? 0;
                // The non-DDGI contribution is 0.25. Signed filtering cannot remove it.
                expect(value).toBeGreaterThanOrEqual(63);
                expect(value).toBeLessThanOrEqual(192);
                darkestOcclusion = Math.min(darkestOcclusion, value);
                if (value < 186) changedPixels++;
                expect(outside[pixel]).toBeGreaterThanOrEqual(63);
                if ((outside[pixel] ?? 0) > 70) outsideContributionPixels++;
            }
            expect(darkestOcclusion).toBeLessThan(182);
            expect(changedPixels).toBeGreaterThan(16);
            // A zero/invalid DDGI baseline means no overlap, not an invalid SSGI receiver.
            expect(outsideContributionPixels).toBeGreaterThan(16);
        },
        60_000
    );

    it('rejects an incomplete overlap contract before recording temporal history', async () => {
        const runtime = new HybridFixture('miss');
        runtime.omitInputs = true;
        const renderer = await Renderer.create({
            backend: 'webgl2',
            domElement: document.createElement('canvas'),
            width: 8,
            height: 8,
            antialias: false,
            renderPipeline: new HybridFixtureFactory(runtime)
        });
        renderers.push(renderer);
        const target = renderer.createRenderTarget({
            width: 8,
            height: 8,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: false
        });
        const camera = new OrthographicCamera({ left: -1, right: 1, bottom: -1, top: 1 });
        expect(() => {
            renderer.renderToTarget(target, new Node(), camera);
        }).toThrow(/baseline and diffuse albedo/);
        runtime.omitInputs = false;
        renderer.renderToTarget(target, new Node(), camera);
        await renderer.waitForIdle();
        const pixels = await target.readColorAttachment();
        expect(pixels.data[0]).toBeGreaterThanOrEqual(190);
        expect(pixels.data[0]).toBeLessThanOrEqual(192);
        target.destroy();
    });
});
