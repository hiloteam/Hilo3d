import './style.css';
import packageJson from '../../package.json' with { type: 'json' };
import { importProjectArchive } from '../project-archive';
import { readDeploymentResponse } from '../player-export';
import { validatePlayerManifest, type PlayerManifest } from '../player-manifest';
import type { ProjectDocument } from '../project';
import { EditorViewport } from '../viewport';
import { PlayController } from '../play-controller';
import { ComponentAudioSession } from '../component-runtime';
import { createViewportPlayback, type ViewportPlayback } from '../viewport-playback';

function element(id: string): HTMLElement;
function element<T extends HTMLElement>(id: string, type: new () => T): T;
function element(id: string, type?: new () => HTMLElement): HTMLElement {
    const value = document.getElementById(id);
    if (!value || (type && !(value instanceof type)))
        throw new Error(`Missing Player element: ${id}`);
    return value;
}
const root = element('player');
const host = element('viewport');
const status = element('status');
const error = element('error');
const welcome = element('welcome');
const start = element('start', HTMLButtonElement);
const pause = element('pause', HTMLButtonElement);
const restart = element('restart', HTMLButtonElement);
const scenes = element('scene', HTMLSelectElement);
const loading = new AbortController();
let project: ProjectDocument;
let manifest: PlayerManifest;
let viewport: EditorViewport | undefined;
let playback: ViewportPlayback | undefined;
let controller: PlayController | undefined;
let pendingAudio: ComponentAudioSession | null = null;
let destroyed = false;
let switching = false;
let resumeVisible = false;
let suspended = false;
const keys = new Set<string>();
let pointer = { x: 0, y: 0, buttons: 0 };

function report(cause: unknown): void {
    if (destroyed) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    error.textContent = message;
    error.hidden = false;
    root.dataset['error'] = message;
}
function input(): void {
    controller?.setInput({ keys: [...keys], pointer });
}
function clearInput(): void {
    keys.clear();
    pointer = { ...pointer, buttons: 0 };
    input();
}

async function prepareScene(): Promise<void> {
    const scene = project.scenes[project.activeSceneId];
    if (!viewport || !scene) throw new Error('Player scene is unavailable');
    viewport.setScene(scene);
    await viewport.waitForAssets();
    if (destroyed) throw new DOMException('Player closed', 'AbortError');
    viewport.setCamera(manifest.cameras[project.activeSceneId] ?? null);
    if (!manifest.cameras[project.activeSceneId]) viewport.focus(null);
}

/** Audio is unlocked in the original gesture, before WASM/asset/script initialization awaits. */
function begin(): void {
    try {
        if (
            !controller ||
            switching ||
            destroyed ||
            suspended ||
            document.hidden ||
            controller.state === 'starting' ||
            controller.state === 'playing'
        )
            return;
        error.hidden = true;
        delete root.dataset['error'];
        const scene = project.scenes[project.activeSceneId];
        if (!scene) return;
        const audio = controller.state === 'paused' ? null : ComponentAudioSession.create(scene);
        pendingAudio = audio;
        void (audio?.unlock() ?? playback?.runtime.unlockAudio() ?? Promise.resolve()).catch(
            report
        );
        void controller
            .play()
            .catch(report)
            .finally(() => {
                if (pendingAudio === audio) {
                    pendingAudio = null;
                    void audio?.stop().catch(report);
                }
            });
        host.focus();
    } catch (cause) {
        report(cause);
    }
}

async function changeScene(id: string): Promise<void> {
    if (!controller || !Object.hasOwn(project.scenes, id) || switching) return;
    switching = true;
    start.disabled = true;
    scenes.disabled = true;
    clearInput();
    try {
        await controller.dispose();
        playback = undefined;
        project = { ...project, activeSceneId: id };
        await prepareScene();
        status.textContent = 'Ready. Start to run this scene and enable sound.';
        welcome.hidden = false;
        start.textContent = 'Start experience';
        root.dataset['scene'] = id;
    } finally {
        switching = false;
        scenes.disabled = false;
        start.disabled = destroyed;
    }
}

