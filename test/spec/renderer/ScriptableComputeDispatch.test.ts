import { describe, expect, it, vi } from 'vitest';
import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeSampler from '../../../src/render/compute/ComputeSampler';
import ComputeShader from '../../../src/render/compute/ComputeShader';
import { FrameArena } from '../../../src/render/frame/FrameArena';
import { RHIUploadBatch } from '../../../src/render/frame/RHIUploadBatch';
import type {
    RGBufferHandle,
    RGTextureHandle
} from '../../../src/render/graph/RenderGraphResource';
import type {
    RGPassContext,
    RGPrepareContext
} from '../../../src/render/graph/RenderGraphExecutor';
import ComputeRenderPass from '../../../src/render/pipeline/passes/ComputeRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphBufferReadUse,
    RenderGraphTextureHandle
} from '../../../src/render/pipeline/ScriptableRenderGraph';
import { BufferResourceCache } from '../../../src/render/renderer/BufferResourceCache';
import { ComputePipelineResourceCache } from '../../../src/render/renderer/ComputePipelineResourceCache';
import { ComputeSamplerResourceCache } from '../../../src/render/renderer/ComputeSamplerResourceCache';
import { FrameResourceUseTracker } from '../../../src/render/renderer/FrameResourceUseTracker';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import {
    ScriptableComputeDispatch,
    type ScriptableComputeFrameBindGroups,
    type ScriptableComputeGraphResolver
} from '../../../src/render/renderer/ScriptableComputeDispatch';
import {
    RHIBufferUsage,
    type RHIBindGroup,
    type RHIBuffer,
    type RHITexture,
    type RHITextureView
} from '../../../src/render/rhi/core';
import type {
    CompiledWgslComputeShader,
    WgslComputeShaderCompiler
} from '../../../src/render/shader/WgslComputeCompiler';
import { FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function publicBuffer(value: number): RenderGraphBufferHandle {
    return value as RenderGraphBufferHandle;
}

function graphBuffer(value: number): RGBufferHandle {
    return value as RGBufferHandle;
}

function publicTexture(value: number): RenderGraphTextureHandle {
    return value as RenderGraphTextureHandle;
}

function graphTexture(value: number): RGTextureHandle {
    return value as RGTextureHandle;
}

class TestGraphResolver implements ScriptableComputeGraphResolver {
    readonly buffers = new Map<RenderGraphBufferHandle, RGBufferHandle>();
    readonly sizes = new Map<RenderGraphBufferHandle, number>();
    readonly textures = new Map<RenderGraphTextureHandle, RGTextureHandle>();

    add(publicHandle: RenderGraphBufferHandle, internal: RGBufferHandle, byteLength: number): void {
        this.buffers.set(publicHandle, internal);
        this.sizes.set(publicHandle, byteLength);
    }

    addTexture(publicHandle: RenderGraphTextureHandle, internal: RGTextureHandle): void {
        this.textures.set(publicHandle, internal);
    }

    resolveBuffer(handle: RenderGraphBufferHandle, _use: RenderGraphBufferReadUse): RGBufferHandle {
        const result = this.buffers.get(handle);
        if (result === undefined) throw new Error('Missing test graph buffer');
        return result;
    }

    bufferByteLength(handle: RenderGraphBufferHandle): number {
        const result = this.sizes.get(handle);
        if (result === undefined) throw new Error('Missing test graph buffer size');
        return result;
    }

    resolveTexture(
        handle: RenderGraphTextureHandle,
        _access: 'sampled' | 'storage-write'
    ): RGTextureHandle {
        const result = this.textures.get(handle);
        if (result === undefined) throw new Error('Missing test graph texture');
        return result;
    }
}

class TestFrameBindGroups implements ScriptableComputeFrameBindGroups {
    readonly active = new Set<RHIBindGroup>();

    trackFrameBindGroup(bindGroup: RHIBindGroup): void {
        this.active.add(bindGroup);
    }

    releaseFrameBindGroup(bindGroup: RHIBindGroup): void {
        if (!this.active.delete(bindGroup)) return;
        bindGroup.destroy();
    }
}

function compiledShader(shader: ComputeShader): Readonly<CompiledWgslComputeShader> {
    return Object.freeze({
        source: shader.source,
        entryPoint: shader.entryPoint,
        workgroupSize: shader.workgroupSize,
        bindings: shader.bindings,
        reflection: Object.freeze({
            bindings: Object.freeze(
                shader.bindings.map(binding =>
                    Object.freeze({
                        name: binding.name,
                        group: binding.group,
                        binding: binding.binding,
                        kind:
                            binding.kind === 'non-filtering-sampler'
                                ? ('sampler' as const)
                                : binding.kind,
                        ...(binding.kind === 'uniform-buffer' ||
                        binding.kind === 'read-only-storage-buffer' ||
                        binding.kind === 'storage-buffer'
                            ? binding.minBindingSize === undefined
                                ? {}
                                : { minBindingSize: binding.minBindingSize }
                            : {})
                    })
                )
            ),
            workgroupSize: shader.workgroupSize,
            workgroupStorageSize: 0,
            overrides: Object.freeze([]),
            requiresF16: false
        }),
        cacheKey: 91
    });
}

function compilerFor(shader: ComputeShader): WgslComputeShaderCompiler {
    return {
        compile(received): Readonly<CompiledWgslComputeShader> {
            expect(received).toBe(shader);
            return compiledShader(shader);
        }
    } as WgslComputeShaderCompiler;
}

function prepareContexts(buffers: ReadonlyMap<RGBufferHandle, RHIBuffer>): Readonly<{
    prepare: RGPrepareContext;
    execute(commandContext: RGPassContext['commandContext']): RGPassContext;
}> {
    const getBuffer = (handle: RGBufferHandle): RHIBuffer => {
        const buffer = buffers.get(handle);
        if (buffer === undefined) throw new Error('Missing prepared buffer');
        return buffer;
    };
    const noTexture = (_handle: RGTextureHandle): RHITexture => {
        throw new Error('This compute fixture has no textures');
    };
    const noTextureView = (_handle: RGTextureHandle): RHITextureView => {
        throw new Error('This compute fixture has no textures');
    };
    return {
        prepare: { getBuffer, getTexture: noTexture, getTextureView: noTextureView },
        execute: commandContext => ({
            commandContext,
            getBuffer,
            getTexture: noTexture,
            getTextureView: noTextureView
        })
    };
}

function createServices(shader: ComputeShader) {
    const backend = new FakeWebGPURHIBackend();
    const device = backend.createDevice();
    const registry = new ResourceRegistry(device);
    const uploads = new RHIUploadBatch(new FrameArena());
    const uniformBuffers = new BufferResourceCache(registry);
    const resourceUses = new FrameResourceUseTracker(registry);
    uniformBuffers.beginFrame(7, uploads);
    resourceUses.beginFrame(7, uploads);
    return {
        backend,
        device,
        registry,
        uploads,
        services: {
            pipelines: new ComputePipelineResourceCache(registry, compilerFor(shader)),
            samplers: new ComputeSamplerResourceCache(registry),
            uniformBuffers,
            resourceUses,
            frameBindGroups: new TestFrameBindGroups()
        }
    };
}

describe('ScriptableComputeDispatch', () => {
    it('prepares positional bindings, dynamic offsets, and emits one direct dispatch', () => {
        const shader = new ComputeShader({
            source: `
@group(0) @binding(0) var<storage, read> source: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@compute @workgroup_size(8) fn main() {}`,
            workgroupSize: [8],
            bindings: [
                {
                    name: 'source',
                    group: 0,
                    binding: 0,
                    kind: 'read-only-storage-buffer',
                    dynamicOffset: true,
                    minBindingSize: 256
                },
                {
                    name: 'output',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'write-discard',
                    minBindingSize: 512
                }
            ]
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const fixture = createServices(shader);
        const sourcePublic = publicBuffer(1);
        const outputPublic = publicBuffer(2);
        const sourceInternal = graphBuffer(101);
        const outputInternal = graphBuffer(102);
        const source = fixture.device.createBuffer({
            size: 512,
            usage: RHIBufferUsage.STORAGE
        });
        const output = fixture.device.createBuffer({
            size: 512,
            usage: RHIBufferUsage.STORAGE
        });
        const resolver = new TestGraphResolver();
        resolver.add(sourcePublic, sourceInternal, 512);
        resolver.add(outputPublic, outputInternal, 512);
        const contexts = prepareContexts(
            new Map([
                [sourceInternal, source],
                [outputInternal, output]
            ])
        );
        const dispatch = new ScriptableComputeDispatch();
        const markUsed = vi.spyOn(fixture.registry, 'markUsed');

        dispatch.configure(
            pass,
            {
                buffers: [
                    { buffer: sourcePublic, byteOffset: 256, byteLength: 256 },
                    { buffer: outputPublic }
                ],
                textures: [],
                dispatch: { x: 2, y: 3 }
            },
            resolver,
            fixture.services,
            7
        );
        fixture.uploads.validate(fixture.device);
        dispatch.prepare(contexts.prepare);
        expect(fixture.services.frameBindGroups.active.size).toBe(1);

        const frame = fixture.device.graphicsQueue.beginFrame();
        fixture.uploads.flush(frame);
        dispatch.execute(contexts.execute(frame));
        expect(fixture.services.frameBindGroups.active.size).toBe(0);
        const submission = fixture.device.graphicsQueue.endFrame(frame);
        fixture.uploads.commit(submission);

        expect(fixture.backend.executionLog).toContain('dispatch:2:3:1');
        expect(markUsed).toHaveBeenCalled();
        fixture.backend.completeNextSubmission();
        fixture.services.pipelines.destroy();
        fixture.services.samplers.destroy();
        fixture.services.uniformBuffers.destroy();
        fixture.services.resourceUses.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('validates indirect dispatch range during prepare, before opening an RHI frame', () => {
        const shader = new ComputeShader({
            source: '@compute @workgroup_size(1) fn main() {}',
            workgroupSize: [1],
            bindings: []
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const fixture = createServices(shader);
        const indirectPublic = publicBuffer(3);
        const indirectInternal = graphBuffer(103);
        const indirect = fixture.device.createBuffer({
            size: 12,
            usage: RHIBufferUsage.INDIRECT
        });
        const resolver = new TestGraphResolver();
        resolver.add(indirectPublic, indirectInternal, 12);
        const contexts = prepareContexts(new Map([[indirectInternal, indirect]]));
        const dispatch = new ScriptableComputeDispatch();

        dispatch.configure(
            pass,
            {
                buffers: [],
                textures: [],
                dispatch: { indirectBuffer: indirectPublic, indirectOffset: 4 }
            },
            resolver,
            fixture.services,
            7
        );
        expect(() => {
            dispatch.prepare(contexts.prepare);
        }).toThrow(/range exceeds/u);
        expect(fixture.device.graphicsQueue.state).toBe('idle');

        fixture.uploads.rollback();
        fixture.services.pipelines.destroy();
        fixture.services.samplers.destroy();
        fixture.services.uniformBuffers.destroy();
        fixture.services.resourceUses.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('rejects partial write-discard ranges before pipeline preparation', () => {
        const shader = new ComputeShader({
            source: '@group(0) @binding(0) var<storage, read_write> output: array<u32>; @compute @workgroup_size(1) fn main() {}',
            workgroupSize: [1],
            bindings: [
                {
                    name: 'output',
                    group: 0,
                    binding: 0,
                    kind: 'storage-buffer',
                    access: 'write-discard'
                }
            ]
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const fixture = createServices(shader);
        const outputPublic = publicBuffer(4);
        const resolver = new TestGraphResolver();
        resolver.add(outputPublic, graphBuffer(104), 512);

        expect(() => {
            new ScriptableComputeDispatch().configure(
                pass,
                {
                    buffers: [{ buffer: outputPublic, byteLength: 256 }],
                    textures: [],
                    dispatch: { x: 1 }
                },
                resolver,
                fixture.services,
                7
            );
        }).toThrow(/write-discard.*complete/u);

        fixture.uploads.rollback();
        fixture.services.pipelines.destroy();
        fixture.services.samplers.destroy();
        fixture.services.uniformBuffers.destroy();
        fixture.services.resourceUses.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('rejects overlapping writable buffer aliases while allowing disjoint ranges', () => {
        const shader = new ComputeShader({
            source: `@group(0) @binding(0) var<storage, read_write> left: array<u32>;
@group(0) @binding(1) var<storage, read_write> right: array<u32>;
@compute @workgroup_size(1) fn main() {}`,
            workgroupSize: [1],
            bindings: [
                {
                    name: 'left',
                    group: 0,
                    binding: 0,
                    kind: 'storage-buffer',
                    access: 'read-write'
                },
                {
                    name: 'right',
                    group: 0,
                    binding: 1,
                    kind: 'storage-buffer',
                    access: 'read-write'
                }
            ]
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const fixture = createServices(shader);
        const firstPublic = publicBuffer(5);
        const secondPublic = publicBuffer(6);
        const sharedInternal = graphBuffer(105);
        const resolver = new TestGraphResolver();
        resolver.add(firstPublic, sharedInternal, 768);
        resolver.add(secondPublic, sharedInternal, 768);

        expect(() => {
            new ScriptableComputeDispatch().configure(
                pass,
                {
                    buffers: [
                        { buffer: firstPublic, byteLength: 512 },
                        { buffer: secondPublic, byteOffset: 256, byteLength: 256 }
                    ],
                    textures: [],
                    dispatch: { x: 1 }
                },
                resolver,
                fixture.services,
                7
            );
        }).toThrow(/left and right alias an overlapping writable buffer range/u);
        expect(() => {
            new ScriptableComputeDispatch().configure(
                pass,
                {
                    buffers: [
                        { buffer: firstPublic, byteLength: 256 },
                        { buffer: secondPublic, byteOffset: 256, byteLength: 256 }
                    ],
                    textures: [],
                    dispatch: { x: 1 }
                },
                resolver,
                fixture.services,
                7
            );
        }).not.toThrow();

        fixture.uploads.rollback();
        fixture.services.pipelines.destroy();
        fixture.services.samplers.destroy();
        fixture.services.uniformBuffers.destroy();
        fixture.services.resourceUses.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('rejects sampled or writable aliases of one storage texture view', () => {
        const shader = new ComputeShader({
            source: `@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var output: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(1) fn main() {}`,
            workgroupSize: [1],
            bindings: [
                {
                    name: 'source',
                    group: 0,
                    binding: 0,
                    kind: 'sampled-texture',
                    sampleType: 'float'
                },
                {
                    name: 'output',
                    group: 0,
                    binding: 1,
                    kind: 'storage-texture',
                    format: 'rgba8unorm',
                    access: 'write-only'
                }
            ]
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const fixture = createServices(shader);
        const sourcePublic = publicTexture(1);
        const outputPublic = publicTexture(2);
        const sharedInternal = graphTexture(201);
        const resolver = new TestGraphResolver();
        resolver.addTexture(sourcePublic, sharedInternal);
        resolver.addTexture(outputPublic, sharedInternal);

        expect(() => {
            new ScriptableComputeDispatch().configure(
                pass,
                {
                    buffers: [],
                    textures: [{ texture: sourcePublic }, { texture: outputPublic }],
                    dispatch: { x: 1 }
                },
                resolver,
                fixture.services,
                7
            );
        }).toThrow(/source and output alias a writable texture view/u);

        fixture.uploads.rollback();
        fixture.services.pipelines.destroy();
        fixture.services.samplers.destroy();
        fixture.services.uniformBuffers.destroy();
        fixture.services.resourceUses.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    });

    it('rejects filtering state for a non-filtering sampler binding', () => {
        const shader = new ComputeShader({
            source: `@group(0) @binding(0) var nearestSampler: sampler;
@compute @workgroup_size(1) fn main() {}`,
            workgroupSize: [1],
            bindings: [
                {
                    name: 'nearestSampler',
                    group: 0,
                    binding: 0,
                    kind: 'non-filtering-sampler'
                }
            ]
        });
        const pass = new ComputeRenderPass(new ComputeKernel({ shader }));
        const fixture = createServices(shader);

        expect(() => {
            new ScriptableComputeDispatch().configure(
                pass,
                {
                    buffers: [],
                    textures: [],
                    samplers: [new ComputeSampler({ magFilter: 'linear' })],
                    dispatch: { x: 1 }
                },
                new TestGraphResolver(),
                fixture.services,
                7
            );
        }).toThrow(/requires nearest filters.*maxAnisotropy 1/u);
        expect(() => {
            new ScriptableComputeDispatch().configure(
                pass,
                {
                    buffers: [],
                    textures: [],
                    samplers: [new ComputeSampler()],
                    dispatch: { x: 1 }
                },
                new TestGraphResolver(),
                fixture.services,
                7
            );
        }).not.toThrow();

        fixture.uploads.rollback();
        fixture.services.pipelines.destroy();
        fixture.services.samplers.destroy();
        fixture.services.uniformBuffers.destroy();
        fixture.services.resourceUses.destroy();
        fixture.registry.destroy();
        fixture.backend.destroy();
    });
});
