import * as Hilo3d from '../src/Hilo3d';
import { loadDefaultEnvironmentMaps } from './shared/defaultEnvironment';

interface ReflectionPalaceEvidence {
    readonly backend: 'webgpu';
    readonly objectCount: number;
    readonly fallbackObjectCount: number;
    readonly visibleObjectCount: number;
    readonly hiZValid: boolean;
    readonly activeTileCount: number;
    readonly activePixelCount: number;
    readonly hitPixelCount: number;
    readonly missPixelCount: number;
    readonly uncertainPixelCount: number;
    readonly backfaceRejectedPixelCount: number;
    readonly historyAcceptedPixelCount: number;
    readonly historyRejectedPixelCount: number;
    readonly resolutionScale: 0.5;
    readonly screenSpaceReflections: boolean;
    readonly temporalAA: true;
    readonly surfaceFinish: 'smoked lacquer';
    readonly heroAsset: 'Khronos Car Concept';
}

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const reflectionsEnabled = search.get('ssr') !== 'false';

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) throw new Error(`Afterimage is missing ${selector}`);
    return element;
}

const container = requireElement('#container');
const ssrToggle = requireElement('#ssrToggle');
const ssrToggleLabel = requireElement('#ssrToggleLabel');
const statusLabel = requireElement('#statusLabel');

statusLabel.textContent = 'loading Khronos Car Concept';
const { diffuseEnvMap, specularEnvMap } = await loadDefaultEnvironmentMaps();
const brdfLUT = await new Hilo3d.TextureLoader().load({
    src: new URL('./image/brdfLUT.png', import.meta.url).href,
    wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
    wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
});
const loader = new Hilo3d.GLTFLoader();
// Keep the loft HDR windows as soft fill; local lights define this dark installation.
const carModel = await loader.load({
    src: new URL('./models/CarConcept/CarConcept.glb', import.meta.url).href,
    ignoreTextureError: false,
    pbrMaterialDefaults: {
        brdfLUT,
        diffuseEnvMap: { texture: diffuseEnvMap, encoding: 'srgb' },
        specularEnvMap: { texture: specularEnvMap, encoding: 'srgb' },
        diffuseEnvIntensity: 0.35,
        specularEnvIntensity: 0.32
    }
});
await carModel.ready;
if (carModel.resourceErrors.length > 0) {
    throw new AggregateError(carModel.resourceErrors, 'Khronos Car Concept has resource failures');
}
for (const material of carModel.materials) {
    if (!(material instanceof Hilo3d.PBRMaterial) || !material.name?.startsWith('Paint')) continue;
    material.clearcoatRoughnessFactor = Math.max(material.clearcoatRoughnessFactor, 0.12);
    material.normalScale = Math.min(material.normalScale, 0.04);
    material.roughness = Math.max(material.roughness, 0.36);
    material.iridescenceFactor = Math.min(material.iridescenceFactor, 0.02);
    material.specularEnvIntensity = Math.min(material.specularEnvIntensity, 0.28);
}

const floorGeometry = new Hilo3d.PlaneGeometry({ width: 80, height: 80 });
const floorMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.018, 0.015, 0.022),
    metallic: 0.38,
    roughness: 0.11,
    brdfLUT,
    diffuseEnvMap: { texture: diffuseEnvMap, encoding: 'srgb' },
    specularEnvMap: { texture: specularEnvMap, encoding: 'srgb' },
    diffuseEnvIntensity: 0.03,
    specularEnvIntensity: 0.04
});
const gpuEvidenceGeometry = new Hilo3d.BoxGeometry({ width: 0.16, height: 0.08, depth: 0.16 });
const gpuEvidenceMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.01, 0.009, 0.012),
    metallic: 0.2,
    roughness: 0.8
});

const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
    buckets: [{ geometry: gpuEvidenceGeometry, material: gpuEvidenceMaterial }],
    maxObjects: 32,
    maxLights: 8,
    maxLightIndices: 65_536,
    maxLightsPerCluster: 48,
    tileSize: 24,
    zSlices: 24,
    maxViewportWidth: 2560,
    maxViewportHeight: 1440,
    hiZ: true,
    bloomStrength: 0.14,
    exposure: 1.08,
    temporalAA: {
        renderScale: 1,
        historyWeight: 0.94,
        depthThreshold: 0.02,
        varianceGamma: 1,
        sharpness: 0.025
    },
    screenSpaceReflections: reflectionsEnabled
        ? {
              resolutionScale: 0.5,
              maxRayDistance: 56,
              thickness: 0.12,
              stride: 0.06,
              maxSteps: 96,
              roughnessCutoff: 0.32,
              edgeFade: 0.1,
              historyWeight: 0.95,
              depthThreshold: 0.03,
              intensity: 1.15
          }
        : false
});

