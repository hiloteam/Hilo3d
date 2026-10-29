import {
    AmbientLight,
    ClusteredForwardPlusPipelineFactory,
    Color,
    Geometry,
    GeometryData,
    Mesh,
    MeshletGeometry,
    Node,
    PBRMaterial,
    PerspectiveCamera,
    PointLight,
    Renderer,
    Vector3,
    createMeshletFallbackGeometry,
    snapshotMeshletAssetManifest
} from '../../../src/Hilo3d';
import { GeometryPageManager } from '@hilo/addon-assets';
import type { RHIDevice } from '../../../src/render/rhi/core';
import { createMeshletFixtureSource } from '../../fixtures/meshlets/source';

const WIDTH = 128;
const HEIGHT = 96;
const UPLOAD_BUDGET = 16 * 1024;
const ARENA_BUDGET = 128 * 1024;
const requireNativeAdapter = new URLSearchParams(location.search).get('native') === '1';

interface PixelDifference {
    readonly mean: number;
    readonly maximum: number;
    readonly changedPixels: number;
}

interface MeshletStreamingResult {
    readonly cold: PixelDifference;
    readonly fine: PixelDifference;
    readonly transformed: PixelDifference;
    readonly recovered: PixelDifference;
    readonly evicted: PixelDifference;
    readonly released: PixelDifference;
    readonly coarseSourceFine: PixelDifference;
    readonly coarseSourceReleased: PixelDifference;
    readonly coarseSourceTriangles: number;
    readonly originalTriangles: number;
    readonly coarseEnergy: number;
    readonly fineEnergy: number;
    readonly coarseVisibleMeshlets: number;
    readonly fineVisibleMeshlets: number;
    readonly coarsePages: number;
    readonly finePages: number;
    readonly evictedPages: number;
    readonly uploadBytes: readonly number[];
    readonly residentBytes: number;
    readonly allocatedBytes: number;
    readonly culledVisibleMeshlets: number;
    readonly recoveryDeviceChanged: boolean;
    readonly retainedGeometryIdentity: boolean;
    readonly cpuBytesAfterDestroy: number;
    readonly groupCount: number;
}

declare global {
    interface Window {
        __HILO3D_MESHLET_STREAMING_RESULT__?: MeshletStreamingResult;
    }
}

function difference(actual: Uint8Array, expected: Uint8Array): PixelDifference {
    if (actual.length !== expected.length) throw new Error('Pixel dimensions changed');
    let sum = 0;
    let maximum = 0;
    let changedPixels = 0;
    for (let pixel = 0; pixel < actual.length; pixel += 4) {
        let changed = false;
        for (let channel = 0; channel < 3; channel += 1) {
            const delta = Math.abs(
                (actual[pixel + channel] ?? 0) - (expected[pixel + channel] ?? 0)
            );
            maximum = Math.max(maximum, delta);
            sum += delta;
            changed ||= delta > 1;
        }
        if (changed) changedPixels += 1;
    }
    return { mean: sum / ((actual.length / 4) * 3), maximum, changedPixels };
}

function energy(data: Uint8Array): number {
    let value = 0;
    for (let index = 0; index < data.length; index += 4)
        value += (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0);
    return value;
}

const response = await fetch('/test/fixtures/meshlets/manifest.json');
if (!response.ok) throw new Error(`Meshlet manifest HTTP ${String(response.status)}`);
const untrustedManifest: unknown = await response.json();
const manifest = snapshotMeshletAssetManifest(untrustedManifest);
const meshlets = new MeshletGeometry(manifest, {
    maxResidentBytes: ARENA_BUDGET,
    maxUploadBytesPerFrame: UPLOAD_BUDGET,
    maxVisibleMeshlets: 128,
    maximumProjectedError: 0
});
const manager = new GeometryPageManager(
    meshlets,
    {
        id: 'curved-grid',
        version: '1',
        pages: manifest.pages.map(page => ({
            pageId: page.id,
            url: `/test/fixtures/meshlets/page-${String(page.id)}.bin`
        }))
    },
    {
        budgets: {
            cpuBytes: 1024 * 1024,
            inFlightBytes: 256 * 1024,
            sourceBytes: 64 * 1024,
            concurrentRequests: 2,
            decodeBytesPerUpdate: 64 * 1024
        }
    }
);
const source = createMeshletFixtureSource();
const geometry = new Geometry({
    vertices: new GeometryData(source.positions, 3),
    normals: new GeometryData(source.normals, 3),
    uvs: new GeometryData(source.uv0, 2),
    indices: new GeometryData(source.indices, 1)
});
const material = new PBRMaterial({
    baseColor: new Color(0.23, 0.61, 0.85),
    metallic: 0.2,
    roughness: 0.65,
    cullMode: 'none'
});

