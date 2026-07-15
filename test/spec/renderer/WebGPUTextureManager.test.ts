import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WebGLCapabilities } from '../../../src/render/internal/webgl2/capabilities';
import type { WebGLExtensions } from '../../../src/render/internal/webgl2/extensions';
import WebGLState, {
    destroyWebGLTextures,
    getWebGLTexture,
    getWebGLTextureCache
} from '../../../src/render/internal/webgl2/WebGLState';
import { getWebGPUNativeDeviceCache } from '../../../src/render/rhi/webgpu/WebGPUNativeCache';
import { WebGLTextureManager } from '../../../src/render/internal/webgl2/WebGLTextureManager';
import { updateWebGLTexture } from '../../../src/render/internal/webgl2/WebGLTextureUploader';
import Texture from '../../../src/texture/Texture';
import CubeTexture from '../../../src/texture/CubeTexture';
import {
    BYTE,
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    DEPTH_STENCIL,
    FLOAT,
    GEQUAL,
    INT,
    LINEAR,
    LINEAR_MIPMAP_LINEAR,
    MIRRORED_REPEAT,
    NEAREST,
    NEAREST_MIPMAP_LINEAR,
    NEAREST_MIPMAP_NEAREST,
    REPEAT,
    RGB,
    RGBA,
    SHORT,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../../../src/constants/webgl';
import {
    COMPRESSED_RGBA_ASTC_4X4_KHR,
    COMPRESSED_RGBA_S3TC_DXT3_EXT,
    COMPRESSED_RGBA_S3TC_DXT5_EXT,
    COMPRESSED_RGB_ETC1_WEBGL,
    COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
    COMPRESSED_RGB_S3TC_DXT1_EXT
} from '../../../src/constants/webglExtensions';
import {
    COMPRESSED_R11_EAC,
    COMPRESSED_RG11_EAC,
    COMPRESSED_RGB8_ETC2,
    COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2,
    COMPRESSED_RGBA8_ETC2_EAC,
    COMPRESSED_SIGNED_R11_EAC,
    COMPRESSED_SIGNED_RG11_EAC,
    COMPRESSED_SRGB8_ALPHA8_ETC2_EAC,
    COMPRESSED_SRGB8_ETC2,
    COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT32F,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    HALF_FLOAT,
    R8I,
    R8_SNORM,
    R16UI,
    R32I,
    RED,
    RED_INTEGER,
    RG,
    RG16I,
    RG32UI,
    RG_INTEGER,
    RG8_SNORM,
    R11F_G11F_B10F,
    RGB16F,
    RGB8UI,
    RGB_INTEGER,
    RGB32F,
    RGB8,
    RGB8_SNORM,
    RGBA16F,
    RGBA32UI,
    RGBA_INTEGER,
    RGBA32F,
    RGBA8,
    RGBA8_SNORM,
    RGB10_A2,
    RGB10_A2UI,
    RGB9_E5,
    TEXTURE_2D_ARRAY,
    TEXTURE_3D,
    UNSIGNED_INT_10F_11F_11F_REV,
    UNSIGNED_INT_2_10_10_10_REV,
    UNSIGNED_INT_5_9_9_9_REV
} from '../../../src/constants/webgl2';
import WebGPUTextureManager, {
    beginWebGPUTextureSubmission,
    createWebGPUSamplerDescriptor,
    endWebGPUTextureSubmission,
    expandRGBToRGBA,
    getWebGPUTextureDefaultCompare,
    MAX_CACHED_WEBGPU_SAMPLERS,
    MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS,
    restoreWebGPUTextureDevice,
    suspendWebGPUTextures,
    resolveWebGPUTextureFormat
} from '../../../src/render/internal/webgpu/WebGPUTextureManager';
import { NagaShaderTranslator } from '../../../src/render/shader/GlslToWgsl';

let translator: NagaShaderTranslator;

beforeAll(async () => {
    translator = new NagaShaderTranslator();
    await translator.initialize();
});

function createTextureManager(
    device: GPUDevice,
    onResourceDestroyed?: () => void
): WebGPUTextureManager {
    return new WebGPUTextureManager(device, translator, onResourceDestroyed);
}

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
        readonly onSubmittedWorkDone: ReturnType<typeof vi.fn<() => Promise<void>>>;
        readonly submit: ReturnType<typeof vi.fn>;
    };
    readonly textures: FakeTextureRecord[];
    readonly createTexture: CreateTextureMock;
    readonly createSampler: ReturnType<typeof vi.fn>;
    readonly createBindGroupLayout: ReturnType<typeof vi.fn>;
    readonly createPipelineLayout: ReturnType<typeof vi.fn>;
    readonly createShaderModule: ReturnType<typeof vi.fn>;
    readonly createRenderPipeline: ReturnType<typeof vi.fn>;
    readonly createBindGroup: ReturnType<typeof vi.fn>;
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
    readonly premultipliedAlpha?: boolean;
    readonly colorSpace?: PredefinedColorSpace;
}

function createFakeWebGPU(features: readonly GPUFeatureName[] = []): FakeWebGPU {
    const textures: FakeTextureRecord[] = [];
    const queue = {
        writeTexture: vi.fn(),
        copyExternalImageToTexture: vi.fn(),
        onSubmittedWorkDone: vi.fn(() => Promise.resolve()),
        submit: vi.fn()
    };
    const renderPass = {
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn()
    };
    const createSampler = vi.fn((descriptor: GPUSamplerDescriptor) => ({ descriptor }));
    const createBindGroupLayout = vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => ({
        descriptor
    }));
    const createPipelineLayout = vi.fn((descriptor: GPUPipelineLayoutDescriptor) => ({
        descriptor
    }));
    const createShaderModule = vi.fn((descriptor: GPUShaderModuleDescriptor) => ({ descriptor }));
    const createRenderPipeline = vi.fn((descriptor: GPURenderPipelineDescriptor) => ({
        descriptor
    }));
    const createBindGroup = vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor }));
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
        features: new Set(features),
        limits: {
            maxTextureDimension2D: 8192,
            maxTextureDimension3D: 2048,
            maxTextureArrayLayers: 256
        },
        queue,
        createTexture,
        createSampler,
        createBindGroupLayout,
        createPipelineLayout,
        createShaderModule,
        createRenderPipeline,
        createBindGroup,
        createCommandEncoder
    } as unknown as GPUDevice;
    return {
        device,
        queue,
        textures,
        createTexture,
        createSampler,
        createBindGroupLayout,
        createPipelineLayout,
        createShaderModule,
        createRenderPipeline,
        createBindGroup,
        createCommandEncoder,
        renderPass
    };
}

interface ControlledVideoSource {
    readonly video: HTMLVideoElement;
    readonly requestFrame: ReturnType<typeof vi.fn>;
    readonly cancelFrame: ReturnType<typeof vi.fn>;
    present(mediaTime?: number, metadataWidth?: number, metadataHeight?: number): void;
    resize(width: number, height: number): void;
}

