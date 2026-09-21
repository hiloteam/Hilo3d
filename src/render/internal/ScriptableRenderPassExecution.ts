import {
    configureScriptablePass,
    type ScriptablePassAdapterTarget
} from '../pipeline/passes/internal/ScriptablePassAdapter';
import Mesh from '../../core/Mesh';
import StorageGraphicsShader from '../compute/StorageGraphicsShader';
import type { RGPassBuilder, RenderPassTemplate } from '../graph/RenderGraphBuilder';
import type { RGPassContext, RGPrepareContext } from '../graph/RenderGraphExecutor';
import type { RGPassTimestampKind } from '../graph/RenderGraphTimeline';
import type { RGBufferHandle, RGTextureAccessHandle } from '../graph/RenderGraphResource';
import type { RendererViewport } from '../RendererCore';
import {
    RHIBufferUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    validateRHITextureToTextureCopyParameters,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupLayout,
    type RHIBindingResource,
    type RHIBuffer,
    type RHIRenderPassEncoder,
    type RHITexture,
    type RHITextureFormat
} from '../rhi/core';
import type { RendererStorageBuffer } from '../StorageBuffer';
import type { RendererListHandle } from '../pipeline/RendererList';
import type { RenderPipelineCapabilities } from '../pipeline/RenderPipeline';
import type {
    FullscreenRenderPass,
    FullscreenRenderPassParameters
} from '../pipeline/passes/FullscreenRenderPass';
import type {
    ComputeRenderPass,
    ComputeRenderPassParameters
} from '../pipeline/passes/ComputeRenderPass';
import type {
    GPUDrivenRenderPass,
    GPUDrivenRenderPassParameters
} from '../pipeline/passes/GPUDrivenRenderPass';
import type { GPUDrivenRenderBatchPassParameters } from '../pipeline/passes/internal/GPUDrivenRenderBatchPass';
import {
    SCENE_STORAGE_BIND_GROUP,
    type SceneRenderPassParameters,
    type SceneStorageShaderVariant
} from '../pipeline/passes/SceneRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphBufferReadUse,
    RenderGraphBufferWriteUse,
    RenderGraphPassHandle,
    RenderGraphTextureAccessHandle,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    ScriptableRenderCommands,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext,
    ScriptableRenderPrepareContext
} from '../pipeline/ScriptableRenderGraph';
import type { FullscreenDrawProcessor } from '../renderer/FullscreenDrawProcessor';
import type {
    MeshDrawProcessor,
    SceneTexturePreparationState,
    StorageScenePreparationState
} from '../renderer/MeshDrawProcessor';
import type { ComputePipelineResourceCache } from '../renderer/ComputePipelineResourceCache';
import type { ComputeSamplerResourceCache } from '../renderer/ComputeSamplerResourceCache';
import type { GPUDrivenPipelineResourceCache } from '../renderer/GPUDrivenPipelineResourceCache';
import type { ScriptableBindGroupResourceCache } from '../renderer/ScriptableBindGroupResourceCache';
import { PreparedDraw } from '../renderer/PreparedDraw';
import type { PipelineResourceRecord } from '../renderer/PipelineResourceCache';
import type { RHIMeshDrawTargetDescriptor } from '../renderer/RHIDescriptorMapping';
import type { ResourceRegistryHandle } from '../renderer/ResourceRegistry';
import type {
    ScriptableComputeDispatch,
    ScriptableComputeDispatchServices
} from '../renderer/ScriptableComputeDispatch';
import {
    ScriptableGPUDrivenDraw,
    type ScriptableGPUDrivenDrawServices
} from '../renderer/ScriptableGPUDrivenDraw';
import { SharedDrawPassParameters } from '../renderer/passes/SharedDrawPass';
import type {
    MutableRHIViewport,
    TextureAccessRecord,
    BufferRecord
} from './ScriptableRenderPipelineTypes';
import {
    requireRuntimeArray,
    assertSynchronousResult,
    finiteViewport,
    graphBufferUsage,
    normalizeBufferRange
} from './ScriptableRenderPipelineValidation';
import type { ScriptableRenderPipelineResources } from './ScriptableRenderPipelineResources';
import type { ScriptableRenderPipelineContextImpl } from './ScriptableRenderPipelineContext';

interface RendererListRange {
    handle: RendererListHandle;
    start: number;
    count: number;
}

interface MutableCopyCommand {
    sourceHandle: RenderGraphTextureAccessHandle;
    destinationHandle: RenderGraphTextureAccessHandle;
    sourceInternal: RGTextureAccessHandle;
    destinationInternal: RGTextureAccessHandle;
    readonly source: {
        texture: RHITexture | null;
        mipLevel: number;
        readonly origin: { x: number; y: number; z: number };
        aspect: 'all' | 'depth-only' | 'stencil-only';
    };
    readonly destination: {
        texture: RHITexture | null;
        mipLevel: number;
        readonly origin: { x: number; y: number; z: number };
        aspect: 'all' | 'depth-only' | 'stencil-only';
    };
    readonly size: { width: number; height: number; depthOrArrayLayers: number };
}

interface MutableBufferCopyCommand {
    sourceHandle: RenderGraphBufferHandle;
    destinationHandle: RenderGraphBufferHandle;
    sourceInternal: RGBufferHandle;
    destinationInternal: RGBufferHandle;
    source: RHIBuffer | null;
    destination: RHIBuffer | null;
    byteLength: number;
}

interface MutableBufferClearCommand {
    handle: RenderGraphBufferHandle;
    internal: RGBufferHandle;
    buffer: RHIBuffer | null;
    byteOffset: number;
    byteLength: number;
}

interface MutableFrameBindGroupEntry {
    binding: number;
    resource: RHIBindingResource | null;
}

interface MutableFrameBufferBinding {
    buffer: RHIBuffer | null;
}

interface MutableSceneStorageBindingPlan {
    binding: number;
    handle: RGBufferHandle | null;
    byteOffset: number;
    byteLength: number;
    readonly resource: {
        buffer: RHIBuffer | null;
        offset?: number;
        size?: number;
    };
    readonly entry: MutableFrameBindGroupEntry;
}

interface FrameBindGroupScratch {
    readonly entries: MutableFrameBindGroupEntry[];
    readonly entryPool: MutableFrameBindGroupEntry[];
    readonly bufferBindings: MutableFrameBufferBinding[];
    readonly descriptor: {
        readonly label: string;
        readonly lifetime: 'frame';
        layout: RHIBindGroupLayout | null;
        readonly entries: MutableFrameBindGroupEntry[];
    };
    bufferBindingCursor: number;
    bindGroup: RHIBindGroup | null;
}

function createCopyCommand(): MutableCopyCommand {
    return {
        sourceHandle: 0 as RenderGraphTextureAccessHandle,
        destinationHandle: 0 as RenderGraphTextureAccessHandle,
        sourceInternal: 0 as RGTextureAccessHandle,
        destinationInternal: 0 as RGTextureAccessHandle,
        source: {
            texture: null,
            mipLevel: 0,
            origin: { x: 0, y: 0, z: 0 },
            aspect: 'all'
        },
        destination: {
            texture: null,
            mipLevel: 0,
            origin: { x: 0, y: 0, z: 0 },
            aspect: 'all'
        },
        size: { width: 1, height: 1, depthOrArrayLayers: 1 }
    };
}

function createBufferCopyCommand(): MutableBufferCopyCommand {
    return {
        sourceHandle: 0 as RenderGraphBufferHandle,
        destinationHandle: 0 as RenderGraphBufferHandle,
        sourceInternal: 0 as RGBufferHandle,
        destinationInternal: 0 as RGBufferHandle,
        source: null,
        destination: null,
        byteLength: 0
    };
}

function createBufferClearCommand(): MutableBufferClearCommand {
    return {
        handle: 0 as RenderGraphBufferHandle,
        internal: 0 as RGBufferHandle,
        buffer: null,
        byteOffset: 0,
        byteLength: 0
    };
}

function compareFrameBinding(
    first: MutableFrameBindGroupEntry,
    second: MutableFrameBindGroupEntry
): number {
    return first.binding - second.binding;
}

export class ScriptableFullscreenDraw {
    readonly draw: PreparedDraw;
    readonly #inputHandles: RGTextureAccessHandle[] = [];
    readonly #uniformHandles: ResourceRegistryHandle<RHIBuffer>[] = [];
    readonly #groups: (FrameBindGroupScratch | undefined)[] = [];
    #pipeline: Readonly<PipelineResourceRecord> | null = null;
    #frameIndex = -1;

    constructor(maxBindGroups: number) {
        this.draw = new PreparedDraw(maxBindGroups, 1);
    }

    configure(
        pipeline: Readonly<PipelineResourceRecord>,
        inputs: readonly RGTextureAccessHandle[],
        uniformHandles: readonly ResourceRegistryHandle<RHIBuffer>[],
        frameIndex: number
    ): void {
        const plan = pipeline.bindingPlan;
        if (inputs.length !== plan.sampledBindings.length) {
            throw new RangeError(
                `Fullscreen pass requires ${String(plan.sampledBindings.length)} sampled textures`
            );
        }
        if (uniformHandles.length !== plan.uniformBlocks.length) {
            throw new RangeError(
                `Fullscreen pass requires ${String(plan.uniformBlocks.length)} uniform buffers`
            );
        }
        this.#pipeline = pipeline;
        this.#frameIndex = frameIndex;
        this.#inputHandles.length = inputs.length;
        for (let index = 0; index < inputs.length; index += 1) {
            const handle = inputs[index];
            if (handle !== undefined) this.#inputHandles[index] = handle;
        }
        this.#uniformHandles.length = uniformHandles.length;
        for (let index = 0; index < uniformHandles.length; index += 1) {
            const handle = uniformHandles[index];
            if (handle !== undefined) this.#uniformHandles[index] = handle;
        }
    }

