import Node from '../core/Node';
import Color from '../math/Color';

const tempColor = new Color();

/**
 * 阴影配置接口
 */
export interface ShadowConfig {
    debug?: boolean;
    width?: number;
    height?: number;
    maxBias?: number;
    minBias?: number;
    cameraInfo?: any;
}

/**
 * 灯光基础类
 * @class
 * @extends Node
 */
class Light extends Node {
    readonly isLight: boolean = true;

    readonly className: string = 'Light';

    /**
     * 光强度
     * @type {Number}
     * @default 1
     */
    amount: number = 1;

    /**
     * 是否开启灯光
     * @type {Boolean}
     * @default true
     */
    enabled: boolean = true;

    /**
     * 光常量衰减值, PointLight 和 SpotLight 时生效
     * @type {Number}
     * @default 1
     */
    constantAttenuation: number = 1;

    /**
     * 光线性衰减值, PointLight 和 SpotLight 时生效
     * @type {Number}
     * @default 0
     */
    linearAttenuation: number = 0;

    /**
     * 光二次衰减值, PointLight 和 SpotLight 时生效
     * @type {Number}
     * @default 0
     */
    quadraticAttenuation: number = 0;

    private _range: number = 0;

    /**
     * 光照范围, PointLight 和 SpotLight 时生效, 0 时代表光照范围无限大。
     * @type {Number}
     * @default 0
     */
    get range(): number {
        return this._range;
    }

    set range(value: number) {
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

    /**
     * 阴影生成参数，默认不生成阴影
     * @default null
     * @type {object}
     * @property {boolean} [debug=false] 是否显示生成的阴影贴图
     * @property {number} [width=render.width] 阴影贴图的宽，默认为画布宽
     * @property {number} [height=render.height] 阴影贴图的高，默认为画布高
     * @property {number} [maxBias=0.05] depth最大差值，实际的bias为max(maxBias * (1 - dot(normal, lightDir)), minBias)
     * @property {number} [minBias=0.005] depth最小差值
     * @property {Object} [cameraInfo=null] 阴影摄像机信息，没有会根据当前相机自动计算
     */
    shadow: ShadowConfig | null = null;

    /**
     * 是否光照信息变化
     * @type {Boolean}
     * @default false
     */
    isDirty: boolean = false;

    /**
     * 灯光颜色
     * @default new Color(1, 1, 1)
     * @type {Color}
     */
    color: Color;

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params?: any) {
        super(params);
        this.color = new Color(1, 1, 1);
    }

    /**
     * 获取光范围信息, PointLight 和 SpotLight 时生效
     * @param  {Array} out  信息接受数组
     * @param  {Number} offset 偏移值
     */
    toInfoArray(out: number[], offset: number): this {
        out[offset + 0] = this.constantAttenuation;
        out[offset + 1] = this.linearAttenuation;
        out[offset + 2] = this.quadraticAttenuation;
        return this;
    }

    /**
     * 获取真正的颜色，光强度乘以颜色
     * @returns {Color} 光强度乘以颜色后的颜色
     */
    getRealColor(): Color {
        return tempColor.copy(this.color).scale(this.amount);
    }

    /**
     * 生成阴影贴图，支持阴影的子类需要重写
     * @param  {WebGLRenderer} _renderer
     * @param  {Camera} _camera
     */
    // eslint-disable-next-line class-methods-use-this
    createShadowMap(_renderer: any, _camera: any): void {

    }
}

export default Light;
