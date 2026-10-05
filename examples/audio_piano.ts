import * as H from '../src/Hilo3d';
import type { AudioVoice } from '@hilo/addon-audio';
import { resolveExampleBackend } from './shared/backend';
import { createTestFrameControl } from './shared/test-frame-control';
import { PianoAudio } from './shared/pianoAudio';
import { parsePianoMidi } from './shared/pianoMidi';
import { createPianoScene, isWhiteNote, noteName, pianoNotes } from './shared/pianoScene';
import {
    CALL_OF_SILENCE_BPM,
    CALL_OF_SILENCE_MEASURES,
    CALL_OF_SILENCE_TITLE,
    createCallOfSilenceScore
} from './audio/callOfSilence';

function element(id: string): HTMLElement {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Piano requires #${id}`);
    return value;
}
const audio = new PianoAudio();
const enable = element('enableAudio') as HTMLButtonElement;
const demo = element('demoToggle') as HTMLButtonElement;
const sustainButton = element('sustainToggle') as HTMLButtonElement;
const effectsButton = element('effectsToggle') as HTMLButtonElement;
const status = element('audioState');
const errorPanel = element('error');
const keyboard = element('keyboard');
const volumeInput = element('volumeControl') as HTMLInputElement;
const reverbInput = element('reverbControl') as HTMLInputElement;
const events = new AbortController();
const testMode = new URLSearchParams(location.search).get('test') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const held = new Map<string, { midi: number; voice: AudioVoice | null }>();
const visualUntil = new Map<number, number>();
const buttons = new Map<number, HTMLButtonElement>();
let disposed = false,
    suspended = false,
    initialized = false,
    effects = true,
    sustain = false,
    pedalHeld = false;
let noteCount = 0,
    volume = 0.65,
    reverb = 0.48,
    elapsed = 0;
let stage: H.Stage | undefined;
let ticker: H.Ticker | undefined;
let controls: H.OrbitControls | undefined;
let capture: ReturnType<typeof createTestFrameControl> | undefined;
let scene: Awaited<ReturnType<typeof createPianoScene>> | undefined;
let lifecycle = Promise.resolve();
let lifecycleRevision = 0;
let midiSelectionRevision = 0;
let displayedDemoPlaying = false;
let displayedAudioRunning = false;
function isDisposed(): boolean {
    return disposed;
}
const keyMap: Readonly<Record<string, number>> = {
    a: 60,
    w: 61,
    s: 62,
    e: 63,
    d: 64,
    f: 65,
    t: 66,
    g: 67,
    y: 68,
    h: 69,
    u: 70,
    j: 71,
    k: 72,
    o: 73,
    l: 74,
    p: 75,
    ';': 76
};
const labels = new Map(Object.entries(keyMap).map(([key, midi]) => [midi, key.toUpperCase()]));

