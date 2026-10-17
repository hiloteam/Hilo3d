import * as H from '../src/Hilo3d';
import { resolveExampleBackend } from './shared/backend';
import { loadEnvironmentMaps } from './shared/init';
import { environmentMaterialDefaults } from './shared/environment';
import { paintSoftMatterSurface } from './shared/softMatterTextures';
import { createTestFrameControl, type TestFrameControl } from './shared/test-frame-control';

export type SoftMatterFeature = 'sheen' | 'thin' | 'sss';
export type SoftMatterView = 'gallery' | 'velvet' | 'petal' | 'wax';
export interface SoftMatterAPI {
    readonly ready: boolean;
    readonly disposed: boolean;
    readonly retained: boolean;
    readonly frame: number;
    cameraPosition(): readonly number[];
    setFeature(name: SoftMatterFeature, enabled: boolean): void;
    setView(name: SoftMatterView): void;
    settle(options?: Readonly<{ keepPaused?: boolean }>): Promise<void>;
    resume(): void;
    dispose(): Promise<void>;
}
declare global {
    interface Window {
        __HILO_SOFT_MATTER__?: SoftMatterAPI;
    }
}

const query = new URLSearchParams(location.search);
const testMode = query.get('test') === '1';
const portableCapture = testMode && query.get('quality') !== 'production';
const backend = resolveExampleBackend();
const events = new AbortController();
const eventOptions = { signal: events.signal };
const textures: H.Texture<unknown>[] = [];
const featureState: Record<SoftMatterFeature, boolean> = { sheen: true, thin: true, sss: true };
let stage: H.Stage | undefined;
let controls: H.OrbitControls | undefined;
let ticker: H.Ticker | undefined;
let capture: TestFrameControl | undefined;
let model: H.GLTFModel | undefined;
let ready = false;
let disposed = false;
let retained = false;
let settling = false;
let keepCapturePaused = false;
let frame = 0;
let cleanup: Promise<void> | undefined;
let selectedView: SoftMatterView = 'gallery';
let resumeInitialization: (() => void) | undefined;
let velvet: H.PBRMaterial | undefined;
let wax: H.PBRMaterial | undefined;
let petals: readonly H.PBRMaterial[] = [];

function isDisposed(): boolean {
    return disposed;
}

function element<T extends HTMLElement>(selector: string, kind: new () => T): T {
    const value = document.querySelector(selector);
    if (!(value instanceof kind)) throw new Error(`Soft Matter requires ${selector}`);
    return value;
}

function pixelRatio(): number {
    return Math.min(
        portableCapture ? 1 : devicePixelRatio,
        portableCapture ? 480 / innerWidth : 1920 / innerWidth,
        portableCapture ? 300 / innerHeight : 1080 / innerHeight
    );
}

function fieldOfView(): number {
    return (
        (Math.atan(Math.tan((31 * Math.PI) / 360) * Math.max(1, 1.6 / (innerWidth / innerHeight))) *
            360) /
        Math.PI
    );
}

function showFailure(error: unknown): void {
    if (disposed) {
        console.error(error);
        return;
    }
    const message = error instanceof Error ? error.message : String(error);
    document.body.dataset['failure'] = 'true';
    const failure = element('#failure', HTMLElement);
    failure.hidden = false;
    failure.textContent = `The exhibition could not open. ${message}`;
    element('#loading', HTMLElement).hidden = true;
    console.error(error);
    void dispose();
}

function resume(): void {
    if (!ready || retained || disposed || settling || keepCapturePaused) return;
    capture?.resume();
    ticker?.start();
}

async function activePage(): Promise<boolean> {
    while (retained && !disposed) {
        await new Promise<void>(resolve => {
            resumeInitialization = resolve;
        });
    }
    return !disposed;
}

