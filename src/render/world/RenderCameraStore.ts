import type Camera from '../../camera/Camera';
import OrthographicCameraView from '../../camera/OrthographicCamera';
import PerspectiveCameraView from '../../camera/PerspectiveCamera';
import type { TransformStore } from '../../scene/components/Transform';
import type {
    CameraOutputValue,
    OrthographicCameraValue,
    PerspectiveCameraValue
} from '../../scene/components/Rendering';

const ABSENT_DENSE_INDEX = -1;
const MIN_CAMERA_CAPACITY = 4;
const PERSPECTIVE_CAMERA = 1;
const ORTHOGRAPHIC_CAMERA = 2;

function createSparseIndex(capacity: number): Int32Array {
    const values = new Int32Array(capacity);
    values.fill(ABSENT_DENSE_INDEX);
    return values;
}

/** Dense renderer-local Camera views extracted from ECS camera components. */
export class RenderCameraStore {
    private sparse: Int32Array;
    private entityIndices: Uint32Array;
    private cameraKinds: Uint8Array;
    private outputEnabled: Uint8Array;
    private cameraViews: (Camera | null)[];
    private entryCount = 0;
    private currentRevision = 0;

    constructor(initialEntityCapacity = 0, initialCameraCapacity = 0) {
        this.sparse = createSparseIndex(initialEntityCapacity);
        this.entityIndices = new Uint32Array(initialCameraCapacity);
        this.cameraKinds = new Uint8Array(initialCameraCapacity);
        this.outputEnabled = new Uint8Array(initialCameraCapacity);
        this.cameraViews = new Array<Camera | null>(initialCameraCapacity).fill(null);
    }

    get length(): number {
        return this.entryCount;
    }

    get cameras(): readonly (Camera | null)[] {
        return this.cameraViews;
    }

    get revision(): number {
        return this.currentRevision;
    }

    get entities(): Uint32Array {
        return this.entityIndices;
    }

    isOutputEnabled(denseIndex: number): boolean {
        this.requireDenseRange(denseIndex);
        return this.outputEnabled[denseIndex] === 1;
    }

    ensureEntityCapacity(capacity: number): void {
        if (capacity <= this.sparse.length) return;
        const sparse = createSparseIndex(capacity);
        sparse.set(this.sparse);
        this.sparse = sparse;
    }

    has(entityIndex: number): boolean {
        return (
            entityIndex >= 0 &&
            entityIndex < this.sparse.length &&
            this.sparse[entityIndex] !== ABSENT_DENSE_INDEX
        );
    }

    get(entityIndex: number): Camera {
        const denseIndex = this.requireDenseIndex(entityIndex);
        const camera = this.cameraViews[denseIndex];
        if (!camera) throw new Error('Render camera view is missing.');
        return camera;
    }

    synchronize(
        entityIndex: number,
        perspective: PerspectiveCameraValue | undefined,
        orthographic: OrthographicCameraValue | undefined,
        output: CameraOutputValue | undefined,
        transforms: TransformStore
    ): void {
        if (perspective !== undefined && orthographic !== undefined) {
            throw new TypeError(
                `Entity index ${String(entityIndex)} cannot have both camera projection components.`
            );
        }
        if (perspective === undefined && orthographic === undefined) {
            this.remove(entityIndex);
            return;
        }
        const kind = perspective === undefined ? ORTHOGRAPHIC_CAMERA : PERSPECTIVE_CAMERA;
        let denseIndex: number;
        if (this.has(entityIndex)) {
            denseIndex = this.requireDenseIndex(entityIndex);
            if (this.cameraKinds[denseIndex] !== kind) {
                this.cameraViews[denseIndex] = this.createCamera(kind);
                this.cameraKinds[denseIndex] = kind;
            }
        } else {
            this.ensureEntityCapacity(entityIndex + 1);
            this.ensureDenseCapacity(this.entryCount + 1);
            denseIndex = this.entryCount;
            this.entryCount++;
            this.sparse[entityIndex] = denseIndex;
            this.entityIndices[denseIndex] = entityIndex;
            this.cameraKinds[denseIndex] = kind;
            this.cameraViews[denseIndex] = this.createCamera(kind);
        }
        if (perspective !== undefined) this.writePerspective(denseIndex, perspective);
        else if (orthographic !== undefined) this.writeOrthographic(denseIndex, orthographic);
        this.outputEnabled[denseIndex] = output?.enabled === false ? 0 : 1;
        this.updateTransform(entityIndex, transforms);
        this.currentRevision++;
    }

    updateProjection(
        entityIndex: number,
        perspective: PerspectiveCameraValue | undefined,
        orthographic: OrthographicCameraValue | undefined
    ): void {
        if (!this.has(entityIndex)) return;
        const denseIndex = this.requireDenseIndex(entityIndex);
        if (perspective !== undefined) this.writePerspective(denseIndex, perspective);
        else if (orthographic !== undefined) this.writeOrthographic(denseIndex, orthographic);
        this.currentRevision++;
    }

    updateOutput(entityIndex: number, output: CameraOutputValue | undefined): void {
        if (!this.has(entityIndex)) return;
        this.outputEnabled[this.requireDenseIndex(entityIndex)] = output?.enabled === false ? 0 : 1;
        this.currentRevision++;
    }

