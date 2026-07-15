import type {
    RHINormalizedSamplerDescriptor,
    RHINormalizedTextureDescriptor,
    RHINormalizedTextureViewDescriptor
} from '../../core/RHIResources';
import type { RHIExtent3D, RHIOrigin3D } from '../../core/RHITypes';

export function nativeWebGPUExtent(value: RHIExtent3D): GPUExtent3DDict {
    return {
        width: value.width,
        height: value.height ?? 1,
        depthOrArrayLayers: value.depthOrArrayLayers ?? 1
    };
}

export function nativeWebGPUOrigin(value: RHIOrigin3D | undefined): GPUOrigin3DDict {
    return {
        x: value?.x ?? 0,
        y: value?.y ?? 0,
        z: value?.z ?? 0
    };
}

export function nativeWebGPUTextureDescriptor(
    descriptor: Readonly<RHINormalizedTextureDescriptor>
): GPUTextureDescriptor {
    return {
        label: descriptor.label,
        size: {
            width: descriptor.size.width,
            height: descriptor.size.height,
            depthOrArrayLayers: descriptor.size.depthOrArrayLayers
        },
        mipLevelCount: descriptor.mipLevelCount,
        sampleCount: descriptor.sampleCount,
        dimension: descriptor.dimension,
        format: descriptor.format,
        usage: descriptor.usage,
        viewFormats: [...descriptor.viewFormats]
    };
}

export function nativeWebGPUTextureViewDescriptor(
    descriptor: Readonly<RHINormalizedTextureViewDescriptor>
): GPUTextureViewDescriptor {
    return {
        label: descriptor.label,
        format: descriptor.format,
        dimension: descriptor.dimension,
        aspect: descriptor.aspect,
        baseMipLevel: descriptor.baseMipLevel,
        mipLevelCount: descriptor.mipLevelCount,
        baseArrayLayer: descriptor.baseArrayLayer,
        arrayLayerCount: descriptor.arrayLayerCount
    };
}

export function nativeWebGPUSamplerDescriptor(
    descriptor: Readonly<RHINormalizedSamplerDescriptor>
): GPUSamplerDescriptor {
    return {
        label: descriptor.label,
        addressModeU: descriptor.addressModeU,
        addressModeV: descriptor.addressModeV,
        addressModeW: descriptor.addressModeW,
        magFilter: descriptor.magFilter,
        minFilter: descriptor.minFilter,
        mipmapFilter: descriptor.mipmapFilter,
        lodMinClamp: descriptor.lodMinClamp,
        lodMaxClamp: descriptor.lodMaxClamp,
        ...(descriptor.compare === undefined ? {} : { compare: descriptor.compare }),
        maxAnisotropy: descriptor.maxAnisotropy
    };
}
