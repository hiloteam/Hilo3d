import * as Hilo3d from '../src/Hilo3d';
import { loadDefaultEnvironmentMaps } from './shared/defaultEnvironment';

interface ReflectionPalaceEvidence {
    readonly backend: 'webgpu';
    readonly objectCount: number;
    readonly fallbackObjectCount: number;
    readonly visibleObjectCount: number;
    readonly hiZValid: boolean;
    readonly screenSpaceReflections: boolean;
    readonly temporalAA: true;
    readonly roughnessTiers: 3;
    readonly heroAsset: 'Khronos Car Concept';
}

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const reflectionsEnabled = search.get('ssr') !== 'false';
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) throw new Error(`Nocturne Pavilion is missing ${selector}`);
    return element;
}

const container = requireElement('#container');
const ssrToggle = requireElement('#ssrToggle');
const ssrToggleLabel = requireElement('#ssrToggleLabel');
const motionToggle = requireElement('#motionToggle');
const statusLabel = requireElement('#statusLabel');

const gold = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.72, 0.38, 0.12),
    metallic: 0.92,
    roughness: 0.2
});
const obsidian = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.008, 0.01, 0.018),
    metallic: 0.84,
    roughness: 0.16
});
const cyanLight = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.02, 0.28, 0.38),
    metallic: 0.25,
    roughness: 0.14,
    emission: new Hilo3d.Color(0.01, 0.26, 0.42),
    emissionFactor: new Hilo3d.Color(0.08, 1.1, 1.8)
});
const magentaLight = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.38, 0.025, 0.18),
    metallic: 0.24,
    roughness: 0.16,
    emission: new Hilo3d.Color(0.38, 0.012, 0.2),
    emissionFactor: new Hilo3d.Color(1.5, 0.05, 0.75)
});
const amberLight = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.52, 0.2, 0.035),
    metallic: 0.36,
    roughness: 0.13,
    emission: new Hilo3d.Color(0.48, 0.16, 0.02),
    emissionFactor: new Hilo3d.Color(1.6, 0.45, 0.04)
});
const mirror = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.045, 0.055, 0.075),
    metallic: 0.94,
    roughness: 0.06
});
const brushed = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.09, 0.075, 0.065),
    metallic: 0.88,
    roughness: 0.3
});
const satin = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.075, 0.055, 0.085),
    metallic: 0.72,
    roughness: 0.58
});

const columnGeometry = new Hilo3d.BoxGeometry({ width: 0.42, height: 5.2, depth: 0.56 });
const beamGeometry = new Hilo3d.BoxGeometry({ width: 11.5, height: 0.34, depth: 0.62 });
const inlayGeometry = new Hilo3d.BoxGeometry({ width: 0.055, height: 4.35, depth: 0.035 });
const haloGeometry = new Hilo3d.BoxGeometry({ width: 0.13, height: 0.72, depth: 0.15 });
const bladeGeometry = new Hilo3d.BoxGeometry({ width: 0.13, height: 2.5, depth: 0.2 });
const plinthGeometry = new Hilo3d.BoxGeometry({ width: 0.72, height: 0.14, depth: 0.84 });
const beaconGeometry = new Hilo3d.BoxGeometry({ width: 0.065, height: 0.88, depth: 0.065 });
const eclipseGeometry = new Hilo3d.SphereGeometry({
    radius: 1.02,
    widthSegments: 40,
    heightSegments: 24
});
const jewelGeometry = new Hilo3d.SphereGeometry({
    radius: 0.2,
    widthSegments: 18,
    heightSegments: 12
});

const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
    buckets: [
        { geometry: columnGeometry, material: gold },
        { geometry: beamGeometry, material: gold },
        { geometry: inlayGeometry, material: cyanLight },
        { geometry: inlayGeometry, material: magentaLight },
        { geometry: haloGeometry, material: amberLight },
        { geometry: bladeGeometry, material: cyanLight },
        { geometry: bladeGeometry, material: magentaLight },
        { geometry: eclipseGeometry, material: obsidian },
        { geometry: jewelGeometry, material: cyanLight },
        { geometry: jewelGeometry, material: magentaLight },
        { geometry: plinthGeometry, material: mirror },
        { geometry: plinthGeometry, material: brushed },
        { geometry: plinthGeometry, material: satin },
        { geometry: beaconGeometry, material: cyanLight },
        { geometry: beaconGeometry, material: magentaLight },
        { geometry: beaconGeometry, material: amberLight }
    ],
    maxObjects: 160,
    maxLights: 24,
    maxLightIndices: 65_536,
    maxLightsPerCluster: 48,
    tileSize: 24,
    zSlices: 24,
    maxViewportWidth: testMode ? 960 : 2560,
    maxViewportHeight: testMode ? 600 : 1440,
    hiZ: true,
    bloomStrength: 0.62,
    exposure: 1.04,
    temporalAA: {
        renderScale: 1,
        historyWeight: 0.9,
        depthThreshold: 0.02,
        varianceGamma: 1.2,
        sharpness: 0.06
    },
    screenSpaceReflections: reflectionsEnabled
        ? {
              resolutionScale: 0.5,
              maxRayDistance: 64,
              thickness: 0.2,
              stride: 0.08,
              maxSteps: 72,
              roughnessCutoff: 0.76,
              edgeFade: 0.07,
              historyWeight: 0.92,
              depthThreshold: 0.025,
              intensity: 1.25
          }
        : false
});

