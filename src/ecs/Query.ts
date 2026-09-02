import type { ComponentStore, ComponentType } from './Component';

const ABSENT_DENSE_INDEX = -1;
const MIN_QUERY_CAPACITY = 16;

/** Component inclusion and exclusion contract for a cached World query. */
export interface QueryDescription {
    readonly all: readonly ComponentType<unknown>[];
    readonly none?: readonly ComponentType<unknown>[];
}

/** Incrementally maintained dense set of internal entity indices matching one component query. */
export class CachedQuery {
    /** Normalized component types that must be present. */
    readonly all: readonly ComponentType<unknown>[];
    /** Normalized component types that must be absent. */
    readonly none: readonly ComponentType<unknown>[];
    private readonly allStores: readonly ComponentStore<unknown>[];
    private readonly noneStores: readonly ComponentStore<unknown>[];
    private sparse: Int32Array;
    private denseEntities: Uint32Array;
    private matchCount = 0;
    private currentRevision = 0;

    constructor(
        all: readonly ComponentType<unknown>[],
        none: readonly ComponentType<unknown>[],
        allStores: readonly ComponentStore<unknown>[],
        noneStores: readonly ComponentStore<unknown>[],
        entityCapacity: number,
        initialDenseCapacity: number
    ) {
        if (all.length === 0) {
            throw new TypeError('Cached queries must require at least one component.');
        }
        this.all = Object.freeze([...all]);
        this.none = Object.freeze([...none]);
        this.allStores = Object.freeze([...allStores]);
        this.noneStores = Object.freeze([...noneStores]);
        this.sparse = new Int32Array(entityCapacity);
        this.sparse.fill(ABSENT_DENSE_INDEX);
        this.denseEntities = new Uint32Array(Math.max(MIN_QUERY_CAPACITY, initialDenseCapacity));
    }

    /** Number of currently matching entities. */
    get length(): number {
        return this.matchCount;
    }

    /** Reused dense entity-index buffer. Read only indices below {@link CachedQuery.length}. */
    get entityIndices(): Uint32Array {
        return this.denseEntities;
    }

    /** Monotonic membership revision. Component value writes do not advance it. */
    get revision(): number {
        return this.currentRevision;
    }

    /** Return whether an internal entity index is currently a query member. */
    has(entityIndex: number): boolean {
        return (
            Number.isSafeInteger(entityIndex) &&
            entityIndex >= 0 &&
            entityIndex < this.sparse.length &&
            this.sparse[entityIndex] !== ABSENT_DENSE_INDEX
        );
    }

    /** Grow entity-index addressability without changing query membership. */
    ensureEntityCapacity(capacity: number): void {
        if (capacity <= this.sparse.length) return;
        const sparse = new Int32Array(capacity);
        sparse.fill(ABSENT_DENSE_INDEX);
        sparse.set(this.sparse);
        this.sparse = sparse;
    }

    /** Re-evaluate one entity after a structural component change. */
    refresh(entityIndex: number): void {
        this.ensureEntityCapacity(entityIndex + 1);
        const matches = this.matchesStores(entityIndex);
        const present = this.has(entityIndex);
        if (matches === present) return;
        if (matches) this.add(entityIndex);
        else this.remove(entityIndex);
    }

    /** Remove an entity without evaluating component stores, used during entity destruction. */
    remove(entityIndex: number): void {
        if (!this.has(entityIndex)) return;
        const denseIndex = this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
        const lastDenseIndex = this.matchCount - 1;
        if (denseIndex !== lastDenseIndex) {
            const movedEntity = this.denseEntities[lastDenseIndex] ?? 0;
            this.denseEntities[denseIndex] = movedEntity;
            this.sparse[movedEntity] = denseIndex;
        }
        this.denseEntities[lastDenseIndex] = 0;
        this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
        this.matchCount--;
        this.currentRevision++;
    }

    /** Reset all membership while retaining allocated buffers. */
    clear(): void {
        if (this.matchCount === 0) return;
        for (let denseIndex = 0; denseIndex < this.matchCount; denseIndex++) {
            const entityIndex = this.denseEntities[denseIndex] ?? 0;
            this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
            this.denseEntities[denseIndex] = 0;
        }
        this.matchCount = 0;
        this.currentRevision++;
    }

    private matchesStores(entityIndex: number): boolean {
        for (const store of this.allStores) {
            if (!store.has(entityIndex)) return false;
        }
        for (const store of this.noneStores) {
            if (store.has(entityIndex)) return false;
        }
        return true;
    }

    private add(entityIndex: number): void {
        this.ensureDenseCapacity(this.matchCount + 1);
        this.sparse[entityIndex] = this.matchCount;
        this.denseEntities[this.matchCount] = entityIndex;
        this.matchCount++;
        this.currentRevision++;
    }

    private ensureDenseCapacity(required: number): void {
        if (required <= this.denseEntities.length) return;
        let capacity = Math.max(this.denseEntities.length, MIN_QUERY_CAPACITY);
        while (capacity < required) capacity *= 2;
        const denseEntities = new Uint32Array(capacity);
        denseEntities.set(this.denseEntities.subarray(0, this.matchCount));
        this.denseEntities = denseEntities;
    }
}
