import Class from '../core/Class';
import EventMixin from '../core/EventMixin';
import math from './math';
import Euler from './Euler';

const DEG2RAD = math.DEG2RAD;
const RAD2DEG = math.RAD2DEG;

/**
 * 欧拉角, 数据改变会发送事件
 * @class
 * @mixes EventMixin
 * @extends Euler
 * @fires update 数据更新事件
 */
const EulerNotifier = Class.create(/** @lends EulerNotifier.prototype */ {
    Mixes: EventMixin,
    Extends: Euler,
    /**
     * 类名
     * @type {String}
     * @default EulerNotifier
     */
    className: 'EulerNotifier',
    /**
     * @type {Boolean}
     * @default true
     */
    isEulerNotifier: true,
    /**
     * @constructs
     * @param  {Number} [x=0]  角度 X, 弧度制
     * @param  {Number} [y=0]  角度 Y, 弧度制
     * @param  {Number} [z=0]  角度 Z, 弧度制
     */
    constructor(x = 0, y = 0, z = 0) {
        Euler.call(this, x, y, z);
    },

    updateDegrees() {
        EulerNotifier.superclass.updateDegrees.call(this);
        this.fire('update');
        return this;
    },

    updateRadians() {
        EulerNotifier.superclass.updateRadians.call(this);
        this.fire('update');
        return this;
    },

    /**
     * 角度 X, 角度制
     * @type {Number}
     */
    degX: {
        get() {
            return this._degX;
        },
        set(value) {
            this._degX = value;
            this.elements[0] = value * DEG2RAD;
            this.fire('update');
        }
    },

    /**
     * 角度 Y, 角度制
     * @type {Number}
     */
    degY: {
        get() {
            return this._degY;
        },
        set(value) {
            this._degY = value;
            this.elements[1] = value * DEG2RAD;
            this.fire('update');
        }
    },

    /**
     * 角度 Z, 角度制
     * @type {Number}
     */
    degZ: {
        get() {
            return this._degZ;
        },
        set(value) {
            this._degZ = value;
            this.elements[2] = value * DEG2RAD;
            this.fire('update');
        }
    },

    /**
     * 角度 X, 弧度制
     * @type {Number}
     */
    x: {
        get() {
            return this.elements[0];
        },
        set(value) {
            this.elements[0] = value;
            this._degX = value * RAD2DEG;
            this.fire('update');
        }
    },
    /**
     * 角度 Y, 弧度制
     * @type {Number}
     */
    y: {
        get() {
            return this.elements[1];
        },
        set(value) {
            this.elements[1] = value;
            this._degY = value * RAD2DEG;
            this.fire('update');
        }
    },
    /**
     * 角度 Z, 弧度制
     * @type {Number}
     */
    z: {
        get() {
            return this.elements[2];
        },
        set(value) {
            this.elements[2] = value;
            this._degZ = value * RAD2DEG;
            this.fire('update');
        }
    }
});


export default EulerNotifier;
