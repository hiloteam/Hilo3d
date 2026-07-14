import type {
    RHIExtent3D,
    RHIImageCopyTexture,
    RHITextureDescriptor,
    RHITextureViewDescriptor
} from '../RHI';

export function extent3D(value: RHIExtent3D): GPUExtent3DDict {
    return {
        width: value.width,
        ...(value.height === undefined ? {} : { height: value.height }),
        ...(value.depthOrArrayLayers === undefined
            ? {}
            : { depthOrArrayLayers: value.depthOrArrayLayers })
    };
}

export function origin3D(value: NonNullable<RHIImageCopyTexture['origin']>): GPUOrigin3DDict {
    return {
        ...(value.x === undefined ? {} : { x: value.x }),
        ...(value.y === undefined ? {} : { y: value.y }),
        ...(value.z === undefined ? {} : { z: value.z })
    };
}

export function textureDescriptor(descriptor: RHITextureDescriptor): GPUTextureDescriptor {
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        size: extent3D(descriptor.size),
        ...(descriptor.mipLevelCount === undefined
            ? {}
            : { mipLevelCount: descriptor.mipLevelCount }),
        ...(descriptor.sampleCount === undefined ? {} : { sampleCount: descriptor.sampleCount }),
        ...(descriptor.dimension === undefined ? {} : { dimension: descriptor.dimension }),
        format: descriptor.format,
        usage: descriptor.usage,
        ...(descriptor.viewFormats === undefined
            ? {}
            : { viewFormats: [...descriptor.viewFormats] })
    };
}

export function textureViewDescriptor(
    descriptor: RHITextureViewDescriptor
): GPUTextureViewDescriptor {
    return {
        ...(descriptor.label === undefined ? {} : { label: descriptor.label }),
        ...(descriptor.format === undefined ? {} : { format: descriptor.format }),
        ...(descriptor.dimension === undefined ? {} : { dimension: descriptor.dimension }),
        ...(descriptor.aspect === undefined ? {} : { aspect: descriptor.aspect }),
        ...(descriptor.baseMipLevel === undefined ? {} : { baseMipLevel: descriptor.baseMipLevel }),
        ...(descriptor.mipLevelCount === undefined
            ? {}
            : { mipLevelCount: descriptor.mipLevelCount }),
        ...(descriptor.baseArrayLayer === undefined
            ? {}
            : { baseArrayLayer: descriptor.baseArrayLayer }),
        ...(descriptor.arrayLayerCount === undefined
            ? {}
            : { arrayLayerCount: descriptor.arrayLayerCount })
    };
}
