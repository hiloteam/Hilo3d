import ComputeKernel from '../../../src/render/compute/ComputeKernel';
import ComputeShader from '../../../src/render/compute/ComputeShader';
import { ComputePipelineResourceCache } from '../../../src/render/renderer/ComputePipelineResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { RHIShaderStage } from '../../../src/render/rhi/core';
import type {
    CompiledWgslComputeShader,
    WgslComputeShaderCompiler
} from '../../../src/render/shader/WgslComputeCompiler';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function computeShader(): ComputeShader {
    return new ComputeShader({
        label: 'cluster assignment',
        source: `override LIGHT_BATCH_SIZE: u32 = 64u;
override MODE: bool = false;
@compute @workgroup_size(8, 4, 1) fn main() {}`,
        workgroupSize: [8, 4, 1],
        bindings: [
            {
                name: 'globals',
                group: 0,
                binding: 0,
                kind: 'uniform-buffer',
                dynamicOffset: true,
                minBindingSize: 64
            },
            {
                name: 'lights',
                group: 0,
                binding: 1,
                kind: 'read-only-storage-buffer',
                minBindingSize: 32
            },
            {
                name: 'clusters',
                group: 2,
                binding: 0,
                kind: 'storage-buffer',
                access: 'write-discard',
                minBindingSize: 16
            },
            {
                name: 'depthPyramid',
                group: 2,
                binding: 1,
                kind: 'sampled-texture',
                sampleType: 'unfilterable-float',
                viewDimension: '2d'
            },
            {
                name: 'shadowSampler',
                group: 2,
                binding: 2,
                kind: 'non-filtering-sampler'
            },
            {
                name: 'outputImage',
                group: 2,
                binding: 3,
                kind: 'storage-texture',
                access: 'write-only',
                format: 'rgba16float',
                viewDimension: '2d'
            }
        ]
    });
}

function compiledShader(shader: ComputeShader): Readonly<CompiledWgslComputeShader> {
    return Object.freeze({
        source: shader.source,
        entryPoint: shader.entryPoint,
        workgroupSize: shader.workgroupSize,
        bindings: shader.bindings,
        reflection: Object.freeze({
            bindings: Object.freeze([
                Object.freeze({
                    name: 'globals',
                    group: 0,
                    binding: 0,
                    kind: 'uniform-buffer' as const,
                    minBindingSize: 64
                }),
                Object.freeze({
                    name: 'lights',
                    group: 0,
                    binding: 1,
                    kind: 'read-only-storage-buffer' as const,
                    minBindingSize: 32
                }),
                Object.freeze({
                    name: 'clusters',
                    group: 2,
                    binding: 0,
                    kind: 'storage-buffer' as const,
                    minBindingSize: 16
                }),
                Object.freeze({
                    name: 'depthPyramid',
                    group: 2,
                    binding: 1,
                    kind: 'sampled-texture' as const,
                    sampleType: 'unfilterable-float' as const,
                    viewDimension: '2d' as const,
                    multisampled: false
                }),
                Object.freeze({
                    name: 'shadowSampler',
                    group: 2,
                    binding: 2,
                    kind: 'sampler' as const
                }),
                Object.freeze({
                    name: 'outputImage',
                    group: 2,
                    binding: 3,
                    kind: 'storage-texture' as const,
                    storageTextureAccess: 'write-only' as const,
                    storageTextureFormat: 'rgba16float' as const,
                    viewDimension: '2d' as const
                })
            ]),
            workgroupSize: shader.workgroupSize,
            workgroupStorageSize: 0,
            overrides: Object.freeze([
                Object.freeze({ name: 'LIGHT_BATCH_SIZE', type: 'u32' as const, required: false }),
                Object.freeze({ name: 'MODE', type: 'bool' as const, required: false })
            ]),
            requiresF16: false
        }),
        cacheKey: 17
    });
}

function compilerFixture(shader: ComputeShader): {
    readonly compiler: WgslComputeShaderCompiler;
    readonly compile: ReturnType<typeof vi.fn>;
} {
    const compiled = compiledShader(shader);
    const compile = vi.fn((received: ComputeShader) => {
        expect(received).toBe(shader);
        return compiled;
    });
    return {
        compiler: { compile } as unknown as WgslComputeShaderCompiler,
        compile
    };
}