function setFeature(name: SoftMatterFeature, enabled: boolean): void {
    featureState[name] = enabled;
    if (name === 'sheen' && velvet !== undefined) {
        velvet.sheenColor.set(enabled ? 0.95 : 0, enabled ? 0.24 : 0, enabled ? 0.31 : 0, 1);
        velvet.invalidateData();
    } else if (name === 'thin') {
        petals.forEach(material => {
            material.diffuseTransmissionFactor = enabled ? 0.93 : 0;
        });
    } else if (name === 'sss' && wax !== undefined) {
        wax.subsurfaceFactor = enabled ? 1 : 0;
    }
    element(`[data-feature="${name}"]`, HTMLButtonElement).setAttribute(
        'aria-pressed',
        String(enabled)
    );
    element('#compare', HTMLButtonElement).setAttribute(
        'aria-pressed',
        String(!Object.values(featureState).some(Boolean))
    );
}

function setView(name: SoftMatterView): void {
    selectedView = name;
    const views = {
        gallery: [
            [0.45, 3.65, 14.2],
            [0, 2.45, 0.25]
        ],
        velvet: [
            [-2.5, 3.4, 7.8],
            [-2.9, 2.05, 0.15]
        ],
        wax: [
            [1.3, 3.5, 8.1],
            [0, 2.8, 0]
        ],
        petal: [
            [4.3, 3.7, 6.7],
            [2.8, 2.95, 0]
        ]
    } as const;
    const view = views[name];
    controls?.setView(new H.Vector3(...view[0]), new H.Vector3(...view[1]));
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
        button.setAttribute('aria-pressed', String(button.dataset['view'] === name));
    }
}

async function dispose(): Promise<void> {
    if (cleanup !== undefined) return cleanup;
    disposed = true;
    ready = false;
    ticker?.stop();
    capture?.dispose();
    controls?.dispose();
    resumeInitialization?.();
    events.abort();
    delete window.__HILO3D_TEST_CAPTURE__;
    document.body.dataset['disposed'] = 'true';
    cleanup = (async (): Promise<void> => {
        await initialization;
        try {
            await stage?.renderer.waitForIdle();
        } finally {
            try {
                if (stage !== undefined) stage.destroy();
            } finally {
                textures.forEach(texture => {
                    texture.destroy();
                });
            }
        }
    })();
    return cleanup;
}

async function settle(options: Readonly<{ keepPaused?: boolean }> = {}): Promise<void> {
    await initialization;
    if (disposed || retained || stage === undefined) throw new Error('Soft Matter is not active');
    if (settling) throw new Error('Soft Matter settling is already active');
    if (options.keepPaused === true && !testMode)
        throw new Error('Holding a capture requires test=1');
    keepCapturePaused = options.keepPaused ?? false;
    settling = true;
    ticker?.pause();
    try {
        await capture?.pause();
        await stage.renderer.waitForIdle();
        const count = 8 + ((8 - (frame % 8)) % 8);
        for (let index = 0; index < count; index++) {
            if (!(await activePage())) return;
            stage.tick(1000 / 60);
            frame++;
            await stage.renderer.waitForIdle();
        }
    } finally {
        settling = false;
        resume();
    }
}

window.__HILO_SOFT_MATTER__ = {
    get ready(): boolean {
        return ready;
    },
    get disposed(): boolean {
        return disposed;
    },
    get retained(): boolean {
        return retained;
    },
    get frame(): number {
        return frame;
    },
    cameraPosition: () =>
        controls === undefined ? [] : [controls.camera.x, controls.camera.y, controls.camera.z],
    setFeature,
    setView,
    settle,
    resume(): void {
        keepCapturePaused = false;
        resume();
    },
    dispose
};

window.addEventListener(
    'pagehide',
    event => {
        if (!event.persisted) {
            void dispose().catch(showFailure);
            return;
        }
        retained = true;
        ticker?.stop();
        void capture?.pause().catch(showFailure);
    },
    eventOptions
);
window.addEventListener(
    'pageshow',
    event => {
        if (!event.persisted || disposed) return;
        retained = false;
        resumeInitialization?.();
        resumeInitialization = undefined;
        resume();
    },
    eventOptions
);

