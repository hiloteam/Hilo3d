import Camera from '../../camera/Camera';
import type Mesh from '../../core/Mesh';
import type Light from '../../light/Light';
import type LightManager from '../../light/LightManager';
import type Material from '../../material/Material';
import type { RenderGraphFrameBuildScope } from '../frame/RenderGraphFrame';
import type { RenderGraphFrameContext } from '../frame/RenderGraphFrameContext';
import type { RGPassBuilder, RenderPassTemplate } from '../graph/RenderGraphBuilder';
import type { RGPassContext, RGPrepareContext } from '../graph/RenderGraphExecutor';
import type { RGBufferHandle, RGPassHandle, RGTextureHandle } from '../graph/RenderGraphResource';
import RenderList from '../RenderList';
import { RenderGraphFramePlanner } from '../RenderGraphFramePlan';
import type {
    RenderTarget,
    RenderTargetColor,
    RenderTargetColorFormat,
    RenderTargetDepthStencilFormat,
    RenderTargetLoadOp,
    RenderTargetStoreOp
} from '../RenderTarget';
import type { RendererCore, RendererScene, RendererViewport } from '../RendererCore';
import {
    RHIBufferUsage,
    RHITextureUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    validateRHITextureToTextureCopyParameters,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupLayout,
    type RHIBindingResource,
    type RHIBuffer,
    type RHIRenderPassEncoder,
    type RHISurface,
    type RHITexture,
    type RHITextureFormat,
    type RHIViewport
} from '../rhi/core';
import type { RendererStorageBuffer, StorageBuffer } from '../StorageBuffer';
import type {
    CullingOptions,
    CullingResultsHandle,
    RendererListDescriptor,
    RendererListHandle
} from '../pipeline/RendererList';
import type {
    RenderPipelineCapabilities,
    RenderPipelineContext,
    RenderPipelineOutput,
    RenderPipelineOutputColorAttachment,
    RenderPipelineOutputDepthStencilAttachment
} from '../pipeline/RenderPipeline';
import {
    acquireRenderPassParameters,
    type RenderPassParameterPool
} from '../pipeline/RenderPassParameterPool';
import {
    FullscreenRenderPass,
    type FullscreenRenderPassParameters
} from '../pipeline/passes/FullscreenRenderPass';
import {
    ComputeRenderPass,
    type ComputeRenderPassParameters
} from '../pipeline/passes/ComputeRenderPass';
import {
    GPUDrivenRenderPass,
    type GPUDrivenRenderPassParameters
} from '../pipeline/passes/GPUDrivenRenderPass';
import {
    SCENE_STORAGE_BIND_GROUP,
    SceneRenderPass,
    type SceneRenderPassParameters,
    type SceneStorageShaderVariant
} from '../pipeline/passes/SceneRenderPass';
import type {
    RenderGraphBufferHandle,
    RenderGraphBufferReadUse,
    RenderGraphBufferWriteUse,
    RenderGraphPassHandle,
    RenderGraphTextureHandle,
    RenderPipelineBufferDescriptor,
    RenderPipelineColorAttachment,
    RenderPipelineDepthStencilAttachment,
    RenderPipelineExtent,
    RenderPipelinePersistentTargetDescriptor,
    RenderPipelineTargetResources,
    RenderPipelineTextureDescriptor,
    ScriptableRenderCommands,
    ScriptableRenderGraph,
    ScriptableRenderPass,
    ScriptableRenderPassBuilder,
    ScriptableRenderPassContext,
    ScriptableRenderPrepareContext
} from '../pipeline/ScriptableRenderGraph';
import { MeshDrawListPlanner, type MeshDrawListPlan } from '../renderer/MeshDrawListPlanner';
import type { FullscreenDrawProcessor } from '../renderer/FullscreenDrawProcessor';
import type {
    MeshDrawProcessor,
    StorageScenePreparationState
} from '../renderer/MeshDrawProcessor';
import type { ComputePipelineResourceCache } from '../renderer/ComputePipelineResourceCache';
import type { ComputeSamplerResourceCache } from '../renderer/ComputeSamplerResourceCache';
import type { GPUDrivenPipelineResourceCache } from '../renderer/GPUDrivenPipelineResourceCache';
import type { ScriptableBindGroupResourceCache } from '../renderer/ScriptableBindGroupResourceCache';
import { PreparedDraw } from '../renderer/PreparedDraw';
import type { PipelineResourceRecord } from '../renderer/PipelineResourceCache';
import type { RenderTargetGraphBridge } from '../renderer/RenderTargetGraphBridge';
import type {
    RenderTargetResourceCache,
    RenderTargetResourceDescriptor,
    RenderTargetResourceRecord
} from '../renderer/RenderTargetResourceCache';
import type { RHIMeshDrawTargetDescriptor } from '../renderer/RHIDescriptorMapping';
import type { ResourceRegistryHandle } from '../renderer/ResourceRegistry';
import type { RHIRenderTarget } from '../renderer/RHIRenderTarget';
import type { StorageBufferResourceCache } from '../renderer/StorageBufferResourceCache';
import {
    ScriptableComputeDispatch,
    type ScriptableComputeDispatchServices,
    type ScriptableComputeGraphResolver
} from '../renderer/ScriptableComputeDispatch';
import {
    ScriptableGPUDrivenDraw,
    type ScriptableGPUDrivenDrawServices
} from '../renderer/ScriptableGPUDrivenDraw';
import { importSurfaceColor, importSurfaceDepthStencil } from '../renderer/SurfaceGraphBridge';
import { SharedDrawPassParameters } from '../renderer/passes/SharedDrawPass';
import { refreshShadowAtlasSceneBinding } from '../renderer/ShadowAtlasTextureBinding';

type TextureAccess =
    | 'attachment'
    | 'resolve-target'
    | 'sampled'
    | 'storage-write'
    | 'copy-source'
    | 'copy-destination';
type PipelineTextureFormat = RenderTargetColorFormat | RenderTargetDepthStencilFormat;
type MutableRHIViewport = { -readonly [Key in keyof RHIViewport]: RHIViewport[Key] };
type MutableRenderTargetColor = {
    -readonly [Key in keyof RenderTargetColor]: RenderTargetColor[Key];
};
const EMPTY_LIGHTS: readonly Light[] = Object.freeze([]);

function requireRuntimeArray(value: unknown, path: string): void {
    if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
}

interface MutablePipelineOutputState {
    kind: 'surface' | 'render-target';
    width: number;
    height: number;
    sampleCount: 1 | 4;
    colorAttachmentCount: number;
    depthStencilFormat: RenderPipelineOutput['depthStencilFormat'];
}

interface MutablePipelineOutputColorAttachmentState {
    readonly clearValue: MutableRenderTargetColor;
    loadOp: RenderTargetLoadOp;
    storeOp: RenderTargetStoreOp;
}

interface MutablePipelineOutputDepthStencilAttachmentState {
    depthClearValue: number;
    depthLoadOp: RenderTargetLoadOp;
    depthStoreOp: RenderTargetStoreOp;
    stencilClearValue: number;
    stencilLoadOp: RenderTargetLoadOp;
    stencilStoreOp: RenderTargetStoreOp;
}

interface MutableTextureGraphDescriptor {
    label: string;
    readonly size: { width: number; height: number; depthOrArrayLayers: number };
    mipLevelCount: number;
    sampleCount: number;
    dimension: '2d';
    viewDimension: '2d';
    format: PipelineTextureFormat;
    usage: number;
}

interface MutableBufferGraphDescriptor {
    label: string;
    size: number;
    usage: number;
}

interface MutablePersistentTargetResourceDescriptor extends RenderTargetResourceDescriptor {
    label?: string;
    width: number;
    height: number;
    readonly colorFormats: RHITextureFormat[];
    sampleCount: 1 | 4;
    multisampleAttachmentLifetime: 'persistent';
    depthStencilFormat: RHITextureFormat | null;
    depthStencilSampled: false;
}

interface TextureRecord {
    handle: RenderGraphTextureHandle;
    name: string;
    format: PipelineTextureFormat;
    width: number;
    height: number;
    sampleCount: 1 | 4;
    mipLevelCount: number;
    attachment: RGTextureHandle | null;
    readable: RGTextureHandle | null;
    writable: RGTextureHandle | null;
    resolveTarget: RGTextureHandle | null;
    outputRoot: RGTextureHandle | null;
    transient: boolean;
    readonly graphDescriptor: MutableTextureGraphDescriptor;
}

interface BufferRecord {
    handle: RenderGraphBufferHandle;
    name: string;
    byteLength: number;
    internal: RGBufferHandle | null;
    source: RendererStorageBuffer | null;
    transient: boolean;
    initialized: boolean;
    readonly graphDescriptor: MutableBufferGraphDescriptor;
}

interface RendererListRange {
    handle: RendererListHandle;
    start: number;
    count: number;
}

interface MutableCopyCommand {
    sourceHandle: RenderGraphTextureHandle;
    destinationHandle: RenderGraphTextureHandle;
    sourceInternal: RGTextureHandle;
    destinationInternal: RGTextureHandle;
    readonly source: { texture: RHITexture | null };
    readonly destination: { texture: RHITexture | null };
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

interface PersistentTargetState {
    readonly key: object;
    currentOwner: object | null;
    currentDescriptor: Readonly<RenderTargetResourceDescriptor> | null;
    currentRecord: Readonly<RenderTargetResourceRecord> | null;
    pendingOwner: object | null;
    pendingDescriptor: Readonly<RenderTargetResourceDescriptor> | null;
    pendingRecord: Readonly<RenderTargetResourceRecord> | null;
    lastAcquiredFrameIndex: number;
    pendingRelease: boolean;
}

/** @internal Renderer services deliberately narrower than either Renderer or the portable RHI. */
export interface ScriptableRenderPipelineServices {
    readonly renderer: RendererCore;
    readonly lightManager: LightManager;
    readonly antialias: boolean;
    getScriptableSurface(): RHISurface;
    getScriptableMeshProcessor(): MeshDrawProcessor;
    getScriptableFullscreenProcessor(): FullscreenDrawProcessor;
    getScriptableTargetResources(): RenderTargetResourceCache;
    getScriptableStorageBufferResources(): StorageBufferResourceCache;
    getScriptableComputePipelineResources(): ComputePipelineResourceCache;
    getScriptableComputeSamplerResources(): ComputeSamplerResourceCache;
    getScriptableGPUDrivenPipelineResources(): GPUDrivenPipelineResourceCache;
    getScriptableBindGroupResources(): ScriptableBindGroupResourceCache;
    getScriptableTargetBridge(): RenderTargetGraphBridge;
    resolveScriptableRenderTarget(target: RenderTarget): RHIRenderTarget;
    resolveScriptableStorageBuffer(buffer: StorageBuffer): RendererStorageBuffer;
    createScriptableFrameContext(
        camera: Camera,
        viewport: Readonly<RHIViewport>,
        frameIndex: number
    ): RenderGraphFrameContext;
    beginScriptableMeshPass(context: RenderGraphFrameContext): void;
    beginScriptableFullscreenPass(context: RenderGraphFrameContext): void;
    prepareScriptableCullingScene(scene: RendererScene, camera: Camera): void;
    markScriptableTargetUsed(record: Readonly<RenderTargetResourceRecord>): void;
    markScriptableSurfaceRequested(): void;
    fireScriptableBeforeScene(
        meshes: readonly Mesh[],
        enabled: boolean,
        fireRendererEvents: boolean
    ): void;
    recordScriptableShadows(
        meshes: readonly Mesh[],
        camera: Camera,
        viewport: Readonly<RHIViewport>,
        width: number,
        height: number
    ): number;
    recordScriptablePass(passCount: number): void;
    recordScriptableFaces(meshes: readonly Mesh[]): void;
    queueScriptableAfterScene(meshes: readonly Mesh[], enabled: boolean): void;
    retainScriptablePresentation(scene: RendererScene, camera: Camera): void;
}

/** @internal Runtime-scoped ownership identities for persistent SRP targets. */
export class ScriptableRenderPipelineResources {
    #runtimeOwner: object | null = null;
    #persistentByKey = new WeakMap<object, PersistentTargetState>();
    readonly #persistentStates = new Set<PersistentTargetState>();
    readonly #deferredPersistentCleanupOwners = new Set<object>();
    readonly #frameBindGroups = new Set<RHIBindGroup>();
    readonly #cleanupFailures: unknown[] = [];
    #activeFrameIndex = -1;
    #nextHandle = 1;

