import Class from '../core/Class';

/**
 * 缓存类
 * @class
 * @example
 * const cache = new Hilo3d.Cache();
 * cache.add('id1', {a:1});
 * cache.get('id1');
 * cache.remove('id1');
 */
const Cache = Class.create(/** @lends Cache.prototype */ {
    /**
     * @constructs
     */
    constructor() {
        this._cache = {};
    },
    /**
     * 获取对象
     * @param  {String} id
     * @return {Object}
     */
    get(id) {
        return this._cache[id];
    },
    /**
     * 获取对象
     * @param {Object} obj
     * @return {Object} [description]
     */
    getObject(obj) {
        return this._cache[obj.__cacheId];
    },
    /**
     * 增加对象
     * @param {String} id
     * @param {Object} obj
     */
    add(id, obj) {
        if (typeof obj === 'object') {
            obj.__cacheId = id;
        }
        this._cache[id] = obj;
    },
    /**
     * 移除对象
     * @param {String} id
     */
    remove(id) {
        delete this._cache[id];
    },
    /**
     * 移除对象
     * @param {Object} obj
     */
    removeObject(obj) {
        delete this._cache[obj.__cacheId];
    },
    /**
     * 移除所有对象
     */
    removeAll() {
        this._cache = {};
    },
    /**
     * 遍历所有缓存
     * @param  {Function} callback
     */
    each(callback) {
        const cache = this._cache;
        for (let id in cache) {
            callback(cache[id], id);
        }
    }
});

export default Cache;
