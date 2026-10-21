import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../src/Hilo3d';
import { createStudioScene, type Studio } from './studio2d';

function transition(type: 'pagehide' | 'pageshow', persisted: boolean): void {
    const event = new Event(type);
    Object.defineProperty(event, 'persisted', { value: persisted });
    window.dispatchEvent(event);
}

function fixture() {
    const calls: string[] = [];
    const start = vi.spyOn(Hilo3d.Ticker.prototype, 'start').mockImplementation(() => {
        calls.push('start');
    });
    const stop = vi.spyOn(Hilo3d.Ticker.prototype, 'stop').mockImplementation(() => {
        calls.push('stop');
    });
    const destroy = vi.fn(() => {
        calls.push('destroy');
    });
    const resize = vi.fn();
    const stage = { renderer: { backend: 'webgl2' }, resize, destroy } as unknown as Hilo3d.Stage;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe = observe;
            disconnect = disconnect;
        }
    );
    const studio = {
        container: { clientWidth: 400, clientHeight: 300 } as HTMLElement,
        ready: vi.fn()
    } as unknown as Studio;
    return { calls, start, stop, destroy, resize, stage, observe, disconnect, studio };
}

beforeEach(() => {
    if (typeof window === 'undefined') vi.stubGlobal('window', new EventTarget());
    if (typeof location === 'undefined') vi.stubGlobal('location', new URL('http://localhost/'));
    if (typeof devicePixelRatio === 'undefined') vi.stubGlobal('devicePixelRatio', 1);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('2D studio lifecycle', () => {
    it('retains a suspended scene, then stops rendering before final destruction', async () => {
        const state = fixture();
        vi.spyOn(Hilo3d.Stage, 'create').mockResolvedValue(state.stage);
        const scene = await createStudioScene(state.studio);
        scene.start();
        transition('pagehide', true);
        expect(state.stop).toHaveBeenCalledOnce();
        expect(state.disconnect).toHaveBeenCalledOnce();
        expect(state.destroy).not.toHaveBeenCalled();
        transition('pageshow', true);
        expect(state.start).toHaveBeenCalledTimes(2);
        expect(state.observe).toHaveBeenCalledTimes(2);
        transition('pagehide', false);
        expect(state.calls.indexOf('destroy')).toBeGreaterThan(state.calls.lastIndexOf('start'));
        expect(state.calls[state.calls.indexOf('destroy') - 1]).toBe('stop');
        expect(state.destroy).toHaveBeenCalledOnce();
        transition('pageshow', true);
        scene.start();
        scene.dispose();
        expect(state.start).toHaveBeenCalledTimes(2);
        expect(state.destroy).toHaveBeenCalledOnce();
    });

    it('does not start a scene that was still being authored when restored', async () => {
        const state = fixture();
        vi.spyOn(Hilo3d.Stage, 'create').mockResolvedValue(state.stage);
        const scene = await createStudioScene(state.studio);
        transition('pagehide', true);
        transition('pageshow', true);
        expect(state.start).not.toHaveBeenCalled();
        scene.start();
        expect(state.start).toHaveBeenCalledOnce();
        scene.dispose();
    });

    it.each([false, true])(
        'handles pagehide during Stage creation (persisted: %s)',
        async persisted => {
            const state = fixture();
            let resolveStage: ((stage: Hilo3d.Stage) => void) | undefined;
            vi.spyOn(Hilo3d.Stage, 'create').mockImplementation(
                () =>
                    new Promise(resolve => {
                        resolveStage = resolve;
                    })
            );
            const creating = createStudioScene(state.studio);
            transition('pagehide', persisted);
            if (resolveStage === undefined) throw new Error('Stage creation was not requested');
            resolveStage(state.stage);
            const scene = await creating;
            scene.start();
            expect(state.start).not.toHaveBeenCalled();
            expect(state.observe).not.toHaveBeenCalled();
            expect(state.destroy).toHaveBeenCalledTimes(persisted ? 0 : 1);
            transition('pageshow', true);
            expect(state.start).toHaveBeenCalledTimes(persisted ? 1 : 0);
            scene.dispose();
            expect(state.destroy).toHaveBeenCalledOnce();
        }
    );
});
