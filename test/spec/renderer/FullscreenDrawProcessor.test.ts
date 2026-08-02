import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { FullscreenDrawProcessor } from '../../../src/render/renderer/FullscreenDrawProcessor';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { MainPassTemplate, SharedDrawPassParameters } from '../../../src/render/renderer/passes';
import { RHITextureUsage } from '../../../src/render/rhi/core';
import Shader from '../../../src/shader/Shader';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

const vertexSource = `#version 300 es
void main() {
    vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D u_source;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_source, vec2(0.5));
}`;

function context(device: FakeRHIDevice, frameIndex: number) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 4, height: 4, minDepth: 0, maxDepth: 1 }
    });
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode === 'deferred') {
        const submission = backend.completeNextSubmission();
        await submission.done;
    }
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('FullscreenDrawProcessor on %s', (_name, createBackend) => {
    it('builds a reflected sampled fullscreen draw and reuses its steady packet', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const processor = new FullscreenDrawProcessor(registry);
        await processor.initialize();
        const frame = new RenderGraphFrame();
        const shader = new Shader({ vs: vertexSource, fs: fragmentSource });
        const pipelineState = Object.freeze({
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none' as const
        });
        const owner = {};
        const input = registry.registerTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const inputView = registry.register({
            dependencies: [input],
            create: (_activeDevice, resolve) => resolve(input).createView()
        });
        const createGraphicsPipeline = vi.spyOn(device, 'createGraphicsPipeline');
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        let previousDraw: unknown;

        for (let frameIndex = 1; frameIndex <= 2; frameIndex += 1) {
            const result = frame.execute(context(device, frameIndex), scope => {
                processor.beginFrame(scope.context, scope.uploads);
                const output = scope.graph.createTexture('fullscreen output', {
                    size: { width: 4, height: 4 },
                    format: 'rgba8unorm',
                    usage: RHITextureUsage.RENDER_ATTACHMENT
                });
                const pass = new SharedDrawPassParameters({ colorAttachments: 1, draws: 1 });
                pass.addReadTexture(
                    scope.graph.importTexture('fullscreen input', registry.resolve(input))
                );
                pass.addColorAttachment({
                    texture: output,
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 }
                });
                const draw = processor.prepare({
                    owner,
                    shader,
                    pipelineState,
                    target: { colorFormats: ['rgba8unorm'], sampleCount: 1 },
                    sampledResources: [
                        { textureView: inputView, sampler: processor.defaultSampler }
                    ]
                });
                if (previousDraw === undefined) previousDraw = draw;
                else expect(draw).toBe(previousDraw);
                pass.addDraw(draw);
                scope.graph.addPass(MainPassTemplate, pass);
                scope.graph.markOutput(output);
            });
            void processor.trackSubmission(frameIndex, result.submission);
            await complete(backend);
            await result.submission.done;
        }

        expect(createGraphicsPipeline).toHaveBeenCalledTimes(1);
        expect(createBindGroup).toHaveBeenCalledTimes(1);
        expect(backend.executionLog.filter(command => command.startsWith('draw:'))).toHaveLength(2);

        processor.destroy();
        registry.release(inputView);
        registry.release(input);
        registry.collect(2);
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects vertex inputs and binding-shape errors before queue execution', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const processor = new FullscreenDrawProcessor(registry);
        await processor.initialize();
        const frame = new RenderGraphFrame();
        const pipelineState = Object.freeze({
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none' as const
        });
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const invalidShader = new Shader({
            vs: `#version 300 es\nin vec3 position; void main(){gl_Position=vec4(position,1.0);}`,
            fs: fragmentSource
        });

        expect(() =>
            frame.execute(context(device, 1), scope => {
                processor.beginFrame(scope.context, scope.uploads);
                processor.prepare({
                    owner: {},
                    shader: invalidShader,
                    pipelineState,
                    target: { colorFormats: ['rgba8unorm'], sampleCount: 1 }
                });
            })
        ).toThrow('must not declare vertex inputs');
        expect(beginFrame).not.toHaveBeenCalled();
        expect(processor.active).toBe(false);

        processor.destroy();
        frame.destroy();
        registry.collect(1);
        registry.destroy();
        backend.destroy();
    });
});
