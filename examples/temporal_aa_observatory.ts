import * as Hilo3d from '../src/Hilo3d';

interface OrbitalBody {
    readonly mesh: Hilo3d.Mesh;
    readonly radius: number;
    readonly height: number;
    readonly phase: number;
    readonly speed: number;
}

interface TemporalObservatoryEvidence {
    readonly backend: 'webgpu';
    readonly objectCount: number;
    readonly fallbackObjectCount: number;
    readonly visibleObjectCount: number;
    readonly hiZValid: boolean;
    readonly temporalAA: true;
    readonly renderScale: 0.75;
    readonly dynamicResolution: boolean;
    readonly smoothedGPUFrameTimeMs: number | null;
}

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const dynamicResolution = search.get('dynamic') === '1';
const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (element === null) throw new Error(`Temporal Observatory is missing ${selector}`);
    return element;
}
const container = requireElement('#container');
const motionToggle = requireElement('#motionToggle');
const cutButton = requireElement('#cutButton');
const statusLabel = requireElement('#statusLabel');

const orbGeometry = new Hilo3d.SphereGeometry({
    radius: 0.22,
    widthSegments: 20,
    heightSegments: 12
});
const orbLOD = new Hilo3d.SphereGeometry({
    radius: 0.22,
    widthSegments: 10,
    heightSegments: 6
});
const signalGeometry = new Hilo3d.BoxGeometry({ width: 0.055, height: 1.45, depth: 0.055 });
const cyan = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.06, 0.5, 0.88),
    metallic: 0.45,
    roughness: 0.19,
    emission: new Hilo3d.Color(0.01, 0.12, 0.28),
    emissionFactor: new Hilo3d.Color(0.04, 0.3, 1)
});
const violet = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.38, 0.09, 0.72),
    metallic: 0.35,
    roughness: 0.22,
    emission: new Hilo3d.Color(0.14, 0.015, 0.26),
    emissionFactor: new Hilo3d.Color(0.65, 0.04, 0.9)
});
const gold = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.82, 0.39, 0.07),
    metallic: 0.65,
    roughness: 0.2,
    emission: new Hilo3d.Color(0.25, 0.07, 0.005),
    emissionFactor: new Hilo3d.Color(1.2, 0.28, 0.015)
});
const signalMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.48, 0.7, 0.92),
    metallic: 0.88,
    roughness: 0.14,
    emission: new Hilo3d.Color(0.01, 0.08, 0.13),
    emissionFactor: new Hilo3d.Color(0.05, 0.35, 0.75),
    temporalReactiveFactor: 0.85
});
const orbMaterials = [cyan, violet, gold] as const;
const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
    buckets: [
        ...orbMaterials.map(material => ({
            geometry: orbGeometry,
            material,
            lods: [{ geometry: orbLOD, maximumProjectedRadius: 12 }]
        })),
        { geometry: signalGeometry, material: signalMaterial }
    ],
    maxObjects: testMode ? 128 : 160,
    maxLights: testMode ? 16 : 24,
    maxLightIndices: testMode ? 8_192 : 262_144,
    maxLightsPerCluster: 48,
    tileSize: 24,
    zSlices: 24,
    maxViewportWidth: testMode ? 640 : 2560,
    maxViewportHeight: testMode ? 360 : 1440,
    hiZ: true,
    bloomStrength: 0.45,
    exposure: 1,
    temporalAA: {
        renderScale: 0.75,
        ...(dynamicResolution
            ? {
                  dynamicResolution: {
                      minScale: 0.75,
                      maxScale: 0.75,
                      targetFrameTimeMs: 16.667
                  }
              }
            : {}),
        historyWeight: 0.92,
        depthThreshold: 0.02,
        varianceGamma: 1.25,
        sharpness: 0.08
    }
});

const initialWidth = testMode ? 640 : innerWidth;
const initialHeight = testMode ? 360 : innerHeight;
const camera = new Hilo3d.PerspectiveCamera({
    aspect: initialWidth / Math.max(initialHeight, 1),
    fov: 42,
    near: 0.05,
    far: 80,
    depthMode: 'reversed'
});
document.body.dataset['temporalPhase'] = 'creating-stage';
const stage = await Hilo3d.Stage.create<'webgpu'>({
    backend: 'webgpu',
    container,
    camera,
    width: initialWidth,
    height: initialHeight,
    pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
    antialias: false,
    alpha: false,
    clearColor: new Hilo3d.Color(0.0015, 0.003, 0.009),
    renderingProfile: 'high-end',
    renderPipeline: factory
});
document.body.dataset['temporalPhase'] = 'building-scene';

