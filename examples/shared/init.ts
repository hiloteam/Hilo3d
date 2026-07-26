import * as Hilo3d from '../../src/Hilo3d';
import type { PerspectiveCameraParameters } from '../../src/camera/PerspectiveCamera';
import OrbitControls, { type OrbitControlsOptions } from './OrbitControls';
import Stats from './stats';
import { resolveExampleBackend } from './backend';
import { createStudioEnvironmentMaps } from './studioEnvironment';

export { resolveExampleBackend };

export type QueryValues = Readonly<Record<string, string>>;

export interface EnvironmentMaps {
    diffuseEnvMap: Hilo3d.CubeTexture;
    specularEnvMap: Hilo3d.CubeTexture;
    brdfLUT: Hilo3d.Texture;
}

export interface ExampleContextOptions<
    Backend extends Hilo3d.RendererBackend = Hilo3d.RendererBackend
> {
    container?: HTMLElement;
    camera?: PerspectiveCameraParameters;
    backend?: Backend;
    stage?: Omit<Hilo3d.StageParameters<Backend>, 'backend' | 'camera' | 'container'>;
    controls?: OrbitControlsOptions;
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
    readonly orbitControls: OrbitControls;
    dispose(): void;
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
    const { diffuseEnvMap, specularEnvMap } = createStudioEnvironmentMaps();
    const brdfLUT = await new Hilo3d.TextureLoader().load({
        src: imageUrl('brdfLUT.png'),
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
    });
    return { diffuseEnvMap, specularEnvMap, brdfLUT };
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
    const stage = await Hilo3d.Stage.create<Hilo3d.RendererBackend>({
        backend,
        clearColor: new Hilo3d.Color(0.008, 0.012, 0.028),
        width,
        height,
        antialias: false,
        alpha: false,
        useLogDepth: false,
        ...options.stage,
        container,
        camera
    });

    const renderer = stage.renderer;
    const directionLight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(0.86, 0.92, 1),
        amount: 3.2,
        direction: new Hilo3d.Vector3(-0.7, -1, -0.35)
    });
    directionLight.addTo(stage);

    const ambientLight = new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(0.42, 0.48, 0.68),
        amount: 0.42
    });
    ambientLight.addTo(stage);

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(stage);
    ticker.addTick(Hilo3d.Tween);
    ticker.addTick(Hilo3d.Animation);
    const stats = new Stats(ticker, renderer);
    const orbitControls = new OrbitControls(stage, {
        enablePan: false,
        ...options.controls
    });

    const handleResize = (): void => {
        camera.aspect = window.innerWidth / window.innerHeight;
        stage.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    console.info(`Stage uses ${renderer.backend}`);

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
        dispose(): void {
            window.removeEventListener('resize', handleResize);
            orbitControls.dispose();
            stats.stop();
            ticker.stop();
            stage.destroy();
        }
    };
}
