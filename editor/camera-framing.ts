import { Vector3, type Bounds } from '../src/Hilo3d';

export interface EditorCameraFrame {
    readonly position: Vector3;
    readonly target: Vector3;
    readonly radius: number;
    readonly distance: number;
    readonly minDistance: number;
    readonly maxDistance: number;
}

/** Clip only the editor camera; authored scene camera descriptors remain authoritative. */
export function editorCameraClipRange(
    distance: number,
    radius: number,
    maxDistance: number
): { near: number; far: number } {
    const frontClearance = Math.max(distance - radius, distance * 1e-6);
    return {
        near: Math.max(1e-7, Math.min(distance * 0.001, frontClearance * 0.1)),
        far: Math.max(180, maxDistance + radius * 2)
    };
}

/** Fit all eight world bounds corners inside both perspective axes with 10% padding. */
export function frameEditorBounds(
    bounds: Bounds,
    offset: Vector3,
    fov: number,
    aspect: number
): EditorCameraFrame {
    const values = [
        bounds.xMin,
        bounds.xMax,
        bounds.yMin,
        bounds.yMax,
        bounds.zMin,
        bounds.zMax,
        fov,
        aspect
    ];
    if (!values.every(Number.isFinite) || fov <= 0 || fov >= 180 || aspect <= 0)
        throw new RangeError('Cannot frame non-finite bounds or an invalid camera.');
    const width = bounds.xMax - bounds.xMin;
    const height = bounds.yMax - bounds.yMin;
    const depth = bounds.zMax - bounds.zMin;
    if (width < 0 || height < 0 || depth < 0)
        throw new RangeError('Cannot frame inverted geometry bounds.');
    const target = new Vector3(
        bounds.xMin + width / 2,
        bounds.yMin + height / 2,
        bounds.zMin + depth / 2
    );
    const direction = offset.clone();
    if (direction.length() < 1e-6) direction.set(1, 0.7, 1);
    direction.normalize();
    const right = new Vector3(0, 1, 0).cross(direction);
    if (right.length() < 1e-7) right.set(1, 0, 0).cross(direction);
    right.normalize();
    const up = direction.clone().cross(right).normalize();
    const tanY = Math.tan((fov * Math.PI) / 360);
    const tanX = tanY * aspect;
    let distance = 1e-4;
    let frontDepth = 0;
    const corner = new Vector3();
    for (const x of [-width / 2, width / 2]) {
        for (const y of [-height / 2, height / 2]) {
            for (const z of [-depth / 2, depth / 2]) {
                corner.set(x, y, z);
                const towardCamera = corner.dot(direction);
                frontDepth = Math.max(frontDepth, towardCamera);
                distance = Math.max(
                    distance,
                    towardCamera +
                        1.1 *
                            Math.max(
                                Math.abs(corner.dot(right)) / tanX,
                                Math.abs(corner.dot(up)) / tanY
                            )
                );
            }
        }
    }
    const radius = Math.hypot(width, height, depth) / 2;
    distance = Math.max(distance, frontDepth + Math.max(radius * 1e-3, 1e-5));
    const maxDistance = Math.max(100, distance * 4);
    const position = direction.scale(distance).add(target);
    if (![position.x, position.y, position.z, radius, distance, maxDistance].every(Number.isFinite))
        throw new RangeError('Geometry bounds exceed the finite editor camera range.');
    return {
        position,
        target,
        radius,
        distance,
        minDistance: Math.max(1e-6, Math.min(0.2, distance * 0.01)),
        maxDistance
    };
}
