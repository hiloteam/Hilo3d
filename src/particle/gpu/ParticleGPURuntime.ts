import type Camera from '../../camera/Camera';
import type { EventListener } from '../../core/EventDispatcher';
import type Node from '../../core/Node';
import {
    DEFAULT_MATERIAL_PIPELINE_STATE,
    type MaterialPipelineState
} from '../../material/MaterialDefinition';
import { MaterialBlendPreset } from '../../material/MaterialCompiler';
import ComputeKernel from '../../render/compute/ComputeKernel';
import ComputeSampler from '../../render/compute/ComputeSampler';
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
import type { ParticleGPUSpawnController } from './ParticleGPUSpawnController';
import { ParticleGPUTransaction } from './ParticleGPUTransaction';

const EMPTY_SAMPLERS: readonly never[] = Object.freeze([]);
const PARTICLE_PARAMETER_LAYOUT = createStd140Layout({
    timeDelta: 'vec4',
    emitterPosition: 'vec4',
    emitterVelocity: 'vec4',
    spawn: 'uvec4',
    cameraPosition: 'vec4',
    sort: 'uvec4'
});
const PARTICLE_VIEW_LAYOUT = createStd140Layout({
    u_viewMatrix: 'mat4',
    u_projectionMatrix: 'mat4',
    u_modelMatrix: 'mat4',
    u_cameraPosition: 'vec4',
    u_viewport: 'vec4'
});

class MutableBufferBinding implements ComputeBufferBinding {
    buffer = 0 as RenderGraphBufferHandle;
}

class MutableTextureBinding implements ComputeTextureBinding {
    texture = 0 as RenderGraphTextureHandle;
}

class ParticleComputeParameters implements ComputeRenderPassParameters {
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
    readonly depthLoadOp = 'load';
    readonly depthStoreOp = 'store';
}

class MutableIndirectDraw {
    readonly kind = 'draw-indirect';
    buffer = 0 as RenderGraphBufferHandle;
}

class ParticleDrawParameters implements GPUDrivenRenderPassParameters {
    readonly uniformBuffers: readonly UniformBuffer[];
    readonly buffers = [new MutableBufferBinding()];
    readonly textures: { texture: RenderGraphTextureHandle }[] = [];
    readonly samplers: readonly ComputeSampler[];
    readonly draw = new MutableIndirectDraw();
    readonly colorAttachments = [new MutableColorAttachment()];
    readonly depthStencilAttachment = new MutableDepthAttachment();
    readonly viewport: [number, number, number, number] = [0, 0, 1, 1];
    readonly scissor: [number, number, number, number] = [0, 0, 1, 1];

    constructor(
        readonly viewUniform: UniformBuffer,
        sampler: ComputeSampler | null
    ) {
        this.uniformBuffers = Object.freeze([viewUniform]);
        this.samplers = sampler === null ? EMPTY_SAMPLERS : Object.freeze([sampler]);
        if (sampler !== null) this.textures.push({ texture: 0 as RenderGraphTextureHandle });
    }

