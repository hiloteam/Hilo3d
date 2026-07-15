import type Mesh from '../../core/Mesh';
import Material from '../../material/Material';
import { RenderFrame, type RenderFrameBuildScope } from '../frame/RenderFrame';
import type { RenderFrameContext } from '../frame/RenderFrameContext';
import type { RGExecutionResult } from '../graph/RenderGraphExecutor';
import {
    RHITextureUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHIColor,
    type RHILoadOp,
    type RHIStoreOp,
    type RHISurface,
    type RHITextureFormat
} from '../rhi/core';
import { assertRHIObjectOwnedBy } from '../rhi/core/RHIValidation';
import { MeshDrawListPlanner, type MeshDrawInstanceBatch } from './MeshDrawListPlanner';
import type { MeshDrawProcessor } from './MeshDrawProcessor';
import type { PreparedDraw } from './PreparedDraw';
import type { RHIMeshDrawTargetDescriptor } from './RHIDescriptorMapping';
import type { RenderTargetGraphBridge } from './RenderTargetGraphBridge';
import { importSurfaceColor, importSurfaceDepthStencil } from './SurfaceGraphBridge';
import { MainPassTemplate, SharedDrawPassParameters, TransparentPassTemplate } from './passes';

const DEFAULT_CLEAR_COLOR: Readonly<RHIColor> = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });
const EMPTY_DRAWS: readonly PreparedDraw[] = Object.freeze([]);
const EMPTY_MESHES: readonly Mesh[] = Object.freeze([]);
const EMPTY_INSTANCE_BATCHES: readonly Readonly<MeshDrawInstanceBatch>[] = Object.freeze([]);

function requireSampleCount(value: number | undefined): number {
    const sampleCount = value ?? 1;
    if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
        throw new RangeError('Forward renderer sample count must be a positive safe integer');
    }
    return sampleCount;
}

function requireDepthStencilFormat(format: RHITextureFormat | null | undefined): void {
    if (
        format !== null &&
        format !== undefined &&
        !rhiTextureFormatHasDepth(format) &&
        !rhiTextureFormatHasStencil(format)
    ) {
        throw new TypeError('Forward renderer depth/stencil attachment requires a depth format');
    }
}

function surfaceHasAcquiredTexture(surface: RHISurface): boolean {
    return surface.state === 'acquired';
}

function forceMaterialOf(processor: MeshDrawProcessor | undefined): Material | null {
    if (processor === undefined) return null;
    const renderer: unknown = Reflect.get(processor, 'renderer');
    if (typeof renderer !== 'object' || renderer === null) return null;
    const material: unknown = Reflect.get(renderer, 'forceMaterial');
    return material instanceof Material ? material : null;
}

export interface ForwardRendererFrameOptions {
    /** Compatibility shorthand for `opaqueDraws`; the two fields are mutually exclusive. */
    readonly draws?: readonly PreparedDraw[];
    readonly opaqueDraws?: readonly PreparedDraw[];
    readonly transparentDraws?: readonly PreparedDraw[];
    /**
     * Caller-owned processor used by the Mesh entry point. Mesh preparation is enlisted in this
     * renderer's RenderFrame upload transaction. PreparedDraw and Mesh fields are mutually
     * exclusive.
     */
    readonly meshProcessor?: MeshDrawProcessor;
    /**
     * Single-list production entry point. Meshes are classified and sorted by the shared planner.
     * This field is mutually exclusive with `meshes`, `opaqueMeshes`, and `transparentMeshes`.
     */
    readonly classifiedMeshes?: readonly Mesh[];
    /** Compatibility shorthand for `opaqueMeshes`; the two fields are mutually exclusive. */
    readonly meshes?: readonly Mesh[];
    readonly opaqueMeshes?: readonly Mesh[];
    readonly transparentMeshes?: readonly Mesh[];
    readonly label?: string;
    readonly sampleCount?: number;
    readonly colorLoadOp?: RHILoadOp;
    readonly colorStoreOp?: RHIStoreOp;
    readonly clearColor?: RHIColor;
    /** Omit or pass null for a color-only pass. */
    readonly depthStencilFormat?: RHITextureFormat | null;
    readonly depthLoadOp?: RHILoadOp;
    readonly depthStoreOp?: RHIStoreOp;
    readonly clearDepth?: number;
    readonly stencilLoadOp?: RHILoadOp;
    readonly stencilStoreOp?: RHIStoreOp;
    readonly clearStencil?: number;
}

