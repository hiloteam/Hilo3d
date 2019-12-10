/**
 * @namespace math
 * @type {Object}
 */
const math = {
    /**
     * 角度值转弧度值
     * @type {Number}
     */
    DEG2RAD: Math.PI / 180,
    /**
     * 弧度值转角度值
     * @type {Number}
     */
    RAD2DEG: 180 / Math.PI,
    /**
     * 生成唯一ID
     * @function
     * @param  {String} [prefix=''] ID前缀
     * @return {String} ID
     */
    generateUUID: (() => {
        let uid = 0;
        return (prefix) => {
            let id = ++uid;
            if (prefix) {
                id = prefix + '_' + id;
            } else {
                id += '';
            }
            return id;
        };
    })(),
    /**
     * 截取
     * @param  {Number} value 值
     * @param  {Number} min 最小值
     * @param  {Number} max 最大值
     * @return {Number}
     */
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    },
    /**
     * 角度值转换成弧度值
     * @param  {Number} deg 角度值
     * @return {Number} 弧度值
     */
    degToRad(deg) {
        return deg * this.DEG2RAD;
    },
    /**
     * 弧度值转换成角度值
     * @param  {Number} rad 弧度值
     * @return {Number} 角度值
     */
    radToDeg(rad) {
        return rad * this.RAD2DEG;
    },
    /**
     * 是否是 2 的指数值
     * @param  {Number}  value
     * @return {Boolean}
     */
    isPowerOfTwo(value) {
        return (value & (value - 1)) === 0 && value !== 0;
    },
    /**
     * 最近的 2 的指数值
     * @param  {Uint} value
     * @return {Uint}
     */
    nearestPowerOfTwo(value) {
        return 2 ** Math.round(Math.log(value) / Math.LN2);
    },
    /**
     * 下一个的 2 的指数值
     * @param  {Uint} value
     * @return {Uint}
     */
    nextPowerOfTwo(value) {
        value--;
        value |= value >> 1;
        value |= value >> 2;
        value |= value >> 4;
        value |= value >> 8;
        value |= value >> 16;
        value++;

        return value;
    }
};

export default math;
