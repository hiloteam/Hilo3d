import Light from './Light';

/**
 * 环境光
 * @class
 * @extends Light
 */
class AmbientLight extends Light {
    /**
     * @type {Boolean}
     * @readOnly
     * @default true
     */
    readonly isAmbientLight: boolean = true;

    /**
     * @type {String}
     * @readOnly
     * @default AmbientLight
     */
    readonly className: string = 'AmbientLight';

    autoUpdateWorldMatrix: boolean = false;

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     * @param {Color} [params.color=new Color(1, 1, 1)] 光颜色
     * @param {number} [params.amount=1] 光强度
     * @param {any} [params.[value:string]] 其它属性
     */
    constructor(params?: any) {
        super(params);
    }
}

export default AmbientLight;