    updateTransform(entityIndex: number, transforms: TransformStore): void {
        if (!this.has(entityIndex) || !transforms.has(entityIndex)) return;
        const camera = this.get(entityIndex);
        const denseTransformIndex = transforms.denseIndexOf(entityIndex);
        camera.setExtractedWorldMatrix(
            transforms.worldMatrixData,
            denseTransformIndex * 16,
            transforms.worldRevisionOf(entityIndex)
        );
        camera.updateViewProjectionMatrix();
    }

    remove(entityIndex: number): boolean {
        if (!this.has(entityIndex)) return false;
        const denseIndex = this.requireDenseIndex(entityIndex);
        const lastDenseIndex = this.entryCount - 1;
        if (denseIndex !== lastDenseIndex) {
            const movedEntity = this.entityIndices[lastDenseIndex] ?? 0;
            this.entityIndices[denseIndex] = movedEntity;
            this.cameraKinds[denseIndex] = this.cameraKinds[lastDenseIndex] ?? 0;
            this.outputEnabled[denseIndex] = this.outputEnabled[lastDenseIndex] ?? 0;
            this.cameraViews[denseIndex] = this.cameraViews[lastDenseIndex] ?? null;
            this.sparse[movedEntity] = denseIndex;
        }
        this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
        this.entityIndices[lastDenseIndex] = 0;
        this.cameraKinds[lastDenseIndex] = 0;
        this.outputEnabled[lastDenseIndex] = 0;
        this.cameraViews[lastDenseIndex] = null;
        this.entryCount--;
        this.currentRevision++;
        return true;
    }

    clear(): void {
        this.sparse.fill(ABSENT_DENSE_INDEX);
        this.entityIndices.fill(0);
        this.cameraKinds.fill(0);
        this.outputEnabled.fill(0);
        this.cameraViews.fill(null);
        this.entryCount = 0;
        this.currentRevision++;
    }

    private writePerspective(denseIndex: number, value: PerspectiveCameraValue): void {
        const camera = this.requireCameraKind(denseIndex, PERSPECTIVE_CAMERA);
        if (!(camera instanceof PerspectiveCameraView)) {
            throw new TypeError('Perspective render camera has an invalid view type.');
        }
        this.writeCommon(camera, value);
        camera.fov = value.fov ?? 50;
        camera.near = value.near ?? 0.1;
        camera.far = value.far ?? null;
        camera.aspect = value.aspect ?? 1;
        camera.updateProjectionMatrix();
    }

    private writeOrthographic(denseIndex: number, value: OrthographicCameraValue): void {
        const camera = this.requireCameraKind(denseIndex, ORTHOGRAPHIC_CAMERA);
        if (!(camera instanceof OrthographicCameraView)) {
            throw new TypeError('Orthographic render camera has an invalid view type.');
        }
        this.writeCommon(camera, value);
        camera.left = value.left ?? -1;
        camera.right = value.right ?? 1;
        camera.top = value.top ?? 1;
        camera.bottom = value.bottom ?? -1;
        camera.near = value.near ?? 0.1;
        camera.far = value.far ?? 1000;
        camera.updateProjectionMatrix();
    }

    private writeCommon(
        camera: Camera,
        value: PerspectiveCameraValue | OrthographicCameraValue
    ): void {
        camera.depthMode = value.depthMode ?? 'standard';
        camera.visibility = value.visibility ?? 0xffffffff;
        camera.clearColor = value.clearColor ?? true;
        camera.clearDepth = value.clearDepth ?? true;
        camera.clearStencil = value.clearStencil ?? true;
        camera.priority = value.priority ?? 0;
    }

    private createCamera(kind: number): Camera {
        return kind === PERSPECTIVE_CAMERA
            ? new PerspectiveCameraView()
            : new OrthographicCameraView();
    }

    private requireCameraKind(denseIndex: number, kind: number): Camera {
        this.requireDenseRange(denseIndex);
        if (this.cameraKinds[denseIndex] !== kind) {
            throw new TypeError('Render camera projection kind does not match its component.');
        }
        const camera = this.cameraViews[denseIndex];
        if (!camera) throw new Error('Render camera view is missing.');
        return camera;
    }

    private requireDenseIndex(entityIndex: number): number {
        if (!this.has(entityIndex)) {
            throw new ReferenceError(
                `Entity index ${String(entityIndex)} has no extracted Camera.`
            );
        }
        return this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
    }

    private requireDenseRange(denseIndex: number): void {
        if (denseIndex < 0 || denseIndex >= this.entryCount) {
            throw new RangeError(
                `Render camera dense index ${String(denseIndex)} is out of range.`
            );
        }
    }

    private ensureDenseCapacity(required: number): void {
        if (required <= this.entityIndices.length) return;
        let capacity = Math.max(this.entityIndices.length, MIN_CAMERA_CAPACITY);
        while (capacity < required) capacity *= 2;
        const entities = new Uint32Array(capacity);
        entities.set(this.entityIndices);
        this.entityIndices = entities;
        const kinds = new Uint8Array(capacity);
        kinds.set(this.cameraKinds);
        this.cameraKinds = kinds;
        const outputs = new Uint8Array(capacity);
        outputs.set(this.outputEnabled);
        this.outputEnabled = outputs;
        this.cameraViews.length = capacity;
    }
}
