import * as Hilo3d from '../src/Hilo3d';

const ATRIUM_WIDTH = 27.4;
const MAX_LIGHTS = 192;
const RUNNER_LIGHT_COUNT = 10;
const TOTAL_LIGHTS = MAX_LIGHTS + RUNNER_LIGHT_COUNT;
const MAX_VIEWPORT_WIDTH = 2560;
const MAX_VIEWPORT_HEIGHT = 1440;
const TOUR_SECONDS_PER_VIEW = 5;
const LIGHT_PERMUTATION_STEP = 73;
const LIGHT_DRIFT_X = 0.16;
const LIGHT_DRIFT_Y = 0.12;
const LIGHT_DRIFT_Z = 0.2;
const LAMP_COLOR_CYCLE_SPEED = 0.2;
const RUNNER_HALF_LENGTH = ATRIUM_WIDTH * 0.4;
const RUNNER_HALF_WIDTH = 1.18;
const RUNNER_MIN_HEIGHT = 0.85;
const RUNNER_MAX_HEIGHT = 5.05;
const RUNNER_TRAVEL_SPEED = 0.38;

interface ResourceProgress {
    readonly url: string;
    readonly loaded: number;
    readonly total: number;
}

interface LampPalette {
    readonly light: readonly [number, number, number];
    readonly emission: readonly [number, number, number];
}

interface LampDescriptor {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly amount: number;
    readonly range: number;
    readonly palette: number;
    readonly phase: number;
    readonly markerScale: number;
}

interface LampRuntime {
    readonly light: Hilo3d.PointLight;
    readonly marker: Hilo3d.Mesh;
    readonly descriptor: LampDescriptor;
    readonly baseAmount: number;
    readonly phase: number;
}

interface RunnerRuntime {
    readonly light: Hilo3d.PointLight;
    readonly marker: Hilo3d.Mesh;
    readonly material: Hilo3d.PBRMaterial;
    readonly phase: number;
    readonly lane: number;
    readonly diagonalDirection: -1 | 1;
}

interface Viewpoint {
    readonly label: string;
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
}

interface ModelBucketPlan {
    readonly buckets: readonly Hilo3d.GPUSceneBucket[];
    readonly excludedMeshCount: number;
}

const LAMP_PALETTES = Object.freeze([
    { light: [1, 0.34, 0.08], emission: [3.8, 0.9, 0.16] },
    { light: [1, 0.13, 0.045], emission: [4.2, 0.34, 0.08] },
    { light: [0.08, 0.86, 1], emission: [0.14, 2.6, 4.1] },
    { light: [0.43, 0.28, 1], emission: [1.35, 0.54, 4.3] }
] as const) satisfies readonly LampPalette[];

const RUNNER_COLORS = Object.freeze([
    [1, 0.12, 0.035],
    [1, 0.58, 0.08],
    [0.08, 0.95, 1],
    [0.48, 0.2, 1]
] as const) satisfies readonly (readonly [number, number, number])[];

