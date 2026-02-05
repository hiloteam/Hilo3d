import Class from '../core/Class';
import Vector3 from './Vector3';

const tempArray = new Float32Array(27);

/**
 * SphericalHarmonics3
 * @class
 */
const SphericalHarmonics3 = Class.create(/** @lends SphericalHarmonics3.prototype */ {
    /**
     * 类名
     * @type {String}
     * @default SphericalHarmonics3
     */
    className: 'SphericalHarmonics3',
    /**
     * @type {boolean}
     * @default true
     */
    isSphericalHarmonics3: true,

    Statics: {
        SH3_SCALE: [
            Math.sqrt(1 / (4 * Math.PI)),
            -Math.sqrt(3 / (4 * Math.PI)),
            Math.sqrt(3 / (4 * Math.PI)),
            -Math.sqrt(3 / (4 * Math.PI)),
            Math.sqrt(15 / (4 * Math.PI)),
            -Math.sqrt(15 / (4 * Math.PI)),
            Math.sqrt(5 / (16 * Math.PI)),
            -Math.sqrt(15 / (4 * Math.PI)),
            Math.sqrt(15 / (16 * Math.PI))
        ]
    },
    /**
     * @constructs
     */
    constructor() {
        this.coefficients = [];
        for (let i = 0; i < 9; i++) {
            this.coefficients.push(new Vector3());
        }
    },

    /**
     * scale
     * @param  {Number} scale
     * @return {SphericalHarmonics3} this
     */
    scale(scale) {
        this.coefficients.forEach((coefficient) => {
            coefficient.scale(scale);
        });

        return this;
    },

    /**
     * fromArray
     * @param {Number[][]|Number[]} coefficients
     * @return {SphericalHarmonics3} this
     */
    fromArray(data) {
        if (data.length === 9) {
            this.coefficients.forEach((coefficient, index) => {
                coefficient.fromArray(data[index]);
            });
        } else if (data.length === 27) {
            this.coefficients.forEach((coefficient, index) => {
                coefficient.fromArray(data, index * 3);
            });
        }
        return this;
    },

    /**
     * scaleForRender
     * @return {SphericalHarmonics3} this
     */
    scaleForRender() {
        const SH3_SCALE = SphericalHarmonics3.SH3_SCALE;
        this.coefficients.forEach((coefficient, index) => {
            coefficient.scale(SH3_SCALE[index]);
        });
        this.scale(1 / Math.PI);

        return this;
    },

    /**
     * toArray
     * @returns {Float32Array}
     */
    toArray() {
        this.coefficients.forEach((coefficient, index) => {
            coefficient.toArray(tempArray, index * 3);
        });
        return tempArray;
    },

    /**
     * 克隆
     * @return {SphericalHarmonics3}
     */
    clone() {
        const sphericalHarmonics3 = new this.constructor();
        sphericalHarmonics3.copy(this);
        return sphericalHarmonics3;
    },
    /**
     * 复制
     * @param  {SphericalHarmonics3} other
     * @return {SphericalHarmonics3} this
     */
    copy(other) {
        const otherCoefficients = other.coefficients;
        this.coefficients.forEach((coefficient, index) => {
            coefficient.copy(otherCoefficients[index]);
        });
        return this;
    }
});

export default SphericalHarmonics3;
