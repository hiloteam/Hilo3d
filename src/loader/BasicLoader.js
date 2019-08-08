import Class from '../core/Class';
import EventMixin from '../core/EventMixin';
import LoadCache from './LoadCache';
import log from '../utils/log';
import {
    getExtension,
    each
} from '../utils/util';

const cache = new LoadCache();

/**
 * 基础的资源加载类
 * @class
 * @fires beforeload loaded failed
 * @mixes EventMixin
 * @borrows EventMixin#on as #on
 * @borrows EventMixin#off as #off
 * @borrows EventMixin#fire as #fire
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
const BasicLoader = Class.create(/** @lends BasicLoader.prototype */ {
    Mixes: EventMixin,
    /**
     * @default true
     * @type {boolean}
     */
    isBasicLoader: true,
    /**
     * @default BasicLoader
     * @type {string}
     */
    className: 'BasicLoader',
    Statics: {
        _cache: cache,
        enalbeCache() {
            cache.enabled = true;
        },
        disableCache() {
            cache.enabled = false;
        },
        deleteCache(key) {
            cache.remove(key);
        },
        clearCache() {
            cache.clear();
        },
        cache: {
            get() {
                return cache;
            },
            set() {
                log.warn('BasicLoader.cache is readonly!');
            }
        }
    },
    /**
     * 加载资源，这里会自动调用 loadImg 或者 loadRes
     * @param {object} data 参数
     * @param {string} data.src 资源地址
     * @param {string} [data.type] 资源类型(img, json, buffer)，不提供将根据 data.src 来判断类型
     * @return {Promise.<data, Error>} 返回加载完的资源对象
     */
    load(data) {
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
        if (type === 'img') {
            return this.loadImg(src, data.crossOrigin);
        }
        return this.loadRes(src, type);
    },
    /**
     * 判断链接是否跨域，无法处理二级域名，及修改 document.domain 的情况
     * @param {string} url 需要判断的链接
     * @return {boolean} 是否跨域
     */
    isCrossOrigin(url) {
        const loc = window.location;
        const a = document.createElement('a');
        a.href = url;
        return a.hostname !== loc.hostname || a.port !== loc.port || a.protocol !== loc.protocol;
    },
    isBase64(url) {
        return /^data:(.+?);base64,/.test(url);
    },
    Uint8ArrayFrom(source, mapFn) {
        if (Uint8Array.from) {
            return Uint8Array.from(source, mapFn);
        }
        const len = source.length;
        const result = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            result[i] = mapFn(source[i]);
        }
        return result;
    },
    /**
     * 加载图片
     * @param {string} url 图片地址
     * @param {boolean} [crossOrigin=false] 是否跨域
     * @return {Promise.<Image, Error>} 返回加载完的图片
     */
    loadImg(url, crossOrigin) {
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
    },
    /**
     * 使用XHR加载其他资源
     * @param {string} url 资源地址
     * @param {string} [type=text] 资源类型(json, buffer, text)
     * @return {Promise.<data, Error>} 返回加载完的内容对象(Object, ArrayBuffer, String)
     */
    loadRes(url, type) {
        if (this.isBase64(url)) {
            const mime = RegExp.$1;
            const base64Str = url.slice(13 + mime.length);
            let result = atob(base64Str);
            if (type === 'json') {
                result = JSON.parse(result);
            } else if (type === 'buffer') {
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
    },
    /**
     * XHR资源请求
     * @param {object} opt 请求参数
     * @param {string} opt.url 资源地址
     * @param {string} [opt.type=text] 资源类型(json, buffer, text)
     * @param {string} [opt.method=GET] 请求类型(GET, POST ..)
     * @param {object} [opt.headers] 请求头参数
     * @param {string} [opt.body] POST请求发送的数据
     * @return {Promise.<data, Error>} 返回加载完的内容对象(Object, ArrayBuffer, String)
     */
    request(opt) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.onload = () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new TypeError(`Network request failed for ${xhr.status}`));
                    return;
                }
                let result = 'response' in xhr ? xhr.response : xhr.responseText;
                if (opt.type === 'json') {
                    try {
                        result = JSON.parse(result);
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
            if (opt.type === 'buffer') {
                xhr.responseType = 'arraybuffer';
            }
            each(opt.headers, (value, name) => {
                xhr.setRequestHeader(name, value);
            });
            xhr.send(opt.body || null);
        });
    }
});

export default BasicLoader;
