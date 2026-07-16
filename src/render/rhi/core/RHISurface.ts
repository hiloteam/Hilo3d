import type { RHIDeviceOwnedDestroyable, RHITexture } from './RHIResources';
import type { RHITextureFormat, RHITextureUsageFlags } from './RHITypes';

export type RHICompositeAlphaMode = 'opaque' | 'premultiplied';
export type RHIColorSpace = 'srgb' | 'display-p3';
export type RHIPresentMode = 'fifo';

export interface RHISurfaceConfiguration {
    readonly format: RHITextureFormat;
    /** Optional presentation-owned depth/stencil attachment for direct surface passes. */
    readonly depthStencilFormat?: RHITextureFormat | null;
    readonly width: number;
    readonly height: number;
    readonly usage?: RHITextureUsageFlags;
    readonly alphaMode?: RHICompositeAlphaMode;
    readonly colorSpace?: RHIColorSpace;
    readonly presentMode?: RHIPresentMode;
}

export interface RHINormalizedSurfaceConfiguration {
    readonly format: RHITextureFormat;
    readonly depthStencilFormat: RHITextureFormat | null;
    readonly width: number;
    readonly height: number;
    readonly usage: RHITextureUsageFlags;
    readonly alphaMode: RHICompositeAlphaMode;
    readonly colorSpace: RHIColorSpace;
    readonly presentMode: RHIPresentMode;
}

export type RHISurfaceState = 'unconfigured' | 'configured' | 'acquired' | 'destroyed';

/**
 * Presentation is independent from device construction. An acquired texture has frame lifetime
 * and becomes invalid after present(), reconfiguration, loss, or surface destruction.
 */
export interface RHISurface extends RHIDeviceOwnedDestroyable {
    readonly state: RHISurfaceState;
    readonly configuration: Readonly<RHINormalizedSurfaceConfiguration> | null;

    configure(configuration: RHISurfaceConfiguration): void;
    getCurrentTexture(): RHITexture;
    /** Returns the configured presentation-owned depth/stencil attachment, when requested. */
    getDepthStencilTexture(): RHITexture | null;
    present(): void;
}
