/** Native object categories shared by concrete and legacy RHI diagnostics bridges. */
export type RHIDiagnosticNativeObjectKind =
    | 'buffer'
    | 'texture'
    | 'textureView'
    | 'sampler'
    | 'shaderModule'
    | 'program'
    | 'pipeline'
    | 'bindGroupLayout'
    | 'pipelineLayout'
    | 'bindGroup'
    | 'framebuffer'
    | 'renderbuffer'
    | 'vertexArray'
    | 'commandEncoder'
    | 'commandBuffer';

/** Cache categories shared by concrete and legacy RHI diagnostics bridges. */
export type RHIDiagnosticCacheKind =
    | 'buffer'
    | 'texture'
    | 'sampler'
    | 'program'
    | 'pipeline'
    | 'bindGroupLayout'
    | 'pipelineLayout'
    | 'bindGroup'
    | 'framebuffer'
    | 'vertexArray';

export interface RHIDiagnosticCacheCounters {
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
    readonly size: number;
    readonly highWater: number;
}

/**
 * Backend-neutral, allocation-free sink consumed by RHI implementations.
 *
 * It deliberately lives at the RHI boundary and has no dependency on RendererCore. Backends use
 * creation-only and partial-cache methods when their native API cannot expose complete lifetime
 * or cache outcome information.
 */
export interface RHIDiagnosticsSink {
    /** Complete lifetime accounting for native APIs with an observable destroy boundary. */
    recordNativeObjectCreated(kind: RHIDiagnosticNativeObjectKind, count?: number): void;
    recordNativeObjectDestroyed(kind: RHIDiagnosticNativeObjectKind, count?: number): void;
    /** Creation-only accounting for native objects whose API exposes no destroy operation. */
    recordNativeObjectCreatedOnly(kind: RHIDiagnosticNativeObjectKind, count?: number): void;
    markCacheUnavailable(kind: RHIDiagnosticCacheKind): void;
    markCacheHitOnly(kind: RHIDiagnosticCacheKind): void;
    recordCacheHit(kind: RHIDiagnosticCacheKind, count?: number): void;
    synchronizeCache(
        kind: RHIDiagnosticCacheKind,
        counters: Readonly<RHIDiagnosticCacheCounters>
    ): void;
    recordDraw(count?: number): void;
    recordPass(count?: number): void;
    recordStateChange(count?: number): void;
    recordUpload(count?: number): void;
    recordSubmission(count?: number): void;
}
