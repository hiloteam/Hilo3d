import Class from '../core/Class';
import EventMixin from '../core/EventMixin';
import Texture from './Texture';
import Loader from '../loader/Loader';
import log from '../utils/log';

const placeHolder = new Image();
placeHolder.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * 懒加载纹理
 * @class
 * @extends Texture
 * @fires load 加载成功事件
 * @fires error 加载失败事件
 * @example
 * var material = new Hilo3d.BasicMaterial({
 *     diffuse: new Hilo3d.LazyTexture({
 *         crossOrigin: true,
 *         src: '//img.alicdn.com/tfs/TB1aNxtQpXXXXX1XVXXXXXXXXXX-1024-1024.jpg'
 *     });
 * });
 */
const LazyTexture = Class.create(/** @lends LazyTexture.prototype */ {
    Extends: Texture,
    Mixes: EventMixin,

    /**
     * @default true
     * @type {boolean}
     */
    isLazyTexture: true,

    /**
     * @default LazyTexture
     * @type {string}
     */
    className: 'LazyTexture',

    _src: '',

    /**
     * 图片是否跨域
     * @default false
     * @type {boolean}
     */
    crossOrigin: false,

    /**
     * 是否在设置src后立即加载图片
     * @default true
     * @type {boolean}
     */
    autoLoad: true,
    /**
     * 资源类型，用于加载时判断
     * @type {string}
     */
    resType: '',

    /**
     * 图片地址
     * @type {string}
     */
    src: {
        get() {
            return this._src;
        },
        set(src) {
            if (this._src !== src) {
                this._src = src;
                if (this.autoLoad) {
                    this.load();
                }
            }
        }
    },

    /**
     * @constructs
     * @param {object} params 初始化参数，所有params都会复制到实例上
     * @param {boolean} [params.crossOrigin=false] 是否跨域
     * @param {Image} [params.placeHolder] 占位图片，默认为1像素的透明图片
     * @param {boolean} [params.autoLoad=true] 是否自动加载
     * @param {string} [params.src] 图片地址
     */
    constructor(params) {
        if (params) {
            // 必须在src设置前赋值
            if ('crossOrigin' in params) {
                this.crossOrigin = params.crossOrigin;
            }
            if ('autoLoad' in params) {
                this.autoLoad = params.autoLoad;
            }
        }
        LazyTexture.superclass.constructor.call(this, params);
        this.image = this.placeHolder || placeHolder;
    },

    /**
     * 加载图片
     * @param {boolean} [throwError=false] 是否 throw error
     * @return {Promise} 返回加载的Promise
     */
    load(throwError) {
        LazyTexture.loader = LazyTexture.loader || new Loader();
        return LazyTexture.loader.load({
            src: this.src,
            crossOrigin: this.crossOrigin,
            type: this.resType,
            defaultType: 'img'
        }).then((img) => {
            if (img.isTexture) {
                Object.assign(this, img);
                this.needUpdate = true;
                this.needDestroy = true;
                this.fire('load');
            } else {
                this.image = img;
                this.needUpdate = true;
                this.fire('load');
            }
        }, (err) => {
            this.fire('error');
            if (throwError) {
                throw new Error(`LazyTexture Failed ${err}`);
            } else {
                log.warn(`LazyTexture Failed ${err}`);
            }
        });
    }
});

export default LazyTexture;
