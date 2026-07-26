import * as Hilo3d from '../src/Hilo3d';
import { applyEnvironmentMaps } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const ASSETS = {
    lamp: {
        name: 'Anisotropy Barn Lamp',
        file: 'AnisotropyBarnLamp.glb',
        description: 'Brushed copper, clearcoat, emissive filament and transmissive bulb glass.',
        extensions: ['anisotropy', 'clearcoat', 'transmission', 'volume'],
        fitSize: 4.35,
        rotationY: 20,
        yOffset: 0.1
    },
    wicker: {
        name: 'Clearcoat Wicker',
        file: 'ClearcoatWicker.glb',
        description: 'A woven metallic base under a wrinkled dielectric clearcoat normal.',
        extensions: ['clearcoat', 'clearcoat normal'],
        fitSize: 3.35,
        rotationY: -18,
        yOffset: 0.15
    },
    dragon: {
        name: 'Dragon Attenuation',
        file: 'DragonAttenuation.glb',
        description: 'Thickness-textured amber absorption refracting an opaque checker backdrop.',
        extensions: ['transmission', 'volume', 'thickness texture'],
        fitSize: 4.9,
        rotationY: 0,
        yOffset: -0.05
    },
    dish: {
        name: 'Iridescent Dish with Olives',
        file: 'IridescentDishWithOlives.glb',
        description: 'Animated carnival glass with spectral thin-film color and volume refraction.',
        extensions: ['iridescence', 'ior', 'transmission', 'volume'],
        fitSize: 4.4,
        rotationY: -24,
        yOffset: -0.1
    }
} as const;

type AssetKey = keyof typeof ASSETS;

