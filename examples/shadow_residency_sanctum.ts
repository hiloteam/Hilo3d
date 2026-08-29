import * as Hilo3d from '../src/Hilo3d';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../src/render/diagnostics/RendererDiagnosticsRegistry';

interface SanctumEvidence {
    readonly backend: 'webgpu';
    readonly movingCasters: number;
    readonly shadowRequestedPages: number;
    readonly shadowUpdatedPages: number;
    readonly shadowDeferredPages: number;
    readonly shadowResidentPages: number;
    readonly hiddenLayerEnabled: boolean;
    readonly drawCount: number;
}

const TAU = Math.PI * 2;
const DEFAULT_LAYER = 1;
const VEILED_LAYER = 2;
const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

function requireElement<ElementType extends HTMLElement>(
    selector: string,
    constructor: new () => ElementType
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof constructor)) throw new Error(`Umbra Sanctum is missing ${selector}`);
    return element;
}

const container = requireElement('#container', HTMLElement);
const pageMetric = requireElement('#pageMetric', HTMLElement);
const residentMetric = requireElement('#residentMetric', HTMLElement);
const deferredMetric = requireElement('#deferredMetric', HTMLElement);
const backendMetric = requireElement('#backendMetric', HTMLElement);
const motionToggle = requireElement('#motionToggle', HTMLButtonElement);
const motionLabel = requireElement('#motionLabel', HTMLElement);
const veilToggle = requireElement('#veilToggle', HTMLButtonElement);
const veilLabel = requireElement('#veilLabel', HTMLElement);
const viewButton = requireElement('#viewButton', HTMLButtonElement);

const canvas = document.createElement('canvas');
canvas.setAttribute('aria-label', 'Umbra Sanctum WebGPU shadow residency installation');
const rendererDiagnostics = registerRendererDiagnostics(canvas);

const boxGeometry = new Hilo3d.BoxGeometry();
const sphereGeometry = new Hilo3d.SphereGeometry({
    radius: 1,
    widthSegments: testMode ? 20 : 36,
    heightSegments: testMode ? 12 : 22
});

type MaterialOptions = ConstructorParameters<typeof Hilo3d.PBRMaterial>[0];
function material(options: MaterialOptions): Hilo3d.PBRMaterial {
    return new Hilo3d.PBRMaterial(options);
}

const voidStone = material({
    baseColor: new Hilo3d.Color(0.02, 0.026, 0.042),
    metallic: 0.42,
    roughness: 0.28
});
const wetBasalt = material({
    baseColor: new Hilo3d.Color(0.018, 0.026, 0.04),
    metallic: 0.3,
    roughness: 0.4
});
const alabaster = material({
    baseColor: new Hilo3d.Color(0.7, 0.62, 0.51),
    metallic: 0.02,
    roughness: 0.58
});
const oldGold = material({
    baseColor: new Hilo3d.Color(0.62, 0.31, 0.07),
    metallic: 0.84,
    roughness: 0.34,
    emission: new Hilo3d.Color(0.82, 0.16, 0.018),
    emissionFactor: new Hilo3d.Color(0.038, 0.008, 0.001)
});
const lunar = material({
    baseColor: new Hilo3d.Color(0.48, 0.62, 0.82),
    metallic: 0.08,
    roughness: 0.28,
    emission: new Hilo3d.Color(0.22, 0.55, 1),
    emissionFactor: new Hilo3d.Color(0.22, 1.3, 3.9)
});
const roseFire = material({
    baseColor: new Hilo3d.Color(0.68, 0.04, 0.16),
    metallic: 0.12,
    roughness: 0.24,
    emission: new Hilo3d.Color(1, 0.035, 0.18),
    emissionFactor: new Hilo3d.Color(5.8, 0.12, 0.72)
});
const cyanFire = material({
    baseColor: new Hilo3d.Color(0.025, 0.44, 0.55),
    metallic: 0.08,
    roughness: 0.22,
    emission: new Hilo3d.Color(0.025, 0.74, 1),
    emissionFactor: new Hilo3d.Color(0.08, 3.6, 6.2)
});
const materials = [voidStone, wetBasalt, alabaster, oldGold, lunar, roseFire, cyanFire] as const;
const buckets: Hilo3d.GPUSceneBucket[] = [];
for (const geometry of [boxGeometry, sphereGeometry] as const) {
    for (const bucketMaterial of materials) {
        buckets.push(Object.freeze({ geometry, material: bucketMaterial }));
    }
}

