import type { RHIBuffer, RHIDevice, RHITexture, RHITextureView } from '../rhi/core';
import { getRHITextureFormatBlockInfo } from '../rhi/core/RHICopyValidation';
import type { CompiledRGResource } from './RenderGraphCompiler';

type CompiledRGPhysicalResource = Exclude<CompiledRGResource, { readonly kind: 'texture-view' }>;

/** Internal retention limits apply only to resources whose native submission has completed. */
export const TRANSIENT_RESOURCE_POOL_LIMITS = Object.freeze({
    maxIdleEntries: 128,
    maxIdleBytes: 256 * 1024 * 1024,
    maxIdleFrames: 120
});

function resourceByteLength(resource: CompiledRGPhysicalResource): number {
    if (resource.kind === 'buffer') return resource.descriptor.size;
    const descriptor = resource.descriptor;
    const block = getRHITextureFormatBlockInfo(descriptor.format);
    // Opaque depth storage may include implementation-specific padding or a stencil plane.
    const bytesPerBlock = block.bytesPerBlock ?? 8;
    let width = descriptor.size.width;
    let height = descriptor.size.height;
    let depth = descriptor.size.depthOrArrayLayers;
    let total = 0;
    for (let level = 0; level < descriptor.mipLevelCount; level += 1) {
        total +=
            Math.ceil(width / block.blockWidth) *
            Math.ceil(height / block.blockHeight) *
            depth *
            bytesPerBlock *
            descriptor.sampleCount;
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
        if (descriptor.dimension === '3d') depth = Math.max(1, Math.floor(depth / 2));
    }
    return total;
}

function sameStringList(first: readonly string[], second: readonly string[]): boolean {
    if (first.length !== second.length) return false;
    for (let index = 0; index < first.length; index += 1) {
        if (first[index] !== second[index]) return false;
    }
    return true;
}

export interface PooledRGResource {
    readonly key: number;
    readonly compiled: CompiledRGPhysicalResource;
    readonly deviceId: number;
    readonly deviceGeneration: number;
    readonly texture: RHITexture | null;
    readonly textureView: RHITextureView | null;
    readonly buffer: RHIBuffer | null;
    readonly byteLength: number;
    idleSinceFrame: number;
    previousIdle: PooledRGResource | null;
    nextIdle: PooledRGResource | null;
    inUse: boolean;
}

function mixPoolKey(hash: number, value: number): number {
    return Math.imul(hash ^ value, 0x01000193) >>> 0;
}

function mixPoolKeyString(hash: number, value: string): number {
    let result = mixPoolKey(hash, value.length);
    for (let index = 0; index < value.length; index += 1) {
        result = mixPoolKey(result, value.charCodeAt(index));
    }
    return result;
}

/** Allocation-free numeric bucket; structural equality below makes hash collisions harmless. */
function resourcePoolKey(resource: CompiledRGPhysicalResource): number {
    if (resource.kind === 'buffer') {
        const descriptor = resource.descriptor;
        let hash = mixPoolKey(0x811c9dc5, 1);
        hash = mixPoolKey(hash, descriptor.size);
        hash = mixPoolKey(hash, descriptor.usage);
        return mixPoolKey(hash, descriptor.mappedAtCreation ? 1 : 0);
    }
    const descriptor = resource.descriptor;
    let hash = mixPoolKey(0x811c9dc5, 2);
    hash = mixPoolKeyString(hash, descriptor.dimension);
    hash = mixPoolKeyString(hash, descriptor.viewDimension);
    hash = mixPoolKey(hash, descriptor.size.width);
    hash = mixPoolKey(hash, descriptor.size.height);
    hash = mixPoolKey(hash, descriptor.size.depthOrArrayLayers);
    hash = mixPoolKey(hash, descriptor.mipLevelCount);
    hash = mixPoolKey(hash, descriptor.sampleCount);
    hash = mixPoolKeyString(hash, descriptor.format);
    hash = mixPoolKey(hash, descriptor.usage);
    hash = mixPoolKey(hash, descriptor.viewFormats.length);
    // Indexed deliberately: this key is computed for every transient acquire and must not create
    // an iterator in the allocation gate.
    let index = 0;
    while (index < descriptor.viewFormats.length) {
        hash = mixPoolKeyString(hash, descriptor.viewFormats[index] ?? '');
        index += 1;
    }
    return hash;
}

