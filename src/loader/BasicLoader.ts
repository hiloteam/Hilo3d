import { EventObject, EventMixinCallback } from '../core/EventMixin';
import LoadCache from './LoadCache';
import log from '../utils/log';
import {
    getExtension,
    each
} from '../utils/util';

const cache = new LoadCache();

interface EventListener {
    listener: EventMixinCallback;
    once?: boolean;
}

interface LoadData {
    src: string;
    type?: string;
    defaultType?: string;
    crossOrigin?: boolean;
}

interface RequestOptions {
    url: string;
    type?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    credentials?: string;
}

/**
 * 基础的资源加载类
 * @class
 * @fires beforeload loaded failed
 * @fires beforeload 加载前事件
 * @fires loaded 加载事件
 * @fires failed 失败事件
 * @fires progress 进度事件
 * @example
 * var loader = new Hilo3d.BasicLoader();
 * loader.load({
 *     src: '//img.alicdn.com/tfs/TB1aNxtQpXXXXX1XVXXXXXXXXXX-1024-1024.jpg',
 *     crossOrigin: true
 * }).then(img => {
 *     return new Hilo3d.Texture({
 *         image: img
 *     });
 * }, err => {
 *     return new Hilo3d.Color(1, 0, 0);
 * }).then(diffuse => {
 *     return new Hilo3d.BasicMaterial({
 *         diffuse: diffuse
 *     });
 * });
 */
class BasicLoader {
    /**
     * @default true
     * @type {boolean}
     */
    isBasicLoader: boolean = true;

    /**
     * @default BasicLoader
     * @type {string}
     */
    className: string = 'BasicLoader';

    private _listeners: Record<string, EventListener[]> | null = null;

    static _cache: LoadCache = cache;

    /**
     * TYPE_IMAGE
     * @readOnly
     * @default 'img'
     * @type {string}
     */
    static readonly TYPE_IMAGE: string = 'img';

    /**
     * TYPE_JSON
     * @readOnly
     * @default 'json'
     * @type {string}
     */
    static readonly TYPE_JSON: string = 'json';

    /**
     * TYPE_BUFFER
     * @readOnly
     * @default 'buffer'
     * @type {string}
     */
    static readonly TYPE_BUFFER: string = 'buffer';

    /**
     * TYPE_TEXT
     * @readOnly
     * @default 'text'
     * @type {string}
     */
    static readonly TYPE_TEXT: string = 'text';

    /**
     * cache
     * @readOnly
     * @type {LoadCache}
     */
    static get cache(): LoadCache {
        return cache;
    }

    static set cache(value: LoadCache) {
        log.warn('BasicLoader.cache is readonly!');
    }

    /**
     * enalbeCache
     */
    static enalbeCache(): void {
        cache.enabled = true;
    }

    /**
     * disableCache
     */
    static disableCache(): void {
        cache.enabled = false;
    }

    /**
     * deleteCache
     * @param  {string} key
     */
    static deleteCache(key: string): void {
        cache.remove(key);
    }

    /**
     * clearCache
     */
    static clearCache(): void {
        cache.clear();
    }