    prepare(
        context: RGPrepareContext,
        fullscreen: FullscreenDrawProcessor,
        resources: ScriptableRenderPipelineResources
    ): void {
        this.cleanup(resources);
        const pipeline = this.#pipeline;
        if (pipeline === null) throw new Error('Fullscreen draw pipeline is not configured');
        const registry = fullscreen.registry;
        const plan = pipeline.bindingPlan;
        try {
            for (const groupIndex of plan.activeGroupIndices) {
                const layoutHandle = pipeline.bindGroupLayouts[groupIndex];
                if (layoutHandle === undefined) {
                    throw new Error(`Fullscreen bind group ${String(groupIndex)} lost its layout`);
                }
                const group = this.groupAt(groupIndex);
                group.entries.length = 0;
                group.bufferBindingCursor = 0;
                for (let index = 0; index < plan.uniformBlocks.length; index += 1) {
                    const block = plan.uniformBlocks[index];
                    if (block?.group !== groupIndex) continue;
                    const handle = this.#uniformHandles[index];
                    if (handle === undefined) {
                        throw new Error(`Fullscreen uniform block ${block.name} is missing`);
                    }
                    let binding = group.bufferBindings[group.bufferBindingCursor++];
                    if (binding === undefined) {
                        binding = { buffer: null };
                        group.bufferBindings.push(binding);
                    }
                    binding.buffer = registry.resolve(handle);
                    this.addEntry(group, block.binding, binding as { readonly buffer: RHIBuffer });
                }
                for (let index = 0; index < plan.sampledBindings.length; index += 1) {
                    const sampled = plan.sampledBindings[index];
                    if (sampled?.group !== groupIndex) continue;
                    const handle = this.#inputHandles[index];
                    if (handle === undefined) {
                        throw new Error(`Fullscreen sampled binding ${sampled.name} is missing`);
                    }
                    if (context.getTexture(handle).sampleCount !== 1) {
                        throw new Error('Fullscreen sampled textures must be single-sample');
                    }
                    if (sampled.samplerType === 'comparison') {
                        throw new TypeError(
                            'Fullscreen comparison sampling requires an explicit comparison contract'
                        );
                    }
                    const samplerHandle =
                        sampled.samplerType === 'non-filtering'
                            ? fullscreen.nonFilteringSampler
                            : fullscreen.defaultSampler;
                    const sampler = registry.resolve(samplerHandle);
                    fullscreen.resourceUses.use(samplerHandle);
                    this.addEntry(group, sampled.textureBinding, context.getTextureView(handle));
                    this.addEntry(group, sampled.samplerBinding, sampler);
                }
                group.entries.sort(compareFrameBinding);
                group.descriptor.layout = registry.resolve(layoutHandle);
                const bindGroup = registry.createFrameBindGroup(
                    group.descriptor as RHIBindGroupDescriptor
                );
                group.bindGroup = bindGroup;
                resources.trackFrameBindGroup(bindGroup);
            }
            const resolvedPipeline = registry.resolve(pipeline.pipeline);
            this.draw.beginUpdate();
            this.draw.setPipeline(resolvedPipeline);
            for (const groupIndex of plan.activeGroupIndices) {
                const bindGroup = this.#groups[groupIndex]?.bindGroup;
                if (bindGroup === null || bindGroup === undefined) {
                    throw new Error(`Fullscreen bind group ${String(groupIndex)} was not prepared`);
                }
                this.draw.setBindGroup(groupIndex, bindGroup);
            }
            this.draw.setDraw(3);
            this.draw.setSortKey(0, 0);
            this.draw.finishUpdate({
                geometry: 0,
                materialVariant: pipeline.shaderToken,
                renderState: resolvedPipeline.id,
                resourceBindings: this.#frameIndex,
                target: resolvedPipeline.id,
                deviceGeneration: registry.generation
            });
        } catch (error) {
            this.cleanup(resources);
            throw error;
        }
    }

    cleanup(resources: ScriptableRenderPipelineResources): void {
        for (const group of this.#groups) {
            if (group === undefined) continue;
            const bindGroup = group.bindGroup;
            group.bindGroup = null;
            if (bindGroup !== null) resources.releaseFrameBindGroup(bindGroup);
        }
    }

    private groupAt(index: number): FrameBindGroupScratch {
        let group = this.#groups[index];
        if (group === undefined) {
            const entries: MutableFrameBindGroupEntry[] = [];
            group = {
                entries,
                entryPool: [],
                bufferBindings: [],
                descriptor: {
                    label: `Scriptable fullscreen group ${String(index)}`,
                    lifetime: 'frame',
                    layout: null,
                    entries
                },
                bufferBindingCursor: 0,
                bindGroup: null
            };
            this.#groups[index] = group;
        }
        return group;
    }

    private addEntry(
        group: FrameBindGroupScratch,
        binding: number,
        resource: RHIBindingResource
    ): void {
        const index = group.entries.length;
        let entry = group.entryPool[index];
        if (entry === undefined) {
            entry = { binding, resource };
            group.entryPool.push(entry);
        } else {
            entry.binding = binding;
            entry.resource = resource;
        }
        group.entries.push(entry);
    }
}

type ScriptablePassCallbackLease = object;

class ScriptableRenderPassBuilderLease implements ScriptableRenderPassBuilder {
    readonly #slot: ScriptablePassSlot;
    readonly #lease: ScriptablePassCallbackLease;

    constructor(slot: ScriptablePassSlot, lease: ScriptablePassCallbackLease) {
        this.#slot = slot;
        this.#lease = lease;
        Object.freeze(this);
    }

    readTexture(texture: RenderGraphTextureAccessHandle): void {
        this.#slot.readTextureFromSetup(this.#lease, texture);
    }

    writeStorageTexture(texture: RenderGraphTextureAccessHandle): void {
        this.#slot.writeStorageTextureFromSetup(this.#lease, texture);
    }

    copyTexture(
        source: RenderGraphTextureAccessHandle,
        destination: RenderGraphTextureAccessHandle
    ): void {
        this.#slot.copyTextureFromSetup(this.#lease, source, destination);
    }

    readBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferReadUse): void {
        this.#slot.readBufferFromSetup(this.#lease, buffer, use);
    }

    writeBuffer(buffer: RenderGraphBufferHandle, use: RenderGraphBufferWriteUse): void {
        this.#slot.writeBufferFromSetup(this.#lease, buffer, use);
    }

    readWriteBuffer(buffer: RenderGraphBufferHandle): void {
        this.#slot.readWriteBufferFromSetup(this.#lease, buffer);
    }

    copyBuffer(source: RenderGraphBufferHandle, destination: RenderGraphBufferHandle): void {
        this.#slot.copyBufferFromSetup(this.#lease, source, destination);
    }

    clearBuffer(buffer: RenderGraphBufferHandle, byteOffset?: number, byteLength?: number): void {
        this.#slot.clearBufferFromSetup(this.#lease, buffer, byteOffset, byteLength);
    }

    useColorAttachment(options: Readonly<RenderPipelineColorAttachment>): void {
        this.#slot.useColorAttachmentFromSetup(this.#lease, options);
    }

    useDepthStencilAttachment(options: Readonly<RenderPipelineDepthStencilAttachment>): void {
        this.#slot.useDepthStencilAttachmentFromSetup(this.#lease, options);
    }

    useRendererList(list: RendererListHandle): void {
        this.#slot.useRendererListFromSetup(this.#lease, list);
    }

    dependsOn(pass: RenderGraphPassHandle): void {
        this.#slot.dependsOnFromSetup(this.#lease, pass);
    }

    markSideEffect(): void {
        this.#slot.markSideEffectFromSetup(this.#lease);
    }
}

class ScriptableRenderPrepareContextLease implements ScriptableRenderPrepareContext {
    readonly #slot: ScriptablePassSlot;
    readonly #lease: ScriptablePassCallbackLease;

    constructor(slot: ScriptablePassSlot, lease: ScriptablePassCallbackLease) {
        this.#slot = slot;
        this.#lease = lease;
        Object.freeze(this);
    }

    get capabilities(): RenderPipelineCapabilities {
        return this.#slot.capabilitiesFromPrepare(this.#lease);
    }
}

class ScriptableRenderCommandsLease implements ScriptableRenderCommands {
    readonly #slot: ScriptablePassSlot;
    readonly #lease: ScriptablePassCallbackLease;

    constructor(slot: ScriptablePassSlot, lease: ScriptablePassCallbackLease) {
        this.#slot = slot;
        this.#lease = lease;
        Object.freeze(this);
    }

    setViewport(viewport: RendererViewport): void {
        this.#slot.setViewportFromExecute(this.#lease, viewport);
    }

    setScissor(rect: RendererViewport): void {
        this.#slot.setScissorFromExecute(this.#lease, rect);
    }

    setStencilReference(reference: number): void {
        this.#slot.setStencilReferenceFromExecute(this.#lease, reference);
    }

    drawRendererList(list: RendererListHandle): void {
        this.#slot.drawRendererListFromExecute(this.#lease, list);
    }

    copyTexture(
        source: RenderGraphTextureAccessHandle,
        destination: RenderGraphTextureAccessHandle
    ): void {
        this.#slot.copyTextureFromExecute(this.#lease, source, destination);
    }

    copyBuffer(source: RenderGraphBufferHandle, destination: RenderGraphBufferHandle): void {
        this.#slot.copyBufferFromExecute(this.#lease, source, destination);
    }

    clearBuffer(buffer: RenderGraphBufferHandle, byteOffset?: number, byteLength?: number): void {
        this.#slot.clearBufferFromExecute(this.#lease, buffer, byteOffset, byteLength);
    }
}

class ScriptableRenderPassContextLease implements ScriptableRenderPassContext {
    readonly #commands: ScriptableRenderCommands;
    readonly #slot: ScriptablePassSlot;
    readonly #lease: ScriptablePassCallbackLease;

    constructor(slot: ScriptablePassSlot, lease: ScriptablePassCallbackLease) {
        this.#slot = slot;
        this.#lease = lease;
        this.#commands = new ScriptableRenderCommandsLease(slot, lease);
        Object.freeze(this);
    }

    get commands(): ScriptableRenderCommands {
        this.#slot.assertExecuteLeaseActive(this.#lease);
        return this.#commands;
    }
}

class ScriptableComputeDispatchServiceSlot implements ScriptableComputeDispatchServices {
    #owner: ScriptableRenderPipelineContextImpl | null = null;

    configure(owner: ScriptableRenderPipelineContextImpl): void {
        this.#owner = owner;
    }

    release(): void {
        this.#owner = null;
    }

    get pipelines(): ComputePipelineResourceCache {
        return this.requireOwner().services.getScriptableComputePipelineResources();
    }

    get samplers(): ComputeSamplerResourceCache {
        return this.requireOwner().services.getScriptableComputeSamplerResources();
    }

    get uniformBuffers(): MeshDrawProcessor['buffers'] {
        return this.requireOwner().services.getScriptableMeshProcessor().buffers;
    }

    get resourceUses(): MeshDrawProcessor['resourceUses'] {
        return this.requireOwner().services.getScriptableMeshProcessor().resourceUses;
    }

    get frameBindGroups(): ScriptableRenderPipelineResources {
        return this.requireOwner().resources;
    }

    get bindGroups(): ScriptableBindGroupResourceCache {
        return this.requireOwner().services.getScriptableBindGroupResources();
    }

    private requireOwner(): ScriptableRenderPipelineContextImpl {
        const owner = this.#owner;
        if (owner === null) throw new Error('Compute dispatch services are not configured');
        return owner;
    }
}

class ScriptableGPUDrivenDrawServiceSlot implements ScriptableGPUDrivenDrawServices {
    #owner: ScriptableRenderPipelineContextImpl | null = null;

    configure(owner: ScriptableRenderPipelineContextImpl): void {
        this.#owner = owner;
    }

    release(): void {
        this.#owner = null;
    }

    get pipelines(): GPUDrivenPipelineResourceCache {
        return this.requireOwner().services.getScriptableGPUDrivenPipelineResources();
    }

    get samplers(): ComputeSamplerResourceCache {
        return this.requireOwner().services.getScriptableComputeSamplerResources();
    }

    get uniformBuffers(): MeshDrawProcessor['buffers'] {
        return this.requireOwner().services.getScriptableMeshProcessor().buffers;
    }

    get resourceUses(): MeshDrawProcessor['resourceUses'] {
        return this.requireOwner().services.getScriptableMeshProcessor().resourceUses;
    }

