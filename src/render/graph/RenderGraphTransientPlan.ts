import type { CompiledRGResource, CompiledRGTextureResource } from './RenderGraphCompiler';
import {
    resourceByteLength,
    resourcePoolKey,
    samePhysicalResourceDescriptor
} from './RenderGraphResourceDescriptors';

/** Descriptor estimates, including mips/layers/samples; not driver-reported GPU memory. */
export interface RenderGraphMemorySnapshot {
    /** Sum of graph-owned, non-extracted logical texture and buffer sizes. */
    readonly logicalBytes: number;
    /** Maximum sum of logical sizes whose inclusive pass lifetimes overlap. */
    readonly peakLiveBytes: number;
    /** Physical bytes reserved for this graph, excluding imported/extracted resources. */
    readonly physicalBytes: number;
    /** Logical transient textures that share another texture's physical allocation. */
    readonly aliasedTextures: number;
}

export interface RenderGraphTransientPlan {
    /** Physical owner index for each resource in the compiled resource array. */
    readonly textureSlots: readonly number[];
    readonly memory: Readonly<RenderGraphMemorySnapshot>;
}

interface TextureSlot {
    representative: number;
    lastUse: number;
    readonly members: number[];
}
interface TextureSlotGroup {
    readonly resource: CompiledRGTextureResource;
    readonly heap: TextureSlot[];
}

function earlier(a: TextureSlot, b: TextureSlot): boolean {
    return (
        a.lastUse < b.lastUse || (a.lastUse === b.lastUse && a.representative < b.representative)
    );
}

/** Keep the earliest-ending allocation at the root; overlapping intervals never scan all slots. */
function restoreSlotHeap(heap: TextureSlot[], root: number): void {
    const value = heap[root];
    if (value === undefined) return;
    while (root * 2 + 1 < heap.length) {
        let child = root * 2 + 1;
        const left = heap[child];
        const right = heap[child + 1];
        if (left === undefined) break;
        if (right !== undefined && earlier(right, left)) child++;
        const next = heap[child];
        if (next === undefined || !earlier(next, value)) break;
        heap[root] = next;
        root = child;
    }
    heap[root] = value;
}

/** Calculate the transient working set without touching an RHI device. */
export function planTransientResources(
    resources: readonly CompiledRGResource[],
    passCount: number
): Readonly<RenderGraphTransientPlan> {
    const changes = new Float64Array(passCount + 1);
    const textureSlots = resources.map((_resource, index) => index);
    const textures: number[] = [];
    let logicalBytes = 0;
    for (const [index, resource] of resources.entries()) {
        if (
            resource.kind === 'texture-view' ||
            resource.origin !== 'transient' ||
            resource.extracted
        )
            continue;
        const bytes = resourceByteLength(resource);
        logicalBytes += bytes;
        if (resource.lifetime !== null) {
            const { firstUse, lastUse } = resource.lifetime;
            changes[firstUse] = (changes[firstUse] ?? 0) + bytes;
            changes[lastUse + 1] = (changes[lastUse + 1] ?? 0) - bytes;
            if (resource.kind === 'texture') textures.push(index);
        }
    }
    let live = 0;
    let peakLiveBytes = 0;
    for (const change of changes) {
        live += change;
        peakLiveBytes = Math.max(peakLiveBytes, live);
    }
    // Color intervals in execution order, not declaration order. Equality is exact even if
    // descriptor hashes collide. Inclusive lifetimes prohibit same-pass sampled/attachment aliases.
    textures.sort(
        (a, b) =>
            (resources[a]?.lifetime?.firstUse ?? 0) - (resources[b]?.lifetime?.firstUse ?? 0) ||
            a - b
    );
    const buckets = new Map<number, TextureSlotGroup[]>();
    let physicalBytes = logicalBytes;
    let aliasedTextures = 0;
    for (const index of textures) {
        const resource = resources[index];
        if (resource?.kind !== 'texture' || resource.lifetime === null) continue;
        const key = resourcePoolKey(resource);
        let bucket = buckets.get(key);
        if (bucket === undefined) {
            bucket = [];
            buckets.set(key, bucket);
        }
        let group = bucket.find(candidate =>
            samePhysicalResourceDescriptor(candidate.resource, resource)
        );
        if (group === undefined) {
            group = { resource, heap: [] };
            bucket.push(group);
        }
        const heap = group.heap;
        const slot = heap[0];
        if (slot === undefined || slot.lastUse >= resource.lifetime.firstUse) {
            const added: TextureSlot = {
                representative: index,
                lastUse: resource.lifetime.lastUse,
                members: [index]
            };
            let child = heap.length;
            heap.push(added);
            while (child > 0) {
                const parent = Math.floor((child - 1) / 2);
                const previous = heap[parent];
                if (previous === undefined || !earlier(added, previous)) break;
                heap[child] = previous;
                child = parent;
            }
            heap[child] = added;
        } else {
            slot.representative = Math.min(slot.representative, index);
            slot.lastUse = resource.lifetime.lastUse;
            slot.members.push(index);
            physicalBytes -= resourceByteLength(resource);
            aliasedTextures++;
            restoreSlotHeap(heap, 0);
        }
    }
    for (const bucket of buckets.values())
        for (const group of bucket) {
            for (const slot of group.heap)
                for (const index of slot.members) textureSlots[index] = slot.representative;
        }
    return Object.freeze({
        textureSlots: Object.freeze(textureSlots),
        memory: Object.freeze({ logicalBytes, peakLiveBytes, physicalBytes, aliasedTextures })
    });
}
