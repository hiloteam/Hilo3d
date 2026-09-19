/** Independent DDGI evidence protocol; it does not extend or replace the frozen RHI schema. */
export const DDGI_EVIDENCE_PROTOCOL = 'hilo3d-ddgi-native-evidence-v1';

export type DDGIEvidenceMode = 'enabled' | 'disabled';

/** One real submitted frame. Diagnostic readback is outside the measured record/fence intervals. */
export interface DDGIEvidenceFrame {
    /** Application measurements are sequential even when diagnostic readback adds graph frames. */
    readonly measurementIndex: number;
    readonly frameIndex: number;
    readonly cpuRecordMs: number;
    readonly fenceWaitMs: number;
    readonly timestampReadbackWaitMs: number;
    readonly diagnosticReadbackMs: number;
    readonly graphRecordMs: number;
    readonly graphCompileMs: number;
    readonly graphPrepareMs: number;
    readonly graphExecuteMs: number;
    /** Sum of genuine render/compute pass timestamps, not an end-to-end GPU frame duration. */
    readonly gpuPassTimeSumMs: number;
    readonly gpuPasses: readonly Readonly<{
        name: string;
        kind: 'render' | 'compute' | null;
        cpuDurationMs: number;
        gpuDurationMs: number | null;
    }>[];
    readonly commands: Readonly<{
        draws: number;
        indirectDraws: number;
        dispatches: number;
        uploads: number;
        submissions: number;
    }>;
    readonly dynamicGlobalIllumination: Readonly<{
        probeCount: number;
        updatedProbeCount: number;
        tracedRayCount: number;
        sceneTriangleCount: number;
        excludedMeshCount: number;
        texturedMeshCount: number;
        excludedLightCount: number;
        residentBytes: number;
        uploadedBytes: number;
        sceneUploadedBytes: number;
        submittedFrameCount: number;
    }> | null;
}

/** Present only for the explicit benchmark URL; normal interactive rendering has no diagnostics. */
export interface DDGIEvidenceFixture {
    readonly protocol: typeof DDGI_EVIDENCE_PROTOCOL;
    readonly mode: DDGIEvidenceMode;
    readonly timeOfDay: 'day' | 'night';
    readonly width: number;
    readonly height: number;
    readonly crossOriginIsolated: boolean;
    measureFrame(): Promise<DDGIEvidenceFrame>;
    dispose(): Promise<void>;
}