// Keep the complete car in portrait viewports and stay within the declared physical GPU budget.
function cameraFieldOfView(aspect: number): number {
    return (Math.atan(Math.tan((32 * Math.PI) / 360) * Math.max(1, 1.2 / aspect)) * 360) / Math.PI;
}

function renderPixelRatio(width: number, height: number): number {
    return Math.min(testMode ? 1 : devicePixelRatio, 1.5, 2560 / width, 1440 / height);
}

const initialWidth = innerWidth;
const initialHeight = innerHeight;
const camera = new Hilo3d.PerspectiveCamera({
    aspect: initialWidth / Math.max(initialHeight, 1),
    fov: cameraFieldOfView(initialWidth / Math.max(initialHeight, 1)),
    near: 0.05,
    far: 90,
    depthMode: 'reversed'
});

document.body.dataset['ssrPhase'] = 'creating-stage';
const stage = await Hilo3d.Stage.create<'webgpu'>({
    backend: 'webgpu',
    container,
    camera,
    width: initialWidth,
    height: initialHeight,
    pixelRatio: renderPixelRatio(initialWidth, initialHeight),
    antialias: false,
    alpha: false,
    clearColor: new Hilo3d.Color(0.0012, 0.001, 0.0018),
    renderingProfile: 'high-end',
    renderPipeline: factory
});
document.body.dataset['ssrPhase'] = 'building-atelier';

new Hilo3d.AmbientLight({
    amount: 0.18,
    color: new Hilo3d.Color(0.25, 0.28, 0.36)
}).addTo(stage);
new Hilo3d.DirectionalLight({
    amount: 1.65,
    color: new Hilo3d.Color(1, 0.86, 0.76),
    direction: new Hilo3d.Vector3(-0.34, -0.91, -0.2)
}).addTo(stage);

new Hilo3d.PointLight({
    amount: 3.8,
    range: 12,
    color: new Hilo3d.Color(1, 0.78, 0.64),
    x: 3.8,
    y: 3.2,
    z: 1.6
}).addTo(stage);

const floor = new Hilo3d.Mesh({
    geometry: floorGeometry,
    material: floorMaterial,
    y: -1.76,
    z: -4.4,
    rotationX: -90,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);
floor.receiveShadows = false;

new Hilo3d.Mesh({
    geometry: gpuEvidenceGeometry,
    material: gpuEvidenceMaterial,
    y: -1.94,
    z: -5.4,
    pointerEnabled: false
}).addTo(stage);

new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 30, widthSegments: 64, heightSegments: 32 }),
    material: new Hilo3d.PBRMaterial({
        unlit: true,
        baseColor: new Hilo3d.Color(0.008, 0.0068, 0.01),
        metallic: 0,
        roughness: 1,
        cullMode: 'front'
    }),
    y: 0.5,
    z: -5.4,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);

const carBounds = carModel.node.getBounds();
if (carBounds === undefined) throw new Error('Khronos Car Concept has no renderable bounds');
const carLargestDimension = Math.max(carBounds.width, carBounds.height, carBounds.depth);
if (!Number.isFinite(carLargestDimension) || carLargestDimension <= 0) {
    throw new RangeError('Khronos Car Concept has invalid bounds');
}
const carScale = 7.7 / carLargestDimension;
carModel.node.setScale(carScale);
carModel.node.setPosition(
    -carBounds.x * carScale + 1.05,
    -carBounds.y * carScale + carBounds.height * carScale * 0.5 - 1.755,
    -carBounds.z * carScale - 5.4
);
carModel.node.rotationY = -16;
for (const mesh of carModel.meshes) {
    mesh.pointerEnabled = false;
    mesh.frustumTest = false;
}
carModel.node.addTo(stage);

const controls = new Hilo3d.OrbitControls(stage, {
    camera,
    target: new Hilo3d.Vector3(0.15, -0.85, -5.35),
    enablePan: false,
    enableZoom: false,
    minDistance: 12.5,
    maxDistance: 18,
    minPolarAngle: Math.PI * 0.34,
    maxPolarAngle: Math.PI * 0.495,
    rotateSpeed: 0.42,
    zoomSpeed: 0.68
});
const heroView = new Hilo3d.Vector3(10.8, 2.15, 6.55);
const heroTarget = new Hilo3d.Vector3(0.15, -0.85, -5.35);
controls.setView(heroView, heroTarget);

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);

