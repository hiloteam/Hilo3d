/** A keyed cache with optional object-identity lookup. */
class Cache<Value = unknown> {
    private readonly entries = new Map<string, Value>();
    private objectIds = new WeakMap<object, string>();

    /** @internal Renderer diagnostics only; not part of the public cache contract. */
    get size(): number {
        return this.entries.size;
    }

    get(id: string): Value | undefined {
        return this.entries.get(id);
    }

    getObject(object: object): Value | undefined {
        const id = this.objectIds.get(object);
        return id === undefined ? undefined : this.entries.get(id);
    }

    add(id: string, value: Value): void {
        this.entries.set(id, value);
        if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
            this.objectIds.set(value, id);
        }
    }

    remove(id: string): void {
        const value = this.entries.get(id);
        if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
            this.objectIds.delete(value);
        }
        this.entries.delete(id);
    }

    removeObject(object: object): void {
        const id = this.objectIds.get(object);
        if (id === undefined) return;
        this.objectIds.delete(object);
        this.entries.delete(id);
    }

    removeAll(): void {
        this.entries.clear();
        this.objectIds = new WeakMap<object, string>();
    }

    each(callback: (value: Value, id: string) => void): void {
        for (const [id, value] of this.entries) callback(value, id);
    }
}

export default Cache;
