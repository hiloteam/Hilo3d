import type { RHIUploadBatch } from '../frame/RHIUploadBatch';
import { RenderGraphFrame, type RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import type { RGPassHandle } from '../graph/RenderGraphResource';
import type { ExternalTextureGraphDependency } from './ExternalTextureBindingRegistry';
import { FrameResourceUseTracker } from './FrameResourceUseTracker';
import type { PreparedDraw } from './PreparedDraw';
import type { RenderTargetGraphBridge } from './RenderTargetGraphBridge';
import type { ResourceRegistry } from './ResourceRegistry';
import type { ShadowAtlasPlan, ShadowAtlasSlice } from './ShadowAtlasPlanner';
import type { ShadowAtlasResourceRecord } from './ShadowAtlasResourceCache';
import { SubmissionResourceTracker } from './SubmissionResourceTracker';
import { ShadowPassTemplate, SharedDrawPassParameters } from './passes';

const EMPTY_DRAWS: readonly PreparedDraw[] = Object.freeze([]);

export interface ShadowAtlasSlicePreparer<Owner extends object = object> {
    /** Enlist mesh/buffer caches once in the same RenderGraphFrame transaction. */
    begin?(context: RenderGraphFrameContext, uploads: RHIUploadBatch, frameStarted?: boolean): void;
    /** Return draws for this exact atlas slice. The returned storage is consumed immediately. */
    prepare(slice: Readonly<ShadowAtlasSlice<Owner>>): readonly PreparedDraw[];
    /** Current-slice public render-target inputs collected during `prepare()`. */
    readonly sampledGraphDependencies?: readonly ExternalTextureGraphDependency[];
    /** Release slice-local owners no longer referenced by the completed graph build. */
    end?(): void;
}

export interface ShadowAtlasRenderOptions<Owner extends object = object> {
    readonly label?: string;
    /** Prebuilt queues in `plan.slices` order. Mutually exclusive with `preparer`. */
    readonly sliceDraws?: readonly (readonly PreparedDraw[])[];
    readonly preparer?: ShadowAtlasSlicePreparer<Owner>;
}

/**
 * Executes one shared depth-atlas graph for directional, spot, and point-light slices.
 *
 * The first pass clears the complete atlas; following slice passes load it and restrict writes
 * with a viewport/scissor. This avoids backend framebuffer managers and gives WebGL immediate and
 * WebGPU deferred execution the same observable pass ordering.
 */
export class ShadowAtlasRenderer<Owner extends object = object> {
    readonly frame: RenderGraphFrame;
    readonly resourceUses: FrameResourceUseTracker;
    readonly submissions: SubmissionResourceTracker;
    readonly #passes: SharedDrawPassParameters[] = [];
    #passCursor = 0;
    #active = false;
    #destroyed = false;

    constructor(
        readonly registry: ResourceRegistry,
        initialSliceCapacity = 0,
        initialDrawCapacity = 0,
        initialArenaCapacity?: number,
        readonly renderTargetBridge: RenderTargetGraphBridge | null = null
    ) {
        if (!Number.isSafeInteger(initialSliceCapacity) || initialSliceCapacity < 0) {
            throw new RangeError('Shadow renderer slice capacity must be a non-negative integer');
        }
        if (!Number.isSafeInteger(initialDrawCapacity) || initialDrawCapacity < 0) {
            throw new RangeError('Shadow renderer draw capacity must be a non-negative integer');
        }
        this.frame = new RenderGraphFrame(initialArenaCapacity);
        this.resourceUses = new FrameResourceUseTracker(registry);
        this.submissions = new SubmissionResourceTracker(registry);
        for (let index = 0; index < initialSliceCapacity; index += 1) {
            this.#passes.push(
                new SharedDrawPassParameters({ draws: initialDrawCapacity, dependencies: 1 })
            );
        }
    }

    get active(): boolean {
        return this.#active;
    }

    render(
        context: RenderGraphFrameContext,
        atlas: Readonly<ShadowAtlasResourceRecord>,
        plan: Readonly<ShadowAtlasPlan<Owner>>,
        options: Readonly<ShadowAtlasRenderOptions<Owner>> = {}
    ): RGExecutionResult {
        this.beginComposition();
        try {
            const result = this.frame.execute(context, scope => {
                this.build(scope, context, atlas, plan, options);
            });
            void this.submissions.track(context.frameIndex, result.submission);
            return result;
        } finally {
            this.endComposition();
        }
    }

    beginComposition(): void {
        this.assertAlive();
        if (this.#active) throw new Error('Nested ShadowAtlasRenderer execution is not allowed');
        this.#passCursor = 0;
        this.#active = true;
    }

    endComposition(): void {
        this.#active = false;
    }

    /** Add the complete atlas pass sequence to a caller-owned application graph. */
    build(
        scope: RenderGraphFrameBuildScope,
        context: RenderGraphFrameContext,
        atlas: Readonly<ShadowAtlasResourceRecord>,
        plan: Readonly<ShadowAtlasPlan<Owner>>,
        options: Readonly<ShadowAtlasRenderOptions<Owner>> = {},
        meshFrameStarted = false,
        resourceUses: FrameResourceUseTracker = this.resourceUses
    ): number {
        if (!this.#active) throw new Error('Shadow renderer build requires an active composition');
        this.validateInputs(context, atlas, plan, options);
        if (resourceUses === this.resourceUses) {
            resourceUses.beginFrame(context.frameIndex, scope.uploads);
        }
        resourceUses.use(atlas.texture);
        try {
            options.preparer?.begin?.(context, scope.uploads, meshFrameStarted);
            const atlasTexture = scope.graph.importTextureProvider(
                'shadow atlas',
                atlas.textureDescriptor,
                () => this.registry.resolve(atlas.texture),
                'persistent'
            );

            let previousPass: RGPassHandle | null = null;
            for (let index = 0; index < plan.slices.length; index += 1) {
                const slice = plan.slices[index];
                if (slice === undefined)
                    throw new Error('Shadow atlas plan contains a sparse slice');
                const pass = this.passAt(this.#passCursor++);
                pass.reset();
                pass.label = `${options.label ?? 'Shadow atlas'} ${slice.kind} ${String(slice.sliceIndex)}`;
                pass.setDepthStencilAttachment({
                    texture: atlasTexture,
                    ...(index === 0 ? { depthClearValue: 1 } : {}),
                    depthLoadOp: index === 0 ? 'clear' : 'load',
                    depthStoreOp: 'store'
                });
                pass.setViewport(slice.viewport);
                pass.setScissor({
                    x: Math.floor(slice.viewport.x),
                    y: Math.floor(slice.viewport.y),
                    width: Math.floor(slice.viewport.width),
                    height: Math.floor(slice.viewport.height)
                });
                if (previousPass !== null) pass.dependsOn(previousPass);
                const draws =
                    options.preparer?.prepare(slice) ?? options.sliceDraws?.[index] ?? EMPTY_DRAWS;
                for (const draw of draws) {
                    if (meshFrameStarted) pass.addDrawSnapshot(draw);
                    else pass.addDraw(draw);
                }
                const sampledDependencies = options.preparer?.sampledGraphDependencies;
                if (sampledDependencies !== undefined && sampledDependencies.length > 0) {
                    const bridge = this.renderTargetBridge;
                    if (bridge === null) {
                        throw new Error(
                            'Shadow rendering sampled a public render target without a graph bridge'
                        );
                    }
                    bridge.addSampledTextureReads(scope.graph, pass, sampledDependencies);
                }
                previousPass = scope.graph.addPass(ShadowPassTemplate, pass);
            }
            scope.graph.markOutput(atlasTexture);
            return plan.sliceCount;
        } finally {
            options.preparer?.end?.();
        }
    }

    waitForIdle(): Promise<void> {
        this.assertAlive();
        return this.submissions.waitForIdle();
    }

    destroy(): void {
        if (this.#destroyed) return;
        if (this.#active) throw new Error('Cannot destroy an active ShadowAtlasRenderer');
        if (this.submissions.pendingSubmissionCount !== 0) {
            throw new Error('Cannot destroy shadow resources while submissions are in flight');
        }
        for (const pass of this.#passes) pass.reset();
        this.#passes.length = 0;
        this.resourceUses.destroy();
        this.submissions.destroy();
        this.frame.destroy();
        this.#destroyed = true;
    }

    private passAt(index: number): SharedDrawPassParameters {
        let pass = this.#passes[index];
        if (pass === undefined) {
            pass = new SharedDrawPassParameters({ dependencies: 1 });
            this.#passes[index] = pass;
        }
        return pass;
    }

    private validateInputs(
        context: RenderGraphFrameContext,
        atlas: Readonly<ShadowAtlasResourceRecord>,
        plan: Readonly<ShadowAtlasPlan<Owner>>,
        options: Readonly<ShadowAtlasRenderOptions<Owner>>
    ): void {
        if (
            context.rhi.id !== this.registry.deviceId ||
            context.rhi.backend !== this.registry.deviceBackend ||
            context.rhi.generation !== this.registry.deviceGeneration
        ) {
            throw new Error('Shadow atlas context belongs to another RHI device generation');
        }
        this.registry.resolve(atlas.texture);
        if (
            atlas.width !== plan.width ||
            atlas.height !== plan.height ||
            atlas.format !== plan.format
        ) {
            throw new Error('Shadow atlas resource does not match the active plan');
        }
        if (plan.sliceCount === 0 || plan.slices.length !== plan.sliceCount) {
            throw new RangeError('Shadow atlas rendering requires one complete planned slice');
        }
        if (options.preparer !== undefined && options.sliceDraws !== undefined) {
            throw new TypeError('Shadow sliceDraws and preparer are mutually exclusive');
        }
        if (options.sliceDraws !== undefined && options.sliceDraws.length !== plan.slices.length) {
            throw new RangeError('Shadow sliceDraws must match plan.slices order and count');
        }
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('ShadowAtlasRenderer is destroyed');
    }
}
