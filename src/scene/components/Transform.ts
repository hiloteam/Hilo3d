import {
    type ComponentStore,
    defineComponent,
    defineDerivedComponent,
    SparseSetComponentStore
} from '../../ecs/Component';
import type { Entity } from '../../ecs/Entity';
import type World from '../../ecs/World';

const ABSENT_DENSE_INDEX = -1;
const NO_ENTITY_INDEX = -1;
const MIN_DENSE_CAPACITY = 16;
const MATRIX_ELEMENT_COUNT = 16;

function quaternionLength(x: number, y: number, z: number, w: number): number {
    let scale = Math.abs(x);
    const absoluteY = Math.abs(y);
    const absoluteZ = Math.abs(z);
    const absoluteW = Math.abs(w);
    if (absoluteY > scale) scale = absoluteY;
    if (absoluteZ > scale) scale = absoluteZ;
    if (absoluteW > scale) scale = absoluteW;
    if (scale === 0) return 0;
    const normalizedX = x / scale;
    const normalizedY = y / scale;
    const normalizedZ = z / scale;
    const normalizedW = w / scale;
    return (
        scale *
        Math.sqrt(
            normalizedX * normalizedX +
                normalizedY * normalizedY +
                normalizedZ * normalizedZ +
                normalizedW * normalizedW
        )
    );
}

/** Three finite scalar values used by transform component input. */
export type TransformVector3 = readonly [number, number, number];

/** A finite, non-zero quaternion. Values are normalized when written. */
export type TransformQuaternion = readonly [number, number, number, number];

/** Authored local transform data. Omitted fields use identity defaults. */
export interface LocalTransformValue {
    readonly position?: TransformVector3;
    readonly rotation?: TransformQuaternion;
    readonly scale?: TransformVector3;
}

/** Authored parent relationship. A null parent makes the Entity a transform root. */
export interface HierarchyValue {
    readonly parent: Entity | null;
}

/** Cold-path snapshot returned when reading the derived WorldTransform component. */
export interface WorldTransformValue {
    readonly matrix: Float32Array;
    readonly previousMatrix: Float32Array;
    readonly revision: number;
    readonly historyValid: boolean;
}

/** Previous/current fixed-step pose consumed by TransformSystem for visual interpolation. */
export interface InterpolatedTransformValue {
    readonly previousPosition: TransformVector3;
    readonly previousRotation: TransformQuaternion;
    readonly currentPosition: TransformVector3;
    readonly currentRotation: TransformQuaternion;
}

/** Diagnostics proving whether transform work stays proportional to the dirty subtree. */
export interface TransformDiagnostics {
    readonly transformCount: number;
    readonly queuedDirtyCount: number;
    readonly updatedWorldMatrixCount: number;
    readonly totalWorldMatrixUpdateCount: number;
    readonly hierarchyRevision: number;
}

/** Counters for the most recently applied hierarchy relationship batch. */
export interface HierarchyDiagnostics {
    /** Authored relationships consumed by the most recent synchronization. */
    readonly appliedRelationshipCount: number;
    /** Unique graph nodes visited while validating that relationship batch. */
    readonly validationVisitCount: number;
}

function validateCapacity(capacity: number): number {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
        throw new RangeError('Transform store capacity must be a non-negative safe integer.');
    }
    return capacity;
}

function createSparseIndex(capacity: number): Int32Array {
    const values = new Int32Array(capacity);
    values.fill(ABSENT_DENSE_INDEX);
    return values;
}

function createRelationshipIndex(capacity: number): Int32Array {
    const values = new Int32Array(capacity);
    values.fill(NO_ENTITY_INDEX);
    return values;
}

function growFloat32(source: Float32Array, capacity: number): Float32Array {
    const values = new Float32Array(capacity);
    values.set(source);
    return values;
}

function growUint32(source: Uint32Array, capacity: number): Uint32Array {
    const values = new Uint32Array(capacity);
    values.set(source);
    return values;
}

function growUint8(source: Uint8Array, capacity: number): Uint8Array {
    const values = new Uint8Array(capacity);
    values.set(source);
    return values;
}

function growRelationship(source: Int32Array, capacity: number): Int32Array {
    const values = createRelationshipIndex(capacity);
    values.set(source);
    return values;
}

function nextRevision(revision: number): number {
    return revision === 0xffffffff ? 1 : revision + 1;
}

