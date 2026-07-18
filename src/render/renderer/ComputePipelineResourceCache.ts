import type { ComputeShaderBinding } from '../compute/ComputeShader';
import type ComputeShader from '../compute/ComputeShader';
import type ComputeKernel from '../compute/ComputeKernel';
import {
    RHIShaderStage,
    type RHIBindGroupLayout,
    type RHIBindGroupLayoutDescriptor,
    type RHIBindGroupLayoutEntry,
    type RHIComputePipeline,
    type RHIPipelineLayout,
    type RHIShader,
    type RHIShaderArtifactInput
} from '../rhi/core';
import type {
    CompiledWgslComputeShader,
    WgslComputeShaderCompiler
} from '../shader/WgslComputeCompiler';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

export interface ComputeBindingLayoutPlan {
    /** Continuous group-index order from zero through the highest active group. */
    readonly bindGroupLayoutDescriptors: readonly Readonly<RHIBindGroupLayoutDescriptor>[];
    /** ABI bindings sorted by group and binding. */
    readonly bindings: readonly ComputeShaderBinding[];
}

export interface ComputePipelineResourceRecord {
    readonly kernel: ComputeKernel;
    readonly bindingPlan: Readonly<ComputeBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout>;
    readonly pipeline: ResourceRegistryHandle<RHIComputePipeline>;
    readonly shader: ResourceRegistryHandle<RHIShader>;
}

export interface ResolvedComputePipelineResourceRecord {
    readonly bindingPlan: Readonly<ComputeBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly RHIBindGroupLayout[];
    readonly pipelineLayout: RHIPipelineLayout;
    readonly pipeline: RHIComputePipeline;
    readonly shader: RHIShader;
}

interface ComputeShaderBucket {
    readonly shader: ComputeShader;
    readonly bindingPlan: Readonly<ComputeBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout>;
    readonly shaderHandle: ResourceRegistryHandle<RHIShader>;
    readonly records: Set<ComputePipelineResourceRecord>;
}

function bindingLayoutEntry(binding: ComputeShaderBinding): Readonly<RHIBindGroupLayoutEntry> {
    const base = { binding: binding.binding, visibility: RHIShaderStage.COMPUTE } as const;
    switch (binding.kind) {
        case 'uniform-buffer':
            return Object.freeze({
                ...base,
                buffer: Object.freeze({
                    type: 'uniform' as const,
                    ...(binding.dynamicOffset === undefined
                        ? {}
                        : { hasDynamicOffset: binding.dynamicOffset }),
                    ...(binding.minBindingSize === undefined
                        ? {}
                        : { minBindingSize: binding.minBindingSize })
                })
            });
        case 'read-only-storage-buffer':
        case 'storage-buffer':
            return Object.freeze({
                ...base,
                buffer: Object.freeze({
                    type:
                        binding.kind === 'storage-buffer'
                            ? ('storage' as const)
                            : ('read-only-storage' as const),
                    ...(binding.dynamicOffset === undefined
                        ? {}
                        : { hasDynamicOffset: binding.dynamicOffset }),
                    ...(binding.minBindingSize === undefined
                        ? {}
                        : { minBindingSize: binding.minBindingSize })
                })
            });
        case 'sampled-texture':
            return Object.freeze({
                ...base,
                texture: Object.freeze({
                    sampleType: binding.sampleType,
                    viewDimension: binding.viewDimension ?? '2d',
                    multisampled: false
                })
            });
        case 'sampler':
            return Object.freeze({
                ...base,
                sampler: Object.freeze({ type: 'filtering' as const })
            });
        case 'non-filtering-sampler':
            return Object.freeze({
                ...base,
                sampler: Object.freeze({ type: 'non-filtering' as const })
            });
        case 'comparison-sampler':
            return Object.freeze({
                ...base,
                sampler: Object.freeze({ type: 'comparison' as const })
            });
        case 'storage-texture':
            return Object.freeze({
                ...base,
                storageTexture: Object.freeze({
                    access: binding.access,
                    format: binding.format,
                    viewDimension: binding.viewDimension ?? '2d'
                })
            });
    }
}

