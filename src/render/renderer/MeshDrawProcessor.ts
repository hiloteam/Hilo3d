import type Mesh from '../../core/Mesh';
import { LINES, LINE_STRIP, TRIANGLE_STRIP } from '../../constants/webgl';
import type Geometry from '../../geometry/Geometry';
import GeometryData from '../../geometry/GeometryData';
import MorphGeometry from '../../geometry/MorphGeometry';
import LightManager from '../../light/LightManager';
import type {
    default as Material,
    SemanticProgramBindingInfo
} from '../../material/MaterialInstance';
import type { MaterialPassRole, MaterialPipelineState } from '../../material/MaterialDefinition';
import { resolveMaterialPassState } from '../../material/MaterialCompiler';
import Shader, {
    getMaterialReflectionDataShader,
    getTemporalReactiveShader
} from '../../shader/Shader';
import Texture from '../../texture/Texture';
import BuiltInUniformBlockManager from '../BuiltInUniformBlockManager';
import type RendererCore from '../RendererCore';
import type UniformBuffer from '../UniformBuffer';
import type StorageGraphicsShader from '../compute/StorageGraphicsShader';
import type { RHIUploadBatch } from '../frame/RHIUploadBatch';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import { createSemanticFrameState, type SemanticFrameState } from '../frame/SemanticFrameState';
import {
    MAX_AREA_LIGHTS,
    MAX_DIRECTIONAL_LIGHTS,
    MAX_INSTANCES_PER_DRAW,
    MAX_POINT_LIGHTS,
    MAX_SPOT_LIGHTS
} from '../ubo/BuiltInUniformBlocks';
import {
    RHICacheCounterAggregate,
    rhiTextureFormatHasDepth,
    type RHICacheCounters,
    type RHIBuffer,
    type RHIBindGroupLayout,
    type RHIDevice,
    type RHIGraphicsPipeline,
    type RHIIndexFormat,
    type RHISampler,
    type RHISubmission,
    type RHITextureView,
    type RHIViewport,
    type RHIVertexBufferLayout
} from '../rhi/core';
import { BufferResourceCache } from './BufferResourceCache';
import { FrameResourceUseTracker } from './FrameResourceUseTracker';
import type { GPUDrivenPipelineResourceCache } from './GPUDrivenPipelineResourceCache';
import {
    externalTextureBindingRegistry,
    type ExternalTextureGraphDependency
} from './ExternalTextureBindingRegistry';
import { InstanceBatchCompiler, type InstanceBatchPlan } from './InstanceBatchCompiler';
import { MeshDrawRevisionTracker } from './MeshDrawRevisionTracker';
import { PipelineResourceCache, type PipelineResourceRecord } from './PipelineResourceCache';
import {
    PreparedDrawCache,
    type PreparedDraw,
    type PreparedDrawRevision,
    type PreparedDrawUpdate
} from './PreparedDraw';
import {
    mapRHIMeshDrawDynamicState,
    mapRHIPrimitiveTopology,
    type RHIMeshDrawTargetDescriptor
} from './RHIDescriptorMapping';
import { mapPortableRHIIndexFormat } from './RHIIndexPreparation';
import { ResourceRegistry, type ResourceRegistryHandle } from './ResourceRegistry';
import {
    ShaderBindGroupResourceCache,
    type ShaderSampledBindingResources
} from './ShaderBindGroupResourceCache';
import {
    ShaderArtifactCompiler,
    type CompiledShaderArtifactPair,
    type ShaderArtifactCompileOptions,
    type ShaderFragmentOutputMode
} from './ShaderArtifactCompiler';
import { ShaderResourceCache } from './ShaderResourceCache';
import { SubmissionResourceTracker } from './SubmissionResourceTracker';
import { refreshShadowAtlasSceneBinding } from './ShadowAtlasTextureBinding';
import { TextureResourceCache } from './TextureResourceCache';
import { VertexInputLayoutCompiler } from './VertexInputLayoutCompiler';

const SCENE_STORAGE_BIND_GROUP = 3;
const DEFERRED_SCENE_STORAGE_GROUPS: readonly number[] = Object.freeze([SCENE_STORAGE_BIND_GROUP]);
const PASS_GLOBAL_SCENE_TEXTURE_NAMES = new Set(['u_opaqueTexture', 'u_gtaoTexture']);

/** @internal Reusable pass-owned output populated while scene storage draws are prepared. */
export interface StorageScenePreparationState {
    readonly globalBindGroupLayouts: ResourceRegistryHandle<RHIBindGroupLayout>[];
}

/** @internal Reusable pass-owned output for the graph-resolved opaque scene texture. */
export interface SceneTexturePreparationState {
    globalBindGroupLayout: ResourceRegistryHandle<RHIBindGroupLayout> | null;
    bindingName: 'u_opaqueTexture' | 'u_gtaoTexture' | null;
}

interface MeshUniformHandleScratch {
    handles: ResourceRegistryHandle<RHIBuffer>[];
}

type MeshBindingPipelineRecord = Pick<PipelineResourceRecord, 'bindingPlan'>;

interface MutableSampledBindingResources {
    textureView: ResourceRegistryHandle<RHITextureView>;
    sampler: ResourceRegistryHandle<RHISampler>;
}

interface MeshSampledBindingScratch {
    resources: MutableSampledBindingResources[];
    sources: Texture<unknown>[];
}

const EMPTY_SAMPLED_RESOURCES: readonly ShaderSampledBindingResources[] = Object.freeze([]);
const EMPTY_TEXTURE_SOURCES: readonly Texture<unknown>[] = Object.freeze([]);
const PRIMITIVE_RESTART_INDEX_BUFFER_OPTIONS = Object.freeze({ primitiveRestart: true });
const COLOR_SHADER_COMPILE_OPTIONS: Readonly<ShaderArtifactCompileOptions> = Object.freeze({
    fragmentOutputs: 'color'
});
const DEPTH_ONLY_SHADER_COMPILE_OPTIONS: Readonly<ShaderArtifactCompileOptions> = Object.freeze({
    fragmentOutputs: 'depth-only'
});
const COLOR_NUMERIC_DEPTH_COMPILE_OPTIONS = new Map<
    number,
    Readonly<ShaderArtifactCompileOptions>
>();
const DEPTH_ONLY_NUMERIC_DEPTH_COMPILE_OPTIONS = new Map<
    number,
    Readonly<ShaderArtifactCompileOptions>
>();

function numericDepthCompileOptions(
    fragmentOutputMode: ShaderFragmentOutputMode,
    mask: number
): Readonly<ShaderArtifactCompileOptions> {
    if (mask === 0) {
        return fragmentOutputMode === 'color'
            ? COLOR_SHADER_COMPILE_OPTIONS
            : DEPTH_ONLY_SHADER_COMPILE_OPTIONS;
    }
    const cache =
        fragmentOutputMode === 'color'
            ? COLOR_NUMERIC_DEPTH_COMPILE_OPTIONS
            : DEPTH_ONLY_NUMERIC_DEPTH_COMPILE_OPTIONS;
    let options = cache.get(mask);
    if (options === undefined) {
        options = Object.freeze({
            fragmentOutputs: fragmentOutputMode,
            numericDepthSamplerMask: mask
        });
        cache.set(mask, options);
    }
    return options;
}

function sampledTextureElement(value: unknown, arrayIndex: number): unknown {
    if (Array.isArray(value)) return value[arrayIndex];
    return arrayIndex === 0 ? value : undefined;
}

function requireMaterialPassState(
    material: Material,
    role: MaterialPassRole
): Readonly<MaterialPipelineState> {
    const state = resolveMaterialPassState(material, role);
    if (state === null) {
        throw new TypeError(`Material definition ${material.definition.id} has no ${role} pass`);
    }
    return state;
}

function validateMaterialPassTarget(
    role: MaterialPassRole,
    target: RHIMeshDrawTargetDescriptor
): void {
    if (role !== 'motion-vector' && role !== 'material-attributes') return;
    const motionTargetValid =
        role === 'motion-vector' &&
        (target.colorFormats.length === 1 || target.colorFormats.length === 2) &&
        target.colorFormats[0] === 'rgba16float' &&
        (target.colorFormats.length === 1 || target.colorFormats[1] === 'r8unorm') &&
        target.sampleCount === 1;
    if (motionTargetValid) return;
    const materialTargetValid =
        role === 'material-attributes' &&
        target.sampleCount === 1 &&
        target.colorFormats[0] === 'rgba8unorm' &&
        (target.colorFormats.length === 1 ||
            (target.colorFormats.length === 3 &&
                target.colorFormats[1] === target.colorFormats[2] &&
                (target.colorFormats[1] === 'rg11b10ufloat' ||
                    target.colorFormats[1] === 'rgba16float')));
    if (!materialTargetValid) {
        throw new TypeError(
            role === 'motion-vector'
                ? 'Motion-vector mesh draws require single-sample rgba16float motion and optional r8unorm reactive targets'
                : 'Material-attributes mesh draws require single-sample rgba8unorm attributes and optional matching HDR reflection targets'
        );
    }
}

const SHADER_GEOMETRY_OPTION_FIELDS = Object.freeze([
    'positionDecodeMat',
    'normalDecodeMat',
    'uvDecodeMat',
    'uv1DecodeMat',
    'colors',
    'skinIndices',
    'skinWeights',
    'targets'
] as const);

interface MeshShaderSnapshot {
    readonly geometry: Geometry;
    readonly geometryRevision: number;
    readonly material: Material;
    readonly geometryOptionValues: readonly unknown[];
    readonly colorSize: unknown;
    readonly fog: RenderGraphFrameContext['fog'];
    readonly fogMode: unknown;
    readonly useLogDepth: boolean;
    readonly vertexPrecision: RendererCore['vertexPrecision'];
    readonly fragmentPrecision: RendererCore['fragmentPrecision'];
    readonly commonOptions: Readonly<Record<string, number>>;
    readonly instanced: boolean;
    readonly linearOutput: boolean;
    readonly role: MaterialPassRole;
    readonly groundTruthAmbientOcclusion: boolean;
    readonly temporalReactiveMask: boolean;
    readonly materialReflectionData: boolean;
    readonly shader: Shader;
}

interface InstanceDrawRecord {
    geometry: Geometry;
    material: Material;
    readonly meshes: Mesh[];
    perVertexLayouts: readonly Readonly<RHIVertexBufferLayout>[];
    instanceLayout: Readonly<RHIVertexBufferLayout> | null;
    combinedLayouts: readonly Readonly<RHIVertexBufferLayout>[];
    baseRevision: PreparedDrawRevision;
    instanceCount: number;
    layoutRevision: number;
    resourceRevision: number;
    revision: PreparedDrawRevision;
    readonly instanceSources: Set<GeometryData>;
    readonly instanceBlocks: Set<UniformBuffer>;
}

interface ShadowDrawRecord {
    readonly mesh: Mesh;
    sourceMaterial: Material;
    material: Material;
    sources: readonly Texture<unknown>[];
}

function optionValueEqual(left: unknown, right: unknown): boolean {
    return (
        left === right ||
        (typeof left === 'number' &&
            typeof right === 'number' &&
            Number.isNaN(left) &&
            Number.isNaN(right))
    );
}

function optionFieldsMatch(
    owner: object,
    fields: readonly string[],
    snapshot: readonly unknown[]
): boolean {
    if (fields.length !== snapshot.length) return false;
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        if (field === undefined || !optionValueEqual(Reflect.get(owner, field), snapshot[index])) {
            return false;
        }
    }
    return true;
}

function snapshotOptionFields(owner: object, fields: readonly string[]): readonly unknown[] {
    const values = new Array<unknown>(fields.length);
    for (let index = 0; index < fields.length; index += 1) {
        const field = fields[index];
        if (field !== undefined) values[index] = Reflect.get(owner, field);
    }
    return Object.freeze(values);
}

function optionalColorSize(colors: unknown): unknown {
    return typeof colors === 'object' && colors !== null ? Reflect.get(colors, 'size') : undefined;
}

function commonShaderOptionsMatch(snapshot: Readonly<Record<string, number>>): boolean {
    let snapshotCount = 0;
    let currentCount = 0;
    for (const name in snapshot) {
        if (!Object.hasOwn(snapshot, name)) continue;
        snapshotCount++;
        if (
            !Object.hasOwn(Shader.commonOptions, name) ||
            !optionValueEqual(snapshot[name], Shader.commonOptions[name])
        ) {
            return false;
        }
    }
    for (const name in Shader.commonOptions) {
        if (Object.hasOwn(Shader.commonOptions, name)) currentCount++;
    }
    return snapshotCount === currentCount;
}