const pipeline = new Hilo3d.ClusteredForwardPlusPipelineFactory({
    buckets,
    maxObjects: 256,
    maxLights: 48,
    maxLightIndices: 131_072,
    maxLightsPerCluster: 48,
    tileSize: 32,
    zSlices: 20,
    maxViewportWidth: testMode ? 960 : 2560,
    maxViewportHeight: testMode ? 600 : 1440,
    hiZ: true,
    temporalAA: {
        renderScale: testMode ? 0.6 : 0.94,
        historyWeight: 0.93,
        depthThreshold: 0.022,
        varianceGamma: 1.18,
        sharpness: 0.14
    },
    groundTruthAmbientOcclusion: {
        resolutionScale: testMode ? 0.25 : 0.5,
        radius: 2.5,
        directionCount: testMode ? 4 : 8,
        stepCount: testMode ? 3 : 5,
        power: 1.18
    },
    screenSpaceReflections: {
        resolutionScale: testMode ? 0.5 : 1,
        maxRayDistance: 28,
        thickness: 0.18,
        stride: 0.08,
        maxSteps: testMode ? 32 : 80,
        roughnessCutoff: 0.48,
        edgeFade: 0.16,
        historyWeight: 0.94,
        depthThreshold: 0.032,
        intensity: 0.58
    },
    volumetricLighting: {
        quality: testMode ? 'low' : 'high',
        resolutionScale: testMode ? 0.25 : 0.5,
        shadowSteps: testMode ? 1 : 2,
        density: 0.0054,
        baseHeight: -0.6,
        heightFalloff: 0.065,
        maxDistance: 48,
        albedo: new Hilo3d.Color(0.68, 0.78, 1),
        anisotropy: 0.38,
        ambientStrength: 0.045,
        jitterStrength: 0.62,
        historyWeight: 0.93,
        depthThreshold: 0.038,
        localVolumes: [
            {
                shape: 'box',
                center: new Hilo3d.Vector3(0, 3.4, -3),
                halfExtents: new Hilo3d.Vector3(10, 4.5, 13),
                density: 0.0065,
                edgeFalloff: 0.24,
                albedo: new Hilo3d.Color(0.5, 0.65, 1)
            },
            {
                shape: 'sphere',
                center: new Hilo3d.Vector3(-4.8, 2.8, -4),
                radius: 4.6,
                density: 0.009,
                edgeFalloff: 0.46,
                albedo: new Hilo3d.Color(0.18, 0.78, 1)
            },
            {
                shape: 'sphere',
                center: new Hilo3d.Vector3(5.1, 3.2, -6),
                radius: 4.4,
                density: 0.0085,
                edgeFalloff: 0.44,
                albedo: new Hilo3d.Color(1, 0.14, 0.38)
            }
        ]
    },
    bloomStrength: 0.58,
    exposure: 1.08
});

const width = testMode ? 960 : Math.max(innerWidth, 1);
const height = testMode ? 600 : Math.max(innerHeight, 1);
const camera = new Hilo3d.PerspectiveCamera({
    aspect: width / height,
    fov: 40,
    near: 0.06,
    far: 90,
    depthMode: 'reversed',
    visibility: DEFAULT_LAYER
});

document.body.dataset['sanctumPhase'] = 'creating-stage';
const stage = await Hilo3d.Stage.create<'webgpu'>({
    backend: 'webgpu',
    container,
    canvas,
    camera,
    width,
    height,
    pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
    antialias: false,
    alpha: false,
    clearColor: new Hilo3d.Color(0.0015, 0.002, 0.007),
    useInstanced: true,
    renderingProfile: 'high-end',
    renderPipeline: pipeline
});

function box(
    selectedMaterial: Hilo3d.PBRMaterial,
    position: readonly [number, number, number],
    scale: readonly [number, number, number],
    rotation: readonly [number, number, number] = [0, 0, 0],
    layer = DEFAULT_LAYER
): Hilo3d.Mesh {
    return new Hilo3d.Mesh({
        geometry: boxGeometry,
        material: selectedMaterial,
        x: position[0],
        y: position[1],
        z: position[2],
        scaleX: scale[0],
        scaleY: scale[1],
        scaleZ: scale[2],
        rotationX: rotation[0],
        rotationY: rotation[1],
        rotationZ: rotation[2],
        layer,
        castShadows: true,
        receiveShadows: true,
        pointerEnabled: false
    }).addTo(stage);
}

function sphere(
    selectedMaterial: Hilo3d.PBRMaterial,
    position: readonly [number, number, number],
    radius: number,
    layer = DEFAULT_LAYER
): Hilo3d.Mesh {
    return new Hilo3d.Mesh({
        geometry: sphereGeometry,
        material: selectedMaterial,
        x: position[0],
        y: position[1],
        z: position[2],
        scaleX: radius,
        scaleY: radius,
        scaleZ: radius,
        layer,
        castShadows: true,
        receiveShadows: true,
        pointerEnabled: false
    }).addTo(stage);
}

