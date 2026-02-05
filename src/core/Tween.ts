import Class from './Class';

function now() {
    return +new Date();
}

/**
 * Tween类提供缓动功能。
 * @class  Tween
 * @param {Object} target 缓动对象。
 * @param {Object} fromProps 对象缓动的起始属性集合。
 * @param {Object} toProps 对象缓动的目标属性集合。
 * @param {TweenParams} params 缓动参数。可包含Tween类所有可写属性。
 * @property {Object} target 缓动目标。只读属性。
 * @property {number} duration 缓动总时长。单位毫秒。
 * @property {number} delay 缓动延迟时间。单位毫秒。
 * @property {boolean} paused 缓动是否暂停。默认为false。
 * @property {boolean} loop 缓动是否循环。默认为false。
 * @property {boolean} reverse 缓动是否反转播放。默认为false。
 * @property {number} repeat 缓动重复的次数。默认为0。
 * @property {number} repeatDelay 缓动重复的延迟时长。单位为毫秒。
 * @property {Function} ease 缓动变化函数。默认为null。
 * @property {number} time 缓动已进行的时长。单位毫秒。只读属性。
 * @property {Function} onStart 缓动开始回调函数。它接受1个参数：tween。默认值为null。
 * @property {Function} onUpdate 缓动更新回调函数。它接受2个参数：ratio和tween。默认值为null。
 * @property {Function} onComplete 缓动结束回调函数。它接受1个参数：tween。默认值为null。
 * @see {@link https://hiloteam.github.io/Hilo/docs/api-zh/symbols/Tween.html}
 * @example
 * Hilo.Tween.to(node, {
 *     x:100,
 *     y:20
 * }, {
 *     duration:1000,
 *     delay:500,
 *     ease:Hilo3d.Tween.Ease.Quad.EaseIn,
 *     onComplete:function(){
 *         console.log('complete');
 *     }
 * });
 */
