import * as Hilo3d from '../../src/Hilo3d';
import OrbitControls from './OrbitControls';
import Stats from './stats';

type QueryValues = Record<string, string>;

interface EnvironmentMaps {
    diffuseEnvMap: hilo3d.CubeTexture;
    specularEnvMap: hilo3d.CubeTexture;
    brdfLUT: hilo3d.Texture;
}

interface ExampleUtils {
    keys: QueryValues;
    parseQuery(url: string): QueryValues;
    buildUrl(url?: string, params?: Record<string, string | number | boolean>): string;
    loadEnvMap(callback: (maps: EnvironmentMaps) => void): void;
}

export let camera: hilo3d.PerspectiveCamera | undefined;
export let stage: hilo3d.Stage | undefined;
export let renderer: hilo3d.WebGLRenderer | undefined;
export let gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined;
export let directionLight: hilo3d.DirectionalLight | undefined;
export let ambientLight: hilo3d.AmbientLight | undefined;
export let ticker: hilo3d.Ticker | undefined;
export let stats: Stats | undefined;
export let orbitControls: OrbitControls | undefined;

if (!window.notInit) {
    camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / innerHeight,
        far: 100,
        near: 0.1,
        z: 3
    });

    const container = document.getElementById('container');
    stage = new Hilo3d.Stage({
        ...(container ? { container } : {}),
        camera,
        clearColor: new Hilo3d.Color(0.3, 0.35, 0.35),
        width: innerWidth,
        height: innerHeight,
        preferWebGL2: location.search.includes('webgl2'),
        antialias: false,
        alpha: false,
        useLogDepth: false
    });

    const activeCamera = camera;
    const activeStage = stage;
    window.addEventListener('resize', () => {
        activeCamera.aspect = innerWidth / innerHeight;
        activeStage.resize(innerWidth, innerHeight);
    });

    renderer = stage.renderer;
    directionLight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 1, 1),
        direction: new Hilo3d.Vector3(0, -1, 0)
    });
    directionLight.addTo(stage);

    ambientLight = new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(1, 1, 1),
        amount: 0.5
    });
    ambientLight.addTo(stage);

    ticker = new Hilo3d.Ticker(60);
    ticker.addTick(stage);
    ticker.addTick(Hilo3d.Tween);
    ticker.addTick(Hilo3d.Animation);
    stats = new Stats(ticker, stage.renderer.renderInfo);
    orbitControls = new OrbitControls(stage, {
        isLockMove: true,
        isLockZ: true
    });

    for (const eventName of ['init', 'initFailed']) {
        stage.renderer.on(eventName, event => {
            console.log(event.type, event);
            console.log(`Stage use ${renderer?.isWebGL2 ? 'WebGL2' : 'WebGL1'}`);
        });
    }

    window.setTimeout(() => {
        ticker?.start();
        gl = renderer?.gl;
    }, 10);
}

