import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import type { DispatchEvent } from '../../../src/core/EventDispatcher';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import CameraHelper from '../../../src/helper/CameraHelper';
import DirectionalLight from '../../../src/light/DirectionalLight';
import PointLight from '../../../src/light/PointLight';
import Material from '../../../src/material/Material';
import Color from '../../../src/math/Color';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import type { RendererFeatureName } from '../../../src/render/RendererOptions';
import {
    DEPTH_COMPONENT,
    DEPTH_COMPONENT16,
    LINE_STRIP,
    NEAREST,
    TRIANGLES,
    TRIANGLE_FAN,
    UNSIGNED_SHORT
} from '../../../src/constants/webgl';
import Shader from '../../../src/shader/Shader';
import {
    NagaShaderTranslator,
    type TranslatedShaderPair,
    type WebGPUVertexInput
} from '../../../src/render/shader/GlslToWgsl';
import WebGPUDriver, {
    MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS
} from '../../../src/render/internal/webgpu/WebGPUDriver';
import BuiltInUniformBlockManager from '../../../src/render/BuiltInUniformBlockManager';
import type { RendererFrame, RendererFrameCallback } from '../../../src/render/Renderer';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import type {
    WebGPUBufferManager,
    WebGPUVertexBufferBinding
} from '../../../src/render/internal/webgpu/WebGPUBufferManager';
import type { ResolvedWebGPUSampler } from '../../../src/render/internal/webgpu/WebGPUBindGroupManager';
import type WebGPUTextureManager from '../../../src/render/internal/webgpu/WebGPUTextureManager';
import type { WebGPUTextureResource } from '../../../src/render/internal/webgpu/WebGPUTextureManager';
import type { WebGPURenderPipelineRequest } from '../../../src/render/internal/webgpu/WebGPUPipelineManager';
import type WebGPURenderTarget from '../../../src/render/internal/webgpu/WebGPURenderTarget';
import Texture from '../../../src/texture/Texture';
import { testEnv } from '../../legacy-setup';

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
}

interface FakeGPUDevice {
    readonly device: GPUDevice;
    readonly destroyDevice: ReturnType<typeof vi.fn>;
    readonly createBuffer: ReturnType<typeof vi.fn>;
    readonly createShaderModule: ReturnType<typeof vi.fn>;
    readonly createSampler: ReturnType<typeof vi.fn>;
    readonly createBindGroupLayout: ReturnType<typeof vi.fn>;
    readonly createPipelineLayout: ReturnType<typeof vi.fn>;
    readonly createRenderPipeline: ReturnType<typeof vi.fn>;
    readonly createBindGroup: ReturnType<typeof vi.fn>;
    readonly createTexture: ReturnType<typeof vi.fn>;
    readonly createCommandEncoder: ReturnType<typeof vi.fn>;
    readonly finish: ReturnType<typeof vi.fn>;
    readonly beginRenderPass: ReturnType<typeof vi.fn>;
    readonly setBindGroup: ReturnType<typeof vi.fn>;
    readonly setStencilReference: ReturnType<typeof vi.fn>;
    readonly lost: Deferred<GPUDeviceLostInfo>;
    readonly submit: ReturnType<typeof vi.fn>;
    readonly writeTexture: ReturnType<typeof vi.fn>;
}

interface FakeWebGPU extends FakeGPUDevice {
    readonly adapter: GPUAdapter;
    readonly canvas: HTMLCanvasElement;
    readonly context: GPUCanvasContext;
    readonly configure: ReturnType<typeof vi.fn>;
    readonly unconfigure: ReturnType<typeof vi.fn>;
    readonly getContext: ReturnType<typeof vi.fn>;
    readonly requestDevice: ReturnType<
        typeof vi.fn<(descriptor?: GPUDeviceDescriptor) => Promise<GPUDevice>>
    >;
    readonly requestAdapter: ReturnType<
        typeof vi.fn<(options?: GPURequestAdapterOptions) => Promise<GPUAdapter | null>>
    >;
}

function deferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T) => void) | undefined;
    let rejectPromise: ((reason: unknown) => void) | undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return {
        promise,
        resolve: value => resolvePromise?.(value),
        reject: reason => rejectPromise?.(reason)
    };
}

function createFakeGPUDevice(features: readonly GPUFeatureName[] = []): FakeGPUDevice {
    const destroyDevice = vi.fn();
    const lost = deferred<GPUDeviceLostInfo>();
    const submit = vi.fn();
    const writeTexture = vi.fn();
    const createShaderModule = vi.fn(() => ({}) as GPUShaderModule);
    const createBuffer = vi.fn((descriptor: GPUBufferDescriptor) => {
        const mappedRange = new ArrayBuffer(descriptor.size);
        return {
            destroy: vi.fn(),
            getMappedRange: vi.fn(() => mappedRange),
            unmap: vi.fn()
        } as unknown as GPUBuffer;
    });
    const createSampler = vi.fn((descriptor: GPUSamplerDescriptor) => ({
        descriptor
    }));
    const createBindGroupLayout = vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => ({
        descriptor
    }));
    const createPipelineLayout = vi.fn((descriptor: GPUPipelineLayoutDescriptor) => ({
        descriptor
    }));
    const createRenderPipeline = vi.fn((descriptor: GPURenderPipelineDescriptor) => ({
        descriptor
    }));
    const createBindGroup = vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor }));
    const createTexture = vi.fn(() => {
        return {
            createView: vi.fn(() => ({}) as GPUTextureView),
            destroy: vi.fn()
        } as unknown as GPUTexture;
    });
    const setBindGroup = vi.fn();
    const setStencilReference = vi.fn();
    const pass = {
        end: vi.fn(),
        setPipeline: vi.fn(),
        setBindGroup,
        setStencilReference,
        setVertexBuffer: vi.fn(),
        setIndexBuffer: vi.fn(),
        setViewport: vi.fn(),
        draw: vi.fn(),
        drawIndexed: vi.fn()
    } as unknown as GPURenderPassEncoder;
    const beginRenderPass = vi.fn(() => pass);
    const finish = vi.fn(() => ({}) as GPUCommandBuffer);
    const createCommandEncoder = vi.fn(() => ({
        beginRenderPass,
        finish
    }));
    const device = {
        features: new Set(features),
        limits: {
            maxUniformBufferBindingSize: 65_536,
            maxBufferSize: 1_048_576,
            maxBindGroups: 4,
            maxUniformBuffersPerShaderStage: 12,
            maxTextureDimension2D: 4096,
            maxTextureArrayLayers: 256,
            maxColorAttachments: 8,
            maxColorAttachmentBytesPerSample: 64,
            maxVertexAttributes: 16,
            maxVertexBufferArrayStride: 2048
        },
        queue: {
            writeBuffer: vi.fn(),
            writeTexture,
            copyExternalImageToTexture: vi.fn(),
            submit
        },
        createTexture,
        createBuffer,
        createSampler,
        createBindGroupLayout,
        createPipelineLayout,
        createRenderPipeline,
        createBindGroup,
        createShaderModule,
        createCommandEncoder,
        addEventListener: vi.fn(),
        lost: lost.promise,
        destroy: destroyDevice
    } as unknown as GPUDevice;
    return {
        device,
        destroyDevice,
        createBuffer,
        createShaderModule,
        createSampler,
        createBindGroupLayout,
        createPipelineLayout,
        createRenderPipeline,
        createBindGroup,
        createTexture,
        createCommandEncoder,
        finish,
        beginRenderPass,
        setBindGroup,
        setStencilReference,
        lost,
        submit,
        writeTexture
    };
}

function createFakeWebGPU(features: readonly GPUFeatureName[] = []): FakeWebGPU {
    const configure = vi.fn();
    const unconfigure = vi.fn();
    const context = {
        configure,
        unconfigure,
        getCurrentTexture: vi.fn(
            () =>
                ({
                    createView: vi.fn(() => ({}) as GPUTextureView)
                }) as unknown as GPUTexture
        )
    } as unknown as GPUCanvasContext;
    const fakeDevice = createFakeGPUDevice(features);
    const requestDevice = vi
        .fn<(descriptor?: GPUDeviceDescriptor) => Promise<GPUDevice>>()
        .mockResolvedValue(fakeDevice.device);
    const adapter = {
        features: new Set(features),
        limits: {
            maxBindGroups: 4,
            maxUniformBufferBindingSize: 65_536,
            maxUniformBuffersPerShaderStage: 12
        },
        requestDevice
    } as unknown as GPUAdapter;
    const requestAdapter = vi
        .fn<(options?: GPURequestAdapterOptions) => Promise<GPUAdapter | null>>()
        .mockResolvedValue(adapter);
    const gpu = {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm')
    } as unknown as GPU;
    vi.stubGlobal('navigator', { gpu });
    const canvas = document.createElement('canvas');
    const getContext = vi.fn((contextId: string) => (contextId === 'webgpu' ? context : null));
    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: getContext
    });
    return {
        canvas,
        adapter,
        context,
        configure,
        unconfigure,
        getContext,
        ...fakeDevice,
        requestDevice,
        requestAdapter
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Shader.init(testEnv.renderer);
});