    get frameBindGroups(): ScriptableRenderPipelineResources {
        return this.requireOwner().resources;
    }

    get bindGroups(): ScriptableBindGroupResourceCache {
        return this.requireOwner().services.getScriptableBindGroupResources();
    }

    private requireOwner(): ScriptableRenderPipelineContextImpl {
        const owner = this.#owner;
        if (owner === null) throw new Error('GPU-driven draw services are not configured');
        return owner;
    }
}

export class ScriptablePassSlot implements ScriptablePassAdapterTarget {
    readonly draw = new SharedDrawPassParameters();
    readonly ranges: RendererListRange[] = [];
    readonly sampledHandles = new Set<RenderGraphTextureAccessHandle>();
    readonly sampledInternals = new Map<RenderGraphTextureAccessHandle, RGTextureAccessHandle>();
    readonly attachmentHandles = new Set<RenderGraphTextureAccessHandle>();
    readonly sampledInternalHandles = new Set<RGTextureAccessHandle>();
    readonly storageWriteInternalHandles = new Set<RGTextureAccessHandle>();
    readonly copySourceInternalHandles = new Set<RGTextureAccessHandle>();
    readonly copyDestinationInternalHandles = new Set<RGTextureAccessHandle>();
    readonly attachmentInternalHandles = new Set<RGTextureAccessHandle>();
    readonly rendererListHandles = new Set<RendererListHandle>();
    readonly colorFormats: (RHITextureFormat | null)[] = [];
    readonly targetDescriptor: RHIMeshDrawTargetDescriptor = {
        colorFormats: this.colorFormats,
        depthStencilFormat: null,
        sampleCount: 1
    };
    readonly executionViewport: MutableRHIViewport = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        minDepth: 0,
        maxDepth: 1
    };
    readonly executionScissor = { x: 0, y: 0, width: 1, height: 1 };
    readonly copyCommands: MutableCopyCommand[] = [];
    readonly bufferCopyCommands: MutableBufferCopyCommand[] = [];
    readonly bufferClearCommands: MutableBufferClearCommand[] = [];
    readonly writtenBufferRecords = new Set<BufferRecord>();
    readonly completeBufferRecords = new Set<BufferRecord>();
    readonly completeStorageBufferWrites = new Set<RendererStorageBuffer>();
    readonly partialStorageBufferWrites = new Set<RendererStorageBuffer>();
    readonly #executionFailures: unknown[] = [];
    readonly #computeServices = new ScriptableComputeDispatchServiceSlot();
    readonly #gpuDrivenServices = new ScriptableGPUDrivenDrawServiceSlot();
    readonly template: RenderPassTemplate<ScriptablePassSlot>;

    #owner: ScriptableRenderPipelineContextImpl | null = null;
    #pass: ScriptableRenderPass<object> | null = null;
    #parameters: object | null = null;
    #setupBuilder: RGPassBuilder | null = null;
    #executionContext: RGPassContext | null = null;
    #encoder: RHIRenderPassEncoder | null = null;
    #previousDraw: PreparedDraw | null = null;
    #copyDeclarationCount = 0;
    #bufferCopyDeclarationCount = 0;
    #bufferClearDeclarationCount = 0;
    #rangeCount = 0;
    #hasRasterAttachments = false;
    #hasTargetShape = false;
    #fullscreenDraw: ScriptableFullscreenDraw | null = null;
    #activeFullscreenDraw = false;
    #computeDispatch: ScriptableComputeDispatch | null = null;
    #activeComputeDispatch = false;
    readonly #gpuDrivenDraws: ScriptableGPUDrivenDraw[] = [];
    #gpuDrivenDrawCount = 0;
    #activeGPUDrivenDraw = false;
    #sceneStorageVariant: Readonly<SceneStorageShaderVariant> | null = null;
    #sceneStorageBindingCount = 0;
    readonly #sceneStorageBindGroups: RHIBindGroup[] = [];
    readonly #sceneStorageLayouts: RHIBindGroupLayout[] = [];
    #activeSceneStorage = false;
    #sceneTextureHandle: RGTextureAccessHandle | null = null;
    #sceneTextureBindGroup: RHIBindGroup | null = null;
    #activeSceneTexture = false;
    readonly #sceneTexturePreparation: SceneTexturePreparationState = {
        globalBindGroupLayout: null,
        bindingName: null
    };
    readonly #sceneTextureEntries: MutableFrameBindGroupEntry[] = [
        { binding: 0, resource: null },
        { binding: 1, resource: null }
    ];
    readonly #sceneTextureDescriptor = {
        label: 'Scene pass-global texture',
        lifetime: 'frame' as const,
        layout: null as RHIBindGroupLayout | null,
        entries: this.#sceneTextureEntries
    };
    readonly #sceneStoragePlans: MutableSceneStorageBindingPlan[] = [];
    readonly #sceneStoragePreparation: StorageScenePreparationState = {
        globalBindGroupLayouts: []
    };
    readonly #sceneStorageEntries: MutableFrameBindGroupEntry[] = [];
    readonly #sceneStorageDescriptors: {
        label: string;
        lifetime: 'frame';
        layout: RHIBindGroupLayout | null;
        entries: MutableFrameBindGroupEntry[];
    }[] = [];
    #capabilities: RenderPipelineCapabilities | null = null;
    #activeSetupLease: ScriptablePassCallbackLease | null = null;
    #activePrepareLease: ScriptablePassCallbackLease | null = null;
    #activeExecuteLease: ScriptablePassCallbackLease | null = null;
    readonly #prepareFullscreenDraw = (context: RGPrepareContext): void => {
        const fullscreenDraw = this.#fullscreenDraw;
        if (!this.#activeFullscreenDraw || fullscreenDraw === null) return;
        const owner = this.requireOwner();
        fullscreenDraw.prepare(
            context,
            owner.services.getScriptableFullscreenProcessor(),
            owner.resources
        );
    };
    readonly #prepareGPUDrivenDraw = (context: RGPrepareContext): void => {
        if (!this.#activeGPUDrivenDraw) return;
        for (let index = 0; index < this.#gpuDrivenDrawCount; index += 1) {
            const draw = this.#gpuDrivenDraws[index];
            if (draw === undefined) throw new Error('GPU-driven batch draw is unavailable');
            draw.prepare(context);
        }
    };
    readonly #prepareSceneStorage = (context: RGPrepareContext): void => {
        if (!this.#activeSceneStorage) return;
        this.prepareSceneStorage(context);
    };
    readonly #prepareSceneTexture = (context: RGPrepareContext): void => {
        if (!this.#activeSceneTexture) return;
        this.prepareSceneTexture(context);
    };

    constructor() {
        const getPassName = (): string => this.#pass?.name ?? '<scriptable-pass>';
        this.template = Object.freeze({
            get name(): string {
                return getPassName();
            },
            timestampKind(params: ScriptablePassSlot): RGPassTimestampKind | null {
                return params.timestampKind();
            },
            setup(builder: RGPassBuilder, params: ScriptablePassSlot): void {
                params.setup(builder);
            },
            prepare(context: RGPrepareContext, params: ScriptablePassSlot): void {
                params.prepare(context);
            },
            execute(context: RGPassContext, params: ScriptablePassSlot): void {
                params.execute(context);
            }
        });
    }

    begin(
        owner: ScriptableRenderPipelineContextImpl,
        pass: ScriptableRenderPass<object>,
        parameters: object,
        capabilities: RenderPipelineCapabilities
    ): void {
        this.#owner = owner;
        this.#pass = pass;
        this.#parameters = parameters;
        this.#capabilities = capabilities;
        this.#rangeCount = 0;
        this.#hasRasterAttachments = false;
        this.#hasTargetShape = false;
        this.#activeFullscreenDraw = false;
        this.#activeComputeDispatch = false;
        this.#gpuDrivenDrawCount = 0;
        this.#activeGPUDrivenDraw = false;
        this.#activeSceneStorage = false;
        this.#activeSceneTexture = false;
        this.#sceneTextureHandle = null;
        this.#sceneStorageVariant = null;
        this.#sceneStorageBindingCount = 0;
        this.#sceneStoragePreparation.globalBindGroupLayouts.length = 0;
        this.#sceneTexturePreparation.globalBindGroupLayout = null;
        this.#sceneTexturePreparation.bindingName = null;
        this.#copyDeclarationCount = 0;
        this.#bufferCopyDeclarationCount = 0;
        this.#bufferClearDeclarationCount = 0;
        this.sampledHandles.clear();
        this.sampledInternals.clear();
        this.attachmentHandles.clear();
        this.sampledInternalHandles.clear();
        this.storageWriteInternalHandles.clear();
        this.copySourceInternalHandles.clear();
        this.copyDestinationInternalHandles.clear();
        this.attachmentInternalHandles.clear();
        this.writtenBufferRecords.clear();
        this.completeBufferRecords.clear();
        this.completeStorageBufferWrites.clear();
        this.partialStorageBufferWrites.clear();
        this.rendererListHandles.clear();
        this.colorFormats.length = 0;
        (
            this.targetDescriptor as { depthStencilFormat: RHITextureFormat | null }
        ).depthStencilFormat = null;
        (this.targetDescriptor as { sampleCount: number }).sampleCount = 1;
        this.draw.reset();
        this.draw.label = pass.name;
    }

    releaseFrameReferences(resources: ScriptableRenderPipelineResources): void {
        try {
            try {
                this.#fullscreenDraw?.cleanup(resources);
            } finally {
                try {
                    this.#computeDispatch?.releaseFrameReferences();
                } finally {
                    try {
                        this.releaseGPUDrivenFrameReferences();
                    } finally {
                        try {
                            this.cleanupSceneStorage(resources);
                        } finally {
                            this.cleanupSceneTexture(resources);
                        }
                    }
                }
            }
        } finally {
            for (let index = 0; index < this.#copyDeclarationCount; index += 1) {
                const command = this.copyCommands[index];
                if (command === undefined) continue;
                command.source.texture = null;
                command.destination.texture = null;
            }
            for (let index = 0; index < this.#bufferCopyDeclarationCount; index += 1) {
                const command = this.bufferCopyCommands[index];
                if (command === undefined) continue;
                command.source = null;
                command.destination = null;
            }
            for (let index = 0; index < this.#bufferClearDeclarationCount; index += 1) {
                const command = this.bufferClearCommands[index];
                if (command !== undefined) command.buffer = null;
            }
            this.draw.reset();
            this.#owner = null;
            this.#pass = null;
            this.#parameters = null;
            this.#setupBuilder = null;
            this.#executionContext = null;
            this.#encoder = null;
            this.#previousDraw = null;
            this.#copyDeclarationCount = 0;
            this.#bufferCopyDeclarationCount = 0;
            this.#bufferClearDeclarationCount = 0;
            this.#rangeCount = 0;
            this.writtenBufferRecords.clear();
            this.completeBufferRecords.clear();
            this.completeStorageBufferWrites.clear();
            this.partialStorageBufferWrites.clear();
            this.#activeFullscreenDraw = false;
            this.#activeComputeDispatch = false;
            this.#gpuDrivenDrawCount = 0;
            this.#activeGPUDrivenDraw = false;
            this.#activeSceneStorage = false;
            this.#activeSceneTexture = false;
            this.#sceneTextureHandle = null;
            this.#sceneStorageVariant = null;
            this.#sceneStoragePreparation.globalBindGroupLayouts.length = 0;
            this.#sceneTexturePreparation.globalBindGroupLayout = null;
            this.#sceneTexturePreparation.bindingName = null;
            this.#computeServices.release();
            this.#gpuDrivenServices.release();
            this.#capabilities = null;
            this.#activeSetupLease = null;
            this.#activePrepareLease = null;
            this.#activeExecuteLease = null;
        }
    }

    private setup(builder: RGPassBuilder): void {
        const pass = this.requirePass();
        const parameters = this.requireParameters();
        const lease = Object.freeze({});
        this.#setupBuilder = builder;
        this.#activeSetupLease = lease;
        try {
            assertSynchronousResult(
                `${pass.name}.setup()`,
                pass.setup(new ScriptableRenderPassBuilderLease(this, lease), parameters)
            );
            this.#activeSetupLease = null;
            this.finishSetup(builder);
        } finally {
            this.#activeSetupLease = null;
            this.#setupBuilder = null;
        }
    }

    timestampKind(): RGPassTimestampKind | null {
        if (this.#hasRasterAttachments) return 'render';
        if (this.#activeComputeDispatch) return 'compute';
        return null;
    }

    private finishSetup(builder: RGPassBuilder): void {
        const owner = this.requireOwner();
        if (this.rendererListHandles.size > 0 && !this.#hasRasterAttachments) {
            throw new Error('A pass using renderer lists requires a color or depth attachment');
        }
        if (this.#hasRasterAttachments) this.configureDefaultViewport(owner);
        const pass = this.requirePass();
        configureScriptablePass(pass, this.requireParameters(), this);
        for (const list of this.rendererListHandles) {
            let range = this.ranges[this.#rangeCount];
            if (range === undefined) {
                range = { handle: list, start: 0, count: 0 };
                this.ranges.push(range);
            }
            range.handle = list;
            range.start = this.draw.drawCount;
            owner.appendRendererListDraws(
                list,
                this.draw,
                this.executionViewport,
                this.targetDescriptor,
                this.#sceneStorageVariant,
                this.#sceneStoragePreparation,
                this.#activeSceneTexture ? this.#sceneTexturePreparation : null
            );
            range.count = this.draw.drawCount - range.start;
            this.#rangeCount++;
        }
        this.draw.declare(builder, false);
    }

    configureFullscreen(
        pass: FullscreenRenderPass,
        parameters: FullscreenRenderPassParameters
    ): void {
        const owner = this.requireOwner();
        if (this.rendererListHandles.size !== 0) {
            throw new Error('FullscreenRenderPass cannot declare a renderer list');
        }
        this.#fullscreenDraw = owner.configureFullscreenDraw(
            this.#fullscreenDraw,
            pass,
            parameters,
            this.targetDescriptor,
            this.sampledInternals
        );
        this.#activeFullscreenDraw = true;
        this.draw.addDraw(this.#fullscreenDraw.draw);
        this.draw.setPrepare(this.#prepareFullscreenDraw);
    }

    configureCompute(pass: ComputeRenderPass, parameters: ComputeRenderPassParameters): void {
        const owner = this.requireOwner();
        if (this.#hasRasterAttachments || this.rendererListHandles.size !== 0) {
            throw new Error('ComputeRenderPass cannot declare raster attachments or lists');
        }
        this.#computeServices.configure(owner);
        this.#computeDispatch = owner.configureComputeDispatch(
            this.#computeDispatch,
            pass,
            parameters,
            this.#computeServices
        );
        this.#activeComputeDispatch = true;
    }

    configureGPUDriven(pass: GPUDrivenRenderPass, parameters: GPUDrivenRenderPassParameters): void {
        const owner = this.requireOwner();
        if (!this.#hasRasterAttachments) {
            throw new Error('GPUDrivenRenderPass requires raster attachments');
        }
        if (this.rendererListHandles.size !== 0) {
            throw new Error('GPUDrivenRenderPass cannot declare renderer lists');
        }
        this.#gpuDrivenServices.configure(owner);
        this.addGPUDrivenDraw(owner, pass, parameters);
        this.#activeGPUDrivenDraw = true;
        this.draw.setPrepare(this.#prepareGPUDrivenDraw);
    }

    configureGPUDrivenBatch(parameters: GPUDrivenRenderBatchPassParameters): void {
        const owner = this.requireOwner();
        if (!this.#hasRasterAttachments) {
            throw new Error('GPUDrivenRenderBatchPass requires raster attachments');
        }
        if (this.rendererListHandles.size !== 0) {
            throw new Error('GPUDrivenRenderBatchPass cannot declare renderer lists');
        }
        this.#gpuDrivenServices.configure(owner);
        for (let index = 0; index < parameters.passes.length; index += 1) {
            const drawPass = parameters.passes[index];
            const drawParameters = parameters.parameters[index];
            if (drawPass === undefined || drawParameters === undefined) {
                throw new Error('GPU-driven batch configuration is incomplete');
            }
            this.addGPUDrivenDraw(owner, drawPass, drawParameters);
        }
        this.#activeGPUDrivenDraw = true;
        this.draw.setPrepare(this.#prepareGPUDrivenDraw);
    }

    configureScene(parameters: SceneRenderPassParameters): void {
        const owner = this.requireOwner();
        const variant = parameters.storageShaderVariant;
        const sceneTexture = parameters.ambientOcclusionTexture ?? parameters.opaqueTexture;
        if (variant !== undefined && sceneTexture !== undefined) {
            throw new Error(
                'SceneRenderPass cannot combine a storage shader override with pass-global scene-texture sampling'
            );
        }
        if (variant !== undefined) {
            this.configureSceneStorage(owner, variant);
            this.#activeSceneStorage = true;
            this.draw.setPrepare(this.#prepareSceneStorage);
        }
        if (sceneTexture !== undefined) {
            const texture = this.sampledInternals.get(sceneTexture);
            if (texture === undefined) {
                throw new Error('Pass-global scene texture was not declared during setup');
            }
            this.#sceneTextureHandle = texture;
            this.#sceneTexturePreparation.bindingName =
                parameters.ambientOcclusionTexture === undefined
                    ? 'u_opaqueTexture'
                    : 'u_gtaoTexture';
            this.#activeSceneTexture = true;
            this.draw.setPrepare(this.#prepareSceneTexture);
        }
    }

    commitSetupState(): void {
        const owner = this.requireOwner();
        for (const record of this.completeBufferRecords) record.initialized = true;
        for (const record of this.writtenBufferRecords) {
            const internal = record.internal;
            if (internal === null) throw new Error('Written graph buffer has no internal identity');
            owner.noteBufferWrite(record, internal);
        }
    }

    private configureDefaultViewport(owner: ScriptableRenderPipelineContextImpl): void {
        const dimensions = owner.passAttachmentDimensions(this.attachmentHandles);
        const viewport = owner.rhiViewport;
        const useInvocationViewport =
            dimensions.width === owner.outputWidth && dimensions.height === owner.outputHeight;
        this.executionViewport.x = useInvocationViewport ? viewport.x : 0;
        this.executionViewport.y = useInvocationViewport ? viewport.y : 0;
        this.executionViewport.width = dimensions.width;
        this.executionViewport.height = dimensions.height;
        this.executionViewport.minDepth = 0;
        this.executionViewport.maxDepth = 1;
        this.executionScissor.x = Math.max(0, Math.floor(this.executionViewport.x));
        this.executionScissor.y = Math.max(0, Math.floor(this.executionViewport.y));
        this.executionScissor.width = Math.max(1, Math.floor(this.executionViewport.width));
        this.executionScissor.height = Math.max(1, Math.floor(this.executionViewport.height));
        this.draw.setViewport(this.executionViewport);
        this.draw.setScissor(this.executionScissor);
    }

    private addGPUDrivenDraw(
        owner: ScriptableRenderPipelineContextImpl,
        pass: GPUDrivenRenderPass,
        parameters: GPUDrivenRenderPassParameters
    ): void {
        const retained =
            this.#gpuDrivenDraws[this.#gpuDrivenDrawCount] ?? new ScriptableGPUDrivenDraw();
        this.#gpuDrivenDraws[this.#gpuDrivenDrawCount++] = retained;
        const draw = owner.configureGPUDrivenDraw(
            retained,
            pass,
            parameters,
            this.targetDescriptor,
            this.#gpuDrivenServices
        );
        this.#gpuDrivenDraws[this.#gpuDrivenDrawCount - 1] = draw;
        this.draw.addDraw(draw.draw);
    }

    private cleanupGPUDrivenDraws(): void {
        const resources = this.requireOwner().resources;
        let failure: unknown = null;
        for (let index = 0; index < this.#gpuDrivenDrawCount; index += 1) {
            try {
                this.#gpuDrivenDraws[index]?.cleanup(resources);
            } catch (error) {
                failure =
                    failure === null
                        ? error
                        : new AggregateError(
                              [failure, error],
                              'GPU-driven batch draw cleanup failed',
                              { cause: failure }
                          );
            }
        }
        if (failure !== null) {
            throw failure instanceof Error
                ? failure
                : new Error('GPU-driven batch draw cleanup failed', { cause: failure });
        }
    }

    private releaseGPUDrivenFrameReferences(): void {
        let failure: unknown = null;
        for (let index = 0; index < this.#gpuDrivenDrawCount; index += 1) {
            try {
                this.#gpuDrivenDraws[index]?.releaseFrameReferences();
            } catch (error) {
                failure =
                    failure === null
                        ? error
                        : new AggregateError(
                              [failure, error],
                              'GPU-driven batch frame-reference cleanup failed',
                              { cause: failure }
                          );
            }
        }
        if (failure !== null) {
            throw failure instanceof Error
                ? failure
                : new Error('GPU-driven batch frame-reference cleanup failed', { cause: failure });
        }
    }

    private configureSceneStorage(
        owner: ScriptableRenderPipelineContextImpl,
        variant: Readonly<SceneStorageShaderVariant>
    ): void {
        const pipelines = owner.services.getScriptableGPUDrivenPipelineResources();
        const registry = pipelines.registry;
        if (registry.deviceBackend !== 'webgpu') {
            throw new Error('Scene storage shader variants are supported only by WebGPU');
        }
        const limits = registry.deviceCapabilities.limits;
        if (limits.maxBindGroups <= SCENE_STORAGE_BIND_GROUP) {
            throw new RangeError('Scene storage shader variants require at least four bind groups');
        }
        if (!registry.deviceCapabilities.features.has('storage-buffers')) {
            throw new Error('Scene storage shader variants require storage-buffer support');
        }
        const shaderByMesh = variant.shaderByMesh;
        if (shaderByMesh !== undefined) {
            if (!(shaderByMesh instanceof Map)) {
                throw new TypeError('Scene storage shaderByMesh must be a Map');
            }
            const canonicalStorageBindings = variant.shader.bindings.filter(
                binding => binding.kind === 'read-only-storage-buffer'
            );
            for (const [mesh, shader] of shaderByMesh) {
                if (!(mesh instanceof Mesh)) {
                    throw new TypeError('Scene storage shaderByMesh keys must be Mesh instances');
                }
                if (!(shader instanceof StorageGraphicsShader)) {
                    throw new TypeError(
                        'Scene storage shaderByMesh values must be StorageGraphicsShader instances'
                    );
                }
                const storageBindings = shader.bindings.filter(
                    binding => binding.kind === 'read-only-storage-buffer'
                );
                if (
                    storageBindings.length !== canonicalStorageBindings.length ||
                    storageBindings.some((binding, index) => {
                        const canonical = canonicalStorageBindings[index];
                        if (canonical === undefined) return true;
                        return (
                            binding.name !== canonical.name ||
                            binding.group !== canonical.group ||
                            binding.binding !== canonical.binding
                        );
                    })
                ) {
                    throw new TypeError(
                        `Scene storage shader variant for Mesh ${mesh.id} does not match the canonical readonly-storage ABI`
                    );
                }
            }
        }
        requireRuntimeArray(variant.buffers, 'Scene storage shader variant buffers');
        let storageCount = 0;
        for (const binding of variant.shader.bindings) {
            if (binding.kind === 'read-only-storage-buffer') {
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
                const resource = variant.buffers[storageCount];
                if (resource === undefined) {
                    throw new TypeError(`Scene storage binding ${binding.name} is missing`);
                }
                const resourceByteLength = owner.bufferByteLength(resource.buffer);
                const byteOffset = resource.byteOffset ?? 0;
                const byteLength = resource.byteLength ?? resourceByteLength - byteOffset;
                if (
                    !Number.isSafeInteger(byteOffset) ||
                    !Number.isSafeInteger(byteLength) ||
                    byteOffset < 0 ||
                    byteLength < 1 ||
                    byteOffset + byteLength > resourceByteLength ||
                    byteOffset % 4 !== 0 ||
                    byteLength % 4 !== 0
                ) {
                    throw new RangeError(
                        `Scene storage binding ${binding.name} has an invalid 4-byte-aligned range`
                    );
                }
                const alignment = limits.minStorageBufferOffsetAlignment;
                if (alignment === undefined || byteOffset % alignment !== 0) {
                    throw new RangeError(
                        `Scene storage binding ${binding.name} offset must satisfy minStorageBufferOffsetAlignment`
                    );
                }
                const maximumSize = limits.maxStorageBufferBindingSize;
                if (maximumSize === undefined || byteLength > maximumSize) {
                    throw new RangeError(
                        `Scene storage binding ${binding.name} exceeds maxStorageBufferBindingSize`
                    );
                }
                if (binding.minBindingSize !== undefined && byteLength < binding.minBindingSize) {
                    throw new RangeError(
                        `Scene storage binding ${binding.name} is smaller than minBindingSize`
                    );
                }
                let plan = this.#sceneStoragePlans[storageCount];
                if (plan === undefined) {
                    const entry: MutableFrameBindGroupEntry = {
                        binding: binding.binding,
                        resource: null
                    };
                    plan = {
                        binding: binding.binding,
                        handle: null,
                        byteOffset: 0,
                        byteLength: 0,
                        resource: { buffer: null },
                        entry
                    };
                    this.#sceneStoragePlans.push(plan);
                }
                plan.binding = binding.binding;
                plan.handle = owner.resolveBuffer(resource.buffer, 'storage');
                plan.byteOffset = byteOffset;
                plan.byteLength = byteLength;
                plan.entry.binding = binding.binding;
                this.#sceneStorageEntries[storageCount] = plan.entry;
                storageCount++;
                continue;
            }
            if (binding.kind === 'uniform-buffer' && binding.dynamicOffset === true) {
                throw new TypeError(
                    `Scene uniform binding ${binding.name} cannot use dynamic offsets`
                );
            }
            if (binding.group >= SCENE_STORAGE_BIND_GROUP) {
                throw new TypeError(
                    `Scene ${binding.kind} binding ${binding.name} conflicts with reserved group ${String(SCENE_STORAGE_BIND_GROUP)}`
                );
            }
        }
        if (storageCount === 0) {
            throw new TypeError(
                'Scene storage shader variant requires at least one readonly storage buffer'
            );
        }
        if (variant.buffers.length !== storageCount) {
            throw new RangeError(
                'Scene storage shader variant buffers do not match its positional shader ABI'
            );
        }
        const maximumBindings = limits.maxStorageBuffersPerShaderStage;
        if (maximumBindings === undefined || storageCount > maximumBindings) {
            throw new RangeError(
                'Scene storage shader variant exceeds maxStorageBuffersPerShaderStage'
            );
        }
        this.#sceneStorageEntries.length = storageCount;
        this.#sceneStorageBindingCount = storageCount;
        this.#sceneStorageVariant = variant;
    }

    private prepareSceneStorage(context: RGPrepareContext): void {
        const owner = this.requireOwner();
        const layoutHandles = this.#sceneStoragePreparation.globalBindGroupLayouts;
        if (layoutHandles.length === 0) {
            if (this.draw.drawCount === 0) return;
            throw new Error('Scene storage draw preparation did not produce a global layout');
        }
        if (layoutHandles.length !== this.draw.drawCount) {
            throw new Error('Scene storage draw layouts do not match the prepared draw count');
        }
        this.cleanupSceneStorage(owner.resources);
        const registry = owner.services.getScriptableGPUDrivenPipelineResources().registry;
        for (let index = 0; index < this.#sceneStorageBindingCount; index += 1) {
            const plan = this.#sceneStoragePlans[index];
            if (plan?.handle === null || plan?.handle === undefined) {
                throw new Error(`Scene storage binding ${String(index)} is incomplete`);
            }
            const buffer = context.getBuffer(plan.handle);
            if ((buffer.usage & RHIBufferUsage.STORAGE) === 0) {
                throw new Error(`Scene storage binding ${String(index)} lacks STORAGE usage`);
            }
            if (buffer.mapState !== 'unmapped') {
                throw new Error(`Scene storage binding ${String(index)} must be unmapped`);
            }
            plan.resource.buffer = buffer;
            plan.resource.offset = plan.byteOffset;
            plan.resource.size = plan.byteLength;
            plan.entry.resource = plan.resource as RHIBindingResource;
        }
        for (let drawIndex = 0; drawIndex < layoutHandles.length; drawIndex += 1) {
            const layoutHandle = layoutHandles[drawIndex];
            if (layoutHandle === undefined) {
                throw new Error(`Scene storage draw ${String(drawIndex)} has no layout`);
            }
            const layout = registry.resolve(layoutHandle);
            let layoutIndex = this.#sceneStorageLayouts.indexOf(layout);
            if (layoutIndex < 0) {
                layoutIndex = this.#sceneStorageLayouts.length;
                this.#sceneStorageLayouts.push(layout);
                let descriptor = this.#sceneStorageDescriptors[layoutIndex];
                if (descriptor === undefined) {
                    descriptor = {
                        label: 'Scene pass-global readonly storage',
                        lifetime: 'frame',
                        layout: null,
                        entries: this.#sceneStorageEntries
                    };
                    this.#sceneStorageDescriptors.push(descriptor);
                }
                descriptor.layout = layout;
                const bindGroup = registry.createFrameBindGroup(
                    descriptor as RHIBindGroupDescriptor
                );
                this.#sceneStorageBindGroups.push(bindGroup);
                owner.resources.trackFrameBindGroup(bindGroup);
            }
            const bindGroup = this.#sceneStorageBindGroups[layoutIndex];
            if (bindGroup === undefined) {
                throw new Error(`Scene storage layout ${String(layoutIndex)} has no bind group`);
            }
            this.draw.setPreparedBindGroupForRange(
                drawIndex,
                1,
                SCENE_STORAGE_BIND_GROUP,
                bindGroup
            );
        }
    }

    private cleanupSceneStorage(resources: ScriptableRenderPipelineResources): void {
        for (const bindGroup of this.#sceneStorageBindGroups) {
            resources.releaseFrameBindGroup(bindGroup);
        }
        this.#sceneStorageBindGroups.length = 0;
        this.#sceneStorageLayouts.length = 0;
        for (const descriptor of this.#sceneStorageDescriptors) descriptor.layout = null;
        for (let index = 0; index < this.#sceneStorageBindingCount; index += 1) {
            const plan = this.#sceneStoragePlans[index];
            if (plan === undefined) continue;
            plan.resource.buffer = null;
            plan.entry.resource = null;
        }
    }

    private prepareSceneTexture(context: RGPrepareContext): void {
        const layoutHandle = this.#sceneTexturePreparation.globalBindGroupLayout;
        if (layoutHandle === null) return;
        const textureHandle = this.#sceneTextureHandle;
        if (textureHandle === null) throw new Error('Pass-global scene texture is unavailable');
        this.cleanupSceneTexture(this.requireOwner().resources);
        const fullscreen = this.requireOwner().services.getScriptableFullscreenProcessor();
        const registry = fullscreen.registry;
        const texture = context.getTexture(textureHandle);
        if (texture.sampleCount !== 1) {
            throw new Error('Pass-global scene texture must be single-sample');
        }
        const textureEntry = this.#sceneTextureEntries[0];
        const samplerEntry = this.#sceneTextureEntries[1];
        if (textureEntry === undefined || samplerEntry === undefined) {
            throw new Error('Opaque scene texture bind-group entries are unavailable');
        }
        textureEntry.resource = context.getTextureView(textureHandle);
        samplerEntry.resource = registry.resolve(fullscreen.defaultSampler);
        this.#sceneTextureDescriptor.layout = registry.resolve(layoutHandle);
        const bindGroup = registry.createFrameBindGroup(
            this.#sceneTextureDescriptor as RHIBindGroupDescriptor
        );
        this.#sceneTextureBindGroup = bindGroup;
        this.requireOwner().resources.trackFrameBindGroup(bindGroup);
        this.draw.setPreparedBindGroupForDeferredDraws(SCENE_STORAGE_BIND_GROUP, bindGroup);
    }

    private cleanupSceneTexture(resources: ScriptableRenderPipelineResources): void {
        const bindGroup = this.#sceneTextureBindGroup;
        this.#sceneTextureBindGroup = null;
        const textureEntry = this.#sceneTextureEntries[0];
        const samplerEntry = this.#sceneTextureEntries[1];
        if (textureEntry !== undefined) textureEntry.resource = null;
        if (samplerEntry !== undefined) samplerEntry.resource = null;
        this.#sceneTextureDescriptor.layout = null;
        this.#sceneTexturePreparation.bindingName = null;
        if (bindGroup !== null) resources.releaseFrameBindGroup(bindGroup);
    }

    private prepare(context: RGPrepareContext): void {
        const pass = this.requirePass();
        const parameters = this.requireParameters();
        this.requireOwner().services.recordScriptablePass(1);
        this.prepareTextureCopies(context);
        this.prepareBufferCommands(context);
        if (this.#activeComputeDispatch) {
            const dispatch = this.#computeDispatch;
            if (dispatch === null) throw new Error('Compute dispatch helper is unavailable');
            dispatch.prepare(context);
        }
        if (pass.prepare !== undefined) {
            const lease = Object.freeze({});
            this.#activePrepareLease = lease;
            try {
                assertSynchronousResult(
                    `${pass.name}.prepare()`,
                    pass.prepare(new ScriptableRenderPrepareContextLease(this, lease), parameters)
                );
            } finally {
                this.#activePrepareLease = null;
            }
        }
        if (this.#hasRasterAttachments) this.draw.prepareForExecute(context, pass.name);
    }

    private execute(context: RGPassContext): void {
        const pass = this.requirePass();
        const parameters = this.requireParameters();
        this.#executionContext = context;
        this.#previousDraw = null;
        this.#encoder = this.#hasRasterAttachments ? this.draw.beginExecute(context) : null;
        const failures = this.#executionFailures;
        failures.length = 0;
        const lease = Object.freeze({});
        this.#activeExecuteLease = lease;
        try {
            try {
                assertSynchronousResult(
                    `${pass.name}.execute()`,
                    pass.execute(new ScriptableRenderPassContextLease(this, lease), parameters)
                );
            } finally {
                this.#activeExecuteLease = null;
            }
            if (this.#activeFullscreenDraw) {
                const encoder = this.requireRasterEncoder();
                this.#previousDraw = this.draw.executeDrawRange(
                    encoder,
                    0,
                    this.draw.drawCount,
                    this.#previousDraw
                );
            }
            if (this.#activeGPUDrivenDraw) {
                const encoder = this.requireRasterEncoder();
                this.#previousDraw = this.draw.executeDrawRange(
                    encoder,
                    0,
                    this.draw.drawCount,
                    this.#previousDraw
                );
            }
            if (this.#activeComputeDispatch) {
                const dispatch = this.#computeDispatch;
                if (dispatch === null) throw new Error('Compute dispatch helper is unavailable');
                dispatch.execute(context);
            }
            this.stageCompleteStorageBufferWrites();
        } catch (error) {
            failures.push(error);
        }
        const encoder = this.#encoder;
        this.#encoder = null;
        this.#executionContext = null;
        this.#previousDraw = null;
        if (encoder !== null) {
            try {
                this.draw.endExecute(encoder);
            } catch (error) {
                failures.push(error);
            }
            if (this.#activeFullscreenDraw) {
                try {
                    this.#fullscreenDraw?.cleanup(this.requireOwner().resources);
                } catch (error) {
                    failures.push(error);
                }
            }
            if (this.#activeGPUDrivenDraw) {
                try {
                    this.cleanupGPUDrivenDraws();
                } catch (error) {
                    failures.push(error);
                }
            }
            if (this.#activeSceneStorage) {
                try {
                    this.cleanupSceneStorage(this.requireOwner().resources);
                } catch (error) {
                    failures.push(error);
                }
            }
        }
        if (failures.length === 1) {
            const failure = failures[0];
            failures.length = 0;
            throw failure;
        }
        if (failures.length > 1) {
            const failure = new AggregateError(
                failures,
                `${pass.name} execution and cleanup failed`,
                {
                    cause: failures[0]
                }
            );
            failures.length = 0;
            throw failure;
        }
    }

    readTextureFromSetup(
        lease: ScriptablePassCallbackLease,
        texture: RenderGraphTextureAccessHandle
    ): void {
        this.assertSetupLeaseActive(lease);
        this.readTexture(texture);
    }

    writeStorageTextureFromSetup(
        lease: ScriptablePassCallbackLease,
        texture: RenderGraphTextureAccessHandle
    ): void {
        this.assertSetupLeaseActive(lease);
        this.writeStorageTexture(texture);
    }

    copyTextureFromSetup(
        lease: ScriptablePassCallbackLease,
        source: RenderGraphTextureAccessHandle,
        destination: RenderGraphTextureAccessHandle
    ): void {
        this.assertSetupLeaseActive(lease);
        this.declareTextureCopy(source, destination);
    }

    readBufferFromSetup(
        lease: ScriptablePassCallbackLease,
        buffer: RenderGraphBufferHandle,
        use: RenderGraphBufferReadUse
    ): void {
        this.assertSetupLeaseActive(lease);
        this.readBuffer(buffer, use);
    }

    writeBufferFromSetup(
        lease: ScriptablePassCallbackLease,
        buffer: RenderGraphBufferHandle,
        use: RenderGraphBufferWriteUse
    ): void {
        this.assertSetupLeaseActive(lease);
        this.writeBuffer(buffer, use);
    }

    readWriteBufferFromSetup(
        lease: ScriptablePassCallbackLease,
        buffer: RenderGraphBufferHandle
    ): void {
        this.assertSetupLeaseActive(lease);
        this.readWriteBuffer(buffer);
    }

    copyBufferFromSetup(
        lease: ScriptablePassCallbackLease,
        source: RenderGraphBufferHandle,
        destination: RenderGraphBufferHandle
    ): void {
        this.assertSetupLeaseActive(lease);
        this.declareBufferCopy(source, destination);
    }

    clearBufferFromSetup(
        lease: ScriptablePassCallbackLease,
        buffer: RenderGraphBufferHandle,
        byteOffset?: number,
        byteLength?: number
    ): void {
        this.assertSetupLeaseActive(lease);
        this.declareBufferClear(buffer, byteOffset, byteLength);
    }

    useColorAttachmentFromSetup(
        lease: ScriptablePassCallbackLease,
        options: Readonly<RenderPipelineColorAttachment>
    ): void {
        this.assertSetupLeaseActive(lease);
        this.useColorAttachment(options);
    }

    useDepthStencilAttachmentFromSetup(
        lease: ScriptablePassCallbackLease,
        options: Readonly<RenderPipelineDepthStencilAttachment>
    ): void {
        this.assertSetupLeaseActive(lease);
        this.useDepthStencilAttachment(options);
    }

    useRendererListFromSetup(lease: ScriptablePassCallbackLease, list: RendererListHandle): void {
        this.assertSetupLeaseActive(lease);
        this.useRendererList(list);
    }

    dependsOnFromSetup(lease: ScriptablePassCallbackLease, pass: RenderGraphPassHandle): void {
        this.assertSetupLeaseActive(lease);
        this.dependsOn(pass);
    }

    markSideEffectFromSetup(lease: ScriptablePassCallbackLease): void {
        this.assertSetupLeaseActive(lease);
        this.markSideEffect();
    }

    capabilitiesFromPrepare(lease: ScriptablePassCallbackLease): RenderPipelineCapabilities {
        if (this.#activePrepareLease !== lease) {
            throw new Error(
                'Scriptable prepare context is valid only during its prepare() callback'
            );
        }
        const capabilities = this.#capabilities;
        if (capabilities === null) throw new Error('Scriptable pass is not configured');
        return capabilities;
    }

    setViewportFromExecute(lease: ScriptablePassCallbackLease, viewport: RendererViewport): void {
        this.assertExecuteLeaseActive(lease);
        this.setViewport(viewport);
    }

    setScissorFromExecute(lease: ScriptablePassCallbackLease, rect: RendererViewport): void {
        this.assertExecuteLeaseActive(lease);
        this.setScissor(rect);
    }

    setStencilReferenceFromExecute(lease: ScriptablePassCallbackLease, reference: number): void {
        this.assertExecuteLeaseActive(lease);
        this.setStencilReference(reference);
    }

    drawRendererListFromExecute(
        lease: ScriptablePassCallbackLease,
        list: RendererListHandle
    ): void {
        this.assertExecuteLeaseActive(lease);
        this.drawRendererList(list);
    }

    copyTextureFromExecute(
        lease: ScriptablePassCallbackLease,
        source: RenderGraphTextureAccessHandle,
        destination: RenderGraphTextureAccessHandle
    ): void {
        this.assertExecuteLeaseActive(lease);
        this.copyTexture(source, destination);
    }

    copyBufferFromExecute(
        lease: ScriptablePassCallbackLease,
        source: RenderGraphBufferHandle,
        destination: RenderGraphBufferHandle
    ): void {
        this.assertExecuteLeaseActive(lease);
        this.copyBuffer(source, destination);
    }

    clearBufferFromExecute(
        lease: ScriptablePassCallbackLease,
        buffer: RenderGraphBufferHandle,
        byteOffset?: number,
        byteLength?: number
    ): void {
        this.assertExecuteLeaseActive(lease);
        this.clearBuffer(buffer, byteOffset, byteLength);
    }

    assertExecuteLeaseActive(lease: ScriptablePassCallbackLease): void {
        if (this.#activeExecuteLease !== lease) {
            throw new Error('Scriptable pass context is valid only during its execute() callback');
        }
    }

    private assertSetupLeaseActive(lease: ScriptablePassCallbackLease): void {
        if (this.#activeSetupLease !== lease) {
            throw new Error('Scriptable pass builder is valid only during its setup() callback');
        }
    }

    private readTexture(handle: RenderGraphTextureAccessHandle): void {
        this.requireSetupBuilder();
        if (this.sampledHandles.has(handle)) return;
        const internal = this.requireOwner().resolveTexture(handle, 'sampled');
        this.assertReadableInternalAccess(internal);
        const alreadyRead =
            this.sampledInternalHandles.has(internal) ||
            this.copySourceInternalHandles.has(internal);
        this.sampledHandles.add(handle);
        this.sampledInternalHandles.add(internal);
        this.sampledInternals.set(handle, internal);
        if (!alreadyRead) this.draw.addReadTexture(internal);
    }

    private writeStorageTexture(handle: RenderGraphTextureAccessHandle): void {
        const builder = this.requireSetupBuilder();
        const owner = this.requireOwner();
        const internal = owner.resolveTexture(handle, 'storage-write');
        if (this.storageWriteInternalHandles.has(internal)) return;
        this.assertWritableInternalAccess(internal);
        this.storageWriteInternalHandles.add(internal);
        builder.writeTexture(internal);
        owner.noteTextureWrite(handle);
    }

    private readBuffer(handle: RenderGraphBufferHandle, use: RenderGraphBufferReadUse): void {
        graphBufferUsage(use);
        const internal = this.requireOwner().resolveBuffer(handle, use);
        this.requireSetupBuilder().readBuffer(internal, use);
    }

    private writeBuffer(handle: RenderGraphBufferHandle, use: RenderGraphBufferWriteUse): void {
        graphBufferUsage(use);
        const owner = this.requireOwner();
        const record = owner.requireBuffer(handle);
        const internal = owner.resolveBuffer(handle, use);
        this.requireSetupBuilder().writeBuffer(internal, use);
        this.writtenBufferRecords.add(record);
        this.completeBufferRecords.add(record);
        this.noteCompleteBufferWrite(record);
    }

    private readWriteBuffer(handle: RenderGraphBufferHandle): void {
        const owner = this.requireOwner();
        const record = owner.requireBuffer(handle);
        const internal = owner.resolveBuffer(handle, 'storage');
        this.requireSetupBuilder().readWriteBuffer(internal, 'storage');
        this.writtenBufferRecords.add(record);
        this.notePartialBufferWrite(record);
    }

    private declareBufferCopy(
        sourceHandle: RenderGraphBufferHandle,
        destinationHandle: RenderGraphBufferHandle
    ): void {
        if (sourceHandle === destinationHandle) {
            throw new Error('Buffer copy source and destination must be distinct');
        }
        const owner = this.requireOwner();
        const sourceRecord = owner.requireBuffer(sourceHandle);
        const destinationRecord = owner.requireBuffer(destinationHandle);
        if (sourceRecord.byteLength !== destinationRecord.byteLength) {
            throw new Error('Buffer copy requires matching source and destination byte lengths');
        }
        if (sourceRecord.byteLength % 4 !== 0) {
            throw new RangeError('Buffer copy byte length must be 4-byte aligned');
        }
        const sourceInternal = owner.resolveBuffer(sourceHandle, 'copy-source');
        const destinationInternal = owner.resolveBuffer(destinationHandle, 'copy-destination');
        if (sourceInternal === destinationInternal) {
            throw new Error('Buffer copy source and destination must be distinct');
        }
        const builder = this.requireSetupBuilder();
        builder.readBuffer(sourceInternal, 'copy-source');
        builder.writeBuffer(destinationInternal, 'copy-destination');
        this.writtenBufferRecords.add(destinationRecord);
        this.completeBufferRecords.add(destinationRecord);
        this.noteCompleteBufferWrite(destinationRecord);

        let command = this.bufferCopyCommands[this.#bufferCopyDeclarationCount++];
        if (command === undefined) {
            command = createBufferCopyCommand();
            this.bufferCopyCommands.push(command);
        }
        command.sourceHandle = sourceHandle;
        command.destinationHandle = destinationHandle;
        command.sourceInternal = sourceInternal;
        command.destinationInternal = destinationInternal;
        command.source = null;
        command.destination = null;
        command.byteLength = sourceRecord.byteLength;
    }

    private declareBufferClear(
        handle: RenderGraphBufferHandle,
        byteOffset?: number,
        byteLength?: number
    ): void {
        const owner = this.requireOwner();
        if (owner.services.renderer.backend !== 'webgpu') {
            throw new Error('Buffer clear is supported only by WebGPU');
        }
        const record = owner.requireBuffer(handle);
        const range = normalizeBufferRange(record, byteOffset, byteLength, 'Buffer clear');
        const complete = range.byteOffset === 0 && range.byteLength === record.byteLength;
        if (!complete && !record.initialized && !this.completeBufferRecords.has(record)) {
            throw new Error('A partial buffer clear requires initialized existing contents');
        }
        const internal = owner.resolveBuffer(handle, 'copy-destination');
        if (complete) this.requireSetupBuilder().writeBuffer(internal, 'copy-destination');
        else this.requireSetupBuilder().readWriteBuffer(internal, 'copy-destination');
        this.writtenBufferRecords.add(record);
        if (complete) {
            this.completeBufferRecords.add(record);
            this.noteCompleteBufferWrite(record);
        } else this.notePartialBufferWrite(record);

        let command = this.bufferClearCommands[this.#bufferClearDeclarationCount++];
        if (command === undefined) {
            command = createBufferClearCommand();
            this.bufferClearCommands.push(command);
        }
        command.handle = handle;
        command.internal = internal;
        command.buffer = null;
        command.byteOffset = range.byteOffset;
        command.byteLength = range.byteLength;
    }

    private noteCompleteBufferWrite(record: BufferRecord): void {
        if (record.source === null) return;
        this.partialStorageBufferWrites.delete(record.source);
        this.completeStorageBufferWrites.add(record.source);
    }

    private notePartialBufferWrite(record: BufferRecord): void {
        if (record.source !== null && !this.completeStorageBufferWrites.has(record.source)) {
            this.partialStorageBufferWrites.add(record.source);
        }
    }

    private declareTextureCopy(
        sourceHandle: RenderGraphTextureAccessHandle,
        destinationHandle: RenderGraphTextureAccessHandle
    ): void {
        this.requireSetupBuilder();
        if (sourceHandle === destinationHandle) {
            throw new Error('Texture copy source and destination must be distinct');
        }
        const owner = this.requireOwner();
        const sourceRecord = owner.requireTexture(sourceHandle);
        const destinationRecord = owner.requireTexture(destinationHandle);
        if (
            sourceRecord.width !== destinationRecord.width ||
            sourceRecord.height !== destinationRecord.height ||
            sourceRecord.depthOrArrayLayers !== destinationRecord.depthOrArrayLayers
        ) {
            throw new Error('Texture copy requires matching source and destination extents');
        }
        if (sourceRecord.format !== destinationRecord.format) {
            throw new Error('Texture copy requires matching source and destination formats');
        }
        if (sourceRecord.mipLevelCount !== 1 || destinationRecord.mipLevelCount !== 1) {
            throw new Error('Texture copy requires one selected source and destination mip');
        }
        const sourceInternal = owner.resolveTexture(sourceHandle, 'copy-source');
        const destinationInternal = owner.resolveTexture(destinationHandle, 'copy-destination');
        if (sourceInternal === destinationInternal) {
            throw new Error('Texture copy source and destination must be distinct');
        }
        this.assertReadableInternalAccess(sourceInternal);
        this.assertWritableInternalAccess(destinationInternal);
        const sourceAlreadyRead =
            this.sampledInternalHandles.has(sourceInternal) ||
            this.copySourceInternalHandles.has(sourceInternal);
        this.copySourceInternalHandles.add(sourceInternal);
        this.copyDestinationInternalHandles.add(destinationInternal);
        if (!sourceAlreadyRead) this.draw.addReadTexture(sourceInternal);
        this.draw.addWriteTexture(destinationInternal);
        owner.noteTextureWrite(destinationHandle);

        let command = this.copyCommands[this.#copyDeclarationCount++];
        if (command === undefined) {
            command = createCopyCommand();
            this.copyCommands.push(command);
        }
        command.sourceHandle = sourceHandle;
        command.destinationHandle = destinationHandle;
        command.sourceInternal = sourceInternal;
        command.destinationInternal = destinationInternal;
        command.source.texture = null;
        command.destination.texture = null;
        command.source.mipLevel =
            sourceRecord.kind === 'texture-view' ? sourceRecord.descriptor.baseMipLevel : 0;
        command.destination.mipLevel =
            destinationRecord.kind === 'texture-view'
                ? destinationRecord.descriptor.baseMipLevel
                : 0;
        command.source.origin.z =
            sourceRecord.kind === 'texture-view' && sourceRecord.textureDimension !== '3d'
                ? sourceRecord.descriptor.baseArrayLayer
                : 0;
        command.destination.origin.z =
            destinationRecord.kind === 'texture-view' && destinationRecord.textureDimension !== '3d'
                ? destinationRecord.descriptor.baseArrayLayer
                : 0;
        command.source.aspect =
            sourceRecord.kind === 'texture-view' ? sourceRecord.descriptor.aspect : 'all';
        command.destination.aspect =
            destinationRecord.kind === 'texture-view' ? destinationRecord.descriptor.aspect : 'all';
        command.size.width = sourceRecord.width;
        command.size.height = sourceRecord.height;
        command.size.depthOrArrayLayers = sourceRecord.depthOrArrayLayers;
    }

    private useColorAttachment(options: Readonly<RenderPipelineColorAttachment>): void {
        this.requireSetupBuilder();
        const owner = this.requireOwner();
        const record = owner.requireTexture(options.texture);
        const texture = owner.resolveTexture(options.texture, 'attachment');
        this.assertAttachmentInternalAccess(texture);
        this.attachmentHandles.add(options.texture);
        this.attachmentInternalHandles.add(texture);
        let resolveTarget: RGTextureAccessHandle | undefined;
        if (options.resolveTarget !== undefined) {
            if (options.resolveTarget === options.texture) {
                throw new Error('Color attachment resolve target must be distinct');
            }
            resolveTarget = owner.resolveTexture(options.resolveTarget, 'resolve-target');
            this.assertAttachmentInternalAccess(resolveTarget);
            this.attachmentHandles.add(options.resolveTarget);
            this.attachmentInternalHandles.add(resolveTarget);
            owner.noteTextureWrite(options.resolveTarget);
        } else if (record.resolveTarget !== null) {
            resolveTarget = record.resolveTarget;
            this.assertAttachmentInternalAccess(resolveTarget);
            this.attachmentInternalHandles.add(resolveTarget);
        }
        this.#hasRasterAttachments = true;
        this.colorFormats.push(record.format);
        this.mergeTargetShape(record);
        this.draw.addColorAttachment({
            texture,
            ...(resolveTarget === undefined ? {} : { resolveTarget }),
            loadOp: options.loadOp,
            storeOp: options.storeOp,
            ...(options.clearValue === undefined ? {} : { clearValue: options.clearValue })
        });
        if (record.resolveTarget === null || options.resolveTarget === undefined) {
            owner.noteTextureWrite(options.texture);
        }
    }

    private useDepthStencilAttachment(
        options: Readonly<RenderPipelineDepthStencilAttachment>
    ): void {
        this.requireSetupBuilder();
        const owner = this.requireOwner();
        const record = owner.requireTexture(options.texture);
        const texture = owner.resolveTexture(options.texture, 'attachment');
        this.assertAttachmentInternalAccess(texture);
        this.attachmentHandles.add(options.texture);
        this.attachmentInternalHandles.add(texture);
        this.#hasRasterAttachments = true;
        (
            this.targetDescriptor as { depthStencilFormat: RHITextureFormat | null }
        ).depthStencilFormat = record.format;
        this.mergeTargetShape(record);
        this.draw.setDepthStencilAttachment({
            texture,
            ...(options.depthLoadOp === undefined ? {} : { depthLoadOp: options.depthLoadOp }),
            ...(options.depthStoreOp === undefined ? {} : { depthStoreOp: options.depthStoreOp }),
            ...(options.depthClearValue === undefined
                ? {}
                : { depthClearValue: options.depthClearValue }),
            ...(options.depthReadOnly === undefined
                ? {}
                : { depthReadOnly: options.depthReadOnly }),
            ...(options.stencilLoadOp === undefined
                ? {}
                : { stencilLoadOp: options.stencilLoadOp }),
            ...(options.stencilStoreOp === undefined
                ? {}
                : { stencilStoreOp: options.stencilStoreOp }),
            ...(options.stencilClearValue === undefined
                ? {}
                : { stencilClearValue: options.stencilClearValue }),
            ...(options.stencilReadOnly === undefined
                ? {}
                : { stencilReadOnly: options.stencilReadOnly })
        });
        const depthUsed =
            options.depthClearValue !== undefined ||
            options.depthLoadOp !== undefined ||
            options.depthStoreOp !== undefined ||
            options.depthReadOnly !== undefined;
        const stencilUsed =
            options.stencilClearValue !== undefined ||
            options.stencilLoadOp !== undefined ||
            options.stencilStoreOp !== undefined ||
            options.stencilReadOnly !== undefined;
        if (
            (rhiTextureFormatHasDepth(record.format) &&
                depthUsed &&
                options.depthReadOnly !== true) ||
            (rhiTextureFormatHasStencil(record.format) &&
                stencilUsed &&
                options.stencilReadOnly !== true)
        ) {
            owner.noteTextureWrite(options.texture);
        }
    }

    private mergeTargetShape(record: TextureAccessRecord): void {
        if (!this.#hasTargetShape) {
            this.#hasTargetShape = true;
            (this.targetDescriptor as { sampleCount: number }).sampleCount = record.sampleCount;
            return;
        }
        if (this.targetDescriptor.sampleCount !== record.sampleCount) {
            throw new Error('Scriptable pass attachments require matching sample counts');
        }
    }

    private useRendererList(list: RendererListHandle): void {
        this.requireSetupBuilder();
        this.requireOwner().requireRendererList(list);
        if (this.rendererListHandles.has(list)) {
            throw new Error('Renderer list is already declared by this pass');
        }
        this.rendererListHandles.add(list);
    }

    private dependsOn(pass: RenderGraphPassHandle): void {
        this.requireSetupBuilder();
        this.draw.dependsOn(this.requireOwner().resolvePass(pass));
    }

    private markSideEffect(): void {
        this.requireSetupBuilder();
        this.draw.sideEffect = true;
        this.requireOwner().noteSideEffect();
    }

    private setViewport(viewport: RendererViewport): void {
        finiteViewport(viewport, 'Viewport');
        const encoder = this.requireRasterEncoder();
        this.executionViewport.x = viewport[0];
        this.executionViewport.y = viewport[1];
        this.executionViewport.width = viewport[2];
        this.executionViewport.height = viewport[3];
        this.executionViewport.minDepth = 0;
        this.executionViewport.maxDepth = 1;
        this.draw.setViewport(this.executionViewport);
        encoder.setViewportRecord(this.executionViewport);
    }

    private setScissor(rect: RendererViewport): void {
        finiteViewport(rect, 'Scissor');
        if (!rect.every(Number.isSafeInteger) || rect[0] < 0 || rect[1] < 0) {
            throw new RangeError('Scissor must contain non-negative integer coordinates and size');
        }
        const encoder = this.requireRasterEncoder();
        this.executionScissor.x = rect[0];
        this.executionScissor.y = rect[1];
        this.executionScissor.width = rect[2];
        this.executionScissor.height = rect[3];
        this.draw.setScissor(this.executionScissor);
        encoder.setScissorRectRecord(this.executionScissor);
    }

    private setStencilReference(reference: number): void {
        if (!Number.isSafeInteger(reference) || reference < 0 || reference > 0xffff_ffff) {
            throw new RangeError('Stencil reference must be an unsigned 32-bit integer');
        }
        this.requireRasterEncoder().setStencilReference(reference);
    }

    private drawRendererList(handle: RendererListHandle): void {
        const encoder = this.requireRasterEncoder();
        for (let index = 0; index < this.#rangeCount; index += 1) {
            const range = this.ranges[index];
            if (range?.handle !== handle) continue;
            this.#previousDraw = this.draw.executeDrawRange(
                encoder,
                range.start,
                range.count,
                this.#previousDraw
            );
            this.requireOwner().recordRendererListDraw(handle);
            return;
        }
        throw new Error('Renderer list was not declared by this pass setup');
    }

    private copyTexture(
        sourceHandle: RenderGraphTextureAccessHandle,
        destinationHandle: RenderGraphTextureAccessHandle
    ): void {
        if (this.#encoder !== null) {
            throw new Error('Texture copies cannot execute inside a raster pass');
        }
        const context = this.requireExecutionContext();
        let command: MutableCopyCommand | undefined;
        for (let index = 0; index < this.#copyDeclarationCount; index += 1) {
            const candidate = this.copyCommands[index];
            if (
                candidate?.sourceHandle === sourceHandle &&
                candidate.destinationHandle === destinationHandle
            ) {
                command = candidate;
                break;
            }
        }
        if (command === undefined) {
            throw new Error('Exact texture copy source/destination pair must be declared in setup');
        }
        if (command.source.texture === null || command.destination.texture === null) {
            throw new Error('Texture copy declaration was not prepared');
        }
        context.commandContext.copyTextureToTexture(
            command.source as { readonly texture: RHITexture },
            command.destination as { readonly texture: RHITexture },
            command.size
        );
    }

    private copyBuffer(
        sourceHandle: RenderGraphBufferHandle,
        destinationHandle: RenderGraphBufferHandle
    ): void {
        if (this.#encoder !== null) {
            throw new Error('Buffer copies cannot execute inside a raster pass');
        }
        const context = this.requireExecutionContext();
        let command: MutableBufferCopyCommand | undefined;
        for (let index = 0; index < this.#bufferCopyDeclarationCount; index += 1) {
            const candidate = this.bufferCopyCommands[index];
            if (
                candidate?.sourceHandle === sourceHandle &&
                candidate.destinationHandle === destinationHandle
            ) {
                command = candidate;
                break;
            }
        }
        if (command === undefined) {
            throw new Error('Exact buffer copy source/destination pair must be declared in setup');
        }
        const source = command.source;
        const destination = command.destination;
        if (source === null || destination === null) {
            throw new Error('Buffer copy declaration was not prepared');
        }
        context.commandContext.copyBufferToBuffer(source, 0, destination, 0, command.byteLength);
    }

    private clearBuffer(
        handle: RenderGraphBufferHandle,
        byteOffset?: number,
        byteLength?: number
    ): void {
        if (this.#encoder !== null) {
            throw new Error('Buffer clears cannot execute inside a raster pass');
        }
        const range = normalizeBufferRange(
            this.requireOwner().requireBuffer(handle),
            byteOffset,
            byteLength,
            'Buffer clear'
        );
        let command: MutableBufferClearCommand | undefined;
        for (let index = 0; index < this.#bufferClearDeclarationCount; index += 1) {
            const candidate = this.bufferClearCommands[index];
            if (
                candidate?.handle === handle &&
                candidate.byteOffset === range.byteOffset &&
                candidate.byteLength === range.byteLength
            ) {
                command = candidate;
                break;
            }
        }
        if (command === undefined) {
            throw new Error('Exact buffer clear destination/range must be declared in setup');
        }
        if (command.buffer === null) throw new Error('Buffer clear declaration was not prepared');
        this.requireExecutionContext().commandContext.clearBuffer(
            command.buffer,
            command.byteOffset,
            command.byteLength
        );
    }

    private prepareTextureCopies(context: RGPrepareContext): void {
        for (let index = 0; index < this.#copyDeclarationCount; index += 1) {
            const command = this.copyCommands[index];
            if (command === undefined) {
                throw new Error('Texture copy declaration storage is incomplete');
            }
            const source = context.getTexture(command.sourceInternal);
            const destination = context.getTexture(command.destinationInternal);
            command.source.texture = source;
            command.destination.texture = destination;
            validateRHITextureToTextureCopyParameters(
                command.source as typeof command.source & { readonly texture: RHITexture },
                command.destination as typeof command.destination & {
                    readonly texture: RHITexture;
                },
                command.size
            );
        }
    }

    private prepareBufferCommands(context: RGPrepareContext): void {
        for (let index = 0; index < this.#bufferCopyDeclarationCount; index += 1) {
            const command = this.bufferCopyCommands[index];
            if (command === undefined) {
                throw new Error('Buffer copy declaration storage is incomplete');
            }
            const source = context.getBuffer(command.sourceInternal);
            const destination = context.getBuffer(command.destinationInternal);
            if (source.size !== command.byteLength || destination.size !== command.byteLength) {
                throw new Error(
                    'Buffer copy requires matching source and destination byte lengths'
                );
            }
            if (
                (source.usage & RHIBufferUsage.COPY_SRC) === 0 ||
                (destination.usage & RHIBufferUsage.COPY_DST) === 0
            ) {
                throw new Error('Buffer copy resources do not satisfy declared copy usages');
            }
            command.source = source;
            command.destination = destination;
        }
        for (let index = 0; index < this.#bufferClearDeclarationCount; index += 1) {
            const command = this.bufferClearCommands[index];
            if (command === undefined) {
                throw new Error('Buffer clear declaration storage is incomplete');
            }
            const buffer = context.getBuffer(command.internal);
            if (
                (buffer.usage & RHIBufferUsage.COPY_DST) === 0 ||
                command.byteOffset + command.byteLength > buffer.size
            ) {
                throw new Error('Buffer clear resource does not satisfy its declared byte range');
            }
            command.buffer = buffer;
        }
    }

    private stageCompleteStorageBufferWrites(): void {
        if (
            this.completeStorageBufferWrites.size === 0 &&
            this.partialStorageBufferWrites.size === 0
        ) {
            return;
        }
        const cache = this.requireOwner().services.getScriptableStorageBufferResources();
        for (const buffer of this.completeStorageBufferWrites) {
            cache.stageCompleteGPUWrite(buffer);
        }
        for (const buffer of this.partialStorageBufferWrites) cache.stageGPUWrite(buffer);
    }

    private assertReadableInternalAccess(handle: RGTextureAccessHandle): void {
        if (
            this.storageWriteInternalHandles.has(handle) ||
            this.copyDestinationInternalHandles.has(handle) ||
            this.attachmentInternalHandles.has(handle)
        ) {
            throw new Error('Same-pass texture feedback is not portable');
        }
    }

    private assertWritableInternalAccess(handle: RGTextureAccessHandle): void {
        if (
            this.sampledInternalHandles.has(handle) ||
            this.storageWriteInternalHandles.has(handle) ||
            this.copySourceInternalHandles.has(handle) ||
            this.copyDestinationInternalHandles.has(handle) ||
            this.attachmentInternalHandles.has(handle)
        ) {
            throw new Error('Same-pass texture feedback is not portable');
        }
    }

    private assertAttachmentInternalAccess(handle: RGTextureAccessHandle): void {
        if (
            this.sampledInternalHandles.has(handle) ||
            this.storageWriteInternalHandles.has(handle) ||
            this.copySourceInternalHandles.has(handle) ||
            this.copyDestinationInternalHandles.has(handle) ||
            this.attachmentInternalHandles.has(handle)
        ) {
            throw new Error('Same-pass texture feedback is not portable');
        }
    }

    private requireOwner(): ScriptableRenderPipelineContextImpl {
        if (this.#owner === null) throw new Error('Scriptable pass has no context owner');
        return this.#owner;
    }

    private requirePass(): ScriptableRenderPass<object> {
        if (this.#pass === null) throw new Error('Scriptable pass is not configured');
        return this.#pass;
    }

    private requireParameters(): object {
        if (this.#parameters === null)
            throw new Error('Scriptable pass parameters are unavailable');
        return this.#parameters;
    }

    private requireSetupBuilder(): RGPassBuilder {
        if (this.#setupBuilder === null) {
            throw new Error('Scriptable pass builder is valid only during setup()');
        }
        return this.#setupBuilder;
    }

    private requireExecutionContext(): RGPassContext {
        if (this.#executionContext === null) {
            throw new Error('Scriptable commands are valid only during execute()');
        }
        return this.#executionContext;
    }

    private requireRasterEncoder(): RHIRenderPassEncoder {
        this.requireExecutionContext();
        if (this.#encoder === null) throw new Error('Command requires a raster pass attachment');
        return this.#encoder;
    }
}
