import type {
    RHIBindGroup,
    RHITexture,
    RHITextureDimension,
    RHITextureFormat,
    RHITextureViewDimension
} from '../rhi/core';
import type {
    RenderTargetResourceCache,
    RenderTargetResourceDescriptor,
    RenderTargetResourceRecord
} from '../renderer/RenderTargetResourceCache';
import type { ResourceRegistry, ResourceRegistryHandle } from '../renderer/ResourceRegistry';
import type { PipelineTextureFormat } from './ScriptableRenderPipelineTypes';
import type { CompiledRenderGraph } from '../graph/RenderGraphCompiler';
import type { RGTextureHandle } from '../graph/RenderGraphResource';

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

export interface PersistentHistoryState {
    readonly key: object;
    descriptor: Readonly<HistoryTextureRecipe> | null;
    handles: ResourceRegistryHandle<RHITexture>[];
    initialized: boolean[];
    committedIndex: number;
    registryGeneration: number;
    generation: number;
    pendingDescriptor: Readonly<HistoryTextureRecipe> | null;
    pendingHandles: ResourceRegistryHandle<RHITexture>[];
    pendingInitialized: boolean[];
    frameHandles: ResourceRegistryHandle<RHITexture>[] | null;
    frameInitialized: boolean[] | null;
    frameWriteIndex: number;
    lastAcquiredFrameIndex: number;
    wroteThisFrame: boolean;
    storedThisFrame: boolean;
    writtenGraphTexture: RGTextureHandle | null;
    pendingRelease: boolean;
}

export interface HistoryTextureRecipe {
    readonly label: string;
    readonly width: number;
    readonly height: number;
    readonly depthOrArrayLayers: number;
    readonly mipLevelCount: number;
    readonly sampleCount: 1 | 4;
    readonly dimension: RHITextureDimension;
    readonly viewDimension: RHITextureViewDimension;
    readonly format: PipelineTextureFormat;
    readonly usage: number;
    readonly viewFormats: readonly RHITextureFormat[];
    readonly bufferCount: 2 | 3;
}

interface PreparedHistoryTexture {
    readonly state: PersistentHistoryState;
    readonly handles: readonly ResourceRegistryHandle<RHITexture>[];
    readonly initialized: readonly boolean[];
    readonly writeIndex: number;
    readonly generation: number;
}

/** @internal Runtime-scoped ownership identities for persistent SRP targets. */
export class ScriptableRenderPipelineResources {
    #runtimeOwner: object | null = null;
    #persistentByKey = new WeakMap<object, PersistentTargetState>();
    readonly #persistentStates = new Set<PersistentTargetState>();
    #historyByKey = new WeakMap<object, PersistentHistoryState>();
    readonly #historyStates = new Set<PersistentHistoryState>();
    readonly #deferredPersistentCleanupOwners = new Set<object>();
    readonly #frameBindGroups = new Set<RHIBindGroup>();
    readonly #cleanupFailures: unknown[] = [];
    #activeFrameIndex = -1;
    #activeRegistry: ResourceRegistry | null = null;
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

    prepareHistoryTexture(
        runtimeOwner: object,
        key: unknown,
        frameIndex: number,
        registry: ResourceRegistry,
        descriptor: Readonly<HistoryTextureRecipe>
    ): PreparedHistoryTexture {
        this.requirePersistentKey(runtimeOwner, key, 'history texture');
        if (frameIndex !== this.#activeFrameIndex || registry !== this.#activeRegistry) {
            throw new Error('History texture acquisition requires the active scriptable frame');
        }
        let state = this.#historyByKey.get(key as object);
        if (state === undefined) {
            state = {
                key: key as object,
                descriptor: null,
                handles: [],
                initialized: [],
                committedIndex: -1,
                registryGeneration: registry.generation,
                generation: 1,
                pendingDescriptor: null,
                pendingHandles: [],
                pendingInitialized: [],
                frameHandles: null,
                frameInitialized: null,
                frameWriteIndex: -1,
                lastAcquiredFrameIndex: -1,
                wroteThisFrame: false,
                storedThisFrame: false,
                writtenGraphTexture: null,
                pendingRelease: false
            };
            this.#historyByKey.set(key as object, state);
            this.#historyStates.add(state);
        }
        if (state.pendingRelease) {
            throw new Error('Cannot acquire a history texture pending release in this frame');
        }
        if (state.frameHandles !== null) {
            if (
                !sameHistoryTextureRecipe(state.pendingDescriptor ?? state.descriptor, descriptor)
            ) {
                throw new Error(
                    'A history texture key cannot use multiple descriptors in one frame'
                );
            }
            return this.preparedHistoryResult(state);
        }
        if (state.registryGeneration !== registry.generation && state.descriptor !== null) {
            state.registryGeneration = registry.generation;
            state.initialized.fill(false);
            state.committedIndex = -1;
            state.generation += 1;
        }
        if (sameHistoryTextureRecipe(state.descriptor, descriptor)) {
            state.frameHandles = state.handles;
            state.frameInitialized = state.initialized;
        } else {
            const snapshot = snapshotHistoryTextureRecipe(descriptor);
            const handles = this.registerHistoryTextures(registry, snapshot);
            state.pendingDescriptor = snapshot;
            state.pendingHandles = handles;
            state.pendingInitialized = new Array<boolean>(snapshot.bufferCount).fill(false);
            state.frameHandles = handles;
            state.frameInitialized = state.pendingInitialized;
        }
        const count = state.frameHandles.length;
        state.frameWriteIndex =
            state.pendingDescriptor === null && state.committedIndex >= 0
                ? (state.committedIndex + 1) % count
                : 0;
        state.lastAcquiredFrameIndex = frameIndex;
        state.wroteThisFrame = false;
        return this.preparedHistoryResult(state);
    }

