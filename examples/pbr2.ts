import * as Hilo3d from '../src/Hilo3d';
import { applyEnvironmentMaps } from './shared/environment';
import { createExampleContext, loadEnvironmentMaps } from './shared/init';

interface MaterialFamily {
    readonly label: string;
    readonly description: string;
    readonly color: readonly [number, number, number];
}

const MATERIAL_FAMILIES = {
    steel: {
        label: 'Studio steel',
        description: 'A neutral reference for reading highlight width and energy.',
        color: [0.58, 0.62, 0.68]
    },
    copper: {
        label: 'Warm copper',
        description: 'Saturated metal makes the roughness response immediately visible.',
        color: [0.955, 0.638, 0.538]
    },
    gold: {
        label: 'Soft gold',
        description: 'A warm conductor under a cool studio key and cyan rim.',
        color: [1, 0.766, 0.336]
    },
    ceramic: {
        label: 'Cobalt ceramic',
        description: 'A dielectric color reference for the low-metallic columns.',
        color: [0.055, 0.19, 0.82]
    }
} as const satisfies Readonly<Record<string, MaterialFamily>>;

type MaterialFamilyKey = keyof typeof MATERIAL_FAMILIES;

const metallicStops = [0, 0.18, 0.36, 0.58, 0.8, 1] as const;
const roughnessStops = [0.08, 0.2, 0.38, 0.58, 0.82] as const;
const materialRoot = new Hilo3d.Node();

const { stage, camera, renderer, directionLight, ambientLight } = await createExampleContext({
    camera: {
        fov: 38,
        near: 0.05,
        far: 80,
        z: 11.2
    },
    stage: {
        renderPipeline: new Hilo3d.PostProcessRenderPipelineFactory({
            bloom: {
                threshold: 2.6,
                knee: 0.65,
                intensity: 0.035,
                scatter: 0.48,
                maxLevels: 7
            },
            colorUber: {
                exposure: -0.82,
                contrast: 0.04,
                saturation: -0.02,
                temperature: -0.01,
                toneMapping: 'pbr-neutral',
                vignetteIntensity: 0.56,
                vignetteSmoothness: 0.62,
                vignetteColor: new Hilo3d.Color(0.002, 0.004, 0.012, 0.48)
            }
        })
    },
    controls: {
        model: materialRoot,
        isLockMove: true,
        isLockZ: true,
        isLockScale: true,
        rotationXLimit: 0.22
    }
});

materialRoot.addTo(stage);
materialRoot.rotationY = -7;
camera.lookAt(new Hilo3d.Vector3(0.85, 0.05, 0));
renderer.clearColor.set(0.0025, 0.004, 0.011, 1);

directionLight.amount = 0.52;
directionLight.color.set(0.72, 0.82, 1, 1);
directionLight.direction.set(-0.52, -0.8, -0.62);
ambientLight.amount = 0.018;
ambientLight.color.set(0.32, 0.42, 0.62, 1);

function requireElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`PBR Material Lab is missing ${selector}`);
    return element;
}

const familyName = requireElement('#familyName');
const familyDescription = requireElement('#familyDescription');
const familyButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-material-family]')];
const materials: Hilo3d.PBRMaterial[] = [];

function materialFamilyKey(value: string | undefined): MaterialFamilyKey | null {
    if (value && value in MATERIAL_FAMILIES) return value as MaterialFamilyKey;
    return null;
}

function applyFamily(key: MaterialFamilyKey): void {
    const family = MATERIAL_FAMILIES[key];
    const [red, green, blue] = family.color;
    for (const material of materials) {
        material.baseColor.set(red, green, blue, 1);
    }
    familyName.textContent = family.label;
    familyDescription.textContent = family.description;
    for (const button of familyButtons) {
        button.setAttribute('aria-pressed', String(button.dataset['materialFamily'] === key));
    }
    document.body.dataset['materialFamily'] = key;
}

for (const button of familyButtons) {
    button.addEventListener('click', () => {
        const key = materialFamilyKey(button.dataset['materialFamily']);
        if (key) applyFamily(key);
    });
}

