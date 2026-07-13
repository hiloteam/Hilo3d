import Color from '../math/Color';
import math from '../math/math';
const tempFloat32Array = new Float32Array(2);

export type FogMode = 'LINEAR' | 'EXP' | 'EXP2';

export interface FogParameters {
    mode?: FogMode;
    start?: number;
    end?: number;
    density?: number;
    color?: Color;
}
/**
 * 雾
 */
class Fog {
    readonly id: string;
    color: Color;
    isFog = true;
    className = 'Fog';
    /**
     * 雾模式, 可选 LINEAR, EXP, EXP2
     */
    mode: FogMode = 'LINEAR';
    /**
     * 雾影响起始值, 只在 mode 为 LINEAR 时生效
     */
    start = 5;
    /**
     * 雾影响终点值, 只在 mode 为 LINEAR 时生效
     */
    end = 10;
    /**
     * 雾密度, 只在 mode 为 EXP, EXP2 时生效
     */
    density = 0.1;
    /**
     * @param params - 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(params: FogParameters = {}) {
        /**
         * id
         */
        this.id = math.generateUUID(this.className);
        /**
         * 雾颜色
         */
        this.color = new Color(1, 1, 1, 1);
        Object.assign(this, params);
    }
    /**
     * 获取雾信息
     * @returns res
     */
    getInfo(): Float32Array | number {
        if (this.mode === 'LINEAR') {
            tempFloat32Array[0] = this.start;
            tempFloat32Array[1] = this.end;
            return tempFloat32Array;
        }
        return this.density;
    }
    getRenderOption(option: Record<string, number> = {}): Record<string, number> {
        option[`FOG_${this.mode}`] = 1;
        return option;
    }
}
export default Fog;
