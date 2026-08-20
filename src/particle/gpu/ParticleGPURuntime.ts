import type Camera from '../../camera/Camera';
import type { ParticleBudgetDecision } from '../ParticleBudget';
import type { EventListener } from '../../core/EventDispatcher';
import type Node from '../../core/Node';
import DirectionalLight from '../../light/DirectionalLight';
import Light from '../../light/Light';
import {
    DEFAULT_MATERIAL_PIPELINE_STATE,
    type MaterialPipelineState
} from '../../material/MaterialDefinition';
import { MaterialBlendPreset } from '../../material/MaterialCompiler';
import ComputeKernel from '../../render/compute/ComputeKernel';
import ComputeSampler from '../../render/compute/ComputeSampler';
import type ComputeShader from '../../render/compute/ComputeShader';
import type { RendererContract } from '../../render/RendererCore';
import type { StorageBuffer } from '../../render/StorageBuffer';
import UniformBuffer from '../../render/UniformBuffer';
import { RenderPassParameterPool } from '../../render/pipeline/RenderPassParameterPool';
import type {
    RenderGraphBufferHandle,
    RenderGraphTextureHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment
} from '../../render/pipeline/ScriptableRenderGraph';
import type { RenderPipelineContext } from '../../render/pipeline/RenderPipeline';
import {
    ComputeRenderPass,
    type ComputeBufferBinding,
    type ComputeRenderPassParameters,
    type ComputeTextureBinding
} from '../../render/pipeline/passes/ComputeRenderPass';
import {
    GPUDrivenRenderPass,
    type GPUDrivenRenderPassParameters
} from '../../render/pipeline/passes/GPUDrivenRenderPass';
import { createStd140Layout } from '../../render/ubo/Std140Layout';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import { compileParticleGPUPlan, type ParticleGPUCompiledPlan } from './ParticleGPUPlan';
import {
    compileParticleGPUSubEmitterRoute,
    type ParticleGPUSubEmitterRoutePlan
} from './ParticleGPUEventPlan';
import type { ParticleGPUSpawnController } from './ParticleGPUSpawnController';
import type { ParticleSubEmitterModule } from '../ParticleTypes';
import { ParticleGPUTransaction } from './ParticleGPUTransaction';
import type {
    ParticleGPUMeshRendererPlan,
    ParticleGPURibbonRendererPlan
} from './ParticleGPUAdvancedPlan';

const EMPTY_SAMPLERS: readonly never[] = Object.freeze([]);
const PARTICLE_PARAMETER_LAYOUT = createStd140Layout({
    timeDelta: 'vec4',
    emitterPosition: 'vec4',
    emitterVelocity: 'vec4',
    spawn: 'uvec4',
    cameraPosition: 'vec4',
    sort: 'uvec4',
    viewProjection: 'mat4'
});
/** @internal Shared storage-particle view ABI. */
export const PARTICLE_VIEW_LAYOUT = createStd140Layout({
    u_viewMatrix: 'mat4',
    u_projectionMatrix: 'mat4',
    u_modelMatrix: 'mat4',
    u_cameraPosition: 'vec4',
    u_viewport: 'vec4',
    u_particleAmbient: 'vec4',
    u_particleDirectionalColor: { type: 'vec4', arrayLength: 4 },
    u_particleDirectionalDirection: { type: 'vec4', arrayLength: 4 }
});
const PARTICLE_RIBBON_SORT_LAYOUT = createStd140Layout({
    size: 'uint',
    stride: 'uint',
    capacity: 'uint',
    padding: 'uint'
});

class MutableBufferBinding implements ComputeBufferBinding {
    buffer = 0 as RenderGraphBufferHandle;
}

class MutableTextureBinding implements ComputeTextureBinding {
    texture = 0 as RenderGraphTextureHandle;
}

/** @internal Shared compute-pass bindings for particle graph runtimes. */
export class ParticleComputeParameters implements ComputeRenderPassParameters {
    readonly uniformBuffers: readonly UniformBuffer[];
    readonly buffers: MutableBufferBinding[];
    readonly textures: MutableTextureBinding[];
    readonly samplers: readonly ComputeSampler[];
    readonly dispatch: { x: number };

    constructor(
        bufferCount: number,
        uniform: UniformBuffer | null,
        dispatchX: number,
        textureCount = 0,
        samplers: readonly ComputeSampler[] = EMPTY_SAMPLERS
    ) {
        this.uniformBuffers = uniform === null ? Object.freeze([]) : Object.freeze([uniform]);
        this.buffers = Array.from({ length: bufferCount }, () => new MutableBufferBinding());
        this.textures = Array.from({ length: textureCount }, () => new MutableTextureBinding());
        this.samplers = samplers;
        this.dispatch = { x: dispatchX };
    }

    configure(handles: readonly RenderGraphBufferHandle[]): void {
        if (handles.length !== this.buffers.length) {
            throw new RangeError('Particle compute buffer ABI changed after compilation');
        }
        for (let index = 0; index < handles.length; index += 1) {
            const binding = this.buffers[index];
            const handle = handles[index];
            if (binding === undefined || handle === undefined) {
                throw new Error('Particle compute buffer binding is unavailable');
            }
            binding.buffer = handle;
        }
    }

    configureTextures(handles: readonly RenderGraphTextureHandle[]): void {
        if (handles.length !== this.textures.length) {
            throw new RangeError('Particle compute texture ABI changed after compilation');
        }
        for (let index = 0; index < handles.length; index += 1) {
            const binding = this.textures[index];
            const handle = handles[index];
            if (!binding || handle === undefined) {
                throw new Error('Particle compute texture binding is unavailable');
            }
            binding.texture = handle;
        }
    }
}

class MutableColorAttachment implements RenderPipelineColorAttachment {
    texture = 0 as RenderGraphTextureHandle;
    readonly loadOp = 'load';
    readonly storeOp = 'store';
}

class MutableDepthAttachment implements RenderPipelineDepthStencilAttachment {
    texture = 0 as RenderGraphTextureHandle;
    readonly depthLoadOp?: 'load';
    readonly depthStoreOp?: 'store';

    constructor(readonly depthReadOnly: boolean) {
        if (!depthReadOnly) {
            this.depthLoadOp = 'load';
            this.depthStoreOp = 'store';
        }
    }
}

class MutableIndirectDraw {
    readonly kind = 'draw-indirect';
    buffer = 0 as RenderGraphBufferHandle;
    byteOffset = 0;
}