function requireFinite(value: number, label: string): number {
    if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite.`);
    return value;
}

function component(value: readonly number[] | undefined, index: number, fallback: number): number {
    return requireFinite(value?.[index] ?? fallback, `Transform component ${String(index)}`);
}

function copyMatrix(
    source: Float32Array,
    sourceOffset: number,
    target: Float32Array,
    targetOffset: number
): void {
    for (let index = 0; index < MATRIX_ELEMENT_COUNT; index++) {
        target[targetOffset + index] = source[sourceOffset + index] ?? 0;
    }
}

function multiplyMatrix(
    target: Float32Array,
    targetOffset: number,
    left: Float32Array,
    leftOffset: number,
    right: Float32Array,
    rightOffset: number
): void {
    const a00 = left[leftOffset] ?? 0;
    const a01 = left[leftOffset + 1] ?? 0;
    const a02 = left[leftOffset + 2] ?? 0;
    const a03 = left[leftOffset + 3] ?? 0;
    const a10 = left[leftOffset + 4] ?? 0;
    const a11 = left[leftOffset + 5] ?? 0;
    const a12 = left[leftOffset + 6] ?? 0;
    const a13 = left[leftOffset + 7] ?? 0;
    const a20 = left[leftOffset + 8] ?? 0;
    const a21 = left[leftOffset + 9] ?? 0;
    const a22 = left[leftOffset + 10] ?? 0;
    const a23 = left[leftOffset + 11] ?? 0;
    const a30 = left[leftOffset + 12] ?? 0;
    const a31 = left[leftOffset + 13] ?? 0;
    const a32 = left[leftOffset + 14] ?? 0;
    const a33 = left[leftOffset + 15] ?? 0;

    let b0 = right[rightOffset] ?? 0;
    let b1 = right[rightOffset + 1] ?? 0;
    let b2 = right[rightOffset + 2] ?? 0;
    let b3 = right[rightOffset + 3] ?? 0;
    target[targetOffset] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    target[targetOffset + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    target[targetOffset + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    target[targetOffset + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = right[rightOffset + 4] ?? 0;
    b1 = right[rightOffset + 5] ?? 0;
    b2 = right[rightOffset + 6] ?? 0;
    b3 = right[rightOffset + 7] ?? 0;
    target[targetOffset + 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    target[targetOffset + 5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    target[targetOffset + 6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    target[targetOffset + 7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = right[rightOffset + 8] ?? 0;
    b1 = right[rightOffset + 9] ?? 0;
    b2 = right[rightOffset + 10] ?? 0;
    b3 = right[rightOffset + 11] ?? 0;
    target[targetOffset + 8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    target[targetOffset + 9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    target[targetOffset + 10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    target[targetOffset + 11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = right[rightOffset + 12] ?? 0;
    b1 = right[rightOffset + 13] ?? 0;
    b2 = right[rightOffset + 14] ?? 0;
    b3 = right[rightOffset + 15] ?? 0;
    target[targetOffset + 12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    target[targetOffset + 13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    target[targetOffset + 14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    target[targetOffset + 15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
}

/** SoA storage for authored local TRS and derived current/previous world matrices. */
export class TransformStore implements ComponentStore<LocalTransformValue> {
    private sparse: Int32Array;
    private denseEntities: Uint32Array;
    private positionData: Float32Array;
    private rotationData: Float32Array;
    private scaleData: Float32Array;
    private localMatrices: Float32Array;
    private worldMatrices: Float32Array;
    private previousWorldMatrices: Float32Array;
    private localEntryRevisions: Uint32Array;
    private worldEntryRevisions: Uint32Array;
    private parentIndices: Int32Array;
    private firstChildIndices: Int32Array;
    private nextSiblingIndices: Int32Array;
    private previousSiblingIndices: Int32Array;
    private localDirty: Uint8Array;
    private worldDirty: Uint8Array;
    private dirtyQueued: Uint8Array;
    private historyValid: Uint8Array;
    private historyQueued: Uint8Array;
    private detachedQueued: Uint8Array;
    private worldChangedQueued: Uint8Array;
    private dirtyEntities: Uint32Array;
    private dirtyRoots: Uint32Array;
    private traversalStack: Uint32Array;
    private historyEntities: Uint32Array;
    private detachedEntities: Uint32Array;
    private worldChangedEntities: Uint32Array;
    private entryCount = 0;
    private dirtyCount = 0;
    private historyCount = 0;
    private detachedCount = 0;
    private worldChangedCount = 0;
    private currentStructureRevision = 0;
    private currentDataRevision = 0;
    private currentWorldDataRevision = 0;
    private currentHierarchyRevision = 0;
    private lastWorldMatrixUpdateCount = 0;
    private totalWorldMatrixUpdateCount = 0;

    constructor(initialEntityCapacity = 0, initialDenseCapacity = initialEntityCapacity) {
        const entityCapacity = validateCapacity(initialEntityCapacity);
        const denseCapacity = validateCapacity(initialDenseCapacity);
        this.sparse = createSparseIndex(entityCapacity);
        this.denseEntities = new Uint32Array(denseCapacity);
        this.positionData = new Float32Array(denseCapacity * 3);
        this.rotationData = new Float32Array(denseCapacity * 4);
        this.scaleData = new Float32Array(denseCapacity * 3);
        this.localMatrices = new Float32Array(denseCapacity * MATRIX_ELEMENT_COUNT);
        this.worldMatrices = new Float32Array(denseCapacity * MATRIX_ELEMENT_COUNT);
        this.previousWorldMatrices = new Float32Array(denseCapacity * MATRIX_ELEMENT_COUNT);
        this.localEntryRevisions = new Uint32Array(denseCapacity);
        this.worldEntryRevisions = new Uint32Array(denseCapacity);
        this.parentIndices = createRelationshipIndex(entityCapacity);
        this.firstChildIndices = createRelationshipIndex(entityCapacity);
        this.nextSiblingIndices = createRelationshipIndex(entityCapacity);
        this.previousSiblingIndices = createRelationshipIndex(entityCapacity);
        this.localDirty = new Uint8Array(entityCapacity);
        this.worldDirty = new Uint8Array(entityCapacity);
        this.dirtyQueued = new Uint8Array(entityCapacity);
        this.historyValid = new Uint8Array(entityCapacity);
        this.historyQueued = new Uint8Array(entityCapacity);
        this.detachedQueued = new Uint8Array(entityCapacity);
        this.worldChangedQueued = new Uint8Array(entityCapacity);
        this.dirtyEntities = new Uint32Array(entityCapacity);
        this.dirtyRoots = new Uint32Array(entityCapacity);
        this.traversalStack = new Uint32Array(entityCapacity);
        this.historyEntities = new Uint32Array(entityCapacity);
        this.detachedEntities = new Uint32Array(entityCapacity);
        this.worldChangedEntities = new Uint32Array(entityCapacity);
    }

    get length(): number {
        return this.entryCount;
    }

    get entityCapacity(): number {
        return this.sparse.length;
    }

    get entityIndices(): Uint32Array {
        return this.denseEntities;
    }

    get structureRevision(): number {
        return this.currentStructureRevision;
    }

    get dataRevision(): number {
        return this.currentDataRevision;
    }

    /** Monotonic revision of derived world-matrix changes. */
    get worldDataRevision(): number {
        return this.currentWorldDataRevision;
    }

    /** Packed current matrices indexed by dense transform index. */
    get worldMatrixData(): Float32Array {
        return this.worldMatrices;
    }

    /** Packed previous-submission matrices indexed by dense transform index. */
    get previousWorldMatrixData(): Float32Array {
        return this.previousWorldMatrices;
    }

    /** Dirty Entity indices awaiting the single render-extraction consumer. */
    get changedWorldEntityIndices(): Uint32Array {
        return this.worldChangedEntities;
    }

    /** Number of valid entries in changedWorldEntityIndices. */
    get changedWorldEntityCount(): number {
        return this.worldChangedCount;
    }

    ensureEntityCapacity(capacity: number): void {
        const validated = validateCapacity(capacity);
        if (validated <= this.sparse.length) return;
        const sparse = createSparseIndex(validated);
        sparse.set(this.sparse);
        this.sparse = sparse;
        this.parentIndices = growRelationship(this.parentIndices, validated);
        this.firstChildIndices = growRelationship(this.firstChildIndices, validated);
        this.nextSiblingIndices = growRelationship(this.nextSiblingIndices, validated);
        this.previousSiblingIndices = growRelationship(this.previousSiblingIndices, validated);
        this.localDirty = growUint8(this.localDirty, validated);
        this.worldDirty = growUint8(this.worldDirty, validated);
        this.dirtyQueued = growUint8(this.dirtyQueued, validated);
        this.historyValid = growUint8(this.historyValid, validated);
        this.historyQueued = growUint8(this.historyQueued, validated);
        this.detachedQueued = growUint8(this.detachedQueued, validated);
        this.worldChangedQueued = growUint8(this.worldChangedQueued, validated);
        this.dirtyEntities = growUint32(this.dirtyEntities, validated);
        this.dirtyRoots = growUint32(this.dirtyRoots, validated);
        this.traversalStack = growUint32(this.traversalStack, validated);
        this.historyEntities = growUint32(this.historyEntities, validated);
        this.detachedEntities = growUint32(this.detachedEntities, validated);
        this.worldChangedEntities = growUint32(this.worldChangedEntities, validated);
    }

    has(entityIndex: number): boolean {
        return (
            Number.isSafeInteger(entityIndex) &&
            entityIndex >= 0 &&
            entityIndex < this.sparse.length &&
            this.sparse[entityIndex] !== ABSENT_DENSE_INDEX
        );
    }

    get(entityIndex: number): LocalTransformValue {
        return this.getByDenseIndex(this.requireDenseIndex(entityIndex));
    }

    getByDenseIndex(denseIndex: number): LocalTransformValue {
        this.requireDenseRange(denseIndex);
        const positionOffset = denseIndex * 3;
        const rotationOffset = denseIndex * 4;
        return {
            position: [
                this.positionData[positionOffset] ?? 0,
                this.positionData[positionOffset + 1] ?? 0,
                this.positionData[positionOffset + 2] ?? 0
            ],
            rotation: [
                this.rotationData[rotationOffset] ?? 0,
                this.rotationData[rotationOffset + 1] ?? 0,
                this.rotationData[rotationOffset + 2] ?? 0,
                this.rotationData[rotationOffset + 3] ?? 1
            ],
            scale: [
                this.scaleData[positionOffset] ?? 1,
                this.scaleData[positionOffset + 1] ?? 1,
                this.scaleData[positionOffset + 2] ?? 1
            ]
        };
    }

    getEntryRevision(entityIndex: number): number {
        return this.localEntryRevisions[this.requireDenseIndex(entityIndex)] ?? 0;
    }

    validate(value: LocalTransformValue): void {
        component(value.position, 0, 0);
        component(value.position, 1, 0);
        component(value.position, 2, 0);
        const x = component(value.rotation, 0, 0);
        const y = component(value.rotation, 1, 0);
        const z = component(value.rotation, 2, 0);
        const w = component(value.rotation, 3, 1);
        if (quaternionLength(x, y, z, w) === 0) {
            throw new RangeError('Transform rotation quaternion cannot be zero.');
        }
        component(value.scale, 0, 1);
        component(value.scale, 1, 1);
        component(value.scale, 2, 1);
    }

    /** Resolve the dense SoA row for a live transform Entity. */
    denseIndexOf(entityIndex: number): number {
        return this.requireDenseIndex(entityIndex);
    }

    /** Read the applied parent index without materializing an object. */
    parentIndexOf(entityIndex: number): number {
        this.requireDenseIndex(entityIndex);
        return this.parentIndices[entityIndex] ?? NO_ENTITY_INDEX;
    }

    /** Read one derived matrix revision without materializing a transform snapshot. */
    worldRevisionOf(entityIndex: number): number {
        return this.worldEntryRevisions[this.requireDenseIndex(entityIndex)] ?? 0;
    }

    /** Whether previousWorldMatrixData contains a submitted transform for this Entity. */
    isHistoryValid(entityIndex: number): boolean {
        this.requireDenseIndex(entityIndex);
        return this.historyValid[entityIndex] === 1;
    }

    add(entityIndex: number, value: LocalTransformValue): void {
        this.requireEntityIndexInCapacity(entityIndex);
        if (this.has(entityIndex)) {
            throw new TypeError(`Entity index ${String(entityIndex)} already has LocalTransform.`);
        }
        this.validate(value);
        this.ensureDenseCapacity(this.entryCount + 1);
        const denseIndex = this.entryCount;
        this.entryCount++;
        this.sparse[entityIndex] = denseIndex;
        this.denseEntities[denseIndex] = entityIndex;
        this.writeTRS(denseIndex, value);
        this.localEntryRevisions[denseIndex] = 1;
        this.worldEntryRevisions[denseIndex] = 0;
        this.parentIndices[entityIndex] = NO_ENTITY_INDEX;
        this.firstChildIndices[entityIndex] = NO_ENTITY_INDEX;
        this.nextSiblingIndices[entityIndex] = NO_ENTITY_INDEX;
        this.previousSiblingIndices[entityIndex] = NO_ENTITY_INDEX;
        this.localDirty[entityIndex] = 1;
        this.historyValid[entityIndex] = 0;
        this.currentStructureRevision++;
        this.currentDataRevision++;
        this.markWorldSubtreeDirty(entityIndex);
    }

    set(entityIndex: number, value: LocalTransformValue): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        this.validate(value);
        this.writeTRS(denseIndex, value);
        this.markLocalDirty(entityIndex, denseIndex);
    }

    /** Write position directly from a hot System without allocating a component object. */
    setPosition(entityIndex: number, x: number, y: number, z: number): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        const offset = denseIndex * 3;
        this.positionData[offset] = requireFinite(x, 'Transform position x');
        this.positionData[offset + 1] = requireFinite(y, 'Transform position y');
        this.positionData[offset + 2] = requireFinite(z, 'Transform position z');
        this.markLocalDirty(entityIndex, denseIndex);
    }

    /** Write normalized rotation directly from a hot System. */
    setRotation(entityIndex: number, x: number, y: number, z: number, w: number): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        this.writeQuaternion(denseIndex, x, y, z, w);
        this.markLocalDirty(entityIndex, denseIndex);
    }

    /** Write scale directly from a hot System. */
    setScale(entityIndex: number, x: number, y: number, z: number): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        const offset = denseIndex * 3;
        this.scaleData[offset] = requireFinite(x, 'Transform scale x');
        this.scaleData[offset + 1] = requireFinite(y, 'Transform scale y');
        this.scaleData[offset + 2] = requireFinite(z, 'Transform scale z');
        this.markLocalDirty(entityIndex, denseIndex);
    }

    remove(entityIndex: number): boolean {
        if (!this.has(entityIndex)) return false;
        this.unlink(entityIndex);
        let child = this.firstChildIndices[entityIndex] ?? NO_ENTITY_INDEX;
        while (child !== NO_ENTITY_INDEX) {
            const next = this.nextSiblingIndices[child] ?? NO_ENTITY_INDEX;
            this.parentIndices[child] = NO_ENTITY_INDEX;
            this.previousSiblingIndices[child] = NO_ENTITY_INDEX;
            this.nextSiblingIndices[child] = NO_ENTITY_INDEX;
            this.enqueueDetached(child);
            this.markWorldSubtreeDirty(child);
            child = next;
        }
        this.firstChildIndices[entityIndex] = NO_ENTITY_INDEX;
        const denseIndex = this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
        const lastDenseIndex = this.entryCount - 1;
        if (denseIndex !== lastDenseIndex) this.moveDenseRow(lastDenseIndex, denseIndex);
        this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
        this.denseEntities[lastDenseIndex] = 0;
        this.localEntryRevisions[lastDenseIndex] = 0;
        this.worldEntryRevisions[lastDenseIndex] = 0;
        this.parentIndices[entityIndex] = NO_ENTITY_INDEX;
        this.nextSiblingIndices[entityIndex] = NO_ENTITY_INDEX;
        this.previousSiblingIndices[entityIndex] = NO_ENTITY_INDEX;
        this.localDirty[entityIndex] = 0;
        this.worldDirty[entityIndex] = 0;
        this.historyValid[entityIndex] = 0;
        this.entryCount--;
        this.currentStructureRevision++;
        this.currentDataRevision++;
        this.currentWorldDataRevision++;
        return true;
    }

    clear(): void {
        if (this.entryCount === 0) return;
        this.sparse.fill(ABSENT_DENSE_INDEX);
        this.denseEntities.fill(0);
        this.localEntryRevisions.fill(0);
        this.worldEntryRevisions.fill(0);
        this.parentIndices.fill(NO_ENTITY_INDEX);
        this.firstChildIndices.fill(NO_ENTITY_INDEX);
        this.nextSiblingIndices.fill(NO_ENTITY_INDEX);
        this.previousSiblingIndices.fill(NO_ENTITY_INDEX);
        this.localDirty.fill(0);
        this.worldDirty.fill(0);
        this.dirtyQueued.fill(0);
        this.historyValid.fill(0);
        this.historyQueued.fill(0);
        this.detachedQueued.fill(0);
        this.worldChangedQueued.fill(0);
        this.entryCount = 0;
        this.dirtyCount = 0;
        this.historyCount = 0;
        this.detachedCount = 0;
        this.worldChangedCount = 0;
        this.currentStructureRevision++;
        this.currentDataRevision++;
        this.currentWorldDataRevision++;
    }

    /** Apply a validated hierarchy relation and dirty only the affected subtree. @internal */
    setParentByIndex(entityIndex: number, parentIndex: number): void {
        this.requireDenseIndex(entityIndex);
        if (parentIndex !== NO_ENTITY_INDEX) this.requireDenseIndex(parentIndex);
        const currentParent = this.parentIndices[entityIndex] ?? NO_ENTITY_INDEX;
        if (currentParent === parentIndex) return;
        this.unlink(entityIndex);
        if (parentIndex !== NO_ENTITY_INDEX) {
            const firstChild = this.firstChildIndices[parentIndex] ?? NO_ENTITY_INDEX;
            this.parentIndices[entityIndex] = parentIndex;
            this.previousSiblingIndices[entityIndex] = NO_ENTITY_INDEX;
            this.nextSiblingIndices[entityIndex] = firstChild;
            if (firstChild !== NO_ENTITY_INDEX) {
                this.previousSiblingIndices[firstChild] = entityIndex;
            }
            this.firstChildIndices[parentIndex] = entityIndex;
        }
        this.currentHierarchyRevision++;
        this.markWorldSubtreeDirty(entityIndex);
    }

    /** Materialize automatic child detaches into authored Hierarchy values. @internal */
    flushDetachedHierarchy(hierarchy: HierarchyStore): void {
        for (let index = 0; index < this.detachedCount; index++) {
            const entityIndex = this.detachedEntities[index] ?? 0;
            this.detachedQueued[entityIndex] = 0;
            if (this.has(entityIndex)) hierarchy.detachParent(entityIndex);
        }
        this.detachedCount = 0;
    }

    /** Recompute current matrices for dirty roots only. Returns the number of updated rows. */
    updateWorldMatrices(): number {
        let rootCount = 0;
        for (let index = 0; index < this.dirtyCount; index++) {
            const entityIndex = this.dirtyEntities[index] ?? 0;
            if (!this.has(entityIndex) || this.worldDirty[entityIndex] !== 1) continue;
            const parentIndex = this.parentIndices[entityIndex] ?? NO_ENTITY_INDEX;
            if (parentIndex === NO_ENTITY_INDEX || this.worldDirty[parentIndex] !== 1) {
                this.dirtyRoots[rootCount] = entityIndex;
                rootCount++;
            }
        }
        let updated = 0;
        for (let rootIndex = 0; rootIndex < rootCount; rootIndex++) {
            let stackLength = 1;
            this.traversalStack[0] = this.dirtyRoots[rootIndex] ?? 0;
            while (stackLength > 0) {
                stackLength--;
                const entityIndex = this.traversalStack[stackLength] ?? 0;
                if (!this.has(entityIndex) || this.worldDirty[entityIndex] !== 1) continue;
                const denseIndex = this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
                if (this.localDirty[entityIndex] === 1) {
                    this.writeLocalMatrix(denseIndex);
                    this.localDirty[entityIndex] = 0;
                }
                const matrixOffset = denseIndex * MATRIX_ELEMENT_COUNT;
                const parentIndex = this.parentIndices[entityIndex] ?? NO_ENTITY_INDEX;
                if (parentIndex === NO_ENTITY_INDEX || !this.has(parentIndex)) {
                    copyMatrix(this.localMatrices, matrixOffset, this.worldMatrices, matrixOffset);
                } else {
                    const parentDenseIndex = this.sparse[parentIndex] ?? ABSENT_DENSE_INDEX;
                    multiplyMatrix(
                        this.worldMatrices,
                        matrixOffset,
                        this.worldMatrices,
                        parentDenseIndex * MATRIX_ELEMENT_COUNT,
                        this.localMatrices,
                        matrixOffset
                    );
                }
                this.worldDirty[entityIndex] = 0;
                this.dirtyQueued[entityIndex] = 0;
                this.worldEntryRevisions[denseIndex] = nextRevision(
                    this.worldEntryRevisions[denseIndex] ?? 0
                );
                this.currentWorldDataRevision++;
                this.enqueueHistory(entityIndex);
                this.enqueueWorldChanged(entityIndex);
                updated++;
                let child = this.firstChildIndices[entityIndex] ?? NO_ENTITY_INDEX;
                while (child !== NO_ENTITY_INDEX) {
                    if (this.worldDirty[child] === 1) {
                        this.traversalStack[stackLength] = child;
                        stackLength++;
                    }
                    child = this.nextSiblingIndices[child] ?? NO_ENTITY_INDEX;
                }
            }
        }
        for (let index = 0; index < this.dirtyCount; index++) {
            const entityIndex = this.dirtyEntities[index] ?? 0;
            this.dirtyQueued[entityIndex] = 0;
        }
        this.dirtyCount = 0;
        this.lastWorldMatrixUpdateCount = updated;
        this.totalWorldMatrixUpdateCount += updated;
        return updated;
    }

    /** Commit current matrices as previous only after a valid render submission. */
    commitWorldHistory(): void {
        for (let index = 0; index < this.historyCount; index++) {
            const entityIndex = this.historyEntities[index] ?? 0;
            this.historyQueued[entityIndex] = 0;
            if (!this.has(entityIndex)) continue;
            const denseIndex = this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
            const matrixOffset = denseIndex * MATRIX_ELEMENT_COUNT;
            copyMatrix(this.worldMatrices, matrixOffset, this.previousWorldMatrices, matrixOffset);
            this.historyValid[entityIndex] = 1;
        }
        this.historyCount = 0;
    }

    /** Leave staged transform history pending after a discarded render frame. */
    discardWorldHistory(): void {
        // Current matrices remain authoritative and the high-water pending set is retried.
    }

    /** Acknowledge world-matrix changes after RenderWorld copied them successfully. */
    clearChangedWorldEntities(): void {
        for (let index = 0; index < this.worldChangedCount; index++) {
            const entityIndex = this.worldChangedEntities[index] ?? 0;
            this.worldChangedQueued[entityIndex] = 0;
        }
        this.worldChangedCount = 0;
    }

    /** Force previous=current until the next successful submission. */
    invalidateWorldHistory(entityIndex: number): void {
        this.requireDenseIndex(entityIndex);
        this.historyValid[entityIndex] = 0;
        this.enqueueHistory(entityIndex);
    }

    /** Copy current world matrix with an optional camera-relative translation. */
    copyWorldMatrix(
        entityIndex: number,
        target: Float32Array,
        targetOffset = 0,
        origin?: TransformVector3
    ): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        const matrixOffset = denseIndex * MATRIX_ELEMENT_COUNT;
        copyMatrix(this.worldMatrices, matrixOffset, target, targetOffset);
        if (origin !== undefined) {
            target[targetOffset + 12] =
                (target[targetOffset + 12] ?? 0) - requireFinite(origin[0], 'World origin x');
            target[targetOffset + 13] =
                (target[targetOffset + 13] ?? 0) - requireFinite(origin[1], 'World origin y');
            target[targetOffset + 14] =
                (target[targetOffset + 14] ?? 0) - requireFinite(origin[2], 'World origin z');
        }
    }

    /** Copy the last submitted matrix, or current when history was invalidated. */
    copyPreviousWorldMatrix(entityIndex: number, target: Float32Array, targetOffset = 0): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        const matrixOffset = denseIndex * MATRIX_ELEMENT_COUNT;
        const source =
            this.historyValid[entityIndex] === 1 ? this.previousWorldMatrices : this.worldMatrices;
        copyMatrix(source, matrixOffset, target, targetOffset);
    }

    /**
     * Copy local position and quaternion as `[x, y, z, qx, qy, qz, qw]` into reusable storage.
     */
    copyLocalPose(
        entityIndex: number,
        target: Float32Array | Float64Array,
        targetOffset = 0
    ): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        if (
            !Number.isSafeInteger(targetOffset) ||
            targetOffset < 0 ||
            targetOffset + 7 > target.length
        ) {
            throw new RangeError('Local pose output range must contain seven elements.');
        }
        const positionOffset = denseIndex * 3;
        const rotationOffset = denseIndex * 4;
        target[targetOffset] = this.positionData[positionOffset] ?? 0;
        target[targetOffset + 1] = this.positionData[positionOffset + 1] ?? 0;
        target[targetOffset + 2] = this.positionData[positionOffset + 2] ?? 0;
        target[targetOffset + 3] = this.rotationData[rotationOffset] ?? 0;
        target[targetOffset + 4] = this.rotationData[rotationOffset + 1] ?? 0;
        target[targetOffset + 5] = this.rotationData[rotationOffset + 2] ?? 0;
        target[targetOffset + 6] = this.rotationData[rotationOffset + 3] ?? 1;
    }

    getDiagnostics(): TransformDiagnostics {
        return {
            transformCount: this.entryCount,
            queuedDirtyCount: this.dirtyCount,
            updatedWorldMatrixCount: this.lastWorldMatrixUpdateCount,
            totalWorldMatrixUpdateCount: this.totalWorldMatrixUpdateCount,
            hierarchyRevision: this.currentHierarchyRevision
        };
    }

    private writeTRS(denseIndex: number, value: LocalTransformValue): void {
        const positionOffset = denseIndex * 3;
        this.positionData[positionOffset] = component(value.position, 0, 0);
        this.positionData[positionOffset + 1] = component(value.position, 1, 0);
        this.positionData[positionOffset + 2] = component(value.position, 2, 0);
        this.writeQuaternion(
            denseIndex,
            component(value.rotation, 0, 0),
            component(value.rotation, 1, 0),
            component(value.rotation, 2, 0),
            component(value.rotation, 3, 1)
        );
        this.scaleData[positionOffset] = component(value.scale, 0, 1);
        this.scaleData[positionOffset + 1] = component(value.scale, 1, 1);
        this.scaleData[positionOffset + 2] = component(value.scale, 2, 1);
    }

    private writeQuaternion(
        denseIndex: number,
        xValue: number,
        yValue: number,
        zValue: number,
        wValue: number
    ): void {
        const x = requireFinite(xValue, 'Transform rotation x');
        const y = requireFinite(yValue, 'Transform rotation y');
        const z = requireFinite(zValue, 'Transform rotation z');
        const w = requireFinite(wValue, 'Transform rotation w');
        const length = quaternionLength(x, y, z, w);
        if (length === 0) throw new RangeError('Transform rotation quaternion cannot be zero.');
        const offset = denseIndex * 4;
        this.rotationData[offset] = x / length;
        this.rotationData[offset + 1] = y / length;
        this.rotationData[offset + 2] = z / length;
        this.rotationData[offset + 3] = w / length;
    }

    private markLocalDirty(entityIndex: number, denseIndex: number): void {
        this.localDirty[entityIndex] = 1;
        this.localEntryRevisions[denseIndex] = nextRevision(
            this.localEntryRevisions[denseIndex] ?? 0
        );
        this.currentDataRevision++;
        this.markWorldSubtreeDirty(entityIndex);
    }

    private markWorldSubtreeDirty(rootEntityIndex: number): void {
        let stackLength = 1;
        this.traversalStack[0] = rootEntityIndex;
        while (stackLength > 0) {
            stackLength--;
            const entityIndex = this.traversalStack[stackLength] ?? 0;
            if (!this.has(entityIndex)) continue;
            if (this.worldDirty[entityIndex] !== 1) {
                this.worldDirty[entityIndex] = 1;
                if (this.dirtyQueued[entityIndex] !== 1) {
                    this.dirtyQueued[entityIndex] = 1;
                    this.dirtyEntities[this.dirtyCount] = entityIndex;
                    this.dirtyCount++;
                }
            }
            let child = this.firstChildIndices[entityIndex] ?? NO_ENTITY_INDEX;
            while (child !== NO_ENTITY_INDEX) {
                this.traversalStack[stackLength] = child;
                stackLength++;
                child = this.nextSiblingIndices[child] ?? NO_ENTITY_INDEX;
            }
        }
    }

    private enqueueHistory(entityIndex: number): void {
        if (this.historyQueued[entityIndex] === 1) return;
        this.historyQueued[entityIndex] = 1;
        this.historyEntities[this.historyCount] = entityIndex;
        this.historyCount++;
    }

    private enqueueDetached(entityIndex: number): void {
        if (this.detachedQueued[entityIndex] === 1) return;
        this.detachedQueued[entityIndex] = 1;
        this.detachedEntities[this.detachedCount] = entityIndex;
        this.detachedCount++;
    }

    private enqueueWorldChanged(entityIndex: number): void {
        if (this.worldChangedQueued[entityIndex] === 1) return;
        this.worldChangedQueued[entityIndex] = 1;
        this.worldChangedEntities[this.worldChangedCount] = entityIndex;
        this.worldChangedCount++;
    }

    private unlink(entityIndex: number): void {
        const parentIndex = this.parentIndices[entityIndex] ?? NO_ENTITY_INDEX;
        const previousSibling = this.previousSiblingIndices[entityIndex] ?? NO_ENTITY_INDEX;
        const nextSibling = this.nextSiblingIndices[entityIndex] ?? NO_ENTITY_INDEX;
        if (previousSibling !== NO_ENTITY_INDEX) {
            this.nextSiblingIndices[previousSibling] = nextSibling;
        } else if (parentIndex !== NO_ENTITY_INDEX) {
            this.firstChildIndices[parentIndex] = nextSibling;
        }
        if (nextSibling !== NO_ENTITY_INDEX) {
            this.previousSiblingIndices[nextSibling] = previousSibling;
        }
        this.parentIndices[entityIndex] = NO_ENTITY_INDEX;
        this.previousSiblingIndices[entityIndex] = NO_ENTITY_INDEX;
        this.nextSiblingIndices[entityIndex] = NO_ENTITY_INDEX;
    }

    private writeLocalMatrix(denseIndex: number): void {
        const positionOffset = denseIndex * 3;
        const rotationOffset = denseIndex * 4;
        const matrixOffset = denseIndex * MATRIX_ELEMENT_COUNT;
        const x = this.rotationData[rotationOffset] ?? 0;
        const y = this.rotationData[rotationOffset + 1] ?? 0;
        const z = this.rotationData[rotationOffset + 2] ?? 0;
        const w = this.rotationData[rotationOffset + 3] ?? 1;
        const x2 = x + x;
        const y2 = y + y;
        const z2 = z + z;
        const xx = x * x2;
        const xy = x * y2;
        const xz = x * z2;
        const yy = y * y2;
        const yz = y * z2;
        const zz = z * z2;
        const wx = w * x2;
        const wy = w * y2;
        const wz = w * z2;
        const sx = this.scaleData[positionOffset] ?? 1;
        const sy = this.scaleData[positionOffset + 1] ?? 1;
        const sz = this.scaleData[positionOffset + 2] ?? 1;
        this.localMatrices[matrixOffset] = (1 - (yy + zz)) * sx;
        this.localMatrices[matrixOffset + 1] = (xy + wz) * sx;
        this.localMatrices[matrixOffset + 2] = (xz - wy) * sx;
        this.localMatrices[matrixOffset + 3] = 0;
        this.localMatrices[matrixOffset + 4] = (xy - wz) * sy;
        this.localMatrices[matrixOffset + 5] = (1 - (xx + zz)) * sy;
        this.localMatrices[matrixOffset + 6] = (yz + wx) * sy;
        this.localMatrices[matrixOffset + 7] = 0;
        this.localMatrices[matrixOffset + 8] = (xz + wy) * sz;
        this.localMatrices[matrixOffset + 9] = (yz - wx) * sz;
        this.localMatrices[matrixOffset + 10] = (1 - (xx + yy)) * sz;
        this.localMatrices[matrixOffset + 11] = 0;
        this.localMatrices[matrixOffset + 12] = this.positionData[positionOffset] ?? 0;
        this.localMatrices[matrixOffset + 13] = this.positionData[positionOffset + 1] ?? 0;
        this.localMatrices[matrixOffset + 14] = this.positionData[positionOffset + 2] ?? 0;
        this.localMatrices[matrixOffset + 15] = 1;
    }

    private moveDenseRow(sourceDenseIndex: number, targetDenseIndex: number): void {
        const movedEntity = this.denseEntities[sourceDenseIndex] ?? 0;
        this.denseEntities[targetDenseIndex] = movedEntity;
        this.sparse[movedEntity] = targetDenseIndex;
        for (let index = 0; index < 3; index++) {
            this.positionData[targetDenseIndex * 3 + index] =
                this.positionData[sourceDenseIndex * 3 + index] ?? 0;
            this.scaleData[targetDenseIndex * 3 + index] =
                this.scaleData[sourceDenseIndex * 3 + index] ?? 0;
        }
        for (let index = 0; index < 4; index++) {
            this.rotationData[targetDenseIndex * 4 + index] =
                this.rotationData[sourceDenseIndex * 4 + index] ?? 0;
        }
        for (let index = 0; index < MATRIX_ELEMENT_COUNT; index++) {
            this.localMatrices[targetDenseIndex * MATRIX_ELEMENT_COUNT + index] =
                this.localMatrices[sourceDenseIndex * MATRIX_ELEMENT_COUNT + index] ?? 0;
            this.worldMatrices[targetDenseIndex * MATRIX_ELEMENT_COUNT + index] =
                this.worldMatrices[sourceDenseIndex * MATRIX_ELEMENT_COUNT + index] ?? 0;
            this.previousWorldMatrices[targetDenseIndex * MATRIX_ELEMENT_COUNT + index] =
                this.previousWorldMatrices[sourceDenseIndex * MATRIX_ELEMENT_COUNT + index] ?? 0;
        }
        this.localEntryRevisions[targetDenseIndex] =
            this.localEntryRevisions[sourceDenseIndex] ?? 0;
        this.worldEntryRevisions[targetDenseIndex] =
            this.worldEntryRevisions[sourceDenseIndex] ?? 0;
    }

    private requireDenseIndex(entityIndex: number): number {
        if (!this.has(entityIndex)) {
            throw new ReferenceError(
                `Entity index ${String(entityIndex)} does not have LocalTransform.`
            );
        }
        return this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
    }

    private requireDenseRange(denseIndex: number): void {
        if (!Number.isSafeInteger(denseIndex) || denseIndex < 0 || denseIndex >= this.entryCount) {
            throw new RangeError(`Dense transform index ${String(denseIndex)} is out of range.`);
        }
    }

    private requireEntityIndexInCapacity(entityIndex: number): void {
        if (
            !Number.isSafeInteger(entityIndex) ||
            entityIndex < 0 ||
            entityIndex >= this.sparse.length
        ) {
            throw new RangeError(
                `Entity index ${String(entityIndex)} exceeds transform capacity ${String(this.sparse.length)}.`
            );
        }
    }

    private ensureDenseCapacity(required: number): void {
        if (required <= this.denseEntities.length) return;
        let capacity = Math.max(this.denseEntities.length, MIN_DENSE_CAPACITY);
        while (capacity < required) capacity *= 2;
        this.denseEntities = growUint32(this.denseEntities, capacity);
        this.positionData = growFloat32(this.positionData, capacity * 3);
        this.rotationData = growFloat32(this.rotationData, capacity * 4);
        this.scaleData = growFloat32(this.scaleData, capacity * 3);
        this.localMatrices = growFloat32(this.localMatrices, capacity * MATRIX_ELEMENT_COUNT);
        this.worldMatrices = growFloat32(this.worldMatrices, capacity * MATRIX_ELEMENT_COUNT);
        this.previousWorldMatrices = growFloat32(
            this.previousWorldMatrices,
            capacity * MATRIX_ELEMENT_COUNT
        );
        this.localEntryRevisions = growUint32(this.localEntryRevisions, capacity);
        this.worldEntryRevisions = growUint32(this.worldEntryRevisions, capacity);
    }
}

/** Sparse authored hierarchy values plus a duplicate-free relationship change queue. */
export class HierarchyStore extends SparseSetComponentStore<HierarchyValue> {
    private changed: Uint8Array;
    private changedEntities: Uint32Array;
    private resolvedParents: Int32Array;
    private validationState: Uint8Array;
    private validationPath: Uint32Array;
    private validationEntities: Uint32Array;
    private changedCount = 0;
    private validationEntityCount = 0;
    private lastAppliedRelationshipCount = 0;
    private lastValidationVisitCount = 0;

    constructor(initialEntityCapacity = 0) {
        super(initialEntityCapacity);
        this.changed = new Uint8Array(initialEntityCapacity);
        this.changedEntities = new Uint32Array(initialEntityCapacity);
        this.resolvedParents = createRelationshipIndex(initialEntityCapacity);
        this.validationState = new Uint8Array(initialEntityCapacity);
        this.validationPath = new Uint32Array(initialEntityCapacity);
        this.validationEntities = new Uint32Array(initialEntityCapacity);
    }

    override ensureEntityCapacity(capacity: number): void {
        const previousCapacity = this.entityCapacity;
        super.ensureEntityCapacity(capacity);
        if (capacity <= previousCapacity) return;
        this.changed = growUint8(this.changed, capacity);
        this.changedEntities = growUint32(this.changedEntities, capacity);
        this.resolvedParents = growRelationship(this.resolvedParents, capacity);
        this.validationState = growUint8(this.validationState, capacity);
        this.validationPath = growUint32(this.validationPath, capacity);
        this.validationEntities = growUint32(this.validationEntities, capacity);
    }

    override add(entityIndex: number, value: HierarchyValue): void {
        super.add(entityIndex, this.snapshot(value));
        this.markChanged(entityIndex);
    }

    override validate(value: HierarchyValue): void {
        this.snapshot(value);
    }

    override set(entityIndex: number, value: HierarchyValue): void {
        super.set(entityIndex, this.snapshot(value));
        this.markChanged(entityIndex);
    }

    override remove(entityIndex: number): boolean {
        const removed = super.remove(entityIndex);
        if (removed) this.markChanged(entityIndex);
        return removed;
    }

    override clear(): void {
        super.clear();
        this.changed.fill(0);
        this.validationState.fill(0);
        this.changedCount = 0;
        this.validationEntityCount = 0;
        this.lastAppliedRelationshipCount = 0;
        this.lastValidationVisitCount = 0;
    }

    /** Return allocation-cold proof that validation stayed linear in the visited relationship graph. */
    getDiagnostics(): HierarchyDiagnostics {
        return {
            appliedRelationshipCount: this.lastAppliedRelationshipCount,
            validationVisitCount: this.lastValidationVisitCount
        };
    }

    /** Validate a complete reparent batch before applying any relationship mutation. */
    applyChanges(world: World, transforms: TransformStore): void {
        if (this.changedCount === 0) return;
        for (let index = 0; index < this.changedCount; index++) {
            const childIndex = this.changedEntities[index] ?? 0;
            let parentIndex = NO_ENTITY_INDEX;
            if (transforms.has(childIndex) && this.has(childIndex)) {
                const parent = this.get(childIndex).parent;
                if (parent !== null) {
                    if (!world.isAlive(parent)) {
                        throw new ReferenceError(
                            `Hierarchy parent Entity ${String(parent)} is not alive in this World.`
                        );
                    }
                    parentIndex = world.entityIndex(parent);
                    if (!transforms.has(parentIndex)) {
                        throw new ReferenceError(
                            `Hierarchy parent Entity ${String(parent)} has no LocalTransform.`
                        );
                    }
                }
            }
            this.resolvedParents[childIndex] = parentIndex;
        }
        let validationVisits = 0;
        for (let index = 0; index < this.changedCount; index++) {
            const childIndex = this.changedEntities[index] ?? 0;
            if (!transforms.has(childIndex) || this.validationState[childIndex] === 2) continue;
            let pathCount = 0;
            let current = childIndex;
            while (current !== NO_ENTITY_INDEX) {
                const state = this.validationState[current] ?? 0;
                if (state === 1) {
                    this.clearValidationState();
                    throw new TypeError(
                        `Hierarchy reparent would create a cycle at Entity index ${String(current)}.`
                    );
                }
                if (state === 2) break;
                this.validationState[current] = 1;
                this.validationEntities[this.validationEntityCount] = current;
                this.validationEntityCount++;
                this.validationPath[pathCount] = current;
                pathCount++;
                validationVisits++;
                current =
                    this.changed[current] === 1
                        ? (this.resolvedParents[current] ?? NO_ENTITY_INDEX)
                        : transforms.parentIndexOf(current);
            }
            while (pathCount > 0) {
                pathCount--;
                this.validationState[this.validationPath[pathCount] ?? 0] = 2;
            }
        }
        this.clearValidationState();
        this.lastAppliedRelationshipCount = this.changedCount;
        this.lastValidationVisitCount = validationVisits;
        for (let index = 0; index < this.changedCount; index++) {
            const childIndex = this.changedEntities[index] ?? 0;
            if (transforms.has(childIndex)) {
                transforms.setParentByIndex(
                    childIndex,
                    this.resolvedParents[childIndex] ?? NO_ENTITY_INDEX
                );
            }
        }
        for (let index = 0; index < this.changedCount; index++) {
            const entityIndex = this.changedEntities[index] ?? 0;
            this.changed[entityIndex] = 0;
            this.resolvedParents[entityIndex] = NO_ENTITY_INDEX;
        }
        this.changedCount = 0;
    }

    /** Reset an authored parent after its transform was removed. @internal */
    detachParent(entityIndex: number): void {
        if (!this.has(entityIndex) || this.get(entityIndex).parent === null) return;
        super.set(entityIndex, Object.freeze({ parent: null }));
        this.markChanged(entityIndex);
    }

    private snapshot(value: HierarchyValue): HierarchyValue {
        const parent: unknown = value.parent;
        if (
            parent !== null &&
            (typeof parent !== 'number' || !Number.isSafeInteger(parent) || parent < 0)
        ) {
            throw new TypeError('Hierarchy parent must be a valid Entity or null.');
        }
        return Object.freeze({ parent: value.parent });
    }

    private markChanged(entityIndex: number): void {
        if (this.changed[entityIndex] === 1) return;
        this.changed[entityIndex] = 1;
        this.changedEntities[this.changedCount] = entityIndex;
        this.changedCount++;
    }

    private clearValidationState(): void {
        for (let index = 0; index < this.validationEntityCount; index++) {
            this.validationState[this.validationEntities[index] ?? 0] = 0;
        }
        this.validationEntityCount = 0;
    }
}

/** Read-only façade that gives WorldTransform normal query membership without duplicate storage. */
export class WorldTransformStore implements ComponentStore<WorldTransformValue> {
    constructor(private readonly transforms: TransformStore) {}

    get length(): number {
        return this.transforms.length;
    }

    get entityCapacity(): number {
        return this.transforms.entityCapacity;
    }

    get entityIndices(): Uint32Array {
        return this.transforms.entityIndices;
    }

    get structureRevision(): number {
        return this.transforms.structureRevision;
    }

    get dataRevision(): number {
        return this.transforms.worldDataRevision;
    }

    ensureEntityCapacity(capacity: number): void {
        this.transforms.ensureEntityCapacity(capacity);
    }

    has(entityIndex: number): boolean {
        return this.transforms.has(entityIndex);
    }

    get(entityIndex: number): WorldTransformValue {
        const matrix = new Float32Array(MATRIX_ELEMENT_COUNT);
        const previousMatrix = new Float32Array(MATRIX_ELEMENT_COUNT);
        this.transforms.copyWorldMatrix(entityIndex, matrix);
        this.transforms.copyPreviousWorldMatrix(entityIndex, previousMatrix);
        return {
            matrix,
            previousMatrix,
            revision: this.transforms.worldRevisionOf(entityIndex),
            historyValid: this.transforms.isHistoryValid(entityIndex)
        };
    }

    getByDenseIndex(denseIndex: number): WorldTransformValue {
        const entityIndex = this.entityIndices[denseIndex];
        if (entityIndex === undefined || denseIndex < 0 || denseIndex >= this.length) {
            throw new RangeError(
                `Dense world transform index ${String(denseIndex)} is out of range.`
            );
        }
        return this.get(entityIndex);
    }

    getEntryRevision(entityIndex: number): number {
        return this.transforms.worldRevisionOf(entityIndex);
    }

    validate(): void {
        throw new TypeError('WorldTransform is a read-only derived component.');
    }

    add(): void {
        throw new TypeError('WorldTransform is a read-only derived component.');
    }

    set(): void {
        throw new TypeError('WorldTransform is a read-only derived component.');
    }

    remove(): boolean {
        return false;
    }

    clear(): void {
        // The LocalTransform store owns all storage and is cleared separately.
    }
}

/** Hot SoA storage for fixed-step poses sampled once by the Transform phase. */
export class InterpolatedTransformStore implements ComponentStore<InterpolatedTransformValue> {
    private sparse: Int32Array;
    private denseEntities: Uint32Array;
    private poses: Float32Array;
    private entryRevisions: Uint32Array;
    private entryCount = 0;
    private currentStructureRevision = 0;
    private currentDataRevision = 0;

    constructor(initialEntityCapacity = 0, initialDenseCapacity = initialEntityCapacity) {
        this.sparse = createSparseIndex(validateCapacity(initialEntityCapacity));
        this.denseEntities = new Uint32Array(validateCapacity(initialDenseCapacity));
        this.poses = new Float32Array(initialDenseCapacity * 14);
        this.entryRevisions = new Uint32Array(initialDenseCapacity);
    }

    get length(): number {
        return this.entryCount;
    }

    get entityCapacity(): number {
        return this.sparse.length;
    }

    get entityIndices(): Uint32Array {
        return this.denseEntities;
    }

    get structureRevision(): number {
        return this.currentStructureRevision;
    }

    get dataRevision(): number {
        return this.currentDataRevision;
    }

    ensureEntityCapacity(capacity: number): void {
        const validated = validateCapacity(capacity);
        if (validated <= this.sparse.length) return;
        const sparse = createSparseIndex(validated);
        sparse.set(this.sparse);
        this.sparse = sparse;
    }

    has(entityIndex: number): boolean {
        return (
            Number.isSafeInteger(entityIndex) &&
            entityIndex >= 0 &&
            entityIndex < this.sparse.length &&
            this.sparse[entityIndex] !== ABSENT_DENSE_INDEX
        );
    }

    get(entityIndex: number): InterpolatedTransformValue {
        return this.getByDenseIndex(this.requireDenseIndex(entityIndex));
    }

    getByDenseIndex(denseIndex: number): InterpolatedTransformValue {
        this.requireDenseRange(denseIndex);
        const offset = denseIndex * 14;
        return {
            previousPosition: [
                this.poses[offset] ?? 0,
                this.poses[offset + 1] ?? 0,
                this.poses[offset + 2] ?? 0
            ],
            previousRotation: [
                this.poses[offset + 3] ?? 0,
                this.poses[offset + 4] ?? 0,
                this.poses[offset + 5] ?? 0,
                this.poses[offset + 6] ?? 1
            ],
            currentPosition: [
                this.poses[offset + 7] ?? 0,
                this.poses[offset + 8] ?? 0,
                this.poses[offset + 9] ?? 0
            ],
            currentRotation: [
                this.poses[offset + 10] ?? 0,
                this.poses[offset + 11] ?? 0,
                this.poses[offset + 12] ?? 0,
                this.poses[offset + 13] ?? 1
            ]
        };
    }

    getEntryRevision(entityIndex: number): number {
        return this.entryRevisions[this.requireDenseIndex(entityIndex)] ?? 0;
    }

    validate(value: InterpolatedTransformValue): void {
        requireFinite(value.previousPosition[0], 'Interpolated position x');
        requireFinite(value.previousPosition[1], 'Interpolated position y');
        requireFinite(value.previousPosition[2], 'Interpolated position z');
        this.validateQuaternion(value.previousRotation);
        requireFinite(value.currentPosition[0], 'Interpolated position x');
        requireFinite(value.currentPosition[1], 'Interpolated position y');
        requireFinite(value.currentPosition[2], 'Interpolated position z');
        this.validateQuaternion(value.currentRotation);
    }

    add(entityIndex: number, value: InterpolatedTransformValue): void {
        if (this.has(entityIndex)) {
            throw new TypeError(`Entity index ${String(entityIndex)} already has interpolation.`);
        }
        if (entityIndex < 0 || entityIndex >= this.sparse.length) {
            throw new RangeError('InterpolatedTransform Entity exceeds store capacity.');
        }
        this.validate(value);
        this.ensureDenseCapacity(this.entryCount + 1);
        const denseIndex = this.entryCount;
        this.entryCount++;
        this.sparse[entityIndex] = denseIndex;
        this.denseEntities[denseIndex] = entityIndex;
        this.write(denseIndex, value);
        this.entryRevisions[denseIndex] = 1;
        this.currentStructureRevision++;
        this.currentDataRevision++;
    }

    set(entityIndex: number, value: InterpolatedTransformValue): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        this.validate(value);
        this.write(denseIndex, value);
        this.touch(denseIndex);
    }

    remove(entityIndex: number): boolean {
        if (!this.has(entityIndex)) return false;
        const denseIndex = this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
        const lastDenseIndex = this.entryCount - 1;
        if (denseIndex !== lastDenseIndex) {
            const movedEntity = this.denseEntities[lastDenseIndex] ?? 0;
            this.denseEntities[denseIndex] = movedEntity;
            this.sparse[movedEntity] = denseIndex;
            this.poses.copyWithin(denseIndex * 14, lastDenseIndex * 14, lastDenseIndex * 14 + 14);
            this.entryRevisions[denseIndex] = this.entryRevisions[lastDenseIndex] ?? 0;
        }
        this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
        this.denseEntities[lastDenseIndex] = 0;
        this.entryRevisions[lastDenseIndex] = 0;
        this.poses.fill(0, lastDenseIndex * 14, lastDenseIndex * 14 + 14);
        this.entryCount--;
        this.currentStructureRevision++;
        this.currentDataRevision++;
        return true;
    }

    clear(): void {
        if (this.entryCount === 0) return;
        this.sparse.fill(ABSENT_DENSE_INDEX);
        this.denseEntities.fill(0, 0, this.entryCount);
        this.entryRevisions.fill(0, 0, this.entryCount);
        this.poses.fill(0, 0, this.entryCount * 14);
        this.entryCount = 0;
        this.currentStructureRevision++;
        this.currentDataRevision++;
    }

    /** Move current pose to previous before one fixed simulation step. */
    capturePrevious(entityIndex: number): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        const offset = denseIndex * 14;
        this.poses.copyWithin(offset, offset + 7, offset + 14);
    }

    /** Store a new 3D fixed-step pose without allocating a component payload. */
    setCurrent3D(
        entityIndex: number,
        x: number,
        y: number,
        z: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        const offset = denseIndex * 14 + 7;
        this.writePosition(offset, x, y, z);
        this.writeQuaternion(offset + 3, qx, qy, qz, qw);
        this.touch(denseIndex);
    }

    /** Store a new 2D fixed-step pose as a Z-axis quaternion. */
    setCurrent2D(entityIndex: number, x: number, y: number, rotation: number): void {
        const halfAngle = requireFinite(rotation, 'Interpolated 2D rotation') * 0.5;
        this.setCurrent3D(entityIndex, x, y, 0, 0, 0, Math.sin(halfAngle), Math.cos(halfAngle));
    }

    /** Sample all active histories into LocalTransform in one allocation-free dense pass. */
    apply(transforms: TransformStore, alphaValue: number): void {
        const finiteAlpha = requireFinite(alphaValue, 'Interpolation alpha');
        const alpha = finiteAlpha < 0 ? 0 : finiteAlpha > 1 ? 1 : finiteAlpha;
        for (let denseIndex = 0; denseIndex < this.entryCount; denseIndex++) {
            const entityIndex = this.denseEntities[denseIndex] ?? 0;
            if (!transforms.has(entityIndex)) continue;
            const offset = denseIndex * 14;
            const inverse = 1 - alpha;
            transforms.setPosition(
                entityIndex,
                (this.poses[offset] ?? 0) * inverse + (this.poses[offset + 7] ?? 0) * alpha,
                (this.poses[offset + 1] ?? 0) * inverse + (this.poses[offset + 8] ?? 0) * alpha,
                (this.poses[offset + 2] ?? 0) * inverse + (this.poses[offset + 9] ?? 0) * alpha
            );
            let currentX = this.poses[offset + 10] ?? 0;
            let currentY = this.poses[offset + 11] ?? 0;
            let currentZ = this.poses[offset + 12] ?? 0;
            let currentW = this.poses[offset + 13] ?? 1;
            const previousX = this.poses[offset + 3] ?? 0;
            const previousY = this.poses[offset + 4] ?? 0;
            const previousZ = this.poses[offset + 5] ?? 0;
            const previousW = this.poses[offset + 6] ?? 1;
            if (
                previousX * currentX +
                    previousY * currentY +
                    previousZ * currentZ +
                    previousW * currentW <
                0
            ) {
                currentX = -currentX;
                currentY = -currentY;
                currentZ = -currentZ;
                currentW = -currentW;
            }
            transforms.setRotation(
                entityIndex,
                previousX * inverse + currentX * alpha,
                previousY * inverse + currentY * alpha,
                previousZ * inverse + currentZ * alpha,
                previousW * inverse + currentW * alpha
            );
        }
    }

    private write(denseIndex: number, value: InterpolatedTransformValue): void {
        const offset = denseIndex * 14;
        this.writePosition(
            offset,
            value.previousPosition[0],
            value.previousPosition[1],
            value.previousPosition[2]
        );
        this.writeQuaternion(
            offset + 3,
            value.previousRotation[0],
            value.previousRotation[1],
            value.previousRotation[2],
            value.previousRotation[3]
        );
        this.writePosition(
            offset + 7,
            value.currentPosition[0],
            value.currentPosition[1],
            value.currentPosition[2]
        );
        this.writeQuaternion(
            offset + 10,
            value.currentRotation[0],
            value.currentRotation[1],
            value.currentRotation[2],
            value.currentRotation[3]
        );
    }

    private writePosition(offset: number, x: number, y: number, z: number): void {
        this.poses[offset] = requireFinite(x, 'Interpolated position x');
        this.poses[offset + 1] = requireFinite(y, 'Interpolated position y');
        this.poses[offset + 2] = requireFinite(z, 'Interpolated position z');
    }

    private writeQuaternion(
        offset: number,
        xValue: number,
        yValue: number,
        zValue: number,
        wValue: number
    ): void {
        const x = requireFinite(xValue, 'Interpolated rotation x');
        const y = requireFinite(yValue, 'Interpolated rotation y');
        const z = requireFinite(zValue, 'Interpolated rotation z');
        const w = requireFinite(wValue, 'Interpolated rotation w');
        const length = quaternionLength(x, y, z, w);
        if (length === 0) throw new RangeError('Interpolated rotation cannot be zero.');
        this.poses[offset] = x / length;
        this.poses[offset + 1] = y / length;
        this.poses[offset + 2] = z / length;
        this.poses[offset + 3] = w / length;
    }

    private validateQuaternion(value: TransformQuaternion): void {
        const x = requireFinite(value[0], 'Interpolated rotation x');
        const y = requireFinite(value[1], 'Interpolated rotation y');
        const z = requireFinite(value[2], 'Interpolated rotation z');
        const w = requireFinite(value[3], 'Interpolated rotation w');
        if (quaternionLength(x, y, z, w) === 0) {
            throw new RangeError('Interpolated rotation cannot be zero.');
        }
    }

    private touch(denseIndex: number): void {
        this.entryRevisions[denseIndex] = nextRevision(this.entryRevisions[denseIndex] ?? 0);
        this.currentDataRevision++;
    }

    private requireDenseIndex(entityIndex: number): number {
        if (!this.has(entityIndex)) {
            throw new ReferenceError(`Entity index ${String(entityIndex)} has no interpolation.`);
        }
        return this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
    }

    private requireDenseRange(denseIndex: number): void {
        if (!Number.isSafeInteger(denseIndex) || denseIndex < 0 || denseIndex >= this.entryCount) {
            throw new RangeError(
                `Interpolation dense index ${String(denseIndex)} is out of range.`
            );
        }
    }

    private ensureDenseCapacity(required: number): void {
        if (required <= this.denseEntities.length) return;
        let capacity = Math.max(this.denseEntities.length, MIN_DENSE_CAPACITY);
        while (capacity < required) capacity *= 2;
        this.denseEntities = growUint32(this.denseEntities, capacity);
        this.poses = growFloat32(this.poses, capacity * 14);
        this.entryRevisions = growUint32(this.entryRevisions, capacity);
    }
}

/** Authored local TRS component backed by allocation-stable SoA storage. */
export const LocalTransform = defineComponent<LocalTransformValue>(
    'hilo3d/local-transform',
    initialCapacity => new TransformStore(initialCapacity)
);

/** Optional fixed-step pose history sampled by TransformSystem before world propagation. */
export const InterpolatedTransform = defineComponent<InterpolatedTransformValue>(
    'hilo3d/interpolated-transform',
    capacity => new InterpolatedTransformStore(capacity)
);

/** Authored transform parent relationship backed by entity-indexed linked arrays. */
export const Hierarchy = defineComponent<HierarchyValue>(
    'hilo3d/hierarchy',
    initialCapacity => new HierarchyStore(initialCapacity)
);

/** System-owned current/previous world transform view. */
export const WorldTransform = defineDerivedComponent<WorldTransformValue>('hilo3d/world-transform');

/** Resolve the World-local transform SoA for hot System and extraction paths. */
export function getTransformStore(world: World): TransformStore {
    const store = world.getStore(LocalTransform);
    if (!(store instanceof TransformStore)) {
        throw new TypeError('LocalTransform is not backed by the Hilo3D TransformStore.');
    }
    return store;
}

/** Resolve the World-local fixed-step interpolation SoA. */
export function getInterpolatedTransformStore(world: World): InterpolatedTransformStore {
    const store = world.getStore(InterpolatedTransform);
    if (!(store instanceof InterpolatedTransformStore)) {
        throw new TypeError(
            'InterpolatedTransform is not backed by the Hilo3D interpolation store.'
        );
    }
    return store;
}

/** Resolve the World-local hierarchy store. */
export function getHierarchyStore(world: World): HierarchyStore {
    const store = world.getStore(Hierarchy);
    if (!(store instanceof HierarchyStore)) {
        throw new TypeError('Hierarchy is not backed by the Hilo3D HierarchyStore.');
    }
    return store;
}
