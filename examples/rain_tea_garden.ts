import * as Hilo3d from '../src/Hilo3d';
import type { RendererDiagnosticsSnapshot } from '../src/render/RendererDiagnostics';
import {
    registerRendererDiagnostics,
    unregisterRendererDiagnostics
} from '../src/render/diagnostics/RendererDiagnosticsRegistry';
import { createTestFrameControl } from './shared/test-frame-control';

export type RainTeaGardenPreset = 'morning' | 'evening';
export type RainTeaGardenFeature = 'gi' | 'volumetric' | 'decals' | 'transparency';
type Triple = readonly [number, number, number];

export interface RainTeaGardenDiagnostics {
    readonly backend: 'webgpu';
    readonly submittedFrames: number;
    readonly drawCalls: number;
    readonly features: Readonly<Record<RainTeaGardenFeature, boolean>>;
    readonly preset: RainTeaGardenPreset;
    readonly motion: boolean;
    readonly view: number;
    readonly triangleCount: number;
    readonly meshCount: number;
    readonly decalCount: number;
    readonly weightedMeshCount: number;
    readonly camera: Readonly<{ position: Triple; target: Triple }>;
    readonly volumetricCenter: Triple;
    readonly disposed: boolean;
    readonly passNames: readonly string[];
    readonly native: Readonly<RendererDiagnosticsSnapshot>;
    readonly pipeline: Readonly<Hilo3d.ClusteredForwardPlusDiagnostics>;
}

export interface RainTeaGardenAPI {
    settle(
        frames?: number,
        options?: Readonly<{ keepPaused?: boolean }>
    ): Promise<RainTeaGardenDiagnostics>;
    setPreset(preset: RainTeaGardenPreset): void;
    setFeature(feature: RainTeaGardenFeature, enabled: boolean): void;
    setMotion(enabled: boolean): void;
    diagnostics(): Promise<RainTeaGardenDiagnostics>;
    dispose(): Promise<void>;
}

declare global {
    interface Window {
        __HILO_RAIN_TEA_GARDEN__?: RainTeaGardenAPI;
    }
}

const parameters = new URLSearchParams(location.search);
const testMode = parameters.get('test') === '1';
const productionQuality = parameters.get('quality') === 'production';
const maxWidth = testMode && !productionQuality ? 960 : 2560;
const maxHeight = testMode && !productionQuality ? 640 : 1600;
const views = [
    { position: [11.2, 8.8, 15.8], target: [-0.15, 1.45, 0] },
    { position: [7.3, 4.7, 10.1], target: [0.1, 1.4, 0.3] },
    { position: [1.5, 3.2, 8.4], target: [-0.2, 1.7, -1.6] }
] as const;

function element<T extends HTMLElement>(selector: string, kind: new () => T): T {
    const found = document.querySelector(selector);
    if (!(found instanceof kind)) throw new Error(`The tea garden is missing ${selector}.`);
    return found;
}

function pixelRatio(): number {
    return Math.min(2, maxWidth / Math.max(innerWidth, 1), maxHeight / Math.max(innerHeight, 1));
}

function vectorTuple(value: Hilo3d.Vector3): Triple {
    return [value.x, value.y, value.z];
}

function canvasTexture(
    size: number,
    draw: (context: CanvasRenderingContext2D) => void
): Hilo3d.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context === null)
        throw new Error('The garden requires a 2D canvas for its painted details.');
    draw(context);
    return new Hilo3d.Texture({
        image: canvas,
        wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
        minFilter: Hilo3d.constants.webgl.LINEAR,
        magFilter: Hilo3d.constants.webgl.LINEAR
    });
}

