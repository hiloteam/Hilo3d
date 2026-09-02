const ABSENT_DENSE_INDEX = -1;
const MIN_DENSE_CAPACITY = 16;

function validateCapacity(capacity: number): number {
    if (!Number.isSafeInteger(capacity) || capacity < 0) {
        throw new RangeError('Component store capacity must be a non-negative safe integer.');
    }
    return capacity;
}

function createSparseIndex(capacity: number): Int32Array {
    const sparse = new Int32Array(capacity);
    sparse.fill(ABSENT_DENSE_INDEX);
    return sparse;
}

/** Storage contract consumed by cached queries and World component operations. */
export interface ComponentStore<T> {
    readonly length: number;
    readonly entityCapacity: number;
    readonly entityIndices: Uint32Array;
    readonly structureRevision: number;
    readonly dataRevision: number;
    ensureEntityCapacity(capacity: number): void;
    has(entityIndex: number): boolean;
    get(entityIndex: number): T;
    getByDenseIndex(denseIndex: number): T;
    getEntryRevision(entityIndex: number): number;
    /** Reject an invalid payload without changing store state. */
    validate(value: T): void;
    add(entityIndex: number, value: T): void;
    set(entityIndex: number, value: T): void;
    remove(entityIndex: number): boolean;
    clear(): void;
}

/** Factory for a component store. Hot component definitions can supply a custom SoA store. */
export type ComponentStoreFactory<T> = (initialEntityCapacity: number) => ComponentStore<T>;

/** Typed identity for one component kind. Object identity, not its name, is the runtime key. */
export class ComponentType<T> {
    /** Human-readable diagnostics name. */
    readonly name: string;
    /** Whether application and command-buffer structural writes are permitted. */
    readonly writable: boolean;
    private readonly storeFactory: (initialEntityCapacity: number) => ComponentStore<unknown>;
    declare private readonly componentValueType: T;

    constructor(name: string, storeFactory?: ComponentStoreFactory<T>, writable = true) {
        if (name.trim().length === 0) {
            throw new TypeError('Component names cannot be empty.');
        }
        this.name = name;
        this.writable = writable;
        this.storeFactory =
            storeFactory === undefined
                ? (initialEntityCapacity: number): ComponentStore<unknown> =>
                      new SparseSetComponentStore<T>(initialEntityCapacity)
                : (initialEntityCapacity: number): ComponentStore<unknown> =>
                      storeFactory(initialEntityCapacity);
    }

    /** Create this component's World-local storage. */
    createStore(initialEntityCapacity: number): ComponentStore<unknown> {
        return this.storeFactory(initialEntityCapacity);
    }
}

/** Define a typed component token with sparse-set storage unless a custom store is provided. */
export function defineComponent<T>(
    name: string,
    storeFactory?: ComponentStoreFactory<T>
): ComponentType<T> {
    return new ComponentType(name, storeFactory);
}

/**
 * Define a read-only component populated by a System-owned derived store.
 *
 * The owning System must register its store during setup before the token can be queried.
 */
export function defineDerivedComponent<T>(name: string): ComponentType<T> {
    return new ComponentType(
        name,
        () => {
            throw new Error(`Derived component ${name} requires its owning System.`);
        },
        false
    );
}

/** Dense sparse-set storage optimized for O(1) membership and structural changes. */
export class SparseSetComponentStore<T> implements ComponentStore<T> {
    private sparse: Int32Array;
    private denseEntities: Uint32Array;
    private denseEntryRevisions: Uint32Array;
    private denseValues: (T | undefined)[];
    private entryCount = 0;
    private currentStructureRevision = 0;
    private currentDataRevision = 0;