/** @internal Shared indirect storage-raster bindings for particle graph runtimes. */
export class ParticleDrawParameters implements GPUDrivenRenderPassParameters {
    readonly uniformBuffers: readonly UniformBuffer[];
    readonly buffers: MutableBufferBinding[];
    readonly textures: { texture: RenderGraphTextureHandle }[] = [];
    readonly samplers: readonly ComputeSampler[];
    readonly samplesDepth: boolean;
    readonly draw = new MutableIndirectDraw();
    readonly colorAttachments = [new MutableColorAttachment()];
    readonly depthStencilAttachment?: MutableDepthAttachment;
    readonly viewport: [number, number, number, number] = [0, 0, 1, 1];
    readonly scissor: [number, number, number, number] = [0, 0, 1, 1];

    constructor(
        readonly viewUniform: UniformBuffer,
        spriteSampler: ComputeSampler | null,
        depthSampler: ComputeSampler | null,
        depthReadOnly: boolean,
        bufferCount = 1
    ) {
        this.uniformBuffers = Object.freeze([viewUniform]);
        this.buffers = Array.from({ length: bufferCount }, () => new MutableBufferBinding());
        this.samplers = Object.freeze([
            ...(spriteSampler === null ? [] : [spriteSampler]),
            ...(depthSampler === null ? [] : [depthSampler])
        ]);
        this.samplesDepth = depthSampler !== null;
        if (!this.samplesDepth) {
            this.depthStencilAttachment = new MutableDepthAttachment(depthReadOnly);
        }
        if (spriteSampler !== null) this.textures.push({ texture: 0 as RenderGraphTextureHandle });
        if (this.samplesDepth) this.textures.push({ texture: 0 as RenderGraphTextureHandle });
    }

    configure(
        buffers: readonly RenderGraphBufferHandle[],
        indirect: RenderGraphBufferHandle,
        indirectByteOffset: number,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        texture: RenderGraphTextureHandle | null,
        context: RenderPipelineContext
    ): void {
        const colorAttachment = this.colorAttachments[0];
        if (!colorAttachment || buffers.length !== this.buffers.length) {
            throw new Error('Particle draw parameter storage is unavailable');
        }
        for (let index = 0; index < buffers.length; index += 1) {
            const binding = this.buffers[index];
            const buffer = buffers[index];
            if (!binding || buffer === undefined) {
                throw new Error('Particle draw buffer binding is unavailable');
            }
            binding.buffer = buffer;
        }
        this.draw.buffer = indirect;
        this.draw.byteOffset = indirectByteOffset;
        colorAttachment.texture = color;
        if (depth !== null && this.depthStencilAttachment !== undefined) {
            this.depthStencilAttachment.texture = depth;
        }
        let textureIndex = 0;
        if (texture !== null) {
            const textureBinding = this.textures[textureIndex];
            if (textureBinding === undefined) {
                throw new Error('Particle sprite texture binding is unavailable');
            }
            textureBinding.texture = texture;
            textureIndex++;
        }
        if (this.samplesDepth) {
            const depthBinding = this.textures[textureIndex];
            if (depthBinding === undefined || depth === null) {
                throw new Error('Soft particles require a Forward depth attachment');
            }
            depthBinding.texture = depth;
        }
        const viewport = context.viewport;
        this.viewport[0] = viewport[0];
        this.viewport[1] = viewport[1];
        this.viewport[2] = viewport[2];
        this.viewport[3] = viewport[3];
        this.scissor[0] = viewport[0];
        this.scissor[1] = viewport[1];
        this.scissor[2] = viewport[2];
        this.scissor[3] = viewport[3];
    }
}

interface ParticleGPUBufferSet {
    readonly state: readonly [StorageBuffer, StorageBuffer];
    readonly alive: readonly [StorageBuffer, StorageBuffer];
    readonly dead: StorageBuffer;
    readonly counters: StorageBuffer;
    readonly spawnCommands: StorageBuffer;
    readonly events: StorageBuffer;
    readonly eventCounters: StorageBuffer;
    readonly rendererData: StorageBuffer;
    readonly indirect: StorageBuffer;
}

interface ParticleGPUImportedBuffers {
    readonly state: readonly [RenderGraphBufferHandle, RenderGraphBufferHandle];
    readonly alive: readonly [RenderGraphBufferHandle, RenderGraphBufferHandle];
    readonly dead: RenderGraphBufferHandle;
    readonly counters: RenderGraphBufferHandle;
    readonly spawnCommands: RenderGraphBufferHandle;
    readonly events: RenderGraphBufferHandle;
    readonly eventCounters: RenderGraphBufferHandle;
    readonly rendererData: RenderGraphBufferHandle;
    readonly indirect: RenderGraphBufferHandle;
}

interface ParticleRendererPasses {
    readonly standard: GPUDrivenRenderPass;
    readonly reversed: GPUDrivenRenderPass;
    readonly parameters: RenderPassParameterPool<ParticleDrawParameters>;
}

interface ParticleEventRouteRuntime {
    readonly plan: Readonly<ParticleGPUSubEmitterRoutePlan>;
    readonly pass: ComputeRenderPass;
    readonly parameters: RenderPassParameterPool<ParticleComputeParameters>;
    frameIndex: number;
}

interface ParticleGPUMeshRuntime {
    readonly kind: 'mesh';
    readonly plan: Readonly<ParticleGPUMeshRendererPlan>;
    readonly bucketIndices: StorageBuffer;
    readonly bucketCounters: StorageBuffer;
    readonly indirect: StorageBuffer;
    readonly geometry: readonly StorageBuffer[];
    readonly reset: ComputeRenderPass;
    readonly build: ComputeRenderPass;
    readonly finalize: ComputeRenderPass;
    readonly resetParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly buildParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly finalizeParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly draws: readonly Readonly<{
        standard: GPUDrivenRenderPass;
        reversed: GPUDrivenRenderPass;
        parameters: RenderPassParameterPool<ParticleDrawParameters>;
    }>[];
}

interface ParticleGPURibbonRuntime {
    readonly kind: 'ribbon';
    readonly plan: Readonly<ParticleGPURibbonRendererPlan>;
    readonly topology: StorageBuffer;
    readonly segments: StorageBuffer;
    readonly counter: StorageBuffer;
    readonly indirect: StorageBuffer;
    readonly reset: ComputeRenderPass;
    readonly initializeTopology: ComputeRenderPass;
    readonly sortTopology: ComputeRenderPass;
    readonly buildSegments: ComputeRenderPass;
    readonly finalize: ComputeRenderPass;
    readonly resetParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly initializeParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly sortParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly buildParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly finalizeParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly standard: GPUDrivenRenderPass;
    readonly reversed: GPUDrivenRenderPass;
    readonly drawParameters: RenderPassParameterPool<ParticleDrawParameters>;
}

type ParticleGPUAdvancedRuntime = ParticleGPUMeshRuntime | ParticleGPURibbonRuntime;

