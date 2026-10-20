import { describe, expect, it, vi } from 'vitest';
import UniformBuffer from '../../../src/render/UniformBuffer';
import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeShader from '../../../src/render/compute/ComputeShader';
import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import { RenderGraph } from '../../../src/render/graph/RenderGraph';
import ComputeRenderPass from '../../../src/render/pipeline/passes/ComputeRenderPass';
import { BufferResourceCache } from '../../../src/render/renderer/BufferResourceCache';
import { ComputePipelineResourceCache } from '../../../src/render/renderer/ComputePipelineResourceCache';
import { ComputeSamplerResourceCache } from '../../../src/render/renderer/ComputeSamplerResourceCache';
import { FrameResourceUseTracker } from '../../../src/render/renderer/FrameResourceUseTracker';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { ScriptableBindGroupResourceCache } from '../../../src/render/renderer/ScriptableBindGroupResourceCache';
import {
    ScriptableComputeDispatch,
    type ScriptableComputeDispatchServices,
    type ScriptableComputeGraphResolver
} from '../../../src/render/renderer/ScriptableComputeDispatch';
import {
    type CompiledWgslComputeShader,
    WgslComputeShaderCompiler
} from '../../../src/render/shader/WgslComputeCompiler';
import { createStd140Layout } from '../../../src/render/ubo/Std140Layout';
import { FakeWebGPURHIBackend, type FakeRHIBuffer } from '../rhi/portable/FakeRHIBackend';

const uniformOnlyResolver: ScriptableComputeGraphResolver = {
    resolveBuffer(): never {
        throw new Error('Uniform-only compute has no graph buffer');
    },
    bufferByteLength(): never {
        throw new Error('Uniform-only compute has no graph buffer');
    },
    resolveTexture(): never {
        throw new Error('Uniform-only compute has no graph texture');
    }
};

describe('Scriptable compute graph preparation', () => {
    it('allocates and uploads uniforms only for live passes, before opening the command frame', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const graph = new RenderGraph();
        const uploads = new RHIUploadBatch(new FrameArena());
        const shader = new ComputeShader({
            source: `struct Params { value: vec4<f32> };
@group(0) @binding(0) var<uniform> params: Params;
@compute @workgroup_size(1) fn main() {}`,
            workgroupSize: [1],
            bindings: [
                { name: 'params', group: 0, binding: 0, kind: 'uniform-buffer', minBindingSize: 16 }
            ]
        });
        const compiler = new WgslComputeShaderCompiler();
        vi.spyOn(compiler, 'compile').mockImplementation(
            (): Readonly<CompiledWgslComputeShader> => {
                return {
                    source: shader.source,
                    entryPoint: shader.entryPoint,
                    workgroupSize: shader.workgroupSize,
                    bindings: shader.bindings,
                    cacheKey: 1,
                    reflection: {
                        bindings: [
                            {
                                name: 'params',
                                group: 0,
                                binding: 0,
                                kind: 'uniform-buffer',
                                minBindingSize: 16
                            }
                        ],
                        workgroupSize: shader.workgroupSize,
                        workgroupStorageSize: 0,
                        overrides: [],
                        requiresF16: false
                    }
                };
            }
        );
        const services: ScriptableComputeDispatchServices = {
            pipelines: new ComputePipelineResourceCache(registry, compiler),
            samplers: new ComputeSamplerResourceCache(registry),
            uniformBuffers: new BufferResourceCache(registry),
            resourceUses: new FrameResourceUseTracker(registry),
            bindGroups: new ScriptableBindGroupResourceCache(registry),
            frameBindGroups: {
                trackFrameBindGroup(): never {
                    throw new Error('Stable uniforms must use persistent bind groups');
                },
                releaseFrameBindGroup(): never {
                    throw new Error('Stable uniforms must use persistent bind groups');
                }
            }
        };
        const uniform = UniformBuffer.fromSchema(createStd140Layout({ value: 'vec4' }), {
            value: [1, 2, 3, 4]
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const dispatch = new ScriptableComputeDispatch();
        const createBuffer = vi.spyOn(device, 'createBuffer');
        const prepareUniform = vi.spyOn(services.uniformBuffers, 'prepareUniformBuffer');
        const createPipeline = vi.spyOn(device, 'createComputePipeline');
        const beginFrame = device.graphicsQueue.beginFrame.bind(device.graphicsQueue);
        const countsAtBegin: number[] = [];
        vi.spyOn(device.graphicsQueue, 'beginFrame').mockImplementation(options => {
            countsAtBegin.push(prepareUniform.mock.calls.length);
            return beginFrame(options);
        });

        try {
            for (let frame = 0; frame < 4; frame++) {
                const live = frame % 2 === 1;
                if (frame === 2) {
                    new Float32Array(uniform.data)[0] = 9;
                    uniform.markDirty();
                }
                uploads.reset();
                services.uniformBuffers.beginFrame(frame, uploads);
                services.resourceUses.beginFrame(frame, uploads);
                createBuffer.mockClear();
                prepareUniform.mockClear();
                const builder = graph.createBuilder();
                builder.addPass(
                    {
                        name: live ? 'Live compute' : 'Culled compute',
                        setup(declarations): void {
                            dispatch.configure(
                                pass,
                                {
                                    uniformBuffers: [uniform],
                                    buffers: [],
                                    textures: [],
                                    dispatch: { x: 1 }
                                },
                                uniformOnlyResolver,
                                services,
                                frame
                            );
                            if (live) declarations.markSideEffect();
                        },
                        prepare(context): void {
                            dispatch.prepare(context);
                            uploads.validate(device);
                        },
                        execute(context): void {
                            dispatch.execute(context);
                        }
                    },
                    undefined
                );
                expect(createBuffer).not.toHaveBeenCalled();
                expect(prepareUniform).not.toHaveBeenCalled();
                expect(uploads.pendingCount).toBe(0);
                expect(services.resourceUses.stagedUseCount).toBe(0);
                uploads.validate(device);
                const compiled = graph.compile(builder, device.capabilities);
                const execution = graph.execute(compiled, device, {
                    frameIndex: frame,
                    prePassCommands: uploads,
                    preSubmitCommands: uploads
                });
                expect(countsAtBegin.at(-1)).toBe(live ? 1 : 0);
                expect(createBuffer).toHaveBeenCalledTimes(frame === 1 ? 1 : 0);
                expect(prepareUniform).toHaveBeenCalledTimes(live ? 1 : 0);
                expect(uploads.pendingCount).toBe(frame === 3 ? 1 : 0);
                if (!live) expect(services.resourceUses.stagedUseCount).toBe(0);
                if (frame === 0) expect(createPipeline).not.toHaveBeenCalled();
                uploads.commit(execution.submission);
                dispatch.releaseFrameReferences();
                backend.completeNextSubmission();
            }
            const buffer = registry.resolve(
                services.uniformBuffers.getUniformBufferHandle(uniform)
            );
            expect(new Float32Array((buffer as FakeRHIBuffer).snapshotBytes().buffer)[0]).toBe(9);
            expect(
                backend.executionLog.filter(command => command.startsWith('dispatch:'))
            ).toHaveLength(2);
            expect(createPipeline).toHaveBeenCalledTimes(1);
        } finally {
            dispatch.releaseFrameReferences();
            uploads.rollback();
            services.bindGroups.destroy();
            services.resourceUses.destroy();
            services.uniformBuffers.destroy();
            services.pipelines.destroy();
            services.samplers.destroy();
            graph.destroy();
            registry.destroy();
            backend.destroy();
        }
    });
});
