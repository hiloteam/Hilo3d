import type {
    RHIBindGroup,
    RHIBindGroupEntry,
    RHIBindGroupLayout,
    RHIBuffer,
    RHIDeviceOwnedDestroyable
} from '../rhi/core';
import type { ResourceRegistry, ResourceRegistryHandle } from './ResourceRegistry';
import type {
    ShaderBindingLayoutPlan,
    ShaderUniformBlockBindingPlan
} from './ShaderBindingLayoutCompiler';

export interface UniformBindGroupHandleSet {
    readonly token: number;
    readonly layoutToken: number;
    readonly groupHandles: readonly (ResourceRegistryHandle<RHIBindGroup> | null)[];
    readonly activeGroupIndices: readonly number[];
}

interface UniformBindGroupRecord {
    readonly layoutToken: number;
    readonly layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[];
    readonly uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[];
    readonly handles: Readonly<UniformBindGroupHandleSet>;
}

interface UniformBindingRecipe {
    readonly binding: number;
    readonly buffer: ResourceRegistryHandle<RHIBuffer>;
}

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

function compareBindingRecipes(left: UniformBindingRecipe, right: UniformBindingRecipe): number {
    return left.binding - right.binding;
}

/**
 * Recoverable uniform-only bind groups keyed by owner and exact upstream logical identities.
 * Recipes retain only logical handles and portable descriptor data; native resources are resolved
 * at initial creation and every registry recovery.
 */
export class UniformBindGroupResourceCache {
    #recordsByOwner = new WeakMap<object, UniformBindGroupRecord>();
    readonly #records = new Set<UniformBindGroupRecord>();
    #nextToken = 1;
    #destroyed = false;

    constructor(readonly registry: ResourceRegistry) {}

    prepare(
        owner: object,
        layoutToken: number,
        plan: Readonly<ShaderBindingLayoutPlan>,
        layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[]
    ): Readonly<UniformBindGroupHandleSet> {
        this.assertAlive();
        requireNonNegativeSafeInteger(layoutToken, 'Uniform bind-group layout token');

        const current = this.#recordsByOwner.get(owner);
        if (
            current?.layoutToken === layoutToken &&
            sameHandleIdentities(current.layoutHandles, layoutHandles) &&
            sameHandleIdentities(current.uniformBufferHandles, uniformBufferHandles)
        ) {
            return current.handles;
        }

        this.validateShape(plan, layoutHandles, uniformBufferHandles);
        this.validateHandles(layoutHandles, uniformBufferHandles);
        const replacement = this.createRecord(
            layoutToken,
            plan,
            layoutHandles,
            uniformBufferHandles
        );
        this.#recordsByOwner.set(owner, replacement);
        this.#records.add(replacement);
        if (current !== undefined) {
            this.#records.delete(current);
            this.releaseRecord(current);
        }
        return replacement.handles;
    }

    resolveGroup(owner: object, groupIndex: number): RHIBindGroup | null {
        this.assertAlive();
        requireNonNegativeSafeInteger(groupIndex, 'Uniform bind-group index');
        const record = this.requireRecord(owner);
        if (groupIndex >= record.handles.groupHandles.length) {
            throw new RangeError('Uniform bind-group index is outside the prepared group range');
        }
        const handle = record.handles.groupHandles[groupIndex];
        return handle === null || handle === undefined ? null : this.registry.resolve(handle);
    }

    markUsed(owner: object, frameIndex: number): void {
        this.assertAlive();
        requireNonNegativeSafeInteger(frameIndex, 'Uniform bind-group frame index');
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
        return true;
    }