const Tween = Class.create(/** @lends Tween.prototype */ {
    constructor(target, fromProps, toProps, params) {
        const me = this;

        me.target = target;
        me._startTime = 0;
        me._seekTime = 0;
        me._pausedTime = 0;
        me._pausedStartTime = 0;
        me._reverseFlag = 1;
        me._repeatCount = 0;

        // no fromProps if pass 3 arguments
        if (arguments.length === 3) {
            params = toProps;
            toProps = fromProps;
            fromProps = null;
        }

        for (const p in params) me[p] = params[p];
        me._fromProps = fromProps;
        me._toProps = toProps;

        // for old version compatiblity
        if (!params.duration && params.time) {
            me.duration = params.time || 0;
            me.time = 0;
        }
    },

    target: null,
    duration: 1000,
    delay: 0,
    paused: false,
    loop: false,
    reverse: false,
    repeat: 0,
    repeatDelay: 0,
    ease: null,
    time: 0, // ready only

    isStart: false,
    isComplete: false,
    onStart: null,
    onUpdate: null,
    onComplete: null,

    setProps(fromProps, toProps) {
        const me = this;
        const target = me.target;
        const propNames = fromProps || toProps;
        const from = me._fromProps = {};
        const to = me._toProps = {};

        fromProps = fromProps || target;
        toProps = toProps || target;

        for (const p in propNames) {
            to[p] = toProps[p] || 0;
            target[p] = from[p] = fromProps[p] || 0;
        }
        return me;
    },

    /**
     * 启动缓动动画的播放。
     * @memberOf Tween.prototype
     * @method start
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    start() {
        const me = this;
        me._startTime = now() + me.delay;
        me._seekTime = 0;
        me._pausedTime = 0;
        me._reverseFlag = 1;
        me._repeatCount = 0;
        me.paused = false;
        me.isStart = false;
        me.isComplete = false;
        Tween.add(me);
        return me;
    },

    /**
     * 停止缓动动画的播放。
     * @memberOf Tween.prototype
     * @method stop
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    stop() {
        Tween.remove(this);
        return this;
    },

    /**
     * 暂停缓动动画的播放。
     * @memberOf Tween.prototype
     * @method pause
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    pause() {
        const me = this;
        me.paused = true;
        me._pausedStartTime = now();
        return me;
    },

    /**
     * 恢复缓动动画的播放。
     * @memberOf Tween.prototype
     * @method resume
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    resume() {
        const me = this;
        me.paused = false;
        if (me._pausedStartTime) me._pausedTime += now() - me._pausedStartTime;
        me._pausedStartTime = 0;
        return me;
    },

    /**
     * 跳转Tween到指定的时间。
     * @memberOf Tween.prototype
     * @method seek
     * @param {number} time 指定要跳转的时间。取值范围为：0 - duraion。
     * @param {boolean} pause 是否暂停。
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    seek(time, pause) {
        const me = this;
        const current = now();
        me._startTime = current;
        me._seekTime = time;
        me._pausedTime = 0;
        if (pause !== undefined) me.paused = pause;
        me._update(current, true);
        Tween.add(me);
        return me;
    },

    /**
     * 连接下一个Tween变换。其开始时间根据delay值不同而不同。当delay值为字符串且以'+'或'-'开始时，Tween的开始时间从当前变换结束点计算，否则以当前变换起始点计算。
     * @memberOf Tween.prototype
     * @method link
     * @param {Tween} tween 要连接的Tween变换。
     * @returns {Tween} 下一个Tween。可用于链式调用。
     */
    link(tween) {
        const me = this;
        let delay = tween.delay;
        const startTime = me._startTime;

        let plus;
        let minus;
        if (typeof delay === 'string') {
            plus = delay.indexOf('+') === 0;
            minus = delay.indexOf('-') === 0;
            delay = plus || minus ? Number(delay.substr(1)) * (plus ? 1 : -1) : Number(delay);
        }
        tween.delay = delay;
        tween._startTime = plus || minus ? startTime + me.duration + delay : startTime + delay;

        me._next = tween;
        Tween.remove(tween);
        return tween;
    },

    /**
     * Tween类的内部渲染方法。
     * @private
     */
    _render(ratio) {
        const me = this;
        const target = me.target;
        const fromProps = me._fromProps;
        for (let p in fromProps) {
            target[p] = fromProps[p] + (me._toProps[p] - fromProps[p]) * ratio;
        }
    },

    /**
     * Tween类的内部更新方法。
     * @private
     */
    _update(time, forceUpdate) {
        const me = this;
        if (me.paused && !forceUpdate) return false;
        if (me.isComplete) return true;

        // elapsed time
        const elapsed = time - me._startTime - me._pausedTime + me._seekTime;
        if (elapsed < 0) return false;

        // elapsed ratio
        let ratio = elapsed / me.duration;
        let callback;
        if (ratio <= 0) {
            ratio = 0;
        } else if (ratio >= 1) {
            ratio = 1;
        }
        let easeRatio = me.ease ? me.ease(ratio) : ratio;

        if (me.reverse && me.isStart) {
            // backward
            if (me._reverseFlag < 0) {
                ratio = 1 - ratio;
                easeRatio = 1 - easeRatio;
            }
            // forward
            if (ratio < 1e-7) {
                // repeat complete or not loop
                if ((me.repeat > 0 && me._repeatCount++ >= me.repeat) || (me.repeat === 0 && !me.loop)) {
                    me.isComplete = true;
                } else {
                    me._startTime = now();
                    me._pausedTime = 0;
                    me._reverseFlag *= -1;
                }
            }
        }

        // start callback
        if (!me.isStart) {
            me.setProps(me._fromProps, me._toProps);
            me.isStart = true;
            if (me.onStart) {
                me.onStart.call(me, me);
            }
        }
        me.time = elapsed;

        // render & update callback
        me._render(easeRatio);
        callback = me.onUpdate;
        if (callback) {
            callback.call(me, easeRatio, me);
        }

        // check if complete
        if (ratio >= 1) {
            if (me.reverse) {
                me._startTime = now();
                me._pausedTime = 0;
                me._reverseFlag *= -1;
            } else if (me.loop || me.repeat > 0 && me._repeatCount++ < me.repeat) {
                me._startTime = now() + me.repeatDelay;
                me._pausedTime = 0;
            } else {
                me.isComplete = true;
            }
        }

        // next tween
        const next = me._next;
        if (next && next.time <= 0) {
            const nextStartTime = next._startTime;
            if (nextStartTime > 0 && nextStartTime <= time) {
                // parallel tween
                next._render(ratio);
                next.time = elapsed;
                Tween.add(next);
            } else if (me.isComplete && (nextStartTime < 0 || nextStartTime > time)) {
                // next tween
                next.start();
            }
        }

        // complete
        if (me.isComplete) {
            callback = me.onComplete;
            if (callback) {
                callback.call(me, me);
            }
            return true;
        }

        return false;
    },

    Statics: /** @lends Tween */ {
        _tweens: [],

        /**
         * 更新所有Tween实例。
         * @memberOf Tween
         * @method tick
         * @returns {Tween} Tween
         */
        tick() {
            const tweens = Tween._tweens;
            let tween;
            let i;
            const len = tweens.length;

            for (i = 0; i < len; i++) {
                tween = tweens[i];
                if (tween && tween._update(now())) {
                    tweens.splice(i, 1);
                    i--;
                }
            }
            return Tween;
        },

        /**
         * 添加Tween实例。
         * @memberOf Tween
         * @param {Tween} tween 要添加的Tween对象。
         * @returns {Tween} Tween。
         */
        add(tween) {
            const tweens = Tween._tweens;
            if (tweens.indexOf(tween) === -1) tweens.push(tween);
            return Tween;
        },


        /**
         * 删除Tween实例。
         * @param {Tween|any|any[]} tweenOrTarget 要删除的Tween对象或target对象或要删除的一组对象。
         * @returns {Tween} Tween。
         */
        remove(tweenOrTarget) {
            let i; let
                l;
            if (tweenOrTarget instanceof Array) {
                for (i = 0, l = tweenOrTarget.length; i < l; i++) {
                    Tween.remove(tweenOrTarget[i]);
                }
                return Tween;
            }

            const tweens = Tween._tweens;
            if (tweenOrTarget instanceof Tween) {
                i = tweens.indexOf(tweenOrTarget);
                if (i > -1) tweens.splice(i, 1);
            } else {
                for (i = 0; i < tweens.length; i++) {
                    if (tweens[i].target === tweenOrTarget) {
                        tweens.splice(i, 1);
                        i--;
                    }
                }
            }

            return Tween;
        },


        /**
         * 删除所有Tween实例。
         * @returns {Tween} Tween。
         */
        removeAll() {
            Tween._tweens.length = 0;
            return Tween;
        },

        /**
         * 创建一个缓动动画，让目标对象从开始属性变换到目标属性。
         * @memberOf Tween
         * @method fromTo
         * @param {Object|Array} target 缓动目标对象或缓动目标数组。
         * @param {Object} fromProps 缓动目标对象的开始属性。
         * @param {Object} toProps 缓动目标对象的目标属性。
         * @param {TweenParams} params 缓动动画的参数。
         * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
         */
        fromTo(target, fromProps, toProps, params) {
            params = params || {};
            const isArray = target instanceof Array;
            target = isArray ? target : [target];

            let tween;
            let i;
            const stagger = params.stagger;
            const tweens = [];
            for (i = 0; i < target.length; i++) {
                tween = new Tween(target[i], fromProps, toProps, params);
                if (stagger) {
                    tween.delay = (params.delay || 0) + (i * stagger || 0);
                }
                tween.start();
                tweens.push(tween);
            }

            return isArray ? tweens : tween;
        },


        /**
         * 创建一个缓动动画，让目标对象从当前属性变换到目标属性。
         * @memberOf Tween
         * @method to
         * @param {Object|Array} target 缓动目标对象或缓动目标数组。
         * @param {Object} toProps 缓动目标对象的目标属性。
         * @param {TweenParams} params 缓动动画的参数。
         * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
         */
        to(target, toProps, params) {
            return Tween.fromTo(target, null, toProps, params);
        },

        /**
         * 创建一个缓动动画，让目标对象从指定的起始属性变换到当前属性。
         * @memberOf Tween
         * @method from
         * @param {Object|Array} target 缓动目标对象或缓动目标数组。
         * @param {Object} fromProps 缓动目标对象的初始属性。
         * @param {TweenParams} params 缓动动画的参数。
         * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
         */
        from(target, fromProps, params) {
            return Tween.fromTo(target, fromProps, null, params);
        }
    }

});


