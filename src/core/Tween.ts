export type TweenEaseFunction = (ratio: number) => number;
export type TweenProperties = Readonly<Record<string, number>>;

export interface TweenParameters {
    duration?: number;
    delay?: number | string;
    paused?: boolean;
    loop?: boolean;
    reverse?: boolean;
    repeat?: number;
    repeatDelay?: number;
    ease?: TweenEaseFunction | null;
    time?: number;
    stagger?: number;
    onStart?: TweenStartCallback | null;
    onUpdate?: TweenUpdateCallback | null;
    onComplete?: TweenCompleteCallback | null;
}

export type TweenStartCallback = (this: Tween, tween: Tween) => void;
export type TweenUpdateCallback = (this: Tween, ratio: number, tween: Tween) => void;
export type TweenCompleteCallback = (this: Tween, tween: Tween) => void;

export interface TweenEaseObject {
    EaseIn: TweenEaseFunction;
    EaseOut: TweenEaseFunction;
    EaseInOut: TweenEaseFunction;
}

export interface TweenEaseNoneObject {
    EaseNone: TweenEaseFunction;
}

export interface ElasticEaseObject extends TweenEaseObject {
    a: number;
    p: number;
    s: number;
    config(amplitude: number, period: number): void;
}

export interface BackEaseObject extends TweenEaseObject {
    o: number;
    s: number;
    config(overshoot: number): void;
}

export interface TweenEaseCollection {
    Linear: TweenEaseNoneObject;
    Quad: TweenEaseObject;
    Cubic: TweenEaseObject;
    Quart: TweenEaseObject;
    Quint: TweenEaseObject;
    Sine: TweenEaseObject;
    Expo: TweenEaseObject;
    Circ: TweenEaseObject;
    Elastic: ElasticEaseObject;
    Back: BackEaseObject;
    Bounce: TweenEaseObject;
}

const PI = Math.PI;
const HALF_PI = PI * 0.5;

const Linear: TweenEaseNoneObject = {
    EaseNone: ratio => ratio
};

const Quad: TweenEaseObject = {
    EaseIn: ratio => ratio * ratio,
    EaseOut: ratio => -ratio * (ratio - 2),
    EaseInOut(ratio) {
        const value = ratio * 2;
        return value < 1 ? 0.5 * value * value : -0.5 * ((value - 1) * (value - 3) - 1);
    }
};

const Cubic: TweenEaseObject = {
    EaseIn: ratio => ratio * ratio * ratio,
    EaseOut(ratio) {
        const value = ratio - 1;
        return value * value * value + 1;
    },
    EaseInOut(ratio) {
        const value = ratio * 2;
        return value < 1
            ? 0.5 * value * value * value
            : 0.5 * ((value - 2) * (value - 2) * (value - 2) + 2);
    }
};

const Quart: TweenEaseObject = {
    EaseIn: ratio => ratio * ratio * ratio * ratio,
    EaseOut(ratio) {
        const value = ratio - 1;
        return -(value * value * value * value - 1);
    },
    EaseInOut(ratio) {
        const value = ratio * 2;
        if (value < 1) return 0.5 * value * value * value * value;
        const offset = value - 2;
        return -0.5 * (offset * offset * offset * offset - 2);
    }
};

const Quint: TweenEaseObject = {
    EaseIn: ratio => ratio * ratio * ratio * ratio * ratio,
    EaseOut(ratio) {
        const value = ratio - 1;
        return value * value * value * value * value + 1;
    },
    EaseInOut(ratio) {
        const value = ratio * 2;
        if (value < 1) return 0.5 * value * value * value * value * value;
        const offset = value - 2;
        return 0.5 * (offset * offset * offset * offset * offset + 2);
    }
};

const Sine: TweenEaseObject = {
    EaseIn: ratio => -Math.cos(ratio * HALF_PI) + 1,
    EaseOut: ratio => Math.sin(ratio * HALF_PI),
    EaseInOut: ratio => -0.5 * (Math.cos(PI * ratio) - 1)
};

const Expo: TweenEaseObject = {
    EaseIn: ratio => (ratio === 0 ? 0 : Math.pow(2, 10 * (ratio - 1))),
    EaseOut: ratio => (ratio === 1 ? 1 : -Math.pow(2, -10 * ratio) + 1),
    EaseInOut(ratio) {
        if (ratio === 0 || ratio === 1) return ratio;
        const value = ratio * 2;
        return value < 1
            ? 0.5 * Math.pow(2, 10 * (value - 1))
            : 0.5 * (-Math.pow(2, -10 * (value - 1)) + 2);
    }
};

