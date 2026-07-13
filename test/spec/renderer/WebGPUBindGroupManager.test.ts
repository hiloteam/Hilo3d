import { describe, expect, it, vi } from 'vitest';
import Texture from '../../../src/texture/Texture';
import {
    BYTE,
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    FLOAT,
    LINEAR,
    NEAREST,
    RGBA,
    UNSIGNED_BYTE,
    UNSIGNED_SHORT
} from '../../../src/constants/webgl';
import { RGBA8I, RGBA8UI, RGBA32F, RGBA_INTEGER } from '../../../src/constants/webgl2';
import type {
    TranslatedShaderPair,
    WebGPUSamplerBinding,
    WebGPUUniformBlock
} from '../../../src/shader/GlslToWgsl';
import WebGPUBindGroupManager, {
    type ResolvedWebGPUSampler
} from '../../../src/renderer/webgpu/WebGPUBindGroupManager';
import type WebGPUTextureManager from '../../../src/renderer/webgpu/WebGPUTextureManager';
import type { WebGPUTextureResource } from '../../../src/renderer/webgpu/WebGPUTextureManager';

interface FakeDevice {
    readonly device: GPUDevice;
    readonly layoutDescriptors: GPUBindGroupLayoutDescriptor[];
    readonly bindGroupDescriptors: GPUBindGroupDescriptor[];
}

function fakeDevice(features: readonly GPUFeatureName[] = []): FakeDevice {
    const layoutDescriptors: GPUBindGroupLayoutDescriptor[] = [];
    const bindGroupDescriptors: GPUBindGroupDescriptor[] = [];
    const device = {
        features: new Set(features),
        limits: {
            maxBindingsPerBindGroup: 1000,
            maxUniformBuffersPerShaderStage: 12,
            maxSampledTexturesPerShaderStage: 16,
            maxSamplersPerShaderStage: 16
        },
        createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
            layoutDescriptors.push(descriptor);
            return { descriptor } as unknown as GPUBindGroupLayout;
        },
        createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor) =>
            ({ descriptor }) as unknown as GPUPipelineLayout,
        createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
            bindGroupDescriptors.push(descriptor);
            return { descriptor } as unknown as GPUBindGroup;
        }
    } as unknown as GPUDevice;
    return { device, layoutDescriptors, bindGroupDescriptors };
}

function shader(
    uniformBlocks: readonly WebGPUUniformBlock[] = [],
    samplers: readonly WebGPUSamplerBinding[] = []
): TranslatedShaderPair {
    return {
        vertex: { glsl: '', wgsl: '' },
        fragment: { glsl: '', wgsl: '' },
        vertexInputs: [],
        fragmentOutputs: [],
        uniformBlocks,
        samplers
    };
}

function uniformBlock(
    name: string,
    group: number,
    binding: number,
    stages: WebGPUUniformBlock['stages'] = ['vertex']
): WebGPUUniformBlock {
    return { name, group, binding, stages };
}

function samplerBinding(overrides: Partial<WebGPUSamplerBinding> = {}): WebGPUSamplerBinding {
    return {
        name: 'uTexture',
        arrayIndex: 0,
        type: 'sampler2D',
        group: 1,
        textureBinding: 1,
        samplerBinding: 2,
        stages: ['fragment'],
        ...overrides
    };
}

function textureResource(overrides: Partial<WebGPUTextureResource> = {}): WebGPUTextureResource {
    return {
        textureId: 'texture',
        gpuTexture: {} as GPUTexture,
        view: {} as GPUTextureView,
        sampler: {} as GPUSampler,
        format: 'rgba8unorm',
        width: 1,
        height: 1,
        depthOrArrayLayers: 1,
        mipLevelCount: 1,
        dimension: '2d',
        ...overrides
    };
}

function resolvedSampler(
    texture: Texture<unknown>,
    binding = samplerBinding(),
    resource = textureResource()
): ResolvedWebGPUSampler {
    return { texture, binding, resource };
}

function managerFor(device: GPUDevice): WebGPUBindGroupManager {
    return new WebGPUBindGroupManager(device, {} as WebGPUTextureManager);
}

