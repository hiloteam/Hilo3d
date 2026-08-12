import * as Hilo3d from '../src/Hilo3d';

const ATRIUM_WIDTH = 27.4;
const MAX_VIEWPORT_WIDTH = 2560;
const MAX_VIEWPORT_HEIGHT = 1440;
const TOUR_SECONDS_PER_VIEW = 7;
const BEAM_INTENSITY_SCALE = 5;

interface ResourceProgress {
    readonly url: string;
    readonly loaded: number;
    readonly total: number;
}

interface ModelBucketPlan {
    readonly buckets: readonly Hilo3d.GPUSceneBucket[];
    readonly excludedMeshCount: number;
}

interface BeamDescriptor {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly color: readonly [number, number, number];
    readonly amount: number;
    readonly range: number;
    readonly cutoff: number;
    readonly outerCutoff: number;
    readonly palette: number;
    readonly phase: number;
}

interface BeamRuntime {
    readonly light: Hilo3d.SpotLight;
    readonly marker: Hilo3d.Mesh;
    readonly descriptor: BeamDescriptor;
}

interface Viewpoint {
    readonly label: string;
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
}

interface VolumetricReliquaryEvidence {
    readonly backend: 'webgpu';
    readonly volumetricLighting: boolean;
    readonly froxelCount: number;
    readonly historyUsed: boolean;
    readonly clusterOverflowCount: number;
    readonly localVolumeCount: 7;
    readonly heroAsset: 'Khronos Sponza';
}

const PALETTES = Object.freeze([
    { light: [0.14, 0.92, 1], emission: [0.12, 4.6, 6.2] },
    { light: [0.74, 0.22, 1], emission: [3.1, 0.36, 6.5] },
    { light: [1, 0.18, 0.58], emission: [6.5, 0.16, 2.4] },
    { light: [1, 0.58, 0.14], emission: [6.1, 2.2, 0.18] }
] as const);

const BEAMS = Object.freeze([
    {
        position: [10.8, 6.15, -3.65],
        target: [-6.8, 1.15, 2.15],
        color: PALETTES[0].light,
        amount: 96,
        range: 17,
        cutoff: 4.5,
        outerCutoff: 10.5,
        palette: 0,
        phase: 0.1
    },
    {
        position: [9.1, 6.05, 3.65],
        target: [-6.4, 0.95, -2.35],
        color: PALETTES[2].light,
        amount: 90,
        range: 17,
        cutoff: 4.2,
        outerCutoff: 10,
        palette: 2,
        phase: 1.2
    },
    {
        position: [5.1, 6.45, -3.85],
        target: [-7.1, 0.9, 1.75],
        color: PALETTES[1].light,
        amount: 94,
        range: 18,
        cutoff: 4.5,
        outerCutoff: 10.8,
        palette: 1,
        phase: 2.4
    },
    {
        position: [3.5, 6.35, 3.85],
        target: [-6.3, 1.05, -1.8],
        color: PALETTES[3].light,
        amount: 92,
        range: 18,
        cutoff: 4.2,
        outerCutoff: 10.2,
        palette: 3,
        phase: 3.1
    },
    {
        position: [-4.5, 6.25, -4.2],
        target: [-1, 0.65, 4],
        color: PALETTES[0].light,
        amount: 92,
        range: 18,
        cutoff: 4.2,
        outerCutoff: 10.5,
        palette: 0,
        phase: 4.3
    },
    {
        position: [-1, 6.2, 4.2],
        target: [2.5, 0.8, -4],
        color: PALETTES[2].light,
        amount: 94,
        range: 17,
        cutoff: 4.4,
        outerCutoff: 10.4,
        palette: 2,
        phase: 5.2
    },
    {
        position: [3, 6.3, -4.2],
        target: [6.5, 0.75, 4],
        color: PALETTES[1].light,
        amount: 90,
        range: 15,
        cutoff: 4.6,
        outerCutoff: 11,
        palette: 1,
        phase: 6.3
    },
    {
        position: [6.5, 6.2, 4.2],
        target: [9.5, 0.95, -4],
        color: PALETTES[3].light,
        amount: 88,
        range: 15,
        cutoff: 4.4,
        outerCutoff: 10.6,
        palette: 3,
        phase: 7.1
    }
] as const) satisfies readonly BeamDescriptor[];