function snapshotCommonShaderOptions(): Readonly<Record<string, number>> {
    const snapshot: Record<string, number> = {};
    for (const name in Shader.commonOptions) {
        const value = Shader.commonOptions[name];
        if (Object.hasOwn(Shader.commonOptions, name) && value !== undefined) {
            snapshot[name] = value;
        }
    }
    return Object.freeze(snapshot);
}

function requireLightCount(value: number, expected: number, limit: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value !== expected) {
        throw new RangeError(
            `${name} count ${String(value)} does not match the active LightManager list length ${String(expected)}`
        );
    }
    if (value > limit) {
        throw new RangeError(
            `${name} count ${String(value)} exceeds the fixed UBO capacity ${String(limit)}`
        );
    }
}

function requirePackedLightArray(value: unknown, length: number, name: string): void {
    if (!(value instanceof Float32Array)) {
        throw new TypeError(`${name} must be packed as Float32Array`);
    }
    if (value.length !== length) {
        throw new RangeError(
            `${name} contains ${String(value.length)} values; ${String(length)} are required by the active light count`
        );
    }
    for (let index = 0; index < value.length; index += 1) {
        if (!Number.isFinite(value[index])) {
            throw new TypeError(`${name}[${String(index)}] must be finite`);
        }
    }
}

/** Shared dependencies exposed for recovery, diagnostics, and later renderer feature slices. */
export interface MeshDrawProcessorResources {
    readonly registry: ResourceRegistry;
    readonly buffers: BufferResourceCache;
    readonly textures: TextureResourceCache;
    readonly compiler: ShaderArtifactCompiler;
    readonly shaders: ShaderResourceCache;
    readonly pipelines: PipelineResourceCache;
    readonly bindGroups: ShaderBindGroupResourceCache;
    readonly vertexInputs: VertexInputLayoutCompiler;
    readonly instances: InstanceBatchCompiler;
    readonly submissions: SubmissionResourceTracker;
    readonly resourceUses: FrameResourceUseTracker;
}

/**
 * First real Scene/Mesh/Material → PreparedDraw production slice.
 *
 * The accepted feature set is identical on both backends: portable per-vertex streams (including
 * bounded morph and skinning streams), planner-owned instanced batches, portable primitive modes,
 * optional Uint16/Uint32 indices, built-in lighting/PBR and shared shadow-atlas sampling through
 * std140 uniform blocks, and portable sampled textures. Unsupported states fail during
 * preparation, before an RHI frame starts.
 */
export class MeshDrawProcessor {
    readonly registry: ResourceRegistry;
    readonly buffers: BufferResourceCache;
    readonly textures: TextureResourceCache;
    readonly compiler: ShaderArtifactCompiler;
    readonly shaders: ShaderResourceCache;
    readonly pipelines: PipelineResourceCache;
    readonly bindGroups: ShaderBindGroupResourceCache;
    readonly vertexInputs: VertexInputLayoutCompiler;
    readonly instances: InstanceBatchCompiler;
    readonly submissions: SubmissionResourceTracker;
    readonly resourceUses: FrameResourceUseTracker;
    readonly uniformBlocks: BuiltInUniformBlockManager;
    /**
     * Logical vertex-input equivalent: exact prepared vertex layout and bound-buffer packets.
     * A backend-owned provider may replace this when it has a more concrete cache.
     */
    readonly vertexInputCacheMetrics: Readonly<RHICacheCounters>;

    readonly #draws: PreparedDrawCache<Mesh>;
    readonly #shadowDraws: PreparedDrawCache<object>;
    readonly #instanceDraws: PreparedDrawCache<object>;
    readonly #revisions = new MeshDrawRevisionTracker();
    readonly #instanceRecords = new Map<object, InstanceDrawRecord>();
    readonly #shadowRecords = new Map<object, ShadowDrawRecord>();
    #shadowOwnersByMesh = new WeakMap<Mesh, Set<object>>();
    #instanceOwnersByMesh = new WeakMap<Mesh, Set<object>>();
    #nextInstanceRevision = 1;
    #uniformScratch = new WeakMap<object, MeshUniformHandleScratch>();
    #sampledScratch = new WeakMap<object, MeshSampledBindingScratch>();
    readonly #sampledGraphDependencies: ExternalTextureGraphDependency[] = [];
    #sampledSourcesByMesh = new WeakMap<Mesh, readonly Texture<unknown>[]>();
    readonly #textureReferenceCounts = new Map<Texture<unknown>, number>();
    #vertexSourcesByGeometry = new WeakMap<Geometry, Set<GeometryData>>();
    #shaderSnapshots = new WeakMap<Mesh, MeshShaderSnapshot>();
    #shaderByMesh = new WeakMap<Mesh, Shader>();
    #shaderByShadowOwner = new WeakMap<object, Shader>();
    readonly #shaderReferenceCounts = new Map<Shader, number>();
    readonly #preparedMeshes = new Set<Mesh>();
    readonly #programBindingInfo: SemanticProgramBindingInfo = {};
    #context: RenderGraphFrameContext | null = null;
    #resourceFrameUploads: RHIUploadBatch | null = null;
    #passSemanticFrame: Readonly<SemanticFrameState> | null = null;
    #validatedLightingFrame = -1;
    #validatedLightManager: LightManager | null = null;
    #hasShadowSamplerDependency = false;
    #destroyed = false;

    #pendingMesh: Mesh | null = null;
    #pendingOwner: object | null = null;
    #pendingMaterial: Material | null = null;
    #pendingMaterialState: Readonly<MaterialPipelineState> | null = null;
    #pendingGraphicsPipeline: RHIGraphicsPipeline | null = null;
    #pendingBindingPlan: Readonly<PipelineResourceRecord['bindingPlan']> | null = null;
    #pendingDeferredBindGroup = -1;
    readonly #pendingVertexBuffers: (RHIBuffer | null)[];
    #pendingVertexBufferCount = 0;
    #pendingIndexBuffer: RHIBuffer | null = null;
    #pendingIndexFormat: RHIIndexFormat = 'uint16';
    #pendingElementCount = 0;
    #pendingInstanceCount = 1;