start.addEventListener('click', begin);
pause.addEventListener('click', () => {
    if (controller?.state === 'playing') controller.pause();
    else begin();
});
restart.addEventListener('click', () => {
    if (switching || destroyed) return;
    try {
        const scene = project.scenes[project.activeSceneId];
        if (!scene) return;
        const audio = ComponentAudioSession.create(scene);
        void audio?.unlock().catch(report);
        void changeScene(project.activeSceneId)
            .then(async () => {
                if (destroyed) return;
                pendingAudio = audio;
                await controller?.play();
            })
            .catch(report)
            .finally(() => {
                if (pendingAudio === audio) pendingAudio = null;
                // Only the new component runtime may retain this session.
                if (!playback || playback.runtime.getDiagnostics().stopped || destroyed)
                    void audio?.stop().catch(report);
            });
    } catch (cause) {
        report(cause);
    }
});
scenes.addEventListener('change', () => {
    void changeScene(scenes.value).catch(report);
});
element('fullscreen').addEventListener('click', () => {
    void (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen()).catch(
        report
    );
});
window.addEventListener('keydown', event => {
    if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLButtonElement
    )
        return;
    keys.add(
        event.code === 'Space'
            ? 'Space'
            : event.key.startsWith('Arrow')
              ? event.key
              : event.key.toLowerCase()
    );
    input();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code))
        event.preventDefault();
});
window.addEventListener('keyup', event => {
    keys.delete(
        event.code === 'Space'
            ? 'Space'
            : event.key.startsWith('Arrow')
              ? event.key
              : event.key.toLowerCase()
    );
    input();
});
host.addEventListener('pointermove', event => {
    const bounds = host.getBoundingClientRect();
    pointer = {
        x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1,
        y: 1 - ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * 2,
        buttons: event.buttons
    };
    input();
});
host.addEventListener('pointerdown', event => {
    pointer.buttons = event.buttons;
    input();
    host.focus();
});
window.addEventListener('pointerup', event => {
    pointer.buttons = event.buttons;
    input();
});
window.addEventListener('pointercancel', clearInput);
window.addEventListener('blur', clearInput);

function suspend(): void {
    suspended = true;
    resumeVisible ||= controller?.state === 'playing' || controller?.state === 'starting';
    clearInput();
    controller?.pause();
    viewport?.stopRendering();
}
function resume(): void {
    if (destroyed || document.hidden) return;
    suspended = false;
    viewport?.startRendering();
    if (resumeVisible && (controller?.state === 'paused' || controller?.state === 'starting'))
        void controller.play().catch(report);
    resumeVisible = false;
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend();
    else resume();
});
window.addEventListener('pagehide', event => {
    suspend();
    if (event.persisted) return;
    destroyed = true;
    loading.abort();
    const current = viewport;
    void Promise.all([controller?.dispose(), pendingAudio?.stop()])
        .finally(() => current?.destroy())
        .catch(() => undefined);
});
window.addEventListener('pageshow', event => {
    if (event.persisted) resume();
});