describe('WebGPUBindGroupManager layouts', () => {
    it('always materializes the four-group ABI for empty and populated layouts', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        const empty = manager.getLayout(shader(), []);

        expect(empty.bindGroupLayouts).toHaveLength(4);
        expect(fake.layoutDescriptors.map(descriptor => descriptor.entries)).toEqual([
            [],
            [],
            [],
            []
        ]);
        const emptyGroups = manager.getBindGroups(empty, shader(), {}, []);
        expect(emptyGroups).toHaveLength(4);
        expect(fake.bindGroupDescriptors.map(descriptor => descriptor.entries)).toEqual([
            [],
            [],
            [],
            []
        ]);

        const blocks = [
            uniformBlock('FrameBlock', 0, 0),
            uniformBlock('MaterialBlock', 1, 0, ['fragment']),
            uniformBlock('ModelBlock', 2, 0, ['vertex', 'fragment']),
            uniformBlock('CustomBlock', 3, 4, ['fragment'])
        ];
        const populatedShader = shader(blocks);
        const populated = manager.getLayout(populatedShader, []);

        expect(populated.bindGroupLayouts).toHaveLength(4);
        expect(
            fake.layoutDescriptors.slice(4).map(descriptor => descriptor.entries.length)
        ).toEqual([1, 1, 1, 1]);

        const buffers = Object.fromEntries(
            blocks.map(block => [block.name, { buffer: {} as GPUBuffer, offset: 0, size: 64 }])
        );
        const groups = manager.getBindGroups(populated, populatedShader, buffers, []);
        expect(groups).toHaveLength(4);
        expect(
            fake.bindGroupDescriptors.slice(4).map(descriptor => descriptor.entries.length)
        ).toEqual([1, 1, 1, 1]);
    });

    it('canonicalizes declaration order and caches structurally identical layouts', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        const blocks = [
            uniformBlock('FrameBlock', 0, 0),
            uniformBlock('MaterialBlock', 1, 0, ['fragment'])
        ];
        const firstShader = shader(blocks);
        const secondShader = shader([...blocks].reverse());

        const first = manager.getLayout(firstShader, []);
        const second = manager.getLayout(secondShader, []);

        expect(second).toBe(first);
        expect(fake.layoutDescriptors).toHaveLength(4);

        const frameUniformBuffer = {} as GPUBuffer;
        const materialBuffer = {} as GPUBuffer;
        const buffers = {
            FrameBlock: { buffer: frameUniformBuffer, offset: 0, size: 64 },
            MaterialBlock: { buffer: materialBuffer, offset: 16, size: 48 }
        };
        const firstGroups = manager.getBindGroups(first, firstShader, buffers, []);
        const secondGroups = manager.getBindGroups(second, secondShader, buffers, []);
        expect(secondGroups).toBe(firstGroups);
        expect(fake.bindGroupDescriptors).toHaveLength(4);
    });

    it('rejects duplicate binding slots and resource/view dimension mismatches synchronously', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        expect(() =>
            manager.getLayout(
                shader([uniformBlock('First', 0, 0), uniformBlock('Second', 0, 0, ['fragment'])]),
                []
            )
        ).toThrow(/binding 0 more than once/);

        const texture = new Texture({ width: 1, height: 1 });
        expect(() =>
            manager.getLayout(shader(), [
                resolvedSampler(
                    texture,
                    samplerBinding({ type: 'samplerCube' }),
                    textureResource({ dimension: '2d' })
                )
            ])
        ).toThrow(/requires a cube texture view/);
    });

    it('allows nearest rgba32float without float32-filterable and rejects linear filtering', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        const texture = new Texture({
            width: 1,
            height: 1,
            internalFormat: RGBA32F,
            format: RGBA,
            type: FLOAT,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: new Float32Array([0, 0, 0, 1])
        });
        const sampler = resolvedSampler(
            texture,
            samplerBinding(),
            textureResource({ format: 'rgba32float' })
        );

        manager.getLayout(shader(), [sampler]);
        const entries = fake.layoutDescriptors[1]?.entries;
        expect(entries?.[0]?.texture?.sampleType).toBe('unfilterable-float');
        expect(entries?.[1]?.sampler?.type).toBe('non-filtering');

        texture.minFilter = LINEAR;
        texture.magFilter = LINEAR;
        expect(() => manager.getLayout(shader(), [sampler])).toThrow(/float32-filterable/);
    });

    it('rejects shader resource counts that exceed explicit device limits', () => {
        const fake = fakeDevice();
        Reflect.set(fake.device.limits, 'maxSampledTexturesPerShaderStage', 1);
        Reflect.set(fake.device.limits, 'maxSamplersPerShaderStage', 1);
        const manager = managerFor(fake.device);
        const texture = new Texture({ width: 1, height: 1 });
        const samplers = [
            resolvedSampler(texture),
            resolvedSampler(
                texture,
                samplerBinding({ name: 'uSecond', textureBinding: 3, samplerBinding: 4 })
            )
        ];

        expect(() =>
            manager.getLayout(
                shader(
                    [],
                    samplers.map(item => item.binding)
                ),
                samplers
            )
        ).toThrow(/requires 2 sampled textures/);
    });

    const extendedSamplerAbiCases: readonly {
        readonly type: WebGPUSamplerBinding['type'];
        readonly dimension: WebGPUTextureResource['dimension'];
        readonly texture: () => Texture<unknown>;
        readonly format: GPUTextureFormat;
        readonly sampleType: GPUTextureSampleType;
        readonly samplerType: GPUSamplerBindingType;
        readonly comparison?: boolean;
    }[] = [
        {
            type: 'sampler3D',
            dimension: '3d',
            texture: () => new Texture({ width: 1, height: 1, image: null }),
            format: 'rgba8unorm',
            sampleType: 'float',
            samplerType: 'filtering'
        },
        {
            type: 'sampler2DArray',
            dimension: '2d-array',
            texture: () => new Texture({ width: 1, height: 1, image: null }),
            format: 'rgba8unorm',
            sampleType: 'float',
            samplerType: 'filtering'
        },
        {
            type: 'sampler2DArrayShadow',
            dimension: '2d-array',
            texture: () =>
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: DEPTH_COMPONENT16,
                    format: DEPTH_COMPONENT,
                    type: UNSIGNED_SHORT,
                    image: null
                }),
            format: 'depth16unorm',
            sampleType: 'depth',
            samplerType: 'comparison',
            comparison: true
        },
        ...(['isampler', 'usampler'] as const).flatMap(prefix => {
            const signed = prefix === 'isampler';
            const texture = (): Texture<unknown> =>
                new Texture({
                    width: 1,
                    height: 1,
                    internalFormat: signed ? RGBA8I : RGBA8UI,
                    format: RGBA_INTEGER,
                    type: signed ? BYTE : UNSIGNED_BYTE,
                    minFilter: NEAREST,
                    magFilter: NEAREST,
                    image: signed ? new Int8Array(4) : new Uint8Array(4)
                });
            const sampleType: GPUTextureSampleType = signed ? 'sint' : 'uint';
            const format: GPUTextureFormat = signed ? 'rgba8sint' : 'rgba8uint';
            return [
                { type: `${prefix}2D`, dimension: '2d' },
                { type: `${prefix}3D`, dimension: '3d' },
                { type: `${prefix}Cube`, dimension: 'cube' },
                { type: `${prefix}2DArray`, dimension: '2d-array' }
            ].map(({ type, dimension }) => ({
                type: type as WebGPUSamplerBinding['type'],
                dimension: dimension as WebGPUTextureResource['dimension'],
                texture,
                format,
                sampleType,
                samplerType: 'non-filtering' as const
            }));
        })
    ];

    it.each(extendedSamplerAbiCases)(
        'maps $type to its native WebGPU texture and sampler layout',
        samplerCase => {
            const fake = fakeDevice();
            const resource = textureResource({
                dimension: samplerCase.dimension,
                format: samplerCase.format
            });
            const get = vi.fn(() => resource);
            const manager = new WebGPUBindGroupManager(fake.device, { get });
            const binding = samplerBinding({ type: samplerCase.type });
            const resolved = manager.resolveSampler(binding, samplerCase.texture());

            expect(get).toHaveBeenCalledWith(
                resolved.texture,
                samplerCase.comparison ? { compare: 'less-equal' } : {}
            );
            manager.getLayout(shader([], [binding]), [resolved]);

            const entries = fake.layoutDescriptors[1]?.entries;
            expect(entries?.[0]?.texture).toEqual({
                sampleType: samplerCase.sampleType,
                viewDimension: samplerCase.dimension,
                multisampled: false
            });
            expect(entries?.[1]?.sampler?.type).toBe(samplerCase.samplerType);
        }
    );

    it('rejects integer sampler format and filtering mismatches before allocation', () => {
        const fake = fakeDevice();
        const get = vi.fn(() => textureResource({ format: 'rgba8sint' }));
        const manager = new WebGPUBindGroupManager(fake.device, { get });
        const linearSigned = new Texture({
            width: 1,
            height: 1,
            internalFormat: RGBA8I,
            format: RGBA_INTEGER,
            type: BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: new Int8Array(4)
        });
        linearSigned.minFilter = LINEAR;
        linearSigned.magFilter = LINEAR;

        expect(() =>
            manager.resolveSampler(samplerBinding({ type: 'isampler2D' }), linearSigned)
        ).toThrow(/requires nearest minification, magnification and mipmap filters/);
        expect(get).not.toHaveBeenCalled();

        linearSigned.minFilter = NEAREST;
        linearSigned.magFilter = NEAREST;
        expect(() =>
            manager.resolveSampler(samplerBinding({ type: 'usampler2D' }), linearSigned)
        ).toThrow(/declares uint.*exposes sint/);
        expect(() => manager.resolveSampler(samplerBinding(), linearSigned)).toThrow(
            /requires a floating-point color texture.*exposes sint/
        );
        expect(get).not.toHaveBeenCalled();
    });

    it('revalidates integer sampler filtering against the resolved resource mip chain', () => {
        const fake = fakeDevice();
        const texture = new Texture({
            width: 1,
            height: 1,
            internalFormat: RGBA8UI,
            format: RGBA_INTEGER,
            type: UNSIGNED_BYTE,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: new Uint8Array(4)
        });
        const binding = samplerBinding({ type: 'usampler2D' });
        const sampler = resolvedSampler(
            texture,
            binding,
            textureResource({ format: 'rgba8uint', mipLevelCount: 4 })
        );
        const manager = managerFor(fake.device);

        manager.getLayout(shader([], [binding]), [sampler]);
        texture.minFilter = LINEAR;
        expect(() => manager.getLayout(shader([], [binding]), [sampler])).toThrow(
            /requires nearest minification, magnification and mipmap filters/
        );
    });

    it('resolves numeric depth samplers and rejects comparison samplers bound to color', () => {
        const fake = fakeDevice();
        const get = vi.fn(() => textureResource({ format: 'depth16unorm' }));
        const manager = new WebGPUBindGroupManager(fake.device, { get });
        const depth = new Texture({
            width: 1,
            height: 1,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_SHORT,
            image: null,
            minFilter: NEAREST,
            magFilter: NEAREST
        });
        const color = new Texture({ width: 1, height: 1, image: null });

        const resolved = manager.resolveSampler(samplerBinding(), depth);
        expect(resolved.resource.format).toBe('depth16unorm');
        expect(get).toHaveBeenCalledWith(depth, {});
        expect(() =>
            manager.resolveSampler(samplerBinding({ type: 'sampler2DShadow' }), color)
        ).toThrow(/requires a depth texture/);
        expect(get).toHaveBeenCalledOnce();

        const translated = shader([], [resolved.binding]);
        manager.getLayout(translated, [resolved]);
        expect(fake.layoutDescriptors[1]?.entries).toEqual([
            {
                binding: 1,
                visibility: 2,
                texture: { sampleType: 'depth', viewDimension: '2d', multisampled: false }
            },
            { binding: 2, visibility: 2, sampler: { type: 'non-filtering' } }
        ]);

        depth.magFilter = LINEAR;
        expect(() => manager.resolveSampler(samplerBinding(), depth)).toThrow(
            /numeric depth sampler .* requires nearest/u
        );
    });
});

