interface TickObject {
    tick(deltaTime: number): void;
}

/**
 * Ticker是一个定时器类。它可以按指定帧率重复运行，从而按计划执行代码。
 * @class Ticker
 * @param fps 指定定时器的运行帧率。默认60。
 */
class Ticker {
    private _paused: boolean = false;

    private _targetFPS: number = 0;

    private _interval: number = 0;

    private _intervalId: number | null = null;

    private _tickers: TickObject[] = [];

    private _lastTime: number = 0;

    private _tickCount: number = 0;

    private _tickTime: number = 0;

    private _measuredFPS: number = 0;

    private _useRAF: boolean = false;

    constructor(fps?: number) {
        this.targetFPS = fps || 60;
    }

    /**
     * 定时器的目标帧率
     */
    get targetFPS(): number {
        return this._targetFPS;
    }

    set targetFPS(value: number) {
        this._targetFPS = value;
        this._interval = 1000 / this._targetFPS;
        if (this._intervalId) {
            this._cancelRunLoop();
            this._startRunLoop();
        }
    }

    /**
     * 启动定时器。
     */
    start(): void {
        this._paused = false;
        this._startRunLoop();
    }

    /**
     * 停止定时器。
     */
    stop(): void {
        this._paused = true;
        this._cancelRunLoop();
        this._lastTime = 0;
    }

    /**
     * 暂停定时器。
     */
    pause(): void {
        this._paused = true;
    }

    /**
     * 恢复定时器。
     */
    resume(): void {
        this._paused = false;
    }

    /**
     * @private
     */
    private _startRunLoop(): void {
        if (this._intervalId) {
            return;
        }

        this._lastTime = +new Date();

        const self = this;
        const interval = this._interval;
        const raf = window.requestAnimationFrame;

        let runLoop: () => void;
        if (raf && interval < 17) {
            this._useRAF = true;
            runLoop = function() {
                self._intervalId = raf(runLoop) as any;
                self._tick();
            };
        } else {
            this._useRAF = false;
            runLoop = function() {
                self._intervalId = setTimeout(runLoop, interval) as any;
                self._tick();
            };
        }

        runLoop();
    }

    /**
     * @private
     */
    private _cancelRunLoop(): void {
        if (this._useRAF) {
            const cancelRAF = window.cancelAnimationFrame;
            cancelRAF(this._intervalId!);
        } else {
            clearTimeout(this._intervalId!);
        }
        this._intervalId = null;
    }

    /**
     * @private
     */
    private _tick(): void {
        if (this._paused) return;
        const startTime = +new Date();
        const deltaTime = startTime - this._lastTime;
        const tickers = this._tickers;

        // calculates the real fps
        if (++this._tickCount >= this._targetFPS) {
            this._measuredFPS = (1000 / (this._tickTime / this._tickCount) + 0.5) >> 0;
            this._tickCount = 0;
            this._tickTime = 0;
        } else {
            this._tickTime += startTime - this._lastTime;
        }
        this._lastTime = startTime;

        const tickersCopy = tickers.slice(0);
        for (let i = 0, len = tickersCopy.length; i < len; i++) {
            tickersCopy[i].tick(deltaTime);
        }
    }

    /**
     * 获得测定的运行时帧率。
     */
    getMeasuredFPS(): number {
        return Math.min(this._measuredFPS, this._targetFPS);
    }

    /**
     * 添加定时器对象。定时器对象必须实现 tick 方法。
     * @param tickObject 对象
     */
    addTick(tickObject: TickObject): void {
        if (!tickObject || typeof tickObject.tick !== 'function') {
            throw new Error(
                'Ticker: The tick object must implement the tick method.'
            );
        }
        this._tickers.push(tickObject);
    }

    /**
     * 删除定时器对象。
     * @param tickObject 要删除的定时器对象。
     */
    removeTick(tickObject: TickObject): void {
        const tickers = this._tickers;
        const index = tickers.indexOf(tickObject);
        if (index >= 0) {
            tickers.splice(index, 1);
        }
    }

    /**
     * 下次tick时回调
     * @param callback 回调函数
     * @return tickObject 定时器对象
     */
    // eslint-disable-next-line no-unused-vars
    nextTick(callback: (dt: number) => void): TickObject {
        const that = this;
        const tickObj: TickObject = {
            // eslint-disable-next-line no-unused-vars
            tick(_dt: number) {
                that.removeTick(tickObj);
                callback(_dt);
            },
        };

        that.addTick(tickObj);
        return tickObj;
    }

    /**
     * 延迟指定的时间后调用回调, 类似setTimeout
     * @param callback 回调函数
     * @param duration 延迟的毫秒数
     * @return tickObject 定时器对象
     */
    timeout(callback: () => void, duration: number): TickObject {
        const that = this;
        const targetTime = new Date().getTime() + duration;
        const tickObj: TickObject = {
            // eslint-disable-next-line no-unused-vars
            tick(_dt: number) {
                const nowTime = new Date().getTime();
                const dt = nowTime - targetTime;
                if (dt >= 0) {
                    that.removeTick(tickObj);
                    callback();
                }
            },
        };
        that.addTick(tickObj);
        return tickObj;
    }

    /**
     * 指定的时间周期来调用函数, 类似setInterval
     * @param callback 回调函数
     * @param duration 时间周期，单位毫秒
     * @return tickObject 定时器对象
     */
    interval(callback: () => void, duration: number): TickObject {
        const that = this;
        let targetTime = new Date().getTime() + duration;
        const tickObj: TickObject = {
            // eslint-disable-next-line no-unused-vars
            tick(_dt: number) {
                let nowTime = new Date().getTime();
                const dt = nowTime - targetTime;
                if (dt >= 0) {
                    if (dt < duration) {
                        nowTime -= dt;
                    }
                    targetTime = nowTime + duration;
                    callback();
                }
            },
        };
        that.addTick(tickObj);
        return tickObj;
    }
}

export default Ticker;