new Hilo3d.AmbientLight({
    amount: 0.36,
    color: new Hilo3d.Color(0.38, 0.3, 0.46)
}).addTo(stage);
new Hilo3d.DirectionalLight({
    amount: 1.8,
    color: new Hilo3d.Color(0.95, 0.8, 0.65),
    direction: new Hilo3d.Vector3(-0.55, -0.82, -0.28)
}).addTo(stage);

const lightColors = [
    new Hilo3d.Color(0.12, 0.62, 1),
    new Hilo3d.Color(0.78, 0.16, 1),
    new Hilo3d.Color(1, 0.36, 0.08)
] as const;
const movingLights: Hilo3d.PointLight[] = [];
for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2;
    const color = lightColors[index % lightColors.length];
    if (color === undefined) throw new Error('Temporal light palette is incomplete');
    movingLights.push(
        new Hilo3d.PointLight({
            amount: 3.6,
            range: 7,
            color,
            x: Math.cos(angle) * 3.2,
            y: Math.sin(angle * 2) * 0.9,
            z: Math.sin(angle) * 3.2
        }).addTo(stage)
    );
}

const orbitals: OrbitalBody[] = [];
for (let index = 0; index < 72; index += 1) {
    const band = index % 4;
    const phase = (index / 72) * Math.PI * 2 + band * 0.43;
    const material = orbMaterials[index % orbMaterials.length];
    if (material === undefined) throw new Error('Temporal material palette is incomplete');
    const mesh = new Hilo3d.Mesh({
        geometry: orbGeometry,
        material,
        frustumTest: true,
        pointerEnabled: false
    }).addTo(stage);
    mesh.setScale(0.62 + (index % 7) * 0.065);
    orbitals.push({
        mesh,
        radius: 1.45 + band * 0.78,
        height: (band - 1.5) * 0.72,
        phase,
        speed: 0.12 + band * 0.025 + (index % 5) * 0.004
    });
}

const signals: Hilo3d.Mesh[] = [];
for (let index = 0; index < 28; index += 1) {
    const angle = (index / 28) * Math.PI * 2;
    const signal = new Hilo3d.Mesh({
        geometry: signalGeometry,
        material: signalMaterial,
        x: Math.cos(angle) * 2.85,
        y: Math.sin(angle * 3) * 0.7,
        z: Math.sin(angle) * 2.85,
        rotationX: 18 + (index % 5) * 13,
        rotationZ: 90 + (index / 28) * 180,
        pointerEnabled: false
    }).addTo(stage);
    signals.push(signal);
}

const floor = new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 18, height: 18 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.008, 0.015, 0.035),
        metallic: 0.78,
        roughness: 0.24
    }),
    y: -2.15,
    rotationX: -90,
    pointerEnabled: false
}).addTo(stage);
floor.receiveShadows = false;

new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.72, widthSegments: 36, heightSegments: 22 }),
    material: new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.22, 0.35, 0.62, 0.64),
        metallic: 0.04,
        roughness: 0.08,
        transmissionFactor: 0.78,
        thicknessFactor: 1.4,
        attenuationDistance: 3.5,
        attenuationColor: new Hilo3d.Color(0.14, 0.5, 0.9),
        ior: 1.42
    }),
    y: 0.05,
    pointerEnabled: false,
    frustumTest: false
}).addTo(stage);

const controls = new Hilo3d.OrbitControls(stage, {
    camera,
    target: new Hilo3d.Vector3(0, -0.05, 0),
    enablePan: false,
    minDistance: 5.2,
    maxDistance: 12,
    minPolarAngle: Math.PI * 0.25,
    maxPolarAngle: Math.PI * 0.72,
    rotateSpeed: 0.62,
    zoomSpeed: 0.8
});
const heroView = new Hilo3d.Vector3(6.8, 3.2, 8.4);
const cutView = new Hilo3d.Vector3(-7.4, 2.15, 6.1);
const viewTarget = new Hilo3d.Vector3(0, -0.05, 0);
controls.setView(heroView, viewTarget);

let time = 0;
let motionEnabled = search.get('motion') !== 'false' && !prefersReducedMotion;
let alternateView = false;

