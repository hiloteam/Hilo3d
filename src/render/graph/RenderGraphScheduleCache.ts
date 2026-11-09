import type { RHICapabilities, RHIDevice } from '../rhi/core';
import type { RenderGraphBuildSnapshot } from './RenderGraphBuilder';
import {
    CompiledRenderGraph,
    type CompiledRGResource,
    type CompiledRGPass
} from './RenderGraphCompiler';
import type {
    RGResourceHandle,
    RGPassHandle,
    RGBufferHandle,
    RGBufferAccessDeclaration
} from './RenderGraphResource';

type Scalar = string | number | boolean | undefined;

interface ResourcePlan {
    readonly sourceIndex: number;
    /** Only immutable descriptors/content/lifetimes; imported objects/providers are always null. */
    readonly value: CompiledRGResource;
}
interface PassPlan {
    readonly sourceIndex: number;
    readonly reads: readonly number[];
    readonly writes: readonly number[];
    readonly accesses: readonly {
        readonly sourceIndex: number;
        readonly value: RGBufferAccessDeclaration;
    }[];
}
interface SchedulePlan {
    readonly key: readonly Scalar[];
    readonly capabilities: RHICapabilities;
    readonly deviceId: number | null;
    readonly deviceGeneration: number | null;
    readonly resources: readonly ResourcePlan[];
    readonly passes: readonly PassPlan[];
    readonly transientPlan: CompiledRenderGraph['transientPlan'];
}

/** Structural plans only. Frame closures, resources, callback leases and parameters never enter the cache. */
export class RenderGraphScheduleCache {
    readonly #entries: SchedulePlan[] = [];
    #pending = new WeakMap<CompiledRenderGraph, SchedulePlan>();
    readonly #key: Scalar[] = [];
    readonly #handles = new Map<RGResourceHandle | RGPassHandle, number>();
    #device: RHIDevice | null = null;
    #deviceId: number | null = null;
    #generation: number | null = null;
    #capabilities: RHICapabilities | null = null;

    /** Bounded retention also covers alternating history/topology patterns. */
    static readonly capacity = 4;
    static readonly maxNodes = 2048;
    static readonly maxKeyScalars = 65536;

    get size(): number {
        return this.#entries.length;
    }

    begin(
        snapshot: RenderGraphBuildSnapshot,
        capabilities: RHICapabilities,
        device?: RHIDevice
    ): CompiledRenderGraph | null {
        this.#device = device ?? this.#device;
        const deviceId = this.#device?.id ?? null;
        const generation = this.#device?.generation ?? null;
        if (
            this.#capabilities !== capabilities ||
            this.#deviceId !== deviceId ||
            this.#generation !== generation
        ) {
            this.#entries.length = 0;
            this.#pending = new WeakMap();
        }
        this.#capabilities = capabilities;
        this.#deviceId = deviceId;
        this.#generation = generation;
        this.#key.length = 0;
        this.#handles.clear();
        if (snapshot.resources.length + snapshot.passes.length > RenderGraphScheduleCache.maxNodes)
            return null;
        this.captureKey(snapshot);
        if (this.#key.length > RenderGraphScheduleCache.maxKeyScalars) {
            this.#key.length = 0;
            return null;
        }
        for (const entry of this.#entries) {
            if (entry.key.length !== this.#key.length) continue;
            let matches = true;
            for (let index = 0; index < this.#key.length; index++) {
                if (entry.key[index] !== this.#key[index]) {
                    matches = false;
                    break;
                }
            }
            if (!matches) continue;
            const graph = this.rebind(entry, snapshot);
            this.#pending.set(graph, entry);
            return graph;
        }
        return null;
    }

    stage(graph: CompiledRenderGraph, snapshot: RenderGraphBuildSnapshot): void {
        if (this.#key.length === 0 || this.#capabilities === null) return;
        const resourceIndex = (handle: RGResourceHandle): number => this.requireIndex(handle);
        const resources = graph.resources.map(value => ({
            sourceIndex: resourceIndex(value.handle),
            value:
                value.kind === 'texture-view'
                    ? value
                    : Object.freeze({ ...value, imported: null, provider: null })
        }));
        const passes = graph.passes.map(pass => ({
            sourceIndex: pass.sourceIndex,
            reads: [...pass.reads].map(resourceIndex),
            writes: [...pass.writes].map(resourceIndex),
            accesses: pass.bufferAccesses.map(value => ({
                sourceIndex: resourceIndex(value.buffer),
                value
            }))
        }));
        // Snapshot has already been validated in full. No borrowed snapshot arrays are retained.
        if (snapshot.generation !== graph.generation)
            throw new Error('Cannot stage another graph generation');
        this.#pending.set(graph, {
            key: this.#key.slice(),
            capabilities: this.#capabilities,
            deviceId: this.#deviceId,
            deviceGeneration: this.#generation,
            resources,
            passes,
            transientPlan: graph.transientPlan
        });
    }