function assetKey(value: string | null): AssetKey | null {
    return value === 'lamp' || value === 'wicker' || value === 'dragon' || value === 'dish'
        ? value
        : null;
}

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing showcase element ${selector}`);
    return element;
}

function require2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Khronos material gallery requires Canvas 2D');
    return context;
}

function paintStudioBackdrop(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    key: AssetKey
): void {
    const isDish = key === 'dish';
    const background = context.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, isDish ? '#050d1c' : '#030816');
    background.addColorStop(0.52, isDish ? '#071a32' : '#05142e');
    background.addColorStop(1, isDish ? '#020711' : '#02050d');
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const softbox = context.createRadialGradient(
        width * 0.67,
        height * 0.34,
        0,
        width * 0.67,
        height * 0.34,
        height * 0.46
    );
    softbox.addColorStop(0, isDish ? 'rgba(151, 197, 242, 0.19)' : 'rgba(94, 151, 231, 0.13)');
    softbox.addColorStop(0.38, isDish ? 'rgba(70, 126, 195, 0.09)' : 'rgba(30, 91, 171, 0.06)');
    softbox.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = softbox;
    context.fillRect(0, 0, width, height);

    const horizon = context.createLinearGradient(0, height * 0.58, 0, height);
    horizon.addColorStop(0, 'rgba(255, 255, 255, 0)');
    horizon.addColorStop(0.62, isDish ? 'rgba(128, 168, 214, 0.05)' : 'rgba(67, 113, 183, 0.04)');
    horizon.addColorStop(1, 'rgba(0, 0, 0, 0.22)');
    context.fillStyle = horizon;
    context.fillRect(0, height * 0.58, width, height * 0.42);
}

const presentationRoot = new Hilo3d.Node();
const { stage, camera, renderer, directionLight, ambientLight } = await createExampleContext({
    camera: {
        fov: 40,
        near: 0.05,
        far: 80,
        z: 7.6
    },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: {
                threshold: 1.3,
                knee: 0.42,
                intensity: 0.32,
                scatter: 0.58,
                maxLevels: 7
            },
            colorUber: {
                exposure: -0.24,
                contrast: 0.035,
                saturation: 0.025,
                temperature: 0.012,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.4,
                vignetteSmoothness: 0.62,
                vignetteColor: new Hilo3d.Color(0.004, 0.006, 0.018, 0.58)
            },
            opaqueTexture: true
        })
    },
    controls: {
        model: presentationRoot,
        isLockMove: true,
        isLockZ: true,
        isLockScale: false,
        rotationXLimit: Math.PI / 2
    }
});

presentationRoot.addTo(stage);
presentationRoot.x = 0.85;
camera.y = 0.35;
camera.lookAt(new Hilo3d.Vector3(0.3, 0.2, 0));
renderer.clearColor.set(0.003, 0.005, 0.016, 1);
directionLight.amount = 2.05;
directionLight.color.set(1, 0.93, 0.86, 1);
directionLight.direction.set(-0.7, -1, -0.48);
ambientLight.amount = 0.15;

const environment = await loadEnvironmentMaps();

const floorMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.018, 0.026, 0.052),
    metallic: 0.78,
    roughness: 0.38
});
applyEnvironmentMaps([floorMaterial], environment);
new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 18, height: 12 }),
    material: floorMaterial,
    y: -2.4,
    z: 1,
    rotationX: -90
}).addTo(stage);

const backdropCanvas = document.createElement('canvas');
backdropCanvas.width = 1024;
backdropCanvas.height = 512;
const backdropContext = require2DContext(backdropCanvas);
paintStudioBackdrop(backdropContext, backdropCanvas.width, backdropCanvas.height, 'lamp');
const backdropTexture = new Hilo3d.Texture({
    image: backdropCanvas,
    minFilter: Hilo3d.constants.webgl.LINEAR,
    magFilter: Hilo3d.constants.webgl.LINEAR,
    wrapS: Hilo3d.constants.webgl.CLAMP_TO_EDGE,
    wrapT: Hilo3d.constants.webgl.CLAMP_TO_EDGE
});
const backdropMaterial = new Hilo3d.BasicMaterial({
    lightType: 'NONE',
    diffuse: backdropTexture
});
new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 18, height: 11 }),
    material: backdropMaterial,
    x: 0.8,
    y: 0.4,
    z: -3.2
}).addTo(stage);

const rimLight = new Hilo3d.AreaLight({
    color: new Hilo3d.Color(0.24, 0.58, 1),
    amount: 2.75,
    width: 4,
    height: 3,
    x: 3.8,
    y: 3.2,
    z: 2.5
}).addTo(stage);
rimLight.lookAt(new Hilo3d.Vector3(0, 0.3, 0));

const warmLight = new Hilo3d.PointLight({
    color: new Hilo3d.Color(1, 0.48, 0.24),
    amount: 2.8,
    range: 12,
    x: -3.6,
    y: 1.4,
    z: 2.2
}).addTo(stage);

const assetName = requireElement('#assetName');
const assetDescription = requireElement('#assetDescription');
const assetStatus = requireElement('#assetStatus');
const assetBadges = requireElement('#assetBadges');
const buttons = [
    ...document.querySelectorAll<HTMLButtonElement>('.assetButton[data-asset]')
] as const;
const loader = new Hilo3d.GLTFLoader();
type LoadedModel = Awaited<ReturnType<typeof loader.load>>;
interface LoadedAsset {
    readonly model: LoadedModel;
    readonly node: Hilo3d.Node;
}
const loadedAssets = new Map<AssetKey, LoadedAsset>();
let currentAsset: AssetKey | null = null;
let currentNode: Hilo3d.Node | null = null;
let selectionGeneration = 0;

function updateMetadata(key: AssetKey, status: string): void {
    const asset = ASSETS[key];
    assetName.textContent = asset.name;
    assetDescription.textContent = asset.description;
    assetStatus.textContent = status;
    assetBadges.replaceChildren(
        ...asset.extensions.map(extension => {
            const badge = document.createElement('span');
            badge.className = 'showcaseBadge';
            badge.textContent = extension;
            return badge;
        })
    );
    for (const button of buttons) {
        button.setAttribute('aria-pressed', String(button.dataset['asset'] === key));
    }
}

function setButtonsDisabled(disabled: boolean): void {
    for (const button of buttons) button.disabled = disabled;
}

function frameModel(model: LoadedModel, key: AssetKey): Hilo3d.Node {
    const asset = ASSETS[key];
    const bounds = model.node.getBounds();
    if (!bounds) throw new Error(`${asset.name} has no renderable bounds`);
    const largestDimension = Math.max(bounds.width, bounds.height, bounds.depth);
    if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
        throw new RangeError(`${asset.name} has invalid bounds`);
    }
    const scale = asset.fitSize / largestDimension;
    model.node.setScale(scale);
    model.node.setPosition(-bounds.x * scale, -bounds.y * scale + asset.yOffset, -bounds.z * scale);
    model.node.rotationY = asset.rotationY;
    return model.node;
}

async function getAsset(key: AssetKey): Promise<LoadedAsset> {
    const cached = loadedAssets.get(key);
    if (cached) return cached;
    const asset = ASSETS[key];
    const model = await loader.load({
        src: new URL(`./models/KhronosPBR/${asset.file}`, import.meta.url).href
    });
    await model.ready;
    if (model.resourceErrors.length > 0) {
        throw new AggregateError(model.resourceErrors, `${asset.name} has resource failures`);
    }
    applyEnvironmentMaps(model.materials, environment);
    for (const material of model.materials) {
        if (!(material instanceof Hilo3d.PBRMaterial)) continue;
        material.diffuseEnvIntensity = 1.18;
        material.specularEnvIntensity = 1.3;
        if (key === 'dish') {
            material.diffuseEnvIntensity = 1.7;
            material.specularEnvIntensity = 2;
        }
    }
    const loaded = Object.freeze({
        model,
        node: frameModel(model, key)
    });
    loadedAssets.set(key, loaded);
    return loaded;
}

async function selectAsset(key: AssetKey): Promise<void> {
    if (currentAsset === key) return;
    const generation = ++selectionGeneration;
    updateMetadata(key, 'loading');
    setButtonsDisabled(true);
    try {
        const loaded = await getAsset(key);
        if (generation !== selectionGeneration) return;
        currentNode?.removeFromParent();
        currentNode = loaded.node;
        currentNode.addTo(presentationRoot);
        currentAsset = key;
        if (key === 'dish') {
            ambientLight.amount = 0.26;
            directionLight.amount = 1.55;
            rimLight.amount = 2.8;
            warmLight.amount = 1.1;
        } else {
            ambientLight.amount = 0.15;
            directionLight.amount = 2.05;
            rimLight.amount = 2.75;
            warmLight.amount = 2.8;
        }
        paintStudioBackdrop(backdropContext, backdropCanvas.width, backdropCanvas.height, key);
        backdropTexture.needUpdate = true;
        presentationRoot.setRotation(0, 0, 0);
        updateMetadata(key, 'ready');
        const url = new URL(location.href);
        url.searchParams.set('asset', key);
        history.replaceState(null, '', url);
        document.body.dataset['showcaseReady'] = key;
    } finally {
        if (generation === selectionGeneration) setButtonsDisabled(false);
    }
}

for (const button of buttons) {
    button.addEventListener('click', () => {
        const key = assetKey(button.dataset['asset'] ?? null);
        if (!key) return;
        void selectAsset(key).catch((error: unknown) => {
            assetStatus.textContent = 'failed';
            console.error(`Failed to load ${ASSETS[key].name}`, error);
        });
    });
}

presentationRoot.onUpdate = deltaTime => {
    if (currentAsset === 'wicker') presentationRoot.rotationY += deltaTime * 0.006;
    warmLight.y = 1.4 + Math.sin(performance.now() * 0.00055) * 0.5;
};

const initialAsset = assetKey(new URL(location.href).searchParams.get('asset')) ?? 'lamp';
await selectAsset(initialAsset);
