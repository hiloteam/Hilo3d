import type Shader from '../../shader/Shader';
import { TRIANGLES } from '../../constants/webgl';
import {
    RHICacheCounter,
    type RHIBindGroupLayout,
    type RHIBindGroupLayoutDescriptor,
    type RHIBlendComponent,
    type RHIGraphicsPipeline,
    type RHIIndexFormat,
    type RHIPipelineLayout,
    type RHIStencilFaceState,
    type RHIVertexAttribute,
    type RHIVertexBufferLayout
} from '../rhi/core';
import {
    createRHIMeshDrawPipelineState,
    type RHIMeshDrawMaterialState,
    type RHIMeshDrawPipelineState,
    type RHIMeshDrawTargetDescriptor
} from './RHIDescriptorMapping';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';
import type {
    CompiledShaderArtifactPair,
    ShaderArtifactCompileOptions,
    ShaderArtifactCompiler,
    ShaderFragmentOutputMode
} from './ShaderArtifactCompiler';
import {
    compileShaderBindingLayout,
    type ShaderBindingLayoutPlan
} from './ShaderBindingLayoutCompiler';
import type { ShaderResourceCache, ShaderResourceHandlePair } from './ShaderResourceCache';

const COLOR_SHADER_COMPILE_OPTIONS = Object.freeze({ fragmentOutputs: 'color' as const });
const DEPTH_ONLY_SHADER_COMPILE_OPTIONS = Object.freeze({
    fragmentOutputs: 'depth-only' as const
});
const COLOR_NUMERIC_DEPTH_COMPILE_OPTIONS = new Map<
    number,
    Readonly<ShaderArtifactCompileOptions>
>();
const DEPTH_ONLY_NUMERIC_DEPTH_COMPILE_OPTIONS = new Map<
    number,
    Readonly<ShaderArtifactCompileOptions>
>();

function shaderCompileOptions(
    fragmentOutputMode: ShaderFragmentOutputMode,
    numericDepthSamplerMask: number
): Readonly<ShaderArtifactCompileOptions> {
    if (numericDepthSamplerMask === 0) {
        return fragmentOutputMode === 'color'
            ? COLOR_SHADER_COMPILE_OPTIONS
            : DEPTH_ONLY_SHADER_COMPILE_OPTIONS;
    }
    const cache =
        fragmentOutputMode === 'color'
            ? COLOR_NUMERIC_DEPTH_COMPILE_OPTIONS
            : DEPTH_ONLY_NUMERIC_DEPTH_COMPILE_OPTIONS;
    let options = cache.get(numericDepthSamplerMask);
    if (options === undefined) {
        options = Object.freeze({
            fragmentOutputs: fragmentOutputMode,
            numericDepthSamplerMask
        });
        cache.set(numericDepthSamplerMask, options);
    }
    return options;
}

export interface PipelineResourceRecord {
    readonly fragmentOutputMode: ShaderFragmentOutputMode;
    readonly bindingLayoutToken: number;
    readonly shaderToken: number;
    readonly bindingPlan: Readonly<ShaderBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout>;
    readonly pipeline: ResourceRegistryHandle<RHIGraphicsPipeline>;
}

export interface ResolvedPipelineResourceRecord {
    readonly fragmentOutputMode: ShaderFragmentOutputMode;
    readonly bindingLayoutToken: number;
    readonly shaderToken: number;
    readonly bindingPlan: Readonly<ShaderBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly RHIBindGroupLayout[];
    readonly pipelineLayout: RHIPipelineLayout;
    readonly pipeline: RHIGraphicsPipeline;
}

interface PipelineShaderBucket {
    readonly shader: Shader;
    readonly fragmentOutputMode: ShaderFragmentOutputMode;
    readonly numericDepthSamplerMask: number;
    readonly shaderToken: number;
    readonly bindingLayoutToken: number;
    readonly bindingPlan: Readonly<ShaderBindingLayoutPlan>;
    readonly bindGroupLayouts: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout>;
    readonly recordsBySignature: Map<string, Readonly<PipelineResourceRecord>>;
    readonly requestVariantsByMaterial: WeakMap<object, PipelineRequestVariant[]>;
}

