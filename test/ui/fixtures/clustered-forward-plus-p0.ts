import {
    AmbientLight,
    BoxGeometry,
    ClusteredForwardPlusPipelineFactory,
    Color,
    GeometryData,
    Matrix4,
    Mesh,
    MorphGeometry,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    PointLight,
    Renderer,
    Skeleton,
    SkinnedMesh,
    SpotLight,
    Vector3
} from '../../../src/Hilo3d';
import { ParticleSystem, ParticleSystemDefinition } from '@hilo3d/addon-particle';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../../../src/render/diagnostics/RendererDiagnosticsRegistry';
import type { RHIDevice } from '../../../src/render/rhi/core';

interface ClusteredForwardPlusP0Result {
    readonly litEnergy: number;
    readonly excludedEnergy: number;
    readonly recoveredEnergy: number;
    readonly nativeTransparent: boolean;
    readonly nativeDeformedLayered: boolean;
    readonly particleTemporalComposition: boolean;
    readonly transparentResurrection: boolean;
    readonly recoveryHistoryInitialized: boolean;
    readonly recoveryDeviceChanged: boolean;
    readonly warmedMaterialVariantCount: number;
    readonly activeMaterialVariantCount: number;
    readonly materialVariantBudgetExceededCount: number;
    readonly clusteredTransparentObjectCount: number;
    readonly clusteredDeformedObjectCount: number;
    readonly fallbackObjectCount: number;
    readonly mixedTransparencyFallback: boolean;
}

declare global {
    interface Window {
        __HILO3D_CLUSTERED_FORWARD_PLUS_P0_RESULT__?: ClusteredForwardPlusP0Result;
    }
}

function energy(data: Uint8Array): number {
    let result = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
        result += (data[offset] ?? 0) + (data[offset + 1] ?? 0) + (data[offset + 2] ?? 0);
    }
    return result;
}

const bucketGeometry = new BoxGeometry();
const bucketMaterial = new PBRMaterial();
const layeredMesh = new Mesh({
    geometry: new BoxGeometry({ widthSegments: 2 }),
    material: new PBRMaterial({
        baseColor: new Color(0.3, 0.9, 0.25),
        clearcoatFactor: 0.75,
        clearcoatRoughnessFactor: 0.18,
        anisotropyStrength: 0.45,
        iridescenceFactor: 0.55,
        iridescenceThicknessMinimum: 160,
        iridescenceThicknessMaximum: 360
    }),
    y: 1.05,
    scaleX: 0.55,
    scaleY: 0.55,
    scaleZ: 0.55,
    frustumTest: false
});
const factory = new ClusteredForwardPlusPipelineFactory({
    buckets: [{ geometry: bucketGeometry, material: bucketMaterial }],
    maxObjects: 1,
    maxLights: 4,
    maxLightIndices: 4_096,
    maxLightsPerCluster: 4,
    maxViewportWidth: 64,
    maxViewportHeight: 32,
    hiZ: false,
    bloomStrength: 0,
    temporalAA: { renderScale: 0.5 },
    variantManifest: {
        entries: [{ mesh: layeredMesh, shadowed: false }],
        maxVariants: 4,
        warmupBatchSize: 1
    }
});
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const rendererDiagnostics = registerRendererDiagnostics(canvas);
const renderer = await Renderer.create({
    backend: 'webgpu',
    domElement: canvas,
    width: 64,
    height: 32,
    antialias: false,
    renderingProfile: 'high-end',
    renderPipeline: factory
});
renderer.clearColor = new Color(0, 0, 0);
const target = renderer.createRenderTarget({
    width: 64,
    height: 32,
    colorAttachments: [{ format: 'rgba8unorm' }],
    depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
});
const scene = new Node();
layeredMesh.addTo(scene);

const morphSource = new BoxGeometry({ widthSegments: 2 });
const morphVertices = morphSource.vertices;
if (morphVertices === null) throw new Error('Expected morph source vertices');
const morphDelta = new Float32Array(morphVertices.data.length);
for (let index = 0; index < morphDelta.length; index += 3) morphDelta[index] = 0.08;
const morphMesh = new Mesh({
    geometry: new MorphGeometry({
        vertices: morphSource.vertices,
        normals: morphSource.normals,
        uvs: morphSource.uvs,
        indices: morphSource.indices,
        weights: new Float32Array([0.5]),
        targets: { vertices: [new GeometryData(morphDelta, 3)] }
    }),
    material: new PBRMaterial({
        compositing: { mode: 'alpha-blend', premultiplied: true },
        cullMode: 'none',
        opacity: 0.72,
        baseColor: new Color(0.95, 0.18, 0.08),
        clearcoatFactor: 0.8
    }),
    x: -0.75,
    z: -0.6,
    frustumTest: false
});
morphMesh.addTo(scene);

