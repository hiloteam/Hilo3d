interface HiloEcsExampleStatus {
    readonly backend: 'webgl2' | 'webgpu';
    readonly cameraCount: number;
    readonly renderObjectCount: number;
    readonly lightCount: number;
    readonly worldFrame: number;
    readonly submittedFrameCount: number;
    readonly destroyed: boolean;
}

interface Window {
    readonly __HILO_ECS_STATUS__?: HiloEcsExampleStatus;
}
