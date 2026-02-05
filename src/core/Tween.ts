function now(): number {
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
class Tween {
    target: any = null;

    duration: number = 1000;

    delay: number = 0;

    paused: boolean = false;

    loop: boolean = false;

    reverse: boolean = false;

    repeat: number = 0;

    repeatDelay: number = 0;

    ease: ((k: number) => number) | null = null;

    time: number = 0;

    isStart: boolean = false;

    isComplete: boolean = false;

    onStart: ((tween: Tween) => void) | null = null;

    onUpdate: ((ratio: number, tween: Tween) => void) | null = null;

    onComplete: ((tween: Tween) => void) | null = null;

    private _startTime: number = 0;

    private _seekTime: number = 0;

    private _pausedTime: number = 0;

    private _pausedStartTime: number = 0;

    private _reverseFlag: number = 1;

    private _repeatCount: number = 0;

    private _fromProps: any = null;

    private _toProps: any = null;

    private _next?: Tween;

    constructor(target: any, fromProps?: any, toProps?: any, params?: TweenParams) {
        this.target = target;
        this._startTime = 0;
        this._seekTime = 0;
        this._pausedTime = 0;
        this._pausedStartTime = 0;
        this._reverseFlag = 1;
        this._repeatCount = 0;

        // no fromProps if pass 3 arguments
        if (arguments.length === 3) {
            params = toProps as TweenParams;
            toProps = fromProps;
            fromProps = null;
        }

        if (params) {
            for (const p in params) {
                (this as any)[p] = (params as any)[p];
            }
        }
        this._fromProps = fromProps;
        this._toProps = toProps;

        // for old version compatiblity
        if (params && !params.duration && (params as any).time) {
            this.duration = (params as any).time || 0;
            this.time = 0;
        }
    }

    setProps(fromProps?: any, toProps?: any): Tween {
        const target = this.target;
        const propNames = fromProps || toProps;
        const from = this._fromProps = {};
        const to = this._toProps = {};

        fromProps = fromProps || target;
        toProps = toProps || target;

        for (const p in propNames) {
            to[p] = toProps[p] || 0;
            target[p] = from[p] = fromProps[p] || 0;
        }
        return this;
    }

    /**
     * 启动缓动动画的播放。
     * @memberOf Tween.prototype
     * @method start
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    start(): Tween {
        this._startTime = now() + this.delay;
        this._seekTime = 0;
        this._pausedTime = 0;
        this._reverseFlag = 1;
        this._repeatCount = 0;
        this.paused = false;
        this.isStart = false;
        this.isComplete = false;
        Tween.add(this);
        return this;
    }

    /**
     * 停止缓动动画的播放。
     * @memberOf Tween.prototype
     * @method stop
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    stop(): Tween {
        Tween.remove(this);
        return this;
    }

    /**
     * 暂停缓动动画的播放。
     * @memberOf Tween.prototype
     * @method pause
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    pause(): Tween {
        this.paused = true;
        this._pausedStartTime = now();
        return this;
    }

    /**
     * 恢复缓动动画的播放。
     * @memberOf Tween.prototype
     * @method resume
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    resume(): Tween {
        this.paused = false;
        if (this._pausedStartTime) this._pausedTime += now() - this._pausedStartTime;
        this._pausedStartTime = 0;
        return this;
    }

    /**
     * 跳转Tween到指定的时间。
     * @memberOf Tween.prototype
     * @method seek
     * @param {number} time 指定要跳转的时间。取值范围为：0 - duraion。
     * @param {boolean} pause 是否暂停。
     * @returns {Tween} Tween变换本身。可用于链式调用。
     */
    seek(time: number, pause?: boolean): Tween {
        const current = now();
        this._startTime = current;
        this._seekTime = time;
        this._pausedTime = 0;
        if (pause !== undefined) this.paused = pause;
        this._update(current, true);
        Tween.add(this);
        return this;
    }

    /**
     * 连接下一个Tween变换。其开始时间根据delay值不同而不同。当delay值为字符串且以'+'或'-'开始时，Tween的开始时间从当前变换结束点计算，否则以当前变换起始点计算。
     * @memberOf Tween.prototype
     * @method link
     * @param {Tween} tween 要连接的Tween变换。
     * @returns {Tween} 下一个Tween。可用于链式调用。
     */
    link(tween: Tween): Tween {
        let delay: number | string = tween.delay;
        const startTime = this._startTime;

        let plus: boolean = false;
        let minus: boolean = false;
        let numericDelay: number;

        if (typeof delay === 'string') {
            const delayStr: string = delay;
            plus = delayStr.indexOf('+') === 0;
            minus = delayStr.indexOf('-') === 0;
            numericDelay = plus || minus ? Number(delayStr.substr(1)) * (plus ? 1 : -1) : Number(delayStr);
        } else {
            numericDelay = delay;
        }

        tween.delay = numericDelay;
        tween._startTime = plus || minus ? startTime + this.duration + numericDelay : startTime + numericDelay;

        this._next = tween;
        Tween.remove(tween);
        return tween;
    }

    /**
     * Tween类的内部渲染方法。
     * @private
     */
    private _render(ratio: number): void {
        const target = this.target;
        const fromProps = this._fromProps;
        for (let p in fromProps) {
            target[p] = fromProps[p] + (this._toProps[p] - fromProps[p]) * ratio;
        }
    }

    /**
     * Tween类的内部更新方法。
     * @private
     */
    private _update(time: number, forceUpdate?: boolean): boolean {
        if (this.paused && !forceUpdate) return false;
        if (this.isComplete) return true;

        // elapsed time
        const elapsed = time - this._startTime - this._pausedTime + this._seekTime;
        if (elapsed < 0) return false;

        // elapsed ratio
        let ratio = elapsed / this.duration;
        let callback;
        if (ratio <= 0) {
            ratio = 0;
        } else if (ratio >= 1) {
            ratio = 1;
        }
        let easeRatio = this.ease ? this.ease(ratio) : ratio;

        if (this.reverse && this.isStart) {
            // backward
            if (this._reverseFlag < 0) {
                ratio = 1 - ratio;
                easeRatio = 1 - easeRatio;
            }
            // forward
            if (ratio < 1e-7) {
                // repeat complete or not loop
                if ((this.repeat > 0 && this._repeatCount++ >= this.repeat) || (this.repeat === 0 && !this.loop)) {
                    this.isComplete = true;
                } else {
                    this._startTime = now();
                    this._pausedTime = 0;
                    this._reverseFlag *= -1;
                }
            }
        }

        // start callback
        if (!this.isStart) {
            this.setProps(this._fromProps, this._toProps);
            this.isStart = true;
            if (this.onStart) {
                this.onStart.call(this, this);
            }
        }
        this.time = elapsed;

        // render & update callback
        this._render(easeRatio);
        callback = this.onUpdate;
        if (callback) {
            callback.call(this, easeRatio, this);
        }

        // check if complete
        if (ratio >= 1) {
            if (this.reverse) {
                this._startTime = now();
                this._pausedTime = 0;
                this._reverseFlag *= -1;
            } else if (this.loop || this.repeat > 0 && this._repeatCount++ < this.repeat) {
                this._startTime = now() + this.repeatDelay;
                this._pausedTime = 0;
            } else {
                this.isComplete = true;
            }
        }

        // next tween
        const next = this._next;
        if (next && next.time <= 0) {
            const nextStartTime = next._startTime;
            if (nextStartTime > 0 && nextStartTime <= time) {
                // parallel tween
                next._render(ratio);
                next.time = elapsed;
                Tween.add(next);
            } else if (this.isComplete && (nextStartTime < 0 || nextStartTime > time)) {
                // next tween
                next.start();
            }
        }

        // complete
        if (this.isComplete) {
            callback = this.onComplete;
            if (callback) {
                callback.call(this, this);
            }
            return true;
        }

        return false;
    }

    private static _tweens: Tween[] = [];

    /**
     * 更新所有Tween实例。
     * @memberOf Tween
     * @method tick
     * @returns {Tween} Tween
     */
    static tick(): typeof Tween {
        const tweens = Tween._tweens;
        let tween: Tween;
        let i: number;
        const len = tweens.length;

        for (i = 0; i < len; i++) {
            tween = tweens[i];
            if (tween && tween._update(now())) {
                tweens.splice(i, 1);
                i--;
            }
        }
        return Tween;
    }

    /**
     * 添加Tween实例。
     * @memberOf Tween
     * @param {Tween} tween 要添加的Tween对象。
     * @returns {Tween} Tween。
     */
    static add(tween: Tween): typeof Tween {
        const tweens = Tween._tweens;
        if (tweens.indexOf(tween) === -1) tweens.push(tween);
        return Tween;
    }


    /**
     * 删除Tween实例。
     * @param {Tween|any|any[]} tweenOrTarget 要删除的Tween对象或target对象或要删除的一组对象。
     * @returns {Tween} Tween。
     */
    static remove(tweenOrTarget: Tween | any | any[]): typeof Tween {
        let i: number;
        let l: number;
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
    }


    /**
     * 删除所有Tween实例。
     * @returns {Tween} Tween。
     */
    static removeAll(): typeof Tween {
        Tween._tweens.length = 0;
        return Tween;
    }

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
    static fromTo(target: any | any[], fromProps: any, toProps: any, params?: TweenParams): Tween | Tween[] {
        params = params || {};
        const isArray = target instanceof Array;
        target = isArray ? target : [target];

        let tween: Tween;
        let i: number;
        const stagger = (params as any).stagger;
        const tweens: Tween[] = [];
        for (i = 0; i < target.length; i++) {
            tween = new Tween(target[i], fromProps, toProps, params);
            if (stagger) {
                const baseDelay = typeof params.delay === 'number' ? params.delay : 0;
                tween.delay = baseDelay + (i * stagger || 0);
            }
            tween.start();
            tweens.push(tween);
        }

        return isArray ? tweens : tween;
    }


    /**
     * 创建一个缓动动画，让目标对象从当前属性变换到目标属性。
     * @memberOf Tween
     * @method to
     * @param {Object|Array} target 缓动目标对象或缓动目标数组。
     * @param {Object} toProps 缓动目标对象的目标属性。
     * @param {TweenParams} params 缓动动画的参数。
     * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
     */
    static to(target: any | any[], toProps: any, params?: TweenParams): Tween | Tween[] {
        return Tween.fromTo(target, null, toProps, params);
    }

    /**
     * 创建一个缓动动画，让目标对象从指定的起始属性变换到当前属性。
     * @memberOf Tween
     * @method from
     * @param {Object|Array} target 缓动目标对象或缓动目标数组。
     * @param {Object} fromProps 缓动目标对象的初始属性。
     * @param {TweenParams} params 缓动动画的参数。
     * @returns {Tween|Array} 一个Tween实例对象或Tween实例数组。
     */
    static from(target: any | any[], fromProps: any, params?: TweenParams): Tween | Tween[] {
        return Tween.fromTo(target, fromProps, null, params);
    }

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
    static Ease: {
        Linear: TweenEaseNoneObject;
        Quad: TweenEaseObject;
        Cubic: TweenEaseObject;
        Quart: TweenEaseObject;
        Quint: TweenEaseObject;
        Sine: TweenEaseObject;
        Expo: TweenEaseObject;
        Circ: TweenEaseObject;
        Elastic: TweenEaseElasticObject;
        Back: TweenEaseBackObject;
        Bounce: TweenEaseBounceObject;
    };
}


/* eslint-disable no-return-assign, no-cond-assign */

interface TweenEaseObject {
    EaseIn: (k: number) => number;
    EaseOut: (k: number) => number;
    EaseInOut: (k: number) => number;
}

interface TweenEaseNoneObject {
    EaseNone: (k: number) => number;
}

interface TweenEaseElasticObject extends TweenEaseObject {
    a: number;
    p: number;
    s: number;
    config(amplitude: number, period: number): void;
}

interface TweenEaseBackObject extends TweenEaseObject {
    o: number;
    s: number;
    config(overshoot: number): void;
}

interface TweenEaseBounceObject extends TweenEaseObject {
}

function createEase(
    obj: any,
    easeInFn?: (k: number) => number,
    easeOutFn?: (k: number) => number,
    easeInOutFn?: (k: number) => number,
    easeNoneFn?: (k: number) => number
): any {
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

const Linear: TweenEaseNoneObject = createEase(null, null, null, null, (k: number) => {
    return k;
});

const Quad: TweenEaseObject = createEase(null,
    (k: number) => {
        return k * k;
    },

    (k: number) => {
        return -k * (k - 2);
    },

    (k: number) => {
        return ((k *= 2) < 1) ? 0.5 * k * k : -0.5 * (--k * (k - 2) - 1);
    });

const Cubic: TweenEaseObject = createEase(null,
    (k: number) => {
        return k * k * k;
    },

    (k: number) => {
        return --k * k * k + 1;
    },

    (k: number) => {
        return ((k *= 2) < 1) ? 0.5 * k * k * k : 0.5 * ((k -= 2) * k * k + 2);
    });

const Quart: TweenEaseObject = createEase(null,
    (k: number) => {
        return k * k * k * k;
    },

    (k: number) => {
        return -(--k * k * k * k - 1);
    },

    (k: number) => {
        return ((k *= 2) < 1) ? 0.5 * k * k * k * k : -0.5 * ((k -= 2) * k * k * k - 2);
    });

const Quint: TweenEaseObject = createEase(null,
    (k: number) => {
        return k * k * k * k * k;
    },

    (k: number) => {
        return (k -= 1) * k * k * k * k + 1;
    },

    (k: number) => {
        return ((k *= 2) < 1) ? 0.5 * k * k * k * k * k : 0.5 * ((k -= 2) * k * k * k * k + 2);
    });

const math = Math;
const PI = math.PI;
const HALF_PI = PI * 0.5;
const sin = math.sin;
const cos = math.cos;
const pow = math.pow;
const sqrt = math.sqrt;

const Sine: TweenEaseObject = createEase(null,
    (k: number) => {
        return -cos(k * HALF_PI) + 1;
    },

    (k: number) => {
        return sin(k * HALF_PI);
    },

    (k: number) => {
        return -0.5 * (cos(PI * k) - 1);
    });

const Expo: TweenEaseObject = createEase(null,
    (k: number) => {
        return k === 0 ? 0 : pow(2, 10 * (k - 1));
    },

    (k: number) => {
        return k === 1 ? 1 : -pow(2, -10 * k) + 1;
    },

    (k: number) => {
        if (k === 0 || k === 1) return k;
        if ((k *= 2) < 1) return 0.5 * pow(2, 10 * (k - 1));
        return 0.5 * (-pow(2, -10 * (k - 1)) + 2);
    });

const Circ: TweenEaseObject = createEase(null,
    (k: number) => {
        return -(sqrt(1 - k * k) - 1);
    },

    (k: number) => {
        return sqrt(1 - (--k * k));
    },

    (k: number) => {
        if ((k /= 0.5) < 1) return -0.5 * (sqrt(1 - k * k) - 1);
        return 0.5 * (sqrt(1 - (k -= 2) * k) + 1);
    });

const Elastic: TweenEaseElasticObject = createEase(
    {
        a: 1,
        p: 0.4,
        s: 0.1,

        config(amplitude: number, period: number) {
            Elastic.a = amplitude;
            Elastic.p = period;
            Elastic.s = period / (2 * PI) * Math.asin(1 / amplitude) || 0;
        }
    },

    (k: number) => {
        return -(Elastic.a * pow(2, 10 * (k -= 1)) * sin((k - Elastic.s) * (2 * PI) / Elastic.p));
    },

    (k: number) => {
        return (Elastic.a * pow(2, -10 * k) * sin((k - Elastic.s) * (2 * PI) / Elastic.p) + 1);
    },

    (k: number) => {
        return ((k *= 2) < 1) ? -0.5 * (Elastic.a * pow(2, 10 * (k -= 1)) * sin((k - Elastic.s) * (2 * PI) / Elastic.p))
            : Elastic.a * pow(2, -10 * (k -= 1)) * sin((k - Elastic.s) * (2 * PI) / Elastic.p) * 0.5 + 1;
    }
);

const Back: TweenEaseBackObject = createEase(
    {
        o: 1.70158,
        s: 2.59491,

        config(overshoot: number) {
            Back.o = overshoot;
            Back.s = overshoot * 1.525;
        }
    },

    (k: number) => {
        return k * k * ((Back.o + 1) * k - Back.o);
    },

    (k: number) => {
        return (k -= 1) * k * ((Back.o + 1) * k + Back.o) + 1;
    },

    (k: number) => {
        return ((k *= 2) < 1) ? 0.5 * (k * k * ((Back.s + 1) * k - Back.s)) : 0.5 * ((k -= 2) * k * ((Back.s + 1) * k + Back.s) + 2);
    }
);

const Bounce: TweenEaseBounceObject = createEase(null,
    (k: number) => {
        return 1 - Bounce.EaseOut(1 - k);
    },

    (k: number) => {
        if ((k /= 1) < 0.36364) {
            return 7.5625 * k * k;
        } if (k < 0.72727) {
            return 7.5625 * (k -= 0.54545) * k + 0.75;
        } if (k < 0.90909) {
            return 7.5625 * (k -= 0.81818) * k + 0.9375;
        }
        return 7.5625 * (k -= 0.95455) * k + 0.984375;
    },

    (k: number) => {
        return k < 0.5 ? Bounce.EaseIn(k * 2) * 0.5 : Bounce.EaseOut(k * 2 - 1) * 0.5 + 0.5;
    });
/* eslint-enable no-return-assign, no-cond-assign */

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
interface TweenParams {
    duration?: number;
    delay?: number | string;
    ease?: (k: number) => number;
    onStart?: (tween: Tween) => void;
    onComplete?: (tween: Tween) => void;
    onUpdate?: (ratio: number, tween: Tween) => void;
    loop?: boolean;
    reverse?: boolean;
    repeat?: number;
    repeatDelay?: number;
    paused?: boolean;
    time?: number;
    stagger?: number;
}
