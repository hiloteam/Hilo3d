import {
    RHICacheCounter,
    type RHIBindGroup,
    type RHIBindGroupEntry,
    type RHIBindGroupLayout,
    type RHIBuffer,
    type RHIDeviceOwnedDestroyable,
    type RHISampler,
    type RHITextureView
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';
import type {
    ShaderBindingLayoutPlan,
    ShaderSampledBindingPlan,
    ShaderUniformBlockBindingPlan
} from './ShaderBindingLayoutCompiler';

const EMPTY_DEFERRED_GROUPS: readonly number[] = Object.freeze([]);

export interface ShaderSampledBindingResources {
    readonly textureView: ResourceRegistryHandle<RHITextureView>;
    readonly sampler: ResourceRegistryHandle<RHISampler>;
}

export interface ShaderBindGroupHandleSet {
    readonly token: number;
    readonly layoutToken: number;
    readonly groupHandles: readonly (ResourceRegistryHandle<RHIBindGroup> | null)[];
    readonly activeGroupIndices: readonly number[];
}

interface ShaderBindGroupRecord {
    readonly layoutToken: number;
    readonly layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[];
    readonly sampledResources: readonly Readonly<ShaderSampledBindingResources>[];
    readonly deferredGroupIndices: readonly number[];
    readonly handles: Readonly<ShaderBindGroupHandleSet>;
}

interface BufferBindingRecipe {
    readonly kind: 'buffer';
    readonly binding: number;
    readonly buffer: ResourceRegistryHandle<RHIBuffer>;
}

interface TextureBindingRecipe {
    readonly kind: 'texture-view';
    readonly binding: number;
    readonly textureView: ResourceRegistryHandle<RHITextureView>;
}

interface SamplerBindingRecipe {
    readonly kind: 'sampler';
    readonly binding: number;
    readonly sampler: ResourceRegistryHandle<RHISampler>;
}

type BindingRecipe = BufferBindingRecipe | TextureBindingRecipe | SamplerBindingRecipe;
type BindingPlanKind =
    | 'uniform-buffer'
    | 'read-only-storage-buffer'
    | 'sampled-texture'
    | 'sampler'
    | 'comparison-sampler';

function requireNonNegativeSafeInteger(value: number, name: string): void {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}

function sameHandleIdentities<T extends RHIDeviceOwnedDestroyable>(
    cached: readonly ResourceRegistryHandle<T>[],
    incoming: readonly ResourceRegistryHandle<T>[]
): boolean {
    if (cached.length !== incoming.length) return false;
    for (let index = 0; index < cached.length; index += 1) {
        if (cached[index] !== incoming[index]) return false;
    }
    return true;
}

function sameSampledHandleIdentities(
    cached: readonly Readonly<ShaderSampledBindingResources>[],
    incoming: readonly Readonly<ShaderSampledBindingResources>[]
): boolean {
    if (cached.length !== incoming.length) return false;
    for (let index = 0; index < cached.length; index += 1) {
        const cachedResource = cached[index];
        const incomingResource = incoming[index];
        if (cachedResource === undefined) return false;
        if (incomingResource === undefined) return false;
        if (
            cachedResource.textureView !== incomingResource.textureView ||
            cachedResource.sampler !== incomingResource.sampler
        ) {
            return false;
        }
    }
    return true;
}

function sameNumbers(cached: readonly number[], incoming: readonly number[]): boolean {
    if (cached.length !== incoming.length) return false;
    for (let index = 0; index < cached.length; index += 1) {
        if (cached[index] !== incoming[index]) return false;
    }
    return true;
}

function compareBindingRecipes(left: BindingRecipe, right: BindingRecipe): number {
    return left.binding - right.binding;
}

/**
 * Recoverable shader bind groups keyed by owner and exact upstream logical identities.
 * Recipes retain only registry handles and portable binding metadata, so registry recovery can
 * rebuild uniform-only, sampled-only, and mixed groups without leaking native resources here.
 */
export class ShaderBindGroupResourceCache {
    /** Exact owner + layout + bound-resource identity lookup outcomes. */
    readonly metrics = new RHICacheCounter();
    #recordsByOwner = new WeakMap<object, ShaderBindGroupRecord>();
    readonly #records = new Set<ShaderBindGroupRecord>();
    #nextToken = 1;
    #destroyed = false;

    constructor(readonly registry: ResourceRegistry) {}

    prepare(
        owner: object,
        layoutToken: number,
        plan: Readonly<ShaderBindingLayoutPlan>,
        layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[],
        sampledResources: readonly Readonly<ShaderSampledBindingResources>[],
        deferredGroupIndices: readonly number[] = EMPTY_DEFERRED_GROUPS
    ): Readonly<ShaderBindGroupHandleSet> {
        this.assertAlive();
        requireNonNegativeSafeInteger(layoutToken, 'Shader bind-group layout token');

        const current = this.#recordsByOwner.get(owner);
        if (
            current?.layoutToken === layoutToken &&
            sameHandleIdentities(current.layoutHandles, layoutHandles) &&
            sameHandleIdentities(current.uniformBufferHandles, uniformBufferHandles) &&
            sameSampledHandleIdentities(current.sampledResources, sampledResources) &&
            sameNumbers(current.deferredGroupIndices, deferredGroupIndices)
        ) {
            this.metrics.recordHit();
            return current.handles;
        }

        this.validateShape(
            plan,
            layoutHandles,
            uniformBufferHandles,
            sampledResources,
            deferredGroupIndices
        );
        this.validateHandles(layoutHandles, uniformBufferHandles, sampledResources);
        const replacement = this.createRecord(
            layoutToken,
            plan,
            layoutHandles,
            uniformBufferHandles,
            sampledResources,
            deferredGroupIndices
        );
        this.#recordsByOwner.set(owner, replacement);
        this.#records.add(replacement);
        if (current !== undefined) {
            this.#records.delete(current);
            this.releaseRecord(current);
            this.metrics.recordReplacement();
        } else {
            this.metrics.recordInsertion();
        }
        this.metrics.recordMiss();
        return replacement.handles;
    }

    resolveGroup(owner: object, groupIndex: number): RHIBindGroup | null {
        this.assertAlive();
        requireNonNegativeSafeInteger(groupIndex, 'Shader bind-group index');
        const record = this.requireRecord(owner);
        if (groupIndex >= record.handles.groupHandles.length) {
            throw new RangeError('Shader bind-group index is outside the prepared group range');
        }
        const handle = record.handles.groupHandles[groupIndex];
        return handle === null || handle === undefined ? null : this.registry.resolve(handle);
    }

    markUsed(owner: object, frameIndex: number): void {
        this.assertAlive();
        requireNonNegativeSafeInteger(frameIndex, 'Shader bind-group frame index');
        const record = this.requireRecord(owner);
        for (const handle of record.handles.groupHandles) {
            if (handle !== null) this.registry.markUsed(handle, frameIndex);
        }
    }

    detach(owner: object): boolean {
        this.assertAlive();
        const record = this.#recordsByOwner.get(owner);
        if (record === undefined) return false;
        this.#recordsByOwner.delete(owner);
        this.#records.delete(record);
        this.releaseRecord(record);
        this.metrics.recordRemoval();
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const record of this.#records) this.releaseRecord(record);
        this.#records.clear();
        this.#recordsByOwner = new WeakMap();
        this.metrics.clear();
        this.#destroyed = true;
    }

    private validateShape(
        plan: Readonly<ShaderBindingLayoutPlan>,
        layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[],
        sampledResources: readonly Readonly<ShaderSampledBindingResources>[],
        deferredGroupIndices: readonly number[]
    ): void {
        const descriptors = plan.bindGroupLayoutDescriptors;
        const activeGroupIndices = plan.activeGroupIndices;
        const uniformBlocks = plan.uniformBlocks;
        const sampledBindings = plan.sampledBindings;
        const storageBuffers = plan.storageBuffers;
        if (layoutHandles.length !== descriptors.length) {
            throw new RangeError(
                'Shader bind-group layout handles must match the continuous shader group layout count'
            );
        }
        if (uniformBufferHandles.length !== uniformBlocks.length) {
            throw new RangeError(
                'Uniform buffer handles must match ShaderBindingLayoutPlan.uniformBlocks order and count'
            );
        }
        if (sampledResources.length !== sampledBindings.length) {
            throw new RangeError(
                'Sampled resources must match ShaderBindingLayoutPlan.sampledBindings order and count'
            );
        }

        const activeGroups = new Set<number>();
        let previousGroup = -1;
        for (const group of activeGroupIndices) {
            requireNonNegativeSafeInteger(group, 'Active shader bind-group index');
            if (group >= layoutHandles.length) {
                throw new RangeError('Active shader bind-group index exceeds the layout range');
            }
            if (group <= previousGroup) {
                throw new TypeError(
                    'Active shader bind-group indices must be unique and ascending'
                );
            }
            activeGroups.add(group);
            previousGroup = group;
        }

        const bindingsByGroup = new Map<number, Map<number, BindingPlanKind>>();
        for (const block of uniformBlocks) {
            this.addPlanBinding(
                activeGroups,
                bindingsByGroup,
                block.group,
                block.binding,
                'uniform-buffer',
                `Uniform block ${block.name}`
            );
        }
        for (const sampled of sampledBindings) {
            this.validateSampledBinding(activeGroups, bindingsByGroup, sampled);
        }
        for (const storage of storageBuffers) {
            this.addPlanBinding(
                activeGroups,
                bindingsByGroup,
                storage.group,
                storage.binding,
                'read-only-storage-buffer',
                `Readonly storage buffer ${storage.name}`
            );
        }
        for (const group of activeGroups) {
            if (!bindingsByGroup.has(group)) {
                throw new TypeError(`Active shader bind group ${String(group)} has no bindings`);
            }
        }
        this.validateDeferredGroups(deferredGroupIndices, activeGroups, bindingsByGroup);
        this.validateDescriptors(descriptors, activeGroups, bindingsByGroup);
    }

    private validateDeferredGroups(
        deferredGroupIndices: readonly number[],
        activeGroups: ReadonlySet<number>,
        bindingsByGroup: ReadonlyMap<number, ReadonlyMap<number, BindingPlanKind>>
    ): void {
        const deferred = new Set<number>();
        let previous = -1;
        for (const group of deferredGroupIndices) {
            requireNonNegativeSafeInteger(group, 'Deferred shader bind-group index');
            if (group <= previous) {
                throw new TypeError(
                    'Deferred shader bind-group indices must be unique and ascending'
                );
            }
            if (!activeGroups.has(group)) {
                throw new TypeError(`Deferred shader bind group ${String(group)} is not active`);
            }
            const bindings = bindingsByGroup.get(group);
            if (
                bindings === undefined ||
                [...bindings.values()].some(kind => kind !== 'read-only-storage-buffer')
            ) {
                throw new TypeError(
                    `Deferred shader bind group ${String(group)} must contain only readonly storage buffers`
                );
            }
            deferred.add(group);
            previous = group;
        }
        for (const [group, bindings] of bindingsByGroup) {
            let containsStorage = false;
            for (const kind of bindings.values()) {
                if (kind === 'read-only-storage-buffer') {
                    containsStorage = true;
                    break;
                }
            }
            if (containsStorage && !deferred.has(group)) {
                throw new TypeError(
                    `Readonly storage bind group ${String(group)} must be explicitly deferred`
                );
            }
        }
    }

    private addPlanBinding(
        activeGroups: ReadonlySet<number>,
        bindingsByGroup: Map<number, Map<number, BindingPlanKind>>,
        group: number,
        binding: number,
        kind: BindingPlanKind,
        label: string
    ): void {
        requireNonNegativeSafeInteger(group, `${label} group`);
        requireNonNegativeSafeInteger(binding, `${label} binding`);
        if (!activeGroups.has(group)) {
            throw new TypeError(`${label} belongs to a group not listed as active`);
        }
        let bindings = bindingsByGroup.get(group);
        if (bindings === undefined) {
            bindings = new Map();
            bindingsByGroup.set(group, bindings);
        }
        if (bindings.has(binding)) {
            throw new TypeError(
                `Shader bind group ${String(group)} contains duplicate binding ${String(binding)}`
            );
        }
        bindings.set(binding, kind);
    }

    private validateSampledBinding(
        activeGroups: ReadonlySet<number>,
        bindingsByGroup: Map<number, Map<number, BindingPlanKind>>,
        sampled: Readonly<ShaderSampledBindingPlan>
    ): void {
        const samplerKind: string = sampled.samplerKind;
        if (samplerKind !== 'sampler' && samplerKind !== 'comparison-sampler') {
            throw new TypeError(`Sampled binding ${sampled.name} has an invalid sampler kind`);
        }
        this.addPlanBinding(
            activeGroups,
            bindingsByGroup,
            sampled.group,
            sampled.textureBinding,
            'sampled-texture',
            `Sampled binding ${sampled.name} texture`
        );
        this.addPlanBinding(
            activeGroups,
            bindingsByGroup,
            sampled.group,
            sampled.samplerBinding,
            sampled.samplerKind,
            `Sampled binding ${sampled.name} sampler`
        );
    }

    private validateDescriptors(
        descriptors: ShaderBindingLayoutPlan['bindGroupLayoutDescriptors'],
        activeGroups: ReadonlySet<number>,
        bindingsByGroup: ReadonlyMap<number, ReadonlyMap<number, BindingPlanKind>>
    ): void {
        for (let group = 0; group < descriptors.length; group += 1) {
            const descriptor = descriptors[group];
            if (descriptor === undefined) {
                throw new TypeError(
                    `Shader bind-group layout descriptor ${String(group)} is missing`
                );
            }
            const expected = bindingsByGroup.get(group);
            if (activeGroups.has(group) !== (expected !== undefined)) {
                throw new TypeError(
                    `Shader bind-group layout descriptor ${String(group)} disagrees with active groups`
                );
            }
            const expectedSize = expected?.size ?? 0;
            if (descriptor.entries.length !== expectedSize) {
                throw new TypeError(
                    `Shader bind-group layout descriptor ${String(group)} entry count disagrees with the binding plan`
                );
            }
            const seen = new Set<number>();
            for (const entry of descriptor.entries) {
                requireNonNegativeSafeInteger(
                    entry.binding,
                    `Layout group ${String(group)} binding`
                );
                if (seen.has(entry.binding)) {
                    throw new TypeError(
                        `Shader bind-group layout descriptor ${String(group)} contains duplicate binding ${String(entry.binding)}`
                    );
                }
                seen.add(entry.binding);
                const expectedKind = expected?.get(entry.binding);
                if (expectedKind === undefined || !this.layoutEntryMatches(entry, expectedKind)) {
                    throw new TypeError(
                        `Shader bind-group layout descriptor ${String(group)} binding ${String(entry.binding)} disagrees with the binding plan`
                    );
                }
            }
        }
    }

    private layoutEntryMatches(
        entry: ShaderBindingLayoutPlan['bindGroupLayoutDescriptors'][number]['entries'][number],
        kind: BindingPlanKind
    ): boolean {
        const fieldCount =
            Number(entry.buffer !== undefined) +
            Number(entry.texture !== undefined) +
            Number(entry.sampler !== undefined) +
            Number(entry.storageTexture !== undefined);
        if (fieldCount !== 1) return false;
        switch (kind) {
            case 'uniform-buffer':
                return entry.buffer !== undefined && (entry.buffer.type ?? 'uniform') === 'uniform';
            case 'read-only-storage-buffer':
                return entry.buffer?.type === 'read-only-storage';
            case 'sampled-texture':
                return entry.texture !== undefined;
            case 'sampler':
                return entry.sampler !== undefined && entry.sampler.type !== 'comparison';
            case 'comparison-sampler':
                return entry.sampler?.type === 'comparison';
        }
    }

    private validateHandles(
        layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[],
        sampledResources: readonly Readonly<ShaderSampledBindingResources>[]
    ): void {
        for (const handle of layoutHandles) this.registry.resolve(handle);
        for (const handle of uniformBufferHandles) this.registry.resolve(handle);
        for (const resources of sampledResources) {
            this.registry.resolve(resources.textureView);
            this.registry.resolve(resources.sampler);
        }
    }

    private createRecord(
        layoutToken: number,
        plan: Readonly<ShaderBindingLayoutPlan>,
        incomingLayoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        incomingUniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[],
        incomingSampledResources: readonly Readonly<ShaderSampledBindingResources>[],
        incomingDeferredGroupIndices: readonly number[]
    ): ShaderBindGroupRecord {
        const token = this.allocateToken();
        const layoutHandles = Object.freeze([...incomingLayoutHandles]);
        const uniformBufferHandles = Object.freeze([...incomingUniformBufferHandles]);
        const sampledResources = Object.freeze(
            incomingSampledResources.map(resources =>
                Object.freeze({
                    textureView: resources.textureView,
                    sampler: resources.sampler
                })
            )
        );
        const deferredGroupIndices = Object.freeze([...incomingDeferredGroupIndices]);
        const groupHandles = new Array<ResourceRegistryHandle<RHIBindGroup> | null>(
            layoutHandles.length
        ).fill(null);
        const created: ResourceRegistryHandle<RHIBindGroup>[] = [];
        try {
            for (const group of plan.activeGroupIndices) {
                if (deferredGroupIndices.includes(group)) continue;
                const layout = layoutHandles[group];
                if (layout === undefined) {
                    throw new Error('Active shader bind group lost its layout handle');
                }
                const bindings = this.bindingRecipesForGroup(
                    group,
                    plan.uniformBlocks,
                    uniformBufferHandles,
                    plan.sampledBindings,
                    sampledResources
                );
                const handle = this.registerGroup(layoutToken, group, layout, bindings);
                groupHandles[group] = handle;
                created.push(handle);
            }
        } catch (error) {
            for (let index = created.length - 1; index >= 0; index -= 1) {
                const handle = created[index];
                if (handle !== undefined) this.registry.discardUnsubmitted(handle);
            }
            throw error;
        }

        const handles = Object.freeze({
            token,
            layoutToken,
            groupHandles: Object.freeze(groupHandles),
            activeGroupIndices: Object.freeze([...plan.activeGroupIndices])
        });
        return {
            layoutToken,
            layoutHandles,
            uniformBufferHandles,
            sampledResources,
            deferredGroupIndices,
            handles
        };
    }

    private bindingRecipesForGroup(
        group: number,
        blocks: readonly Readonly<ShaderUniformBlockBindingPlan>[],
        buffers: readonly ResourceRegistryHandle<RHIBuffer>[],
        sampledBindings: readonly Readonly<ShaderSampledBindingPlan>[],
        sampledResources: readonly Readonly<ShaderSampledBindingResources>[]
    ): readonly Readonly<BindingRecipe>[] {
        const recipes: BindingRecipe[] = [];
        for (let index = 0; index < blocks.length; index += 1) {
            const block = blocks[index];
            if (block?.group !== group) continue;
            const buffer = buffers[index];
            if (buffer === undefined) {
                throw new Error(`Uniform block ${block.name} lost its buffer handle`);
            }
            recipes.push({ kind: 'buffer', binding: block.binding, buffer });
        }
        for (let index = 0; index < sampledBindings.length; index += 1) {
            const sampled = sampledBindings[index];
            if (sampled?.group !== group) continue;
            const resources = sampledResources[index];
            if (resources === undefined) {
                throw new Error(`Sampled binding ${sampled.name} lost its resource handles`);
            }
            recipes.push({
                kind: 'texture-view',
                binding: sampled.textureBinding,
                textureView: resources.textureView
            });
            recipes.push({
                kind: 'sampler',
                binding: sampled.samplerBinding,
                sampler: resources.sampler
            });
        }
        recipes.sort(compareBindingRecipes);
        return Object.freeze(recipes.map(recipe => Object.freeze(recipe)));
    }

    private registerGroup(
        layoutToken: number,
        group: number,
        layout: ResourceRegistryHandle<RHIBindGroupLayout>,
        bindings: readonly Readonly<BindingRecipe>[]
    ): ResourceRegistryHandle<RHIBindGroup> {
        const label = `Shader bind group ${String(group)} layout ${String(layoutToken)}`;
        const dependencies: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>[] = [layout];
        for (const binding of bindings) {
            switch (binding.kind) {
                case 'buffer':
                    dependencies.push(binding.buffer);
                    break;
                case 'texture-view':
                    dependencies.push(binding.textureView);
                    break;
                case 'sampler':
                    dependencies.push(binding.sampler);
                    break;
            }
        }
        return this.registry.register<RHIBindGroup>({
            label,
            dependencies,
            create(device, resolve) {
                const entries: RHIBindGroupEntry[] = [];
                for (const binding of bindings) {
                    switch (binding.kind) {
                        case 'buffer':
                            entries.push({
                                binding: binding.binding,
                                resource: { buffer: resolve(binding.buffer) }
                            });
                            break;
                        case 'texture-view':
                            entries.push({
                                binding: binding.binding,
                                resource: resolve(binding.textureView)
                            });
                            break;
                        case 'sampler':
                            entries.push({
                                binding: binding.binding,
                                resource: resolve(binding.sampler)
                            });
                            break;
                    }
                }
                return device.createBindGroup({
                    label,
                    lifetime: 'persistent',
                    layout: resolve(layout),
                    entries
                });
            }
        });
    }

    private requireRecord(owner: object): ShaderBindGroupRecord {
        const record = this.#recordsByOwner.get(owner);
        if (record === undefined) {
            throw new Error('Owner is not prepared in this shader bind-group cache');
        }
        return record;
    }

    private releaseRecord(record: ShaderBindGroupRecord): void {
        for (const handle of record.handles.groupHandles) {
            if (handle !== null) this.registry.release(handle);
        }
    }

    private allocateToken(): number {
        const token = this.#nextToken;
        if (!Number.isSafeInteger(token)) {
            throw new RangeError('Shader bind-group token space is exhausted');
        }
        this.#nextToken++;
        return token;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Shader bind-group resource cache is destroyed');
    }
}
