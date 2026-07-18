import Material from '../../../src/material/Material';
import StorageGraphicsShader from '../../../src/render/compute/StorageGraphicsShader';
import { GPUDrivenPipelineResourceCache } from '../../../src/render/renderer/GPUDrivenPipelineResourceCache';
import { ResourceRegistry } from '../../../src/render/renderer/ResourceRegistry';
import { RHIShaderStage } from '../../../src/render/rhi/core';
import type {
    CompiledStorageGraphicsShader,
    StorageGraphicsShaderCompiler
} from '../../../src/render/shader/StorageGraphicsShaderCompiler';
import { describe, expect, it, vi } from 'vitest';
import { FakeWebGLRHIBackend, FakeWebGPURHIBackend } from '../rhi/portable/FakeRHIBackend';

function shader(): StorageGraphicsShader {
    return new StorageGraphicsShader({
        label: 'vertex-pulling',
        vertexSource:
            '#version 310 es\nlayout(std430) readonly buffer Data { vec4 p[]; } data; void main(){gl_Position=data.p[gl_VertexID];}',
        fragmentSource:
            '#version 310 es\nprecision highp float; layout(location=0) out vec4 color; void main(){color=vec4(1.0);}',
        bindings: [
            {
                name: 'data',
                group: 1,
                binding: 2,
                kind: 'read-only-storage-buffer',
                dynamicOffset: true,
                minBindingSize: 16
            }
        ]
    });
}

function compiled(source: StorageGraphicsShader): Readonly<CompiledStorageGraphicsShader> {
    return Object.freeze({
        backend: 'webgpu' as const,
        token: 41,
        bindings: source.bindings,
        metadata: Object.freeze({
            vertexInputs: Object.freeze([]),
            fragmentOutputs: Object.freeze([
                Object.freeze({ name: 'color', type: 'vec4', location: 0 })
            ]),
            uniformBlocks: Object.freeze([]),
            samplers: Object.freeze([]),
            storageBuffers: Object.freeze([
                Object.freeze({
                    name: 'data',
                    blockName: 'Data',
                    group: 1,
                    binding: 2,
                    stages: Object.freeze(['vertex' as const])
                })
            ])
        }),
        vertex: Object.freeze({
            backend: 'webgpu' as const,
            stage: 'vertex' as const,
            code: '@group(1) @binding(2) var<storage, read> data: array<vec4f>; @vertex fn main(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{return data[i];}',
            entryPoint: 'main',
            reflection: Object.freeze({
                bindings: Object.freeze([
                    Object.freeze({
                        name: 'data',
                        group: 1,
                        binding: 2,
                        kind: 'read-only-storage-buffer' as const,
                        minBindingSize: 16
                    })
                ]),
                vertexInputs: Object.freeze([])
            }),
            cacheKey: 82
        }),
        fragment: Object.freeze({
            backend: 'webgpu' as const,
            stage: 'fragment' as const,
            code: '@fragment fn main()->@location(0) vec4f{return vec4f(1.0);}',
            entryPoint: 'main',
            reflection: Object.freeze({
                bindings: Object.freeze([]),
                fragmentOutputs: Object.freeze([Object.freeze({ location: 0, name: 'color' })])
            }),
            cacheKey: 83
        })
    });
}

function compilerFixture(source: StorageGraphicsShader): {
    readonly compiler: StorageGraphicsShaderCompiler;
    readonly compile: ReturnType<typeof vi.fn>;
} {
    const artifact = compiled(source);
    let cacheGeneration = 0;
    const compile = vi.fn((received: StorageGraphicsShader, backend: string) => {
        expect(received).toBe(source);
        expect(backend).toBe('webgpu');
        return artifact;
    });
    const compiler = {
        get cacheGeneration() {
            return cacheGeneration;
        },
        compile,
        clear(): void {
            cacheGeneration++;
        }
    } as unknown as StorageGraphicsShaderCompiler;
    return { compiler, compile };
}

