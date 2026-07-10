// @ts-nocheck
// Legacy Class.create module; public API is checked by types/index.d.ts.
import Class from '../core/Class';
import Light from './Light';

/**
 * 环境光
 * @class
 * @extends Light
 */
const AmbientLight = Class.create<typeof hilo3d.AmbientLight>()(/** @lends AmbientLight.prototype */{
    Extends: Light,
    /**
     * @type {Boolean}
     * @readOnly
     * @default true
     */
    isAmbientLight: true,
    /**
     * @type {String}
     * @readOnly
     * @default AmbientLight
     */
    className: 'AmbientLight',
    autoUpdateWorldMatrix: false,
    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     * @param {Color} [params.color=new Color(1, 1, 1)] 光颜色
     * @param {number} [params.amount=1] 光强度
     * @param {unknown} [params.[value:string]] 其它属性
     */
    constructor(params) {
        AmbientLight.superclass.constructor.call(this, params);
    }
});

export default AmbientLight;
