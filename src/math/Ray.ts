import Vector3 from './Vector3';
import type Matrix4 from './Matrix4';
import { requireNumber } from './numberArray';

export type Triangle = readonly [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];
export type AxisAlignedBox = readonly [ArrayLike<number>, ArrayLike<number>];

export interface RayParameters {
    origin?: Vector3;
    direction?: Vector3;
}

export interface RayCamera {
    worldMatrix: Matrix4;
    isPerspectiveCamera?: boolean;
    isOrthographicCamera?: boolean;
    near?: number;
    far?: number | null;
    unprojectVector(vector: Vector3, width: number, height: number): Vector3;
}

const TRIANGLE_EPSILON = 1e-6;

function readVector3(value: ArrayLike<number>): readonly [number, number, number] {
    return [requireNumber(value, 0), requireNumber(value, 1), requireNumber(value, 2)];
}

function pointForSort(item: Vector3 | object, pointName?: PropertyKey): Vector3 {
    if (pointName === undefined) {
        if (item instanceof Vector3) return item;
        throw new TypeError('Ray.sortPoints expected Vector3 values.');
    }

    const point: unknown = Reflect.get(item, pointName);
    if (point instanceof Vector3) return point;
    throw new TypeError(`Ray.sortPoints expected "${String(pointName)}" to be a Vector3.`);
}
/**
 * 射线
 * @example
 * ```ts
 * const ray = new Hilo3d.Ray();
 * ray.fromCamera(camera, 10, 10, stage.width, stage.height);
 * ```
 */