const skinGeometry = new BoxGeometry({ widthSegments: 2 });
const skinVertices = skinGeometry.vertices;
if (skinVertices === null) throw new Error('Expected skin source vertices');
const skinIndices = new Uint8Array(skinVertices.count * 4);
const skinWeights = new Uint8Array(skinVertices.count * 4);
for (let index = 0; index < skinVertices.count; index += 1) skinWeights[index * 4] = 255;
skinGeometry.skinIndices = new GeometryData(skinIndices, 4);
skinGeometry.skinWeights = new GeometryData(skinWeights, 4, { normalized: true });
const joint = new Node();
joint.updateMatrixWorld(true);
const skinned = new SkinnedMesh({
    geometry: skinGeometry,
    material: new PBRMaterial({
        compositing: { mode: 'alpha-blend', premultiplied: true },
        cullMode: 'none',
        opacity: 0.68,
        baseColor: new Color(0.05, 0.3, 1),
        anisotropyStrength: 0.65,
        iridescenceFactor: 0.7
    }),
    skeleton: new Skeleton({
        jointNodeList: [joint],
        jointNames: ['root'],
        inverseBindMatrices: [new Matrix4()]
    }),
    x: 0.75,
    z: 0.6,
    frustumTest: false
});
skinned.updateMatrixWorld(true);
skinned.addTo(scene);

const particles = new ParticleSystem({
    definition: ParticleSystemDefinition.create({
        emitters: [
            {
                name: 'clustered-p0-particles',
                capacity: 64,
                execution: 'stateless',
                duration: 4,
                emission: { rateOverTime: 16 },
                initialize: {
                    lifetime: 2,
                    direction: [0, 1, 0],
                    speed: 0.35,
                    size: 0.35,
                    color: [1, 0.55, 0.12, 0.8]
                },
                renderers: [{ type: 'sprite', blend: 'additive', depthTest: false }]
            }
        ]
    }),
    seed: 31,
    autoPlay: false,
    compilationEnvironment: { backend: 'webgpu' }
});
particles.simulate(0.5).addTo(scene);
new AmbientLight({ amount: 0.01 }).addTo(scene);
const point = new PointLight({ amount: 100, range: 8, z: 3, lightLayerMask: 1 }).addTo(scene);
const spot = new SpotLight({
    amount: 10,
    range: 8,
    z: 3,
    direction: new Vector3(0, 0, -1),
    lightLayerMask: 1,
    cookie: { scale: [0.9, 0.7], intensity: 0.9, softness: 0.2 },
    iesProfile: { intensity: 1.1, exponent: 1.5 }
}).addTo(scene);
const camera = new PerspectiveCamera({
    aspect: 2,
    near: 0.1,
    far: 20,
    depthMode: 'reversed'
});
camera.setPosition(0, 0, 6).lookAt(new Vector3(0, 0, 0));

renderer.renderToTarget(target, scene, camera);
renderer.renderToTarget(target, scene, camera);
await renderer.waitForIdle();
const litEnergy = energy((await target.readColorAttachment()).data);
const nativePasses =
    rendererDiagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
const nativeDiagnostics = await factory.readDiagnostics();

point.lightLayerMask = 2;
spot.lightLayerMask = 2;
renderer.renderToTarget(target, scene, camera);
renderer.renderToTarget(target, scene, camera);
await renderer.waitForIdle();
const excludedEnergy = energy((await target.readColorAttachment()).data);
point.lightLayerMask = 1;
spot.lightLayerMask = 1;

const extension = renderer.getExtension('rhi') as { readonly device: RHIDevice } | null;
if (extension === null) throw new Error('Expected the public RHI extension');
const deviceBeforeRecovery = extension.device;
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
renderer.renderToTarget(target, scene, camera);
await renderer.waitForIdle();
const recoveryPasses =
    rendererDiagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
renderer.renderToTarget(target, scene, camera);
await renderer.waitForIdle();
const recoveredEnergy = energy((await target.readColorAttachment()).data);

new Mesh({
    geometry: new BoxGeometry(),
    material: new PBRMaterial({ transmissionFactor: 0.45 }),
    y: -1.2,
    frustumTest: false
}).addTo(scene);
renderer.renderToTarget(target, scene, camera);
await renderer.waitForIdle();
const mixedPasses = rendererDiagnostics.snapshot().renderGraph?.passes.map(pass => pass.name) ?? [];
const mixedDiagnostics = await factory.readDiagnostics();

window.__HILO3D_CLUSTERED_FORWARD_PLUS_P0_RESULT__ = {
    litEnergy,
    excludedEnergy,
    recoveredEnergy,
    nativeTransparent: nativePasses.includes('Clustered Forward+ transparent PBR'),
    nativeDeformedLayered: nativePasses.includes('GPU Scene deformed and layered clustered PBR'),
    particleTemporalComposition: nativePasses.includes(
        'Transparent GPU particle temporal composition'
    ),
    transparentResurrection: nativePasses.includes(
        'Transparent transmission and particle resurrection'
    ),
    recoveryHistoryInitialized: recoveryPasses.includes('Transparent temporal history initialize'),
    recoveryDeviceChanged: extension.device !== deviceBeforeRecovery,
    warmedMaterialVariantCount: nativeDiagnostics.warmedMaterialVariantCount,
    activeMaterialVariantCount: nativeDiagnostics.activeMaterialVariantCount,
    materialVariantBudgetExceededCount: nativeDiagnostics.materialVariantBudgetExceededCount,
    clusteredTransparentObjectCount: nativeDiagnostics.clusteredTransparentObjectCount,
    clusteredDeformedObjectCount: nativeDiagnostics.clusteredDeformedObjectCount,
    fallbackObjectCount: nativeDiagnostics.fallbackObjectCount,
    mixedTransparencyFallback:
        mixedDiagnostics.clusteredTransparentObjectCount === 0 &&
        mixedPasses.includes('Clustered Forward+ compatibility fallback')
};

unregisterRendererDiagnostics(canvas, rendererDiagnostics);
