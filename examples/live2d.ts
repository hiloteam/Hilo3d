import { Color, OrthographicCamera, Stage, Ticker } from '../src/Hilo3d';
import {
    Live2DModel,
    type Live2DBounds,
    type Live2DParameterAccess,
    type Live2DParameterInfo
} from '@hilo/addon-live2d';
import { resolveExampleBackend } from './shared/backend';
import { createTestFrameControl, type TestFrameControl } from './shared/test-frame-control';

function element(selector: string): HTMLElement;
function element<T extends HTMLElement>(selector: string, kind: new () => T): T;
function element(selector: string, kind: typeof HTMLElement = HTMLElement): HTMLElement {
    const value = document.querySelector(selector);
    if (!(value instanceof kind)) throw new Error(`Missing Live2D example element ${selector}.`);
    return value;
}

const character = {
    id: 'miku',
    name: 'Hatsune Miku',
    modelUrl: './models/live2d/Miku/miku_sample_t04.model3.json',
    credit: '初音ミク © Crypton Future Media, INC.',
    noticeUrl: './models/live2d/Miku/README.md'
} as const;
const backend = resolveExampleBackend();
const testing = new URLSearchParams(location.search).get('test') === '1';
const lifetime = { disposed: false, generation: 0 };
const canvas = element('#live2d-canvas', HTMLCanvasElement);
const pane = element('#character-stage');
const camera = new OrthographicCamera({ near: 0.1, far: 10, z: 1 });
const ticker = new Ticker(60);
let stage: Stage | undefined;
let model: Live2DModel | undefined;
let capture: TestFrameControl | undefined;
let observer: ResizeObserver | undefined;
let pendingLoad: AbortController | undefined;
let frames = 0;
let currentMotion = 'Idle';
let currentMotionIndex = 0;
let oneShot = false;
let idleGroup: string | undefined;
let fullBounds: Live2DBounds = { left: -1, right: 1, bottom: -1, top: 1 };
let headBounds = fullBounds;
let view: 'full' | 'head' = 'full';
const motionChoices = new Map<string, { group: string; index: number }>();
const pointer = { x: 0, y: 0, active: false };
const tracking = { eyeX: 0, eyeY: 0, headX: 0, headY: 0, bodyX: 0, bodyY: 0 };

const gesture = element('#motion-group', HTMLSelectElement);
const pause = element('#pause', HTMLInputElement);
const physics = element('#physics', HTMLInputElement);
const follow = element('#follow', HTMLInputElement);
const zoom = element('#zoom', HTMLInputElement);

document.body.dataset['testMode'] = String(testing);
document.body.dataset['backend'] = backend;
document.body.dataset['stageDestroyed'] = 'false';

function updateLinks(): void {
    const current = new URL(location.href);
    current.searchParams.set('model', character.id);
    history.replaceState(null, '', current);
    for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-backend-link]')) {
        const url = new URL(current);
        url.searchParams.set('backend', link.dataset['backendLink'] ?? backend);
        link.href = url.href;
        if (link.dataset['backendLink'] === backend) link.setAttribute('aria-current', 'page');
    }
}

function syncControls(): void {
    document.body.dataset['motion'] = currentMotion;
    document.body.dataset['motionState'] = oneShot ? 'oneshot' : 'loop';
    document.body.dataset['motionIndex'] = String(currentMotionIndex);
    document.body.dataset['paused'] = String(pause.checked);
    document.body.dataset['physics'] = String(physics.checked);
    document.body.dataset['follow'] = String(follow.checked);
    document.body.dataset['view'] = view;
    document.body.dataset['zoom'] = zoom.value;
    element('#motion-label').textContent =
        `${currentMotion} · ${String(currentMotionIndex + 1)}${oneShot ? '' : ' ↻'}`;
    element('#motion-tap').classList.toggle('active', oneShot);
    element('#zoom-value').textContent = `${String(Math.round(Number(zoom.value) * 100))}%`;
    element('#view-full').setAttribute('aria-pressed', String(view === 'full'));
    element('#view-head').setAttribute('aria-pressed', String(view === 'head'));
    element('#live-state').textContent = pause.checked ? 'POSE PAUSED' : 'LIVE ANIMATION';
}

function parameter(name: string): Live2DParameterInfo | undefined {
    const normalized = name.replaceAll('_', '').toLowerCase();
    return model?.parameters.find(
        value => value.id.replaceAll('_', '').toLowerCase() === normalized
    );
}