function compileBindingLayout(
    shader: ComputeShader,
    maxBindGroups: number
): Readonly<ComputeBindingLayoutPlan> {
    const highestGroup = shader.bindings.at(-1)?.group ?? -1;
    if (highestGroup >= maxBindGroups) {
        throw new RangeError(
            `ComputeShader binding group ${String(highestGroup)} exceeds maxBindGroups ${String(maxBindGroups)}`
        );
    }
    const descriptors: RHIBindGroupLayoutDescriptor[] = [];
    for (let group = 0; group <= highestGroup; group += 1) {
        const entries = shader.bindings
            .filter(binding => binding.group === group)
            .map(bindingLayoutEntry);
        descriptors.push(
            Object.freeze({
                label: `${shader.label || 'ComputeShader'} group ${String(group)}`,
                lifetime: 'persistent',
                entries: Object.freeze(entries)
            })
        );
    }
    return Object.freeze({
        bindGroupLayoutDescriptors: Object.freeze(descriptors),
        bindings: shader.bindings
    });
}

function computeArtifact(
    compiled: Readonly<CompiledWgslComputeShader>
): Readonly<RHIShaderArtifactInput> {
    return Object.freeze({
        backend: 'webgpu',
        stage: 'compute',
        code: compiled.source,
        entryPoint: compiled.entryPoint,
        reflection: Object.freeze({
            ...compiled.reflection,
            workgroupSize: compiled.workgroupSize
        }),
        cacheKey: compiled.cacheKey
    });
}

/** Renderer-local recoverable shader/layout/pipeline cache for immutable ComputeKernel objects. */
export class ComputePipelineResourceCache {
    #bucketByShader = new WeakMap<ComputeShader, ComputeShaderBucket>();
    #recordByKernel = new WeakMap<ComputeKernel, ComputePipelineResourceRecord>();
    readonly #buckets = new Set<ComputeShaderBucket>();
    #destroyed = false;

    constructor(
        readonly registry: ResourceRegistry,
        readonly compiler: WgslComputeShaderCompiler
    ) {}

    prepare(kernel: ComputeKernel): Readonly<ComputePipelineResourceRecord> {
        this.assertAlive();
        if (this.registry.deviceBackend !== 'webgpu') {
            throw new Error('ComputeKernel is supported only by the WebGPU renderer');
        }
        const existing = this.#recordByKernel.get(kernel);
        if (existing !== undefined) return existing;
        const compiled = this.compiler.compile(kernel.shader);
        let bucket = this.#bucketByShader.get(kernel.shader);
        let createdBucket = false;
        if (bucket === undefined) {
            bucket = this.createBucket(kernel.shader, compiled);
            this.#bucketByShader.set(kernel.shader, bucket);
            this.#buckets.add(bucket);
            createdBucket = true;
        }
        const label = kernel.label;
        const dependencies = Object.freeze([bucket.shaderHandle, bucket.pipelineLayout]);
        let pipeline: ResourceRegistryHandle<RHIComputePipeline>;
        try {
            pipeline = this.registry.register<RHIComputePipeline>({
                label,
                dependencies,
                create: (device, resolve) =>
                    device.createComputePipeline({
                        label,
                        lifetime: 'persistent',
                        layout: resolve(bucket.pipelineLayout),
                        compute: Object.freeze({
                            shader: resolve(bucket.shaderHandle),
                            ...(Object.keys(kernel.constants).length === 0
                                ? {}
                                : { constants: kernel.constants })
                        })
                    })
            });
        } catch (error) {
            if (createdBucket) this.releaseBucket(bucket);
            throw error;
        }
        const record = Object.freeze({
            kernel,
            bindingPlan: bucket.bindingPlan,
            bindGroupLayouts: bucket.bindGroupLayouts,
            pipelineLayout: bucket.pipelineLayout,
            pipeline,
            shader: bucket.shaderHandle
        });
        bucket.records.add(record);
        this.#recordByKernel.set(kernel, record);
        return record;
    }

    resolve(
        record: Readonly<ComputePipelineResourceRecord>
    ): Readonly<ResolvedComputePipelineResourceRecord> {
        this.assertAlive();
        const owned = this.requireRecord(record);
        return Object.freeze({
            bindingPlan: owned.bindingPlan,
            bindGroupLayouts: Object.freeze(
                owned.bindGroupLayouts.map(handle => this.registry.resolve(handle))
            ),
            pipelineLayout: this.registry.resolve(owned.pipelineLayout),
            pipeline: this.registry.resolve(owned.pipeline),
            shader: this.registry.resolve(owned.shader)
        });
    }

    markUsed(record: Readonly<ComputePipelineResourceRecord>, frameIndex: number): void {
        const owned = this.requireRecord(record);
        this.registry.markUsed(owned.shader, frameIndex);
        for (const layout of owned.bindGroupLayouts) this.registry.markUsed(layout, frameIndex);
        this.registry.markUsed(owned.pipelineLayout, frameIndex);
        this.registry.markUsed(owned.pipeline, frameIndex);
    }

