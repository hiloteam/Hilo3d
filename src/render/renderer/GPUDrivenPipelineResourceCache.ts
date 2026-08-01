import { TRIANGLES } from '../../constants/webgl';
import type { CameraDepthMode } from '../../camera/Camera';
import type Material from '../../material/Material';
import type { ShaderReadBinding } from '../compute/ComputeShader';
import type StorageGraphicsShader from '../compute/StorageGraphicsShader';
import type { GPUDrivenVertexBufferLayout } from '../pipeline/passes/GPUDrivenRenderPass';
import {
    RHIShaderStage,
    type RHIBindGroupLayout,
    type RHIBindGroupLayoutDescriptor,
    type RHIBindGroupLayoutEntry,
    type RHIGraphicsPipeline,
    type RHIIndexFormat,
    type RHIPipelineLayout,
    type RHIShader,
    type RHIShaderArtifactInput,
    type RHIShaderBindingReflection,
    type RHIShaderStageFlags,
    type RHIVertexBufferLayout
} from '../rhi/core';
import type {
    CompiledStorageGraphicsShader,
    StorageGraphicsShaderCompiler
} from '../shader/StorageGraphicsShaderCompiler';
import {
    compileShaderBindingLayout,
    type ShaderBindingLayoutPlan
} from './ShaderBindingLayoutCompiler';
import {
    createRHIMeshDrawPipelineState,
    type RHIMeshDrawTargetDescriptor
} from './RHIDescriptorMapping';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

/** Explicit renderer-local layout plan for storage-aware graphics bindings. */
export interface GPUDrivenBindingLayoutPlan extends ShaderBindingLayoutPlan {
    readonly bindings: readonly ShaderReadBinding[];
}

/** Recovery-aware logical resources needed by one storage-aware graphics pipeline. */
export interface GPUDrivenPipelineResourceRecord {
    readonly shader: StorageGraphicsShader;
    readonly bindingPlan: Readonly<GPUDrivenBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout>;
    readonly vertexShader: ResourceRegistryHandle<RHIShader>;
    readonly fragmentShader: ResourceRegistryHandle<RHIShader>;
    readonly pipeline: ResourceRegistryHandle<RHIGraphicsPipeline>;
    readonly vertexLayouts: readonly Readonly<RHIVertexBufferLayout>[];
    readonly shaderToken: number;
    readonly bindingLayoutToken: number;
}

interface GPUDrivenShaderBucket {
    readonly shader: StorageGraphicsShader;
    readonly compiled: Readonly<CompiledStorageGraphicsShader>;
    readonly compilerGeneration: number | undefined;
    readonly shaderToken: number;
    readonly bindingLayoutToken: number;
    readonly bindingPlan: Readonly<GPUDrivenBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout>;
    readonly vertexShader: ResourceRegistryHandle<RHIShader>;
    readonly fragmentShader: ResourceRegistryHandle<RHIShader>;
    readonly recordsBySignature: Map<string, GPUDrivenPipelineResourceRecord>;
    readonly records: Set<GPUDrivenPipelineResourceRecord>;
    readonly proceduralLayouts: WeakMap<object, VertexLayoutMemo>;
    readonly sceneLayouts: WeakMap<object, VertexLayoutMemo>;
}

interface VertexLayoutMemo {
    readonly vertexLayouts: readonly Readonly<RHIVertexBufferLayout>[];
    readonly states: PipelineStateMemo[];
}

interface CompiledShaderMemo {
    readonly compilerGeneration: number | undefined;
    readonly compiled: Readonly<CompiledStorageGraphicsShader>;
}

