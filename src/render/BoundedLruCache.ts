/**
 * Mark an entry as most recently used and discard the oldest entries above `maxEntries`.
 *
 * Callers validate/configure the positive bound once, outside their hot lookup path. An optional
 * eviction hook lets native-resource caches defer or perform destruction when dropping a value.
 */
export function touchBoundedLruEntry<Key, Value>(
    cache: Map<Key, Value>,
    key: Key,
    value: Value,
    maxEntries: number,
    onEvict?: (value: Value, key: Key) => void
): void {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > maxEntries) {
        const oldest = cache.entries().next();
        if (oldest.done) return;
        const [oldestKey, oldestValue] = oldest.value;
        cache.delete(oldestKey);
        onEvict?.(oldestValue, oldestKey);
    }
}
