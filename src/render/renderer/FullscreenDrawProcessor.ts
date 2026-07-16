import type Material from '../../material/Material';
import type Shader from '../../shader/Shader';
import type { RHIUploadBatch } from '../frame/RHIUploadBatch';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RHIBuffer, RHISampler, RHISubmission } from '../rhi/core';
import { FrameResourceUseTracker } from './FrameResourceUseTracker';
import { PipelineResourceCache, type PipelineResourceRecord } from './PipelineResourceCache';
import { PreparedDrawCache, type PreparedDraw, type PreparedDrawUpdate } from './PreparedDraw';
import type { RHIMeshDrawTargetDescriptor } from './RHIDescriptorMapping';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';
import {
    ShaderBindGroupResourceCache,
    type ShaderBindGroupHandleSet,
    type ShaderSampledBindingResources
} from './ShaderBindGroupResourceCache';
import { ShaderArtifactCompiler } from './ShaderArtifactCompiler';
import { ShaderResourceCache } from './ShaderResourceCache';
import { SubmissionResourceTracker } from './SubmissionResourceTracker';

const EMPTY_UNIFORM_BUFFERS: readonly ResourceRegistryHandle<RHIBuffer>[] = Object.freeze([]);
const EMPTY_SAMPLED_RESOURCES: readonly ShaderSampledBindingResources[] = Object.freeze([]);
const EMPTY_VERTEX_LAYOUTS = Object.freeze([]);

interface FullscreenOwnerRecord {
    readonly shader: Shader;
    readonly pipeline: Readonly<PipelineResourceRecord>;
    readonly bindings: Readonly<ShaderBindGroupHandleSet>;
}

export interface FullscreenDrawPrepareOptions {
    readonly owner: object;
    readonly shader: Shader;
    readonly material: Material;
    readonly target: RHIMeshDrawTargetDescriptor;
    /** Handles follow `pipeline.bindingPlan.uniformBlocks` order exactly. */
    readonly uniformBuffers?: readonly ResourceRegistryHandle<RHIBuffer>[];
    /** Resources follow `pipeline.bindingPlan.sampledBindings` order exactly. */
    readonly sampledResources?: readonly Readonly<ShaderSampledBindingResources>[];
}

/**
 * Shared sampler-only/fullscreen draw preparation for post-process and present passes.
 *
 * The shader must derive its triangle from `gl_VertexID` and therefore expose no vertex inputs.
 * Pipelines, reflected bind groups, logical resource lifetime, recovery recipes, and draw packets
 * are shared by WebGL2 and WebGPU; callers only decide which graph texture is read and which
 * attachment is written.
 */
export class FullscreenDrawProcessor {
    readonly compiler: ShaderArtifactCompiler;
    readonly shaders: ShaderResourceCache;
    readonly pipelines: PipelineResourceCache;
    readonly bindGroups: ShaderBindGroupResourceCache;
    readonly resourceUses: FrameResourceUseTracker;
    readonly submissions: SubmissionResourceTracker;
    readonly defaultSampler: ResourceRegistryHandle<RHISampler>;

    readonly #draws: PreparedDrawCache<object>;
    #records = new WeakMap<object, FullscreenOwnerRecord>();
    #pendingOwner: object | null = null;
    #pendingPipeline: Readonly<PipelineResourceRecord> | null = null;
    #destroyed = false;

