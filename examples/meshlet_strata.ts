import * as H from '../src/Hilo3d';
import { GeometryPageManager, type GeometryPageLease } from '@hilo/addon-assets';
import { resolveExampleBackend } from './shared/backend';
import { installPageLifecycle } from './shared/pageLifecycle';
import { createTestFrameControl, type TestFrameControl } from './shared/test-frame-control';

type ViewName = 'overview' | 'passage' | 'surface';
type DetailMode = 'adaptive' | 'coarse';
type XYZ = readonly [number, number, number];
interface AssetDescription {
    readonly name: string;
    readonly material: string;
    readonly streamed: boolean;
    readonly triangles: number;
    readonly manifestURL?: string;
    readonly geometryURL?: string;
}
interface InstanceDescription {
    readonly asset: string;
    readonly name: string;
    readonly position: XYZ;
    readonly scale: XYZ;
    readonly rotationY: number;
}
interface MaterialDescription {
    readonly color: XYZ;
    readonly roughness: number;
    readonly metallic: number;
    readonly texture: string | null;
}
interface SceneDescription {
    readonly contentVersion: string;
    readonly materials: Readonly<Record<string, MaterialDescription>>;
    readonly assets: readonly AssetDescription[];
    readonly instances: readonly InstanceDescription[];
    readonly views: Readonly<Record<ViewName, { readonly position: XYZ; readonly target: XYZ }>>;
    readonly sourceTriangles: number;
}
interface StreamedAsset {
    readonly name: string;
    readonly meshlets: H.MeshletGeometry;
    readonly manager: GeometryPageManager;
    readonly coarse: readonly GeometryPageLease[];
    readonly fine: Map<number, GeometryPageLease>;
    readonly instances: readonly InstanceDescription[];
}
export interface StrataDiagnostics {
    readonly ready: boolean;
    readonly disposed: boolean;
    readonly suspended: boolean;
    readonly submittedFrames: number;
    readonly view: ViewName;
    readonly detail: DetailMode;
    readonly streaming: boolean;
    readonly sourceTriangles: number;
    readonly coarseTriangles: number;
    readonly coarsePageIds: readonly string[];
    readonly requestedPageIds: readonly string[];
    readonly cpuBytes: number;
    readonly residentBytes: number;
    readonly allocatedBytes: number;
    readonly visibleMeshletCount: number;
    readonly deferredPageCount: number;
    readonly uploadedBytes: number;
    readonly cameraPosition: readonly number[];
}
export interface StrataAPI {
    diagnostics(): StrataDiagnostics;
    setView(view: ViewName): void;
    dispose(): void;
}
declare global {
    interface Window {
        __HILO3D_STRATA__?: StrataAPI;
    }
}

const query = new URLSearchParams(location.search);
const testMode = query.get('test') === '1';
const reduced = testMode && query.get('quality') !== 'production';
const base = new URL('./models/Strata/', location.href);
const events = new AbortController();
const streamed: StreamedAsset[] = [];
const textures = new Map<string, H.Texture>();
const materials = new Map<string, H.PBRMaterial>();
const geometries = new Map<string, H.Geometry>();
const ticker = new H.Ticker(60);
let stage: H.Stage | undefined;
let controls: H.OrbitControls | undefined;
let factory: H.ClusteredForwardPlusPipelineFactory | undefined;
let frameControl: TestFrameControl | undefined;
let scene: SceneDescription | undefined;
let ready = false;
let rendering = false;
let disposed = false;
let suspended = false;
let submittedFrames = 0;
let view: ViewName = 'overview';
let detail: DetailMode = 'adaptive';
let streaming = true;
let coarseTriangles = 0;
let demandDirty = true;
let lastCamera = '';
let gpu: Readonly<H.MeshletGeometryDiagnostics> | null = null;
let diagnosticsWork: Promise<void> | undefined;
let cleanup: Promise<void> | undefined;
let awaken: (() => void) | undefined;

