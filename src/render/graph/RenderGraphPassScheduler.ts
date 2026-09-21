import { renderGraphFailure } from './RenderGraphValidation';

/**
 * Stable Kahn scheduling with a minimum source-index ready heap.
 * Numeric scratch storage grows only at the historical pass-count high-water mark.
 */
export class RenderGraphPassScheduler {
    #indegree = new Uint32Array(0);
    #ready = new Uint32Array(0);
    #order = new Uint32Array(0);
    #readyCount = 0;

    get capacity(): number {
        return this.#indegree.length;
    }

    /** Reserve scratch capacity; returns whether its backing storage grew. */
    reserve(passCount: number): boolean {
        if (passCount <= this.capacity) return false;
        let capacity = Math.max(1, this.capacity);
        while (capacity < passCount) capacity *= 2;
        this.#indegree = new Uint32Array(capacity);
        this.#ready = new Uint32Array(capacity);
        this.#order = new Uint32Array(capacity);
        return true;
    }

    /**
     * Schedule in O(E + P log P), choosing the lowest currently ready source index.
     * Only the first `passCount` result entries are valid; the next call reuses them.
     * The compiler must copy surviving indices into its immutable compile result.
     */
    schedule(
        outgoing: readonly ReadonlySet<number>[],
        incoming: readonly ReadonlySet<number>[],
        passCount: number
    ): Readonly<Uint32Array> {
        this.reserve(passCount);
        this.#readyCount = 0;
        for (let index = 0; index < passCount; index += 1) {
            const dependencies = incoming[index]?.size ?? 0;
            this.#indegree[index] = dependencies;
            // Initial source order is already a valid minimum heap.
            if (dependencies === 0) this.#ready[this.#readyCount++] = index;
        }
        for (let order = 0; order < passCount; order += 1) {
            if (this.#readyCount === 0) {
                renderGraphFailure('cycle', 'render graph contains a pass cycle');
            }
            const selected = this.popReady();
            this.#order[order] = selected;
            const dependents = outgoing[selected];
            if (dependents === undefined) {
                throw new Error('Render graph dependency index is invalid');
            }
            for (const dependent of dependents) {
                const value = this.#indegree[dependent];
                if (dependent >= passCount || value === undefined || value === 0) {
                    throw new Error('Render graph dependency index is invalid');
                }
                this.#indegree[dependent] = value - 1;
                if (value === 1) this.pushReady(dependent);
            }
        }
        return this.#order;
    }

    private pushReady(sourceIndex: number): void {
        let index = this.#readyCount++;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            const parentValue = this.#ready[parent];
            if (parentValue === undefined) throw new Error('Render graph ready heap is invalid');
            if (parentValue <= sourceIndex) break;
            this.#ready[index] = parentValue;
            index = parent;
        }
        this.#ready[index] = sourceIndex;
    }

    private popReady(): number {
        const selected = this.#ready[0];
        const tail = this.#ready[--this.#readyCount];
        if (selected === undefined || tail === undefined) {
            throw new Error('Render graph ready heap is invalid');
        }
        let index = 0;
        while (index * 2 + 1 < this.#readyCount) {
            let child = index * 2 + 1;
            let childValue = this.#ready[child];
            if (childValue === undefined) throw new Error('Render graph ready heap is invalid');
            const right = child + 1;
            const rightValue = this.#ready[right];
            if (right < this.#readyCount && rightValue !== undefined && rightValue < childValue) {
                child = right;
                childValue = rightValue;
            }
            if (tail <= childValue) break;
            this.#ready[index] = childValue;
            index = child;
        }
        if (this.#readyCount !== 0) this.#ready[index] = tail;
        return selected;
    }
}
