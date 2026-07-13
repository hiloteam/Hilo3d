import { describe, expect, it, vi } from 'vitest';
import Texture from '../../../src/texture/Texture';
import { DEPTH_COMPONENT, LINEAR, RGBA, UNSIGNED_BYTE } from '../../../src/constants/webgl';
import { DEPTH_COMPONENT24, RGBA8 } from '../../../src/constants/webgl2';
import WebGPURenderTarget from '../../../src/renderer/webgpu/WebGPURenderTarget';
import WebGPUTextureManager from '../../../src/renderer/webgpu/WebGPUTextureManager';

interface FakeTextureRecord {
    readonly descriptor: GPUTextureDescriptor;
    readonly gpuTexture: GPUTexture;
    readonly views: {
        readonly descriptor: GPUTextureViewDescriptor;
        readonly view: GPUTextureView;
    }[];
    readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakeBufferRecord {
    readonly descriptor: GPUBufferDescriptor;
    readonly bytes: Uint8Array;
    readonly mapAsync: ReturnType<typeof vi.fn>;
    readonly unmap: ReturnType<typeof vi.fn>;
    readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakeWebGPU {
    readonly device: GPUDevice;
    readonly textures: FakeTextureRecord[];
    readonly buffers: FakeBufferRecord[];
    readonly copyTextureToBuffer: ReturnType<typeof vi.fn>;
    readonly submit: ReturnType<typeof vi.fn>;
    fillReadBuffer: ((bytes: Uint8Array) => void) | null;
}

function createFakeWebGPU(
    options: { maxColorAttachments?: number; maxBytes?: number } = {}
): FakeWebGPU {
    const textures: FakeTextureRecord[] = [];
    const buffers: FakeBufferRecord[] = [];
    const copyTextureToBuffer = vi.fn();
    const submit = vi.fn();
    const fake: FakeWebGPU = {
        device: null as unknown as GPUDevice,
        textures,
        buffers,
        copyTextureToBuffer,
        submit,
        fillReadBuffer: null
    };
    const device = {
        features: new Set<GPUFeatureName>(),
        limits: {
            maxTextureDimension2D: 8192,
            maxTextureArrayLayers: 256,
            maxColorAttachments: options.maxColorAttachments ?? 8,
            maxColorAttachmentBytesPerSample: options.maxBytes ?? 64
        },
        queue: { submit },
        createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
            const views: FakeTextureRecord['views'] = [];
            const destroy = vi.fn();
            const gpuTexture = {
                createView: vi.fn((viewDescriptor: GPUTextureViewDescriptor = {}) => {
                    const view = { gpuTexture, viewDescriptor } as unknown as GPUTextureView;
                    views.push({ descriptor: viewDescriptor, view });
                    return view;
                }),
                destroy
            } as unknown as GPUTexture;
            textures.push({ descriptor, gpuTexture, views, destroy });
            return gpuTexture;
        }),
        createSampler: vi.fn((descriptor: GPUSamplerDescriptor) => ({ descriptor })),
        createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
            const bytes = new Uint8Array(descriptor.size);
            const mapAsync = vi.fn(() => {
                fake.fillReadBuffer?.(bytes);
                return Promise.resolve();
            });
            const unmap = vi.fn();
            const destroy = vi.fn();
            const gpuBuffer = {
                mapAsync,
                getMappedRange: vi.fn(() => bytes.buffer),
                unmap,
                destroy
            } as unknown as GPUBuffer;
            buffers.push({ descriptor, bytes, mapAsync, unmap, destroy });
            return gpuBuffer;
        }),
        createCommandEncoder: vi.fn(() => ({
            copyTextureToBuffer,
            finish: vi.fn(() => ({ commandBuffer: true }))
        }))
    } as unknown as GPUDevice;
    (fake as { device: GPUDevice }).device = device;
    return fake;
}

