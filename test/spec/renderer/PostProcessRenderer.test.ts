import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import { DEFAULT_MATERIAL_PIPELINE_STATE } from '../../../src/material/MaterialDefinition';
import type RendererCore from '../../../src/render/RendererCore';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import {
    PostProcessRenderer,
    type PostProcessStep
} from '../../../src/render/renderer/PostProcessRenderer';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
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
out vec2 v_uv;
void main() {
    v_uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_source;
layout(location = 0) out vec4 color;
void main() {
    color = texture(u_source, v_uv);
}`;

function context(device: FakeRHIDevice, frameIndex: number) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

function configuredSurface(device: FakeRHIDevice) {
    const surface = device.createSurface({ width: 0, height: 0 } as HTMLCanvasElement);
    surface.configure({
        width: 8,
        height: 8,
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    });
    return surface;
}

function step(
    owner: object,
    outputOwner: object,
    shader: Shader,
    label: string,
    sampleCount: 1 | 4
): Readonly<PostProcessStep> {
    return Object.freeze({
        owner,
        shader,
        pipelineState: Object.freeze({
            ...DEFAULT_MATERIAL_PIPELINE_STATE,
            depthTest: false,
            depthWrite: false,
            cullMode: 'none'
        }),
        output: Object.freeze({
            owner: outputOwner,
            descriptor: Object.freeze({
                label,
                width: 8,
                height: 8,
                colorFormats: Object.freeze(['rgba8unorm'] as const),
                sampleCount
            })
        })
    });
}

async function complete(backend: FakeRHIBackend, tracking: Promise<void>): Promise<void> {
    if (backend.executionMode === 'deferred') backend.completeNextSubmission();
    await tracking;
}

function destroyFixture(
    backend: FakeRHIBackend,
    registry: ResourceRegistry,
    resources: RenderTargetResourceCache,
    renderer: PostProcessRenderer,
    completedFrame: number
): void {
    renderer.destroy();
    resources.destroy();
    registry.collect(completedFrame);
    registry.destroy();
    backend.destroy();
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('PostProcessRenderer on %s', (_name, createBackend) => {
    it('chains shared fullscreen passes, resolves MSAA, and explicitly presents with steady reuse', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const renderer = new PostProcessRenderer(resources, 2);
        await renderer.initialize();
        const surface = configuredSurface(device);
        const inputOwner = {};
        const input = resources.prepare(inputOwner, {
            label: 'post-process input',
            width: 8,
            height: 8,
            colorFormats: ['rgba8unorm']
        });
        const shader = new Shader({ vs: vertexSource, fs: fragmentSource });
        const firstOutputOwner = {};
        const secondOutputOwner = {};
        const steps = Object.freeze([
            step({}, firstOutputOwner, shader, 'post-process first', 4),
            step({}, secondOutputOwner, shader, 'post-process second', 1)
        ]);
        const createPipeline = vi.spyOn(device, 'createGraphicsPipeline');
        const createBindGroup = vi.spyOn(device, 'createBindGroup');
        const acquire = vi.spyOn(surface, 'getCurrentTexture');
        const present = vi.spyOn(surface, 'present');

        for (let frameIndex = 1; frameIndex <= 2; frameIndex += 1) {
            const result = renderer.render(context(device, frameIndex), surface, input, {
                label: 'tonemap chain',
                steps
            });
            expect(result.finalSource.owner).toBe(secondOutputOwner);
            expect(result.finalSource.sampleCount).toBe(1);
            expect(result.execution.diagnostics.drawCount).toBe(3);
            expect(surface.state).toBe('configured');
            await complete(backend, result.tracking);
        }

        expect(createPipeline).toHaveBeenCalledTimes(3);
        expect(createBindGroup).toHaveBeenCalledTimes(3);
        expect(acquire).toHaveBeenCalledTimes(2);
        expect(present).toHaveBeenCalledTimes(2);
        expect(
            backend.executionLog.filter(command =>
                command.startsWith('render-pass:Post-process 0:begin')
            )
        ).toHaveLength(2);
        expect(
            backend.executionLog.filter(command =>
                command.startsWith('render-pass:Post-process 1:begin')
            )
        ).toHaveLength(2);
        expect(
            backend.executionLog.filter(command =>
                command.startsWith('render-pass:tonemap chain present:begin')
            )
        ).toHaveLength(2);
        expect(backend.executionLog.at(-1)).toBe(`present:${String(surface.id)}`);

        destroyFixture(backend, registry, resources, renderer, 2);
    });

    it('rejects chain aliasing and shader-shape failures before queue or surface execution', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const renderer = new PostProcessRenderer(resources);
        await renderer.initialize();
        const surface = configuredSurface(device);
        const inputOwner = {};
        const input = resources.prepare(inputOwner, {
            width: 8,
            height: 8,
            colorFormats: ['rgba8unorm']
        });
        const shader = new Shader({ vs: vertexSource, fs: fragmentSource });
        const invalidShader = new Shader({
            vs: '#version 300 es\nin vec3 position; void main(){gl_Position=vec4(position,1.0);}',
            fs: fragmentSource
        });
        const acquire = vi.spyOn(surface, 'getCurrentTexture');
        const present = vi.spyOn(surface, 'present');
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');

        expect(() =>
            renderer.render(context(device, 1), surface, input, {
                steps: [step({}, inputOwner, shader, 'feedback target', 1)]
            })
        ).toThrow('must not alias the input target');
        expect(() =>
            renderer.render(context(device, 1), surface, input, {
                steps: [step({}, {}, invalidShader, 'invalid shader target', 1)]
            })
        ).toThrow('must not declare vertex inputs');

        expect(beginFrame).not.toHaveBeenCalled();
        expect(acquire).not.toHaveBeenCalled();
        expect(present).not.toHaveBeenCalled();
        expect(surface.state).toBe('configured');
        expect(renderer.active).toBe(false);
        expect(renderer.fullscreen.active).toBe(false);

        destroyFixture(backend, registry, resources, renderer, 1);
    });
});