function element<T extends HTMLElement>(id: string, kind: new () => T): T {
    const found = document.getElementById(id);
    if (!(found instanceof kind)) throw new Error(`STRATA requires #${id}`);
    return found;
}
function record(value: unknown, label: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError(`${label} must be an object`);
    return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0)
        throw new TypeError(`${label} must be a string`);
    return value;
}
function number(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new TypeError(`${label} must be finite`);
    return value;
}
function array(value: unknown, label: string): readonly unknown[] {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
    return value;
}
function xyz(value: unknown, label: string): XYZ {
    const values = array(value, label);
    if (values.length !== 3) throw new RangeError(`${label} requires three coordinates`);
    return [number(values[0], label), number(values[1], label), number(values[2], label)];
}
async function json(path: string): Promise<unknown> {
    const url = new URL(path, base);
    if (scene) url.searchParams.set('v', scene.contentVersion);
    const response = await fetch(url, { signal: events.signal });
    if (!response.ok) throw new Error(`STRATA asset ${path}: HTTP ${String(response.status)}`);
    return response.json() as Promise<unknown>;
}
function parseScene(value: unknown): SceneDescription {
    const root = record(value, 'STRATA scene');
    if (root['version'] !== 1) throw new Error('Unknown STRATA scene version');
    const sourceMaterials = record(root['materials'], 'materials');
    const parsedMaterials: Record<string, MaterialDescription> = {};
    for (const [name, raw] of Object.entries(sourceMaterials)) {
        const material = record(raw, name);
        parsedMaterials[name] = {
            color: xyz(material['color'], name),
            roughness: number(material['roughness'], name),
            metallic: number(material['metallic'], name),
            texture: material['texture'] === null ? null : string(material['texture'], name)
        };
    }
    const assets = array(root['assets'], 'assets').map((raw): AssetDescription => {
        const asset = record(raw, 'asset');
        const name = string(asset['name'], 'asset name');
        const isStreamed = asset['streamed'];
        if (typeof isStreamed !== 'boolean') throw new TypeError('Asset streaming flag missing');
        return {
            name,
            material: string(asset['material'], name),
            streamed: isStreamed,
            triangles: number(asset['triangles'], name),
            ...(isStreamed
                ? { manifestURL: string(asset['manifestURL'], `${name} manifest URL`) }
                : { geometryURL: string(asset['geometryURL'], `${name} geometry URL`) })
        };
    });
    const instances = array(root['instances'], 'instances').map((raw): InstanceDescription => {
        const item = record(raw, 'instance');
        return {
            asset: string(item['asset'], 'instance asset'),
            name: string(item['name'], 'instance name'),
            position: xyz(item['position'], 'instance position'),
            scale: xyz(item['scale'], 'instance scale'),
            rotationY: number(item['rotationY'], 'instance rotation')
        };
    });
    const sourceViews = record(root['views'], 'views');
    const parseView = (name: ViewName): { position: XYZ; target: XYZ } => {
        const selected = record(sourceViews[name], name);
        return { position: xyz(selected['position'], name), target: xyz(selected['target'], name) };
    };
    return {
        contentVersion: string(root['contentVersion'], 'content version'),
        materials: parsedMaterials,
        assets,
        instances,
        views: {
            overview: parseView('overview'),
            passage: parseView('passage'),
            surface: parseView('surface')
        },
        sourceTriangles: number(root['sourceTriangles'], 'source triangles')
    };
}
function parseGeometry(value: unknown): H.Geometry {
    const raw = record(value, 'static geometry');
    const values = (name: string): number[] =>
        array(raw[name], name).map(component => number(component, name));
    const positions = values('positions'),
        normals = values('normals'),
        uv0 = values('uv0'),
        indices = values('indices');
    if (
        positions.length % 3 !== 0 ||
        normals.length !== positions.length ||
        uv0.length !== (positions.length / 3) * 2 ||
        indices.some(
            index => !Number.isInteger(index) || index < 0 || index >= positions.length / 3
        )
    )
        throw new Error('Invalid static geometry streams');
    return new H.Geometry({
        vertices: new H.GeometryData(new Float32Array(positions), 3),
        normals: new H.GeometryData(new Float32Array(normals), 3),
        uvs: new H.GeometryData(new Float32Array(uv0), 2),
        indices: new H.GeometryData(new Uint32Array(indices), 1)
    });
}
async function loadTexture(path: string): Promise<H.Texture> {
    const image = new Image();
    const url = new URL(path, base);
    if (scene) url.searchParams.set('v', scene.contentVersion);
    image.src = url.href;
    await image.decode();
    if (disposed) throw new DOMException('STRATA disposed', 'AbortError');
    const texture = new H.Texture({
        image,
        flipY: false,
        wrapS: H.constants.webgl.REPEAT,
        wrapT: H.constants.webgl.REPEAT,
        minFilter: H.constants.webgl.LINEAR_MIPMAP_LINEAR,
        anisotropic: 4
    });
    textures.set(path, texture);
    return texture;
}
function pixelRatio(): number {
    return Math.min(
        reduced ? 1 : devicePixelRatio,
        (reduced ? 640 : 1920) / innerWidth,
        (reduced ? 400 : 1080) / innerHeight
    );
}
function addSky(target: H.Stage): void {
    const texture = textures.get('quarry-sky.png');
    if (!texture) throw new Error('STRATA sky texture missing');
    // An authored sky-only dome. The sculptures and quarry remain ordinary 3D geometry.
    // UV0 is logical image space and BasicMaterial applies the managed-image boundary.
    texture.wrapS = H.constants.webgl.MIRRORED_REPEAT;
    texture.wrapT = H.constants.webgl.CLAMP_TO_EDGE;
    const geometry = new H.SphereGeometry({ radius: 140, widthSegments: 96, heightSegments: 48 });
    const uv = geometry.uvs?.data;
    if (!uv) throw new Error('STRATA sky sphere requires UV0');
    for (let i = 0; i < uv.length; i += 2) {
        const u = uv[i],
            v = uv[i + 1];
        if (u === undefined || v === undefined) throw new Error('Incomplete STRATA sky UV');
        uv[i] = (u - 0.61) / 0.2;
        uv[i + 1] = (v - 0.4) / 0.12;
    }
    new H.Mesh({
        name: 'Sky above the quarry',
        geometry,
        material: new H.BasicMaterial({
            lightType: 'NONE',
            diffuse: { texture, encoding: 'srgb' },
            cullMode: 'front',
            state: { depthWrite: false }
        }),
        castShadows: false,
        receiveShadows: false,
        frustumTest: false
    }).addTo(target);
}
function fov(): number {
    if (innerWidth / innerHeight < 0.9) return 52;
    return (
        (Math.atan(
            Math.tan((35 * Math.PI) / 360) * Math.max(1, 1.45 / (innerWidth / innerHeight))
        ) *
            360) /
        Math.PI
    );
}
function pageKey(asset: StreamedAsset, pageId: number): string {
    return `${asset.name}/page-${String(pageId)}.bin`;
}
function diagnostics(): StrataDiagnostics {
    return {
        ready,
        disposed,
        suspended,
        submittedFrames,
        view,
        detail,
        streaming,
        sourceTriangles: scene?.sourceTriangles ?? 0,
        coarseTriangles,
        coarsePageIds: streamed.flatMap(asset =>
            asset.coarse.map(lease => pageKey(asset, lease.pageId))
        ),
        requestedPageIds: streamed.flatMap(asset =>
            [...asset.coarse, ...asset.fine.values()].map(lease => pageKey(asset, lease.pageId))
        ),
        cpuBytes: streamed.reduce((sum, asset) => sum + asset.manager.getDiagnostics().cpuBytes, 0),
        residentBytes: gpu?.residentBytes ?? 0,
        allocatedBytes: gpu?.allocatedBytes ?? 0,
        visibleMeshletCount: gpu?.visibleMeshletCount ?? 0,
        deferredPageCount: gpu?.deferredPageCount ?? 0,
        uploadedBytes: gpu?.uploadedBytes ?? 0,
        cameraPosition:
            controls === undefined ? [] : [controls.camera.x, controls.camera.y, controls.camera.z]
    };
}
function setView(name: ViewName): void {
    if (!['overview', 'passage', 'surface'].includes(name)) throw new Error('Unknown STRATA view');
    view = name;
    document.body.dataset['view'] = name;
    const selected =
        name === 'overview' && innerWidth / innerHeight < 0.9
            ? { position: [5.3, 5.8, 14] as const, target: [-2.1, 3.8, -0.3] as const }
            : scene?.views[name];
    if (selected && controls)
        controls.setView(new H.Vector3(...selected.position), new H.Vector3(...selected.target));
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
        button.setAttribute('aria-pressed', String(button.dataset['view'] === view));
    demandDirty = true;
}
function handleFailure(error: unknown): void {
    if (disposed) return;
    const failure = element('failure', HTMLElement);
    failure.textContent = `The quarry could not open. ${error instanceof Error ? error.message : String(error)}`;
    failure.hidden = false;
    element('loading', HTMLElement).hidden = true;
    document.body.dataset['failure'] = 'true';
    console.error(error);
    dispose();
}
function requestDemand(): void {
    const camera = controls?.camera;
    if (!camera || !stage || disposed || suspended) return;
    const signature = `${camera.x.toFixed(2)},${camera.y.toFixed(2)},${camera.z.toFixed(2)},${String(stage.rendererHeight)}`;
    if (!demandDirty && signature === lastCamera) return;
    demandDirty = false;
    lastCamera = signature;
    const focal = (stage.rendererHeight * 0.5) / Math.tan((camera.fov * Math.PI) / 360);
    for (const asset of streamed) {
        const wanted = new Set<number>();
        if (streaming && detail === 'adaptive') {
            for (const group of asset.meshlets.manifest.groups) {
                let scale = 1;
                let distance = Infinity;
                for (const item of asset.instances) {
                    const angle = (item.rotationY * Math.PI) / 180;
                    const x = group.bounds[0] * item.scale[0],
                        z = group.bounds[2] * item.scale[2];
                    const gx = item.position[0] + Math.cos(angle) * x + Math.sin(angle) * z;
                    const gy = item.position[1] + group.bounds[1] * item.scale[1];
                    const gz = item.position[2] - Math.sin(angle) * x + Math.cos(angle) * z;
                    const maximumScale = Math.max(...item.scale);
                    const candidate = Math.max(
                        0.5,
                        Math.hypot(camera.x - gx, camera.y - gy, camera.z - gz) -
                            group.bounds[3] * maximumScale
                    );
                    if (candidate / maximumScale < distance / scale) {
                        distance = candidate;
                        scale = maximumScale;
                    }
                }
                let selected = group.lods[0];
                for (const lod of group.lods)
                    if ((lod.error * scale * focal) / distance <= 0.9) selected = lod;
                const coarse = group.lods.at(-1);
                if (selected && selected.pageId !== coarse?.pageId) wanted.add(selected.pageId);
            }
        }
        // Hidden cached CPU pages do not imply GPU eviction. Final release deliberately
        // reclaims old fine pages while the independent coarse leases remain pinned.
        for (const [id, lease] of asset.fine)
            if (!wanted.has(id)) {
                lease.release();
                asset.fine.delete(id);
            }
        for (const id of wanted)
            if (!asset.fine.has(id)) {
                const lease = asset.manager.acquirePage(id, {
                    priority: asset.name === 'arch' ? 10 : 5
                });
                asset.fine.set(id, lease);
                void lease.ready.catch((error: unknown) => {
                    if (!disposed && asset.fine.get(id) === lease) handleFailure(error);
                });
            }
    }
    updateStatus();
}
function updateStatus(): void {
    if (disposed) return;
    let available = 0,
        requested = 0;
    for (const asset of streamed)
        for (const lease of [...asset.coarse, ...asset.fine.values()]) {
            requested++;
            if (asset.meshlets.hasPage(lease.pageId)) available++;
        }
    element('residency-fill', HTMLElement).style.width =
        `${String(requested === 0 ? 0 : (available / requested) * 100)}%`;
    element('strata-status', HTMLElement).textContent = !streaming
        ? 'Coarse pages retained'
        : available < requested
          ? `Refining ${String(available)} / ${String(requested)}`
          : detail === 'coarse'
            ? 'Coarse comparison'
            : 'Ready';
    element('clusters', HTMLElement).textContent = (gpu?.visibleMeshletCount ?? 0).toLocaleString(
        'en-US'
    );
    element('resident', HTMLElement).textContent =
        `${((gpu?.residentBytes ?? 0) / 1048576).toFixed(1)} MB`;
    element('cpu', HTMLElement).textContent = `${(diagnostics().cpuBytes / 1048576).toFixed(1)} MB`;
}
function sampleDiagnostics(): void {
    if (!factory || diagnosticsWork || disposed || suspended) return;
    diagnosticsWork = factory
        .readDiagnostics()
        .then(value => {
            if (!disposed) {
                gpu = value.meshletGeometry;
                updateStatus();
            }
        })
        .catch((error: unknown) => {
            if (!disposed) handleFailure(error);
            else console.error(error);
        })
        .finally(() => {
            diagnosticsWork = undefined;
        });
}
function dispose(): void {
    if (disposed) return;
    disposed = true;
    ready = false;
    rendering = false;
    ticker.stop();
    frameControl?.dispose();
    controls?.dispose();
    events.abort();
    awaken?.();
    awaken = undefined;
    delete window.__HILO3D_TEST_CAPTURE__;
    const failures: unknown[] = [];
    for (const asset of streamed) {
        try {
            asset.manager.destroy();
        } catch (error) {
            failures.push(error);
        }
    }
    document.body.dataset['disposed'] = 'true';
    document.body.dataset['ready'] = 'false';
    cleanup = (async (): Promise<void> => {
        try {
            await diagnosticsWork;
            await stage?.renderer.waitForIdle();
        } catch (error) {
            failures.push(error);
        }
        try {
            stage?.destroy();
        } catch (error) {
            failures.push(error);
        }
        for (const texture of textures.values()) {
            try {
                texture.destroy();
            } catch (error) {
                failures.push(error);
            }
        }
        streamed.length = 0;
        geometries.clear();
        materials.clear();
        textures.clear();
        stage = undefined;
        controls = undefined;
        factory = undefined;
        gpu = null;
        if (failures.length > 0)
            throw new AggregateError(failures, 'STRATA resource cleanup failed');
    })();
    void cleanup.catch((error: unknown) => {
        console.error(error);
    });
}
async function active(): Promise<boolean> {
    while (suspended && !disposed)
        await new Promise<void>(resolve => {
            awaken = resolve;
        });
    return !disposed;
}

