import type {
    RHIBuffer,
    RHICommandContext,
    RHIDevice,
    RHIFrameDiagnostics,
    RHISubmission,
    RHITexture,
    RHITextureView
} from '../rhi/core';
import { assertRHIObjectOwnedBy } from '../rhi/core/RHIValidation';
import type {
    CompiledRGPass,
    CompiledRGResource,
    CompiledRenderGraph
} from './RenderGraphCompiler';
import type { RGBufferHandle, RGResourceHandle, RGTextureHandle } from './RenderGraphResource';
import { renderGraphFailure } from './RenderGraphValidation';

function sameStringList(first: readonly string[], second: readonly string[]): boolean {
    if (first.length !== second.length) return false;
    for (let index = 0; index < first.length; index += 1) {
        if (first[index] !== second[index]) return false;
    }
    return true;
}

function assertImportedTextureDescriptor(
    resource: Extract<CompiledRGResource, { readonly kind: 'texture' }>,
    texture: RHITexture
): void {
    const expected = resource.descriptor;
    const actual = texture.descriptor;
    if (
        actual.lifetime !== expected.lifetime ||
        actual.size.width !== expected.size.width ||
        actual.size.height !== expected.size.height ||
        actual.size.depthOrArrayLayers !== expected.size.depthOrArrayLayers ||
        actual.mipLevelCount !== expected.mipLevelCount ||
        actual.sampleCount !== expected.sampleCount ||
        actual.dimension !== expected.dimension ||
        actual.viewDimension !== expected.viewDimension ||
        actual.format !== expected.format ||
        actual.usage !== expected.usage ||
        !sameStringList(actual.viewFormats, expected.viewFormats)
    ) {
        renderGraphFailure(
            'invalid-descriptor',
            'acquired texture does not match its compiled declaration',
            resource.name
        );
    }
}

function assertImportedBufferDescriptor(
    resource: Extract<CompiledRGResource, { readonly kind: 'buffer' }>,
    buffer: RHIBuffer
): void {
    const expected = resource.descriptor;
    const actual = buffer.descriptor;
    if (
        actual.lifetime !== expected.lifetime ||
        actual.size !== expected.size ||
        (actual.usage & expected.usage) !== expected.usage ||
        actual.mappedAtCreation !== expected.mappedAtCreation
    ) {
        renderGraphFailure(
            'invalid-descriptor',
            'acquired buffer does not match its compiled declaration',
            resource.name
        );
    }
}

interface PreparedRGResource {
    compiled: CompiledRGResource;
    texture: RHITexture | null;
    textureView: RHITextureView | null;
    buffer: RHIBuffer | null;
    owned: boolean;
    allocated: boolean;
    poolEntry: PooledRGResource | null;
}

const EMPTY_RESOURCE_LOOKUP_KEYS = new Float64Array(0);
const EMPTY_RESOURCE_LOOKUP_STAMPS = new Uint32Array(0);

/** Numeric open-address lookup whose backing arrays survive clear() at their high-water size. */
class PreparedRGResourceLookup {
    #keys = EMPTY_RESOURCE_LOOKUP_KEYS;
    #stamps = EMPTY_RESOURCE_LOOKUP_STAMPS;
    #values: (PreparedRGResource | undefined)[] = [];
    #generation = 1;
    #count = 0;

    get capacity(): number {
        return this.#keys.length;
    }

    clear(): void {
        this.#count = 0;
        this.#generation += 1;
        if (this.#generation === 0xffffffff) {
            this.#stamps.fill(0);
            this.#generation = 1;
        }
    }