export const utils: ExampleUtils = {
    keys: {},

    parseQuery(url) {
        const pattern = /([^?#&=]+)=([^#&]*)/gu;
        const params: QueryValues = {};
        let result: RegExpExecArray | null;
        while ((result = pattern.exec(url))) {
            const key = result[1];
            const value = result[2];
            if (key !== undefined && value !== undefined) params[key] = decodeURIComponent(value);
        }
        return params;
    },

    buildUrl(url = '', params = {}) {
        const values: Record<string, string | number | boolean> = {
            ...this.parseQuery(url),
            ...params
        };
        const query = Object.entries(values)
            .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
            .join('&');
        return url.replace(/(\?.*)?$/u, `?${query}`);
    },

    loadEnvMap(callback) {
        const loadQueue = new Hilo3d.LoadQueue([{
            type: 'CubeTexture',
            images: [
                '//gw.alicdn.com/tfs/TB1i.dWr9cqBKNjSZFgXXX_kXXa-128-128.jpg',
                '//gw.alicdn.com/tfs/TB1ozYarJcnBKNjSZR0XXcFqFXa-128-128.jpg',
                '//gw.alicdn.com/tfs/TB11Nc_rRsmBKNjSZFFXXcT9VXa-128-128.jpg',
                '//gw.alicdn.com/tfs/TB13ldPr_mWBKNjSZFBXXXxUFXa-128-128.jpg',
                '//gw.alicdn.com/tfs/TB1RmQ6rTqWBKNjSZFAXXanSpXa-128-128.jpg',
                '//gw.alicdn.com/tfs/TB13j8frYZnBKNjSZFKXXcGOVXa-128-128.jpg'
            ]
        }, {
            type: 'CubeTexture',
            right: '//gw.alicdn.com/tfs/TB1EJJYr9cqBKNjSZFgXXX_kXXa-1024-1024.jpg',
            left: '//gw.alicdn.com/tfs/TB1xXKFrSYTBKNjSZKbXXXJ8pXa-1024-1024.jpg',
            top: '//gw.alicdn.com/tfs/TB1U7Fmr7UmBKNjSZFOXXab2XXa-1024-1024.jpg',
            bottom: '//gw.alicdn.com/tfs/TB1zJRdr8jTBKNjSZFDXXbVgVXa-1024-1024.jpg',
            front: '//gw.alicdn.com/tfs/TB1SkFLrQZmBKNjSZPiXXXFNVXa-1024-1024.jpg',
            back: '//gw.alicdn.com/tfs/TB1z9F2h4tnkeRjSZSgXXXAuXXa-1024-1024.jpg',
            magFilter: Hilo3d.constants.webgl.LINEAR,
            minFilter: Hilo3d.constants.webgl.LINEAR_MIPMAP_LINEAR
        }, {
            src: '//gw.alicdn.com/tfs/TB1.K0CrYZnBKNjSZFhXXc.oXXa-256-256.png',
            wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
            wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
            type: 'Texture'
        }]);

        loadQueue.start().on('complete', () => {
            const result = loadQueue.getAllContent();
            callback({
                diffuseEnvMap: result[0] as hilo3d.CubeTexture,
                specularEnvMap: result[1] as hilo3d.CubeTexture,
                brdfLUT: result[2] as hilo3d.Texture
            });
        });
    }
};

utils.keys = utils.parseQuery(location.href);

Object.defineProperties(window, {
    camera: { configurable: true, get: () => camera, set: value => { camera = value; } },
    stage: { configurable: true, get: () => stage, set: value => { stage = value; } },
    renderer: { configurable: true, get: () => renderer, set: value => { renderer = value; } },
    gl: { configurable: true, get: () => gl, set: value => { gl = value; } },
    directionLight: {
        configurable: true,
        get: () => directionLight,
        set: value => { directionLight = value; }
    },
    ambientLight: {
        configurable: true,
        get: () => ambientLight,
        set: value => { ambientLight = value; }
    },
    ticker: { configurable: true, get: () => ticker, set: value => { ticker = value; } },
    stats: { configurable: true, get: () => stats, set: value => { stats = value; } },
    orbitControls: {
        configurable: true,
        get: () => orbitControls,
        set: value => { orbitControls = value; }
    },
    utils: { configurable: true, get: () => utils }
});

declare global {
    interface Window {
        camera?: hilo3d.PerspectiveCamera;
        stage?: hilo3d.Stage;
        renderer?: hilo3d.WebGLRenderer;
        gl?: WebGLRenderingContext | WebGL2RenderingContext | null;
        directionLight?: hilo3d.DirectionalLight;
        ambientLight?: hilo3d.AmbientLight;
        ticker?: hilo3d.Ticker;
        stats?: Stats;
        orbitControls?: OrbitControls;
        utils: ExampleUtils;
    }
}

export type { EnvironmentMaps, ExampleUtils, QueryValues };