describe('WebGPUBindGroupManager resource identity', () => {
    it('keys bind groups by UBO buffer/range and texture view/sampler identity', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        const block = uniformBlock('MaterialBlock', 1, 0, ['fragment']);
        const texture = new Texture({ width: 1, height: 1 });
        const binding = samplerBinding();
        const viewA = {} as GPUTextureView;
        const samplerA = {} as GPUSampler;
        const samplerResourceA = resolvedSampler(
            texture,
            binding,
            textureResource({ view: viewA, sampler: samplerA })
        );
        const translated = shader([block], [binding]);
        const layout = manager.getLayout(translated, [samplerResourceA]);
        const bufferA = {} as GPUBuffer;

        const first = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: bufferA, offset: 0, size: 64 } },
            [samplerResourceA]
        );
        const sameIdentity = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: bufferA, offset: 0, size: 64 } },
            [samplerResourceA]
        );
        expect(sameIdentity).toBe(first);

        const bufferB = {} as GPUBuffer;
        const changedUbo = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: bufferB, offset: 0, size: 64 } },
            [samplerResourceA]
        );
        expect(changedUbo).not.toBe(first);

        const changedRange = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: bufferB, offset: 16, size: 48 } },
            [samplerResourceA]
        );
        expect(changedRange).not.toBe(changedUbo);

        const samplerResourceB = resolvedSampler(
            texture,
            binding,
            textureResource({ view: {} as GPUTextureView, sampler: samplerA })
        );
        const changedView = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: bufferB, offset: 16, size: 48 } },
            [samplerResourceB]
        );
        expect(changedView).not.toBe(changedRange);

        const samplerResourceC = resolvedSampler(
            texture,
            binding,
            textureResource({ view: samplerResourceB.resource.view, sampler: {} as GPUSampler })
        );
        const changedSampler = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: bufferB, offset: 16, size: 48 } },
            [samplerResourceC]
        );
        expect(changedSampler).not.toBe(changedView);
        expect(fake.bindGroupDescriptors).toHaveLength(20);
    });

    it('clears layout and bind-group caches so rebuilt GPU identities are used', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        const translated = shader();
        const firstLayout = manager.getLayout(translated, []);
        const firstGroups = manager.getBindGroups(firstLayout, translated, {}, []);

        manager.clear();

        const secondLayout = manager.getLayout(translated, []);
        const secondGroups = manager.getBindGroups(secondLayout, translated, {}, []);
        expect(secondLayout).not.toBe(firstLayout);
        expect(secondGroups).not.toBe(firstGroups);
        expect(fake.layoutDescriptors).toHaveLength(8);
        expect(fake.bindGroupDescriptors).toHaveLength(8);
    });

    it('preserves pipeline-layout identity when only resource bind groups are invalidated', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        const translated = shader();
        const firstLayout = manager.getLayout(translated, []);
        const firstGroups = manager.getBindGroups(firstLayout, translated, {}, []);

        manager.clearBindGroups();

        const secondLayout = manager.getLayout(translated, []);
        const secondGroups = manager.getBindGroups(secondLayout, translated, {}, []);
        expect(secondLayout).toBe(firstLayout);
        expect(secondGroups).not.toBe(firstGroups);
        expect(fake.layoutDescriptors).toHaveLength(4);
        expect(fake.bindGroupDescriptors).toHaveLength(8);
    });

    it('bounds bind-group identity caching and evicts the least recently used set', () => {
        const fake = fakeDevice();
        const manager = managerFor(fake.device);
        const block = uniformBlock('MaterialBlock', 1, 0, ['fragment']);
        const translated = shader([block]);
        const layout = manager.getLayout(translated, []);
        const firstBuffer = {} as GPUBuffer;
        const first = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: firstBuffer, offset: 0, size: 64 } },
            []
        );

        for (let index = 0; index < 256; index++) {
            manager.getBindGroups(
                layout,
                translated,
                { MaterialBlock: { buffer: {} as GPUBuffer, offset: index * 16, size: 64 } },
                []
            );
        }

        expect(manager.bindGroupCacheSize).toBe(256);
        const recreated = manager.getBindGroups(
            layout,
            translated,
            { MaterialBlock: { buffer: firstBuffer, offset: 0, size: 64 } },
            []
        );
        expect(recreated).not.toBe(first);
        expect(manager.bindGroupCacheSize).toBe(256);
    });
});