function createPetalAtlas(): Hilo3d.Texture {
    return canvasTexture(256, context => {
        // A local deterministic pattern keeps authored paint fixed without changing global randomness.
        // Transparent gaps keep the stone's pigment visible between small wet patches and moss.
        for (let index = 0; index < 11; index++) {
            const x = 16 + ((index * 79.7) % 224);
            const y = 16 + ((index * index * 23.7 + index * 41.3) % 224);
            const radius = 24 + (index % 4) * 6;
            context.save();
            context.translate(x, y);
            context.rotate(index * 1.17);
            context.scale(1, 0.57 + (index % 3) * 0.12);
            const damp = context.createRadialGradient(-radius * 0.18, 0, 2, 0, 0, radius);
            damp.addColorStop(0, '#4e7164b8');
            damp.addColorStop(0.58, '#63817488');
            damp.addColorStop(1, '#6d887b00');
            context.fillStyle = damp;
            context.fillRect(-radius, -radius, radius * 2, radius * 2);
            context.restore();
        }
        for (let index = 0; index < 19; index++) {
            const x = (index * 67.3) % 256;
            const y = (index * index * 17.9) % 256;
            const radius = 14 + (index % 4) * 3;
            const shade = context.createRadialGradient(x - 3, y + 2, 1, x, y, radius);
            shade.addColorStop(0, '#648146d9');
            shade.addColorStop(0.5, '#7c995da8');
            shade.addColorStop(1, '#839d6400');
            context.fillStyle = shade;
            context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        }
        for (let index = 0; index < 104; index++) {
            const x = 12 + ((index * 73.31) % 232);
            const y = 12 + ((index * index * 9.17 + index * 23.1) % 232);
            context.save();
            context.translate(x, y);
            context.rotate(index * 2.399);
            context.scale(1.3, 1.3);
            context.fillStyle = index % 3 === 0 ? '#e997b2fa' : '#f9bdcffa';
            context.beginPath();
            context.moveTo(0, -3.8);
            context.bezierCurveTo(4.8, -5.5, 5.6, 2.3, 0, 5.2);
            context.bezierCurveTo(-4.8, 1.7, -3.8, -4.8, 0, -3.8);
            context.fill();
            context.restore();
        }
    });
}