interface PipelineStateMemo {
    readonly depthMode: CameraDepthMode;
    readonly material: Material;
    readonly primitiveMode: number;
    readonly stripIndexFormat: RHIIndexFormat | undefined;
    readonly wireframe: boolean;
    readonly frontFace: number;
    readonly cullFace: boolean;
    readonly cullFaceType: number;
    readonly depthTest: boolean;
    readonly depthMask: boolean;
    readonly depthRangeMin: number;
    readonly depthRangeMax: number;
    readonly depthFunc: number;
    readonly transparent: boolean;
    readonly premultiplyAlpha: boolean;
    readonly blend: boolean;
    readonly blendEquation: number;
    readonly blendEquationAlpha: number;
    readonly blendSrc: number;
    readonly blendDst: number;
    readonly blendSrcAlpha: number;
    readonly blendDstAlpha: number;
    readonly stencilTest: boolean;
    readonly stencilMask: number;
    readonly stencilFunc: number;
    readonly stencilFuncMask: number;
    readonly stencilOpFail: number;
    readonly stencilOpZFail: number;
    readonly stencilOpZPass: number;
    readonly sampleAlphaToCoverage: boolean;
    readonly colorFormats: readonly RHIMeshDrawTargetDescriptor['colorFormats'][number][];
    readonly depthStencilFormat: RHIMeshDrawTargetDescriptor['depthStencilFormat'];
    readonly sampleCount: number;
    readonly record: Readonly<GPUDrivenPipelineResourceRecord>;
}

function samePipelineStateMemo(
    memo: PipelineStateMemo,
    material: Material,
    target: RHIMeshDrawTargetDescriptor,
    primitiveMode: number,
    stripIndexFormat: RHIIndexFormat | undefined,
    depthMode: CameraDepthMode
): boolean {
    if (
        memo.material !== material ||
        memo.depthMode !== depthMode ||
        memo.primitiveMode !== primitiveMode ||
        memo.stripIndexFormat !== stripIndexFormat ||
        memo.colorFormats.length !== target.colorFormats.length ||
        memo.depthStencilFormat !== target.depthStencilFormat ||
        memo.sampleCount !== target.sampleCount
    ) {
        return false;
    }
    for (let index = 0; index < memo.colorFormats.length; index += 1) {
        if (memo.colorFormats[index] !== target.colorFormats[index]) return false;
    }
    return (
        memo.wireframe === material.wireframe &&
        memo.frontFace === material.frontFace &&
        memo.cullFace === material.cullFace &&
        memo.cullFaceType === material.cullFaceType &&
        memo.depthTest === material.depthTest &&
        memo.depthMask === material.depthMask &&
        memo.depthRangeMin === material.depthRange[0] &&
        memo.depthRangeMax === material.depthRange[1] &&
        memo.depthFunc === material.depthFunc &&
        memo.transparent === material.transparent &&
        memo.premultiplyAlpha === material.premultiplyAlpha &&
        memo.blend === material.blend &&
        memo.blendEquation === material.blendEquation &&
        memo.blendEquationAlpha === material.blendEquationAlpha &&
        memo.blendSrc === material.blendSrc &&
        memo.blendDst === material.blendDst &&
        memo.blendSrcAlpha === material.blendSrcAlpha &&
        memo.blendDstAlpha === material.blendDstAlpha &&
        memo.stencilTest === material.stencilTest &&
        memo.stencilMask === material.stencilMask &&
        memo.stencilFunc === material.stencilFunc &&
        memo.stencilFuncMask === material.stencilFuncMask &&
        memo.stencilOpFail === material.stencilOpFail &&
        memo.stencilOpZFail === material.stencilOpZFail &&
        memo.stencilOpZPass === material.stencilOpZPass &&
        memo.sampleAlphaToCoverage === material.sampleAlphaToCoverage
    );
}

function createPipelineStateMemo(
    material: Material,
    target: RHIMeshDrawTargetDescriptor,
    primitiveMode: number,
    stripIndexFormat: RHIIndexFormat | undefined,
    record: Readonly<GPUDrivenPipelineResourceRecord>,
    depthMode: CameraDepthMode
): PipelineStateMemo {
    return {
        depthMode,
        material,
        primitiveMode,
        stripIndexFormat,
        wireframe: material.wireframe,
        frontFace: material.frontFace,
        cullFace: material.cullFace,
        cullFaceType: material.cullFaceType,
        depthTest: material.depthTest,
        depthMask: material.depthMask,
        depthRangeMin: material.depthRange[0],
        depthRangeMax: material.depthRange[1],
        depthFunc: material.depthFunc,
        transparent: material.transparent,
        premultiplyAlpha: material.premultiplyAlpha,
        blend: material.blend,
        blendEquation: material.blendEquation,
        blendEquationAlpha: material.blendEquationAlpha,
        blendSrc: material.blendSrc,
        blendDst: material.blendDst,
        blendSrcAlpha: material.blendSrcAlpha,
        blendDstAlpha: material.blendDstAlpha,
        stencilTest: material.stencilTest,
        stencilMask: material.stencilMask,
        stencilFunc: material.stencilFunc,
        stencilFuncMask: material.stencilFuncMask,
        stencilOpFail: material.stencilOpFail,
        stencilOpZFail: material.stencilOpZFail,
        stencilOpZPass: material.stencilOpZPass,
        sampleAlphaToCoverage: material.sampleAlphaToCoverage,
        colorFormats: Object.freeze([...target.colorFormats]),
        depthStencilFormat: target.depthStencilFormat,
        sampleCount: target.sampleCount,
        record
    };
}

