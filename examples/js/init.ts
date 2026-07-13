import * as Hilo3d from '../../src/Hilo3d';
import type { PerspectiveCameraParameters } from '../../src/camera/PerspectiveCamera';
import type { StageParameters } from '../../src/core/Stage';
import OrbitControls, { type OrbitControlsOptions } from './OrbitControls';
import Stats from './stats';

export type QueryValues = Readonly<Record<string, string>>;

export interface EnvironmentMaps {
    diffuseEnvMap: Hilo3d.CubeTexture;
    specularEnvMap: Hilo3d.CubeTexture;
    brdfLUT: Hilo3d.Texture;
}

export interface ExampleContextOptions {
    container?: HTMLElement;
    camera?: PerspectiveCameraParameters;
    stage?: Omit<StageParameters, 'camera' | 'container'>;
    controls?: OrbitControlsOptions;
    autoStart?: boolean;
}

export interface ExampleContext {
    readonly camera: Hilo3d.PerspectiveCamera;
    readonly stage: Hilo3d.Stage;
    readonly renderer: Hilo3d.WebGLRenderer;
    readonly directionLight: Hilo3d.DirectionalLight;
    readonly ambientLight: Hilo3d.AmbientLight;
    readonly ticker: Hilo3d.Ticker;
    readonly stats: Stats;
    readonly orbitControls: OrbitControls;
    dispose(): void;
}

function isTexture(value: unknown): value is Hilo3d.Texture {
    return value instanceof Hilo3d.Texture;
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
    const queue = new Hilo3d.LoadQueue([
        {
            type: 'CubeTexture',
            images: [
                imageUrl('bakedDiffuse_01.jpg'),
                imageUrl('bakedDiffuse_02.jpg'),
                imageUrl('bakedDiffuse_03.jpg'),
                imageUrl('bakedDiffuse_04.jpg'),
                imageUrl('bakedDiffuse_05.jpg'),
                imageUrl('bakedDiffuse_06.jpg')
            ]
        },
        {
            type: 'CubeTexture',
            right: imageUrl('px.jpg'),
            left: imageUrl('nx.jpg'),
            top: imageUrl('py.jpg'),
            bottom: imageUrl('ny.jpg'),
            front: imageUrl('pz.jpg'),
            back: imageUrl('nz.jpg'),
            magFilter: Hilo3d.constants.webgl.LINEAR,
            minFilter: Hilo3d.constants.webgl.LINEAR_MIPMAP_LINEAR
        },
        {
            src: imageUrl('brdfLUT.png'),
            wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
            wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
            type: 'Texture'
        }
    ]);

    const failures: unknown[] = [];
    queue.on('error', event => {
        failures.push(event.detail);
    });

    await new Promise<void>((resolve, reject) => {
        queue.on(
            'complete',
            () => {
                if (failures.length > 0) {
                    reject(new AggregateError(failures, 'Failed to load environment maps'));
                } else {
                    resolve();
                }
            },
            true
        );
        queue.start();
    });

    const [diffuseEnvMap, specularEnvMap, brdfLUT] = queue.getAllContent();
    if (!(diffuseEnvMap instanceof Hilo3d.CubeTexture)) {
        throw new TypeError('Diffuse environment map did not produce a CubeTexture');
    }
    if (!(specularEnvMap instanceof Hilo3d.CubeTexture)) {
        throw new TypeError('Specular environment map did not produce a CubeTexture');
    }
    if (!isTexture(brdfLUT)) {
        throw new TypeError('BRDF lookup table did not produce a Texture');
    }

    return { diffuseEnvMap, specularEnvMap, brdfLUT };
}

export const utils = Object.freeze({
    keys: parseQuery(),
    parseQuery,
    buildUrl,
    loadEnvironmentMaps
});

/** Creates one self-contained example runtime with no global mutable state. */
export function createExampleContext(options: ExampleContextOptions = {}): ExampleContext {
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
    const stage = new Hilo3d.Stage({
        clearColor: new Hilo3d.Color(0.3, 0.35, 0.35),
        width,
        height,
        preferWebGL2: new URLSearchParams(location.search).has('webgl2'),
        antialias: false,
        alpha: false,
        useLogDepth: false,
        ...options.stage,
        container,
        camera
    });

    const renderer = stage.renderer;
    const directionLight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 1, 1),
        direction: new Hilo3d.Vector3(0, -1, 0)
    });
    directionLight.addTo(stage);

    const ambientLight = new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(1, 1, 1),
        amount: 0.5
    });
    ambientLight.addTo(stage);

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(stage);
    ticker.addTick(Hilo3d.Tween);
    ticker.addTick(Hilo3d.Animation);
    const stats = new Stats(ticker, renderer.renderInfo);
    const orbitControls = new OrbitControls(stage, {
        isLockMove: true,
        isLockZ: true,
        ...options.controls
    });

    const handleResize = (): void => {
        camera.aspect = window.innerWidth / window.innerHeight;
        stage.resize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    renderer.on('init', () => {
        console.info(`Stage uses ${renderer.isWebGL2 ? 'WebGL2' : 'WebGL1'}`);
    });
    renderer.on('initFailed', event => {
        console.error('Stage initialization failed', event.detail);
    });

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
            orbitControls.disable();
            stats.stop();
            ticker.stop();
            stage.destroy();
        }
    };
}
