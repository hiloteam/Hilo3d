import * as Hilo3d from '../src/Hilo3d';
import { buildUrl, resolveExampleBackend } from './shared/init';
import { createStudioEnvironmentMaps } from './shared/studioEnvironment';

interface ChapelEvidence {
    readonly backend: Hilo3d.RendererBackend;
    readonly screenSpaceGlobalIllumination: boolean;
    readonly rayCount: 12;
    readonly denoisePasses: 3;
    readonly drawCount: number;
}

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const ssgiEnabled = search.get('ssgi') !== 'false';
const backend = resolveExampleBackend();
const initialWidth = innerWidth;
const initialHeight = innerHeight;

function requireElement<ElementType extends HTMLElement>(
    selector: string,
    constructor: new () => ElementType
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof constructor))
        throw new Error(`Prismatic Vespers is missing ${selector}`);
    return element;
}

const container = requireElement('#container', HTMLElement);
const toggle = requireElement('#ssgiToggle', HTMLButtonElement);
const toggleLabel = requireElement('#ssgiToggleLabel', HTMLElement);
const backendLabel = requireElement('#backendLabel', HTMLElement);
const { diffuseEnvMap, specularEnvMap } = createStudioEnvironmentMaps();

const pipeline = new Hilo3d.PostProcessRenderPipelineFactory({
    groundTruthAmbientOcclusion: {
        resolutionScale: 0.5,
        radius: 2.8,
        thickness: 0.08,
        directionCount: 8,
        stepCount: 5,
        power: 1.08,
        historyWeight: 0.9
    },
    screenSpaceGlobalIllumination: ssgiEnabled
        ? {
              resolutionScale: 0.5,
              rayCount: 12,
              stepCount: 10,
              maxRayDistance: 5.2,
              thickness: 0.22,
              distanceFadeStart: 0.76,
              intensity: 1.85,
              saturation: 1.42,
              maxRadiance: 7,
              historyWeight: 0.93,
              depthThreshold: 0.024,
              normalThreshold: 0.8,
              denoisePasses: 3
          }
        : false,
    temporalAA: {
        renderScale: 1,
        historyWeight: 0.9,
        depthThreshold: 0.02,
        varianceGamma: 1.2,
        sharpness: 0.05
    },
    bloom: {
        threshold: 1.05,
        knee: 0.5,
        intensity: 0.28,
        scatter: 0.68,
        maxLevels: 6,
        minResolution: 12
    },
    colorUber: {
        toneMapping: 'pbr-neutral',
        exposure: -0.28,
        contrast: 1.1,
        saturation: 0.96,
        temperature: -0.035,
        tint: 0.018,
        vignetteIntensity: 0.42,
        vignetteSmoothness: 0.66,
        dithering: true
    },
    opaqueTexture: true
});

const camera = new Hilo3d.PerspectiveCamera({
    aspect: initialWidth / Math.max(initialHeight, 1),
    fov: 43,
    near: 0.08,
    far: 80,
    depthMode: 'reversed'
});

document.body.dataset['ssgiPhase'] = 'creating-stage';
const stage = await Hilo3d.Stage.create({
    backend,
    container,
    camera,
    width: initialWidth,
    height: initialHeight,
    pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
    antialias: false,
    alpha: false,
    clearColor: new Hilo3d.Color(0.003, 0.005, 0.009),
    renderPipeline: pipeline
});

type MaterialOptions = ConstructorParameters<typeof Hilo3d.PBRMaterial>[0];

function material(options: MaterialOptions): Hilo3d.PBRMaterial {
    return new Hilo3d.PBRMaterial({
        diffuseEnvMap,
        specularEnvMap,
        ...options
    });
}