async function initialize(): Promise<void> {
    const camera = new H.PerspectiveCamera({
        near: 0.08,
        far: 60,
        fov: fieldOfView(),
        aspect: innerWidth / innerHeight
    });
    const createdStage = await H.Stage.create({
        container: element('#container', HTMLElement),
        backend,
        camera,
        width: innerWidth,
        height: innerHeight,
        pixelRatio: pixelRatio(),
        antialias: false,
        clearColor: new H.Color(0.006, 0.018, 0.015),
        renderPipeline: new H.PostProcessRenderPipelineFactory({
            subsurfaceScattering: {
                sampleCount: 25,
                maxRadiusPixels: 64,
                maxPixelCount: 1920 * 1080
            },
            groundTruthAmbientOcclusion: { quality: 'low', radius: 0.38, intensity: 1.05 },
            temporalAA: { sharpness: 0.1 },
            bloom: false,
            colorUber: { toneMapping: 'aces', exposure: 0 }
        })
    });
    if (isDisposed()) {
        createdStage.destroy();
        return;
    }
    stage = createdStage;
    controls = new H.OrbitControls(stage, {
        target: new H.Vector3(0, 2.4, 0),
        minDistance: 4,
        maxDistance: 26,
        minPolarAngle: 0.38,
        maxPolarAngle: 1.65,
        enablePan: true,
        rotateSpeed: 0.65,
        zoomSpeed: 0.7
    });
    setView(selectedView);
    const environment = await loadEnvironmentMaps();
    const environmentTextures = [
        environment.diffuseEnvMap,
        environment.specularEnvMap,
        environment.skyboxMap,
        environment.brdfLUT
    ];
    if (isDisposed()) {
        environmentTextures.forEach(texture => {
            texture.destroy();
        });
        return;
    }
    textures.push(...environmentTextures);
    const surfaces = {
        velvet: paintSoftMatterSurface('velvet'),
        stone: paintSoftMatterSurface('stone'),
        petal: paintSoftMatterSurface('petal'),
        leaf: paintSoftMatterSurface('leaf')
    };
    Object.values(surfaces).forEach(surface => {
        textures.push(surface.color, surface.normal);
    });
    const env = {
        ...environmentMaterialDefaults(environment),
        diffuseEnvIntensity: 0.12,
        specularEnvIntensity: 0.45
    };
    const fabricTransform = new H.Matrix3();
    fabricTransform.elements[0] = 5;
    fabricTransform.elements[4] = 8;
    velvet = new H.PBRMaterial({
        ...env,
        name: 'Wine velvet',
        baseColor: new H.Color(0.075, 0.002, 0.009),
        roughness: 0.88,
        metallic: 0,
        ior: 1.2,
        baseColorMap: {
            texture: surfaces.velvet.color,
            encoding: 'srgb',
            transform: fabricTransform
        },
        normalMap: { texture: surfaces.velvet.normal, transform: fabricTransform },
        normalScale: 0.35,
        sheenColor: new H.Color(0.95, 0.24, 0.31),
        sheenRoughness: 0.48,
        cullMode: 'none'
    });
    wax = new H.PBRMaterial({
        ...env,
        name: 'Ivory wax',
        baseColor: new H.Color(0.8, 0.69, 0.51),
        roughness: 0.52,
        metallic: 0,
        specularEnvIntensity: 0.18,
        subsurfaceProfile: new H.SubsurfaceScatteringProfile({ radius: [0.12, 0.06, 0.035] }),
        subsurfaceThickness: 0.5
    });
    const petal = new H.PBRMaterial({
        ...env,
        name: 'Amber petals',
        metallic: 0,
        roughness: 0.42,
        baseColor: new H.Color(0.52, 0.23, 0.045),
        baseColorMap: surfaces.petal.color,
        normalMap: surfaces.petal.normal,
        normalScale: 0.55,
        cullMode: 'none',
        diffuseTransmissionFactor: 0.93,
        diffuseTransmissionColor: new H.Color(1, 0.42, 0.08),
        diffuseTransmissionMap: surfaces.petal.color
    });
    const leaf = new H.PBRMaterial({
        ...env,
        name: 'Green leaves',
        metallic: 0,
        roughness: 0.5,
        baseColor: new H.Color(0.5, 0.65, 0.3),
        baseColorMap: surfaces.leaf.color,
        normalMap: surfaces.leaf.normal,
        normalScale: 0.5,
        cullMode: 'none',
        diffuseTransmissionFactor: 0.93,
        diffuseTransmissionColor: new H.Color(0.44, 0.8, 0.16),
        diffuseTransmissionMap: surfaces.leaf.color
    });
    petals = [petal, leaf];
    const stone = new H.PBRMaterial({
        ...env,
        name: 'Verde stone',
        baseColorMap: surfaces.stone.color,
        normalMap: surfaces.stone.normal,
        normalScale: 0.4,
        roughness: 0.6,
        metallic: 0.1,
        specularEnvIntensity: 0.2
    });
    const brass = new H.PBRMaterial({
        ...env,
        name: 'Aged brass',
        baseColor: new H.Color(0.32, 0.18, 0.055),
        metallic: 0.85,
        roughness: 0.45,
        specularEnvIntensity: 0.55
    });
    const materials: Readonly<Record<string, H.PBRMaterial>> = {
        velvet,
        wax,
        petal,
        leaf,
        brass,
        stone
    };
    const loaded = await new H.GLTFLoader().load({
        src: new URL('./assets/mat1-soft-matter/soft-matter.glb', import.meta.url).href
    });
    await loaded.ready;
    if (isDisposed()) {
        // Final disposal awaits initialization, so the renderer still owns a live resource manager.
        loaded.node.destroy(createdStage.renderer, true);
        return;
    }
    if (loaded.resourceErrors.length > 0)
        throw new AggregateError(loaded.resourceErrors, 'Soft Matter model resources failed');
    model = loaded;
    for (const mesh of model.meshes) {
        const name = mesh.material?.name ?? 'unnamed';
        const material = materials[name.toLowerCase()];
        if (material === undefined) throw new Error(`Unknown Soft Matter material: ${name}`);
        mesh.material = material;
        mesh.contributeToGlobalIllumination = false;
    }
    model.node.addTo(stage);
    const stoneRepeat = new H.Matrix3();
    stoneRepeat.elements[0] = stoneRepeat.elements[4] = 10;
    const architecture = new H.PBRMaterial({
        ...env,
        baseColorMap: { texture: surfaces.stone.color, transform: stoneRepeat },
        normalMap: { texture: surfaces.stone.normal, transform: stoneRepeat },
        normalScale: 0.3,
        baseColor: new H.Color(0.75, 0.86, 0.8),
        roughness: 0.7,
        metallic: 0.04,
        specularEnvIntensity: 0.1
    });
    new H.Mesh({
        geometry: new H.PlaneGeometry({ width: 70, height: 70 }),
        material: architecture,
        rotationX: -90,
        y: -0.015,
        castShadows: false
    }).addTo(stage);
    const wall = new H.PBRMaterial({
        ...env,
        baseColor: new H.Color(0.008, 0.025, 0.021),
        metallic: 0,
        roughness: 1,
        diffuseEnvIntensity: 0.03,
        specularEnvIntensity: 0.03
    });
    new H.Mesh({
        geometry: new H.PlaneGeometry({ width: 65, height: 28 }),
        material: wall,
        y: 10,
        z: -4.5,
        castShadows: false
    }).addTo(stage);
    new H.DirectionalLight({
        color: new H.Color(1, 0.94, 0.84),
        amount: 1.6,
        direction: new H.Vector3(0.85, -1.4, -0.8),
        shadow: {
            width: portableCapture ? 1024 : 2048,
            height: portableCapture ? 1024 : 2048,
            minBias: 0.0006,
            maxBias: 0.003,
            cameraInfo: { left: -8, right: 8, top: 8, bottom: -8, near: 0.1, far: 35 }
        }
    }).addTo(stage);
    new H.DirectionalLight({
        color: new H.Color(0.36, 0.66, 0.61),
        amount: 0.22,
        direction: new H.Vector3(-1, -0.3, -0.1)
    }).addTo(stage);
    new H.AmbientLight({ color: new H.Color(0.5, 0.65, 0.59), amount: 0.04 }).addTo(stage);
    const softbox = new H.AreaLight({
        x: -3.2,
        y: 5.8,
        z: 4,
        width: 3.5,
        height: 2.5,
        amount: 1.8,
        color: new H.Color(1, 0.87, 0.7)
    });
    softbox.lookAt(new H.Vector3(0, 2.5, 0));
    softbox.addTo(stage);
    new H.PointLight({
        x: 3.1,
        y: 3.5,
        z: -1.2,
        color: new H.Color(1, 0.67, 0.24),
        amount: 5.5,
        range: 5.5
    }).addTo(stage);
    new H.PointLight({
        x: -1.7,
        y: 4.8,
        z: 1.8,
        color: new H.Color(1, 0.85, 0.62),
        amount: 1.5,
        range: 7
    }).addTo(stage);
    for (let index = 0; index < 5; index++) {
        new H.Mesh({
            geometry: new H.BoxGeometry({ width: 0.13, height: 1.9, depth: 0.12 }),
            material: brass,
            x: -3.7 + index * 0.48,
            y: 8,
            z: 2.8,
            rotationZ: -28
        }).addTo(stage);
    }
    new H.PointLight({
        x: -4,
        y: 5.4,
        z: -2.5,
        color: new H.Color(1, 0.79, 0.54),
        amount: 5,
        range: 8
    }).addTo(stage);
    for (const name of ['sheen', 'thin', 'sss'] as const) setFeature(name, featureState[name]);
    ticker = new H.Ticker(60);
    ticker.addTick({
        tick(delta: number): void {
            if (disposed || retained) return;
            stage?.tick(delta);
            frame++;
        }
    });
    capture = testMode
        ? createTestFrameControl(ticker, () => createdStage.renderer.waitForIdle())
        : undefined;
    if (capture !== undefined) {
        const control = capture;
        window.__HILO3D_TEST_CAPTURE__ = {
            ...control,
            resume(): void {
                if (!retained && !disposed && !settling && !keepCapturePaused) control.resume();
            }
        };
    }
    window.addEventListener(
        'resize',
        () => {
            if (disposed || stage === undefined) return;
            camera.aspect = innerWidth / innerHeight;
            camera.fov = fieldOfView();
            stage.resize(innerWidth, innerHeight, pixelRatio());
        },
        eventOptions
    );
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-feature]')) {
        const name = button.dataset['feature'];
        if (name !== 'sheen' && name !== 'thin' && name !== 'sss')
            throw new Error('Unknown surface button');
        button.addEventListener(
            'click',
            () => {
                setFeature(name, !featureState[name]);
            },
            eventOptions
        );
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
        const name = button.dataset['view'];
        if (name !== 'gallery' && name !== 'velvet' && name !== 'petal' && name !== 'wax')
            throw new Error('Unknown gallery view');
        button.addEventListener(
            'click',
            () => {
                setView(name);
            },
            eventOptions
        );
    }
    element('#compare', HTMLButtonElement).addEventListener(
        'click',
        () => {
            const enabled = !Object.values(featureState).some(Boolean);
            for (const name of ['sheen', 'thin', 'sss'] as const) setFeature(name, enabled);
        },
        eventOptions
    );
    element('#reset', HTMLButtonElement).addEventListener(
        'click',
        () => {
            for (const name of ['sheen', 'thin', 'sss'] as const) setFeature(name, true);
            setView('gallery');
        },
        eventOptions
    );
    for (let index = 0; index < 8; index++) {
        if (!(await activePage())) return;
        stage.tick(1000 / 60);
        frame++;
        await stage.renderer.waitForIdle();
    }
    if (!(await activePage())) return;
    ready = true;
    document.body.dataset['ready'] = 'true';
    element('#render-backend', HTMLElement).textContent =
        backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';
    element('#loading', HTMLElement).hidden = true;
    resume();
}

const initialization = initialize().catch(showFailure);
