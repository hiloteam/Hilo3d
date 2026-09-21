import type {
    RHIBuffer,
    RHICommandContext,
    RHIDevice,
    RHIFrameDiagnostics,
    RHISubmission,
    RHITimestampWrites,
    RHITexture,
    RHITextureView
} from '../rhi/core';
import { assertRHIObjectOwnedBy } from '../rhi/core/RHIValidation';
import type {
    CompiledRGPass,
    CompiledRGResource,
    CompiledRenderGraph
} from './RenderGraphCompiler';
import type {
    RGBufferHandle,
    RGResourceHandle,
    RGTextureAccessHandle,
    RGTextureHandle
} from './RenderGraphResource';
import { renderGraphFailure } from './RenderGraphValidation';
import { RenderGraphGPUProfiler, type RenderGraphGPUProfileFrame } from './RenderGraphGPUProfiler';
import type { RenderGraphTimelineRecorder } from './RenderGraphTimeline';

import { TransientResourcePool, type PooledRGResource } from './RenderGraphTransientResourcePool';

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
    /** Validated graph whose commands were submitted, including final resource contents. */
    readonly graph: CompiledRenderGraph;
    readonly submission: RHISubmission;
    /** Reused caller-owned counters when supplied; snapshot before starting another frame. */
    readonly diagnostics: RHIFrameDiagnostics;
    /** Report initial observer failures only after the owner has committed the submitted frame. */
    throwTimelineError(): void;
    getExtractedTexture(handle: RGTextureHandle): RHITexture;
    getExtractedBuffer(handle: RGBufferHandle): RHIBuffer;
}

export interface RGExecutionOptions {
    readonly frameIndex?: number;
    readonly diagnostics?: RHIFrameDiagnostics;
    readonly prePassCommands?: { flush(context: RHICommandContext): void };
    /** @internal Frame-owner cancellation gate checked before submission and between callbacks. */
    readonly abortSignal?: { throwIfAborted(): void };
    /** @internal Enables pass markers, CPU phases and automatic WebGPU timestamp queries. */
    readonly timeline?: RenderGraphTimelineRecorder;
    /** @internal Reports asynchronous observer failures without invalidating GPU submission. */
    readonly onTimelineError?: (error: unknown) => void;
}

export interface RGPassContext {
    readonly commandContext: RHICommandContext;
    readonly timestampWrites: Readonly<RHITimestampWrites> | undefined;
    getTexture(handle: RGTextureAccessHandle): RHITexture;
    getTextureView(handle: RGTextureAccessHandle): RHITextureView;
    getBuffer(handle: RGBufferHandle): RHIBuffer;
}

/** Resource-only scope used before queue.beginFrame; it intentionally exposes no command context. */
export interface RGPrepareContext {
    getTexture(handle: RGTextureAccessHandle): RHITexture;
    getTextureView(handle: RGTextureAccessHandle): RHITextureView;
    getBuffer(handle: RGBufferHandle): RHIBuffer;
}

class RGDeclaredResourceContext implements RGPrepareContext {
    private activePass: CompiledRGPass | null = null;

    constructor(private readonly prepared: PreparedRGResourceLookup) {}

    setPass(pass: CompiledRGPass | null): void {
        this.activePass = pass;
    }

    getTexture(handle: RGTextureAccessHandle): RHITexture {
        const resource = this.requireDeclared(handle);
        if (!resource.texture) {
            renderGraphFailure('invalid-handle', `resource ${String(handle)} is not a texture`);
        }
        return resource.texture;
    }

    getTextureView(handle: RGTextureAccessHandle): RHITextureView {
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
    timestampWrites: Readonly<RHITimestampWrites> | undefined;

    constructor(
        readonly commandContext: RHICommandContext,
        prepared: PreparedRGResourceLookup
    ) {
        super(prepared);
    }

    override setPass(pass: CompiledRGPass | null): void {
        super.setPass(pass);
        this.timestampWrites = undefined;
    }

    setProfiledPass(
        pass: CompiledRGPass,
        timestampWrites: Readonly<RHITimestampWrites> | undefined
    ): void {
        super.setPass(pass);
        this.timestampWrites = timestampWrites;
    }
}

class RGExecutionResultImpl implements RGExecutionResult {
    #timelineFailure: { readonly error: unknown } | null = null;

