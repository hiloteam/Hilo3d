import { Color, LocalTransform, PBRMaterial, PointLight, SphereGeometry } from 'hilo3d';
import { createExampleRuntime } from './shared/runtime';
import { createMeshEntity, quaternionFromDegrees } from './shared/scene';

const families = {
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
} as const;
type Family = keyof typeof families;

const runtime = await createExampleRuntime();
runtime.engine.renderer.clearColor.set(0.0025, 0.004, 0.011, 1);
runtime.controls.setView({ x: 0.8, y: 0, z: 0 }, 11, 0.75, 1.15);
const root = runtime.world.createEntity(LocalTransform, {
    position: [1.2, 0, 0],
    rotation: quaternionFromDegrees(0, -7, 0),
    scale: [0.8, 0.8, 0.8]
});
const materials: PBRMaterial[] = [];
const geometry = new SphereGeometry({ radius: 0.48, heightSegments: 32, widthSegments: 48 });
for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 6; column++) {
        const material = new PBRMaterial({
            baseColor: new Color(...families.copper.color),
            metallic: column / 5,
            roughness: 0.08 + row * 0.185
        });
        materials.push(material);
        createMeshEntity(runtime.world, {
            parent: root,
            geometry,
            material,
            position: [(column - 2.5) * 1.22, (2 - row) * 1.18, -0.05 * Math.abs(column - 2.5)]
        });
    }
}
for (const [position, color, amount] of [
    [[-4, 4, 4], [0.55, 0.72, 1], 22],
    [[5, 1, 2], [0.2, 1, 0.9], 14]
] as const) {
    const light = runtime.world.createEntity(LocalTransform, { position });
    runtime.world.add(light, PointLight, { color, amount, range: 20 });
}
const name = document.querySelector<HTMLElement>('#familyName');
const description = document.querySelector<HTMLElement>('#familyDescription');
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-material-family]')) {
    button.addEventListener('click', () => {
        const key = button.dataset['materialFamily'];
        if (!key || !(key in families)) return;
        const family = families[key as Family];
        const [red, green, blue] = family.color;
        for (const material of materials) material.baseColor.set(red, green, blue, 1);
        if (name) name.textContent = family.label;
        if (description) description.textContent = family.description;
        for (const peer of document.querySelectorAll<HTMLButtonElement>('[data-material-family]')) {
            peer.setAttribute('aria-pressed', String(peer === button));
        }
    });
}
runtime.start();
