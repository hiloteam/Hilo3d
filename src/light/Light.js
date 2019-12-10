import Class from '../core/Class';
import Node from '../core/Node';
import Color from '../math/Color';

const tempColor = new Color();

/**
 * 灯光基础类
 * @class
 * @extends Node
 */
const Light = Class.create(/** @lends Light.prototype */ {
    Extends: Node,
    isLight: true,
    className: 'Light',
    /**
     * 光强度
     * @type {Number}
     * @default 1
     */
    amount: 1,

    /**
     * 是否开启灯光
     * @type {Boolean}
     * @default true
     */
    enabled: true,

    /**
     * 光常量衰减值, PointLight 和 SpotLight 时生效
     * @type {Number}
     * @readOnly
     * @default 1
     */
    constantAttenuation: 1,

    /**
     * 光线性衰减值, PointLight 和 SpotLight 时生效
     * @type {Number}
     * @readOnly
     * @default 0
     */
    linearAttenuation: 0,

    /**
     * 光二次衰减值, PointLight 和 SpotLight 时生效
     * @type {Number}
     * @readOnly
     * @default 0
     */
    quadraticAttenuation: 0,
    _range: 0,
    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     * @type {Number}
     * @default 0
     */
    range: {
        get() {
            return this._range;
        },
        set(value) {
            this.constantAttenuation = 1;
            if (value <= 0) {
                this.linearAttenuation = 0;
                this.quadraticAttenuation = 0;
            } else {
                this.linearAttenuation = 4.5 / value;
                this.quadraticAttenuation = 75 / (value * value);
            }
            this._range = value;
        }
    },
    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        /**
         * 灯光颜色
         * @default new Color(1, 1, 1)
         * @type {Color}
         */
        this.color = new Color(1, 1, 1);
        Light.superclass.constructor.call(this, params);
    },

    /**
     * 获取光范围信息, PointLight 和 SpotLight 时生效
     * @param  {Array} out  信息接受数组
     * @param  {Number} offset 偏移值
     */
    toInfoArray(out, offset) {
        out[offset + 0] = this.constantAttenuation;
        out[offset + 1] = this.linearAttenuation;
        out[offset + 2] = this.quadraticAttenuation;
        return this;
    },
    getRealColor() {
        return tempColor.copy(this.color).scale(this.amount);
    },
    /**
     * 生成阴影贴图，支持阴影的子类需要重写
     * @param  {WebGLRenderer} renderer
     * @param  {Camera} camera
     */
    createShadowMap(renderer, camera) { // eslint-disable-line no-unused-vars

    }
});

export default Light;
