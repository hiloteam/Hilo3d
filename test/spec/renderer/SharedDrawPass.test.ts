import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import type { RGPassBuilder } from '../../../src/render/graph/RenderGraphBuilder';
import type { RGPrepareContext } from '../../../src/render/graph/RenderGraphExecutor';
import type {
    RGColorAttachmentDeclaration,
    RGDepthStencilAttachmentDeclaration,
    RGTextureHandle
} from '../../../src/render/graph/RenderGraphResource';
import {
    PreparedDrawCache,
    type PreparedDrawRevision
} from '../../../src/render/renderer/PreparedDraw';
import {
    MainPassTemplate,
    PostProcessPassTemplate,
    PresentPassTemplate,
    ShadowPassTemplate,
    SharedDrawPassParameters,
    TransparentPassTemplate
} from '../../../src/render/renderer/passes';
import {
    RHITextureUsage,
    type RHIGraphicsPipeline,
    type RHIRect,
    type RHIRenderPassDescriptor,
    type RHIRenderPassEncoder,
    type RHITextureFormat,
    type RHIViewport
} from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice
} from '../rhi/v2/FakeRHIBackend';

function drawRevision(device: FakeRHIDevice, target: number): PreparedDrawRevision {
    return {
        geometry: 1,
        materialVariant: 1,
        renderState: 1,
        resourceBindings: 1,
        target,
        deviceGeneration: device.generation
    };
}

function graphicsPipeline(
    device: FakeRHIDevice,
    colors: readonly RHITextureFormat[],
    depthFormat?: RHITextureFormat,
    sampleCount = 1
): RHIGraphicsPipeline {
    const isWebGL = device.backend === 'webgl2';
    const vertex = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'vertex',
            code: isWebGL
                ? '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }'
                : '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 101 + colors.length
        }
    });
    const fragment =
        colors.length === 0
            ? undefined
            : device.createShader({
                  artifact: {
                      backend: device.backend,
                      stage: 'fragment',
                      code: isWebGL
                          ? '#version 300 es\nout vec4 color; void main() { color = vec4(1.0); }'
                          : '@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }',
                      entryPoint: 'main',
                      reflection: {
                          bindings: [],
                          fragmentOutputs: colors.map((_format, location) => ({ location }))
                      },
                      cacheKey: 201 + colors.length
                  }
              });
    return device.createGraphicsPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [] }),
        vertex: { shader: vertex, buffers: [] },
        ...(fragment === undefined
            ? {}
            : {
                  fragment: {
                      shader: fragment,
                      targets: colors.map(format => ({ format }))
                  }
              }),
        primitive: {},
        ...(depthFormat === undefined
            ? {}
            : {
                  depthStencil: {
                      format: depthFormat,
                      depthWriteEnabled: true,
                      depthCompare: 'less'
                  }
              }),
        multisample: { count: sampleCount }
    });
}

function addPreparedDraw(
    params: SharedDrawPassParameters,
    device: FakeRHIDevice,
    pipeline: RHIGraphicsPipeline,
    targetRevision: number
): void {
    const cache = new PreparedDrawCache<object>(1, 1);
    const key = {};
    params.addDraw(
        cache.prepare(key, drawRevision(device, targetRevision), draw => {
            draw.setPipeline(pipeline);
            draw.setDraw(3);
        })
    );
}

function capturePassDescriptors(
    device: FakeRHIDevice,
    descriptors: RHIRenderPassDescriptor[],
    onPass?: (pass: RHIRenderPassEncoder) => void
): void {
    const queue = device.graphicsQueue;
    const beginFrame = queue.beginFrame.bind(queue);
    vi.spyOn(queue, 'beginFrame').mockImplementation(frameDescriptor => {
        const context = beginFrame(frameDescriptor);
        const beginRenderPass = context.beginRenderPass.bind(context);
        vi.spyOn(context, 'beginRenderPass').mockImplementation(descriptor => {
            descriptors.push(descriptor);
            const pass = beginRenderPass(descriptor);
            onPass?.(pass);
            return pass;
        });
        return context;
    });
}