describe('WebGPURenderTarget attachments and passes', () => {
    it('creates MRT resolves, multisample surfaces and depth/stencil without hidden fallback', () => {
        const fake = createFakeWebGPU();
        const textures = new WebGPUTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 64,
            height: 32,
            sampleCount: 4,
            colorAttachments: [{ format: 'rgba8unorm' }, { format: 'rgba16float' }],
            depthStencilAttachment: { format: 'depth24plus-stencil8', sampled: false }
        });

        expect(target.colorFormats).toEqual(['rgba8unorm', 'rgba16float']);
        expect(target.depthStencilFormat).toBe('depth24plus-stencil8');
        expect(target.colorTextures).toHaveLength(2);
        expect(target.depthTexture).toBeNull();
        expect(target.getRenderPassLayout()).toEqual({
            colorFormats: ['rgba8unorm', 'rgba16float'],
            depthStencilFormat: 'depth24plus-stencil8',
            sampleCount: 4
        });

        const pass = target.createRenderPassDescriptor();
        expect(pass.colorAttachments).toHaveLength(2);
        expect(pass.colorAttachments[0]?.resolveTarget).toBeDefined();
        expect(pass.colorAttachments[0]?.view).not.toBe(pass.colorAttachments[0]?.resolveTarget);
        expect(pass.colorAttachments[0]?.storeOp).toBe('discard');
        expect(pass.depthStencilAttachment?.stencilLoadOp).toBe('clear');
        expect(fake.textures.map(record => record.descriptor.sampleCount)).toEqual([1, 4, 1, 4, 4]);
        expect(textures.get(target.getColorTexture(1)).gpuTexture).toBe(
            target.getColorGPUTexture(1)
        );
    });

    it('registers an explicitly sampleable depth/stencil texture through a depth-only view', () => {
        const fake = createFakeWebGPU();
        const textures = new WebGPUTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 16,
            height: 16,
            colorAttachments: [],
            depthStencilAttachment: {
                format: 'depth24plus-stencil8',
                sampled: true,
                compare: 'greater-equal'
            }
        });

        expect(target.depthTexture).not.toBeNull();
        expect(target.createRenderPassDescriptor().colorAttachments).toEqual([]);
        expect(fake.textures).toHaveLength(1);
        expect(fake.textures[0]?.views.map(view => view.descriptor)).toEqual([
            { dimension: '2d' },
            { dimension: '2d', aspect: 'depth-only' }
        ]);
        const resource = textures
            .getResources()
            .find(candidate => candidate.textureId === target.depthTexture?.id);
        expect(resource?.gpuTexture).toBe(target.getDepthStencilGPUTexture());
    });

    it('keeps engine texture identities stable while resize replaces every GPU allocation', () => {
        const fake = createFakeWebGPU();
        const textures = new WebGPUTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 10,
            height: 20,
            sampleCount: 4
        });
        const colorTexture = target.getColorTexture();
        const original = [...fake.textures];

        target.resize(30, 40);

        expect(target.getColorTexture()).toBe(colorTexture);
        expect(colorTexture.width).toBe(30);
        expect(colorTexture.height).toBe(40);
        expect(original.every(record => record.destroy.mock.calls.length === 1)).toBe(true);
        expect(fake.textures.slice(original.length).map(record => record.descriptor.size)).toEqual([
            { width: 30, height: 40, depthOrArrayLayers: 1 },
            { width: 30, height: 40, depthOrArrayLayers: 1 },
            { width: 30, height: 40, depthOrArrayLayers: 1 }
        ]);

        const resized = fake.textures.slice(original.length);
        target.destroy();
        target.destroy();
        expect(target.isDestroyed).toBe(true);
        expect(resized.every(record => record.destroy.mock.calls.length === 1)).toBe(true);
        expect(() => target.createRenderPassDescriptor()).toThrow(/destroyed/);
    });
});