describe('GPUDrivenPipelineResourceCache', () => {
    it('memoizes ordinary scene layouts by stable vertex-layout identity', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const createPipeline = vi.spyOn(device, 'createGraphicsPipeline');
        const registry = new ResourceRegistry(device);
        const source = shader();
        const fixture = compilerFixture(source);
        const cache = new GPUDrivenPipelineResourceCache(registry, fixture.compiler);
        const material = new Material({ depthTest: false, depthMask: false, cullFace: false });
        const layouts: never[] = [];
        const snapshotLayouts = vi.spyOn(layouts, 'map');
        const target = { colorFormats: ['rgba8unorm' as const], sampleCount: 1 };

        const first = cache.prepareScene(source, material, layouts, target, 4);
        const second = cache.prepareScene(source, material, layouts, target, 4);

        expect(second).toBe(first);
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(fixture.compile).toHaveBeenCalledTimes(1);
        expect(snapshotLayouts).toHaveBeenCalledTimes(1);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('builds explicit continuous layouts and reuses one complete pipeline signature', () => {
        const backend = new FakeWebGPURHIBackend();
        const registry = new ResourceRegistry(backend.createDevice());
        const source = shader();
        const fixture = compilerFixture(source);
        const cache = new GPUDrivenPipelineResourceCache(registry, fixture.compiler);
        const material = new Material({ depthTest: false, depthMask: false, cullFace: false });
        const target = { colorFormats: ['rgba8unorm' as const], sampleCount: 1 };
        const record = cache.prepare(source, material, [], target);

        expect(cache.prepare(source, material, [], target)).toBe(record);
        expect(record.bindingPlan.bindGroupLayoutDescriptors).toHaveLength(2);
        expect(record.bindingPlan.bindGroupLayoutDescriptors[0]?.entries).toEqual([]);
        expect(record.bindingPlan.bindGroupLayoutDescriptors[1]?.entries).toEqual([
            {
                binding: 2,
                visibility: RHIShaderStage.VERTEX,
                buffer: {
                    type: 'read-only-storage',
                    hasDynamicOffset: true,
                    minBindingSize: 16
                }
            }
        ]);
        const pipeline = cache.resolvePipeline(record);
        expect(pipeline.descriptor.layout.bindGroupLayouts).toHaveLength(2);
        expect(pipeline.descriptor.vertex.buffers).toEqual([]);
        expect(fixture.compile).toHaveBeenCalledTimes(1);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('memoizes a stable procedural layout before compilation and signature construction', () => {
        const backend = new FakeWebGPURHIBackend();
        const device = backend.createDevice();
        const createPipeline = vi.spyOn(device, 'createGraphicsPipeline');
        const registry = new ResourceRegistry(device);
        const source = shader();
        const fixture = compilerFixture(source);
        const cache = new GPUDrivenPipelineResourceCache(registry, fixture.compiler);
        const material = new Material({ depthTest: false, depthMask: false, cullFace: false });
        const layouts: never[] = [];
        const snapshotLayouts = vi.spyOn(layouts, 'map');
        const target = { colorFormats: ['rgba8unorm' as const], sampleCount: 1 };

        const first = cache.prepare(source, material, layouts, target);
        expect(cache.prepare(source, material, layouts, target)).toBe(first);
        expect(fixture.compile).toHaveBeenCalledTimes(1);
        expect(createPipeline).toHaveBeenCalledTimes(1);
        expect(snapshotLayouts).toHaveBeenCalledTimes(1);

        material.cullFace = true;
        const changed = cache.prepare(source, material, layouts, target);
        expect(changed).not.toBe(first);
        expect(fixture.compile).toHaveBeenCalledTimes(1);
        expect(createPipeline).toHaveBeenCalledTimes(2);
        expect(snapshotLayouts).toHaveBeenCalledTimes(1);

        material.cullFace = false;
        expect(cache.prepare(source, material, layouts, target)).toBe(first);
        expect(fixture.compile).toHaveBeenCalledTimes(1);
        expect(createPipeline).toHaveBeenCalledTimes(2);
        expect(snapshotLayouts).toHaveBeenCalledTimes(1);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('invalidates identity memos when the shader compiler cache is cleared', () => {
        const backend = new FakeWebGPURHIBackend();
        const registry = new ResourceRegistry(backend.createDevice());
        const source = shader();
        const fixture = compilerFixture(source);
        const cache = new GPUDrivenPipelineResourceCache(registry, fixture.compiler);
        const material = new Material({ depthTest: false, depthMask: false, cullFace: false });
        const layouts = Object.freeze([]);
        const target = { colorFormats: ['rgba8unorm' as const], sampleCount: 1 };
        const first = cache.prepare(source, material, layouts, target);

        fixture.compiler.clear();
        const second = cache.prepare(source, material, layouts, target);

        expect(second).not.toBe(first);
        expect(fixture.compile).toHaveBeenCalledTimes(2);
        expect(() => cache.resolvePipeline(first)).toThrow(/stale/u);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('rebuilds shader/layout/pipeline recipes after device recovery', () => {
        const backend = new FakeWebGPURHIBackend();
        const registry = new ResourceRegistry(backend.createDevice());
        const source = shader();
        const fixture = compilerFixture(source);
        const cache = new GPUDrivenPipelineResourceCache(registry, fixture.compiler);
        const record = cache.prepare(
            source,
            new Material({ depthTest: false, depthMask: false, cullFace: false }),
            [],
            { colorFormats: ['rgba8unorm'], sampleCount: 1 }
        );
        const before = cache.resolvePipeline(record);
        registry.recover(backend.createDevice());
        const after = cache.resolvePipeline(record);

        expect(after.id).not.toBe(before.id);
        expect(before.destroyed).toBe(true);
        expect(after.descriptor.vertex.shader.artifact.cacheKey).toBe(82);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });

    it('fails closed on WebGL2 before shader compilation or registration', () => {
        const backend = new FakeWebGLRHIBackend();
        const registry = new ResourceRegistry(backend.createDevice());
        const source = shader();
        const fixture = compilerFixture(source);
        const cache = new GPUDrivenPipelineResourceCache(registry, fixture.compiler);

        expect(() =>
            cache.prepare(source, new Material(), [], {
                colorFormats: ['rgba8unorm'],
                sampleCount: 1
            })
        ).toThrow(/only by WebGPU/u);
        expect(fixture.compile).not.toHaveBeenCalled();
        expect(registry.diagnostics().trackedResourceCount).toBe(0);

        cache.destroy();
        registry.destroy();
        backend.destroy();
    });
});