const ivory = material({
    baseColor: new Hilo3d.Color(0.36, 0.33, 0.28),
    metallic: 0.02,
    roughness: 0.72
});
const chalk = material({
    baseColor: new Hilo3d.Color(0.54, 0.49, 0.41),
    metallic: 0,
    roughness: 0.84
});
const charcoal = material({
    baseColor: new Hilo3d.Color(0.018, 0.023, 0.032),
    metallic: 0.18,
    roughness: 0.48
});
const bronze = material({
    baseColor: new Hilo3d.Color(0.31, 0.16, 0.075),
    metallic: 0.88,
    roughness: 0.26
});
const obsidian = material({
    baseColor: new Hilo3d.Color(0.012, 0.018, 0.024),
    metallic: 0.72,
    roughness: 0.14
});
const cyanGlass = material({
    baseColor: new Hilo3d.Color(0.025, 0.5, 0.72),
    metallic: 0.08,
    roughness: 0.22,
    emission: new Hilo3d.Color(0.04, 0.72, 1),
    emissionFactor: new Hilo3d.Color(0.15, 4.8, 7.5)
});
const vermilionGlass = material({
    baseColor: new Hilo3d.Color(0.78, 0.075, 0.035),
    metallic: 0.04,
    roughness: 0.25,
    emission: new Hilo3d.Color(1, 0.12, 0.035),
    emissionFactor: new Hilo3d.Color(7.8, 0.38, 0.08)
});
const violetGlass = material({
    baseColor: new Hilo3d.Color(0.42, 0.055, 0.68),
    metallic: 0.08,
    roughness: 0.23,
    emission: new Hilo3d.Color(0.62, 0.06, 1),
    emissionFactor: new Hilo3d.Color(3.2, 0.18, 7.2)
});
const warmLight = material({
    baseColor: new Hilo3d.Color(0.94, 0.64, 0.26),
    metallic: 0,
    roughness: 0.35,
    emission: new Hilo3d.Color(1, 0.5, 0.12),
    emissionFactor: new Hilo3d.Color(5.8, 1.6, 0.22)
});
const ceilingLight = material({
    baseColor: new Hilo3d.Color(0.72, 0.51, 0.26),
    metallic: 0,
    roughness: 0.42,
    emission: new Hilo3d.Color(1, 0.54, 0.2),
    emissionFactor: new Hilo3d.Color(0.62, 0.24, 0.06)
});

function box(
    width: number,
    height: number,
    depth: number,
    selectedMaterial: Hilo3d.MaterialInstance,
    x: number,
    y: number,
    z: number,
    rotationY = 0,
    rotationZ = 0
): Hilo3d.Mesh {
    return new Hilo3d.Mesh({
        geometry: new Hilo3d.BoxGeometry({ width, height, depth }),
        material: selectedMaterial,
        x,
        y,
        z,
        rotationY,
        rotationZ,
        pointerEnabled: false,
        frustumTest: true
    }).addTo(stage);
}

document.body.dataset['ssgiPhase'] = 'building-chapel';

// Processional floor, stepped sanctuary and deep architectural shell.
box(12.4, 0.28, 22, charcoal, 0, -0.22, -1.5);
box(5.2, 0.12, 19.5, chalk, 0, -0.03, -1.5);
box(5.8, 0.35, 3.4, ivory, 0, 0.05, -8.1);
box(4.5, 0.36, 2.6, chalk, 0, 0.38, -8.45);
box(11.8, 6.2, 0.34, charcoal, 0, 2.75, -10.15);
box(0.28, 5.8, 20, charcoal, -6.05, 2.55, -1.4);
box(0.28, 5.8, 20, charcoal, 6.05, 2.55, -1.4);

// Repeated nave piers and overhead ribs establish a long cinematic perspective.
for (let bay = 0; bay < 6; bay += 1) {
    const z = 4.8 - bay * 2.65;
    for (const side of [-1, 1] as const) {
        box(0.58, 4.7, 0.72, ivory, side * 4.72, 2.15, z);
        box(0.94, 0.25, 1.08, chalk, side * 4.72, 0.12, z);
        box(0.82, 0.18, 0.92, bronze, side * 4.72, 4.42, z);
        box(0.1, 2.7, 0.96, bronze, side * 4.38, 2.34, z);
    }
    box(9.8, 0.16, 0.22, bronze, 0, 4.75, z);
    box(7.8, 0.12, 0.16, ceilingLight, 0, 4.61, z - 0.04);
}

// Alternating stained-light apertures are the radiance sources SSGI transports into the nave.
const leftPalette = [vermilionGlass, violetGlass, vermilionGlass, warmLight] as const;
const rightPalette = [cyanGlass, cyanGlass, violetGlass, cyanGlass] as const;
for (let bay = 0; bay < 4; bay += 1) {
    const z = 3.45 - bay * 3.25;
    const left = leftPalette[bay];
    const right = rightPalette[bay];
    if (left === undefined || right === undefined) throw new Error('Chapel palette is incomplete');
    box(0.16, 2.55, 1.34, left, -5.72, 2.38, z);
    box(0.16, 2.55, 1.34, right, 5.72, 2.38, z);
    box(0.1, 2.82, 1.58, bronze, -5.84, 2.38, z);
    box(0.1, 2.82, 1.58, bronze, 5.84, 2.38, z);
}

// Low pale benches deliberately expose long red/cyan bounce gradients.
for (let row = 0; row < 5; row += 1) {
    const z = 4.15 - row * 2.25;
    for (const side of [-1, 1] as const) {
        box(1.72, 0.2, 0.64, ivory, side * 2.78, 0.42, z);
        box(0.18, 0.7, 0.54, bronze, side * 3.48, 0.12, z);
        box(0.18, 0.7, 0.54, bronze, side * 2.08, 0.12, z);
    }
}

