import type Texture from '../../../src/texture/Texture';
import type {
    RenderTargetColorAttachmentReadback,
    RenderTargetReadColorAttachmentOptions
} from '../../../src/render/RenderTarget';
import {
    RHIRenderTarget,
    type RHIRenderTargetHost
} from '../../../src/render/renderer/RHIRenderTarget';
import { RenderTargetResourceCache } from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend
} from '../rhi/portable/FakeRHIBackend';

function createHost(backend: FakeRHIBackend) {
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const renderTargetResources = new RenderTargetResourceCache(registry);
    const unregister = vi.fn();
    const registerRenderTargetColorTexture = vi.fn(
        (_target: RHIRenderTarget, _index: number, _texture: Texture<unknown>) => unregister
    );
    const registerRenderTargetDepthTexture = vi.fn(
        (_target: RHIRenderTarget, _texture: Texture<unknown>) => unregister
    );
    const readResult: RenderTargetColorAttachmentReadback = Object.freeze({
        data: new Uint8Array([1, 2, 3, 4]),
        format: 'rgba8unorm',
        width: 1,
        height: 1,
        bytesPerPixel: 4,
        bytesPerRow: 4
    });
    const readRenderTargetColorAttachment = vi.fn(
        (_target: RHIRenderTarget, _options?: RenderTargetReadColorAttachmentOptions) =>
            Promise.resolve(readResult)
    );
    const renderTargetResized = vi.fn();
    const renderTargetDestroyed = vi.fn();
    const assertRenderTargetMutationAllowed = vi.fn();
    const host: RHIRenderTargetHost = {
        backend: device.backend,
        renderTargetResources,
        assertRenderTargetMutationAllowed,
        registerRenderTargetColorTexture,
        registerRenderTargetDepthTexture,
        readRenderTargetColorAttachment,
        renderTargetResized,
        renderTargetDestroyed
    };
    return {
        device,
        registry,
        renderTargetResources,
        host,
        unregister,
        registerRenderTargetColorTexture,
        registerRenderTargetDepthTexture,
        readRenderTargetColorAttachment,
        renderTargetResized,
        renderTargetDestroyed,
        readResult
    };
}