function samePooledResourceDescriptor(
    entry: PooledRGResource,
    resource: CompiledRGPhysicalResource
): boolean {
    const cached = entry.compiled;
    if (cached.kind !== resource.kind) return false;
    if (cached.kind === 'buffer') {
        if (resource.kind !== 'buffer') return false;
        const first = cached.descriptor;
        const second = resource.descriptor;
        return (
            first.size === second.size &&
            first.usage === second.usage &&
            first.mappedAtCreation === second.mappedAtCreation
        );
    }
    if (resource.kind !== 'texture') return false;
    const first = cached.descriptor;
    const second = resource.descriptor;
    return (
        first.dimension === second.dimension &&
        first.viewDimension === second.viewDimension &&
        first.size.width === second.size.width &&
        first.size.height === second.size.height &&
        first.size.depthOrArrayLayers === second.size.depthOrArrayLayers &&
        first.mipLevelCount === second.mipLevelCount &&
        first.sampleCount === second.sampleCount &&
        first.format === second.format &&
        first.usage === second.usage &&
        sameStringList(first.viewFormats, second.viewFormats)
    );
}

export class TransientResourcePool {
    readonly #entries = new Map<number, PooledRGResource[]>();
    #ownerDeviceId: number | null = null;
    #ownerDeviceGeneration: number | null = null;
    #destroyed = false;
    #frameIndex = 0;
    #idleCount = 0;
    #idleBytes = 0;
    #oldestIdle: PooledRGResource | null = null;
    #newestIdle: PooledRGResource | null = null;