interface PipelineShaderBucketSet {
    readonly color: Map<number, PipelineShaderBucket>;
    readonly 'depth-only': Map<number, PipelineShaderBucket>;
}

function createBucketSet(): PipelineShaderBucketSet {
    return { color: new Map(), 'depth-only': new Map() };
}

interface MutableVertexLayoutsMemo {
    readonly vertexLayouts: readonly Readonly<RHIVertexBufferLayout>[];
    readonly record: Readonly<PipelineResourceRecord>;
}

type VertexLayoutsMemo = Readonly<PipelineResourceRecord> | MutableVertexLayoutsMemo;

interface PipelineRequestVariant {
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
    readonly pipelineState: Readonly<RHIMeshDrawPipelineState>;
    readonly pipelineStateSignature: string;
    readonly recordsByVertexLayouts: WeakMap<object, VertexLayoutsMemo>;
}

function samePipelineRequestVariant(
    variant: PipelineRequestVariant,
    material: RHIMeshDrawMaterialState,
    target: RHIMeshDrawTargetDescriptor,
    primitiveMode: number,
    stripIndexFormat: RHIIndexFormat | undefined
): boolean {
    if (
        variant.colorFormats.length !== target.colorFormats.length ||
        variant.depthStencilFormat !== target.depthStencilFormat ||
        variant.sampleCount !== target.sampleCount
    ) {
        return false;
    }
    for (let index = 0; index < variant.colorFormats.length; index += 1) {
        if (variant.colorFormats[index] !== target.colorFormats[index]) return false;
    }
    return (
        variant.primitiveMode === primitiveMode &&
        variant.stripIndexFormat === stripIndexFormat &&
        variant.wireframe === material.wireframe &&
        variant.frontFace === material.frontFace &&
        variant.cullFace === material.cullFace &&
        variant.cullFaceType === material.cullFaceType &&
        variant.depthTest === material.depthTest &&
        variant.depthMask === material.depthMask &&
        variant.depthRangeMin === material.depthRange[0] &&
        variant.depthRangeMax === material.depthRange[1] &&
        variant.depthFunc === material.depthFunc &&
        variant.transparent === material.transparent &&
        variant.premultiplyAlpha === material.premultiplyAlpha &&
        variant.blend === material.blend &&
        variant.blendEquation === material.blendEquation &&
        variant.blendEquationAlpha === material.blendEquationAlpha &&
        variant.blendSrc === material.blendSrc &&
        variant.blendDst === material.blendDst &&
        variant.blendSrcAlpha === material.blendSrcAlpha &&
        variant.blendDstAlpha === material.blendDstAlpha &&
        variant.stencilTest === material.stencilTest &&
        variant.stencilMask === material.stencilMask &&
        variant.stencilFunc === material.stencilFunc &&
        variant.stencilFuncMask === material.stencilFuncMask &&
        variant.stencilOpFail === material.stencilOpFail &&
        variant.stencilOpZFail === material.stencilOpZFail &&
        variant.stencilOpZPass === material.stencilOpZPass &&
        variant.sampleAlphaToCoverage === material.sampleAlphaToCoverage
    );
}

function createPipelineRequestVariant(
    material: RHIMeshDrawMaterialState,
    target: RHIMeshDrawTargetDescriptor,
    primitiveMode: number,
    stripIndexFormat: RHIIndexFormat | undefined,
    pipelineState: Readonly<RHIMeshDrawPipelineState>,
    stateSignature: string
): PipelineRequestVariant {
    return {
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
        pipelineState,
        pipelineStateSignature: stateSignature,
        recordsByVertexLayouts: new WeakMap()
    };
}

