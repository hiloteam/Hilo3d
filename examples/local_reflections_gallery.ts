import * as H from '../src/Hilo3d';
import { resolveExampleBackend } from './shared/backend';
import { createTestFrameControl } from './shared/test-frame-control';
import { createLumenRoundedBox } from './shared/lumenGeometry';

const search = new URLSearchParams(location.search);
const testMode = search.get('test') === '1';
const reducedCapture = testMode && search.get('quality') !== 'production';
const backend = resolveExampleBackend();
function pixelRatio(): number {
    return reducedCapture ? 0.5 : Math.min(testMode ? 1 : devicePixelRatio, 1.5);
}
function element(id: string): HTMLElement {
    const value = document.getElementById(id);
    if (value === null) throw new Error(`Missing ${id}`);
    return value;
}
const probes = [-3.2, 3.2].map(
    (x, index) =>
        new H.ReflectionProbe({
            name: index === 0 ? 'Amber room' : 'Blue room',
            position: new H.Vector3(x, 2.4, 0),
            boxMin: new H.Vector3(index === 0 ? -8 : -1.1, -1.5, -6.2),
            boxMax: new H.Vector3(index === 0 ? 1.1 : 8, 6.2, 12),
            blendDistance: 1.1
        })
);
const pipeline = new H.ReflectionProbePipelineFactory({
    probes,
    resolution: reducedCapture ? 32 : 128,
    roughnessLevels: reducedCapture ? 5 : 6,
    filterSamples: reducedCapture ? 64 : 128,
    visibility: 3,
    // Software-GPU acceptance completes one probe per frame while keeping the complete scene,
    // filtering and publication path. Production retains the incremental one-face/one-band budget.
    facesPerFrame: reducedCapture ? 6 : 1,
    filterLevelsPerFrame: reducedCapture ? 5 : 1,
    pipeline: new H.PostProcessRenderPipelineFactory({
        bloom: { intensity: 0.09 },
        groundTruthAmbientOcclusion: {
            quality: 'medium',
            radius: 0.8,
            intensity: 1,
            directionCount: 3,
            stepCount: 4
        },
        colorUber: { exposure: 0.6 },
        opaqueTexture: false
    })
});
function fieldOfView(aspect: number): number {
    return (Math.atan(Math.tan((44 * Math.PI) / 360) * Math.max(1, 1.45 / aspect)) * 360) / Math.PI;
}
const camera = new H.PerspectiveCamera({
    near: 0.05,
    far: 60,
    fov: fieldOfView(innerWidth / innerHeight),
    visibility: 1,
    aspect: innerWidth / innerHeight
});
const stage = await H.Stage.create({
    container: element('container'),
    backend,
    camera,
    width: innerWidth,
    height: innerHeight,
    pixelRatio: pixelRatio(),
    antialias: true,
    clearColor: new H.Color(0.004, 0.006, 0.009),
    renderPipeline: pipeline
});

