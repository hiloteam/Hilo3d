import type Camera from '../../camera/Camera';
import type Node from '../../core/Node';
import ComputeKernel from '../../render/compute/ComputeKernel';
import ComputeSampler from '../../render/compute/ComputeSampler';
import type { RendererContract } from '../../render/RendererCore';
import type { StorageBuffer } from '../../render/StorageBuffer';
import UniformBuffer from '../../render/UniformBuffer';
import { RenderPassParameterPool } from '../../render/pipeline/RenderPassParameterPool';
import type { RenderPipelineContext } from '../../render/pipeline/RenderPipeline';
import type { RenderGraphTextureHandle } from '../../render/pipeline/ScriptableRenderGraph';
import { ComputeRenderPass } from '../../render/pipeline/passes/ComputeRenderPass';
import { GPUDrivenRenderPass } from '../../render/pipeline/passes/GPUDrivenRenderPass';
import { createStd140Layout } from '../../render/ubo/Std140Layout';
import type { ParticleBudgetDecision } from '../ParticleBudget';
import type { ParticleCompiledEmitterPlan } from '../ParticleCompiledPlan';
import {
    compileParticleGPUStorageRenderer,
    type ParticleGPUStorageRendererPlan
} from '../gpu/ParticleGPUPlan';
import {
    PARTICLE_VIEW_LAYOUT,
    ParticleComputeParameters,
    ParticleDrawParameters,
    drawPipelineState
} from '../gpu/ParticleGPURuntime';
import {
    compileParticleStatelessGPUPlan,
    type ParticleStatelessGPUPlan
} from './ParticleStatelessGPUPlan';

const STATELESS_PARAMETER_LAYOUT = createStd140Layout({
    timing: 'vec4',
    identity: 'uvec4',
    emitterPosition: 'vec4',
    output: 'uvec4'
});
const IDENTITY_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

interface StatelessRendererPasses {
    readonly plan: Readonly<ParticleGPUStorageRendererPlan>;
    readonly standard: GPUDrivenRenderPass;
    readonly reversed: GPUDrivenRenderPass;
    readonly parameters: RenderPassParameterPool<ParticleDrawParameters>;
}

function cameraPosition(camera: Camera, target: Float32Array): void {
    const elements = camera.worldMatrix.elements;
    target[0] = elements[12];
    target[1] = elements[13];
    target[2] = elements[14];
    target[3] = camera.depthMode === 'reversed' ? 1 : 0;
}

