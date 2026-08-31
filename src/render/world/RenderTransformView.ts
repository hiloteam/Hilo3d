import math from '../../math/math';
import EulerNotifier from '../../math/EulerNotifier';
import Matrix4 from '../../math/Matrix4';
import Matrix4Notifier from '../../math/Matrix4Notifier';
import type Quaternion from '../../math/Quaternion';
import QuaternionNotifier from '../../math/QuaternionNotifier';
import Vector3 from '../../math/Vector3';
import Vector3Notifier from '../../math/Vector3Notifier';
import { invalidateTransformHistory } from '../../core/TransformHistory';

const DEFAULT_UP = new Vector3(0, 1, 0);
const TEMP_MATRIX = new Matrix4();

/** Parameters used only by renderer-owned transform views. @internal */
export interface RenderTransformViewParameters {
    readonly name?: string;
    readonly x?: number;
    readonly y?: number;
    readonly z?: number;
    readonly scaleX?: number;
    readonly scaleY?: number;
    readonly scaleZ?: number;
    readonly pivotX?: number;
    readonly pivotY?: number;
    readonly pivotZ?: number;
    readonly rotationX?: number;
    readonly rotationY?: number;
    readonly rotationZ?: number;
    readonly visible?: boolean;
    readonly layer?: number;
    readonly sortingLayer?: number;
    readonly zIndex?: number;
}

/**
 * Mutable renderer-local transform view.
 *
 * This is deliberately not an Entity or scene node. It exists for renderer algorithms that need
 * matrices while ECS TransformStore remains the application source of truth.
 * @internal
 */
export default class RenderTransformView {
    id: string;
    readonly up = DEFAULT_UP.clone();
    readonly worldMatrix = new Matrix4();
    protected readonly localMatrix = new Matrix4Notifier();
    protected readonly localPosition = new Vector3Notifier(0, 0, 0);
    protected readonly localScale = new Vector3Notifier(1, 1, 1);
    protected readonly localPivot = new Vector3Notifier(0, 0, 0);
    protected readonly localRotation = new EulerNotifier();
    protected readonly localQuaternion = new QuaternionNotifier();
    name = '';
    visible = true;
    layer = 1;
    sortingLayer = 0;
    zIndex = 0;
    matrixVersion = 0;
    worldMatrixVersion = 0;
    protected localQuaternionDirty = false;
    protected localMatrixDirty = false;

    constructor(typeName: string, parameters: RenderTransformViewParameters = {}) {
        this.id = math.generateUUID(typeName);
        this.localMatrix.onUpdate = (): void => {
            this.matrixVersion++;
            this.localMatrix.decompose(
                this.localQuaternion,
                this.localPosition,
                this.localScale,
                this.localPivot
            );
            this.synchronizeEulerFromQuaternion();
            this.localMatrixDirty = false;
        };
        this.localPosition.onUpdate = (): void => {
            this.localMatrixDirty = true;
        };
        this.localScale.onUpdate = (): void => {
            this.localMatrixDirty = true;
        };
        this.localPivot.onUpdate = (): void => {
            this.localMatrixDirty = true;
        };
        this.localRotation.onUpdate = (): void => {
            this.localQuaternionDirty = true;
            this.localMatrixDirty = true;
        };
        this.localQuaternion.onUpdate = (): void => {
            this.synchronizeEulerFromQuaternion();
            this.localQuaternionDirty = false;
            this.localMatrixDirty = true;
        };
        Object.assign(this, parameters);
    }

    get matrix(): Matrix4Notifier {
        this.updateMatrix();
        return this.localMatrix;
    }

    get position(): Vector3Notifier {
        return this.localPosition;
    }

    get scale(): Vector3Notifier {
        return this.localScale;
    }

    get pivot(): Vector3Notifier {
        return this.localPivot;
    }

    get rotation(): EulerNotifier {
        return this.localRotation;
    }

    get quaternion(): Quaternion {
        if (this.localQuaternionDirty) {
            this.localQuaternionDirty = false;
            this.localQuaternion.fromEuler(this.localRotation, true);
        }
        return this.localQuaternion;
    }

    get x(): number {
        return this.localPosition.x;
    }

    set x(value: number) {
        this.localPosition.x = value;
    }

    get y(): number {
        return this.localPosition.y;
    }

    set y(value: number) {
        this.localPosition.y = value;
    }

    get z(): number {
        return this.localPosition.z;
    }

    set z(value: number) {
        this.localPosition.z = value;
    }

    get scaleX(): number {
        return this.localScale.x;
    }

    set scaleX(value: number) {
        this.localScale.x = value;
    }

    get scaleY(): number {
        return this.localScale.y;
    }

    set scaleY(value: number) {
        this.localScale.y = value;
    }

    get scaleZ(): number {
        return this.localScale.z;
    }

    set scaleZ(value: number) {
        this.localScale.z = value;
    }

    get pivotX(): number {
        return this.localPivot.x;
    }

    set pivotX(value: number) {
        this.localPivot.x = value;
    }

    get pivotY(): number {
        return this.localPivot.y;
    }

    set pivotY(value: number) {
        this.localPivot.y = value;
    }

    get pivotZ(): number {
        return this.localPivot.z;
    }

    set pivotZ(value: number) {
        this.localPivot.z = value;
    }

    get rotationX(): number {
        return this.localRotation.degX;
    }

    set rotationX(value: number) {
        this.localRotation.degX = value;
    }

    get rotationY(): number {
        return this.localRotation.degY;
    }

    set rotationY(value: number) {
        this.localRotation.degY = value;
    }

    get rotationZ(): number {
        return this.localRotation.degZ;
    }

    set rotationZ(value: number) {
        this.localRotation.degZ = value;
    }

    setPosition(x: number, y: number, z: number): this {
        this.localPosition.set(x, y, z);
        return this;
    }

    setScale(x: number, y = x, z = y): this {
        this.localScale.set(x, y, z);
        return this;
    }

    setRotation(x: number, y: number, z: number): this {
        this.localRotation.setDegree(x, y, z);
        return this;
    }

    setPivot(x: number, y: number, z: number): this {
        this.localPivot.set(x, y, z);
        return this;
    }

    lookAt(target: { readonly x: number; readonly y: number; readonly z: number }): this {
        TEMP_MATRIX.targetTo(this.position, target, this.up);
        this.localQuaternion.fromMat4(TEMP_MATRIX);
        return this;
    }

    updateMatrix(): this {
        if (!this.localMatrixDirty) return this;
        this.localMatrixDirty = false;
        this.matrixVersion++;
        this.localMatrix.fromRotationTranslationScaleOrigin(
            this.quaternion,
            this.localPosition,
            this.localScale,
            this.localPivot,
            true
        );
        return this;
    }

    updateTransform(): this {
        this.localMatrix.decompose(
            this.localQuaternion,
            this.localPosition,
            this.localScale,
            this.localPivot
        );
        this.synchronizeEulerFromQuaternion();
        this.localMatrixDirty = false;
        return this;
    }

    updateMatrixWorld(force = false): this {
        if (force || this.localMatrixDirty) {
            this.worldMatrix.copy(this.matrix);
            this.worldMatrixVersion++;
        }
        return this;
    }

    setExtractedWorldMatrix(source: ArrayLike<number>, offset: number, revision: number): void {
        this.worldMatrix.fromArray(source, offset);
        this.worldMatrixVersion = revision;
    }

    invalidateTransformHistory(): this {
        invalidateTransformHistory(this);
        return this;
    }

    private synchronizeEulerFromQuaternion(): void {
        this.localRotation.fromQuat(this.localQuaternion);
    }
}