async function boot(): Promise<void> {
    if (location.protocol === 'file:')
        throw new Error('Serve this folder over HTTP or HTTPS to open the experience.');
    const [settingsData, projectData] = await Promise.all([
        fetch(new URL('./player.json', document.baseURI), { signal: loading.signal }).then(
            response => readDeploymentResponse(response, 128 * 1024, loading.signal)
        ),
        fetch(new URL('./project.zip', document.baseURI), { signal: loading.signal }).then(
            response => readDeploymentResponse(response, 128 * 1024 * 1024, loading.signal)
        )
    ]);
    project = await importProjectArchive(new Blob([projectData]));
    manifest = validatePlayerManifest(
        JSON.parse(new TextDecoder().decode(settingsData)) as unknown,
        project
    );
    if (manifest.engineVersion !== packageJson.version)
        throw new Error(
            'This project requires a different Player runtime version. Re-export it from Studio.'
        );
    project = { ...project, activeSceneId: manifest.startSceneId };
    loading.signal.throwIfAborted();
    document.title = manifest.title;
    element('title').textContent = manifest.title;
    element('welcome-title').textContent = manifest.title;
    scenes.replaceChildren(
        ...Object.entries(project.scenes).map(([id, scene]) => new Option(scene.name, id))
    );
    scenes.value = project.activeSceneId;
    const backend = new URL(location.href).searchParams.get('backend') ?? 'auto';
    if (backend !== 'auto' && backend !== 'webgl2' && backend !== 'webgpu')
        throw new Error('Unknown rendering backend');
    viewport = await EditorViewport.create(host, () => undefined, report, undefined, {
        mode: 'player',
        backend,
        managePageLifecycle: false,
        autoStart: false
    });
    if (destroyed) {
        viewport.destroy();
        return;
    }
    await viewport.setAssets(project.assets);
    await prepareScene();
    if (!document.hidden && !suspended) viewport.startRendering();
    controller = new PlayController({
        getProject: () => project,
        getClipId: () => manifest.clips[project.activeSceneId] ?? null,
        beforeStart: async signal => {
            await prepareScene();
            signal.throwIfAborted();
        },
        createComponents: async (scene, source, signal) => {
            if (!viewport) throw new Error('Player renderer is missing');
            const audio = pendingAudio;
            pendingAudio = null;
            playback = await createViewportPlayback(viewport, scene, source, signal, audio);
            return playback;
        },
        onTransforms: transforms => viewport?.applyTransforms(transforms),
        onRestore: () => {
            const scene = project.scenes[project.activeSceneId];
            if (!destroyed && scene) {
                viewport?.setScene(scene);
                viewport?.setCamera(manifest.cameras[project.activeSceneId] ?? null);
            }
        },
        onState: (state, time) => {
            if (state === 'starting' && (suspended || document.hidden)) controller?.pause();
            root.dataset['state'] = state;
            root.dataset['time'] = time.toFixed(4);
            start.disabled = state === 'starting';
            pause.disabled = state !== 'playing' && state !== 'paused';
            pause.textContent = state === 'paused' ? 'Resume' : 'Pause';
            restart.disabled = state === 'starting';
            scenes.disabled = state === 'starting';
            welcome.hidden = state === 'playing' || state === 'paused';
            element('toolbar').hidden = !manifest.showControls && welcome.hidden;
            if (state === 'starting') status.textContent = 'Starting scripts, physics and effects…';
            if (state === 'stopped') status.textContent = 'Ready to start.';
        },
        onLog: message => {
            root.dataset['lastLog'] = message.slice(0, 1000);
        },
        onError: report
    });
    element('backend').textContent = viewport.backend.toUpperCase();
    start.disabled = false;
    restart.disabled = false;
    status.textContent = 'Start to explore this scene and enable sound.';
    root.dataset['ready'] = 'true';
    root.dataset['state'] = 'stopped';
    root.dataset['scene'] = project.activeSceneId;
    if (new URL(location.href).searchParams.get('test') === '1') {
        Reflect.set(window, '__HILO_PLAYER_TEST__', {
            step: async () => {
                await controller?.step();
            },
            snapshot: () => ({
                state: controller?.state,
                time: controller?.elapsedTime,
                components: playback?.runtime.getDiagnostics(),
                transforms: Object.fromEntries(
                    Object.keys(project.scenes[project.activeSceneId]?.nodes ?? {}).map(id => {
                        const node = viewport?.getRuntimeNode(id);
                        return [id, node ? { x: node.x, y: node.y, z: node.z } : null];
                    })
                )
            })
        });
    }
}
void boot().catch(async (cause: unknown) => {
    viewport?.stopRendering();
    await controller?.dispose();
    await pendingAudio?.stop();
    viewport?.destroy();
    if (!destroyed) {
        status.textContent = 'The experience could not be opened.';
        report(cause);
    }
});
