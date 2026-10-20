import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Stage from '../../src/core/Stage';
import Ticker from '../../src/utils/Ticker';
import { createExampleStage, ExampleInitializationCancelledError } from './createExampleStage';

function transition(type: 'pagehide' | 'pageshow', persisted: boolean): void {
    window.dispatchEvent(Object.assign(new Event(type), { persisted }));
}

beforeEach(() => {
    if (typeof window === 'undefined') vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('bare example Stage ownership', () => {
    it('retains startup and pause intent while Stage creation spans page suspension', async () => {
        const start = vi.spyOn(Ticker.prototype, 'start').mockImplementation(() => undefined);
        vi.spyOn(Ticker.prototype, 'stop').mockImplementation(() => undefined);
        const destroy = vi.fn();
        const stage = { destroy } as unknown as Stage;
        let resolveStage: ((stage: Stage) => void) | undefined;
        vi.spyOn(Stage, 'create').mockImplementation(
            () =>
                new Promise(resolve => {
                    resolveStage = resolve;
                })
        );
        const initializing = createExampleStage({ backend: 'webgl2' });
        transition('pagehide', true);
        if (resolveStage === undefined) throw new Error('Stage creation was not requested');
        resolveStage(stage);
        const runtime = await initializing;
        runtime.ticker.start();
        expect(start).not.toHaveBeenCalled();
        transition('pageshow', true);
        expect(start).toHaveBeenCalledOnce();
        runtime.ticker.pause();
        transition('pagehide', true);
        transition('pageshow', true);
        expect(start).toHaveBeenCalledOnce();
        runtime.lifecycle.dispose();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('destroys a late Stage after final pagehide without starting it', async () => {
        const start = vi.spyOn(Ticker.prototype, 'start').mockImplementation(() => undefined);
        vi.spyOn(Ticker.prototype, 'stop').mockImplementation(() => undefined);
        const destroy = vi.fn();
        let resolveStage: ((stage: Stage) => void) | undefined;
        vi.spyOn(Stage, 'create').mockImplementation(
            () =>
                new Promise(resolve => {
                    resolveStage = resolve;
                })
        );
        const initializing = createExampleStage({ backend: 'webgl2' });
        const rejected = expect(initializing).rejects.toBeInstanceOf(
            ExampleInitializationCancelledError
        );
        transition('pagehide', false);
        if (resolveStage === undefined) throw new Error('Stage creation was not requested');
        resolveStage({ destroy } as unknown as Stage);
        await rejected;
        transition('pageshow', true);
        expect(start).not.toHaveBeenCalled();
        expect(destroy).toHaveBeenCalledOnce();
    });

    it('releases page listeners when Stage setup rejects', async () => {
        const remove = vi.spyOn(window, 'removeEventListener');
        const failure = new DOMException('device setup failed', 'AbortError');
        vi.spyOn(Stage, 'create').mockRejectedValue(failure);
        await expect(createExampleStage({ backend: 'webgl2' })).rejects.toBe(failure);
        expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('pageshow', expect.any(Function));
    });

    it('destroys the Stage even if a caller cleanup hook fails', async () => {
        const destroy = vi.fn();
        vi.spyOn(Stage, 'create').mockResolvedValue({ destroy } as unknown as Stage);
        const runtime = await createExampleStage({ backend: 'webgl2' });
        const failure = new Error('owned resource cleanup failed');
        runtime.lifecycle.onDispose(() => {
            throw failure;
        });
        expect(() => {
            runtime.lifecycle.dispose();
        }).toThrow(failure);
        expect(destroy).toHaveBeenCalledOnce();
    });
});