    destroy(): void {
        if (this.#destroyed) return;
        for (const record of this.#records) this.releaseRecord(record);
        this.#records.clear();
        this.#recordsByOwner = new WeakMap();
        this.#destroyed = true;
    }

    private validateShape(
        plan: Readonly<ShaderBindingLayoutPlan>,
        layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[]
    ): void {
        if (layoutHandles.length !== plan.bindGroupLayoutDescriptors.length) {
            throw new RangeError(
                'Uniform bind-group layout handles must match the continuous shader group layout count'
            );
        }
        if (uniformBufferHandles.length !== plan.uniformBlocks.length) {
            throw new RangeError(
                'Uniform buffer handles must match ShaderBindingLayoutPlan.uniformBlocks order and count'
            );
        }

        const activeGroups = new Set<number>();
        let previousGroup = -1;
        for (const group of plan.activeGroupIndices) {
            requireNonNegativeSafeInteger(group, 'Active uniform bind-group index');
            if (group >= layoutHandles.length) {
                throw new RangeError('Active uniform bind-group index exceeds the layout range');
            }
            if (group <= previousGroup) {
                throw new TypeError(
                    'Active uniform bind-group indices must be unique and ascending'
                );
            }
            activeGroups.add(group);
            previousGroup = group;
        }

        const bindingsByGroup = new Map<number, Set<number>>();
        for (const block of plan.uniformBlocks) {
            requireNonNegativeSafeInteger(block.group, `Uniform block ${block.name} group`);
            requireNonNegativeSafeInteger(block.binding, `Uniform block ${block.name} binding`);
            if (!activeGroups.has(block.group)) {
                throw new TypeError(
                    `Uniform block ${block.name} belongs to a group not listed as active`
                );
            }
            let bindings = bindingsByGroup.get(block.group);
            if (bindings === undefined) {
                bindings = new Set();
                bindingsByGroup.set(block.group, bindings);
            }
            if (bindings.has(block.binding)) {
                throw new TypeError(
                    `Uniform bind group ${String(block.group)} contains duplicate binding ${String(block.binding)}`
                );
            }
            bindings.add(block.binding);
        }
        for (const group of activeGroups) {
            if (!bindingsByGroup.has(group)) {
                throw new TypeError(`Active uniform bind group ${String(group)} has no bindings`);
            }
        }
    }

    private validateHandles(
        layoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        uniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[]
    ): void {
        for (const handle of layoutHandles) this.registry.resolve(handle);
        for (const handle of uniformBufferHandles) this.registry.resolve(handle);
    }

    private createRecord(
        layoutToken: number,
        plan: Readonly<ShaderBindingLayoutPlan>,
        incomingLayoutHandles: readonly ResourceRegistryHandle<RHIBindGroupLayout>[],
        incomingUniformBufferHandles: readonly ResourceRegistryHandle<RHIBuffer>[]
    ): UniformBindGroupRecord {
        const token = this.allocateToken();
        const layoutHandles = Object.freeze([...incomingLayoutHandles]);
        const uniformBufferHandles = Object.freeze([...incomingUniformBufferHandles]);
        const groupHandles = new Array<ResourceRegistryHandle<RHIBindGroup> | null>(
            layoutHandles.length
        ).fill(null);
        const created: ResourceRegistryHandle<RHIBindGroup>[] = [];
        try {
            for (const group of plan.activeGroupIndices) {
                const layout = layoutHandles[group];
                if (layout === undefined) {
                    throw new Error('Active uniform bind group lost its layout handle');
                }
                const bindings = this.bindingRecipesForGroup(
                    group,
                    plan.uniformBlocks,
                    uniformBufferHandles
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
            handles
        };
    }

    private bindingRecipesForGroup(
        group: number,
        blocks: readonly Readonly<ShaderUniformBlockBindingPlan>[],
        buffers: readonly ResourceRegistryHandle<RHIBuffer>[]
    ): readonly Readonly<UniformBindingRecipe>[] {
        const recipes: UniformBindingRecipe[] = [];
        for (let index = 0; index < blocks.length; index += 1) {
            const block = blocks[index];
            if (block?.group !== group) continue;
            const buffer = buffers[index];
            if (buffer === undefined) {
                throw new Error(`Uniform block ${block.name} lost its buffer handle`);
            }
            recipes.push({ binding: block.binding, buffer });
        }
        recipes.sort(compareBindingRecipes);
        return Object.freeze(recipes.map(recipe => Object.freeze(recipe)));
    }

    private registerGroup(
        layoutToken: number,
        group: number,
        layout: ResourceRegistryHandle<RHIBindGroupLayout>,
        bindings: readonly Readonly<UniformBindingRecipe>[]
    ): ResourceRegistryHandle<RHIBindGroup> {
        const label = `Uniform bind group ${String(group)} layout ${String(layoutToken)}`;
        const dependencies: ResourceRegistryHandle<RHIDeviceOwnedDestroyable>[] = [
            layout,
            ...bindings.map(binding => binding.buffer)
        ];
        return this.registry.register<RHIBindGroup>({
            label,
            dependencies,
            create(device, resolve) {
                const entries: RHIBindGroupEntry[] = bindings.map(binding => ({
                    binding: binding.binding,
                    resource: { buffer: resolve(binding.buffer) }
                }));
                return device.createBindGroup({
                    label,
                    lifetime: 'persistent',
                    layout: resolve(layout),
                    entries
                });
            }
        });
    }

    private requireRecord(owner: object): UniformBindGroupRecord {
        const record = this.#recordsByOwner.get(owner);
        if (record === undefined) {
            throw new Error('Owner is not prepared in this uniform bind-group cache');
        }
        return record;
    }

    private releaseRecord(record: UniformBindGroupRecord): void {
        for (const handle of record.handles.groupHandles) {
            if (handle !== null) this.registry.release(handle);
        }
    }

    private allocateToken(): number {
        const token = this.#nextToken;
        if (!Number.isSafeInteger(token)) {
            throw new RangeError('Uniform bind-group token space is exhausted');
        }
        this.#nextToken++;
        return token;
    }

    private assertAlive(): void {
        if (this.#destroyed) throw new Error('Uniform bind-group resource cache is destroyed');
    }
}