function optionalValue(value: string | number | boolean | undefined): string {
    return value === undefined ? '~' : String(value);
}

function blendComponentSignature(component: Readonly<RHIBlendComponent>): string {
    return `${optionalValue(component.operation)},${optionalValue(component.srcFactor)},${optionalValue(component.dstFactor)}`;
}

function stencilFaceSignature(face: Readonly<RHIStencilFaceState> | undefined): string {
    return face === undefined
        ? '~'
        : `${optionalValue(face.compare)},${optionalValue(face.failOp)},${optionalValue(face.depthFailOp)},${optionalValue(face.passOp)}`;
}

function vertexLayoutSignature(layout: Readonly<RHIVertexBufferLayout>): string {
    let signature = `stride:${String(layout.arrayStride)}|step:${optionalValue(layout.stepMode)}|attributes:${String(layout.attributes.length)}`;
    for (let index = 0; index < layout.attributes.length; index += 1) {
        const attribute = layout.attributes[index];
        if (attribute === undefined) continue;
        signature += `|a${String(index)}:${attribute.format},${String(attribute.offset)},${String(attribute.shaderLocation)}`;
    }
    return signature;
}

function vertexLayoutsSignature(layouts: readonly Readonly<RHIVertexBufferLayout>[]): string {
    let signature = `buffers:${String(layouts.length)}`;
    for (let index = 0; index < layouts.length; index += 1) {
        const layout = layouts[index];
        if (layout !== undefined) {
            signature += `|b${String(index)}:${vertexLayoutSignature(layout)}`;
        }
    }
    return signature;
}

function pipelineStateSignature(state: Readonly<RHIMeshDrawPipelineState>): string {
    const primitive = state.primitive;
    let signature = `primitive:${optionalValue(primitive.topology)},${optionalValue(primitive.stripIndexFormat)},${optionalValue(primitive.frontFace)},${optionalValue(primitive.cullMode)}`;
    signature += `|targets:${String(state.colorTargets.length)}`;
    for (let index = 0; index < state.colorTargets.length; index += 1) {
        const target = state.colorTargets[index];
        if (target === undefined) continue;
        if (target === null) {
            signature += `|t${String(index)}:null`;
            continue;
        }
        signature += `|t${String(index)}:${target.format},${optionalValue(target.writeMask)}`;
        const blend = target.blend;
        signature +=
            blend === undefined
                ? ',blend:~'
                : `,blend:${blendComponentSignature(blend.color)};${blendComponentSignature(blend.alpha)}`;
    }
    const depthStencil = state.depthStencil;
    signature +=
        depthStencil === undefined
            ? '|depth:~'
            : `|depth:${depthStencil.format},${optionalValue(depthStencil.depthCompare)},${optionalValue(depthStencil.depthWriteEnabled)},front:${stencilFaceSignature(depthStencil.stencilFront)},back:${stencilFaceSignature(depthStencil.stencilBack)},read:${optionalValue(depthStencil.stencilReadMask)},write:${optionalValue(depthStencil.stencilWriteMask)}`;
    signature += `|multisample:${optionalValue(state.multisample.count)},${optionalValue(state.multisample.mask)},${optionalValue(state.multisample.alphaToCoverageEnabled)}`;
    return signature;
}

function snapshotVertexLayout(
    layout: Readonly<RHIVertexBufferLayout>
): Readonly<RHIVertexBufferLayout> {
    const attributes = new Array<RHIVertexAttribute>(layout.attributes.length);
    for (let index = 0; index < layout.attributes.length; index += 1) {
        const attribute = layout.attributes[index];
        if (attribute === undefined) continue;
        attributes[index] = Object.freeze({
            format: attribute.format,
            offset: attribute.offset,
            shaderLocation: attribute.shaderLocation
        });
    }
    return Object.freeze({
        arrayStride: layout.arrayStride,
        ...(layout.stepMode === undefined ? {} : { stepMode: layout.stepMode }),
        attributes: Object.freeze(attributes)
    });
}

