import { describe, expect, it, vi } from 'vitest';
import Texture from '../../../src/texture/Texture';
import CubeTexture from '../../../src/texture/CubeTexture';
import {
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT16,
    FLOAT,
    GEQUAL,
    LINEAR,
    LINEAR_MIPMAP_LINEAR,
    MIRRORED_REPEAT,
    NEAREST,
    NEAREST_MIPMAP_LINEAR,
    RGB,
    RGBA,
    UNSIGNED_BYTE
} from '../../../src/constants/webgl';
import {
    DEPTH32F_STENCIL8,
    HALF_FLOAT,
    RGB16F,
    RGB32F,
    RGB8,
    RGBA16F,
    RGBA32F,
    RGBA8
} from '../../../src/constants/webgl2';
import WebGPUTextureManager, {
    createWebGPUSamplerDescriptor,
    expandRGBToRGBA,
    resolveWebGPUTextureFormat
} from '../../../src/renderer/webgpu/WebGPUTextureManager';

interface FakeTextureRecord {
    readonly descriptor: GPUTextureDescriptor;
    readonly createView: ReturnType<typeof vi.fn>;
    readonly destroy: ReturnType<typeof vi.fn>;
    readonly gpuTexture: GPUTexture;
}

type CreateTextureMock = ReturnType<typeof vi.fn<(descriptor: GPUTextureDescriptor) => GPUTexture>>;

interface FakeWebGPU {
    readonly device: GPUDevice;
    readonly queue: {
        readonly writeTexture: ReturnType<typeof vi.fn>;
        readonly copyExternalImageToTexture: ReturnType<typeof vi.fn>;
        readonly submit: ReturnType<typeof vi.fn>;
    };
    readonly textures: FakeTextureRecord[];
    readonly createTexture: CreateTextureMock;
    readonly createSampler: ReturnType<typeof vi.fn>;
    readonly createRenderPipeline: ReturnType<typeof vi.fn>;
    readonly createCommandEncoder: ReturnType<typeof vi.fn>;
    readonly renderPass: {
        readonly setPipeline: ReturnType<typeof vi.fn>;
        readonly setBindGroup: ReturnType<typeof vi.fn>;
        readonly draw: ReturnType<typeof vi.fn>;
        readonly end: ReturnType<typeof vi.fn>;
    };
}

interface RecordedExternalCopyDestination {
    readonly origin?: GPUOrigin3D;
}

function createFakeWebGPU(): FakeWebGPU {
    const textures: FakeTextureRecord[] = [];
    const queue = {
        writeTexture: vi.fn(),
        copyExternalImageToTexture: vi.fn(),
        submit: vi.fn()
    };
    const renderPass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn()
    };
    const createSampler = vi.fn((descriptor: GPUSamplerDescriptor) => ({ descriptor }));
    const createRenderPipeline = vi.fn((descriptor: GPURenderPipelineDescriptor) => ({
        descriptor
    }));
    const createCommandEncoder = vi.fn(() => ({
        beginRenderPass: vi.fn(() => renderPass),
        finish: vi.fn(() => ({ commandBuffer: true }))
    }));
    const createTexture: CreateTextureMock = vi.fn((descriptor: GPUTextureDescriptor) => {
        const createView = vi.fn((viewDescriptor: GPUTextureViewDescriptor = {}) => ({
            viewDescriptor
        }));
        const destroy = vi.fn();
        const gpuTexture = { createView, destroy } as unknown as GPUTexture;
        textures.push({ descriptor, createView, destroy, gpuTexture });
        return gpuTexture;
    });
    const device = {
        features: new Set<GPUFeatureName>(),
        limits: {
            maxTextureDimension2D: 8192,
            maxTextureArrayLayers: 256
        },
        queue,
        createTexture,
        createSampler,
        createBindGroupLayout: vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => ({
            descriptor
        })),
        createPipelineLayout: vi.fn((descriptor: GPUPipelineLayoutDescriptor) => ({ descriptor })),
        createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => ({ descriptor })),
        createRenderPipeline,
        createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor })),
        createCommandEncoder
    } as unknown as GPUDevice;
    return {
        device,
        queue,
        textures,
        createTexture,
        createSampler,
        createRenderPipeline,
        createCommandEncoder,
        renderPass
    };
}