/* eslint-disable no-return-assign, no-cond-assign */

function createEase(obj, easeInFn, easeOutFn, easeInOutFn, easeNoneFn) {
    obj = obj || {};
    if (easeInFn) {
        obj.EaseIn = easeInFn;
    }

    if (easeOutFn) {
        obj.EaseOut = easeOutFn;
    }

    if (easeInOutFn) {
        obj.EaseInOut = easeInOutFn;
    }

    if (easeNoneFn) {
        obj.EaseNone = easeNoneFn;
    }

    return obj;
}

const Linear = createEase(null, null, null, null, (k) => {
    return k;
});

const Quad = createEase(null,
    (k) => {
        return k * k;
    },

    (k) => {
        return -k * (k - 2);
    },

    (k) => {
        return ((k *= 2) < 1) ? 0.5 * k * k : -0.5 * (--k * (k - 2) - 1);
    });

const Cubic = createEase(null,
    (k) => {
        return k * k * k;
    },

    (k) => {
        return --k * k * k + 1;
    },

    (k) => {
        return ((k *= 2) < 1) ? 0.5 * k * k * k : 0.5 * ((k -= 2) * k * k + 2);
    });

const Quart = createEase(null,
    (k) => {
        return k * k * k * k;
    },

    (k) => {
        return -(--k * k * k * k - 1);
    },

    (k) => {
        return ((k *= 2) < 1) ? 0.5 * k * k * k * k : -0.5 * ((k -= 2) * k * k * k - 2);
    });