// A graphic halo and sculptural reliquary anchor the apse.
const haloCenterY = 2.42;
const haloCenterZ = -8.55;
for (let segment = 0; segment < 30; segment += 1) {
    const angle = (segment / 30) * Math.PI * 2;
    const degrees = (angle * 180) / Math.PI;
    box(
        0.13,
        0.48,
        0.12,
        segment % 3 === 0 ? warmLight : bronze,
        Math.cos(angle) * 1.66,
        haloCenterY + Math.sin(angle) * 1.66,
        haloCenterZ,
        0,
        -degrees
    );
}

new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.92, widthSegments: 48, heightSegments: 28 }),
    material: obsidian,
    x: 0,
    y: 2.34,
    z: -8.25,
    pointerEnabled: false
}).addTo(stage);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.47, widthSegments: 40, heightSegments: 24 }),
    material: chalk,
    x: -0.22,
    y: 2.62,
    z: -7.45,
    pointerEnabled: false
}).addTo(stage);
box(0.36, 2.35, 0.36, bronze, 0, 1.1, -8.2, 0, 18);

// Foreground forms make the colored indirect light legible at thumbnail scale.
box(0.9, 2.8, 0.9, chalk, 3.65, 1.2, 5.1, -13);
box(1.15, 0.28, 1.15, bronze, 3.65, -0.01, 5.1, -13);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.64, widthSegments: 36, heightSegments: 22 }),
    material: obsidian,
    x: -3.65,
    y: 0.72,
    z: 4.3,
    pointerEnabled: false
}).addTo(stage);

new Hilo3d.AmbientLight({
    color: new Hilo3d.Color(0.22, 0.25, 0.31),
    amount: 0.13
}).addTo(stage);
new Hilo3d.DirectionalLight({
    color: new Hilo3d.Color(0.92, 0.82, 0.7),
    amount: 0.88,
    direction: new Hilo3d.Vector3(-0.48, -1, -0.22)
}).addTo(stage);

const lightPlan = [
    [-4.95, 2.2, 2.9, 1, 0.12, 0.04],
    [-4.95, 2.2, -3.6, 0.8, 0.08, 1],
    [4.95, 2.2, 1.2, 0.04, 0.7, 1],
    [4.95, 2.2, -5.2, 0.12, 0.36, 1]
] as const;
for (const [x, y, z, red, green, blue] of lightPlan) {
    new Hilo3d.PointLight({
        x,
        y,
        z,
        color: new Hilo3d.Color(red, green, blue),
        amount: 1.05,
        range: 4.8
    }).addTo(stage);
}

const controls = new Hilo3d.OrbitControls(stage, {
    camera,
    target: new Hilo3d.Vector3(0, 1.62, -3.25),
    enablePan: false,
    minDistance: 6,
    maxDistance: 22,
    minPolarAngle: Math.PI * 0.24,
    maxPolarAngle: Math.PI * 0.67,
    rotateSpeed: 0.55,
    zoomSpeed: 0.75
});
const heroView = new Hilo3d.Vector3(3.45, 3.25, 11.8);
const heroTarget = new Hilo3d.Vector3(-0.35, 1.72, -4.1);
controls.setView(heroView, heroTarget);

toggle.setAttribute('aria-pressed', String(ssgiEnabled));
toggleLabel.textContent = ssgiEnabled ? 'SSGI on' : 'SSGI off';
backendLabel.textContent = backend === 'webgpu' ? 'WebGPU' : 'WebGL 2';
toggle.addEventListener('click', () => {
    location.href = buildUrl(location.href, { ssgi: ssgiEnabled ? false : true });
});

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(stage);

async function settle(frameCount = 10): Promise<void> {
    ticker.stop();
    for (let frame = 0; frame < frameCount; frame += 1) {
        stage.tick(1000 / 60);
        await stage.renderer.waitForIdle();
    }
}

const resize = (): void => {
    if (testMode) return;
    camera.aspect = innerWidth / Math.max(innerHeight, 1);
    stage.resize(innerWidth, innerHeight, Math.min(devicePixelRatio, 1.5));
};
window.addEventListener('resize', resize);

document.body.dataset['ssgiPhase'] = 'warming-history';
await settle(testMode ? 8 : 5);
window.__HILO3D_SSGI_CHAPEL_RESULT__ = {
    backend,
    screenSpaceGlobalIllumination: ssgiEnabled,
    rayCount: 12,
    denoisePasses: 3,
    drawCount: stage.renderer.renderInfo.drawCount
};
window.__HILO3D_SSGI_CHAPEL_TEST_API__ = { settle };
document.body.dataset['ssgiPhase'] = 'ready';
if (!testMode) ticker.start();

declare global {
    interface Window {
        __HILO3D_SSGI_CHAPEL_RESULT__?: ChapelEvidence;
        __HILO3D_SSGI_CHAPEL_TEST_API__?: {
            settle(frameCount?: number): Promise<void>;
        };
    }
}
