import { afterEach, describe, expect, it } from 'vitest';
import {
    RHIBufferUsage,
    RHIShaderStage,
    RHITextureUsage,
    validateRHIDispatchWorkgroupsIndirect
} from '../../../../src/render/rhi/core';
import { WebGPUDevice } from '../../../../src/render/rhi/backends/webgpu';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from './FakeRHIBackend';
import { createStructuredWebGPUMock } from './StructuredWebGPUMock';

describe('RHI compute and indirect contract', () => {
    const backends: (FakeWebGLRHIBackend | FakeWebGPURHIBackend)[] = [];

    afterEach(() => {
        for (const backend of backends) backend.destroy();
        backends.length = 0;
    });

    it('validates and records direct and indirect compute dispatches on the portable fake', () => {
        const backend = new FakeWebGPURHIBackend();
        backends.push(backend);
        const device = backend.createDevice();
        const shader = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'compute',
                code: '@compute @workgroup_size(8) fn main() {}',
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'storage-buffer',
                            minBindingSize: 4
                        }
                    ],
                    workgroupSize: [8, 1, 1],
                    workgroupStorageSize: 64,
                    overrides: []
                },
                cacheKey: 1
            }
        });
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.COMPUTE,
                    buffer: { type: 'storage', minBindingSize: 4 }
                }
            ]
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        const pipeline = device.createComputePipeline({ layout, compute: { shader } });
        const storage = device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.STORAGE | RHIBufferUsage.COPY_DST
        });
        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: storage } }]
        });
        const indirect = device.createBuffer({
            size: 12,
            usage: RHIBufferUsage.INDIRECT,
            initialData: new Uint32Array([2, 3, 4])
        });
        const vertex = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'vertex',
                code: 'vertex artifact',
                entryPoint: 'main',
                reflection: { bindings: [], vertexInputs: [] },
                cacheKey: 2
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'fragment',
                code: 'fragment artifact',
                entryPoint: 'main',
                reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
                cacheKey: 3
            }
        });
        const graphicsLayout = device.createPipelineLayout({ bindGroupLayouts: [] });
        const graphicsPipeline = device.createGraphicsPipeline({
            layout: graphicsLayout,
            vertex: { shader: vertex },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: {}
        });
        const color = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const drawArguments = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.INDIRECT,
            initialData: new Uint32Array([3, 1, 0, 0])
        });

        const frame = device.graphicsQueue.beginFrame();
        frame.clearBuffer(storage, 0, 4);
        const pass = frame.beginComputePass({ label: 'portable compute' });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(2, 3, 1);
        pass.dispatchWorkgroupsIndirect(indirect);
        pass.end();
        const renderPass = frame.beginRenderPass({
            colorAttachments: [
                {
                    view: color.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 0 }
                }
            ]
        });
        renderPass.setPipeline(graphicsPipeline);
        renderPass.drawIndirect(drawArguments);
        renderPass.end();
        const submission = device.graphicsQueue.endFrame(frame);

        expect(frame.diagnostics).toMatchObject({
            dispatchCount: 2,
            dispatchedWorkgroupCount: 6,
            bufferClearCount: 1,
            indirectDrawCount: 1,
            computePipelineSwitches: 1,
            computeBindGroupSwitches: 1
        });
        backend.completeNextSubmission();
        expect(submission.status).toBe('succeeded');
        expect(backend.executionLog).toContain('dispatch:2:3:1');
        expect(backend.executionLog).toContain(`dispatch-indirect:${String(indirect.id)}:0`);
        expect(backend.executionLog).toContain(`draw-indirect:${String(drawArguments.id)}:0`);
    });

    it('fails closed on WebGL2 before creating compute or indirect native work', () => {
        const backend = new FakeWebGLRHIBackend();
        backends.push(backend);
        const device = backend.createDevice();

        expect(() =>
            device.createShader({
                artifact: {
                    backend: 'webgl2',
                    stage: 'compute',
                    code: '#version 300 es\nvoid main() {}',
                    entryPoint: 'main',
                    reflection: { bindings: [], workgroupSize: [1, 1, 1] },
                    cacheKey: 1
                }
            })
        ).toThrow(expect.objectContaining({ code: 'unsupported-feature' }));

        const frame = device.graphicsQueue.beginFrame();
        expect(() => frame.beginComputePass()).toThrow(
            expect.objectContaining({ code: 'unsupported-feature', path: 'computePass' })
        );
        const buffer = device.createBuffer({ size: 4, usage: RHIBufferUsage.COPY_DST });
        expect(() => {
            frame.clearBuffer(buffer);
        }).toThrow(expect.objectContaining({ code: 'unsupported-feature', path: 'clearBuffer' }));
        device.graphicsQueue.abortFrame(frame);
        expect(backend.executionLog).toEqual([]);
    });

    it('rejects invalid workgroup, clear, and indirect ranges before command encoding', () => {
        const backend = new FakeWebGPURHIBackend();
        backends.push(backend);
        const device = backend.createDevice();
        expect(() =>
            device.createShader({
                artifact: {
                    backend: 'webgpu',
                    stage: 'compute',
                    code: '@compute @workgroup_size(1) fn main() {}',
                    entryPoint: 'main',
                    reflection: { bindings: [] },
                    cacheKey: 1
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'shader.artifact.reflection.workgroupSize'
            })
        );
        expect(() =>
            device.createShader({
                artifact: {
                    backend: 'webgpu',
                    stage: 'compute',
                    code: '@compute @workgroup_size(1) fn main() {}',
                    entryPoint: 'main',
                    reflection: { bindings: [], workgroupSize: [1, 1, 1], overrides: [] },
                    cacheKey: 2
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'shader.artifact.reflection.workgroupStorageSize'
            })
        );
        expect(() =>
            device.createShader({
                artifact: {
                    backend: 'webgpu',
                    stage: 'compute',
                    code: '@compute @workgroup_size(1) fn main() {}',
                    entryPoint: 'main',
                    reflection: {
                        bindings: [],
                        workgroupSize: [1, 1, 1],
                        workgroupStorageSize: 0
                    },
                    cacheKey: 3
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'shader.artifact.reflection.overrides'
            })
        );
        expect(() =>
            device.createShader({
                artifact: {
                    backend: 'webgpu',
                    stage: 'compute',
                    code: '@compute @workgroup_size(1) fn main() {}',
                    entryPoint: 'main',
                    reflection: {
                        bindings: [],
                        workgroupSize: [1, 1, 1],
                        workgroupStorageSize: 0,
                        overrides: [{ name: 'bad-name', type: 'u32', required: false }]
                    },
                    cacheKey: 4
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'shader.artifact.reflection.overrides[0].name'
            })
        );

        const frame = device.graphicsQueue.beginFrame();
        const clearTarget = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.COPY_DST
        });
        expect(() => {
            frame.clearBuffer(clearTarget, 2, 4);
        }).toThrow(
            expect.objectContaining({ code: 'invalid-descriptor', path: 'clearBuffer.offset' })
        );
        const indirect = device.createBuffer({ size: 12, usage: RHIBufferUsage.INDIRECT });
        expect(() => {
            frame.clearBuffer(indirect);
        }).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'clearBuffer.buffer.usage'
            })
        );
        expect(() => {
            validateRHIDispatchWorkgroupsIndirect(device, indirect, 4);
        }).toThrow(
            expect.objectContaining({ code: 'out-of-bounds', path: 'dispatchWorkgroupsIndirect' })
        );
        device.graphicsQueue.abortFrame(frame);
    });

    it('executes compute, clearBuffer, and indirect dispatch through structured WebGPU', async () => {
        const mock = createStructuredWebGPUMock();
        const device = new WebGPUDevice(mock.device);
        const shader = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'compute',
                code: `override SCALE: u32 = 1u;
@group(0) @binding(0) var<storage, read_write> output: array<u32>;`,
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'storage-buffer',
                            minBindingSize: 4
                        }
                    ],
                    workgroupSize: [1, 1, 1],
                    workgroupStorageSize: 0,
                    overrides: [{ name: 'SCALE', type: 'u32', required: false }]
                },
                cacheKey: 7
            }
        });
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.COMPUTE,
                    buffer: { type: 'storage', minBindingSize: 4 }
                }
            ]
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        const pipeline = device.createComputePipeline({
            label: 'structured compute',
            layout,
            compute: { shader, constants: { SCALE: 2 } }
        });
        const output = device.createBuffer({
            size: 256,
            usage: RHIBufferUsage.STORAGE | RHIBufferUsage.COPY_DST | RHIBufferUsage.COPY_SRC,
            initialData: new Uint32Array([99])
        });
        const indirect = device.createBuffer({
            size: 12,
            usage: RHIBufferUsage.INDIRECT,
            initialData: new Uint32Array([2, 3, 4])
        });
        const readback = device.createBuffer({
            size: 4,
            usage: RHIBufferUsage.MAP_READ | RHIBufferUsage.COPY_DST
        });
        const bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: output } }]
        });
        const vertex = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'vertex',
                code: '@vertex fn main() -> @builtin(position) vec4f { return vec4f(); }',
                entryPoint: 'main',
                reflection: { bindings: [], vertexInputs: [] },
                cacheKey: 8
            }
        });
        const fragment = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'fragment',
                code: '@fragment fn main() -> @location(0) vec4f { return vec4f(1); }',
                entryPoint: 'main',
                reflection: { bindings: [], fragmentOutputs: [{ location: 0 }] },
                cacheKey: 9
            }
        });
        const graphicsLayout = device.createPipelineLayout({ bindGroupLayouts: [] });
        const graphicsPipeline = device.createGraphicsPipeline({
            label: 'structured indirect graphics',
            layout: graphicsLayout,
            vertex: { shader: vertex },
            fragment: { shader: fragment, targets: [{ format: 'rgba8unorm' }] },
            primitive: {}
        });
        const color = device.createTexture({
            size: { width: 1, height: 1 },
            format: 'rgba8unorm',
            usage: RHITextureUsage.RENDER_ATTACHMENT
        });
        const drawArguments = device.createBuffer({
            size: 16,
            usage: RHIBufferUsage.INDIRECT,
            initialData: new Uint32Array([3, 1, 0, 0])
        });

        const frame = device.graphicsQueue.beginFrame();
        frame.clearBuffer(output, 0, 4);
        const pass = frame.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(2, 2, 2);
        pass.dispatchWorkgroupsIndirect(indirect);
        pass.end();
        const renderPass = frame.beginRenderPass({
            colorAttachments: [
                {
                    view: color.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 0 }
                }
            ]
        });
        renderPass.setPipeline(graphicsPipeline);
        renderPass.drawIndirect(drawArguments);
        renderPass.end();
        frame.copyBufferToBuffer(output, 0, readback, 0, 4);
        await device.graphicsQueue.endFrame(frame).done;
        await readback.mapAsync('read', 0, 4);
        expect(new DataView(readback.getMappedRange(0, 4)).getUint32(0, true)).toBe(24);
        readback.unmap();

        expect(frame.diagnostics).toMatchObject({
            dispatchCount: 2,
            dispatchedWorkgroupCount: 8,
            bufferClearCount: 1,
            indirectDrawCount: 1,
            computePipelineSwitches: 1,
            computeBindGroupSwitches: 1
        });
        expect(mock.log).toEqual(
            expect.arrayContaining([
                'encoder.clearBuffer',
                'encoder.beginComputePass',
                'computePass.dispatchWorkgroups',
                'computePass.dispatchWorkgroupsIndirect',
                'pass.drawIndirect'
            ])
        );
        device.destroy();
    });

    it('reports precise compute pipeline limit and layout mismatches', () => {
        const backend = new FakeWebGPURHIBackend();
        backends.push(backend);
        const device = backend.createDevice();
        const shader = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'compute',
                code: '@compute @workgroup_size(257) fn main() {}',
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    workgroupSize: [257, 1, 1],
                    workgroupStorageSize: 0,
                    overrides: []
                },
                cacheKey: 1
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
        expect(() => device.createComputePipeline({ layout, compute: { shader } })).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.shader.artifact.reflection.workgroupSize[0]'
            })
        );

        const storageShader = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'compute',
                code: '@compute @workgroup_size(1) fn main() {}',
                entryPoint: 'main',
                reflection: {
                    bindings: [
                        {
                            group: 0,
                            binding: 0,
                            kind: 'storage-texture',
                            storageTextureAccess: 'write-only',
                            storageTextureFormat: 'rgba8unorm',
                            viewDimension: '2d'
                        }
                    ],
                    workgroupSize: [1, 1, 1],
                    workgroupStorageSize: 0,
                    overrides: []
                },
                cacheKey: 2
            }
        });
        const storageLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: RHIShaderStage.COMPUTE,
                    storageTexture: { access: 'read-only', format: 'rgba8unorm' }
                }
            ]
        });
        const storagePipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [storageLayout]
        });
        expect(() =>
            device.createComputePipeline({
                layout: storagePipelineLayout,
                compute: { shader: storageShader }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'incompatible-layout',
                path: 'computePipeline.compute.shader.artifact.reflection.bindings[0]'
            })
        );
    });

    it('rejects excess workgroup storage before creating a compute pipeline', () => {
        const backend = new FakeWebGPURHIBackend();
        backends.push(backend);
        const device = backend.createDevice();
        const shader = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'compute',
                code: '@compute @workgroup_size(1) fn main() {}',
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    workgroupSize: [1, 1, 1],
                    workgroupStorageSize: 16_385,
                    overrides: []
                },
                cacheKey: 3
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });

        expect(() => device.createComputePipeline({ layout, compute: { shader } })).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.shader.artifact.reflection.workgroupStorageSize'
            })
        );
    });

    it('validates the complete typed override ABI before native pipeline creation', () => {
        const backend = new FakeWebGPURHIBackend();
        backends.push(backend);
        const device = backend.createDevice();
        const shader = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'compute',
                code: '@compute @workgroup_size(1) fn main() {}',
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    workgroupSize: [1, 1, 1],
                    workgroupStorageSize: 0,
                    overrides: [
                        { name: 'ENABLED', type: 'bool', required: true },
                        { name: 'OFFSET', type: 'i32', required: true },
                        { name: 'COUNT', type: 'u32', required: false },
                        { name: 'SCALE', type: 'f32', required: false },
                        { name: 'HALF_SCALE', type: 'f16', required: false }
                    ],
                    requiresF16: true
                },
                cacheKey: 4
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
        const valid = device.createComputePipeline({
            layout,
            compute: { shader, constants: { ENABLED: true, OFFSET: -1 } }
        });

        expect(valid.descriptor.compute.constants).toEqual({ ENABLED: true, OFFSET: -1 });
        expect(Object.isFrozen(shader.artifact.reflection.overrides)).toBe(true);
        expect(Object.isFrozen(shader.artifact.reflection.overrides?.[0])).toBe(true);
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true, OFFSET: 0, UNKNOWN: 1 } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'computePipeline.compute.constants.UNKNOWN'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'computePipeline.compute.constants.OFFSET'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: 1, OFFSET: 0 } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'computePipeline.compute.constants.ENABLED'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true, OFFSET: 0.5 } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.constants.OFFSET'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true, OFFSET: 0, COUNT: -1 } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.constants.COUNT'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: {
                    shader,
                    constants: { ENABLED: true, OFFSET: 0, COUNT: 0x1_0000_0000 }
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.constants.COUNT'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true, OFFSET: 0x8000_0000 } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.constants.OFFSET'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: {
                    shader,
                    constants: { ENABLED: true, OFFSET: 0, SCALE: Number.MAX_VALUE }
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.constants.SCALE'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: {
                    shader,
                    constants: { ENABLED: true, OFFSET: 0, HALF_SCALE: Number.MAX_VALUE }
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'out-of-bounds',
                path: 'computePipeline.compute.constants.HALF_SCALE'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true, OFFSET: 0, SCALE: Number.NaN } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'computePipeline.compute.constants.SCALE'
            })
        );
        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true, OFFSET: 0, SCALE: true } }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'invalid-descriptor',
                path: 'computePipeline.compute.constants.SCALE'
            })
        );
    });

    it('rejects reflected f16 use when shader-f16 was not enabled on the device', () => {
        const mock = createStructuredWebGPUMock();
        const device = new WebGPUDevice(mock.device);

        expect(() =>
            device.createShader({
                artifact: {
                    backend: 'webgpu',
                    stage: 'compute',
                    code: 'enable f16; @compute @workgroup_size(1) fn main() {}',
                    entryPoint: 'main',
                    reflection: {
                        bindings: [],
                        workgroupSize: [1, 1, 1],
                        workgroupStorageSize: 0,
                        overrides: [],
                        requiresF16: true
                    },
                    cacheKey: 5
                }
            })
        ).toThrow(
            expect.objectContaining({
                code: 'unsupported-feature',
                path: 'shader.artifact.reflection.requiresF16'
            })
        );
        device.destroy();
    });

    it('never forwards invalid override values to native WebGPU', () => {
        const mock = createStructuredWebGPUMock();
        const device = new WebGPUDevice(mock.device);
        const shader = device.createShader({
            artifact: {
                backend: 'webgpu',
                stage: 'compute',
                code: '@compute @workgroup_size(1) fn main() {}',
                entryPoint: 'main',
                reflection: {
                    bindings: [],
                    workgroupSize: [1, 1, 1],
                    workgroupStorageSize: 0,
                    overrides: [
                        { name: 'ENABLED', type: 'bool', required: true },
                        { name: 'COUNT', type: 'u32', required: true }
                    ]
                },
                cacheKey: 6
            }
        });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [] });

        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true, COUNT: -1 } }
            })
        ).toThrow(expect.objectContaining({ code: 'out-of-bounds' }));
        expect(mock.computePipelineDescriptors).toHaveLength(0);

        device.createComputePipeline({
            layout,
            compute: { shader, constants: { ENABLED: true, COUNT: 2 } }
        });
        expect(mock.computePipelineDescriptors).toHaveLength(1);
        expect(mock.computePipelineDescriptors[0]?.compute.constants).toEqual({
            ENABLED: 1,
            COUNT: 2
        });

        expect(() =>
            device.createComputePipeline({
                layout,
                compute: { shader, constants: { ENABLED: true } }
            })
        ).toThrow(expect.objectContaining({ code: 'invalid-descriptor' }));
        expect(mock.computePipelineDescriptors).toHaveLength(1);
        device.destroy();
    });
});