    /** Returns true only when backing storage grew. */
    set(handle: RGResourceHandle, value: PreparedRGResource): boolean {
        let grew = false;
        if ((this.#count + 1) * 2 > this.#keys.length) {
            this.grow(Math.max(8, this.#keys.length * 2));
            grew = true;
        }
        this.insert(handle, value);
        return grew;
    }

    get(handle: RGResourceHandle): PreparedRGResource | undefined {
        if (this.#keys.length === 0) return undefined;
        const mask = this.#keys.length - 1;
        let index = this.hash(handle) & mask;
        while (this.#stamps[index] === this.#generation) {
            if (this.#keys[index] === handle) return this.#values[index];
            index = (index + 1) & mask;
        }
        return undefined;
    }

    private grow(capacity: number): void {
        const previousKeys = this.#keys;
        const previousStamps = this.#stamps;
        const previousValues = this.#values;
        const previousGeneration = this.#generation;
        this.#keys = new Float64Array(capacity);
        this.#stamps = new Uint32Array(capacity);
        this.#values = new Array<PreparedRGResource | undefined>(capacity);
        this.#generation = 1;
        this.#count = 0;
        for (let index = 0; index < previousKeys.length; index += 1) {
            if (previousStamps[index] !== previousGeneration) continue;
            const value = previousValues[index];
            if (value) this.insert(previousKeys[index] as RGResourceHandle, value);
        }
    }

    private insert(handle: RGResourceHandle, value: PreparedRGResource): void {
        const mask = this.#keys.length - 1;
        let index = this.hash(handle) & mask;
        while (this.#stamps[index] === this.#generation) {
            if (this.#keys[index] === handle) {
                this.#values[index] = value;
                return;
            }
            index = (index + 1) & mask;
        }
        this.#keys[index] = handle;
        this.#stamps[index] = this.#generation;
        this.#values[index] = value;
        this.#count += 1;
    }

    private hash(handle: RGResourceHandle): number {
        return Math.imul(handle | 0, 0x9e3779b1) >>> 0;
    }
}

interface PooledRGResource {
    readonly key: number;
    readonly compiled: CompiledRGResource;
    readonly deviceId: number;
    readonly deviceGeneration: number;
    readonly texture: RHITexture | null;
    readonly textureView: RHITextureView | null;
    readonly buffer: RHIBuffer | null;
    inUse: boolean;
}

function mixPoolKey(hash: number, value: number): number {
    return Math.imul(hash ^ value, 0x01000193) >>> 0;
}

function mixPoolKeyString(hash: number, value: string): number {
    let result = mixPoolKey(hash, value.length);
    for (let index = 0; index < value.length; index += 1) {
        result = mixPoolKey(result, value.charCodeAt(index));
    }
    return result;
}

/** Allocation-free numeric bucket; structural equality below makes hash collisions harmless. */
function resourcePoolKey(resource: CompiledRGResource): number {
    if (resource.kind === 'buffer') {
        const descriptor = resource.descriptor;
        let hash = mixPoolKey(0x811c9dc5, 1);
        hash = mixPoolKey(hash, descriptor.size);
        hash = mixPoolKey(hash, descriptor.usage);
        return mixPoolKey(hash, descriptor.mappedAtCreation ? 1 : 0);
    }
    const descriptor = resource.descriptor;
    let hash = mixPoolKey(0x811c9dc5, 2);
    hash = mixPoolKeyString(hash, descriptor.dimension);
    hash = mixPoolKeyString(hash, descriptor.viewDimension);
    hash = mixPoolKey(hash, descriptor.size.width);
    hash = mixPoolKey(hash, descriptor.size.height);
    hash = mixPoolKey(hash, descriptor.size.depthOrArrayLayers);
    hash = mixPoolKey(hash, descriptor.mipLevelCount);
    hash = mixPoolKey(hash, descriptor.sampleCount);
    hash = mixPoolKeyString(hash, descriptor.format);
    hash = mixPoolKey(hash, descriptor.usage);
    hash = mixPoolKey(hash, descriptor.viewFormats.length);
    // Indexed deliberately: this key is computed for every transient acquire and must not create
    // an iterator in the allocation gate.
    let index = 0;
    while (index < descriptor.viewFormats.length) {
        hash = mixPoolKeyString(hash, descriptor.viewFormats[index] ?? '');
        index += 1;
    }
    return hash;
}

function samePooledResourceDescriptor(
    entry: PooledRGResource,
    resource: CompiledRGResource
): boolean {
    const cached = entry.compiled;
    if (cached.kind !== resource.kind) return false;
    if (cached.kind === 'buffer') {
        if (resource.kind !== 'buffer') return false;
        const first = cached.descriptor;
        const second = resource.descriptor;
        return (
            first.size === second.size &&
            first.usage === second.usage &&
            first.mappedAtCreation === second.mappedAtCreation
        );
    }
    if (resource.kind !== 'texture') return false;
    const first = cached.descriptor;
    const second = resource.descriptor;
    return (
        first.dimension === second.dimension &&
        first.viewDimension === second.viewDimension &&
        first.size.width === second.size.width &&
        first.size.height === second.size.height &&
        first.size.depthOrArrayLayers === second.size.depthOrArrayLayers &&
        first.mipLevelCount === second.mipLevelCount &&
        first.sampleCount === second.sampleCount &&
        first.format === second.format &&
        first.usage === second.usage &&
        sameStringList(first.viewFormats, second.viewFormats)
    );
}

class TransientResourcePool {
    readonly #entries = new Map<number, PooledRGResource[]>();
    #ownerDeviceId: number | null = null;
    #ownerDeviceGeneration: number | null = null;
    #destroyed = false;

    useDevice(device: RHIDevice): void {
        if (this.#destroyed) throw new Error('Render graph transient pool is destroyed');
        if (
            this.#ownerDeviceId !== null &&
            (this.#ownerDeviceId !== device.id || this.#ownerDeviceGeneration !== device.generation)
        ) {
            this.destroyIdleEntries();
        }
        this.#ownerDeviceId = device.id;
        this.#ownerDeviceGeneration = device.generation;
    }

    acquire(resource: CompiledRGResource, device: RHIDevice, result: PreparedRGResource): void {
        this.useDevice(device);
        const key = resourcePoolKey(resource);
        const entries = this.#entries.get(key);
        if (entries) {
            for (let index = entries.length - 1; index >= 0; index -= 1) {
                const entry = entries[index];
                if (!entry) continue;
                const staleGeneration =
                    entry.deviceId === device.id && entry.deviceGeneration !== device.generation;
                const destroyed =
                    (entry.texture?.destroyed ?? false) ||
                    (entry.textureView?.destroyed ?? false) ||
                    (entry.buffer?.destroyed ?? false);
                if (!entry.inUse && (staleGeneration || destroyed)) {
                    entry.textureView?.destroy();
                    entry.texture?.destroy();
                    entry.buffer?.destroy();
                    entries.splice(index, 1);
                }
            }
            for (const entry of entries) {
                if (
                    !entry.inUse &&
                    samePooledResourceDescriptor(entry, resource) &&
                    entry.deviceId === device.id &&
                    entry.deviceGeneration === device.generation &&
                    !(entry.texture?.destroyed ?? false) &&
                    !(entry.buffer?.destroyed ?? false)
                ) {
                    entry.inUse = true;
                    result.poolEntry = entry;
                    result.allocated = false;
                    return;
                }
            }
        }

        let texture: RHITexture | null = null;
        let textureView: RHITextureView | null = null;
        let buffer: RHIBuffer | null = null;
        try {
            if (resource.kind === 'texture') {
                texture = device.createTexture(resource.descriptor);
                textureView = texture.createView();
            } else {
                buffer = device.createBuffer(resource.descriptor);
            }
        } catch (error) {
            textureView?.destroy();
            texture?.destroy();
            buffer?.destroy();
            throw error;
        }
        const entry: PooledRGResource = {
            key,
            compiled: resource,
            deviceId: device.id,
            deviceGeneration: device.generation,
            texture,
            textureView,
            buffer,
            inUse: true
        };
        if (entries) entries.push(entry);
        else this.#entries.set(key, [entry]);
        result.poolEntry = entry;
        result.allocated = true;
    }

    release(entry: PooledRGResource): void {
        // A mapped-at-creation buffer can be unmapped or remapped to a subrange by its frame.
        // Neither backend can synchronously restore the original whole-buffer mapping contract,
        // so it is a one-frame allocation even though ordinary transient buffers are reusable.
        if (entry.compiled.kind === 'buffer' && entry.compiled.descriptor.mappedAtCreation) {
            this.discard(entry);
            return;
        }
        if (
            this.#destroyed ||
            entry.deviceId !== this.#ownerDeviceId ||
            entry.deviceGeneration !== this.#ownerDeviceGeneration
        ) {
            this.discard(entry);
            return;
        }
        entry.inUse = false;
    }

    discard(entry: PooledRGResource): void {
        entry.textureView?.destroy();
        entry.texture?.destroy();
        entry.buffer?.destroy();
        const entries = this.#entries.get(entry.key);
        if (!entries) return;
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
        if (entries.length === 0) this.#entries.delete(entry.key);
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.destroyIdleEntries();
        this.#ownerDeviceId = null;
        this.#ownerDeviceGeneration = null;
    }

    private destroyIdleEntries(): void {
        for (const [key, entries] of this.#entries) {
            for (let index = entries.length - 1; index >= 0; index -= 1) {
                const entry = entries[index];
                if (!entry || entry.inUse) continue;
                entry.textureView?.destroy();
                entry.texture?.destroy();
                entry.buffer?.destroy();
                entries.splice(index, 1);
            }
            if (entries.length === 0) this.#entries.delete(key);
        }
    }
}

class RenderGraphExecutorWorkspace {
    readonly resources: PreparedRGResource[] = [];
    readonly preparedByHandle = new PreparedRGResourceLookup();
    readonly #resourceStorage: PreparedRGResource[] = [];
    growthCount = 0;
    inUse = false;
    #settlementPool: TransientResourcePool | null = null;
    #settlementRelease: ((workspace: RenderGraphExecutorWorkspace) => void) | null = null;
    readonly submissionSucceeded = (): void => {
        this.settleSubmission(true);
    };
    readonly submissionFailed = (): void => {
        this.settleSubmission(false);
    };

    get resourceCapacity(): number {
        return this.#resourceStorage.length;
    }

    get lookupCapacity(): number {
        return this.preparedByHandle.capacity;
    }

    begin(): void {
        if (this.inUse) throw new Error('Render graph executor workspace is already leased');
        this.inUse = true;
        this.resources.length = 0;
        this.preparedByHandle.clear();
    }

    acquire(resource: CompiledRGResource): PreparedRGResource {
        const index = this.resources.length;
        let prepared = this.#resourceStorage[index];
        if (!prepared) {
            prepared = {
                compiled: resource,
                texture: null,
                textureView: null,
                buffer: null,
                owned: false,
                allocated: false,
                poolEntry: null
            };
            this.#resourceStorage.push(prepared);
            this.growthCount++;
        } else {
            prepared.compiled = resource;
            prepared.texture = null;
            prepared.textureView = null;
            prepared.buffer = null;
            prepared.owned = false;
            prepared.allocated = false;
            prepared.poolEntry = null;
        }
        this.resources.push(prepared);
        if (this.preparedByHandle.set(resource.handle, prepared)) this.growthCount++;
        return prepared;
    }

    armSubmission(
        pool: TransientResourcePool,
        release: (workspace: RenderGraphExecutorWorkspace) => void
    ): void {
        if (this.#settlementPool || this.#settlementRelease) {
            throw new Error('Render graph executor workspace already has a pending submission');
        }
        this.#settlementPool = pool;
        this.#settlementRelease = release;
    }

    release(): void {
        for (const resource of this.resources) {
            resource.texture = null;
            resource.textureView = null;
            resource.buffer = null;
            resource.poolEntry = null;
        }
        this.resources.length = 0;
        this.preparedByHandle.clear();
        this.#settlementPool = null;
        this.#settlementRelease = null;
        this.inUse = false;
    }

    private settleSubmission(succeeded: boolean): void {
        const pool = this.#settlementPool;
        const release = this.#settlementRelease;
        if (!pool || !release) return;
        this.#settlementPool = null;
        this.#settlementRelease = null;
        for (const resource of this.resources) {
            if (!resource.owned) {
                resource.textureView?.destroy();
            } else if (resource.compiled.extracted) {
                resource.textureView?.destroy();
            } else if (resource.poolEntry) {
                if (succeeded) pool.release(resource.poolEntry);
                else pool.discard(resource.poolEntry);
            }
        }
        release(this);
    }
}

interface ExtractedRGResource {
    readonly kind: CompiledRGResource['kind'];
    readonly texture: RHITexture | null;
    readonly buffer: RHIBuffer | null;
}

export interface RenderGraphExecutorStorageDiagnostics {
    /** Workspace leases grow only to the historical maximum in-flight submission count. */
    readonly workspaceCapacity: number;
    /** Prepared-resource records retained across every workspace lease. */
    readonly resourceCapacity: number;
    /** Allocation-free handle lookup slots retained across every workspace lease. */
    readonly lookupCapacity: number;
    /** Cumulative workspace/record high-water growth events. */
    readonly growthCount: number;
}

export interface RGExecutionResult {
    readonly submission: RHISubmission;
    /** Reused caller-owned counters when supplied; snapshot before starting another frame. */
    readonly diagnostics: RHIFrameDiagnostics;
    getExtractedTexture(handle: RGTextureHandle): RHITexture;
    getExtractedBuffer(handle: RGBufferHandle): RHIBuffer;
}

export interface RGExecutionOptions {
    readonly frameIndex?: number;
    readonly diagnostics?: RHIFrameDiagnostics;
    readonly prePassCommands?: { flush(context: RHICommandContext): void };
    /** @internal Frame-owner cancellation gate checked before submission and between callbacks. */
    readonly abortSignal?: { throwIfAborted(): void };
}

export interface RGPassContext {
    readonly commandContext: RHICommandContext;
    getTexture(handle: RGTextureHandle): RHITexture;
    getTextureView(handle: RGTextureHandle): RHITextureView;
    getBuffer(handle: RGBufferHandle): RHIBuffer;
}

/** Resource-only scope used before queue.beginFrame; it intentionally exposes no command context. */
export interface RGPrepareContext {
    getTexture(handle: RGTextureHandle): RHITexture;
    getTextureView(handle: RGTextureHandle): RHITextureView;
    getBuffer(handle: RGBufferHandle): RHIBuffer;
}

class RGDeclaredResourceContext implements RGPrepareContext {
    private activePass: CompiledRGPass | null = null;

    constructor(private readonly prepared: PreparedRGResourceLookup) {}

    setPass(pass: CompiledRGPass | null): void {
        this.activePass = pass;
    }

    getTexture(handle: RGTextureHandle): RHITexture {
        const resource = this.requireDeclared(handle);
        if (!resource.texture) {
            renderGraphFailure('invalid-handle', `resource ${String(handle)} is not a texture`);
        }
        return resource.texture;
    }

    getTextureView(handle: RGTextureHandle): RHITextureView {
        const resource = this.requireDeclared(handle);
        if (!resource.textureView) {
            renderGraphFailure('invalid-handle', `resource ${String(handle)} is not a texture`);
        }
        return resource.textureView;
    }

    getBuffer(handle: RGBufferHandle): RHIBuffer {
        const resource = this.requireDeclared(handle);
        if (!resource.buffer) {
            renderGraphFailure('invalid-handle', `resource ${String(handle)} is not a buffer`);
        }
        return resource.buffer;
    }

    private requireDeclared(handle: RGResourceHandle): PreparedRGResource {
        const pass = this.activePass;
        if (!pass || (!pass.reads.has(handle) && !pass.writes.has(handle))) {
            renderGraphFailure(
                'undeclared-access',
                `pass attempted to access undeclared resource ${String(handle)}`,
                pass?.name ?? 'no active pass'
            );
        }
        const resource = this.prepared.get(handle);
        if (!resource) {
            renderGraphFailure('invalid-handle', `resource ${String(handle)} was not prepared`);
        }
        return resource;
    }
}

class RGPassContextImpl extends RGDeclaredResourceContext implements RGPassContext {
    constructor(
        readonly commandContext: RHICommandContext,
        prepared: PreparedRGResourceLookup
    ) {
        super(prepared);
    }
}

class RGExecutionResultImpl implements RGExecutionResult {
    constructor(
        readonly submission: RHISubmission,
        readonly diagnostics: RHIFrameDiagnostics,
        private readonly extracted: ReadonlyMap<RGResourceHandle, ExtractedRGResource> | null
    ) {}

    getExtractedTexture(handle: RGTextureHandle): RHITexture {
        const resource = this.extracted?.get(handle);
        if (resource?.kind !== 'texture' || !resource.texture) {
            renderGraphFailure('invalid-handle', `texture ${String(handle)} was not extracted`);
        }
        return resource.texture;
    }

    getExtractedBuffer(handle: RGBufferHandle): RHIBuffer {
        const resource = this.extracted?.get(handle);
        if (resource?.kind !== 'buffer' || !resource.buffer) {
            renderGraphFailure('invalid-handle', `buffer ${String(handle)} was not extracted`);
        }
        return resource.buffer;
    }
}

function discardPreparedResource(
    resource: PreparedRGResource,
    pool: TransientResourcePool,
    includeExtracted: boolean
): void {
    if (!resource.owned) {
        resource.textureView?.destroy();
        return;
    }
    if (!includeExtracted && resource.compiled.extracted) {
        resource.textureView?.destroy();
        return;
    }
    if (resource.poolEntry) pool.discard(resource.poolEntry);
    else {
        resource.textureView?.destroy();
        resource.texture?.destroy();
        resource.buffer?.destroy();
    }
}

function discardPrepared(
    resources: readonly PreparedRGResource[],
    pool: TransientResourcePool,
    includeExtracted: boolean
): void {
    for (let index = resources.length - 1; index >= 0; index -= 1) {
        const resource = resources[index];
        if (!resource) continue;
        discardPreparedResource(resource, pool, includeExtracted);
    }
}

function releaseBeforeFrame(
    resources: readonly PreparedRGResource[],
    pool: TransientResourcePool
): void {
    for (const resource of resources) {
        if (resource.poolEntry) pool.release(resource.poolEntry);
        else discardPreparedResource(resource, pool, true);
    }
}

function releaseAfterSubmission(
    workspace: RenderGraphExecutorWorkspace,
    pool: TransientResourcePool,
    submission: RHISubmission,
    releaseWorkspace: (workspace: RenderGraphExecutorWorkspace) => void
): void {
    workspace.armSubmission(pool, releaseWorkspace);
    if (submission.status === 'succeeded') workspace.submissionSucceeded();
    else if (submission.status === 'failed') workspace.submissionFailed();
    else void submission.done.then(workspace.submissionSucceeded, workspace.submissionFailed);
}

/** Allocates only after a graph compiled successfully, then executes its stable pass schedule. */
export class RenderGraphExecutor {
    readonly #transientPool = new TransientResourcePool();
    readonly #workspaces: RenderGraphExecutorWorkspace[] = [];
    readonly #availableWorkspaces: RenderGraphExecutorWorkspace[] = [];
    readonly #storageDiagnostics: {
        workspaceCapacity: number;
        resourceCapacity: number;
        lookupCapacity: number;
        growthCount: number;
    } = { workspaceCapacity: 0, resourceCapacity: 0, lookupCapacity: 0, growthCount: 0 };
    #workspaceGrowthCount = 0;
    #destroyed = false;
    readonly #releaseWorkspace = (workspace: RenderGraphExecutorWorkspace): void => {
        workspace.release();
        if (!this.#destroyed) this.#availableWorkspaces.push(workspace);
    };

    /** Stable high-water diagnostics; values update when this getter is read. */
    get storageDiagnostics(): Readonly<RenderGraphExecutorStorageDiagnostics> {
        const diagnostics = this.#storageDiagnostics;
        diagnostics.workspaceCapacity = this.#workspaces.length;
        diagnostics.resourceCapacity = 0;
        diagnostics.lookupCapacity = 0;
        diagnostics.growthCount = this.#workspaceGrowthCount;
        for (const workspace of this.#workspaces) {
            diagnostics.resourceCapacity += workspace.resourceCapacity;
            diagnostics.lookupCapacity += workspace.lookupCapacity;
            diagnostics.growthCount += workspace.growthCount;
        }
        return diagnostics;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.#transientPool.destroy();
        this.#availableWorkspaces.length = 0;
    }

    execute(
        graph: CompiledRenderGraph,
        device: RHIDevice,
        options: RGExecutionOptions = {}
    ): RGExecutionResult {
        if (this.#destroyed) throw new Error('Render graph executor is destroyed');
        this.#transientPool.useDevice(device);
        const workspace = this.acquireWorkspace();
        const preparedList = workspace.resources;
        const preparedByHandle = workspace.preparedByHandle;
        try {
            for (const resource of graph.resources) {
                const prepared = workspace.acquire(resource);
                prepared.owned = resource.origin === 'transient';
                prepared.allocated = prepared.owned;
                if (prepared.owned && !resource.extracted) {
                    this.#transientPool.acquire(resource, device, prepared);
                    const entry = prepared.poolEntry;
                    if (!entry) throw new Error('Transient resource pool did not return an entry');
                    prepared.texture = entry.texture;
                    prepared.textureView = entry.textureView;
                    prepared.buffer = entry.buffer;
                } else if (resource.kind === 'texture') {
                    prepared.texture =
                        resource.origin === 'imported'
                            ? (resource.imported ?? resource.provider?.() ?? null)
                            : device.createTexture(resource.descriptor);
                    if (prepared.texture === null) {
                        renderGraphFailure(
                            'invalid-state',
                            'imported texture has no resource or acquisition provider',
                            resource.name
                        );
                    }
                    assertRHIObjectOwnedBy(
                        device,
                        prepared.texture,
                        `graph resource ${resource.name}`
                    );
                    if (resource.origin === 'imported') {
                        assertImportedTextureDescriptor(resource, prepared.texture);
                    }
                    prepared.textureView = prepared.texture.createView();
                } else {
                    prepared.buffer =
                        resource.origin === 'imported'
                            ? (resource.imported ?? resource.provider?.() ?? null)
                            : device.createBuffer(resource.descriptor);
                    if (prepared.buffer === null) {
                        renderGraphFailure(
                            'invalid-state',
                            'imported buffer has no resource or acquisition provider',
                            resource.name
                        );
                    }
                    assertRHIObjectOwnedBy(
                        device,
                        prepared.buffer,
                        `graph resource ${resource.name}`
                    );
                    if (resource.origin === 'imported') {
                        assertImportedBufferDescriptor(resource, prepared.buffer);
                    }
                }
            }
        } catch (error) {
            releaseBeforeFrame(preparedList, this.#transientPool);
            this.#releaseWorkspace(workspace);
            throw error;
        }

        // Callback contexts are deliberately fresh shells. Templates may retain them; pooling a
        // shell would revive a stale reference in a later frame. Only their unreachable backing
        // workspace is leased at the submission high-water mark.
        const prepareContext = new RGDeclaredResourceContext(preparedByHandle);
        try {
            for (const pass of graph.passes) {
                prepareContext.setPass(pass);
                pass.template.prepare?.(prepareContext, pass.params);
                options.abortSignal?.throwIfAborted();
            }
            prepareContext.setPass(null);
        } catch (error) {
            prepareContext.setPass(null);
            releaseBeforeFrame(preparedList, this.#transientPool);
            this.#releaseWorkspace(workspace);
            throw error;
        }

        const queue = device.graphicsQueue;
        let context: RHICommandContext;
        try {
            options.abortSignal?.throwIfAborted();
            context = queue.beginFrame({
                label: 'Render Graph frame',
                ...(options.frameIndex === undefined ? {} : { frameIndex: options.frameIndex }),
                ...(options.diagnostics === undefined ? {} : { diagnostics: options.diagnostics })
            });
        } catch (error) {
            releaseBeforeFrame(preparedList, this.#transientPool);
            this.#releaseWorkspace(workspace);
            throw error;
        }
        let transientAllocations = 0;
        for (const resource of preparedList) {
            if (resource.allocated) transientAllocations++;
        }
        context.diagnostics.transientAllocations += transientAllocations;
        const passContext = new RGPassContextImpl(context, preparedByHandle);
        try {
            options.prePassCommands?.flush(context);
            options.abortSignal?.throwIfAborted();
            for (const pass of graph.passes) {
                passContext.setPass(pass);
                pass.template.execute(passContext, pass.params);
                options.abortSignal?.throwIfAborted();
            }
            passContext.setPass(null);
            options.abortSignal?.throwIfAborted();
            const submission = queue.endFrame(context);
            let extracted: Map<RGResourceHandle, ExtractedRGResource> | null = null;
            for (const resource of preparedList) {
                if (resource.compiled.extracted) {
                    extracted ??= new Map<RGResourceHandle, ExtractedRGResource>();
                    extracted.set(resource.compiled.handle, {
                        kind: resource.compiled.kind,
                        texture: resource.texture,
                        buffer: resource.buffer
                    });
                }
            }
            releaseAfterSubmission(
                workspace,
                this.#transientPool,
                submission,
                this.#releaseWorkspace
            );
            return new RGExecutionResultImpl(submission, context.diagnostics, extracted);
        } catch (error) {
            passContext.setPass(null);
            try {
                queue.abortFrame(context, error);
            } catch {
                // Preserve the original execute/endFrame failure as the public error boundary.
            }
            discardPrepared(preparedList, this.#transientPool, true);
            this.#releaseWorkspace(workspace);
            throw error;
        }
    }

    private acquireWorkspace(): RenderGraphExecutorWorkspace {
        let workspace = this.#availableWorkspaces.pop();
        if (!workspace) {
            workspace = new RenderGraphExecutorWorkspace();
            this.#workspaces.push(workspace);
            this.#workspaceGrowthCount++;
        }
        workspace.begin();
        return workspace;
    }
}
