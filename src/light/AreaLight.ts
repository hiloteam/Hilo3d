import Light from './Light';
import Loader from '../loader/Loader';
import DataTexture from '../texture/DataTexture';

/**
 * 面光源
 * @class
 * @extends Light
 */
class AreaLight extends Light {
    /**
     * ltcTexture1
     * @memberOf AreaLight
     * @type {DataTexture}
     * @default null
     */
    static ltcTexture1: DataTexture | null = null;

    /**
     * ltcTexture2
     * @memberOf AreaLight
     * @type {DataTexture}
     * @default null
     */
    static ltcTexture2: DataTexture | null = null;

    /**
     * ltcTexture 是否加载完成
     * @memberOf AreaLight
     * @type {Boolean}
     * @default false
     */
    static ltcTextureReady: boolean = false;

    /**
     * ltcTexture 地址
     * @memberOf AreaLight
     * @type {String}
     */
    static ltcTextureUrl: string = '//g.alicdn.com/tmapp/static/4.0.63/ltcTexture.js';

    private static _loader?: Loader;

    /**
     * 初始化 ltcTexture
     * @memberOf AreaLight
     */
    static loadLtcTexture(): void {
        if (this.ltcTextureReady) {
            return;
        }

        if (this._loader !== undefined) {
            return;
        }

        this._loader = new Loader();
        this._loader.load({
            type: 'json',
            src: this.ltcTextureUrl
        }).then((data: any) => {
            this._loader = undefined;
            this.ltcTexture1 = new DataTexture({
                data: data.ltcTexture1
            });

            this.ltcTexture2 = new DataTexture({
                data: data.ltcTexture2
            });
            this.ltcTextureReady = true;
        });
    }

    /**
     * @default true
     * @type {boolean}
     */
    readonly isAreaLight: boolean = true;

    /**
     * @default AreaLight
     * @type {string}
     */
    readonly className: string = 'AreaLight';

    /**
     * width
     * @default 10
     * @type {Number}
     */
    width: number = 10;

    /**
     * height
     * @default 10
     * @type {Number}
     */
    height: number = 10;

    private _enabled: boolean = true;

    get enabled(): boolean {
        return this._enabled && AreaLight.ltcTextureReady;
    }

    set enabled(value: boolean) {
        this._enabled = value;
    }

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params?: any) {
        super(params);
        AreaLight.loadLtcTexture();
    }

    /**
     * ltcTexture1
     * @type {DataTexture}
     */
    get ltcTexture1(): DataTexture | null {
        return AreaLight.ltcTexture1;
    }

    set ltcTexture1(texture: DataTexture | null) {
        AreaLight.ltcTexture1 = texture;
    }

    /**
     * ltcTexture2
     * @type {DataTexture}
     */
    get ltcTexture2(): DataTexture | null {
        return AreaLight.ltcTexture2;
    }

    set ltcTexture2(texture: DataTexture | null) {
        AreaLight.ltcTexture2 = texture;
    }
}

export default AreaLight;