async function stepFrames(frameCount: number): Promise<void> {
    ticker.stop();
    for (let frame = 0; frame < frameCount; frame += 1) {
        stage.tick(1000 / 60);
        await stage.renderer.waitForIdle();
    }
}

function toggleReflections(): void {
    const nextUrl = new URL(location.href);
    if (reflectionsEnabled) nextUrl.searchParams.set('ssr', 'false');
    else nextUrl.searchParams.delete('ssr');
    location.assign(nextUrl);
}

ssrToggle.setAttribute('aria-pressed', String(reflectionsEnabled));
ssrToggleLabel.textContent = reflectionsEnabled ? 'SSR on' : 'SSR off';
ssrToggle.addEventListener('click', toggleReflections);

const resize = (): void => {
    camera.aspect = innerWidth / Math.max(innerHeight, 1);
    camera.fov = cameraFieldOfView(camera.aspect);
    stage.resize(innerWidth, innerHeight, renderPixelRatio(innerWidth, innerHeight));
};
window.addEventListener('resize', resize);

document.body.dataset['ssrPhase'] = 'warming-history';
await stepFrames(reflectionsEnabled ? 20 : 4);
const diagnostics = await factory.readDiagnostics();
window.__HILO3D_SSR_PALACE_RESULT__ = {
    backend: 'webgpu',
    objectCount: diagnostics.objectCount,
    fallbackObjectCount: diagnostics.fallbackObjectCount,
    visibleObjectCount: diagnostics.visibleObjectCount,
    hiZValid: diagnostics.hiZValid,
    activeTileCount: diagnostics.screenSpaceReflectionActiveTileCount,
    activePixelCount: diagnostics.screenSpaceReflectionActivePixelCount,
    hitPixelCount: diagnostics.screenSpaceReflectionHitPixelCount,
    missPixelCount: diagnostics.screenSpaceReflectionMissPixelCount,
    uncertainPixelCount: diagnostics.screenSpaceReflectionUncertainPixelCount,
    backfaceRejectedPixelCount: diagnostics.screenSpaceReflectionBackfaceRejectedPixelCount,
    historyAcceptedPixelCount: diagnostics.screenSpaceReflectionHistoryAcceptedPixelCount,
    historyRejectedPixelCount: diagnostics.screenSpaceReflectionHistoryRejectedPixelCount,
    resolutionScale: 0.5,
    screenSpaceReflections: reflectionsEnabled,
    temporalAA: true,
    surfaceFinish: 'smoked lacquer',
    heroAsset: 'Khronos Car Concept'
};
window.__HILO3D_SSR_PALACE_TEST_API__ = {
    async settle(frames = 8): Promise<void> {
        await stepFrames(frames);
    },
    async moveCamera(): Promise<void> {
        controls.setView(new Hilo3d.Vector3(9.35, 1.08, 5.05), heroTarget);
        await stepFrames(1);
    },
    async setGrazingCamera(): Promise<void> {
        controls.setView(new Hilo3d.Vector3(9.85, -0.49, 5.45), heroTarget);
        await stepFrames(1);
    },
    async moveHero(deltaX = 0.32): Promise<void> {
        carModel.node.x += deltaX;
        await stepFrames(1);
    },
    async setFloorRoughness(value: number): Promise<number> {
        floorMaterial.roughness = value;
        await stepFrames(2);
        return (await factory.readDiagnostics()).screenSpaceReflectionActivePixelCount;
    }
};
statusLabel.textContent = reflectionsEnabled
    ? 'reflection history stable'
    : 'environment reflections only';
document.body.dataset['ssrReady'] = 'true';
document.body.dataset['ssrPhase'] = 'ready';
if (!testMode) ticker.start();

window.addEventListener(
    'pagehide',
    () => {
        window.removeEventListener('resize', resize);
        ticker.stop();
        controls.dispose();
        stage.destroy();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_SSR_PALACE_RESULT__?: ReflectionPalaceEvidence;
        __HILO3D_SSR_PALACE_TEST_API__?: {
            settle(frames?: number): Promise<void>;
            moveCamera(): Promise<void>;
            setGrazingCamera(): Promise<void>;
            moveHero(deltaX?: number): Promise<void>;
            setFloorRoughness(value: number): Promise<number>;
        };
    }
}