function blendState(
    blend: ParticleGPUCompiledPlan['renderers'][number]['definition']['blend']
): NonNullable<MaterialPipelineState['blend']> {
    switch (blend ?? 'alpha') {
        case 'alpha':
            return MaterialBlendPreset.STRAIGHT_ALPHA;
        case 'premultiplied-alpha':
            return MaterialBlendPreset.PREMULTIPLIED_ALPHA;
        case 'additive':
            return MaterialBlendPreset.PREMULTIPLIED_ADDITIVE;
    }
}

function advancedBlendState(
    definition:
        ParticleGPUMeshRendererPlan['definition'] | ParticleGPURibbonRendererPlan['definition']
): NonNullable<MaterialPipelineState['blend']> | undefined {
    if ((definition.coverage ?? 'transparent') !== 'transparent') return undefined;
    return blendState(definition.blend);
}

/** @internal Shared sprite pipeline state for GPU particle renderers. */
export function drawPipelineState(
    renderer: ParticleGPUCompiledPlan['renderers'][number]['definition'],
    reversed: boolean
): Readonly<MaterialPipelineState> {
    return Object.freeze({
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        cullMode: 'none',
        depthTest: renderer.softParticle === undefined ? (renderer.depthTest ?? true) : false,
        depthWrite: renderer.depthWrite ?? false,
        depthCompare: reversed ? 'greater-equal' : 'less-equal',
        blend: blendState(renderer.blend)
    });
}

function advancedDrawPipelineState(
    definition:
        ParticleGPUMeshRendererPlan['definition'] | ParticleGPURibbonRendererPlan['definition'],
    reversed: boolean
): Readonly<MaterialPipelineState> {
    const transparent = (definition.coverage ?? 'transparent') === 'transparent';
    const soft =
        definition.type === 'ribbon' || definition.type === 'trail'
            ? definition.softParticle
            : undefined;
    const blend = advancedBlendState(definition);
    return Object.freeze({
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        cullMode: definition.type === 'mesh' ? 'back' : 'none',
        depthTest: soft === undefined ? (definition.depthTest ?? true) : false,
        depthWrite: definition.depthWrite ?? !transparent,
        depthCompare: reversed ? 'greater-equal' : 'less-equal',
        ...(blend === undefined ? {} : { blend })
    });
}

function createBufferSet(
    renderer: RendererContract,
    plan: Readonly<ParticleGPUCompiledPlan>
): ParticleGPUBufferSet {
    const prefix = plan.emitter.definition.name;
    const create = (
        suffix: string,
        byteLength: number,
        usage: Parameters<RendererContract['createStorageBuffer']>[0]['usage'],
        recovery: 'cpu-shadow' | 'reinitialize' = 'reinitialize'
    ): StorageBuffer =>
        renderer.createStorageBuffer({
            label: `${prefix}:particle-${suffix}`,
            byteLength,
            usage,
            recovery
        });
    const state: readonly [StorageBuffer, StorageBuffer] = Object.freeze([
        create('state-a', plan.buffers.stateByteLength, ['storage']),
        create('state-b', plan.buffers.stateByteLength, ['storage'])
    ]);
    const alive: readonly [StorageBuffer, StorageBuffer] = Object.freeze([
        create('alive-a', plan.buffers.aliveIndexByteLength, ['storage']),
        create('alive-b', plan.buffers.aliveIndexByteLength, ['storage'])
    ]);
    return Object.freeze({
        state,
        alive,
        dead: create('dead', plan.buffers.deadIndexByteLength, ['storage']),
        counters: create('counters', plan.buffers.counterByteLength, ['storage']),
        spawnCommands: create(
            'spawn-commands',
            plan.buffers.spawnCommandByteLength,
            ['storage', 'copy-destination'],
            'cpu-shadow'
        ),
        events: create('events', plan.buffers.eventByteLength, ['storage']),
        eventCounters: create('event-counters', plan.buffers.eventCounterByteLength, ['storage']),
        rendererData: create('renderer-data', plan.buffers.rendererDataByteLength, ['storage']),
        indirect: create('indirect', plan.buffers.indirectArgumentByteLength, [
            'storage',
            'indirect'
        ])
    });
}

function importBuffers(
    context: RenderPipelineContext,
    buffers: Readonly<ParticleGPUBufferSet>
): ParticleGPUImportedBuffers {
    const graph = context.graph;
    return {
        state: [
            graph.importStorageBuffer(buffers.state[0]),
            graph.importStorageBuffer(buffers.state[1])
        ],
        alive: [
            graph.importStorageBuffer(buffers.alive[0]),
            graph.importStorageBuffer(buffers.alive[1])
        ],
        dead: graph.importStorageBuffer(buffers.dead),
        counters: graph.importStorageBuffer(buffers.counters),
        spawnCommands: graph.importStorageBuffer(buffers.spawnCommands),
        events: graph.importStorageBuffer(buffers.events),
        eventCounters: graph.importStorageBuffer(buffers.eventCounters),
        rendererData: graph.importStorageBuffer(buffers.rendererData),
        indirect: graph.importStorageBuffer(buffers.indirect)
    };
}

function cameraPosition(camera: Camera, target: Float32Array): void {
    const elements = camera.worldMatrix.elements;
    target[0] = elements[12];
    target[1] = elements[13];
    target[2] = elements[14];
    target[3] = 1;
}