    commit(graph: CompiledRenderGraph, device: RHIDevice): void {
        const entry = this.#pending.get(graph);
        this.#pending.delete(graph);
        if (entry === undefined) return;
        if (
            entry.capabilities !== device.capabilities ||
            (entry.deviceId !== null &&
                (entry.deviceId !== device.id || entry.deviceGeneration !== device.generation))
        )
            return;
        // A standalone compiler may not know its device until the first successful submission.
        if (this.#deviceId !== device.id || this.#generation !== device.generation)
            this.#entries.length = 0;
        this.#device = device;
        this.#deviceId = device.id;
        this.#generation = device.generation;
        this.#capabilities = device.capabilities;
        const previous = this.#entries.indexOf(entry);
        if (previous >= 0) this.#entries.splice(previous, 1);
        this.#entries.unshift(
            entry.deviceId === null
                ? { ...entry, deviceId: device.id, deviceGeneration: device.generation }
                : entry
        );
        if (this.#entries.length > RenderGraphScheduleCache.capacity) this.#entries.pop();
    }

    destroy(): void {
        this.#entries.length = 0;
        this.#pending = new WeakMap();
        this.#key.length = 0;
        this.#handles.clear();
        this.#device = null;
        this.#capabilities = null;
    }

    private requireIndex(handle: RGResourceHandle | RGPassHandle): number {
        const index = this.#handles.get(handle);
        if (index === undefined) throw new Error('Validated graph lost a handle index');
        return index;
    }

    private handle(handle: RGResourceHandle | RGPassHandle | undefined): void {
        const index = handle === undefined ? undefined : this.#handles.get(handle);
        // Unknown handles cannot collide with valid/absent references, even for direct compiler inputs.
        this.#key.push(index, index === undefined ? handle : undefined);
    }

    private handles(handles: Iterable<RGResourceHandle | RGPassHandle>, length: number): void {
        this.#key.push(length);
        for (const handle of handles) this.handle(handle);
    }

    private captureKey(snapshot: RenderGraphBuildSnapshot): void {
        const key = this.#key;
        snapshot.resources.forEach((resource, index) => this.#handles.set(resource.handle, index));
        snapshot.passes.forEach((pass, index) =>
            this.#handles.set(pass.handle, snapshot.resources.length + index)
        );
        key.push(snapshot.resources.length, snapshot.passes.length);
        for (const resource of snapshot.resources) {
            key.push(resource.kind, resource.name, resource.extracted);
            if (resource.kind === 'texture-view') {
                this.handle(resource.texture);
                const d = resource.descriptor;
                key.push(
                    d.label,
                    d.format,
                    d.dimension,
                    d.aspect,
                    d.baseMipLevel,
                    d.mipLevelCount,
                    d.baseArrayLayer,
                    d.arrayLayerCount
                );
            } else {
                key.push(resource.origin, resource.resourceLifetime, resource.initiallyInitialized);
                key.push(resource.descriptor.label, resource.descriptor.usage);
                if (resource.kind === 'buffer') {
                    key.push(resource.descriptor.size, resource.descriptor.mappedAtCreation);
                } else {
                    const d = resource.descriptor;
                    key.push(
                        resource.readFromLastGraphWriter,
                        d.size.width,
                        d.size.height,
                        d.size.depthOrArrayLayers,
                        d.mipLevelCount,
                        d.sampleCount,
                        d.dimension,
                        d.viewDimension,
                        d.format,
                        d.viewFormats?.length
                    );
                    for (const format of d.viewFormats ?? []) key.push(format);
                }
            }
        }
        for (const pass of snapshot.passes) {
            if (key.length > RenderGraphScheduleCache.maxKeyScalars) return;
            key.push(pass.index, pass.name, pass.sideEffect);
            this.handles(pass.reads, pass.reads.length);
            this.handles(pass.writes, pass.writes.length);
            this.handles(pass.readWriteBuffers, pass.readWriteBuffers.length);
            this.handles(pass.explicitDependencies, pass.explicitDependencies.length);
            key.push(pass.bufferAccesses.length);
            for (const access of pass.bufferAccesses) {
                this.handle(access.buffer);
                key.push(access.mode, access.use);
            }
            key.push(pass.colorAttachments.length);
            for (const attachment of pass.colorAttachments) {
                this.handle(attachment.texture);
                this.handle(attachment.resolveTarget);
                key.push(
                    attachment.loadOp,
                    attachment.storeOp,
                    attachment.clearValue?.r,
                    attachment.clearValue?.g,
                    attachment.clearValue?.b,
                    attachment.clearValue?.a
                );
            }
            const d = pass.depthStencilAttachment;
            key.push(d !== null);
            if (d !== null) {
                this.handle(d.texture);
                key.push(
                    d.depthClearValue,
                    d.depthLoadOp,
                    d.depthStoreOp,
                    d.depthReadOnly,
                    d.stencilClearValue,
                    d.stencilLoadOp,
                    d.stencilStoreOp,
                    d.stencilReadOnly
                );
            }
        }
        this.handles(snapshot.outputs, snapshot.outputs.size);
    }

    private rebind(plan: SchedulePlan, snapshot: RenderGraphBuildSnapshot): CompiledRenderGraph {
        const handleAt = (index: number): RGResourceHandle => {
            const node = snapshot.resources[index];
            if (!node) throw new Error('Cached graph resource is missing');
            return node.handle;
        };
        const resources = plan.resources.map(({ sourceIndex, value }): CompiledRGResource => {
            const node = snapshot.resources[sourceIndex];
            if (node?.kind !== value.kind) throw new Error('Cached graph resource kind changed');
            if (node.kind === 'texture-view' && value.kind === 'texture-view')
                return Object.freeze({
                    ...value,
                    handle: node.handle,
                    name: node.name,
                    texture: node.texture
                });
            if (node.kind === 'texture' && value.kind === 'texture')
                return Object.freeze({
                    ...value,
                    handle: node.handle,
                    name: node.name,
                    imported: node.imported,
                    provider: node.provider
                });
            if (node.kind === 'buffer' && value.kind === 'buffer')
                return Object.freeze({
                    ...value,
                    handle: node.handle,
                    name: node.name,
                    imported: node.imported,
                    provider: node.provider
                });
            throw new Error('Cached graph resource kind changed');
        });
        const passes = plan.passes.map((value, order): CompiledRGPass => {
            const node = snapshot.passes[value.sourceIndex];
            if (!node) throw new Error('Cached graph pass is missing');
            return Object.freeze({
                handle: node.handle,
                sourceIndex: node.index,
                order,
                name: node.name,
                template: node.template,
                params: node.params,
                reads: new Set(value.reads.map(handleAt)),
                writes: new Set(value.writes.map(handleAt)),
                bufferAccesses: Object.freeze(
                    value.accesses.map(({ sourceIndex, value: access }) =>
                        Object.freeze({
                            ...access,
                            buffer: handleAt(sourceIndex) as RGBufferHandle
                        })
                    )
                )
            });
        });
        return new CompiledRenderGraph(
            snapshot.generation,
            resources,
            passes,
            plan.transientPlan,
            true
        );
    }
}