function resetTracking(): void {
    Object.assign(tracking, { eyeX: 0, eyeY: 0, headX: 0, headY: 0, bodyX: 0, bodyY: 0 });
    pointer.x = pointer.y = 0;
    pointer.active = false;
}

function attachFollow(characterModel: Live2DModel): void {
    const roles = {
        headX: parameter('ParamAngleX'),
        headY: parameter('ParamAngleY'),
        headZ: parameter('ParamAngleZ'),
        bodyX: parameter('ParamBodyAngleX'),
        bodyY: parameter('ParamBodyAngleY'),
        bodyZ: parameter('ParamBodyAngleZ'),
        eyeX: parameter('ParamEyeBallX'),
        eyeY: parameter('ParamEyeBallY')
    };
    const add = (
        parameters: Live2DParameterAccess,
        info: Live2DParameterInfo | undefined,
        value: number,
        gain: number
    ): void => {
        if (info) parameters.add(info.id, ((value * (info.max - info.min)) / 2) * gain);
    };
    characterModel.beforeExpressions = (parameters, delta): void => {
        if (!follow.checked) return;
        const targetX = pointer.active ? pointer.x : 0;
        const targetY = pointer.active ? pointer.y : 0;
        const elapsed = Math.min(delta, 0.1);
        const eyes = 1 - Math.exp(-elapsed * 14);
        const head = 1 - Math.exp(-elapsed * 7);
        const body = 1 - Math.exp(-elapsed * 3.5);
        tracking.eyeX += (targetX - tracking.eyeX) * eyes;
        tracking.eyeY += (targetY - tracking.eyeY) * eyes;
        tracking.headX += (targetX - tracking.headX) * head;
        tracking.headY += (targetY - tracking.headY) * head;
        tracking.bodyX += (targetX - tracking.bodyX) * body;
        tracking.bodyY += (targetY - tracking.bodyY) * body;
        add(parameters, roles.headX, tracking.headX, 0.65);
        add(parameters, roles.headY, tracking.headY, 0.55);
        add(parameters, roles.headZ, -tracking.headX, 0.1);
        add(parameters, roles.bodyX, tracking.bodyX, 0.25);
        add(parameters, roles.bodyY, tracking.bodyY, 0.18);
        add(parameters, roles.bodyZ, -tracking.bodyX, 0.15);
        add(parameters, roles.eyeX, tracking.eyeX, 0.85);
        add(parameters, roles.eyeY, tracking.eyeY, 0.7);
        document.body.dataset['lookX'] = tracking.headX.toFixed(3);
        document.body.dataset['lookY'] = tracking.headY.toFixed(3);
    };
}

function resize(): void {
    if (!stage || lifetime.disposed) return;
    const width = Math.max(1, pane.clientWidth);
    const height = Math.max(1, pane.clientHeight);
    stage.resize(width, height);
    const bounds = view === 'head' ? headBounds : fullBounds;
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.bottom + bounds.top) / 2;
    const padding = view === 'head' ? 0.66 : 0.54;
    const halfHeight =
        Math.max(
            (bounds.top - bounds.bottom) * padding,
            (((bounds.right - bounds.left) * height) / width) * padding
        ) / Number(zoom.value);
    camera.left = centerX - (halfHeight * width) / height;
    camera.right = centerX + (halfHeight * width) / height;
    camera.bottom = centerY - halfHeight;
    camera.top = centerY + halfHeight;
    camera.updateProjectionMatrix();
}

function playIdle(): void {
    if (!model || !idleGroup) return;
    model.playMotion(idleGroup, { index: 0, loop: true, priority: 'force' });
    currentMotion = idleGroup;
    oneShot = false;
    currentMotionIndex = 0;
    syncControls();
}
function playGesture(): void {
    const choice = motionChoices.get(gesture.value);
    if (!model || !choice) return;
    pause.checked = false;
    model.paused = false;
    model.playMotion(choice.group, { index: choice.index, loop: false, priority: 'force' });
    currentMotion = choice.group;
    oneShot = true;
    currentMotionIndex = choice.index;
    syncControls();
}

