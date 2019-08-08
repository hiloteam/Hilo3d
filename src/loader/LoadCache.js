import Class from '../core/Class';
import EventMixin from '../core/EventMixin';

/**
 * 加载缓存类
 * @class
 * @mixes EventMixin
 * @fires update 更新事件
 * @ignore
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
        PENDING: 1,
        LOADED: 2,
        FAILED: 3
    },
    enabled: true,
    /**
     * @constructs
     */
    constructor() {
        this._files = {};
    },
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
    get(key) {
        if (!this.enabled) {
            return null;
        }
        return this._files[key];
    },
    remove(key) {
        delete this._files[key];
    },
    clear() {
        this._files = {};
    },
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