function createControlledVideoSource(width = 2, height = 2): ControlledVideoSource {
    const video = document.createElement('video');
    const callbacks = new Map<number, VideoFrameRequestCallback>();
    let nextHandle = 1;
    let presentedFrames = 0;
    let intrinsicWidth = width;
    let intrinsicHeight = height;
    const requestFrame = vi.fn((callback: VideoFrameRequestCallback) => {
        const handle = nextHandle++;
        callbacks.set(handle, callback);
        return handle;
    });
    const cancelFrame = vi.fn((handle: number) => {
        callbacks.delete(handle);
    });
    Object.defineProperties(video, {
        videoWidth: { configurable: true, get: () => intrinsicWidth },
        videoHeight: { configurable: true, get: () => intrinsicHeight },
        requestVideoFrameCallback: { configurable: true, value: requestFrame },
        cancelVideoFrameCallback: { configurable: true, value: cancelFrame }
    });
    return {
        video,
        requestFrame,
        cancelFrame,
        present(
            mediaTime = presentedFrames / 24,
            metadataWidth = intrinsicWidth,
            metadataHeight = intrinsicHeight
        ): void {
            const next = callbacks.entries().next().value;
            if (!next) throw new Error('No video frame callback is pending');
            callbacks.delete(next[0]);
            presentedFrames++;
            const now = performance.now();
            next[1](now, {
                expectedDisplayTime: now,
                height: metadataHeight,
                mediaTime,
                presentationTime: now,
                presentedFrames,
                width: metadataWidth
            });
        },
        resize(nextWidth: number, nextHeight: number): void {
            intrinsicWidth = nextWidth;
            intrinsicHeight = nextHeight;
        }
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
                new Texture({
                    internalFormat: DEPTH_COMPONENT16,
                    format: DEPTH_COMPONENT,
                    type: UNSIGNED_SHORT
                })
            ).format
        ).toBe('depth16unorm');

        expect(() =>
            resolveWebGPUTextureFormat(new Texture({ internalFormat: 0xdead, type: 0xbeef }))
        ).toThrow(/no supported WebGPU mapping/);
        expect(() =>
            resolveWebGPUTextureFormat(
                new Texture({ internalFormat: RGBA8, format: 0xdead, type: UNSIGNED_BYTE })
            )
        ).toThrow(/requires component type/u);
    });

    it.each([
        [R8I, RED_INTEGER, BYTE, 'r8sint', 'sint', 'i8'],
        [R16UI, RED_INTEGER, UNSIGNED_SHORT, 'r16uint', 'uint', 'u16'],
        [RG16I, RG_INTEGER, SHORT, 'rg16sint', 'sint', 'i16'],
        [R32I, RED_INTEGER, INT, 'r32sint', 'sint', 'i32'],
        [RG32UI, RG_INTEGER, UNSIGNED_INT, 'rg32uint', 'uint', 'u32'],
        [RGB8UI, RGB_INTEGER, UNSIGNED_BYTE, 'rgba8uint', 'uint', 'u8'],
        [RGBA32UI, RGBA_INTEGER, UNSIGNED_INT, 'rgba32uint', 'uint', 'u32']
    ] as const)(
        'maps integer declaration %# to %s storage without normalized fallback',
        (internalFormat, format, type, expectedFormat, sampleType, storage) => {
            expect(
                resolveWebGPUTextureFormat(
                    new Texture({
                        internalFormat,
                        format,
                        type,
                        minFilter: NEAREST,
                        magFilter: NEAREST
                    })
                )
            ).toMatchObject({ format: expectedFormat, sampleType, storage });
        }
    );

    it.each([
        [R8_SNORM, RED, BYTE, 'r8snorm', 'i8'],
        [RG8_SNORM, RG, BYTE, 'rg8snorm', 'i8'],
        [RGB8_SNORM, RGB, BYTE, 'rgba8snorm', 'i8'],
        [RGBA8_SNORM, RGBA, BYTE, 'rgba8snorm', 'i8'],
        [RGB10_A2, RGBA, UNSIGNED_INT_2_10_10_10_REV, 'rgb10a2unorm', 'u32'],
        [R11F_G11F_B10F, RGB, UNSIGNED_INT_10F_11F_11F_REV, 'rg11b10ufloat', 'u32'],
        [RGB9_E5, RGB, UNSIGNED_INT_5_9_9_9_REV, 'rgb9e5ufloat', 'u32']
    ] as const)(
        'maps normalized/packed declaration %#',
        (internalFormat, format, type, expectedFormat, storage) => {
            expect(
                resolveWebGPUTextureFormat(new Texture({ internalFormat, format, type }))
            ).toMatchObject({ format: expectedFormat, sampleType: 'float', storage });
        }
    );

    it('maps packed RGB10_A2UI to the native uint texture format', () => {
        expect(
            resolveWebGPUTextureFormat(
                new Texture({
                    internalFormat: RGB10_A2UI,
                    format: RGBA_INTEGER,
                    type: UNSIGNED_INT_2_10_10_10_REV,
                    minFilter: NEAREST,
                    magFilter: NEAREST
                })
            )
        ).toMatchObject({ format: 'rgb10a2uint', sampleType: 'uint', storage: 'u32' });
    });

    it('requires explicit mip data when a mapped format is not renderable on the device', () => {
        const unsupported = createFakeWebGPU();
        const snorm = new Texture({
            width: 4,
            height: 4,
            image: new Int8Array(16),
            internalFormat: R8_SNORM,
            format: RED,
            type: BYTE,
            minFilter: NEAREST_MIPMAP_NEAREST,
            magFilter: NEAREST
        });
        expect(() => createTextureManager(unsupported.device).get(snorm)).toThrow(
            /requires an explicit complete mip chain/
        );
        expect(unsupported.createTexture).not.toHaveBeenCalled();

        const supported = createFakeWebGPU(['rg11b10ufloat-renderable']);
        const packedFloat = new Texture({
            width: 2,
            height: 2,
            image: new Uint32Array(4),
            internalFormat: R11F_G11F_B10F,
            format: RGB,
            type: UNSIGNED_INT_10F_11F_11F_REV,
            minFilter: NEAREST_MIPMAP_NEAREST,
            magFilter: NEAREST
        });
        expect(() => createTextureManager(supported.device).get(packedFloat)).not.toThrow();
        expect(supported.createTexture).toHaveBeenCalledOnce();
    });

    it('maps supported KTX compression tokens to native WebGPU block formats', () => {
        const format = (internalFormat: GLenum) =>
            resolveWebGPUTextureFormat(new Texture({ compressed: true, internalFormat }));

        expect(format(COMPRESSED_RGB_S3TC_DXT1_EXT)).toMatchObject({
            format: 'bc1-rgba-unorm',
            requiredFeature: 'texture-compression-bc',
            blockWidth: 4,
            blockHeight: 4,
            bytesPerBlock: 8,
            isCompressed: true
        });
        expect(format(COMPRESSED_RGBA_S3TC_DXT3_EXT).format).toBe('bc2-rgba-unorm');
        expect(format(COMPRESSED_RGBA_S3TC_DXT5_EXT).format).toBe('bc3-rgba-unorm');
        expect(format(COMPRESSED_RGB_ETC1_WEBGL)).toMatchObject({
            format: 'etc2-rgb8unorm',
            requiredFeature: 'texture-compression-etc2',
            bytesPerBlock: 8
        });
        expect(format(COMPRESSED_RGB8_ETC2).format).toBe('etc2-rgb8unorm');
        expect(format(COMPRESSED_SRGB8_ETC2).format).toBe('etc2-rgb8unorm-srgb');
        expect(format(COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2)).toMatchObject({
            format: 'etc2-rgb8a1unorm',
            bytesPerBlock: 8
        });
        expect(format(COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2).format).toBe(
            'etc2-rgb8a1unorm-srgb'
        );
        expect(format(COMPRESSED_RGBA8_ETC2_EAC)).toMatchObject({
            format: 'etc2-rgba8unorm',
            bytesPerBlock: 16
        });
        expect(format(COMPRESSED_SRGB8_ALPHA8_ETC2_EAC).format).toBe('etc2-rgba8unorm-srgb');
        expect(format(COMPRESSED_R11_EAC)).toMatchObject({
            format: 'eac-r11unorm',
            bytesPerBlock: 8
        });
        expect(format(COMPRESSED_SIGNED_R11_EAC).format).toBe('eac-r11snorm');
        expect(format(COMPRESSED_RG11_EAC)).toMatchObject({
            format: 'eac-rg11unorm',
            bytesPerBlock: 16
        });
        expect(format(COMPRESSED_SIGNED_RG11_EAC).format).toBe('eac-rg11snorm');
        expect(format(COMPRESSED_RGBA_ASTC_4X4_KHR)).toMatchObject({
            format: 'astc-4x4-unorm',
            requiredFeature: 'texture-compression-astc',
            bytesPerBlock: 16
        });
        expect(() => format(COMPRESSED_RGB_PVRTC_4BPPV1_IMG)).toThrow(
            /PVRTC.*not supported by WebGPU/u
        );
    });

    it('expands RGB input with the correct alpha representation', () => {
        expect([...expandRGBToRGBA(new Uint8Array([1, 2, 3]), 'u8', 1)]).toEqual([1, 2, 3, 255]);
        expect([...expandRGBToRGBA(new Uint16Array([1, 2, 3]), 'f16', 1)]).toEqual([
            1, 2, 3, 0x3c00
        ]);
        expect([...expandRGBToRGBA(new Float32Array([1, 2, 3]), 'f32', 1)]).toEqual([1, 2, 3, 1]);
        expect([...expandRGBToRGBA(new Uint8Array([1, 2, 3]), 'u8', 1, 'uint')]).toEqual([
            1, 2, 3, 1
        ]);
        expect([...expandRGBToRGBA(new Int8Array([-1, 0, 1]), 'i8', 1, 'float')]).toEqual([
            -1, 0, 1, 127
        ]);
        expect([...expandRGBToRGBA(new Int16Array([1, 2, 3]), 'i16', 1, 'sint')]).toEqual([
            1, 2, 3, 1
        ]);
    });

    it('maps filter, wrap, comparison and anisotropy sampler state', () => {
        const texture = new Texture({
            minFilter: NEAREST_MIPMAP_LINEAR,
            magFilter: NEAREST,
            wrapS: MIRRORED_REPEAT,
            wrapT: CLAMP_TO_EDGE,
            wrapR: CLAMP_TO_EDGE
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
    it('uploads portable raw depth storage and rejects combined depth-stencil bytes', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const depth16 = new Texture({
            width: 2,
            height: 1,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_SHORT,
            image: new Uint16Array([0, 0xffff])
        });
        const depth32 = new Texture({
            width: 2,
            height: 1,
            internalFormat: DEPTH_COMPONENT32F,
            format: DEPTH_COMPONENT,
            type: FLOAT,
            image: new Float32Array([0.25, 0.75])
        });
        expect(
            () =>
                new Texture({
                    width: 2,
                    height: 1,
                    internalFormat: DEPTH32F_STENCIL8,
                    format: DEPTH_STENCIL,
                    type: FLOAT_32_UNSIGNED_INT_24_8_REV,
                    image: new Uint32Array(4)
                })
        ).toThrow(/only DEPTH_COMPONENT16 and DEPTH_COMPONENT32F support portable raw depth/u);

        manager.get(depth16);
        manager.get(depth32);

        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(2);
        expect(fake.queue.writeTexture.mock.calls[0]?.[0]).toMatchObject({
            aspect: 'depth-only'
        });
        expect(fake.queue.writeTexture.mock.calls[1]?.[0]).toMatchObject({
            aspect: 'depth-only'
        });
    });

    it('uploads descriptor updates for cube, 3D, 2D-array external, and compressed textures', () => {
        const fake = createFakeWebGPU(['texture-compression-bc']);
        const manager = createTextureManager(fake.device);

        const cube = new CubeTexture({
            width: 2,
            height: 2,
            image: Array.from({ length: 6 }, () => new Uint8Array(12))
        });
        manager.get(cube);
        cube.updateSubTexture({
            mipLevel: 0,
            face: 3,
            x: 1,
            y: 1,
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3])
        });
        manager.get(cube);
        expect(fake.queue.writeTexture.mock.calls.at(-1)?.[0]).toMatchObject({
            mipLevel: 0,
            origin: { x: 1, y: 1, z: 3 }
        });

        const volume = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 2,
            depth: 2,
            image: new Uint8Array(32)
        });
        manager.get(volume);
        volume.updateSubTexture({
            mipLevel: 0,
            z: 1,
            x: 1,
            y: 0,
            width: 1,
            height: 2,
            depth: 1,
            image: new Uint8Array(8)
        });
        manager.get(volume);
        expect(fake.queue.writeTexture.mock.calls.at(-1)?.[0]).toMatchObject({
            origin: { x: 1, y: 0, z: 1 }
        });
        expect(fake.queue.writeTexture.mock.calls.at(-1)?.[3]).toEqual({
            width: 1,
            height: 2,
            depthOrArrayLayers: 1
        });

        const array = new Texture({
            target: TEXTURE_2D_ARRAY,
            width: 2,
            height: 2,
            depth: 2,
            image: new Uint8Array(32)
        });
        manager.get(array);
        const external = new ImageData(1, 1);
        array.updateSubTexture({
            mipLevel: 0,
            layer: 1,
            x: 0,
            y: 1,
            width: 1,
            height: 1,
            depth: 1,
            image: external
        });
        manager.get(array);
        expect(fake.queue.writeTexture.mock.calls.at(-1)?.[0]).toMatchObject({
            origin: { x: 0, y: 1, z: 1 }
        });

        const compressed = new Texture({
            compressed: true,
            width: 8,
            height: 8,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT,
            format: RGB,
            type: 0,
            image: new Uint8Array(32)
        });
        manager.get(compressed);
        compressed.updateSubTexture({
            mipLevel: 0,
            x: 4,
            y: 4,
            width: 4,
            height: 4,
            image: new Uint8Array(8)
        });
        manager.get(compressed);
        expect(fake.queue.writeTexture.mock.calls.at(-1)?.[0]).toMatchObject({
            origin: { x: 4, y: 4, z: 0 }
        });
        expect(fake.queue.writeTexture.mock.calls.at(-1)?.[2]).toEqual({
            offset: 0,
            bytesPerRow: 8,
            rowsPerImage: 1
        });

        const edgeCompressed = new Texture({
            compressed: true,
            width: 6,
            height: 4,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT,
            format: RGB,
            type: 0,
            image: new Uint8Array(16)
        });
        manager.get(edgeCompressed);
        expect(() => {
            edgeCompressed.updateSubTexture({
                mipLevel: 0,
                x: 0,
                y: 0,
                width: 2,
                height: 4,
                image: new Uint8Array(8)
            });
        }).toThrow(/block-aligned unless.*mip edge/);
        edgeCompressed.updateSubTexture({
            mipLevel: 0,
            x: 4,
            y: 0,
            width: 2,
            height: 4,
            image: new Uint8Array(8)
        });
        manager.get(edgeCompressed);
        expect(fake.queue.writeTexture.mock.calls.at(-1)?.[3]).toEqual({
            width: 4,
            height: 4,
            depthOrArrayLayers: 1
        });
    });

    it('uploads 8→4→2→1 compressed mips with physical block-aligned copy extents', () => {
        const fake = createFakeWebGPU(['texture-compression-bc']);
        const manager = createTextureManager(fake.device);
        const baseLevel = { width: 8, height: 8, data: new Uint8Array(32) };
        const mipmaps = [
            baseLevel,
            { width: 4, height: 4, data: new Uint8Array(8) },
            { width: 2, height: 2, data: new Uint8Array(8) },
            { width: 1, height: 1, data: new Uint8Array(8) }
        ];
        const texture = new Texture<Uint8Array>({
            compressed: true,
            width: 8,
            height: 8,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT,
            format: RGB,
            image: baseLevel.data,
            mipmaps,
            minFilter: LINEAR_MIPMAP_LINEAR
        });

        const resource = manager.get(texture);

        expect(resource.format).toBe('bc1-rgba-unorm');
        expect(resource.mipLevelCount).toBe(4);
        expect(fake.createRenderPipeline).not.toHaveBeenCalled();
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(4);
        expect(fake.queue.writeTexture).toHaveBeenNthCalledWith(
            1,
            { texture: resource.gpuTexture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            baseLevel.data,
            { offset: 0, bytesPerRow: 16, rowsPerImage: 2 },
            { width: 8, height: 8, depthOrArrayLayers: 1 }
        );
        expect(fake.queue.writeTexture).toHaveBeenNthCalledWith(
            2,
            { texture: resource.gpuTexture, mipLevel: 1, origin: { x: 0, y: 0, z: 0 } },
            mipmaps[1]?.data,
            { offset: 0, bytesPerRow: 8, rowsPerImage: 1 },
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        expect(fake.queue.writeTexture).toHaveBeenNthCalledWith(
            3,
            { texture: resource.gpuTexture, mipLevel: 2, origin: { x: 0, y: 0, z: 0 } },
            mipmaps[2]?.data,
            { offset: 0, bytesPerRow: 8, rowsPerImage: 1 },
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        expect(fake.queue.writeTexture).toHaveBeenNthCalledWith(
            4,
            { texture: resource.gpuTexture, mipLevel: 3, origin: { x: 0, y: 0, z: 0 } },
            mipmaps[3]?.data,
            { offset: 0, bytesPerRow: 8, rowsPerImage: 1 },
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        expect(fake.createRenderPipeline).not.toHaveBeenCalled();
    });

    it('requires compression features and validates exact block payload sizes', () => {
        const unsupported = createFakeWebGPU();
        expect(() =>
            createTextureManager(unsupported.device).get(
                new Texture({
                    compressed: true,
                    width: 4,
                    height: 4,
                    internalFormat: COMPRESSED_RGB8_ETC2,
                    image: new Uint8Array(8)
                })
            )
        ).toThrow(/requires device feature texture-compression-etc2/u);
        expect(unsupported.createTexture).not.toHaveBeenCalled();

        const supported = createFakeWebGPU(['texture-compression-astc']);
        const manager = createTextureManager(supported.device);
        expect(() =>
            manager.get(
                new Texture({
                    compressed: true,
                    width: 4,
                    height: 4,
                    internalFormat: COMPRESSED_RGBA_ASTC_4X4_KHR,
                    image: new Uint8Array(15)
                })
            )
        ).toThrow(/15 bytes; 16 are required/u);
        expect(supported.textures[0]?.destroy).toHaveBeenCalledOnce();
    });

    it('uploads RGB typed data and generates mipmaps with a render pipeline', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
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
        const shaderModules = fake.createShaderModule.mock.calls.map(
            call => call[0] as GPUShaderModuleDescriptor
        );
        expect(shaderModules).toHaveLength(2);
        expect(shaderModules[0]?.code).toContain('@vertex');
        expect(shaderModules[1]?.code).toContain('@fragment');
        const resourceLayout = fake.createBindGroupLayout.mock.calls[0]?.[0] as
            GPUBindGroupLayoutDescriptor | undefined;
        const emptyLayout = fake.createBindGroupLayout.mock.calls[1]?.[0] as
            GPUBindGroupLayoutDescriptor | undefined;
        expect(resourceLayout?.entries).toEqual([
            {
                binding: 1,
                visibility: 2,
                texture: { sampleType: 'float', viewDimension: '2d', multisampled: false }
            },
            { binding: 2, visibility: 2, sampler: { type: 'non-filtering' } }
        ]);
        expect(emptyLayout?.entries).toEqual([]);
        const pipelineDescriptor = fake.createRenderPipeline.mock.calls[0]?.[0] as
            GPURenderPipelineDescriptor | undefined;
        expect(pipelineDescriptor?.vertex.entryPoint).toBe('main');
        expect(pipelineDescriptor?.fragment?.entryPoint).toBe('main');
        const bindGroupDescriptor = fake.createBindGroup.mock.calls[0]?.[0] as
            GPUBindGroupDescriptor | undefined;
        expect(bindGroupDescriptor?.entries.map(entry => entry.binding)).toEqual([1, 2]);
        expect(fake.renderPass.setBindGroup).toHaveBeenCalledWith(1, expect.anything());
        expect(fake.renderPass.draw).toHaveBeenCalledWith(3);
        expect(fake.queue.submit).toHaveBeenCalledOnce();
    });

    it('allocates and uploads complete 3D textures with independent slice row flips', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({
            target: TEXTURE_3D,
            width: 1,
            height: 2,
            depth: 2,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST,
            flipY: true,
            image: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
        });

        const resource = manager.get(texture);

        expect(resource).toMatchObject({
            dimension: '3d',
            width: 1,
            height: 2,
            depthOrArrayLayers: 2,
            mipLevelCount: 1,
            format: 'rgba8unorm'
        });
        expect(fake.textures[0]?.descriptor).toMatchObject({
            size: { width: 1, height: 2, depthOrArrayLayers: 2 },
            dimension: '3d',
            mipLevelCount: 1
        });
        expect(fake.textures[0]?.createView).toHaveBeenCalledWith({ dimension: '3d' });
        const upload = fake.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array;
        expect([...upload]).toEqual([5, 6, 7, 8, 1, 2, 3, 4, 13, 14, 15, 16, 9, 10, 11, 12]);
        expect(fake.queue.writeTexture).toHaveBeenCalledWith(
            { texture: resource.gpuTexture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            upload,
            { offset: 0, bytesPerRow: 4, rowsPerImage: 2 },
            { width: 1, height: 2, depthOrArrayLayers: 2 }
        );
        expect(fake.createRenderPipeline).not.toHaveBeenCalled();
    });

    it('uploads integer 2D-array layers without normalized or RGB-alpha fallback', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({
            target: TEXTURE_2D_ARRAY,
            width: 1,
            height: 1,
            depth: 2,
            internalFormat: RGB8UI,
            format: RGB_INTEGER,
            type: UNSIGNED_BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: Uint8Array.from([1, 2, 3, 4, 5, 6])
        });

        const resource = manager.get(texture);

        expect(resource).toMatchObject({
            dimension: '2d-array',
            depthOrArrayLayers: 2,
            format: 'rgba8uint'
        });
        expect(fake.textures[0]?.descriptor).toMatchObject({
            size: { width: 1, height: 1, depthOrArrayLayers: 2 },
            dimension: '2d'
        });
        expect(fake.textures[0]?.createView).toHaveBeenCalledWith({
            dimension: '2d-array',
            baseArrayLayer: 0,
            arrayLayerCount: 2
        });
        const upload = fake.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array;
        expect([...upload]).toEqual([1, 2, 3, 1, 4, 5, 6, 1]);
        expect(fake.queue.writeTexture).toHaveBeenCalledWith(
            { texture: resource.gpuTexture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            upload,
            { offset: 0, bytesPerRow: 4, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 2 }
        );
        expect(fake.createRenderPipeline).not.toHaveBeenCalled();
    });

    it('uploads explicit complete 3D mip chains with shrinking depth', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const base = new Uint8Array(2 * 2 * 2 * 4);
        const levelOne = new Uint8Array([1, 2, 3, 4]);
        const texture = new Texture({
            target: TEXTURE_3D,
            width: 2,
            height: 2,
            depth: 2,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            minFilter: NEAREST_MIPMAP_NEAREST,
            magFilter: NEAREST,
            image: base,
            mipmaps: [
                { width: 2, height: 2, depth: 2, data: base },
                { width: 1, height: 1, depth: 1, data: levelOne }
            ]
        });

        const resource = manager.get(texture);

        expect(resource).toMatchObject({ dimension: '3d', mipLevelCount: 2 });
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(2);
        expect(fake.queue.writeTexture).toHaveBeenNthCalledWith(
            1,
            { texture: resource.gpuTexture, mipLevel: 0, origin: { x: 0, y: 0, z: 0 } },
            base,
            { offset: 0, bytesPerRow: 8, rowsPerImage: 2 },
            { width: 2, height: 2, depthOrArrayLayers: 2 }
        );
        expect(fake.queue.writeTexture).toHaveBeenNthCalledWith(
            2,
            { texture: resource.gpuTexture, mipLevel: 1, origin: { x: 0, y: 0, z: 0 } },
            levelOne,
            { offset: 0, bytesPerRow: 4, rowsPerImage: 1 },
            { width: 1, height: 1, depthOrArrayLayers: 1 }
        );
        expect(fake.createRenderPipeline).not.toHaveBeenCalled();
    });

    it('rejects incomplete 3D mipmaps and non-nearest integer sampling before allocation', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const linearlySampledInteger = new Texture({
            width: 1,
            height: 1,
            internalFormat: R8I,
            format: RED_INTEGER,
            type: BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: new Int8Array([1])
        });
        linearlySampledInteger.magFilter = LINEAR;

        expect(
            () =>
                new Texture({
                    target: TEXTURE_3D,
                    width: 2,
                    height: 2,
                    depth: 2,
                    minFilter: NEAREST_MIPMAP_NEAREST,
                    magFilter: NEAREST,
                    image: new Uint8Array(2 * 2 * 2 * 4)
                })
        ).toThrow(/3D textures.*complete explicit mipmap chain/u);
        expect(() => manager.get(linearlySampledInteger)).toThrow(/nearest-only sampling/u);
        expect(fake.createTexture).not.toHaveBeenCalled();
    });

    it('rebuilds the translated unfilterable mipmap pipeline after device recovery', () => {
        const first = createFakeWebGPU();
        const replacement = createFakeWebGPU();
        const manager = createTextureManager(first.device);
        const texture = new Texture({
            width: 2,
            height: 2,
            internalFormat: RGBA32F,
            format: RGBA,
            type: FLOAT,
            minFilter: LINEAR_MIPMAP_LINEAR,
            image: new Float32Array(16)
        });

        manager.get(texture);
        const translatedShader: unknown = Reflect.get(manager, 'mipmapShader');
        suspendWebGPUTextures(manager);
        restoreWebGPUTextureDevice(manager, replacement.device);
        manager.get(texture);
        const recoveredShader: unknown = Reflect.get(manager, 'mipmapShader');

        expect(translatedShader).not.toBeNull();
        expect(recoveredShader).toBe(translatedShader);
        expect(first.createRenderPipeline).toHaveBeenCalledOnce();
        expect(replacement.createRenderPipeline).toHaveBeenCalledOnce();
        const replacementLayout = replacement.createBindGroupLayout.mock.calls[0]?.[0] as
            GPUBindGroupLayoutDescriptor | undefined;
        expect(replacementLayout?.entries[0]).toMatchObject({
            binding: 1,
            texture: { sampleType: 'unfilterable-float' }
        });
        expect(replacement.createBindGroup.mock.calls[0]?.[0]).toMatchObject({
            entries: [{ binding: 1 }, { binding: 2 }]
        });
        expect(replacement.renderPass.setBindGroup).toHaveBeenCalledWith(1, expect.anything());
    });

    it('vertically flips tightly packed TypedArray rows before writing WebGPU textures', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        manager.get(
            new Texture({
                width: 2,
                height: 2,
                format: RGBA,
                type: UNSIGNED_BYTE,
                flipY: true,
                image: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
            })
        );

        const upload = fake.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array;
        expect([...upload]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('accepts unaligned DataView pixel storage and applies the same row flip', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const storage = new Uint8Array(17);
        storage.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 1);
        manager.get(
            new Texture<DataView>({
                width: 2,
                height: 2,
                format: RGBA,
                type: UNSIGNED_BYTE,
                flipY: true,
                image: new DataView(storage.buffer, 1, 16)
            })
        );

        const upload = fake.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array;
        expect([...upload]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('uploads all cube faces through copyExternalImageToTexture', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
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

    it('adopts intrinsic external-image dimensions instead of stale placeholder metadata', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const uninitialized = new Texture({ image: new ImageData(3, 2) });
        const stalePlaceholder = new Texture({
            width: 1,
            height: 1,
            image: new ImageData(4, 2)
        });

        manager.get(uninitialized);
        manager.get(stalePlaceholder);

        expect(uninitialized.width).toBe(3);
        expect(uninitialized.height).toBe(2);
        expect(stalePlaceholder.width).toBe(4);
        expect(stalePlaceholder.height).toBe(2);
        expect(fake.textures[0]?.descriptor.size).toEqual({
            width: 3,
            height: 2,
            depthOrArrayLayers: 1
        });
        expect(fake.textures[1]?.descriptor.size).toEqual({
            width: 4,
            height: 2,
            depthOrArrayLayers: 1
        });
    });

    it('allocates an explicitly sized zero texture while video metadata is unavailable', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const controlled = createControlledVideoSource(0, 0);
        const texture = new Texture<unknown>({
            image: controlled.video,
            width: 4,
            height: 3,
            autoUpdate: true
        });

        const resource = manager.get(texture);

        expect(resource.width).toBe(4);
        expect(resource.height).toBe(3);
        expect(fake.textures[0]?.descriptor.size).toEqual({
            width: 4,
            height: 3,
            depthOrArrayLayers: 1
        });
        expect(fake.queue.copyExternalImageToTexture).not.toHaveBeenCalled();
        expect(texture.needUpdate).toBe(true);
        texture.destroy();
    });

    it('stages only presented video frames and never rewrites a canvas during GPU copy', async () => {
        const drawImage = vi
            .spyOn(CanvasRenderingContext2D.prototype, 'drawImage')
            .mockImplementation(() => undefined);
        const fake = createFakeWebGPU();
        let completeCopy: (() => void) | undefined;
        const copyCompleted = new Promise<void>(resolve => {
            completeCopy = resolve;
        });
        fake.queue.onSubmittedWorkDone.mockReturnValue(copyCompleted);
        const controlled = createControlledVideoSource();
        const texture = new Texture<unknown>({
            image: controlled.video,
            autoUpdate: true
        });
        const manager = createTextureManager(fake.device);

        const initial = manager.get(texture);
        expect(manager.get(texture).gpuTexture).toBe(initial.gpuTexture);
        expect(texture.needUpdate).toBe(true);
        expect(fake.queue.copyExternalImageToTexture).not.toHaveBeenCalled();
        expect(controlled.requestFrame).toHaveBeenCalledTimes(1);

        controlled.present(0, 4, 3);
        expect(drawImage).toHaveBeenCalledWith(controlled.video, 0, 0, 2, 2);
        const uploaded = manager.get(texture);
        expect(uploaded.gpuTexture).toBe(initial.gpuTexture);
        expect(texture.needUpdate).toBe(false);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
        const firstSource = fake.queue.copyExternalImageToTexture.mock.calls[0]?.[0] as
            GPUCopyExternalImageSourceInfo | undefined;
        expect(firstSource?.source).toBeInstanceOf(HTMLCanvasElement);
        expect(firstSource?.source).not.toBe(controlled.video);

        manager.get(texture);
        controlled.present();
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
        expect(drawImage).toHaveBeenCalledTimes(1);

        completeCopy?.();
        await copyCompleted;
        expect(drawImage).toHaveBeenCalledTimes(2);
        manager.get(texture);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);

        await Promise.resolve();
        const stagingFailure = new Error('video staging failed');
        drawImage.mockImplementationOnce(() => {
            throw stagingFailure;
        });
        controlled.present();
        expect(() => manager.get(texture)).toThrow(/could not stage its current video frame/);

        texture.destroy();
        expect(controlled.cancelFrame).toHaveBeenCalledTimes(1);
        expect(manager.resourceCount).toBe(0);
    });

    it('keeps queue-copy failures observable after a later video frame stages successfully', async () => {
        const drawImage = vi
            .spyOn(CanvasRenderingContext2D.prototype, 'drawImage')
            .mockImplementation(() => undefined);
        const fake = createFakeWebGPU();
        let rejectCopy: ((reason: Error) => void) | undefined;
        const copyCompleted = new Promise<void>((_resolve, reject) => {
            rejectCopy = reject;
        });
        fake.queue.onSubmittedWorkDone.mockReturnValue(copyCompleted);
        const controlled = createControlledVideoSource();
        const texture = new Texture<unknown>({ image: controlled.video, autoUpdate: true });
        const manager = createTextureManager(fake.device);
        const queueFailure = new Error('video queue failed');

        manager.get(texture);
        controlled.present();
        manager.get(texture);
        rejectCopy?.(queueFailure);
        await expect(copyCompleted).rejects.toBe(queueFailure);

        controlled.present();
        expect(drawImage).toHaveBeenCalledTimes(2);
        try {
            manager.get(texture);
            throw new Error('Expected the sticky video queue failure to be observed');
        } catch (error: unknown) {
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).message).toMatch(/could not stage its current video frame/);
            expect((error as Error).cause).toMatchObject({
                message: 'WebGPU video frame upload did not complete',
                cause: queueFailure
            });
        }

        texture.destroy();
    });

    it('restages a consumed paused frame when the same video changes intrinsic size', async () => {
        const drawImage = vi
            .spyOn(CanvasRenderingContext2D.prototype, 'drawImage')
            .mockImplementation(() => undefined);
        const fake = createFakeWebGPU();
        const controlled = createControlledVideoSource(2, 2);
        const texture = new Texture<unknown>({ image: controlled.video, autoUpdate: true });
        const manager = createTextureManager(fake.device);

        manager.get(texture);
        controlled.present();
        const initial = manager.get(texture);
        await Promise.resolve();

        controlled.resize(4, 3);
        controlled.present();
        const resized = manager.get(texture);

        expect(resized.gpuTexture).not.toBe(initial.gpuTexture);
        expect(resized.width).toBe(4);
        expect(resized.height).toBe(3);
        expect(fake.textures[1]?.descriptor.size).toEqual({
            width: 4,
            height: 3,
            depthOrArrayLayers: 1
        });
        expect(drawImage.mock.calls).toEqual([
            [controlled.video, 0, 0, 2, 2],
            [controlled.video, 0, 0, 2, 2],
            [controlled.video, 0, 0, 4, 3]
        ]);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);

        // The resized frame was already consumed by the old callback. With no future callback
        // (for example after pause/seek), the replacement must remain populated rather than blank.
        expect(manager.get(texture).gpuTexture).toBe(resized.gpuTexture);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
        texture.destroy();
    });

    it('rebuilds dynamic state when a same-sized texture changes video source kind', async () => {
        vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage').mockImplementation(
            () => undefined
        );
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const firstVideo = createControlledVideoSource();
        const secondVideo = createControlledVideoSource();
        const texture = new Texture<unknown>({ image: firstVideo.video, autoUpdate: true });

        const firstBlank = manager.get(texture);
        firstVideo.present();
        manager.get(texture);
        await Promise.resolve();

        texture.image = secondVideo.video;
        const secondBlank = manager.get(texture);
        expect(secondBlank.gpuTexture).not.toBe(firstBlank.gpuTexture);
        expect(firstVideo.cancelFrame).toHaveBeenCalledTimes(1);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledTimes(1);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);
        expect(manager.get(texture).gpuTexture).toBe(secondBlank.gpuTexture);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);

        secondVideo.present();
        manager.get(texture);
        await Promise.resolve();
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);

        const staticImage = new ImageData(2, 2);
        texture.image = staticImage;
        const staticResource = manager.get(texture);
        expect(staticResource.gpuTexture).not.toBe(secondBlank.gpuTexture);
        expect(secondVideo.cancelFrame).toHaveBeenCalledTimes(1);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(3);
        const staticSource = fake.queue.copyExternalImageToTexture.mock.calls[2]?.[0] as
            GPUCopyExternalImageSourceInfo | undefined;
        expect(staticSource?.source).toBe(staticImage);

        texture.image = firstVideo.video;
        const thirdBlank = manager.get(texture);
        expect(thirdBlank.gpuTexture).not.toBe(staticResource.gpuTexture);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(3);
        firstVideo.present();
        manager.get(texture);
        expect(fake.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(4);
        texture.destroy();
    });

    it('cancels video frame observation across suspension, restoration and destruction', () => {
        const firstDevice = createFakeWebGPU();
        const replacement = createFakeWebGPU();
        const controlled = createControlledVideoSource();
        const texture = new Texture<unknown>({ image: controlled.video, autoUpdate: true });
        const manager = createTextureManager(firstDevice.device);

        manager.get(texture);
        expect(controlled.requestFrame).toHaveBeenCalledTimes(1);
        suspendWebGPUTextures(manager);
        expect(controlled.cancelFrame).toHaveBeenCalledTimes(1);
        expect(manager.resourceCount).toBe(0);

        restoreWebGPUTextureDevice(manager, replacement.device);
        manager.get(texture);
        expect(controlled.requestFrame).toHaveBeenCalledTimes(2);
        manager.destroyAll();
        expect(controlled.cancelFrame).toHaveBeenCalledTimes(2);
        expect(manager.resourceCount).toBe(0);
    });

    it('strictly rejects mismatched and non-square cube faces', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const mismatchedFaces = Array.from({ length: 6 }, () => new ImageData(2, 2));
        mismatchedFaces[5] = new ImageData(4, 2);
        expect(() => manager.get(new CubeTexture({ image: mismatchedFaces }))).toThrow(
            /same width/
        );

        const nonSquareFaces = Array.from({ length: 6 }, () => new ImageData(2, 1));
        expect(() => manager.get(new CubeTexture({ image: nonSquareFaces }))).toThrow(
            /square faces/
        );
    });

    it('uploads explicit cube mip chains as six canonical face entries per level', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const mipmaps = [
            ...Array.from({ length: 6 }, (_, face) => ({
                face: face as 0 | 1 | 2 | 3 | 4 | 5,
                width: 2,
                height: 2,
                data: new Uint8Array(12).fill(face + 1)
            })),
            ...Array.from({ length: 6 }, (_, face) => ({
                face: face as 0 | 1 | 2 | 3 | 4 | 5,
                width: 1,
                height: 1,
                data: new Uint8Array(3).fill(face + 11)
            }))
        ];
        const texture = new CubeTexture({
            width: 2,
            height: 2,
            image: Array.from({ length: 6 }, () => new Uint8Array(12)),
            mipmaps,
            minFilter: NEAREST_MIPMAP_NEAREST,
            magFilter: NEAREST
        });

        const resource = manager.get(texture);

        expect(resource.mipLevelCount).toBe(2);
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(12);
        const destinations = fake.queue.writeTexture.mock.calls.map(call => call[0] as unknown);
        expect(destinations).toEqual(
            Array.from({ length: 12 }, (_, entry) => ({
                texture: resource.gpuTexture,
                mipLevel: Math.floor(entry / 6),
                origin: { x: 0, y: 0, z: entry % 6 }
            }))
        );
        expect(fake.createRenderPipeline).not.toHaveBeenCalled();
    });

    it('uses the single standard sRGB color-management path for external images', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({ image: new ImageData(1, 1) });

        expect(() => manager.get(texture)).not.toThrow();
        expect(texture).not.toHaveProperty('colorSpaceConversion');
        const destination = fake.queue.copyExternalImageToTexture.mock.calls[0]?.[1] as
            RecordedExternalCopyDestination | undefined;
        expect(destination).toMatchObject({
            premultipliedAlpha: false,
            colorSpace: 'srgb'
        });
        expect((fake.textures[0]?.descriptor.usage ?? 0) & 0x12).toBe(0x12);
    });

    it('supports float uploads and rejects storage/type mismatches', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
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
        const manager = createTextureManager(fake.device);
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

    it('applies needDestroy to every WebGPU device and WebGL2 context', () => {
        const firstFake = createFakeWebGPU();
        const secondFake = createFakeWebGPU();
        const firstManager = createTextureManager(firstFake.device);
        const secondManager = createTextureManager(secondFake.device);
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2');
        if (!gl) throw new Error('WebGL2 is required for texture lifecycle tests');
        const state = new WebGLState(gl);
        const texture = new Texture({
            width: 1,
            height: 1,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: new Uint8Array([1, 2, 3, 4])
        });

        try {
            const first = firstManager.get(texture);
            const peer = secondManager.get(texture);
            const webglAllocation = getWebGLTexture(state, texture);

            texture.needDestroy = true;
            const replacement = firstManager.get(texture);

            expect(replacement).not.toBe(first);
            expect(firstFake.textures[0]?.destroy).toHaveBeenCalledOnce();
            expect(secondFake.textures[0]?.destroy).toHaveBeenCalledOnce();
            expect(secondManager.resourceCount).toBe(0);
            expect(gl.isTexture(webglAllocation)).toBe(false);
            expect(getWebGLTextureCache(state).get(texture.id)).toBeUndefined();
            expect(texture.needDestroy).toBe(false);

            expect(secondManager.get(texture)).not.toBe(peer);
            expect(getWebGLTexture(state, texture)).not.toBe(webglAllocation);
        } finally {
            texture.destroy();
            destroyWebGLTextures(state);
            firstManager.destroyAll();
            secondManager.destroyAll();
        }
    });

    it('releases native resources when the backend-neutral texture is destroyed', () => {
        const fake = createFakeWebGPU();
        const onResourceDestroyed = vi.fn();
        const manager = createTextureManager(fake.device, onResourceDestroyed);
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

    it('releases native resources before a public destroy listener can cancel or throw', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });
        texture.on('destroy', event => {
            event.stopImmediatePropagation?.();
            throw new Error('public listener failed');
        });

        manager.get(texture);
        expect(() => texture.destroy()).toThrow('public listener failed');
        expect(manager.resourceCount).toBe(0);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
        texture.off('destroy');
        manager.destroyAll();
    });

    it('defers native destruction for textures used by a pending submission', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });

        beginWebGPUTextureSubmission(manager);
        manager.get(texture);
        texture.destroy();

        expect(manager.resourceCount).toBe(0);
        expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();
        endWebGPUTextureSubmission(manager);
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
    });

    it('rejects destroyAll without side effects while a submission is active', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4])
        });

        beginWebGPUTextureSubmission(manager);
        const resource = manager.get(texture);
        expect(() => {
            manager.destroyAll();
        }).toThrow(/while a submission is active/);

        expect(manager.resourceCount).toBe(1);
        expect(manager.get(texture).gpuTexture).toBe(resource.gpuTexture);
        expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();
        endWebGPUTextureSubmission(manager);
        expect(fake.textures[0]?.destroy).not.toHaveBeenCalled();

        manager.destroyAll();
        expect(fake.textures[0]?.destroy).toHaveBeenCalledOnce();
    });

    it('consumes external sub-texture updates once and preserves their origin', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({ image: new ImageData(4, 4) });
        manager.get(texture);

        texture.updateSubTexture({
            mipLevel: 0,
            x: 1,
            y: 2,
            width: 1,
            height: 1,
            image: new ImageData(1, 1)
        });
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
        const manager = createTextureManager(fake.device);
        const depth = new Texture({
            width: 4,
            height: 4,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_SHORT,
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

    it('retains the default comparison function of an external depth attachment', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const depth = new Texture({
            width: 4,
            height: 4,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_SHORT,
            minFilter: LINEAR,
            magFilter: LINEAR,
            image: null
        });
        const native = fake.createTexture({} as GPUTextureDescriptor);
        const registered = manager.registerExternal(depth, native, {
            takeOwnership: true,
            compare: GEQUAL
        });

        const defaultCompare = getWebGPUTextureDefaultCompare(manager, depth);
        expect(defaultCompare).toBe(GEQUAL);
        if (defaultCompare === undefined) throw new Error('External depth comparison was not kept');
        expect(manager.get(depth, { compare: defaultCompare }).sampler).toBe(registered.sampler);

        manager.destroy(depth);
        expect(getWebGPUTextureDefaultCompare(manager, depth)).toBeUndefined();
    });

    it('keeps low-level regular and comparison descriptor snapshots immutable', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const depth = new Texture({
            width: 4,
            height: 4,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_SHORT,
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
        const manager = createTextureManager(fake.device);
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

    it('bounds immutable sampler descriptors with least-recently-used eviction', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const wrapModes = [CLAMP_TO_EDGE, MIRRORED_REPEAT, REPEAT] as const;
        const wrapMode = (index: number) => wrapModes[index % wrapModes.length] ?? CLAMP_TO_EDGE;
        const textures = Array.from(
            { length: MAX_CACHED_WEBGPU_SAMPLERS + 1 },
            (_, index) =>
                new Texture({
                    width: 1,
                    height: 1,
                    image: null,
                    minFilter: LINEAR,
                    magFilter: LINEAR,
                    wrapS: wrapMode(index),
                    wrapT: wrapMode(Math.floor(index / 3)),
                    wrapR: wrapMode(Math.floor(index / 9)),
                    anisotropic: Math.floor(index / 27) + 1
                })
        );
        const firstTexture = textures[0];
        const secondTexture = textures[1];
        const overflowTexture = textures[MAX_CACHED_WEBGPU_SAMPLERS];
        if (!firstTexture || !secondTexture || !overflowTexture) {
            throw new Error('Incomplete sampler LRU fixture');
        }
        const first = manager.get(firstTexture);
        const second = manager.get(secondTexture);
        for (let index = 2; index < MAX_CACHED_WEBGPU_SAMPLERS; index++) {
            const cachedTexture = textures[index];
            if (!cachedTexture) throw new Error('Missing sampler LRU texture');
            manager.get(cachedTexture);
        }
        expect(fake.createSampler).toHaveBeenCalledTimes(MAX_CACHED_WEBGPU_SAMPLERS);

        expect(manager.get(firstTexture)).toBe(first);
        manager.get(overflowTexture);
        expect(manager.get(firstTexture)).toBe(first);
        expect(fake.createSampler).toHaveBeenCalledTimes(MAX_CACHED_WEBGPU_SAMPLERS + 1);

        const rebuiltSecond = manager.get(secondTexture);
        expect(fake.createSampler).toHaveBeenCalledTimes(MAX_CACHED_WEBGPU_SAMPLERS + 2);
        expect(rebuiltSecond).not.toBe(second);
        expect(rebuiltSecond.gpuTexture).toBe(second.gpuTexture);
        expect(rebuiltSecond.view).toBe(second.view);
        expect(rebuiltSecond.sampler).not.toBe(second.sampler);
        expect(getWebGPUNativeDeviceCache(fake.device).samplerSize).toBe(
            MAX_CACHED_WEBGPU_SAMPLERS
        );
    });

    it('bounds per-texture snapshots and replaces snapshots backed by an evicted sampler', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const texture = new Texture({ width: 1, height: 1, image: null });
        manager.get(texture);
        interface TextureResourceCacheFixture {
            readonly snapshots: Map<string, { readonly sampler: GPUSampler }>;
        }
        const resources = Reflect.get(manager, 'resourcesByTexture') as WeakMap<
            Texture<unknown>,
            TextureResourceCacheFixture
        >;
        const resource = resources.get(texture);
        if (!resource) throw new Error('Missing texture resource cache fixture');
        const snapshotResource = Reflect.get(manager, 'snapshotResource') as (
            resource: TextureResourceCacheFixture,
            samplerKey: string,
            sampler: GPUSampler
        ) => { readonly sampler: GPUSampler };
        const snapshots = resource.snapshots;
        snapshots.clear();
        const samplers = Array.from(
            { length: MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS + 1 },
            (_, index) => ({ index }) as unknown as GPUSampler
        );
        for (let index = 0; index < MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS; index++) {
            const sampler = samplers[index];
            if (!sampler) throw new Error('Missing sampler cache fixture');
            snapshotResource.call(manager, resource, String(index), sampler);
        }

        const firstSampler = samplers.at(0);
        const overflowSampler = samplers.at(MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS);
        if (!firstSampler || !overflowSampler) throw new Error('Incomplete sampler cache fixture');
        const first = snapshotResource.call(manager, resource, '0', firstSampler);
        snapshotResource.call(
            manager,
            resource,
            String(MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS),
            overflowSampler
        );
        expect(snapshots).toHaveLength(MAX_CACHED_WEBGPU_TEXTURE_SNAPSHOTS);
        expect(snapshots.has('0')).toBe(true);
        expect(snapshots.has('1')).toBe(false);

        const replacementSampler = { replacement: true } as unknown as GPUSampler;
        const replacement = snapshotResource.call(manager, resource, '0', replacementSampler);
        expect(replacement).not.toBe(first);
        expect(replacement.sampler).toBe(replacementSampler);
        expect(snapshots.get('0')).toBe(replacement);
    });

    it('validates sampler state before allocating and destroys failed texture transactions', () => {
        expect(() => createWebGPUSamplerDescriptor(new Texture(), 0)).toThrow(/mipLevelCount/);

        const invalidSampler = createFakeWebGPU();
        const invalidTexture = new Texture({ width: 1, height: 1, image: null, anisotropic: 0 });
        expect(() => createTextureManager(invalidSampler.device).get(invalidTexture)).toThrow(
            /anisotropy/
        );
        expect(invalidSampler.createTexture).not.toHaveBeenCalled();

        const rejectedSampler = createFakeWebGPU();
        rejectedSampler.createSampler.mockImplementationOnce(() => {
            throw new Error('device rejected sampler');
        });
        expect(() =>
            createTextureManager(rejectedSampler.device).get(
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
            createTextureManager(invalidView.device).get(
                new Texture({ width: 1, height: 1, image: null })
            )
        ).toThrow(/view creation failed/);
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('replaces external registrations transactionally and safely aliases one native texture', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
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
        const manager = createTextureManager(fake.device);
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
        const manager = createTextureManager(fake.device);
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
        const manager = createTextureManager(fake.device);
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
        const manager = createTextureManager(fake.device);
        const texture = new Texture({ image: new ImageData(4, 4) });
        manager.get(texture);
        texture.updateSubTexture({
            mipLevel: 0,
            x: 1,
            y: 2,
            width: 1,
            height: 1,
            image: new ImageData(1, 1)
        });
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
        const manager = createTextureManager(fake.device);
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
            capabilities: {
                MAX_TEXTURE_SIZE: 0,
                MAX_TEXTURE_INDEX: 0,
                MAX_TEXTURE_MAX_ANISOTROPY: 1
            } as WebGLCapabilities,
            extensions: {
                textureFilterAnisotropic: null
            } as WebGLExtensions,
            activeTexture: vi.fn(),
            bindTexture: vi.fn(),
            pixelStorei: vi.fn()
        };
        const glTexture = {} as WebGLTexture;

        updateWebGLTexture(state, texture, glTexture);
        manager.get(texture);
        expect(texture.needUpdate).toBe(false);

        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: new Uint8Array([5, 6, 7, 8])
        });
        updateWebGLTexture(state, texture, glTexture);
        manager.get(texture);

        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: new Uint8Array([9, 10, 11, 12])
        });
        manager.get(texture);
        updateWebGLTexture(state, texture, glTexture);

        expect(texImage2D).toHaveBeenCalledOnce();
        expect(texSubImage2D).toHaveBeenCalledTimes(2);
        expect(fake.queue.writeTexture).toHaveBeenCalledTimes(3);
    });

    it('imports the central recovery backing when WebGL2 releases the image first', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const pixels = new Uint8Array([17, 34, 51, 255]);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: pixels,
            isImageCanRelease: true
        });
        const gl = {
            TEXTURE0: 0x84c0,
            TEXTURE_MAG_FILTER: 0x2800,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            createTexture: vi.fn(() => ({})),
            deleteTexture: vi.fn(),
            texImage2D: vi.fn(),
            texParameterf: vi.fn(),
            generateMipmap: vi.fn()
        } as unknown as WebGL2RenderingContext;
        const state = {
            gl,
            capabilities: {
                MAX_TEXTURE_SIZE: 4096,
                MAX_TEXTURE_INDEX: 0,
                MAX_TEXTURE_MAX_ANISOTROPY: 1
            } as WebGLCapabilities,
            extensions: {
                textureFilterAnisotropic: null
            } as WebGLExtensions,
            activeTexture: vi.fn(),
            bindTexture: vi.fn(),
            pixelStorei: vi.fn()
        };
        const webglManager = new WebGLTextureManager(state);

        try {
            webglManager.get(texture);
            expect(texture.isImageReleased).toBe(true);
            expect(() => texture.image).toThrow(/has been released/);

            expect(() => manager.get(texture)).not.toThrow();
            expect(fake.queue.writeTexture).toHaveBeenCalledOnce();
            const upload = fake.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array;
            expect(Array.from(upload.subarray(0, 4))).toEqual(Array.from(pixels));
            expect(texture.isImageReleased).toBe(true);
        } finally {
            webglManager.destroy();
            manager.destroyAll();
        }
    });

    it('recovers released null images and explicit mipmaps from WebGL2', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const gl = {
            TEXTURE0: 0x84c0,
            TEXTURE_MAG_FILTER: 0x2800,
            TEXTURE_MIN_FILTER: 0x2801,
            TEXTURE_WRAP_S: 0x2802,
            TEXTURE_WRAP_T: 0x2803,
            createTexture: vi.fn(() => ({})),
            deleteTexture: vi.fn(),
            texImage2D: vi.fn(),
            texParameterf: vi.fn(),
            generateMipmap: vi.fn()
        } as unknown as WebGL2RenderingContext;
        const state = {
            gl,
            capabilities: {
                MAX_TEXTURE_SIZE: 4096,
                MAX_TEXTURE_INDEX: 0,
                MAX_TEXTURE_MAX_ANISOTROPY: 1
            } as WebGLCapabilities,
            extensions: {
                textureFilterAnisotropic: null
            } as WebGLExtensions,
            activeTexture: vi.fn(),
            bindTexture: vi.fn(),
            pixelStorei: vi.fn()
        };
        const webglManager = new WebGLTextureManager(state);
        const mipTexture = new Texture({
            width: 2,
            height: 2,
            image: null,
            minFilter: LINEAR_MIPMAP_LINEAR,
            mipmaps: [
                { data: new Uint8Array(16).fill(1), width: 2, height: 2 },
                { data: new Uint8Array(4).fill(2), width: 1, height: 1 }
            ],
            isImageCanRelease: true
        });
        const emptyTexture = new Texture({
            width: 1,
            height: 1,
            image: null,
            isImageCanRelease: true
        });

        try {
            webglManager.get(mipTexture);
            webglManager.get(emptyTexture);
            expect(mipTexture.isImageReleased).toBe(true);
            expect(emptyTexture.isImageReleased).toBe(true);

            expect(() => manager.get(mipTexture)).not.toThrow();
            expect(() => manager.get(emptyTexture)).not.toThrow();
            expect(fake.queue.writeTexture).toHaveBeenCalledTimes(2);
            expect(fake.createTexture).toHaveBeenCalledTimes(2);
        } finally {
            webglManager.destroy();
            manager.destroyAll();
        }
    });

    it('releases CPU image data only after caching the descriptor and successful upload', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
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

    it('recovers immutable TypedArray and DataView bytes after caller mutation', () => {
        const first = createFakeWebGPU();
        const replacement = createFakeWebGPU();
        const manager = createTextureManager(first.device);
        const typedSource = new Uint8Array([1, 2, 3, 4]);
        const dataViewStorage = new Uint8Array([0, 5, 6, 7, 8, 0]);
        const typedTexture = new Texture({
            width: 1,
            height: 1,
            image: typedSource,
            isImageCanRelease: true
        });
        const dataViewTexture = new Texture<DataView>({
            width: 1,
            height: 1,
            image: new DataView(dataViewStorage.buffer, 1, 4),
            isImageCanRelease: true
        });
        manager.get(typedTexture);
        manager.get(dataViewTexture);
        typedSource.fill(99);
        dataViewStorage.fill(88);

        suspendWebGPUTextures(manager);
        restoreWebGPUTextureDevice(manager, replacement.device);
        manager.get(typedTexture);
        manager.get(dataViewTexture);

        expect(Array.from(replacement.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array)).toEqual(
            [1, 2, 3, 4]
        );
        expect(Array.from(replacement.queue.writeTexture.mock.calls[1]?.[1] as Uint8Array)).toEqual(
            [5, 6, 7, 8]
        );
    });

    it('recovers immutable explicit mip levels after their public storage is released', () => {
        const first = createFakeWebGPU(['texture-compression-bc']);
        const replacement = createFakeWebGPU(['texture-compression-bc']);
        const manager = createTextureManager(first.device);
        const mipmaps = [
            { width: 4, height: 4, data: new Uint8Array(8).fill(1) },
            { width: 2, height: 2, data: new Uint8Array(8).fill(2) },
            { width: 1, height: 1, data: new Uint8Array(8).fill(3) }
        ];
        const texture = new Texture({
            compressed: true,
            width: 4,
            height: 4,
            internalFormat: COMPRESSED_RGB_S3TC_DXT1_EXT,
            format: RGB,
            image: mipmaps[0]?.data,
            mipmaps,
            minFilter: LINEAR_MIPMAP_LINEAR,
            isImageCanRelease: true
        });
        manager.get(texture);
        mipmaps.forEach(mipmap => mipmap.data.fill(9));

        suspendWebGPUTextures(manager);
        restoreWebGPUTextureDevice(manager, replacement.device);
        manager.get(texture);

        expect(
            replacement.queue.writeTexture.mock.calls.map(call => Array.from(call[1] as Uint8Array))
        ).toEqual([new Array(8).fill(1), new Array(8).fill(2), new Array(8).fill(3)]);
    });

    it('recovers cube external-image faces from private snapshots', () => {
        const first = createFakeWebGPU();
        const replacement = createFakeWebGPU();
        const manager = createTextureManager(first.device);
        const faces = Array.from({ length: 6 }, (_, index) => {
            const face = new ImageData(1, 1);
            face.data.set([index + 1, 20, 30, 255]);
            return face;
        });
        const texture = new CubeTexture({ image: faces, isImageCanRelease: true });
        manager.get(texture);
        faces.forEach(face => face.data.fill(0));

        suspendWebGPUTextures(manager);
        restoreWebGPUTextureDevice(manager, replacement.device);
        manager.get(texture);

        const recoveredSources = replacement.queue.copyExternalImageToTexture.mock.calls.map(
            call => (call[0] as { readonly source: GPUCopyExternalImageSource }).source as ImageData
        );
        expect(recoveredSources).toHaveLength(6);
        expect(recoveredSources.map(source => source.data[0])).toEqual([1, 2, 3, 4, 5, 6]);
        expect(recoveredSources.every((source, index) => source !== faces[index])).toBe(true);
    });

    it('merges immutable sub-texture updates into the recovery replay', () => {
        const first = createFakeWebGPU();
        const replacement = createFakeWebGPU();
        const manager = createTextureManager(first.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4]),
            isImageCanRelease: true
        });
        manager.get(texture);
        const update = new Uint8Array([5, 6, 7, 8]);
        texture.updateSubTexture({
            mipLevel: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            image: update
        });
        manager.get(texture);
        update.fill(99);

        suspendWebGPUTextures(manager);
        restoreWebGPUTextureDevice(manager, replacement.device);
        manager.get(texture);

        expect(replacement.queue.writeTexture).toHaveBeenCalledOnce();
        expect(Array.from(replacement.queue.writeTexture.mock.calls[0]?.[1] as Uint8Array)).toEqual(
            [5, 6, 7, 8]
        );
    });

    it('detaches manager-local recovery state while retaining central cross-backend recovery', () => {
        const first = createFakeWebGPU();
        const replacement = createFakeWebGPU();
        const manager = createTextureManager(first.device);
        // Keep the backing large enough to prove that real pixel storage is released without
        // making coverage instrumentation spend most of the test budget copying multi-megabyte
        // arrays byte by byte.
        const rawPixels = new Uint8Array(128 * 128 * 4).fill(17);
        const rawTexture = new Texture({
            width: 128,
            height: 128,
            image: rawPixels,
            isImageCanRelease: true
        });
        const imageData = new ImageData(2, 2);
        imageData.data.fill(34);
        const imageDataTexture = new Texture({ image: imageData, isImageCanRelease: true });
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 2;
        const externalTexture = new Texture({ image: canvas, isImageCanRelease: true });
        const textures: readonly Texture<unknown>[] = [
            rawTexture,
            imageDataTexture,
            externalTexture
        ];
        textures.forEach(texture => manager.get(texture));

        const oldBackings = Reflect.get(manager, 'recoverableBackings') as WeakMap<
            Texture<unknown>,
            { readonly image: unknown }
        >;
        const oldListenersByTexture = Reflect.get(manager, 'recoveryDestroyListeners') as WeakMap<
            Texture<unknown>,
            { readonly texture: WeakRef<Texture<unknown>>; readonly observer: () => void }
        >;
        const oldListenerOwners = Reflect.get(manager, 'recoveryListenerOwners') as Set<{
            readonly texture: WeakRef<Texture<unknown>>;
            readonly observer: () => void;
        }>;
        const oldObservers = textures.map(texture => {
            const observer = oldListenersByTexture.get(texture)?.observer;
            if (!observer) throw new Error(`Texture ${texture.id} has no recovery observer`);
            return observer;
        });

        expect((oldBackings.get(rawTexture)?.image as Uint8Array).byteLength).toBe(
            rawPixels.byteLength
        );
        expect(oldBackings.get(rawTexture)?.image).not.toBe(rawPixels);
        expect(oldBackings.get(imageDataTexture)?.image).toBeInstanceOf(ImageData);
        expect(oldBackings.get(imageDataTexture)?.image).not.toBe(imageData);
        expect(oldBackings.get(externalTexture)?.image).toBe(canvas);
        expect(oldListenerOwners).toHaveLength(textures.length);
        expect([...oldListenerOwners].map(owner => owner.observer)).toEqual(
            expect.arrayContaining(oldObservers)
        );

        manager.destroyAll();

        expect(oldListenerOwners).toHaveLength(0);
        textures.forEach((texture, index) => {
            expect(oldBackings.has(texture)).toBe(false);
            expect(oldListenersByTexture.has(texture)).toBe(false);

            // Reinsert a sentinel and run the real lifecycle. A detached internal observer must
            // not delete manager-local state after destroyAll().
            oldBackings.set(texture, { image: Symbol('detached-backing') });
            texture.destroy();
            expect(oldBackings.has(texture)).toBe(true);
            oldBackings.delete(texture);
            expect(oldObservers[index]).toBeTypeOf('function');
        });

        restoreWebGPUTextureDevice(manager, replacement.device);

        for (const texture of textures) {
            expect(() => manager.get(texture)).not.toThrow();
        }
        expect(replacement.createTexture).toHaveBeenCalledTimes(textures.length);
        expect(replacement.queue.writeTexture).toHaveBeenCalledOnce();
        expect(replacement.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
        manager.destroyAll();
    });

    it('rejects depth formats whose required device feature is not enabled', () => {
        const fake = createFakeWebGPU();
        const manager = createTextureManager(fake.device);
        const depthStencil = new Texture({
            width: 1,
            height: 1,
            internalFormat: DEPTH32F_STENCIL8,
            format: DEPTH_STENCIL,
            type: FLOAT_32_UNSIGNED_INT_24_8_REV,
            image: null
        });

        expect(() => manager.get(depthStencil)).toThrow(/requires.*depth32float-stencil8/);
        expect(fake.textures).toHaveLength(0);
    });
});
