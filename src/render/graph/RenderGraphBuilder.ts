import {
    RHIBufferUsage,
    type RHIBuffer,
    type RHIBufferUsageFlags,
    type RHITexture,
    type RHITextureUsageFlags
} from '../rhi/core';
import type { RGPassContext, RGPrepareContext } from './RenderGraphExecutor';
import type { RGPassTimestampKind } from './RenderGraphTimeline';
import type {
    RGBufferDescriptor,
    RGBufferAccessDeclaration,
    RGBufferHandle,
    RGBufferReadUse,
    RGColorAttachmentDeclaration,
    RGDepthStencilAttachmentDeclaration,
    RGImportedBufferProvider,
    RGImportedTextureProvider,
    RGBufferResourceNode,
    RGPassHandle,
    RGResourceHandle,
    RGResourceNode,
    RGTextureDescriptor,
    RGTextureAccessHandle,
    RGTextureHandle,
    RGTextureViewDescriptor,
    RGTextureViewHandle,
    RGTextureViewResourceNode,
    RGTextureResourceNode,
    RGBufferWriteUse
} from './RenderGraphResource';
import { renderGraphFailure } from './RenderGraphValidation';
import { assertSynchronousGraphCallback } from './RenderGraphCallback';

let nextBuilderGeneration = 1;
let nextGraphHandle = 1;

function allocateBuilderGeneration(): number {
    if (!Number.isSafeInteger(nextBuilderGeneration)) {
        throw new RangeError('Render graph handle generation space is exhausted');
    }
    return nextBuilderGeneration++;
}

function allocateGraphHandle(): RGResourceHandle | RGPassHandle {
    if (!Number.isSafeInteger(nextGraphHandle)) {
        throw new RangeError('Render graph handle identity space is exhausted');
    }
    return nextGraphHandle++ as RGResourceHandle | RGPassHandle;
}

/**
 * Stable built-in pass code.
 *
 * `setup` is pure graph declaration. Optional `prepare` runs after every live graph resource has
 * been allocated/imported, but before a frame command context exists. `execute` is the only phase
 * that can issue RHI commands.
 */
export interface RenderPassTemplate<P> {
    readonly name: string;
    /** Native pass category used only by opt-in automatic GPU timestamp instrumentation. */
    timestampKind?(params: P): RGPassTimestampKind | null;
    /** Declare accesses synchronously. Promise-like results are rejected. */
    setup(builder: RGPassBuilder, params: P): unknown;
    /** Prepare backend objects synchronously, before command recording. */
    prepare?(context: RGPrepareContext, params: P): unknown;
    /** Record commands synchronously. Promise-like results are rejected. */
    execute(context: RGPassContext, params: P): unknown;
}

/** @internal Immutable-enough compiler input owned by a consumed builder. */
export interface RGPassNode {
    readonly handle: RGPassHandle;
    readonly index: number;
    readonly name: string;
    readonly template: RenderPassTemplate<unknown>;
    readonly params: unknown;
    readonly reads: readonly RGResourceHandle[];
    readonly writes: readonly RGResourceHandle[];
    readonly readWriteBuffers: readonly RGBufferHandle[];
    readonly bufferAccesses: readonly RGBufferAccessDeclaration[];
    readonly colorAttachments: readonly RGColorAttachmentDeclaration[];
    readonly depthStencilAttachment: RGDepthStencilAttachmentDeclaration | null;
    readonly explicitDependencies: readonly RGPassHandle[];
    readonly sideEffect: boolean;
}

/** @internal */
export interface RenderGraphBuildSnapshot {
    readonly generation: number;
    readonly resources: readonly RGResourceNode[];
    readonly passes: readonly RGPassNode[];
    readonly outputs: ReadonlySet<RGResourceHandle>;
}

interface MutablePassNode {
    handle: RGPassHandle;
    index: number;
    name: string;
    template: RenderPassTemplate<unknown>;
    params: unknown;
    readonly reads: RGResourceHandle[];
    readonly writes: RGResourceHandle[];
    readonly readSet: Set<RGResourceHandle>;
    readonly writeSet: Set<RGResourceHandle>;
    readonly readWriteBuffers: RGBufferHandle[];
    readonly bufferAccesses: MutableBufferAccessDeclaration[];
    readonly bufferAccessPool: MutableBufferAccessDeclaration[];
    readonly attachmentSet: Set<RGResourceHandle>;
    readonly colorAttachments: MutableColorAttachmentDeclaration[];
    readonly colorAttachmentPool: MutableColorAttachmentDeclaration[];
    depthStencilAttachment: RGDepthStencilAttachmentDeclaration | null;
    readonly depthStencilStorage: MutableDepthStencilAttachmentDeclaration;
    readonly explicitDependencies: RGPassHandle[];
    readonly dependencySet: Set<RGPassHandle>;
    sideEffect: boolean;
}

type MutableTextureDescriptor = Omit<
    { -readonly [Key in keyof RGTextureDescriptor]: RGTextureDescriptor[Key] },
    'size' | 'viewFormats'
> & {
    size: {
        width: number;
        height?: number;
        depthOrArrayLayers?: number;
    };
    viewFormats?: NonNullable<RGTextureDescriptor['viewFormats']>;
    readonly viewFormatStorage: NonNullable<RGTextureDescriptor['viewFormats']>[number][];
};
type MutableBufferDescriptor = {
    -readonly [Key in keyof RGBufferDescriptor]: RGBufferDescriptor[Key];
};
type MutableTextureResourceNode = Omit<
    { -readonly [Key in keyof RGTextureResourceNode]: RGTextureResourceNode[Key] },
    'descriptor'
> & { descriptor: MutableTextureDescriptor };
type MutableTextureViewDescriptor = {
    -readonly [Key in keyof RGTextureViewDescriptor]: RGTextureViewDescriptor[Key];
};
type MutableTextureViewResourceNode = Omit<
    { -readonly [Key in keyof RGTextureViewResourceNode]: RGTextureViewResourceNode[Key] },
    'descriptor'
