import type Camera from '../../camera/Camera';
import Mesh from '../../core/Mesh';
import type Geometry from '../../geometry/Geometry';
import type Material from '../../material/MaterialInstance';
import Vector3 from '../../math/Vector3';
import { MAX_INSTANCES_PER_DRAW } from '../ubo/BuiltInUniformBlocks';

/** A reusable instanced draw group. Its contents are valid until the planner is rebuilt. */
export interface MeshDrawInstanceBatch {
    readonly geometry: Geometry;
    readonly material: Material;
    readonly meshes: readonly Mesh[];
    readonly renderOrder: number;
    readonly transparent: boolean;
}

/** One item in the final backend-neutral draw order produced by the shared planner. */
export type MeshDrawListItem = Mesh | Readonly<MeshDrawInstanceBatch>;

/** Narrow one ordered draw-list item without relying on private batch fields. */
export function isMeshDrawInstanceBatch(
    item: MeshDrawListItem
): item is Readonly<MeshDrawInstanceBatch> {
    return !(item instanceof Mesh);
}

/**
 * Stable draw-list result. The object and all arrays retain their identities across builds;
 * callers must consume their contents before the next build or reset.
 */
export interface MeshDrawListPlan {
    readonly opaqueMeshes: readonly Mesh[];
    readonly transparentMeshes: readonly Mesh[];
    readonly instancedBatches: readonly Readonly<MeshDrawInstanceBatch>[];
    /** Final opaque order, including direct and instanced items. */
    readonly opaqueItems: readonly MeshDrawListItem[];
    /** Final transparent order, including direct and instanced items. */
    readonly transparentItems: readonly MeshDrawListItem[];
}

/** Stable diagnostics object used to verify bounded high-water storage. */
export interface MeshDrawListPlannerDiagnostics {
    readonly activeOwnerCount: number;
    readonly activeInstancedBatchCount: number;
    readonly inputCapacity: number;
    readonly opaqueCapacity: number;
    readonly transparentCapacity: number;
    readonly instancedBatchCapacity: number;
    readonly largestInstancedBatchCapacity: number;
    readonly ownerRecordCapacity: number;
    readonly geometryGroupCapacity: number;
    readonly storageAllocationCount: number;
}

interface MutableMeshDrawInstanceBatch {
    geometry: Geometry;
    material: Material;
    readonly meshes: Mesh[];
    renderOrder: number;
    transparent: boolean;
    ownerReferenceCount: number;
    epoch: number;
    identityOrder: number;
    inputIndex: number;
    orderPreserving: boolean;
    nextInGroup: MutableMeshDrawInstanceBatch | null;
}

interface OwnerRecord {
    mesh: Mesh | null;
    geometry: Geometry | null;
    material: Material | null;
    batch: MutableMeshDrawInstanceBatch | null;
    epoch: number;
    inputIndex: number;
    renderOrder: number;
    transparent: boolean;
    transparentDepth: number;
    identityOrder: number;
    slotIndex: number;
}

interface MutableDiagnostics {
    activeOwnerCount: number;
    activeInstancedBatchCount: number;
    inputCapacity: number;
    opaqueCapacity: number;
    transparentCapacity: number;
    instancedBatchCapacity: number;
    largestInstancedBatchCapacity: number;
    ownerRecordCapacity: number;
    geometryGroupCapacity: number;
    storageAllocationCount: number;
}

