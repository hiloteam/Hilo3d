import type Mesh from '../../core/Mesh';
import Material from '../../material/MaterialInstance';
import { RenderGraphFrame, type RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import type { RenderGraphBuilder } from '../graph/RenderGraphBuilder';
import type { RGBufferHandle } from '../graph/RenderGraphResource';
import {
    RHIBufferUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHIBuffer,
    type RHIColor,
    type RHIImageDataLayout,
    type RHILoadOp,
    type RHIStoreOp,
    type RHITextureFormat
} from '../rhi/core';
import { assertRHIObjectOwnedBy } from '../rhi/core/RHIValidation';
import type { MeshDrawProcessor } from './MeshDrawProcessor';
import { MeshDrawListPlanner, type MeshDrawInstanceBatch } from './MeshDrawListPlanner';
import type { PreparedDraw } from './PreparedDraw';
import type { RHIMeshDrawTargetDescriptor } from './RHIDescriptorMapping';
import {
    RenderTargetGraphBridge,
    type RenderTargetColorAttachmentCopyPlan,
    type RenderTargetGraphImport
} from './RenderTargetGraphBridge';
import {
    selectRenderTargetMultisampleAttachmentLifetime,
    type RenderTargetResourceCache,
    type RenderTargetResourceDescriptor,
    type RenderTargetResourceRecord
} from './RenderTargetResourceCache';
import type { SubmissionResourceTracker } from './SubmissionResourceTracker';
import { MainPassTemplate, SharedDrawPassParameters, TransparentPassTemplate } from './passes';

const DEFAULT_CLEAR_COLOR: Readonly<RHIColor> = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
const EMPTY_DRAWS: readonly PreparedDraw[] = Object.freeze([]);
const EMPTY_MESHES: readonly Mesh[] = Object.freeze([]);
const EMPTY_INSTANCE_BATCHES: readonly Readonly<MeshDrawInstanceBatch>[] = Object.freeze([]);
const EMPTY_COPY_OPTIONS: Readonly<OffscreenColorAttachmentCopyOptions> = Object.freeze({});

export interface OffscreenRenderTargetColorOperations {
    readonly loadOp?: RHILoadOp;
    readonly storeOp?: RHIStoreOp;
    readonly clearValue?: RHIColor;
}

export interface OffscreenAttachment0CopyOptions {
    /** Omit to allocate/extract COPY_DST staging, plus MAP_READ when the backend supports it. */
    readonly destination?: RHIBuffer;
    readonly label?: string;
}

export interface OffscreenColorAttachmentCopyOptions extends OffscreenAttachment0CopyOptions {
    readonly attachmentIndex?: number;
    /** Top-left texture-space source region. Omitted dimensions extend to the target edge. */
    readonly x?: number;
    readonly y?: number;
    readonly width?: number;
    readonly height?: number;
}

export interface OffscreenRenderTargetFrameOptions {
    /** Compatibility shorthand for `opaqueDraws`; the two fields are mutually exclusive. */
    readonly draws?: readonly PreparedDraw[];
    readonly opaqueDraws?: readonly PreparedDraw[];
    readonly transparentDraws?: readonly PreparedDraw[];
    /** Classifies, sorts, and batches one scene list through the shared mesh planner. */
    readonly classifiedMeshes?: readonly Mesh[];
    /** Compatibility shorthand for `opaqueMeshes`; the two fields are mutually exclusive. */
    readonly meshes?: readonly Mesh[];
    readonly opaqueMeshes?: readonly Mesh[];
    readonly transparentMeshes?: readonly Mesh[];
    /** Required exactly when any Mesh input is present. */
    readonly meshProcessor?: MeshDrawProcessor;
    readonly label?: string;
    /** Per-attachment operations; omitted entries use clear/store defaults. */
    readonly colorOperations?: readonly Readonly<OffscreenRenderTargetColorOperations>[];
    readonly depthLoadOp?: RHILoadOp;
    readonly depthStoreOp?: RHIStoreOp;
    readonly clearDepth?: number;
    readonly stencilLoadOp?: RHILoadOp;
    readonly stencilStoreOp?: RHIStoreOp;
    readonly clearStencil?: number;
    /** `true` allocates staging; an options object can instead import a caller-owned buffer. */
    readonly attachment0Copy?: boolean | Readonly<OffscreenAttachment0CopyOptions>;
    /** General color-attachment readback. Mutually exclusive with the compatibility field above. */
    readonly colorAttachmentCopy?: boolean | Readonly<OffscreenColorAttachmentCopyOptions>;
}

export interface OffscreenColorAttachmentStagingResult {
    readonly buffer: RHIBuffer;
    /** True when ownership of an extracted graph buffer is transferred to the caller. */
    readonly autoAllocated: boolean;
    readonly mapReadSupported: boolean;
    readonly attachmentIndex: number;
    readonly format: RHITextureFormat;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly destinationLayout: Readonly<Required<RHIImageDataLayout>>;
    readonly byteLength: number;
}

/** @deprecated Compatibility name for attachment-zero staging. */
export type OffscreenAttachment0StagingResult = OffscreenColorAttachmentStagingResult;

export interface OffscreenRenderTargetFrameResult {
    readonly execution: RGExecutionResult;
    readonly target: Readonly<RenderTargetResourceRecord>;
    /** The same fence registered once with the shared SubmissionResourceTracker. */
    readonly tracking: Promise<void>;
    readonly colorAttachmentStaging: Readonly<OffscreenColorAttachmentStagingResult> | null;
    readonly attachment0Staging: Readonly<OffscreenColorAttachmentStagingResult> | null;
}

interface NormalizedDrawInputs {
    opaqueDraws: readonly PreparedDraw[];
    transparentDraws: readonly PreparedDraw[];
    opaqueMeshes: readonly Mesh[];
    transparentMeshes: readonly Mesh[];
    instancedBatches: readonly Readonly<MeshDrawInstanceBatch>[];
    meshProcessor: MeshDrawProcessor | null;
    usesMeshes: boolean;
}

interface MutableMeshTargetDescriptor extends RHIMeshDrawTargetDescriptor {
    colorFormats: (RHITextureFormat | null)[];
    depthStencilFormat: RHITextureFormat | null;
    sampleCount: number;
}

function isObjectKey(value: unknown): value is object {
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function forceMaterialOf(processor: MeshDrawProcessor | undefined): Material | null {
    if (processor === undefined) return null;
    const renderer: unknown = Reflect.get(processor, 'renderer');
    if (typeof renderer !== 'object' || renderer === null) return null;
    const material: unknown = Reflect.get(renderer, 'forceMaterial');
    return material instanceof Material ? material : null;
}

function normalizeCopyOptions(
    options: Readonly<OffscreenRenderTargetFrameOptions>
): Readonly<OffscreenColorAttachmentCopyOptions> | null {
    if (options.attachment0Copy !== undefined && options.colorAttachmentCopy !== undefined) {
        throw new TypeError(
            'Offscreen attachment0Copy and colorAttachmentCopy are mutually exclusive'
        );
    }
    const value = options.colorAttachmentCopy ?? options.attachment0Copy;
    if (value === undefined || value === false) return null;
    if (value === true) return EMPTY_COPY_OPTIONS;
    const candidate: unknown = value;
    if (typeof candidate !== 'object' || candidate === null) {
        throw new TypeError('Offscreen color-attachment copy options are invalid');
    }
    return candidate;
}

function normalizeDrawInputs(
    options: Readonly<OffscreenRenderTargetFrameOptions>,
    planner: MeshDrawListPlanner,
    result: NormalizedDrawInputs,
    context: RenderGraphFrameContext
): NormalizedDrawInputs {
    if (options.draws !== undefined && options.opaqueDraws !== undefined) {
        throw new TypeError('Offscreen renderer draws and opaqueDraws are mutually exclusive');
    }
    if (options.meshes !== undefined && options.opaqueMeshes !== undefined) {
        throw new TypeError('Offscreen renderer meshes and opaqueMeshes are mutually exclusive');
    }
    if (
        options.classifiedMeshes !== undefined &&
        (options.meshes !== undefined ||
            options.opaqueMeshes !== undefined ||
            options.transparentMeshes !== undefined)
    ) {
        throw new TypeError(
            'Offscreen renderer classifiedMeshes is mutually exclusive with explicit Mesh queues'
        );
    }
    const hasPreparedInput =
        options.draws !== undefined ||
        options.opaqueDraws !== undefined ||
        options.transparentDraws !== undefined;
    const hasMeshInput =
        options.meshes !== undefined ||
        options.opaqueMeshes !== undefined ||
        options.transparentMeshes !== undefined ||
        options.classifiedMeshes !== undefined;
    if (hasPreparedInput && hasMeshInput) {
        throw new TypeError(
            'Offscreen renderer PreparedDraw and Mesh inputs are mutually exclusive'
        );
    }
    if (hasMeshInput && options.meshProcessor === undefined) {
        throw new TypeError('Offscreen renderer Mesh inputs require a MeshDrawProcessor');
    }
    if (!hasMeshInput && options.meshProcessor !== undefined) {
        throw new TypeError('Offscreen renderer meshProcessor requires Mesh inputs');
    }
    const classified = options.classifiedMeshes;
    let opaqueMeshes = options.opaqueMeshes ?? options.meshes ?? EMPTY_MESHES;
    let transparentMeshes = options.transparentMeshes ?? EMPTY_MESHES;
    let instancedBatches = EMPTY_INSTANCE_BATCHES;
    if (classified === undefined) {
        planner.reset();
    } else {
        const plan = planner.build(
            classified,
            forceMaterialOf(options.meshProcessor),
            true,
            context.camera
        );
        opaqueMeshes = plan.opaqueMeshes;
        transparentMeshes = plan.transparentMeshes;
        instancedBatches = plan.instancedBatches;
    }
    result.opaqueDraws = options.opaqueDraws ?? options.draws ?? EMPTY_DRAWS;
    result.transparentDraws = options.transparentDraws ?? EMPTY_DRAWS;
    result.opaqueMeshes = opaqueMeshes;
    result.transparentMeshes = transparentMeshes;
    result.instancedBatches = instancedBatches;
    result.meshProcessor = options.meshProcessor ?? null;
    result.usesMeshes = hasMeshInput;
    return result;
}

function validatePreparedDraw(
    context: RenderGraphFrameContext,
    draw: PreparedDraw,
    target: Readonly<RenderTargetResourceDescriptor>
): void {
    const pipeline = draw.pipeline;
    assertRHIObjectOwnedBy(context.rhi, pipeline, 'offscreen prepared draw pipeline');
    const targets = pipeline.descriptor.fragment?.targets ?? [];
    if (targets.length !== target.colorFormats.length) {
        throw new Error('PreparedDraw color-target count does not match the offscreen target');
    }
    for (let index = 0; index < target.colorFormats.length; index += 1) {
        if (targets[index]?.format !== target.colorFormats[index]) {
            throw new Error(
                `PreparedDraw color target ${String(index)} does not match the offscreen target`
            );
        }
    }
    if ((pipeline.descriptor.multisample?.count ?? 1) !== (target.sampleCount ?? 1)) {
        throw new Error('PreparedDraw sample count does not match the offscreen target');
    }
    if (
        (pipeline.descriptor.depthStencil?.format ?? null) !== (target.depthStencilFormat ?? null)
    ) {
        throw new Error('PreparedDraw depth/stencil format does not match the offscreen target');
    }
}

function validatePreparedDraws(
    context: RenderGraphFrameContext,
    inputs: Readonly<NormalizedDrawInputs>,
    target: Readonly<RenderTargetResourceDescriptor>
): void {
    for (const draw of inputs.opaqueDraws) validatePreparedDraw(context, draw, target);
    for (const draw of inputs.transparentDraws) validatePreparedDraw(context, draw, target);
}

function validateCopyDestination(
    context: RenderGraphFrameContext,
    destination: RHIBuffer,
    byteLength: number
): void {
    assertRHIObjectOwnedBy(context.rhi, destination, 'offscreen color staging buffer');
    if ((destination.usage & RHIBufferUsage.COPY_DST) === 0) {
        throw new Error('Offscreen color staging buffer lacks COPY_DST usage');
    }
    if (destination.size < byteLength) {
        throw new RangeError('Offscreen color staging buffer is too small');
    }
    if (destination.mapState !== 'unmapped') {
        throw new Error('Offscreen color staging buffer must be unmapped');
    }
}

function addTargetAttachments(
    pass: SharedDrawPassParameters,
    target: Readonly<RenderTargetGraphImport>,
    depthStencilFormat: RHITextureFormat | null,
    options: Readonly<OffscreenRenderTargetFrameOptions>,
    transparent: boolean,
    hasTransparentPass: boolean
): void {
    for (let index = 0; index < target.colorAttachments.length; index += 1) {
        const attachment = target.colorAttachments[index];
        if (attachment === undefined) throw new Error('Offscreen color attachment is missing');
        const operations = options.colorOperations?.[index];
        const loadOp = transparent ? 'load' : (operations?.loadOp ?? 'clear');
        const finalStoreOp =
            operations?.storeOp ?? (target.sampleCount === 4 ? 'discard' : 'store');
        pass.addColorAttachment({
            texture: attachment.texture,
            ...(attachment.resolveTarget === null
                ? {}
                : { resolveTarget: attachment.resolveTarget }),
            loadOp,
            storeOp: !transparent && hasTransparentPass ? 'store' : finalStoreOp,
            ...(loadOp === 'clear'
                ? { clearValue: operations?.clearValue ?? DEFAULT_CLEAR_COLOR }
                : {})
        });
    }

    const depthStencil = target.depthStencilAttachment;
    if (depthStencil === null) return;
    if (depthStencilFormat === null) {
        throw new Error('Offscreen target depth/stencil metadata is inconsistent');
    }
    const depthLoadOp = transparent ? 'load' : (options.depthLoadOp ?? 'clear');
    const stencilLoadOp = transparent ? 'load' : (options.stencilLoadOp ?? 'clear');
    pass.setDepthStencilAttachment({
        texture: depthStencil,
        ...(rhiTextureFormatHasDepth(depthStencilFormat)
            ? {
                  depthLoadOp,
                  depthStoreOp:
                      !transparent && hasTransparentPass
                          ? ('store' as const)
                          : (options.depthStoreOp ?? 'discard'),
                  ...(depthLoadOp === 'clear' ? { depthClearValue: options.clearDepth ?? 1 } : {})
              }
            : {}),
        ...(rhiTextureFormatHasStencil(depthStencilFormat)
            ? {
                  stencilLoadOp,
                  stencilStoreOp:
                      !transparent && hasTransparentPass
                          ? ('store' as const)
                          : (options.stencilStoreOp ?? 'discard'),
                  ...(stencilLoadOp === 'clear'
                      ? { stencilClearValue: options.clearStencil ?? 0 }
                      : {})
              }
            : {})
    });
}

function markStoredTargetOutputs(
    graph: RenderGraphBuilder,
    target: Readonly<RenderTargetGraphImport>,
    depthStencilFormat: RHITextureFormat | null,
    options: Readonly<OffscreenRenderTargetFrameOptions>
): void {
    for (let index = 0; index < target.colorAttachments.length; index += 1) {
        const attachment = target.colorAttachments[index];
        if (attachment === undefined) throw new Error('Offscreen color attachment is missing');
        const storeOp =
            options.colorOperations?.[index]?.storeOp ??
            (target.sampleCount === 4 ? 'discard' : 'store');
        // Resolving produces the single-sampled readable texture even when the multisampled
        // source attachment itself is discarded.
        if (attachment.resolveTarget !== null || storeOp === 'store') {
            graph.markOutput(attachment.readableTexture);
        }
    }

    const depthStencil = target.depthStencilAttachment;
    if (depthStencil === null || depthStencilFormat === null) return;
    const depthAvailable =
        !rhiTextureFormatHasDepth(depthStencilFormat) ||
        (options.depthStoreOp ?? 'discard') === 'store';
    const stencilAvailable =
        !rhiTextureFormatHasStencil(depthStencilFormat) ||
        (options.stencilStoreOp ?? 'discard') === 'store';
    if (depthAvailable && stencilAvailable) graph.markOutput(depthStencil);
}

/**
 * Production offscreen target orchestration shared by WebGL immediate and WebGPU deferred RHI.
 *
 * It owns only reusable frame/pass planning state. Target resources and the submission tracker are
 * caller-owned and must share one ResourceRegistry, which also lets a MeshDrawProcessor enlist its
 * uploads and resource-use transaction in this exact RenderGraphFrame submission.
 */
export class OffscreenRenderTargetRenderer {
    readonly frame: RenderGraphFrame;
    readonly bridge: RenderTargetGraphBridge;
    readonly #opaquePass: SharedDrawPassParameters;
    readonly #transparentPass: SharedDrawPassParameters;
    readonly #meshDrawListPlanner = new MeshDrawListPlanner();
    readonly #drawInputs: NormalizedDrawInputs = {
        opaqueDraws: EMPTY_DRAWS,
        transparentDraws: EMPTY_DRAWS,
        opaqueMeshes: EMPTY_MESHES,
        transparentMeshes: EMPTY_MESHES,
        instancedBatches: EMPTY_INSTANCE_BATCHES,
        meshProcessor: null,
        usesMeshes: false
    };
    readonly #meshColorFormats: (RHITextureFormat | null)[] = [];
    readonly #meshTarget: MutableMeshTargetDescriptor = {
        colorFormats: this.#meshColorFormats,
        depthStencilFormat: null,
        sampleCount: 1
    };
    readonly #compositionPassSets: {
        readonly opaque: SharedDrawPassParameters;
        readonly transparent: SharedDrawPassParameters;
    }[] = [];
    #compositionPassCursor = 0;
    #active = false;
    #destroyed = false;

    constructor(
        readonly resources: RenderTargetResourceCache,
        readonly submissions: SubmissionResourceTracker,
        initialDrawCapacity = 0,
        initialArenaCapacity?: number
    ) {
        if (resources.registry !== submissions.registry) {
            throw new Error(
                'Offscreen target resources and submission tracker must share one registry'
            );
        }
        this.frame = new RenderGraphFrame(initialArenaCapacity);
        this.bridge = new RenderTargetGraphBridge(resources);
        this.#opaquePass = new SharedDrawPassParameters({
            colorAttachments: 2,
            draws: initialDrawCapacity
        });
        this.#transparentPass = new SharedDrawPassParameters({
            colorAttachments: 2,
            draws: initialDrawCapacity
        });
    }

    get active(): boolean {
        return this.#active;
    }

    destroy(): void {
        if (this.#active) throw new Error('Cannot destroy an active OffscreenRenderTargetRenderer');
        if (this.#destroyed) return;
        this.#opaquePass.reset();
        this.#transparentPass.reset();
        this.#meshDrawListPlanner.reset();
        for (const passes of this.#compositionPassSets) {
            passes.opaque.reset();
            passes.transparent.reset();
        }
        this.#compositionPassSets.length = 0;
        this.frame.destroy();
        this.#destroyed = true;
    }

    /** Start a caller-owned RenderGraphFrame composition. */
    beginComposition(): void {
        if (this.#active) throw new Error('Nested offscreen target execution is not allowed');
        if (this.#destroyed)
            throw new Error('Cannot use a destroyed OffscreenRenderTargetRenderer');
        this.#compositionPassCursor = 0;
        this.#active = true;
    }

    endComposition(): void {
        this.#active = false;
    }

    /**
     * Add one target render to a caller-owned graph. Readback extraction remains on `render()`
     * because its result cannot be observed until the outer graph has executed.
     */
    build(
        scope: RenderGraphFrameBuildScope,
        context: RenderGraphFrameContext,
        owner: object,
        targetDescriptor: Readonly<RenderTargetResourceDescriptor>,
        options: Readonly<OffscreenRenderTargetFrameOptions> = {},
        meshFrameStarted = false
    ): Readonly<RenderTargetResourceRecord> {
        if (!this.#active) {
            throw new Error('Offscreen renderer build requires an active composition');
        }
        if (!isObjectKey(owner))
            throw new TypeError('Offscreen render-target owner must be an object');
        if (
            targetDescriptor.colorFormats.length === 0 &&
            (targetDescriptor.depthStencilFormat === null ||
                targetDescriptor.depthStencilFormat === undefined)
        ) {
            throw new RangeError(
                'Offscreen renderer requires at least one color or depth/stencil attachment'
            );
        }
        if (
            targetDescriptor.colorFormats.length >
            this.resources.registry.deviceCapabilities.limits.maxColorAttachments
        ) {
            throw new RangeError('Offscreen renderer exceeds the device color-attachment limit');
        }
        if (
            options.colorOperations !== undefined &&
            options.colorOperations.length > targetDescriptor.colorFormats.length
        ) {
            throw new RangeError('Offscreen color operations exceed the target attachment count');
        }
        if (options.attachment0Copy !== undefined || options.colorAttachmentCopy !== undefined) {
            throw new TypeError(
                'Composed offscreen readback is unavailable until the outer frame has executed'
            );
        }
        this.validateContext(context);
        const inputs = normalizeDrawInputs(
            options,
            this.#meshDrawListPlanner,
            this.#drawInputs,
            context
        );
        if (inputs.meshProcessor !== null) {
            this.validateMeshProcessor(inputs.meshProcessor, context, meshFrameStarted);
        } else validatePreparedDraws(context, inputs, targetDescriptor);

        const multisampleAttachmentLifetime = selectRenderTargetMultisampleAttachmentLifetime(
            targetDescriptor,
            options
        );
        const target = this.resources.prepare(
            owner,
            targetDescriptor,
            multisampleAttachmentLifetime
        );
        const meshTarget = inputs.meshProcessor === null ? null : this.configureMeshTarget(target);
        let hasTransparentInstanceBatch = false;
        for (const batch of inputs.instancedBatches) {
            if (!batch.transparent) continue;
            hasTransparentInstanceBatch = true;
            break;
        }
        const hasTransparentPass = inputs.meshProcessor
            ? inputs.transparentMeshes.length > 0 || hasTransparentInstanceBatch
            : inputs.transparentDraws.length > 0;
        const passes = this.acquireCompositionPassSet();
        if (inputs.meshProcessor !== null) {
            if (!meshFrameStarted) inputs.meshProcessor.beginFrame(context, scope.uploads);
            else inputs.meshProcessor.beginContextPass(context);
        }
        const imported = this.bridge.import(scope.graph, target);
        const opaquePass = passes.opaque;
        opaquePass.reset();
        opaquePass.label = options.label ?? `${target.label} opaque`;
        opaquePass.sideEffect = target.colorAttachments.length === 0;
        addTargetAttachments(
            opaquePass,
            imported,
            target.depthStencilAttachment?.format ?? null,
            options,
            false,
            hasTransparentPass
        );
        this.setFullTargetViewport(opaquePass, target);
        if (inputs.meshProcessor !== null && meshTarget !== null) {
            for (const mesh of inputs.opaqueMeshes) {
                const draw = inputs.meshProcessor.prepare(mesh, meshTarget);
                if (meshFrameStarted) opaquePass.addDrawSnapshot(draw);
                else opaquePass.addDraw(draw);
            }
            for (const batch of inputs.instancedBatches) {
                if (batch.transparent) continue;
                const draw = inputs.meshProcessor.prepareInstancedBatch(
                    batch,
                    batch.meshes,
                    meshTarget
                );
                if (meshFrameStarted) opaquePass.addDrawSnapshot(draw);
                else opaquePass.addDraw(draw);
            }
        } else {
            for (const draw of inputs.opaqueDraws) opaquePass.addDraw(draw);
        }
        if (
            inputs.meshProcessor !== null &&
            inputs.meshProcessor.sampledGraphDependencies.length > 0
        ) {
            this.bridge.addSampledTextureReads(
                scope.graph,
                opaquePass,
                inputs.meshProcessor.sampledGraphDependencies
            );
        }
        scope.graph.addPass(MainPassTemplate, opaquePass);

        if (hasTransparentPass) {
            const transparentPass = passes.transparent;
            transparentPass.reset();
            transparentPass.label = `${options.label ?? target.label} transparent`;
            transparentPass.sideEffect = target.colorAttachments.length === 0;
            addTargetAttachments(
                transparentPass,
                imported,
                target.depthStencilAttachment?.format ?? null,
                options,
                true,
                false
            );
            this.setFullTargetViewport(transparentPass, target);
            if (inputs.meshProcessor !== null && meshTarget !== null) {
                inputs.meshProcessor.beginPass(context.camera, context.viewport);
                for (const mesh of inputs.transparentMeshes) {
                    const draw = inputs.meshProcessor.prepare(mesh, meshTarget);
                    if (meshFrameStarted) transparentPass.addDrawSnapshot(draw);
                    else transparentPass.addDraw(draw);
                }
                for (const batch of inputs.instancedBatches) {
                    if (!batch.transparent) continue;
                    const draw = inputs.meshProcessor.prepareInstancedBatch(
                        batch,
                        batch.meshes,
                        meshTarget
                    );
                    if (meshFrameStarted) transparentPass.addDrawSnapshot(draw);
                    else transparentPass.addDraw(draw);
                }
            } else {
                for (const draw of inputs.transparentDraws) transparentPass.addDraw(draw);
            }
            if (
                inputs.meshProcessor !== null &&
                inputs.meshProcessor.sampledGraphDependencies.length > 0
            ) {
                this.bridge.addSampledTextureReads(
                    scope.graph,
                    transparentPass,
                    inputs.meshProcessor.sampledGraphDependencies
                );
            }
            scope.graph.addPass(TransparentPassTemplate, transparentPass);
        }
        markStoredTargetOutputs(
            scope.graph,
            imported,
            target.depthStencilAttachment?.format ?? null,
            options
        );
        return target;
    }

    render(
        context: RenderGraphFrameContext,
        owner: object,
        targetDescriptor: Readonly<RenderTargetResourceDescriptor>,
        options: Readonly<OffscreenRenderTargetFrameOptions> = {}
    ): Readonly<OffscreenRenderTargetFrameResult> {
        if (this.#active) throw new Error('Nested offscreen target execution is not allowed');
        if (this.#destroyed)
            throw new Error('Cannot use a destroyed OffscreenRenderTargetRenderer');
        if (!isObjectKey(owner))
            throw new TypeError('Offscreen render-target owner must be an object');
        if (
            targetDescriptor.colorFormats.length === 0 &&
            (targetDescriptor.depthStencilFormat === null ||
                targetDescriptor.depthStencilFormat === undefined)
        ) {
            throw new RangeError(
                'Offscreen renderer requires at least one color or depth/stencil attachment'
            );
        }
        if (
            targetDescriptor.colorFormats.length >
            this.resources.registry.deviceCapabilities.limits.maxColorAttachments
        ) {
            throw new RangeError('Offscreen renderer exceeds the device color-attachment limit');
        }
        if (
            options.colorOperations !== undefined &&
            options.colorOperations.length > targetDescriptor.colorFormats.length
        ) {
            throw new RangeError('Offscreen color operations exceed the target attachment count');
        }
        this.validateContext(context);
        const inputs = normalizeDrawInputs(
            options,
            this.#meshDrawListPlanner,
            this.#drawInputs,
            context
        );
        if (inputs.meshProcessor !== null) {
            this.validateMeshProcessor(inputs.meshProcessor, context);
        } else validatePreparedDraws(context, inputs, targetDescriptor);
        const copyOptions = normalizeCopyOptions(options);
        const copyAttachmentIndex = copyOptions?.attachmentIndex ?? 0;
        if (
            copyOptions !== null &&
            (!Number.isSafeInteger(copyAttachmentIndex) ||
                copyAttachmentIndex < 0 ||
                copyAttachmentIndex >= targetDescriptor.colorFormats.length)
        ) {
            throw new RangeError(
                `Offscreen color attachment ${String(copyAttachmentIndex)} does not exist`
            );
        }
        const externalStaging = copyOptions?.destination ?? null;
        if (externalStaging !== null) {
            assertRHIObjectOwnedBy(context.rhi, externalStaging, 'offscreen color staging');
            if ((externalStaging.usage & RHIBufferUsage.COPY_DST) === 0) {
                throw new Error('Offscreen color staging buffer lacks COPY_DST usage');
            }
            if (externalStaging.mapState !== 'unmapped') {
                throw new Error('Offscreen color staging buffer must be unmapped');
            }
        }

        const multisampleAttachmentLifetime = selectRenderTargetMultisampleAttachmentLifetime(
            targetDescriptor,
            options
        );
        this.#active = true;
        let autoStaging: RHIBuffer | null = null;
        try {
            const target = this.resources.prepare(
                owner,
                targetDescriptor,
                multisampleAttachmentLifetime
            );
            const meshTarget =
                inputs.meshProcessor === null ? null : this.configureMeshTarget(target);
            let hasTransparentInstanceBatch = false;
            for (const batch of inputs.instancedBatches) {
                if (!batch.transparent) continue;
                hasTransparentInstanceBatch = true;
                break;
            }
            const hasTransparentPass = inputs.meshProcessor
                ? inputs.transparentMeshes.length > 0 || hasTransparentInstanceBatch
                : inputs.transparentDraws.length > 0;
            const copyState: {
                extractedStaging: RGBufferHandle | null;
                plan: Readonly<RenderTargetColorAttachmentCopyPlan> | null;
            } = { extractedStaging: null, plan: null };
            const execution = this.frame.execute(context, scope => {
                if (inputs.meshProcessor !== null) {
                    inputs.meshProcessor.beginFrame(scope.context, scope.uploads);
                }
                const imported = this.bridge.import(scope.graph, target);
                const opaquePass = this.#opaquePass;
                opaquePass.reset();
                opaquePass.label = options.label ?? `${target.label} opaque`;
                opaquePass.sideEffect = target.colorAttachments.length === 0;
                addTargetAttachments(
                    opaquePass,
                    imported,
                    target.depthStencilAttachment?.format ?? null,
                    options,
                    false,
                    hasTransparentPass
                );
                this.setFullTargetViewport(opaquePass, target);
                if (inputs.meshProcessor !== null && meshTarget !== null) {
                    for (const mesh of inputs.opaqueMeshes) {
                        opaquePass.addDraw(inputs.meshProcessor.prepare(mesh, meshTarget));
                    }
                    for (const batch of inputs.instancedBatches) {
                        if (batch.transparent) continue;
                        opaquePass.addDraw(
                            inputs.meshProcessor.prepareInstancedBatch(
                                batch,
                                batch.meshes,
                                meshTarget
                            )
                        );
                    }
                } else {
                    for (const draw of inputs.opaqueDraws) opaquePass.addDraw(draw);
                }
                if (
                    inputs.meshProcessor !== null &&
                    inputs.meshProcessor.sampledGraphDependencies.length > 0
                ) {
                    this.bridge.addSampledTextureReads(
                        scope.graph,
                        opaquePass,
                        inputs.meshProcessor.sampledGraphDependencies
                    );
                }
                scope.graph.addPass(MainPassTemplate, opaquePass);

                if (hasTransparentPass) {
                    const transparentPass = this.#transparentPass;
                    transparentPass.reset();
                    transparentPass.label = `${options.label ?? target.label} transparent`;
                    transparentPass.sideEffect = target.colorAttachments.length === 0;
                    addTargetAttachments(
                        transparentPass,
                        imported,
                        target.depthStencilAttachment?.format ?? null,
                        options,
                        true,
                        false
                    );
                    this.setFullTargetViewport(transparentPass, target);
                    if (inputs.meshProcessor !== null && meshTarget !== null) {
                        inputs.meshProcessor.beginPass(context.camera, context.viewport);
                        for (const mesh of inputs.transparentMeshes) {
                            transparentPass.addDraw(inputs.meshProcessor.prepare(mesh, meshTarget));
                        }
                        for (const batch of inputs.instancedBatches) {
                            if (!batch.transparent) continue;
                            transparentPass.addDraw(
                                inputs.meshProcessor.prepareInstancedBatch(
                                    batch,
                                    batch.meshes,
                                    meshTarget
                                )
                            );
                        }
                    } else {
                        for (const draw of inputs.transparentDraws) {
                            transparentPass.addDraw(draw);
                        }
                    }
                    if (
                        inputs.meshProcessor !== null &&
                        inputs.meshProcessor.sampledGraphDependencies.length > 0
                    ) {
                        this.bridge.addSampledTextureReads(
                            scope.graph,
                            transparentPass,
                            inputs.meshProcessor.sampledGraphDependencies
                        );
                    }
                    scope.graph.addPass(TransparentPassTemplate, transparentPass);
                }

                markStoredTargetOutputs(
                    scope.graph,
                    imported,
                    target.depthStencilAttachment?.format ?? null,
                    options
                );
                if (copyOptions !== null) {
                    const plan = this.bridge.createColorAttachmentCopyPlan(
                        imported,
                        copyAttachmentIndex,
                        copyOptions
                    );
                    copyState.plan = plan;
                    let destination: RGBufferHandle;
                    if (externalStaging !== null) {
                        validateCopyDestination(context, externalStaging, plan.byteLength);
                        destination = scope.graph.importBuffer(
                            copyOptions.label ??
                                `Offscreen color ${String(copyAttachmentIndex)} staging`,
                            externalStaging
                        );
                    } else {
                        const label =
                            copyOptions.label ??
                            `${target.label} color ${String(copyAttachmentIndex)} readback staging`;
                        destination = scope.graph.createBuffer(label, {
                            label,
                            size: plan.byteLength,
                            usage:
                                RHIBufferUsage.COPY_DST |
                                (context.rhi.capabilities.features.has('buffer-mapping')
                                    ? RHIBufferUsage.MAP_READ
                                    : 0)
                        });
                        scope.graph.extractBuffer(destination);
                        copyState.extractedStaging = destination;
                    }
                    this.bridge.addColorCopyPlanPass(scope.graph, plan, destination);
                }
            });
            let staging: Readonly<OffscreenColorAttachmentStagingResult> | null = null;
            if (copyOptions !== null) {
                const copyPlan = copyState.plan;
                if (copyPlan === null) throw new Error('Offscreen color copy plan was lost');
                const extractedStaging = copyState.extractedStaging;
                const buffer =
                    externalStaging ??
                    (extractedStaging === null
                        ? null
                        : execution.getExtractedBuffer(extractedStaging));
                if (buffer === null) throw new Error('Offscreen color staging was not produced');
                if (externalStaging === null) autoStaging = buffer;
                const color = target.colorAttachments[copyAttachmentIndex];
                if (color === undefined) {
                    throw new Error('Offscreen target color metadata is missing');
                }
                staging = Object.freeze({
                    buffer,
                    autoAllocated: externalStaging === null,
                    mapReadSupported: (buffer.usage & RHIBufferUsage.MAP_READ) !== 0,
                    attachmentIndex: copyAttachmentIndex,
                    format: color.format,
                    x: copyPlan.sourceOrigin.x,
                    y: copyPlan.sourceOrigin.y,
                    width: copyPlan.copySize.width,
                    height: copyPlan.copySize.height,
                    destinationLayout: copyPlan.destinationLayout,
                    byteLength: copyPlan.byteLength
                });
            }

            this.resources.markUsed(target, context.frameIndex);
            const tracking = this.submissions.track(context.frameIndex, execution.submission);
            autoStaging = null;
            return Object.freeze({
                execution,
                target,
                tracking,
                colorAttachmentStaging: staging,
                attachment0Staging: copyAttachmentIndex === 0 ? staging : null
            });
        } catch (error) {
            autoStaging?.destroy();
            throw error;
        } finally {
            this.#active = false;
        }
    }

    private setFullTargetViewport(
        pass: SharedDrawPassParameters,
        target: Readonly<RenderTargetResourceRecord>
    ): void {
        pass.setViewport({
            x: 0,
            y: 0,
            width: target.width,
            height: target.height,
            minDepth: 0,
            maxDepth: 1
        });
        pass.setScissor({ x: 0, y: 0, width: target.width, height: target.height });
    }

    private configureMeshTarget(
        target: Readonly<RenderTargetResourceRecord>
    ): Readonly<RHIMeshDrawTargetDescriptor> {
        const formats = this.#meshColorFormats;
        formats.length = target.colorAttachments.length;
        for (let index = 0; index < target.colorAttachments.length; index += 1) {
            const attachment = target.colorAttachments[index];
            if (attachment === undefined) {
                throw new Error(`Offscreen color attachment ${String(index)} is missing`);
            }
            formats[index] = attachment.format;
        }
        this.#meshTarget.depthStencilFormat = target.depthStencilAttachment?.format ?? null;
        this.#meshTarget.sampleCount = target.sampleCount;
        return this.#meshTarget;
    }

    private validateContext(context: RenderGraphFrameContext): void {
        const registry = this.resources.registry;
        if (registry.state !== 'active') {
            throw new Error(`Offscreen renderer resource registry is ${registry.state}`);
        }
        if (
            context.rhi.id !== registry.deviceId ||
            context.rhi.backend !== registry.deviceBackend ||
            context.rhi.generation !== registry.deviceGeneration
        ) {
            throw new Error('Offscreen frame context belongs to another RHI device generation');
        }
    }

    private acquireCompositionPassSet(): {
        readonly opaque: SharedDrawPassParameters;
        readonly transparent: SharedDrawPassParameters;
    } {
        let passes = this.#compositionPassSets[this.#compositionPassCursor++];
        if (passes === undefined) {
            passes = {
                opaque: new SharedDrawPassParameters({ colorAttachments: 2 }),
                transparent: new SharedDrawPassParameters({ colorAttachments: 2 })
            };
            this.#compositionPassSets.push(passes);
        }
        return passes;
    }

    private validateMeshProcessor(
        processor: MeshDrawProcessor,
        context: RenderGraphFrameContext,
        allowActive = false
    ): void {
        if (
            processor.registry !== this.resources.registry ||
            processor.submissions !== this.submissions
        ) {
            throw new Error(
                'Offscreen MeshDrawProcessor must share the target registry and submission tracker'
            );
        }
        if (processor.renderer !== context.renderer) {
            throw new Error('Offscreen MeshDrawProcessor belongs to another renderer');
        }
        if (processor.destroyed) {
            throw new Error('Offscreen MeshDrawProcessor is destroyed');
        }
        if (processor.active && !allowActive) {
            throw new Error('Offscreen MeshDrawProcessor already has an active frame');
        }
    }
}
