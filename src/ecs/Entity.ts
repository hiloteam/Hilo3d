const ENTITY_INDEX_STRIDE = 0x100000;
const ENTITY_GENERATION_STRIDE = 0x2000;
const MAX_ENTITY_INDEX = ENTITY_INDEX_STRIDE - 1;
const MAX_ENTITY_GENERATION = ENTITY_GENERATION_STRIDE - 1;
const MAX_ALLOCATOR_IDENTITY = 0xfffff;
const MIN_ENTITY_CAPACITY = 16;
let nextAllocatorIdentity = 1;

declare const entityBrand: unique symbol;

/** Opaque generation-checked identity owned by one ECS World. */
export type Entity = number & { readonly [entityBrand]: 'Entity' };

function validateCapacity(capacity: number): number {
    if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > ENTITY_INDEX_STRIDE) {
        throw new RangeError(
            `Entity capacity must be a safe integer from 0 through ${String(ENTITY_INDEX_STRIDE)}.`
        );
    }
    return capacity;
}

function encodeEntity(index: number, generation: number, allocatorIdentity: number): Entity {
    return ((allocatorIdentity * ENTITY_GENERATION_STRIDE + generation) * ENTITY_INDEX_STRIDE +
        index) as Entity;
}

function decodeEntityIndex(entity: Entity): number {
    return entity % ENTITY_INDEX_STRIDE;
}

function decodeEntityGeneration(entity: Entity): number {
    return Math.floor(entity / ENTITY_INDEX_STRIDE) % ENTITY_GENERATION_STRIDE;
}

function decodeAllocatorIdentity(entity: Entity): number {
    return Math.floor(entity / ENTITY_INDEX_STRIDE / ENTITY_GENERATION_STRIDE);
}

/** Generation-safe allocator used by the headless ECS World. */
export class EntityAllocator {
    private readonly identity: number;
    private generations: Uint32Array;
    private alive: Uint8Array;
    private freeIndices: Uint32Array;
    private freeCount = 0;
    private nextIndex = 0;
    private liveCount = 0;
    private destroyed = false;

    constructor(initialCapacity = 1024) {
        if (nextAllocatorIdentity > MAX_ALLOCATOR_IDENTITY) {
            throw new RangeError('The process exhausted its World identity space.');
        }
        this.identity = nextAllocatorIdentity;
        nextAllocatorIdentity++;
        const capacity = validateCapacity(initialCapacity);
        this.generations = new Uint32Array(capacity);
        this.alive = new Uint8Array(capacity);
        this.freeIndices = new Uint32Array(capacity);
    }

    /** Allocated entity-index capacity. */
    get capacity(): number {
        return this.generations.length;
    }

    /** Number of currently live entities. */
    get size(): number {
        return this.liveCount;
    }

    /** Allocate one live entity in amortized O(1). */
    create(): Entity {
        if (this.destroyed) throw new Error('Cannot allocate from a destroyed Entity allocator.');
        let index: number;
        if (this.freeCount > 0) {
            this.freeCount--;
            index = this.freeIndices[this.freeCount] ?? 0;
        } else {
            index = this.nextIndex;
            if (index > MAX_ENTITY_INDEX) {
                throw new RangeError('The Entity allocator exhausted its index space.');
            }
            this.ensureCapacity(index + 1);
            this.nextIndex++;
            if (this.generations[index] === 0) this.generations[index] = 1;
        }
        this.alive[index] = 1;
        this.liveCount++;
        return encodeEntity(index, this.generations[index] ?? 0, this.identity);
    }

    /** Destroy one live entity and invalidate every previously issued handle for its slot. */
    destroy(entity: Entity): number {
        const index = this.requireAliveIndex(entity);
        this.alive[index] = 0;
        this.liveCount--;
        const generation = this.generations[index] ?? 0;
        if (generation < MAX_ENTITY_GENERATION) {
            this.generations[index] = generation + 1;
            this.freeIndices[this.freeCount] = index;
            this.freeCount++;
        }
        return index;
    }

    /** Return whether a handle still names its original live entity. */
    isAlive(entity: Entity): boolean {
        if (this.destroyed) return false;
        if (!Number.isSafeInteger(entity) || entity < 0) return false;
        if (decodeAllocatorIdentity(entity) !== this.identity) return false;
        const index = decodeEntityIndex(entity);
        if (index >= this.nextIndex || this.alive[index] !== 1) return false;
        return this.generations[index] === decodeEntityGeneration(entity);
    }

    /** Resolve and validate the dense entity index represented by a public handle. */
    requireAliveIndex(entity: Entity): number {
        if (!this.isAlive(entity)) {
            throw new ReferenceError(`Entity ${String(entity)} is not alive in this World.`);
        }
        return decodeEntityIndex(entity);
    }

    /** Resolve a live entity index back to its current generation-safe handle. */
    entityAt(index: number): Entity {
        if (
            this.destroyed ||
            !Number.isSafeInteger(index) ||
            index < 0 ||
            this.alive[index] !== 1
        ) {
            throw new ReferenceError(`Entity index ${String(index)} is not alive.`);
        }
        return encodeEntity(index, this.generations[index] ?? 0, this.identity);
    }

    /** Return whether an internal entity index is currently live. */
    isIndexAlive(index: number): boolean {
        return (
            !this.destroyed &&
            Number.isSafeInteger(index) &&
            index >= 0 &&
            index < this.nextIndex &&
            this.alive[index] === 1
        );
    }

    /** Invalidate every live slot when its owning World is destroyed. */
    clear(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.alive.fill(0);
        this.liveCount = 0;
        this.freeCount = 0;
        this.nextIndex = 0;
    }

    private ensureCapacity(required: number): void {
        if (required <= this.capacity) return;
        let nextCapacity = Math.max(this.capacity, MIN_ENTITY_CAPACITY);
        while (nextCapacity < required) {
            nextCapacity = Math.min(ENTITY_INDEX_STRIDE, nextCapacity * 2);
            if (nextCapacity < required && nextCapacity === ENTITY_INDEX_STRIDE) {
                throw new RangeError('The Entity allocator exhausted its index space.');
            }
        }
        const generations = new Uint32Array(nextCapacity);
        generations.set(this.generations);
        this.generations = generations;
        const alive = new Uint8Array(nextCapacity);
        alive.set(this.alive);
        this.alive = alive;
        const freeIndices = new Uint32Array(nextCapacity);
        freeIndices.set(this.freeIndices.subarray(0, this.freeCount));
        this.freeIndices = freeIndices;
    }
}
