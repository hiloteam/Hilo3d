import { beforeAll, describe, expect, it, vi } from 'vitest';
import Texture from '../../../src/texture/Texture';
import {
    DEPTH_COMPONENT,
    LINEAR,
    RGBA,
    TEXTURE_2D,
    TEXTURE_CUBE_MAP,
    UNSIGNED_BYTE,
    UNSIGNED_INT
} from '../../../src/constants/webgl';
import { DEPTH_COMPONENT24, RGBA8 } from '../../../src/constants/webgl2';
import WebGPURenderTarget, {
    restoreWebGPURenderTarget,
    setWebGPURenderTargetOperationGuard,
    suspendWebGPURenderTarget
} from '../../../src/renderer/webgpu/WebGPURenderTarget';
import WebGPUTextureManager, {
    getWebGPUTextureDefaultCompare
} from '../../../src/renderer/webgpu/WebGPUTextureManager';
import { NagaShaderTranslator } from '../../../src/renderer/shader/GlslToWgsl';

let translator: NagaShaderTranslator;

beforeAll(async () => {
    translator = new NagaShaderTranslator();
    await translator.initialize();
});

function createTextureManager(device: GPUDevice): WebGPUTextureManager {
    return new WebGPUTextureManager(device, translator);
}

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
    readonly copyExternalImageToTexture: ReturnType<typeof vi.fn>;
    readonly submit: ReturnType<typeof vi.fn>;
    fillReadBuffer: ((bytes: Uint8Array) => void) | null;
    failTextureCreationsAfter: number | null;
    failViewForLabel: string | null;
}

