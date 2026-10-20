import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPageLifecycle, type ExamplePageLifecycle } from './shared/pageLifecycle';

const scene = vi.hoisted(() => ({
    createContext: vi.fn(),
    textureCreated: vi.fn(),
    textureDestroyed: vi.fn(),
    meshAdded: vi.fn()
}));

vi.mock('./shared/init', () => ({ createExampleContext: scene.createContext }));
vi.mock('../src/Hilo3d', () => {
    class SceneValue {
        constructor(readonly value?: unknown) {}
    }
    return {
        constants: { CLAMP_TO_EDGE: 33071 },
        Color: SceneValue,
        PBRMaterial: SceneValue,
        PlaneGeometry: SceneValue,
        Texture: class {
            constructor(parameters: unknown) {
                scene.textureCreated(parameters);
            }
            destroy(): void {
                scene.textureDestroyed();
            }
        },
        Mesh: class {
            constructor(readonly parameters: unknown) {}
            addTo(stage: unknown): this {
                scene.meshAdded(stage);
                return this;
            }
        }
    };
});

class TestVideo extends EventTarget {
    readyState = 0;
    paused = true;
    src = '';
    readonly error = null;
    readonly play = vi.fn((): Promise<void> => {
        this.paused = false;
        return Promise.resolve();
    });
    readonly pause = vi.fn((): void => {
        this.paused = true;
    });
    readonly load = vi.fn();
    readonly removeAttribute = vi.fn((name: string): void => {
        if (name === 'src') this.src = '';
    });
}

function deferred<T>(): {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: Error): void;
} {
    let resolve: ((value: T) => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return {
        promise,
        resolve(value): void {
            if (resolve === undefined) throw new Error('Deferred promise was not initialized');
            resolve(value);
        },
        reject(error): void {
            if (reject === undefined) throw new Error('Deferred promise was not initialized');
            reject(error);
        }
    };
}

let lifecycle: ExamplePageLifecycle | undefined;

function transition(type: 'pagehide' | 'pageshow', persisted: boolean): void {
    window.dispatchEvent(Object.assign(new Event(type), { persisted }));
}

function fixture() {
    const video = new TestVideo();
    const body = typeof document === 'undefined' ? new EventTarget() : document.body;
    if (typeof document === 'undefined') {
        vi.stubGlobal('document', { body, querySelector: () => video });
    } else {
        vi.spyOn(document, 'querySelector').mockReturnValue(video as unknown as Element);
    }
    if (typeof HTMLMediaElement === 'undefined') {
        vi.stubGlobal('HTMLMediaElement', { HAVE_FUTURE_DATA: 3 });
    }
    const owner = installPageLifecycle({ pause: vi.fn(), resume: vi.fn(), dispose: vi.fn() });
    lifecycle = owner;
    const stage = {};
    scene.createContext.mockResolvedValue({ stage, lifecycle: owner, onDispose: owner.onDispose });
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-test');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clickListeners = vi.spyOn(body, 'addEventListener');
    const fetch = vi.fn(() => Promise.resolve(new Response(new Blob(['video']), { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    return { video, body, owner, stage, url, revokeUrl, clickListeners, fetch };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    if (typeof window === 'undefined') vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
    lifecycle?.dispose();
    lifecycle = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('video example lifecycle', () => {
    it('keeps its mesh when BFCache interrupts pending playback and resumes on return', async () => {
        const state = fixture();
        state.video.readyState = 4;
        const playback = deferred<undefined>();
        state.video.play.mockImplementationOnce(() => {
            state.video.paused = false;
            return playback.promise;
        });
        await import('./video');
        await vi.waitFor(() => {
            expect(state.video.play).toHaveBeenCalledOnce();
        });
        expect(scene.meshAdded).toHaveBeenCalledWith(state.stage);
        transition('pagehide', true);
        playback.reject(new DOMException('Playback interrupted by pause', 'AbortError'));
        await playback.promise.catch(() => undefined);
        await Promise.resolve();
        expect(state.owner.disposed).toBe(false);
        expect(scene.textureDestroyed).not.toHaveBeenCalled();
        expect(scene.meshAdded).toHaveBeenCalledOnce();
        transition('pageshow', true);
        await vi.waitFor(() => {
            expect(state.video.play).toHaveBeenCalledTimes(2);
        });
        expect(scene.meshAdded).toHaveBeenCalledOnce();
        state.owner.dispose();
        expect(scene.textureDestroyed).toHaveBeenCalledOnce();
        expect(state.revokeUrl).toHaveBeenCalledWith('blob:video-test');
    });

    it('registers one gesture fallback when decoding finishes hidden and restored playback is blocked', async () => {
        const state = fixture();
        state.video.play.mockRejectedValue(new DOMException('Gesture required', 'NotAllowedError'));
        const videoEvents = vi.spyOn(state.video, 'addEventListener');
        await import('./video');
        await vi.waitFor(() => {
            expect(videoEvents).toHaveBeenCalledWith('canplaythrough', expect.any(Function));
        });
        transition('pagehide', true);
        state.video.readyState = 4;
        state.video.dispatchEvent(new Event('canplaythrough'));
        await vi.waitFor(() => {
            expect(scene.meshAdded).toHaveBeenCalledOnce();
        });
        expect(state.video.play).not.toHaveBeenCalled();
        transition('pageshow', true);
        await vi.waitFor(() => {
            expect(state.clickListeners).toHaveBeenCalledTimes(1);
        });
        expect(state.clickListeners.mock.calls[0]?.[0]).toBe('click');
        transition('pageshow', true);
        await vi.waitFor(() => {
            expect(state.video.play).toHaveBeenCalledTimes(2);
        });
        expect(state.clickListeners).toHaveBeenCalledOnce();
        state.video.play.mockResolvedValue(undefined);
        state.body.dispatchEvent(new Event('click'));
        await vi.waitFor(() => {
            expect(state.video.play).toHaveBeenCalledTimes(3);
        });
        state.body.dispatchEvent(new Event('click'));
        expect(state.video.play).toHaveBeenCalledTimes(3);
    });

    it('does not create a URL or mesh when the response finishes after disposal', async () => {
        const state = fixture();
        const response = deferred<Response>();
        state.fetch.mockReturnValue(response.promise);
        await import('./video');
        expect(state.fetch).toHaveBeenCalledOnce();
        transition('pagehide', false);
        const blob = vi.fn(() => Promise.resolve(new Blob(['late video'])));
        const lateResponse = new Response(null, { status: 200 });
        vi.spyOn(lateResponse, 'blob').mockImplementation(blob);
        response.resolve(lateResponse);
        await vi.waitFor(() => {
            expect(blob).toHaveBeenCalledOnce();
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(state.url).not.toHaveBeenCalled();
        expect(scene.meshAdded).not.toHaveBeenCalled();
        expect(state.video.play).not.toHaveBeenCalled();
    });
});
