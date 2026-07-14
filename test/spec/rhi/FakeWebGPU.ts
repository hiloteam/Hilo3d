import { vi, type Mock } from 'vitest';
import type { RHIFeatureName } from '../../../src/rhi/RHI';

export interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}

export interface FakeGPUBufferRecord {
    readonly buffer: GPUBuffer;
    readonly descriptor: GPUBufferDescriptor;
    readonly storage: ArrayBuffer;
    readonly mapAsync: Mock;
    readonly getMappedRange: Mock;
    readonly unmap: Mock;
    readonly destroy: Mock;
}

export interface FakeGPUTextureRecord {
    readonly texture: GPUTexture;
    readonly descriptor: GPUTextureDescriptor;
    readonly createView: Mock;
    readonly destroy: Mock;
    readonly views: GPUTextureView[];
}

export interface FakeGPURenderPassRecord {
    readonly pass: GPURenderPassEncoder;
    readonly descriptor: GPURenderPassDescriptor;
    readonly setPipeline: Mock;
    readonly setBindGroup: Mock;
    readonly setVertexBuffer: Mock;
    readonly setIndexBuffer: Mock;
    readonly setViewport: Mock;
    readonly setScissorRect: Mock;
    readonly setBlendConstant: Mock;
    readonly setStencilReference: Mock;
    readonly draw: Mock;
    readonly drawIndexed: Mock;
    readonly end: Mock;
}

export interface FakeGPUCommandEncoderRecord {
    readonly encoder: GPUCommandEncoder;
    readonly descriptor: GPUCommandEncoderDescriptor | undefined;
    readonly passes: FakeGPURenderPassRecord[];
    readonly beginRenderPass: Mock;
    readonly copyBufferToBuffer: Mock;
    readonly copyTextureToBuffer: Mock;
    readonly copyBufferToTexture: Mock;
    readonly copyTextureToTexture: Mock;
    readonly finish: Mock;
}

export interface FakeWebGPU {
    readonly canvas: HTMLCanvasElement;
    readonly gpu: GPU;
    readonly context: GPUCanvasContext;
    readonly adapter: GPUAdapter;
    readonly device: GPUDevice;
    readonly queue: GPUQueue;
    readonly requestAdapter: Mock;
    readonly requestDevice: Mock;
    readonly configure: Mock;
    readonly unconfigure: Mock;
    readonly getCurrentTexture: Mock;
    readonly destroyDevice: Mock;
    readonly addEventListener: Mock;
    readonly submit: Mock;
    readonly writeBuffer: Mock;
    readonly writeTexture: Mock;
    readonly copyExternalImageToTexture: Mock;
    readonly onSubmittedWorkDone: Mock;
    readonly createBuffer: Mock;
    readonly createTexture: Mock;
    readonly createSampler: Mock;
    readonly createShaderModule: Mock;
    readonly createBindGroupLayout: Mock;
    readonly createPipelineLayout: Mock;
    readonly createBindGroup: Mock;
    readonly createRenderPipeline: Mock;
    readonly createRenderPipelineAsync: Mock;
    readonly createCommandEncoder: Mock;
    readonly bufferRecords: FakeGPUBufferRecord[];
    readonly textureRecords: FakeGPUTextureRecord[];
    readonly commandEncoderRecords: FakeGPUCommandEncoderRecord[];
    readonly lost: Deferred<GPUDeviceLostInfo>;
}

export function deferred<T>(): Deferred<T> {
    let resolvePromise: ((value: T) => void) | undefined;
    const promise = new Promise<T>(resolve => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: value => resolvePromise?.(value)
    };
}

const limits = {
    maxTextureDimension1D: 8192,
    maxTextureDimension2D: 8192,
    maxTextureDimension3D: 2048,
    maxTextureArrayLayers: 256,
    maxBindGroups: 4,
    maxBindingsPerBindGroup: 1000,
    maxDynamicUniformBuffersPerPipelineLayout: 8,
    maxSampledTexturesPerShaderStage: 16,
    maxSamplersPerShaderStage: 16,
    maxUniformBuffersPerShaderStage: 12,
    maxStorageBuffersPerShaderStage: 8,
    maxStorageTexturesPerShaderStage: 4,
    maxStorageBufferBindingSize: 134_217_728,
    minStorageBufferOffsetAlignment: 256,
    maxUniformBufferBindingSize: 65_536,
    maxVertexBuffers: 8,
    maxBufferSize: 268_435_456,
    maxVertexAttributes: 16,
    maxVertexBufferArrayStride: 2048,
    minUniformBufferOffsetAlignment: 256,
    maxColorAttachments: 8
} as unknown as GPUSupportedLimits;