/** Render-Graph runtime for the bounded no-state WebGPU renderer-data generator. @internal */
export class ParticleStatelessGPUEmitterRuntime {
    readonly compiled: Readonly<ParticleStatelessGPUPlan>;
    readonly #rendererData: StorageBuffer;
    readonly #indirect: StorageBuffer;
    readonly #generatePass: ComputeRenderPass;
    readonly #generateParameters: RenderPassParameterPool<ParticleComputeParameters>;
    readonly #renderers: readonly Readonly<StatelessRendererPasses>[];
    readonly #parameterValues = {
        timing: new Float32Array(4),
        identity: new Uint32Array(4),
        emitterPosition: new Float32Array(4),
        output: new Uint32Array(4)
    };
    readonly #outputFloatValues = new Float32Array(this.#parameterValues.output.buffer);
    readonly #cameraPosition = new Float32Array(4);
    readonly #viewport = new Float32Array(4);
    readonly #ambient = new Float32Array([0, 0, 0, 1]);
    readonly #directionalColors = new Float32Array(16);
    readonly #directionalDirections = new Float32Array(16);
    readonly #seed: number;
    #particleLimit: number;
    #spawnRateScale = 1;
    #generatedFrame = -1;
    #destroyed = false;

    constructor(
        plan: Readonly<ParticleCompiledEmitterPlan>,
        seed: number,
        renderer: RendererContract
    ) {
        if (renderer.backend !== 'webgpu') {
            throw new TypeError('Stateless GPU particles require a WebGPU Renderer');
        }
        this.compiled = compileParticleStatelessGPUPlan(plan);
        this.#seed = seed >>> 0;
        this.#particleLimit = plan.definition.capacity;
        this.#rendererData = renderer.createStorageBuffer({
            label: `${plan.definition.name}:particle-stateless-renderer-data`,
            byteLength: this.compiled.buffers.rendererDataByteLength,
            usage: ['storage'],
            recovery: 'reinitialize'
        });
        this.#indirect = renderer.createStorageBuffer({
            label: `${plan.definition.name}:particle-stateless-indirect`,
            byteLength: this.compiled.buffers.indirectArgumentByteLength,
            usage: ['storage', 'indirect'],
            recovery: 'reinitialize'
        });
        this.#generatePass = new ComputeRenderPass(
            new ComputeKernel({
                shader: this.compiled.generate,
                label: this.compiled.generate.label
            }),
            this.compiled.generate.label
        );
        this.#generateParameters = new RenderPassParameterPool(
            () =>
                new ParticleComputeParameters(
                    2,
                    UniformBuffer.fromSchema(STATELESS_PARAMETER_LAYOUT, this.#parameterValues),
                    this.compiled.workgroupCount
                )
        );
        const spriteSampler = new ComputeSampler({
            label: `${plan.definition.name}:particle-stateless-sampler`,
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'linear'
        });
        this.#renderers = Object.freeze(
            plan.definition.renderers.map(rendererDefinition => {
                if (rendererDefinition.type !== 'sprite') {
                    throw new TypeError('Stateless GPU runtime only supports sprite renderers');
                }
                const rendererPlan = compileParticleGPUStorageRenderer(
                    plan,
                    rendererDefinition,
                    this.compiled.buffers
                );
                const createPass = (reversed: boolean): GPUDrivenRenderPass =>
                    new GPUDrivenRenderPass({
                        name: `${plan.definition.name}:stateless-sprite-${reversed ? 'reversed' : 'standard'}`,
                        shader: rendererPlan.shader,
                        pipelineState: drawPipelineState(rendererDefinition, reversed)
                    });
                const hasTexture =
                    rendererDefinition.texture !== null && rendererDefinition.texture !== undefined;
                return Object.freeze({
                    plan: rendererPlan,
                    standard: createPass(false),
                    reversed: createPass(true),
                    parameters: new RenderPassParameterPool(
                        () =>
                            new ParticleDrawParameters(
                                UniformBuffer.fromSchema(PARTICLE_VIEW_LAYOUT),
                                hasTexture ? spriteSampler : null,
                                null,
                                !(rendererDefinition.depthWrite ?? false)
                            )
                    )
                });
            })
        );
    }

    setBudget(decision: Readonly<ParticleBudgetDecision>): void {
        this.#particleLimit = decision.enabled ? decision.particleLimit : 0;
        this.#spawnRateScale = decision.spawnRateScale;
        this.#generatedFrame = -1;
    }

    /** Re-record generation when the enclosing frame transaction did not submit. */
    frameDiscarded(frameIndex: number): void {
        if (this.#generatedFrame === frameIndex) this.#generatedFrame = -1;
    }

    record(
        context: RenderPipelineContext,
        color: RenderGraphTextureHandle,
        depth: RenderGraphTextureHandle | null,
        system: Node,
        emitterAge: number,
        drawVisible: boolean,
        phase: 'opaque' | 'transparent'
    ): void {
        this.assertAlive();
        if (!drawVisible || phase !== 'transparent') return;
        const rendererData = context.graph.importStorageBuffer(this.#rendererData);
        const indirect = context.graph.importStorageBuffer(this.#indirect);
        if (this.#generatedFrame !== context.frameIndex) {
            const definition = this.compiled.emitter.definition;
            this.#parameterValues.timing.set([
                emitterAge,
                definition.startDelay,
                definition.duration,
                definition.fixedStep
            ]);
            this.#parameterValues.identity.set([
                this.#seed,
                this.compiled.emitter.emitterId,
                definition.looping ? 1 : 0,
                0
            ]);
            if (definition.simulationSpace === 'world') {
                const world = system.worldMatrix.elements;
                this.#parameterValues.emitterPosition.set([world[12], world[13], world[14], 1]);
            } else {
                this.#parameterValues.emitterPosition.set([0, 0, 0, 1]);
            }
            this.#parameterValues.output.set([this.#particleLimit, 0, 0, 0]);
            this.#outputFloatValues[1] = this.#spawnRateScale;
            const generate = context.acquirePassParameters(this.#generateParameters);
            generate.configure([rendererData, indirect]);
            context.graph.addPass(this.#generatePass, generate);
            this.#generatedFrame = context.frameIndex;
        }
        for (const renderer of this.#renderers) {
            if ((renderer.plan.definition.depthTest ?? true) && depth === null) {
                throw new Error('Stateless GPU particle depth testing requires a depth attachment');
            }
            const parameters = context.acquirePassParameters(renderer.parameters);
            this.writeViewUniform(parameters.viewUniform, context, system);
            const texture = renderer.plan.definition.texture;
            parameters.configure(
                [rendererData],
                indirect,
                0,
                color,
                depth,
                texture === null || texture === undefined
                    ? null
                    : context.graph.importTexture(texture),
                context
            );
            context.graph.addPass(
                context.camera.depthMode === 'reversed' ? renderer.reversed : renderer.standard,
                parameters
            );
        }
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#rendererData.destroy();
        this.#indirect.destroy();
    }

    private writeViewUniform(
        uniform: UniformBuffer,
        context: RenderPipelineContext,
        system: Node
    ): void {
        uniform.set('u_viewMatrix', context.camera.viewMatrix.elements);
        uniform.set('u_projectionMatrix', context.camera.jitteredProjectionMatrix.elements);
        uniform.set(
            'u_modelMatrix',
            this.compiled.emitter.definition.simulationSpace === 'local'
                ? system.worldMatrix.elements
                : IDENTITY_MATRIX
        );
        cameraPosition(context.camera, this.#cameraPosition);
        uniform.set('u_cameraPosition', this.#cameraPosition);
        const viewport = context.viewport;
        this.#viewport.set([viewport[0], viewport[1], viewport[2], viewport[3]]);
        uniform.set('u_viewport', this.#viewport);
        uniform.set('u_particleAmbient', this.#ambient);
        uniform.set('u_particleDirectionalColor', this.#directionalColors);
        uniform.set('u_particleDirectionalDirection', this.#directionalDirections);
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Stateless GPU particle runtime is destroyed');
    }
}
