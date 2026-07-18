import {
    RHIBufferUsage,
    RHITextureUsage,
    rhiTextureFormatHasDepth,
    rhiTextureFormatHasStencil,
    type RHIBuffer,
    type RHIBufferDescriptor,
    type RHICapabilities,
    type RHINormalizedBufferDescriptor,
    type RHINormalizedTextureDescriptor,
    type RHITexture,
    type RHITextureDescriptor
} from '../rhi/core';
import {
    normalizeRHIBufferDescriptor,
    normalizeRHITextureDescriptor
} from '../rhi/core/RHIValidation';
import type { RGPassNode, RenderGraphBuildSnapshot } from './RenderGraphBuilder';
import type {
    RGBufferAccessDeclaration,
    RGBufferHandle,
    RGColorAttachmentDeclaration,
    RGDepthStencilAttachmentDeclaration,
    RGImportedBufferProvider,
    RGImportedTextureProvider,
    RGPassHandle,
    RGResourceHandle,
    RGResourceLifetime,
    RGResourceNode,
    RGTextureHandle
} from './RenderGraphResource';
import { renderGraphFailure } from './RenderGraphValidation';

export interface CompiledRGTextureResource {
    readonly kind: 'texture';
    readonly handle: RGTextureHandle;
    readonly name: string;
    readonly origin: 'imported' | 'transient';
    readonly descriptor: Readonly<RHINormalizedTextureDescriptor>;
    readonly imported: RHITexture | null;
    readonly provider: RGImportedTextureProvider | null;
    readonly readFromLastGraphWriter: boolean;
    readonly extracted: boolean;
    readonly lifetime: RGResourceLifetime | null;
}

export interface CompiledRGBufferResource {
    readonly kind: 'buffer';
    readonly handle: RGBufferHandle;
    readonly name: string;
    readonly origin: 'imported' | 'transient';
    readonly descriptor: Readonly<RHINormalizedBufferDescriptor>;
    readonly imported: RHIBuffer | null;
    readonly provider: RGImportedBufferProvider | null;
    readonly initiallyInitialized: boolean;
    readonly extracted: boolean;
    readonly lifetime: RGResourceLifetime | null;
}

export type CompiledRGResource = CompiledRGTextureResource | CompiledRGBufferResource;

export interface CompiledRGPass {
    readonly handle: RGPassHandle;
    readonly sourceIndex: number;
    readonly order: number;
    readonly name: string;
    readonly template: RGPassNode['template'];
    readonly params: unknown;
    readonly reads: ReadonlySet<RGResourceHandle>;
    readonly writes: ReadonlySet<RGResourceHandle>;
    readonly bufferAccesses: readonly RGBufferAccessDeclaration[];
}

/** Pure compile result. Constructing this object performs no RHI resource or command operation. */
export class CompiledRenderGraph {
    readonly resourceByHandle: ReadonlyMap<RGResourceHandle, CompiledRGResource>;

    /** @internal */
    constructor(
        readonly generation: number,
        readonly resources: readonly CompiledRGResource[],
        readonly passes: readonly CompiledRGPass[]
    ) {
        const resourceByHandle = new Map<RGResourceHandle, CompiledRGResource>();
        for (const resource of resources) resourceByHandle.set(resource.handle, resource);
        this.resourceByHandle = resourceByHandle;
        Object.freeze(this.resources);
        Object.freeze(this.passes);
        Object.freeze(this);
    }
}

function addEdge(
    outgoing: Set<number>[],
    incoming: Set<number>[],
    before: number,
    after: number
): void {
    if (before === after || outgoing[before]?.has(after)) return;
    outgoing[before]?.add(after);
    incoming[after]?.add(before);
}

export interface RenderGraphCompilerStorageDiagnostics {
    readonly resourceCapacity: number;
    readonly passCapacity: number;
    readonly readerSetCapacity: number;
    readonly growthCount: number;
}

type MutableCompilerStorageDiagnostics = {
    -readonly [
        Key in keyof RenderGraphCompilerStorageDiagnostics
    ]: RenderGraphCompilerStorageDiagnostics[Key];
};