async function createView(streamed: boolean, sourceGeometry = geometry) {
    const factory = new ClusteredForwardPlusPipelineFactory({
        buckets: [{ geometry: sourceGeometry, material, ...(streamed ? { meshlets } : {}) }],
        maxObjects: 8,
        maxLights: 4,
        maxLightIndices: 4096,
        maxLightsPerCluster: 4,
        maxViewportWidth: WIDTH,
        maxViewportHeight: HEIGHT,
        bloomStrength: 0,
        hiZ: true
    });
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const renderer = await Renderer.create({
        backend: 'webgpu',
        domElement: canvas,
        width: WIDTH,
        height: HEIGHT,
        antialias: false,
        renderingProfile: 'high-end',
        failIfMajorPerformanceCaveat: requireNativeAdapter,
        renderPipeline: factory
    });
    renderer.clearColor = new Color(0, 0, 0);
    const target = renderer.createRenderTarget({
        width: WIDTH,
        height: HEIGHT,
        colorAttachments: [{ format: 'rgba8unorm' }],
        depthStencilAttachment: { format: 'depth32float', depthMode: 'reversed' }
    });
    const scene = new Node();
    const mesh = new Mesh({ geometry: sourceGeometry, material });
    mesh.addTo(scene);
    new AmbientLight({ amount: 0.12 }).addTo(scene);
    new PointLight({ amount: 5, range: 30, x: -2, y: 3, z: 6 }).addTo(scene);
    const camera = new PerspectiveCamera({
        aspect: WIDTH / HEIGHT,
        near: 0.1,
        far: 100,
        depthMode: 'reversed'
    });
    camera.setPosition(0, 0, 11).lookAt(new Vector3());
    return { factory, renderer, target, scene, mesh, camera };
}

const reference = await createView(false);
const candidate = await createView(true);
const additionalViews: Awaited<ReturnType<typeof createView>>[] = [];
const uploadBytes: number[] = [];

async function capture(
    view: Awaited<ReturnType<typeof createView>>,
    frames = 1
): Promise<Uint8Array> {
    for (let frame = 0; frame < frames; frame += 1) {
        view.renderer.renderToTarget(view.target, view.scene, view.camera);
        await view.renderer.waitForIdle();
        if (view === candidate) {
            const diagnostics = await view.factory.readDiagnostics();
            uploadBytes.push(diagnostics.meshletGeometry?.lastUploadBytes ?? 0);
        }
    }
    return (await view.target.readColorAttachment()).data;
}

