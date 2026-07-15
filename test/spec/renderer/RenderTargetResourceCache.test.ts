import {
    RenderTargetResourceCache,
    selectRenderTargetMultisampleAttachmentLifetime
} from '../../../src/render/renderer/RenderTargetResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import type { RHITextureDescriptor } from '../../../src/render/rhi/core';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebGLRHIBackend, type FakeRHITexture } from '../rhi/v2/FakeRHIBackend';

describe('RenderTargetResourceCache multisample lifetime', () => {
    it('selects graph ownership only when every boundary operation is clear/discard', () => {
        const colorTarget = {
            width: 4,
            height: 4,
            colorFormats: ['rgba8unorm'] as const,
            sampleCount: 4 as const
        };
        expect(selectRenderTargetMultisampleAttachmentLifetime(colorTarget, {})).toBe(
            'graph-transient'
        );
        expect(
            selectRenderTargetMultisampleAttachmentLifetime(colorTarget, {
                colorOperations: [{ loadOp: 'load' }]
            })
        ).toBe('persistent');
        expect(
            selectRenderTargetMultisampleAttachmentLifetime(colorTarget, {
                colorOperations: [{ storeOp: 'store' }]
            })
        ).toBe('persistent');
        expect(
            selectRenderTargetMultisampleAttachmentLifetime(
                { ...colorTarget, depthStencilFormat: 'depth24plus-stencil8' },
                { depthLoadOp: 'load' }
            )
        ).toBe('persistent');
        expect(
            selectRenderTargetMultisampleAttachmentLifetime(
                { ...colorTarget, depthStencilFormat: 'depth24plus-stencil8' },
                { stencilStoreOp: 'store' }
            )
        ).toBe('persistent');
        expect(
            selectRenderTargetMultisampleAttachmentLifetime({ ...colorTarget, sampleCount: 1 }, {})
        ).toBe('persistent');
    });

    it('owns only resolves and readable views for graph-transient MRT plus depth', () => {
        const backend = new FakeWebGLRHIBackend();
        const firstDevice = backend.createDevice();
        const createFirstTexture = vi.spyOn(firstDevice, 'createTexture');
        const registry = new ResourceRegistry(firstDevice);
        const resources = new RenderTargetResourceCache(registry);
        const owner = {};
        const record = resources.prepare(owner, {
            label: 'transient MRT',
            width: 8,
            height: 6,
            colorFormats: ['rgba8unorm', 'rgba16float'],
            sampleCount: 4,
            multisampleAttachmentLifetime: 'graph-transient',
            depthStencilFormat: 'depth24plus-stencil8'
        });

        expect(record.multisampleAttachmentLifetime).toBe('graph-transient');
        expect(record.colorAttachments).toHaveLength(2);
        for (const color of record.colorAttachments) {
            expect(color).toMatchObject({
                attachmentLifetime: 'graph-transient',
                texture: null
            });
            expect(color.textureDescriptor).toMatchObject({
                lifetime: 'transient',
                sampleCount: 4
            });
            expect(color.resolveTarget).not.toBeNull();
            expect(color.readableTexture).toBe(color.resolveTarget);
            expect(color.readableDescriptor).toMatchObject({
                lifetime: 'persistent',
                sampleCount: 1
            });
        }
        expect(record.depthStencilAttachment).toMatchObject({
            attachmentLifetime: 'graph-transient',
            texture: null,
            sampledView: null,
            textureDescriptor: { lifetime: 'transient', sampleCount: 4 }
        });
        expect(createFirstTexture).toHaveBeenCalledTimes(2);
        expect(
            createFirstTexture.mock.calls.every(([descriptor]) => descriptor.sampleCount === 1)
        ).toBe(true);
        expect(registry.diagnostics()).toMatchObject({
            trackedResourceCount: 4,
            pendingReleaseCount: 0
        });

        const resolved = resources.resolve(record);
        expect(resolved.colors.map(color => color.texture)).toEqual([null, null]);
        expect(resolved.colors[0]?.resolveTarget).toBe(resolved.colors[0]?.readableTexture);
        expect(resolved.depthStencilAttachment).toBeNull();
        resources.markUsed(record, 3);

        const colorHandles = record.colorAttachments.map(color => color.resolveTarget);
        const secondDevice = backend.createDevice();
        const createSecondTexture = vi.spyOn(secondDevice, 'createTexture');
        registry.recover(secondDevice);
        expect(createSecondTexture).toHaveBeenCalledTimes(2);
        expect(
            createSecondTexture.mock.calls.every(([descriptor]) => descriptor.sampleCount === 1)
        ).toBe(true);
        expect(record.colorAttachments.map(color => color.resolveTarget)).toEqual(colorHandles);
        expect(resources.resolve(record).colors[0]?.readableTexture.deviceId).toBe(secondDevice.id);

        const resized = resources.resize(owner, 10, 7);
        expect(resized).toBe(record);
        expect(record).toMatchObject({
            revision: 2,
            width: 10,
            height: 7,
            multisampleAttachmentLifetime: 'graph-transient'
        });
        expect(record.colorAttachments.every(color => color.texture === null)).toBe(true);
        expect(record.depthStencilAttachment?.texture).toBeNull();

        resources.markUsed(record, 4);
        resources.destroy();
        expect(registry.collect(4)).toBe(8);
        registry.destroy();
        backend.destroy();
    });

    it('atomically replaces lifetime policies and rolls back a partial transient allocation', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const resources = new RenderTargetResourceCache(registry);
        const owner = {};
        const descriptor = {
            label: 'switching MRT',
            width: 4,
            height: 4,
            colorFormats: ['rgba8unorm', 'rgba8unorm'] as const,
            sampleCount: 4 as const,
            depthStencilFormat: 'depth24plus' as const
        };
        const persistent = resources.prepare(owner, descriptor, 'persistent');
        expect(persistent.multisampleAttachmentLifetime).toBe('persistent');
        expect(persistent.colorAttachments.every(color => color.texture !== null)).toBe(true);
        expect(persistent.depthStencilAttachment?.texture).not.toBeNull();

        const transient = resources.prepare(owner, descriptor, 'graph-transient');
        expect(transient).toBe(persistent);
        expect(transient).toMatchObject({
            revision: 2,
            multisampleAttachmentLifetime: 'graph-transient'
        });
        expect(transient.colorAttachments.every(color => color.texture === null)).toBe(true);
        expect(transient.depthStencilAttachment?.texture).toBeNull();
        const stableResolve = transient.colorAttachments[0]?.resolveTarget;
        const stableTexture = resources.resolve(transient).colors[0]
            ?.readableTexture as FakeRHITexture;

        const createTexture = device.createTexture.bind(device);
        let stagedCreates = 0;
        const createTextureSpy = vi
            .spyOn(device, 'createTexture')
            .mockImplementation((textureDescriptor: RHITextureDescriptor) => {
                if (stagedCreates++ === 1) {
                    throw new Error('injected second resolve failure');
                }
                return createTexture(textureDescriptor);
            });
        expect(() =>
            resources.prepare(
                owner,
                { ...descriptor, width: 7, multisampleAttachmentLifetime: 'graph-transient' },
                'graph-transient'
            )
        ).toThrow('injected second resolve failure');
        expect(transient).toMatchObject({
            revision: 2,
            width: 4,
            multisampleAttachmentLifetime: 'graph-transient'
        });
        expect(transient.colorAttachments[0]?.resolveTarget).toBe(stableResolve);
        expect(resources.resolve(transient).colors[0]?.readableTexture).toBe(stableTexture);
        createTextureSpy.mockRestore();

        expect(() =>
            resources.prepare(
                {},
                {
                    width: 2,
                    height: 2,
                    colorFormats: ['rgba8unorm'],
                    sampleCount: 1,
                    multisampleAttachmentLifetime: 'graph-transient'
                }
            )
        ).toThrow(/require sampleCount four/u);

        resources.destroy();
        registry.collect(0);
        registry.destroy();
        backend.destroy();
    });
});