const initialWidth = testMode ? 960 : innerWidth;
const initialHeight = testMode ? 600 : innerHeight;
const camera = new Hilo3d.PerspectiveCamera({
    aspect: initialWidth / Math.max(initialHeight, 1),
    fov: 39,
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
    pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
    antialias: false,
    alpha: false,
    clearColor: new Hilo3d.Color(0.0015, 0.001, 0.004),
    renderingProfile: 'high-end',
    renderPipeline: factory
});
document.body.dataset['ssrPhase'] = 'building-pavilion';

new Hilo3d.AmbientLight({
    amount: 0.28,
    color: new Hilo3d.Color(0.2, 0.24, 0.36)
}).addTo(stage);
new Hilo3d.DirectionalLight({
    amount: 2.8,
    color: new Hilo3d.Color(1, 0.78, 0.6),
    direction: new Hilo3d.Vector3(-0.48, -0.84, -0.26)
}).addTo(stage);

const lightPalette = [
    new Hilo3d.Color(0.08, 0.72, 1),
    new Hilo3d.Color(1, 0.08, 0.48),
    new Hilo3d.Color(1, 0.45, 0.09)
] as const;
const lightPositions = [
    [-3.5, 0.8, 1.2],
    [3.5, 0.8, 1.2],
    [-3.7, 0.9, -3.0],
    [3.7, 0.9, -3.0],
    [0, 1.2, -6.5]
] as const;
for (let index = 0; index < lightPositions.length; index += 1) {
    const position = lightPositions[index];
    const color = lightPalette[index % lightPalette.length];
    if (position === undefined || color === undefined) throw new Error('Light plan is incomplete');
    new Hilo3d.PointLight({
        amount: index === lightPositions.length - 1 ? 5.4 : 3.8,
        range: index === lightPositions.length - 1 ? 10 : 7,
        color,
        x: position[0],
        y: position[1],
        z: position[2]
    }).addTo(stage);
}
new Hilo3d.PointLight({
    amount: 5.8,
    range: 9,
    color: new Hilo3d.Color(0.75, 0.9, 1),
    x: 1.8,
    y: 2.2,
    z: 1.2
}).addTo(stage);
new Hilo3d.PointLight({
    amount: 4.6,
    range: 8,
    color: new Hilo3d.Color(1, 0.28, 0.16),
    x: -2.7,
    y: 0.5,
    z: -1.8
}).addTo(stage);

const archDepths = [-0.9, -4.5, -8.1] as const;
for (const z of archDepths) {
    for (const side of [-1, 1] as const) {
        new Hilo3d.Mesh({
            geometry: columnGeometry,
            material: gold,
            x: side * 5.65,
            y: 0.84,
            z,
            pointerEnabled: false
        }).addTo(stage);
        new Hilo3d.Mesh({
            geometry: inlayGeometry,
            material: side > 0 ? magentaLight : cyanLight,
            x: side * 5.39,
            y: 0.78,
            z: z + 0.3,
            pointerEnabled: false
        }).addTo(stage);
    }
    new Hilo3d.Mesh({
        geometry: beamGeometry,
        material: gold,
        x: 0,
        y: 3.34,
        z,
        pointerEnabled: false
    }).addTo(stage);
}

const floor = new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 22, height: 27 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.004, 0.006, 0.012),
        metallic: 0.96,
        roughness: 0.12
    }),
    y: -1.78,
    z: -2.2,
    rotationX: -90,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);
floor.receiveShadows = false;

