import { describe, expect, it, vi } from 'vitest';
import {
    RHIBufferUsage,
    RHIShaderStage,
    RHITextureUsage
} from '../../../../src/render/rhi/core/RHITypes';
import type { RHIRenderPassDepthStencilAttachment } from '../../../../src/render/rhi/core/RHICommands';
import type {
    RHIDepthStencilState,
    RHIGraphicsPipeline
} from '../../../../src/render/rhi/core/RHIPipeline';
import { RHIValidationError } from '../../../../src/render/rhi/core/RHIValidation';
import { RendererDiagnostics } from '../../../../src/render/RendererDiagnostics';
import { ShaderArtifactCompiler } from '../../../../src/render/renderer/ShaderArtifactCompiler';
import { prepareWebGPUMipmapShaderArtifacts } from '../../../../src/render/renderer/WebGPUMipmapShader';
import {
    WebGPUBuffer,
    WebGPUDevice,
    WebGPUTexture
} from '../../../../src/render/rhi/backends/webgpu';
import { createStructuredWebGPUMock } from './StructuredWebGPUMock';

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
    reject(reason: unknown): void;
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

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function extentNumber(extent: GPUExtent3D, property: string, fallback: number): number {
    const value: unknown = Reflect.get(extent, property);
    return typeof value === 'number' ? value : fallback;
}

interface NativeUploadMapRequest {
    readonly buffer: GPUBuffer;
    readonly settled: boolean;
    resolve(): void;
    reject(reason: unknown): void;
}

interface NativeHarnessOptions {
    readonly deferUploadMaps?: boolean;
}

interface NativeHarness {
    readonly device: GPUDevice;
    readonly log: string[];
    readonly bufferDescriptors: GPUBufferDescriptor[];
    readonly textureDescriptors: GPUTextureDescriptor[];
    readonly textureViewDescriptors: GPUTextureViewDescriptor[];
    readonly pipelineDescriptors: GPURenderPipelineDescriptor[];
    readonly renderPassDescriptors: GPURenderPassDescriptor[];
    readonly renderPassCalls: { readonly name: string; readonly args: readonly unknown[] }[];
    readonly bufferWrites: readonly {
        readonly destination: GPUBuffer;
        readonly destinationOffset: number;
        readonly data: AllowSharedBufferSource;
        readonly dataOffset: number;
        readonly size: number | undefined;
    }[];
    readonly surfaceConfigurations: GPUCanvasConfiguration[];
    readonly textureCopyExtents: GPUExtent3D[];
    readonly textureCopySources: GPUTexelCopyBufferInfo[];
    readonly textureCopyDestinations: GPUTexelCopyTextureInfo[];
    readonly canvas: HTMLCanvasElement;
    readonly externalCopies: readonly [
        GPUCopyExternalImageSourceInfo,
        GPUCopyExternalImageDestInfo,
        GPUExtent3D
    ][];
    readonly submittedCommandBufferLists: readonly (readonly GPUCommandBuffer[])[];
    readonly uploadBuffers: readonly GPUBuffer[];
    readonly uploadMapRequests: readonly NativeUploadMapRequest[];
    getBufferBytes(label: string): Uint8Array;
    getBufferBytesForHandle(buffer: GPUBuffer): Uint8Array;
    failNextEncoderFinish(reason?: unknown): void;
    failNextSubmit(reason?: unknown): void;
    resolveWork(): void;
    loseDevice(message?: string): void;
}

function createNativeHarness(options: NativeHarnessOptions = {}): NativeHarness {
    const log: string[] = [];
    const bufferDescriptors: GPUBufferDescriptor[] = [];
    const textureDescriptors: GPUTextureDescriptor[] = [];
    const textureViewDescriptors: GPUTextureViewDescriptor[] = [];
    const pipelineDescriptors: GPURenderPipelineDescriptor[] = [];
    const renderPassDescriptors: GPURenderPassDescriptor[] = [];
    const renderPassCalls: { readonly name: string; readonly args: readonly unknown[] }[] = [];
    const bufferWrites: {
        readonly destination: GPUBuffer;
        readonly destinationOffset: number;
        readonly data: AllowSharedBufferSource;
        readonly dataOffset: number;
        readonly size: number | undefined;
    }[] = [];
    const surfaceConfigurations: GPUCanvasConfiguration[] = [];
    const textureCopyExtents: GPUExtent3D[] = [];
    const textureCopySources: GPUTexelCopyBufferInfo[] = [];
    const textureCopyDestinations: GPUTexelCopyTextureInfo[] = [];
    const externalCopies: [
        GPUCopyExternalImageSourceInfo,
        GPUCopyExternalImageDestInfo,
        GPUExtent3D
    ][] = [];
    const submittedCommandBufferLists: (readonly GPUCommandBuffer[])[] = [];
    const uploadBuffers: GPUBuffer[] = [];
    const uploadMapRequests: NativeUploadMapRequest[] = [];
    const bufferStorage = new Map<string, ArrayBuffer>();
    const bufferStorageByHandle = new WeakMap<object, ArrayBuffer>();
    const work = deferred<undefined>();
    const lost = deferred<GPUDeviceLostInfo>();
    let nextEncoderFinishFailure: { readonly reason: unknown } | null = null;
    let nextSubmitFailure: { readonly reason: unknown } | null = null;

    function createBuffer(descriptor: GPUBufferDescriptor): GPUBuffer {
        bufferDescriptors.push(descriptor);
        log.push(`createBuffer:${descriptor.label ?? ''}`);
        const storage = new ArrayBuffer(descriptor.size);
        bufferStorage.set(descriptor.label ?? '', storage);
        let mapState: GPUBufferMapState =
            descriptor.mappedAtCreation === true ? 'mapped' : 'unmapped';
        const buffer: GPUBuffer = {
            label: descriptor.label ?? '',
            size: descriptor.size,
            usage: descriptor.usage,
            get mapState() {
                return mapState;
            },
            mapAsync: () => {
                log.push('buffer.mapAsync');
                if (
                    descriptor.label === 'WebGPU upload arena' &&
                    options.deferUploadMaps === true
                ) {
                    mapState = 'pending';
                    const controlled = deferred<undefined>();
                    let settled = false;
                    const request: NativeUploadMapRequest = {
                        buffer,
                        get settled() {
                            return settled;
                        },
                        resolve: () => {
                            if (settled) return;
                            settled = true;
                            mapState = 'mapped';
                            controlled.resolve(undefined);
                        },
                        reject: reason => {
                            if (settled) return;
                            settled = true;
                            mapState = 'unmapped';
                            controlled.reject(reason);
                        }
                    };
                    uploadMapRequests.push(request);
                    return controlled.promise;
                }
                mapState = 'mapped';
                return Promise.resolve();
            },
            getMappedRange: () => storage,
            unmap: () => {
                log.push('buffer.unmap');
                mapState = 'unmapped';
            },
            destroy: () => log.push(`buffer.destroy:${descriptor.label ?? ''}`)
        };
        bufferStorageByHandle.set(buffer, storage);
        if (descriptor.label === 'WebGPU upload arena') uploadBuffers.push(buffer);
        return buffer;
    }

    function createTexture(descriptor: GPUTextureDescriptor): GPUTexture {
        textureDescriptors.push(descriptor);
        log.push(`createTexture:${descriptor.label ?? ''}`);
        return {
            label: descriptor.label ?? '',
            width: extentNumber(descriptor.size, 'width', 1),
            height: extentNumber(descriptor.size, 'height', 1),
            depthOrArrayLayers: extentNumber(descriptor.size, 'depthOrArrayLayers', 1),
            mipLevelCount: descriptor.mipLevelCount ?? 1,
            sampleCount: descriptor.sampleCount ?? 1,
            dimension: descriptor.dimension ?? '2d',
            format: descriptor.format,
            usage: descriptor.usage,
            createView: (viewDescriptor: GPUTextureViewDescriptor = {}) => {
                textureViewDescriptors.push(viewDescriptor);
                log.push(`texture.createView:${viewDescriptor.dimension ?? 'default'}`);
                return { label: viewDescriptor.label ?? '' };
            },
            destroy: () => log.push(`texture.destroy:${descriptor.label ?? ''}`)
        };
    }

    function createPass(): GPURenderPassEncoder {
        return {
            setPipeline: () => log.push('pass.setPipeline'),
            setBindGroup: () => log.push('pass.setBindGroup'),
            setVertexBuffer: (...args: unknown[]) => {
                log.push('pass.setVertexBuffer');
                renderPassCalls.push({ name: 'setVertexBuffer', args });
            },
            setIndexBuffer: (...args: unknown[]) => {
                log.push('pass.setIndexBuffer');
                renderPassCalls.push({ name: 'setIndexBuffer', args });
            },
            setViewport: (...args: unknown[]) => {
                log.push('pass.setViewport');
                renderPassCalls.push({ name: 'setViewport', args });
            },
            setScissorRect: (...args: unknown[]) => {
                log.push('pass.setScissorRect');
                renderPassCalls.push({ name: 'setScissorRect', args });
            },
            setBlendConstant: () => log.push('pass.setBlendConstant'),
            setStencilReference: () => log.push('pass.setStencilReference'),
            draw: (...args: unknown[]) => {
                log.push('pass.draw');
                renderPassCalls.push({ name: 'draw', args });
            },
            drawIndexed: (...args: unknown[]) => {
                log.push('pass.drawIndexed');
                renderPassCalls.push({ name: 'drawIndexed', args });
            },
            end: () => log.push('pass.end')
        } as unknown as GPURenderPassEncoder;
    }

    function createEncoder(): GPUCommandEncoder {
        return {
            label: 'native encoder',
            beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
                renderPassDescriptors.push(descriptor);
                log.push('encoder.beginRenderPass');
                return createPass();
            },
            copyBufferToBuffer: (
                source: GPUBuffer,
                _sourceOffset: number,
                destination: GPUBuffer
            ) => log.push(`encoder.copyBufferToBuffer:${source.label}->${destination.label}`),
            copyBufferToTexture: (
                source: GPUTexelCopyBufferInfo,
                destination: GPUTexelCopyTextureInfo,
                copySize: GPUExtent3D
            ) => {
                textureCopySources.push(source);
                textureCopyDestinations.push(destination);
                textureCopyExtents.push(copySize);
                log.push(
                    `encoder.copyBufferToTexture:${source.buffer.label}->${destination.texture.label}`
                );
            },
            copyTextureToBuffer: () => log.push('encoder.copyTextureToBuffer'),
            copyTextureToTexture: () => log.push('encoder.copyTextureToTexture'),
            finish: () => {
                log.push('encoder.finish');
                const failure = nextEncoderFinishFailure;
                if (failure !== null) {
                    nextEncoderFinishFailure = null;
                    throw failure.reason;
                }
                return { label: 'native command buffer' };
            }
        } as unknown as GPUCommandEncoder;
    }

    const nativeQueue = {
        label: 'native queue',
        writeBuffer: (
            destination: GPUBuffer,
            destinationOffset: number,
            data: AllowSharedBufferSource,
            dataOffset = 0,
            size?: number
        ) => {
            bufferWrites.push({ destination, destinationOffset, data, dataOffset, size });
            const source = ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data);
            const nativeElementSize = ArrayBuffer.isView(data)
                ? (Reflect.get(data, 'BYTES_PER_ELEMENT') as unknown)
                : undefined;
            const elementSize =
                typeof nativeElementSize === 'number' && nativeElementSize > 0
                    ? nativeElementSize
                    : 1;
            const sourceByteOffset = dataOffset * elementSize;
            const byteLength =
                size === undefined ? source.byteLength - sourceByteOffset : size * elementSize;
            const target = bufferStorageByHandle.get(destination);
            if (target === undefined) throw new Error('unknown native upload buffer');
            new Uint8Array(target).set(
                source.subarray(sourceByteOffset, sourceByteOffset + byteLength),
                destinationOffset
            );
            log.push(
                `queue.writeBuffer:${destination.label}@${String(destinationOffset)}:${String(byteLength)}`
            );
        },
        copyExternalImageToTexture: (
            source: GPUCopyExternalImageSourceInfo,
            destination: GPUCopyExternalImageDestInfo,
            size: GPUExtent3D
        ) => {
            log.push('queue.copyExternalImageToTexture');
            externalCopies.push([source, destination, size]);
        },
        submit: (commandBuffers: readonly GPUCommandBuffer[]) => {
            submittedCommandBufferLists.push(commandBuffers);
            log.push('queue.submit');
            const failure = nextSubmitFailure;
            if (failure !== null) {
                nextSubmitFailure = null;
                throw failure.reason;
            }
        },
        onSubmittedWorkDone: () => {
            log.push('queue.onSubmittedWorkDone');
            return work.promise;
        }
    } as unknown as GPUQueue;

    const limits = {
        maxTextureDimension1D: 8192,
        maxTextureDimension2D: 8192,
        maxTextureDimension3D: 2048,
        maxTextureArrayLayers: 256,
        maxBindGroups: 4,
        maxBindingsPerBindGroup: 32,
        maxDynamicUniformBuffersPerPipelineLayout: 8,
        maxSampledTexturesPerShaderStage: 16,
        maxSamplersPerShaderStage: 16,
        maxUniformBuffersPerShaderStage: 12,
        maxUniformBufferBindingSize: 65_536,
        maxVertexBuffers: 8,
        maxBufferSize: 268_435_456,
        maxVertexAttributes: 16,
        maxVertexBufferArrayStride: 2048,
        minUniformBufferOffsetAlignment: 256,
        maxColorAttachments: 8,
        maxStorageBuffersPerShaderStage: 8,
        maxStorageTexturesPerShaderStage: 4,
        maxStorageBufferBindingSize: 134_217_728,
        minStorageBufferOffsetAlignment: 256
    } as unknown as GPUSupportedLimits;

    const device = {
        label: 'structured native device',
        features: new Set<string>(['core-features-and-limits']) as unknown as GPUSupportedFeatures,
        limits,
        queue: nativeQueue,
        lost: lost.promise,
        createBuffer,
        createTexture,
        createSampler: () => {
            log.push('createSampler');
            return { label: 'native sampler' };
        },
        createShaderModule: () => {
            log.push('createShaderModule');
            return { label: 'native shader' } as GPUShaderModule;
        },
        createBindGroupLayout: () => {
            log.push('createBindGroupLayout');
            return { label: 'native bind group layout' };
        },
        createPipelineLayout: () => {
            log.push('createPipelineLayout');
            return { label: 'native pipeline layout' };
        },
        createBindGroup: () => {
            log.push('createBindGroup');
            return { label: 'native bind group' };
        },
        createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
            pipelineDescriptors.push(descriptor);
            log.push('createRenderPipeline');
            return { label: 'native render pipeline' } as GPURenderPipeline;
        },
        createCommandEncoder: () => {
            log.push('device.createCommandEncoder');
            return createEncoder();
        },
        destroy: () => log.push('device.destroy')
    } as unknown as GPUDevice;

    const surfaceTexture = createTexture({
        label: 'native surface texture',
        size: { width: 1, height: 1 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    });
    const canvasContext = {
        configure: (configuration: GPUCanvasConfiguration) => {
            surfaceConfigurations.push(configuration);
            log.push('surface.configure');
        },
        getCurrentTexture: () => {
            log.push('surface.getCurrentTexture');
            return surfaceTexture;
        },
        unconfigure: () => log.push('surface.unconfigure')
    } as unknown as GPUCanvasContext;
    const canvas = {
        width: 1,
        height: 1,
        getContext: (name: string) => {
            log.push(`canvas.getContext:${name}`);
            return name === 'webgpu' ? canvasContext : null;
        }
    } as unknown as HTMLCanvasElement;

    return {
        device,
        log,
        bufferDescriptors,
        textureDescriptors,
        textureViewDescriptors,
        pipelineDescriptors,
        renderPassDescriptors,
        renderPassCalls,
        bufferWrites,
        surfaceConfigurations,
        textureCopyExtents,
        textureCopySources,
        textureCopyDestinations,
        canvas,
        externalCopies,
        submittedCommandBufferLists,
        uploadBuffers,
        uploadMapRequests,
        getBufferBytes: label => new Uint8Array(bufferStorage.get(label) ?? new ArrayBuffer(0)),
        getBufferBytesForHandle: buffer =>
            new Uint8Array(bufferStorageByHandle.get(buffer) ?? new ArrayBuffer(0)),
        failNextEncoderFinish: (reason = new Error('native encoder finish failed')) => {
            nextEncoderFinishFailure = { reason };
        },
        failNextSubmit: (reason = new Error('native queue submit failed')) => {
            nextSubmitFailure = { reason };
        },
        resolveWork: () => {
            work.resolve(undefined);
        },
        loseDevice: (message = 'adapter removed') => {
            lost.resolve({ reason: 'unknown', message });
        }
    };
}