    beginFrame(device: RHIDevice): void {
        this.useDevice(device);
        this.#frameIndex += 1;
        while (
            this.#oldestIdle !== null &&
            this.#frameIndex - this.#oldestIdle.idleSinceFrame >
                TRANSIENT_RESOURCE_POOL_LIMITS.maxIdleFrames
        ) {
            this.discard(this.#oldestIdle);
        }
    }

    useDevice(device: RHIDevice): void {
        if (this.#destroyed) throw new Error('Render graph transient pool is destroyed');
        if (
            this.#ownerDeviceId !== null &&
            (this.#ownerDeviceId !== device.id || this.#ownerDeviceGeneration !== device.generation)
        ) {
            this.destroyIdleEntries();
        }
        this.#ownerDeviceId = device.id;
        this.#ownerDeviceGeneration = device.generation;
    }

    acquire(
        resource: CompiledRGPhysicalResource,
        device: RHIDevice,
        result: { poolEntry: PooledRGResource | null; allocated: boolean }
    ): void {
        this.useDevice(device);
        const key = resourcePoolKey(resource);
        let entries = this.#entries.get(key);
        if (entries) {
            for (let index = entries.length - 1; index >= 0; index -= 1) {
                const entry = entries[index];
                if (!entry) continue;
                const staleGeneration =
                    entry.deviceId === device.id && entry.deviceGeneration !== device.generation;
                const destroyed =
                    (entry.texture?.destroyed ?? false) ||
                    (entry.textureView?.destroyed ?? false) ||
                    (entry.buffer?.destroyed ?? false);
                if (!entry.inUse && (staleGeneration || destroyed)) {
                    this.discard(entry);
                }
            }
            for (const entry of entries) {
                if (
                    !entry.inUse &&
                    samePooledResourceDescriptor(entry, resource) &&
                    entry.deviceId === device.id &&
                    entry.deviceGeneration === device.generation &&
                    !(entry.texture?.destroyed ?? false) &&
                    !(entry.buffer?.destroyed ?? false)
                ) {
                    this.removeIdle(entry);
                    entry.inUse = true;
                    result.poolEntry = entry;
                    result.allocated = false;
                    return;
                }
            }
        }
        entries = this.#entries.get(key);

        let texture: RHITexture | null = null;
        let textureView: RHITextureView | null = null;
        let buffer: RHIBuffer | null = null;
        try {
            if (resource.kind === 'texture') {
                texture = device.createTexture(resource.descriptor);
                textureView = texture.createView();
            } else {
                buffer = device.createBuffer(resource.descriptor);
            }
        } catch (error) {
            textureView?.destroy();
            texture?.destroy();
            buffer?.destroy();
            throw error;
        }
        const entry: PooledRGResource = {
            key,
            compiled: resource,
            deviceId: device.id,
            deviceGeneration: device.generation,
            texture,
            textureView,
            buffer,
            byteLength: resourceByteLength(resource),
            idleSinceFrame: 0,
            previousIdle: null,
            nextIdle: null,
            inUse: true
        };
        if (entries) entries.push(entry);
        else this.#entries.set(key, [entry]);
        result.poolEntry = entry;
        result.allocated = true;
    }

    release(entry: PooledRGResource): void {
        // A mapped-at-creation buffer can be unmapped or remapped to a subrange by its frame.
        // Neither backend can synchronously restore the original whole-buffer mapping contract,
        // so it is a one-frame allocation even though ordinary transient buffers are reusable.
        if (entry.compiled.kind === 'buffer' && entry.compiled.descriptor.mappedAtCreation) {
            this.discard(entry);
            return;
        }
        if (
            this.#destroyed ||
            entry.deviceId !== this.#ownerDeviceId ||
            entry.deviceGeneration !== this.#ownerDeviceGeneration
        ) {
            this.discard(entry);
            return;
        }
        entry.inUse = false;
        entry.idleSinceFrame = this.#frameIndex;
        entry.previousIdle = this.#newestIdle;
        entry.nextIdle = null;
        if (this.#newestIdle !== null) this.#newestIdle.nextIdle = entry;
        else this.#oldestIdle = entry;
        this.#newestIdle = entry;
        this.#idleCount += 1;
        this.#idleBytes += entry.byteLength;
        while (
            this.#oldestIdle !== null &&
            (this.#idleCount > TRANSIENT_RESOURCE_POOL_LIMITS.maxIdleEntries ||
                this.#idleBytes > TRANSIENT_RESOURCE_POOL_LIMITS.maxIdleBytes)
        ) {
            this.discard(this.#oldestIdle);
        }
    }

    discard(entry: PooledRGResource): void {
        if (!entry.inUse) this.removeIdle(entry);
        entry.textureView?.destroy();
        entry.texture?.destroy();
        entry.buffer?.destroy();
        const entries = this.#entries.get(entry.key);
        if (!entries) return;
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
        if (entries.length === 0) this.#entries.delete(entry.key);
    }

    private removeIdle(entry: PooledRGResource): void {
        if (entry.previousIdle !== null) entry.previousIdle.nextIdle = entry.nextIdle;
        else this.#oldestIdle = entry.nextIdle;
        if (entry.nextIdle !== null) entry.nextIdle.previousIdle = entry.previousIdle;
        else this.#newestIdle = entry.previousIdle;
        entry.previousIdle = null;
        entry.nextIdle = null;
        this.#idleCount -= 1;
        this.#idleBytes -= entry.byteLength;
    }

    destroy(): void {
        if (this.#destroyed) return;
        this.#destroyed = true;
        this.destroyIdleEntries();
        this.#ownerDeviceId = null;
        this.#ownerDeviceGeneration = null;
    }

    private destroyIdleEntries(): void {
        while (this.#oldestIdle !== null) this.discard(this.#oldestIdle);
    }
}
