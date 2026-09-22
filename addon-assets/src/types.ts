import type { EventListener, Renderer, Texture } from 'hilo3d';

/** Versioned, immutable 2D KTX2 asset metadata used for admission before allocating memory. */
export interface TextureAssetSource {
    /** Application-stable identifier, independent of deployment URL. */
    readonly id: string;
    /** Content version. A changed payload must use a new version. */
    readonly version: string;
    /** KTX2 URL, resolved against the manager base URL. */
    readonly url: string;
    /** Exact uncompressed HTTP response size in bytes. */
    readonly byteLength: number;
    /** Authored top-level width in texels. */
    readonly width: number;
    /** Authored top-level height in texels. */
    readonly height: number;
    /** Number of authored mip levels, including level zero. */
    readonly mipLevelCount: number;
}

/** Application-provided visibility/LOD demand; level zero is the finest mip. */
export interface TextureAssetDemand {
    /** Finest requested mip. Defaults to zero. */
    readonly mipLevel?: number;
    /** Larger values are serviced first, with FIFO ties. Defaults to zero. */
    readonly priority?: number;
    /** Hidden leases may be evicted; their requests wait until made visible again. */
    readonly visible?: boolean;
}

/** Independent admission limits for this manager; unrelated engine resources are excluded. */
export interface AssetBudgets {
    /** Maximum simultaneously fetching or decoding textures. Defaults to two. */
    readonly concurrentRequests?: number;
    /** Maximum distinct live asset identities. Defaults to 128. */
    readonly queuedAssets?: number;
    /** Maximum bytes per encoded asset. Defaults to 16 MiB. */
    readonly sourceBytes?: number;
    /** Maximum owned CPU texture data plus reserved job scratch. Defaults to 128 MiB. */
    readonly cpuBytes?: number;
    /** Maximum reserved network/decoder input and output bytes. Defaults to 64 MiB. */
    readonly inFlightBytes?: number;
    /** Estimated GPU texel bytes including old/new allocations until fences settle. Defaults to 128 MiB. */
    readonly residentBytes?: number;
    /** Maximum texture bytes admitted by one update. Defaults to 8 MiB. */
    readonly uploadBytesPerFrame?: number;
    /** Maximum uploads admitted by one update. Defaults to four. */
    readonly uploadsPerFrame?: number;
    /** Hard maximum WASM linear memory per decoder worker. Defaults to 32 MiB. */
    readonly workerMemoryBytes?: number;
}

/** Portable device compression snapshot passed to a decoder, with no native GPU objects. */
export interface AssetTextureCapabilities {
    readonly astc: boolean;
    readonly bc: boolean;
    readonly etc2: boolean;
}

/** The portable storage formats produced by the built-in Basis transcoder. */
export type AssetTextureFormat = 'rgba8' | 'bc3' | 'etc2' | 'astc';

/** One bounded decode operation. The decoder may consume the input buffer. */
export interface TextureDecodeRequest {
    readonly data: ArrayBuffer;
    readonly source: Readonly<TextureAssetSource>;
    readonly mipLevel: number;
    readonly capabilities: Readonly<AssetTextureCapabilities>;
}

/** Owned, tightly packed mip suffix with no borrowed WASM views. */
export interface DecodedAssetTexture {
    readonly format: AssetTextureFormat;
    readonly colorSpace: 'linear' | 'srgb';
    readonly mipLevel: number;
    readonly mipmaps: readonly AssetTextureMipmap[];
}

/** Owned bytes for one complete, tightly packed mip. */
export interface AssetTextureMipmap {
    readonly data: Uint8Array<ArrayBuffer>;
    readonly width: number;
    readonly height: number;
}

/** Decoder extension contract. Implementations must honor cancellation and return owned bytes. */
export interface TextureAssetDecoder {
    decode(
        request: Readonly<TextureDecodeRequest>,
        signal: AbortSignal
    ): Promise<DecodedAssetTexture>;
    /** Release all workers and reject pending jobs. */
    destroy(): void;
}

/** Renderer services needed by the addon; all uploads retain the core's graph and recovery policy. */
export interface AssetRenderer extends Pick<
    Renderer,
    'supportsTextureCompression' | 'uploadTextures' | 'waitForIdle'
> {
    on(type: string, listener: EventListener): void;
    off(type: string, listener: EventListener): void;
}

/** Manager construction options. */
export interface AssetManagerOptions {
    readonly budgets?: Readonly<AssetBudgets>;
    /** Resolve relative asset URLs against this location; defaults to document.baseURI. */
    readonly baseURL?: string;
    /** Automatic requestAnimationFrame pumping. Disable when a Stage System calls update(). */
    readonly autoUpdate?: boolean;
    /** Deadline for each fetch/decode operation; defaults to 30 seconds. */
    readonly requestTimeoutMilliseconds?: number;
    /** Inject an alternative decoder; ownership transfers to this manager. */
    readonly decoder?: TextureAssetDecoder;
    /** Fetch implementation for authenticated or application-managed transports. */
    readonly fetch?: typeof fetch;
}

/** Observable reasons an asset has not reached requested quality. */
export type AssetStallReason =
    | 'none'
    | 'hidden'
    | 'cpu-budget'
    | 'in-flight-budget'
    | 'resident-budget'
    | 'upload-budget'
    | 'recovering';

/** Immutable diagnostics for one stable texture identity. */
export interface TextureAssetDiagnostics {
    readonly id: string;
    readonly version: string;
    readonly state:
        'queued' | 'loading' | 'decoded' | 'uploading' | 'resident' | 'failed' | 'evicted';
    readonly requestedMip: number;
    readonly residentMip: number | null;
    readonly residentBytes: number;
    readonly references: number;
    readonly stall: AssetStallReason;
    readonly error: string | null;
}

/** Complete bounded-owner snapshot. Byte counts estimate texel storage, not driver allocation. */
export interface AssetDiagnostics {
    readonly assets: readonly Readonly<TextureAssetDiagnostics>[];
    readonly cpuBytes: number;
    readonly inFlightBytes: number;
    readonly residentBytes: number;
    readonly pendingRetirementBytes: number;
    readonly activeRequests: number;
    readonly uploadBytesLastFrame: number;
    readonly evictions: number;
    readonly cancellations: number;
}

/** Reference-counted claim on a texture; release it when leaving the scene. */
export interface TextureAssetLease {
    /** Stable across quality changes, evictions and device recovery. Do not mutate or destroy it. */
    readonly texture: Texture<Uint8Array>;
    /** Resolves after the initial demand has a completed upload; internally observed if ignored. */
    readonly ready: Promise<void>;
    /** Replace this lease's demand; superseded pending requests reject with AbortError. */
    setDemand(demand: Readonly<TextureAssetDemand>): Promise<void>;
    /** Retry a failed request without changing the public texture identity. */
    retry(): Promise<void>;
    /** Idempotently cancel this claim. The final release retires the texture. */
    release(): void;
}