function snapshotVertexLayouts(
    layouts: readonly Readonly<RHIVertexBufferLayout>[]
): readonly Readonly<RHIVertexBufferLayout>[] {
    const snapshots = new Array<Readonly<RHIVertexBufferLayout>>(layouts.length);
    for (let index = 0; index < layouts.length; index += 1) {
        const layout = layouts[index];
        if (layout !== undefined) snapshots[index] = snapshotVertexLayout(layout);
    }
    return Object.freeze(snapshots);
}

function sameVertexLayouts(
    snapshot: readonly Readonly<RHIVertexBufferLayout>[],
    layouts: readonly Readonly<RHIVertexBufferLayout>[]
): boolean {
    if (snapshot.length !== layouts.length) return false;
    for (let layoutIndex = 0; layoutIndex < snapshot.length; layoutIndex += 1) {
        const previous = snapshot[layoutIndex];
        const current = layouts[layoutIndex];
        if (previous === undefined || current === undefined) {
            if (previous !== current) return false;
            continue;
        }
        if (
            previous.arrayStride !== current.arrayStride ||
            previous.stepMode !== current.stepMode ||
            previous.attributes.length !== current.attributes.length
        ) {
            return false;
        }
        for (
            let attributeIndex = 0;
            attributeIndex < previous.attributes.length;
            attributeIndex += 1
        ) {
            const previousAttribute = previous.attributes[attributeIndex];
            const currentAttribute = current.attributes[attributeIndex];
            if (previousAttribute === undefined || currentAttribute === undefined) {
                if (previousAttribute !== currentAttribute) return false;
                continue;
            }
            if (
                previousAttribute.format !== currentAttribute.format ||
                previousAttribute.offset !== currentAttribute.offset ||
                previousAttribute.shaderLocation !== currentAttribute.shaderLocation
            ) {
                return false;
            }
        }
    }
    return true;
}

function isDeepFrozenVertexLayouts(layouts: readonly Readonly<RHIVertexBufferLayout>[]): boolean {
    if (!Object.isFrozen(layouts)) return false;
    for (const layout of layouts) {
        if (!Object.isFrozen(layout) || !Object.isFrozen(layout.attributes)) {
            return false;
        }
        for (const attribute of layout.attributes) {
            if (!Object.isFrozen(attribute)) return false;
        }
    }
    return true;
}

export type PipelineVertexLayoutInput =
    Readonly<RHIVertexBufferLayout> | readonly Readonly<RHIVertexBufferLayout>[];

/**
 * Caches complete reflected mesh pipelines above the RHI. Registry recipes capture only frozen
 * descriptors and logical handles; concrete RHI/native resources are resolved for each create or
 * recovery invocation and never retained by cache records.
 */
export class PipelineResourceCache {
    /** Complete graphics-pipeline descriptor lookup outcomes, cumulative for this cache lifetime. */
    readonly metrics = new RHICacheCounter();
    #bucketsByShader = new WeakMap<Shader, PipelineShaderBucketSet>();
    readonly #buckets = new Set<PipelineShaderBucket>();
    readonly #recordBuckets = new WeakMap<Readonly<PipelineResourceRecord>, PipelineShaderBucket>();
    readonly #singleVertexLayoutArrays = new WeakMap<
        Readonly<RHIVertexBufferLayout>,
        readonly Readonly<RHIVertexBufferLayout>[]
    >();
    #nextBindingLayoutToken = 1;
    #destroyed = false;

    constructor(
        readonly registry: ResourceRegistry,
        readonly shaderResources: ShaderResourceCache,
        readonly compiler: ShaderArtifactCompiler = shaderResources.compiler
    ) {
        if (shaderResources.registry !== registry) {
            throw new Error('Pipeline and shader resource caches must share one registry');
        }
        if (shaderResources.compiler !== compiler) {
            throw new Error('Pipeline and shader resource caches must share one artifact compiler');
        }
    }

