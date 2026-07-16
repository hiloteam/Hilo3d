import Vector3 from './Vector3';
import { requireNumber } from './numberArray';
const tempArray = new Float32Array(27);
/**
 * SphericalHarmonics3
 */
class SphericalHarmonics3 {
    coefficients: Vector3[];
    /**
     * 类名
     */
    className = 'SphericalHarmonics3';
    isSphericalHarmonics3 = true;
    static readonly SH3_SCALE = [
        Math.sqrt(1 / (4 * Math.PI)),
        -Math.sqrt(3 / (4 * Math.PI)),
        Math.sqrt(3 / (4 * Math.PI)),
        -Math.sqrt(3 / (4 * Math.PI)),
        Math.sqrt(15 / (4 * Math.PI)),
        -Math.sqrt(15 / (4 * Math.PI)),
        Math.sqrt(5 / (16 * Math.PI)),
        -Math.sqrt(15 / (4 * Math.PI)),
        Math.sqrt(15 / (16 * Math.PI))
    ];
    constructor() {
        this.coefficients = [];
        for (let i = 0; i < 9; i++) {
            this.coefficients.push(new Vector3());
        }
    }
    /**
     * scale
     * @param scale -
     * @returns this
     */
    scale(scale: number): this {
        this.coefficients.forEach(coefficient => {
            coefficient.scale(scale);
        });
        return this;
    }
    /**
     * fromArray
     * @param data -
     * @returns this
     */
    fromArray(data: number[][] | number[]): this {
        if (data.length === 9 && data.every(Array.isArray)) {
            this.coefficients.forEach((coefficient, index) => {
                const values = data[index];
                if (values) coefficient.fromArray(values);
            });
        } else if (data.length === 27 && data.every(value => typeof value === 'number')) {
            this.coefficients.forEach((coefficient, index) => {
                coefficient.fromArray(data, index * 3);
            });
        }
        return this;
    }
    /**
     * scaleForRender
     * @returns this
     */
    scaleForRender(): this {
        const SH3_SCALE = SphericalHarmonics3.SH3_SCALE;
        this.coefficients.forEach((coefficient, index) => {
            coefficient.scale(requireNumber(SH3_SCALE, index));
        });
        this.scale(1 / Math.PI);
        return this;
    }
    /**
     * toArray
     */
    toArray(): Float32Array {
        this.coefficients.forEach((coefficient, index) => {
            coefficient.toArray(tempArray, index * 3);
        });
        return tempArray;
    }
    /**
     * 克隆
     */
    clone(): SphericalHarmonics3 {
        const sphericalHarmonics3 = new SphericalHarmonics3();
        sphericalHarmonics3.copy(this);
        return sphericalHarmonics3;
    }
    /**
     * 复制
     * @param other -
     * @returns this
     */
    copy(other: SphericalHarmonics3): this {
        const otherCoefficients = other.coefficients;
        this.coefficients.forEach((coefficient, index) => {
            const source = otherCoefficients[index];
            if (source) coefficient.copy(source);
        });
        return this;
    }
}
export default SphericalHarmonics3;
