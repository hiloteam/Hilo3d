import * as Hilo3d from '../../src/Hilo3d';
import type { PerspectiveCameraParameters } from '../../src/camera/PerspectiveCamera';
import Stats from './stats';
import { resolveExampleBackend } from './backend';
import { loadDefaultEnvironmentMaps, loadDefaultSkyboxMap } from './defaultEnvironment';
import { createExampleLights, createExampleRenderPipeline } from './lighting';
import { createTestFrameControl, type TestFrameControl } from './test-frame-control';
import { ExampleTicker } from './ExampleTicker';
import { installPageLifecycle, type ExamplePageLifecycle } from './pageLifecycle';

export { resolveExampleBackend };

export type QueryValues = Readonly<Record<string, string>>;

export interface EnvironmentMaps {
    diffuseEnvMap: Hilo3d.CubeTexture;
    specularEnvMap: Hilo3d.CubeTexture;
    skyboxMap: Hilo3d.CubeTexture;
    brdfLUT: Hilo3d.Texture;
}

export interface ExampleContextOptions<
    Backend extends Hilo3d.RendererBackend = Hilo3d.RendererBackend
> {
    container?: HTMLElement;
    camera?: PerspectiveCameraParameters;
    backend?: Backend;
    stage?: Omit<Hilo3d.StageParameters<Backend>, 'backend' | 'camera' | 'container'>;
    controls?: Hilo3d.OrbitControlsOptions;
    autoStart?: boolean;
}

export interface ExampleContext<Backend extends Hilo3d.RendererBackend = Hilo3d.RendererBackend> {
    readonly camera: Hilo3d.PerspectiveCamera;
    readonly stage: Hilo3d.Stage<Backend>;
    readonly renderer: Hilo3d.Renderer<Backend>;
    readonly directionLight: Hilo3d.DirectionalLight;
    readonly ambientLight: Hilo3d.AmbientLight;
    readonly ticker: Hilo3d.Ticker;
    readonly stats: Stats;
    readonly orbitControls: Hilo3d.OrbitControls;
    readonly lifecycle: ExamplePageLifecycle;
    readonly onDispose: (cleanup: () => void) => void;
    readonly dispose: () => void;
}

export function parseQuery(url: string | URL = location.href): QueryValues {
    return Object.freeze(Object.fromEntries(new URL(url, location.href).searchParams));
}

export function buildUrl(
    url: string | URL = location.href,
    params: Readonly<Record<string, string | number | boolean>> = {}
): string {
    const target = new URL(url, location.href);
    for (const [key, value] of Object.entries(params)) {
        target.searchParams.set(key, String(value));
    }
    return target.href;
}

export async function loadEnvironmentMaps(): Promise<EnvironmentMaps> {
    const imageUrl = (name: string): string => new URL(`../image/${name}`, import.meta.url).href;
    const [{ diffuseEnvMap, specularEnvMap }, skyboxMap, brdfLUT] = await Promise.all([
        loadDefaultEnvironmentMaps(),
        loadDefaultSkyboxMap(),
        new Hilo3d.TextureLoader().load({
            src: imageUrl('brdfLUT.png'),
            wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
            wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
        })
    ]);
    return { diffuseEnvMap, specularEnvMap, skyboxMap, brdfLUT };
}

export const utils = Object.freeze({
    keys: parseQuery(),
    parseQuery,
    buildUrl,
    loadEnvironmentMaps
});

