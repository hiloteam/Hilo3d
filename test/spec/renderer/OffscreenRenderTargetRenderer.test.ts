import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import Mesh from '../../../src/core/Mesh';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import LightManager from '../../../src/light/LightManager';
import Material from '../../../src/material/Material';
import type RendererCore from '../../../src/render/RendererCore';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import type { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import {
    createRenderGraphFrameContext,
    type RenderGraphFrameContext
} from '../../../src/render/frame/RenderGraphFrameContext';
import type { MeshDrawProcessor } from '../../../src/render/renderer/MeshDrawProcessor';
import { OffscreenRenderTargetRenderer } from '../../../src/render/renderer/OffscreenRenderTargetRenderer';
import {
    PreparedDrawCache,
    type PreparedDraw,
    type PreparedDrawRevision
} from '../../../src/render/renderer/PreparedDraw';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { SubmissionResourceTracker } from '../../../src/render/renderer/SubmissionResourceTracker';
import {
    RHIBufferUsage,
    type RHIGraphicsPipeline,
    type RHIRenderPassDescriptor,
    type RHISubmission,
    type RHITextureDescriptor,
    type RHITextureFormat
} from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice,
    type FakeRHITexture
} from '../rhi/portable/FakeRHIBackend';

let nextShaderKey = 9_000;

function frameContext(
    device: FakeRHIDevice,
    frameIndex: number,
    renderer = {} as RendererCore,
    width = 13,
    height = 7
) {
    return createRenderGraphFrameContext({
        renderer,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width, height, minDepth: 0, maxDepth: 1 }
    });
}

function pipeline(
    device: FakeRHIDevice,
    colorFormats: readonly RHITextureFormat[],
    sampleCount = 1,
    depthStencilFormat?: RHITextureFormat
): RHIGraphicsPipeline {
    const webGL = device.backend === 'webgl2';
    const vertex = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'vertex',
            code: webGL
                ? '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }'
                : '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: nextShaderKey++
        }
    });
    const fragmentOutputs = colorFormats.map((_format, location) => ({ location }));
    const fragment = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'fragment',
            code: webGL
                ? '#version 300 es\nlayout(location=0) out vec4 color0; void main() { color0 = vec4(1.0); }'
                : '@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }',
            entryPoint: 'main',
            reflection: { bindings: [], fragmentOutputs },
            cacheKey: nextShaderKey++
        }
    });
    return device.createGraphicsPipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [] }),
        vertex: { shader: vertex, buffers: [] },
        fragment: {
            shader: fragment,
            targets: colorFormats.map(format => ({ format }))
        },
        primitive: {},
        ...(depthStencilFormat === undefined
            ? {}
            : {
                  depthStencil: {
                      format: depthStencilFormat,
                      depthWriteEnabled: true,
                      depthCompare: 'less' as const
                  }
              }),
        multisample: { count: sampleCount }
    });
}

function preparedDraw(
    device: FakeRHIDevice,
    colorFormats: readonly RHITextureFormat[],
    sampleCount = 1,
    depthStencilFormat?: RHITextureFormat,
    vertexCount = 3
): PreparedDraw {
    const revision: PreparedDrawRevision = {
        geometry: vertexCount,
        materialVariant: 1,
        renderState: 1,
        resourceBindings: 1,
        target: colorFormats.length * 10 + sampleCount,
        deviceGeneration: device.generation
    };
    return new PreparedDrawCache<object>(1, 1).prepare({}, revision, draw => {
        draw.setPipeline(pipeline(device, colorFormats, sampleCount, depthStencilFormat));
        draw.setDraw(vertexCount);
    });
}

function capturePassDescriptors(
    device: FakeRHIDevice,
    descriptors: RHIRenderPassDescriptor[]
): void {
    const queue = device.graphicsQueue;
    const beginFrame = queue.beginFrame.bind(queue);
    vi.spyOn(queue, 'beginFrame').mockImplementation(frameDescriptor => {
        const context = beginFrame(frameDescriptor);
        const beginRenderPass = context.beginRenderPass.bind(context);
        vi.spyOn(context, 'beginRenderPass').mockImplementation(descriptor => {
            descriptors.push(descriptor);
            return beginRenderPass(descriptor);
        });
        return context;
    });
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode === 'deferred') {
        await backend.completeNextSubmission().done;
    }
}

