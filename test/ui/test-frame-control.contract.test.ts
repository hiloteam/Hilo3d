import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestFrameControl } from '../../examples/shared/test-frame-control';

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

const createTicker = () => ({
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    addTick: vi.fn<(tick: { tick(): void }) => void>(),
    removeTick: vi.fn<(tick: { tick(): void }) => void>()
});

describe('test renderer backpressure', () => {
    it('waits for actual ticker callbacks and rejects pending waits on disposal', async () => {
        const ticker = createTicker();
        const control = createTestFrameControl(ticker, () => Promise.resolve());
        const completed = vi.fn();
        const frames = control.waitForFrames(2).then(completed);
        const observer = ticker.addTick.mock.calls[1]?.[0] as { tick(): void };
        await Promise.resolve();
        expect(completed).not.toHaveBeenCalled();
        observer.tick();
        await Promise.resolve();
        expect(completed).not.toHaveBeenCalled();
        observer.tick();
        await frames;
        expect(completed).toHaveBeenCalledTimes(1);
        const pending = expect(control.waitForFrames(1)).rejects.toThrow('disposed');
        control.dispose();
        await pending;
    });
    it('waits for submission and an idle window, and never resumes during capture', async () => {
        vi.useFakeTimers();
        let finish: (() => void) | undefined;
        const fence = new Promise<void>(resolve => {
            finish = resolve;
        });
        const ticker = createTicker();
        const control = createTestFrameControl(ticker, () => fence);
        const frame = ticker.addTick.mock.calls[0]?.[0] as { tick(): void };
        frame.tick();
        await vi.advanceTimersByTimeAsync(100);
        expect(ticker.resume).not.toHaveBeenCalled();
        const capture = control.pause();
        finish?.();
        await capture;
        await vi.advanceTimersByTimeAsync(50);
        expect(ticker.resume).not.toHaveBeenCalled();
        control.resume();
        expect(ticker.resume).toHaveBeenCalledTimes(1);
        control.dispose();
    });

    it('rejects capture waits and never accesses the renderer after disposal', async () => {
        vi.useFakeTimers();
        const ticker = createTicker();
        const waitForIdle = vi.fn(() => Promise.resolve());
        const control = createTestFrameControl(ticker, waitForIdle);
        const frame = ticker.addTick.mock.calls[0]?.[0] as { tick(): void };
        frame.tick();
        const capture = expect(control.pause()).rejects.toThrow('disposed');
        control.dispose();
        await capture;
        ticker.pause.mockClear();
        await expect(control.pause()).rejects.toThrow('disposed');
        control.resume();
        control.setSuspended(true);
        control.setSuspended(false);
        await vi.advanceTimersByTimeAsync(100);
        expect(waitForIdle).not.toHaveBeenCalled();
        expect(ticker.pause).not.toHaveBeenCalled();
        expect(ticker.resume).not.toHaveBeenCalled();
        expect(ticker.removeTick).toHaveBeenCalledWith(frame);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels the pending idle window on disposal', async () => {
        vi.useFakeTimers();
        const ticker = createTicker();
        const control = createTestFrameControl(ticker, () => Promise.resolve());
        const frame = ticker.addTick.mock.calls[0]?.[0] as { tick(): void };
        frame.tick();
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);
        control.dispose();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(100);
        expect(ticker.resume).not.toHaveBeenCalled();
    });

    it('reports a failed submission once and rejects every wait without retaining observers', async () => {
        vi.useFakeTimers();
        const reports: VoidFunction[] = [];
        vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(callback => {
            reports.push(callback);
        });
        const failure = new Error('GPU submission failed');
        let rejectFence: ((reason: unknown) => void) | undefined;
        const fence = new Promise<void>((_resolve, reject) => {
            rejectFence = reject;
        });
        const ticker = createTicker();
        const waitForIdle = vi.fn(() => fence);
        const control = createTestFrameControl(ticker, waitForIdle);
        const waits = [
            expect(control.waitForFrames(2)).rejects.toBe(failure),
            expect(control.waitForFrames(3)).rejects.toBe(failure)
        ];
        const frame = ticker.addTick.mock.calls[0]?.[0] as { tick(): void };
        frame.tick();
        waits.push(expect(control.pause()).rejects.toBe(failure));
        await vi.advanceTimersByTimeAsync(0);
        rejectFence?.(failure);
        await Promise.all(waits);
        await vi.advanceTimersByTimeAsync(0);
        expect(ticker.stop).toHaveBeenCalledTimes(1);
        for (const [observer] of ticker.addTick.mock.calls) {
            expect(ticker.removeTick).toHaveBeenCalledWith(observer);
        }
        expect(ticker.removeTick).toHaveBeenCalledTimes(3);
        expect(reports).toHaveLength(1);
        expect(reports[0]).toThrow(failure);
        waitForIdle.mockClear();
        ticker.pause.mockClear();
        await expect(control.waitForFrames(1)).rejects.toBe(failure);
        await expect(control.pause()).rejects.toBe(failure);
        frame.tick();
        control.resume();
        control.setSuspended(true);
        control.setSuspended(false);
        expect(waitForIdle).not.toHaveBeenCalled();
        expect(ticker.pause).not.toHaveBeenCalled();
        expect(ticker.resume).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        control.dispose();
        expect(reports).toHaveLength(1);
    });

    it('keeps suspension independent from capture while a submission completes', async () => {
        vi.useFakeTimers();
        let finish: (() => void) | undefined;
        const fence = new Promise<void>(resolve => {
            finish = resolve;
        });
        const ticker = createTicker();
        const control = createTestFrameControl(ticker, () => fence);
        const frame = ticker.addTick.mock.calls[0]?.[0] as { tick(): void };
        frame.tick();
        control.setSuspended(true);
        finish?.();
        await vi.advanceTimersByTimeAsync(50);
        expect(ticker.resume).not.toHaveBeenCalled();
        await control.pause();
        control.setSuspended(false);
        expect(ticker.resume).not.toHaveBeenCalled();
        control.setSuspended(true);
        control.resume();
        expect(ticker.resume).not.toHaveBeenCalled();
        control.setSuspended(false);
        expect(ticker.resume).toHaveBeenCalledTimes(1);
        control.setSuspended(false);
        expect(ticker.resume).toHaveBeenCalledTimes(1);
        control.dispose();
    });

    it('waits for the pending submission when suspension ends', async () => {
        vi.useFakeTimers();
        let finish: (() => void) | undefined;
        const fence = new Promise<void>(resolve => {
            finish = resolve;
        });
        const ticker = createTicker();
        const control = createTestFrameControl(ticker, () => fence);
        const frame = ticker.addTick.mock.calls[0]?.[0] as { tick(): void };
        frame.tick();
        control.setSuspended(true);
        control.setSuspended(false);
        expect(ticker.resume).not.toHaveBeenCalled();
        finish?.();
        await vi.advanceTimersByTimeAsync(50);
        expect(ticker.resume).toHaveBeenCalledTimes(1);
        control.dispose();
    });
});
