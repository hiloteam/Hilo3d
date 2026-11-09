/** Independent SRP protocol; never mutates the enrolled RHI workload or baselines. */
export const SRP_PROTOCOL = Object.freeze({
    version: 1,
    width: 960,
    height: 600,
    warmupFrames: 64,
    sampleFrames: 120,
    allocationFrames: 3,
    rounds: 3,
    continuationPasses: 16
});

export type SRPWorkload = 'default' | 'postprocess' | 'custom';
export type SRPBackend = 'webgl2' | 'webgpu';

export interface SRPFrameSample {
    readonly scheduleCacheHit: boolean;
    readonly cpuMs: number;
    readonly fenceMs: number;
    readonly recordMs: number;
    readonly compileMs: number;
    readonly prepareMs: number;
    readonly executeMs: number;
    readonly gpuPassMs: number | null;
    readonly logicalBytes: number;
    readonly peakLiveBytes: number;
    readonly physicalBytes: number;
    readonly aliasedTextures: number;
    readonly draws: number;
    readonly commands: number;
    readonly passes: number;
    readonly submissions: number;
}

export interface SRPFixture {
    frame(): Promise<SRPFrameSample>;
    render(): void;
    settle(): Promise<void>;
    pixels(): Promise<{ sha256: string; range: number }>;
    destroy(): Promise<void>;
}

declare global {
    interface Window {
        __HILO3D_SRP_BENCHMARK__?: SRPFixture;
    }
}