/**
 * Shared single-camera forward path. It builds one backend-neutral main pass, acquires the surface
 * only after graph compilation, submits through the selected RHI, and closes the explicit present
 * boundary. Backend drivers do not participate in pass planning or draw iteration.
 */
export class ForwardRenderer {
    readonly frame: RenderFrame;
    readonly #passSets: {
        readonly main: SharedDrawPassParameters;
        readonly transparent: SharedDrawPassParameters;
    }[] = [];
    readonly #meshDrawListPlanner = new MeshDrawListPlanner();
    #passSetCursor = 0;
    #active = false;
    #destroyed = false;

    constructor(
        initialDrawCapacity = 0,
        initialArenaCapacity?: number,
        readonly renderTargetBridge: RenderTargetGraphBridge | null = null
    ) {
        if (!Number.isSafeInteger(initialDrawCapacity) || initialDrawCapacity < 0) {
            throw new RangeError(
                'Forward renderer draw capacity must be a non-negative safe integer'
            );
        }
        this.frame = new RenderFrame(initialArenaCapacity);
        this.#passSets.push({
            main: new SharedDrawPassParameters({
                colorAttachments: 1,
                draws: initialDrawCapacity
            }),
            transparent: new SharedDrawPassParameters({
                colorAttachments: 1,
                draws: initialDrawCapacity
            })
        });
    }

    get active(): boolean {
        return this.#active;
    }

    destroy(): void {
        if (this.#active) throw new Error('Cannot destroy an active ForwardRenderer');
        if (this.#destroyed) return;
        this.#meshDrawListPlanner.reset();
        for (const passes of this.#passSets) {
            passes.main.reset();
            passes.transparent.reset();
        }
        this.#passSets.length = 0;
        this.#destroyed = true;
        this.frame.destroy();
    }

    /** Detach one Mesh from the retained automatic draw-list plan. */
    detachMesh(mesh: Mesh): boolean {
        if (this.#active) throw new Error('Cannot detach a Mesh from an active ForwardRenderer');
        if (this.#destroyed) throw new Error('Cannot detach from a destroyed ForwardRenderer');
        return this.#meshDrawListPlanner.detach(mesh);
    }

    /** Reset automatic Mesh planning while retaining its high-water storage. */
    resetMeshDrawList(): void {
        if (this.#active) throw new Error('Cannot reset an active ForwardRenderer Mesh draw list');
        if (this.#destroyed)
            throw new Error('Cannot reset the Mesh draw list of a destroyed ForwardRenderer');
        this.#meshDrawListPlanner.reset();
    }

    /** Start one outer RenderFrame composition. Every build receives retained pass storage. */
    beginComposition(): void {
        if (this.#active) throw new Error('Nested ForwardRenderer execution is not allowed');
        if (this.#destroyed) throw new Error('Cannot use a destroyed ForwardRenderer');
        this.#passSetCursor = 0;
        this.#active = true;
    }

    endComposition(): void {
        this.#active = false;
    }

    render(
        context: RenderFrameContext,
        surface: RHISurface,
        options: ForwardRendererFrameOptions
    ): RGExecutionResult {
        this.beginComposition();
        try {
            const result = this.frame.execute(context, scope => {
                this.build(scope, context, surface, options);
            });
            if (options.meshProcessor) {
                void options.meshProcessor.trackSubmission(context.frameIndex, result.submission);
            }
            surface.present();
            return result;
        } catch (error) {
            // Acquired surface textures are frame-scoped. Both backends use present as their only
            // portable release boundary, including after an aborted immediate/deferred frame.
            if (surfaceHasAcquiredTexture(surface)) {
                try {
                    surface.present();
                } catch {
                    // Preserve the original frame error.
                }
            }
            throw error;
        } finally {
            this.endComposition();
        }
    }

    /** Add one forward scene to a caller-owned graph without executing or presenting it. */
    build(
        scope: RenderFrameBuildScope,
        context: RenderFrameContext,
        surface: RHISurface,
        options: ForwardRendererFrameOptions,
        meshFrameStarted = false
    ): void {
        if (!this.#active) throw new Error('ForwardRenderer build requires an active composition');
        assertRHIObjectOwnedBy(context.rhi, surface, 'forward renderer surface');
        const configuration = surface.configuration;
        if (surface.state !== 'configured' || configuration === null) {
            throw new Error(`Forward renderer surface is ${surface.state}`);
        }
        const sampleCount = requireSampleCount(options.sampleCount);
        if (options.draws !== undefined && options.opaqueDraws !== undefined) {
            throw new TypeError('Forward renderer draws and opaqueDraws are mutually exclusive');
        }
        if (options.meshes !== undefined && options.opaqueMeshes !== undefined) {
            throw new TypeError('Forward renderer meshes and opaqueMeshes are mutually exclusive');
        }
        const hasClassifiedMeshInput = options.classifiedMeshes !== undefined;
        const hasExplicitMeshInput =
            options.meshes !== undefined ||
            options.opaqueMeshes !== undefined ||
            options.transparentMeshes !== undefined;
        if (hasClassifiedMeshInput && hasExplicitMeshInput) {
            throw new TypeError(
                'Forward renderer classifiedMeshes and explicit Mesh queues are mutually exclusive'
            );
        }
        const hasPreparedDrawInput =
            options.draws !== undefined ||
            options.opaqueDraws !== undefined ||
            options.transparentDraws !== undefined;
        const hasMeshInput = hasClassifiedMeshInput || hasExplicitMeshInput;
        if (hasPreparedDrawInput && hasMeshInput) {
            throw new TypeError(
                'Forward renderer PreparedDraw and Mesh inputs are mutually exclusive'
            );
        }
        if (hasMeshInput && options.meshProcessor === undefined) {
            throw new TypeError('Forward renderer Mesh inputs require a MeshDrawProcessor');
        }
        if (!hasMeshInput && options.meshProcessor !== undefined) {
            throw new TypeError('Forward renderer meshProcessor requires Mesh inputs');
        }
        const opaqueDraws = options.opaqueDraws ?? options.draws ?? EMPTY_DRAWS;
        const transparentDraws = options.transparentDraws ?? EMPTY_DRAWS;
        let opaqueMeshes = options.opaqueMeshes ?? options.meshes ?? EMPTY_MESHES;
        let transparentMeshes = options.transparentMeshes ?? EMPTY_MESHES;
        let instancedBatches = EMPTY_INSTANCE_BATCHES;
        if (options.classifiedMeshes !== undefined) {
            const plan = this.#meshDrawListPlanner.build(
                options.classifiedMeshes,
                forceMaterialOf(options.meshProcessor)
            );
            opaqueMeshes = plan.opaqueMeshes;
            transparentMeshes = plan.transparentMeshes;
            instancedBatches = plan.instancedBatches;
        } else {
            this.#meshDrawListPlanner.reset();
        }
        const meshProcessor = options.meshProcessor;
        let hasTransparentInstanceBatch = false;
        for (const batch of instancedBatches) {
            if (!batch.transparent) continue;
            hasTransparentInstanceBatch = true;
            break;
        }
        const hasTransparentPass =
            meshProcessor === undefined
                ? transparentDraws.length > 0
                : transparentMeshes.length > 0 || hasTransparentInstanceBatch;
        const depthStencilFormat = options.depthStencilFormat;
        requireDepthStencilFormat(depthStencilFormat);
        const meshTarget: RHIMeshDrawTargetDescriptor | null = meshProcessor
            ? {
                  colorFormats: [configuration.format],
                  depthStencilFormat: depthStencilFormat ?? null,
                  sampleCount
              }
            : null;
        const colorLoadOp = options.colorLoadOp ?? 'clear';
        const depthLoadOp = options.depthLoadOp ?? 'clear';
        const stencilLoadOp = options.stencilLoadOp ?? 'clear';
        const passes = this.acquirePassSet();
        const mainPass = passes.main;
        const transparentPass = passes.transparent;

        if (meshProcessor && meshTarget) {
            if (!meshFrameStarted) {
                meshProcessor.beginFrame(scope.context, scope.uploads);
            } else {
                meshProcessor.beginPass?.(context.camera, context.viewport);
            }
        }
        const surfaceTexture = importSurfaceColor(scope.graph, surface);
        const mainColor =
            sampleCount === 1
                ? surfaceTexture
                : scope.graph.createTexture('multisampled main color', {
                      size: {
                          width: configuration.width,
                          height: configuration.height
                      },
                      mipLevelCount: 1,
                      sampleCount,
                      dimension: '2d',
                      viewDimension: '2d',
                      format: configuration.format,
                      usage: RHITextureUsage.RENDER_ATTACHMENT
                  });

        mainPass.reset();
        mainPass.label = options.label ?? 'Forward main pass';
        mainPass.addColorAttachment({
            texture: mainColor,
            ...(sampleCount === 1 ? {} : { resolveTarget: surfaceTexture }),
            loadOp: colorLoadOp,
            storeOp: hasTransparentPass ? 'store' : (options.colorStoreOp ?? 'store'),
            ...(colorLoadOp === 'clear'
                ? { clearValue: options.clearColor ?? DEFAULT_CLEAR_COLOR }
                : {})
        });
        mainPass.setViewport(context.viewport);
        mainPass.setScissor({
            x: Math.floor(context.viewport.x),
            y: Math.floor(context.viewport.y),
            width: Math.floor(context.viewport.width),
            height: Math.floor(context.viewport.height)
        });

        let depthStencil = null;
        if (depthStencilFormat !== null && depthStencilFormat !== undefined) {
            const useSurfaceDepthStencil =
                sampleCount === 1 && configuration.depthStencilFormat === depthStencilFormat;
            depthStencil = useSurfaceDepthStencil
                ? importSurfaceDepthStencil(scope.graph, surface)
                : scope.graph.createTexture('main depth/stencil', {
                      size: { width: configuration.width, height: configuration.height },
                      mipLevelCount: 1,
                      sampleCount,
                      dimension: '2d',
                      viewDimension: '2d',
                      format: depthStencilFormat,
                      usage: RHITextureUsage.RENDER_ATTACHMENT
                  });
            const hasDepth = rhiTextureFormatHasDepth(depthStencilFormat);
            const hasStencil = rhiTextureFormatHasStencil(depthStencilFormat);
            mainPass.setDepthStencilAttachment({
                texture: depthStencil,
                ...(hasDepth
                    ? {
                          depthLoadOp,
                          depthStoreOp: hasTransparentPass
                              ? 'store'
                              : (options.depthStoreOp ?? 'discard'),
                          ...(depthLoadOp === 'clear'
                              ? { depthClearValue: options.clearDepth ?? 1 }
                              : {})
                      }
                    : {}),
                ...(hasStencil
                    ? {
                          stencilLoadOp,
                          stencilStoreOp: hasTransparentPass
                              ? 'store'
                              : (options.stencilStoreOp ?? 'discard'),
                          ...(stencilLoadOp === 'clear'
                              ? { stencilClearValue: options.clearStencil ?? 0 }
                              : {})
                      }
                    : {})
            });
        }
        if (meshProcessor && meshTarget) {
            for (const mesh of opaqueMeshes) {
                const draw = meshProcessor.prepare(mesh, meshTarget);
                if (meshFrameStarted) mainPass.addDrawSnapshot(draw);
                else mainPass.addDraw(draw);
            }
            for (const batch of instancedBatches) {
                if (batch.transparent) continue;
                const draw = meshProcessor.prepareInstancedBatch(batch, batch.meshes, meshTarget);
                if (meshFrameStarted) mainPass.addDrawSnapshot(draw);
                else mainPass.addDraw(draw);
            }
        } else {
            for (const draw of opaqueDraws) mainPass.addDraw(draw);
        }
        if (meshProcessor) this.addSampledTextureReads(scope, mainPass, meshProcessor);
        scope.graph.addPass(MainPassTemplate, mainPass);

        if (hasTransparentPass) {
            transparentPass.reset();
            transparentPass.label = `${options.label ?? 'Forward main pass'} transparent`;
            transparentPass.addColorAttachment({
                texture: mainColor,
                ...(sampleCount === 1 ? {} : { resolveTarget: surfaceTexture }),
                loadOp: 'load',
                storeOp: options.colorStoreOp ?? 'store'
            });
            transparentPass.setViewport(context.viewport);
            transparentPass.setScissor({
                x: Math.floor(context.viewport.x),
                y: Math.floor(context.viewport.y),
                width: Math.floor(context.viewport.width),
                height: Math.floor(context.viewport.height)
            });
            if (
                depthStencil !== null &&
                depthStencilFormat !== null &&
                depthStencilFormat !== undefined
            ) {
                const hasDepth = rhiTextureFormatHasDepth(depthStencilFormat);
                const hasStencil = rhiTextureFormatHasStencil(depthStencilFormat);
                transparentPass.setDepthStencilAttachment({
                    texture: depthStencil,
                    ...(hasDepth
                        ? {
                              depthLoadOp: 'load' as const,
                              depthStoreOp: options.depthStoreOp ?? 'discard'
                          }
                        : {}),
                    ...(hasStencil
                        ? {
                              stencilLoadOp: 'load' as const,
                              stencilStoreOp: options.stencilStoreOp ?? 'discard'
                          }
                        : {})
                });
            }
            if (meshProcessor && meshTarget) {
                meshProcessor.beginPass?.(context.camera, context.viewport);
                for (const mesh of transparentMeshes) {
                    const draw = meshProcessor.prepare(mesh, meshTarget);
                    if (meshFrameStarted) transparentPass.addDrawSnapshot(draw);
                    else transparentPass.addDraw(draw);
                }
                for (const batch of instancedBatches) {
                    if (!batch.transparent) continue;
                    const draw = meshProcessor.prepareInstancedBatch(
                        batch,
                        batch.meshes,
                        meshTarget
                    );
                    if (meshFrameStarted) transparentPass.addDrawSnapshot(draw);
                    else transparentPass.addDraw(draw);
                }
            } else {
                for (const draw of transparentDraws) transparentPass.addDraw(draw);
            }
            if (meshProcessor) this.addSampledTextureReads(scope, transparentPass, meshProcessor);
            scope.graph.addPass(TransparentPassTemplate, transparentPass);
        }
        scope.graph.markOutput(surfaceTexture);
    }

    private acquirePassSet(): {
        readonly main: SharedDrawPassParameters;
        readonly transparent: SharedDrawPassParameters;
    } {
        let passes = this.#passSets[this.#passSetCursor++];
        if (passes === undefined) {
            passes = {
                main: new SharedDrawPassParameters({ colorAttachments: 1 }),
                transparent: new SharedDrawPassParameters({ colorAttachments: 1 })
            };
            this.#passSets.push(passes);
        }
        return passes;
    }

    private addSampledTextureReads(
        scope: RenderFrameBuildScope,
        pass: SharedDrawPassParameters,
        processor: MeshDrawProcessor
    ): void {
        const dependencies = processor.sampledGraphDependencies;
        if (!dependencies?.length) return;
        const bridge = this.renderTargetBridge;
        if (bridge === null) {
            throw new Error(
                'Forward rendering sampled a public render target without a graph bridge'
            );
        }
        bridge.addSampledTextureReads(scope.graph, pass, dependencies);
    }
}