async function finishBackendSubmission(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode === 'deferred') {
        const submission = backend.completeNextSubmission();
        await submission.done;
    }
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('shared renderer passes on %s', (_name, createBackend) => {
    it('executes shadow, main, transparent, post-process, and present in one shared order', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const descriptors: RHIRenderPassDescriptor[] = [];
        capturePassDescriptors(device, descriptors);

        const shadowDepth = builder.createTexture('shadow depth', {
            size: { width: 8, height: 8 },
            format: 'depth24plus',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const mainColor = builder.createTexture('main color', {
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
        });
        const mainDepth = builder.createTexture('main depth', {
            size: { width: 8, height: 8 },
            format: 'depth24plus',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const postColor = builder.createTexture('post color', {
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
        });
        const presentTexture = device.createTexture({
            size: { width: 8, height: 8 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const presentTarget = builder.importTexture('present target', presentTexture);

        const shadow = new SharedDrawPassParameters({ draws: 1 });
        shadow.setDepthStencilAttachment({
            texture: shadowDepth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store'
        });
        addPreparedDraw(shadow, device, graphicsPipeline(device, [], 'depth24plus'), 1);
        const shadowPass = builder.addPass(ShadowPassTemplate, shadow);

        const main = new SharedDrawPassParameters({ colorAttachments: 1, draws: 1 });
        main.addColorAttachment({
            texture: mainColor,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        });
        main.setDepthStencilAttachment({
            texture: mainDepth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store'
        });
        main.dependsOn(shadowPass);
        main.setViewport({ x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 });
        main.setScissor({ x: 0, y: 0, width: 8, height: 8 });
        addPreparedDraw(main, device, graphicsPipeline(device, ['rgba8unorm'], 'depth24plus'), 2);
        builder.addPass(MainPassTemplate, main);

        const transparent = new SharedDrawPassParameters({ colorAttachments: 1, draws: 1 });
        transparent.addColorAttachment({
            texture: mainColor,
            loadOp: 'load',
            storeOp: 'store'
        });
        transparent.setDepthStencilAttachment({
            texture: mainDepth,
            depthLoadOp: 'load',
            depthStoreOp: 'store'
        });
        addPreparedDraw(
            transparent,
            device,
            graphicsPipeline(device, ['rgba8unorm'], 'depth24plus'),
            3
        );
        builder.addPass(TransparentPassTemplate, transparent);

        const post = new SharedDrawPassParameters({
            colorAttachments: 1,
            draws: 1,
            readTextures: 1
        });
        post.addReadTexture(mainColor);
        post.addColorAttachment({
            texture: postColor,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        });
        addPreparedDraw(post, device, graphicsPipeline(device, ['rgba8unorm']), 4);
        builder.addPass(PostProcessPassTemplate, post);

        const present = new SharedDrawPassParameters({
            colorAttachments: 1,
            draws: 1,
            readTextures: 1
        });
        present.addReadTexture(postColor);
        present.addColorAttachment({
            texture: presentTarget,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        });
        addPreparedDraw(present, device, graphicsPipeline(device, ['rgba8unorm']), 5);
        builder.addPass(PresentPassTemplate, present);

        const result = graph.execute(graph.compile(builder, device.capabilities), device);

        expect(descriptors.map(descriptor => descriptor.label)).toEqual([
            'ShadowPass',
            'MainPass',
            'TransparentPass',
            'PostProcessPass',
            'PresentPass'
        ]);
        expect(
            descriptors.map(descriptor => [
                descriptor.colorAttachments.length,
                descriptor.depthStencilAttachment !== undefined
            ])
        ).toEqual([
            [0, true],
            [1, true],
            [1, true],
            [1, false],
            [1, false]
        ]);
        expect(backend.executionLog.filter(command => command === 'draw:3')).toHaveLength(5);
        expect(backend.executionLog).toContain('viewport');
        expect(backend.executionLog).toContain('scissor');
        expect(result.diagnostics.drawCount).toBe(5);

        await finishBackendSubmission(backend);
        graph.destroy();
        backend.destroy();
    });
});

describe('shared draw pass attachments and prepare', () => {
    it('reuses graph attachment declaration objects at the pass high-water mark', () => {
        const colors: RGColorAttachmentDeclaration[] = [];
        const depths: RGDepthStencilAttachmentDeclaration[] = [];
        const fakeBuilder = {
            readTexture: vi.fn(),
            writeTexture: vi.fn(),
            readBuffer: vi.fn(),
            writeBuffer: vi.fn(),
            dependsOn: vi.fn(),
            markSideEffect: vi.fn(),
            useColorAttachment: (declaration: RGColorAttachmentDeclaration) => {
                colors.push(declaration);
            },
            useDepthStencilAttachment: (declaration: RGDepthStencilAttachmentDeclaration) => {
                depths.push(declaration);
            }
        } as unknown as RGPassBuilder;
        const color = 1 as RGTextureHandle;
        const depth = 2 as RGTextureHandle;
        const params = new SharedDrawPassParameters({ colorAttachments: 1 });

        const declareFrame = (clear: number): void => {
            params.reset();
            params.addColorAttachment({
                texture: color,
                clearValue: { r: clear, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            });
            params.setDepthStencilAttachment({
                texture: depth,
                depthClearValue: clear,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            });
            params.declare(fakeBuilder, false);
        };

        declareFrame(0);
        const firstColor = colors[0];
        const firstDepth = depths[0];
        declareFrame(1);

        expect(colors[1]).toBe(firstColor);
        expect(depths[1]).toBe(firstDepth);
        expect(colors[1]?.clearValue?.r).toBe(1);
        expect(depths[1]?.depthClearValue).toBe(1);
    });

    it('resolves MRT, MSAA resolve, depth, viewport, and scissor before command execution', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const descriptors: RHIRenderPassDescriptor[] = [];
        const viewportRecords: Readonly<RHIViewport>[] = [];
        const viewportSnapshots: RHIViewport[] = [];
        const scissorRecords: Readonly<RHIRect>[] = [];
        const scissorSnapshots: RHIRect[] = [];
        let scalarViewportCalls = 0;
        let scalarScissorCalls = 0;
        capturePassDescriptors(device, descriptors, pass => {
            const applyViewportRecord = pass.setViewportRecord.bind(pass);
            vi.spyOn(pass, 'setViewportRecord').mockImplementation(viewport => {
                viewportRecords.push(viewport);
                viewportSnapshots.push({ ...viewport });
                applyViewportRecord(viewport);
            });
            const applyScissorRecord = pass.setScissorRectRecord.bind(pass);
            vi.spyOn(pass, 'setScissorRectRecord').mockImplementation(scissor => {
                scissorRecords.push(scissor);
                scissorSnapshots.push({ ...scissor });
                applyScissorRecord(scissor);
            });
            const applyScalarViewport = pass.setViewport.bind(pass);
            vi.spyOn(pass, 'setViewport').mockImplementation((...args) => {
                scalarViewportCalls++;
                applyScalarViewport(...args);
            });
            const applyScalarScissor = pass.setScissorRect.bind(pass);
            vi.spyOn(pass, 'setScissorRect').mockImplementation((...args) => {
                scalarScissorCalls++;
                applyScalarScissor(...args);
            });
        });
        const createTexture = (name: string, sampleCount: number, format: RHITextureFormat) =>
            builder.createTexture(name, {
                size: { width: 16, height: 8 },
                format,
                sampleCount,
                usage: RHITextureUsage.RENDER_ATTACHMENT
            });
        const firstMSAA = createTexture('first msaa', 4, 'rgba8unorm');
        const firstResolve = createTexture('first resolve', 1, 'rgba8unorm');
        const secondMSAA = createTexture('second msaa', 4, 'rgba16float');
        const secondResolve = createTexture('second resolve', 1, 'rgba16float');
        const depth = createTexture('depth', 4, 'depth24plus-stencil8');
        const pipeline = graphicsPipeline(
            device,
            ['rgba8unorm', 'rgba16float'],
            'depth24plus-stencil8',
            4
        );
        const cache = new PreparedDrawCache<object>(1, 1);
        const key = {};
        const params = new SharedDrawPassParameters({ colorAttachments: 2, draws: 1 });
        params.addColorAttachment({
            texture: firstMSAA,
            resolveTarget: firstResolve,
            loadOp: 'clear',
            storeOp: 'discard',
            clearValue: { r: 0, g: 0, b: 0, a: 1 }
        });
        params.addColorAttachment({
            texture: secondMSAA,
            resolveTarget: secondResolve,
            loadOp: 'clear',
            storeOp: 'discard',
            clearValue: { r: 0, g: 0, b: 0, a: 0 }
        });
        params.setDepthStencilAttachment({
            texture: depth,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        });
        const inputViewport = {
            x: 1,
            y: 2,
            width: 14,
            height: 6,
            minDepth: 0,
            maxDepth: 1
        };
        const inputScissor = { x: 1, y: 2, width: 14, height: 6 };
        params.setViewport(inputViewport);
        params.setScissor(inputScissor);
        params.setDrawCount(1);
        const prepare = vi.fn((context: RGPrepareContext, record: SharedDrawPassParameters) => {
            expect(device.graphicsQueue.state).toBe('idle');
            const target = context.getTextureView(firstMSAA);
            record.setDraw(
                0,
                cache.prepare(key, drawRevision(device, target.id), draw => {
                    draw.setPipeline(pipeline);
                    draw.setDraw(6);
                })
            );
        });
        params.setPrepare(prepare);
        builder.addPass(MainPassTemplate, params);
        builder.markOutput(firstResolve);
        builder.markOutput(secondResolve);

        graph.execute(graph.compile(builder, device.capabilities), device);

        expect(prepare).toHaveBeenCalledTimes(1);
        expect(descriptors).toHaveLength(1);
        const descriptor = descriptors[0];
        expect(descriptor?.colorAttachments).toHaveLength(2);
        expect(descriptor?.colorAttachments[0]?.view.texture.sampleCount).toBe(4);
        expect(descriptor?.colorAttachments[0]?.resolveTarget?.texture.sampleCount).toBe(1);
        expect(descriptor?.colorAttachments[1]?.view.format).toBe('rgba16float');
        expect(descriptor?.depthStencilAttachment?.view.format).toBe('depth24plus-stencil8');
        expect(viewportRecords).toHaveLength(1);
        expect(viewportRecords[0]).not.toBe(inputViewport);
        expect(viewportSnapshots).toEqual([inputViewport]);
        expect(scissorRecords).toHaveLength(1);
        expect(scissorRecords[0]).not.toBe(inputScissor);
        expect(scissorSnapshots).toEqual([inputScissor]);
        expect(scalarViewportCalls).toBe(0);
        expect(scalarScissorCalls).toBe(0);
        expect(backend.executionLog).toEqual(
            expect.arrayContaining(['viewport', 'scissor', 'draw:6', 'render-pass:end'])
        );
        graph.destroy();
        backend.destroy();
    });
});
