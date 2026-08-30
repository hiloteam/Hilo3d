import * as Hilo3d from '../src/Hilo3d';
import { createExampleContext } from './shared/init';
import { createStudioEnvironmentMaps } from './shared/studioEnvironment';

const query = new URLSearchParams(location.search);
const testMode = query.get('test') === '1';
let aoEnabled = query.get('ao') !== 'false';
let motionEnabled = query.get('motion') === 'true';
let edgeViewEnabled = false;

function requireButton(id: string): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button === null) throw new Error(`GTAO acceptance lab is missing #${id}`);
    return button;
}

function createNormalTexture(): Hilo3d.Texture {
    const size = 96;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Unable to create the GTAO normal fixture');
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const v = y / size;
            const nx = Math.sin(u * Math.PI * 12) * 0.28;
            const ny = Math.cos(v * Math.PI * 10 + u * Math.PI * 2) * 0.28;
            const nz = Math.sqrt(Math.max(1 - nx * nx - ny * ny, 0));
            const offset = (y * size + x) * 4;
            image.data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
            image.data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
            image.data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
            image.data[offset + 3] = 255;
        }
    }
    context.putImageData(image, 0, 0);
    return new Hilo3d.Texture({
        image: canvas,
        wrapS: Hilo3d.constants.webgl.REPEAT,
        wrapT: Hilo3d.constants.webgl.REPEAT,
        magFilter: Hilo3d.constants.webgl.LINEAR,
        minFilter: Hilo3d.constants.webgl.LINEAR_MIPMAP_LINEAR
    });
}

class ToggleableGTAO implements Hilo3d.ForwardRenderPipelineFeature {
    readonly name = 'ground-truth-ambient-occlusion';
    readonly injectionPoint = 'before-opaque' as const;
    readonly requirements: Readonly<Hilo3d.ForwardRenderFeatureRequirements>;
    readonly #feature: Hilo3d.GroundTruthAmbientOcclusion;
    enabled: boolean;

    constructor(enabled: boolean) {
        this.enabled = enabled;
        this.#feature = new Hilo3d.GroundTruthAmbientOcclusion({
            quality: testMode ? 'low' : 'high',
            radius: 1.65,
            falloffStart: 0.62,
            thickness: 0.035,
            thicknessBlend: 0.58,
            intensity: 1.08,
            power: 1.16,
            bias: 0.032,
            contactRadiusScale: 0.18,
            contactStrength: 0.32,
            normalSource: 'hybrid',
            geometricNormalWeight: 0.68,
            bentNormalStrength: 0.92,
            multiBounce: 0.9,
            distanceFadeStart: 32,
            distanceFadeEnd: 52,
            edgeFadePixels: 2,
            historyWeight: 0.9,
            depthThreshold: 0.025,
            normalThreshold: 0.84
        });
        this.requirements = this.#feature.requirements;
    }

    create(): Hilo3d.ForwardRenderPipelineFeatureRuntime {
        const runtime = this.#feature.create();
        return {
            record: (context: Hilo3d.ForwardRenderFeatureContext): unknown =>
                this.enabled ? runtime.record(context) : undefined,
            frameSubmitted(frameIndex: number): void {
                runtime.frameSubmitted?.(frameIndex);
            },
            frameDiscarded(frameIndex: number): void {
                runtime.frameDiscarded?.(frameIndex);
            },
            destroy(): void {
                runtime.destroy();
            }
        };
    }
}

const gtao = new ToggleableGTAO(aoEnabled);
const pipeline = new Hilo3d.PostProcessRenderPipelineFactory({
    groundTruthAmbientOcclusion: false,
    bloom: false,
    colorUber: {
        toneMapping: 'pbr-neutral',
        exposure: -0.18,
        contrast: 0.04,
        saturation: -0.04,
        vignetteIntensity: 0.08,
        vignetteSmoothness: 0.86,
        vignetteColor: new Hilo3d.Color(0.02, 0.022, 0.024, 0.2)
    },
    features: [gtao]
});

const heroView = new Hilo3d.Vector3(9.8, 5.25, 13.4);
const heroTarget = new Hilo3d.Vector3(0, -0.05, -1.5);
const edgeView = new Hilo3d.Vector3(13.6, 3.3, 8.7);
const edgeTarget = new Hilo3d.Vector3(1.7, -0.15, -2.2);
const { stage, renderer, camera, directionLight, ambientLight, orbitControls, ticker } =
    await createExampleContext({
        autoStart: false,
        camera: {
            fov: 39,
            near: 0.08,
            far: 80,
            x: heroView.x,
            y: heroView.y,
            z: heroView.z
        },
        stage: {
            width: testMode ? 640 : window.innerWidth,
            height: testMode ? 360 : window.innerHeight,
            pixelRatio: testMode ? 1 : Math.min(devicePixelRatio, 1.5),
            clearColor: new Hilo3d.Color(0.055, 0.06, 0.064),
            useLogDepth: query.get('logDepth') === 'true',
            useInstanced: true,
            renderPipeline: pipeline
        },
        controls: {
            target: heroTarget,
            enablePan: false,
            minDistance: 8,
            maxDistance: 30,
            minPolarAngle: Math.PI * 0.18,
            maxPolarAngle: Math.PI * 0.62,
            rotateSpeed: 0.42,
            zoomSpeed: 0.62
        }
    });

