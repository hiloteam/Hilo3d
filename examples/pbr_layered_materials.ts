import * as Hilo3d from '../src/Hilo3d';
import { applyEnvironmentMaps } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

type FeatureName = 'anisotropy' | 'clearcoat' | 'transmission';

function requireButton(feature: FeatureName): HTMLButtonElement {
    const button = document.querySelector<HTMLButtonElement>(`[data-feature="${feature}"]`);
    if (!button) throw new Error(`Missing ${feature} feature button`);
    return button;
}

function createWrinkledNormalTexture(): Hilo3d.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to create clearcoat normal texture');
    const image = context.createImageData(size, size);
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const u = x / size;
            const v = y / size;
            const ripple = Math.sin((u * 7 + v * 3) * Math.PI * 2);
            const crossRipple = Math.cos((v * 9 - u * 2) * Math.PI * 2);
            const nx = ripple * 0.2;
            const ny = crossRipple * 0.2;
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

const galleryRoot = new Hilo3d.Node();
const { stage, camera, renderer, directionLight, ambientLight } = await createExampleContext({
    camera: {
        fov: 42,
        near: 0.1,
        far: 60,
        z: 8.4
    },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: {
                threshold: 1.25,
                knee: 0.5,
                intensity: 0.42,
                scatter: 0.58,
                maxLevels: 7
            },
            colorUber: {
                exposure: -0.68,
                contrast: 0.1,
                saturation: 0.08,
                temperature: 0.03,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.72,
                vignetteSmoothness: 0.58,
                vignetteColor: new Hilo3d.Color(0.004, 0.007, 0.02, 0.52)
            },
            opaqueTexture: true
        })
    },
    controls: {
        model: galleryRoot,
        isLockMove: true,
        isLockZ: true,
        isLockScale: false,
        rotationXLimit: 0.5
    }
});

galleryRoot.addTo(stage);
galleryRoot.x = 0.7;
camera.y = 0.5;
camera.lookAt(new Hilo3d.Vector3(0.25, 0.25, 0));
renderer.clearColor.set(0.003, 0.006, 0.018, 1);
directionLight.amount = 1.8;
directionLight.color.set(1, 0.82, 0.65, 1);
directionLight.direction.set(-0.65, -1, -0.4);
ambientLight.amount = 0.08;

const environment = await loadEnvironmentMaps();

const clearcoatNormalMap = createWrinkledNormalTexture();
const anisotropyMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.42, 0.12, 0.04),
    metallic: 1,
    roughness: 0.34,
    anisotropyStrength: 0.88,
    anisotropyRotation: Math.PI * 0.18,
    clearcoatFactor: 0.22,
    clearcoatRoughnessFactor: 0.12
});
const clearcoatMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.035, 0.17, 0.72),
    metallic: 0.08,
    roughness: 0.48,
    clearcoatFactor: 1,
    clearcoatRoughnessFactor: 0.08,
    clearcoatNormalMap,
    clearcoatNormalScale: 0.58
});
const transmissionMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.48, 0.94, 1),
    metallic: 0,
    roughness: 0.08,
    transmissionFactor: 0.94,
    thicknessFactor: 1.15,
    attenuationDistance: 1.45,
    attenuationColor: new Hilo3d.Color(0.12, 0.78, 1),
    ior: 1.46
});
const pedestalMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.035, 0.045, 0.075),
    metallic: 0.88,
    roughness: 0.32
});
const floorMaterial = new Hilo3d.PBRMaterial({
    baseColor: new Hilo3d.Color(0.018, 0.024, 0.046),
    metallic: 0.72,
    roughness: 0.42
});

applyEnvironmentMaps(
    [anisotropyMaterial, clearcoatMaterial, transmissionMaterial, pedestalMaterial, floorMaterial],
    environment
);