function setLoading(): void {
    document.body.dataset['exampleReady'] = 'false';
    document.body.dataset['exampleError'] = 'false';
    document.body.dataset['modelRequested'] = character.id;
    element('#loading-text').textContent = `Bringing ${character.name} to life…`;
    document.title = `${character.name} · Hilo3D Live2D`;
    element('.character-panel').setAttribute('aria-label', `${character.name} character stage`);
    element('#model-title').textContent = `Meet ${character.name}`;
    element('#model-intro').textContent = `A moment with ${character.name}.`;
    element('#stage-letter').textContent = 'M';
    element('#model-credit').textContent = character.credit;
    element('#model-license', HTMLAnchorElement).href = character.noticeUrl;
    canvas.setAttribute('aria-label', `${character.name}, an interactive Live2D character`);
    for (const control of document.querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >('.controls button, .controls input, .controls select')) {
        control.disabled = true;
    }
}

function configureModel(loaded: Live2DModel): void {
    model = loaded;
    fullBounds = loaded.getModelBounds();
    const headArea = loaded.settings.hitAreas.find(area => /head|face|頭|顔/iu.test(area.name));
    if (headArea) headBounds = loaded.getModelBounds([headArea.id]);
    else {
        // Models without an authored Head hit area use the upper 25% of their model-local bounds.
        const height = fullBounds.top - fullBounds.bottom;
        const centerX = (fullBounds.left + fullBounds.right) / 2;
        const halfWidth = Math.min((fullBounds.right - fullBounds.left) * 0.2, height * 0.09);
        headBounds = {
            left: centerX - halfWidth,
            right: centerX + halfWidth,
            top: fullBounds.top,
            bottom: fullBounds.top - height * 0.25
        };
    }
    document.body.dataset['headFraming'] = headArea ? 'authored' : 'upper-bounds';
    motionChoices.clear();
    const groups = Object.keys(loaded.settings.motions);
    idleGroup = groups.find(group => group.toLowerCase() === 'idle') ?? groups[0];
    const options: HTMLOptionElement[] = [];
    for (const group of groups) {
        for (const [index] of (loaded.settings.motions[group] ?? []).entries()) {
            const key = `${group}:${String(index)}`;
            motionChoices.set(key, { group, index });
            options.push(new Option(`${group} · ${String(index + 1)}`, key));
        }
    }
    gesture.replaceChildren(...options);
    zoom.value = '1';
    pause.checked = false;
    physics.checked = !!loaded.settings.physicsUrl;
    follow.checked = true;
    loaded.physicsEnabled = physics.checked;
    view = 'full';
    resetTracking();
    attachFollow(loaded);
    resize();
    playIdle();
    document.body.dataset['model'] = character.id;
    document.body.dataset['drawableCount'] = String(loaded.drawableCount);
    document.body.dataset['parameterCount'] = String(loaded.parameters.length);
    syncControls();
}

function currentLoad(generation: number, signal: AbortSignal): boolean {
    return !lifetime.disposed && generation === lifetime.generation && !signal.aborted;
}

async function loadModel(): Promise<void> {
    updateLinks();
    if (!stage || lifetime.disposed) return;
    const targetStage = stage;
    const generation = ++lifetime.generation;
    pendingLoad?.abort();
    const controller = new AbortController();
    pendingLoad = controller;
    setLoading();
    const previous = model;
    model = undefined;
    let candidate: Live2DModel | undefined;
    try {
        previous?.destroy();
        const loaded = await Live2DModel.load(new URL(character.modelUrl, location.href), {
            maskSize: 512,
            signal: controller.signal
        });
        candidate = loaded;
        if (!currentLoad(generation, controller.signal)) {
            loaded.destroy();
            return;
        }
        targetStage.addChild(loaded);
        configureModel(loaded);
        targetStage.tick(0);
        await targetStage.renderer.waitForIdle();
        if (!currentLoad(generation, controller.signal)) return;
        for (const control of document.querySelectorAll<
            HTMLButtonElement | HTMLInputElement | HTMLSelectElement
        >('.controls button, .controls input, .controls select'))
            control.disabled = false;
        gesture.disabled = gesture.options.length === 0;
        element('#motion-tap', HTMLButtonElement).disabled = gesture.options.length === 0;
        physics.disabled = !loaded.settings.physicsUrl;
        element('#model-info').textContent =
            `${backend.toUpperCase()} · ${String(loaded.drawableCount)} drawables`;
        document.body.dataset['exampleReady'] = 'true';
        ticker.start();
    } catch (error: unknown) {
        if (!currentLoad(generation, controller.signal)) return;
        if (model === candidate) model = undefined;
        candidate?.destroy();
        document.body.dataset['exampleError'] = 'true';
        element('#loading-text').textContent =
            error instanceof Error ? error.message : String(error);
        console.error(error);
    } finally {
        if (pendingLoad === controller) pendingLoad = undefined;
    }
}

