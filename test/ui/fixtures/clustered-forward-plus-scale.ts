import {
    AmbientLight,
    ClusteredForwardPlusPipelineFactory,
    Geometry,
    GeometryData,
    Mesh,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    PointLight,
    Renderer,
    Vector3
} from '../../../src/Hilo3d';
import type { RHIDevice } from '../../../src/render/rhi/core';

const STATIC_OBJECT_COUNT = 100_000;
const DYNAMIC_OBJECT_COUNT = 10_000;
const OBJECT_COUNT = STATIC_OBJECT_COUNT + DYNAMIC_OBJECT_COUNT;
const LIGHT_COUNT = 256;

interface ClusteredForwardPlusScaleResult {
    readonly objectCount: number;
    readonly fallbackObjectCount: number;
    readonly lightCount: number;
    readonly droppedLightCount: number;
    readonly visibleObjectCount: number;
    readonly clusterOverflowCount: number;
    readonly hiZValid: boolean;
    readonly frameMilliseconds: readonly number[];
    readonly recoveryDeviceChanged: boolean;
    readonly recoveredObjectCount: number;
    readonly recoveredFallbackObjectCount: number;
}

declare global {
    interface Window {
        __HILO3D_CLUSTERED_FORWARD_PLUS_SCALE_RESULT__?: ClusteredForwardPlusScaleResult;
    }
}

const geometry = new Geometry({
    vertices: new GeometryData(
        new Float32Array([-0.045, -0.04, 0, 0.045, -0.04, 0, 0, 0.05, 0]),
        3
    ),
    normals: new GeometryData(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
    indices: new GeometryData(new Uint16Array([0, 1, 2]), 1)
});
const material = new PBRMaterial({ metallic: 0.15, roughness: 0.72 });
const factory = new ClusteredForwardPlusPipelineFactory({
    buckets: [{ geometry, material }],
    maxObjects: OBJECT_COUNT,
    maxLights: LIGHT_COUNT,
    maxLightIndices: 1_048_576,
    maxLightsPerCluster: 64,
    tileSize: 16,
    zSlices: 24,
    maxViewportWidth: 320,
    maxViewportHeight: 180
});
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const renderer = await Renderer.create({
    backend: 'webgpu',
    domElement: canvas,
    width: 320,
    height: 180,
    antialias: false,
    renderingProfile: 'high-end',
    renderPipeline: factory
});
const scene = new Node();
const dynamicMeshes: Mesh[] = [];
const columns = 400;
for (let index = 0; index < OBJECT_COUNT; index += 1) {
    const mesh = new Mesh({
        geometry,
        material,
        x: ((index % columns) - (columns - 1) * 0.5) * 0.12,
        y: (Math.floor(index / columns) - 137) * 0.12,
        z: 0
    });
    mesh.addTo(scene);
    if (index >= STATIC_OBJECT_COUNT) dynamicMeshes.push(mesh);
}
new AmbientLight({ amount: 0.08 }).addTo(scene);
for (let index = 0; index < LIGHT_COUNT; index += 1) {
    const column = index % 32;
    const row = Math.floor(index / 32);
    new PointLight({
        amount: 1.25,
        range: 3.5,
        x: (column - 15.5) * 1.4,
        y: (row - 3.5) * 2.5,
        z: 4
    }).addTo(scene);
}
const camera = new PerspectiveCamera({
    aspect: 320 / 180,
    near: 0.1,
    far: 100,
    depthMode: 'reversed'
});
camera.setPosition(0, 0, 40).lookAt(new Vector3(0, 0, 0));

const frameMilliseconds: number[] = [];
const renderFrame = async (): Promise<void> => {
    const start = performance.now();
    renderer.render(scene, camera);
    await renderer.waitForIdle();
    frameMilliseconds.push(performance.now() - start);
};

await renderFrame();
await renderFrame();
for (let index = 0; index < dynamicMeshes.length; index += 1) {
    const mesh = dynamicMeshes[index];
    if (mesh !== undefined) mesh.x += index % 2 === 0 ? 0.01 : -0.01;
}
material.roughness = 0.46;
await renderFrame();
const diagnostics = await factory.readDiagnostics();
const rhi = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
if (rhi === null) throw new Error('GPU Scene scale acceptance requires the public RHI extension');
const deviceBeforeRecovery = rhi.device;
const deviceLost = new Promise<void>(resolve => {
    renderer.on(
        'webgpuDeviceLost',
        () => {
            resolve();
        },
        true
    );
});
const deviceRestored = new Promise<void>(resolve => {
    renderer.on(
        'webgpuDeviceRestored',
        () => {
            resolve();
        },
        true
    );
});
deviceBeforeRecovery.destroy();
await deviceLost;
await Promise.all([renderer.waitForIdle(), deviceRestored]);
await renderFrame();
await renderFrame();
const recoveredDiagnostics = await factory.readDiagnostics();
window.__HILO3D_CLUSTERED_FORWARD_PLUS_SCALE_RESULT__ = {
    objectCount: diagnostics.objectCount,
    fallbackObjectCount: diagnostics.fallbackObjectCount,
    lightCount: diagnostics.lightCount,
    droppedLightCount: diagnostics.droppedLightCount,
    visibleObjectCount: diagnostics.visibleObjectCount,
    clusterOverflowCount: diagnostics.clusterOverflowCount,
    hiZValid: diagnostics.hiZValid,
    frameMilliseconds,
    recoveryDeviceChanged: rhi.device !== deviceBeforeRecovery,
    recoveredObjectCount: recoveredDiagnostics.objectCount,
    recoveredFallbackObjectCount: recoveredDiagnostics.fallbackObjectCount
};