class Ray {
    private _origin: Vector3;
    private _direction: Vector3;
    /**
     * 类名
     */
    className = 'Ray';
    /**
     * 是否是射线
     */
    isRay = true;
    /**
     * 原点
     */
    get origin(): Vector3 {
        return this._origin;
    }
    /**
     * 原点
     */
    set origin(value: Vector3) {
        this._origin = value;
    }
    /**
     * 方向
     */
    get direction(): Vector3 {
        return this._direction;
    }
    /**
     * 方向
     */
    set direction(value: Vector3) {
        this._direction = value;
    }
    /**
     * @param params -
     * - `params.origin`: 原点
     * - `params.direction`: 方向
     */
    constructor(params: RayParameters = {}) {
        this._origin = new Vector3();
        this._direction = new Vector3(0, 0, -1);
        this.origin = params.origin ?? new Vector3(0, 0, 0);
        this.direction = params.direction ?? new Vector3(0, 0, -1);
    }
    /**
     * set
     * @param origin -
     * @param direction -
     * @returns this
     */
    set(origin: Vector3, direction: Vector3): this {
        this.origin = origin;
        this.direction = direction;
        return this;
    }
    /**
     * copy
     * @param other -
     */
    copy(other: Ray): this {
        this.origin.copy(other.origin);
        this.direction.copy(other.direction);
        return this;
    }
    /**
     * clone
     */
    clone(): Ray {
        return new Ray({
            origin: this.origin.clone(),
            direction: this.direction.clone()
        });
    }
    /**
     * 从摄像机设置
     * @param camera -
     * @param x - 屏幕x
     * @param y - 屏幕y
     * @param width - 屏幕宽
     * @param height - 屏幕高
     */
    fromCamera(camera: RayCamera, x: number, y: number, width: number, height: number): void {
        if (camera.isPerspectiveCamera) {
            camera.worldMatrix.getTranslation(this.origin);
            this.direction.set(x, y, 0);
            this.direction.copy(camera.unprojectVector(this.direction, width, height));
            this.direction.sub(this.origin).normalize();
        } else if (camera.isOrthographicCamera) {
            const near = camera.near ?? 0;
            const far = camera.far ?? 0;
            this.origin.set(x, y, (near + far) / (near - far));
            this.origin.copy(camera.unprojectVector(this.origin, width, height));
            this.direction.set(0, 0, -1).transformDirection(camera.worldMatrix).normalize();
        }
    }
    /**
     * Transforms the ray with a mat4
     * @param mat4 -
     */
    transformMat4(mat4: Matrix4): void {
        this.origin.transformMat4(mat4);
        this.direction.transformDirection(mat4).normalize();
    }
    /**
     * 排序碰撞点
     * @param points -
     * @param pointName -
     */
    sortPoints(points: (Vector3 | object)[], pointName?: PropertyKey): void {
        points.sort((a, b) => {
            return (
                this.squaredDistance(pointForSort(a, pointName)) -
                this.squaredDistance(pointForSort(b, pointName))
            );
        });
    }
    /**
     * squaredDistance
     * @param point -
     */
    squaredDistance(point: Vector3): number {
        return this.origin.squaredDistance(point);
    }
    /**
     * distance
     * @param point -
     */
    distance(point: Vector3): number {
        return this.origin.distance(point);
    }
    /**
     * intersectsSphere
     * @param center - [x, y, z]
     * @param radius -
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsSphere(center: ArrayLike<number>, radius: number): Vector3 | null {
        const [centerX, centerY, centerZ] = readVector3(center);
        const origin = this.origin;
        const direction = this.direction;
        const toCenterX = centerX - origin.x;
        const toCenterY = centerY - origin.y;
        const toCenterZ = centerZ - origin.z;
        const projectedDistance =
            direction.x * toCenterX + direction.y * toCenterY + direction.z * toCenterZ;

        if (projectedDistance < 0) return null;

        const closestX = origin.x + direction.x * projectedDistance;
        const closestY = origin.y + direction.y * projectedDistance;
        const closestZ = origin.z + direction.z * projectedDistance;
        const deltaX = centerX - closestX;
        const deltaY = centerY - closestY;
        const deltaZ = centerZ - closestZ;
        const squaredDistance = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
        const squaredRadius = radius * radius;

        if (squaredDistance > squaredRadius) return null;

        return this.pointAt(projectedDistance - Math.sqrt(squaredRadius - squaredDistance));
    }
    /**
     * intersectsPlane
     * @param normal - [x, y, z]
     * @param distance -
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsPlane(normal: ArrayLike<number>, distance: number): Vector3 | null {
        const [normalX, normalY, normalZ] = readVector3(normal);
        const origin = this.origin;
        const direction = this.direction;
        const denominator = direction.x * normalX + direction.y * normalY + direction.z * normalZ;
        const originDistance =
            origin.x * normalX + origin.y * normalY + origin.z * normalZ + distance;

        if (denominator !== 0) {
            const rayDistance = -originDistance / denominator;
            return rayDistance < 0 ? null : this.pointAt(rayDistance);
        }

        return originDistance === 0 ? origin.clone() : null;
    }
    /**
     * intersectsTriangle
     * @param triangle - [[a.x, a.y, a.z], [b.x, b.y, b.z],[c.x, c.y, c.z]]
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangle(triangle: Triangle): Vector3 | null {
        const [pointA, pointB, pointC] = triangle;
        const [ax, ay, az] = readVector3(pointA);
        const [bx, by, bz] = readVector3(pointB);
        const [cx, cy, cz] = readVector3(pointC);
        const edge1X = bx - ax;
        const edge1Y = by - ay;
        const edge1Z = bz - az;
        const edge2X = cx - ax;
        const edge2Y = cy - ay;
        const edge2Z = cz - az;
        const direction = this.direction;

        // Möller–Trumbore with the same back-face culling semantics as the
        // historical public API.
        const pX = direction.y * edge2Z - direction.z * edge2Y;
        const pY = direction.z * edge2X - direction.x * edge2Z;
        const pZ = direction.x * edge2Y - direction.y * edge2X;
        const determinant = edge1X * pX + edge1Y * pY + edge1Z * pZ;
        if (determinant < TRIANGLE_EPSILON) return null;

        const origin = this.origin;
        const translatedX = origin.x - ax;
        const translatedY = origin.y - ay;
        const translatedZ = origin.z - az;
        const u = translatedX * pX + translatedY * pY + translatedZ * pZ;
        if (u < 0 || u > determinant) return null;

        const qX = translatedY * edge1Z - translatedZ * edge1Y;
        const qY = translatedZ * edge1X - translatedX * edge1Z;
        const qZ = translatedX * edge1Y - translatedY * edge1X;
        const v = direction.x * qX + direction.y * qY + direction.z * qZ;
        if (v < 0 || u + v > determinant) return null;

        const rayDistance = (edge2X * qX + edge2Y * qY + edge2Z * qZ) / determinant;
        return this.pointAt(rayDistance);
    }
    /**
     * intersectsBox
     * @param aabb - [[min.x, min.y, min.z], [max.x, max.y, max.z]]
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsBox(aabb: AxisAlignedBox): Vector3 | null {
        const [minimum, maximum] = aabb;
        const min = readVector3(minimum);
        const max = readVector3(maximum);
        const origin = this.origin;
        const direction = this.direction;
        const origins = [origin.x, origin.y, origin.z] as const;
        const directions = [direction.x, direction.y, direction.z] as const;
        let lowerDistance = -Infinity;
        let upperDistance = Infinity;

        for (let axis = 0; axis < 3; axis++) {
            const axisOrigin = origins[axis];
            const axisDirection = directions[axis];
            const axisMinimum = min[axis];
            const axisMaximum = max[axis];
            if (
                axisOrigin === undefined ||
                axisDirection === undefined ||
                axisMinimum === undefined ||
                axisMaximum === undefined
            ) {
                throw new RangeError(`Missing axis ${String(axis)} while intersecting an AABB.`);
            }

            let axisLowerDistance = (axisMinimum - axisOrigin) / axisDirection;
            let axisUpperDistance = (axisMaximum - axisOrigin) / axisDirection;
            if (axisLowerDistance > axisUpperDistance) {
                [axisLowerDistance, axisUpperDistance] = [axisUpperDistance, axisLowerDistance];
            }
            if (axisUpperDistance < lowerDistance || axisLowerDistance > upperDistance) return null;
            lowerDistance = Math.max(lowerDistance, axisLowerDistance);
            upperDistance = Math.min(upperDistance, axisUpperDistance);
        }

        return lowerDistance > upperDistance || lowerDistance === Infinity
            ? null
            : this.pointAt(lowerDistance);
    }
    /**
     * intersectsTriangleCell
     * @param cell -
     * @param positions -
     * @returns 碰撞点，如果没有碰撞返回 null
     */
    intersectsTriangleCell(
        cell: readonly [number, number, number],
        positions: readonly ArrayLike<number>[]
    ): Vector3 | null {
        const pointA = positions[cell[0]];
        const pointB = positions[cell[1]];
        const pointC = positions[cell[2]];
        if (!pointA || !pointB || !pointC) {
            throw new RangeError('Triangle cell refers to a missing position.');
        }
        return this.intersectsTriangle([pointA, pointB, pointC]);
    }
    /**
     * _getRes
     */
    private pointAt(distance: number): Vector3 {
        return new Vector3(
            this.origin.x + this.direction.x * distance,
            this.origin.y + this.direction.y * distance,
            this.origin.z + this.direction.z * distance
        );
    }
}
export default Ray;
