import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import { FLOAT } from '../../../src/constants/webgl';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import type {
    RenderTargetColorAttachmentReadback,
    RenderTargetReadColorAttachmentOptions
} from '../../../src/render/RenderTarget';
import { RenderGraphFrame } from '../../../src/render/frame/RenderGraphFrame';
import type { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import { createRenderGraphFrameContext } from '../../../src/render/frame/RenderGraphFrameContext';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import { RHITextureUsage, type RHISampler } from '../../../src/render/rhi/core';
import {
    RHIRenderTarget,
    type RHIRenderTargetHost
} from '../../../src/render/renderer/RHIRenderTarget';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { RenderTargetTextureBindingProvider } from '../../../src/render/renderer/RenderTargetTextureBindingProvider';
import {
    ResourceRegistry,
    type ResourceRegistryHandle
} from '../../../src/render/renderer/ResourceRegistry';
import { describe, expect, it, vi } from 'vitest';
import { getTextureRecoveryBacking } from '../../../src/texture/Texture';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice,
    type FakeRHITexture
} from '../rhi/portable/FakeRHIBackend';

interface Fixture {
    readonly backend: FakeRHIBackend;
    device: FakeRHIDevice;
    readonly registry: ResourceRegistry;
    readonly resources: RenderTargetResourceCache;
    readonly target: RHIRenderTarget;
    readonly frame: RenderGraphFrame;
    readonly sampler: ResourceRegistryHandle<RHISampler>;
    readonly provider: RenderTargetTextureBindingProvider;
    uploads: RHIUploadBatch | null;
}

function frameContext(fixture: Fixture, frameIndex: number) {
    return createRenderGraphFrameContext({
        renderer: {} as RendererCore,
        rhi: fixture.device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: {
            x: 0,
            y: 0,
            width: fixture.target.width,
            height: fixture.target.height,
            minDepth: 0,
            maxDepth: 1
        }
    });
}

function createFixture(backend: FakeRHIBackend): Fixture {
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const resources = new RenderTargetResourceCache(registry);
    let provider: RenderTargetTextureBindingProvider | null = null;
    const readResult: RenderTargetColorAttachmentReadback = Object.freeze({
        data: new Uint8Array(),
        format: 'rgba8unorm',
        width: 0,
        height: 0,
        bytesPerPixel: 4,
        bytesPerRow: 0
    });
    const host: RHIRenderTargetHost = {
        backend: device.backend,
        renderTargetResources: resources,
        assertRenderTargetMutationAllowed: vi.fn(),
        registerRenderTargetColorTexture: () => () => undefined,
        registerRenderTargetDepthTexture: () => () => undefined,
        readRenderTargetColorAttachment: (
            _target: RHIRenderTarget,
            _options?: RenderTargetReadColorAttachmentOptions
        ) => Promise.resolve(readResult),
        renderTargetResized: () => provider?.rebaseAllocation(),
        renderTargetDestroyed: vi.fn()
    };
    const target = new RHIRenderTarget(host, {
        label: 'attachment updates',
        width: 4,
        height: 4,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: false
    });
    const sampler = registry.registerSampler({
        minFilter: 'nearest',
        magFilter: 'nearest',
        mipmapFilter: 'nearest'
    });
    const fixture: Fixture = {
        backend,
        device,
        registry,
        resources,
        target,
        frame: new RenderGraphFrame(),
        sampler,
        provider: undefined as unknown as RenderTargetTextureBindingProvider,
        uploads: null
    };
    provider = new RenderTargetTextureBindingProvider({
        target,
        attachmentIndex: 0,
        texture: target.getColorTexture(),
        registry,
        sampler,
        comparisonSampler: null,
        getUploadBatch: () => {
            if (fixture.uploads === null) throw new Error('Fixture has no active upload batch');
            return fixture.uploads;
        }
    });
    Object.defineProperty(fixture, 'provider', { value: provider });
    return fixture;
}

const sideEffectPass: RenderPassTemplate<{ readonly executeError: boolean }> = {
    name: 'render-target texture update test',
    setup(builder) {
        builder.markSideEffect();
    },
    execute(_context, parameters) {
        if (parameters.executeError) throw new Error('attachment update execute failure');
    }
};

