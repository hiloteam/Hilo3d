import type { RHIBuffer, RHITexture } from '../rhi/core';
import type { RGPassContext, RGPrepareContext } from './RenderGraphExecutor';
import type {
    RGBufferDescriptor,
    RGBufferHandle,
    RGColorAttachmentDeclaration,
    RGDepthStencilAttachmentDeclaration,
    RGImportedBufferProvider,
    RGImportedTextureProvider,
    RGBufferResourceNode,
    RGPassHandle,
    RGResourceHandle,
    RGResourceNode,
    RGTextureDescriptor,
    RGTextureHandle,
    RGTextureResourceNode
} from './RenderGraphResource';
import { renderGraphFailure } from './RenderGraphValidation';

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
    setup(builder: RGPassBuilder, params: P): void;
    prepare?(context: RGPrepareContext, params: P): void;
    execute(context: RGPassContext, params: P): void;
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
    viewFormats?: RGTextureDescriptor['viewFormats'];
    readonly viewFormatStorage: NonNullable<RGTextureDescriptor['viewFormats']>[number][];
};
type MutableBufferDescriptor = {
    -readonly [Key in keyof RGBufferDescriptor]: RGBufferDescriptor[Key];
};
type MutableTextureResourceNode = Omit<
    { -readonly [Key in keyof RGTextureResourceNode]: RGTextureResourceNode[Key] },
    'descriptor'
> & { descriptor: MutableTextureDescriptor };
type MutableBufferResourceNode = Omit<
    { -readonly [Key in keyof RGBufferResourceNode]: RGBufferResourceNode[Key] },
    'descriptor'
> & { descriptor: MutableBufferDescriptor };
type MutableResourceNode = MutableTextureResourceNode | MutableBufferResourceNode;
type MutableDepthStencilAttachmentDeclaration = {
    -readonly [
        Key in keyof RGDepthStencilAttachmentDeclaration
    ]: RGDepthStencilAttachmentDeclaration[Key];
};

interface MutableColorAttachmentDeclaration extends RGColorAttachmentDeclaration {
    texture: RGTextureHandle;
    resolveTarget?: RGTextureHandle;
    clearValue?: { r: number; g: number; b: number; a: number };
    loadOp: RGColorAttachmentDeclaration['loadOp'];
    storeOp: RGColorAttachmentDeclaration['storeOp'];
    readonly clearValueStorage: { r: number; g: number; b: number; a: number };
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
    readonly passes: MutablePassNode[] = [];
    readonly passByHandle = new Map<RGPassHandle, MutablePassNode>();
    readonly outputs = new Set<RGResourceHandle>();
    readonly snapshot: MutableRenderGraphBuildSnapshot = {
        generation: 0,
        resources: this.resources as RGResourceNode[],
        passes: this.passes,
        outputs: this.outputs
    };
    readonly diagnostics: MutableBuilderStorageDiagnostics = {
        resourceNodeCapacity: 0,
        passNodeCapacity: 0,
        colorAttachmentCapacity: 0,
        growthCount: 0
    };

    readonly #textureNodePool: MutableTextureResourceNode[] = [];
    readonly #bufferNodePool: MutableBufferResourceNode[] = [];
    readonly #passNodePool: MutablePassNode[] = [];
    #textureNodeCursor = 0;
    #bufferNodeCursor = 0;
    #passNodeCursor = 0;
    #leased = false;