function createShader(device: WebGPUDevice, stage: 'vertex' | 'fragment') {
    return device.createShader({
        label: `${stage} shader`,
        artifact: {
            backend: 'webgpu',
            stage,
            code: 'valid test WGSL supplied by the frontend',
            entryPoint: 'main',
            reflection: {
                bindings: [],
                ...(stage === 'vertex'
                    ? { vertexInputs: [] }
                    : { fragmentOutputs: [{ location: 0 }] })
            },
            cacheKey: stage === 'vertex' ? 1 : 2
        }
    });
}

function createTriangleResources(device: WebGPUDevice) {
    const vertex = createShader(device, 'vertex');
    const fragment = createShader(device, 'fragment');
    const bindGroupLayout = device.createBindGroupLayout({ entries: [] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
    const pipeline = device.createGraphicsPipeline({
        layout,
        vertex: { shader: vertex },
        fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
        primitive: {}
    });
    const texture = device.createTexture({
        label: 'offscreen color',
        size: { width: 4, height: 4 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
    });
    const view = texture.createView();
    return { pipeline, texture, view };
}

describe('WebGPU RHI native backend', () => {
    it('reuses a persistent default native texture view without sharing logical lifetime', () => {
        const harness = createNativeHarness();
        const diagnostics = new RendererDiagnostics();
        const device = new WebGPUDevice(harness.device, diagnostics);
        const persistent = device.createTexture({
            label: 'persistent view source',
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });

        const first = persistent.createView();
        const second = persistent.createView();
        expect(first).not.toBe(second);
        expect(first.id).not.toBe(second.id);
        expect(first.nativeHandle).toBe(second.nativeHandle);
        expect(harness.textureViewDescriptors).toHaveLength(1);

        first.destroy();
        expect(second.destroyed).toBe(false);

        persistent.createView({ label: 'diagnostic view' });
        expect(harness.textureViewDescriptors).toHaveLength(2);

        const frame = device.createTexture({
            label: 'frame view source',
            lifetime: 'frame',
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        frame.createView();
        frame.createView();
        expect(harness.textureViewDescriptors).toHaveLength(4);
        expect(diagnostics.snapshot().nativeObjects.textureView.created).toBe(4);

        device.destroy();
    });

    it('maps per-vertex and instanced matrix columns into native WebGPU vertex layouts', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const vertex = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'vertex',
                code: 'matrix vertex WGSL supplied by the frontend',
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    vertexInputs: [
                        { location: 0, name: 'position' },
                        { location: 1, name: 'basis' },
                        { location: 2 },
                        { location: 3 },
                        { location: 4, name: 'instanceTransform' },
                        { location: 5 },
                        { location: 6 },
                        { location: 7 }
                    ]
                },
                cacheKey: 101
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'fragment',
                code: 'matrix fragment WGSL supplied by the frontend',
                entryPoint: 'main',
                reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
                cacheKey: 102
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });

        device.createGraphicsPipeline({
            layout,
            vertex: {
                shader: vertex,
                buffers: [
                    {
                        arrayStride: 48,
                        stepMode: 'vertex',
                        attributes: [
                            { format: 'float32x3', offset: 0, shaderLocation: 0 },
                            { format: 'float32x3', offset: 12, shaderLocation: 1 },
                            { format: 'float32x3', offset: 24, shaderLocation: 2 },
                            { format: 'float32x3', offset: 36, shaderLocation: 3 }
                        ]
                    },
                    {
                        arrayStride: 64,
                        stepMode: 'instance',
                        attributes: [
                            { format: 'float32x4', offset: 0, shaderLocation: 4 },
                            { format: 'float32x4', offset: 16, shaderLocation: 5 },
                            { format: 'float32x4', offset: 32, shaderLocation: 6 },
                            { format: 'float32x4', offset: 48, shaderLocation: 7 }
                        ]
                    }
                ]
            },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: { topology: 'triangle-list' }
        });

        expect(harness.pipelineDescriptors.at(-1)?.vertex.buffers).toEqual([
            {
                arrayStride: 48,
                stepMode: 'vertex',
                attributes: [
                    { format: 'float32x3', offset: 0, shaderLocation: 0 },
                    { format: 'float32x3', offset: 12, shaderLocation: 1 },
                    { format: 'float32x3', offset: 24, shaderLocation: 2 },
                    { format: 'float32x3', offset: 36, shaderLocation: 3 }
                ]
            },
            {
                arrayStride: 64,
                stepMode: 'instance',
                attributes: [
                    { format: 'float32x4', offset: 0, shaderLocation: 4 },
                    { format: 'float32x4', offset: 16, shaderLocation: 5 },
                    { format: 'float32x4', offset: 32, shaderLocation: 6 },
                    { format: 'float32x4', offset: 48, shaderLocation: 7 }
                ]
            }
        ]);
        device.destroy();
    });

    it('leases pass backing at high water while keeping snapshots and pending frames independent', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const { pipeline, texture, view } = createTriangleResources(device);
        const attachment: {
            view: typeof view;
            clearValue: { r: number; g: number; b: number; a: number };
            loadOp: 'clear';
            storeOp: 'store' | 'discard';
        } = {
            view,
            clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
            loadOp: 'clear',
            storeOp: 'discard'
        };
        const descriptor = { colorAttachments: [attachment] };

        const firstFrame = device.graphicsQueue.beginFrame();
        const firstPass = firstFrame.beginRenderPass(descriptor);
        const firstNativeDescriptor = harness.renderPassDescriptors.at(-1);
        const growthAfterFirstBegin = firstFrame.diagnostics.frameArenaGrowths;
        const allocationsAfterFirstBegin = firstFrame.diagnostics.transientAllocations;
        expect(growthAfterFirstBegin).toBeGreaterThan(0);
        expect(allocationsAfterFirstBegin).toBeGreaterThan(0);
        attachment.storeOp = 'store';
        attachment.clearValue.r = 1;
        firstPass.setPipeline(pipeline);
        firstPass.end();
        expect(firstNativeDescriptor?.colorAttachments[0]).toMatchObject({
            clearValue: { r: 0.25, g: 0.5, b: 0.75, a: 1 },
            storeOp: 'discard'
        });
        expect(() => {
            firstPass.end();
        }).toThrow(RHIValidationError);

        attachment.storeOp = 'discard';
        attachment.clearValue.r = 0.25;
        const secondPass = firstFrame.beginRenderPass(descriptor);
        expect(() => {
            firstPass.end();
        }).toThrow(RHIValidationError);
        expect(harness.renderPassDescriptors.at(-1)).toBe(firstNativeDescriptor);
        expect(firstFrame.diagnostics.frameArenaGrowths).toBe(growthAfterFirstBegin);
        expect(firstFrame.diagnostics.transientAllocations).toBe(allocationsAfterFirstBegin);
        secondPass.setPipeline(pipeline);
        secondPass.end();
        const firstSubmission = device.graphicsQueue.endFrame(firstFrame);

        const abortedFrame = device.graphicsQueue.beginFrame();
        const abortedPass = abortedFrame.beginRenderPass(descriptor);
        device.graphicsQueue.abortFrame(abortedFrame);
        expect(abortedPass.state).toBe('aborted');
        expect(() => {
            abortedPass.end();
        }).toThrow(RHIValidationError);

        const steadyFrame = device.graphicsQueue.beginFrame();
        const steadyPass = steadyFrame.beginRenderPass(descriptor);
        steadyPass.setPipeline(pipeline);
        steadyPass.end();
        expect(steadyFrame.diagnostics.frameArenaGrowths).toBe(0);
        expect(steadyFrame.diagnostics.transientAllocations).toBe(0);
        const steadySubmission = device.graphicsQueue.endFrame(steadyFrame);

        texture.destroy();
        expect(harness.log).not.toContain('texture.destroy:offscreen color');
        harness.resolveWork();
        await Promise.all([firstSubmission.done, steadySubmission.done]);
        expect(harness.log).toContain('texture.destroy:offscreen color');
        device.destroy();
    });

    it('marks an unused combined depth-stencil sibling aspect read-only natively', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const texture = device.createTexture({
            label: 'combined depth stencil',
            size: { width: 4, height: 4 },
            format: 'depth24plus-stencil8',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const view = texture.createView();

        const depthFrame = device.graphicsQueue.beginFrame();
        depthFrame
            .beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: {
                    view,
                    depthClearValue: 1,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store'
                }
            })
            .end();
        device.graphicsQueue.endFrame(depthFrame);
        expect(harness.renderPassDescriptors.at(-1)?.depthStencilAttachment).toMatchObject({
            depthLoadOp: 'clear',
            depthStoreOp: 'store',
            stencilReadOnly: true
        });
        expect(
            harness.renderPassDescriptors.at(-1)?.depthStencilAttachment?.depthReadOnly
        ).toBeUndefined();

        const stencilFrame = device.graphicsQueue.beginFrame();
        stencilFrame
            .beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: {
                    view,
                    stencilClearValue: 0,
                    stencilLoadOp: 'clear',
                    stencilStoreOp: 'store'
                }
            })
            .end();
        device.graphicsQueue.endFrame(stencilFrame);
        expect(harness.renderPassDescriptors.at(-1)?.depthStencilAttachment).toMatchObject({
            depthReadOnly: true,
            stencilLoadOp: 'clear',
            stencilStoreOp: 'store'
        });
        expect(
            harness.renderPassDescriptors.at(-1)?.depthStencilAttachment?.stencilReadOnly
        ).toBeUndefined();

        texture.destroy();
        device.destroy();
    });

    it('rejects unavailable depth/stencil access before native encoding', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const vertex = createShader(device, 'vertex');
        const fragment = createShader(device, 'fragment');
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
        const color = device.createTexture({
            label: 'read-only validation color',
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const depthStencil = device.createTexture({
            label: 'read-only validation depth stencil',
            size: { width: 4, height: 4 },
            format: 'depth24plus-stencil8',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const createPipeline = (descriptor: RHIDepthStencilState): RHIGraphicsPipeline =>
            device.createGraphicsPipeline({
                layout,
                vertex: { shader: vertex },
                fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
                primitive: {},
                depthStencil: descriptor
            });
        const depthWriter = createPipeline({
            format: 'depth24plus-stencil8',
            depthWriteEnabled: true,
            depthCompare: 'always'
        });
        const depthReader = createPipeline({
            format: 'depth24plus-stencil8',
            depthWriteEnabled: false,
            depthCompare: 'less'
        });
        const stencilWriter = createPipeline({
            format: 'depth24plus-stencil8',
            depthWriteEnabled: false,
            stencilFront: { passOp: 'replace' }
        });
        const stencilReader = createPipeline({
            format: 'depth24plus-stencil8',
            depthWriteEnabled: false,
            stencilFront: { compare: 'less' }
        });
        const maskedStencilWriter = createPipeline({
            format: 'depth24plus-stencil8',
            depthWriteEnabled: false,
            stencilFront: { passOp: 'replace' },
            stencilWriteMask: 0
        });

        const setPipeline = (
            attachment: Omit<RHIRenderPassDepthStencilAttachment, 'view'>,
            pipeline: RHIGraphicsPipeline,
            rejection: RegExp | null
        ): void => {
            const frame = device.graphicsQueue.beginFrame();
            const pass = frame.beginRenderPass({
                colorAttachments: [
                    {
                        view: color.createView(),
                        loadOp: 'load',
                        storeOp: 'store'
                    }
                ],
                depthStencilAttachment: {
                    view: depthStencil.createView(),
                    ...attachment
                }
            });
            harness.log.length = 0;
            if (rejection !== null) {
                expect(() => {
                    pass.setPipeline(pipeline);
                }).toThrow(rejection);
                expect(harness.log).not.toContain('pass.setPipeline');
            } else {
                expect(() => {
                    pass.setPipeline(pipeline);
                }).not.toThrow();
                expect(harness.log).toContain('pass.setPipeline');
            }
            pass.end();
            device.graphicsQueue.endFrame(frame);
        };
        const writableDepth = {
            depthLoadOp: 'load',
            depthStoreOp: 'store'
        } as const;
        const writableStencil = {
            stencilLoadOp: 'load',
            stencilStoreOp: 'store'
        } as const;

        setPipeline(writableStencil, depthWriter, /writes a read-only or unused/u);
        setPipeline(
            { depthReadOnly: true, ...writableStencil },
            depthWriter,
            /writes a read-only or unused/u
        );
        setPipeline(writableStencil, depthReader, /reads an unavailable or unused/u);
        setPipeline({ depthReadOnly: true }, depthReader, null);
        setPipeline(writableDepth, stencilWriter, /writes a read-only or unused/u);
        setPipeline(
            { ...writableDepth, stencilReadOnly: true },
            stencilWriter,
            /writes a read-only or unused/u
        );
        setPipeline(writableDepth, stencilReader, /reads an unavailable or unused/u);
        setPipeline({ stencilReadOnly: true }, stencilReader, null);
        setPipeline(writableDepth, maskedStencilWriter, null);
        device.destroy();
    });

    it('deduplicates frame retention by stamp and reuses cleared high-water storage', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const destination = device.createBuffer({
            label: 'retained destination',
            size: 8,
            usage: RHIBufferUsage.COPY_DST
        });
        const bytes = new Uint8Array([1, 2, 3, 4]);

        const aborted = device.graphicsQueue.beginFrame();
        aborted.writeBuffer(destination, 0, bytes);
        aborted.writeBuffer(destination, 4, bytes);
        const recycledReferences = aborted.retainedReferences;
        expect(recycledReferences.count).toBe(1);
        expect(recycledReferences.objects[0]).toBe(destination);
        device.graphicsQueue.abortFrame(aborted);
        expect(recycledReferences.count).toBe(0);
        expect(recycledReferences.objects).toHaveLength(1);
        expect(recycledReferences.objects[0]).toBeNull();

        const first = device.graphicsQueue.beginFrame();
        expect(first.retainedReferences).toBe(recycledReferences);
        first.writeBuffer(destination, 0, bytes);
        const firstReferences = first.retainedReferences;
        const firstSubmission = device.graphicsQueue.endFrame(first);
        expect(harness.submittedCommandBufferLists).toHaveLength(1);
        const submitList = harness.submittedCommandBufferLists[0];
        expect(submitList).toHaveLength(1);
        expect(submitList?.[0]).toBeNull();

        const second = device.graphicsQueue.beginFrame();
        const secondReferences = second.retainedReferences;
        expect(secondReferences).not.toBe(firstReferences);
        second.writeBuffer(destination, 4, bytes);
        const secondSubmission = device.graphicsQueue.endFrame(second);
        expect(harness.submittedCommandBufferLists).toHaveLength(2);
        expect(harness.submittedCommandBufferLists[1]).toBe(submitList);
        expect(submitList?.[0]).toBeNull();

        destination.destroy();
        expect(harness.log).not.toContain('buffer.destroy:retained destination');
        harness.resolveWork();
        await Promise.all([firstSubmission.done, secondSubmission.done]);
        expect(
            harness.log.filter(entry => entry === 'buffer.destroy:retained destination')
        ).toHaveLength(1);
        expect(firstReferences.count).toBe(0);
        expect(firstReferences.objects[0]).toBeNull();
        expect(secondReferences.count).toBe(0);
        expect(secondReferences.objects[0]).toBeNull();

        const reused = device.graphicsQueue.beginFrame();
        expect([firstReferences, secondReferences]).toContain(reused.retainedReferences);
        device.graphicsQueue.abortFrame(reused);
        device.destroy();
    });

    it('retains grown mapped upload pages until queue lifecycle end and reuses high water', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const destination = device.createBuffer({
            label: 'upload growth destination',
            size: 128 * 1024,
            usage: RHIBufferUsage.COPY_DST
        });

        const small = device.graphicsQueue.beginFrame();
        small.writeBuffer(destination, 0, new Uint8Array(4));
        device.graphicsQueue.endFrame(small);
        await Promise.resolve();

        const largeBytes = new Uint8Array(64 * 1024 + 4);
        const growth = device.graphicsQueue.beginFrame();
        growth.writeBuffer(destination, 0, largeBytes);
        device.graphicsQueue.endFrame(growth);
        await Promise.resolve();
        expect(
            harness.bufferDescriptors.filter(item => item.label === 'WebGPU upload arena')
        ).toHaveLength(2);
        expect(harness.log).not.toContain('buffer.destroy:WebGPU upload arena');

        const stable = device.graphicsQueue.beginFrame();
        stable.writeBuffer(destination, 0, largeBytes);
        device.graphicsQueue.endFrame(stable);
        await Promise.resolve();
        expect(
            harness.bufferDescriptors.filter(item => item.label === 'WebGPU upload arena')
        ).toHaveLength(2);
        const unmapIndices = harness.log.flatMap((entry, index) =>
            entry === 'buffer.unmap' ? [index] : []
        );
        const submitIndices = harness.log.flatMap((entry, index) =>
            entry === 'queue.submit' ? [index] : []
        );
        const mapIndices = harness.log.flatMap((entry, index) =>
            entry === 'buffer.mapAsync' ? [index] : []
        );
        expect(unmapIndices).toHaveLength(3);
        expect(submitIndices).toHaveLength(3);
        expect(mapIndices).toHaveLength(3);
        for (let index = 0; index < 3; index += 1) {
            expect(unmapIndices[index]).toBeLessThan(submitIndices[index] ?? -1);
            expect(submitIndices[index]).toBeLessThan(mapIndices[index] ?? -1);
        }

        device.destroy();
        expect(
            harness.log.filter(entry => entry === 'buffer.destroy:WebGPU upload arena')
        ).toHaveLength(2);
    });

    it('allocates around deferred remaps and reuses each page as soon as its map resolves', async () => {
        const harness = createNativeHarness({ deferUploadMaps: true });
        const device = new WebGPUDevice(harness.device);
        const destination = device.createBuffer({
            label: 'concurrent upload destination',
            size: 12,
            usage: RHIBufferUsage.COPY_DST
        });

        const first = device.graphicsQueue.beginFrame();
        first.writeBuffer(destination, 0, new Uint8Array([1, 2, 3, 4]));
        const firstSubmission = device.graphicsQueue.endFrame(first);
        expect(harness.uploadMapRequests).toHaveLength(1);
        const firstPage = harness.uploadMapRequests[0]?.buffer;
        expect(firstPage?.mapState).toBe('pending');

        const second = device.graphicsQueue.beginFrame();
        second.writeBuffer(destination, 4, new Uint8Array([5, 6, 7, 8]));
        const secondSubmission = device.graphicsQueue.endFrame(second);
        expect(harness.uploadMapRequests).toHaveLength(2);
        const secondPage = harness.uploadMapRequests[1]?.buffer;
        expect(secondPage).not.toBe(firstPage);
        expect(harness.uploadBuffers).toHaveLength(2);

        harness.uploadMapRequests[0]?.resolve();
        await flushMicrotasks();
        expect(firstPage?.mapState).toBe('mapped');
        expect(secondPage?.mapState).toBe('pending');

        const third = device.graphicsQueue.beginFrame();
        third.writeBuffer(destination, 8, new Uint8Array([9, 10, 11, 12]));
        const thirdSubmission = device.graphicsQueue.endFrame(third);
        expect(harness.uploadMapRequests).toHaveLength(3);
        expect(harness.uploadMapRequests[2]?.buffer).toBe(firstPage);
        expect(harness.uploadBuffers).toHaveLength(2);

        harness.uploadMapRequests[1]?.resolve();
        harness.uploadMapRequests[2]?.resolve();
        await flushMicrotasks();
        harness.resolveWork();
        await Promise.all([firstSubmission.done, secondSubmission.done, thirdSubmission.done]);
        device.destroy();
    });

    it('right-sizes concurrent spill pages and best-fits remapped pages', async () => {
        const harness = createNativeHarness({ deferUploadMaps: true });
        const device = new WebGPUDevice(harness.device);
        const largeBytes = new Uint8Array(128 * 1024);
        largeBytes.fill(7);
        const destination = device.createBuffer({
            label: 'mixed upload destination',
            size: largeBytes.byteLength,
            usage: RHIBufferUsage.COPY_DST
        });

        const largeFrame = device.graphicsQueue.beginFrame();
        largeFrame.writeBuffer(destination, 0, largeBytes);
        const largeSubmission = device.graphicsQueue.endFrame(largeFrame);
        const largePage = harness.uploadMapRequests[0]?.buffer;
        expect(largePage).toBe(harness.uploadBuffers[0]);

        const smallFrame = device.graphicsQueue.beginFrame();
        smallFrame.writeBuffer(destination, 0, new Uint8Array([2, 3, 4, 5]));
        const smallSubmission = device.graphicsQueue.endFrame(smallFrame);
        const smallPage = harness.uploadMapRequests[1]?.buffer;
        expect(smallPage).toBe(harness.uploadBuffers[1]);
        expect(
            harness.bufferDescriptors
                .filter(item => item.label === 'WebGPU upload arena')
                .map(item => item.size)
        ).toEqual([128 * 1024, 64 * 1024]);

        harness.uploadMapRequests[0]?.resolve();
        harness.uploadMapRequests[1]?.resolve();
        await flushMicrotasks();

        const reused = device.graphicsQueue.beginFrame();
        reused.writeBuffer(destination, 0, new Uint8Array([9, 10, 11, 12]));
        if (smallPage === undefined || largePage === undefined) {
            throw new Error('mixed upload pages were not created');
        }
        expect([...harness.getBufferBytesForHandle(smallPage).subarray(0, 4)]).toEqual([
            9, 10, 11, 12
        ]);
        expect([...harness.getBufferBytesForHandle(largePage).subarray(0, 4)]).toEqual([
            7, 7, 7, 7
        ]);
        reused.writeBuffer(destination, 0, largeBytes);
        expect(harness.uploadBuffers).toHaveLength(2);
        device.graphicsQueue.abortFrame(reused);

        harness.resolveWork();
        await Promise.all([largeSubmission.done, smallSubmission.done]);
        device.destroy();
    });

    it('fits exactly 64 KiB in one upload page and spills the next aligned write', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const pageCapacity = 64 * 1024;
        const destination = device.createBuffer({
            label: 'upload boundary destination',
            size: pageCapacity + 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const frame = device.graphicsQueue.beginFrame();

        frame.writeBuffer(destination, 0, new Uint8Array(pageCapacity));
        expect(harness.uploadBuffers).toHaveLength(1);
        expect(
            harness.bufferDescriptors.find(item => item.label === 'WebGPU upload arena')?.size
        ).toBe(pageCapacity);

        frame.writeBuffer(destination, pageCapacity, new Uint8Array(4));
        expect(harness.uploadBuffers).toHaveLength(2);
        expect(harness.uploadBuffers[1]).not.toBe(harness.uploadBuffers[0]);

        device.graphicsQueue.abortFrame(frame);
        device.destroy();
    });

    it('reuses mapped upload pages after abort and encoder finish failure', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const destination = device.createBuffer({
            label: 'abort recovery destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const bytes = new Uint8Array([1, 2, 3, 4]);

        const aborted = device.graphicsQueue.beginFrame();
        aborted.writeBuffer(destination, 0, bytes);
        const uploadPage = harness.uploadBuffers[0];
        device.graphicsQueue.abortFrame(aborted);
        expect(uploadPage?.mapState).toBe('mapped');

        const finishFailure = new Error('controlled encoder finish failure');
        harness.failNextEncoderFinish(finishFailure);
        const failed = device.graphicsQueue.beginFrame();
        failed.writeBuffer(destination, 0, bytes);
        expect(() => device.graphicsQueue.endFrame(failed)).toThrow(finishFailure);
        expect(device.graphicsQueue.state).toBe('idle');
        expect(uploadPage?.mapState).toBe('mapped');
        expect(harness.uploadBuffers).toHaveLength(1);
        expect(harness.log.filter(entry => entry === 'buffer.unmap')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'buffer.mapAsync')).toHaveLength(0);

        const recovered = device.graphicsQueue.beginFrame();
        recovered.writeBuffer(destination, 0, bytes);
        const submission = device.graphicsQueue.endFrame(recovered);
        await flushMicrotasks();
        expect(harness.uploadBuffers).toHaveLength(1);
        harness.resolveWork();
        await submission.done;
        device.destroy();
    });

    it('remaps a sealed upload page after submit throws and reuses it on recovery', async () => {
        const harness = createNativeHarness({ deferUploadMaps: true });
        const device = new WebGPUDevice(harness.device);
        const destination = device.createBuffer({
            label: 'submit recovery destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const bytes = new Uint8Array([1, 2, 3, 4]);
        const submitFailure = new Error('controlled queue submit failure');

        harness.failNextSubmit(submitFailure);
        const failed = device.graphicsQueue.beginFrame();
        failed.writeBuffer(destination, 0, bytes);
        const uploadPage = harness.uploadBuffers[0];
        expect(() => device.graphicsQueue.endFrame(failed)).toThrow(submitFailure);
        expect(device.graphicsQueue.state).toBe('idle');
        expect(uploadPage?.mapState).toBe('pending');
        expect(harness.uploadMapRequests).toHaveLength(1);

        harness.uploadMapRequests[0]?.resolve();
        await flushMicrotasks();
        const recovered = device.graphicsQueue.beginFrame();
        recovered.writeBuffer(destination, 0, bytes);
        const submission = device.graphicsQueue.endFrame(recovered);
        expect(harness.uploadBuffers).toHaveLength(1);
        expect(harness.uploadMapRequests[1]?.buffer).toBe(uploadPage);

        harness.uploadMapRequests[1]?.resolve();
        await flushMicrotasks();
        harness.resolveWork();
        await submission.done;
        device.destroy();
    });

    it('reports a rejected remap before creating the next native encoder', async () => {
        const harness = createNativeHarness({ deferUploadMaps: true });
        const device = new WebGPUDevice(harness.device);
        const destination = device.createBuffer({
            label: 'remap rejection destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const frame = device.graphicsQueue.beginFrame();
        frame.writeBuffer(destination, 0, new Uint8Array(4));
        device.graphicsQueue.endFrame(frame);

        harness.uploadMapRequests[0]?.reject(new Error('controlled remap rejection'));
        await flushMicrotasks();
        harness.log.length = 0;
        expect(() => device.graphicsQueue.beginFrame()).toThrow(
            /upload arena could not remap a submitted page/u
        );
        expect(harness.log).not.toContain('device.createCommandEncoder');

        device.destroy();
        expect(
            harness.log.filter(entry => entry === 'buffer.destroy:WebGPU upload arena')
        ).toHaveLength(1);
    });

    it('ignores upload remap callbacks that settle after loss or destroy', async () => {
        const lossHarness = createNativeHarness({ deferUploadMaps: true });
        const lostDevice = new WebGPUDevice(lossHarness.device);
        const lostDestination = lostDevice.createBuffer({
            label: 'lost upload destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const lostFrame = lostDevice.graphicsQueue.beginFrame();
        lostFrame.writeBuffer(lostDestination, 0, new Uint8Array(4));
        const lostSubmission = lostDevice.graphicsQueue.endFrame(lostFrame);
        const lateResolve = lossHarness.uploadMapRequests[0];

        lossHarness.loseDevice('controlled upload loss');
        await lostDevice.lost;
        await expect(lostSubmission.done).rejects.toThrow('controlled upload loss');
        expect(
            lossHarness.log.filter(entry => entry === 'buffer.destroy:WebGPU upload arena')
        ).toHaveLength(1);
        lateResolve?.resolve();
        await flushMicrotasks();
        expect(
            lossHarness.log.filter(entry => entry === 'buffer.destroy:WebGPU upload arena')
        ).toHaveLength(1);

        const destroyHarness = createNativeHarness({ deferUploadMaps: true });
        const destroyedDevice = new WebGPUDevice(destroyHarness.device);
        const destroyedDestination = destroyedDevice.createBuffer({
            label: 'destroyed upload destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const destroyedFrame = destroyedDevice.graphicsQueue.beginFrame();
        destroyedFrame.writeBuffer(destroyedDestination, 0, new Uint8Array(4));
        const destroyedSubmission = destroyedDevice.graphicsQueue.endFrame(destroyedFrame);
        const lateReject = destroyHarness.uploadMapRequests[0];

        destroyedDevice.destroy();
        await expect(destroyedSubmission.done).rejects.toThrow('WebGPU device was destroyed');
        expect(
            destroyHarness.log.filter(entry => entry === 'buffer.destroy:WebGPU upload arena')
        ).toHaveLength(1);
        lateReject?.reject(new Error('late remap rejection'));
        await flushMicrotasks();
        expect(
            destroyHarness.log.filter(entry => entry === 'buffer.destroy:WebGPU upload arena')
        ).toHaveLength(1);
    });

    it('stages byte-relative ranges through mapped pages without native queue writes', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const destination = device.createBuffer({
            label: 'byte-view destination',
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        const backing = new ArrayBuffer(24);
        const words = new Uint16Array(backing, 4, 6);
        const raw = new ArrayBuffer(4);
        const backingBytes = new Uint8Array(backing);
        for (let index = 0; index < backingBytes.length; index += 1) {
            backingBytes[index] = index;
        }
        new Uint8Array(raw).set([31, 32, 33, 34]);

        const first = device.graphicsQueue.beginFrame();
        first.writeBuffer(destination, 0, words, 4, 4);
        first.writeBuffer(destination, 4, new DataView(backing, 8, 4));
        first.writeBuffer(destination, 8, raw);
        device.graphicsQueue.endFrame(first);
        await Promise.resolve();

        expect(harness.bufferWrites).toHaveLength(0);
        expect([...harness.getBufferBytes('WebGPU upload arena').subarray(0, 12)]).toEqual([
            8, 9, 10, 11, 8, 9, 10, 11, 31, 32, 33, 34
        ]);
        expect(
            harness.bufferDescriptors.filter(item => item.label === 'WebGPU upload arena')
        ).toEqual([
            expect.objectContaining({
                mappedAtCreation: true,
                usage: RHIBufferUsage.MAP_WRITE | RHIBufferUsage.COPY_SRC
            })
        ]);

        const second = device.graphicsQueue.beginFrame();
        second.writeBuffer(destination, 12, words, 4, 4);
        device.graphicsQueue.endFrame(second);
        await Promise.resolve();
        expect(harness.bufferWrites).toHaveLength(0);
        expect([...harness.getBufferBytes('WebGPU upload arena').subarray(0, 4)]).toEqual([
            8, 9, 10, 11
        ]);
        expect(
            harness.bufferDescriptors.filter(item => item.label === 'WebGPU upload arena')
        ).toHaveLength(1);

        device.destroy();
    });

    it('stages a cross-realm ArrayBuffer without same-realm identity assumptions', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const iframe = document.createElement('iframe');
        document.body.append(iframe);

        try {
            const foreignGlobal = iframe.contentWindow;
            if (foreignGlobal === null) throw new Error('cross-realm test iframe has no window');
            const ForeignArrayBuffer = Reflect.get(
                foreignGlobal,
                'ArrayBuffer'
            ) as ArrayBufferConstructor;
            const ForeignUint8Array = Reflect.get(
                foreignGlobal,
                'Uint8Array'
            ) as Uint8ArrayConstructor;
            const source = new ForeignArrayBuffer(8);
            new ForeignUint8Array(source).set([1, 2, 3, 4, 5, 6, 7, 8]);
            expect(source).not.toBeInstanceOf(ArrayBuffer);
            const destination = device.createBuffer({
                label: 'cross-realm upload destination',
                size: 8,
                usage: RHIBufferUsage.COPY_DST
            });
            const frame = device.graphicsQueue.beginFrame();

            frame.writeBuffer(destination, 0, source);
            const uploadPage = harness.uploadBuffers[0];
            if (uploadPage === undefined) throw new Error('upload page was not created');
            expect([
                ...harness.getBufferBytesForHandle(uploadPage).subarray(0, source.byteLength)
            ]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

            device.graphicsQueue.abortFrame(frame);
        } finally {
            device.destroy();
            iframe.remove();
        }
    });

    it.skipIf(typeof Reflect.get(ArrayBuffer.prototype, 'resize') !== 'function')(
        'tracks a cross-realm resizable ArrayBuffer after it shrinks',
        () => {
            const harness = createNativeHarness();
            const device = new WebGPUDevice(harness.device);
            const iframe = document.createElement('iframe');
            document.body.append(iframe);

            try {
                const foreignGlobal = iframe.contentWindow;
                if (foreignGlobal === null)
                    throw new Error('cross-realm test iframe has no window');
                const ForeignArrayBuffer = Reflect.get(
                    foreignGlobal,
                    'ArrayBuffer'
                ) as unknown as new (
                    byteLength: number,
                    options: { maxByteLength: number }
                ) => ArrayBuffer;
                const ForeignUint8Array = Reflect.get(
                    foreignGlobal,
                    'Uint8Array'
                ) as Uint8ArrayConstructor;
                const source = new ForeignArrayBuffer(8, { maxByteLength: 16 });
                const resize = Reflect.get(source, 'resize') as (
                    this: ArrayBuffer,
                    newByteLength: number
                ) => void;
                new ForeignUint8Array(source).set([5, 6, 7, 8, 9, 10, 11, 12]);
                expect(source).not.toBeInstanceOf(ArrayBuffer);
                expect(Reflect.get(source, 'resizable')).toBe(true);
                const destination = device.createBuffer({
                    label: 'resizable upload destination',
                    size: 12,
                    usage: RHIBufferUsage.COPY_DST
                });
                const frame = device.graphicsQueue.beginFrame();

                frame.writeBuffer(destination, 0, source);
                resize.call(source, 4);
                frame.writeBuffer(destination, 8, source);
                const uploadPage = harness.uploadBuffers[0];
                if (uploadPage === undefined) throw new Error('upload page was not created');
                expect([...harness.getBufferBytesForHandle(uploadPage).subarray(0, 12)]).toEqual([
                    5, 6, 7, 8, 9, 10, 11, 12, 5, 6, 7, 8
                ]);

                device.graphicsQueue.abortFrame(frame);
            } finally {
                device.destroy();
                iframe.remove();
            }
        }
    );

    it('reuses upload pages and row scratch across frames while native writes snapshot inputs', async () => {
        const mock = createStructuredWebGPUMock();
        const diagnostics = new RendererDiagnostics();
        const device = new WebGPUDevice(mock.device, diagnostics);
        const destination = device.createBuffer({
            label: 'steady upload destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        const texture = device.createTexture({
            label: 'steady upload texture',
            size: { width: 2, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.COPY_SRC
        });
        const readback = device.createBuffer({
            label: 'steady texture readback',
            size: 256,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });

        const upload = async (value: number) => {
            const bufferSource = new Uint8Array([value, value + 1, value + 2, value + 3]);
            const firstTextureSource = new Uint8Array([value, 0, 0, 255]);
            const secondTextureSource = new Uint8Array([0, value, 0, 255]);
            const frame = device.graphicsQueue.beginFrame();
            frame.writeBuffer(destination, 0, bufferSource);
            frame.writeTexture({ texture, origin: { x: 0 } }, firstTextureSource, {}, { width: 1 });
            frame.writeTexture(
                { texture, origin: { x: 1 } },
                secondTextureSource,
                {},
                { width: 1 }
            );
            bufferSource.fill(0);
            firstTextureSource.fill(0);
            secondTextureSource.fill(0);
            await device.graphicsQueue.endFrame(frame).done;
            return frame.diagnostics;
        };

        const first = await upload(10);
        const createdAfterWarmup = diagnostics.snapshot().nativeObjects.buffer.created;
        const second = await upload(20);
        const third = await upload(30);

        expect(first.frameArenaGrowths).toBeGreaterThan(0);
        expect(second.frameArenaGrowths).toBe(0);
        expect(second.transientAllocations).toBe(0);
        expect(third.frameArenaGrowths).toBe(0);
        expect(third.transientAllocations).toBe(0);
        expect(diagnostics.snapshot().nativeObjects.buffer.created).toBe(createdAfterWarmup);
        expect(mock.log.filter(entry => entry === 'createBuffer:WebGPU upload arena')).toHaveLength(
            1
        );

        await destination.mapAsync('read');
        expect([...new Uint8Array(destination.getMappedRange())]).toEqual([30, 31, 32, 33]);
        destination.unmap();

        const copy = device.graphicsQueue.beginFrame();
        copy.copyTextureToBuffer({ texture }, { buffer: readback, bytesPerRow: 256 }, { width: 2 });
        await device.graphicsQueue.endFrame(copy).done;
        await readback.mapAsync('read');
        expect([...new Uint8Array(readback.getMappedRange()).subarray(0, 8)]).toEqual([
            30, 0, 0, 255, 0, 30, 0, 255
        ]);
        readback.unmap();
        device.destroy();
    });

    it('allows manual multi-mip allocation but rejects generation without prepared artifacts', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);

        const texture = device.createTexture({
            label: 'unprepared generated texture',
            size: { width: 4, height: 4 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage:
                RHITextureUsage.TEXTURE_BINDING |
                RHITextureUsage.RENDER_ATTACHMENT |
                RHITextureUsage.COPY_DST
        });
        const frame = device.graphicsQueue.beginFrame();
        expect(() => {
            frame.generateMipmaps(texture);
        }).toThrow(/GLSL\/Naga-prepared shader artifacts/u);
        device.graphicsQueue.abortFrame(frame);
        expect(harness.log).not.toContain('createCommandEncoder');

        texture.destroy();
        device.destroy();
    });

    it('encodes 2D and cube mip generation into the current frame submission', async () => {
        const harness = createNativeHarness();
        const compiler = new ShaderArtifactCompiler();
        await compiler.initialize();
        const device = new WebGPUDevice(
            harness.device,
            null,
            prepareWebGPUMipmapShaderArtifacts(compiler)
        );
        const usage =
            RHITextureUsage.COPY_DST |
            RHITextureUsage.TEXTURE_BINDING |
            RHITextureUsage.RENDER_ATTACHMENT;
        const texture = device.createTexture({
            label: 'generated 2D',
            size: { width: 4, height: 4 },
            mipLevelCount: 3,
            format: 'rgba8unorm',
            usage
        });
        expect(harness.log.filter(entry => entry === 'createShaderModule')).toHaveLength(2);
        expect(harness.log.filter(entry => entry === 'createRenderPipeline')).toHaveLength(1);
        expect(harness.log.filter(entry => entry.startsWith('texture.createView:'))).toHaveLength(
            4
        );
        expect(harness.log.filter(entry => entry === 'createBindGroup')).toHaveLength(2);
        harness.log.length = 0;
        const context = device.graphicsQueue.beginFrame();
        context.writeTexture(
            { texture },
            new Uint8Array(4 * 4 * 4),
            { bytesPerRow: 16 },
            { width: 4, height: 4 }
        );
        context.generateMipmaps(texture);
        const submission = device.graphicsQueue.endFrame(context);
        expect(
            harness.log.indexOf('encoder.copyBufferToTexture:WebGPU upload arena->generated 2D')
        ).toBeLessThan(harness.log.indexOf('encoder.beginRenderPass'));
        expect(harness.log.filter(entry => entry === 'encoder.beginRenderPass')).toHaveLength(2);
        expect(harness.log.filter(entry => entry === 'pass.draw')).toHaveLength(2);
        expect(harness.log.filter(entry => entry === 'queue.submit')).toHaveLength(1);
        expect(harness.log.filter(entry => entry.startsWith('texture.createView:'))).toHaveLength(
            0
        );
        expect(harness.log.filter(entry => entry === 'createBindGroup')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createRenderPipeline')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createShaderModule')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createBindGroupLayout')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createPipelineLayout')).toHaveLength(0);
        expect(harness.pipelineDescriptors.at(-1)?.fragment?.targets).toEqual([
            { format: 'rgba8unorm' }
        ]);

        harness.log.length = 0;
        const regeneration = device.graphicsQueue.beginFrame();
        regeneration.generateMipmaps(texture);
        const regenerationSubmission = device.graphicsQueue.endFrame(regeneration);
        expect(harness.log.filter(entry => entry.startsWith('texture.createView:'))).toHaveLength(
            0
        );
        expect(harness.log.filter(entry => entry === 'createBindGroup')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createRenderPipeline')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createShaderModule')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createBindGroupLayout')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createPipelineLayout')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'encoder.beginRenderPass')).toHaveLength(2);

        harness.textureViewDescriptors.length = 0;
        const cube = device.createTexture({
            label: 'generated cube',
            size: { width: 4, height: 4, depthOrArrayLayers: 6 },
            mipLevelCount: 3,
            viewDimension: 'cube',
            format: 'rgba8unorm',
            usage
        });
        expect(harness.textureViewDescriptors).toHaveLength(24);
        harness.log.length = 0;
        const cubeContext = device.graphicsQueue.beginFrame();
        cubeContext.generateMipmaps(cube);
        const cubeSubmission = device.graphicsQueue.endFrame(cubeContext);
        expect(harness.log.filter(entry => entry === 'encoder.beginRenderPass')).toHaveLength(12);
        expect(harness.log.filter(entry => entry.startsWith('texture.createView:'))).toHaveLength(
            0
        );
        expect(harness.log.filter(entry => entry === 'createBindGroup')).toHaveLength(0);
        expect(harness.log.filter(entry => entry === 'createRenderPipeline')).toHaveLength(0);
        expect(harness.textureViewDescriptors).toHaveLength(24);
        for (const descriptor of harness.textureViewDescriptors) {
            expect(descriptor).toMatchObject({
                dimension: '2d',
                mipLevelCount: 1,
                arrayLayerCount: 1
            });
        }
        expect(
            harness.textureViewDescriptors.map(descriptor => [
                descriptor.baseArrayLayer,
                descriptor.baseMipLevel
            ])
        ).toEqual(
            Array.from({ length: 6 }, (_unused, layer) => [
                [layer, 0],
                [layer, 1],
                [layer, 1],
                [layer, 2]
            ]).flat()
        );

        harness.resolveWork();
        await Promise.all([submission.done, regenerationSubmission.done, cubeSubmission.done]);
        device.destroy();
    });

    it('uses globally unique device IDs and device-local object IDs', () => {
        const firstHarness = createNativeHarness();
        const secondHarness = createNativeHarness();
        const first = new WebGPUDevice(firstHarness.device);
        const second = new WebGPUDevice(secondHarness.device);
        const firstBuffer = first.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });
        const secondBuffer = second.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_SRC });

        expect(first.id).not.toBe(second.id);
        expect(firstBuffer.id).toBe(secondBuffer.id);
        expect(firstBuffer.deviceId).toBe(first.id);
        expect(secondBuffer.deviceId).toBe(second.id);
    });

    it('rejects cross-device resources before issuing a native command', () => {
        const firstHarness = createNativeHarness();
        const secondHarness = createNativeHarness();
        const first = new WebGPUDevice(firstHarness.device);
        const second = new WebGPUDevice(secondHarness.device);
        const destination = first.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const foreignSource = second.createBuffer({
            size: 4,
            usage: RHIBufferUsage.COPY_SRC
        });
        const context = first.graphicsQueue.beginFrame();

        expect(() => {
            context.copyBufferToBuffer(foreignSource, 0, destination, 0, 4);
        }).toThrow(RHIValidationError);
        expect(firstHarness.log).not.toContain('encoder.copyBufferToBuffer:->');
        first.graphicsQueue.abortFrame(context);
    });

    it('normalizes descriptors and snapshots initial data before returning', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const input = new Uint8Array([1, 2, 3, 4]);
        const buffer = device.createBuffer({
            label: 'initialized',
            size: 8,
            usage: RHIBufferUsage.COPY_SRC,
            initialData: input
        });
        input.fill(9);

        expect(buffer).toBeInstanceOf(WebGPUBuffer);
        expect(harness.bufferDescriptors[0]).toMatchObject({
            label: 'initialized',
            size: 8,
            usage: RHIBufferUsage.COPY_SRC,
            mappedAtCreation: true
        });
        expect(harness.log).toContain('buffer.unmap');
        expect([...harness.getBufferBytes('initialized').subarray(0, 4)]).toEqual([1, 2, 3, 4]);
    });

    it('encodes natively, then finishes/submits exactly once at endFrame', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const { pipeline, texture, view } = createTriangleResources(device);
        harness.log.length = 0;

        const context = device.graphicsQueue.beginFrame({ label: 'triangle frame' });
        const pass = context.beginRenderPass({
            label: 'offscreen pass',
            colorAttachments: [
                {
                    view,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();

        expect(harness.log).toEqual([
            'device.createCommandEncoder',
            'encoder.beginRenderPass',
            'pass.setPipeline',
            'pass.draw',
            'pass.end'
        ]);

        const submission = device.graphicsQueue.endFrame(context);
        expect(harness.log.slice(-3)).toEqual([
            'encoder.finish',
            'queue.submit',
            'queue.onSubmittedWorkDone'
        ]);
        expect(submission.status).toBe('pending');

        texture.destroy();
        expect(harness.log).not.toContain('texture.destroy:offscreen color');
        harness.resolveWork();
        await submission.done;
        expect(submission.status).toBe('succeeded');
        expect(harness.log).toContain('texture.destroy:offscreen color');
    });

    it('counts exact framebuffer descriptor hits and releases attachment views', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const texture = device.createTexture({
            label: 'cached render attachment',
            size: { width: 4, height: 4 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const view = texture.createView();
        const descriptor = {
            label: 'cached render pass',
            colorAttachments: [
                {
                    view,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear' as const,
                    storeOp: 'store' as const
                }
            ]
        };

        const firstFrame = device.graphicsQueue.beginFrame();
        firstFrame.beginRenderPass(descriptor).end();
        const firstSubmission = device.graphicsQueue.endFrame(firstFrame);
        const secondFrame = device.graphicsQueue.beginFrame();
        secondFrame.beginRenderPass(descriptor).end();
        const secondSubmission = device.graphicsQueue.endFrame(secondFrame);
        const afterSecondRequests =
            device.framebufferCacheMetrics.hits + device.framebufferCacheMetrics.misses;
        const thirdFrame = device.graphicsQueue.beginFrame();
        thirdFrame.beginRenderPass(descriptor).end();
        const thirdSubmission = device.graphicsQueue.endFrame(thirdFrame);

        expect(device.framebufferCacheMetrics).toMatchObject({
            hits: 2,
            misses: 1,
            evictions: 0,
            size: 1,
            highWater: 1
        });
        expect(
            device.framebufferCacheMetrics.hits +
                device.framebufferCacheMetrics.misses -
                afterSecondRequests
        ).toBe(1);
        harness.resolveWork();
        await Promise.all([firstSubmission.done, secondSubmission.done, thirdSubmission.done]);
        view.destroy();
        expect(device.framebufferCacheMetrics).toMatchObject({
            hits: 2,
            misses: 1,
            evictions: 1,
            size: 0,
            highWater: 1
        });
        texture.destroy();
        device.destroy();
    });

    it('deduplicates cached bindings while preserving scalar and stable-record commands', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const { pipeline, view } = createTriangleResources(device);
        const bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: []
        });
        const vertexBuffer = device.createBuffer({
            size: 32,
            usage: RHIBufferUsage.VERTEX
        });
        const indexBuffer = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.INDEX
        });
        const context = device.graphicsQueue.beginFrame();
        const pass = context.beginRenderPass({
            colorAttachments: [
                {
                    view,
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        harness.log.length = 0;
        harness.renderPassCalls.length = 0;
        const diagnosticsBefore = { ...context.diagnostics };

        pass.setPipeline(pipeline);
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer, 0, 16);
        pass.setVertexBuffer(0, vertexBuffer, 0, 16);
        pass.setVertexBuffer(0, vertexBuffer, 4, 12);
        pass.setIndexBuffer(indexBuffer, 'uint16', 0, 8);
        pass.setIndexBuffer(indexBuffer, 'uint16', 0, 8);
        pass.setIndexBuffer(indexBuffer, 'uint16', 2, 6);
        const vertexBufferRecord = {
            slot: 0,
            buffer: vertexBuffer,
            offset: 4,
            size: undefined as number | undefined
        };
        expect(() => {
            pass.setVertexBuffer(-1, vertexBuffer);
        }).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor', path: 'vertexBuffer.slot' })
        );
        expect(() => {
            pass.setVertexBufferRecord({ ...vertexBufferRecord, slot: -1 });
        }).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor', path: 'vertexBuffer.slot' })
        );
        pass.setVertexBufferRecord(vertexBufferRecord);
        vertexBufferRecord.offset = 8;
        pass.setVertexBufferRecord(vertexBufferRecord);
        const indexBufferRecord = {
            buffer: indexBuffer,
            format: 'uint16' as const,
            offset: 2,
            size: undefined as number | undefined
        };
        expect(() => {
            pass.setIndexBuffer(indexBuffer, 'uint16', 1, 2);
        }).toThrow(expect.objectContaining({ code: 'invalid-descriptor', path: 'indexBuffer' }));
        expect(() => {
            pass.setIndexBufferRecord({ ...indexBufferRecord, offset: 1, size: 2 });
        }).toThrow(expect.objectContaining({ code: 'invalid-descriptor', path: 'indexBuffer' }));
        pass.setIndexBufferRecord(indexBufferRecord);
        indexBufferRecord.offset = 4;
        pass.setIndexBufferRecord(indexBufferRecord);

        expect(() => {
            pass.setViewport(Number.NaN, 0, 4, 4, 0, 1);
        }).toThrow(RHIValidationError);
        let recordValidationError: unknown;
        try {
            pass.setViewportRecord({
                x: Number.NaN,
                y: 0,
                width: 4,
                height: 4,
                minDepth: 0,
                maxDepth: 1
            });
        } catch (error) {
            recordValidationError = error;
        }
        expect(recordValidationError).toMatchObject({
            code: 'invalid-descriptor',
            path: 'viewport.x'
        });
        expect(() => {
            pass.setBlendConstant({ r: 0, g: 0, b: Number.POSITIVE_INFINITY, a: 1 });
        }).toThrow(RHIValidationError);
        pass.setViewport(0, 0, 4, 4, 0, 1);
        pass.setScissorRect(0, 0, 4, 4);
        const viewport = {
            x: 0.25,
            y: 0.5,
            width: 3.5,
            height: 3,
            minDepth: 0.1,
            maxDepth: 0.9
        };
        pass.setViewportRecord(viewport);
        viewport.x = 1;
        viewport.y = 1;
        viewport.width = 2;
        viewport.height = 2;
        viewport.minDepth = 0.2;
        viewport.maxDepth = 0.8;
        pass.setViewportRecord(viewport);
        const scissor = { x: 1, y: 0, width: 3, height: 4 };
        pass.setScissorRectRecord(scissor);
        scissor.x = 0;
        scissor.y = 1;
        scissor.width = 4;
        scissor.height = 3;
        pass.setScissorRectRecord(scissor);
        pass.setBlendConstant({ r: 0, g: 0, b: 0, a: 1 });
        pass.setStencilReference(1);
        pass.draw(3);
        pass.drawIndexed(3);
        const drawRecord = {
            elementCount: 2,
            instanceCount: 2,
            firstElement: 1,
            baseVertex: 0,
            firstInstance: 0
        };
        expect(() => {
            pass.draw(0);
        }).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor', path: 'draw.vertexCount' })
        );
        expect(() => {
            pass.drawRecord({ ...drawRecord, elementCount: 0 });
        }).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor', path: 'draw.vertexCount' })
        );
        expect(() => {
            pass.drawIndexed(3, 1, 0, Number.NaN, 0);
        }).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor', path: 'drawIndexed.baseVertex' })
        );
        expect(() => {
            pass.drawIndexedRecord({ ...drawRecord, baseVertex: Number.NaN });
        }).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor', path: 'drawIndexed.baseVertex' })
        );
        pass.drawRecord(drawRecord);
        drawRecord.elementCount = 3;
        drawRecord.instanceCount = 1;
        drawRecord.firstElement = 0;
        pass.drawIndexedRecord(drawRecord);

        expect(harness.log.filter(entry => entry === 'pass.setPipeline')).toHaveLength(1);
        expect(harness.log.filter(entry => entry === 'pass.setBindGroup')).toHaveLength(1);
        expect(harness.log.filter(entry => entry === 'pass.setVertexBuffer')).toHaveLength(4);
        expect(harness.log.filter(entry => entry === 'pass.setIndexBuffer')).toHaveLength(4);
        expect(harness.log.filter(entry => entry === 'pass.setViewport')).toHaveLength(2);
        expect(harness.log.filter(entry => entry === 'pass.setBlendConstant')).toHaveLength(1);
        expect(harness.log.filter(entry => entry === 'pass.setScissorRect')).toHaveLength(2);
        expect(
            harness.renderPassCalls
                .filter(call => call.name === 'setViewport')
                .map(call => call.args)
        ).toEqual([
            [0.25, 0.5, 3.5, 3, 0.1, 0.9],
            [1, 1, 2, 2, 0.2, 0.8]
        ]);
        expect(
            harness.renderPassCalls
                .filter(call => call.name === 'setVertexBuffer')
                .map(call => [call.args[0], call.args[2], call.args[3]])
        ).toEqual([
            [0, 0, 16],
            [0, 4, 12],
            [0, 4, 28],
            [0, 8, 24]
        ]);
        expect(
            harness.renderPassCalls
                .filter(call => call.name === 'setIndexBuffer')
                .map(call => [call.args[1], call.args[2], call.args[3]])
        ).toEqual([
            ['uint16', 0, 8],
            ['uint16', 2, 6],
            ['uint16', 2, 14],
            ['uint16', 4, 12]
        ]);
        expect(
            harness.renderPassCalls
                .filter(call => call.name === 'setScissorRect')
                .map(call => call.args)
        ).toEqual([
            [1, 0, 3, 4],
            [0, 1, 4, 3]
        ]);
        expect(harness.log).toContain('pass.setStencilReference');
        expect(harness.log).toContain('pass.draw');
        expect(harness.log).toContain('pass.drawIndexed');
        expect(
            harness.renderPassCalls.filter(call => call.name === 'draw').map(call => call.args)
        ).toEqual([
            [3, 1, 0, 0],
            [2, 2, 1, 0]
        ]);
        expect(
            harness.renderPassCalls
                .filter(call => call.name === 'drawIndexed')
                .map(call => call.args)
        ).toEqual([
            [3, 1, 0, 0, 0],
            [3, 1, 0, 0, 0]
        ]);
        expect(context.diagnostics.commandCount - diagnosticsBefore.commandCount).toBe(26);
        expect(context.diagnostics.drawCount - diagnosticsBefore.drawCount).toBe(4);
        expect(context.diagnostics.pipelineSwitches - diagnosticsBefore.pipelineSwitches).toBe(1);
        expect(context.diagnostics.bindGroupSwitches - diagnosticsBefore.bindGroupSwitches).toBe(1);
        expect(
            context.diagnostics.vertexBufferSwitches - diagnosticsBefore.vertexBufferSwitches
        ).toBe(4);
        expect(context.diagnostics.nativeStateCalls - diagnosticsBefore.nativeStateCalls).toBe(20);

        pass.end();
        const submission = device.graphicsQueue.endFrame(context);
        harness.resolveWork();
        await submission.done;
    });

    it('maps offscreen render and readback copy directly onto one native encoder', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const { pipeline, texture, view } = createTriangleResources(device);
        const readback = device.createBuffer({
            label: 'readback',
            size: 1024,
            usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.MAP_READ
        });
        harness.log.length = 0;

        const context = device.graphicsQueue.beginFrame();
        const pass = context.beginRenderPass({
            colorAttachments: [
                {
                    view,
                    clearValue: { r: 1, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();
        context.copyTextureToBuffer(
            { texture },
            { buffer: readback, bytesPerRow: 256, rowsPerImage: 4 },
            { width: 4, height: 4 }
        );
        const submission = device.graphicsQueue.endFrame(context);

        expect(harness.log).toContain('encoder.copyTextureToBuffer');
        expect(harness.log.indexOf('pass.end')).toBeLessThan(
            harness.log.indexOf('encoder.copyTextureToBuffer')
        );
        expect(harness.log.indexOf('encoder.copyTextureToBuffer')).toBeLessThan(
            harness.log.indexOf('encoder.finish')
        );
        harness.resolveWork();
        await submission.done;
    });

    it('maps layouts, bind groups, samplers, textures, and dynamic offsets natively', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const uniform = device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.UNIFORM
        });
        const sampledTexture = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.TEXTURE_BINDING
        });
        const sampledView = sampledTexture.createView();
        const sampler = device.createSampler();
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { hasDynamicOffset: true, minBindingSize: 16 }
                },
                {
                    binding: 1,
                    visibility: RHIShaderStage.FRAGMENT,
                    sampler: {}
                },
                {
                    binding: 2,
                    visibility: RHIShaderStage.FRAGMENT,
                    texture: {}
                }
            ]
        });
        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniform, size: 16 } },
                { binding: 1, resource: sampler },
                { binding: 2, resource: sampledView }
            ]
        });
        const vertex = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'vertex',
                code: 'reflected vertex WGSL',
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'uniform-buffer',
                            minBindingSize: 16
                        }
                    ],
                    vertexInputs: []
                },
                cacheKey: 11
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'fragment',
                code: 'reflected fragment WGSL',
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        { group: 0, binding: 1, kind: 'sampler' },
                        { group: 0, binding: 2, kind: 'sampled-texture' }
                    ],
                    fragmentOutputs: [{ location: 0 }]
                },
                cacheKey: 12
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        const pipeline = device.createGraphicsPipeline({
            layout,
            vertex: { shader: vertex },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: {}
        });
        const color = device.createTexture({
            size: { width: 2, height: 2 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });

        const context = device.graphicsQueue.beginFrame();
        const pass = context.beginRenderPass({
            colorAttachments: [
                {
                    view: color.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: 'clear',
                    storeOp: 'store'
                }
            ]
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup, new Uint32Array([0]));
        pass.draw(3);
        pass.end();
        const submission = device.graphicsQueue.endFrame(context);

        expect(harness.log).toContain('createSampler');
        expect(harness.log).toContain('createBindGroupLayout');
        expect(harness.log).toContain('createBindGroup');
        expect(harness.log).toContain('pass.setBindGroup');
        harness.resolveWork();
        await submission.done;
    });

    it('keeps CPU buffer and texture uploads in native command order through staging', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const source = device.createBuffer({
            label: 'ordered source',
            size: 4,
            usage: RHIBufferUsage.COPY_SRC,
            initialData: new Uint8Array([1, 1, 1, 1])
        });
        const destination = device.createBuffer({
            label: 'ordered destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const texture = device.createTexture({
            label: 'ordered texture',
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST
        });
        harness.log.length = 0;

        const context = device.graphicsQueue.beginFrame();
        context.copyBufferToBuffer(source, 0, destination, 0, 4);
        context.writeBuffer(destination, 0, new Uint8Array([2, 2, 2, 2]));
        context.writeTexture(
            { texture },
            new Uint8Array([255, 0, 0, 255]),
            {},
            { width: 1, height: 1 }
        );
        const submission = device.graphicsQueue.endFrame(context);

        const firstCopy = harness.log.indexOf(
            'encoder.copyBufferToBuffer:ordered source->ordered destination'
        );
        const bufferWrite = harness.log.indexOf(
            'encoder.copyBufferToBuffer:WebGPU upload arena->ordered destination'
        );
        const textureWrite = harness.log.indexOf(
            'encoder.copyBufferToTexture:WebGPU upload arena->ordered texture'
        );
        expect(firstCopy).toBeGreaterThanOrEqual(0);
        expect(bufferWrite).toBeGreaterThan(firstCopy);
        expect(textureWrite).toBeGreaterThan(bufferWrite);
        expect(harness.log.indexOf('queue.submit')).toBeGreaterThan(textureWrite);

        harness.resolveWork();
        await submission.done;
        expect(harness.log).not.toContain('buffer.destroy:WebGPU upload arena');
        device.destroy();
        expect(
            harness.log.filter(entry => entry === 'buffer.destroy:WebGPU upload arena')
        ).toHaveLength(1);
    });

    it('aligns shared upload-page texture offsets to the destination texel block size', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const buffer = device.createBuffer({
            label: 'alignment prefix',
            size: 8,
            usage: RHIBufferUsage.COPY_DST
        });
        const texture = device.createTexture({
            label: 'aligned rgba32 texture',
            size: { width: 1, height: 1 },
            format: 'rgba32float',
            usage: RHITextureUsage.COPY_DST
        });
        const context = device.graphicsQueue.beginFrame();

        context.writeBuffer(buffer, 0, new Uint8Array(8));
        context.writeTexture(
            { texture },
            new Float32Array([1, 0, 0, 1]),
            { bytesPerRow: 16, rowsPerImage: 1 },
            { width: 1, height: 1 }
        );
        device.graphicsQueue.endFrame(context);

        expect(harness.textureCopySources[0]?.offset).toBe(16);
        harness.resolveWork();
    });

    it('expands compressed edge mip writes to the native physical block extent', () => {
        const harness = createNativeHarness();
        (harness.device.features as unknown as Set<string>).add('texture-compression-bc');
        const device = new WebGPUDevice(harness.device);
        const texture = device.createTexture({
            label: 'compressed edge texture',
            size: { width: 4, height: 4 },
            mipLevelCount: 2,
            format: 'bc1-rgba-unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        const context = device.graphicsQueue.beginFrame();

        context.writeTexture(
            { texture, mipLevel: 1 },
            new Uint8Array(8),
            { bytesPerRow: 8, rowsPerImage: 1 },
            { width: 2, height: 2 }
        );
        device.graphicsQueue.endFrame(context);

        expect(harness.textureCopyExtents).toEqual([
            { width: 4, height: 4, depthOrArrayLayers: 1 }
        ]);
        harness.resolveWork();
    });

    it('preserves block-aligned partial compressed writes at their portable origin', () => {
        const harness = createNativeHarness();
        (harness.device.features as unknown as Set<string>).add('texture-compression-bc');
        const device = new WebGPUDevice(harness.device);
        const texture = device.createTexture({
            label: 'compressed partial texture',
            size: { width: 8, height: 16 },
            format: 'bc1-rgba-unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.TEXTURE_BINDING
        });
        const context = device.graphicsQueue.beginFrame();

        context.writeTexture(
            { texture, origin: { y: 4 } },
            new Uint8Array(32),
            { bytesPerRow: 16, rowsPerImage: 2 },
            { width: 8, height: 8 }
        );
        device.graphicsQueue.endFrame(context);

        expect(harness.textureCopyDestinations[0]?.origin).toEqual({ x: 0, y: 4, z: 0 });
        expect(harness.textureCopyExtents).toEqual([
            { width: 8, height: 8, depthOrArrayLayers: 1 }
        ]);
        harness.resolveWork();
    });

    it('copies external images immediately before encoded work with exact source/destination options', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const canvas = document.createElement('canvas');
        canvas.width = 4;
        canvas.height = 3;
        const texture = device.createTexture({
            label: 'external destination',
            size: { width: 4, height: 3 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.RENDER_ATTACHMENT
        });
        const buffer = device.createBuffer({
            label: 'encoded after external',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        harness.log.length = 0;

        const context = device.graphicsQueue.beginFrame();
        context.copyExternalImageToTexture(
            { source: canvas, origin: { x: 1, y: 1 }, flipY: true },
            {
                texture,
                origin: { x: 0, y: 0, z: 0 },
                premultipliedAlpha: true
            },
            { width: 3, height: 2 }
        );
        context.writeBuffer(buffer, 0, new Uint8Array(4));
        expect(() => {
            context.copyExternalImageToTexture({ source: canvas }, { texture }, { width: 1 });
        }).toThrow(/must precede every other frame command/u);
        const submission = device.graphicsQueue.endFrame(context);

        expect(harness.externalCopies).toHaveLength(1);
        expect(harness.externalCopies[0]?.[0]).toMatchObject({
            source: canvas,
            origin: { x: 1, y: 1 },
            flipY: true
        });
        expect(harness.externalCopies[0]?.[1]).toMatchObject({
            mipLevel: 0,
            origin: { x: 0, y: 0, z: 0 },
            aspect: 'all',
            colorSpace: 'srgb',
            premultipliedAlpha: true
        });
        expect(harness.externalCopies[0]?.[2]).toEqual({
            width: 3,
            height: 2,
            depthOrArrayLayers: 1
        });
        expect(harness.log.indexOf('queue.copyExternalImageToTexture')).toBeLessThan(
            harness.log.indexOf(
                'encoder.copyBufferToBuffer:WebGPU upload arena->encoded after external'
            )
        );
        expect(harness.log.indexOf('queue.copyExternalImageToTexture')).toBeLessThan(
            harness.log.indexOf('queue.submit')
        );

        harness.resolveWork();
        await submission.done;
    });

    it('stages video frames through a stable document canvas and skips an in-flight rewrite', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const drawImage = vi
            .spyOn(CanvasRenderingContext2D.prototype, 'drawImage')
            .mockImplementation(() => undefined);
        const video = document.createElement('video');
        Object.defineProperties(video, {
            videoWidth: { configurable: true, get: () => 4 },
            videoHeight: { configurable: true, get: () => 3 }
        });
        const texture = device.createTexture({
            label: 'video destination',
            size: { width: 4, height: 3 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.COPY_DST | RHITextureUsage.RENDER_ATTACHMENT
        });

        const first = device.graphicsQueue.beginFrame();
        first.copyExternalImageToTexture(
            { source: video, flipY: true },
            { texture },
            { width: 4, height: 3 }
        );
        const firstSubmission = device.graphicsQueue.endFrame(first);
        expect(harness.externalCopies).toHaveLength(1);
        expect(harness.externalCopies[0]?.[0].source).toBeInstanceOf(HTMLCanvasElement);
        expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 4, 3);

        const blocked = device.graphicsQueue.beginFrame();
        blocked.copyExternalImageToTexture({ source: video }, { texture }, { width: 4, height: 3 });
        const blockedSubmission = device.graphicsQueue.endFrame(blocked);
        expect(harness.externalCopies).toHaveLength(1);

        harness.resolveWork();
        await Promise.all([firstSubmission.done, blockedSubmission.done]);

        const resumed = device.graphicsQueue.beginFrame();
        resumed.copyExternalImageToTexture({ source: video }, { texture }, { width: 4, height: 3 });
        device.graphicsQueue.endFrame(resumed);
        expect(harness.externalCopies).toHaveLength(2);
        expect(drawImage).toHaveBeenCalledTimes(2);
    });

    it('keeps device construction headless and acquires a surface explicitly', () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        expect(harness.log).not.toContain('canvas.getContext:webgpu');

        const surface = device.createSurface(harness.canvas);
        expect(harness.log).toContain('canvas.getContext:webgpu');
        surface.configure({
            format: 'rgba8unorm',
            depthStencilFormat: 'depth24plus',
            width: 320,
            height: 180
        });
        const texture = surface.getCurrentTexture();
        const depth = surface.getDepthStencilTexture();

        expect(texture).toBeInstanceOf(WebGPUTexture);
        expect(depth).toBeInstanceOf(WebGPUTexture);
        expect(depth?.format).toBe('depth24plus');
        expect(harness.canvas.width).toBe(320);
        expect(harness.canvas.height).toBe(180);
        expect(harness.surfaceConfigurations[0]).toMatchObject({
            device: harness.device,
            format: 'rgba8unorm',
            alphaMode: 'opaque',
            colorSpace: 'srgb'
        });
        expect(Reflect.has(harness.surfaceConfigurations[0] ?? {}, 'presentMode')).toBe(false);
        surface.present();
        expect(surface.state).toBe('configured');
    });

    it('invalidates the previous generation and fails in-flight work on native loss', async () => {
        const harness = createNativeHarness();
        const device = new WebGPUDevice(harness.device);
        const source = device.createBuffer({
            label: 'source',
            size: 4,
            usage: RHIBufferUsage.COPY_SRC
        });
        const destination = device.createBuffer({
            label: 'destination',
            size: 4,
            usage: RHIBufferUsage.COPY_DST
        });
        const context = device.graphicsQueue.beginFrame();
        context.copyBufferToBuffer(source, 0, destination, 0, 4);
        const submission = device.graphicsQueue.endFrame(context);

        harness.loseDevice('test loss');
        const lost = await device.lost;
        await expect(submission.done).rejects.toThrow('test loss');
        expect(lost).toMatchObject({ reason: 'unknown', generation: 1 });
        expect(device.generation).toBe(2);
        expect(device.graphicsQueue.state).toBe('lost');
        expect(() => {
            device.assertUsable(source);
        }).toThrow(RHIValidationError);
        expect(harness.log).toContain('buffer.destroy:source');
        expect(harness.log).toContain('buffer.destroy:destination');
    });
});
