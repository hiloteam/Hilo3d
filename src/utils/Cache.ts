interface CacheableObject {
    __cacheId?: string;
}

/**
 * 缓存类
 * @class
 * @example
 * const cache = new Hilo3d.Cache();
 * cache.add('id1', {a:1});
 * cache.get('id1');
 * cache.remove('id1');
 */
class Cache<T = any> {
    private _cache: Record<string, T> = {};

    /**
     * 获取对象
     * @param id 缓存ID
     * @return 缓存的对象
     */
    get(id: string): T | undefined {
        return this._cache[id];
    }

    /**
     * 获取对象
     * @param obj 包含__cacheId的对象
     * @return 缓存的对象
     */
    getObject(obj: CacheableObject): T | undefined {
        return this._cache[obj.__cacheId!];
    }

    /**
     * 增加对象
     * @param id 缓存ID
     * @param obj 要缓存的对象
     */
    add(id: string, obj: T): void {
        if (typeof obj === 'object' && obj !== null) {
            (obj as any).__cacheId = id;
        }
        this._cache[id] = obj;
    }

    /**
     * 移除对象
     * @param id 缓存ID
     */
    remove(id: string): void {
        delete this._cache[id];
    }

    /**
     * 移除对象
     * @param obj 包含__cacheId的对象
     */
    removeObject(obj: CacheableObject): void {
        delete this._cache[obj.__cacheId!];
    }

    /**
     * 移除所有对象
     */
    removeAll(): void {
        this._cache = {};
    }

    /**
     * 遍历所有缓存
     * @param callback 回调函数(value, id)
     */
    each(callback: (value: T, id: string) => void): void {
        const cache = this._cache;
        for (const id in cache) {
            callback(cache[id], id);
        }
    }
}

export default Cache;