class RenderGraphCompilerWorkspace {
    readonly normalizedResources: CompiledRGResource[] = [];
    readonly resourceByHandle = new Map<RGResourceHandle, CompiledRGResource>();
    readonly resourceWriters = new Map<RGResourceHandle, number>();
    readonly lastPreferredGraphWriter = new Map<RGResourceHandle, number>();
    readonly preferredGraphWriterReads = new Set<RGResourceHandle>();
    readonly lastWriter = new Map<RGResourceHandle, number>();
    readonly readersSinceWrite = new Map<RGResourceHandle, Set<number>>();
    readonly contentAvailable = new Map<RGResourceHandle, boolean>();
    readonly depthContentAvailable = new Map<RGResourceHandle, boolean>();
    readonly stencilContentAvailable = new Map<RGResourceHandle, boolean>();
    readonly passIndexByHandle = new Map<RGPassHandle, number>();
    readonly outgoing: Set<number>[] = [];
    readonly incoming: Set<number>[] = [];
    readonly roots = new Set<number>();
    readonly scratchReadSet = new Set<RGResourceHandle>();
    readonly scratchReadWriteSet = new Set<RGBufferHandle>();
    readonly firstUse = new Map<RGResourceHandle, number>();
    readonly lastUse = new Map<RGResourceHandle, number>();
    readonly indegree: number[] = [];
    readonly order: number[] = [];
    readonly stack: number[] = [];
    readonly scheduledSourceIndices: number[] = [];
    readonly diagnostics: MutableCompilerStorageDiagnostics = {
        resourceCapacity: 0,
        passCapacity: 0,
        readerSetCapacity: 0,
        growthCount: 0
    };

    readonly #readerSetPool: Set<number>[] = [];
    #readerSetCursor = 0;
    consumed = new Uint8Array(0);
    live = new Uint8Array(0);

    begin(resourceCount: number, passCount: number): void {
        this.normalizedResources.length = 0;
        this.resourceByHandle.clear();
        this.resourceWriters.clear();
        this.lastPreferredGraphWriter.clear();
        this.preferredGraphWriterReads.clear();
        this.lastWriter.clear();
        this.readersSinceWrite.clear();
        this.contentAvailable.clear();
        this.depthContentAvailable.clear();
        this.stencilContentAvailable.clear();
        this.passIndexByHandle.clear();
        this.roots.clear();
        this.scratchReadSet.clear();
        this.scratchReadWriteSet.clear();
        this.firstUse.clear();
        this.lastUse.clear();
        this.indegree.length = 0;
        this.order.length = 0;
        this.stack.length = 0;
        this.scheduledSourceIndices.length = 0;
        this.#readerSetCursor = 0;

        if (resourceCount > this.diagnostics.resourceCapacity) {
            this.diagnostics.resourceCapacity = resourceCount;
            this.diagnostics.growthCount++;
        }
        const previousPassCapacity = this.outgoing.length;
        while (this.outgoing.length < passCount) {
            this.outgoing.push(new Set<number>());
            this.incoming.push(new Set<number>());
        }
        if (this.outgoing.length !== previousPassCapacity) {
            this.diagnostics.passCapacity = this.outgoing.length;
            this.diagnostics.growthCount++;
        }
        for (let index = 0; index < passCount; index += 1) {
            this.outgoing[index]?.clear();
            this.incoming[index]?.clear();
        }
        if (passCount > this.consumed.length) {
            let capacity = Math.max(1, this.consumed.length);
            while (capacity < passCount) capacity *= 2;
            this.consumed = new Uint8Array(capacity);
            this.live = new Uint8Array(capacity);
            this.diagnostics.growthCount++;
        }
    }

    acquireReaderSet(handle: RGResourceHandle): Set<number> {
        let readers = this.readersSinceWrite.get(handle);
        if (readers) return readers;
        readers = this.#readerSetPool[this.#readerSetCursor];
        if (!readers) {
            readers = new Set<number>();
            this.#readerSetPool.push(readers);
            this.diagnostics.readerSetCapacity = this.#readerSetPool.length;
            this.diagnostics.growthCount++;
        } else readers.clear();
        this.#readerSetCursor++;
        this.readersSinceWrite.set(handle, readers);
        return readers;
    }

    release(): void {
        this.normalizedResources.length = 0;
        this.resourceByHandle.clear();
        this.resourceWriters.clear();
        this.lastPreferredGraphWriter.clear();
        this.preferredGraphWriterReads.clear();
        this.lastWriter.clear();
        this.readersSinceWrite.clear();
        this.contentAvailable.clear();
        this.depthContentAvailable.clear();
        this.stencilContentAvailable.clear();
        this.passIndexByHandle.clear();
        this.roots.clear();
        this.scratchReadSet.clear();
        this.scratchReadWriteSet.clear();
        this.firstUse.clear();
        this.lastUse.clear();
        this.indegree.length = 0;
        this.order.length = 0;
        this.stack.length = 0;
        this.scheduledSourceIndices.length = 0;
    }
}

