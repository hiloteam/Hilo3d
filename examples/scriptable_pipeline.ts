import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import {
    createScriptablePipelineEffects,
    type ScriptablePipelineView
} from './shared/scriptablePipelineEffects';
import { createScriptablePipelineScene } from './shared/scriptablePipelineScene';

interface ChromaticSnapshot {
    readonly ready: true;
    readonly enabled: boolean;
    readonly mode: ScriptablePipelineView;
    readonly split: boolean;
    readonly motion: boolean;
    readonly bloom: number;
    readonly dispersion: number;
    readonly contours: number;
    readonly exposure: number;
    readonly passCount: number;
    readonly frameCount: number;
    readonly width: number;
    readonly height: number;
}

function element<T extends HTMLElement>(selector: string, kind: new () => T): T {
    const result = document.querySelector(selector);
    if (!(result instanceof kind)) throw new Error(`CHROMATIC is missing ${selector}`);
    return result;
}

const viewDescriptions: Readonly<Record<ScriptablePipelineView, string>> = {
    beauty: '光晕、色散与色调的最终合成',
    bloom: '半分辨率高光，经横向与纵向扩散',
    depth: '场景深度 · 由近至远的空间层次',
    contours: '从深度变化中提取雕塑与建筑轮廓'
};
const query = new URLSearchParams(location.search);
const testMode = query.get('test') === '1';
const lifetime = new AbortController();
let stopScene: (() => void) | undefined;