const VIEWPOINTS = Object.freeze([
    {
        label: 'Processional nave',
        position: [-9.2, 2.3, 0],
        target: [-1.8, 2.25, 0]
    },
    {
        label: 'Chromatic crossing',
        position: [-3, 2.55, -0.55],
        target: [4, 2.3, 0.75]
    },
    {
        label: 'Upper reliquary',
        position: [1.5, 6.2, 0],
        target: [5.5, 2.3, 0]
    },
    {
        label: 'Eastern apse',
        position: [5.5, 2.45, -0.15],
        target: [10, 2.3, 0]
    },
    {
        label: 'Veil chamber',
        position: [2, 2.6, 0.55],
        target: [9, 2.3, -0.7]
    }
] as const) satisfies readonly Viewpoint[];

const TOUR_CYCLE_SECONDS = VIEWPOINTS.length * TOUR_SECONDS_PER_VIEW;

function requireElement<ElementType extends HTMLElement>(
    selector: string,
    constructor: new () => ElementType
): ElementType {
    const element = document.querySelector(selector);
    if (!(element instanceof constructor)) throw new Error(`Missing example element ${selector}`);
    return element;
}

function isResourceProgress(value: unknown): value is ResourceProgress {
    return (
        typeof value === 'object' &&
        value !== null &&
        'url' in value &&
        typeof value.url === 'string' &&
        'loaded' in value &&
        typeof value.loaded === 'number' &&
        'total' in value &&
        typeof value.total === 'number'
    );
}

function compatibleAttribute(
    data: Hilo3d.GeometryData | null,
    size: 2 | 3 | 4,
    vertexCount?: number
): boolean {
    return (
        data === null ||
        (data.data instanceof Float32Array &&
            data.size === size &&
            data.stride === 0 &&
            data.offset === 0 &&
            !data.normalized &&
            (vertexCount === undefined || data.count === vertexCount))
    );
}

function isForwardPlusGeometry(geometry: Hilo3d.Geometry): boolean {
    try {
        if (
            geometry.mode !== Hilo3d.constants.webgl.TRIANGLES ||
            geometry.isMorphGeometry ||
            geometry.vertices === null ||
            geometry.indices === null
        ) {
            return false;
        }
        const vertices = geometry.vertices;
        const normals = geometry.normals;
        const indices = geometry.indices;
        if (
            normals === null ||
            !compatibleAttribute(vertices, 3) ||
            !compatibleAttribute(normals, 3, vertices.count) ||
            !(indices.data instanceof Uint16Array || indices.data instanceof Uint32Array) ||
            indices.size !== 1 ||
            indices.stride !== 0 ||
            indices.offset !== 0 ||
            indices.normalized
        ) {
            return false;
        }
        const uv0 = geometry.uvs;
        const uv1 = geometry.uvs1;
        const tangent0 = uv0 === null ? null : geometry.tangents;
        const tangent1 = uv1 === null ? null : geometry.tangents1;
        return (
            compatibleAttribute(uv0, 2, vertices.count) &&
            compatibleAttribute(uv1, 2, vertices.count) &&
            compatibleAttribute(tangent0, 4, vertices.count) &&
            compatibleAttribute(tangent1, 4, vertices.count)
        );
    } catch {
        return false;
    }
}

function isForwardPlusMaterial(material: Hilo3d.MaterialInstance): material is Hilo3d.PBRMaterial {
    return (
        material instanceof Hilo3d.PBRMaterial &&
        !material.isTransparent &&
        material.opacity === 1 &&
        material.coverage.mode === 'opaque' &&
        material.lightType === 'PBR' &&
        material.getTextureSlot('parallax') === null &&
        material.diffuseEnvMap === null &&
        material.diffuseEnvSphereHarmonics3 === null &&
        material.brdfLUT === null &&
        material.specularEnvMap === null &&
        material.specularGlossinessMap === null &&
        material.lightMap === null &&
        material.clearcoatMap === null &&
        material.clearcoatRoughnessMap === null &&
        material.clearcoatNormalMap === null &&
        material.anisotropyMap === null &&
        material.transmissionMap === null &&
        material.thicknessMap === null &&
        material.iridescenceMap === null &&
        material.iridescenceThicknessMap === null &&
        !material.isSpecularGlossiness &&
        material.clearcoatFactor === 0 &&
        material.anisotropyStrength === 0 &&
        material.transmissionFactor === 0 &&
        material.thicknessFactor === 0 &&
        material.iridescenceFactor === 0
    );
}