function showError(error: unknown): void {
    if (isDisposed()) return;
    errorPanel.textContent = error instanceof Error ? error.message : String(error);
}
function syncState(): void {
    document.body.dataset['audioState'] = audio.state;
    const audioRunning = audio.state === 'running';
    if (displayedAudioRunning !== audioRunning) {
        displayedAudioRunning = audioRunning;
        enable.dataset['enabled'] = String(audioRunning);
        enable.innerHTML = audioRunning
            ? '<span aria-hidden="true">♪</span> 声音已开启 <span aria-hidden="true">✓</span>'
            : '<span aria-hidden="true">♪</span> 开启声音 <span aria-hidden="true">↗</span>';
    }
    document.body.dataset['performance'] =
        held.size > 0 || visualUntil.size > 0 ? 'playing' : 'idle';
    document.body.dataset['notes'] = String(noteCount);
    document.body.dataset['effects'] = effects ? 'on' : 'off';
    element('noteCount').textContent = String(noteCount);
    element('voiceCount').textContent = String(audio.diagnostics?.realVoices ?? 0);
    if (displayedDemoPlaying !== audio.demoPlaying) {
        displayedDemoPlaying = audio.demoPlaying;
        demo.setAttribute('aria-pressed', String(displayedDemoPlaying));
        demo.innerHTML = displayedDemoPlaying
            ? '<span aria-hidden="true">Ⅱ</span> 暂停演奏'
            : '<span aria-hidden="true">▷</span> 自动演奏';
        if (!displayedDemoPlaying && !disposed && !suspended)
            status.textContent = '演奏已停止 · 可重新播放或自由弹奏';
    }
}
Object.defineProperty(window, '__PIANO_STATE__', {
    get: () => ({
        audioState: audio.state,
        noteCount,
        activeVoices: audio.diagnostics?.realVoices ?? 0,
        demoPlaying: audio.demoPlaying,
        sustain: sustain || pedalHeld,
        effects,
        volume,
        reverb,
        disposed
    })
});
function visualMidi(midi: number): number {
    while (midi < 48) midi += 12;
    while (midi > 84) midi -= 12;
    return midi;
}
function flash(midi: number, velocity: number, duration = 0): void {
    const displayMidi = visualMidi(midi);
    scene?.press(displayMidi, velocity);
    buttons.get(displayMidi)?.setAttribute('data-active', 'true');
    if (duration > 0)
        visualUntil.set(
            displayMidi,
            Math.max(visualUntil.get(displayMidi) ?? 0, audio.currentTime + duration)
        );
    element('lastNote').textContent = noteName(midi);
    noteCount++;
    syncState();
}
function releaseVisual(midi: number): void {
    if ([...held.values()].some(note => note.midi === midi)) return;
    if ((visualUntil.get(midi) ?? 0) > audio.currentTime) return;
    buttons.get(midi)?.setAttribute('data-active', 'false');
    scene?.release(midi);
}
function noteOn(id: string, midi: number, velocity = 0.76): void {
    if (disposed || suspended || held.has(id) || audio.state !== 'running') return;
    const voice = audio.noteOn(midi, velocity);
    held.set(id, { midi, voice });
    flash(midi, velocity);
}
function noteOff(id: string): void {
    const note = held.get(id);
    if (!note) return;
    held.delete(id);
    audio.noteOff(note.voice);
    releaseVisual(note.midi);
    syncState();
}
function releaseAll(): void {
    for (const id of held.keys()) noteOff(id);
    for (const midi of visualUntil.keys()) {
        visualUntil.delete(midi);
        releaseVisual(midi);
    }
    pedalHeld = false;
    audio.setSustain(sustain);
}
function syncSustain(): void {
    audio.setSustain(sustain || pedalHeld);
    sustainButton.setAttribute('aria-pressed', String(sustain || pedalHeld));
}
let whiteIndex = 0;
for (const midi of pianoNotes) {
    const white = isWhiteNote(midi);
    const key = document.createElement('button');
    key.type = 'button';
    key.className = `piano-key${white ? '' : ' black'}`;
    key.dataset['midi'] = String(midi);
    key.dataset['active'] = 'false';
    key.setAttribute('aria-label', noteName(midi));
    if (!white) key.style.left = `calc(${String((whiteIndex / 22) * 100)}% - 1.45%)`;
    else whiteIndex++;
    key.innerHTML = `${midi % 12 === 0 ? `<small>${noteName(midi)}</small>` : ''}<span class="key-label">${labels.get(midi) ?? ''}</span>`;
    key.addEventListener(
        'pointerdown',
        event => {
            if (event.button !== 0) return;
            event.preventDefault();
            key.setPointerCapture(event.pointerId);
            noteOn(
                `pointer:${String(event.pointerId)}`,
                midi,
                event.pointerType === 'touch' ? 0.82 : 0.76
            );
        },
        { signal: events.signal }
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        key.addEventListener(
            type,
            event => {
                if (event instanceof PointerEvent) noteOff(`pointer:${String(event.pointerId)}`);
            },
            { signal: events.signal }
        );
    key.addEventListener(
        'keydown',
        event => {
            if (event.key === 'Enter' && !event.repeat) {
                event.preventDefault();
                noteOn(`button:${String(midi)}`, midi);
            }
        },
        { signal: events.signal }
    );
    key.addEventListener(
        'keyup',
        event => {
            if (event.key === 'Enter') noteOff(`button:${String(midi)}`);
        },
        { signal: events.signal }
    );
    key.addEventListener(
        'blur',
        () => {
            noteOff(`button:${String(midi)}`);
        },
        { signal: events.signal }
    );
    keyboard.append(key);
    buttons.set(midi, key);
}
enable.addEventListener(
    'click',
    () => {
        errorPanel.textContent = '';
        void audio
            .resume()
            .then(() => {
                if (isDisposed() || suspended) return;
                status.textContent = '声音已开启 · 试着弹下第一个音符';
                syncState();
            })
            .catch(showError);
    },
    { signal: events.signal }
);
demo.addEventListener(
    'click',
    () => {
        if (audio.demoPlaying) {
            audio.stopDemo();
            releaseAll();
            syncState();
            return;
        }
        void audio
            .resume()
            .then(() => {
                if (disposed || suspended) return;
                audio.startDemo((midi, velocity, duration) => {
                    flash(midi, velocity, duration);
                });
                status.textContent = '自动演奏中 · 你也可以一起弹';
                syncState();
            })
            .catch(showError);
    },
    { signal: events.signal }
);
sustainButton.addEventListener(
    'click',
    () => {
        sustain = !sustain;
        syncSustain();
    },
    { signal: events.signal }
);
effectsButton.addEventListener(
    'click',
    () => {
        effects = !effects;
        scene?.setEffects(effects);
        effectsButton.setAttribute('aria-pressed', String(effects));
        syncState();
    },
    { signal: events.signal }
);
volumeInput.addEventListener(
    'input',
    () => {
        volume = Number(volumeInput.value) / 100;
        audio.setVolume(volume);
        element('volumeOutput').textContent = `${volumeInput.value}%`;
    },
    { signal: events.signal }
);
reverbInput.addEventListener(
    'input',
    () => {
        reverb = Number(reverbInput.value) / 100;
        audio.setReverb(reverb);
        element('reverbOutput').textContent = `${reverbInput.value}%`;
    },
    { signal: events.signal }
);
window.addEventListener(
    'keydown',
    event => {
        if (
            event.repeat ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.target instanceof HTMLInputElement
        )
            return;
        if (event.code === 'Space') {
            event.preventDefault();
            pedalHeld = true;
            syncSustain();
            return;
        }
        const midi = keyMap[event.key.toLowerCase()];
        if (midi !== undefined) {
            event.preventDefault();
            noteOn(`key:${event.code}`, midi);
        }
    },
    { signal: events.signal }
);
window.addEventListener(
    'keyup',
    event => {
        if (event.code === 'Space') {
            pedalHeld = false;
            syncSustain();
        }
        noteOff(`key:${event.code}`);
    },
    { signal: events.signal }
);
window.addEventListener(
    'blur',
    () => {
        releaseAll();
        syncSustain();
    },
    { signal: events.signal }
);

function resetView(): void {
    if (!stage || !controls) return;
    const mobile = innerWidth < 760;
    controls.setView(
        new H.Vector3(mobile ? 9 : 7.6, mobile ? 8.5 : 6.4, mobile ? 19.8 : 13.8),
        new H.Vector3(mobile ? 0.7 : -0.65, mobile ? 3.8 : 2.8, -0.4)
    );
}
element('resetView').addEventListener('click', resetView, { signal: events.signal });
const settingsToggle = element('settingsToggle');
const soundPanel = element('soundPanel');
function setSettingsOpen(open: boolean): void {
    soundPanel.hidden = !open;
    settingsToggle.setAttribute('aria-expanded', String(open));
}
settingsToggle.addEventListener(
    'click',
    () => {
        setSettingsOpen(soundPanel.hidden === true);
    },
    { signal: events.signal }
);
window.addEventListener(
    'keydown',
    event => {
        if (event.key === 'Escape' && !soundPanel.hidden) {
            setSettingsOpen(false);
            settingsToggle.focus();
        }
    },
    { signal: events.signal }
);

function dispose(): void {
    if (isDisposed()) return;
    disposed = true;
    lifecycleRevision++;
    midiSelectionRevision++;
    events.abort();
    ticker?.stop();
    capture?.dispose();
    controls?.dispose();
    if (window.__HILO3D_TEST_CAPTURE__ === capture) delete window.__HILO3D_TEST_CAPTURE__;
    audio.destroy();
    scene?.dispose();
    stage?.destroy();
    held.clear();
    visualUntil.clear();
    document.body.dataset['runtime'] = 'destroyed';
    syncState();
    void audio.whenClosed().catch((error: unknown) => {
        console.error(error);
    });
}
window.addEventListener(
    'pagehide',
    event => {
        lifecycleRevision++;
        suspended = true;
        // A pending test capture fence can call resume(), which must not restart a hidden loop.
        ticker?.stop();
        releaseAll();
        if (event.persisted) {
            document.body.dataset['runtime'] = 'suspended';
            lifecycle = lifecycle
                .then(async () => {
                    if (!isDisposed()) await audio.suspend();
                })
                .then(syncState)
                .catch(showError);
        } else dispose();
    },
    { signal: events.signal }
);
window.addEventListener(
    'pageshow',
    event => {
        if (!event.persisted || disposed) return;
        const revision = ++lifecycleRevision;
        lifecycle = lifecycle.then(async () => {
            if (isDisposed() || revision !== lifecycleRevision) return;
            if (audio.state !== 'idle') {
                try {
                    await audio.resume();
                } catch (error) {
                    status.textContent = '点击开启声音以继续';
                    showError(error);
                }
            }
            if (isDisposed() || revision !== lifecycleRevision) return;
            suspended = false;
            if (initialized) ticker?.start();
            document.body.dataset['runtime'] = initialized ? 'ready' : 'loading';
            syncState();
        });
    },
    { signal: events.signal }
);

async function initialize(): Promise<void> {
    // Select the local transcription before asynchronous scene loading. A later MIDI import can
    // replace it while assets load; selecting a score neither creates nor starts audio playback.
    audio.loadScore(createCallOfSilenceScore());
    element('pieceTitle').textContent = CALL_OF_SILENCE_TITLE;
    element('pieceDetail').textContent =
        `钢琴独奏 · ${String(CALL_OF_SILENCE_MEASURES)} 小节 · ${String(CALL_OF_SILENCE_BPM)} BPM`;
    const camera = new H.PerspectiveCamera({
        near: 0.1,
        far: 180,
        fov: innerWidth < 760 ? 49 : 42,
        aspect: innerWidth / innerHeight
    });
    stage = await H.Stage.create({
        container: element('container'),
        camera,
        backend: resolveExampleBackend(),
        width: innerWidth,
        height: innerHeight,
        // Supersampling keeps fine strings and polished edges smooth on standard-density screens.
        pixelRatio:
            testMode && new URLSearchParams(location.search).get('quality') !== 'production'
                ? 0.65
                : 1.5,
        antialias: true,
        clearColor: new H.Color(0.0001, 0.00015, 0.0004),
        renderPipeline: new H.PostProcessRenderPipelineFactory({
            bloom: { intensity: 0.36, threshold: 0.72 },
            colorUber: {
                exposure: -0.25,
                toneMapping: 'aces',
                vignetteIntensity: 0.28,
                vignetteSmoothness: 0.7
            },
            opaqueTexture: false
        })
    });
    if (isDisposed()) {
        stage.destroy();
        return;
    }
    new H.AmbientLight({ color: new H.Color(0.34, 0.43, 0.85), amount: 0.025 }).addTo(stage);
    new H.DirectionalLight({
        color: new H.Color(0.72, 0.84, 1),
        amount: 0.32,
        direction: new H.Vector3(-0.65, -0.8, 0.7)
    }).addTo(stage);
    new H.DirectionalLight({
        color: new H.Color(0.2, 0.39, 1),
        amount: 0.12,
        direction: new H.Vector3(0.7, -0.4, 0.5)
    }).addTo(stage);
    scene = await createPianoScene(stage, camera, events.signal);
    if (isDisposed()) return;
    scene.setEffects(effects);
    controls = new H.OrbitControls(stage, {
        enablePan: false,
        minDistance: 10,
        maxDistance: 29,
        minPolarAngle: 0.6,
        maxPolarAngle: 1.52,
        rotateSpeed: 0.65
    });
    resetView();
    const canvas = stage.canvas;
    canvas.addEventListener(
        'pointerdown',
        event => {
            const midi = scene?.pick(event.clientX, event.clientY);
            if (midi !== null && midi !== undefined && audio.state === 'running') {
                controls?.disable();
                canvas.setPointerCapture(event.pointerId);
                noteOn(`scene:${String(event.pointerId)}`, midi);
            }
        },
        { signal: events.signal }
    );
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
        canvas.addEventListener(
            type,
            event => {
                if (event instanceof PointerEvent) noteOff(`scene:${String(event.pointerId)}`);
                controls?.enable();
            },
            { signal: events.signal }
        );
    ticker = new H.Ticker(60);
    ticker.addTick({
        tick(dt: number): void {
            if (disposed || suspended) return;
            const seconds = Math.min(dt / 1000, 0.05);
            elapsed += seconds;
            audio.update();
            for (const [midi, deadline] of visualUntil)
                if (audio.currentTime >= deadline) {
                    visualUntil.delete(midi);
                    releaseVisual(midi);
                }
            scene?.update(reducedMotion ? 0 : elapsed, seconds);
            syncState();
        }
    });
    ticker.addTick(stage);
    if (testMode) {
        capture = createTestFrameControl(
            ticker,
            () => stage?.renderer.waitForIdle() ?? Promise.resolve()
        );
        window.__HILO3D_TEST_CAPTURE__ = capture;
    }
    window.addEventListener(
        'resize',
        () => {
            camera.aspect = innerWidth / innerHeight;
            camera.fov = innerWidth < 760 ? 49 : 42;
            stage?.resize(innerWidth, innerHeight);
        },
        { signal: events.signal }
    );
    audio.setVolume(volume);
    audio.setReverb(reverb);
    enable.disabled = false;
    demo.disabled = false;
    element('backendLabel').textContent = stage.renderer.backend.toUpperCase();
    status.textContent = '点击开启声音';
    initialized = true;
    document.body.dataset['runtime'] = suspended ? 'suspended' : 'ready';
    syncState();
    if (!suspended) ticker.start();
}

const midiInput = element('midiFile') as HTMLInputElement;
element('importMidi').addEventListener(
    'click',
    () => {
        midiInput.click();
    },
    { signal: events.signal }
);
midiInput.addEventListener(
    'change',
    () => {
        const revision = ++midiSelectionRevision;
        const file = midiInput.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            showError('请选择小于 2 MB 的 MIDI 文件');
            return;
        }
        void file
            .arrayBuffer()
            .then(buffer => {
                if (isDisposed() || revision !== midiSelectionRevision) return;
                const score = parsePianoMidi(buffer);
                audio.loadScore(score);
                releaseAll();
                element('pieceTitle').textContent = file.name.replace(/\.midi?$/iu, '');
                element('pieceDetail').textContent =
                    `本地曲谱 · ${String(score.notes.length)} NOTES · ${String(Math.round(score.duration))}s`;
                status.textContent = '曲谱已就绪 · 点击自动演奏';
                errorPanel.textContent = '';
                syncState();
            })
            .catch((error: unknown) => {
                if (revision === midiSelectionRevision) showError(error);
            });
    },
    { signal: events.signal }
);
void initialize().catch((error: unknown) => {
    if (isDisposed()) return;
    showError(error);
    dispose();
    document.body.dataset['runtime'] = 'error';
});
