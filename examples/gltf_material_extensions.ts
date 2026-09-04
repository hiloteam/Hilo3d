import { GLTFLoader, LocalTransform, type Entity } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { quaternionFromDegrees } from './shared/scene';

const assets = {
    lamp: {
        name: 'Anisotropy Barn Lamp',
        file: 'AnisotropyBarnLamp.glb',
        description: 'Brushed copper, clearcoat, emissive filament and transmissive bulb glass.',
        extensions: ['anisotropy', 'clearcoat', 'transmission', 'volume'],
        rotation: 20
    },
    wicker: {
        name: 'Clearcoat Wicker',
        file: 'ClearcoatWicker.glb',
        description: 'A woven metallic base under a wrinkled dielectric clearcoat normal.',
        extensions: ['clearcoat', 'clearcoat normal'],
        rotation: -18
    },
    dragon: {
        name: 'Dragon Attenuation',
        file: 'DragonAttenuation.glb',
        description: 'Thickness-textured amber absorption refracting an opaque checker backdrop.',
        extensions: ['transmission', 'volume', 'thickness texture'],
        rotation: 0
    },
    dish: {
        name: 'Iridescent Dish with Olives',
        file: 'IridescentDishWithOlives.glb',
        description: 'Animated carnival glass with spectral thin-film color and volume refraction.',
        extensions: ['iridescence', 'ior', 'transmission', 'volume'],
        rotation: -24
    },
    candle: {
        name: 'Glass Hurricane Candle Holder',
        file: 'GlassHurricaneCandleHolder.glb',
        description: 'Colored glass surrounding an emissive candle.',
        extensions: ['transmission', 'volume', 'emissive'],
        rotation: 10
    },
    amber: {
        name: 'Mosquito in Amber',
        file: 'MosquitoInAmber.glb',
        description: 'Layered amber volume with a suspended detailed mesh.',
        extensions: ['transmission', 'volume', 'ior'],
        rotation: 0
    },
    helmet: {
        name: 'Damaged Helmet',
        file: 'DamagedHelmet.glb',
        description: 'A metallic-roughness reference asset.',
        extensions: ['metallic-roughness', 'normal', 'occlusion'],
        rotation: 25
    }
} as const;
type AssetKey = keyof typeof assets;

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0.003, 0.006, 0.018, 1);
runtime.controls.setView({ x: 0, y: 0, z: 0 }, 6, 0.8, 1.1);
let activeEntities: readonly Entity[] = [];
let requestRevision = 0;
const nameElement = document.querySelector<HTMLElement>('#assetName');
const descriptionElement = document.querySelector<HTMLElement>('#assetDescription');
const statusElement = document.querySelector<HTMLElement>('#assetStatus');
const badgesElement = document.querySelector<HTMLElement>('#assetBadges');

async function showAsset(key: AssetKey): Promise<void> {
    const revision = ++requestRevision;
    const asset = assets[key];
    if (statusElement) statusElement.textContent = 'loading';
    const model = await new GLTFLoader().load({ src: `./models/KhronosPBR/${asset.file}` });
    if (revision !== requestRevision) return;
    for (const entity of activeEntities) {
        if (runtime.world.isAlive(entity)) runtime.world.destroyEntity(entity);
    }
    const instance = model.instantiate(runtime.world);
    activeEntities = instance.entities;
    const scale = model.bounds?.size ? 3.6 / model.bounds.size : 1;
    for (const root of instance.roots) {
        runtime.world.set(root, LocalTransform, {
            rotation: quaternionFromDegrees(0, asset.rotation),
            scale: [scale, scale, scale]
        });
    }
    if (nameElement) nameElement.textContent = asset.name;
    if (descriptionElement) descriptionElement.textContent = asset.description;
    if (statusElement) statusElement.textContent = 'ready';
    if (badgesElement) {
        badgesElement.replaceChildren(
            ...asset.extensions.map(extension => {
                const badge = document.createElement('span');
                badge.className = 'showcaseBadge';
                badge.textContent = extension;
                return badge;
            })
        );
    }
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-asset]')) {
    button.addEventListener('click', () => {
        const key = button.dataset['asset'];
        if (!key || !(key in assets)) return;
        for (const peer of document.querySelectorAll<HTMLButtonElement>('[data-asset]')) {
            peer.setAttribute('aria-pressed', String(peer === button));
        }
        void showAsset(key as AssetKey);
    });
}
await showAsset('lamp');
runtime.start();
