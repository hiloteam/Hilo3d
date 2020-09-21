import Class from '../core/Class';

/**
 * Ticker是一个定时器类。它可以按指定帧率重复运行，从而按计划执行代码。
 * @param {Number} fps 指定定时器的运行帧率。默认60。
 */
const Ticker = Class.create(/** @lends Ticker.prototype */ {
    constructor(fps) {
        this._targetFPS = fps || 60;
        this._interval = 1000 / this._targetFPS;
        this._tickers = [];
    },

    _paused: false,
    _targetFPS: 0,
    _interval: 0,
    _intervalId: null,
    _tickers: null,
    _lastTime: 0,
    _tickCount: 0,
    _tickTime: 0,
    _measuredFPS: 0,

    /**
     * 启动定时器。
     * @param {Boolean} userRAF 是否使用requestAnimationFrame，默认为true。
     */
    start(useRAF) {
        if (useRAF === undefined) {
            useRAF = true;
        }

        if (this._intervalId) return;
        this._lastTime = +new Date();

        const self = this;
        const interval = this._interval;
        const raf = window.requestAnimationFrame;

        let runLoop;
        if (useRAF && raf && interval < 17) {
            this._useRAF = true;
            runLoop = function() {
                self._intervalId = raf(runLoop);
                self._tick();
            };
        } else {
            runLoop = function() {
                self._intervalId = setTimeout(runLoop, interval);
                self._tick();
            };
        }

        this._paused = false;
        runLoop();
    },

    /**
     * 停止定时器。
     */
    stop() {
        if (this._useRAF) {
            const cancelRAF = window.cancelAnimationFrame;
            cancelRAF(this._intervalId);
        } else {
            clearTimeout(this._intervalId);
        }
        this._intervalId = null;
        this._lastTime = 0;
        this._paused = true;
    },

    /**
     * 暂停定时器。
     */
    pause() {
        this._paused = true;
    },

    /**
     * 恢复定时器。
     */
    resume() {
        this._paused = false;
    },

    /**
     * @private
     */
    _tick() {
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
    },

    /**
     * 获得测定的运行时帧率。
     */
    getMeasuredFPS() {
        return Math.min(this._measuredFPS, this._targetFPS);
    },

    /**
     * 添加定时器对象。定时器对象必须实现 tick 方法。
     * @param {Object} [tickObject] ticker对象
     * @param {Function} tickObject.tick tick 方法
     */
    addTick(tickObject) {
        if (!tickObject || typeof tickObject.tick !== 'function') {
            throw new Error(
                'Ticker: The tick object must implement the tick method.'
            );
        }
        this._tickers.push(tickObject);
    },

    /**
     * 删除定时器对象。
     * @param {Object} tickObject 要删除的定时器对象。
     */
    removeTick(tickObject) {
        const tickers = this._tickers;
        const index = tickers.indexOf(tickObject);
        if (index >= 0) {
            tickers.splice(index, 1);
        }
    },
    /**
     * 下次tick时回调
     * @param  {Function} callback
     * @return {tickObj}
     */
    nextTick(callback) {
        const that = this;
        const tickObj = {
            tick() {
                that.removeTick(tickObj);
                callback();
            },
        };

        that.addTick(tickObj);
        return tickObj;
    },
    /**
     * 延迟指定的时间后调用回调, 类似setTimeout
     * @param  {Function} callback
     * @param  {Number}   duration 延迟的毫秒数
     * @return {tickObj}
     */
    timeout(callback, duration) {
        const that = this;
        const targetTime = new Date().getTime() + duration;
        const tickObj = {
            tick() {
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
    },
    /**
     * 指定的时间周期来调用函数, 类似setInterval
     * @param  {Function} callback
     * @param  {Number}   duration 时间周期，单位毫秒
     * @return {tickObj}
     */
    interval(callback, duration) {
        const that = this;
        let targetTime = new Date().getTime() + duration;
        const tickObj = {
            tick() {
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
    },
});

export default Ticker;