    prepare(
        shader: Shader,
        vertexLayout: PipelineVertexLayoutInput,
        material: RHIMeshDrawMaterialState,
        target: RHIMeshDrawTargetDescriptor,
        fragmentOutputMode: ShaderFragmentOutputMode = 'color',
        primitiveMode = TRIANGLES,
        stripIndexFormat?: RHIIndexFormat,
        numericDepthSamplerMask = 0
    ): Readonly<PipelineResourceRecord> {
        this.assertAlive();
        const vertexLayouts = this.normalizeVertexLayouts(vertexLayout);
        const compiled = this.compiler.compile(
            shader,
            this.registry.deviceBackend,
            shaderCompileOptions(fragmentOutputMode, numericDepthSamplerMask)
        );
        const shaderHandles = this.shaderResources.prepare(
            shader,
            fragmentOutputMode,
            numericDepthSamplerMask
        );
        this.assertShaderHandles(compiled, shaderHandles);

        let bucketSet = this.#bucketsByShader.get(shader);
        if (bucketSet === undefined) {
            bucketSet = createBucketSet();
            this.#bucketsByShader.set(shader, bucketSet);
        }
        const bucketsByDepthMask = bucketSet[fragmentOutputMode];
        let bucket = bucketsByDepthMask.get(numericDepthSamplerMask);
        if (bucket !== undefined && bucket.shaderToken !== compiled.token) {
            this.removeBucket(bucket);
            bucketSet = this.#bucketsByShader.get(shader);
            if (bucketSet === undefined) {
                bucketSet = createBucketSet();
                this.#bucketsByShader.set(shader, bucketSet);
            }
            bucket = undefined;
        }

        let requestVariant: PipelineRequestVariant | undefined;
        if (bucket !== undefined) {
            const variants = bucket.requestVariantsByMaterial.get(material);
            if (variants !== undefined) {
                // Indexed iteration avoids creating an iterator on the mesh-draw hot path.
                let index = 0;
                while (index < variants.length) {
                    const candidate = variants[index];
                    index += 1;
                    if (
                        candidate !== undefined &&
                        samePipelineRequestVariant(
                            candidate,
                            material,
                            target,
                            primitiveMode,
                            stripIndexFormat
                        )
                    ) {
                        requestVariant = candidate;
                        break;
                    }
                }
            }
            if (requestVariant !== undefined) {
                const memo = requestVariant.recordsByVertexLayouts.get(vertexLayouts);
                if (memo !== undefined) {
                    const record =
                        'record' in memo
                            ? sameVertexLayouts(memo.vertexLayouts, vertexLayouts)
                                ? memo.record
                                : undefined
                            : memo;
                    if (record !== undefined) {
                        this.metrics.recordHit();
                        return record;
                    }
                }
            }
        }

        const vertexLayoutSnapshot = snapshotVertexLayouts(vertexLayouts);
        if (requestVariant === undefined) {
            const pipelineState = createRHIMeshDrawPipelineState(
                material,
                primitiveMode,
                target,
                this.registry.deviceCapabilities,
                fragmentOutputMode,
                stripIndexFormat,
                compiled.metadata.fragmentOutputs
            );
            requestVariant = createPipelineRequestVariant(
                material,
                target,
                primitiveMode,
                stripIndexFormat,
                pipelineState,
                pipelineStateSignature(pipelineState)
            );
        }
        const signature = `${vertexLayoutsSignature(vertexLayoutSnapshot)}#${requestVariant.pipelineStateSignature}`;

        if (bucket === undefined) {
            bucket = this.createBucket(
                shader,
                compiled,
                fragmentOutputMode,
                numericDepthSamplerMask
            );
            bucketSet[fragmentOutputMode].set(numericDepthSamplerMask, bucket);
            this.#buckets.add(bucket);
        }
        const cached = bucket.recordsBySignature.get(signature);
        if (cached !== undefined) {
            this.rememberRequest(
                bucket,
                requestVariant,
                vertexLayouts,
                vertexLayoutSnapshot,
                material,
                cached
            );
            this.metrics.recordHit();
            return cached;
        }

        const record = this.createPipelineRecord(
            bucket,
            shaderHandles,
            vertexLayoutSnapshot,
            requestVariant.pipelineState
        );
        bucket.recordsBySignature.set(signature, record);
        this.rememberRequest(
            bucket,
            requestVariant,
            vertexLayouts,
            vertexLayoutSnapshot,
            material,
            record
        );
        this.#recordBuckets.set(record, bucket);
        this.metrics.recordMiss();
        this.metrics.recordInsertion();
        return record;
    }