    detach(kernel: ComputeKernel): boolean {
        this.assertAlive();
        const record = this.#recordByKernel.get(kernel);
        if (record === undefined) return false;
        const bucket = this.requireBucket(record);
        this.#recordByKernel.delete(kernel);
        bucket.records.delete(record);
        this.registry.release(record.pipeline);
        if (bucket.records.size === 0) this.releaseBucket(bucket);
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const bucket of [...this.#buckets]) this.releaseBucket(bucket);
        this.#bucketByShader = new WeakMap();
        this.#recordByKernel = new WeakMap();
        this.#destroyed = true;
    }

    private createBucket(
        shader: ComputeShader,
        compiled: Readonly<CompiledWgslComputeShader>
    ): ComputeShaderBucket {
        const artifact = computeArtifact(compiled);
        const shaderLabel = shader.label || 'ComputeShader';
        const bindingPlan = compileBindingLayout(
            shader,
            this.registry.deviceCapabilities.limits.maxBindGroups
        );
        const shaderHandle = this.registry.register<RHIShader>({
            label: shaderLabel,
            create: device => {
                if (device.backend !== 'webgpu') {
                    throw new Error(
                        'Direct WGSL compute shader cannot recover on a non-WebGPU device'
                    );
                }
                return device.createShader({
                    label: shaderLabel,
                    lifetime: 'persistent',
                    artifact
                });
            }
        });
        const bindGroupLayouts: ResourceRegistryHandle<RHIBindGroupLayout>[] = [];
        let pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout> | null = null;
        try {
            for (const descriptor of bindingPlan.bindGroupLayoutDescriptors) {
                bindGroupLayouts.push(
                    this.registry.register<RHIBindGroupLayout>({
                        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
                        create: device => device.createBindGroupLayout(descriptor)
                    })
                );
            }
            const frozenLayouts = Object.freeze(bindGroupLayouts);
            const layoutLabel = `${shaderLabel} pipeline layout`;
            pipelineLayout = this.registry.register<RHIPipelineLayout>({
                label: layoutLabel,
                dependencies: frozenLayouts,
                create: (device, resolve) =>
                    device.createPipelineLayout({
                        label: layoutLabel,
                        lifetime: 'persistent',
                        bindGroupLayouts: frozenLayouts.map(handle => resolve(handle))
                    })
            });
            return {
                shader,
                bindingPlan,
                bindGroupLayouts: frozenLayouts,
                pipelineLayout,
                shaderHandle,
                records: new Set()
            };
        } catch (error) {
            if (pipelineLayout !== null) this.registry.discardUnsubmitted(pipelineLayout);
            for (let index = bindGroupLayouts.length - 1; index >= 0; index -= 1) {
                const handle = bindGroupLayouts[index];
                if (handle !== undefined) this.registry.discardUnsubmitted(handle);
            }
            this.registry.discardUnsubmitted(shaderHandle);
            throw error;
        }
    }

    private requireRecord(
        record: Readonly<ComputePipelineResourceRecord>
    ): ComputePipelineResourceRecord {
        const owned = this.#recordByKernel.get(record.kernel);
        if (owned !== record) {
            throw new Error(
                'Compute pipeline resource record is stale or belongs to another cache'
            );
        }
        const bucket = this.#bucketByShader.get(record.kernel.shader);
        if (bucket?.records.has(owned) !== true) {
            throw new Error('Compute pipeline resource record has no live shader bucket');
        }
        return owned;
    }

    private requireBucket(record: Readonly<ComputePipelineResourceRecord>): ComputeShaderBucket {
        const owned = this.requireRecord(record);
        const bucket = this.#bucketByShader.get(owned.kernel.shader);
        if (bucket === undefined) {
            throw new Error('Compute pipeline resource record has no live shader bucket');
        }
        return bucket;
    }

    private releaseBucket(bucket: ComputeShaderBucket): void {
        for (const record of bucket.records) {
            this.#recordByKernel.delete(record.kernel);
            this.registry.release(record.pipeline);
        }
        bucket.records.clear();
        this.registry.release(bucket.pipelineLayout);
        for (const layout of bucket.bindGroupLayouts) this.registry.release(layout);
        this.registry.release(bucket.shaderHandle);
        this.#bucketByShader.delete(bucket.shader);
        this.#buckets.delete(bucket);
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Compute pipeline resource cache is destroyed');
    }
}