function stableTopologicalOrder(
    outgoing: Set<number>[],
    incoming: Set<number>[],
    passCount: number,
    workspace: RenderGraphCompilerWorkspace
): readonly number[] {
    const indegree = workspace.indegree;
    indegree.length = passCount;
    for (let index = 0; index < passCount; index += 1) {
        indegree[index] = incoming[index]?.size ?? 0;
    }
    const consumed = workspace.consumed;
    consumed.fill(0, 0, passCount);
    const order = workspace.order;
    order.length = 0;
    while (order.length < passCount) {
        let selected = -1;
        for (let index = 0; index < passCount; index += 1) {
            if (consumed[index] === 0 && indegree[index] === 0) {
                selected = index;
                break;
            }
        }
        if (selected < 0) renderGraphFailure('cycle', 'render graph contains a pass cycle');
        consumed[selected] = 1;
        order.push(selected);
        for (const dependent of outgoing[selected] ?? []) {
            const value = indegree[dependent];
            if (value === undefined) throw new Error('Render graph dependency index is invalid');
            indegree[dependent] = value - 1;
        }
    }
    return order;
}

function normalizedResource(
    resource: RGResourceNode,
    capabilities: RHICapabilities
): CompiledRGResource {
    if (resource.kind === 'texture') {
        const descriptor = normalizeRHITextureDescriptor(
            {
                ...(resource.descriptor as RHITextureDescriptor),
                lifetime: resource.extracted ? 'persistent' : resource.resourceLifetime
            },
            capabilities
        );
        return {
            kind: 'texture',
            handle: resource.handle,
            name: resource.name,
            origin: resource.origin,
            descriptor,
            imported: resource.imported,
            provider: resource.provider,
            readFromLastGraphWriter: resource.readFromLastGraphWriter,
            extracted: resource.extracted,
            lifetime: null
        };
    }
    const descriptor = normalizeRHIBufferDescriptor(
        {
            ...(resource.descriptor as RHIBufferDescriptor),
            lifetime: resource.extracted ? 'persistent' : resource.resourceLifetime
        },
        capabilities
    );
    return {
        kind: 'buffer',
        handle: resource.handle,
        name: resource.name,
        origin: resource.origin,
        descriptor,
        imported: resource.imported,
        provider: resource.provider,
        initiallyInitialized: resource.initiallyInitialized,
        extracted: resource.extracted,
        lifetime: null
    };
}

function bufferAccessUsage(access: RGBufferAccessDeclaration): number {
    switch (access.use) {
        case 'storage':
            return RHIBufferUsage.STORAGE;
        case 'vertex':
            return RHIBufferUsage.VERTEX;
        case 'index':
            return RHIBufferUsage.INDEX;
        case 'copy-source':
            return RHIBufferUsage.COPY_SRC;
        case 'copy-destination':
            return RHIBufferUsage.COPY_DST;
        case 'indirect':
            return RHIBufferUsage.INDIRECT;
    }
}

function markLivePasses(
    roots: Set<number>,
    incoming: Set<number>[],
    passCount: number,
    workspace: RenderGraphCompilerWorkspace
): Uint8Array {
    const live = workspace.live;
    live.fill(0, 0, passCount);
    const stack = workspace.stack;
    stack.length = 0;
    for (const root of roots) stack.push(root);
    while (stack.length > 0) {
        const pass = stack.pop();
        if (pass === undefined || live[pass] !== 0) continue;
        live[pass] = 1;
        for (const dependency of incoming[pass] ?? []) stack.push(dependency);
    }
    return live;
}

function requireTextureResource(
    resources: ReadonlyMap<RGResourceHandle, CompiledRGResource>,
    handle: RGTextureHandle,
    passName: string
): CompiledRGTextureResource {
    const resource = resources.get(handle);
    if (resource?.kind !== 'texture') {
        renderGraphFailure(
            'invalid-handle',
            `texture resource ${String(handle)} is not in this graph`,
            passName
        );
    }
    return resource;
}

function validateLoadOp(value: unknown, path: string): asserts value is 'load' | 'clear' {
    if (value !== 'load' && value !== 'clear') {
        renderGraphFailure('invalid-descriptor', 'loadOp must be load or clear', path);
    }
}

function validateStoreOp(value: unknown, path: string): asserts value is 'store' | 'discard' {
    if (value !== 'store' && value !== 'discard') {
        renderGraphFailure('invalid-descriptor', 'storeOp must be store or discard', path);
    }
}

function validateRenderAttachmentTexture(
    resource: CompiledRGTextureResource,
    path: string,
    expected: 'color' | 'depth-stencil'
): void {
    if ((resource.descriptor.usage & RHITextureUsage.RENDER_ATTACHMENT) === 0) {
        renderGraphFailure(
            'invalid-descriptor',
            'attachment texture lacks RENDER_ATTACHMENT usage',
            path
        );
    }
    if (resource.descriptor.viewDimension !== '2d') {
        renderGraphFailure(
            'invalid-descriptor',
            'attachment declaration requires a single 2D default view',
            path
        );
    }
    const depth = rhiTextureFormatHasDepth(resource.descriptor.format);
    const stencil = rhiTextureFormatHasStencil(resource.descriptor.format);
    if (expected === 'color' ? depth || stencil : !depth && !stencil) {
        renderGraphFailure(
            'invalid-descriptor',
            expected === 'color'
                ? 'color attachment requires a color format'
                : 'depth/stencil attachment requires a depth or stencil format',
            path
        );
    }
}

