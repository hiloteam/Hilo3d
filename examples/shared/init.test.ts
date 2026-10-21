import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Hilo3d from '../../src/Hilo3d';

const stats = vi.hoisted(() => ({
    created: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn()
}));

vi.mock('./stats', () => ({
    default: class {
        constructor() {
            stats.created();
        }
        suspend = stats.suspend;
        resume = stats.resume;
        dispose = stats.dispose;
    }
}));

const disposers: (() => void)[] = [];

function transition(type: 'pagehide' | 'pageshow', persisted: boolean): void {
    window.dispatchEvent(Object.assign(new Event(type), { persisted }));
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
    const canvas = Object.assign(new EventTarget(), { style: { touchAction: '' } });
    const stage = Object.assign(new Hilo3d.Node(), {
        camera: new Hilo3d.PerspectiveCamera({ z: 3 }),
        canvas,
        renderer: { backend: 'webgl2', waitForIdle: () => Promise.resolve() },
        resize: vi.fn(),
        destroy
    }) as unknown as Hilo3d.Stage;
    return { calls, start, stop, destroy, stage };
}

beforeEach(() => {
    if (typeof window === 'undefined') {
        vi.stubGlobal(
            'window',
            Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 400 })
        );
    }
    if (typeof location === 'undefined') vi.stubGlobal('location', new URL('http://localhost/'));
    vi.clearAllMocks();
});

afterEach(() => {
    for (const dispose of disposers) dispose();
    disposers.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('example runtime initialization', () => {
    it('rolls back the Stage and statistics when control configuration fails', async () => {
        const { createExampleContext } = await import('./init');
        const state = fixture();
        vi.spyOn(Hilo3d.Stage, 'create').mockResolvedValue(state.stage);
        await expect(
            createExampleContext({
                backend: 'webgl2',
                container: {} as HTMLElement,
                controls: { minDistance: 2, maxDistance: 1 }
            })
        ).rejects.toThrow();
        expect(state.start).not.toHaveBeenCalled();
        expect(state.destroy).toHaveBeenCalledOnce();
        expect(stats.dispose).toHaveBeenCalledOnce();
        transition('pageshow', true);
        expect(stats.resume).not.toHaveBeenCalled();
    });

    it('runs scene cleanup before renderer teardown and updates the active imported camera on resize', async () => {
        const { createExampleContext } = await import('./init');
        const state = fixture();
        vi.spyOn(Hilo3d.Stage, 'create').mockResolvedValue(state.stage);
        const context = await createExampleContext({
            backend: 'webgl2',
            container: {} as HTMLElement
        });
        disposers.push(context.dispose);
        const imported = new Hilo3d.PerspectiveCamera({ aspect: 1 });
        state.stage.camera = imported;
        window.dispatchEvent(new Event('resize'));
        expect(imported.aspect).toBe(window.innerWidth / window.innerHeight);
        context.onDispose(() => {
            state.calls.push('scene');
        });
        transition('pagehide', true);
        expect(state.destroy).not.toHaveBeenCalled();
        transition('pageshow', true);
        expect(state.start).toHaveBeenCalledTimes(2);
        transition('pagehide', false);
        expect(state.calls.indexOf('scene')).toBeLessThan(state.calls.indexOf('destroy'));
        expect(state.calls[state.calls.indexOf('scene') - 1]).toBe('stop');
        expect(state.destroy).toHaveBeenCalledOnce();
        context.ticker.start();
        expect(state.start).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])(
        'handles pagehide while Stage.create is pending (persisted: %s)',
        async persisted => {
            const { createExampleContext } = await import('./init');
            const state = fixture();
            let resolveStage: ((value: Hilo3d.Stage) => void) | undefined;
            vi.spyOn(Hilo3d.Stage, 'create').mockImplementation(
                () =>
                    new Promise(resolve => {
                        resolveStage = resolve;
                    })
            );
            const pending = createExampleContext({
                backend: 'webgl2',
                container: {} as HTMLElement
            });
            const rejected = persisted
                ? undefined
                : expect(pending).rejects.toMatchObject({ name: 'AbortError' });
            transition('pagehide', persisted);
            if (resolveStage === undefined) throw new Error('Stage creation did not start');
            resolveStage(state.stage);
            if (!persisted) {
                await rejected;
                expect(state.destroy).toHaveBeenCalledOnce();
                expect(stats.created).not.toHaveBeenCalled();
            } else {
                const context = await pending;
                disposers.push(context.dispose);
                expect(state.destroy).not.toHaveBeenCalled();
                expect(context.lifecycle.active).toBe(false);
                transition('pageshow', true);
                expect(state.start).toHaveBeenCalledOnce();
            }
        }
    );
});
