import Class from '../core/Class';
import Light from './Light';
import CubeLightShadow from './CubeLightShadow';

/**
 * 点光源
 * @class
 * @extends Light
 */
const PointLight = Class.create(/** @lends PointLight.prototype */ {
    Extends: Light,
    /**
     * @default true
     * @type {boolean}
     */
    isPointLight: true,
    /**
     * @default PointLight
     * @type {string}
     */
    className: 'PointLight',
    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     * @param {Color} [params.color=new Color(1, 1, 1)] 光颜色
     * @param {number} [params.amount=1] 光强度
     * @param {number} [params.range=0] 光照范围, 0 时代表光照范围无限大。
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params) {
        PointLight.superclass.constructor.call(this, params);
    },
    createShadowMap(renderer, camera) {
        if (!this.shadow) {
            return;
        }
        if (!this.lightShadow) {
            this.lightShadow = new CubeLightShadow({
                light: this,
                renderer
            });
            if ('minBias' in this.shadow) {
                this.lightShadow.minBias = this.shadow.minBias;
            }
            if ('maxBias' in this.shadow) {
                this.lightShadow.maxBias = this.shadow.maxBias;
            }
        }
        this.lightShadow.createShadowMap(camera);
    }
});

export default PointLight;