function runFrame(fixture: Fixture, frameIndex: number, prepare: () => void, executeError = false) {
    try {
        return fixture.frame.execute(frameContext(fixture, frameIndex), scope => {
            fixture.uploads = scope.uploads;
            prepare();
            scope.graph.addPass(sideEffectPass, { executeError });
        });
    } finally {
        fixture.uploads = null;
    }
}

async function complete(fixture: Fixture): Promise<void> {
    if (fixture.backend.executionMode !== 'deferred') return;
    const submission = fixture.backend.completeNextSubmission();
    await submission.done;
}

function currentTexture(fixture: Fixture): FakeRHITexture {
    const handle = fixture.target.resourceRecord.colorAttachments[0]?.readableTexture;
    if (handle === undefined) throw new Error('Fixture color attachment is missing');
    return fixture.registry.resolve(handle) as FakeRHITexture;
}

function destroyFixture(fixture: Fixture): void {
    fixture.target.destroy();
    fixture.registry.release(fixture.sampler);
    fixture.registry.collect(Number.MAX_SAFE_INTEGER);
    fixture.resources.destroy();
    fixture.frame.destroy();
    fixture.registry.destroy();
    fixture.backend.destroy();
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('RenderTargetTextureBindingProvider on %s', (_name, createBackend) => {
    it('uploads one incremental patch once across repeated sampler resolves', async () => {
        const fixture = createFixture(createBackend());
        const texture = fixture.target.getColorTexture();
        texture.updateSubTexture({
            mipLevel: 0,
            x: 1,
            y: 2,
            width: 1,
            height: 1,
            image: new ImageData(new Uint8ClampedArray([255, 0, 255, 255]), 1, 1)
        });

        runFrame(fixture, 1, () => {
            expect(fixture.provider.resolve('sampler')).not.toBeNull();
            expect(fixture.provider.resolve('sampler')).not.toBeNull();
        });
        await complete(fixture);

        expect(fixture.provider.committedRevision).toBe(texture.updateRevision);
        expect(fixture.provider.pendingRevision).toBeNull();
        expect(
            fixture.backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toHaveLength(1);
        expect([...currentTexture(fixture).snapshotLastWriteBytes()]).toEqual([255, 0, 255, 255]);
        destroyFixture(fixture);
    });

    it('retains its backend-local revision after execute failure and retries', async () => {
        const fixture = createFixture(createBackend());
        const texture = fixture.target.getColorTexture();
        const baseline = fixture.provider.committedRevision;
        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: new Uint8Array([9, 8, 7, 6])
        });

        expect(() => runFrame(fixture, 1, () => fixture.provider.resolve('sampler'), true)).toThrow(
            /execute failure/
        );
        expect(fixture.provider.committedRevision).toBe(baseline);
        expect(fixture.provider.pendingRevision).toBeNull();

        runFrame(fixture, 2, () => fixture.provider.resolve('sampler'));
        await complete(fixture);
        expect(fixture.provider.committedRevision).toBe(texture.updateRevision);
        expect([...currentTexture(fixture).snapshotLastWriteBytes()]).toEqual([9, 8, 7, 6]);
        destroyFixture(fixture);
    });

    it('clears pending state when resolved outside a frame and retries next frame', async () => {
        const fixture = createFixture(createBackend());
        const texture = fixture.target.getColorTexture();
        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 1,
            width: 1,
            height: 1,
            image: new Uint8Array([31, 32, 33, 34])
        });

        expect(() => fixture.provider.resolve('sampler')).toThrow(/no active upload batch/i);
        expect(fixture.provider.pendingRevision).toBeNull();
        runFrame(fixture, 1, () => fixture.provider.resolve('sampler'));
        await complete(fixture);
        expect(fixture.provider.committedRevision).toBe(texture.updateRevision);
        expect([...currentTexture(fixture).snapshotLastWriteBytes()]).toEqual([31, 32, 33, 34]);
        destroyFixture(fixture);
    });

    it('rolls back when the source revision changes after its first frame resolve', async () => {
        const fixture = createFixture(createBackend());
        const texture = fixture.target.getColorTexture();
        const baseline = fixture.provider.committedRevision;
        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: new Uint8Array([41, 42, 43, 44])
        });

        expect(() =>
            runFrame(fixture, 1, () => {
                fixture.provider.resolve('sampler');
                texture.updateSubTexture({
                    mipLevel: 0,
                    x: 1,
                    y: 0,
                    width: 1,
                    height: 1,
                    image: new Uint8Array([51, 52, 53, 54])
                });
            })
        ).toThrow(/changed after its first frame use/);
        await complete(fixture);
        expect(fixture.provider.committedRevision).toBe(baseline);
        expect(fixture.provider.pendingRevision).toBeNull();

        runFrame(fixture, 2, () => fixture.provider.resolve('sampler'));
        await complete(fixture);
        expect(fixture.provider.committedRevision).toBe(texture.updateRevision);
        expect([...currentTexture(fixture).snapshotLastWriteBytes()]).toEqual([51, 52, 53, 54]);
        destroyFixture(fixture);
    });

    it('rebases at resize and recovery without replaying old partial patches', async () => {
        const fixture = createFixture(createBackend());
        const texture = fixture.target.getColorTexture();
        const graphDependency = fixture.provider.graphDependency;
        expect(graphDependency).toEqual({
            record: fixture.target.resourceRecord,
            attachment: 'color',
            attachmentIndex: 0
        });
        expect(Object.isFrozen(graphDependency)).toBe(true);
        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });

        fixture.target.resize(8, 6);
        expect(fixture.provider.graphDependency).toBe(graphDependency);
        expect(graphDependency.record).toBe(fixture.target.resourceRecord);
        fixture.backend.resetExecutionLog();
        runFrame(fixture, 1, () => fixture.provider.resolve('sampler'));
        await complete(fixture);
        expect(
            fixture.backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toHaveLength(0);

        texture.updateSubTexture({
            mipLevel: 0,
            x: 7,
            y: 5,
            width: 1,
            height: 1,
            image: new Uint8Array([5, 6, 7, 8])
        });
        runFrame(fixture, 2, () => fixture.provider.resolve('sampler'));
        await complete(fixture);
        expect([...currentTexture(fixture).snapshotLastWriteBytes()]).toEqual([5, 6, 7, 8]);

        texture.updateSubTexture({
            mipLevel: 0,
            x: 6,
            y: 5,
            width: 1,
            height: 1,
            image: new Uint8Array([11, 12, 13, 14])
        });
        expect(getTextureRecoveryBacking(texture)).toBeDefined();
        const replacement = fixture.backend.createDevice();
        fixture.registry.recover(replacement);
        fixture.device = replacement;
        fixture.provider.rebaseAllocation();
        expect(getTextureRecoveryBacking(texture)).toBeUndefined();
        expect(texture.getTextureUpdatesSince(texture.updateRevision).subTextures).toEqual([]);
        fixture.backend.resetExecutionLog();
        runFrame(fixture, 3, () => fixture.provider.resolve('sampler'));
        await complete(fixture);
        expect(
            fixture.backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toHaveLength(0);

        texture.updateSubTexture({
            mipLevel: 0,
            x: 5,
            y: 5,
            width: 1,
            height: 1,
            image: new Uint8Array([21, 22, 23, 24])
        });
        runFrame(fixture, 4, () => fixture.provider.resolve('sampler'));
        await complete(fixture);
        expect([...currentTexture(fixture).snapshotLastWriteBytes()]).toEqual([21, 22, 23, 24]);
        destroyFixture(fixture);
    });
});