> & { descriptor: MutableTextureViewDescriptor };
type MutableBufferResourceNode = Omit<
    { -readonly [Key in keyof RGBufferResourceNode]: RGBufferResourceNode[Key] },
    'descriptor'
> & { descriptor: MutableBufferDescriptor };
type MutableResourceNode =
    MutableTextureResourceNode | MutableTextureViewResourceNode | MutableBufferResourceNode;
type MutableDepthStencilAttachmentDeclaration = {
    -readonly [
        Key in keyof RGDepthStencilAttachmentDeclaration
    ]: RGDepthStencilAttachmentDeclaration[Key];
};

interface MutableColorAttachmentDeclaration extends RGColorAttachmentDeclaration {
    texture: RGTextureAccessHandle;
    resolveTarget?: RGTextureAccessHandle;
    clearValue?: { r: number; g: number; b: number; a: number };
    loadOp: RGColorAttachmentDeclaration['loadOp'];
    storeOp: RGColorAttachmentDeclaration['storeOp'];
    readonly clearValueStorage: { r: number; g: number; b: number; a: number };
}

interface MutableBufferAccessDeclaration {
    buffer: RGBufferHandle;
    mode: RGBufferAccessDeclaration['mode'];
    use: RGBufferReadUse | RGBufferWriteUse;
}

function bufferUseUsage(use: RGBufferReadUse | RGBufferWriteUse): RHIBufferUsageFlags {
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
            return renderGraphFailure('invalid-descriptor', `unknown buffer use ${String(use)}`);
    }
}

function importedTextureViewDimension(descriptor: RGTextureDescriptor): string {
    const dimension = descriptor.dimension ?? '2d';
    return (
        descriptor.viewDimension ??
        (dimension !== '2d'
            ? dimension
            : (descriptor.size.depthOrArrayLayers ?? 1) > 1
              ? '2d-array'
              : '2d')
    );
}

function sameImportedTextureDescriptor(
    first: RGTextureDescriptor,
    second: RGTextureDescriptor
): boolean {
    const firstFormats = first.viewFormats;
    const secondFormats = second.viewFormats;
    return (
        first.size.width === second.size.width &&
        (first.size.height ?? 1) === (second.size.height ?? 1) &&
        (first.size.depthOrArrayLayers ?? 1) === (second.size.depthOrArrayLayers ?? 1) &&
        (first.dimension ?? '2d') === (second.dimension ?? '2d') &&
        importedTextureViewDimension(first) === importedTextureViewDimension(second) &&
        (first.mipLevelCount ?? 1) === (second.mipLevelCount ?? 1) &&
        (first.sampleCount ?? 1) === (second.sampleCount ?? 1) &&
        first.format === second.format &&
        first.usage === second.usage &&
        (firstFormats?.length ?? 0) === (secondFormats?.length ?? 0) &&
        (firstFormats === undefined ||
            firstFormats.every(format => secondFormats?.includes(format)))
    );
}

const EMPTY_PASS_TEMPLATE: RenderPassTemplate<unknown> = Object.freeze({
    name: '<recycled>',
    setup(builder: RGPassBuilder, params: unknown) {
        void builder;
        void params;
    },
    execute(context: RGPassContext, params: unknown) {
        void context;
        void params;
    }
});

export interface RenderGraphBuilderStorageDiagnostics {
    readonly resourceNodeCapacity: number;
    readonly passNodeCapacity: number;
    readonly colorAttachmentCapacity: number;
    readonly growthCount: number;
}

type MutableBuilderStorageDiagnostics = {
    -readonly [
        Key in keyof RenderGraphBuilderStorageDiagnostics
    ]: RenderGraphBuilderStorageDiagnostics[Key];
};

interface MutableRenderGraphBuildSnapshot {
    generation: number;
    readonly resources: readonly RGResourceNode[];
    readonly passes: readonly RGPassNode[];
    readonly outputs: ReadonlySet<RGResourceHandle>;
}

/**
 * High-water backing storage leased to one short-lived builder shell at a time.
 *
 * The shell itself is deliberately not reused: keeping consumed shells permanently closed makes a
 * stale user reference harmless. Only storage that is unreachable through the consumed shell is
 * returned after synchronous compilation has completed.
 *
 * @internal
 */
export class RenderGraphBuilderStorage {
    readonly resources: MutableResourceNode[] = [];
    readonly resourceByHandle = new Map<RGResourceHandle, MutableResourceNode>();
    readonly importedTextures = new Map<object, MutableTextureResourceNode>();
    readonly importedBuffers = new Map<object, MutableBufferResourceNode>();
    readonly passes: MutablePassNode[] = [];
    readonly passByHandle = new Map<RGPassHandle, MutablePassNode>();
    readonly outputs = new Set<RGResourceHandle>();
    readonly snapshot: MutableRenderGraphBuildSnapshot = {
        generation: 0,
        resources: this.resources,
        passes: this.passes as RGPassNode[],
        outputs: this.outputs
    };
    readonly diagnostics: MutableBuilderStorageDiagnostics = {
        resourceNodeCapacity: 0,
        passNodeCapacity: 0,
        colorAttachmentCapacity: 0,
        growthCount: 0
    };

    readonly #textureNodePool: MutableTextureResourceNode[] = [];
    readonly #textureViewNodePool: MutableTextureViewResourceNode[] = [];
    readonly #bufferNodePool: MutableBufferResourceNode[] = [];
    readonly #passNodePool: MutablePassNode[] = [];
    #textureNodeCursor = 0;
    #textureViewNodeCursor = 0;
    #bufferNodeCursor = 0;
    #passNodeCursor = 0;
    #leased = false;