function createModelBucketPlan(
    model: Hilo3d.GLTFModel,
    maximumBucketCount = Number.POSITIVE_INFINITY
): Readonly<ModelBucketPlan> {
    const materialSets = new Map<Hilo3d.Geometry, Set<Hilo3d.PBRMaterial>>();
    const buckets: Hilo3d.GPUSceneBucket[] = [];
    let excludedMeshCount = 0;
    for (const mesh of model.meshes) {
        const geometry = mesh.geometry;
        const material = mesh.material;
        if (
            geometry === null ||
            material === null ||
            !isForwardPlusGeometry(geometry) ||
            !isForwardPlusMaterial(material)
        ) {
            mesh.visible = false;
            excludedMeshCount += 1;
            continue;
        }
        let materials = materialSets.get(geometry);
        if (materials === undefined) {
            materials = new Set();
            materialSets.set(geometry, materials);
        }
        if (materials.has(material)) continue;
        if (buckets.length >= maximumBucketCount) {
            mesh.visible = false;
            excludedMeshCount += 1;
            continue;
        }
        materials.add(material);
        buckets.push(Object.freeze({ geometry, material }));
    }
    return Object.freeze({ buckets: Object.freeze(buckets), excludedMeshCount });
}

function normalizeModel(model: Hilo3d.GLTFModel): void {
    const bounds = model.node.getBounds();
    if (bounds === undefined || bounds.width <= 0) {
        throw new RangeError('Khronos Sponza does not expose usable world bounds.');
    }
    const scale = ATRIUM_WIDTH / bounds.width;
    model.node.setScale(scale);
    model.node.setPosition(-bounds.x * scale, -bounds.yMin * scale, -bounds.z * scale);
}

function tupleVector(
    tuple: readonly [number, number, number],
    target: Hilo3d.Vector3
): Hilo3d.Vector3 {
    return target.set(tuple[0], tuple[1], tuple[2]);
}

function directionToTarget(
    position: readonly [number, number, number],
    target: readonly [number, number, number]
): Hilo3d.Vector3 {
    return new Hilo3d.Vector3(
        target[0] - position[0],
        target[1] - position[1],
        target[2] - position[2]
    ).normalize();
}

function formatCount(value: number): string {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
        value
    );
}

function viewportPixelRatio(): number {
    const deviceRatio = Math.min(window.devicePixelRatio || 1, 1.4);
    return Math.min(
        deviceRatio,
        MAX_VIEWPORT_WIDTH / Math.max(window.innerWidth, 1),
        MAX_VIEWPORT_HEIGHT / Math.max(window.innerHeight, 1)
    );
}

function smootherStep(value: number): number {
    const clamped = Math.max(0, Math.min(1, value));
    return clamped * clamped * clamped * (clamped * (clamped * 6 - 15) + 10);
}

function interpolateTuple(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    amount: number,
    target: Hilo3d.Vector3
): Hilo3d.Vector3 {
    return target.set(
        from[0] + (to[0] - from[0]) * amount,
        from[1] + (to[1] - from[1]) * amount,
        from[2] + (to[2] - from[2]) * amount
    );
}

function interpolateTourPosition(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    amount: number,
    arcDirection: number,
    target: Hilo3d.Vector3
): Hilo3d.Vector3 {
    const arc = Math.sin(amount * Math.PI);
    return target.set(
        from[0] + (to[0] - from[0]) * amount,
        from[1] + (to[1] - from[1]) * amount + arc * 0.22,
        from[2] + (to[2] - from[2]) * amount + arc * arcDirection * 0.5
    );
}

function debugViewFromQuery(value: string | null): Hilo3d.VolumetricLightingDebugView {
    if (value === 'radiance' || value === 'transmittance') return value;
    return 'none';
}

function nextDebugView(value: Hilo3d.VolumetricLightingDebugView): string | null {
    if (value === 'none') return 'radiance';
    if (value === 'radiance') return 'transmittance';
    return null;
}

function debugLabel(value: Hilo3d.VolumetricLightingDebugView): string {
    if (value === 'radiance') return 'Radiance';
    if (value === 'transmittance') return 'Transmittance';
    return 'Composite';
}

function updateQuery(key: string, value: string | null): void {
    const next = new URL(location.href);
    if (value === null) next.searchParams.delete(key);
    else next.searchParams.set(key, value);
    location.assign(next.href);
}

