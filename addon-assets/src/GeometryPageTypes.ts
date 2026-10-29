import type { MeshletGeometry } from 'hilo3d';

/** Deployment URL for one immutable page from a geometry's manifest. */
export interface GeometryPageSource {
    readonly pageId: number;
    readonly url: string;
}

/** Content identity and complete page URL table; manifest version is a separate schema version. */
export interface GeometryAssetSource {
    readonly id: string;
    readonly version: string;
    readonly pages: readonly Readonly<GeometryPageSource>[];
}

/** Explicit page demand. Visible fine pages also request and pin their group's coarsest page. */
export interface GeometryPageDemand {
    /** Network and CPU decode priority. GPU admission remains a separate renderer policy. */
    readonly priority?: number;
    /** Hidden CPU pages may remain cached. Release unused fine leases to reclaim GPU page slots. */
    readonly visible?: boolean;
}

/** CPU/network limits only. The renderer independently owns GPU residency and upload budgets. */
export interface GeometryPageBudgets {
    /** Simultaneous HTTP reads. Defaults to two, maximum sixteen. */
    readonly concurrentRequests?: number;
    /** Live page records, including automatically requested coarse pages. Defaults to 128. */
    readonly queuedPages?: number;
    /** Maximum encoded bytes in a single page. Defaults to 16 MiB. */
    readonly sourceBytes?: number;
    /** Numeric page payloads plus three page sizes reserved per HTTP/decode job. Defaults to 128 MiB. */
    readonly cpuBytes?: number;
    /** Reserved response/read bytes. Defaults to 64 MiB. */
    readonly inFlightBytes?: number;
    /** Synchronous page decodes admitted per update. Defaults to two. */
    readonly decodesPerUpdate?: number;
    /** Encoded page bytes decoded per update. Defaults to 8 MiB. */
    readonly decodeBytesPerUpdate?: number;
}

/** Construction options for one geometry's CPU page owner. */
export interface GeometryPageManagerOptions {
    readonly budgets?: Readonly<GeometryPageBudgets>;
    readonly baseURL?: string;
    /** Demand-driven requestAnimationFrame updates; disable for application-owned updates. */
    readonly autoUpdate?: boolean;
    /** Deadline for each bounded HTTP read. Defaults to thirty seconds. */
    readonly requestTimeoutMilliseconds?: number;
    /** Alternative transport; it must honor the supplied AbortSignal. Response reads remain bounded. */
    readonly fetch?: typeof fetch;
}

/** Reference-counted demand on a page and its coarse fallback. */
export interface GeometryPageLease {
    readonly geometry: MeshletGeometry;
    readonly pageId: number;
    /** CPU pages are decoded and installed. This does not promise a GPU upload or submission fence. */
    readonly ready: Promise<void>;
    /** Supersedes the previous waiter, which rejects with AbortError while pending. */
    setDemand(demand: Readonly<GeometryPageDemand>): Promise<void>;
    /** Retry this page and a failed coarse fallback without changing geometry identity. */
    retry(): Promise<void>;
    /** Final demand cancellation evicts CPU data that has no remaining owners. Idempotent. */
    release(): void;
}

/** One page's current CPU availability and reason work is waiting. */
export interface GeometryPageDiagnostics {
    readonly pageId: number;
    readonly state: 'queued' | 'loading' | 'fetched' | 'available' | 'failed' | 'evicted';
    readonly references: number;
    readonly visible: boolean;
    readonly coarseFallback: boolean;
    readonly cpuBytes: number;
    readonly stall: 'none' | 'hidden' | 'cpu-budget' | 'in-flight-budget' | 'decode-budget';
    readonly error: string | null;
}

/** Numeric payload estimates exclude JavaScript object/VM overhead and all renderer GPU resources. */
export interface GeometryStreamingDiagnostics {
    readonly id: string;
    readonly version: string;
    readonly pages: readonly Readonly<GeometryPageDiagnostics>[];
    readonly cpuBytes: number;
    readonly inFlightBytes: number;
    readonly activeRequests: number;
    readonly decodedBytesLastUpdate: number;
    readonly evictions: number;
    readonly cancellations: number;
}
