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
    readonly slot: number;
    readonly layout: ResourceRegistryHandle<RHIBindGroupLayout>;
    readonly bindings: readonly Readonly<BindingRecipe>[];
    readonly handle: ResourceRegistryHandle<RHIBindGroup>;
}

function sameBindings(
    left: readonly Readonly<BindingRecipe>[],
    right: readonly Readonly<BindingRecipe>[]
): boolean {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === undefined || b === undefined) return false;
        if (a.kind !== b.kind || a.binding !== b.binding || a.resource !== b.resource) {
            return false;
        }
        if (
            a.kind === 'buffer' &&
            b.kind === 'buffer' &&
            (a.offset !== b.offset || a.size !== b.size)
        ) {
            return false;
        }
    }
    return true;
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
        const bindings = layout === null ? null : this.bindingRecipes(descriptor.entries);
        if (layout === null || bindings === null) {
            this.invalidate(owner, slot);
            this.metrics.recordMiss();
            return null;
        }

        let records = this.#recordsByOwner.get(owner);
        const current = records?.get(slot);
        if (current?.layout === layout && sameBindings(current.bindings, bindings)) {
            this.metrics.recordHit();
            return current.handle;
        }

        const replacement = this.registerGroup(descriptor.label, layout, bindings);
        if (records === undefined) {
            records = new Map();
            this.#recordsByOwner.set(owner, records);
        }
        records.set(slot, {
            slot,
            layout,
            bindings,
            handle: replacement
        });
        if (current === undefined) this.metrics.recordInsertion();
        else {
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
        const active = new Set(activeSlots);
        let removed = 0;
        for (const [slot, record] of records) {
            if (active.has(slot)) continue;
            records.delete(slot);
            this.registry.release(record.handle);
            removed += 1;
        }
        if (records.size === 0) this.#recordsByOwner.delete(owner);
        if (removed > 0) this.metrics.recordRemoval(removed);
    }

    detach(owner: object): boolean {
        this.assertAlive();
        const records = this.#recordsByOwner.get(owner);
        if (records === undefined) return false;
        for (const record of records.values()) this.registry.release(record.handle);
        this.#recordsByOwner.delete(owner);
        this.metrics.recordRemoval(records.size);
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const records of this.#recordsByOwner.values()) {
            for (const record of records.values()) this.registry.release(record.handle);
        }
        this.#recordsByOwner.clear();
        this.metrics.clear();
        this.#destroyed = true;
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
        records.delete(slot);
        this.registry.release(current.handle);
        this.metrics.recordRemoval();
        if (records.size === 0) this.#recordsByOwner.delete(owner);
    }

    private assertAlive(): void {
        if (this.#destroyed) {
            throw new Error('Scriptable bind-group resource cache is destroyed');
        }
    }
}
