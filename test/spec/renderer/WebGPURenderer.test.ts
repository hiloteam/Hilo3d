import { afterEach, describe, expect, it, vi } from 'vitest';
import PerspectiveCamera from '../../../src/camera/PerspectiveCamera';
import type { DispatchEvent } from '../../../src/core/EventDispatcher';
import Geometry from '../../../src/geometry/Geometry';
import GeometryData from '../../../src/geometry/GeometryData';
import Material from '../../../src/material/Material';
import Mesh from '../../../src/core/Mesh';
import Node from '../../../src/core/Node';
import { LINE_STRIP } from '../../../src/constants/webgl';
import Shader from '../../../src/shader/Shader';
import { NagaShaderTranslator, type TranslatedShaderPair } from '../../../src/shader/GlslToWgsl';
import WebGPURenderer from '../../../src/renderer/WebGPURenderer';
import type { WebGPURenderPipelineRequest } from '../../../src/renderer/webgpu/WebGPUPipelineManager';
import type WebGPURenderTarget from '../../../src/renderer/webgpu/WebGPURenderTarget';
import { WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE } from '../../../src/renderer/webgpu/WgslUniformLayout';
import { testEnv } from '../../setup';

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
}

interface FakeWebGPU {
    readonly canvas: HTMLCanvasElement;
    readonly context: GPUCanvasContext;
    readonly configure: ReturnType<typeof vi.fn>;
    readonly unconfigure: ReturnType<typeof vi.fn>;
    readonly device: GPUDevice;
    readonly destroyDevice: ReturnType<typeof vi.fn>;
    readonly createShaderModule: ReturnType<typeof vi.fn>;
    readonly lost: Deferred<GPUDeviceLostInfo>;
    readonly requestDevice: ReturnType<
        typeof vi.fn<(descriptor?: GPUDeviceDescriptor) => Promise<GPUDevice>>
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

function createFakeWebGPU(): FakeWebGPU {
    const configure = vi.fn();
    const unconfigure = vi.fn();
    const context = {
        configure,
        unconfigure,
        getCurrentTexture: vi.fn()
    } as unknown as GPUCanvasContext;
    const destroyDevice = vi.fn();
    const lost = deferred<GPUDeviceLostInfo>();
    const createShaderModule = vi.fn(() => ({}) as GPUShaderModule);
    const createTexture = vi.fn(() => {
        return {
            createView: vi.fn(() => ({}) as GPUTextureView),
            destroy: vi.fn()
        } as unknown as GPUTexture;
    });
    const device = {
        features: new Set<GPUFeatureName>(),
        limits: {
            maxUniformBufferBindingSize: 65_536,
            maxBufferSize: 1_048_576,
            maxBindGroups: 4,
            maxUniformBuffersPerShaderStage: 12,
            maxTextureDimension2D: 4096
        },
        queue: { writeBuffer: vi.fn(), submit: vi.fn() },
        createTexture,
        createShaderModule,
        addEventListener: vi.fn(),
        lost: lost.promise,
        destroy: destroyDevice
    } as unknown as GPUDevice;
    const requestDevice = vi
        .fn<(descriptor?: GPUDeviceDescriptor) => Promise<GPUDevice>>()
        .mockResolvedValue(device);
    const adapter = {
        features: new Set<GPUFeatureName>(),
        limits: {
            maxBindGroups: 4,
            maxUniformBufferBindingSize: 65_536,
            maxUniformBuffersPerShaderStage: 12
        },
        requestDevice
    } as unknown as GPUAdapter;
    const gpu = {
        wgslLanguageFeatures: new Set([WGSL_UNIFORM_BUFFER_STANDARD_LAYOUT_FEATURE]),
        requestAdapter: vi.fn().mockResolvedValue(adapter),
        getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm')
    } as unknown as GPU;
    vi.stubGlobal('navigator', { gpu });
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: vi.fn((contextId: string) => (contextId === 'webgpu' ? context : null))
    });
    return {
        canvas,
        context,
        configure,
        unconfigure,
        device,
        destroyDevice,
        createShaderModule,
        lost,
        requestDevice
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Shader.init(testEnv.renderer);
});

