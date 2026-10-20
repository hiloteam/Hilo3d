import {
    RHICacheCounter,
    type RHIBindGroup,
    type RHIBindGroupDescriptor,
    type RHIBindGroupEntry,
    type RHIBindGroupLayout,
    type RHIBuffer,
    type RHIDeviceOwnedDestroyable,
    type RHISampler,
    type RHITextureView
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';

interface BufferBindingRecipe {
    readonly kind: 'buffer';
    readonly binding: number;
    readonly resource: ResourceRegistryHandle<RHIBuffer>;
    readonly offset: number | undefined;
    readonly size: number | undefined;
}

interface ObjectBindingRecipe {
    readonly kind: 'object';
    readonly binding: number;
    readonly resource: ResourceRegistryHandle<RHISampler | RHITextureView>;
}

type BindingRecipe = BufferBindingRecipe | ObjectBindingRecipe;

interface BindGroupRecord {
    readonly owner: object;
    readonly slot: number;
    readonly layout: ResourceRegistryHandle<RHIBindGroupLayout>;
    readonly bindings: readonly Readonly<BindingRecipe>[];
    readonly handle: ResourceRegistryHandle<RHIBindGroup>;
}

/**
 * Bounded owner/slot cache for scriptable bind groups whose complete dependency set has
 * recovery-stable registry identities. Graph transient resources deliberately fall back to
 * submission-fenced frame bind groups.
 *
 * @internal
 */
export class ScriptableBindGroupResourceCache {
    readonly metrics = new RHICacheCounter();
    readonly #recordsByOwner = new Map<object, Map<number, BindGroupRecord>>();
    readonly #recordsByDependency = new Map<
        ResourceRegistryHandle<RHIDeviceOwnedDestroyable>,
        Set<BindGroupRecord>
    >();
    #destroyed = false;

    constructor(readonly registry: ResourceRegistry) {}

    prepare(
        owner: object,
        slot: number,
        descriptor: Readonly<RHIBindGroupDescriptor>
    ): ResourceRegistryHandle<RHIBindGroup> | null {
        this.assertAlive();
        if (!Number.isSafeInteger(slot) || slot < 0) {
            throw new RangeError('Scriptable bind-group slot must be a non-negative safe integer');
        }
        const layout = this.registry.findHandle(descriptor.layout);
        if (layout === null) {
            this.invalidate(owner, slot);
            this.metrics.recordMiss();
            return null;
        }

        let records = this.#recordsByOwner.get(owner);
        const current = records?.get(slot);
        if (current?.layout === layout && this.sameBindings(current.bindings, descriptor.entries)) {
            this.metrics.recordHit();
            return current.handle;
        }

        const bindings = this.bindingRecipes(descriptor.entries);
        if (bindings === null) {
            this.invalidate(owner, slot);
            this.metrics.recordMiss();
            return null;
        }
        const replacement = this.registerGroup(descriptor.label, layout, bindings);
        if (records === undefined) {
            records = new Map();
            this.#recordsByOwner.set(owner, records);
        }
        const record: BindGroupRecord = {
            owner,
            slot,
            layout,
            bindings,
            handle: replacement
        };
        records.set(slot, record);
        this.indexDependency(layout, record);
        for (const binding of bindings) this.indexDependency(binding.resource, record);
        if (current === undefined) this.metrics.recordInsertion();
        else {
            this.unindexRecord(current);
            this.registry.release(current.handle);
            this.metrics.recordReplacement();
        }
        this.metrics.recordMiss();
        return replacement;
    }

    prune(owner: object, activeSlots: readonly number[]): void {
        this.assertAlive();
        const records = this.#recordsByOwner.get(owner);
        if (records === undefined) return;
        let removed = 0;
        for (const record of records.values()) {
            if (activeSlots.includes(record.slot)) continue;
            this.removeRecord(record);
            removed += 1;
        }
        if (removed > 0) this.metrics.recordRemoval(removed);
    }

    detach(owner: object): boolean {
        this.assertAlive();
        const records = this.#recordsByOwner.get(owner);
        if (records === undefined) return false;
        const count = records.size;
        for (const record of records.values()) this.removeRecord(record);
        this.metrics.recordRemoval(count);
        return true;
    }

    /**
     * Remove cached groups when a logical dependency is explicitly destroyed or detached.
     * Registry release preserves every group's last submitted frame and its dependency fence.
     * Valid runtime resources remain cached even while their owners are not recorded.
     */
    invalidateResource(handle: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>): number {
        this.assertAlive();
        const records = this.#recordsByDependency.get(handle);
        if (records === undefined) return 0;
        const count = records.size;
        for (const record of records) this.removeRecord(record);
        this.metrics.recordRemoval(count);
        return count;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const records of this.#recordsByOwner.values()) {
            for (const record of records.values()) this.registry.release(record.handle);
        }
        this.#recordsByOwner.clear();
        this.#recordsByDependency.clear();
        this.metrics.clear();
        this.#destroyed = true;
    }

    private sameBindings(
        bindings: readonly Readonly<BindingRecipe>[],
        entries: readonly RHIBindGroupEntry[]
    ): boolean {
        if (bindings.length !== entries.length) return false;
        for (let index = 0; index < bindings.length; index += 1) {
            const binding = bindings[index];
            const entry = entries[index];
            if (binding === undefined || entry === undefined) return false;
            if (binding.binding !== entry.binding) return false;
            const resource = entry.resource;
            if ('buffer' in resource) {
                if (
                    binding.kind !== 'buffer' ||
                    binding.offset !== resource.offset ||
                    binding.size !== resource.size ||
                    binding.resource !== this.registry.findHandle(resource.buffer)
                ) {
                    return false;
                }
            } else if (
                binding.kind !== 'object' ||
                binding.resource !== this.registry.findHandle(resource)
            ) {
                return false;
            }
        }
        return true;
    }

    private bindingRecipes(
        entries: readonly RHIBindGroupEntry[]
    ): readonly Readonly<BindingRecipe>[] | null {
        const recipes: BindingRecipe[] = [];
        for (const entry of entries) {
            if ('buffer' in entry.resource) {
                const handle = this.registry.findHandle(entry.resource.buffer);
                if (handle === null) return null;
                recipes.push(
                    Object.freeze({
                        kind: 'buffer' as const,
                        binding: entry.binding,
                        resource: handle,
                        offset: entry.resource.offset,
                        size: entry.resource.size
                    })
                );
            } else {
                const handle = this.registry.findHandle(entry.resource);
                if (handle === null) return null;
                recipes.push(
                    Object.freeze({
                        kind: 'object' as const,
                        binding: entry.binding,
                        resource: handle
                    })
                );
            }
        }
        return Object.freeze(recipes);
    }

    private registerGroup(
        sourceLabel: string | undefined,
        layout: ResourceRegistryHandle<RHIBindGroupLayout>,
        bindings: readonly Readonly<BindingRecipe>[]
    ): ResourceRegistryHandle<RHIBindGroup> {
        const label = sourceLabel ? `${sourceLabel} (stable)` : 'Stable scriptable bind group';
        const dependencies: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>[] = [layout];
        for (const binding of bindings) dependencies.push(binding.resource);
        return this.registry.register<RHIBindGroup>({
            label,
            dependencies,
            create(device, resolve) {
                const entries: RHIBindGroupEntry[] = bindings.map(binding => {
                    if (binding.kind === 'buffer') {
                        return {
                            binding: binding.binding,
                            resource: {
                                buffer: resolve(binding.resource),
                                ...(binding.offset === undefined ? {} : { offset: binding.offset }),
                                ...(binding.size === undefined ? {} : { size: binding.size })
                            }
                        };
                    }
                    return {
                        binding: binding.binding,
                        resource: resolve(binding.resource)
                    };
                });
                return device.createBindGroup({
                    label,
                    lifetime: 'persistent',
                    layout: resolve(layout),
                    entries
                });
            }
        });
    }

    private invalidate(owner: object, slot: number): void {
        const records = this.#recordsByOwner.get(owner);
        const current = records?.get(slot);
        if (records === undefined || current === undefined) return;
        this.removeRecord(current);
        this.metrics.recordRemoval();
    }

    private indexDependency(
        dependency: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>,
        record: BindGroupRecord
    ): void {
        let records = this.#recordsByDependency.get(dependency);
        if (records === undefined) {
            records = new Set();
            this.#recordsByDependency.set(dependency, records);
        }
        records.add(record);
    }

    private unindexRecord(record: BindGroupRecord): void {
        this.unindexDependency(record.layout, record);
        for (const binding of record.bindings) this.unindexDependency(binding.resource, record);
    }

    private unindexDependency(
        dependency: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>,
        record: BindGroupRecord
    ): void {
        const records = this.#recordsByDependency.get(dependency);
        if (records === undefined) return;
        records.delete(record);
        if (records.size === 0) this.#recordsByDependency.delete(dependency);
    }

    private removeRecord(record: BindGroupRecord): void {
        const records = this.#recordsByOwner.get(record.owner);
        records?.delete(record.slot);
        if (records?.size === 0) this.#recordsByOwner.delete(record.owner);
        this.unindexRecord(record);
        this.registry.release(record.handle);
    }

    private assertAlive(): void {
        if (this.#destroyed) {
            throw new Error('Scriptable bind-group resource cache is destroyed');
        }
    }
}