const Quint = createEase(null,
    (k) => {
        return k * k * k * k * k;
    },

    (k) => {
        return (k -= 1) * k * k * k * k + 1;
    },

    (k) => {
        return ((k *= 2) < 1) ? 0.5 * k * k * k * k * k : 0.5 * ((k -= 2) * k * k * k * k + 2);
    });

let math = Math;
let PI = math.PI; let HALF_PI = PI * 0.5;
let sin = math.sin; let cos = math.cos;
let pow = math.pow; let
    sqrt = math.sqrt;

const Sine = createEase(null,
    (k) => {
        return -cos(k * HALF_PI) + 1;
    },

    (k) => {
        return sin(k * HALF_PI);
    },

    (k) => {
        return -0.5 * (cos(PI * k) - 1);
    });

const Expo = createEase(null,
    (k) => {
        return k === 0 ? 0 : pow(2, 10 * (k - 1));
    },

    (k) => {
        return k === 1 ? 1 : -pow(2, -10 * k) + 1;
    },

    (k) => {
        if (k === 0 || k === 1) return k;
        if ((k *= 2) < 1) return 0.5 * pow(2, 10 * (k - 1));
        return 0.5 * (-pow(2, -10 * (k - 1)) + 2);
    });

const Circ = createEase(null,
    (k) => {
        return -(sqrt(1 - k * k) - 1);
    },

    (k) => {
        return sqrt(1 - (--k * k));
    },

    (k) => {
        if ((k /= 0.5) < 1) return -0.5 * (sqrt(1 - k * k) - 1);
        return 0.5 * (sqrt(1 - (k -= 2) * k) + 1);
    });