function compareStringIdentity(a: string, b: string): number {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function removeIdentity<T>(items: T[], target: T): boolean {
    for (let index = 0; index < items.length; index += 1) {
        if (items[index] !== target) continue;
        for (let next = index + 1; next < items.length; next += 1) {
            items[next - 1] = items[next] as T;
        }
        items.length--;
        return true;
    }
    return false;
}

function requireRecordValue<T>(value: T | null, name: string): T {
    if (value === null) throw new Error(`Mesh draw-list ${name} record is incomplete`);
    return value;
}

function compare2DOrder(a: Mesh, b: Mesh): number {
    if (a.sortingLayer !== b.sortingLayer) return a.sortingLayer - b.sortingLayer;
    if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
    return 0;
}

function isSpriteMesh(mesh: Mesh): boolean {
    return Reflect.get(mesh, 'isSprite');
}

/**
 * Shared, backend-neutral Mesh classification and ordering for the prepared-draw path.
 *
 * Opaque items are clustered deterministically by material and geometry identity after
 * `renderOrder`. Transparent inputs first receive a stable `sortingLayer`/`zIndex` ordering.
 * Direct transparent items can then use an optional camera for depth sorting. Transparent
 * instancing only merges adjacent compatible inputs, so batching never moves one 2D item across
 * another texture or material.
 */
export class MeshDrawListPlanner {
    readonly #input: Mesh[] = [];
    readonly #opaqueMeshes: Mesh[] = [];
    readonly #transparentMeshes: Mesh[] = [];
    readonly #instancedBatches: MutableMeshDrawInstanceBatch[] = [];
    readonly #opaqueItems: MeshDrawListItem[] = [];
    readonly #transparentItems: MeshDrawListItem[] = [];
    readonly #seenMeshes = new Set<Mesh>();
    readonly #owners = new Map<Mesh, OwnerRecord>();
    readonly #ownerSlots: OwnerRecord[] = [];
    readonly #ownerPool: OwnerRecord[] = [];
    readonly #geometryGroups = new Map<Geometry, Map<Material, MutableMeshDrawInstanceBatch>>();
    readonly #geometryGroupPool: Map<Material, MutableMeshDrawInstanceBatch>[] = [];
    readonly #batchPool: MutableMeshDrawInstanceBatch[] = [];
    readonly #orderPreservingBatchSlots: MutableMeshDrawInstanceBatch[] = [];
    readonly #transparentPosition = new Vector3();
    readonly #diagnosticState: MutableDiagnostics = {
        activeOwnerCount: 0,
        activeInstancedBatchCount: 0,
        inputCapacity: 0,
        opaqueCapacity: 0,
        transparentCapacity: 0,
        instancedBatchCapacity: 0,
        largestInstancedBatchCapacity: 0,
        ownerRecordCapacity: 0,
        geometryGroupCapacity: 0,
        storageAllocationCount: 0
    };
    readonly #plan: Readonly<MeshDrawListPlan>;
    readonly #diagnostics: Readonly<MeshDrawListPlannerDiagnostics>;
    #epoch = 0;
    #nextOwnerIdentityOrder = 0;
    #nextBatchIdentityOrder = 0;
    #transparentSortCamera: Camera | null = null;
    #orderPreservingBatchCursor = 0;
    #orderPreservingBatchTail: MutableMeshDrawInstanceBatch | null = null;
    #orderPreservingBatchTailInputIndex = -2;
    #inputMaterialOverride: Material | null = null;

    readonly #compareInputOrder = (a: Mesh, b: Mesh): number => {
        const displayOrder = compare2DOrder(a, b);
        if (displayOrder !== 0) return displayOrder;
        if (
            (this.#inputMaterialOverride ?? a.material) === null ||
            (this.#inputMaterialOverride ?? b.material) === null
        ) {
            throw new Error('Validated Mesh lost its material while sorting draw-list input');
        }
        const renderOrderA = isSpriteMesh(a) ? 0 : a.renderOrder;
        const renderOrderB = isSpriteMesh(b) ? 0 : b.renderOrder;
        if (renderOrderA !== renderOrderB) return renderOrderA - renderOrderB;
        const materialA = this.#inputMaterialOverride ?? a.material;
        const materialB = this.#inputMaterialOverride ?? b.material;
        if (
            materialA?.forwardQueue === 'transparent' &&
            materialB?.forwardQueue === 'transparent' &&
            this.#transparentSortCamera !== null
        ) {
            const depthA = this.transparentDepth(a);
            const depthB = this.transparentDepth(b);
            if (depthA !== depthB) return depthA - depthB;
        }
        return 0;
    };

    readonly #compareOpaque = (a: Mesh, b: Mesh): number => {
        const recordA = this.requireOwnerRecord(a);
        const recordB = this.requireOwnerRecord(b);
        if (recordA.renderOrder !== recordB.renderOrder) {
            return recordA.renderOrder - recordB.renderOrder;
        }
        const materialA = requireRecordValue(recordA.material, 'material');
        const materialB = requireRecordValue(recordB.material, 'material');
        let order = compareStringIdentity(materialA.id, materialB.id);
        if (order !== 0) return order;
        const geometryA = requireRecordValue(recordA.geometry, 'geometry');
        const geometryB = requireRecordValue(recordB.geometry, 'geometry');
        order = compareStringIdentity(geometryA.id, geometryB.id);
        if (order !== 0) return order;
        order = compareStringIdentity(a.id, b.id);
        return order === 0 ? recordA.identityOrder - recordB.identityOrder : order;
    };

    readonly #compareTransparent = (a: Mesh, b: Mesh): number => {
        const recordA = this.requireOwnerRecord(a);
        const recordB = this.requireOwnerRecord(b);
        const displayOrder = compare2DOrder(a, b);
        if (displayOrder !== 0) return displayOrder;
        const renderOrderA = isSpriteMesh(a) ? 0 : recordA.renderOrder;
        const renderOrderB = isSpriteMesh(b) ? 0 : recordB.renderOrder;
        if (renderOrderA !== renderOrderB) {
            return renderOrderA - renderOrderB;
        }
        return recordA.inputIndex - recordB.inputIndex;
    };

    readonly #compareOpaqueItem = (a: MeshDrawListItem, b: MeshDrawListItem): number => {
        const batchA = isMeshDrawInstanceBatch(a);
        const batchB = isMeshDrawInstanceBatch(b);
        const recordA = batchA ? null : this.requireOwnerRecord(a);
        const recordB = batchB ? null : this.requireOwnerRecord(b);
        const renderOrderA = batchA ? a.renderOrder : (recordA?.renderOrder ?? 0);
        const renderOrderB = batchB ? b.renderOrder : (recordB?.renderOrder ?? 0);
        if (renderOrderA !== renderOrderB) return renderOrderA - renderOrderB;
        const materialA = batchA
            ? a.material
            : requireRecordValue(recordA?.material ?? null, 'material');
        const materialB = batchB
            ? b.material
            : requireRecordValue(recordB?.material ?? null, 'material');
        let order = compareStringIdentity(materialA.id, materialB.id);
        if (order !== 0) return order;
        const geometryA = batchA
            ? a.geometry
            : requireRecordValue(recordA?.geometry ?? null, 'geometry');
        const geometryB = batchB
            ? b.geometry
            : requireRecordValue(recordB?.geometry ?? null, 'geometry');
        order = compareStringIdentity(geometryA.id, geometryB.id);
        if (order !== 0) return order;
        if (batchA !== batchB) return batchA ? 1 : -1;
        if (!batchA && !batchB) return this.#compareOpaque(a, b);
        const mutableA = a as MutableMeshDrawInstanceBatch;
        const mutableB = b as MutableMeshDrawInstanceBatch;
        return mutableA.identityOrder - mutableB.identityOrder;
    };

    readonly #compareTransparentItem = (a: MeshDrawListItem, b: MeshDrawListItem): number => {
        const inputIndexA = isMeshDrawInstanceBatch(a)
            ? (a as MutableMeshDrawInstanceBatch).inputIndex
            : this.requireOwnerRecord(a).inputIndex;
        const inputIndexB = isMeshDrawInstanceBatch(b)
            ? (b as MutableMeshDrawInstanceBatch).inputIndex
            : this.requireOwnerRecord(b).inputIndex;
        return inputIndexA - inputIndexB;
    };

    readonly #compareInstanced = (
        a: MutableMeshDrawInstanceBatch,
        b: MutableMeshDrawInstanceBatch
    ): number => {
        if (a.transparent !== b.transparent) return a.transparent ? 1 : -1;
        if (a.orderPreserving || b.orderPreserving) return a.inputIndex - b.inputIndex;
        if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
        let order = compareStringIdentity(a.material.id, b.material.id);
        if (order !== 0) return order;
        order = compareStringIdentity(a.geometry.id, b.geometry.id);
        return order === 0 ? a.identityOrder - b.identityOrder : order;
    };

    constructor() {
        this.#plan = Object.freeze({
            opaqueMeshes: this.#opaqueMeshes,
            transparentMeshes: this.#transparentMeshes,
            instancedBatches: this.#instancedBatches,
            opaqueItems: this.#opaqueItems,
            transparentItems: this.#transparentItems
        });
        const state = this.#diagnosticState;
        this.#diagnostics = Object.freeze({
            get activeOwnerCount() {
                return state.activeOwnerCount;
            },
            get activeInstancedBatchCount() {
                return state.activeInstancedBatchCount;
            },
            get inputCapacity() {
                return state.inputCapacity;
            },
            get opaqueCapacity() {
                return state.opaqueCapacity;
            },
            get transparentCapacity() {
                return state.transparentCapacity;
            },
            get instancedBatchCapacity() {
                return state.instancedBatchCapacity;
            },
            get largestInstancedBatchCapacity() {
                return state.largestInstancedBatchCapacity;
            },
            get ownerRecordCapacity() {
                return state.ownerRecordCapacity;
            },
            get geometryGroupCapacity() {
                return state.geometryGroupCapacity;
            },
            get storageAllocationCount() {
                return state.storageAllocationCount;
            }
        });
    }

    build(
        meshes: readonly Mesh[],
        materialOverride: Material | null = null,
        sort = true,
        transparentSortCamera: Camera | null = null
    ): Readonly<MeshDrawListPlan> {
        this.stageInput(meshes, materialOverride);
        this.#inputMaterialOverride = materialOverride;
        this.#transparentSortCamera = transparentSortCamera;
        try {
            if (sort) this.sort2DInputsIfNeeded();
            this.advanceEpoch();
            this.clearActivePlan();
            this.pruneAbsentOwners();

            for (let index = 0; index < this.#input.length; index += 1) {
                const mesh = this.#input[index];
                if (mesh === undefined)
                    throw new Error('Mesh draw-list input storage is incomplete');
                this.commitMesh(mesh, index, materialOverride);
            }

            if (sort) {
                this.#opaqueMeshes.sort(this.#compareOpaque);
                this.#transparentMeshes.sort(this.#compareTransparent);
                this.#instancedBatches.sort(this.#compareInstanced);
            }
            this.buildOrderedItems(sort);
            this.updateDiagnostics();
            return this.#plan;
        } finally {
            this.#inputMaterialOverride = null;
            this.#transparentSortCamera = null;
            this.#seenMeshes.clear();
        }
    }

    hasOwner(mesh: Mesh): boolean {
        return this.#owners.has(mesh);
    }

    /** Detach one cached Mesh owner and remove it from the currently visible plan. */
    detach(mesh: Mesh): boolean {
        const record = this.#owners.get(mesh);
        if (record === undefined) return false;
        removeIdentity(this.#opaqueMeshes, mesh);
        removeIdentity(this.#transparentMeshes, mesh);
        removeIdentity(this.#opaqueItems, mesh);
        removeIdentity(this.#transparentItems, mesh);
        for (const batch of this.#instancedBatches) {
            if (!batch.orderPreserving) continue;
            if (!removeIdentity(batch.meshes, mesh)) continue;
            if (batch.meshes.length === 0) removeIdentity(this.#instancedBatches, batch);
            break;
        }
        removeIdentity(this.#input, mesh);
        const slotIndex = record.slotIndex;
        const last = this.#ownerSlots.pop();
        if (last !== undefined && last !== record) {
            this.#ownerSlots[slotIndex] = last;
            last.slotIndex = slotIndex;
        }
        this.releaseOwner(record);
        this.updateDiagnostics();
        return true;
    }

    /** Empty the plan and detach every owner while retaining high-water storage for reuse. */
    reset(): void {
        this.#input.length = 0;
        this.clearActivePlan();
        while (this.#ownerSlots.length > 0) {
            const record = this.#ownerSlots.pop();
            if (record !== undefined) this.releaseOwner(record);
        }
        this.#seenMeshes.clear();
        this.updateDiagnostics();
    }

    /** Returns one stable object; reading diagnostics never allocates a snapshot. */
    diagnostics(): Readonly<MeshDrawListPlannerDiagnostics> {
        return this.#diagnostics;
    }

    private stageInput(meshes: readonly Mesh[], materialOverride: Material | null): void {
        this.#input.length = 0;
        this.#seenMeshes.clear();
        try {
            for (let index = 0; index < meshes.length; index += 1) {
                const mesh: Mesh | undefined = meshes[index];
                if (!(mesh instanceof Mesh)) {
                    throw new TypeError(
                        `Mesh draw-list entry ${String(index)} must be a Mesh instance`
                    );
                }
                const geometry = mesh.geometry;
                const material = materialOverride ?? mesh.material;
                if (geometry === null) {
                    throw new Error(`Mesh ${mesh.id} must have geometry before draw-list planning`);
                }
                if (material === null) {
                    throw new Error(`Mesh ${mesh.id} must have material before draw-list planning`);
                }
                if (!Number.isFinite(mesh.renderOrder)) {
                    throw new RangeError(`Mesh ${mesh.id} renderOrder must be finite`);
                }
                if (this.#seenMeshes.has(mesh)) {
                    throw new TypeError(`Mesh ${mesh.id} appears more than once in a draw list`);
                }
                this.#seenMeshes.add(mesh);
                this.#input.push(mesh);
            }
            if (this.#input.length > this.#diagnosticState.inputCapacity) {
                this.#diagnosticState.inputCapacity = this.#input.length;
            }
        } catch (error) {
            this.#input.length = 0;
            this.#seenMeshes.clear();
            throw error;
        }
    }

    private commitMesh(mesh: Mesh, inputIndex: number, materialOverride: Material | null): void {
        const geometry = mesh.geometry;
        const material = materialOverride ?? mesh.material;
        if (geometry === null || material === null) {
            throw new Error(
                'Validated Mesh lost its geometry or material during draw-list planning'
            );
        }
        let record = this.#owners.get(mesh);
        record ??= this.acquireOwner(mesh);
        record.epoch = this.#epoch;
        record.inputIndex = inputIndex;
        record.geometry = geometry;
        record.material = material;
        record.renderOrder = mesh.renderOrder;
        record.transparent = material.forwardQueue === 'transparent';
        record.transparentDepth = 0;
        if (record.transparent && this.#transparentSortCamera !== null) {
            mesh.worldMatrix.getTranslation(this.#transparentPosition);
            this.#transparentPosition.transformMat4(this.#transparentSortCamera.viewMatrix);
            record.transparentDepth = this.#transparentPosition.z;
        }

        if (mesh.useInstanced && record.transparent) {
            if (record.batch !== null) {
                const oldBatch = record.batch;
                record.batch = null;
                this.releaseBatchReference(oldBatch);
            }
            const batch = this.acquireOrderPreservingBatch(
                geometry,
                material,
                mesh.renderOrder,
                inputIndex
            );
            batch.meshes.push(mesh);
            if (batch.meshes.length > this.#diagnosticState.largestInstancedBatchCapacity) {
                this.#diagnosticState.largestInstancedBatchCapacity = batch.meshes.length;
            }
            return;
        }

        let batch = record.batch;
        const batchMatches =
            mesh.useInstanced &&
            batch !== null &&
            batch.geometry === geometry &&
            batch.material === material &&
            batch.renderOrder === mesh.renderOrder;
        if (!batchMatches) {
            if (batch !== null) {
                record.batch = null;
                this.releaseBatchReference(batch);
            }
            batch = null;
            if (mesh.useInstanced) {
                batch = this.acquireBatch(geometry, material, mesh.renderOrder);
                batch.ownerReferenceCount++;
                record.batch = batch;
            }
        }

        if (batch !== null) {
            this.activateBatch(batch, material, mesh.renderOrder, inputIndex);
            if (batch.meshes.length >= MAX_INSTANCES_PER_DRAW) {
                throw new Error(
                    `Instanced draw batch exceeded MAX_INSTANCES_PER_DRAW ${String(MAX_INSTANCES_PER_DRAW)}`
                );
            }
            batch.meshes.push(mesh);
            if (batch.meshes.length > this.#diagnosticState.largestInstancedBatchCapacity) {
                this.#diagnosticState.largestInstancedBatchCapacity = batch.meshes.length;
            }
        } else if (record.transparent) {
            this.#transparentMeshes.push(mesh);
        } else {
            this.#opaqueMeshes.push(mesh);
        }
    }

    private acquireOwner(mesh: Mesh): OwnerRecord {
        let record = this.#ownerPool.pop();
        if (record === undefined) {
            record = {
                mesh,
                geometry: null,
                material: null,
                batch: null,
                epoch: 0,
                inputIndex: 0,
                renderOrder: 0,
                transparent: false,
                transparentDepth: 0,
                identityOrder: 0,
                slotIndex: 0
            };
            this.#diagnosticState.ownerRecordCapacity++;
            this.#diagnosticState.storageAllocationCount++;
        }
        record.mesh = mesh;
        record.geometry = null;
        record.material = null;
        record.batch = null;
        record.epoch = 0;
        record.inputIndex = 0;
        record.renderOrder = 0;
        record.transparent = false;
        record.transparentDepth = 0;
        record.identityOrder = ++this.#nextOwnerIdentityOrder;
        record.slotIndex = this.#ownerSlots.length;
        this.#owners.set(mesh, record);
        this.#ownerSlots.push(record);
        return record;
    }

    private acquireBatch(
        geometry: Geometry,
        material: Material,
        renderOrder: number
    ): MutableMeshDrawInstanceBatch {
        let materialGroups = this.#geometryGroups.get(geometry);
        if (materialGroups === undefined) {
            materialGroups = this.#geometryGroupPool.pop();
            if (materialGroups === undefined) {
                materialGroups = new Map<Material, MutableMeshDrawInstanceBatch>();
                this.#diagnosticState.geometryGroupCapacity++;
                this.#diagnosticState.storageAllocationCount++;
            }
            this.#geometryGroups.set(geometry, materialGroups);
        }
        let batch = materialGroups.get(material);
        let tail: MutableMeshDrawInstanceBatch | null = null;
        while (batch !== undefined) {
            if (
                batch.ownerReferenceCount < MAX_INSTANCES_PER_DRAW &&
                batch.renderOrder === renderOrder
            )
                return batch;
            tail = batch;
            batch = batch.nextInGroup ?? undefined;
        }
        batch = this.#batchPool.pop();
        if (batch === undefined) {
            batch = {
                geometry,
                material,
                meshes: [],
                renderOrder: 0,
                transparent: false,
                ownerReferenceCount: 0,
                epoch: 0,
                identityOrder: 0,
                inputIndex: 0,
                orderPreserving: false,
                nextInGroup: null
            };
            this.#diagnosticState.instancedBatchCapacity++;
            this.#diagnosticState.storageAllocationCount++;
        }
        batch.geometry = geometry;
        batch.material = material;
        batch.meshes.length = 0;
        batch.renderOrder = renderOrder;
        batch.transparent = material.forwardQueue === 'transparent';
        batch.ownerReferenceCount = 0;
        batch.epoch = 0;
        batch.identityOrder = ++this.#nextBatchIdentityOrder;
        batch.inputIndex = 0;
        batch.orderPreserving = false;
        batch.nextInGroup = null;
        if (tail === null) materialGroups.set(material, batch);
        else tail.nextInGroup = batch;
        return batch;
    }

    private activateBatch(
        batch: MutableMeshDrawInstanceBatch,
        material: Material,
        renderOrder: number,
        inputIndex: number
    ): void {
        if (batch.epoch === this.#epoch) return;
        batch.epoch = this.#epoch;
        batch.meshes.length = 0;
        batch.renderOrder = renderOrder;
        batch.transparent = material.forwardQueue === 'transparent';
        batch.inputIndex = inputIndex;
        batch.orderPreserving = false;
        this.#instancedBatches.push(batch);
    }

    private acquireOrderPreservingBatch(
        geometry: Geometry,
        material: Material,
        renderOrder: number,
        inputIndex: number
    ): MutableMeshDrawInstanceBatch {
        const tail = this.#orderPreservingBatchTail;
        if (
            tail !== null &&
            this.#orderPreservingBatchTailInputIndex + 1 === inputIndex &&
            tail.geometry === geometry &&
            tail.material === material &&
            tail.renderOrder === renderOrder &&
            tail.meshes.length < MAX_INSTANCES_PER_DRAW
        ) {
            this.#orderPreservingBatchTailInputIndex = inputIndex;
            return tail;
        }

        const slotIndex = this.#orderPreservingBatchCursor++;
        let batch = this.#orderPreservingBatchSlots[slotIndex];
        if (batch === undefined) {
            batch = {
                geometry,
                material,
                meshes: [],
                renderOrder: 0,
                transparent: true,
                ownerReferenceCount: 0,
                epoch: 0,
                identityOrder: ++this.#nextBatchIdentityOrder,
                inputIndex,
                orderPreserving: true,
                nextInGroup: null
            };
            this.#orderPreservingBatchSlots.push(batch);
            this.#diagnosticState.instancedBatchCapacity++;
            this.#diagnosticState.storageAllocationCount++;
        }
        batch.geometry = geometry;
        batch.material = material;
        batch.meshes.length = 0;
        batch.renderOrder = renderOrder;
        batch.transparent = true;
        batch.ownerReferenceCount = 0;
        batch.epoch = this.#epoch;
        batch.inputIndex = inputIndex;
        batch.orderPreserving = true;
        batch.nextInGroup = null;
        this.#instancedBatches.push(batch);
        this.#orderPreservingBatchTail = batch;
        this.#orderPreservingBatchTailInputIndex = inputIndex;
        return batch;
    }

    private releaseBatchReference(batch: MutableMeshDrawInstanceBatch): void {
        if (batch.ownerReferenceCount <= 0) {
            throw new Error('Instanced draw batch owner reference count underflow');
        }
        batch.ownerReferenceCount--;
        if (batch.ownerReferenceCount > 0) return;
        removeIdentity(this.#instancedBatches, batch);
        const materialGroups = this.#geometryGroups.get(batch.geometry);
        if (materialGroups === undefined) {
            throw new Error('Instanced draw batch geometry map is inconsistent');
        }
        const head = materialGroups.get(batch.material);
        if (head === undefined) {
            throw new Error('Instanced draw batch identity map is inconsistent');
        }
        if (head === batch) {
            if (batch.nextInGroup === null) materialGroups.delete(batch.material);
            else materialGroups.set(batch.material, batch.nextInGroup);
        } else {
            let previous = head;
            while (previous.nextInGroup !== null && previous.nextInGroup !== batch) {
                previous = previous.nextInGroup;
            }
            if (previous.nextInGroup !== batch) {
                throw new Error('Instanced draw batch identity chain is inconsistent');
            }
            previous.nextInGroup = batch.nextInGroup;
        }
        if (materialGroups.size === 0) {
            this.#geometryGroups.delete(batch.geometry);
            materialGroups.clear();
            this.#geometryGroupPool.push(materialGroups);
        }
        batch.meshes.length = 0;
        batch.epoch = 0;
        batch.inputIndex = 0;
        batch.orderPreserving = false;
        batch.nextInGroup = null;
        this.#batchPool.push(batch);
    }

    private pruneAbsentOwners(): void {
        let writeIndex = 0;
        let readIndex = 0;
        while (readIndex < this.#ownerSlots.length) {
            const record = this.#ownerSlots[readIndex];
            if (record === undefined) throw new Error('Mesh draw-list owner storage is incomplete');
            readIndex++;
            const mesh = requireRecordValue(record.mesh, 'owner');
            if (!this.#seenMeshes.has(mesh)) {
                this.releaseOwner(record);
                continue;
            }
            this.#ownerSlots[writeIndex] = record;
            record.slotIndex = writeIndex;
            writeIndex++;
        }
        this.#ownerSlots.length = writeIndex;
    }

    private releaseOwner(record: OwnerRecord): void {
        const mesh = requireRecordValue(record.mesh, 'owner');
        const batch = record.batch;
        if (batch !== null) {
            removeIdentity(batch.meshes, mesh);
            record.batch = null;
            this.releaseBatchReference(batch);
        }
        this.#owners.delete(mesh);
        record.mesh = null;
        record.geometry = null;
        record.material = null;
        record.epoch = 0;
        record.inputIndex = 0;
        record.renderOrder = 0;
        record.transparent = false;
        record.transparentDepth = 0;
        record.slotIndex = -1;
        this.#ownerPool.push(record);
    }

    private clearActivePlan(): void {
        let index = 0;
        while (index < this.#instancedBatches.length) {
            const batch = this.#instancedBatches[index];
            if (batch !== undefined) batch.meshes.length = 0;
            index++;
        }
        this.#opaqueMeshes.length = 0;
        this.#transparentMeshes.length = 0;
        this.#instancedBatches.length = 0;
        this.#opaqueItems.length = 0;
        this.#transparentItems.length = 0;
        this.#orderPreservingBatchCursor = 0;
        this.#orderPreservingBatchTail = null;
        this.#orderPreservingBatchTailInputIndex = -2;
    }

    private sort2DInputsIfNeeded(): void {
        let index = 1;
        while (index < this.#input.length) {
            const previous = this.#input[index - 1];
            const current = this.#input[index];
            if (
                previous === undefined ||
                current === undefined ||
                this.#compareInputOrder(previous, current) > 0
            ) {
                break;
            }
            index++;
        }
        if (index < this.#input.length) this.#input.sort(this.#compareInputOrder);
    }

    private transparentDepth(mesh: Mesh): number {
        mesh.worldMatrix.getTranslation(this.#transparentPosition);
        this.#transparentPosition.transformMat4(
            requireRecordValue(this.#transparentSortCamera, 'transparent sort camera').viewMatrix
        );
        return this.#transparentPosition.z;
    }

    private buildOrderedItems(sort: boolean): void {
        for (const mesh of this.#opaqueMeshes) this.#opaqueItems.push(mesh);
        for (const mesh of this.#transparentMeshes) this.#transparentItems.push(mesh);
        for (const batch of this.#instancedBatches) {
            if (batch.transparent) this.#transparentItems.push(batch);
            else this.#opaqueItems.push(batch);
        }
        if (!sort) return;
        this.#opaqueItems.sort(this.#compareOpaqueItem);
        this.#transparentItems.sort(this.#compareTransparentItem);
    }

    private advanceEpoch(): void {
        if (this.#epoch === Number.MAX_SAFE_INTEGER) {
            let ownerIndex = 0;
            while (ownerIndex < this.#ownerSlots.length) {
                const record = this.#ownerSlots[ownerIndex];
                if (record !== undefined) record.epoch = 0;
                ownerIndex++;
            }
            let batchIndex = 0;
            while (batchIndex < this.#instancedBatches.length) {
                const batch = this.#instancedBatches[batchIndex];
                if (batch !== undefined) batch.epoch = 0;
                batchIndex++;
            }
            this.#epoch = 1;
            return;
        }
        this.#epoch++;
    }

    private requireOwnerRecord(mesh: Mesh): OwnerRecord {
        const record = this.#owners.get(mesh);
        if (record === undefined) throw new Error(`Mesh ${mesh.id} has no draw-list owner record`);
        return record;
    }

    private updateDiagnostics(): void {
        const state = this.#diagnosticState;
        state.activeOwnerCount = this.#ownerSlots.length;
        state.activeInstancedBatchCount = this.#instancedBatches.length;
        if (this.#opaqueMeshes.length > state.opaqueCapacity) {
            state.opaqueCapacity = this.#opaqueMeshes.length;
        }
        if (this.#transparentMeshes.length > state.transparentCapacity) {
            state.transparentCapacity = this.#transparentMeshes.length;
        }
    }
}
