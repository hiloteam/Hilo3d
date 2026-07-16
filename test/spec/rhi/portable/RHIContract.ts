import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    RHIBufferUsage,
    RHIShaderStage,
    RHITextureUsage,
    RHIValidationError,
    type RHIBindGroupLayout,
    type RHIColorTargetState,
    type RHIGraphicsPipeline,
    type RHIPrimitiveState,
    type RHIRenderPassDescriptor,
    type RHIShaderBindingReflection,
    type RHISubmission,
    type RHITextureFormat,
    type RHIVertexBufferLayout
} from '../../../../src/render/rhi/core';
import {
    FakeWebGLRHIBackend,
    FakeWebGPURHIBackend,
    type FakeRHIBackend,
    type FakeRHIDevice,
    type FakeRHIExecutionMode
} from './FakeRHIBackend';

export interface RHIContractHarness {
    readonly backend: FakeRHIBackend;
    readonly device: FakeRHIDevice;
    readonly executionMode: FakeRHIExecutionMode;
}

export type CreateRHIContractHarness = () => RHIContractHarness;

function createPipeline(device: FakeRHIDevice): RHIGraphicsPipeline {
    const shader = device.createShader({
        label: 'contract vertex shader',
        artifact: {
            backend: device.backend,
            stage: 'vertex',
            code:
                device.backend === 'webgpu'
                    ? '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }'
                    : '#version 300 es\nvoid main() { gl_Position = vec4(0.0); }',
            entryPoint: 'main',
            reflection: { bindings: [], vertexInputs: [] },
            cacheKey: 1
        }
    });
    const layout = device.createPipelineLayout({
        label: 'contract pipeline layout',
        bindGroupLayouts: []
    });
    return device.createGraphicsPipeline({
        label: 'contract pipeline',
        layout,
        vertex: { shader, buffers: [] },
        primitive: { topology: 'triangle-list', cullMode: 'back' }
    });
}

interface ContractPipelineOptions {
    readonly bindGroupLayouts?: readonly RHIBindGroupLayout[];
    readonly vertexBindings?: readonly RHIShaderBindingReflection[];
    readonly vertexBuffers?: readonly (RHIVertexBufferLayout | null)[];
    readonly colorTargets?: readonly (RHIColorTargetState | null)[];
    readonly sampleCount?: number;
    readonly depthFormat?: RHITextureFormat;
}

function createContractPipeline(
    device: FakeRHIDevice,
    options: ContractPipelineOptions = {}
): RHIGraphicsPipeline {
    const vertexBuffers = options.vertexBuffers ?? [];
    const vertexShader = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'vertex',
            code: 'contract configurable vertex shader',
            entryPoint: 'main',
            reflection: {
                bindings: options.vertexBindings ?? [],
                vertexInputs: vertexBuffers.flatMap(buffer =>
                    buffer === null
                        ? []
                        : buffer.attributes.map(attribute => ({
                              location: attribute.shaderLocation
                          }))
                )
            },
            cacheKey: 101
        }
    });
    const colorTargets = options.colorTargets ?? [{ format: 'rgba8unorm' }];
    const fragmentShader = device.createShader({
        artifact: {
            backend: device.backend,
            stage: 'fragment',
            code: 'contract configurable fragment shader',
            entryPoint: 'main',
            reflection: {
                bindings: [],
                fragmentOutputs: colorTargets.flatMap((target, location) =>
                    target === null ? [] : [{ location }]
                )
            },
            cacheKey: 102
        }
    });
    const layout = device.createPipelineLayout({
        bindGroupLayouts: options.bindGroupLayouts ?? []
    });
    return device.createGraphicsPipeline({
        layout,
        vertex: { shader: vertexShader, buffers: vertexBuffers },
        fragment: { shader: fragmentShader, targets: colorTargets },
        primitive: {},
        ...(options.sampleCount === undefined
            ? {}
            : { multisample: { count: options.sampleCount } }),
        ...(options.depthFormat === undefined
            ? {}
            : { depthStencil: { format: options.depthFormat } })
    });
}

function createColorPass(device: FakeRHIDevice, label = 'contract pass'): RHIRenderPassDescriptor {
    const texture = device.createTexture({
        label: `${label} color`,
        size: { width: 8, height: 4 },
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT | RHITextureUsage.COPY_SRC
    });
    return {
        label,
        colorAttachments: [
            {
                view: texture.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }
        ]
    };
}

function expectValidationCode(action: () => unknown, code: RHIValidationError['code']): void {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(RHIValidationError);
        expect((error as RHIValidationError).code).toBe(code);
        return;
    }
    throw new Error(`expected RHIValidationError(${code})`);
}

async function settleSubmission(
    harness: RHIContractHarness,
    submission: RHISubmission
): Promise<void> {
    if (harness.executionMode === 'deferred') harness.backend.completeNextSubmission();
    await submission.done;
}

