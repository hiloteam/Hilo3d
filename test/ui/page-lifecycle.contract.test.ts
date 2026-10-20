import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExampleTicker } from '../../examples/shared/ExampleTicker';
import { installPageLifecycle } from '../../examples/shared/pageLifecycle';
import Ticker from '../../src/utils/Ticker';

function transition(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
    return Object.assign(new Event(type), { persisted });
}

afterEach(() => vi.restoreAllMocks());

describe('example page lifecycle', () => {
    it('preserves owners across BFCache and tears down hooks before the runtime exactly once', () => {
        const events = new EventTarget();
        const order: string[] = [];
        const lifecycle = installPageLifecycle(
            {
                pause: () => {
                    order.push('pause');
                },
                resume: () => {
                    order.push('resume');
                },
                dispose: () => {
                    order.push('runtime');
                }
            },
            events
        );
        lifecycle.onDispose(() => {
            order.push('scene');
        });
        events.dispatchEvent(transition('pagehide', true));
        expect(lifecycle.active).toBe(false);
        expect(lifecycle.disposed).toBe(false);
        expect(order).toEqual(['pause']);
        events.dispatchEvent(transition('pageshow', true));
        expect(lifecycle.active).toBe(true);
        events.dispatchEvent(transition('pagehide', false));
        expect(order).toEqual(['pause', 'resume', 'pause', 'scene', 'runtime']);
        expect(lifecycle.disposed).toBe(true);
        lifecycle.dispose();
        events.dispatchEvent(transition('pageshow', true));
        expect(lifecycle.active).toBe(false);
        expect(order).toHaveLength(5);
        lifecycle.onDispose(() => {
            order.push('late-resource');
        });
        expect(order.at(-1)).toBe('late-resource');
    });

    it('finishes cleanup despite failures and recursive disposal', () => {
        const events = new EventTarget();
        const errors = [new Error('pause'), new Error('scene'), new Error('runtime')] as const;
        const later = vi.fn();
        const lifecycle = installPageLifecycle(
            {
                pause(): void {
                    throw errors[0];
                },
                resume: vi.fn(),
                dispose(): void {
                    throw errors[2];
                }
            },
            events
        );
        lifecycle.onDispose(() => {
            lifecycle.dispose();
            throw errors[1];
        });
        lifecycle.onDispose(later);
        try {
            lifecycle.dispose();
            throw new Error('Expected teardown errors');
        } catch (error) {
            expect(error).toBeInstanceOf(AggregateError);
            expect((error as AggregateError).errors).toEqual(errors);
        }
        expect(later).toHaveBeenCalledTimes(1);
        expect(lifecycle.disposed).toBe(true);
        expect(() => {
            lifecycle.dispose();
        }).not.toThrow();
    });
});

describe('example ticker suspension', () => {
    it('remembers start requests while hidden and never revives after disposal', () => {
        const start = vi.spyOn(Ticker.prototype, 'start').mockImplementation(() => undefined);
        const stop = vi.spyOn(Ticker.prototype, 'stop').mockImplementation(() => undefined);
        const ticker = new ExampleTicker();
        ticker.suspend();
        ticker.start();
        expect(start).not.toHaveBeenCalled();
        ticker.restore();
        expect(start).toHaveBeenCalledTimes(1);
        ticker.suspend();
        ticker.stop();
        ticker.restore();
        expect(start).toHaveBeenCalledTimes(1);
        ticker.dispose();
        ticker.start();
        ticker.resume();
        ticker.restore();
        expect(start).toHaveBeenCalledTimes(1);
        expect(stop).toHaveBeenCalled();
    });

    it('preserves an explicit pause while suspended until its owner resumes', () => {
        const start = vi.spyOn(Ticker.prototype, 'start').mockImplementation(() => undefined);
        vi.spyOn(Ticker.prototype, 'stop').mockImplementation(() => undefined);
        const ticker = new ExampleTicker();
        ticker.start();
        ticker.pause();
        ticker.suspend();
        ticker.restore();
        expect(start).toHaveBeenCalledTimes(1);
        ticker.resume();
        expect(start).toHaveBeenCalledTimes(2);
        ticker.dispose();
    });
});
