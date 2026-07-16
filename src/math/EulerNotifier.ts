import math from './math';
import Euler from './Euler';
import { requireNumber } from './numberArray';
const DEG2RAD = math.DEG2RAD;
const RAD2DEG = math.RAD2DEG;
/**
 * 欧拉角，具有 onUpdate 回调
 */
class EulerNotifier extends Euler {
    /**
     * 类名
     */
    override className = 'EulerNotifier';
    isEulerNotifier = true;
    /**
     * @param x - 角度 X, 弧度制
     * @param y - 角度 Y, 弧度制
     * @param z - 角度 Z, 弧度制
     */
    constructor(x = 0, y = 0, z = 0) {
        super(x, y, z);
    }
    /**
     * 更新的回调
     */
    onUpdate(): void {
        // Extension hook for owner objects.
    }
    override updateDegrees(): this {
        super.updateDegrees();
        this.onUpdate();
        return this;
    }
    override updateRadians(): this {
        super.updateRadians();
        this.onUpdate();
        return this;
    }
    /**
     * 角度 X, 角度制
     */
    override get degX(): number {
        return this._degX;
    }
    /**
     * 角度 X, 角度制
     */
    override set degX(value: number) {
        this._degX = value;
        this.elements[0] = value * DEG2RAD;
        this.onUpdate();
    }
    /**
     * 角度 Y, 角度制
     */
    override get degY(): number {
        return this._degY;
    }
    /**
     * 角度 Y, 角度制
     */
    override set degY(value: number) {
        this._degY = value;
        this.elements[1] = value * DEG2RAD;
        this.onUpdate();
    }
    /**
     * 角度 Z, 角度制
     */
    override get degZ(): number {
        return this._degZ;
    }
    /**
     * 角度 Z, 角度制
     */
    override set degZ(value: number) {
        this._degZ = value;
        this.elements[2] = value * DEG2RAD;
        this.onUpdate();
    }
    /**
     * 角度 X, 弧度制
     */
    override get x(): number {
        return requireNumber(this.elements, 0);
    }
    /**
     * 角度 X, 弧度制
     */
    override set x(value: number) {
        this.elements[0] = value;
        this._degX = value * RAD2DEG;
        this.onUpdate();
    }
    /**
     * 角度 Y, 弧度制
     */
    override get y(): number {
        return requireNumber(this.elements, 1);
    }
    /**
     * 角度 Y, 弧度制
     */
    override set y(value: number) {
        this.elements[1] = value;
        this._degY = value * RAD2DEG;
        this.onUpdate();
    }
    /**
     * 角度 Z, 弧度制
     */
    override get z(): number {
        return requireNumber(this.elements, 2);
    }
    /**
     * 角度 Z, 弧度制
     */
    override set z(value: number) {
        this.elements[2] = value;
        this._degZ = value * RAD2DEG;
        this.onUpdate();
    }
}
export default EulerNotifier;