function createFakeWebGPU(
    options: { maxColorAttachments?: number; maxBytes?: number } = {}
): FakeWebGPU {
    const textures: FakeTextureRecord[] = [];
    const buffers: FakeBufferRecord[] = [];
    const copyTextureToBuffer = vi.fn();
    const copyExternalImageToTexture = vi.fn();
    const submit = vi.fn();
    const fake: FakeWebGPU = {
        device: null as unknown as GPUDevice,
        textures,
        buffers,
        copyTextureToBuffer,
        copyExternalImageToTexture,
        submit,
        fillReadBuffer: null,
        failTextureCreationsAfter: null,
        failViewForLabel: null
    };
    const device = {
        features: new Set<GPUFeatureName>(),
        limits: {
            maxTextureDimension2D: 8192,
            maxTextureArrayLayers: 256,
            maxColorAttachments: options.maxColorAttachments ?? 8,
            maxColorAttachmentBytesPerSample: options.maxBytes ?? 64
        },
        queue: { copyExternalImageToTexture, submit },
        createTexture: vi.fn((descriptor: GPUTextureDescriptor) => {
            if (fake.failTextureCreationsAfter !== null) {
                if (fake.failTextureCreationsAfter === 0) {
                    fake.failTextureCreationsAfter = null;
                    throw new Error('Injected WebGPU texture allocation failure');
                }
                fake.failTextureCreationsAfter--;
            }
            const views: FakeTextureRecord['views'] = [];
            const destroy = vi.fn();
            const gpuTexture = {
                createView: vi.fn((viewDescriptor: GPUTextureViewDescriptor = {}) => {
                    if (fake.failViewForLabel === descriptor.label) {
                        fake.failViewForLabel = null;
                        throw new Error('Injected WebGPU texture view failure');
                    }
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
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 64,
            height: 32,
            sampleCount: 4,
            colorAttachments: [{ format: 'rgba8unorm' }, { format: 'rgba16float' }],
            depthStencilAttachment: { format: 'depth24plus-stencil8', sampled: false }
        });

        expect(target.colorFormats).toEqual(['rgba8unorm', 'rgba16float']);
        expect(target.backend).toBe('webgpu');
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
        expect(fake.textures[0]?.descriptor.usage).toBe(23);
        expect(fake.textures[2]?.descriptor.usage).toBe(23);
        expect(textures.get(target.getColorTexture(1)).gpuTexture).toBe(
            target.getColorGPUTexture(1)
        );
    });

    it('retains load and store operations for every pass attachment', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 4,
            height: 4,
            colorAttachments: [
                { loadOp: 'load', storeOp: 'store' },
                {
                    clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'discard'
                },
                { loadOp: 'load', storeOp: 'discard' }
            ],
            depthStencilAttachment: false
        });

        expect(
            target.createRenderPassDescriptor().colorAttachments.map(attachment => ({
                clearValue: attachment?.clearValue,
                loadOp: attachment?.loadOp,
                storeOp: attachment?.storeOp
            }))
        ).toEqual([
            {
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'load',
                storeOp: 'store'
            },
            {
                clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
                loadOp: 'clear',
                storeOp: 'discard'
            },
            {
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'load',
                storeOp: 'discard'
            }
        ]);
    });

    it('uploads public sub-texture updates into a color attachment allocation', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 4,
            height: 4,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        const update = new ImageData(new Uint8ClampedArray([255, 0, 255, 255]), 1, 1);

        texture.updateSubTexture({
            mipLevel: 0,
            x: 1,
            y: 2,
            width: 1,
            height: 1,
            image: update
        });
        textures.get(texture);

        expect(fake.textures[0]?.descriptor.usage).toBe(23);
        expect(fake.copyExternalImageToTexture).toHaveBeenCalledWith(
            { source: update, flipY: false },
            {
                texture: target.getColorGPUTexture(),
                mipLevel: 0,
                origin: { x: 1, y: 2, z: 0 },
                premultipliedAlpha: false,
                colorSpace: 'srgb'
            },
            { width: 1, height: 1, depthOrArrayLayers: 1 }
        );
    });

    it('registers an explicitly sampleable depth/stencil texture through a depth-only view', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
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
        expect(target.getDepthTexture()).toBe(target.depthTexture);
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
        const textures = createTextureManager(fake.device);
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

    it('atomically rebuilds a target allocation when its public color Texture is destroyed', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 8,
            height: 4,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        const firstGPUTexture = target.getColorGPUTexture();
        const firstView = target.createRenderPassDescriptor().colorAttachments[0]?.view;

        texture.destroy();

        const secondGPUTexture = target.getColorGPUTexture();
        const secondRecord = fake.textures[1];
        expect(target.getColorTexture()).toBe(texture);
        expect(secondGPUTexture).not.toBe(firstGPUTexture);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(secondRecord?.destroy).not.toHaveBeenCalled();
        expect(textures.get(texture).gpuTexture).toBe(secondGPUTexture);
        expect(target.createRenderPassDescriptor().colorAttachments[0]?.view).not.toBe(firstView);

        // The old allocation observer still exists in Texture.destroy()'s notification snapshot.
        // A second rebuild proves that its generation token cannot release the replacement.
        texture.destroy();
        expect(secondRecord?.destroy).toHaveBeenCalledOnce();
        expect(fake.textures[2]?.destroy).not.toHaveBeenCalled();
        expect(target.getColorGPUTexture()).toBe(fake.textures[2]?.gpuTexture);
    });

    it('rebuilds sampled depth ownership and preserves its comparison default', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 8,
            height: 8,
            colorAttachments: [],
            depthStencilAttachment: {
                format: 'depth24plus-stencil8',
                sampled: true,
                compare: 'greater-equal'
            }
        });
        const texture = target.getDepthTexture();
        const firstGPUTexture = target.getDepthStencilGPUTexture();
        if (!texture) throw new Error('Expected a sampled depth texture');

        texture.destroy();

        expect(target.getDepthTexture()).toBe(texture);
        expect(target.getDepthStencilGPUTexture()).not.toBe(firstGPUTexture);
        expect(textures.get(texture).gpuTexture).toBe(target.getDepthStencilGPUTexture());
        expect(getWebGPUTextureDefaultCompare(textures, texture)).toBe('greater-equal');
        expect(fake.textures[1]?.views.map(view => view.descriptor)).toEqual([
            { dimension: '2d' },
            { dimension: '2d', aspect: 'depth-only' }
        ]);
    });

    it('clears stale handles and rejects attachment recovery during active frame recording', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 4,
            height: 4,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        const guard = vi.fn(() => {
            throw new Error('Injected active-frame mutation rejection');
        });
        setWebGPURenderTargetOperationGuard(target, guard);

        expect(() => texture.destroy()).toThrow(/active-frame mutation rejection/);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(textures.resourceCount).toBe(0);
        expect(() => target.getColorGPUTexture()).toThrow(/active-frame mutation rejection/);
        expect(fake.textures).toHaveLength(1);

        setWebGPURenderTargetOperationGuard(target, () => undefined);
        expect(target.getColorGPUTexture()).toBe(fake.textures[1]?.gpuTexture);
        expect(textures.get(texture).gpuTexture).toBe(fake.textures[1]?.gpuTexture);
        expect(guard).toHaveBeenCalledTimes(2);
    });

    it('never falls back to an ordinary texture after an owned attachment descriptor changes', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 4,
            height: 4,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        texture.target = TEXTURE_CUBE_MAP;
        texture.needDestroy = true;

        expect(() => textures.get(texture)).toThrow(/must use the TEXTURE_2D target/);
        expect(fake.textures).toHaveLength(1);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(textures.resourceCount).toBe(0);

        texture.target = TEXTURE_2D;
        expect(target.getColorGPUTexture()).toBe(fake.textures[1]?.gpuTexture);
        expect(textures.get(texture).gpuTexture).toBe(fake.textures[1]?.gpuTexture);
    });

    it('keeps failed attachment recovery pending for the next manager sampling request', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 4,
            height: 4,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        const firstGPUTexture = target.getColorGPUTexture();
        fake.failTextureCreationsAfter = 0;

        expect(() => texture.destroy()).toThrow(/allocation failure/);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(textures.resourceCount).toBe(0);

        const recovered = textures.get(texture);
        expect(recovered.gpuTexture).not.toBe(firstGPUTexture);
        expect(recovered.gpuTexture).toBe(target.getColorGPUTexture());
        expect(target.createRenderPassDescriptor().colorAttachments[0]?.view).toBe(recovered.view);
        expect(textures.resourceCount).toBe(1);
    });

    it('rejects direct owned-descriptor drift without creating a detached texture', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 4,
            height: 4,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        const gpuTexture = target.getColorGPUTexture();
        const allocationCount = fake.textures.length;
        texture.width++;

        expect(() => textures.get(texture)).toThrow(
            /cannot change the allocation descriptor owned by its WebGPU external resource/
        );
        expect(fake.textures).toHaveLength(allocationCount);
        expect(target.getColorGPUTexture()).toBe(gpuTexture);
        expect(textures.resourceCount).toBe(1);

        texture.width = target.width;
        expect(textures.get(texture).gpuTexture).toBe(gpuTexture);
    });

    it('unregisters attachment ownership when the render target is destroyed', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();

        target.destroy();
        texture.destroy();

        expect(fake.textures).toHaveLength(1);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(textures.resourceCount).toBe(0);
    });

    it('keeps target ownership coherent across public texture-manager mutations', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        const firstGPUTexture = target.getColorGPUTexture();

        textures.destroy(texture);
        const secondGPUTexture = target.getColorGPUTexture();
        expect(secondGPUTexture).not.toBe(firstGPUTexture);
        expect(textures.get(texture).gpuTexture).toBe(secondGPUTexture);
        expect(
            fake.textures.find(record => record.gpuTexture === firstGPUTexture)?.destroy
        ).toHaveBeenCalledOnce();

        const foreignGPUTexture = fake.device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: 0
        });
        expect(() => {
            textures.registerExternal(texture, foreignGPUTexture, { takeOwnership: true });
        }).toThrow(/owned by a WebGPU render target/);
        expect(
            fake.textures.find(record => record.gpuTexture === foreignGPUTexture)?.destroy
        ).not.toHaveBeenCalled();
        expect(target.getColorGPUTexture()).toBe(secondGPUTexture);

        textures.destroyAll();
        expect(textures.resourceCount).toBe(0);
        expect(
            fake.textures.find(record => record.gpuTexture === secondGPUTexture)?.destroy
        ).toHaveBeenCalledOnce();
        const thirdGPUTexture = target.getColorGPUTexture();
        expect(thirdGPUTexture).not.toBe(secondGPUTexture);
        expect(textures.get(texture).gpuTexture).toBe(thirdGPUTexture);
    });

    it('keeps every old allocation live when staged resize texture creation fails', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 10,
            height: 20,
            sampleCount: 4,
            colorAttachments: [{}, {}]
        });
        const firstColorTexture = target.getColorTexture(0);
        const secondColorTexture = target.getColorTexture(1);
        const colorTextures = [firstColorTexture, secondColorTexture];
        const oldGPUTextures = [target.getColorGPUTexture(0), target.getColorGPUTexture(1)];
        const oldRecords = [...fake.textures];
        const oldPass = target.createRenderPassDescriptor();
        fake.failTextureCreationsAfter = 2;

        expect(() => {
            target.resize(30, 40);
        }).toThrow(/allocation failure/);

        expect(target.isDestroyed).toBe(false);
        expect(target.width).toBe(10);
        expect(target.height).toBe(20);
        expect(target.getColorTexture(0)).toBe(colorTextures[0]);
        expect(target.getColorTexture(1)).toBe(colorTextures[1]);
        expect(colorTextures.map(texture => [texture.width, texture.height])).toEqual([
            [10, 20],
            [10, 20]
        ]);
        expect(target.getColorGPUTexture(0)).toBe(oldGPUTextures[0]);
        expect(target.getColorGPUTexture(1)).toBe(oldGPUTextures[1]);
        expect(textures.get(firstColorTexture).gpuTexture).toBe(oldGPUTextures[0]);
        expect(textures.get(secondColorTexture).gpuTexture).toBe(oldGPUTextures[1]);
        expect(
            target.createRenderPassDescriptor().colorAttachments.map(attachment => ({
                view: attachment?.view,
                resolveTarget: attachment?.resolveTarget
            }))
        ).toEqual(
            oldPass.colorAttachments.map(attachment => ({
                view: attachment?.view,
                resolveTarget: attachment?.resolveTarget
            }))
        );
        expect(oldRecords.every(record => record.destroy.mock.calls.length === 0)).toBe(true);
        expect(
            fake.textures
                .slice(oldRecords.length)
                .every(record => record.destroy.mock.calls.length === 1)
        ).toBe(true);

        expect(() => {
            target.resize(30, 40);
        }).not.toThrow();
        expect(target.width).toBe(30);
        expect(target.height).toBe(40);
        expect(oldRecords.every(record => record.destroy.mock.calls.length === 1)).toBe(true);
    });

    it('rolls back dimensions and registrations when staged resize view creation fails', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const target = new WebGPURenderTarget(fake.device, textures, {
            width: 8,
            height: 6,
            label: 'transaction',
            colorAttachments: [{}, {}],
            depthStencilAttachment: { format: 'depth24plus', sampled: true }
        });
        const firstColor = target.getColorTexture(0);
        const secondColor = target.getColorTexture(1);
        const colors = [firstColor, secondColor];
        const depth = target.getDepthTexture();
        const oldRecords = [...fake.textures];
        const oldColorGPUTextures = [target.getColorGPUTexture(0), target.getColorGPUTexture(1)];
        const oldDepthGPUTexture = target.getDepthStencilGPUTexture();
        fake.failViewForLabel = 'transaction.color[0]';

        expect(() => {
            target.resize(16, 12);
        }).toThrow(/view failure/);

        expect(target.isDestroyed).toBe(false);
        expect([target.width, target.height]).toEqual([8, 6]);
        expect(colors.map(texture => [texture.width, texture.height])).toEqual([
            [8, 6],
            [8, 6]
        ]);
        expect(depth && [depth.width, depth.height]).toEqual([8, 6]);
        expect(target.getColorGPUTexture(0)).toBe(oldColorGPUTextures[0]);
        expect(target.getColorGPUTexture(1)).toBe(oldColorGPUTextures[1]);
        expect(target.getDepthStencilGPUTexture()).toBe(oldDepthGPUTexture);
        expect(textures.get(firstColor).gpuTexture).toBe(oldColorGPUTextures[0]);
        expect(textures.get(secondColor).gpuTexture).toBe(oldColorGPUTextures[1]);
        expect(depth && textures.get(depth).gpuTexture).toBe(oldDepthGPUTexture);
        expect(oldRecords.every(record => record.destroy.mock.calls.length === 0)).toBe(true);
        expect(
            fake.textures
                .slice(oldRecords.length)
                .every(record => record.destroy.mock.calls.length === 1)
        ).toBe(true);
        expect(() => target.createRenderPassDescriptor()).not.toThrow();
    });

    it('suspends without destruction and restores the same public attachments on a new device', async () => {
        const first = createFakeWebGPU();
        const second = createFakeWebGPU();
        const firstTextures = createTextureManager(first.device);
        const secondTextures = createTextureManager(second.device);
        const target = new WebGPURenderTarget(first.device, firstTextures, {
            width: 6,
            height: 4,
            sampleCount: 4,
            colorAttachments: [{ format: 'rgba8unorm' }, { format: 'rgba16float' }],
            depthStencilAttachment: { format: 'depth24plus-stencil8' }
        });
        const firstColorTexture = target.getColorTexture(0);
        const colorTextures = [firstColorTexture, target.getColorTexture(1)];
        const firstGPUTextures = [target.getColorGPUTexture(0), target.getColorGPUTexture(1)];

        suspendWebGPURenderTarget(target);

        expect(target.isDestroyed).toBe(false);
        expect(target.getColorTexture(0)).toBe(colorTextures[0]);
        expect(() => target.createRenderPassDescriptor()).toThrow(/unavailable during recovery/);
        await expect(target.readColorAttachment()).rejects.toThrow(/unavailable during recovery/);
        expect(first.submit).not.toHaveBeenCalled();

        const suspendedAllocationCount = first.textures.length;
        firstColorTexture.destroy();
        expect(first.textures).toHaveLength(suspendedAllocationCount);
        expect(() => firstTextures.get(firstColorTexture)).toThrow(/unavailable during recovery/);
        expect(first.textures).toHaveLength(suspendedAllocationCount);

        target.resize(12, 10);
        expect(target.width).toBe(12);
        expect(target.height).toBe(10);
        restoreWebGPURenderTarget(target, second.device, secondTextures);

        expect(target.device).toBe(second.device);
        expect(target.textureManager).toBe(secondTextures);
        expect(target.isDestroyed).toBe(false);
        expect(target.getColorTexture(0)).toBe(colorTextures[0]);
        expect(target.getColorTexture(1)).toBe(colorTextures[1]);
        expect(target.getColorGPUTexture(0)).not.toBe(firstGPUTextures[0]);
        expect(target.getColorGPUTexture(1)).not.toBe(firstGPUTextures[1]);
        expect(secondTextures.get(firstColorTexture).gpuTexture).toBe(target.getColorGPUTexture(0));
        expect(target.createRenderPassDescriptor().colorAttachments).toHaveLength(2);
        expect(second.textures.map(record => record.descriptor.size)).toEqual(
            Array.from({ length: 5 }, () => ({
                width: 12,
                height: 10,
                depthOrArrayLayers: 1
            }))
        );
    });

    it('publishes destruction once to renderer ownership tracking', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const onDestroy = vi.fn();
        const target = new WebGPURenderTarget(
            fake.device,
            textures,
            { width: 2, height: 2 },
            onDestroy
        );

        target.destroy();
        target.destroy();

        expect(onDestroy).toHaveBeenCalledOnce();
        expect(onDestroy).toHaveBeenCalledWith(target);
    });
});

