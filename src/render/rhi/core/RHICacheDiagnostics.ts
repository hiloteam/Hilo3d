/**
 * Allocation-free cumulative counters for one concrete or logical runtime cache.
 *
 * `hits + misses` is the exact lookup count. `size` is the number of live cache entries, while
 * `evictions` counts entries replaced, explicitly released, or discarded during teardown/loss.
 * Native-object creation remains a separate diagnostic and must not be inferred from these values.
 */
export interface RHICacheCounters {
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
    readonly size: number;
    readonly highWater: number;
}

function requirePositiveCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1) {
        throw new RangeError('Cache counter changes must be positive safe integers');
    }
}

function checkedIncrement(value: number, count: number): number {
    const result = value + count;
    if (result < -0x1fffffffffffff || result > 0x1fffffffffffff || result % 1 !== 0) {
        throw new RangeError('Cache counter space is exhausted');
    }
    return result;
}

function requireCounters(counters: Readonly<RHICacheCounters>): void {
    const values = [
        counters.hits,
        counters.misses,
        counters.evictions,
        counters.size,
        counters.highWater
    ];
    for (const value of values) {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new RangeError('Cache counters must be non-negative safe integers');
        }
    }
    if (counters.highWater < counters.size) {
        throw new RangeError('Cache high-water size cannot be below current size');
    }
}

/** Mutable recorder whose public reads and hot-path increments never allocate. */
export class RHICacheCounter implements RHICacheCounters {
    #hits = 0;
    #misses = 0;
    #evictions = 0;
    #size = 0;
    #highWater = 0;

    get hits(): number {
        return this.#hits;
    }

    get misses(): number {
        return this.#misses;
    }

    get evictions(): number {
        return this.#evictions;
    }

    get size(): number {
        return this.#size;
    }

    get highWater(): number {
        return this.#highWater;
    }

    recordHit(): void {
        this.#hits = checkedIncrement(this.#hits, 1);
    }

    recordMiss(): void {
        this.#misses = checkedIncrement(this.#misses, 1);
    }

    /** Record newly retained entries after their cache-miss construction succeeds. */
    recordInsertion(count = 1): void {
        requirePositiveCount(count);
        this.#size = checkedIncrement(this.#size, count);
        if (this.#size > this.#highWater) this.#highWater = this.#size;
    }

    /** Record replacement of live entries without changing cache cardinality. */
    recordReplacement(count = 1): void {
        requirePositiveCount(count);
        if (count > this.#size) {
            throw new RangeError('Cannot replace more cache entries than are live');
        }
        this.#evictions = checkedIncrement(this.#evictions, count);
    }

    /** Record explicit release, bounded eviction, teardown, or device-loss invalidation. */
    recordRemoval(count = 1): void {
        requirePositiveCount(count);
        if (count > this.#size) {
            throw new RangeError('Cannot remove more cache entries than are live');
        }
        this.#size -= count;
        this.#evictions = checkedIncrement(this.#evictions, count);
    }

    clear(): void {
        if (this.#size > 0) this.recordRemoval(this.#size);
    }
}

/**
 * Stable zero-allocation view over several independent counters. It is useful when one renderer
 * feature owns multiple logical caches that contribute to one reported category.
 */
export class RHICacheCounterAggregate implements RHICacheCounters {
    constructor(readonly sources: readonly Readonly<RHICacheCounters>[]) {
        if (sources.length === 0) {
            throw new RangeError('A cache counter aggregate requires at least one source');
        }
    }

    get hits(): number {
        return this.sum('hits');
    }

    get misses(): number {
        return this.sum('misses');
    }

    get evictions(): number {
        return this.sum('evictions');
    }

    get size(): number {
        return this.sum('size');
    }

    get highWater(): number {
        return this.sum('highWater');
    }

    private sum(metric: keyof RHICacheCounters): number {
        let total = 0;
        for (const source of this.sources) {
            total += source[metric];
        }
        if (!Number.isSafeInteger(total)) {
            throw new RangeError('Aggregated cache counter space is exhausted');
        }
        return total;
    }
}

/**
 * Stable cumulative view over cache providers that are replaced at a device-generation boundary.
 * Rebinding retires every still-live entry from the old provider and preserves lifetime totals.
 */
export class RHICacheCounterContinuation implements RHICacheCounters {
    #source: Readonly<RHICacheCounters>;
    #retiredHits = 0;
    #retiredMisses = 0;
    #retiredEvictions = 0;
    #retiredHighWater = 0;

    constructor(source: Readonly<RHICacheCounters>) {
        requireCounters(source);
        this.#source = source;
    }

    get hits(): number {
        return checkedIncrement(this.#retiredHits, this.#source.hits);
    }

    get misses(): number {
        return checkedIncrement(this.#retiredMisses, this.#source.misses);
    }

    get evictions(): number {
        return checkedIncrement(this.#retiredEvictions, this.#source.evictions);
    }

    get size(): number {
        return this.#source.size;
    }

    get highWater(): number {
        return Math.max(this.#retiredHighWater, this.#source.highWater);
    }

    /** Adopt the next device generation's empty cache provider without resetting totals. */
    rebind(source: Readonly<RHICacheCounters>): void {
        if (source === this.#source) return;
        requireCounters(this.#source);
        requireCounters(source);
        this.#retiredHits = checkedIncrement(this.#retiredHits, this.#source.hits);
        this.#retiredMisses = checkedIncrement(this.#retiredMisses, this.#source.misses);
        this.#retiredEvictions = checkedIncrement(
            this.#retiredEvictions,
            checkedIncrement(this.#source.evictions, this.#source.size)
        );
        this.#retiredHighWater = Math.max(this.#retiredHighWater, this.#source.highWater);
        this.#source = source;
    }
}