function layoutMaterialGrid(): void {
    const width = window.innerWidth;
    if (width <= 820) {
        materialRoot.setScale(0.62);
        materialRoot.setPosition(1.35, -0.18, 0);
    } else if (width <= 1200) {
        materialRoot.setScale(0.8);
        materialRoot.setPosition(1.85, 0.05, 0);
    } else {
        materialRoot.setScale(1);
        materialRoot.setPosition(1.25, 0.16, 0);
    }
}

async function initializeStudio(): Promise<void> {
    const environment = await loadEnvironmentMaps();
    const sphereGeometry = new Hilo3d.SphereGeometry({
        radius: 0.48,
        heightSegments: 64,
        widthSegments: 96
    });

    for (let row = 0; row < roughnessStops.length; row += 1) {
        const roughness = roughnessStops[row] ?? 0.5;
        for (let column = 0; column < metallicStops.length; column += 1) {
            const metallic = metallicStops[column] ?? 0;
            const material = new Hilo3d.PBRMaterial({
                baseColor: new Hilo3d.Color(...MATERIAL_FAMILIES.copper.color),
                metallic,
                roughness,
                diffuseEnvIntensity: 0.28,
                specularEnvIntensity: 0.82
            });
            applyEnvironmentMaps([material], environment);
            materials.push(material);

            new Hilo3d.Mesh({
                geometry: sphereGeometry,
                material,
                x: (column - (metallicStops.length - 1) * 0.5) * 1.22,
                y: ((roughnessStops.length - 1) * 0.5 - row) * 1.18,
                z: -0.05 * Math.abs(column - (metallicStops.length - 1) * 0.5)
            }).addTo(materialRoot);
        }
    }

    const backdropMaterial = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.008, 0.014, 0.034),
        metallic: 0.18,
        roughness: 0.64
    });
    const floorMaterial = new Hilo3d.PBRMaterial({
        baseColor: new Hilo3d.Color(0.014, 0.021, 0.042),
        metallic: 0.76,
        roughness: 0.3
    });
    applyEnvironmentMaps([backdropMaterial, floorMaterial], environment);
    backdropMaterial.diffuseEnvIntensity = 0.18;
    backdropMaterial.specularEnvIntensity = 0.25;
    floorMaterial.diffuseEnvIntensity = 0.16;
    floorMaterial.specularEnvIntensity = 0.45;
    new Hilo3d.Mesh({
        geometry: new Hilo3d.PlaneGeometry({ width: 24, height: 15 }),
        material: backdropMaterial,
        z: -2.2
    }).addTo(stage);
    new Hilo3d.Mesh({
        geometry: new Hilo3d.PlaneGeometry({ width: 22, height: 11 }),
        material: floorMaterial,
        y: -3.05,
        z: 1,
        rotationX: -90
    }).addTo(stage);

    const softboxKey = new Hilo3d.AreaLight({
        color: new Hilo3d.Color(1, 0.93, 0.84),
        amount: 2.1,
        width: 5.8,
        height: 3.4,
        x: -2.8,
        y: 4.4,
        z: 4.6
    }).addTo(stage);
    softboxKey.lookAt(new Hilo3d.Vector3(0.8, 0.1, 0));

    const coolRim = new Hilo3d.AreaLight({
        color: new Hilo3d.Color(0.14, 0.5, 1),
        amount: 1.25,
        width: 4.8,
        height: 3.2,
        x: 5.4,
        y: 2.8,
        z: 2.7
    }).addTo(stage);
    coolRim.lookAt(new Hilo3d.Vector3(1, 0, 0));

    new Hilo3d.PointLight({
        color: new Hilo3d.Color(1, 0.24, 0.08),
        amount: 1.2,
        range: 14,
        x: -4.2,
        y: -1.2,
        z: 3.5
    }).addTo(stage);

    materialRoot.onUpdate = () => {
        const time = performance.now() * 0.00022;
        coolRim.y = 2.8 + Math.sin(time) * 0.45;
        softboxKey.x = -2.8 + Math.cos(time * 0.42) * 0.22;
    };

    layoutMaterialGrid();
    window.addEventListener('resize', layoutMaterialGrid);
    applyFamily('copper');
    document.body.dataset['pbrLabReady'] = 'true';
}

void initializeStudio().catch((error: unknown) => {
    document.body.dataset['pbrLabReady'] = 'failed';
    console.error('Failed to initialize PBR Material Lab', error);
});
