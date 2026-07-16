import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../../src/Hilo3d';

const Ticker = Hilo3d.Ticker;

interface CountingTick {
    tickNum: number;
    tick(deltaTime: number): void;
}

describe('Ticker', () => {
    let ticker: Hilo3d.Ticker;
    let tickObject: CountingTick;

    beforeEach(() => {
        vi.useFakeTimers();
        ticker = new Ticker(30);
        tickObject = {
            tickNum: 0,
            tick() {
                this.tickNum++;
            }
        };
    });

    afterEach(() => {
        ticker.stop();
        vi.useRealTimers();
    });

    it('adds and removes tick objects', () => {
        ticker.addTick(tickObject);
        ticker.start();
        expect(tickObject.tickNum).toBe(1);

        vi.advanceTimersByTime(70);
        expect(tickObject.tickNum).toBe(3);

        ticker.removeTick(tickObject);
        vi.advanceTimersByTime(70);
        expect(tickObject.tickNum).toBe(3);
    });

    it('passes elapsed time to tick objects', () => {
        const tick = vi.fn<(deltaTime: number) => void>();
        ticker.addTick({ tick });
        ticker.start();
        vi.advanceTimersByTime(34);

        expect(tick).toHaveBeenCalledTimes(2);
        expect(tick.mock.lastCall?.[0]).toBeGreaterThanOrEqual(33);
        expect(tick.mock.lastCall?.[0]).toBeLessThanOrEqual(34);
    });

    it('pauses and resumes without stopping the run loop', () => {
        ticker.addTick(tickObject);
        ticker.start();
        vi.advanceTimersByTime(70);
        const countBeforePause = tickObject.tickNum;

        ticker.pause();
        vi.advanceTimersByTime(100);
        expect(tickObject.tickNum).toBe(countBeforePause);

        ticker.resume();
        vi.advanceTimersByTime(70);
        expect(tickObject.tickNum).toBeGreaterThan(countBeforePause);
    });

    it('updates its scheduling interval when targetFPS changes', () => {
        const tick = vi.fn<(deltaTime: number) => void>();
        ticker.addTick({ tick });
        ticker.start();
        vi.advanceTimersByTime(34);
        expect(tick.mock.lastCall?.[0]).toBeGreaterThanOrEqual(33);

        ticker.targetFPS = 60;
        const callsAfterRestart = tick.mock.calls.length;
        vi.advanceTimersByTime(17);

        expect(ticker.targetFPS).toBe(60);
        expect(tick.mock.calls.length).toBeGreaterThan(callsAfterRestart);
        expect(tick.mock.lastCall?.[0]).toBeLessThanOrEqual(17);
    });

    it('runs nextTick callbacks only once', () => {
        const callback = vi.fn<(deltaTime: number) => void>();
        ticker.nextTick(callback);
        ticker.start();
        vi.advanceTimersByTime(100);

        expect(callback).toHaveBeenCalledOnce();
    });
});