function createPassRecord(descriptor: GPURenderPassDescriptor): FakeGPURenderPassRecord {
    const setPipeline = vi.fn();
    const setBindGroup = vi.fn();
    const setVertexBuffer = vi.fn();
    const setIndexBuffer = vi.fn();
    const setViewport = vi.fn();
    const setScissorRect = vi.fn();
    const setBlendConstant = vi.fn();
    const setStencilReference = vi.fn();
    const draw = vi.fn();
    const drawIndexed = vi.fn();
    const end = vi.fn();
    const pass = {
        setPipeline,
        setBindGroup,
        setVertexBuffer,
        setIndexBuffer,
        setViewport,
        setScissorRect,
        setBlendConstant,
        setStencilReference,
        draw,
        drawIndexed,
        end
    } as unknown as GPURenderPassEncoder;
    return {
        pass,
        descriptor,
        setPipeline,
        setBindGroup,
        setVertexBuffer,
        setIndexBuffer,
        setViewport,
        setScissorRect,
        setBlendConstant,
        setStencilReference,
        draw,
        drawIndexed,
        end
    };
}

export function createFakeWebGPU(features: readonly RHIFeatureName[] = []): FakeWebGPU {
    const bufferRecords: FakeGPUBufferRecord[] = [];
    const textureRecords: FakeGPUTextureRecord[] = [];
    const commandEncoderRecords: FakeGPUCommandEncoderRecord[] = [];
    const lost = deferred<GPUDeviceLostInfo>();

    const submit = vi.fn();
    const writeBuffer = vi.fn();
    const writeTexture = vi.fn();
    const copyExternalImageToTexture = vi.fn();
    const onSubmittedWorkDone = vi.fn(() => Promise.resolve());
    const queue = {
        submit,
        writeBuffer,
        writeTexture,
        copyExternalImageToTexture,
        onSubmittedWorkDone
    } as unknown as GPUQueue;

    const createBuffer = vi.fn((descriptor: GPUBufferDescriptor) => {
        const storage = new ArrayBuffer(descriptor.size);
        let mapState: GPUBufferMapState = descriptor.mappedAtCreation ? 'mapped' : 'unmapped';
        const mapAsync = vi.fn(() => {
            mapState = 'mapped';
            return Promise.resolve();
        });
        const getMappedRange = vi.fn<(offset?: number, size?: number) => ArrayBuffer>(
            (offset = 0, size: number = storage.byteLength - offset) =>
                storage.slice(offset, offset + size)
        );
        const unmap = vi.fn(() => {
            mapState = 'unmapped';
        });
        const destroy = vi.fn(() => {
            mapState = 'unmapped';
        });
        const buffer = {
            get mapState() {
                return mapState;
            },
            mapAsync,
            getMappedRange,
            unmap,
            destroy
        } as unknown as GPUBuffer;
        bufferRecords.push({
            buffer,
            descriptor,
            storage,
            mapAsync,
            getMappedRange,
            unmap,
            destroy
        });
        return buffer;
    });

    const createTexture = vi.fn((descriptor: GPUTextureDescriptor) => {
        const views: GPUTextureView[] = [];
        const createView = vi.fn((viewDescriptor?: GPUTextureViewDescriptor) => {
            const view = { descriptor: viewDescriptor } as unknown as GPUTextureView;
            views.push(view);
            return view;
        });
        const destroy = vi.fn();
        const texture = { createView, destroy } as unknown as GPUTexture;
        textureRecords.push({ texture, descriptor, createView, destroy, views });
        return texture;
    });
    const createSampler = vi.fn((descriptor?: GPUSamplerDescriptor) => ({
        descriptor
    }));
    const createShaderModule = vi.fn((descriptor: GPUShaderModuleDescriptor) => ({
        descriptor
    }));
    const createBindGroupLayout = vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => ({
        descriptor
    }));
    const createPipelineLayout = vi.fn((descriptor: GPUPipelineLayoutDescriptor) => ({
        descriptor
    }));
    const createBindGroup = vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor }));
    const createRenderPipeline = vi.fn((descriptor: GPURenderPipelineDescriptor) => ({
        descriptor,
        getBindGroupLayout: vi.fn((index: number) => ({ index }))
    }));
    const createRenderPipelineAsync = vi.fn((descriptor: GPURenderPipelineDescriptor) =>
        Promise.resolve(createRenderPipeline(descriptor))
    );

    const createCommandEncoder = vi.fn((descriptor?: GPUCommandEncoderDescriptor) => {
        const passes: FakeGPURenderPassRecord[] = [];
        const beginRenderPass = vi.fn((passDescriptor: GPURenderPassDescriptor) => {
            const record = createPassRecord(passDescriptor);
            passes.push(record);
            return record.pass;
        });
        const copyBufferToBuffer = vi.fn();
        const copyTextureToBuffer = vi.fn();
        const copyBufferToTexture = vi.fn();
        const copyTextureToTexture = vi.fn();
        const finish = vi.fn((finishDescriptor?: GPUCommandBufferDescriptor) => ({
            descriptor: finishDescriptor,
            encoderIndex: commandEncoderRecords.length
        }));
        const encoder = {
            beginRenderPass,
            copyBufferToBuffer,
            copyTextureToBuffer,
            copyBufferToTexture,
            copyTextureToTexture,
            finish
        } as unknown as GPUCommandEncoder;
        commandEncoderRecords.push({
            encoder,
            descriptor,
            passes,
            beginRenderPass,
            copyBufferToBuffer,
            copyTextureToBuffer,
            copyBufferToTexture,
            copyTextureToTexture,
            finish
        });
        return encoder;
    });

    const destroyDevice = vi.fn();
    const addEventListener = vi.fn();
    const device = {
        features: new Set(features),
        limits,
        queue,
        lost: lost.promise,
        createBuffer,
        createTexture,
        createSampler,
        createShaderModule,
        createBindGroupLayout,
        createPipelineLayout,
        createBindGroup,
        createRenderPipeline,
        createRenderPipelineAsync,
        createCommandEncoder,
        addEventListener,
        destroy: destroyDevice
    } as unknown as GPUDevice;
    const requestDevice = vi.fn(() => Promise.resolve(device));
    const adapter = {
        features: new Set(features),
        limits,
        requestDevice
    } as unknown as GPUAdapter;
    const requestAdapter = vi.fn(() => Promise.resolve(adapter));
    const gpu = {
        requestAdapter,
        getPreferredCanvasFormat: vi.fn(() => 'bgra8unorm')
    } as unknown as GPU;
    vi.stubGlobal('navigator', { gpu });

    const configure = vi.fn();
    const unconfigure = vi.fn();
    const getCurrentTexture = vi.fn(() => {
        const createView = vi.fn(() => ({}) as GPUTextureView);
        return { createView, destroy: vi.fn() } as unknown as GPUTexture;
    });
    const context = { configure, unconfigure, getCurrentTexture } as unknown as GPUCanvasContext;
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getContext', {
        configurable: true,
        value: vi.fn((contextId: string) => (contextId === 'webgpu' ? context : null))
    });

    return {
        canvas,
        gpu,
        context,
        adapter,
        device,
        queue,
        requestAdapter,
        requestDevice,
        configure,
        unconfigure,
        getCurrentTexture,
        destroyDevice,
        addEventListener,
        submit,
        writeBuffer,
        writeTexture,
        copyExternalImageToTexture,
        onSubmittedWorkDone,
        createBuffer,
        createTexture,
        createSampler,
        createShaderModule,
        createBindGroupLayout,
        createPipelineLayout,
        createBindGroup,
        createRenderPipeline,
        createRenderPipelineAsync,
        createCommandEncoder,
        bufferRecords,
        textureRecords,
        commandEncoderRecords,
        lost
    };
}