async function run(): Promise<void> {
    const effects = createScriptablePipelineEffects();
    const { settings, diagnostics } = effects;
    settings.bloom = 0.72;
    settings.dispersion = 0.24;
    settings.contours = 0;
    settings.exposure = 0;
    const context = await createExampleContext({
        autoStart: false,
        camera: { fov: 39, near: 0.1, far: 70 },
        controls: {
            enablePan: false,
            minDistance: 8,
            maxDistance: 25,
            minPolarAngle: 0.6,
            maxPolarAngle: 1.48,
            rotateSpeed: 0.6,
            zoomSpeed: 0.75
        },
        stage: {
            pixelRatio: Math.min(devicePixelRatio, 1.5),
            antialias: true,
            useLogDepth: false,
            clearColor: new Hilo3d.Color(0.009, 0.024, 0.028),
            renderPipeline: new Hilo3d.ForwardRenderPipelineFactory({
                sceneColorFormat: 'rgba16float',
                features: [effects.feature]
            })
        }
    });
    stopScene = (): void => {
        context.dispose();
    };
    context.stats.stop();
    context.stats.container.remove();
    context.stage.removeChild(context.directionLight);
    context.stage.removeChild(context.ambientLight);
    const scene = await createScriptablePipelineScene(context.stage);
    stopScene = (): void => {
        context.ticker.stop();
        scene.dispose();
        context.dispose();
    };
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let motion = query.get('motion') !== '0' && !reducedMotion.matches;
    let elapsed = 0;
    let frameInterval = 0;
    let frameSamples = 0;
    let displayElapsed = 0;
    const backendLabel = element('#backendLabel', HTMLElement);
    const frameTime = element('#frameTime', HTMLElement);
    const passCount = element('#passCount', HTMLElement);
    const renderSize = element('#renderSize', HTMLElement);
    const motionToggle = element('#motionToggle', HTMLButtonElement);
    const compareToggle = element('#compareToggle', HTMLButtonElement);
    const pipelineToggle = element('#pipelineToggle', HTMLButtonElement);
    const splitOverlay = element('#splitOverlay', HTMLElement);
    const splitOutputLabel = element('.split-labels span:last-child', HTMLElement);
    const pipeline = element('.pipeline', HTMLElement);
    const pipelineState = element('#pipelineState', HTMLElement);
    const viewDescription = element('#viewDescription', HTMLElement);
    backendLabel.textContent = (
        { webgpu: 'WEBGPU', webgl2: 'WEBGL 2' } satisfies Record<Hilo3d.RendererBackend, string>
    )[context.renderer.backend];
    motionToggle.setAttribute('aria-pressed', String(motion));

    const resetView = (): void => {
        const mobile = innerWidth <= 620;
        context.camera.fov = mobile ? 54 : 39;
        context.orbitControls.setView(scene.position, scene.target);
    };
    let wasMobile = innerWidth <= 620;
    resetView();
    window.addEventListener(
        'resize',
        () => {
            const mobile = innerWidth <= 620;
            if (mobile !== wasMobile) resetView();
            wasMobile = mobile;
        },
        { signal: lifetime.signal }
    );

    const syncControls = (): void => {
        pipelineToggle.setAttribute('aria-pressed', String(settings.enabled));
        compareToggle.setAttribute('aria-pressed', String(settings.split));
        motionToggle.setAttribute('aria-pressed', String(motion));
        pipeline.classList.toggle('is-bypassed', !settings.enabled);
        pipelineState.textContent = settings.enabled ? '管线已启用' : '仅显示变换';
        splitOverlay.hidden = !settings.enabled || !settings.split;
        splitOutputLabel.textContent =
            settings.mode === 'beauty' ? 'COMPOSITE' : settings.mode.toUpperCase();
        viewDescription.textContent = settings.enabled
            ? viewDescriptions[settings.mode]
            : '中性色调映射 · 自定义光学效果已旁路';
        for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
            button.setAttribute('aria-pressed', String(button.dataset['view'] === settings.mode));
        }
    };
    const selectView = (view: string | undefined): void => {
        if (view !== 'beauty' && view !== 'bloom' && view !== 'depth' && view !== 'contours')
            return;
        settings.mode = view;
        settings.enabled = true;
        syncControls();
    };
    for (const button of document.querySelectorAll<HTMLButtonElement>(
        '[data-view], [data-preview]'
    )) {
        button.addEventListener(
            'click',
            () => {
                selectView(button.dataset['view'] ?? button.dataset['preview']);
            },
            { signal: lifetime.signal }
        );
    }
    for (const [id, key] of [
        ['bloom', 'bloom'],
        ['dispersion', 'dispersion'],
        ['contour', 'contours'],
        ['exposure', 'exposure']
    ] as const) {
        const input = element(`#${id}Control`, HTMLInputElement);
        const output = element(`#${id}Output`, HTMLOutputElement);
        const update = (): void => {
            const value = Number(input.value) / 100;
            settings[key] = key === 'exposure' ? Math.log2(value) : value;
            output.value = key === 'exposure' ? `${value.toFixed(2)}×` : `${input.value}%`;
            const fill =
                (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
            input.style.setProperty('--range-fill', `${String(fill * 100)}%`);
        };
        input.title = '调节后显示成片；对照模式下作用于右侧';
        input.addEventListener(
            'input',
            () => {
                update();
                // Art controls should always show their composite result, including when the
                // previous selection was a raw diagnostic buffer or the effects were bypassed.
                if (!settings.enabled || settings.mode !== 'beauty') {
                    settings.enabled = true;
                    settings.mode = 'beauty';
                    syncControls();
                }
            },
            { signal: lifetime.signal }
        );
        update();
    }
    pipelineToggle.addEventListener(
        'click',
        () => {
            settings.enabled = !settings.enabled;
            settings.mode = 'beauty';
            settings.split = false;
            syncControls();
        },
        { signal: lifetime.signal }
    );
    compareToggle.addEventListener(
        'click',
        () => {
            settings.enabled = true;
            settings.split = !settings.split;
            syncControls();
        },
        { signal: lifetime.signal }
    );
    motionToggle.addEventListener(
        'click',
        () => {
            motion = !motion;
            syncControls();
        },
        { signal: lifetime.signal }
    );
    element('#resetView', HTMLButtonElement).addEventListener('click', resetView, {
        signal: lifetime.signal
    });
    reducedMotion.addEventListener(
        'change',
        () => {
            if (reducedMotion.matches) motion = false;
            syncControls();
        },
        { signal: lifetime.signal }
    );
    document.addEventListener(
        'visibilitychange',
        () => {
            if (document.hidden) context.ticker.stop();
            else if (!testMode) context.ticker.start();
        },
        { signal: lifetime.signal }
    );
    context.stage.onUpdate = (deltaTime: number): void => {
        if (motion) elapsed += Math.min(deltaTime, 50) / 1000;
        scene.update(elapsed);
        settings.time = elapsed;
        frameInterval += deltaTime;
        frameSamples++;
        displayElapsed += deltaTime;
        if (displayElapsed >= 500) {
            frameTime.textContent = (frameInterval / frameSamples).toFixed(1);
            passCount.textContent = String(diagnostics.passCount);
            renderSize.textContent = `${String(diagnostics.outputWidth)} × ${String(diagnostics.outputHeight)}`;
            frameInterval = 0;
            frameSamples = 0;
            displayElapsed = 0;
        }
    };
    scene.update(0);
    syncControls();
    // Publish only after real scene, shadow and feature work has completed on the selected backend.
    context.stage.tick(0);
    await context.renderer.waitForIdle();
    context.stage.tick(0);
    await context.renderer.waitForIdle();
    window.__HILO3D_SCRIPTABLE_PIPELINE_RESULT__ = {
        backend: context.renderer.backend,
        drawCount: context.renderer.renderInfo.drawCount,
        faceCount: context.renderer.renderInfo.faceCount,
        hasShadowAtlas: context.renderer.lightManager.shadowAtlas !== null
    };
    window.__HILO3D_CHROMATIC__ = {
        snapshot(): ChromaticSnapshot {
            return {
                ready: true,
                enabled: settings.enabled,
                mode: settings.mode,
                split: settings.split,
                motion,
                bloom: settings.bloom,
                dispersion: settings.dispersion,
                contours: settings.contours,
                exposure: 2 ** settings.exposure,
                passCount: diagnostics.passCount,
                frameCount: diagnostics.frameCount,
                width: diagnostics.outputWidth,
                height: diagnostics.outputHeight
            };
        }
    };
    element('#controlsFieldset', HTMLFieldSetElement).disabled = false;
    element('#loadingPanel', HTMLElement).hidden = true;
    if (testMode) {
        let advancing = false;
        window.__HILO3D_CHROMATIC_TEST__ = {
            async advanceFrames(count: number): Promise<void> {
                if (!Number.isInteger(count) || count < 1 || count > 60 || advancing) {
                    throw new Error(
                        'Chromatic test frames require a serial count between 1 and 60'
                    );
                }
                advancing = true;
                try {
                    // Resize events are dispatched during the browser's rendering update,
                    // before RAF callbacks. Drain that boundary before recording scene frames.
                    await new Promise<void>(resolve => {
                        requestAnimationFrame(() => {
                            resolve();
                        });
                    });
                    for (let frame = 0; frame < count; frame++) {
                        context.stage.tick(1000 / 60);
                        await context.renderer.waitForIdle();
                    }
                } finally {
                    advancing = false;
                }
            }
        };
    } else {
        context.ticker.start();
    }
}

window.addEventListener(
    'pagehide',
    () => {
        lifetime.abort();
        delete window.__HILO3D_CHROMATIC_TEST__;
        stopScene?.();
    },
    { once: true }
);

void run().catch((error: unknown) => {
    lifetime.abort();
    stopScene?.();
    element('#loadingTitle', HTMLElement).textContent = '展馆暂时无法开启';
    element('#loadingDetail', HTMLElement).textContent =
        error instanceof Error ? error.message : String(error);
    console.error(error);
});

declare global {
    interface Window {
        __HILO3D_CHROMATIC_TEST__?: {
            advanceFrames(count: number): Promise<void>;
        };
        __HILO3D_SCRIPTABLE_PIPELINE_RESULT__?: {
            readonly backend: Hilo3d.RendererBackend;
            readonly drawCount: number;
            readonly faceCount: number;
            readonly hasShadowAtlas: boolean;
        };
        __HILO3D_CHROMATIC__?: {
            snapshot(): ChromaticSnapshot;
        };
    }
}
