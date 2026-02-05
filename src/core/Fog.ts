import Class from './Class';
import Color from '../math/Color';
import math from '../math/math';

const tempFloat32Array = new Float32Array(2);
/**
 * 雾
 * @class
 */
const Fog = Class.create(/** @lends Fog.prototype */ {
    /**
     * @default true
     * @type {Boolean}
     */
    isFog: true,

    /**
     * @default Fog
     * @type {String}
     */
    className: 'Fog',

    /**
     * 雾模式, 可选 LINEAR, EXP, EXP2
     * @type {String}
     * @default LINEAR
     */
    mode: 'LINEAR',

    /**
     * 雾影响起始值, 只在 mode 为 LINEAR 时生效
     * @type {Number}
     * @default 5
     */
    start: 5,

    /**
     * 雾影响终点值, 只在 mode 为 LINEAR 时生效
     * @type {Number}
     * @default 10
     */
    end: 10,

    /**
     * 雾密度, 只在 mode 为 EXP, EXP2 时生效
     * @type {Number}
     * @default 0.1
     */
    density: 0.1,

    /**
     * @constructs
     * @param {Object} [params] 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params) {
        /**
         * id
         * @default math.generateUUID('Fog')
         * @type {String}
         */
        this.id = math.generateUUID(this.className);

        /**
         * 雾颜色
         * @type {Color}
         * @default  new Color(1, 1, 1, 1)
         */
        this.color = new Color(1, 1, 1, 1);

        Object.assign(this, params);
    },
    /**
     * 获取雾信息
     * @return {Array} res
     */
    getInfo() {
        if (this.mode === 'LINEAR') {
            tempFloat32Array[0] = this.start;
            tempFloat32Array[1] = this.end;
            return tempFloat32Array;
        }

        return this.density;
    },
    getRenderOption(option = {}) {
        option[`FOG_${this.mode}`] = 1;
        return option;
    }
});

export default Fog;
