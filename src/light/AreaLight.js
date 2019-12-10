import Class from '../core/Class';
import Light from './Light';
import Loader from '../loader/Loader';
import DataTexture from '../texture/DataTexture';

/**
 * 面光源
 * @class
 * @extends Light
 */
const AreaLight = Class.create(/** @lends AreaLight.prototype */ {
    Statics: {
        /**
         * ltcTexture1
         * @type {DataTexture}
         * @default null
         */
        ltcTexture1: null,

        /**
         * ltcTexture2
         * @type {DataTexture}
         * @default null
         */
        ltcTexture2: null,

        /**
         * ltcTexture 是否加载完成
         * @type {Boolean}
         * @default false
         */
        ltcTextureReady: false,

        /**
         * ltcTexture 地址
         * @type {String}
         */
        ltcTextureUrl: '//g.alicdn.com/tmapp/static/4.0.63/ltcTexture.js',

        /**
         * 初始化 ltcTexture
         */
        loadLtcTexture() {
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
            }).then((data) => {
                this._loader = null;
                this.ltcTexture1 = new DataTexture({
                    data: data.ltcTexture1
                });

                this.ltcTexture2 = new DataTexture({
                    data: data.ltcTexture2
                });
                this.ltcTextureReady = true;
            });
        }
    },
    Extends: Light,
    /**
     * @default true
     * @type {boolean}
     */
    isAreaLight: true,
    /**
     * @default AreaLight
     * @type {string}
     */
    className: 'AreaLight',
    /**
     * width
     * @default 10
     * @type {Number}
     */
    width: 10,
    /**
     * height
     * @default 10
     * @type {Number}
     */
    height: 10,

    _enabled: true,
    enabled: {
        get() {
            return this._enabled && AreaLight.ltcTextureReady;
        },

        set(value) {
            this._enabled = value;
        }
    },

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        AreaLight.superclass.constructor.call(this, params);
        AreaLight.loadLtcTexture();
    },

    /**
     * ltcTexture1
     * @type {DataTexture}
     */
    ltcTexture1: {
        get() {
            return AreaLight.ltcTexture1;
        },
        set(texture) {
            AreaLight.ltcTexture1 = texture;
        }
    },

    /**
     * ltcTexture1
     * @type {DataTexture}
     */
    ltcTexture2: {
        get() {
            return AreaLight.ltcTexture2;
        },
        set(texture) {
            AreaLight.ltcTexture2 = texture;
        }
    }
});

export default AreaLight;