    noteHistoryTextureWrite(state: PersistentHistoryState, texture: RGTextureHandle): void {
        if (
            state.lastAcquiredFrameIndex !== this.#activeFrameIndex ||
            state.frameHandles === null ||
            state.frameWriteIndex < 0
        ) {
            throw new Error('History texture write does not belong to the active frame');
        }
        state.wroteThisFrame = true;
        state.writtenGraphTexture = texture;
    }

    /** Resolve final history validity from the submitted schedule, including its last discard. */
    finalizeHistoryWrites(graph: CompiledRenderGraph): void {
        for (const state of this.#historyStates) {
            if (state.writtenGraphTexture === null) continue;
            const resource = graph.resourceByHandle.get(state.writtenGraphTexture);
            state.wroteThisFrame = resource?.writtenByGraph === true;
            state.storedThisFrame =
                state.wroteThisFrame && resource?.initializedAfterExecution === true;
        }
    }

    invalidateHistoryTexture(runtimeOwner: object, key: unknown): boolean {
        this.requirePersistentKey(runtimeOwner, key, 'history texture');
        const state = this.#historyByKey.get(key as object);
        if (state === undefined) return false;
        if (state.lastAcquiredFrameIndex === this.#activeFrameIndex) {
            throw new Error('Invalidate history before acquiring it in the active frame');
        }
        state.initialized.fill(false);
        state.committedIndex = -1;
        state.generation += 1;
        return true;
    }

    releaseHistoryTexture(runtimeOwner: object, key: unknown): boolean {
        this.requirePersistentKey(runtimeOwner, key, 'history texture');
        const state = this.#historyByKey.get(key as object);
        if (state === undefined) return false;
        if (state.lastAcquiredFrameIndex === this.#activeFrameIndex) {
            throw new Error('Cannot release a history texture used by the active frame');
        }
        state.pendingRelease = true;
        return true;
    }

    beginFrame(frameIndex: number, registry: ResourceRegistry): void {
        if (this.#frameBindGroups.size !== 0) {
            throw new Error('Scriptable frame bind groups escaped their previous frame');
        }
        for (const state of this.#persistentStates) {
            if (state.pendingOwner !== null) {
                throw new Error('Persistent target staging escaped its previous frame');
            }
        }
        for (const state of this.#historyStates) {
            if (state.frameHandles !== null || state.pendingHandles.length !== 0) {
                throw new Error('History texture staging escaped its previous frame');
            }
        }
        this.#activeFrameIndex = frameIndex;
        this.#activeRegistry = registry;
    }

    trackFrameBindGroup(bindGroup: RHIBindGroup): void {
        this.#frameBindGroups.add(bindGroup);
    }

