import * as Hilo3d from '../src/Hilo3d';
import { addEnvironmentSkybox, environmentMaterialDefaults } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

const ASSETS = {
    lamp: {
        name: 'Anisotropy Barn Lamp',
        file: 'AnisotropyBarnLamp.glb',
        description: 'Brushed copper, clearcoat, emissive filament and transmissive bulb glass.',
        extensions: ['anisotropy', 'clearcoat', 'transmission', 'volume'],
        fitSize: 4.35,
        rotationY: 20,
        yOffset: 0.1,
        diffuseEnvIntensity: 0.68,
        specularEnvIntensity: 0.76,
        lightProfile: 'standard'
    },
    wicker: {
        name: 'Clearcoat Wicker',
        file: 'ClearcoatWicker.glb',
        description: 'A woven metallic base under a wrinkled dielectric clearcoat normal.',
        extensions: ['clearcoat', 'clearcoat normal'],
        fitSize: 3.35,
        rotationY: -18,
        yOffset: 0.15,
        diffuseEnvIntensity: 0.68,
        specularEnvIntensity: 0.76,
        lightProfile: 'standard'
    },
    dragon: {
        name: 'Dragon Attenuation',
        file: 'DragonAttenuation.glb',
        description: 'Thickness-textured amber absorption refracting an opaque checker backdrop.',
        extensions: ['transmission', 'volume', 'thickness texture'],
        fitSize: 4.9,
        rotationY: 0,
        yOffset: -0.05,
        diffuseEnvIntensity: 0.9,
        specularEnvIntensity: 1,
        lightProfile: 'glass'
    },
    dish: {
        name: 'Iridescent Dish with Olives',
        file: 'IridescentDishWithOlives.glb',
        description: 'Animated carnival glass with spectral thin-film color and volume refraction.',
        extensions: ['iridescence', 'ior', 'transmission', 'volume'],
        fitSize: 4.4,
        rotationY: -24,
        yOffset: -0.1,
        diffuseEnvIntensity: 1.05,
        specularEnvIntensity: 1.15,
        lightProfile: 'glass'
    },
    candle: {
        name: 'Glass Hurricane Candle Holder',
        file: 'GlassHurricaneCandleHolder.glb',
        description: 'Colored glass uses textured thickness, transmission and volume absorption.',
        extensions: ['transmission', 'volume', 'thickness texture'],
        fitSize: 4.3,
        rotationY: 18,
        yOffset: -0.05,
        diffuseEnvIntensity: 0.9,
        specularEnvIntensity: 1,
        lightProfile: 'glass'
    },
    amber: {
        name: 'Mosquito in Amber',
        file: 'MosquitoInAmber.glb',
        description: 'A scanned insect suspended inside refractive amber with a physical IOR.',
        extensions: ['transmission', 'volume', 'ior'],
        fitSize: 4,
        rotationY: -22,
        yOffset: 0,
        diffuseEnvIntensity: 0.9,
        specularEnvIntensity: 1,
        lightProfile: 'glass'
    },
    helmet: {
        name: 'Damaged Helmet',
        file: 'DamagedHelmet.glb',
        description: 'A core metallic-roughness benchmark with detailed normal and emissive maps.',
        extensions: ['metallic-roughness', 'normal map', 'emissive'],
        fitSize: 4.3,
        rotationY: -10,
        yOffset: 0,
        diffuseEnvIntensity: 0.88,
        specularEnvIntensity: 0.98,
        lightProfile: 'standard'
    }
} as const;

type AssetKey = keyof typeof ASSETS;

function assetKey(value: string | null): AssetKey | null {
    return value && value in ASSETS ? (value as AssetKey) : null;
}

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing showcase element ${selector}`);
    return element;
}

function describeError(error: unknown): string {
    const messages: string[] = [];
    let current = error;
    while (current instanceof Error) {
        messages.push(current.message);
        current = current.cause;
    }
    return messages.join(' → ');
}

const presentationRoot = new Hilo3d.Node();
const { stage, renderer, directionLight, ambientLight } = await createExampleContext({
    camera: {
        fov: 40,
        near: 0.05,
        far: 80,
        y: 0.35,
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
        enablePan: false,
        target: new Hilo3d.Vector3(0.3, 0.2, 0)
    }
});

presentationRoot.addTo(stage);
renderer.clearColor.set(0.003, 0.005, 0.016, 1);
directionLight.amount = 1.45;
directionLight.color.set(1, 0.93, 0.86, 1);
directionLight.direction.set(-0.7, -1, -0.48);
ambientLight.amount = 0.15;

function layoutPresentation(): void {
    const width = window.innerWidth;
    if (width <= 560) {
        presentationRoot.setScale(0.62);
        presentationRoot.setPosition(0.3, -0.72, 0);
    } else if (width <= 900) {
        presentationRoot.setScale(0.8);
        presentationRoot.setPosition(0.5, -0.25, 0);
    } else {
        presentationRoot.setScale(1);
        presentationRoot.setPosition(0.85, 0, 0);
    }
}

layoutPresentation();
window.addEventListener('resize', layoutPresentation);

const environment = await loadEnvironmentMaps();
addEnvironmentSkybox(stage, environment.skyboxMap);

const floorMaterial = new Hilo3d.PBRMaterial({
    ...environmentMaterialDefaults(environment),
    baseColor: new Hilo3d.Color(0.018, 0.026, 0.052),
    metallic: 0.78,
    roughness: 0.38
});
new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 18, height: 12 }),
    material: floorMaterial,
    y: -2.4,
    z: 1,
    rotationX: -90
}).addTo(stage);

const rimLight = new Hilo3d.AreaLight({
    color: new Hilo3d.Color(0.24, 0.58, 1),
    amount: 1.9,
    width: 4,
    height: 3,
    x: 3.8,
    y: 3.2,
    z: 2.5
}).addTo(stage);
rimLight.lookAt(new Hilo3d.Vector3(0, 0.3, 0));

const warmLight = new Hilo3d.PointLight({
    color: new Hilo3d.Color(1, 0.48, 0.24),
    amount: 1.6,
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
        src: new URL(`./models/KhronosPBR/${asset.file}`, import.meta.url).href,
        pbrMaterialDefaults: {
            ...environmentMaterialDefaults(environment),
            diffuseEnvIntensity: asset.diffuseEnvIntensity,
            specularEnvIntensity: asset.specularEnvIntensity
        }
    });
    await model.ready;
    if (model.resourceErrors.length > 0) {
        throw new AggregateError(model.resourceErrors, `${asset.name} has resource failures`);
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
        if (ASSETS[key].lightProfile === 'glass') {
            ambientLight.amount = 0.22;
            directionLight.amount = 1.25;
            rimLight.amount = 2.1;
            warmLight.amount = 0.95;
        } else {
            ambientLight.amount = 0.15;
            directionLight.amount = 1.45;
            rimLight.amount = 1.9;
            warmLight.amount = 1.6;
        }
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
            console.error(`Failed to load ${ASSETS[key].name}: ${describeError(error)}`);
        });
    });
}

presentationRoot.onUpdate = deltaTime => {
    if (currentAsset === 'wicker') presentationRoot.rotationY += deltaTime * 0.006;
    warmLight.y = 1.4 + Math.sin(performance.now() * 0.00055) * 0.5;
};

const initialAsset = assetKey(new URL(location.href).searchParams.get('asset')) ?? 'lamp';
await selectAsset(initialAsset).catch((error: unknown) => {
    assetStatus.textContent = 'failed';
    console.error(`Failed to load ${ASSETS[initialAsset].name}: ${describeError(error)}`);
});