try {
    const referencePixels = await capture(reference, 2);
    const cold = difference(await capture(candidate, 2), referencePixels);
    const coarseLeases = manifest.groups.map(group => {
        const coarse = group.lods.at(-1);
        if (coarse === undefined) throw new Error('Missing coarse LOD');
        return manager.acquirePage(coarse.pageId);
    });
    await Promise.all(coarseLeases.map(lease => lease.ready));
    const coarsePixels = await capture(candidate, manifest.groups.length + 1);
    const coarseDiagnostics = await candidate.factory.readDiagnostics();
    const fineLeases = manifest.groups.map(group => {
        const fine = group.lods[0];
        if (fine === undefined) throw new Error('Missing fine LOD');
        return manager.acquirePage(fine.pageId, { priority: 1 });
    });
    await Promise.all(fineLeases.map(lease => lease.ready));
    const finePixels = await capture(candidate, manifest.groups.length + 1);
    const fineDiagnostics = await candidate.factory.readDiagnostics();
    const fine = difference(finePixels, referencePixels);
    // A streaming consumer need not retain the full-resolution source Geometry. A second
    // renderer starts with only the small coarse mesh and the same independently owned pages.
    const coarseSource = createMeshletFallbackGeometry(meshlets);
    const coarseSourceView = await createView(true, coarseSource);
    additionalViews.push(coarseSourceView);
    const coarseSourceFine = difference(
        await capture(coarseSourceView, manifest.groups.length + 2),
        referencePixels
    );

    // Mirrored nonuniform transforms must not make cone rejection discard visible surfaces.
    for (const view of [reference, candidate]) {
        view.mesh.scaleX = -0.85;
        view.mesh.scaleY = 0.9;
        view.mesh.x = 0.35;
    }
    const transformed = difference(await capture(candidate, 2), await capture(reference, 2));
    for (const view of [reference, candidate]) {
        view.mesh.scaleX = 1;
        view.mesh.scaleY = 1;
        view.mesh.x = 0;
    }
    candidate.mesh.x = 100;
    await capture(candidate, 2);
    const culled = await candidate.factory.readDiagnostics();
    candidate.mesh.x = 0;
    await capture(candidate, 2);

    const extension = candidate.renderer.getExtension('rhi') as {
        readonly device: RHIDevice;
    } | null;
    if (extension === null) throw new Error('Meshlet recovery requires the checked RHI extension');
    const oldDevice = extension.device;
    const restored = new Promise<void>(resolve => {
        candidate.renderer.on(
            'webgpuDeviceRestored',
            () => {
                resolve();
            },
            true
        );
    });
    oldDevice.destroy();
    await restored;
    const recovered = difference(
        await capture(candidate, manifest.pages.length + 1),
        referencePixels
    );

    fineLeases.forEach(lease => {
        lease.release();
    });
    const evicted = difference(await capture(candidate, 2), coarsePixels);
    const evictedDiagnostics = await candidate.factory.readDiagnostics();
    const retainedGeometryIdentity = coarseLeases.every(lease => lease.geometry === meshlets);
    coarseLeases.forEach(lease => {
        lease.release();
    });
    manager.destroy();
    const released = difference(await capture(candidate, 2), referencePixels);
    const coarseSourceReleased = difference(await capture(coarseSourceView, 2), coarsePixels);
    const result: MeshletStreamingResult = {
        cold,
        fine,
        transformed,
        recovered,
        evicted,
        released,
        coarseSourceFine,
        coarseSourceReleased,
        coarseSourceTriangles: (coarseSource.indices?.data.length ?? 0) / 3,
        originalTriangles: source.indices.length / 3,
        coarseEnergy: energy(coarsePixels),
        fineEnergy: energy(finePixels),
        coarseVisibleMeshlets: coarseDiagnostics.meshletGeometry?.visibleMeshletCount ?? 0,
        fineVisibleMeshlets: fineDiagnostics.meshletGeometry?.visibleMeshletCount ?? 0,
        coarsePages: coarseDiagnostics.meshletGeometry?.residentPageCount ?? 0,
        finePages: fineDiagnostics.meshletGeometry?.residentPageCount ?? 0,
        evictedPages: evictedDiagnostics.meshletGeometry?.residentPageCount ?? 0,
        uploadBytes,
        residentBytes: fineDiagnostics.meshletGeometry?.residentBytes ?? 0,
        allocatedBytes: fineDiagnostics.meshletGeometry?.allocatedBytes ?? 0,
        culledVisibleMeshlets: culled.meshletGeometry?.visibleMeshletCount ?? -1,
        recoveryDeviceChanged: extension.device !== oldDevice,
        retainedGeometryIdentity,
        cpuBytesAfterDestroy: manager.getDiagnostics().cpuBytes,
        groupCount: manifest.groups.length
    };
    for (const view of [reference, candidate, ...additionalViews]) {
        view.target.destroy();
        view.renderer.destroy();
    }
    // Publication follows teardown so browser error listeners also cover destruction.
    await new Promise<void>(resolve =>
        requestAnimationFrame(() =>
            requestAnimationFrame(() => {
                resolve();
            })
        )
    );
    window.__HILO3D_MESHLET_STREAMING_RESULT__ = result;
} finally {
    manager.destroy();
    reference.target.destroy();
    reference.renderer.destroy();
    candidate.target.destroy();
    candidate.renderer.destroy();
    for (const view of additionalViews) {
        view.target.destroy();
        view.renderer.destroy();
    }
}
