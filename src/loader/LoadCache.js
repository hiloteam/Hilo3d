import Class from '../core/Class';
import EventMixin from '../core/EventMixin';

/**
 * 加载缓存类
 * @class
 * @mixes EventMixin
 * @fires update 更新事件
 */
const LoadCache = Class.create(/** @lends LoadCache.prototype */ {
    Mixes: EventMixin,
    /**
     * @default true
     * @type {Boolean}
     */
    isLoadCache: true,
    /**
     * @default LoadCache
     * @type {String}
     */
    className: 'LoadCache',
    Statics: {
        /**
         * PENDING
         * @memberOf LoadCache
         * @readOnly
         * @default 1
         * @type {Number}
         */
        PENDING: 1,
        /**
         * PENDING
         * @memberOf LoadCache
         * @readOnly
         * @default 2
         * @type {Number}
         */
        LOADED: 2,
        /**
         * FAILED
         * @memberOf LoadCache
         * @readOnly
         * @default 3
         * @type {Number}
         */
        FAILED: 3
    },
    /**
     * enabled
     * @default true
     * @type {Boolean}
     */
    enabled: true,
    /**
     * @constructs
     */
    constructor() {
        this._files = {};
    },
    /**
     * update
     * @param  {string} key
     * @param  {number} state 可选值为：LoadCache.LOADED LoadCache.PENDING LoadCache.FAILED
     * @param  {any} data
     */
    update(key, state, data) {
        if (!this.enabled) {
            return;
        }
        let file = {
            key,
            state,
            data
        };
        this._files[key] = file;
        this.fire('update', file);
        this.fire(`update:${file.key}`, file);
    },
    /**
     * get
     * @param  {string} key
     * @return {ILoadCacheFile}
     */
    get(key) {
        if (!this.enabled) {
            return null;
        }
        return this._files[key];
    },
    /**
     * 获取下载完成的资源，没下载完或下载失败返回 null
     * @param  {string} key
     * @return {any}
     */
    getLoaded(key) {
        const file = this.get(key);
        if (file && file.state === LoadCache.LOADED) {
            return file.data;
        }

        return null;
    },
    /**
     * remove
     * @param  {string} key
     */
    remove(key) {
        delete this._files[key];
    },
    /**
     * clear
     */
    clear() {
        this._files = {};
    },
    /**
     * wait
     * @param  {ILoadCacheFile} file
     * @return {Promise<any>}
     */
    wait(file) {
        if (!file) {
            return Promise.reject();
        }

        if (file.state === LoadCache.LOADED) {
            return Promise.resolve(file.data);
        }

        if (file.state === LoadCache.FAILED) {
            return Promise.reject();
        }

        return new Promise((resolve, reject) => {
            this.on(`update:${file.key}`, (evt) => {
                let file = evt.detail;
                if (file.state === LoadCache.LOADED) {
                    resolve(file.data);
                } else if (file.state === LoadCache.FAILED) {
                    reject(file.data);
                }
            }, true);
        });
    }
});

export default LoadCache;

/**
 * @interface ILoadCacheFile
 * @property {string} key
 * @property {number} state 可选值为：LoadCache.LOADED LoadCache.PENDING LoadCache.FAILED
 * @property {any} data
 */