function updateScene(deltaMilliseconds: number): void {
    if (motionEnabled) time += Math.min(deltaMilliseconds, 50) * 0.001;
    for (const orbital of orbitals) {
        const angle = orbital.phase + time * orbital.speed * Math.PI * 2;
        orbital.mesh.setPosition(
            Math.cos(angle) * orbital.radius,
            orbital.height + Math.sin(angle * 2.7) * 0.42,
            Math.sin(angle) * orbital.radius
        );
        orbital.mesh.rotationY = (angle * 180) / Math.PI;
    }
    for (let index = 0; index < signals.length; index += 1) {
        const signal = signals[index];
        if (signal === undefined) continue;
        signal.rotationY = time * 34 + index * 12;
        signal.rotationZ = 90 + Math.sin(time * 0.9 + index) * 34;
    }
    for (let index = 0; index < movingLights.length; index += 1) {
        const light = movingLights[index];
        if (light === undefined) continue;
        const angle = (index / movingLights.length) * Math.PI * 2 - time * 0.16;
        light.setPosition(
            Math.cos(angle) * 3.15,
            Math.sin(angle * 2.2) * 0.85,
            Math.sin(angle) * 3.15
        );
    }
}

const ticker = new Hilo3d.Ticker(60);
const simulation: Hilo3d.Tickable = { tick: updateScene };
ticker.addTick(simulation);
ticker.addTick(stage);

function setMotion(value: boolean): void {
    motionEnabled = value;
    motionToggle.setAttribute('aria-pressed', String(value));
    motionToggle.textContent = value ? 'pause orbit' : 'resume orbit';
    document.body.dataset['motion'] = String(value);
}

function applyCameraCut(): void {
    alternateView = !alternateView;
    controls.setView(alternateView ? cutView : heroView, viewTarget);
    camera.invalidateTransformHistory();
    statusLabel.textContent = 'history reset · camera cut';
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

motionToggle.addEventListener('click', () => {
    setMotion(!motionEnabled);
});
cutButton.addEventListener('click', applyCameraCut);
window.addEventListener('keydown', event => {
    if (event.code === 'Space') {
        event.preventDefault();
        setMotion(!motionEnabled);
    }
});

const resize = (): void => {
    if (testMode) return;
    camera.aspect = innerWidth / Math.max(innerHeight, 1);
    stage.resize(innerWidth, innerHeight, Math.min(devicePixelRatio, 1.5));
};
window.addEventListener('resize', resize);

setMotion(motionEnabled);
updateScene(0);
document.body.dataset['temporalPhase'] = 'warming-history';
await stepFrames(3, false);
let diagnostics = await factory.readDiagnostics();
for (
    let attempt = 0;
    dynamicResolution && diagnostics.smoothedGPUFrameTimeMs === null && attempt < 12;
    attempt += 1
) {
    await stepFrames(1, false);
    diagnostics = await factory.readDiagnostics();
}
if (dynamicResolution && diagnostics.smoothedGPUFrameTimeMs === null) {
    throw new Error('Temporal Observatory did not receive a ready GPU timestamp sample');
}
window.__HILO3D_TEMPORAL_OBSERVATORY_RESULT__ = {
    backend: 'webgpu',
    objectCount: diagnostics.objectCount,
    fallbackObjectCount: diagnostics.fallbackObjectCount,
    visibleObjectCount: diagnostics.visibleObjectCount,
    hiZValid: diagnostics.hiZValid,
    temporalAA: true,
    renderScale: 0.75,
    dynamicResolution,
    smoothedGPUFrameTimeMs: diagnostics.smoothedGPUFrameTimeMs
};
window.__HILO3D_TEMPORAL_OBSERVATORY_TEST_API__ = {
    async settle(frames = 8): Promise<void> {
        await stepFrames(frames, false);
    },
    async cutAndSettle(frames = 1): Promise<void> {
        applyCameraCut();
        await stepFrames(frames, false);
    },
    async teleportAndSettle(frames = 1): Promise<void> {
        const signal = signals[0];
        if (signal === undefined) throw new Error('Temporal test signal is unavailable');
        signal.x *= -1;
        signal.z *= -1;
        signal.invalidateTransformHistory();
        await stepFrames(frames, false);
    }
};
statusLabel.textContent = `${String(diagnostics.visibleObjectCount)} signals · history stable`;
document.body.dataset['temporalReady'] = 'true';
document.body.dataset['temporalPhase'] = 'ready';
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
        __HILO3D_TEMPORAL_OBSERVATORY_RESULT__?: TemporalObservatoryEvidence;
        __HILO3D_TEMPORAL_OBSERVATORY_TEST_API__?: {
            settle(frames?: number): Promise<void>;
            cutAndSettle(frames?: number): Promise<void>;
            teleportAndSettle(frames?: number): Promise<void>;
        };
    }
}