describe('WebGPURenderTarget readback', () => {
    it('uses 256-byte GPU row alignment and returns tightly packed native texel bytes', async () => {
        const fake = createFakeWebGPU();
        const textures = new WebGPUTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 3,
            height: 2,
            depthStencilAttachment: false
        });
        fake.fillReadBuffer = bytes => {
            bytes.set(
                Uint8Array.from({ length: 12 }, (_, index) => index),
                0
            );
            bytes.set(
                Uint8Array.from({ length: 12 }, (_, index) => index + 12),
                256
            );
        };

        const result = await target.readColorAttachment();

        expect(result).toEqual({
            data: Uint8Array.from({ length: 24 }, (_, index) => index),
            format: 'rgba8unorm',
            width: 3,
            height: 2,
            bytesPerPixel: 4,
            bytesPerRow: 12
        });
        expect(fake.buffers[0]?.descriptor).toMatchObject({ size: 512, usage: 9 });
        expect(fake.copyTextureToBuffer).toHaveBeenCalledWith(
            expect.objectContaining({ origin: { x: 0, y: 0, z: 0 } }),
            expect.objectContaining({ bytesPerRow: 256, rowsPerImage: 2 }),
            { width: 3, height: 2, depthOrArrayLayers: 1 }
        );
        expect(fake.buffers[0]?.unmap).toHaveBeenCalledOnce();
        expect(fake.buffers[0]?.destroy).toHaveBeenCalledOnce();
        expect(fake.submit).toHaveBeenCalledOnce();
    });
});

describe('WebGPURenderTarget validation', () => {
    it('rejects invalid limits and combinations instead of changing requested behavior', () => {
        const fake = createFakeWebGPU({ maxColorAttachments: 1, maxBytes: 8 });
        const textures = new WebGPUTextureManager(fake.device);

        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 0,
                    height: 1
                })
        ).toThrow(/positive integer/);
        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 1,
                    height: 1,
                    colorAttachments: [{}, {}],
                    depthStencilAttachment: false
                })
        ).toThrow(/device supports 1/);
        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 1,
                    height: 1,
                    colorAttachments: [],
                    depthStencilAttachment: false
                })
        ).toThrow(/at least one attachment/);
        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 1,
                    height: 1,
                    sampleCount: 4,
                    depthStencilAttachment: { sampled: true }
                })
        ).toThrow(/cannot resolve a multisampled depth/);
        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 1,
                    height: 1,
                    colorAttachments: [{ format: 'rgba32float' }],
                    depthStencilAttachment: false
                })
        ).toThrow(/bytes per sample/);
    });

    it('rejects incompatible supplied textures and unsupported attachment operations', async () => {
        const fake = createFakeWebGPU();
        const textures = new WebGPUTextureManager(fake.device);
        const depthTexture = new Texture({
            width: 2,
            height: 2,
            internalFormat: DEPTH_COMPONENT24,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_BYTE,
            minFilter: LINEAR,
            magFilter: LINEAR,
            image: null
        });
        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 2,
                    height: 2,
                    colorAttachments: [{ texture: depthTexture }],
                    depthStencilAttachment: false
                })
        ).toThrow(/Color attachment 0 format/);

        const sourceTexture = new Texture({
            width: 2,
            height: 2,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            minFilter: LINEAR,
            magFilter: LINEAR,
            image: new Uint8Array(16)
        });
        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 2,
                    height: 2,
                    colorAttachments: [{ texture: sourceTexture }],
                    depthStencilAttachment: false
                })
        ).toThrow(/cannot contain image/);

        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 2,
            height: 2,
            depthStencilAttachment: { format: 'depth24plus' }
        });
        expect(() =>
            target.createRenderPassDescriptor({
                depthStencilAttachment: { stencilLoadOp: 'load' }
            })
        ).toThrow(/Stencil operations require/);
        await expect(target.readColorAttachment({ x: 1, width: 2 })).rejects.toThrow(/exceeds/);
    });
});