describe('ComputePipelineResourceCache', () => {
    it('reuses one shader ABI bucket while keeping kernel constants pipeline-local', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const registry = new ResourceRegistry(device);
        const shader = computeShader();
        const fixture = compilerFixture(shader);
        const cache = new ComputePipelineResourceCache(registry, fixture.compiler);
        const firstKernel = new ComputeKernel({
            label: 'cluster assignment 64',
            shader,
            constants: { LIGHT_BATCH_SIZE: 64 }
        });
        const secondKernel = new ComputeKernel({
            label: 'cluster assignment 128',
            shader,
            constants: { LIGHT_BATCH_SIZE: 128 }
        });

        const first = cache.prepare(firstKernel);
        expect(cache.prepare(firstKernel)).toBe(first);
        const second = cache.prepare(secondKernel);
        const resolvedFirst = cache.resolve(first);
        const resolvedSecond = cache.resolve(second);

        expect(fixture.compile).toHaveBeenCalledTimes(2);
        expect(first.shader).toBe(second.shader);
        expect(first.pipelineLayout).toBe(second.pipelineLayout);
        expect(first.bindGroupLayouts).toBe(second.bindGroupLayouts);
        expect(first.pipeline).not.toBe(second.pipeline);
        expect(resolvedFirst.shader).toBe(resolvedSecond.shader);
        expect(resolvedFirst.pipelineLayout).toBe(resolvedSecond.pipelineLayout);
        expect(resolvedFirst.bindGroupLayouts).toEqual(resolvedSecond.bindGroupLayouts);
        expect(resolvedFirst.pipeline).not.toBe(resolvedSecond.pipeline);
        expect(resolvedFirst.pipeline.descriptor.compute.constants).toEqual({
            LIGHT_BATCH_SIZE: 64
        });
        expect(resolvedSecond.pipeline.descriptor.compute.constants).toEqual({
            LIGHT_BATCH_SIZE: 128
        });

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('builds continuous bind groups and preserves every declared binding shape', () => {
        const backend = new FakeWebGPURHIBackend();
        const registry = new ResourceRegistry(backend.createDevice());
        const shader = computeShader();
        const fixture = compilerFixture(shader);
        const cache = new ComputePipelineResourceCache(registry, fixture.compiler);
        const record = cache.prepare(new ComputeKernel({ shader }));
        const descriptors = record.bindingPlan.bindGroupLayoutDescriptors;

        expect(descriptors).toHaveLength(3);
        expect(descriptors[0]?.entries).toEqual([
            {
                binding: 0,
                visibility: RHIShaderStage.COMPUTE,
                buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 }
            },
            {
                binding: 1,
                visibility: RHIShaderStage.COMPUTE,
                buffer: { type: 'read-only-storage', minBindingSize: 32 }
            }
        ]);
        expect(descriptors[1]?.entries).toEqual([]);
        expect(descriptors[2]?.entries).toEqual([
            {
                binding: 0,
                visibility: RHIShaderStage.COMPUTE,
                buffer: { type: 'storage', minBindingSize: 16 }
            },
            {
                binding: 1,
                visibility: RHIShaderStage.COMPUTE,
                texture: {
                    sampleType: 'unfilterable-float',
                    viewDimension: '2d',
                    multisampled: false
                }
            },
            {
                binding: 2,
                visibility: RHIShaderStage.COMPUTE,
                sampler: { type: 'non-filtering' }
            },
            {
                binding: 3,
                visibility: RHIShaderStage.COMPUTE,
                storageTexture: {
                    access: 'write-only',
                    format: 'rgba16float',
                    viewDimension: '2d'
                }
            }
        ]);
        expect(cache.resolve(record).pipeline.getBindGroupLayout(2).entries).toEqual(
            descriptors[2]?.entries
        );

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rebuilds shader, layouts, and pipeline from stable recipes after device recovery', () => {
        const backend = new FakeWebGPURHIBackend();
        const firstDevice = backend.createDevice();
        const registry = new ResourceRegistry(firstDevice);
        const shader = computeShader();
        const fixture = compilerFixture(shader);
        const cache = new ComputePipelineResourceCache(registry, fixture.compiler);
        const record = cache.prepare(new ComputeKernel({ shader, constants: { MODE: true } }));
        const before = cache.resolve(record);
        cache.markUsed(record, 3);

        const replacement = backend.createDevice();
        registry.recover(replacement);
        const after = cache.resolve(record);

        expect(after.shader.id).not.toBe(before.shader.id);
        expect(after.pipelineLayout.id).not.toBe(before.pipelineLayout.id);
        expect(after.pipeline.id).not.toBe(before.pipeline.id);
        expect(after.bindGroupLayouts.map(layout => layout.id)).not.toEqual(
            before.bindGroupLayouts.map(layout => layout.id)
        );
        expect(after.shader.artifact.cacheKey).toBe(17);
        expect(after.pipeline.descriptor.compute.constants).toEqual({ MODE: true });
        expect(fixture.compile).toHaveBeenCalledTimes(1);
        expect(before.shader.destroyed).toBe(true);
        expect(before.pipeline.destroyed).toBe(true);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('fails closed on WebGL2 before compiling or registering resources', () => {
        const backend = new FakeWebGLRHIBackend();
        const registry = new ResourceRegistry(backend.createDevice());
        const shader = computeShader();
        const fixture = compilerFixture(shader);
        const cache = new ComputePipelineResourceCache(registry, fixture.compiler);

        expect(() => cache.prepare(new ComputeKernel({ shader }))).toThrow(/only.*WebGPU/u);
        expect(fixture.compile).not.toHaveBeenCalled();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });
});