const Circ: TweenEaseObject = {
    EaseIn: ratio => -(Math.sqrt(1 - ratio * ratio) - 1),
    EaseOut(ratio) {
        const value = ratio - 1;
        return Math.sqrt(1 - value * value);
    },
    EaseInOut(ratio) {
        const value = ratio * 2;
        if (value < 1) return -0.5 * (Math.sqrt(1 - value * value) - 1);
        const offset = value - 2;
        return 0.5 * (Math.sqrt(1 - offset * offset) + 1);
    }
};

const Elastic: ElasticEaseObject = {
    a: 1,
    p: 0.4,
    s: 0.1,
    config(amplitude, period) {
        Elastic.a = amplitude;
        Elastic.p = period;
        Elastic.s = (period / (2 * PI)) * Math.asin(1 / amplitude) || 0;
    },
    EaseIn(ratio) {
        if (ratio === 0 || ratio === 1) return ratio;
        const value = ratio - 1;
        return -(
            Elastic.a *
            Math.pow(2, 10 * value) *
            Math.sin(((value - Elastic.s) * (2 * PI)) / Elastic.p)
        );
    },
    EaseOut(ratio) {
        if (ratio === 0 || ratio === 1) return ratio;
        return (
            Elastic.a *
                Math.pow(2, -10 * ratio) *
                Math.sin(((ratio - Elastic.s) * (2 * PI)) / Elastic.p) +
            1
        );
    },
    EaseInOut(ratio) {
        if (ratio === 0 || ratio === 1) return ratio;
        const value = ratio * 2;
        if (value < 1) {
            const offset = value - 1;
            return (
                -0.5 *
                (Elastic.a *
                    Math.pow(2, 10 * offset) *
                    Math.sin(((offset - Elastic.s) * (2 * PI)) / Elastic.p))
            );
        }
        const offset = value - 1;
        return (
            Elastic.a *
                Math.pow(2, -10 * offset) *
                Math.sin(((offset - Elastic.s) * (2 * PI)) / Elastic.p) *
                0.5 +
            1
        );
    }
};

const Back: BackEaseObject = {
    o: 1.70158,
    s: 2.59491,
    config(overshoot) {
        Back.o = overshoot;
        Back.s = overshoot * 1.525;
    },
    EaseIn: ratio => ratio * ratio * ((Back.o + 1) * ratio - Back.o),
    EaseOut(ratio) {
        const value = ratio - 1;
        return value * value * ((Back.o + 1) * value + Back.o) + 1;
    },
    EaseInOut(ratio) {
        const value = ratio * 2;
        if (value < 1) {
            return 0.5 * (value * value * ((Back.s + 1) * value - Back.s));
        }
        const offset = value - 2;
        return 0.5 * (offset * offset * ((Back.s + 1) * offset + Back.s) + 2);
    }
};

const Bounce: TweenEaseObject = {
    EaseIn: ratio => 1 - Bounce.EaseOut(1 - ratio),
    EaseOut(ratio) {
        if (ratio < 0.36364) return 7.5625 * ratio * ratio;
        if (ratio < 0.72727) {
            const value = ratio - 0.54545;
            return 7.5625 * value * value + 0.75;
        }
        if (ratio < 0.90909) {
            const value = ratio - 0.81818;
            return 7.5625 * value * value + 0.9375;
        }
        const value = ratio - 0.95455;
        return 7.5625 * value * value + 0.984375;
    },
    EaseInOut: ratio =>
        ratio < 0.5 ? Bounce.EaseIn(ratio * 2) * 0.5 : Bounce.EaseOut(ratio * 2 - 1) * 0.5 + 0.5
};