orbitControls.setView(heroView, heroTarget);
renderer.clearColor.set(0.055, 0.06, 0.064, 1);
directionLight.amount = 0.38;
directionLight.color.set(1, 0.9, 0.78, 1);
directionLight.direction.set(-0.58, -0.82, -0.42);
ambientLight.amount = 1.72;
ambientLight.color.set(0.76, 0.81, 0.88, 1);

const { diffuseEnvMap, specularEnvMap } = createStudioEnvironmentMaps();
const brdfLUT = await new Hilo3d.TextureLoader().load({
    src: new URL('./image/brdfLUT.png', import.meta.url).href,
    wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
    wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
});
const materialDefaults = Object.freeze({
    brdfLUT,
    diffuseEnvMap: Object.freeze({ texture: diffuseEnvMap, encoding: 'srgb' as const }),
    specularEnvMap: Object.freeze({ texture: specularEnvMap, encoding: 'srgb' as const }),
    diffuseEnvIntensity: 1.05,
    specularEnvIntensity: 0.42
});
const material = (
    color: Readonly<[number, number, number]>,
    roughness: number,
    metallic = 0
): Hilo3d.PBRMaterial =>
    new Hilo3d.PBRMaterial({
        ...materialDefaults,
        baseColor: new Hilo3d.Color(color[0], color[1], color[2]),
        roughness,
        metallic
    });

const plaster = material([0.67, 0.65, 0.6], 0.94);
const pale = material([0.82, 0.79, 0.72], 0.88);
const dark = material([0.14, 0.16, 0.17], 0.76);
const copper = material([0.62, 0.26, 0.095], 0.24, 0.82);
const normalMaterial = new Hilo3d.PBRMaterial({
    ...materialDefaults,
    baseColor: new Hilo3d.Color(0.42, 0.54, 0.58),
    roughness: 0.62,
    metallic: 0,
    normalMap: createNormalTexture(),
    normalScale: 1
});
const sharedBoxGeometry = new Hilo3d.BoxGeometry();

const addBox = (
    size: Readonly<[number, number, number]>,
    position: Readonly<[number, number, number]>,
    surface: Hilo3d.PBRMaterial,
    rotation: Readonly<[number, number, number]> = [0, 0, 0]
): Hilo3d.Mesh => {
    const mesh = new Hilo3d.Mesh({
        geometry: sharedBoxGeometry,
        material: surface,
        x: position[0],
        y: position[1],
        z: position[2],
        rotationX: rotation[0],
        rotationY: rotation[1],
        rotationZ: rotation[2],
        frustumTest: false
    });
    mesh.setScale(size[0], size[1], size[2]);
    mesh.addTo(stage);
    return mesh;
};

addBox([15, 0.22, 11], [0, -1.62, -1.1], plaster);
addBox([15, 6.2, 0.22], [0, 1.38, -6.45], plaster);
addBox([0.22, 5.2, 4.4], [-5.8, 0.88, -4.25], plaster);

// 01: a clean ninety-degree concavity and a sphere-to-floor contact.
addBox([0.28, 3.2, 3.4], [-4.15, -0.01, -4.72], pale);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.72, widthSegments: 32, heightSegments: 18 }),
    material: dark,
    x: -4.55,
    y: -0.78,
    z: -3.68,
    frustumTest: false
}).addTo(stage);

// 02: sub-radius cards exercise thickness handling without growing black halos.
for (let index = 0; index < 4; index += 1) {
    addBox(
        [0.055, 1.7 - index * 0.15, 1.65],
        [-2.65 + index * 0.42, -0.72 + index * 0.03, -3.45 - index * 0.2],
        index % 2 === 0 ? pale : dark,
        [0, -18 + index * 12, 0]
    );
}

// 03: parallel gaps verify depth-aware filtering and medium-scale visibility.
for (let index = 0; index < 3; index += 1) {
    addBox([2.2, 0.13, 1.35], [0.15, -0.82 + index * 0.54, -4.72], pale);
}

