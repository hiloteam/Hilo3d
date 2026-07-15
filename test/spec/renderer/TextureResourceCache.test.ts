import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import {
    BYTE,
    CLAMP_TO_EDGE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    DEPTH_STENCIL,
    FLOAT,
    LEQUAL,
    LINEAR,
    LINEAR_MIPMAP_LINEAR,
    MIRRORED_REPEAT,
    NEAREST,
    NEAREST_MIPMAP_NEAREST,
    REPEAT,
    RGB,
    RGBA,
    TEXTURE_2D,
    TEXTURE_CUBE_MAP,
    UNSIGNED_BYTE,
    UNSIGNED_INT,
    UNSIGNED_SHORT
} from '../../../src/constants/webgl';
import {
    DEPTH24_STENCIL8,
    DEPTH32F_STENCIL8,
    DEPTH_COMPONENT24,
    DEPTH_COMPONENT32F,
    FLOAT_32_UNSIGNED_INT_24_8_REV,
    HALF_FLOAT,
    R8,
    R8I,
    RED,
    RED_INTEGER,
    RG,
    RG8UI,
    RG8_SNORM,
    RG_INTEGER,
    RGB8,
    RGB8I,
    RGB_INTEGER,
    RGBA8,
    RGBA16F,
    RGBA32F,
    SRGB8_ALPHA8,
    TEXTURE_2D_ARRAY,
    TEXTURE_3D,
    UNSIGNED_INT_24_8
} from '../../../src/constants/webgl2';
import {
    COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
    COMPRESSED_RGBA_S3TC_DXT1_EXT
} from '../../../src/constants/webglExtensions';
import LightManager from '../../../src/light/LightManager';
import type RendererCore from '../../../src/render/RendererCore';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import { RenderFrame } from '../../../src/render/frame/RenderFrame';
import { createRenderFrameContext } from '../../../src/render/frame/RenderFrameContext';
import type { RenderPassTemplate } from '../../../src/render/graph/RenderGraphBuilder';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { TextureResourceCache } from '../../../src/render/renderer/TextureResourceCache';
import {
    RHITextureUsage,
    type RHICapabilities,
    type RHIFeatureName,
    type RHITextureFormat,
    type RHITextureFormatCapabilities
} from '../../../src/render/rhi/core';
import DataTexture from '../../../src/texture/DataTexture';
import Texture, { getTextureRecoveryBacking } from '../../../src/texture/Texture';
import { describe, expect, it, vi } from 'vitest';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice,
    type FakeRHISampler,
    type FakeRHITexture,
    type FakeRHITextureView
} from '../rhi/v2/FakeRHIBackend';

function frameContext(device: FakeRHIDevice, frameIndex: number) {
    return createRenderFrameContext({
        renderer: {} as RendererCore,
        rhi: device,
        frameIndex,
        camera: new PerspectiveCamera(),
        lightManager: new LightManager(),
        fog: null,
        viewport: { x: 0, y: 0, width: 8, height: 8, minDepth: 0, maxDepth: 1 }
    });
}

type FrameFailure = 'build' | 'prepare' | 'execute' | null;

function runCacheFrame(
    frame: RenderFrame,
    device: FakeRHIDevice,
    frameIndex: number,
    cache: TextureResourceCache,
    prepare: () => void,
    failure: FrameFailure = null
) {
    return frame.execute(frameContext(device, frameIndex), scope => {
        cache.beginFrame(frameIndex, scope.uploads);
        if (failure === 'build') throw new Error('texture cache build failure');
        const template: RenderPassTemplate<undefined> = {
            name: 'texture resource cache test',
            setup(pass) {
                pass.markSideEffect();
            },
            prepare() {
                prepare();
                if (failure === 'prepare') throw new Error('texture cache prepare failure');
            },
            execute() {
                if (failure === 'execute') throw new Error('texture cache execute failure');
            }
        };
        scope.graph.addPass(template, undefined);
    });
}

async function complete(backend: FakeRHIBackend): Promise<void> {
    if (backend.executionMode === 'deferred') {
        const submission = backend.completeNextSubmission();
        await submission.done;
    }
}

function rgba8Texture(
    pixels: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number
): Texture<Uint8Array | Uint8ClampedArray> {
    return new Texture({
        image: pixels,
        target: TEXTURE_2D,
        internalFormat: RGBA8,
        format: RGBA,
        type: UNSIGNED_BYTE,
        width,
        height,
        depth: 1,
        magFilter: LINEAR,
        minFilter: NEAREST,
        wrapS: REPEAT,
        wrapT: CLAMP_TO_EDGE,
        wrapR: MIRRORED_REPEAT
    });
}

function installCapabilities(
    device: FakeRHIDevice,
    options: {
        readonly features?: readonly RHIFeatureName[];
        readonly formats?: Readonly<
            Partial<Record<RHITextureFormat, RHITextureFormatCapabilities>>
        >;
    }
): void {
    const original = device.capabilities;
    const features = new Set(original.features);
    for (const feature of options.features ?? []) features.add(feature);
    const capabilities: RHICapabilities = {
        features,
        limits: original.limits,
        getTextureFormatCapabilities(format) {
            return options.formats?.[format] ?? original.getTextureFormatCapabilities(format);
        }
    };
    Object.defineProperty(device, 'capabilities', { value: capabilities });
}

const SAMPLED_FILTERABLE_FORMAT: RHITextureFormatCapabilities = Object.freeze({
    sampled: true,
    filterable: true,
    renderable: false,
    blendable: false,
    storage: false,
    sampleCounts: Object.freeze([])
});

