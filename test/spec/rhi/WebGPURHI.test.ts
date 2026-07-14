import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    RHIBufferUsage,
    RHIShaderStage,
    RHITextureUsage,
    type RHIFeatureName
} from '../../../src/rhi/RHI';
import { WebGPUDevice, createWebGPURHI, type WebGPURHI } from '../../../src/rhi/webgpu/WebGPURHI';
import { createFakeWebGPU, type FakeWebGPU } from './FakeWebGPU';
import { describeRHIContract } from './RHIContract';

interface ReadyWebGPU {
    readonly fake: FakeWebGPU;
    readonly rhi: WebGPURHI;
}

const activeRhis: WebGPURHI[] = [];
const activeCapabilityDevices: WebGPUDevice[] = [];

function createCapabilityDevice(
    options: {
        readonly features?: readonly GPUFeatureName[];
        readonly limits?: Readonly<Record<string, number>>;
    } = {}
): WebGPUDevice {
    const fake = createFakeWebGPU();
    const nativeLimits = Object.create(fake.device.limits) as GPUSupportedLimits;
    for (const [name, value] of Object.entries(options.limits ?? {})) {
        Object.defineProperty(nativeLimits, name, { value });
    }
    const nativeDevice = Object.create(fake.device) as GPUDevice;
    Object.defineProperties(nativeDevice, {
        features: { value: new Set(options.features ?? []) },
        limits: { value: nativeLimits }
    });
    const device = new WebGPUDevice(fake.adapter, nativeDevice);
    activeCapabilityDevices.push(device);
    return device;
}

function overrideFakeNativeLimits(
    fake: FakeWebGPU,
    overrides: Readonly<Record<string, number>>
): void {
    const nativeLimits = Object.create(fake.adapter.limits) as GPUSupportedLimits;
    for (const [name, value] of Object.entries(overrides)) {
        Object.defineProperty(nativeLimits, name, { value });
    }
    Object.defineProperty(fake.adapter, 'limits', { value: nativeLimits });
    Object.defineProperty(fake.device, 'limits', { value: nativeLimits });
}

async function createReadyWebGPU(
    options: Partial<{
        readonly width: number;
        readonly height: number;
        readonly powerPreference: GPUPowerPreference;
        readonly alpha: boolean;
        readonly antialias: boolean;
        readonly requiredFeatures: readonly RHIFeatureName[];
        readonly diagnostics: boolean;
    }> = {}
): Promise<ReadyWebGPU> {
    const fake = createFakeWebGPU(options.requiredFeatures ?? []);
    const rhi = await createWebGPURHI({
        canvas: fake.canvas,
        width: options.width ?? 16,
        height: options.height ?? 8,
        ...(options.powerPreference === undefined
            ? {}
            : { powerPreference: options.powerPreference }),
        ...(options.alpha === undefined ? {} : { alpha: options.alpha }),
        ...(options.antialias === undefined ? {} : { antialias: options.antialias }),
        ...(options.requiredFeatures === undefined
            ? {}
            : { requiredFeatures: options.requiredFeatures }),
        ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics })
    });
    activeRhis.push(rhi);
    return { fake, rhi };
}

afterEach(() => {
    for (const rhi of activeRhis.splice(0)) rhi.destroy();
    for (const device of activeCapabilityDevices.splice(0)) device.destroy();
    vi.unstubAllGlobals();
});

describeRHIContract('WebGPU', 'webgpu', async () => {
    const ready = await createReadyWebGPU({ diagnostics: true });
    return {
        rhi: ready.rhi,
        backend: 'webgpu',
        getSubmissionCount: () => ready.fake.submit.mock.calls.length
    };
});