    begin(): void {
        if (this.#leased) throw new Error('Render graph builder storage is already leased');
        this.#leased = true;
        this.#textureNodeCursor = 0;
        this.#textureViewNodeCursor = 0;
        this.#bufferNodeCursor = 0;
        this.#passNodeCursor = 0;
        this.resources.length = 0;
        this.resourceByHandle.clear();
        this.importedTextures.clear();
        this.importedBuffers.clear();
        this.passes.length = 0;
        this.passByHandle.clear();
        this.outputs.clear();
        this.snapshot.generation = allocateBuilderGeneration();
    }

    acquireTextureNode(
        handle: RGTextureHandle,
        name: string,
        origin: RGTextureResourceNode['origin'],
        descriptor: RGTextureDescriptor,
        imported: RHITexture | null,
        provider: RGImportedTextureProvider | null,
        resourceLifetime: RGTextureResourceNode['resourceLifetime'],
        initiallyInitialized: boolean
    ): MutableTextureResourceNode {
        let node = this.#textureNodePool[this.#textureNodeCursor];
        if (!node) {
            node = {
                kind: 'texture',
                handle,
                name,
                origin,
                descriptor: this.createTextureDescriptor(descriptor),
                imported,
                provider,
                resourceLifetime,
                readFromLastGraphWriter: false,
                initiallyInitialized,
                extracted: false
            };
            this.#textureNodePool.push(node);
            this.recordResourceGrowth();
        } else {
            node.handle = handle;
            node.name = name;
            node.origin = origin;
            this.copyTextureDescriptor(node.descriptor, descriptor);
            node.imported = imported;
            node.provider = provider;
            node.resourceLifetime = resourceLifetime;
            node.readFromLastGraphWriter = false;
            node.initiallyInitialized = initiallyInitialized;
            node.extracted = false;
        }
        this.#textureNodeCursor++;
        this.resources.push(node);
        this.resourceByHandle.set(handle, node);
        return node;
    }

    acquireBufferNode(
        handle: RGBufferHandle,
        name: string,
        origin: RGBufferResourceNode['origin'],
        descriptor: RGBufferDescriptor,
        imported: RHIBuffer | null,
        provider: RGImportedBufferProvider | null,
        resourceLifetime: RGBufferResourceNode['resourceLifetime'],
        initiallyInitialized: boolean
    ): MutableBufferResourceNode {
        let node = this.#bufferNodePool[this.#bufferNodeCursor];
        if (!node) {
            node = {
                kind: 'buffer',
                handle,
                name,
                origin,
                descriptor: this.createBufferDescriptor(descriptor),
                imported,
                provider,
                resourceLifetime,
                initiallyInitialized,
                extracted: false
            };
            this.#bufferNodePool.push(node);
            this.recordResourceGrowth();
        } else {
            node.handle = handle;
            node.name = name;
            node.origin = origin;
            this.copyBufferDescriptor(node.descriptor, descriptor);
            node.imported = imported;
            node.provider = provider;
            node.resourceLifetime = resourceLifetime;
            node.initiallyInitialized = initiallyInitialized;
            node.extracted = false;
        }
        this.#bufferNodeCursor++;
        this.resources.push(node);
        this.resourceByHandle.set(handle, node);
        return node;
    }

    acquireTextureViewNode(
        handle: RGTextureViewHandle,
        name: string,
        texture: RGTextureHandle,
        descriptor: RGTextureViewDescriptor
    ): MutableTextureViewResourceNode {
        let node = this.#textureViewNodePool[this.#textureViewNodeCursor];
        if (!node) {
            node = {
                kind: 'texture-view',
                handle,
                name,
                texture,
                descriptor: this.createTextureViewDescriptor(descriptor),
                extracted: false
            };
            this.#textureViewNodePool.push(node);
            this.recordResourceGrowth();
        } else {
            node.handle = handle;
            node.name = name;
            node.texture = texture;
            this.copyTextureViewDescriptor(node.descriptor, descriptor);
        }
        this.#textureViewNodeCursor++;
        this.resources.push(node);
        this.resourceByHandle.set(handle, node);
        return node;
    }

    acquirePassNode<P>(
        handle: RGPassHandle,
        index: number,
        template: RenderPassTemplate<P>,
        params: P
    ): MutablePassNode {
        let pass = this.#passNodePool[this.#passNodeCursor];
        if (!pass) {
            pass = {
                handle,
                index,
                name: template.name,
                template,
                params,
                reads: [],
                writes: [],
                readSet: new Set(),
                writeSet: new Set(),
                readWriteBuffers: [],
                bufferAccesses: [],
                bufferAccessPool: [],
                attachmentSet: new Set(),
                colorAttachments: [],
                colorAttachmentPool: [],
                depthStencilAttachment: null,
                depthStencilStorage: { texture: 0 as RGTextureAccessHandle },
                explicitDependencies: [],
                dependencySet: new Set(),
                sideEffect: false
            };
            this.#passNodePool.push(pass);
            this.diagnostics.passNodeCapacity = this.#passNodePool.length;
            this.diagnostics.growthCount++;
        } else {
            pass.handle = handle;
            pass.index = index;
            pass.name = template.name;
            pass.template = template;
            pass.params = params;
            pass.reads.length = 0;
            pass.writes.length = 0;
            pass.readSet.clear();
            pass.writeSet.clear();
            pass.readWriteBuffers.length = 0;
            pass.bufferAccesses.length = 0;
            pass.attachmentSet.clear();
            pass.colorAttachments.length = 0;
            pass.depthStencilAttachment = null;
            pass.explicitDependencies.length = 0;
            pass.dependencySet.clear();
            pass.sideEffect = false;
        }
        this.#passNodeCursor++;
        this.passes.push(pass);
        this.passByHandle.set(handle, pass);
        return pass;
    }

    acquireBufferAccess(
        pass: MutablePassNode,
        buffer: RGBufferHandle,
        mode: RGBufferAccessDeclaration['mode'],
        use: RGBufferReadUse | RGBufferWriteUse
    ): void {
        for (const existing of pass.bufferAccesses) {
            if (existing.buffer === buffer && existing.mode === mode && existing.use === use) {
                return;
            }
        }
        const index = pass.bufferAccesses.length;
        let access = pass.bufferAccessPool[index];
        if (!access) {
            access = { buffer, mode, use };
            pass.bufferAccessPool.push(access);
            this.diagnostics.growthCount++;
        } else {
            access.buffer = buffer;
            access.mode = mode;
            access.use = use;
        }
        pass.bufferAccesses.push(access);
    }

    acquireColorAttachment(
        pass: MutablePassNode,
        declaration: RGColorAttachmentDeclaration
    ): MutableColorAttachmentDeclaration {
        const index = pass.colorAttachments.length;
        let attachment = pass.colorAttachmentPool[index];
        if (!attachment) {
            attachment = {
                texture: declaration.texture,
                loadOp: declaration.loadOp,
                storeOp: declaration.storeOp,
                clearValueStorage: { r: 0, g: 0, b: 0, a: 0 }
            };
            pass.colorAttachmentPool.push(attachment);
            this.diagnostics.colorAttachmentCapacity++;
            this.diagnostics.growthCount++;
        }
        attachment.texture = declaration.texture;
        attachment.loadOp = declaration.loadOp;
        attachment.storeOp = declaration.storeOp;
        if (declaration.resolveTarget === undefined) delete attachment.resolveTarget;
        else attachment.resolveTarget = declaration.resolveTarget;
        const clearValue = declaration.clearValue;
        if (clearValue === undefined) delete attachment.clearValue;
        else {
            const target = attachment.clearValueStorage;
            target.r = clearValue.r;
            target.g = clearValue.g;
            target.b = clearValue.b;
            target.a = clearValue.a;
            attachment.clearValue = target;
        }
        pass.colorAttachments.push(attachment);
        return attachment;
    }

    setDepthStencilAttachment(
        pass: MutablePassNode,
        declaration: RGDepthStencilAttachmentDeclaration
    ): void {
        const target = pass.depthStencilStorage;
        target.texture = declaration.texture;
        this.copyOptionalDepthProperty(target, declaration, 'depthClearValue');
        this.copyOptionalDepthProperty(target, declaration, 'depthLoadOp');
        this.copyOptionalDepthProperty(target, declaration, 'depthStoreOp');
        this.copyOptionalDepthProperty(target, declaration, 'depthReadOnly');
        this.copyOptionalDepthProperty(target, declaration, 'stencilClearValue');
        this.copyOptionalDepthProperty(target, declaration, 'stencilLoadOp');
        this.copyOptionalDepthProperty(target, declaration, 'stencilStoreOp');
        this.copyOptionalDepthProperty(target, declaration, 'stencilReadOnly');
        pass.depthStencilAttachment = target;
    }

    rollbackPass(pass: MutablePassNode): void {
        if (this.passes[this.passes.length - 1] !== pass) {
            throw new Error('Render graph pass rollback order is invalid');
        }
        this.passes.pop();
        this.passByHandle.delete(pass.handle);
        this.#passNodeCursor--;
        this.clearPassReferences(pass);
    }

    recycle(): void {
        if (!this.#leased) throw new Error('Render graph builder storage is not leased');
        for (const pass of this.passes) this.clearPassReferences(pass);
        for (const resource of this.resources) {
            resource.name = '';
            if (resource.kind !== 'texture-view') {
                resource.imported = null;
                resource.provider = null;
            }
        }
        this.resources.length = 0;
        this.resourceByHandle.clear();
        this.importedTextures.clear();
        this.importedBuffers.clear();
        this.passes.length = 0;
        this.passByHandle.clear();
        this.outputs.clear();
        this.#leased = false;
    }

    private recordResourceGrowth(): void {
        this.diagnostics.resourceNodeCapacity =
            this.#textureNodePool.length +
            this.#textureViewNodePool.length +
            this.#bufferNodePool.length;
        this.diagnostics.growthCount++;
    }

    private createTextureDescriptor(descriptor: RGTextureDescriptor): MutableTextureDescriptor {
        const target: MutableTextureDescriptor = {
            size: { width: descriptor.size.width },
            format: descriptor.format,
            usage: descriptor.usage,
            viewFormatStorage: []
        };
        this.copyTextureDescriptor(target, descriptor);
        return target;
    }

    private copyTextureDescriptor(
        target: MutableTextureDescriptor,
        source: RGTextureDescriptor
    ): void {
        this.copyOptionalProperty(target, source, 'label');
        target.size.width = source.size.width;
        if (source.size.height === undefined) delete target.size.height;
        else target.size.height = source.size.height;
        if (source.size.depthOrArrayLayers === undefined) delete target.size.depthOrArrayLayers;
        else target.size.depthOrArrayLayers = source.size.depthOrArrayLayers;
        this.copyOptionalProperty(target, source, 'mipLevelCount');
        this.copyOptionalProperty(target, source, 'sampleCount');
        this.copyOptionalProperty(target, source, 'dimension');
        this.copyOptionalProperty(target, source, 'viewDimension');
        target.format = source.format;
        target.usage = source.usage;
        const sourceViewFormats = source.viewFormats;
        if (sourceViewFormats === undefined) delete target.viewFormats;
        else {
            const viewFormats = target.viewFormatStorage;
            viewFormats.length = 0;
            for (const format of sourceViewFormats) viewFormats.push(format);
            target.viewFormats = viewFormats;
        }
    }

    private createBufferDescriptor(descriptor: RGBufferDescriptor): MutableBufferDescriptor {
        const target: MutableBufferDescriptor = {
            size: descriptor.size,
            usage: descriptor.usage
        };
        this.copyBufferDescriptor(target, descriptor);
        return target;
    }

    private createTextureViewDescriptor(
        descriptor: RGTextureViewDescriptor
    ): MutableTextureViewDescriptor {
        const target: MutableTextureViewDescriptor = {};
        this.copyTextureViewDescriptor(target, descriptor);
        return target;
    }

    private copyTextureViewDescriptor(
        target: MutableTextureViewDescriptor,
        source: RGTextureViewDescriptor
    ): void {
        this.copyOptionalProperty(target, source, 'label');
        this.copyOptionalProperty(target, source, 'format');
        this.copyOptionalProperty(target, source, 'dimension');
        this.copyOptionalProperty(target, source, 'aspect');
        this.copyOptionalProperty(target, source, 'baseMipLevel');
        this.copyOptionalProperty(target, source, 'mipLevelCount');
        this.copyOptionalProperty(target, source, 'baseArrayLayer');
        this.copyOptionalProperty(target, source, 'arrayLayerCount');
    }

    private copyBufferDescriptor(
        target: MutableBufferDescriptor,
        source: RGBufferDescriptor
    ): void {
        this.copyOptionalProperty(target, source, 'label');
        target.size = source.size;
        target.usage = source.usage;
        this.copyOptionalProperty(target, source, 'mappedAtCreation');
    }

    private copyOptionalProperty(target: object, source: object, key: PropertyKey): void {
        const targetRecord = target as Record<PropertyKey, unknown>;
        const value = (source as Record<PropertyKey, unknown>)[key];
        if (value === undefined) Reflect.deleteProperty(targetRecord, key);
        else targetRecord[key] = value;
    }

    private clearPassReferences(pass: MutablePassNode): void {
        pass.name = '';
        pass.template = EMPTY_PASS_TEMPLATE;
        pass.params = undefined;
        pass.reads.length = 0;
        pass.writes.length = 0;
        pass.readSet.clear();
        pass.writeSet.clear();
        pass.readWriteBuffers.length = 0;
        pass.bufferAccesses.length = 0;
        pass.attachmentSet.clear();
        pass.colorAttachments.length = 0;
        pass.depthStencilAttachment = null;
        pass.explicitDependencies.length = 0;
        pass.dependencySet.clear();
        pass.sideEffect = false;
    }

    private copyOptionalDepthProperty(
        target: MutableDepthStencilAttachmentDeclaration,
        source: RGDepthStencilAttachmentDeclaration,
        key: Exclude<keyof RGDepthStencilAttachmentDeclaration, 'texture'>
    ): void {
        this.copyOptionalProperty(target, source, key);
    }
}

export class RGPassBuilder {
    #open = true;

    /** @internal */
    constructor(
        private readonly graph: RenderGraphBuilder,
        private readonly pass: MutablePassNode
    ) {}

    /** @internal End the declaration scope before its pooled pass node can be reused. */
    close(): void {
        this.#open = false;
    }

    private assertOpen(): void {
        if (!this.#open) {
            renderGraphFailure('invalid-state', 'pass builder is only valid during setup');
        }
    }

    readTexture(handle: RGTextureAccessHandle): RGTextureAccessHandle {
        this.assertOpen();
        this.graph.requireTextureAccess(handle);
        this.addRead(handle);
        return handle;
    }

    writeTexture(handle: RGTextureAccessHandle): RGTextureAccessHandle {
        this.assertOpen();
        this.graph.requireTextureAccess(handle);
        this.addWrite(handle);
        return handle;
    }

    readBuffer(handle: RGBufferHandle, use: RGBufferReadUse): RGBufferHandle {
        this.assertOpen();
        this.graph.requireResource(handle, 'buffer');
        this.addRead(handle);
        this.graph.acquireBufferAccess(this.pass, handle, 'read', use);
        return handle;
    }

    writeBuffer(handle: RGBufferHandle, use: RGBufferWriteUse): RGBufferHandle {
        this.assertOpen();
        this.graph.requireResource(handle, 'buffer');
        if (use === 'copy-destination' && this.pass.readWriteBuffers.includes(handle)) {
            for (const access of this.pass.bufferAccesses) {
                if (
                    access.buffer === handle &&
                    access.mode === 'read-write' &&
                    access.use === 'copy-destination'
                ) {
                    // A pass may declare several clears, including a full-buffer clear.
                    // Keep an earlier partial update's dependency on existing contents.
                    return handle;
                }
            }
        }
        this.addWrite(handle);
        this.graph.acquireBufferAccess(this.pass, handle, 'write', use);
        return handle;
    }

    /** Preserve prior contents for storage access or an internal partial buffer clear. */
    readWriteBuffer(handle: RGBufferHandle, use: 'storage' | 'copy-destination'): RGBufferHandle {
        this.assertOpen();
        this.graph.requireResource(handle, 'buffer');
        for (const access of this.pass.bufferAccesses) {
            if (access.buffer !== handle || access.use !== use) continue;
            if (access.mode === 'read-write') return handle;
            // A full replacement already declared by this pass supplies all preserved bytes.
            if (use === 'copy-destination' && access.mode === 'write') return handle;
        }
        if (
            this.pass.readSet.has(handle) ||
            this.pass.writeSet.has(handle) ||
            this.pass.attachmentSet.has(handle)
        ) {
            renderGraphFailure(
                'duplicate-access',
                'read-write buffer access must be declared exactly once and cannot be combined with another same-pass access',
                this.pass.name
            );
        }
        this.pass.readSet.add(handle);
        this.pass.reads.push(handle);
        this.pass.writeSet.add(handle);
        this.pass.writes.push(handle);
        this.pass.readWriteBuffers.push(handle);
        this.graph.acquireBufferAccess(this.pass, handle, 'read-write', use);
        return handle;
    }

    useColorAttachment(declaration: RGColorAttachmentDeclaration): void {
        this.assertOpen();
        this.graph.requireTextureAccess(declaration.texture);
        this.addAttachment(declaration.texture);
        if (declaration.resolveTarget !== undefined) {
            this.graph.requireTextureAccess(declaration.resolveTarget);
            this.addAttachment(declaration.resolveTarget);
        }
        this.graph.acquireColorAttachment(this.pass, declaration);
    }

    useDepthStencilAttachment(declaration: RGDepthStencilAttachmentDeclaration): void {
        this.assertOpen();
        if (this.pass.depthStencilAttachment !== null) {
            renderGraphFailure(
                'duplicate-access',
                'a pass can declare only one depth/stencil attachment',
                this.pass.name
            );
        }
        this.graph.requireTextureAccess(declaration.texture);
        this.addAttachment(declaration.texture);
        this.graph.setDepthStencilAttachment(this.pass, declaration);
    }

    dependsOn(handle: RGPassHandle): void {
        this.assertOpen();
        this.graph.requirePass(handle);
        if (handle === this.pass.handle) {
            renderGraphFailure('cycle', 'a pass cannot depend on itself', this.pass.name);
        }
        if (!this.pass.dependencySet.has(handle)) {
            this.pass.dependencySet.add(handle);
            this.pass.explicitDependencies.push(handle);
        }
    }

    markSideEffect(): void {
        this.assertOpen();
        this.pass.sideEffect = true;
    }

    private addRead(handle: RGResourceHandle): void {
        if (this.pass.writeSet.has(handle) || this.pass.attachmentSet.has(handle)) {
            renderGraphFailure(
                'duplicate-access',
                'same-pass read/write feedback is not portable',
                this.pass.name
            );
        }
        if (!this.pass.readSet.has(handle)) {
            this.pass.readSet.add(handle);
            this.pass.reads.push(handle);
        }
    }

    private addWrite(handle: RGResourceHandle): void {
        if (this.pass.readSet.has(handle) || this.pass.attachmentSet.has(handle)) {
            renderGraphFailure(
                'duplicate-access',
                'same-pass read/write feedback is not portable',
                this.pass.name
            );
        }
        if (!this.pass.writeSet.has(handle)) {
            this.pass.writeSet.add(handle);
            this.pass.writes.push(handle);
        }
    }

    private addAttachment(handle: RGResourceHandle): void {
        if (
            this.pass.readSet.has(handle) ||
            this.pass.writeSet.has(handle) ||
            this.pass.attachmentSet.has(handle)
        ) {
            renderGraphFailure(
                'duplicate-access',
                'attachment conflicts with another same-pass resource access',
                this.pass.name
            );
        }
        this.pass.attachmentSet.add(handle);
    }
}

/** Builds a declarative graph. No method on this class owns an RHI device or command context. */
export class RenderGraphBuilder {
    readonly #storage: RenderGraphBuilderStorage;
    readonly #releaseStorage: ((storage: RenderGraphBuilderStorage) => void) | null;
    #consumed = false;
    #recycled = false;
    #settingUp = false;

    /** @internal RenderGraph supplies pooled storage; direct callers receive private storage. */
    constructor(
        storage = new RenderGraphBuilderStorage(),
        releaseStorage: ((storage: RenderGraphBuilderStorage) => void) | null = null
    ) {
        this.#storage = storage;
        this.#releaseStorage = releaseStorage;
        storage.begin();
    }

    createTexture(name: string, descriptor: RGTextureDescriptor): RGTextureHandle {
        this.assertOpen();
        const handle = this.allocateResourceHandle() as RGTextureHandle;
        this.#storage.acquireTextureNode(
            handle,
            name,
            'transient',
            descriptor,
            null,
            null,
            'transient',
            false
        );
        return handle;
    }

    createTextureView(
        name: string,
        texture: RGTextureHandle,
        descriptor: RGTextureViewDescriptor = {}
    ): RGTextureViewHandle {
        this.assertOpen();
        this.requireResource(texture, 'texture');
        const handle = this.allocateResourceHandle() as RGTextureViewHandle;
        this.#storage.acquireTextureViewNode(handle, name, texture, descriptor);
        return handle;
    }

    createBuffer(name: string, descriptor: RGBufferDescriptor): RGBufferHandle {
        this.assertOpen();
        const handle = this.allocateResourceHandle() as RGBufferHandle;
        this.#storage.acquireBufferNode(
            handle,
            name,
            'transient',
            descriptor,
            null,
            null,
            'transient',
            false
        );
        return handle;
    }