it('grants COPY_DST only to exposed single-sample color allocations', () => {
    const backend = new FakeWebGLRHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const resources = new RenderTargetResourceCache(registry);
    const owner = {};
    const record = resources.prepare(owner, {
        width: 4,
        height: 4,
        colorFormats: ['rgba8unorm'],
        sampleCount: 4,
        depthStencilFormat: 'depth24plus',
        depthStencilSampled: false
    });
    const resolved = resources.resolve(record);
    const color = resolved.colors[0];
    if (color === undefined) throw new Error('Color attachment is missing');
    if (color.texture === null) throw new Error('Persistent color source is missing');
    expect(color.texture.usage & RHITextureUsage.COPY_DST).toBe(0);
    expect((color.resolveTarget?.usage ?? 0) & RHITextureUsage.COPY_DST).not.toBe(0);
    expect((resolved.depthStencilAttachment?.usage ?? 0) & RHITextureUsage.COPY_DST).toBe(0);
    const sampledDepthOwner = {};
    const sampledDepthRecord = resources.prepare(sampledDepthOwner, {
        width: 4,
        height: 4,
        colorFormats: [],
        sampleCount: 1,
        depthStencilFormat: 'depth32float',
        depthStencilSampled: true
    });
    const sampledDepth = resources.resolve(sampledDepthRecord).depthStencilAttachment;
    expect((sampledDepth?.usage ?? 0) & RHITextureUsage.COPY_DST).toBe(0);
    resources.release(owner);
    resources.release(sampledDepthOwner);
    registry.collect(0);
    resources.destroy();
    registry.destroy();
    backend.destroy();
});