const Elastic = createEase(
    {
        a: 1,
        p: 0.4,
        s: 0.1,

        config(amplitude, period) {
            Elastic.a = amplitude;
            Elastic.p = period;
            Elastic.s = period / (2 * PI) * Math.asin(1 / amplitude) || 0;
        }
    },

    (k) => {
        return -(Elastic.a * pow(2, 10 * (k -= 1)) * sin((k - Elastic.s) * (2 * PI) / Elastic.p));
    },

    (k) => {
        return (Elastic.a * pow(2, -10 * k) * sin((k - Elastic.s) * (2 * PI) / Elastic.p) + 1);
    },

    (k) => {
        return ((k *= 2) < 1) ? -0.5 * (Elastic.a * pow(2, 10 * (k -= 1)) * sin((k - Elastic.s) * (2 * PI) / Elastic.p))
            : Elastic.a * pow(2, -10 * (k -= 1)) * sin((k - Elastic.s) * (2 * PI) / Elastic.p) * 0.5 + 1;
    }
);

const Back = createEase(
    {
        o: 1.70158,
        s: 2.59491,

        config(overshoot) {
            Back.o = overshoot;
            Back.s = overshoot * 1.525;
        }
    },

    (k) => {
        return k * k * ((Back.o + 1) * k - Back.o);
    },

    (k) => {
        return (k -= 1) * k * ((Back.o + 1) * k + Back.o) + 1;
    },

    (k) => {
        return ((k *= 2) < 1) ? 0.5 * (k * k * ((Back.s + 1) * k - Back.s)) : 0.5 * ((k -= 2) * k * ((Back.s + 1) * k + Back.s) + 2);
    }
);

const Bounce = createEase(null,
    (k) => {
        return 1 - Bounce.EaseOut(1 - k);
    },

    (k) => {
        if ((k /= 1) < 0.36364) {
            return 7.5625 * k * k;
        } if (k < 0.72727) {
            return 7.5625 * (k -= 0.54545) * k + 0.75;
        } if (k < 0.90909) {
            return 7.5625 * (k -= 0.81818) * k + 0.9375;
        }
        return 7.5625 * (k -= 0.95455) * k + 0.984375;
    },

    (k) => {
        return k < 0.5 ? Bounce.EaseIn(k * 2) * 0.5 : Bounce.EaseOut(k * 2 - 1) * 0.5 + 0.5;
    });
/* eslint-enable no-return-assign, no-cond-assign */

/**
 * Ease类包含为Tween类提供各种缓动功能的函数。
 * @memberOf Tween
 * @property {TweenEaseNoneObject} Linear 线性匀速缓动函数
 * @property {TweenEaseObject} Quad 二次缓动函数
 * @property {TweenEaseObject} Cubic 三次缓动函数。
 * @property {TweenEaseObject} Quart 四次缓动函数。
 * @property {TweenEaseObject} Quint 五次缓动函数。
 * @property {TweenEaseObject} Sine 正弦缓动函数。
 * @property {TweenEaseObject} Expo 指数缓动函数。
 * @property {TweenEaseObject} Circ 圆形缓动函数。
 * @property {TweenEaseObject} Elastic 弹性缓动函数。
 * @property {TweenEaseObject} Back 向后缓动函数。
 * @property {TweenEaseObject} Bounce 弹跳缓动函数。
 * @see  {@link https://hiloteam.github.io/Hilo/docs/api-zh/symbols/Ease.html}
 */
Tween.Ease = {
    Linear,
    Quad,
    Cubic,
    Quart,
    Quint,
    Sine,
    Expo,
    Circ,
    Elastic,
    Back,
    Bounce
};


export default Tween;


/**
 * @interface TweenParams
 * @property {number} duration
 * @property {number|String} [delay]
 * @property {Function} [ease]
 * @property {Function} [onStart]
 * @property {Function} [onComplete]
 * @property {Function} [onUpdate]
 * @property {boolean} [loop=false]
 * @property {boolean} [reverse=false]
 * @property {number} [repeat=0]
 */

/**
 * @interface TweenEaseObject
 * @property {Function} EaseIn
 * @property {Function} EaseOut
 * @property {Function} EaseInOut
 */

/**
 * @interface TweenEaseNoneObject
 * @property {Function} EaseNone
 */