    releaseFrameBindGroup(bindGroup: RHIBindGroup): void {
        if (!this.#frameBindGroups.delete(bindGroup)) return;
        bindGroup.destroy();
    }

    endFrame(
        cache: RenderTargetResourceCache,
        registry: ResourceRegistry,
        submitted: boolean
    ): void {
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
        for (const state of this.#historyStates) {
            const frameHandles = state.frameHandles;
            const frameInitialized = state.frameInitialized;
            if (frameHandles !== null && frameInitialized !== null) {
                if (submitted) {
                    for (const handle of frameHandles) {
                        try {
                            registry.markUsed(handle, this.#activeFrameIndex);
                        } catch (error) {
                            failures.push(error);
                        }
                    }
                    if (state.wroteThisFrame) {
                        frameInitialized[state.frameWriteIndex] = state.storedThisFrame;
                    }
                    if (state.pendingDescriptor !== null) {
                        for (const handle of state.handles) {
                            try {
                                registry.release(handle);
                            } catch (error) {
                                failures.push(error);
                            }
                        }
                        state.descriptor = state.pendingDescriptor;
                        state.handles = state.pendingHandles;
                        state.initialized = state.pendingInitialized;
                        state.registryGeneration = registry.generation;
                        state.generation += 1;
                        state.committedIndex = state.storedThisFrame ? state.frameWriteIndex : -1;
                    } else if (state.storedThisFrame) {
                        state.committedIndex = state.frameWriteIndex;
                    }
                } else if (state.pendingDescriptor !== null) {
                    for (const handle of state.pendingHandles) {
                        try {
                            registry.discardUnsubmitted(handle);
                        } catch (error) {
                            failures.push(error);
                        }
                    }
                }
            }
            state.pendingDescriptor = null;
            state.pendingHandles = [];
            state.pendingInitialized = [];
            state.frameHandles = null;
            state.frameInitialized = null;
            state.frameWriteIndex = -1;
            state.lastAcquiredFrameIndex = -1;
            state.wroteThisFrame = false;
            state.storedThisFrame = false;
            state.writtenGraphTexture = null;
            if (state.pendingRelease) {
                if (submitted) {
                    for (const handle of state.handles) {
                        try {
                            registry.release(handle);
                        } catch (error) {
                            failures.push(error);
                        }
                    }
                    state.handles = [];
                    state.initialized = [];
                    state.descriptor = null;
                    state.committedIndex = -1;
                    state.pendingRelease = false;
                } else state.pendingRelease = false;
            }
            this.removeEmptyHistoryState(state);
        }
        this.#activeFrameIndex = -1;
        this.#activeRegistry = null;
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

    releasePersistentTargets(cache: RenderTargetResourceCache, registry: ResourceRegistry): void {
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
        for (const state of this.#historyStates) {
            for (const handle of state.pendingHandles) {
                try {
                    registry.discardUnsubmitted(handle);
                } catch (error) {
                    failures.push(error);
                }
            }
            for (const handle of state.handles) {
                try {
                    registry.release(handle);
                } catch (error) {
                    failures.push(error);
                }
            }
        }
        this.#historyStates.clear();
        this.#historyByKey = new WeakMap();
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

    private removeEmptyHistoryState(state: PersistentHistoryState): void {
        if (state.descriptor !== null || state.pendingDescriptor !== null || state.pendingRelease) {
            return;
        }
        this.#historyByKey.delete(state.key);
        this.#historyStates.delete(state);
    }

    private requirePersistentKey(runtimeOwner: object, key: unknown, label: string): void {
        if ((typeof key !== 'object' && typeof key !== 'function') || key === null) {
            throw new TypeError(`Persistent ${label} key must be an object`);
        }
        if (this.#runtimeOwner === null) this.#runtimeOwner = runtimeOwner;
        else if (this.#runtimeOwner !== runtimeOwner) {
            throw new Error('Scriptable render resources belong to another pipeline runtime');
        }
    }

    private registerHistoryTextures(
        registry: ResourceRegistry,
        descriptor: Readonly<HistoryTextureRecipe>
    ): ResourceRegistryHandle<RHITexture>[] {
        const handles: ResourceRegistryHandle<RHITexture>[] = [];
        try {
            for (let index = 0; index < descriptor.bufferCount; index += 1) {
                handles.push(
                    registry.registerTexture({
                        label: `${descriptor.label} [${String(index)}]`,
                        lifetime: 'persistent',
                        size: {
                            width: descriptor.width,
                            height: descriptor.height,
                            depthOrArrayLayers: descriptor.depthOrArrayLayers
                        },
                        mipLevelCount: descriptor.mipLevelCount,
                        sampleCount: descriptor.sampleCount,
                        dimension: descriptor.dimension,
                        viewDimension: descriptor.viewDimension,
                        format: descriptor.format,
                        usage: descriptor.usage,
                        viewFormats: descriptor.viewFormats
                    })
                );
            }
        } catch (error) {
            for (const handle of handles) registry.discardUnsubmitted(handle);
            throw error;
        }
        return handles;
    }

    private preparedHistoryResult(state: PersistentHistoryState): PreparedHistoryTexture {
        const handles = state.frameHandles;
        const initialized = state.frameInitialized;
        if (handles === null || initialized === null || state.frameWriteIndex < 0) {
            throw new Error('History texture frame state is incomplete');
        }
        return {
            state,
            handles,
            initialized,
            writeIndex: state.frameWriteIndex,
            generation: state.generation + (state.pendingDescriptor === null ? 0 : 1)
        };
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

function sameHistoryTextureRecipe(
    first: Readonly<HistoryTextureRecipe> | null,
    second: Readonly<HistoryTextureRecipe>
): boolean {
    if (first === null) return false;
    if (
        first.label !== second.label ||
        first.width !== second.width ||
        first.height !== second.height ||
        first.depthOrArrayLayers !== second.depthOrArrayLayers ||
        first.mipLevelCount !== second.mipLevelCount ||
        first.sampleCount !== second.sampleCount ||
        first.dimension !== second.dimension ||
        first.viewDimension !== second.viewDimension ||
        first.format !== second.format ||
        first.usage !== second.usage ||
        first.bufferCount !== second.bufferCount ||
        first.viewFormats.length !== second.viewFormats.length
    ) {
        return false;
    }
    for (let index = 0; index < first.viewFormats.length; index += 1) {
        if (first.viewFormats[index] !== second.viewFormats[index]) return false;
    }
    return true;
}

function snapshotHistoryTextureRecipe(
    descriptor: Readonly<HistoryTextureRecipe>
): Readonly<HistoryTextureRecipe> {
    return Object.freeze({
        ...descriptor,
        viewFormats: Object.freeze([...descriptor.viewFormats])
    });
}
