import type Camera from '../../camera/Camera';

const singleSampleCameras = new WeakSet<Camera>();

/**
 * Mark a Camera that must share the persistent single-sample surface depth/stencil attachment.
 * @internal
 */
export function setCameraCompositionSingleSample(camera: Camera, enabled: boolean): void {
    if (enabled) singleSampleCameras.add(camera);
    else singleSampleCameras.delete(camera);
}

/** @internal */
export function cameraCompositionRequiresSingleSample(camera: Camera): boolean {
    return singleSampleCameras.has(camera);
}