document.body.dataset['sanctumPhase'] = 'building-installation';
box(wetBasalt, [0, -0.34, -3], [16, 0.42, 27]);
box(voidStone, [0, 0.01, -5.5], [7.8, 0.16, 18]);
box(oldGold, [-1.34, 0.12, -4.5], [0.055, 0.025, 16]);
box(oldGold, [1.34, 0.12, -4.5], [0.055, 0.025, 16]);
for (let step = 0; step < 7; step += 1) {
    box(
        step % 2 === 0 ? alabaster : oldGold,
        [0, 0.12 + step * 0.12, -9.2 - step * 0.68],
        [4.8 - step * 0.32, 0.11, 0.94]
    );
}
for (const side of [-1, 1] as const) {
    for (let bay = 0; bay < 6; bay += 1) {
        const z = 3.5 - bay * 3.55;
        box(voidStone, [side * 8.35, 3.2, z], [0.82, 6.6, 0.92]);
        box(alabaster, [side * 7.2, 2.75, z], [0.32, 5.5, 0.56]);
        box(oldGold, [side * 6.86, 2.82, z], [0.07, 4.65, 0.62]);
    }
}
for (let rib = 0; rib < 6; rib += 1) {
    box(oldGold, [0, 7.35, 3.5 - rib * 3.55], [14.4, 0.09, 0.16]);
}

const haloCenter: readonly [number, number, number] = [0, 3.45, -13.35];
box(oldGold, haloCenter, [0.11, 5.2, 0.13], [0, 0, 45]);
box(oldGold, haloCenter, [0.11, 5.2, 0.13], [0, 0, -45]);
for (let segment = 0; segment < 52; segment += 1) {
    const angle = (segment / 52) * TAU;
    box(
        segment % 6 === 0 ? lunar : oldGold,
        [
            haloCenter[0] + Math.cos(angle) * 3.05,
            haloCenter[1] + Math.sin(angle) * 3.05,
            haloCenter[2]
        ],
        [0.08, segment % 6 === 0 ? 0.42 : 0.28, 0.1],
        [0, 0, -(angle * 180) / Math.PI]
    );
}
sphere(voidStone, [0, 3.45, -13.55], 2.12);
sphere(lunar, [0, 3.45, -11.45], 0.78);
box(oldGold, [0, 1.42, -13.15], [0.34, 2.5, 0.34], [0, 0, 45]);
box(oldGold, [0, 1.42, -13.15], [0.34, 2.5, 0.34], [0, 0, -45]);

for (const side of [-1, 1] as const) {
    for (let lantern = 0; lantern < 3; lantern += 1) {
        const z = -2.5 - lantern * 3.55;
        const x = side * (4.25 - lantern * 0.24);
        sphere(side < 0 ? cyanFire : roseFire, [x, 0.82, z], 0.17);
        box(alabaster, [x, 0.28, z], [0.48, 0.54, 0.48]);
        box(oldGold, [x, 0.6, z], [0.11, 0.36, 0.11]);
    }
}

const movingCasters: Hilo3d.Mesh[] = [];
for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * TAU;
    const caster = box(
        index % 4 === 0 ? lunar : index % 2 === 0 ? alabaster : oldGold,
        [
            haloCenter[0] + Math.cos(angle) * 3.72,
            haloCenter[1] + Math.sin(angle) * 2.72,
            -11.95 + Math.sin(angle * 2) * 0.24
        ],
        [0.19, index % 3 === 0 ? 1.62 : 1.34, 0.34],
        [0, Math.sin(angle) * 12, -(angle * 180) / Math.PI]
    );
    movingCasters.push(caster);
}

// This caster is deliberately outside the active camera layer. Its long, high silhouette is kept
// outside the hero framing while its projected shadow crosses the nave when the veil is enabled.
const veiledCaster = box(voidStone, [-8.9, 7.8, -8], [3.2, 4.8, 1.8], [0, 20, -16], VEILED_LAYER);
veiledCaster.name = 'Veiled layer shadow witness';

// A boundary-crossing blade explicitly disables CPU/GPU frustum tests. Its center sits beyond the
// fitted slice edge while the long geometry still reaches the visible floor.
const unboundedBlade = box(oldGold, [8.85, 5.6, -12], [0.11, 4.8, 0.42], [0, 0, 18]);
unboundedBlade.frustumTest = false;
unboundedBlade.name = 'Unbounded frustum witness';