function createEmitterMaterials(): readonly Hilo3d.PBRMaterial[] {
    return Object.freeze(
        PALETTES.map(
            palette =>
                new Hilo3d.PBRMaterial({
                    baseColor: new Hilo3d.Color(
                        palette.light[0] * 0.045,
                        palette.light[1] * 0.045,
                        palette.light[2] * 0.045
                    ),
                    emissionFactor: new Hilo3d.Color(...palette.emission),
                    metallic: 0.28,
                    roughness: 0.16
                })
        )
    );
}

function createBeamRig(
    stage: Hilo3d.Stage<'webgpu'>,
    geometry: Hilo3d.Geometry,
    materials: readonly Hilo3d.PBRMaterial[]
): readonly BeamRuntime[] {
    const root = new Hilo3d.Node({ name: 'Neon reliquary beam rig' }).addTo(stage);
    return Object.freeze(
        BEAMS.map(descriptor => {
            const material = materials[descriptor.palette];
            if (material === undefined) throw new Error('Beam emitter palette is incomplete.');
            const light = new Hilo3d.SpotLight({
                x: descriptor.position[0],
                y: descriptor.position[1],
                z: descriptor.position[2],
                color: new Hilo3d.Color(...descriptor.color),
                direction: directionToTarget(descriptor.position, descriptor.target),
                amount: descriptor.amount * BEAM_INTENSITY_SCALE,
                range: descriptor.range,
                cutoff: descriptor.cutoff * 0.75,
                outerCutoff: descriptor.outerCutoff * 0.72
            }).addTo(root);
            const marker = new Hilo3d.Mesh({
                x: descriptor.position[0],
                y: descriptor.position[1],
                z: descriptor.position[2],
                geometry,
                material,
                useInstanced: true,
                frustumTest: true
            })
                .setScale(0.95)
                .addTo(root);
            return Object.freeze({ light, marker, descriptor });
        })
    );
}

function addFloorRelics(stage: Hilo3d.Stage<'webgpu'>): number {
    const colors = [
        new Hilo3d.Color(0.06, 0.78, 1),
        new Hilo3d.Color(0.86, 0.16, 1),
        new Hilo3d.Color(1, 0.22, 0.48),
        new Hilo3d.Color(1, 0.62, 0.16)
    ] as const;
    for (let index = 0; index < 12; index += 1) {
        const side = index % 2 === 0 ? -1 : 1;
        const x = -10.8 + index * 1.95;
        const color = colors[index % colors.length];
        if (color === undefined) throw new Error('Floor relic palette is incomplete.');
        new Hilo3d.PointLight({
            x,
            y: 0.52,
            z: side * 2.75,
            color,
            amount: 12,
            range: 4.2
        }).addTo(stage);
    }
    return colors.length * 3;
}