async function waitForCurrentFineDemand(): Promise<boolean> {
    while (await active()) {
        requestDemand();
        const pending = streamed.flatMap(asset =>
            [...asset.fine].map(([id, lease]) => ({ asset, id, lease }))
        );
        await Promise.all(
            pending.map(async ({ asset, id, lease }) => {
                try {
                    await lease.ready;
                } catch (error) {
                    // Resizing or navigating can replace a lease while its real response is pending.
                    // A failure for a still-current lease must retain the normal failure path.
                    if (!disposed && asset.fine.get(id) === lease) throw error;
                }
            })
        );
        if (!(await active())) return false;
        requestDemand();
        if (
            pending.length === streamed.reduce((count, asset) => count + asset.fine.size, 0) &&
            pending.every(({ asset, id, lease }) => asset.fine.get(id) === lease)
        )
            return true;
    }
    return false;
}

installPageLifecycle({
    pause(): void {
        suspended = true;
        ticker.pause();
        frameControl?.setSuspended(true);
        controls?.disable();
    },
    resume(): void {
        suspended = false;
        controls?.enable();
        frameControl?.setSuspended(false);
        ticker.resume();
        awaken?.();
        awaken = undefined;
    },
    dispose
});
window.__HILO3D_STRATA__ = { diagnostics, setView, dispose };
ticker.addTick({
    tick(delta: number): void {
        if (disposed || suspended) return;
        for (const asset of streamed) asset.manager.update();
        if (!rendering || !stage) return;
        try {
            if (submittedFrames % 5 === 0 || demandDirty) requestDemand();
            stage.tick(delta);
            submittedFrames++;
            if (submittedFrames % 15 === 0) sampleDiagnostics();
        } catch (error) {
            handleFailure(error);
        }
    }
});
ticker.start();