new Hilo3d.AmbientLight({
    color: new Hilo3d.Color(0.14, 0.22, 0.4),
    amount: 0.3
}).addTo(stage);
new Hilo3d.DirectionalLight({
    color: new Hilo3d.Color(0.72, 0.82, 1),
    amount: 3.9,
    direction: new Hilo3d.Vector3(0.48, -1, 0.26),
    shadow: {
        width: 1024,
        height: 1024,
        minBias: 0.00018,
        maxBias: 0.0024,
        cascadeCount: 4,
        cascadeSplitLambda: 0.62,
        cascadeMaxDistance: 64,
        cascadeBlend: 0.13,
        stabilizeCascades: true,
        shadowStrength: 1.35
    }
}).addTo(stage);

const lightPlan = [
    [-4.6, 3.5, -5.5, 0.03, 0.46, 1, 6.6],
    [4.8, 3.8, -8.5, 1, 0.025, 0.16, 7],
    [0, 4.2, -12, 0.25, 0.38, 1, 7.2]
] as const;
for (const [x, y, z, red, green, blue, amount] of lightPlan) {
    new Hilo3d.PointLight({
        x,
        y,
        z,
        color: new Hilo3d.Color(red, green, blue),
        amount,
        range: 10
    }).addTo(stage);
}

const shadowSpotPlan = [
    [-5.6, 6.8, -1.5, 0.08, 0.62, 1],
    [5.8, 6.4, -10.5, 1, 0.04, 0.22]
] as const;
for (const [x, y, z, red, green, blue] of shadowSpotPlan) {
    new Hilo3d.SpotLight({
        x,
        y,
        z,
        color: new Hilo3d.Color(red, green, blue),
        direction: new Hilo3d.Vector3(-x, 1.1 - y, -7 - z).normalize(),
        amount: 6.2,
        range: 24,
        cutoff: 27,
        outerCutoff: 36,
        shadow: {
            width: 512,
            height: 512,
            minBias: 0.00022,
            maxBias: 0.0032
        }
    }).addTo(stage);
}

const controls = new Hilo3d.OrbitControls(stage, {
    camera,
    target: new Hilo3d.Vector3(0, 2.55, -8.4),
    enablePan: false,
    minDistance: 7,
    maxDistance: 28,
    minPolarAngle: Math.PI * 0.2,
    maxPolarAngle: Math.PI * 0.7,
    rotateSpeed: 0.58,
    zoomSpeed: 0.78
});
const views = [
    {
        position: new Hilo3d.Vector3(2.15, 4.85, 16.8),
        target: new Hilo3d.Vector3(0, 2.65, -9.2)
    },
    {
        position: new Hilo3d.Vector3(-5.2, 4.65, 7.2),
        target: new Hilo3d.Vector3(0, 3.1, -11.2)
    },
    {
        position: new Hilo3d.Vector3(1.2, 8.1, 11.4),
        target: new Hilo3d.Vector3(0, 1.45, -7.2)
    }
] as const;
let viewIndex = 0;
controls.setView(views[0].position, views[0].target);

let elapsed = 0;
let motionEnabled = !reducedMotion;
let veilEnabled = false;
const animation: Hilo3d.Tickable = {
    tick(deltaTime): void {
        if (!motionEnabled) return;
        elapsed += Math.min(deltaTime, 50) / 1000;
        for (let index = 0; index < movingCasters.length; index += 1) {
            const caster = movingCasters[index];
            if (caster === undefined) continue;
            const phase = (index / movingCasters.length) * TAU;
            const orbit = elapsed * (0.1 + (index % 3) * 0.008) + phase;
            caster.x = haloCenter[0] + Math.cos(orbit) * 3.72;
            caster.y = haloCenter[1] + Math.sin(orbit) * 2.72;
            caster.z = -11.95 + Math.sin(orbit * 2) * 0.24;
            caster.rotationX = Math.sin(orbit * 1.7) * 7;
            caster.rotationY = Math.cos(orbit) * 12;
            caster.rotationZ = -(orbit * 180) / Math.PI + Math.sin(elapsed * 0.45 + phase) * 5;
        }
    }
};

const ticker = new Hilo3d.Ticker(60);
ticker.addTick(animation);
ticker.addTick(stage);

function updateControls(): void {
    motionToggle.setAttribute('aria-pressed', String(motionEnabled));
    motionLabel.textContent = motionEnabled ? 'kinetic' : 'held';
    veilToggle.setAttribute('aria-pressed', String(veilEnabled));
    veilLabel.textContent = veilEnabled ? 'revealed' : 'excluded';
}

