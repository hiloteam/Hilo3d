import * as Hilo3d from '../src/Hilo3d';

const ATRIUM_WIDTH = 27.4;
const MAX_LIGHTS = 192;
const MAX_VIEWPORT_WIDTH = 2560;
const MAX_VIEWPORT_HEIGHT = 1440;
const TOUR_CYCLE_SECONDS = 16;
const LIGHT_PERMUTATION_STEP = 73;

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
    readonly baseAmount: number;
    readonly phase: number;
}

interface Viewpoint {
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

const VIEWPOINTS = Object.freeze([
    { position: [-2.4, 6.35, 1.15], target: [0.4, 2.3, -0.2] },
    { position: [10.6, 4.7, -3.15], target: [-1.4, 3.25, -0.2] }
] as const) satisfies readonly Viewpoint[];

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
                baseAmount: descriptor.amount,
                phase: descriptor.phase
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
    const modelBucketPlan = createModelBucketPlan(model);
    const modelBuckets = modelBucketPlan.buckets;
    const bulbBuckets = bulbMaterials.map(material =>
        Object.freeze({ geometry: bulbGeometry, material })
    );
    const buckets: readonly Hilo3d.GPUSceneBucket[] = Object.freeze([
        ...modelBuckets,
        ...bulbBuckets
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
        lightOutput.value = `${String(activeLightCount)} / ${String(MAX_LIGHTS)}`;
        for (let index = 0; index < lamps.length; index += 1) {
            const lamp = lamps[index];
            if (lamp === undefined) continue;
            const active = index < activeLightCount;
            lamp.light.enabled = active;
            lamp.marker.visible = active;
        }
        document.body.dataset['activeLights'] = String(activeLightCount);
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
            for (const lamp of lamps) lamp.light.amount = lamp.baseAmount;
        }
    }

    function showView(index: number): void {
        const viewpoint = VIEWPOINTS[index];
        if (viewpoint === undefined)
            throw new RangeError(`Unknown Sponza viewpoint ${String(index)}`);
        activeViewIndex = index;
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
                for (let index = 0; index < activeLightCount; index += 1) {
                    const lamp = lamps[index];
                    if (lamp === undefined) continue;
                    lamp.light.amount =
                        lamp.baseAmount * (1 + Math.sin(pulseElapsed * 1.35 + lamp.phase) * 0.11);
                }
            }
            if (!tourEnabled) return;
            tourElapsed += dt;
            const phase = (tourElapsed / TOUR_CYCLE_SECONDS) * Math.PI * 2;
            const heroView = VIEWPOINTS[0];
            activeViewIndex = 0;
            controls.setView(
                cameraPosition.set(
                    heroView.position[0] + Math.sin(phase) * 0.3,
                    heroView.position[1] + Math.sin(phase * 2) * 0.08,
                    heroView.position[2] + Math.cos(phase) * 0.2
                ),
                cameraTarget.set(
                    heroView.target[0] + Math.sin(phase * 0.5) * 0.4,
                    heroView.target[1] + Math.cos(phase) * 0.08,
                    heroView.target[2] + Math.sin(phase) * 0.16
                )
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
            metricLights.textContent = String(activeLightCount);
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
    loadingDetail.textContent = `${String(activeLightCount)} local lights are clustered on the GPU.`;
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