function validateAttachmentCompatibility(
    reference: CompiledRGTextureResource,
    candidate: CompiledRGTextureResource,
    path: string
): void {
    const first = reference.descriptor;
    const second = candidate.descriptor;
    if (
        first.size.width !== second.size.width ||
        first.size.height !== second.size.height ||
        first.size.depthOrArrayLayers !== second.size.depthOrArrayLayers ||
        first.sampleCount !== second.sampleCount
    ) {
        renderGraphFailure(
            'invalid-descriptor',
            'render pass attachments must have matching extents and sample counts',
            path
        );
    }
}

function validateColorAttachment(
    declaration: RGColorAttachmentDeclaration,
    resources: ReadonlyMap<RGResourceHandle, CompiledRGResource>,
    passName: string,
    index: number
): {
    readonly source: CompiledRGTextureResource;
    readonly resolve: CompiledRGTextureResource | null;
} {
    const path = `${passName}.colorAttachments[${String(index)}]`;
    validateLoadOp(declaration.loadOp, `${path}.loadOp`);
    validateStoreOp(declaration.storeOp, `${path}.storeOp`);
    if (declaration.loadOp === 'clear') {
        const clear = declaration.clearValue;
        if (
            clear === undefined ||
            !Number.isFinite(clear.r) ||
            !Number.isFinite(clear.g) ||
            !Number.isFinite(clear.b) ||
            !Number.isFinite(clear.a)
        ) {
            renderGraphFailure(
                'invalid-descriptor',
                'clear load operation requires a finite clearValue',
                `${path}.clearValue`
            );
        }
    }
    const source = requireTextureResource(resources, declaration.texture, passName);
    validateRenderAttachmentTexture(source, `${path}.texture`, 'color');
    if (declaration.resolveTarget === undefined) return { source, resolve: null };

    const resolve = requireTextureResource(resources, declaration.resolveTarget, passName);
    validateRenderAttachmentTexture(resolve, `${path}.resolveTarget`, 'color');
    const sourceDescriptor = source.descriptor;
    const resolveDescriptor = resolve.descriptor;
    if (sourceDescriptor.sampleCount <= 1 || resolveDescriptor.sampleCount !== 1) {
        renderGraphFailure(
            'invalid-descriptor',
            'resolve requires a multisampled source and single-sampled target',
            `${path}.resolveTarget`
        );
    }
    if (sourceDescriptor.format !== resolveDescriptor.format) {
        renderGraphFailure(
            'invalid-descriptor',
            'resolve source and target formats must match',
            `${path}.resolveTarget`
        );
    }
    const sourceSize = sourceDescriptor.size;
    const resolveSize = resolveDescriptor.size;
    if (
        sourceSize.width !== resolveSize.width ||
        sourceSize.height !== resolveSize.height ||
        sourceSize.depthOrArrayLayers !== resolveSize.depthOrArrayLayers
    ) {
        renderGraphFailure(
            'invalid-descriptor',
            'resolve source and target extents must match',
            `${path}.resolveTarget`
        );
    }
    return { source, resolve };
}

interface DepthStencilAccess {
    readonly hasDepth: boolean;
    readonly hasStencil: boolean;
    readonly depth: DepthStencilAspectAccess;
    readonly stencil: DepthStencilAspectAccess;
}

interface DepthStencilAspectAccess {
    readonly used: boolean;
    readonly requiresLoad: boolean;
    readonly writes: boolean;
    readonly stores: boolean;
}

function validateDepthStencilAspect(options: {
    readonly path: string;
    readonly label: 'depth' | 'stencil';
    readonly clearValue: number | undefined;
    readonly loadOp: unknown;
    readonly storeOp: unknown;
    readonly readOnly: boolean | undefined;
}): DepthStencilAspectAccess {
    const { path, label, clearValue, loadOp, storeOp, readOnly } = options;
    const used =
        clearValue !== undefined ||
        loadOp !== undefined ||
        storeOp !== undefined ||
        readOnly !== undefined;
    if (!used) return { used: false, requiresLoad: false, writes: false, stores: true };
    if (loadOp !== undefined) validateLoadOp(loadOp, `${path}.${label}LoadOp`);
    if (storeOp !== undefined) validateStoreOp(storeOp, `${path}.${label}StoreOp`);
    if (readOnly === true) {
        if (clearValue !== undefined || loadOp !== undefined || storeOp !== undefined) {
            renderGraphFailure(
                'invalid-descriptor',
                `read-only ${label} cannot declare clear, load, or store operations`,
                path
            );
        }
        return { used: true, requiresLoad: true, writes: false, stores: true };
    }
    if (loadOp === undefined || storeOp === undefined) {
        renderGraphFailure(
            'invalid-descriptor',
            `writable ${label} requires explicit load and store operations`,
            path
        );
    }
    return {
        used: true,
        requiresLoad: loadOp === 'load',
        writes: true,
        stores: storeOp === 'store'
    };
}