    resolve(record: Readonly<PipelineResourceRecord>): Readonly<ResolvedPipelineResourceRecord> {
        this.assertAlive();
        this.requireRecordBucket(record);
        const bindGroupLayouts = new Array<RHIBindGroupLayout>(record.bindGroupLayouts.length);
        for (let index = 0; index < record.bindGroupLayouts.length; index += 1) {
            const handle = record.bindGroupLayouts[index];
            if (handle !== undefined) bindGroupLayouts[index] = this.registry.resolve(handle);
        }
        return Object.freeze({
            fragmentOutputMode: record.fragmentOutputMode,
            bindingLayoutToken: record.bindingLayoutToken,
            shaderToken: record.shaderToken,
            bindingPlan: record.bindingPlan,
            bindGroupLayouts: Object.freeze(bindGroupLayouts),
            pipelineLayout: this.registry.resolve(record.pipelineLayout),
            pipeline: this.registry.resolve(record.pipeline)
        });
    }

    markUsed(record: Readonly<PipelineResourceRecord>, frameIndex: number): void {
        this.assertAlive();
        this.requireRecordBucket(record);
        for (const handle of record.bindGroupLayouts) {
            this.registry.markUsed(handle, frameIndex);
        }
        this.registry.markUsed(record.pipelineLayout, frameIndex);
        this.registry.markUsed(record.pipeline, frameIndex);
    }

    detachShader(shader: Shader): boolean {
        this.assertAlive();
        const bucketSet = this.#bucketsByShader.get(shader);
        if (bucketSet === undefined) return false;
        for (const mode of ['color', 'depth-only'] as const) {
            for (const bucket of [...bucketSet[mode].values()]) this.removeBucket(bucket);
        }
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const bucket of this.#buckets) this.releaseBucket(bucket);
        this.#buckets.clear();
        this.#bucketsByShader = new WeakMap();
        this.#destroyed = true;
    }

    private createBucket(
        shader: Shader,
        compiled: Readonly<CompiledShaderArtifactPair>,
        fragmentOutputMode: ShaderFragmentOutputMode,
        numericDepthSamplerMask: number
    ): PipelineShaderBucket {
        const bindingPlan = compileShaderBindingLayout(
            compiled,
            this.registry.deviceCapabilities.limits.maxBindGroups
        );
        const bindingLayoutToken = this.allocateBindingLayoutToken();
        const bindGroupLayouts: ResourceRegistryHandle<RHIBindGroupLayout>[] = [];
        try {
            for (let group = 0; group < bindingPlan.bindGroupLayoutDescriptors.length; group += 1) {
                const descriptor = bindingPlan.bindGroupLayoutDescriptors[group];
                if (descriptor === undefined) continue;
                bindGroupLayouts.push(
                    this.registerBindGroupLayout(descriptor, bindingLayoutToken, group)
                );
            }
        } catch (error) {
            for (let index = bindGroupLayouts.length - 1; index >= 0; index -= 1) {
                const handle = bindGroupLayouts[index];
                if (handle !== undefined) this.registry.discardUnsubmitted(handle);
            }
            throw error;
        }
        const frozenBindGroupLayouts = Object.freeze(bindGroupLayouts);
        let pipelineLayout: ResourceRegistryHandle<RHIPipelineLayout>;
        try {
            pipelineLayout = this.registerPipelineLayout(
                frozenBindGroupLayouts,
                bindingLayoutToken
            );
        } catch (error) {
            for (let index = frozenBindGroupLayouts.length - 1; index >= 0; index -= 1) {
                const handle = frozenBindGroupLayouts[index];
                if (handle !== undefined) this.registry.discardUnsubmitted(handle);
            }
            throw error;
        }
        return {
            shader,
            fragmentOutputMode,
            numericDepthSamplerMask,
            shaderToken: compiled.token,
            bindingLayoutToken,
            bindingPlan,
            bindGroupLayouts: frozenBindGroupLayouts,
            pipelineLayout,
            recordsBySignature: new Map(),
            requestVariantsByMaterial: new WeakMap()
        };
    }