describe.each([
    ['WebGL immediate', () => new FakeWebGLRHIBackend()],
    ['WebGPU deferred', () => new FakeWebGPURHIBackend()]
] as const)('RHIRenderTarget on %s', (_name, createBackend) => {
    it('derives multisample source ownership from immutable attachment operations', () => {
        const backend = createBackend();
        const setup = createHost(backend);
        const transient = new RHIRenderTarget(setup.host, {
            width: 4,
            height: 4,
            sampleCount: 4,
            colorAttachments: [{ format: 'rgba8unorm' }],
            depthStencilAttachment: false
        });
        expect(transient.resourceRecord).toMatchObject({
            multisampleAttachmentLifetime: 'graph-transient',
            colorAttachments: [{ attachmentLifetime: 'graph-transient', texture: null }],
            depthStencilAttachment: null
        });
        expect(setup.registry.diagnostics().trackedResourceCount).toBe(2);

        const persistent = new RHIRenderTarget(setup.host, {
            width: 4,
            height: 4,
            sampleCount: 4,
            colorAttachments: [{ format: 'rgba8unorm', loadOp: 'load', storeOp: 'store' }],
            depthStencilAttachment: {
                format: 'depth24plus',
                depthLoadOp: 'load',
                depthStoreOp: 'store'
            }
        });
        expect(persistent.resourceRecord.multisampleAttachmentLifetime).toBe('persistent');
        expect(persistent.resourceRecord.colorAttachments[0]?.texture).not.toBeNull();
        expect(persistent.resourceRecord.depthStencilAttachment?.texture).not.toBeNull();
        expect(setup.registry.diagnostics().trackedResourceCount).toBe(6);

        transient.destroy();
        persistent.destroy();
        expect(setup.registry.collect(0)).toBe(6);
        setup.renderTargetResources.destroy();
        setup.registry.destroy();
        backend.destroy();
    });

    it('keeps public attachment identities stable through resize and device recovery', async () => {
        const backend = createBackend();
        const setup = createHost(backend);
        const target = new RHIRenderTarget(setup.host, {
            label: 'public target',
            width: 8,
            height: 6,
            colorAttachments: [
                { format: 'rgba8unorm' },
                { format: 'rgba16float', label: 'HDR output' }
            ],
            depthStencilAttachment: {
                format: 'depth24plus-stencil8',
                sampled: true,
                compare: 'less-equal'
            }
        });

        expect(target).toMatchObject({
            backend: setup.device.backend,
            label: 'public target',
            width: 8,
            height: 6,
            sampleCount: 1,
            colorAttachmentCount: 2,
            colorFormats: ['rgba8unorm', 'rgba16float'],
            depthStencilFormat: 'depth24plus-stencil8',
            isDestroyed: false
        });
        expect(target.belongsTo(setup.host)).toBe(true);
        expect(setup.registerRenderTargetColorTexture).toHaveBeenCalledTimes(2);
        expect(setup.registerRenderTargetDepthTexture).toHaveBeenCalledOnce();
        const color0 = target.getColorTexture();
        const color1 = target.getColorTexture(1);
        const depth = target.getDepthTexture();
        if (depth === null) throw new Error('Sampled depth identity is missing');
        expect(color0).toMatchObject({ width: 8, height: 6, name: 'public target.color[0]' });
        expect(color1).toMatchObject({ width: 8, height: 6, name: 'HDR output' });
        expect(depth).toMatchObject({ width: 8, height: 6 });
        const firstRecord = target.resourceRecord;
        const firstColorHandle = firstRecord.colorAttachments[0]?.readableTexture;
        expect(
            setup.renderTargetResources.prepare(target, {
                label: 'public target',
                width: 8,
                height: 6,
                colorFormats: ['rgba8unorm', 'rgba16float'],
                sampleCount: 1,
                depthStencilFormat: 'depth24plus-stencil8',
                depthStencilSampled: true
            })
        ).toBe(firstRecord);
        expect(setup.renderTargetResources.metrics).toMatchObject({
            hits: 1,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });

        target.resize(13, 7);
        expect(setup.renderTargetResized).toHaveBeenCalledOnce();
        expect(setup.renderTargetResized).toHaveBeenCalledWith(target);
        expect(target).toMatchObject({ width: 13, height: 7 });
        expect(target.getColorTexture()).toBe(color0);
        expect(target.getColorTexture(1)).toBe(color1);
        expect(target.getDepthTexture()).toBe(depth);
        expect(color0).toMatchObject({ width: 13, height: 7 });
        expect(depth).toMatchObject({ width: 13, height: 7 });
        expect(target.resourceRecord).toBe(firstRecord);
        expect(target.resourceRecord.revision).toBe(2);
        expect(target.resourceRecord.colorAttachments[0]?.readableTexture).not.toBe(
            firstColorHandle
        );
        expect(setup.renderTargetResources.metrics).toMatchObject({
            hits: 1,
            misses: 2,
            evictions: 1,
            size: 1,
            highWater: 1
        });

        const resizedColorHandle = target.resourceRecord.colorAttachments[0]?.readableTexture;
        const secondDevice = backend.createDevice();
        setup.registry.recover(secondDevice);
        expect(target.resourceRecord.colorAttachments[0]?.readableTexture).toBe(resizedColorHandle);
        expect(setup.renderTargetResources.resolve(target.resourceRecord).colors).toHaveLength(2);
        expect(setup.renderTargetResources.metrics).toMatchObject({
            hits: 1,
            misses: 2,
            evictions: 1,
            size: 1,
            highWater: 1
        });

        await expect(
            target.readColorAttachment({ attachmentIndex: 1, x: 2, y: 1, width: 1, height: 1 })
        ).resolves.toBe(setup.readResult);
        expect(setup.readRenderTargetColorAttachment).toHaveBeenCalledWith(target, {
            attachmentIndex: 1,
            x: 2,
            y: 1,
            width: 1,
            height: 1
        });

        target.destroy();
        expect(setup.renderTargetResources.metrics).toMatchObject({
            hits: 1,
            misses: 2,
            evictions: 2,
            size: 0,
            highWater: 1
        });
        expect(target.isDestroyed).toBe(true);
        expect(setup.unregister).toHaveBeenCalledTimes(3);
        expect(setup.renderTargetDestroyed).toHaveBeenCalledWith(target);
        expect(() => target.getColorTexture()).toThrow(/destroyed/);
        expect(setup.registry.collect(0)).toBe(12);
        setup.renderTargetResources.destroy();
        setup.registry.destroy();
        backend.destroy();
    });

    it('cascades attachment destruction and rejects invalid attachment access', () => {
        const backend = createBackend();
        const setup = createHost(backend);
        const target = new RHIRenderTarget(setup.host, {
            width: 2,
            height: 3,
            colorAttachments: [{ format: 'rgba32float' }],
            depthStencilAttachment: false
        });
        const color = target.getColorTexture();
        expect(color.minFilter).toBe(color.magFilter);
        expect(() => target.getColorTexture(-1)).toThrow(/non-negative/);
        expect(() => target.getColorTexture(1)).toThrow(/does not exist/);
        expect(target.getDepthTexture()).toBeNull();

        color.destroy();
        expect(target.isDestroyed).toBe(true);
        expect(color).toMatchObject({ width: 0, height: 0 });
        expect(setup.renderTargetDestroyed).toHaveBeenCalledOnce();
        expect(setup.unregister).toHaveBeenCalledOnce();
        expect(setup.registry.collect(0)).toBe(2);
        setup.renderTargetResources.destroy();
        setup.registry.destroy();
        backend.destroy();
    });
});