    /**
     * 增加一个事件监听。
     * @param {String} type 要监听的事件类型。
     * @param {EventMixinCallback} listener 事件监听回调函数。
     * @param {Boolean} [once] 是否是一次性监听，即回调函数响应一次后即删除，不再响应。
     * @return {BasicLoader} 对象本身。链式调用支持。
     */
    on(type: string, listener: EventMixinCallback, once?: boolean): this {
        let listeners = (this._listeners = this._listeners || {});
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
     * @returns {BasicLoader} 对象本身。链式调用支持。
     */
    off(type?: string, listener?: EventMixinCallback): this {
        if (arguments.length === 0) {
            this._listeners = null;
            return this;
        }

        let eventListeners = this._listeners && this._listeners[type!];
        if (eventListeners && eventListeners.length > 0) {
            if (arguments.length === 1) {
                delete this._listeners![type!];
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
        if (!listeners) return false;

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
     * 加载资源，这里会自动调用 loadImg 或者 loadRes
     * @param {object} data 参数
     * @param {string} data.src 资源地址
     * @param {string} [data.type] 资源类型(img, json, buffer)，不提供将根据 data.src 来判断类型
     * @return {Promise.<any, Error>} 返回加载完的资源对象
     */
    load(data: LoadData): Promise<any> {
        const src = data.src;
        let type = data.type;
        if (!type) {
            const ext = getExtension(src);
            if (/^(?:png|jpe?g|gif|webp|bmp)$/i.test(ext)) {
                type = 'img';
            }
            if (!type) {
                type = data.defaultType;
            }
        }
        if (type === BasicLoader.TYPE_IMAGE) {
            return this.loadImg(src, data.crossOrigin);
        }
        return this.loadRes(src, type);
    }

    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param {string} url 需要判断的链接
     * @return {boolean} 是否跨域
     */
    isCrossOrigin(url: string): boolean {
        const loc = window.location;
        const a = document.createElement('a');
        a.href = url;
        return a.hostname !== loc.hostname || a.port !== loc.port || a.protocol !== loc.protocol;
    }

    isBase64(url: string): boolean {
        return /^data:(.+?);base64,/.test(url);
    }

    Uint8ArrayFrom(source: string, mapFn: (char: string) => number): Uint8Array {
        if (Uint8Array.from) {
            return Uint8Array.from(source, mapFn);
        }
        const len = source.length;
        const result = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = mapFn(source[i]);
        }
        return result;
    }

    /**
     * 加载图片
     * @param {string} url 图片地址
     * @param {boolean} [crossOrigin=false] 是否跨域
     * @return {Promise.<HTMLImageElement, Error>} 返回加载完的图片
     */
    loadImg(url: string, crossOrigin?: boolean): Promise<HTMLImageElement> {
        let file = cache.get(url);

        if (file) {
            return cache.wait(file);
        }

        return new Promise((resolve, reject) => {
            let img = new Image();
            cache.update(url, LoadCache.PENDING);
            img.onload = () => {
                img.onerror = null;
                img.onabort = null;
                img.onload = null;
                cache.update(url, LoadCache.LOADED, img);
                resolve(img);
            };
            img.onerror = () => {
                img.onerror = null;
                img.onabort = null;
                img.onload = null;
                const err = new Error(`Image load failed for ${url.slice(0, 100)}`);
                cache.update(url, LoadCache.FAILED, err);
                reject(err);
            };
            img.onabort = img.onerror;
            if (crossOrigin || this.isCrossOrigin(url)) {
                if (!this.isBase64(url)) {
                    img.crossOrigin = 'anonymous';
                }
            }
            img.src = url;
        });
    }

    /**
     * 使用XHR加载其他资源
     * @param {string} url 资源地址
     * @param {string} [type=text] 资源类型(json, buffer, text)
     * @return {Promise.<any, Error>} 返回加载完的内容对象(Object, ArrayBuffer, String)
     */
    loadRes(url: string, type?: string): Promise<any> {
        if (this.isBase64(url)) {
            const mime = RegExp.$1;
            const base64Str = url.slice(13 + mime.length);
            let result: any = atob(base64Str);
            if (type === BasicLoader.TYPE_JSON) {
                result = JSON.parse(result);
            } else if (type === BasicLoader.TYPE_BUFFER) {
                result = this.Uint8ArrayFrom(result, c => c.charCodeAt(0)).buffer;
            }
            return Promise.resolve(result);
        }

        let file = cache.get(url);
        if (file) {
            return cache.wait(file);
        }

        cache.update(url, LoadCache.PENDING);

        this.fire('beforeload');

        return this.request({
            url,
            type
        }).then((data) => {
            this.fire('loaded');
            cache.update(url, LoadCache.LOADED, data);
            return data;
        }, (err) => {
            this.fire('failed', err);
            cache.update(url, LoadCache.FAILED);
            throw new Error(`Resource load failed for ${url}, ${err}`);
        });
    }

    /**
     * XHR资源请求
     * @param {object} opt 请求参数
     * @param {string} opt.url 资源地址
     * @param {string} [opt.type=text] 资源类型(json, buffer, text)
     * @param {string} [opt.method=GET] 请求类型(GET, POST ..)
     * @param {object} [opt.headers] 请求头参数
     * @param {string} [opt.body] POST请求发送的数据
     * @return {Promise.<any, Error>} 返回加载完的内容对象(Object, ArrayBuffer, String)
     */
    request(opt: RequestOptions): Promise<any> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new TypeError(`Network request failed for ${xhr.status}`));
                    return;
                }
                let result: any;
                if ('response' in xhr) {
                    result = xhr.response;
                } else {
                    result = (xhr as any).responseText;
                }
                if (opt.type === BasicLoader.TYPE_JSON) {
                    try {
                        result = JSON.parse(result as string);
                    } catch (err) {
                        reject(new TypeError('JSON.parse error' + err));
                        return;
                    }
                }
                resolve(result);
            };
            xhr.onprogress = (evt) => {
                this.fire('progress', {
                    url: opt.url,
                    loaded: evt.loaded,
                    total: evt.total,
                });
            };
            xhr.onerror = () => {
                reject(new TypeError('Network request failed'));
            };
            xhr.ontimeout = () => {
                reject(new TypeError('Network request timed out'));
            };
            xhr.open(opt.method || 'GET', opt.url, true);
            if (opt.credentials === 'include') {
                xhr.withCredentials = true;
            }
            if (opt.type === BasicLoader.TYPE_BUFFER) {
                xhr.responseType = 'arraybuffer';
            }
            each(opt.headers, (value, name) => {
                xhr.setRequestHeader(name, value);
            });
            xhr.send(opt.body || null);
        });
    }
}

export default BasicLoader;
