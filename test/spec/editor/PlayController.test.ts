import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
    PlayController,
    type PlayComponents,
    type PlayControllerOptions
} from '../../../editor/play-controller';
import { createProject } from '../../../editor/project';
import { createDefaultScene } from '../../../editor/scene';
import { ScriptRuntime } from '../../../editor/script-runtime';
import { createClip } from '../../../editor/animation';

const controllers: PlayController[] = [];
afterEach(async () => {
    for (const controller of controllers.splice(0)) await controller.dispose();
});
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => {
        throw new Error('Missing deferred resolver');
    };
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
function fixture(overrides: Partial<PlayControllerOptions> = {}): {
    controller: PlayController;
    options: PlayControllerOptions;
    project: ReturnType<typeof createProject>;
    script: {
        start: MockInstance<ScriptRuntime['start']>;
        step: MockInstance<ScriptRuntime['step']>;
        stop: MockInstance<ScriptRuntime['stop']>;
    };
} {
    const project = createProject(createDefaultScene());
    const script = {
        start: vi.spyOn(ScriptRuntime.prototype, 'start').mockResolvedValue({}),
        step: vi.spyOn(ScriptRuntime.prototype, 'step').mockResolvedValue({}),
        stop: vi.spyOn(ScriptRuntime.prototype, 'stop').mockResolvedValue()
    };
    const options: PlayControllerOptions = {
        getProject: () => project,
        getClipId: () => null,
        onTransforms: vi.fn(),
        onRestore: vi.fn(),
        onState: vi.fn(),
        onLog: vi.fn(),
        onError: vi.fn(),
        ...overrides
    };
    const controller = new PlayController(options);
    controllers.push(controller);
    return { controller, options, project, script };
}