    begin(): void {
        if (this.#leased) throw new Error('Render graph builder storage is already leased');
        this.#leased = true;
        this.#textureNodeCursor = 0;
        this.#bufferNodeCursor = 0;
        this.#passNodeCursor = 0;
        this.resources.length = 0;
        this.resourceByHandle.clear();
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
        resourceLifetime: RGTextureResourceNode['resourceLifetime']
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
        resourceLifetime: RGBufferResourceNode['resourceLifetime']
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
            node.extracted = false;
        }
        this.#bufferNodeCursor++;
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
                attachmentSet: new Set(),
                colorAttachments: [],
                colorAttachmentPool: [],
                depthStencilAttachment: null,
                depthStencilStorage: { texture: 0 as RGTextureHandle },
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
            resource.imported = null;
            resource.provider = null;
        }
        this.resources.length = 0;
        this.resourceByHandle.clear();
        this.passes.length = 0;
        this.passByHandle.clear();
        this.outputs.clear();
        this.#leased = false;
    }

    private recordResourceGrowth(): void {
        this.diagnostics.resourceNodeCapacity =
            this.#textureNodePool.length + this.#bufferNodePool.length;
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
    /** @internal */
    constructor(
        private readonly graph: RenderGraphBuilder,
        private readonly pass: MutablePassNode
    ) {}

    readTexture(handle: RGTextureHandle): RGTextureHandle {
        this.graph.requireResource(handle, 'texture');
        this.addRead(handle);
        return handle;
    }

    writeTexture(handle: RGTextureHandle): RGTextureHandle {
        this.graph.requireResource(handle, 'texture');
        this.addWrite(handle);
        return handle;
    }

    readBuffer(handle: RGBufferHandle): RGBufferHandle {
        this.graph.requireResource(handle, 'buffer');
        this.addRead(handle);
        return handle;
    }

    writeBuffer(handle: RGBufferHandle): RGBufferHandle {
        this.graph.requireResource(handle, 'buffer');
        this.addWrite(handle);
        return handle;
    }

    useColorAttachment(declaration: RGColorAttachmentDeclaration): void {
        this.graph.requireResource(declaration.texture, 'texture');
        this.addAttachment(declaration.texture);
        if (declaration.resolveTarget !== undefined) {
            this.graph.requireResource(declaration.resolveTarget, 'texture');
            this.addAttachment(declaration.resolveTarget);
        }
        this.graph.acquireColorAttachment(this.pass, declaration);
    }

    useDepthStencilAttachment(declaration: RGDepthStencilAttachmentDeclaration): void {
        if (this.pass.depthStencilAttachment !== null) {
            renderGraphFailure(
                'duplicate-access',
                'a pass can declare only one depth/stencil attachment',
                this.pass.name
            );
        }
        this.graph.requireResource(declaration.texture, 'texture');
        this.addAttachment(declaration.texture);
        this.graph.setDepthStencilAttachment(this.pass, declaration);
    }

    dependsOn(handle: RGPassHandle): void {
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
            'transient'
        );
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
            'transient'
        );
        return handle;
    }

    importTexture(name: string, texture: RHITexture): RGTextureHandle {
        this.assertOpen();
        const handle = this.allocateResourceHandle() as RGTextureHandle;
        this.#storage.acquireTextureNode(
            handle,
            name,
            'imported',
            texture.descriptor,
            texture,
            null,
            texture.lifetime
        );
        return handle;
    }

    importBuffer(name: string, buffer: RHIBuffer): RGBufferHandle {
        this.assertOpen();
        const handle = this.allocateResourceHandle() as RGBufferHandle;
        this.#storage.acquireBufferNode(
            handle,
            name,
            'imported',
            buffer.descriptor,
            buffer,
            null,
            buffer.lifetime
        );
        return handle;
    }

    /**
     * Declares an externally-owned texture without acquiring it during graph construction.
     * `provider` runs only if the compiled graph keeps a pass that uses this resource.
     */
    importTextureProvider(
        name: string,
        descriptor: RGTextureDescriptor,
        provider: RGImportedTextureProvider,
        lifetime: 'persistent' | 'frame' = 'frame'
    ): RGTextureHandle {
        this.assertOpen();
        const handle = this.allocateResourceHandle() as RGTextureHandle;
        this.#storage.acquireTextureNode(
            handle,
            name,
            'imported',
            descriptor,
            null,
            provider,
            lifetime
        );
        return handle;
    }

    /** Buffer counterpart to {@link importTextureProvider}. */
    importBufferProvider(
        name: string,
        descriptor: RGBufferDescriptor,
        provider: RGImportedBufferProvider,
        lifetime: 'persistent' | 'frame' = 'frame'
    ): RGBufferHandle {
        this.assertOpen();
        const handle = this.allocateResourceHandle() as RGBufferHandle;
        this.#storage.acquireBufferNode(
            handle,
            name,
            'imported',
            descriptor,
            null,
            provider,
            lifetime
        );
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

    addPass<P>(template: RenderPassTemplate<P>, params: P): RGPassHandle {
        this.assertOpen();
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
        try {
            template.setup(new RGPassBuilder(this, pass), params);
        } catch (error) {
            this.#storage.rollbackPass(pass);
            throw error;
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
        this.#consumed = true;
        return this.#storage.snapshot;
    }

    /** @internal Called only after synchronous compilation no longer references the snapshot. */
    recycleAfterCompile(): void {
        if (!this.#consumed || this.#recycled || this.#releaseStorage === null) return;
        this.#recycled = true;
        this.#storage.recycle();
        this.#releaseStorage(this.#storage);
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

    /** @internal */
    requireResource(handle: RGResourceHandle, kind?: 'texture' | 'buffer'): RGResourceNode {
        this.assertOpen();
        const resource = this.#storage.resourceByHandle.get(handle);
        if (!resource || (kind !== undefined && resource.kind !== kind)) {
            renderGraphFailure('invalid-handle', `resource handle ${String(handle)} is invalid`);
        }
        return resource as RGResourceNode;
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
}
