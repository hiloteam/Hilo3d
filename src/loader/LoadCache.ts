import { EventObject, EventMixinCallback } from '../core/EventMixin';

/**
 * @interface ILoadCacheFile
 * @property {string} key
 * @property {number} state 可选值为：LoadCache.PENDING LoadCache.LOADED LoadCache.FAILED
 * @property {any} data
 */
interface ILoadCacheFile {
    key: string;
    state: number; // LoadCache.PENDING | LoadCache.LOADED | LoadCache.FAILED
    data: any;
}

interface EventListener {
    listener: EventMixinCallback;
    once?: boolean;
}

/**
 * 加载缓存类
 * @class
 * @fires update 更新事件
 */
class LoadCache {
    /**
     * PENDING
     * @readOnly
     * @default 1
     * @type {Number}
     */
    static readonly PENDING: number = 1;

    /**
     * LOADED
     * @readOnly
     * @default 2
     * @type {Number}
     */
    static readonly LOADED: number = 2;

    /**
     * FAILED
     * @readOnly
     * @default 3
     * @type {Number}
     */
    static readonly FAILED: number = 3;

    /**
     * @default true
     * @type {Boolean}
     */
    isLoadCache: boolean = true;

    /**
     * @default LoadCache
     * @type {String}
     */
    className: string = 'LoadCache';

    /**
     * enabled
     * @default true
     * @type {Boolean}
     */
    enabled: boolean = true;

    private _files: Record<string, ILoadCacheFile> = {};

    private _listeners: Record<string, EventListener[]> = {};

    /**
     * 增加一个事件监听。
     * @param {String} type 要监听的事件类型。
     * @param {EventMixinCallback} listener 事件监听回调函数。
     * @param {Boolean} [once] 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
     * @return {LoadCache} 对象本身。链式调用支持。
     */
    on(type: string, listener: EventMixinCallback, once?: boolean): this {
        let listeners = this._listeners;
        let eventListeners = (listeners[type] = listeners[type] || []);
        for (let i = 0, len = eventListeners.length; i < len; i++) {
            let el = eventListeners[i];
            if (el.listener === listener) {
                return this;
            }
        }
        eventListeners.push({
            listener,
            once
        });
        return this;
    }

    /**
     * 删除一个事件监听。如果不传入任何参数，则删除所有的事件监听；如果不传入第二个参数，则删除指定类型的所有事件监听。
     * @param {String} [type] 要删除监听的事件类型。
     * @param {EventMixinCallback} [listener] 要删除监听的回调函数。
     * @returns {LoadCache} 对象本身。链式调用支持。
     */
    off(type?: string, listener?: EventMixinCallback): this {
        // remove all event listeners
        if (arguments.length === 0) {
            this._listeners = {};
            return this;
        }

        let eventListeners = this._listeners[type!];
        if (eventListeners && eventListeners.length > 0) {
            // remove event listeners by specified type
            if (arguments.length === 1) {
                delete this._listeners[type!];
                return this;
            }

            for (let i = 0, len = eventListeners.length; i < len; i++) {
                let el = eventListeners[i];
                if (el.listener === listener) {
                    eventListeners.splice(i, 1);
                    break;
                }
            }
        }
        return this;
    }

    /**
     * 发送事件。当第一个参数类型为Object时，则把它作为一个整体事件对象。
     * @param {String|EventObject} [type] 要发送的事件类型或者一个事件对象。
     * @param {Object} [detail] 要发送的事件的具体信息，即事件随带参数。
     * @returns {Boolean} 是否成功调度事件。
     */
    fire(type: string | EventObject, detail?: any): boolean {
        let event: EventObject | undefined;
        let eventType: string;
        if (typeof type === 'string') {
            eventType = type;
        } else {
            event = type;
            eventType = type.type;
        }

        let listeners = this._listeners;
        let eventListeners = listeners[eventType];
        if (eventListeners && eventListeners.length > 0) {
            let eventListenersCopy = eventListeners.slice(0);
            event = event || new EventObject(eventType, this, detail);
            if (event._stopped) return false;

            for (let i = 0; i < eventListenersCopy.length; i++) {
                let el = eventListenersCopy[i];
                el.listener.call(this, event);
                if (el.once) {
                    let index = eventListeners.indexOf(el);
                    if (index > -1) {
                        eventListeners.splice(index, 1);
                    }
                }
            }

            return true;
        }
        return false;
    }

    /**
     * update
     * @param  {string} key
     * @param  {number} state 可选值为：LoadCache.LOADED LoadCache.PENDING LoadCache.FAILED
     * @param  {any} data
     */
    update(key: string, state: number, data?: any): void {
        if (!this.enabled) {
            return;
        }
        let file: ILoadCacheFile = {
            key,
            state,
            data
        };
        this._files[key] = file;
        this.fire('update', file);
        this.fire(`update:${file.key}`, file);
    }

    /**
     * get
     * @param  {string} key
     * @return {ILoadCacheFile}
     */
    get(key: string): ILoadCacheFile | null {
        if (!this.enabled) {
            return null;
        }
        return this._files[key];
    }

    /**
     * 获取下载完成的资源，没下载完或下载失败返回 null
     * @param  {string} key
     * @return {any}
     */
    getLoaded(key: string): any {
        const file = this.get(key);
        if (file && file.state === LoadCache.LOADED) {
            return file.data;
        }

        return null;
    }

    /**
     * remove
     * @param  {string} key
     */
    remove(key: string): void {
        delete this._files[key];
    }

    /**
     * clear
     */
    clear(): void {
        this._files = {};
    }

    /**
     * wait
     * @param  {ILoadCacheFile} file
     * @return {Promise<any>}
     */
    wait(file: ILoadCacheFile | null): Promise<any> {
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
            this.on(`update:${file.key}`, (evt: EventObject) => {
                let file = evt.detail;
                if (file.state === LoadCache.LOADED) {
                    resolve(file.data);
                } else if (file.state === LoadCache.FAILED) {
                    reject(file.data);
                }
            }, true);
        });
    }
}

export default LoadCache;
