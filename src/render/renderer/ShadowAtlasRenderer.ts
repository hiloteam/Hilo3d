import type { RHIUploadBatch } from '../frame/RHIUploadBatch';
import { RenderGraphFrame, type RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import type { RGPassHandle, RGTextureHandle } from '../graph/RenderGraphResource';
import type { ExternalTextureGraphDependency } from './ExternalTextureBindingRegistry';
import { FrameResourceUseTracker } from './FrameResourceUseTracker';
import type { PreparedDraw } from './PreparedDraw';
import type { RenderTargetGraphBridge } from './RenderTargetGraphBridge';
import type { ResourceRegistry } from './ResourceRegistry';
import type { ShadowAtlasPlan, ShadowAtlasSlice } from './ShadowAtlasPlanner';
import type { ShadowAtlasResourceRecord } from './ShadowAtlasResourceCache';
import type { ShadowAtlasPageRegion } from './ShadowAtlasPageResidency';
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
    /** Clear value matching the shadow cameras' depth convention. */
    readonly depthClearValue?: number;
    /** Physical-index update mask supplied by the submission-aware S0 content cache. */
    readonly dirtySlices?: readonly boolean[] | undefined;
    /** Optional coalesced page update list. Each rectangle records one scissored pass. */
    readonly pageRegions?: readonly Readonly<ShadowAtlasPageRegion>[] | undefined;
    /** Portable depth-only fullscreen draw used to clear one scissored dirty slice. */
    readonly sliceClearDraw?: PreparedDraw | undefined;
}

/** @internal Exact graph resource produced by one shadow-atlas build. */
export interface ShadowAtlasBuildResult {
    readonly passCount: number;
    readonly texture: RGTextureHandle;
}

/**
 * Executes one shared depth-atlas graph for directional, spot, and point-light slices.
 *
 * Legacy callers clear the complete atlas in the first pass. S0 callers instead provide an exact
 * dirty-slice mask and a portable depth-only clear draw; every dirty pass loads the persistent
 * atlas, clears only its viewport/scissor, and preserves all cached slices. This keeps WebGL
 * immediate and WebGPU deferred execution on the same Render Graph/RHI path.
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
    ): Readonly<ShadowAtlasBuildResult> {
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
            let builtPassCount = 0;
            const workCount = options.pageRegions?.length ?? plan.slices.length;
            for (let index = 0; index < workCount; index += 1) {
                const region = options.pageRegions?.[index];
                const sliceIndex = region?.slicePhysicalIndex ?? index;
                const slice = plan.slices[sliceIndex];
                if (slice === undefined)
                    throw new Error('Shadow atlas plan contains a sparse slice');
                if (options.pageRegions === undefined && options.dirtySlices?.[index] === false) {
                    continue;
                }
                const pass = this.passAt(this.#passCursor++);
                pass.reset();
                pass.label = `${options.label ?? 'Shadow atlas'} ${slice.kind} ${String(slice.sliceIndex)}`;
                const usesSliceClear = options.sliceClearDraw !== undefined;
                pass.setDepthStencilAttachment({
                    texture: atlasTexture,
                    ...(!usesSliceClear && builtPassCount === 0
                        ? { depthClearValue: options.depthClearValue ?? 1 }
                        : {}),
                    depthLoadOp: !usesSliceClear && builtPassCount === 0 ? 'clear' : 'load',
                    depthStoreOp: 'store'
                });
                pass.setViewport(slice.viewport);
                pass.setScissor({
                    x: Math.floor(region?.x ?? slice.viewport.x),
                    y: Math.floor(region?.y ?? slice.viewport.y),
                    width: Math.floor(region?.width ?? slice.viewport.width),
                    height: Math.floor(region?.height ?? slice.viewport.height)
                });
                if (previousPass !== null) pass.dependsOn(previousPass);
                if (options.sliceClearDraw !== undefined) {
                    if (meshFrameStarted) pass.addDrawSnapshot(options.sliceClearDraw);
                    else pass.addDraw(options.sliceClearDraw);
                }
                const draws =
                    options.preparer?.prepare(slice) ??
                    options.sliceDraws?.[sliceIndex] ??
                    EMPTY_DRAWS;
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
                builtPassCount++;
            }
            scope.graph.markOutput(atlasTexture);
            return Object.freeze({ passCount: builtPassCount, texture: atlasTexture });
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
        if (
            options.dirtySlices !== undefined &&
            options.dirtySlices.length !== plan.slices.length
        ) {
            throw new RangeError('Shadow dirtySlices must match plan.slices order and count');
        }
        if (options.pageRegions !== undefined) {
            for (const region of options.pageRegions) {
                const slice = plan.slices[region.slicePhysicalIndex];
                if (
                    slice === undefined ||
                    !Number.isSafeInteger(region.pageX) ||
                    !Number.isSafeInteger(region.pageY) ||
                    region.pageX < 0 ||
                    region.pageY < 0 ||
                    !Number.isSafeInteger(region.x) ||
                    !Number.isSafeInteger(region.y) ||
                    !Number.isSafeInteger(region.width) ||
                    !Number.isSafeInteger(region.height) ||
                    region.width <= 0 ||
                    region.height <= 0 ||
                    region.x < slice.viewport.x ||
                    region.y < slice.viewport.y ||
                    region.x + region.width > slice.viewport.x + slice.viewport.width ||
                    region.y + region.height > slice.viewport.y + slice.viewport.height
                ) {
                    throw new RangeError('Shadow page region must fit its physical atlas slice');
                }
            }
        }
        if (
            options.dirtySlices !== undefined &&
            options.sliceClearDraw === undefined &&
            options.dirtySlices.some(dirty => dirty) &&
            options.dirtySlices.some(dirty => !dirty)
        ) {
            throw new TypeError('Partial shadow-atlas updates require a sliceClearDraw');
        }
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('ShadowAtlasRenderer is destroyed');
    }
}