describe('WebGPUDriver initialization lifecycle', () => {
    it('probes adapter support without creating a device, context, or GPU resource', async () => {
        const fake = createFakeWebGPU();

        await expect(WebGPUDriver.isSupported()).resolves.toBe(true);

        expect(fake.requestAdapter).toHaveBeenCalledOnce();
        expect(fake.requestAdapter).toHaveBeenCalledWith({
            powerPreference: 'high-performance',
            forceFallbackAdapter: false
        });
        expect(fake.requestDevice).not.toHaveBeenCalled();
        expect(fake.getContext).not.toHaveBeenCalled();
        expect(fake.createBuffer).not.toHaveBeenCalled();
        expect(fake.createTexture).not.toHaveBeenCalled();
        expect(fake.createShaderModule).not.toHaveBeenCalled();
        expect(fake.createRenderPipeline).not.toHaveBeenCalled();
    });

    it('reports unsupported adapters without allocating a device', async () => {
        const fake = createFakeWebGPU();

        await expect(
            WebGPUDriver.isSupported({ requiredFeatures: ['timestamp-query'] })
        ).resolves.toBe(false);
        await expect(
            WebGPUDriver.isSupported({ requiredLimits: { maxBindGroups: 5 } })
        ).resolves.toBe(false);
        expect(fake.requestDevice).not.toHaveBeenCalled();

        vi.stubGlobal('navigator', {});
        await expect(WebGPUDriver.isSupported()).resolves.toBe(false);
    });

    it('snapshots mutable support requirements before adapter discovery awaits', async () => {
        createFakeWebGPU();
        const requiredFeatures: RendererFeatureName[] = [];
        const requiredLimits: Record<string, number> = {};
        const support = WebGPUDriver.isSupported({ requiredFeatures, requiredLimits });

        requiredFeatures.push('timestamp-query');
        requiredLimits['maxBindGroups'] = 5;

        await expect(support).resolves.toBe(true);
    });

    it('records multiple passes into one application-frame encoder and one submission', async () => {
        const fake = createFakeWebGPU();
        const diagnostics = registerRendererDiagnostics(fake.canvas);
        const renderer = new WebGPUDriver({ domElement: fake.canvas, antialias: false });
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        fake.createCommandEncoder.mockClear();
        fake.beginRenderPass.mockClear();
        fake.createBindGroup.mockClear();
        fake.submit.mockClear();

        renderer.renderFrame(frame => {
            expect(frame.backend).toBe('webgpu');
            frame.present(target);
            frame.present(target);
        });

        expect(fake.createCommandEncoder).toHaveBeenCalledOnce();
        expect(fake.beginRenderPass).toHaveBeenCalledTimes(2);
        expect(fake.createBindGroup).toHaveBeenCalledOnce();
        expect(fake.submit).toHaveBeenCalledOnce();
        expect(renderer.getDiagnosticsSnapshot()?.frame).toMatchObject({
            draws: 2,
            passes: 2,
            submissions: 1
        });
        expect(renderer.getDiagnosticsSnapshot()?.nativeObjects.commandEncoder).toMatchObject({
            created: 1,
            destroyed: null,
            live: null,
            highWater: null
        });
        expect(renderer.getDiagnosticsSnapshot()?.caches.bindGroup).toEqual({
            hits: 0,
            misses: 0,
            evictions: 0,
            size: 0,
            highWater: 0
        });
        expect(renderer.getDiagnosticsSnapshot()?.caches.framebuffer).toEqual({
            hits: 1,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });
        expect(() => {
            renderer.renderFrame(() => {
                renderer.renderFrame(() => undefined);
            });
        }).toThrow(/Nested renderer frames/u);
        const asyncCallback = (() => Promise.resolve()) as unknown as RendererFrameCallback;
        expect(() => {
            renderer.renderFrame(asyncCallback);
        }).toThrow(/must be synchronous/u);
        renderer.destroy();
        expect(unregisterRendererDiagnostics(fake.canvas, diagnostics)).toBe(true);
    });

    it('aborts a poisoned application frame even when its command error is caught', async () => {
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas, antialias: false });
        await renderer.ready;
        const valid = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        const destroyed = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        destroyed.destroy();
        fake.submit.mockClear();

        expect(() => {
            renderer.renderFrame(frame => {
                frame.present(valid);
                try {
                    frame.present(destroyed);
                } catch {
                    // Application code cannot make a partially recorded command buffer valid.
                }
                expect(() => {
                    frame.present(valid);
                }).toThrow(/frame recording was aborted/u);
            });
        }).toThrow(/frame recording was aborted/u);
        expect(fake.submit).not.toHaveBeenCalled();

        let escapedFrame: RendererFrame | undefined;
        renderer.renderFrame(frame => {
            escapedFrame = frame;
        });
        expect(() => {
            escapedFrame?.present(valid);
        }).toThrow(/only valid inside/u);
        renderer.renderFrame(frame => {
            expect(frame).not.toBe(escapedFrame);
            expect(() => escapedFrame?.present(valid)).toThrow(/only valid inside/u);
            frame.present(valid);
        });
        renderer.destroy();
    });

    it('rejects texture content changes after first use in an application frame', async () => {
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas, antialias: false });
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        fake.submit.mockClear();

        expect(() => {
            renderer.renderFrame(frame => {
                frame.present(target);
                target.getColorTexture(0).needUpdate = true;
                expect(() => {
                    frame.present(target);
                }).toThrow(/Texture content cannot change/u);
            });
        }).toThrow(/frame recording was aborted/u);
        expect(fake.submit).not.toHaveBeenCalled();
        renderer.destroy();
    });

    it('rejects render-target mutation and readback during application-frame recording', async () => {
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas, antialias: false });
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        fake.submit.mockClear();

        expect(() => {
            renderer.renderFrame(frame => {
                frame.present(target);
                target.resize(4, 4);
            });
        }).toThrow(/render-target resize cannot run/u);
        expect(target.width).toBe(2);
        expect(fake.submit).not.toHaveBeenCalled();

        let readback: Promise<unknown> | undefined;
        expect(() => {
            renderer.renderFrame(() => {
                readback = target.readColorAttachment();
            });
        }).toThrow(/frame recording was aborted/u);
        await expect(readback).rejects.toThrow(/render-target readback cannot run/u);
        expect(fake.submit).not.toHaveBeenCalled();

        expect(() => {
            renderer.renderFrame(() => {
                target.destroy();
            });
        }).toThrow(/render-target destroy cannot run/u);
        expect(target.isDestroyed).toBe(false);
        renderer.destroy();
    });

    it('poisons a frame when an attachment Texture is destroyed after it was encoded', async () => {
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas, antialias: false });
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        const texture = target.getColorTexture();
        const oldGPUTexture = target.getColorGPUTexture();
        fake.submit.mockClear();

        expect(() => {
            renderer.renderFrame(frame => {
                frame.present(target);
                expect(() => {
                    texture.destroy();
                }).toThrow(/render-target attachment recovery cannot run/u);
                expect(() => {
                    frame.present(target);
                }).toThrow(/frame recording was aborted/u);
            });
        }).toThrow(/frame recording was aborted/u);
        expect(fake.submit).not.toHaveBeenCalled();
        expect(target.isDestroyed).toBe(false);

        const rebuiltGPUTexture = target.getColorGPUTexture();
        expect(rebuiltGPUTexture).not.toBe(oldGPUTexture);
        fake.submit.mockClear();
        renderer.renderFrame(frame => {
            frame.present(target);
        });
        expect(fake.submit).toHaveBeenCalledOnce();

        fake.submit.mockClear();
        renderer.renderFrame(frame => {
            frame.present(target);
            expect(() => {
                target.textureManager.destroyAll();
            }).toThrow(/while a submission is active/u);
            frame.present(target);
        });
        expect(fake.submit).toHaveBeenCalledOnce();
        expect(target.getColorGPUTexture()).toBe(rebuiltGPUTexture);
        renderer.destroy();
    });

    it('presents with the Naga-translated shared GLSL sampler layout', async () => {
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas, antialias: false });
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });

        renderer.present(target);

        expect(fake.createShaderModule).toHaveBeenCalledTimes(2);
        const shaderModules = fake.createShaderModule.mock.calls.map(
            call => call[0] as GPUShaderModuleDescriptor
        );
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
        const pipelineLayout = fake.createPipelineLayout.mock.calls[0]?.[0] as
            GPUPipelineLayoutDescriptor | undefined;
        const pipelineLayouts = pipelineLayout?.bindGroupLayouts as
            readonly { readonly descriptor: GPUBindGroupLayoutDescriptor }[] | undefined;
        expect(pipelineLayouts).toHaveLength(2);
        expect(pipelineLayouts?.[0]?.descriptor.entries).toEqual([]);
        expect(pipelineLayouts?.[1]?.descriptor).toBe(resourceLayout);
        const pipeline = fake.createRenderPipeline.mock.calls[0]?.[0] as
            GPURenderPipelineDescriptor | undefined;
        expect(pipeline?.vertex.entryPoint).toBe('main');
        expect(pipeline?.fragment?.entryPoint).toBe('main');
        const bindGroup = fake.createBindGroup.mock.calls[0]?.[0] as
            GPUBindGroupDescriptor | undefined;
        expect(bindGroup?.entries.map(entry => entry.binding)).toEqual([1, 2]);
        expect(fake.setBindGroup).toHaveBeenCalledWith(1, expect.anything());
        expect(fake.submit).toHaveBeenCalledOnce();

        renderer.destroy();
    });

    it('bounds numeric-depth shader specialization with per-base LRU eviction', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const bindings: TranslatedShaderPair['samplers'] = Array.from(
            { length: 6 },
            (_, index) => ({
                name: `u_depth${String(index)}`,
                arrayIndex: 0,
                type: 'sampler2D',
                group: 1,
                textureBinding: index * 2,
                samplerBinding: index * 2 + 1,
                stages: ['fragment']
            })
        );
        const fragmentWgsl = bindings
            .map(
                binding =>
                    `@group(${String(binding.group)}) @binding(${String(binding.textureBinding)}) var depth${String(binding.textureBinding)}: texture_2d<f32>;`
            )
            .join('\n');
        const translated: TranslatedShaderPair = {
            vertex: { glsl: '', wgsl: '' },
            fragment: { glsl: '', wgsl: fragmentWgsl },
            vertexInputs: [],
            fragmentOutputs: [],
            uniformBlocks: [],
            samplers: bindings
        };
        interface CompiledShaderFixture {
            readonly translated: TranslatedShaderPair;
            readonly vertexModule: GPUShaderModule;
            readonly fragmentModule: GPUShaderModule;
        }
        const compiled: CompiledShaderFixture = {
            translated,
            vertexModule: {} as GPUShaderModule,
            fragmentModule: {} as GPUShaderModule
        };
        const depthTexture = new Texture({
            width: 1,
            height: 1,
            internalFormat: DEPTH_COMPONENT16,
            format: DEPTH_COMPONENT,
            type: UNSIGNED_SHORT,
            minFilter: NEAREST,
            magFilter: NEAREST,
            image: null
        });
        const resolved = bindings.map(
            binding =>
                ({
                    binding,
                    texture: depthTexture,
                    resource: {} as WebGPUTextureResource
                }) satisfies ResolvedWebGPUSampler
        );
        const shader = new Shader({ vs: 'vertex', fs: 'fragment' });
        const specialize = Reflect.get(renderer, 'getDepthSpecializedShader') as (
            shader: Shader,
            compiled: CompiledShaderFixture,
            samplers: readonly ResolvedWebGPUSampler[]
        ) => CompiledShaderFixture;
        const samplersForMask = (mask: number) =>
            resolved.filter((_, index) => (mask & (1 << index)) !== 0);
        const modulesBeforeVariants = fake.createShaderModule.mock.calls.length;
        let first: CompiledShaderFixture | undefined;
        for (let mask = 1; mask <= MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS; mask++) {
            const specialized = specialize.call(renderer, shader, compiled, samplersForMask(mask));
            if (mask === 1) first = specialized;
        }
        if (!first) throw new Error('Missing depth specialization cache fixture');

        expect(specialize.call(renderer, shader, compiled, samplersForMask(1))).toBe(first);
        specialize.call(
            renderer,
            shader,
            compiled,
            samplersForMask(MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS + 1)
        );
        const caches = Reflect.get(renderer, 'depthSpecializedShaders') as WeakMap<
            CompiledShaderFixture,
            Map<string, CompiledShaderFixture>
        >;
        const variants = caches.get(compiled);
        expect(variants).toHaveLength(MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS);
        expect(variants?.has('1:0')).toBe(true);
        expect(variants?.has('1:2')).toBe(false);
        expect(fake.createShaderModule).toHaveBeenCalledTimes(
            modulesBeforeVariants + (MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS + 1) * 2
        );

        specialize.call(renderer, shader, compiled, samplersForMask(2));
        expect(fake.createShaderModule).toHaveBeenCalledTimes(
            modulesBeforeVariants + (MAX_CACHED_WEBGPU_DEPTH_SHADER_VARIANTS + 2) * 2
        );
        renderer.destroy();
    });

    it('keeps runtime instancing selection synchronized with its render list', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;

        renderer.useInstanced = true;
        expect(renderer.renderList.useInstanced).toBe(true);
        renderer.useInstanced = false;
        expect(renderer.renderList.useInstanced).toBe(false);
        renderer.destroy();
    });

    it('allocates a stencil-capable canvas attachment without enabling canvas depth tests', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({
            domElement: fake.canvas,
            width: 8,
            height: 6,
            depth: false,
            stencil: true,
            antialias: false
        });
        await renderer.ready;

        expect(fake.createTexture).toHaveBeenCalledOnce();
        expect(fake.createTexture.mock.calls[0]?.[0]).toMatchObject({
            format: 'depth24plus-stencil8',
            sampleCount: 1
        });
        const getMainDrawTarget = Reflect.get(renderer, 'getMainDrawTarget') as () => {
            readonly depthStencilFormat?: GPUTextureFormat;
            readonly depthTestEnabled: boolean;
            readonly stencilTestEnabled: boolean;
        };
        expect(getMainDrawTarget.call(renderer)).toMatchObject({
            depthStencilFormat: 'depth24plus-stencil8',
            depthTestEnabled: false,
            stencilTestEnabled: true
        });
        renderer.destroy();
    });

    it('sets dynamic stencil reference from the active draw target state', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas, stencil: false });
        await renderer.ready;
        const encoder = fake.device.createCommandEncoder({ label: 'stencil state test' });
        const pass = encoder.beginRenderPass({ colorAttachments: [] });
        Reflect.set(renderer, 'activePass', pass);
        const encodeDraw = Reflect.get(renderer, 'encodeDraw') as (setup: {
            readonly pipeline: GPURenderPipeline;
            readonly renderState: {
                readonly usesStencil: boolean;
                readonly dynamic: {
                    readonly depthRange: readonly [number, number];
                    readonly stencilReference: number;
                };
            };
            readonly vertexBuffers: readonly [];
            readonly indexBuffer: null;
            readonly bindGroups: readonly [];
            readonly vertexCount: number;
            readonly instanceCount: number;
        }) => void;
        const setup = {
            pipeline: {} as GPURenderPipeline,
            renderState: {
                usesStencil: true,
                dynamic: { depthRange: [0, 1] as const, stencilReference: 7 }
            },
            vertexBuffers: [],
            indexBuffer: null,
            bindGroups: [],
            vertexCount: 3,
            instanceCount: 1
        } as const;

        encodeDraw.call(renderer, setup);

        expect(fake.setStencilReference).toHaveBeenCalledOnce();
        expect(fake.setStencilReference).toHaveBeenCalledWith(7);
        renderer.destroy();
    });

    it('creates one backend-neutral camera helper for a debug shadow camera', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const light = new DirectionalLight({
            shadow: {
                debug: true,
                cameraInfo: {
                    left: -1,
                    right: 1,
                    bottom: -1,
                    top: 1,
                    near: 0.1,
                    far: 10
                }
            }
        });
        const camera = new PerspectiveCamera({ near: 0.1, far: 100 });
        const updateShadowCamera = Reflect.get(renderer, 'updateDirectionalShadowCamera') as (
            shadowLight: DirectionalLight,
            mainCamera: PerspectiveCamera
        ) => unknown;

        updateShadowCamera.call(renderer, light, camera);
        updateShadowCamera.call(renderer, light, camera);

        const helpers = light.children.filter(child => child instanceof CameraHelper);
        expect(helpers).toHaveLength(1);
        expect(helpers[0]?.camera).not.toBeNull();
        const ownedCamera = helpers[0]?.camera;
        renderer.destroy();
        expect(light.children).toHaveLength(0);
        expect(ownedCamera?.parent).toBeNull();
        expect(helpers[0]?.isDestroyed).toBe(true);
    });

    it('uses the same canonical point-shadow clipping contract as WebGL2', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const light = new PointLight({
            range: 25,
            shadow: { cameraInfo: { near: 0.25 } }
        });
        const camera = new PerspectiveCamera({ near: 0.1, far: 100 });
        const updatePointShadowCameras = Reflect.get(renderer, 'updatePointShadowCameras') as (
            shadowLight: PointLight,
            mainCamera: PerspectiveCamera
        ) => readonly PerspectiveCamera[];

        const cameras = updatePointShadowCameras.call(renderer, light, camera);
        expect(cameras).toHaveLength(6);
        expect(cameras.every(candidate => candidate.near === 0.25)).toBe(true);
        expect(cameras.every(candidate => candidate.far === 25)).toBe(true);
        expect(cameras.every(candidate => candidate.fov === 90 && candidate.aspect === 1)).toBe(
            true
        );

        if (!light.shadow?.cameraInfo) throw new Error('Expected point shadow cameraInfo');
        light.shadow.cameraInfo.far = 15;
        expect(updatePointShadowCameras.call(renderer, light, camera)).toBe(cameras);
        expect(cameras.every(candidate => candidate.far === 15)).toBe(true);

        Reflect.set(light.shadow.cameraInfo, 'rotationY', 1);
        expect(() => updatePointShadowCameras.call(renderer, light, camera)).toThrow(
            /cannot override the six canonical cube-face cameras/
        );
        renderer.destroy();
    });

    it('writes each shadow-atlas tile viewport through the pass-frequency CameraBlock', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const camera = new PerspectiveCamera({ near: 0.1, far: 100 });
        const beginPass = vi.spyOn(BuiltInUniformBlockManager.prototype, 'beginPass');
        Reflect.set(renderer, 'shadowAtlasGPUTexture', {
            createView: vi.fn(() => ({}) as GPUTextureView),
            destroy: vi.fn()
        } as unknown as GPUTexture);
        const renderShadowSlice = Reflect.get(renderer, 'renderShadowSlice') as (
            slice: {
                readonly camera: PerspectiveCamera;
                readonly logicalIndex: number;
                readonly physicalIndex: number;
            },
            meshes: readonly Mesh[],
            columns: number,
            tileWidth: number,
            tileHeight: number,
            encoder: GPUCommandEncoder
        ) => void;
        const encoder = fake.device.createCommandEncoder({ label: 'test frame' });

        renderShadowSlice.call(
            renderer,
            { camera, logicalIndex: 5, physicalIndex: 3 },
            [],
            2,
            64,
            32,
            encoder
        );

        expect(beginPass.mock.calls.at(-1)?.[0]).toBe(camera);
        expect(beginPass.mock.calls.at(-1)?.[1]).toEqual([64, 32, 64, 32]);
        expect(fake.beginRenderPass).toHaveBeenCalledOnce();
        expect(fake.finish).not.toHaveBeenCalled();
        expect(fake.submit).not.toHaveBeenCalled();
        renderer.destroy();
    });

    it('encodes shadow and main passes into one atomic frame submission', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({
            domElement: fake.canvas,
            width: 32,
            height: 24,
            antialias: false
        });
        await renderer.ready;
        const stage = new Node();
        stage.addChild(
            new DirectionalLight({
                shadow: { width: 8, height: 8 }
            })
        );

        renderer.render(stage, new PerspectiveCamera({ near: 0.1, far: 100 }));

        expect(fake.createCommandEncoder).toHaveBeenCalledOnce();
        expect(fake.beginRenderPass).toHaveBeenCalledTimes(2);
        expect(fake.finish).toHaveBeenCalledOnce();
        expect(fake.submit).toHaveBeenCalledOnce();
        renderer.destroy();
    });

    it('prunes renderer-owned shadow nodes when debug, shadow, or stage membership changes', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const light = new DirectionalLight({
            shadow: { debug: true, cameraInfo: { near: 0.1, far: 10 } }
        });
        const camera = new PerspectiveCamera({ near: 0.1, far: 100 });
        const updateShadowCamera = Reflect.get(renderer, 'updateDirectionalShadowCamera') as (
            shadowLight: DirectionalLight,
            mainCamera: PerspectiveCamera
        ) => unknown;
        const pruneShadowOwners = Reflect.get(renderer, 'pruneShadowOwners') as (
            activeLights: ReadonlySet<DirectionalLight>
        ) => void;

        updateShadowCamera.call(renderer, light, camera);
        const firstHelper = light.children.find(child => child instanceof CameraHelper);
        const firstCamera = firstHelper?.camera;
        if (!light.shadow) throw new Error('Test light requires shadow configuration');
        light.shadow.debug = false;
        pruneShadowOwners.call(renderer, new Set([light]));

        expect(firstHelper?.isDestroyed).toBe(true);
        expect(firstHelper?.parent).toBeNull();
        expect(firstCamera?.parent).toBe(light);

        light.shadow.debug = true;
        updateShadowCamera.call(renderer, light, camera);
        const secondHelper = light.children.find(child => child instanceof CameraHelper);
        expect(secondHelper).not.toBe(firstHelper);
        light.enabled = false;
        pruneShadowOwners.call(renderer, new Set());

        expect(light.children).toHaveLength(0);
        expect(secondHelper?.isDestroyed).toBe(true);
        expect(firstCamera?.parent).toBeNull();

        light.enabled = true;
        updateShadowCamera.call(renderer, light, camera);
        light.shadow = null;
        pruneShadowOwners.call(renderer, new Set());
        expect(light.children).toHaveLength(0);

        light.shadow = { debug: true, cameraInfo: { near: 0.1, far: 10 } };
        updateShadowCamera.call(renderer, light, camera);
        pruneShadowOwners.call(renderer, new Set());
        expect(light.children).toHaveLength(0);
        renderer.destroy();
    });

    it('recreates debug shadow nodes without growing light children after device loss', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const replacement = createFakeGPUDevice();
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockResolvedValueOnce(replacement.device);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const light = new DirectionalLight({
            shadow: { debug: true, cameraInfo: { near: 0.1, far: 10 } }
        });
        const camera = new PerspectiveCamera({ near: 0.1, far: 100 });
        const updateShadowCamera = Reflect.get(renderer, 'updateDirectionalShadowCamera') as (
            shadowLight: DirectionalLight,
            mainCamera: PerspectiveCamera
        ) => unknown;

        updateShadowCamera.call(renderer, light, camera);
        const firstChildren = [...light.children];
        expect(firstChildren).toHaveLength(2);

        fake.lost.resolve({ reason: 'unknown', message: 'shadow owner recovery' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        });
        await renderer.recoveryPromise;

        expect(light.children).toHaveLength(0);
        expect(firstChildren.every(child => child.parent === null)).toBe(true);
        updateShadowCamera.call(renderer, light, camera);
        expect(light.children).toHaveLength(2);
        expect(light.children.every(child => !firstChildren.includes(child))).toBe(true);
        renderer.destroy();
        expect(light.children).toHaveLength(0);
    });

    it('enables every texture-compression feature exposed by the adapter', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const compressionFeatures: readonly GPUFeatureName[] = [
            'texture-compression-bc',
            'texture-compression-etc2',
            'texture-compression-astc'
        ];
        const fake = createFakeWebGPU(compressionFeatures);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });

        await renderer.ready;

        expect(fake.requestDevice).toHaveBeenCalledWith({
            requiredFeatures: compressionFeatures,
            requiredLimits: {}
        });
        expect(renderer.supportsTextureCompression('bc')).toBe(true);
        expect(renderer.supportsTextureCompression('etc1')).toBe(true);
        expect(renderer.supportsTextureCompression('etc2')).toBe(true);
        expect(renderer.supportsTextureCompression('astc-4x4')).toBe(true);
        expect(renderer.supportsTextureCompression('pvrtc')).toBe(false);
        renderer.destroy();
    });

    it('keeps canvas clear color separate from explicit render-target operations', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const clearColor = new Color(0.125, 0.25, 0.5, 0.75);
        const renderer = new WebGPUDriver({
            domElement: fake.canvas,
            antialias: false,
            clearColor
        });
        await renderer.ready;
        const createView = vi.fn(() => ({}) as GPUTextureView);
        const texture = { createView } as unknown as GPUTexture;
        const createDescriptor = Reflect.get(renderer, 'createCanvasRenderPassDescriptor') as (
            currentTexture: GPUTexture
        ) => GPURenderPassDescriptor;

        const descriptor = createDescriptor.call(renderer, texture);

        expect(createView).toHaveBeenCalledOnce();
        expect(descriptor.colorAttachments[0]).toMatchObject({
            clearValue: { r: 0.125, g: 0.25, b: 0.5, a: 0.75 },
            loadOp: 'clear',
            storeOp: 'store'
        });

        const createTargetDescriptor = vi.fn(() => ({
            colorAttachments: []
        })) as unknown as WebGPURenderTarget['createRenderPassDescriptor'];
        const explicitTarget = {
            createRenderPassDescriptor: createTargetDescriptor
        } as unknown as WebGPURenderTarget;
        const createTargetPassDescriptor = Reflect.get(
            renderer,
            'createRenderTargetPassDescriptor'
        ) as (renderTarget: WebGPURenderTarget) => GPURenderPassDescriptor;
        renderer.clearColor.set(0.75, 0.5, 0.25, 1);

        createTargetPassDescriptor.call(renderer, explicitTarget);

        expect(createTargetDescriptor).toHaveBeenCalledWith({
            label: 'Hilo3d scene target'
        });
        renderer.destroy();
    });

    it('remains renderable after public GPU resource release', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const firstTextureManager = Reflect.get(renderer, 'textureManager') as WebGPUTextureManager;
        const target = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        renderer.setRenderTarget(target, { present: true, takeOwnership: true });
        const texturesBeforeRelease = fake.createTexture.mock.calls.length;

        renderer.releaseGPUResources();

        expect(renderer.isReady).toBe(true);
        expect(renderer.recoveryState).toBe('ready');
        expect(renderer.renderTarget).toBeNull();
        expect(target.isDestroyed).toBe(true);
        expect(Reflect.get(renderer, 'textureManager')).toBe(firstTextureManager);
        expect(fake.createTexture.mock.calls.length).toBeGreaterThan(texturesBeforeRelease);
        expect(fake.destroyDevice).not.toHaveBeenCalled();
        expect(fake.unconfigure).not.toHaveBeenCalled();

        renderer.render(new Node(), new PerspectiveCamera());

        expect(fake.beginRenderPass).toHaveBeenCalledOnce();
        expect(fake.submit).toHaveBeenCalledOnce();
        renderer.destroy();
    });

    it('recovers the same selected render target on a replacement device', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const replacement = createFakeGPUDevice();
        const recoveryRequest = deferred<GPUDevice>();
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockReturnValueOnce(recoveryRequest.promise);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const lifecycle: string[] = [];
        const onDeviceLost = vi.fn<(event: DispatchEvent) => void>(() => {
            lifecycle.push(`lost:${String(fake.requestDevice.mock.calls.length)}`);
        });
        const onDeviceRestored = vi.fn<(event: DispatchEvent) => void>(() => {
            lifecycle.push(`restored:${String(fake.requestDevice.mock.calls.length)}`);
        });
        const onRecoveryFailed = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceLost', onDeviceLost);
        renderer.on('webgpuDeviceRestored', onDeviceRestored);
        renderer.on('webgpuDeviceRecoveryFailed', onRecoveryFailed);
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 8,
            height: 4,
            depthStencilAttachment: false
        });
        const textureManager = Reflect.get(renderer, 'textureManager') as WebGPUTextureManager;
        const colorTexture = target.getColorTexture();
        const firstGPUTexture = target.getColorGPUTexture();
        renderer.setRenderTarget(target, { present: true, takeOwnership: true });
        const info: GPUDeviceLostInfo = {
            reason: 'unknown',
            message: 'The test device stopped responding'
        };

        fake.lost.resolve(info);
        await vi.waitFor(() => {
            expect(onDeviceLost).toHaveBeenCalledOnce();
        });

        expect(onDeviceLost.mock.calls[0]?.[0].detail).toBe(info);
        expect(renderer.recoveryState).toBe('recovering');
        expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).not.toHaveBeenCalled();
        expect(renderer.isReady).toBe(false);
        expect(renderer.isInitFailed).toBe(false);
        expect(() => renderer.gpuDevice).toThrow(/not initialized/);
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).not.toThrow();
        expect(replacement.submit).not.toHaveBeenCalled();
        const lostDeviceTextureCreationCount = fake.createTexture.mock.calls.length;
        colorTexture.destroy();
        expect(fake.createTexture).toHaveBeenCalledTimes(lostDeviceTextureCreationCount);

        recoveryRequest.resolve(replacement.device);
        await renderer.recoveryPromise;

        expect(renderer.recoveryState).toBe('ready');
        expect(renderer.isReady).toBe(true);
        expect(renderer.isInitFailed).toBe(false);
        expect(renderer.gpuDevice).toBe(replacement.device);
        expect(renderer.renderTarget).toBe(target);
        expect(Reflect.get(renderer, 'ownsRenderTarget')).toBe(true);
        expect(Reflect.get(renderer, 'autoPresentRenderTarget')).toBe(true);
        expect(target.isDestroyed).toBe(false);
        expect(target.device).toBe(replacement.device);
        expect(target.getColorTexture()).toBe(colorTexture);
        expect(target.getColorGPUTexture()).not.toBe(firstGPUTexture);
        const recoveredTextureManager = Reflect.get(
            renderer,
            'textureManager'
        ) as WebGPUTextureManager;
        expect(recoveredTextureManager).toBe(textureManager);
        expect(recoveredTextureManager.get(colorTexture).gpuTexture).toBe(
            target.getColorGPUTexture()
        );
        expect(onDeviceRestored).toHaveBeenCalledOnce();
        expect(onDeviceRestored.mock.calls[0]?.[0].detail).toBe(replacement.device);
        expect(onRecoveryFailed).not.toHaveBeenCalled();
        expect(lifecycle).toEqual(['lost:1', 'restored:2']);
        expect(fake.configure).toHaveBeenCalledTimes(2);
        expect(fake.configure.mock.calls[1]?.[0]).toMatchObject({
            device: replacement.device,
            format: 'bgra8unorm'
        });
        expect(fake.requestDevice.mock.calls[1]?.[0]).toEqual(
            fake.requestDevice.mock.calls[0]?.[0]
        );
        expect(fake.requestAdapter).toHaveBeenCalledTimes(2);
        expect(fake.requestAdapter.mock.calls[1]?.[0]).toEqual(
            fake.requestAdapter.mock.calls[0]?.[0]
        );

        renderer.setRenderTarget(null);
        expect(target.isDestroyed).toBe(true);
        renderer.destroy();
        renderer.destroy();
        expect(fake.destroyDevice).not.toHaveBeenCalled();
        expect(replacement.destroyDevice).toHaveBeenCalledOnce();
    });

    it('keeps recovery running when a device-lost listener throws', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const replacement = createFakeGPUDevice();
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockResolvedValueOnce(replacement.device);
        const reportError = vi.fn<(error: Error) => void>();
        vi.stubGlobal('reportError', reportError);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const listenerFailure = new Error('device-lost listener failed');
        const onDeviceRestored = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceLost', () => {
            throw listenerFailure;
        });
        renderer.on('webgpuDeviceRestored', onDeviceRestored);
        await renderer.ready;

        fake.lost.resolve({ reason: 'unknown', message: 'listener isolation' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        });
        await renderer.recoveryPromise;
        await vi.waitFor(() => {
            expect(reportError).toHaveBeenCalledOnce();
        });

        const reported = reportError.mock.calls[0]?.[0];
        if (!(reported instanceof Error)) throw new Error('Expected a reported listener error');
        expect(reported.message).toContain('webgpuDeviceLost');
        expect(reported.cause).toBe(listenerFailure);
        expect(renderer.recoveryState).toBe('ready');
        expect(renderer.gpuDevice).toBe(replacement.device);
        expect(onDeviceRestored).toHaveBeenCalledOnce();
        expect(replacement.destroyDevice).not.toHaveBeenCalled();
        renderer.destroy();
    });

    it('keeps a restored device ready when a device-restored listener throws', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const replacement = createFakeGPUDevice();
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockResolvedValueOnce(replacement.device);
        const reportError = vi.fn<(error: Error) => void>();
        vi.stubGlobal('reportError', reportError);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const listenerFailure = new Error('device-restored listener failed');
        renderer.on('webgpuDeviceRestored', () => {
            throw listenerFailure;
        });
        await renderer.ready;

        fake.lost.resolve({ reason: 'unknown', message: 'restored listener isolation' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        });
        await renderer.recoveryPromise;
        await vi.waitFor(() => {
            expect(reportError).toHaveBeenCalledOnce();
        });

        const reported = reportError.mock.calls[0]?.[0];
        if (!(reported instanceof Error)) throw new Error('Expected a reported listener error');
        expect(reported.message).toContain('webgpuDeviceRestored');
        expect(reported.cause).toBe(listenerFailure);
        expect(renderer.recoveryState).toBe('ready');
        expect(renderer.isInitFailed).toBe(false);
        expect(renderer.gpuDevice).toBe(replacement.device);
        expect(replacement.destroyDevice).not.toHaveBeenCalled();
        renderer.destroy();
    });

    it('preserves the original recovery rejection when a recovery-failed listener throws', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const recoveryFailure = new Error('replacement request failed');
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockRejectedValueOnce(recoveryFailure);
        const reportError = vi.fn<(error: Error) => void>();
        vi.stubGlobal('reportError', reportError);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const listenerFailure = new Error('recovery-failed listener failed');
        renderer.on('webgpuDeviceRecoveryFailed', () => {
            throw listenerFailure;
        });
        await renderer.ready;

        fake.lost.resolve({ reason: 'unknown', message: 'failed listener isolation' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        });
        await expect(renderer.recoveryPromise).rejects.toBe(recoveryFailure);
        await vi.waitFor(() => {
            expect(reportError).toHaveBeenCalledOnce();
        });

        const reported = reportError.mock.calls[0]?.[0];
        if (!(reported instanceof Error)) throw new Error('Expected a reported listener error');
        expect(reported.message).toContain('webgpuDeviceRecoveryFailed');
        expect(reported.cause).toBe(listenerFailure);
        expect(renderer.recoveryState).toBe('failed');
        expect(renderer.isInitFailed).toBe(true);
        renderer.destroy();
    });

    it('reuploads a released CPU texture on its first post-recovery binding', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const replacement = createFakeGPUDevice();
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockResolvedValueOnce(replacement.device);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const manager = Reflect.get(renderer, 'textureManager') as WebGPUTextureManager;
        const pixels = new Uint8Array([17, 34, 51, 255]);
        const texture = new Texture({
            width: 1,
            height: 1,
            image: pixels,
            isImageCanRelease: true
        });
        const firstResource = manager.get(texture);

        expect(texture.isImageReleased).toBe(true);
        expect(() => texture.image).toThrow(/has been released/);
        expect(fake.writeTexture).toHaveBeenCalledOnce();

        fake.lost.resolve({ reason: 'unknown', message: 'recover released texture' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        });
        await renderer.recoveryPromise;

        const recoveredManager = Reflect.get(renderer, 'textureManager') as WebGPUTextureManager;
        const recoveredResource = recoveredManager.get(texture);

        expect(recoveredManager).toBe(manager);
        expect(recoveredManager.device).toBe(replacement.device);
        expect(recoveredResource.gpuTexture).not.toBe(firstResource.gpuTexture);
        expect(replacement.writeTexture).toHaveBeenCalledOnce();
        expect(replacement.writeTexture.mock.calls[0]?.[1]).toEqual(pixels);
        expect(texture.isImageReleased).toBe(true);
        expect(() => texture.image).toThrow(/has been released/);
        renderer.destroy();
    });

    it('ignores a device-loss notification from a stale initialization generation', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const onDeviceLost = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceLost', onDeviceLost);
        await renderer.ready;
        const releaseGPUResources = vi.spyOn(renderer, 'releaseGPUResources');
        const generation = Reflect.get(renderer, 'initializationGeneration') as number;
        Reflect.set(renderer, 'initializationGeneration', generation + 1);

        fake.lost.resolve({ reason: 'unknown', message: 'stale loss' });
        await Promise.resolve();
        await Promise.resolve();

        expect(onDeviceLost).not.toHaveBeenCalled();
        expect(releaseGPUResources).not.toHaveBeenCalled();
        expect(fake.unconfigure).not.toHaveBeenCalled();
        expect(renderer.isReady).toBe(true);
        expect(renderer.isInitFailed).toBe(false);
        renderer.destroy();
    });

    it('publishes recovery failure and makes later renders fail explicitly', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const failure = new Error('replacement device request failed');
        fake.requestDevice.mockResolvedValueOnce(fake.device).mockRejectedValueOnce(failure);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const target = await renderer.ready.then(() =>
            renderer.createRenderTarget({ width: 2, height: 2, depthStencilAttachment: false })
        );
        const onRecoveryFailed = vi.fn<(event: DispatchEvent) => void>();
        const onDeviceRestored = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceRecoveryFailed', onRecoveryFailed);
        renderer.on('webgpuDeviceRestored', onDeviceRestored);

        fake.lost.resolve({ reason: 'unknown', message: 'lost before failed recovery' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        });
        await expect(renderer.recoveryPromise).rejects.toBe(failure);

        expect(renderer.recoveryState).toBe('failed');
        expect(renderer.isReady).toBe(false);
        expect(renderer.isInitFailed).toBe(true);
        expect(target.isDestroyed).toBe(false);
        expect(onRecoveryFailed).toHaveBeenCalledOnce();
        expect(onRecoveryFailed.mock.calls[0]?.[0].detail).toBe(failure);
        expect(onDeviceRestored).not.toHaveBeenCalled();
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/device recovery failed.*replacement device request failed/i);

        renderer.destroy();
        expect(target.isDestroyed).toBe(true);
    });

    it('rejects a replacement adapter that no longer satisfies engine limits', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const incompatibleRequestDevice = vi.fn();
        const incompatibleAdapter = {
            features: new Set<GPUFeatureName>(),
            limits: {
                maxBindGroups: 3,
                maxUniformBufferBindingSize: 65_536,
                maxUniformBuffersPerShaderStage: 12
            },
            requestDevice: incompatibleRequestDevice
        } as unknown as GPUAdapter;
        fake.requestAdapter.mockResolvedValueOnce(fake.adapter);
        fake.requestAdapter.mockResolvedValueOnce(incompatibleAdapter);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const onRecoveryFailed = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceRecoveryFailed', onRecoveryFailed);
        await renderer.ready;

        fake.lost.resolve({ reason: 'unknown', message: 'adapter changed' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).toBeInstanceOf(Promise);
        });
        await expect(renderer.recoveryPromise).rejects.toThrow(/fewer than the four/);

        expect(renderer.recoveryState).toBe('failed');
        expect(onRecoveryFailed).toHaveBeenCalledOnce();
        expect(incompatibleRequestDevice).not.toHaveBeenCalled();
        renderer.destroy();
    });

    it('serializes repeated device losses without accepting stale generations', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const firstReplacement = createFakeGPUDevice();
        const secondReplacement = createFakeGPUDevice();
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockResolvedValueOnce(firstReplacement.device)
            .mockResolvedValueOnce(secondReplacement.device);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const onDeviceLost = vi.fn<(event: DispatchEvent) => void>();
        const onDeviceRestored = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceLost', onDeviceLost);
        renderer.on('webgpuDeviceRestored', onDeviceRestored);
        await renderer.ready;

        fake.lost.resolve({ reason: 'unknown', message: 'first loss' });
        await vi.waitFor(() => {
            expect(renderer.recoveryState).toBe('ready');
            expect(renderer.gpuDevice).toBe(firstReplacement.device);
        });
        const firstRecovery = renderer.recoveryPromise;

        firstReplacement.lost.resolve({ reason: 'unknown', message: 'second loss' });
        await vi.waitFor(() => {
            expect(renderer.recoveryPromise).not.toBe(firstRecovery);
        });
        await renderer.recoveryPromise;

        expect(renderer.recoveryState).toBe('ready');
        expect(renderer.gpuDevice).toBe(secondReplacement.device);
        expect(onDeviceLost).toHaveBeenCalledTimes(2);
        expect(onDeviceRestored).toHaveBeenCalledTimes(2);
        expect(fake.requestDevice).toHaveBeenCalledTimes(3);
        expect(fake.destroyDevice).not.toHaveBeenCalled();
        expect(firstReplacement.destroyDevice).not.toHaveBeenCalled();

        renderer.destroy();
        expect(secondReplacement.destroyDevice).toHaveBeenCalledOnce();
    });

    it('cancels an in-flight recovery when explicitly destroyed', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const replacement = createFakeGPUDevice();
        const recoveryRequest = deferred<GPUDevice>();
        fake.requestDevice
            .mockResolvedValueOnce(fake.device)
            .mockReturnValueOnce(recoveryRequest.promise);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const target = renderer.createRenderTarget({
            width: 2,
            height: 2,
            depthStencilAttachment: false
        });
        const manager = Reflect.get(renderer, 'textureManager') as WebGPUTextureManager;
        const texture = new Texture({
            width: 1,
            height: 1,
            image: new Uint8Array([1, 2, 3, 4]),
            isImageCanRelease: true
        });
        manager.get(texture);
        const backings = Reflect.get(manager, 'recoverableBackings') as WeakMap<
            Texture<unknown>,
            unknown
        >;
        expect(backings.has(texture)).toBe(true);
        const onRecoveryFailed = vi.fn<(event: DispatchEvent) => void>();
        const onDeviceRestored = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceRecoveryFailed', onRecoveryFailed);
        renderer.on('webgpuDeviceRestored', onDeviceRestored);

        fake.lost.resolve({ reason: 'unknown', message: 'lost before destroy' });
        await vi.waitFor(() => {
            expect(renderer.recoveryState).toBe('recovering');
        });
        const recovery = renderer.recoveryPromise;
        renderer.destroy();
        expect(renderer.recoveryState).toBe('destroyed');
        expect(target.isDestroyed).toBe(true);
        expect(manager.resourceCount).toBe(0);
        const clearedBackings = Reflect.get(manager, 'recoverableBackings') as WeakMap<
            Texture<unknown>,
            unknown
        >;
        expect(clearedBackings).not.toBe(backings);
        expect(clearedBackings.has(texture)).toBe(false);

        recoveryRequest.resolve(replacement.device);
        await expect(recovery).rejects.toThrow(/recovery was cancelled/i);
        expect(replacement.destroyDevice).toHaveBeenCalledOnce();
        expect(onRecoveryFailed).not.toHaveBeenCalled();
        expect(onDeviceRestored).not.toHaveBeenCalled();
    });

    it('ignores a deferred device-loss notification after explicit destruction', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        const onDeviceLost = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceLost', onDeviceLost);
        await renderer.ready;

        renderer.destroy();
        fake.lost.resolve({
            reason: 'destroyed',
            message: 'explicit destroy'
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(onDeviceLost).not.toHaveBeenCalled();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
        expect(renderer.recoveryState).toBe('destroyed');
        expect(renderer.isReady).toBe(false);
        expect(renderer.isInitFailed).toBe(false);
        renderer.destroy();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
    });

    it('destroys a device that arrives after initialization was cancelled', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const deviceRequest = deferred<GPUDevice>();
        const fake = createFakeWebGPU();
        fake.requestDevice.mockReturnValue(deviceRequest.promise);
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await vi.waitFor(() => {
            expect(fake.requestDevice).toHaveBeenCalledOnce();
        });

        renderer.destroy();
        deviceRequest.resolve(fake.device);

        await expect(renderer.ready).rejects.toThrow(/cancelled/);
        expect(fake.configure).not.toHaveBeenCalled();
        expect(fake.unconfigure).not.toHaveBeenCalled();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
    });

    it('cancels destroy-before-ready without publishing a late initialized device', async () => {
        const translation = deferred<undefined>();
        const initializeTranslator = vi
            .spyOn(NagaShaderTranslator.prototype, 'initialize')
            .mockImplementation(() => translation.promise);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await vi.waitFor(() => {
            expect(initializeTranslator).toHaveBeenCalledOnce();
        });

        renderer.destroy();
        translation.resolve(undefined);

        await expect(renderer.ready).rejects.toThrow(/cancelled/);
        expect(renderer.isReady).toBe(false);
        expect(renderer.isInitFailed).toBe(false);
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
        expect(() => renderer.gpuDevice).toThrow(/not initialized/);
    });

    it('fully releases a configured device when translator initialization rejects', async () => {
        const failure = new Error('Naga initialization failed');
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockRejectedValue(failure);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });

        await expect(renderer.ready).rejects.toBe(failure);
        expect(renderer.isReady).toBe(false);
        expect(renderer.isInitFailed).toBe(true);
        expect(fake.configure).toHaveBeenCalledOnce();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();

        renderer.destroy();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
    });

    it('rejects presentation targets created by another GPU device', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const foreignTarget = {
            device: {} as GPUDevice,
            isDestroyed: false
        } as unknown as WebGPURenderTarget;

        expect(() => {
            renderer.present(foreignTarget);
        }).toThrow(/different device/);
        renderer.destroy();
    });

    it('retires only uncommitted resources when a frame fails', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const stage = new Node();
        const camera = new PerspectiveCamera();
        const mesh = new Mesh({
            geometry: new Geometry(),
            material: new Material(),
            frustumTest: false
        });
        const committed = { id: 'committed', destroy: vi.fn() };
        const incomplete = { id: 'incomplete', destroy: vi.fn() };
        const failure = new Error('render failed');
        stage.addChild(mesh);
        renderer.resourceManager.addMeshResources(mesh, [committed]);
        Reflect.set(renderer, 'renderShadowAtlas', () => {
            renderer.resourceManager.addMeshResources(mesh, [incomplete]);
            throw failure;
        });

        expect(() => {
            renderer.render(stage, camera);
        }).toThrow(failure);

        expect(fake.createCommandEncoder).toHaveBeenCalledOnce();
        expect(fake.finish).not.toHaveBeenCalled();
        expect(fake.submit).not.toHaveBeenCalled();
        expect(renderer.resourceManager.getMeshResources(mesh)).toEqual([committed]);
        expect(renderer.resourceManager.hasNeedDestroyResource).toBe(false);
        expect(committed.destroy).not.toHaveBeenCalled();
        expect(incomplete.destroy).toHaveBeenCalledOnce();
        renderer.destroy();
    });
});