statusLabel.textContent = 'loading Khronos Car Concept';
const [{ diffuseEnvMap, specularEnvMap }, brdfLUT] = await Promise.all([
    loadDefaultEnvironmentMaps(),
    new Hilo3d.TextureLoader().load({
        src: new URL('./image/brdfLUT.png', import.meta.url).href,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
    })
]);
const loader = new Hilo3d.GLTFLoader();
const carModel = await loader.load({
    src: new URL('./models/CarConcept/CarConcept.glb', import.meta.url).href,
    ignoreTextureError: false,
    pbrMaterialDefaults: {
        brdfLUT,
        diffuseEnvMap: { texture: diffuseEnvMap, encoding: 'srgb' },
        specularEnvMap: { texture: specularEnvMap, encoding: 'srgb' },
        diffuseEnvIntensity: 0.6,
        specularEnvIntensity: 1.05
    }
});
await carModel.ready;
if (carModel.resourceErrors.length > 0) {
    throw new AggregateError(carModel.resourceErrors, 'Khronos Car Concept has resource failures');
}
const carBounds = carModel.node.getBounds();
if (carBounds === undefined) {
    throw new Error('Khronos Car Concept has no renderable bounds');
}
const carLargestDimension = Math.max(carBounds.width, carBounds.height, carBounds.depth);
if (!Number.isFinite(carLargestDimension) || carLargestDimension <= 0) {
    throw new RangeError('Khronos Car Concept has invalid bounds');
}
const carScale = 8 / carLargestDimension;
carModel.node.setScale(carScale);
carModel.node.setPosition(
    -carBounds.x * carScale + 1.05,
    -carBounds.y * carScale + carBounds.height * carScale * 0.5 - 1.7,
    -carBounds.z * carScale - 2.55
);
carModel.node.rotationY = 168;
for (const mesh of carModel.meshes) {
    mesh.pointerEnabled = false;
    mesh.frustumTest = false;
}
carModel.node.addTo(stage);

new Hilo3d.Mesh({
    geometry: new Hilo3d.BoxGeometry({ width: 12.8, height: 7.2, depth: 0.35 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.006, 0.007, 0.013),
        metallic: 0.2,
        roughness: 0.72
    }),
    y: 0.9,
    z: -10.2,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);

const halo: Hilo3d.Mesh[] = [];
for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    const segment = new Hilo3d.Mesh({
        geometry: haloGeometry,
        material: amberLight,
        x: Math.cos(angle) * 1.78,
        y: 0.38 + Math.sin(angle) * 1.78,
        z: -7.6,
        rotationZ: 90 - (angle * 180) / Math.PI,
        pointerEnabled: false
    }).addTo(stage);
    segment.setScale(0.72 + (index % 4) * 0.09);
    halo.push(segment);
}

const eclipse = new Hilo3d.Mesh({
    geometry: eclipseGeometry,
    material: obsidian,
    y: 0.38,
    z: -7.3,
    pointerEnabled: false
}).addTo(stage);

const bladeRows = [
    { x: -3.45, material: cyanLight, phase: 0 },
    { x: 3.45, material: magentaLight, phase: Math.PI }
] as const;
const blades: Hilo3d.Mesh[] = [];
for (const row of bladeRows) {
    for (let index = 0; index < 5; index += 1) {
        const blade = new Hilo3d.Mesh({
            geometry: bladeGeometry,
            material: row.material,
            x: row.x + (index - 2) * 0.26,
            y: -0.28 + Math.abs(index - 2) * 0.12,
            z: -3.65 + Math.abs(index - 2) * 0.16,
            rotationZ: (index - 2) * 7,
            pointerEnabled: false
        }).addTo(stage);
        blade.setScale(0.58);
        blades.push(blade);
    }
}

const tierMaterials = [mirror, brushed, satin] as const;
const tierLights = [cyanLight, amberLight, magentaLight] as const;
for (let index = 0; index < tierMaterials.length; index += 1) {
    const x = 4.15;
    const z = 0.3 - index * 1.25;
    new Hilo3d.Mesh({
        geometry: plinthGeometry,
        material: tierMaterials[index] ?? mirror,
        x,
        y: -1.63,
        z,
        pointerEnabled: false
    }).addTo(stage);
    new Hilo3d.Mesh({
        geometry: beaconGeometry,
        material: tierLights[index] ?? amberLight,
        x,
        y: -1.27,
        z,
        rotationZ: index === 1 ? 0 : (index - 1) * 9,
        pointerEnabled: false
    }).addTo(stage);
}

const jewels: { readonly mesh: Hilo3d.Mesh; readonly phase: number }[] = [];
for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    jewels.push({
        mesh: new Hilo3d.Mesh({
            geometry: jewelGeometry,
            material: index % 2 === 0 ? cyanLight : magentaLight,
            x: Math.cos(angle) * 2.1,
            y: 0.35 + Math.sin(angle) * 1.05,
            z: -5.4 + Math.sin(angle * 2) * 0.28,
            pointerEnabled: false
        }).addTo(stage),
        phase: angle
    });
}

