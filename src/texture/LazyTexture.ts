import Texture from './Texture';
import EventMixin, { EventMixinCallback, EventObject } from '../core/EventMixin';
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
class LazyTexture extends Texture {
    static loader: Loader;

    /**
     * @default true
     * @type {boolean}
     */
    isLazyTexture: boolean = true;

    /**
     * @default LazyTexture
     * @type {string}
     */
    className: string = 'LazyTexture';

    private _src: string = '';

    /**
     * 图片是否跨域
     * @default false
     * @type {boolean}
     */
    crossOrigin: boolean = false;

    /**
     * 是否在设置src后立即加载图片
     * @default true
     * @type {boolean}
     */
    autoLoad: boolean = true;

    /**
     * 资源类型，用于加载时判断
     * @type {string}
     */
    resType: string = '';

    placeHolder?: HTMLImageElement;

    _listeners: Record<string, any[]> | null = null;

    /**
     * 图片地址
     * @type {string}
     */
    get src(): string {
        return this._src;
    }

    set src(src: string) {
        if (this._src !== src) {
            this._src = src;
            if (this.autoLoad) {
                this.load();
            }
        }
    }

    /**
     * @constructs
     * @param {object} [params] 初始化参数，所有params都会复制到实例上
     * @param {boolean} [params.crossOrigin=false] 是否跨域
     * @param {HTMLImageElement} [params.placeHolder] 占位图片，默认为1像素的透明图片
     * @param {boolean} [params.autoLoad=true] 是否自动加载
     * @param {string} [params.src] 图片地址
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params?: any) {
        if (params) {
            if ('crossOrigin' in params) {
                (LazyTexture.prototype as any).crossOrigin = params.crossOrigin;
            }
            if ('autoLoad' in params) {
                (LazyTexture.prototype as any).autoLoad = params.autoLoad;
            }
        }
        super(params);
        this.image = this.placeHolder || placeHolder;
    }

    /**
     * 加载图片
     * @param {boolean} [throwError=false] 是否 throw error
     * @return {Promise<void>} 返回加载的Promise
     */
    load(throwError?: boolean): Promise<void> {
        LazyTexture.loader = LazyTexture.loader || new Loader();
        return LazyTexture.loader.load({
            src: this.src,
            crossOrigin: this.crossOrigin,
            type: this.resType,
            defaultType: 'img'
        }).then((img: any) => {
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
        }, (err: any) => {
            this.fire('error');
            if (throwError) {
                throw new Error(`LazyTexture Failed ${err}`);
            } else {
                log.warn(`LazyTexture Failed ${err}`);
            }
        });
    }

    protected _releaseImage(): void {
        if (this._src && typeof this._src !== 'string') {
            this._src = '';
        }
        super._releaseImage();
    }

    on!: (type: string, listener: EventMixinCallback, once?: boolean) => this;

    off!: (type?: string, listener?: EventMixinCallback) => this;

    fire!: (type: string | EventObject, detail?: any) => boolean;
}

Object.assign(LazyTexture.prototype, EventMixin);

export default LazyTexture;