describe.each([
    ['immediate WebGL2', () => new FakeWebGLRHIBackend()],
    ['deferred WebGPU', () => new FakeWebGPURHIBackend()]
] as const)('TextureResourceCache on %s', (_name, createBackend) => {
    it('uploads exact RGBA8 bytes, maps sampler state, and has a stable steady hit', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const getTextureFormatCapabilities = vi.spyOn(
            device.capabilities,
            'getTextureFormatCapabilities'
        );
        const source = rgba8Texture(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1);
        let texture: FakeRHITexture | undefined;
        let view: FakeRHITextureView | undefined;
        let sampler: FakeRHISampler | undefined;
        let firstHandles: ReturnType<TextureResourceCache['getHandles']> | undefined;

        const first = runCacheFrame(frame, device, 1, cache, () => {
            firstHandles = cache.prepare(source, { compare: LEQUAL });
            texture = cache.resolveTexture(source) as FakeRHITexture;
            view = cache.resolveView(source) as FakeRHITextureView;
            sampler = cache.resolveSampler(source) as FakeRHISampler;
        });
        await complete(backend);
        await first.submission.done;

        expect(texture?.usage).toBe(RHITextureUsage.TEXTURE_BINDING | RHITextureUsage.COPY_DST);
        expect(texture?.descriptor).toMatchObject({
            size: { width: 2, height: 1, depthOrArrayLayers: 1 },
            mipLevelCount: 1,
            sampleCount: 1,
            dimension: '2d',
            viewDimension: '2d',
            format: 'rgba8unorm'
        });
        expect(view?.texture).toBe(texture);
        expect(sampler?.descriptor).toMatchObject({
            addressModeU: 'repeat',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'mirror-repeat',
            magFilter: 'linear',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            lodMinClamp: 0,
            lodMaxClamp: 0,
            compare: 'less-equal'
        });
        expect([...(texture?.snapshotLastWriteBytes() ?? [])]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(cache.diagnostics(source)).toMatchObject({
            committedRevision: source.updateRevision,
            width: 2,
            height: 1
        });
        const capabilityReadsAfterMiss = getTextureFormatCapabilities.mock.calls.length;

        backend.resetExecutionLog();
        let steadyHandles: ReturnType<TextureResourceCache['getHandles']> | undefined;
        const steady = runCacheFrame(frame, device, 2, cache, () => {
            steadyHandles = cache.prepare(source, { compare: 'less-equal' });
            expect(cache.resolveTexture(source)).toBe(texture);
            expect(cache.resolveView(source)).toBe(view);
            expect(cache.resolveSampler(source)).toBe(sampler);
        });
        await complete(backend);
        await steady.submission.done;
        expect(steadyHandles).toBe(firstHandles);
        expect(getTextureFormatCapabilities).toHaveBeenCalledTimes(capabilityReadsAfterMiss);
        expect(
            backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toEqual([]);

        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('retries an uncommitted revision after execute failure', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        let resource: FakeRHITexture | undefined;
        const initial = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            resource = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await initial.submission.done;
        const committed = source.updateRevision;

        source.image = new Uint8Array([9, 8, 7, 6]);
        backend.resetExecutionLog();
        expect(() =>
            runCacheFrame(frame, device, 2, cache, () => cache.prepare(source), 'execute')
        ).toThrow('texture cache execute failure');
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(source)?.committedRevision).toBe(committed);

        const retry = runCacheFrame(frame, device, 3, cache, () => {
            cache.prepare(source);
            expect(cache.resolveTexture(source)).toBe(resource);
        });
        await complete(backend);
        await retry.submission.done;
        expect(
            backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toHaveLength(backend.executionMode === 'immediate' ? 2 : 1);
        expect([...(resource?.snapshotLastWriteBytes() ?? [])]).toEqual([9, 8, 7, 6]);
        expect(cache.diagnostics(source)?.committedRevision).toBe(source.updateRevision);

        cache.destroy();
        registry.collect(3);
        backend.destroy();
    });

    it('releases opted-in CPU images only after commit and replays the immutable backing', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const pixels = new Uint8Array([17, 34, 51, 255]);
        const source = rgba8Texture(pixels, 1, 1);
        source.isImageCanRelease = true;

        const initial = runCacheFrame(frame, firstDevice, 1, cache, () => {
            cache.prepare(source);
            expect(source.isImageReleased).toBe(false);
            expect(source.image).toBe(pixels);
        });
        expect(source.isImageReleased).toBe(true);
        expect(() => source.image).toThrow(/has been released/u);
        expect(getTextureRecoveryBacking(source)?.image).not.toBe(pixels);
        await complete(backend);
        await initial.submission.done;

        pixels.fill(0);
        backend.resetExecutionLog();
        const steady = runCacheFrame(frame, firstDevice, 2, cache, () => cache.prepare(source));
        await complete(backend);
        await steady.submission.done;
        expect(
            backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toEqual([]);

        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        backend.resetExecutionLog();
        let recovered: FakeRHITexture | undefined;
        const restored = runCacheFrame(frame, secondDevice, 3, cache, () => {
            cache.prepare(source);
            recovered = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await restored.submission.done;
        expect([...(recovered?.snapshotLastWriteBytes() ?? [])]).toEqual([17, 34, 51, 255]);
        expect(source.isImageReleased).toBe(true);

        cache.destroy();
        registry.collect(3);
        backend.destroy();
    });

    it('keeps an opted-in CPU image readable when the upload transaction rolls back', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const pixels = new Uint8Array([1, 2, 3, 4]);
        const source = rgba8Texture(pixels, 1, 1);
        source.isImageCanRelease = true;

        expect(() =>
            runCacheFrame(frame, device, 1, cache, () => cache.prepare(source), 'execute')
        ).toThrow('texture cache execute failure');
        expect(source.isImageReleased).toBe(false);
        expect(source.image).toBe(pixels);
        expect(getTextureRecoveryBacking(source)).toBeUndefined();

        runCacheFrame(frame, device, 2, cache, () => cache.prepare(source));
        expect(source.isImageReleased).toBe(true);

        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('rebuilds stable handles on same-backend recovery and reuploads current bytes', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        let handles: ReturnType<TextureResourceCache['getHandles']> | undefined;
        let firstTexture: FakeRHITexture | undefined;
        const initial = runCacheFrame(frame, firstDevice, 1, cache, () => {
            handles = cache.prepare(source);
            firstTexture = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await initial.submission.done;

        source.image = new Uint8Array([7, 6, 5, 4]);
        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        expect(cache.getHandles(source)).toBe(handles);
        const recovered = cache.resolveTexture(source) as FakeRHITexture;
        expect(recovered).not.toBe(firstTexture);
        expect(recovered.deviceId).toBe(secondDevice.id);
        expect(firstTexture?.destroyed).toBe(true);
        expect(cache.diagnostics(source)).toMatchObject({
            committedRevision: -1,
            registryGeneration: 2
        });

        backend.resetExecutionLog();
        const restored = runCacheFrame(frame, secondDevice, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
        });
        await complete(backend);
        await restored.submission.done;
        expect([...recovered.snapshotLastWriteBytes()]).toEqual([7, 6, 5, 4]);
        expect(
            backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toHaveLength(1);
        expect(cache.diagnostics(source)?.committedRevision).toBe(source.updateRevision);

        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('uploads a complete 2D mip chain and reuses its exact steady-state handles', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: null,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            width: 2,
            height: 2,
            magFilter: LINEAR,
            minFilter: LINEAR_MIPMAP_LINEAR,
            mipmaps: [
                {
                    data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
                    width: 2,
                    height: 2
                },
                { data: new Uint8Array([17, 18, 19, 20]), width: 1, height: 1 }
            ]
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        let handles: ReturnType<TextureResourceCache['prepare']> | undefined;
        let texture: FakeRHITexture | undefined;
        let view: FakeRHITextureView | undefined;
        let sampler: FakeRHISampler | undefined;

        const initial = runCacheFrame(frame, device, 1, cache, () => {
            handles = cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
            view = cache.resolveView(source) as FakeRHITextureView;
            sampler = cache.resolveSampler(source) as FakeRHISampler;
        });
        await complete(backend);
        await initial.submission.done;

        expect(texture?.mipLevelCount).toBe(2);
        expect(view?.descriptor).toMatchObject({ dimension: '2d', mipLevelCount: 2 });
        expect(sampler?.descriptor).toMatchObject({
            minFilter: 'linear',
            mipmapFilter: 'linear',
            lodMaxClamp: 1
        });
        expect(writeTexture).toHaveBeenCalledTimes(2);
        expect(writeTexture.mock.calls.map(call => call[0].mipLevel)).toEqual([0, 1]);
        expect([...(texture?.snapshotLastWriteBytes() ?? [])]).toEqual([17, 18, 19, 20]);

        writeTexture.mockClear();
        const steady = runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
        });
        await complete(backend);
        await steady.submission.done;
        expect(writeTexture).not.toHaveBeenCalled();

        writeTexture.mockRestore();
        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('generates a 2D mip chain after level-zero upload and regenerates on updates', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: new Uint8Array(4 * 4 * 4).fill(7),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            width: 4,
            height: 4,
            magFilter: LINEAR,
            minFilter: LINEAR_MIPMAP_LINEAR
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        const generateMipmaps = vi.spyOn(RHIUploadBatch.prototype, 'generateMipmaps');
        let handles: ReturnType<TextureResourceCache['prepare']> | undefined;
        let texture: FakeRHITexture | undefined;
        let sampler: FakeRHISampler | undefined;

        const initial = runCacheFrame(frame, device, 1, cache, () => {
            handles = cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
            sampler = cache.resolveSampler(source) as FakeRHISampler;
        });
        await complete(backend);
        await initial.submission.done;
        expect(texture?.descriptor).toMatchObject({
            mipLevelCount: 3,
            usage:
                RHITextureUsage.COPY_DST |
                RHITextureUsage.TEXTURE_BINDING |
                RHITextureUsage.RENDER_ATTACHMENT
        });
        expect(sampler?.descriptor).toMatchObject({ lodMaxClamp: 2, mipmapFilter: 'linear' });
        expect(writeTexture).toHaveBeenCalledTimes(1);
        expect(generateMipmaps).toHaveBeenCalledTimes(1);
        const firstUpload = backend.executionLog.findIndex(command =>
            command.startsWith('write-texture:')
        );
        const firstGenerate = backend.executionLog.findIndex(command =>
            command.startsWith('generate-mipmaps:')
        );
        expect(firstGenerate).toBeGreaterThan(firstUpload);

        writeTexture.mockClear();
        generateMipmaps.mockClear();
        const steady = runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
        });
        await complete(backend);
        await steady.submission.done;
        expect(writeTexture).not.toHaveBeenCalled();
        expect(generateMipmaps).not.toHaveBeenCalled();

        source.image = new Uint8Array(4 * 4 * 4).fill(9);
        const updated = runCacheFrame(frame, device, 3, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
            expect(cache.resolveTexture(source)).toBe(texture);
        });
        await complete(backend);
        await updated.submission.done;
        expect(writeTexture).toHaveBeenCalledTimes(1);
        expect(generateMipmaps).toHaveBeenCalledTimes(1);

        writeTexture.mockRestore();
        generateMipmaps.mockRestore();
        cache.destroy();
        registry.collect(3);
        backend.destroy();
    });

    it('generates every cube face mip chain through one portable upload command', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const faces = Array.from({ length: 6 }, (_unused, face) =>
            new Uint8Array(2 * 2 * 4).fill(face + 1)
        );
        const source = new Texture({
            image: faces,
            target: TEXTURE_CUBE_MAP,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            width: 2,
            height: 2,
            magFilter: NEAREST,
            minFilter: NEAREST_MIPMAP_NEAREST,
            wrapS: CLAMP_TO_EDGE,
            wrapT: CLAMP_TO_EDGE
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        const generateMipmaps = vi.spyOn(RHIUploadBatch.prototype, 'generateMipmaps');
        let texture: FakeRHITexture | undefined;
        let view: FakeRHITextureView | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
            view = cache.resolveView(source) as FakeRHITextureView;
        });
        await complete(backend);
        await rendered.submission.done;
        expect(texture?.descriptor).toMatchObject({
            size: { depthOrArrayLayers: 6 },
            mipLevelCount: 2,
            viewDimension: 'cube'
        });
        expect(view?.descriptor).toMatchObject({
            dimension: 'cube',
            mipLevelCount: 2,
            arrayLayerCount: 6
        });
        expect(writeTexture).toHaveBeenCalledTimes(6);
        expect(writeTexture.mock.calls.map(call => call[0].origin?.z)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(generateMipmaps).toHaveBeenCalledTimes(1);

        writeTexture.mockRestore();
        generateMipmaps.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('recreates generated mipmaps from release-safe recovery backing', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: new Uint8Array(2 * 2 * 4).fill(23),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            width: 2,
            height: 2,
            magFilter: LINEAR,
            minFilter: LINEAR_MIPMAP_LINEAR
        });
        source.isImageCanRelease = true;

        const initial = runCacheFrame(frame, firstDevice, 1, cache, () => cache.prepare(source));
        await complete(backend);
        await initial.submission.done;
        expect(source.isImageReleased).toBe(true);
        expect(getTextureRecoveryBacking(source)?.image).not.toBeNull();

        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        backend.resetExecutionLog();
        const restored = runCacheFrame(frame, secondDevice, 2, cache, () => cache.prepare(source));
        await complete(backend);
        await restored.submission.done;
        const upload = backend.executionLog.findIndex(command =>
            command.startsWith('write-texture:')
        );
        const generate = backend.executionLog.findIndex(command =>
            command.startsWith('generate-mipmaps:')
        );
        expect(upload).toBeGreaterThanOrEqual(0);
        expect(generate).toBeGreaterThan(upload);
        expect(source.isImageReleased).toBe(true);

        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('uploads an explicit mip prefix while a non-mipmap sampler stays on level zero', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: null,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            width: 4,
            height: 4,
            magFilter: LINEAR,
            minFilter: LINEAR,
            mipmaps: [
                { data: new Uint8Array(64).fill(1), width: 4, height: 4 },
                { data: new Uint8Array(16).fill(2), width: 2, height: 2 }
            ]
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        let texture: FakeRHITexture | undefined;
        let sampler: FakeRHISampler | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
            sampler = cache.resolveSampler(source) as FakeRHISampler;
        });
        await complete(backend);
        await rendered.submission.done;

        expect(texture?.mipLevelCount).toBe(2);
        expect(sampler?.descriptor).toMatchObject({
            minFilter: 'linear',
            lodMinClamp: 0,
            lodMaxClamp: 0
        });
        expect(writeTexture.mock.calls.map(call => call[0].mipLevel)).toEqual([0, 1]);

        writeTexture.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('uploads every face in a canonical cube mip chain and expands RGB alpha', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const mipmaps = ([0, 1] as const).flatMap(level =>
            ([0, 1, 2, 3, 4, 5] as const).map(face => {
                const width = level === 0 ? 2 : 1;
                const value = level * 10 + face + 1;
                return {
                    data: new Uint8Array(width * width * 3).fill(value),
                    width,
                    height: width,
                    face
                };
            })
        );
        const source = new Texture({
            image: [],
            target: TEXTURE_CUBE_MAP,
            internalFormat: RGB8,
            format: RGB,
            type: UNSIGNED_BYTE,
            width: 2,
            height: 2,
            magFilter: LINEAR,
            minFilter: NEAREST_MIPMAP_NEAREST,
            wrapS: CLAMP_TO_EDGE,
            wrapT: CLAMP_TO_EDGE,
            mipmaps
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        let texture: FakeRHITexture | undefined;
        let view: FakeRHITextureView | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
            view = cache.resolveView(source) as FakeRHITextureView;
        });
        await complete(backend);
        await rendered.submission.done;

        expect(texture?.descriptor).toMatchObject({
            format: 'rgba8unorm',
            mipLevelCount: 2,
            size: { depthOrArrayLayers: 6 },
            viewDimension: 'cube'
        });
        expect(view?.descriptor).toMatchObject({
            dimension: 'cube',
            mipLevelCount: 2,
            arrayLayerCount: 6
        });
        expect(writeTexture).toHaveBeenCalledTimes(12);
        expect(writeTexture.mock.calls.map(call => [call[0].mipLevel, call[0].origin?.z])).toEqual([
            [0, 0],
            [0, 1],
            [0, 2],
            [0, 3],
            [0, 4],
            [0, 5],
            [1, 0],
            [1, 1],
            [1, 2],
            [1, 3],
            [1, 4],
            [1, 5]
        ]);
        expect([...(texture?.snapshotLastWriteBytes() ?? [])]).toEqual([16, 16, 16, 255]);

        writeTexture.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('supports default RGBA32F DataTexture and RGBA16F half-float payloads', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const floatPixels = new Float32Array(64);
        floatPixels.set([1, 2, 3, 4]);
        const floatSource = new DataTexture({ data: floatPixels });
        const halfPixels = new Uint16Array([0x3c00, 0x4000, 0x4200, 0x4400]);
        const halfSource = new Texture({
            image: halfPixels,
            internalFormat: RGBA16F,
            format: RGBA,
            type: HALF_FLOAT,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        let floatTexture: FakeRHITexture | undefined;
        let halfTexture: FakeRHITexture | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(floatSource);
            cache.prepare(halfSource);
            floatTexture = cache.resolveTexture(floatSource) as FakeRHITexture;
            halfTexture = cache.resolveTexture(halfSource) as FakeRHITexture;
        });
        await complete(backend);
        await rendered.submission.done;

        expect(floatTexture?.format).toBe('rgba32float');
        expect(floatTexture?.snapshotLastWriteBytes()).toEqual(new Uint8Array(floatPixels.buffer));
        expect(halfTexture?.format).toBe('rgba16float');
        expect(halfTexture?.snapshotLastWriteBytes()).toEqual(new Uint8Array(halfPixels.buffer));

        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('refreshes autoUpdate ImageData through CPU flipY without handle churn', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const image = new ImageData(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), 1, 2);
        const source = new Texture({
            image,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            flipY: true,
            autoUpdate: true,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        let handles: ReturnType<TextureResourceCache['prepare']> | undefined;
        let texture: FakeRHITexture | undefined;
        const initial = runCacheFrame(frame, device, 1, cache, () => {
            handles = cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await initial.submission.done;
        expect([...(texture?.snapshotLastWriteBytes() ?? [])]).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);

        image.data.set([9, 10, 11, 12, 13, 14, 15, 16]);
        backend.resetExecutionLog();
        const refreshed = runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
            expect(cache.resolveTexture(source)).toBe(texture);
        });
        await complete(backend);
        await refreshed.submission.done;
        expect([...(texture?.snapshotLastWriteBytes() ?? [])]).toEqual([
            13, 14, 15, 16, 9, 10, 11, 12
        ]);
        expect(
            backend.executionLog.filter(command => command.startsWith('write-texture:'))
        ).toHaveLength(1);

        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('maps enabled anisotropic filtering without replacing texture storage', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        installCapabilities(device, { features: ['anisotropic-filtering'] });
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        source.magFilter = LINEAR;
        source.minFilter = LINEAR;
        source.anisotropic = 4;
        let texture: FakeRHITexture | undefined;
        let sampler: FakeRHISampler | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
            sampler = cache.resolveSampler(source) as FakeRHISampler;
        });
        await complete(backend);
        await rendered.submission.done;
        expect(texture?.format).toBe('rgba8unorm');
        expect(sampler?.descriptor).toMatchObject({
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear',
            maxAnisotropy: 4
        });

        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('uploads external canvas content with orientation/alpha options, autoUpdate, and recovery', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 1;
        const source = new Texture({
            image: canvas,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            flipY: true,
            premultiplyAlpha: true,
            autoUpdate: true,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const externalCopy = vi.spyOn(RHIUploadBatch.prototype, 'copyExternalImageToTexture');
        let handles: ReturnType<TextureResourceCache['prepare']> | undefined;
        let texture: FakeRHITexture | undefined;

        const initial = runCacheFrame(frame, firstDevice, 1, cache, () => {
            handles = cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await initial.submission.done;
        expect(externalCopy).toHaveBeenCalledTimes(1);
        expect((texture?.usage ?? 0) & RHITextureUsage.RENDER_ATTACHMENT).not.toBe(0);
        expect(externalCopy.mock.calls[0]).toMatchObject([
            { source: canvas, flipY: true },
            { premultipliedAlpha: true, origin: { x: 0, y: 0, z: 0 } },
            { width: 2, height: 1, depthOrArrayLayers: 1 }
        ]);

        const refreshed = runCacheFrame(frame, firstDevice, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
        });
        await complete(backend);
        await refreshed.submission.done;
        expect(externalCopy).toHaveBeenCalledTimes(2);

        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        const restored = runCacheFrame(frame, secondDevice, 3, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
        });
        await complete(backend);
        await restored.submission.done;
        expect(externalCopy).toHaveBeenCalledTimes(3);
        expect(
            backend.executionLog.filter(command => command.startsWith('copy-external-texture:'))
        ).toHaveLength(3);

        externalCopy.mockRestore();
        cache.destroy();
        registry.collect(3);
        backend.destroy();
    });

    it('uploads six external cube faces in canonical layer order', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const faces = Array.from({ length: 6 }, () => {
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            return canvas;
        });
        const source = new Texture<unknown>({
            image: faces,
            target: TEXTURE_CUBE_MAP,
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const externalCopy = vi.spyOn(RHIUploadBatch.prototype, 'copyExternalImageToTexture');

        const rendered = runCacheFrame(frame, device, 1, cache, () => cache.prepare(source));
        await complete(backend);
        await rendered.submission.done;
        expect(externalCopy).toHaveBeenCalledTimes(6);
        expect(externalCopy.mock.calls.map(call => call[1].origin?.z)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(externalCopy.mock.calls.map(call => call[0].source)).toEqual(faces);

        externalCopy.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });
});

describe.each([
    ['immediate WebGL2', () => new FakeWebGLRHIBackend()],
    ['deferred WebGPU', () => new FakeWebGPURHIBackend()]
] as const)('TextureResourceCache shared Texture ABI on %s', (_name, createBackend) => {
    it('uploads and recovers released 3D R8 storage with independent slice row flips', async () => {
        const backend = createBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
            isImageCanRelease: true,
            target: TEXTURE_3D,
            internalFormat: R8,
            format: RED,
            type: UNSIGNED_BYTE,
            width: 2,
            height: 2,
            depth: 2,
            flipY: true,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        let handles: ReturnType<TextureResourceCache['prepare']> | undefined;
        let firstTexture: FakeRHITexture | undefined;
        let firstView: FakeRHITextureView | undefined;

        const initial = runCacheFrame(frame, firstDevice, 1, cache, () => {
            handles = cache.prepare(source);
            firstTexture = cache.resolveTexture(source) as FakeRHITexture;
            firstView = cache.resolveView(source) as FakeRHITextureView;
        });
        await complete(backend);
        await initial.submission.done;

        expect(firstTexture?.descriptor).toMatchObject({
            size: { width: 2, height: 2, depthOrArrayLayers: 2 },
            dimension: '3d',
            viewDimension: '3d',
            format: 'r8unorm'
        });
        expect(firstView?.descriptor).toMatchObject({
            dimension: '3d',
            baseArrayLayer: 0,
            arrayLayerCount: 1
        });
        expect(writeTexture.mock.calls[0]).toMatchObject([
            { origin: { x: 0, y: 0, z: 0 } },
            new Uint8Array([3, 4, 1, 2, 7, 8, 5, 6]),
            { bytesPerRow: 2, rowsPerImage: 2 },
            { width: 2, height: 2, depthOrArrayLayers: 2 }
        ]);
        expect(firstTexture?.snapshotLastWriteBytes()).toEqual(
            new Uint8Array([3, 4, 1, 2, 7, 8, 5, 6])
        );
        expect(source.isImageReleased).toBe(true);

        const secondDevice = backend.createDevice();
        cache.recover(secondDevice);
        let recoveredTexture: FakeRHITexture | undefined;
        const recovered = runCacheFrame(frame, secondDevice, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
            recoveredTexture = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await recovered.submission.done;

        expect(recoveredTexture).not.toBe(firstTexture);
        expect(recoveredTexture?.snapshotLastWriteBytes()).toEqual(
            new Uint8Array([3, 4, 1, 2, 7, 8, 5, 6])
        );
        expect(writeTexture).toHaveBeenCalledTimes(2);

        writeTexture.mockRestore();
        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('uploads and refreshes consecutive RG8UI 2D-array layers without handle churn', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: new Uint8Array([1, 2, 3, 4]),
            target: TEXTURE_2D_ARRAY,
            internalFormat: RG8UI,
            format: RG_INTEGER,
            type: UNSIGNED_BYTE,
            width: 1,
            height: 1,
            depth: 2,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        let handles: ReturnType<TextureResourceCache['prepare']> | undefined;
        let texture: FakeRHITexture | undefined;
        let view: FakeRHITextureView | undefined;

        const initial = runCacheFrame(frame, device, 1, cache, () => {
            handles = cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
            view = cache.resolveView(source) as FakeRHITextureView;
        });
        await complete(backend);
        await initial.submission.done;

        expect(texture?.descriptor).toMatchObject({
            size: { width: 1, height: 1, depthOrArrayLayers: 2 },
            dimension: '2d',
            viewDimension: '2d-array',
            format: 'rg8uint'
        });
        expect(view?.descriptor).toMatchObject({ dimension: '2d-array', arrayLayerCount: 2 });
        expect(writeTexture.mock.calls[0]?.[2]).toEqual({ bytesPerRow: 2, rowsPerImage: 1 });
        expect(writeTexture.mock.calls[0]?.[3]).toEqual({
            width: 1,
            height: 1,
            depthOrArrayLayers: 2
        });
        expect(texture?.snapshotLastWriteBytes()).toEqual(new Uint8Array([1, 2, 3, 4]));

        source.updateSubTexture({
            mipLevel: 0,
            layer: 1,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            depth: 1,
            image: new Uint8Array([9, 10])
        });
        const refreshed = runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
            expect(cache.resolveTexture(source)).toBe(texture);
        });
        await complete(backend);
        await refreshed.submission.done;
        expect(texture?.snapshotLastWriteBytes()).toEqual(new Uint8Array([1, 2, 9, 10]));

        writeTexture.mockRestore();
        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('preserves signed, integer RGB expansion, and portable raw depth layouts', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const signedR = new Texture({
            image: new Int8Array([-3]),
            internalFormat: R8I,
            format: RED_INTEGER,
            type: BYTE,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const signedRG = new Texture({
            image: new Int8Array([-2, 3]),
            internalFormat: RG8_SNORM,
            format: RG,
            type: BYTE,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const signedRGB = new Texture({
            image: new Int8Array([-1, 2, 3]),
            internalFormat: RGB8I,
            format: RGB_INTEGER,
            type: BYTE,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const depth16Pixels = new Uint16Array([0x1234]);
        const depth16 = new Texture({
            image: depth16Pixels,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_SHORT,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const depth32Pixels = new Float32Array([0.5]);
        const depth32 = new Texture({
            image: depth32Pixels,
            internalFormat: DEPTH_COMPONENT32F,
            format: DEPTH_COMPONENT,
            type: FLOAT,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        let resources: FakeRHITexture[] = [];

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            const sources = [signedR, signedRG, signedRGB, depth16, depth32];
            sources.forEach(source => cache.prepare(source));
            resources = sources.map(source => cache.resolveTexture(source) as FakeRHITexture);
        });
        await complete(backend);
        await rendered.submission.done;

        expect(resources.map(resource => resource.format)).toEqual([
            'r8sint',
            'rg8snorm',
            'rgba8sint',
            'depth16unorm',
            'depth32float'
        ]);
        expect(resources[0]?.snapshotLastWriteBytes()).toEqual(new Uint8Array([0xfd]));
        expect(resources[1]?.snapshotLastWriteBytes()).toEqual(new Uint8Array([0xfe, 3]));
        expect(resources[2]?.snapshotLastWriteBytes()).toEqual(new Uint8Array([0xff, 2, 3, 1]));
        expect(resources[3]?.snapshotLastWriteBytes()).toEqual(
            new Uint8Array(depth16Pixels.buffer)
        );
        expect(resources[4]?.snapshotLastWriteBytes()).toEqual(
            new Uint8Array(depth32Pixels.buffer)
        );
        expect(writeTexture.mock.calls.map(call => call[0].aspect)).toEqual([
            undefined,
            undefined,
            undefined,
            'depth-only',
            'depth-only'
        ]);

        writeTexture.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('maps empty opaque depth storage and rejects non-portable combined raw uploads pre-allocation', async () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const createTexture = vi.spyOn(device, 'createTexture');
        const rawCombined = new Texture<unknown>({
            image: null,
            internalFormat: DEPTH32F_STENCIL8,
            format: DEPTH_STENCIL,
            type: FLOAT_32_UNSIGNED_INT_24_8_REV,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        rawCombined.image = new Uint32Array([0x3f800000, 7]);

        expect(() =>
            runCacheFrame(frame, device, 1, cache, () => cache.prepare(rawCombined))
        ).toThrow(
            /only DEPTH_COMPONENT16 and DEPTH_COMPONENT32F support portable raw depth uploads/u
        );
        expect(createTexture).not.toHaveBeenCalled();

        const depth24 = new Texture({
            image: null,
            internalFormat: DEPTH_COMPONENT24,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_INT,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const depth24Stencil8 = new Texture({
            image: null,
            internalFormat: DEPTH24_STENCIL8,
            format: DEPTH_STENCIL,
            type: UNSIGNED_INT_24_8,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const depth32Stencil8 = new Texture({
            image: null,
            internalFormat: DEPTH32F_STENCIL8,
            format: DEPTH_STENCIL,
            type: FLOAT_32_UNSIGNED_INT_24_8_REV,
            width: 1,
            height: 1,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        let resources: FakeRHITexture[] = [];
        const rendered = runCacheFrame(frame, device, 2, cache, () => {
            const sources = [depth24, depth24Stencil8, depth32Stencil8];
            sources.forEach(source => cache.prepare(source));
            resources = sources.map(source => cache.resolveTexture(source) as FakeRHITexture);
        });
        await complete(backend);
        await rendered.submission.done;

        expect(resources.map(resource => resource.format)).toEqual([
            'depth24plus',
            'depth24plus-stencil8',
            'depth32float-stencil8'
        ]);
        expect(
            resources.every(resource => resource.snapshotLastWriteBytes().byteLength === 0)
        ).toBe(true);

        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });
});

describe('TextureResourceCache invalidation and lifecycle', () => {
    it('returns to idle when registry texture allocation fails during preparation', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        vi.spyOn(device, 'createTexture').mockImplementationOnce(() => {
            throw new Error('native texture allocation failure');
        });

        expect(() => runCacheFrame(frame, device, 1, cache, () => cache.prepare(source))).toThrow(
            'native texture allocation failure'
        );
        expect(cache.active).toBe(false);

        cache.destroy();
        backend.destroy();
    });

    it('rolls back a texture prepared during graph build and commits it on retry', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');

        expect(() =>
            frame.execute(frameContext(device, 1), scope => {
                cache.beginFrame(1, scope.uploads);
                cache.prepare(source);
                throw new Error('failure after texture graph build');
            })
        ).toThrow('failure after texture graph build');
        expect(beginFrame).not.toHaveBeenCalled();
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(source)).toBeNull();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        runCacheFrame(frame, device, 2, cache, () => cache.prepare(source));
        expect(cache.diagnostics(source)?.committedRevision).toBe(source.updateRevision);
        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('preserves the frame failure and returns idle when rollback cleanup also throws', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        const discardUnsubmitted = registry.discardUnsubmitted.bind(registry);
        const discard = vi.spyOn(registry, 'discardUnsubmitted').mockImplementationOnce(handle => {
            discardUnsubmitted(handle);
            throw new Error('injected texture rollback cleanup failure');
        });

        expect(() =>
            frame.execute(frameContext(device, 1), scope => {
                cache.beginFrame(1, scope.uploads);
                cache.prepare(source);
                throw new Error('original texture frame failure');
            })
        ).toThrow('original texture frame failure');
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(source)).toBeNull();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        discard.mockRestore();
        runCacheFrame(frame, device, 2, cache, () => cache.prepare(source));
        expect(cache.active).toBe(false);
        expect(cache.diagnostics(source)?.committedRevision).toBe(source.updateRevision);

        cache.destroy();
        registry.collect(2);
        frame.destroy();
        backend.destroy();
    });

    it('uses the authoritative sub-texture checkpoint for revision uploads', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1);
        let resource: FakeRHITexture | undefined;
        let handles: ReturnType<TextureResourceCache['getHandles']> | undefined;
        runCacheFrame(frame, device, 1, cache, () => {
            handles = cache.prepare(source);
            resource = cache.resolveTexture(source) as FakeRHITexture;
        });

        source.updateSubTexture({
            mipLevel: 0,
            x: 1,
            y: 0,
            width: 1,
            height: 1,
            image: new Uint8Array([9, 10, 11, 12])
        });
        runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
            expect(cache.resolveTexture(source)).toBe(resource);
        });
        expect([...(resource?.snapshotLastWriteBytes() ?? [])]).toEqual([
            1, 2, 3, 4, 9, 10, 11, 12
        ]);

        cache.destroy();
        registry.collect(2);
        backend.destroy();
    });

    it('replaces only the changed texture/view or sampler state and retires old resources', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        let firstTexture: FakeRHITexture | undefined;
        let firstView: FakeRHITextureView | undefined;
        let firstSampler: FakeRHISampler | undefined;
        runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            firstTexture = cache.resolveTexture(source) as FakeRHITexture;
            firstView = cache.resolveView(source) as FakeRHITextureView;
            firstSampler = cache.resolveSampler(source) as FakeRHISampler;
        });

        source.width = 2;
        source.image = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
        let resizedTexture: FakeRHITexture | undefined;
        let resizedView: FakeRHITextureView | undefined;
        runCacheFrame(frame, device, 2, cache, () => {
            cache.prepare(source);
            resizedTexture = cache.resolveTexture(source) as FakeRHITexture;
            resizedView = cache.resolveView(source) as FakeRHITextureView;
            expect(cache.resolveSampler(source)).toBe(firstSampler);
        });
        expect(resizedTexture).not.toBe(firstTexture);
        expect(resizedView).not.toBe(firstView);
        expect(cache.collect(0)).toBe(0);
        expect(cache.collect(1)).toBe(2);
        expect(firstTexture?.destroyed).toBe(true);
        expect(firstView?.destroyed).toBe(true);

        source.wrapS = CLAMP_TO_EDGE;
        let replacementSampler: FakeRHISampler | undefined;
        runCacheFrame(frame, device, 3, cache, () => {
            cache.prepare(source);
            expect(cache.resolveTexture(source)).toBe(resizedTexture);
            expect(cache.resolveView(source)).toBe(resizedView);
            replacementSampler = cache.resolveSampler(source) as FakeRHISampler;
        });
        expect(replacementSampler).not.toBe(firstSampler);
        expect(cache.collect(2)).toBe(1);
        expect(firstSampler?.destroyed).toBe(true);

        cache.destroy();
        registry.collect(3);
        backend.destroy();
    });

    it('rolls back staged resize resources and retries without changing committed handles', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        let committed: ReturnType<TextureResourceCache['getHandles']> | undefined;
        runCacheFrame(frame, device, 1, cache, () => {
            committed = cache.prepare(source);
        });
        const committedRevision = source.updateRevision;

        source.width = 2;
        source.image = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
        let failed: ReturnType<TextureResourceCache['getHandles']> | undefined;
        expect(() =>
            runCacheFrame(
                frame,
                device,
                2,
                cache,
                () => {
                    failed = cache.prepare(source);
                },
                'prepare'
            )
        ).toThrow('texture cache prepare failure');
        expect(failed).not.toBe(committed);
        expect(cache.getHandles(source)).toBe(committed);
        expect(cache.diagnostics(source)).toMatchObject({
            committedRevision,
            width: 1,
            height: 1
        });
        expect(cache.collect(2)).toBe(0);
        expect(registry.diagnostics().trackedResourceCount).toBe(3);

        let retried: ReturnType<TextureResourceCache['getHandles']> | undefined;
        runCacheFrame(frame, device, 3, cache, () => {
            retried = cache.prepare(source);
        });
        expect(retried).not.toBe(committed);
        expect(retried).not.toBe(failed);
        expect(cache.getHandles(source)).toBe(retried);

        cache.destroy();
        registry.collect(3);
        backend.destroy();
    });

    it('shares identical samplers while keeping source texture identities distinct', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const first = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        const second = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        runCacheFrame(frame, device, 1, cache, () => {
            const firstHandles = cache.prepare(first);
            const secondHandles = cache.prepare(second);
            expect(firstHandles.texture).not.toBe(secondHandles.texture);
            expect(firstHandles.view).not.toBe(secondHandles.view);
            expect(firstHandles.sampler).toBe(secondHandles.sampler);
        });

        const sharedSampler = cache.resolveSampler(first) as FakeRHISampler;
        expect(cache.detach(first)).toBe(true);
        cache.collect(1);
        expect(sharedSampler.destroyed).toBe(false);
        expect(cache.detach(second)).toBe(true);
        cache.collect(1);
        expect(sharedSampler.destroyed).toBe(true);
        expect(cache.detach(second)).toBe(false);

        cache.destroy();
        backend.destroy();
    });

    it('defers an active pending detach and lets a later same-frame use cancel it', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);

        runCacheFrame(frame, device, 1, cache, () => cache.prepare(source));
        const handles = cache.getHandles(source);

        runCacheFrame(frame, device, 2, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
            expect(cache.detach(source)).toBe(true);
            expect(cache.detach(source)).toBe(false);
            expect(cache.prepare(source)).toBe(handles);
        });
        expect(cache.getHandles(source)).toBe(handles);

        runCacheFrame(frame, device, 3, cache, () => {
            expect(cache.prepare(source)).toBe(handles);
            expect(cache.detach(source)).toBe(true);
        });
        expect(cache.diagnostics(source)).toBeNull();
        expect(cache.collect(3)).toBe(3);
        expect(cache.detach(source)).toBe(false);

        cache.destroy();
        frame.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('keeps deferred native texture release fenced until its submission completes', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = rgba8Texture(new Uint8Array([1, 2, 3, 4]), 1, 1);
        let texture: FakeRHITexture | undefined;
        const inFlight = runCacheFrame(frame, device, 5, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
        });
        expect(inFlight.submission.status).toBe('pending');
        expect(cache.detach(source)).toBe(true);
        expect(cache.collect(4)).toBe(0);
        expect(cache.collect(5)).toBe(3);
        expect(texture?.destroyed).toBe(true);
        expect(texture?.nativeReleased).toBe(false);
        backend.completeNextSubmission();
        await inFlight.submission.done;
        expect(texture?.nativeReleased).toBe(true);

        cache.destroy();
        backend.destroy();
    });

    it('supports a Uint8 DataTexture configured to the exact RGBA8 declaration', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new DataTexture({
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            data: new Uint8Array([1, 2, 3, 4])
        });
        let texture: FakeRHITexture | undefined;
        runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
        });
        expect(texture?.width).toBe(4);
        expect(texture?.height).toBe(4);
        expect(texture?.snapshotLastWriteBytes().slice(0, 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
        expect(texture?.snapshotLastWriteBytes()).toHaveLength(64);

        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });
});

describe('TextureResourceCache preflight rejection', () => {
    it('rejects unsupported variants before allocating any RHI object or opening the queue', () => {
        const backend = new FakeWebGLRHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const createTexture = vi.spyOn(device, 'createTexture');
        const createSampler = vi.spyOn(device, 'createSampler');
        const beginFrame = vi.spyOn(device.graphicsQueue, 'beginFrame');

        const unsupported: readonly Texture<unknown>[] = [
            new Texture({
                image: Array.from({ length: 5 }, () => new Uint8Array([1, 2, 3])),
                target: TEXTURE_CUBE_MAP,
                internalFormat: RGB8,
                format: RGB,
                type: UNSIGNED_BYTE,
                width: 1,
                height: 1
            }),
            new Texture({
                image: new Uint8Array([1, 2, 3, 4]),
                compressed: true,
                width: 1,
                height: 1
            }),
            new Texture({
                image: new Float32Array([1, 2, 3, 4]),
                internalFormat: RGBA8,
                format: RGBA,
                type: UNSIGNED_BYTE,
                width: 1,
                height: 1
            }),
            new Texture({
                image: new Uint8Array([1, 2, 3, 4]),
                internalFormat: RGBA8,
                format: RGBA,
                type: FLOAT,
                width: 1,
                height: 1
            }),
            new Texture({
                image: new Uint8Array([1, 2, 3, 4]),
                internalFormat: RGBA8,
                format: RGBA,
                type: UNSIGNED_BYTE,
                width: 1,
                height: 1,
                premultiplyAlpha: true
            }),
            new Texture({
                image: new Uint8Array([1, 2, 3, 4]),
                internalFormat: RGBA8,
                format: RGBA,
                type: UNSIGNED_BYTE,
                width: 1,
                height: 1,
                magFilter: LINEAR,
                minFilter: LINEAR,
                anisotropic: 4
            }),
            new Texture({
                image: new Uint8Array(32),
                compressed: true,
                internalFormat: COMPRESSED_RGB_PVRTC_4BPPV1_IMG,
                format: 0,
                type: 0,
                width: 4,
                height: 4,
                magFilter: NEAREST,
                minFilter: NEAREST
            })
        ];

        unsupported.forEach((source, index) => {
            expect(() =>
                runCacheFrame(frame, device, index, cache, () => cache.prepare(source))
            ).toThrow();
            expect(cache.active).toBe(false);
        });
        expect(createTexture).not.toHaveBeenCalled();
        expect(createSampler).not.toHaveBeenCalled();
        expect(beginFrame).not.toHaveBeenCalled();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        expect(() => runCacheFrame(frame, device, 20, cache, () => undefined, 'build')).toThrow(
            'texture cache build failure'
        );
        expect(cache.active).toBe(false);
        cache.destroy();
        backend.destroy();
    });

    it('rejects an external source without stable intrinsic dimensions before allocation', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const image = document.createElement('img');
        const source = new Texture({ image, width: 1, height: 1 });
        const createTexture = vi.spyOn(device, 'createTexture');

        expect(() => runCacheFrame(frame, device, 1, cache, () => cache.prepare(source))).toThrow(
            /does not expose stable positive intrinsic pixel dimensions/u
        );
        expect(createTexture).not.toHaveBeenCalled();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        cache.destroy();
        backend.destroy();
    });

    it('maps RGB8 external images into portable rgba8unorm storage', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const source = new Texture({
            image: canvas,
            internalFormat: RGB8,
            format: RGB,
            type: UNSIGNED_BYTE,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const externalCopy = vi.spyOn(RHIUploadBatch.prototype, 'copyExternalImageToTexture');
        let texture: FakeRHITexture | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await rendered.submission.done;

        expect(texture?.format).toBe('rgba8unorm');
        expect(externalCopy).toHaveBeenCalledWith(
            { source: canvas, flipY: false },
            expect.objectContaining({ texture }),
            { width: 1, height: 1, depthOrArrayLayers: 1 }
        );
        expect(device.graphicsQueue.state).toBe('idle');

        externalCopy.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('maps SRGB8_ALPHA8 external images into portable rgba8unorm-srgb storage', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const source = new Texture({
            image: canvas,
            internalFormat: SRGB8_ALPHA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const externalCopy = vi.spyOn(RHIUploadBatch.prototype, 'copyExternalImageToTexture');
        let texture: FakeRHITexture | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await rendered.submission.done;

        expect(texture?.format).toBe('rgba8unorm-srgb');
        expect(externalCopy).toHaveBeenCalledWith(
            { source: canvas, flipY: false },
            expect.objectContaining({ texture }),
            { width: 1, height: 1, depthOrArrayLayers: 1 }
        );

        externalCopy.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('rejects linear RGBA32F sampling when the format is not filterable', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        installCapabilities(device, {
            formats: {
                rgba32float: Object.freeze({
                    ...SAMPLED_FILTERABLE_FORMAT,
                    filterable: false
                })
            }
        });
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: new Float32Array([1, 2, 3, 4]),
            internalFormat: RGBA32F,
            format: RGBA,
            type: FLOAT,
            width: 1,
            height: 1,
            magFilter: LINEAR,
            minFilter: LINEAR
        });
        const createTexture = vi.spyOn(device, 'createTexture');

        expect(() => runCacheFrame(frame, device, 1, cache, () => cache.prepare(source))).toThrow(
            /cannot linearly filter rgba32float/u
        );
        expect(createTexture).not.toHaveBeenCalled();

        cache.destroy();
        backend.destroy();
    });

    it('rejects automatic generation for compressed and non-renderable color formats pre-frame', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        installCapabilities(device, {
            features: ['texture-compression-bc'],
            formats: {
                'bc1-rgba-unorm': SAMPLED_FILTERABLE_FORMAT,
                rgba8unorm: Object.freeze({
                    ...SAMPLED_FILTERABLE_FORMAT,
                    renderable: false
                })
            }
        });
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const createTexture = vi.spyOn(device, 'createTexture');
        const compressed = new Texture({
            image: new Uint8Array(8),
            compressed: true,
            internalFormat: COMPRESSED_RGBA_S3TC_DXT1_EXT,
            format: 0,
            type: 0,
            width: 4,
            height: 4,
            magFilter: NEAREST,
            minFilter: NEAREST_MIPMAP_NEAREST
        });
        expect(() =>
            runCacheFrame(frame, device, 1, cache, () => cache.prepare(compressed))
        ).toThrow(/require a complete explicit mipmap chain/u);

        const nonRenderable = new Texture({
            image: new Uint8Array(2 * 2 * 4),
            internalFormat: RGBA8,
            format: RGBA,
            type: UNSIGNED_BYTE,
            width: 2,
            height: 2,
            magFilter: NEAREST,
            minFilter: NEAREST_MIPMAP_NEAREST
        });
        expect(() =>
            runCacheFrame(frame, device, 2, cache, () => cache.prepare(nonRenderable))
        ).toThrow(/cannot automatically generate mipmaps for non-renderable rgba8unorm/u);
        expect(createTexture).not.toHaveBeenCalled();
        expect(device.graphicsQueue.state).toBe('idle');

        cache.destroy();
        backend.destroy();
    });
});

describe.each([
    ['immediate WebGL2', () => new FakeWebGLRHIBackend()],
    ['deferred WebGPU', () => new FakeWebGPURHIBackend()]
] as const)('TextureResourceCache compressed capability on %s', (_name, createBackend) => {
    it('rejects a mapped BC payload when the active device cannot sample it', () => {
        const backend = createBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: new Uint8Array(8),
            compressed: true,
            internalFormat: COMPRESSED_RGBA_S3TC_DXT1_EXT,
            format: 0,
            type: 0,
            width: 4,
            height: 4,
            magFilter: NEAREST,
            minFilter: NEAREST
        });
        const createTexture = vi.spyOn(device, 'createTexture');
        const createSampler = vi.spyOn(device, 'createSampler');

        expect(() => runCacheFrame(frame, device, 1, cache, () => cache.prepare(source))).toThrow(
            /Compressed RHI format bc1-rgba-unorm is unsupported/u
        );
        expect(createTexture).not.toHaveBeenCalled();
        expect(createSampler).not.toHaveBeenCalled();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        cache.destroy();
        backend.destroy();
    });
});

describe('TextureResourceCache compressed uploads', () => {
    it('uploads every level of a capability-enabled BC1 chain', async () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        installCapabilities(device, {
            features: ['texture-compression-bc'],
            formats: { 'bc1-rgba-unorm': SAMPLED_FILTERABLE_FORMAT }
        });
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const mipmaps = [
            { data: new Uint8Array(8).fill(1), width: 4, height: 4 },
            { data: new Uint8Array(8).fill(2), width: 2, height: 2 },
            { data: new Uint8Array(8).fill(3), width: 1, height: 1 }
        ];
        const source = new Texture({
            image: null,
            compressed: true,
            internalFormat: COMPRESSED_RGBA_S3TC_DXT1_EXT,
            format: 0,
            type: 0,
            width: 4,
            height: 4,
            magFilter: NEAREST,
            minFilter: NEAREST_MIPMAP_NEAREST,
            mipmaps
        });
        const writeTexture = vi.spyOn(RHIUploadBatch.prototype, 'writeTexture');
        let texture: FakeRHITexture | undefined;

        const rendered = runCacheFrame(frame, device, 1, cache, () => {
            cache.prepare(source);
            texture = cache.resolveTexture(source) as FakeRHITexture;
        });
        await complete(backend);
        await rendered.submission.done;

        expect(texture?.descriptor).toMatchObject({
            format: 'bc1-rgba-unorm',
            mipLevelCount: 3
        });
        expect(writeTexture).toHaveBeenCalledTimes(3);
        expect(writeTexture.mock.calls.map(call => call[2])).toEqual([
            { bytesPerRow: 8, rowsPerImage: 1 },
            { bytesPerRow: 8, rowsPerImage: 1 },
            { bytesPerRow: 8, rowsPerImage: 1 }
        ]);
        expect([...(texture?.snapshotLastWriteBytes() ?? [])]).toEqual(new Array(8).fill(3));

        writeTexture.mockRestore();
        cache.destroy();
        registry.collect(1);
        backend.destroy();
    });

    it('validates every compressed mip payload before allocating texture or sampler', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        installCapabilities(device, {
            features: ['texture-compression-bc'],
            formats: { 'bc1-rgba-unorm': SAMPLED_FILTERABLE_FORMAT }
        });
        const registry = new ResourceRegistry(device);
        const cache = new TextureResourceCache(registry);
        const frame = new RenderFrame();
        const source = new Texture({
            image: null,
            compressed: true,
            internalFormat: COMPRESSED_RGBA_S3TC_DXT1_EXT,
            format: 0,
            type: 0,
            width: 2,
            height: 2,
            magFilter: NEAREST,
            minFilter: NEAREST_MIPMAP_NEAREST,
            mipmaps: [
                { data: new Uint8Array(8), width: 2, height: 2 },
                { data: new Uint8Array(7), width: 1, height: 1 }
            ]
        });
        const createTexture = vi.spyOn(device, 'createTexture');
        const createSampler = vi.spyOn(device, 'createSampler');

        expect(() => runCacheFrame(frame, device, 1, cache, () => cache.prepare(source))).toThrow(
            /contains 7 bytes; 8 are required/u
        );
        expect(createTexture).not.toHaveBeenCalled();
        expect(createSampler).not.toHaveBeenCalled();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        cache.destroy();
        backend.destroy();
    });
});