function validateDepthStencilAttachment(
    declaration: RGDepthStencilAttachmentDeclaration,
    resources: ReadonlyMap<RGResourceHandle, CompiledRGResource>,
    passName: string
): { readonly resource: CompiledRGTextureResource; readonly access: DepthStencilAccess } {
    const path = `${passName}.depthStencilAttachment`;
    const resource = requireTextureResource(resources, declaration.texture, passName);
    validateRenderAttachmentTexture(resource, `${path}.texture`, 'depth-stencil');
    const hasDepth = rhiTextureFormatHasDepth(resource.descriptor.format);
    const hasStencil = rhiTextureFormatHasStencil(resource.descriptor.format);
    const depth = validateDepthStencilAspect({
        path,
        label: 'depth',
        clearValue: declaration.depthClearValue,
        loadOp: declaration.depthLoadOp,
        storeOp: declaration.depthStoreOp,
        readOnly: declaration.depthReadOnly
    });
    const stencil = validateDepthStencilAspect({
        path,
        label: 'stencil',
        clearValue: declaration.stencilClearValue,
        loadOp: declaration.stencilLoadOp,
        storeOp: declaration.stencilStoreOp,
        readOnly: declaration.stencilReadOnly
    });
    if (
        (!depth.used && !stencil.used) ||
        (depth.used && !hasDepth) ||
        (stencil.used && !hasStencil)
    ) {
        renderGraphFailure(
            'invalid-descriptor',
            'depth/stencil operations do not match the attachment format',
            path
        );
    }
    if (
        declaration.depthLoadOp === 'clear' &&
        (declaration.depthClearValue === undefined ||
            !Number.isFinite(declaration.depthClearValue) ||
            declaration.depthClearValue < 0 ||
            declaration.depthClearValue > 1)
    ) {
        renderGraphFailure(
            'invalid-descriptor',
            'depth clear requires a finite value in [0, 1]',
            `${path}.depthClearValue`
        );
    }
    if (
        declaration.stencilLoadOp === 'clear' &&
        (declaration.stencilClearValue === undefined ||
            !Number.isInteger(declaration.stencilClearValue) ||
            declaration.stencilClearValue < 0 ||
            declaration.stencilClearValue > 0xffff_ffff)
    ) {
        renderGraphFailure(
            'invalid-descriptor',
            'stencil clear requires an unsigned 32-bit value',
            `${path}.stencilClearValue`
        );
    }
    return {
        resource,
        access: {
            hasDepth,
            hasStencil,
            depth,
            stencil
        }
    };
}

/** Pure validation, dependency, culling, scheduling, and lifetime compilation. */
export class RenderGraphCompiler {
    readonly #workspace = new RenderGraphCompilerWorkspace();
    #compiling = false;

    get storageDiagnostics(): Readonly<RenderGraphCompilerStorageDiagnostics> {
        return this.#workspace.diagnostics;
    }