function releaseTargetResources(
    renderer: OffscreenRenderTargetRenderer,
    resources: RenderTargetResourceCache,
    submissions: SubmissionResourceTracker,
    registry: ResourceRegistry,
    completedFrame: number,
    expectedResourceCount: number,
    backend: FakeRHIBackend
): void {
    renderer.destroy();
    resources.destroy();
    expect(registry.collect(completedFrame)).toBe(expectedResourceCount);
    submissions.destroy();
    registry.destroy();
    backend.destroy();
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('OffscreenRenderTargetRenderer on %s', (_name, createBackend) => {
    it('executes PreparedDraw MRT, MSAA resolve, depth/stencil, two queues, and readback staging', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const track = vi.spyOn(submissions, 'track');
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 2);
        const formats = ['rgba8unorm', 'rgba16float'] as const;
        const depthFormat = 'depth24plus-stencil8' as const;
        const descriptors: RHIRenderPassDescriptor[] = [];
        capturePassDescriptors(device, descriptors);

        const result = renderer.render(
            frameContext(device, 5),
            {},
            {
                label: 'offscreen MRT',
                width: 13,
                height: 7,
                colorFormats: formats,
                sampleCount: 4,
                depthStencilFormat: depthFormat
            },
            {
                opaqueDraws: [preparedDraw(device, formats, 4, depthFormat)],
                transparentDraws: [preparedDraw(device, formats, 4, depthFormat, 6)],
                colorOperations: [
                    { clearValue: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
                    { clearValue: { r: 0.4, g: 0.5, b: 0.6, a: 1 } }
                ],
                clearDepth: 0.75,
                clearStencil: 3,
                colorAttachmentCopy: {
                    attachmentIndex: 1,
                    x: 2,
                    y: 1,
                    width: 5,
                    height: 3
                }
            }
        );

        expect(renderer.active).toBe(false);
        expect(track).toHaveBeenCalledOnce();
        expect(track).toHaveBeenCalledWith(5, result.execution.submission);
        expect(result.tracking).toBe(result.execution.submission.done);
        expect(result.target).toMatchObject({
            width: 13,
            height: 7,
            sampleCount: 4,
            revision: 1,
            multisampleAttachmentLifetime: 'graph-transient'
        });
        expect(result.target.colorAttachments).toHaveLength(2);
        expect(result.target.colorAttachments.every(color => color.texture === null)).toBe(true);
        expect(result.target.depthStencilAttachment?.texture).toBeNull();
        expect(registry.diagnostics()).toMatchObject({ trackedResourceCount: 4 });
        expect(descriptors).toHaveLength(2);
        const cached = resources.resolve(result.target);
        for (const descriptor of descriptors) {
            expect(descriptor.colorAttachments).toHaveLength(2);
            expect(descriptor.colorAttachments[0]?.view.texture.sampleCount).toBe(4);
            expect(descriptor.colorAttachments[0]?.resolveTarget?.texture.sampleCount).toBe(1);
            expect(descriptor.colorAttachments[1]?.view.format).toBe('rgba16float');
            expect(descriptor.depthStencilAttachment?.view.texture.sampleCount).toBe(4);
            expect(descriptor.colorAttachments[0]?.view.texture).not.toBe(
                cached.colors[0]?.texture
            );
            expect(descriptor.colorAttachments[0]?.resolveTarget?.texture).toBe(
                cached.colors[0]?.resolveTarget
            );
            expect(descriptor.colorAttachments[1]?.view.texture).not.toBe(
                cached.colors[1]?.texture
            );
            expect(descriptor.depthStencilAttachment?.view.texture).not.toBe(
                cached.depthStencilAttachment
            );
        }
        expect(descriptors[0]?.colorAttachments[0]?.view.texture).toBe(
            descriptors[1]?.colorAttachments[0]?.view.texture
        );
        expect(descriptors[0]?.colorAttachments[1]?.view.texture).toBe(
            descriptors[1]?.colorAttachments[1]?.view.texture
        );
        expect(descriptors[0]?.depthStencilAttachment?.view.texture).toBe(
            descriptors[1]?.depthStencilAttachment?.view.texture
        );
        expect(result.execution.diagnostics.transientAllocations).toBeGreaterThanOrEqual(3);
        expect(descriptors[0]?.depthStencilAttachment).toMatchObject({
            depthClearValue: 0.75,
            stencilClearValue: 3,
            depthStoreOp: 'store',
            stencilStoreOp: 'store'
        });
        expect(descriptors[1]?.depthStencilAttachment).toMatchObject({
            depthLoadOp: 'load',
            stencilLoadOp: 'load',
            depthStoreOp: 'discard',
            stencilStoreOp: 'discard'
        });

        expect(result.attachment0Staging).toBeNull();
        const staging = result.colorAttachmentStaging;
        if (staging === null) throw new Error('Readback staging result is missing');
        expect(staging).toMatchObject({
            autoAllocated: true,
            mapReadSupported: device.capabilities.features.has('buffer-mapping'),
            attachmentIndex: 1,
            format: 'rgba16float',
            x: 2,
            y: 1,
            width: 5,
            height: 3,
            byteLength: 552,
            destinationLayout: { offset: 0, bytesPerRow: 256, rowsPerImage: 3 }
        });
        expect(staging.buffer.size).toBe(552);
        expect(staging.buffer.usage).toBe(
            RHIBufferUsage.COPY_DST |
                (device.capabilities.features.has('buffer-mapping') ? RHIBufferUsage.MAP_READ : 0)
        );
        if (backend.executionMode === 'deferred') {
            expect(submissions.pendingSubmissionCount).toBe(1);
        }

        await complete(backend);
        await result.tracking;
        expect(submissions.pendingSubmissionCount).toBe(0);
        expect(submissions.completedFrame).toBe(5);
        expect(result.execution.diagnostics.drawCount).toBe(2);
        const opaqueBegin = backend.executionLog.findIndex(command =>
            command.startsWith('render-pass:offscreen MRT opaque:begin')
        );
        const transparentBegin = backend.executionLog.findIndex(command =>
            command.startsWith('render-pass:offscreen MRT transparent:begin')
        );
        const copy = backend.executionLog.findIndex(command =>
            command.startsWith('copy-texture-buffer:')
        );
        expect(opaqueBegin).toBeGreaterThanOrEqual(0);
        expect(transparentBegin).toBeGreaterThan(opaqueBegin);
        expect(copy).toBeGreaterThan(transparentBegin);

        if (staging.mapReadSupported) {
            await staging.buffer.mapAsync('read', 0, staging.byteLength);
            expect(staging.buffer.getMappedRange(0, staging.byteLength).byteLength).toBe(552);
            staging.buffer.unmap();
        }
        staging.buffer.destroy();
        releaseTargetResources(renderer, resources, submissions, registry, 5, 4, backend);
    });

    it('keeps multisample attachments persistent when their contents cross the graph boundary', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const formats = ['rgba8unorm'] as const;
        const descriptors: RHIRenderPassDescriptor[] = [];
        capturePassDescriptors(device, descriptors);

        const result = renderer.render(
            frameContext(device, 6),
            {},
            {
                label: 'persistent multisample source',
                width: 4,
                height: 4,
                colorFormats: formats,
                sampleCount: 4,
                depthStencilFormat: null
            },
            {
                opaqueDraws: [preparedDraw(device, formats, 4)],
                colorOperations: [{ storeOp: 'store' }]
            }
        );

        await complete(backend);
        await result.tracking;
        const persistent = resources.resolve(result.target);
        expect(result.target.multisampleAttachmentLifetime).toBe('persistent');
        expect(result.target.colorAttachments[0]?.texture).not.toBeNull();
        expect(descriptors).toHaveLength(1);
        expect(descriptors[0]?.colorAttachments[0]?.view.texture).toBe(
            persistent.colors[0]?.texture
        );
        expect(descriptors[0]?.colorAttachments[0]?.resolveTarget?.texture).toBe(
            persistent.colors[0]?.resolveTarget
        );
        expect(result.execution.diagnostics.transientAllocations).toBe(0);
        releaseTargetResources(renderer, resources, submissions, registry, 6, 3, backend);
    });

    it('atomically replaces source ownership when boundary operations change', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const owner = {};
        const descriptor = {
            label: 'lifetime replacement',
            width: 4,
            height: 4,
            colorFormats: ['rgba8unorm'] as const,
            sampleCount: 4 as const
        };

        const first = renderer.render(frameContext(device, 1), owner, descriptor, {
            draws: [preparedDraw(device, descriptor.colorFormats, 4)]
        });
        await complete(backend);
        await first.tracking;
        const record = first.target;
        expect(record).toMatchObject({
            revision: 1,
            multisampleAttachmentLifetime: 'graph-transient'
        });
        expect(record.colorAttachments[0]?.texture).toBeNull();

        const second = renderer.render(frameContext(device, 2), owner, descriptor, {
            draws: [preparedDraw(device, descriptor.colorFormats, 4)],
            colorOperations: [{ storeOp: 'store' }]
        });
        await complete(backend);
        await second.tracking;
        expect(second.target).toBe(record);
        expect(record).toMatchObject({
            revision: 2,
            multisampleAttachmentLifetime: 'persistent'
        });
        expect(record.colorAttachments[0]?.texture).not.toBeNull();
        expect(resources.resolve(record).colors[0]?.texture).not.toBeNull();
        expect(second.execution.diagnostics.transientAllocations).toBe(0);

        const third = renderer.render(frameContext(device, 3), owner, descriptor, {
            draws: [preparedDraw(device, descriptor.colorFormats, 4)]
        });
        await complete(backend);
        await third.tracking;
        expect(third.target).toBe(record);
        expect(record).toMatchObject({
            revision: 3,
            multisampleAttachmentLifetime: 'graph-transient'
        });
        expect(record.colorAttachments[0]?.texture).toBeNull();
        expect(resources.resolve(record).colors[0]?.texture).toBeNull();

        releaseTargetResources(renderer, resources, submissions, registry, 3, 2, backend);
    });

    it('scales PreparedDraw MRT to the complete device color-attachment limit', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const colorAttachmentCount = device.capabilities.limits.maxColorAttachments;
        const formats = Object.freeze(
            Array.from({ length: colorAttachmentCount }, () => 'rgba8unorm' as const)
        );

        const result = renderer.render(
            frameContext(device, 6),
            {},
            { width: 5, height: 3, colorFormats: formats },
            { opaqueDraws: [preparedDraw(device, formats)] }
        );

        await complete(backend);
        await result.tracking;
        expect(result.target.colorAttachments).toHaveLength(colorAttachmentCount);
        expect(result.execution.diagnostics.drawCount).toBe(1);
        expect(device.graphicsQueue.state).toBe('idle');

        releaseTargetResources(
            renderer,
            resources,
            submissions,
            registry,
            6,
            colorAttachmentCount * 2,
            backend
        );
    });

    it('enlists Mesh preparation and an external copy buffer in one frame and one tracker', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const track = vi.spyOn(submissions, 'track');
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 2);
        const context = frameContext(device, 8, {} as RendererCore, 4, 2);
        const opaqueMesh = {} as Mesh;
        const transparentMesh = {} as Mesh;
        const opaqueDraw = preparedDraw(device, ['rgba8unorm']);
        const transparentDraw = preparedDraw(device, ['rgba8unorm'], 1, undefined, 4);
        const calls: string[] = [];
        const participant = {
            prepareCommit: vi.fn((_submission: RHISubmission) => undefined),
            commit: vi.fn((_submission: RHISubmission) => undefined),
            rollback: vi.fn()
        };
        const beginFrame = vi.fn((received: RenderGraphFrameContext, uploads: RHIUploadBatch) => {
            expect(received).toBe(context);
            expect(uploads).toBe(renderer.frame.uploads);
            expect(renderer.frame.active).toBe(true);
            uploads.enlist(participant);
            calls.push('begin');
        });
        const prepare = vi.fn((mesh: Mesh) => {
            calls.push(mesh === opaqueMesh ? 'opaque' : 'transparent');
            return mesh === opaqueMesh ? opaqueDraw : transparentDraw;
        });
        const processor = {
            renderer: context.renderer,
            registry,
            submissions,
            destroyed: false,
            active: false,
            sampledGraphDependencies: Object.freeze([]),
            beginFrame,
            beginPass: vi.fn(),
            prepare
        } as unknown as MeshDrawProcessor;
        const externalStaging = device.createBuffer({
            label: 'external offscreen staging',
            size: 272,
            usage:
                RHIBufferUsage.COPY_DST |
                (device.capabilities.features.has('buffer-mapping') ? RHIBufferUsage.MAP_READ : 0)
        });

        const result = renderer.render(
            context,
            {},
            { width: 4, height: 2, colorFormats: ['rgba8unorm'] },
            {
                meshProcessor: processor,
                meshes: [opaqueMesh],
                transparentMeshes: [transparentMesh],
                attachment0Copy: { destination: externalStaging }
            }
        );

        expect(calls).toEqual(['begin', 'opaque', 'transparent']);
        expect(beginFrame).toHaveBeenCalledOnce();
        expect(prepare).toHaveBeenCalledTimes(2);
        expect(participant.prepareCommit).toHaveBeenCalledOnce();
        expect(participant.commit).toHaveBeenCalledOnce();
        expect(participant.rollback).not.toHaveBeenCalled();
        expect(track).toHaveBeenCalledOnce();
        expect(result.attachment0Staging).toMatchObject({
            buffer: externalStaging,
            autoAllocated: false,
            mapReadSupported: device.capabilities.features.has('buffer-mapping'),
            byteLength: 272
        });
        expect(result.target.colorAttachments).toHaveLength(1);
        expect(result.target.depthStencilAttachment).toBeNull();

        await complete(backend);
        await result.tracking;
        expect(result.execution.diagnostics.drawCount).toBe(2);
        expect(submissions.completedFrame).toBe(8);
        expect(externalStaging.destroyed).toBe(false);
        externalStaging.destroy();
        releaseTargetResources(renderer, resources, submissions, registry, 8, 2, backend);
    });

    it('classifies opaque/transparent instanced Mesh MRT into two shared passes', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 4);
        const rendererCore = { forceMaterial: null } as RendererCore;
        const context = frameContext(device, 9, rendererCore, 6, 4);
        const geometry = new Geometry({
            vertices: new GeometryData(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3)
        });
        const opaqueMaterial = new Material({ transparent: false });
        const transparentMaterial = new Material({ transparent: true });
        const opaqueMeshes = [
            new Mesh({ geometry, material: opaqueMaterial, useInstanced: true }),
            new Mesh({ geometry, material: opaqueMaterial, useInstanced: true })
        ];
        const transparentMeshes = [
            new Mesh({ geometry, material: transparentMaterial, useInstanced: true }),
            new Mesh({ geometry, material: transparentMaterial, useInstanced: true })
        ];
        const formats = ['rgba8unorm', 'rgba16float'] as const;
        const depthFormat = 'depth24plus' as const;
        const opaqueDraw = preparedDraw(device, formats, 1, depthFormat);
        const transparentDraw = preparedDraw(device, formats, 1, depthFormat, 4);
        const beginFrame = vi.fn();
        const prepare = vi.fn();
        const prepareInstancedBatch = vi.fn(
            (_owner: object, meshes: readonly Mesh[], _target: unknown) =>
                meshes[0]?.material === transparentMaterial ? transparentDraw : opaqueDraw
        );
        const processor = {
            renderer: rendererCore,
            registry,
            submissions,
            destroyed: false,
            active: false,
            sampledGraphDependencies: Object.freeze([]),
            beginFrame,
            beginPass: vi.fn(),
            prepare,
            prepareInstancedBatch
        } as unknown as MeshDrawProcessor;

        const result = renderer.render(
            context,
            {},
            {
                width: 6,
                height: 4,
                colorFormats: formats,
                depthStencilFormat: depthFormat
            },
            {
                meshProcessor: processor,
                classifiedMeshes: [...opaqueMeshes, ...transparentMeshes]
            }
        );

        expect(beginFrame).toHaveBeenCalledOnce();
        expect(prepare).not.toHaveBeenCalled();
        expect(prepareInstancedBatch).toHaveBeenCalledTimes(2);
        expect(prepareInstancedBatch.mock.calls[0]?.[1]).toHaveLength(2);
        expect(prepareInstancedBatch.mock.calls[1]?.[1]).toHaveLength(2);
        for (const call of prepareInstancedBatch.mock.calls) {
            expect(call[2]).toMatchObject({
                colorFormats: formats,
                depthStencilFormat: depthFormat,
                sampleCount: 1
            });
        }

        await complete(backend);
        await result.tracking;
        expect(result.execution.diagnostics.drawCount).toBe(2);
        expect(backend.executionLog.filter(command => command.includes(':begin'))).toEqual(
            expect.arrayContaining([
                expect.stringContaining('opaque:begin'),
                expect.stringContaining('transparent:begin')
            ])
        );
        releaseTargetResources(renderer, resources, submissions, registry, 9, 5, backend);
    });

    it('executes a pure-depth Mesh target without a synthetic color attachment', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const rendererCore = {} as RendererCore;
        const context = frameContext(device, 10, rendererCore, 4, 4);
        const mesh = {} as Mesh;
        const draw = preparedDraw(device, [], 1, 'depth24plus');
        const processor = {
            renderer: rendererCore,
            registry,
            submissions,
            destroyed: false,
            active: false,
            sampledGraphDependencies: Object.freeze([]),
            beginFrame: vi.fn(),
            beginPass: vi.fn(),
            prepare: vi.fn(() => draw)
        } as unknown as MeshDrawProcessor;
        const descriptors: RHIRenderPassDescriptor[] = [];
        capturePassDescriptors(device, descriptors);

        const result = renderer.render(
            context,
            {},
            {
                width: 4,
                height: 4,
                colorFormats: [],
                depthStencilFormat: 'depth24plus'
            },
            { meshProcessor: processor, meshes: [mesh] }
        );

        await complete(backend);
        await result.tracking;
        expect(result.target.colorAttachments).toEqual([]);
        expect(result.target.depthStencilAttachment?.format).toBe('depth24plus');
        expect(descriptors).toHaveLength(1);
        expect(descriptors[0]?.colorAttachments).toEqual([]);
        expect(descriptors[0]?.depthStencilAttachment?.view.format).toBe('depth24plus');
        expect(result.execution.diagnostics.drawCount).toBe(1);
        releaseTargetResources(renderer, resources, submissions, registry, 10, 1, backend);
    });

    it('reorders a consumer built before its sampled public render-target producer', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const frame = new RenderGraphFrame();
        const rendererCore = {} as RendererCore;
        const context = frameContext(device, 12, rendererCore, 4, 4);
        const producerOwner = {};
        const consumerOwner = {};
        const producerMesh = {} as Mesh;
        const consumerMesh = {} as Mesh;
        const producerRecord = resources.prepare(producerOwner, {
            label: 'sampled producer',
            width: 4,
            height: 4,
            colorFormats: ['rgba8unorm']
        });
        const dependency = Object.freeze({
            record: producerRecord,
            attachment: 'color' as const,
            attachmentIndex: 0
        });
        const draw = preparedDraw(device, ['rgba8unorm']);
        let dependencies: readonly (typeof dependency)[] = Object.freeze([]);
        const processor = {
            renderer: rendererCore,
            registry,
            submissions,
            destroyed: false,
            active: false,
            get sampledGraphDependencies() {
                return dependencies;
            },
            beginFrame: vi.fn(() => {
                dependencies = Object.freeze([]);
            }),
            beginContextPass: vi.fn(() => {
                dependencies = Object.freeze([]);
            }),
            beginPass: vi.fn(() => {
                dependencies = Object.freeze([]);
            }),
            prepare: vi.fn((mesh: Mesh) => {
                dependencies = mesh === consumerMesh ? [dependency] : Object.freeze([]);
                return draw;
            })
        } as unknown as MeshDrawProcessor;

        renderer.beginComposition();
        let execution: ReturnType<RenderGraphFrame['execute']>;
        try {
            execution = frame.execute(context, scope => {
                renderer.build(
                    scope,
                    context,
                    consumerOwner,
                    {
                        label: 'sampled consumer',
                        width: 4,
                        height: 4,
                        colorFormats: ['rgba8unorm']
                    },
                    { meshProcessor: processor, meshes: [consumerMesh] }
                );
                renderer.build(
                    scope,
                    context,
                    producerOwner,
                    {
                        label: 'sampled producer',
                        width: 4,
                        height: 4,
                        colorFormats: ['rgba8unorm']
                    },
                    { meshProcessor: processor, meshes: [producerMesh] },
                    true
                );
            });
        } finally {
            renderer.endComposition();
        }
        const tracking = submissions.track(12, execution.submission);
        await complete(backend);
        await tracking;
        const passBegins = backend.executionLog.filter(command => command.endsWith(':begin'));
        expect(passBegins).toEqual([
            expect.stringContaining('sampled producer opaque'),
            expect.stringContaining('sampled consumer opaque')
        ]);

        frame.destroy();
        renderer.destroy();
        resources.destroy();
        submissions.destroy();
        registry.collect(Number.MAX_SAFE_INTEGER);
        registry.destroy();
        backend.destroy();
    });

    it('keeps a depth output live when the companion color attachment is discarded', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const formats = ['rgba8unorm'] as const;

        const result = renderer.render(
            frameContext(device, 11),
            {},
            {
                label: 'sampled depth with discarded color',
                width: 4,
                height: 4,
                colorFormats: formats,
                depthStencilFormat: 'depth24plus',
                depthStencilSampled: true
            },
            {
                opaqueDraws: [preparedDraw(device, formats, 1, 'depth24plus')],
                colorOperations: [{ storeOp: 'discard' }],
                depthStoreOp: 'store'
            }
        );

        await complete(backend);
        await result.tracking;
        expect(result.execution.diagnostics.drawCount).toBe(1);
        expect(
            backend.executionLog.some(command =>
                command.startsWith('render-pass:sampled depth with discarded color opaque:begin')
            )
        ).toBe(true);
        releaseTargetResources(renderer, resources, submissions, registry, 11, 4, backend);
    });

    it('preserves target identity across resize and same-backend registry recovery', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const owner = {};
        const first = renderer.render(
            frameContext(firstDevice, 1, {} as RendererCore, 4, 3),
            owner,
            { width: 4, height: 3, colorFormats: ['rgba8unorm'] },
            { draws: [preparedDraw(firstDevice, ['rgba8unorm'])] }
        );
        await complete(backend);
        await first.tracking;
        const record = first.target;
        const oldResources = resources.resolve(record);
        const oldColor = oldResources.colors[0]?.texture as FakeRHITexture;
        const oldView = oldResources.colors[0]?.readableView;
        if (oldView === undefined) throw new Error('Initial readable view is missing');

        const resized = renderer.render(
            frameContext(firstDevice, 2, {} as RendererCore, 8, 6),
            owner,
            { width: 8, height: 6, colorFormats: ['rgba8unorm'] },
            { draws: [preparedDraw(firstDevice, ['rgba8unorm'])] }
        );
        await complete(backend);
        await resized.tracking;
        expect(resized.target).toBe(record);
        expect(record).toMatchObject({ revision: 2, width: 8, height: 6 });
        expect(oldColor.destroyed).toBe(true);
        expect(oldView.destroyed).toBe(true);

        const colorHandle = record.colorAttachments[0]?.texture;
        const viewHandle = record.colorAttachments[0]?.readableView;
        const beforeRecovery = resources.resolve(record);
        const beforeRecoveryColor = beforeRecovery.colors[0]?.texture;
        const beforeRecoveryView = beforeRecovery.colors[0]?.readableView;
        const replacement = backend.createDevice();
        registry.recover(replacement);
        const afterRecovery = resources.resolve(record);
        expect(record.colorAttachments[0]?.texture).toBe(colorHandle);
        expect(record.colorAttachments[0]?.readableView).toBe(viewHandle);
        expect(afterRecovery.colors[0]?.texture).not.toBe(beforeRecoveryColor);
        expect(afterRecovery.colors[0]?.readableView).not.toBe(beforeRecoveryView);
        expect(afterRecovery.colors[0]?.readableView.texture).toBe(
            afterRecovery.colors[0]?.readableTexture
        );
        expect(afterRecovery.colors[0]?.readableView.deviceId).toBe(replacement.id);

        const recovered = renderer.render(
            frameContext(replacement, 3, {} as RendererCore, 8, 6),
            owner,
            { width: 8, height: 6, colorFormats: ['rgba8unorm'] },
            { draws: [preparedDraw(replacement, ['rgba8unorm'])] }
        );
        await complete(backend);
        await recovered.tracking;
        expect(recovered.target).toBe(record);
        expect(recovered.target.revision).toBe(2);
        expect(submissions.completedFrame).toBe(3);
        releaseTargetResources(renderer, resources, submissions, registry, 3, 2, backend);
    });
});