describe('WebGPURenderer initialization lifecycle', () => {
    it('fully retires device state after an asynchronous device loss', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
        const onDeviceLost = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceLost', onDeviceLost);
        await renderer.ready;
        const releaseGPUResources = vi.spyOn(renderer, 'releaseGPUResources');
        const info: GPUDeviceLostInfo = {
            reason: 'unknown',
            message: 'The test device stopped responding'
        };

        fake.lost.resolve(info);
        await vi.waitFor(() => {
            expect(onDeviceLost).toHaveBeenCalledOnce();
        });

        expect(onDeviceLost.mock.calls[0]?.[0].detail).toBe(info);
        expect(releaseGPUResources).toHaveBeenCalledOnce();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).not.toHaveBeenCalled();
        expect(renderer.isReady).toBe(false);
        expect(renderer.isInitFailed).toBe(true);
        expect(() => renderer.gpuDevice).toThrow(/not initialized/);
        expect(() => {
            renderer.render(new Node(), new PerspectiveCamera());
        }).toThrow(/device was lost.*stopped responding/i);

        renderer.destroy();
        renderer.destroy();
        expect(releaseGPUResources).toHaveBeenCalledOnce();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).not.toHaveBeenCalled();
    });

    it('ignores a device-loss notification from a stale initialization generation', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
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

    it('ignores a deferred device-loss notification after explicit destruction', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
        const onDeviceLost = vi.fn<(event: DispatchEvent) => void>();
        renderer.on('webgpuDeviceLost', onDeviceLost);
        await renderer.ready;
        const releaseGPUResources = vi.spyOn(renderer, 'releaseGPUResources');

        renderer.destroy();
        fake.lost.resolve({
            reason: 'destroyed',
            message: 'explicit destroy'
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(onDeviceLost).not.toHaveBeenCalled();
        expect(releaseGPUResources).toHaveBeenCalledOnce();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
        expect(renderer.isReady).toBe(false);
        expect(renderer.isInitFailed).toBe(false);
        renderer.destroy();
        expect(releaseGPUResources).toHaveBeenCalledOnce();
        expect(fake.unconfigure).toHaveBeenCalledOnce();
        expect(fake.destroyDevice).toHaveBeenCalledOnce();
    });

    it('destroys a device that arrives after initialization was cancelled', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const deviceRequest = deferred<GPUDevice>();
        const fake = createFakeWebGPU();
        fake.requestDevice.mockReturnValue(deviceRequest.promise);
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
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
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
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
        const renderer = new WebGPURenderer({ domElement: fake.canvas });

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
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
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
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
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

        expect(renderer.resourceManager.getMeshResources(mesh)).toEqual([committed]);
        expect(renderer.resourceManager.hasNeedDestroyResource).toBe(false);
        expect(committed.destroy).not.toHaveBeenCalled();
        expect(incomplete.destroy).toHaveBeenCalledOnce();
        renderer.destroy();
    });
});

describe('WebGPURenderer indexed strips', () => {
    it('handles Uint8 line strips and keeps shared instance batches after the first mesh dies', async () => {
        vi.spyOn(NagaShaderTranslator.prototype, 'initialize').mockResolvedValue(undefined);
        const fake = createFakeWebGPU();
        const renderer = new WebGPURenderer({ domElement: fake.canvas });
        await renderer.ready;
        const shader = new Shader({ vs: 'vertex', fs: 'fragment' });
        vi.spyOn(Shader, 'getShader').mockReturnValue(shader);
        const translated: TranslatedShaderPair = {
            vertex: { glsl: '', wgsl: '' },
            fragment: { glsl: '', wgsl: '' },
            vertexInputs: [{ name: 'a_position', type: 'vec3', location: 0, locationCount: 1 }],
            fragmentOutputs: [{ name: 'outputColor', type: 'vec4', location: 0 }],
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
        renderer.renderInstancedMeshes([mesh, second, third], true);
        mesh.destroy(renderer);
        renderer.resourceManager.destroyUnusedResource(root);
        expect(bufferManager.releaseOwner).not.toHaveBeenCalled();

        expect(() => {
            renderer.renderInstancedMeshes([second, third], true);
        }).not.toThrow();
        expect(drawIndexed).toHaveBeenCalledTimes(3);
        Reflect.set(renderer, 'activePass', null);
        renderer.destroy();
    });
});