element('#motion-tap').addEventListener('click', playGesture);
pause.addEventListener('change', () => {
    if (model) model.paused = pause.checked;
    syncControls();
});
physics.addEventListener('change', () => {
    if (model) model.physicsEnabled = physics.checked;
    syncControls();
});
follow.addEventListener('change', () => {
    resetTracking();
    syncControls();
});
zoom.addEventListener('input', () => {
    resize();
    syncControls();
});
for (const target of ['full', 'head'] as const)
    element(`#view-${target}`).addEventListener('click', () => {
        view = target;
        zoom.value = '1';
        resize();
        syncControls();
    });
canvas.addEventListener('pointermove', event => {
    const bounds = canvas.getBoundingClientRect();
    const centerX = (headBounds.left + headBounds.right) / 2;
    const centerY = (headBounds.bottom + headBounds.top) / 2;
    const pixelX =
        bounds.left + ((centerX - camera.left) / (camera.right - camera.left)) * bounds.width;
    const pixelY =
        bounds.top + ((camera.top - centerY) / (camera.top - camera.bottom)) * bounds.height;
    pointer.x = Math.max(-1, Math.min(1, (event.clientX - pixelX) / (bounds.width * 0.42)));
    pointer.y = Math.max(-1, Math.min(1, (pixelY - event.clientY) / (bounds.height * 0.42)));
    pointer.active = true;
});
canvas.addEventListener('pointerleave', () => {
    pointer.active = false;
});
element('#reset').addEventListener('click', () => {
    if (!model) return;
    model.clearParameters();
    model.clearExpression();
    model.paused = false;
    model.physicsEnabled = !!model.settings.physicsUrl;
    model.lipSync = null;
    pause.checked = false;
    physics.checked = model.physicsEnabled;
    zoom.value = '1';
    follow.checked = true;
    view = 'full';
    resetTracking();
    resize();
    playIdle();
});

function dispose(): void {
    if (lifetime.disposed) return;
    lifetime.disposed = true;
    lifetime.generation++;
    pendingLoad?.abort();
    ticker.stop();
    capture?.dispose();
    if (window.__HILO3D_TEST_CAPTURE__ === capture) delete window.__HILO3D_TEST_CAPTURE__;
    observer?.disconnect();
    stage?.destroy();
    model = undefined;
    document.body.dataset['stageDestroyed'] = 'true';
}
window.addEventListener('pagehide', (event: PageTransitionEvent) => {
    ticker.stop();
    if (!event.persisted) dispose();
});
window.addEventListener('pageshow', (event: PageTransitionEvent) => {
    if (event.persisted && !lifetime.disposed && model) ticker.start();
});

async function initialize(): Promise<void> {
    try {
        const created = await Stage.create({
            backend,
            canvas,
            camera,
            width: Math.max(1, pane.clientWidth),
            height: Math.max(1, pane.clientHeight),
            pixelRatio: testing ? 1 : Math.min(devicePixelRatio || 1, 2),
            alpha: true,
            antialias: true,
            clearColor: new Color(0, 0, 0, 0)
        });
        if (lifetime.disposed) {
            created.destroy();
            return;
        }
        stage = created;
        observer = new ResizeObserver(resize);
        observer.observe(pane);
        ticker.addTick({
            tick(): void {
                if (model && !model.isMotionPlaying && !model.paused) playIdle();
            }
        });
        ticker.addTick(created);
        ticker.addTick({
            tick(): void {
                frames++;
                document.body.dataset['frames'] = String(frames);
                const angle = parameter('ParamAngleX');
                if (model && angle)
                    document.body.dataset['evaluatedHeadAngle'] = String(
                        model.getParameter(angle.id)
                    );
            }
        });
        if (testing) {
            capture = createTestFrameControl(ticker, () => created.renderer.waitForIdle());
            window.__HILO3D_TEST_CAPTURE__ = capture;
        }
        await loadModel();
    } catch (error: unknown) {
        const wasDisposed = lifetime.disposed;
        dispose();
        if (!wasDisposed) {
            document.body.dataset['exampleError'] = 'true';
            element('#loading-text').textContent =
                error instanceof Error ? error.message : String(error);
            console.error(error);
        }
    }
}
void initialize();
