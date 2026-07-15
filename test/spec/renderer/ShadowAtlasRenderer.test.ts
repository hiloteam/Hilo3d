import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { PreparedDrawCache } from '../../../src/render/renderer/PreparedDraw';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ShadowAtlasPlanner } from '../../../src/render/renderer/ShadowAtlasPlanner';
import { ShadowAtlasRenderer } from '../../../src/render/renderer/ShadowAtlasRenderer';
import { ShadowAtlasResourceCache } from '../../../src/render/renderer/ShadowAtlasResourceCache';
import type { RHIGraphicsPipeline, RHIRenderPassDescriptor } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/portable/FakeRHIBackend';

function context(device: FakeRHIDevice, frameIndex = 1) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 16, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

function depthPipeline(device: FakeRHIDevice): RHIGraphicsPipeline {
    const shader = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'vertex',
            code:
                device.backend === 'webgl2'
                    ? '#version 300 es\nvoid main(){gl_Position=vec4(0.0);}'
                    : '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 1
        }
    });
    return device.createGraphicsPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [] }),
        vertex: { shader, buffers: [] },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less'
        },
        multisample: { count: 1 }
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
] as const)('ShadowAtlasRenderer on %s', (_name, createBackend) => {
    it('clears once, loads subsequent slices, and executes one shared depth pass per slice', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const planner = new ShadowAtlasPlanner();
        const firstLight = {};
        const secondLight = {};
        const plan = planner.build(
            {
                directional: [
                    { owner: firstLight, width: 8, height: 8 },
                    { owner: secondLight, width: 8, height: 8 }
                ],
                spot: [],
                point: []
            },
            device.capabilities
        );
        const resources = new ShadowAtlasResourceCache(registry);
        const atlasOwner = {};
        const atlas = resources.prepare(atlasOwner, plan);
        const renderer = new ShadowAtlasRenderer(registry, 2, 1);
        const pipeline = depthPipeline(device);
        const drawCache = new PreparedDrawCache<object>(1, 1);
        const draw = drawCache.prepare(
            {},
            {
                geometry: 1,
                materialVariant: 1,
                renderState: 1,
                resourceBindings: 1,
                target: 1,
                deviceGeneration: device.generation
            },
            prepared => {
                prepared.setPipeline(pipeline);
                prepared.setDraw(3);
            }
        );
        const descriptors: RHIRenderPassDescriptor[] = [];
        const beginFrame = device.graphicsQueue.beginFrame.bind(device.graphicsQueue);
        vi.spyOn(device.graphicsQueue, 'beginFrame').mockImplementation(frameDescriptor => {
            const commandContext = beginFrame(frameDescriptor);
            const beginRenderPass = commandContext.beginRenderPass.bind(commandContext);
            vi.spyOn(commandContext, 'beginRenderPass').mockImplementation(descriptor => {
                descriptors.push(descriptor);
                return beginRenderPass(descriptor);
            });
            return commandContext;
        });

        const result = renderer.render(context(device), atlas, plan, {
            sliceDraws: [[draw], [draw]]
        });
        await complete(backend);
        await result.submission.done;
        await renderer.waitForIdle();

        expect(descriptors).toHaveLength(2);
        expect(descriptors[0]?.colorAttachments).toEqual([]);
        expect(descriptors[0]?.depthStencilAttachment).toMatchObject({
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            depthClearValue: 1
        });
        expect(descriptors[1]?.depthStencilAttachment).toMatchObject({
            depthLoadOp: 'load',
            depthStoreOp: 'store'
        });
        expect(descriptors[1]?.depthStencilAttachment?.depthClearValue).toBeUndefined();
        expect(backend.executionLog.filter(command => command.startsWith('draw:'))).toHaveLength(2);
        expect(resources.resolveView(atlasOwner).texture).toBe(resources.resolve(atlasOwner));
        expect(resources.resolveComparisonSampler(atlasOwner).descriptor.compare).toBe(
            'less-equal'
        );

        renderer.destroy();
        resources.destroy();
        expect(registry.collect(1)).toBe(3);
        pipeline.destroy();
        planner.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rejects plan/resource and queue-shape mismatches before beginning a frame', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const planner = new ShadowAtlasPlanner();
        const plan = planner.build(
            {
                directional: [{ owner: {}, width: 4, height: 4 }],
                spot: [],
                point: []
            },
            device.capabilities
        );
        const resources = new ShadowAtlasResourceCache(registry);
        const atlas = resources.prepare({}, plan);
        const renderer = new ShadowAtlasRenderer(registry);
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');

        expect(() => renderer.render(context(device), atlas, plan, { sliceDraws: [] })).toThrow(
            'must match plan.slices'
        );
        expect(beginFrame).not.toHaveBeenCalled();

        renderer.destroy();
        resources.destroy();
        registry.collect(0);
        planner.destroy();
        registry.destroy();
        backend.destroy();
    });
});
