import type { CompiledRGResource } from './RenderGraphCompiler';
import { getRHITextureFormatBlockInfo } from '../rhi/core/RHICopyValidation';

export type CompiledRGPhysicalResource = Exclude<
    CompiledRGResource,
    { readonly kind: 'texture-view' }
>;

export function resourceByteLength(resource: CompiledRGPhysicalResource): number {
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
export function resourcePoolKey(resource: CompiledRGPhysicalResource): number {
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

export function samePhysicalResourceDescriptor(
    cached: CompiledRGPhysicalResource,
    resource: CompiledRGPhysicalResource
): boolean {
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