const stone = new H.PBRMaterial({
    baseColor: new H.Color(0.24, 0.21, 0.18),
    metallic: 0,
    roughness: 0.85
});
const coolStone = new H.PBRMaterial({
    baseColor: new H.Color(0.085, 0.13, 0.16),
    metallic: 0.05,
    roughness: 0.8
});
const dark = new H.PBRMaterial({
    baseColor: new H.Color(0.032, 0.038, 0.043),
    metallic: 0.24,
    roughness: 0.38
});
const trim = new H.PBRMaterial({
    baseColor: new H.Color(0.42, 0.3, 0.16),
    metallic: 0.8,
    roughness: 0.3
});
const metal = new H.PBRMaterial({
    reflectionProbes: probes,
    metallic: 0.94,
    roughness: 0.16,
    baseColor: new H.Color(0.88, 0.69, 0.38),
    clearcoatFactor: 0.35
});
const floorCanvas = document.createElement('canvas');
floorCanvas.width = floorCanvas.height = 512;
const floorContext = floorCanvas.getContext('2d');
if (floorContext === null) throw new Error('Stone texture requires a 2D canvas');
const stonePixels = floorContext.createImageData(512, 512);
for (let y = 0; y < 512; y++)
    for (let x = 0; x < 512; x++) {
        const grain = ((Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0) % 7;
        const seam = x < 2 || y < 2;
        const offset = (y * 512 + x) * 4;
        stonePixels.data[offset] = seam ? 17 : 43 + grain;
        stonePixels.data[offset + 1] = seam ? 19 : 46 + grain;
        stonePixels.data[offset + 2] = seam ? 22 : 50 + grain;
        stonePixels.data[offset + 3] = 255;
    }
floorContext.putImageData(stonePixels, 0, 0);
const stoneTexture = new H.Texture({
    image: floorCanvas,
    wrapS: H.constants.webgl.REPEAT,
    wrapT: H.constants.webgl.REPEAT,
    minFilter: H.constants.webgl.LINEAR_MIPMAP_LINEAR,
    anisotropic: 4
});
const tileTransform = new H.Matrix3();
tileTransform.elements[0] = 12;
tileTransform.elements[4] = 10;
const floor = new H.PBRMaterial({
    reflectionProbes: probes,
    metallic: 0.32,
    roughness: 0.17,
    baseColorMap: { texture: stoneTexture, transform: tileTransform, encoding: 'srgb' }
});
const roundedBox = createLumenRoundedBox();
function box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    material: H.MaterialInstance,
    rounded = false
): H.Mesh {
    const mesh = new H.Mesh({
        x,
        y,
        z,
        geometry: rounded ? roundedBox : new H.BoxGeometry({ width: w, height: h, depth: d }),
        material,
        ...(rounded ? { scaleX: w, scaleY: h, scaleZ: d } : {})
    });
    stage.addChild(mesh);
    return mesh;
}
function ringGeometry(radius: number, tube: number): H.Geometry {
    const positions: number[] = [],
        normals: number[] = [],
        indices: number[] = [];
    const segments = 128,
        sides = 12;
    for (let i = 0; i <= segments; i++)
        for (let j = 0; j <= sides; j++) {
            const u = (i / segments) * Math.PI * 2,
                v = (j / sides) * Math.PI * 2;
            const c = Math.cos(v),
                s = Math.sin(v),
                x = Math.cos(u),
                y = Math.sin(u);
            positions.push(x * (radius + tube * c), y * (radius + tube * c), tube * s);
            normals.push(x * c, y * c, s);
            if (i < segments && j < sides) {
                const a = i * (sides + 1) + j,
                    b = a + sides + 1;
                indices.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    return new H.Geometry({
        vertices: new H.GeometryData(new Float32Array(positions), 3),
        normals: new H.GeometryData(new Float32Array(normals), 3),
        indices: new H.GeometryData(new Uint16Array(indices), 1)
    });
}
new H.Mesh({
    geometry: new H.PlaneGeometry({ width: 40, height: 36 }),
    material: floor,
    rotationX: -90,
    y: -0.02,
    z: 1
}).addTo(stage);
box(-4, 3, -6.1, 8, 6.2, 0.35, stone);
box(4, 3, -6.1, 8, 6.2, 0.35, coolStone);
box(-8, 3, 0, 0.35, 6.2, 12, stone);
box(8, 3, 0, 0.35, 6.2, 12, coolStone);
box(0, 6.1, 0, 16.3, 0.25, 12.5, dark);
// Recessed wall panels, shadow gaps and ceiling ribs establish a continuous interior.
for (const x of [-7.8, -0.95, 0.95, 7.8]) box(x, 2.9, -5.7, 0.15, 5.8, 0.6, dark);
box(0, 5.65, -5.7, 15.8, 0.18, 0.6, dark);
for (let x = -7.5; x <= 7.5; x += 0.45) box(x, 5.96, -0.3, 0.055, 0.22, 12, stone);
for (const x of [-4.1, 4.1]) {
    box(x, 0.07, -5.82, 7.5, 0.12, 0.11, trim);
    box(x, 2.95, -5.8, 6.1, 4.8, 0.14, dark, true);
}
const amber = new H.Color(3.2, 1.25, 0.35);
const warmEmission = new H.BasicMaterial({ lightType: 'NONE', diffuse: amber });
const blueEmission = new H.BasicMaterial({
    lightType: 'NONE',
    diffuse: new H.Color(0.12, 1.35, 2.8)
});
for (const x of [-5.75, -4.45, -3.15]) {
    box(x, 3.1, -5.62, 0.72, 3.55, 0.035, warmEmission, true);
    box(x, 3.1, -5.67, 0.88, 3.72, 0.09, trim, true);
}
new H.Mesh({
    x: 4.1,
    y: 3.2,
    z: -5.58,
    geometry: ringGeometry(1.62, 0.055),
    material: blueEmission
}).addTo(stage);
new H.Mesh({ x: 4.1, y: 3.2, z: -5.7, geometry: ringGeometry(1.82, 0.018), material: trim }).addTo(
    stage
);
for (const x of [-7.65, 7.65])
    box(x, 5.83, 0, 0.055, 0.035, 11.5, x < 0 ? warmEmission : blueEmission);
// Thin architectural emitters give moving metal clear directional reflection cues.
box(-7.73, 3.1, 1.8, 0.045, 3.9, 0.5, warmEmission);
box(7.73, 3.1, 1.8, 0.045, 3.9, 0.5, blueEmission);
for (const x of [-3.2, 3.2]) {
    box(x, 0.2, -0.7, 3.1, 0.4, 2.9, dark, true);
    box(x, 0.405, -0.7, 3.0, 0.045, 2.8, trim, true);
    box(x, 0.45, -0.7, 2.94, 0.05, 2.74, stone, true);
}
const hero = new H.Node({ x: -3.2, z: -0.7 });
const captureHero = new H.Node({ x: -3.2, z: -0.7 });
stage.addChild(hero);
stage.addChild(captureHero);
const model = await new H.GLTFLoader().load({
    src: new URL('./models/Lumen/orbital-bloom.glb', import.meta.url).href,
    ignoreTextureError: false
});
await model.ready;
if (model.resourceErrors.length > 0)
    throw new AggregateError(model.resourceErrors, 'Sculpture load failed');
const bounds = model.node.getBounds();
if (bounds === undefined || bounds.height <= 0) throw new Error('Sculpture bounds are missing');
const sculptureScale = 3.55 / bounds.height;
model.node
    .setScale(sculptureScale)
    .setPosition(
        -bounds.x * sculptureScale,
        0.48 - bounds.yMin * sculptureScale,
        -bounds.z * sculptureScale
    );
model.node.rotationY = -28;
const captureModel = model.node.clone();
const captureMetal = new H.PBRMaterial({
    baseColor: metal.baseColor,
    metallic: 0.94,
    roughness: 0.16
});
captureModel.traverse(node => {
    node.layer = 2;
    if (node instanceof H.Mesh) node.material = captureMetal;
});
captureModel.addTo(captureHero);
// The capture-only layer reuses the exact sculpture geometry with direct/global lighting, avoiding
// recursive local-probe feedback while retaining its silhouette in the floor reflection.
for (const mesh of model.meshes) mesh.material = metal;
model.node.addTo(hero);
const sphere = new H.SphereGeometry({ radius: 1, widthSegments: 64, heightSegments: 48 });
for (const [index, roughness] of [0.08, 0.3, 0.65].entries()) {
    const material = new H.PBRMaterial({
        reflectionProbes: probes,
        metallic: 0.96,
        roughness,
        baseColor: new H.Color(0.68, 0.8, 0.92)
    });
    new H.Mesh({
        geometry: sphere,
        material,
        x: 2.2 + index * 0.95,
        y: 1.16,
        z: -0.7,
        scaleX: 0.43,
        scaleY: 0.67,
        scaleZ: 0.43
    }).addTo(stage);
    box(2.2 + index * 0.95, 0.53, -0.7, 0.66, 0.08, 0.7, dark, true);
}
for (const x of [-3.2, 3.2]) {
    new H.SpotLight({
        x,
        y: 5.3,
        z: 1.8,
        direction: new H.Vector3(0, -1, -0.6),
        cutoff: 24,
        outerCutoff: 38,
        range: 12,
        amount: 11,
        color: x < 0 ? new H.Color(1, 0.76, 0.5) : new H.Color(0.46, 0.72, 1)
    }).addTo(stage);
}
new H.DirectionalLight({
    direction: new H.Vector3(-0.6, -1, -0.4),
    amount: 0.6,
    color: new H.Color(0.68, 0.76, 0.88)
}).addTo(stage);
new H.AmbientLight({ color: new H.Color(0.32, 0.35, 0.4), amount: 1.1 }).addTo(stage);
const controls = new H.OrbitControls(stage, {
    camera,
    target: new H.Vector3(0, 2, -1.3),
    enablePan: false,
    minDistance: 8,
    maxDistance: 17,
    minPolarAngle: Math.PI * 0.36,
    maxPolarAngle: Math.PI * 0.49,
    rotateSpeed: 0.42,
    zoomSpeed: 0.6
});
controls.setView(new H.Vector3(6.8, 3.6, 10.8), new H.Vector3(0, 2, -1.3));

const ticker = new H.Ticker(60);
ticker.addTick(stage);
let enabled = true;
let ice = false;
let moved = false;
let disposed = false;
const events = new AbortController();
const capture = testMode
    ? createTestFrameControl(ticker, () => stage.renderer.waitForIdle())
    : undefined;
if (capture !== undefined) window.__HILO3D_TEST_CAPTURE__ = capture;
const status = element('status');
ticker.addTick({
    tick(): void {
        const ready = probes.every(probe => probe.getDiagnostics().ready);
        const settled = probes.every(probe => {
            const d = probe.getDiagnostics();
            return d.capturedRevision === d.requestedRevision;
        });
        status.textContent = !ready
            ? 'Capturing the rooms…'
            : settled
              ? 'Local reflections ready'
              : 'Updating reflections…';
        document.body.dataset['reflectionsReady'] = String(ready);
    }
});
element('reflections').addEventListener(
    'click',
    () => {
        enabled = !enabled;
        for (const probe of probes) probe.intensity = enabled ? 1 : 0;
        element('reflections').setAttribute('aria-pressed', String(enabled));
        const label = element('reflections').querySelector('strong');
        if (label !== null) label.textContent = enabled ? 'On' : 'Off';
    },
    { signal: events.signal }
);
element('move').addEventListener(
    'click',
    () => {
        moved = !moved;
        hero.x = captureHero.x = moved ? 2.9 : -3.2;
        hero.z = captureHero.z = moved ? 1.7 : -0.7;
        for (const probe of probes) probe.requestUpdate();
    },
    { signal: events.signal }
);
element('light').addEventListener(
    'click',
    () => {
        ice = !ice;
        amber.r = ice ? 0.2 : 3.2;
        amber.g = ice ? 2.1 : 1.1;
        amber.b = ice ? 3.2 : 0.25;
        for (const probe of probes) probe.requestUpdate();
    },
    { signal: events.signal }
);
element('roughness').addEventListener(
    'input',
    event => {
        if (event.currentTarget instanceof HTMLInputElement) {
            metal.roughness = captureMetal.roughness = Number(event.currentTarget.value);
            for (const probe of probes) probe.requestUpdate();
        }
    },
    { signal: events.signal }
);
window.addEventListener(
    'resize',
    () => {
        camera.aspect = innerWidth / innerHeight;
        camera.fov = fieldOfView(camera.aspect);
        stage.resize(innerWidth, innerHeight, pixelRatio());
    },
    { signal: events.signal }
);
function dispose(): void {
    if (disposed) return;
    disposed = true;
    ticker.stop();
    capture?.dispose();
    controls.dispose();
    events.abort();
    if (window.__HILO3D_TEST_CAPTURE__ === capture) delete window.__HILO3D_TEST_CAPTURE__;
    stage.destroy();
    document.body.dataset['reflectionsDisposed'] = 'true';
}
window.addEventListener('pagehide', event => {
    ticker.stop();
    if (!event.persisted) dispose();
});
window.addEventListener('pageshow', event => {
    if (event.persisted && !disposed) ticker.start();
});
window.__HILO3D_LOCAL_REFLECTIONS__ = {
    probes,
    stage,
    dispose,
    residentBytes: pipeline.residentBytes
};
ticker.start();

declare global {
    interface Window {
        __HILO3D_LOCAL_REFLECTIONS__?: {
            readonly probes: readonly H.ReflectionProbe[];
            readonly stage: H.Stage;
            readonly residentBytes: number;
            dispose(): void;
        };
    }
}