    readonly #updatePreparedDraw: PreparedDrawUpdate = draw => {
        const mesh = this.#pendingMesh;
        const owner = this.#pendingOwner;
        const material = this.#pendingMaterial;
        const materialState = this.#pendingMaterialState;
        const pipeline = this.#pendingGraphicsPipeline;
        const bindingPlan = this.#pendingBindingPlan;
        if (
            !mesh ||
            !owner ||
            !material ||
            !pipeline ||
            !materialState ||
            !bindingPlan ||
            this.#pendingVertexBufferCount === 0
        ) {
            throw new Error('Mesh draw processor lost its pending preparation state');
        }
        draw.setPipeline(pipeline);
        for (const group of bindingPlan.activeGroupIndices) {
            if (group === this.#pendingDeferredBindGroup) {
                draw.deferBindGroup(group);
                continue;
            }
            const bindGroup = this.bindGroups.resolveGroup(owner, group);
            if (!bindGroup) {
                throw new Error(`Prepared mesh draw is missing bind group ${String(group)}`);
            }
            draw.setBindGroup(group, bindGroup);
        }
        for (let slot = 0; slot < this.#pendingVertexBufferCount; slot += 1) {
            const vertexBuffer = this.#pendingVertexBuffers[slot];
            if (vertexBuffer === null || vertexBuffer === undefined) {
                throw new Error(`Prepared mesh draw is missing vertex buffer ${String(slot)}`);
            }
            draw.setVertexBuffer(slot, vertexBuffer);
        }
        if (this.#pendingIndexBuffer) {
            draw.setIndexBuffer(
                this.#pendingIndexBuffer,
                this.#pendingIndexFormat,
                0,
                this.#pendingIndexBuffer.size
            );
            draw.setDrawIndexed(this.#pendingElementCount, this.#pendingInstanceCount);
        } else {
            draw.setDraw(this.#pendingElementCount, this.#pendingInstanceCount);
        }
        draw.setDynamicState(mapRHIMeshDrawDynamicState(materialState));
        draw.setSortKey(0, 0);
    };

    constructor(
        readonly renderer: RendererCore,
        device: RHIDevice,
        compiler = new ShaderArtifactCompiler()
    ) {
        this.registry = new ResourceRegistry(device);
        this.compiler = compiler;
        this.buffers = new BufferResourceCache(this.registry);
        this.textures = new TextureResourceCache(this.registry);
        this.shaders = new ShaderResourceCache(this.registry, compiler);
        this.pipelines = new PipelineResourceCache(this.registry, this.shaders, compiler);
        this.bindGroups = new ShaderBindGroupResourceCache(this.registry);
        this.vertexInputs = new VertexInputLayoutCompiler();
        this.instances = new InstanceBatchCompiler();
        this.submissions = new SubmissionResourceTracker(this.registry);
        this.resourceUses = new FrameResourceUseTracker(this.registry);
        this.uniformBlocks = new BuiltInUniformBlockManager(renderer);
        const vertexBufferCapacity = device.capabilities.limits.maxVertexBuffers;
        this.#pendingVertexBuffers = new Array<RHIBuffer | null>(vertexBufferCapacity).fill(null);
        this.#draws = new PreparedDrawCache(
            device.capabilities.limits.maxBindGroups,
            vertexBufferCapacity
        );
        this.#shadowDraws = new PreparedDrawCache(
            device.capabilities.limits.maxBindGroups,
            vertexBufferCapacity
        );
        this.#instanceDraws = new PreparedDrawCache(
            device.capabilities.limits.maxBindGroups,
            vertexBufferCapacity
        );
        this.vertexInputCacheMetrics = new RHICacheCounterAggregate([
            this.#draws.metrics,
            this.#shadowDraws.metrics,
            this.#instanceDraws.metrics
        ]);
    }

    get active(): boolean {
        return this.buffers.active;
    }

    get destroyed(): boolean {
        return this.#destroyed;
    }

    get resources(): MeshDrawProcessorResources {
        return this;
    }

    /** Stable current-pass producer identities collected while resolving sampled bindings. */
    get sampledGraphDependencies(): readonly ExternalTextureGraphDependency[] {
        return this.#sampledGraphDependencies;
    }

    /** Initialize the Naga translator when this processor targets WebGPU. */
    async initialize(): Promise<void> {
        this.assertAlive();
        if (this.registry.deviceBackend === 'webgpu') await this.compiler.initialize();
    }

    /** Enlist recoverable buffer and texture uploads in one RenderGraphFrame transaction. */
    beginFrame(context: RenderGraphFrameContext, uploads: RHIUploadBatch): void {
        this.beginResourceFrame(context, uploads);
        this.beginSemanticFrame(context);
    }

    /**
     * Enlist shared renderer resources without preparing scene, camera, lighting, or uniform-block
     * semantics. Compute, GPU-driven, and fullscreen work use this path when they only need the
     * processor's transactional caches.
     */
    beginResourceFrame(context: RenderGraphFrameContext, uploads: RHIUploadBatch): void {
        this.assertAlive();
        if (this.active) {
            throw new Error('Mesh draw processor frame is already active');
        }
        this.validateContext(context);
        this.#context = context;
        this.#resourceFrameUploads = uploads;
        this.#passSemanticFrame = null;
        this.#sampledGraphDependencies.length = 0;
        this.buffers.beginFrame(context.frameIndex, uploads);
        this.textures.beginFrame(context.frameIndex, uploads);
        this.resourceUses.beginFrame(context.frameIndex, uploads);
    }

    /** Activate scene-owned semantics after a resource-only frame has already been enlisted. */
    beginSemanticFrame(context: RenderGraphFrameContext): void {
        this.assertAlive();
        const activeContext = this.requireResourceContext();
        const uploads = this.#resourceFrameUploads;
        if (uploads === null) throw new Error('Mesh draw resource frame has no upload transaction');
        this.validateContext(context);
        if (context.frameIndex !== activeContext.frameIndex) {
            throw new Error('Mesh draw semantic frame belongs to another application frame');
        }
        if (this.#passSemanticFrame !== null) {
            throw new Error('Mesh draw semantic frame is already active');
        }
        this.activateContext(context, true, uploads);
    }

    /**
     * Switch scene-owned semantics inside the current application frame without restarting its
     * resource/upload transaction.
     */
    beginContextPass(context: RenderGraphFrameContext): void {
        this.assertAlive();
        const activeContext = this.requireSemanticContext();
        this.validateContext(context);
        if (context.frameIndex !== activeContext.frameIndex) {
            throw new Error('Mesh draw context pass belongs to another application frame');
        }
        this.activateContext(context, false);
    }

    /** Select the camera/viewport semantics for one pass without advancing frame-scoped state. */
    beginPass(camera: RenderGraphFrameContext['camera'], viewport: Readonly<RHIViewport>): void {
        this.assertAlive();
        const context = this.requireSemanticContext();
        this.#sampledGraphDependencies.length = 0;
        const semanticFrame = createSemanticFrameState({
            renderer: context.renderer,
            camera,
            lightManager: context.lightManager,
            fog: context.fog,
            viewport: [viewport.x, viewport.y, viewport.width, viewport.height]
        });
        this.uniformBlocks.beginSemanticPass(semanticFrame);
        this.#programBindingInfo.semanticFrame = semanticFrame;
        this.#passSemanticFrame = semanticFrame;
    }

    private validateContext(context: RenderGraphFrameContext): void {
        if (context.renderer !== this.renderer) {
            throw new Error('Mesh draw context belongs to another renderer');
        }
        if (
            context.rhi.id !== this.registry.deviceId ||
            context.rhi.backend !== this.registry.deviceBackend ||
            context.rhi.generation !== this.registry.deviceGeneration
        ) {
            throw new Error('Mesh draw context belongs to another RHI device generation');
        }
        if (!(context.lightManager instanceof LightManager)) {
            throw new TypeError('Mesh draw lighting requires a real LightManager instance');
        }
        if (context.renderer.useLogDepth) {
            const far: unknown = Reflect.get(context.camera, 'far');
            if (context.camera.depthMode === 'reversed') {
                throw new TypeError('Logarithmic depth cannot be combined with reversed-Z.');
            }
            if (typeof far !== 'number' || !Number.isFinite(far)) {
                throw new TypeError('Logarithmic depth requires a finite camera far plane.');
            }
        }
    }

    private activateContext(
        context: RenderGraphFrameContext,
        applicationFrame: boolean,
        uploads?: RHIUploadBatch
    ): void {
        context.lightManager.updateInfo(context.camera);
        refreshShadowAtlasSceneBinding(context.lightManager);
        this.#validatedLightingFrame = -1;
        this.#validatedLightManager = null;
        this.#hasShadowSamplerDependency = false;
        this.#sampledGraphDependencies.length = 0;
        if (applicationFrame) this.uniformBlocks.beginSemanticFrame(context.semantic, uploads);
        else this.uniformBlocks.beginSemanticPass(context.semantic);
        this.#programBindingInfo.semanticFrame = context.semantic;
        this.#passSemanticFrame = context.semantic;
        this.#context = context;
    }

    prepare(
        mesh: Mesh,
        target: RHIMeshDrawTargetDescriptor,
        materialOverride: Material | null = null,
        sceneTexturePreparation: SceneTexturePreparationState | null = null,
        materialPass?: MaterialPassRole
    ): PreparedDraw {
        this.assertAlive();
        const context = this.requireSemanticContext();
        const geometry = mesh.geometry;
        const material = materialOverride ?? context.renderer.forceMaterial ?? mesh.material;
        if (!geometry || !material) {
            throw new Error(`Mesh ${mesh.id} requires geometry and material`);
        }
        if (mesh.useInstanced) {
            throw new TypeError('Instanced meshes are outside the first mesh-draw slice');
        }
        const fragmentOutputMode = this.fragmentOutputModeFor(target);
        const role =
            materialPass ?? (fragmentOutputMode === 'depth-only' ? 'depth-only' : 'forward');
        validateMaterialPassTarget(role, target);
        if (role === 'motion-vector') this.uniformBlocks.markMotionVectorParticipation(mesh);
        const materialState = requireMaterialPassState(material, role);
        this.validateLighting(mesh, material, context);
        this.validateDeformation(mesh, geometry);
        geometry.normalizePrimitiveTopology();
        if (materialState.wireframe && geometry.mode !== LINES) geometry.convertToLinesMode();
        mapRHIPrimitiveTopology(geometry.mode);
        const indices = geometry.indices;
        const primitiveRestart =
            indices !== null && (geometry.mode === LINE_STRIP || geometry.mode === TRIANGLE_STRIP);
        const indexFormat = indices ? mapPortableRHIIndexFormat(indices) : 'uint16';
        const stripIndexFormat = primitiveRestart ? indexFormat : undefined;

        const shader = this.resolveShader(
            mesh,
            geometry,
            material,
            context,
            false,
            target,
            role,
            sceneTexturePreparation?.bindingName === 'u_gtaoTexture'
        );
        const baseCompiled =
            fragmentOutputMode === 'depth-only'
                ? this.compiler.compile(
                      shader,
                      this.registry.deviceBackend,
                      DEPTH_ONLY_SHADER_COMPILE_OPTIONS
                  )
                : this.compiler.compile(shader, this.registry.deviceBackend);
        const numericDepthSamplerMask = this.numericDepthSamplerMask(mesh, material, baseCompiled);
        const compiled =
            numericDepthSamplerMask === 0
                ? baseCompiled
                : this.compiler.compile(
                      shader,
                      this.registry.deviceBackend,
                      numericDepthCompileOptions(fragmentOutputMode, numericDepthSamplerMask)
                  );
        if (fragmentOutputMode === 'color') {
            this.validateFragmentOutputs(compiled.metadata.fragmentOutputs, material, target);
        }
        const vertexPlan = this.vertexInputs.compile(
            compiled.metadata.vertexInputs,
            mesh,
            material,
            this.registry.deviceCapabilities,
            this.#programBindingInfo
        );
        const pipeline = this.pipelines.prepare(
            shader,
            vertexPlan.vertexBuffers,
            materialState,
            target,
            fragmentOutputMode,
            geometry.mode,
            stripIndexFormat,
            numericDepthSamplerMask,
            context.camera.depthMode
        );

        const uniformHandles = this.prepareUniformBuffers(
            mesh,
            mesh,
            material,
            pipeline,
            context,
            null
        );
        const sampledResources = this.prepareSampledResources(mesh, mesh, material, pipeline);
        const deferSceneTexture =
            sceneTexturePreparation !== null &&
            pipeline.bindingPlan.sampledBindings.some(
                binding =>
                    binding.group === SCENE_STORAGE_BIND_GROUP &&
                    PASS_GLOBAL_SCENE_TEXTURE_NAMES.has(binding.name)
            );
        const bindingSet = this.bindGroups.prepare(
            mesh,
            pipeline.bindingLayoutToken,
            pipeline.bindingPlan,
            pipeline.bindGroupLayouts,
            uniformHandles,
            sampledResources,
            deferSceneTexture ? DEFERRED_SCENE_STORAGE_GROUPS : undefined
        );
        for (let slot = 0; slot < vertexPlan.streams.length; slot += 1) {
            const stream = vertexPlan.streams[slot];
            if (stream?.slot !== slot) {
                throw new Error('Vertex input plan contains a non-contiguous stream slot');
            }
            this.#pendingVertexBuffers[slot] = this.buffers.prepareVertexBuffer(
                stream.source,
                stream.sources
            );
        }
        const indexBuffer = indices
            ? this.buffers.prepareIndexBuffer(
                  indices,
                  primitiveRestart ? PRIMITIVE_RESTART_INDEX_BUFFER_OPTIONS : undefined
              )
            : null;
        const elementCount = indices?.count ?? vertexPlan.vertexCount;
        if (!Number.isSafeInteger(elementCount) || elementCount < 1) {
            throw new RangeError('Prepared mesh draw requires a positive integer element count');
        }

        const revision = this.#revisions.capture({
            mesh,
            material,
            materialPass: role,
            shaderToken: pipeline.shaderToken,
            resourceBindings: bindingSet.token,
            vertexLayoutIdentity: vertexPlan,
            target,
            deviceGeneration: this.registry.generation
        });
        this.#pendingMesh = mesh;
        this.#pendingOwner = mesh;
        this.#pendingMaterial = material;
        this.#pendingMaterialState = materialState;
        this.#pendingGraphicsPipeline = this.registry.resolve(pipeline.pipeline);
        this.#pendingBindingPlan = pipeline.bindingPlan;
        this.#pendingDeferredBindGroup = deferSceneTexture ? SCENE_STORAGE_BIND_GROUP : -1;
        this.#pendingVertexBufferCount = vertexPlan.streams.length;
        this.#pendingIndexBuffer = indexBuffer;
        this.#pendingIndexFormat = indexFormat;
        this.#pendingElementCount = elementCount;
        if (vertexPlan.instanceCapacity === 1 && mesh.instanceCount !== 1) {
            throw new TypeError(
                `Mesh ${mesh.id} instanceCount requires at least one per-instance GeometryData stream`
            );
        }
        if (mesh.instanceCount > vertexPlan.instanceCapacity) {
            throw new RangeError(
                `Mesh ${mesh.id} instanceCount ${String(mesh.instanceCount)} exceeds instance stream capacity ${String(vertexPlan.instanceCapacity)}`
            );
        }
        this.#pendingInstanceCount = mesh.instanceCount;
        const prepared = this.#draws.prepare(mesh, revision, this.#updatePreparedDraw);

        this.resourceUses.use(pipeline.pipeline);
        for (const group of bindingSet.activeGroupIndices) {
            const handle = bindingSet.groupHandles[group];
            if (handle !== null && handle !== undefined) this.resourceUses.use(handle);
        }
        this.trackMeshShader(mesh, shader);
        this.trackGeometrySources(geometry, vertexPlan.streams);
        this.trackMeshTextures(mesh, this.requireSampledScratchSources(mesh, sampledResources));
        this.#preparedMeshes.add(mesh);
        if (deferSceneTexture) {
            const layout = pipeline.bindGroupLayouts[SCENE_STORAGE_BIND_GROUP];
            if (layout === undefined) {
                throw new Error('Opaque scene texture lost its pass-global bind-group layout');
            }
            if (
                sceneTexturePreparation.globalBindGroupLayout !== null &&
                sceneTexturePreparation.globalBindGroupLayout !== layout
            ) {
                throw new Error('Opaque scene texture meshes produced incompatible layouts');
            }
            sceneTexturePreparation.globalBindGroupLayout = layout;
        }
        return prepared;
    }

    /**
     * Prepare one ordinary renderer-list mesh with an explicit storage-aware scene shader.
     *
     * The mesh keeps the shared geometry, culling, sorting, material raster state, semantic UBO,
     * texture, upload, recovery, and PreparedDraw paths. Only the graphics shader/pipeline is
     * replaced. Group three is left unbound here and filled once per pass during graph prepare.
     *
     * @internal
     */
    prepareStorageScene(
        mesh: Mesh,
        target: RHIMeshDrawTargetDescriptor,
        shader: StorageGraphicsShader,
        storagePipelines: GPUDrivenPipelineResourceCache,
        preparationState: StorageScenePreparationState,
        materialOverride: Material | null = null,
        plannerInstancedFallback = false
    ): PreparedDraw {
        this.assertAlive();
        const context = this.requireSemanticContext();
        if (storagePipelines.registry !== this.registry) {
            throw new Error('Scene storage pipeline cache must share the mesh resource registry');
        }
        if (this.registry.deviceBackend !== 'webgpu') {
            throw new Error('Scene storage shader variants are supported only by WebGPU');
        }
        if (this.registry.deviceCapabilities.limits.maxBindGroups <= SCENE_STORAGE_BIND_GROUP) {
            throw new RangeError('Scene storage shader variants require at least four bind groups');
        }
        if (mesh.useInstanced && !plannerInstancedFallback) {
            throw new TypeError(
                'Instanced scene storage meshes require the renderer-list direct-draw fallback'
            );
        }
        const geometry = mesh.geometry;
        const material = materialOverride ?? context.renderer.forceMaterial ?? mesh.material;
        if (!geometry || !material) {
            throw new Error(`Mesh ${mesh.id} requires geometry and material`);
        }
        const materialState = requireMaterialPassState(material, 'forward');
        if (
            shader.bindings.some(
                binding => binding.kind === 'uniform-buffer' && binding.name === 'LightBlock'
            )
        ) {
            this.validateLighting(mesh, material, context);
        }
        this.validateSceneStorageShader(shader);
        this.validateDeformation(mesh, geometry);
        geometry.normalizePrimitiveTopology();
        if (materialState.wireframe && geometry.mode !== LINES) geometry.convertToLinesMode();
        mapRHIPrimitiveTopology(geometry.mode);
        const indices = geometry.indices;
        const primitiveRestart =
            indices !== null && (geometry.mode === LINE_STRIP || geometry.mode === TRIANGLE_STRIP);
        const indexFormat = indices ? mapPortableRHIIndexFormat(indices) : 'uint16';
        const stripIndexFormat = primitiveRestart ? indexFormat : undefined;

        if (this.fragmentOutputModeFor(target) !== 'color') {
            throw new TypeError('Scene storage shader variants require at least one color target');
        }
        const compiled = storagePipelines.resolveCompiledShader(shader);
        this.validateFragmentOutputs(compiled.metadata.fragmentOutputs, material, target);
        const vertexPlan = this.vertexInputs.compile(
            compiled.metadata.vertexInputs,
            mesh,
            material,
            this.registry.deviceCapabilities,
            this.#programBindingInfo,
            plannerInstancedFallback
        );
        const pipeline = storagePipelines.prepareScene(
            shader,
            materialState,
            vertexPlan.vertexBuffers,
            target,
            geometry.mode,
            stripIndexFormat,
            context.camera.depthMode
        );
        const globalLayout = pipeline.bindGroupLayouts[SCENE_STORAGE_BIND_GROUP];
        if (globalLayout === undefined) {
            throw new Error('Scene storage shader lost its fixed pass-global bind-group layout');
        }

        const uniformHandles = this.prepareUniformBuffers(
            mesh,
            mesh,
            material,
            pipeline,
            context,
            null
        );
        const sampledResources = this.prepareSampledResources(mesh, mesh, material, pipeline);
        const bindingSet = this.bindGroups.prepare(
            mesh,
            pipeline.bindingLayoutToken,
            pipeline.bindingPlan,
            pipeline.bindGroupLayouts,
            uniformHandles,
            sampledResources,
            DEFERRED_SCENE_STORAGE_GROUPS
        );
        for (let slot = 0; slot < vertexPlan.streams.length; slot += 1) {
            const stream = vertexPlan.streams[slot];
            if (stream?.slot !== slot) {
                throw new Error('Vertex input plan contains a non-contiguous stream slot');
            }
            this.#pendingVertexBuffers[slot] = this.buffers.prepareVertexBuffer(
                stream.source,
                stream.sources
            );
        }
        const indexBuffer = indices
            ? this.buffers.prepareIndexBuffer(
                  indices,
                  primitiveRestart ? PRIMITIVE_RESTART_INDEX_BUFFER_OPTIONS : undefined
              )
            : null;
        const elementCount = indices?.count ?? vertexPlan.vertexCount;
        if (!Number.isSafeInteger(elementCount) || elementCount < 1) {
            throw new RangeError('Prepared scene storage draw requires a positive element count');
        }

        const revision = this.#revisions.capture({
            mesh,
            material,
            shaderToken: pipeline.shaderToken,
            // Pass-global storage is overlaid after graph resources resolve. Its buffer/range may
            // change without changing this reusable mesh packet; the fixed layout remains part of
            // the shader/pipeline identity above.
            resourceBindings: bindingSet.token,
            vertexLayoutIdentity: vertexPlan,
            target,
            deviceGeneration: this.registry.generation
        });
        this.#pendingMesh = mesh;
        this.#pendingOwner = mesh;
        this.#pendingMaterial = material;
        this.#pendingMaterialState = materialState;
        this.#pendingGraphicsPipeline = storagePipelines.resolvePipeline(pipeline);
        this.#pendingBindingPlan = pipeline.bindingPlan;
        this.#pendingDeferredBindGroup = SCENE_STORAGE_BIND_GROUP;
        this.#pendingVertexBufferCount = vertexPlan.streams.length;
        this.#pendingIndexBuffer = indexBuffer;
        this.#pendingIndexFormat = indexFormat;
        this.#pendingElementCount = elementCount;
        this.#pendingInstanceCount = 1;
        const prepared = this.#draws.prepare(mesh, revision, this.#updatePreparedDraw);

        this.resourceUses.use(pipeline.pipeline);
        for (const group of bindingSet.activeGroupIndices) {
            const handle = bindingSet.groupHandles[group];
            if (handle !== null && handle !== undefined) this.resourceUses.use(handle);
        }
        this.trackGeometrySources(geometry, vertexPlan.streams);
        this.trackMeshTextures(mesh, this.requireSampledScratchSources(mesh, sampledResources));
        this.#preparedMeshes.add(mesh);
        preparationState.globalBindGroupLayouts.push(globalLayout);
        return prepared;
    }

    /** Prepare one cast-shadow mesh variant for a depth-only atlas slice. */
    prepareShadow(owner: object, mesh: Mesh, target: RHIMeshDrawTargetDescriptor): PreparedDraw {
        this.assertAlive();
        const context = this.requireSemanticContext();
        const geometry = mesh.geometry;
        const sourceMaterial = mesh.material;
        if (!geometry || !sourceMaterial) {
            throw new Error(`Mesh ${mesh.id} requires geometry and material`);
        }
        if (!mesh.castShadows) {
            throw new TypeError(`Mesh ${mesh.id} does not participate in shadow casting`);
        }
        const shadowMaterial = sourceMaterial;
        const materialState = requireMaterialPassState(shadowMaterial, 'shadow-caster');
        if (
            target.colorFormats.length !== 0 ||
            target.depthStencilFormat === undefined ||
            target.depthStencilFormat === null
        ) {
            throw new TypeError('Shadow draw preparation requires a pure depth target');
        }
        const previousRecord = this.#shadowRecords.get(owner);
        if (previousRecord !== undefined && previousRecord.mesh !== mesh) {
            throw new Error('Shadow draw owner is already assigned to another mesh');
        }

        this.validateDeformation(mesh, geometry);
        geometry.normalizePrimitiveTopology();
        if (materialState.wireframe && geometry.mode !== LINES) geometry.convertToLinesMode();
        mapRHIPrimitiveTopology(geometry.mode);
        const indices = geometry.indices;
        const primitiveRestart =
            indices !== null && (geometry.mode === LINE_STRIP || geometry.mode === TRIANGLE_STRIP);
        const indexFormat = indices ? mapPortableRHIIndexFormat(indices) : 'uint16';
        const stripIndexFormat = primitiveRestart ? indexFormat : undefined;

        const shader = Shader.getShader(
            mesh,
            shadowMaterial,
            false,
            context.lightManager,
            context.fog,
            context.renderer.useLogDepth,
            context.renderer,
            false,
            'shadow-caster'
        );
        if (!shader) {
            throw new Error(`Shadow material ${shadowMaterial.className} has no renderable shader`);
        }
        const baseCompiled = this.compiler.compile(
            shader,
            this.registry.deviceBackend,
            DEPTH_ONLY_SHADER_COMPILE_OPTIONS
        );
        const numericDepthSamplerMask = this.numericDepthSamplerMask(
            mesh,
            shadowMaterial,
            baseCompiled
        );
        const compiled =
            numericDepthSamplerMask === 0
                ? baseCompiled
                : this.compiler.compile(
                      shader,
                      this.registry.deviceBackend,
                      numericDepthCompileOptions('depth-only', numericDepthSamplerMask)
                  );
        const vertexPlan = this.vertexInputs.compile(
            compiled.metadata.vertexInputs,
            mesh,
            shadowMaterial,
            this.registry.deviceCapabilities,
            this.#programBindingInfo,
            // A shadow fallback is deliberately one direct draw per Mesh. The source Mesh keeps
            // its main-pass instancing opt-in, but this shader has no instance inputs and the
            // PreparedDraw below always uses instanceCount=1 with an owner-local ModelBlock.
            true
        );
        const pipeline = this.pipelines.prepare(
            shader,
            vertexPlan.vertexBuffers,
            materialState,
            target,
            'depth-only',
            geometry.mode,
            stripIndexFormat,
            numericDepthSamplerMask,
            context.camera.depthMode
        );
        const uniformHandles = this.prepareUniformBuffers(
            owner,
            mesh,
            shadowMaterial,
            pipeline,
            context,
            null
        );
        const sampledResources = this.prepareSampledResources(
            owner,
            mesh,
            shadowMaterial,
            pipeline
        );
        const bindingSet = this.bindGroups.prepare(
            owner,
            pipeline.bindingLayoutToken,
            pipeline.bindingPlan,
            pipeline.bindGroupLayouts,
            uniformHandles,
            sampledResources
        );
        for (let slot = 0; slot < vertexPlan.streams.length; slot += 1) {
            const stream = vertexPlan.streams[slot];
            if (stream?.slot !== slot) {
                throw new Error('Shadow vertex input plan contains a non-contiguous stream slot');
            }
            this.#pendingVertexBuffers[slot] = this.buffers.prepareVertexBuffer(
                stream.source,
                stream.sources
            );
        }
        const indexBuffer = indices
            ? this.buffers.prepareIndexBuffer(
                  indices,
                  primitiveRestart ? PRIMITIVE_RESTART_INDEX_BUFFER_OPTIONS : undefined
              )
            : null;
        const elementCount = indices?.count ?? vertexPlan.vertexCount;
        if (!Number.isSafeInteger(elementCount) || elementCount < 1) {
            throw new RangeError('Prepared shadow draw requires a positive integer element count');
        }

        const revision = this.#revisions.capture({
            owner,
            mesh,
            material: shadowMaterial,
            materialPass: 'shadow-caster',
            shaderToken: pipeline.shaderToken,
            resourceBindings: bindingSet.token,
            vertexLayoutIdentity: vertexPlan,
            target,
            deviceGeneration: this.registry.generation
        });
        this.#pendingMesh = mesh;
        this.#pendingOwner = owner;
        this.#pendingMaterial = shadowMaterial;
        this.#pendingMaterialState = materialState;
        this.#pendingGraphicsPipeline = this.registry.resolve(pipeline.pipeline);
        this.#pendingBindingPlan = pipeline.bindingPlan;
        this.#pendingDeferredBindGroup = -1;
        this.#pendingVertexBufferCount = vertexPlan.streams.length;
        this.#pendingIndexBuffer = indexBuffer;
        this.#pendingIndexFormat = indexFormat;
        this.#pendingElementCount = elementCount;
        this.#pendingInstanceCount = 1;
        const prepared = this.#shadowDraws.prepare(owner, revision, this.#updatePreparedDraw);

        this.resourceUses.use(pipeline.pipeline);
        for (const group of bindingSet.activeGroupIndices) {
            const handle = bindingSet.groupHandles[group];
            if (handle !== null && handle !== undefined) this.resourceUses.use(handle);
        }
        this.trackShadowShader(owner, shader);
        this.trackGeometrySources(geometry, vertexPlan.streams);
        this.trackShadowDraw(
            owner,
            mesh,
            sourceMaterial,
            shadowMaterial,
            this.requireSampledScratchSources(owner, sampledResources)
        );
        this.#preparedMeshes.add(mesh);
        return prepared;
    }

    /** Prepare one planner-owned instanced batch as a single draw. */
    prepareInstancedBatch(
        owner: object,
        meshes: readonly Mesh[],
        target: RHIMeshDrawTargetDescriptor,
        materialOverride: Material | null = null,
        sceneTexturePreparation: SceneTexturePreparationState | null = null,
        materialPass?: MaterialPassRole
    ): PreparedDraw {
        this.assertAlive();
        const context = this.requireSemanticContext();
        if (meshes.length < 1 || meshes.length > MAX_INSTANCES_PER_DRAW) {
            throw new RangeError(
                `Instanced mesh draw count must be between 1 and ${String(MAX_INSTANCES_PER_DRAW)}`
            );
        }
        const representative = meshes[0];
        if (representative === undefined) {
            throw new Error('Instanced mesh draw lost its representative mesh');
        }
        const geometry = representative.geometry;
        const sourceMaterial = representative.material;
        const forcedMaterial = materialOverride ?? context.renderer.forceMaterial;
        const material = forcedMaterial ?? sourceMaterial;
        if (!geometry || !material) {
            throw new Error(`Mesh ${representative.id} requires geometry and material`);
        }
        for (let index = 0; index < meshes.length; index += 1) {
            const mesh = meshes[index];
            if (mesh === undefined) {
                throw new TypeError(`Instanced mesh draw entry ${String(index)} is missing`);
            }
            if (!mesh.useInstanced) {
                throw new TypeError(`Mesh ${mesh.id} has not opted into instancing`);
            }
            if (
                mesh.geometry !== geometry ||
                (forcedMaterial === null && mesh.material !== sourceMaterial)
            ) {
                throw new TypeError(
                    'Every mesh in an instanced draw must use the exact same geometry and effective material'
                );
            }
            if (mesh.isSkinnedMesh || geometry.isMorphGeometry) {
                throw new TypeError(
                    'Per-object skinning and morph deformation are not supported by instanced draws'
                );
            }
        }
        const fragmentOutputMode = this.fragmentOutputModeFor(target);
        const role =
            materialPass ?? (fragmentOutputMode === 'depth-only' ? 'depth-only' : 'forward');
        validateMaterialPassTarget(role, target);
        if (role === 'motion-vector') {
            for (const mesh of meshes) this.uniformBlocks.markMotionVectorParticipation(mesh);
        }
        const materialState = requireMaterialPassState(material, role);
        this.validateLighting(representative, material, context);
        geometry.normalizePrimitiveTopology();
        if (materialState.wireframe && geometry.mode !== LINES) geometry.convertToLinesMode();
        mapRHIPrimitiveTopology(geometry.mode);
        const indices = geometry.indices;
        const primitiveRestart =
            indices !== null && (geometry.mode === LINE_STRIP || geometry.mode === TRIANGLE_STRIP);
        const indexFormat = indices ? mapPortableRHIIndexFormat(indices) : 'uint16';
        const stripIndexFormat = primitiveRestart ? indexFormat : undefined;

        const shader = this.resolveShader(
            representative,
            geometry,
            material,
            context,
            true,
            target,
            role,
            sceneTexturePreparation?.bindingName === 'u_gtaoTexture'
        );
        const baseCompiled =
            fragmentOutputMode === 'depth-only'
                ? this.compiler.compile(
                      shader,
                      this.registry.deviceBackend,
                      DEPTH_ONLY_SHADER_COMPILE_OPTIONS
                  )
                : this.compiler.compile(shader, this.registry.deviceBackend);
        const numericDepthSamplerMask = this.numericDepthSamplerMask(
            representative,
            material,
            baseCompiled
        );
        const compiled =
            numericDepthSamplerMask === 0
                ? baseCompiled
                : this.compiler.compile(
                      shader,
                      this.registry.deviceBackend,
                      numericDepthCompileOptions(fragmentOutputMode, numericDepthSamplerMask)
                  );
        if (fragmentOutputMode === 'color') {
            this.validateFragmentOutputs(compiled.metadata.fragmentOutputs, material, target);
        }
        const instancePlan = this.instances.compile(
            owner,
            meshes,
            material,
            compiled.metadata.vertexInputs,
            this.registry.deviceBackend,
            this.registry.deviceCapabilities,
            this.#programBindingInfo,
            forcedMaterial !== null,
            this.uniformBlocks
        );
        const vertexPlan = this.vertexInputs.compile(
            instancePlan.perVertexInputs,
            representative,
            material,
            this.registry.deviceCapabilities,
            this.#programBindingInfo,
            true
        );
        if (vertexPlan.streams.length !== instancePlan.perVertexBufferCount) {
            throw new Error('Instance and per-vertex compilers disagree on vertex-buffer slots');
        }
        const instanceStream = instancePlan.instanceVertexStream;
        if (instanceStream !== null && instanceStream.slot !== vertexPlan.streams.length) {
            throw new Error('Instance stream must immediately follow all per-vertex streams');
        }
        if (
            instancePlan.requiredVertexBufferCount !==
            vertexPlan.streams.length + (instanceStream === null ? 0 : 1)
        ) {
            throw new Error('Instance compiler produced an inconsistent vertex-buffer count');
        }

        const previousRecord = this.#instanceRecords.get(owner);
        const instanceLayout = instanceStream?.layout ?? null;
        let combinedLayouts: readonly Readonly<RHIVertexBufferLayout>[];
        if (
            previousRecord?.perVertexLayouts === vertexPlan.vertexBuffers &&
            previousRecord.instanceLayout === instanceLayout
        ) {
            combinedLayouts = previousRecord.combinedLayouts;
        } else if (instanceLayout === null) {
            combinedLayouts = vertexPlan.vertexBuffers;
        } else {
            combinedLayouts = Object.freeze([...vertexPlan.vertexBuffers, instanceLayout]);
        }
        const pipeline = this.pipelines.prepare(
            shader,
            combinedLayouts,
            materialState,
            target,
            fragmentOutputMode,
            geometry.mode,
            stripIndexFormat,
            numericDepthSamplerMask,
            context.camera.depthMode
        );
        const instanceBlock = instancePlan.webGPUInstanceBlock;
        const uniformHandles = this.prepareUniformBuffers(
            owner,
            representative,
            material,
            pipeline,
            context,
            instanceBlock
        );
        const sampledResources = this.prepareSampledResources(
            owner,
            representative,
            material,
            pipeline
        );
        const deferSceneTexture =
            sceneTexturePreparation !== null &&
            pipeline.bindingPlan.sampledBindings.some(
                binding =>
                    binding.group === SCENE_STORAGE_BIND_GROUP &&
                    PASS_GLOBAL_SCENE_TEXTURE_NAMES.has(binding.name)
            );
        const bindingSet = this.bindGroups.prepare(
            owner,
            pipeline.bindingLayoutToken,
            pipeline.bindingPlan,
            pipeline.bindGroupLayouts,
            uniformHandles,
            sampledResources,
            deferSceneTexture ? DEFERRED_SCENE_STORAGE_GROUPS : undefined
        );
        for (let slot = 0; slot < vertexPlan.streams.length; slot += 1) {
            const stream = vertexPlan.streams[slot];
            if (stream?.slot !== slot) {
                throw new Error('Vertex input plan contains a non-contiguous stream slot');
            }
            this.#pendingVertexBuffers[slot] = this.buffers.prepareVertexBuffer(
                stream.source,
                stream.sources
            );
        }
        if (instanceStream !== null) {
            this.#pendingVertexBuffers[instanceStream.slot] = this.buffers.prepareVertexBuffer(
                instanceStream.source
            );
        }
        const indexBuffer = indices
            ? this.buffers.prepareIndexBuffer(
                  indices,
                  primitiveRestart ? PRIMITIVE_RESTART_INDEX_BUFFER_OPTIONS : undefined
              )
            : null;
        const elementCount = indices?.count ?? vertexPlan.vertexCount;
        if (!Number.isSafeInteger(elementCount) || elementCount < 1) {
            throw new RangeError(
                'Prepared instanced draw requires a positive integer element count'
            );
        }

        const baseRevision = this.#revisions.capture({
            mesh: representative,
            material,
            materialPass: role,
            shaderToken: pipeline.shaderToken,
            resourceBindings: bindingSet.token,
            vertexLayoutIdentity: combinedLayouts,
            target,
            deviceGeneration: this.registry.generation
        });
        const revision = this.captureInstanceRevision(previousRecord, baseRevision, instancePlan);
        this.#pendingMesh = representative;
        this.#pendingOwner = owner;
        this.#pendingMaterial = material;
        this.#pendingMaterialState = materialState;
        this.#pendingGraphicsPipeline = this.registry.resolve(pipeline.pipeline);
        this.#pendingBindingPlan = pipeline.bindingPlan;
        this.#pendingDeferredBindGroup = deferSceneTexture ? SCENE_STORAGE_BIND_GROUP : -1;
        this.#pendingVertexBufferCount = instancePlan.requiredVertexBufferCount;
        this.#pendingIndexBuffer = indexBuffer;
        this.#pendingIndexFormat = indexFormat;
        this.#pendingElementCount = elementCount;
        this.#pendingInstanceCount = instancePlan.instanceCount;
        const prepared = this.#instanceDraws.prepare(owner, revision, this.#updatePreparedDraw);

        this.commitInstanceRecord(
            owner,
            previousRecord,
            meshes,
            geometry,
            material,
            vertexPlan.vertexBuffers,
            instanceLayout,
            combinedLayouts,
            baseRevision,
            instancePlan,
            revision,
            instanceStream?.source ?? null,
            instanceBlock
        );
        this.resourceUses.use(pipeline.pipeline);
        for (const group of bindingSet.activeGroupIndices) {
            const handle = bindingSet.groupHandles[group];
            if (handle !== null && handle !== undefined) this.resourceUses.use(handle);
        }
        this.trackGeometrySources(geometry, vertexPlan.streams);
        if (instanceStream !== null) this.trackGeometrySource(geometry, instanceStream.source);
        const sampledSources = this.requireSampledScratchSources(owner, sampledResources);
        for (const mesh of meshes) {
            this.trackMeshShader(mesh, shader);
            this.trackMeshTextures(mesh, sampledSources);
            this.#preparedMeshes.add(mesh);
        }
        if (deferSceneTexture) {
            const layout = pipeline.bindGroupLayouts[SCENE_STORAGE_BIND_GROUP];
            if (layout === undefined) {
                throw new Error('Opaque scene texture lost its pass-global bind-group layout');
            }
            if (
                sceneTexturePreparation.globalBindGroupLayout !== null &&
                sceneTexturePreparation.globalBindGroupLayout !== layout
            ) {
                throw new Error('Opaque scene texture meshes produced incompatible layouts');
            }
            sceneTexturePreparation.globalBindGroupLayout = layout;
        }
        return prepared;
    }

    /** Convert a successful frame's fence into the registry's deferred-destroy boundary. */
    trackSubmission(frameIndex: number, submission: RHISubmission): Promise<void> {
        this.assertAlive();
        return this.submissions.track(frameIndex, submission);
    }

    /** Replace every logical resource recipe against a same-backend replacement device. */
    recover(device: RHIDevice): void {
        this.assertAlive();
        if (this.active) throw new Error('Cannot recover mesh resources during an active frame');
        if (this.submissions.pendingSubmissionCount !== 0) {
            throw new Error('Cannot recover mesh resources while submissions are in flight');
        }
        if (device.backend !== this.registry.deviceBackend) {
            throw new TypeError('Mesh resource recovery requires the same RHI backend');
        }
        this.submissions.flush();
        this.registry.recover(device);
        this.buffers.synchronizeAfterRecovery();
        this.textures.synchronizeAfterRecovery();
        this.#context = null;
        this.#resourceFrameUploads = null;
        this.#passSemanticFrame = null;
    }

    detachMesh(mesh: Mesh): number {
        this.assertIdle();
        let released = 0;
        const shadowOwners = this.#shadowOwnersByMesh.get(mesh);
        if (shadowOwners !== undefined) {
            for (const owner of [...shadowOwners]) released += this.releaseShadowOwner(owner);
        }
        const instanceOwners = this.#instanceOwnersByMesh.get(mesh);
        if (instanceOwners !== undefined) {
            for (const owner of instanceOwners) released += this.releaseInstanceBatch(owner);
        }
        if (this.bindGroups.detach(mesh)) released++;
        this.#draws.delete(mesh);
        this.#revisions.delete(mesh);
        this.#uniformScratch.delete(mesh);
        this.#sampledScratch.delete(mesh);
        this.#shaderSnapshots.delete(mesh);
        this.releaseMeshShader(mesh);
        released += this.releaseMeshTextures(mesh);
        this.#preparedMeshes.delete(mesh);
        for (const buffer of this.uniformBlocks.releaseOwnerBuffers(mesh)) {
            if (this.buffers.detachUniformBuffer(buffer)) released++;
        }
        return released;
    }

    detachGeometry(geometry: Geometry): number {
        this.assertIdle();
        let released = 0;
        for (const [owner, record] of this.#instanceRecords) {
            if (record.geometry === geometry) released += this.releaseInstanceBatch(owner);
        }
        const sources = this.#vertexSourcesByGeometry.get(geometry);
        if (sources) {
            for (const source of sources) released += this.buffers.detachGeometryData(source);
            this.#vertexSourcesByGeometry.delete(geometry);
        } else if (geometry.vertices) {
            released += this.buffers.detachGeometryData(geometry.vertices);
        }
        if (geometry.indices) released += this.buffers.detachGeometryData(geometry.indices);
        for (const buffer of this.uniformBlocks.releaseOwnerBuffers(geometry)) {
            if (this.buffers.detachUniformBuffer(buffer)) released++;
        }
        return released;
    }

    detachMaterial(material: Material): number {
        this.assertIdle();
        let released = 0;
        for (const [owner, record] of this.#shadowRecords) {
            if (record.sourceMaterial === material || record.material === material) {
                released += this.releaseShadowOwner(owner);
            }
        }
        for (const [owner, record] of this.#instanceRecords) {
            if (record.material === material) released += this.releaseInstanceBatch(owner);
        }
        for (const buffer of this.uniformBlocks.releaseOwnerBuffers(material)) {
            if (this.buffers.detachUniformBuffer(buffer)) released++;
        }
        return released;
    }

    /** Detach one planner-owned batch and all of its batch-local GPU resources. */
    detachInstanceBatch(owner: object): number {
        this.assertIdle();
        return this.releaseInstanceBatch(owner);
    }

    /** Detach one slice/mesh shadow variant and all of its owner-local resources. */
    detachShadowDraw(owner: object): number {
        this.assertIdle();
        return this.releaseShadowOwner(owner);
    }

    /** Detach all batch-local resources and logical compiler owners. */
    resetInstanceBatches(): number {
        this.assertIdle();
        let released = 0;
        for (const owner of this.#instanceRecords.keys()) {
            released += this.releaseInstanceBatch(owner);
        }
        return released;
    }

    collect(completedFrame: number): number {
        this.assertAlive();
        return this.registry.collect(completedFrame);
    }

    destroy(): void {
        if (this.#destroyed) return;
        if (this.active) throw new Error('Cannot destroy mesh resources during an active frame');
        if (this.submissions.pendingSubmissionCount !== 0) {
            throw new Error('Cannot destroy mesh resources while submissions are in flight');
        }
        for (const mesh of this.#preparedMeshes) this.uniformBlocks.releaseOwner(mesh);
        this.#preparedMeshes.clear();
        this.#shaderReferenceCounts.clear();
        this.#textureReferenceCounts.clear();
        this.#shaderByMesh = new WeakMap();
        this.#shaderByShadowOwner = new WeakMap();
        this.#shadowRecords.clear();
        this.#shadowOwnersByMesh = new WeakMap();
        this.instances.reset();
        this.#instanceRecords.clear();
        this.#instanceOwnersByMesh = new WeakMap();
        this.bindGroups.destroy();
        this.pipelines.destroy();
        this.#draws.clear();
        this.#shadowDraws.clear();
        this.#instanceDraws.clear();
        this.shaders.destroy();
        this.textures.destroy();
        this.buffers.destroy();
        this.vertexInputs.clear();
        this.resourceUses.destroy();
        this.submissions.destroy();
        this.registry.destroy();
        this.#uniformScratch = new WeakMap();
        this.#sampledScratch = new WeakMap();
        this.#sampledGraphDependencies.length = 0;
        this.#sampledSourcesByMesh = new WeakMap();
        this.#vertexSourcesByGeometry = new WeakMap();
        this.#shaderSnapshots = new WeakMap();
        this.#context = null;
        this.#resourceFrameUploads = null;
        this.#passSemanticFrame = null;
        this.#validatedLightingFrame = -1;
        this.#validatedLightManager = null;
        this.#hasShadowSamplerDependency = false;
        this.#destroyed = true;
    }

    private resolveShader(
        mesh: Mesh,
        geometry: Geometry,
        material: Material,
        context: RenderGraphFrameContext,
        instanced: boolean,
        target: RHIMeshDrawTargetDescriptor,
        role: MaterialPassRole,
        groundTruthAmbientOcclusion = false
    ): Shader {
        const canUseSnapshot = Reflect.get(material, 'isShaderMaterial') === true;
        const snapshot = canUseSnapshot ? this.#shaderSnapshots.get(mesh) : undefined;
        const linearOutput =
            target.colorFormats[0] === 'rgba16float' || target.colorFormats[0] === 'rgba32float';
        const temporalReactiveMask =
            role === 'motion-vector' && target.colorFormats[1] === 'r8unorm';
        const materialReflectionData =
            role === 'material-attributes' && target.colorFormats.length === 3;
        const colors = Reflect.get(geometry, 'colors');
        if (
            snapshot?.geometry === geometry &&
            snapshot.geometryRevision === geometry.revision &&
            snapshot.material === material &&
            optionFieldsMatch(
                geometry,
                SHADER_GEOMETRY_OPTION_FIELDS,
                snapshot.geometryOptionValues
            ) &&
            optionValueEqual(snapshot.colorSize, optionalColorSize(colors)) &&
            snapshot.fog === context.fog &&
            optionValueEqual(snapshot.fogMode, context.fog?.mode) &&
            snapshot.useLogDepth === context.renderer.useLogDepth &&
            snapshot.vertexPrecision === context.renderer.vertexPrecision &&
            snapshot.fragmentPrecision === context.renderer.fragmentPrecision &&
            snapshot.instanced === instanced &&
            snapshot.linearOutput === linearOutput &&
            snapshot.role === role &&
            snapshot.groundTruthAmbientOcclusion === groundTruthAmbientOcclusion &&
            snapshot.temporalReactiveMask === temporalReactiveMask &&
            snapshot.materialReflectionData === materialReflectionData &&
            commonShaderOptionsMatch(snapshot.commonOptions)
        ) {
            return snapshot.shader;
        }

        const shader = temporalReactiveMask
            ? getTemporalReactiveShader(
                  mesh,
                  material,
                  instanced,
                  context.lightManager,
                  context.fog,
                  context.renderer.useLogDepth,
                  context.renderer,
                  linearOutput,
                  role,
                  groundTruthAmbientOcclusion
              )
            : materialReflectionData
              ? getMaterialReflectionDataShader(
                    mesh,
                    material,
                    instanced,
                    context.lightManager,
                    context.fog,
                    context.renderer.useLogDepth,
                    context.renderer,
                    linearOutput,
                    role,
                    groundTruthAmbientOcclusion
                )
              : Shader.getShader(
                    mesh,
                    material,
                    instanced,
                    context.lightManager,
                    context.fog,
                    context.renderer.useLogDepth,
                    context.renderer,
                    linearOutput,
                    role,
                    groundTruthAmbientOcclusion
                );
        if (!shader) throw new Error(`Material ${material.className} has no renderable shader`);
        if (!canUseSnapshot) {
            this.#shaderSnapshots.delete(mesh);
            return shader;
        }
        this.#shaderSnapshots.set(mesh, {
            geometry,
            geometryRevision: geometry.revision,
            material,
            geometryOptionValues: snapshotOptionFields(geometry, SHADER_GEOMETRY_OPTION_FIELDS),
            colorSize: optionalColorSize(colors),
            fog: context.fog,
            fogMode: context.fog?.mode,
            useLogDepth: context.renderer.useLogDepth,
            vertexPrecision: context.renderer.vertexPrecision,
            fragmentPrecision: context.renderer.fragmentPrecision,
            commonOptions: snapshotCommonShaderOptions(),
            instanced,
            linearOutput,
            role,
            groundTruthAmbientOcclusion,
            temporalReactiveMask,
            materialReflectionData,
            shader
        });
        return shader;
    }

    private fragmentOutputModeFor(target: RHIMeshDrawTargetDescriptor): ShaderFragmentOutputMode {
        return target.colorFormats.length === 0 ? 'depth-only' : 'color';
    }

    private validateSceneStorageShader(shader: StorageGraphicsShader): void {
        let storageCount = 0;
        for (const binding of shader.bindings) {
            if (binding.kind === 'read-only-storage-buffer') {
                storageCount++;
                if (binding.group !== SCENE_STORAGE_BIND_GROUP) {
                    throw new TypeError(
                        `Scene readonly storage binding ${binding.name} must use fixed group ${String(SCENE_STORAGE_BIND_GROUP)}`
                    );
                }
                if (binding.dynamicOffset === true) {
                    throw new TypeError(
                        `Scene readonly storage binding ${binding.name} cannot use dynamic offsets`
                    );
                }
                continue;
            }
            if (binding.kind === 'uniform-buffer' && binding.dynamicOffset === true) {
                throw new TypeError(
                    `Scene uniform binding ${binding.name} cannot use dynamic offsets`
                );
            }
            if (binding.group >= SCENE_STORAGE_BIND_GROUP) {
                throw new TypeError(
                    `Scene ${binding.kind} binding ${binding.name} conflicts with reserved pass-global group ${String(SCENE_STORAGE_BIND_GROUP)}`
                );
            }
        }
        if (storageCount === 0) {
            throw new TypeError(
                'Scene storage shader variant requires at least one readonly storage buffer'
            );
        }
    }

    /** Validate reflected outputs against the same sparse target-location contract as the RHI. */
    private validateFragmentOutputs(
        outputs: readonly { readonly location: number; readonly name: string }[],
        material: Material,
        target: RHIMeshDrawTargetDescriptor
    ): void {
        const customMaterial = Reflect.get(material, 'isShaderMaterial') === true;
        if (outputs.length === 0) {
            throw new TypeError('A color mesh draw requires at least one fragment output');
        }
        const builtInReactiveOutputs =
            target.colorFormats[1] === 'r8unorm' &&
            outputs.length === 2 &&
            outputs[0]?.location === 0 &&
            outputs[1]?.location === 1;
        const builtInMaterialReflectionOutputs =
            target.colorFormats.length === 3 &&
            outputs.length === 3 &&
            outputs[0]?.location === 0 &&
            outputs[1]?.location === 1 &&
            outputs[2]?.location === 2;
        if (
            !customMaterial &&
            !builtInReactiveOutputs &&
            !builtInMaterialReflectionOutputs &&
            (outputs.length !== 1 || outputs[0]?.location !== 0)
        ) {
            throw new TypeError(
                'Built-in mesh shaders require location zero and may write temporal or reflection data to declared MRTs'
            );
        }
        for (let index = 0; index < outputs.length; index += 1) {
            const output = outputs[index];
            if (
                output === undefined ||
                !Number.isSafeInteger(output.location) ||
                output.location < 0
            ) {
                throw new TypeError(`Fragment output ${String(index)} has an invalid location`);
            }
            if (
                target.colorFormats[output.location] === null ||
                target.colorFormats[output.location] === undefined
            ) {
                throw new TypeError(
                    `Fragment output location ${String(output.location)} has no mesh color target`
                );
            }
            for (let previous = 0; previous < index; previous += 1) {
                if (outputs[previous]?.location === output.location) {
                    throw new TypeError(
                        `Fragment output location ${String(output.location)} is declared more than once`
                    );
                }
            }
        }
    }

    private validateLighting(
        mesh: Mesh,
        material: Material,
        context: RenderGraphFrameContext
    ): void {
        if (material.lightType === 'NONE') return;
        const manager = context.lightManager;
        if (
            this.#validatedLightingFrame !== context.frameIndex ||
            this.#validatedLightManager !== manager
        ) {
            this.validateLightPacking(manager);
            this.#validatedLightingFrame = context.frameIndex;
            this.#validatedLightManager = manager;
            this.#hasShadowSamplerDependency =
                manager.shadowEnabled &&
                (manager.lightInfo.SHADOW_DIRECTIONAL_LIGHTS > 0 ||
                    manager.lightInfo.SHADOW_POINT_LIGHTS > 0 ||
                    manager.lightInfo.SHADOW_SPOT_LIGHTS > 0);
        }
        if (
            mesh.receiveShadows &&
            this.#hasShadowSamplerDependency &&
            manager.shadowAtlas === null
        ) {
            throw new TypeError(
                'Shadow-receiving lit materials require a prepared shared shadow atlas binding'
            );
        }
    }

    private validateLightPacking(manager: LightManager): void {
        const info = manager.lightInfo;
        if (!Number.isSafeInteger(info.AMBIENT_LIGHTS) || info.AMBIENT_LIGHTS < 0) {
            throw new RangeError('AMBIENT_LIGHTS count must be a non-negative safe integer');
        }
        if (info.AMBIENT_LIGHTS !== manager.ambientLights.length) {
            throw new RangeError(
                `AMBIENT_LIGHTS count ${String(info.AMBIENT_LIGHTS)} does not match the active LightManager list length ${String(manager.ambientLights.length)}`
            );
        }
        requireLightCount(
            info.DIRECTIONAL_LIGHTS,
            manager.directionalLights.length,
            MAX_DIRECTIONAL_LIGHTS,
            'DIRECTIONAL_LIGHTS'
        );
        requireLightCount(
            info.POINT_LIGHTS,
            manager.pointLights.length,
            MAX_POINT_LIGHTS,
            'POINT_LIGHTS'
        );
        requireLightCount(
            info.SPOT_LIGHTS,
            manager.spotLights.length,
            MAX_SPOT_LIGHTS,
            'SPOT_LIGHTS'
        );
        requireLightCount(
            info.AREA_LIGHTS,
            manager.areaLights.length,
            MAX_AREA_LIGHTS,
            'AREA_LIGHTS'
        );
        requirePackedLightArray(manager.ambientInfo, 3, 'LightBlock ambient color');

        const directional = manager.directionalInfo;
        if (!directional) throw new TypeError('LightManager directionalInfo is not prepared');
        requirePackedLightArray(
            directional.colors,
            info.DIRECTIONAL_LIGHTS * 3,
            'LightBlock directional colors'
        );
        requirePackedLightArray(
            directional.infos,
            info.DIRECTIONAL_LIGHTS * 3,
            'LightBlock directional directions'
        );

        const point = manager.pointInfo;
        if (!point) throw new TypeError('LightManager pointInfo is not prepared');
        requirePackedLightArray(point.colors, info.POINT_LIGHTS * 3, 'LightBlock point colors');
        requirePackedLightArray(point.infos, info.POINT_LIGHTS * 3, 'LightBlock point attenuation');
        requirePackedLightArray(point.poses, info.POINT_LIGHTS * 3, 'LightBlock point positions');
        requirePackedLightArray(point.ranges, info.POINT_LIGHTS, 'LightBlock point ranges');

        const spot = manager.spotInfo;
        if (!spot) throw new TypeError('LightManager spotInfo is not prepared');
        requirePackedLightArray(spot.colors, info.SPOT_LIGHTS * 3, 'LightBlock spot colors');
        requirePackedLightArray(spot.infos, info.SPOT_LIGHTS * 3, 'LightBlock spot attenuation');
        requirePackedLightArray(spot.poses, info.SPOT_LIGHTS * 3, 'LightBlock spot positions');
        requirePackedLightArray(spot.dirs, info.SPOT_LIGHTS * 3, 'LightBlock spot directions');
        requirePackedLightArray(spot.cutoffs, info.SPOT_LIGHTS * 2, 'LightBlock spot cutoffs');
        requirePackedLightArray(spot.ranges, info.SPOT_LIGHTS, 'LightBlock spot ranges');

        const area = manager.areaInfo;
        if (!area) throw new TypeError('LightManager areaInfo is not prepared');
        requirePackedLightArray(area.colors, info.AREA_LIGHTS * 3, 'LightBlock area colors');
        requirePackedLightArray(area.poses, info.AREA_LIGHTS * 3, 'LightBlock area positions');
        requirePackedLightArray(area.width, info.AREA_LIGHTS * 3, 'LightBlock area widths');
        requirePackedLightArray(area.height, info.AREA_LIGHTS * 3, 'LightBlock area heights');
        if (
            info.AREA_LIGHTS > 0 &&
            (!(area.ltcTexture1 instanceof Texture) || !(area.ltcTexture2 instanceof Texture))
        ) {
            throw new TypeError('Area lights require both LTC lookup textures');
        }
    }

    /** Validate deformation structure before shader/pipeline/resource preparation has side effects. */
    private validateDeformation(mesh: Mesh, geometry: Geometry): void {
        if (mesh.isSkinnedMesh) this.validateSkinning(mesh, geometry);
        if (geometry.isMorphGeometry) this.validateMorphTargets(mesh, geometry);
    }

    private validateSkinning(mesh: Mesh, geometry: Geometry): void {
        const jointCount = mesh.skinJointCount;
        if (!Number.isSafeInteger(jointCount) || jointCount < 1 || jointCount > 128) {
            throw new RangeError('SkinningBlock requires between 1 and 128 joints per mesh');
        }
        if (mesh.jointMatrices?.length !== jointCount * 16) {
            throw new RangeError('Render skin palette length does not match its joint count');
        }

        const indices = geometry.skinIndices;
        const weights = geometry.skinWeights;
        if (!(indices instanceof GeometryData) || !(weights instanceof GeometryData)) {
            throw new TypeError(
                'SkinnedMesh geometry requires both skinIndices and skinWeights GeometryData streams'
            );
        }
        const portableIndices =
            (indices.data instanceof Float32Array ||
                indices.data instanceof Uint8Array ||
                indices.data instanceof Uint8ClampedArray ||
                indices.data instanceof Uint16Array ||
                indices.data instanceof Uint32Array) &&
            !indices.normalized;
        if (!portableIndices || indices.size !== 4) {
            throw new TypeError(
                'Skinning joint indices require non-normalized Float32 or unsigned 8/16/32-bit x4 storage'
            );
        }
        const portableWeights =
            (weights.data instanceof Float32Array && !weights.normalized) ||
            ((weights.data instanceof Uint8Array ||
                weights.data instanceof Uint8ClampedArray ||
                weights.data instanceof Uint16Array) &&
                weights.normalized);
        if (!portableWeights || weights.size !== 4) {
            throw new TypeError(
                'Skinning weights require Float32x4 or normalized unsigned 8/16-bit x4 storage'
            );
        }
    }

    private validateMorphTargets(mesh: Mesh, geometry: Geometry): void {
        if (!(geometry instanceof MorphGeometry)) {
            throw new TypeError('Morph deformation requires a real MorphGeometry instance');
        }
        const targets = geometry.targets;
        if (!targets || typeof targets !== 'object') {
            throw new TypeError('MorphGeometry requires a non-empty targets record');
        }
        let targetKindCount = 0;
        let targetCount = -1;
        for (const name in targets) {
            if (!Object.hasOwn(targets, name)) continue;
            if (name !== 'vertices' && name !== 'normals' && name !== 'tangents') {
                throw new TypeError(`Morph target kind ${name} is not supported`);
            }
            const list = targets[name];
            if (!Array.isArray(list) || list.length === 0) {
                throw new TypeError(`Morph target kind ${name} requires a non-empty target list`);
            }
            if (targetCount < 0) targetCount = list.length;
            else if (targetCount !== list.length) {
                throw new RangeError(
                    'Every active morph target kind must use the same target count'
                );
            }
            targetKindCount++;
        }
        if (targetKindCount === 0 || targetCount < 1) {
            throw new TypeError('MorphGeometry requires at least one supported target kind');
        }
        const maximumTargetCount = Math.floor(8 / targetKindCount);
        if (targetCount > maximumTargetCount) {
            throw new RangeError(
                `${String(targetKindCount)} morph target kinds support at most ${String(maximumTargetCount)} targets in the fixed eight-attribute ABI`
            );
        }

        const weights = mesh.morphWeights ?? geometry.weights;
        if (!Array.isArray(weights) && !(weights instanceof Float32Array)) {
            throw new TypeError('MorphGeometry weights must be a number[] or Float32Array');
        }
        if (weights.length > targetCount || weights.length > 8) {
            throw new RangeError(
                'MorphGeometry cannot provide more weights than active target slots'
            );
        }
        for (let index = 0; index < weights.length; index += 1) {
            const weight = weights[index];
            if (typeof weight !== 'number' || !Number.isFinite(weight)) {
                throw new TypeError(`Morph weight ${String(index)} must be finite`);
            }
        }
        for (const name in targets) {
            if (!Object.hasOwn(targets, name)) continue;
            for (let slot = 0; slot < targetCount; slot += 1) {
                if (!(geometry.getMorphTarget(name, slot) instanceof GeometryData)) {
                    throw new TypeError(
                        `Morph target ${name}[${String(slot)}] must resolve to GeometryData`
                    );
                }
            }
        }
    }

    private prepareUniformBuffers(
        owner: object,
        mesh: Mesh,
        material: Material,
        pipeline: Readonly<MeshBindingPipelineRecord>,
        context: RenderGraphFrameContext,
        instanceBlock: UniformBuffer | null
    ): readonly ResourceRegistryHandle<RHIBuffer>[] {
        const semanticFrame = this.#passSemanticFrame ?? context.semantic;
        const blocks = pipeline.bindingPlan.uniformBlocks;
        let scratch = this.#uniformScratch.get(owner);
        if (scratch?.handles.length !== blocks.length) {
            scratch = { handles: new Array<ResourceRegistryHandle<RHIBuffer>>(blocks.length) };
            this.#uniformScratch.set(owner, scratch);
        }
        for (let index = 0; index < blocks.length; index += 1) {
            const block = blocks[index];
            if (block === undefined) continue;
            const uniform =
                block.name === 'InstanceBlock'
                    ? instanceBlock
                    : this.uniformBlocks.resolveUniformBlock(
                          block.name,
                          mesh,
                          material,
                          semanticFrame.camera,
                          semanticFrame
                      );
            if (uniform === null) {
                throw new Error('Instanced WebGPU shader requires a compiled InstanceBlock');
            }
            this.buffers.prepareUniformBuffer(uniform);
            scratch.handles[index] = this.buffers.getUniformBufferHandle(uniform);
        }
        return scratch.handles;
    }

    private prepareSampledResources(
        owner: object,
        mesh: Mesh,
        material: Material,
        pipeline: Readonly<MeshBindingPipelineRecord>
    ): readonly ShaderSampledBindingResources[] {
        const bindings = pipeline.bindingPlan.sampledBindings;
        if (bindings.length === 0) return EMPTY_SAMPLED_RESOURCES;
        let scratch = this.#sampledScratch.get(owner);
        if (scratch?.resources.length !== bindings.length) {
            scratch = {
                resources: new Array<MutableSampledBindingResources>(bindings.length),
                sources: new Array<Texture<unknown>>(bindings.length)
            };
            this.#sampledScratch.set(owner, scratch);
        }
        let resolvedName: string | null = null;
        let resolvedValue: unknown;
        try {
            for (let index = 0; index < bindings.length; index += 1) {
                const binding = bindings[index];
                if (binding === undefined) continue;
                if (binding.name !== resolvedName) {
                    resolvedName = binding.name;
                    this.#programBindingInfo.textureIndex = binding.arrayIndex;
                    this.#programBindingInfo.name = binding.name;
                    resolvedValue = material.getUniformData(
                        binding.name,
                        mesh,
                        this.#programBindingInfo
                    );
                }
                const source = sampledTextureElement(resolvedValue, binding.arrayIndex);
                if (!(source instanceof Texture)) {
                    throw new TypeError(
                        `Sampled binding ${binding.name}[${String(binding.arrayIndex)}] must resolve to a Texture`
                    );
                }
                const external = externalTextureBindingRegistry.resolve(
                    source,
                    binding.samplerKind
                );
                if (external === null) {
                    throw new TypeError(
                        `External texture for ${binding.name}[${String(binding.arrayIndex)}] rejects ${binding.samplerKind}`
                    );
                }
                if (external === undefined && binding.samplerKind === 'comparison-sampler') {
                    throw new TypeError(
                        `Comparison sampled binding ${binding.name}[${String(binding.arrayIndex)}] requires a registered external depth texture`
                    );
                }
                const local = external === undefined ? this.textures.prepare(source) : null;
                const textureView = external?.textureView ?? local?.view;
                const sampler = external?.sampler ?? local?.sampler;
                if (textureView === undefined || sampler === undefined) {
                    throw new Error(
                        `Sampled binding ${binding.name}[${String(binding.arrayIndex)}] lost its logical handles`
                    );
                }
                let resources = scratch.resources[index];
                if (resources === undefined) {
                    resources = {
                        textureView,
                        sampler
                    };
                    scratch.resources[index] = resources;
                } else {
                    resources.textureView = textureView;
                    resources.sampler = sampler;
                }
                scratch.sources[index] = source;
                if (external !== undefined) {
                    const dependency = externalTextureBindingRegistry.graphDependency(source);
                    if (
                        dependency !== undefined &&
                        !this.#sampledGraphDependencies.includes(dependency)
                    ) {
                        this.#sampledGraphDependencies.push(dependency);
                    }
                }
            }
        } finally {
            delete this.#programBindingInfo.textureIndex;
            delete this.#programBindingInfo.name;
        }
        return scratch.resources;
    }

    private numericDepthSamplerMask(
        mesh: Mesh,
        material: Material,
        compiled: Readonly<CompiledShaderArtifactPair>
    ): number {
        const samplers = compiled.metadata.samplers;
        if (samplers.length > 52) {
            throw new RangeError('Numeric depth specialization supports at most 52 samplers');
        }
        let mask = 0;
        let resolvedName: string | null = null;
        let resolvedValue: unknown;
        for (let index = 0; index < samplers.length; index += 1) {
            const sampler = samplers[index];
            if (sampler === undefined || sampler.type.endsWith('Shadow')) continue;
            if (sampler.name !== resolvedName) {
                resolvedName = sampler.name;
                resolvedValue = material.getUniformData(
                    sampler.name,
                    mesh,
                    this.#programBindingInfo
                );
            }
            const source = sampledTextureElement(resolvedValue, sampler.arrayIndex);
            if (!(source instanceof Texture)) continue;
            const external = externalTextureBindingRegistry.resolve(source, 'sampler');
            if (external === undefined || external === null) continue;
            const view = this.registry.resolve(external.textureView);
            if (rhiTextureFormatHasDepth(view.format)) mask += 2 ** index;
        }
        return mask;
    }

    private requireSampledScratchSources(
        owner: object,
        resources: readonly ShaderSampledBindingResources[]
    ): readonly Texture<unknown>[] {
        if (resources.length === 0) return EMPTY_TEXTURE_SOURCES;
        const scratch = this.#sampledScratch.get(owner);
        if (scratch?.resources !== resources) {
            throw new Error('Mesh draw processor lost its sampled-resource scratch state');
        }
        return scratch.sources;
    }

    private captureInstanceRevision(
        record: InstanceDrawRecord | undefined,
        baseRevision: PreparedDrawRevision,
        plan: Readonly<InstanceBatchPlan>
    ): PreparedDrawRevision {
        if (
            record?.baseRevision === baseRevision &&
            record.instanceCount === plan.instanceCount &&
            record.layoutRevision === plan.layoutRevision &&
            record.resourceRevision === plan.resourceRevision
        ) {
            return record.revision;
        }
        const revision = this.#nextInstanceRevision;
        if (!Number.isSafeInteger(revision)) {
            throw new RangeError('Instanced draw revision space is exhausted');
        }
        this.#nextInstanceRevision++;
        return Object.freeze({
            geometry: revision,
            materialVariant: revision,
            renderState: revision,
            resourceBindings: revision,
            target: revision,
            deviceGeneration: baseRevision.deviceGeneration
        });
    }

    private commitInstanceRecord(
        owner: object,
        record: InstanceDrawRecord | undefined,
        meshes: readonly Mesh[],
        geometry: Geometry,
        material: Material,
        perVertexLayouts: readonly Readonly<RHIVertexBufferLayout>[],
        instanceLayout: Readonly<RHIVertexBufferLayout> | null,
        combinedLayouts: readonly Readonly<RHIVertexBufferLayout>[],
        baseRevision: PreparedDrawRevision,
        plan: Readonly<InstanceBatchPlan>,
        revision: PreparedDrawRevision,
        instanceSource: GeometryData | null,
        instanceBlock: UniformBuffer | null
    ): void {
        if (record === undefined) {
            record = {
                geometry,
                material,
                meshes: [],
                perVertexLayouts,
                instanceLayout,
                combinedLayouts,
                baseRevision,
                instanceCount: plan.instanceCount,
                layoutRevision: plan.layoutRevision,
                resourceRevision: plan.resourceRevision,
                revision,
                instanceSources: new Set<GeometryData>(),
                instanceBlocks: new Set<UniformBuffer>()
            };
            this.#instanceRecords.set(owner, record);
        }
        for (const previous of record.meshes) {
            if (meshes.includes(previous)) continue;
            const owners = this.#instanceOwnersByMesh.get(previous);
            owners?.delete(owner);
            if (owners?.size === 0) this.#instanceOwnersByMesh.delete(previous);
        }
        for (const mesh of meshes) {
            let owners = this.#instanceOwnersByMesh.get(mesh);
            if (owners === undefined) {
                owners = new Set<object>();
                this.#instanceOwnersByMesh.set(mesh, owners);
            }
            owners.add(owner);
        }
        record.meshes.length = 0;
        for (const mesh of meshes) record.meshes.push(mesh);
        record.geometry = geometry;
        record.material = material;
        record.perVertexLayouts = perVertexLayouts;
        record.instanceLayout = instanceLayout;
        record.combinedLayouts = combinedLayouts;
        record.baseRevision = baseRevision;
        record.instanceCount = plan.instanceCount;
        record.layoutRevision = plan.layoutRevision;
        record.resourceRevision = plan.resourceRevision;
        record.revision = revision;
        if (instanceSource !== null) record.instanceSources.add(instanceSource);
        if (instanceBlock !== null) record.instanceBlocks.add(instanceBlock);
    }

    private trackGeometrySources(
        geometry: Geometry,
        streams: readonly {
            readonly source: GeometryData;
            readonly sources?: readonly GeometryData[];
        }[]
    ): void {
        let sources = this.#vertexSourcesByGeometry.get(geometry);
        if (sources === undefined) {
            sources = new Set<GeometryData>();
            this.#vertexSourcesByGeometry.set(geometry, sources);
        }
        for (const stream of streams) {
            const aliases = stream.sources ?? [stream.source];
            for (const source of aliases) sources.add(source);
        }
    }

    private trackGeometrySource(geometry: Geometry, source: GeometryData): void {
        let sources = this.#vertexSourcesByGeometry.get(geometry);
        if (sources === undefined) {
            sources = new Set<GeometryData>();
            this.#vertexSourcesByGeometry.set(geometry, sources);
        }
        sources.add(source);
    }

    private trackShadowDraw(
        owner: object,
        mesh: Mesh,
        sourceMaterial: Material,
        material: Material,
        sources: readonly Texture<unknown>[]
    ): void {
        let record = this.#shadowRecords.get(owner);
        const previousSources = record?.sources;
        let sameSources = previousSources?.length === sources.length;
        if (sameSources) {
            for (let index = 0; index < sources.length; index += 1) {
                if (previousSources?.[index] !== sources[index]) {
                    sameSources = false;
                    break;
                }
            }
        }
        if (!sameSources) {
            for (let index = 0; index < sources.length; index += 1) {
                const source = sources[index];
                if (source === undefined || sources.indexOf(source) !== index) continue;
                let additions = 0;
                for (const candidate of sources) if (candidate === source) additions++;
                const count = this.#textureReferenceCounts.get(source) ?? 0;
                if (count > Number.MAX_SAFE_INTEGER - additions) {
                    throw new RangeError('Shadow texture reference count is exhausted');
                }
            }
            for (const source of sources) {
                this.#textureReferenceCounts.set(
                    source,
                    (this.#textureReferenceCounts.get(source) ?? 0) + 1
                );
            }
            if (previousSources !== undefined) {
                for (const source of previousSources) this.releaseTextureReference(source);
            }
        }
        const snapshot = sameSources
            ? (previousSources ?? EMPTY_TEXTURE_SOURCES)
            : Object.freeze([...sources]);
        if (record === undefined) {
            record = { mesh, sourceMaterial, material, sources: snapshot };
            this.#shadowRecords.set(owner, record);
            let owners = this.#shadowOwnersByMesh.get(mesh);
            if (owners === undefined) {
                owners = new Set<object>();
                this.#shadowOwnersByMesh.set(mesh, owners);
            }
            owners.add(owner);
        } else {
            record.sourceMaterial = sourceMaterial;
            record.material = material;
            record.sources = snapshot;
        }
    }

    private trackMeshTextures(mesh: Mesh, sources: readonly Texture<unknown>[]): void {
        const previous = this.#sampledSourcesByMesh.get(mesh);
        if (previous === undefined && sources.length === 0) return;
        if (previous?.length === sources.length) {
            let matches = true;
            for (let index = 0; index < sources.length; index += 1) {
                if (previous[index] !== sources[index]) {
                    matches = false;
                    break;
                }
            }
            if (matches) return;
        }

        for (let index = 0; index < sources.length; index += 1) {
            const source = sources[index];
            if (source === undefined || sources.indexOf(source) !== index) continue;
            const count = this.#textureReferenceCounts.get(source) ?? 0;
            let additions = 0;
            for (const candidate of sources) {
                if (candidate === source) additions++;
            }
            if (count > Number.MAX_SAFE_INTEGER - additions) {
                throw new RangeError('Mesh texture reference count is exhausted');
            }
        }
        for (const source of sources) {
            this.#textureReferenceCounts.set(
                source,
                (this.#textureReferenceCounts.get(source) ?? 0) + 1
            );
        }
        if (previous !== undefined) {
            for (const source of previous) this.releaseTextureReference(source);
        }
        if (sources.length === 0) {
            this.#sampledSourcesByMesh.delete(mesh);
        } else {
            this.#sampledSourcesByMesh.set(mesh, Object.freeze([...sources]));
        }
    }

    private releaseMeshTextures(mesh: Mesh): number {
        const sources = this.#sampledSourcesByMesh.get(mesh);
        if (sources === undefined) return 0;
        this.#sampledSourcesByMesh.delete(mesh);
        let released = 0;
        for (const source of sources) released += this.releaseTextureReference(source);
        return released;
    }

    private releaseTextureReference(source: Texture<unknown>): number {
        const count = this.#textureReferenceCounts.get(source);
        if (count === undefined) return 0;
        if (count > 1) {
            this.#textureReferenceCounts.set(source, count - 1);
            return 0;
        }
        this.#textureReferenceCounts.delete(source);
        return this.textures.detach(source) ? 1 : 0;
    }

    private requireResourceContext(): RenderGraphFrameContext {
        const context = this.#context;
        if (!context || !this.active) {
            throw new Error('Mesh draw processor requires beginFrame before preparation');
        }
        return context;
    }

    private requireSemanticContext(): RenderGraphFrameContext {
        const context = this.requireResourceContext();
        if (this.#passSemanticFrame === null) {
            throw new Error('Mesh draw processor requires scene semantics before preparation');
        }
        return context;
    }

    private trackMeshShader(mesh: Mesh, shader: Shader): void {
        const previous = this.#shaderByMesh.get(mesh);
        if (previous === shader) return;
        if (previous !== undefined) this.releaseShaderReference(previous);
        const count = this.#shaderReferenceCounts.get(shader) ?? 0;
        if (count === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Mesh shader reference count is exhausted');
        }
        this.#shaderReferenceCounts.set(shader, count + 1);
        this.#shaderByMesh.set(mesh, shader);
    }

    private releaseMeshShader(mesh: Mesh): void {
        const shader = this.#shaderByMesh.get(mesh);
        if (shader === undefined) return;
        this.#shaderByMesh.delete(mesh);
        this.releaseShaderReference(shader);
    }

    private trackShadowShader(owner: object, shader: Shader): void {
        const previous = this.#shaderByShadowOwner.get(owner);
        if (previous === shader) return;
        if (previous !== undefined) this.releaseShaderReference(previous);
        const count = this.#shaderReferenceCounts.get(shader) ?? 0;
        if (count === Number.MAX_SAFE_INTEGER) {
            throw new RangeError('Shadow shader reference count is exhausted');
        }
        this.#shaderReferenceCounts.set(shader, count + 1);
        this.#shaderByShadowOwner.set(owner, shader);
    }

    private releaseShadowShader(owner: object): void {
        const shader = this.#shaderByShadowOwner.get(owner);
        if (shader === undefined) return;
        this.#shaderByShadowOwner.delete(owner);
        this.releaseShaderReference(shader);
    }

    private releaseShaderReference(shader: Shader): void {
        const count = this.#shaderReferenceCounts.get(shader);
        if (count === undefined) return;
        if (count > 1) {
            this.#shaderReferenceCounts.set(shader, count - 1);
            return;
        }
        this.#shaderReferenceCounts.delete(shader);
        this.pipelines.detachShader(shader);
        this.shaders.detach(shader);
    }

    private releaseInstanceBatch(owner: object): number {
        const record = this.#instanceRecords.get(owner);
        if (record === undefined) {
            this.instances.detach(owner);
            return 0;
        }
        let released = 0;
        if (this.bindGroups.detach(owner)) released++;
        this.#instanceDraws.delete(owner);
        this.#uniformScratch.delete(owner);
        this.#sampledScratch.delete(owner);
        for (const source of record.instanceSources) {
            released += this.buffers.detachGeometryData(source);
        }
        for (const block of record.instanceBlocks) {
            if (this.buffers.detachUniformBuffer(block)) released++;
        }
        for (const mesh of record.meshes) {
            const owners = this.#instanceOwnersByMesh.get(mesh);
            owners?.delete(owner);
            if (owners?.size === 0) this.#instanceOwnersByMesh.delete(mesh);
            this.#revisions.delete(mesh);
        }
        this.#instanceRecords.delete(owner);
        this.instances.detach(owner);
        return released;
    }

    private releaseShadowOwner(owner: object): number {
        const record = this.#shadowRecords.get(owner);
        if (record === undefined) return 0;
        let released = 0;
        if (this.bindGroups.detach(owner)) released++;
        this.#shadowDraws.delete(owner);
        this.#uniformScratch.delete(owner);
        this.#sampledScratch.delete(owner);
        this.#revisions.delete(owner);
        this.releaseShadowShader(owner);
        for (const source of record.sources) released += this.releaseTextureReference(source);
        const owners = this.#shadowOwnersByMesh.get(record.mesh);
        owners?.delete(owner);
        if (owners?.size === 0) this.#shadowOwnersByMesh.delete(record.mesh);
        this.#shadowRecords.delete(owner);
        return released;
    }

    private assertIdle(): void {
        this.assertAlive();
        if (this.active) throw new Error('Mesh resource detach is not allowed during a frame');
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Mesh draw processor is destroyed');
    }
}