    private rememberRequest(
        bucket: PipelineShaderBucket,
        variant: PipelineRequestVariant,
        vertexLayouts: readonly Readonly<RHIVertexBufferLayout>[],
        vertexLayoutSnapshot: readonly Readonly<RHIVertexBufferLayout>[],
        material: RHIMeshDrawMaterialState,
        record: Readonly<PipelineResourceRecord>
    ): void {
        let variants = bucket.requestVariantsByMaterial.get(material);
        if (variants === undefined) {
            variants = [variant];
            bucket.requestVariantsByMaterial.set(material, variants);
        } else if (!variants.includes(variant)) {
            variants.push(variant);
        }
        variant.recordsByVertexLayouts.set(
            vertexLayouts,
            isDeepFrozenVertexLayouts(vertexLayouts)
                ? record
                : { vertexLayouts: vertexLayoutSnapshot, record }
        );
    }

    private registerBindGroupLayout(
        descriptor: Readonly<RHIBindGroupLayoutDescriptor>,
        bindingLayoutToken: number,
        group: number
    ): ResourceRegistryHandle<RHIBindGroupLayout> {
        const label = `Shader binding layout ${String(bindingLayoutToken)} group ${String(group)}`;
        return this.registry.register<RHIBindGroupLayout>({
            label,
            create: device =>
                device.createBindGroupLayout({
                    label,
                    lifetime: 'persistent',
                    entries: descriptor.entries
                })
        });
    }

    private registerPipelineLayout(
        bindGroupLayouts: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        bindingLayoutToken: number
    ): ResourceRegistryHandle<RHIPipelineLayout> {
        const label = `Shader pipeline layout ${String(bindingLayoutToken)}`;
        return this.registry.register<RHIPipelineLayout>({
            label,
            dependencies: bindGroupLayouts,
            create: (device, resolve) => {
                const resolved = new Array<RHIBindGroupLayout>(bindGroupLayouts.length);
                for (let index = 0; index < bindGroupLayouts.length; index += 1) {
                    const handle = bindGroupLayouts[index];
                    if (handle !== undefined) resolved[index] = resolve(handle);
                }
                return device.createPipelineLayout({
                    label,
                    lifetime: 'persistent',
                    bindGroupLayouts: resolved
                });
            }
        });
    }

