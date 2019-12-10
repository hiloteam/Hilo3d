import Class from '../core/Class';
import math from '../math/math';
import Quaternion from '../math/Quaternion';
import Euler from '../math/Euler';
import {
    isArrayLike,
    getIndexFromSortedArray
} from '../utils/util';

const tempQuat1 = new Quaternion();
const tempQuat2 = new Quaternion();
const tempQuat3 = new Quaternion();
const tempQuat4 = new Quaternion();
const tempQuat5 = new Quaternion();
const tempQuat6 = new Quaternion();
const tempEuler = new Euler();
const tempArr = [];

function ascCompare(a, b) {
    return a - b;
}

/**
 * 元素动画状态序列处理
 * @class
 */
const AnimationStates = Class.create(/** @lends AnimationStates.prototype */ {
    Statics: {
        interpolation: {
            LINEAR(a, b, t) {
                if (b === undefined) {
                    return a;
                }
                if (a.slerp) {
                    return a.slerp(b, t);
                }

                if (a.lerp) {
                    return a.lerp(b, t);
                }

                if (isArrayLike(a)) {
                    tempArr.length = 0;
                    for (let i = a.length - 1; i >= 0; i--) {
                        tempArr[i] = a[i] + t * (b[i] - a[i]);
                    }
                    return tempArr;
                }
                return a + t * (b - a);
            },
            STEP(a, b, t) { // eslint-disable-line no-unused-vars
                return a;
            },
            CUBICSPLINE(a, b, t, tr) { // eslint-disable-line no-unused-vars
                const itemLen = a.length / 3;
                if (b === undefined) {
                    if (itemLen === 1) {
                        return a[1];
                    }
                    return a.slice(itemLen, -itemLen);
                }
                let p0 = a[1];
                let m0 = a[2];
                let p1 = b[1];
                let m1 = b[0];
                if (itemLen > 1) {
                    p0 = a.slice(itemLen, -itemLen);
                    m0 = a.slice(-itemLen);
                    p1 = b.slice(itemLen, -itemLen);
                    m1 = b.slice(0, itemLen);
                }

                if (p0.hermite) {
                    p0.hermite(p0, m0.scale(tr), p1, m1.scale(tr), t);
                } else if (p0.sqlerp) {
                    p0.sqlerp(p0, m0.scale(tr), p1, m1.scale(tr), t);
                } else {
                    if (!isArrayLike(p0)) {
                        p0 = [p0];
                        m0 = [m0];
                        p1 = [p1];
                        m1 = [m1];
                    }
                    const t2 = t * t;
                    const t3 = t2 * t;

                    const x1 = 2 * t3 - 3 * t2 + 1;
                    const x2 = t3 - 2 * t2 + t;
                    const x3 = -2 * t3 + 3 * t2;
                    const x4 = t3 - t2;

                    tempArr.length = 0;
                    for (let i = p0.length - 1; i >= 0; i--) {
                        tempArr[i] = p0[i] * x1 + x2 * m0[i] * tr + p1[i] * x3 + x4 * m1[i] * tr;
                    }
                    p0 = tempArr;
                }

                return p0;
            }
        },
        /**
         * 状态类型
         * @memberOf AnimationStates
         * @static
         * @enum {string}
         */
        StateType: {
            TRANSLATE: 'Translation',
            POSITION: 'Translation',
            TRANSLATION: 'Translation',
            SCALE: 'Scale',
            ROTATE: 'Rotation',
            ROTATION: 'Rotation',
            QUATERNION: 'Quaternion',
            WEIGHTS: 'Weights'
        },
        /**
         * 根据名字获取状态类型
         * @memberOf AnimationStates
         * @static
         * @param {string} name 名字，忽略大小写，如 translate => StateType.TRANSLATE
         * @return {AnimationStates.StateType} 返回获取的状态名
         */
        getType(name) {
            name = String(name).toUpperCase();
            return AnimationStates.StateType[name];
        }
    },
    /**
     * @default true
     * @type {boolean}
     */
    isAnimationStates: true,
    /**
     * @default AnimationStates
     * @type {string}
     */
    className: 'AnimationStates',
    /**
     * 对应的node名字(动画是根据名字关联的)
     * @type {string}
     */
    nodeName: '',
    /**
     * 状态类型
     * @type {AnimationStates.StateType}
     */
    type: '',
    /**
     * 插值算法
     * @default LINEAR
     * @type {string}
     */
    interpolationType: 'LINEAR',
    /**
     * @constructs
     * @param {Object} parmas 创建对象的属性参数。可包含此类的所有属性。
     */
    constructor(parmas) {
        /**
         * @type {string}
         */
        this.id = math.generateUUID(this.className);
        /**
         * 时间序列
         * @default []
         * @type {number[]}
         */
        this.keyTime = [];
        /**
         * 对应时间上的状态，数组长度应该跟keyTime一致，即每一帧上的状态信息
         * @default []
         * @type {Array.<Array>}
         */
        this.states = [];

        Object.assign(this, parmas);
    },
    /**
     * 查找指定时间在 keyTime 数组中的位置
     * @param {number} time 指定的时间
     * @return {number[]} 返回找到的位置，如: [low, high]
     */
    findIndexByTime(time) {
        const indexArr = getIndexFromSortedArray(this.keyTime, time, ascCompare);
        // if (indexArr[0] < 0) {
        //     indexArr[0] = 0;
        // }
        // if (indexArr[1] >= this.keyTime.length) {
        //     indexArr[1] = this.keyTime.length - 1;
        // }
        return indexArr;
    },
    getStateByIndex(index) {
        const len = this.states.length / this.keyTime.length;
        if (len === 1) {
            return this.states[index];
        }
        return this.states.slice(index * len, index * len + len);
    },
    /**
     * 获取指定时间上对应的状态，这里会进行插值计算
     * @param {number} time 指定的时间
     * @return {number[]} 返回插值后的状态数据
     */
    getState(time) {
        const [index1, index2] = this.findIndexByTime(time);
        if (index1 < 0 || index2 >= this.keyTime.length) {
            // do nothing if time is out of range
            return null;
        }
        const time1 = this.keyTime[index1];
        const time2 = this.keyTime[index2];
        let state1 = this.getStateByIndex(index1);

        if (index1 === index2) {
            let result = this.interpolation(state1);
            if (this.type === AnimationStates.StateType.ROTATION) {
                result = tempQuat1.fromEuler(tempEuler.fromArray(result));
            }
            return result.elements || result;
        }

        let state2 = this.getStateByIndex(index2);

        const timeRange = time2 - time1;
        const ratio = (time - time1) / timeRange;

        if (this.type === AnimationStates.StateType.ROTATION) {
            if (isArrayLike(state1[0])) {
                state1[0] = tempQuat1.fromEuler(tempEuler.fromArray(state1[0]));
                state1[1] = tempQuat2.fromEuler(tempEuler.fromArray(state1[1]));
                state1[2] = tempQuat3.fromEuler(tempEuler.fromArray(state1[2]));
                state2[0] = tempQuat4.fromEuler(tempEuler.fromArray(state2[0]));
                state2[1] = tempQuat5.fromEuler(tempEuler.fromArray(state2[1]));
                state2[2] = tempQuat6.fromEuler(tempEuler.fromArray(state2[2]));
            } else {
                state1 = tempQuat1.fromEuler(tempEuler.fromArray(state1));
                state2 = tempQuat2.fromEuler(tempEuler.fromArray(state2));
            }
        } else if (this.type === AnimationStates.StateType.QUATERNION) {
            if (isArrayLike(state1[0])) {
                state1[0] = tempQuat1.fromArray(state1[0]);
                state1[1] = tempQuat2.fromArray(state1[1]);
                state1[2] = tempQuat3.fromArray(state1[2]);
                state2[0] = tempQuat4.fromArray(state2[0]);
                state2[1] = tempQuat5.fromArray(state2[1]);
                state2[2] = tempQuat6.fromArray(state2[2]);
            } else {
                state1 = tempQuat1.fromArray(state1);
                state2 = tempQuat2.fromArray(state2);
            }
        }

        const result = this.interpolation(state1, state2, ratio, timeRange);
        return result.elements || result;
    },
    interpolation(a, b, t, tr) {
        return AnimationStates.interpolation[this.interpolationType](a, b, t, tr);
    },
    /**
     * 更新指定元素的位置
     * @param {Node} node 需要更新的元素
     * @param {number[]} value 位置信息，[x, y, z]
     */
    updateNodeTranslation(node, value) {
        node.x = value[0];
        node.y = value[1];
        node.z = value[2];
    },
    /**
     * 更新指定元素的缩放
     * @param {Node} node 需要更新的元素
     * @param {number[]} value 缩放信息，[scaleX, scaleY, scaleZ]
     */
    updateNodeScale(node, value) {
        node.scaleX = value[0];
        node.scaleY = value[1];
        node.scaleZ = value[2];
    },
    /**
     * 更新指定元素的旋转(四元数)
     * @param {Node} node 需要更新的元素
     * @param {number[]} value 四元数的旋转信息，[x, y, z, w]
     */
    updateNodeQuaternion(node, value) {
        node.quaternion.fromArray(value);
    },
    updateNodeWeights(node, weights) {
        const originalWeightIndices = this._originalWeightIndices = this._originalWeightIndices || [];
        const len = weights.length;
        weights = weights.slice();
        for (let i = 0; i < len; i++) {
            originalWeightIndices[i] = i;
        }
        for (let i = 0; i < len; i++) {
            for (let j = i + 1; j < len; j++) {
                if (weights[j] > weights[i]) {
                    let t = weights[i];
                    weights[i] = weights[j];
                    weights[j] = t;
                    t = originalWeightIndices[i];
                    originalWeightIndices[i] = originalWeightIndices[j];
                    originalWeightIndices[j] = t;
                }
            }
        }

        node.traverse((mesh) => {
            if (mesh.isMesh && mesh.geometry && mesh.geometry.isMorphGeometry) {
                mesh.geometry.update(weights, originalWeightIndices);
            }
        });
    },
    /**
     * 更新指定元素的状态
     * @param {number} time 时间，从keyTime中查找到状态然后更新
     * @param {Node} node 需要更新的元素
     */
    updateNodeState(time, node) {
        if (!node) {
            return;
        }
        let type = this.type;
        if (type === AnimationStates.StateType.ROTATION) {
            type = AnimationStates.StateType.QUATERNION;
        }
        const state = this.getState(time);
        if (!state) {
            return;
        }
        this[`updateNode${type}`](node, state);
    },
    /**
     * clone
     * @return {AnimationStates} 返回clone的实例
     */
    clone() {
        return new this.constructor({
            keyTime: this.keyTime,
            states: this.states,
            type: this.type,
            nodeName: this.nodeName
        });
    }
});

export default AnimationStates;