describe('WebGPUTextureManager formats and data conversion', () => {
    it('maps supported color, float and depth declarations without fallback', () => {
        expect(
            resolveWebGPUTextureFormat(
                new Texture({ internalFormat: RGBA8, format: RGBA, type: UNSIGNED_BYTE })
            ).format
        ).toBe('rgba8unorm');
        expect(
            resolveWebGPUTextureFormat(
                new Texture({ internalFormat: RGB32F, format: RGB, type: FLOAT })
            ).format
        ).toBe('rgba32float');
        expect(
            resolveWebGPUTextureFormat(
                new Texture({ internalFormat: RGBA16F, format: RGBA, type: HALF_FLOAT })
            ).format
        ).toBe('rgba16float');
        expect(
            resolveWebGPUTextureFormat(
                new Texture({ internalFormat: DEPTH_COMPONENT16, format: DEPTH_COMPONENT16 })
            ).format
        ).toBe('depth16unorm');

        expect(() => resolveWebGPUTextureFormat(new Texture({ compressed: true }))).toThrow(
            /Compressed texture format/
        );
        expect(() =>
            resolveWebGPUTextureFormat(new Texture({ internalFormat: 0xdead, type: 0xbeef }))
        ).toThrow(/no supported WebGPU mapping/);
        expect(() =>
            resolveWebGPUTextureFormat(
                new Texture({ internalFormat: RGBA8, format: 0xdead, type: UNSIGNED_BYTE })
            )
        ).toThrow(/no supported WebGPU color mapping/);
    });

    it('expands RGB input with the correct alpha representation', () => {
        expect([...expandRGBToRGBA(new Uint8Array([1, 2, 3]), 'u8', 1)]).toEqual([1, 2, 3, 255]);
        expect([...expandRGBToRGBA(new Uint16Array([1, 2, 3]), 'f16', 1)]).toEqual([
            1, 2, 3, 0x3c00
        ]);
        expect([...expandRGBToRGBA(new Float32Array([1, 2, 3]), 'f32', 1)]).toEqual([1, 2, 3, 1]);
    });

    it('maps filter, wrap, comparison and anisotropy sampler state', () => {
        const texture = new Texture({
            minFilter: NEAREST_MIPMAP_LINEAR,
            magFilter: NEAREST,
            wrapS: MIRRORED_REPEAT,
            wrapT: CLAMP_TO_EDGE
        });
        expect(createWebGPUSamplerDescriptor(texture, 4, GEQUAL)).toEqual({
            addressModeU: 'mirror-repeat',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'linear',
            lodMinClamp: 0,
            lodMaxClamp: 3,
            compare: 'greater-equal'
        });

        texture.anisotropic = 2;
        expect(() => createWebGPUSamplerDescriptor(texture, 4)).toThrow(
            /require linear min\/mag filters/
        );
    });
});

