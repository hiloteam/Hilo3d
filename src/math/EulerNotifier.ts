import math from './math';
/* eslint-disable class-methods-use-this */
import Euler from './Euler';

const DEG2RAD = math.DEG2RAD;
const RAD2DEG = math.RAD2DEG;

/**
 * 欧拉角，具有 onUpdate 回调
 * @class
 * @extends Euler
 */
class EulerNotifier extends Euler {
    /**
     * 类名
     * @type {String}
     * @default EulerNotifier
     */
    className: string = 'EulerNotifier';

    /**
     * @type {Boolean}
     * @default true
     */
    isEulerNotifier: boolean = true;

    /**
     * @constructs
     * @param  {Number} [x=0]  角度 X, 弧度制
     * @param  {Number} [y=0]  角度 Y, 弧度制
     * @param  {Number} [z=0]  角度 Z, 弧度制
     */
    constructor(x: number = 0, y: number = 0, z: number = 0) {
        super(x, y, z);
    }

    /**
     * 更新的回调
     */
    onUpdate(): void {
        // Override in subclasses
    }

    protected updateDegrees(): EulerNotifier {
        super.updateDegrees();
        this.onUpdate();
        return this;
    }

    protected updateRadians(): EulerNotifier {
        super.updateRadians();
        this.onUpdate();
        return this;
    }

    /**
     * 角度 X, 角度制
     * @type {Number}
     */
    get degX(): number {
        return this._degX;
    }

    set degX(value: number) {
        this._degX = value;
        this.elements[0] = value * DEG2RAD;
        this.onUpdate();
    }

    /**
     * 角度 Y, 角度制
     * @type {Number}
     */
    get degY(): number {
        return this._degY;
    }

    set degY(value: number) {
        this._degY = value;
        this.elements[1] = value * DEG2RAD;
        this.onUpdate();
    }

    /**
     * 角度 Z, 角度制
     * @type {Number}
     */
    get degZ(): number {
        return this._degZ;
    }

    set degZ(value: number) {
        this._degZ = value;
        this.elements[2] = value * DEG2RAD;
        this.onUpdate();
    }

    /**
     * 角度 X, 弧度制
     * @type {Number}
     */
    get x(): number {
        return this.elements[0];
    }

    set x(value: number) {
        this.elements[0] = value;
        this._degX = value * RAD2DEG;
        this.onUpdate();
    }

    /**
     * 角度 Y, 弧度制
     * @type {Number}
     */
    get y(): number {
        return this.elements[1];
    }

    set y(value: number) {
        this.elements[1] = value;
        this._degY = value * RAD2DEG;
        this.onUpdate();
    }

    /**
     * 角度 Z, 弧度制
     * @type {Number}
     */
    get z(): number {
        return this.elements[2];
    }

    set z(value: number) {
        this.elements[2] = value;
        this._degZ = value * RAD2DEG;
        this.onUpdate();
    }
}

export default EulerNotifier;
