import Class from '../core/Class';
import Light from './Light';

/**
 * 环境光
 * @class
 * @extends Light
 */
const AmbientLight = Class.create(/** @lends AmbientLight.prototype */{
    Extends: Light,
    isAmbientLight: true,
    className: 'AmbientLight',
    autoUpdateWorldMatrix: false,
    /**
     * @constructs
     * @override
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        AmbientLight.superclass.constructor.call(this, params);
    }
});

export default AmbientLight;