    configure(
        rendererData: RenderGraphBufferHandle,
        indirect: RenderGraphBufferHandle,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        texture: RenderGraphTextureHandle | null,
        context: RenderPipelineContext
    ): void {
        const rendererBinding = this.buffers[0];
        const colorAttachment = this.colorAttachments[0];
        if (!rendererBinding || !colorAttachment) {
            throw new Error('Particle draw parameter storage is unavailable');
        }
        rendererBinding.buffer = rendererData;
        this.draw.buffer = indirect;
        colorAttachment.texture = color;
        if (depth !== null) this.depthStencilAttachment.texture = depth;
        const textureBinding = this.textures[0];
        if (textureBinding !== undefined && texture !== null) textureBinding.texture = texture;
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
    readonly rendererData: StorageBuffer;
    readonly indirect: StorageBuffer;
}

interface ParticleGPUImportedBuffers {
    readonly state: readonly [RenderGraphBufferHandle, RenderGraphBufferHandle];
    readonly alive: readonly [RenderGraphBufferHandle, RenderGraphBufferHandle];
    readonly dead: RenderGraphBufferHandle;
    readonly counters: RenderGraphBufferHandle;
    readonly spawnCommands: RenderGraphBufferHandle;
    readonly rendererData: RenderGraphBufferHandle;
    readonly indirect: RenderGraphBufferHandle;
}

interface ParticleRendererPasses {
    readonly standard: GPUDrivenRenderPass;
    readonly reversed: GPUDrivenRenderPass;
    readonly parameters: RenderPassParameterPool<ParticleDrawParameters>;
}

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

function drawPipelineState(
    renderer: ParticleGPUCompiledPlan['renderers'][number]['definition'],
    reversed: boolean
): Readonly<MaterialPipelineState> {
    return Object.freeze({
        ...DEFAULT_MATERIAL_PIPELINE_STATE,
        cullMode: 'none',
        depthTest: renderer.depthTest ?? true,
        depthWrite: renderer.depthWrite ?? false,
        depthCompare: reversed ? 'greater-equal' : 'less-equal',
        blend: blendState(renderer.blend)
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
        sort: new Uint32Array(4)
    };
    readonly #viewCameraPosition = new Float32Array(4);
    readonly #viewViewport = new Float32Array(4);
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
    readonly #restoredListener: EventListener;
    #simulationFrame = -1;
    #recoveryFrame = -1;
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
        const pass = (
            shader: ParticleGPUCompiledPlan['shaders'][keyof ParticleGPUCompiledPlan['shaders']],
            label: string
        ): ComputeRenderPass => {
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
        this.#resetParameters = computePool(1, false, 1);
        this.#simulateParameters = computePool(
            6,
            true,
            this.compiled.workgroupCount,
            vectorFieldCount,
            vectorFieldSamplers
        );
        this.#initializeParameters = computePool(5, true, 1);
        this.#finalizeParameters = computePool(2, false, 1);
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
                                hasTexture ? sampler : null
                            )
                    )
                });
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
        drawVisible: boolean
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
            this.recordSimulation(context, imported, system);
            this.#simulationFrame = context.frameIndex;
        }
        const activeStateIndex =
            this.transaction.staged?.sourceIndex ?? this.transaction.committed.sourceIndex;
        const activeState = imported.state[activeStateIndex];
        const activeAlive = imported.alive[activeStateIndex];
        if (this.#sortPass !== null && drawVisible) {
            this.recordSort(context, imported, activeState, activeAlive);
        }
        if (!drawVisible) return;
        const build = context.acquirePassParameters(this.#buildParameters);
        build.configure([activeState, activeAlive, imported.counters, imported.rendererData]);
        context.graph.addPass(this.#buildRendererPass, build);
        this.recordDraws(context, imported, color, depth, system);
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
            this.#buffers.rendererData,
            this.#buffers.indirect
        ]) {
            buffer.destroy();
        }
    }

    private recordSimulation(
        context: RenderPipelineContext,
        imported: ParticleGPUImportedBuffers,
        system: Node
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
        values.spawn.set([spawnCount, this.controller.pendingSpawnStart, this.transaction.seed, 0]);
        cameraPosition(context.camera, values.cameraPosition);
        values.sort.fill(0);
        const reset = context.acquirePassParameters(this.#resetParameters);
        reset.configure([imported.counters]);
        context.graph.addPass(this.#resetPass, reset);
        const simulate = context.acquirePassParameters(this.#simulateParameters);
        this.writeParticleUniform(simulate);
        simulate.configure([
            imported.state[sourceIndex],
            imported.state[targetIndex],
            imported.alive[sourceIndex],
            imported.alive[targetIndex],
            imported.dead,
            imported.counters
        ]);
        simulate.configureTextures(
            this.compiled.emitter.definition.modules
                .filter(module => module.type === 'vector-field')
                .map(module => context.graph.importTexture(module.texture))
        );
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
                imported.spawnCommands
            ]);
            context.graph.addPass(this.#initializePass, initialize);
        }
        const finalize = context.acquirePassParameters(this.#finalizeParameters);
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
        system: Node
    ): void {
        context.camera.updateViewProjectionMatrix();
        for (let index = 0; index < this.#rendererPasses.length; index += 1) {
            const rendererPass = this.#rendererPasses[index];
            const rendererPlan = this.compiled.renderers[index];
            if (!rendererPass || !rendererPlan) continue;
            if ((rendererPlan.definition.depthTest ?? true) && depth === null) {
                throw new Error('GPU particle depth testing requires a Forward depth attachment');
            }
            const parameters = context.acquirePassParameters(rendererPass.parameters);
            const viewUniform = parameters.viewUniform;
            viewUniform.set('u_viewMatrix', context.camera.viewMatrix.elements);
            viewUniform.set('u_projectionMatrix', context.camera.jitteredProjectionMatrix.elements);
            viewUniform.set(
                'u_modelMatrix',
                this.compiled.emitter.definition.simulationSpace === 'local'
                    ? system.worldMatrix.elements
                    : IDENTITY_MATRIX
            );
            cameraPosition(context.camera, this.#viewCameraPosition);
            viewUniform.set('u_cameraPosition', this.#viewCameraPosition);
            const viewport = context.viewport;
            this.#viewViewport.set([viewport[2], viewport[3], 1 / viewport[2], 1 / viewport[3]]);
            viewUniform.set('u_viewport', this.#viewViewport);
            const texture = rendererPlan.definition.texture;
            parameters.configure(
                imported.rendererData,
                imported.indirect,
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

    private writeParticleUniform(parameters: ParticleComputeParameters): void {
        const uniform = parameters.uniformBuffers[0];
        if (!uniform) throw new Error('Particle compute uniform is unavailable');
        uniform.set('timeDelta', this.#parameterValues.timeDelta);
        uniform.set('emitterPosition', this.#parameterValues.emitterPosition);
        uniform.set('emitterVelocity', this.#parameterValues.emitterVelocity);
        uniform.set('spawn', this.#parameterValues.spawn);
        uniform.set('cameraPosition', this.#parameterValues.cameraPosition);
        uniform.set('sort', this.#parameterValues.sort);
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Particle GPU runtime is destroyed');
    }
}

const IDENTITY_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