it('rejects full color replacement and public depth attachment updates explicitly', () => {
    const fixture = createFixture(new FakeWebGLRHIBackend());
    fixture.target.getColorTexture().image = new Uint8Array(4 * 4 * 4);
    expect(() => runFrame(fixture, 1, () => fixture.provider.resolve('sampler'))).toThrow(
        /only incremental updateSubTexture/
    );
    destroyFixture(fixture);

    const backend = new FakeWebGLRHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const resources = new RenderTargetResourceCache(registry);
    let depthProvider: RenderTargetTextureBindingProvider | null = null;
    let uploads: RHIUploadBatch | null = null;
    const host: RHIRenderTargetHost = {
        backend: device.backend,
        renderTargetResources: resources,
        assertRenderTargetMutationAllowed: vi.fn(),
        registerRenderTargetColorTexture: () => () => undefined,
        registerRenderTargetDepthTexture: () => () => undefined,
        readRenderTargetColorAttachment: () => Promise.reject(new Error('unused')),
        renderTargetResized: () => depthProvider?.rebaseAllocation(),
        renderTargetDestroyed: vi.fn()
    };
    const target = new RHIRenderTarget(host, {
        width: 2,
        height: 2,
        colorAttachments: [],
        depthStencilAttachment: {
            format: 'depth32float',
            sampled: true,
            compare: 'less-equal'
        }
    });
    const comparisonSampler = registry.registerSampler({ compare: 'less-equal' });
    const depth = target.getDepthTexture();
    if (depth === null) throw new Error('Depth attachment is missing');
    depthProvider = new RenderTargetTextureBindingProvider({
        target,
        attachmentIndex: null,
        texture: depth,
        registry,
        sampler: null,
        comparisonSampler,
        getUploadBatch: () => {
            if (uploads === null) throw new Error('No active upload batch');
            return uploads;
        }
    });
    expect(depthProvider.graphDependency).toEqual({
        record: target.resourceRecord,
        attachment: 'sampled-depth'
    });
    expect(Object.isFrozen(depthProvider.graphDependency)).toBe(true);
    depth.type = FLOAT;
    depth.updateSubTexture({
        mipLevel: 0,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        image: new Float32Array([0.5])
    });
    const frame = new RenderGraphFrame();
    expect(() =>
        frame.execute(
            createRenderGraphFrameContext({
                renderer: {} as RendererCore,
                rhi: device,
                frameIndex: 1,
                camera: new PerspectiveCamera(),
                lightManager: new LightManager(),
                fog: null,
                viewport: { x: 0, y: 0, width: 2, height: 2, minDepth: 0, maxDepth: 1 }
            }),
            scope => {
                uploads = scope.uploads;
                depthProvider.resolve('comparison-sampler');
            }
        )
    ).toThrow(/depth\/stencil textures are unsupported/);
    uploads = null;
    target.destroy();
    registry.release(comparisonSampler);
    registry.collect(0);
    resources.destroy();
    frame.destroy();
    registry.destroy();
    backend.destroy();
});