describe('WebGPUDriver optional vertex inputs', () => {
    it('uses stable WebGL-compatible generic values without synthesizing semantics', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const getInterleavedVertexBuffer = vi.fn(
            (
                _owner: object,
                _sources: readonly {
                    readonly geometryData: GeometryData;
                    readonly input: WebGPUVertexInput;
                }[]
            ) => ({
                buffer: {} as GPUBuffer,
                layout: { arrayStride: 36, stepMode: 'vertex' as const, attributes: [] },
                count: 3
            })
        );
        Reflect.set(renderer, 'bufferManager', {
            getInterleavedVertexBuffer,
            destroy: vi.fn()
        });
        const geometry = new Geometry({
            vertices: new GeometryData(new Float32Array(9), 3)
        });
        const material = new Material();
        const mesh = new Mesh({ geometry, material });
        const inputs: readonly WebGPUVertexInput[] = [
            { name: 'a_position', type: 'vec3', location: 0, locationCount: 1 },
            { name: 'a_texcoord0', type: 'vec2', location: 1, locationCount: 1 },
            { name: 'a_color', type: 'vec4', location: 2, locationCount: 1 }
        ];
        const resolve = Reflect.get(renderer, 'resolveVertexBuffers') as (
            meshes: readonly Mesh[],
            activeMaterial: Material,
            vertexInputs: readonly WebGPUVertexInput[],
            useInstanced: boolean
        ) => unknown;

        resolve.call(renderer, [mesh], material, inputs, false);
        resolve.call(renderer, [mesh], material, inputs, false);

        const firstSources = getInterleavedVertexBuffer.mock.calls[0]?.[1];
        const secondSources = getInterleavedVertexBuffer.mock.calls[1]?.[1];
        expect(firstSources?.[1]?.geometryData.size).toBe(2);
        expect(Array.from(firstSources?.[1]?.geometryData.data ?? [])).toEqual([0, 0, 0, 0, 0, 0]);
        expect(Array.from(firstSources?.[2]?.geometryData.data ?? [])).toEqual([
            0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1
        ]);
        expect(secondSources?.[1]?.geometryData).toBe(firstSources?.[1]?.geometryData);
        expect(secondSources?.[2]?.geometryData).toBe(firstSources?.[2]?.geometryData);

        renderer.destroy();
    });

    it('isolates mesh-dependent instance streams by exact batch membership', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const bufferManager = Reflect.get(renderer, 'bufferManager') as WebGPUBufferManager;
        const getInterleavedInstanceBuffer = vi.spyOn(
            bufferManager,
            'getInterleavedInstanceBuffer'
        );
        const geometry = new Geometry({
            vertices: new GeometryData(new Float32Array(9), 3)
        });
        const firstValue = new Float32Array([1, 2, 3, 4]);
        const secondValue = new Float32Array([5, 6, 7, 8]);
        const thirdValue = new Float32Array([9, 10, 11, 12]);
        const material = new Material({
            needBasicAttributes: false,
            needBasicUniforms: false,
            uniforms: {
                u_particleData: {
                    isDependMesh: true,
                    get: mesh => mesh.userData
                }
            }
        });
        const first = new Mesh({ geometry, material, userData: firstValue });
        const second = new Mesh({ geometry, material, userData: secondValue });
        const third = new Mesh({ geometry, material, userData: thirdValue });
        const input: WebGPUVertexInput = {
            name: 'u_particleData',
            type: 'vec4',
            location: 0,
            locationCount: 1
        };
        const getOwner = Reflect.get(renderer, 'getInstanceBatchOwner') as (
            meshes: readonly Mesh[]
        ) => object;
        const resolve = Reflect.get(renderer, 'resolveVertexBuffers') as (
            meshes: readonly Mesh[],
            activeMaterial: Material,
            vertexInputs: readonly WebGPUVertexInput[],
            useInstanced: boolean,
            instanceBatchOwner: object
        ) => readonly WebGPUVertexBufferBinding[];
        const firstBatch = [first, second];
        const secondBatch = [first, third];
        const firstOwner = getOwner.call(renderer, firstBatch);
        const secondOwner = getOwner.call(renderer, secondBatch);

        expect(secondOwner).not.toBe(firstOwner);
        expect(getOwner.call(renderer, firstBatch)).toBe(firstOwner);
        bufferManager.beginSubmission();
        try {
            const firstBinding = resolve.call(
                renderer,
                firstBatch,
                material,
                [input],
                true,
                firstOwner
            );
            const secondBinding = resolve.call(
                renderer,
                secondBatch,
                material,
                [input],
                true,
                secondOwner
            );
            const repeatedBinding = resolve.call(
                renderer,
                firstBatch,
                material,
                [input],
                true,
                firstOwner
            );

            expect(secondBinding[0]?.buffer).not.toBe(firstBinding[0]?.buffer);
            expect(repeatedBinding[0]?.buffer).toBe(firstBinding[0]?.buffer);
        } finally {
            bufferManager.endSubmission();
        }

        expect(getInterleavedInstanceBuffer).toHaveBeenCalledTimes(3);
        const call = getInterleavedInstanceBuffer.mock.calls[0];
        expect(call?.[0]).toBe(firstOwner);
        expect(call?.[1]).toBe(2);
        expect(call?.[2]?.[0]?.getValue(0)).toBe(firstValue);
        expect(call?.[2]?.[0]?.getValue(1)).toBe(secondValue);
        renderer.destroy();
    });
});