    compile(
        snapshot: RenderGraphBuildSnapshot,
        capabilities: RHICapabilities
    ): CompiledRenderGraph {
        if (this.#compiling) throw new Error('Render graph compilation is not reentrant');
        this.#compiling = true;
        this.#workspace.begin(snapshot.resources.length, snapshot.passes.length);
        try {
            return this.compileInWorkspace(snapshot, capabilities);
        } finally {
            this.#workspace.release();
            this.#compiling = false;
        }
    }

    private compileInWorkspace(
        snapshot: RenderGraphBuildSnapshot,
        capabilities: RHICapabilities
    ): CompiledRenderGraph {
        const workspace = this.#workspace;
        const normalizedResources = workspace.normalizedResources;
        const resourceByHandle = workspace.resourceByHandle;
        const resourceWriters = workspace.resourceWriters;
        const lastPreferredGraphWriter = workspace.lastPreferredGraphWriter;
        const preferredGraphWriterReads = workspace.preferredGraphWriterReads;
        const lastWriter = workspace.lastWriter;
        const readersSinceWrite = workspace.readersSinceWrite;
        const contentAvailable = workspace.contentAvailable;
        const depthContentAvailable = workspace.depthContentAvailable;
        const stencilContentAvailable = workspace.stencilContentAvailable;
        const passIndexByHandle = workspace.passIndexByHandle;
        const outgoing = workspace.outgoing;
        const incoming = workspace.incoming;
        for (const resource of snapshot.resources) {
            const normalized = normalizedResource(resource, capabilities);
            normalizedResources.push(normalized);
            resourceByHandle.set(normalized.handle, normalized);
            const imported = normalized.origin === 'imported';
            contentAvailable.set(
                normalized.handle,
                normalized.kind === 'buffer' ? normalized.initiallyInitialized : imported
            );
            if (normalized.kind === 'texture') {
                if (rhiTextureFormatHasDepth(normalized.descriptor.format)) {
                    depthContentAvailable.set(normalized.handle, imported);
                }
                if (rhiTextureFormatHasStencil(normalized.descriptor.format)) {
                    stencilContentAvailable.set(normalized.handle, imported);
                }
            }
        }
        for (const pass of snapshot.passes) passIndexByHandle.set(pass.handle, pass.index);

        const capturePreferredWriter = (handle: RGResourceHandle, pass: RGPassNode): void => {
            const resource = resourceByHandle.get(handle);
            if (resource?.kind === 'texture' && resource.readFromLastGraphWriter) {
                lastPreferredGraphWriter.set(handle, pass.index);
            }
        };
        for (const pass of snapshot.passes) {
            for (const handle of pass.writes) capturePreferredWriter(handle, pass);
            for (const attachment of pass.colorAttachments) {
                capturePreferredWriter(attachment.texture, pass);
                if (attachment.resolveTarget !== undefined) {
                    capturePreferredWriter(attachment.resolveTarget, pass);
                }
            }
            const depthStencil = pass.depthStencilAttachment;
            if (depthStencil !== null) {
                const { resource, access } = validateDepthStencilAttachment(
                    depthStencil,
                    resourceByHandle,
                    pass.name
                );
                if (access.depth.writes || access.stencil.writes) {
                    capturePreferredWriter(resource.handle, pass);
                }
            }
        }

        const requireResource = (handle: RGResourceHandle, pass: RGPassNode) => {
            const resource = resourceByHandle.get(handle);
            if (!resource) {
                renderGraphFailure(
                    'invalid-handle',
                    `resource ${String(handle)} is not in this graph`,
                    pass.name
                );
            }
            return resource;
        };
        const readResourceDependency = (
            handle: RGResourceHandle,
            pass: RGPassNode,
            preferLastGraphWriter = false
        ): void => {
            const resource = requireResource(handle, pass);
            const preferredWriter = preferLastGraphWriter
                ? lastPreferredGraphWriter.get(handle)
                : undefined;
            if (resource.kind === 'texture' && resource.readFromLastGraphWriter) {
                if (preferredWriter !== undefined) {
                    addEdge(outgoing, incoming, preferredWriter, pass.index);
                    preferredGraphWriterReads.add(handle);
                    return;
                }
            }
            const writer = lastWriter.get(handle);
            if (writer !== undefined) addEdge(outgoing, incoming, writer, pass.index);
            let readers = readersSinceWrite.get(handle);
            readers ??= workspace.acquireReaderSet(handle);
            readers.add(pass.index);
        };
        const genericContentAvailable = (resource: CompiledRGResource): boolean =>
            contentAvailable.get(resource.handle) === true;
        const readResource = (
            handle: RGResourceHandle,
            pass: RGPassNode,
            preferLastGraphWriter = false
        ): void => {
            const resource = requireResource(handle, pass);
            if (
                preferLastGraphWriter &&
                resource.kind === 'texture' &&
                resource.readFromLastGraphWriter &&
                lastPreferredGraphWriter.has(handle)
            ) {
                readResourceDependency(handle, pass, true);
                return;
            }
            if (!genericContentAvailable(resource)) {
                renderGraphFailure(
                    'uninitialized-read',
                    `reads resource ${resource.name} before initialization or after discard`,
                    pass.name
                );
            }
            readResourceDependency(handle, pass, preferLastGraphWriter);
        };
        const writeResourceDependency = (
            handle: RGResourceHandle,
            pass: RGPassNode
        ): CompiledRGResource => {
            const resource = requireResource(handle, pass);
            const writer = lastWriter.get(handle);
            if (writer !== undefined) addEdge(outgoing, incoming, writer, pass.index);
            for (const reader of readersSinceWrite.get(handle) ?? []) {
                addEdge(outgoing, incoming, reader, pass.index);
            }
            workspace.acquireReaderSet(handle).clear();
            lastWriter.set(handle, pass.index);
            resourceWriters.set(handle, pass.index);
            return resource;
        };
        const writeResource = (handle: RGResourceHandle, pass: RGPassNode): void => {
            const resource = writeResourceDependency(handle, pass);
            contentAvailable.set(handle, true);
            if (resource.kind === 'texture') {
                if (rhiTextureFormatHasDepth(resource.descriptor.format)) {
                    depthContentAvailable.set(handle, true);
                }
                if (rhiTextureFormatHasStencil(resource.descriptor.format)) {
                    stencilContentAvailable.set(handle, true);
                }
            }
        };

        for (const pass of snapshot.passes) {
            if (pass.colorAttachments.length > capabilities.limits.maxColorAttachments) {
                renderGraphFailure(
                    'invalid-descriptor',
                    'render pass exceeds the device color attachment limit',
                    pass.name
                );
            }
            let attachmentReference: CompiledRGTextureResource | null = null;
            const readSet = workspace.scratchReadSet;
            readSet.clear();
            for (const handle of pass.reads) readSet.add(handle);
            const readWriteSet = workspace.scratchReadWriteSet;
            readWriteSet.clear();
            for (const handle of pass.readWriteBuffers) {
                const resource = requireResource(handle, pass);
                if (resource.kind !== 'buffer') {
                    renderGraphFailure(
                        'invalid-handle',
                        'read-write access requires a buffer resource',
                        pass.name
                    );
                }
                readWriteSet.add(handle);
            }
            for (const handle of pass.writes) {
                if (readSet.has(handle) && !readWriteSet.has(handle as RGBufferHandle)) {
                    renderGraphFailure(
                        'duplicate-access',
                        'same-pass read/write feedback is not portable',
                        pass.name
                    );
                }
            }
            for (const access of pass.bufferAccesses) {
                const resource = requireResource(access.buffer, pass);
                if (resource.kind !== 'buffer') {
                    renderGraphFailure(
                        'invalid-handle',
                        'buffer access requires a buffer resource',
                        pass.name
                    );
                }
                const usage = bufferAccessUsage(access);
                if ((resource.descriptor.usage & usage) === 0) {
                    renderGraphFailure(
                        'invalid-descriptor',
                        `buffer ${resource.name} lacks declared ${access.use} usage`,
                        pass.name
                    );
                }
                if (
                    access.mode === 'read-write' &&
                    (!readSet.has(access.buffer) ||
                        !pass.writes.includes(access.buffer) ||
                        !readWriteSet.has(access.buffer))
                ) {
                    renderGraphFailure(
                        'invalid-descriptor',
                        'read-write buffer access is inconsistent with pass dependencies',
                        pass.name
                    );
                }
            }
            for (const dependencyHandle of pass.explicitDependencies) {
                const dependency = passIndexByHandle.get(dependencyHandle);
                if (dependency === undefined) {
                    renderGraphFailure(
                        'invalid-handle',
                        `dependency ${String(dependencyHandle)} is not in this graph`,
                        pass.name
                    );
                }
                addEdge(outgoing, incoming, dependency, pass.index);
            }
            for (const handle of pass.reads) {
                readResource(handle, pass, true);
            }
            for (const handle of pass.writes) {
                writeResource(handle, pass);
            }
            for (let index = 0; index < pass.colorAttachments.length; index += 1) {
                const declaration = pass.colorAttachments[index];
                if (!declaration) throw new Error('Render graph color attachment is unavailable');
                const { source, resolve } = validateColorAttachment(
                    declaration,
                    resourceByHandle,
                    pass.name,
                    index
                );
                if (attachmentReference) {
                    validateAttachmentCompatibility(
                        attachmentReference,
                        source,
                        `${pass.name}.colorAttachments[${String(index)}]`
                    );
                } else attachmentReference = source;
                if (declaration.loadOp === 'load') readResource(source.handle, pass);
                writeResource(source.handle, pass);
                contentAvailable.set(source.handle, declaration.storeOp === 'store');
                if (resolve) writeResource(resolve.handle, pass);
            }
            if (pass.depthStencilAttachment) {
                const { resource, access } = validateDepthStencilAttachment(
                    pass.depthStencilAttachment,
                    resourceByHandle,
                    pass.name
                );
                if (attachmentReference) {
                    validateAttachmentCompatibility(
                        attachmentReference,
                        resource,
                        `${pass.name}.depthStencilAttachment`
                    );
                }
                if (
                    access.depth.requiresLoad &&
                    depthContentAvailable.get(resource.handle) !== true
                ) {
                    renderGraphFailure(
                        'uninitialized-read',
                        `loads depth from ${resource.name} before initialization or after discard`,
                        pass.name
                    );
                }
                if (
                    access.stencil.requiresLoad &&
                    stencilContentAvailable.get(resource.handle) !== true
                ) {
                    renderGraphFailure(
                        'uninitialized-read',
                        `loads stencil from ${resource.name} before initialization or after discard`,
                        pass.name
                    );
                }
                if (access.depth.requiresLoad || access.stencil.requiresLoad) {
                    readResourceDependency(resource.handle, pass);
                }
                if (access.depth.writes || access.stencil.writes) {
                    writeResourceDependency(resource.handle, pass);
                    if (access.depth.writes) {
                        depthContentAvailable.set(resource.handle, access.depth.stores);
                    }
                    if (access.stencil.writes) {
                        stencilContentAvailable.set(resource.handle, access.stencil.stores);
                    }
                    contentAvailable.set(
                        resource.handle,
                        (!access.hasDepth || depthContentAvailable.get(resource.handle) === true) &&
                            (!access.hasStencil ||
                                stencilContentAvailable.get(resource.handle) === true)
                    );
                }
            }
        }

        for (const handle of preferredGraphWriterReads) {
            const resource = resourceByHandle.get(handle);
            if (resource !== undefined && genericContentAvailable(resource)) continue;
            renderGraphFailure(
                'uninitialized-read',
                `reads resource ${resource?.name ?? String(handle)} after its last graph writer discarded the contents`
            );
        }

        const completeOrder = stableTopologicalOrder(
            outgoing,
            incoming,
            snapshot.passes.length,
            workspace
        );
        const roots = workspace.roots;
        for (const pass of snapshot.passes) if (pass.sideEffect) roots.add(pass.index);
        for (const output of snapshot.outputs) {
            const resource = resourceByHandle.get(output);
            if (!resource) {
                renderGraphFailure(
                    'invalid-handle',
                    `output ${String(output)} is not in this graph`
                );
            }
            const writer = resourceWriters.get(output);
            if (
                contentAvailable.get(output) !== true &&
                (writer === undefined || resource.extracted)
            ) {
                renderGraphFailure(
                    'uninitialized-read',
                    `output resource ${resource.name} is uninitialized or was discarded`
                );
            }
            if (writer !== undefined) roots.add(writer);
        }
        const live = markLivePasses(roots, incoming, snapshot.passes.length, workspace);
        const scheduledSourceIndices = workspace.scheduledSourceIndices;
        scheduledSourceIndices.length = 0;
        for (const index of completeOrder) {
            if (live[index] !== 0) scheduledSourceIndices.push(index);
        }
        const firstUse = workspace.firstUse;
        const lastUse = workspace.lastUse;
        const compiledPasses: CompiledRGPass[] = [];
        for (let order = 0; order < scheduledSourceIndices.length; order += 1) {
            const sourceIndex = scheduledSourceIndices[order];
            if (sourceIndex === undefined) {
                throw new Error('Render graph compiler lost a scheduled pass index');
            }
            const pass = snapshot.passes[sourceIndex];
            if (!pass) throw new Error('Render graph compiler lost a scheduled pass');
            const reads = new Set(pass.reads);
            const writes = new Set(pass.writes);
            const bufferAccesses = Object.freeze(
                pass.bufferAccesses.map(access => Object.freeze({ ...access }))
            );
            for (const attachment of pass.colorAttachments) {
                writes.add(attachment.texture);
                if (attachment.resolveTarget !== undefined) writes.add(attachment.resolveTarget);
            }
            if (pass.depthStencilAttachment) {
                const { resource, access } = validateDepthStencilAttachment(
                    pass.depthStencilAttachment,
                    resourceByHandle,
                    pass.name
                );
                (access.depth.writes || access.stencil.writes ? writes : reads).add(
                    resource.handle
                );
            }
            for (const handle of reads) {
                if (!firstUse.has(handle)) firstUse.set(handle, order);
                lastUse.set(handle, order);
            }
            for (const handle of writes) {
                if (!firstUse.has(handle)) firstUse.set(handle, order);
                lastUse.set(handle, order);
            }
            compiledPasses.push(
                Object.freeze({
                    handle: pass.handle,
                    sourceIndex,
                    order,
                    name: pass.name,
                    template: pass.template,
                    params: pass.params,
                    reads,
                    writes,
                    bufferAccesses
                })
            );
        }
        const compiledResources: CompiledRGResource[] = [];
        for (const resource of normalizedResources) {
            if (!firstUse.has(resource.handle) && !resource.extracted) continue;
            const first = firstUse.get(resource.handle);
            const lifetime =
                first === undefined
                    ? null
                    : Object.freeze({
                          firstUse: first,
                          lastUse: lastUse.get(resource.handle) ?? first
                      });
            compiledResources.push(Object.freeze({ ...resource, lifetime }));
        }
        return new CompiledRenderGraph(
            snapshot.generation,
            Object.freeze(compiledResources),
            Object.freeze(compiledPasses)
        );
    }
}