/** Creates one self-contained example runtime with no global mutable state. */
export function createExampleContext(
    options: ExampleContextOptions<'webgl2'> & { backend: 'webgl2' }
): Promise<ExampleContext<'webgl2'>>;
export function createExampleContext(
    options: ExampleContextOptions<'webgpu'> & { backend: 'webgpu' }
): Promise<ExampleContext<'webgpu'>>;
export function createExampleContext(options?: ExampleContextOptions): Promise<ExampleContext>;
export async function createExampleContext(
    options: ExampleContextOptions = {}
): Promise<ExampleContext> {
    const width = options.stage?.width ?? window.innerWidth;
    const height = options.stage?.height ?? window.innerHeight;
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: width / height,
        far: 100,
        near: 0.1,
        z: 3,
        ...options.camera
    });
    const container = options.container ?? document.getElementById('container') ?? document.body;
    const backend = options.backend ?? resolveExampleBackend();
    let stage: Hilo3d.Stage | undefined;
    let ticker: ExampleTicker | undefined;
    let stats: Stats | undefined;
    let orbitControls: Hilo3d.OrbitControls | undefined;
    let captureControl: TestFrameControl | undefined;
    const handleResize = (): void => {
        if (!lifecycle.active || stage === undefined) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        if (stage.camera instanceof Hilo3d.PerspectiveCamera) {
            stage.camera.aspect = camera.aspect;
        }
        stage.resize(window.innerWidth, window.innerHeight);
    };
    const lifecycle = installPageLifecycle({
        pause(): void {
            captureControl?.setSuspended(true);
            ticker?.suspend();
            stats?.suspend();
        },
        resume(): void {
            handleResize();
            stats?.resume();
            captureControl?.setSuspended(false);
            ticker?.restore();
        },
        dispose(): void {
            const failures: unknown[] = [];
            const cleanups = [
                (): void => {
                    ticker?.dispose();
                },
                (): void => {
                    captureControl?.dispose();
                },
                (): void => {
                    if (window.__HILO3D_TEST_CAPTURE__ === captureControl) {
                        delete window.__HILO3D_TEST_CAPTURE__;
                    }
                    window.removeEventListener('resize', handleResize);
                },
                (): void => {
                    orbitControls?.dispose();
                },
                (): void => {
                    stats?.dispose();
                },
                (): void => {
                    stage?.destroy();
                }
            ];
            for (const cleanup of cleanups) {
                try {
                    cleanup();
                } catch (error) {
                    failures.push(error);
                }
            }
            if (failures.length === 1) throw failures[0];
            if (failures.length > 1)
                throw new AggregateError(failures, 'Example runtime cleanup failed');
        }
    });

    try {
        stage = await Hilo3d.Stage.create<Hilo3d.RendererBackend>({
            backend,
            clearColor: new Hilo3d.Color(0.008, 0.012, 0.028),
            width,
            height,
            antialias: false,
            alpha: false,
            useLogDepth: false,
            renderPipeline: createExampleRenderPipeline(),
            ...options.stage,
            container,
            camera
        });
        if (lifecycle.disposed) {
            stage.destroy();
            stage = undefined;
            throw new DOMException(
                'Example initialization was cancelled by page disposal',
                'AbortError'
            );
        }

        const renderer = stage.renderer;
        const { directionLight, ambientLight } = createExampleLights();
        directionLight.addTo(stage);
        ambientLight.addTo(stage);
        ticker = new ExampleTicker(60);
        ticker.addTick(stage);
        ticker.addTick(Hilo3d.Tween);
        ticker.addTick(Hilo3d.Animation);
        stats = new Stats(ticker, renderer);
        orbitControls = new Hilo3d.OrbitControls(stage, {
            enablePan: false,
            ...options.controls
        });
        window.addEventListener('resize', handleResize);
        console.info(`Stage uses ${renderer.backend}`);
        const query = new URLSearchParams(location.search);
        captureControl =
            query.get('test') === '1'
                ? createTestFrameControl(
                      ticker,
                      () => renderer.waitForIdle(),
                      query.get('testClock') !== '1'
                  )
                : undefined;
        if (captureControl) window.__HILO3D_TEST_CAPTURE__ = captureControl;
        if (!lifecycle.active) {
            ticker.suspend();
            stats.suspend();
            captureControl?.setSuspended(true);
        }
        if (options.autoStart ?? true) ticker.start();

        return {
            camera,
            stage,
            renderer,
            directionLight,
            ambientLight,
            ticker,
            stats,
            orbitControls,
            lifecycle,
            onDispose: lifecycle.onDispose,
            dispose: lifecycle.dispose
        };
    } catch (error) {
        try {
            lifecycle.dispose();
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                'Example initialization and cleanup failed',
                { cause: cleanupError }
            );
        }
        throw error;
    }
}

declare global {
    interface Window {
        __HILO3D_TEST_CAPTURE__?: {
            waitForFrames(count: number): Promise<void>;
            pause(): Promise<void>;
            resume(): void;
        };
    }
}