describe('WebGPU texture format capabilities', () => {
    it('reports conservative compatibility-level render and storage capabilities', () => {
        const device = createCapabilityDevice();

        expect(device.getTextureFormatCapabilities('rgba8unorm')).toEqual({
            sampled: true,
            filterable: true,
            renderable: true,
            storage: true,
            sampleCounts: [1, 4]
        });
        expect(device.getTextureFormatCapabilities('r8uint')).toMatchObject({
            sampled: true,
            filterable: false,
            renderable: true,
            storage: false,
            sampleCounts: [1]
        });
        expect(device.getTextureFormatCapabilities('rgba16float')).toMatchObject({
            renderable: true,
            storage: true,
            sampleCounts: [1]
        });
        expect(device.getTextureFormatCapabilities('rg32float')).toMatchObject({
            sampled: true,
            filterable: false,
            renderable: true,
            storage: false,
            sampleCounts: [1]
        });
        expect(device.getTextureFormatCapabilities('rgba8snorm')).toMatchObject({
            sampled: true,
            filterable: true,
            renderable: false,
            storage: true,
            sampleCounts: []
        });
    });

    it('does not infer packed, core-only, or optional depth support from format spelling', () => {
        const device = createCapabilityDevice();

        expect(device.getTextureFormatCapabilities('rgb9e5ufloat')).toEqual({
            sampled: true,
            filterable: true,
            renderable: false,
            storage: false,
            sampleCounts: []
        });
        expect(device.getTextureFormatCapabilities('rg11b10ufloat')).toEqual({
            sampled: true,
            filterable: true,
            renderable: false,
            storage: false,
            sampleCounts: []
        });
        expect(device.getTextureFormatCapabilities('bgra8unorm-srgb')).toEqual({
            sampled: false,
            filterable: false,
            renderable: false,
            storage: false,
            sampleCounts: []
        });
        expect(device.getTextureFormatCapabilities('depth32float-stencil8')).toEqual({
            sampled: false,
            filterable: false,
            renderable: false,
            storage: false,
            sampleCounts: []
        });
    });

    it('enables only the capabilities unlocked by core and texture tier features', () => {
        const coreDevice = createCapabilityDevice({ features: ['core-features-and-limits'] });
        expect(coreDevice.getTextureFormatCapabilities('r8uint').sampleCounts).toEqual([1, 4]);
        expect(coreDevice.getTextureFormatCapabilities('rgba16float').sampleCounts).toEqual([1, 4]);
        expect(coreDevice.getTextureFormatCapabilities('rg32float').storage).toBe(true);
        expect(coreDevice.getTextureFormatCapabilities('bgra8unorm-srgb')).toMatchObject({
            sampled: true,
            filterable: true,
            renderable: true,
            storage: false,
            sampleCounts: [1, 4]
        });

        const tier1Device = createCapabilityDevice({ features: ['texture-formats-tier1'] });
        expect(tier1Device.getTextureFormatCapabilities('r8unorm').storage).toBe(true);
        expect(tier1Device.getTextureFormatCapabilities('rgba8snorm')).toMatchObject({
            renderable: true,
            storage: true,
            sampleCounts: [1, 4]
        });
        expect(tier1Device.getTextureFormatCapabilities('rg11b10ufloat')).toMatchObject({
            renderable: true,
            storage: true,
            sampleCounts: [1, 4]
        });
    });

    it('keeps independent native feature gates and the portable storage gate intact', () => {
        const rg11Device = createCapabilityDevice({
            features: ['rg11b10ufloat-renderable']
        });
        expect(rg11Device.getTextureFormatCapabilities('rg11b10ufloat')).toMatchObject({
            renderable: true,
            storage: false,
            sampleCounts: [1, 4]
        });

        const depthDevice = createCapabilityDevice({ features: ['depth32float-stencil8'] });
        expect(depthDevice.getTextureFormatCapabilities('depth32float-stencil8')).toEqual({
            sampled: true,
            filterable: false,
            renderable: true,
            storage: false,
            sampleCounts: [1, 4]
        });

        const noStorageDevice = createCapabilityDevice({
            features: ['texture-formats-tier1'],
            limits: { maxStorageTexturesPerShaderStage: 0 }
        });
        expect(noStorageDevice.features.has('storage-textures')).toBe(false);
        expect(noStorageDevice.getTextureFormatCapabilities('r8unorm').storage).toBe(false);

        const bgraStorageDevice = createCapabilityDevice({ features: ['bgra8unorm-storage'] });
        expect(bgraStorageDevice.getTextureFormatCapabilities('bgra8unorm').storage).toBe(true);
    });

    it('does not expose compute-only storage limits through the render-only RHI', () => {
        const computeOnlyDevice = createCapabilityDevice({
            features: ['texture-formats-tier1'],
            limits: {
                maxStorageBuffersPerShaderStage: 8,
                maxStorageBuffersInVertexStage: 0,
                maxStorageBuffersInFragmentStage: 0,
                maxStorageTexturesPerShaderStage: 4,
                maxStorageTexturesInVertexStage: 0,
                maxStorageTexturesInFragmentStage: 0
            }
        });

        expect(computeOnlyDevice.limits.maxStorageBuffersPerShaderStage).toBe(0);
        expect(computeOnlyDevice.limits.maxStorageTexturesPerShaderStage).toBe(0);
        expect(computeOnlyDevice.limits.maxStorageBufferBindingSize).toBe(0);
        expect(computeOnlyDevice.limits.minStorageBufferOffsetAlignment).toBe(0);
        expect(computeOnlyDevice.features.has('storage-buffers')).toBe(false);
        expect(computeOnlyDevice.features.has('storage-textures')).toBe(false);
        expect(computeOnlyDevice.getTextureFormatCapabilities('r8unorm').storage).toBe(false);

        const asymmetricDevice = createCapabilityDevice({
            limits: {
                maxStorageBuffersPerShaderStage: 8,
                maxStorageBuffersInVertexStage: 2,
                maxStorageBuffersInFragmentStage: 6,
                maxStorageTexturesPerShaderStage: 4,
                maxStorageTexturesInVertexStage: 1,
                maxStorageTexturesInFragmentStage: 3
            }
        });
        expect(asymmetricDevice.limits.maxStorageBuffersPerShaderStage).toBe(2);
        expect(asymmetricDevice.limits.maxStorageTexturesPerShaderStage).toBe(1);
    });

    it('gates filtering and compressed formats by their exact native features', () => {
        const device = createCapabilityDevice({
            features: ['float32-filterable', 'texture-compression-bc']
        });
        expect(device.getTextureFormatCapabilities('r32float').filterable).toBe(true);
        expect(device.getTextureFormatCapabilities('rg32float').filterable).toBe(true);
        expect(device.getTextureFormatCapabilities('rgba32float').filterable).toBe(true);
        expect(device.getTextureFormatCapabilities('bc1-rgba-unorm')).toEqual({
            sampled: true,
            filterable: true,
            renderable: false,
            storage: false,
            sampleCounts: []
        });
        expect(device.getTextureFormatCapabilities('etc2-rgb8unorm').sampled).toBe(false);
    });
});