async function initialize(): Promise<void> {
    scene = parseScene(await json('scene.json'));
    if (!(await active())) return;
    const paths = [
        ...new Set(
            Object.values(scene.materials).flatMap(material =>
                material.texture ? [material.texture] : []
            )
        )
    ];
    await Promise.all(paths.map(loadTexture));
    if (!(await active())) return;
    for (const [name, definition] of Object.entries(scene.materials)) {
        const texture = definition.texture ? textures.get(definition.texture) : undefined;
        materials.set(
            name,
            new H.PBRMaterial({
                name: `STRATA ${name}`,
                baseColor: new H.Color(...definition.color),
                metallic: definition.metallic,
                roughness: definition.roughness,
                ...(texture ? { baseColorMap: { texture, encoding: 'srgb' } } : {})
            })
        );
    }
    for (const description of scene.assets) {
        if (!(await active())) return;
        if (!description.streamed) {
            geometries.set(
                description.name,
                parseGeometry(await json(description.geometryURL ?? ''))
            );
            continue;
        }
        const manifest = H.snapshotMeshletAssetManifest(await json(description.manifestURL ?? ''));
        const meshlets = new H.MeshletGeometry(manifest, {
            maxResidentBytes: (description.name === 'arch' ? 8 : 4) * 1048576,
            maxUploadBytesPerFrame: 512 * 1024,
            maxVisibleMeshlets: 32_768,
            maximumProjectedError: 0.9
        });
        const manager = new GeometryPageManager(
            meshlets,
            {
                id: `strata-${description.name}`,
                version: scene.contentVersion,
                pages: manifest.pages.map(page => ({
                    pageId: page.id,
                    url: new URL(
                        `page-${String(page.id)}.bin`,
                        new URL(description.manifestURL ?? '', base)
                    ).href
                }))
            },
            {
                autoUpdate: false,
                budgets: {
                    concurrentRequests: 4,
                    queuedPages: manifest.pages.length,
                    sourceBytes: 65536,
                    cpuBytes: 16 * 1048576,
                    inFlightBytes: 1048576,
                    decodesPerUpdate: 8,
                    decodeBytesPerUpdate: 256 * 1024
                }
            }
        );
        const coarse = manifest.groups.map(group => {
            const lod = group.lods.at(-1);
            if (!lod) throw new Error('STRATA requires complete coarse groups');
            return manager.acquirePage(lod.pageId, { priority: 20 });
        });
        streamed.push({
            name: description.name,
            meshlets,
            manager,
            coarse,
            fine: new Map(),
            instances: scene.instances.filter(item => item.asset === description.name)
        });
    }
    element('loading-message', HTMLElement).textContent = 'Laying the first stone layers…';
    await Promise.all(streamed.flatMap(asset => asset.coarse.map(lease => lease.ready)));
    if (!(await active())) return;
    for (const asset of streamed)
        geometries.set(asset.name, H.createMeshletFallbackGeometry(asset.meshlets));
    const buckets = scene.assets.map(description => {
        const geometry = geometries.get(description.name),
            material = materials.get(description.material);
        if (!geometry || !material) throw new Error('STRATA material or geometry missing');
        const meshlets = streamed.find(asset => asset.name === description.name)?.meshlets;
        return { geometry, material, ...(meshlets ? { meshlets } : {}) };
    });
    factory = new H.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: 512,
        maxLights: 8,
        maxLightIndices: 131072,
        maxLightsPerCluster: 8,
        maxViewportWidth: 1920,
        maxViewportHeight: 1080,
        temporalAA: { sharpness: 0.12 },
        groundTruthAmbientOcclusion: {
            quality: 'low',
            radius: 0.65,
            intensity: 0.85,
            directionCount: 2,
            stepCount: 4
        },
        volumetricLighting: {
            quality: 'low',
            density: 0.0028,
            baseHeight: 0,
            heightFalloff: 0.07,
            maxDistance: 120,
            albedo: new H.Color(0.95, 0.9, 0.82),
            anisotropy: 0.15,
            ambientStrength: 0.18,
            shadowSteps: 2,
            historyWeight: 0.9
        },
        bloomStrength: 0.015,
        exposure: 1.05,
        hiZ: true
    });
    const camera = new H.PerspectiveCamera({
        near: 0.08,
        far: 170,
        fov: fov(),
        aspect: innerWidth / innerHeight,
        depthMode: 'reversed'
    });
    const createdStage = await H.Stage.create({
        container: element('container', HTMLElement),
        backend: resolveExampleBackend(),
        camera,
        width: innerWidth,
        height: innerHeight,
        pixelRatio: pixelRatio(),
        antialias: false,
        renderingProfile: 'high-end',
        clearColor: new H.Color(0.66, 0.76, 0.86),
        renderPipeline: factory
    });
    if (disposed) {
        createdStage.destroy();
        return;
    }
    stage = createdStage;
    stage.canvas.id = 'strata-canvas';
    for (const description of scene.instances) {
        const geometry = geometries.get(description.asset);
        const materialName = scene.assets.find(asset => asset.name === description.asset)?.material;
        const material = materialName ? materials.get(materialName) : undefined;
        if (!geometry || !material) throw new Error('STRATA instance resource missing');
        new H.Mesh({
            name: description.name,
            geometry,
            material,
            x: description.position[0],
            y: description.position[1],
            z: description.position[2],
            scaleX: description.scale[0],
            scaleY: description.scale[1],
            scaleZ: description.scale[2],
            rotationY: description.rotationY,
            castShadows: description.name !== 'Gallery floor',
            receiveShadows: true
        }).addTo(stage);
        coarseTriangles += (geometry.indices?.data.length ?? 0) / 3;
    }
    new H.DirectionalLight({
        direction: new H.Vector3(0.25, -0.8, -1.5),
        color: new H.Color(1, 0.88, 0.7),
        amount: 3.2,
        shadow:
            query.get('shadows') === '0'
                ? null
                : {
                      width: reduced ? 1024 : 2048,
                      height: reduced ? 1024 : 2048,
                      cascadeCount: 2,
                      cascadeMaxDistance: 70,
                      cascadeBlend: 0.12,
                      shadowStrength: 1,
                      minBias: 0.002,
                      maxBias: 0.012
                  }
    }).addTo(stage);
    new H.DirectionalLight({
        direction: new H.Vector3(-0.25, -0.65, -0.75),
        color: new H.Color(0.7, 0.82, 1),
        amount: 0.5
    }).addTo(stage);
    new H.AmbientLight({ color: new H.Color(0.88, 0.88, 0.85), amount: 0.4 }).addTo(stage);
    addSky(stage);
    stage.updateMatrixWorld(true);
    stage.traverse(node => {
        node.autoUpdateWorldMatrix = false;
        return H.Node.TRAVERSE_STOP_NONE;
    });
    controls = new H.OrbitControls(stage, {
        camera,
        target: new H.Vector3(-1, 3.3, -7),
        minDistance: 2.5,
        maxDistance: 55,
        minPolarAngle: 0.35,
        maxPolarAngle: 1.53,
        rotateSpeed: 0.65,
        zoomSpeed: 0.65,
        panSpeed: 0.7
    });
    controls.onChange = (): void => {
        demandDirty = true;
    };
    setView(view);
    element('detail-mode', HTMLSelectElement).addEventListener(
        'change',
        event => {
            const select = event.currentTarget;
            if (!(select instanceof HTMLSelectElement)) return;
            detail = select.value === 'coarse' ? 'coarse' : 'adaptive';
            demandDirty = true;
            requestDemand();
        },
        { signal: events.signal }
    );
    element('streaming-toggle', HTMLInputElement).addEventListener(
        'change',
        event => {
            const checkbox = event.currentTarget;
            if (!(checkbox instanceof HTMLInputElement)) return;
            streaming = checkbox.checked;
            element('streaming-label', HTMLElement).textContent = streaming ? 'On' : 'Off';
            demandDirty = true;
            requestDemand();
        },
        { signal: events.signal }
    );
    for (const name of ['overview', 'passage', 'surface'] as const)
        element(`view-${name}`, HTMLButtonElement).addEventListener(
            'click',
            () => {
                setView(name);
            },
            { signal: events.signal }
        );
    window.addEventListener(
        'resize',
        () => {
            if (disposed || !stage) return;
            camera.aspect = innerWidth / innerHeight;
            camera.fov = fov();
            stage.resize(innerWidth, innerHeight, pixelRatio());
            demandDirty = true;
        },
        { signal: events.signal }
    );
    if (testMode) {
        frameControl = createTestFrameControl(ticker, () => createdStage.renderer.waitForIdle());
        window.__HILO3D_TEST_CAPTURE__ = frameControl;
    }
    rendering = true;
    requestDemand();
    element('loading-message', HTMLElement).textContent = 'Finding the detail in the stone…';
    if (!(await waitForCurrentFineDemand())) return;
    if (frameControl) await frameControl.waitForFrames(4);
    else await stage.renderer.waitForIdle();
    sampleDiagnostics();
    await diagnosticsWork;
    if (!(await active())) return;
    ready = true;
    document.body.dataset['ready'] = 'true';
    element('loading', HTMLElement).hidden = true;
    updateStatus();
}
void initialize().catch((error: unknown) => {
    if (!disposed) handleFailure(error);
});
