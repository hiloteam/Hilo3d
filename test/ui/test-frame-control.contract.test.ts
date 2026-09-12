import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestFrameControl } from '../../examples/shared/test-frame-control';

afterEach(() => {
    vi.useRealTimers();
});

describe('test renderer backpressure', () => {
    it('waits for actual ticker callbacks and rejects pending waits on disposal', async () => {
        const ticker = {
            pause: vi.fn(),
            resume: vi.fn(),
            stop: vi.fn(),
            addTick: vi.fn(),
            removeTick: vi.fn()
        };
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
        const ticker = {
            pause: vi.fn(),
            resume: vi.fn(),
            stop: vi.fn(),
            addTick: vi.fn(),
            removeTick: vi.fn()
        };
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

    it('does not revive a disposed ticker after its submission finishes', async () => {
        vi.useFakeTimers();
        const ticker = {
            pause: vi.fn(),
            resume: vi.fn(),
            stop: vi.fn(),
            addTick: vi.fn(),
            removeTick: vi.fn()
        };
        const control = createTestFrameControl(ticker, () => Promise.resolve());
        const frame = ticker.addTick.mock.calls[0]?.[0] as { tick(): void };
        frame.tick();
        control.dispose();
        await vi.advanceTimersByTimeAsync(100);
        expect(ticker.resume).not.toHaveBeenCalled();
        expect(ticker.removeTick).toHaveBeenCalledWith(frame);
    });
});