describe('OffscreenRenderTargetRenderer validation and atomicity', () => {
    it('rejects mixed classified/explicit Mesh queues before allocation or an RHI frame', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions);
        const prepareTarget = vi.spyOn(resources, 'prepare');
        const beginRHIFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const beginMeshFrame = vi.fn();
        const prepareMesh = vi.fn();
        const processor = {
            registry,
            submissions,
            sampledGraphDependencies: Object.freeze([]),
            beginFrame: beginMeshFrame,
            beginPass: vi.fn(),
            prepare: prepareMesh
        } as unknown as MeshDrawProcessor;

        expect(() =>
            renderer.render(
                frameContext(device, 1),
                {},
                {
                    width: 4,
                    height: 4,
                    colorFormats: ['rgba8unorm', 'rgba16float']
                },
                {
                    meshProcessor: processor,
                    classifiedMeshes: [new Mesh()],
                    meshes: [new Mesh()]
                }
            )
        ).toThrow(/classifiedMeshes is mutually exclusive/u);
        expect(prepareTarget).not.toHaveBeenCalled();
        expect(beginMeshFrame).not.toHaveBeenCalled();
        expect(prepareMesh).not.toHaveBeenCalled();
        expect(beginRHIFrame).not.toHaveBeenCalled();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);
        expect(renderer.active).toBe(false);

        renderer.destroy();
        resources.destroy();
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('keeps the previous target intact when a staged resize allocation fails', async () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const submissions = new SubmissionResourceTracker(registry);
        const track = vi.spyOn(submissions, 'track');
        const renderer = new OffscreenRenderTargetRenderer(resources, submissions, 1);
        const owner = {};
        const initial = renderer.render(
            frameContext(device, 1, {} as RendererCore, 4, 4),
            owner,
            { width: 4, height: 4, colorFormats: ['rgba8unorm'] },
            { draws: [preparedDraw(device, ['rgba8unorm'])] }
        );
        await initial.tracking;
        const record = initial.target;
        const originalHandle = record.colorAttachments[0]?.texture;
        const originalViewHandle = record.colorAttachments[0]?.readableView;
        const original = resources.resolve(record);
        const originalTexture = original.colors[0]?.texture;
        const originalView = original.colors[0]?.readableView;
        const msaaDraw = preparedDraw(device, ['rgba8unorm'], 4);
        const beginRHIFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        beginRHIFrame.mockClear();
        const createTexture = device.createTexture.bind(device);
        const partialTextures: FakeRHITexture[] = [];
        let viewFailureInjected = false;
        const createTextureSpy = vi
            .spyOn(device, 'createTexture')
            .mockImplementation((descriptor: RHITextureDescriptor) => {
                const texture = createTexture(descriptor);
                if (descriptor.size.width === 8) {
                    partialTextures.push(texture);
                    if (!viewFailureInjected) {
                        viewFailureInjected = true;
                        vi.spyOn(texture, 'createView').mockImplementationOnce(() => {
                            throw new Error('resize allocation failed');
                        });
                    }
                }
                return texture;
            });

        expect(() =>
            renderer.render(
                frameContext(device, 2, {} as RendererCore, 8, 8),
                owner,
                {
                    width: 8,
                    height: 8,
                    colorFormats: ['rgba8unorm'],
                    sampleCount: 4
                },
                { draws: [msaaDraw] }
            )
        ).toThrow('resize allocation failed');
        expect(record).toMatchObject({ revision: 1, width: 4, height: 4, sampleCount: 1 });
        expect(record.colorAttachments[0]?.texture).toBe(originalHandle);
        expect(record.colorAttachments[0]?.readableView).toBe(originalViewHandle);
        expect(resources.resolve(record).colors[0]?.texture).toBe(originalTexture);
        expect(resources.resolve(record).colors[0]?.readableView).toBe(originalView);
        expect(originalTexture?.destroyed).toBe(false);
        expect(originalView?.destroyed).toBe(false);
        expect(partialTextures).toHaveLength(1);
        expect(partialTextures[0]?.destroyed).toBe(true);
        expect(registry.diagnostics().trackedResourceCount).toBe(2);
        expect(beginRHIFrame).not.toHaveBeenCalled();
        expect(track).toHaveBeenCalledTimes(1);
        expect(renderer.active).toBe(false);
        createTextureSpy.mockRestore();

        const retried = renderer.render(
            frameContext(device, 2, {} as RendererCore, 8, 8),
            owner,
            {
                width: 8,
                height: 8,
                colorFormats: ['rgba8unorm'],
                sampleCount: 4
            },
            { draws: [msaaDraw] }
        );
        await retried.tracking;
        expect(retried.target).toBe(record);
        expect(record).toMatchObject({ revision: 2, width: 8, height: 8, sampleCount: 4 });

        renderer.destroy();
        resources.destroy();
        expect(registry.collect(2)).toBe(2);
        submissions.destroy();
        registry.destroy();
        backend.destroy();
    });
});