const controls = new Hilo3d.OrbitControls(stage, {
    camera,
    target: new Hilo3d.Vector3(-0.65, -0.45, -3.2),
    enablePan: false,
    minDistance: 8,
    maxDistance: 20,
    minPolarAngle: Math.PI * 0.31,
    maxPolarAngle: Math.PI * 0.62,
    rotateSpeed: 0.5,
    zoomSpeed: 0.72
});
const heroView = new Hilo3d.Vector3(7.7, 1.42, 7.65);
const heroTarget = new Hilo3d.Vector3(-0.65, -0.5, -2.9);
controls.setView(heroView, heroTarget);

let time = 0;
let motionEnabled = !testMode && !prefersReducedMotion && search.get('motion') !== 'false';

function updateScene(deltaMilliseconds: number): void {
    if (motionEnabled) time += Math.min(deltaMilliseconds, 50) * 0.001;
    eclipse.rotationY = time * 11;
    eclipse.rotationX = Math.sin(time * 0.37) * 8;
    carModel.node.rotationY = 168 + Math.sin(time * 0.22) * 3;
    for (let index = 0; index < halo.length; index += 1) {
        const segment = halo[index];
        if (segment === undefined) continue;
        segment.rotationY = Math.sin(time * 0.5 + index * 0.34) * 16;
    }
    for (const jewel of jewels) {
        const angle = jewel.phase + time * 0.18;
        jewel.mesh.x = Math.cos(angle) * 2.1;
        jewel.mesh.y = 0.35 + Math.sin(angle) * 1.05;
        jewel.mesh.z = -5.4 + Math.sin(angle * 2) * 0.28;
    }
    for (let index = 0; index < blades.length; index += 1) {
        const blade = blades[index];
        if (blade === undefined) continue;
        blade.rotationY = Math.sin(time * 0.42 + index * 0.38) * 24;
    }
}

const ticker = new Hilo3d.Ticker(60);
const simulation: Hilo3d.Tickable = { tick: updateScene };
ticker.addTick(simulation);
ticker.addTick(stage);

function setMotion(value: boolean): void {
    motionEnabled = value;
    motionToggle.setAttribute('aria-pressed', String(value));
    motionToggle.textContent = value ? 'pause sculpture' : 'resume sculpture';
}

async function stepFrames(frameCount: number, advanceMotion = false): Promise<void> {
    ticker.stop();
    const previousMotion = motionEnabled;
    if (!advanceMotion) motionEnabled = false;
    try {
        for (let frame = 0; frame < frameCount; frame += 1) {
            updateScene(1000 / 60);
            stage.tick(1000 / 60);
            await stage.renderer.waitForIdle();
        }
    } finally {
        motionEnabled = previousMotion;
    }
}

function toggleReflections(): void {
    const nextUrl = new URL(location.href);
    if (reflectionsEnabled) nextUrl.searchParams.set('ssr', 'false');
    else nextUrl.searchParams.delete('ssr');
    location.assign(nextUrl);
}

ssrToggle.setAttribute('aria-pressed', String(reflectionsEnabled));
ssrToggleLabel.textContent = reflectionsEnabled ? 'SSR active' : 'SSR disabled';
ssrToggle.addEventListener('click', toggleReflections);
motionToggle.addEventListener('click', () => {
    setMotion(!motionEnabled);
});

const resize = (): void => {
    if (testMode) return;
    camera.aspect = innerWidth / Math.max(innerHeight, 1);
    stage.resize(innerWidth, innerHeight, Math.min(devicePixelRatio, 1.5));
};
window.addEventListener('resize', resize);

setMotion(motionEnabled);
updateScene(0);
document.body.dataset['ssrPhase'] = 'warming-history';
await stepFrames(reflectionsEnabled ? 20 : 4, false);
const diagnostics = await factory.readDiagnostics();
window.__HILO3D_SSR_PALACE_RESULT__ = {
    backend: 'webgpu',
    objectCount: diagnostics.objectCount,
    fallbackObjectCount: diagnostics.fallbackObjectCount,
    visibleObjectCount: diagnostics.visibleObjectCount,
    hiZValid: diagnostics.hiZValid,
    screenSpaceReflections: reflectionsEnabled,
    temporalAA: true,
    roughnessTiers: 3,
    heroAsset: 'Khronos Car Concept'
};
window.__HILO3D_SSR_PALACE_TEST_API__ = {
    async settle(frames = 8): Promise<void> {
        await stepFrames(frames, false);
    },
    async advance(frames = 1): Promise<void> {
        await stepFrames(frames, true);
    }
};
statusLabel.textContent = reflectionsEnabled
    ? `${String(diagnostics.visibleObjectCount)} forms · reflection history stable`
    : `${String(diagnostics.visibleObjectCount)} forms · direct light only`;
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
            advance(frames?: number): Promise<void>;
        };
    }
}