const EASE: TweenEaseCollection = {
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

function numericProperty(source: object, property: string): number {
    const value: unknown = Reflect.get(source, property);
    return typeof value === 'number' ? value : 0;
}

function copyNumericProperties(source: object): Record<string, number> {
    const result: Record<string, number> = {};
    for (const property of Object.keys(source)) {
        const value: unknown = Reflect.get(source, property);
        if (typeof value === 'number') result[property] = value;
    }
    return result;
}

function delayValue(delay: number | string): number {
    const value = typeof delay === 'number' ? delay : Number(delay);
    return Number.isFinite(value) ? value : 0;
}

function isObjectArray(value: object | readonly object[]): value is readonly object[] {
    return Array.isArray(value);
}

/** Time-based interpolation of numeric properties on an object. */
class Tween {
    static readonly Ease = EASE;
    static readonly _tweens: Tween[] = [];

    readonly target: object;
    duration = 1000;
    delay: number | string = 0;
    paused = false;
    loop = false;
    reverse = false;
    repeat = 0;
    repeatDelay = 0;
    ease: TweenEaseFunction | null = null;
    time = 0;
    isStart = false;
    isComplete = false;
    onStart: TweenStartCallback | null = null;
    onUpdate: TweenUpdateCallback | null = null;
    onComplete: TweenCompleteCallback | null = null;

    private startTime = 0;
    private seekTime = 0;
    private pausedTime = 0;
    private pausedStartTime = 0;
    private reverseDirection: 1 | -1 = 1;
    private repeatCount = 0;
    private fromProperties: Record<string, number> | null = null;
    private toProperties: Record<string, number> = {};
    private nextTween: Tween | null = null;

    constructor(target: object, toProperties: TweenProperties, params?: TweenParameters);
    constructor(
        target: object,
        fromProperties: TweenProperties | null,
        toProperties: TweenProperties,
        params?: TweenParameters
    );
    constructor(
        target: object,
        fromOrTo: TweenProperties | null,
        toOrParams: TweenProperties | TweenParameters = {},
        maybeParams?: TweenParameters
    ) {
        this.target = target;
        const threeArgumentForm = maybeParams === undefined;
        const params = threeArgumentForm ? toOrParams : maybeParams;
        this.fromProperties = threeArgumentForm
            ? null
            : fromOrTo === null
              ? null
              : copyNumericProperties(fromOrTo);
        this.toProperties = threeArgumentForm
            ? copyNumericProperties(fromOrTo ?? {})
            : copyNumericProperties(toOrParams);
        Object.assign(this, params);
        if (params.duration === undefined && params.time !== undefined) {
            this.duration = params.time;
            this.time = 0;
        }
    }

    setProps(fromProperties?: TweenProperties | null, toProperties?: TweenProperties | null): this {
        const propertyNames = Object.keys(fromProperties ?? toProperties ?? {});
        const from: Record<string, number> = {};
        const to: Record<string, number> = {};
        const fromSource = fromProperties ?? this.target;
        const toSource = toProperties ?? this.target;

        for (const property of propertyNames) {
            from[property] = numericProperty(fromSource, property);
            to[property] = numericProperty(toSource, property);
            Reflect.set(this.target, property, from[property]);
        }
        this.fromProperties = from;
        this.toProperties = to;
        return this;
    }

    start(): this {
        this.startTime = Date.now() + delayValue(this.delay);
        this.seekTime = 0;
        this.pausedTime = 0;
        this.reverseDirection = 1;
        this.repeatCount = 0;
        this.paused = false;
        this.isStart = false;
        this.isComplete = false;
        Tween.add(this);
        return this;
    }

    stop(): this {
        Tween.remove(this);
        return this;
    }

    pause(): this {
        this.paused = true;
        this.pausedStartTime = Date.now();
        return this;
    }

    resume(): this {
        this.paused = false;
        if (this.pausedStartTime) this.pausedTime += Date.now() - this.pausedStartTime;
        this.pausedStartTime = 0;
        return this;
    }

    seek(time: number, pause?: boolean): this {
        const current = Date.now();
        this.startTime = current;
        this.seekTime = time;
        this.pausedTime = 0;
        if (pause !== undefined) this.paused = pause;
        this.update(current, true);
        Tween.add(this);
        return this;
    }

    link(tween: Tween): Tween {
        const rawDelay = tween.delay;
        const relative =
            typeof rawDelay === 'string' && (rawDelay.startsWith('+') || rawDelay.startsWith('-'));
        const delay = delayValue(rawDelay);
        tween.delay = delay;
        tween.startTime = relative
            ? this.startTime + this.duration + delay
            : this.startTime + delay;
        this.nextTween = tween;
        Tween.remove(tween);
        return tween;
    }

    private render(ratio: number): void {
        const fromProperties = this.fromProperties;
        if (!fromProperties) return;
        for (const property of Object.keys(fromProperties)) {
            const from = fromProperties[property];
            const to = this.toProperties[property];
            if (from === undefined || to === undefined) continue;
            Reflect.set(this.target, property, from + (to - from) * ratio);
        }
    }

    private update(time: number, forceUpdate = false): boolean {
        if (this.paused && !forceUpdate) return false;
        if (this.isComplete) return true;

        const elapsed = time - this.startTime - this.pausedTime + this.seekTime;
        if (elapsed < 0) return false;
        let ratio = this.duration <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / this.duration));
        let easedRatio = this.ease ? this.ease(ratio) : ratio;

        if (this.reverse && this.isStart) {
            if (this.reverseDirection < 0) {
                ratio = 1 - ratio;
                easedRatio = 1 - easedRatio;
            }
            if (ratio < 1e-7) {
                if (
                    (this.repeat > 0 && this.repeatCount++ >= this.repeat) ||
                    (this.repeat === 0 && !this.loop)
                ) {
                    this.isComplete = true;
                } else {
                    this.startTime = Date.now();
                    this.pausedTime = 0;
                    this.reverseDirection *= -1;
                }
            }
        }

        if (!this.isStart) {
            this.setProps(this.fromProperties, this.toProperties);
            this.isStart = true;
            this.onStart?.call(this, this);
        }

        this.time = elapsed;
        this.render(easedRatio);
        this.onUpdate?.call(this, easedRatio, this);

        if (ratio >= 1) {
            if (this.reverse) {
                this.startTime = Date.now();
                this.pausedTime = 0;
                this.reverseDirection *= -1;
            } else if (this.loop || (this.repeat > 0 && this.repeatCount++ < this.repeat)) {
                this.startTime = Date.now() + this.repeatDelay;
                this.pausedTime = 0;
            } else {
                this.isComplete = true;
            }
        }

        const next = this.nextTween;
        if (next && next.time <= 0) {
            if (next.startTime > 0 && next.startTime <= time) {
                next.render(ratio);
                next.time = elapsed;
                Tween.add(next);
            } else if (this.isComplete && (next.startTime < 0 || next.startTime > time)) {
                next.start();
            }
        }

        if (this.isComplete) {
            this.onComplete?.call(this, this);
            return true;
        }
        return false;
    }

    static tick(): typeof Tween {
        for (let index = 0; index < Tween._tweens.length; index++) {
            const tween = Tween._tweens[index];
            if (tween?.update(Date.now())) {
                Tween._tweens.splice(index, 1);
                index--;
            }
        }
        return Tween;
    }

    static add(tween: Tween): typeof Tween {
        if (!Tween._tweens.includes(tween)) Tween._tweens.push(tween);
        return Tween;
    }

    static remove(tweenOrTarget: Tween | object | readonly (Tween | object)[]): typeof Tween {
        if (isObjectArray(tweenOrTarget)) {
            tweenOrTarget.forEach(item => Tween.remove(item));
            return Tween;
        }
        if (tweenOrTarget instanceof Tween) {
            const index = Tween._tweens.indexOf(tweenOrTarget);
            if (index >= 0) Tween._tweens.splice(index, 1);
            return Tween;
        }
        for (let index = Tween._tweens.length - 1; index >= 0; index--) {
            if (Tween._tweens[index]?.target === tweenOrTarget) Tween._tweens.splice(index, 1);
        }
        return Tween;
    }

    static removeAll(): typeof Tween {
        Tween._tweens.length = 0;
        return Tween;
    }

    static fromTo(
        target: object,
        fromProperties: TweenProperties | null,
        toProperties: TweenProperties,
        params?: TweenParameters
    ): Tween;
    static fromTo(
        target: readonly object[],
        fromProperties: TweenProperties | null,
        toProperties: TweenProperties,
        params?: TweenParameters
    ): Tween[];
    static fromTo(
        target: object | readonly object[],
        fromProperties: TweenProperties | null,
        toProperties: TweenProperties,
        params: TweenParameters = {}
    ): Tween | Tween[] {
        const targets = isObjectArray(target) ? target : [target];
        const tweens = targets.map((item, index) => {
            const tween = new Tween(item, fromProperties, toProperties, params);
            if (params.stagger) {
                tween.delay = delayValue(params.delay ?? 0) + index * params.stagger;
            }
            return tween.start();
        });
        return isObjectArray(target)
            ? tweens
            : (tweens[0] ?? new Tween(target, fromProperties, toProperties, params));
    }

    static to(target: object, toProperties: TweenProperties, params?: TweenParameters): Tween;
    static to(
        target: readonly object[],
        toProperties: TweenProperties,
        params?: TweenParameters
    ): Tween[];
    static to(
        target: object | readonly object[],
        toProperties: TweenProperties,
        params: TweenParameters = {}
    ): Tween | Tween[] {
        if (isObjectArray(target)) return Tween.fromTo(target, null, toProperties, params);
        return Tween.fromTo(target, null, toProperties, params);
    }

    static from(target: object, fromProperties: TweenProperties, params?: TweenParameters): Tween;
    static from(
        target: readonly object[],
        fromProperties: TweenProperties,
        params?: TweenParameters
    ): Tween[];
    static from(
        target: object | readonly object[],
        fromProperties: TweenProperties,
        params: TweenParameters = {}
    ): Tween | Tween[] {
        if (isObjectArray(target)) return Tween.fromTo(target, fromProperties, {}, params);
        return Tween.fromTo(target, fromProperties, {}, params);
    }
}

export default Tween;