    constructor(initialEntityCapacity = 0, initialDenseCapacity = initialEntityCapacity) {
        const entityCapacity = validateCapacity(initialEntityCapacity);
        const denseCapacity = validateCapacity(initialDenseCapacity);
        this.sparse = createSparseIndex(entityCapacity);
        this.denseEntities = new Uint32Array(denseCapacity);
        this.denseEntryRevisions = new Uint32Array(denseCapacity);
        this.denseValues = new Array<T | undefined>(denseCapacity);
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

    get(entityIndex: number): T {
        const denseIndex = this.requireDenseIndex(entityIndex);
        return this.requireDenseValue(denseIndex);
    }

    getByDenseIndex(denseIndex: number): T {
        if (!Number.isSafeInteger(denseIndex) || denseIndex < 0 || denseIndex >= this.entryCount) {
            throw new RangeError(`Dense component index ${String(denseIndex)} is out of range.`);
        }
        return this.requireDenseValue(denseIndex);
    }

    getEntryRevision(entityIndex: number): number {
        return this.denseEntryRevisions[this.requireDenseIndex(entityIndex)] ?? 0;
    }

    /** Default sparse payloads rely on static typing and accept every runtime value. */
    validate(_value: T): void {
        return;
    }

    add(entityIndex: number, value: T): void {
        this.requireEntityIndexInCapacity(entityIndex);
        if (this.has(entityIndex)) {
            throw new TypeError(`Entity index ${String(entityIndex)} already has this component.`);
        }
        this.ensureDenseCapacity(this.entryCount + 1);
        const denseIndex = this.entryCount;
        this.entryCount++;
        this.sparse[entityIndex] = denseIndex;
        this.denseEntities[denseIndex] = entityIndex;
        this.denseValues[denseIndex] = value;
        this.currentStructureRevision++;
        this.currentDataRevision++;
        this.denseEntryRevisions[denseIndex] = 1;
    }

    set(entityIndex: number, value: T): void {
        const denseIndex = this.requireDenseIndex(entityIndex);
        this.denseValues[denseIndex] = value;
        this.currentDataRevision++;
        const revision = this.denseEntryRevisions[denseIndex] ?? 0;
        this.denseEntryRevisions[denseIndex] = revision === 0xffffffff ? 1 : revision + 1;
    }

    remove(entityIndex: number): boolean {
        if (!this.has(entityIndex)) return false;
        const denseIndex = this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
        const lastDenseIndex = this.entryCount - 1;
        if (denseIndex !== lastDenseIndex) {
            const movedEntity = this.denseEntities[lastDenseIndex] ?? 0;
            this.denseEntities[denseIndex] = movedEntity;
            this.denseValues[denseIndex] = this.denseValues[lastDenseIndex];
            this.denseEntryRevisions[denseIndex] = this.denseEntryRevisions[lastDenseIndex] ?? 0;
            this.sparse[movedEntity] = denseIndex;
        }
        this.sparse[entityIndex] = ABSENT_DENSE_INDEX;
        this.denseValues[lastDenseIndex] = undefined;
        this.denseEntities[lastDenseIndex] = 0;
        this.denseEntryRevisions[lastDenseIndex] = 0;
        this.entryCount--;
        this.currentStructureRevision++;
        this.currentDataRevision++;
        return true;
    }

    clear(): void {
        if (this.entryCount === 0) return;
        for (let denseIndex = 0; denseIndex < this.entryCount; denseIndex++) {
            this.denseValues[denseIndex] = undefined;
            this.denseEntities[denseIndex] = 0;
            this.denseEntryRevisions[denseIndex] = 0;
        }
        this.sparse.fill(ABSENT_DENSE_INDEX);
        this.entryCount = 0;
        this.currentStructureRevision++;
        this.currentDataRevision++;
    }

    private requireDenseIndex(entityIndex: number): number {
        if (!this.has(entityIndex)) {
            throw new ReferenceError(
                `Entity index ${String(entityIndex)} does not have this component.`
            );
        }
        return this.sparse[entityIndex] ?? ABSENT_DENSE_INDEX;
    }

    private requireDenseValue(denseIndex: number): T {
        return this.denseValues[denseIndex] as T;
    }

    private requireEntityIndexInCapacity(entityIndex: number): void {
        if (
            !Number.isSafeInteger(entityIndex) ||
            entityIndex < 0 ||
            entityIndex >= this.sparse.length
        ) {
            throw new RangeError(
                `Entity index ${String(entityIndex)} exceeds component store capacity ${String(this.sparse.length)}.`
            );
        }
    }

    private ensureDenseCapacity(required: number): void {
        if (required <= this.denseEntities.length) return;
        let capacity = Math.max(this.denseEntities.length, MIN_DENSE_CAPACITY);
        while (capacity < required) capacity *= 2;
        const denseEntities = new Uint32Array(capacity);
        denseEntities.set(this.denseEntities.subarray(0, this.entryCount));
        this.denseEntities = denseEntities;
        const denseEntryRevisions = new Uint32Array(capacity);
        denseEntryRevisions.set(this.denseEntryRevisions.subarray(0, this.entryCount));
        this.denseEntryRevisions = denseEntryRevisions;
        this.denseValues.length = capacity;
    }
}