    private createPipelineRecord(
        bucket: PipelineShaderBucket,
        shaderHandles: Readonly<ShaderResourceHandlePair>,
        vertexBuffers: readonly Readonly<RHIVertexBufferLayout>[],
        pipelineState: Readonly<RHIMeshDrawPipelineState>
    ): Readonly<PipelineResourceRecord> {
        const sequence = bucket.recordsBySignature.size + 1;
        const label = `Shader ${bucket.shader.id} ${bucket.fragmentOutputMode} pipeline ${String(bucket.bindingLayoutToken)}.${String(sequence)}`;
        const dependencies = Object.freeze([
            shaderHandles.vertex,
            shaderHandles.fragment,
            bucket.pipelineLayout
        ]);
        const pipeline = this.registry.register<RHIGraphicsPipeline>({
            label,
            dependencies,
            create: (device, resolve) =>
                device.createGraphicsPipeline({
                    label,
                    lifetime: 'persistent',
                    layout: resolve(bucket.pipelineLayout),
                    vertex: Object.freeze({
                        shader: resolve(shaderHandles.vertex),
                        buffers: vertexBuffers
                    }),
                    fragment: Object.freeze({
                        shader: resolve(shaderHandles.fragment),
                        targets: pipelineState.colorTargets
                    }),
                    primitive: pipelineState.primitive,
                    ...(pipelineState.depthStencil === undefined
                        ? {}
                        : { depthStencil: pipelineState.depthStencil }),
                    multisample: pipelineState.multisample
                })
        });
        return Object.freeze({
            fragmentOutputMode: bucket.fragmentOutputMode,
            bindingLayoutToken: bucket.bindingLayoutToken,
            shaderToken: bucket.shaderToken,
            bindingPlan: bucket.bindingPlan,
            bindGroupLayouts: bucket.bindGroupLayouts,
            pipelineLayout: bucket.pipelineLayout,
            pipeline
        });
    }

    private removeBucket(bucket: PipelineShaderBucket): void {
        const bucketSet = this.#bucketsByShader.get(bucket.shader);
        if (bucketSet?.[bucket.fragmentOutputMode].get(bucket.numericDepthSamplerMask) === bucket) {
            bucketSet[bucket.fragmentOutputMode].delete(bucket.numericDepthSamplerMask);
            if (bucketSet.color.size === 0 && bucketSet['depth-only'].size === 0) {
                this.#bucketsByShader.delete(bucket.shader);
            }
        }
        this.#buckets.delete(bucket);
        this.releaseBucket(bucket);
    }

    private releaseBucket(bucket: PipelineShaderBucket): void {
        const recordCount = bucket.recordsBySignature.size;
        for (const record of bucket.recordsBySignature.values()) {
            this.#recordBuckets.delete(record);
            this.registry.release(record.pipeline);
        }
        bucket.recordsBySignature.clear();
        if (recordCount > 0) this.metrics.recordRemoval(recordCount);
        this.registry.release(bucket.pipelineLayout);
        for (const handle of bucket.bindGroupLayouts) this.registry.release(handle);
    }

    private requireRecordBucket(record: Readonly<PipelineResourceRecord>): PipelineShaderBucket {
        const bucket = this.#recordBuckets.get(record);
        if (bucket === undefined) {
            throw new Error('Pipeline resource record is stale or belongs to another cache');
        }
        return bucket;
    }

    private assertShaderHandles(
        compiled: Readonly<CompiledShaderArtifactPair>,
        handles: Readonly<ShaderResourceHandlePair>
    ): void {
        if (compiled.backend !== handles.backend || compiled.token !== handles.token) {
            throw new Error('Shader artifact and shader resource cache are out of sync');
        }
    }

    private normalizeVertexLayouts(
        input: PipelineVertexLayoutInput
    ): readonly Readonly<RHIVertexBufferLayout>[] {
        if (Array.isArray(input)) {
            return input as readonly Readonly<RHIVertexBufferLayout>[];
        }
        const layout = input as Readonly<RHIVertexBufferLayout>;
        let layouts = this.#singleVertexLayoutArrays.get(layout);
        if (layouts === undefined) {
            layouts = Object.freeze([layout]);
            this.#singleVertexLayoutArrays.set(layout, layouts);
        }
        return layouts;
    }

    private allocateBindingLayoutToken(): number {
        const token = this.#nextBindingLayoutToken;
        if (!Number.isSafeInteger(token)) {
            throw new RangeError('Pipeline binding-layout token space is exhausted');
        }
        this.#nextBindingLayoutToken++;
        return token;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Pipeline resource cache is destroyed');
    }
}