const sphereGeometry = new Hilo3d.SphereGeometry({
    radius: 1,
    heightSegments: 40,
    widthSegments: 64
});
const pedestalGeometry = new Hilo3d.BoxGeometry({
    width: 1.75,
    height: 0.22,
    depth: 1.75
});
const materialMeshes = [
    new Hilo3d.Mesh({
        geometry: sphereGeometry,
        material: anisotropyMaterial,
        x: -2.35,
        y: 0.2,
        rotationX: -8,
        rotationY: 28
    }),
    new Hilo3d.Mesh({
        geometry: sphereGeometry,
        material: clearcoatMaterial,
        y: 0.28,
        rotationX: 12,
        rotationY: -22
    }),
    new Hilo3d.Mesh({
        geometry: sphereGeometry,
        material: transmissionMaterial,
        x: 2.35,
        y: 0.2,
        rotationX: -6,
        rotationY: 18
    })
] as const;

for (const mesh of materialMeshes) mesh.addTo(galleryRoot);
materialMeshes[0].setScale(1.04, 1.16, 1.04);
materialMeshes[1].setScale(1.08);
materialMeshes[2].setScale(1.06, 1.18, 1.06);

for (const x of [-2.35, 0, 2.35]) {
    new Hilo3d.Mesh({
        geometry: pedestalGeometry,
        material: pedestalMaterial,
        x,
        y: -1.02
    }).addTo(galleryRoot);
}

new Hilo3d.Mesh({
    geometry: new Hilo3d.PlaneGeometry({ width: 16, height: 10 }),
    material: floorMaterial,
    y: -1.14,
    z: 1,
    rotationX: -90
}).addTo(galleryRoot);

const neonGeometry = new Hilo3d.BoxGeometry({ width: 0.16, height: 2.6, depth: 0.12 });
const neonMaterials = [
    new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(0.12, 1.8, 2.6)
    }),
    new Hilo3d.BasicMaterial({
        lightType: 'NONE',
        diffuse: new Hilo3d.Color(2.2, 0.2, 1.25)
    })
] as const;
for (let index = 0; index < 7; index += 1) {
    const material = neonMaterials[index % neonMaterials.length];
    if (!material) throw new Error('Missing neon showcase material');
    new Hilo3d.Mesh({
        geometry: neonGeometry,
        material,
        x: 1.72 + index * 0.22,
        y: 0.05 + (index % 2) * 0.22,
        z: -1.25,
        rotationZ: -16 + index * 5
    }).addTo(galleryRoot);
}

const areaLight = new Hilo3d.AreaLight({
    color: new Hilo3d.Color(1, 0.55, 0.3),
    amount: 3.6,
    width: 4.5,
    height: 2.5,
    x: -1.5,
    y: 4,
    z: 3
}).addTo(stage);
areaLight.lookAt(new Hilo3d.Vector3(0, 0.2, 0));

const cyanLight = new Hilo3d.PointLight({
    color: new Hilo3d.Color(0.2, 0.75, 1),
    amount: 5,
    range: 10,
    x: 3.2,
    y: 1.6,
    z: 2.4
}).addTo(stage);

galleryRoot.onUpdate = deltaTime => {
    materialMeshes[0].rotationY += deltaTime * 0.012;
    materialMeshes[1].rotationY -= deltaTime * 0.009;
    materialMeshes[2].rotationY += deltaTime * 0.007;
    cyanLight.x = 3.2 + Math.sin(performance.now() * 0.00045) * 0.7;
};

const featureState: Record<FeatureName, boolean> = {
    anisotropy: true,
    clearcoat: true,
    transmission: true
};
const featureMaterials: Readonly<Record<FeatureName, Hilo3d.PBRMaterial>> = {
    anisotropy: anisotropyMaterial,
    clearcoat: clearcoatMaterial,
    transmission: transmissionMaterial
};

function setFeature(name: FeatureName, enabled: boolean): void {
    featureState[name] = enabled;
    const material = featureMaterials[name];
    if (name === 'anisotropy') material.anisotropyStrength = enabled ? 0.88 : 0;
    else if (name === 'clearcoat') material.clearcoatFactor = enabled ? 1 : 0;
    else material.transmissionFactor = enabled ? 0.94 : 0;
    material.isDirty = true;
    const button = requireButton(name);
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = `${name} · ${enabled ? 'on' : 'off'}`;
}

for (const name of Object.keys(featureState) as FeatureName[]) {
    requireButton(name).addEventListener('click', () => {
        setFeature(name, !featureState[name]);
    });
}

document.body.dataset['showcaseReady'] = 'true';