describe('WebGPURHI native mapping', () => {
    it('rejects unknown required-limit keys instead of silently dropping them', async () => {
        const fake = createFakeWebGPU();
        await expect(
            createWebGPURHI({
                canvas: fake.canvas,
                width: 1,
                height: 1,
                requiredLimits: { rendererOnlyLimit: 1 } as never
            })
        ).rejects.toThrow(/Unknown portable WebGPU required limit rendererOnlyLimit/u);
        expect(fake.requestDevice).not.toHaveBeenCalled();
    });

    it('rejects compute-only storage features and portable storage limits', async () => {
        const bufferFake = createFakeWebGPU();
        overrideFakeNativeLimits(bufferFake, {
            maxStorageBuffersPerShaderStage: 8,
            maxStorageBuffersInVertexStage: 0,
            maxStorageBuffersInFragmentStage: 0
        });
        await expect(
            createWebGPURHI({
                canvas: bufferFake.canvas,
                width: 1,
                height: 1,
                requiredFeatures: ['storage-buffers']
            })
        ).rejects.toThrow(/required feature storage-buffers/u);
        expect(bufferFake.requestDevice).not.toHaveBeenCalled();

        const textureFake = createFakeWebGPU();
        overrideFakeNativeLimits(textureFake, {
            maxStorageTexturesPerShaderStage: 4,
            maxStorageTexturesInVertexStage: 0,
            maxStorageTexturesInFragmentStage: 0
        });
        await expect(
            createWebGPURHI({
                canvas: textureFake.canvas,
                width: 1,
                height: 1,
                requiredLimits: { maxStorageTexturesPerShaderStage: 1 }
            })
        ).rejects.toThrow(/maxStorageTexturesPerShaderStage/u);
        expect(textureFake.requestDevice).not.toHaveBeenCalled();
    });

    it('requests modern vertex and fragment storage limits for the portable contract', async () => {
        const fake = createFakeWebGPU();
        overrideFakeNativeLimits(fake, {
            maxStorageBuffersPerShaderStage: 8,
            maxStorageBuffersInVertexStage: 2,
            maxStorageBuffersInFragmentStage: 6,
            maxStorageTexturesPerShaderStage: 4,
            maxStorageTexturesInVertexStage: 1,
            maxStorageTexturesInFragmentStage: 3
        });
        const rhi = await createWebGPURHI({
            canvas: fake.canvas,
            width: 1,
            height: 1,
            requiredFeatures: ['storage-textures'],
            requiredLimits: { maxStorageBuffersPerShaderStage: 2 }
        });
        activeRhis.push(rhi);

        expect(fake.requestDevice).toHaveBeenCalledWith({
            requiredLimits: {
                maxStorageBuffersPerShaderStage: 2,
                maxStorageBuffersInVertexStage: 2,
                maxStorageBuffersInFragmentStage: 2,
                maxStorageTexturesPerShaderStage: 1,
                maxStorageTexturesInVertexStage: 1,
                maxStorageTexturesInFragmentStage: 1
            }
        });
    });

    it('maps adapter, device, and surface initialization options once', async () => {
        const { fake, rhi } = await createReadyWebGPU({
            width: 40,
            height: 20,
            powerPreference: 'high-performance',
            alpha: false,
            antialias: true,
            requiredFeatures: ['texture-compression-bc']
        });

        expect(fake.requestAdapter).toHaveBeenCalledOnce();
        expect(fake.requestAdapter).toHaveBeenCalledWith({
            powerPreference: 'high-performance'
        });
        expect(fake.requestDevice).toHaveBeenCalledOnce();
        expect(fake.requestDevice).toHaveBeenCalledWith({
            requiredFeatures: ['texture-compression-bc']
        });
        expect(fake.configure).toHaveBeenCalledOnce();
        expect(fake.configure).toHaveBeenCalledWith(
            expect.objectContaining({
                device: fake.device,
                format: 'bgra8unorm',
                alphaMode: 'opaque'
            })
        );
        expect(fake.canvas.width).toBe(40);
        expect(fake.canvas.height).toBe(20);
        expect(rhi.surface).toMatchObject({
            backend: 'webgpu',
            width: 40,
            height: 20,
            format: 'bgra8unorm'
        });
    });

    it('unwraps resource descriptors and bindings without hidden duplicate creation', async () => {
        const { fake, rhi } = await createReadyWebGPU({ diagnostics: true });
        const { device } = rhi;
        const buffer = device.createBuffer({
            label: 'native uniform',
            size: 64,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.UNIFORM
        });
        const texture = device.createTexture({
            label: 'native texture',
            size: { width: 8, height: 4, depthOrArrayLayers: 2 },
            mipLevelCount: 3,
            dimension: '2d',
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING,
            viewFormats: ['rgba8unorm-srgb']
        });
        const view = texture.createView({
            label: 'native view',
            format: 'rgba8unorm-srgb',
            dimension: '2d-array',
            baseMipLevel: 1,
            mipLevelCount: 2,
            arrayLayerCount: 2
        });
        const sampler = device.createSampler({
            label: 'native sampler',
            minFilter: 'linear',
            magFilter: 'linear'
        });
        const layout = device.createBindGroupLayout({
            label: 'native layout',
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'uniform', minBindingSize: 64 }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: { sampleType: 'float', viewDimension: '2d-array' }
                },
                {
                    binding: 2,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: { type: 'filtering' }
                }
            ]
        });
        const bindGroup = device.createBindGroup({
            label: 'native group',
            layout,
            entries: [
                { binding: 0, resource: { buffer, offset: 16, size: 32 } },
                { binding: 1, resource: view },
                { binding: 2, resource: sampler }
            ]
        });

        expect(fake.createBuffer).toHaveBeenCalledOnce();
        expect(fake.createBuffer).toHaveBeenCalledWith({
            label: 'native uniform',
            size: 64,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.UNIFORM
        });
        expect(fake.createTexture).toHaveBeenCalledOnce();
        expect(fake.createTexture).toHaveBeenCalledWith({
            label: 'native texture',
            size: { width: 8, height: 4, depthOrArrayLayers: 2 },
            mipLevelCount: 3,
            dimension: '2d',
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING,
            viewFormats: ['rgba8unorm-srgb']
        });
        expect(fake.textureRecords[0]?.createView).toHaveBeenCalledOnce();
        expect(fake.textureRecords[0]?.createView).toHaveBeenCalledWith({
            label: 'native view',
            format: 'rgba8unorm-srgb',
            dimension: '2d-array',
            baseMipLevel: 1,
            mipLevelCount: 2,
            arrayLayerCount: 2
        });
        expect(fake.createSampler).toHaveBeenCalledOnce();
        expect(fake.createSampler).toHaveBeenCalledWith({
            label: 'native sampler',
            minFilter: 'linear',
            magFilter: 'linear'
        });
        expect(fake.createBindGroupLayout).toHaveBeenCalledOnce();
        expect(fake.createBindGroup).toHaveBeenCalledOnce();

        const nativeBuffer = fake.bufferRecords[0]?.buffer;
        const nativeView = fake.textureRecords[0]?.views[0];
        const nativeSampler = fake.createSampler.mock.results[0]?.value as GPUSampler;
        const nativeLayout = fake.createBindGroupLayout.mock.results[0]
            ?.value as GPUBindGroupLayout;
        expect(fake.createBindGroup).toHaveBeenCalledWith({
            label: 'native group',
            layout: nativeLayout,
            entries: [
                { binding: 0, resource: { buffer: nativeBuffer, offset: 16, size: 32 } },
                { binding: 1, resource: nativeView },
                { binding: 2, resource: nativeSampler }
            ]
        });

        expect(() => {
            void buffer.size;
            void texture.width;
            void view.dimension;
            void sampler.descriptor;
            void bindGroup.entries;
        }).not.toThrow();
        expect(fake.createBuffer).toHaveBeenCalledOnce();
        expect(fake.createTexture).toHaveBeenCalledOnce();
        expect(fake.createSampler).toHaveBeenCalledOnce();
        expect(fake.createBindGroupLayout).toHaveBeenCalledOnce();
        expect(fake.createBindGroup).toHaveBeenCalledOnce();
    });

    it('snapshots bind-group entry arrays and buffer-binding records', async () => {
        const { rhi } = await createReadyWebGPU();
        const buffer = rhi.device.createBuffer({
            size: 32,
            usage: RHIBufferUsage.UNIFORM
        });
        const layout = rhi.device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'uniform' }
                }
            ]
        });
        const binding = { buffer, offset: 0, size: 16 };
        const entries = [{ binding: 0, resource: binding }];
        const bindGroup = rhi.device.createBindGroup({ layout, entries });

        binding.offset = 8;
        entries.length = 0;

        expect(bindGroup.entries).toHaveLength(1);
        expect(bindGroup.entries[0]?.resource).toMatchObject({ buffer, offset: 0, size: 16 });
        expect(Object.isFrozen(bindGroup.entries)).toBe(true);
        expect(Object.isFrozen(bindGroup.entries[0]?.resource)).toBe(true);
    });

    it('keeps immutable-state cache hits from creating a second native resource', async () => {
        const { fake, rhi } = await createReadyWebGPU({ diagnostics: true });
        const { device } = rhi;
        const samplerDescriptor = { minFilter: 'linear' as const, magFilter: 'linear' as const };
        expect(device.createSampler(samplerDescriptor)).toBe(
            device.createSampler(samplerDescriptor)
        );

        const layoutDescriptor = {
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'uniform' as const }
                }
            ]
        };
        const layout = device.createBindGroupLayout(layoutDescriptor);
        expect(device.createBindGroupLayout(layoutDescriptor)).toBe(layout);
        const pipelineLayoutDescriptor = { bindGroupLayouts: [layout] };
        const pipelineLayout = device.createPipelineLayout(pipelineLayoutDescriptor);
        expect(device.createPipelineLayout(pipelineLayoutDescriptor)).toBe(pipelineLayout);

        const vertex = device.createShaderModule({
            code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
            language: 'wgsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }',
            language: 'wgsl',
            stage: 'fragment'
        });
        const pipelineDescriptor = {
            layout: pipelineLayout,
            vertex: { module: vertex },
            fragment: { module: fragment, targets: [{ format: 'rgba8unorm' as const }] }
        };
        expect(device.createRenderPipeline(pipelineDescriptor)).toBe(
            device.createRenderPipeline(pipelineDescriptor)
        );

        expect(fake.createSampler).toHaveBeenCalledOnce();
        expect(fake.createBindGroupLayout).toHaveBeenCalledOnce();
        expect(fake.createPipelineLayout).toHaveBeenCalledOnce();
        expect(fake.createRenderPipeline).toHaveBeenCalledOnce();
        expect(rhi.diagnostics?.snapshot()).toMatchObject({
            samplerCreations: 1,
            samplerCacheHits: 1,
            bindGroupLayoutCreations: 1,
            bindGroupLayoutCacheHits: 1,
            pipelineLayoutCreations: 1,
            pipelineLayoutCacheHits: 1,
            renderPipelineCreations: 1,
            renderPipelineCacheHits: 1
        });
    });

    it('forwards every encoded command once and never replays it during finish or submit', async () => {
        const { fake, rhi } = await createReadyWebGPU({ diagnostics: true });
        const { device } = rhi;
        const source = device.createBuffer({
            size: 64,
            usage: RHIBufferUsage.COPY_SRC | RHIBufferUsage.VERTEX
        });
        const destination = device.createBuffer({
            size: 64,
            usage:
                RHIBufferUsage.COPY_DST |
                RHIBufferUsage.COPY_SRC |
                RHIBufferUsage.INDEX |
                RHIBufferUsage.UNIFORM
        });
        const color = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage:
                RHITextureUsage.COPY_SRC |
                RHITextureUsage.COPY_DST |
                RHITextureUsage.RENDER_ATTACHMENT
        });
        const copied = device.createTexture({
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST
        });
        const layout = device.createBindGroupLayout({ entries: [] });
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const bindGroup = device.createBindGroup({ layout, entries: [] });
        const vertex = device.createShaderModule({
            code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
            language: 'wgsl',
            stage: 'vertex'
        });
        const fragment = device.createShaderModule({
            code: '@fragment fn main() -> @location(0) vec4f { return vec4f(1.0); }',
            language: 'wgsl',
            stage: 'fragment'
        });
        const pipeline = device.createRenderPipeline({
            layout: pipelineLayout,
            vertex: { module: vertex },
            fragment: { module: fragment, targets: [{ format: 'rgba8unorm' }] }
        });
        const encoder = device.createCommandEncoder({ label: 'native command encoder' });
        encoder.copyBufferToBuffer(source, 4, destination, 8, 16);
        encoder.copyTextureToBuffer(
            { texture: color, mipLevel: 0, origin: { x: 1, y: 0, z: 0 } },
            { buffer: destination, offset: 0, bytesPerRow: 256, rowsPerImage: 4 },
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        encoder.copyBufferToTexture(
            { buffer: source, offset: 0, bytesPerRow: 256, rowsPerImage: 4 },
            { texture: copied, mipLevel: 0 },
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        encoder.copyTextureToTexture(
            { texture: color },
            { texture: copied },
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        const pass = encoder.beginRenderPass({
            label: 'native pass',
            colorAttachments: [
                {
                    view: color.createView(),
                    clearValue: { r: 0, g: 0.25, b: 0.5, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup, [16]);
        pass.setVertexBuffer(0, source, 4, 32);
        pass.setIndexBuffer(destination, 'uint16', 8, 16);
        pass.setViewport(0, 0, 4, 4, 0, 1);
        pass.setScissorRect(0, 0, 4, 4);
        pass.setBlendConstant({ r: 1, g: 0.5, b: 0.25, a: 1 });
        pass.setStencilReference(7);
        pass.draw(3, 2, 1, 4);
        pass.drawIndexed(6, 2, 1, -1, 4);
        pass.end();

        const encoderRecord = fake.commandEncoderRecords[0];
        const passRecord = encoderRecord?.passes[0];
        expect(encoderRecord?.copyBufferToBuffer).toHaveBeenCalledOnce();
        expect(encoderRecord?.copyTextureToBuffer).toHaveBeenCalledOnce();
        expect(encoderRecord?.copyBufferToTexture).toHaveBeenCalledOnce();
        expect(encoderRecord?.copyBufferToTexture).toHaveBeenCalledWith(
            {
                buffer: fake.bufferRecords[0]?.buffer,
                offset: 0,
                bytesPerRow: 256,
                rowsPerImage: 4
            },
            {
                texture: fake.textureRecords[1]?.texture,
                mipLevel: 0
            },
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        );
        expect(encoderRecord?.copyTextureToTexture).toHaveBeenCalledOnce();
        expect(encoderRecord?.beginRenderPass).toHaveBeenCalledOnce();
        expect(passRecord?.setPipeline).toHaveBeenCalledOnce();
        expect(passRecord?.setBindGroup).toHaveBeenCalledOnce();
        expect(passRecord?.setVertexBuffer).toHaveBeenCalledOnce();
        expect(passRecord?.setIndexBuffer).toHaveBeenCalledOnce();
        expect(passRecord?.setViewport).toHaveBeenCalledOnce();
        expect(passRecord?.setScissorRect).toHaveBeenCalledOnce();
        expect(passRecord?.setBlendConstant).toHaveBeenCalledOnce();
        expect(passRecord?.setStencilReference).toHaveBeenCalledOnce();
        expect(passRecord?.draw).toHaveBeenCalledOnce();
        expect(passRecord?.drawIndexed).toHaveBeenCalledOnce();
        expect(passRecord?.end).toHaveBeenCalledOnce();

        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);
        expect(encoderRecord?.finish).toHaveBeenCalledOnce();
        expect(fake.submit).toHaveBeenCalledOnce();
        expect(passRecord?.draw).toHaveBeenCalledOnce();
        expect(passRecord?.drawIndexed).toHaveBeenCalledOnce();
        expect(encoderRecord?.copyBufferToBuffer).toHaveBeenCalledOnce();
        expect(encoderRecord?.copyBufferToTexture).toHaveBeenCalledOnce();
    });

    it('reuses and clears the native submit scratch after validation and native failures', async () => {
        const { fake, rhi } = await createReadyWebGPU();
        const commandBuffer = rhi.device.createCommandEncoder().finish();

        expect(() => {
            rhi.device.queue.submit([{} as never]);
        }).toThrow(/Expected a WebGPU command buffer/u);
        expect(fake.submit).not.toHaveBeenCalled();

        let failedSubmission: readonly GPUCommandBuffer[] | undefined;
        fake.submit.mockImplementationOnce((buffers: readonly GPUCommandBuffer[]) => {
            failedSubmission = buffers;
            throw new Error('native submit failed');
        });
        expect(() => {
            rhi.device.queue.submit([commandBuffer]);
        }).toThrow(/native submit failed/u);
        expect(failedSubmission).toHaveLength(0);

        fake.submit.mockImplementationOnce((buffers: readonly GPUCommandBuffer[]) => {
            expect(buffers).toHaveLength(1);
        });
        expect(() => {
            rhi.device.queue.submit([commandBuffer]);
        }).not.toThrow();
    });

    it('preserves native BufferSource units and typed-view identity for queue writes', async () => {
        const { fake, rhi } = await createReadyWebGPU();
        const buffer = rhi.device.createBuffer({
            size: 64,
            usage: RHIBufferUsage.COPY_DST
        });
        const texture = rhi.device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST
        });
        const wordBacking = new ArrayBuffer(24);
        const words = new Uint16Array(wordBacking, 4, 6);
        words.set([0x0102, 0x0304, 0x0506, 0x0708]);
        const floatBacking = new ArrayBuffer(32);
        const floats = new Float32Array(floatBacking, 8, 4);
        floats.set([1, 2, 3, 4]);
        const viewBacking = new ArrayBuffer(20);
        const view = new DataView(viewBacking, 4, 12);
        const bytes = new Uint8Array(16);
        rhi.device.queue.writeBuffer(buffer, 4, words, 1, 2);
        rhi.device.queue.writeBuffer(buffer, 8, floats, 1, 2);
        rhi.device.queue.writeBuffer(buffer, 16, floats, 2);
        rhi.device.queue.writeBuffer(buffer, 24, view, 2, 4);
        rhi.device.queue.writeTexture(
            { texture, origin: { x: 1, y: 0 } },
            bytes,
            { offset: 0, bytesPerRow: 256, rowsPerImage: 2 },
            { width: 2, height: 2 }
        );
        await rhi.device.queue.onSubmittedWorkDone();

        expect(fake.writeBuffer).toHaveBeenCalledTimes(4);
        expect(fake.writeBuffer.mock.calls[0]).toEqual([
            fake.bufferRecords[0]?.buffer,
            4,
            words,
            1,
            2
        ]);
        expect(fake.writeBuffer.mock.calls[1]).toEqual([
            fake.bufferRecords[0]?.buffer,
            8,
            floats,
            1,
            2
        ]);
        expect(fake.writeBuffer.mock.calls[2]).toEqual([
            fake.bufferRecords[0]?.buffer,
            16,
            floats,
            2,
            undefined
        ]);
        expect(fake.writeBuffer.mock.calls[3]).toEqual([
            fake.bufferRecords[0]?.buffer,
            24,
            view,
            2,
            4
        ]);
        expect(words.byteOffset).toBe(4);
        expect(floats.byteOffset).toBe(8);
        expect(view.byteOffset).toBe(4);
        expect(fake.writeTexture).toHaveBeenCalledWith(
            {
                texture: fake.textureRecords[0]?.texture,
                origin: { x: 1, y: 0 }
            },
            bytes,
            { offset: 0, bytesPerRow: 256, rowsPerImage: 2 },
            { width: 2, height: 2 }
        );
        expect(fake.onSubmittedWorkDone).toHaveBeenCalledOnce();
    });

    it('forwards resource and device destruction exactly once', async () => {
        const { fake, rhi } = await createReadyWebGPU();
        const buffer = rhi.device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        const texture = rhi.device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        buffer.destroy();
        buffer.destroy();
        texture.destroy();
        texture.destroy();
        expect(fake.bufferRecords[0]?.destroy).toHaveBeenCalledOnce();
        expect(fake.textureRecords[0]?.destroy).toHaveBeenCalledOnce();

        rhi.destroy();
        rhi.destroy();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
    });

    it('maps native device loss into the portable lifecycle', async () => {
        const { fake, rhi } = await createReadyWebGPU();
        fake.lost.resolve({ reason: 'unknown', message: 'mock device loss' });

        await expect(rhi.device.lost).resolves.toEqual({
            reason: 'unknown',
            message: 'mock device loss'
        });
        await Promise.resolve();
        expect(rhi.device.destroyed).toBe(true);
        expect(rhi.isReady).toBe(false);
    });
});