    constructor(
        readonly graph: CompiledRenderGraph,
        readonly submission: RHISubmission,
        readonly diagnostics: RHIFrameDiagnostics,
        private readonly extracted: ReadonlyMap<RGResourceHandle, ExtractedRGResource> | null
    ) {}

    captureTimelineError(error: unknown): void {
        this.#timelineFailure = { error };
    }

    throwTimelineError(): void {
        if (this.#timelineFailure !== null) throw this.#timelineFailure.error;
    }

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
    readonly #gpuProfiler = new RenderGraphGPUProfiler();
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
        this.#gpuProfiler.destroy();
        this.#availableWorkspaces.length = 0;
    }

    execute(
        graph: CompiledRenderGraph,
        device: RHIDevice,
        options: RGExecutionOptions = {}
    ): RGExecutionResult {
        if (this.#destroyed) throw new Error('Render graph executor is destroyed');
        this.#transientPool.beginFrame(device);
        const workspace = this.acquireWorkspace();
        const timeline = options.timeline;
        timeline?.setAsyncErrorReporter(options.onTimelineError);
        const prepareStart = timeline === undefined ? 0 : performance.now();
        const preparedList = workspace.resources;
        const preparedByHandle = workspace.preparedByHandle;
        try {
            for (const resource of graph.resources) {
                const prepared = workspace.acquire(resource);
                if (resource.kind === 'texture-view') {
                    const parent = preparedByHandle.get(resource.texture);
                    if (!parent?.texture) {
                        renderGraphFailure(
                            'invalid-state',
                            'texture view parent was not prepared before the view',
                            resource.name
                        );
                    }
                    prepared.texture = parent.texture;
                    prepared.textureView = parent.texture.createView(resource.descriptor);
                    continue;
                }
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
            if (timeline !== undefined) {
                timeline.setPrepareDuration(performance.now() - prepareStart);
            }
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
        let gpuProfile: RenderGraphGPUProfileFrame | null = null;
        let submission: RHISubmission;
        let extracted: Map<RGResourceHandle, ExtractedRGResource> | null = null;
        const executeStart = timeline === undefined ? 0 : performance.now();
        try {
            gpuProfile = timeline === undefined ? null : this.#gpuProfiler.begin(device, timeline);
            options.prePassCommands?.flush(context);
            options.abortSignal?.throwIfAborted();
            for (let passIndex = 0; passIndex < graph.passes.length; passIndex += 1) {
                const pass = graph.passes[passIndex];
                if (pass === undefined) continue;
                const timestampWrites =
                    gpuProfile !== null && timeline?.passKind(passIndex) !== null
                        ? gpuProfile.timestampWrites(passIndex)
                        : undefined;
                passContext.setProfiledPass(pass, timestampWrites);
                const passStart = timeline === undefined ? 0 : performance.now();
                if (timeline !== undefined) context.insertDebugMarker(`RenderGraph: ${pass.name}`);
                pass.template.execute(passContext, pass.params);
                if (timeline !== undefined) {
                    timeline.setPassCPUTime(passIndex, performance.now() - passStart);
                }
                options.abortSignal?.throwIfAborted();
            }
            passContext.setPass(null);
            options.abortSignal?.throwIfAborted();
            gpuProfile?.resolve(context);
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
            submission = queue.endFrame(context);
        } catch (error) {
            passContext.setPass(null);
            gpuProfile?.abort();
            try {
                queue.abortFrame(context, error);
            } catch {
                // Preserve the original execute/endFrame failure as the public error boundary.
            }
            discardPrepared(preparedList, this.#transientPool, true);
            this.#releaseWorkspace(workspace);
            throw error;
        }

        // endFrame is the irreversible submission boundary. Arm cleanup before notifying any
        // consumers, and return their failures separately so frame owners can commit first.
        const result = new RGExecutionResultImpl(graph, submission, context.diagnostics, extracted);
        releaseAfterSubmission(workspace, this.#transientPool, submission, this.#releaseWorkspace);
        if (timeline !== undefined) {
            timeline.setExecuteDuration(performance.now() - executeStart);
            try {
                gpuProfile?.submitted(submission);
                timeline.publish();
            } catch (error) {
                result.captureTimelineError(error);
            }
        }
        return result;
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