function bindingKey(group: number, binding: number): string {
    return `${String(group)}:${String(binding)}`;
}

function reflectionStages(
    compiled: Readonly<CompiledStorageGraphicsShader>
): ReadonlyMap<string, RHIShaderStageFlags> {
    const stages = new Map<string, RHIShaderStageFlags>();
    const collect = (
        bindings: readonly RHIShaderBindingReflection[],
        flag: RHIShaderStageFlags
    ): void => {
        for (const binding of bindings) {
            const key = bindingKey(binding.group, binding.binding);
            stages.set(key, (stages.get(key) ?? 0) | flag);
        }
    };
    collect(compiled.vertex.reflection.bindings, RHIShaderStage.VERTEX);
    collect(compiled.fragment.reflection.bindings, RHIShaderStage.FRAGMENT);
    return stages;
}

function samplerLayoutType(
    binding: Extract<ShaderReadBinding, { readonly kind: 'sampler' | 'comparison-sampler' }>,
    bindings: readonly ShaderReadBinding[]
): 'filtering' | 'non-filtering' | 'comparison' {
    if (binding.kind === 'comparison-sampler') return 'comparison';
    const texture = bindings.find(
        candidate => candidate.kind === 'sampled-texture' && candidate.name === binding.name
    );
    if (texture?.kind !== 'sampled-texture') {
        throw new TypeError(`GPU-driven sampler ${binding.name} has no paired sampled texture`);
    }
    return texture.sampleType === 'float' ? 'filtering' : 'non-filtering';
}

