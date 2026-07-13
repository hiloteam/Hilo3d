export interface Tickable {
    tick(deltaTime: number): void;
}

/** Frame scheduler shared by stages, tweens and animations. */
class Ticker {
    private paused = false;
    private targetFrameRate = 60;
    private intervalMs = 1000 / 60;
    private intervalId: number | null = null;
    private readonly tickers: Tickable[] = [];
    private lastTime = 0;
    private tickCount = 0;
    private tickTime = 0;
    private measuredFPS = 0;
    private useAnimationFrame = false;

    constructor(fps = 60) {
        this.targetFPS = fps;
    }

    get targetFPS(): number {
        return this.targetFrameRate;
    }

    set targetFPS(value: number) {
        if (!Number.isFinite(value) || value <= 0) {
            throw new RangeError('Ticker.targetFPS must be a positive finite number.');
        }
        this.targetFrameRate = value;
        this.intervalMs = 1000 / value;
        if (this.intervalId !== null) {
            this.cancelRunLoop();
            this.startRunLoop();
        }
    }

    start(): void {
        this.paused = false;
        this.startRunLoop();
    }

    stop(): void {
        this.paused = true;
        this.cancelRunLoop();
        this.lastTime = 0;
    }

    pause(): void {
        this.paused = true;
    }

    resume(): void {
        this.paused = false;
    }

    private startRunLoop(): void {
        if (this.intervalId !== null) return;

        this.lastTime = performance.now();
        this.useAnimationFrame = this.intervalMs < 17;

        const runLoop = (): void => {
            this.intervalId = this.useAnimationFrame
                ? requestAnimationFrame(runLoop)
                : window.setTimeout(runLoop, this.intervalMs);
            this.tick();
        };
        runLoop();
    }

    private cancelRunLoop(): void {
        if (this.intervalId === null) return;
        if (this.useAnimationFrame) cancelAnimationFrame(this.intervalId);
        else clearTimeout(this.intervalId);
        this.intervalId = null;
    }

    private tick(): void {
        if (this.paused) return;

        const startTime = performance.now();
        const deltaTime = startTime - this.lastTime;

        this.tickCount++;
        if (this.tickCount >= this.targetFrameRate) {
            this.measuredFPS = Math.round(1000 / (this.tickTime / this.tickCount));
            this.tickCount = 0;
            this.tickTime = 0;
        } else {
            this.tickTime += deltaTime;
        }
        this.lastTime = startTime;

        for (const ticker of [...this.tickers]) ticker.tick(deltaTime);
    }

    getMeasuredFPS(): number {
        return Math.min(this.measuredFPS, this.targetFrameRate);
    }

    addTick(tickObject: Tickable): void {
        if (!this.tickers.includes(tickObject)) this.tickers.push(tickObject);
    }

    removeTick(tickObject: Tickable): void {
        const index = this.tickers.indexOf(tickObject);
        if (index >= 0) this.tickers.splice(index, 1);
    }

    nextTick(callback: (deltaTime: number) => void): Tickable {
        const tickObject: Tickable = {
            tick: deltaTime => {
                this.removeTick(tickObject);
                callback(deltaTime);
            }
        };
        this.addTick(tickObject);
        return tickObject;
    }

    timeout(callback: () => void, duration: number): Tickable {
        const targetTime = performance.now() + duration;
        const tickObject: Tickable = {
            tick: () => {
                if (performance.now() < targetTime) return;
                this.removeTick(tickObject);
                callback();
            }
        };
        this.addTick(tickObject);
        return tickObject;
    }

    interval(callback: () => void, duration: number): Tickable {
        let targetTime = performance.now() + duration;
        const tickObject: Tickable = {
            tick: () => {
                const now = performance.now();
                if (now < targetTime) return;
                targetTime = now + duration;
                callback();
            }
        };
        this.addTick(tickObject);
        return tickObject;
    }
}

export default Ticker;