/** Renderer-owned stateful WebGPU runtime for one compiled emitter. @internal */
export class ParticleGPUEmitterRuntime {
    readonly compiled: Readonly<ParticleGPUCompiledPlan>;
    readonly controller: ParticleGPUSpawnController;
    readonly transaction: ParticleGPUTransaction;
    readonly #renderer: RendererContract;
    readonly #buffers: ParticleGPUBufferSet;
    readonly #parameterValues = {
        timeDelta: new Float32Array(4),
        emitterPosition: new Float32Array(4),
        emitterVelocity: new Float32Array(4),
        spawn: new Uint32Array(4),
        cameraPosition: new Float32Array(4),
        sort: new Uint32Array(4),
        viewProjection: new Float32Array(16)
    };
    readonly #viewCameraPosition = new Float32Array(4);
    readonly #viewViewport = new Float32Array(4);
    readonly #viewAmbient = new Float32Array(4);
    readonly #viewDirectionalColors = new Float32Array(16);
    readonly #viewDirectionalDirections = new Float32Array(16);
    readonly #recoveryPass: ComputeRenderPass;
    readonly #resetPass: ComputeRenderPass;
    readonly #simulatePass: ComputeRenderPass;
    readonly #initializePass: ComputeRenderPass;
    readonly #finalizePass: ComputeRenderPass;
    readonly #buildRendererPass: ComputeRenderPass;
    readonly #sortPass: ComputeRenderPass | null;
    readonly #recoveryParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #resetParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #simulateParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #initializeParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #finalizeParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #buildParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #sortParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #rendererPasses: readonly ParticleRendererPasses[];
    readonly #advancedRuntimes: readonly ParticleGPUAdvancedRuntime[];
    readonly #eventRoutes = new Map<
        Readonly<ParticleSubEmitterModule>,
        ParticleEventRouteRuntime
    >();
    readonly #restoredListener: EventListener;
    #simulationFrame = -1;
    #recoveryFrame = -1;
    #budgetEnabled = true;
    #budgetSorting = true;
    #budgetSoftParticles = true;
    #budgetCollision = true;
    #budgetRibbons = true;
    #recoveryPending = true;
    #destroyed = false;

    constructor(
        plan: Readonly<ParticleCompiledEmitterPlan>,
        seed: number,
        definitionHash: string,
        renderer: RendererContract,
        controller: ParticleGPUSpawnController
    ) {
        if (renderer.backend !== 'webgpu') {
            throw new TypeError('GPU ParticleSystem execution requires a WebGPU Renderer');
        }
        this.compiled = compileParticleGPUPlan(plan);
        this.controller = controller;
        this.transaction = new ParticleGPUTransaction(seed, definitionHash);
        this.#renderer = renderer;
        this.#buffers = createBufferSet(renderer, this.compiled);
        const pass = (shader: ComputeShader | null, label: string): ComputeRenderPass => {
            if (shader === null) throw new Error(`Particle compute shader ${label} is unavailable`);
            return new ComputeRenderPass(new ComputeKernel({ shader, label }), label);
        };
        this.#recoveryPass = pass(
            this.compiled.shaders.recovery,
            `${plan.definition.name}:recovery`
        );
        this.#resetPass = pass(
            this.compiled.shaders.resetCounters,
            `${plan.definition.name}:compact-reset`
        );
        this.#simulatePass = pass(
            this.compiled.shaders.simulate,
            `${plan.definition.name}:simulate`
        );
        this.#initializePass = pass(
            this.compiled.shaders.initialize,
            `${plan.definition.name}:spawn-initialize`
        );
        this.#finalizePass = pass(
            this.compiled.shaders.finalize,
            `${plan.definition.name}:indirect-finalize`
        );
        this.#buildRendererPass = pass(
            this.compiled.shaders.buildRenderer,
            `${plan.definition.name}:renderer-build`
        );
        this.#sortPass =
            this.compiled.shaders.sort === null
                ? null
                : pass(this.compiled.shaders.sort, `${plan.definition.name}:distance-sort`);
        const parameterUniform = (): UniformBuffer =>
            UniformBuffer.fromSchema(PARTICLE_PARAMETER_LAYOUT, this.#parameterValues);
        const computePool = (
            bufferCount: number,
            hasUniform: boolean,
            dispatchX: number,
            textureCount = 0,
            samplers: readonly ComputeSampler[] = EMPTY_SAMPLERS
        ): RenderPassParameterPool<ParticleComputeParameters> =>
            new RenderPassParameterPool(
                () =>
                    new ParticleComputeParameters(
                        bufferCount,
                        hasUniform ? parameterUniform() : null,
                        dispatchX,
                        textureCount,
                        samplers
                    )
            );
        const vectorFieldCount = plan.definition.modules.filter(
            module => module.type === 'vector-field'
        ).length;
        const samplesSceneDepth = plan.definition.modules.some(
            module => module.type === 'scene-depth-collision'
        );
        const vectorFieldSampler = new ComputeSampler({
            label: `${plan.definition.name}:vector-field-sampler`,
            addressModeU: 'repeat',
            addressModeV: 'repeat',
            magFilter: 'linear',
            minFilter: 'linear'
        });
        const vectorFieldSamplers = Object.freeze(
            Array.from({ length: vectorFieldCount }, () => vectorFieldSampler)
        );
        this.#recoveryParameters = computePool(7, false, this.compiled.workgroupCount);
        this.#resetParameters = computePool(2, false, 1);
        this.#simulateParameters = computePool(
            8,
            true,
            this.compiled.workgroupCount,
            vectorFieldCount + (samplesSceneDepth ? 1 : 0),
            vectorFieldSamplers
        );
        this.#initializeParameters = computePool(7, true, 1);
        this.#finalizeParameters = computePool(2, true, 1);
        this.#buildParameters = computePool(4, false, this.compiled.workgroupCount);
        this.#sortParameters = computePool(
            3,
            true,
            this.compiled.sortStrategy === 'radix-buckets' ? 1 : this.compiled.workgroupCount
        );
        const sampler = new ComputeSampler({
            label: `${plan.definition.name}:particle-sampler`,
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear'
        });
        const depthSampler = new ComputeSampler({
            label: `${plan.definition.name}:particle-depth-sampler`,
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest'
        });
        this.#rendererPasses = Object.freeze(
            this.compiled.renderers.map(rendererPlan => {
                const createDrawPass = (reversed: boolean): GPUDrivenRenderPass =>
                    new GPUDrivenRenderPass({
                        name: `${plan.definition.name}:sprite-${reversed ? 'reversed' : 'standard'}`,
                        shader: rendererPlan.shader,
                        pipelineState: drawPipelineState(rendererPlan.definition, reversed)
                    });
                const hasTexture =
                    rendererPlan.definition.texture !== null &&
                    rendererPlan.definition.texture !== undefined;
                return Object.freeze({
                    standard: createDrawPass(false),
                    reversed: createDrawPass(true),
                    parameters: new RenderPassParameterPool(
                        () =>
                            new ParticleDrawParameters(
                                UniformBuffer.fromSchema(PARTICLE_VIEW_LAYOUT),
                                hasTexture ? sampler : null,
                                rendererPlan.definition.softParticle === undefined
                                    ? null
                                    : depthSampler,
                                !(rendererPlan.definition.depthWrite ?? false)
                            )
                    )
                });
            })
        );
        const createAdvancedBuffer = (
            suffix: string,
            byteLength: number,
            usage: Parameters<RendererContract['createStorageBuffer']>[0]['usage'],
            initialData?: ArrayBufferView
        ): StorageBuffer =>
            renderer.createStorageBuffer({
                label: `${plan.definition.name}:particle-${suffix}`,
                byteLength,
                usage,
                recovery: 'cpu-shadow',
                ...(initialData === undefined ? {} : { initialData })
            });
        this.#advancedRuntimes = Object.freeze(
            this.compiled.advancedRenderers.map((advanced, advancedIndex) => {
                if (advanced.kind === 'mesh') {
                    const bucketIndices = createAdvancedBuffer(
                        `mesh-${String(advancedIndex)}-bucket-indices`,
                        advanced.bucketIndexByteLength,
                        ['storage']
                    );
                    const bucketCounters = createAdvancedBuffer(
                        `mesh-${String(advancedIndex)}-bucket-counters`,
                        advanced.bucketCounterByteLength,
                        ['storage']
                    );
                    const indirect = createAdvancedBuffer(
                        `mesh-${String(advancedIndex)}-indirect`,
                        advanced.indirectByteLength,
                        ['storage', 'indirect']
                    );
                    const geometry = Object.freeze(
                        advanced.assets.map((asset, assetIndex) =>
                            createAdvancedBuffer(
                                `mesh-${String(advancedIndex)}-geometry-${String(assetIndex)}`,
                                Math.max(16, Math.ceil(asset.vertexData.byteLength / 16) * 16),
                                ['storage'],
                                asset.vertexData
                            )
                        )
                    );
                    const reset = pass(
                        advanced.reset,
                        `${plan.definition.name}:mesh-bucket-reset:${String(advancedIndex)}`
                    );
                    const build = pass(
                        advanced.build,
                        `${plan.definition.name}:mesh-bucket-build:${String(advancedIndex)}`
                    );
                    const finalize = pass(
                        advanced.finalize,
                        `${plan.definition.name}:mesh-indirect-finalize:${String(advancedIndex)}`
                    );
                    const draws = Object.freeze(
                        advanced.assets.map((asset, assetIndex) => {
                            const create = (reversed: boolean): GPUDrivenRenderPass =>
                                new GPUDrivenRenderPass({
                                    name: `${plan.definition.name}:mesh-${String(advancedIndex)}-${String(assetIndex)}-${reversed ? 'reversed' : 'standard'}`,
                                    shader: asset.shader,
                                    pipelineState: advancedDrawPipelineState(
                                        advanced.definition,
                                        reversed
                                    )
                                });
                            return Object.freeze({
                                standard: create(false),
                                reversed: create(true),
                                parameters: new RenderPassParameterPool(
                                    () =>
                                        new ParticleDrawParameters(
                                            UniformBuffer.fromSchema(PARTICLE_VIEW_LAYOUT),
                                            asset.texture === null || asset.texture === undefined
                                                ? null
                                                : sampler,
                                            null,
                                            !(advanced.definition.depthWrite ?? true),
                                            3
                                        )
                                )
                            });
                        })
                    );
                    const runtime: ParticleGPUMeshRuntime = {
                        kind: 'mesh',
                        plan: advanced,
                        bucketIndices,
                        bucketCounters,
                        indirect,
                        geometry,
                        reset,
                        build,
                        finalize,
                        resetParameters: computePool(
                            2,
                            false,
                            Math.max(1, Math.ceil(advanced.assets.length / 64))
                        ),
                        buildParameters: computePool(5, false, this.compiled.workgroupCount),
                        finalizeParameters: computePool(
                            2,
                            false,
                            Math.max(1, Math.ceil(advanced.assets.length / 64))
                        ),
                        draws
                    };
                    return runtime;
                }
                const topology = createAdvancedBuffer(
                    `${advanced.definition.type}-${String(advancedIndex)}-topology`,
                    advanced.topologyByteLength,
                    ['storage']
                );
                const segments = createAdvancedBuffer(
                    `${advanced.definition.type}-${String(advancedIndex)}-segments`,
                    advanced.segmentByteLength,
                    ['storage']
                );
                const counter = createAdvancedBuffer(
                    `${advanced.definition.type}-${String(advancedIndex)}-counter`,
                    advanced.counterByteLength,
                    ['storage']
                );
                const indirect = createAdvancedBuffer(
                    `${advanced.definition.type}-${String(advancedIndex)}-indirect`,
                    advanced.indirectByteLength,
                    ['storage', 'indirect']
                );
                const createDraw = (reversed: boolean): GPUDrivenRenderPass =>
                    new GPUDrivenRenderPass({
                        name: `${plan.definition.name}:${advanced.definition.type}-${reversed ? 'reversed' : 'standard'}`,
                        shader: advanced.shader,
                        pipelineState: advancedDrawPipelineState(advanced.definition, reversed)
                    });
                const sortParameters = new RenderPassParameterPool(
                    () =>
                        new ParticleComputeParameters(
                            3,
                            UniformBuffer.fromSchema(PARTICLE_RIBBON_SORT_LAYOUT),
                            Math.max(1, Math.ceil(advanced.topologyCapacity / 64))
                        )
                );
                const runtime: ParticleGPURibbonRuntime = {
                    kind: 'ribbon',
                    plan: advanced,
                    topology,
                    segments,
                    counter,
                    indirect,
                    reset: pass(advanced.reset, `${plan.definition.name}:ribbon-reset`),
                    initializeTopology: pass(
                        advanced.initializeTopology,
                        `${plan.definition.name}:ribbon-topology-initialize`
                    ),
                    sortTopology: pass(
                        advanced.sortTopology,
                        `${plan.definition.name}:ribbon-topology-sort`
                    ),
                    buildSegments: pass(
                        advanced.buildSegments,
                        `${plan.definition.name}:ribbon-segment-compact`
                    ),
                    finalize: pass(
                        advanced.finalize,
                        `${plan.definition.name}:ribbon-indirect-finalize`
                    ),
                    resetParameters: computePool(2, false, 1),
                    initializeParameters: computePool(
                        2,
                        false,
                        Math.max(1, Math.ceil(advanced.topologyCapacity / 64))
                    ),
                    sortParameters,
                    buildParameters: computePool(
                        6,
                        false,
                        Math.max(1, Math.ceil(advanced.topologyCapacity / 64))
                    ),
                    finalizeParameters: computePool(2, false, 1),
                    standard: createDraw(false),
                    reversed: createDraw(true),
                    drawParameters: new RenderPassParameterPool(
                        () =>
                            new ParticleDrawParameters(
                                UniformBuffer.fromSchema(PARTICLE_VIEW_LAYOUT),
                                advanced.definition.texture === null ||
                                    advanced.definition.texture === undefined
                                    ? null
                                    : sampler,
                                advanced.definition.softParticle === undefined
                                    ? null
                                    : depthSampler,
                                !(advanced.definition.depthWrite ?? false),
                                1
                            )
                    )
                };
                return runtime;
            })
        );
        this.#restoredListener = (): void => {
            this.controller.restart();
            this.transaction.restart();
            this.#recoveryPending = true;
            this.#simulationFrame = -1;
        };
        renderer.on('webgpuDeviceRestored', this.#restoredListener);
    }

    record(
        context: RenderPipelineContext,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        system: Node,
        drawVisible: boolean,
        phase: 'opaque' | 'transparent'
    ): void {
        this.assertAlive();
        const recordsSimulation =
            this.#simulationFrame !== context.frameIndex && this.controller.hasPendingWork;
        if (recordsSimulation && this.controller.pendingSpawnCount > 0) {
            const commandView = this.controller.commands.subarray(
                0,
                this.controller.pendingSpawnCount * 16
            );
            context.writeStorageBuffer(this.#buffers.spawnCommands, 0, commandView);
        }
        const imported = importBuffers(context, this.#buffers);
        if (this.#recoveryPending && this.#recoveryFrame !== context.frameIndex) {
            const parameters = context.acquirePassParameters(this.#recoveryParameters);
            parameters.configure([
                imported.state[0],
                imported.state[1],
                imported.alive[0],
                imported.alive[1],
                imported.dead,
                imported.counters,
                imported.indirect
            ]);
            context.graph.addPass(this.#recoveryPass, parameters);
            this.#recoveryFrame = context.frameIndex;
        }
        if (recordsSimulation) {
            this.recordSimulation(context, imported, system, depth);
            this.#simulationFrame = context.frameIndex;
        }
        const activeStateIndex =
            this.transaction.staged?.sourceIndex ?? this.transaction.committed.sourceIndex;
        const activeState = imported.state[activeStateIndex];
        const activeAlive = imported.alive[activeStateIndex];
        if (this.#sortPass !== null && drawVisible && this.#budgetSorting) {
            this.recordSort(context, imported, activeState, activeAlive);
        }
        if (!drawVisible) return;
        const build = context.acquirePassParameters(this.#buildParameters);
        build.configure([activeState, activeAlive, imported.counters, imported.rendererData]);
        context.graph.addPass(this.#buildRendererPass, build);
        this.recordAdvancedBuilds(
            context,
            imported,
            activeState,
            activeAlive,
            imported.rendererData,
            phase
        );
        this.recordDraws(context, imported, color, depth, system, phase);
    }

    /** Apply one emitter's frame-wide quality decision. @internal */
    setBudget(decision: Readonly<ParticleBudgetDecision>): void {
        const wasEnabled = this.#budgetEnabled;
        this.#budgetEnabled = decision.enabled;
        this.#budgetSorting = decision.sorting;
        this.#budgetSoftParticles = decision.softParticles;
        this.#budgetCollision = decision.collision;
        this.#budgetRibbons = decision.ribbons;
        this.controller.setBudget(decision.particleLimit, decision.spawnRateScale);
        if (wasEnabled && !decision.enabled) this.restart();
    }

    /** Route events captured by this frame directly into a target GPU emitter's active state. @internal */
    recordEventRoute(
        context: RenderPipelineContext,
        target: ParticleGPUEmitterRuntime,
        module: Readonly<ParticleSubEmitterModule>
    ): void {
        this.assertAlive();
        target.assertAlive();
        if (this.#simulationFrame !== context.frameIndex) return;
        let route = this.#eventRoutes.get(module);
        if (route === undefined) {
            const plan = compileParticleGPUSubEmitterRoute(
                this.compiled.emitter,
                target.compiled.emitter,
                module
            );
            route = {
                plan,
                pass: new ComputeRenderPass(
                    new ComputeKernel({ shader: plan.shader, label: plan.shader.label }),
                    plan.shader.label
                ),
                parameters: new RenderPassParameterPool(
                    () =>
                        new ParticleComputeParameters(
                            6,
                            null,
                            Math.max(
                                1,
                                Math.ceil(this.compiled.emitter.definition.eventCapacity / 64)
                            )
                        )
                ),
                frameIndex: -1
            };
            this.#eventRoutes.set(module, route);
        }
        if (route.frameIndex === context.frameIndex) return;
        const sourceBuffers = importBuffers(context, this.#buffers);
        const targetBuffers = importBuffers(context, target.#buffers);
        const targetStateIndex =
            target.transaction.staged?.sourceIndex ?? target.transaction.committed.sourceIndex;
        const parameters = context.acquirePassParameters(route.parameters);
        parameters.configure([
            sourceBuffers.events,
            sourceBuffers.eventCounters,
            targetBuffers.state[targetStateIndex],
            targetBuffers.alive[targetStateIndex],
            targetBuffers.dead,
            targetBuffers.counters
        ]);
        context.graph.addPass(route.pass, parameters);
        route.frameIndex = context.frameIndex;
    }

    frameSubmitted(frameIndex: number): void {
        if (this.#simulationFrame === frameIndex && this.transaction.staged !== null) {
            this.transaction.commit();
            this.controller.commitPendingWork();
        }
        if (this.#recoveryFrame === frameIndex) this.#recoveryPending = false;
    }

    frameDiscarded(frameIndex: number): void {
        if (this.#simulationFrame === frameIndex) this.transaction.rollback();
        if (this.#recoveryFrame === frameIndex) this.#recoveryPending = true;
    }

    restart(): void {
        this.assertAlive();
        this.controller.restart();
        this.transaction.restart();
        this.#recoveryPending = true;
        this.#simulationFrame = -1;
        this.#recoveryFrame = -1;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#renderer.off('webgpuDeviceRestored', this.#restoredListener);
        for (const buffer of [
            ...this.#buffers.state,
            ...this.#buffers.alive,
            this.#buffers.dead,
            this.#buffers.counters,
            this.#buffers.spawnCommands,
            this.#buffers.events,
            this.#buffers.eventCounters,
            this.#buffers.rendererData,
            this.#buffers.indirect
        ]) {
            buffer.destroy();
        }
        for (const runtime of this.#advancedRuntimes) {
            if (runtime.kind === 'mesh') {
                runtime.bucketIndices.destroy();
                runtime.bucketCounters.destroy();
                runtime.indirect.destroy();
                for (const geometry of runtime.geometry) geometry.destroy();
            } else {
                runtime.topology.destroy();
                runtime.segments.destroy();
                runtime.counter.destroy();
                runtime.indirect.destroy();
            }
        }
    }

    private recordSimulation(
        context: RenderPipelineContext,
        imported: ParticleGPUImportedBuffers,
        system: Node,
        depth: RenderGraphTextureHandle | null
    ): void {
        const spawnCount = this.controller.pendingSpawnCount;
        const staged = this.transaction.stage(this.controller.pendingDeltaSeconds, spawnCount);
        const sourceIndex = this.transaction.committed.sourceIndex;
        const targetIndex = staged.sourceIndex;
        const world = system.worldMatrix.elements;
        const values = this.#parameterValues;
        values.timeDelta.set([
            this.transaction.committed.clockSeconds,
            staged.deltaSeconds,
            staged.clockSeconds,
            this.compiled.emitter.definition.fixedStep
        ]);
        values.emitterPosition.set([world[12], world[13], world[14], 1]);
        values.emitterVelocity.set(this.controller.emitterVelocity);
        values.spawn.set([
            spawnCount,
            this.controller.pendingSpawnStart,
            this.transaction.seed,
            context.camera.depthMode === 'reversed' ? 1 : 0
        ]);
        context.camera.updateViewProjectionMatrix();
        cameraPosition(context.camera, values.cameraPosition);
        values.viewProjection.set(context.camera.jitteredViewProjectionMatrix.elements);
        values.sort.fill(0);
        values.sort[2] = this.controller.particleLimit;
        values.sort[3] = this.#budgetCollision ? 1 : 0;
        const reset = context.acquirePassParameters(this.#resetParameters);
        reset.configure([imported.counters, imported.eventCounters]);
        context.graph.addPass(this.#resetPass, reset);
        const simulate = context.acquirePassParameters(this.#simulateParameters);
        this.writeParticleUniform(simulate);
        simulate.configure([
            imported.state[sourceIndex],
            imported.state[targetIndex],
            imported.alive[sourceIndex],
            imported.alive[targetIndex],
            imported.dead,
            imported.counters,
            imported.events,
            imported.eventCounters
        ]);
        const simulationTextures = this.compiled.emitter.definition.modules
            .filter(module => module.type === 'vector-field')
            .map(module => context.graph.importTexture(module.texture));
        if (
            this.compiled.emitter.definition.modules.some(
                module => module.type === 'scene-depth-collision'
            )
        ) {
            if (depth === null) {
                throw new Error('Scene-depth particle collision requires a Forward depth texture');
            }
            simulationTextures.push(depth);
        }
        simulate.configureTextures(simulationTextures);
        context.graph.addPass(this.#simulatePass, simulate);
        if (spawnCount > 0) {
            const initialize = context.acquirePassParameters(this.#initializeParameters);
            this.writeParticleUniform(initialize);
            initialize.dispatch.x = Math.max(1, Math.ceil(spawnCount / 64));
            initialize.configure([
                imported.state[targetIndex],
                imported.alive[targetIndex],
                imported.dead,
                imported.counters,
                imported.spawnCommands,
                imported.events,
                imported.eventCounters
            ]);
            context.graph.addPass(this.#initializePass, initialize);
        }
        const finalize = context.acquirePassParameters(this.#finalizeParameters);
        this.writeParticleUniform(finalize);
        finalize.configure([imported.counters, imported.indirect]);
        context.graph.addPass(this.#finalizePass, finalize);
    }

    private recordSort(
        context: RenderPipelineContext,
        imported: ParticleGPUImportedBuffers,
        state: RenderGraphBufferHandle,
        alive: RenderGraphBufferHandle
    ): void {
        const pass = this.#sortPass;
        if (pass === null) return;
        const values = this.#parameterValues;
        cameraPosition(context.camera, values.cameraPosition);
        if (this.compiled.sortStrategy === 'radix-buckets') {
            values.sort.fill(0);
            const parameters = context.acquirePassParameters(this.#sortParameters);
            this.writeParticleUniform(parameters);
            parameters.configure([state, alive, imported.counters]);
            context.graph.addPass(pass, parameters);
            return;
        }
        let size = 2;
        while (size <= this.compiled.emitter.definition.capacity) {
            let stride = size >>> 1;
            while (stride > 0) {
                values.sort[0] = size;
                values.sort[1] = stride;
                const parameters = context.acquirePassParameters(this.#sortParameters);
                this.writeParticleUniform(parameters);
                parameters.configure([state, alive, imported.counters]);
                context.graph.addPass(pass, parameters);
                stride >>>= 1;
            }
            size <<= 1;
        }
    }

    private recordDraws(
        context: RenderPipelineContext,
        imported: ParticleGPUImportedBuffers,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        system: Node,
        phase: 'opaque' | 'transparent'
    ): void {
        context.camera.updateViewProjectionMatrix();
        if (phase === 'transparent') {
            for (let index = 0; index < this.#rendererPasses.length; index += 1) {
                const rendererPass = this.#rendererPasses[index];
                const rendererPlan = this.compiled.renderers[index];
                if (!rendererPass || !rendererPlan) continue;
                if ((rendererPlan.definition.depthTest ?? true) && depth === null) {
                    throw new Error(
                        'GPU particle depth testing requires a Forward depth attachment'
                    );
                }
                const parameters = context.acquirePassParameters(rendererPass.parameters);
                this.writeViewUniform(parameters.viewUniform, context, system);
                const texture = rendererPlan.definition.texture;
                parameters.configure(
                    [imported.rendererData],
                    imported.indirect,
                    0,
                    color,
                    depth,
                    texture === null || texture === undefined
                        ? null
                        : context.graph.importTexture(texture),
                    context
                );
                context.graph.addPass(
                    context.camera.depthMode === 'reversed'
                        ? rendererPass.reversed
                        : rendererPass.standard,
                    parameters
                );
            }
        }
        for (const runtime of this.#advancedRuntimes) {
            if (runtime.kind === 'ribbon' && !this.#budgetRibbons) continue;
            const transparent =
                (runtime.plan.definition.coverage ?? 'transparent') === 'transparent';
            if ((phase === 'transparent') !== transparent) continue;
            if ((runtime.plan.definition.depthTest ?? true) && depth === null) {
                throw new Error(
                    'Advanced GPU particle depth testing requires a Forward depth attachment'
                );
            }
            if (runtime.kind === 'mesh') {
                const bucketIndices = context.graph.importStorageBuffer(runtime.bucketIndices);
                const indirect = context.graph.importStorageBuffer(runtime.indirect);
                for (let assetIndex = 0; assetIndex < runtime.draws.length; assetIndex += 1) {
                    const draw = runtime.draws[assetIndex];
                    const asset = runtime.plan.assets[assetIndex];
                    const geometry = runtime.geometry[assetIndex];
                    if (!draw || !asset || !geometry) continue;
                    const parameters = context.acquirePassParameters(draw.parameters);
                    this.writeViewUniform(parameters.viewUniform, context, system);
                    const texture = asset.texture;
                    parameters.configure(
                        [
                            imported.rendererData,
                            bucketIndices,
                            context.graph.importStorageBuffer(geometry)
                        ],
                        indirect,
                        assetIndex * 16,
                        color,
                        depth,
                        texture === null || texture === undefined
                            ? null
                            : context.graph.importTexture(texture),
                        context
                    );
                    context.graph.addPass(
                        context.camera.depthMode === 'reversed' ? draw.reversed : draw.standard,
                        parameters
                    );
                }
                continue;
            }
            const parameters = context.acquirePassParameters(runtime.drawParameters);
            this.writeViewUniform(parameters.viewUniform, context, system);
            const texture = runtime.plan.definition.texture;
            parameters.configure(
                [context.graph.importStorageBuffer(runtime.segments)],
                context.graph.importStorageBuffer(runtime.indirect),
                0,
                color,
                depth,
                texture === null || texture === undefined
                    ? null
                    : context.graph.importTexture(texture),
                context
            );
            context.graph.addPass(
                context.camera.depthMode === 'reversed' ? runtime.reversed : runtime.standard,
                parameters
            );
        }
    }

    private recordAdvancedBuilds(
        context: RenderPipelineContext,
        imported: ParticleGPUImportedBuffers,
        state: RenderGraphBufferHandle,
        alive: RenderGraphBufferHandle,
        rendererData: RenderGraphBufferHandle,
        phase: 'opaque' | 'transparent'
    ): void {
        for (const runtime of this.#advancedRuntimes) {
            if (runtime.kind === 'ribbon' && !this.#budgetRibbons) continue;
            const transparent =
                (runtime.plan.definition.coverage ?? 'transparent') === 'transparent';
            if ((phase === 'transparent') !== transparent) continue;
            if (runtime.kind === 'mesh') {
                const bucketIndices = context.graph.importStorageBuffer(runtime.bucketIndices);
                const bucketCounters = context.graph.importStorageBuffer(runtime.bucketCounters);
                const indirect = context.graph.importStorageBuffer(runtime.indirect);
                const reset = context.acquirePassParameters(runtime.resetParameters);
                reset.configure([bucketCounters, indirect]);
                context.graph.addPass(runtime.reset, reset);
                const build = context.acquirePassParameters(runtime.buildParameters);
                build.configure([state, alive, imported.counters, bucketIndices, bucketCounters]);
                context.graph.addPass(runtime.build, build);
                const finalize = context.acquirePassParameters(runtime.finalizeParameters);
                finalize.configure([bucketCounters, indirect]);
                context.graph.addPass(runtime.finalize, finalize);
                continue;
            }
            const topology = context.graph.importStorageBuffer(runtime.topology);
            const segments = context.graph.importStorageBuffer(runtime.segments);
            const counter = context.graph.importStorageBuffer(runtime.counter);
            const indirect = context.graph.importStorageBuffer(runtime.indirect);
            const reset = context.acquirePassParameters(runtime.resetParameters);
            reset.configure([counter, indirect]);
            context.graph.addPass(runtime.reset, reset);
            const initialize = context.acquirePassParameters(runtime.initializeParameters);
            initialize.configure([imported.counters, topology]);
            context.graph.addPass(runtime.initializeTopology, initialize);
            let size = 2;
            while (size <= runtime.plan.topologyCapacity) {
                let stride = size >>> 1;
                while (stride > 0) {
                    const sort = context.acquirePassParameters(runtime.sortParameters);
                    const uniform = sort.uniformBuffers[0];
                    if (!uniform) throw new Error('Particle ribbon sort uniform is unavailable');
                    uniform.set('size', size);
                    uniform.set('stride', stride);
                    uniform.set('capacity', runtime.plan.topologyCapacity);
                    uniform.set('padding', 0);
                    sort.configure([state, alive, topology]);
                    context.graph.addPass(runtime.sortTopology, sort);
                    stride >>>= 1;
                }
                size <<= 1;
            }
            const build = context.acquirePassParameters(runtime.buildParameters);
            build.configure([state, alive, rendererData, topology, counter, segments]);
            context.graph.addPass(runtime.buildSegments, build);
            const finalize = context.acquirePassParameters(runtime.finalizeParameters);
            finalize.configure([counter, indirect]);
            context.graph.addPass(runtime.finalize, finalize);
        }
    }

    private writeViewUniform(
        viewUniform: UniformBuffer,
        context: RenderPipelineContext,
        system: Node
    ): void {
        viewUniform.set('u_viewMatrix', context.camera.viewMatrix.elements);
        viewUniform.set('u_projectionMatrix', context.camera.jitteredProjectionMatrix.elements);
        viewUniform.set(
            'u_modelMatrix',
            this.compiled.emitter.definition.simulationSpace === 'local'
                ? system.worldMatrix.elements
                : IDENTITY_MATRIX
        );
        cameraPosition(context.camera, this.#viewCameraPosition);
        this.#viewCameraPosition[3] = context.camera.depthMode === 'reversed' ? 1 : 0;
        viewUniform.set('u_cameraPosition', this.#viewCameraPosition);
        const viewport = context.viewport;
        this.#viewViewport.set([viewport[0], viewport[1], viewport[2], viewport[3]]);
        viewUniform.set('u_viewport', this.#viewViewport);
        this.collectSceneLighting(context);
        viewUniform.set('u_particleAmbient', this.#viewAmbient);
        viewUniform.set('u_particleDirectionalColor', this.#viewDirectionalColors);
        viewUniform.set('u_particleDirectionalDirection', this.#viewDirectionalDirections);
    }

    private collectSceneLighting(context: RenderPipelineContext): void {
        this.#viewAmbient.fill(0);
        this.#viewDirectionalColors.fill(0);
        this.#viewDirectionalDirections.fill(0);
        this.#viewAmbient[3] = this.#budgetSoftParticles ? 1 : 0;
        let directionalIndex = 0;
        context.scene.traverse(node => {
            if (!(node instanceof Light) || !node.enabled) return;
            const red = node.color.r * node.amount;
            const green = node.color.g * node.amount;
            const blue = node.color.b * node.amount;
            if (node.isAmbientLight) {
                this.#viewAmbient[0] = (this.#viewAmbient[0] ?? 0) + red;
                this.#viewAmbient[1] = (this.#viewAmbient[1] ?? 0) + green;
                this.#viewAmbient[2] = (this.#viewAmbient[2] ?? 0) + blue;
                return;
            }
            if (!(node instanceof DirectionalLight) || directionalIndex >= 4) return;
            const direction = node.getWorldDirection();
            const offset = directionalIndex * 4;
            this.#viewDirectionalColors[offset] = red;
            this.#viewDirectionalColors[offset + 1] = green;
            this.#viewDirectionalColors[offset + 2] = blue;
            this.#viewDirectionalDirections[offset] = direction.x;
            this.#viewDirectionalDirections[offset + 1] = direction.y;
            this.#viewDirectionalDirections[offset + 2] = direction.z;
            directionalIndex++;
        });
    }

    private writeParticleUniform(parameters: ParticleComputeParameters): void {
        const uniform = parameters.uniformBuffers[0];
        if (!uniform) throw new Error('Particle compute uniform is unavailable');
        uniform.set('timeDelta', this.#parameterValues.timeDelta);
        uniform.set('emitterPosition', this.#parameterValues.emitterPosition);
        uniform.set('emitterVelocity', this.#parameterValues.emitterVelocity);
        uniform.set('spawn', this.#parameterValues.spawn);
        uniform.set('cameraPosition', this.#parameterValues.cameraPosition);
        uniform.set('sort', this.#parameterValues.sort);
        uniform.set('viewProjection', this.#parameterValues.viewProjection);
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Particle GPU runtime is destroyed');
    }
}

const IDENTITY_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
