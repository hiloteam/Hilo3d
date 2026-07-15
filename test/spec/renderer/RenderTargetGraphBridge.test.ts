import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import {
    RenderTargetGraphBridge,
    RenderTargetAttachment0CopyPassTemplate
} from '../../../src/render/renderer/RenderTargetGraphBridge';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { MainPassTemplate } from '../../../src/render/renderer/passes/MainPass';
import { SharedDrawPassParameters } from '../../../src/render/renderer/passes/SharedDrawPass';
import {
    RHIBufferUsage,
    RHITextureUsage,
    type RHIRenderPassDescriptor,
    type RHITextureDescriptor
} from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice,
    type FakeRHITexture
} from '../rhi/portable/FakeRHIBackend';

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

async function finishSubmission(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode !== 'deferred') return;
    const submission = backend.completeNextSubmission();
    await submission.done;
}

function frameContext(device: FakeRHIDevice) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex: 1,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 13, height: 7, minDepth: 0, maxDepth: 1 }
    });
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('shared render-target graph bridge on %s', (_name, createBackend) => {
    it('executes MRT, MSAA resolve, depth, and attachment0 copy in shared order', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const bridge = new RenderTargetGraphBridge(resources);
        const owner = {};
        const record = resources.prepare(owner, {
            label: 'MRT target',
            width: 13,
            height: 7,
            colorFormats: ['rgba8unorm', 'rgba16float'],
            sampleCount: 4,
            depthStencilFormat: 'depth24plus'
        });
        const resolved = resources.resolve(record);

        expect(resolved.colors).toHaveLength(2);
        expect(resolved.colors[0]?.texture?.sampleCount).toBe(4);
        expect(resolved.colors[0]?.resolveTarget?.sampleCount).toBe(1);
        expect(
            (resolved.colors[0]?.readableTexture.usage ?? 0) & RHITextureUsage.COPY_SRC
        ).not.toBe(0);
        expect(resolved.colors[0]?.readableView.texture).toBe(resolved.colors[0]?.readableTexture);
        expect(resolved.depthStencilAttachment?.sampleCount).toBe(4);

        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const imported = bridge.import(builder, record);
        const pass = new SharedDrawPassParameters({ colorAttachments: 2 });
        for (let index = 0; index < imported.colorAttachments.length; index += 1) {
            const color = imported.colorAttachments[index];
            if (color === undefined) throw new Error('test target color is missing');
            pass.addColorAttachment({
                texture: color.texture,
                ...(color.resolveTarget === null ? {} : { resolveTarget: color.resolveTarget }),
                clearValue: { r: index, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: color.resolveTarget === null ? 'store' : 'discard'
            });
        }
        if (imported.depthStencilAttachment === null) {
            throw new Error('test target depth is missing');
        }
        pass.setDepthStencilAttachment({
            texture: imported.depthStencilAttachment,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard'
        });
        builder.addPass(MainPassTemplate, pass);

        const copyPlan = imported.attachment0Copy;
        if (copyPlan === null) throw new Error('MRT test target copy plan is missing');
        expect(copyPlan.source).toBe(imported.colorAttachments[0]?.resolveTarget);
        expect(copyPlan.destinationLayout).toEqual({
            offset: 0,
            bytesPerRow: 256,
            rowsPerImage: 7
        });
        expect(copyPlan.byteLength).toBe(1588);
        expect(imported.colorCopies).toHaveLength(2);
        expect(imported.colorCopies[0]).toBe(copyPlan);
        const attachment1Region = bridge.createColorAttachmentCopyPlan(imported, 1, {
            x: 2,
            y: 1,
            width: 5,
            height: 3
        });
        expect(attachment1Region).toMatchObject({
            attachmentIndex: 1,
            format: 'rgba16float',
            sourceOrigin: { x: 2, y: 1, z: 0 },
            copySize: { width: 5, height: 3, depthOrArrayLayers: 1 },
            destinationLayout: { offset: 0, bytesPerRow: 256, rowsPerImage: 3 },
            byteLength: 552
        });
        expect(attachment1Region.source).toBe(imported.colorAttachments[1]?.resolveTarget);
        const destinationBuffer = device.createBuffer({
            label: 'attachment0 readback staging',
            size: copyPlan.byteLength,
            usage: RHIBufferUsage.COPY_DST
        });
        const destination = builder.importBuffer('attachment0 readback staging', destinationBuffer);
        const copyPass = bridge.addAttachment0CopyPass(builder, imported, destination);
        expect(copyPass).toBeGreaterThan(0);
        const attachment1Buffer = device.createBuffer({
            label: 'attachment1 region staging',
            size: attachment1Region.byteLength,
            usage: RHIBufferUsage.COPY_DST
        });
        const attachment1Destination = builder.importBuffer(
            'attachment1 region staging',
            attachment1Buffer
        );
        expect(
            bridge.addColorAttachmentCopyPass(builder, imported, 1, attachment1Destination, {
                x: 2,
                y: 1,
                width: 5,
                height: 3
            })
        ).toBeGreaterThan(copyPass);
        expect(RenderTargetAttachment0CopyPassTemplate.name).toBe(
            'RenderTargetAttachment0CopyPass'
        );

        const descriptors: RHIRenderPassDescriptor[] = [];
        capturePassDescriptors(device, descriptors);
        resources.markUsed(record, 3);
        const result = graph.execute(graph.compile(builder, device.capabilities), device, {
            frameIndex: 3
        });
        await finishSubmission(backend);
        await result.submission.done;

        expect(descriptors).toHaveLength(1);
        expect(descriptors[0]?.colorAttachments).toHaveLength(2);
        expect(descriptors[0]?.colorAttachments[0]?.view.texture.sampleCount).toBe(4);
        expect(descriptors[0]?.colorAttachments[0]?.resolveTarget?.texture.sampleCount).toBe(1);
        expect(descriptors[0]?.colorAttachments[1]?.view.format).toBe('rgba16float');
        expect(descriptors[0]?.depthStencilAttachment?.view.texture.sampleCount).toBe(4);
        expect(backend.executionLog.map(command => command.split(':')[0])).toEqual([
            'render-pass',
            'render-pass',
            'copy-texture-buffer',
            'copy-texture-buffer'
        ]);

        resources.destroy();
        expect(registry.collect(3)).toBe(7);
        destinationBuffer.destroy();
        attachment1Buffer.destroy();
        graph.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('atomically resizes, recovers logical handles, and defers released resources', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const resources = new RenderTargetResourceCache(registry);
        const bridge = new RenderTargetGraphBridge(resources);
        const owner = {};
        const record = resources.prepare(owner, {
            label: 'lifecycle target',
            width: 4,
            height: 3,
            colorFormats: ['rgba8unorm'],
            depthStencilFormat: 'depth24plus'
        });
        const firstHandles = {
            color: record.colorAttachments[0]?.texture,
            readableView: record.colorAttachments[0]?.readableView,
            depth: record.depthStencilAttachment?.texture
        };
        const firstResources = resources.resolve(record);
        const oldColor = firstResources.colors[0]?.texture as FakeRHITexture;
        const oldReadableView = firstResources.colors[0]?.readableView;
        if (oldReadableView === undefined) throw new Error('Old readable view is missing');
        const oldDepth = firstResources.depthStencilAttachment as FakeRHITexture;
        resources.markUsed(record, 5);

        const resized = resources.resize(owner, 8, 6);
        expect(resized).toBe(record);
        expect(record).toMatchObject({ revision: 2, width: 8, height: 6 });
        expect(record.colorAttachments[0]?.texture).not.toBe(firstHandles.color);
        expect(record.colorAttachments[0]?.readableView).not.toBe(firstHandles.readableView);
        expect(registry.collect(4)).toBe(0);
        expect(oldColor.destroyed).toBe(false);
        expect(oldDepth.destroyed).toBe(false);
        expect(registry.collect(5)).toBe(3);
        expect(oldColor.destroyed).toBe(true);
        expect(oldReadableView.destroyed).toBe(true);
        expect(oldDepth.destroyed).toBe(true);

        const currentColorHandle = record.colorAttachments[0]?.texture;
        const currentReadableViewHandle = record.colorAttachments[0]?.readableView;
        const currentDepthHandle = record.depthStencilAttachment?.texture;
        const beforeRecovery = resources.resolve(record);
        const beforeRecoveryColor = beforeRecovery.colors[0]?.texture as FakeRHITexture;
        const beforeRecoveryView = beforeRecovery.colors[0]?.readableView;
        if (beforeRecoveryView === undefined) {
            throw new Error('Pre-recovery readable view is missing');
        }
        const recoveryGraph = new RenderGraph();
        const recoveryBuilder = recoveryGraph.createBuilder();
        const imported = bridge.import(recoveryBuilder, record);
        expect(imported).toMatchObject({
            targetToken: record.token,
            targetRevision: 2,
            width: 8,
            height: 6,
            sampleCount: 1
        });
        expect(imported.colorAttachments[0]?.resolveTarget).toBeNull();
        const recoveryCopyPlan = imported.attachment0Copy;
        if (recoveryCopyPlan === null) throw new Error('Recovery target copy plan is missing');
        expect(recoveryCopyPlan.source).toBe(imported.colorAttachments[0]?.texture);
        const recoveryPass = new SharedDrawPassParameters({ colorAttachments: 1 });
        const recoveredColor = imported.colorAttachments[0];
        if (recoveredColor === undefined || imported.depthStencilAttachment === null) {
            throw new Error('recovery test target is incomplete');
        }
        recoveryPass.addColorAttachment({
            texture: recoveredColor.texture,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        });
        recoveryPass.setDepthStencilAttachment({
            texture: imported.depthStencilAttachment,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard'
        });
        recoveryBuilder.addPass(MainPassTemplate, recoveryPass);
        recoveryBuilder.markOutput(recoveredColor.texture);
        const compiledBeforeRecovery = recoveryGraph.compile(
            recoveryBuilder,
            firstDevice.capabilities
        );

        const secondDevice = backend.createDevice();
        registry.recover(secondDevice);
        const afterRecovery = resources.resolve(record);
        expect(record.colorAttachments[0]?.texture).toBe(currentColorHandle);
        expect(record.colorAttachments[0]?.readableView).toBe(currentReadableViewHandle);
        expect(record.depthStencilAttachment?.texture).toBe(currentDepthHandle);
        expect(afterRecovery.colors[0]?.texture).not.toBe(beforeRecoveryColor);
        expect(afterRecovery.colors[0]?.readableView).not.toBe(beforeRecoveryView);
        expect(afterRecovery.colors[0]?.readableView.texture).toBe(
            afterRecovery.colors[0]?.readableTexture
        );
        expect(afterRecovery.colors[0]?.texture?.deviceId).toBe(secondDevice.id);
        expect(afterRecovery.colors[0]?.readableView.deviceId).toBe(secondDevice.id);
        expect(beforeRecoveryColor.destroyed).toBe(true);
        expect(beforeRecoveryView.destroyed).toBe(true);
        resources.markUsed(record, 7);
        const recoveredExecution = recoveryGraph.execute(compiledBeforeRecovery, secondDevice, {
            frameIndex: 7
        });
        await finishSubmission(backend);
        await recoveredExecution.submission.done;
        recoveryGraph.destroy();

        resources.markUsed(record, 9);
        const finalColor = afterRecovery.colors[0]?.texture as FakeRHITexture;
        const finalReadableView = afterRecovery.colors[0]?.readableView;
        if (finalReadableView === undefined) throw new Error('Final readable view is missing');
        const finalDepth = afterRecovery.depthStencilAttachment as FakeRHITexture;
        expect(resources.release(owner)).toBe(true);
        expect(resources.release(owner)).toBe(false);
        const staleGraph = new RenderGraph();
        expect(() => bridge.import(staleGraph.createBuilder(), record)).toThrow(/stale/u);
        staleGraph.destroy();
        expect(registry.collect(8)).toBe(0);
        expect(finalColor.destroyed).toBe(false);
        expect(finalDepth.destroyed).toBe(false);
        expect(registry.collect(9)).toBe(3);
        expect(finalColor.destroyed).toBe(true);
        expect(finalReadableView.destroyed).toBe(true);
        expect(finalDepth.destroyed).toBe(true);

        resources.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('imports sampled depth-only targets and preserves their view lifecycle across recovery', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const resources = new RenderTargetResourceCache(registry);
        const bridge = new RenderTargetGraphBridge(resources);
        const owner = {};
        const createTexture = vi.spyOn(firstDevice, 'createTexture');

        expect(() => resources.prepare({}, { width: 4, height: 4, colorFormats: [] })).toThrow(
            /at least one color or depth\/stencil attachment/u
        );
        expect(() =>
            resources.prepare(
                {},
                {
                    width: 4,
                    height: 4,
                    colorFormats: ['rgba8unorm'],
                    depthStencilSampled: true
                }
            )
        ).toThrow(/requires a depth\/stencil attachment/u);
        expect(() =>
            resources.prepare(
                {},
                {
                    width: 4,
                    height: 4,
                    colorFormats: [],
                    depthStencilFormat: 'stencil8',
                    depthStencilSampled: true
                }
            )
        ).toThrow(/format with a depth aspect/u);
        expect(() =>
            resources.prepare(
                {},
                {
                    width: 4,
                    height: 4,
                    colorFormats: [],
                    sampleCount: 4,
                    depthStencilFormat: 'depth24plus',
                    depthStencilSampled: true
                }
            )
        ).toThrow(/single-sample/u);
        expect(createTexture).not.toHaveBeenCalled();
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 0,
            pendingReleaseCount: 0
        });
        createTexture.mockRestore();

        const record = resources.prepare(owner, {
            label: 'depth-only target',
            width: 5,
            height: 3,
            colorFormats: [],
            depthStencilFormat: 'depth24plus-stencil8'
        });
        const unsampledHandle = record.depthStencilAttachment?.texture;
        const unsampledTexture = resources.resolve(record).depthStencilAttachment as FakeRHITexture;
        expect(resources.resolve(record).depthStencilView).toBeNull();
        expect(
            resources.prepare(owner, {
                label: 'depth-only target',
                width: 5,
                height: 3,
                colorFormats: [],
                depthStencilFormat: 'depth24plus-stencil8'
            })
        ).toBe(record);
        expect(record.revision).toBe(1);
        expect(record.depthStencilAttachment?.texture).toBe(unsampledHandle);

        expect(
            resources.prepare(owner, {
                label: 'depth-only target',
                width: 5,
                height: 3,
                colorFormats: [],
                depthStencilFormat: 'depth24plus-stencil8',
                depthStencilSampled: true
            })
        ).toBe(record);
        expect(record.revision).toBe(2);
        expect(record.colorAttachments).toEqual([]);
        expect(record.depthStencilAttachment?.texture).not.toBe(unsampledHandle);
        expect(record.depthStencilAttachment?.sampledView).not.toBeNull();
        expect(registry.collect(0)).toBe(1);
        expect(unsampledTexture.destroyed).toBe(true);

        const resolved = resources.resolve(record);
        const depthTexture = resolved.depthStencilAttachment as FakeRHITexture;
        const depthView = resolved.depthStencilView;
        if (depthView === null) throw new Error('Sampled depth view is missing');
        expect(resolved.colors).toEqual([]);
        expect(depthTexture.usage & RHITextureUsage.RENDER_ATTACHMENT).not.toBe(0);
        expect(depthTexture.usage & RHITextureUsage.TEXTURE_BINDING).not.toBe(0);
        expect(depthTexture.usage & RHITextureUsage.COPY_SRC).toBe(0);
        expect(depthView.aspect).toBe('depth-only');
        expect(depthView.texture).toBe(depthTexture);

        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const imported = bridge.import(builder, record);
        expect(imported.colorAttachments).toEqual([]);
        expect(imported.depthStencilAttachment).not.toBeNull();
        expect(imported.attachment0Copy).toBeNull();
        const destinationBuffer = firstDevice.createBuffer({
            label: 'unused depth-only copy destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const destination = builder.importBuffer(
            'unused depth-only copy destination',
            destinationBuffer
        );
        expect(() => bridge.addAttachment0CopyPass(builder, imported, destination)).toThrow(
            /requires a render target color attachment/u
        );
        if (imported.depthStencilAttachment === null) {
            throw new Error('Imported depth-only attachment is missing');
        }
        const pass = new SharedDrawPassParameters({ colorAttachments: 0 });
        pass.setDepthStencilAttachment({
            texture: imported.depthStencilAttachment,
            depthClearValue: 1,
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilClearValue: 0,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        });
        builder.addPass(MainPassTemplate, pass);
        builder.markOutput(imported.depthStencilAttachment);
        const descriptors: RHIRenderPassDescriptor[] = [];
        capturePassDescriptors(firstDevice, descriptors);
        resources.markUsed(record, 1);
        const execution = graph.execute(
            graph.compile(builder, firstDevice.capabilities),
            firstDevice,
            {
                frameIndex: 1
            }
        );
        await finishSubmission(backend);
        await execution.submission.done;
        expect(descriptors).toHaveLength(1);
        expect(descriptors[0]?.colorAttachments).toEqual([]);
        expect(descriptors[0]?.depthStencilAttachment?.view.texture).toBe(depthTexture);
        graph.destroy();
        destinationBuffer.destroy();

        const oldTextureHandle = record.depthStencilAttachment?.texture;
        const oldViewHandle = record.depthStencilAttachment?.sampledView;
        resources.markUsed(record, 3);
        expect(resources.resize(owner, 9, 7)).toBe(record);
        expect(record).toMatchObject({ revision: 3, width: 9, height: 7 });
        expect(record.depthStencilAttachment?.texture).not.toBe(oldTextureHandle);
        expect(record.depthStencilAttachment?.sampledView).not.toBe(oldViewHandle);
        expect(record.depthStencilAttachment?.sampledView).not.toBeNull();
        expect(registry.collect(2)).toBe(0);
        expect(registry.collect(3)).toBe(2);
        expect(depthTexture.destroyed).toBe(true);
        expect(depthView.destroyed).toBe(true);

        const stableTextureHandle = record.depthStencilAttachment?.texture;
        const stableViewHandle = record.depthStencilAttachment?.sampledView;
        const beforeRecovery = resources.resolve(record);
        const beforeRecoveryTexture = beforeRecovery.depthStencilAttachment as FakeRHITexture;
        const beforeRecoveryView = beforeRecovery.depthStencilView;
        if (beforeRecoveryView === null) throw new Error('Pre-recovery depth view is missing');
        const secondDevice = backend.createDevice();
        registry.recover(secondDevice);
        const afterRecovery = resources.resolve(record);
        expect(record.depthStencilAttachment?.texture).toBe(stableTextureHandle);
        expect(record.depthStencilAttachment?.sampledView).toBe(stableViewHandle);
        expect(afterRecovery.depthStencilAttachment).not.toBe(beforeRecoveryTexture);
        expect(afterRecovery.depthStencilView).not.toBe(beforeRecoveryView);
        expect(afterRecovery.depthStencilView?.texture).toBe(afterRecovery.depthStencilAttachment);
        expect(afterRecovery.depthStencilView?.aspect).toBe('depth-only');
        expect(afterRecovery.depthStencilView?.deviceId).toBe(secondDevice.id);
        expect(beforeRecoveryTexture.destroyed).toBe(true);
        expect(beforeRecoveryView.destroyed).toBe(true);

        const finalTexture = afterRecovery.depthStencilAttachment as FakeRHITexture;
        const finalView = afterRecovery.depthStencilView;
        if (finalView === null) throw new Error('Recovered depth view is missing');
        resources.markUsed(record, 5);
        expect(resources.release(owner)).toBe(true);
        expect(registry.collect(4)).toBe(0);
        expect(registry.collect(5)).toBe(2);
        expect(finalTexture.destroyed).toBe(true);
        expect(finalView.destroyed).toBe(true);

        let failedTexture: FakeRHITexture | undefined;
        const createSecondTexture = secondDevice.createTexture.bind(secondDevice);
        const failedAllocation = vi
            .spyOn(secondDevice, 'createTexture')
            .mockImplementation((descriptor: RHITextureDescriptor) => {
                const texture = createSecondTexture(descriptor);
                failedTexture = texture;
                vi.spyOn(texture, 'createView').mockImplementation(() => {
                    throw new Error('injected sampled-depth view allocation failure');
                });
                return texture;
            });
        expect(() =>
            resources.prepare(
                {},
                {
                    width: 2,
                    height: 2,
                    colorFormats: [],
                    depthStencilFormat: 'depth24plus',
                    depthStencilSampled: true
                }
            )
        ).toThrow('injected sampled-depth view allocation failure');
        expect(failedTexture?.destroyed).toBe(true);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 0,
            pendingReleaseCount: 0
        });
        failedAllocation.mockRestore();

        resources.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('links consumer-first sampled reads to the complete producer chain and preserves old-content reads', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const bridge = new RenderTargetGraphBridge(resources);
        const record = resources.prepare(
            {},
            {
                label: 'sampled producer',
                width: 4,
                height: 4,
                colorFormats: ['rgba8unorm'],
                sampleCount: 4,
                multisampleAttachmentLifetime: 'graph-transient'
            }
        );
        const dependency = Object.freeze({
            record,
            attachment: 'color' as const,
            attachmentIndex: 0
        });

        const graph = new RenderGraph();
        const builder = graph.createBuilder();
        const output = builder.createTexture('final consumer output', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const consumer = new SharedDrawPassParameters({ colorAttachments: 1, readTextures: 2 });
        consumer.label = 'consumer';
        consumer.addColorAttachment({
            texture: output,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        });
        expect(bridge.addSampledTextureReads(builder, consumer, [dependency, dependency])).toBe(1);
        builder.addPass(MainPassTemplate, consumer);

        const imported = bridge.import(builder, record);
        const color = imported.colorAttachments[0];
        if (!color?.resolveTarget) {
            throw new Error('MSAA producer import is incomplete');
        }
        const firstWriter = new SharedDrawPassParameters({ colorAttachments: 1 });
        firstWriter.label = 'producer opaque';
        firstWriter.addColorAttachment({
            texture: color.texture,
            resolveTarget: color.resolveTarget,
            clearValue: { r: 1, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        });
        builder.addPass(MainPassTemplate, firstWriter);
        const lastWriter = new SharedDrawPassParameters({ colorAttachments: 1 });
        lastWriter.label = 'producer transparent';
        lastWriter.addColorAttachment({
            texture: color.texture,
            resolveTarget: color.resolveTarget,
            loadOp: 'load',
            storeOp: 'discard'
        });
        builder.addPass(MainPassTemplate, lastWriter);
        builder.markOutput(output);

        const compiled = graph.compile(builder, device.capabilities);
        expect(
            compiled.passes.map(pass => (pass.params as SharedDrawPassParameters).label)
        ).toEqual(['producer opaque', 'producer transparent', 'consumer']);
        expect(compiled.resources.find(resource => resource.handle === color.texture)?.origin).toBe(
            'transient'
        );
        graph.destroy();

        const oldContentGraph = new RenderGraph();
        const oldContentBuilder = oldContentGraph.createBuilder();
        const oldContentOutput = oldContentBuilder.createTexture('old-content output', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const oldContentConsumer = new SharedDrawPassParameters({
            colorAttachments: 1,
            readTextures: 1
        });
        oldContentConsumer.label = 'old-content consumer';
        oldContentConsumer.addColorAttachment({
            texture: oldContentOutput,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        });
        bridge.addSampledTextureReads(oldContentBuilder, oldContentConsumer, [dependency]);
        oldContentBuilder.addPass(MainPassTemplate, oldContentConsumer);
        oldContentBuilder.markOutput(oldContentOutput);
        expect(
            oldContentGraph
                .compile(oldContentBuilder, device.capabilities)
                .passes.map(pass => (pass.params as SharedDrawPassParameters).label)
        ).toEqual(['old-content consumer']);
        oldContentGraph.destroy();

        const ordinaryTexture = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.TEXTURE_BINDING
        });
        const ordinaryGraph = new RenderGraph();
        const ordinaryBuilder = ordinaryGraph.createBuilder();
        const ordinary = ordinaryBuilder.importTexture(
            'ordinary imported texture',
            ordinaryTexture
        );
        const ordinaryOutput = ordinaryBuilder.createTexture('ordinary output', {
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const ordinaryConsumer = new SharedDrawPassParameters({ colorAttachments: 1 });
        ordinaryConsumer.label = 'ordinary consumer';
        ordinaryConsumer.addReadTexture(ordinary);
        ordinaryConsumer.addColorAttachment({
            texture: ordinaryOutput,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        });
        ordinaryBuilder.addPass(MainPassTemplate, ordinaryConsumer);
        const ordinaryLaterWriter = new SharedDrawPassParameters({ colorAttachments: 1 });
        ordinaryLaterWriter.label = 'ordinary later writer';
        ordinaryLaterWriter.addColorAttachment({
            texture: ordinary,
            clearValue: { r: 1, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store'
        });
        ordinaryBuilder.addPass(MainPassTemplate, ordinaryLaterWriter);
        ordinaryBuilder.markOutput(ordinaryOutput);
        expect(
            ordinaryGraph
                .compile(ordinaryBuilder, device.capabilities)
                .passes.map(pass => (pass.params as SharedDrawPassParameters).label)
        ).toEqual(['ordinary consumer']);
        ordinaryGraph.destroy();
        ordinaryTexture.destroy();

        const feedbackGraph = new RenderGraph();
        const feedbackBuilder = feedbackGraph.createBuilder();
        const feedbackTarget = bridge.import(feedbackBuilder, record);
        const feedbackColor = feedbackTarget.colorAttachments[0];
        if (!feedbackColor?.resolveTarget) {
            throw new Error('Feedback target import is incomplete');
        }
        const feedback = new SharedDrawPassParameters({ colorAttachments: 1, readTextures: 1 });
        feedback.label = 'feedback';
        bridge.addSampledTextureReads(feedbackBuilder, feedback, [dependency]);
        feedback.addColorAttachment({
            texture: feedbackColor.texture,
            resolveTarget: feedbackColor.resolveTarget,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'discard'
        });
        expect(() => feedbackBuilder.addPass(MainPassTemplate, feedback)).toThrow(
            /feedback|conflicts/u
        );
        feedbackGraph.destroy();

        resources.destroy();
        expect(registry.collect(0)).toBe(2);
        registry.destroy();
        backend.destroy();
    });

    it('rolls back a partial resize and rejects invalid targets before beginFrame', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const owner = {};
        const record = resources.prepare(owner, {
            width: 2,
            height: 2,
            colorFormats: ['rgba8unorm']
        });
        expect(resources.resize(owner, 2, 2)).toBe(record);
        expect(record.revision).toBe(1);
        const originalHandle = record.colorAttachments[0]?.texture;
        const originalTexture = resources.resolve(record).colors[0]?.texture;
        const createTexture = device.createTexture.bind(device);
        let stagedCreates = 0;
        const createTextureSpy = vi
            .spyOn(device, 'createTexture')
            .mockImplementation((descriptor: RHITextureDescriptor) => {
                if (stagedCreates++ === 1) throw new Error('staged resolve allocation failed');
                return createTexture(descriptor);
            });

        expect(() =>
            resources.prepare(owner, {
                width: 4,
                height: 4,
                colorFormats: ['rgba8unorm'],
                sampleCount: 4
            })
        ).toThrow('staged resolve allocation failed');
        expect(record).toMatchObject({ revision: 1, width: 2, height: 2, sampleCount: 1 });
        expect(record.colorAttachments[0]?.texture).toBe(originalHandle);
        expect(resources.resolve(record).colors[0]?.texture).toBe(originalTexture);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 2,
            pendingReleaseCount: 0
        });
        createTextureSpy.mockRestore();

        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');
        const frame = new RenderGraphFrame();
        expect(() =>
            frame.execute(frameContext(device), () => {
                resources.prepare(
                    {},
                    {
                        width: 4,
                        height: 4,
                        colorFormats: ['rgba8unorm'],
                        sampleCount: 2
                    }
                );
            })
        ).toThrow(/sample count/u);
        expect(beginFrame).not.toHaveBeenCalled();

        frame.destroy();
        resources.destroy();
        expect(registry.collect(0)).toBe(2);
        registry.destroy();
        backend.destroy();
    });
});