/** Shared Phase 1 RHI behavior contract, intentionally independent of native browser APIs. */
export function describeRHIContract(name: string, createHarness: CreateRHIContractHarness): void {
    describe(`${name} RHI contract`, () => {
        let harness: RHIContractHarness;

        beforeEach(() => {
            harness = createHarness();
        });

        afterEach(() => {
            harness.backend.destroy();
        });

        it('keeps the device headless and creates independently owned surfaces', () => {
            const { device } = harness;
            expect(device.graphicsQueue.state).toBe('idle');
            expect(harness.backend.executeCount).toBe(0);

            const firstSurface = device.createSurface(document.createElement('canvas'));
            const secondSurface = device.createSurface(document.createElement('canvas'));
            expect(firstSurface.deviceId).toBe(device.id);
            expect(secondSurface.deviceId).toBe(device.id);
            expect(firstSurface.id).not.toBe(secondSurface.id);
            expect(firstSurface.state).toBe('unconfigured');
            expect(device.graphicsQueue.state).toBe('idle');

            const configuration = {
                format: 'rgba8unorm' as const,
                depthStencilFormat: 'depth24plus' as const,
                width: 64,
                height: 32
            };
            firstSurface.configure(configuration);
            configuration.width = 1;
            expect(firstSurface.configuration).toMatchObject({
                format: 'rgba8unorm',
                depthStencilFormat: 'depth24plus',
                width: 64,
                height: 32,
                usage: RHITextureUsage.RENDER_ATTACHMENT,
                presentMode: 'fifo'
            });
            expect(Object.isFrozen(firstSurface.configuration)).toBe(true);
            const surfaceDepth = firstSurface.getDepthStencilTexture();
            expect(surfaceDepth).not.toBeNull();
            expect(surfaceDepth?.format).toBe('depth24plus');
            expect(surfaceDepth?.lifetime).toBe('persistent');

            const surfaceTexture = firstSurface.getCurrentTexture();
            expect(surfaceTexture.deviceId).toBe(device.id);
            expect(surfaceTexture.lifetime).toBe('frame');
            firstSurface.present();
            expect(firstSurface.getDepthStencilTexture()).toBe(surfaceDepth);
            expect(harness.backend.executionLog.at(-1)).toBe(`present:${String(firstSurface.id)}`);
            expect(firstSurface.state).toBe('configured');
        });

        it('snapshots, normalizes, and deeply freezes creation descriptors', () => {
            const { device } = harness;
            const initialData = new Uint8Array([1, 2, 3, 4]);
            const buffer = device.createBuffer({
                label: 'immutable buffer',
                size: 8,
                usage: RHIBufferUsage.COPY_SRC,
                initialData
            });
            initialData.fill(9);
            expect([...buffer.snapshotBytes().slice(0, 4)]).toEqual([1, 2, 3, 4]);
            expect(buffer.descriptor).toEqual({
                label: 'immutable buffer',
                lifetime: 'persistent',
                size: 8,
                usage: RHIBufferUsage.COPY_SRC,
                mappedAtCreation: false
            });
            expect(Object.isFrozen(buffer.descriptor)).toBe(true);

            const size = { width: 16, height: 8 };
            const viewFormats: RHITextureFormat[] = ['rgba8unorm-srgb'];
            const texture = device.createTexture({
                size,
                mipLevelCount: 2,
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING,
                viewFormats
            });
            size.width = 2;
            viewFormats.push('rgba8unorm');
            expect(texture.descriptor.size).toEqual({
                width: 16,
                height: 8,
                depthOrArrayLayers: 1
            });
            expect(texture.descriptor.viewDimension).toBe('2d');
            expect(texture.descriptor.viewFormats).toEqual(['rgba8unorm-srgb']);
            expect(Object.isFrozen(texture.descriptor)).toBe(true);
            expect(Object.isFrozen(texture.descriptor.size)).toBe(true);
            expect(Object.isFrozen(texture.descriptor.viewFormats)).toBe(true);

            const primitive: { topology: 'triangle-list'; cullMode: 'front' | 'back' } = {
                topology: 'triangle-list',
                cullMode: 'back'
            };
            const shader = device.createShader({
                artifact: {
                    backend: device.backend,
                    stage: 'vertex',
                    code: 'valid shader artifact',
                    entryPoint: 'main',
                    reflection: { bindings: [], vertexInputs: [] },
                    cacheKey: 2
                }
            });
            const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
            const pipeline = device.createGraphicsPipeline({
                layout,
                vertex: { shader },
                primitive: primitive satisfies RHIPrimitiveState
            });
            primitive.cullMode = 'front';
            expect(pipeline.descriptor.primitive.cullMode).toBe('back');
            expect(Object.isFrozen(pipeline.descriptor)).toBe(true);
            expect(Object.isFrozen(pipeline.descriptor.primitive)).toBe(true);
        });

        it('enforces exclusive frame and render-pass state machines', async () => {
            const { device } = harness;
            const queue = device.graphicsQueue;
            const pipeline = createPipeline(device);
            const context = queue.beginFrame({ label: 'state frame' });
            expect(queue.state).toBe('frame-open');
            expect(context.state).toBe('open');
            expectValidationCode(() => queue.beginFrame(), 'invalid-state');

            const pass = context.beginRenderPass(createColorPass(device, 'state pass'));
            expect(context.state).toBe('render-pass');
            expect(pass.state).toBe('open');
            expectValidationCode(() => {
                context.copyBufferToBuffer(
                    device.createBuffer({
                        size: 4,
                        usage: RHIBufferUsage.COPY_SRC
                    }),
                    0,
                    device.createBuffer({
                        size: 4,
                        usage: RHIBufferUsage.COPY_DST
                    }),
                    0,
                    4
                );
            }, 'invalid-state');
            pass.setPipeline(pipeline);
            pass.draw(3);
            pass.end();
            expect(pass.state).toBe('ended');
            expect(context.state).toBe('open');
            expectValidationCode(() => {
                pass.draw(3);
            }, 'invalid-state');

            const submission = queue.endFrame(context);
            expect(context.state).toBe('ended');
            expect(queue.state).toBe('idle');
            expectValidationCode(() => queue.endFrame(context), 'invalid-state');
            await settleSubmission(harness, submission);

            const abortedContext = queue.beginFrame();
            const abortedPass = abortedContext.beginRenderPass(
                createColorPass(device, 'aborted pass')
            );
            queue.abortFrame(abortedContext, new Error('contract abort'));
            expect(abortedPass.state).toBe('aborted');
            expect(abortedContext.state).toBe('aborted');
            expect(queue.state).toBe('idle');
            const reusableContext = queue.beginFrame();
            queue.abortFrame(reusableContext);
        });

        it('preserves copy/pass/draw order and produces the same buffer result', async () => {
            const { backend, device, executionMode } = harness;
            const source = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC,
                initialData: new Uint8Array([7, 11, 13, 17])
            });
            const destination = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const pipeline = createPipeline(device);
            const context = device.graphicsQueue.beginFrame();
            context.copyBufferToBuffer(source, 0, destination, 0, 4);
            const pass = context.beginRenderPass(createColorPass(device, 'ordered pass'));
            pass.setPipeline(pipeline);
            pass.draw(3);
            pass.end();

            const expected = [
                `copy-buffer:${String(source.id)}:${String(destination.id)}:4`,
                'render-pass:ordered pass:begin',
                `pipeline:${String(pipeline.id)}`,
                'draw:3',
                'render-pass:end'
            ];
            expect(backend.executionLog).toEqual(executionMode === 'immediate' ? expected : []);

            const submission = device.graphicsQueue.endFrame(context);
            expect(backend.executionLog).toEqual(expected);
            expect([...destination.snapshotBytes()]).toEqual([7, 11, 13, 17]);
            await settleSubmission(harness, submission);
        });

        it('snapshots frame uploads and orders them before later copy and draw commands', async () => {
            const { backend, device, executionMode } = harness;
            const uploadBuffer = device.createBuffer({
                size: 8,
                usage: RHIBufferUsage.COPY_DST | RHIBufferUsage.COPY_SRC
            });
            const copiedBuffer = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const uploadTexture = device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.COPY_DST
            });
            const bufferData = new Uint32Array([0x1f1d1713, 0x110d0b07]);
            const expectedBufferData = [...new Uint8Array(bufferData.buffer, 4, 4)];
            const textureData = new Uint8Array([
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16
            ]);
            const expectedTextureData = [...textureData];
            const pipeline = createPipeline(device);
            const context = device.graphicsQueue.beginFrame();
            context.writeBuffer(uploadBuffer, 0, bufferData, 4, 4);
            bufferData.fill(0xffffffff);
            context.copyBufferToBuffer(uploadBuffer, 0, copiedBuffer, 0, 4);
            context.writeTexture(
                { texture: uploadTexture },
                textureData,
                { bytesPerRow: 8 },
                { width: 2, height: 2 }
            );
            textureData.fill(255);
            const pass = context.beginRenderPass(createColorPass(device, 'upload ordered pass'));
            pass.setPipeline(pipeline);
            pass.draw(3);
            pass.end();

            const expectedLog = [
                `write-buffer:${String(uploadBuffer.id)}:0:4`,
                `copy-buffer:${String(uploadBuffer.id)}:${String(copiedBuffer.id)}:4`,
                `write-texture:${String(uploadTexture.id)}`,
                'render-pass:upload ordered pass:begin',
                `pipeline:${String(pipeline.id)}`,
                'draw:3',
                'render-pass:end'
            ];
            expect(backend.executionLog).toEqual(executionMode === 'immediate' ? expectedLog : []);
            expect([...copiedBuffer.snapshotBytes()]).toEqual(
                executionMode === 'immediate' ? expectedBufferData : [0, 0, 0, 0]
            );
            expect([...uploadTexture.snapshotLastWriteBytes()]).toEqual(
                executionMode === 'immediate' ? expectedTextureData : []
            );

            const submission = device.graphicsQueue.endFrame(context);
            expect(backend.executionLog).toEqual(expectedLog);
            expect([...uploadBuffer.snapshotBytes().slice(0, 4)]).toEqual(expectedBufferData);
            expect([...copiedBuffer.snapshotBytes()]).toEqual(expectedBufferData);
            expect([...uploadTexture.snapshotLastWriteBytes()]).toEqual(expectedTextureData);
            await settleSubmission(harness, submission);
        });

        it('validates upload state, ownership, usage, ranges, alignment, and image layouts', async () => {
            const { backend, device } = harness;
            const destination = device.createBuffer({
                size: 8,
                usage: RHIBufferUsage.COPY_DST
            });
            const wrongUsage = device.createBuffer({
                size: 8,
                usage: RHIBufferUsage.VERTEX
            });
            const mapped = device.createBuffer({
                size: 8,
                usage: RHIBufferUsage.COPY_DST,
                mappedAtCreation: true
            });
            const texture = device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.COPY_DST
            });
            const textureWithoutCopy = device.createTexture({
                size: { width: 2, height: 2 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            const foreignDevice = backend.createDevice();
            const foreignDestination = foreignDevice.createBuffer({
                size: 8,
                usage: RHIBufferUsage.COPY_DST
            });
            const destroyedDestination = device.createBuffer({
                size: 8,
                usage: RHIBufferUsage.COPY_DST
            });
            destroyedDestination.destroy();
            const opaqueDepth = device.createTexture({
                size: { width: 2, height: 2 },
                format: 'depth24plus',
                usage: RHITextureUsage.COPY_DST
            });
            const staleDevice = backend.createDevice();
            const staleDestination = staleDevice.createBuffer({
                size: 8,
                usage: RHIBufferUsage.COPY_DST
            });
            staleDevice.advanceGeneration();
            const staleContext = staleDevice.graphicsQueue.beginFrame();
            expectValidationCode(() => {
                staleContext.writeBuffer(staleDestination, 0, new Uint8Array(8));
            }, 'stale-generation');
            staleDevice.graphicsQueue.abortFrame(staleContext);
            const context = device.graphicsQueue.beginFrame();
            const data = new Uint8Array(8);

            expectValidationCode(() => {
                context.writeBuffer(wrongUsage, 0, data);
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.writeBuffer(mapped, 0, data);
            }, 'invalid-state');
            expectValidationCode(() => {
                context.writeBuffer(destination, 2, data, 0, 4);
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.writeBuffer(destination, 0, data, 2, 4);
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.writeBuffer(destination, 0, data, 0, 6);
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.writeBuffer(destination, 4, data, 4, 8);
            }, 'out-of-bounds');
            expectValidationCode(() => {
                context.writeBuffer(foreignDestination, 0, data);
            }, 'wrong-device');
            expectValidationCode(() => {
                context.writeBuffer(destroyedDestination, 0, data);
            }, 'destroyed-object');
            expectValidationCode(() => {
                context.writeTexture(
                    { texture: textureWithoutCopy },
                    new Uint8Array(16),
                    { bytesPerRow: 8 },
                    { width: 2, height: 2 }
                );
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.writeTexture(
                    { texture },
                    new Uint8Array(16),
                    { bytesPerRow: 4 },
                    { width: 2, height: 2 }
                );
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.writeTexture(
                    { texture },
                    new Uint8Array(15),
                    { bytesPerRow: 8 },
                    { width: 2, height: 2 }
                );
            }, 'out-of-bounds');
            expectValidationCode(() => {
                context.writeTexture(
                    { texture },
                    new Uint8Array(18),
                    { offset: 2, bytesPerRow: 8 },
                    { width: 2, height: 2 }
                );
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.writeTexture(
                    { texture: opaqueDepth },
                    new Uint8Array(16),
                    { bytesPerRow: 8 },
                    { width: 2, height: 2 }
                );
            }, 'unsupported-format');
            expectValidationCode(() => {
                context.writeTexture(
                    { texture },
                    new Uint8Array(24),
                    { bytesPerRow: 12 },
                    { width: 3, height: 2 }
                );
            }, 'out-of-bounds');
            expect(context.diagnostics.commandCount).toBe(0);

            const pass = context.beginRenderPass(createColorPass(device, 'upload state pass'));
            expectValidationCode(() => {
                context.writeBuffer(destination, 0, data);
            }, 'invalid-state');
            expectValidationCode(() => {
                context.writeTexture(
                    { texture },
                    new Uint8Array(16),
                    { bytesPerRow: 8 },
                    { width: 2, height: 2 }
                );
            }, 'invalid-state');
            pass.end();
            const submission = device.graphicsQueue.endFrame(context);
            expectValidationCode(() => {
                context.writeBuffer(destination, 0, data);
            }, 'invalid-state');
            await settleSubmission(harness, submission);
        });

        it('retains upload destinations until submission completion', async () => {
            const { backend, device, executionMode } = harness;
            const buffer = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const texture = device.createTexture({
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.COPY_DST
            });
            const context = device.graphicsQueue.beginFrame();
            context.writeBuffer(buffer, 0, new Uint8Array([1, 2, 3, 4]));
            context.writeTexture({ texture }, new Uint8Array([5, 6, 7, 8]), {}, { width: 1 });
            buffer.destroy();
            texture.destroy();
            expect(buffer.nativeReleased).toBe(false);
            expect(texture.nativeReleased).toBe(false);

            const submission = device.graphicsQueue.endFrame(context);
            if (executionMode === 'immediate') {
                expect(buffer.nativeReleased).toBe(true);
                expect(texture.nativeReleased).toBe(true);
            } else {
                expect(buffer.nativeReleased).toBe(false);
                expect(texture.nativeReleased).toBe(false);
                backend.completeNextSubmission();
                await submission.done;
                expect(buffer.nativeReleased).toBe(true);
                expect(texture.nativeReleased).toBe(true);
            }
            await submission.done;
        });

        it('aborts upload frames and releases retained destinations after execution failure', () => {
            const { backend, device, executionMode } = harness;
            const destination = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const context = device.graphicsQueue.beginFrame();
            const hardwareError = new Error('fake upload failure');
            let reportedError: unknown;

            if (executionMode === 'immediate') {
                backend.failNextExecute(hardwareError);
                try {
                    context.writeBuffer(destination, 0, new Uint8Array([1, 2, 3, 4]));
                } catch (error) {
                    reportedError = error;
                }
                expect(context.state).toBe('aborted');
                destination.destroy();
            } else {
                context.writeBuffer(destination, 0, new Uint8Array([1, 2, 3, 4]));
                destination.destroy();
                backend.failNextExecute(hardwareError);
                try {
                    device.graphicsQueue.endFrame(context);
                } catch (error) {
                    reportedError = error;
                }
            }

            expect(reportedError).toBe(hardwareError);
            expect(destination.nativeReleased).toBe(true);
            expect(device.graphicsQueue.state).toBe('idle');
            const nextContext = device.graphicsQueue.beginFrame();
            device.graphicsQueue.abortFrame(nextContext);
        });

        it('distinguishes synchronous submission from asynchronous completion', async () => {
            const { backend, device, executionMode } = harness;
            const submission = device.graphicsQueue.endFrame(device.graphicsQueue.beginFrame());
            let settled = false;
            void submission.done.then(() => {
                settled = true;
            });
            await Promise.resolve();

            if (executionMode === 'immediate') {
                expect(submission.status).toBe('succeeded');
                expect(settled).toBe(true);
            } else {
                expect(submission.status).toBe('pending');
                expect(settled).toBe(false);
                backend.completeNextSubmission();
                await submission.done;
                expect(submission.status).toBe('succeeded');
                expect(settled).toBe(true);
            }
            await expect(
                device.graphicsQueue.onSubmittedWorkDone(submission)
            ).resolves.toBeUndefined();
        });

        it('defers native release until the referencing submission completes', async () => {
            const { backend, device, executionMode } = harness;
            const source = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC,
                initialData: new Uint8Array([1, 2, 3, 4])
            });
            const destination = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const context = device.graphicsQueue.beginFrame();
            context.copyBufferToBuffer(source, 0, destination, 0, 4);
            source.destroy();
            expect(source.destroyed).toBe(true);
            expect(source.nativeReleased).toBe(false);
            const beforeInvalidCommand = backend.executeCount;
            expectValidationCode(() => {
                context.copyBufferToBuffer(source, 0, destination, 0, 4);
            }, 'destroyed-object');
            expect(backend.executeCount).toBe(beforeInvalidCommand);

            const submission = device.graphicsQueue.endFrame(context);
            if (executionMode === 'immediate') {
                expect(source.nativeReleased).toBe(true);
            } else {
                expect(source.nativeReleased).toBe(false);
                backend.completeNextSubmission();
                await submission.done;
                expect(source.nativeReleased).toBe(true);
            }

            const sampledTexture = device.createTexture({
                size: { width: 4, height: 4 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            const sampledView = sampledTexture.createView();
            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: RHIShaderStage.FRAGMENT,
                        texture: {}
                    }
                ]
            });
            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [{ binding: 0, resource: sampledView }]
            });
            const textureContext = device.graphicsQueue.beginFrame();
            const texturePass = textureContext.beginRenderPass(
                createColorPass(device, 'texture lifetime pass')
            );
            texturePass.setBindGroup(0, bindGroup);
            sampledTexture.destroy();
            expect(sampledTexture.nativeReleased).toBe(false);
            texturePass.end();

            const textureSubmission = device.graphicsQueue.endFrame(textureContext);
            if (executionMode === 'immediate') {
                expect(sampledTexture.nativeReleased).toBe(true);
            } else {
                expect(sampledTexture.nativeReleased).toBe(false);
                backend.completeNextSubmission();
                await textureSubmission.done;
                expect(sampledTexture.nativeReleased).toBe(true);
            }
        });

        it('fails pending work and replaces a stale queue when the device generation changes', async () => {
            const { backend, device, executionMode } = harness;
            const queue = device.graphicsQueue;
            const source = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC,
                initialData: new Uint8Array([2, 3, 5, 7])
            });
            const destination = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const context = queue.beginFrame();
            context.copyBufferToBuffer(source, 0, destination, 0, 4);
            source.destroy();
            const submission = queue.endFrame(context);
            const queuedWork = queue.onSubmittedWorkDone();

            if (executionMode === 'deferred') {
                expect(submission.status).toBe('pending');
                expect(source.nativeReleased).toBe(false);
            } else {
                expect(submission.status).toBe('succeeded');
                expect(source.nativeReleased).toBe(true);
            }

            device.advanceGeneration();

            expect(queue.state).toBe('lost');
            expect(device.graphicsQueue).not.toBe(queue);
            expect(device.graphicsQueue.deviceGeneration).toBe(device.generation);
            expectValidationCode(() => queue.beginFrame(), 'stale-generation');

            if (executionMode === 'deferred') {
                expect(submission.status).toBe('failed');
                expect(submission.error).toBeInstanceOf(Error);
                expect(source.nativeReleased).toBe(true);
                await expect(submission.done).rejects.toBe(submission.error);
                await expect(queuedWork).rejects.toBe(submission.error);
            } else {
                await expect(submission.done).resolves.toBeUndefined();
                await expect(queuedWork).resolves.toBeUndefined();
            }

            expect(queue.pendingSubmission()).toBeUndefined();
            await expect(queue.onSubmittedWorkDone()).resolves.toBeUndefined();
            expect(() => backend.completeNextSubmission()).toThrow(
                'fake backend has no pending submission'
            );

            const recoveredContext = device.graphicsQueue.beginFrame();
            device.graphicsQueue.abortFrame(recoveredContext);
        });

        it('fails pending work and clears completion tracking when the device is destroyed', async () => {
            const { backend, device, executionMode } = harness;
            const queue = device.graphicsQueue;
            const source = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC
            });
            const destination = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const context = queue.beginFrame();
            context.copyBufferToBuffer(source, 0, destination, 0, 4);
            source.destroy();
            const submission = queue.endFrame(context);
            const queuedWork = queue.onSubmittedWorkDone();

            device.destroy();

            expect(queue.state).toBe('destroyed');
            expect(source.nativeReleased).toBe(true);
            if (executionMode === 'deferred') {
                expect(submission.status).toBe('failed');
                expect(submission.error).toBeInstanceOf(Error);
                await expect(submission.done).rejects.toBe(submission.error);
                await expect(queuedWork).rejects.toBe(submission.error);
            } else {
                expect(submission.status).toBe('succeeded');
                await expect(submission.done).resolves.toBeUndefined();
                await expect(queuedWork).resolves.toBeUndefined();
            }

            expect(queue.pendingSubmission()).toBeUndefined();
            await expect(queue.onSubmittedWorkDone()).resolves.toBeUndefined();
            expect(() => backend.completeNextSubmission()).toThrow(
                'fake backend has no pending submission'
            );
        });

        it('rejects foreign owners and resources from stale device generations', () => {
            const { backend, device } = harness;
            const secondDevice = backend.createDevice();
            const foreignSource = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC
            });
            const destination = secondDevice.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            let context = secondDevice.graphicsQueue.beginFrame();
            const beforeForeignValidation = backend.executeCount;
            expectValidationCode(() => {
                context.copyBufferToBuffer(foreignSource, 0, destination, 0, 4);
            }, 'wrong-device');
            expect(backend.executeCount).toBe(beforeForeignValidation);
            secondDevice.graphicsQueue.abortFrame(context);

            const staleSource = secondDevice.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC
            });
            secondDevice.advanceGeneration();
            const currentDestination = secondDevice.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            context = secondDevice.graphicsQueue.beginFrame();
            const beforeStaleValidation = backend.executeCount;
            expectValidationCode(() => {
                context.copyBufferToBuffer(staleSource, 0, currentDestination, 0, 4);
            }, 'stale-generation');
            expect(backend.executeCount).toBe(beforeStaleValidation);
            secondDevice.graphicsQueue.abortFrame(context);
        });

        it('keeps device ownership unique across independent backend instances', () => {
            const { device, executionMode } = harness;
            const otherBackend =
                executionMode === 'immediate'
                    ? new FakeWebGLRHIBackend()
                    : new FakeWebGPURHIBackend();
            try {
                const otherDevice = otherBackend.createDevice();
                expect(otherDevice.id).not.toBe(device.id);
                const foreignSource = otherDevice.createBuffer({
                    size: 4,
                    usage: RHIBufferUsage.COPY_SRC
                });
                const destination = device.createBuffer({
                    size: 4,
                    usage: RHIBufferUsage.COPY_DST
                });
                const context = device.graphicsQueue.beginFrame();
                expectValidationCode(() => {
                    context.copyBufferToBuffer(foreignSource, 0, destination, 0, 4);
                }, 'wrong-device');
                device.graphicsQueue.abortFrame(context);
            } finally {
                otherBackend.destroy();
            }
        });

        it('validates pipeline targets, samples, and depth state against the render pass', () => {
            const { device } = harness;
            const expectRejected = (
                pipeline: RHIGraphicsPipeline,
                descriptor: RHIRenderPassDescriptor = createColorPass(device)
            ): void => {
                const context = device.graphicsQueue.beginFrame();
                const pass = context.beginRenderPass(descriptor);
                expectValidationCode(() => {
                    pass.setPipeline(pipeline);
                }, 'incompatible-layout');
                device.graphicsQueue.abortFrame(context);
            };

            expectRejected(
                createContractPipeline(device, {
                    colorTargets: [{ format: 'bgra8unorm' }]
                })
            );
            expectRejected(
                createContractPipeline(device, {
                    colorTargets: [null, { format: 'rgba8unorm' }]
                })
            );
            expectRejected(createContractPipeline(device, { sampleCount: 4 }));
            expectRejected(
                createContractPipeline(device, {
                    depthFormat: 'depth24plus'
                })
            );

            const depthTexture = device.createTexture({
                size: { width: 8, height: 4 },
                format: 'depth32float',
                usage: RHITextureUsage.RENDER_ATTACHMENT
            });
            const colorAndDepthPass: RHIRenderPassDescriptor = {
                ...createColorPass(device, 'mismatched depth pass'),
                depthStencilAttachment: {
                    view: depthTexture.createView(),
                    depthLoadOp: 'load',
                    depthStoreOp: 'store'
                }
            };
            expectRejected(
                createContractPipeline(device, { depthFormat: 'depth24plus' }),
                colorAndDepthPass
            );

            const context = device.graphicsQueue.beginFrame();
            const pass = context.beginRenderPass(createColorPass(device, 'null target pass'));
            pass.setPipeline(createContractPipeline(device, { colorTargets: [null] }));
            pass.draw(3);
            device.graphicsQueue.abortFrame(context);
        });

        it('validates dynamic offsets by binding order, alignment, count, and bounds', () => {
            const { backend, device } = harness;
            const layout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 7,
                        visibility: RHIShaderStage.VERTEX,
                        buffer: { hasDynamicOffset: true }
                    },
                    {
                        binding: 2,
                        visibility: RHIShaderStage.VERTEX,
                        buffer: { hasDynamicOffset: true }
                    }
                ]
            });
            const largeBuffer = device.createBuffer({
                size: 1024,
                usage: RHIBufferUsage.UNIFORM
            });
            const smallBuffer = device.createBuffer({
                size: 512,
                usage: RHIBufferUsage.UNIFORM
            });
            const bindGroup = device.createBindGroup({
                layout,
                entries: [
                    { binding: 7, resource: { buffer: largeBuffer, size: 256 } },
                    { binding: 2, resource: { buffer: smallBuffer, size: 256 } }
                ]
            });
            const context = device.graphicsQueue.beginFrame();
            const pass = context.beginRenderPass(createColorPass(device, 'dynamic offset pass'));
            const beforeInvalidBindings = backend.executeCount;
            expectValidationCode(() => {
                pass.setBindGroup(0, bindGroup, new Uint32Array([256]));
            }, 'incompatible-layout');
            expectValidationCode(() => {
                pass.setBindGroup(0, bindGroup, new Uint32Array([4, 512]));
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                pass.setBindGroup(0, bindGroup, new Uint32Array([512, 512]));
            }, 'out-of-bounds');
            expect(backend.executeCount).toBe(beforeInvalidBindings);

            pass.setBindGroup(0, bindGroup, new Uint32Array([256, 512]));
            device.graphicsQueue.abortFrame(context);
        });

        it('allows a pipeline switch before incompatible stale groups are rebound', () => {
            const { device } = harness;
            const entries = [
                {
                    binding: 0,
                    visibility: RHIShaderStage.VERTEX,
                    buffer: { type: 'uniform' as const }
                }
            ];
            const firstLayout = device.createBindGroupLayout({ entries });
            const secondLayout = device.createBindGroupLayout({ entries });
            const uniformBuffer = device.createBuffer({
                size: 256,
                usage: RHIBufferUsage.UNIFORM
            });
            const firstGroup = device.createBindGroup({
                layout: firstLayout,
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
            });
            const secondGroup = device.createBindGroup({
                layout: secondLayout,
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
            });
            const binding = [{ group: 0, binding: 0, kind: 'uniform-buffer' as const }];
            const firstPipeline = createContractPipeline(device, {
                bindGroupLayouts: [firstLayout],
                vertexBindings: binding
            });
            const secondPipeline = createContractPipeline(device, {
                bindGroupLayouts: [secondLayout],
                vertexBindings: binding
            });
            const context = device.graphicsQueue.beginFrame();
            const pass = context.beginRenderPass(createColorPass(device, 'pre-bound group pass'));
            pass.setPipeline(firstPipeline);
            pass.setBindGroup(0, firstGroup);
            pass.setPipeline(secondPipeline);
            expectValidationCode(() => {
                pass.draw(3);
            }, 'incompatible-layout');
            pass.setBindGroup(0, secondGroup);
            pass.draw(3);
            device.graphicsQueue.abortFrame(context);
        });

        it('requires shader-used groups and vertex buffers, plus an index buffer for indexed draws', async () => {
            const { device } = harness;
            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: RHIShaderStage.VERTEX,
                        buffer: { type: 'uniform' }
                    }
                ]
            });
            const pipeline = createContractPipeline(device, {
                bindGroupLayouts: [bindGroupLayout],
                vertexBindings: [{ group: 0, binding: 0, kind: 'uniform-buffer' }],
                vertexBuffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
                    }
                ]
            });
            const uniformBuffer = device.createBuffer({
                size: 256,
                usage: RHIBufferUsage.UNIFORM
            });
            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
            });
            const vertexBuffer = device.createBuffer({
                size: 36,
                usage: RHIBufferUsage.VERTEX
            });
            const indexBuffer = device.createBuffer({
                size: 6,
                usage: RHIBufferUsage.INDEX
            });
            const context = device.graphicsQueue.beginFrame();
            const pass = context.beginRenderPass(createColorPass(device, 'draw bindings pass'));
            pass.setPipeline(pipeline);
            expectValidationCode(() => {
                pass.draw(3);
            }, 'invalid-state');
            pass.setBindGroup(0, bindGroup);
            expectValidationCode(() => {
                pass.draw(3);
            }, 'invalid-state');
            pass.setVertexBuffer(0, vertexBuffer);
            pass.draw(3);
            expectValidationCode(() => {
                pass.drawIndexed(3);
            }, 'invalid-state');
            pass.setIndexBuffer(indexBuffer, 'uint16');
            pass.drawIndexed(3);
            pass.end();

            const submission = device.graphicsQueue.endFrame(context);
            await settleSubmission(harness, submission);
            expect(context.diagnostics.drawCount).toBe(2);
        });

        it('executes reused stable buffer and draw records through the portable contract', async () => {
            const { backend, device } = harness;
            const pipeline = createContractPipeline(device, {
                vertexBuffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }]
                    }
                ]
            });
            const vertexBuffer = device.createBuffer({
                size: 48,
                usage: RHIBufferUsage.VERTEX
            });
            const indexBuffer = device.createBuffer({
                size: 8,
                usage: RHIBufferUsage.INDEX
            });
            const vertexRecord = {
                slot: 0,
                buffer: vertexBuffer,
                offset: 0,
                size: undefined as number | undefined
            };
            const indexRecord = {
                buffer: indexBuffer,
                format: 'uint16' as const,
                offset: 0,
                size: undefined as number | undefined
            };
            const drawRecord = {
                elementCount: 3,
                instanceCount: 1,
                firstElement: 0,
                baseVertex: 0,
                firstInstance: 0
            };
            const context = device.graphicsQueue.beginFrame();
            const pass = context.beginRenderPass(createColorPass(device, 'stable record pass'));
            pass.setPipeline(pipeline);
            pass.setVertexBufferRecord(vertexRecord);
            pass.drawRecord(drawRecord);
            vertexRecord.offset = 12;
            pass.setVertexBufferRecord(vertexRecord);
            pass.setIndexBufferRecord(indexRecord);
            drawRecord.elementCount = 2;
            drawRecord.firstElement = 1;
            pass.drawIndexedRecord(drawRecord);
            pass.end();

            const submission = device.graphicsQueue.endFrame(context);
            await settleSubmission(harness, submission);
            expect(context.diagnostics.drawCount).toBe(2);
            expect(backend.executionLog).toContain('draw:3');
            expect(backend.executionLog).toContain('draw-indexed:2');
        });

        it('never executes or records a command whose validation fails', async () => {
            const { backend, device } = harness;
            const invalidSource = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.VERTEX
            });
            const destination = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const invalidAttachment = device.createTexture({
                size: { width: 4, height: 4 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.TEXTURE_BINDING
            });
            const textureCopySource = device.createBuffer({
                size: 8,
                usage: RHIBufferUsage.COPY_SRC
            });
            const textureCopyDestination = device.createTexture({
                size: { width: 1, height: 1 },
                format: 'rgba8unorm',
                usage: RHITextureUsage.COPY_DST
            });
            const context = device.graphicsQueue.beginFrame();
            expectValidationCode(() => {
                context.copyBufferToBuffer(invalidSource, 0, destination, 0, 4);
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.beginRenderPass({
                    colorAttachments: [
                        {
                            view: invalidAttachment.createView(),
                            loadOp: 'load',
                            storeOp: 'store'
                        }
                    ]
                });
            }, 'invalid-descriptor');
            expectValidationCode(() => {
                context.copyBufferToTexture(
                    { buffer: textureCopySource },
                    { texture: textureCopyDestination },
                    { width: 2 }
                );
            }, 'out-of-bounds');
            expect(context.diagnostics.commandCount).toBe(0);
            expect(backend.executeCount).toBe(0);

            const submission = device.graphicsQueue.endFrame(context);
            expect(backend.executeCount).toBe(0);
            await settleSubmission(harness, submission);
        });

        it('automatically aborts a frame and restores queue usability after an execution error', () => {
            const { backend, device, executionMode } = harness;
            const source = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_SRC,
                initialData: new Uint8Array([1, 2, 3, 4])
            });
            const destination = device.createBuffer({
                size: 4,
                usage: RHIBufferUsage.COPY_DST
            });
            const context = device.graphicsQueue.beginFrame();
            const hardwareError = new Error('fake hardware failure');
            let reportedError: unknown;

            if (executionMode === 'immediate') {
                backend.failNextExecute(hardwareError);
                try {
                    context.copyBufferToBuffer(source, 0, destination, 0, 4);
                } catch (error) {
                    reportedError = error;
                }
                expect(context.state).toBe('aborted');
                source.destroy();
                expect(source.nativeReleased).toBe(true);
            } else {
                context.copyBufferToBuffer(source, 0, destination, 0, 4);
                source.destroy();
                backend.failNextExecute(hardwareError);
                try {
                    device.graphicsQueue.endFrame(context);
                } catch (error) {
                    reportedError = error;
                }
            }

            expect(reportedError).toBe(hardwareError);
            expect(source.nativeReleased).toBe(true);
            expect(device.graphicsQueue.state).toBe('idle');
            const nextContext = device.graphicsQueue.beginFrame();
            device.graphicsQueue.abortFrame(nextContext);
        });
    });
}