async function run(): Promise<void> {
    const searchParameters = new URLSearchParams(location.search);
    const volumetricEnabled = searchParameters.get('volume') !== 'false';
    const debugView = debugViewFromQuery(searchParameters.get('debug'));
    const testMode = searchParameters.get('test') === '1';
    const motionPreference = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const container = requireElement('#container', HTMLElement);
    const controlsFieldset = requireElement('#controlsFieldset', HTMLFieldSetElement);
    const loadingPanel = requireElement('#loadingPanel', HTMLElement);
    const loadingTitle = requireElement('#loadingTitle', HTMLElement);
    const loadingDetail = requireElement('#loadingDetail', HTMLElement);
    const loadingProgress = requireElement('#loadingProgress', HTMLElement);
    const backendLabel = requireElement('#backendLabel', HTMLElement);
    const volumeToggle = requireElement('#volumeToggle', HTMLButtonElement);
    const volumeState = requireElement('#volumeState', HTMLElement);
    const motionToggle = requireElement('#motionToggle', HTMLButtonElement);
    const motionState = requireElement('#motionState', HTMLElement);
    const tourToggle = requireElement('#tourToggle', HTMLButtonElement);
    const tourState = requireElement('#tourState', HTMLElement);
    const debugButton = requireElement('#debugButton', HTMLButtonElement);
    const debugState = requireElement('#debugState', HTMLElement);
    const viewButton = requireElement('#viewButton', HTMLButtonElement);
    const metricFroxels = requireElement('#metricFroxels', HTMLElement);
    const metricHistory = requireElement('#metricHistory', HTMLElement);
    const metricLights = requireElement('#metricLights', HTMLElement);
    const metricFps = requireElement('#metricFps', HTMLElement);

    document.body.dataset['asset'] = 'khronos-sponza';
    document.body.dataset['volumetricEnabled'] = String(volumetricEnabled);
    document.body.dataset['volumetricDebug'] = debugView;

    const loader = new Hilo3d.GLTFLoader();
    loader.on('progress', event => {
        if (!isResourceProgress(event.detail)) return;
        const { loaded, total, url } = event.detail;
        const name = url.slice(url.lastIndexOf('/') + 1) || 'resource';
        loadingTitle.textContent = `Streaming ${name}`;
        if (total > 0) {
            const percentage = Math.min(100, Math.round((loaded / total) * 100));
            loadingDetail.textContent = `${formatCount(loaded)} of ${formatCount(total)} bytes`;
            loadingProgress.style.width = `${String(Math.max(8, percentage))}%`;
        } else {
            loadingDetail.textContent = `${formatCount(loaded)} bytes received`;
            loadingProgress.style.width = '34%';
        }
    });

    const model = await loader.load({
        src: new URL('./models/Sponza/glTF/Sponza.gltf', location.href).href,
        isProgressive: true,
        ignoreTextureError: false
    });
    loadingTitle.textContent = 'Resolving the material archive';
    loadingDetail.textContent = `${String(model.textures.length)} textures · ${String(model.meshes.length)} scene meshes`;
    loadingProgress.style.width = '72%';
    await model.ready;
    normalizeModel(model);
    for (const mesh of model.meshes) mesh.frustumTest = true;

    const modelBucketPlan = createModelBucketPlan(model, testMode ? 12 : Number.POSITIVE_INFINITY);
    const emitterGeometry = new Hilo3d.SphereGeometry({
        radius: 0.085,
        widthSegments: 16,
        heightSegments: 10
    });
    const emitterMaterials = createEmitterMaterials();
    const emitterBuckets = emitterMaterials.map(material =>
        Object.freeze({ geometry: emitterGeometry, material })
    );
    const buckets: readonly Hilo3d.GPUSceneBucket[] = Object.freeze([
        ...modelBucketPlan.buckets,
        ...emitterBuckets
    ]);

    const driftingMist = new Hilo3d.Vector3(-4.8, 2.2, -0.2);
    const roseMist = new Hilo3d.Vector3(5.8, 2.6, 0.25);
    const naveVolume = new Hilo3d.Vector3(0, 2.8, 0);
    const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: testMode ? 256 : 1024,
        maxLights: testMode ? 32 : 96,
        maxLightIndices: testMode ? 131_072 : 2_097_152,
        maxLightsPerCluster: testMode ? 32 : 64,
        tileSize: testMode ? 32 : 16,
        zSlices: testMode ? 16 : 32,
        maxViewportWidth: testMode ? 960 : MAX_VIEWPORT_WIDTH,
        maxViewportHeight: testMode ? 600 : MAX_VIEWPORT_HEIGHT,
        hiZ: true,
        temporalAA: {
            renderScale: testMode ? 0.5 : 0.82,
            historyWeight: 0.92,
            depthThreshold: 0.022,
            varianceGamma: 1.2,
            sharpness: 0.11
        },
        volumetricLighting: volumetricEnabled
            ? {
                  quality: testMode ? 'low' : 'high',
                  stepCount: testMode ? 12 : 28,
                  shadowSteps: testMode ? 1 : 3,
                  density: 0.006,
                  baseHeight: -0.4,
                  heightFalloff: 0.055,
                  maxDistance: 42,
                  albedo: new Hilo3d.Color(0.88, 0.94, 1),
                  anisotropy: 0.28,
                  ambientStrength: 0.08,
                  jitterStrength: 0.82,
                  historyWeight: 0.9,
                  depthThreshold: 0.035,
                  debugView,
                  localVolumes: [
                      {
                          shape: 'box',
                          center: naveVolume,
                          halfExtents: new Hilo3d.Vector3(13.2, 3.8, 5.2),
                          density: 0.009,
                          edgeFalloff: 0.18,
                          albedo: new Hilo3d.Color(0.8, 0.9, 1)
                      },
                      {
                          shape: 'sphere',
                          center: driftingMist,
                          radius: 4.8,
                          density: 0.014,
                          edgeFalloff: 0.42,
                          albedo: new Hilo3d.Color(0.56, 0.9, 1)
                      },
                      {
                          shape: 'sphere',
                          center: roseMist,
                          radius: 4.2,
                          density: 0.012,
                          edgeFalloff: 0.38,
                          albedo: new Hilo3d.Color(1, 0.55, 0.78)
                      },
                      {
                          shape: 'sphere',
                          center: new Hilo3d.Vector3(-2.75, 3.4, -0.1),
                          radius: 2.35,
                          density: 0.022,
                          edgeFalloff: 0.52,
                          albedo: new Hilo3d.Color(0.48, 0.93, 1)
                      },
                      {
                          shape: 'sphere',
                          center: new Hilo3d.Vector3(0.75, 3.5, 0.1),
                          radius: 2.25,
                          density: 0.02,
                          edgeFalloff: 0.52,
                          albedo: new Hilo3d.Color(1, 0.42, 0.76)
                      },
                      {
                          shape: 'sphere',
                          center: new Hilo3d.Vector3(4.75, 3.5, -0.1),
                          radius: 2.3,
                          density: 0.021,
                          edgeFalloff: 0.52,
                          albedo: new Hilo3d.Color(0.7, 0.46, 1)
                      },
                      {
                          shape: 'sphere',
                          center: new Hilo3d.Vector3(8, 3.55, 0.1),
                          radius: 2.25,
                          density: 0.02,
                          edgeFalloff: 0.52,
                          albedo: new Hilo3d.Color(1, 0.72, 0.3)
                      }
                  ]
              }
            : false,
        bloomStrength: 0.74,
        exposure: 1.2
    });

    loadingTitle.textContent = 'Allocating temporal froxel fields';
    loadingDetail.textContent = `${String(modelBucketPlan.buckets.length)} PBR buckets · ${String(BEAMS.length)} chromatic beam sources`;
    loadingProgress.style.width = '91%';

    const camera = new Hilo3d.PerspectiveCamera({
        aspect: window.innerWidth / Math.max(window.innerHeight, 1),
        fov: 50,
        near: 0.05,
        far: 70,
        depthMode: 'reversed'
    });
    const stage = await Hilo3d.Stage.create<'webgpu'>({
        backend: 'webgpu',
        container,
        camera,
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: viewportPixelRatio(),
        antialias: false,
        alpha: false,
        clearColor: new Hilo3d.Color(0.0015, 0.0025, 0.006),
        useInstanced: true,
        renderingProfile: 'high-end',
        renderPipeline: factory
    });
    model.node.name = 'Khronos Sponza neon reliquary';
    model.node.addTo(stage);

    new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(0.22, 0.3, 0.46),
        amount: 0.46
    }).addTo(stage);
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(0.44, 0.58, 0.86),
        amount: 0.82,
        direction: new Hilo3d.Vector3(-0.28, -0.9, 0.18)
    }).addTo(stage);
    const beams = createBeamRig(stage, emitterGeometry, emitterMaterials);
    const floorRelicCount = addFloorRelics(stage);
    const totalLightCount = BEAMS.length + floorRelicCount + 1;

    const cameraPosition = new Hilo3d.Vector3();
    const cameraTarget = new Hilo3d.Vector3();
    const firstView = VIEWPOINTS[0];
    const controls = new Hilo3d.OrbitControls(stage, {
        camera,
        target: tupleVector(firstView.target, cameraTarget),
        enablePan: true,
        minDistance: 0.8,
        maxDistance: 38,
        minPolarAngle: 0.14,
        maxPolarAngle: Math.PI - 0.14,
        rotateSpeed: 0.64,
        zoomSpeed: 0.82,
        panSpeed: 0.48
    });
    controls.setView(tupleVector(firstView.position, cameraPosition), cameraTarget);

    let motionEnabled = !testMode && searchParameters.get('motion') !== 'false' && motionPreference;
    let tourEnabled = !testMode && searchParameters.get('tour') !== 'false' && motionPreference;
    let activeViewIndex = 0;
    let elapsed = 0;
    let tourElapsed = 0;

    function setMotionEnabled(value: boolean): void {
        motionEnabled = value;
        motionToggle.setAttribute('aria-pressed', String(value));
        motionState.textContent = value ? 'Live' : 'Held';
        document.body.dataset['lightMotion'] = String(value);
    }

    function setTourEnabled(value: boolean): void {
        tourEnabled = value;
        tourToggle.setAttribute('aria-pressed', String(value));
        tourState.textContent = value ? 'Live' : 'Held';
        document.body.dataset['cameraTour'] = String(value);
    }

    function showView(index: number): void {
        const viewpoint = VIEWPOINTS[index];
        if (viewpoint === undefined) {
            throw new RangeError(`Unknown reliquary composition ${String(index)}`);
        }
        activeViewIndex = index;
        document.body.dataset['composition'] = viewpoint.label;
        controls.setView(
            tupleVector(viewpoint.position, cameraPosition),
            tupleVector(viewpoint.target, cameraTarget)
        );
    }

    function nextView(): void {
        setTourEnabled(false);
        showView((activeViewIndex + 1) % VIEWPOINTS.length);
    }

    volumeToggle.setAttribute('aria-pressed', String(volumetricEnabled));
    volumeState.textContent = volumetricEnabled ? 'On' : 'Off';
    debugState.textContent = debugLabel(debugView);
    setMotionEnabled(motionEnabled);
    setTourEnabled(tourEnabled);
    showView(0);

    volumeToggle.addEventListener('click', () => {
        updateQuery('volume', volumetricEnabled ? 'false' : null);
    });
    motionToggle.addEventListener('click', () => {
        setMotionEnabled(!motionEnabled);
    });
    tourToggle.addEventListener('click', () => {
        setTourEnabled(!tourEnabled);
    });
    debugButton.addEventListener('click', () => {
        updateQuery('debug', nextDebugView(debugView));
    });
    viewButton.addEventListener('click', nextView);

    const cancelTour = (): void => {
        if (tourEnabled) setTourEnabled(false);
    };
    stage.canvas.addEventListener('pointerdown', cancelTour);
    stage.canvas.addEventListener('wheel', cancelTour, { passive: true });

    const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.code === 'KeyV') nextView();
        else if (event.code === 'KeyB') updateQuery('volume', volumetricEnabled ? 'false' : null);
        else if (event.code === 'KeyD') updateQuery('debug', nextDebugView(debugView));
        else if (event.code === 'KeyT') setTourEnabled(!tourEnabled);
    };
    window.addEventListener('keydown', handleKeyDown);

    const sceneAnimation: Hilo3d.Tickable = {
        tick(deltaTime): void {
            const dt = Math.min(deltaTime, 50) / 1000;
            elapsed += dt;
            if (motionEnabled) {
                driftingMist.set(
                    -4.5 + Math.sin(elapsed * 0.22) * 3.4,
                    2.15 + Math.sin(elapsed * 0.31) * 0.28,
                    Math.cos(elapsed * 0.18) * 0.65
                );
                roseMist.set(
                    5.2 + Math.cos(elapsed * 0.19) * 2.7,
                    2.55 + Math.cos(elapsed * 0.27) * 0.3,
                    Math.sin(elapsed * 0.21) * 0.55
                );
                for (const beam of beams) {
                    const descriptor = beam.descriptor;
                    const sweep = Math.sin(elapsed * 0.34 + descriptor.phase);
                    const lift = Math.cos(elapsed * 0.27 + descriptor.phase * 0.8);
                    beam.light.direction
                        .set(
                            descriptor.target[0] - descriptor.position[0],
                            descriptor.target[1] + lift * 0.42 - descriptor.position[1],
                            descriptor.target[2] + sweep * 0.9 - descriptor.position[2]
                        )
                        .normalize();
                    beam.light.amount =
                        descriptor.amount *
                        BEAM_INTENSITY_SCALE *
                        (1 + Math.sin(elapsed * 0.82 + descriptor.phase) * 0.08);
                    beam.light.isDirty = true;
                    beam.marker.setScale(
                        0.95 * (1 + Math.sin(elapsed * 0.82 + descriptor.phase) * 0.12)
                    );
                }
            }
            if (!tourEnabled) return;
            tourElapsed += dt;
            const cycleElapsed = tourElapsed % TOUR_CYCLE_SECONDS;
            const segment = cycleElapsed / TOUR_SECONDS_PER_VIEW;
            const startIndex = Math.floor(segment) % VIEWPOINTS.length;
            const endIndex = (startIndex + 1) % VIEWPOINTS.length;
            const startView = VIEWPOINTS[startIndex];
            const endView = VIEWPOINTS[endIndex];
            if (startView === undefined || endView === undefined) {
                throw new Error('Reliquary camera tour is incomplete.');
            }
            const amount = smootherStep(segment - Math.floor(segment));
            activeViewIndex = startIndex;
            document.body.dataset['composition'] = `${startView.label} → ${endView.label}`;
            controls.setView(
                interpolateTourPosition(
                    startView.position,
                    endView.position,
                    amount,
                    startIndex % 2 === 0 ? 1 : -1,
                    cameraPosition
                ),
                interpolateTuple(startView.target, endView.target, amount, cameraTarget)
            );
        }
    };

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick(sceneAnimation);
    ticker.addTick(Hilo3d.Tween);
    ticker.addTick(Hilo3d.Animation);
    ticker.addTick(stage);

    let diagnosticsPending = false;
    const refreshDiagnostics = async (): Promise<void> => {
        if (diagnosticsPending) return;
        diagnosticsPending = true;
        try {
            const diagnostics = await factory.readDiagnostics();
            metricFroxels.textContent = formatCount(diagnostics.volumetricFroxelCount);
            metricHistory.textContent = diagnostics.volumetricHistoryUsed ? 'Stable' : 'Priming';
            metricLights.textContent = String(totalLightCount);
            metricFps.textContent = `${String(ticker.getMeasuredFPS())} fps`;
            document.body.dataset['diagnosticsReady'] = 'true';
            document.body.dataset['froxelCount'] = String(diagnostics.volumetricFroxelCount);
            document.body.dataset['volumeHistory'] = String(diagnostics.volumetricHistoryUsed);
            document.body.dataset['clusterOverflow'] = String(diagnostics.clusterOverflowCount);
        } finally {
            diagnosticsPending = false;
        }
    };
    const diagnosticsTick = ticker.interval(() => {
        void refreshDiagnostics().catch(showFatalError);
    }, 1000);

    const stepFrames = async (frameCount: number): Promise<void> => {
        for (let frame = 0; frame < frameCount; frame += 1) {
            stage.tick(1000 / 60);
            await stage.renderer.waitForIdle();
        }
    };

    const handleResize = (): void => {
        const width = Math.max(window.innerWidth, 1);
        const height = Math.max(window.innerHeight, 1);
        camera.aspect = width / height;
        stage.resize(width, height, viewportPixelRatio());
    };
    window.addEventListener('resize', handleResize);

    backendLabel.textContent = `${stage.renderer.backend.toUpperCase()} · ${String(modelBucketPlan.buckets.length)} PBR buckets`;
    controlsFieldset.disabled = false;
    await stepFrames(volumetricEnabled ? 3 : 2);
    await refreshDiagnostics();
    const evidence = await factory.readDiagnostics();
    window.__HILO3D_VOLUMETRIC_RELIQUARY_RESULT__ = {
        backend: 'webgpu',
        volumetricLighting: volumetricEnabled,
        froxelCount: evidence.volumetricFroxelCount,
        historyUsed: evidence.volumetricHistoryUsed,
        clusterOverflowCount: evidence.clusterOverflowCount,
        localVolumeCount: 7,
        heroAsset: 'Khronos Sponza'
    };
    window.__HILO3D_VOLUMETRIC_RELIQUARY_TEST_API__ = {
        async settle(frames = 8): Promise<void> {
            await stepFrames(frames);
            await refreshDiagnostics();
        }
    };
    if (!testMode) ticker.start();
    loadingProgress.style.width = '100%';
    loadingTitle.textContent = 'The atmosphere is live';
    loadingDetail.textContent = `${String(totalLightCount)} lights are injecting the temporal froxel field.`;
    document.body.dataset['excludedMeshes'] = String(modelBucketPlan.excludedMeshCount);
    document.body.dataset['volumetricReady'] = 'true';
    requestAnimationFrame(() => {
        loadingPanel.classList.add('isHidden');
    });

    const dispose = (): void => {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('keydown', handleKeyDown);
        stage.canvas.removeEventListener('pointerdown', cancelTour);
        stage.canvas.removeEventListener('wheel', cancelTour);
        ticker.removeTick(diagnosticsTick);
        ticker.stop();
        controls.dispose();
    };
    window.addEventListener('beforeunload', dispose, { once: true });
}

function showFatalError(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    const loadingPanel = document.querySelector<HTMLElement>('#loadingPanel');
    const errorPanel = document.querySelector<HTMLElement>('#errorPanel');
    const errorMessage = document.querySelector<HTMLElement>('#errorMessage');
    if (loadingPanel) loadingPanel.hidden = true;
    if (errorPanel) errorPanel.hidden = false;
    if (errorMessage) errorMessage.textContent = failure.message;
    document.body.dataset['volumetricReady'] = 'error';
    console.error(failure);
}

void run().catch(showFatalError);

declare global {
    interface Window {
        __HILO3D_VOLUMETRIC_RELIQUARY_RESULT__?: VolumetricReliquaryEvidence;
        __HILO3D_VOLUMETRIC_RELIQUARY_TEST_API__?: {
            settle(frames?: number): Promise<void>;
        };
    }
}