// 04: repeated contacts make over-blur and leaking immediately visible.
for (let index = 0; index < 5; index += 1) {
    addBox(
        [0.92, 0.28 + index * 0.22, 1.42],
        [2.15 + index * 0.72, -1.48 + (0.28 + index * 0.22) * 0.5, -4.75],
        plaster
    );
}

// 05/06: material normal detail plus rough dielectric and glossy metal response.
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.78, widthSegments: 40, heightSegments: 22 }),
    material: normalMaterial,
    x: -1.62,
    y: -0.82,
    z: -1.42,
    rotationY: -8,
    frustumTest: false
}).addTo(stage);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.76, widthSegments: 32, heightSegments: 18 }),
    material: pale,
    x: 0.48,
    y: -0.82,
    z: -1.35,
    frustumTest: false
}).addTo(stage);
new Hilo3d.Mesh({
    geometry: new Hilo3d.SphereGeometry({ radius: 0.76, widthSegments: 32, heightSegments: 18 }),
    material: copper,
    x: 2.32,
    y: -0.82,
    z: -1.28,
    frustumTest: false
}).addTo(stage);

// 07: closest-depth motion selection and history rejection around a moving occluder.
const movingOccluder = addBox([0.34, 2.25, 1.4], [4.45, -0.38, -1.92], dark, [0, -12, 0]);
addBox([2.65, 0.12, 1.65], [4.45, -1.05, -2.02], pale);

let elapsedSeconds = 0;
const motionDriver: Hilo3d.Tickable = {
    tick(deltaTime: number): void {
        if (!motionEnabled) return;
        elapsedSeconds += Math.min(deltaTime, 50) * 0.001;
        movingOccluder.x = 4.45 + Math.sin(elapsedSeconds * 1.15) * 0.92;
        movingOccluder.rotationY = -12 + Math.sin(elapsedSeconds * 0.73) * 20;
    }
};
ticker.addTick(motionDriver);

const aoToggle = requireButton('aoToggle');
const motionToggle = requireButton('motionToggle');
const viewToggle = requireButton('viewToggle');
const backendLabel = document.querySelector<HTMLElement>('#backendLabel');
if (backendLabel === null) throw new Error('GTAO acceptance lab is missing #backendLabel');

function reflectState(): void {
    aoToggle.setAttribute('aria-pressed', String(aoEnabled));
    aoToggle.textContent = aoEnabled ? 'AO enabled' : 'AO disabled';
    motionToggle.setAttribute('aria-pressed', String(motionEnabled));
    motionToggle.textContent = motionEnabled ? 'pause motion' : 'start motion';
    viewToggle.setAttribute('aria-pressed', String(edgeViewEnabled));
    viewToggle.textContent = edgeViewEnabled ? 'hero view' : 'edge view';
    document.body.dataset['ao'] = aoEnabled ? 'enabled' : 'disabled';
    document.body.dataset['motion'] = motionEnabled ? 'running' : 'paused';
}

function renderStaticTestFrame(): void {
    if (testMode && !motionEnabled) stage.tick(1000 / 60);
}

aoToggle.addEventListener('click', () => {
    aoEnabled = !aoEnabled;
    gtao.enabled = aoEnabled;
    reflectState();
    renderStaticTestFrame();
});
motionToggle.addEventListener('click', () => {
    motionEnabled = !motionEnabled;
    reflectState();
    if (testMode) {
        if (motionEnabled) ticker.start();
        else ticker.stop();
    }
});
viewToggle.addEventListener('click', () => {
    edgeViewEnabled = !edgeViewEnabled;
    orbitControls.setView(
        edgeViewEnabled ? edgeView : heroView,
        edgeViewEnabled ? edgeTarget : heroTarget
    );
    camera.invalidateTransformHistory();
    reflectState();
    renderStaticTestFrame();
});

const backendNames = Object.freeze({ webgl2: 'WebGL 2', webgpu: 'WebGPU' });
backendLabel.textContent = `${backendNames[renderer.backend]} · ${
    query.get('logDepth') === 'true' ? 'log depth' : 'linear depth'
}`;
reflectState();

function errorChain(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    const cause = error.cause;
    return cause === undefined ? error.message : `${error.message}: ${errorChain(cause)}`;
}

const warmupFrameCount = testMode ? 1 : 12;
for (let frame = 0; frame < warmupFrameCount; frame += 1) {
    try {
        stage.tick(1000 / 60);
        await renderer.waitForIdle();
    } catch (error) {
        throw new Error(`GTAO acceptance warmup failed: ${errorChain(error)}`, { cause: error });
    }
}
if (!testMode || motionEnabled) ticker.start();
document.body.dataset['aoAcceptancePhase'] = 'ready';