    readonly #updateDraw: PreparedDrawUpdate = draw => {
        const owner = this.#pendingOwner;
        const pipeline = this.#pendingPipeline;
        if (owner === null || pipeline === null) {
            throw new Error('Fullscreen draw processor lost its pending preparation state');
        }
        draw.setPipeline(this.registry.resolve(pipeline.pipeline));
        for (const group of pipeline.bindingPlan.activeGroupIndices) {
            const bindGroup = this.bindGroups.resolveGroup(owner, group);
            if (bindGroup === null) {
                throw new Error(`Fullscreen draw is missing bind group ${String(group)}`);
            }
            draw.setBindGroup(group, bindGroup);
        }
        draw.setDraw(3);
        draw.setSortKey(0, 0);
    };

    constructor(
        readonly registry: ResourceRegistry,
        compiler = new ShaderArtifactCompiler()
    ) {
        this.compiler = compiler;
        this.shaders = new ShaderResourceCache(registry, compiler);
        this.pipelines = new PipelineResourceCache(registry, this.shaders, compiler);
        this.bindGroups = new ShaderBindGroupResourceCache(registry);
        this.resourceUses = new FrameResourceUseTracker(registry);
        this.submissions = new SubmissionResourceTracker(registry);
        this.defaultSampler = registry.registerSampler({
            label: 'Shared fullscreen linear sampler',
            lifetime: 'persistent',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            addressModeW: 'clamp-to-edge',
            magFilter: 'linear',
            minFilter: 'linear',
            mipmapFilter: 'nearest',
            lodMinClamp: 0,
            lodMaxClamp: 0,
            maxAnisotropy: 1
        });
        this.#draws = new PreparedDrawCache(registry.deviceCapabilities.limits.maxBindGroups, 1);
    }

    get active(): boolean {
        return this.resourceUses.active;
    }

    get destroyed(): boolean {
        return this.#destroyed;
    }

    async initialize(): Promise<void> {
        this.assertAlive();
        if (this.registry.deviceBackend === 'webgpu') await this.compiler.initialize();
    }

    beginFrame(context: RenderGraphFrameContext, uploads: RHIUploadBatch): void {
        this.assertAlive();
        if (
            context.rhi.id !== this.registry.deviceId ||
            context.rhi.backend !== this.registry.deviceBackend ||
            context.rhi.generation !== this.registry.deviceGeneration
        ) {
            throw new Error('Fullscreen draw context belongs to another RHI device generation');
        }
        this.resourceUses.beginFrame(context.frameIndex, uploads);
    }

    prepare(options: Readonly<FullscreenDrawPrepareOptions>): PreparedDraw {
        this.assertAlive();
        if (!this.active) {
            throw new Error('Fullscreen draw processor requires beginFrame before preparation');
        }
        const pipeline = this.prepareGraphPipeline(
            options.shader,
            options.material,
            options.target
        );
        const uniformBuffers = options.uniformBuffers ?? EMPTY_UNIFORM_BUFFERS;
        const sampledResources = options.sampledResources ?? EMPTY_SAMPLED_RESOURCES;
        const bindings = this.bindGroups.prepare(
            options.owner,
            pipeline.bindingLayoutToken,
            pipeline.bindingPlan,
            pipeline.bindGroupLayouts,
            uniformBuffers,
            sampledResources
        );

        this.#pendingOwner = options.owner;
        this.#pendingPipeline = pipeline;
        const draw = this.#draws.prepare(
            options.owner,
            {
                geometry: 0,
                materialVariant: pipeline.shaderToken,
                renderState: pipeline.pipeline.id,
                resourceBindings: bindings.token,
                target: pipeline.pipeline.id,
                deviceGeneration: this.registry.generation
            },
            this.#updateDraw
        );
        this.#records.set(options.owner, {
            shader: options.shader,
            pipeline,
            bindings
        });
        for (const group of bindings.activeGroupIndices) {
            const handle = bindings.groupHandles[group];
            if (handle !== null && handle !== undefined) this.resourceUses.use(handle);
        }
        return draw;
    }

    /** @internal Prepare reusable shader/pipeline state before graph resources are resolved. */
    prepareGraphPipeline(
        shader: Shader,
        material: Material,
        target: RHIMeshDrawTargetDescriptor
    ): Readonly<PipelineResourceRecord> {
        this.assertAlive();
        if (!this.active) {
            throw new Error('Fullscreen draw processor requires beginFrame before preparation');
        }
        const compiled = this.compiler.compile(shader, this.registry.deviceBackend);
        if (compiled.metadata.vertexInputs.length !== 0) {
            throw new TypeError('Fullscreen shaders must not declare vertex inputs');
        }
        this.validateFragmentOutputs(compiled.metadata.fragmentOutputs, target);
        const pipeline = this.pipelines.prepare(shader, EMPTY_VERTEX_LAYOUTS, material, target);
        this.resourceUses.use(pipeline.pipeline);
        return pipeline;
    }

    trackSubmission(frameIndex: number, submission: RHISubmission): Promise<void> {
        this.assertAlive();
        return this.submissions.track(frameIndex, submission);
    }

    waitForIdle(): Promise<void> {
        this.assertAlive();
        return this.submissions.waitForIdle();
    }

    detach(owner: object): boolean {
        this.assertIdle();
        const removed = this.#records.delete(owner);
        this.#draws.delete(owner);
        const bindings = this.bindGroups.detach(owner);
        return removed || bindings;
    }

    /** Registry recovery rebuilds every recipe; the next revision refreshes concrete draw fields. */
    synchronizeAfterRecovery(): void {
        this.assertIdle();
        this.#pendingOwner = null;
        this.#pendingPipeline = null;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.assertIdle();
        if (this.submissions.pendingSubmissionCount !== 0) {
            throw new Error('Cannot destroy fullscreen resources while submissions are in flight');
        }
        this.#records = new WeakMap();
        this.bindGroups.destroy();
        this.pipelines.destroy();
        this.shaders.destroy();
        this.resourceUses.destroy();
        this.submissions.destroy();
        this.registry.release(this.defaultSampler);
        this.#pendingOwner = null;
        this.#pendingPipeline = null;
        this.#destroyed = true;
    }

    private validateFragmentOutputs(
        outputs: readonly { readonly location: number }[],
        target: RHIMeshDrawTargetDescriptor
    ): void {
        if (outputs.length !== target.colorFormats.length) {
            throw new TypeError(
                'Fullscreen fragment outputs must exactly match the target color attachment count'
            );
        }
        for (let index = 0; index < outputs.length; index += 1) {
            if (outputs[index]?.location !== index || target.colorFormats[index] === null) {
                throw new TypeError(
                    'Fullscreen fragment outputs and bound color targets must be continuous from location zero'
                );
            }
        }
    }

    private assertIdle(): void {
        this.assertAlive();
        if (this.active) throw new Error('Fullscreen draw processor is active');
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Fullscreen draw processor is destroyed');
    }
}