function updateMetrics(): SanctumEvidence {
    const frame = rendererDiagnostics.snapshot().frame;
    peakRequestedPages = Math.max(peakRequestedPages, frame.shadowRequestedPages);
    peakUpdatedPages = Math.max(peakUpdatedPages, frame.shadowUpdatedPages);
    peakDeferredPages = Math.max(peakDeferredPages, frame.shadowDeferredPages);
    pageMetric.textContent = `${String(peakUpdatedPages)} / ${String(peakRequestedPages)}`;
    residentMetric.textContent = String(frame.shadowResidentPages);
    deferredMetric.textContent = String(peakDeferredPages);
    backendMetric.textContent = stage.renderer.backend.toUpperCase();
    const evidence: SanctumEvidence = {
        backend: 'webgpu',
        movingCasters: movingCasters.length,
        shadowRequestedPages: frame.shadowRequestedPages,
        shadowUpdatedPages: frame.shadowUpdatedPages,
        shadowDeferredPages: frame.shadowDeferredPages,
        shadowResidentPages: frame.shadowResidentPages,
        hiddenLayerEnabled: veilEnabled,
        drawCount: stage.renderer.renderInfo.drawCount
    };
    window.__HILO3D_SHADOW_SANCTUM_RESULT__ = evidence;
    return evidence;
}

let peakRequestedPages = 0;
let peakUpdatedPages = 0;
let peakDeferredPages = 0;
const diagnosticsAnimation: Hilo3d.Tickable = {
    tick(): void {
        updateMetrics();
    }
};
ticker.addTick(diagnosticsAnimation);

async function stepFrames(frameCount: number): Promise<SanctumEvidence> {
    for (let frame = 0; frame < frameCount; frame += 1) {
        if (testMode) animation.tick(1000 / 60);
        stage.tick(1000 / 60);
        await stage.renderer.waitForIdle();
    }
    return updateMetrics();
}

async function setVeil(value: boolean): Promise<SanctumEvidence> {
    veilEnabled = value;
    camera.visibility = value ? DEFAULT_LAYER | VEILED_LAYER : DEFAULT_LAYER;
    updateControls();
    return stepFrames(value ? 4 : 3);
}

motionToggle.addEventListener('click', () => {
    motionEnabled = !motionEnabled;
    updateControls();
});
veilToggle.addEventListener('click', () => void setVeil(!veilEnabled));
viewButton.addEventListener('click', () => {
    viewIndex = (viewIndex + 1) % views.length;
    const view = views[viewIndex];
    if (view === undefined) throw new Error('Umbra Sanctum view archive is incomplete');
    controls.setView(view.position, view.target);
});

const resize = (): void => {
    if (testMode) return;
    const nextWidth = Math.max(innerWidth, 1);
    const nextHeight = Math.max(innerHeight, 1);
    camera.aspect = nextWidth / nextHeight;
    stage.resize(nextWidth, nextHeight, Math.min(devicePixelRatio, 1.5));
};
window.addEventListener('resize', resize);

updateControls();
document.body.dataset['sanctumPhase'] = 'warming-shadow-pages';
await stepFrames(testMode ? 6 : 4);
window.__HILO3D_SHADOW_SANCTUM_TEST_API__ = {
    async settle(frames = 8): Promise<SanctumEvidence> {
        return stepFrames(frames);
    },
    async setMotion(value: boolean): Promise<SanctumEvidence> {
        motionEnabled = value;
        updateControls();
        return stepFrames(2);
    },
    setVeil,
    async nextView(): Promise<SanctumEvidence> {
        viewButton.click();
        return stepFrames(4);
    }
};
document.body.dataset['sanctumReady'] = 'true';
document.body.dataset['sanctumPhase'] = 'ready';
if (!testMode) ticker.start();

window.addEventListener(
    'pagehide',
    () => {
        window.removeEventListener('resize', resize);
        ticker.stop();
        controls.dispose();
        unregisterRendererDiagnostics(canvas, rendererDiagnostics);
        stage.destroy();
    },
    { once: true }
);

declare global {
    interface Window {
        __HILO3D_SHADOW_SANCTUM_RESULT__?: SanctumEvidence;
        __HILO3D_SHADOW_SANCTUM_TEST_API__?: Readonly<{
            settle(frames?: number): Promise<SanctumEvidence>;
            setMotion(value: boolean): Promise<SanctumEvidence>;
            setVeil(value: boolean): Promise<SanctumEvidence>;
            nextView(): Promise<SanctumEvidence>;
        }>;
    }
}