    allocateHandle(): number {
        if (!Number.isSafeInteger(this.#nextHandle)) {
            throw new RangeError('Scriptable render handle identity space is exhausted');
        }
        return this.#nextHandle++;
    }

    preparePersistentTarget(
        runtimeOwner: object,
        key: unknown,
        frameIndex: number,
        cache: RenderTargetResourceCache,
        descriptor: Readonly<RenderTargetResourceDescriptor>
    ): Readonly<RenderTargetResourceRecord> {
        if ((typeof key !== 'object' && typeof key !== 'function') || key === null) {
            throw new TypeError('Persistent render target key must be an object');
        }
        if (this.#runtimeOwner === null) this.#runtimeOwner = runtimeOwner;
        else if (this.#runtimeOwner !== runtimeOwner) {
            throw new Error('Scriptable render resources belong to another pipeline runtime');
        }
        if (frameIndex !== this.#activeFrameIndex) {
            throw new Error('Persistent target acquisition requires the active scriptable frame');
        }
        let state = this.#persistentByKey.get(key);
        if (state === undefined) {
            state = {
                key,
                currentOwner: null,
                currentDescriptor: null,
                currentRecord: null,
                pendingOwner: null,
                pendingDescriptor: null,
                pendingRecord: null,
                lastAcquiredFrameIndex: -1,
                pendingRelease: false
            };
            this.#persistentByKey.set(key, state);
            this.#persistentStates.add(state);
        }
        if (state.pendingRelease) {
            throw new Error('Cannot acquire a persistent target pending release in this frame');
        }
        if (state.pendingOwner !== null) {
            if (!samePersistentTargetDescriptor(state.pendingDescriptor, descriptor)) {
                throw new Error(
                    'A persistent target key cannot use multiple descriptors in one frame'
                );
            }
            const pending = state.pendingRecord;
            if (pending === null) throw new Error('Persistent target staging is incomplete');
            state.lastAcquiredFrameIndex = frameIndex;
            return pending;
        }
        if (
            state.currentOwner !== null &&
            samePersistentTargetDescriptor(state.currentDescriptor, descriptor)
        ) {
            const current = state.currentRecord;
            if (current === null) throw new Error('Persistent target state is incomplete');
            state.lastAcquiredFrameIndex = frameIndex;
            return current;
        }
        const owner = Object.freeze({});
        const snapshot = snapshotPersistentTargetDescriptor(descriptor);
        let record: Readonly<RenderTargetResourceRecord>;
        try {
            record = cache.prepare(owner, snapshot);
        } catch (error) {
            this.removeEmptyPersistentState(state);
            throw error;
        }
        state.pendingOwner = owner;
        state.pendingDescriptor = snapshot;
        state.pendingRecord = record;
        state.lastAcquiredFrameIndex = frameIndex;
        return record;
    }

    releasePersistentTarget(runtimeOwner: object, key: unknown): boolean {
        if ((typeof key !== 'object' && typeof key !== 'function') || key === null) {
            throw new TypeError('Persistent render target key must be an object');
        }
        if (this.#runtimeOwner === null) return false;
        if (this.#runtimeOwner !== runtimeOwner) {
            throw new Error('Scriptable render resources belong to another pipeline runtime');
        }
        const state = this.#persistentByKey.get(key);
        if (state === undefined) return false;
        if (
            state.pendingOwner !== null ||
            state.lastAcquiredFrameIndex === this.#activeFrameIndex
        ) {
            throw new Error('Cannot release a persistent target used by the active frame');
        }
        state.pendingRelease = true;
        return true;
    }

    beginFrame(frameIndex: number): void {
        if (this.#frameBindGroups.size !== 0) {
            throw new Error('Scriptable frame bind groups escaped their previous frame');
        }
        for (const state of this.#persistentStates) {
            if (state.pendingOwner !== null) {
                throw new Error('Persistent target staging escaped its previous frame');
            }
        }
        this.#activeFrameIndex = frameIndex;
    }

    trackFrameBindGroup(bindGroup: RHIBindGroup): void {
        this.#frameBindGroups.add(bindGroup);
    }

    releaseFrameBindGroup(bindGroup: RHIBindGroup): void {
        if (!this.#frameBindGroups.delete(bindGroup)) return;
        bindGroup.destroy();
    }

    endFrame(cache: RenderTargetResourceCache, submitted: boolean): void {
        const failures = this.#cleanupFailures;
        failures.length = 0;
        for (const bindGroup of this.#frameBindGroups) {
            try {
                bindGroup.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        this.#frameBindGroups.clear();
        this.retryDeferredPersistentCleanup(cache, failures);
        for (const state of this.#persistentStates) {
            const pendingOwner = state.pendingOwner;
            if (pendingOwner !== null) {
                if (submitted) {
                    const previousOwner = state.currentOwner;
                    state.currentOwner = pendingOwner;
                    state.currentDescriptor = state.pendingDescriptor;
                    state.currentRecord = state.pendingRecord;
                    if (previousOwner !== null) {
                        this.releasePersistentOwner(cache, previousOwner, failures);
                    }
                } else {
                    this.releasePersistentOwner(cache, pendingOwner, failures);
                }
                state.pendingOwner = null;
                state.pendingDescriptor = null;
                state.pendingRecord = null;
            }
            if (state.pendingRelease) {
                if (!submitted) {
                    state.pendingRelease = false;
                } else {
                    const owner = state.currentOwner;
                    if (owner !== null) {
                        this.releasePersistentOwner(cache, owner, failures);
                    }
                    state.currentOwner = null;
                    state.currentDescriptor = null;
                    state.currentRecord = null;
                    state.pendingRelease = false;
                }
            }
            this.removeEmptyPersistentState(state);
        }
        this.#activeFrameIndex = -1;
        if (failures.length !== 0) {
            const failure = new AggregateError(
                failures,
                'Scriptable frame resources failed during cleanup',
                {
                    cause: failures[0]
                }
            );
            failures.length = 0;
            throw failure;
        }
    }

    releasePersistentTargets(cache: RenderTargetResourceCache): void {
        if (this.#activeFrameIndex !== -1 || this.#frameBindGroups.size !== 0) {
            throw new Error('Cannot release scriptable resources during an active frame');
        }
        const failures = this.#cleanupFailures;
        failures.length = 0;
        this.retryDeferredPersistentCleanup(cache, failures);
        for (const state of this.#persistentStates) {
            const pendingOwner = state.pendingOwner;
            if (pendingOwner !== null) {
                this.releasePersistentOwner(cache, pendingOwner, failures);
            }
            const currentOwner = state.currentOwner;
            if (currentOwner !== null) {
                this.releasePersistentOwner(cache, currentOwner, failures);
            }
            state.currentOwner = null;
            state.currentDescriptor = null;
            state.currentRecord = null;
            state.pendingOwner = null;
            state.pendingDescriptor = null;
            state.pendingRecord = null;
            state.lastAcquiredFrameIndex = -1;
            state.pendingRelease = false;
        }
        this.#persistentStates.clear();
        this.#persistentByKey = new WeakMap();
        if (failures.length !== 0) {
            const failure = new AggregateError(
                failures,
                'Persistent scriptable targets failed while being released',
                { cause: failures[0] }
            );
            failures.length = 0;
            throw failure;
        }
    }

    private releasePersistentOwner(
        cache: RenderTargetResourceCache,
        owner: object,
        failures: unknown[]
    ): void {
        try {
            cache.release(owner);
            this.#deferredPersistentCleanupOwners.delete(owner);
        } catch (error) {
            this.#deferredPersistentCleanupOwners.add(owner);
            failures.push(error);
        }
    }

    private retryDeferredPersistentCleanup(
        cache: RenderTargetResourceCache,
        failures: unknown[]
    ): void {
        for (const owner of this.#deferredPersistentCleanupOwners) {
            try {
                cache.release(owner);
                this.#deferredPersistentCleanupOwners.delete(owner);
            } catch (error) {
                failures.push(error);
            }
        }
    }

    private removeEmptyPersistentState(state: PersistentTargetState): void {
        if (state.currentOwner !== null || state.pendingOwner !== null || state.pendingRelease) {
            return;
        }
        state.lastAcquiredFrameIndex = -1;
        this.#persistentByKey.delete(state.key);
        this.#persistentStates.delete(state);
    }
}

function samePersistentTargetDescriptor(
    first: Readonly<RenderTargetResourceDescriptor> | null,
    second: Readonly<RenderTargetResourceDescriptor>
): boolean {
    if (
        first === null ||
        first.label !== second.label ||
        first.width !== second.width ||
        first.height !== second.height ||
        (first.sampleCount ?? 1) !== (second.sampleCount ?? 1) ||
        (first.depthStencilFormat ?? null) !== (second.depthStencilFormat ?? null) ||
        (first.depthStencilSampled ?? false) !== (second.depthStencilSampled ?? false) ||
        (first.multisampleAttachmentLifetime ?? 'persistent') !==
            (second.multisampleAttachmentLifetime ?? 'persistent') ||
        first.colorFormats.length !== second.colorFormats.length
    ) {
        return false;
    }
    for (let index = 0; index < first.colorFormats.length; index += 1) {
        if (first.colorFormats[index] !== second.colorFormats[index]) return false;
    }
    return true;
}

function snapshotPersistentTargetDescriptor(
    descriptor: Readonly<RenderTargetResourceDescriptor>
): Readonly<RenderTargetResourceDescriptor> {
    return Object.freeze({
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        width: descriptor.width,
        height: descriptor.height,
        colorFormats: Object.freeze([...descriptor.colorFormats]),
        sampleCount: descriptor.sampleCount ?? 1,
        multisampleAttachmentLifetime: descriptor.multisampleAttachmentLifetime ?? 'persistent',
        depthStencilFormat: descriptor.depthStencilFormat ?? null,
        depthStencilSampled: descriptor.depthStencilSampled ?? false
    });
}

function isPromiseLike(value: unknown): boolean {
    return (
        ((typeof value === 'object' && value !== null) || typeof value === 'function') &&
        typeof Reflect.get(value, 'then') === 'function'
    );
}

function assertSynchronousResult(label: string, result: unknown): void {
    if (isPromiseLike(result)) throw new TypeError(`${label} must be synchronous`);
}

function positiveInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive safe integer`);
    }
    return value;
}

function finiteViewport(viewport: RendererViewport, name: string): void {
    const values: readonly unknown[] = viewport;
    const width: unknown = values[2];
    const height: unknown = values[3];
    if (
        values.length !== 4 ||
        !values.every(value => typeof value === 'number' && Number.isFinite(value)) ||
        typeof width !== 'number' ||
        width <= 0 ||
        typeof height !== 'number' ||
        height <= 0
    ) {
        throw new RangeError(`${name} must contain finite x/y and positive width/height values`);
    }
}

function createTextureGraphDescriptor(): MutableTextureGraphDescriptor {
    return {
        label: '',
        size: { width: 1, height: 1, depthOrArrayLayers: 1 },
        mipLevelCount: 1,
        sampleCount: 1,
        dimension: '2d',
        viewDimension: '2d',
        format: 'rgba8unorm',
        usage: RHITextureUsage.RENDER_ATTACHMENT
    };
}

function createBufferGraphDescriptor(): MutableBufferGraphDescriptor {
    return { label: '', size: 4, usage: 0 };
}

function graphBufferUsage(use: RenderGraphBufferReadUse | RenderGraphBufferWriteUse): number {
    switch (use) {
        case 'storage':
            return RHIBufferUsage.STORAGE;
        case 'vertex':
            return RHIBufferUsage.VERTEX;
        case 'index':
            return RHIBufferUsage.INDEX;
        case 'copy-source':
            return RHIBufferUsage.COPY_SRC;
        case 'indirect':
            return RHIBufferUsage.INDIRECT;
        case 'copy-destination':
            return RHIBufferUsage.COPY_DST;
        default:
            throw new TypeError(`Unsupported render graph buffer use ${String(use)}`);
    }
}

function normalizeBufferRange(
    buffer: BufferRecord,
    byteOffset = 0,
    byteLength = buffer.byteLength - byteOffset,
    operation: string
): Readonly<{ byteOffset: number; byteLength: number }> {
    if (
        !Number.isSafeInteger(byteOffset) ||
        !Number.isSafeInteger(byteLength) ||
        byteOffset < 0 ||
        byteLength < 1 ||
        byteOffset + byteLength > buffer.byteLength
    ) {
        throw new RangeError(
            `${operation} byte range [${String(byteOffset)}, ${String(byteOffset + byteLength)}) is invalid`
        );
    }
    if (byteOffset % 4 !== 0 || byteLength % 4 !== 0) {
        throw new RangeError(`${operation} byte offset and length must be 4-byte aligned`);
    }
    return { byteOffset, byteLength };
}

function createCopyCommand(): MutableCopyCommand {
    return {
        sourceHandle: 0 as RenderGraphTextureHandle,
        destinationHandle: 0 as RenderGraphTextureHandle,
        sourceInternal: 0 as RGTextureHandle,
        destinationInternal: 0 as RGTextureHandle,
        source: { texture: null },
        destination: { texture: null },
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

function createPersistentTargetResourceDescriptor(): MutablePersistentTargetResourceDescriptor {
    return {
        width: 1,
        height: 1,
        colorFormats: [],
        sampleCount: 1,
        multisampleAttachmentLifetime: 'persistent',
        depthStencilFormat: null,
        depthStencilSampled: false
    };
}

class CullingSlot {
    readonly planner = new RenderGraphFramePlanner();
    readonly renderList = new RenderList();
    readonly visibleMeshes: Mesh[] = [];
    readonly #collectVisible = (mesh: Mesh): void => {
        this.visibleMeshes.push(mesh);
    };
    handle = 0 as CullingResultsHandle;
    frameIndex = -1;
    camera: Camera | null = null;
    scene: RendererScene | null = null;
    lights: readonly Light[] = EMPTY_LIGHTS;
    used = false;

    build(
        handle: CullingResultsHandle,
        frameIndex: number,
        scene: RendererScene,
        camera: Camera,
        lightManager: LightManager,
        useInstanced: boolean,
        frustumCulling: boolean
    ): void {
        this.handle = handle;
        this.frameIndex = frameIndex;
        this.camera = camera;
        this.scene = scene;
        this.used = false;
        this.renderList.useInstanced = useInstanced;
        const plan = this.planner.build(
            scene,
            camera,
            this.renderList,
            lightManager,
            frustumCulling
        );
        this.lights = plan.lights;
        this.visibleMeshes.length = 0;
        this.renderList.traverse(this.#collectVisible);
    }

    activate(services: ScriptableRenderPipelineServices): Camera {
        const camera = this.camera;
        const scene = this.scene;
        if (camera === null || scene === null) throw new Error('Culling slot is incomplete');
        services.prepareScriptableCullingScene(scene, camera);
        const manager = services.lightManager;
        manager.reset();
        for (const light of this.lights) manager.addLight(light);
        manager.updateInfo(camera);
        refreshShadowAtlasSceneBinding(manager);
        return camera;
    }

    releaseFrameReferences(): void {
        this.planner.reset();
        this.renderList.reset();
        this.visibleMeshes.length = 0;
        this.camera = null;
        this.scene = null;
        this.lights = EMPTY_LIGHTS;
        this.frameIndex = -1;
        this.used = false;
    }
}

class RendererListSlot {
    readonly planner = new MeshDrawListPlanner();
    readonly selectedMeshes: Mesh[] = [];
    handle = 0 as RendererListHandle;
    frameIndex = -1;
    culling: CullingSlot | null = null;
    overrideMaterial: Material | null = null;
    plan: Readonly<MeshDrawListPlan> | null = null;

    build(
        handle: RendererListHandle,
        frameIndex: number,
        culling: CullingSlot,
        descriptor: Readonly<RendererListDescriptor>
    ): void {
        const queue: unknown = descriptor.queue;
        const sorting: unknown = descriptor.sorting;
        if (queue !== 'opaque' && queue !== 'transparent' && queue !== 'all') {
            throw new TypeError(`Unsupported renderer-list queue ${String(queue)}`);
        }
        if (
            sorting !== 'material-front-to-back' &&
            sorting !== 'back-to-front' &&
            sorting !== 'none'
        ) {
            throw new TypeError(`Unsupported renderer-list sorting ${String(sorting)}`);
        }
        if (
            sorting !== 'none' &&
            ((queue === 'opaque' && sorting !== 'material-front-to-back') ||
                (queue === 'transparent' && sorting !== 'back-to-front') ||
                (queue === 'all' && sorting !== 'material-front-to-back'))
        ) {
            throw new TypeError(
                `Renderer-list sorting ${sorting} is incompatible with queue ${queue}`
            );
        }
        this.handle = handle;
        this.frameIndex = frameIndex;
        this.culling = culling;
        this.overrideMaterial = descriptor.overrideMaterial ?? null;
        const selected = this.selectedMeshes;
        selected.length = 0;
        for (const mesh of culling.visibleMeshes) {
            const material = this.overrideMaterial ?? mesh.material;
            if (material === null) continue;
            if (descriptor.castShadowsOnly === true && !material.castShadows) continue;
            if (queue === 'opaque' && material.transparent) continue;
            if (queue === 'transparent' && !material.transparent) continue;
            selected.push(mesh);
        }
        this.plan = this.planner.build(
            selected,
            this.overrideMaterial,
            sorting !== 'none',
            sorting === 'none' ? null : culling.camera
        );
    }

    releaseFrameReferences(): void {
        this.planner.reset();
        this.selectedMeshes.length = 0;
        this.frameIndex = -1;
        this.culling = null;
        this.overrideMaterial = null;
        this.plan = null;
    }
}

type PipelineInvocationLease = object;

class TargetResourcesSlot {
    readonly #colors: RenderGraphTextureHandle[] = [];
    width = 1;
    height = 1;
    sampleCount: 1 | 4 = 1;
    colorAttachmentCount = 0;
    depthStencil: RenderGraphTextureHandle | null = null;

    configure(
        width: number,
        height: number,
        sampleCount: 1 | 4,
        colors: readonly RenderGraphTextureHandle[],
        depthStencil: RenderGraphTextureHandle | null
    ): void {
        this.width = width;
        this.height = height;
        this.sampleCount = sampleCount;
        this.colorAttachmentCount = colors.length;
        this.#colors.length = colors.length;
        for (let index = 0; index < colors.length; index += 1) {
            const handle = colors[index];
            if (handle !== undefined) this.#colors[index] = handle;
        }
        this.depthStencil = depthStencil;
    }

    color(index: number): RenderGraphTextureHandle {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.colorAttachmentCount) {
            throw new RangeError(`Color attachment ${String(index)} does not exist`);
        }
        const handle = this.#colors[index];
        if (handle === undefined) throw new Error('Target color attachment handle is incomplete');
        return handle;
    }
}

class TargetResourcesFacade implements RenderPipelineTargetResources {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;
    readonly #slot: TargetResourcesSlot;

    constructor(
        owner: ScriptableRenderPipelineContextImpl,
        lease: PipelineInvocationLease,
        slot: TargetResourcesSlot
    ) {
        this.#owner = owner;
        this.#lease = lease;
        this.#slot = slot;
        Object.freeze(this);
    }

    get width(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.width;
    }

    get height(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.height;
    }

    get sampleCount(): 1 | 4 {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.sampleCount;
    }

    get colorAttachmentCount(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.colorAttachmentCount;
    }

    get depthStencil(): RenderGraphTextureHandle | null {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.depthStencil;
    }

    color(index: number): RenderGraphTextureHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#slot.color(index);
    }
}

function compareFrameBinding(
    first: MutableFrameBindGroupEntry,
    second: MutableFrameBindGroupEntry
): number {
    return first.binding - second.binding;
}

class ScriptableFullscreenDraw {
    readonly draw: PreparedDraw;
    readonly #inputHandles: RGTextureHandle[] = [];
    readonly #uniformHandles: ResourceRegistryHandle<RHIBuffer>[] = [];
    readonly #groups: (FrameBindGroupScratch | undefined)[] = [];
    #pipeline: Readonly<PipelineResourceRecord> | null = null;
    #frameIndex = -1;

    constructor(maxBindGroups: number) {
        this.draw = new PreparedDraw(maxBindGroups, 1);
    }

    configure(
        pipeline: Readonly<PipelineResourceRecord>,
        inputs: readonly RGTextureHandle[],
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
        const sampler = registry.resolve(fullscreen.defaultSampler);
        fullscreen.resourceUses.use(fullscreen.defaultSampler);
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

    readTexture(texture: RenderGraphTextureHandle): void {
        this.#slot.readTextureFromSetup(this.#lease, texture);
    }

    writeStorageTexture(texture: RenderGraphTextureHandle): void {
        this.#slot.writeStorageTextureFromSetup(this.#lease, texture);
    }

    copyTexture(source: RenderGraphTextureHandle, destination: RenderGraphTextureHandle): void {
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

    copyTexture(source: RenderGraphTextureHandle, destination: RenderGraphTextureHandle): void {
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

class ScriptablePassSlot {
    readonly draw = new SharedDrawPassParameters();
    readonly ranges: RendererListRange[] = [];
    readonly sampledHandles = new Set<RenderGraphTextureHandle>();
    readonly sampledInternals = new Map<RenderGraphTextureHandle, RGTextureHandle>();
    readonly attachmentHandles = new Set<RenderGraphTextureHandle>();
    readonly sampledInternalHandles = new Set<RGTextureHandle>();
    readonly storageWriteInternalHandles = new Set<RGTextureHandle>();
    readonly copySourceInternalHandles = new Set<RGTextureHandle>();
    readonly copyDestinationInternalHandles = new Set<RGTextureHandle>();
    readonly attachmentInternalHandles = new Set<RGTextureHandle>();
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
    #gpuDrivenDraw: ScriptableGPUDrivenDraw | null = null;
    #activeGPUDrivenDraw = false;
    #sceneStorageVariant: Readonly<SceneStorageShaderVariant> | null = null;
    #sceneStorageBindingCount = 0;
    #sceneStorageBindGroup: RHIBindGroup | null = null;
    #activeSceneStorage = false;
    readonly #sceneStoragePlans: MutableSceneStorageBindingPlan[] = [];
    readonly #sceneStoragePreparation: StorageScenePreparationState = {
        globalBindGroupLayout: null
    };
    readonly #sceneStorageEntries: MutableFrameBindGroupEntry[] = [];
    readonly #sceneStorageDescriptor = {
        label: 'Scene pass-global readonly storage',
        lifetime: 'frame' as const,
        layout: null as RHIBindGroupLayout | null,
        entries: this.#sceneStorageEntries
    };
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
        const draw = this.#gpuDrivenDraw;
        if (!this.#activeGPUDrivenDraw || draw === null) return;
        draw.prepare(context);
    };
    readonly #prepareSceneStorage = (context: RGPrepareContext): void => {
        if (!this.#activeSceneStorage) return;
        this.prepareSceneStorage(context);
    };

    constructor() {
        const getPassName = (): string => this.#pass?.name ?? '<scriptable-pass>';
        this.template = Object.freeze({
            get name(): string {
                return getPassName();
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
        this.#activeGPUDrivenDraw = false;
        this.#activeSceneStorage = false;
        this.#sceneStorageVariant = null;
        this.#sceneStorageBindingCount = 0;
        this.#sceneStoragePreparation.globalBindGroupLayout = null;
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
                        this.#gpuDrivenDraw?.releaseFrameReferences();
                    } finally {
                        this.cleanupSceneStorage(resources);
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
            this.#activeGPUDrivenDraw = false;
            this.#activeSceneStorage = false;
            this.#sceneStorageVariant = null;
            this.#sceneStoragePreparation.globalBindGroupLayout = null;
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

    private finishSetup(builder: RGPassBuilder): void {
        const owner = this.requireOwner();
        if (this.rendererListHandles.size > 0 && !this.#hasRasterAttachments) {
            throw new Error('A pass using renderer lists requires a color or depth attachment');
        }
        if (this.#hasRasterAttachments) this.configureDefaultViewport(owner);
        const pass = this.requirePass();
        if (pass instanceof FullscreenRenderPass) {
            if (this.rendererListHandles.size !== 0) {
                throw new Error('FullscreenRenderPass cannot declare a renderer list');
            }
            const parameters = this.requireParameters() as FullscreenRenderPassParameters;
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
        if (pass instanceof ComputeRenderPass) {
            if (this.#hasRasterAttachments || this.rendererListHandles.size !== 0) {
                throw new Error('ComputeRenderPass cannot declare raster attachments or lists');
            }
            this.#computeServices.configure(owner);
            this.#computeDispatch = owner.configureComputeDispatch(
                this.#computeDispatch,
                pass,
                this.requireParameters() as ComputeRenderPassParameters,
                this.#computeServices
            );
            this.#activeComputeDispatch = true;
        }
        if (pass instanceof GPUDrivenRenderPass) {
            if (!this.#hasRasterAttachments) {
                throw new Error('GPUDrivenRenderPass requires raster attachments');
            }
            if (this.rendererListHandles.size !== 0) {
                throw new Error('GPUDrivenRenderPass cannot declare renderer lists');
            }
            this.#gpuDrivenServices.configure(owner);
            this.#gpuDrivenDraw = owner.configureGPUDrivenDraw(
                this.#gpuDrivenDraw,
                pass,
                this.requireParameters() as GPUDrivenRenderPassParameters,
                this.targetDescriptor,
                this.#gpuDrivenServices
            );
            this.#activeGPUDrivenDraw = true;
            this.draw.addDraw(this.#gpuDrivenDraw.draw);
            this.draw.setPrepare(this.#prepareGPUDrivenDraw);
        }
        if (pass instanceof SceneRenderPass) {
            const parameters = this.requireParameters() as SceneRenderPassParameters;
            const variant = parameters.storageShaderVariant;
            if (variant !== undefined) {
                this.configureSceneStorage(owner, variant);
                this.#activeSceneStorage = true;
                this.draw.setPrepare(this.#prepareSceneStorage);
            }
        }
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
                this.targetDescriptor,
                this.#sceneStorageVariant,
                this.#sceneStoragePreparation
            );
            range.count = this.draw.drawCount - range.start;
            this.#rangeCount++;
        }
        this.draw.declare(builder, false);
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
        const layoutHandle = this.#sceneStoragePreparation.globalBindGroupLayout;
        if (layoutHandle === null) {
            if (this.draw.drawCount === 0) return;
            throw new Error('Scene storage draw preparation did not produce a global layout');
        }
        this.cleanupSceneStorage(owner.resources);
        const registry = owner.services.getScriptableGPUDrivenPipelineResources().registry;
        const layout = registry.resolve(layoutHandle);
        this.#sceneStorageDescriptor.layout = layout;
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
        const bindGroup = registry.createFrameBindGroup(
            this.#sceneStorageDescriptor as RHIBindGroupDescriptor
        );
        this.#sceneStorageBindGroup = bindGroup;
        owner.resources.trackFrameBindGroup(bindGroup);
        for (let index = 0; index < this.#rangeCount; index += 1) {
            const range = this.ranges[index];
            if (range === undefined) continue;
            this.draw.setPreparedBindGroupForRange(
                range.start,
                range.count,
                SCENE_STORAGE_BIND_GROUP,
                bindGroup
            );
        }
    }

    private cleanupSceneStorage(resources: ScriptableRenderPipelineResources): void {
        const bindGroup = this.#sceneStorageBindGroup;
        this.#sceneStorageBindGroup = null;
        if (bindGroup !== null) resources.releaseFrameBindGroup(bindGroup);
        this.#sceneStorageDescriptor.layout = null;
        for (let index = 0; index < this.#sceneStorageBindingCount; index += 1) {
            const plan = this.#sceneStoragePlans[index];
            if (plan === undefined) continue;
            plan.resource.buffer = null;
            plan.entry.resource = null;
        }
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
                    this.#gpuDrivenDraw?.cleanup(this.requireOwner().resources);
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
        texture: RenderGraphTextureHandle
    ): void {
        this.assertSetupLeaseActive(lease);
        this.readTexture(texture);
    }

    writeStorageTextureFromSetup(
        lease: ScriptablePassCallbackLease,
        texture: RenderGraphTextureHandle
    ): void {
        this.assertSetupLeaseActive(lease);
        this.writeStorageTexture(texture);
    }

    copyTextureFromSetup(
        lease: ScriptablePassCallbackLease,
        source: RenderGraphTextureHandle,
        destination: RenderGraphTextureHandle
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
        source: RenderGraphTextureHandle,
        destination: RenderGraphTextureHandle
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

    private readTexture(handle: RenderGraphTextureHandle): void {
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

    private writeStorageTexture(handle: RenderGraphTextureHandle): void {
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
        if (!complete && !record.initialized) {
            throw new Error('A partial buffer clear requires initialized existing contents');
        }
        const internal = owner.resolveBuffer(handle, 'copy-destination');
        this.requireSetupBuilder().writeBuffer(internal, 'copy-destination');
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
        sourceHandle: RenderGraphTextureHandle,
        destinationHandle: RenderGraphTextureHandle
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
            sourceRecord.height !== destinationRecord.height
        ) {
            throw new Error('Texture copy requires matching source and destination extents');
        }
        if (sourceRecord.format !== destinationRecord.format) {
            throw new Error('Texture copy requires matching source and destination formats');
        }
        if (
            sourceRecord.mipLevelCount !== destinationRecord.mipLevelCount ||
            sourceRecord.mipLevelCount !== 1
        ) {
            throw new Error('Texture copy requires single-mip source and destination textures');
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
    }

    private useColorAttachment(options: Readonly<RenderPipelineColorAttachment>): void {
        this.requireSetupBuilder();
        const owner = this.requireOwner();
        const record = owner.requireTexture(options.texture);
        const texture = owner.resolveTexture(options.texture, 'attachment');
        this.assertAttachmentInternalAccess(texture);
        this.attachmentHandles.add(options.texture);
        this.attachmentInternalHandles.add(texture);
        let resolveTarget: RGTextureHandle | undefined;
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

    private mergeTargetShape(record: TextureRecord): void {
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
        sourceHandle: RenderGraphTextureHandle,
        destinationHandle: RenderGraphTextureHandle
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
            if (
                source.width !== destination.width ||
                source.height !== destination.height ||
                source.depthOrArrayLayers !== destination.depthOrArrayLayers ||
                source.mipLevelCount !== destination.mipLevelCount ||
                source.dimension !== destination.dimension ||
                source.descriptor.viewDimension !== destination.descriptor.viewDimension ||
                source.format !== destination.format ||
                source.sampleCount !== destination.sampleCount
            ) {
                throw new Error(
                    'Texture copy requires matching source and destination descriptors'
                );
            }
            if (source.sampleCount !== 1 || source.mipLevelCount !== 1) {
                throw new Error(
                    'Texture copy requires single-sample, single-mip source and destination textures'
                );
            }
            command.source.texture = source;
            command.destination.texture = destination;
            command.size.width = source.width;
            command.size.height = source.height;
            command.size.depthOrArrayLayers = source.depthOrArrayLayers;
            validateRHITextureToTextureCopyParameters(
                command.source as { readonly texture: RHITexture },
                command.destination as { readonly texture: RHITexture },
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

    private assertReadableInternalAccess(handle: RGTextureHandle): void {
        if (
            this.storageWriteInternalHandles.has(handle) ||
            this.copyDestinationInternalHandles.has(handle) ||
            this.attachmentInternalHandles.has(handle)
        ) {
            throw new Error('Same-pass texture feedback is not portable');
        }
    }

    private assertWritableInternalAccess(handle: RGTextureHandle): void {
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

    private assertAttachmentInternalAccess(handle: RGTextureHandle): void {
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

class PipelineClearColorFacade implements Readonly<RenderTargetColor> {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        Object.freeze(this);
    }

    get r(): number {
        return this.#owner.readClearColorState(this.#lease).r;
    }

    get g(): number {
        return this.#owner.readClearColorState(this.#lease).g;
    }

    get b(): number {
        return this.#owner.readClearColorState(this.#lease).b;
    }

    get a(): number {
        return this.#owner.readClearColorState(this.#lease).a;
    }
}

class PipelineOutputAttachmentClearColorFacade implements Readonly<RenderTargetColor> {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;
    readonly #index: number;

    constructor(
        owner: ScriptableRenderPipelineContextImpl,
        lease: PipelineInvocationLease,
        index: number
    ) {
        this.#owner = owner;
        this.#lease = lease;
        this.#index = index;
        Object.freeze(this);
    }

    get r(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.r;
    }

    get g(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.g;
    }

    get b(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.b;
    }

    get a(): number {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).clearValue.a;
    }
}

class PipelineOutputColorAttachmentFacade implements Readonly<RenderPipelineOutputColorAttachment> {
    readonly #clearValue: Readonly<RenderTargetColor>;
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;
    readonly #index: number;

    constructor(
        owner: ScriptableRenderPipelineContextImpl,
        lease: PipelineInvocationLease,
        index: number
    ) {
        this.#owner = owner;
        this.#lease = lease;
        this.#index = index;
        this.#clearValue = new PipelineOutputAttachmentClearColorFacade(owner, lease, index);
        Object.freeze(this);
    }

    get clearValue(): Readonly<RenderTargetColor> {
        void this.#owner.readOutputColorAttachmentState(this.#lease, this.#index);
        return this.#clearValue;
    }

    get loadOp(): RenderTargetLoadOp {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).loadOp;
    }

    get storeOp(): RenderTargetStoreOp {
        return this.#owner.readOutputColorAttachmentState(this.#lease, this.#index).storeOp;
    }
}

class PipelineOutputDepthStencilAttachmentFacade implements Readonly<RenderPipelineOutputDepthStencilAttachment> {
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        Object.freeze(this);
    }

    get depthClearValue(): number {
        return this.#owner.readOutputDepthStencilState(this.#lease).depthClearValue;
    }

    get depthLoadOp(): RenderTargetLoadOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).depthLoadOp;
    }

    get depthStoreOp(): RenderTargetStoreOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).depthStoreOp;
    }

    get stencilClearValue(): number {
        return this.#owner.readOutputDepthStencilState(this.#lease).stencilClearValue;
    }

    get stencilLoadOp(): RenderTargetLoadOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).stencilLoadOp;
    }

    get stencilStoreOp(): RenderTargetStoreOp {
        return this.#owner.readOutputDepthStencilState(this.#lease).stencilStoreOp;
    }
}

class PipelineOutputFacade implements RenderPipelineOutput {
    readonly #colorAttachments: PipelineOutputColorAttachmentFacade[] = [];
    readonly #depthStencilAttachment: Readonly<RenderPipelineOutputDepthStencilAttachment>;
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        this.#depthStencilAttachment = new PipelineOutputDepthStencilAttachmentFacade(owner, lease);
        Object.freeze(this);
    }

    get kind(): RenderPipelineOutput['kind'] {
        return this.#owner.readOutputState(this.#lease).kind;
    }

    get width(): number {
        return this.#owner.readOutputState(this.#lease).width;
    }

    get height(): number {
        return this.#owner.readOutputState(this.#lease).height;
    }

    get sampleCount(): 1 | 4 {
        return this.#owner.readOutputState(this.#lease).sampleCount;
    }

    get colorAttachmentCount(): number {
        return this.#owner.readOutputState(this.#lease).colorAttachmentCount;
    }

    get depthStencilFormat(): RenderPipelineOutput['depthStencilFormat'] {
        return this.#owner.readOutputState(this.#lease).depthStencilFormat;
    }

    get depthStencilAttachment(): Readonly<RenderPipelineOutputDepthStencilAttachment> | null {
        return this.#owner.readOutputState(this.#lease).depthStencilFormat === null
            ? null
            : this.#depthStencilAttachment;
    }

    colorFormat(index: number): RenderTargetColorFormat {
        return this.#owner.readOutputColorFormat(this.#lease, index);
    }

    colorAttachment(index: number): Readonly<RenderPipelineOutputColorAttachment> {
        void this.#owner.readOutputColorAttachmentState(this.#lease, index);
        let facade = this.#colorAttachments[index];
        if (facade === undefined) {
            facade = new PipelineOutputColorAttachmentFacade(this.#owner, this.#lease, index);
            this.#colorAttachments[index] = facade;
        }
        return facade;
    }
}

class RenderPipelineContextLease implements RenderPipelineContext, ScriptableRenderGraph {
    readonly #viewport: RendererViewport;
    readonly #clearColor: Readonly<RenderTargetColor>;
    readonly #output: RenderPipelineOutput;
    readonly #owner: ScriptableRenderPipelineContextImpl;
    readonly #lease: PipelineInvocationLease;

    constructor(owner: ScriptableRenderPipelineContextImpl, lease: PipelineInvocationLease) {
        this.#owner = owner;
        this.#lease = lease;
        const viewport: number[] = [];
        for (let index = 0; index < 4; index += 1) {
            Object.defineProperty(viewport, index, {
                enumerable: true,
                get: (): number => this.#owner.readViewportComponent(this.#lease, index)
            });
        }
        this.#viewport = Object.freeze(viewport) as unknown as RendererViewport;
        this.#clearColor = new PipelineClearColorFacade(owner, lease);
        this.#output = new PipelineOutputFacade(owner, lease);
        Object.freeze(this);
    }

    get frameIndex(): number {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.frameIndex;
    }

    get scene(): RendererScene {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.scene;
    }

    get camera(): Camera {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.camera;
    }

    get viewport(): RendererViewport {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#viewport;
    }

    get clearColor(): Readonly<RenderTargetColor> {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#clearColor;
    }

    get output(): RenderPipelineOutput {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#output;
    }

    get capabilities(): RenderPipelineCapabilities {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.capabilities;
    }

    get graph(): ScriptableRenderGraph {
        this.#owner.assertLeaseActive(this.#lease);
        return this;
    }

    cull(options?: Readonly<CullingOptions>): CullingResultsHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.cull(options);
    }

    createRendererList(descriptor: Readonly<RendererListDescriptor>): RendererListHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createRendererList(descriptor);
    }

    recordShadows(cullingResults: CullingResultsHandle): void {
        this.#owner.assertLeaseActive(this.#lease);
        this.#owner.recordShadows(cullingResults);
    }

    acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.acquirePassParameters(pool);
    }

    createTexture(
        name: string,
        descriptor: Readonly<RenderPipelineTextureDescriptor>
    ): RenderGraphTextureHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createTexture(name, descriptor);
    }

    createBuffer(
        name: string,
        descriptor: Readonly<RenderPipelineBufferDescriptor>
    ): RenderGraphBufferHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.createBuffer(name, descriptor);
    }

    importStorageBuffer(buffer: StorageBuffer): RenderGraphBufferHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.importStorageBuffer(buffer);
    }

    importOutput(): RenderPipelineTargetResources {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.importOutput();
    }

    importRenderTarget(target: RenderTarget): RenderPipelineTargetResources {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.importRenderTarget(target);
    }

    acquirePersistentTarget(
        key: object,
        descriptor: Readonly<RenderPipelinePersistentTargetDescriptor>
    ): RenderPipelineTargetResources {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.acquirePersistentTarget(key, descriptor);
    }

    releasePersistentTarget(key: object): boolean {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.releasePersistentTarget(key);
    }

    addPass<P extends object>(pass: ScriptableRenderPass<P>, parameters: P): RenderGraphPassHandle {
        this.#owner.assertLeaseActive(this.#lease);
        return this.#owner.addPass(pass, parameters);
    }
}

/** @internal High-water storage behind per-invocation public pipeline leases. */
export class ScriptableRenderPipelineContextImpl implements ScriptableComputeGraphResolver {
    readonly #viewportState: [number, number, number, number] = [0, 0, 1, 1];
    readonly rhiViewport: MutableRHIViewport = {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        minDepth: 0,
        maxDepth: 1
    };
    readonly #outputState: MutablePipelineOutputState = {
        kind: 'surface',
        width: 1,
        height: 1,
        sampleCount: 1,
        colorAttachmentCount: 1,
        depthStencilFormat: null
    };
    readonly #outputColorAttachmentStates: MutablePipelineOutputColorAttachmentState[] = [];
    readonly #outputDepthStencilState: MutablePipelineOutputDepthStencilAttachmentState = {
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
        stencilClearValue: 0,
        stencilLoadOp: 'clear',
        stencilStoreOp: 'discard'
    };
    readonly #clearColorState: MutableRenderTargetColor = { r: 0, g: 0, b: 0, a: 1 };

    readonly #cullingSlots: CullingSlot[] = [];
    readonly #cullingByHandle = new Map<CullingResultsHandle, CullingSlot>();
    readonly #rendererListSlots: RendererListSlot[] = [];
    readonly #rendererListByHandle = new Map<RendererListHandle, RendererListSlot>();
    readonly #textureRecords: TextureRecord[] = [];
    readonly #textureByHandle = new Map<RenderGraphTextureHandle, TextureRecord>();
    readonly #bufferRecords: BufferRecord[] = [];
    readonly #bufferByHandle = new Map<RenderGraphBufferHandle, BufferRecord>();
    readonly #targetSlots: TargetResourcesSlot[] = [];
    readonly #passSlots: ScriptablePassSlot[] = [];
    readonly #passByHandle = new Map<RenderGraphPassHandle, RGPassHandle>();
    readonly #targetColorScratch: RenderGraphTextureHandle[] = [];
    readonly #fullscreenInputScratch: RGTextureHandle[] = [];
    readonly #fullscreenUniformScratch: ResourceRegistryHandle<RHIBuffer>[] = [];
    readonly #outputColorFormats: RenderTargetColorFormat[] = [];
    readonly #persistentTargetDescriptors: MutablePersistentTargetResourceDescriptor[] = [];
    readonly #beforeEventMeshSet = new Set<Mesh>();
    readonly #beforeEventMeshScratch: Mesh[] = [];
    readonly #eventMeshes: Mesh[] = [];
    readonly #eventMeshSet = new Set<Mesh>();
    readonly #cleanupFailures: unknown[] = [];

    #scope: RenderGraphFrameBuildScope | null = null;
    #scene: RendererScene | null = null;
    #camera: Camera | null = null;
    #target: RenderTarget | null = null;
    #fireEvent = false;
    #capabilities: RenderPipelineCapabilities | null = null;
    #runtimeOwner: object | null = null;
    #activeLease: PipelineInvocationLease | null = null;
    #cullingCursor = 0;
    #rendererListCursor = 0;
    #textureCursor = 0;
    #bufferCursor = 0;
    #targetSlotCursor = 0;
    #passCursor = 0;
    #persistentTargetDescriptorCursor = 0;
    #shadowPassCount = 0;
    #shadowsRecorded = false;
    #shadowCulling: CullingSlot | null = null;
    #hasTerminalWork = false;
    #active = false;
    #outputFacade: TargetResourcesFacade | null = null;
    #storageBufferBySource = new WeakMap<RendererStorageBuffer, BufferRecord>();

    constructor(
        readonly services: ScriptableRenderPipelineServices,
        readonly resources: ScriptableRenderPipelineResources
    ) {
        Object.freeze(this);
    }

    get frameIndex(): number {
        return this.requireScope().context.frameIndex;
    }

    get scene(): RendererScene {
        this.assertActive();
        return this.requireScene();
    }

    get camera(): Camera {
        this.assertActive();
        return this.requireCamera();
    }

    get outputWidth(): number {
        this.assertActive();
        return this.#outputState.width;
    }

    get outputHeight(): number {
        this.assertActive();
        return this.#outputState.height;
    }

    get capabilities(): RenderPipelineCapabilities {
        if (this.#capabilities === null) throw new Error('Pipeline context is not active');
        return this.#capabilities;
    }

    begin(
        scene: RendererScene,
        camera: Camera,
        target: RenderTarget | null,
        fireEvent: boolean,
        capabilities: RenderPipelineCapabilities,
        runtimeOwner: object,
        scope: RenderGraphFrameBuildScope
    ): RenderPipelineContext {
        if (this.#active) throw new Error('Scriptable pipeline context is already active');
        this.#scope = scope;
        this.#scene = scene;
        this.#camera = camera;
        this.#target = target;
        this.#fireEvent = fireEvent;
        this.#capabilities = capabilities;
        this.#runtimeOwner = runtimeOwner;
        this.#cullingCursor = 0;
        this.#rendererListCursor = 0;
        this.#textureCursor = 0;
        this.#bufferCursor = 0;
        this.#targetSlotCursor = 0;
        this.#passCursor = 0;
        this.#persistentTargetDescriptorCursor = 0;
        this.#shadowPassCount = 0;
        this.#shadowsRecorded = false;
        this.#shadowCulling = null;
        this.#hasTerminalWork = false;
        this.#outputFacade = null;
        this.#beforeEventMeshSet.clear();
        this.#beforeEventMeshScratch.length = 0;
        this.#eventMeshes.length = 0;
        this.#eventMeshSet.clear();
        this.#cullingByHandle.clear();
        this.#rendererListByHandle.clear();
        this.#textureByHandle.clear();
        this.#bufferByHandle.clear();
        this.#storageBufferBySource = new WeakMap();
        this.#passByHandle.clear();
        const rendererClearColor = this.services.renderer.clearColor;
        this.#clearColorState.r = rendererClearColor.r;
        this.#clearColorState.g = rendererClearColor.g;
        this.#clearColorState.b = rendererClearColor.b;
        this.#clearColorState.a = rendererClearColor.a;
        if (target === null) {
            const configuration = servicesConfiguration(this.services.getScriptableSurface());
            this.#outputState.kind = 'surface';
            this.#outputState.width = configuration.width;
            this.#outputState.height = configuration.height;
            this.#outputState.sampleCount = this.services.antialias ? 4 : 1;
            this.#outputState.colorAttachmentCount = 1;
            this.#outputColorFormats.length = 1;
            this.#outputColorFormats[0] = pipelineColorFormat(configuration.format);
            this.#outputState.depthStencilFormat = pipelineDepthFormat(
                configuration.depthStencilFormat
            );
            this.configureOutputColorAttachment(0, this.#clearColorState, 'clear', 'store');
            this.configureOutputDepthStencilAttachment(
                this.#outputState.depthStencilFormat === null
                    ? null
                    : {
                          depthClearValue: 1,
                          depthLoadOp: 'clear',
                          depthStoreOp: 'discard',
                          stencilClearValue: 0,
                          stencilLoadOp: 'clear',
                          stencilStoreOp: 'discard'
                      }
            );
            this.setViewport(
                this.services.renderer.offsetX,
                this.services.renderer.offsetY,
                configuration.width,
                configuration.height
            );
        } else {
            const resolved = this.services.resolveScriptableRenderTarget(target);
            this.#outputState.kind = 'render-target';
            this.#outputState.width = resolved.width;
            this.#outputState.height = resolved.height;
            this.#outputState.sampleCount = resolved.sampleCount;
            this.#outputState.colorAttachmentCount = resolved.colorAttachmentCount;
            this.#outputColorFormats.length = resolved.colorFormats.length;
            const normalized = resolved.normalizedParameters;
            for (let index = 0; index < resolved.colorFormats.length; index += 1) {
                const format = resolved.colorFormats[index];
                if (format !== undefined) this.#outputColorFormats[index] = format;
                const attachment = normalized.colorAttachments[index];
                if (attachment === undefined) {
                    throw new Error('Render-target color attachment policy is unavailable');
                }
                this.configureOutputColorAttachment(
                    index,
                    attachment.clearValue,
                    attachment.loadOp,
                    attachment.storeOp
                );
            }
            this.#outputState.depthStencilFormat = resolved.depthStencilFormat;
            this.configureOutputDepthStencilAttachment(normalized.depthStencilAttachment);
            this.setViewport(0, 0, resolved.width, resolved.height);
        }
        const lease = Object.freeze({});
        this.#activeLease = lease;
        this.#active = true;
        try {
            this.services.fireScriptableBeforeScene([], this.#fireEvent, true);
            return new RenderPipelineContextLease(this, lease);
        } catch (error) {
            this.end(false);
            throw error;
        }
    }

    end(completed: boolean): void {
        if (!this.#active) return;
        this.#activeLease = null;
        try {
            if (!completed) return;
            if (!this.#hasTerminalWork) {
                throw new Error(
                    'Render pipeline must write an output/persistent target or declare a side effect'
                );
            }
            if (this.#shadowPassCount > 0) {
                this.services.recordScriptablePass(this.#shadowPassCount);
            }
            this.services.queueScriptableAfterScene(this.#eventMeshes, this.#fireEvent);
            if (this.#target === null) {
                this.services.retainScriptablePresentation(
                    this.requireScene(),
                    this.requireCamera()
                );
            }
        } finally {
            this.#active = false;
            this.#scope = null;
            this.#scene = null;
            this.#camera = null;
            this.#target = null;
            this.#capabilities = null;
            this.#runtimeOwner = null;
            this.#activeLease = null;
        }
    }

    releaseFrameReferences(): void {
        const failures = this.#cleanupFailures;
        failures.length = 0;
        for (let index = 0; index < this.#passCursor; index += 1) {
            try {
                this.#passSlots[index]?.releaseFrameReferences(this.resources);
            } catch (error) {
                failures.push(error);
            }
        }
        for (let index = 0; index < this.#rendererListCursor; index += 1) {
            this.#rendererListSlots[index]?.releaseFrameReferences();
        }
        for (let index = 0; index < this.#cullingCursor; index += 1) {
            this.#cullingSlots[index]?.releaseFrameReferences();
        }
        for (let index = 0; index < this.#bufferCursor; index += 1) {
            const record = this.#bufferRecords[index];
            if (record === undefined) continue;
            record.name = '';
            record.internal = null;
            record.source = null;
            record.initialized = false;
        }
        this.#cullingByHandle.clear();
        this.#rendererListByHandle.clear();
        this.#textureByHandle.clear();
        this.#bufferByHandle.clear();
        this.#storageBufferBySource = new WeakMap();
        this.#passByHandle.clear();
        this.#outputFacade = null;
        this.#beforeEventMeshSet.clear();
        this.#beforeEventMeshScratch.length = 0;
        this.#eventMeshes.length = 0;
        this.#eventMeshSet.clear();
        this.#fireEvent = false;
        if (failures.length !== 0) {
            const failure = new AggregateError(
                failures,
                'Scriptable pipeline frame references failed during cleanup',
                { cause: failures[0] }
            );
            failures.length = 0;
            throw failure;
        }
    }

    cull(options: Readonly<CullingOptions> = {}): CullingResultsHandle {
        this.assertActive();
        const camera = options.camera ?? this.camera;
        if (!(camera instanceof Camera)) throw new TypeError('Culling camera must be a Camera');
        const handle = this.allocateHandle() as CullingResultsHandle;
        let slot = this.#cullingSlots[this.#cullingCursor++];
        if (slot === undefined) {
            slot = new CullingSlot();
            this.#cullingSlots.push(slot);
        }
        this.services.prepareScriptableCullingScene(this.scene, camera);
        slot.build(
            handle,
            this.frameIndex,
            this.scene,
            camera,
            this.services.lightManager,
            this.services.renderer.useInstanced,
            options.frustumCulling ?? true
        );
        this.#cullingByHandle.set(handle, slot);
        return handle;
    }

    createRendererList(descriptor: Readonly<RendererListDescriptor>): RendererListHandle {
        this.assertActive();
        const culling = this.requireCulling(descriptor.cullingResults);
        const handle = this.allocateHandle() as RendererListHandle;
        let slot = this.#rendererListSlots[this.#rendererListCursor++];
        if (slot === undefined) {
            slot = new RendererListSlot();
            this.#rendererListSlots.push(slot);
        }
        slot.build(handle, this.frameIndex, culling, descriptor);
        this.#rendererListByHandle.set(handle, slot);
        return handle;
    }

    recordShadows(cullingResults: CullingResultsHandle): void {
        this.assertActive();
        if (this.#shadowsRecorded) {
            throw new Error('A pipeline invocation can record the shared shadow atlas only once');
        }
        this.#shadowsRecorded = true;
        const culling = this.requireCulling(cullingResults);
        for (let index = 0; index < this.#cullingCursor; index += 1) {
            const used = this.#cullingSlots[index];
            if (used?.used === true && used !== culling) {
                throw new Error(
                    'Shadow recording and scene draws must use the same culling results'
                );
            }
        }
        this.#shadowCulling = culling;
        const camera = culling.activate(this.services);
        this.#shadowPassCount += this.services.recordScriptableShadows(
            culling.visibleMeshes,
            camera,
            this.rhiViewport,
            this.#outputState.width,
            this.#outputState.height
        );
    }

    acquirePassParameters<P extends object>(pool: RenderPassParameterPool<P>): P {
        this.assertActive();
        const owner = this.#runtimeOwner;
        if (owner === null) throw new Error('Pipeline runtime owner is unavailable');
        return acquireRenderPassParameters(pool, owner, this.frameIndex);
    }

    createTexture(
        name: string,
        descriptor: Readonly<RenderPipelineTextureDescriptor>
    ): RenderGraphTextureHandle {
        this.assertActive();
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Render graph texture name must be non-empty');
        }
        const extent = this.resolveExtent(descriptor.extent);
        const sampleCount: unknown = descriptor.sampleCount ?? 1;
        if (sampleCount !== 1 && sampleCount !== 4) {
            throw new RangeError('Render graph texture sample count must be one or four');
        }
        const mipLevelCount = positiveInteger(
            descriptor.mipLevelCount ?? 1,
            'Render graph texture mipLevelCount'
        );
        if (sampleCount > 1 && mipLevelCount !== 1) {
            throw new RangeError('Multisampled render graph textures require one mip level');
        }
        return this.acquireTextureRecord({
            name,
            format: descriptor.format,
            width: extent.width,
            height: extent.height,
            sampleCount,
            mipLevelCount,
            attachment: null,
            readable: null,
            writable: null,
            resolveTarget: null,
            outputRoot: null,
            transient: true
        }).handle;
    }

    createBuffer(
        name: string,
        descriptor: Readonly<RenderPipelineBufferDescriptor>
    ): RenderGraphBufferHandle {
        this.assertActive();
        if (typeof name !== 'string' || name.length === 0) {
            throw new TypeError('Render graph buffer name must be non-empty');
        }
        if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 1) {
            throw new RangeError('Render graph buffer byteLength must be a positive safe integer');
        }
        if (descriptor.label !== undefined && typeof descriptor.label !== 'string') {
            throw new TypeError('Render graph buffer label must be a string');
        }
        return this.acquireBufferRecord({
            name: descriptor.label ?? name,
            byteLength: descriptor.byteLength,
            internal: null,
            source: null,
            transient: true,
            initialized: false
        }).handle;
    }

    importStorageBuffer(buffer: StorageBuffer): RenderGraphBufferHandle {
        this.assertActive();
        const source = this.services.resolveScriptableStorageBuffer(buffer);
        const existing = this.#storageBufferBySource.get(source);
        if (existing !== undefined) return existing.handle;
        const cache = this.services.getScriptableStorageBufferResources();
        const resource = cache.prepare(source);
        const initialized = cache.isInitializedAtFrameStart(source);
        const internal = this.requireScope().graph.importBuffer(
            source.label,
            resource,
            initialized
        );
        this.requireScope().graph.markOutput(internal);
        const record = this.acquireBufferRecord({
            name: source.label,
            byteLength: source.byteLength,
            internal,
            source,
            transient: false,
            initialized
        });
        this.#storageBufferBySource.set(source, record);
        return record.handle;
    }

    importOutput(): RenderPipelineTargetResources {
        this.assertActive();
        if (this.#outputFacade !== null) return this.#outputFacade;
        const target = this.#target;
        const facade =
            target === null
                ? this.importSurfaceOutput()
                : this.importTarget(this.services.resolveScriptableRenderTarget(target));
        this.#outputFacade = facade;
        return facade;
    }

    importRenderTarget(target: RenderTarget): RenderPipelineTargetResources {
        this.assertActive();
        return this.importTarget(this.services.resolveScriptableRenderTarget(target));
    }

    acquirePersistentTarget(
        key: object,
        descriptor: Readonly<RenderPipelinePersistentTargetDescriptor>
    ): RenderPipelineTargetResources {
        this.assertActive();
        const runtimeOwner = this.#runtimeOwner;
        if (runtimeOwner === null) throw new Error('Pipeline runtime owner is unavailable');
        const extent = this.resolveExtent(descriptor.extent);
        const targetResources = this.services.getScriptableTargetResources();
        let targetDescriptor =
            this.#persistentTargetDescriptors[this.#persistentTargetDescriptorCursor++];
        if (targetDescriptor === undefined) {
            targetDescriptor = createPersistentTargetResourceDescriptor();
            this.#persistentTargetDescriptors.push(targetDescriptor);
        }
        if (descriptor.label === undefined) delete targetDescriptor.label;
        else targetDescriptor.label = descriptor.label;
        targetDescriptor.width = extent.width;
        targetDescriptor.height = extent.height;
        targetDescriptor.colorFormats.length = descriptor.colorFormats.length;
        for (let index = 0; index < descriptor.colorFormats.length; index += 1) {
            const format = descriptor.colorFormats[index];
            if (format === undefined) {
                throw new TypeError('Persistent target color format array must not be sparse');
            }
            targetDescriptor.colorFormats[index] = format;
        }
        targetDescriptor.sampleCount = descriptor.sampleCount ?? 1;
        targetDescriptor.depthStencilFormat = descriptor.depthStencilFormat ?? null;
        const record = this.resources.preparePersistentTarget(
            runtimeOwner,
            key,
            this.frameIndex,
            targetResources,
            targetDescriptor
        );
        this.services.markScriptableTargetUsed(record);
        return this.importTargetRecord(record);
    }

    releasePersistentTarget(key: object): boolean {
        this.assertActive();
        const runtimeOwner = this.#runtimeOwner;
        if (runtimeOwner === null) throw new Error('Pipeline runtime owner is unavailable');
        return this.resources.releasePersistentTarget(runtimeOwner, key);
    }

    addPass<P extends object>(pass: ScriptableRenderPass<P>, parameters: P): RenderGraphPassHandle {
        this.assertActive();
        const passCandidate: unknown = pass;
        if (
            (typeof passCandidate !== 'object' && typeof passCandidate !== 'function') ||
            passCandidate === null
        ) {
            throw new TypeError('Scriptable render pass must be an object');
        }
        if (typeof pass.name !== 'string' || pass.name.length === 0) {
            throw new TypeError('Scriptable render pass name must be non-empty');
        }
        if (typeof pass.setup !== 'function' || typeof pass.execute !== 'function') {
            throw new TypeError('Scriptable render pass must implement setup() and execute()');
        }
        const parameterCandidate: unknown = parameters;
        if (
            (typeof parameterCandidate !== 'object' && typeof parameterCandidate !== 'function') ||
            parameterCandidate === null
        ) {
            throw new TypeError('Scriptable render pass parameters must be an object');
        }
        const publicHandle = this.allocateHandle() as RenderGraphPassHandle;
        let slot = this.#passSlots[this.#passCursor++];
        if (slot === undefined) {
            slot = new ScriptablePassSlot();
            this.#passSlots.push(slot);
        }
        slot.begin(this, pass, parameters, this.capabilities);
        const internal = this.requireScope().graph.addPass(slot.template, slot);
        slot.commitSetupState();
        this.#passByHandle.set(publicHandle, internal);
        return publicHandle;
    }

    assertLeaseActive(lease: PipelineInvocationLease): void {
        if (!this.#active || this.#activeLease !== lease) {
            throw new Error('RenderPipelineContext is valid only during synchronous record()');
        }
    }

    requireRendererList(handle: RendererListHandle): RendererListSlot {
        const slot = this.#rendererListByHandle.get(handle);
        if (slot?.frameIndex !== this.frameIndex) {
            throw new Error(`Renderer list handle ${String(handle)} is stale or invalid`);
        }
        return slot;
    }

    resolvePass(handle: RenderGraphPassHandle): RGPassHandle {
        const pass = this.#passByHandle.get(handle);
        if (pass === undefined) {
            throw new Error(`Render graph pass handle ${String(handle)} is stale or invalid`);
        }
        return pass;
    }

    requireTexture(handle: RenderGraphTextureHandle): TextureRecord {
        const record = this.#textureByHandle.get(handle);
        if (record === undefined) {
            throw new Error(`Render graph texture handle ${String(handle)} is stale or invalid`);
        }
        return record;
    }

    requireBuffer(handle: RenderGraphBufferHandle): BufferRecord {
        const record = this.#bufferByHandle.get(handle);
        if (record === undefined) {
            throw new Error(`Render graph buffer handle ${String(handle)} is stale or invalid`);
        }
        return record;
    }

    bufferByteLength(handle: RenderGraphBufferHandle): number {
        return this.requireBuffer(handle).byteLength;
    }

    resolveBuffer(
        handle: RenderGraphBufferHandle,
        use: RenderGraphBufferReadUse | RenderGraphBufferWriteUse
    ): RGBufferHandle {
        const record = this.requireBuffer(handle);
        const usage = graphBufferUsage(use);
        let internal = record.internal;
        if (internal === null) {
            if (!record.transient) {
                throw new Error(`${record.name} does not support requested buffer access`);
            }
            const descriptor = record.graphDescriptor;
            descriptor.label = record.name;
            descriptor.size = record.byteLength;
            descriptor.usage = usage;
            internal = this.requireScope().graph.createBuffer(record.name, descriptor);
            record.internal = internal;
        } else this.requireScope().graph.addBufferUsage(internal, usage);
        return internal;
    }

    resolveTexture(handle: RenderGraphTextureHandle, access: TextureAccess): RGTextureHandle {
        const record = this.requireTexture(handle);
        if (
            access === 'storage-write' &&
            (record.sampleCount !== 1 || record.mipLevelCount !== 1)
        ) {
            throw new RangeError(
                `${record.name} storage writes require one complete single-sample 2d mip subresource`
            );
        }
        const usage =
            access === 'attachment' || access === 'resolve-target'
                ? RHITextureUsage.RENDER_ATTACHMENT
                : access === 'sampled'
                  ? RHITextureUsage.TEXTURE_BINDING
                  : access === 'storage-write'
                    ? RHITextureUsage.STORAGE_BINDING
                    : access === 'copy-source'
                      ? RHITextureUsage.COPY_SRC
                      : RHITextureUsage.COPY_DST;
        let internal =
            access === 'attachment'
                ? record.attachment
                : access === 'sampled' || access === 'copy-source'
                  ? record.readable
                  : record.writable;
        if (internal === null) {
            if (!record.transient) {
                throw new Error(`${record.name} does not support requested texture access`);
            }
            const descriptor = record.graphDescriptor;
            descriptor.label = record.name;
            descriptor.size.width = record.width;
            descriptor.size.height = record.height;
            descriptor.size.depthOrArrayLayers = 1;
            descriptor.mipLevelCount = record.mipLevelCount;
            descriptor.sampleCount = record.sampleCount;
            descriptor.format = record.format;
            descriptor.usage = usage;
            internal = this.requireScope().graph.createTexture(record.name, descriptor);
            record.attachment ??= internal;
            record.readable ??= internal;
            record.writable ??= internal;
        } else this.requireScope().graph.addTextureUsage(internal, usage);
        return internal;
    }

    noteTextureWrite(handle: RenderGraphTextureHandle): void {
        if (this.requireTexture(handle).outputRoot !== null) this.#hasTerminalWork = true;
    }

    noteBufferWrite(record: BufferRecord, internal: RGBufferHandle): void {
        if (record.source === null) return;
        if (record.internal !== internal) {
            throw new Error('Imported StorageBuffer graph identity is inconsistent');
        }
        this.#hasTerminalWork = true;
    }

    noteSideEffect(): void {
        this.#hasTerminalWork = true;
    }

    passAttachmentDimensions(
        attachments: ReadonlySet<RenderGraphTextureHandle>
    ): Readonly<{ width: number; height: number }> {
        let width = 0;
        let height = 0;
        for (const handle of attachments) {
            const record = this.requireTexture(handle);
            if (width === 0) {
                width = record.width;
                height = record.height;
            } else if (record.width !== width || record.height !== height) {
                throw new Error('Scriptable pass attachments require matching dimensions');
            }
        }
        if (width === 0 || height === 0) throw new Error('Scriptable pass has no attachments');
        return { width, height };
    }

    appendRendererListDraws(
        handle: RendererListHandle,
        drawPass: SharedDrawPassParameters,
        target: RHIMeshDrawTargetDescriptor,
        storageVariant: Readonly<SceneStorageShaderVariant> | null,
        storagePreparation: StorageScenePreparationState
    ): void {
        const list = this.requireRendererList(handle);
        const culling = list.culling;
        const plan = list.plan;
        if (culling === null || plan === null) throw new Error('Renderer list is incomplete');
        if (this.#shadowCulling !== null && this.#shadowCulling !== culling) {
            throw new Error('Shadow recording and scene draws must use the same culling results');
        }
        const camera = culling.activate(this.services);
        culling.used = true;
        const beforeEventMeshes = this.#beforeEventMeshScratch;
        beforeEventMeshes.length = 0;
        if (this.#fireEvent) {
            for (const mesh of list.selectedMeshes) {
                if (this.#beforeEventMeshSet.has(mesh)) continue;
                this.#beforeEventMeshSet.add(mesh);
                beforeEventMeshes.push(mesh);
            }
        }
        this.services.fireScriptableBeforeScene(beforeEventMeshes, this.#fireEvent, false);
        const context = this.services.createScriptableFrameContext(
            camera,
            this.rhiViewport,
            this.frameIndex
        );
        this.services.beginScriptableMeshPass(context);
        const processor = this.services.getScriptableMeshProcessor();
        const storagePipelines = this.services.getScriptableGPUDrivenPipelineResources();
        for (const mesh of plan.opaqueMeshes) {
            drawPass.addDrawSnapshot(
                storageVariant === null
                    ? processor.prepare(mesh, target, list.overrideMaterial)
                    : processor.prepareStorageScene(
                          mesh,
                          target,
                          storageVariant.shader,
                          storagePipelines,
                          storagePreparation,
                          list.overrideMaterial
                      )
            );
        }
        for (const batch of plan.instancedBatches) {
            if (batch.transparent) continue;
            if (storageVariant === null) {
                drawPass.addDrawSnapshot(
                    processor.prepareInstancedBatch(
                        batch,
                        batch.meshes,
                        target,
                        list.overrideMaterial
                    )
                );
                continue;
            }
            for (const mesh of batch.meshes) {
                drawPass.addDrawSnapshot(
                    processor.prepareStorageScene(
                        mesh,
                        target,
                        storageVariant.shader,
                        storagePipelines,
                        storagePreparation,
                        list.overrideMaterial,
                        true
                    )
                );
            }
        }
        for (const mesh of plan.transparentMeshes) {
            drawPass.addDrawSnapshot(
                storageVariant === null
                    ? processor.prepare(mesh, target, list.overrideMaterial)
                    : processor.prepareStorageScene(
                          mesh,
                          target,
                          storageVariant.shader,
                          storagePipelines,
                          storagePreparation,
                          list.overrideMaterial
                      )
            );
        }
        for (const batch of plan.instancedBatches) {
            if (!batch.transparent) continue;
            if (storageVariant === null) {
                drawPass.addDrawSnapshot(
                    processor.prepareInstancedBatch(
                        batch,
                        batch.meshes,
                        target,
                        list.overrideMaterial
                    )
                );
                continue;
            }
            for (const mesh of batch.meshes) {
                drawPass.addDrawSnapshot(
                    processor.prepareStorageScene(
                        mesh,
                        target,
                        storageVariant.shader,
                        storagePipelines,
                        storagePreparation,
                        list.overrideMaterial,
                        true
                    )
                );
            }
        }
        this.services
            .getScriptableTargetBridge()
            .addSampledTextureReads(
                this.requireScope().graph,
                drawPass,
                processor.sampledGraphDependencies
            );
    }

    recordRendererListDraw(handle: RendererListHandle): void {
        const list = this.#rendererListByHandle.get(handle);
        if (list === undefined) {
            throw new Error(`Renderer list handle ${String(handle)} is stale or invalid`);
        }
        this.services.recordScriptableFaces(list.selectedMeshes);
        for (const mesh of list.selectedMeshes) {
            if (this.#fireEvent && !this.#eventMeshSet.has(mesh)) {
                this.#eventMeshSet.add(mesh);
                this.#eventMeshes.push(mesh);
            }
        }
    }

    configureFullscreenDraw(
        retained: ScriptableFullscreenDraw | null,
        pass: FullscreenRenderPass,
        parameters: FullscreenRenderPassParameters,
        target: RHIMeshDrawTargetDescriptor,
        declaredInputs: ReadonlyMap<RenderGraphTextureHandle, RGTextureHandle>
    ): ScriptableFullscreenDraw {
        this.services.prepareScriptableCullingScene(this.scene, this.camera);
        const context = this.services.createScriptableFrameContext(
            this.camera,
            this.rhiViewport,
            this.frameIndex
        );
        this.services.beginScriptableMeshPass(context);
        this.services.beginScriptableFullscreenPass(context);
        const fullscreen = this.services.getScriptableFullscreenProcessor();
        const pipeline = fullscreen.prepareGraphPipeline(pass.shader, pass.material, target);
        const inputs = this.#fullscreenInputScratch;
        inputs.length = parameters.inputTextures.length;
        for (let index = 0; index < parameters.inputTextures.length; index += 1) {
            const publicHandle = parameters.inputTextures[index];
            if (publicHandle === undefined) {
                throw new TypeError('Fullscreen input texture array must not be sparse');
            }
            const internal = declaredInputs.get(publicHandle);
            if (internal === undefined) {
                throw new Error('Fullscreen input texture was not declared during setup');
            }
            const format = this.requireTexture(publicHandle).format;
            if (!this.capabilities.supportsTextureFormat(format, 'filterable-sampled')) {
                throw new Error(
                    `Fullscreen input texture format ${format} does not support linear filtering`
                );
            }
            inputs[index] = internal;
        }
        const processor = this.services.getScriptableMeshProcessor();
        const uniformHandles = this.#fullscreenUniformScratch;
        uniformHandles.length = pass.uniformBuffers.length;
        for (let index = 0; index < pass.uniformBuffers.length; index += 1) {
            const uniformBuffer = pass.uniformBuffers[index];
            if (uniformBuffer === undefined) {
                throw new TypeError('Fullscreen uniform buffer array must not be sparse');
            }
            processor.buffers.prepareUniformBuffer(uniformBuffer);
            const handle = processor.buffers.getUniformBufferHandle(uniformBuffer);
            processor.resourceUses.use(handle);
            uniformHandles[index] = handle;
        }
        const draw =
            retained ??
            new ScriptableFullscreenDraw(
                fullscreen.registry.deviceCapabilities.limits.maxBindGroups
            );
        draw.configure(pipeline, inputs, uniformHandles, this.frameIndex);
        return draw;
    }

    configureComputeDispatch(
        retained: ScriptableComputeDispatch | null,
        pass: ComputeRenderPass,
        parameters: ComputeRenderPassParameters,
        services: ScriptableComputeDispatchServices
    ): ScriptableComputeDispatch {
        if (this.services.renderer.backend !== 'webgpu') {
            throw new Error('ComputeRenderPass is supported only by the WebGPU renderer');
        }
        this.services.prepareScriptableCullingScene(this.scene, this.camera);
        const context = this.services.createScriptableFrameContext(
            this.camera,
            this.rhiViewport,
            this.frameIndex
        );
        this.services.beginScriptableMeshPass(context);
        const dispatch = retained ?? new ScriptableComputeDispatch();
        dispatch.configure(pass, parameters, this, services, this.frameIndex);
        return dispatch;
    }

    configureGPUDrivenDraw(
        retained: ScriptableGPUDrivenDraw | null,
        pass: GPUDrivenRenderPass,
        parameters: GPUDrivenRenderPassParameters,
        target: RHIMeshDrawTargetDescriptor,
        services: ScriptableGPUDrivenDrawServices
    ): ScriptableGPUDrivenDraw {
        if (this.services.renderer.backend !== 'webgpu') {
            throw new Error('GPUDrivenRenderPass is supported only by the WebGPU renderer');
        }
        this.services.prepareScriptableCullingScene(this.scene, this.camera);
        const context = this.services.createScriptableFrameContext(
            this.camera,
            this.rhiViewport,
            this.frameIndex
        );
        this.services.beginScriptableMeshPass(context);
        const draw = retained ?? new ScriptableGPUDrivenDraw();
        draw.configure(pass, parameters, this, services, target, this.frameIndex);
        return draw;
    }

    private importSurfaceOutput(): TargetResourcesFacade {
        const graph = this.requireScope().graph;
        const surface = this.services.getScriptableSurface();
        const configuration = servicesConfiguration(surface);
        const surfaceColor = importSurfaceColor(graph, surface, 'scriptable surface color');
        graph.markOutput(surfaceColor);
        const colors = this.#targetColorScratch;
        colors.length = 1;
        if (this.#outputState.sampleCount === 4) {
            const color = this.acquireTextureRecord({
                name: 'scriptable multisampled surface color',
                format: pipelineColorFormat(configuration.format),
                width: configuration.width,
                height: configuration.height,
                sampleCount: 4,
                mipLevelCount: 1,
                attachment: null,
                readable: surfaceColor,
                writable: surfaceColor,
                resolveTarget: surfaceColor,
                outputRoot: surfaceColor,
                transient: true
            });
            colors[0] = color.handle;
        } else {
            colors[0] = this.acquireImportedTextureRecord(
                'scriptable surface color',
                pipelineColorFormat(configuration.format),
                configuration.width,
                configuration.height,
                1,
                surfaceColor,
                surfaceColor,
                surfaceColor,
                null,
                surfaceColor
            ).handle;
        }
        let depth: RenderGraphTextureHandle | null = null;
        const depthFormat = configuration.depthStencilFormat;
        if (depthFormat !== null) {
            if (this.#outputState.sampleCount === 4) {
                depth = this.createTexture('scriptable multisampled surface depth-stencil', {
                    format: pipelineDepthFormat(depthFormat) ?? 'depth24plus',
                    extent: { width: configuration.width, height: configuration.height },
                    sampleCount: 4
                });
            } else {
                const internal = importSurfaceDepthStencil(
                    graph,
                    surface,
                    'scriptable surface depth-stencil'
                );
                depth = this.acquireImportedTextureRecord(
                    'scriptable surface depth-stencil',
                    pipelineDepthFormat(depthFormat) ?? 'depth24plus',
                    configuration.width,
                    configuration.height,
                    1,
                    internal,
                    internal,
                    internal,
                    null,
                    null
                ).handle;
            }
        }
        const slot = this.acquireTargetSlot();
        slot.configure(
            configuration.width,
            configuration.height,
            this.#outputState.sampleCount,
            colors,
            depth
        );
        const facade = new TargetResourcesFacade(this, this.requireActiveLease(), slot);
        this.services.markScriptableSurfaceRequested();
        return facade;
    }

    private importTarget(target: RHIRenderTarget): TargetResourcesFacade {
        const record = target.resourceRecord;
        this.services.markScriptableTargetUsed(record);
        return this.importTargetRecord(record);
    }

    private importTargetRecord(
        record: Readonly<RenderTargetResourceRecord>
    ): TargetResourcesFacade {
        const imported = this.services
            .getScriptableTargetBridge()
            .import(this.requireScope().graph, record);
        const colors = this.#targetColorScratch;
        colors.length = imported.colorAttachments.length;
        for (let index = 0; index < imported.colorAttachments.length; index += 1) {
            const color = imported.colorAttachments[index];
            if (color === undefined) throw new Error('Imported target color attachment is missing');
            const outputRoot = color.resolveTarget ?? color.readableTexture;
            this.requireScope().graph.markOutput(outputRoot);
            colors[index] = this.acquireImportedTextureRecord(
                `${record.label} color ${String(index)}`,
                pipelineColorFormat(color.format),
                imported.width,
                imported.height,
                imported.sampleCount,
                color.texture,
                color.readableTexture,
                color.readableTexture,
                color.resolveTarget,
                outputRoot
            ).handle;
        }
        let depth: RenderGraphTextureHandle | null = null;
        if (imported.depthStencilAttachment !== null && record.depthStencilAttachment !== null) {
            const internal = imported.depthStencilAttachment;
            this.requireScope().graph.markOutput(internal);
            depth = this.acquireImportedTextureRecord(
                `${record.label} depth-stencil`,
                pipelineDepthFormat(record.depthStencilAttachment.format) ?? 'depth24plus',
                imported.width,
                imported.height,
                imported.sampleCount,
                internal,
                internal,
                internal,
                null,
                internal
            ).handle;
        }
        const slot = this.acquireTargetSlot();
        slot.configure(imported.width, imported.height, imported.sampleCount, colors, depth);
        return new TargetResourcesFacade(this, this.requireActiveLease(), slot);
    }

    private acquireImportedTextureRecord(
        name: string,
        format: PipelineTextureFormat,
        width: number,
        height: number,
        sampleCount: 1 | 4,
        attachment: RGTextureHandle,
        readable: RGTextureHandle,
        writable: RGTextureHandle,
        resolveTarget: RGTextureHandle | null,
        outputRoot: RGTextureHandle | null
    ): TextureRecord {
        return this.acquireTextureRecord({
            name,
            format,
            width,
            height,
            sampleCount,
            mipLevelCount: 1,
            attachment,
            readable,
            writable,
            resolveTarget,
            outputRoot,
            transient: false
        });
    }

    private acquireTextureRecord(
        source: Omit<TextureRecord, 'handle' | 'graphDescriptor'>
    ): TextureRecord {
        let record = this.#textureRecords[this.#textureCursor++];
        if (record === undefined) {
            record = {
                handle: 0 as RenderGraphTextureHandle,
                name: '',
                format: 'rgba8unorm',
                width: 1,
                height: 1,
                sampleCount: 1,
                mipLevelCount: 1,
                attachment: null,
                readable: null,
                writable: null,
                resolveTarget: null,
                outputRoot: null,
                transient: false,
                graphDescriptor: createTextureGraphDescriptor()
            };
            this.#textureRecords.push(record);
        }
        record.handle = this.allocateHandle() as RenderGraphTextureHandle;
        record.name = source.name;
        record.format = source.format;
        record.width = source.width;
        record.height = source.height;
        record.sampleCount = source.sampleCount;
        record.mipLevelCount = source.mipLevelCount;
        record.attachment = source.attachment;
        record.readable = source.readable;
        record.writable = source.writable;
        record.resolveTarget = source.resolveTarget;
        record.outputRoot = source.outputRoot;
        record.transient = source.transient;
        this.#textureByHandle.set(record.handle, record);
        return record;
    }

    private acquireBufferRecord(
        source: Omit<BufferRecord, 'handle' | 'graphDescriptor'>
    ): BufferRecord {
        let record = this.#bufferRecords[this.#bufferCursor++];
        if (record === undefined) {
            record = {
                handle: 0 as RenderGraphBufferHandle,
                name: '',
                byteLength: 4,
                internal: null,
                source: null,
                transient: false,
                initialized: false,
                graphDescriptor: createBufferGraphDescriptor()
            };
            this.#bufferRecords.push(record);
        }
        record.handle = this.allocateHandle() as RenderGraphBufferHandle;
        record.name = source.name;
        record.byteLength = source.byteLength;
        record.internal = source.internal;
        record.source = source.source;
        record.transient = source.transient;
        record.initialized = source.initialized;
        record.graphDescriptor.label = source.name;
        record.graphDescriptor.size = source.byteLength;
        record.graphDescriptor.usage = 0;
        this.#bufferByHandle.set(record.handle, record);
        return record;
    }

    private acquireTargetSlot(): TargetResourcesSlot {
        let slot = this.#targetSlots[this.#targetSlotCursor++];
        if (slot === undefined) {
            slot = new TargetResourcesSlot();
            this.#targetSlots.push(slot);
        }
        return slot;
    }

    private requireCulling(handle: CullingResultsHandle): CullingSlot {
        const slot = this.#cullingByHandle.get(handle);
        if (slot?.frameIndex !== this.frameIndex) {
            throw new Error(`Culling result handle ${String(handle)} is stale or invalid`);
        }
        return slot;
    }

    private resolveExtent(extent: RenderPipelineExtent): { width: number; height: number } {
        if ('relativeTo' in extent) {
            const relativeTo: unknown = extent.relativeTo;
            if (relativeTo !== 'output') {
                throw new TypeError(`Unsupported relative extent ${String(relativeTo)}`);
            }
            if (!Number.isFinite(extent.scale) || extent.scale <= 0) {
                throw new RangeError('Relative texture extent scale must be positive and finite');
            }
            const minWidth = positiveInteger(extent.minWidth ?? 1, 'Texture minimum width');
            const minHeight = positiveInteger(extent.minHeight ?? 1, 'Texture minimum height');
            return {
                width: Math.max(minWidth, Math.floor(this.#outputState.width * extent.scale)),
                height: Math.max(minHeight, Math.floor(this.#outputState.height * extent.scale))
            };
        }
        return {
            width: positiveInteger(extent.width, 'Texture width'),
            height: positiveInteger(extent.height, 'Texture height')
        };
    }

    private setViewport(x: number, y: number, width: number, height: number): void {
        this.#viewportState[0] = x;
        this.#viewportState[1] = y;
        this.#viewportState[2] = width;
        this.#viewportState[3] = height;
        this.rhiViewport.x = x;
        this.rhiViewport.y = y;
        this.rhiViewport.width = width;
        this.rhiViewport.height = height;
        this.rhiViewport.minDepth = 0;
        this.rhiViewport.maxDepth = 1;
    }

    private allocateHandle(): number {
        return this.resources.allocateHandle();
    }

    private requireScope(): RenderGraphFrameBuildScope {
        if (this.#scope === null) throw new Error('Pipeline context has no graph scope');
        return this.#scope;
    }

    private requireScene(): RendererScene {
        if (this.#scene === null) throw new Error('Pipeline context has no scene');
        return this.#scene;
    }

    private requireCamera(): Camera {
        if (this.#camera === null) throw new Error('Pipeline context has no camera');
        return this.#camera;
    }

    private requireActiveLease(): PipelineInvocationLease {
        const lease = this.#activeLease;
        if (lease === null) {
            throw new Error('RenderPipelineContext is valid only during synchronous record()');
        }
        return lease;
    }

    readViewportComponent(lease: PipelineInvocationLease, index: number): number {
        this.assertLeaseActive(lease);
        const value = this.#viewportState[index];
        if (value === undefined) {
            throw new Error('Scriptable viewport storage is incomplete');
        }
        return value;
    }

    readClearColorState(lease: PipelineInvocationLease): Readonly<MutableRenderTargetColor> {
        this.assertLeaseActive(lease);
        return this.#clearColorState;
    }

    readOutputState(lease: PipelineInvocationLease): Readonly<MutablePipelineOutputState> {
        this.assertLeaseActive(lease);
        return this.#outputState;
    }

    readOutputColorFormat(lease: PipelineInvocationLease, index: number): RenderTargetColorFormat {
        this.assertLeaseActive(lease);
        return this.outputColorFormat(index);
    }

    readOutputColorAttachmentState(
        lease: PipelineInvocationLease,
        index: number
    ): Readonly<MutablePipelineOutputColorAttachmentState> {
        this.assertLeaseActive(lease);
        return this.requireOutputColorAttachmentState(index);
    }

    readOutputDepthStencilState(
        lease: PipelineInvocationLease
    ): Readonly<MutablePipelineOutputDepthStencilAttachmentState> {
        this.assertLeaseActive(lease);
        return this.requireOutputDepthStencilState();
    }

    private outputColorFormat(index: number): RenderTargetColorFormat {
        this.assertActive();
        if (
            !Number.isSafeInteger(index) ||
            index < 0 ||
            index >= this.#outputState.colorAttachmentCount
        ) {
            throw new RangeError(`Color attachment ${String(index)} does not exist`);
        }
        const format = this.#outputColorFormats[index];
        if (format === undefined) throw new Error('Output color format is unavailable');
        return format;
    }

    private configureOutputColorAttachment(
        index: number,
        clearValue: Readonly<RenderTargetColor>,
        loadOp: RenderTargetLoadOp,
        storeOp: RenderTargetStoreOp
    ): void {
        let state = this.#outputColorAttachmentStates[index];
        if (state === undefined) {
            state = {
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store'
            };
            this.#outputColorAttachmentStates[index] = state;
        }
        state.clearValue.r = clearValue.r;
        state.clearValue.g = clearValue.g;
        state.clearValue.b = clearValue.b;
        state.clearValue.a = clearValue.a;
        state.loadOp = loadOp;
        state.storeOp = storeOp;
    }

    private configureOutputDepthStencilAttachment(
        attachment: Readonly<MutablePipelineOutputDepthStencilAttachmentState> | null
    ): void {
        if (attachment === null) return;
        const state = this.#outputDepthStencilState;
        state.depthClearValue = attachment.depthClearValue;
        state.depthLoadOp = attachment.depthLoadOp;
        state.depthStoreOp = attachment.depthStoreOp;
        state.stencilClearValue = attachment.stencilClearValue;
        state.stencilLoadOp = attachment.stencilLoadOp;
        state.stencilStoreOp = attachment.stencilStoreOp;
    }

    private requireOutputColorAttachmentState(
        index: number
    ): Readonly<MutablePipelineOutputColorAttachmentState> {
        this.outputColorFormat(index);
        const state = this.#outputColorAttachmentStates[index];
        if (state === undefined) throw new Error('Output color attachment policy is unavailable');
        return state;
    }

    private requireOutputDepthStencilState(): Readonly<MutablePipelineOutputDepthStencilAttachmentState> {
        this.assertActive();
        if (this.#outputState.depthStencilFormat === null) {
            throw new Error('Output depth/stencil attachment does not exist');
        }
        return this.#outputDepthStencilState;
    }

    private assertActive(): void {
        if (!this.#active) {
            throw new Error('RenderPipelineContext is valid only during synchronous record()');
        }
    }
}

function servicesConfiguration(surface: RHISurface): NonNullable<RHISurface['configuration']> {
    const configuration = surface.configuration;
    if (surface.state !== 'configured' || configuration === null) {
        throw new Error(
            `Scriptable rendering requires a configured surface, received ${surface.state}`
        );
    }
    return configuration;
}

function pipelineColorFormat(format: RHITextureFormat): RenderTargetColorFormat {
    switch (format) {
        case 'rgba8unorm':
        case 'rgba8unorm-srgb':
        case 'rgba16float':
        case 'rgba32float':
            return format;
        default:
            throw new Error(`Surface color format ${format} is outside the public pipeline set`);
    }
}

function pipelineDepthFormat(
    format: RHITextureFormat | null
): RenderTargetDepthStencilFormat | null {
    switch (format) {
        case null:
        case 'depth16unorm':
        case 'depth24plus':
        case 'depth24plus-stencil8':
        case 'depth32float':
        case 'depth32float-stencil8':
            return format;
        default:
            throw new Error(`Depth/stencil format ${format} is outside the public pipeline set`);
    }
}