    /** Import once per physical identity; repeated imports share all graph hazards. */
    importTexture(name: string, texture: RHITexture, initiallyInitialized = true): RGTextureHandle {
        this.assertOpen();
        if (typeof initiallyInitialized !== 'boolean') {
            renderGraphFailure(
                'invalid-descriptor',
                'imported texture initialization state must be boolean'
            );
        }
        const existing = this.#storage.importedTextures.get(texture);
        if (existing !== undefined) {
            this.assertImportInitialization(existing, initiallyInitialized);
            if (
                existing.resourceLifetime !== texture.lifetime ||
                !sameImportedTextureDescriptor(existing.descriptor, texture.descriptor)
            ) {
                renderGraphFailure(
                    'invalid-descriptor',
                    'repeated texture imports must agree on descriptor and lifetime',
                    name
                );
            }
            return existing.handle;
        }
        const handle = this.allocateResourceHandle() as RGTextureHandle;
        const resource = this.#storage.acquireTextureNode(
            handle,
            name,
            'imported',
            texture.descriptor,
            texture,
            null,
            texture.lifetime,
            initiallyInitialized
        );
        this.#storage.importedTextures.set(texture, resource);
        return handle;
    }

    /** Import once per physical identity; repeated imports share all graph hazards. */
    importBuffer(name: string, buffer: RHIBuffer, initiallyInitialized = true): RGBufferHandle {
        this.assertOpen();
        if (typeof initiallyInitialized !== 'boolean') {
            renderGraphFailure(
                'invalid-descriptor',
                'imported buffer initialization state must be boolean'
            );
        }
        const existing = this.#storage.importedBuffers.get(buffer);
        if (existing !== undefined) {
            this.assertImportInitialization(existing, initiallyInitialized);
            if (
                existing.resourceLifetime !== buffer.lifetime ||
                existing.descriptor.size !== buffer.descriptor.size ||
                existing.descriptor.usage !== buffer.descriptor.usage ||
                (existing.descriptor.mappedAtCreation ?? false) !==
                    buffer.descriptor.mappedAtCreation
            ) {
                renderGraphFailure(
                    'invalid-descriptor',
                    'repeated buffer imports must agree on descriptor and lifetime',
                    name
                );
            }
            return existing.handle;
        }
        const handle = this.allocateResourceHandle() as RGBufferHandle;
        const resource = this.#storage.acquireBufferNode(
            handle,
            name,
            'imported',
            buffer.descriptor,
            buffer,
            null,
            buffer.lifetime,
            initiallyInitialized
        );
        this.#storage.importedBuffers.set(buffer, resource);
        return handle;
    }

    private assertImportInitialization(
        resource: RGTextureResourceNode | RGBufferResourceNode,
        initiallyInitialized: boolean
    ): void {
        if (resource.initiallyInitialized !== initiallyInitialized) {
            renderGraphFailure(
                'invalid-descriptor',
                'repeated imports must agree on frame-start initialization',
                resource.name
            );
        }
    }

    /**
     * Declares an externally-owned texture without acquiring it during graph construction.
     * `provider` runs only if the compiled graph keeps a pass that uses this resource.
     * Repeated imports of one allocation must share `identity`, even across provider closures.
     */
    importTextureProvider(
        name: string,
        descriptor: RGTextureDescriptor,
        provider: RGImportedTextureProvider,
        lifetime: 'persistent' | 'frame' = 'frame',
        initiallyInitialized = true,
        identity: object = provider
    ): RGTextureHandle {
        this.assertOpen();
        if (typeof initiallyInitialized !== 'boolean') {
            renderGraphFailure(
                'invalid-descriptor',
                'imported texture initialization state must be boolean'
            );
        }
        const existing = this.#storage.importedTextures.get(identity);
        if (existing !== undefined) {
            this.assertImportInitialization(existing, initiallyInitialized);
            if (
                existing.resourceLifetime !== lifetime ||
                !sameImportedTextureDescriptor(existing.descriptor, descriptor)
            ) {
                renderGraphFailure(
                    'invalid-descriptor',
                    'repeated texture imports must agree on descriptor and lifetime',
                    name
                );
            }
            return existing.handle;
        }
        const handle = this.allocateResourceHandle() as RGTextureHandle;
        const resource = this.#storage.acquireTextureNode(
            handle,
            name,
            'imported',
            descriptor,
            null,
            provider,
            lifetime,
            initiallyInitialized
        );
        this.#storage.importedTextures.set(identity, resource);
        return handle;
    }

    /** Buffer counterpart to {@link importTextureProvider}. */
    importBufferProvider(
        name: string,
        descriptor: RGBufferDescriptor,
        provider: RGImportedBufferProvider,
        lifetime: 'persistent' | 'frame' = 'frame',
        initiallyInitialized = true,
        identity: object = provider
    ): RGBufferHandle {
        this.assertOpen();
        if (typeof initiallyInitialized !== 'boolean') {
            renderGraphFailure(
                'invalid-descriptor',
                'imported buffer initialization state must be boolean'
            );
        }
        const existing = this.#storage.importedBuffers.get(identity);
        if (existing !== undefined) {
            this.assertImportInitialization(existing, initiallyInitialized);
            if (
                existing.resourceLifetime !== lifetime ||
                existing.descriptor.size !== descriptor.size ||
                existing.descriptor.usage !== descriptor.usage ||
                (existing.descriptor.mappedAtCreation ?? false) !==
                    (descriptor.mappedAtCreation ?? false)
            ) {
                renderGraphFailure(
                    'invalid-descriptor',
                    'repeated buffer imports must agree on descriptor and lifetime',
                    name
                );
            }
            return existing.handle;
        }
        const handle = this.allocateResourceHandle() as RGBufferHandle;
        const resource = this.#storage.acquireBufferNode(
            handle,
            name,
            'imported',
            descriptor,
            null,
            provider,
            lifetime,
            initiallyInitialized
        );
        this.#storage.importedBuffers.set(identity, resource);
        return handle;
    }

    extractTexture(handle: RGTextureHandle): void {
        const resource = this.requireResource(handle, 'texture');
        if (resource.origin !== 'transient') {
            renderGraphFailure('invalid-handle', 'only transient textures can be extracted');
        }
        (resource as { extracted: boolean }).extracted = true;
        this.#storage.outputs.add(handle);
    }

    extractBuffer(handle: RGBufferHandle): void {
        const resource = this.requireResource(handle, 'buffer');
        if (resource.origin !== 'transient') {
            renderGraphFailure('invalid-handle', 'only transient buffers can be extracted');
        }
        (resource as { extracted: boolean }).extracted = true;
        this.#storage.outputs.add(handle);
    }

    markOutput(handle: RGResourceHandle): void {
        this.requireResource(handle);
        this.#storage.outputs.add(handle);
    }

    /**
     * Make pure reads consume the last writer in this graph when one exists, regardless of pass
     * insertion order. With no graph writer, the imported persistent contents remain readable.
     * Renderer resource bridges use this for public render-target sampling.
     *
     * @internal
     */
    readTextureFromLastGraphWriter(handle: RGTextureHandle): void {
        const resource = this.requireResource(handle, 'texture');
        if (resource.origin !== 'imported' || resource.resourceLifetime !== 'persistent') {
            renderGraphFailure(
                'invalid-handle',
                'last-writer texture reads require a persistent imported texture'
            );
        }
        (resource as { readFromLastGraphWriter: boolean }).readFromLastGraphWriter = true;
    }

    /** @internal Aggregate declaration-derived usage for a transient texture. */
    addTextureUsage(handle: RGTextureHandle, usage: RHITextureUsageFlags): void {
        const resource = this.requireResource(handle, 'texture');
        if (!Number.isSafeInteger(usage) || usage <= 0) {
            renderGraphFailure('invalid-descriptor', 'texture usage must be a positive bit mask');
        }
        const descriptor = resource.descriptor as { usage: RHITextureUsageFlags };
        const missing = usage & ~descriptor.usage;
        if (missing === 0) return;
        if (resource.origin !== 'transient') {
            renderGraphFailure(
                'invalid-descriptor',
                `imported texture ${resource.name} lacks usage ${String(missing)}`
            );
        }
        descriptor.usage |= usage;
    }

    /** @internal Aggregate declaration-derived usage for a transient buffer. */
    addBufferUsage(handle: RGBufferHandle, usage: RHIBufferUsageFlags): void {
        const resource = this.requireResource(handle, 'buffer');
        if (!Number.isSafeInteger(usage) || usage <= 0) {
            renderGraphFailure('invalid-descriptor', 'buffer usage must be a positive bit mask');
        }
        const descriptor = resource.descriptor as { usage: RHIBufferUsageFlags };
        const missing = usage & ~descriptor.usage;
        if (missing === 0) return;
        if (resource.origin !== 'transient') {
            renderGraphFailure(
                'invalid-descriptor',
                `imported buffer ${resource.name} lacks usage ${String(missing)}`
            );
        }
        descriptor.usage |= usage;
    }

    addPass<P>(template: RenderPassTemplate<P>, params: P): RGPassHandle {
        this.assertOpen();
        this.assertOutsideSetup();
        if (template.name.length === 0) {
            renderGraphFailure('invalid-descriptor', 'pass template name must be non-empty');
        }
        const handle = this.allocatePassHandle();
        const pass = this.#storage.acquirePassNode(
            handle,
            this.#storage.passes.length,
            template,
            params
        );
        const passBuilder = new RGPassBuilder(this, pass);
        this.#settingUp = true;
        try {
            assertSynchronousGraphCallback(template.setup(passBuilder, params), 'setup', pass.name);
            this.commitBufferUsages(pass);
        } catch (error) {
            this.#storage.rollbackPass(pass);
            throw error;
        } finally {
            passBuilder.close();
            this.#settingUp = false;
        }
        return handle;
    }

    addDependency(before: RGPassHandle, after: RGPassHandle): void {
        this.assertOpen();
        const dependency = this.requirePass(before);
        const dependent = this.requirePass(after);
        if (dependency === dependent) {
            renderGraphFailure('cycle', 'a pass cannot depend on itself', dependent.name);
        }
        if (!dependent.dependencySet.has(before)) {
            dependent.dependencySet.add(before);
            dependent.explicitDependencies.push(before);
        }
    }

    /** @internal Consume the builder exactly once for compilation. */
    finish(): RenderGraphBuildSnapshot {
        this.assertOpen();
        this.assertOutsideSetup();
        this.#consumed = true;
        return this.#storage.snapshot;
    }

    /** @internal Called only after synchronous compilation no longer references the snapshot. */
    recycleAfterCompile(): void {
        if (!this.#consumed) return;
        this.discard();
    }

    /** @internal Invalidate a completed or abandoned build and release all retained references. */
    discard(): void {
        if (this.#recycled) return;
        this.assertOutsideSetup();
        this.#consumed = true;
        this.#recycled = true;
        this.#storage.recycle();
        this.#releaseStorage?.(this.#storage);
    }

    /** @internal */
    acquireColorAttachment(pass: MutablePassNode, declaration: RGColorAttachmentDeclaration): void {
        this.assertOpen();
        this.#storage.acquireColorAttachment(pass, declaration);
    }

    /** @internal */
    setDepthStencilAttachment(
        pass: MutablePassNode,
        declaration: RGDepthStencilAttachmentDeclaration
    ): void {
        this.assertOpen();
        this.#storage.setDepthStencilAttachment(pass, declaration);
    }

    private commitBufferUsages(pass: MutablePassNode): void {
        for (const access of pass.bufferAccesses) {
            const resource = this.requireResource(access.buffer, 'buffer');
            const usage = bufferUseUsage(access.use);
            const missing = usage & ~resource.descriptor.usage;
            if (missing !== 0 && resource.origin === 'imported') {
                renderGraphFailure(
                    'invalid-descriptor',
                    `imported buffer ${resource.name} lacks usage ${String(missing)}`,
                    pass.name
                );
            }
        }
        for (const access of pass.bufferAccesses) {
            const resource = this.requireResource(access.buffer, 'buffer');
            if (resource.origin === 'transient') {
                const descriptor = resource.descriptor as { usage: RHIBufferUsageFlags };
                descriptor.usage |= bufferUseUsage(access.use);
            }
        }
    }

    /** @internal */
    acquireBufferAccess(
        pass: MutablePassNode,
        buffer: RGBufferHandle,
        mode: RGBufferAccessDeclaration['mode'],
        use: RGBufferReadUse | RGBufferWriteUse
    ): void {
        this.assertOpen();
        this.#storage.acquireBufferAccess(pass, buffer, mode, use);
    }

    /** @internal */
    requireResource(handle: RGResourceHandle, kind: 'texture'): RGTextureResourceNode;
    /** @internal */
    requireResource(handle: RGResourceHandle, kind: 'buffer'): RGBufferResourceNode;
    /** @internal */
    requireResource(handle: RGResourceHandle): RGResourceNode;
    /** @internal */
    requireResource(handle: RGResourceHandle, kind?: 'texture' | 'buffer'): RGResourceNode {
        this.assertOpen();
        const resource = this.#storage.resourceByHandle.get(handle);
        if (!resource || (kind !== undefined && resource.kind !== kind)) {
            renderGraphFailure('invalid-handle', `resource handle ${String(handle)} is invalid`);
        }
        return resource;
    }

    /** @internal */
    requireTextureAccess(
        handle: RGTextureAccessHandle
    ): RGTextureResourceNode | RGTextureViewResourceNode {
        const resource = this.requireResource(handle);
        if (resource.kind !== 'texture' && resource.kind !== 'texture-view') {
            renderGraphFailure(
                'invalid-handle',
                `texture access handle ${String(handle)} is invalid`
            );
        }
        return resource;
    }

    /** @internal */
    requirePass(handle: RGPassHandle): MutablePassNode {
        this.assertOpen();
        const pass = this.#storage.passByHandle.get(handle);
        if (!pass) renderGraphFailure('invalid-handle', `pass handle ${String(handle)} is invalid`);
        return pass;
    }

    private allocateResourceHandle(): RGResourceHandle {
        return allocateGraphHandle() as RGResourceHandle;
    }

    private allocatePassHandle(): RGPassHandle {
        return allocateGraphHandle() as RGPassHandle;
    }

    private assertOpen(): void {
        if (this.#consumed) {
            renderGraphFailure('invalid-state', 'render graph builder has already been consumed');
        }
    }

    private assertOutsideSetup(): void {
        if (this.#settingUp) {
            renderGraphFailure(
                'invalid-state',
                'cannot add, consume or discard a graph during pass setup'
            );
        }
    }
}