function layoutEntry(
    binding: ShaderReadBinding,
    visibility: RHIShaderStageFlags,
    bindings: readonly ShaderReadBinding[]
): Readonly<RHIBindGroupLayoutEntry> {
    const base = { binding: binding.binding, visibility } as const;
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
            return Object.freeze({
                ...base,
                buffer: Object.freeze({
                    type: 'read-only-storage' as const,
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
        case 'comparison-sampler':
            return Object.freeze({
                ...base,
                sampler: Object.freeze({ type: samplerLayoutType(binding, bindings) })
            });
    }
}

function compileBindingLayout(
    compiled: Readonly<CompiledStorageGraphicsShader>,
    maxBindGroups: number
): Readonly<GPUDrivenBindingLayoutPlan> {
    const portablePlan = compileShaderBindingLayout(compiled, maxBindGroups);
    const highestGroup = compiled.bindings.at(-1)?.group ?? -1;
    if (highestGroup >= maxBindGroups) {
        throw new RangeError(
            `Storage graphics binding group ${String(highestGroup)} exceeds maxBindGroups ${String(maxBindGroups)}`
        );
    }
    const stageByLocation = reflectionStages(compiled);
    const descriptors: RHIBindGroupLayoutDescriptor[] = [];
    const activeGroups: number[] = [];
    for (let group = 0; group <= highestGroup; group += 1) {
        const entries = compiled.bindings
            .filter(binding => binding.group === group)
            .map(binding => {
                const visibility = stageByLocation.get(bindingKey(binding.group, binding.binding));
                if (visibility === undefined || visibility === 0) {
                    throw new TypeError(
                        `Storage graphics binding ${bindingKey(binding.group, binding.binding)} is unused by both shader stages`
                    );
                }
                return layoutEntry(binding, visibility, compiled.bindings);
            });
        if (entries.length > 0) activeGroups.push(group);
        descriptors.push(
            Object.freeze({
                label: `Storage graphics group ${String(group)}`,
                lifetime: 'persistent',
                entries: Object.freeze(entries)
            })
        );
    }
    return Object.freeze({
        ...portablePlan,
        bindGroupLayoutDescriptors: Object.freeze(descriptors),
        activeGroupIndices: Object.freeze(activeGroups),
        bindings: compiled.bindings
    });
}

function snapshotSceneVertexLayouts(
    layouts: readonly Readonly<RHIVertexBufferLayout>[]
): readonly Readonly<RHIVertexBufferLayout>[] {
    return Object.freeze(
        layouts.map(layout =>
            Object.freeze({
                arrayStride: layout.arrayStride,
                ...(layout.stepMode === undefined ? {} : { stepMode: layout.stepMode }),
                attributes: Object.freeze(
                    layout.attributes.map(attribute =>
                        Object.freeze({
                            shaderLocation: attribute.shaderLocation,
                            format: attribute.format,
                            offset: attribute.offset
                        })
                    )
                )
            })
        )
    );
}

function snapshotVertexLayouts(
    layouts: readonly Readonly<GPUDrivenVertexBufferLayout>[]
): readonly Readonly<RHIVertexBufferLayout>[] {
    return Object.freeze(
        layouts.map(layout =>
            Object.freeze({
                arrayStride: layout.arrayStride,
                ...(layout.stepMode === undefined ? {} : { stepMode: layout.stepMode }),
                attributes: Object.freeze(
                    layout.attributes.map(attribute =>
                        Object.freeze({
                            shaderLocation: attribute.shaderLocation,
                            format: attribute.format,
                            offset: attribute.byteOffset
                        })
                    )
                )
            })
        )
    );
}

function validateVertexLayouts(
    compiled: Readonly<CompiledStorageGraphicsShader>,
    layouts: readonly Readonly<RHIVertexBufferLayout>[],
    registry: ResourceRegistry
): void {
    const limits = registry.deviceCapabilities.limits;
    if (layouts.length > limits.maxVertexBuffers) {
        throw new RangeError('GPU-driven vertex buffer count exceeds maxVertexBuffers');
    }
    const declared = new Set<number>();
    for (const layout of layouts) {
        if (layout.arrayStride > limits.maxVertexBufferArrayStride) {
            throw new RangeError('GPU-driven vertex stride exceeds maxVertexBufferArrayStride');
        }
        for (const attribute of layout.attributes) {
            if (attribute.shaderLocation >= limits.maxVertexAttributes) {
                throw new RangeError('GPU-driven shaderLocation exceeds maxVertexAttributes');
            }
            declared.add(attribute.shaderLocation);
        }
    }
    const expected = compiled.vertex.reflection.vertexInputs ?? [];
    if (declared.size !== expected.length) {
        throw new TypeError('GPU-driven vertex layouts must exactly match shader vertex inputs');
    }
    for (const input of expected) {
        if (!declared.has(input.location)) {
            throw new TypeError(
                `GPU-driven vertex layout is missing shader location ${String(input.location)}`
            );
        }
    }
}

function validateFragmentOutputs(
    compiled: Readonly<CompiledStorageGraphicsShader>,
    target: RHIMeshDrawTargetDescriptor
): void {
    const outputs = compiled.metadata.fragmentOutputs;
    if (outputs.length !== target.colorFormats.length) {
        throw new TypeError('GPU-driven fragment outputs must exactly match color attachments');
    }
    for (let index = 0; index < outputs.length; index += 1) {
        if (outputs[index]?.location !== index || target.colorFormats[index] === null) {
            throw new TypeError(
                'GPU-driven fragment outputs must be continuous from location zero'
            );
        }
    }
}

function pipelineSignature(
    vertexLayouts: readonly Readonly<RHIVertexBufferLayout>[],
    pipelineState: ReturnType<typeof createRHIMeshDrawPipelineState>
): string {
    return JSON.stringify({ vertexLayouts, pipelineState });
}

function createShaderResource(
    registry: ResourceRegistry,
    artifact: Readonly<RHIShaderArtifactInput>,
    label: string
): ResourceRegistryHandle<RHIShader> {
    return registry.register<RHIShader>({
        label,
        create: device => {
            if (device.backend !== 'webgpu') {
                throw new Error('Storage graphics shader cannot recover on a non-WebGPU device');
            }
            return device.createShader({ label, lifetime: 'persistent', artifact });
        }
    });
}

/** Renderer-local pipeline cache for WebGPU-only storage-aware raster passes. */
export class GPUDrivenPipelineResourceCache {
    #bucketByShader = new WeakMap<StorageGraphicsShader, GPUDrivenShaderBucket>();
    #compiledByShader = new WeakMap<StorageGraphicsShader, CompiledShaderMemo>();
    readonly #buckets = new Set<GPUDrivenShaderBucket>();
    readonly #bucketByRecord = new WeakMap<
        GPUDrivenPipelineResourceRecord,
        GPUDrivenShaderBucket
    >();
    #destroyed = false;

    constructor(
        readonly registry: ResourceRegistry,
        readonly compiler: StorageGraphicsShaderCompiler
    ) {}

    prepare(
        shader: StorageGraphicsShader,
        material: Material,
        publicVertexLayouts: readonly Readonly<GPUDrivenVertexBufferLayout>[],
        target: RHIMeshDrawTargetDescriptor,
        depthMode: CameraDepthMode = 'standard'
    ): Readonly<GPUDrivenPipelineResourceRecord> {
        return this.prepareLayoutIdentity(
            shader,
            material,
            publicVertexLayouts,
            'procedural',
            target,
            TRIANGLES,
            undefined,
            depthMode
        );
    }

    /** @internal Resolve immutable shader metadata without re-entering the compiler on cache hits. */
    resolveCompiledShader(shader: StorageGraphicsShader): Readonly<CompiledStorageGraphicsShader> {
        this.assertAlive();
        if (this.registry.deviceBackend !== 'webgpu') {
            throw new Error('GPU-driven storage graphics is supported only by WebGPU');
        }
        const bucket = this.currentBucket(shader);
        if (bucket !== undefined) return bucket.compiled;
        const compilerGeneration = this.compiler.cacheGeneration;
        const memo = this.#compiledByShader.get(shader);
        if (memo?.compilerGeneration === compilerGeneration) return memo.compiled;
        const compiled = this.compiler.compile(shader, 'webgpu');
        this.#compiledByShader.set(shader, { compilerGeneration, compiled });
        return compiled;
    }

    /** @internal Prepare a storage-aware pipeline for ordinary scene geometry and topology. */
    prepareScene(
        shader: StorageGraphicsShader,
        material: Material,
        vertexLayouts: readonly Readonly<RHIVertexBufferLayout>[],
        target: RHIMeshDrawTargetDescriptor,
        primitiveMode: number,
        stripIndexFormat?: RHIIndexFormat,
        depthMode: CameraDepthMode = 'standard'
    ): Readonly<GPUDrivenPipelineResourceRecord> {
        return this.prepareLayoutIdentity(
            shader,
            material,
            vertexLayouts,
            'scene',
            target,
            primitiveMode,
            stripIndexFormat,
            depthMode
        );
    }

    private prepareLayoutIdentity(
        shader: StorageGraphicsShader,
        material: Material,
        sourceLayouts:
            | readonly Readonly<GPUDrivenVertexBufferLayout>[]
            | readonly Readonly<RHIVertexBufferLayout>[],
        layoutKind: 'procedural' | 'scene',
        target: RHIMeshDrawTargetDescriptor,
        primitiveMode: number,
        stripIndexFormat?: RHIIndexFormat,
        depthMode: CameraDepthMode = 'standard'
    ): Readonly<GPUDrivenPipelineResourceRecord> {
        this.assertAlive();
        if (this.registry.deviceBackend !== 'webgpu') {
            throw new Error('GPU-driven storage graphics is supported only by WebGPU');
        }
        let bucket = this.currentBucket(shader);
        const layoutIdentity = sourceLayouts as object;
        const layoutMap =
            layoutKind === 'procedural' ? bucket?.proceduralLayouts : bucket?.sceneLayouts;
        let layoutMemo = layoutMap?.get(layoutIdentity);
        if (layoutMemo !== undefined) {
            for (const memo of layoutMemo.states) {
                if (
                    samePipelineStateMemo(
                        memo,
                        material,
                        target,
                        primitiveMode,
                        stripIndexFormat,
                        depthMode
                    )
                ) {
                    return memo.record;
                }
            }
        }

        const compiled = bucket?.compiled ?? this.resolveCompiledShader(shader);
        const vertexLayouts =
            layoutMemo?.vertexLayouts ??
            (layoutKind === 'procedural'
                ? snapshotVertexLayouts(
                      sourceLayouts as readonly Readonly<GPUDrivenVertexBufferLayout>[]
                  )
                : snapshotSceneVertexLayouts(
                      sourceLayouts as readonly Readonly<RHIVertexBufferLayout>[]
                  ));
        if (layoutMemo === undefined) validateVertexLayouts(compiled, vertexLayouts, this.registry);
        validateFragmentOutputs(compiled, target);
        const pipelineState = createRHIMeshDrawPipelineState(
            material,
            primitiveMode,
            target,
            this.registry.deviceCapabilities,
            'color',
            stripIndexFormat,
            compiled.metadata.fragmentOutputs,
            depthMode
        );
        const signature = pipelineSignature(vertexLayouts, pipelineState);
        const createdBucket = bucket === undefined;
        if (bucket === undefined) {
            bucket = this.createBucket(shader, compiled);
            this.#bucketByShader.set(shader, bucket);
            this.#buckets.add(bucket);
        }
        if (layoutMemo === undefined) {
            layoutMemo = { vertexLayouts, states: [] };
            const destination =
                layoutKind === 'procedural' ? bucket.proceduralLayouts : bucket.sceneLayouts;
            destination.set(layoutIdentity, layoutMemo);
        }
        const cached = bucket.recordsBySignature.get(signature);
        if (cached !== undefined) {
            layoutMemo.states.push(
                createPipelineStateMemo(
                    material,
                    target,
                    primitiveMode,
                    stripIndexFormat,
                    cached,
                    depthMode
                )
            );
            return cached;
        }

        const label = `${shader.label || 'StorageGraphicsShader'} pipeline ${String(bucket.recordsBySignature.size + 1)}`;
        const dependencies = Object.freeze([
            bucket.vertexShader,
            bucket.fragmentShader,
            bucket.pipelineLayout
        ]);
        let pipeline: ResourceRegistryHandle<RHIGraphicsPipeline>;
        try {
            pipeline = this.registry.register<RHIGraphicsPipeline>({
                label,
                dependencies,
                create: (device, resolve) =>
                    device.createGraphicsPipeline({
                        label,
                        lifetime: 'persistent',
                        layout: resolve(bucket.pipelineLayout),
                        vertex: Object.freeze({
                            shader: resolve(bucket.vertexShader),
                            buffers: vertexLayouts
                        }),
                        fragment: Object.freeze({
                            shader: resolve(bucket.fragmentShader),
                            targets: pipelineState.colorTargets
                        }),
                        primitive: pipelineState.primitive,
                        ...(pipelineState.depthStencil === undefined
                            ? {}
                            : { depthStencil: pipelineState.depthStencil }),
                        multisample: pipelineState.multisample
                    })
            });
        } catch (error) {
            if (createdBucket) this.releaseBucket(bucket);
            throw error;
        }
        const record: GPUDrivenPipelineResourceRecord = Object.freeze({
            shader,
            bindingPlan: bucket.bindingPlan,
            bindGroupLayouts: bucket.bindGroupLayouts,
            pipelineLayout: bucket.pipelineLayout,
            vertexShader: bucket.vertexShader,
            fragmentShader: bucket.fragmentShader,
            pipeline,
            vertexLayouts,
            shaderToken: bucket.shaderToken,
            bindingLayoutToken: bucket.bindingLayoutToken
        });
        bucket.recordsBySignature.set(signature, record);
        bucket.records.add(record);
        this.#bucketByRecord.set(record, bucket);
        layoutMemo.states.push(
            createPipelineStateMemo(
                material,
                target,
                primitiveMode,
                stripIndexFormat,
                record,
                depthMode
            )
        );
        return record;
    }

    resolvePipeline(record: Readonly<GPUDrivenPipelineResourceRecord>): RHIGraphicsPipeline {
        this.requireRecord(record);
        return this.registry.resolve(record.pipeline);
    }

    resolveBindGroupLayout(
        record: Readonly<GPUDrivenPipelineResourceRecord>,
        group: number
    ): RHIBindGroupLayout {
        this.requireRecord(record);
        const handle = record.bindGroupLayouts[group];
        if (handle === undefined)
            throw new RangeError(`GPU-driven bind group ${String(group)} is unavailable`);
        return this.registry.resolve(handle);
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const bucket of this.#buckets) this.releaseBucket(bucket);
        this.#bucketByShader = new WeakMap();
        this.#compiledByShader = new WeakMap();
        this.#destroyed = true;
    }

    private createBucket(
        shader: StorageGraphicsShader,
        compiled: Readonly<CompiledStorageGraphicsShader>
    ): GPUDrivenShaderBucket {
        const shaderLabel = shader.label || 'StorageGraphicsShader';
        const bindingPlan = compileBindingLayout(
            compiled,
            this.registry.deviceCapabilities.limits.maxBindGroups
        );
        const vertexShader = createShaderResource(
            this.registry,
            compiled.vertex,
            `${shaderLabel} vertex`
        );
        let fragmentShader: ResourceRegistryHandle<RHIShader> | null = null;
        const bindGroupLayouts: ResourceRegistryHandle<RHIBindGroupLayout>[] = [];
        let pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout> | null = null;
        try {
            fragmentShader = createShaderResource(
                this.registry,
                compiled.fragment,
                `${shaderLabel} fragment`
            );
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
                compiled,
                compilerGeneration: this.compiler.cacheGeneration,
                shaderToken: compiled.token,
                bindingLayoutToken: compiled.token,
                bindingPlan,
                bindGroupLayouts: frozenLayouts,
                pipelineLayout,
                vertexShader,
                fragmentShader,
                recordsBySignature: new Map(),
                records: new Set(),
                proceduralLayouts: new WeakMap(),
                sceneLayouts: new WeakMap()
            };
        } catch (error) {
            if (pipelineLayout !== null) this.registry.discardUnsubmitted(pipelineLayout);
            for (let index = bindGroupLayouts.length - 1; index >= 0; index--) {
                const handle = bindGroupLayouts[index];
                if (handle !== undefined) this.registry.discardUnsubmitted(handle);
            }
            if (fragmentShader !== null) this.registry.discardUnsubmitted(fragmentShader);
            this.registry.discardUnsubmitted(vertexShader);
            throw error;
        }
    }

    private requireRecord(
        record: Readonly<GPUDrivenPipelineResourceRecord>
    ): GPUDrivenPipelineResourceRecord {
        const owned = record as GPUDrivenPipelineResourceRecord;
        const bucket = this.#bucketByRecord.get(owned);
        if (!bucket?.records.has(owned)) {
            throw new Error('GPU-driven pipeline record is stale or belongs to another cache');
        }
        return owned;
    }

    private currentBucket(shader: StorageGraphicsShader): GPUDrivenShaderBucket | undefined {
        const bucket = this.#bucketByShader.get(shader);
        if (bucket !== undefined && bucket.compilerGeneration !== this.compiler.cacheGeneration) {
            this.releaseBucket(bucket);
            return undefined;
        }
        return bucket;
    }

    private releaseBucket(bucket: GPUDrivenShaderBucket): void {
        for (const record of bucket.recordsBySignature.values()) {
            this.registry.release(record.pipeline);
        }
        bucket.recordsBySignature.clear();
        bucket.records.clear();
        this.registry.release(bucket.pipelineLayout);
        for (const layout of bucket.bindGroupLayouts) this.registry.release(layout);
        this.registry.release(bucket.fragmentShader);
        this.registry.release(bucket.vertexShader);
        this.#bucketByShader.delete(bucket.shader);
        this.#buckets.delete(bucket);
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('GPU-driven pipeline resource cache is destroyed');
    }
}