describe('shared fixed-step scene playback', () => {
    it('awaits assets before scripts and components and cancels a late component factory before restore', async () => {
        const assets = deferred<undefined>();
        const components = deferred<PlayComponents>();
        const componentStop = vi.fn();
        const createComponents = vi.fn(() => components.promise);
        const beforeStart = vi.fn(() => assets.promise);
        const { controller, options, script } = fixture({ beforeStart, createComponents });
        const starting = controller.play();
        await expect.poll(() => beforeStart.mock.calls.length).toBe(1);
        expect(script.start).not.toHaveBeenCalled();
        expect(controller.state).toBe('starting');
        assets.resolve(undefined);
        await expect.poll(() => createComponents.mock.calls.length).toBe(1);
        controller.stop();
        expect(controller.state).toBe('stopped');
        expect(options.onRestore).not.toHaveBeenCalled();
        components.resolve({ step: vi.fn(() => ({})), stop: componentStop });
        await starting;
        await controller.waitForStop();
        expect(componentStop).toHaveBeenCalledOnce();
        expect(options.onRestore).toHaveBeenCalledOnce();
        expect(options.onError).not.toHaveBeenCalled();
        expect(options.onState).not.toHaveBeenCalledWith('playing', expect.anything());
    });

    it('samples animation, accepts script transforms, then feeds physics transforms to the next fixed step', async () => {
        const seen: number[] = [];
        const { controller, options, project, script } = fixture({
            getClipId: () => 'motion',
            createComponents: () =>
                Promise.resolve({
                    step: (dt, time, scene) => {
                        expect(dt).toBe(1 / 60);
                        expect(time).toBeCloseTo((seen.length + 1) / 60);
                        const transform = scene.nodes['hero-sphere']?.transform;
                        if (!transform) throw new Error('Missing fixture sphere');
                        seen.push(transform.position.y);
                        const changed = structuredClone(transform);
                        changed.position.y -= 1;
                        return { 'hero-sphere': changed };
                    },
                    stop: vi.fn()
                })
        });
        const authored = JSON.stringify(project);
        const clip = createClip('motion', project.activeSceneId);
        clip.tracks = [
            {
                id: 'x',
                nodeId: 'hero-sphere',
                property: 'position.x',
                keys: [
                    { time: 0, value: 0, interpolation: 'linear' },
                    { time: 1, value: 6, interpolation: 'linear' }
                ]
            }
        ];
        project.clips['motion'] = clip;
        const scriptPositions: number[] = [];
        script.step.mockImplementation(scene => {
            const transform = scene.nodes['hero-sphere']?.transform;
            if (!transform) throw new Error('Missing sphere');
            scriptPositions.push(transform.position.y);
            return Promise.resolve({});
        });
        await controller.play();
        controller.pause();
        await controller.step();
        await controller.step();
        expect(controller.elapsedTime).toBeCloseTo(2 / 60);
        expect(scriptPositions[1]).toBe((scriptPositions[0] ?? 0) - 1);
        expect(seen).toEqual(scriptPositions);
        expect(
            vi.mocked(options.onTransforms).mock.calls.at(-1)?.[0]?.['hero-sphere']?.position.x
        ).toBeCloseTo(0.2);
        delete project.clips['motion'];
        expect(JSON.stringify(project)).toBe(authored);
        await controller.reset();
        expect(controller.state).toBe('paused');
        expect(controller.elapsedTime).toBe(0);
    });

    it('discards a late script response after stop and waits for the stop hook before component destruction', async () => {
        const hook = deferred<undefined>();
        const scriptStep = deferred<Record<string, never>>();
        const order: string[] = [];
        const componentStop = vi.fn(() => {
            order.push('components');
        });
        const { controller, options, script } = fixture({
            createComponents: () =>
                Promise.resolve({ step: vi.fn(() => ({})), stop: componentStop }),
            onRestore: () => {
                order.push('restore');
            }
        });
        script.stop.mockImplementation(() => hook.promise);
        await controller.play();
        controller.pause();
        script.step.mockImplementation(() => scriptStep.promise);
        const stepping = controller.step();
        await expect.poll(() => script.step.mock.calls.length).toBe(1);
        controller.stop();
        const calls = vi.mocked(options.onTransforms).mock.calls.length;
        scriptStep.resolve({});
        await stepping;
        expect(options.onTransforms).toHaveBeenCalledTimes(calls);
        expect(componentStop).not.toHaveBeenCalled();
        order.push('script');
        hook.resolve(undefined);
        await controller.waitForStop();
        expect(order).toEqual(['script', 'components', 'restore']);
    });

    it('starts the next session only after the old component cleanup and reports runtime failure', async () => {
        const cleanup = deferred<undefined>();
        let count = 0;
        const { controller, options } = fixture({
            createComponents: () => {
                count++;
                return Promise.resolve({
                    step: () => {
                        throw new Error('Physics failure');
                    },
                    stop: count === 1 ? () => cleanup.promise : vi.fn()
                });
            }
        });
        await controller.play();
        controller.pause();
        await controller.step();
        expect(controller.state).toBe('stopped');
        expect(options.onError).toHaveBeenCalledWith('Physics failure');
        const next = controller.play();
        await Promise.resolve();
        expect(count).toBe(1);
        cleanup.resolve(undefined);
        await next;
        expect(count).toBe(2);
        expect(controller.state).toBe('playing');
    });

    it('preserves a suspension during asynchronous startup and permits resume before preparation ends', async () => {
        const pending = deferred<PlayComponents>();
        const paused = vi.fn();
        const resumed = vi.fn();
        const factory = vi.fn(() => pending.promise);
        const { controller } = fixture({ createComponents: factory });
        const starting = controller.play();
        await expect.poll(() => factory.mock.calls.length).toBe(1);
        controller.pause();
        pending.resolve({ step: () => ({}), pause: paused, resume: resumed, stop: vi.fn() });
        await starting;
        expect(controller.state).toBe('paused');
        expect(controller.elapsedTime).toBe(0);
        expect(paused).toHaveBeenCalledOnce();
        expect(resumed).not.toHaveBeenCalled();
        await controller.play();
        expect(controller.state).toBe('playing');
        expect(resumed).toHaveBeenCalledOnce();
        await controller.dispose();

        const preparation = deferred<undefined>();
        const next = fixture({ beforeStart: () => preparation.promise }).controller;
        const preparing = next.play();
        next.pause();
        const resuming = next.play();
        preparation.resolve(undefined);
        await Promise.all([preparing, resuming]);
        expect(next.state).toBe('playing');
    });

    it('keeps one RAF chain when paused and resumed during an in-flight script step', async () => {
        const frames = new Map<number, FrameRequestCallback>();
        let serial = 0;
        vi.spyOn(performance, 'now').mockReturnValue(1000);
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
            frames.set(++serial, callback);
            return serial;
        });
        vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
            frames.delete(id);
        });
        const nextFrame = (time: number): void => {
            const first = frames.entries().next().value;
            if (!first) throw new Error('Missing scheduled playback frame');
            frames.delete(first[0]);
            first[1](time);
        };
        const waiting = deferred<Record<string, never>>();
        const simulated = vi.fn(() => ({}));
        const { controller, script } = fixture({
            createComponents: () => Promise.resolve({ step: simulated, stop: vi.fn() })
        });
        script.step.mockImplementationOnce(() => waiting.promise);
        await controller.play();
        nextFrame(1100);
        await expect.poll(() => script.step.mock.calls.length).toBe(1);
        controller.pause();
        await controller.play();
        nextFrame(1200);
        waiting.resolve({});
        await expect.poll(() => simulated.mock.calls.length).toBe(4);
        await expect.poll(() => frames.size).toBe(1);
        expect(controller.elapsedTime).toBeCloseTo(4 / 60);
        await controller.dispose();
        expect(frames.size).toBe(0);
    });
});
