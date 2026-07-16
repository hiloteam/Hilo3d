import type Camera from '../camera/Camera';
import type PointLight from './PointLight';

export const POINT_SHADOW_DIRECTIONS = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
] as const;

export const POINT_SHADOW_UPS = [
    [0, -1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
    [0, -1, 0],
    [0, -1, 0]
] as const;

function positiveFinite(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${label} must be a positive finite number`);
    }
    return value;
}

/** Resolve the backend-neutral point-shadow clipping contract without changing cube-face poses. */
export function resolvePointShadowCameraPlanes(
    light: PointLight,
    mainCamera: Camera
): Readonly<{ near: number; far: number }> {
    const cameraNear = positiveFinite(Reflect.get(mainCamera, 'near'), 'Active camera near plane');
    const rawCameraFar: unknown = Reflect.get(mainCamera, 'far');
    const cameraFar =
        rawCameraFar === null
            ? cameraNear * 1000
            : positiveFinite(rawCameraFar, 'Active camera far plane');
    const info = light.shadow?.cameraInfo;
    if (info) {
        const unsupported = Reflect.ownKeys(info).find(key => key !== 'near' && key !== 'far');
        if (unsupported !== undefined) {
            throw new TypeError(
                `Point-light shadow cameraInfo.${String(unsupported)} cannot override the six canonical cube-face cameras`
            );
        }
    }
    const near =
        info?.near === undefined
            ? cameraNear
            : positiveFinite(info.near, 'Point-light shadow near plane');
    const configuredFar =
        info?.far === undefined
            ? light.range > 0
                ? Math.min(light.range, cameraFar)
                : cameraFar
            : positiveFinite(info.far, 'Point-light shadow far plane');
    if (configuredFar <= near) {
        throw new RangeError('Point-light shadow far plane must be greater than its near plane');
    }
    return Object.freeze({ near, far: configuredFar });
}