const VIEWPOINTS = Object.freeze([
    {
        label: 'Central overview',
        position: [0, 6.5, 0],
        target: [5, 2.3, 0]
    },
    {
        label: 'West entrance',
        position: [-9.2, 2.3, 0],
        target: [-2.5, 2.25, 0]
    },
    {
        label: 'West gallery',
        position: [-7, 2.45, 0.25],
        target: [0, 2.25, -0.2]
    },
    {
        label: 'Central crossing',
        position: [-3, 2.55, -0.55],
        target: [4, 2.3, 0.75]
    },
    {
        label: 'East colonnade',
        position: [2, 2.6, 0.55],
        target: [9, 2.3, -0.7]
    },
    {
        label: 'East approach',
        position: [5.5, 2.45, -0.15],
        target: [10, 2.3, 0]
    },
    {
        label: 'Central climb',
        position: [4.2, 4.25, 0],
        target: [8.7, 2.3, 0]
    },
    {
        label: 'Gallery rise',
        position: [1.5, 6.2, 0],
        target: [5.5, 2.3, 0]
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

function createModelBucketPlan(model: Hilo3d.GLTFModel): Readonly<ModelBucketPlan> {
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
        materials.add(material);
        buckets.push(Object.freeze({ geometry, material }));
    }
    return Object.freeze({ buckets: Object.freeze(buckets), excludedMeshCount });
}

function normalizeModel(model: Hilo3d.GLTFModel): void {
    const bounds = model.node.getBounds();
    if (bounds === undefined || bounds.width <= 0) {
        throw new RangeError('The selected glTF model does not expose usable world bounds.');
    }
    const scale = ATRIUM_WIDTH / bounds.width;
    model.node.setScale(scale);
    model.node.setPosition(-bounds.x * scale, -bounds.yMin * scale, -bounds.z * scale);
}

function createBulbMaterials(): readonly Hilo3d.PBRMaterial[] {
    return Object.freeze(
        LAMP_PALETTES.map(
            palette =>
                new Hilo3d.PBRMaterial({
                    baseColor: new Hilo3d.Color(
                        palette.light[0] * 0.06,
                        palette.light[1] * 0.06,
                        palette.light[2] * 0.06
                    ),
                    emissionFactor: new Hilo3d.Color(...palette.emission),
                    metallic: 0.08,
                    roughness: 0.24
                })
        )
    );
}

function createRunnerMaterials(): readonly Hilo3d.PBRMaterial[] {
    return Object.freeze(
        Array.from({ length: RUNNER_LIGHT_COUNT }, (_unused, index) => {
            const color = RUNNER_COLORS[index % RUNNER_COLORS.length];
            if (color === undefined) throw new Error('Runner light palette is incomplete.');
            return new Hilo3d.PBRMaterial({
                baseColor: new Hilo3d.Color(color[0] * 0.08, color[1] * 0.08, color[2] * 0.08),
                emissionFactor: new Hilo3d.Color(color[0] * 3.5, color[1] * 3.5, color[2] * 3.5),
                metallic: 0.12,
                roughness: 0.2
            });
        })
    );
}

function createLampDescriptors(): readonly LampDescriptor[] {
    const descriptors: LampDescriptor[] = [];
    const bands = [
        { y: 1.05, z: -1.18, amount: 9.4, range: 3.4, palette: 0, markerScale: 0.94 },
        { y: 1.05, z: 1.18, amount: 8.8, range: 3.4, palette: 1, markerScale: 0.94 },
        { y: 2.35, z: -4.35, amount: 7.2, range: 3.85, palette: 0, markerScale: 0.78 },
        { y: 2.35, z: 4.35, amount: 7, range: 3.85, palette: 1, markerScale: 0.78 },
        { y: 5.05, z: -4.45, amount: 5.7, range: 4.2, palette: 2, markerScale: 0.72 },
        { y: 5.05, z: 4.45, amount: 5.4, range: 4.2, palette: 3, markerScale: 0.72 }
    ] as const;
    for (let column = 0; column < 32; column += 1) {
        const x = -12.8 + (column / 31) * 25.6;
        for (const [bandIndex, band] of bands.entries()) {
            descriptors.push({
                x,
                y: band.y,
                z: band.z,
                amount: band.amount,
                range: band.range,
                palette: band.palette,
                phase: column * 0.37 + bandIndex * 1.11,
                markerScale: band.markerScale
            });
        }
    }
    if (descriptors.length !== MAX_LIGHTS) {
        throw new Error('The Sponza lamp layout must fill the configured light capacity.');
    }
    return Object.freeze(
        descriptors.map((_descriptor, index) => {
            const source = descriptors[(index * LIGHT_PERMUTATION_STEP) % descriptors.length];
            if (source === undefined) throw new Error('Lamp permutation is incomplete.');
            return Object.freeze(source);
        })
    );
}

function createLampRig(
    stage: Hilo3d.Stage<'webgpu'>,
    geometry: Hilo3d.Geometry,
    materials: readonly Hilo3d.PBRMaterial[],
    descriptors: readonly LampDescriptor[],
    frustumTest: boolean
): readonly LampRuntime[] {
    const rig = new Hilo3d.Node({ name: 'Sponza clustered light installation' }).addTo(stage);
    return Object.freeze(
        descriptors.map(descriptor => {
            const palette = LAMP_PALETTES[descriptor.palette];
            const material = materials[descriptor.palette];
            if (palette === undefined || material === undefined) {
                throw new Error('Lamp palette lookup failed.');
            }
            const light = new Hilo3d.PointLight({
                x: descriptor.x,
                y: descriptor.y,
                z: descriptor.z,
                amount: descriptor.amount,
                range: descriptor.range,
                color: new Hilo3d.Color(...palette.light)
            }).addTo(rig);
            const marker = new Hilo3d.Mesh({
                x: descriptor.x,
                y: descriptor.y,
                z: descriptor.z,
                geometry,
                material,
                useInstanced: true,
                frustumTest
            })
                .setScale(descriptor.markerScale)
                .addTo(rig);
            return Object.freeze({
                light,
                marker,
                descriptor,
                baseAmount: descriptor.amount,
                phase: descriptor.phase
            });
        })
    );
}

function createRunnerRig(
    stage: Hilo3d.Stage<'webgpu'>,
    geometry: Hilo3d.Geometry,
    materials: readonly Hilo3d.PBRMaterial[],
    frustumTest: boolean
): readonly RunnerRuntime[] {
    const rig = new Hilo3d.Node({ name: 'Sponza chromatic runner lights' }).addTo(stage);
    return Object.freeze(
        materials.map((material, index) => {
            const phase = (index / materials.length) * Math.PI * 2;
            const lane = index % 3;
            const diagonalDirection = index % 2 === 0 ? 1 : -1;
            const color = RUNNER_COLORS[index % RUNNER_COLORS.length];
            if (color === undefined) throw new Error('Runner light palette is incomplete.');
            const light = new Hilo3d.PointLight({
                amount: 15,
                range: 5,
                color: new Hilo3d.Color(...color)
            }).addTo(rig);
            const marker = new Hilo3d.Mesh({
                geometry,
                material,
                useInstanced: true,
                frustumTest
            })
                .setScale(1.1)
                .addTo(rig);
            return Object.freeze({
                light,
                marker,
                material,
                phase,
                lane,
                diagonalDirection
            });
        })
    );
}

function tupleVector(
    tuple: readonly [number, number, number],
    target: Hilo3d.Vector3
): Hilo3d.Vector3 {
    return target.set(tuple[0], tuple[1], tuple[2]);
}

function formatCount(value: number): string {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
        value
    );
}

function viewportPixelRatio(): number {
    const deviceRatio = Math.min(window.devicePixelRatio || 1, 1.5);
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

function setCycledColor(palettePosition: number, target: Hilo3d.Color): Hilo3d.Color {
    const wrappedPosition =
        ((palettePosition % RUNNER_COLORS.length) + RUNNER_COLORS.length) % RUNNER_COLORS.length;
    const colorIndex = Math.floor(wrappedPosition);
    const nextColorIndex = (colorIndex + 1) % RUNNER_COLORS.length;
    const from = RUNNER_COLORS[colorIndex];
    const to = RUNNER_COLORS[nextColorIndex];
    if (from === undefined || to === undefined) {
        throw new Error('Animated light color interpolation is incomplete.');
    }
    const amount = smootherStep(wrappedPosition - colorIndex);
    return target.set(
        from[0] + (to[0] - from[0]) * amount,
        from[1] + (to[1] - from[1]) * amount,
        from[2] + (to[2] - from[2]) * amount,
        1
    );
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
        from[1] + (to[1] - from[1]) * amount + arc * 0.18,
        from[2] + (to[2] - from[2]) * amount + arc * arcDirection * 0.42
    );
}

function setLampPosition(lamp: Readonly<LampRuntime>, elapsed: number): void {
    const descriptor = lamp.descriptor;
    const horizontalPhase = elapsed * 0.42 + lamp.phase;
    const verticalPhase = elapsed * 0.78 + lamp.phase * 1.37;
    const x = descriptor.x + Math.sin(horizontalPhase) * LIGHT_DRIFT_X;
    const y = descriptor.y + Math.sin(verticalPhase) * LIGHT_DRIFT_Y;
    const z = descriptor.z + Math.cos(horizontalPhase * 0.83) * LIGHT_DRIFT_Z;
    lamp.light.setPosition(x, y, z);
    lamp.marker.setPosition(x, y, z);
}

function resetLamp(lamp: Readonly<LampRuntime>): void {
    const descriptor = lamp.descriptor;
    const palette = LAMP_PALETTES[descriptor.palette];
    if (palette === undefined) throw new Error('Lamp palette lookup failed.');
    lamp.light.amount = lamp.baseAmount;
    lamp.light.color.set(palette.light[0], palette.light[1], palette.light[2], 1);
    lamp.light.setPosition(descriptor.x, descriptor.y, descriptor.z);
    lamp.marker.setPosition(descriptor.x, descriptor.y, descriptor.z);
    lamp.marker.setScale(descriptor.markerScale);
}

function resetLampMaterials(materials: readonly Hilo3d.PBRMaterial[]): void {
    for (const [index, material] of materials.entries()) {
        const palette = LAMP_PALETTES[index];
        if (palette === undefined) throw new Error('Lamp palette lookup failed.');
        material.baseColor.set(
            palette.light[0] * 0.06,
            palette.light[1] * 0.06,
            palette.light[2] * 0.06,
            1
        );
        material.emissionFactor.set(
            palette.emission[0],
            palette.emission[1],
            palette.emission[2],
            1
        );
        material.invalidateData();
    }
}

function updateLampColors(
    lamps: readonly LampRuntime[],
    materials: readonly Hilo3d.PBRMaterial[],
    elapsed: number
): void {
    for (const [index, material] of materials.entries()) {
        const color = setCycledColor(
            elapsed * LAMP_COLOR_CYCLE_SPEED + index * 0.92,
            material.baseColor
        );
        const red = color.r;
        const green = color.g;
        const blue = color.b;
        material.baseColor.set(red * 0.065, green * 0.065, blue * 0.065, 1);
        material.emissionFactor.set(red * 3.6, green * 3.6, blue * 3.6, 1);
        material.invalidateData();
    }
    for (const lamp of lamps) {
        setCycledColor(
            elapsed * LAMP_COLOR_CYCLE_SPEED +
                lamp.descriptor.palette * 0.92 +
                lamp.descriptor.x * 0.065,
            lamp.light.color
        );
    }
}

function updateRunner(runner: Readonly<RunnerRuntime>, elapsed: number): void {
    const travelPhase = elapsed * RUNNER_TRAVEL_SPEED + runner.phase;
    const x = Math.cos(travelPhase) * RUNNER_HALF_LENGTH;
    const heightAmount = (Math.sin(travelPhase * 2 + (runner.lane / 3) * Math.PI * 2) + 1) * 0.5;
    const y = RUNNER_MIN_HEIGHT + heightAmount * (RUNNER_MAX_HEIGHT - RUNNER_MIN_HEIGHT);
    const z =
        runner.diagonalDirection * Math.sin(travelPhase + runner.lane * 0.16) * RUNNER_HALF_WIDTH;
    runner.light.setPosition(x, y, z);
    runner.marker.setPosition(x, y, z);

    const color = setCycledColor(
        elapsed * 0.3 + (runner.phase / (Math.PI * 2)) * RUNNER_COLORS.length,
        runner.light.color
    );
    const red = color.r;
    const green = color.g;
    const blue = color.b;
    const pulse = 1 + Math.sin(travelPhase * 2.1) * 0.16;
    runner.light.amount = 15 * pulse;
    runner.marker.setScale(1.1 * (1 + Math.sin(travelPhase * 2.1) * 0.14));
    runner.material.baseColor.set(red * 0.08, green * 0.08, blue * 0.08, 1);
    runner.material.emissionFactor.set(red * 3.4, green * 3.4, blue * 3.4, 1);
    runner.material.invalidateData();
}

async function run(): Promise<void> {
    const searchParameters = new URLSearchParams(location.search);
    const hiZEnabled = searchParameters.get('hiZ') !== 'false';
    const cullingEnabled = searchParameters.get('culling') !== 'false';
    const motionPreference = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const container = requireElement('#container', HTMLElement);
    const controlsFieldset = requireElement('#controlsFieldset', HTMLFieldSetElement);
    const loadingPanel = requireElement('#loadingPanel', HTMLElement);
    const loadingTitle = requireElement('#loadingTitle', HTMLElement);
    const loadingDetail = requireElement('#loadingDetail', HTMLElement);
    const loadingProgress = requireElement('#loadingProgress', HTMLElement);
    const backendLabel = requireElement('#backendLabel', HTMLElement);
    const lightControl = requireElement('#lightControl', HTMLInputElement);
    const lightOutput = requireElement('#lightOutput', HTMLOutputElement);
    const tourToggle = requireElement('#tourToggle', HTMLButtonElement);
    const motionToggle = requireElement('#motionToggle', HTMLButtonElement);
    const viewButton = requireElement('#viewButton', HTMLButtonElement);
    const metricLights = requireElement('#metricLights', HTMLElement);
    const metricObjects = requireElement('#metricObjects', HTMLElement);
    const metricLinks = requireElement('#metricLinks', HTMLElement);
    const metricFps = requireElement('#metricFps', HTMLElement);
    const gpuObjectCount = requireElement('#gpuObjectCount', HTMLElement);
    const fallbackObjectCount = requireElement('#fallbackObjectCount', HTMLElement);
    const excludedMeshCount = requireElement('#excludedMeshCount', HTMLElement);
    const overflowCount = requireElement('#overflowCount', HTMLElement);

    const modelUrl = new URL('./models/Sponza/glTF/Sponza.gltf', location.href).href;
    document.body.dataset['asset'] = 'khronos-sponza';

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
            loadingProgress.style.width = '38%';
        }
    });

    const model = await loader.load({
        src: modelUrl,
        isProgressive: true,
        ignoreTextureError: false
    });
    loadingTitle.textContent = 'Resolving PBR materials';
    loadingDetail.textContent = `${String(model.textures.length)} textures · ${String(model.meshes.length)} scene meshes`;
    loadingProgress.style.width = '78%';
    await model.ready;
    normalizeModel(model);
    for (const mesh of model.meshes) mesh.frustumTest = cullingEnabled;

    const bulbGeometry = new Hilo3d.SphereGeometry({
        radius: 0.07,
        widthSegments: 12,
        heightSegments: 8
    });
    const bulbMaterials = createBulbMaterials();
    const runnerMaterials = createRunnerMaterials();
    const modelBucketPlan = createModelBucketPlan(model);
    const modelBuckets = modelBucketPlan.buckets;
    const bulbBuckets = bulbMaterials.map(material =>
        Object.freeze({ geometry: bulbGeometry, material })
    );
    const runnerBuckets = runnerMaterials.map(material =>
        Object.freeze({ geometry: bulbGeometry, material })
    );
    const buckets: readonly Hilo3d.GPUSceneBucket[] = Object.freeze([
        ...modelBuckets,
        ...bulbBuckets,
        ...runnerBuckets
    ]);
    const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: 1024,
        maxLights: 256,
        maxLightIndices: 1_048_576,
        maxLightsPerCluster: 128,
        tileSize: 24,
        zSlices: 24,
        maxViewportWidth: MAX_VIEWPORT_WIDTH,
        maxViewportHeight: MAX_VIEWPORT_HEIGHT,
        hiZ: hiZEnabled,
        bloomStrength: 0.5,
        exposure: 1.18
    });

    loadingTitle.textContent = 'Building clustered light lists';
    loadingDetail.textContent = `${String(modelBuckets.length)} GPU buckets · ${String(modelBucketPlan.excludedMeshCount)} alpha-cutout meshes omitted`;
    loadingProgress.style.width = '92%';
    document.body.dataset['excludedMeshes'] = String(modelBucketPlan.excludedMeshCount);
    document.body.dataset['hiZEnabled'] = String(hiZEnabled);
    document.body.dataset['cullingEnabled'] = String(cullingEnabled);
    excludedMeshCount.textContent = String(modelBucketPlan.excludedMeshCount);

    const camera = new Hilo3d.PerspectiveCamera({
        aspect: window.innerWidth / Math.max(window.innerHeight, 1),
        fov: 52,
        near: 0.05,
        far: 80,
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
        clearColor: new Hilo3d.Color(0.0025, 0.004, 0.007),
        useInstanced: true,
        renderingProfile: 'high-end',
        renderPipeline: factory
    });
    model.node.name = 'Khronos Sponza atrium';
    model.node.addTo(stage);

    new Hilo3d.AmbientLight({
        color: new Hilo3d.Color(0.34, 0.42, 0.58),
        amount: 0.58
    }).addTo(stage);
    new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(0.82, 0.88, 1),
        amount: 0.95,
        direction: new Hilo3d.Vector3(-0.32, -0.85, 0.28)
    }).addTo(stage);

    const lampDescriptors = createLampDescriptors();
    const lamps = createLampRig(
        stage,
        bulbGeometry,
        bulbMaterials,
        lampDescriptors,
        cullingEnabled
    );
    const runners = createRunnerRig(stage, bulbGeometry, runnerMaterials, cullingEnabled);
    document.body.dataset['runnerLights'] = String(runners.length);
    const initialLightCount = MAX_LIGHTS;
    lightControl.value = String(initialLightCount);

    const cameraPosition = new Hilo3d.Vector3();
    const cameraTarget = new Hilo3d.Vector3();
    const firstView = VIEWPOINTS[0];
    const controls = new Hilo3d.OrbitControls(stage, {
        camera,
        target: tupleVector(firstView.target, cameraTarget),
        enablePan: true,
        minDistance: 0.8,
        maxDistance: 38,
        minPolarAngle: 0.12,
        maxPolarAngle: Math.PI - 0.12,
        rotateSpeed: 0.68,
        zoomSpeed: 0.82,
        panSpeed: 0.55
    });
    controls.setView(tupleVector(firstView.position, cameraPosition), cameraTarget);

    let activeLightCount = initialLightCount;
    let tourEnabled = searchParameters.get('tour') !== 'false' && motionPreference;
    let motionEnabled = searchParameters.get('motion') !== 'false' && motionPreference;
    let tourElapsed = 0;
    let pulseElapsed = 0;
    let activeViewIndex = 0;

    function setLightCount(value: number): void {
        activeLightCount = Math.max(24, Math.min(MAX_LIGHTS, Math.round(value / 24) * 24));
        lightControl.value = String(activeLightCount);
        const totalActiveLights = activeLightCount + runners.length;
        lightOutput.value = `${String(totalActiveLights)} / ${String(TOTAL_LIGHTS)}`;
        for (let index = 0; index < lamps.length; index += 1) {
            const lamp = lamps[index];
            if (lamp === undefined) continue;
            const active = index < activeLightCount;
            lamp.light.enabled = active;
            lamp.marker.visible = active;
        }
        document.body.dataset['activeLights'] = String(totalActiveLights);
    }

    function setTourEnabled(value: boolean): void {
        tourEnabled = value;
        tourToggle.setAttribute('aria-pressed', String(value));
        document.body.dataset['cameraTour'] = String(value);
    }

    function setMotionEnabled(value: boolean): void {
        motionEnabled = value;
        motionToggle.setAttribute('aria-pressed', String(value));
        document.body.dataset['lightMotion'] = String(value);
        if (!value) {
            for (const lamp of lamps) resetLamp(lamp);
            resetLampMaterials(bulbMaterials);
            for (const runner of runners) updateRunner(runner, 0);
        }
    }

    function showView(index: number): void {
        const viewpoint = VIEWPOINTS[index];
        if (viewpoint === undefined)
            throw new RangeError(`Unknown Sponza viewpoint ${String(index)}`);
        activeViewIndex = index;
        document.body.dataset['tourView'] = viewpoint.label;
        controls.setView(
            tupleVector(viewpoint.position, cameraPosition),
            tupleVector(viewpoint.target, cameraTarget)
        );
    }

    function nextView(): void {
        setTourEnabled(false);
        showView((activeViewIndex + 1) % VIEWPOINTS.length);
    }

    setLightCount(initialLightCount);
    setTourEnabled(tourEnabled);
    setMotionEnabled(motionEnabled);
    lightControl.addEventListener('input', () => {
        setLightCount(Number(lightControl.value));
    });
    tourToggle.addEventListener('click', () => {
        setTourEnabled(!tourEnabled);
    });
    motionToggle.addEventListener('click', () => {
        setMotionEnabled(!motionEnabled);
    });
    viewButton.addEventListener('click', nextView);

    const cancelTour = (): void => {
        if (tourEnabled) setTourEnabled(false);
    };
    stage.canvas.addEventListener('pointerdown', cancelTour);
    stage.canvas.addEventListener('wheel', cancelTour, { passive: true });

    const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.target instanceof HTMLInputElement) return;
        if (event.code === 'KeyT') setTourEnabled(!tourEnabled);
        else if (event.code === 'KeyV') nextView();
    };
    window.addEventListener('keydown', handleKeyDown);

    const sceneAnimation: Hilo3d.Tickable = {
        tick(deltaTime): void {
            const dt = Math.min(deltaTime, 50) / 1000;
            pulseElapsed += dt;
            if (motionEnabled) {
                updateLampColors(lamps, bulbMaterials, pulseElapsed);
                for (let index = 0; index < activeLightCount; index += 1) {
                    const lamp = lamps[index];
                    if (lamp === undefined) continue;
                    const pulse = Math.sin(pulseElapsed * 1.35 + lamp.phase);
                    lamp.light.amount = lamp.baseAmount * (1 + pulse * 0.16);
                    lamp.marker.setScale(lamp.descriptor.markerScale * (1 + pulse * 0.1));
                    setLampPosition(lamp, pulseElapsed);
                }
                for (const runner of runners) updateRunner(runner, pulseElapsed);
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
                throw new Error('Sponza camera tour is incomplete.');
            }
            const segmentAmount = smootherStep(segment - Math.floor(segment));
            activeViewIndex = startIndex;
            document.body.dataset['tourView'] = `${startView.label} → ${endView.label}`;
            controls.setView(
                interpolateTourPosition(
                    startView.position,
                    endView.position,
                    segmentAmount,
                    startIndex % 2 === 0 ? 1 : -1,
                    cameraPosition
                ),
                interpolateTuple(startView.target, endView.target, segmentAmount, cameraTarget)
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
            metricLights.textContent = String(activeLightCount + runners.length);
            metricObjects.textContent = formatCount(diagnostics.visibleObjectCount);
            metricLinks.textContent = formatCount(diagnostics.clusterLightIndexCount);
            metricFps.textContent = `${String(ticker.getMeasuredFPS())} fps`;
            gpuObjectCount.textContent = String(diagnostics.objectCount);
            fallbackObjectCount.textContent = String(diagnostics.fallbackObjectCount);
            overflowCount.textContent = formatCount(diagnostics.clusterOverflowCount);
            document.body.dataset['diagnosticsReady'] = 'true';
            document.body.dataset['hiZValid'] = String(diagnostics.hiZValid);
            document.body.dataset['visibleObjects'] = String(diagnostics.visibleObjectCount);
            document.body.dataset['occludedObjects'] = String(diagnostics.occludedObjectCount);
        } finally {
            diagnosticsPending = false;
        }
    };
    const diagnosticsTick = ticker.interval(() => {
        void refreshDiagnostics().catch(showFatalError);
    }, 1200);

    const handleResize = (): void => {
        const width = Math.max(window.innerWidth, 1);
        const height = Math.max(window.innerHeight, 1);
        camera.aspect = width / height;
        stage.resize(width, height, viewportPixelRatio());
    };
    window.addEventListener('resize', handleResize);

    backendLabel.textContent = `${stage.renderer.backend.toUpperCase()} · ${String(modelBuckets.length)} PBR buckets`;
    controlsFieldset.disabled = false;
    stage.tick(16);
    await stage.renderer.waitForIdle();
    await refreshDiagnostics();
    ticker.start();
    loadingProgress.style.width = '100%';
    loadingTitle.textContent = 'Atrium ready';
    loadingDetail.textContent = `${String(activeLightCount + runners.length)} local lights are clustered on the GPU.`;
    document.body.dataset['forwardPlusReady'] = 'true';
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
        // The browsing context owns its page-scoped WebGPU device during navigation. Explicitly
        // destroying it here would reject still-settling submission fences during beforeunload.
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
    document.body.dataset['forwardPlusReady'] = 'error';
    console.error(failure);
}

void run().catch(showFatalError);