describe('WebGPURenderTarget readback', () => {
    it('uses 256-byte GPU row alignment and returns tightly packed native texel bytes', async () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
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
        const textures = createTextureManager(fake.device);

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
        const textures = createTextureManager(fake.device);
        const depthTexture = new Texture({
            width: 2,
            height: 2,
            internalFormat: DEPTH_COMPONENT24,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_INT,
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

    it('rejects duplicate attachment identities and ownership across targets', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        const texture = new Texture({
            width: 2,
            height: 2,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            image: null
        });

        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 2,
                    height: 2,
                    colorAttachments: [{ texture }, { texture }],
                    depthStencilAttachment: false
                })
        ).toThrow(/more than one WebGPU render-target attachment/);

        const owner = new WebGPURenderTarget(fake.device, textures, {
            width: 2,
            height: 2,
            colorAttachments: [{ texture }],
            depthStencilAttachment: false
        });
        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 2,
                    height: 2,
                    colorAttachments: [{ texture }],
                    depthStencilAttachment: false
                })
        ).toThrow(/another WebGPU external resource owner/);
        expect(owner.getColorGPUTexture()).toBe(textures.get(texture).gpuTexture);
    });

    it('destroys sampled depth allocation when its render view cannot be created', () => {
        const fake = createFakeWebGPU();
        const textures = createTextureManager(fake.device);
        fake.failViewForLabel = 'depth-view-failure.depthStencil';

        expect(
            () =>
                new WebGPURenderTarget(fake.device, textures, {
                    width: 2,
                    height: 2,
                    label: 'depth-view-failure',
                    colorAttachments: [],
                    depthStencilAttachment: { format: 'depth24plus', sampled: true }
                })
        ).toThrow(/view failure/);
        expect(fake.textures).toHaveLength(1);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(textures.resourceCount).toBe(0);
    });
});