describe('WebGPUDriver primitive topology normalization', () => {
    it('normalizes TRIANGLE_FAN before shader and pipeline setup', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const geometry = new Geometry({
            mode: TRIANGLE_FAN,
            vertices: new GeometryData(new Float32Array(12), 3)
        });
        const mesh = new Mesh({ geometry, material: new Material() });
        const stopAfterNormalization = new Error('stop after topology normalization');
        vi.spyOn(Shader, 'getShader').mockImplementationOnce(() => {
            throw stopAfterNormalization;
        });

        try {
            expect(() => {
                renderer.renderMesh(mesh, true);
            }).toThrow(stopAfterNormalization);
            expect(geometry.mode).toBe(TRIANGLES);
            expect(geometry.indices?.data).toBeInstanceOf(Uint8Array);
            expect(Array.from(geometry.indices?.data ?? [])).toEqual([0, 1, 2, 0, 2, 3]);
        } finally {
            renderer.destroy();
        }
    });
});

describe('WebGPUDriver indexed strips', () => {
    it('handles sparse MRT outputs, Uint8 strips and surviving shared instance batches', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPUDriver({ domElement: fake.canvas });
        await renderer.ready;
        const shader = new Shader({ vs: 'vertex', fs: 'fragment' });
        vi.spyOn(Shader, 'getShader').mockReturnValue(shader);
        const translated: TranslatedShaderPair = {
            vertex: { glsl: '', wgsl: '' },
            fragment: { glsl: '', wgsl: '' },
            vertexInputs: [{ name: 'a_position', type: 'vec3', location: 0, locationCount: 1 }],
            fragmentOutputs: [
                { name: 'albedo', type: 'vec4', location: 0 },
                { name: 'emissive', type: 'vec4', location: 2 }
            ],
            uniformBlocks: [],
            samplers: []
        };
        const translator = Reflect.get(renderer, 'translator') as NagaShaderTranslator;
        vi.spyOn(translator, 'translate').mockReturnValue(translated);
        const getIndexBuffer = vi.fn(() => ({
            buffer: {} as GPUBuffer,
            format: 'uint16' as const,
            count: 3
        }));
        const bufferManager = {
            getInterleavedVertexBuffer: vi.fn(() => ({
                buffer: {} as GPUBuffer,
                layout: {
                    arrayStride: 12,
                    stepMode: 'vertex' as const,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' as const }]
                },
                count: 3
            })),
            getIndexBuffer,
            releaseOwner: vi.fn(),
            destroy: vi.fn()
        };
        const getPipelineSync = vi.fn((_request: WebGPURenderPipelineRequest) => {
            return {} as GPURenderPipeline;
        });
        Reflect.set(renderer, 'bufferManager', bufferManager);
        Reflect.set(renderer, 'bindGroupManager', {
            getLayout: vi.fn(() => ({
                signature: 'empty',
                bindGroupLayouts: [],
                pipelineLayout: {} as GPUPipelineLayout
            })),
            getBindGroups: vi.fn(() => []),
            clear: vi.fn()
        });
        Reflect.set(renderer, 'pipelineManager', {
            getPipelineSync,
            clear: vi.fn()
        });
        vi.spyOn(
            Reflect.get(renderer, 'uniformBlockManager') as {
                getUniformBlocks: () => Readonly<Record<string, never>>;
            },
            'getUniformBlocks'
        ).mockReturnValue({});
        const drawIndexed = vi.fn();
        const pass = {
            setPipeline: vi.fn(),
            setBindGroup: vi.fn(),
            setVertexBuffer: vi.fn(),
            setIndexBuffer: vi.fn(),
            setViewport: vi.fn(),
            drawIndexed
        } as unknown as GPURenderPassEncoder;
        Reflect.set(renderer, 'activePass', pass);
        Reflect.set(renderer, 'activeDrawTarget', {
            colorFormats: ['rgba8unorm', 'rgba16float', 'rgba32float'],
            depthStencilFormat: 'depth24plus',
            depthTestEnabled: true,
            stencilTestEnabled: false,
            sampleCount: 1
        });
        const indices = new GeometryData(new Uint8Array([0, 1, 0xff]), 1);
        const geometry = new Geometry({
            mode: LINE_STRIP,
            vertices: new GeometryData(new Float32Array(9), 3),
            indices
        });
        const material = new Material();
        const mesh = new Mesh({ geometry, material });
        const second = new Mesh({ geometry, material });
        const third = new Mesh({ geometry, material });
        const root = new Node();
        root.addChild(mesh);
        root.addChild(second);
        root.addChild(third);

        renderer.renderMesh(mesh, true);

        expect(getIndexBuffer).toHaveBeenCalledWith(indices, { primitiveRestart: true });
        expect(getPipelineSync.mock.calls[0]?.[0].renderState.primitive).toMatchObject({
            topology: 'line-strip',
            stripIndexFormat: 'uint16'
        });
        expect(getPipelineSync.mock.calls[0]?.[0].renderState.colorTargets).toEqual([
            { format: 'rgba8unorm', writeMask: 0xf },
            null,
            { format: 'rgba32float', writeMask: 0xf }
        ]);
        renderer.renderInstancedMeshes([mesh, second, third], true);
        mesh.destroy(renderer);
        renderer.resourceManager.destroyUnusedResource(root);
        expect(bufferManager.releaseOwner).not.toHaveBeenCalled();

        expect(() => {
            renderer.renderInstancedMeshes([second, third], true);
        }).not.toThrow();
        expect(drawIndexed).toHaveBeenCalledTimes(3);
        Reflect.set(renderer, 'activePass', null);
        Reflect.set(renderer, 'activeDrawTarget', null);
        renderer.destroy();
    });
});