function createWaterTexture(): Hilo3d.Texture {
    return canvasTexture(512, context => {
        context.fillStyle = '#8dd8d2';
        context.fillRect(0, 0, 512, 512);
        for (let row = 0; row < 22; row++) {
            context.beginPath();
            for (let column = 0; column <= 36; column++) {
                const x = column * 16 - 20;
                const y = row * 25 + Math.sin(column * 1.1 + row * 1.7) * 8;
                if (column === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.strokeStyle = row % 3 === 0 ? '#e5fff48a' : '#55b7bb45';
            context.lineWidth = row % 3 === 0 ? 1.2 : 2.6;
            context.stroke();
        }
    });
}

function createSoftTexture(petal: boolean): Hilo3d.Texture {
    return canvasTexture(64, context => {
        if (petal) {
            context.fillStyle = '#ffe1e8';
            context.beginPath();
            context.moveTo(32, 8);
            context.bezierCurveTo(59, -2, 64, 40, 30, 58);
            context.bezierCurveTo(1, 39, 9, 3, 32, 8);
            context.fill();
        } else {
            const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 30);
            gradient.addColorStop(0, '#fffdf38f');
            gradient.addColorStop(0.5, '#fffdf32e');
            gradient.addColorStop(1, '#fffdf300');
            context.fillStyle = gradient;
            context.fillRect(0, 0, 64, 64);
        }
    });
}

function projectorAt(x: number, z: number, width: number, depth: number): Hilo3d.DecalProjector {
    const transform = new Hilo3d.Node({
        x,
        y: 0.25,
        z,
        rotationX: -90,
        scaleX: width,
        scaleY: depth,
        scaleZ: 1.3
    });
    transform.updateMatrixWorld(true);
    return new Hilo3d.DecalProjector({
        transform: transform.worldMatrix,
        normalThreshold: 0.3,
        normalFade: 0.25,
        edgeFade: 0.06,
        roughness: 0.68,
        affectsRoughness: true
    });
}

let stopScene: (() => void) | undefined;
let disposeSceneOnFailure: (() => Promise<void>) | undefined;

async function run(): Promise<void> {
    if (parameters.get('backend') === 'webgl2') {
        throw new Error('这座庭院需要 WebGPU。请使用支持 WebGPU 的浏览器与设备。');
    }
    const fieldset = element('#controlsFieldset', HTMLFieldSetElement);
    const loading = element('#loadingPanel', HTMLElement);
    const eventScope = new AbortController();
    const events = { signal: eventScope.signal };
    const pendingResources: {
        model?: Hilo3d.GLTFModel;
        stage?: Hilo3d.Stage<'webgpu'>;
        textures: readonly Hilo3d.Texture[];
        unregisterDiagnostics?: () => void;
    } = { textures: [] };
    let initializationCleanup: Promise<void> | undefined;
    function releaseInitialization(): Promise<void> {
        initializationCleanup ??= (async (): Promise<void> => {
            eventScope.abort();
            document.body.dataset['rainTeaGardenDisposed'] = 'true';
            document.body.dataset['rainTeaGardenPhase'] = 'disposed';
            try {
                await pendingResources.stage?.renderer.waitForIdle();
            } finally {
                try {
                    if (pendingResources.stage === undefined)
                        pendingResources.model?.node.destroy(undefined, true);
                    else pendingResources.stage.destroy();
                } finally {
                    try {
                        pendingResources.textures.forEach(texture => {
                            texture.destroy();
                        });
                    } finally {
                        pendingResources.unregisterDiagnostics?.();
                    }
                }
            }
        })();
        return initializationCleanup;
    }
    disposeSceneOnFailure = releaseInitialization;
    let initializationCancelled = false;
    let lifecyclePaused = false;
    let sceneReady = false;
    const sceneLifecycle: {
        suspend?: () => void;
        resume?: () => void;
        dispose?: () => Promise<void>;
    } = {};
    const resumeWaiters = new Set<() => void>();
    document.body.dataset['rainTeaGardenPhase'] = 'loading';

    function wakeInitialization(): void {
        for (const resume of resumeWaiters) resume();
        resumeWaiters.clear();
    }

    async function waitForActivePage(): Promise<boolean> {
        while (lifecyclePaused && !initializationCancelled) {
            await new Promise<void>(resolve => {
                resumeWaiters.add(resolve);
            });
        }
        return !initializationCancelled;
    }

    window.addEventListener(
        'pagehide',
        (event: PageTransitionEvent) => {
            lifecyclePaused = event.persisted;
            sceneLifecycle.suspend?.();
            if (!event.persisted) {
                initializationCancelled = true;
                wakeInitialization();
                // Until publication, initialization owns the pending load/create/fence and its cleanup.
                // This prevents destroying a renderer while the warmup still awaits that renderer.
                if (sceneReady) void sceneLifecycle.dispose?.().catch(showFailure);
            }
        },
        events
    );
    window.addEventListener(
        'pageshow',
        (event: PageTransitionEvent) => {
            if (!event.persisted || initializationCancelled) return;
            lifecyclePaused = false;
            wakeInitialization();
            if (sceneReady) sceneLifecycle.resume?.();
        },
        events
    );

    const model = await new Hilo3d.GLTFLoader().load({
        src: new URL('./models/RainTeaGarden/rain-tea-garden.glb', import.meta.url).href,
        ignoreTextureError: false
    });
    pendingResources.model = model;
    await model.ready;
    if (!(await waitForActivePage())) {
        await releaseInitialization();
        return;
    }
    const textures = [
        createPetalAtlas(),
        createWaterTexture(),
        createSoftTexture(true),
        createSoftTexture(false)
    ] as const;
    pendingResources.textures = textures;
    const [petalAtlas, waterTexture, petalTexture, steamTexture] = textures;
    const projectors = [projectorAt(-2.6, 2.0, 4.7, 5.6), projectorAt(0.15, -0.3, 4.3, 2.4)];
    const buckets: Hilo3d.GPUSceneBucket[] = [];
    const weightedMeshes: Hilo3d.Mesh[] = [];
    const directMeshes: Hilo3d.Mesh[] = [];
    const replacedMaterials = new Map<Hilo3d.PBRMaterial, Hilo3d.PBRMaterial>();
    const movingNodes: { node: Hilo3d.Node; angle: number; phase: number }[] = [];
    let triangleCount = 0;
    let decalReceiverCount = 0;
    const waterMaterial = new Hilo3d.PBRMaterial({
        name: 'RainTeaGarden_WeightedWater',
        baseColor: new Hilo3d.Color(0.62, 0.94, 0.91),
        baseColorMap: waterTexture,
        metallic: 0.03,
        roughness: 0.18,
        opacity: 0.43,
        cullMode: 'none',
        compositing: { mode: 'weighted-blended' }
    });
    const glassMaterial = new Hilo3d.PBRMaterial({
        name: 'RainTeaGarden_WeightedGlass',
        baseColor: new Hilo3d.Color(0.57, 0.85, 0.87),
        metallic: 0.03,
        roughness: 0.12,
        opacity: 0.31,
        compositing: { mode: 'weighted-blended' }
    });
    // The linen keeps its coral pigment under the cool sky fill and the deep eaves.
    for (const material of model.materials) {
        if (!(material instanceof Hilo3d.PBRMaterial)) continue;
        if ((material.name ?? '').includes('Noren_Coral')) {
            material.baseColor.set(0.84, 0.37, 0.38, 1);
            material.invalidateData();
        } else if ((material.name ?? '').includes('Noren_Light')) {
            material.baseColor.set(0.96, 0.51, 0.49, 1);
            material.invalidateData();
        }
    }
    for (const mesh of model.meshes) {
        const original = mesh.material;
        if (mesh.geometry === null || !(original instanceof Hilo3d.PBRMaterial)) {
            throw new Error('The tea garden asset requires indexed PBR geometry.');
        }
        triangleCount += (mesh.geometry.indices?.count ?? mesh.geometry.vertices?.count ?? 0) / 3;
        const identity = `${mesh.name} ${original.name ?? ''}`;
        mesh.castShadows = true;
        mesh.receiveShadows = true;
        if (/WaterSurface|ChimeGlass/.test(identity)) {
            mesh.material = identity.includes('WaterSurface') ? waterMaterial : glassMaterial;
            mesh.contributeToGlobalIllumination = false;
            mesh.castShadows = false;
            weightedMeshes.push(mesh);
            directMeshes.push(mesh);
        } else if (/Stone_(?:Paving|Warm|Cool)/.test(original.name ?? '')) {
            let receiver = replacedMaterials.get(original);
            if (receiver === undefined) {
                receiver = new Hilo3d.PBRMaterial({
                    name: `${original.name ?? 'Stone_Paving'}_Petals`,
                    baseColor: new Hilo3d.Color(
                        original.baseColor.r,
                        original.baseColor.g,
                        original.baseColor.b
                    ),
                    metallic: original.metallic,
                    roughness: original.roughness,
                    temporalReactiveFactor: 0,
                    emissionFactor: new Hilo3d.Color(
                        original.emissionFactor.r,
                        original.emissionFactor.g,
                        original.emissionFactor.b
                    ),
                    decals: { projectors, baseColorAtlas: petalAtlas }
                });
                replacedMaterials.set(original, receiver);
            }
            mesh.material = receiver;
            decalReceiverCount++;
            directMeshes.push(mesh);
        } else {
            buckets.push({ geometry: mesh.geometry, material: original });
        }
    }
    if (weightedMeshes.length < 2 || decalReceiverCount === 0) {
        throw new Error(
            'The Blender garden must include WaterSurface, ChimeGlass and stone paving/rock receivers.'
        );
    }
    model.node.traverse(node => {
        if (/^(Noren_\d|Chime)/.test(node.name)) {
            movingNodes.push({ node, angle: node.rotationZ, phase: movingNodes.length * 0.72 });
        }
    });
    const fogCenter = new Hilo3d.Vector3(0, 2.5, 0);
    const factory = new Hilo3d.ClusteredForwardPlusPipelineFactory({
        buckets,
        maxObjects: Math.max(128, model.meshes.length + 16),
        maxLights: 8,
        maxLightsPerCluster: 8,
        maxLightIndices: 262_144,
        tileSize: 32,
        zSlices: 20,
        maxViewportWidth: maxWidth,
        maxViewportHeight: maxHeight,
        hiZ: true,
        // Fine roof tiles and blossoms need stable accumulation without sharpening each jitter sample.
        temporalAA: { historyWeight: 0.98, varianceGamma: 2, sharpness: 0 },
        weightedBlendedTransparency: true,
        variantManifest: {
            entries: directMeshes.map(mesh => ({ mesh, shadowed: true })),
            maxVariants: 64
        },
        volumetricLighting: {
            quality: 'medium',
            density: 0,
            maxDistance: 42,
            albedo: new Hilo3d.Color(0.9, 0.97, 0.94),
            anisotropy: 0.35,
            ambientStrength: 0.22,
            historyWeight: 0.82,
            localVolumes: [
                {
                    shape: 'box',
                    center: fogCenter,
                    halfExtents: new Hilo3d.Vector3(7.5, 4, 6.5),
                    density: 0.017,
                    edgeFalloff: 0.45
                }
            ]
        },
        dynamicGlobalIllumination: {
            // The field includes the high cherry crown as well as the shaded tea counter.
            origin: new Hilo3d.Vector3(-7, 0.05, -4.7),
            spacing: new Hilo3d.Vector3(1.5, 1.55, 1.6),
            probeCounts: [10, 6, 7],
            raysPerProbe: 128,
            maxProbesPerFrame: 48,
            hysteresis: 0.82,
            intensity: 0.85,
            maxRayDistance: 20,
            environment: new Hilo3d.Color(0.64, 0.76, 0.85),
            bounceStrength: 0.65,
            relocation: true,
            maxTriangles: Math.max(32_768, Math.ceil(triangleCount + 256)),
            maxMeshes: Math.max(128, model.meshes.length + 32),
            maxTextureTexels: 65_536,
            maxLights: 8
        },
        bloomStrength: 0.035,
        exposure: 0.95
    });
    const camera = new Hilo3d.PerspectiveCamera({
        aspect: innerWidth / Math.max(innerHeight, 1),
        fov: 39,
        near: 0.1,
        far: 80,
        depthMode: 'reversed'
    });
    const canvas = document.createElement('canvas');
    const nativeDiagnostics = registerRendererDiagnostics(canvas);
    pendingResources.unregisterDiagnostics = (): void => {
        unregisterRendererDiagnostics(canvas, nativeDiagnostics);
    };
    element('#loadingDetail', HTMLElement).textContent = '薄雾散开，第一缕光落在石阶上…';
    document.body.dataset['rainTeaGardenPhase'] = 'creating';
    const stage = await Hilo3d.Stage.create<'webgpu'>({
        backend: 'webgpu',
        container: element('#container', HTMLElement),
        canvas,
        camera,
        width: Math.max(innerWidth, 1),
        height: Math.max(innerHeight, 1),
        pixelRatio: pixelRatio(),
        antialias: false,
        alpha: false,
        useInstanced: true,
        renderingProfile: 'high-end',
        clearColor: new Hilo3d.Color(0.45, 0.74, 0.89),
        renderPipeline: factory
    });
    pendingResources.stage = stage;
    model.node.addTo(stage);
    if (!(await waitForActivePage())) {
        await releaseInitialization();
        return;
    }
    canvas.setAttribute('aria-label', '雨后茶寮：拖动探索樱花、茶屋、小桥和清澈的池水');
    const sunlight = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.96, 0.9),
        amount: 2.45,
        direction: new Hilo3d.Vector3(0.7, -1, -0.45),
        shadow: {
            width: testMode ? 1024 : 2048,
            height: testMode ? 1024 : 2048,
            cascadeCount: 2,
            cascadeMaxDistance: 55,
            minBias: 0.001,
            maxBias: 0.003,
            shadowStrength: 0.85
        }
    }).addTo(stage);
    new Hilo3d.AmbientLight({ color: new Hilo3d.Color(0.62, 0.78, 0.77), amount: 0.24 }).addTo(
        stage
    );
    // Broad sky and ground fills retain painted color on leaves and fabric facing away from the sun.
    // Both remain ordinary scene lights, so DDGI transports their reflected light through the garden.
    const skyFill = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(0.8, 0.92, 1),
        amount: 0.68,
        direction: new Hilo3d.Vector3(-0.3, -0.18, -1)
    }).addTo(stage);
    const groundFill = new Hilo3d.DirectionalLight({
        color: new Hilo3d.Color(1, 0.9, 0.84),
        amount: 0.28,
        direction: new Hilo3d.Vector3(0.3, 1, 0.25)
    }).addTo(stage);
    const lanterns = [
        new Hilo3d.PointLight({ color: new Hilo3d.Color(1, 0.69, 0.36), amount: 4, range: 4 })
            .setPosition(2.75, 2.45, 0.65)
            .addTo(stage),
        new Hilo3d.PointLight({ color: new Hilo3d.Color(1, 0.79, 0.5), amount: 2, range: 3.5 })
            .setPosition(0, 2.35, -1.4)
            .addTo(stage),
        new Hilo3d.PointLight({ color: new Hilo3d.Color(1, 0.75, 0.44), amount: 1.5, range: 2.5 })
            .setPosition(-2.05, 0.92, 0.65)
            .addTo(stage)
    ];
    const petalGeometry = new Hilo3d.PlaneGeometry({ width: 0.13, height: 0.16 });
    const petalMaterial = new Hilo3d.BasicMaterial({
        diffuse: petalTexture,
        lightType: 'NONE',
        cullMode: 'none',
        opacity: 0.8,
        compositing: { mode: 'weighted-blended' }
    });
    const petals = Array.from({ length: 18 }, (_, index) => {
        const mesh = new Hilo3d.Mesh({
            name: `DriftingPetal_${String(index)}`,
            geometry: petalGeometry,
            material: petalMaterial,
            contributeToGlobalIllumination: false,
            castShadows: false,
            receiveShadows: false
        }).addTo(stage);
        weightedMeshes.push(mesh);
        return mesh;
    });
    const steamGeometry = new Hilo3d.PlaneGeometry({ width: 0.38, height: 0.64 });
    const steamMaterial = new Hilo3d.BasicMaterial({
        diffuse: steamTexture,
        lightType: 'NONE',
        cullMode: 'none',
        opacity: 0.24,
        compositing: { mode: 'weighted-blended' }
    });
    const steam = Array.from({ length: 3 }, (_, index) => {
        const mesh = new Hilo3d.Mesh({
            name: `TeaSteam_${String(index)}`,
            geometry: steamGeometry,
            material: steamMaterial,
            contributeToGlobalIllumination: false,
            castShadows: false,
            receiveShadows: false,
            x: -0.55,
            y: 2 + index * 0.14,
            z: -0.3,
            rotationY: 25 + index * 60
        }).addTo(stage);
        weightedMeshes.push(mesh);
        return mesh;
    });
    const controls = new Hilo3d.OrbitControls(stage, {
        camera,
        target: new Hilo3d.Vector3(...views[0].target),
        minDistance: 5,
        maxDistance: 45,
        minPolarAngle: 0.2,
        maxPolarAngle: Math.PI * 0.48,
        rotateSpeed: 0.45,
        zoomSpeed: 0.7,
        panSpeed: 0.4,
        enablePan: true
    });
    const features: Record<RainTeaGardenFeature, boolean> = {
        gi: true,
        volumetric: true,
        decals: true,
        transparency: true
    };
    let preset: RainTeaGardenPreset = 'morning';
    let motion = !testMode && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let view = 0;
    let elapsed = 0;
    let submittedFrames = 0;
    let disposed = false;
    let settling = false;
    let keepCapturePaused = false;
    let lastEvidence: RainTeaGardenDiagnostics | undefined;

    function assertLiveScene(): void {
        if (disposed) throw new Error('The tea garden has been disposed.');
    }

    function showView(): void {
        const selected = views[view];
        if (selected === undefined) throw new Error('The selected garden view is unavailable.');
        const target = new Hilo3d.Vector3(...selected.target);
        const distance = Math.max(1, Math.min(2.4, 1.18 / camera.aspect));
        controls.setView(
            new Hilo3d.Vector3(...selected.position).subtract(target).scale(distance).add(target),
            target
        );
        document.body.dataset['rainTeaGardenView'] = String(view);
    }

    function setPreset(next: RainTeaGardenPreset): void {
        if (disposed) throw new Error('The tea garden has been disposed.');
        preset = next;
        const evening = next === 'evening';
        sunlight.amount = evening ? 1.9 : 2.45;
        if (evening) {
            sunlight.color.set(1, 0.64, 0.37, 1);
            sunlight.direction.set(-0.8, -0.55, -0.5);
        } else {
            sunlight.color.set(1, 0.96, 0.9, 1);
            sunlight.direction.set(0.7, -1, -0.45);
        }
        factory.setDynamicGlobalIlluminationEnvironment(
            evening ? new Hilo3d.Color(0.4, 0.47, 0.59) : new Hilo3d.Color(0.64, 0.76, 0.85)
        );
        skyFill.amount = evening ? 0.35 : 0.68;
        groundFill.amount = evening ? 0.13 : 0.28;
        stage.renderer.clearColor = evening
            ? new Hilo3d.Color(0.84, 0.76, 0.71)
            : new Hilo3d.Color(0.45, 0.74, 0.89);
        lanterns.forEach((light, index) => {
            light.amount = evening ? 15 - index * 5 : 4 - index * 1.25;
        });
        element('#weatherLabel', HTMLElement).textContent = evening
            ? '17:40 · 暮色温柔'
            : '09:20 · 晨光微凉';
        element('#sceneCopy', HTMLElement).textContent = evening
            ? '灯亮了。再留一会，等晚风经过。'
            : '雨停了。来坐一会，让风把茶吹凉。';
        document.body.dataset['rainTeaGardenPreset'] = next;
        for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
            button.setAttribute('aria-pressed', String(button.dataset['preset'] === next));
        }
    }

    function setFeature(feature: RainTeaGardenFeature, enabled: boolean): void {
        if (disposed) throw new Error('The tea garden has been disposed.');
        features[feature] = enabled;
        if (feature === 'gi') factory.setDynamicGlobalIlluminationIntensity(enabled ? 0.85 : 0);
        if (feature === 'decals')
            projectors.forEach(projector => {
                projector.update({ enabled });
            });
        if (feature === 'transparency')
            weightedMeshes.forEach(mesh => {
                mesh.visible = enabled;
            });
        // The documented mutable local-volume center controls actual medium density.
        // Global density is zero, so moving this box past the integration range removes all fog.
        if (feature === 'volumetric') fogCenter.set(enabled ? 0 : 10_000, 2.5, 0);
        document
            .querySelector<HTMLButtonElement>(`[data-feature="${feature}"]`)
            ?.setAttribute('aria-pressed', String(enabled));
        document.body.dataset[
            `rainTeaGarden${feature[0]?.toUpperCase() ?? ''}${feature.slice(1)}`
        ] = String(enabled);
    }

    function setMotion(enabled: boolean): void {
        motion = enabled;
        element('#motionButton', HTMLButtonElement).setAttribute('aria-pressed', String(enabled));
        element('#motionLabel', HTMLElement).textContent = enabled ? '风在吹' : '静静看';
    }

    function animate(delta: number): void {
        if (motion) elapsed += Math.min(delta, 100) / 1000;
        for (let index = 0; index < petals.length; index++) {
            const petal = petals[index];
            if (petal === undefined) continue;
            const progress = (elapsed * 0.045 + index * 0.127) % 1;
            petal.setPosition(
                -4.5 + progress * 5 + Math.sin(index * 2.1) * 1.5,
                0.3 + (1 - progress) * 4.7,
                -1.8 + Math.sin(index * 1.7) * 2 + progress * 3.2
            );
            petal.rotationX = Math.sin(elapsed * 1.2 + index) * 65;
            petal.rotationY = elapsed * 22 + index * 53;
            petal.rotationZ = elapsed * 15 + index * 31;
        }
        movingNodes.forEach(item => {
            item.node.rotationZ = item.angle + Math.sin(elapsed * 1.25 + item.phase) * 1.4;
        });
        steam.forEach((mesh, index) => {
            const drift = (elapsed * 0.2 + index / 3) % 1;
            mesh.y = 1.77 + drift * 0.75;
            mesh.x = -0.55 + Math.sin(elapsed + index) * 0.07;
            mesh.scaleX = 0.6 + drift * 0.7;
        });
    }

    const ticker = new Hilo3d.Ticker(60);
    ticker.addTick({
        tick(delta: number): void {
            animate(delta);
        }
    });
    ticker.addTick(stage);
    ticker.addTick({
        tick(): void {
            submittedFrames++;
        }
    });
    const capture = testMode
        ? createTestFrameControl(ticker, () => stage.renderer.waitForIdle())
        : undefined;
    // The shared capture helper normally resumes in finally. A test can hold consecutive
    // submitted frames without scheduling an extra ticker frame between screenshot calls.
    const captureAdapter =
        capture === undefined
            ? undefined
            : {
                  ...capture,
                  resume(): void {
                      if (!keepCapturePaused) capture.resume();
                  }
              };
    if (captureAdapter !== undefined) window.__HILO3D_TEST_CAPTURE__ = captureAdapter;
    stopScene = (): void => {
        ticker.stop();
    };
    sceneLifecycle.suspend = (): void => {
        ticker.stop();
        capture?.setSuspended(true);
    };
    sceneLifecycle.resume = (): void => {
        if (!disposed && !lifecyclePaused && sceneReady && !settling && !keepCapturePaused) {
            capture?.setSuspended(false);
            capture?.resume();
            ticker.start();
        }
    };
    sceneLifecycle.dispose = dispose;
    disposeSceneOnFailure = dispose;

    async function diagnostics(): Promise<RainTeaGardenDiagnostics> {
        if (disposed) {
            if (lastEvidence === undefined)
                throw new Error('The disposed garden has no submitted evidence.');
            return { ...lastEvidence, disposed: true };
        }
        const native = nativeDiagnostics.snapshot();
        const pipeline = await factory.readDiagnostics();
        lastEvidence = {
            backend: 'webgpu',
            submittedFrames,
            drawCalls: native.frame.draws + native.frame.indirectDraws,
            features: { ...features },
            preset,
            motion,
            view,
            triangleCount,
            meshCount: model.meshes.length,
            decalCount: projectors.length,
            weightedMeshCount: weightedMeshes.length,
            camera: {
                position: vectorTuple(camera.position),
                target: vectorTuple(controls.target)
            },
            volumetricCenter: vectorTuple(fogCenter),
            disposed,
            passNames: native.renderGraph?.passes.map(pass => pass.name) ?? [],
            native,
            pipeline
        };
        return lastEvidence;
    }

    async function settle(
        frames = 27,
        options: Readonly<{ keepPaused?: boolean }> = {}
    ): Promise<RainTeaGardenDiagnostics> {
        assertLiveScene();
        if (!Number.isInteger(frames) || frames < 1 || frames > 180 || settling) {
            throw new RangeError('Garden settling requires 1–180 frames and one live, idle scene.');
        }
        if (options.keepPaused === true && !testMode)
            throw new Error('Holding a submitted garden frame requires test=1.');
        keepCapturePaused = options.keepPaused ?? false;
        settling = true;
        ticker.pause();
        try {
            await capture?.pause();
            await stage.renderer.waitForIdle();
            for (let frame = 0; frame < frames; frame++) {
                assertLiveScene();
                // Settling advances real rendering and probe histories, while preserving the authored pose.
                stage.tick(1000 / 60);
                await stage.renderer.waitForIdle();
                submittedFrames++;
            }
            return await diagnostics();
        } finally {
            settling = false;
            sceneLifecycle.resume?.();
        }
    }

    async function warmup(): Promise<boolean> {
        ticker.pause();
        await capture?.pause();
        for (let frame = 0; frame < 27; frame++) {
            if (!(await waitForActivePage())) return false;
            stage.tick(1000 / 60);
            await stage.renderer.waitForIdle();
            submittedFrames++;
            if (frame === 0) document.body.dataset['rainTeaGardenPhase'] = 'warming';
            // A retained page must finish no further draws, nor publish ready, until pageshow.
            if (!(await waitForActivePage())) return false;
        }
        await diagnostics();
        return waitForActivePage();
    }

    async function dispose(): Promise<void> {
        if (disposed) return;
        ticker.stop();
        capture?.dispose();
        disposed = true;
        controls.dispose();
        eventScope.abort();
        fieldset.disabled = true;
        if (window.__HILO3D_TEST_CAPTURE__ === captureAdapter)
            delete window.__HILO3D_TEST_CAPTURE__;
        document.body.dataset['rainTeaGardenDisposed'] = 'true';
        document.body.dataset['rainTeaGardenPhase'] = 'disposed';
        try {
            await stage.renderer.waitForIdle();
        } finally {
            stage.destroy();
            textures.forEach(texture => {
                texture.destroy();
            });
            unregisterRendererDiagnostics(canvas, nativeDiagnostics);
        }
    }

    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-preset]')) {
        button.addEventListener(
            'click',
            () => {
                const next = button.dataset['preset'];
                if (next === 'morning' || next === 'evening') setPreset(next);
            },
            events
        );
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-feature]')) {
        button.addEventListener(
            'click',
            () => {
                const feature = button.dataset['feature'];
                if (
                    feature === 'gi' ||
                    feature === 'volumetric' ||
                    feature === 'decals' ||
                    feature === 'transparency'
                )
                    setFeature(feature, !features[feature]);
            },
            events
        );
    }
    element('#motionButton', HTMLButtonElement).addEventListener(
        'click',
        () => {
            setMotion(!motion);
        },
        events
    );
    element('#viewButton', HTMLButtonElement).addEventListener(
        'click',
        () => {
            view = (view + 1) % views.length;
            showView();
        },
        events
    );
    window.addEventListener(
        'resize',
        () => {
            camera.aspect = innerWidth / Math.max(innerHeight, 1);
            stage.resize(Math.max(innerWidth, 1), Math.max(innerHeight, 1), pixelRatio());
        },
        events
    );
    window.addEventListener(
        'error',
        () => {
            ticker.stop();
        },
        events
    );
    showView();
    setPreset(parameters.get('time') === 'evening' ? 'evening' : 'morning');
    setMotion(motion);
    animate(0);
    if (!(await warmup())) {
        await dispose();
        return;
    }
    window.__HILO_RAIN_TEA_GARDEN__ = {
        settle,
        setPreset,
        setFeature,
        setMotion,
        diagnostics,
        dispose
    };
    fieldset.disabled = false;
    loading.hidden = true;
    sceneReady = true;
    document.body.dataset['rainTeaGardenReady'] = 'true';
    document.body.dataset['rainTeaGardenPhase'] = 'ready';
    sceneLifecycle.resume();
}

function showFailure(error: unknown): void {
    stopScene?.();
    const failure = error instanceof Error ? error : new Error(String(error));
    document.body.dataset['rainTeaGardenReady'] = 'error';
    document.body.dataset['rainTeaGardenFailed'] = failure.message;
    const panel = element('#loadingPanel', HTMLElement);
    panel.hidden = false;
    panel.dataset['state'] = 'error';
    element('#loadingTitle', HTMLElement).textContent = '庭院还没准备好';
    element('#loadingDetail', HTMLElement).textContent = failure.message;
    element('#controlsFieldset', HTMLFieldSetElement).disabled = true;
    console.error(failure);
}

async function handleInitializationFailure(error: unknown): Promise<void> {
    stopScene?.();
    try {
        await disposeSceneOnFailure?.();
    } catch (cleanupError) {
        showFailure(
            new AggregateError(
                [error, cleanupError],
                'Tea garden initialization and cleanup failed.',
                { cause: error }
            )
        );
        return;
    }
    showFailure(error);
}

void run().catch(handleInitializationFailure);