describe('WebGPUTextureManager uploads and lifecycle', () => {
    it('uploads RGB typed data and generates mipmaps with a render pipeline', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({
            width: 2,
            height: 2,
            internalFormat: RGB8,
            format: RGB,
            type: UNSIGNED_BYTE,
            minFilter: LINEAR_MIPMAP_LINEAR,
            image: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
        });

        const resource = manager.get(texture);

        expect(resource.format).toBe('rgba8unorm');
        expect(resource.mipLevelCount).toBe(2);
        expect(fake.textures[0]?.descriptor.size).toEqual({
            width: 2,
            height: 2,
            depthOrArrayLayers: 1
        });
        const upload = fake.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array;
        expect([...upload]).toEqual([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
        expect(fake.createRenderPipeline).toHaveBeenCalledOnce();
        expect(fake.renderPass.draw).toHaveBeenCalledWith(3);
        expect(fake.queue.submit).toHaveBeenCalledOnce();
    });

    it('uploads all cube faces through copyExternalImageToTexture', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const faces = Array.from({ length: 6 }, () => new ImageData(2, 2));
        const texture = new CubeTexture({ image: faces });

        const resource = manager.get(texture);

        expect(resource.dimension).toBe('cube');
        expect(resource.depthOrArrayLayers).toBe(6);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(6);
        const copies = fake.queue.copyExternalImageToTexture.mock.calls as unknown as [
            unknown,
            RecordedExternalCopyDestination,
            GPUExtent3D
        ][];
        expect(copies.map(([, destination]) => destination.origin)).toEqual([
            { x: 0, y: 0, z: 0 },
            { x: 0, y: 0, z: 1 },
            { x: 0, y: 0, z: 2 },
            { x: 0, y: 0, z: 3 },
            { x: 0, y: 0, z: 4 },
            { x: 0, y: 0, z: 5 }
        ]);
        expect(fake.textures[0]?.createView).toHaveBeenCalledWith({
            dimension: 'cube',
            baseArrayLayer: 0,
            arrayLayerCount: 6
        });
    });

    it('rejects cube and external-image states that WebGPU cannot represent', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const nonSquareFaces = Array.from({ length: 6 }, () => new ImageData(2, 1));
        expect(() => manager.get(new CubeTexture({ image: nonSquareFaces }))).toThrow(
            /square faces/
        );

        const noColorConversion = new Texture({
            image: new ImageData(1, 1),
            colorSpaceConversion: false
        });
        expect(() => manager.get(noColorConversion)).toThrow(/do not provide WebGL NONE/);
        expect(fake.textures.at(-1)?.destroy).toHaveBeenCalledOnce();
    });

    it('supports float uploads and rejects storage/type mismatches', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        manager.get(
            new Texture({
                width: 1,
                height: 1,
                internalFormat: RGBA32F,
                format: RGBA,
                type: FLOAT,
                image: new Float32Array([1, 2, 3, 4])
            })
        );
        manager.get(
            new Texture({
                width: 1,
                height: 1,
                internalFormat: RGB16F,
                format: RGB,
                type: HALF_FLOAT,
                image: new Uint16Array([1, 2, 3])
            })
        );
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(2);

        expect(() =>
            manager.get(
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: RGBA32F,
                    format: RGBA,
                    type: FLOAT,
                    image: new Uint8Array([1, 2, 3, 4])
                })
            )
        ).toThrow(/does not match WebGPU f32/);
    });

    it('honours needUpdate, autoUpdate, needDestroy and enumerable destruction', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });

        const first = manager.get(texture);
        expect(texture.needUpdate).toBe(false);
        expect(manager.getResources()).toEqual([first]);
        manager.get(texture);
        expect(fake.queue.writeTexture).toHaveBeenCalledOnce();

        texture.needUpdate = true;
        manager.get(texture);
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(2);
        texture.autoUpdate = true;
        manager.get(texture);
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(3);

        texture.needDestroy = true;
        const second = manager.get(texture);
        expect(second).not.toBe(first);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(manager.resourceCount).toBe(1);

        const other = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([5, 6, 7, 8])
        });
        manager.get(other);
        expect(manager.resourceCount).toBe(2);
        manager.destroyAll();
        expect(manager.resourceCount).toBe(0);
        expect(fake.textures.at(-1)?.destroy).toHaveBeenCalledOnce();
    });

    it('releases native resources when the backend-neutral texture is destroyed', () => {
        const fake = createFakeWebGPU();
        const onResourceDestroyed = vi.fn();
        const manager = new WebGPUTextureManager(fake.device, onResourceDestroyed);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });

        manager.get(texture);
        texture.destroy();

        expect(manager.resourceCount).toBe(0);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        expect(onResourceDestroyed).toHaveBeenCalledOnce();
        texture.destroy();
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
    });

    it('consumes external sub-texture updates once and preserves their origin', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({ image: new ImageData(4, 4) });
        manager.get(texture);

        texture.updateSubTexture(1, 2, new ImageData(1, 1));
        manager.get(texture);
        manager.get(texture);

        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
        const copies = fake.queue.copyExternalImageToTexture.mock.calls as unknown as [
            unknown,
            RecordedExternalCopyDestination,
            GPUExtent3D
        ][];
        expect(copies[1]?.[1].origin).toEqual({ x: 1, y: 2, z: 0 });
        expect(texture.getTextureUpdatesSince(texture.updateRevision).subTextures).toEqual([]);
    });

    it('creates comparison samplers only for depth resources', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const depth = new Texture({
            width: 4,
            height: 4,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT16,
            minFilter: LINEAR,
            magFilter: LINEAR,
            image: null
        });
        manager.get(depth, { compare: GEQUAL });
        expect(fake.createSampler).toHaveBeenLastCalledWith(
            expect.objectContaining({ compare: 'greater-equal' })
        );

        expect(() =>
            manager.get(
                new Texture({
                    width: 1,
                    height: 1,
                    image: new Uint8Array([0, 0, 0, 255])
                }),
                { compare: GEQUAL }
            )
        ).toThrow(/Comparison samplers require/);
    });

    it('keeps low-level regular and comparison descriptor snapshots immutable', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const depth = new Texture({
            width: 4,
            height: 4,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT16,
            minFilter: LINEAR,
            magFilter: LINEAR,
            image: null
        });

        const regular = manager.get(depth);
        const regularSampler = regular.sampler;
        const comparison = manager.get(depth, { compare: 'less-equal' });

        expect(Object.isFrozen(regular)).toBe(true);
        expect(comparison.gpuTexture).toBe(regular.gpuTexture);
        expect(comparison.view).toBe(regular.view);
        expect(comparison.sampler).not.toBe(regularSampler);
        expect(regular.sampler).toBe(regularSampler);
        expect(manager.get(depth).sampler).toBe(regularSampler);
        expect(fake.createSampler).toHaveBeenCalledTimes(2);
    });

    it('caches samplers by immutable descriptor without mutating prior resources', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const firstTexture = new Texture({ width: 1, height: 1, image: null });
        const secondTexture = new Texture({ width: 1, height: 1, image: null });

        const first = manager.get(firstTexture);
        const second = manager.get(secondTexture);
        expect(second.sampler).toBe(first.sampler);

        const originalSampler = first.sampler;
        firstTexture.minFilter = NEAREST;
        firstTexture.magFilter = NEAREST;
        const changed = manager.get(firstTexture);
        expect(changed.sampler).not.toBe(originalSampler);
        expect(first.sampler).toBe(originalSampler);
        expect(manager.get(firstTexture).sampler).toBe(changed.sampler);
    });

    it('validates sampler state before allocating and destroys failed texture transactions', () => {
        expect(() => createWebGPUSamplerDescriptor(new Texture(), 0)).toThrow(/mipLevelCount/);

        const invalidSampler = createFakeWebGPU();
        const invalidTexture = new Texture({ width: 1, height: 1, image: null, anisotropic: 0 });
        expect(() => new WebGPUTextureManager(invalidSampler.device).get(invalidTexture)).toThrow(
            /anisotropy/
        );
        expect(invalidSampler.createTexture).not.toHaveBeenCalled();

        const rejectedSampler = createFakeWebGPU();
        rejectedSampler.createSampler.mockImplementationOnce(() => {
            throw new Error('device rejected sampler');
        });
        expect(() =>
            new WebGPUTextureManager(rejectedSampler.device).get(
                new Texture({ width: 1, height: 1, image: null })
            )
        ).toThrow(/device rejected sampler/);
        expect(rejectedSampler.createTexture).not.toHaveBeenCalled();

        const invalidView = createFakeWebGPU();
        const destroy = vi.fn();
        invalidView.createTexture.mockReturnValueOnce({
            createView: vi.fn(() => {
                throw new Error('view creation failed');
            }),
            destroy
        } as unknown as GPUTexture);
        expect(() =>
            new WebGPUTextureManager(invalidView.device).get(
                new Texture({ width: 1, height: 1, image: null })
            )
        ).toThrow(/view creation failed/);
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('replaces external registrations transactionally and safely aliases one native texture', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({ width: 1, height: 1, image: null });
        const native = fake.createTexture({} as GPUTextureDescriptor);

        const first = manager.registerExternal(texture, native, { takeOwnership: true });
        const second = manager.registerExternal(texture, native, { takeOwnership: true });
        expect(second.gpuTexture).toBe(first.gpuTexture);
        expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();
        expect(manager.resourceCount).toBe(1);

        const alias = new Texture({ width: 1, height: 1, image: null });
        manager.registerExternal(alias, native, { takeOwnership: false });
        expect(manager.resourceCount).toBe(2);
        manager.destroy(texture);
        expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();
        manager.destroy(alias);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
    });

    it('cleans owned external textures when sampler validation fails before view creation', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const createView = vi.fn();
        const destroy = vi.fn();
        const native = { createView, destroy } as unknown as GPUTexture;
        const texture = new Texture({
            width: 1,
            height: 1,
            image: null,
            anisotropic: 0
        });

        expect(() => manager.registerExternal(texture, native, { takeOwnership: true })).toThrow(
            /anisotropy/
        );
        expect(createView).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledOnce();
        expect(manager.resourceCount).toBe(0);
    });

    it('preserves the old external registration and cleans a failed owned replacement', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({ width: 1, height: 1, image: null });
        const oldNative = fake.createTexture({} as GPUTextureDescriptor);
        const replacementDestroy = vi.fn();
        const replacement = {
            createView: vi.fn(() => {
                throw new Error('replacement view failed');
            }),
            destroy: replacementDestroy
        } as unknown as GPUTexture;
        const oldResource = manager.registerExternal(texture, oldNative, { takeOwnership: true });

        expect(() =>
            manager.registerExternal(texture, replacement, { takeOwnership: true })
        ).toThrow(/replacement view failed/);
        expect(replacementDestroy).toHaveBeenCalledOnce();
        expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();
        expect(manager.get(texture).gpuTexture).toBe(oldResource.gpuTexture);
    });

    it('does not destroy a live native texture when same-native replacement fails', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({ width: 1, height: 1, image: null });
        const native = fake.createTexture({} as GPUTextureDescriptor);
        manager.registerExternal(texture, native, { takeOwnership: true });
        fake.textures[0]?.createView.mockImplementationOnce(() => {
            throw new Error('same-native view failed');
        });

        expect(() => manager.registerExternal(texture, native, { takeOwnership: true })).toThrow(
            /same-native view failed/
        );
        expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();
        expect(manager.get(texture).gpuTexture).toBe(native);
    });

    it('retries failed sub-texture uploads without consuming another backend snapshot', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({ image: new ImageData(4, 4) });
        manager.get(texture);
        texture.updateSubTexture(1, 2, new ImageData(1, 1));
        fake.queue.copyExternalImageToTexture.mockImplementationOnce(() => {
            throw new Error('copy failed');
        });

        expect(() => manager.get(texture)).toThrow(/copy failed/);
        manager.get(texture);

        const copies = fake.queue.copyExternalImageToTexture.mock.calls as unknown as [
            unknown,
            RecordedExternalCopyDestination,
            GPUExtent3D
        ][];
        expect(copies.at(-1)?.[1].origin).toEqual({ x: 1, y: 2, z: 0 });
        expect(texture.getTextureUpdatesSince(0).subTextures).toHaveLength(1);
    });

    it('keeps WebGL2 and WebGPU uploads independently current in either sync order', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });
        const texImage2D = vi.fn();
        const texSubImage2D = vi.fn();
        const gl = {
            TEXTURE0: 0x84c0,
            TEXTURE_MAG_FILTER: 0x2800,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            texImage2D,
            texSubImage2D,
            texParameterf: vi.fn(),
            generateMipmap: vi.fn()
        } as unknown as WebGL2RenderingContext;
        const state = {
            gl,
            activeTexture: vi.fn(),
            bindTexture: vi.fn(),
            pixelStorei: vi.fn()
        };
        const glTexture = {} as WebGLTexture;

        texture.updateTexture(state, glTexture);
        manager.get(texture);
        expect(texture.needUpdate).toBe(false);

        texture.updateSubTexture(0, 0, new Uint8Array([5, 6, 7, 8]));
        texture.updateTexture(state, glTexture);
        manager.get(texture);

        texture.updateSubTexture(0, 0, new Uint8Array([9, 10, 11, 12]));
        manager.get(texture);
        texture.updateTexture(state, glTexture);

        expect(texImage2D).toHaveBeenCalledOnce();
        expect(texSubImage2D).toHaveBeenCalledTimes(2);
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(3);
    });

    it('releases CPU image data only after caching the descriptor and successful upload', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4]),
            isImageCanRelease: true
        });

        const first = manager.get(texture);
        expect(texture.isImageReleased).toBe(true);
        expect(() => texture.image).toThrow(/has been released/);
        expect(manager.get(texture)).toBe(first);
        expect(fake.queue.writeTexture).toHaveBeenCalledOnce();
    });

    it('rejects depth formats whose required device feature is not enabled', () => {
        const fake = createFakeWebGPU();
        const manager = new WebGPUTextureManager(fake.device);
        const depthStencil = new Texture({
            width: 1,
            height: 1,
            internalFormat: DEPTH32F_STENCIL8,
            image: null
        });

        expect(() => manager.get(depthStencil)).toThrow(/requires the depth32float-stencil8/);
        expect(fake.textures).toHaveLength(0);
    });
});
